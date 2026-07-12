import type {
  BalanceFormingSelection,
  BalanceFormingTransfer,
  CoverageExclusionV1,
  ForensicRouteEdge,
  MoneyOriginRecentFlowAnchor,
  RecentFlowPrincipalTransferV1
} from "../types";
import { selectIncomingDepositFundingCandidates } from "./incomingDepositCashflow";
import { isGasFreeServiceFeeEdge } from "./gasFreeSettlement";

const USDT_DECIMALS = 1_000_000n;
export const LOW_BALANCE_RECENT_FLOW_THRESHOLD_RAW = (1_000n * USDT_DECIMALS).toString();
const BASE_SIGNIFICANT_RAW = 1_000n * USDT_DECIMALS;
const MAX_DYNAMIC_SIGNIFICANT_RAW = 10_000n * USDT_DECIMALS;
const DEFAULT_MAX_CANDIDATES = 10;

export type SelectRecentFlowInput = {
  subjectAddress: string;
  currentBalanceRaw: string | null;
  edges: ForensicRouteEdge[];
  maxCandidates?: number;
  resolveEconomicContext?: (edge: ForensicRouteEdge) => Promise<ForensicRouteEdge>;
};

function parseRaw(value: string | null | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number((numerator * 10_000n) / denominator) / 10_000;
}

function newestFirst(left: ForensicRouteEdge, right: ForensicRouteEdge): number {
  const byTime = right.timestamp.getTime() - left.timestamp.getTime();
  if (byTime !== 0) return byTime;
  return right.txHash.localeCompare(left.txHash);
}

function recentFlowAnchor(
  edge: ForensicRouteEdge,
  direction: MoneyOriginRecentFlowAnchor["direction"],
  reason: MoneyOriginRecentFlowAnchor["reason"]
): MoneyOriginRecentFlowAnchor {
  return {
    txHash: edge.txHash,
    direction,
    fromAddress: edge.fromAddress,
    toAddress: edge.toAddress,
    amountRaw: edge.amountRaw,
    timestamp: edge.timestamp.toISOString(),
    reason
  };
}

function involvesSubject(subjectAddress: string, edge: ForensicRouteEdge): boolean {
  return edge.fromAddress === subjectAddress || edge.toAddress === subjectAddress;
}

function normalizedMaxCandidates(input: SelectRecentFlowInput): number {
  if (input.edges.length === 0) return 0;
  const requested = input.maxCandidates;
  if (!Number.isSafeInteger(requested) || (requested ?? 0) <= 0) {
    return Math.min(DEFAULT_MAX_CANDIDATES, input.edges.length);
  }
  return Math.min(requested as number, input.edges.length);
}

function principalTransfer(subjectAddress: string, edge: ForensicRouteEdge): RecentFlowPrincipalTransferV1 {
  return {
    txHash: edge.txHash,
    fromAddress: edge.fromAddress,
    toAddress: edge.toAddress,
    direction: edge.toAddress === subjectAddress ? "incoming" : "outgoing",
    amountRaw: edge.amountRaw,
    timestamp: edge.timestamp.toISOString(),
    economicRole: "principal"
  };
}

function exactFeeExclusion(subjectAddress: string, edges: ForensicRouteEdge[]): CoverageExclusionV1[] {
  if (edges.length === 0) return [];
  const direction = edges.every((edge) => edge.fromAddress === subjectAddress)
    ? "outgoing"
    : edges.every((edge) => edge.toAddress === subjectAddress)
      ? "incoming"
      : null;
  return [{
    reason: "exact_gasfree_service_fee",
    direction,
    txCount: edges.length,
    amountRaw: edges.reduce((sum, edge) => sum + parseRaw(edge.amountRaw), 0n).toString(),
    evidenceIds: edges.map((edge) => edge.id)
  }];
}

function differentScopeExclusion(edges: ForensicRouteEdge[]): CoverageExclusionV1[] {
  if (edges.length === 0) return [];
  return [{
    reason: "different_selected_scope",
    direction: "incoming",
    txCount: edges.length,
    amountRaw: edges.reduce((sum, edge) => sum + parseRaw(edge.amountRaw), 0n).toString(),
    evidenceIds: edges.map((edge) => edge.id)
  }];
}

