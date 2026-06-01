import { describe, expect, it } from "vitest";
import { evaluateSmartContractAddress } from "../../src/check/smartContractCheck";
import type { ContractIntelligenceProfile } from "../../src/approvals/contractIntelligence";
import type { AddressMetadata, WalletApprovalSpenderRelation } from "../../src/storage/repositories";
import type { ContractLlmVerdictSummary } from "../../src/types";

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
});
