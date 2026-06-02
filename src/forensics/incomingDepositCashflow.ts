import type { ForensicRouteEdge, IncomingDepositFundingBundle } from "../types";

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

export type BuildFundingBundleForOutboundInput = {
  target: ForensicRouteEdge;
  edges: ForensicRouteEdge[];
  lookbackWindowMs: number;
  minCoverageRatio: number;
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

function safeTimestampMs(value: Date): number | null {
  const time = value.getTime();
  return Number.isFinite(time) ? time : null;
}

function clampedMinCoverage(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function compareChronological(left: ForensicRouteEdge, right: ForensicRouteEdge): number {
  const leftTime = safeTimestampMs(left.timestamp) ?? 0;
  const rightTime = safeTimestampMs(right.timestamp) ?? 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  const leftKey = `${left.txHash}:${left.fromAddress}:${left.toAddress}:${left.amountRaw}`;
  const rightKey = `${right.txHash}:${right.fromAddress}:${right.toAddress}:${right.amountRaw}`;
  return leftKey.localeCompare(rightKey);
}

function compareFunder(
  left: IncomingDepositFundingBundle["fundingFunders"][number],
  right: IncomingDepositFundingBundle["fundingFunders"][number]
): number {
  const leftAmount = parseRaw(left.amountRaw);
  const rightAmount = parseRaw(right.amountRaw);
  if (leftAmount !== rightAmount) return rightAmount > leftAmount ? 1 : -1;
  return left.address.localeCompare(right.address);
}

export function buildFundingBundleForOutbound(
  input: BuildFundingBundleForOutboundInput
): IncomingDepositFundingBundle | null {
  const targetAmount = parseRaw(input.target.amountRaw);
  const targetTimestampMs = safeTimestampMs(input.target.timestamp);
  if (targetAmount <= 0n || targetTimestampMs === null) return null;
  if (!Number.isFinite(input.lookbackWindowMs) || input.lookbackWindowMs <= 0) return null;

  const minCoverageRatio = clampedMinCoverage(input.minCoverageRatio);
  const windowStartMs = targetTimestampMs - input.lookbackWindowMs;
  const inboundCandidates = input.edges
    .filter((edge) => {
      if (edge.txHash === input.target.txHash) return false;
      if (edge.toAddress !== input.target.fromAddress) return false;
      const timestampMs = safeTimestampMs(edge.timestamp);
      if (timestampMs === null || timestampMs >= targetTimestampMs || timestampMs < windowStartMs) return false;
      return parseRaw(edge.amountRaw) > 0n;
    })
    .sort(compareChronological);

  const selected = inboundCandidates;
  const bundleAmount = selected.reduce((sum, edge) => sum + parseRaw(edge.amountRaw), 0n);
  if (bundleAmount <= 0n) return null;

  const coveredAmount = bundleAmount > targetAmount ? targetAmount : bundleAmount;
  const bundleCoverageRatio = ratio(coveredAmount, targetAmount);
  if (bundleCoverageRatio < minCoverageRatio) return null;

  const fundersByAddress = new Map<string, { amountRaw: bigint; txHashes: string[] }>();
  const fundingAddresses: string[] = [];
  for (const edge of selected) {
    if (!fundersByAddress.has(edge.fromAddress)) {
      fundersByAddress.set(edge.fromAddress, { amountRaw: 0n, txHashes: [] });
      fundingAddresses.push(edge.fromAddress);
    }
    const funder = fundersByAddress.get(edge.fromAddress);
    if (!funder) continue;
    funder.amountRaw += parseRaw(edge.amountRaw);
    funder.txHashes.push(edge.txHash);
  }

  return {
    targetTxHash: input.target.txHash,
    targetFromAddress: input.target.fromAddress,
    targetToAddress: input.target.toAddress,
    targetAmountRaw: input.target.amountRaw,
    bundleAmountRaw: bundleAmount.toString(),
    bundleCoverageRatio,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: input.target.timestamp.toISOString(),
    fundingTxHashes: selected.map((edge) => edge.txHash),
    fundingAddresses,
    fundingFunders: [...fundersByAddress.entries()]
      .map(([address, funder]) => ({
        address,
        amountRaw: funder.amountRaw.toString(),
        txHashes: funder.txHashes
      }))
      .sort(compareFunder)
  };
}

export function selectFundingBundleFundersForExpansion(input: {
  bundle: IncomingDepositFundingBundle;
  maxFunders: number;
}): string[] {
  const maxFunders = Number.isFinite(input.maxFunders)
    ? Math.max(0, Math.floor(input.maxFunders))
    : 0;
  return input.bundle.fundingFunders
    .slice(0, maxFunders)
    .map((funder) => funder.address);
}

export function selectIncomingDepositFundingCandidates(
  input: SelectIncomingDepositFundingCandidatesInput
): IncomingDepositFundingSelection {
  const depositAmount = parseRaw(input.depositAmountRaw);
  if (depositAmount <= 0n) {
    return { candidates: [], coverageRaw: "0", coverageRatio: 0, amountContinuity: "weak" };
  }

  const beforeDeposit = input.edges
    .filter((edge) =>
      edge.txHash === input.depositTxHash || edge.timestamp.getTime() < input.depositTimestamp.getTime()
    )
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
