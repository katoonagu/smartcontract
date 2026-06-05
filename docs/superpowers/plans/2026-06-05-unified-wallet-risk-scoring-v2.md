# Unified Wallet Risk Scoring v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the v2 scoring/reporting surface, Deep Research historical-flow score alignment, TronScan account-group budgeting, and fixture-based calibration without introducing multiple user-facing wallet scores.

**Architecture:** Keep `calculateUnifiedWalletRisk` as the single wallet-level scorer, but expand its returned explanation model so the active score anchor is visible. Move historical transit scoring into a pure shared helper used by both Deep operational-flow profiles and unified scoring. Extend the existing TronScan scheduler with account-group buckets so key rotation never assumes that two keys from one provider account have separate quotas.

**Tech Stack:** TypeScript, Vitest, existing TRON/USDT forensic types, existing Telegram HTML report formatter, existing TronScan scheduler.

---

## Source Spec

Design spec:

```text
docs/superpowers/specs/2026-06-05-unified-wallet-risk-scoring-v2-design.md
```

Current code facts to preserve:

- `calculateUnifiedWalletRisk` is in `src/risk/unifiedWalletRisk.ts`.
- The final Telegram address report calls `calculateUnifiedWalletRisk` in `src/bot/createBot.ts`.
- Deep operational flow profiles are built in `src/forensics/flowCounterpartyProfile.ts`.
- Deep can already pass live source transfers into operational flow assembly in `src/check/deepForensicCheck.ts`.
- Asset continuation detection is generic TRC20 logic in `src/forensics/assetContinuation.ts`.
- Scheduler key slots, endpoint buckets, and scope cooldowns are in `src/tron/tronscanScheduler.ts`.
- Runtime config is loaded in `src/config.ts` and wired into the scheduler in `src/index.ts`.

## Scope Check

The spec covers three connected subsystems:

1. Scoring/reporting transparency.
2. Deep historical flow score alignment.
3. Provider budgeting.

These are separate tasks in one plan because the product outcome is one final wallet score. Provider coverage affects whether that score is reliable, and historical-flow detection affects the score anchors. Each task below is independently testable and can be assigned to a separate subagent.

## File Structure

Create:

```text
src/forensics/historicalTransitScore.ts
tests/forensics/historicalTransitScore.test.ts
docs/project-walkthrough/04-unified-wallet-risk-scoring-v2.md
```

Modify:

```text
src/types.ts
src/risk/unifiedWalletRisk.ts
tests/risk/unifiedWalletRisk.test.ts
src/forensics/flowCounterpartyProfile.ts
tests/forensics/flowCounterpartyProfile.test.ts
src/check/deepForensicCheck.ts
tests/check/deepForensicCheck.test.ts
src/tron/tronscanScheduler.ts
tests/tron/tronscanScheduler.test.ts
src/config.ts
tests/config/config.test.ts
src/index.ts
src/tron/tronClient.ts
src/bot/createBot.ts
tests/bot/createBot.test.ts
docs/project-walkthrough/03-three-address-score-comparison.md
```

Do not modify:

```text
src/risk/riskPolicy.ts
src/risk/riskEngine.ts
src/forensics/assetContinuation.ts
```

Reason: v2 should improve wallet-level composition, explanation, Deep operational-flow scoring, and provider scheduling. It should not rewrite lower-level risk policy or make asset continuation token-specific.

---

### Task 1: Add Active Score Anchor To Unified Scorer

**Files:**

- Modify: `src/risk/unifiedWalletRisk.ts`
- Modify: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Add a failing active-anchor test**

Append this test inside `describe("calculateUnifiedWalletRisk", ...)` in `tests/risk/unifiedWalletRisk.test.ts`:

```ts
  it("exposes the active score anchor used for the final wallet score", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0),
      deepReport: deepReport({ operationalFlowProfiles: [operationalFlowProfile()] }),
      whereReport: whereReport(25)
    });

    expect(result.finalScore).toBe(81);
    expect(result.scoreBreakdown).toMatchObject({
      weightedLayerScore: 42,
      contextScore: 42,
      floors: {
        hardEvidence: 0,
        policy: 0,
        assetContinuation: 0,
        pattern: 81,
        coverage: 0
      },
      activeAnchor: {
        code: "historical_transit_pattern",
        score: 81,
        source: "pattern_floor"
      },
      noHardEvidenceCriticalCap: {
        applied: false,
        maxScore: 84
      }
    });
  });
```

- [ ] **Step 2: Run the new scorer test and verify it fails**

Run:

```bash
npm test -- tests/risk/unifiedWalletRisk.test.ts -t "exposes the active score anchor"
```

Expected: TypeScript/Vitest failure because `scoreBreakdown` is not present on `UnifiedWalletRiskResult`.

- [ ] **Step 3: Add score-breakdown types**

In `src/risk/unifiedWalletRisk.ts`, add these types after `UnifiedWalletRiskReason`:

```ts
export type UnifiedWalletRiskActiveAnchor = {
  code: string;
  message: string;
  score: number;
  source: UnifiedWalletRiskReason["source"];
};

export type UnifiedWalletRiskFloorBreakdown = {
  hardEvidence: number;
  policy: number;
  assetContinuation: number;
  pattern: number;
  coverage: number;
};

export type UnifiedWalletRiskScoreBreakdown = {
  weightedLayerScore: number;
  contextScore: number;
  dampener: number;
  floors: UnifiedWalletRiskFloorBreakdown;
  activeAnchor: UnifiedWalletRiskActiveAnchor | null;
  noHardEvidenceCriticalCap: {
    applied: boolean;
    maxScore: 84;
  };
};
```

Then add this field to `UnifiedWalletRiskResult`:

```ts
  scoreBreakdown: UnifiedWalletRiskScoreBreakdown;
```

