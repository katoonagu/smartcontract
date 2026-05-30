import { describe, expect, it } from "vitest";
import type { ContractLlmVerdictSummary, IncomingDepositOriginPath, RiskReport } from "../../src/types";
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

  it("downgrades unknown contract deposit paths when LLM classifies the contract as a legitimate service", () => {
    const report = buildIncomingDepositRiskReport({
      depositTxHash: "cdbc",
      watchedWallet: "TEYPUt",
      sender: "TEaViA",
      amountRaw: "100000000000",
      fastSenderRisk: lowFast,
      originPaths: [
        path({
          verdict: "DECLINE",
          score: 58,
          sourcePolicy: "medium_policy",
          stoppedReason: "unknown_contract_reached",
          pathAddresses: ["TFrCNwncqXxa8ReHxmPh4jo6yFdFLR5hvh", "TEaViA", "TEYPUt"],
          amountCoverageRatio: 1,
          amountContinuity: "strong",
          proximityHops: 1,
          reasons: ["Deposit funding reaches an unknown smart-contract boundary."]
        })
      ],
      originCoverage: 1,
      senderRole: "collector",
      senderCurrentBalanceRaw: "0",
      contractVerdicts: [
        {
          source: "llm",
          cacheMatch: null,
          reusedFromContractAddress: null,
          providerLabel: "deepseek",
          model: "deepseek-v4-pro",
          contractAddress: "TFrCNwncqXxa8ReHxmPh4jo6yFdFLR5hvh",
          caseFileHash: "case-hash-legit-service",
          cacheId: null,
          verdict: "legitimate_service",
          confidence: 0,
          contractRiskScore: 10,
          decisionRecommendation: "ACCEPTABLE",
          reasons: ["Gas-free permit transfer service; no drainer-like patterns detected."],
          citedEvidenceIds: ["cdbc"],
          falsePositiveNotes: []
        }
      ],
      warnings: ["Sender current balance is zero after outgoing deposit; balance-origin mode is not applicable."]
    });

    expect(report.decision).toBe("ACCEPTABLE");
    expect(report.depositRiskScore).toBe(30);
    expect(report.riskBand).toBe("LOW-MEDIUM");
    expect(report.hardBadEvidence).toEqual([]);
    expect(report.reasons[0]).toContain("LLM classified the upstream contract as a legitimate service");
  });

  it("does not downgrade unknown contract paths when any LLM contract verdict is suspicious", () => {
    const report = buildIncomingDepositRiskReport({
      depositTxHash: "cdbc",
      watchedWallet: "TEYPUt",
      sender: "TEaViA",
      amountRaw: "100000000000",
      fastSenderRisk: lowFast,
      originPaths: [
        path({
          verdict: "DECLINE",
          score: 58,
          sourcePolicy: "medium_policy",
          stoppedReason: "unknown_contract_reached",
          pathAddresses: ["TFrCNwncqXxa8ReHxmPh4jo6yFdFLR5hvh", "TEaViA", "TEYPUt"],
          amountCoverageRatio: 1,
          amountContinuity: "strong",
          proximityHops: 1,
          reasons: ["Deposit funding reaches an unknown smart-contract boundary."]
        })
      ],
      originCoverage: 1,
      senderRole: "collector",
      senderCurrentBalanceRaw: "0",
      contractVerdicts: [
        {
          source: "llm",
          cacheMatch: null,
          reusedFromContractAddress: null,
          providerLabel: "deepseek",
          model: "deepseek-v4-pro",
          contractAddress: "TFrCNwncqXxa8ReHxmPh4jo6yFdFLR5hvh",
          caseFileHash: "case-hash-legit-service",
          cacheId: null,
          verdict: "legitimate_service",
          confidence: 0,
          contractRiskScore: 10,
          decisionRecommendation: "ACCEPTABLE",
          reasons: ["Gas-free permit transfer service; no drainer-like patterns detected."],
          citedEvidenceIds: ["cdbc"],
          falsePositiveNotes: []
        },
        {
          source: "llm",
          cacheMatch: null,
          reusedFromContractAddress: null,
          providerLabel: "deepseek",
          model: "deepseek-v4-pro",
          contractAddress: "TSuspicious",
          caseFileHash: "case-hash-suspicious",
          cacheId: null,
          verdict: "unknown_suspicious",
          confidence: 0.7,
          contractRiskScore: 72,
          decisionRecommendation: "DECLINE",
          reasons: ["Another upstream contract has suspicious transfer behavior."],
          citedEvidenceIds: ["suspicious-contract-in"],
          falsePositiveNotes: []
        }
      ],
      warnings: []
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.depositRiskScore).not.toBe(30);
    expect(report.reasons[0]).not.toContain("LLM classified the upstream contract as a legitimate service");
  });

  it("does not use a legitimate service verdict to clear unrelated unknown contract paths", () => {
    const report = buildIncomingDepositRiskReport({
      depositTxHash: "cdbc",
      watchedWallet: "TEYPUt",
      sender: "TEaViA",
      amountRaw: "100000000000",
      fastSenderRisk: lowFast,
      originPaths: [
        path({
          verdict: "DECLINE",
          score: 58,
          sourcePolicy: "medium_policy",
          stoppedReason: "unknown_contract_reached",
          pathAddresses: ["TGasFree", "TEaViA", "TEYPUt"],
          amountCoverageRatio: 0.5,
          amountContinuity: "strong",
          proximityHops: 1,
          reasons: ["Deposit funding reaches an unknown smart-contract boundary."]
        }),
        path({
          verdict: "DECLINE",
          score: 58,
          sourcePolicy: "medium_policy",
          stoppedReason: "unknown_contract_reached",
          pathAddresses: ["TStillUnknown", "TEaViA", "TEYPUt"],
          amountCoverageRatio: 0.5,
          amountContinuity: "strong",
          proximityHops: 1,
          reasons: ["Deposit funding reaches an unknown smart-contract boundary."]
        })
      ],
      originCoverage: 1,
      senderRole: "fresh_one_shot_wallet",
      senderCurrentBalanceRaw: "0",
      contractVerdicts: [
        {
          source: "deterministic",
          cacheMatch: null,
          reusedFromContractAddress: null,
          providerLabel: "deterministic-service-classifier",
          model: "service-classifier",
          contractAddress: "TGasFree",
          caseFileHash: "deterministic:TGasFree:service:GasFree",
          cacheId: null,
          verdict: "legitimate_service",
          confidence: 0.9,
          contractRiskScore: 25,
          decisionRecommendation: "ACCEPTABLE",
          reasons: ["Contract enrichment resolved the boundary as a legitimate service."],
          citedEvidenceIds: ["cdbc"],
          falsePositiveNotes: []
        }
      ],
      warnings: []
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.depositRiskScore).toBeGreaterThanOrEqual(60);
    expect(report.reasons[0]).not.toContain("LLM classified the upstream contract as a legitimate service");
  });

  it("does not accept operational senders when unknown contract analysis is unavailable", () => {
    const report = buildIncomingDepositRiskReport({
      depositTxHash: "cdbc",
      watchedWallet: "TEYPUt",
      sender: "TEaViA",
      amountRaw: "100000000000",
      fastSenderRisk: lowFast,
      originPaths: [
        path({
          verdict: "DECLINE",
          score: 58,
          sourcePolicy: "medium_policy",
          stoppedReason: "unknown_contract_reached",
          pathAddresses: ["TUnknownContract", "TEaViA", "TEYPUt"],
          amountCoverageRatio: 1,
          amountContinuity: "strong",
          proximityHops: 1,
          reasons: ["Deposit funding reaches an unknown smart-contract boundary."]
        })
      ],
      originCoverage: 1,
      senderRole: "operational_liquidity_wallet",
      senderCurrentBalanceRaw: "0",
      contractVerdicts: [],
      warnings: []
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.depositRiskScore).toBeGreaterThanOrEqual(45);
    expect(report.reasons[0]).toContain("Clean source is not proven");
  });

  it("accepts low-risk collector deposits when clean source is unproven but no bad evidence exists", () => {
    const report = buildIncomingDepositRiskReport({
      depositTxHash: "48d33",
      watchedWallet: "TEYPUt",
      sender: "TEaViA",
      amountRaw: "384064001319",
      fastSenderRisk: lowFast,
      originPaths: [
        path({
          verdict: "ACCEPTABLE",
          score: 35,
          sourcePolicy: "unknown",
          stoppedReason: "no_previous_transfer",
          amountCoverageRatio: 0,
          amountContinuity: "weak",
          proximityHops: 1,
          reasons: ["No previous inbound USDT transfer found before this deposit context."]
        })
      ],
      originCoverage: 0,
      senderRole: "collector",
      senderCurrentBalanceRaw: "0",
      contractVerdicts: [],
      warnings: ["Sender current balance is zero after outgoing deposit; balance-origin mode is not applicable."]
    });

    expect(report.decision).toBe("ACCEPTABLE");
    expect(report.depositRiskScore).toBe(32);
    expect(report.riskBand).toBe("LOW-MEDIUM");
    expect(report.hardBadEvidence).toEqual([]);
    expect(report.reasons[0]).toContain("clean source is not proven");
  });

  it("does not apply collector unresolved-origin downgrade when origin paths are missing", () => {
    const report = buildIncomingDepositRiskReport({
      depositTxHash: "48d33",
      watchedWallet: "TEYPUt",
      sender: "TEaViA",
      amountRaw: "384064001319",
      fastSenderRisk: lowFast,
      originPaths: [],
      originCoverage: 0,
      senderRole: "collector",
      senderCurrentBalanceRaw: "0",
      contractVerdicts: [],
      warnings: []
    });

    expect(report.depositRiskScore).toBe(45);
    expect(report.reasons[0]).not.toContain("established/collector-like");
  });

  it("does not apply collector unresolved-origin downgrade to contract-risk cases", () => {
    const suspiciousVerdict: ContractLlmVerdictSummary = {
      source: "llm",
      cacheMatch: null,
      reusedFromContractAddress: null,
      providerLabel: "deepseek",
      model: "deepseek-v4-pro",
      contractAddress: "TFcRN",
      caseFileHash: "case-hash-collector",
      cacheId: null,
      verdict: "unknown_suspicious",
      confidence: 0.8,
      contractRiskScore: 72,
      decisionRecommendation: "DECLINE",
      reasons: ["Unknown contract funded collector shortly before deposit."],
      citedEvidenceIds: ["contract-in"],
      falsePositiveNotes: []
    };

    const cases = [
      {
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
        contractVerdicts: []
      },
      {
        originPaths: [
          path({
            score: 35,
            sourcePolicy: "unknown",
            stoppedReason: "no_previous_transfer",
            amountCoverageRatio: 0,
            amountContinuity: "weak"
          })
        ],
        contractVerdicts: [suspiciousVerdict]
      }
    ];

    for (const testCase of cases) {
      const report = buildIncomingDepositRiskReport({
        depositTxHash: "48d33",
        watchedWallet: "TEYPUt",
        sender: "TEaViA",
        amountRaw: "384064001319",
        fastSenderRisk: lowFast,
        originPaths: testCase.originPaths,
        originCoverage: 0.92,
        senderRole: "collector",
        senderCurrentBalanceRaw: "0",
        contractVerdicts: testCase.contractVerdicts,
        warnings: []
      });

      expect(report.decision).toBe("DECLINE");
      expect(report.depositRiskScore).not.toBe(32);
      expect(report.reasons[0]).not.toContain("established/collector-like");
    }
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

  it("does not downgrade hard evidence when LLM classifies another upstream contract as a legitimate service", () => {
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
        }),
        path({
          verdict: "DECLINE",
          score: 58,
          sourcePolicy: "medium_policy",
          stoppedReason: "unknown_contract_reached",
          pathAddresses: ["TContract", "TSender", "TWatched"],
          reasons: ["Deposit funding reaches an unknown smart-contract boundary."]
        })
      ],
      originCoverage: 1,
      senderRole: "collector",
      senderCurrentBalanceRaw: "0",
      contractVerdicts: [
        {
          source: "llm",
          cacheMatch: null,
          reusedFromContractAddress: null,
          providerLabel: "deepseek",
          model: "deepseek-v4-pro",
          contractAddress: "TContract",
          caseFileHash: "case-hash-hard-evidence",
          cacheId: null,
          verdict: "legitimate_service",
          confidence: 0,
          contractRiskScore: 10,
          decisionRecommendation: "ACCEPTABLE",
          reasons: ["Gas-free permit transfer service; no drainer-like patterns detected."],
          citedEvidenceIds: ["tx"],
          falsePositiveNotes: []
        }
      ],
      warnings: []
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.depositRiskScore).toBeGreaterThanOrEqual(78);
    expect(report.hardBadEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "htx_huobi_source"
        })
      ])
    );
    expect(report.reasons[0]).not.toContain("legitimate service");
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

  it("declines material close WhiteBIT provenance even for operational senders", () => {
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
          amountCoverageRatio: 0.9,
          proximityHops: 1,
          reasons: ["Deposit path reaches WhiteBIT."]
        })
      ],
      originCoverage: 0.9,
      senderRole: "operational_liquidity_wallet",
      senderCurrentBalanceRaw: "0",
      contractVerdicts: [],
      warnings: []
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.depositRiskScore).toBe(52);
    expect(report.hardBadEvidence).toEqual([]);
    expect(report.reasons[0]).toContain("WhiteBIT is medium policy risk");
  });

  it("declines material close WhiteBIT provenance before applying legitimate-service contract downgrade", () => {
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
          amountCoverageRatio: 0.9,
          proximityHops: 1,
          reasons: ["Deposit path reaches WhiteBIT."]
        }),
        path({
          verdict: "DECLINE",
          score: 35,
          sourcePolicy: "medium_policy",
          stoppedReason: "unknown_contract_reached",
          pathAddresses: ["TContract", "TSender", "TWatched"],
          reasons: ["Deposit funding reaches an unknown smart-contract boundary."]
        })
      ],
      originCoverage: 0.9,
      senderRole: "collector",
      senderCurrentBalanceRaw: "0",
      contractVerdicts: [
        {
          source: "llm",
          cacheMatch: null,
          reusedFromContractAddress: null,
          providerLabel: "deepseek",
          model: "deepseek-v4-pro",
          contractAddress: "TContract",
          caseFileHash: "case-hash-whitebit-legit-service",
          cacheId: null,
          verdict: "legitimate_service",
          confidence: 0,
          contractRiskScore: 10,
          decisionRecommendation: "ACCEPTABLE",
          reasons: ["Gas-free permit transfer service; no drainer-like patterns detected."],
          citedEvidenceIds: ["tx"],
          falsePositiveNotes: []
        }
      ],
      warnings: []
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.depositRiskScore).toBe(52);
    expect(report.hardBadEvidence).toEqual([]);
    expect(report.reasons[0]).toContain("WhiteBIT is medium policy risk");
    expect(report.reasons[0]).not.toContain("legitimate service");
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
