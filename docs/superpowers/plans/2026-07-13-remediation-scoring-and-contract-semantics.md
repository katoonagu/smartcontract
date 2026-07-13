# Scoring And Contract Semantics Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Внедрить детерминированные score anchors, collector/USDD scoring, current-allowance wallet safety, exact known-service sessions и subordinate contract LLM — без Telegram redesign, runtime/delivery изменений, production release и Address Poisoning.

**Architecture:** Plan 2 принимает typed data contracts Plan 1 как неизменяемый вход. Pure policy modules сначала вычисляют `ScoreAnchorV2`, `UsddPsmExposureV1`, `ApprovalSafetyAssessmentV2` и `ContractDecisionV2`; orchestration только связывает их с существующими Wallet/Incoming/Approval/Contract результатами. Любая невалидная subject/evidence/fact binding или LLM-структура fail-closed: AML score отсутствует либо сохраняется прежний deterministic contract result.

**Tech Stack:** TypeScript 5.7, Node.js, Vitest, PostgreSQL 16 candidate database, existing `pg`, `tronweb` and `TronscanClient`; новых зависимостей нет.

---

Статус: утверждён пользователем; code implementation не начат.

Канонический источник:

- `docs/superpowers/specs/2026-07-12-telegram-runtime-forensics-remediation-design.md`;
- утверждённая матрица `docs/audit/2026-07-12-telegram-runtime-forensics-conformance-audit.md`;
- Plan 1 foundation в локальном `master` на dynamic `PLAN2_BASE_SHA`.

Planning baseline, read-only verified on 2026-07-13:

```text
PLAN2_PLANNING_MASTER_SHA=5c865d97ab2732b4fd0bb354ae41aeb0ea797b86
```

Task 0 always derives `PLAN2_BASE_SHA` from the then-current local `master` and
requires it to equal this reviewed planning SHA. A mismatch blocks execution:
the plan must be rebased and reviewed again instead of silently changing its
base.

## 1. Ownership и границы

### 1.1 Primary REQ ownership Plan 2

Plan 2 реализует только:

- `REQ-04` — exact applicable proof сохраняет `DECLINE` при unrelated partial coverage; required coverage без proof даёт no-final/null score;
- `REQ-05` — Fast, Deep, Where, Incoming и Contract остаются разными режимами; Contract не подавляет transfer analysis;
- `REQ-08` — victim/spender/receiver/route и exact Verify20 не смешиваются; обычный `transferFrom` не является drainer proof;
- `REQ-15` — published score связан с единственным active `ScoreAnchorV2` и `preferredFactId`;
- `REQ-16` — collector-only capped `35 REVIEW`; `55 REVIEW` требует независимого AML signal;
- `REQ-17` — current blacklist/material direct relationship остаётся high; chronology не меняет evidence class;
- `REQ-18` — wallet-safety отделена от AML и имеет `amlScoreImpact: 0`;
- `REQ-20` — Verify20 wallet-safety tiers `90/75/45/0`, exact debit `95`;
- `REQ-21` — service dampener требует exact same-wallet session и amount continuity;
- `REQ-22` — transaction envelope expiration не влияет на approval risk;
- `REQ-23` — deterministic contract authority выше LLM;
- `REQ-24` — official USDT `LOW 0`, GasFree Account `LOW 10`, deterministic services bypass LLM;
- `REQ-25` — LLM только для ambiguity; failure не меняет deterministic result;
- `REQ-26` — strict LLM schema/citation validation;
- `REQ-28` — exact USDD PSM interpretation и bounded semantics;
- `REQ-29` — exact integer USDD modifiers и standalone cap `45 REVIEW`.

Secondary integration, без смены primary ownership:

- `REQ-19(scoring)` — Plan 1 `ApprovalAllowanceStateV2` становится единственным current-allowance входом для safety score; direct call adapter добавляется здесь, но migration/lifecycle ownership не переносится;
- `REQ-38(scoring)` — invalid anchor, inexact PSM и invalid LLM fail-closed;
- `REQ-01`, `REQ-02`, `REQ-30` regression-only — GasFree Account principal остаётся transfer-eligible, exact GasFree fee не возвращается в score.

Не входят:

- `REQ-06/07/09/11…14/27/31…34` presentation ownership Plan 4;
- `REQ-35…37` runtime/delivery ownership Plan 3;
- AC-20/21/24/27/39 — Plan 4, даже если Plan 2 создаёт нужные typed fields;
- AC-41 — Plan 5;
- любые Admin, Telegram copy, callback, delivery, migration, deployment или Address Poisoning изменения.

### 1.2 AC ownership Plan 2

Новые ID-linked acceptance tests обязательны для:

| AC | Точное ожидаемое поведение |
|---|---|
| AC-01 | Collector-only → `35 REVIEW`, не `DECLINE`. |
| AC-02 | Collector + отдельный eligible AML episode → composed `55 REVIEW`; тот же episode не считается независимым. |
| AC-03 | Exact 2% outbound PSM: base `3`, direction half-up → applied `2`; PSM-кандидат bounded. |
| AC-04 | Exact 83% inbound Where: base/applied `25`, PSM-only result `45 REVIEW`. |
| AC-05 | Exact 83% inbound Deep: mode-adjusted/applied `12`. |
| AC-06 | Label-only, wrong reserve, discontinuous amount или unsupported hop не создаёт exposure/candidate. |
| AC-19 | Fresh unlimited + exact Verify20 → `CRITICAL 90`, `REVOKE_NOW`, AML impact `0`. |
| AC-22 | One selector/provider name/free text ≤`35` context. |
| AC-23 | Fresh confirmed zero → active threat score `0`, history retained. |
| AC-25 | Exact Bridgers 66s / 91.103009 / same-wallet session → `LOW 10`, AML `0`. |
| AC-26 | Tag-only evidence не создаёт session dampener. |
| AC-28 | Envelope expiration не создаёт risk reason/modifier. |
| AC-29 | Official TRON USDT → deterministic `LOW 0`, LLM call count `0`. |
| AC-30 | Structural GasFree Account → deterministic `LOW 10`, LLM `0`; principal remains score-eligible. |
| AC-31 | Exact Bridgers approval session остаётся `LOW 10`, не `DECLINE`. |
| AC-32 | Authoritative service + active unlimited + no exact session → wallet-safety `45`, не AML decline. |
| AC-33 | Provider risk, exact Verify20 или exact debit не dampen-ится service/LLM. |
| AC-34 | Fractional/non-finite/out-of-range/missing LLM score rejected. |
| AC-35 | Contradictory verdict/recommendation rejected; unknown-insufficient recommendation ignored. |
| AC-36 | Live/cache citations пересекаются только с current case-file evidence. |
| AC-37 | Risky verdict без хотя бы одной valid citation → `null`. |
| AC-38 | Timeout/invalid JSON/schema → deterministic result unchanged. |
| AC-40 | Все deterministic no-call cases bypass Flash и Pro. |

Presentation-only assertions не добавляются в эти tests. Plan 2 проверяет data/decision objects, не Telegram text.

### 1.3 Policy versions

Новые fresh results получают:

```ts
export const SCORING_SIGNAL_MATRIX_POLICY_VERSION = "scoring-signal-matrix-v3" as const;
export const APPROVAL_SAFETY_POLICY_VERSION = "2026-07-13-approval-safety-v2" as const;
export const CONTRACT_DECISION_POLICY_VERSION = "2026-07-13-contract-decision-v2" as const;
export const CONTRACT_LLM_VERDICT_POLICY_VERSION = "2026-07-13-contract-llm-v4-strict" as const;
```

Старые сохранённые results остаются legacy. Код не создаёт для них `ScoreAnchorV2`, не пересчитывает их и не меняет прежнее сохранённое представление.

## 2. File map

### Create

- `src/risk/scoreAnchorV2.ts` — policy registry, canonical score fact, strict anchor validation и fail-closed binding.
- `src/risk/usddPsmExposure.ts` — BigInt tiering, half-up adjustments и bounded PSM matrix candidate.
- `src/approvals/allowanceRefresh.ts` — official-USDT constant-call adapter → strict `ApprovalAllowanceStateV2`.
- `src/approvals/approvalSafetyAssessment.ts` — deterministic wallet-safety resolver и legacy `RiskReport` adapter.
- `src/approvals/knownServiceRegistry.ts` — exact address-bound service identities; первый canonical entry — Bridgers.
- `src/forensics/contractDecision.ts` — deterministic authority resolver и LLM eligibility.
- `src/forensics/contractLlmValidation.ts` — strict live/cache response validator.
- `tests/fixtures/forensics/remediationScoringCases.ts` — synthetic, explicitly non-on-chain fixtures for Plan 2.
- `tests/risk/scoreAnchorV2.acceptance.test.ts`.
- `tests/risk/collectorUsddRemediation.acceptance.test.ts`.
- `tests/approvals/approvalSafetyV2.acceptance.test.ts`.
- `tests/approvals/approvalSafety.postgres.test.ts`.
- `tests/check/contractDecisionV2.acceptance.test.ts`.
- `tests/forensics/contractLlmValidation.acceptance.test.ts`.
- `tests/risk/remediationScoringCompatibility.test.ts` — fresh/legacy round-trip and cross-domain separation.

### Modify

