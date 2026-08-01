# Where Dense-Hop Materiality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended for this launch) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. A coordinator can assign one task at a time to fresh subagents and review after each task.

**Goal:** Let ordinary `Where is money` publish a valid caveated result when an unresolved dense-hop provider-cap tail is immaterial, while still blocking material unresolved source or hard-evidence branches.

**Architecture:** Extend the existing `sourceProvenanceMateriality` path instead of adding a second scoring subsystem. Keep provider-cap as a branch-level technical fact, then decide at assessment/report level whether the unresolved branch is dust, small-relative dense-hop tail, material unresolved source, or hard-evidence unresolved source.

**Tech Stack:** TypeScript, Vitest, existing TRON USDT forensic types, existing `moneyOriginOperationalAssessment`, Admin graph read model, Telegram bot formatting.

---

## Scope

This plan implements the approved audit finding:

```text
docs/audit/2026-07-knowledge-deep-audit/09-where-dense-hop-materiality-finding.md
```

It does not change TronScan indexing, provider fetching, or candidate-window targeting. It changes how an already-observed unresolved source-provenance branch affects final score validity.

## Files

- Modify: `src/types.ts`
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `src/risk/unifiedWalletRisk.ts`
- Modify: `src/bot/createBot.ts`
- Modify: `tests/forensics/moneyOriginOperationalAssessment.test.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`
- Modify: `tests/risk/unifiedWalletRisk.test.ts`
- Modify: `tests/bot/createBot.test.ts`
- Modify after behavior changes: `docs/knowledge/05-where-is-money-and-incoming.md`
- Modify after behavior changes: `docs/knowledge/07-risk-scoring-matrix.md`
- Modify after behavior changes: `docs/knowledge/09-current-decisions.md`
- Modify after behavior changes: `docs/knowledge/10-open-problems.md`

## Policy Constants For First Implementation

Use conservative local constants next to the existing residual unresolved constants:

```ts
const MAX_RESIDUAL_UNRESOLVED_SOURCE_SHARE = 0.01;
const MAX_RESIDUAL_UNRESOLVED_SOURCE_RAW = 100_000_000n; // 100 USDT
const USDT_RAW_SCALE = 1_000_000n;

const MAX_DENSE_HOP_UNRESOLVED_SOURCE_SHARE = 0.01;
const MAX_DENSE_HOP_AGGREGATE_UNRESOLVED_SOURCE_SHARE = 0.02;
const MAX_DENSE_HOP_UNRESOLVED_SOURCE_RAW = 10_000n * USDT_RAW_SCALE;
```

Meaning:

- dust residual: unresolved is at most 1% and at most 100 USDT;
- small-relative dense-hop tail: unresolved is at most 1%, aggregate unresolved is at most 2%, and each unresolved dense-hop branch is at most 10,000 USDT;
- material unresolved source: above those thresholds;
- hard-evidence unresolved source: hard evidence is present and materiality bypass is not allowed.

These are code constants for the first implementation, matching the existing local-constant style. Runtime config can be a later product task.

---

### Task 1: Add Dense-Hop Materiality Tests

**Files:**
- Modify: `tests/forensics/moneyOriginOperationalAssessment.test.ts`

- [ ] **Step 1: Add test for small-relative dense-hop tail above dust amount**

Add this test after the existing `"keeps score valid when only residual source provenance is unresolved below materiality"` test:

```ts
  it("keeps score valid for a small-relative dense-hop provider-cap tail above dust amount", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        cleanCexPath({
          balanceTransferTxHash: "tx-large-clean",
          balanceShare: 0.998438,
          txHashes: ["tx-large-clean"],
          steps: [{
            txHash: "tx-large-clean",
            fromAddress: funding,
            toAddress: subject,
            amountRaw: "998438000000",
            timestamp: "2026-05-22T09:00:00.000Z"
          }]
        }),
        reviewPath({
          balanceTransferTxHash: "tx-dense-tail",
          balanceShare: 0.001562,
          stoppedReason: "incoming_history_not_fetched",
          verdict: "REVIEW",
          riskScoreContribution: 45,
          txHashes: ["tx-dense-tail"],
          steps: [{
            txHash: "tx-dense-tail",
            fromAddress: sender,
            toAddress: subject,
            amountRaw: "1562000000",
            timestamp: "2026-05-22T10:00:00.000Z"
          }],
          sourceProvenance: [unresolvedSourceProvenance({
            targetTxHash: "tx-dense-tail",
            targetAmountRaw: "1562000000",
            reasons: ["provider_cap_hit", "dense_hop_provider_cap", "funding_source_unresolved"],
            stopReason: "incoming_history_not_fetched"
          })],
          reasons: ["Dense-hop source remains unresolved after provider-cap terminal state."]
        })
      ],
      senderInteractionProfiles: [profile()],
      coverage: coverage({
        currentBalanceRaw: "1000000000000",
        targetAmountRaw: "1000000000000",
        selectedAmountRaw: "1000000000000",
        partial: true,
        notes: ["Dense-hop source unresolved below relative materiality."]
      })
    }));

    expect(assessment.decision).toBe("REVIEW");
    expect(assessment.scoreValid).not.toBe(false);
    expect(assessment.scoreBlockedReason).toBeNull();
    expect(assessment.technicalStatus).toBe("completed");
    expect((assessment as any).sourceProvenanceMateriality).toMatchObject({
      outcome: "dense_hop_unresolved_below_materiality",
      materialityTier: "small_relative_dense_hop_tail",
      unresolvedAmountRaw: "1562000000",
      unresolvedAmountUsdt: 1562,
      hardEvidenceInUnresolved: false,
      excludedFromDecisiveScore: true
    });
    expect((assessment as any).sourceProvenanceMateriality.unresolvedShareOfCheckedBalance).toBeCloseTo(0.001562, 6);
    expect(assessment.warnings.join(" ")).toContain("Dense-hop unresolved source");
  });
```

