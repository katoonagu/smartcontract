# Scoring And Contract Semantics Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Внедрить детерминированные score anchors, collector/USDD scoring,
current-allowance wallet safety, exact known-service sessions и полностью
отключить автоматический contract/money-origin LLM — без Telegram redesign,
runtime/delivery изменений, production release и Address Poisoning.

**Architecture:** Plan 2 принимает typed data contracts Plan 1 как неизменяемый
вход. Pure policy modules сначала вычисляют `ScoreAnchorV2`,
`UsddPsmExposureV1`, `ApprovalSafetyAssessmentV2` и `ContractDecisionV2`;
orchestration только связывает их с существующими Wallet/Incoming/Approval/
Contract результатами. Fresh checks никогда не вызывают Flash/Pro и всегда
сохраняют `ContractDecisionV2.llm=null`; legacy LLM/cache остаётся отдельным
audit-only слоем, который не читают scoring, decision и presentation adapters.

**Tech Stack:** TypeScript 5.7, Node.js, Vitest, PostgreSQL 16 candidate database, existing `pg`, `tronweb` and `TronscanClient`; новых зависимостей нет.

---

Статус: на утверждении после review changes; code implementation не начат.

Канонический источник:

- `docs/superpowers/specs/2026-07-12-telegram-runtime-forensics-remediation-design.md`;
- утверждённая матрица `docs/audit/2026-07-12-telegram-runtime-forensics-conformance-audit.md`;
- Plan 1 foundation в локальном `master` на dynamic `PLAN2_BASE_SHA`.

Canonical section `4.6 LLM-disabled amendment` is the target source for
`REQ-23/25/26/38` and `AC-34…40`: automatic contract and money-origin LLM is
disabled for every fresh path, unknown contract uses deterministic `35 REVIEW`
only with subject-bound metadata context, and the narrow AC-39 legacy
Bot/Alert-section deletion belongs to Plan 2. Task 10 records implemented
behavior in current knowledge; no separate Plan 3–5 scope is pulled forward.

Planning baseline, read-only verified on 2026-07-13:

```text
PLAN2_PLANNING_MASTER_SHA=5c865d97ab2732b4fd0bb354ae41aeb0ea797b86
```

`PLAN2_BASE_SHA` remains the reviewed code baseline above. The original
plan-only commit is `51c5b3611fb29b686f7ca2f1f8cc837cb523c9d3`. Before
implementation, local `master` receives exactly two ordered amendment commits:
first the canonical remediation specification only, then this Plan 2 document
only. Task 0 verifies that the complete diff between `PLAN2_BASE_SHA` and the
implementation head contains exactly those two document paths and no other
file. Any code or unrelated document in that range blocks execution.

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
- `REQ-23` — contract и money-origin authority полностью deterministic; LLM не
  является входом;
- `REQ-24` — official USDT `LOW 0`, GasFree Account `LOW 10`, неизвестный
  контракт без exact bad/service proof, но с подтверждённым subject-bound
  `metadata_context`, получает `REVIEW 35`; все fresh cases bypass LLM;
- `REQ-25` — Flash и Pro автоматически не вызываются; fresh
  `ContractDecisionV2.llm=null`, legacy LLM/cache audit-only;
- `REQ-26` — fresh LLM output не принимается вообще; legacy score/verdict/
  recommendation/citations сохраняются как неприменяемый audit payload;
- `REQ-28` — exact USDD PSM interpretation и bounded semantics;
- `REQ-29` — exact integer USDD modifiers и standalone cap `45 REVIEW`.

Secondary integration, без смены primary ownership:

- `REQ-19(scoring)` — Plan 1 `ApprovalAllowanceStateV2` становится единственным
  current-allowance входом для safety score; Plan 2 выполняет direct refresh
  только после нового Approval event, при context finalization и явном safety
  recheck; migration ownership не переносится, а фоновый stale refresh остаётся
  Plan 3;
- `REQ-38(scoring)` — invalid anchor и inexact PSM fail-closed; любой fresh или
  legacy LLM payload не входит в active result;
- `REQ-01`, `REQ-02`, `REQ-30` regression-only — GasFree Account principal остаётся transfer-eligible, exact GasFree fee не возвращается в score.

Не входят:

- `REQ-06/07/09/11…14/27/31…34` presentation ownership Plan 4;
- `REQ-35…37` runtime/delivery ownership Plan 3;
- AC-20/21/24/27 — Plan 4. Canonical section 4.6 pulls only AC-39's
  exact LLM-output deletion into Task 8; the rest of Telegram UX stays Plan 4;
- AC-41 — final operational acceptance;
- любые Admin, callback, delivery, migration, deployment или Address Poisoning
  изменения; Telegram copy/layout кроме точного удаления двух legacy LLM
  секций в Task 8.

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
| AC-33 | Provider risk, exact Verify20 или exact debit не dampen-ится service context. |
| AC-34 | Любой fresh LLM score не применяется; `llm=null`. |
| AC-35 | Любые verdict/recommendation не применяются к fresh decision. |
| AC-36 | Legacy/cache citations audit-only и не становятся current evidence/facts. |
| AC-37 | Risky/uncited LLM payload не влияет на fresh result. |
| AC-38 | Fresh checks не вызывают provider; deterministic result не зависит от timeout/JSON/schema. |
| AC-39 | Fresh/legacy model verdict, confidence, reason and AI heading не рендерятся в Telegram/alerts. |
| AC-40 | Все fresh contract cases, включая ambiguous/unknown, bypass Flash и Pro. |

Кроме узкого `[AC-39]` Bot/Alert regression на удаление двух legacy LLM-секций,
presentation assertions в Plan 2 не добавляются. Все остальные tests проверяют
data/decision objects; единый Telegram text и layout остаются Plan 4.

### 1.3 Policy versions

Новые fresh results получают:

```ts
export const SCORING_SIGNAL_MATRIX_POLICY_VERSION = "scoring-signal-matrix-v3" as const;
export const APPROVAL_SAFETY_POLICY_VERSION = "2026-07-13-approval-safety-v2" as const;
export const CONTRACT_DECISION_POLICY_VERSION = "2026-07-13-contract-decision-v2" as const;
export const CONTRACT_LLM_POLICY_VERSION = "2026-07-13-contract-llm-disabled-v1" as const;
```

Старые сохранённые results остаются legacy. Код не создаёт для них `ScoreAnchorV2`, не пересчитывает их и не меняет прежнее сохранённое представление.

## 2. File map

### Create

- `src/risk/scoreAnchorV2.ts` — policy registry, canonical score fact, strict anchor validation и fail-closed binding.
- `src/risk/usddPsmExposure.ts` — BigInt tiering, half-up adjustments и bounded PSM matrix candidate.
- `src/approvals/allowanceRefresh.ts` — official-USDT constant-call adapter → strict `ApprovalAllowanceStateV2`.
- `src/approvals/approvalSafetyAssessment.ts` — deterministic wallet-safety resolver и legacy `RiskReport` adapter.
- `src/approvals/knownServiceRegistry.ts` — exact address-bound service identities; первый canonical entry — Bridgers.
- `src/forensics/contractDecision.ts` — fully deterministic authority resolver,
  strict assessment binding and unknown-contract `35 REVIEW` fallback.
- `tests/fixtures/forensics/remediationScoringCases.ts` — synthetic, explicitly non-on-chain fixtures for Plan 2.
- `tests/risk/scoreAnchorV2.acceptance.test.ts`.
- `tests/risk/collectorUsddRemediation.acceptance.test.ts`.
- `tests/approvals/approvalSafetyV2.acceptance.test.ts`.
- `tests/approvals/approvalSafety.postgres.test.ts`.
- `tests/check/contractDecisionV2.acceptance.test.ts`.
- `tests/forensics/contractLlmIsolation.acceptance.test.ts`.
- `tests/forensics/moneyOriginLlmIsolation.acceptance.test.ts`.
- `tests/risk/remediationScoringCompatibility.test.ts` — fresh/legacy round-trip and cross-domain separation.

### Modify

- `src/types.ts` — canonical Plan 2 contracts and optional fresh-result fields.
- `src/risk/scoringSignalMatrix.ts` — v3 policy, collector composition and registered row metadata.
- `src/risk/scoringSignalMatrixInputs.ts` — collector cap, USDD exposures, exact evidence IDs.
- `src/risk/finalDisposition.ts` — no numeric result without valid anchor binding.
- `src/risk/unifiedWalletRisk.ts` — active anchor/fact output for fresh Wallet result.
- `src/risk/unifiedIncomingDepositRisk.ts` — active anchor/fact output for fresh Incoming result.
- `src/check/whereIsMoneyCheck.ts` — subject-bound Where anchor plus removal of
  automatic contract-LLM case building/calls and fresh verdict output.
- `src/check/deepForensicCheck.ts` — optional typed Deep PSM exposure input and score integration only.
- `src/forensics/deepForensicJob.ts` — remove automatic analyzer dependency
  forwarding.
- `src/forensics/incomingDepositJob.ts` — remove live/cache LLM wrapper,
  deterministic-as-LLM adaptation and active legacy verdict projection.
- `src/approvals/allowanceState.ts` — export the canonical failure-code type/validator used by the refresh adapter.
- `src/approvals/sessionContext.ts` — exact `KnownServiceSessionV1` construction.
- `src/approvals/approvalRisk.ts` — safety adapter, no expiration risk, precedence rules.
- `src/approvals/approvalWorker.ts` — direct allowance refresh before final safety evaluation.
- `src/approvals/safetyRecheck.ts` — explicit recheck trigger only; no periodic stale refresh.
- `src/tron/tronClient.ts` — exact `allowance(address,address)` constant-call method.
- `src/check/smartContractCheck.ts` — fully deterministic
  `ContractDecisionV2`; analyzer dependency is never called for fresh checks.
- `src/forensics/contractLlmVerdict.ts` — legacy audit read/write isolation only;
  no fresh scoring/decision/presentation adapter.
- `src/forensics/moneyOriginOperationalAssessment.ts` — remove every LLM read
  from scoring, decision, dampening and active warnings/facts.
- `src/index.ts` — direct allowance dependency injection plus removal of
  automatic contract LLM analyzer construction/injection; no timer, delivery or
  deployment changes.
- `src/bot/createBot.ts` — delete only the obsolete AI-contract-verdict line/
  helper; no other Telegram copy/layout change.
- `src/alerts/formatters.ts` — delete only legacy contract-LLM sections; no
  other alert copy/layout change.
- `tests/approvals/safetyRecheck.test.ts`.
- `docs/knowledge/05-where-is-money-and-incoming.md`.
- `docs/knowledge/06-deepcheck.md`.
- `docs/knowledge/07-risk-scoring-matrix.md`.
- `docs/knowledge/08-admin-and-bot-ux.md` — record only that LLM output is no
  longer rendered; unified UX remains Plan 4.
- `docs/knowledge/09-current-decisions.md`.
- `docs/knowledge/10-open-problems.md` only for a discovered, unfixed recurring problem.
- `docs/knowledge/13-agent-observations.md` only for a new repeated agent mistake/user correction.

### Forbidden diff

