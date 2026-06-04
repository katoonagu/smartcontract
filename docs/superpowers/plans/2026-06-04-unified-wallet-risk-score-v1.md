# Unified Wallet Risk Score v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one final wallet risk score from Fast Check, Deep Research, and Where Is Money, with hard-evidence floors, pattern floors, dampeners, coverage handling, and larger production limits.

**Architecture:** Add a pure `src/risk/unifiedWalletRisk.ts` scoring module, then make `src/bot/createBot.ts` consume it for the unified address final report. Keep blockchain fetching inside existing checks and job runners; the unified scorer only reads finished reports and returns a final score, decision, level, and breakdown.

**Tech Stack:** TypeScript, Vitest, existing TRON/USDT forensic domain types, existing Telegram HTML report formatter.

**Implementation status:** Implementation, task reviews, documentation, and final local verification are complete in the current rollout closeout. This plan is now historical execution detail plus the Task 7 documentation record.

---

## Source Spec

Design spec:

```text
docs/superpowers/specs/2026-06-04-unified-wallet-risk-score-v1-design.md
```

Implemented key facts to preserve:

- `src/bot/createBot.ts:18` imports `calculateUnifiedWalletRisk`.
- `src/bot/createBot.ts:2055` calls `calculateUnifiedWalletRisk(...)` for the final address report.
- `src/risk/unifiedWalletRisk.ts:55` defines layer weights: Fast `0.10`, Deep `0.60`, Where `0.30`.
- `src/risk/unifiedWalletRisk.ts:323` normalizes weights across available layers.
- `src/risk/unifiedWalletRisk.ts:501` computes weighted layer score, floors, dampener, coverage, final decision, and final level.
- `src/risk/riskPolicy.ts:93` and `src/risk/riskPolicy.ts:172` already define useful cap/dampener concepts.
- The product must still show one final score and one final risk level.

## File Structure

Create:

```text
src/risk/unifiedWalletRisk.ts
tests/risk/unifiedWalletRisk.test.ts
```

Modify:

```text
src/bot/createBot.ts
tests/bot/createBot.test.ts
src/check/addressExposureSignals.ts
tests/check/addressExposureSignals.test.ts
src/forensics/deepForensicJob.ts
tests/forensics/deepForensicJob.test.ts
src/check/deepForensicCheck.ts
src/forensics/whereIsMoneyCliArgs.ts
tests/forensics/whereIsMoneyCliArgs.test.ts
src/check/whereIsMoneyCheck.ts
docs/project-walkthrough/01-address-check-fast-check.md
```

Do not modify:

```text
src/risk/riskPolicy.ts
src/risk/riskEngine.ts
```

Reason: v1 should add a wallet-level composition layer, not rewrite the existing risk policy engine.

---

### Task 1: Add Failing Unit Tests For Unified Scorer

**Files:**

- Create: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Create the test file**