- [ ] **Step 4: Implement active anchor selection**

In `src/risk/unifiedWalletRisk.ts`, add this helper near `maxScore`:

```ts
function activeAnchorFromReasons(reasons: UnifiedWalletRiskReason[]): UnifiedWalletRiskActiveAnchor | null {
  const sorted = [...reasons]
    .filter((reason) => reason.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      left.code.localeCompare(right.code)
    );
  const top = sorted[0];
  return top
    ? {
        code: top.code,
        message: top.message,
        score: top.score,
        source: top.source
      }
    : null;
}
```

In `calculateUnifiedWalletRisk`, split `coverageFloor` into its own variable before `patternReasons`:

```ts
  const coverageReason = coverageFloor(coverage);
  const patternReasons = [
    historicalTransitPatternFloor(input.deepReport),
    routeLinkedApprovalPatternFloor(input.deepReport),
    coverageReason
  ].filter((reason): reason is UnifiedWalletRiskReason => reason !== null);
```

Before the return statement, add:

```ts
  const floorReasons = [
    ...hardReasons,
    ...policyReasons,
    ...assetContinuationReasons,
    ...patternReasons
  ];
  const noHardEvidenceCriticalCapApplied = hardEvidenceFloor === 0 && finalBeforeHardCap > finalScore;
```

Then include this field in the returned object:

```ts
    scoreBreakdown: {
      weightedLayerScore,
      contextScore,
      dampener,
      floors: {
        hardEvidence: hardEvidenceFloor,
        policy: policyFloor,
        assetContinuation: assetContinuationFloorScore,
        pattern: patternFloor,
        coverage: coverageReason?.score ?? 0
      },
      activeAnchor: activeAnchorFromReasons(floorReasons),
      noHardEvidenceCriticalCap: {
        applied: noHardEvidenceCriticalCapApplied,
        maxScore: 84
      }
    },
```

- [ ] **Step 5: Run the scorer test**

Run:

```bash
npm test -- tests/risk/unifiedWalletRisk.test.ts -t "exposes the active score anchor"
```

Expected: PASS.

- [ ] **Step 6: Run the full scorer test file**

Run:

```bash
npm test -- tests/risk/unifiedWalletRisk.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/risk/unifiedWalletRisk.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "feat: expose unified score anchor breakdown"
```

---

### Task 2: Show Active Anchor In Final Report

**Files:**

- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add a failing formatter test**

In `tests/bot/createBot.test.ts`, add a test near the existing unified report formatter tests:

```ts
  it("shows the score anchor in the English unified final report", async () => {
    const whereReport = whereIsMoneyReportForTest({
      riskScore: 25,
      userDecision: "DECLINE",
      fastWalletRisk: riskReportForTest({ score: 0 })
    });
    const deepReport = deepReportForTest({
      operationalFlowProfiles: [{
        subjectAddress: walletAddress,
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
        features: []
      }]
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      locale: "en",
      deepReport,
      whereReport
    });

    expect(text).toContain("Anchored by: historical_transit_pattern 81.");
    expect(text).toContain("Weighted layer score:");
    expect(text).toContain("Decision: DECLINE");
  });
```

- [ ] **Step 2: Run the formatter test and verify it fails**

Run:

```bash
npm test -- tests/bot/createBot.test.ts -t "shows the score anchor"
```

Expected: FAIL because the formatter does not yet print `Anchored by`.

- [ ] **Step 3: Add anchor lines to the formatter**

In `src/bot/createBot.ts`, add this helper near `unifiedRiskBreakdownLines`:

```ts
function unifiedRiskAnchorLines(result: UnifiedWalletRiskResult, locale: BotLocale): string[] {
  const anchor = result.scoreBreakdown.activeAnchor;
  if (!anchor) return [];
  return [
    locale === "en"
      ? `Anchored by: ${anchor.code} ${anchor.score}.`
      : `Закреплено сигналом: ${anchor.code} ${anchor.score}.`
  ];
}
```

Then update `unifiedRiskBreakdownLines` to include it before the floor lines:

```ts
  return [
    ...layerLines,
    ...unifiedRiskAnchorLines(result, locale),
    locale === "en"
      ? `Context score after dampener: ${result.contextScore}.`
      : `Оценка контекста после снижения: ${result.contextScore}.`,
```

- [ ] **Step 4: Run the formatter test**

Run:

```bash
npm test -- tests/bot/createBot.test.ts -t "shows the score anchor"
```

Expected: PASS.

- [ ] **Step 5: Run related bot formatter tests**

Run:

```bash
npm test -- tests/bot/createBot.test.ts -t "unified"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: show unified score anchor in final report"
```

---

### Task 3: Add Historical Transit Score Helper

**Files:**

- Create: `src/forensics/historicalTransitScore.ts`
- Create: `tests/forensics/historicalTransitScore.test.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Add failing pure-helper tests**

Create `tests/forensics/historicalTransitScore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { calculateHistoricalTransitBreakdown } from "../../src/forensics/historicalTransitScore";