```text
src/bot/** except src/bot/createBot.ts Task 8 exact LLM-line deletion
src/alerts/** except src/alerts/formatters.ts Task 8 exact LLM-section deletion
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

### 2.1 Mandatory task commit fence

Task 0 inspects the intentionally dirty main worktree read-only and creates a
clean feature worktree; it creates no commit. Tasks 1–10 each start clean,
commit all and only the files changed by that task, then prove the worktree is
clean before the next spec-review begins. The task's
`Files` list is its exact staging allowlist; an implementation worker may narrow
that list to files actually changed, but may not add another path implicitly.

Run this helper in the same PowerShell session for every task commit, with that
task's exact allowlist and message:

```powershell
function Commit-Plan2Task {
  param(
    [Parameter(Mandatory = $true)][string[]]$AllowedPaths,
    [Parameter(Mandatory = $true)][string]$Message
  )
  $changed = @(
    git status --porcelain=v1 |
      ForEach-Object { $_.Substring(3) } |
      Sort-Object -Unique
  )
  if ($changed.Count -eq 0) { throw "Task changed no files" }
  $unexpected = @($changed | Where-Object { $_ -notin $AllowedPaths })
  if ($unexpected.Count -ne 0) {
    throw "Out-of-task changes: $($unexpected -join ', ')"
  }
  git add -A -- $changed
  if ($LASTEXITCODE -ne 0) { throw "git add failed" }
  $staged = @(git diff --cached --name-only | Sort-Object -Unique)
  $delta = @(Compare-Object $changed $staged)
  if ($delta.Count -ne 0) {
    throw "Staged files do not exactly match task changes: $($delta | Out-String)"
  }
  git diff --cached --check
  if ($LASTEXITCODE -ne 0) { throw "staged diff check failed" }
  git commit -m $Message
  if ($LASTEXITCODE -ne 0) { throw "task commit failed" }
  if (@(git status --porcelain=v1).Count -ne 0) {
    throw "Task commit did not leave a clean worktree"
  }
}
```

Before each task, also run:

```powershell
if (@(git status --porcelain=v1).Count -ne 0) {
  throw "Previous task/review left the feature worktree dirty"
}
```

Review fixes belong to the task that owns the finding: amend that task commit
only while it is still the current task (or make one task-scoped follow-up
commit before downstream work), rerun both reviews, and prove a clean worktree
again. Never stage user-owned files from the main worktree.

## 3. Task 0 — verify code baseline, approved plan chain, isolated worktree and production fence

**Files:** none. Before Task 0 begins, the canonical amendment must be committed
alone and then the amended Plan 2 document must be committed alone.

- [ ] **Step 1: verify the recorded code base and plan-only commit chain without touching the dirty main worktree**

Run from `C:\Users\User\OneDrive\Desktop\smartcontract`:

```powershell
$SPEC_PATH = 'docs/superpowers/specs/2026-07-12-telegram-runtime-forensics-remediation-design.md'
$PLAN_PATH = 'docs/superpowers/plans/2026-07-13-remediation-scoring-and-contract-semantics.md'
$ALLOWED_PREIMPLEMENTATION_DOCS = @($SPEC_PATH, $PLAN_PATH) | Sort-Object
$PLAN2_BASE_SHA = '5c865d97ab2732b4fd0bb354ae41aeb0ea797b86'
$PLAN2_PLAN_SHA = (git rev-parse master).Trim()
git merge-base --is-ancestor $PLAN2_BASE_SHA $PLAN2_PLAN_SHA
if ($LASTEXITCODE -ne 0) {
  throw "Recorded Plan 2 code base is not an ancestor of current master"
}
$rangeFiles = @(git diff --name-only "$PLAN2_BASE_SHA..$PLAN2_PLAN_SHA" | Sort-Object -Unique)
$rangeDelta = @(Compare-Object $ALLOWED_PREIMPLEMENTATION_DOCS $rangeFiles)
if ($rangeDelta.Count -ne 0) {
  throw "Preimplementation two-document fence failed: $($rangeFiles -join ', ')"
}
$nonDocumentCommits = @(git rev-list --reverse "$PLAN2_BASE_SHA..$PLAN2_PLAN_SHA" | Where-Object {
  $commitFiles = @(git diff-tree --no-commit-id --name-only -r $_)
  @($commitFiles | Where-Object { $_ -notin $ALLOWED_PREIMPLEMENTATION_DOCS }).Count -ne 0
})
if ($nonDocumentCommits.Count -ne 0) {
  throw "A preimplementation commit contains a forbidden file: $($nonDocumentCommits -join ', ')"
}
$planAmendmentFiles = @(git diff-tree --no-commit-id --name-only -r $PLAN2_PLAN_SHA)
$specAmendmentSha = (git rev-parse "$PLAN2_PLAN_SHA^").Trim()
$specAmendmentFiles = @(git diff-tree --no-commit-id --name-only -r $specAmendmentSha)
if ($planAmendmentFiles.Count -ne 1 -or $planAmendmentFiles[0] -ne $PLAN_PATH) {
  throw "Implementation head is not the required Plan 2-only amendment commit"
}
if ($specAmendmentFiles.Count -ne 1 -or $specAmendmentFiles[0] -ne $SPEC_PATH) {
  throw "Commit immediately before implementation head is not the required spec-only amendment commit"
}
git config branch.codex/remediation-scoring-contract-semantics.plan2BaseSha $PLAN2_BASE_SHA
git config branch.codex/remediation-scoring-contract-semantics.plan2PlanSha $PLAN2_PLAN_SHA
git status --short
git log --oneline "$PLAN2_BASE_SHA..$PLAN2_PLAN_SHA"
```

Expected:

- `PLAN2_BASE_SHA` equals the reviewed Plan 1 code baseline
  `5c865d97ab2732b4fd0bb354ae41aeb0ea797b86`;
- the complete committed diff after that base and before implementation contains
  exactly the canonical remediation spec and Plan 2 paths;
- every commit in the range changes only those two allowed documents; any third
  path blocks execution;
- implementation HEAD is the Plan 2-only amendment commit and its direct parent
  is the canonical-spec-only amendment commit;
- user-owned dirty docs remain present and unchanged;
- no code implementation has started.

- [ ] **Step 2: create a dedicated worktree from the approved plan head**

```powershell
$WORKTREE = 'C:\Users\User\OneDrive\Desktop\smartcontract-remediation-scoring-contract-semantics'
$PLAN2_PLAN_SHA = (git config --get branch.codex/remediation-scoring-contract-semantics.plan2PlanSha).Trim()
git worktree add $WORKTREE -b codex/remediation-scoring-contract-semantics $PLAN2_PLAN_SHA
git -C $WORKTREE status --short
```

Expected: new worktree clean; main worktree retains all user changes.

- [ ] **Step 3: verify the Plan 1 candidate schema in a disposable database**

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

- [ ] **Step 4: record a clean baseline**

```powershell
npm run typecheck
npm test
```

Expected baseline: typecheck GREEN and full suite GREEN. Record exact file/test counts in the execution log; do not copy stale Plan 1 counts as proof.

- [ ] **Step 5: pin the release fence**

Record in the execution log:

```text
Plan 2 candidate only.
Production DB, deployed runtime, /version and Telegram remain unchanged.
Only explicit operations may migrate/restart/roll out production.
```

Task 0 creates no commit and must end with a clean implementation worktree.

Required review after Task 0:

1. independent spec-review confirms the fixed code base, exact two-document
   preimplementation ancestry, clean feature worktree, disposable PostgreSQL URL
   and the production operations fence;
2. independent code-quality/safety review confirms the implementation worktree
   is clean, all dirty main-worktree files remain unstaged and no production
   endpoint was contacted.

Both reviews are recorded before Task 1.

## 4. Task 1 — first commit is the complete Plan 2 RED acceptance batch

**Files:**

- Create the fixture and seven acceptance test files listed in section 2,
  including `tests/forensics/moneyOriginLlmIsolation.acceptance.test.ts`.
- Modify only `tests/approvals/safetyRecheck.test.ts` to add the RED assertions
  specified below.
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
it("[REQ-15][ANCHOR-SCORE] rejects non-integer non-finite or out-of-range anchor scores", async () => {
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

- [ ] **Step 2: add ScoreAnchor RED tests for every strict invariant**

`tests/risk/scoreAnchorV2.acceptance.test.ts` contains these exact tests and assertions:

| Test name | Required assertion | Expected initial RED |
|---|---|---|
| `[REQ-04][REQ-15] keeps exact proof decline with unrelated partial coverage and a valid anchor` | exact hard candidate → `DECLINE`, numeric score, non-null valid anchor, `coverage=partial` retained | `scoreAnchorV2` export/result field absent |
| `[REQ-04][REQ-15][REQ-38] publishes no score when required coverage is invalid and no exact proof applies` | `NO_FINAL_DECISION`, `finalScore=null`, `scoreValid=false`, anchor null | v2 result still publishes matrix score without v3 binding |
| `[REQ-15][ANCHOR-SCORE] rejects non-integer non-finite or out-of-range anchor scores` | `-1`, `101`, `35.5`, `NaN`, `Infinity` all fail; `0` and `100` remain valid | validator absent |
| `[REQ-15][ANCHOR-POLICY] requires an exact registered policy row` | row id and `decision/matrixRow/evidenceClass/proofLevel/authority/coverageDependency` must equal one registry row; an unknown or partially mismatched row fails | validator absent |
| `[REQ-05][REQ-15][ANCHOR-SUBJECT] requires a valid TRON subject and exact address-mode binding` | invalid address, another address, wrong mode and another mode's fact all fail | validator absent |
| `[REQ-15][ANCHOR-EVIDENCE] requires unique resolvable subject-bound evidence` | empty, duplicate, unresolved, multiply resolved, foreign-subject and non-decisive evidence fail | validator absent |
| `[REQ-15][ANCHOR-PREFERRED] requires exactly one resolvable preferredFactId` | missing/empty/unknown/multiple preferred facts, wrong subject/section, `isScoreDriver=false` and evidence-set mismatch fail | validator absent |
| `[REQ-04][REQ-15][ANCHOR-COVERAGE] enforces the registered coverageDependency` | behavior rows require `required`; exact rows accept only their registered dependency; `none` cannot be substituted | validator absent |
| `[REQ-04][REQ-15][ANCHOR-AUTHORITY] forbids DECLINE for context coverage or limitation rows` | each non-proof authority with `DECLINE` fails even when score/evidence otherwise bind | validator absent |
| `[REQ-15][ANCHOR-CARDINALITY] requires exactly one active anchor for every published score` | numeric scores including `0` have one anchor; two active anchors fail; zero anchors permit only no-score/no-final | integration absent |
| `[REQ-04][REQ-15][ANCHOR-LEGACY] never synthesizes an anchor for a legacy result` | legacy result remains readable with no v2 anchor | integration absent |
| `[REQ-05] keeps contract safety separate from ordinary transfer scoring` | adding deterministic Contract context does not remove Fast/Deep/Where candidates | v3 integration absent |
| `[REQ-17] preserves a material relationship with a currently blacklisted counterparty` | before/during/unknown chronology remains eligible policy risk; only chronology metadata differs | new ID-linked regression absent |

The invariant tests parameterize these invalid inputs against
`validateScoreAnchorV2` and the fresh-result assembler:

```ts
const invalidCases = [
  "score_below_zero",
  "score_above_100",
  "fractional_score",
  "non_finite_score",
  "unregistered_policy_row",
  "policy_metadata_mismatch",
  "invalid_tron_subject",
  "wrong_subject",
  "wrong_mode",
  "empty_evidence",
  "duplicate_evidence_id",
  "unresolved_evidence_id",
  "multiply_resolved_evidence_id",
  "foreign_subject_evidence",
  "missing_preferred_fact",
  "duplicate_preferred_fact",
  "unresolved_preferred_fact",
  "preferred_fact_wrong_subject",
  "preferred_fact_not_score_driver",
  "primary_evidence_mismatch",
  "coverage_dependency_mismatch",
  "context_decline",
  "coverage_decline",
  "limitation_decline",
  "multiple_active_anchors"
] as const;
```

Every case expects `score_anchor_fact_binding_failed`, `finalScore=null` and no
heuristic fallback fact. The test explicitly proves one and only one
`preferredFactId` resolves to one `NarrativeFactV2` whose subject, mode and
decisive evidence set equal the active anchor.

- [ ] **Step 3: add collector and USDD RED tests**

`tests/risk/collectorUsddRemediation.acceptance.test.ts` contains the exact named cases below:

| Test name | Input/result assertion |
|---|---|
| `[AC-01] caps collector-only evidence at REVIEW 35` | one historical-transit episode → winner `behavior_only_prior`, score `35`, decision `REVIEW`, no decline authority |
| `[AC-02] allows collector 55 only with an independent eligible AML signal` | collector episode A + eligible AML episode B → composed `55 REVIEW` with unioned evidence |
| `[AC-02] does not treat the same evidence episode as an independent signal` | collector and secondary fact share episode id → no composed candidate, remains `35` |
| `[REQ-16][COLLECTOR] rejects partially overlapping episode sets` | collector `{A,B}` plus AML `{B,C}` does not compose because the intersection is non-empty |
| `[REQ-16][COLLECTOR] rejects empty episode identifiers` | empty/blank/missing episode id makes the candidate ineligible; no anonymous independence |
| `[REQ-16][COLLECTOR] excludes coverage and clean evidence from composition` | coverage/limitation/clean rows cannot be the independent AML candidate |
| `[REQ-16][COLLECTOR] refuses a repeated collector as the independent signal` | collector plus another collector/behavior duplicate remains `35 REVIEW` |
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

The PSM candidate uses explicit named constants and tests their relationship:

```ts
USDD_PSM_STANDALONE_CAP = 45;
USDD_PSM_MAX_MODIFIER = 25;
USDD_PSM_CONTEXT_BASE_SCORE =
  USDD_PSM_STANDALONE_CAP - USDD_PSM_MAX_MODIFIER; // 20
