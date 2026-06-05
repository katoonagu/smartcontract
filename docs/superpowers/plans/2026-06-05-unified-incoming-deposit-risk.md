# Unified Incoming Deposit Risk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `incoming_deposit_check` use the same final score, decision, floors, caps, and dampener logic as wallet checks.

**Architecture:** Add a shared forensic scorer API around the existing wallet scorer logic, then add an incoming-deposit adapter that passes the checked deposit event as the subject. Keep the existing `IncomingDepositRiskReport` shape stable, but populate score/decision fields from the shared scorer.

**Tech Stack:** TypeScript, Vitest, existing `RiskReport`, `WhereIsMoneyReport`, `DeepAddressForensicReport`, `IncomingDepositRiskReport`, `calculateUnifiedWalletRisk`.

---

## Source Spec

Implement:

```text
docs/superpowers/specs/2026-06-05-unified-incoming-deposit-risk-design.md
```

Do not implement a second incoming-specific scorer. Incoming-specific code can collect evidence and format reports, but final score/level/decision must come from the shared scorer.

## File Structure

- Modify `src/risk/unifiedWalletRisk.ts`
  - Keep `calculateUnifiedWalletRisk` public.
  - Add a shared subject/input wrapper named `calculateUnifiedForensicRisk`.
  - Keep final scoring policy in one implementation path.

- Create `src/risk/unifiedIncomingDepositRisk.ts`
  - Own incoming-deposit adapter logic.
  - Merge sender USDT blacklist evidence into the fast layer as a synthetic hard-evidence reason.
  - Return shared scorer output and a compact summary for storage/reporting.

- Modify `src/types.ts`
  - Add optional `unifiedRiskSummary` to `IncomingDepositRiskReport`.
  - Keep existing `depositRiskScore`, `riskBand`, and `decision` fields.

- Modify `src/forensics/incomingDepositJob.ts`
  - Replace the separate `depositRiskScore = max(whereReport.riskScore, topHardScore)` and decision formula.
  - Keep origin paths, funding coverage, corridor summary, warnings, and sender role logic unchanged.

- Modify `tests/risk/unifiedWalletRisk.test.ts`
  - Add shared scorer / incoming adapter tests.
  - Keep existing wallet scorer tests passing.

- Modify `tests/forensics/incomingDepositJob.test.ts`
  - Prove incoming report score/decision comes from shared scorer.
  - Preserve existing alert/admin compatibility through existing report fields.

## Task 1: Shared Forensic Scorer API

**Files:**

- Modify: `src/risk/unifiedWalletRisk.ts`
- Test: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Add shared subject and input types**

Add near the existing `UnifiedWalletRiskInput` type:

```ts
export type UnifiedForensicRiskSubject =
  | { scope: "wallet"; address: string }
  | {
      scope: "incoming_deposit";
      senderAddress: string;
      receiverAddress: string;
      txHash: string;
      amountRaw: string;
      timestamp: Date;
    };

export type UnifiedForensicRiskInput = {
  subject: UnifiedForensicRiskSubject;
  fastReport?: RiskReport | null;
  deepReport?: DeepAddressForensicReport | null;
  whereReport: WhereIsMoneyReport;
};

export type UnifiedForensicRiskResult = UnifiedWalletRiskResult;
```

- [ ] **Step 2: Add shared scorer wrapper**

Add below `calculateUnifiedWalletRisk` or refactor `calculateUnifiedWalletRisk` to call this helper:

```ts
function addressFromForensicSubject(subject: UnifiedForensicRiskSubject): string {
  return subject.scope === "wallet" ? subject.address : subject.senderAddress;
}

export function calculateUnifiedForensicRisk(input: UnifiedForensicRiskInput): UnifiedForensicRiskResult {
  return calculateUnifiedWalletRisk({
    address: addressFromForensicSubject(input.subject),
    fastReport: input.fastReport,
    deepReport: input.deepReport,
    whereReport: input.whereReport
  });
}
```

