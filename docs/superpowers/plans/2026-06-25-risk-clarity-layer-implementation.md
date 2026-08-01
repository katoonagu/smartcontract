# Risk Clarity Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clear risk-explanation layer that keeps one final user-facing risk score while separating execution status, coverage, confidence, evidence strength, and policy decision for admin and beta Telegram diagnostics.

**Architecture:** Do not rewrite FastCheck, DeepCheck, Where is money, Incoming deposit, or Approval scoring engines. Add one shared `riskClarity` module that derives a display/explainability summary from existing job/result objects, then surface it in admin graph summaries and Telegram formatting. Store nothing new in the database in this phase; compute the clarity wrapper at projection/formatting time so legacy jobs remain readable.

**Tech Stack:** TypeScript, Vitest, existing vanilla admin console HTML/SVG, existing Grammy Telegram formatting helpers, existing forensic job/result JSON contracts.

---

## File Map

- Create `src/risk/riskClarity.ts`: shared clarity model, thresholds, coverage/evidence/confidence heuristics, policy version mapping, display notes.
- Create `tests/risk/riskClarity.test.ts`: isolated tests for coverage/evidence/confidence/decision behavior.
- Modify `src/admin/forensicsGraph.ts`: add `riskClarity` to `AdminForensicsSummary`; align graph risk thresholds to unified wallet thresholds.
- Modify `tests/admin/forensicsGraph.test.ts`: assert completed jobs with coverage gaps show partial/limited clarity and graph thresholds are aligned.
- Modify `src/admin/adminConsole.ts`: render clarity fields in Case brief and Details panels.
- Modify `tests/admin/adminConsole.test.ts`: assert the admin shell contains the new clarity rendering helpers and labels.
- Modify `src/config.ts`: add `botBetaRiskDiagnosticsEnabled` config flag from `BOT_BETA_RISK_DIAGNOSTICS`, default `false`.
- Modify `src/index.ts`: pass the beta diagnostics flag into forensic result message formatters.
- Modify `src/bot/createBot.ts`: add final-risk clarity notes and optional beta diagnostics block to final address/where/deep messages.
- Modify `tests/bot/createBot.test.ts`: update config fixtures and add Telegram assertions for partial coverage, no-hard-evidence note, beta diagnostics separation.
- Modify docs: `docs/project-walkthrough/07-unified-wallet-risk-plain-language.md`, `08-admin-forensics-console-plain-language.md`, `13-graph-visualization-plain-language.md`, `14-telegram-bot-plain-language.md`, `15-limitations-and-honest-promises.md`.

---

### Task 1: Shared Risk Clarity Model (completed)

**Files:**
- Create: `src/risk/riskClarity.ts`
- Create: `tests/risk/riskClarity.test.ts`

- [ ] **Step 1: Write failing clarity tests**

Create `tests/risk/riskClarity.test.ts` with these focused cases:

```ts
import { describe, expect, it } from "vitest";
import {
  buildRiskClaritySummary,
  riskClarityLevelFromScore,
  type RiskClarityInput
} from "../../src/risk/riskClarity";

function baseInput(overrides: Partial<RiskClarityInput> = {}): RiskClarityInput {
  return {
    kind: "address_deep_check",
    executionStatus: "completed",
    finalRiskScore: 70,
    explicitDecision: "DECLINE",
    missingChecks: [],
    coveragePartial: false,
    fetchedAddressCount: 8,
    hardEvidenceObserved: false,
    evidenceHints: ["service exposure profile"],
    ...overrides
  };
}

describe("risk clarity summary", () => {
  it("uses unified wallet risk thresholds", () => {
    expect(riskClarityLevelFromScore(null)).toBeNull();
    expect(riskClarityLevelFromScore(29)).toBe("LOW");
    expect(riskClarityLevelFromScore(30)).toBe("MEDIUM");
    expect(riskClarityLevelFromScore(60)).toBe("HIGH");
    expect(riskClarityLevelFromScore(85)).toBe("CRITICAL");
  });

  it("keeps completed execution separate from partial coverage", () => {
    const clarity = buildRiskClaritySummary(baseInput({
      missingChecks: ["provider timeout"],
      coveragePartial: false
    }));

    expect(clarity.executionStatus).toBe("completed");
    expect(clarity.coverageStatus).toBe("partial");
    expect(clarity.coverageScore).toBe(70);
    expect(clarity.limitations).toContain("provider timeout");
  });

  it("marks sparse provenance as limited without changing job execution status", () => {
    const clarity = buildRiskClaritySummary(baseInput({
      kind: "where_is_money_check",
      fetchedAddressCount: 1,
      coveragePartial: true,
      missingChecks: []
    }));

    expect(clarity.executionStatus).toBe("completed");
    expect(clarity.coverageStatus).toBe("limited");
    expect(clarity.coverageScore).toBe(45);
  });

  it("explains high contextual risk without hard evidence", () => {
    const clarity = buildRiskClaritySummary(baseInput({
      finalRiskScore: 72,
      hardEvidenceObserved: false,
      evidenceHints: ["counterparty context"]
    }));

    expect(clarity.decisionStatus).toBe("decline");
    expect(clarity.evidenceClass).toBe("contextual");
    expect(clarity.displayNotes).toContain("High contextual risk; no hard evidence observed.");
  });

  it("does not call an acceptable partial result clean", () => {
    const clarity = buildRiskClaritySummary(baseInput({
      finalRiskScore: 20,
      explicitDecision: "ACCEPTABLE",
      missingChecks: ["service boundary reached"]
    }));

    expect(clarity.decisionStatus).toBe("acceptable");
    expect(clarity.coverageStatus).toBe("partial");
    expect(clarity.displayNotes).toContain("No material risk found in available data; this is not a guarantee of clean history.");
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
npx vitest run --configLoader bundle tests/risk/riskClarity.test.ts
```

