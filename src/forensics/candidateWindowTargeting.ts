import type { MoneyOriginFundingSourceProvenance, WhereCandidateWindowRequest } from "../types";

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function amountBigint(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

export function selectCandidateWindowsForSourceProvenance(input: {
  sourceProvenance: MoneyOriginFundingSourceProvenance;
  maxWindowsPerHop: number;
}): WhereCandidateWindowRequest[] {
  const provenance = input.sourceProvenance;
  if (provenance.proofClass !== "probable") return [];
  const targetTimestamp = validDate(provenance.targetTimestamp);
  if (!targetTimestamp || !provenance.fundingBundle) return [];

  return provenance.fundingBundle.members
    .map((member): WhereCandidateWindowRequest | null => {
      const windowStartTimestamp = validDate(member.timestamp);
      if (!windowStartTimestamp) return null;
      if (windowStartTimestamp.getTime() > targetTimestamp.getTime()) return null;
      return {
        address: provenance.targetFromAddress,
        targetTimestamp,
        windowStartTimestamp,
        windowEndTimestamp: targetTimestamp,
        relatedHopTxHash: provenance.targetTxHash,
        candidateTxHash: member.txHash,
        requestedAmountRaw: provenance.targetAmountRaw,
        candidateAmountRaw: member.usedAmountRaw,
        coverageShare: member.coverageShare
      };
    })
    .filter((item): item is WhereCandidateWindowRequest => item !== null)
    .sort((left, right) => {
      const rightAmount = amountBigint(right.candidateAmountRaw);
      const leftAmount = amountBigint(left.candidateAmountRaw);
      if (rightAmount !== leftAmount) return rightAmount > leftAmount ? 1 : -1;
      return right.windowStartTimestamp.getTime() - left.windowStartTimestamp.getTime();
    })
    .slice(0, Math.max(0, Math.floor(input.maxWindowsPerHop)));
}
