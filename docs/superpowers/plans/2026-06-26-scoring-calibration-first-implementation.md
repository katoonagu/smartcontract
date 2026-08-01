# Scoring Calibration First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only calibration layer that audits saved forensic jobs, adds source-attribution summaries, introduces admin-only insufficient-coverage/candidate scoring diagnostics, and preserves current production verdicts until calibration data supports a scoring change.

**Architecture:** Add focused pure modules first: source attribution, audit row extraction, cohort/report formatting, and shadow scoring. Then expose the report through a CLI and a small admin API/view. Do not change the production `calculateUnifiedWalletRisk` output or final Telegram user verdicts in this plan.

**Tech Stack:** TypeScript, Vitest, Node `tsx` scripts, existing Postgres repository helpers, existing vanilla admin console, existing forensic job JSON contracts.

---

## File Map

- Create `src/forensics/sourceAttributionSummary.ts`: pure helper that computes probability-like source attribution summaries from Where/Incoming path JSON.
- Create `tests/forensics/sourceAttributionSummary.test.ts`: fixture tests for explained share, unknown share, path strength, source confidence, and boundary penalties.
- Create `src/risk/scoringAudit.ts`: pure extractor that turns `ForensicCheckJob` objects into normalized audit rows and cohort flags.
- Create `tests/risk/scoringAudit.test.ts`: tests for high partial score, low incomplete score, acceptable limited coverage, decline without hard evidence, conflicts, hard evidence, policy floor, dampener.
- Create `src/risk/shadowScoring.ts`: candidate decision mapper that compares current result against calibration-first rules without changing production score.
- Create `tests/risk/shadowScoring.test.ts`: tests for insufficient coverage, policy-only high risk, hard evidence override, and unchanged current decision.
- Create `src/forensics/scoringAuditReport.ts`: JSON/Markdown report formatter and aggregate cohort summary.
- Create `tests/forensics/scoringAuditReport.test.ts`: formatter tests.
- Create `src/forensics/scoringAuditCliArgs.ts`: CLI parser for job id/address/all/latest/limit/out-dir/format.
- Create `tests/forensics/scoringAuditCliArgs.test.ts`: CLI parser tests.
- Create `scripts/forensicScoringAudit.ts`: read-only CLI that loads jobs and writes audit artifacts.
- Modify `package.json`: add `forensic:scoring-audit`.
- Modify `src/admin/adminServer.ts`: add `/admin/api/scoring-audit`.
- Modify `tests/admin/adminServer.test.ts`: API authorization and response tests.
- Modify `src/admin/adminConsole.ts`: add Scoring audit panel entry and rendering helpers.
- Modify `tests/admin/adminConsole.test.ts`: shell smoke assertions for audit panel strings.
- Modify docs: `docs/project-walkthrough/04-unified-wallet-risk-scoring-v2.md` and `docs/project-walkthrough/16-qa-and-release-checks.md`.

---

### Task 1: Source Attribution Summary

**Files:**
- Create: `src/forensics/sourceAttributionSummary.ts`
- Create: `tests/forensics/sourceAttributionSummary.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/forensics/sourceAttributionSummary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildIncomingSourceAttributionSummary,
  buildWhereSourceAttributionSummary
} from "../../src/forensics/sourceAttributionSummary";

describe("source attribution summary", () => {
  it("summarizes a strong where-is-money source candidate", () => {
    const summary = buildWhereSourceAttributionSummary({
      paths: [{
        id: "path-1",
        sourceAddress: "TBinance111111111111111111111111111",
        exposureSourceLabel: "Binance",
        sourceExposureKind: "allowlisted_cex",
        balanceShare: 0.68,
        effectiveExposureShare: 0.68,
        amountContinuity: 0.95,
        hops: 2,
        elapsedMs: 20 * 60 * 1000,
        stoppedReason: null,
        reasons: ["allowlisted CEX source"]
      }]
    });

    expect(summary.explainedAmountShare).toBe(0.68);
    expect(summary.unknownAmountShare).toBe(0.32);
    expect(summary.topSourceCandidate).toMatchObject({
      label: "Binance",
      kind: "allowlisted_cex",
      share: 0.68,
      pathStrength: "strong"
    });
    expect(summary.sourceConfidence).toBeGreaterThanOrEqual(70);
    expect(summary.attributionBasis).toContain("amount continuity");
  });

  it("keeps low-continuity boundary paths weak and leaves unknown mass", () => {
    const summary = buildWhereSourceAttributionSummary({
      paths: [{
        id: "path-weak",
        sourceAddress: "TBridge1111111111111111111111111111",
        exposureSourceLabel: "Bridge boundary",
        sourceExposureKind: "bridge_router_dex",
        balanceShare: 0.4,
        effectiveExposureShare: 0.2,
        amountContinuity: 0.35,
        hops: 6,
        elapsedMs: 12 * 24 * 60 * 60 * 1000,
        stoppedReason: "bridge router reached",
        reasons: ["boundary reached"]
      }]
    });

    expect(summary.explainedAmountShare).toBe(0.2);
    expect(summary.unknownAmountShare).toBe(0.8);
    expect(summary.topSourceCandidate?.pathStrength).toBe("weak");
    expect(summary.sourceConfidence).toBeLessThan(50);
    expect(summary.boundaryReason).toBe("bridge router reached");
  });

  it("summarizes incoming deposit origin paths with explained and unknown shares", () => {
    const summary = buildIncomingSourceAttributionSummary({
      paths: [{
        sourceAddress: "TClean11111111111111111111111111111",
        sourceLabel: "Clean CEX",
        sourcePolicy: "clean",
        amountCoverageRatio: 0.85,
        amountContinuity: "strong",
        stoppedReason: null,
        steps: [
          { from: "TClean11111111111111111111111111111", to: "TSender111111111111111111111111111", amountRaw: "850000000", timestamp: "2026-06-01T00:00:00.000Z", txHash: "tx1" }
        ],
        reasons: ["clean source coverage"]
      }]
    });

    expect(summary.explainedAmountShare).toBe(0.85);
    expect(summary.unknownAmountShare).toBe(0.15);
    expect(summary.topSourceCandidate).toMatchObject({
      label: "Clean CEX",
      kind: "clean",
      share: 0.85,
      pathStrength: "strong"
    });
  });

  it("returns an unknown summary when no paths exist", () => {
    const summary = buildWhereSourceAttributionSummary({ paths: [] });

    expect(summary.explainedAmountShare).toBe(0);
    expect(summary.unknownAmountShare).toBe(1);
    expect(summary.topSourceCandidate).toBeNull();
    expect(summary.sourceConfidence).toBe(0);
    expect(summary.pathStrength).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
npx vitest run --configLoader bundle tests/forensics/sourceAttributionSummary.test.ts
```

Expected: fail because `src/forensics/sourceAttributionSummary.ts` does not exist.

- [ ] **Step 3: Implement the pure helper**

Create `src/forensics/sourceAttributionSummary.ts`:

```ts
export type SourceAttributionPathStrength = "strong" | "medium" | "weak" | "unknown";

export type SourceAttributionCandidate = {
  label: string;
  address: string | null;
  kind: string;
  share: number;
  pathStrength: SourceAttributionPathStrength;
  confidence: number;
};

export type SourceAttributionSummary = {
  explainedAmountShare: number;
  unknownAmountShare: number;
  topSourceCandidate: SourceAttributionCandidate | null;
  topSourceShare: number;
  pathStrength: SourceAttributionPathStrength;
  sourceConfidence: number;
  attributionBasis: string[];
  boundaryReason: string | null;
};

export type WhereSourceAttributionPathInput = {
  id?: string;
  sourceAddress?: string | null;
  exposureSourceLabel?: string | null;
  sourceExposureKind?: string | null;
  exposureSourceKey?: string | null;
  rootSourceType?: string | null;
  balanceShare?: number | null;
  effectiveExposureShare?: number | null;
  amountContinuity?: number | null;
  hops?: number | null;
  elapsedMs?: number | null;
  stoppedReason?: string | null;
  reasons?: string[];
};

export type IncomingSourceAttributionPathInput = {
  sourceAddress?: string | null;
  sourceLabel?: string | null;
  sourcePolicy?: string | null;
  amountCoverageRatio?: number | null;
  amountContinuity?: "strong" | "medium" | "weak" | null;
  stoppedReason?: string | null;
  steps?: Array<{ timestamp?: string | Date | null }>;
  reasons?: string[];
};

function clampRatio(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? Number.NaN)) return 0;
  return Math.max(0, Math.min(1, value ?? 0));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roundedRatio(value: number): number {
  return Math.round(clampRatio(value) * 100) / 100;
}

function pathStrengthFromScore(score: number): SourceAttributionPathStrength {
  if (score >= 70) return "strong";
  if (score >= 45) return "medium";
  if (score > 0) return "weak";
  return "unknown";
}

function whereCandidate(path: WhereSourceAttributionPathInput): SourceAttributionCandidate {
  const share = clampRatio(path.effectiveExposureShare ?? path.balanceShare);
  const amountContinuity = clampRatio(path.amountContinuity ?? 1);
  const hopPenalty = Math.max(0, (path.hops ?? 1) - 2) * 3;
  const timePenalty = typeof path.elapsedMs === "number" && path.elapsedMs > 7 * 24 * 60 * 60 * 1000 ? 8 : 0;
  const boundaryPenalty = path.stoppedReason ? 12 : 0;
  const confidence = clampScore(share * 55 + amountContinuity * 35 - hopPenalty - timePenalty - boundaryPenalty + 10);
  const kind = path.sourceExposureKind ?? path.exposureSourceKey ?? path.rootSourceType ?? "unknown";
  return {
    label: path.exposureSourceLabel ?? kind,
    address: path.sourceAddress ?? null,
    kind,
    share,
    pathStrength: pathStrengthFromScore(confidence),
    confidence
  };
}

function incomingCandidate(path: IncomingSourceAttributionPathInput): SourceAttributionCandidate {
  const share = clampRatio(path.amountCoverageRatio);
  const continuityBonus = path.amountContinuity === "strong" ? 30 : path.amountContinuity === "medium" ? 15 : 0;
  const boundaryPenalty = path.stoppedReason ? 20 : 0;
  const confidence = clampScore(share * 65 + continuityBonus - boundaryPenalty);
  const kind = path.sourcePolicy ?? "unknown";
  return {
    label: path.sourceLabel ?? kind,
    address: path.sourceAddress ?? null,
    kind,
    share,
    pathStrength: pathStrengthFromScore(confidence),
    confidence
  };
}

function buildSummary(candidates: SourceAttributionCandidate[], boundaryReason: string | null): SourceAttributionSummary {
  const sorted = [...candidates].sort((left, right) =>
    right.share - left.share || right.confidence - left.confidence || left.label.localeCompare(right.label)
  );
  const top = sorted[0] ?? null;
  const explainedAmountShare = roundedRatio(candidates.reduce((sum, item) => sum + item.share, 0));
  const sourceConfidence = top?.confidence ?? 0;
  const attributionBasis = top
    ? ["amount share", "amount continuity", "time gap", "hop count", "source reliability"].filter((item) =>
        boundaryReason ? true : item !== "source reliability"
      )
    : [];
  return {
    explainedAmountShare,
    unknownAmountShare: roundedRatio(1 - explainedAmountShare),
    topSourceCandidate: top,
    topSourceShare: top?.share ?? 0,
    pathStrength: top?.pathStrength ?? "unknown",
    sourceConfidence,
    attributionBasis,
    boundaryReason
  };
}

export function buildWhereSourceAttributionSummary(input: { paths: WhereSourceAttributionPathInput[] }): SourceAttributionSummary {
  const candidates = input.paths.map(whereCandidate).filter((candidate) => candidate.share > 0);
  const boundaryReason = input.paths.find((path) => path.stoppedReason)?.stoppedReason ?? null;
  return buildSummary(candidates, boundaryReason);
}

export function buildIncomingSourceAttributionSummary(input: { paths: IncomingSourceAttributionPathInput[] }): SourceAttributionSummary {
  const candidates = input.paths.map(incomingCandidate).filter((candidate) => candidate.share > 0);
  const boundaryReason = input.paths.find((path) => path.stoppedReason)?.stoppedReason ?? null;
  return buildSummary(candidates, boundaryReason);
}
```

- [ ] **Step 4: Run source attribution tests**

Run:

```bash
npx vitest run --configLoader bundle tests/forensics/sourceAttributionSummary.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/sourceAttributionSummary.ts tests/forensics/sourceAttributionSummary.test.ts
git commit -m "feat: add source attribution summary"
```

---

### Task 2: Scoring Audit Row Extraction And Cohorts