Create `tests/risk/unifiedWalletRisk.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";
import { calculateUnifiedWalletRisk } from "../../src/risk/unifiedWalletRisk";
import type { DeepAddressForensicReport } from "../../src/check/deepForensicCheck";
import type { CoverageDebugReport } from "../../src/forensics/coverageDebugReport";
import type {
  ApprovalDrainProvenanceProfile,
  BoundaryExposureProfile,
  OperationalFlowProfile,
  RiskReport,
  StablecoinRestrictionProfile,
  WhereIsMoneyAssessment,
  WhereIsMoneyReport
} from "../../src/types";

const address = `T${"1".repeat(33)}`;

function coverageDebug(): CoverageDebugReport {
  return {
    jobId: null,
    subjectAddress: address,
    status: null,
    windowStart: "2026-04-24T00:00:00.000Z",
    windowEnd: "2026-05-24T00:00:00.000Z",
    summary: {
      sourceTransferPages: 0,
      transferEdges: 0,
      inboundSendersExpanded: 0,
      extendedIndexedEdges: 0,
      extendedFetchedAddresses: 0,
      apiKeyConfigured: null,
      thirtyDayTransferCount: null,
      historicalFallbackTransferCount: null,
      historicalFallbackRequestedLimit: null,
      directCounterpartyCount: 0,
      analyzedCounterpartyCount: 0,
      expandedCounterpartyCount: 0,
      metadataEnrichedCounterpartyCount: 0,
      skippedCounterpartyCount: 0,
      legacyPartial: false
    },
    rows: [],
    missingChecks: [],
    notes: []
  };
}

function riskBand(score: number): WhereIsMoneyAssessment["riskBand"] {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function whereAssessment(score: number, overrides: Partial<WhereIsMoneyAssessment> = {}): WhereIsMoneyAssessment {
  return {
    decision: score >= 60 ? "DECLINE" : "ACCEPTABLE",
    riskScore: score,
    riskBand: riskBand(score),
    provenanceConfidence: score >= 60 ? 0 : 100,
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
    warnings: [],
    ...overrides
  };
}

function whereReport(score: number, overrides: Partial<WhereIsMoneyReport> = {}): WhereIsMoneyReport {
  const assessment = overrides.assessment ?? whereAssessment(score);
  return {
    subjectAddress: address,
    currentUsdtBalanceRaw: "0",
    fastWalletRisk: null,
    balanceFormingTransfers: [],
    originPaths: [],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [],
    assessment,
    decision: assessment.decision,
    userDecision: assessment.decision === "DECLINE" ? "DECLINE" : "ACCEPTABLE",
    internalDecision: assessment.decision,
    proofLevel: assessment.decision === "DECLINE" ? "exchange_policy_decline" : "clean_source_proven",
    riskScore: score,
    decisionReasons: [],
    coverage: {
      selectedInboundTxCount: 0,
      selectedInboundVolumeRaw: "0",
      currentBalanceCoverageRatio: 1,
      coverageRatio: 1,
      checkedScope: "current_balance",
      maxDepth: 20,
      fetchedAddressCount: 10,
      partial: false,
      notes: []
    },
    ...overrides
  };
}

function deepReport(overrides: Partial<DeepAddressForensicReport> = {}): DeepAddressForensicReport {
  return {
    subjectAddress: address,
    windowStart: new Date("2026-04-24T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z"),
    rawEvidence: [],
    observations: [],
    missingChecks: [],
    serviceExposureProfiles: [],
    addressBehaviorProfiles: [],
    inboundProvenanceProfiles: [],
    counterpartyRiskProfiles: [],
    approvalDrainProvenanceProfiles: [],
    boundaryExposureProfiles: [],
    walletRoleProfiles: [],
    extendedProvenanceProfiles: [],
    operationalFlowProfiles: [],
    stablecoinRestrictionProfiles: [],
    coverage: {
      sourceTransferPages: 2,
      inboundSendersExpanded: 5,
      transferEdges: 100,
      extendedIndexedEdges: 100,
      extendedFetchedAddresses: 60,
      apiKeyConfigured: true
    },
    coverageDebug: coverageDebug(),
    ...overrides
  };
}

function fastReport(score: number, reasons: RiskReport["reasons"] = []): RiskReport {
  return {
    subjectAddress: address,
    level: score >= 85 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW",
    score,
    taintScore: 0,
    launderingPatternScore: 0,
    dominantRiskType: "none",
    reasons
  };
}

function blacklistProfile(): StablecoinRestrictionProfile {
  return {
    subjectAddress: address,
    tokenContract: "TRON_USDT",
    tokenSymbol: "USDT",
    tokenStandard: "TRC20",
    decimals: 6,
    isBlacklisted: true,
    balanceRaw: "0",
    checkedAt: "2026-06-04T00:00:00.000Z",
    evidenceStrength: "exact_contract_state",
    methods: {
      blacklist: "isBlackListed(address)",
      balance: "balanceOf(address)"
    }
  };
}

function approvalDrainProfile(overrides: Partial<ApprovalDrainProvenanceProfile> = {}): ApprovalDrainProvenanceProfile {
  return {
    victimAddress: "TVictim1111111111111111111111111111",
    approvalTxHash: "approval-tx",
    drainTxHash: "drain-tx",
    spenderAddress: "TSpender111111111111111111111111111",
    operatorAddress: null,
    spenderResolution: "direct_usdt_owner",
    falsePositiveGuards: [],
    supportingFingerprints: [],
    firstReceiverAddress: address,
    subjectAddress: address,
    hopDepth: 0,
    amountRaw: "100000000000",
    amountPreservationRatio: 0.98,
    approvalAt: "2026-05-24T00:00:00.000Z",
    drainAt: "2026-05-24T00:05:00.000Z",
    pathTxHashes: ["drain-tx"],
    pathAddresses: ["TVictim1111111111111111111111111111", address],
    score: 90,
    evidenceStrength: "exact_approval_and_transfer_from",
    subjectTokenState: null,
    victimTokenState: null,
    features: [],
    ...overrides
  };
}

function operationalFlowProfile(overrides: Partial<OperationalFlowProfile> = {}): OperationalFlowProfile {
  return {
    subjectAddress: address,
    windowStart: "2026-04-24T00:00:00.000Z",
    windowEnd: "2026-05-24T00:00:00.000Z",
    incomingVolumeRaw: "7541408440000",
    outgoingVolumeRaw: "7541406950000",
    incomingTxCount: 12,
    outgoingTxCount: 27,
    inflowToOutflowRatio: 0.999,
    topIncomingCounterparties: [],
    topOutgoingCounterparties: [],
    categoryBreakdown: [],
    terminalLiquidityIncomingRatio: 0,
    terminalLiquidityOutgoingRatio: 0,
    htxHuobiIncomingRatio: 0,
    htxHuobiOutgoingRatio: 0,
    bridgeDexRouterOutgoingRatio: 0.25,
    unknownContractOutgoingRatio: 0,
    operationalScore: 65,
    features: [],
    ...overrides
  };
}

function boundaryExposureProfile(): BoundaryExposureProfile {
  return {
    subjectAddress: address,
    incomingBoundaryVolumeRaw: "0",
    outgoingBoundaryVolumeRaw: "100000000000",
    incomingBoundaryVolumeRatio: 0,
    outgoingBoundaryVolumeRatio: 0.3,
    directBoundaryTxCount: 2,
    twoHopBoundaryTxCount: 0,
    topBoundaryEntities: [],
    categoryBreakdown: [],
    flows: [],
    contextScore: 15,
    features: []
  };
}

describe("calculateUnifiedWalletRisk", () => {
  it("keeps active USDT blacklist at critical hard floor", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(0),
      deepReport: deepReport({ stablecoinRestrictionProfiles: [blacklistProfile()] })
    });

    expect(result.finalScore).toBe(95);
    expect(result.finalLevel).toBe("CRITICAL");
    expect(result.finalDecision).toBe("DECLINE");
    expect(result.hardEvidenceFloor).toBe(95);
  });

  it("keeps exact approval drain above the hard floor even with trusted dampener", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0, [{ code: "internal_label_false_positive", message: "trusted context", scoreImpact: -40 }]),
      whereReport: whereReport(0),
      deepReport: deepReport({ approvalDrainProvenanceProfiles: [approvalDrainProfile()] })
    });

    expect(result.finalScore).toBeGreaterThanOrEqual(90);
    expect(result.finalLevel).toBe("CRITICAL");
    expect(result.dampener).toBe(0);
  });

  it("lets deep behavior contribute instead of leaving the final score at the where score", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(25),
      deepReport: deepReport({
        directCounterpartyInteractionProfiles: [{
          subjectAddress: address,
          direction: "outbound",
          counterpartyAddress: "TRisky11111111111111111111111111111",
          volumeRaw: "500000000000",
          volumeRatio: 0.5,
          txCount: 8,
          firstSeen: "2026-06-01T10:00:00.000Z",
          lastSeen: "2026-06-01T11:00:00.000Z",
          txHashes: ["tx-counterparty"],
          serviceCategory: null,
          identity: null,
          scoreContribution: 80,
          snapshot: {
            address: "TRisky11111111111111111111111111111",
            riskScore: 80,
            riskLevel: "HIGH",
            source: "fast_address_check",
            evidenceClass: "counterparty_behavior_context",
            reasons: ["counterparty fast check found behavior context"],
            partialNotes: []
          },
          interactionWeight: 1,
          evidenceClass: "counterparty_behavior_context",
          skippedReason: null
        }]
      })
    });

    expect(result.finalScore).toBeGreaterThan(25);
    expect(result.layerBreakdown.deep.rawScore).toBe(80);
  });

  it("does not turn service-boundary-only context into hard evidence", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(0),
      deepReport: deepReport({ boundaryExposureProfiles: [boundaryExposureProfile()] })
    });

    expect(result.hardEvidenceFloor).toBe(0);
    expect(result.patternFloor).toBe(0);
    expect(result.finalScore).toBeLessThan(30);
  });

  it("raises TLh-like historical transit behavior to HIGH without hard evidence", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(45),
      deepReport: deepReport({ operationalFlowProfiles: [operationalFlowProfile()] })
    });

    expect(result.hardEvidenceFloor).toBe(0);
    expect(result.patternFloor).toBeGreaterThanOrEqual(70);
    expect(result.finalScore).toBeGreaterThanOrEqual(70);
    expect(result.finalScore).toBeLessThan(85);
    expect(result.finalLevel).toBe("HIGH");
  });

  it("does not allow limited coverage with no evidence to look confidently clean", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(0, {
        coverage: {
          selectedInboundTxCount: 0,
          selectedInboundVolumeRaw: "0",
          currentBalanceCoverageRatio: 0,
          coverageRatio: 0,
          checkedScope: "recent_flow",
          maxDepth: 20,
          fetchedAddressCount: 1,
          partial: true,
          notes: ["provider limit"]
        }
      }),
      deepReport: deepReport({
        missingChecks: ["Metadata enrichment limited by cap"],
        coverage: {
          sourceTransferPages: 0,
          inboundSendersExpanded: 0,
          transferEdges: 0
        }
      })
    });

    expect(result.coverageLevel).toBe("limited");
    expect(result.finalScore).toBeGreaterThanOrEqual(30);
    expect(result.finalLevel).toBe("MEDIUM");
  });
});
```

- [ ] **Step 2: Run the new test and confirm it fails because the module does not exist**

Run:

```bash
npm test -- tests/risk/unifiedWalletRisk.test.ts
```

Expected: FAIL with an import error for `../../src/risk/unifiedWalletRisk`.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/risk/unifiedWalletRisk.test.ts
git commit -m "test: define unified wallet risk scoring behavior"
```

---

### Task 2: Implement Pure Unified Wallet Risk Scorer

**Files:**

- Create: `src/risk/unifiedWalletRisk.ts`
- Test: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Create the scorer module**

Create `src/risk/unifiedWalletRisk.ts` with these exported types and functions:

```ts
import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
import type {
  RiskLabel,
  RiskLevel,
  RiskReason,
  RiskReport,
  UserExchangeDecision,
  WhereIsMoneyReport
} from "../types";

