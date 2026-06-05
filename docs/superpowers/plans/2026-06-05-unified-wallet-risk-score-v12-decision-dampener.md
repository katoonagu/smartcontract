# Unified Wallet Risk Score v1.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make wallet-level unified scoring produce one consistent final score and decision by removing insufficient-coverage decision leakage, adding Where drain-episode pattern anchors, and gating behavior dampeners when strong transit evidence exists.

**Architecture:** Keep the implementation inside `calculateUnifiedWalletRisk` for this phase. Add small pure helpers in `src/risk/unifiedWalletRisk.ts` for Where drain-episode scoring, strong-transit-anchor detection, and score-driven final decision. Incoming deposit monitoring remains unchanged in this plan, but the new helper boundaries should be easy to extract into a shared policy module in Phase 2.

**Tech Stack:** TypeScript, Vitest, existing `calculateHistoricalTransitBreakdown`, existing `WhereIsMoneyReport` and `DeepAddressForensicReport` types.

---

## Scope Check

This plan implements only wallet check / unified wallet score v1.2.

It does not change:

- `src/forensics/incomingDepositJob.ts`;
- incoming deposit alerts;
- TronScan RPS / scheduler settings;
- admin graph rendering;
- live blockchain reruns.

Incoming deposits are Phase 2 and must later reuse the same final decision policy.

## File Structure

- Modify: `src/risk/unifiedWalletRisk.ts`
  - Add pure helpers for raw amount parsing, ratio calculation, Where drain episode pattern floor, strong-transit anchor detection, dampener gating, and final decision.
  - Keep helper functions near related existing floor/dampener helpers.
  - Do not split files in this phase.

- Modify: `tests/risk/unifiedWalletRisk.test.ts`
  - Replace the old expected behavior where `whereReport.userDecision = DECLINE` forces unified `DECLINE` below score `60`.
  - Add Where drain episode fixture helpers.
  - Add tests for pattern floor and dampener gating.
  - Keep all tests in the existing unified scorer suite.

- Do not modify: `src/forensics/incomingDepositJob.ts`
  - It is intentionally deferred.

## Task 1: Replace The Old Decision-Leak Test

**Files:**
- Modify: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Rewrite the old failing expectation**

Find the existing test:

```ts
it("does not downgrade an existing where-is-money user decline when unified score is below 60", () => {
```

Replace the entire test with:

```ts
  it("does not let insufficient coverage force decline when unified score is below high risk", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(45, {
        decision: "REVIEW",
        userDecision: "DECLINE",
        internalDecision: "REVIEW",
        proofLevel: "insufficient_coverage",
        assessment: whereAssessment(45, {
          decision: "REVIEW",
          riskLayers: [{
            evidenceClass: "unknown_origin",
            kind: "unresolved_origin",
            score: 45,
            rawScore: 45,
            adjustedScore: 45,
            proofLevel: "insufficient_coverage",
            canBeDampened: false,
            reasons: ["Clean source could not be fully proven from available balance-forming paths."],
            warnings: ["Unknown-origin evidence is contextual and does not by itself prove scam, blacklist, or approval-drain activity."],
            evidenceIds: ["unknown-origin-context"]
          }],
          dominantRiskLayer: null
        })
      })
    });

    expect(result.finalScore).toBe(45);
    expect(result.finalLevel).toBe("MEDIUM");
    expect(result.finalDecision).toBe("ACCEPTABLE");
    expect(result.hardEvidenceFloor).toBe(0);
    expect(result.policyFloor).toBe(0);
  });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/risk/unifiedWalletRisk.test.ts --configLoader bundle
```

Expected: FAIL. The rewritten test should fail because current `calculateUnifiedWalletRisk` still preserves `whereReport.userDecision === "DECLINE"`.

- [ ] **Step 3: Do not implement yet**

Leave the failing test in place. Task 3 will implement the decision rule.

- [ ] **Step 4: Commit the failing test**

Run:

```powershell
git add tests/risk/unifiedWalletRisk.test.ts
git commit -m "test: cover unified insufficient coverage decision"
```

## Task 2: Add Failing Drain Episode And Dampener Tests

**Files:**
- Modify: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Add drain episode helper types and fixture**

Add this helper after `sourcePolicyLayer(...)` and before `deepReport(...)`:

```ts
type DrainEpisodeFixture = NonNullable<WhereIsMoneyReport["coverage"]["drainEpisode"]>;

function drainEpisode(overrides: Partial<DrainEpisodeFixture> = {}): DrainEpisodeFixture {
  return {
    anchorTxHash: "tx-anchor-out",
    fundingTxHash: "tx-funding-in",
    fundingAmountRaw: "1885262475832",
    fundingTimestamp: "2026-05-05T13:31:30.000Z",
    startTimestamp: "2026-05-05T13:39:09.000Z",
    endTimestamp: "2026-05-05T15:00:30.000Z",
    episodeOutgoingRaw: "1885347470000",
    episodeSelectedRaw: "135300000000",
    episodeCoverageRatio: 0.071763,
    outgoingTxHashes: ["tx-bridge-1", "tx-bridge-2"],
    bridgeOutgoingRaw: "1885347470000",
    bridgeOutgoingShare: 1,
    ...overrides
  };
}

function whereReportWithDrainEpisode(
  score = 45,
  episode: DrainEpisodeFixture = drainEpisode()
): WhereIsMoneyReport {
  return whereReport(score, {
    decision: "REVIEW",
    userDecision: "DECLINE",
    internalDecision: "REVIEW",
    proofLevel: "insufficient_coverage",
    assessment: whereAssessment(score, {
      decision: "REVIEW",
      reasons: ["Clean source could not be fully proven from available balance-forming paths."]
    }),
    coverage: {
      ...whereReport(score).coverage,
      checkedScope: "drain_episode",
      provenanceScope: "recent_flow",
      drainEpisode: episode,
      episodeCoverageRatio: episode.episodeCoverageRatio,
      targetAmountRaw: episode.episodeOutgoingRaw,
      selectedAmountRaw: episode.episodeSelectedRaw
    }
  });
}
```

- [ ] **Step 2: Add a TLh-like pattern-floor test**

Add this test inside `describe("calculateUnifiedWalletRisk", ...)`, after the source-policy floor tests:

```ts
  it("anchors a Where drain episode as a historical transit pattern", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      deepReport: deepReport({
        addressBehaviorProfiles: [{
          subjectAddress: address,
          incomingVolumeRaw: "7541408439833",
          outgoingVolumeRaw: "7541406947200",
          incomingTxCount: 12,
          outgoingTxCount: 27,
          uniqueIncomingCounterparties: 5,
          uniqueOutgoingCounterparties: 7,
          largestIncomingRaw: "2390400000000",
          largestOutgoingRaw: "1654000000000",
          topOutgoingCounterpartyAddress: "TTopCounterparty11111111111111111",
          topOutgoingCounterpartyRaw: "3000000000000",
          topOutgoingCounterpartyTxCount: 4,
          topOutgoingCounterpartyRatio: 0.3978,
          inflowToOutflowRatio: 0.9999,
          drainToServiceRatio: 0.2498,
          timeToFirstOutgoingMs: 723_000,
          timeToFirstServiceExitMs: 723_000,
          depositThenDrainScore: 25,
          transitScore: 30,
          dampenerScore: 15,
          features: [{
            code: "regular_activity_dampener",
            label: "Distributed regular activity reduces single-incident interpretation",
            value: 0.3169,
            scoreImpact: -15
          }]
        }]
      }),
      whereReport: whereReportWithDrainEpisode()
    });

    expect(result.patternFloor).toBeGreaterThanOrEqual(80);
    expect(result.finalScore).toBe(84);
    expect(result.finalLevel).toBe("HIGH");
    expect(result.finalDecision).toBe("DECLINE");
    expect(result.scoreBreakdown.activeAnchor).toEqual(expect.objectContaining({
      code: "where_drain_episode_transit_pattern",
      source: "pattern_floor"
    }));
  });
```

- [ ] **Step 3: Add a dampener-gating test where the floor is below weighted context**

Add this test immediately after the previous one:

```ts
  it("caps behavior dampener when a strong drain-episode transit anchor exists", () => {
    const modestEpisode = drainEpisode({
      fundingAmountRaw: "1000000000",
      episodeOutgoingRaw: "1000000000",
      episodeSelectedRaw: "1000000000",
      bridgeOutgoingRaw: "200000000",
      bridgeOutgoingShare: 0.2,
      episodeCoverageRatio: 1
    });
    const result = calculateUnifiedWalletRisk({
      address,
      deepReport: deepReport({
        serviceExposureProfiles: [{
          subjectAddress: address,
          exposureScore: 90,
          totalOutgoingRaw: "100000000000",
          totalOutgoingCount: 10,
          directServiceVolumeRatio: 0,
          directServiceTxRatio: 0,
          indirectServiceVolumeRatio: 0,
          indirectServiceTxRatio: 0,
          mergedServiceVolumeRatio: 0,
          mergedServiceGroupCount: 0,
          combinedServiceVolumeRatio: 0,
          combinedServiceTxRatio: 0,
          dominantCategory: null,
          categoryBreakdown: [],
          topServiceCounterparties: [],
          topMergedServiceFlows: [],
          fastestServiceExitMs: null,
          bestAmountPreservationRatio: null,
          features: []
        }],
        addressBehaviorProfiles: [{
          subjectAddress: address,
          incomingVolumeRaw: "100000000000",
          outgoingVolumeRaw: "100000000000",
          incomingTxCount: 12,
          outgoingTxCount: 12,
          uniqueIncomingCounterparties: 6,
          uniqueOutgoingCounterparties: 6,
          largestIncomingRaw: "30000000000",
          largestOutgoingRaw: "30000000000",
          topOutgoingCounterpartyAddress: "TTopCounterparty11111111111111111",
          topOutgoingCounterpartyRaw: "30000000000",
          topOutgoingCounterpartyTxCount: 3,
          topOutgoingCounterpartyRatio: 0.3,
          inflowToOutflowRatio: 1,
          drainToServiceRatio: 0.2,
          timeToFirstOutgoingMs: 600_000,
          timeToFirstServiceExitMs: 600_000,
          depositThenDrainScore: 0,
          transitScore: 0,
          dampenerScore: 15,
          features: [{
            code: "regular_activity_dampener",
            label: "Distributed regular activity reduces single-incident interpretation",
            value: 0.3,
            scoreImpact: -15
          }]
        }]
      }),
      whereReport: whereReportWithDrainEpisode(45, modestEpisode)
    });

    expect(result.patternFloor).toBe(70);
    expect(result.weightedLayerScore).toBe(75);
    expect(result.dampener).toBe(5);
    expect(result.contextScore).toBe(70);
    expect(result.finalScore).toBe(70);
  });
```

- [ ] **Step 4: Add a control test where dampener still applies without strong transit anchor**

Add this test immediately after the previous one:

```ts
  it("keeps behavior dampener for regular activity without a strong transit anchor", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      deepReport: deepReport({
        serviceExposureProfiles: [{
          subjectAddress: address,
          exposureScore: 90,
          totalOutgoingRaw: "100000000000",
          totalOutgoingCount: 10,
          directServiceVolumeRatio: 0,
          directServiceTxRatio: 0,
          indirectServiceVolumeRatio: 0,
          indirectServiceTxRatio: 0,
          mergedServiceVolumeRatio: 0,
          mergedServiceGroupCount: 0,
          combinedServiceVolumeRatio: 0,
          combinedServiceTxRatio: 0,
          dominantCategory: null,
          categoryBreakdown: [],
          topServiceCounterparties: [],
          topMergedServiceFlows: [],
          fastestServiceExitMs: null,
          bestAmountPreservationRatio: null,
          features: []
        }],
        addressBehaviorProfiles: [{
          subjectAddress: address,
          incomingVolumeRaw: "100000000000",
          outgoingVolumeRaw: "100000000000",
          incomingTxCount: 12,
          outgoingTxCount: 12,
          uniqueIncomingCounterparties: 6,
          uniqueOutgoingCounterparties: 6,
          largestIncomingRaw: "30000000000",
          largestOutgoingRaw: "30000000000",
          topOutgoingCounterpartyAddress: "TTopCounterparty11111111111111111",
          topOutgoingCounterpartyRaw: "30000000000",
          topOutgoingCounterpartyTxCount: 3,
          topOutgoingCounterpartyRatio: 0.3,
          inflowToOutflowRatio: 1,
          drainToServiceRatio: 0,
          timeToFirstOutgoingMs: null,
          timeToFirstServiceExitMs: null,
          depositThenDrainScore: 0,
          transitScore: 0,
          dampenerScore: 15,
          features: [{
            code: "regular_activity_dampener",
            label: "Distributed regular activity reduces single-incident interpretation",
            value: 0.3,
            scoreImpact: -15
          }]
        }]
      }),
      whereReport: whereReport(45, {
        decision: "REVIEW",
        userDecision: "DECLINE",
        internalDecision: "REVIEW",
        proofLevel: "insufficient_coverage",
        assessment: whereAssessment(45, { decision: "REVIEW" })
      })
    });

    expect(result.patternFloor).toBe(0);
    expect(result.dampener).toBe(15);
    expect(result.finalScore).toBe(60);
  });
```