If this creates a circular call after refactoring, use an internal `calculateUnifiedRiskCore(input: UnifiedWalletRiskInput)` and let both public functions call it.

- [ ] **Step 3: Add shared scorer regression test**

In `tests/risk/unifiedWalletRisk.test.ts`, add a test that calls `calculateUnifiedForensicRisk` with `scope: "incoming_deposit"` and no Deep report.

Use a where report with score `65`, proof level `insufficient_coverage`, and no hard evidence. Expected result:

```ts
expect(result.finalScore).toBeLessThan(60);
expect(result.finalDecision).toBe("ACCEPTABLE");
expect(result.layerBreakdown.deep.weightedContribution).toBe(0);
```

- [ ] **Step 4: Run the focused scorer tests**

Run:

```bash
npm test -- tests/risk/unifiedWalletRisk.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit Task 1**

Commit only Task 1 files:

```bash
git add src/risk/unifiedWalletRisk.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "Add shared forensic risk scorer API"
```

## Task 2: Incoming Deposit Scorer Adapter

**Files:**

- Create: `src/risk/unifiedIncomingDepositRisk.ts`
- Modify: `src/types.ts`
- Test: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Add incoming summary type**

In `src/types.ts`, add:

```ts
export type IncomingDepositUnifiedRiskSummary = {
  finalScore: number;
  finalLevel: RiskLevel;
  finalDecision: UserExchangeDecision;
  hardEvidenceFloor: number;
  policyFloor: number;
  assetContinuationFloor: number;
  patternFloor: number;
  dampener: number;
  activeAnchor: {
    code: string;
    message: string;
    score: number;
    source: string;
  } | null;
};
```

Then add to `IncomingDepositRiskReport`:

```ts
unifiedRiskSummary?: IncomingDepositUnifiedRiskSummary;
```

- [ ] **Step 2: Create incoming adapter**

Create `src/risk/unifiedIncomingDepositRisk.ts`:

```ts
import type {
  IncomingDepositRiskBand,
  IncomingDepositUnifiedRiskSummary,
  RiskReport,
  StablecoinRestrictionProfile,
  WhereIsMoneyReport
} from "../types";
import {
  calculateUnifiedForensicRisk,
  type UnifiedForensicRiskResult
} from "./unifiedWalletRisk";
import type { DeepAddressForensicReport } from "../check/deepForensicCheck";

export type CalculateUnifiedIncomingDepositRiskInput = {
  senderAddress: string;
  receiverAddress: string;
  txHash: string;
  amountRaw: string;
  timestamp: Date;
  fastSenderRisk: RiskReport | null;
  senderStablecoinState: StablecoinRestrictionProfile | null;
  whereReport: WhereIsMoneyReport;
  deepReport?: DeepAddressForensicReport | null;
};