Expected result: fail because `src/risk/riskClarity.ts` does not exist.

- [ ] **Step 3: Implement the shared helper**

Create `src/risk/riskClarity.ts`:

```ts
import type { ForensicCheckJobStatus, ForensicCheckJob } from "../storage/repositories";

export type RiskClarityCoverageStatus = "complete" | "partial" | "limited" | "insufficient";
export type RiskClarityDecisionStatus = "acceptable" | "review" | "decline" | "insufficient_coverage" | "manual_required";
export type RiskClarityEvidenceClass = "hard" | "strong_linked" | "contextual" | "weak" | "none" | "unknown";
export type RiskClarityRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RiskClarityInput = {
  kind: ForensicCheckJob["kind"] | "approval_check";
  executionStatus: Extract<ForensicCheckJobStatus, "queued" | "running" | "completed" | "partial" | "failed">;
  finalRiskScore: number | null;
  explicitDecision?: "ACCEPTABLE" | "REVIEW" | "DECLINE" | "UNKNOWN" | null;
  missingChecks?: string[];
  coveragePartial?: boolean;
  fetchedAddressCount?: number | null;
  hardEvidenceObserved?: boolean;
  evidenceHints?: string[];
};

export type RiskClaritySummary = {
  executionStatus: "queued" | "running" | "completed" | "failed";
  coverageStatus: RiskClarityCoverageStatus;
  decisionStatus: RiskClarityDecisionStatus;
  finalRiskScore: number | null;
  riskLevel: RiskClarityRiskLevel | null;
  confidenceScore: number | null;
  coverageScore: number | null;
  evidenceStrength: number | null;
  evidenceClass: RiskClarityEvidenceClass;
  policyVersion: string;
  hardEvidenceObserved: boolean;
  betaDiagnosticsVisible: boolean;
  limitations: string[];
  displayNotes: string[];
};

function clampScore(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function riskClarityLevelFromScore(score: number | null): RiskClarityRiskLevel | null {
  const value = clampScore(score);
  if (value === null) return null;
  if (value >= 85) return "CRITICAL";
  if (value >= 60) return "HIGH";
  if (value >= 30) return "MEDIUM";
  return "LOW";
}

function policyVersion(kind: RiskClarityInput["kind"]): string {
  if (kind === "incoming_deposit_check") return "incoming-deposit-risk-v1";
  if (kind === "where_is_money_check") return "where-is-money-v1";
  if (kind === "approval_check") return "approval-risk-v1";
  return "wallet-risk-v1";
}

function normalizedExecutionStatus(status: RiskClarityInput["executionStatus"]): RiskClaritySummary["executionStatus"] {
  if (status === "partial") return "completed";
  if (status === "queued" || status === "running" || status === "failed") return status;
  return "completed";
}

function coverageStatus(input: RiskClarityInput): RiskClarityCoverageStatus {
  if (input.executionStatus === "failed") return "insufficient";
  if (input.fetchedAddressCount !== undefined && input.fetchedAddressCount !== null && input.fetchedAddressCount <= 1 && input.coveragePartial) return "limited";
  if ((input.missingChecks ?? []).length > 0 || input.coveragePartial) return "partial";
  return "complete";
}

function coverageScore(status: RiskClarityCoverageStatus): number {
  if (status === "complete") return 100;
  if (status === "partial") return 70;
  if (status === "limited") return 45;
  return 20;
}

function evidenceClass(input: RiskClarityInput): RiskClarityEvidenceClass {
  if (input.hardEvidenceObserved) return "hard";
  const hints = (input.evidenceHints ?? []).join(" ").toLowerCase();
  if (hints.includes("amount") || hints.includes("path") || hints.includes("route")) return "strong_linked";
  if (hints.includes("context") || hints.includes("service") || hints.includes("counterparty") || hints.includes("boundary")) return "contextual";
  if (hints.length > 0) return "weak";
  if (input.finalRiskScore === null) return "unknown";
  return input.finalRiskScore > 0 ? "weak" : "none";
}

function evidenceStrength(value: RiskClarityEvidenceClass): number {
  if (value === "hard") return 95;
  if (value === "strong_linked") return 78;
  if (value === "contextual") return 56;
  if (value === "weak") return 30;
  if (value === "none") return 10;
  return 0;
}

function confidenceScore(coverage: number, evidence: RiskClarityEvidenceClass): number {
  const multiplier = evidence === "hard"
    ? 1
    : evidence === "strong_linked"
      ? 0.85
      : evidence === "contextual"
        ? 0.65
        : evidence === "weak"
          ? 0.45
          : 0.35;
  return Math.round(coverage * multiplier);
}

function decisionStatus(input: RiskClarityInput, coverage: RiskClarityCoverageStatus): RiskClarityDecisionStatus {
  if (input.finalRiskScore === null) return "manual_required";
  if (coverage === "insufficient") return "insufficient_coverage";
  if (input.explicitDecision === "DECLINE") return "decline";
  if (input.explicitDecision === "REVIEW") return "review";
  if (input.explicitDecision === "ACCEPTABLE") return "acceptable";
  if (input.finalRiskScore >= 60) return "decline";
  if (input.finalRiskScore >= 30) return "review";
  return "acceptable";
}

function displayNotes(input: RiskClarityInput, coverage: RiskClarityCoverageStatus, evidence: RiskClarityEvidenceClass): string[] {
  const notes: string[] = [];
  if ((input.finalRiskScore ?? 0) >= 60 && evidence !== "hard") {
    notes.push("High contextual risk; no hard evidence observed.");
  }
  if ((input.finalRiskScore ?? 0) < 30 && coverage !== "complete") {
    notes.push("No material risk found in available data; this is not a guarantee of clean history.");
  }
  if (coverage === "limited") {
    notes.push("Coverage is limited; review the evidence before treating this result as final.");
  }
  return [...new Set(notes)];
}

export function buildRiskClaritySummary(input: RiskClarityInput, options: { betaDiagnosticsVisible?: boolean } = {}): RiskClaritySummary {
  const score = clampScore(input.finalRiskScore);
  const coverage = coverageStatus(input);
  const coverageValue = coverageScore(coverage);
  const evidence = evidenceClass(input);
  const evidenceValue = evidenceStrength(evidence);
  return {
    executionStatus: normalizedExecutionStatus(input.executionStatus),
    coverageStatus: coverage,
    decisionStatus: decisionStatus(input, coverage),
    finalRiskScore: score,
    riskLevel: riskClarityLevelFromScore(score),
    confidenceScore: score === null ? null : confidenceScore(coverageValue, evidence),
    coverageScore: coverageValue,
    evidenceStrength: evidenceValue,
    evidenceClass: evidence,
    policyVersion: policyVersion(input.kind),
    hardEvidenceObserved: input.hardEvidenceObserved === true,
    betaDiagnosticsVisible: options.betaDiagnosticsVisible === true,
    limitations: [...new Set(input.missingChecks ?? [])],
    displayNotes: displayNotes(input, coverage, evidence)
  };
}
```

