import { describe, expect, it } from "vitest";
import type { ForensicRouteEdge, IncomingDepositFundingBundle } from "../../src/types";
import {
  buildFundingBundleForOutbound,
  selectFundingBundleFundersForExpansion,
  selectIncomingDepositFundingCandidates
} from "../../src/forensics/incomingDepositCashflow";

function edge(id: string, fromAddress: string, toAddress: string, amountRaw: string, timestamp: string): ForensicRouteEdge {
  return {
    id,
    txHash: id,
    fromAddress,
    toAddress,
    amountRaw,
    timestamp: new Date(timestamp),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

describe("selectIncomingDepositFundingCandidates", () => {
  it("uses sender cashflow before the deposit timestamp instead of current balance", () => {
    const sender = "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs";
    const watchedWallet = "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM";
    const contract = "TFcRN111111111111111111111111FLR5hvh";
    const other = "TOther111111111111111111111111111111";

    const result = selectIncomingDepositFundingCandidates({
      sender,
      watchedWallet,
      depositTxHash: "deposit",
      depositAmountRaw: "384064001319",
      depositTimestamp: new Date("2026-05-29T14:01:00.000Z"),
      edges: [
        edge("contract-in-1", contract, sender, "117568000000", "2026-05-29T13:30:00.000Z"),
        edge("contract-in-2", contract, sender, "37000000000", "2026-05-29T13:35:00.000Z"),
        edge("contract-in-3", contract, sender, "30045000000", "2026-05-29T13:40:00.000Z"),
        edge("other-in", other, sender, "250000000000", "2026-05-29T13:45:00.000Z"),
        edge("deposit", sender, watchedWallet, "384064001319", "2026-05-29T14:01:00.000Z")
      ]
    });

    expect(result.coverageRatio).toBeGreaterThan(0.9);
    expect(result.candidates.map((item) => item.edge.txHash)).toEqual([
      "other-in",
      "contract-in-3",
      "contract-in-2",
      "contract-in-1"
    ]);
    expect(result.amountContinuity).toBe("strong");
  });

  it("penalizes funding that was likely spent before the watched-wallet deposit", () => {
    const sender = "TSender111111111111111111111111111111";
    const watchedWallet = "TWatched1111111111111111111111111111";
    const funder = "TFunder111111111111111111111111111111";
    const sink = "TSink11111111111111111111111111111111";

    const result = selectIncomingDepositFundingCandidates({
      sender,
      watchedWallet,
      depositTxHash: "deposit",
      depositAmountRaw: "384000000000",
      depositTimestamp: new Date("2026-05-29T14:00:00.000Z"),
      edges: [
        edge("old-in", funder, sender, "500000000000", "2026-05-29T12:00:00.000Z"),
        edge("spent-before", sender, sink, "300000000000", "2026-05-29T13:00:00.000Z"),
        edge("new-in", funder, sender, "250000000000", "2026-05-29T13:30:00.000Z"),
        edge("deposit", sender, watchedWallet, "384000000000", "2026-05-29T14:00:00.000Z")
      ]
    });

    expect(result.candidates[0]?.edge.txHash).toBe("new-in");
    expect(result.candidates[1]).toMatchObject({
      edge: expect.objectContaining({ txHash: "old-in" }),
      spentBeforeDepositRaw: "300000000000"
    });
    expect(result.coverageRatio).toBe(1);
    expect(result.amountContinuity).toBe("strong");
  });

  it("keeps the unspent portion of partially consumed funding", () => {
    const sender = "TSender111111111111111111111111111111";
    const watchedWallet = "TWatched1111111111111111111111111111";
    const funder = "TFunder111111111111111111111111111111";
    const sink = "TSink11111111111111111111111111111111";

    const result = selectIncomingDepositFundingCandidates({
      sender,
      watchedWallet,
      depositTxHash: "deposit",
      depositAmountRaw: "384000000000",
      depositTimestamp: new Date("2026-05-29T14:00:00.000Z"),
      edges: [
        edge("large-in", funder, sender, "500000000000", "2026-05-29T12:00:00.000Z"),
        edge("spent-before", sender, sink, "100000000000", "2026-05-29T13:00:00.000Z"),
        edge("deposit", sender, watchedWallet, "384000000000", "2026-05-29T14:00:00.000Z")
      ]
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      usableAmountRaw: "384000000000",
      spentBeforeDepositRaw: "100000000000"
    });
    expect(result.coverageRatio).toBe(1);
    expect(result.amountContinuity).toBe("strong");
  });

  it("ignores same-timestamp non-anchor transfers because chain ordering is unavailable", () => {
    const sender = "TSender111111111111111111111111111111";
    const watchedWallet = "TWatched1111111111111111111111111111";
    const funder = "TFunder111111111111111111111111111111";

    const result = selectIncomingDepositFundingCandidates({
      sender,
      watchedWallet,
      depositTxHash: "deposit",
      depositAmountRaw: "90000000000",
      depositTimestamp: new Date("2026-05-29T14:00:00.000Z"),
      edges: [
        edge("in-before", funder, sender, "100000000000", "2026-05-29T13:55:00.000Z"),
        edge("same-timestamp-send", sender, "TOther11111111111111111111111111111", "50000000000", "2026-05-29T14:00:00.000Z"),
        edge("deposit", sender, watchedWallet, "90000000000", "2026-05-29T14:00:00.000Z")
      ]
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      usableAmountRaw: "90000000000",
      spentBeforeDepositRaw: "0"
    });
    expect(result.coverageRatio).toBe(1);
  });

  it("treats earlier sends to the same watched wallet as spent inventory without discarding the remainder", () => {
    const sender = "TSender111111111111111111111111111111";
    const watchedWallet = "TWatched1111111111111111111111111111";
    const funder = "TFunder111111111111111111111111111111";

    const result = selectIncomingDepositFundingCandidates({
      sender,
      watchedWallet,
      depositTxHash: "current-deposit",
      depositAmountRaw: "100000000000",
      depositTimestamp: new Date("2026-05-29T14:00:00.000Z"),
      edges: [
        edge("old-in", funder, sender, "150000000000", "2026-05-29T12:00:00.000Z"),
        edge("earlier-same-wallet-send", sender, watchedWallet, "90000000000", "2026-05-29T13:00:00.000Z"),
        edge("current-deposit", sender, watchedWallet, "100000000000", "2026-05-29T14:00:00.000Z")
      ]
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      usableAmountRaw: "60000000000",
      spentBeforeDepositRaw: "90000000000"
    });
    expect(result.coverageRatio).toBe(0.6);
    expect(result.amountContinuity).toBe("medium");
  });
});

describe("buildFundingBundleForOutbound", () => {
  it("records recent inbound liquidity that covers a large outbound transfer", () => {
    const corridorWallet = "TCorridor1111111111111111111111111111";
    const receiver = "TReceiver11111111111111111111111111111";
    const funderA = "TFunderA11111111111111111111111111111";
    const funderB = "TFunderB11111111111111111111111111111";
    const target = edge(
      "large-out",
      corridorWallet,
      receiver,
      "1960000000000",
      "2026-06-01T10:00:00.000Z"
    );

    const result = buildFundingBundleForOutbound({
      target,
      lookbackWindowMs: 6 * 60 * 60 * 1_000,
      minCoverageRatio: 0.95,
      edges: [
        edge("after-out", funderA, corridorWallet, "2000000000000", "2026-06-01T10:01:00.000Z"),
        edge("outside-window", funderA, corridorWallet, "500000000000", "2026-06-01T03:59:59.000Z"),
        edge("funding-1", funderA, corridorWallet, "700000000000", "2026-06-01T09:00:00.000Z"),
        edge("funding-2", funderB, corridorWallet, "900000000000", "2026-06-01T09:20:00.000Z"),
        edge("funding-3", funderA, corridorWallet, "358999000000", "2026-06-01T09:40:00.000Z"),
        target
      ]
    });

    expect(result).toEqual(expect.objectContaining({
      targetTxHash: "large-out",
      targetFromAddress: corridorWallet,
      targetToAddress: receiver,
      targetAmountRaw: "1960000000000",
      bundleAmountRaw: "1958999000000",
      bundleCoverageRatio: 0.9994,
      fundingTxHashes: ["funding-1", "funding-2", "funding-3"],
      fundingAddresses: [funderA, funderB]
    }));
    expect(result?.fundingFunders).toEqual([
      { address: funderA, amountRaw: "1058999000000", txHashes: ["funding-1", "funding-3"] },
      { address: funderB, amountRaw: "900000000000", txHashes: ["funding-2"] }
    ]);
  });

  it("keeps later funding window contributors after minimum coverage is reached", () => {
    const corridorWallet = "TCorridor1111111111111111111111111111";
    const receiver = "TReceiver11111111111111111111111111111";
    const funderA = "TFunderA11111111111111111111111111111";
    const funderB = "TFunderB11111111111111111111111111111";
    const target = edge(
      "large-out",
      corridorWallet,
      receiver,
      "1000000000000",
      "2026-06-01T10:00:00.000Z"
    );

    const result = buildFundingBundleForOutbound({
      target,
      lookbackWindowMs: 6 * 60 * 60 * 1_000,
      minCoverageRatio: 0.95,
      edges: [
        edge("funding-before-threshold", funderA, corridorWallet, "950000000000", "2026-06-01T09:00:00.000Z"),
        edge("later-large-funder", funderB, corridorWallet, "1500000000000", "2026-06-01T09:30:00.000Z"),
        target
      ]
    });

    expect(result).toEqual(expect.objectContaining({
      bundleAmountRaw: "2450000000000",
      bundleCoverageRatio: 1,
      fundingTxHashes: ["funding-before-threshold", "later-large-funder"]
    }));
    expect(result?.fundingFunders[0]).toEqual({
      address: funderB,
      amountRaw: "1500000000000",
      txHashes: ["later-large-funder"]
    });
  });

  it("clamps oversized bundle coverage to full target coverage", () => {
    const corridorWallet = "TCorridor1111111111111111111111111111";
    const receiver = "TReceiver11111111111111111111111111111";
    const funder = "TFunder111111111111111111111111111111";
    const target = edge(
      "large-out",
      corridorWallet,
      receiver,
      "1000000000000",
      "2026-06-01T10:00:00.000Z"
    );

    const result = buildFundingBundleForOutbound({
      target,
      lookbackWindowMs: 6 * 60 * 60 * 1_000,
      minCoverageRatio: 0.95,
      edges: [
        edge("oversized-funding", funder, corridorWallet, "2000000000000", "2026-06-01T09:00:00.000Z"),
        target
      ]
    });

    expect(result).toEqual(expect.objectContaining({
      bundleAmountRaw: "2000000000000",
      bundleCoverageRatio: 1,
      fundingTxHashes: ["oversized-funding"]
    }));
  });
});

describe("selectFundingBundleFundersForExpansion", () => {
  it("selects the top funding bundle funders in contribution order", () => {
    const bundle: IncomingDepositFundingBundle = {
      targetTxHash: "large-out",
      targetFromAddress: "TCorridor1111111111111111111111111111",
      targetToAddress: "TReceiver11111111111111111111111111111",
      targetAmountRaw: "1000000000000",
      bundleAmountRaw: "1200000000000",
      bundleCoverageRatio: 1,
      windowStart: "2026-06-01T04:00:00.000Z",
      windowEnd: "2026-06-01T10:00:00.000Z",
      fundingTxHashes: ["funding-1", "funding-2", "funding-3", "funding-4"],
      fundingAddresses: ["TFunderA", "TFunderB", "TFunderC", "TFunderD"],
      fundingFunders: [
        { address: "TFunderB", amountRaw: "500000000000", txHashes: ["funding-2"] },
        { address: "TFunderA", amountRaw: "300000000000", txHashes: ["funding-1"] },
        { address: "TFunderD", amountRaw: "150000000000", txHashes: ["funding-4"] },
        { address: "TFunderC", amountRaw: "100000000000", txHashes: ["funding-3"] }
      ]
    };

    expect(selectFundingBundleFundersForExpansion({ bundle, maxFunders: 3 })).toEqual([
      "TFunderB",
      "TFunderA",
      "TFunderD"
    ]);
  });
});