```

Base `20` is deliberate, not an implicit magic number: exact PSM exposure is
context rather than proof, so its floor remains below collector-only `35`, while
the maximum inbound modifier reaches but never exceeds standalone `45 REVIEW`.
The tests assert the equation, the named constant, and the final candidates.

Add table-driven boundary assertions for exact integer shares `4.999999%`, `5%`, `20%`, `50%`, `80%`, `100%`; thresholds enter the next tier and no floating-point tier selection is allowed.

- [ ] **Step 4: add Approval Safety RED tests**

`tests/approvals/approvalSafetyV2.acceptance.test.ts` contains these exact named cases:

| Test name | Required result |
|---|---|
| `[AC-19] scores confirmed unlimited Verify20 approval at CRITICAL 90` | `CRITICAL/90/REVOKE_NOW`, exact Verify20, no debit claim, AML `0` |
| `[REQ-20][VERIFY20-TIERS] applies all current-allowance tiers at exact USDT boundaries` | max → `90`; finite `100000000` raw and above → `75`; `99999999` raw and below positive → `45`; zero → `0`; AML `0` throughout |
| `[AC-22] caps one selector or provider name at review context` | score `<=35`; exactVerify20 false |
| `[AC-23] removes active threat after confirmed zero allowance` | `LOW/0/NONE`; historical approval hash retained |
| `[AC-25] recognizes exact Bridgers 66-second 91.103009 session as LOW 10` | exact `KnownServiceSessionV1`; `LOW/10/REVOKE_IF_UNUSED`, AML `0` |
| `[AC-26] refuses service-session dampener for tag-only evidence` | session null and result not `LOW 10` |
| `[REQ-21][SERVICE-SESSION] rejects every inexact known-service session: %s` | wrong caller/spender, failed action, `600001ms` delay, amount mismatch, broken tx sequence and unsupported action each produce session `null` and no dampener |
| `[AC-28] removes transaction expiration from approval risk` | no reason/modifier `approval_extended_expiration`; score unchanged when only envelope expiry changes |
| `[AC-31] keeps exact Bridgers approval session LOW instead of decline` | `LOW 10`, not decline projection |
| `[AC-32] keeps known-service unlimited approval without session at REVIEW 45` | `MEDIUM/45/REVOKE_IF_UNUSED`, AML `0` |
| `[AC-33] prevents service dampening of provider risk Verify20 or debit proof` | exact debit `95`, provider risk `90`, Verify20 `90`; service context does not lower them |

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

For `KnownServiceSessionV1`, success requires the exact same wallet/caller,
registry-bound spender, supported action, successful receipt, unbroken
approval→action→USDT-movement sequence, exact decoded/action amount continuity
and `0 <= delayMs <= 600000`. An unlimited allowance value is never compared to
the swap amount. The negative table includes:

```ts
[
  "different_caller_or_spender",
  "failed_action",
  "outside_600000ms_window",
  "amount_mismatch",
  "broken_transaction_sequence",
  "unsupported_action"
] as const;
```

`broken_transaction_sequence` includes an intervening revoke/re-approval or an
action not causally linked to the approval. `unsupported_action` uses a
syntactically valid but unregistered method such as `claim`.

The RED batch also adds direct-refresh lifecycle/error tests:

| Test name | Required assertion |
|---|---|
| `[REQ-19][ALLOWANCE-REFRESH] refreshes only for a new event finalization or explicit safety recheck` | exactly one full-node call at each allowed trigger; ordinary empty 60-second polling makes zero allowance calls |
| `[REQ-19][ALLOWANCE-REFRESH] maps timeout malformed revert and provider failure to UNKNOWN` | each failure persists/returns `confirmedAllowanceRaw=null`, `isUnlimited=null`, `UNKNOWN/null/CONFIRM_ALLOWANCE` with an exact failure code |
| `[REQ-19][ALLOWANCE-REFRESH] never presents historical event allowance as current after refresh failure` | previous Approval event amount remains historical evidence only and cannot populate current state |

`tests/approvals/safetyRecheck.test.ts` specifically proves an explicit
`runSafetyRecheck` requests the direct refresh, while a normal
`runSingleApprovalPollingCycle` with no newly claimed approval performs no
full-node allowance read. Background stale-state refresh is deliberately absent
from Plan 2 and remains Plan 3 ownership.

- [ ] **Step 5: add deterministic Contract RED tests**

`tests/check/contractDecisionV2.acceptance.test.ts` contains these exact named cases:

| Test name | Required result |
|---|---|
| `[AC-29] resolves official TRON USDT at LOW 0 without LLM` | deterministic `LOW/0/ACCEPTABLE`, both model spies unused |
| `[AC-30] resolves GasFree Account at LOW 10 without LLM and keeps flows eligible` | deterministic `LOW/10`; model spies unused; principal candidate still present |
| `[REQ-24][GASFREE-BOUNDARY] never classifies a GasFree endpoint or controller as ordinary GasFree Account LOW 10` | `role:gasfree_endpoint`, registry controller and pooled boundary `TLntW9Z59LYY5KEi9cmwk3PKjQga828ird` use their exact boundary/service classification; none enters the `role:gasfree_account` LOW-10 branch |
| `[AC-31] keeps exact Bridgers approval session LOW instead of decline` | deterministic `LOW/10`, finalSource deterministic |
| `[AC-32] keeps known-service unlimited approval without session at REVIEW 45` | deterministic `MEDIUM/45/REVIEW`, not AML decline |
| `[AC-33] prevents service-context dampening of provider risk Verify20 or debit proof` | exact bad authority remains at its deterministic score/decision under benign or foreign service assessment |
| `[REQ-24][CONTRACT-UNKNOWN] resolves unknown metadata without exact bad or service proof at REVIEW 35` | confirmed subject-bound `metadata_context` → deterministic `MEDIUM/35/REVIEW`, authority `context`, `llm=null`; never `DECLINE` |
| `[REQ-08][CONTRACT-EVIDENCE] refuses exact debit authority without exact_debit evidence kind` | `exactDebit=true` backed only by `approval_event` or another kind cannot produce `95`; unresolved/fabricated IDs fail closed |
| `[REQ-08][CONTRACT-EVIDENCE] refuses Verify20 authority without verify20_fingerprint evidence kind` | `exactVerify20=true` backed only by approval/allowance/provider text cannot produce `90`; unresolved/fabricated IDs fail closed |
| `[REQ-24][CONTRACT-UNKNOWN] requires subject-bound metadata_context for REVIEW 35` | missing, foreign-subject or wrong-kind metadata evidence returns no current contract decision; resolver never invents an evidence ID |
| `[REQ-05][REQ-21][CONTRACT-SUBJECT] ignores foreign approval or service-session assessments` | assessment with wrong spender, non-USDT token, foreign/empty/unresolved evidence or another subject cannot change the checked contract's `35 REVIEW` result |
| `[AC-40] bypasses Flash and Pro for every fresh contract case` | table over official USDT, GasFree Account, Bridgers session, known service, Verify20/provider risk/debit and unknown/ambiguous; both spies count zero and `llm=null` |
| `[REQ-08] keeps victim spender receiver and route roles distinct and leaves ordinary transferFrom as context` | an ordinary `transferFrom` keeps explicit roles, `exactVerify20=false`, no drainer authority and no receiver/spender role substitution |

Each no-call test uses two spies:

```ts
const flash = vi.fn(async () => { throw new Error("Flash must not run"); });
const pro = vi.fn(async () => { throw new Error("Pro must not run"); });
expect(flash).not.toHaveBeenCalled();
expect(pro).not.toHaveBeenCalled();
expect(result.finalSource).toBe("deterministic");
expect(result.llm).toBeNull();
```

The positive GasFree test separately calls the existing transfer candidate
builder and proves a principal edge is still present; standalone contract
safety must not create a transfer exemption. The negative test uses exact
role/registry evidence rather than a label string and proves endpoint/controller
addresses cannot inherit ordinary-account `LOW 10`.

The foreign-assessment test accepts an `ApprovalSafetyAssessmentV2` only when
all of these resolve together:

```text
assessment.spenderAddress == checked subjectAddress
assessment.tokenContract == TRON_USDT_CONTRACT_ADDRESS
assessment.evidenceIds is non-empty
every assessment evidence id resolves exactly once in current evidenceIds
the resolved evidence subject/spender is the checked subjectAddress
```

Any mismatch removes the assessment from contract authority before precedence
is evaluated; it cannot create a known-service/Verify20/debit result.

- [ ] **Step 6: add automatic-LLM isolation and legacy-audit RED tests**

`tests/forensics/contractLlmIsolation.acceptance.test.ts` contains these exact
cases:

| Test name | Required result |
|---|---|
| `[AC-34][LLM-DISABLED] ignores every fresh LLM score payload` | fractional, non-finite, in-range, out-of-range and missing scores are never parsed/applied; fresh `llm=null`, provider call count `0` |
| `[AC-35][LLM-DISABLED] ignores every verdict and recommendation payload` | legitimate/risky/unknown and contradictory recommendations cannot change deterministic result; no fresh interpretation object |
| `[AC-36][LLM-LEGACY] keeps cached citations as audit-only payload` | historical cache row remains readable from the legacy audit repository but none of its citations enters current evidence, facts or `ContractDecisionV2` |
| `[AC-37][LLM-DISABLED] keeps risky or uncited legacy verdict out of fresh decisions` | exact same fresh deterministic result with absent, risky, uncited or malformed legacy payload |
| `[AC-38][LLM-NOCALL] makes zero provider calls for timeout JSON and schema scenarios` | analyzer spy count `0`; no request is attempted; deterministic result deep-equal and `llm=null` |
| `[REQ-25][REQ-26][LLM-LEGACY] never reads legacy LLM into scoring decision or presentation input` | legacy score/verdict/recommendation/citations survive only in audit storage and are absent from active score layers, decision reasons, narrative facts and Telegram-facing projection |
| `[AC-39][REQ-25][LLM-LEGACY][TELEGRAM] removes model output from Bot and Alert formatting` | load stored Smart/Where/Incoming reports containing old verdict/prose/citations, build the active projection, then assert rendered Telegram/alert text contains none of those values and no AI-verdict section |
| `[AC-40][LLM-NOCALL] bypasses Flash and Pro for unknown and ambiguous contracts` | both model spies remain unused; unknown deterministic result is `35 REVIEW`, `llm=null` |
| `[REQ-25][LLM-NOCALL][ORCHESTRATION] removes automatic analyzer from Smart Where Incoming Deep and bootstrap wiring` | throwing provider/cache spies are unused through every fresh entry point; source-wiring gate finds no analyzer construction/injection in active files |

This is intentionally stronger and simpler than strict schema validation: Plan
2 does not create `contractLlmValidation.ts`, does not adapt live/cache payloads
into current facts and does not need confidence/verdict/citation acceptance
rules. Legacy rows retain their JSON payload unchanged and are not overwritten;
their metadata remains available for audit only.

- [ ] **Step 7: add money-origin LLM removal RED tests**

`tests/forensics/moneyOriginLlmIsolation.acceptance.test.ts` adds:

| Test name | Required assertion |
|---|---|
| `[REQ-23][REQ-25][LLM-ORIGIN] removes unavailable and invalid LLM from active assessment` | unavailable/timeout/invalid payload cannot add warnings, score layer, dampening, safe-default reason or `DECLINE` |
| `[REQ-23][REQ-25][LLM-ORIGIN] removes risky and legitimate LLM from active assessment` | risky/legitimate legacy payloads are not read; `riskScore`, `decision`, `riskBand`, `walletRole`, `sourcePolicy`, `hardBad`, score layers, warnings and narrative facts are deep-equal to an input with no LLM payload |
| `[REQ-25][LLM-ORIGIN-LEGACY] preserves stored LLM only through the separate audit repository` | operational assessment output exposes no legacy verdict/citation/prose while the original stored audit row remains unchanged |

These tests exercise the branches currently reached from
`src/forensics/moneyOriginOperationalAssessment.ts` around line 486 and the
unavailable/default-decline, positive-verdict and dampening branches. An old
`DECLINE`, `ACCEPTABLE`, active warning, LLM-owned score layer or dampening result
is the expected RED evidence.

- [ ] **Step 8: add the first-batch PostgreSQL RED test**

`tests/approvals/approvalSafety.postgres.test.ts` runs only when `REQUIRE_PLAN2_POSTGRES=1` and uses a random watched-wallet id. It must:

1. persist fresh max allowance with `saveWalletApprovalAllowanceStateV2`;
2. read it through `listWalletApprovals`;
3. pass the returned `allowanceStateV2` to the new assessment resolver;
4. assert AC-19 `90/CRITICAL`;
5. persist a later confirmed zero direct-call state;
6. read again and assert AC-23 `0/LOW` and historical approval tx retained.
7. persist a failed direct read after a historical non-zero Approval event and
   assert the reloaded current assessment is `UNKNOWN/null`, while the event raw
   remains available only in historical evidence.

The exact test names are
`[REQ-19][AC-19][POSTGRES] scores the persisted fresh direct allowance state`,
`[REQ-19][AC-23][POSTGRES] removes active threat after a later confirmed zero`
and `[REQ-19][POSTGRES][ALLOWANCE-FAILURE] keeps historical event amount out of current allowance`.
The first asserts the stored/reloaded max state produces `90/CRITICAL`; the
second asserts a later stored/reloaded zero produces `0/LOW` while
`observedApprovalTxHash` remains unchanged; the third asserts a provider failure
reloads as `UNKNOWN/null` with `confirmedAllowanceRaw=null`.

Use transaction/schema cleanup in `finally`; never connect to port `5432`.

- [ ] **Step 9: run and record the expected RED batch**

```powershell
$env:REQUIRE_PLAN2_POSTGRES = '1'
$env:TEST_DATABASE_URL = 'postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan2'
npx vitest run --configLoader bundle `
  tests/risk/scoreAnchorV2.acceptance.test.ts `
  tests/risk/collectorUsddRemediation.acceptance.test.ts `
  tests/approvals/approvalSafetyV2.acceptance.test.ts `
  tests/approvals/approvalSafety.postgres.test.ts `
  tests/approvals/safetyRecheck.test.ts `
  tests/check/contractDecisionV2.acceptance.test.ts `
  tests/forensics/contractLlmIsolation.acceptance.test.ts `
  tests/forensics/moneyOriginLlmIsolation.acceptance.test.ts