function dynamicSignificantThreshold(anchorAmountRaw: bigint): bigint {
  const fivePercent = anchorAmountRaw / 20n;
  if (fivePercent < BASE_SIGNIFICANT_RAW) return BASE_SIGNIFICANT_RAW;
  if (fivePercent > MAX_DYNAMIC_SIGNIFICANT_RAW) return MAX_DYNAMIC_SIGNIFICANT_RAW;
  return fivePercent;
}

function transferFromEdge(
  edge: ForensicRouteEdge,
  denominatorRaw: bigint,
  coveredRaw: bigint,
  selectedReason: BalanceFormingTransfer["selectedReason"]
): BalanceFormingTransfer {
  const coverageShare = ratio(coveredRaw, denominatorRaw);
  return {
    evidenceId: edge.id,
    txHash: edge.txHash,
    fromAddress: edge.fromAddress,
    toAddress: edge.toAddress,
    amountRaw: edge.amountRaw,
    timestamp: edge.timestamp.toISOString(),
    coverageShare,
    selectedReason,
    amountUsage: {
      anchorAmountRaw: denominatorRaw.toString(),
      originalAmountRaw: edge.amountRaw,
      usedAmountRaw: coveredRaw.toString(),
      coverageShare,
      role: selectedReason === "funds_recent_outgoing" ? "funding_candidate" : "anchor"
    }
  };
}

function emptySelection(
  input: SelectRecentFlowInput,
  exactFees: ForensicRouteEdge[] = []
): BalanceFormingSelection {
  return {
    transfers: [],
    currentBalanceRaw: parseRaw(input.currentBalanceRaw).toString(),
    requestedAmountRaw: null,
    targetAmountRaw: "0",
    selectedAmountRaw: "0",
    coverageRatio: 0,
    selectedVolumeRaw: "0",
    currentBalanceCoverageRatio: 0,
    partial: true,
    provenanceScope: "recent_flow",
    anchorTransfer: null,
    dataScopeNote: "Low-balance recent-flow mode found no meaningful recent USDT flow.",
    recentFlowPrincipalTransfers: [],
    principalActivity: "none",
    coverageExclusions: exactFeeExclusion(input.subjectAddress, exactFees),
    availableInboundTxCount: exactFees.filter((edge) => edge.toAddress === input.subjectAddress).length,
    selectionMethod: "recent_five_principal",
    notes: ["Current USDT balance is below the low-balance threshold; no meaningful recent USDT flow was found."]
  };
}

function selectForOutgoingAnchor(input: SelectRecentFlowInput, anchorEdge: ForensicRouteEdge): BalanceFormingSelection {
  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const targetRaw = parseRaw(anchorEdge.amountRaw);
  const minSignificantRaw = dynamicSignificantThreshold(targetRaw);
  const selection = selectIncomingDepositFundingCandidates({
    sender: input.subjectAddress,
    watchedWallet: anchorEdge.toAddress,
    depositTxHash: anchorEdge.txHash,
    depositAmountRaw: anchorEdge.amountRaw,
    depositTimestamp: anchorEdge.timestamp,
    edges: input.edges
  });
  const strongCandidates = selection.candidates.filter((item) => parseRaw(item.edge.amountRaw) >= minSignificantRaw);
  const strongSelectedRaw = strongCandidates.reduce((sum, item) => sum + parseRaw(item.usableAmountRaw), 0n);
  const baseCandidates = strongSelectedRaw > 0n && ratio(strongSelectedRaw, targetRaw) >= 0.8 ? strongCandidates : selection.candidates;
  const candidates = baseCandidates.slice(0, maxCandidates);
  const selectedAmountRaw = candidates.reduce((sum, item) => sum + parseRaw(item.usableAmountRaw), 0n);
  const coverageRatio = ratio(selectedAmountRaw, targetRaw);

  return {
    transfers: candidates.map((item) =>
      transferFromEdge(item.edge, targetRaw, parseRaw(item.usableAmountRaw), "funds_recent_outgoing")
    ),
    currentBalanceRaw: parseRaw(input.currentBalanceRaw).toString(),
    requestedAmountRaw: null,
    targetAmountRaw: targetRaw.toString(),
    selectedAmountRaw: selectedAmountRaw.toString(),
    coverageRatio,
    selectedVolumeRaw: selectedAmountRaw.toString(),
    currentBalanceCoverageRatio: 0,
    partial: coverageRatio < 0.8,
    provenanceScope: "recent_flow",
    anchorTransfer: recentFlowAnchor(anchorEdge, "outgoing", "latest_meaningful_outgoing"),
    dataScopeNote:
      "Low-balance recent-flow mode: selected funding candidates for the latest meaningful outgoing USDT transfer.",
    selectionMethod: "recent_outgoing",
    notes: [
      "Current USDT balance is below the low-balance threshold; recent-flow provenance analyzed latest meaningful outgoing USDT flow.",
      `Recent-flow funding candidates cover ${Math.round(coverageRatio * 100)}% of the outgoing anchor.`
    ]
  };
}

