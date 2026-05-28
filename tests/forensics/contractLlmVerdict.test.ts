import { describe, expect, it } from "vitest";
import {
  applyContractLlmVerdictsToDecision,
  buildContractAnalysisCaseFiles,
  createContractLlmVerdictAnalyzer,
  createUnavailableContractLlmVerdict,
  hashContractFlowContextForLlm
} from "../../src/forensics/contractLlmVerdict";
import type {
  ApprovalDrainReviewFinding,
  BalanceFormingTransfer,
  ContractLlmVerdictSummary,
  MoneyOriginPath,
  ServiceClassification
} from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const victim = "TVictim1111111111111111111111111111";
const wrapperContract = "TWrapper11111111111111111111111111";
const wrapperCloneContract = "TWrapper22222222222222222222222222";
const operator = "TOperator111111111111111111111111111";

function service(category: ServiceClassification["category"], identity: string | null): ServiceClassification {
  return {
    category,
    identity,
    confidence: "high",
    evidence: identity ? [`tag:${identity}`] : [],
    isBoundary: category !== "none"
  };
}

const balanceTransfer: BalanceFormingTransfer = {
  txHash: "tx-balance",
  fromAddress: "TSender11111111111111111111111111111",
  toAddress: subject,
  amountRaw: "1100000000",
  timestamp: "2026-05-22T10:05:00.000Z",
  coverageShare: 1,
  selectedReason: "covers_current_balance"
};

const originPath: MoneyOriginPath = {
  balanceTransferTxHash: "tx-balance",
  rootSourceAddress: wrapperContract,
  rootSourceType: "unknown",
  pathAddresses: [wrapperContract, subject],
  txHashes: ["tx-balance"],
  steps: [
    {
      txHash: "tx-balance",
      fromAddress: wrapperContract,
      toAddress: subject,
      amountRaw: "1100000000",
      timestamp: "2026-05-22T10:05:00.000Z"
    }
  ],
  amountPreservationRatio: 1,
  timeSpanMs: null,
  stoppedReason: "unlabeled_service_boundary",
  verdict: "REVIEW",
  riskScoreContribution: 50,
  reasons: ["Balance-forming path reaches unlabeled service boundary."]
};

const reviewFinding: ApprovalDrainReviewFinding = {
  victimAddress: victim,
  drainTxHash: "tx-wrapper-drain",
  spenderAddress: wrapperContract,
  operatorAddress: operator,
  spenderResolution: "wrapper_contract",
  firstReceiverAddress: subject,
  subjectAddress: subject,
  reason: "path_not_proven",
  falsePositiveGuards: [],
  supportingFingerprints: [
    {
      code: "nearby_non_usdt_token_transfer",
      label: "Nearby non-USDT token transfer observed.",
      value: "BTTOLD"
    }
  ]
};

