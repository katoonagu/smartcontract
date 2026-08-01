# Final Scoring Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the final evidence-first scoring architecture from `docs/superpowers/specs/2026-05-31-final-scoring-architecture-design.md`.

**Architecture:** Introduce typed risk layers and a shared weighted source-exposure scorer. Keep deterministic hard proof isolated from source-policy risk, use path context and operational dampening for non-hard evidence, and make where-is-money plus incoming deposits consume the same scoring semantics.

**Tech Stack:** TypeScript, Vitest, existing TRON USDT forensic modules, existing `WhereIsMoneyReport`/`MoneyOriginPath` types, existing LLM contract verdict pipeline.

---

## Implementation Principles

1. Do not create a second final decision engine.
2. Do not parse reason text to infer proof or source kind.
3. Do not put HTX/Huobi, WhiteBIT, bridge/router/DEX, cross-chain, unknown contract, unknown origin, coverage gap, or LLM suspicion into `hardBadEvidence`.
4. Keep `hardBadEvidence` for deterministic proof only:
   - scam/stolen/phishing/blacklist label;
   - USDT blacklist;
   - exact approval -> transferFrom -> funds reach checked wallet/deposit receiver;
   - confirmed deterministic stolen/scam cluster if such label exists.
5. Source-policy can still produce `DECLINE`, but wording must say source-policy risk, not scam/drain proof.
6. LLM verdicts classify contracts/scenarios; they do not create blockchain facts.
7. Where-is-money, low-balance recent-flow, incoming deposit and deep forensic report shaping must use the same evidence classes and source-exposure metadata.

## Execution Order

```text
Task 1: Types and proof/evidence model
Task 2: Weighted provenance scoring module
Task 3: Money origin policy source metadata
Task 4: Operational assessment refactor
Task 5: Trace early-break correctness
Task 6: Incoming deposit consistency
Task 7: Proof level and report wording
Task 8: LLM / approval-drain guard tightening
Task 9: Regression and live smoke
```

Commit after every task. Run focused tests after each task and full tests at Task 9.

---

## File Map

**Create**

- `src/forensics/provenanceScoring.ts`
  - Owns weighted source exposure scoring, path link strength, caps/floors, source aggregation and structured risk layer helpers.

- `tests/forensics/provenanceScoring.test.ts`
  - Unit tests for source share curves, hop/time/amount modifiers, caps/floors, operational dampening and aggregate scoring.

**Modify**

- `src/types.ts`
  - Add `EvidenceClass`, `SourceExposureKind`, `RiskLayerScore`, `SourcePolicyEvidence`, and optional structured scoring fields on `MoneyOriginPath` and `WhereIsMoneyAssessment`.

- `src/forensics/moneyOriginPolicy.ts`
  - Stop fixed HTX/Huobi `78`; attach source exposure metadata and preliminary share-based score.
  - Make WhiteBIT source-policy, not hard evidence.

- `src/forensics/moneyOriginOperationalAssessment.ts`
  - Split hard proof collection from source policy, contract suspicion, unknown origin, behavior and data quality layers.
  - Use `scoreSourceExposures()`.
  - Apply operational dampening only to eligible evidence.

- `src/forensics/moneyOriginTrace.ts`
  - Stop early only for deterministic hard proof terminals, not any `DECLINE`.

- `src/check/whereIsMoneyCheck.ts`
  - Derive proof level from structured assessment/risk layers, not reason text.
  - Ensure report wording uses evidence class and source-policy kind.

- `src/forensics/incomingDepositJob.ts`
  - Replace broad `REVIEW` -> `DECLINE` and `decline_boundary` -> `hard_decline` mapping.
  - Reuse weighted scoring outputs and expose raw/effective share, continuity, source kind and proof level.

- `src/risk/riskPolicyEngine.ts`
  - Remove or neutralize duplicate fixed HTX/Huobi `scoreAtLeast(78)` rules if present.

- `src/forensics/contractLlmVerdict.ts`
  - Ensure LLM unavailable/drainer_like/legitimate_service maps to contextual layers only.

- `src/forensics/approvalDrainProvenance.ts`
  - Ensure route-linked profiles do not claim exact proof unless exact transferFrom + receiver path requirements are met.

**Modify tests**

- `tests/forensics/moneyOriginPolicy.test.ts`
- `tests/forensics/moneyOriginOperationalAssessment.test.ts`
- `tests/forensics/moneyOriginTrace.test.ts` if present; otherwise add coverage near existing trace tests.
- `tests/forensics/incomingDepositJob.test.ts`
- `tests/check/whereIsMoneyCheck.test.ts`
- `tests/risk/riskPolicyEngine.test.ts` if present.
- `tests/forensics/contractLlmVerdict.test.ts`
- `tests/forensics/approvalDrainProvenance.test.ts`
- `tests/fixtures/forensics/regressionCases.ts`

---

## Task 1: Add Typed Evidence And Risk Layer Model

**Files:**
- Modify: `src/types.ts`
- Test: existing typecheck

- [ ] **Step 1: Inspect current type names**

Run:

```bash
rg "ProofLevel|MoneyOriginPath|WhereIsMoneyAssessment|WhereIsMoneyHardBadEvidence|ContractLlmVerdictSummary" src/types.ts src -n
```

Expected:

```text
Current proof levels, money-origin path fields, assessment fields and hard evidence kinds are visible.
```

- [ ] **Step 2: Add evidence and source types**

In `src/types.ts`, add near existing money-origin/where-is-money types:

```ts
export type EvidenceClass =
  | "hard_proof"
  | "source_policy"
  | "contract_suspicion"
  | "unknown_origin"
  | "behavior_context"
  | "data_quality"
  | "dampener"
  | "clean_source";

export type SourceExposureKind =
  | "htx_huobi"
  | "whitebit"
  | "bridge_router_dex"
  | "cross_chain_boundary"
  | "unknown_contract"
  | "unknown_cex"
  | "allowlisted_cex"
  | "risky_label";

export type RiskLayerScore = {
  evidenceClass: EvidenceClass;
  kind: string;
  sourceExposureKind?: SourceExposureKind;
  score: number;
  rawScore: number;
  adjustedScore: number;
  proofLevel: ProofLevel;
  canBeDampened: boolean;
  capApplied?: number;
  floorApplied?: number;
  reasons: string[];
  warnings: string[];
  evidenceIds: string[];
};

export type SourcePolicyEvidence = {
  kind: SourceExposureKind;
  aggregateShare: number;
  effectiveShare: number;
  pathCount: number;
  score: number;
  riskBand: WhereIsMoneyRiskBand;
  proofLevel: ProofLevel;
  canBeDampened: boolean;
  reasons: string[];
  warnings: string[];
  evidenceIds: string[];
  topPath?: {
    hops: number;
    elapsedMs: number | null;
    avgTimePerHopMs: number | null;
    amountContinuity: number;
    linkStrength: number;
  };
};
```

If `ProofLevel` does not yet include a contextual proof value for LLM or policy context, add the minimal values needed by tests:

```ts
| "exchange_policy_context"
| "llm_assisted_suspicion"
```

Only add them if the enum/type does not already have equivalent values.

- [ ] **Step 3: Extend `MoneyOriginPath`**

Add optional structured fields:

```ts
sourceExposureKind?: SourceExposureKind | null;
effectiveExposureShare?: number | null;
linkStrength?: number | null;
scoreBreakdown?: RiskLayerScore[];
```

Keep existing `exposureSourceKey`/`exposureSourceLabel` for backwards compatibility during migration.

- [ ] **Step 4: Extend `WhereIsMoneyAssessment`**

Add:

```ts
sourcePolicyEvidence: SourcePolicyEvidence[];
contractSuspicionEvidence: RiskLayerScore[];
unknownOriginEvidence: RiskLayerScore[];
riskLayers: RiskLayerScore[];
dominantRiskLayer?: RiskLayerScore | null;
```

If existing report construction fails because older paths do not fill these fields, initialize empty arrays in all assessment builders.

- [ ] **Step 5: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: type errors showing all assessment construction sites that need empty defaults.

- [ ] **Step 6: Add empty defaults at construction sites**

Update empty/zero report builders in `src/check/whereIsMoneyCheck.ts` and any test helpers:

```ts
sourcePolicyEvidence: [],
contractSuspicionEvidence: [],
unknownOriginEvidence: [],
riskLayers: [],
dominantRiskLayer: null
```

- [ ] **Step 7: Verify Task 1**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/types.ts src/check/whereIsMoneyCheck.ts tests
git commit -m "feat: add typed forensic risk layers"
```

---

## Task 2: Add Weighted Provenance Scoring Module

**Files:**
- Create: `src/forensics/provenanceScoring.ts`
- Create: `tests/forensics/provenanceScoring.test.ts`

- [ ] **Step 1: Write source scoring tests**

Create `tests/forensics/provenanceScoring.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  aggregateLayerScores,
  amountContinuityAdjustment,
  baseShareScore,
  hopAdjustment,
  scorePathLinkStrength,
  scoreSourceExposures,
  timeAdjustment
} from "../../src/forensics/provenanceScoring";
import type { MoneyOriginPath, WhereIsMoneyAgeSignals } from "../../src/types";

function path(overrides: Partial<MoneyOriginPath>): MoneyOriginPath {
  return {
    verdict: "REVIEW",
    rootSourceType: "decline_boundary",
    stoppedReason: "decline_boundary_reached",
    rootSourceAddress: "TSource111111111111111111111111111",
    balanceTransferTxHash: "tx-balance",
    balanceShare: 0.15,
    riskScoreContribution: 45,
    txHashes: ["tx-source-hop", "tx-hop-subject"],
    pathAddresses: ["TSource111111111111111111111111111", "THop1111111111111111111111111111", "TSubject1111111111111111111111111"],
    steps: [
      {
        txHash: "tx-source-hop",
        fromAddress: "TSource111111111111111111111111111",
        toAddress: "THop1111111111111111111111111111",
        amountRaw: "16000000000",
        timestamp: new Date("2026-05-31T10:00:00.000Z")
      },
      {
        txHash: "tx-hop-subject",
        fromAddress: "THop1111111111111111111111111111",
        toAddress: "TSubject1111111111111111111111111",
        amountRaw: "15000000000",
        timestamp: new Date("2026-05-31T12:00:00.000Z")
      }
    ],
    reasons: ["HTX/Huobi source-policy exposure."],
    exposureSourceKey: "htx_huobi",
    exposureSourceLabel: "HTX/Huobi",
    sourceExposureKind: "htx_huobi",
    ...overrides
  };
}

const noAgeSignals: WhereIsMoneyAgeSignals = {
  observedAgeDays: 30,
  firstSeenAt: new Date("2026-05-01T00:00:00.000Z"),
  lastSeenAt: new Date("2026-05-31T00:00:00.000Z")
};

describe("provenanceScoring", () => {
  it("scores HTX 15 percent operational wallet as ACCEPTABLE medium context", () => {
    const result = scoreSourceExposures({
      originPaths: [path({ balanceShare: 0.15 })],
      walletRole: "operational_liquidity_wallet",
      operationalLiquidityScore: 90,
      cleanCexCoverage: 0.75,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals
    });

    const htx = result.sourcePolicyEvidence.find((item) => item.kind === "htx_huobi");
    expect(htx).toBeDefined();
    expect(htx?.score).toBeGreaterThanOrEqual(43);
    expect(htx?.score).toBeLessThanOrEqual(55);
    expect(result.sourcePolicyScore).toBeLessThan(60);
  });

  it("scores HTX 15 percent direct fast fresh path as decline-level policy risk", () => {
    const directFast = path({
      balanceShare: 0.15,
      pathAddresses: ["TSource111111111111111111111111111", "TSubject1111111111111111111111111"],
      steps: [{
        txHash: "tx-direct",
        fromAddress: "TSource111111111111111111111111111",
        toAddress: "TSubject1111111111111111111111111",
        amountRaw: "15000000000",
        timestamp: new Date("2026-05-31T10:00:00.000Z")
      }]
    });

    const result = scoreSourceExposures({
      originPaths: [directFast],
      walletRole: "fresh_one_shot_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: { ...noAgeSignals, observedAgeDays: 1 }
    });

    expect(result.sourcePolicyScore).toBeGreaterThanOrEqual(60);
    expect(result.sourcePolicyScore).toBeLessThanOrEqual(75);
  });

  it("keeps majority HTX as high source-policy decline", () => {
    const result = scoreSourceExposures({
      originPaths: [path({ balanceShare: 0.62 })],
      walletRole: "unknown",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals
    });

    expect(result.sourcePolicyScore).toBeGreaterThanOrEqual(78);
  });

  it("caps weak amount continuity below hard-like scores", () => {
    const weak = path({
      balanceShare: 0.25,
      steps: [
        {
          txHash: "tx-source-hop",
          fromAddress: "TSource111111111111111111111111111",
          toAddress: "THop1111111111111111111111111111",
          amountRaw: "100000000000",
          timestamp: new Date("2026-05-31T10:00:00.000Z")
        },
        {
          txHash: "tx-hop-subject",
          fromAddress: "THop1111111111111111111111111111",
          toAddress: "TSubject1111111111111111111111111",
          amountRaw: "5000000000",
          timestamp: new Date("2026-05-31T10:20:00.000Z")
        }
      ]
    });

    const result = scoreSourceExposures({
      originPaths: [weak],
      walletRole: "unknown",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals
    });

    expect(result.sourcePolicyScore).toBeLessThanOrEqual(55);
  });

  it("does not let multiple weak source scores explode", () => {
    expect(aggregateLayerScores([52, 38, 35])).toBe(59);
  });
});
```

Adjust `walletRole` string literals to the current `WhereIsMoneyWalletRole` union if names differ.

- [ ] **Step 2: Run the new tests and verify failure**

Run:

```bash
npm test -- tests/forensics/provenanceScoring.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement scoring module**

Create `src/forensics/provenanceScoring.ts`:

```ts
import type {
  MoneyOriginPath,
  RiskLayerScore,
  SourceExposureKind,
  SourcePolicyEvidence,
  WhereIsMoneyAgeSignals,
  WhereIsMoneyRiskBand,
  WhereIsMoneyWalletRole
} from "../types";

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function finiteShare(value: number | null | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.min(1, value ?? 0) : 0;
}

function pathKind(path: MoneyOriginPath): SourceExposureKind | null {
  if (path.sourceExposureKind) return path.sourceExposureKind;
  const text = [path.exposureSourceKey, path.exposureSourceLabel, path.reasons.join(" ")].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("htx") || text.includes("huobi")) return "htx_huobi";
  if (text.includes("whitebit")) return "whitebit";
  if (/\b(bridge|router|dex|swap)\b/.test(text)) return "bridge_router_dex";
  if (text.includes("cross-chain") || text.includes("layerzero") || text.includes("oft")) return "cross_chain_boundary";
  if (text.includes("unknown contract") || text.includes("contract boundary")) return "unknown_contract";
  if (path.rootSourceType === "allowlist_cex") return "allowlisted_cex";
  if (path.rootSourceType === "risky_label") return "risky_label";
  return null;
}

export function riskBandFromScore(score: number): WhereIsMoneyRiskBand {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 45) return "MEDIUM";
  if (score >= 20) return "LOW-MEDIUM";
  return "LOW";
}

export function baseShareScore(kind: SourceExposureKind, share: number): number {
  const s = finiteShare(share);
  if (kind === "htx_huobi") {
    if (s >= 0.8) return 85;
    if (s >= 0.5) return 78;
    if (s >= 0.3) return 68;
    if (s >= 0.2) return 54;
    if (s >= 0.1) return 45;
    if (s >= 0.05) return 30;
    return s > 0 ? 18 : 0;
  }
  if (kind === "whitebit") {
    if (s >= 0.5) return 60;
    if (s >= 0.3) return 52;
    if (s >= 0.1) return 38;
    return s > 0 ? 24 : 0;
  }
  if (kind === "bridge_router_dex" || kind === "cross_chain_boundary") {
    if (s >= 0.5) return 70;
    if (s >= 0.2) return 62;
    return s > 0 ? 55 : 0;
  }
  if (kind === "unknown_contract") {
    if (s >= 0.5) return 55;
    if (s >= 0.2) return 45;
    return s > 0 ? 35 : 0;
  }
  if (kind === "unknown_cex") return s >= 0.5 ? 50 : 40;
  if (kind === "allowlisted_cex") return 5;
  if (kind === "risky_label") return 90;
  return 0;
}

function pathHops(path: MoneyOriginPath): number {
  if (path.steps.length > 0) return Math.max(0, path.steps.length - 1);
  if (path.pathAddresses.length > 0) return Math.max(0, path.pathAddresses.length - 2);
  return 0;
}

function stepTimeMs(path: MoneyOriginPath): number | null {
  const timestamps = path.steps
    .map((step) => step.timestamp?.getTime?.() ?? null)
    .filter((value): value is number => Number.isFinite(value));
  if (timestamps.length < 2) return null;
  return Math.max(...timestamps) - Math.min(...timestamps);
}

function amountPreservation(path: MoneyOriginPath): number {
  const amounts = path.steps
    .map((step) => /^\d+$/.test(step.amountRaw) ? BigInt(step.amountRaw) : 0n)
    .filter((amount) => amount > 0n);
  if (amounts.length < 2) return 1;
  const first = amounts[0] ?? 0n;
  const last = amounts[amounts.length - 1] ?? 0n;
  if (first <= 0n) return 1;
  return Number((last * 10_000n) / first) / 10_000;
}

export function hopAdjustment(hops: number, avgTimePerHopMs: number | null, continuity: number): number {
  let adjustment = 0;
  if (hops <= 0) adjustment = 14;
  else if (hops === 1) adjustment = 12;
  else if (hops === 2) adjustment = 8;
  else if (hops <= 5) adjustment = 2;
  else if (hops <= 12) adjustment = -6;
  else adjustment = -12;

  if (adjustment < 0 && avgTimePerHopMs !== null && continuity >= 0.8 && avgTimePerHopMs <= 3_600_000) {
    return Math.round(adjustment * 0.25);
  }
  if (adjustment < 0 && avgTimePerHopMs !== null && continuity >= 0.7 && avgTimePerHopMs <= 86_400_000) {
    return Math.round(adjustment * 0.5);
  }
  if (avgTimePerHopMs !== null && avgTimePerHopMs > 7 * 86_400_000 && adjustment <= 0) {
    return adjustment - 4;
  }
  return adjustment;
}

export function timeAdjustment(elapsedMs: number | null): number {
  if (elapsedMs === null) return 0;
  const minutes = elapsedMs / 60_000;
  if (minutes <= 10) return 12;
  if (minutes <= 60) return 10;
  if (minutes <= 360) return 7;
  if (minutes <= 1_440) return 4;
  if (minutes <= 10_080) return 0;
  if (minutes <= 43_200) return -5;
  return -12;
}

export function amountContinuityAdjustment(ratio: number): number {
  if (ratio >= 0.95) return 8;
  if (ratio >= 0.9) return 6;
  if (ratio >= 0.7) return 3;
  if (ratio >= 0.4) return -6;
  return -12;
}

function walletRoleAdjustment(role: WhereIsMoneyWalletRole, operationalLiquidityScore: number, cleanCexCoverage: number): number {
  if (role === "fresh_one_shot_wallet") return 10;
  if (role === "mule_wallet" || role === "transit_wallet") return 12;
  if (role === "collector") return 6;
  if (role === "operational_liquidity_wallet") {
    if (cleanCexCoverage >= 0.9) return -15;
    if (cleanCexCoverage >= 0.7) return -12;
    return operationalLiquidityScore >= 80 ? -12 : -9;
  }
  if (role === "exchange_like_wallet" || role === "service_wallet") return -12;
  return 0;
}

function hopFactor(hops: number): number {
  if (hops <= 0) return 1.15;
  if (hops === 1) return 1.10;
  if (hops === 2) return 1.00;
  if (hops <= 5) return 0.85;
  if (hops <= 12) return 0.65;
  return 0.45;
}

function timeFactor(totalTimeMs: number | null): number {
  if (totalTimeMs === null) return 0.90;
  const hours = totalTimeMs / 3_600_000;
  if (hours <= 1) return 1.15;
  if (hours <= 24) return 1.05;
  if (hours <= 24 * 7) return 0.90;
  if (hours <= 24 * 30) return 0.75;
  return 0.55;
}

function amountFactor(ratio: number): number {
  if (ratio >= 0.95) return 1.10;
  if (ratio >= 0.90) return 1.05;
  if (ratio >= 0.70) return 1.00;
  if (ratio >= 0.40) return 0.70;
  return 0.45;
}

export function scorePathLinkStrength(path: MoneyOriginPath): number {
  const hops = pathHops(path);
  const elapsedMs = stepTimeMs(path);
  const continuity = amountPreservation(path);
  return Math.max(0.25, Math.min(1.25, hopFactor(hops) * timeFactor(elapsedMs) * amountFactor(continuity)));
}

function repeatedExposureAdjustment(pathCount: number): number {
  if (pathCount >= 4) return 8;
  if (pathCount >= 2) return 5;
  return 0;
}

function dataQualityAdjustment(coverageCompleteness: number): number {
  if (coverageCompleteness >= 0.9) return 0;
  if (coverageCompleteness >= 0.7) return 3;
  if (coverageCompleteness >= 0.5) return 6;
  if (coverageCompleteness >= 0.3) return 10;
  return 15;
}

function capSourceScore(input: {
  kind: SourceExposureKind;
  score: number;
  aggregateShare: number;
  bestContinuity: number;
  hasDirectFastFreshPath: boolean;
  pathCount: number;
}): number {
  if (input.kind === "risky_label") return Math.max(input.score, 90);
  if (input.bestContinuity < 0.4 && input.aggregateShare < 0.5 && !input.hasDirectFastFreshPath && input.pathCount < 2) {
    return Math.min(input.score, 55);
  }
  if (input.kind === "htx_huobi" && input.aggregateShare >= 0.5) return Math.max(input.score, 78);
  if (input.kind === "unknown_contract") return Math.min(input.score, 75);
  if (input.kind === "whitebit") return Math.min(input.score, 68);
  return input.score;
}

export function aggregateLayerScores(scores: number[]): number {
  const sorted = [...scores].sort((a, b) => b - a);
  const first = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;
  const third = sorted[2] ?? 0;
  return clamp(first + Math.min(10, second * 0.15) + Math.min(5, third * 0.05));
}

export type ScoreSourceExposuresInput = {
  originPaths: MoneyOriginPath[];
  walletRole: WhereIsMoneyWalletRole;
  operationalLiquidityScore: number;
  cleanCexCoverage: number;
  coverageCompleteness: number;
  provenanceConfidence: number;
  ageSignals: WhereIsMoneyAgeSignals | null;
};

export type ScoreSourceExposuresResult = {
  sourcePolicyEvidence: SourcePolicyEvidence[];
  sourcePolicyScore: number;
  riskLayers: RiskLayerScore[];
  warnings: string[];
};

export function scoreSourceExposures(input: ScoreSourceExposuresInput): ScoreSourceExposuresResult {
  const grouped = new Map<SourceExposureKind, MoneyOriginPath[]>();
  for (const path of input.originPaths) {
    const kind = pathKind(path);
    if (!kind || kind === "allowlisted_cex" || kind === "risky_label") continue;
    grouped.set(kind, [...(grouped.get(kind) ?? []), path]);
  }

  const sourcePolicyEvidence: SourcePolicyEvidence[] = [];
  const riskLayers: RiskLayerScore[] = [];

  for (const [kind, paths] of grouped) {
    const rawShare = Math.min(1, paths.reduce((sum, path) => sum + finiteShare(path.balanceShare), 0));
    const enriched = paths.map((path) => {
      const linkStrength = scorePathLinkStrength(path);
      const hops = pathHops(path);
      const elapsedMs = stepTimeMs(path);
      const continuity = amountPreservation(path);
      return {
        path,
        linkStrength,
        hops,
        elapsedMs,
        avgTimePerHopMs: hops > 0 && elapsedMs !== null ? elapsedMs / hops : elapsedMs,
        continuity,
        effectiveShare: finiteShare(path.balanceShare) * linkStrength
      };
    });

    const effectiveShare = Math.min(1, enriched.reduce((sum, item) => sum + item.effectiveShare, 0));
    const curveShare = kind === "htx_huobi" && rawShare >= 0.5 ? rawShare : Math.max(rawShare * 0.75, effectiveShare);
    const base = baseShareScore(kind, curveShare);
    const best = [...enriched].sort((a, b) => {
      const left = hopAdjustment(a.hops, a.avgTimePerHopMs, a.continuity) + timeAdjustment(a.elapsedMs) + amountContinuityAdjustment(a.continuity);
      const right = hopAdjustment(b.hops, b.avgTimePerHopMs, b.continuity) + timeAdjustment(b.elapsedMs) + amountContinuityAdjustment(b.continuity);
      return right - left;
    })[0];
    const bestPathAdjustment = best
      ? hopAdjustment(best.hops, best.avgTimePerHopMs, best.continuity) + timeAdjustment(best.elapsedMs) + amountContinuityAdjustment(best.continuity)
      : 0;
    const roleAdjustment = walletRoleAdjustment(input.walletRole, input.operationalLiquidityScore, input.cleanCexCoverage);
    const rawScore = base + bestPathAdjustment + repeatedExposureAdjustment(paths.length) + dataQualityAdjustment(input.coverageCompleteness) + roleAdjustment;
    const hasDirectFastFreshPath = Boolean(best && best.hops <= 1 && (best.elapsedMs ?? Number.MAX_SAFE_INTEGER) <= 3_600_000 && input.walletRole === "fresh_one_shot_wallet");
    const adjustedScore = clamp(capSourceScore({
      kind,
      score: rawScore,
      aggregateShare: rawShare,
      bestContinuity: Math.max(...enriched.map((item) => item.continuity), 0),
      hasDirectFastFreshPath,
      pathCount: paths.length
    }));
    const proofLevel = adjustedScore >= 60 ? "exchange_policy_decline" : "exchange_policy_context";
    const reasons = [`${kind} exposure is ${Math.round(rawShare * 100)}% raw / ${Math.round(effectiveShare * 100)}% effective; this is source-policy risk, not scam/drain proof.`];
    const warnings = adjustedScore < 60 ? ["Source-policy exposure is below decline threshold after path context and dampening."] : [];

    sourcePolicyEvidence.push({
      kind,
      aggregateShare: rawShare,
      effectiveShare,
      pathCount: paths.length,
      score: adjustedScore,
      riskBand: riskBandFromScore(adjustedScore),
      proofLevel,
      canBeDampened: kind !== "htx_huobi" || rawShare < 0.5,
      reasons,
      warnings,
      evidenceIds: paths.flatMap((path) => path.txHashes),
      topPath: best ? {
        hops: best.hops,
        elapsedMs: best.elapsedMs,
        avgTimePerHopMs: best.avgTimePerHopMs,
        amountContinuity: best.continuity,
        linkStrength: best.linkStrength
      } : undefined
    });

    riskLayers.push({
      evidenceClass: "source_policy",
      kind,
      sourceExposureKind: kind,
      score: adjustedScore,
      rawScore,
      adjustedScore,
      proofLevel,
      canBeDampened: kind !== "htx_huobi" || rawShare < 0.5,
      capApplied: adjustedScore < rawScore ? adjustedScore : undefined,
      floorApplied: adjustedScore > rawScore ? adjustedScore : undefined,
      reasons,
      warnings,
      evidenceIds: paths.flatMap((path) => path.txHashes)
    });
  }

  return {
    sourcePolicyEvidence,
    sourcePolicyScore: aggregateLayerScores(sourcePolicyEvidence.map((item) => item.score)),
    riskLayers,
    warnings: sourcePolicyEvidence.flatMap((item) => item.warnings)
  };
}
```