- [ ] **Step 4: Run the clarity test**

Run:

```bash
npx vitest run --configLoader bundle tests/risk/riskClarity.test.ts
```

Expected result: pass.

- [ ] **Step 5: Commit**

```bash
git add src/risk/riskClarity.ts tests/risk/riskClarity.test.ts
git commit -m "feat: add risk clarity summary"
```

---

### Task 2: Admin Graph Clarity Contract (completed)

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Write failing admin graph tests**

Add tests to `tests/admin/forensicsGraph.test.ts` inside `describe("projectForensicJobGraph", ...)` and use the existing local `job(...)` fixture helper:

```ts
it("surfaces partial coverage separately from completed deep execution", () => {
  const result = projectForensicJobGraph(job({
    kind: "address_deep_check",
    status: "completed",
    subjectAddress: "TDeepSubject11111111111111111111111111",
    resultJson: {
      subjectAddress: "TDeepSubject11111111111111111111111111",
      riskScore: 72,
      decision: "DECLINE",
      missingChecks: ["provider timeout"],
      coverage: { transferEdges: 8 },
      coverageDebug: { missingChecks: ["provider timeout"] },
      serviceExposureProfiles: [],
      addressBehaviorProfiles: [],
      inboundProvenanceProfiles: [],
      counterpartyRiskProfiles: [],
      directCounterpartyInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      assetContinuationProfiles: [],
      boundaryExposureProfiles: [],
      operationalFlowProfiles: [],
      walletRoleProfiles: [],
      stablecoinRestrictionProfiles: [],
      extendedProvenanceProfiles: []
    }
  }));

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.graph.job.status).toBe("completed");
  expect(result.graph.summary.riskClarity.coverageStatus).toBe("partial");
  expect(result.graph.summary.riskClarity.decisionStatus).toBe("decline");
  expect(result.graph.summary.riskClarity.displayNotes).toContain("High contextual risk; no hard evidence observed.");
});

it("uses unified wallet thresholds for graph summary risk levels", () => {
  const result = projectForensicJobGraph(job({
    kind: "address_deep_check",
    status: "completed",
    subjectAddress: "TDeepSubject11111111111111111111111111",
    resultJson: {
      subjectAddress: "TDeepSubject11111111111111111111111111",
      riskScore: 60,
      decision: "DECLINE",
      missingChecks: [],
      coverage: { transferEdges: 20 },
      coverageDebug: { missingChecks: [] },
      serviceExposureProfiles: [],
      addressBehaviorProfiles: [],
      inboundProvenanceProfiles: [],
      counterpartyRiskProfiles: [],
      directCounterpartyInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      assetContinuationProfiles: [],
      boundaryExposureProfiles: [],
      operationalFlowProfiles: [],
      walletRoleProfiles: [],
      stablecoinRestrictionProfiles: [],
      extendedProvenanceProfiles: []
    }
  }));

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.graph.summary.riskLevel).toBe("HIGH");
  expect(result.graph.summary.riskClarity.riskLevel).toBe("HIGH");
});
```

