import type { ForensicRouteEdge } from "../types";

export type IncomingDepositFundingCandidate = {
  edge: ForensicRouteEdge;
  usableAmountRaw: string;
  coverageRatio: number;
  spentBeforeDepositRaw: string;
};

export type IncomingDepositFundingSelection = {
  candidates: IncomingDepositFundingCandidate[];
  coverageRaw: string;
  coverageRatio: number;
  amountContinuity: "weak" | "medium" | "strong";
};

export type SelectIncomingDepositFundingCandidatesInput = {
  sender: string;
  watchedWallet: string;
  depositTxHash: string;
  depositAmountRaw: string;
  depositTimestamp: Date;
  edges: ForensicRouteEdge[];
};

function parseRaw(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number((numerator * 10_000n) / denominator) / 10_000;
}

function continuity(value: number): "weak" | "medium" | "strong" {
  if (value >= 0.85) return "strong";
  if (value >= 0.5) return "medium";
  return "weak";
}

export function selectIncomingDepositFundingCandidates(
  input: SelectIncomingDepositFundingCandidatesInput
): IncomingDepositFundingSelection {
  const depositAmount = parseRaw(input.depositAmountRaw);
  if (depositAmount <= 0n) {
    return { candidates: [], coverageRaw: "0", coverageRatio: 0, amountContinuity: "weak" };
  }

  const beforeDeposit = input.edges
    .filter((edge) => edge.timestamp.getTime() <= input.depositTimestamp.getTime())
    .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime());

  let spendOverhang = 0n;
  let remaining = depositAmount;
  const candidates: IncomingDepositFundingCandidate[] = [];

  for (const edge of beforeDeposit) {
    if (remaining <= 0n) break;
    if (edge.fromAddress === input.sender) {
      if (edge.txHash === input.depositTxHash) continue;
      spendOverhang += parseRaw(edge.amountRaw);
      continue;
    }
    if (edge.toAddress !== input.sender) continue;

    const amount = parseRaw(edge.amountRaw);
    const consumed = spendOverhang > amount ? amount : spendOverhang;
    spendOverhang -= consumed;
    const usable = amount - consumed;
    if (usable <= 0n) continue;

    const selected = usable > remaining ? remaining : usable;
    candidates.push({
      edge,
      usableAmountRaw: selected.toString(),
      coverageRatio: ratio(selected, depositAmount),
      spentBeforeDepositRaw: consumed.toString()
    });
    remaining -= selected;
  }

  const coverage = depositAmount - remaining;
  const coverageRatio = ratio(coverage, depositAmount);
  return {
    candidates,
    coverageRaw: coverage.toString(),
    coverageRatio,
    amountContinuity: continuity(coverageRatio)
  };
}
