import { describe, expect, it } from "vitest";
import {
  buildStandaloneContractAnalysisCaseFile,
  checkSmartContractAddress,
  evaluateSmartContractAddress,
  mergeContractSafetyContext
} from "../../src/check/smartContractCheck";
import type { ContractIntelligenceProfile } from "../../src/approvals/contractIntelligence";
import type { AddressMetadata, WalletApprovalSpenderRelation } from "../../src/storage/repositories";
import type { ContractAnalysisCaseFile, ContractLlmVerdictSummary, RiskReport, ServiceClassification } from "../../src/types";

const subjectAddress = "TContract11111111111111111111111111111";

function metadata(overrides: Partial<AddressMetadata> = {}): AddressMetadata {
  return {
    address: subjectAddress,
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

function contractProfile(overrides: Partial<ContractIntelligenceProfile> = {}): ContractIntelligenceProfile {
  return {
    contractAddress: subjectAddress,
    providerTags: [],
    publicTags: [],
    isVerified: false,
    verifyStatus: null,
    sourceStatus: "missing",
    contractCreatedAt: null,
    contractAgeDays: null,
    txCount: "2",
    recentCallCount: null,
    totalCallCount: "1",
    totalCallerCount: "1",
    topMethods: [],
    topCallers: [],
    methodMap: {},
    providerRisk: false,
    rawPayload: {},
    fetchedAt: new Date("2026-06-01T00:00:00.000Z"),
    expiresAt: new Date("2026-06-02T00:00:00.000Z"),
    address: subjectAddress,
    source: "tronscan",
    name: null,
    serviceTag: null,
    publicTag: null,
    publicTagDesc: null,
    tagUrl: null,
    verified: false,
    trxCount: "2",
    uniqueCallerCount: "1",
    hasTransferFromSelector: false,
    hasOwnerOnlyPattern: false,
    lowMetadata: true,
    activityLevel: "low",
    rawJson: {},
    ...overrides
  };
}

function activeUnlimitedApproval(overrides: Partial<WalletApprovalSpenderRelation> = {}): WalletApprovalSpenderRelation {
  return {
    watchedWalletId: "wallet-1",
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    spenderAddress: subjectAddress,
    amountRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    isUnlimited: true,
    currentAllowanceRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    spenderType: "contract",
    status: "active",
    lastApprovalTxHash: "approval-tx-1",
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

function llmVerdict(overrides: Partial<ContractLlmVerdictSummary>): ContractLlmVerdictSummary {
  return {
    source: "llm",
    cacheMatch: null,
    reusedFromContractAddress: null,
    providerLabel: "openai-compatible",
    model: "test-model",
    contractAddress: subjectAddress,
    caseFileHash: "hash-1",
    cacheId: null,
    verdict: "unknown_insufficient_data",
    confidence: 0.5,
    contractRiskScore: 35,
    decisionRecommendation: "DECLINE",
    reasons: [],
    citedEvidenceIds: [],
    falsePositiveNotes: [],
    error: null,
    ...overrides
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

function contractSafetyReportForMerge(overrides: Partial<ReturnType<typeof evaluateSmartContractAddress>> = {}) {
  return {
    ...evaluateSmartContractAddress({
      subjectAddress,
      metadata: metadata(),
      contractProfile: contractProfile(),
      relatedApprovals: []
    }),
    ...overrides
  };
}

describe("merge contract safety context", () => {
  it("caps standalone contract safety below the decline threshold", () => {
    const fastReport: RiskReport = {
      subjectAddress,
      level: "LOW",
      score: 0,
      reasons: []
    };

    const merged = mergeContractSafetyContext(
      fastReport,
      contractSafetyReportForMerge({ riskScore: 90, reasons: ["provider_risk_contract"] })
    );

    expect(merged).toMatchObject({ score: 59, level: "MEDIUM" });
    expect(merged.reasons).toEqual([
      expect.objectContaining({
        code: "contract_safety_provider_risk_contract",
        message: "Contract safety context: provider_risk_contract",
        scoreImpact: 59,
        source: "contract_safety",
        confidence: "medium",
        severity: "medium",
        evidenceRef: `contract_safety:${subjectAddress}:provider_risk_contract`
      })
    ]);
  });

  it.each([
    { riskScore: 44, severity: "low" as const },
    { riskScore: 45, severity: "medium" as const }
  ])("uses $severity severity at bounded contract context score $riskScore", ({ riskScore, severity }) => {
    const reason = "unknown_weak_contract_metadata";
    const merged = mergeContractSafetyContext(
      { subjectAddress, level: "LOW", score: 0, reasons: [] },
      contractSafetyReportForMerge({ riskScore, reasons: [reason] })
    );

    expect(merged).toMatchObject({ score: riskScore, level: "MEDIUM" });
    expect(merged.reasons).toEqual([{
      code: `contract_safety_${reason}`,
      message: `Contract safety context: ${reason}`,
      scoreImpact: riskScore,
      source: "contract_safety",
      confidence: "medium",
      severity,
      evidenceRef: `contract_safety:${subjectAddress}:${reason}`
    }]);
  });

  it("raises a low Fast level to medium at contract context score 30", () => {
    const merged = mergeContractSafetyContext(
      { subjectAddress, level: "LOW", score: 12, reasons: [] },
      contractSafetyReportForMerge({ riskScore: 30, reasons: ["unknown_weak_contract_metadata"] })
    );

    expect(merged.score).toBe(30);
    expect(merged.level).toBe("MEDIUM");
  });

  it("preserves an existing higher Fast score, level, and reasons", () => {
    const existingReason: RiskReport["reasons"][number] = {
      code: "stablecoin_usdt_blacklisted",
      message: "Exact hard evidence",
      scoreImpact: 90,
      source: "stablecoin_contract",
      confidence: "high",
      severity: "critical",
      evidenceRef: "usdt:blacklist"
    };
    const merged = mergeContractSafetyContext(
      { subjectAddress, level: "CRITICAL", score: 90, reasons: [existingReason] },
      contractSafetyReportForMerge({ riskScore: 45, reasons: ["active_unlimited_usdt_approval_spender"] })
    );

    expect(merged.score).toBe(90);
    expect(merged.level).toBe("CRITICAL");
    expect(merged.reasons[0]).toEqual(existingReason);
    expect(merged.reasons[1]).toMatchObject({ code: "contract_safety_active_unlimited_usdt_approval_spender" });
  });

  it("handles empty contract reasons without mutating either report", () => {
    const fastReport: RiskReport = {
      subjectAddress,
      level: "LOW",
      score: 10,
      reasons: []
    };
    const contractReport = contractSafetyReportForMerge({ riskScore: -20, reasons: [] });
    const fastBefore = structuredClone(fastReport);
    const contractBefore = structuredClone(contractReport);

    const merged = mergeContractSafetyContext(fastReport, contractReport);

    expect(merged).not.toBe(fastReport);
    expect(merged).toEqual(fastReport);
    expect(merged.reasons).not.toBe(fastReport.reasons);
    expect(fastReport).toEqual(fastBefore);
    expect(contractReport).toEqual(contractBefore);
  });
});

describe("smart contract check", () => {
  it("declines a TNKG-style unverified active unlimited approval spender without exact drain proof", () => {
    const report = evaluateSmartContractAddress({
      subjectAddress,
      metadata: metadata(),
      contractProfile: contractProfile(),
      relatedApprovals: [activeUnlimitedApproval()]
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.decisionScope).toBe("approval_safety");
    expect(report.riskScore).toBe(45);
    expect(report.riskLevel).toBe("MEDIUM");
    expect(report.exactDrainProven).toBe(false);
    expect(report.reasons).toEqual(expect.arrayContaining([
      "address_is_smart_contract",
      "active_unlimited_usdt_approval_spender"
    ]));
    expect(report.reasons).not.toContain("exact_drain_not_proven_in_standalone_check");
    expect(report.limitations).toContain("exact_drain_not_proven_in_standalone_check");
  });

  it("accepts a known verified bridge or service contract with no risky approval relation", () => {
    const report = evaluateSmartContractAddress({
      subjectAddress,
      metadata: metadata({ name: "Bridgers", tag: "Bridgers:Cross-chain Bridge", verified: true }),
      contractProfile: contractProfile({
        isVerified: true,
        verified: true,
        sourceStatus: "available",
        lowMetadata: false,
        activityLevel: "high",
        serviceTag: "Bridgers:Cross-chain Bridge",
        providerTags: [{ kind: "blueTag", label: "Bridgers:Cross-chain Bridge", url: null }],
        txCount: "4380107",
        totalCallCount: "224309",
        totalCallerCount: "45552"
      }),
      relatedApprovals: []
    });

    expect(report.decision).toBe("ACCEPTABLE");
    expect(report.decisionScope).toBe("contract_safety");
    expect(report.riskScore).toBe(10);
    expect(report.riskLevel).toBe("LOW");
    expect(report.serviceLabel).toBe("Bridgers:Cross-chain Bridge");
    expect(report.exactDrainProven).toBe(false);
  });

  it("declines provider-risk contracts as critical even when metadata is otherwise service-like", () => {
    const report = evaluateSmartContractAddress({
      subjectAddress,
      metadata: metadata({ name: "Risky Router", tag: "Router", verified: true }),
      contractProfile: contractProfile({
        providerRisk: true,
        isVerified: true,
        verified: true,
        sourceStatus: "available",
        lowMetadata: false,
        activityLevel: "high",
        serviceTag: "Router",
        providerTags: [{ kind: "redTag", label: "Router", url: null }]
      }),
      relatedApprovals: []
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(90);
    expect(report.riskLevel).toBe("CRITICAL");
    expect(report.serviceLabel).toBeNull();
    expect(report.reasons).toContain("provider_risk_contract");
    expect(report.limitations).toContain("exact_drain_not_proven_in_standalone_check");
  });

  it("does not accept a verified high-activity contract solely because it has a non-service tag", () => {
    const report = evaluateSmartContractAddress({
      subjectAddress,
      metadata: metadata({ name: "Foundation Treasury", tag: "Foundation", verified: true }),
      contractProfile: contractProfile({
        isVerified: true,
        verified: true,
        sourceStatus: "available",
        lowMetadata: false,
        activityLevel: "high",
        serviceTag: "Foundation",
        providerTags: [{ kind: "blueTag", label: "Foundation", url: null }],
        txCount: "250000",
        totalCallCount: "125000",
        totalCallerCount: "50000"
      }),
      relatedApprovals: []
    });

    expect(report.serviceLabel).toBeNull();
    expect(report.decision).not.toBe("ACCEPTABLE");
    expect(report.riskScore).toBeGreaterThanOrEqual(35);
    expect(report.reasons).toContain("verified_contract_without_service_evidence");
  });

  it("reflects active related approval risk even when the approval is not unlimited", () => {
    const report = evaluateSmartContractAddress({
      subjectAddress,
      metadata: metadata({ verified: true }),
      contractProfile: contractProfile({
        isVerified: true,
        verified: true,
        sourceStatus: "available",
        lowMetadata: false,
        activityLevel: "normal"
      }),
      relatedApprovals: [
        activeUnlimitedApproval({
          isUnlimited: false,
          amountRaw: "1000000",
          currentAllowanceRaw: "1000000",
          riskLevel: "HIGH",
          riskScore: 70,
          riskReasons: [{ code: "approval_unknown_drainer_contract_review", message: "Review", scoreImpact: 70 }]
        })
      ]
    });

    expect(report.decisionScope).toBe("approval_safety");
    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(70);
    expect(report.riskLevel).toBe("HIGH");
    expect(report.exactDrainProven).toBe(false);
    expect(report.reasons).toContain("active_risky_related_approval_spender");
  });

  it("raises high suspicion for an LLM drainer-like verdict without claiming exact transferFrom proof", () => {
    const report = evaluateSmartContractAddress({
      subjectAddress,
      metadata: metadata(),
      contractProfile: contractProfile(),
      relatedApprovals: [],
      llmVerdict: llmVerdict({
        verdict: "drainer_like",
        confidence: 0.9,
        contractRiskScore: 72,
        reasons: ["pull-capable approval helper shape"]
      })
    });

    expect(report.decision).toBe("REVIEW");
    expect(report.riskScore).toBeGreaterThanOrEqual(65);
    expect(report.riskScore).toBeLessThanOrEqual(75);
    expect(report.riskLevel).toBe("HIGH");
    expect(report.exactDrainProven).toBe(false);
    expect(report.reasons).toEqual(expect.arrayContaining([
      "llm_drainer_like_high_confidence"
    ]));
    expect(report.reasons).not.toContain("exact_drain_not_proven_in_standalone_check");
    expect(report.limitations).toContain("exact_drain_not_proven_in_standalone_check");
  });

  it("builds standalone contract LLM case files with approval context and no flow evidence", () => {
    const rawWalletAddress = "TWallet111111111111111111111111111111";
    const secondRawWalletAddress = "TWallet222222222222222222222222222222";
    const caseFile = buildStandaloneContractAnalysisCaseFile({
      address: subjectAddress,
      metadata: metadata({ rawJson: { watchedWallet: rawWalletAddress, approvalTx: "approval-tx-1" } }),
      contractProfile: contractProfile({
        topCallers: [{ address: rawWalletAddress, addressTag: null, count: 12, ratio: 0.3 }],
        rawPayload: { watchedWallet: rawWalletAddress, approvalTx: "approval-tx-1" },
        rawJson: { secondWallet: secondRawWalletAddress, approvalTx: "approval-tx-2" }
      }),
      serviceClassification: service("unknown_contract", null),
      relatedApprovals: [
        activeUnlimitedApproval(),
        activeUnlimitedApproval({
          watchedWalletId: "wallet-2",
          watchedWalletAddress: secondRawWalletAddress,
          watchedWalletTelegramUserId: "456",
          lastApprovalTxHash: "approval-tx-2"
        })
      ]
    });
    const serializedCaseFile = JSON.stringify(caseFile);

    expect(caseFile).toMatchObject({
      policyVersion: "2026-06-01-standalone-contract-check-v1",
      subjectAddress,
      checkedWalletAddress: subjectAddress,
      contractAddress: subjectAddress,
      currentUsdtBalanceRaw: null,
      balanceFormingTransfers: [],
      originPaths: [],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [],
      approvalDrainReviewInterpretations: [],
      policyQuestion: "Classify this standalone smart contract for approval safety. Do not claim exact drain unless provided facts prove approve -> transferFrom -> funds movement.",
      standaloneContractContext: {
        mode: "standalone_contract_check",
        relatedApprovals: [
          expect.objectContaining({
            ownerAddress: "owner_wallet_1",
            watchedWalletAddress: "watched_wallet_1",
            approvalEvidenceId: "approval_1",
            status: "active",
            isUnlimited: true
          }),
          expect.objectContaining({
            ownerAddress: "owner_wallet_2",
            watchedWalletAddress: "watched_wallet_2",
            approvalEvidenceId: "approval_2"
          })
        ],
        knownLimitations: ["exact_drain_not_proven_in_standalone_check"]
      }
    });
    expect(caseFile.evidenceIds).toEqual(expect.arrayContaining([subjectAddress, "approval_1", "approval_2"]));
    expect(caseFile.evidenceIds).not.toContain(rawWalletAddress);
    expect(caseFile.evidenceIds).not.toContain(secondRawWalletAddress);
    expect(caseFile.evidenceIds).not.toContain("approval-tx-1");
    expect(caseFile.evidenceIds).not.toContain("approval-tx-2");
    expect(serializedCaseFile).not.toContain(rawWalletAddress);
    expect(serializedCaseFile).not.toContain(secondRawWalletAddress);
    expect(serializedCaseFile).not.toContain("approval-tx-1");
    expect(serializedCaseFile).not.toContain("approval-tx-2");
    expect(serializedCaseFile).not.toContain("topCallers");
    expect(serializedCaseFile).not.toContain("rawPayload");
    expect(serializedCaseFile).not.toContain("rawJson");
    expect(serializedCaseFile).toContain("watched_wallet_1");
    expect(serializedCaseFile).toContain("watched_wallet_2");
  });

  it("calls the LLM analyzer for active unlimited approvals and feeds the first verdict into deterministic evaluation", async () => {
    const capturedCaseFiles: ContractAnalysisCaseFile[][] = [];
    const report = await checkSmartContractAddress({
      address: subjectAddress,
      metadata: metadata(),
      contractProfile: contractProfile(),
      serviceClassification: service("unknown_contract", null),
      relatedApprovals: [activeUnlimitedApproval()],
      analyzeContractLlmCaseFiles: async (caseFiles) => {
        capturedCaseFiles.push(caseFiles);
        return [
          llmVerdict({
            verdict: "drainer_like",
            confidence: 0.9,
            contractRiskScore: 72,
            reasons: ["pull-capable approval helper shape"]
          })
        ];
      }
    });

    expect(capturedCaseFiles).toHaveLength(1);
    expect(capturedCaseFiles[0][0]).toMatchObject({
      policyVersion: "2026-06-01-standalone-contract-check-v1",
      standaloneContractContext: {
        relatedApprovals: [expect.objectContaining({ status: "active", isUnlimited: true })]
      }
    });
    expect(report.decision).toBe("DECLINE");
    expect(report.llmVerdict).toMatchObject({ verdict: "drainer_like" });
    expect(report.exactDrainProven).toBe(false);
    expect(report.reasons).toContain("llm_drainer_like_high_confidence");
  });

  it("returns deterministic output when standalone LLM analysis fails", async () => {
    const report = await checkSmartContractAddress({
      address: subjectAddress,
      metadata: metadata(),
      contractProfile: contractProfile(),
      serviceClassification: service("unknown_contract", null),
      relatedApprovals: [activeUnlimitedApproval()],
      analyzeContractLlmCaseFiles: async () => {
        throw new Error("llm unavailable");
      }
    });

    expect(report.llmVerdict).toBeNull();
    expect(report.decision).toBe("DECLINE");
    expect(report.exactDrainProven).toBe(false);
    expect(report.reasons).toContain("active_unlimited_usdt_approval_spender");
  });

  it("skips LLM analysis for a known verified service without approval risk", async () => {
    let analyzerCalls = 0;
    const report = await checkSmartContractAddress({
      address: subjectAddress,
      metadata: metadata({ name: "Bridgers", tag: "Bridgers:Cross-chain Bridge", verified: true }),
      contractProfile: contractProfile({
        isVerified: true,
        verified: true,
        sourceStatus: "available",
        lowMetadata: false,
        activityLevel: "high",
        serviceTag: "Bridgers:Cross-chain Bridge",
        providerTags: [{ kind: "blueTag", label: "Bridgers:Cross-chain Bridge", url: null }],
        txCount: "4380107",
        totalCallCount: "224309",
        totalCallerCount: "45552"
      }),
      serviceClassification: service("bridge", "Bridgers:Cross-chain Bridge"),
      relatedApprovals: [],
      analyzeContractLlmCaseFiles: async () => {
        analyzerCalls += 1;
        return [];
      }
    });

    expect(analyzerCalls).toBe(0);
    expect(report.decision).toBe("ACCEPTABLE");
    expect(report.llmVerdict).toBeNull();
  });
});
