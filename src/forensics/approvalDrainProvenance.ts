import { createHash } from "node:crypto";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { ListTrc20ApprovalChangesInput, TronscanApprovalChange } from "../tron/tronClient";
import type {
  ApprovalDrainProvenanceProfile,
  ApprovalDrainTokenState,
  ForensicRouteEdge,
  RawEvidenceInput,
  RiskSignalObservationInput,
  RouteScoreFeature,
  ServiceClassification,
  StablecoinRestrictionProfile
} from "../types";
import { FORENSIC_ROUTE_POLICY_VERSION } from "./routeScorer";

export type ApprovalDrainLookupDeps = {
  getTransaction(txHash: string): Promise<unknown>;
  listTrc20ApprovalChanges(input: ListTrc20ApprovalChangesInput): Promise<TronscanApprovalChange[]>;
  getUsdtRestrictionStatus?(address: string, options?: { includeEventTimeline?: boolean }): Promise<StablecoinRestrictionProfile>;
};

export type BuildApprovalDrainProvenanceInput = {
  subjectAddress: string;
  edges: ForensicRouteEdge[];
  classifications?: Map<string, ServiceClassification | null>;
  deps: ApprovalDrainLookupDeps;
  maxCandidates?: number;
  approvalChangeLookupLimit?: number;
  minAmountPreservationRatio?: number;
};

const DEFAULT_MAX_CANDIDATES = 5;
const DEFAULT_APPROVAL_CHANGE_LOOKUP_LIMIT = 5;
const DEFAULT_MIN_AMOUNT_PRESERVATION_RATIO = 0.7;
const DEFAULT_ROUTE_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function edgeAmount(edge: ForensicRouteEdge): bigint {
  return /^\d+$/.test(edge.amountRaw) ? BigInt(edge.amountRaw) : 0n;
}

function rawAmount(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

function balancedPreservationRatio(left: bigint, right: bigint): number {
  if (left <= 0n || right <= 0n) return 0;
  const smaller = left < right ? left : right;
  const larger = left > right ? left : right;
  return ratio(smaller, larger);
}

function minBigint(values: bigint[]): bigint {
  return values.reduce((min, value) => value < min ? value : min);
}

function sumEdges(edges: ForensicRouteEdge[]): bigint {
  return edges.reduce((sum, edge) => sum + edgeAmount(edge), 0n);
}

function compareBigintDesc(a: bigint, b: bigint): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

function transferCaller(transactionInfo: unknown): string | null {
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : null;
  const contractData = isObjectRecord(tx?.contractData) ? tx.contractData : null;
  return stringField(tx?.ownerAddress ?? contractData?.owner_address);
}

function isBoundary(classification: ServiceClassification | null | undefined): boolean {
  return Boolean(classification && classification.category !== "none" && classification.isBoundary);
}

function isValidApprovalChange(change: TronscanApprovalChange, input: {
  ownerAddress: string;
  spenderAddress: string;
  drainAt: Date;
  drainAmountRaw: string;
}): boolean {
  if (change.ownerAddress !== input.ownerAddress) return false;
  if (change.spenderAddress !== input.spenderAddress) return false;
  if (change.tokenContract !== TRON_USDT_CONTRACT_ADDRESS) return false;
  if (change.confirmed !== true) return false;
  if (change.contractRet && change.contractRet !== "SUCCESS") return false;
  if (change.timestamp.getTime() > input.drainAt.getTime()) return false;
  if (change.isUnlimited) return true;
  return rawAmount(change.amountRaw) >= rawAmount(input.drainAmountRaw);
}

function newestValidApproval(changes: TronscanApprovalChange[], input: {
  ownerAddress: string;
  spenderAddress: string;
  drainAt: Date;
  drainAmountRaw: string;
}): TronscanApprovalChange | null {
  return changes
    .filter((change) => isValidApprovalChange(change, input))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0] ?? null;
}

function scoreForHopDepth(hopDepth: 0 | 1 | 2): number {
  if (hopDepth === 0) return 90;
  if (hopDepth === 1) return 80;
  return 70;
}

function tokenState(profile: StablecoinRestrictionProfile | null, address: string): ApprovalDrainTokenState | null {
  if (!profile) return null;
  return {
    address,
    balanceRaw: profile.balanceRaw,
    isBlacklisted: profile.isBlacklisted,
    blockedBalanceRaw: profile.isBlacklisted ? profile.balanceRaw : null,
    checkedAt: profile.checkedAt
  };
}

async function resolveTokenState(
  deps: ApprovalDrainLookupDeps,
  address: string
): Promise<ApprovalDrainTokenState | null> {
  const profile = await deps.getUsdtRestrictionStatus?.(address, { includeEventTimeline: false }).catch(() => null) ?? null;
  return tokenState(profile, address);
}