export function incomingRiskBandFromUnifiedScore(score: number): IncomingDepositRiskBand {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 45) return "MEDIUM";
  if (score >= 20) return "LOW-MEDIUM";
  return "LOW";
}
```

Add helper:

```ts
function fastRiskWithSenderBlacklist(
  fastSenderRisk: RiskReport | null,
  senderAddress: string,
  senderStablecoinState: StablecoinRestrictionProfile | null
): RiskReport | null {
  if (!senderStablecoinState?.isBlacklisted) return fastSenderRisk;
  const base: RiskReport = fastSenderRisk ?? {
    subjectAddress: senderAddress,
    score: 0,
    level: "LOW",
    reasons: []
  };
  return {
    ...base,
    score: Math.max(base.score, 95),
    level: "CRITICAL",
    reasons: [
      ...base.reasons,
      {
        code: "stablecoin_usdt_blacklisted",
        message: "Official TRON USDT contract blacklist state is active for the incoming deposit sender.",
        scoreImpact: 95,
        source: "stablecoin_contract",
        confidence: "high",
        severity: "critical"
      }
    ]
  };
}
```

Add public function:

```ts
export function calculateUnifiedIncomingDepositRisk(
  input: CalculateUnifiedIncomingDepositRiskInput
): UnifiedForensicRiskResult {
  return calculateUnifiedForensicRisk({
    subject: {
      scope: "incoming_deposit",
      senderAddress: input.senderAddress,
      receiverAddress: input.receiverAddress,
      txHash: input.txHash,
      amountRaw: input.amountRaw,
      timestamp: input.timestamp
    },
    fastReport: fastRiskWithSenderBlacklist(
      input.fastSenderRisk,
      input.senderAddress,
      input.senderStablecoinState
    ),
    deepReport: input.deepReport,
    whereReport: input.whereReport
  });
}
```

Add summary helper:

```ts
export function incomingUnifiedRiskSummary(
  result: UnifiedForensicRiskResult
): IncomingDepositUnifiedRiskSummary {
  return {
    finalScore: result.finalScore,
    finalLevel: result.finalLevel,
    finalDecision: result.finalDecision,
    hardEvidenceFloor: result.hardEvidenceFloor,
    policyFloor: result.policyFloor,
    assetContinuationFloor: result.assetContinuationFloor,
    patternFloor: result.patternFloor,
    dampener: result.dampener,
    activeAnchor: result.scoreBreakdown.activeAnchor
  };
}
```

- [ ] **Step 3: Add adapter tests**

In `tests/risk/unifiedWalletRisk.test.ts`, add:

```ts
it("treats sender USDT blacklist as incoming deposit hard evidence", () => {
  const result = calculateUnifiedIncomingDepositRisk({
    senderAddress: "TBlacklistedSender111111111111111111",
    receiverAddress: "TWatchedWallet1111111111111111111",
    txHash: "tx-blacklisted-incoming",
    amountRaw: "1000000",
    timestamp: new Date("2026-06-05T00:00:00.000Z"),
    fastSenderRisk: null,
    senderStablecoinState: { ...stablecoinProfileForTest, isBlacklisted: true },
    whereReport: whereReportForTest({ score: 5, decision: "ACCEPTABLE" })
  });

  expect(result.finalScore).toBe(95);
  expect(result.finalDecision).toBe("DECLINE");
  expect(result.hardEvidenceFloor).toBe(95);
});
```

Use existing test helpers in the file for `whereReportForTest`; if the file uses a different helper name, use that existing helper and only add the new fields needed by TypeScript.

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- tests/risk/unifiedWalletRisk.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/risk/unifiedIncomingDepositRisk.ts src/types.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "Add unified incoming deposit risk adapter"
```

## Task 3: Use Shared Scorer In Incoming Deposit Reports

**Files:**