- [ ] **Step 2: Add test for same amount being material on small checked amount**

Add this test after the dense-tail valid test:

```ts
  it("keeps score invalid when the same dense-hop unresolved amount is material for the checked amount", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          balanceTransferTxHash: "tx-dense-material",
          balanceShare: 0.781,
          stoppedReason: "incoming_history_not_fetched",
          verdict: "REVIEW",
          riskScoreContribution: 45,
          txHashes: ["tx-dense-material"],
          steps: [{
            txHash: "tx-dense-material",
            fromAddress: sender,
            toAddress: subject,
            amountRaw: "1562000000",
            timestamp: "2026-05-22T10:00:00.000Z"
          }],
          sourceProvenance: [unresolvedSourceProvenance({
            targetTxHash: "tx-dense-material",
            targetAmountRaw: "1562000000",
            reasons: ["provider_cap_hit", "dense_hop_provider_cap", "funding_source_unresolved"],
            stopReason: "incoming_history_not_fetched"
          })]
        })
      ],
      coverage: coverage({
        currentBalanceRaw: "2000000000",
        targetAmountRaw: "2000000000",
        selectedAmountRaw: "2000000000",
        partial: true,
        notes: ["Dense-hop source unresolved but material."]
      })
    }));

    expect(assessment.scoreValid).toBe(false);
    expect(assessment.scoreBlockedReason).toBe("insufficient_coverage");
    expect(assessment.technicalStatus).toBe("provider_cap_unresolved");
    expect((assessment as any).sourceProvenanceMateriality).toMatchObject({
      outcome: "material_unresolved_source",
      materialityTier: "material_unresolved_source",
      unresolvedAmountRaw: "1562000000",
      hardEvidenceInUnresolved: false,
      excludedFromDecisiveScore: false
    });
  });
```

- [ ] **Step 3: Add test for aggregate unresolved share blocking many small tails**

Add:

```ts
  it("keeps score invalid when aggregate dense-hop tails exceed aggregate materiality", () => {
    const unresolvedPaths = Array.from({ length: 3 }, (_, index) => reviewPath({
      balanceTransferTxHash: `tx-dense-tail-${index}`,
      balanceShare: 0.008,
      stoppedReason: "incoming_history_not_fetched",
      verdict: "REVIEW",
      riskScoreContribution: 45,
      txHashes: [`tx-dense-tail-${index}`],
      steps: [{
        txHash: `tx-dense-tail-${index}`,
        fromAddress: sender,
        toAddress: subject,
        amountRaw: "8000000000",
        timestamp: `2026-05-22T10:0${index}:00.000Z`
      }],
      sourceProvenance: [unresolvedSourceProvenance({
        targetTxHash: `tx-dense-tail-${index}`,
        targetAmountRaw: "8000000000",
        reasons: ["provider_cap_hit", "dense_hop_provider_cap", "funding_source_unresolved"],
        stopReason: "incoming_history_not_fetched"
      })]
    }));

    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        cleanCexPath({
          balanceTransferTxHash: "tx-large-clean",
          balanceShare: 0.976
        }),
        ...unresolvedPaths
      ],
      coverage: coverage({
        currentBalanceRaw: "1000000000000",
        targetAmountRaw: "1000000000000",
        selectedAmountRaw: "1000000000000",
        partial: true,
        notes: ["Several dense-hop source tails unresolved."]
      })
    }));

    expect(assessment.scoreValid).toBe(false);
    expect(assessment.technicalStatus).toBe("provider_cap_unresolved");
    expect((assessment as any).sourceProvenanceMateriality).toMatchObject({
      outcome: "aggregate_unresolved_above_materiality",
      materialityTier: "material_unresolved_source",
      unresolvedAmountRaw: "24000000000",
      unresolvedPathCount: 3,
      excludedFromDecisiveScore: false
    });
  });
```

- [ ] **Step 4: Run tests and confirm failure**

Run:

```powershell
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
```

Expected result before implementation:

```text
FAIL tests/forensics/moneyOriginOperationalAssessment.test.ts
```

The failure should mention missing or mismatched `dense_hop_unresolved_below_materiality`, `materialityTier`, or `excludedFromDecisiveScore`.

---

### Task 2: Extend Materiality Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Extend materiality outcome and summary types**

