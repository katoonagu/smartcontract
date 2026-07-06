import { describe, expect, it } from "vitest";
import type { ForensicRouteEdge } from "../../src/types";
import { buildBalanceFormingSlice } from "../../src/forensics/balanceFormingSlice";

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

describe("buildBalanceFormingSlice", () => {
  it("uses prior incoming transfers even when they are days before the hop", () => {
    const sender = "TSender1111111111111111111111111111";
    const subject = "TSubject111111111111111111111111111";
    const cex = "TBybit11111111111111111111111111111";
    const target = edge("tx-hop", sender, subject, "10000000000", "2026-06-30T22:55:33.000Z");

    const result = buildBalanceFormingSlice({
      target,
      edges: [
        target,
        edge("tx-funding-five-days-earlier", cex, sender, "10000000000", "2026-06-25T10:00:00.000Z")
      ],
      minCoverageRatio: 0.95,
      maxFunders: 5,
      fetchedPageCount: 1,
      pageBudgetExhausted: false,
      providerCapHit: false,
      providerInconsistent: false
    });

    expect(result.status).toBe("covered");
    expect(result.coveredAmountRaw).toBe("10000000000");
    expect(result.coverageRatio).toBe(1);
    expect(result.fundingBundle?.members).toEqual([
      expect.objectContaining({
        edge: expect.objectContaining({
          txHash: "tx-funding-five-days-earlier",
          fromAddress: cex,
          toAddress: sender
        }),
        usedAmountRaw: "10000000000",
        spentBeforeHopRaw: "0"
      })
    ]);
  });

  it("uses the helper clamped coverage threshold for wrapper status", () => {
    const sender = "TSenderClamp111111111111111111111111";
    const subject = "TSubjectClamp11111111111111111111111";
    const cex = "TBybitClamp111111111111111111111111";
    const target = edge("tx-hop", sender, subject, "10000000000", "2026-06-30T22:55:33.000Z");

    const result = buildBalanceFormingSlice({
      target,
      edges: [
        target,
        edge("tx-funding", cex, sender, "10000000000", "2026-06-30T20:00:00.000Z")
      ],
      minCoverageRatio: 2,
      maxFunders: 5,
      fetchedPageCount: 1,
      pageBudgetExhausted: false,
      providerCapHit: false,
      providerInconsistent: false
    });

    expect(result.fundingBundle?.meetsThreshold).toBe(true);
    expect(result.status).toBe("covered");
    expect(result.reason).toBeNull();
  });

  it("subtracts outgoing spends before deciding an incoming transfer can fund the hop", () => {
    const sender = "TSender2222222222222222222222222222";
    const subject = "TSubject222222222222222222222222222";
    const funderOne = "TFunderOne222222222222222222222222";
    const funderTwo = "TFunderTwo222222222222222222222222";
    const target = edge("tx-hop", sender, subject, "10000000000", "2026-06-30T22:55:33.000Z");

    const result = buildBalanceFormingSlice({
      target,
      edges: [
        target,
        edge("tx-second-funding", funderTwo, sender, "6000000000", "2026-06-30T20:00:00.000Z"),
        edge("tx-spent-before-hop", sender, "TSpend222222222222222222222222222", "45000000000", "2026-06-30T19:00:00.000Z"),
        edge("tx-first-funding", funderOne, sender, "50000000000", "2026-06-30T18:00:00.000Z")
      ],
      minCoverageRatio: 0.95,
      maxFunders: 5,
      fetchedPageCount: 1,
      pageBudgetExhausted: false,
      providerCapHit: false,
      providerInconsistent: false
    });

    expect(result.status).toBe("covered");
    expect(result.coveredAmountRaw).toBe("10000000000");
    expect(result.fundingBundle?.members).toEqual([
      expect.objectContaining({
        edge: expect.objectContaining({ txHash: "tx-second-funding" }),
        usedAmountRaw: "6000000000",
        spentBeforeHopRaw: "0"
      }),
      expect.objectContaining({
        edge: expect.objectContaining({ txHash: "tx-first-funding" }),
        usedAmountRaw: "4000000000",
        spentBeforeHopRaw: "45000000000"
      })
    ]);
  });

  it("marks dense unresolved when page budget is exhausted before coverage", () => {
    const sender = "TDenseSender333333333333333333333333";
    const subject = "TSubject333333333333333333333333333";
    const target = edge("tx-hop", sender, subject, "10000000000", "2026-06-30T22:55:33.000Z");

    const result = buildBalanceFormingSlice({
      target,
      edges: [
        target,
        edge("tx-small-funding", "TFunder333333333333333333333333333", sender, "1000000000", "2026-06-30T22:40:00.000Z")
      ],
      minCoverageRatio: 0.95,
      maxFunders: 5,
      fetchedPageCount: 20,
      pageBudgetExhausted: true,
      providerCapHit: false,
      providerInconsistent: false
    });

    expect(result.status).toBe("dense_unresolved");
    expect(result.coveredAmountRaw).toBe("1000000000");
    expect(result.coverageRatio).toBe(0.1);
    expect(result.reason).toBe("balance_forming_slice_budget_exhausted");
    expect(result.providerCapHit).toBe(false);
  });

  it("separates provider cap from local page budget exhaustion", () => {
    const sender = "TDenseSender444444444444444444444444";
    const subject = "TSubject444444444444444444444444444";
    const target = edge("tx-hop", sender, subject, "10000000000", "2026-06-30T22:55:33.000Z");

    const result = buildBalanceFormingSlice({
      target,
      edges: [
        target,
        edge("tx-small-funding", "TFunder444444444444444444444444444", sender, "1000000000", "2026-06-30T22:40:00.000Z")
      ],
      minCoverageRatio: 0.95,
      maxFunders: 5,
      fetchedPageCount: 20,
      pageBudgetExhausted: false,
      providerCapHit: true,
      providerInconsistent: false
    });

    expect(result.status).toBe("dense_unresolved");
    expect(result.reason).toBe("balance_forming_slice_provider_cap");
  });
});