export type UnifiedWalletRiskLayer = "fast" | "deep" | "where";
export type UnifiedWalletCoverageLevel = "complete" | "partial" | "limited";

export type LayerScoreBreakdown = {
  rawScore: number;
  weight: number;
  weightedContribution: number;
  reasons: string[];
};

export type UnifiedWalletRiskReason = {
  code: string;
  message: string;
  score: number;
  source:
    | "fast_check"
    | "deep_research"
    | "where_is_money"
    | "hard_evidence"
    | "pattern_floor"
    | "dampener"
    | "coverage";
};

export type UnifiedWalletRiskInput = {
  address: string;
  fastReport?: RiskReport | null;
  deepReport?: DeepAddressForensicReport | null;
  whereReport: WhereIsMoneyReport;
};

export type UnifiedWalletRiskResult = {
  finalScore: number;
  finalLevel: RiskLevel;
  finalDecision: UserExchangeDecision;
  weightedLayerScore: number;
  hardEvidenceFloor: number;
  patternFloor: number;
  dampener: number;
  coverageLevel: UnifiedWalletCoverageLevel;
  layerBreakdown: Record<UnifiedWalletRiskLayer, LayerScoreBreakdown>;
  reasons: UnifiedWalletRiskReason[];
};

const FAST_LAYER_WEIGHT = 0.10;
const DEEP_LAYER_WEIGHT = 0.60;
const WHERE_LAYER_WEIGHT = 0.30;
const TRON_USDT_DECIMALS = 1_000_000;

const highRiskProvenanceLabels = new Set<RiskLabel>([
  "scam",
  "reported_scam",
  "stolen_funds",
  "phishing",
  "darknet_exchange",
  "darknet_exchange_proximity",
  "approval_drain_proximity"
]);

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function levelFromScore(score: number): RiskLevel {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function decisionFromScore(score: number): UserExchangeDecision {
  return score >= 60 ? "DECLINE" : "ACCEPTABLE";
}

function maxScore(values: Array<number | null | undefined>): number {
  return clampScore(Math.max(0, ...values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))));
}

function rawUsdtAmount(raw: string | null | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) return 0;
  const whole = BigInt(raw) / BigInt(TRON_USDT_DECIMALS);
  const capped = whole > 10_000_000_000n ? 10_000_000_000n : whole;
  return Number(capped);
}

function layer(rawScore: number, weight: number, reasons: string[]): LayerScoreBreakdown {
  const score = clampScore(rawScore);
  return {
    rawScore: score,
    weight,
    weightedContribution: Math.round(score * weight),
    reasons
  };
}

function fastHardEvidenceFloor(fastReport: RiskReport | null | undefined): UnifiedWalletRiskReason | null {
  const reason = fastReport?.reasons.find((item) =>
    item.code === "stablecoin_usdt_blacklisted" ||
    item.code === "forensic_approval_drain_provenance" ||
    item.code.startsWith("internal_label_scam") ||
    item.code.startsWith("internal_label_reported_scam") ||
    item.code.startsWith("internal_label_stolen_funds") ||
    item.code.startsWith("internal_label_phishing")
  );
  if (!reason) return null;
  return {
    code: reason.code,
    message: reason.message,
    score: Math.max(85, clampScore(reason.scoreImpact)),
    source: "hard_evidence"
  };
}

function deepHardEvidenceFloors(report: DeepAddressForensicReport | null | undefined): UnifiedWalletRiskReason[] {
  if (!report) return [];
  const reasons: UnifiedWalletRiskReason[] = [];

  if ((report.stablecoinRestrictionProfiles ?? []).some((profile) => profile.isBlacklisted)) {
    reasons.push({
      code: "usdt_blacklist",
      message: "Active TRC20 USDT blacklist evidence found.",
      score: 95,
      source: "hard_evidence"
    });
  }

  const exactDrain = report.approvalDrainProvenanceProfiles.find((profile) =>
    profile.score >= 85 && profile.evidenceStrength === "exact_approval_and_transfer_from"
  );
  if (exactDrain) {
    reasons.push({
      code: "exact_approval_drain",
      message: "Exact approval-drain provenance found.",
      score: Math.max(90, clampScore(exactDrain.score)),
      source: "hard_evidence"
    });
  }

  for (const profile of report.inboundProvenanceProfiles) {
    if (profile.score <= 0) continue;
    if (profile.paths.some((path) => highRiskProvenanceLabels.has(path.label))) {
      reasons.push({
        code: "deep_high_risk_inbound_provenance",
        message: "Deep Research found deterministic high-risk inbound provenance.",
        score: Math.max(85, clampScore(profile.score)),
        source: "hard_evidence"
      });
    }
  }

  for (const profile of report.extendedProvenanceProfiles ?? []) {
    for (const path of profile.paths) {
      if (path.label && path.evidenceStrength === "exact_labeled_path" && highRiskProvenanceLabels.has(path.label)) {
        reasons.push({
          code: "deep_high_risk_extended_provenance",
          message: "Deep Research found exact high-risk extended provenance.",
          score: Math.max(85, clampScore(Math.max(profile.score, path.candidateScore))),
          source: "hard_evidence"
        });
      }
    }
  }

  return reasons;
}

function whereHardEvidenceFloor(report: WhereIsMoneyReport): UnifiedWalletRiskReason | null {
  const top = report.assessment.hardBadEvidence
    .map((item) => clampScore(item.score))
    .sort((a, b) => b - a)[0];
  if (top === undefined) return null;
  return {
    code: "where_hard_bad_evidence",
    message: "Where Is Money found deterministic hard bad evidence.",
    score: Math.max(85, report.riskScore, top),
    source: "hard_evidence"
  };
}

function deepLayer(report: DeepAddressForensicReport | null | undefined): LayerScoreBreakdown {
  if (!report) return layer(0, DEEP_LAYER_WEIGHT, ["Deep Research report is not available."]);
  const scores: number[] = [];
  const reasons: string[] = [];

  for (const profile of report.serviceExposureProfiles) {
    scores.push(profile.exposureScore);
    if (profile.exposureScore > 0) reasons.push("service exposure profile");
  }

  for (const profile of report.addressBehaviorProfiles) {
    scores.push(profile.depositThenDrainScore, profile.transitScore);
    if (profile.depositThenDrainScore > 0 || profile.transitScore > 0) reasons.push("address behavior profile");
  }

  for (const profile of report.operationalFlowProfiles ?? []) {
    scores.push(profile.operationalScore);
    if (profile.operationalScore > 0) reasons.push("operational flow profile");
  }

  for (const profile of report.boundaryExposureProfiles) {
    scores.push(Math.min(15, profile.contextScore));
    if (profile.contextScore > 0) reasons.push("service-boundary context");
  }

  for (const profile of report.approvalDrainProvenanceProfiles) {
    scores.push(profile.score);
    if (profile.score > 0) reasons.push("approval-drain provenance profile");
  }

  for (const profile of report.inboundProvenanceProfiles) {
    scores.push(profile.score);
    if (profile.score > 0) reasons.push("inbound provenance profile");
  }

  for (const profile of report.extendedProvenanceProfiles ?? []) {
    scores.push(profile.score, ...profile.paths.map((path) => path.candidateScore));
    if (profile.score > 0 || profile.paths.some((path) => path.candidateScore > 0)) reasons.push("extended provenance profile");
  }

  for (const profile of report.directCounterpartyInteractionProfiles ?? []) {
    scores.push(profile.scoreContribution);
    if (profile.scoreContribution > 0) reasons.push("direct counterparty interaction profile");
  }

  return layer(maxScore(scores), DEEP_LAYER_WEIGHT, [...new Set(reasons)]);
}