npm run typecheck
```

Expected RED:

- every listed ID-linked test is discovered;
- failures are missing target exports/behavior, not fixture syntax, invalid addresses, DB authentication or production connectivity;
- existing tests imported by the batch do not fail first;
- PostgreSQL creates/cleans its disposable rows/schema.

- [ ] **Step 10: commit RED tests only**

```powershell
Commit-Plan2Task -AllowedPaths @(
  'tests/fixtures/forensics/remediationScoringCases.ts',
  'tests/risk/scoreAnchorV2.acceptance.test.ts',
  'tests/risk/collectorUsddRemediation.acceptance.test.ts',
  'tests/approvals/approvalSafetyV2.acceptance.test.ts',
  'tests/approvals/approvalSafety.postgres.test.ts',
  'tests/approvals/safetyRecheck.test.ts',
  'tests/check/contractDecisionV2.acceptance.test.ts',
  'tests/forensics/contractLlmIsolation.acceptance.test.ts',
  'tests/forensics/moneyOriginLlmIsolation.acceptance.test.ts'
) -Message 'test: define scoring and contract remediation acceptance'
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

The validator enforces these strict invariants without coercion or fallback:

1. `score` is a finite integer in inclusive range `0..100` and exactly mirrors
   the published score;
2. policy version, row id, decision, matrix row, evidence class, proof level,
   authority and `coverageDependency` exactly match one registered policy row;
3. `subjectAddress` is a valid TRON address and equals the checked address;
   `mode` equals the checked result mode;
4. every primary/contributing evidence id is unique, resolves exactly once,
   belongs to the same subject and is eligible for that registered row;
5. `preferredFactId` is present exactly once and resolves to exactly one fact;
6. that fact has the same subject/mode, `section="score_reason"`,
   `isScoreDriver=true`, and the exact decisive evidence set;
7. the anchor's `coverageDependency` equals the registry value: behavior rows
   require `required`; rows registered as `independent`/`none` cannot substitute
   another value;
8. context, coverage and limitation rows can never publish `DECLINE`;
9. every fresh published numeric score has exactly one active anchor; zero or
   multiple active anchors fail closed, while a no-score result has no anchor;
10. legacy results are read as legacy and never receive a synthesized anchor.

Any violation returns the single diagnostic
`score_anchor_fact_binding_failed`, clears the published score and does not try
another winner or preferred fact.

- [ ] **Step 3: create the preferred score fact deterministically**

For the decisive candidate create one fact whose stable id includes:

```ts
[policyVersion, mode, subjectAddress, matrixRow, ...sortedPrimaryEvidenceIds]
```

Use `factTextKey = ["score", matrixRow, firstAtomicSignal].join(".")`; do not put
user copy or LLM prose in this module. Coverage and limitation facts cannot be
preferred. A registered context row may own the preferred score fact only for
its bounded non-`DECLINE` score.

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
Commit-Plan2Task -AllowedPaths @(
  'src/types.ts',
  'src/risk/scoreAnchorV2.ts',
  'src/risk/scoringSignalMatrix.ts',
  'src/risk/finalDisposition.ts',
  'src/risk/unifiedWalletRisk.ts',
  'src/risk/unifiedIncomingDepositRisk.ts',
  'src/check/whereIsMoneyCheck.ts',
  'tests/risk/scoreAnchorV2.acceptance.test.ts'
) -Message 'feat: bind fresh scores to canonical evidence'
```

Required review: spec-review then code-quality review; both must explicitly inspect all ten anchor invariants.

## 6. Task 3 — collector cap/composition and blacklist regression

**Files:**

- Modify `src/risk/scoringSignalMatrix.ts`.
- Modify `src/risk/scoringSignalMatrixInputs.ts`.
- Test `tests/risk/collectorUsddRemediation.acceptance.test.ts` for AC-01/02.
- Test `tests/risk/scoreAnchorV2.acceptance.test.ts` for REQ-17.
- Modify `tests/risk/scoringSignalMatrix.test.ts`,
  `tests/risk/scoringSignalMatrixInputs.test.ts` and
  `tests/risk/unifiedWalletRisk.test.ts` only where old collector expectations
  contradict the new RED acceptance proof.

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
- both normalized evidence-episode sets are non-empty and contain no blank id;
- the sorted evidence-episode sets are fully disjoint (`intersection.size===0`);
- the second candidate is not another collector/behavior duplicate.

Any partial overlap, including collector `{A,B}` with AML `{B,C}`, is not
independent and cannot compose. Coverage, limitation and clean evidence never
qualify as the second signal. A repeated collector/transit candidate never
qualifies even when its episode ids are disjoint. Empty episode ids fail closed;
the code must not create a synthetic anonymous episode.

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
Commit-Plan2Task -AllowedPaths @(
  'src/risk/scoringSignalMatrix.ts',
  'src/risk/scoringSignalMatrixInputs.ts',
  'tests/risk/collectorUsddRemediation.acceptance.test.ts',
  'tests/risk/scoreAnchorV2.acceptance.test.ts',
  'tests/risk/scoringSignalMatrix.test.ts',
  'tests/risk/scoringSignalMatrixInputs.test.ts',
  'tests/risk/unifiedWalletRisk.test.ts'
) -Message 'fix: bound collector behavior scoring'
```

Required review: spec-review then code-quality review, including same/partial
episode overlap, empty ids, coverage/clean inputs and repeated-collector
adversarial cases.

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

- [ ] **Step 2: define and justify the standalone base explicitly**

Export named constants and derive the base instead of embedding `20`:

```ts
export const USDD_PSM_STANDALONE_CAP = 45;
export const USDD_PSM_MAX_MODIFIER = 25;
export const USDD_PSM_CONTEXT_BASE_SCORE =
  USDD_PSM_STANDALONE_CAP - USDD_PSM_MAX_MODIFIER; // 20

score = Math.min(
  USDD_PSM_STANDALONE_CAP,
  USDD_PSM_CONTEXT_BASE_SCORE + exposure.appliedModifier
);
```

This makes the policy basis verifiable: exact PSM exposure is a decentralized
liquidity/privacy context, not proof, so its floor `20` stays below the
collector-only cap `35`; maximum direct inbound exposure adds `25` and reaches
but cannot exceed standalone `45 REVIEW`. Tests assert all three constants,
their arithmetic relation and the final candidate. A future base change must
therefore be an explicit policy/test change.

