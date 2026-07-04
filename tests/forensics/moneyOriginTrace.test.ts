import { describe, expect, it } from "vitest";
import { repairFundingSourceExactWindow } from "../../src/forensics/fundingFirstSourceProvenance";
import { traceMoneyOriginPath } from "../../src/forensics/moneyOriginTrace";
import { baseShareScore } from "../../src/forensics/provenanceScoring";
import type { AddressLabel, BalanceFormingTransfer, ForensicRouteEdge, ServiceClassification } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const walletB = "TWalletB1111111111111111111111111111";
const walletC = "TWalletC1111111111111111111111111111";
const walletD = "TWalletD1111111111111111111111111111";
const cleanHop = "TCleanHop11111111111111111111111111";
const htx = "THTX111111111111111111111111111111";
const binance = "TBinance111111111111111111111111111";
const bridge = "TBridge1111111111111111111111111111";
const whitebit = "TWhiteBIT11111111111111111111111111";

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

function balanceTransfer(fromAddress: string, txHash = "tx-balance"): BalanceFormingTransfer {
  return {
    txHash,
    fromAddress,
    toAddress: subject,
    amountRaw: "5000000000",
    timestamp: "2026-05-22T10:15:00.000Z",
    coverageShare: 1,
    selectedReason: "covers_current_balance"
  };
}

function service(category: ServiceClassification["category"], identity: string | null): ServiceClassification {
  return {
    category,
    identity,
    confidence: "high",
    evidence: identity ? [`tag:${identity}`] : [],
    isBoundary: category !== "none"
  };
}

function whitebitLabel(): AddressLabel {
  return {
    address: whitebit,
    label: "whitebit",
    source: "service_admin",
    createdByTelegramId: "1",
    createdAt: new Date("2026-05-01T00:00:00.000Z")
  };
}