async function resolveBoundedRecentEdges(input: SelectRecentFlowInput, maxCandidates: number): Promise<{
  checkedEdges: ForensicRouteEdge[];
  principalSlice: ForensicRouteEdge[];
  exactFees: ForensicRouteEdge[];
  largeOutgoingAnchor: ForensicRouteEdge | null;
}> {
  const sortedEdges = input.edges
    .filter((edge) => involvesSubject(input.subjectAddress, edge))
    .filter((edge) => parseRaw(edge.amountRaw) > 0n)
    .sort(newestFirst);
  const resolvedById = new Map<string, ForensicRouteEdge>();
  const exactFees: ForensicRouteEdge[] = [];
  const exactFeeIds = new Set<string>();
  const rememberExactFee = (edge: ForensicRouteEdge): void => {
    if (!isGasFreeServiceFeeEdge(edge) || exactFeeIds.has(edge.id)) return;
    exactFeeIds.add(edge.id);
    exactFees.push(edge);
  };
  const resolve = async (edge: ForensicRouteEdge): Promise<ForensicRouteEdge> => {
    const existing = resolvedById.get(edge.id);
    if (existing) return existing;
    if (isGasFreeServiceFeeEdge(edge)) {
      resolvedById.set(edge.id, edge);
      rememberExactFee(edge);
      return edge;
    }
    const resolved = input.resolveEconomicContext ? await input.resolveEconomicContext(edge) : edge;
    resolvedById.set(edge.id, resolved);
    rememberExactFee(resolved);
    return resolved;
  };

  let largeOutgoingAnchor: ForensicRouteEdge | null = null;
  for (const candidate of sortedEdges) {
    if (candidate.fromAddress !== input.subjectAddress || parseRaw(candidate.amountRaw) < BASE_SIGNIFICANT_RAW) continue;
    const resolved = await resolve(candidate);
    if (!isGasFreeServiceFeeEdge(resolved)) {
      largeOutgoingAnchor = resolved;
      break;
    }
  }
  if (largeOutgoingAnchor) {
    for (const edge of sortedEdges.slice(0, maxCandidates)) await resolve(edge);
    return {
      checkedEdges: sortedEdges.map((edge) => resolvedById.get(edge.id) ?? edge),
      principalSlice: [],
      exactFees,
      largeOutgoingAnchor
    };
  }

  const checkedEdges = sortedEdges.slice(0, maxCandidates);
  const principalSlice: ForensicRouteEdge[] = [];
  const resolvedEdges: ForensicRouteEdge[] = [];
  for (const edge of checkedEdges) {
    const resolved = await resolve(edge);
    resolvedEdges.push(resolved);
    if (isGasFreeServiceFeeEdge(resolved)) continue;
    principalSlice.push(resolved);
    if (principalSlice.length === 5) break;
  }
  return { checkedEdges: resolvedEdges, principalSlice, exactFees, largeOutgoingAnchor: null };
}