Find the existing `MoneyOriginSourceProvenanceMaterialityOutcome` and `MoneyOriginSourceProvenanceMaterialitySummary` definitions. Replace them with this shape while preserving any adjacent exports:

```ts
export type MoneyOriginSourceProvenanceMaterialityOutcome =
  | "residual_unresolved_below_materiality"
  | "dense_hop_unresolved_below_materiality"
  | "material_unresolved_source"
  | "aggregate_unresolved_above_materiality"
  | "unresolved_source_with_hard_evidence";

export type MoneyOriginSourceProvenanceMaterialityTier =
  | "dust_residual"
  | "small_relative_dense_hop_tail"
  | "material_unresolved_source"
  | "hard_evidence_unresolved_source";

export type MoneyOriginSourceProvenanceMaterialitySummary = {
  outcome: MoneyOriginSourceProvenanceMaterialityOutcome;
  materialityTier: MoneyOriginSourceProvenanceMaterialityTier;
  unresolvedAmountRaw: string;
  unresolvedAmountUsdt: number;
  unresolvedShareOfCheckedBalance: number | null;
  unresolvedShareOfSelectedAmount: number | null;
  largestUnresolvedAmountRaw: string;
  largestUnresolvedAmountUsdt: number;
  aggregateUnresolvedShareOfCheckedBalance: number | null;
  aggregateUnresolvedShareOfSelectedAmount: number | null;
  unresolvedPathCount: number;
  denseHopUnresolvedPathCount: number;
  hardEvidenceInUnresolved: boolean;
  excludedFromDecisiveScore: boolean;
  unresolvedReasonCounts: Record<string, number>;
  thresholds: {
    maxResidualUnresolvedShare: number;
    maxResidualUnresolvedAmountUsdt: number;
    maxResidualUnresolvedAmountRaw: string;
    maxDenseHopUnresolvedShare: number;
    maxDenseHopAggregateUnresolvedShare: number;
    maxDenseHopUnresolvedAmountUsdt: number;
    maxDenseHopUnresolvedAmountRaw: string;
  };
};
```

- [ ] **Step 2: Run typecheck/tests enough to confirm expected compile failures**

Run:

```powershell
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
```

Expected result:

```text
FAIL
```

The remaining failures should now come from `moneyOriginOperationalAssessment.ts` not populating the new fields.

---

### Task 3: Implement Dense-Hop Materiality Summary

**Files:**
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`

- [ ] **Step 1: Add dense-hop constants**

Near the existing local policy constants, use:

```ts
const MAX_RESIDUAL_UNRESOLVED_SOURCE_SHARE = 0.01;
const MAX_RESIDUAL_UNRESOLVED_SOURCE_RAW = 100_000_000n;
const USDT_RAW_SCALE = 1_000_000n;
const MAX_DENSE_HOP_UNRESOLVED_SOURCE_SHARE = 0.01;
const MAX_DENSE_HOP_AGGREGATE_UNRESOLVED_SOURCE_SHARE = 0.02;
const MAX_DENSE_HOP_UNRESOLVED_SOURCE_RAW = 10_000n * USDT_RAW_SCALE;
```

- [ ] **Step 2: Add helper types and dense-hop reason detector**

Add below `pathHasHardEvidence`:

```ts
type UnresolvedSourceProvenanceEntry = {
  amountRaw: bigint;
  hasHardEvidence: boolean;
  denseHop: boolean;
  reasons: string[];
};

function sourceProvenanceLooksDenseHop(reasons: string[], stopReason: string | null | undefined): boolean {
  const values = new Set([
    ...reasons.map((reason) => reason.toLowerCase()),
    stopReason?.toLowerCase() ?? ""
  ]);
  return values.has("dense_hop_provider_cap") ||
    values.has("provider_cap_hit") ||
    values.has("partial_provider_cap") ||
    values.has("provider_cap_unresolved");
}
```

- [ ] **Step 3: Replace aggregation inside `buildSourceProvenanceMaterialitySummary`**

Inside `buildSourceProvenanceMaterialitySummary`, replace the local aggregation variables with:

```ts
  const entries: UnresolvedSourceProvenanceEntry[] = [];
  const seenTargets = new Set<string>();
  const reasonCounts: Record<string, number> = {};
```

Inside the `sourceProvenance.proofClass === "unresolved"` block, replace the amount/path updates with:

```ts
      const reasons = [
        ...sourceProvenance.reasons,
        ...(sourceProvenance.stopReason ? [sourceProvenance.stopReason] : [])
      ];
      const amountRaw = parseAmount(sourceProvenance.targetAmountRaw);
      const hasHardEvidence = pathHasHardEvidence(path, hardBadEvidence);
      entries.push({
        amountRaw,
        hasHardEvidence,
        denseHop: sourceProvenanceLooksDenseHop(sourceProvenance.reasons, sourceProvenance.stopReason),
        reasons
      });
      for (const reason of reasons) {
        reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
      }