**Files:**
- Create: `src/risk/scoringAudit.ts`
- Create: `tests/risk/scoringAudit.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/risk/scoringAudit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildScoringAuditRow, cohortCounts, type ScoringAuditCohort } from "../../src/risk/scoringAudit";
import type { ForensicCheckJob } from "../../src/storage/repositories";

function job(overrides: Partial<ForensicCheckJob> = {}): ForensicCheckJob {
  return {
    id: "job-1",
    kind: "where_is_money_check",
    subjectAddress: "TSubject111111111111111111111111111111",
    status: "completed",
    windowStart: new Date("2026-06-01T00:00:00.000Z"),
    windowEnd: new Date("2026-06-02T00:00:00.000Z"),
    priority: 100,
    chatId: null,
    messageId: null,
    requestedBy: null,
    progressJson: {},
    resultJson: {
      riskScore: 20,
      decision: "ACCEPTABLE",
      coverage: { partial: false, fetchedAddressCount: 10, notes: [] },
      assessment: { hardBadEvidence: [], reasons: [] },
      originPaths: []
    },
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-02T00:00:00.000Z"),
    startedAt: new Date("2026-06-01T00:00:01.000Z"),
    completedAt: new Date("2026-06-02T00:00:00.000Z"),
    ...overrides
  };
}

function expectCohort(row: ReturnType<typeof buildScoringAuditRow>, cohort: ScoringAuditCohort) {
  expect(row.cohorts).toContain(cohort);
}

describe("scoring audit rows", () => {
  it("flags high score under partial coverage", () => {
    const row = buildScoringAuditRow(job({
      resultJson: {
        riskScore: 72,
        decision: "DECLINE",
        missingChecks: ["provider timeout"],
        coverage: { partial: true, fetchedAddressCount: 5 },
        assessment: { hardBadEvidence: [], reasons: ["service boundary context"] }
      }
    }));

    expect(row.finalScore).toBe(72);
    expect(row.coverageStatus).toBe("partial");
    expect(row.evidenceClass).toBe("contextual");
    expectCohort(row, "high_score_partial_coverage");
    expectCohort(row, "decline_without_hard_evidence");
  });

  it("flags acceptable limited coverage without changing production decision", () => {
    const row = buildScoringAuditRow(job({
      resultJson: {
        riskScore: 18,
        decision: "ACCEPTABLE",
        coverage: { partial: true, fetchedAddressCount: 1 },
        assessment: { hardBadEvidence: [], reasons: [] }
      }
    }));

    expect(row.productionDecision).toBe("ACCEPTABLE");
    expect(row.auditDecision).toBe("INSUFFICIENT_COVERAGE");
    expectCohort(row, "low_score_incomplete_coverage");
    expectCohort(row, "acceptable_limited_coverage");
  });

  it("flags hard evidence cases", () => {
    const row = buildScoringAuditRow(job({
      resultJson: {
        riskScore: 95,
        decision: "DECLINE",
        proofLevel: "exact_scam_or_taint_proof",
        coverage: { partial: false, fetchedAddressCount: 7 },
        assessment: { hardBadEvidence: [{ kind: "scam_or_blacklist" }], reasons: ["exact blacklist"] }
      }
    }));

    expect(row.hardEvidenceObserved).toBe(true);
    expect(row.evidenceClass).toBe("hard");
    expectCohort(row, "hard_evidence_cases");
  });

  it("detects conflicting layer decisions", () => {
    const row = buildScoringAuditRow(job({
      resultJson: {
        riskScore: 30,
        decision: "ACCEPTABLE",
        fastWalletRisk: { score: 0, level: "LOW", reasons: [] },
        assessment: { hardBadEvidence: [], reasons: [] },
        unifiedRiskSummary: { finalDecision: "DECLINE", finalScore: 65 },
        coverage: { partial: false, fetchedAddressCount: 10 }
      }
    }));

    expectCohort(row, "conflicting_layers");
  });

  it("counts cohorts", () => {
    const rows = [
      buildScoringAuditRow(job({ id: "a", resultJson: { riskScore: 80, decision: "DECLINE", coverage: { partial: true }, assessment: { hardBadEvidence: [], reasons: ["context"] } } })),
      buildScoringAuditRow(job({ id: "b", resultJson: { riskScore: 10, decision: "ACCEPTABLE", coverage: { partial: true, fetchedAddressCount: 1 }, assessment: { hardBadEvidence: [], reasons: [] } } }))
    ];

    expect(cohortCounts(rows).high_score_partial_coverage).toBe(1);
    expect(cohortCounts(rows).acceptable_limited_coverage).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run --configLoader bundle tests/risk/scoringAudit.test.ts
```

Expected: fail because `src/risk/scoringAudit.ts` does not exist.

- [ ] **Step 3: Implement audit extraction**

Create `src/risk/scoringAudit.ts`:

```ts
import { buildRiskClaritySummary, type RiskClarityCoverageStatus, type RiskClarityEvidenceClass } from "./riskClarity";
import type { ForensicCheckJob } from "../storage/repositories";

export type ScoringAuditDecision =
  | "ACCEPTABLE"
  | "REVIEW"
  | "DECLINE"
  | "INSUFFICIENT_COVERAGE"
  | "MANUAL_REQUIRED";

export type ScoringAuditCohort =
  | "high_score_partial_coverage"
  | "low_score_incomplete_coverage"
  | "acceptable_limited_coverage"
  | "decline_without_hard_evidence"
  | "conflicting_layers"
  | "hard_evidence_cases"
  | "policy_floor_cases"
  | "dampener_cases";

export type ScoringAuditRow = {
  jobId: string;
  kind: ForensicCheckJob["kind"];
  subjectAddress: string;
  status: ForensicCheckJob["status"];
  finalScore: number | null;
  riskLevel: string | null;
  productionDecision: string | null;
  auditDecision: ScoringAuditDecision;
  coverageStatus: RiskClarityCoverageStatus;
  confidenceScore: number | null;
  evidenceClass: RiskClarityEvidenceClass;
  hardEvidenceObserved: boolean;
  activeAnchorCode: string | null;
  activeAnchorScore: number | null;
  dampener: number | null;
  policyVersion: string;
  missingChecks: string[];
  cohorts: ScoringAuditCohort[];
  limitations: string[];
};

export type ScoringAuditCohortCounts = Record<ScoringAuditCohort, number>;

const allCohorts: readonly ScoringAuditCohort[] = [
  "high_score_partial_coverage",
  "low_score_incomplete_coverage",
  "acceptable_limited_coverage",
  "decline_without_hard_evidence",
  "conflicting_layers",
  "hard_evidence_cases",
  "policy_floor_cases",
  "dampener_cases"
];

function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return arrayField(value).filter((item): item is string => typeof item === "string");
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finalScore(result: Record<string, unknown>): number | null {
  const unified = objectField(result.unifiedRiskSummary);
  return numberField(unified.finalScore) ?? numberField(result.finalScore) ?? numberField(result.riskScore);
}

function productionDecision(result: Record<string, unknown>): string | null {
  const unified = objectField(result.unifiedRiskSummary);
  return stringField(unified.finalDecision) ?? stringField(result.finalDecision) ?? stringField(result.decision);
}

function missingChecks(result: Record<string, unknown>): string[] {
  const coverage = objectField(result.coverage);
  const coverageDebug = objectField(result.coverageDebug);
  return [
    ...stringArray(result.missingChecks),
    ...stringArray(coverage.notes),
    ...stringArray(coverageDebug.missingChecks)
  ];
}

function fetchedAddressCount(result: Record<string, unknown>): number | null {
  const coverage = objectField(result.coverage);
  return numberField(coverage.fetchedAddressCount);
}

function coveragePartial(job: ForensicCheckJob, result: Record<string, unknown>): boolean {
  const coverage = objectField(result.coverage);
  return job.status === "partial" || coverage.partial === true || missingChecks(result).length > 0;
}

function hardEvidence(result: Record<string, unknown>): boolean {
  const assessment = objectField(result.assessment);
  if (arrayField(assessment.hardBadEvidence).length > 0) return true;
  const proofLevel = stringField(result.proofLevel)?.toLowerCase() ?? "";
  if (proofLevel.includes("exact") || proofLevel.includes("blacklist") || proofLevel.includes("hard")) return true;
  const unified = objectField(result.unifiedRiskSummary);
  return numberField(unified.hardEvidenceFloor) !== null && (numberField(unified.hardEvidenceFloor) ?? 0) >= 85;
}

function evidenceHints(result: Record<string, unknown>): string[] {
  const assessment = objectField(result.assessment);
  return [
    ...stringArray(result.reasons),
    ...stringArray(assessment.reasons),
    ...missingChecks(result)
  ];
}

function activeAnchor(result: Record<string, unknown>): { code: string | null; score: number | null } {
  const unified = objectField(result.unifiedRiskSummary);
  const breakdown = objectField(unified.scoreBreakdown ?? result.scoreBreakdown);
  const anchor = objectField(breakdown.activeAnchor);
  return {
    code: stringField(anchor.code),
    score: numberField(anchor.score)
  };
}

function dampener(result: Record<string, unknown>): number | null {
  const unified = objectField(result.unifiedRiskSummary);
  const breakdown = objectField(unified.scoreBreakdown ?? result.scoreBreakdown);
  return numberField(unified.dampener) ?? numberField(breakdown.dampener);
}

function hasPolicyFloor(result: Record<string, unknown>, anchorCode: string | null): boolean {
  if (anchorCode?.includes("policy")) return true;
  const unified = objectField(result.unifiedRiskSummary);
  const floors = objectField(objectField(unified.scoreBreakdown).floors);
  return (numberField(floors.policy) ?? numberField(unified.policyFloor) ?? 0) > 0;
}

function hasLayerConflict(result: Record<string, unknown>, decision: string | null): boolean {
  const unified = objectField(result.unifiedRiskSummary);
  const unifiedDecision = stringField(unified.finalDecision);
  return !!unifiedDecision && !!decision && unifiedDecision !== decision;
}

function auditDecision(input: {
  score: number | null;
  productionDecision: string | null;
  coverageStatus: RiskClarityCoverageStatus;
  hardEvidenceObserved: boolean;
}): ScoringAuditDecision {
  if (input.hardEvidenceObserved) return "DECLINE";
  if (input.coverageStatus === "insufficient" || (input.score !== null && input.score < 30 && input.coverageStatus === "limited")) {
    return "INSUFFICIENT_COVERAGE";
  }
  if (input.productionDecision === "DECLINE") return "DECLINE";
  if (input.productionDecision === "REVIEW") return "REVIEW";
  if (input.productionDecision === "ACCEPTABLE") return "ACCEPTABLE";
  if (input.score === null) return "MANUAL_REQUIRED";
  if (input.score >= 60) return "DECLINE";
  if (input.score >= 30) return "REVIEW";
  return "ACCEPTABLE";
}

function cohorts(input: {
  score: number | null;
  productionDecision: string | null;
  auditDecision: ScoringAuditDecision;
  coverageStatus: RiskClarityCoverageStatus;
  evidenceClass: RiskClarityEvidenceClass;
  hardEvidenceObserved: boolean;
  activeAnchorCode: string | null;
  dampener: number | null;
  result: Record<string, unknown>;
}): ScoringAuditCohort[] {
  const result = new Set<ScoringAuditCohort>();
  const incomplete = input.coverageStatus !== "complete";
  if ((input.score ?? 0) >= 60 && incomplete) result.add("high_score_partial_coverage");
  if ((input.score ?? 100) < 30 && incomplete) result.add("low_score_incomplete_coverage");
  if (input.productionDecision === "ACCEPTABLE" && (input.coverageStatus === "limited" || input.coverageStatus === "insufficient")) {
    result.add("acceptable_limited_coverage");
  }
  if (input.productionDecision === "DECLINE" && !input.hardEvidenceObserved) result.add("decline_without_hard_evidence");
  if (hasLayerConflict(input.result, input.productionDecision)) result.add("conflicting_layers");
  if (input.hardEvidenceObserved) result.add("hard_evidence_cases");
  if (hasPolicyFloor(input.result, input.activeAnchorCode)) result.add("policy_floor_cases");
  if ((input.dampener ?? 0) >= 10) result.add("dampener_cases");
  return [...result];
}

export function buildScoringAuditRow(job: ForensicCheckJob): ScoringAuditRow {
  const result = objectField(job.resultJson);
  const score = finalScore(result);
  const prodDecision = productionDecision(result);
  const clarity = buildRiskClaritySummary({
    kind: job.kind,
    executionStatus: job.status === "cancelled" ? "failed" : job.status,
    finalRiskScore: score,
    explicitDecision: prodDecision === "ACCEPTABLE" || prodDecision === "REVIEW" || prodDecision === "DECLINE" ? prodDecision : null,
    missingChecks: missingChecks(result),
    coveragePartial: coveragePartial(job, result),
    fetchedAddressCount: fetchedAddressCount(result),
    hardEvidenceObserved: hardEvidence(result),
    evidenceHints: evidenceHints(result)
  });
  const anchor = activeAnchor(result);
  const rowAuditDecision = auditDecision({
    score,
    productionDecision: prodDecision,
    coverageStatus: clarity.coverageStatus,
    hardEvidenceObserved: clarity.hardEvidenceObserved
  });
  const row: Omit<ScoringAuditRow, "cohorts"> = {
    jobId: job.id,
    kind: job.kind,
    subjectAddress: job.subjectAddress,
    status: job.status,
    finalScore: score,
    riskLevel: clarity.riskLevel,
    productionDecision: prodDecision,
    auditDecision: rowAuditDecision,
    coverageStatus: clarity.coverageStatus,
    confidenceScore: clarity.confidenceScore,
    evidenceClass: clarity.evidenceClass,
    hardEvidenceObserved: clarity.hardEvidenceObserved,
    activeAnchorCode: anchor.code,
    activeAnchorScore: anchor.score,
    dampener: dampener(result),
    policyVersion: clarity.policyVersion,
    missingChecks: missingChecks(result),
    limitations: clarity.limitations
  };
  return {
    ...row,
    cohorts: cohorts({
      score,
      productionDecision: prodDecision,
      auditDecision: rowAuditDecision,
      coverageStatus: clarity.coverageStatus,
      evidenceClass: clarity.evidenceClass,
      hardEvidenceObserved: clarity.hardEvidenceObserved,
      activeAnchorCode: anchor.code,
      dampener: row.dampener,
      result
    })
  };
}

export function cohortCounts(rows: readonly ScoringAuditRow[]): ScoringAuditCohortCounts {
  const counts = Object.fromEntries(allCohorts.map((cohort) => [cohort, 0])) as ScoringAuditCohortCounts;
  for (const row of rows) {
    for (const cohort of row.cohorts) {
      counts[cohort] += 1;
    }
  }
  return counts;
}
```

- [ ] **Step 4: Run audit extraction tests**

Run:

```bash
npx vitest run --configLoader bundle tests/risk/scoringAudit.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/risk/scoringAudit.ts tests/risk/scoringAudit.test.ts
git commit -m "feat: extract scoring audit rows"
```

---

### Task 3: Audit Report Formatting

**Files:**
- Create: `src/forensics/scoringAuditReport.ts`
- Create: `tests/forensics/scoringAuditReport.test.ts`

- [ ] **Step 1: Write failing formatter tests**

Create `tests/forensics/scoringAuditReport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildScoringAuditReport, formatScoringAuditMarkdown } from "../../src/forensics/scoringAuditReport";
import type { ScoringAuditRow } from "../../src/risk/scoringAudit";

const row: ScoringAuditRow = {
  jobId: "job-1",
  kind: "where_is_money_check",
  subjectAddress: "TSubject111111111111111111111111111111",
  status: "completed",
  finalScore: 72,
  riskLevel: "HIGH",
  productionDecision: "DECLINE",
  auditDecision: "DECLINE",
  coverageStatus: "partial",
  confidenceScore: 36,
  evidenceClass: "contextual",
  hardEvidenceObserved: false,
  activeAnchorCode: "where_source_policy_floor",
  activeAnchorScore: 70,
  dampener: 0,
  policyVersion: "where-is-money-v1",
  missingChecks: ["provider timeout"],
  cohorts: ["high_score_partial_coverage", "decline_without_hard_evidence", "policy_floor_cases"],
  limitations: ["provider timeout"]
};

describe("scoring audit report", () => {
  it("builds aggregate counts and cohort groups", () => {
    const report = buildScoringAuditReport([row]);

    expect(report.totalJobs).toBe(1);
    expect(report.cohorts.high_score_partial_coverage).toBe(1);
    expect(report.rowsByCohort.decline_without_hard_evidence[0]?.jobId).toBe("job-1");
  });

  it("formats markdown with current score and audit cohorts", () => {
    const markdown = formatScoringAuditMarkdown(buildScoringAuditReport([row]));

    expect(markdown).toContain("# Scoring Audit Report");
    expect(markdown).toContain("Total jobs: 1");
    expect(markdown).toContain("high_score_partial_coverage");
    expect(markdown).toContain("job-1");
    expect(markdown).toContain("where_source_policy_floor");
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run --configLoader bundle tests/forensics/scoringAuditReport.test.ts
```