The code above is intentionally self-contained. During implementation, adjust role string literals and `ProofLevel` values to compile against current project types.

- [ ] **Step 4: Run provenance scoring tests**

Run:

```bash
npm test -- tests/forensics/provenanceScoring.test.ts
npm run typecheck
```

Expected: PASS after adapting type names.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/forensics/provenanceScoring.ts tests/forensics/provenanceScoring.test.ts src/types.ts
git commit -m "feat: add weighted provenance scoring"
```

---

## Task 3: Attach Source Metadata In Money Origin Policy

**Files:**
- Modify: `src/forensics/moneyOriginPolicy.ts`
- Test: `tests/forensics/moneyOriginPolicy.test.ts`

- [ ] **Step 1: Add HTX/Huobi and WhiteBIT source metadata tests**

Update `tests/forensics/moneyOriginPolicy.test.ts`:

```ts
it("classifies HTX/Huobi as source policy metadata instead of fixed hard 78", () => {
  const result = classifyMoneyOriginStop({
    address: "THTX1111111111111111111111111111111",
    labels: [],
    classification: service("cex", "HTX 4"),
    balanceShare: 0.15
  });

  expect(result).toMatchObject({
    verdict: "REVIEW",
    rootSourceType: "decline_boundary",
    stoppedReason: "decline_boundary_reached",
    exposureSourceKey: "htx_huobi",
    exposureSourceLabel: "HTX/Huobi",
    sourceExposureKind: "htx_huobi"
  });
  expect(result?.riskScoreContribution).toBeLessThan(60);
  expect(result?.reasons.join(" ")).toContain("source-policy risk");
  expect(result?.reasons.join(" ")).toContain("not direct scam/blacklist proof");
});

