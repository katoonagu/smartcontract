import type {
  BalanceFormingSelection,
  BalanceFormingTransfer,
  ForensicRouteEdge,
  MoneyOriginRecentFlowAnchor
} from "../types";
import { selectIncomingDepositFundingCandidates } from "./incomingDepositCashflow";

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

function outgoingAnchor(subjectAddress: string, edges: ForensicRouteEdge[]): ForensicRouteEdge | null {
  return (
    edges
      .filter((edge) => edge.fromAddress === subjectAddress)
      .filter((edge) => parseRaw(edge.amountRaw) >= BASE_SIGNIFICANT_RAW)
      .sort(newestFirst)[0] ?? null
  );
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
  return {
    txHash: edge.txHash,
    fromAddress: edge.fromAddress,
    toAddress: edge.toAddress,
    amountRaw: edge.amountRaw,
    timestamp: edge.timestamp.toISOString(),
    coverageShare: ratio(coveredRaw, denominatorRaw),
    selectedReason
  };
}

function emptySelection(input: SelectRecentFlowInput): BalanceFormingSelection {
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
    selectionMethod: "recent_large_inbound",
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

function selectRecentInboundFallback(input: SelectRecentFlowInput): BalanceFormingSelection {
  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const inboundEdges = input.edges
    .filter((edge) => edge.toAddress === input.subjectAddress)
    .filter((edge) => parseRaw(edge.amountRaw) > 0n)
    .sort(newestFirst);
  const candidates = inboundEdges
    .filter((edge) => parseRaw(edge.amountRaw) >= BASE_SIGNIFICANT_RAW)
    .slice(0, maxCandidates);
  if (candidates.length === 0) return emptySelection(input);

  const selectedAmountRaw = candidates.reduce((sum, edge) => sum + parseRaw(edge.amountRaw), 0n);

  return {
    transfers: candidates.map((edge) =>
      transferFromEdge(edge, selectedAmountRaw, parseRaw(edge.amountRaw), "recent_large_inbound")
    ),
    currentBalanceRaw: parseRaw(input.currentBalanceRaw).toString(),
    requestedAmountRaw: null,
    targetAmountRaw: selectedAmountRaw.toString(),
    selectedAmountRaw: selectedAmountRaw.toString(),
    coverageRatio: 1,
    selectedVolumeRaw: selectedAmountRaw.toString(),
    currentBalanceCoverageRatio: 0,
    partial: false,
    provenanceScope: "recent_flow",
    anchorTransfer: recentFlowAnchor(candidates[0], "inbound", "recent_significant_inbound_fallback"),
    dataScopeNote:
      "Low-balance recent-flow mode: selected recent significant inbound USDT history because no meaningful outgoing anchor was found.",
    selectionMethod: "recent_large_inbound",
    notes: ["Current USDT balance is below the low-balance threshold; recent significant inbound USDT history was selected."]
  };
}

export function selectRecentFlowProvenanceTransfers(input: SelectRecentFlowInput): BalanceFormingSelection {
  const anchorEdge = outgoingAnchor(input.subjectAddress, input.edges);
  if (anchorEdge) return selectForOutgoingAnchor(input, anchorEdge);
  return selectRecentInboundFallback(input);
}