- [ ] **Step 2: Run the admin graph test and verify failure**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts
```

Expected result: fail because `riskClarity` is not on `AdminForensicsSummary` and graph thresholds still use `65/35`.

- [ ] **Step 3: Extend `AdminForensicsSummary` and thresholds**

In `src/admin/forensicsGraph.ts`, add the import:

```ts
import { buildRiskClaritySummary, riskClarityLevelFromScore, type RiskClaritySummary } from "../risk/riskClarity";
```

Change `AdminForensicsSummary`:

```ts
export type AdminForensicsSummary = {
  decision: AdminForensicsDecision;
  riskScore: number | null;
  riskLevel: AdminForensicsRiskLevel | null;
  confidence: AdminForensicsConfidence | null;
  coverageRatio: number | null;
  checkedScope: string | null;
  anchorCoverageRatio: number | null;
  episodeCoverageRatio: number | null;
  drainEpisode: Record<string, unknown> | null;
  layerSummary: Record<string, unknown> | null;
  selectedAmountRaw: string | null;
  targetAmountRaw: string | null;
  topReasons: string[];
  riskClarity: RiskClaritySummary;
};
```

Replace `riskLevelFromScore` with unified thresholds:

```ts
function riskLevelFromScore(score: number | null): AdminForensicsRiskLevel | null {
  return riskClarityLevelFromScore(score);
}
```

Replace `summaryDecisionFromRisk`:

```ts
function summaryDecisionFromRisk(score: number | null): AdminForensicsDecision {
  if (score === null) return "UNKNOWN";
  if (score >= 60) return "DECLINE";
  if (score >= 30) return "REVIEW";
  return "ACCEPTABLE";
}
```

- [ ] **Step 4: Add local builders for clarity input**

In `src/admin/forensicsGraph.ts`, add helper functions near the existing `numberField`/`arrayField` helpers:

```ts
function stringArrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function evidenceHintsFromResult(result: Record<string, unknown>, assessment: Record<string, unknown>): string[] {
  return [
    ...stringArrayFromUnknown(result.reasons),
    ...stringArrayFromUnknown(assessment.reasons),
    ...stringArrayFromUnknown(result.missingChecks)
  ];
}