it("keeps majority HTX/Huobi as decline-level source policy", () => {
  const result = classifyMoneyOriginStop({
    address: "THTX1111111111111111111111111111111",
    labels: [],
    classification: service("cex", "Huobi"),
    balanceShare: 0.62
  });

  expect(result).toMatchObject({
    verdict: "DECLINE",
    exposureSourceKey: "htx_huobi",
    sourceExposureKind: "htx_huobi"
  });
  expect(result?.riskScoreContribution).toBeGreaterThanOrEqual(78);
});

it("classifies WhiteBIT as medium source policy, not hard evidence", () => {
  const result = classifyMoneyOriginStop({
    address: "TWhiteBIT11111111111111111111111111",
    labels: [],
    classification: service("cex", "WhiteBIT"),
    balanceShare: 0.15
  });

  expect(result).toMatchObject({
    verdict: "REVIEW",
    exposureSourceKey: "whitebit",
    sourceExposureKind: "whitebit"
  });
  expect(result?.riskScoreContribution).toBeLessThan(50);
});
```

- [ ] **Step 2: Run focused test and verify failure**

Run:

```bash
npm test -- tests/forensics/moneyOriginPolicy.test.ts
```

Expected: FAIL until policy returns structured metadata.

- [ ] **Step 3: Update `MoneyOriginStopClassification`**

In `src/forensics/moneyOriginPolicy.ts`, extend:

```ts
sourceExposureKind?: SourceExposureKind;
```

Import `SourceExposureKind` from `../types`.

- [ ] **Step 4: Replace HTX/Huobi fixed branch**

Use:

```ts
if (hasHighRiskIdentity(text)) {
  const score = baseShareScore("htx_huobi", input.balanceShare);
  return {
    verdict: input.balanceShare >= 0.5 ? "DECLINE" : "REVIEW",
    rootSourceType: "decline_boundary",
    stoppedReason: "decline_boundary_reached",
    riskScoreContribution: score,
    exposureSourceKey: "htx_huobi",
    exposureSourceLabel: "HTX/Huobi",
    sourceExposureKind: "htx_huobi",
    reasons: [
      `Balance-forming path has HTX/Huobi exposure (${formatShare(input.balanceShare)} of selected provenance target); this is source-policy risk, not direct scam/blacklist proof.`
    ]
  };
}
```

- [ ] **Step 5: Replace WhiteBIT branch**

Use:

```ts
const score = baseShareScore("whitebit", input.balanceShare);
return {
  verdict: input.balanceShare >= 0.5 ? "DECLINE" : "REVIEW",
  rootSourceType: "decline_boundary",
  stoppedReason: "decline_boundary_reached",
  riskScoreContribution: score,
  exposureSourceKey: "whitebit",
  exposureSourceLabel: "WhiteBIT",
  sourceExposureKind: "whitebit",
  reasons: [
    `Balance-forming path has WhiteBIT exposure (${formatShare(input.balanceShare)} of selected provenance target); this is medium source-policy risk, not direct scam/blacklist proof.`
  ]
};
```

- [ ] **Step 6: Attach metadata to returned `MoneyOriginPath`**

In `moneyOriginTrace.ts` or the path-building location that converts `MoneyOriginStopClassification` into `MoneyOriginPath`, copy:

```ts
sourceExposureKind: stop.sourceExposureKind ?? null,
```

Also continue copying `exposureSourceKey` and `exposureSourceLabel`.

- [ ] **Step 7: Verify Task 3**

Run:

```bash
npm test -- tests/forensics/moneyOriginPolicy.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/forensics/moneyOriginPolicy.ts src/forensics/moneyOriginTrace.ts tests/forensics/moneyOriginPolicy.test.ts
git commit -m "feat: classify exchange sources as policy exposure"
```

---

## Task 4: Refactor Operational Assessment Into Layered Decision

**Files:**
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`
- Test: `tests/forensics/moneyOriginOperationalAssessment.test.ts`
- Test: `tests/fixtures/forensics/regressionCases.ts`

- [ ] **Step 1: Add tests that policy evidence is not hard evidence**

In `tests/forensics/moneyOriginOperationalAssessment.test.ts`, add:

```ts
it("does not put minority HTX/Huobi exposure into hard bad evidence", () => {
  const assessment = buildMoneyOriginOperationalAssessment({
    fastWalletRisk: lowFastRisk(),
    originPaths: [htxPath({ balanceShare: 0.15, riskScoreContribution: 45 })],
    senderInteractionProfiles: [operationalSenderProfile()],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [],
    coverage: goodCoverage(),
    ageSignals: oldWalletAge()
  });

  expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("htx_huobi_source");
  expect(assessment.sourcePolicyEvidence[0]).toMatchObject({ kind: "htx_huobi" });
  expect(assessment.riskScore).toBeGreaterThanOrEqual(43);
  expect(assessment.riskScore).toBeLessThanOrEqual(55);
  expect(assessment.decision).toBe("ACCEPTABLE");
});

it("keeps majority HTX/Huobi as source policy decline, not hard proof", () => {
  const assessment = buildMoneyOriginOperationalAssessment({
    fastWalletRisk: lowFastRisk(),
    originPaths: [htxPath({ balanceShare: 0.62, riskScoreContribution: 78 })],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [],
    coverage: goodCoverage(),
    ageSignals: oldWalletAge()
  });

  expect(assessment.decision).toBe("DECLINE");
  expect(assessment.riskScore).toBeGreaterThanOrEqual(78);
  expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("htx_huobi_source");
  expect(assessment.dominantRiskLayer?.evidenceClass).toBe("source_policy");
  expect(assessment.dominantRiskLayer?.proofLevel).toBe("exchange_policy_decline");
});

it("caps unknown origin risk for old operational wallets", () => {
  const assessment = buildMoneyOriginOperationalAssessment({
    fastWalletRisk: lowFastRisk(),
    originPaths: [unknownOriginPath({ riskScoreContribution: 55 })],
    senderInteractionProfiles: [operationalSenderProfile()],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [],
    coverage: partialCoverage(),
    ageSignals: oldWalletAge()
  });

  expect(assessment.decision).toBe("ACCEPTABLE");
  expect(assessment.riskScore).toBeLessThanOrEqual(40);
});
```

Use existing fixture helpers where available; otherwise add local helpers consistent with current tests.