- Modify: `src/forensics/incomingDepositJob.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Import adapter**

In `src/forensics/incomingDepositJob.ts`, import:

```ts
import {
  calculateUnifiedIncomingDepositRisk,
  incomingRiskBandFromUnifiedScore,
  incomingUnifiedRiskSummary
} from "../risk/unifiedIncomingDepositRisk";
```

- [ ] **Step 2: Replace separate score formula**

Inside `incomingReportFromWhere`, replace:

```ts
const topHardScore = hardBadEvidence[0]?.score ?? 0;
const depositRiskScore = Math.max(input.whereReport.riskScore, topHardScore);
const decision = topHardScore >= 85 ? "DECLINE" : input.whereReport.userDecision;
```

with:

```ts
const unifiedRisk = calculateUnifiedIncomingDepositRisk({
  senderAddress: input.deposit.fromAddress,
  receiverAddress: input.deposit.toAddress,
  txHash: input.deposit.txHash,
  amountRaw: input.deposit.amountRaw,
  timestamp: input.deposit.timestamp,
  fastSenderRisk: input.fastSenderRisk,
  senderStablecoinState: input.senderStablecoinState,
  whereReport: input.whereReport
});
const depositRiskScore = unifiedRisk.finalScore;
const decision = unifiedRisk.finalDecision;
```

Change returned `riskBand`:

```ts
riskBand: incomingRiskBandFromUnifiedScore(depositRiskScore),
```

Add to the returned report:

```ts
unifiedRiskSummary: incomingUnifiedRiskSummary(unifiedRisk),
```

- [ ] **Step 3: Add report mapping test**

In `tests/forensics/incomingDepositJob.test.ts`, add or update a test that proves an insufficient-coverage Where decline does not automatically produce incoming `DECLINE` if the unified score is below 60.

Expected assertions:

```ts
expect(result.depositRiskScore).toBeLessThan(60);
expect(result.decision).toBe("ACCEPTABLE");
expect(result.unifiedRiskSummary?.finalScore).toBe(result.depositRiskScore);
expect(result.unifiedRiskSummary?.finalDecision).toBe(result.decision);
```

- [ ] **Step 4: Preserve hard evidence tests**

Run existing incoming tests that cover blacklist, approval drain, no-name liquidity, bridge source policy, and clean CEX.

Command:

```bash
npm test -- tests/forensics/incomingDepositJob.test.ts
```

Expected: pass. If an expected score changes because the shared scorer applies a stronger floor or prevents a Where decision leak, update the expectation only when the new value matches the spec.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "Use unified scorer for incoming deposit reports"
```

## Task 4: Final Compatibility, Review, And Verification

**Files:**

- Modify only if tests prove necessary:
  - `tests/alerts/formatters.test.ts`
  - `tests/admin/forensicsGraph.test.ts`
  - `src/alerts/formatters.ts`
  - `src/admin/forensicsGraph.ts`

- [ ] **Step 1: Run targeted compatibility tests**

Run:

```bash
npm test -- tests/alerts/formatters.test.ts tests/admin/forensicsGraph.test.ts tests/forensics/incomingDepositJob.test.ts tests/risk/unifiedWalletRisk.test.ts
```

Expected: pass.

- [ ] **Step 2: Fix only compatibility breakages**

If formatter/admin tests fail because `unifiedRiskSummary` is optional and ignored, prefer no code change. If TypeScript or tests require fixture updates, update fixtures by adding:

```ts
unifiedRiskSummary: undefined
```

or omit the field when the type allows it.

- [ ] **Step 3: Full verification**

Run:

```bash
npm run typecheck
npm test
```

Expected:

```text
typecheck passes
all Vitest files pass
```

- [ ] **Step 4: PR review**

Review the final diff against the spec:

- no separate incoming final score formula remains;
- incoming calls the shared scorer;
- wallet scorer behavior remains compatible;
- hard evidence still floors score;
- insufficient coverage does not force decline by itself;
- incoming report output remains compatible.

- [ ] **Step 5: Final commit**

If Task 4 changed files, commit them:

```bash
git add tests/alerts/formatters.test.ts tests/admin/forensicsGraph.test.ts src/alerts/formatters.ts src/admin/forensicsGraph.ts
git commit -m "Verify incoming deposit scoring compatibility"
```

If Task 4 did not change files, do not create an empty commit.

## Completion Checklist

- [ ] Spec exists and is committed.
- [ ] Plan exists and is committed.
- [ ] `calculateUnifiedForensicRisk` exists.
- [ ] `calculateUnifiedIncomingDepositRisk` exists.
- [ ] `incomingDepositJob` no longer computes final score with `max(whereReport.riskScore, topHardScore)`.
- [ ] Incoming reports expose `unifiedRiskSummary`.
- [ ] Wallet unified scorer tests pass.
- [ ] Incoming deposit tests pass.
- [ ] Formatter/admin compatibility tests pass.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] Final PR review has no blocking findings.