function fastLayer(input: UnifiedWalletRiskInput): LayerScoreBreakdown {
  const report = input.fastReport ?? input.whereReport.fastWalletRisk;
  return layer(report?.score ?? 0, FAST_LAYER_WEIGHT, report ? report.reasons.map((reason) => reason.code) : ["Fast Check report is not available."]);
}

function whereLayer(report: WhereIsMoneyReport): LayerScoreBreakdown {
  return layer(report.riskScore, WHERE_LAYER_WEIGHT, report.decisionReasons);
}

function historicalTransitPatternFloor(report: DeepAddressForensicReport | null | undefined): UnifiedWalletRiskReason | null {
  const profiles = report?.operationalFlowProfiles ?? [];
  let best: UnifiedWalletRiskReason | null = null;

  for (const profile of profiles) {
    const incomingUsdt = rawUsdtAmount(profile.incomingVolumeRaw);
    const outgoingUsdt = rawUsdtAmount(profile.outgoingVolumeRaw);
    const flowUsdt = Math.max(incomingUsdt, outgoingUsdt);
    if (flowUsdt <= 0 || outgoingUsdt <= 0) continue;

    const volumeFactor = clampRatio(Math.log10(flowUsdt + 1) / 6);
    const passThrough = clampRatio(profile.inflowToOutflowRatio ?? (incomingUsdt > 0 ? outgoingUsdt / incomingUsdt : 0));
    const serviceShare = clampRatio(Math.max(profile.bridgeDexRouterOutgoingRatio, profile.unknownContractOutgoingRatio));
    const score = clampScore(35 + volumeFactor * 20 + passThrough * 20 + serviceShare * 25);

    if (score >= 60 && (!best || score > best.score)) {
      best = {
        code: "historical_transit_pattern",
        message: "Large historical pass-through flow with bridge/swap/router/DEX or unknown-contract exposure.",
        score: Math.min(84, score),
        source: "pattern_floor"
      };
    }
  }

  return best;
}

function routeLinkedApprovalPatternFloor(report: DeepAddressForensicReport | null | undefined): UnifiedWalletRiskReason | null {
  const routeLinked = report?.approvalDrainProvenanceProfiles
    .filter((profile) => profile.evidenceStrength === "route_linked")
    .map((profile) => clampScore(profile.score))
    .sort((a, b) => b - a)[0];
  if (routeLinked === undefined || routeLinked < 60) return null;
  return {
    code: "route_linked_approval_pattern",
    message: "Route-linked approval-drain context found without exact approval-drain proof.",
    score: Math.min(80, routeLinked),
    source: "pattern_floor"
  };
}

function coverageLevel(input: UnifiedWalletRiskInput): UnifiedWalletCoverageLevel {
  const wherePartial = input.whereReport.coverage.partial || input.whereReport.coverage.fetchedAddressCount <= 1;
  const deep = input.deepReport;
  const deepMissingCount = (deep?.missingChecks.length ?? 0) + (deep?.coverageDebug.missingChecks.length ?? 0);
  const deepSparse = deep ? deep.coverage.transferEdges < 10 : true;
  if (wherePartial && deepSparse) return "limited";
  if (wherePartial || deepMissingCount > 0) return "partial";
  return "complete";
}

function coverageFloor(input: UnifiedWalletRiskInput, levelValue: UnifiedWalletCoverageLevel): UnifiedWalletRiskReason | null {
  if (levelValue !== "limited") return null;
  return {
    code: "limited_coverage_floor",
    message: "Coverage is too limited to treat the wallet as confidently clean.",
    score: 30,
    source: "coverage"
  };
}

function rawDampener(input: UnifiedWalletRiskInput): UnifiedWalletRiskReason {
  const fastReasons: RiskReason[] = [
    ...(input.fastReport?.reasons ?? []),
    ...(input.whereReport.fastWalletRisk?.reasons ?? [])
  ];
  const fastNegative = fastReasons
    .filter((reason) => reason.scoreImpact < 0)
    .reduce((sum, reason) => sum + Math.abs(reason.scoreImpact), 0);
  const behaviorDampener = input.deepReport?.addressBehaviorProfiles
    .reduce((max, profile) => Math.max(max, profile.dampenerScore), 0) ?? 0;
  const roleDampener = input.whereReport.assessment.walletRole === "clean_cex_funded_wallet"
    ? 15
    : input.whereReport.assessment.walletRole === "operational_liquidity_wallet"
      ? 10
      : 0;

  return {
    code: "unified_dampener",
    message: "Trusted, clean-role, or behavior dampener applied to non-hard evidence.",
    score: Math.min(40, fastNegative + behaviorDampener + roleDampener),
    source: "dampener"
  };
}

function allowedDampener(input: {
  raw: number;
  baseScore: number;
  hardEvidenceFloor: number;
  patternFloor: number;
}): number {
  if (input.raw <= 0) return 0;
  if (input.hardEvidenceFloor > 0) {
    return Math.min(input.raw, Math.max(0, input.baseScore - input.hardEvidenceFloor));
  }
  if (input.patternFloor > 0) return Math.min(input.raw, 15);
  return Math.min(input.raw, 25);
}

export function calculateUnifiedWalletRisk(input: UnifiedWalletRiskInput): UnifiedWalletRiskResult {
  const fast = fastLayer(input);
  const deep = deepLayer(input.deepReport);
  const where = whereLayer(input.whereReport);
  const weightedLayerScore = clampScore(fast.weightedContribution + deep.weightedContribution + where.weightedContribution);

  const hardReasons = [
    fastHardEvidenceFloor(input.fastReport ?? input.whereReport.fastWalletRisk),
    ...deepHardEvidenceFloors(input.deepReport),
    whereHardEvidenceFloor(input.whereReport)
  ].filter((reason): reason is UnifiedWalletRiskReason => reason !== null);
  const hardEvidenceFloor = maxScore(hardReasons.map((reason) => reason.score));

  const coverage = coverageLevel(input);
  const patternReasons = [
    historicalTransitPatternFloor(input.deepReport),
    routeLinkedApprovalPatternFloor(input.deepReport),
    coverageFloor(input, coverage)
  ].filter((reason): reason is UnifiedWalletRiskReason => reason !== null);
  const patternFloor = maxScore(patternReasons.map((reason) => reason.score));

  const baseScore = maxScore([weightedLayerScore, hardEvidenceFloor, patternFloor]);
  const dampenerReason = rawDampener(input);
  const dampener = allowedDampener({
    raw: dampenerReason.score,
    baseScore,
    hardEvidenceFloor,
    patternFloor
  });
  const dampenedScore = clampScore(baseScore - dampener);
  const coverageAdjustedScore = coverage === "limited" ? Math.max(dampenedScore, 30) : dampenedScore;
  const finalScore = hardEvidenceFloor === 0 ? Math.min(coverageAdjustedScore, 84) : coverageAdjustedScore;

  const reasons = [
    ...hardReasons,
    ...patternReasons,
    ...(dampener > 0 ? [{ ...dampenerReason, score: dampener }] : []),
    {
      code: "weighted_layer_score",
      message: `Weighted layer score is ${weightedLayerScore}/100.`,
      score: weightedLayerScore,
      source: "where_is_money" as const
    }
  ].sort((a, b) => b.score - a.score);

  return {
    finalScore,
    finalLevel: levelFromScore(finalScore),
    finalDecision: decisionFromScore(finalScore),
    weightedLayerScore,
    hardEvidenceFloor,
    patternFloor,
    dampener,
    coverageLevel: coverage,
    layerBreakdown: { fast, deep, where },
    reasons
  };
}
```

- [ ] **Step 2: Run scorer tests**

Run:

```bash
npm test -- tests/risk/unifiedWalletRisk.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit scorer**