describe("calculateHistoricalTransitBreakdown", () => {
  it("scores high-volume pass-through bridge/router flow as a strong pattern", () => {
    const result = calculateHistoricalTransitBreakdown({
      incomingVolumeRaw: "7541408440000",
      outgoingVolumeRaw: "7541406950000",
      inflowToOutflowRatio: 0.999,
      bridgeDexRouterOutgoingRatio: 0.25,
      unknownContractOutgoingRatio: 0
    });

    expect(result).toMatchObject({
      eligible: true,
      flowUsdt: 7541408,
      serviceShare: 0.25,
      passThrough: 0.999,
      volumeScore: 20,
      passThroughScore: 20,
      serviceShareScore: 6,
      score: 81
    });
  });

  it("does not score ordinary low-volume service usage as a strong pattern", () => {
    const result = calculateHistoricalTransitBreakdown({
      incomingVolumeRaw: "100000000",
      outgoingVolumeRaw: "50000000",
      inflowToOutflowRatio: 0.5,
      bridgeDexRouterOutgoingRatio: 0.1,
      unknownContractOutgoingRatio: 0
    });

    expect(result).toMatchObject({
      eligible: false,
      score: 0,
      serviceShare: 0.1
    });
  });
});
```

- [ ] **Step 2: Run the helper tests and verify they fail**

Run:

```bash
npm test -- tests/forensics/historicalTransitScore.test.ts
```

Expected: FAIL because `src/forensics/historicalTransitScore.ts` does not exist.

- [ ] **Step 3: Add historical transit types**

In `src/types.ts`, add this type before `OperationalFlowProfile`:

```ts
export type HistoricalTransitBreakdown = {
  eligible: boolean;
  flowUsdt: number;
  volumeScore: number;
  passThrough: number;
  passThroughScore: number;
  serviceShare: number;
  serviceShareScore: number;
  score: number;
};
```

Then add these fields to `OperationalFlowProfile`:

```ts
  historicalTransitScore: number;
  historicalTransitBreakdown: HistoricalTransitBreakdown;
```

- [ ] **Step 4: Implement the helper**

Create `src/forensics/historicalTransitScore.ts`:

```ts
import type { HistoricalTransitBreakdown } from "../types";

const TRON_USDT_DECIMALS = 1_000_000n;

type HistoricalTransitInput = {
  incomingVolumeRaw: string;
  outgoingVolumeRaw: string;
  inflowToOutflowRatio: number | null;
  bridgeDexRouterOutgoingRatio: number;
  unknownContractOutgoingRatio: number;
};

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function rawUsdtAmount(raw: string): number {
  if (!/^\d+$/.test(raw)) return 0;
  const whole = BigInt(raw) / TRON_USDT_DECIMALS;
  const capped = whole > 10_000_000_000n ? 10_000_000_000n : whole;
  return Number(capped);
}

export function calculateHistoricalTransitBreakdown(input: HistoricalTransitInput): HistoricalTransitBreakdown {
  const incomingUsdt = rawUsdtAmount(input.incomingVolumeRaw);
  const outgoingUsdt = rawUsdtAmount(input.outgoingVolumeRaw);
  const flowUsdt = Math.max(incomingUsdt, outgoingUsdt);
  const passThrough = clampRatio(input.inflowToOutflowRatio ?? (incomingUsdt > 0 ? outgoingUsdt / incomingUsdt : 0));
  const serviceShare = clampRatio(Math.max(input.bridgeDexRouterOutgoingRatio, input.unknownContractOutgoingRatio));

  if (flowUsdt <= 0 || outgoingUsdt <= 0 || serviceShare < 0.2) {
    return {
      eligible: false,
      flowUsdt,
      volumeScore: 0,
      passThrough,
      passThroughScore: 0,
      serviceShare,
      serviceShareScore: 0,
      score: 0
    };
  }

  const volumeScore = clampScore((Math.log10(flowUsdt + 1) / 6) * 20);
  const passThroughScore = clampScore(passThrough * 20);
  const serviceShareScore = clampScore(serviceShare * 25);
  const score = clampScore(35 + volumeScore + passThroughScore + serviceShareScore);

  return {
    eligible: score >= 60,
    flowUsdt,
    volumeScore,
    passThrough,
    passThroughScore,
    serviceShare,
    serviceShareScore,
    score: score >= 60 ? Math.min(84, score) : 0
  };
}
```

- [ ] **Step 5: Run the helper tests**

Run:

```bash
npm test -- tests/forensics/historicalTransitScore.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/types.ts src/forensics/historicalTransitScore.ts tests/forensics/historicalTransitScore.test.ts
git commit -m "feat: add historical transit score helper"
```

---

### Task 4: Store Historical Transit Score On Operational Flow Profiles

**Files:**

- Modify: `src/forensics/flowCounterpartyProfile.ts`
- Modify: `tests/forensics/flowCounterpartyProfile.test.ts`
- Modify: `tests/risk/unifiedWalletRisk.test.ts`
- Modify: `tests/check/deepForensicCheck.test.ts`

- [ ] **Step 1: Add failing flow-profile assertions**

In the first test in `tests/forensics/flowCounterpartyProfile.test.ts`, after the existing `operationalScore` assertion, add:

```ts
    expect(profile.historicalTransitScore).toBeGreaterThanOrEqual(80);
    expect(profile.historicalTransitBreakdown).toMatchObject({
      eligible: true,
      passThrough: 1,
      serviceShare: 0.5,
      score: profile.historicalTransitScore
    });
```

- [ ] **Step 2: Run the flow-profile test and verify it fails**

Run:

```bash
npm test -- tests/forensics/flowCounterpartyProfile.test.ts -t "summarizes top 30-day counterparties"
```

Expected: FAIL because `historicalTransitScore` is not present.

- [ ] **Step 3: Populate historical score in the profile builder**

In `src/forensics/flowCounterpartyProfile.ts`, import the helper:

```ts
import { calculateHistoricalTransitBreakdown } from "./historicalTransitScore";
```

Inside `buildOperationalFlowProfile`, after `const inflowToOutflowRatio = preservation(...)`, add:

```ts
  const historicalTransitBreakdown = calculateHistoricalTransitBreakdown({
    incomingVolumeRaw: incomingVolumeRaw.toString(),
    outgoingVolumeRaw: outgoingVolumeRaw.toString(),
    inflowToOutflowRatio,
    bridgeDexRouterOutgoingRatio,
    unknownContractOutgoingRatio
  });