- [ ] **Step 5: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/risk/unifiedWalletRisk.test.ts --configLoader bundle
```

Expected: FAIL. The new drain episode tests should fail because `whereReport.coverage.drainEpisode` is not yet used by `calculateUnifiedWalletRisk`.

- [ ] **Step 6: Commit the failing tests**

Run:

```powershell
git add tests/risk/unifiedWalletRisk.test.ts
git commit -m "test: cover unified drain episode scoring"
```

## Task 3: Implement Score-Driven Final Decision

**Files:**
- Modify: `src/risk/unifiedWalletRisk.ts`
- Test: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Add a final-decision helper**

Add this helper near `decisionFromScore(...)`:

```ts
function finalDecisionFromScoreAndEvidence(input: {
  finalScore: number;
  hardEvidenceFloor: number;
}): UserExchangeDecision {
  if (input.hardEvidenceFloor >= 85) return "DECLINE";
  return decisionFromScore(input.finalScore);
}
```

- [ ] **Step 2: Replace the current final decision assignment**

In `calculateUnifiedWalletRisk`, replace:

```ts
  const finalDecision = input.whereReport.userDecision === "DECLINE"
    ? "DECLINE"
    : decisionFromScore(finalScore);
```

with:

```ts
  const finalDecision = finalDecisionFromScoreAndEvidence({
    finalScore,
    hardEvidenceFloor
  });
