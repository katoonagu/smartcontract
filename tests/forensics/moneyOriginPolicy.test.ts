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

function path(verdict: MoneyOriginPath["verdict"], score: number, txHash: string): MoneyOriginPath {
  return {
    balanceTransferTxHash: txHash,
    rootSourceAddress: address,
    rootSourceType: verdict === "ACCEPTABLE" ? "allowlist_cex" : verdict === "DECLINE" ? "decline_boundary" : "incomplete",
    pathAddresses: [address, "TSubject111111111111111111111111111111"],
    txHashes: [txHash],
    amountPreservationRatio: 1,
    timeSpanMs: 0,
    stoppedReason: verdict === "ACCEPTABLE" ? "allowlist_cex_reached" : "data_budget_exhausted",
    verdict,
    riskScoreContribution: score,
    reasons: [`${verdict} fixture`]
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

  it("declines bridge router DEX HTX Huobi and WhiteBIT sources", () => {
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

    expect(classifyMoneyOriginStop({
      address,
      labels: [label("whitebit")],
      classification: service("cex", "WhiteBIT"),
      balanceShare: 1
    })).toMatchObject({ verdict: "DECLINE", rootSourceType: "risky_label", riskScoreContribution: 85 });
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

  it("maps money-origin scores to risk levels", () => {
    expect(riskLevelFromMoneyOriginScore(0)).toBe("LOW");
    expect(riskLevelFromMoneyOriginScore(30)).toBe("MEDIUM");
    expect(riskLevelFromMoneyOriginScore(60)).toBe("HIGH");
    expect(riskLevelFromMoneyOriginScore(85)).toBe("CRITICAL");
  });
});
