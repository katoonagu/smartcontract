import { describe, expect, it } from "vitest";

import {
  evaluateFundingFirstSourceProvenance,
  FUNDING_FIRST_SOURCE_PROVENANCE_THRESHOLDS
} from "../../src/forensics/fundingFirstSourceProvenance";
import type { ForensicRouteEdge, MoneyOriginTraceHistoryCoverage } from "../../src/types";

function edge(
  txHash: string,
  fromAddress: string,
  toAddress: string,
  amountRaw: string,
  timestamp: string
): ForensicRouteEdge {
  return {
    id: txHash,
    txHash,
    fromAddress,
    toAddress,
    amountRaw,
    timestamp: new Date(timestamp),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function coverage(input: Partial<MoneyOriginTraceHistoryCoverage> = {}): MoneyOriginTraceHistoryCoverage {
  return {
    address: input.address ?? "TSender",
    targetTimestamp: input.targetTimestamp ?? "2026-07-01T10:00:00.000Z",
    fetchedTransferCount: input.fetchedTransferCount ?? 2,
    fetchedPageCount: input.fetchedPageCount ?? 1,
    oldestFetchedTransferAt: input.oldestFetchedTransferAt ?? "2026-07-01T09:00:00.000Z",
    reachedTargetHop: input.reachedTargetHop ?? true,
    source: input.source ?? "local_index",
    coverageComplete: input.coverageComplete,
    providerCapHit: input.providerCapHit,
    budgetExhausted: input.budgetExhausted,
    providerInconsistent: input.providerInconsistent,
    statusReason: input.statusReason
  };
}

describe("evaluateFundingFirstSourceProvenance", () => {
  it("classifies a fully covered funding bundle as exact source provenance", () => {
    const sender = "TSender";
    const subject = "TSubject";
    const funder = "TFunder";
    const target = edge("tx-hop", sender, subject, "100000000", "2026-07-01T10:00:00.000Z");
    const result = evaluateFundingFirstSourceProvenance({
      target,
      edges: [
        target,
        edge("tx-funding", funder, sender, "100000000", "2026-07-01T09:55:00.000Z")
      ],
      historyCoverage: coverage({ address: sender, coverageComplete: true }),
      minCoverageRatio: 0.95,
      maxFunders: 3
    });

    expect(result).toMatchObject({
      mode: "source_provenance",
      targetTxHash: "tx-hop",
      targetFromAddress: sender,
      targetToAddress: subject,
      targetAmountRaw: "100000000",
      proofClass: "exact",
      coveredAmountRaw: "100000000",
      coverageRatio: 1,
      amountContinuity: "strong",
      stopReason: null,
      coverageWindow: {
        startTimestamp: "2026-07-01T09:55:00.000Z",
        endTimestamp: "2026-07-01T10:00:00.000Z",
        complete: true,
        capped: false,
        providerInconsistent: false
      }
    });
    expect(result.fundingBundle?.members).toHaveLength(1);
    expect(result.reasons).toContain("funding_bundle_exact");
  });

  it("classifies a capped but amount-covered bundle as probable source provenance", () => {
    const sender = "TSender";
    const target = edge("tx-hop", sender, "TSubject", "100000000", "2026-07-01T10:00:00.000Z");
    const result = evaluateFundingFirstSourceProvenance({
      target,
      edges: [
        target,
        edge("tx-funding", "TFunder", sender, "100000000", "2026-07-01T09:55:00.000Z")
      ],
      historyCoverage: coverage({
        address: sender,
        coverageComplete: false,
        providerCapHit: true,
        statusReason: "partial_provider_cap"
      }),
      minCoverageRatio: 0.95,
      maxFunders: 3
    });

    expect(result.proofClass).toBe("probable");
    expect(result.coverageRatio).toBe(1);
    expect(result.coverageWindow).toMatchObject({
      complete: false,
      capped: true,
      providerInconsistent: false
    });
    expect(result.reasons).toEqual(expect.arrayContaining([
      "funding_bundle_amount_covered",
      "coverage_window_not_exact",
      "provider_cap_hit"
    ]));
  });

  it("distinguishes possible pre-existing balance from provider cap when reached history has no funding candidate", () => {
    const sender = "TSender";
    const target = edge("tx-hop", sender, "TSubject", "100000000", "2026-07-01T10:00:00.000Z");
    const result = evaluateFundingFirstSourceProvenance({
      target,
      edges: [target],
      historyCoverage: coverage({
        address: sender,
        coverageComplete: true,
        fetchedTransferCount: 1
      }),
      minCoverageRatio: 0.95,
      maxFunders: 3
    });

    expect(result).toMatchObject({
      proofClass: "pre_existing_balance_possible",
      coveredAmountRaw: "0",
      coverageRatio: 0,
      fundingBundle: null,
      stopReason: "pre_existing_balance_possible"
    });
    expect(result.reasons).toContain("no_funding_candidate_in_reached_history");
  });

  it("rejects a small hop as source proof for an orders-of-magnitude larger downstream amount", () => {
    const sender = "TSender";
    const target = edge("tx-hop", sender, "TSubject", "100000000", "2026-07-01T10:00:00.000Z");
    const downstreamAmountRaw = (
      100000000n * BigInt(FUNDING_FIRST_SOURCE_PROVENANCE_THRESHOLDS.hardBreakDownstreamToUpstreamRatio)
    ).toString();
    const result = evaluateFundingFirstSourceProvenance({
      target,
      downstreamAmountRaw,
      edges: [
        target,
        edge("tx-funding", "TFunder", sender, "100000000", "2026-07-01T09:55:00.000Z")
      ],
      historyCoverage: coverage({ address: sender, coverageComplete: true }),
      minCoverageRatio: 0.95,
      maxFunders: 3
    });

    expect(result).toMatchObject({
      proofClass: "unresolved",
      amountContinuity: "broken",
      stopReason: "amount_continuity_broken"
    });
    expect(result.reasons).toContain("downstream_amount_breaks_continuity");
  });
});