```bash
git add src/risk/unifiedWalletRisk.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "feat: add unified wallet risk scorer"
```

---

### Task 3: Connect Unified Scorer To Final Address Report

**Files:**

- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Write failing bot expectation for deep contribution**

In `tests/bot/createBot.test.ts`, update the English test previously named:

```ts
it("keeps where-is-money score as final risk when deep behavior context is present", () => {
```

Rename it to:

```ts
it("uses unified scoring so deep behavior contributes to final risk", () => {
```

Replace the old final score expectations:

```ts
expect(text).toContain("Final risk");
expect(text.match(/\d+\/100/g)).toEqual(["25/100"]);
expect(text).toContain("Behavior warning");
expect(text).not.toContain("Behavior risk");
expect(text).not.toContain("80/100");
```

with:

```ts
expect(text).toContain("Final risk");
const scores = text.match(/\d+\/100/g) ?? [];
expect(scores).toHaveLength(1);
expect(scores[0]).not.toBe("25/100");
expect(Number(scores[0]?.split("/")[0])).toBeGreaterThan(25);
expect(text).toContain("Behavior warning");
expect(text).not.toContain("Behavior risk");
```

In the Russian test previously named:

```ts
it("adds deep behavior as context without replacing the where-is-money score", () => {
```

Rename it to:

```ts
it("adds deep behavior through unified scoring in the Russian final report", () => {
```

Replace:

```ts
expect(text).toContain("25/100");
```

with:

```ts
const scores = text.match(/\d+\/100/g) ?? [];
expect(scores).toHaveLength(1);
expect(scores[0]).not.toBe("25/100");
expect(Number(scores[0]?.split("/")[0])).toBeGreaterThan(25);
```

- [ ] **Step 2: Run the bot tests and confirm they fail**

Run:

```bash
npm test -- tests/bot/createBot.test.ts
```

Expected before implementation: FAIL because the formatter still uses the legacy direct Where Is Money score.

- [ ] **Step 3: Import scorer in createBot**

In `src/bot/createBot.ts`, add this import near the existing risk imports:

```ts
import { calculateUnifiedWalletRisk, type UnifiedWalletRiskResult } from "../risk/unifiedWalletRisk";
```

- [ ] **Step 4: Add formatter helpers for unified scoring lines**

Add these helpers near `whereLimitationLines` in `src/bot/createBot.ts`:

```ts
function unifiedRiskReasonLines(result: UnifiedWalletRiskResult, locale: BotLocale): string[] {
  const topReasons = result.reasons
    .filter((reason) => reason.source !== "dampener")
    .slice(0, 3)
    .map((reason) => reason.message);

  const weighted = locale === "en"
    ? `Weighted layer score: ${result.weightedLayerScore}/100.`
    : `Взвешенный score слоев: ${result.weightedLayerScore}/100.`;

  return [...topReasons, weighted];
}

function unifiedRiskBreakdownLines(result: UnifiedWalletRiskResult, locale: BotLocale): string[] {
  const fast = result.layerBreakdown.fast;
  const deep = result.layerBreakdown.deep;
  const where = result.layerBreakdown.where;
  const lines = [
    `Fast Check: ${fast.rawScore} * ${fast.weight.toFixed(2)} = ${fast.weightedContribution}`,
    `Deep Research: ${deep.rawScore} * ${deep.weight.toFixed(2)} = ${deep.weightedContribution}`,
    `Where Is Money: ${where.rawScore} * ${where.weight.toFixed(2)} = ${where.weightedContribution}`,
    `Hard evidence floor: ${result.hardEvidenceFloor}`,
    `Pattern floor: ${result.patternFloor}`,
    `Dampener: -${result.dampener}`,
    locale === "en"
      ? `Coverage: ${result.coverageLevel}`
      : `Покрытие: ${result.coverageLevel}`
  ];
  return lines;
}
```

- [ ] **Step 5: Replace final score calculation in `formatUnifiedAddressFinalReport`**

In `src/bot/createBot.ts`, replace the legacy final-score block with a unified scorer call:

```ts
const unifiedRisk = calculateUnifiedWalletRisk({
  address: input.address,
  fastReport: input.fastReport,
  deepReport: input.deepReport,
  whereReport: input.whereReport
});
const finalDecision = unifiedRisk.finalDecision;
const finalScore = unifiedRisk.finalScore;
const finalLevel = unifiedRisk.finalLevel;
const reasonLines = [
  ...unifiedRiskReasonLines(unifiedRisk, locale),
  whereCoverageSummaryLine(input.whereReport, locale),
  input.whereReport.assessment.hardBadEvidence.length === 0 && unifiedRisk.hardEvidenceFloor === 0
    ? (locale === "en" ? "No deterministic bad evidence was found." : "Жёстких плохих доказательств не найдено.")
    : null,
  ...unifiedBehaviorContextLines(input.deepReport, locale)
].filter((line): line is string => Boolean(line)).slice(0, 5);
```

Then add a score-breakdown section after the existing `Why` section:

```ts
section(locale === "en" ? "Score breakdown" : "Расчет score", [
  bulletList(unifiedRiskBreakdownLines(unifiedRisk, locale))
]),
```

The return block should still end with `runtimeMarkerLine(input.runtimeLabel)`.

- [ ] **Step 6: Historical cleanup note for obsolete private formatter helpers**

Historical implementation-plan note: this item referred to pre-rollout private hard-evidence formatter helpers in `src/bot/createBot.ts`. After the rollout, the final address report path uses `calculateUnifiedWalletRisk(...)`; a follow-up cleanup should search for unused local formatter helpers instead of reintroducing a separate final-score path.

- [ ] **Step 7: Run targeted bot tests**

Run:

```bash
npm test -- tests/bot/createBot.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run scorer tests again**

Run:

```bash
npm test -- tests/risk/unifiedWalletRisk.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit formatter integration**

```bash
git add src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: use unified wallet risk in final report"
```

---

### Task 4: Increase Fast Check Production Limits

**Files:**

- Modify: `src/check/addressExposureSignals.ts`
- Modify: `tests/check/addressExposureSignals.test.ts`

- [ ] **Step 1: Update the default-limit test first**

In `tests/check/addressExposureSignals.test.ts`, rename:

```ts
it("uses latest 60 historical transfers by default when the 30d window has fewer than 60 transfers", async () => {
```

to:

```ts
it("uses latest 100 historical transfers by default when the 90d window has fewer than 100 transfers", async () => {
```

Change the expected fallback call:

```ts
{ hasWindow: false, limit: 60 }
```

to:

```ts
{ hasWindow: false, limit: 100 }
```

Change the provider options inside that test from:

```ts
pageLimit: 50,
timeoutMs: 10_000
```

to:

```ts
pageLimit: 100,
timeoutMs: 30_000
```

- [ ] **Step 2: Run the fast-check test and confirm it fails**

Run:

```bash
npm test -- tests/check/addressExposureSignals.test.ts
```

Expected: FAIL because the provider still requests `limit: 60`.

- [ ] **Step 3: Update Fast Check defaults**

In `src/check/addressExposureSignals.ts`, replace the default constants:

```ts
const DEFAULT_DAYS = 30;
const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_PAGES_PER_ADDRESS = 1;
const DEFAULT_PAGE_LIMIT = 50;
const DEFAULT_LIMIT = 5;
const DEFAULT_CONTRACT_PROFILE_FETCH_LIMIT = 5;
const DEFAULT_MAX_EXPANDED_INTERMEDIATES = 10;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_TRANSFER_CACHE_TTL_MS = 300_000;
const DEFAULT_STABLECOIN_RESTRICTION_CACHE_TTL_MS = 300_000;
const DEFAULT_METADATA_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_METADATA_FETCH_LIMIT = 12;
const DEFAULT_RECENT_FALLBACK_MIN_TRANSFER_COUNT = 60;
const DEFAULT_RECENT_FALLBACK_TRANSFER_LIMIT = 60;
```

with:

```ts
const DEFAULT_DAYS = 90;
const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_PAGES_PER_ADDRESS = 2;
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_LIMIT = 10;
const DEFAULT_CONTRACT_PROFILE_FETCH_LIMIT = 15;
const DEFAULT_MAX_EXPANDED_INTERMEDIATES = 30;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TRANSFER_CACHE_TTL_MS = 300_000;
const DEFAULT_STABLECOIN_RESTRICTION_CACHE_TTL_MS = 300_000;
const DEFAULT_METADATA_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_METADATA_FETCH_LIMIT = 30;
const DEFAULT_RECENT_FALLBACK_MIN_TRANSFER_COUNT = 100;
const DEFAULT_RECENT_FALLBACK_TRANSFER_LIMIT = 100;
```

- [ ] **Step 4: Run Fast Check tests**

Run:

```bash
npm test -- tests/check/addressExposureSignals.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Fast Check limits**

```bash
git add src/check/addressExposureSignals.ts tests/check/addressExposureSignals.test.ts
git commit -m "chore: expand fast check production limits"
```

---

### Task 5: Increase Deep Research Production Limits

**Files:**

- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `src/check/deepForensicCheck.ts`
- Modify: `tests/forensics/deepForensicJob.test.ts`
- Modify: `tests/check/deepForensicCheck.test.ts`

- [ ] **Step 1: Update Deep Research job default expectations**

In `tests/forensics/deepForensicJob.test.ts`, update tests that assert job-runner defaults so the expected call to `runDeepAddressForensicCheck` uses:

```ts
expect.objectContaining({
  maxDepth: 3,
  pageLimit: 100,
  maxPagesPerAddress: 3,
  maxExpandedIntermediates: 30,
  metadataFetchLimit: 30,
  contractProfileFetchLimit: 15,
  maxInboundSenders: 15,
  maxApprovalDrainCandidates: 15,
  approvalChangeLookupLimit: 20,
  extendedSearchMode: "always",
  extendedSearchMaxDepth: 6,
  extendedSearchBeamWidth: 12,
  extendedSearchMaxAddressFetches: 150,
  recentFallbackMinTransferCount: 150,
  recentFallbackTransferLimit: 150,
  counterpartyFastSnapshotLimit: 60,
  counterpartyFastSnapshotActiveLimit: 30
})
```

Use this command to find old assertions before editing:

```bash
rg -n "maxDepth: 2|maxPagesPerAddress|metadataFetchLimit|contractProfileFetchLimit|maxInboundSenders|maxApprovalDrainCandidates|extendedSearchMaxDepth|extendedSearchBeamWidth|extendedSearchMaxAddressFetches|recentFallbackTransferLimit" tests/forensics/deepForensicJob.test.ts tests/check/deepForensicCheck.test.ts
```

- [ ] **Step 2: Run Deep Research tests and confirm failure**

Run:

```bash
npm test -- tests/forensics/deepForensicJob.test.ts tests/check/deepForensicCheck.test.ts
```

Expected: FAIL because runtime defaults are still old.

- [ ] **Step 3: Update low-level Deep Research defaults**

In `src/check/deepForensicCheck.ts`, replace:

```ts
const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_PAGES_PER_ADDRESS = 2;
const DEFAULT_PAGE_LIMIT = 50;
const DEFAULT_LIMIT = 5;
const DEFAULT_MAX_INBOUND_SENDERS = 5;
const DEFAULT_EXTENDED_TRIGGER_VOLUME_RAW = "100000000000";
```

with:

```ts
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_PAGES_PER_ADDRESS = 3;
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_INBOUND_SENDERS = 15;
const DEFAULT_EXTENDED_TRIGGER_VOLUME_RAW = "100000000000";
```

- [ ] **Step 4: Update Deep Research job-runner defaults**

In `src/forensics/deepForensicJob.ts`, inside the call to `runDeepAddressForensicCheck`, replace:

```ts
maxDepth: 2,
pageLimit: options.pageLimit,
maxPagesPerAddress: options.maxPagesPerAddress ?? 2,
maxExpandedIntermediates: options.maxExpandedIntermediates ?? 10,
metadataFetchLimit: options.metadataFetchLimit ?? 12,
contractProfileFetchLimit: options.contractProfileFetchLimit ?? 5,
maxInboundSenders: options.maxInboundSenders ?? 5,
maxApprovalDrainCandidates: options.maxApprovalDrainCandidates ?? 5,
approvalChangeLookupLimit: options.approvalChangeLookupLimit ?? 5,
extendedSearchMode: options.extendedSearchMode ?? "auto",
extendedSearchMaxDepth: options.extendedSearchMaxDepth ?? 4,
extendedSearchBeamWidth: options.extendedSearchBeamWidth ?? 8,
extendedSearchMaxAddressFetches: options.extendedSearchMaxAddressFetches ?? 60,
recentFallbackMinTransferCount: options.recentFallbackMinTransferCount ?? 60,
recentFallbackTransferLimit: options.recentFallbackTransferLimit ?? 60,
apiKeyConfigured: options.apiKeyConfigured
```

with:

```ts
maxDepth: 3,
pageLimit: options.pageLimit ?? 100,
maxPagesPerAddress: options.maxPagesPerAddress ?? 3,
maxExpandedIntermediates: options.maxExpandedIntermediates ?? 30,
metadataFetchLimit: options.metadataFetchLimit ?? 30,
contractProfileFetchLimit: options.contractProfileFetchLimit ?? 15,
maxInboundSenders: options.maxInboundSenders ?? 15,
maxApprovalDrainCandidates: options.maxApprovalDrainCandidates ?? 15,
approvalChangeLookupLimit: options.approvalChangeLookupLimit ?? 20,
extendedSearchMode: options.extendedSearchMode ?? "always",
extendedSearchMaxDepth: options.extendedSearchMaxDepth ?? 6,
extendedSearchBeamWidth: options.extendedSearchBeamWidth ?? 12,
extendedSearchMaxAddressFetches: options.extendedSearchMaxAddressFetches ?? 150,
recentFallbackMinTransferCount: options.recentFallbackMinTransferCount ?? 150,
recentFallbackTransferLimit: options.recentFallbackTransferLimit ?? 150,
counterpartyFastSnapshotLimit: options.counterpartyFastSnapshotLimit ?? 60,
counterpartyFastSnapshotActiveLimit: options.counterpartyFastSnapshotActiveLimit ?? 30,
apiKeyConfigured: options.apiKeyConfigured
```

- [ ] **Step 5: Keep Where Is Money job depth stable but expand its budget**

In `src/forensics/deepForensicJob.ts`, inside the `runWhereIsMoneyCheck` call for where jobs, keep:

```ts
maxDepth: Math.max(options.extendedSearchMaxDepth ?? 20, 20),
```

but replace:

```ts
beamWidth: Math.max(options.extendedSearchBeamWidth ?? 8, 8),
maxAddressFetches: Math.max(options.extendedSearchMaxAddressFetches ?? 60, 60),
recentFallbackMinTransferCount: options.recentFallbackMinTransferCount ?? 60,
recentFallbackTransferLimit: options.recentFallbackTransferLimit ?? 60,
```

with:

```ts
beamWidth: Math.max(options.extendedSearchBeamWidth ?? 12, 12),
maxAddressFetches: Math.max(options.extendedSearchMaxAddressFetches ?? 150, 150),
recentFallbackMinTransferCount: options.recentFallbackMinTransferCount ?? 150,
recentFallbackTransferLimit: options.recentFallbackTransferLimit ?? 150,
```

- [ ] **Step 6: Run Deep Research tests**

Run:

```bash
npm test -- tests/forensics/deepForensicJob.test.ts tests/check/deepForensicCheck.test.ts
```

Expected: PASS after updating old fixed expectations.

- [ ] **Step 7: Commit Deep Research limits**

```bash
git add src/forensics/deepForensicJob.ts src/check/deepForensicCheck.ts tests/forensics/deepForensicJob.test.ts tests/check/deepForensicCheck.test.ts
git commit -m "chore: expand deep research production limits"
```

---

### Task 6: Increase Where Is Money Runtime And CLI Limits

**Files:**

- Modify: `src/forensics/whereIsMoneyCliArgs.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Modify: `tests/forensics/whereIsMoneyCliArgs.test.ts`
- Modify: `tests/check/whereIsMoneyCheck.test.ts`
- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Update CLI default test**