Expected: fail because formatter module does not exist.

- [ ] **Step 3: Implement report formatter**

Create `src/forensics/scoringAuditReport.ts`:

```ts
import { cohortCounts, type ScoringAuditCohort, type ScoringAuditCohortCounts, type ScoringAuditRow } from "../risk/scoringAudit";

export type ScoringAuditReport = {
  generatedAt: string;
  totalJobs: number;
  cohorts: ScoringAuditCohortCounts;
  rows: ScoringAuditRow[];
  rowsByCohort: Record<ScoringAuditCohort, ScoringAuditRow[]>;
};

const cohortOrder: ScoringAuditCohort[] = [
  "high_score_partial_coverage",
  "low_score_incomplete_coverage",
  "acceptable_limited_coverage",
  "decline_without_hard_evidence",
  "conflicting_layers",
  "hard_evidence_cases",
  "policy_floor_cases",
  "dampener_cases"
];

export function buildScoringAuditReport(rows: ScoringAuditRow[], now = new Date("2026-06-26T00:00:00.000Z")): ScoringAuditReport {
  const rowsByCohort = Object.fromEntries(cohortOrder.map((cohort) => [
    cohort,
    rows.filter((row) => row.cohorts.includes(cohort))
  ])) as Record<ScoringAuditCohort, ScoringAuditRow[]>;
  return {
    generatedAt: now.toISOString(),
    totalJobs: rows.length,
    cohorts: cohortCounts(rows),
    rows,
    rowsByCohort
  };
}

function value(value: unknown): string {
  if (value === null || value === undefined || value === "") return "n/a";
  return String(value);
}

function rowLine(row: ScoringAuditRow): string {
  return [
    row.jobId,
    row.kind,
    row.subjectAddress,
    value(row.finalScore),
    value(row.productionDecision),
    row.auditDecision,
    row.coverageStatus,
    row.evidenceClass,
    value(row.activeAnchorCode),
    row.missingChecks.join("; ") || "none"
  ].join(" | ");
}

export function formatScoringAuditMarkdown(report: ScoringAuditReport): string {
  const lines = [
    "# Scoring Audit Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Total jobs: ${report.totalJobs}`,
    "",
    "## Cohorts",
    "",
    "| Cohort | Count |",
    "|---|---:|",
    ...cohortOrder.map((cohort) => `| ${cohort} | ${report.cohorts[cohort]} |`),
    "",
    "## Flagged Rows",
    "",
    "| Job | Kind | Subject | Score | Production decision | Audit decision | Coverage | Evidence | Anchor | Missing checks |",
    "|---|---|---|---:|---|---|---|---|---|---|"
  ];

  const flagged = report.rows.filter((row) => row.cohorts.length > 0);
  lines.push(...(flagged.length > 0 ? flagged.map(rowLine) : ["| none | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |"]));

  for (const cohort of cohortOrder) {
    const rows = report.rowsByCohort[cohort];
    if (rows.length === 0) continue;
    lines.push("", `## ${cohort}`, "");
    lines.push(...rows.map((row) => `- ${row.jobId}: score ${value(row.finalScore)}, production ${value(row.productionDecision)}, audit ${row.auditDecision}, coverage ${row.coverageStatus}, evidence ${row.evidenceClass}`));
  }

  return `${lines.join("\n")}\n`;
}
```

- [ ] **Step 4: Run formatter tests**

Run:

```bash
npx vitest run --configLoader bundle tests/forensics/scoringAuditReport.test.ts tests/risk/scoringAudit.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/scoringAuditReport.ts tests/forensics/scoringAuditReport.test.ts
git commit -m "feat: format scoring audit reports"
```

---

### Task 4: Scoring Audit CLI

**Files:**
- Create: `src/forensics/scoringAuditCliArgs.ts`
- Create: `tests/forensics/scoringAuditCliArgs.test.ts`
- Create: `scripts/forensicScoringAudit.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing CLI parser tests**

Create `tests/forensics/scoringAuditCliArgs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseScoringAuditCliArgs, SCORING_AUDIT_USAGE } from "../../src/forensics/scoringAuditCliArgs";

describe("scoring audit CLI args", () => {
  it("parses all jobs mode with defaults", () => {
    expect(parseScoringAuditCliArgs(["--all"])).toEqual({
      mode: "all",
      jobId: null,
      address: null,
      limit: 50,
      outDir: "artifacts/scoring-audit",
      format: "both"
    });
  });

  it("parses a single job", () => {
    expect(parseScoringAuditCliArgs(["--job", "job-1", "--format", "json"])).toMatchObject({
      mode: "job",
      jobId: "job-1",
      format: "json"
    });
  });

  it("parses latest address mode", () => {
    expect(parseScoringAuditCliArgs(["--address", "TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC", "--latest", "--limit", "10"])).toMatchObject({
      mode: "latest",
      address: "TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC",
      limit: 10
    });
  });

  it("rejects mixed modes", () => {
    expect(() => parseScoringAuditCliArgs(["--all", "--job", "job-1"])).toThrow("Use exactly one");
  });

  it("rejects invalid format", () => {
    expect(() => parseScoringAuditCliArgs(["--all", "--format", "pdf"])).toThrow(SCORING_AUDIT_USAGE);
  });
});
```

- [ ] **Step 2: Run parser tests and verify failure**

Run:

```bash
npx vitest run --configLoader bundle tests/forensics/scoringAuditCliArgs.test.ts
```

Expected: fail because parser module does not exist.

- [ ] **Step 3: Implement CLI parser**

Create `src/forensics/scoringAuditCliArgs.ts`:

