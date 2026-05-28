import { createHash } from "node:crypto";
import { TronWeb } from "tronweb";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { ListTrc20ApprovalChangesInput, TronscanApprovalChange } from "../tron/tronClient";
import type {
  ApprovalDrainProvenanceProfile,
  ApprovalDrainReviewFinding,
  ApprovalDrainFalsePositiveGuard,
  ApprovalDrainSpenderResolution,
  ApprovalDrainSupportingFingerprint,
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

export type ApprovalDrainProvenanceAnalysis = {
  profiles: ApprovalDrainProvenanceProfile[];
  reviewFindings: ApprovalDrainReviewFinding[];
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

function objectField(value: unknown): Record<string, unknown> | null {
  return isObjectRecord(value) ? value : null;
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function tronAddressField(value: unknown): string | null {
  const raw = stringField(value);
  if (!raw) return null;
  const normalized = raw.trim();
  if (/^41[0-9a-fA-F]{40}$/.test(normalized)) {
    try {
      return TronWeb.address.fromHex(normalized);
    } catch {
      return null;
    }
  }
  return normalized;
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
  const contractData = objectField(tx?.contractData);
  const triggerInfo = objectField(tx?.trigger_info);
  const rawData = objectField(tx?.raw_data);
  const rawContract = objectField(arrayField(rawData?.contract)[0]);
  const rawParameter = objectField(rawContract?.parameter);
  const rawValue = objectField(rawParameter?.value);
  return tronAddressField(
    tx?.ownerAddress ??
    tx?.owner_address ??
    contractData?.ownerAddress ??
    contractData?.owner_address ??
    triggerInfo?.ownerAddress ??
    triggerInfo?.owner_address ??
    rawValue?.owner_address
  );
}

function transactionOperator(transactionInfo: unknown): string | null {
  return transferCaller(transactionInfo);
}

function calledContractAddress(transactionInfo: unknown): string | null {
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : null;
  const contractData = objectField(tx?.contractData);
  const triggerInfo = objectField(tx?.trigger_info);
  const rawData = objectField(tx?.raw_data);
  const rawContract = objectField(arrayField(rawData?.contract)[0]);
  const rawParameter = objectField(rawContract?.parameter);
  const rawValue = objectField(rawParameter?.value);
  return tronAddressField(
    tx?.contractAddress ??
    tx?.contract_address ??
    contractData?.contractAddress ??
    contractData?.contract_address ??
    triggerInfo?.contractAddress ??
    triggerInfo?.contract_address ??
    rawValue?.contract_address
  );
}

function methodText(transactionInfo: unknown): string {
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : null;
  const contractData = objectField(tx?.contractData);
  const triggerInfo = objectField(tx?.trigger_info);
  return [
    stringField(triggerInfo?.methodName),
    stringField(triggerInfo?.method),
    stringField(triggerInfo?.methodId),
    stringField(contractData?.function_selector),
    stringField(tx?.method),
    stringField(tx?.methodName)
  ].filter((value): value is string => Boolean(value)).join(" ");
}

function methodLooksLikeTransferFrom(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes("transferfrom") || normalized.includes("23b872dd");
}

function resolveSpender(input: {
  transactionInfo: unknown;
  drainEdge: ForensicRouteEdge;
}): {
  spenderAddress: string | null;
  operatorAddress: string | null;
  spenderResolution: ApprovalDrainSpenderResolution;
  calledContractAddress: string | null;
  methodText: string;
} {
  const operatorAddress = transactionOperator(input.transactionInfo);
  const contractAddress = calledContractAddress(input.transactionInfo);
  const text = methodText(input.transactionInfo) || input.drainEdge.method;
  if (contractAddress && contractAddress !== TRON_USDT_CONTRACT_ADDRESS) {
    return {
      spenderAddress: contractAddress,
      operatorAddress,
      spenderResolution: "wrapper_contract",
      calledContractAddress: contractAddress,
      methodText: text
    };
  }
  if (
    operatorAddress &&
    input.drainEdge.edgeType === "transfer_from"
  ) {
    return {
      spenderAddress: operatorAddress,
      operatorAddress,
      spenderResolution: "direct_usdt_owner",
      calledContractAddress: contractAddress,
      methodText: text
    };
  }
  return {
    spenderAddress: null,
    operatorAddress,
    spenderResolution: "unknown",
    calledContractAddress: contractAddress,
    methodText: text
  };
}

function classificationGuard(
  code: ApprovalDrainFalsePositiveGuard["code"],
  address: string,
  classification: ServiceClassification | null | undefined
): ApprovalDrainFalsePositiveGuard | null {
  if (!isBoundary(classification)) return null;
  const role = code.replace(/_/g, " ");
  return {
    code,
    label: `Approval-drain auto-decline blocked by ${role}.`,
    address,
    category: classification?.category ?? null,
    identity: classification?.identity ?? null
  };
}

function boundaryGuardsForPath(input: {
  subjectAddress: string;
  spenderAddress: string | null;
  firstReceiverAddress: string;
  pathEdges: ForensicRouteEdge[];
  classifications?: Map<string, ServiceClassification | null>;
}): ApprovalDrainFalsePositiveGuard[] {
  const guards = [
    input.spenderAddress
      ? classificationGuard("spender_service_boundary", input.spenderAddress, input.classifications?.get(input.spenderAddress))
      : null,
    classificationGuard("subject_service_boundary", input.subjectAddress, input.classifications?.get(input.subjectAddress)),
    classificationGuard("receiver_service_boundary", input.firstReceiverAddress, input.classifications?.get(input.firstReceiverAddress))
  ];
  const intermediateAddresses = new Set(input.pathEdges
    .flatMap((edge) => [edge.fromAddress, edge.toAddress])
    .filter((address) => address !== input.subjectAddress && address !== input.firstReceiverAddress));
  for (const address of intermediateAddresses) {
    guards.push(classificationGuard("intermediate_service_boundary", address, input.classifications?.get(address)));
  }
  return guards.filter((guard): guard is ApprovalDrainFalsePositiveGuard => guard !== null);
}

function tokenTransferRows(transactionInfo: unknown): Record<string, unknown>[] {
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : null;
  const rows = [
    ...arrayField(tx?.trc20TransferInfo),
    ...arrayField(tx?.tokenTransferInfo),
    ...arrayField(tx?.transfers)
  ];
  return rows.filter(isObjectRecord);
}

function transferTokenContract(row: Record<string, unknown>): string | null {
  const tokenInfo = objectField(row.tokenInfo);
  return stringField(row.contract_address ?? row.contractAddress ?? tokenInfo?.tokenId);
}

function transferTokenSymbol(row: Record<string, unknown>): string | null {
  const tokenInfo = objectField(row.tokenInfo);
  return stringField(row.tokenAbbr ?? row.tokenSymbol ?? tokenInfo?.tokenAbbr);
}

function transferAddressMatches(row: Record<string, unknown>, addresses: Set<string>): boolean {
  const from = stringField(row.from_address ?? row.fromAddress);
  const to = stringField(row.to_address ?? row.toAddress);
  return Boolean((from && addresses.has(from)) || (to && addresses.has(to)));
}

function supportingFingerprints(input: {
  transactionInfo: unknown;
  drainEdge: ForensicRouteEdge;
  resolution: ReturnType<typeof resolveSpender>;
  amountPreservationRatio: number | null;
}): ApprovalDrainSupportingFingerprint[] {
  const fingerprints: ApprovalDrainSupportingFingerprint[] = [];
  if (
    input.resolution.spenderResolution === "wrapper_contract" &&
    input.resolution.methodText &&
    !methodLooksLikeTransferFrom(input.resolution.methodText)
  ) {
    fingerprints.push({
      code: "misleading_wrapper_method",
      label: "Wrapper method name does not disclose USDT transferFrom behavior.",
      value: input.resolution.methodText
    });
  }
  const relatedAddresses = new Set([
    input.drainEdge.fromAddress,
    input.drainEdge.toAddress,
    input.resolution.spenderAddress ?? "",
    input.resolution.operatorAddress ?? ""
  ].filter((value) => value.length > 0));
  const marker = tokenTransferRows(input.transactionInfo).find((row) => {
    const tokenContract = transferTokenContract(row);
    return tokenContract &&
      tokenContract !== TRON_USDT_CONTRACT_ADDRESS &&
      transferAddressMatches(row, relatedAddresses);
  });
  if (marker) {
    fingerprints.push({
      code: "nearby_non_usdt_token_transfer",
      label: "Nearby non-USDT token transfer observed around the drain transaction.",
      value: transferTokenSymbol(marker) ?? transferTokenContract(marker)
    });
  }
  if (input.amountPreservationRatio !== null && input.amountPreservationRatio >= 0.95) {
    fingerprints.push({
      code: "amount_preservation",
      label: "Most of the drained amount is preserved on the route to the checked wallet.",
      value: input.amountPreservationRatio
    });
  }
  return fingerprints;
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

function clusterFingerprints(
  profile: ApprovalDrainProvenanceProfile,
  profiles: ApprovalDrainProvenanceProfile[]
): ApprovalDrainSupportingFingerprint[] {
  if (profiles.length < 2) return [];
  const fingerprints: ApprovalDrainSupportingFingerprint[] = [{
    code: "multiple_exact_approval_drain_profiles",
    label: "Multiple exact approval-drain profiles were found in the same checked balance context.",
    value: profiles.length
  }];
  const sameSpenderCount = profiles.filter((item) => item.spenderAddress === profile.spenderAddress).length;
  if (sameSpenderCount > 1) {
    fingerprints.push({
      code: "same_spender_cluster",
      label: "Multiple exact approval-drain profiles share the same approved spender.",
      value: sameSpenderCount
    });
  }
  const sameReceiverCount = profiles.filter((item) => item.firstReceiverAddress === profile.firstReceiverAddress).length;
  if (sameReceiverCount > 1) {
    fingerprints.push({
      code: "same_receiver_cluster",
      label: "Multiple exact approval-drain profiles share the same first receiver.",
      value: sameReceiverCount
    });
  }
  return fingerprints;
}

export async function buildApprovalDrainProvenanceAnalysis(
  input: BuildApprovalDrainProvenanceInput
): Promise<ApprovalDrainProvenanceAnalysis> {
  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const approvalChangeLookupLimit = input.approvalChangeLookupLimit ?? DEFAULT_APPROVAL_CHANGE_LOOKUP_LIMIT;
  const minAmountPreservationRatio = input.minAmountPreservationRatio ?? DEFAULT_MIN_AMOUNT_PRESERVATION_RATIO;
  const drainCandidates = input.edges
    .filter((edge) => edgeAmount(edge) > 0n)
    .sort((a, b) => compareBigintDesc(edgeAmount(a), edgeAmount(b)))
    .slice(0, maxCandidates);
  const profiles: ApprovalDrainProvenanceProfile[] = [];
  const reviewFindings: ApprovalDrainReviewFinding[] = [];

  for (const drainEdge of drainCandidates) {
    const transactionInfo = await input.deps.getTransaction(drainEdge.txHash).catch(() => null);
    const resolution = resolveSpender({ transactionInfo, drainEdge });
    const baseFingerprints = supportingFingerprints({
      transactionInfo,
      drainEdge,
      resolution,
      amountPreservationRatio: null
    });
    if (!resolution.spenderAddress) {
      if (drainEdge.edgeType === "transfer_from") {
        reviewFindings.push({
          victimAddress: drainEdge.fromAddress,
          drainTxHash: drainEdge.txHash,
          spenderAddress: null,
          operatorAddress: resolution.operatorAddress,
          spenderResolution: resolution.spenderResolution,
          firstReceiverAddress: drainEdge.toAddress,
          subjectAddress: input.subjectAddress,
          reason: "spender_unknown",
          falsePositiveGuards: [],
          supportingFingerprints: baseFingerprints
        });
      }
      continue;
    }

    const approvalChanges = await input.deps.listTrc20ApprovalChanges({
      ownerAddress: drainEdge.fromAddress,
      spenderAddress: resolution.spenderAddress,
      contractAddress: TRON_USDT_CONTRACT_ADDRESS,
      start: 0,
      limit: approvalChangeLookupLimit
    }).catch(() => []);
    const approval = newestValidApproval(approvalChanges, {
      ownerAddress: drainEdge.fromAddress,
      spenderAddress: resolution.spenderAddress,
      drainAt: drainEdge.timestamp,
      drainAmountRaw: drainEdge.amountRaw
    });
    if (!approval) {
      if (drainEdge.edgeType === "transfer_from" || resolution.spenderResolution === "wrapper_contract") {
        reviewFindings.push({
          victimAddress: drainEdge.fromAddress,
          drainTxHash: drainEdge.txHash,
          spenderAddress: resolution.spenderAddress,
          operatorAddress: resolution.operatorAddress,
          spenderResolution: resolution.spenderResolution,
          firstReceiverAddress: drainEdge.toAddress,
          subjectAddress: input.subjectAddress,
          reason: "approval_not_found",
          falsePositiveGuards: [],
          supportingFingerprints: baseFingerprints
        });
      }
      continue;
    }

    const path = findPathFromReceiverToSubject({
      firstReceiverAddress: drainEdge.toAddress,
      subjectAddress: input.subjectAddress,
      drainAt: drainEdge.timestamp,
      drainAmount: edgeAmount(drainEdge),
      edges: input.edges,
      classifications: input.classifications,
      minAmountPreservationRatio
    });
    const guards = boundaryGuardsForPath({
      subjectAddress: input.subjectAddress,
      spenderAddress: resolution.spenderAddress,
      firstReceiverAddress: drainEdge.toAddress,
      pathEdges: path?.edges ?? [],
      classifications: input.classifications
    });
    if (!path || guards.length > 0) {
      reviewFindings.push({
        victimAddress: drainEdge.fromAddress,
        drainTxHash: drainEdge.txHash,
        spenderAddress: resolution.spenderAddress,
        operatorAddress: resolution.operatorAddress,
        spenderResolution: resolution.spenderResolution,
        firstReceiverAddress: drainEdge.toAddress,
        subjectAddress: input.subjectAddress,
        reason: guards.length > 0 ? "service_boundary_guard" : "path_not_proven",
        falsePositiveGuards: guards,
        supportingFingerprints: baseFingerprints
      });
      continue;
    }

    const score = scoreForHopDepth(path.hopDepth);
    const subjectTokenState = await resolveTokenState(input.deps, input.subjectAddress);
    const victimTokenState = await resolveTokenState(input.deps, drainEdge.fromAddress);
    const fingerprints = supportingFingerprints({
      transactionInfo,
      drainEdge,
      resolution,
      amountPreservationRatio: path.amountPreservationRatio
    });
    profiles.push({
      victimAddress: drainEdge.fromAddress,
      approvalTxHash: approval.txHash,
      drainTxHash: drainEdge.txHash,
      spenderAddress: resolution.spenderAddress,
      operatorAddress: resolution.operatorAddress,
      spenderResolution: resolution.spenderResolution,
      falsePositiveGuards: [],
      supportingFingerprints: fingerprints,
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

  const sortedProfiles = profiles.sort((a, b) =>
    b.score === a.score
      ? b.amountPreservationRatio - a.amountPreservationRatio
      : b.score - a.score
  );
  for (const profile of sortedProfiles) {
    profile.supportingFingerprints = [
      ...(profile.supportingFingerprints ?? []),
      ...clusterFingerprints(profile, sortedProfiles)
    ];
  }
  return { profiles: sortedProfiles, reviewFindings };
}

export async function buildApprovalDrainProvenanceProfiles(
  input: BuildApprovalDrainProvenanceInput
): Promise<ApprovalDrainProvenanceProfile[]> {
  return (await buildApprovalDrainProvenanceAnalysis(input)).profiles;
}

export async function buildApprovalDrainProvenanceProfile(
  input: BuildApprovalDrainProvenanceInput
): Promise<ApprovalDrainProvenanceProfile | null> {
  return (await buildApprovalDrainProvenanceProfiles(input))[0] ?? null;
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
