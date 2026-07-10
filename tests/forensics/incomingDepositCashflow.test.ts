import { describe, expect, it } from "vitest";
import type { ForensicRouteEdge, IncomingDepositFundingBundle } from "../../src/types";
import {
  buildFundingBundleForTraceHop,
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

function gasFreePrincipal(value: ForensicRouteEdge): ForensicRouteEdge {
  return { ...value, economicRole: "principal", economicProtocol: "tron_gasfree" };
}

function gasFreeFee(value: ForensicRouteEdge): ForensicRouteEdge {
  return { ...value, economicRole: "service_fee", economicProtocol: "tron_gasfree" };
}

describe("selectIncomingDepositFundingCandidates", () => {
  it("does not select an inbound exact GasFree fee as payer provenance", () => {
    const sender = "TSender111111111111111111111111111111";
    const watchedWallet = "TWatched1111111111111111111111111111";

    const result = selectIncomingDepositFundingCandidates({
      sender,
      watchedWallet,
      depositTxHash: "deposit",
      depositAmountRaw: "3000000",
      depositTimestamp: new Date("2026-07-10T00:05:00.000Z"),
      edges: [
        gasFreeFee(edge("exact-fee-in", "TGasFreeAccount", sender, "3000000", "2026-07-10T00:00:00.000Z")),
        edge("deposit", sender, watchedWallet, "3000000", "2026-07-10T00:05:00.000Z")
      ]
    });

    expect(result).toMatchObject({
      candidates: [],
      coverageRaw: "0",
      coverageRatio: 0,
      amountContinuity: "weak"
    });
  });

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
  it("does not treat an exact GasFree fee as inbound corridor funding", () => {
    const corridorWallet = "TCorridor1111111111111111111111111111";
    const target = edge("large-out", corridorWallet, "TReceiver", "3000000", "2026-07-10T00:05:00.000Z");

    const result = buildFundingBundleForOutbound({
      target,
      lookbackWindowMs: 60 * 60 * 1_000,
      minCoverageRatio: 0.95,
      edges: [
        gasFreeFee(edge("exact-fee-in", "TGasFreeAccount", corridorWallet, "3000000", "2026-07-10T00:00:00.000Z")),
        target
      ]
    });

    expect(result).toBeNull();
  });

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

describe("trace hop funding bundles", () => {
  it("keeps an exact outgoing GasFree fee in spend-before-hop arithmetic", () => {
    const gasFreeAccount = "TGasFreeAccount";
    const target = gasFreePrincipal(edge(
      "principal-out",
      gasFreeAccount,
      "TReceiver",
      "97000000",
      "2026-07-10T00:05:00.000Z"
    ));

    const bundle = buildFundingBundleForTraceHop({
      target,
      edges: [
        edge("funding-in", "TFunder", gasFreeAccount, "100000000", "2026-07-10T00:00:00.000Z"),
        gasFreeFee(edge("service-fee-out", gasFreeAccount, "TFeeCollector", "3000000", "2026-07-10T00:01:00.000Z")),
        target
      ],
      minCoverageRatio: 1,
      maxFunders: 3
    });

    expect(bundle?.members).toEqual([
      expect.objectContaining({
        edge: expect.objectContaining({ txHash: "funding-in" }),
        usedAmountRaw: "97000000",
        spentBeforeHopRaw: "3000000"
      })
    ]);
  });

  it("does not treat an exact GasFree fee as trace-hop funding", () => {
    const target = edge("target-out", "TCorridor", "TReceiver", "3000000", "2026-07-10T00:05:00.000Z");

    expect(buildFundingBundleForTraceHop({
      target,
      edges: [
        gasFreeFee(edge("exact-fee-in", "TGasFreeAccount", "TCorridor", "3000000", "2026-07-10T00:00:00.000Z")),
        target
      ],
      minCoverageRatio: 0.95,
      maxFunders: 3
    })).toBeNull();
  });

  it("builds a multi-input bundle by usable contribution", () => {
    const target = edge(
      "out-850k",
      "TV3H25",
      "TNext",
      "850000000000",
      "2026-04-21T12:37:30.000Z"
    );

    const bundle = buildFundingBundleForTraceHop({
      target,
      edges: [
        edge("in-85k", "TKHS", "TV3H25", "85013000000", "2026-04-21T12:16:51.000Z"),
        edge("in-39k", "TRTr", "TV3H25", "39116000000", "2026-04-21T12:18:03.000Z"),
        edge("in-100", "TFyj", "TV3H25", "100000000", "2026-04-21T12:25:39.000Z"),
        edge("in-600k", "TF6y", "TV3H25", "600000000000", "2026-04-21T12:27:48.000Z"),
        edge("in-80k", "TFyj", "TV3H25", "80500000000", "2026-04-21T12:33:51.000Z")
      ],
      minCoverageRatio: 0.8,
      maxFunders: 3
    });

    expect(bundle).not.toBeNull();
    expect(bundle?.coverageRatio).toBeGreaterThanOrEqual(0.8);
    expect(bundle?.members.map((member) => member.edge.txHash)).toEqual(["in-80k", "in-600k"]);
    expect(bundle?.funders.map((funder) => funder.address)).toEqual(["TF6y", "TFyj"]);
  });

  it("returns weak coverage with candidates when the bundle is below threshold", () => {
    const target = edge(
      "out-850k",
      "TV3H25",
      "TNext",
      "850000000000",
      "2026-04-21T12:37:30.000Z"
    );

    const bundle = buildFundingBundleForTraceHop({
      target,
      edges: [
        edge("in-39k", "TRTr", "TV3H25", "39116000000", "2026-04-21T12:18:03.000Z")
      ],
      minCoverageRatio: 0.8,
      maxFunders: 3
    });

    expect(bundle).toMatchObject({
      meetsThreshold: false,
      coveredAmountRaw: "39116000000"
    });
  });

  it("excludes inbound liquidity that was already spent before the traced hop", () => {
    const corridorWallet = "TCorridor1111111111111111111111111111";
    const target = edge(
      "target-out",
      corridorWallet,
      "TNext",
      "850",
      "2026-04-21T12:30:00.000Z"
    );

    const bundle = buildFundingBundleForTraceHop({
      target,
      edges: [
        edge("old-in", "TOldFunder", corridorWallet, "1000", "2026-04-21T12:00:00.000Z"),
        edge("spent-out", corridorWallet, "TSink", "1000", "2026-04-21T12:10:00.000Z"),
        edge("new-in", "TNewFunder", corridorWallet, "700", "2026-04-21T12:20:00.000Z"),
        target
      ],
      minCoverageRatio: 0.9,
      maxFunders: 3
    });

    expect(bundle).toMatchObject({
      coveredAmountRaw: "700",
      coverageRatio: 0.8235,
      meetsThreshold: false
    });
    expect(bundle?.members.map((member) => member.edge.txHash)).toEqual(["new-in"]);
  });

  it("uses only the unspent portion of partially consumed prior inbound liquidity", () => {
    const corridorWallet = "TCorridor1111111111111111111111111111";
    const target = edge(
      "target-out",
      corridorWallet,
      "TNext",
      "850",
      "2026-04-21T12:30:00.000Z"
    );

    const bundle = buildFundingBundleForTraceHop({
      target,
      edges: [
        edge("old-in", "TOldFunder", corridorWallet, "1000", "2026-04-21T12:00:00.000Z"),
        edge("spent-out", corridorWallet, "TSink", "600", "2026-04-21T12:10:00.000Z"),
        target
      ],
      minCoverageRatio: 0.9,
      maxFunders: 3
    });

    expect(bundle).toMatchObject({
      coveredAmountRaw: "400",
      meetsThreshold: false
    });
    expect(bundle?.members).toEqual([
      expect.objectContaining({
        edge: expect.objectContaining({ txHash: "old-in" }),
        usedAmountRaw: "400",
        spentBeforeHopRaw: "600"
      })
    ]);
  });
});