function selectFivePrincipal(
  input: SelectRecentFlowInput,
  principalSlice: ForensicRouteEdge[],
  exactFees: ForensicRouteEdge[]
): BalanceFormingSelection {
  if (principalSlice.length === 0) return emptySelection(input, exactFees);
  const newestOutgoingIndex = principalSlice.findIndex((edge) => edge.fromAddress === input.subjectAddress);
  const newestOutgoing = newestOutgoingIndex >= 0 ? principalSlice[newestOutgoingIndex] : null;
  const fundingCandidates = newestOutgoing
    ? principalSlice.slice(newestOutgoingIndex + 1).filter((edge) => edge.toAddress === input.subjectAddress)
    : principalSlice.filter((edge) => edge.toAddress === input.subjectAddress);
  const targetRaw = newestOutgoing
    ? parseRaw(newestOutgoing.amountRaw)
    : fundingCandidates.reduce((sum, edge) => sum + parseRaw(edge.amountRaw), 0n);
  const selectedReason: BalanceFormingTransfer["selectedReason"] = newestOutgoing
    ? "funds_recent_outgoing"
    : "recent_large_inbound";
  let coveredRaw = 0n;
  const transfers: BalanceFormingTransfer[] = [];
  for (const edge of fundingCandidates) {
    if (targetRaw > 0n && coveredRaw >= targetRaw) break;
    const amountRaw = parseRaw(edge.amountRaw);
    const remainingRaw = targetRaw > coveredRaw ? targetRaw - coveredRaw : 0n;
    const usedRaw = amountRaw < remainingRaw ? amountRaw : remainingRaw;
    coveredRaw += usedRaw;
    transfers.push(transferFromEdge(edge, targetRaw, usedRaw, selectedReason));
  }
  const selectedEvidenceIds = new Set(transfers.map((transfer) => transfer.evidenceId));
  const unselectedInbound = principalSlice.filter((edge) =>
    edge.toAddress === input.subjectAddress && !selectedEvidenceIds.has(edge.id)
  );
  const selectedRaw = coveredRaw;
  const coverageRatio = ratio(selectedRaw, targetRaw);

  return {
    transfers,
    currentBalanceRaw: parseRaw(input.currentBalanceRaw).toString(),
    requestedAmountRaw: null,
    targetAmountRaw: targetRaw.toString(),
    selectedAmountRaw: selectedRaw.toString(),
    coverageRatio,
    selectedVolumeRaw: selectedRaw.toString(),
    currentBalanceCoverageRatio: 0,
    partial: targetRaw === 0n || coverageRatio < 0.8,
    provenanceScope: "recent_flow",
    anchorTransfer: newestOutgoing
      ? recentFlowAnchor(newestOutgoing, "outgoing", "latest_meaningful_outgoing")
      : null,
    dataScopeNote: newestOutgoing
      ? "Low-balance recent-flow mode: selected earlier inbound funding for the newest outgoing transfer in the five-transfer principal slice."
      : "Low-balance recent-flow mode: selected inbound transfers from the five-transfer principal slice.",
    recentFlowPrincipalTransfers: principalSlice.map((edge) => principalTransfer(input.subjectAddress, edge)),
    principalActivity: "present",
    coverageExclusions: [
      ...exactFeeExclusion(input.subjectAddress, exactFees),
      ...differentScopeExclusion(unselectedInbound)
    ],
    availableInboundTxCount: transfers.length + unselectedInbound.length +
      exactFees.filter((edge) => edge.toAddress === input.subjectAddress).length,
    selectionMethod: "recent_five_principal",
    notes: ["Current USDT balance is below the low-balance threshold; the five newest principal USDT transfers were inspected."]
  };
}

export async function selectRecentFlowProvenanceTransfers(
  input: SelectRecentFlowInput
): Promise<BalanceFormingSelection> {
  const maxCandidates = normalizedMaxCandidates(input);
  const resolved = await resolveBoundedRecentEdges(input, maxCandidates);
  if (resolved.largeOutgoingAnchor) {
    const selection = selectForOutgoingAnchor(
      {
        ...input,
        maxCandidates,
        edges: resolved.checkedEdges.filter((edge) => !isGasFreeServiceFeeEdge(edge))
      },
      resolved.largeOutgoingAnchor
    );
    const selectedEvidenceIds = new Set(selection.transfers.map((transfer) => transfer.evidenceId));
    const unselectedInbound = resolved.checkedEdges.filter((edge) =>
      edge.toAddress === input.subjectAddress &&
      !isGasFreeServiceFeeEdge(edge) &&
      !selectedEvidenceIds.has(edge.id)
    );
    return {
      ...selection,
      availableInboundTxCount: resolved.checkedEdges.filter((edge) => edge.toAddress === input.subjectAddress).length,
      coverageExclusions: [
        ...exactFeeExclusion(input.subjectAddress, resolved.exactFees),
        ...differentScopeExclusion(unselectedInbound)
      ]
    };
  }
  return selectFivePrincipal(input, resolved.principalSlice, resolved.exactFees);
}