- `src/types.ts` — canonical Plan 2 contracts and optional fresh-result fields.
- `src/risk/scoringSignalMatrix.ts` — v3 policy, collector composition and registered row metadata.
- `src/risk/scoringSignalMatrixInputs.ts` — collector cap, USDD exposures, exact evidence IDs.
- `src/risk/finalDisposition.ts` — no numeric result without valid anchor binding.
- `src/risk/unifiedWalletRisk.ts` — active anchor/fact output for fresh Wallet result.
- `src/risk/unifiedIncomingDepositRisk.ts` — active anchor/fact output for fresh Incoming result.
- `src/check/whereIsMoneyCheck.ts` — subject-bound Where anchor input/output only; no copy changes.
- `src/check/deepForensicCheck.ts` — optional typed Deep PSM exposure input and score integration only.
- `src/approvals/allowanceState.ts` — export the canonical failure-code type/validator used by the refresh adapter.
- `src/approvals/sessionContext.ts` — exact `KnownServiceSessionV1` construction.
- `src/approvals/approvalRisk.ts` — safety adapter, no expiration risk, precedence rules.
- `src/approvals/approvalWorker.ts` — direct allowance refresh before final safety evaluation.
- `src/tron/tronClient.ts` — exact `allowance(address,address)` constant-call method.
- `src/check/smartContractCheck.ts` — deterministic-first `ContractDecisionV2`, LLM no-call gate.
- `src/forensics/contractLlmVerdict.ts` — strict validator use, cache citation integrity, no fallback decline.
- `src/index.ts` — dependency injection only for direct allowance read/save; no lifecycle/delivery changes.
- matching existing tests in `tests/risk`, `tests/approvals`, `tests/check`, `tests/forensics`, `tests/tron` only where old expectations contradict the new AC.
- `docs/knowledge/05-where-is-money-and-incoming.md`.
- `docs/knowledge/06-deepcheck.md`.
- `docs/knowledge/07-risk-scoring-matrix.md`.
- `docs/knowledge/09-current-decisions.md`.
- `docs/knowledge/10-open-problems.md` only for a discovered, unfixed recurring problem.
- `docs/knowledge/13-agent-observations.md` only for a new repeated agent mistake/user correction.

### Forbidden diff

```text
src/bot/**
src/alerts/**
src/admin/**
src/monitor/**
src/runtime/**
migrations/**
src/monitor/addressPoisoning.ts
src/monitor/addressPoisoningWorker.ts
src/alerts/addressPoisoningAlert.ts
tests/monitor/addressPoisoning.test.ts
tests/monitor/addressPoisoningWorker.test.ts
tests/alerts/addressPoisoningAlert.test.ts
tests/fixtures/monitor/addressPoisoningCases.ts
migrations/031_address_poisoning_monitor.sql
docs/superpowers/plans/*runtime*
docs/superpowers/plans/*telegram*
docs/superpowers/plans/*release*
```

`migrations/032_telegram_runtime_forensics_data_contracts.sql` read-only; migration 033 не создаётся.

## 3. Task 0 — dynamic baseline, plan-only commit, isolated worktree and production fence

**Files:**

- Commit only the already approved
  `docs/superpowers/plans/2026-07-13-remediation-scoring-and-contract-semantics.md`.
- No code, test, knowledge or user-owned file.

- [ ] **Step 1: capture the dynamic base without touching the dirty main worktree**

Run from `C:\Users\User\OneDrive\Desktop\smartcontract`:

```powershell
$PLAN2_PLANNING_MASTER_SHA = '5c865d97ab2732b4fd0bb354ae41aeb0ea797b86'
$PLAN2_BASE_SHA = (git rev-parse master).Trim()
if ($PLAN2_BASE_SHA -ne $PLAN2_PLANNING_MASTER_SHA) {
  throw "Plan 2 base changed: expected $PLAN2_PLANNING_MASTER_SHA, got $PLAN2_BASE_SHA. Rebase and re-review the plan."
}
git config branch.codex/remediation-scoring-contract-semantics.plan2BaseSha $PLAN2_BASE_SHA
git status --short
git rev-parse HEAD
```

Expected:

- `PLAN2_BASE_SHA` equals the then-current local `master` SHA, initially expected to be `5c865d97ab2732b4fd0bb354ae41aeb0ea797b86`;
- user-owned dirty docs remain present and unchanged;
- no assumption that the base is still a hard-coded SHA at execution time.

- [ ] **Step 2: after approval, commit only the approved plan document**

Run in the main worktree without stashing or staging any user-owned file:

```powershell
$PLAN_PATH = 'docs/superpowers/plans/2026-07-13-remediation-scoring-and-contract-semantics.md'
git add -- $PLAN_PATH
$staged = @(git diff --cached --name-only)
if ($staged.Count -ne 1 -or $staged[0] -ne $PLAN_PATH) {
  git restore --staged -- $PLAN_PATH
  throw "Plan-only commit fence failed: $($staged -join ', ')"
}
git commit -m "docs: add scoring and contract remediation plan"
$PLAN2_PLAN_SHA = (git rev-parse HEAD).Trim()
$PLAN2_PLAN_PARENT_SHA = (git rev-parse HEAD^).Trim()
if ($PLAN2_PLAN_PARENT_SHA -ne $PLAN2_BASE_SHA) {
  throw "Plan commit parent mismatch: expected $PLAN2_BASE_SHA, got $PLAN2_PLAN_PARENT_SHA"
}
git config branch.codex/remediation-scoring-contract-semantics.plan2PlanSha $PLAN2_PLAN_SHA
git diff-tree --no-commit-id --name-only -r $PLAN2_PLAN_SHA
git status --short
```

Expected:

- the commit contains exactly the approved Plan 2 document;
- its parent is exact `PLAN2_BASE_SHA`;
- all pre-existing modified/untracked user files remain visible and unstaged;
- no code implementation has started.

- [ ] **Step 3: create a dedicated worktree from the plan-only commit**

```powershell
$WORKTREE = 'C:\Users\User\OneDrive\Desktop\smartcontract-remediation-scoring-contract-semantics'
$PLAN2_PLAN_SHA = (git config --get branch.codex/remediation-scoring-contract-semantics.plan2PlanSha).Trim()
git worktree add $WORKTREE -b codex/remediation-scoring-contract-semantics $PLAN2_PLAN_SHA
git -C $WORKTREE status --short
```

Expected: new worktree clean; main worktree retains all user changes.

- [ ] **Step 4: verify the Plan 1 candidate schema in a disposable database**

```powershell
$dbExists = (docker exec hermes-smartcontract-postgres psql -U tron -d postgres -tAc "select 1 from pg_database where datname='tron_watch_plan2'").Trim()
if ($dbExists -ne '1') {
  docker exec hermes-smartcontract-postgres createdb -U tron tron_watch_plan2
}
$env:TEST_DATABASE_URL = 'postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan2'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npm run db:migrate
npx tsx scripts/migrate.ts
```

Expected:

- migrations `001…032` apply or verify;
- second run prints that schema 32 is already verified;
- no production URL/port `5432` is used;
- no migration file is created or edited.

- [ ] **Step 5: record a clean baseline**

```powershell
npm run typecheck
npm test
```

Expected baseline: typecheck GREEN and full suite GREEN. Record exact file/test counts in the execution log; do not copy stale Plan 1 counts as proof.

- [ ] **Step 6: pin the release fence**

Record in the execution log:

```text
Plan 2 candidate only.
Production DB, deployed runtime, /version and Telegram remain unchanged.
Only Plan 5 may migrate/restart/release production.
```

Task 0 has exactly one commit: the approved plan document. It contains no code,
test, knowledge or user-owned file.

Required review after Task 0:

1. independent spec-review confirms the captured base SHA, single-file plan
   commit, clean feature worktree, disposable PostgreSQL URL and Plan 5
   production fence;
2. independent code-quality/safety review confirms the only diff from
   `PLAN2_BASE_SHA` is the approved plan document, all other dirty main-worktree
   files remain unstaged and no production endpoint was contacted.

Both reviews are recorded before Task 1.

## 4. Task 1 — first commit is the complete Plan 2 RED acceptance batch

**Files:**

- Create the fixture and six acceptance test files listed in section 2.
- Do not modify `src/**` in this task.

### 4.1 Canonical fixtures

- [ ] **Step 1: create `tests/fixtures/forensics/remediationScoringCases.ts`**

The file must export exact valid TRON addresses and raw amounts:

```ts
import { UINT256_MAX_RAW } from "../../../src/approvals/allowanceState";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../../src/parser/transactionParser";
import type { ApprovalAllowanceStateV2, UsddPsmRouteObservationV1 } from "../../../src/types";

export const SUBJECT = "TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP";
export const OWNER = "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD";
export const VERIFY20 = "TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK";
export const BRIDGERS = "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s";
export const USDD_PSM = "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ";
export const APPROVAL_TX = "fde8e8925a5b0d65050bbfe102c21c79b508087113f955dd51f25514c2f823d1";
export const SWAP_TX = "c16e27c144732bee70de72c88f5e3e501ac2bd5bbcdad66f6edac5b66cd31743";
export const NOW = new Date("2026-07-13T10:00:00.000Z");

export function activeAllowance(raw = UINT256_MAX_RAW, spenderAddress = VERIFY20): ApprovalAllowanceStateV2 {
  return {
    version: "approval-allowance-v2",
    ownerAddress: OWNER,
    spenderAddress,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    confirmedAllowanceRaw: raw,
    isUnlimited: raw === UINT256_MAX_RAW,
    state: raw === "0" ? "confirmed_zero" : "confirmed_active",
    confirmedAt: NOW.toISOString(),
    freshUntil: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
    lastAttemptAt: NOW.toISOString(),
    failureCode: null,
    source: "official_usdt_allowance",
    observedApprovalTxHash: APPROVAL_TX
  };
}

export function psmObservation(input: Partial<UsddPsmRouteObservationV1> = {}): UsddPsmRouteObservationV1 {
  return {
    version: "usdd-psm-route-observation-v1",
    mode: "where",
    serviceId: "usdd_psm_gemjoin",
    serviceAddress: USDD_PSM,
    direction: "inbound_from_psm",
    amountRaw: "83000000",
    selectedAmountRaw: "100000000",
    hopCount: 1,
    serviceIdentityExact: true,
    amountContinuityExact: true,
    scoringEligible: true,
    ineligibilityReason: null,
    evidenceIds: ["tx-psm", "tx-selected"],
    ...input
  };
}
```

