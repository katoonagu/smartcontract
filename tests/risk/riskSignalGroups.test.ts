import { describe, expect, it } from "vitest";
import { evaluateAddressRisk } from "../../src/risk/evaluation";
import {
  filterAmlRiskSignalObservations,
  isAmlRiskSignalObservation
} from "../../src/risk/riskSignalGroups";
import { calculateUnifiedWalletRisk, type UnifiedWalletRiskInput } from "../../src/risk/unifiedWalletRisk";
import {
  calculateUnifiedIncomingDepositRisk,
  type CalculateUnifiedIncomingDepositRiskInput
} from "../../src/risk/unifiedIncomingDepositRisk";
import type { RiskSignalGroup, RiskSignalObservationInput, WhereIsMoneyReport } from "../../src/types";

const amlGroups = [
  "internal_label",
  "provider",
  "graph",
  "behavior",
  "incoming_context",
  "approval",
  "manual"
] as const;

function observation(signalGroup: RiskSignalGroup, scoreImpact = 10): RiskSignalObservationInput {
  return {
    id: `observation-${signalGroup}`,
    subjectChain: "tron",
    subjectAddress: `T${"1".repeat(33)}`,
    subjectTxHash: null,
    observedTransactionHash: null,
    signalGroup,
    code: `signal-${signalGroup}`,
    message: signalGroup,
    scoreImpact,
    confidence: "high",
    severity: "high",
    source: "test",
    policyVersion: "test-v1",
    rawEvidenceId: null
  };
}

function scoreableWhereReport(): WhereIsMoneyReport {
  return {
    subjectAddress: `T${"1".repeat(33)}`,
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed",
    currentUsdtBalanceRaw: "0",
    fastWalletRisk: null,
    balanceFormingTransfers: [],
    originPaths: [],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [],
    assessment: {
      decision: "ACCEPTABLE",
      riskScore: 0,
      riskBand: "LOW",
      provenanceConfidence: 100,
      coverageCompleteness: 100,
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      ageSignals: null,
      hardBadEvidence: [],
      sourcePolicyEvidence: [],
      contractSuspicionEvidence: [],
      unknownOriginEvidence: [],
      riskLayers: [],
      dominantRiskLayer: null,
      reasons: [],
      warnings: []
    },
    decision: "ACCEPTABLE",
    userDecision: "ACCEPTABLE",
    internalDecision: "ACCEPTABLE",
    proofLevel: "clean_source_proven",
    riskScore: 0,
    decisionReasons: [],
    coverage: {
      selectedInboundTxCount: 0,
      selectedInboundVolumeRaw: "0",
      currentBalanceCoverageRatio: 1,
      coverageRatio: 1,
      checkedScope: "current_balance",
      maxDepth: 20,
      fetchedAddressCount: 10,
      questionStatus: "applicable",
      partial: false,
      notes: []
    }
  };
}

describe("AML risk signal groups", () => {
  it("retains every explicit AML group without mutating the input", () => {
    const input = amlGroups.map((group) => observation(group));
    const snapshot = structuredClone(input);

    const result = filterAmlRiskSignalObservations(input);

    expect(result.map((item) => item.signalGroup)).toEqual(amlGroups);
    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
  });

  it("fails closed for wallet safety and unknown runtime groups regardless of score impact", () => {
    const malformedWalletSafety = observation("wallet_safety", 90);
    const bogus = { ...observation("manual"), signalGroup: "future_group" } as unknown as RiskSignalObservationInput;

    expect(isAmlRiskSignalObservation(malformedWalletSafety)).toBe(false);
    expect(isAmlRiskSignalObservation(bogus)).toBe(false);
    expect(filterAmlRiskSignalObservations([malformedWalletSafety, bogus])).toEqual([]);
  });

  it("keeps evaluation-generated reason groups inside the AML allowlist", () => {
    const result = evaluateAddressRisk({
      context: { subjectAddress: `T${"2".repeat(33)}` },
      labels: [{
        address: `T${"2".repeat(33)}`,
        label: "scam",
        source: "service_admin",
        createdByTelegramId: "42",
        createdAt: new Date("2026-07-12T00:00:00.000Z")
      }],
      graphSignals: [
        { code: "graph", message: "graph", scoreImpact: 5, source: "graph_detector" },
        { code: "approval", message: "approval", scoreImpact: 5, source: "approval_detector" }
      ],
      behaviorSignals: [
        { code: "behavior", message: "behavior", scoreImpact: 5 },
        { code: "incoming", message: "incoming", scoreImpact: 5, source: "incoming_detector" }
      ],
      amlSignals: [{ code: "provider", message: "provider", scoreImpact: 5, source: "provider_api" }]
    });

    expect(result.observations.map((item) => item.signalGroup).sort()).toEqual([
      "approval",
      "behavior",
      "graph",
      "incoming_context",
      "internal_label",
      "provider"
    ]);
    expect(result.observations.every(isAmlRiskSignalObservation)).toBe(true);
  });

  it("does not let wallet safety observations change unified wallet scoring", () => {
    const input: UnifiedWalletRiskInput = {
      address: `T${"1".repeat(33)}`,
      whereReport: scoreableWhereReport()
    };
    const baseline = calculateUnifiedWalletRisk(input);
    const withAuditOnlyObservation = calculateUnifiedWalletRisk({
      ...input,
      observations: [observation("wallet_safety", 90)]
    } as UnifiedWalletRiskInput & { observations: RiskSignalObservationInput[] });

    expect(withAuditOnlyObservation).toEqual(baseline);
  });

  it("does not let wallet safety observations change unified incoming scoring", () => {
    const input: CalculateUnifiedIncomingDepositRiskInput = {
      senderAddress: `T${"2".repeat(33)}`,
      receiverAddress: `T${"1".repeat(33)}`,
      txHash: "incoming-1",
      amountRaw: "1000000",
      timestamp: new Date("2026-07-12T00:00:00.000Z"),
      fastSenderRisk: null,
      senderStablecoinState: null,
      whereReport: scoreableWhereReport()
    };
    const baseline = calculateUnifiedIncomingDepositRisk(input);
    const withAuditOnlyObservation = calculateUnifiedIncomingDepositRisk({
      ...input,
      observations: [observation("wallet_safety", 90)]
    } as CalculateUnifiedIncomingDepositRiskInput & { observations: RiskSignalObservationInput[] });

    expect(withAuditOnlyObservation).toEqual(baseline);
  });
});