```

Then add these fields to the returned object:

```ts
    historicalTransitScore: historicalTransitBreakdown.score,
    historicalTransitBreakdown,
```

- [ ] **Step 4: Update existing test fixtures that construct `OperationalFlowProfile`**

In `tests/risk/unifiedWalletRisk.test.ts`, update `operationalFlowProfile` to include:

```ts
    historicalTransitScore: 81,
    historicalTransitBreakdown: {
      eligible: true,
      flowUsdt: 7541408,
      volumeScore: 20,
      passThrough: 0.999,
      passThroughScore: 20,
      serviceShare: 0.25,
      serviceShareScore: 6,
      score: 81
    },
```

In `tests/check/deepForensicCheck.test.ts`, update expectations in the live-source operational-flow test to include:

```ts
      historicalTransitScore: 84,
      historicalTransitBreakdown: expect.objectContaining({
        eligible: true,
        serviceShare: 1,
        score: 84
      })
```

- [ ] **Step 5: Run related tests**

Run:

```bash
npm test -- tests/forensics/flowCounterpartyProfile.test.ts tests/risk/unifiedWalletRisk.test.ts tests/check/deepForensicCheck.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/forensics/flowCounterpartyProfile.ts tests/forensics/flowCounterpartyProfile.test.ts tests/risk/unifiedWalletRisk.test.ts tests/check/deepForensicCheck.test.ts
git commit -m "feat: persist historical transit score on flow profiles"
```

---

### Task 5: Make Pattern Floor Use Profile Historical Transit Score

**Files:**

- Modify: `src/risk/unifiedWalletRisk.ts`
- Modify: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Add a failing legacy/fresh parity test**

Append this test in `tests/risk/unifiedWalletRisk.test.ts`:

```ts
  it("uses profile historicalTransitScore for pattern floor and falls back for legacy profiles", () => {
    const fresh = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(25),
      deepReport: deepReport({
        operationalFlowProfiles: [
          operationalFlowProfile({
            historicalTransitScore: 82,
            historicalTransitBreakdown: {
              eligible: true,
              flowUsdt: 7541408,
              volumeScore: 20,
              passThrough: 0.999,
              passThroughScore: 20,
              serviceShare: 0.35,
              serviceShareScore: 9,
              score: 82
            }
          })
        ]
      })
    });

    const legacyProfile = operationalFlowProfile();
    delete (legacyProfile as Partial<OperationalFlowProfile>).historicalTransitScore;
    delete (legacyProfile as Partial<OperationalFlowProfile>).historicalTransitBreakdown;

    const legacy = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(25),
      deepReport: deepReport({ operationalFlowProfiles: [legacyProfile] })
    });

    expect(fresh.patternFloor).toBe(82);
    expect(fresh.scoreBreakdown.activeAnchor).toMatchObject({
      code: "historical_transit_pattern",
      score: 82
    });
    expect(legacy.patternFloor).toBe(81);
  });