These five fixture addresses were validated with `TronWeb.isAddress` during plan self-review. Execution adds one fixture sanity test and must not weaken runtime address validation.

### 4.2 Required RED tests

All tests must be registered by Vitest before a missing Plan 2 target is loaded.
Files created only in Tasks 2–8 are therefore loaded inside the individual test
body with `vi.importActual`; they are never imported at module top level in the
RED commit. Existing Plan 1 modules may be imported normally. Example:

```ts
it("[REQ-05][REQ-15] rejects invalid ScoreAnchorV2 or preferredFactId binding", async () => {
  const target = await vi.importActual<Record<string, unknown>>(
    "../../src/risk/scoreAnchorV2"
  );
  expect(target.validateScoreAnchorV2).toBeTypeOf("function");
});
```

At the base SHA this test is discovered and fails inside the test because the
target module/behavior is absent. Once the production module exists, the same
test body continues to the complete assertions below; the GREEN stage does not
replace or weaken the RED assertion. `npm run typecheck` may be RED because new
production types are absent, but syntax, fixture validity, database setup and
test discovery must be valid.

- [ ] **Step 2: add ScoreAnchor RED tests**

`tests/risk/scoreAnchorV2.acceptance.test.ts` contains these exact tests and assertions:

| Test name | Required assertion | Expected initial RED |
|---|---|---|
| `[REQ-04][REQ-15] keeps exact proof decline with unrelated partial coverage and a valid anchor` | exact hard candidate → `DECLINE`, numeric score, non-null valid anchor, `coverage=partial` retained | `scoreAnchorV2` export/result field absent |
| `[REQ-04][REQ-15][REQ-38] publishes no score when required coverage is invalid and no exact proof applies` | `NO_FINAL_DECISION`, `finalScore=null`, `scoreValid=false`, anchor null | v2 result still publishes matrix score without v3 binding |
| `[REQ-05][REQ-15] rejects invalid ScoreAnchorV2 or preferredFactId binding` | every invalid case below throws/returns `score_anchor_fact_binding_failed`; no fallback fact | validator absent |
| `[REQ-05] keeps contract safety separate from ordinary transfer scoring` | adding deterministic Contract context does not remove Fast/Deep/Where candidates | v3 integration absent |
| `[REQ-17] preserves a material relationship with a currently blacklisted counterparty` | before/during/unknown chronology remains eligible policy risk; only chronology metadata differs | new ID-linked regression absent |

The third test parameterizes these invalid cases against `validateScoreAnchorV2`:

```ts
const invalidCases = [
  "missing_preferred_fact",
  "duplicate_evidence_id",
  "wrong_subject",
  "coverage_fact_preferred",
  "primary_evidence_mismatch",
  "unregistered_policy_row"
] as const;
```

Every case expects `score_anchor_fact_binding_failed`; it must not expect a heuristic fallback fact.

- [ ] **Step 3: add collector and USDD RED tests**

`tests/risk/collectorUsddRemediation.acceptance.test.ts` contains the exact named cases below:

| Test name | Input/result assertion |
|---|---|
| `[AC-01] caps collector-only evidence at REVIEW 35` | one historical-transit episode → winner `behavior_only_prior`, score `35`, decision `REVIEW`, no decline authority |
| `[AC-02] allows collector 55 only with an independent eligible AML signal` | collector episode A + eligible AML episode B → composed `55 REVIEW` with unioned evidence |
| `[AC-02] does not treat the same evidence episode as an independent signal` | collector and secondary fact share episode id → no composed candidate, remains `35` |
| `[AC-03] scores 2 percent outbound USDD PSM with direction adjustment` | `2/100 outbound where` → base `3`, adjusted `3`, applied `2`, candidate `22` |
| `[AC-04] scores 83 percent direct inbound USDD PSM at top tier` | `83/100 inbound where` → applied `25`, candidate `45 REVIEW` |
| `[AC-05] halves historical Deep USDD PSM and caps modifier at 12` | `83/100 inbound deep_history` → mode/applied `12`, candidate `32 REVIEW` |
| `[AC-06] keeps label-only or discontinuous USDD PSM unscored` | each ineligible Plan 1 observation → exposure/candidate `null` |

Exact assertions:

```ts
expect(outbound2).toMatchObject({ baseModifier: 3, modeAdjustedModifier: 3, appliedModifier: 2 });
expect(inbound83).toMatchObject({ baseModifier: 25, modeAdjustedModifier: 25, appliedModifier: 25 });
expect(deep83).toMatchObject({ baseModifier: 25, modeAdjustedModifier: 12, appliedModifier: 12 });
expect(psmOnlyCandidate.score).toBe(45);
expect(psmOnlyCandidate.authority).toMatchObject({ kind: "context" });
expect(inexactCandidate).toBeNull();
```

Add table-driven boundary assertions for exact integer shares `4.999999%`, `5%`, `20%`, `50%`, `80%`, `100%`; thresholds enter the next tier and no floating-point tier selection is allowed.

- [ ] **Step 4: add Approval Safety RED tests**

`tests/approvals/approvalSafetyV2.acceptance.test.ts` contains these exact named cases:

| Test name | Required result |
|---|---|
| `[AC-19] scores confirmed unlimited Verify20 approval at CRITICAL 90` | `CRITICAL/90/REVOKE_NOW`, exact Verify20, no debit claim, AML `0` |
| `[AC-22] caps one selector or provider name at review context` | score `<=35`; exactVerify20 false |
| `[AC-23] removes active threat after confirmed zero allowance` | `LOW/0/NONE`; historical approval hash retained |
| `[AC-25] recognizes exact Bridgers 66-second 91.103009 session as LOW 10` | exact `KnownServiceSessionV1`; `LOW/10/REVOKE_IF_UNUSED`, AML `0` |
| `[AC-26] refuses service-session dampener for tag-only evidence` | session null and result not `LOW 10` |
| `[AC-28] removes transaction expiration from approval risk` | no reason/modifier `approval_extended_expiration`; score unchanged when only envelope expiry changes |
| `[AC-31] keeps exact Bridgers approval session LOW instead of decline` | `LOW 10`, not decline projection |
| `[AC-32] keeps known-service unlimited approval without session at REVIEW 45` | `MEDIUM/45/REVOKE_IF_UNUSED`, AML `0` |
| `[AC-33] prevents service dampening of provider risk Verify20 or debit proof` | exact debit `95`, provider risk `90`, Verify20 `90`; service/LLM inputs do not lower them |

Canonical result assertions:

```ts
expect(verify20Unlimited).toMatchObject({
  level: "CRITICAL", score: 90, action: "REVOKE_NOW", amlScoreImpact: 0,
  exactVerify20: true, exactDebit: false, debitFoundFromSubject: false
});
expect(confirmedZero).toMatchObject({ level: "LOW", score: 0, action: "NONE", amlScoreImpact: 0 });
expect(exactBridgers).toMatchObject({ level: "LOW", score: 10, action: "REVOKE_IF_UNUSED", amlScoreImpact: 0 });
expect(tagOnly).not.toMatchObject({ level: "LOW", score: 10 });
expect(expirationReasons).not.toContain("approval_extended_expiration");
```

- [ ] **Step 5: add deterministic Contract RED tests**

`tests/check/contractDecisionV2.acceptance.test.ts` contains these exact named cases:

| Test name | Required result |
|---|---|
| `[AC-29] resolves official TRON USDT at LOW 0 without LLM` | deterministic `LOW/0/ACCEPTABLE`, both model spies unused |
| `[AC-30] resolves GasFree Account at LOW 10 without LLM and keeps flows eligible` | deterministic `LOW/10`; model spies unused; principal candidate still present |
| `[AC-31] keeps exact Bridgers approval session LOW instead of decline` | deterministic `LOW/10`, finalSource deterministic |
| `[AC-32] keeps known-service unlimited approval without session at REVIEW 45` | deterministic `MEDIUM/45/REVIEW`, not AML decline |
| `[AC-33] prevents service or LLM dampening of provider risk Verify20 or debit proof` | exact bad authority remains at its deterministic score/decision under benign LLM/service input |
| `[AC-40] bypasses Flash and Pro for every deterministic service case` | table over official USDT, GasFree Account, Bridgers session, known service, Verify20/provider risk/debit; both spies count zero |
| `[REQ-08] keeps victim spender receiver and route roles distinct and leaves ordinary transferFrom as context` | an ordinary `transferFrom` keeps explicit roles, `exactVerify20=false`, no drainer authority and no receiver/spender role substitution |

Each no-call test uses two spies:

```ts
const flash = vi.fn(async () => { throw new Error("Flash must not run"); });
const pro = vi.fn(async () => { throw new Error("Pro must not run"); });
expect(flash).not.toHaveBeenCalled();
expect(pro).not.toHaveBeenCalled();
expect(result.finalSource).toBe("deterministic");
```

The GasFree test separately calls the existing transfer candidate builder and proves a principal edge is still present; standalone contract safety must not create a transfer exemption.

- [ ] **Step 6: add strict LLM RED tests**

`tests/forensics/contractLlmValidation.acceptance.test.ts` contains these exact cases:

| Test name | Table/input | Required result |
|---|---|---|
| `[AC-34] rejects invalid fractional non-finite out-of-range and missing LLM score: %s` | `65.5`, `NaN`, `Infinity`, `-1`, `101`, `undefined` | validator returns `null`; no clamp/default |
| `[AC-35] rejects contradictory LLM recommendation pairs` | legitimate+DECLINE, risky+ACCEPTABLE | `null` |
| `[AC-35] ignores recommendation for unknown_insufficient_data` | allowed structure with either raw recommendation | valid object with normalized recommendation `null` |
| `[AC-36] retains only citations present in the current case file` | one current + one foreign id, for live and cache | only current id retained |
| `[AC-37] makes uncited risky LLM verdict unavailable` | risky response whose citations filter to empty | `null` |
| `[AC-38] preserves deterministic result on LLM %s failure` | timeout, invalid_json, invalid_schema | `llm=null`; deterministic object deep-equal before/after |