In `tests/forensics/whereIsMoneyCliArgs.test.ts`, change the default expected object:

```ts
days: 30,
depth: 20,
beamWidth: 8,
maxAddressFetches: 60,
maxEdgesPerAddress: 40,
```

to:

```ts
days: 90,
depth: 20,
beamWidth: 12,
maxAddressFetches: 150,
maxEdgesPerAddress: 100,
```

Change:

```ts
expect(parsed.windowStart.toISOString()).toBe("2026-04-26T00:00:00.000Z");
```

to:

```ts
expect(parsed.windowStart.toISOString()).toBe("2026-02-25T00:00:00.000Z");
```

Add these expectations to the same default test:

```ts
expect(parsed.approvalEnrichmentMode).toBe("triggered");
expect(parsed.maxApprovalCandidates).toBe(30);
expect(parsed.maxContractTransactionInfoFetches).toBe(30);
```

- [ ] **Step 2: Update broad-search rejection tests**

In the test named:

```ts
it("rejects values that would make the local search too broad", () => {
```

Change the beam rejection from:

```ts
expect(() => parseWhereIsMoneyCliArgs([
  "--source",
  source,
  "--beam",
  "20"
])).toThrow(/--beam must be an integer between 1 and 8/);
```

to:

```ts
expect(() => parseWhereIsMoneyCliArgs([
  "--source",
  source,
  "--beam",
  "20"
])).toThrow(/--beam must be an integer between 1 and 12/);
```

Change max-address rejection expectations from `60` to `150` where they assert upper bounds.

- [ ] **Step 3: Run CLI tests and confirm failure**

Run:

```bash
npm test -- tests/forensics/whereIsMoneyCliArgs.test.ts
```

Expected: FAIL because CLI constants are still old.

- [ ] **Step 4: Update Where Is Money CLI constants**

In `src/forensics/whereIsMoneyCliArgs.ts`, replace:

```ts
export const WHERE_IS_MONEY_DEFAULT_DAYS = 30;
export const WHERE_IS_MONEY_DEFAULT_DEPTH = 20;
export const WHERE_IS_MONEY_MAX_DEPTH = 20;
export const WHERE_IS_MONEY_DEFAULT_BEAM_WIDTH = 8;
export const WHERE_IS_MONEY_MAX_BEAM_WIDTH = 8;
export const WHERE_IS_MONEY_DEFAULT_MAX_ADDRESS_FETCHES = 60;
export const WHERE_IS_MONEY_MAX_ADDRESS_FETCHES = 60;
export const WHERE_IS_MONEY_DEFAULT_MAX_EDGES_PER_ADDRESS = 40;
export const WHERE_IS_MONEY_MAX_EDGES_PER_ADDRESS = 100;
export const WHERE_IS_MONEY_DEFAULT_APPROVAL_ENRICHMENT_MODE = "triggered" as const;
export const WHERE_IS_MONEY_DEFAULT_MAX_APPROVAL_CANDIDATES = 12;
export const WHERE_IS_MONEY_MAX_APPROVAL_CANDIDATES = 100;
export const WHERE_IS_MONEY_DEFAULT_MAX_CONTRACT_TX_INFO = 12;
export const WHERE_IS_MONEY_MAX_CONTRACT_TX_INFO = 100;
export const WHERE_IS_MONEY_DEFAULT_CONTRACT_TX_INFO_DELAY_MS = 15000;
export const WHERE_IS_MONEY_MAX_CONTRACT_TX_INFO_DELAY_MS = 60000;
export const WHERE_IS_MONEY_DEFAULT_CROSS_CHAIN_MAX_PROVIDER_CALLS = 60;
export const WHERE_IS_MONEY_MAX_CROSS_CHAIN_PROVIDER_CALLS = 500;
```

with:

```ts
export const WHERE_IS_MONEY_DEFAULT_DAYS = 90;
export const WHERE_IS_MONEY_DEFAULT_DEPTH = 20;
export const WHERE_IS_MONEY_MAX_DEPTH = 20;
export const WHERE_IS_MONEY_DEFAULT_BEAM_WIDTH = 12;
export const WHERE_IS_MONEY_MAX_BEAM_WIDTH = 12;
export const WHERE_IS_MONEY_DEFAULT_MAX_ADDRESS_FETCHES = 150;
export const WHERE_IS_MONEY_MAX_ADDRESS_FETCHES = 150;
export const WHERE_IS_MONEY_DEFAULT_MAX_EDGES_PER_ADDRESS = 100;
export const WHERE_IS_MONEY_MAX_EDGES_PER_ADDRESS = 150;
export const WHERE_IS_MONEY_DEFAULT_APPROVAL_ENRICHMENT_MODE = "triggered" as const;
export const WHERE_IS_MONEY_DEFAULT_MAX_APPROVAL_CANDIDATES = 30;
export const WHERE_IS_MONEY_MAX_APPROVAL_CANDIDATES = 100;
export const WHERE_IS_MONEY_DEFAULT_MAX_CONTRACT_TX_INFO = 30;
export const WHERE_IS_MONEY_MAX_CONTRACT_TX_INFO = 100;
export const WHERE_IS_MONEY_DEFAULT_CONTRACT_TX_INFO_DELAY_MS = 15000;
export const WHERE_IS_MONEY_MAX_CONTRACT_TX_INFO_DELAY_MS = 60000;
export const WHERE_IS_MONEY_DEFAULT_CROSS_CHAIN_MAX_PROVIDER_CALLS = 200;
export const WHERE_IS_MONEY_MAX_CROSS_CHAIN_PROVIDER_CALLS = 500;
```

Update `WHERE_IS_MONEY_USAGE` strings in the same file so the visible defaults say:

```text
[--days 90] [--depth 20] [--beam 12] [--max-addresses 150] [--max-edges 100] [--approval-candidates 30] [--contract-tx-info 30] [--cross-chain-max-provider-calls 200]
```

- [ ] **Step 5: Update Where Is Money runtime defaults**