```

- [ ] **Step 2: Run the parity test and verify it fails**

Run:

```bash
npm test -- tests/risk/unifiedWalletRisk.test.ts -t "uses profile historicalTransitScore"
```

Expected: FAIL because `historicalTransitPatternFloor` still recomputes from local logic only.

- [ ] **Step 3: Import helper and remove duplicated scoring math**

In `src/risk/unifiedWalletRisk.ts`, import:

```ts
import { calculateHistoricalTransitBreakdown } from "../forensics/historicalTransitScore";
```

Replace the body of `historicalTransitPatternFloor` with:

```ts
function historicalTransitPatternFloor(report: DeepAddressForensicReport | null | undefined): UnifiedWalletRiskReason | null {
  const profiles = arrayOrEmpty(report?.operationalFlowProfiles);
  let best: UnifiedWalletRiskReason | null = null;

  for (const profile of profiles) {
    const breakdown = profile.historicalTransitBreakdown ?? calculateHistoricalTransitBreakdown({
      incomingVolumeRaw: profile.incomingVolumeRaw,
      outgoingVolumeRaw: profile.outgoingVolumeRaw,
      inflowToOutflowRatio: profile.inflowToOutflowRatio,
      bridgeDexRouterOutgoingRatio: profile.bridgeDexRouterOutgoingRatio,
      unknownContractOutgoingRatio: profile.unknownContractOutgoingRatio
    });
    const score = profile.historicalTransitScore ?? breakdown.score;
    if (!breakdown.eligible || score < 60) continue;

    if (!best || score > best.score) {
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
```

- [ ] **Step 4: Run scorer tests**

Run:

```bash
npm test -- tests/risk/unifiedWalletRisk.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/risk/unifiedWalletRisk.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "feat: align pattern floor with historical transit score"
```

---

### Task 6: Add TronScan API Key Account Groups To Config

**Files:**

- Modify: `src/config.ts`
- Modify: `tests/config/config.test.ts`

- [ ] **Step 1: Add failing config tests**

In `tests/config/config.test.ts`, add these tests after the API-key parsing test:

```ts
  it("groups TronScan API keys by configured account group", () => {
    setRequiredEnv({
      TRONSCAN_API_KEY: "key-a,key-b,key-c",
      TRONSCAN_API_KEY_GROUPS: "main:key-a,key-b;backup:key-c",
      TRONSCAN_ACCOUNT_GROUP_REQUEST_MIN_INTERVAL_MS: "250"
    });

    const config = loadConfig();

    expect(config.tronscanApiKeyGroups).toEqual([
      { groupId: "main", apiKeys: ["key-a", "key-b"] },
      { groupId: "backup", apiKeys: ["key-c"] }
    ]);
    expect(config.tronscanAccountGroupRequestMinIntervalMs).toBe(250);
  });

  it("places all TronScan API keys in one default account group when groups are not configured", () => {
    setRequiredEnv({ TRONSCAN_API_KEY: "key-a,key-b" });

    const config = loadConfig();

    expect(config.tronscanApiKeyGroups).toEqual([
      { groupId: "default", apiKeys: ["key-a", "key-b"] }
    ]);
    expect(config.tronscanAccountGroupRequestMinIntervalMs).toBe(250);
  });

  it("rejects TronScan API key groups that mention unknown keys", () => {
    setRequiredEnv({
      TRONSCAN_API_KEY: "key-a",
      TRONSCAN_API_KEY_GROUPS: "main:key-a,key-b"
    });

    expect(() => loadConfig()).toThrow("TRONSCAN_API_KEY_GROUPS contains key not present in TRONSCAN_API_KEY: key-b");
  });
```

- [ ] **Step 2: Run config tests and verify they fail**

Run:

```bash
npm test -- tests/config/config.test.ts -t "TronScan API key"
```

Expected: FAIL because the new config fields do not exist.

- [ ] **Step 3: Add config types**

In `src/config.ts`, add:

```ts
export type TronscanApiKeyGroupConfig = {
  groupId: string;
  apiKeys: string[];
};
```

Add these fields to `AppConfig`:

```ts
  tronscanApiKeyGroups: TronscanApiKeyGroupConfig[];
  tronscanAccountGroupRequestMinIntervalMs: number;
```

- [ ] **Step 4: Add parser**

In `src/config.ts`, add this helper near `parseCommaSeparatedValues`:

```ts
function parseTronscanApiKeyGroups(rawValue: string | undefined, apiKeys: string[]): TronscanApiKeyGroupConfig[] {
  if (apiKeys.length === 0) return [];
  const knownKeys = new Set(apiKeys);
  const value = rawValue?.trim();
  if (!value) return [{ groupId: "default", apiKeys }];

  const groups = value.split(";").map((group) => group.trim()).filter((group) => group.length > 0);
  const parsed = groups.map((group) => {
    const separatorIndex = group.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === group.length - 1) {
      throw new Error("TRONSCAN_API_KEY_GROUPS must use group:key1,key2 entries separated by semicolons");
    }
    const groupId = group.slice(0, separatorIndex).trim();
    const keys = group.slice(separatorIndex + 1).split(",").map((key) => key.trim()).filter((key) => key.length > 0);
    if (!groupId || keys.length === 0) {
      throw new Error("TRONSCAN_API_KEY_GROUPS must use group:key1,key2 entries separated by semicolons");
    }
    for (const key of keys) {
      if (!knownKeys.has(key)) {
        throw new Error(`TRONSCAN_API_KEY_GROUPS contains key not present in TRONSCAN_API_KEY: ${key}`);
      }
    }
    return { groupId, apiKeys: [...new Set(keys)] };
  });

  const assigned = new Set(parsed.flatMap((group) => group.apiKeys));
  const missing = apiKeys.filter((key) => !assigned.has(key));
  return missing.length > 0
    ? [...parsed, { groupId: "default", apiKeys: missing }]
    : parsed;
}
```

- [ ] **Step 5: Wire config defaults**

In `loadConfig`, after `const tronscanApiKeys = ...`, add:

```ts
  const tronscanApiKeyGroups = parseTronscanApiKeyGroups(process.env.TRONSCAN_API_KEY_GROUPS, tronscanApiKeys);
```

In the returned object, add:

```ts
    tronscanApiKeyGroups,
    tronscanAccountGroupRequestMinIntervalMs: parsePositiveInteger(
      "TRONSCAN_ACCOUNT_GROUP_REQUEST_MIN_INTERVAL_MS",
      process.env.TRONSCAN_ACCOUNT_GROUP_REQUEST_MIN_INTERVAL_MS ?? "250",
      0
    ),
```

In the default config test, add:

```ts
    expect(config.tronscanApiKeyGroups).toEqual([]);
    expect(config.tronscanAccountGroupRequestMinIntervalMs).toBe(250);
```

In the explicit polling settings test, add:

```ts
      TRONSCAN_ACCOUNT_GROUP_REQUEST_MIN_INTERVAL_MS: "375",
```

and assert:

```ts
    expect(config.tronscanAccountGroupRequestMinIntervalMs).toBe(375);
```

- [ ] **Step 6: Run config tests**

Run:

```bash
npm test -- tests/config/config.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/config.ts tests/config/config.test.ts
git commit -m "feat: configure tronscan api key groups"
```

---

### Task 7: Enforce Account Group Budget In Scheduler

**Files:**

- Modify: `src/tron/tronscanScheduler.ts`
- Modify: `tests/tron/tronscanScheduler.test.ts`

- [ ] **Step 1: Add failing scheduler group tests**

Append these tests to `tests/tron/tronscanScheduler.test.ts`:

```ts
  it("does not let keys in one account group multiply the group request budget", async () => {
    const delays: number[] = [];
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      accountGroupRequestMinIntervalMs: 250,
      rateLimitCooldownMs: 250,
      apiKeys: ["key-a", "key-b"],
      apiKeyGroups: [{ groupId: "main", apiKeys: ["key-a", "key-b"] }],
      now: () => now,
      delay: async (ms) => {
        delays.push(ms);
        now += ms;
      }
    });
    const events: string[] = [];
    const keys: Array<string | null> = [];

    await Promise.all([
      scheduler.schedule({ requestName: "a", path: "/a" }, async (context) => {
        events.push(`a@${now}`);
        keys.push(context.apiKey);
        return "a";
      }),
      scheduler.schedule({ requestName: "b", path: "/b" }, async (context) => {
        events.push(`b@${now}`);
        keys.push(context.apiKey);
        return "b";
      })
    ]);

    expect(keys).toEqual(["key-a", "key-b"]);
    expect(events).toEqual(["a@1000", "b@1250"]);
    expect(delays).toEqual([250]);
  });

  it("lets different account groups use independent group budgets", async () => {
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      accountGroupRequestMinIntervalMs: 250,
      rateLimitCooldownMs: 250,
      apiKeys: ["key-a", "key-b"],
      apiKeyGroups: [
        { groupId: "main", apiKeys: ["key-a"] },
        { groupId: "backup", apiKeys: ["key-b"] }
      ],
      now: () => 1_000,
      delay: async () => undefined
    });
    const keys: Array<string | null> = [];

    await Promise.all([
      scheduler.schedule({ requestName: "a", path: "/a" }, async (context) => {
        keys.push(context.apiKey);
        return "a";
      }),
      scheduler.schedule({ requestName: "b", path: "/b" }, async (context) => {
        keys.push(context.apiKey);
        return "b";
      })
    ]);

    expect(keys).toEqual(["key-a", "key-b"]);
  });
