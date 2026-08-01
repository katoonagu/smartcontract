import { describe, expect, it } from "vitest";
import { buildWhereFundingCandidateVisibility } from "../../src/admin/whereFundingCandidateVisibility";

const subject = "TSubject111111111111111111111111111111";
const hop = "THop111111111111111111111111111111111";

function exactPath(input: {
  pathIndex?: number;
  targetTxHash?: string;
  hopAddress?: string;
  balanceShare?: number;
  members: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  const pathIndex = input.pathIndex ?? 0;
  const hopAddress = input.hopAddress ?? hop;
  const targetTxHash = input.targetTxHash ?? `tx-hop-${pathIndex}`;
  return {
    balanceShare: input.balanceShare ?? 0.1,
    pathAddresses: [hopAddress, subject],
    steps: [{
      txHash: targetTxHash,
      fromAddress: hopAddress,
      toAddress: subject,
      amountRaw: "1000000000",
      timestamp: "2026-07-04T12:00:00.000Z"
    }],
    sourceProvenance: [{
      mode: "source_provenance",
      targetTxHash,
      targetFromAddress: hopAddress,
      targetToAddress: subject,
      targetTimestamp: "2026-07-04T12:00:00.000Z",
      targetAmountRaw: "1000000000",
      proofClass: "exact",
      coverageRatio: 1,
      amountContinuity: "strong",
      stopReason: null,
      fundingBundle: {
        hopTxHash: targetTxHash,
        hopAddress,
        expectedAmountRaw: "1000000000",
        coveredAmountRaw: "1000000000",
        coverageRatio: 1,
        members: input.members
      }
    }]
  };
}

function member(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    txHash: `tx-funding-${index}`,
    fromAddress: `TFunder${String(index).padStart(2, "0")}111111111111111111111`,
    toAddress: hop,
    originalAmountRaw: String((index + 1) * 1000000),
    usedAmountRaw: String((index + 1) * 1000000),
    timestamp: "2026-07-04T11:59:00.000Z",
    coverageShare: (index + 1) / 100,
    ...overrides
  };
}