- [ ] **Step 2: Run assessment tests and verify failure**

Run:

```bash
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
```

Expected: FAIL because HTX/Huobi still enters hard evidence or final score is fixed.

- [ ] **Step 3: Split hard proof collection**

In `moneyOriginOperationalAssessment.ts`, replace `hardEvidenceFromPaths()` behavior:

```text
Keep:
  rootSourceType === "risky_label" -> scam_or_blacklist

Remove from hardBadEvidence:
  HTX/Huobi
  WhiteBIT
  bridge/router/DEX/cross-chain
  unknown contract
  LLM suspicion without deterministic drain proof
```

If a hard evidence kind named `htx_huobi_source` exists only for previous policy behavior, stop producing it. Do not delete the type until all call sites are migrated.

- [ ] **Step 4: Call `scoreSourceExposures()`**

After wallet role / operational score is known and before final decision:

```ts
const sourceExposure = scoreSourceExposures({
  originPaths: input.originPaths,
  walletRole: role,
  operationalLiquidityScore,
  cleanCexCoverage,
  coverageCompleteness: input.coverage.completeness,
  provenanceConfidence,
  ageSignals: input.ageSignals ?? null
});
```

Use actual field names from `WhereIsMoneyCoverage`; if the project uses `coverage.completenessScore` or similar, map to `0..1`.

- [ ] **Step 5: Build risk layers**

Combine:

```ts
const riskLayers = [
  ...sourceExposure.riskLayers,
  ...contractSuspicionLayers,
  ...unknownOriginLayers,
  ...behaviorLayers,
  ...fastWalletLayers
];

const dominantRiskLayer = [...riskLayers].sort((a, b) => b.score - a.score)[0] ?? null;
```

Hard proof branch still returns immediately:

```ts
if (topHardEvidence) {
  return {
    decision: "DECLINE",
    riskScore: topHardEvidence.score,
    riskBand: riskBandFromWhereScore(topHardEvidence.score),
    hardBadEvidence,
    sourcePolicyEvidence: sourceExposure.sourcePolicyEvidence,
    contractSuspicionEvidence: [],
    unknownOriginEvidence: [],
    riskLayers,
    dominantRiskLayer: hardProofLayer,
    ...
  };
}
```

- [ ] **Step 6: Replace contextual final score**

Use:

```ts
const contextualScore = Math.max(
  sourceExposure.sourcePolicyScore,
  topContractSuspicionScore,
  unknownOriginScore,
  behaviorRiskScore,
  fastWalletContextScore
);

const finalDecision = contextualScore >= 60 ? "DECLINE" : "ACCEPTABLE";
```

Unknown-origin cap:

```ts
if (
  contextualScore >= 60 &&
  contextualScore <= 64 &&
  dominantRiskLayer?.evidenceClass === "unknown_origin" &&
  role === "operational_liquidity_wallet"
) {
  contextualScore = 55;
}
```

- [ ] **Step 7: Positive LLM service cap**

When `topLegitimateServiceLlmVerdict()` covers unresolved contract paths and there is no hard proof:

```ts
unknownContractRisk = Math.min(unknownContractRisk, 35);
```

Do not reduce:

```text
exact approval drain
scam/blacklist
HTX/Huobi >= 50%
strict bridge/cross-chain policy if business policy says decline
```

- [ ] **Step 8: Verify Task 4**

Run:

```bash
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts tests/fixtures/forensics/regressionCases.ts
npm run typecheck
```

Expected: PASS after updating expected fixed HTX scores.

- [ ] **Step 9: Commit Task 4**

```bash
git add src/forensics/moneyOriginOperationalAssessment.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/fixtures/forensics/regressionCases.ts
git commit -m "feat: build layered money origin assessment"
```

---

## Task 5: Fix Money Origin Trace Early Break

**Files:**
- Modify: `src/forensics/moneyOriginTrace.ts`
- Test: `tests/forensics/moneyOriginTrace.test.ts` or nearest existing trace tests.

- [ ] **Step 1: Find early break**

Run:

```bash
rg "terminals\\.some|verdict === \"DECLINE\"|break" src/forensics/moneyOriginTrace.ts tests/forensics -n
```

- [ ] **Step 2: Add regression test**

Add a test where one branch hits HTX policy boundary first and another branch can reach allowlisted Binance within configured depth.

Expected:

```text
trace returns or preserves the better/clean terminal when no deterministic hard proof was found.
HTX policy boundary does not stop traversal of alternative branches.
```

Test assertion shape:

```ts
expect(path.verdict).not.toBe("DECLINE");
expect(path.rootSourceType).toBe("allowlist_cex");
```

If `traceMoneyOriginPath()` returns one best path only, assert that terminal ranking prefers allowlisted CEX over low-share policy boundary when hard proof is absent.

- [ ] **Step 3: Implement deterministic hard terminal helper**

In `moneyOriginTrace.ts`:

```ts
function isDeterministicHardProofTerminal(path: MoneyOriginPath): boolean {
  return path.rootSourceType === "risky_label";
}
```

If approval-drain exact terminals are visible in this module, include them explicitly. Do not include:

```text
HTX/Huobi
WhiteBIT
bridge/router/DEX
cross-chain
unknown contract
unknown CEX
```

- [ ] **Step 4: Replace early break**

Replace:

```ts
if (terminals.some((path) => path.verdict === "DECLINE")) break;
```

With:

```ts
if (terminals.some(isDeterministicHardProofTerminal)) break;
```

- [ ] **Step 5: Verify Task 5**

Run:

```bash
npm test -- tests/forensics/moneyOriginTrace.test.ts tests/check/whereIsMoneyCheck.test.ts
npm run typecheck
```

If `moneyOriginTrace.test.ts` does not exist:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

- [ ] **Step 6: Commit Task 5**

```bash
git add src/forensics/moneyOriginTrace.ts tests/forensics tests/check/whereIsMoneyCheck.test.ts
git commit -m "fix: continue tracing after policy boundaries"
```

---

## Task 6: Align Incoming Deposit With Weighted Scoring

**Files:**
- Modify: `src/forensics/incomingDepositJob.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Add incoming deposit regression tests**

In `tests/forensics/incomingDepositJob.test.ts`, add:

```ts
it("does not map weak HTX policy context to hard decline for incoming deposit", async () => {
  const report = await buildIncomingDepositReport(testDepsForIncoming({
    senderRole: "operational_liquidity_wallet",
    originPaths: [htxWherePath({ balanceShare: 0.15, amountContinuity: 0.35 })]
  }));

  expect(report.hardBadEvidence).toHaveLength(0);
  expect(report.depositRisk).toBeLessThanOrEqual(55);
  expect(report.decision).toBe("ACCEPTABLE");
  expect(report.reasons.join(" ")).toContain("source-policy");
});