```

- [ ] **Step 2: Run scheduler group tests and verify they fail**

Run:

```bash
npm test -- tests/tron/tronscanScheduler.test.ts -t "account group"
```

Expected: FAIL because scheduler options do not include account groups.

- [ ] **Step 3: Add scheduler group types**

In `src/tron/tronscanScheduler.ts`, add:

```ts
export type TronscanApiKeyGroup = {
  groupId: string;
  apiKeys: readonly string[];
};
```

Extend `TronscanSchedulerOptions`:

```ts
  apiKeyGroups?: readonly TronscanApiKeyGroup[];
  accountGroupRequestMinIntervalMs?: number;
```

Extend `TronscanSchedulerDiagnostics`:

```ts
  apiKeyGroupCount: number;
  accountGroupCooldownUntilMs: Record<string, number>;
```

Extend `ApiKeySlot`:

```ts
  groupId: string;
```

Add:

```ts
type AccountGroupState = {
  nextRequestAtMs: number;
  cooldownUntilMs: number;
};
```

- [ ] **Step 4: Build key-to-group mapping**

In `createTronscanScheduler`, add this helper before `const slots`:

```ts
  const accountGroupRequestMinIntervalMs = Math.max(0, options.accountGroupRequestMinIntervalMs ?? 0);
  const groupByKey = new Map<string, string>();
  for (const group of options.apiKeyGroups ?? []) {
    for (const apiKey of group.apiKeys) {
      groupByKey.set(apiKey, group.groupId);
    }
  }
```

When building API-key slots, set:

```ts
        groupId: groupByKey.get(apiKey) ?? "default",
```

For the no-key slot, set:

```ts
        groupId: "default",
```

After slot creation, add:

```ts
  const accountGroupState: Record<string, AccountGroupState> = Object.fromEntries(
    [...new Set(slots.map((slot) => slot.groupId))].map((groupId) => [groupId, { nextRequestAtMs: 0, cooldownUntilMs: 0 }])
  );
```

- [ ] **Step 5: Gate dispatch by account group**

In `slotReadyAtMs`, add:

```ts
    accountGroupState[slot.groupId]?.nextRequestAtMs ?? 0,
    accountGroupState[slot.groupId]?.cooldownUntilMs ?? 0,
```

In `drain`, after `const scopedGlobalState = scopeState[scope];`, add:

```ts
        const groupState = accountGroupState[slot.groupId];
```

Then after `slot.nextRequestAtMs = ...`, add:

```ts
        groupState.nextRequestAtMs = dispatchNow + accountGroupRequestMinIntervalMs;
```

In the `429` handling block, after computing `cooldownUntilMs`, add:

```ts
            const groupState = accountGroupState[slot.groupId];
            groupState.cooldownUntilMs = Math.max(groupState.cooldownUntilMs, cooldownUntilMs);
```

- [ ] **Step 6: Expose group diagnostics without keys**

Update `diagnostics()` to include:

```ts
        apiKeyGroupCount: Object.keys(accountGroupState).length,
        accountGroupCooldownUntilMs: Object.fromEntries(
          Object.entries(accountGroupState).map(([groupId, state]) => [groupId, state.cooldownUntilMs])
        ),
```

- [ ] **Step 7: Run scheduler tests**

Run:

```bash
npm test -- tests/tron/tronscanScheduler.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

```bash
git add src/tron/tronscanScheduler.ts tests/tron/tronscanScheduler.test.ts
git commit -m "feat: enforce tronscan account group pacing"
```

---

### Task 8: Wire Account Group Budget Into Runtime

**Files:**

- Modify: `src/index.ts`
- Modify: `src/tron/tronClient.ts`

- [ ] **Step 1: Wire app scheduler options**

In `src/index.ts`, update `createTronscanScheduler` options:

```ts
  apiKeys: config.tronscanApiKeys,
  apiKeyGroups: config.tronscanApiKeyGroups,
  accountGroupRequestMinIntervalMs: config.tronscanAccountGroupRequestMinIntervalMs
```

- [ ] **Step 2: Extend fallback client options**

In `src/tron/tronClient.ts`, extend `TronscanClientOptions` with:

```ts
  apiKeyGroups?: readonly TronscanApiKeyGroup[];
  accountGroupRequestMinIntervalMs?: number;
```

Import the type from `./tronscanScheduler`:

```ts
import type { TronscanApiKeyGroup } from "./tronscanScheduler";
```

In the fallback `createTronscanScheduler` call, add:

```ts
      apiKeyGroups: normalizedOptions.apiKeyGroups,
      accountGroupRequestMinIntervalMs: normalizedOptions.accountGroupRequestMinIntervalMs,
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run scheduler and config tests together**

Run:

```bash
npm test -- tests/config/config.test.ts tests/tron/tronscanScheduler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 8**

