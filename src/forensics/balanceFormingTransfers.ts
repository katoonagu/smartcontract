import type { BalanceFormingSelection, BalanceFormingTransfer, ForensicRouteEdge } from "../types";

export type SelectBalanceFormingTransfersInput = {
  subjectAddress: string;
  currentBalanceRaw: string | null;
  edges: ForensicRouteEdge[];
  minCoverageRatio?: number;
};

const DEFAULT_MIN_COVERAGE_RATIO = 0.95;

function parseAmount(value: string | null | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

function compareNewestFirst(left: ForensicRouteEdge, right: ForensicRouteEdge): number {
  const time = right.timestamp.getTime() - left.timestamp.getTime();
  if (time !== 0) return time;
  return right.txHash.localeCompare(left.txHash);
}

function selectionTransfer(edge: ForensicRouteEdge, currentBalanceRaw: bigint, coveredAmountRaw: bigint): BalanceFormingTransfer {
  return {
    txHash: edge.txHash,
    fromAddress: edge.fromAddress,
    toAddress: edge.toAddress,
    amountRaw: edge.amountRaw,
    timestamp: edge.timestamp.toISOString(),
    coverageShare: ratio(coveredAmountRaw, currentBalanceRaw),
    selectedReason: "covers_current_balance"
  };
}

export function selectBalanceFormingTransfers(input: SelectBalanceFormingTransfersInput): BalanceFormingSelection {
  const currentBalanceRaw = parseAmount(input.currentBalanceRaw);
  if (currentBalanceRaw <= 0n) {
    return {
      transfers: [],
      selectedVolumeRaw: "0",
      currentBalanceCoverageRatio: 0,
      partial: true,
      notes: ["Current USDT balance is zero or unavailable; balance-origin trace cannot prove source funds."]
    };
  }

  const selected: Array<{ edge: ForensicRouteEdge; coveredAmountRaw: bigint }> = [];
  let selectedVolumeRaw = 0n;
  let selectedCoverageRaw = 0n;
  const inbound = input.edges
    .filter((edge) => edge.toAddress === input.subjectAddress)
    .filter((edge) => parseAmount(edge.amountRaw) > 0n)
    .sort(compareNewestFirst);

  for (const edge of inbound) {
    if (selectedCoverageRaw >= currentBalanceRaw) break;
    const amountRaw = parseAmount(edge.amountRaw);
    const remainingRaw = currentBalanceRaw - selectedCoverageRaw;
    const coveredAmountRaw = amountRaw < remainingRaw ? amountRaw : remainingRaw;
    selected.push({ edge, coveredAmountRaw });
    selectedVolumeRaw += amountRaw;
    selectedCoverageRaw += coveredAmountRaw;
  }

  const coverageRatio = Math.min(1, ratio(selectedCoverageRaw, currentBalanceRaw));
  const minCoverageRatio = input.minCoverageRatio ?? DEFAULT_MIN_COVERAGE_RATIO;
  const partial = coverageRatio < minCoverageRatio;
  const notes = partial
    ? [`Selected inbound USDT transfers cover ${Math.round(coverageRatio * 100)}% of the current balance; balance-origin coverage is partial.`]
    : [];

  return {
    transfers: selected.map((item) => selectionTransfer(item.edge, currentBalanceRaw, item.coveredAmountRaw)),
    selectedVolumeRaw: selectedVolumeRaw.toString(),
    currentBalanceCoverageRatio: coverageRatio,
    partial,
    notes
  };
}