it("declines fresh fast incoming deposit from close unknown contract", async () => {
  const report = await buildIncomingDepositReport(testDepsForIncoming({
    senderRole: "fresh_one_shot_wallet",
    originPaths: [unknownContractWherePath({
      balanceShare: 1,
      hops: 1,
      elapsedMs: 20 * 60 * 1000,
      amountContinuity: 0.95
    })]
  }));

  expect(report.decision).toBe("DECLINE");
  expect(report.depositRisk).toBeGreaterThanOrEqual(60);
  expect(report.depositRisk).toBeLessThanOrEqual(75);
  expect(report.reasons.join(" ")).toContain("not exact scam proof");
});
```

Use current test helpers from the file; if helper names differ, keep the same assertions.

- [ ] **Step 2: Run incoming tests and verify failure**

Run:

```bash
npm test -- tests/forensics/incomingDepositJob.test.ts
```

Expected: FAIL until broad hard-decline mapping is removed.

- [ ] **Step 3: Replace path source-policy classification**

In `incomingDepositJob.ts`, replace:

```ts
if (path.rootSourceType === "decline_boundary" || path.rootSourceType === "risky_label") {
  return "hard_decline";
}
```

With:

```ts
if (path.rootSourceType === "risky_label") return "hard_decline";
if (path.sourceExposureKind === "htx_huobi") return "high_policy";
if (path.sourceExposureKind === "bridge_router_dex") return "high_policy";
if (path.sourceExposureKind === "cross_chain_boundary") return "high_policy";
if (path.sourceExposureKind === "whitebit") return "medium_policy";
if (path.sourceExposureKind === "unknown_contract") return "unknown";
if (path.stoppedReason === "unlabeled_service_boundary") return "unknown";
```

Keep a fallback for legacy `exposureSourceKey` while migration is incomplete:

```ts
if (path.exposureSourceKey === "htx_huobi") return "high_policy";
if (path.exposureSourceKey === "whitebit") return "medium_policy";
```

- [ ] **Step 4: Preserve internal path verdict**

Where report maps paths, store:

```ts
internalVerdict: path.verdict,
```

Do not set per-path user verdict to `DECLINE` only because `path.verdict !== "ACCEPTABLE"`.

- [ ] **Step 5: Reuse source exposure score**

If incoming report already calls where-is-money shared report generation, consume:

```ts
whereReport.assessment.sourcePolicyEvidence
whereReport.assessment.riskLayers
whereReport.assessment.dominantRiskLayer
```

If incoming has local scoring, replace local score with `scoreSourceExposures()` using transaction-seeded paths.

- [ ] **Step 6: Expose deposit report fields**

Ensure incoming deposit output includes:

```text
raw share
effective share
hops
elapsed time
amount continuity
source policy kind
proof level
fast sender risk separately
```

Use concise Telegram wording; do not dump every internal layer.

- [ ] **Step 7: Verify Task 6**

Run:

```bash
npm test -- tests/forensics/incomingDepositJob.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "fix: align incoming deposits with source scoring"
```

---

## Task 7: Derive Proof Level From Structured Layers

**Files:**
- Modify: `src/check/whereIsMoneyCheck.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Add proof-level tests**

Add tests:

```ts
it("uses structured source policy layer for HTX proof level", async () => {
  const report = await runWhereIsMoneyCheck(htxMinorityOperationalFixture());

  expect(report.proofLevel).not.toBe("exact_approval_drain_provenance");
  expect(report.assessment.dominantRiskLayer?.evidenceClass).toBe("source_policy");
  expect(report.decisionReasons.join(" ")).toContain("not scam/blacklist");
});

it("uses exact approval-drain proof level only for exact transferFrom provenance", async () => {
  const report = await runWhereIsMoneyCheck(exactApprovalDrainFixture());

  expect(report.proofLevel).toBe("exact_approval_drain_provenance");
  expect(report.assessment.dominantRiskLayer?.evidenceClass).toBe("hard_proof");
});
```

- [ ] **Step 2: Remove text-based proof inference**

Find functions like:

```ts
proofLevelFromWhereDecision(...)
reasonText.includes(...)
```

Replace with:

```ts
function proofLevelFromAssessment(assessment: WhereIsMoneyAssessment): ProofLevel {
  const hard = [...assessment.riskLayers]
    .filter((layer) => layer.evidenceClass === "hard_proof")
    .sort((a, b) => b.score - a.score)[0];

  if (hard) return hard.proofLevel;

  const topLayer = assessment.dominantRiskLayer ?? [...assessment.riskLayers].sort((a, b) => b.score - a.score)[0] ?? null;
  return topLayer?.proofLevel ?? "insufficient_coverage";
}
```

If legacy reports do not yet have `riskLayers`, keep a narrow fallback:

```ts
return "insufficient_coverage";
```

Do not parse reason text.

- [ ] **Step 3: Update report wording**

Where source-policy decline is displayed, include:

```text
This is source-policy risk, not scam/blacklist proof and not approval-drain proof.
```

Where exact approval drain is displayed, include:

```text
Exact approval-drain provenance was confirmed: approve -> transferFrom -> funds reached the checked wallet/deposit receiver.
```

- [ ] **Step 4: Verify Task 7**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```bash
git add src/check/whereIsMoneyCheck.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "fix: derive proof level from risk layers"
```

---

## Task 8: Tighten LLM And Approval-Drain Guards

**Files:**
- Modify: `src/forensics/contractLlmVerdict.ts`
- Modify: `src/forensics/approvalDrainProvenance.ts`
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`
- Test: `tests/forensics/contractLlmVerdict.test.ts`
- Test: `tests/forensics/approvalDrainProvenance.test.ts`
- Test: `tests/forensics/moneyOriginOperationalAssessment.test.ts`

- [ ] **Step 1: Add LLM cap tests**

In `tests/forensics/moneyOriginOperationalAssessment.test.ts`, add:

```ts
it("does not turn LLM drainer_like into exact hard proof without transferFrom evidence", () => {
  const assessment = buildMoneyOriginOperationalAssessment({
    fastWalletRisk: lowFastRisk(),
    originPaths: [unknownContractPath()],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [drainerLikeVerdict({ confidence: 0.9, contractRiskScore: 95 })],
    coverage: goodCoverage(),
    ageSignals: oldWalletAge()
  });

  expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("llm_contract_suspicion");
  expect(assessment.dominantRiskLayer?.evidenceClass).toBe("contract_suspicion");
  expect(assessment.proofLevel).not.toBe("exact_approval_drain_provenance");
});