```

After walking paths, compute:

```ts
  if (entries.length === 0) return null;

  const unresolvedAmountRaw = entries.reduce((sum, entry) => sum + entry.amountRaw, 0n);
  const largestUnresolvedAmountRaw = entries.reduce((max, entry) => entry.amountRaw > max ? entry.amountRaw : max, 0n);
  const unresolvedPathCount = entries.length;
  const denseHopUnresolvedPathCount = entries.filter((entry) => entry.denseHop).length;
  const hardEvidenceInUnresolved = entries.some((entry) => entry.hasHardEvidence);
```

- [ ] **Step 4: Compute tier and outcome**

Replace the current `belowShareThreshold`, `belowAmountThreshold`, and `outcome` block with:

```ts
  const belowResidualShareThreshold = unresolvedShareOfCheckedBalance !== null &&
    unresolvedShareOfCheckedBalance <= MAX_RESIDUAL_UNRESOLVED_SOURCE_SHARE &&
    (unresolvedShareOfSelectedAmount === null ||
      unresolvedShareOfSelectedAmount <= MAX_RESIDUAL_UNRESOLVED_SOURCE_SHARE);
  const belowResidualAmountThreshold = unresolvedAmountRaw <= MAX_RESIDUAL_UNRESOLVED_SOURCE_RAW;
  const allUnresolvedEntriesAreDenseHop = entries.every((entry) => entry.denseHop);
  const everyDenseHopBranchBelowAmountCap = entries.every((entry) =>
    entry.amountRaw <= MAX_DENSE_HOP_UNRESOLVED_SOURCE_RAW
  );
  const belowDenseHopRelativeThreshold = unresolvedShareOfCheckedBalance !== null &&
    unresolvedShareOfCheckedBalance <= MAX_DENSE_HOP_AGGREGATE_UNRESOLVED_SOURCE_SHARE &&
    (unresolvedShareOfSelectedAmount === null ||
      unresolvedShareOfSelectedAmount <= MAX_DENSE_HOP_AGGREGATE_UNRESOLVED_SOURCE_SHARE) &&
    entries.every((entry) => {
      const branchShareOfChecked = ratioOrNull(entry.amountRaw, checkedBalanceRaw);
      const branchShareOfSelected = ratioOrNull(entry.amountRaw, selectedAmountRaw);
      return branchShareOfChecked !== null &&
        branchShareOfChecked <= MAX_DENSE_HOP_UNRESOLVED_SOURCE_SHARE &&
        (branchShareOfSelected === null || branchShareOfSelected <= MAX_DENSE_HOP_UNRESOLVED_SOURCE_SHARE);
    });

  const dustResidual = belowResidualShareThreshold && belowResidualAmountThreshold;
  const smallRelativeDenseHopTail =
    allUnresolvedEntriesAreDenseHop &&
    everyDenseHopBranchBelowAmountCap &&
    belowDenseHopRelativeThreshold;

  const outcome = hardEvidenceInUnresolved
    ? "unresolved_source_with_hard_evidence"
    : dustResidual
      ? "residual_unresolved_below_materiality"
      : smallRelativeDenseHopTail
        ? "dense_hop_unresolved_below_materiality"
        : allUnresolvedEntriesAreDenseHop && !belowDenseHopRelativeThreshold
          ? "aggregate_unresolved_above_materiality"
          : "material_unresolved_source";

  const materialityTier = hardEvidenceInUnresolved
    ? "hard_evidence_unresolved_source"
    : dustResidual
      ? "dust_residual"
      : smallRelativeDenseHopTail
        ? "small_relative_dense_hop_tail"
        : "material_unresolved_source";

  const excludedFromDecisiveScore =
    outcome === "residual_unresolved_below_materiality" ||
    outcome === "dense_hop_unresolved_below_materiality";
```

- [ ] **Step 5: Return the expanded summary**

Update the return object to include new fields:

```ts
  return {
    outcome,
    materialityTier,
    unresolvedAmountRaw: unresolvedAmountRaw.toString(),
    unresolvedAmountUsdt: usdtFromRaw(unresolvedAmountRaw),
    unresolvedShareOfCheckedBalance,
    unresolvedShareOfSelectedAmount,
    largestUnresolvedAmountRaw: largestUnresolvedAmountRaw.toString(),
    largestUnresolvedAmountUsdt: usdtFromRaw(largestUnresolvedAmountRaw),
    aggregateUnresolvedShareOfCheckedBalance: unresolvedShareOfCheckedBalance,
    aggregateUnresolvedShareOfSelectedAmount: unresolvedShareOfSelectedAmount,
    unresolvedPathCount,
    denseHopUnresolvedPathCount,
    hardEvidenceInUnresolved,
    excludedFromDecisiveScore,
    unresolvedReasonCounts: reasonCounts,
    thresholds: {
      maxResidualUnresolvedShare: MAX_RESIDUAL_UNRESOLVED_SOURCE_SHARE,
      maxResidualUnresolvedAmountUsdt: usdtFromRaw(MAX_RESIDUAL_UNRESOLVED_SOURCE_RAW),
      maxResidualUnresolvedAmountRaw: MAX_RESIDUAL_UNRESOLVED_SOURCE_RAW.toString(),
      maxDenseHopUnresolvedShare: MAX_DENSE_HOP_UNRESOLVED_SOURCE_SHARE,
      maxDenseHopAggregateUnresolvedShare: MAX_DENSE_HOP_AGGREGATE_UNRESOLVED_SOURCE_SHARE,
      maxDenseHopUnresolvedAmountUsdt: usdtFromRaw(MAX_DENSE_HOP_UNRESOLVED_SOURCE_RAW),
      maxDenseHopUnresolvedAmountRaw: MAX_DENSE_HOP_UNRESOLVED_SOURCE_RAW.toString()
    }
  };