describe("traceMoneyOriginPath", () => {
  it("accepts a clean multi-hop EOA chain from an allowlisted CEX", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [walletD, [edge("tx-c-d", walletC, walletD, "5000000000", "2026-05-22T10:10:00.000Z")]],
      [walletC, [edge("tx-b-c", walletB, walletC, "5000000000", "2026-05-22T10:05:00.000Z")]],
      [walletB, [edge("tx-binance-b", binance, walletB, "5000000000", "2026-05-22T10:00:00.000Z")]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(walletD),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "Binance") : service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "ACCEPTABLE",
      rootSourceAddress: binance,
      rootSourceType: "allowlist_cex",
      stoppedReason: "allowlist_cex_reached",
      riskScoreContribution: 5,
      pathAddresses: [binance, walletB, walletC, walletD, subject],
      txHashes: ["tx-binance-b", "tx-b-c", "tx-c-d", "tx-balance"],
      amountPreservationRatio: 1
    });
  });

  it("declines when the balance-forming path reaches a bridge boundary", async () => {
    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(bridge),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === bridge ? service("bridge", "Allbridge") : service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "DECLINE",
      rootSourceAddress: bridge,
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: baseShareScore("bridge_router_dex", 1),
      exposureSourceKey: "bridge_router_dex",
      sourceExposureKind: "bridge_router_dex",
      pathAddresses: [bridge, subject]
    });
    expect(path.reasons.join(" ")).toContain("bridge boundary");
    expect(path.reasons.join(" ")).toContain("source-policy context");
  });

  it("scores WhiteBIT labels as medium even when the service classification is generic CEX", async () => {
    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(whitebit),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async () => [],
      getLabelsForAddress: async (address) => address === whitebit ? [whitebitLabel()] : [],
      getClassificationForAddress: async (address) => address === whitebit ? service("cex", "WhiteBIT") : service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "DECLINE",
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: 60,
      exposureSourceKey: "whitebit",
      sourceExposureKind: "whitebit"
    });
    expect(path.reasons[0]).toContain("WhiteBIT exposure (100% of selected provenance target)");
  });

  it("continues sibling branches after a source-policy decline boundary", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [walletB, [
        edge("a-tx-htx-walletB", htx, walletB, "2000000000", "2026-05-22T10:14:00.000Z"),
        edge("b-tx-clean-walletB", cleanHop, walletB, "3000000000", "2026-05-22T10:13:00.000Z")
      ]],
      [cleanHop, [edge("tx-binance-clean", binance, cleanHop, "3000000000", "2026-05-22T10:12:00.000Z")]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(walletB),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => {
        if (address === htx) return service("cex", "HTX");
        if (address === binance) return service("cex", "Binance");
        return service("none", null);
      }
    });

    expect(path).toMatchObject({
      verdict: "ACCEPTABLE",
      rootSourceAddress: binance,
      rootSourceType: "allowlist_cex",
      stoppedReason: "allowlist_cex_reached"
    });
  });

  it("returns review incomplete when clean EOA tracing exhausts the configured depth", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [walletD, [edge("tx-c-d", walletC, walletD, "5000000000", "2026-05-22T10:10:00.000Z")]],
      [walletC, [edge("tx-b-c", walletB, walletC, "5000000000", "2026-05-22T10:05:00.000Z")]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(walletD),
      maxDepth: 2,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "REVIEW",
      rootSourceAddress: walletB,
      rootSourceType: "incomplete",
      stoppedReason: "data_budget_exhausted",
      riskScoreContribution: 45,
      pathAddresses: [walletB, walletC, walletD, subject]
    });
  });

  it("treats weak amount or time continuity as provenance weakness instead of high risk", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [walletB, [edge("tx-c-b-weak", walletC, walletB, "1000000000", "2026-05-22T10:00:00.000Z")]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(walletB),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null)
    });

    expect(path.stoppedReason).toBe("weak_amount_or_time_continuity");
    expect(path.verdict).toBe("REVIEW");
    expect(path.riskScoreContribution).toBe(30);
    expect(path.reasons[0]).toMatch(/Clean CEX origin is not fully proven/i);
  });

  it("fetches active wallet history at the current hop timestamp instead of only at the job window end", async () => {
    const activeWallet = "TActiveWallet1111111111111111111111";
    const laterWindowEdges = [
      edge("tx-later-out-1", activeWallet, "TLaterOut111111111111111111111111", "9000000000", "2026-05-29T08:00:00.000Z"),
      edge("tx-later-out-2", activeWallet, "TLaterOut222222222222222222222222", "8000000000", "2026-05-29T07:00:00.000Z")
    ];
    const hopTimeEdges = [
      edge("tx-active-subject", activeWallet, subject, "120000000000", "2026-05-28T08:55:03.000Z"),
      edge("tx-binance-active", binance, activeWallet, "107238000000", "2026-05-27T17:47:27.000Z")
    ];

    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: {
        ...balanceTransfer(activeWallet, "tx-active-subject"),
        amountRaw: "120000000000",
        timestamp: "2026-05-28T08:55:03.000Z"
      },
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async (address, options?: { latestTimestamp?: Date }) => {
        if (address !== activeWallet) return [];
        return options?.latestTimestamp?.toISOString() === "2026-05-28T08:55:03.000Z"
          ? hopTimeEdges
          : laterWindowEdges;
      },
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "Binance") : service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "ACCEPTABLE",
      rootSourceAddress: binance,
      stoppedReason: "allowlist_cex_reached",
      txHashes: ["tx-binance-active", "tx-active-subject"]
    });
  });

  it("allows a larger prior incoming transfer to fund a smaller outgoing hop", async () => {
    const activeWallet = "TActiveWallet2222222222222222222222";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [activeWallet, [edge("tx-large-binance-active", binance, activeWallet, "2000000000000", "2026-05-28T08:00:00.000Z")]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: {
        ...balanceTransfer(activeWallet, "tx-active-subject"),
        amountRaw: "120000000000",
        timestamp: "2026-05-28T08:55:03.000Z"
      },
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "Binance") : service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "ACCEPTABLE",
      rootSourceAddress: binance,
      stoppedReason: "allowlist_cex_reached",
      amountPreservationRatio: 1
    });
  });

  it("uses balance-aware funding before stale single-candidate source policy matches", async () => {
    const tkqq = "TKqq111111111111111111111111111111";
    const tnsp = "TNsp111111111111111111111111111111";
    const tm3z = "TM3z111111111111111111111111111111";
    const tkuvwo = "TKuvwo111111111111111111111111111";
    const te2abe = "TE2Abe111111111111111111111111111";
    const tfjqz = "TFJQZ1111111111111111111111111111";
    const freshTopup = "TFreshTopup11111111111111111111111";
    const oldHtxTxId = "tx-old-htx-tkqq";

    const targetHop = edge("tx-tkqq-tnsp", tkqq, tnsp, "204047000000", "2026-06-04T11:41:30.000Z");
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [tkqq, [
        targetHop,
        edge(oldHtxTxId, htx, tkqq, "249590000000", "2026-05-14T12:33:42.000Z"),
        edge("tx-tkqq-tm3z", tkqq, tm3z, "303919000000", "2026-05-14T12:51:06.000Z"),
        edge("tx-tkuvwo-tkqq", tkuvwo, tkqq, "32006000000", "2026-06-04T10:16:33.000Z"),
        edge("tx-te2abe-tkqq", te2abe, tkqq, "3500000000", "2026-06-04T10:28:03.000Z"),
        edge("tx-tfjqz-tkqq", tfjqz, tkqq, "134295624553", "2026-06-04T10:58:27.000Z"),
        edge("tx-fresh-topup-tkqq", freshTopup, tkqq, "20000000000", "2026-06-04T11:00:00.000Z")
      ]]
    ]);

    const result = await traceMoneyOriginPath({
      subjectAddress: tnsp,
      balanceTransfer: {
        ...balanceTransfer(tkqq, "tx-tkqq-tnsp"),
        toAddress: tnsp,
        amountRaw: "204047000000",
        timestamp: "2026-06-04T11:41:30.000Z",
        coverageShare: 0.42
      },
      maxDepth: 3,
      beamWidth: 8,
      maxAddressFetches: 20,
      maxEdgesPerAddress: 20,
      bundleCoverageThreshold: 0.85,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? targetHop.timestamp.toISOString(),
        fetchedTransferCount: byAddress.get(address)?.length ?? 0,
        oldestFetchedTransferAt: "2026-05-14T12:33:42.000Z",
        reachedTargetHop: true,
        source: "local_index"
      }),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => {
        if (address === htx) return service("cex", "HTX");
        if (address === tfjqz) return service("cex", "Binance");
        return service("none", null);
      }
    });

    expect(result.rootSourceAddress).not.toBe(htx);
    expect(result.stoppedReason).toBe("allowlist_cex_reached");
    expect(result.balanceShare).toBeCloseTo(134295624553 / 204047000000, 3);
    expect(result.fundingBundles?.[0]?.members.map((member) => member.txHash)).not.toContain(oldHtxTxId);
    expect(result.fundingBundles?.[0]?.coverageRatio).toBeGreaterThanOrEqual(0.85);
  });

  it("continues through top bundle funders instead of stopping at no previous transfer", async () => {
    const tv3h25 = "TV3H25";
    const bundleSubject = "TBundleSubject111111111111111111111";
    const firstHop = edge("hop-to-subject", tv3h25, bundleSubject, "850000000000", "2026-04-21T12:37:30.000Z");
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [tv3h25, [
        firstHop,
        edge("in-85k", "TKHS", tv3h25, "85013000000", "2026-04-21T12:16:51.000Z"),
        edge("in-39k", "TRTr", tv3h25, "39116000000", "2026-04-21T12:18:03.000Z"),
        edge("in-600k", "TF6y", tv3h25, "600000000000", "2026-04-21T12:27:48.000Z"),
        edge("in-80k", "TFyj", tv3h25, "80500000000", "2026-04-21T12:33:51.000Z")
      ]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: bundleSubject,
      balanceTransfer: {
        ...balanceTransfer(tv3h25, "hop-to-subject"),
        toAddress: bundleSubject,
        amountRaw: "850000000000",
        timestamp: "2026-04-21T12:37:30.000Z"
      },
      maxDepth: 1,
      beamWidth: 4,
      maxAddressFetches: 10,
      maxEdgesPerAddress: 10,
      minAmountPreservationRatio: 0.8,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? firstHop.timestamp.toISOString(),
        fetchedTransferCount: byAddress.get(address)?.length ?? 0,
        oldestFetchedTransferAt: "2026-04-21T12:16:51.000Z",
        reachedTargetHop: true,
        source: "live"
      }),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null)
    });

    expect(path.stoppedReason).not.toBe("no_previous_transfer");
    expect(path.fundingBundles?.[0]).toMatchObject({
      hopTxHash: "hop-to-subject",
      hopAddress: tv3h25
    });
    expect(path.sourceProvenance?.[0]).toMatchObject({
      mode: "source_provenance",
      targetTxHash: "hop-to-subject",
      targetFromAddress: tv3h25,
      targetToAddress: bundleSubject,
      proofClass: "exact",
      stopReason: null,
      coverageWindow: expect.objectContaining({
        complete: true,
        capped: false
      })
    });
    expect(typeof path.fundingBundles?.[0]?.coverageRatio).toBe("number");
    expect(path.fundingBundles?.[0]?.members.length).toBeGreaterThan(1);
  });

  it("prefers a dominant source-policy bundle funder over a minor allowlisted CEX funder", async () => {
    const bundleWallet = "TBundlePolicyWallet111111111111111";
    const bundleSubject = "TBundlePolicySubject1111111111111";
    const targetHop = edge("tx-bundle-policy-subject", bundleWallet, bundleSubject, "1000000000", "2026-05-22T10:15:00.000Z");
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [bundleWallet, [
        targetHop,
        edge("tx-htx-bundle-85", htx, bundleWallet, "850000000", "2026-05-22T10:10:00.000Z"),
        edge("tx-binance-bundle-15", binance, bundleWallet, "150000000", "2026-05-22T10:11:00.000Z")
      ]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: bundleSubject,
      balanceTransfer: {
        ...balanceTransfer(bundleWallet, "tx-bundle-policy-subject"),
        toAddress: bundleSubject,
        amountRaw: "1000000000",
        timestamp: "2026-05-22T10:15:00.000Z"
      },
      maxDepth: 3,
      beamWidth: 4,
      maxAddressFetches: 10,
      maxEdgesPerAddress: 10,
      bundleCoverageThreshold: 1,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? targetHop.timestamp.toISOString(),
        fetchedTransferCount: byAddress.get(address)?.length ?? 0,
        oldestFetchedTransferAt: "2026-05-22T10:10:00.000Z",
        reachedTargetHop: true,
        source: "live"
      }),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => {
        if (address === htx) return service("cex", "HTX");
        if (address === binance) return service("cex", "Binance");
        return service("none", null);
      }
    });

    expect(path).toMatchObject({
      verdict: "DECLINE",
      rootSourceAddress: htx,
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      sourceExposureKind: "htx_huobi"
    });
    expect(path.balanceShare).toBeGreaterThanOrEqual(0.85);
  });

  it("stops bundle expansion when incoming history did not reach the hop timestamp", async () => {
    const partialBundleWallet = "TPartialBundleHistory111111111111";
    const partialBundleSubject = "TPartialBundleSubject11111111111";
    const targetHop = edge("tx-partial-bundle-subject", partialBundleWallet, partialBundleSubject, "1000000000", "2026-05-22T10:15:00.000Z");
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [partialBundleWallet, [
        targetHop,
        edge("tx-binance-partial-bundle", binance, partialBundleWallet, "1000000000", "2026-05-22T10:10:00.000Z")
      ]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: partialBundleSubject,
      balanceTransfer: {
        ...balanceTransfer(partialBundleWallet, "tx-partial-bundle-subject"),
        toAddress: partialBundleSubject,
        amountRaw: "1000000000",
        timestamp: "2026-05-22T10:15:00.000Z"
      },
      maxDepth: 3,
      beamWidth: 4,
      maxAddressFetches: 10,
      maxEdgesPerAddress: 10,
      bundleCoverageThreshold: 1,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? targetHop.timestamp.toISOString(),
        fetchedTransferCount: byAddress.get(address)?.length ?? 0,
        oldestFetchedTransferAt: "2026-05-22T10:16:00.000Z",
        reachedTargetHop: false,
        source: "live"
      }),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "Binance") : service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "REVIEW",
      rootSourceAddress: partialBundleWallet,
      rootSourceType: "incomplete",
      stoppedReason: "incoming_history_not_fetched"
    });
    expect(path.sourceProvenance?.[0]).toMatchObject({
      mode: "source_provenance",
      targetTxHash: "tx-partial-bundle-subject",
      targetFromAddress: partialBundleWallet,
      targetToAddress: partialBundleSubject,
      proofClass: "probable",
      stopReason: "incoming_history_not_fetched",
      coverageWindow: expect.objectContaining({
        complete: false
      })
    });
    expect(path.sourceProvenance?.[0]?.reasons).toEqual(expect.arrayContaining([
      "funding_bundle_amount_covered",
      "coverage_window_not_exact"
    ]));
    expect(path.historyCoverage).toEqual([
      expect.objectContaining({
        address: partialBundleWallet,
        reachedTargetHop: false,
        source: "live"
      })
    ]);
  });

  it("requests candidate windows for probable funding provenance before returning an unresolved path", async () => {
    const partialBundleWallet = "TPartialCandidateWallet111111111111";
    const partialBundleSubject = "TPartialCandidateSubject11111111111";
    const targetHop = edge("tx-candidate-hop-subject", partialBundleWallet, partialBundleSubject, "1000000000", "2026-05-22T10:15:00.000Z");
    const funding = edge("tx-candidate-funder", binance, partialBundleWallet, "1000000000", "2026-05-22T10:10:00.000Z");
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [partialBundleWallet, [targetHop, funding]]
    ]);
    const requested: unknown[] = [];

    await expect(traceMoneyOriginPath({
      subjectAddress: partialBundleSubject,
      balanceTransfer: {
        ...balanceTransfer(partialBundleWallet, "tx-candidate-hop-subject"),
        toAddress: partialBundleSubject,
        amountRaw: "1000000000",
        timestamp: "2026-05-22T10:15:00.000Z"
      },
      maxDepth: 3,
      beamWidth: 4,
      maxAddressFetches: 10,
      maxEdgesPerAddress: 10,
      bundleCoverageThreshold: 1,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? targetHop.timestamp.toISOString(),
        fetchedTransferCount: byAddress.get(address)?.length ?? 0,
        oldestFetchedTransferAt: "2026-05-22T10:10:00.000Z",
        reachedTargetHop: false,
        source: "local_index",
        coverageComplete: false,
        providerCapHit: false,
        budgetExhausted: true,
        providerInconsistent: false,
        statusReason: "partial_budget_exhausted"
      }),
      requestCandidateWindows: async (requests) => {
        requested.push(...requests);
        throw new Error("targeted_history_waiting_for_index");
      },
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null)
    })).rejects.toThrow("targeted_history_waiting_for_index");

    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({
      address: partialBundleWallet,
      candidateTxHash: "tx-candidate-funder",
      relatedHopTxHash: "tx-candidate-hop-subject"
    });
  });

  it("does not let inline exact-window repair bypass queued candidate windows", async () => {
    const repairWallet = "TRepairBypassWallet111111111111111";
    const repairSubject = "TRepairBypassSubject111111111111";
    const targetHop = edge("tx-repair-bypass-hop", repairWallet, repairSubject, "1000000000", "2026-05-22T10:15:00.000Z");
    const funding = edge("tx-repair-bypass-funder", binance, repairWallet, "1000000000", "2026-05-22T10:10:00.000Z");
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [repairWallet, [targetHop, funding]]
    ]);
    const requested: unknown[] = [];
    let repairCalled = false;

    await expect(traceMoneyOriginPath({
      subjectAddress: repairSubject,
      balanceTransfer: {
        ...balanceTransfer(repairWallet, "tx-repair-bypass-hop"),
        toAddress: repairSubject,
        amountRaw: "1000000000",
        timestamp: "2026-05-22T10:15:00.000Z"
      },
      maxDepth: 3,
      beamWidth: 4,
      maxAddressFetches: 10,
      maxEdgesPerAddress: 10,
      bundleCoverageThreshold: 1,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? targetHop.timestamp.toISOString(),
        fetchedTransferCount: byAddress.get(address)?.length ?? 0,
        oldestFetchedTransferAt: "2026-05-22T10:10:00.000Z",
        reachedTargetHop: false,
        source: "local_index",
        coverageComplete: false,
        providerCapHit: false,
        budgetExhausted: true,
        providerInconsistent: false,
        statusReason: "partial_budget_exhausted"
      }),
      repairSourceProvenanceWindow: async (input) => {
        repairCalled = true;
        return repairFundingSourceExactWindow({
          target: input.target,
          windowEdges: [funding, targetHop],
          windowCoverage: {
            complete: true,
            fetchedTransferCount: 2,
            oldestFetchedTransferAt: funding.timestamp.toISOString(),
            source: "local_index"
          },
          downstreamAmountRaw: input.downstreamAmountRaw,
          minCoverageRatio: input.minCoverageRatio,
          maxFunders: input.maxFunders
        });
      },
      requestCandidateWindows: async (requests) => {
        requested.push(...requests);
        throw new Error("targeted_history_waiting_for_index");
      },
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null)
    })).rejects.toThrow("targeted_history_waiting_for_index");

    expect(repairCalled).toBe(false);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({
      address: repairWallet,
      candidateTxHash: "tx-repair-bypass-funder",
      relatedHopTxHash: "tx-repair-bypass-hop"
    });
  });

  it("uses exact-window repair to turn probable funding provenance into exact trace expansion", async () => {
    const repairWallet = "TRepairWindowWallet11111111111111111";
    const repairSubject = "TRepairWindowSubject111111111111111";
    const targetHop = edge("tx-repair-hop-subject", repairWallet, repairSubject, "1000000000", "2026-05-22T10:15:00.000Z");
    const funding = edge("tx-binance-repair-window", binance, repairWallet, "1000000000", "2026-05-22T10:10:00.000Z");
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [repairWallet, [targetHop, funding]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: repairSubject,
      balanceTransfer: {
        ...balanceTransfer(repairWallet, "tx-repair-hop-subject"),
        toAddress: repairSubject,
        amountRaw: "1000000000",
        timestamp: "2026-05-22T10:15:00.000Z"
      },
      maxDepth: 3,
      beamWidth: 4,
      maxAddressFetches: 10,
      maxEdgesPerAddress: 10,
      bundleCoverageThreshold: 1,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? targetHop.timestamp.toISOString(),
        fetchedTransferCount: byAddress.get(address)?.length ?? 0,
        oldestFetchedTransferAt: "2026-05-22T10:10:00.000Z",
        reachedTargetHop: false,
        source: "local_index",
        coverageComplete: false,
        providerCapHit: true,
        statusReason: "partial_provider_cap"
      }),
      repairSourceProvenanceWindow: async (input) => repairFundingSourceExactWindow({
        target: input.target,
        windowEdges: [funding, targetHop],
        windowCoverage: {
          complete: true,
          fetchedTransferCount: 2,
          oldestFetchedTransferAt: funding.timestamp.toISOString(),
          source: "local_index"
        },
        downstreamAmountRaw: input.downstreamAmountRaw,
        minCoverageRatio: input.minCoverageRatio,
        maxFunders: input.maxFunders
      }),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "Binance") : service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "ACCEPTABLE",
      rootSourceAddress: binance,
      rootSourceType: "allowlist_cex",
      stoppedReason: "allowlist_cex_reached"
    });
    expect(path.sourceProvenance?.[0]).toMatchObject({
      targetTxHash: "tx-repair-hop-subject",
      proofClass: "exact",
      stopReason: null,
      coverageWindow: expect.objectContaining({
        complete: true,
        capped: false
      })
    });
    expect(path.sourceProvenance?.[0]?.reasons).toContain("exact_window_repaired");
  });

  it("uses incoming_history_not_fetched when history did not reach the hop timestamp", async () => {
    const partialWallet = "TPartialHistory11111111111111111111";

    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(partialWallet),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async () => [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? "2026-05-22T10:15:00.000Z",
        fetchedTransferCount: 50,
        oldestFetchedTransferAt: "2026-05-22T10:16:00.000Z",
        reachedTargetHop: false,
        source: "live"
      }),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null)
    });

    expect(path.stoppedReason).toBe("incoming_history_not_fetched");
  });

  it("uses pre_existing_balance_possible when reached history has no prior inputs", async () => {
    const emptyWallet = "TEmptyHistory1111111111111111111111";

    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(emptyWallet),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async () => [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? "2026-05-22T10:15:00.000Z",
        fetchedTransferCount: 0,
        oldestFetchedTransferAt: null,
        reachedTargetHop: true,
        source: "live"
      }),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null)
    });

    expect(path.stoppedReason).toBe("pre_existing_balance_possible");
    expect(path.sourceProvenance?.[0]).toMatchObject({
      mode: "source_provenance",
      targetFromAddress: emptyWallet,
      proofClass: "pre_existing_balance_possible",
      stopReason: "pre_existing_balance_possible"
    });
  });

  it("uses incoming_seen_but_below_continuity for below-threshold prior inputs with reached history", async () => {
    const weakWallet = "TWeakHistory11111111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [weakWallet, [edge("tx-weak-input", walletC, weakWallet, "1000000000", "2026-05-22T10:00:00.000Z")]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(weakWallet),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? "2026-05-22T10:15:00.000Z",
        fetchedTransferCount: byAddress.get(address)?.length ?? 0,
        oldestFetchedTransferAt: "2026-05-22T10:00:00.000Z",
        reachedTargetHop: true,
        source: "live"
      }),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null)
    });

    expect(path.stoppedReason).toBe("incoming_seen_but_below_continuity");
    expect(path.rejectedCandidates).toEqual([
      expect.objectContaining({
        txHash: "tx-weak-input",
        amountRaw: "1000000000",
        coverageRatio: 0.2,
        reasons: ["amount_continuity_below_threshold"]
      })
    ]);
  });

  it("preserves all bundle member transfers for a repeated funder and traces from the oldest member timestamp", async () => {
    const bundleWallet = "TBundleWallet";
    const repeatFunder = "TFRepeat";
    const repeatFirst = edge("repeat-500k", repeatFunder, bundleWallet, "500000000000", "2026-04-21T12:20:00.000Z");
    const repeatSecond = edge("repeat-250k", repeatFunder, bundleWallet, "250000000000", "2026-04-21T12:30:00.000Z");
    const repeatFetchTimestamps: Array<string | undefined> = [];
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [bundleWallet, [
        edge("hop-bundle-subject", bundleWallet, subject, "850000000000", "2026-04-21T12:37:00.000Z"),
        repeatFirst,
        repeatSecond
      ]],
      [repeatFunder, [
        edge("tx-binance-repeat", binance, repeatFunder, "750000000000", "2026-04-21T12:10:00.000Z")
      ]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: {
        ...balanceTransfer(bundleWallet, "hop-bundle-subject"),
        amountRaw: "850000000000",
        timestamp: "2026-04-21T12:37:00.000Z"
      },
      maxDepth: 3,
      beamWidth: 4,
      maxAddressFetches: 10,
      maxEdgesPerAddress: 10,
      minAmountPreservationRatio: 0.9,
      bundleCoverageThreshold: 0.8,
      fetchEdgesForAddress: async (address, options) => {
        if (address === repeatFunder) {
          repeatFetchTimestamps.push(options?.latestTimestamp?.toISOString());
        }
        return byAddress.get(address) ?? [];
      },
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? "2026-04-21T12:37:00.000Z",
        fetchedTransferCount: byAddress.get(address)?.length ?? 0,
        oldestFetchedTransferAt: address === repeatFunder
          ? "2026-04-21T12:10:00.000Z"
          : "2026-04-21T12:20:00.000Z",
        reachedTargetHop: true,
        source: "live"
      }),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "Binance") : service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "ACCEPTABLE",
      rootSourceAddress: binance,
      rootSourceType: "allowlist_cex",
      stoppedReason: "allowlist_cex_reached"
    });
    expect(path.txHashes).toContain("repeat-500k");
    expect(path.txHashes).toContain("repeat-250k");
    expect(path.steps.filter((step) => step.fromAddress === repeatFunder).map((step) => step.txHash))
      .toEqual(expect.arrayContaining(["repeat-500k", "repeat-250k"]));
    expect(repeatFetchTimestamps).toContain("2026-04-21T12:20:00.000Z");
  });
});