function findPathFromReceiverToSubject(input: {
  firstReceiverAddress: string;
  subjectAddress: string;
  drainAt: Date;
  drainAmount: bigint;
  edges: ForensicRouteEdge[];
  classifications?: Map<string, ServiceClassification | null>;
  minAmountPreservationRatio: number;
}): {
  hopDepth: 0 | 1 | 2;
  edges: ForensicRouteEdge[];
  amountRaw: string;
  amountPreservationRatio: number;
  routeAddresses: string[];
} | null {
  if (isBoundary(input.classifications?.get(input.subjectAddress))) {
    return null;
  }
  if (input.firstReceiverAddress === input.subjectAddress) {
    return {
      hopDepth: 0,
      edges: [],
      amountRaw: input.drainAmount.toString(),
      amountPreservationRatio: 1,
      routeAddresses: [input.firstReceiverAddress]
    };
  }
  if (isBoundary(input.classifications?.get(input.firstReceiverAddress))) {
    return null;
  }

  const candidates: Array<{
    hopDepth: 1 | 2;
    edges: ForensicRouteEdge[];
    amountRaw: string;
    amountPreservationRatio: number;
    routeAddresses: string[];
  }> = [];
  const latestRouteAt = input.drainAt.getTime() + DEFAULT_ROUTE_LOOKAHEAD_MS;
  const outgoing = input.edges
    .filter((edge) =>
      edge.fromAddress === input.firstReceiverAddress &&
      edge.timestamp.getTime() >= input.drainAt.getTime() &&
      edge.timestamp.getTime() <= latestRouteAt
    )
    .sort((a, b) => compareBigintDesc(edgeAmount(a), edgeAmount(b)));

  const directToSubject = outgoing
    .filter((edge) => edge.toAddress === input.subjectAddress)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  if (directToSubject.length > 0) {
    candidates.push({
      hopDepth: 1,
      edges: directToSubject,
      amountRaw: sumEdges(directToSubject).toString(),
      routeAddresses: [input.firstReceiverAddress, input.subjectAddress],
      amountPreservationRatio: balancedPreservationRatio(sumEdges(directToSubject), input.drainAmount)
    });
  }

  const intermediateAddresses = [...new Set(outgoing
    .filter((edge) => edge.toAddress !== input.subjectAddress)
    .map((edge) => edge.toAddress))];
  for (const intermediateAddress of intermediateAddresses) {
    if (isBoundary(input.classifications?.get(intermediateAddress))) continue;
    const firstLegEdges = outgoing.filter((edge) => edge.toAddress === intermediateAddress);
    const firstLegAt = firstLegEdges
      .map((edge) => edge.timestamp.getTime())
      .sort((a, b) => a - b)[0] ?? input.drainAt.getTime();
    const secondHop = input.edges
      .filter((edge) =>
        edge.fromAddress === intermediateAddress &&
        edge.toAddress === input.subjectAddress &&
        edge.timestamp.getTime() >= firstLegAt &&
        edge.timestamp.getTime() <= latestRouteAt
      )
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    if (secondHop.length > 0) {
      const preservedAmount = minBigint([sumEdges(firstLegEdges), sumEdges(secondHop)]);
      candidates.push({
        hopDepth: 2,
        edges: [...firstLegEdges, ...secondHop],
        amountRaw: sumEdges(secondHop).toString(),
        routeAddresses: [input.firstReceiverAddress, intermediateAddress, input.subjectAddress],
        amountPreservationRatio: balancedPreservationRatio(preservedAmount, input.drainAmount)
      });
    }
  }

  const best = candidates
    .filter((candidate) => candidate.amountPreservationRatio >= input.minAmountPreservationRatio)
    .sort((a, b) => b.amountPreservationRatio - a.amountPreservationRatio)[0] ?? null;
  if (!best) return null;
  return {
    hopDepth: best.hopDepth,
    edges: best.edges,
    amountRaw: best.amountRaw,
    amountPreservationRatio: best.amountPreservationRatio,
    routeAddresses: best.routeAddresses
  };
}

function featuresForProfile(input: {
  hopDepth: 0 | 1 | 2;
  amountPreservationRatio: number;
  score: number;
}): RouteScoreFeature[] {
  const features: RouteScoreFeature[] = [{
    code: "approval_drain_exact_transfer_from",
    label: "Exact USDT approval-drain transferFrom root was found.",
    scoreImpact: input.score
  }];
  if (input.hopDepth === 0) {
    features.push({
      code: "approval_drain_direct_receiver",
      label: "Checked address is the first receiver after the transferFrom drain.",
      scoreImpact: 0
    });
  } else {
    features.push({
      code: "approval_drain_route_linked",
      label: `Checked address is linked to the approval-drain receiver within ${input.hopDepth} hop(s).`,
      scoreImpact: 0,
      value: input.hopDepth
    });
  }
  if (input.amountPreservationRatio >= 0.95) {
    features.push({
      code: "approval_drain_amount_preserved",
      label: "The linked route preserves most of the drained USDT amount.",
      scoreImpact: 0,
      value: input.amountPreservationRatio
    });
  }
  return features;
}