Accepted risky output must cite `caseFile.evidenceIds`; cache adaptation must not replace foreign citations with `caseFile.evidenceIds.slice(...)`.

- [ ] **Step 7: add the first-batch PostgreSQL RED test**

`tests/approvals/approvalSafety.postgres.test.ts` runs only when `REQUIRE_PLAN2_POSTGRES=1` and uses a random watched-wallet id. It must:

1. persist fresh max allowance with `saveWalletApprovalAllowanceStateV2`;
2. read it through `listWalletApprovals`;
3. pass the returned `allowanceStateV2` to the new assessment resolver;
4. assert AC-19 `90/CRITICAL`;
5. persist a later confirmed zero direct-call state;
6. read again and assert AC-23 `0/LOW` and historical approval tx retained.

The exact test names are `[REQ-19][AC-19][POSTGRES] scores the persisted fresh direct allowance state` and `[REQ-19][AC-23][POSTGRES] removes active threat after a later confirmed zero`. The first asserts the stored/reloaded max state produces `90/CRITICAL`; the second asserts a later stored/reloaded zero produces `0/LOW` while `observedApprovalTxHash` remains unchanged.

Use transaction/schema cleanup in `finally`; never connect to port `5432`.

- [ ] **Step 8: run and record the expected RED batch**

```powershell
$env:REQUIRE_PLAN2_POSTGRES = '1'
$env:TEST_DATABASE_URL = 'postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan2'
npx vitest run --configLoader bundle `
  tests/risk/scoreAnchorV2.acceptance.test.ts `
  tests/risk/collectorUsddRemediation.acceptance.test.ts `
  tests/approvals/approvalSafetyV2.acceptance.test.ts `
  tests/approvals/approvalSafety.postgres.test.ts `
  tests/check/contractDecisionV2.acceptance.test.ts `
  tests/forensics/contractLlmValidation.acceptance.test.ts
npm run typecheck
```

Expected RED:

- every listed ID-linked test is discovered;
- failures are missing target exports/behavior, not fixture syntax, invalid addresses, DB authentication or production connectivity;
- existing tests imported by the batch do not fail first;
- PostgreSQL creates/cleans its disposable rows/schema.

- [ ] **Step 9: commit RED tests only**

```powershell
git add tests/fixtures/forensics/remediationScoringCases.ts `
  tests/risk/scoreAnchorV2.acceptance.test.ts `
  tests/risk/collectorUsddRemediation.acceptance.test.ts `
  tests/approvals/approvalSafetyV2.acceptance.test.ts `
  tests/approvals/approvalSafety.postgres.test.ts `
  tests/check/contractDecisionV2.acceptance.test.ts `
  tests/forensics/contractLlmValidation.acceptance.test.ts
git commit -m "test: define scoring and contract remediation acceptance"
```

Required review: independent spec-review, then code-quality review of fixtures/tests. Fix and re-review before Task 2.

## 5. Task 2 — strict ScoreAnchorV2 and subject-bound facts

**Files:**

- Create `src/risk/scoreAnchorV2.ts`.
- Modify `src/types.ts`.
- Modify `src/risk/scoringSignalMatrix.ts`.
- Modify `src/risk/finalDisposition.ts`.
- Modify `src/risk/unifiedWalletRisk.ts`.
- Modify `src/risk/unifiedIncomingDepositRisk.ts`.
- Modify `src/check/whereIsMoneyCheck.ts` only for typed result fields.
- Test `tests/risk/scoreAnchorV2.acceptance.test.ts` and existing unified/final-disposition suites.

- [ ] **Step 1: add the normative types exactly**

Add `ScoreAnchorV2` and `NarrativeFactV2` from the canonical spec plus the internal typed evidence envelope below. Fresh results add:

```ts
scoreAnchorV2: ScoreAnchorV2 | null;
narrativeFactsV2: NarrativeFactV2[];
scoringEvidenceV2: ScoringEvidenceV2[];
scoreAnchorDiagnostic: "score_anchor_fact_binding_failed" | null;
```

`ScoringEvidenceV2` is the concrete resolution target required by the canonical anchor invariant:

```ts
type ScoringEvidenceV2 = {
  id: string;
  subjectAddress: string;
  matrixRow: string;
  evidenceClass: string;
  authority: ScoreAnchorV2["authority"];
  sourceEvidenceIds: string[];
};
```

One envelope is materialized from each candidate that can become decisive. Anchor `evidenceIds` point to these envelopes, not to unresolved fallback strings. Transaction/raw/provider ids stay in `sourceEvidenceIds` and remain traceable to the owning report.

`scoreAnchorV2 === null` requires `finalScore === null`, `scoreValid === false` and `NO_FINAL_DECISION` on fresh v3 results. Legacy objects without the new policy marker are not normalized into v3.

- [ ] **Step 2: implement one explicit policy registry**

`src/risk/scoreAnchorV2.ts` exports:

```ts
export type ScoreAnchorBuildInput = {
  mode: ScoreAnchorV2["mode"];
  subjectAddress: string;
  disposition: FinalDisposition;
  matrix: MatrixScoringResult;
  facts: NarrativeFactV2[];
};

export function buildScoreAnchorV2(input: ScoreAnchorBuildInput): {
  anchor: ScoreAnchorV2 | null;
  diagnostic: "score_anchor_fact_binding_failed" | null;
};

export function validateScoreAnchorV2(input: {
  anchor: ScoreAnchorV2;
  checkedSubjectAddress: string;
  checkedMode: ScoreAnchorV2["mode"];
  evidence: ScoringEvidenceV2[];
  facts: NarrativeFactV2[];
}): ScoreAnchorV2;
```

The registry maps only `scoring-signal-matrix-v3` rows. It derives canonical proof/authority values; it never copies free provider/model text. It first materializes the winning and contributing candidates into unique subject-bound `ScoringEvidenceV2` envelopes. `preferredFactId` resolves once, has `section="score_reason"`, `isScoreDriver=true`, same subject, and an evidence set exactly equal to `primaryEvidenceIds`.

- [ ] **Step 3: create the preferred score fact deterministically**

For the decisive candidate create one fact whose stable id includes:

```ts
[policyVersion, mode, subjectAddress, matrixRow, ...sortedPrimaryEvidenceIds]
```

Use `factTextKey = ["score", matrixRow, firstAtomicSignal].join(".")`; do not put user copy or LLM prose in this module. Coverage/context facts cannot be preferred.

- [ ] **Step 4: bind final disposition to the anchor**

`resolveFinalDisposition` continues deciding exact proof vs coverage, but Wallet/Incoming assembly calls `buildScoreAnchorV2` before publishing a fresh result. If validation fails, replace only the published disposition with:

```ts
{
  decision: "NO_FINAL_DECISION",
  finalScore: null,
  scoreValid: false,
  decisionBasis: "technical_stop"
}
```

and persist diagnostic `score_anchor_fact_binding_failed`. Do not select another fact.

- [ ] **Step 5: preserve mode separation**

Wallet unified uses `mode="unified"`; Incoming uses `mode="incoming"`. Where stores a `mode="where"` anchor made from its subject-bound dominant policy layer only when its score mirror and evidence resolve exactly; the existing assessment score remains internal diagnostic input and Plan 4 may publish it only through that anchor. Contract uses its separate resolver in Task 7. A Contract result is an input/context only and never skips Fast/Deep/Where candidate construction.

- [ ] **Step 6: run GREEN tests**

```powershell
npx vitest run --configLoader bundle `
  tests/risk/scoreAnchorV2.acceptance.test.ts `
  tests/risk/finalDisposition.test.ts `
  tests/risk/scoringSignalMatrix.test.ts `
  tests/risk/unifiedWalletRisk.test.ts `
  tests/forensics/incomingDepositJob.test.ts
npm run typecheck
```

Expected: new REQ tests GREEN; existing exact-proof/coverage tests remain GREEN; no Telegram test changed.

- [ ] **Step 7: commit**

```powershell
git add src/types.ts src/risk/scoreAnchorV2.ts src/risk/scoringSignalMatrix.ts `
  src/risk/finalDisposition.ts src/risk/unifiedWalletRisk.ts `
  src/risk/unifiedIncomingDepositRisk.ts src/check/whereIsMoneyCheck.ts `
  tests/risk/scoreAnchorV2.acceptance.test.ts
git commit -m "feat: bind fresh scores to canonical evidence"
```

Required review: spec-review then code-quality review; both must explicitly inspect all ten anchor invariants.

## 6. Task 3 — collector cap/composition and blacklist regression

**Files:**

- Modify `src/risk/scoringSignalMatrix.ts`.
- Modify `src/risk/scoringSignalMatrixInputs.ts`.
- Test `tests/risk/collectorUsddRemediation.acceptance.test.ts` for AC-01/02.
- Test `tests/risk/scoreAnchorV2.acceptance.test.ts` for REQ-17.
- Modify contradictory existing unified tests only after the new AC tests are RED.

- [ ] **Step 1: make collector-only a review-only behavior candidate**

Historical transit/collector candidate becomes:

```ts
{
  row: "behavior_only_prior",
  score: 35,
  authority: { kind: "context" },
  atomicSignals: ["collector_transit_behavior"],
  caps: ["collector_only_cap_35"]
}
```

Remove `service_anchor` and any `can_decline` authority from collector behavior alone.

- [ ] **Step 2: compose 55 only from independent episodes**

Before winner selection, synthesize one review-only candidate only when:

- a collector candidate exists;
- another non-coverage/non-clean AML candidate exists;
- the sorted evidence-episode sets are disjoint;
- the second candidate is not another collector/behavior duplicate.