The candidate is review-only context, never `can_decline`. This yields exact canonical cases:

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
Commit-Plan2Task -AllowedPaths @(
  'src/risk/usddPsmExposure.ts',
  'src/risk/scoringSignalMatrixInputs.ts',
  'src/check/deepForensicCheck.ts',
  'src/types.ts',
  'tests/risk/collectorUsddRemediation.acceptance.test.ts'
) -Message 'feat: score exact usdd psm exposure'
```

Required review: spec-review then code-quality review; reviewer must check BigInt
thresholds, named base derivation and base-plus-modifier cap arithmetic.

## 8. Task 5 — direct official-USDT allowance refresh

**Files:**

- Create `src/approvals/allowanceRefresh.ts`.
- Modify `src/tron/tronClient.ts`.
- Modify `src/approvals/allowanceState.ts` only for canonical failure validation.
- Modify `src/approvals/approvalWorker.ts`.
- Modify `src/approvals/safetyRecheck.ts` only to pass the explicit refresh reason.
- Modify `src/index.ts` only for dependency injection.
- Test `tests/tron/tronClient.test.ts`, `tests/approvals/approvalWorker.test.ts`,
  `tests/approvals/allowanceState.test.ts`,
  `tests/approvals/safetyRecheck.test.ts`,
  `tests/approvals/approvalSafety.postgres.test.ts`, and
  `tests/storage/allowanceCausality.postgres.test.ts`.

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

The response must be canonical uint256 decimal. Wrong network/address, timeout,
revert, provider failure, missing/non-hex/multiword result and overflow map to
the exact Plan 1 failure allowlist. The acceptance corpus requires these public
failure classes:

```ts
"provider_timeout"
"malformed_response"
"contract_call_reverted"
"provider_unavailable"
```

- [ ] **Step 2: build current state from one clocked attempt**

`refreshApprovalAllowance` accepts `{client, ownerAddress, spenderAddress, observedApprovalTxHash, now}` and returns one validated `ApprovalAllowanceStateV2`:

- success `0` → `confirmed_zero`;
- success `>0` → `confirmed_active` and exact max detection;
- failure → `failed`, `confirmedAllowanceRaw=null`, `isUnlimited=null`,
  `confirmedAt=null`, exact failure code, no invented current raw;
- `confirmedAt=lastAttemptAt=now`, `freshUntil=now+15m` on success.

- [ ] **Step 3: define the three and only three Plan 2 refresh triggers**

```ts
export type ApprovalAllowanceRefreshReason =
  | "new_approval_event"
  | "context_finalization"
  | "explicit_safety_recheck";
```

Direct `allowance` is read only:

1. once after a newly claimed Approval event is parsed;
2. once immediately before that approval context is finalized by
   `runSingleApprovalContextFinalizerCycle`;
3. once when `runSafetyRecheck` explicitly rechecks a selected approval.

The ordinary approximately 60-second Approval polling cycle with no newly
claimed event makes zero allowance calls. Existing approvals are not refreshed
merely because the poll ran. Background refresh of stale/failed allowance
states remains Plan 3; Plan 2 adds no timer, scan or claim loop.

- [ ] **Step 4: stop deriving current allowance from Approval event amount**

In `approvalWorker`, event `amountRaw` remains historical. At an allowed trigger:

1. call `refreshApprovalAllowance` with the explicit reason;
2. save it through `saveWalletApprovalAllowanceStateV2` dependency;
3. pass that exact state to Task 6 resolver.

Do not write `currentAllowanceRaw: approval.amountRaw` or `event.amountRaw` as current truth. For a failed call, persist failed state and continue with `UNKNOWN`, not active/revoked.

If a prior event or prior successful snapshot contains a non-zero amount and
the current direct read times out, is malformed, reverts or fails at the
provider, the current attempt is still `UNKNOWN/null`. Historical values remain
auditable history only; no adapter may expose them as current allowance.

- [ ] **Step 5: wire dependencies without lifecycle changes**

`src/index.ts` only passes:

```ts
getUsdtAllowance: (input) => tronClient.getUsdtAllowance(input),
saveWalletApprovalAllowanceStateV2: (input) => saveWalletApprovalAllowanceStateV2(db, input)
```

`safetyRecheck.ts` passes `explicit_safety_recheck`; it does not create a new
poller. No new timer, worker, queue, delivery or startup behavior. Periodic/stale
Safety refresh remains Plan 3 integration under REQ-19 secondary ownership.

- [ ] **Step 6: run GREEN tests including PostgreSQL**

```powershell
$env:REQUIRE_PLAN2_POSTGRES = '1'
$env:TEST_DATABASE_URL = 'postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan2'
npx vitest run --configLoader bundle `
  tests/tron/tronClient.test.ts `
  tests/approvals/allowanceState.test.ts `
  tests/approvals/approvalWorker.test.ts `
  tests/approvals/safetyRecheck.test.ts `
  tests/approvals/approvalSafety.postgres.test.ts `
  tests/storage/allowanceCausality.postgres.test.ts
npm run typecheck
```

Expected: payload/binding/failure tests GREEN; timeout, malformed, revert and
provider failure all produce `UNKNOWN/null`; call-count tests prove no ordinary
60-second full-node refresh; PostgreSQL preserves causal ordering; production DB
untouched.

- [ ] **Step 7: commit**

```powershell
Commit-Plan2Task -AllowedPaths @(
  'src/approvals/allowanceRefresh.ts',
  'src/tron/tronClient.ts',
  'src/approvals/allowanceState.ts',
  'src/approvals/approvalWorker.ts',
  'src/approvals/safetyRecheck.ts',
  'src/index.ts',
  'tests/tron/tronClient.test.ts',
  'tests/approvals/allowanceState.test.ts',
  'tests/approvals/approvalWorker.test.ts',
  'tests/approvals/safetyRecheck.test.ts',
  'tests/approvals/approvalSafety.postgres.test.ts',
  'tests/storage/allowanceCausality.postgres.test.ts'
) -Message 'feat: confirm current usdt allowance directly'
```

Required review: spec-review then code-quality review; reviewer must inspect
exact owner/spender/token binding, trigger call counts, all four provider-failure
paths and verify no event-derived current allowance remains.

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

The exact predicate is conjunctive:

```text
callerAddress == approval.ownerAddress
spenderAddress == registry.spenderAddress
actionKind in registry.actionKinds
receipt.success == true
0 <= actionTimestamp - approvalTimestamp <= 600000 ms
decodedActionAmountRaw == movedUsdtAmountRaw
approval/action/movement share one unbroken causal sequence
```

The session is `null` for a different caller or spender, failed action,
`600001ms` delay, mismatched amount, intervening revoke/re-approval, causally
unlinked transaction or unsupported action. Unlimited allowance max is never
used as the swap amount. These six negative classes and the inclusive time
boundary are mandatory acceptance cases.

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

USDT uses six decimals and tier comparisons are raw-integer comparisons:

```text
UINT256_MAX                    -> 90
100000000 raw (100 USDT)       -> 75
99999999 raw (99.999999 USDT)  -> 45
0 raw                          -> 0
```

The table test also includes a finite amount above 100 and a minimal positive
amount. No decimal floating-point conversion is permitted at the boundary.

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

Expected: AC-19/22/23/25/26/28/31/32/33 GREEN; all four Verify20
allowance tiers and the `99.999999/100` boundary GREEN; all six inexact service
sessions remain undampened; old tag-only LOW15 and expiration-risk expectations
are replaced only after new tests prove target behavior.

- [ ] **Step 6: commit**

```powershell
Commit-Plan2Task -AllowedPaths @(
  'src/approvals/approvalSafetyAssessment.ts',
  'src/approvals/knownServiceRegistry.ts',
  'src/approvals/sessionContext.ts',
  'src/approvals/approvalRisk.ts',
  'src/approvals/approvalWorker.ts',
  'src/types.ts',
  'tests/approvals/approvalSafetyV2.acceptance.test.ts',
  'tests/approvals/sessionContext.test.ts',
  'tests/approvals/approvalRisk.test.ts',
  'tests/approvals/approvalWorker.test.ts'
) -Message 'feat: resolve approval wallet safety deterministically'
```

Required review: spec-review then code-quality review; reviewer must verify AML
impact is literally `0` in types and every branch, exact raw tier boundaries and
all negative session predicates.

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
  evidence: ContractDecisionEvidenceV1[];
}): ContractDecisionV2 | null;
```

`ContractDecisionEvidenceV1` is subject-bound and kind-bound:

```ts
type ContractDecisionEvidenceV1 = {
  id: string;
  kind:
    | "metadata_context"
    | "official_registry"
    | "gasfree_role"
    | "provider_risk"
    | "verify20_fingerprint"
    | "approval_event"
    | "allowance_read"
    | "exact_debit"
    | "service_action";
  subjectAddress: string;
  spenderAddress: string | null;
  tokenContract: string | null;
};
```

Priority and required evidence kinds:

1. exact debit requires subject-bound `exact_debit`; provider risk requires
   `provider_risk`; exact Verify20 requires `verify20_fingerprint`;
2. official address registry requires `official_registry`;
3. structural GasFree Account requires `gasfree_role` proving the exact
   `role:gasfree_account` and non-boundary role;
4. exact known-service session requires its bound `approval_event`,
   `allowance_read` and `service_action` rows;
5. authoritative deterministic service requires `official_registry` plus any
   exact session evidence used by its decision;
6. unknown/ambiguous metadata without exact bad/service proof, but with a
   confirmed subject-bound `metadata_context`, produces deterministic
   `MEDIUM 35 REVIEW`, authority `context`, `llm=null`.

Every result has non-empty evidence IDs whose resolved `kind` authorizes that
exact branch, `finalSource="deterministic"` and `llm=null`. A boolean flag,
approval tx, provider label or arbitrary resolved ID cannot substitute for the
required kind. Missing/foreign/wrong-kind metadata for the unknown fallback
returns `null`; the resolver never fabricates an evidence row. Unknown context
can never publish `DECLINE`.

Before precedence, filter `approvalSafetyAssessments` with a strict all-or-none
binding. An assessment is eligible only when:

```text
assessment.allowance.spenderAddress == input.subjectAddress
assessment.allowance.tokenContract == TRON_USDT_CONTRACT_ADDRESS
assessment.allowance.ownerAddress == assessment.subjectAddress
assessmentEvidenceIds is the unique union of:
  assessment.campaignEvidenceIds
  assessment.allowance.observedApprovalTxHash when present
  serviceSession.approvalTxHash/actionTxHash when present
assessmentEvidenceIds is non-empty
every assessment evidence id resolves exactly once in input.evidence
every resolved evidence row belongs to input.subjectAddress
every non-null resolved spenderAddress == input.subjectAddress
every non-null resolved tokenContract == TRON_USDT_CONTRACT_ADDRESS
exactDebit == true requires at least one resolved kind == exact_debit
exactVerify20 == true requires at least one resolved kind == verify20_fingerprint
provider-risk authority requires at least one resolved kind == provider_risk
allowance.currentState != UNKNOWN requires a resolved kind == allowance_read
if a KnownServiceSessionV1 is attached:
  session.spenderAddress == input.subjectAddress
  session.walletAddress == assessment.allowance.ownerAddress
  session.walletInitiated == true && session.successful == true
  session.approvalTxHash and session.actionTxHash both resolve in input.evidence
  both session tx hashes are present in assessmentEvidenceIds
  approvalTxHash resolves as approval_event
  actionTxHash resolves as service_action
```

Wrong spender/caller, token, subject, empty/duplicate/unresolved/foreign evidence
or another wallet's session makes that whole assessment ineligible. It is not
partially reused and cannot affect contract score, role or decision.

`role:gasfree_account` is eligible for `LOW 10` only when a subject-bound
`gasfree_role` evidence row proves that exact structural role and also proves it
is not a boundary. `role:gasfree_endpoint`, a registry
controller or pooled endpoint/boundary (including
`TLntW9Z59LYY5KEi9cmwk3PKjQga828ird`) is classified by its exact service role
and cannot enter the ordinary GasFree Account branch. A provider label alone
cannot override this role distinction.

- [ ] **Step 2: remove the automatic analyzer call from every fresh path**

`checkSmartContractAddress` resolves deterministic authority and never invokes
`analyzeContractLlmCaseFiles` for any fresh address, including:

- `TRON_USDT_CONTRACT_ADDRESS`;
- structural GasFree Account;
- exact Verify20/provider risk/exact debit;
- exact Bridgers session;
- authoritative known service result;
- unknown or ambiguous contract.

Flash and Pro spies remain at zero for the complete table. No provider request,
retry, cache lookup or live response parsing occurs. The existing model config
is left unchanged because it is no longer part of the automatic contract check.
A deterministic contract result does not remove normal wallet transfer
candidates.

- [ ] **Step 3: make the legacy report a projection**

Fresh `SmartContractCheckReport` stores `contractDecisionV2` with `llm=null`.
Existing `riskScore`, `riskLevel`, `decision`, `reasons` become deterministic
mirrors validated against it. Fresh active loaders and presentation inputs never
copy `llmVerdict` from a legacy report. Invalid legacy stored reports remain
legacy and are not upgraded; Task 8 preserves their raw audit visibility.

- [ ] **Step 4: run GREEN tests**

```powershell
npx vitest run --configLoader bundle `
  tests/check/contractDecisionV2.acceptance.test.ts `
  tests/check/smartContractCheck.test.ts `
  tests/forensics/verify20Fingerprint.test.ts `
  tests/risk/scoreAnchorV2.acceptance.test.ts
npm run typecheck
```

Expected: AC-29/30/31/32/33/40 GREEN; endpoint/controller negative GasFree case
GREEN; `exactDebit=true` without `exact_debit` cannot produce `95`,
`exactVerify20=true` without `verify20_fingerprint` cannot produce `90`, and the
unknown fallback exists only with subject-bound `metadata_context`; exact
Verify20 contract authority remains deterministic while the
wallet-safety tier stays exclusively Task 6's `90/75/45/0`; ordinary
`transferFrom` alone remains bounded context; unknown/ambiguous is exactly
`35 REVIEW`; every foreign assessment case leaves that result unchanged.

- [ ] **Step 5: commit**

```powershell
Commit-Plan2Task -AllowedPaths @(
  'src/forensics/contractDecision.ts',
  'src/check/smartContractCheck.ts',
  'src/types.ts',
  'tests/check/contractDecisionV2.acceptance.test.ts',
  'tests/check/smartContractCheck.test.ts'
) -Message 'feat: make contract decisions deterministic'
```

Required review: spec-review then code-quality review; reviewer must exercise all
fresh no-call cases with both Flash and Pro spies, unknown `35 REVIEW`, strict
assessment/evidence-kind binding and the three negative proof-kind tests, and
prove endpoint/controller roles cannot be misclassified as ordinary GasFree
Account.

## 11. Task 8 — disable automatic contract LLM and isolate legacy audit

**Files:**

- Modify `src/forensics/contractLlmVerdict.ts`.
- Modify `src/check/smartContractCheck.ts` only for active/legacy projection
  isolation left after Task 7.
- Modify `src/check/whereIsMoneyCheck.ts` to remove automatic case-file/analyzer
  branches and fresh `contractLlmVerdicts` production.
- Modify `src/forensics/incomingDepositJob.ts` to remove automatic analyzer
  wrappers and deterministic-as-LLM adaptation.
- Modify `src/forensics/deepForensicJob.ts` to stop forwarding the analyzer.
- Modify `src/index.ts` to stop constructing/injecting the automatic analyzer.
- Modify `src/bot/createBot.ts` only to remove the AI contract-verdict helper and
  output line.
- Modify `src/alerts/formatters.ts` only to remove legacy contract-verdict
  sections.
- Modify `src/types.ts`.
- Test `tests/forensics/contractLlmIsolation.acceptance.test.ts`,
  `tests/forensics/contractLlmVerdict.test.ts`,
  `tests/check/contractDecisionV2.acceptance.test.ts` and
  `tests/check/smartContractCheck.test.ts`.
- Test `tests/check/whereIsMoneyCheck.test.ts`,
  `tests/forensics/incomingDepositJob.test.ts`,
  `tests/forensics/deepForensicJob.test.ts`,
  `tests/bot/createBot.test.ts` and `tests/alerts/formatters.test.ts` as
  active-projection regressions.

- [ ] **Step 1: make the fresh contract contract explicit**

Every fresh `ContractDecisionV2` and `SmartContractCheckReport` follows:

```ts
{
  finalSource: "deterministic";
  llm: null;
}
```

Remove fresh construction/adaptation of `ContractLlmVerdictSummary`. No fresh
score, verdict, recommendation, confidence, citation, model prose or cache id is
copied into contract reasons, evidence, narrative facts or presentation input.
Unknown/ambiguous contracts use Task 7's `35 REVIEW` fallback.

Compatibility projections are explicit and empty:

```ts
freshSmartContractReport.llmVerdict = null;
freshWhereReport.contractLlmVerdicts = [];
freshIncomingReport.contractVerdicts = [];
freshContractDecision.llm = null;
```

Legacy loaders sanitize these active projection fields to the same empty/null
values before any Telegram/Alert formatter sees the object. The raw stored
legacy/cache record is available only from the separate audit repository.

Do not drop deterministic contract evidence while removing the wrapper:
official-service, GasFree role, Verify20, debit, provider-risk and exact session
facts continue through `ContractDecisionV2`, `ServiceClassification` and
`ApprovalSafetyAssessmentV2`. They are never re-encoded as a
`ContractLlmVerdictSummary`.

- [ ] **Step 2: preserve legacy rows without consuming them**

Do not delete or rewrite existing LLM/cache rows. Existing repository functions
may return their original stored payload only through the legacy audit path.
Active loaders, `resolveContractDecisionV2`, Where/Incoming/Deep jobs,
money-origin assessment and Telegram-facing projections never request or adapt
those rows.

Tests seed representative legacy cache payloads: valid-looking, malformed,
risky, legitimate, uncited and foreign-citation. The audit repository returns
the original payload unchanged. Every active fresh result remains identical and
contains no legacy ids/citations/prose.

- [ ] **Step 3: prove no automatic invocation or cache read**

For official, GasFree, known service, exact bad evidence and unknown/ambiguous
fixtures across Smart Contract, Where, Incoming and Deep entry points, inject
throwing Flash and Pro spies plus a throwing cache-reader spy:

```ts
expect(flash).not.toHaveBeenCalled();
expect(pro).not.toHaveBeenCalled();
expect(readLegacyCache).not.toHaveBeenCalled();
expect(result.contractDecisionV2.llm).toBeNull();
```

Delete/disable the old automatic `analyzeContractLlmCaseFiles` invocation and
old `65/DECLINE`, legitimate-service dampener and cache-adaptation branches from
the complete fresh call graph. `src/index.ts` no longer creates or injects
`contractLlmVerdictAnalyzer`. Delete only the two obsolete LLM presentation
sections from `src/bot/createBot.ts` and `src/alerts/formatters.ts`; do not alter
any other Telegram/Alert text, structure or workflow. Regression tests assert
no legacy score/verdict/citation/prose or AI-verdict heading is rendered. Plan 4
still owns every other unified Telegram UX change.

- [ ] **Step 4: run GREEN tests**

```powershell
npx vitest run --configLoader bundle `
  tests/forensics/contractLlmIsolation.acceptance.test.ts `
  tests/forensics/contractLlmVerdict.test.ts `
  tests/check/contractDecisionV2.acceptance.test.ts `
  tests/check/smartContractCheck.test.ts `
  tests/check/whereIsMoneyCheck.test.ts `
  tests/forensics/incomingDepositJob.test.ts `
  tests/forensics/deepForensicJob.test.ts `
  tests/bot/createBot.test.ts `
  tests/alerts/formatters.test.ts
npm run typecheck