export async function buildApprovalDrainProvenanceProfile(
  input: BuildApprovalDrainProvenanceInput
): Promise<ApprovalDrainProvenanceProfile | null> {
  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const approvalChangeLookupLimit = input.approvalChangeLookupLimit ?? DEFAULT_APPROVAL_CHANGE_LOOKUP_LIMIT;
  const minAmountPreservationRatio = input.minAmountPreservationRatio ?? DEFAULT_MIN_AMOUNT_PRESERVATION_RATIO;
  const transferFromCandidates = input.edges
    .filter((edge) => edge.edgeType === "transfer_from" && edgeAmount(edge) > 0n)
    .sort((a, b) => compareBigintDesc(edgeAmount(a), edgeAmount(b)))
    .slice(0, maxCandidates);
  const profiles: ApprovalDrainProvenanceProfile[] = [];

  for (const drainEdge of transferFromCandidates) {
    const path = findPathFromReceiverToSubject({
      firstReceiverAddress: drainEdge.toAddress,
      subjectAddress: input.subjectAddress,
      drainAt: drainEdge.timestamp,
      drainAmount: edgeAmount(drainEdge),
      edges: input.edges,
      classifications: input.classifications,
      minAmountPreservationRatio
    });
    if (!path) continue;

    const transactionInfo = await input.deps.getTransaction(drainEdge.txHash).catch(() => null);
    const spenderAddress = transferCaller(transactionInfo);
    if (!spenderAddress) continue;

    const approvalChanges = await input.deps.listTrc20ApprovalChanges({
      ownerAddress: drainEdge.fromAddress,
      spenderAddress,
      contractAddress: TRON_USDT_CONTRACT_ADDRESS,
      start: 0,
      limit: approvalChangeLookupLimit
    }).catch(() => []);
    const approval = newestValidApproval(approvalChanges, {
      ownerAddress: drainEdge.fromAddress,
      spenderAddress,
      drainAt: drainEdge.timestamp,
      drainAmountRaw: drainEdge.amountRaw
    });
    if (!approval) continue;

    const score = scoreForHopDepth(path.hopDepth);
    const subjectTokenState = await resolveTokenState(input.deps, input.subjectAddress);
    const victimTokenState = await resolveTokenState(input.deps, drainEdge.fromAddress);
    profiles.push({
      victimAddress: drainEdge.fromAddress,
      approvalTxHash: approval.txHash,
      drainTxHash: drainEdge.txHash,
      spenderAddress,
      firstReceiverAddress: drainEdge.toAddress,
      subjectAddress: input.subjectAddress,
      hopDepth: path.hopDepth,
      amountRaw: path.amountRaw,
      amountPreservationRatio: path.amountPreservationRatio,
      approvalAt: approval.timestamp.toISOString(),
      drainAt: drainEdge.timestamp.toISOString(),
      pathTxHashes: [drainEdge.txHash, ...path.edges.map((edge) => edge.txHash)],
      pathAddresses: [drainEdge.fromAddress, ...path.routeAddresses],
      score,
      evidenceStrength: path.hopDepth === 0 ? "exact_approval_and_transfer_from" : "route_linked",
      subjectTokenState,
      victimTokenState,
      features: featuresForProfile({
        hopDepth: path.hopDepth,
        amountPreservationRatio: path.amountPreservationRatio,
        score
      })
    });
  }

  return profiles.sort((a, b) =>
    b.score === a.score
      ? b.amountPreservationRatio - a.amountPreservationRatio
      : b.score - a.score
  )[0] ?? null;
}

export function rawEvidenceForApprovalDrainProvenance(input: {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profile: ApprovalDrainProvenanceProfile;
}): RawEvidenceInput {
  return {
    id: stableId([
      "forensic_approval_drain_provenance_raw",
      input.subjectAddress,
      input.profile.approvalTxHash,
      input.profile.drainTxHash,
      input.windowStart.toISOString(),
      input.windowEnd.toISOString()
    ]),
    source: "forensic_route_search",
    sourceType: "detector_output",
    chain: "tron",
    address: input.subjectAddress,
    txHash: input.profile.drainTxHash,
    observedTransactionHash: input.profile.pathTxHashes.at(-1) ?? input.profile.drainTxHash,
    evidenceJson: {
      approvalDrainProvenanceProfile: input.profile,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString()
    }
  };
}

export function observationForApprovalDrainProvenance(input: {
  subjectAddress: string;
  profile: ApprovalDrainProvenanceProfile;
  rawEvidenceId: string;
}): RiskSignalObservationInput {
  return {
    id: stableId([
      "forensic_approval_drain_provenance_observation",
      input.subjectAddress,
      input.profile.approvalTxHash,
      input.profile.drainTxHash,
      FORENSIC_ROUTE_POLICY_VERSION
    ]),
    subjectChain: "tron",
    subjectAddress: input.subjectAddress,
    subjectTxHash: null,
    observedTransactionHash: input.profile.pathTxHashes.at(-1) ?? input.profile.drainTxHash,
    signalGroup: "approval",
    code: "forensic_approval_drain_provenance",
    message: "Funds are connected to an exact approval-drain flow within 2 hops.",
    scoreImpact: input.profile.score,
    confidence: "high",
    severity: input.profile.score >= 90 ? "critical" : "high",
    source: "approval_drain_provenance",
    policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
    rawEvidenceId: input.rawEvidenceId
  };
}