function hardEvidenceObserved(result: Record<string, unknown>, assessment: Record<string, unknown>): boolean {
  const hardBadEvidence = assessment.hardBadEvidence;
  if (Array.isArray(hardBadEvidence) && hardBadEvidence.length > 0) return true;
  const proofLevel = typeof result.proofLevel === "string" ? result.proofLevel.toLowerCase() : "";
  return proofLevel.includes("exact") || proofLevel.includes("blacklist") || proofLevel.includes("hard");
}
```

In each graph builder that returns `summary`, compute `riskClarity` with the available fields. For the Deep builder, use:

```ts
const clarity = buildRiskClaritySummary({
  kind: job.kind,
  executionStatus: summary.status,
  finalRiskScore: summaryRiskScore,
  explicitDecision: summaryDecision,
  missingChecks: [
    ...stringArrayFromUnknown(result.missingChecks),
    ...stringArrayFromUnknown(coverageDebug.missingChecks)
  ],
  coveragePartial: summary.status === "partial",
  fetchedAddressCount: numberField(coverage, "fetchedAddressCount"),
  hardEvidenceObserved: hardEvidenceObserved(result, assessment),
  evidenceHints: evidenceHintsFromResult(result, assessment)
});
```

Then add `riskClarity: clarity` to the returned `summary` object.

For Where and Incoming builders, use the same shape with their local `result`, `assessment`, `coverage`, `summaryRiskScore`, and `summaryDecision` variables. If a builder has no `assessment`, pass `{}`. If a builder has no fetched-address count, pass `null`.

- [ ] **Step 5: Run graph tests**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts tests/risk/riskClarity.test.ts
```

Expected result: pass.

- [ ] **Step 6: Commit**

```bash
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat: expose risk clarity in admin graphs"
```

---

### Task 3: Admin Console Clarity Display (completed)

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing admin console smoke assertions**

In `tests/admin/adminConsole.test.ts`, add assertions to the test that inspects the admin HTML/script:

```ts
expect(html).toContain("Final risk");
expect(html).toContain("Coverage status");
expect(html).toContain("Evidence");
expect(html).toContain("Policy");
expect(html).toContain("Graph is evidence navigation, not proof by itself.");
```

If the file stores the rendered page in a variable named `page` or `content`, use that variable instead of `html`.

- [ ] **Step 2: Run the admin console test and verify failure**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts
```

Expected result: fail because the new strings are not present.

- [ ] **Step 3: Add clarity rendering helpers**

In `src/admin/adminConsole.ts`, add these JavaScript helpers inside the existing client script near `graphSummary(graph)` helpers:

```js
function graphRiskClarity(graph) {
  const summary = graphSummary(graph);
  return summary.riskClarity && typeof summary.riskClarity === "object" ? summary.riskClarity : null;
}