```bash
git add src/index.ts src/tron/tronClient.ts
git commit -m "feat: wire tronscan group budget into runtime"
```

---

### Task 9: Add Run Profile And Provider Coverage Reporting

**Files:**

- Modify: `src/check/deepForensicCheck.ts`
- Modify: `tests/check/deepForensicCheck.test.ts`
- Modify: `src/types.ts`
- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add run profile fields to Deep report type**

In `src/check/deepForensicCheck.ts`, extend `DeepAddressForensicReport` with:

```ts
  runProfile: "bounded_rerun" | "production_full";
  providerBudget: {
    providerCallBudget: number | null;
    transferCallBudget: number | null;
    contractCallBudget: number | null;
    approvalCallBudget: number | null;
    elapsedTimeBudgetMs: number | null;
    exhausted: boolean;
  };
```

- [ ] **Step 2: Add failing Deep report test**

In `tests/check/deepForensicCheck.test.ts`, add:

```ts
  it("reports the forensic run profile and provider budget state", async () => {
    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async () => []
      },
      getLabelsForAddress: async () => []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0,
      runProfile: "bounded_rerun",
      providerCallBudget: 20,
      transferCallBudget: 10,
      contractCallBudget: 0,
      approvalCallBudget: 0,
      elapsedTimeBudgetMs: 30_000
    });

    expect(report.runProfile).toBe("bounded_rerun");
    expect(report.providerBudget).toEqual({
      providerCallBudget: 20,
      transferCallBudget: 10,
      contractCallBudget: 0,
      approvalCallBudget: 0,
      elapsedTimeBudgetMs: 30000,
      exhausted: false
    });
  });
```

- [ ] **Step 3: Run Deep test and verify it fails**

Run:

```bash
npm test -- tests/check/deepForensicCheck.test.ts -t "run profile"
```

Expected: FAIL because the input/output fields do not exist.

- [ ] **Step 4: Extend Deep input options**

In `RunDeepAddressForensicCheckInput`, add:

```ts
  runProfile?: "bounded_rerun" | "production_full";
  providerCallBudget?: number | null;
  transferCallBudget?: number | null;
  contractCallBudget?: number | null;
  approvalCallBudget?: number | null;
  elapsedTimeBudgetMs?: number | null;
```

When returning the report, add:

```ts
    runProfile: input.runProfile ?? "production_full",
    providerBudget: {
      providerCallBudget: input.providerCallBudget ?? null,
      transferCallBudget: input.transferCallBudget ?? null,
      contractCallBudget: input.contractCallBudget ?? null,
      approvalCallBudget: input.approvalCallBudget ?? null,
      elapsedTimeBudgetMs: input.elapsedTimeBudgetMs ?? null,
      exhausted: false
    },
```

- [ ] **Step 5: Surface run profile in final report**

In `src/bot/createBot.ts`, add this line to `unifiedRiskBreakdownLines` when `deepReport` is available. If `unifiedRiskBreakdownLines` cannot access `deepReport`, pass it in from `formatUnifiedAddressFinalReport`:

```ts
    input.deepReport
      ? `Run profile: ${input.deepReport.runProfile ?? "production_full"}.`
      : null
```

Keep null filtering with the existing message-building style.

- [ ] **Step 6: Add formatter assertion**

In the Task 2 formatter test, add:

```ts
    expect(message.text).toContain("Run profile:");
```

- [ ] **Step 7: Run related tests**

Run:

```bash
npm test -- tests/check/deepForensicCheck.test.ts tests/bot/createBot.test.ts -t "run profile|score anchor"
```

Expected: PASS.

- [ ] **Step 8: Commit Task 9**

```bash
git add src/check/deepForensicCheck.ts tests/check/deepForensicCheck.test.ts src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: report forensic run profile and provider budget"
```

---

### Task 10: Add Fixture-Based Calibration Cases

**Files:**

- Modify: `tests/risk/unifiedWalletRisk.test.ts`
- Modify: `docs/project-walkthrough/03-three-address-score-comparison.md`
- Create: `docs/project-walkthrough/04-unified-wallet-risk-scoring-v2.md`

- [ ] **Step 1: Add calibration tests for the three observed addresses**

In `tests/risk/unifiedWalletRisk.test.ts`, add this `describe` block:

```ts
describe("unified wallet risk v2 calibration cases", () => {
  it("keeps TLh-like historical transit wallet HIGH through Deep pattern floor", () => {
    const result = calculateUnifiedWalletRisk({
      address: "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe",
      fastReport: fastReport(0),
      deepReport: deepReport({
        operationalFlowProfiles: [operationalFlowProfile()]
      }),
      whereReport: whereReport(31, { userDecision: "DECLINE" })
    });

    expect(result.finalScore).toBe(81);
    expect(result.finalLevel).toBe("HIGH");
    expect(result.finalDecision).toBe("DECLINE");
    expect(result.scoreBreakdown.activeAnchor?.code).toBe("historical_transit_pattern");
  });

  it("keeps TYs-like verified continuation wallet HIGH through asset continuation floor", () => {
    const result = calculateUnifiedWalletRisk({
      address: "TYs4UuvnUHr8D744bURoKWqfNA2TNJEXi7",
      fastReport: fastReport(0),
      deepReport: deepReportWithAssetContinuation(assetContinuationProfile({ score: 84 })),
      whereReport: whereReport(70, {
        userDecision: "DECLINE",
        assessment: whereAssessment(70, {
          sourcePolicyEvidence: [sourcePolicyEvidence(70)],
          riskLayers: [sourcePolicyLayer(70)],
          dominantRiskLayer: sourcePolicyLayer(70)
        })
      })
    });

    expect(result.finalScore).toBe(84);
    expect(result.finalLevel).toBe("HIGH");
    expect(result.finalDecision).toBe("DECLINE");
    expect(result.scoreBreakdown.activeAnchor?.code).toBe("asset_continuation_floor");
  });

  it("keeps TPv-like policy wallet HIGH through policy floor", () => {
    const result = calculateUnifiedWalletRisk({
      address: "TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb",
      fastReport: fastReport(0),
      deepReport: deepReport({ counterpartyRiskProfiles: [counterpartyRiskProfile({ score: 65 })] }),
      whereReport: whereReport(70, {
        userDecision: "DECLINE",
        assessment: whereAssessment(70, {
          sourcePolicyEvidence: [sourcePolicyEvidence(70)],
          riskLayers: [sourcePolicyLayer(70)],
          dominantRiskLayer: sourcePolicyLayer(70)
        })
      })
    });

    expect(result.finalScore).toBeGreaterThanOrEqual(70);
    expect(result.finalScore).toBeLessThan(85);
    expect(result.finalLevel).toBe("HIGH");
    expect(result.finalDecision).toBe("DECLINE");
  });
});
```