describe("contract LLM verdict case files", () => {
  it("builds a case file for an origin-path unknown contract boundary without approval-drain evidence", () => {
    const caseFiles = buildContractAnalysisCaseFiles({
      subjectAddress: subject,
      currentUsdtBalanceRaw: "1100000000",
      balanceFormingTransfers: [balanceTransfer],
      originPaths: [
        {
          ...originPath,
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          verdict: "DECLINE",
          riskScoreContribution: 78,
          reasons: ["Balance-forming path reaches unknown_contract boundary."]
        }
      ],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [],
      classifications: new Map([[wrapperContract, service("unknown_contract", null)]])
    });

    expect(caseFiles).toHaveLength(1);
    expect(caseFiles[0]).toMatchObject({
      contractAddress: wrapperContract,
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [],
      serviceClassification: {
        category: "unknown_contract",
        isBoundary: true
      }
    });
    expect(caseFiles[0].originPaths).toEqual([
      expect.objectContaining({
        rootSourceAddress: wrapperContract,
        verdict: "DECLINE"
      })
    ]);
    expect(caseFiles[0].evidenceIds).toEqual(expect.arrayContaining(["tx-balance", wrapperContract]));
  });

  it("builds an objective case file for a wrapper approval-drain review finding", () => {
    const caseFiles = buildContractAnalysisCaseFiles({
      subjectAddress: subject,
      currentUsdtBalanceRaw: "1100000000",
      balanceFormingTransfers: [balanceTransfer],
      originPaths: [originPath],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [reviewFinding],
      classifications: new Map([[wrapperContract, service("unknown_contract", null)]]),
      contractProfiles: new Map([
        [
          wrapperContract,
          {
            contractAddress: wrapperContract,
            methodMap: { deadbeef: "Verify20(address,address,uint256)" },
            topMethods: [{ methodId: "deadbeef", signature: "Verify20(address,address,uint256)", count: 4, ratio: 1 }],
            providerTags: [],
            publicTags: [],
            isVerified: false,
            providerRisk: null,
            rawPayload: { source_status: "available" },
            hasTransferFromSelector: false,
            hasOwnerOnlyPattern: false,
            lowMetadata: true,
            activityLevel: "low"
          }
        ]
      ])
    });

    expect(caseFiles).toHaveLength(1);
    expect(caseFiles[0]).toMatchObject({
      subjectAddress: subject,
      checkedWalletAddress: subject,
      contractAddress: wrapperContract,
      currentUsdtBalanceRaw: "1100000000",
      approvalDrainReviewFindings: [
        expect.objectContaining({
          spenderAddress: wrapperContract,
          operatorAddress: operator,
          reason: "path_not_proven"
        })
      ],
      serviceClassification: {
        category: "unknown_contract",
        isBoundary: true
      },
      contractProfile: {
        methodMap: { deadbeef: "Verify20(address,address,uint256)" },
        lowMetadata: true
      }
    });
    expect(caseFiles[0].evidenceIds).toEqual(expect.arrayContaining(["tx-wrapper-drain", "tx-balance", wrapperContract]));
    expect(caseFiles[0].approvalDrainReviewFindings[0].supportingFingerprints).toEqual([
      expect.objectContaining({ code: "nearby_non_usdt_token_transfer", value: "BTTOLD" })
    ]);
  });

  it("hashes drainer review and known service flow contexts differently for the same static contract profile", () => {
    const staticContractProfile = {
      contractAddress: wrapperContract,
      methodMap: { deadbeef: "Verify20(address,address,uint256)" },
      topMethods: [{ methodId: "deadbeef", signature: "Verify20(address,address,uint256)", count: 4, ratio: 1 }],
      providerTags: [],
      publicTags: [],
      isVerified: true,
      providerRisk: null,
      rawPayload: { source_status: "available" },
      hasTransferFromSelector: false,
      hasOwnerOnlyPattern: false,
      lowMetadata: false,
      activityLevel: "high" as const
    };
    const drainerReviewCase = buildContractAnalysisCaseFiles({
      subjectAddress: subject,
      currentUsdtBalanceRaw: "1100000000",
      balanceFormingTransfers: [balanceTransfer],
      originPaths: [originPath],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [reviewFinding],
      classifications: new Map([[wrapperContract, service("unknown_contract", null)]]),
      contractProfiles: new Map([[wrapperContract, staticContractProfile]])
    })[0];
    const knownRouterCase = buildContractAnalysisCaseFiles({
      subjectAddress: subject,
      currentUsdtBalanceRaw: "1100000000",
      balanceFormingTransfers: [balanceTransfer],
      originPaths: [
        {
          ...originPath,
          rootSourceType: "allowlist_cex",
          stoppedReason: "allowlist_cex_reached",
          verdict: "ACCEPTABLE",
          riskScoreContribution: 0,
          reasons: ["Balance-forming path reaches a known router boundary."]
        }
      ],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [],
      classifications: new Map([[wrapperContract, service("router", "JustSwap Router")]]),
      contractProfiles: new Map([[wrapperContract, staticContractProfile]])
    })[0];

    expect(drainerReviewCase.contractProfile).toEqual(knownRouterCase.contractProfile);
    expect(hashContractFlowContextForLlm(drainerReviewCase)).not.toBe(hashContractFlowContextForLlm(knownRouterCase));
  });

  it("hashes different approval-drain review reasons and guard contexts differently", () => {
    const staticContractProfile = {
      contractAddress: wrapperContract,
      methodMap: { deadbeef: "Verify20(address,address,uint256)" },
      topMethods: [{ methodId: "deadbeef", signature: "Verify20(address,address,uint256)", count: 4, ratio: 1 }],
      providerTags: [],
      publicTags: [],
      isVerified: true,
      providerRisk: null,
      rawPayload: { source_status: "available" },
      hasTransferFromSelector: false,
      hasOwnerOnlyPattern: false,
      lowMetadata: false,
      activityLevel: "high" as const
    };
    const approvalMissingCase = buildContractAnalysisCaseFiles({
      subjectAddress: subject,
      currentUsdtBalanceRaw: "1100000000",
      balanceFormingTransfers: [balanceTransfer],
      originPaths: [originPath],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [
        {
          ...reviewFinding,
          reason: "approval_not_found",
          falsePositiveGuards: [],
          supportingFingerprints: []
        }
      ],
      classifications: new Map([[wrapperContract, service("unknown_contract", null)]]),
      contractProfiles: new Map([[wrapperContract, staticContractProfile]])
    })[0];
    const guardedServiceCase = buildContractAnalysisCaseFiles({
      subjectAddress: subject,
      currentUsdtBalanceRaw: "1100000000",
      balanceFormingTransfers: [balanceTransfer],
      originPaths: [originPath],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [
        {
          ...reviewFinding,
          reason: "service_boundary_guard",
          falsePositiveGuards: [
            {
              code: "receiver_service_boundary",
              label: "Receiver is a known router boundary.",
              address: subject,
              category: "router",
              identity: "JustSwap Router"
            }
          ],
          supportingFingerprints: [
            {
              code: "amount_preservation",
              label: "Amount is preserved through a service route.",
              value: true
            }
          ]
        }
      ],
      classifications: new Map([[wrapperContract, service("unknown_contract", null)]]),
      contractProfiles: new Map([[wrapperContract, staticContractProfile]])
    })[0];

    expect(approvalMissingCase.contractProfile).toEqual(guardedServiceCase.contractProfile);
    expect(hashContractFlowContextForLlm(approvalMissingCase)).not.toBe(hashContractFlowContextForLlm(guardedServiceCase));
  });

  it("uses LLM drainer-like verdicts to produce a final decline", () => {
    const verdict: ContractLlmVerdictSummary = {
      source: "llm",
      providerLabel: "deepseek",
      model: "deepseek-v4-flash",
      contractAddress: wrapperContract,
      caseFileHash: "case-hash",
      cacheId: null,
      verdict: "drainer_like",
      confidence: 0.82,
      contractRiskScore: 88,
      decisionRecommendation: "DECLINE",
      reasons: ["Wrapper method hides token movement."],
      citedEvidenceIds: ["tx-wrapper-drain"],
      falsePositiveNotes: []
    };

    const result = applyContractLlmVerdictsToDecision({
      deterministicDecision: "REVIEW",
      deterministicRiskScore: 50,
      deterministicReasons: ["Unlabeled service boundary."],
      verdicts: [verdict],
      riskyMoneyPath: true
    });

    expect(result).toMatchObject({
      decision: "DECLINE",
      riskScore: 88
    });
    expect(result.decisionReasons).toEqual(expect.arrayContaining([
      "AI contract verdict: drainer_like 82% confidence; Wrapper method hides token movement."
    ]));
  });

  it("declines by safe default when LLM is unavailable for an uncertain contract case", () => {
    const verdict = createUnavailableContractLlmVerdict({
      contractAddress: wrapperContract,
      caseFileHash: "case-hash",
      providerLabel: "deepseek",
      model: "deepseek-v4-flash",
      error: "llm disabled"
    });

    const result = applyContractLlmVerdictsToDecision({
      deterministicDecision: "REVIEW",
      deterministicRiskScore: 45,
      deterministicReasons: ["No previous inbound USDT transfer found."],
      verdicts: [verdict],
      riskyMoneyPath: true
    });

    expect(result.decision).toBe("DECLINE");
    expect(result.riskScore).toBe(65);
    expect(result.decisionReasons[0]).toContain("Clean source could not be proven");
  });

  it("reuses an in-memory fingerprint verdict for an identical new contract without calling LLM twice", async () => {
    const firstCase = buildContractAnalysisCaseFiles({
      subjectAddress: subject,
      currentUsdtBalanceRaw: "1100000000",
      balanceFormingTransfers: [balanceTransfer],
      originPaths: [originPath],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [reviewFinding],
      classifications: new Map([[wrapperContract, service("unknown_contract", null)]]),
      contractProfiles: new Map([
        [
          wrapperContract,
          {
            contractAddress: wrapperContract,
            methodMap: { deadbeef: "Verify20(address,address,uint256)" },
            topMethods: [{ methodId: "deadbeef", signature: "Verify20(address,address,uint256)", count: 4, ratio: 1 }],
            providerTags: [],
            publicTags: [],
            isVerified: false,
            providerRisk: null,
            rawPayload: { contract: { address: wrapperContract, source_code: "contract X { function Verify20() public {} }" } },
            hasTransferFromSelector: false,
            hasOwnerOnlyPattern: false,
            lowMetadata: true,
            activityLevel: "low"
          }
        ]
      ])
    })[0];
    const secondCase = {
      ...firstCase,
      subjectAddress: "TSubject222222222222222222222222222222",
      checkedWalletAddress: "TSubject222222222222222222222222222222",
      contractAddress: wrapperCloneContract,
      contractProfile: {
        ...firstCase.contractProfile,
        contractAddress: wrapperCloneContract,
        rawPayload: { contract: { address: wrapperCloneContract, source_code: "contract X { function Verify20() public {} }" } }
      },
      evidenceIds: [wrapperCloneContract, "tx-clone"]
    };
    const client = {
      completeJson: async (_input: unknown) => ({
        ok: true as const,
        providerLabel: "deepseek",
        model: "deepseek-v4-flash",
        json: {
          verdict: "drainer_like",
          confidence: 0.9,
          contractRiskScore: 90,
          decisionRecommendation: "DECLINE",
          reasons: ["Same static contract fingerprint is drainer-like."],
          citedEvidenceIds: ["tx-wrapper-drain"],
          falsePositiveNotes: []
        },
        rawText: "{}",
        latencyMs: 10
      })
    };
    let llmCalls = 0;
    const analyzer = createContractLlmVerdictAnalyzer({
      client: {
        completeJson: async (input) => {
          llmCalls += 1;
          return client.completeJson(input);
        }
      },
      providerLabel: "deepseek",
      model: "deepseek-v4-flash",
      cacheTtlMs: 60_000,
      now: () => new Date("2026-05-28T00:00:00.000Z")
    });

    const verdicts = await analyzer([firstCase, secondCase]);

    expect(llmCalls).toBe(1);
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0]).toMatchObject({
      source: "llm",
      contractAddress: wrapperContract,
      verdict: "drainer_like"
    });
    expect(verdicts[1]).toMatchObject({
      source: "cache",
      cacheMatch: "fingerprint",
      reusedFromContractAddress: wrapperContract,
      contractAddress: wrapperCloneContract,
      verdict: "drainer_like"
    });
  });

  it("uses the inference cache key while keeping the public model name in the verdict", async () => {
    const caseFile = buildContractAnalysisCaseFiles({
      subjectAddress: subject,
      currentUsdtBalanceRaw: "1100000000",
      balanceFormingTransfers: [balanceTransfer],
      originPaths: [originPath],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [reviewFinding],
      classifications: new Map([[wrapperContract, service("unknown_contract", null)]])
    })[0];
    const cacheModelKey = "provider=deepseek|model=deepseek-v4-pro|thinking=enabled|reasoning=max";
    const lookupModels: string[] = [];
    const upsertModels: string[] = [];
    const analyzer = createContractLlmVerdictAnalyzer({
      client: {
        completeJson: async () => ({
          ok: true,
          providerLabel: "deepseek",
          model: "deepseek-v4-pro",
          json: {
            verdict: "unknown_suspicious",
            confidence: 0.8,
            contractRiskScore: 82,
            decisionRecommendation: "DECLINE",
            reasons: ["Unknown contract boundary has no service proof."],
            citedEvidenceIds: ["tx-balance"],
            falsePositiveNotes: []
          },
          rawText: "{}",
          latencyMs: 10
        })
      },
      providerLabel: "deepseek",
      model: "deepseek-v4-pro",
      cacheModelKey,
      cacheTtlMs: 60_000,
      now: () => new Date("2026-05-28T00:00:00.000Z"),
      getCachedVerdict: async (input) => {
        lookupModels.push(input.model);
        expect(input.cacheScope).toBe("address_flow");
        expect(input.flowContextHash).toEqual(expect.any(String));
        return null;
      },
      getCachedVerdictByFingerprint: async (input) => {
        lookupModels.push(input.model);
        expect(input.cacheScope).toBe("address_flow");
        expect(input.flowContextHash).toEqual(expect.any(String));
        return null;
      },
      upsertVerdict: async (input) => {
        upsertModels.push(input.model);
        expect(input.cacheScope).toBe("address_flow");
        expect(input.flowContextHash).toEqual(expect.any(String));
      }
    });

    const verdicts = await analyzer([caseFile]);

    expect(lookupModels).toEqual([cacheModelKey, cacheModelKey]);
    expect(upsertModels).toEqual([cacheModelKey]);
    expect(verdicts[0]).toMatchObject({
      source: "llm",
      model: "deepseek-v4-pro",
      verdict: "unknown_suspicious"
    });
  });

  it("does not cache transient unavailable LLM failures", async () => {
    const caseFile = buildContractAnalysisCaseFiles({
      subjectAddress: subject,
      currentUsdtBalanceRaw: "1100000000",
      balanceFormingTransfers: [balanceTransfer],
      originPaths: [originPath],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [],
      classifications: new Map([[wrapperContract, service("unknown_contract", null)]])
    })[0];
    let llmCalls = 0;
    const analyzer = createContractLlmVerdictAnalyzer({
      client: {
        completeJson: async () => {
          llmCalls += 1;
          if (llmCalls === 1) {
            return {
              ok: false,
              providerLabel: "deepseek",
              model: "deepseek-v4-flash",
              errorCode: "network_error",
              error: "fetch failed",
              latencyMs: 20
            };
          }
          return {
            ok: true,
            providerLabel: "deepseek",
            model: "deepseek-v4-flash",
            json: {
              verdict: "unknown_suspicious",
              confidence: 0.8,
              contractRiskScore: 82,
              decisionRecommendation: "DECLINE",
              reasons: ["Unknown contract boundary has no service proof."],
              citedEvidenceIds: ["tx-balance"],
              falsePositiveNotes: []
            },
            rawText: "{}",
            latencyMs: 10
          };
        }
      },
      providerLabel: "deepseek",
      model: "deepseek-v4-flash",
      cacheTtlMs: 60_000,
      now: () => new Date("2026-05-28T00:00:00.000Z")
    });

    const first = await analyzer([caseFile]);
    const second = await analyzer([caseFile]);

    expect(llmCalls).toBe(2);
    expect(first[0]).toMatchObject({ source: "unavailable", error: "fetch failed" });
    expect(second[0]).toMatchObject({
      source: "llm",
      verdict: "unknown_suspicious",
      contractRiskScore: 82
    });
  });
});