$forbiddenActiveLlm = @(rg -n `
  "createContractLlmVerdictAnalyzer|analyzeContractLlmCaseFiles" `
  src/index.ts src/check/smartContractCheck.ts src/check/whereIsMoneyCheck.ts `
  src/forensics/incomingDepositJob.ts src/forensics/deepForensicJob.ts)
if ($forbiddenActiveLlm.Count -ne 0) {
  throw "Automatic LLM remains in active call graph: $($forbiddenActiveLlm -join '; ')"
}
```

Expected: AC-34…38 and AC-40 GREEN; every fresh provider/cache call count is
zero; unknown contract is exactly `35 REVIEW`; seeded legacy rows remain
audit-readable but absent from active scoring, decision, facts and presentation
projection.

- [ ] **Step 5: commit**

```powershell
Commit-Plan2Task -AllowedPaths @(
  'src/forensics/contractLlmVerdict.ts',
  'src/check/smartContractCheck.ts',
  'src/check/whereIsMoneyCheck.ts',
  'src/forensics/incomingDepositJob.ts',
  'src/forensics/deepForensicJob.ts',
  'src/index.ts',
  'src/bot/createBot.ts',
  'src/alerts/formatters.ts',
  'src/types.ts',
  'tests/forensics/contractLlmIsolation.acceptance.test.ts',
  'tests/forensics/contractLlmVerdict.test.ts',
  'tests/check/contractDecisionV2.acceptance.test.ts',
  'tests/check/smartContractCheck.test.ts',
  'tests/check/whereIsMoneyCheck.test.ts',
  'tests/forensics/incomingDepositJob.test.ts',
  'tests/forensics/deepForensicJob.test.ts',
  'tests/bot/createBot.test.ts',
  'tests/alerts/formatters.test.ts'
) -Message 'fix: disable automatic contract llm'
```

Required review: spec-review then code-quality review. Reviewer must prove zero
fresh provider/cache calls across Smart/Where/Incoming/Deep/bootstrap,
`llm=null` for every fresh case, unknown `35 REVIEW`, no legacy value rendered
in Telegram/alerts, and legacy JSON payload unchanged and not overwritten with
zero active consumption.

## 12. Task 9 — remove LLM from money-origin assessment

**Files:**

- Modify `src/forensics/moneyOriginOperationalAssessment.ts`.
- Test `tests/forensics/moneyOriginLlmIsolation.acceptance.test.ts`.
- Test `tests/forensics/moneyOriginOperationalAssessment.test.ts`.

- [ ] **Step 1: remove LLM scoring, decision and dampening authority from money-origin assessment**

In `src/forensics/moneyOriginOperationalAssessment.ts`, including the branch
beginning around line 486, remove every path where contract LLM output can:

- create `actionableContractSuspicion` or a numeric
  `contractSuspicionLayers` entry;
- create an `llmSafeDefaultReason` or turn timeout/unavailability/insufficient
  data into `DECLINE`;
- dampen unknown-contract source policy or suppress an otherwise applicable
  deterministic final decline;
- turn a positive/legitimate LLM interpretation into `ACCEPTABLE` or lower a
  deterministic score;
- become `hardBad`, source policy, wallet role or the winning reason.

For the same deterministic input, all of these fields are deep-equal whether
LLM is disabled, unavailable, invalid, risky or legitimate:

```ts
[
  "riskScore",
  "decision",
  "riskBand",
  "walletRole",
  "sourcePolicy",
  "hardBad",
  "riskLayers",
  "warnings",
  "narrativeFacts"
] as const;
```

No LLM catalogue key, citation, diagnostic or raw prose remains in the active
assessment. Legacy LLM/cache visibility belongs only to Task 8's separate audit
path.

- [ ] **Step 2: remove LLM inputs and helpers from the active call graph**

Remove active reads/calls of:

- `contractSuspicionLayers`;
- `llmSafeDefaultReason`;
- `topLegitimateServiceLlmVerdict`;
- `llmVerdictWarnings`;
- `guardedApprovalReviewBlocksFinalDecline` when its result depends on LLM;
- `dampenUnknownContractSourcePolicy` when triggered by an LLM verdict.

The fresh operational input no longer accepts `contractLlmVerdicts`. If a
legacy adapter still reads a stored job containing that property, it discards
the property before calling the active assessment. `src/config.ts`, model
defaults and the generic LLM client are unchanged in Plan 2 because no automatic
contract/money-origin path consumes them.

- [ ] **Step 3: run focused GREEN tests**

```powershell
npx vitest run --configLoader bundle `
  tests/forensics/moneyOriginLlmIsolation.acceptance.test.ts `
  tests/forensics/moneyOriginOperationalAssessment.test.ts
npm run typecheck
```

Expected: unavailable/invalid/risky/legitimate legacy payloads never enter the
active function; all deterministic and presentation-input fields are identical
to a no-LLM job; the original audit row remains untouched through Task 8.

- [ ] **Step 4: commit**

```powershell
Commit-Plan2Task -AllowedPaths @(
  'src/forensics/moneyOriginOperationalAssessment.ts',
  'tests/forensics/moneyOriginLlmIsolation.acceptance.test.ts',
  'tests/forensics/moneyOriginOperationalAssessment.test.ts'
) -Message 'fix: isolate money origin scoring from llm'
```

Required review: spec-review then code-quality review. The reviewer must inspect
every old LLM decline/acceptable/layer/dampener branch, compare all deterministic
and presentation-input fields with/without legacy payloads and verify the active
money-origin function has no LLM input or helper call.

## 13. Task 10 — compatibility, knowledge, PostgreSQL acceptance and scope audit

**Files:**

- Create `tests/risk/remediationScoringCompatibility.test.ts`.
- Modify only `docs/knowledge/05-where-is-money-and-incoming.md`,
  `docs/knowledge/06-deepcheck.md`,
  `docs/knowledge/07-risk-scoring-matrix.md`,
  `docs/knowledge/08-admin-and-bot-ux.md`,
  `docs/knowledge/09-current-decisions.md`, and conditionally
  `docs/knowledge/10-open-problems.md` /
  `docs/knowledge/13-agent-observations.md` under the rules below.
- No migration, runtime/delivery or Address Poisoning file; no Telegram change
  beyond Task 8's two exact LLM-output deletions.

- [ ] **Step 1: add compatibility tests before adapter changes**

Add ID-linked cases proving:

```text
[REQ-01][REQ-30][COMPAT] structural GasFree principal stays eligible for latest-five scoring
[REQ-02][COMPAT] exact GasFree service fee remains excluded from v3 scoring candidates
[REQ-04][COMPAT] legacy v2 result is read without synthesizing ScoreAnchorV2
[REQ-05][COMPAT] direct contract result does not suppress Wallet/Incoming analysis
[REQ-18][COMPAT] ApprovalSafetyAssessmentV2 never enters AML score inputs
[REQ-38][COMPAT] invalid anchor/PSM stays fail-closed and legacy LLM stays audit-only after JSON round-trip
```

The four v3/adapter cases are expected RED before adapters and GREEN after the
minimum adapter changes. The two GasFree cases are new Plan 2 regression guards
over the already-implemented Plan 1 contract and may start GREEN; they are not
evidence for new Plan 2 behavior. Do not reinterpret old jobs.

If this compatibility test reveals a production/test mirror defect, fix and
commit it in the earlier task that owns that behavior, rerun that task's two
reviews and return to Task 10 clean. Task 10 itself commits no production source
and no pre-existing regression test.

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
  tests/forensics/contractLlmIsolation.acceptance.test.ts `
  tests/forensics/moneyOriginLlmIsolation.acceptance.test.ts `
  tests/risk/remediationScoringCompatibility.test.ts `
  tests/risk/finalDisposition.test.ts `
  tests/risk/scoringSignalMatrix.test.ts `
  tests/risk/scoringSignalMatrixInputs.test.ts `
  tests/risk/unifiedWalletRisk.test.ts `
  tests/forensics/incomingDepositJob.test.ts `
  tests/forensics/deepForensicJob.test.ts `
  tests/approvals/allowanceState.test.ts `
  tests/approvals/approvalRisk.test.ts `
  tests/approvals/sessionContext.test.ts `
  tests/approvals/approvalWorker.test.ts `
  tests/approvals/safetyRecheck.test.ts `
  tests/forensics/usddPsmRouteObservation.test.ts `
  tests/forensics/contractLlmVerdict.test.ts `
  tests/forensics/moneyOriginOperationalAssessment.test.ts `
  tests/check/smartContractCheck.test.ts `
  tests/check/whereIsMoneyCheck.test.ts `
  tests/bot/createBot.test.ts `
  tests/alerts/formatters.test.ts `
  tests/tron/tronClient.test.ts `
  tests/storage/allowanceCausality.postgres.test.ts
```

Expected: every Plan 2-owned AC test GREEN; PostgreSQL tests actually execute, not skip.

- [ ] **Step 3: run typecheck and full regression**

```powershell
npm run typecheck
npm test
```

Expected: GREEN. This is Plan 2 regression evidence, not AC-41 production proof; final operations owns AC-41.

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

- `05` — exact PSM modifiers for Where/Incoming and limits; active money-origin
  assessment has no LLM input/output;
- `06` — historical Deep PSM half-weight only when exact observation exists;
- `07` — matrix v3, ScoreAnchor invariants, collector cap/composition, wallet-safety/AML separation;
- `08` — fresh/legacy LLM output and AI-verdict headings are no longer rendered;
  every other unified Telegram UX change remains Plan 4;
- `09` — automatic contract/money-origin LLM disabled, fresh `llm=null`, unknown
  contract `35 REVIEW`, strict assessment binding, legacy LLM/cache audit-only,
  production still unchanged until explicit rollout;
- `10` — remove only gaps actually fixed; add any discovered unfixed recurring problem;
- `13` — update only if implementation reveals a new repeated mistake, not as routine changelog.

Do not claim the broader Plan 4 Telegram redesign or runtime/deployment is current.

- [ ] **Step 6: run scope audit from the dynamic base**

```powershell
$PLAN2_BASE_SHA = (git config --get branch.codex/remediation-scoring-contract-semantics.plan2BaseSha).Trim()
git diff --check $PLAN2_BASE_SHA..HEAD
git diff --name-status $PLAN2_BASE_SHA..HEAD
$presentationDiff = @(git diff --name-only $PLAN2_BASE_SHA..HEAD -- src/bot src/alerts)
$allowedPresentationDiff = @('src/bot/createBot.ts', 'src/alerts/formatters.ts')
$unexpectedPresentation = @($presentationDiff | Where-Object { $_ -notin $allowedPresentationDiff })
if ($unexpectedPresentation.Count -ne 0) {
  throw "Unexpected presentation diff: $($unexpectedPresentation -join ', ')"
}
git diff --name-only $PLAN2_BASE_SHA..HEAD -- src/admin src/monitor src/runtime migrations
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
- Admin/monitor/runtime/migrations output empty;
- presentation diff contains at most `src/bot/createBot.ts` and
  `src/alerts/formatters.ts`; reviewer confirms their hunks only delete legacy
  LLM output/helper code;
- no Plans 3–5 created;
- no `package.json` dependency change;
- no production/deploy/runtime label change;
- Address Poisoning files absent.

`src/index.ts` is the only allowed bootstrap/orchestration file. Its diff is
limited to direct allowance dependency injection (Task 5) and removal of
automatic contract-LLM analyzer construction/injection (Task 8); reviewer checks
both hunks manually and rejects timer/delivery/startup changes.

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
Commit-Plan2Task -AllowedPaths @(
  'tests/risk/remediationScoringCompatibility.test.ts',
  'docs/knowledge/05-where-is-money-and-incoming.md',
  'docs/knowledge/06-deepcheck.md',
  'docs/knowledge/07-risk-scoring-matrix.md',
  'docs/knowledge/08-admin-and-bot-ux.md',
  'docs/knowledge/09-current-decisions.md',
  'docs/knowledge/10-open-problems.md',
  'docs/knowledge/13-agent-observations.md'
) -Message 'docs: record scoring and contract semantics'
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

## 14. Traceability matrix — REQ/AC → task → new test

Every test named below is introduced by Plan 2. Existing GREEN tests remain
regression support only and never satisfy a new AC by themselves.

### 14.1 REQ traceability

| Requirement | Ownership | Task | New concrete test(s) |
|---|---|---:|---|
| REQ-01 | regression integration | 10 | `[REQ-01][REQ-30][COMPAT] structural GasFree principal stays eligible for latest-five scoring` |
| REQ-02 | regression integration | 10 | `[REQ-02][COMPAT] exact GasFree service fee remains excluded from v3 scoring candidates` |
| REQ-04 | primary | 2, 10 | exact-proof/coverage anchor tests including `[REQ-04][REQ-15][ANCHOR-COVERAGE]`, `[REQ-04][REQ-15][ANCHOR-AUTHORITY]`; `[REQ-04][COMPAT] legacy v2 result is read without synthesizing ScoreAnchorV2` |
| REQ-05 | primary | 2, 7, 10 | anchor/mode separation tests; `[REQ-05][REQ-21][CONTRACT-SUBJECT] ignores foreign approval or service-session assessments`; `[REQ-05][COMPAT] direct contract result does not suppress Wallet/Incoming analysis` |
| REQ-08 | primary | 7 | `[REQ-08] keeps victim spender receiver and route roles distinct and leaves ordinary transferFrom as context`; `[REQ-08][CONTRACT-EVIDENCE] refuses exact debit authority without exact_debit evidence kind`; `[REQ-08][CONTRACT-EVIDENCE] refuses Verify20 authority without verify20_fingerprint evidence kind` |
| REQ-15 | primary | 2 | every `[ANCHOR-*]` test covering score, policy row, subject/mode, evidence, preferred fact, coverage dependency, authority, cardinality and legacy handling |
| REQ-16 | primary | 3 | `[AC-01]`, both `[AC-02]` tests and `[REQ-16][COLLECTOR]` partial-overlap/empty-id/coverage-clean/repeated-collector tests |
| REQ-17 | primary | 3 | `[REQ-17] preserves a material relationship with a currently blacklisted counterparty` |
| REQ-18 | primary | 6, 10 | every Approval Safety AC asserts `amlScoreImpact: 0`; `[REQ-18][COMPAT] ApprovalSafetyAssessmentV2 never enters AML score inputs` |
| REQ-19 | secondary scoring integration | 5, 6 | PostgreSQL AC-19/23 and `[REQ-19][POSTGRES][ALLOWANCE-FAILURE]` tests plus `[REQ-19][ALLOWANCE-REFRESH]` trigger/error/no-event-fallback tests |
| REQ-20 | primary | 6 | `[AC-19]`, `[AC-22]`, `[AC-23]`, `[AC-33]` and `[REQ-20][VERIFY20-TIERS] applies all current-allowance tiers at exact USDT boundaries` |
| REQ-21 | primary | 6, 7 | exact/inexact service-session tests plus `[REQ-05][REQ-21][CONTRACT-SUBJECT]` spender/token/evidence binding |
| REQ-22 | primary | 6 | `[AC-28] removes transaction expiration from approval risk` |
| REQ-23 | primary | 7, 8, 9 | deterministic authority/no-call tests, `[AC-34]…[AC-40]` disabled-LLM tests and both `[REQ-23][REQ-25][LLM-ORIGIN]` removal tests |
| REQ-24 | primary | 7 | AC-29/30/40, GasFree boundary, `[REQ-24][CONTRACT-UNKNOWN] resolves unknown metadata without exact bad or service proof at REVIEW 35` and `[REQ-24][CONTRACT-UNKNOWN] requires subject-bound metadata_context for REVIEW 35` |
| REQ-25 | primary | 7, 8, 9 | `[AC-38][LLM-NOCALL]`, AC-40/orchestration no-call tests, `[REQ-25][REQ-26][LLM-LEGACY]`, `[AC-39][REQ-25][LLM-LEGACY][TELEGRAM]` and money-origin removal tests |
| REQ-26 | primary | 8 | AC-34…38 disabled-input tests and `[REQ-25][REQ-26][LLM-LEGACY] never reads legacy LLM into scoring decision or presentation input` |
| REQ-28 | primary | 4 | `[AC-03]` through `[AC-06]` exact PSM identity/continuity/direction tests |
| REQ-29 | primary | 4 | `[AC-03]` through `[AC-06]` plus the exact 4.999999/5/20/50/80/100 percent boundary table |
| REQ-30 | regression integration | 10 | `[REQ-01][REQ-30][COMPAT] structural GasFree principal stays eligible for latest-five scoring` |
| REQ-38 | secondary scoring integration | 2, 4, 8, 9, 10 | invalid anchor, inexact PSM, disabled fresh LLM, legacy audit isolation, money-origin removal and the updated `[REQ-38][COMPAT]` round-trip test |

### 14.2 AC traceability

| AC | Task | New test file | New exact test name |
|---|---:|---|---|
| AC-01 | 3 | `tests/risk/collectorUsddRemediation.acceptance.test.ts` | `[AC-01] caps collector-only evidence at REVIEW 35` |
| AC-02 | 3 | same | `[AC-02] allows collector 55 only with an independent eligible AML signal`; `[AC-02] does not treat the same evidence episode as an independent signal` |
| AC-03 | 4 | same | `[AC-03] scores 2 percent outbound USDD PSM with direction adjustment` |
| AC-04 | 4 | same | `[AC-04] scores 83 percent direct inbound USDD PSM at top tier` |
| AC-05 | 4 | same | `[AC-05] halves historical Deep USDD PSM and caps modifier at 12` |
| AC-06 | 4 | same | `[AC-06] keeps label-only or discontinuous USDD PSM unscored` |
| AC-19 | 5, 6 | `tests/approvals/approvalSafetyV2.acceptance.test.ts`; `tests/approvals/approvalSafety.postgres.test.ts` | `[AC-19] scores confirmed unlimited Verify20 approval at CRITICAL 90`; `[REQ-20][VERIFY20-TIERS] applies all current-allowance tiers at exact USDT boundaries`; `[REQ-19][AC-19][POSTGRES] scores the persisted fresh direct allowance state` |
| AC-22 | 6 | `tests/approvals/approvalSafetyV2.acceptance.test.ts` | `[AC-22] caps one selector or provider name at review context` |
| AC-23 | 5, 6 | same plus PostgreSQL file | `[AC-23] removes active threat after confirmed zero allowance`; `[REQ-19][AC-23][POSTGRES] removes active threat after a later confirmed zero` |
| AC-25 | 6 | same | `[AC-25] recognizes exact Bridgers 66-second 91.103009 session as LOW 10`; `[REQ-21][SERVICE-SESSION] rejects every inexact known-service session: %s` |
| AC-26 | 6 | same | `[AC-26] refuses service-session dampener for tag-only evidence` |
| AC-28 | 6 | same | `[AC-28] removes transaction expiration from approval risk` |
| AC-29 | 7 | `tests/check/contractDecisionV2.acceptance.test.ts` | `[AC-29] resolves official TRON USDT at LOW 0 without LLM` |
| AC-30 | 7 | same | `[AC-30] resolves GasFree Account at LOW 10 without LLM and keeps flows eligible`; `[REQ-24][GASFREE-BOUNDARY] never classifies a GasFree endpoint or controller as ordinary GasFree Account LOW 10` |
| AC-31 | 6, 7 | both Approval Safety and Contract Decision acceptance files | `[AC-31] keeps exact Bridgers approval session LOW instead of decline` |
| AC-32 | 6, 7 | both files | `[AC-32] keeps known-service unlimited approval without session at REVIEW 45` |
| AC-33 | 6, 7 | both files | `[AC-33] prevents service-context dampening of provider risk Verify20 or debit proof` |
| AC-34 | 8 | `tests/forensics/contractLlmIsolation.acceptance.test.ts` | `[AC-34][LLM-DISABLED] ignores every fresh LLM score payload` |
| AC-35 | 8 | same | `[AC-35][LLM-DISABLED] ignores every verdict and recommendation payload` |
| AC-36 | 8 | same | `[AC-36][LLM-LEGACY] keeps cached citations as audit-only payload` |
| AC-37 | 8 | same | `[AC-37][LLM-DISABLED] keeps risky or uncited legacy verdict out of fresh decisions` |
| AC-38 | 8 | same | `[AC-38][LLM-NOCALL] makes zero provider calls for timeout JSON and schema scenarios` |
| AC-39 | 8 | `tests/forensics/contractLlmIsolation.acceptance.test.ts`; Bot/Alert regression tests | `[AC-39][REQ-25][LLM-LEGACY][TELEGRAM] removes model output from Bot and Alert formatting` |
| AC-40 | 7, 8 | Contract Decision and LLM Isolation acceptance files | `[AC-40] bypasses Flash and Pro for every fresh contract case`; `[AC-40][LLM-NOCALL] bypasses Flash and Pro for unknown and ambiguous contracts` |

### 14.3 Sequential commit and review boundaries

| Task | Commit boundary | Required reviews before next task |
|---:|---|---|
| 0 | no commit; verify approved plan-only ancestry and clean isolated worktree | independent spec-review; independent code-quality/safety review |
| 1 | `test: define scoring and contract remediation acceptance` — new RED tests/fixtures only | independent spec-review; independent code-quality review |
| 2 | `feat: bind fresh scores to canonical evidence` | independent spec-review of ten anchor invariants; independent code-quality review |
| 3 | `fix: bound collector behavior scoring` | independent spec-review; independent overlap/empty/duplicate episode code-quality review |
| 4 | `feat: score exact usdd psm exposure` | independent spec-review; independent BigInt/base-derivation code-quality review |
| 5 | `feat: confirm current usdt allowance directly` | independent spec-review; independent trigger/error/current-state code-quality review |
| 6 | `feat: resolve approval wallet safety deterministically` | independent spec-review; independent tier/session/AML-isolation code-quality review |
| 7 | `feat: make contract decisions deterministic` | independent spec-review; independent no-call/GasFree-boundary code-quality review |
| 8 | `fix: disable automatic contract llm` | independent spec-review; independent no-call/legacy-audit isolation code-quality review |
| 9 | `fix: isolate money origin scoring from llm` | independent spec-review; independent active-input/legacy-isolation code-quality review |
| 10 | `docs: record scoring and contract semantics` — compatibility/knowledge only | whole-branch independent spec-review; whole-branch independent code-quality review |

For Tasks 1–10, the section 2.1 commit fence is mandatory: all and only that
task's modified files are committed, `git diff --cached --check` passes, and
`git status --porcelain` is empty before either review begins.

## 15. Rollback

Plan 2 is code/policy only and adds no schema.

Before local merge:

```powershell
git worktree remove 'C:\Users\User\OneDrive\Desktop\smartcontract-remediation-scoring-contract-semantics'
git branch -D codex/remediation-scoring-contract-semantics
```

Use only after explicit discard confirmation. The main worktree and production remain unchanged.

After a future local merge but before production rollout:

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

After production rollout, operations owns rollback and must preserve schema 032 receipts while reverting policy/runtime as a coordinated change.

## 16. Self-review checklist

- [x] Primary ownership matches the canonical REQ map and its section 4.6
  LLM-disabled amendment: Plan 4 ACs 20/21/24/27 stay excluded; AC-39's exact
  obsolete LLM-output deletion moves to Task 8.
- [x] Every Plan 2-owned AC has a new test whose name starts with its ID.
- [x] Mandatory first RED batch includes every strict ScoreAnchor invariant,
  collector adversarial composition, all Verify20 tiers/boundaries, allowance
  trigger/error cases, exact/inexact service sessions, strict foreign-assessment
  binding, GasFree boundaries, unknown-contract `35 REVIEW`, contract/money-origin
  automatic LLM removal and legacy audit isolation, REQ-28, AC-01…06, AC-19, AC-22,
  AC-25, AC-26, AC-29, AC-30 and AC-34…40.
- [x] PostgreSQL runs in the first RED batch and final GREEN gate.
- [x] Plan 1 types are consumed, not redefined incompatibly.
- [x] Exact USDD formula, half-up order, named cap/max/base constants and the
  derivation `45 - 25 = 20` are explicit.
- [x] All ten ScoreAnchor score/policy/subject-mode/evidence/preferred-fact/
  coverage/authority/cardinality/legacy invariants fail closed.
- [x] Allowance event history, current direct call, wallet safety and AML are
  separate; Plan 2 refreshes only at new event, finalization and explicit recheck.
- [x] Timeout, malformed response, revert and provider failure yield
  `UNKNOWN/null`; event amount never becomes a current-value fallback.
- [x] Verify20 max/100/99.999999/zero tiers are explicit raw-integer tests.
- [x] Exact Bridgers session is address-, caller-, time-, success-, sequence-,
  action- and amount-bound; every negative predicate has a RED test.
- [x] GasFree endpoint/controller/boundary cannot enter ordinary-account LOW 10.
- [x] Every fresh contract, including unknown/ambiguous, has `llm=null` and makes
  zero Flash/Pro/cache calls; unknown without exact bad/service proof requires
  subject-bound `metadata_context` for `35 REVIEW`.
- [x] Legacy LLM/cache JSON remains audit-readable, unchanged and not
  overwritten, but is absent from active scoring, decision, narrative facts,
  warnings and Telegram-facing projection.
- [x] Money-origin active inputs/outputs contain no LLM data or helper call;
  `src/config.ts` and model defaults are outside Plan 2 and unchanged.
- [x] Approval/session assessment affects a contract only with exact
  subject-as-spender, official-USDT and resolvable current-evidence binding.
- [x] Telegram scope is limited to deleting the two obsolete LLM sections;
  unified copy/layout/workflows remain Plan 4. No delivery, Admin, migration,
  Address Poisoning or production work is included.
- [x] Dynamic `PLAN2_BASE_SHA`, RED/GREEN commands, rollback, knowledge updates and scope audit are specified.
- [x] Every task, including Task 0, has separate spec-review and code-quality
  review gates; Tasks 1–10 use an exact allowlist commit fence and end clean.
- [x] RED files lazy-load not-yet-created production modules inside test bodies so every ID-linked test is discovered before the expected failure.
- [x] Address Poisoning source, schema, fixtures and tests are all explicit forbidden diff paths and are only executed read-only.
- [x] A complete REQ/AC → task → new-test matrix is present.
- [x] No Plan 3–5 document is created.

## 17. Approval checkpoint

The user has approved Plan 2 subject to this mechanical checkpoint amendment.
Commit the canonical remediation-spec amendment first as a spec-only commit,
then commit this Plan 2 amendment as a plan-only commit. Task 0 then verifies
the fixed code base `5c865d97ab2732b4fd0bb354ae41aeb0ea797b86`: between that SHA
and implementation HEAD the complete diff must contain exactly the canonical
remediation spec and Plan 2 paths. Any other path blocks execution. Task 0
records the dynamic plan-head SHA and creates the clean implementation worktree;
Task 0 itself creates no commit.
Production code begins only after Task 1 has discovered, recorded and committed
the expected RED tests. Production DB, deployed runtime, `/version` and live
Telegram remain unchanged until explicit rollout.