describe("buildWhereFundingCandidateVisibility", () => {
  it("selects exact source-provenance candidates attached to the route hop and ranks strongest first", () => {
    const result = buildWhereFundingCandidateVisibility({
      subjectAddress: subject,
      selectedAmountRaw: "9000000000",
      targetAmountRaw: "9000000000",
      existingFundingBundleHopTxHashes: new Set(),
      originPaths: [exactPath({
        members: [
          member(1, { usedAmountRaw: "2000000", coverageShare: 0.2 }),
          member(2, { usedAmountRaw: "8000000", coverageShare: 0.8 })
        ]
      })]
    });

    expect(result.summary).toMatchObject({
      exactTotalCount: 2,
      exactShownCount: 2,
      groupedHiddenCount: 0
    });
    expect(result.candidates.map((candidate) => candidate.fromAddress)).toEqual([
      "TFunder02111111111111111111111",
      "TFunder01111111111111111111111"
    ]);
    expect(result.candidates.every((candidate) => candidate.shouldRender)).toBe(true);
    expect(result.candidates[0]).toMatchObject({
      role: "exact_funding_candidate",
      proofClass: "exact",
      targetTxHash: "tx-hop-0",
      targetFromAddress: hop,
      targetToAddress: subject,
      visibilityReason: "selected_exact_funding_candidate"
    });
  });

  it("rejects candidates that happen after the target hop", () => {
    const result = buildWhereFundingCandidateVisibility({
      subjectAddress: subject,
      selectedAmountRaw: null,
      targetAmountRaw: null,
      existingFundingBundleHopTxHashes: new Set(),
      originPaths: [exactPath({
        members: [
          member(1, { timestamp: "2026-07-04T12:01:00.000Z" })
        ]
      })]
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.summary.exactTotalCount).toBe(0);
  });

  it("counts duplicate candidates already represented by fundingBundles but suppresses rendering them", () => {
    const result = buildWhereFundingCandidateVisibility({
      subjectAddress: subject,
      selectedAmountRaw: null,
      targetAmountRaw: null,
      existingFundingBundleHopTxHashes: new Set(["tx-hop-0"]),
      originPaths: [exactPath({ members: [member(1)] })]
    });

    expect(result.summary).toMatchObject({
      exactTotalCount: 1,
      exactShownCount: 0
    });
    expect(result.candidates).toEqual([
      expect.objectContaining({
        shouldRender: false,
        renderSuppressedReason: "duplicate_existing_funding_bundle"
      })
    ]);
  });

  it("caps exact candidates globally and groups hidden tails without dropping counts", () => {
    const paths = Array.from({ length: 6 }, (_, pathIndex) =>
      exactPath({
        pathIndex,
        hopAddress: `THop${pathIndex}111111111111111111111111111`,
        targetTxHash: `tx-hop-${pathIndex}`,
        members: Array.from({ length: 5 }, (_, memberIndex) =>
          member(pathIndex * 10 + memberIndex, {
            toAddress: `THop${pathIndex}111111111111111111111111111`
          })
        )
      })
    );

    const result = buildWhereFundingCandidateVisibility({
      subjectAddress: subject,
      selectedAmountRaw: "9000000000",
      targetAmountRaw: "9000000000",
      existingFundingBundleHopTxHashes: new Set(),
      originPaths: paths
    });

    expect(result.summary).toMatchObject({
      exactTotalCount: 30,
      exactShownCount: 20,
      groupedHiddenCount: 10
    });
    expect(result.candidates.filter((candidate) => candidate.shouldRender)).toHaveLength(20);
    expect(result.groups.reduce((sum, group) => sum + group.hiddenCount, 0)).toBe(10);
  });

  it("allows an important hop to exceed the per-hop soft cap inside the global cap", () => {
    const result = buildWhereFundingCandidateVisibility({
      subjectAddress: subject,
      selectedAmountRaw: "1000000000",
      targetAmountRaw: "1000000000",
      existingFundingBundleHopTxHashes: new Set(),
      originPaths: [exactPath({
        balanceShare: 0.6,
        members: Array.from({ length: 8 }, (_, index) => member(index))
      })]
    });

    expect(result.summary).toMatchObject({
      exactTotalCount: 8,
      exactShownCount: 8,
      groupedHiddenCount: 0
    });
  });

  it("caps probable candidates as context", () => {
    const probablePath = exactPath({
      members: Array.from({ length: 4 }, (_, index) => member(index))
    });
    const sourceProvenance = (probablePath.sourceProvenance as Record<string, unknown>[])[0];
    sourceProvenance.proofClass = "probable";
    sourceProvenance.stopReason = "incoming_history_not_fetched";

    const result = buildWhereFundingCandidateVisibility({
      subjectAddress: subject,
      selectedAmountRaw: null,
      targetAmountRaw: null,
      existingFundingBundleHopTxHashes: new Set(),
      originPaths: [probablePath]
    });

    expect(result.summary).toMatchObject({
      probableTotalCount: 4,
      probableShownCount: 2,
      groupedHiddenCount: 2
    });
    expect(result.candidates.filter((candidate) => candidate.shouldRender)).toEqual([
      expect.objectContaining({ role: "probable_funding_context" }),
      expect.objectContaining({ role: "probable_funding_context" })
    ]);
  });

  it("returns caveat facts for unresolved, pre-existing-balance, and service-boundary provenance", () => {
    const result = buildWhereFundingCandidateVisibility({
      subjectAddress: subject,
      selectedAmountRaw: null,
      targetAmountRaw: null,
      existingFundingBundleHopTxHashes: new Set(),
      originPaths: [{
        sourceProvenance: [
          { proofClass: "unresolved", targetTxHash: "tx-u", targetFromAddress: hop, targetToAddress: subject, stopReason: "funding_first_unresolved" },
          { proofClass: "pre_existing_balance_possible", targetTxHash: "tx-p", targetFromAddress: hop, targetToAddress: subject, stopReason: "pre_existing_balance_possible" },
          { proofClass: "service_boundary", targetTxHash: "tx-s", targetFromAddress: hop, targetToAddress: subject, stopReason: "service_boundary" }
        ]
      }]
    });

    expect(result.summary).toMatchObject({
      unresolvedCaveatCount: 1,
      preExistingBalanceCaveatCount: 1,
      serviceBoundaryCount: 1
    });
    expect(result.caveats.map((caveat) => caveat.role)).toEqual([
      "unresolved_source_caveat",
      "pre_existing_balance_caveat",
      "service_boundary"
    ]);
  });
});
