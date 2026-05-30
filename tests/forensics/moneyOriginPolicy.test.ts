import { describe, expect, it } from "vitest";
import { classifyMoneyOriginStop, combineMoneyOriginDecision, riskLevelFromMoneyOriginScore } from "../../src/forensics/moneyOriginPolicy";
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

  it("declines bridge router DEX and HTX Huobi sources as high risk", () => {
    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("bridge", "Allbridge"),
      balanceShare: 1
    })).toMatchObject({
      verdict: "DECLINE",
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: 78
    });

    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("router", "MetaRouter"),
      balanceShare: 1
    })).toMatchObject({ verdict: "DECLINE", riskScoreContribution: 78 });

    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("dex", "SunSwap"),
      balanceShare: 1
    })).toMatchObject({ verdict: "DECLINE", riskScoreContribution: 78 });

    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("cex", "HTX"),
      balanceShare: 1
    })).toMatchObject({ verdict: "DECLINE", riskScoreContribution: 78 });
  });

  it("scores WhiteBIT sources as medium risk using balance share", () => {
    expect(classifyMoneyOriginStop({
      address,
      labels: [label("whitebit")],
      classification: service("cex", "WhiteBIT"),
      balanceShare: 1
    })).toMatchObject({
      verdict: "DECLINE",
      rootSourceType: "decline_boundary",
      riskScoreContribution: 55,
      reasons: ["Balance-forming path has WhiteBIT exposure (100% of current balance); this is a medium-risk source signal, not HTX/Huobi high-risk exposure."]
    });

    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("cex", "WhiteBIT"),
      balanceShare: 0.23
    })).toMatchObject({
      verdict: "DECLINE",
      riskScoreContribution: 45,
      reasons: ["Balance-forming path has WhiteBIT exposure (23% of current balance); this is a medium-risk source signal, not HTX/Huobi high-risk exposure."]
    });
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
      riskScoreContribution: 50
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
      riskScoreContribution: 45,
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
      path("DECLINE", 35, "tx-whitebit-1", {
        balanceShare: 0.1,
        exposureSourceKey: "whitebit",
        exposureSourceLabel: "WhiteBIT",
        reasons: ["Balance-forming path has WhiteBIT exposure (10% of current balance)."]
      }),
      path("DECLINE", 35, "tx-whitebit-2", {
        balanceShare: 0.1,
        exposureSourceKey: "whitebit",
        exposureSourceLabel: "WhiteBIT",
        reasons: ["Balance-forming path has WhiteBIT exposure (10% of current balance)."]
      }),
      path("ACCEPTABLE", 5, "tx-binance")
    ]);

    expect(decision).toMatchObject({
      decision: "DECLINE",
      riskScore: 45
    });
    expect(decision.decisionReasons[0]).toContain("combined WhiteBIT exposure (20% of current balance)");
  });

  it("maps money-origin scores to risk levels", () => {
    expect(riskLevelFromMoneyOriginScore(0)).toBe("LOW");
    expect(riskLevelFromMoneyOriginScore(30)).toBe("MEDIUM");
    expect(riskLevelFromMoneyOriginScore(60)).toBe("HIGH");
    expect(riskLevelFromMoneyOriginScore(85)).toBe("CRITICAL");
  });
});
