import { describe, expect, it } from "vitest";
import type { IncomingDepositOriginPath, RiskReport } from "../../src/types";
import { buildIncomingDepositRiskReport } from "../../src/forensics/incomingDepositRisk";

const lowFast: RiskReport = {
  subjectAddress: "TSender",
  score: 0,
  level: "LOW",
  reasons: [
    {
      code: "no_obvious_risk",
      message: "no obvious risk signals found",
      scoreImpact: 0,
      source: "test",
      confidence: "low",
      severity: "info"
    }
  ]
};

function path(overrides: Partial<IncomingDepositOriginPath>): IncomingDepositOriginPath {
  return {
    verdict: "ACCEPTABLE",
    score: 35,
    sourcePolicy: "unknown",
    stoppedReason: "no_previous_transfer",
    pathAddresses: ["TFunder", "TSender", "TWatched"],
    txHashes: ["funding", "deposit"],
    steps: [],
    amountCoverageRatio: 0.8,
    amountContinuity: "strong",
    proximityHops: 1,
    reasons: ["Source remains unproven."],
    ...overrides
  };
}

describe("buildIncomingDepositRiskReport", () => {
  it("does not score medium solely because sender current balance is zero", () => {
    const report = buildIncomingDepositRiskReport({
      depositTxHash: "tx",
      watchedWallet: "TWatched",
      sender: "TSender",
      amountRaw: "100000000000",
      fastSenderRisk: lowFast,
      originPaths: [path({ stoppedReason: "no_previous_transfer" })],
      originCoverage: 0.75,
      senderRole: "operational_liquidity_wallet",
      senderCurrentBalanceRaw: "0",
      contractVerdicts: [],
      warnings: ["Sender current balance is zero after outgoing deposit; balance-origin mode is not applicable."]
    });

    expect(report.decision).toBe("ACCEPTABLE");
    expect(report.depositRiskScore).toBeLessThanOrEqual(40);
    expect(report.reasons.join(" ")).not.toMatch(/zero.*risk/i);
  });

  it("declines close unknown contract funding for a fresh one-shot sender and large amount", () => {
    const report = buildIncomingDepositRiskReport({
      depositTxHash: "48d33",
      watchedWallet: "TEYPUt",
      sender: "TEaViA",
      amountRaw: "384064001319",
      fastSenderRisk: lowFast,
      originPaths: [
        path({
          verdict: "DECLINE",
          score: 58,
          sourcePolicy: "medium_policy",
          stoppedReason: "unknown_contract_reached",
          pathAddresses: ["TFcRN", "TEaViA", "TEYPUt"],
          amountCoverageRatio: 0.92,
          amountContinuity: "strong",
          proximityHops: 1
        })
      ],
      originCoverage: 0.92,
      senderRole: "fresh_one_shot_wallet",
      senderCurrentBalanceRaw: "0",
      contractVerdicts: [
        {
          source: "llm",
          cacheMatch: null,
          reusedFromContractAddress: null,
          providerLabel: "deepseek",
          model: "deepseek-v4-pro",
          contractAddress: "TFcRN",
          caseFileHash: "case-hash-1",
          cacheId: null,
          verdict: "unknown_suspicious",
          confidence: 0.8,
          contractRiskScore: 72,
          decisionRecommendation: "DECLINE",
          reasons: ["Unknown contract funded sender shortly before deposit."],
          citedEvidenceIds: ["contract-in"],
          falsePositiveNotes: []
        }
      ],
      warnings: []
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.depositRiskScore).toBeGreaterThanOrEqual(60);
  });

  it("hard declines HTX/Huobi close source", () => {
    const report = buildIncomingDepositRiskReport({
      depositTxHash: "tx",
      watchedWallet: "TWatched",
      sender: "TSender",
      amountRaw: "100000000000",
      fastSenderRisk: lowFast,
      originPaths: [
        path({
          verdict: "DECLINE",
          score: 78,
          sourcePolicy: "hard_decline",
          stoppedReason: "htx_huobi_reached",
          reasons: ["Deposit path reaches HTX/Huobi."]
        })
      ],
      originCoverage: 1,
      senderRole: "unknown_wallet",
      senderCurrentBalanceRaw: null,
      contractVerdicts: [],
      warnings: []
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.depositRiskScore).toBeGreaterThanOrEqual(70);
  });

  it("treats WhiteBIT as medium policy rather than hard evidence", () => {
    const report = buildIncomingDepositRiskReport({
      depositTxHash: "tx",
      watchedWallet: "TWatched",
      sender: "TSender",
      amountRaw: "100000000000",
      fastSenderRisk: lowFast,
      originPaths: [
        path({
          verdict: "DECLINE",
          score: 52,
          sourcePolicy: "medium_policy",
          stoppedReason: "whitebit_reached",
          reasons: ["Deposit path reaches WhiteBIT."]
        })
      ],
      originCoverage: 1,
      senderRole: "unknown_wallet",
      senderCurrentBalanceRaw: null,
      contractVerdicts: [],
      warnings: []
    });

    expect(report.depositRiskScore).toBeLessThan(70);
    expect(report.hardBadEvidence.map((evidence) => evidence.kind)).not.toContain("htx_huobi_source");
    expect(report.hardBadEvidence.map((evidence) => evidence.kind)).not.toContain("bridge_router_dex_boundary");
    expect(report.hardBadEvidence.map((evidence) => evidence.kind)).not.toContain("llm_contract_suspicion");
  });

  it("treats high-confidence LLM drainer-like verdicts as hard evidence", () => {
    const report = buildIncomingDepositRiskReport({
      depositTxHash: "tx",
      watchedWallet: "TWatched",
      sender: "TSender",
      amountRaw: "100000000000",
      fastSenderRisk: lowFast,
      originPaths: [
        path({
          verdict: "DECLINE",
          score: 58,
          sourcePolicy: "medium_policy",
          stoppedReason: "unknown_contract_reached"
        })
      ],
      originCoverage: 0.92,
      senderRole: "unknown_wallet",
      senderCurrentBalanceRaw: null,
      contractVerdicts: [
        {
          source: "llm",
          cacheMatch: null,
          reusedFromContractAddress: null,
          providerLabel: "deepseek",
          model: "deepseek-v4-pro",
          contractAddress: "TContract",
          caseFileHash: "case-hash-llm",
          cacheId: null,
          verdict: "drainer_like",
          confidence: 0.82,
          contractRiskScore: 88,
          decisionRecommendation: "DECLINE",
          reasons: ["Contract behavior is drainer-like."],
          citedEvidenceIds: ["tx-llm"],
          falsePositiveNotes: []
        }
      ],
      warnings: []
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.depositRiskScore).toBeGreaterThanOrEqual(85);
    expect(report.hardBadEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "llm_contract_suspicion",
          evidenceIds: expect.arrayContaining(["tx-llm"])
        })
      ])
    );
  });
});