The composed candidate has score `55`, atomic signal
`collector_plus_independent_signal`, unioned evidence ids and:

```ts
authority: {
  kind: "pattern",
  decisionEligibility: "review_only",
  coverageDependency: context.coverageDependency
}
```

The input builder must supply `wallet_provenance` for Wallet/Deep/Where
composition and `deposit_provenance` for Incoming composition; `none` is
rejected for this behavioral row. `ScoreAnchorV2` maps either non-none internal
dependency to canonical `coverageDependency="required"`. Exact hard/policy
candidates keep their own authority and can still win independently.

- [ ] **Step 3: pin blacklist behavior**

Add a new `[REQ-17]` test proving a material direct counterparty currently blacklisted remains high policy risk whether the transfer is before, during or unknown relative to the event. Only chronology metadata changes; score eligibility does not. Exact GasFree fee and dust fixtures remain excluded.

- [ ] **Step 4: run GREEN tests**

```powershell
npx vitest run --configLoader bundle `
  tests/risk/collectorUsddRemediation.acceptance.test.ts `
  tests/risk/scoreAnchorV2.acceptance.test.ts `
  tests/risk/scoringSignalMatrix.test.ts `
  tests/risk/scoringSignalMatrixInputs.test.ts `
  tests/risk/unifiedWalletRisk.test.ts
```

Expected: AC-01/02 and REQ-17 GREEN; old tests expecting collector HIGH are updated to `35` or `55` only after the new acceptance proof exists.

- [ ] **Step 5: commit**

```powershell
git add src/risk/scoringSignalMatrix.ts src/risk/scoringSignalMatrixInputs.ts `
  tests/risk/collectorUsddRemediation.acceptance.test.ts `
  tests/risk/scoreAnchorV2.acceptance.test.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "fix: bound collector behavior scoring"
```

Required review: spec-review then code-quality review, including same-episode adversarial cases.

## 7. Task 4 — exact USDD PSM modifier and matrix integration

**Files:**

- Create `src/risk/usddPsmExposure.ts`.
- Modify `src/risk/scoringSignalMatrixInputs.ts`.
- Modify `src/check/deepForensicCheck.ts` only to carry optional typed `deep_history` observations already conforming to Plan 1.
- Modify `src/types.ts` to add the currently absent optional Deep `usddPsmRouteObservations` field.
- Test `tests/risk/collectorUsddRemediation.acceptance.test.ts` AC-03…06.
- Reuse `tests/forensics/usddPsmRouteObservation.test.ts` as data regression, not as AC proof.

- [ ] **Step 1: implement integer-only tiering**

Export:

```ts
export function buildUsddPsmExposure(
  observation: UsddPsmRouteObservationV1
): UsddPsmExposureV1 | null;

export function usddPsmMatrixCandidate(input: {
  exposure: UsddPsmExposureV1;
  context: MatrixCandidateContext;
}): MatrixCandidate;
```

Tier comparisons use `BigInt(amountRaw) * 100n` against `BigInt(selectedAmountRaw) * threshold`. Half-up division by two is `(value + 1) / 2` for non-negative integers. Formula order is exactly:

```ts
const modeAdjusted = mode === "deep_history"
  ? Math.min(12, Math.floor(baseModifier / 2 + 0.5))
  : baseModifier;
const applied = direction === "outbound_to_psm"
  ? Math.floor(modeAdjusted / 2 + 0.5)
  : modeAdjusted;
```

- [ ] **Step 2: integrate the existing source-policy base**

The PSM-only context candidate uses the existing source-policy context base `20`:

```ts
score = Math.min(45, 20 + exposure.appliedModifier)
```

It is review-only context, never `can_decline`. This yields exact canonical cases:

- 2% outbound Where: modifier `2`, candidate `22`;
- 83% inbound Where: modifier `25`, candidate `45 REVIEW`;
- 83% inbound Deep: modifier `12`, candidate `32 REVIEW`;
- 83% outbound Deep: modifier `6`, candidate `26`.

If another independent candidate exists, normal matrix winner/composition applies; PSM never promotes its own authority.

- [ ] **Step 3: accept only Plan 1 eligible observations**

Return `null` unless all are true:

```ts
observation.scoringEligible === true
observation.ineligibilityReason === null
observation.serviceAddress === "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ"
observation.serviceIdentityExact === true
observation.amountContinuityExact === true
observation.hopCount === 1 || observation.hopCount === 2
evidenceIds.length > 0
0 < amountRaw <= selectedAmountRaw
```

Provider labels/free text never create an exposure.

- [ ] **Step 4: run GREEN tests**

```powershell
npx vitest run --configLoader bundle `
  tests/risk/collectorUsddRemediation.acceptance.test.ts `
  tests/forensics/usddPsmRouteObservation.test.ts `
  tests/risk/scoringSignalMatrixInputs.test.ts `
  tests/check/deepForensicCheck.test.ts
npm run typecheck
```

Expected: AC-03…06 GREEN including all tier boundaries and half-up examples; no copy assertion exists.

- [ ] **Step 5: commit**

```powershell
git add src/risk/usddPsmExposure.ts src/risk/scoringSignalMatrixInputs.ts `
  src/check/deepForensicCheck.ts src/types.ts `
  tests/risk/collectorUsddRemediation.acceptance.test.ts
git commit -m "feat: score exact usdd psm exposure"
```

Required review: spec-review then code-quality review; reviewer must check BigInt thresholds and `20 + modifier` cap arithmetic.

## 8. Task 5 — direct official-USDT allowance refresh

**Files:**

- Create `src/approvals/allowanceRefresh.ts`.
- Modify `src/tron/tronClient.ts`.
- Modify `src/approvals/approvalWorker.ts`.
- Modify `src/index.ts` only for dependency injection.
- Test `tests/tron/tronClient.test.ts`, `tests/approvals/approvalWorker.test.ts`, `tests/approvals/allowanceState.test.ts`, `tests/approvals/approvalSafety.postgres.test.ts`.

- [ ] **Step 1: add the exact constant-call API**

Extend `TronApprovalClient`:

```ts
getUsdtAllowance(input: {
  ownerAddress: string;
  spenderAddress: string;
}): Promise<string>;
```

The full-node payload uses official USDT. Encode each TRON Base58 address as an
ABI address word by validating the canonical 21-byte TRON hex form, removing
the `41` network prefix, and left-padding the remaining 20 bytes to 32 bytes:

```ts
function tronAddressWord(address: string): string {
  const hex = TronWeb.address.toHex(address);
  if (!/^41[0-9a-fA-F]{40}$/.test(hex)) {
    throw new Error("invalid_tron_address");
  }
  return hex.slice(2).toLowerCase().padStart(64, "0");
}

