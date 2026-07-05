import { describe, expect, it } from "vitest";
import { selectCandidateWindowsForSourceProvenance } from "../../src/forensics/candidateWindowTargeting";
import type { MoneyOriginFundingSourceProvenance } from "../../src/types";

function provenance(overrides: Partial<MoneyOriginFundingSourceProvenance> = {}): MoneyOriginFundingSourceProvenance {
  return {
    mode: "source_provenance",
    targetTxHash: "hop-tx-1",
    targetFromAddress: "THop111111111111111111111111111111",
    targetToAddress: "TNext11111111111111111111111111111",
    targetTimestamp: "2026-07-04T12:00:00.000Z",
    targetAmountRaw: "100000000",
    proofClass: "probable",
    coveredAmountRaw: "96000000",
    coverageRatio: 0.96,
    amountContinuity: "strong",
    stopReason: "incoming_history_not_fetched",
    fundingBundle: {
      hopTxHash: "hop-tx-1",
      hopAddress: "THop111111111111111111111111111111",
      expectedAmountRaw: "100000000",
      coveredAmountRaw: "96000000",
      coverageRatio: 0.96,
      members: [
        {
          txHash: "candidate-new-large",
          fromAddress: "TFunder111111111111111111111111111",
          toAddress: "THop111111111111111111111111111111",
          originalAmountRaw: "70000000",
          usedAmountRaw: "70000000",
          spentBeforeHopRaw: "0",
          timestamp: "2026-07-04T11:59:00.000Z",
          coverageShare: 0.7
        },
        {
          txHash: "candidate-old-small",
          fromAddress: "TFunder222222222222222222222222222",
          toAddress: "THop111111111111111111111111111111",
          originalAmountRaw: "26000000",
          usedAmountRaw: "26000000",
          spentBeforeHopRaw: "0",
          timestamp: "2026-07-04T11:00:00.000Z",
          coverageShare: 0.26
        }
      ]
    },
    coverageWindow: {
      startTimestamp: "2026-07-04T11:00:00.000Z",
      endTimestamp: "2026-07-04T12:00:00.000Z",
      complete: false,
      capped: true,
      providerInconsistent: false
    },
    reasons: ["funding_bundle_amount_covered", "coverage_window_not_exact"],
    ...overrides
  };
}

describe("selectCandidateWindowsForSourceProvenance", () => {
  it("selects probable funding bundle members as ordered candidate windows", () => {
    const selected = selectCandidateWindowsForSourceProvenance({
      sourceProvenance: provenance(),
      maxWindowsPerHop: 5
    });

    expect(selected.map((item) => item.candidateTxHash)).toEqual([
      "candidate-new-large",
      "candidate-old-small"
    ]);
    expect(selected[0]).toMatchObject({
      address: "THop111111111111111111111111111111",
      targetTimestamp: new Date("2026-07-04T12:00:00.000Z"),
      windowStartTimestamp: new Date("2026-07-04T11:59:00.000Z"),
      windowEndTimestamp: new Date("2026-07-04T12:00:00.000Z"),
      relatedHopTxHash: "hop-tx-1",
      candidateTxHash: "candidate-new-large"
    });
  });

  it("returns no windows for exact or service-boundary provenance", () => {
    expect(selectCandidateWindowsForSourceProvenance({
      sourceProvenance: provenance({ proofClass: "exact", stopReason: null }),
      maxWindowsPerHop: 5
    })).toEqual([]);
    expect(selectCandidateWindowsForSourceProvenance({
      sourceProvenance: provenance({ proofClass: "service_boundary", stopReason: "service_boundary" }),
      maxWindowsPerHop: 5
    })).toEqual([]);
  });
});
