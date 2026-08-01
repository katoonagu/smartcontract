import { describe, expect, it } from "vitest";
import {
  applyContractLlmVerdictsToDecision,
  buildContractAnalysisCaseFiles,
  CONTRACT_LLM_VERDICT_POLICY_VERSION,
  createContractLlmVerdictAnalyzer,
  createUnavailableContractLlmVerdict,
  hashContractFlowContextForLlm
} from "../../src/forensics/contractLlmVerdict";
import { buildStandaloneContractAnalysisCaseFile } from "../../src/check/smartContractCheck";
import type { ContractLlmVerdictCacheRecord } from "../../src/forensics/contractLlmVerdict";
import type { CompleteJsonInput } from "../../src/llm/openAiCompatibleJsonClient";
import type { AddressMetadata, WalletApprovalSpenderRelation } from "../../src/storage/repositories";
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
const tlhvzkSubject = "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe";
const tjpmjContract = "TJpMjCCA111111111111111111111DvaQ";
const turnbcReceiver = "TUrnbc111111111111111111111111111";

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

function standaloneMetadata(overrides: Partial<AddressMetadata> = {}): AddressMetadata {
  return {
    address: wrapperContract,
    source: "tronscan",
    name: null,
    tag: null,
    isContract: true,
    verified: false,
    accountType: null,
    rawJson: {},
    fetchedAt: new Date("2026-06-01T00:00:00.000Z"),
    expiresAt: new Date("2026-06-02T00:00:00.000Z"),
    ...overrides
  };
}

function standaloneApproval(overrides: Partial<WalletApprovalSpenderRelation> = {}): WalletApprovalSpenderRelation {
  return {
    watchedWalletId: "wallet-1",
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    spenderAddress: wrapperContract,
    amountRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    isUnlimited: true,
    currentAllowanceRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    spenderType: "contract",
    status: "active",
    lastApprovalTxHash: "standalone-approval-tx-1",
    lastApprovalAt: new Date("2026-06-01T00:00:00.000Z"),
    riskLevel: "MEDIUM",
    riskScore: 45,
    riskReasons: [],
    lastAlertedTxHash: null,
    metadataName: null,
    metadataTag: null,
    metadataSource: "tronscan",
    metadataIsContract: true,
    contractServiceTag: null,
    contractVerified: false,
    contractActivityLevel: "low",
    contractTopMethods: [],
    contractHasTransferFromSelector: false,
    contractHasOwnerOnlyPattern: false,
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    watchedWalletAddress: "TWallet111111111111111111111111111111",
    watchedWalletTelegramUserId: "123",
    ...overrides
  };
}