```ts
import { classifyInput } from "../tron/address";

export type ScoringAuditCliFormat = "json" | "markdown" | "both";

export type ParsedScoringAuditCliArgs =
  | { mode: "all"; jobId: null; address: null; limit: number; outDir: string; format: ScoringAuditCliFormat }
  | { mode: "job"; jobId: string; address: null; limit: number; outDir: string; format: ScoringAuditCliFormat }
  | { mode: "latest"; jobId: null; address: string; limit: number; outDir: string; format: ScoringAuditCliFormat };

export const SCORING_AUDIT_DEFAULT_OUT_DIR = "artifacts/scoring-audit";

export const SCORING_AUDIT_USAGE = [
  "Usage:",
  "  npm run forensic:scoring-audit -- --all [--limit 50] [--format json|markdown|both]",
  "  npm run forensic:scoring-audit -- --job <jobId> [--format json|markdown|both]",
  "  npm run forensic:scoring-audit -- --address <TRON-address> --latest [--limit 50]"
].join("\n");

function normalizeArgs(argv: readonly string[]): string[] {
  const separatorIndex = argv.indexOf("--");
  return separatorIndex === -1 ? [...argv] : argv.slice(separatorIndex + 1);
}

function argValue(args: readonly string[], name: string): string | undefined {
  const equalsPrefix = `${name}=`;
  const equalsValue = args.find((arg) => arg.startsWith(equalsPrefix));
  if (equalsValue) return equalsValue.slice(equalsPrefix.length);
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(name);
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error(`--limit must be an integer from 1 to 500.\n${SCORING_AUDIT_USAGE}`);
  }
  return parsed;
}

function parseFormat(value: string | undefined): ScoringAuditCliFormat {
  if (value === undefined) return "both";
  if (value === "json" || value === "markdown" || value === "both") return value;
  throw new Error(SCORING_AUDIT_USAGE);
}

export function parseScoringAuditCliArgs(argv: readonly string[]): ParsedScoringAuditCliArgs {
  const args = normalizeArgs(argv);
  const all = hasFlag(args, "--all");
  const jobId = argValue(args, "--job");
  const address = argValue(args, "--address");
  const latest = hasFlag(args, "--latest");
  const selectedModes = [all, !!jobId, !!address].filter(Boolean).length;
  if (selectedModes !== 1) {
    throw new Error(`Use exactly one of --all, --job, or --address --latest.\n${SCORING_AUDIT_USAGE}`);
  }
  const base = {
    limit: parseLimit(argValue(args, "--limit")),
    outDir: argValue(args, "--out-dir") ?? SCORING_AUDIT_DEFAULT_OUT_DIR,
    format: parseFormat(argValue(args, "--format"))
  };
  if (all) return { mode: "all", jobId: null, address: null, ...base };
  if (jobId) return { mode: "job", jobId, address: null, ...base };
  if (!address || !latest) {
    throw new Error(`--address requires --latest.\n${SCORING_AUDIT_USAGE}`);
  }
  const classified = classifyInput(address);
  if (classified.kind !== "tron_address") {
    throw new Error(`--address must be a valid TRON address.\n${SCORING_AUDIT_USAGE}`);
  }
  return { mode: "latest", jobId: null, address: classified.value, ...base };
}
```

- [ ] **Step 4: Create the read-only CLI script**

Create `scripts/forensicScoringAudit.ts`:

```ts
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { buildScoringAuditReport, formatScoringAuditMarkdown } from "../src/forensics/scoringAuditReport";
import { parseScoringAuditCliArgs } from "../src/forensics/scoringAuditCliArgs";
import { buildScoringAuditRow } from "../src/risk/scoringAudit";
import { closeDb, createDb } from "../src/storage/db";
import {
  getForensicCheckJob,
  listAdminForensicCheckJobs,
  type ForensicCheckJob
} from "../src/storage/repositories";

function databaseUrlFromEnvironment(): string {
  try {
    return loadConfig().databaseUrl;
  } catch (error) {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    throw error;
  }
}

async function resolveJobs(args: ReturnType<typeof parseScoringAuditCliArgs>, db: ReturnType<typeof createDb>): Promise<ForensicCheckJob[]> {
  if (args.mode === "job") {
    const job = await getForensicCheckJob(db, args.jobId);
    if (!job) throw new Error(`Forensic job not found: ${args.jobId}`);
    return [job];
  }
  if (args.mode === "latest") {
    const jobs = await listAdminForensicCheckJobs(db, { subjectAddress: args.address, limit: args.limit });
    if (jobs.length === 0) throw new Error(`No forensic job found for address: ${args.address}`);
    return jobs;
  }
  return listAdminForensicCheckJobs(db, { limit: args.limit });
}

try {
  const args = parseScoringAuditCliArgs(process.argv.slice(2));
  const db = createDb(databaseUrlFromEnvironment());
  try {
    const jobs = await resolveJobs(args, db);
    const report = buildScoringAuditReport(jobs.map(buildScoringAuditRow), new Date());
    await mkdir(args.outDir, { recursive: true });
    const baseName = `scoring-audit-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    if (args.format === "json" || args.format === "both") {
      await writeFile(join(args.outDir, `${baseName}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    if (args.format === "markdown" || args.format === "both") {
      await writeFile(join(args.outDir, `${baseName}.md`), formatScoringAuditMarkdown(report), "utf8");
    }
    console.log(`Scoring audit jobs: ${report.totalJobs}`);
    console.log(`Flagged high partial: ${report.cohorts.high_score_partial_coverage}`);
    console.log(`Flagged acceptable limited: ${report.cohorts.acceptable_limited_coverage}`);
    console.log(`Output directory: ${args.outDir}`);
  } finally {
    await closeDb(db);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
```

- [ ] **Step 5: Add the package script**

Modify `package.json` scripts:

```json
"forensic:scoring-audit": "node --import tsx scripts/forensicScoringAudit.ts"
```

Place it near the other `forensic:*` scripts.

- [ ] **Step 6: Run parser and type checks**

Run:

```bash
npx vitest run --configLoader bundle tests/forensics/scoringAuditCliArgs.test.ts tests/forensics/scoringAuditReport.test.ts tests/risk/scoringAudit.test.ts
npm run typecheck
```

Expected: tests pass and typecheck passes.

- [ ] **Step 7: Commit**

```bash
git add src/forensics/scoringAuditCliArgs.ts tests/forensics/scoringAuditCliArgs.test.ts scripts/forensicScoringAudit.ts package.json
git commit -m "feat: add scoring audit cli"
```

---

### Task 5: Shadow Scoring Candidate

**Files:**
- Create: `src/risk/shadowScoring.ts`
- Create: `tests/risk/shadowScoring.test.ts`

- [ ] **Step 1: Write failing shadow tests**

Create `tests/risk/shadowScoring.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compareShadowScoring } from "../../src/risk/shadowScoring";
import type { ScoringAuditRow } from "../../src/risk/scoringAudit";

function row(overrides: Partial<ScoringAuditRow> = {}): ScoringAuditRow {
  return {
    jobId: "job-1",
    kind: "where_is_money_check",
    subjectAddress: "TSubject111111111111111111111111111111",
    status: "completed",
    finalScore: 20,
    riskLevel: "LOW",
    productionDecision: "ACCEPTABLE",
    auditDecision: "ACCEPTABLE",
    coverageStatus: "complete",
    confidenceScore: 100,
    evidenceClass: "none",
    hardEvidenceObserved: false,
    activeAnchorCode: null,
    activeAnchorScore: null,
    dampener: null,
    policyVersion: "where-is-money-v1",
    missingChecks: [],
    cohorts: [],
    limitations: [],
    ...overrides
  };
}

describe("shadow scoring", () => {
  it("turns low-score limited coverage into insufficient coverage candidate", () => {
    const comparison = compareShadowScoring(row({
      coverageStatus: "limited",
      finalScore: 18,
      productionDecision: "ACCEPTABLE"
    }));

    expect(comparison.currentDecision).toBe("ACCEPTABLE");
    expect(comparison.candidateDecision).toBe("INSUFFICIENT_COVERAGE");
    expect(comparison.deltaReasons).toContain("Low score has limited coverage; candidate policy avoids calling it acceptable.");
  });

  it("keeps hard evidence as decline", () => {
    const comparison = compareShadowScoring(row({
      finalScore: 95,
      productionDecision: "DECLINE",
      hardEvidenceObserved: true,
      evidenceClass: "hard"
    }));

    expect(comparison.candidateDecision).toBe("DECLINE");
    expect(comparison.candidateScore).toBe(95);
  });

  it("moves contextual high partial coverage to review in candidate policy", () => {
    const comparison = compareShadowScoring(row({
      finalScore: 72,
      productionDecision: "DECLINE",
      evidenceClass: "contextual",
      coverageStatus: "partial",
      hardEvidenceObserved: false
    }));

    expect(comparison.candidateDecision).toBe("REVIEW");
    expect(comparison.delta).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run --configLoader bundle tests/risk/shadowScoring.test.ts
```

Expected: fail because shadow module does not exist.

- [ ] **Step 3: Implement shadow comparison**

Create `src/risk/shadowScoring.ts`:

```ts
import type { ScoringAuditDecision, ScoringAuditRow } from "./scoringAudit";

export type ShadowScoringComparison = {
  currentScore: number | null;
  currentDecision: string | null;
  candidateScore: number | null;
  candidateDecision: ScoringAuditDecision;
  delta: number | null;
  deltaReasons: string[];
  candidatePolicyVersion: "scoring-calibration-shadow-v1";
};

function clampScore(score: number | null): number | null {
  if (score === null || !Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function candidateForRow(row: ScoringAuditRow): { score: number | null; decision: ScoringAuditDecision; reasons: string[] } {
  const reasons: string[] = [];
  let score = clampScore(row.finalScore);
  let decision: ScoringAuditDecision = row.auditDecision;

  if (row.hardEvidenceObserved) {
    score = Math.max(score ?? 0, 85);
    decision = "DECLINE";
    reasons.push("Hard evidence keeps decline floor active.");
    return { score, decision, reasons };
  }

  if ((score ?? 0) < 30 && (row.coverageStatus === "limited" || row.coverageStatus === "insufficient")) {
    decision = "INSUFFICIENT_COVERAGE";
    reasons.push("Low score has limited coverage; candidate policy avoids calling it acceptable.");
    return { score, decision, reasons };
  }

  if ((score ?? 0) >= 60 && row.evidenceClass === "contextual" && row.coverageStatus !== "complete") {
    score = Math.min(score ?? 0, 59);
    decision = "REVIEW";
    reasons.push("High contextual risk with incomplete coverage is review-first in candidate policy.");
    return { score, decision, reasons };
  }

  reasons.push("Candidate policy keeps current audit decision.");
  return { score, decision, reasons };
}

export function compareShadowScoring(row: ScoringAuditRow): ShadowScoringComparison {
  const candidate = candidateForRow(row);
  const currentScore = clampScore(row.finalScore);
  return {
    currentScore,
    currentDecision: row.productionDecision,
    candidateScore: candidate.score,
    candidateDecision: candidate.decision,
    delta: currentScore === null || candidate.score === null ? null : candidate.score - currentScore,
    deltaReasons: candidate.reasons,
    candidatePolicyVersion: "scoring-calibration-shadow-v1"
  };
}
```

- [ ] **Step 4: Run shadow tests**

Run:

```bash
npx vitest run --configLoader bundle tests/risk/shadowScoring.test.ts tests/risk/scoringAudit.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/risk/shadowScoring.ts tests/risk/shadowScoring.test.ts
git commit -m "feat: add shadow scoring comparison"
```

---

### Task 6: Include Shadow Scoring In Reports

**Files:**
- Modify: `src/forensics/scoringAuditReport.ts`
- Modify: `tests/forensics/scoringAuditReport.test.ts`

- [ ] **Step 1: Extend report tests**

Modify `tests/forensics/scoringAuditReport.test.ts` and add:

```ts
it("includes candidate shadow scoring in report rows", () => {
  const report = buildScoringAuditReport([{
    ...row,
    finalScore: 18,
    productionDecision: "ACCEPTABLE",
    auditDecision: "INSUFFICIENT_COVERAGE",
    coverageStatus: "limited"
  }]);

  expect(report.shadowComparisons[0]).toMatchObject({
    currentDecision: "ACCEPTABLE",
    candidateDecision: "INSUFFICIENT_COVERAGE",
    candidatePolicyVersion: "scoring-calibration-shadow-v1"
  });
  expect(formatScoringAuditMarkdown(report)).toContain("Shadow scoring");
});
```

- [ ] **Step 2: Run formatter tests and verify failure**

Run:

```bash
npx vitest run --configLoader bundle tests/forensics/scoringAuditReport.test.ts
```

Expected: fail because report does not expose `shadowComparisons`.

- [ ] **Step 3: Add shadow comparisons to report**

Modify `src/forensics/scoringAuditReport.ts`:

```ts
import { compareShadowScoring, type ShadowScoringComparison } from "../risk/shadowScoring";
```

Extend `ScoringAuditReport`:

```ts
shadowComparisons: ShadowScoringComparison[];
```

In `buildScoringAuditReport`, add:

```ts
shadowComparisons: rows.map(compareShadowScoring),
```

In `formatScoringAuditMarkdown`, add after the cohort table:

```ts
lines.push(
  "",
  "## Shadow scoring",
  "",
  "| Job | Current | Candidate | Delta | Reason |",
  "|---|---|---|---:|---|"
);
lines.push(...report.shadowComparisons.map((item, index) => {
  const row = report.rows[index];
  return `| ${row?.jobId ?? "unknown"} | ${value(item.currentDecision)} ${value(item.currentScore)} | ${item.candidateDecision} ${value(item.candidateScore)} | ${value(item.delta)} | ${item.deltaReasons.join("; ")} |`;
}));
```

- [ ] **Step 4: Run formatter and shadow tests**

Run:

```bash
npx vitest run --configLoader bundle tests/forensics/scoringAuditReport.test.ts tests/risk/shadowScoring.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/scoringAuditReport.ts tests/forensics/scoringAuditReport.test.ts
git commit -m "feat: include shadow scoring in audit reports"
```

---

### Task 7: Admin Scoring Audit API

**Files:**
- Modify: `src/admin/adminServer.ts`
- Modify: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Write failing admin API tests**

Add to `tests/admin/adminServer.test.ts`:

```ts
it("returns scoring audit report for authorized admins", async () => {
  const server = await start();

  const response = await fetch(`${server.url}/admin/api/scoring-audit?limit=10`, {
    headers: { authorization: "Bearer secret-token" }
  });

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.report.totalJobs).toBe(1);
  expect(body.report.rows[0]).toMatchObject({
    jobId: "job-1",
    kind: "where_is_money_check"
  });
  expect(body.report.shadowComparisons[0]).toHaveProperty("candidatePolicyVersion", "scoring-calibration-shadow-v1");
});

it("rejects scoring audit API without bearer token", async () => {
  const server = await start();

  const response = await fetch(`${server.url}/admin/api/scoring-audit`);

  expect(response.status).toBe(401);
});
```

- [ ] **Step 2: Run admin server tests and verify failure**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/adminServer.test.ts
```

Expected: first new test fails with `404`.

- [ ] **Step 3: Implement admin API endpoint**

Modify `src/admin/adminServer.ts` imports:

```ts
import { buildScoringAuditReport } from "../forensics/scoringAuditReport";
import { buildScoringAuditRow } from "../risk/scoringAudit";
```

Inside `handleApiRequest`, after `/admin/api/forensic-jobs` handling and before `forensicJobApiMatch`, add:

```ts
  if (url.pathname === "/admin/api/scoring-audit") {
    const input = parseListJobsInput(url);
    if (!input.ok) {
      writeJson(response, 400, { error: input.message });
      return;
    }
    const jobs = await deps.listJobs(input.value);
    writeJson(response, 200, { report: buildScoringAuditReport(jobs.map(buildScoringAuditRow), new Date()) });
    return;
  }
```

- [ ] **Step 4: Run admin server tests**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/adminServer.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/admin/adminServer.ts tests/admin/adminServer.test.ts
git commit -m "feat: expose scoring audit admin api"
```

---

### Task 8: Admin Console Scoring Audit Panel

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add failing shell assertions**

In `tests/admin/adminConsole.test.ts`, add assertions to the existing shell test:

```ts
expect(html).toContain("Scoring audit");
expect(html).toContain("/admin/api/scoring-audit");
expect(html).toContain("High score + partial coverage");
expect(html).toContain("Shadow scoring");
expect(html).toContain("INSUFFICIENT_COVERAGE");
expect(html).toContain("function renderScoringAudit");
```

- [ ] **Step 2: Run admin console test and verify failure**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts
```

Expected: fail because the shell does not contain audit panel strings.

- [ ] **Step 3: Add minimal audit state and rendering**

Modify `src/admin/adminConsole.ts` client script.

Add to `state`:

```js
scoringAudit: null,
scoringAuditOpen: false,
```

Add a button near existing Jobs/Analytics controls:

```html
<button id="toggleScoringAudit" type="button">Scoring audit</button>
```

Add a panel shell near other overlay/rail panels:

```html
<section id="scoringAuditPanel" class="overlay-panel hidden" data-scoring-audit-panel></section>
```

Add helpers:

```js
async function loadScoringAudit() {
  const limit = el("limit")?.value || "50";
  const body = await api("/admin/api/scoring-audit?limit=" + encodeURIComponent(limit));
  state.scoringAudit = body.report;
  renderScoringAudit();
}

function scoringAuditCohortLine(label, value) {
  return '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(value ?? 0)) + '</strong></div>';
}

function renderScoringAudit() {
  const root = el("scoringAuditPanel");
  if (!root) return;
  if (!state.scoringAuditOpen) {
    root.classList.add("hidden");
    root.innerHTML = "";
    return;
  }
  root.classList.remove("hidden");
  const report = state.scoringAudit;
  if (!report) {
    root.innerHTML = '<div class="panel-header"><strong>Scoring audit</strong><button id="closeScoringAudit" type="button">x</button></div><div class="empty">Load scoring audit to inspect saved jobs.</div>';
  } else {
    const cohorts = report.cohorts || {};
    const rows = Array.isArray(report.rows) ? report.rows.slice(0, 10) : [];
    root.innerHTML =
      '<div class="panel-header"><strong>Scoring audit</strong><button id="closeScoringAudit" type="button">x</button></div>' +
      '<div class="metric-grid">' +
      scoringAuditCohortLine("Total jobs", report.totalJobs) +
      scoringAuditCohortLine("High score + partial coverage", cohorts.high_score_partial_coverage) +
      scoringAuditCohortLine("Acceptable limited coverage", cohorts.acceptable_limited_coverage) +
      scoringAuditCohortLine("Decline without hard evidence", cohorts.decline_without_hard_evidence) +
      '</div>' +
      '<h3>Shadow scoring</h3>' +
      '<div class="hint">INSUFFICIENT_COVERAGE is admin-only in this phase.</div>' +
      '<div class="list">' + rows.map((row) =>
        '<div class="job-card"><strong>' + escapeHtml(short(row.subjectAddress || row.jobId)) + '</strong>' +
        '<span>' + escapeHtml(row.kind || "unknown") + '</span>' +
        '<span>score ' + escapeHtml(String(row.finalScore ?? "n/a")) + ' · ' + escapeHtml(row.productionDecision || "n/a") + ' → ' + escapeHtml(row.auditDecision || "n/a") + '</span></div>'
      ).join("") + '</div>';
  }
  const close = el("closeScoringAudit");
  if (close) close.addEventListener("click", () => {
    state.scoringAuditOpen = false;
    renderScoringAudit();
  });
}
```

Register event listener near other listeners:

```js
el("toggleScoringAudit").addEventListener("click", async () => {
  state.scoringAuditOpen = !state.scoringAuditOpen;
  if (state.scoringAuditOpen && !state.scoringAudit) await loadScoringAudit();
  renderScoringAudit();
});
```

- [ ] **Step 4: Run admin console tests**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: show scoring audit in admin console"
```

---

### Task 9: Documentation And Verification

**Files:**
- Modify: `docs/project-walkthrough/04-unified-wallet-risk-scoring-v2.md`
- Modify: `docs/project-walkthrough/16-qa-and-release-checks.md`

- [ ] **Step 1: Update scoring docs**

Append to `docs/project-walkthrough/04-unified-wallet-risk-scoring-v2.md`:

```md
## Calibration-First Audit Layer

The scoring audit layer does not replace the production score.

It reads saved forensic jobs and groups cases where the current decision deserves review:

- high score with partial coverage;
- low score with incomplete coverage;
- acceptable result with limited coverage;
- decline without hard evidence;
- conflicting layer decisions;
- hard-evidence floors;
- policy floors;
- dampener-heavy outcomes.

The shadow scorer is admin-only. It compares a candidate calibration policy against the current production score so thresholds can be reviewed with evidence before production behavior changes.
```

Append to `docs/project-walkthrough/16-qa-and-release-checks.md`:

```md
## Scoring Calibration Checks

Before changing scoring thresholds or floors:

1. run `npm run forensic:scoring-audit -- --all --limit 100`;
2. inspect high-score partial coverage rows;
3. inspect acceptable limited coverage rows;
4. review shadow scoring deltas;
5. add fixture tests for any policy change.

Production Telegram output should still show one final score and one decision.
```

- [ ] **Step 2: Run targeted tests**

Run:

```bash
npx vitest run --configLoader bundle tests/forensics/sourceAttributionSummary.test.ts tests/risk/scoringAudit.test.ts tests/risk/shadowScoring.test.ts tests/forensics/scoringAuditReport.test.ts tests/forensics/scoringAuditCliArgs.test.ts tests/admin/adminServer.test.ts tests/admin/adminConsole.test.ts
```

Expected: pass.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm test
```

Expected: pass.

- [ ] **Step 5: Commit docs**

```bash
git add docs/project-walkthrough/04-unified-wallet-risk-scoring-v2.md docs/project-walkthrough/16-qa-and-release-checks.md
git commit -m "docs: explain scoring calibration audit"
```

---

## Self-Review

- Spec coverage: the plan covers audit reports, source attribution metrics, insufficient coverage as an admin-only audit decision, shadow scoring, calibration fixtures via report rows, admin visibility, CLI artifacts, and no immediate production scoring changes.
- Scope check: the first useful milestone is CLI + JSON/Markdown reports. Admin UI is included after the pure modules and can be postponed without invalidating the earlier tasks.
- Production safety: no task changes `calculateUnifiedWalletRisk` thresholds, final Telegram verdicts, or provider crawling logic.
- Type consistency: shared names are `SourceAttributionSummary`, `ScoringAuditRow`, `ScoringAuditReport`, `ShadowScoringComparison`, `INSUFFICIENT_COVERAGE`, and `scoring-calibration-shadow-v1`.
- Testing: each new pure module has isolated Vitest coverage; admin integration has server and shell smoke tests; final verification includes targeted tests, typecheck, and full test suite.