- [ ] **Step 2: Run calibration tests**

Run:

```bash
npm test -- tests/risk/unifiedWalletRisk.test.ts -t "calibration cases"
```

Expected: PASS.

- [ ] **Step 3: Create v2 walkthrough doc**

Create `docs/project-walkthrough/04-unified-wallet-risk-scoring-v2.md`:

```md
# Unified Wallet Risk Scoring v2

This note records the implementation behavior for unified wallet scoring v2.

## What Changed

The system still returns one final wallet score, one final level, and one final decision.

The score report now exposes the active anchor:

```text
weightedLayerScore
contextScore
floors
activeAnchor
dampener
coverageLevel
finalScore
finalDecision
```

## Why This Matters

Weighted layer math is the baseline. Strong evidence anchors can raise the final score above the baseline.

For example, a wallet can have:

```text
weightedLayerScore: 42
patternFloor: 81
finalScore: 81
```

That is expected when Deep Research found a strong historical pass-through pattern.

## Deep Historical Flow

Deep Research stores `historicalTransitScore` on `OperationalFlowProfile`.

The score uses:

```text
volumeScore
passThroughScore
serviceShareScore
```

Bridge, swap, router, and DEX exposure is not treated as hard proof by itself. It becomes a strong pattern only when combined with material volume and high pass-through behavior.

## Provider Budgeting

TronScan API keys can be grouped by provider account:

```text
TRONSCAN_API_KEY_GROUPS=main:key1,key2;backup:key3
```

If no groups are configured, all keys are treated as one default group. This prevents the app from accidentally multiplying provider quota when two keys belong to the same account.
```

- [ ] **Step 4: Update three-address comparison doc**

Append this note to `docs/project-walkthrough/03-three-address-score-comparison.md`:

```md

## v2 Follow-Up

Unified scoring v2 makes the active score anchor explicit in the report.

For the observed fresh bounded rerun:

- `TLh...` is anchored by `historical_transit_pattern`.
- `TYs...` is anchored by asset continuation / policy evidence.
- `TPv...` stays HIGH through Deep and policy floor context.

This does not introduce multiple final scores. It explains why the one final score reached its value.
```

- [ ] **Step 5: Commit Task 10**

```bash
git add tests/risk/unifiedWalletRisk.test.ts docs/project-walkthrough/03-three-address-score-comparison.md docs/project-walkthrough/04-unified-wallet-risk-scoring-v2.md
git commit -m "test: add unified wallet risk calibration cases"
```

---

### Task 11: Final Verification

**Files:**

- No new files.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run focused test suite**

Run:

```bash
npm test -- tests/risk/unifiedWalletRisk.test.ts tests/forensics/historicalTransitScore.test.ts tests/forensics/flowCounterpartyProfile.test.ts tests/check/deepForensicCheck.test.ts tests/tron/tronscanScheduler.test.ts tests/config/config.test.ts tests/bot/createBot.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Check docs and formatting**

Run:

```bash
git diff --check
```

Expected: no output and exit code `0`.

- [ ] **Step 5: Inspect final git status**

Run:

```bash
git status --short
```

Expected: either clean status or only intentionally unstaged notes from the current operator.

---

## Implementation Notes For Subagents

- Do not create a second user-facing score.
- Do not hardcode `jUSDT`; asset continuation remains generic verified/known TRC20 continuation.
- Do not treat bridge/swap/router usage alone as scam.
- Keep `finalScore <= 84` when `hardEvidenceFloor` is `0`.
- Preserve `finalDecision = DECLINE` when `Where Is Money` already returned user-facing decline.
- Keep provider keys out of diagnostics and logs.
- Every task should land with its own commit before the next task starts.

## Self-Review

Spec coverage:

- Single final score: Tasks 1, 2, 5, and 10 preserve one scorer and one formatter output.
- Evidence anchors: Tasks 1 and 5 expose and align active anchors.
- Deep historical flow: Tasks 3, 4, and 5 implement score alignment and persisted profile fields.
- Provider budgeting: Tasks 6, 7, and 8 implement config, scheduler gates, and runtime wiring.
- Run profile and provider coverage: Task 9 exposes the reporting surface.
- Calibration cases: Task 10 adds fixture-based calibration and docs.

Placeholder scan:

- The plan avoids unresolved marker words, placeholder functions, and deferred test descriptions.
- Each task has concrete files, commands, and expected results.

Type consistency:

- `historicalTransitScore` and `historicalTransitBreakdown` are added to `OperationalFlowProfile` before test fixtures require them.
- `scoreBreakdown` is added to `UnifiedWalletRiskResult` before formatter code consumes it.
- `apiKeyGroups` and `accountGroupRequestMinIntervalMs` are added to config before runtime wiring consumes them.
