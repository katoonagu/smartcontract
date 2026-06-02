import { describe, expect, it } from "vitest";
import { classifyMoneyOriginStop, combineMoneyOriginDecision, riskLevelFromMoneyOriginScore } from "../../src/forensics/moneyOriginPolicy";
import { baseShareScore } from "../../src/forensics/provenanceScoring";
import type { AddressLabel, MoneyOriginPath, ServiceClassification } from "../../src/types";

const address = "TAddress11111111111111111111111111111";

function label(labelValue: AddressLabel["label"]): AddressLabel {
  return {
    address,
    label: labelValue,
    source: "service_admin",
    createdByTelegramId: "1",
    createdAt: new Date("2026-05-01T00:00:00.000Z")
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

function path(
  verdict: MoneyOriginPath["verdict"],
  score: number,
  txHash: string,
  extra: Partial<MoneyOriginPath> = {}
): MoneyOriginPath {
  return {
    balanceTransferTxHash: txHash,
    rootSourceAddress: address,
    rootSourceType: verdict === "ACCEPTABLE" ? "allowlist_cex" : verdict === "DECLINE" ? "decline_boundary" : "incomplete",
    pathAddresses: [address, "TSubject111111111111111111111111111111"],
    txHashes: [txHash],
    steps: [{
      txHash,
      fromAddress: address,
      toAddress: "TSubject111111111111111111111111111111",
      amountRaw: "1000000",
      timestamp: "2026-05-01T00:00:00.000Z"
    }],
    amountPreservationRatio: 1,
    timeSpanMs: 0,
    stoppedReason: verdict === "ACCEPTABLE" ? "allowlist_cex_reached" : "data_budget_exhausted",
    verdict,
    riskScoreContribution: score,
    reasons: [`${verdict} fixture`],
    ...extra
  };
}

describe("money origin policy", () => {
  it("accepts allowlisted CEX roots", () => {
    const result = classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("cex", "Binance Hot Wallet"),
      balanceShare: 1
    });

    expect(result).toEqual({
      verdict: "ACCEPTABLE",
      rootSourceType: "allowlist_cex",
      stoppedReason: "allowlist_cex_reached",
      riskScoreContribution: 5,
      reasons: ["Balance-forming path reaches allowlisted CEX Binance through clean on-chain hops."]
    });
  });

  it("scores bridge router DEX boundaries by selected provenance share", () => {
    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("bridge", "Allbridge"),
      balanceShare: 1
    })).toMatchObject({
      verdict: "DECLINE",
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: baseShareScore("bridge_router_dex", 1),
      exposureSourceKey: "bridge_router_dex",
      sourceExposureKind: "bridge_router_dex"
    });

    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("router", "MetaRouter"),
      balanceShare: 1
    })).toMatchObject({
      verdict: "DECLINE",
      riskScoreContribution: baseShareScore("bridge_router_dex", 1),
      exposureSourceKey: "bridge_router_dex",
      sourceExposureKind: "bridge_router_dex"
    });

    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("dex", "SunSwap"),
      balanceShare: 1
    })).toMatchObject({
      verdict: "DECLINE",
      riskScoreContribution: baseShareScore("bridge_router_dex", 1),
      exposureSourceKey: "bridge_router_dex",
      sourceExposureKind: "bridge_router_dex"
    });
  });

  it("reviews minority bridge router DEX exposure with share-weighted score", () => {
    const result = classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("bridge", "Bridge"),
      balanceShare: 4060 / 46000
    });

    expect(result).toMatchObject({
      verdict: "REVIEW",
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: baseShareScore("bridge_router_dex", 4060 / 46000),
      exposureSourceKey: "bridge_router_dex",
      sourceExposureKind: "bridge_router_dex"
    });
    expect(result?.riskScoreContribution).toBeLessThanOrEqual(30);
    expect(result?.reasons.join(" ")).toContain("8.8%");
  });

  it("allows majority bridge router DEX exposure to become source-policy decline", () => {
    const result = classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("router", "Router"),
      balanceShare: 0.65
    });

    expect(result?.verdict).toBe("DECLINE");
    expect(result?.riskScoreContribution).toBeGreaterThanOrEqual(60);
    expect(result?.riskScoreContribution).toBeLessThanOrEqual(70);
  });

  it("reviews minority HTX Huobi exposure as source-policy risk", () => {
    const result = classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("cex", "HTX"),
      balanceShare: 0.15
    });

    expect(result).toMatchObject({
      verdict: "REVIEW",
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: baseShareScore("htx_huobi", 0.15),
      exposureSourceKey: "htx_huobi",
      exposureSourceLabel: "HTX/Huobi",
      sourceExposureKind: "htx_huobi"
    });
    expect(result?.riskScoreContribution).toBeLessThan(60);
    expect(result?.reasons.join(" ")).toContain("source-policy risk");
    expect(result?.reasons.join(" ")).toContain("not direct scam/blacklist proof");
  });

  it("declines majority HTX Huobi exposure with weighted source-policy score", () => {
    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("cex", "Huobi"),
      balanceShare: 0.62
    })).toMatchObject({
      verdict: "DECLINE",
      riskScoreContribution: baseShareScore("htx_huobi", 0.62),
      exposureSourceKey: "htx_huobi",
      exposureSourceLabel: "HTX/Huobi",
      sourceExposureKind: "htx_huobi"
    });

    expect(baseShareScore("htx_huobi", 0.62)).toBeGreaterThanOrEqual(78);
  });

  it("scores WhiteBIT sources as medium source-policy using balance share", () => {
    expect(classifyMoneyOriginStop({
      address,
      labels: [label("whitebit")],
      classification: service("cex", "WhiteBIT"),
      balanceShare: 1
    })).toMatchObject({
      verdict: "DECLINE",
      rootSourceType: "decline_boundary",
      riskScoreContribution: baseShareScore("whitebit", 1),
      exposureSourceKey: "whitebit",
      exposureSourceLabel: "WhiteBIT",
      sourceExposureKind: "whitebit"
    });

    const minority = classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("cex", "WhiteBIT"),
      balanceShare: 0.15
    });

    expect(minority).toMatchObject({
      verdict: "REVIEW",
      riskScoreContribution: baseShareScore("whitebit", 0.15),
      exposureSourceKey: "whitebit",
      exposureSourceLabel: "WhiteBIT",
      sourceExposureKind: "whitebit"
    });
    expect(minority?.riskScoreContribution).toBeLessThan(50);
    expect(minority?.reasons.join(" ")).toContain("medium source-policy risk");
    expect(minority?.reasons.join(" ")).toContain("not direct scam/blacklist proof");
  });

  it("continues through clean EOAs and reviews unlabeled services", () => {
    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("none", null),
      balanceShare: 1
    })).toBeNull();

    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("cex", "Unknown Exchange"),
      balanceShare: 1
    })).toMatchObject({
      verdict: "REVIEW",
      rootSourceType: "unknown",
      stoppedReason: "unlabeled_service_boundary",
      riskScoreContribution: 50,
      exposureSourceKey: "unknown_cex",
      sourceExposureKind: "unknown_cex"
    });
  });

  it("treats unknown contracts as unproven medium context rather than hard decline", () => {
    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("unknown_contract", "CreatedByContract"),
      balanceShare: 0.36
    })).toMatchObject({
      verdict: "REVIEW",
      rootSourceType: "unknown",
      stoppedReason: "unlabeled_service_boundary",
      riskScoreContribution: baseShareScore("unknown_contract", 0.36),
      exposureSourceKey: "unknown_contract",
      sourceExposureKind: "unknown_contract",
      reasons: ["Balance-forming path reaches unknown contract boundary; clean source is not proven, but this is not direct scam or approval-drain proof."]
    });
  });

  it("combines paths with decline taking precedence over review and acceptable", () => {
    const decision = combineMoneyOriginDecision([
      path("ACCEPTABLE", 5, "tx-acceptable"),
      path("REVIEW", 45, "tx-review"),
      path("DECLINE", 78, "tx-decline")
    ]);

    expect(decision).toEqual({
      decision: "DECLINE",
      riskScore: 78,
      decisionReasons: ["DECLINE fixture", "REVIEW fixture", "ACCEPTABLE fixture"]
    });
  });

  it("aggregates WhiteBIT exposure across multiple balance-forming paths", () => {
    const decision = combineMoneyOriginDecision([
      path("REVIEW", baseShareScore("whitebit", 0.1), "tx-whitebit-1", {
        balanceShare: 0.1,
        exposureSourceKey: "whitebit",
        exposureSourceLabel: "WhiteBIT",
        sourceExposureKind: "whitebit",
        reasons: ["Balance-forming path has WhiteBIT exposure (10% of selected provenance target)."]
      }),
      path("REVIEW", baseShareScore("whitebit", 0.1), "tx-whitebit-2", {
        balanceShare: 0.1,
        exposureSourceKey: "whitebit",
        exposureSourceLabel: "WhiteBIT",
        sourceExposureKind: "whitebit",
        reasons: ["Balance-forming path has WhiteBIT exposure (10% of selected provenance target)."]
      }),
      path("ACCEPTABLE", 5, "tx-binance")
    ]);

    expect(decision).toMatchObject({
      decision: "REVIEW",
      riskScore: baseShareScore("whitebit", 0.2)
    });
    expect(decision.decisionReasons[0]).toContain("combined WhiteBIT exposure (20% of selected provenance target)");
  });

  it("declines aggregate majority WhiteBIT exposure by policy", () => {
    const decision = combineMoneyOriginDecision([
      path("REVIEW", baseShareScore("whitebit", 0.3), "tx-whitebit-1", {
        balanceShare: 0.3,
        exposureSourceKey: "whitebit",
        exposureSourceLabel: "WhiteBIT",
        sourceExposureKind: "whitebit",
        reasons: ["Balance-forming path has WhiteBIT exposure (30% of selected provenance target)."]
      }),
      path("REVIEW", baseShareScore("whitebit", 0.3), "tx-whitebit-2", {
        balanceShare: 0.3,
        exposureSourceKey: "whitebit",
        exposureSourceLabel: "WhiteBIT",
        sourceExposureKind: "whitebit",
        reasons: ["Balance-forming path has WhiteBIT exposure (30% of selected provenance target)."]
      })
    ]);

    expect(decision).toMatchObject({
      decision: "DECLINE",
      riskScore: baseShareScore("whitebit", 0.6)
    });
    expect(decision.decisionReasons[0]).toContain("combined WhiteBIT exposure (60% of selected provenance target)");
  });

  it("maps money-origin scores to risk levels", () => {
    expect(riskLevelFromMoneyOriginScore(0)).toBe("LOW");
    expect(riskLevelFromMoneyOriginScore(30)).toBe("MEDIUM");
    expect(riskLevelFromMoneyOriginScore(60)).toBe("HIGH");
    expect(riskLevelFromMoneyOriginScore(85)).toBe("CRITICAL");
  });
});