```

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
```

Expected:

```text
FAIL
```

The remaining failure should be that `dense_hop_unresolved_below_materiality` is still not allowed to publish a valid score.

---

### Task 4: Allow Valid Score For Dense-Hop Below Materiality

**Files:**
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`

- [ ] **Step 1: Add a helper for score-valid materiality outcomes**

Add near `buildSourceProvenanceMaterialitySummary`:

```ts
function sourceProvenanceMaterialityAllowsValidScore(
  summary: MoneyOriginSourceProvenanceMaterialitySummary | null
): boolean {
  return summary?.outcome === "residual_unresolved_below_materiality" ||
    summary?.outcome === "dense_hop_unresolved_below_materiality";
}
```

- [ ] **Step 2: Use helper in the guarded coverage branch**

Find:

```ts
    if (sourceProvenanceMateriality?.outcome === "residual_unresolved_below_materiality") {
```

Replace with:

```ts
    if (sourceProvenanceMaterialityAllowsValidScore(sourceProvenanceMateriality)) {
```

- [ ] **Step 3: Make warning text outcome-aware**

Inside that return branch, replace the existing residual warning with:

```ts
          sourceProvenanceMateriality.outcome === "dense_hop_unresolved_below_materiality"
            ? `Dense-hop unresolved source ${sourceProvenanceMateriality.unresolvedAmountUsdt} USDT is below relative materiality; it is shown as a caveat, not a final coverage block.`
            : `Residual unresolved source ${sourceProvenanceMateriality.unresolvedAmountUsdt} USDT is below materiality; it is shown as a caveat, not a final coverage block.`,
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
```

Expected:

```text
PASS tests/forensics/moneyOriginOperationalAssessment.test.ts
```

---

### Task 5: Keep Unified Risk From Flattening Dense-Hop Caveats To Clean

**Files:**
- Modify: `src/risk/unifiedWalletRisk.ts`
- Modify: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Update the Where caveat helper**

Find the helper that checks:

```ts
report.sourceProvenanceMateriality?.outcome === "residual_unresolved_below_materiality"
```

Replace with:

```ts
function hasScoreValidWhereMaterialityCaveat(report: WhereIsMoneyReport): boolean {
  const outcome = report.sourceProvenanceMateriality?.outcome ??
    report.assessment.sourceProvenanceMateriality?.outcome;
  return outcome === "residual_unresolved_below_materiality" ||
    outcome === "dense_hop_unresolved_below_materiality";
}
```

If the function already exists under a different name, keep the existing name and change only the body.

- [ ] **Step 2: Add a unified risk test**

In `tests/risk/unifiedWalletRisk.test.ts`, add a test next to the residual materiality test:

```ts
  it("keeps a score-valid dense-hop Where caveat as review instead of clean acceptable", () => {
    const report = whereReport({
      scoreValid: true,
      riskScore: 45,
      decision: "REVIEW",
      assessment: {
        ...whereAssessment(),
        scoreValid: true,
        decision: "REVIEW",
        riskScore: 45,
        sourceProvenanceMateriality: {
          outcome: "dense_hop_unresolved_below_materiality",
          materialityTier: "small_relative_dense_hop_tail",
          unresolvedAmountRaw: "1562000000",
          unresolvedAmountUsdt: 1562,
          unresolvedShareOfCheckedBalance: 0.001562,
          unresolvedShareOfSelectedAmount: 0.001562,
          largestUnresolvedAmountRaw: "1562000000",
          largestUnresolvedAmountUsdt: 1562,
          aggregateUnresolvedShareOfCheckedBalance: 0.001562,
          aggregateUnresolvedShareOfSelectedAmount: 0.001562,
          unresolvedPathCount: 1,
          denseHopUnresolvedPathCount: 1,
          hardEvidenceInUnresolved: false,
          excludedFromDecisiveScore: true,
          unresolvedReasonCounts: { provider_cap_hit: 1, dense_hop_provider_cap: 1 },
          thresholds: {
            maxResidualUnresolvedShare: 0.01,
            maxResidualUnresolvedAmountUsdt: 100,
            maxResidualUnresolvedAmountRaw: "100000000",
            maxDenseHopUnresolvedShare: 0.01,
            maxDenseHopAggregateUnresolvedShare: 0.02,
            maxDenseHopUnresolvedAmountUsdt: 10000,
            maxDenseHopUnresolvedAmountRaw: "10000000000"
          }
        }
      }
    });

    const risk = buildUnifiedWalletRisk({
      fastReport: null,
      deepReport: null,
      whereReport: report
    });

    expect(risk.finalDecision).toBe("REVIEW");
    expect(risk.finalScore).toBeGreaterThan(0);
  });
```

Use the local test factories already present in the file. If their names differ, adapt only the factory names; keep the asserted behavior.

- [ ] **Step 3: Run focused risk tests**

Run:

```powershell
npm test -- tests/risk/unifiedWalletRisk.test.ts
```

Expected:

```text
PASS tests/risk/unifiedWalletRisk.test.ts
```

---

### Task 6: Update Admin Graph Materiality Display

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add an Admin helper for score-valid materiality outcomes**

In `src/admin/forensicsGraph.ts`, near existing `sourceProvenanceMateriality` handling, add:

```ts
function sourceProvenanceMaterialityOutcomeIsScoreValidCaveat(outcome: string | null): boolean {
  return outcome === "residual_unresolved_below_materiality" ||
    outcome === "dense_hop_unresolved_below_materiality";
}
```

- [ ] **Step 2: Replace residual-only checks**

Replace checks like:

```ts
stringField(sourceProvenanceMateriality ?? {}, "outcome") === "residual_unresolved_below_materiality"
```

with:

```ts
sourceProvenanceMaterialityOutcomeIsScoreValidCaveat(
  stringField(sourceProvenanceMateriality ?? {}, "outcome")
)
```

- [ ] **Step 3: Make dense-hop label explicit**

Where Admin builds materiality caveat text, use:

```ts
const outcome = stringField(sourceProvenanceMateriality ?? {}, "outcome");
const caveatLabel = outcome === "dense_hop_unresolved_below_materiality"
  ? "Dense hop caveat"
  : "Residual source caveat";
```

The exact UI field can follow the current graph summary shape. The visible text should contain `"Dense hop caveat"` for dense-hop outcomes.

- [ ] **Step 4: Add Admin graph test**

In `tests/admin/forensicsGraph.test.ts`, add a case next to residual materiality graph tests:

```ts
  it("shows dense-hop materiality caveat without terminal history-not-fetched labeling", async () => {
    const result = await buildForensicsGraph({
      job: forensicJob({
        kind: "where_is_money_check",
        status: "completed",
        resultJson: {
          score_valid: true,
          technical_status: "completed",
          whereIsMoneyReport: {
            subjectAddress: subject,
            scoreValid: true,
            technicalStatus: "completed",
            sourceProvenanceMateriality: {
              outcome: "dense_hop_unresolved_below_materiality",
              materialityTier: "small_relative_dense_hop_tail",
              unresolvedAmountRaw: "1562000000",
              unresolvedAmountUsdt: 1562,
              unresolvedShareOfCheckedBalance: 0.001562,
              unresolvedShareOfSelectedAmount: 0.001562,
              largestUnresolvedAmountRaw: "1562000000",
              largestUnresolvedAmountUsdt: 1562,
              aggregateUnresolvedShareOfCheckedBalance: 0.001562,
              aggregateUnresolvedShareOfSelectedAmount: 0.001562,
              unresolvedPathCount: 1,
              denseHopUnresolvedPathCount: 1,
              hardEvidenceInUnresolved: false,
              excludedFromDecisiveScore: true,
              unresolvedReasonCounts: { provider_cap_hit: 1, dense_hop_provider_cap: 1 },
              thresholds: {
                maxResidualUnresolvedShare: 0.01,
                maxResidualUnresolvedAmountUsdt: 100,
                maxResidualUnresolvedAmountRaw: "100000000",
                maxDenseHopUnresolvedShare: 0.01,
                maxDenseHopAggregateUnresolvedShare: 0.02,
                maxDenseHopUnresolvedAmountUsdt: 10000,
                maxDenseHopUnresolvedAmountRaw: "10000000000"
              }
            },
            assessment: {
              decision: "REVIEW",
              riskScore: 45,
              scoreValid: true,
              technicalStatus: "completed",
              sourceProvenanceMateriality: null,
              reasons: [],
              warnings: []
            },
            originPaths: [],
            balanceFormingTransfers: [],
            senderInteractionProfiles: [],
            approvalDrainProvenanceProfiles: [],
            decision: "REVIEW",
            userDecision: "REVIEW",
            internalDecision: "REVIEW",
            proofLevel: "insufficient_coverage",
            riskScore: 45,
            decisionReasons: [],
            coverage: { partial: true, notes: [] }
          }
        }
      })
    });

    expect(JSON.stringify(result.graph.summary)).toContain("dense_hop_unresolved_below_materiality");
    expect(JSON.stringify(result.graph.summary)).toContain("Dense hop caveat");
    expect(JSON.stringify(result.graph.summary)).not.toContain("History not fully fetched");
  });
```

Use the real test helper names in `forensicsGraph.test.ts`; keep the asserted behavior.

- [ ] **Step 5: Run Admin graph tests**

Run:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts
```

Expected:

```text
PASS tests/admin/forensicsGraph.test.ts
```

---

### Task 7: Update Telegram Where Copy

**Files:**
- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add a dense-hop caveat formatter**

Near the existing Where report formatting helpers, add:

```ts
function whereSourceProvenanceMaterialityCaveat(report: WhereIsMoneyReport, locale: Locale): string | null {
  const materiality = report.sourceProvenanceMateriality ?? report.assessment.sourceProvenanceMateriality ?? null;
  if (!materiality) return null;
  if (materiality.outcome === "dense_hop_unresolved_below_materiality") {
    return locale === "en"
      ? `Small dense-hop source tail remains unresolved (${materiality.unresolvedAmountUsdt} USDT). It is below materiality and was not used as clean or bad evidence.`
      : `Небольшой dense-hop источник остался неподтвержденным (${materiality.unresolvedAmountUsdt} USDT). Он ниже materiality и не использован как чистое или плохое доказательство.`;
  }
  if (materiality.outcome === "residual_unresolved_below_materiality") {
    return locale === "en"
      ? `Small residual source remains unresolved (${materiality.unresolvedAmountUsdt} USDT). It is below materiality and shown as a caveat.`
      : `Небольшой остаточный источник остался неподтвержденным (${materiality.unresolvedAmountUsdt} USDT). Он ниже materiality и показан как caveat.`;
  }
  return null;
}
```

- [ ] **Step 2: Insert caveat into final Where message**

In the Where final report builder, append the returned caveat line near other caveats/warnings:

```ts
  const materialityCaveat = whereSourceProvenanceMaterialityCaveat(input.whereReport, locale);
  if (materialityCaveat) {
    lines.push(materialityCaveat);
  }
```

Use the local variable names in `createBot.ts`; keep the caveat out of code blocks and do not expose raw provider status as the main user text.

- [ ] **Step 3: Add a bot formatting regression test**

In `tests/bot/createBot.test.ts`, add this next to the existing residual materiality caveat test:

```ts
  it("shows dense-hop materiality caveat without converting where review to clean", () => {
    const decisionReasons = [
      "Dense-hop source tail remains unresolved below relative materiality."
    ];
    const report = whereIsMoneyReportForTest({
      decision: "REVIEW",
      userDecision: "REVIEW",
      internalDecision: "REVIEW",
      proofLevel: "insufficient_coverage",
      riskScore: 45,
      scoreValid: true,
      technicalStatus: "completed",
      scoreBlockedReason: null,
      decisionReasons,
      coverage: {
        selectedInboundTxCount: 2,
        selectedInboundVolumeRaw: "1000000000000",
        currentBalanceCoverageRatio: 1,
        coverageRatio: 1,
        maxDepth: 20,
        fetchedAddressCount: 12,
        partial: true,
        notes: []
      },
      assessment: {
        ...whereAssessmentForTest({ decision: "REVIEW", riskScore: 45, decisionReasons }),
        decision: "REVIEW",
        riskScore: 45,
        riskBand: "MEDIUM",
        scoreValid: true,
        technicalStatus: "completed",
        scoreBlockedReason: null,
        reasons: [
          "Dense-hop unresolved source 1562 USDT is below relative materiality; it is shown as a caveat, not a final coverage block."
        ],
        sourceProvenanceMateriality: {
          outcome: "dense_hop_unresolved_below_materiality",
          materialityTier: "small_relative_dense_hop_tail",
          unresolvedAmountRaw: "1562000000",
          unresolvedAmountUsdt: 1562,
          unresolvedShareOfCheckedBalance: 0.001562,
          unresolvedShareOfSelectedAmount: 0.001562,
          largestUnresolvedAmountRaw: "1562000000",
          largestUnresolvedAmountUsdt: 1562,
          aggregateUnresolvedShareOfCheckedBalance: 0.001562,
          aggregateUnresolvedShareOfSelectedAmount: 0.001562,
          unresolvedPathCount: 1,
          denseHopUnresolvedPathCount: 1,
          hardEvidenceInUnresolved: false,
          excludedFromDecisiveScore: true,
          unresolvedReasonCounts: {
            provider_cap_hit: 1,
            dense_hop_provider_cap: 1,
            funding_source_unresolved: 1
          },
          thresholds: {
            maxResidualUnresolvedShare: 0.01,
            maxResidualUnresolvedAmountUsdt: 100,
            maxResidualUnresolvedAmountRaw: "100000000",
            maxDenseHopUnresolvedShare: 0.01,
            maxDenseHopAggregateUnresolvedShare: 0.02,
            maxDenseHopUnresolvedAmountUsdt: 10000,
            maxDenseHopUnresolvedAmountRaw: "10000000000"
          }
        }
      }
    });

    const finalText = plainTelegramText(formatWhereIsMoneyReport(
      whereIsMoneyJobForTest(),
      report,
      "completed",
      { locale: "en" }
    ).text);

    expect(finalText).toContain("Decision: REVIEW");
    expect(finalText).toContain("45/100");
    expect(finalText).toContain("Small dense-hop source tail remains unresolved");
    expect(finalText).toContain("not used as clean or bad evidence");
    expect(finalText).not.toContain("Decision: ACCEPTABLE");
    expect(finalText).not.toContain("0/100");
    expect(finalText).not.toContain("History not fully fetched");
  });
```

- [ ] **Step 4: Run focused bot tests**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts
```

Expected:

```text
PASS tests/bot/createBot.test.ts
```

- [ ] **Step 5: Run bot typecheck through focused tests**

If a focused Telegram formatting test exists for Where reports, run it. Otherwise run:

```powershell
npm test -- tests/check/whereIsMoneyCheck.test.ts tests/risk/unifiedWalletRisk.test.ts tests/bot/createBot.test.ts
```

Expected:

```text
PASS
```

---

### Task 8: Update Knowledge Docs After Behavior Change

**Files:**
- Modify: `docs/knowledge/05-where-is-money-and-incoming.md`
- Modify: `docs/knowledge/07-risk-scoring-matrix.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`

- [ ] **Step 1: Update Where knowledge**

In `docs/knowledge/05-where-is-money-and-incoming.md`, add a current behavior paragraph:

```md
Dense-hop materiality extends residual source-provenance handling. If a
provider-capped dense-hop source tail is below relative and aggregate
materiality thresholds and has no hard evidence, ordinary Where can publish a
valid score for the covered part. The dense-hop tail remains visible as a
caveat and is not treated as clean or bad evidence. Material unresolved source
or hard evidence still blocks or drives the result.
```

- [ ] **Step 2: Update scoring knowledge**

In `docs/knowledge/07-risk-scoring-matrix.md`, add:

```md
Dense-hop materiality is a score-valid caveat only when the unresolved branch
is below configured relative and aggregate thresholds and has no hard evidence.
It is not a clean verdict. The unresolved branch is excluded from decisive
clean/bad evidence and remains visible in Admin and Telegram.
```

- [ ] **Step 3: Update current decisions**

In `docs/knowledge/09-current-decisions.md`, add a dated decision:

```md
## 2026-07-05 Dense-Hop Materiality For Where

Ordinary Where may publish a valid caveated score when an unresolved
provider-capped dense-hop source tail is below relative/aggregate materiality
and has no hard evidence. This is separate from dust residual materiality and
does not make the unresolved branch clean. Material unresolved source and hard
evidence remain blockers or decisive risk evidence.
```

- [ ] **Step 4: Update open problems**

In `docs/knowledge/10-open-problems.md`, move the dense-hop item from active
open problem into a note saying implemented behavior exists, and keep any
remaining calibration issue:

```md
- Dense-hop materiality is implemented for ordinary Where as a caveated
  score-valid outcome when the unresolved source tail is below relative and
  aggregate thresholds and has no hard evidence. Remaining open work: calibrate
  thresholds from more live cases and consider runtime config.
```

- [ ] **Step 5: Run docs checks**

Run:

```powershell
git diff --check -- docs/knowledge docs/audit/2026-07-knowledge-deep-audit
Get-ChildItem -LiteralPath 'docs\\knowledge' -Filter '*.md' | Select-String -Pattern 'T[O]DO|T[B]D|\\?\\?\\?' -CaseSensitive:$false
```

Expected:

```text
no output from git diff --check
no unfinished marker matches
```

---

### Task 9: Final Verification

**Files:**
- No new code files.

- [ ] **Step 1: Run focused test suite**

Run:

```powershell
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts tests/admin/forensicsGraph.test.ts tests/risk/unifiedWalletRisk.test.ts tests/check/whereIsMoneyCheck.test.ts tests/bot/createBot.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 2: Run storage and job regression tests if touched indirectly**

Run:

```powershell
npm test -- tests/forensics/targetedHistoryCoordinator.test.ts tests/forensics/deepForensicJob.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 3: Run whitespace check**

Run:

```powershell
git diff --check
```

Expected:

```text
no output
```

- [ ] **Step 4: Review git diff**

Run:

```powershell
git diff -- src/types.ts src/forensics/moneyOriginOperationalAssessment.ts src/admin/forensicsGraph.ts src/risk/unifiedWalletRisk.ts src/bot/createBot.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/admin/forensicsGraph.test.ts tests/risk/unifiedWalletRisk.test.ts tests/bot/createBot.test.ts docs/knowledge
```

Expected review result:

- no changes to TronScan fetching or targeted indexing;
- no broad reinterpretation of old jobs;
- no path where hard evidence becomes hidden by materiality;
- no user-facing "clean" wording for unresolved dense-hop caveats.

## Plan Self-Review

- Spec coverage: covers dense-hop materiality tiers, scope-specific denominator through checked/selected amount, aggregate unresolved checks, hard-evidence override, Admin caveat, Telegram caveat, and docs updates.
- Scope control: does not change provider fetching, index worker budgets, candidate-window targeting, or migration schema.
- Test coverage: starts with failing assessment tests, then risk/Admin formatting tests, then focused Where regression tests.
- Type consistency: the plan uses one new outcome `dense_hop_unresolved_below_materiality` and one blocking outcome `aggregate_unresolved_above_materiality`.
- Known limit: first implementation uses local constants. Runtime config remains a later calibration task.