const parameter = `${tronAddressWord(ownerAddress)}${tronAddressWord(spenderAddress)}`;
```

The request fields are then:

```json
{
  "function_selector": "allowance(address,address)",
  "parameter": "000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
```

The `a` and `b` words above are the deterministic output of
`tronAddressWord(ownerAddress)` and `tronAddressWord(spenderAddress)` in the
preceding executable formula; tests assert the actual fixture-derived payload,
not this illustrative nibble value.

The response must be canonical uint256 decimal. Wrong network/address, revert, missing/non-hex/multiword result and overflow map to the exact Plan 1 failure allowlist.

- [ ] **Step 2: build current state from one clocked attempt**

`refreshApprovalAllowance` accepts `{client, ownerAddress, spenderAddress, observedApprovalTxHash, now}` and returns one validated `ApprovalAllowanceStateV2`:

- success `0` → `confirmed_zero`;
- success `>0` → `confirmed_active` and exact max detection;
- failure → `failed`, `isUnlimited=null`, no invented current raw;
- `confirmedAt=lastAttemptAt=now`, `freshUntil=now+15m` on success.

- [ ] **Step 3: stop deriving current allowance from Approval event amount**

In `approvalWorker`, event `amountRaw` remains historical. Before final safety evaluation:

1. call `refreshApprovalAllowance` in both the new-event and no-new-change branches;
2. save it through `saveWalletApprovalAllowanceStateV2` dependency;
3. pass that exact state to Task 6 resolver.

Do not write `currentAllowanceRaw: approval.amountRaw` or `event.amountRaw` as current truth. For a failed call, persist failed state and continue with `UNKNOWN`, not active/revoked.

- [ ] **Step 4: wire dependencies without lifecycle changes**

`src/index.ts` only passes:

```ts
getUsdtAllowance: (input) => tronClient.getUsdtAllowance(input),
saveWalletApprovalAllowanceStateV2: (input) => saveWalletApprovalAllowanceStateV2(db, input)
```

No new timer, worker, queue, delivery or startup behavior. Periodic/stale Safety refresh remains Plan 3 integration under REQ-19 secondary ownership.

- [ ] **Step 5: run GREEN tests including PostgreSQL**

```powershell
$env:REQUIRE_PLAN2_POSTGRES = '1'
$env:TEST_DATABASE_URL = 'postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan2'
npx vitest run --configLoader bundle `
  tests/tron/tronClient.test.ts `
  tests/approvals/allowanceState.test.ts `
  tests/approvals/approvalWorker.test.ts `
  tests/approvals/approvalSafety.postgres.test.ts `
  tests/storage/allowanceCausality.postgres.test.ts
npm run typecheck
```

Expected: payload/binding/failure tests GREEN; PostgreSQL preserves causal ordering; production DB untouched.

- [ ] **Step 6: commit**

```powershell
git add src/approvals/allowanceRefresh.ts src/tron/tronClient.ts `
  src/approvals/approvalWorker.ts src/index.ts tests/tron/tronClient.test.ts `
  tests/approvals/approvalWorker.test.ts tests/approvals/approvalSafety.postgres.test.ts
git commit -m "feat: confirm current usdt allowance directly"
```

Required review: spec-review then code-quality review; reviewer must inspect exact owner/spender/token binding and verify no event-derived current allowance remains.

## 9. Task 6 — wallet-safety assessment and exact Bridgers session

**Files:**

- Create `src/approvals/approvalSafetyAssessment.ts`.
- Create `src/approvals/knownServiceRegistry.ts`.
- Modify `src/types.ts`.
- Modify `src/approvals/sessionContext.ts`.
- Modify `src/approvals/approvalRisk.ts`.
- Modify `src/approvals/approvalWorker.ts`.
- Test `tests/approvals/approvalSafetyV2.acceptance.test.ts`, `tests/approvals/sessionContext.test.ts`, `tests/approvals/approvalRisk.test.ts`.

- [ ] **Step 1: add exact service registry and session contract**

Registry entry:

```ts
{
  id: "bridgers",
  spenderAddress: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
  actionKinds: ["swap", "bridge", "router"]
}
```

`KnownServiceSessionV1` is emitted only when the same wallet initiated a successful action, the action is within the configured session window, the exact registry address is involved, moved raw amount is canonical, and transfer/action continuity is exact. A provider tag alone returns `null`.

- [ ] **Step 2: implement precedence in one pure resolver**

`evaluateApprovalSafetyV2` applies this order:

```text
exact debit from subject                 -> CRITICAL 95 REVOKE_NOW
failed/stale allowance                   -> UNKNOWN null CONFIRM_ALLOWANCE
confirmed zero                           -> LOW 0 NONE
exact Verify20 + unlimited               -> CRITICAL 90 REVOKE_NOW
exact Verify20 + finite >=100 USDT       -> HIGH 75 REVOKE_NOW
exact Verify20 + finite <100 USDT        -> MEDIUM 45 REVOKE_IF_UNUSED
exact known-service session              -> LOW 10 REVOKE_IF_UNUSED
authoritative known service, no session  -> MEDIUM 45 REVOKE_IF_UNUSED
one selector/name/free text only         -> MEDIUM <=35 REVOKE_IF_UNUSED
```

Every result has `amlScoreImpact: 0`. `balanceAtRiskRaw`, campaign ids and `debitFoundFromSubject` are preserved for Plan 4 but do not change the above evidence class except exact debit.

- [ ] **Step 3: remove transaction expiration from risk**

Keep `transactionExpirationAt` only as raw signing diagnostic if current callers need it. Delete `approval_extended_expiration` generation and any score impact. Do not modify Telegram formatters in Plan 2; AC-27 remains RED/owned by Plan 4.

- [ ] **Step 4: keep a narrow legacy adapter**

Until Plan 4 replaces presentation, convert `ApprovalSafetyAssessmentV2` to the existing `RiskReport` without exchange decision semantics. The adapter uses the same numeric safety score only for the existing Approval Guard channel; it does not insert the value into unified AML candidates.

- [ ] **Step 5: run GREEN tests**

```powershell
npx vitest run --configLoader bundle `
  tests/approvals/approvalSafetyV2.acceptance.test.ts `
  tests/approvals/sessionContext.test.ts `
  tests/approvals/approvalRisk.test.ts `
  tests/approvals/approvalWorker.test.ts
npm run typecheck
```

Expected: AC-19/22/23/25/26/28/31/32/33 GREEN; old tag-only LOW15 and expiration-risk expectations are replaced only after new tests prove target behavior.

- [ ] **Step 6: commit**

```powershell
git add src/approvals/approvalSafetyAssessment.ts src/approvals/knownServiceRegistry.ts `
  src/approvals/sessionContext.ts src/approvals/approvalRisk.ts `
  src/approvals/approvalWorker.ts src/types.ts `
  tests/approvals/approvalSafetyV2.acceptance.test.ts `
  tests/approvals/sessionContext.test.ts tests/approvals/approvalRisk.test.ts `
  tests/approvals/approvalWorker.test.ts
git commit -m "feat: resolve approval wallet safety deterministically"
```

Required review: spec-review then code-quality review; reviewer must verify AML impact is literally `0` in types and every branch.

## 10. Task 7 — deterministic ContractDecisionV2 and no-call gates

**Files:**

- Create `src/forensics/contractDecision.ts`.
- Modify `src/types.ts`.
- Modify `src/check/smartContractCheck.ts`.
- Test `tests/check/contractDecisionV2.acceptance.test.ts` and `tests/check/smartContractCheck.test.ts`.

- [ ] **Step 1: implement deterministic authority order**

Export:

```ts
export function resolveContractDecisionV2(input: {
  subjectAddress: string;
  metadata: AddressMetadata;
  serviceClassification: ServiceClassification | null;
  contractProfile: ContractIntelligenceProfile | null;
  approvalSafetyAssessments: ApprovalSafetyAssessmentV2[];
  evidenceIds: string[];
}): { decision: ContractDecisionV2; llmEligible: boolean };
```

Priority:

1. exact debit / provider risk / exact Verify20;
2. official address registry;
3. structural GasFree Account (`evidence` contains exact `role:gasfree_account`, non-boundary);
4. exact known-service session;
5. authoritative deterministic service;
6. ambiguous metadata/context, which alone is LLM-eligible but bounded.

Every deterministic result has non-empty exact evidence ids. `finalSource` is always `deterministic`.

- [ ] **Step 2: add exact no-call guards**

`checkSmartContractAddress` resolves deterministic authority before calling the analyzer. It never calls LLM for:

- `TRON_USDT_CONTRACT_ADDRESS`;
- structural GasFree Account;
- exact Verify20/provider risk/exact debit;
- exact Bridgers session;
- authoritative known service result.

The default model remains Flash; Pro is never auto-called. A deterministic contract result does not remove normal wallet transfer candidates.

- [ ] **Step 3: make the legacy report a projection**

Fresh `SmartContractCheckReport` stores `contractDecisionV2`. Existing `riskScore`, `riskLevel`, `decision`, `reasons` become deterministic mirrors validated against it. LLM cannot change those fields. Invalid legacy stored reports remain legacy and are not upgraded.

- [ ] **Step 4: run GREEN tests**

```powershell
npx vitest run --configLoader bundle `
  tests/check/contractDecisionV2.acceptance.test.ts `
  tests/check/smartContractCheck.test.ts `
  tests/forensics/verify20Fingerprint.test.ts `
  tests/risk/scoreAnchorV2.acceptance.test.ts
npm run typecheck
```

Expected: AC-29/30/31/32/33/40 GREEN; existing exact Verify20 `85 DECLINE` remains deterministic; ordinary `transferFrom` alone remains bounded context.

- [ ] **Step 5: commit**

```powershell
git add src/forensics/contractDecision.ts src/check/smartContractCheck.ts `
  src/types.ts tests/check/contractDecisionV2.acceptance.test.ts `
  tests/check/smartContractCheck.test.ts
git commit -m "feat: make contract decisions deterministic"
```

Required review: spec-review then code-quality review; reviewer must exercise all no-call cases with both Flash and Pro spies.

## 11. Task 8 — strict subordinate LLM validation and cache integrity

**Files:**

- Create `src/forensics/contractLlmValidation.ts`.
- Modify `src/forensics/contractLlmVerdict.ts`.
- Modify `src/check/smartContractCheck.ts` only to attach validated optional interpretation.
- Modify `src/types.ts`.
- Test `tests/forensics/contractLlmValidation.acceptance.test.ts`, `tests/forensics/contractLlmVerdict.test.ts`, `tests/check/smartContractCheck.test.ts`.

- [ ] **Step 1: define strict validated output**

`ValidatedContractInterpretationV1` accepts only:

```ts
{
  verdict: "legitimate_service" | "drainer_like" | "unknown_suspicious" | "unknown_insufficient_data";
  confidence: number;                 // finite 0..1
  contractRiskScore: number;          // integer 0..100
  decisionRecommendation: "ACCEPTABLE" | "DECLINE" | null;
  citedEvidenceIds: string[];         // subset of current case file
  interpretationKeys: string[];       // deterministic catalogue keys, no raw prose
}
```

Pair rules:

- legitimate service + DECLINE → reject;
- risky verdict + ACCEPTABLE → reject;
- unknown insufficient → recommendation normalized to `null`;
- risky verdict after citation filtering requires at least one citation;
- fractional/non-finite/out-of-range/missing score → reject, never clamp/round/default.

- [ ] **Step 2: validate live and cached responses identically**

One function receives raw JSON plus current case file. Cache adaptation reparses the original stored response against the current case file. Unsupported citations are removed; no fallback citations are fabricated. If validation fails, the current interpretation is `null`.

- [ ] **Step 3: make failures diagnostic-only**

Timeout, unavailable provider, invalid JSON and invalid schema may be recorded as diagnostics/cache error rows, but:

```ts
contractDecisionV2.llm = null;
contractDecisionV2.deterministic = unchanged;
contractDecisionV2.finalSource = "deterministic";
```

Delete the old `65/DECLINE` unavailable fallback and any LLM-owned final-decision branch. Do not edit Telegram output; AC-39 stays Plan 4.

- [ ] **Step 4: run GREEN tests**

```powershell
npx vitest run --configLoader bundle `
  tests/forensics/contractLlmValidation.acceptance.test.ts `
  tests/forensics/contractLlmVerdict.test.ts `
  tests/check/contractDecisionV2.acceptance.test.ts `
  tests/check/smartContractCheck.test.ts
npm run typecheck
```

Expected: AC-34…38 GREEN; old permissive clamp/fallback/citation expectations are replaced; deterministic scores unchanged for all LLM failures.

- [ ] **Step 5: commit**

```powershell
git add src/forensics/contractLlmValidation.ts `
  src/forensics/contractLlmVerdict.ts src/check/smartContractCheck.ts `
  src/types.ts tests/forensics/contractLlmValidation.acceptance.test.ts `
  tests/forensics/contractLlmVerdict.test.ts tests/check/smartContractCheck.test.ts
git commit -m "fix: subordinate contract llm to deterministic evidence"
```

Required review: spec-review then code-quality review; reviewer must test live/cache parity and foreign-citation adversarial inputs.

## 12. Task 9 — compatibility, knowledge, PostgreSQL acceptance and scope audit

**Files:**

- Create `tests/risk/remediationScoringCompatibility.test.ts`.
- Modify only allowed existing regression tests needed for v3 mirrors.
- Modify knowledge files listed in section 2.
- No migration, Telegram, runtime/delivery or Address Poisoning file.

- [ ] **Step 1: add compatibility tests before adapter changes**

Add ID-linked cases proving:

```text
[REQ-01][REQ-30][COMPAT] structural GasFree principal stays eligible for latest-five scoring
[REQ-02][COMPAT] exact GasFree service fee remains excluded from v3 scoring candidates
[REQ-04][COMPAT] legacy v2 result is read without synthesizing ScoreAnchorV2
[REQ-05][COMPAT] direct contract result does not suppress Wallet/Incoming analysis
[REQ-18][COMPAT] ApprovalSafetyAssessmentV2 never enters AML score inputs
[REQ-38][COMPAT] invalid anchor/PSM/LLM stays fail-closed after JSON round-trip
```

The four v3/adapter cases are expected RED before adapters and GREEN after the
minimum adapter changes. The two GasFree cases are new Plan 2 regression guards
over the already-implemented Plan 1 contract and may start GREEN; they are not
evidence for new Plan 2 behavior. Do not reinterpret old jobs.

- [ ] **Step 2: run the complete Plan 2 focused suite**

```powershell
$env:REQUIRE_PLAN2_POSTGRES = '1'
$env:TEST_DATABASE_URL = 'postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan2'
npx vitest run --configLoader bundle `
  tests/risk/scoreAnchorV2.acceptance.test.ts `
  tests/risk/collectorUsddRemediation.acceptance.test.ts `
  tests/approvals/approvalSafetyV2.acceptance.test.ts `
  tests/approvals/approvalSafety.postgres.test.ts `
  tests/check/contractDecisionV2.acceptance.test.ts `
  tests/forensics/contractLlmValidation.acceptance.test.ts `
  tests/risk/finalDisposition.test.ts `
  tests/risk/scoringSignalMatrix.test.ts `
  tests/risk/scoringSignalMatrixInputs.test.ts `
  tests/risk/unifiedWalletRisk.test.ts `
  tests/forensics/incomingDepositJob.test.ts `
  tests/approvals/allowanceState.test.ts `
  tests/approvals/approvalRisk.test.ts `
  tests/approvals/sessionContext.test.ts `
  tests/approvals/approvalWorker.test.ts `
  tests/forensics/usddPsmRouteObservation.test.ts `
  tests/forensics/contractLlmVerdict.test.ts `
  tests/check/smartContractCheck.test.ts `
  tests/tron/tronClient.test.ts `
  tests/storage/allowanceCausality.postgres.test.ts
```

Expected: every Plan 2-owned AC test GREEN; PostgreSQL tests actually execute, not skip.

- [ ] **Step 3: run typecheck and full regression**

```powershell
npm run typecheck
npm test
```

Expected: GREEN. This is Plan 2 regression evidence, not AC-41 release proof; Plan 5 reruns and owns AC-41.

- [ ] **Step 4: explicitly rerun Address Poisoning regressions read-only**

```powershell
npx vitest run --configLoader bundle `
  tests/monitor/addressPoisoning.test.ts `
  tests/monitor/addressPoisoningWorker.test.ts `
  tests/alerts/addressPoisoningAlert.test.ts
```

Expected: GREEN with zero Address Poisoning diff. This is non-regression only, not its closeout.

- [ ] **Step 5: update current knowledge with implemented behavior**

After code is GREEN:

- `05` — exact PSM modifiers for Where/Incoming and limits;
- `06` — historical Deep PSM half-weight only when exact observation exists;
- `07` — matrix v3, ScoreAnchor invariants, collector cap/composition, wallet-safety/AML separation;
- `09` — deterministic contract authority, strict LLM, production still unreleased until Plan 5;
- `10` — remove only gaps actually fixed; add any discovered unfixed recurring problem;
- `13` — update only if implementation reveals a new repeated mistake, not as routine changelog.

Do not update `08-admin-and-bot-ux.md`: Telegram presentation is not implemented. Do not claim runtime/deployment is current.

- [ ] **Step 6: run scope audit from the dynamic base**

```powershell
$PLAN2_BASE_SHA = (git config --get branch.codex/remediation-scoring-contract-semantics.plan2BaseSha).Trim()
git diff --check $PLAN2_BASE_SHA..HEAD
git diff --name-status $PLAN2_BASE_SHA..HEAD
git diff --name-only $PLAN2_BASE_SHA..HEAD -- `
  src/bot src/alerts src/admin src/monitor src/runtime migrations
git diff --name-only $PLAN2_BASE_SHA..HEAD -- `
  src/monitor/addressPoisoning.ts `
  src/monitor/addressPoisoningWorker.ts `
  src/alerts/addressPoisoningAlert.ts `
  tests/monitor/addressPoisoning.test.ts `
  tests/monitor/addressPoisoningWorker.test.ts `
  tests/alerts/addressPoisoningAlert.test.ts `
  tests/fixtures/monitor/addressPoisoningCases.ts `
  migrations/031_address_poisoning_monitor.sql
git diff --name-only $PLAN2_BASE_SHA..HEAD -- `
  docs/superpowers/plans | Where-Object { $_ -notmatch '2026-07-13-remediation-scoring-and-contract-semantics.md' }
```

Expected:

- `git diff --check` empty;
- forbidden source/migrations output empty;
- no Plans 3–5 created;
- no `package.json` dependency change;
- no production/deploy/runtime label change;
- Address Poisoning files absent.

`src/index.ts` is the only allowed orchestration file and only its direct allowance dependency injection may differ; reviewer checks its hunk manually.

- [ ] **Step 7: verify PostgreSQL and migration immutability**

```powershell
$env:DATABASE_URL = 'postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan2'
npx tsx scripts/migrate.ts
git diff --exit-code $PLAN2_BASE_SHA..HEAD -- migrations .gitattributes src/storage/schemaMigrations.ts scripts/migrate.ts
```

Expected:

- schema 32 already verified;
- no schema/migrator/LF-byte diff;
- Plan 2 PostgreSQL rows clean up after tests;
- production database untouched.

- [ ] **Step 8: commit knowledge/compatibility only**

```powershell
git add docs/knowledge/05-where-is-money-and-incoming.md `
  docs/knowledge/06-deepcheck.md docs/knowledge/07-risk-scoring-matrix.md `
  docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md `
  docs/knowledge/13-agent-observations.md `
  tests/risk/remediationScoringCompatibility.test.ts
git commit -m "docs: record scoring and contract semantics"
```

Stage only files actually changed. Do not add user-owned files from the main worktree.

- [ ] **Step 9: final independent reviews**

Run a whole-branch spec review against every Plan 2 REQ/AC, then a code-quality review. Any finding is fixed by the owning task and both reviews rerun. Required final evidence:

- exact base SHA and final HEAD;
- commit list;
- focused AC counts;
- PostgreSQL acceptance count;
- typecheck;
- full suite counts;
- scope audit;
- confirmation that production/runtime/Telegram were not changed.

## 13. Traceability matrix — REQ/AC → task → new test

Every test named below is introduced by Plan 2. Existing GREEN tests remain
regression support only and never satisfy a new AC by themselves.

### 13.1 REQ traceability

| Requirement | Ownership | Task | New concrete test(s) |
|---|---|---:|---|
| REQ-01 | regression integration | 9 | `[REQ-01][REQ-30][COMPAT] structural GasFree principal stays eligible for latest-five scoring` |
| REQ-02 | regression integration | 9 | `[REQ-02][COMPAT] exact GasFree service fee remains excluded from v3 scoring candidates` |
| REQ-04 | primary | 2, 9 | `[REQ-04][REQ-15] keeps exact proof decline with unrelated partial coverage and a valid anchor`; `[REQ-04][REQ-15][REQ-38] publishes no score when required coverage is invalid and no exact proof applies`; `[REQ-04][COMPAT] legacy v2 result is read without synthesizing ScoreAnchorV2` |
| REQ-05 | primary | 2, 7, 9 | `[REQ-05][REQ-15] rejects invalid ScoreAnchorV2 or preferredFactId binding`; `[REQ-05] keeps contract safety separate from ordinary transfer scoring`; `[REQ-05][COMPAT] direct contract result does not suppress Wallet/Incoming analysis` |
| REQ-08 | primary | 7 | `[REQ-08] keeps victim spender receiver and route roles distinct and leaves ordinary transferFrom as context` |
| REQ-15 | primary | 2 | the three new ScoreAnchor tests carrying `[REQ-15]` in `tests/risk/scoreAnchorV2.acceptance.test.ts` |
| REQ-16 | primary | 3 | `[AC-01] caps collector-only evidence at REVIEW 35`; both `[AC-02]` independent/same-episode tests |
| REQ-17 | primary | 3 | `[REQ-17] preserves a material relationship with a currently blacklisted counterparty` |
| REQ-18 | primary | 6, 9 | every Approval Safety AC asserts `amlScoreImpact: 0`; `[REQ-18][COMPAT] ApprovalSafetyAssessmentV2 never enters AML score inputs` |
| REQ-19 | secondary scoring integration | 5, 6 | `[REQ-19][AC-19][POSTGRES] scores the persisted fresh direct allowance state`; `[REQ-19][AC-23][POSTGRES] removes active threat after a later confirmed zero` |
| REQ-20 | primary | 6 | `[AC-19]`, `[AC-22]`, `[AC-23]` and `[AC-33]` Approval Safety tests |
| REQ-21 | primary | 6, 7 | `[AC-25]`, `[AC-26]`, `[AC-31]`, `[AC-32]` exact-session/service tests |
| REQ-22 | primary | 6 | `[AC-28] removes transaction expiration from approval risk` |
| REQ-23 | primary | 7, 8 | `[AC-33] prevents service or LLM dampening of provider risk Verify20 or debit proof`; `[AC-40] bypasses Flash and Pro for every deterministic service case`; `[AC-38] preserves deterministic result on LLM %s failure` |
| REQ-24 | primary | 7 | `[AC-29]`, `[AC-30]` and `[AC-40]` deterministic no-call tests |
| REQ-25 | primary | 7, 8 | `[AC-38] preserves deterministic result on LLM %s failure`; `[AC-40] bypasses Flash and Pro for every deterministic service case` |
| REQ-26 | primary | 8 | `[AC-34]`, both `[AC-35]`, `[AC-36]`, `[AC-37]` and `[AC-38]` strict-validation tests |
| REQ-28 | primary | 4 | `[AC-03]` through `[AC-06]` exact PSM identity/continuity/direction tests |
| REQ-29 | primary | 4 | `[AC-03]` through `[AC-06]` plus the exact 4.999999/5/20/50/80/100 percent boundary table |
| REQ-30 | regression integration | 9 | `[REQ-01][REQ-30][COMPAT] structural GasFree principal stays eligible for latest-five scoring` |
| REQ-38 | secondary scoring integration | 2, 4, 8, 9 | `[REQ-04][REQ-15][REQ-38] publishes no score when required coverage is invalid and no exact proof applies`; `[AC-06]`; `[AC-34]` through `[AC-38]`; `[REQ-38][COMPAT] invalid anchor/PSM/LLM stays fail-closed after JSON round-trip` |

### 13.2 AC traceability

| AC | Task | New test file | New exact test name |
|---|---:|---|---|
| AC-01 | 3 | `tests/risk/collectorUsddRemediation.acceptance.test.ts` | `[AC-01] caps collector-only evidence at REVIEW 35` |
| AC-02 | 3 | same | `[AC-02] allows collector 55 only with an independent eligible AML signal`; `[AC-02] does not treat the same evidence episode as an independent signal` |
| AC-03 | 4 | same | `[AC-03] scores 2 percent outbound USDD PSM with direction adjustment` |
| AC-04 | 4 | same | `[AC-04] scores 83 percent direct inbound USDD PSM at top tier` |
| AC-05 | 4 | same | `[AC-05] halves historical Deep USDD PSM and caps modifier at 12` |
| AC-06 | 4 | same | `[AC-06] keeps label-only or discontinuous USDD PSM unscored` |
| AC-19 | 5, 6 | `tests/approvals/approvalSafetyV2.acceptance.test.ts`; `tests/approvals/approvalSafety.postgres.test.ts` | `[AC-19] scores confirmed unlimited Verify20 approval at CRITICAL 90`; `[REQ-19][AC-19][POSTGRES] scores the persisted fresh direct allowance state` |
| AC-22 | 6 | `tests/approvals/approvalSafetyV2.acceptance.test.ts` | `[AC-22] caps one selector or provider name at review context` |
| AC-23 | 5, 6 | same plus PostgreSQL file | `[AC-23] removes active threat after confirmed zero allowance`; `[REQ-19][AC-23][POSTGRES] removes active threat after a later confirmed zero` |
| AC-25 | 6 | same | `[AC-25] recognizes exact Bridgers 66-second 91.103009 session as LOW 10` |
| AC-26 | 6 | same | `[AC-26] refuses service-session dampener for tag-only evidence` |
| AC-28 | 6 | same | `[AC-28] removes transaction expiration from approval risk` |
| AC-29 | 7 | `tests/check/contractDecisionV2.acceptance.test.ts` | `[AC-29] resolves official TRON USDT at LOW 0 without LLM` |
| AC-30 | 7 | same | `[AC-30] resolves GasFree Account at LOW 10 without LLM and keeps flows eligible` |
| AC-31 | 6, 7 | both Approval Safety and Contract Decision acceptance files | `[AC-31] keeps exact Bridgers approval session LOW instead of decline` |
| AC-32 | 6, 7 | both files | `[AC-32] keeps known-service unlimited approval without session at REVIEW 45` |
| AC-33 | 6, 7 | both files | `[AC-33] prevents service or LLM dampening of provider risk Verify20 or debit proof` |
| AC-34 | 8 | `tests/forensics/contractLlmValidation.acceptance.test.ts` | `[AC-34] rejects invalid fractional non-finite out-of-range and missing LLM score: %s` |
| AC-35 | 8 | same | `[AC-35] rejects contradictory LLM recommendation pairs`; `[AC-35] ignores recommendation for unknown_insufficient_data` |
| AC-36 | 8 | same | `[AC-36] retains only citations present in the current case file` |
| AC-37 | 8 | same | `[AC-37] makes uncited risky LLM verdict unavailable` |
| AC-38 | 8 | same | `[AC-38] preserves deterministic result on LLM %s failure` |
| AC-40 | 7 | `tests/check/contractDecisionV2.acceptance.test.ts` | `[AC-40] bypasses Flash and Pro for every deterministic service case` |

### 13.3 Sequential commit and review boundaries

| Task | Commit boundary | Required reviews before next task |
|---:|---|---|
| 0 | `docs: add scoring and contract remediation plan` — approved plan document only | independent spec-review; independent code-quality/safety review |
| 1 | `test: define scoring and contract remediation acceptance` — new RED tests/fixtures only | independent spec-review; independent code-quality review |
| 2 | `feat: bind fresh scores to canonical evidence` | independent spec-review of ten anchor invariants; independent code-quality review |
| 3 | `fix: bound collector behavior scoring` | independent spec-review; independent code-quality/adversarial episode review |
| 4 | `feat: score exact usdd psm exposure` | independent spec-review; independent BigInt/arithmetic code-quality review |
| 5 | `feat: confirm current usdt allowance directly` | independent spec-review; independent owner/spender/token code-quality review |
| 6 | `feat: resolve approval wallet safety deterministically` | independent spec-review; independent AML-isolation code-quality review |
| 7 | `feat: make contract decisions deterministic` | independent spec-review; independent no-call/authority code-quality review |
| 8 | `fix: subordinate contract llm to deterministic evidence` | independent spec-review; independent live/cache adversarial code-quality review |
| 9 | `docs: record scoring and contract semantics` — compatibility/knowledge only | whole-branch independent spec-review; whole-branch independent code-quality review |

## 14. Rollback

Plan 2 is code/policy only and adds no schema.

Before local merge:

```powershell
git worktree remove 'C:\Users\User\OneDrive\Desktop\smartcontract-remediation-scoring-contract-semantics'
git branch -D codex/remediation-scoring-contract-semantics
```

Use only after explicit discard confirmation. The main worktree and production remain unchanged.

After a future local merge but before Plan 5 release:

```powershell
$PLAN2_BASE_SHA = (git config --get branch.codex/remediation-scoring-contract-semantics.plan2BaseSha).Trim()
$plan2Commits = @(git rev-list "$PLAN2_BASE_SHA..HEAD")
foreach ($commit in $plan2Commits) {
  git revert --no-edit $commit
  if ($LASTEXITCODE -ne 0) {
    throw "Rollback stopped at $commit; resolve without discarding user files"
  }
}
```

Do not rewrite migration 032, drop production tables or reset user files. Disposable `tron_watch_plan2` may be dropped only after verifying its resolved target name is exactly `tron_watch_plan2`.

After Plan 5 release, rollback authority belongs to Plan 5 and must preserve schema 032 receipts while reverting policy/runtime as a coordinated release.

## 15. Self-review checklist

- [x] Primary ownership matches canonical REQ map; Plan 4 ACs 20/21/24/27/39 are excluded.
- [x] Every Plan 2-owned AC has a new test whose name starts with its ID.
- [x] Mandatory first RED batch includes REQ-05, REQ-28, AC-01…06, AC-19, AC-22, AC-25, AC-26, AC-29, AC-30, AC-34…38 and AC-40.
- [x] PostgreSQL runs in the first RED batch and final GREEN gate.
- [x] Plan 1 types are consumed, not redefined incompatibly.
- [x] Exact USDD formula, half-up order and `20 + modifier` bounded candidate are explicit.
- [x] ScoreAnchor subject/evidence/preferredFact invariants fail closed.
- [x] Allowance event, current direct call, wallet safety and AML are separate.
- [x] Exact Bridgers session is address-, caller-, time-, success- and amount-bound.
- [x] LLM cannot own or alter deterministic result; live/cache validation is identical.
- [x] No Telegram copy, delivery, Admin, migration, Address Poisoning or production work is included.
- [x] Dynamic `PLAN2_BASE_SHA`, RED/GREEN commands, rollback, knowledge updates and scope audit are specified.
- [x] Every task, including Task 0, has separate spec-review and code-quality review gates.
- [x] RED files lazy-load not-yet-created production modules inside test bodies so every ID-linked test is discovered before the expected failure.
- [x] Address Poisoning source, schema, fixtures and tests are all explicit forbidden diff paths and are only executed read-only.
- [x] A complete REQ/AC → task → new-test matrix is present.
- [x] No Plan 3–5 document is created.

## 16. Approval checkpoint

Do not implement this plan, create its feature worktree, stage or commit this
plan document until the user approves it. After approval, Task 0 first captures
the dynamic `PLAN2_BASE_SHA` from the still-current local `master`, then makes
the single-file plan commit and creates the implementation worktree from that
plan commit. Production code begins only after Task 1 has discovered, recorded
and committed the expected RED tests.