```

- [ ] **Step 3: Run focused tests**

Run:

```powershell
npx vitest run tests/risk/unifiedWalletRisk.test.ts --configLoader bundle
```

Expected: the decision-leak test from Task 1 passes. Drain episode tests from Task 2 still fail.

- [ ] **Step 4: Commit the implementation**

Run:

```powershell
git add src/risk/unifiedWalletRisk.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "fix: align unified decision with final score"
```

## Task 4: Implement Where Drain Episode Pattern Floor

**Files:**
- Modify: `src/risk/unifiedWalletRisk.ts`
- Test: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Add raw amount helpers**

Add these helpers after `maxScore(...)`:

```ts
function positiveRawAmount(value: string | null | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function rawRatio(numerator: bigint, denominator: bigint): number | null {
  if (denominator <= 0n) return null;
  const scale = 1_000_000n;
  return Number((numerator * scale) / denominator) / Number(scale);
}
```

- [ ] **Step 2: Add Where drain episode pattern floor helper**

Add this helper after `historicalTransitPatternFloor(...)`:

```ts
function whereDrainEpisodeTransitPatternFloor(report: WhereIsMoneyReport): UnifiedWalletRiskReason | null {
  const episode = report.coverage.drainEpisode ?? null;
  if (!episode) return null;

  const fundingRaw = positiveRawAmount(episode.fundingAmountRaw ?? null);
  const outgoingRaw = positiveRawAmount(episode.episodeOutgoingRaw);
  if (fundingRaw <= 0n || outgoingRaw <= 0n) return null;

  const breakdown = calculateHistoricalTransitBreakdown({
    incomingVolumeRaw: fundingRaw.toString(),
    outgoingVolumeRaw: outgoingRaw.toString(),
    inflowToOutflowRatio: rawRatio(outgoingRaw, fundingRaw),
    bridgeDexRouterOutgoingRatio: episode.bridgeOutgoingShare,
    unknownContractOutgoingRatio: 0
  });
  if (!breakdown.eligible || breakdown.score < 60) return null;

  return {
    code: "where_drain_episode_transit_pattern",
    message: "Where Is Money found a high-volume pass-through drain episode to bridge/swap/router/DEX infrastructure.",
    score: Math.min(84, breakdown.score),
    source: "pattern_floor"
  };
}
```

- [ ] **Step 3: Wire the helper into pattern reasons**

In `calculateUnifiedWalletRisk`, change:

```ts
  const patternReasons = [
    historicalTransitPatternFloor(input.deepReport),
    routeLinkedApprovalPatternFloor(input.deepReport),
    coverageReason
  ].filter((reason): reason is UnifiedWalletRiskReason => reason !== null);
```

to:

```ts
  const patternReasons = [
    historicalTransitPatternFloor(input.deepReport),
    whereDrainEpisodeTransitPatternFloor(input.whereReport),
    routeLinkedApprovalPatternFloor(input.deepReport),
    coverageReason
  ].filter((reason): reason is UnifiedWalletRiskReason => reason !== null);
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npx vitest run tests/risk/unifiedWalletRisk.test.ts --configLoader bundle
```

Expected: the drain episode pattern-floor test passes. The dampener-gating test may still fail until Task 5.

- [ ] **Step 5: Commit the implementation**

Run:

```powershell
git add src/risk/unifiedWalletRisk.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "feat: anchor where drain episodes in unified score"
```

## Task 5: Gate Behavior Dampeners With Strong Transit Anchors

**Files:**
- Modify: `src/risk/unifiedWalletRisk.ts`
- Test: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Change `rawDampener` signature**

Replace:

```ts
function rawDampener(input: UnifiedWalletRiskInput): UnifiedWalletRiskReason {
```

with:

```ts
function rawDampener(input: UnifiedWalletRiskInput, options: { strongTransitAnchor: boolean }): UnifiedWalletRiskReason {
```

- [ ] **Step 2: Cap behavior dampener inside `rawDampener`**

Inside `rawDampener`, replace:

```ts
  const behaviorDampener =
    arrayOrEmpty(input.deepReport?.addressBehaviorProfiles)
      .reduce((max, profile) => Math.max(max, profile.dampenerScore), 0);
```

with:

```ts
  const rawBehaviorDampener =
    arrayOrEmpty(input.deepReport?.addressBehaviorProfiles)
      .reduce((max, profile) => Math.max(max, profile.dampenerScore), 0);
  const behaviorDampener = options.strongTransitAnchor
    ? Math.min(rawBehaviorDampener, 5)
    : rawBehaviorDampener;
```

- [ ] **Step 3: Add a strong-transit-anchor helper**

Add this helper before `rawDampener(...)`:

```ts
function hasStrongTransitAnchor(input: {
  patternReasons: UnifiedWalletRiskReason[];
  policyReasons: UnifiedWalletRiskReason[];
  assetContinuationFloorScore: number;
}): boolean {
  return input.assetContinuationFloorScore > 0 ||
    input.patternReasons.some((reason) =>
      reason.code === "historical_transit_pattern" ||
      reason.code === "where_drain_episode_transit_pattern" ||
      reason.code === "route_linked_approval_pattern"
    ) ||
    input.policyReasons.some((reason) => reason.code === "where_source_policy_floor");
}
```

- [ ] **Step 4: Pass the strong-transit flag from `calculateUnifiedWalletRisk`**

Replace:

```ts
  const dampenerReason = rawDampener(input);
```

with:

```ts
  const dampenerReason = rawDampener(input, {
    strongTransitAnchor: hasStrongTransitAnchor({
      patternReasons,
      policyReasons,
      assetContinuationFloorScore
    })
  });
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npx vitest run tests/risk/unifiedWalletRisk.test.ts --configLoader bundle
```

Expected: all tests in `tests/risk/unifiedWalletRisk.test.ts` pass.

- [ ] **Step 6: Commit the implementation**

Run:

```powershell
git add src/risk/unifiedWalletRisk.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "fix: gate unified dampeners on transit anchors"
```

## Task 6: Verify Saved-Job Behavior And Regressions

**Files:**
- Read only: PostgreSQL `forensic_check_jobs`
- No code changes expected

- [ ] **Step 1: Run focused unified risk tests**

Run:

```powershell
npx vitest run tests/risk/unifiedWalletRisk.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 2: Run related bot formatter tests**

Run:

```powershell
npx vitest run tests/bot/createBot.test.ts --configLoader bundle
```

Expected: PASS. If snapshots or expectations fail because low-score insufficient-coverage no longer declines, update only the expectations that assert the old contradictory behavior.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 5: Compare known saved jobs**

Run this read-only script:

```powershell
@'
import "dotenv/config";
import pg from "pg";
import { calculateUnifiedWalletRisk } from "./src/risk/unifiedWalletRisk";
import { extractDeepForensicReportFromJob, extractWhereIsMoneyReportFromJob } from "./src/bot/createBot";

const addresses = [
  "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe",
  "TSdKkavp6EGy3CNG8iqZvVDiMP1Sdh1fUU",
  "TYs4UuvnUHr8D744bURoKWqfNA2TNJEXi7",
  "TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb",
  "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM"
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

function toJob(row) {
  return row && {
    id: row.id,
    kind: row.kind,
    subjectAddress: row.subject_address,
    status: row.status,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    priority: row.priority,
    chatId: row.chat_id,
    messageId: row.message_id,
    requestedBy: row.requested_by,
    progressJson: row.progress_json ?? {},
    resultJson: row.result_json ?? {},
    rawEvidenceIds: row.raw_evidence_ids ?? [],
    observationIds: row.observation_ids ?? [],
    lastError: row.last_error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

await client.connect();
for (const address of addresses) {
  const rows = await client.query(`
    select distinct on (kind) *
    from forensic_check_jobs
    where subject_address = $1
      and kind in ('where_is_money_check', 'address_deep_check')
      and status in ('completed', 'partial')
    order by kind, created_at desc
  `, [address]);
  const jobs = Object.fromEntries(rows.rows.map((row) => [row.kind, toJob(row)]));
  const whereReport = extractWhereIsMoneyReportFromJob(jobs.where_is_money_check, address);
  const deepReport = extractDeepForensicReportFromJob(jobs.address_deep_check, address);
  if (!whereReport) {
    console.log(address, "missing where report");
    continue;
  }
  const result = calculateUnifiedWalletRisk({
    address,
    fastReport: whereReport.fastWalletRisk ?? null,
    deepReport,
    whereReport
  });
  console.log(JSON.stringify({
    address,
    score: result.finalScore,
    level: result.finalLevel,
    decision: result.finalDecision,
    weightedLayerScore: result.weightedLayerScore,
    contextScore: result.contextScore,
    dampener: result.dampener,
    floors: result.scoreBreakdown.floors,
    activeAnchor: result.scoreBreakdown.activeAnchor
  }));
}
await client.end();
'@ | node --import tsx -
```

Expected:

- `TLhVzk...` no longer ends as `43 MEDIUM` when saved `drainEpisode` evidence is present.
- `TSd...` no longer shows `LOW` score with `DECLINE` only from `insufficient_coverage`.
- `TYs...` remains high because source-policy floor still anchors it.
- `TPv...` remains high.
- `TEY...` remains low/acceptable unless a new hard/policy/pattern anchor is present.

- [ ] **Step 6: Commit verification-only expectation updates if needed**

If formatter tests required expectation updates, run:

```powershell
git add tests/bot/createBot.test.ts
git commit -m "test: update unified report decision expectations"
```

If no files changed, do not create a commit.

## Task 7: Final Review

**Files:**
- Read: `src/risk/unifiedWalletRisk.ts`
- Read: `tests/risk/unifiedWalletRisk.test.ts`
- Read: `docs/superpowers/specs/2026-06-05-unified-wallet-risk-score-v12-decision-dampener-design.md`

- [ ] **Step 1: Review diff**

Run:

```powershell
git status --short
git log --oneline -5
git diff HEAD~4..HEAD -- src/risk/unifiedWalletRisk.ts tests/risk/unifiedWalletRisk.test.ts
```

Expected: only unified wallet scoring and tests changed.

- [ ] **Step 2: Check spec coverage**

Confirm these requirements are implemented:

```text
Wallet-level finalDecision no longer blindly inherits whereReport.userDecision.
Low-score insufficient_coverage wallet checks no longer show DECLINE.
Hard evidence remains deterministic high-risk DECLINE.
whereReport.coverage.drainEpisode can produce a pattern floor.
Strong transit anchors cap behavior dampeners.
Incoming deposits are unchanged in this phase.
```

- [ ] **Step 3: Run final commands**

Run:

```powershell
npm run typecheck
npm test
git status --short
```

Expected: typecheck passes, tests pass, working tree is clean.

## Self-Review Notes

- Spec coverage: Tasks 1-5 cover wallet decision, pattern anchor, and dampener gating. Task 6 covers saved-job comparison. Phase 2 incoming deposits are explicitly out of scope.
- Placeholder scan: this plan has no unfinished placeholder markers.
- Type consistency: helpers use existing `WhereIsMoneyReport`, `DeepAddressForensicReport`, `UnifiedWalletRiskReason`, and `calculateHistoricalTransitBreakdown`.
- Scope: the plan changes one production file and one test file. It intentionally does not touch incoming deposit monitoring.