In `src/check/whereIsMoneyCheck.ts`, replace:

```ts
const DEFAULT_BEAM_WIDTH = 8;
const DEFAULT_MAX_ADDRESS_FETCHES = 60;
const DEFAULT_MAX_EDGES_PER_ADDRESS = 40;
const DEFAULT_RECENT_FALLBACK_MIN_TRANSFER_COUNT = 60;
const DEFAULT_RECENT_FALLBACK_TRANSFER_LIMIT = 60;
const DEFAULT_MAX_APPROVAL_CANDIDATES = 12;
const DEFAULT_MAX_CONTRACT_TRANSACTION_INFO_FETCHES = 12;
const DEFAULT_CROSS_CHAIN_MAX_PROVIDER_CALLS = 60;
```

with:

```ts
const DEFAULT_BEAM_WIDTH = 12;
const DEFAULT_MAX_ADDRESS_FETCHES = 150;
const DEFAULT_MAX_EDGES_PER_ADDRESS = 100;
const DEFAULT_RECENT_FALLBACK_MIN_TRANSFER_COUNT = 150;
const DEFAULT_RECENT_FALLBACK_TRANSFER_LIMIT = 150;
const DEFAULT_MAX_APPROVAL_CANDIDATES = 30;
const DEFAULT_MAX_CONTRACT_TRANSACTION_INFO_FETCHES = 30;
const DEFAULT_CROSS_CHAIN_MAX_PROVIDER_CALLS = 200;
```

Keep:

```ts
const DEFAULT_MAX_DEPTH = 20;
```

- [ ] **Step 6: Split address-profile and transaction-origin windows in bot**

In `src/bot/createBot.ts`, replace:

```ts
const TRANSACTION_ORIGIN_HISTORY_MS = 30 * 24 * 60 * 60 * 1000;
```

with:

```ts
const TRANSACTION_ORIGIN_HISTORY_MS = 30 * 24 * 60 * 60 * 1000;
const ADDRESS_PROFILE_HISTORY_MS = 90 * 24 * 60 * 60 * 1000;
```

In `replyWithCheck`, where address checks queue both wallet profile and deep jobs, replace:

```ts
const forensicWindowStart = new Date(forensicWindowEnd.getTime() - TRANSACTION_ORIGIN_HISTORY_MS);
```

with:

```ts
const forensicWindowStart = new Date(forensicWindowEnd.getTime() - ADDRESS_PROFILE_HISTORY_MS);
```

Do not change the transaction-check path that anchors around a transaction timestamp. It should keep `TRANSACTION_ORIGIN_HISTORY_MS`.

- [ ] **Step 7: Run Where Is Money tests**

Run:

```bash
npm test -- tests/forensics/whereIsMoneyCliArgs.test.ts tests/check/whereIsMoneyCheck.test.ts tests/bot/createBot.test.ts
```

Expected: PASS after updating fixed expectations that still mention old defaults.

- [ ] **Step 8: Commit Where Is Money limits**

```bash
git add src/forensics/whereIsMoneyCliArgs.ts src/check/whereIsMoneyCheck.ts src/bot/createBot.ts tests/forensics/whereIsMoneyCliArgs.test.ts tests/check/whereIsMoneyCheck.test.ts tests/bot/createBot.test.ts
git commit -m "chore: expand where-is-money production limits"
```

---

### Task 7: Update Documentation With Implemented Scoring And Limits

**Files:**

- Modify: `docs/project-walkthrough/01-address-check-fast-check.md`
- Modify: `docs/superpowers/specs/2026-06-04-unified-wallet-risk-score-v1-design.md`
- Modify: `docs/superpowers/plans/2026-06-04-unified-wallet-risk-score-v1.md`

- [x] **Step 1: Update walkthrough doc**

Document the implemented final scoring path:

- final report uses `calculateUnifiedWalletRisk(...)`;
- one score is formed from Fast Check, Deep Research, and Where Is Money;
- weights are Fast `0.10`, Deep `0.60`, Where `0.30`;
- missing layers are normalized among available layers;
- hard evidence floors, pattern floors, dampener, coverage, final decision, and final level are visible;
- TLh notes are kept as earlier product/manual-run context, not a live blockchain claim.

- [x] **Step 2: Update design spec**

Document the implemented scorer, Telegram breakdown lines, production limits, rollout status, and source-backed references.

- [x] **Step 3: Update this implementation plan**

Mark this plan as implemented and documented in the current rollout closeout, preserve historical execution detail, and remove stale exact scoring snippets.

- [x] **Step 4: Record documentation closeout**

```bash
git add docs/project-walkthrough/01-address-check-fast-check.md docs/superpowers/specs/2026-06-04-unified-wallet-risk-score-v1-design.md docs/superpowers/plans/2026-06-04-unified-wallet-risk-score-v1.md
git commit -m "docs: document unified wallet scoring rollout"
```

---

### Task 8: Full Verification

**Files:**

- Verify all changed files.

- [x] **Step 1: Run targeted tests**

Run:

```bash
npm test -- tests/risk/unifiedWalletRisk.test.ts tests/bot/createBot.test.ts tests/check/addressExposureSignals.test.ts tests/forensics/deepForensicJob.test.ts tests/check/deepForensicCheck.test.ts tests/forensics/whereIsMoneyCliArgs.test.ts tests/check/whereIsMoneyCheck.test.ts
```

Expected: PASS.

Verified in final closeout: PASS, 9 files / 273 tests. The final run also included `tests/runtime/deepForensicRuntimeOptions.test.ts` and `tests/config/config.test.ts`.

- [x] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

Verified in final closeout: PASS.

- [x] **Step 3: Run full suite**

Run:

```bash
npm test
```

Expected: PASS.

Verified in final closeout: PASS, 109 files / 1309 tests.

- [x] **Step 4: Inspect git diff**

Run:

```bash
git diff --stat HEAD
git diff -- src/risk/unifiedWalletRisk.ts src/bot/createBot.ts src/check/addressExposureSignals.ts src/forensics/deepForensicJob.ts src/check/deepForensicCheck.ts src/forensics/whereIsMoneyCliArgs.ts src/check/whereIsMoneyCheck.ts
```

Expected:

- scorer is pure and has no network/provider calls;
- final report uses `calculateUnifiedWalletRisk`;
- hard evidence cannot be dampened below floor;
- service-boundary-only context stays capped;
- limits match the production profile;
- tests cover TLh-like historical transit behavior.

Verified in final closeout with status/diff checks after the docs status update.

- [x] **Step 5: Final commit if any verification-only fixes were needed**

If verification required small fixes after the earlier commits, commit them:

```bash
git add src tests docs
git commit -m "fix: stabilize unified wallet risk rollout"
```

If no fixes were needed, do not create an empty commit.

No source/test fixes were needed after final verification. The docs closeout status was amended into `docs: document unified wallet scoring rollout`.

---

## Self-Review Checklist

- Spec coverage: covered scorer architecture, hard evidence floors, pattern floors, dampeners, one final score, larger limits, reporting, tests, rollout docs.
- Scope: one implementation plan; Deep Research historical movement uses existing `operationalFlowProfiles` in v1 rather than a full new detector.
- Type consistency: plan consistently uses `calculateUnifiedWalletRisk`, `UnifiedWalletRiskResult`, `LayerScoreBreakdown`, `RiskReport`, `WhereIsMoneyReport`, and `DeepAddressForensicReport`.
- Risk: limit increases may expose provider rate limits. Mitigation is that existing coverage/missing-check reporting remains in place and tests must be updated where old defaults are hard-coded.