it("lets legitimate_service LLM cap unknown contract risk when no hard proof exists", () => {
  const assessment = buildMoneyOriginOperationalAssessment({
    fastWalletRisk: lowFastRisk(),
    originPaths: [unknownContractPath()],
    senderInteractionProfiles: [operationalSenderProfile()],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [legitimateServiceVerdict({ confidence: 0.9, contractRiskScore: 10 })],
    coverage: goodCoverage(),
    ageSignals: oldWalletAge()
  });

  expect(assessment.riskScore).toBeLessThanOrEqual(35);
  expect(assessment.decision).toBe("ACCEPTABLE");
});
```

- [ ] **Step 2: Add approval-drain exact wording tests**

In `tests/forensics/approvalDrainProvenance.test.ts`, ensure:

```text
route_linked 1-hop/2-hop profiles are not labelled exact_approval_and_transfer_from unless approval, spender, transferFrom and receiver path all match.
exact approval drain remains 95-100.
```

Use current test helper names.

- [ ] **Step 3: Update hard evidence from LLM**

In `moneyOriginOperationalAssessment.ts`, change `hardEvidenceFromLlm()`:

```text
Only emit hard evidence if the LLM verdict is backed by deterministic approval-drain provenance or equivalent hard proof already present.
Otherwise emit/score it as contract_suspicion layer with cap 65-80.
```

If there is no separate contract suspicion scorer, add:

```ts
function contractSuspicionLayersFromLlm(verdicts: ContractLlmVerdictSummary[]): RiskLayerScore[] {
  return verdicts
    .filter((verdict) => verdict.source !== "unavailable")
    .map((verdict) => {
      const score = verdict.verdict === "drainer_like"
        ? Math.min(80, Math.max(65, verdict.contractRiskScore))
        : verdict.verdict === "unknown_suspicious"
          ? Math.min(75, verdict.contractRiskScore)
          : Math.min(35, verdict.contractRiskScore);
      return {
        evidenceClass: "contract_suspicion",
        kind: `llm_${verdict.verdict}`,
        score,
        rawScore: verdict.contractRiskScore,
        adjustedScore: score,
        proofLevel: "llm_assisted_suspicion",
        canBeDampened: true,
        reasons: [`LLM classified contract as ${verdict.verdict}; this is classifier context, not blockchain proof.`],
        warnings: verdict.verdict === "drainer_like" ? ["Exact approval-drain proof still requires deterministic transferFrom evidence."] : [],
        evidenceIds: verdict.citedEvidenceIds
      };
    });
}
```

- [ ] **Step 4: Preserve exact approval-drain override**

Ensure `approvalDrainProvenanceProfiles` with:

```ts
evidenceStrength === "exact_approval_and_transfer_from"
```

still produce:

```text
DECLINE
95-100
hard_proof
exact_approval_drain_provenance
```

- [ ] **Step 5: Verify Task 8**

Run:

```bash
npm test -- tests/forensics/contractLlmVerdict.test.ts tests/forensics/approvalDrainProvenance.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 8**

```bash
git add src/forensics/contractLlmVerdict.ts src/forensics/approvalDrainProvenance.ts src/forensics/moneyOriginOperationalAssessment.ts tests/forensics/contractLlmVerdict.test.ts tests/forensics/approvalDrainProvenance.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts
git commit -m "fix: keep llm and route-linked drain contextual"
```

---

## Task 9: Full Regression And Live Smoke

**Files:**
- Modify tests/fixtures only if expected values changed.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run typecheck
npm test
```

Expected:

```text
typecheck PASS
all Vitest suites PASS
```

- [ ] **Step 2: Run focused scoring suites**

Run:

```bash
npm test -- tests/forensics/provenanceScoring.test.ts
npm test -- tests/forensics/moneyOriginPolicy.test.ts
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
npm test -- tests/forensics/incomingDepositJob.test.ts
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

Expected: PASS.

- [ ] **Step 3: Live smoke TVz-like minority HTX**

Run:

```bash
npm run forensic:where-is-money -- -- --source TVzGYWyg89wUmwhvbcwfonHVLDYYQAiZMF --depth 20 --beam 8 --max-addresses 60 --max-edges 40 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 15000
```

Expected qualitative result:

```text
If live data still resembles 15% HTX operational case:
  ACCEPTABLE or below-60 warning
  score roughly 45-55
  no htx_huobi_source hardBadEvidence
  wording says source-policy risk, not scam/drain proof
```

If live data changed, record the changed source shares and explain the score using risk layers.

- [ ] **Step 4: Live smoke operational controls**

Run:

```bash
npm run forensic:where-is-money -- -- --source TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM --depth 20 --beam 8 --max-addresses 60 --max-edges 40 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 15000
npm run forensic:where-is-money -- -- --source TTs9xCEZ43niXvfKTu7LcF7Kcud3Bbw7FD --depth 20 --beam 8 --max-addresses 60 --max-edges 40 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 15000
```

Expected:

```text
Operational wallets with no hard bad evidence remain ACCEPTABLE / LOW-MEDIUM or MEDIUM warning.
Unknown origin does not become HIGH by itself.
```

- [ ] **Step 5: Live smoke bridge/OFT wording**

Run:

```bash
npm run forensic:where-is-money -- -- --source TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb --depth 20 --beam 8 --max-addresses 60 --max-edges 40 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 15000
```

Expected:

```text
LayerZero/OFT/cross-chain remains policy boundary if strict.
Report does not call it drainer proof unless exact approval-drain evidence exists.
LLM legitimate_service classification can be shown as contract/service context.
```

- [ ] **Step 6: Exact approval drain control**

Run existing exact approval-drain unit/integration case or a known fixture.

Expected:

```text
DECLINE
95-100
exact_approval_drain_provenance
no operational dampening
```

- [ ] **Step 7: Commit final test/fixture updates**

If Task 9 changed fixtures or docs:

```bash
git add tests docs
git commit -m "test: lock final scoring regressions"
```

If no changes:

```bash
git status --short
```

Expected:

```text
No uncommitted source/test changes.
```

---

## Required Regression Cases

Make sure tests cover all of these:

1. HTX 15%, 2 hops, operational wallet, no hard evidence:
   - `ACCEPTABLE`
   - `45-55`
   - no `hardBadEvidence`

2. HTX 15%, direct, <=1h, strong continuity, fresh one-shot:
   - `DECLINE`
   - `65-75`
   - source-policy wording

3. HTX >50%, close path:
   - `DECLINE`
   - `78-85`
   - source-policy, not scam proof

4. HTX 8%, 10 hops, 3 months old, operational:
   - `ACCEPTABLE`
   - `25-35`
   - historical context

5. Weak continuity incoming deposit, HTX continuity `0.05`:
   - score cap `<=55`
   - no hard evidence

6. WhiteBIT 15%, operational wallet:
   - `ACCEPTABLE` or MEDIUM warning
   - not hard evidence

7. Unknown contract + LLM legitimate_service:
   - `ACCEPTABLE`
   - `20-35`

8. Unknown contract + fresh one-shot + direct + fast + strong continuity:
   - `DECLINE`
   - `60-75`
   - not exact scam proof

9. Exact approval drain:
   - `DECLINE`
   - `95-100`
   - exact proof

10. Bridge/OFT/LayerZero path:
   - strict policy can decline
   - wording says cross-chain/source-policy boundary, not drainer proof

## PR Review Checklist

Before merging, verify:

- [ ] No text-based proof inference remains for HTX/bridge/drain.
- [ ] HTX/Huobi is not emitted as `hardBadEvidence`.
- [ ] WhiteBIT is not emitted as `hardBadEvidence`.
- [ ] Bridge/router/DEX/cross-chain is not emitted as scam/drain proof.
- [ ] Unknown contract is capped unless fresh/fast/direct/strong continuity or exact proof exists.
- [ ] LLM `drainer_like` is contextual unless deterministic transferFrom proof exists.
- [ ] LLM `legitimate_service` can lower unknown contract risk.
- [ ] Operational wallet dampening never applies to hard proof.
- [ ] Incoming deposit and where-is-money produce consistent scores for equivalent path evidence.
- [ ] Reports show source-policy wording when policy risk dominates.

## Implementation Notes

- Prefer `src/forensics/provenanceScoring.ts` as the single source for source-policy formulas.
- Keep existing fields during migration; add structured fields rather than breaking every call site at once.
- If current project type names differ from this plan, adapt through small local mapping functions and keep behavior identical.
- Do not broaden live API usage during unit tests.
- Use deterministic fixtures for scoring tests.
