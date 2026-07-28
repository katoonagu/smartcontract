import { describe, expect, it } from "vitest";
import { buildRiskExplanationSummary } from "../../src/bot/riskExplanationSummary";
import { calculateUnifiedWalletRisk } from "../../src/risk/unifiedWalletRisk";
import type {
  ApprovalDrainProvenanceProfile,
  RiskReport,
  WhereIsMoneyHardBadEvidence,
  WhereIsMoneyReport
} from "../../src/types";

const address = "TSubject111111111111111111111111111111";
const victim = "TVictim111111111111111111111111111111";
const receiver = "TReceiver1111111111111111111111111111";

function approvalProfile(
  overrides: Partial<ApprovalDrainProvenanceProfile> = {}
): ApprovalDrainProvenanceProfile {
  return {
    victimAddress: victim,
    approvalTxHash: "tx-approval",
    drainTxHash: "tx-drain",
    spenderAddress: "TSpender11111111111111111111111111111",
    firstReceiverAddress: address,
    subjectAddress: address,
    hopDepth: 0,
    amountRaw: "1000000",
    amountPreservationRatio: 1,
    approvalAt: "2026-07-10T00:00:00.000Z",
    drainAt: "2026-07-10T00:01:00.000Z",
    pathTxHashes: ["tx-drain"],
    pathAddresses: [victim, address],
    score: 90,
    evidenceStrength: "exact_approval_and_transfer_from",
    subjectTokenState: null,
    victimTokenState: null,
    features: [],
    ...overrides
  };
}

function whereReport(input: {
  profiles?: ApprovalDrainProvenanceProfile[];
  hardBadEvidence?: WhereIsMoneyHardBadEvidence[];
  fastWalletRisk?: RiskReport | null;
  decision?: "ACCEPTABLE" | "REVIEW" | "DECLINE";
} = {}): WhereIsMoneyReport {
  const hardBadEvidence = input.hardBadEvidence ?? [];
  const decision = input.decision ?? "REVIEW";
  const riskScore = hardBadEvidence[0]?.score ?? 0;
  return {
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed",
    subjectAddress: address,
    currentUsdtBalanceRaw: "1000000",
    fastWalletRisk: input.fastWalletRisk ?? null,
    balanceFormingTransfers: [],
    originPaths: [],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: input.profiles ?? [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [],
    assessment: {
      scoreValid: true,
      scoreBlockedReason: null,
      technicalStatus: "completed",
      decision,
      riskScore,
      riskBand: riskScore >= 85 ? "CRITICAL" : riskScore >= 60 ? "HIGH" : "LOW",
      provenanceConfidence: 100,
      coverageCompleteness: 100,
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      ageSignals: null,
      hardBadEvidence,
      sourcePolicyEvidence: [],
      contractSuspicionEvidence: [],
      unknownOriginEvidence: [],
      riskLayers: [],
      dominantRiskLayer: null,
      reasons: [],
      warnings: []
    },
    decision,
    userDecision: decision,
    internalDecision: decision,
    proofLevel: hardBadEvidence.length > 0 ? "exact_approval_drain_provenance" : "insufficient_coverage",
    riskScore,
    decisionReasons: [],
    coverage: {
      selectedInboundTxCount: 1,
      selectedInboundVolumeRaw: "1000000",
      currentBalanceCoverageRatio: 1,
      coverageRatio: 1,
      checkedScope: "current_balance",
      maxDepth: 7,
      fetchedAddressCount: 3,
      partial: false,
      notes: []
    }
  };
}

function explanation(report: WhereIsMoneyReport) {
  const unifiedRisk = calculateUnifiedWalletRisk({
    address,
    fastReport: report.fastWalletRisk,
    deepReport: null,
    whereReport: report
  });
  return buildRiskExplanationSummary({
    address,
    whereReport: report,
    unifiedRisk,
    finalDecision: unifiedRisk.finalDecision,
    fastReport: report.fastWalletRisk,
    deepReport: null
  });
}

describe("buildRiskExplanationSummary approval-drain authority", () => {
  it("does not present a stale Where hard item backed only by a route-linked profile as exact or decline proof", () => {
    const route = approvalProfile({
      firstReceiverAddress: receiver,
      hopDepth: 1,
      evidenceStrength: "route_linked",
      pathTxHashes: ["tx-drain", "tx-route"],
      pathAddresses: [victim, receiver, address],
      score: 80
    });
    const summary = explanation(whereReport({
      profiles: [route],
      decision: "DECLINE",
      hardBadEvidence: [{
        kind: "approval_drain",
        score: 95,
        message: "Stale exact approval-drain claim.",
        evidenceIds: ["tx-drain"]
      }]
    }));

    expect(summary.primaryReasons.some((fact) => fact.dedupeKey === "approval_drain_exact")).toBe(false);
    expect(summary.primaryReasons.map((fact) => fact.textEn).join(" ")).not.toContain("Exact drainer chain found");
    expect(summary.shortConclusionEn).not.toContain("cannot be accepted automatically");
  });

  it("presents a flat approval-drain marker as context rather than exact proof", () => {
    const summary = explanation(whereReport({
      fastWalletRisk: {
        subjectAddress: address,
        level: "HIGH",
        score: 80,
        reasons: [{
          code: "internal_label_approval_drain_proximity",
          message: "Derived approval-drain route marker; exact provenance requires retained approval and transferFrom evidence.",
          scoreImpact: 80
        }]
      }
    }));
    const marker = summary.primaryReasons.find((fact) => fact.dedupeKey === "approval_drain_saved_marker");

    expect(marker).toMatchObject({ kind: "behavior_context", source: "fast" });
    expect(marker?.textEn).toContain("not exact proof");
    expect(summary.primaryReasons.some((fact) => fact.dedupeKey === "approval_drain_exact")).toBe(false);
  });

  it("presents checked-subject direct evidence with overlapping retained ids as exact", () => {
    const direct = approvalProfile();
    const summary = explanation(whereReport({
      profiles: [direct],
      decision: "DECLINE",
      hardBadEvidence: [{
        kind: "approval_drain",
        score: 95,
        message: "Bound exact approval-drain evidence.",
        evidenceIds: [direct.drainTxHash]
      }]
    }));
    const exact = summary.primaryReasons.find((fact) => fact.dedupeKey === "approval_drain_exact");

    expect(exact).toMatchObject({ kind: "hard_evidence", source: "where" });
    expect(exact?.textEn).toContain("Exact approval-drain evidence was found");
  });
});