function clarityLine(value, fallback) {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function clarityMetricHtml(clarity) {
  if (!clarity) {
    return metric("Coverage status", "unknown") +
      metric("Evidence", "unknown") +
      metric("Policy", "unknown");
  }
  const finalRisk = clarity.finalRiskScore === null
    ? "n/a"
    : String(clarity.finalRiskScore) + " / " + clarityLine(clarity.riskLevel, "unknown");
  return metric("Final risk", finalRisk) +
    metric("Coverage status", clarityLine(clarity.coverageStatus, "unknown")) +
    metric("Confidence", clarity.confidenceScore === null ? "n/a" : String(clarity.confidenceScore)) +
    metric("Evidence", clarityLine(clarity.evidenceClass, "unknown")) +
    metric("Decision status", clarityLine(clarity.decisionStatus, "unknown")) +
    metric("Policy", clarityLine(clarity.policyVersion, "unknown")) +
    listMetric("Risk clarity notes", Array.isArray(clarity.displayNotes) ? clarity.displayNotes : [], "No clarity notes.");
}
```

- [ ] **Step 4: Render clarity in Case brief and Details**

In `renderCaseBrief()`, after the existing `Risk` and `Decision` metrics, add:

```js
clarityMetricHtml(graphRiskClarity(graph)) +
metric("Graph meaning", "Graph is evidence navigation, not proof by itself.", "wide") +
```

In `renderDetails()`, after `metric("Risk", ...)`, add:

```js
clarityMetricHtml(graphRiskClarity(graph)) +
metric("Graph meaning", "Graph is evidence navigation, not proof by itself.", "wide") +
```

- [ ] **Step 5: Run admin tests**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts tests/admin/forensicsGraph.test.ts
```

Expected result: pass.

- [ ] **Step 6: Commit**

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: show risk clarity in admin console"
```

---

### Task 4: Telegram Final-Score Clarity And Beta Diagnostics (completed)

**Files:**
- Modify: `src/config.ts`
- Modify: `src/index.ts`
- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Write failing Telegram formatter tests**

In `tests/bot/createBot.test.ts`, update the `formatUnifiedAddressFinalReportForTest` helper input type to include:

```ts
showBetaDiagnostics?: boolean;
```

Pass it through to the formatter:

```ts
showBetaDiagnostics: input.showBetaDiagnostics
```

Add tests near the existing unified final report tests:

```ts
it("adds a partial data warning without presenting acceptable as clean", () => {
  const whereReport = whereIsMoneyReportForTest({
    riskScore: 20,
    decision: "ACCEPTABLE",
    coverage: {
      ...whereIsMoneyReportForTest().coverage,
      partial: true,
      fetchedAddressCount: 1
    }
  });

  const text = formatUnifiedAddressFinalReportForTest({
    address: whereReport.subjectAddress,
    whereReport,
    locale: "en"
  });

  expect(text).toContain("Final risk");
  expect(text).toContain("Data is limited");
  expect(text).toContain("not a guarantee of clean history");
  expect(text).not.toContain("guaranteed clean");
});

it("explains high contextual risk without hard evidence", () => {
  const whereReport = whereIsMoneyReportForTest({
    riskScore: 72,
    decision: "DECLINE",
    decisionReasons: ["Service-boundary context exposure."]
  });

  const text = formatUnifiedAddressFinalReportForTest({
    address: whereReport.subjectAddress,
    whereReport,
    locale: "en"
  });

  expect(text).toContain("High contextual risk; no hard evidence observed.");
});

it("shows beta diagnostics only when requested", () => {
  const whereReport = whereIsMoneyReportForTest({
    riskScore: 72,
    decision: "DECLINE",
    coverage: {
      ...whereIsMoneyReportForTest().coverage,
      partial: true
    }
  });

  const withoutDiagnostics = formatUnifiedAddressFinalReportForTest({
    address: whereReport.subjectAddress,
    whereReport,
    locale: "en"
  });
  const withDiagnostics = formatUnifiedAddressFinalReportForTest({
    address: whereReport.subjectAddress,
    whereReport,
    locale: "en",
    showBetaDiagnostics: true
  });

  expect(withoutDiagnostics).not.toContain("Beta/internal diagnostics");
  expect(withDiagnostics).toContain("Beta/internal diagnostics");
  expect(withDiagnostics).toContain("coverage");
  expect(withDiagnostics).toContain("confidence");
  expect(withDiagnostics).toContain("evidence");
});
```

- [ ] **Step 2: Run bot tests and verify failure**

Run:

```bash
npx vitest run --configLoader bundle tests/bot/createBot.test.ts
```

Expected result: fail because the formatter has no clarity summary or beta diagnostics option.

- [ ] **Step 3: Add config flag**

In `src/config.ts`, add to `AppConfig`:

```ts
botBetaRiskDiagnosticsEnabled: boolean;
```

In `loadConfig()`, add near runtime/admin settings:

```ts
botBetaRiskDiagnosticsEnabled: parseBooleanFlag("BOT_BETA_RISK_DIAGNOSTICS", process.env.BOT_BETA_RISK_DIAGNOSTICS, false),
```

In `tests/bot/createBot.test.ts`, add to `createConfig()`:

```ts
botBetaRiskDiagnosticsEnabled: false,
```

- [ ] **Step 4: Pass the flag from runtime to formatters**

In `src/index.ts`, update both formatter calls:

```ts
const message = formatDeepForensicUserDeliveryReport(job, report, status, whereJob, {
  runtimeLabel: config.runtimeInstanceLabel,
  locale,
  showBetaDiagnostics: config.botBetaRiskDiagnosticsEnabled
});
```

```ts
const message = formatWhereIsMoneyUserDeliveryReport(job, report, status, deepJob, {
  runtimeLabel: config.runtimeInstanceLabel,
  locale: normalizeBotLocale(job.progressJson.locale),
  showBetaDiagnostics: config.botBetaRiskDiagnosticsEnabled
});
```

- [ ] **Step 5: Extend Telegram formatter options**

In `src/bot/createBot.ts`, add:

```ts
import { buildRiskClaritySummary, type RiskClaritySummary } from "../risk/riskClarity";
```

Extend `UnifiedAddressFinalReportInput`:

```ts
showBetaDiagnostics?: boolean;
```

Extend option types for `formatDeepForensicUserDeliveryReport`, `formatWhereIsMoneyUserDeliveryReport`, and `formatWhereIsMoneyReport`:

```ts
options: { runtimeLabel?: string; locale?: BotLocale; showBetaDiagnostics?: boolean } = {}
```

Pass `showBetaDiagnostics: options.showBetaDiagnostics` into each `formatUnifiedAddressFinalReport()` call.

- [ ] **Step 6: Add Telegram clarity lines**

In `src/bot/createBot.ts`, add helper functions near `formatUnifiedAddressFinalReport`:

```ts
function finalReportEvidenceHints(input: UnifiedAddressFinalReportInput, reasons: string[]): string[] {
  return [
    ...reasons,
    ...(input.whereReport.assessment?.reasons ?? []),
    ...(input.deepReport?.missingChecks ?? [])
  ];
}

function finalReportHasHardEvidence(input: UnifiedAddressFinalReportInput, unifiedRisk: UnifiedWalletRiskResult): boolean {
  if (unifiedRisk.hardEvidenceFloor >= 85) return true;
  if (input.whereReport.assessment.hardBadEvidence.length > 0) return true;
  return input.deepReport?.stablecoinRestrictionProfiles?.some((profile) => profile.blacklisted === true) === true;
}

function clarityUserLines(clarity: RiskClaritySummary, locale: BotLocale): string[] {
  const lines: string[] = [];
  if (clarity.coverageStatus === "partial") {
    lines.push(locale === "en" ? "Data is partial; review coverage before treating this as final." : "Данные частичные; перед итоговым решением проверьте покрытие.");
  }
  if (clarity.coverageStatus === "limited" || clarity.coverageStatus === "insufficient") {
    lines.push(locale === "en" ? "Data is limited; this is not a guarantee of clean history." : "Данные ограничены; это не гарантия чистой истории.");
  }
  lines.push(...clarity.displayNotes);
  return [...new Set(lines)];
}

function betaDiagnosticsLines(clarity: RiskClaritySummary, locale: BotLocale): string[] {
  if (!clarity.betaDiagnosticsVisible) return [];
  const title = locale === "en" ? "Beta/internal diagnostics" : "Beta/internal diagnostics";
  return [
    `${bold(title)}: ${code(`coverage ${clarity.coverageStatus} · confidence ${clarity.confidenceScore ?? "n/a"} · evidence ${clarity.evidenceClass} · policy ${clarity.policyVersion}`)}`
  ];
}
```

Inside `formatUnifiedAddressFinalReport`, after `const crossChainCorridorLines = ...`, build clarity:

```ts
const clarity = buildRiskClaritySummary({
  kind: "where_is_money_check",
  executionStatus: input.whereReport.coverage.partial ? "partial" : "completed",
  finalRiskScore: finalScore,
  explicitDecision: finalDecision,
  missingChecks: [
    ...input.whereReport.coverage.notes,
    ...(input.deepReport?.missingChecks ?? [])
  ],
  coveragePartial: input.whereReport.coverage.partial || unifiedRisk.coverageLevel !== "complete",
  fetchedAddressCount: input.whereReport.coverage.fetchedAddressCount,
  hardEvidenceObserved: finalReportHasHardEvidence(input, unifiedRisk),
  evidenceHints: finalReportEvidenceHints(input, reasonLines)
}, { betaDiagnosticsVisible: input.showBetaDiagnostics === true });
```

Then add these blocks after the `Why` section and before `Score breakdown`:

```ts
section(locale === "en" ? "Data confidence" : "Доверие к данным", [
  bulletList(clarityUserLines(clarity, locale))
]),
...betaDiagnosticsLines(clarity, locale),
```

Keep `Score breakdown` in Telegram for beta/dev for now; this plan does not remove it.

- [ ] **Step 7: Run bot tests**

Run:

```bash
npx vitest run --configLoader bundle tests/bot/createBot.test.ts
```

Expected result: pass.

- [ ] **Step 8: Commit**

```bash
git add src/config.ts src/index.ts src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: add telegram risk clarity notes"
```

---

### Task 5: Documentation Update (completed)

**Files:**
- Modify: `docs/project-walkthrough/07-unified-wallet-risk-plain-language.md`
- Modify: `docs/project-walkthrough/08-admin-forensics-console-plain-language.md`
- Modify: `docs/project-walkthrough/13-graph-visualization-plain-language.md`
- Modify: `docs/project-walkthrough/14-telegram-bot-plain-language.md`
- Modify: `docs/project-walkthrough/15-limitations-and-honest-promises.md`

- [ ] **Step 1: Update unified risk wording**

In `docs/project-walkthrough/07-unified-wallet-risk-plain-language.md`, add a short section:

```md
## Final Risk Versus Diagnostics

The product keeps one final risk score for the user. That score is a rule-and-policy severity score, not a mathematical probability.

Internally we also track:

- coverage: how complete the evidence is;
- confidence: how reliable the conclusion appears from available evidence;
- evidence strength: whether the finding is hard evidence, amount-linked evidence, context, or weak context;
- policy version: which rule set produced the decision.

These diagnostics explain the final score. They are not separate public verdicts.
```

- [ ] **Step 2: Update admin console wording**

In `docs/project-walkthrough/08-admin-forensics-console-plain-language.md`, add:

```md
## Risk Clarity In Admin

Admin shows both execution status and coverage status. A job can be completed but still coverage-limited.

The case brief should answer:

- did the job run;
- what final risk was produced;
- whether the evidence coverage is complete, partial, limited, or insufficient;
- whether the evidence is hard proof or contextual;
- which policy version made the decision;
- what limitations should be reviewed.
```

- [ ] **Step 3: Update graph wording**

In `docs/project-walkthrough/13-graph-visualization-plain-language.md`, add:

```md
## Graph Meaning

The graph is an investigation view. It helps navigate evidence, paths, counterparties, services, boundaries, and collapsed groups.

The graph is not proof by itself. The final risk decision comes from the scoring engines and policy rules. A graph line can mean a direct transfer, an allocated transfer, an inferred context edge, a service boundary, or a peer link, so the UI must label those meanings clearly.
```

- [ ] **Step 4: Update Telegram wording**

In `docs/project-walkthrough/14-telegram-bot-plain-language.md`, add:

```md
## Telegram Result Shape

Telegram should stay short:

1. final risk;
2. decision;
3. why the system decided that;
4. coverage warning if data is partial or limited.

During beta, Telegram may also show a clearly separated internal diagnostics line:

```text
Beta/internal diagnostics: coverage partial · confidence 56 · evidence contextual · policy wallet-risk-v1
```

That line is for operators and developers, not the long-term public product.
```

- [ ] **Step 5: Update limitations**

In `docs/project-walkthrough/15-limitations-and-honest-promises.md`, add:

```md
## Honest Scoring Promise

The system should not present partial evidence as certainty.

If data is partial, limited, or stopped at a service boundary, the product says so. If high risk is contextual rather than hard evidence, the product says that too.

Acceptable means "no material risk found in available evidence under current policy." It does not mean "guaranteed clean forever."
```

- [ ] **Step 6: Commit**

```bash
git add docs/project-walkthrough/07-unified-wallet-risk-plain-language.md docs/project-walkthrough/08-admin-forensics-console-plain-language.md docs/project-walkthrough/13-graph-visualization-plain-language.md docs/project-walkthrough/14-telegram-bot-plain-language.md docs/project-walkthrough/15-limitations-and-honest-promises.md
git commit -m "docs: explain risk clarity layer"
```

---

### Task 6: Full Verification (completed)

**Files:**
- No direct source edits unless a verification command exposes a bug.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npx vitest run --configLoader bundle tests/risk/riskClarity.test.ts tests/risk/unifiedWalletRisk.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/bot/createBot.test.ts
```

Expected result: pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected result: pass.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected result: pass.

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git status --short
git log --oneline --decorate -n 8
```

Expected result: working tree clean after commits; recent commits show each task commit.

---

## Self-Review

- Spec coverage: this plan implements the shared clarity wrapper, admin display, Telegram beta diagnostics, graph threshold alignment, graph-as-navigation wording, and documentation updates. It intentionally does not rewrite scoring engines, graph renderer, provider integrations, or database storage.
- Gap scan: all steps have concrete files, commands, assertions, and expected behavior.
- Type consistency: `RiskClaritySummary` is introduced once in `src/risk/riskClarity.ts`, reused by admin graph summaries, and only rendered by admin/Telegram after it is computed.