describe("contract LLM verdict case files", () => {
  it("builds a case file for a high-share terminal boundary without classification or profile", () => {
    const terminalBoundary = "TLUV5twBEFd3UNZc9bk5SiTn3PE7dfDTVZ";
    const caseFiles = buildContractAnalysisCaseFiles({
      subjectAddress: subject,
      currentUsdtBalanceRaw: "1100000000",
      balanceFormingTransfers: [balanceTransfer],
      originPaths: [
        {
          ...originPath,
          rootSourceAddress: terminalBoundary,
          rootSourceType: "incomplete",
          pathAddresses: [terminalBoundary, subject],
          txHashes: ["tx-main"],
          balanceShare: 0.9993,
          sourceExposureKind: null,
          stoppedReason: "unlabeled_service_boundary",
          verdict: "REVIEW",
          riskScoreContribution: 45
        }
      ],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [],
      classifications: new Map(),
      contractProfiles: new Map()
    });

    const terminalCaseFile = caseFiles.find((caseFile) => caseFile.contractAddress === terminalBoundary);
    expect(terminalCaseFile).toBeDefined();
    expect(terminalCaseFile?.originPaths).toEqual([
      expect.objectContaining({
        rootSourceAddress: terminalBoundary,
        txHashes: ["tx-main"]
      })
    ]);
    expect(terminalCaseFile?.evidenceIds).toEqual(expect.arrayContaining(["tx-main", terminalBoundary]));
  });

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

  it("marks TLhVzk/TJpMj-style approval review findings as unresolved candidates, not exact drain proof", () => {
    const caseFiles = buildContractAnalysisCaseFiles({
      subjectAddress: tlhvzkSubject,
      currentUsdtBalanceRaw: "147000",
      balanceFormingTransfers: [
        {
          txHash: "tx-tlhvzk-balance",
          fromAddress: turnbcReceiver,
          toAddress: tlhvzkSubject,
          amountRaw: "89473150000",
          timestamp: "2026-05-05T08:49:27.000Z",
          coverageShare: 1,
          selectedReason: "funds_recent_outgoing"
        }
      ],
      originPaths: [
        {
          ...originPath,
          balanceTransferTxHash: "tx-tlhvzk-balance",
          rootSourceAddress: turnbcReceiver,
          pathAddresses: [turnbcReceiver, tlhvzkSubject],
          txHashes: ["tx-tlhvzk-balance"],
          stoppedReason: "unlabeled_service_boundary",
          verdict: "REVIEW",
          riskScoreContribution: 50,
          reasons: ["Balance-forming path reaches UniV3Adapter swap adapter boundary."]
        }
      ],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [
        {
          victimAddress: victim,
          drainTxHash: "tx-tjpmj-candidate",
          spenderAddress: tjpmjContract,
          operatorAddress: operator,
          spenderResolution: "wrapper_contract",
          firstReceiverAddress: turnbcReceiver,
          subjectAddress: tlhvzkSubject,
          reason: "approval_not_found",
          falsePositiveGuards: [
            {
              code: "receiver_service_boundary",
              label: "First receiver is a swap adapter service boundary.",
              address: turnbcReceiver,
              category: "swap_adapter",
              identity: "UniV3Adapter"
            }
          ],
          supportingFingerprints: [
            {
              code: "misleading_wrapper_method",
              label: "Wrapper method name can mislead reviewers.",
              value: "Verify20"
            },
            {
              code: "nearby_non_usdt_token_transfer",
              label: "Nearby non-USDT token movement observed.",
              value: "marker-token"
            }
          ]
        }
      ],
      classifications: new Map([
        [tjpmjContract, service("unknown_contract", null)],
        [turnbcReceiver, service("swap_adapter", "UniV3Adapter")]
      ]),
      contractProfiles: new Map([
        [
          tjpmjContract,
          {
            contractAddress: tjpmjContract,
            methodMap: { deadbeef: "Verify20(address,address,uint256)" },
            topMethods: [{ methodId: "deadbeef", signature: "Verify20(address,address,uint256)", count: 1, ratio: 1 }],
            providerTags: [],
            publicTags: [],
            isVerified: false,
            providerRisk: null,
            hasTransferFromSelector: false,
            hasOwnerOnlyPattern: false,
            lowMetadata: true,
            activityLevel: "low",
            rawPayload: {}
          }
        ]
      ])
    });

    expect(caseFiles).toHaveLength(2);
    const contractCase = caseFiles.find((caseFile) => caseFile.contractAddress === tjpmjContract);

    expect(contractCase).toBeDefined();
    expect(contractCase).toMatchObject({
      policyVersion: CONTRACT_LLM_VERDICT_POLICY_VERSION,
      contractAddress: tjpmjContract,
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewInterpretations: [
        {
          drainTxHash: "tx-tjpmj-candidate",
          spenderAddress: tjpmjContract,
          firstReceiverAddress: turnbcReceiver,
          reason: "approval_not_found",
          reviewFindingInterpretation: "candidate_only_not_exact_proof",
          exactApprovalProofStatus: "not_found",
          transferFromProofStatus: "suspected_wrapper",
          spenderMatchStatus: "matched",
          pathToCheckedWalletStatus: "not_proven"
        }
      ]
    });
    expect(contractCase?.approvalDrainReviewFindings[0].supportingFingerprints.map((item) => item.code)).toEqual([
      "misleading_wrapper_method",
      "nearby_non_usdt_token_transfer"
    ]);
  });

  it("does not upgrade approval_not_found review findings even when a similar exact profile exists", () => {
    const caseFiles = buildContractAnalysisCaseFiles({
      subjectAddress: subject,
      currentUsdtBalanceRaw: "1100000000",
      balanceFormingTransfers: [balanceTransfer],
      originPaths: [originPath],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [
        {
          victimAddress: "TOtherVictim111111111111111111111111",
          approvalTxHash: "tx-other-approve",
          drainTxHash: "tx-wrapper-drain",
          spenderAddress: wrapperContract,
          operatorAddress: operator,
          spenderResolution: "wrapper_contract",
          falsePositiveGuards: [],
          supportingFingerprints: [],
          firstReceiverAddress: "TOtherReceiver111111111111111111111",
          subjectAddress: "TOtherSubject1111111111111111111111",
          hopDepth: 0,
          amountRaw: "1100000000",
          amountPreservationRatio: 1,
          approvalAt: "2026-05-22T09:59:00.000Z",
          drainAt: "2026-05-22T10:00:00.000Z",
          pathTxHashes: ["tx-wrapper-drain"],
          pathAddresses: ["TOtherVictim111111111111111111111111", "TOtherSubject1111111111111111111111"],
          score: 96,
          evidenceStrength: "exact_approval_and_transfer_from",
          subjectTokenState: null,
          victimTokenState: null,
          features: []
        }
      ],
      approvalDrainReviewFindings: [
        {
          ...reviewFinding,
          reason: "approval_not_found"
        }
      ],
      classifications: new Map([[wrapperContract, service("unknown_contract", null)]])
    });

    expect(caseFiles[0]).toMatchObject({
      approvalDrainReviewInterpretations: [
        expect.objectContaining({
          drainTxHash: "tx-wrapper-drain",
          reviewFindingInterpretation: "candidate_only_not_exact_proof",
          exactApprovalProofStatus: "not_found",
          transferFromProofStatus: "suspected_wrapper",
          pathToCheckedWalletStatus: "not_proven"
        })
      ]
    });
  });

  it("includes recent-flow selected reason and anchor tx evidence in contract case files", () => {
    const recentFlowTransfer: BalanceFormingTransfer = {
      txHash: "funding-in",
      fromAddress: wrapperContract,
      toAddress: subject,
      amountRaw: "89473150000",
      timestamp: "2026-05-05T08:00:00.000Z",
      coverageShare: 1,
      selectedReason: "funds_recent_outgoing"
    };
    const caseFiles = buildContractAnalysisCaseFiles({
      subjectAddress: subject,
      currentUsdtBalanceRaw: "147000",
      balanceFormingTransfers: [recentFlowTransfer],
      originPaths: [
        {
          ...originPath,
          balanceTransferTxHash: "funding-in",
          rootSourceAddress: wrapperContract,
          stoppedReason: "unlabeled_service_boundary",
          txHashes: ["funding-in", "out-anchor"]
        }
      ],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [],
      classifications: new Map([[wrapperContract, service("unknown_contract", null)]]),
      contractProfiles: new Map()
    });

    expect(caseFiles[0]?.balanceFormingTransfers[0]?.selectedReason).toBe("funds_recent_outgoing");
    expect(caseFiles[0]?.evidenceIds).toEqual(expect.arrayContaining(["funding-in", "out-anchor", wrapperContract]));
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
    expect(hashContractFlowContextForLlm(drainerReviewCase)).not.toBe(hashContractFlowContextForLlm({
      ...drainerReviewCase,
      approvalDrainReviewFindings: []
    }));
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

  it("hashes standalone contract cases differently when an active approval is present", () => {
    const baseCase = buildStandaloneContractAnalysisCaseFile({
      address: wrapperContract,
      metadata: standaloneMetadata(),
      contractProfile: null,
      serviceClassification: service("unknown_contract", null),
      relatedApprovals: []
    });
    const activeApprovalCase = buildStandaloneContractAnalysisCaseFile({
      address: wrapperContract,
      metadata: standaloneMetadata(),
      contractProfile: null,
      serviceClassification: service("unknown_contract", null),
      relatedApprovals: [standaloneApproval()]
    });

    expect(baseCase.contractAddress).toBe(activeApprovalCase.contractAddress);
    expect(hashContractFlowContextForLlm(baseCase)).not.toBe(hashContractFlowContextForLlm(activeApprovalCase));
  });

  it("uses standalone case policy version for cache lookup and storage", async () => {
    const caseFile = buildStandaloneContractAnalysisCaseFile({
      address: wrapperContract,
      metadata: standaloneMetadata(),
      contractProfile: null,
      serviceClassification: service("unknown_contract", null),
      relatedApprovals: [standaloneApproval()]
    });
    const lookupPolicyVersions: string[] = [];
    const upsertPolicyVersions: string[] = [];
    const analyzer = createContractLlmVerdictAnalyzer({
      client: {
        completeJson: async () => ({
          ok: true,
          providerLabel: "deepseek",
          model: "deepseek-v4-pro",
          json: {
            verdict: "unknown_suspicious",
            confidence: 0.8,
            contractRiskScore: 70,
            decisionRecommendation: "DECLINE",
            reasons: ["Standalone approval context remains risky."],
            citedEvidenceIds: ["approval_1"],
            falsePositiveNotes: []
          },
          rawText: "{}",
          latencyMs: 10
        })
      },
      providerLabel: "deepseek",
      model: "deepseek-v4-pro",
      cacheTtlMs: 60_000,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      getCachedVerdict: async (input) => {
        lookupPolicyVersions.push(input.policyVersion);
        return null;
      },
      getCachedVerdictByFingerprint: async (input) => {
        lookupPolicyVersions.push(input.policyVersion);
        return null;
      },
      upsertVerdict: async (input) => {
        upsertPolicyVersions.push(input.policyVersion);
      }
    });

    const [verdict] = await analyzer([caseFile]);

    expect(verdict.caseFileHash).toEqual(expect.any(String));
    expect(lookupPolicyVersions).toEqual([
      "2026-06-01-standalone-contract-check-v1",
      "2026-06-01-standalone-contract-check-v1"
    ]);
    expect(upsertPolicyVersions).toEqual(["2026-06-01-standalone-contract-check-v1"]);
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

  it("parses provider confidence labels and scalar false-positive notes", async () => {
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
    const analyzer = createContractLlmVerdictAnalyzer({
      client: {
        completeJson: async () => ({
          ok: true,
          providerLabel: "deepseek",
          model: "deepseek-v4-pro",
          json: {
            verdict: "legitimate_service",
            confidence: "medium",
            contractRiskScore: 35,
            decisionRecommendation: "ACCEPTABLE",
            reasons: ["GasFree-like service route."],
            citedEvidenceIds: ["tx-balance"],
            falsePositiveNotes: "Permissionless services can still be abused by users."
          },
          rawText: "{}",
          latencyMs: 10
        })
      },
      providerLabel: "deepseek",
      model: "deepseek-v4-pro",
      cacheTtlMs: 60_000,
      now: () => new Date("2026-05-28T00:00:00.000Z")
    });

    const [verdict] = await analyzer([caseFile]);

    expect(verdict).toMatchObject({
      verdict: "legitimate_service",
      confidence: 0.6,
      falsePositiveNotes: ["Permissionless services can still be abused by users."]
    });
  });

  it("sends adaptive approval-review policy and derived interpretations to the LLM", async () => {
    const caseFile = buildContractAnalysisCaseFiles({
      subjectAddress: subject,
      currentUsdtBalanceRaw: "1100000000",
      balanceFormingTransfers: [balanceTransfer],
      originPaths: [originPath],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [
        {
          ...reviewFinding,
          reason: "approval_not_found"
        }
      ],
      classifications: new Map([[wrapperContract, service("unknown_contract", null)]])
    })[0];
    const capturedInputs: CompleteJsonInput[] = [];
    const analyzer = createContractLlmVerdictAnalyzer({
      client: {
        completeJson: async (input) => {
          capturedInputs.push(input);
          return {
            ok: true,
            providerLabel: "deepseek",
            model: "deepseek-v4-pro",
            json: {
              verdict: "unknown_suspicious",
              confidence: 0.8,
              contractRiskScore: 70,
              decisionRecommendation: "DECLINE",
              reasons: ["Candidate wrapper flow remains unresolved."],
              citedEvidenceIds: ["tx-wrapper-drain"],
              falsePositiveNotes: ["Could still be a normal bridge/router/service route."]
            },
            rawText: "{}",
            latencyMs: 10
          };
        }
      },
      providerLabel: "deepseek",
      model: "deepseek-v4-pro",
      cacheTtlMs: 60_000,
      now: () => new Date("2026-05-31T00:00:00.000Z")
    });

    await analyzer([caseFile]);

    const capturedInput = capturedInputs[0];
    expect(capturedInput).toBeDefined();
    if (!capturedInput) throw new Error("Expected LLM request to be captured");
    expect(capturedInput.systemPrompt).toContain("approvalDrainReviewFindings are unresolved review candidates, not confirmed drains");
    expect(capturedInput.systemPrompt).toContain("approval_not_found means exact approval proof was not found");
    expect(capturedInput.systemPrompt).toContain("Do not call exact approval-drain unless the case file contains deterministic approve/spender/transferFrom/path proof");
    expect(capturedInput.systemPrompt).toContain("Verify20 and similar wrapper methods have been observed across drainer-like campaigns");
    expect(capturedInput.systemPrompt).toContain("Do not classify a contract as exact drainer proof from the Verify20 method name alone");
    expect(capturedInput.systemPrompt).toContain("include falsePositiveNotes explaining why the case may still be a normal bridge/router/service route");
    expect(JSON.parse(capturedInput.userPrompt)).toMatchObject({
      caseFile: {
        approvalDrainReviewInterpretations: [
          {
            reviewFindingInterpretation: "candidate_only_not_exact_proof",
            exactApprovalProofStatus: "not_found",
            transferFromProofStatus: "suspected_wrapper",
            pathToCheckedWalletStatus: "not_proven"
          }
        ]
      }
    });
  });

  it("normalizes cached provider JSON when an old cache summary lost confidence labels", async () => {
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
    const now = new Date("2026-05-28T00:00:00.000Z");
    const cachedRecord: ContractLlmVerdictCacheRecord = {
      id: "cached-old-provider-json",
      contractAddress: wrapperContract,
      profileHash: "profile-hash",
      contractFingerprintHash: "fingerprint-hash",
      cacheScope: "address_flow",
      flowContextHash: hashContractFlowContextForLlm(caseFile),
      caseFileHash: "old-case-hash",
      policyVersion: CONTRACT_LLM_VERDICT_POLICY_VERSION,
      providerLabel: "deepseek",
      model: "deepseek-v4-pro",
      verdict: {
        source: "llm",
        providerLabel: "deepseek",
        model: "deepseek-v4-pro",
        contractAddress: wrapperContract,
        caseFileHash: "old-case-hash",
        cacheId: "cached-old-provider-json",
        verdict: "legitimate_service",
        confidence: 0,
        contractRiskScore: 35,
        decisionRecommendation: "ACCEPTABLE",
        reasons: ["Old cached summary."],
        citedEvidenceIds: ["tx-balance"],
        falsePositiveNotes: []
      },
      requestCaseHash: "old-case-hash",
      responseJson: {
        verdict: "legitimate_service",
        confidence: "high",
        contractRiskScore: 25,
        decisionRecommendation: "ACCEPTABLE",
        reasons: ["GasFree-like service route."],
        citedEvidenceIds: "tx-balance",
        falsePositiveNotes: "Permissionless services can still be abused by users."
      },
      error: null,
      latencyMs: 10,
      createdAt: now,
      expiresAt: new Date("2026-05-29T00:00:00.000Z"),
      updatedAt: now
    };
    let llmCalls = 0;
    const analyzer = createContractLlmVerdictAnalyzer({
      client: {
        completeJson: async () => {
          llmCalls += 1;
          throw new Error("LLM should not be called for a usable cached verdict");
        }
      },
      providerLabel: "deepseek",
      model: "deepseek-v4-pro",
      cacheTtlMs: 60_000,
      now: () => now,
      getCachedVerdict: async () => cachedRecord
    });

    const [verdict] = await analyzer([caseFile]);

    expect(llmCalls).toBe(0);
    expect(verdict).toMatchObject({
      source: "cache",
      cacheMatch: "address",
      verdict: "legitimate_service",
      confidence: 0.9,
      contractRiskScore: 25,
      reasons: ["GasFree-like service route."],
      falsePositiveNotes: ["Permissionless services can still be abused by users."]
    });
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

  it("does not call or cache LLM when complete contract enrichment is required but missing", async () => {
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
    let cacheWrites = 0;
    const analyzer = createContractLlmVerdictAnalyzer({
      client: {
        completeJson: async () => {
          llmCalls += 1;
          throw new Error("LLM should not be called for incomplete case files");
        }
      },
      providerLabel: "deepseek",
      model: "deepseek-v4-pro",
      cacheTtlMs: 60_000,
      requireCompleteCaseFile: true,
      upsertVerdict: async () => {
        cacheWrites += 1;
      }
    });

    const [verdict] = await analyzer([caseFile]);

    expect(llmCalls).toBe(0);
    expect(cacheWrites).toBe(0);
    expect(verdict).toMatchObject({
      source: "unavailable",
      verdict: "unknown_insufficient_data",
      error: "contract intelligence profile was not fully enriched before LLM analysis"
    });
  });
});
