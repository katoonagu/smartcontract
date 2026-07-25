# Runtime And Delivery Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development` (preferred) or
> `superpowers:executing-plans` task by task. Every production change follows
> TDD and every task has a separate spec review and code-quality review.

**Status:** утверждён; implementation не начат. Документ коммитится отдельным
plan-only commit до создания implementation worktree.

**Goal:** внедрить durable reconciliation ожидающих Where/Incoming jobs,
отделённую от forensic result доставку Telegram, ограниченный background refresh
устаревшего USDT allowance, cache-only обычную навигацию и неблокирующие check
callbacks — без изменения scoring, итогового Telegram copy, production runtime,
schema 032 и Address Poisoning.

**Architecture:** Plan 3 принимает typed results Plans 1–2 как неизменяемый вход.
Один PostgreSQL reconciler атомарно переводит родительский job из
`waiting_for_targeted_index` только после анализа полного durable wait-set.
Forensic completion CAS сохраняет immutable result и versioned delivery envelope
в существующем `progress_json`; отдельный bounded worker claims pending/retryable
delivery по fingerprint, lease token и attempts. Поздний Deep second-layer
refresh сохраняет отдельный versioned context в `progress_json`, не переписывая
завершённый `result_json`. Dashboard читает fresh или stale cache без TronScan,
а explicit refresh и первый cache miss запускают один deduplicated background
load. Slow `/check` work никогда не удерживает Telegram update handler. Новых
dependencies и таблиц нет.

**Tech stack:** TypeScript 5.7, Node.js ESM, Vitest 4, PostgreSQL/`pg`, grammY,
существующие repository/job/dashboard modules.

---

## 1. Authority, ownership и границы

Канонические источники:

- `docs/superpowers/specs/2026-07-12-telegram-runtime-forensics-remediation-design.md`;
- `docs/audit/2026-07-12-telegram-runtime-forensics-conformance-audit.md`;
- Plan 1 data foundation и Plan 2 scoring/contract semantics в текущем local
  `master`.

### 1.1 Primary ownership

Plan 3 владеет только:

- `REQ-35` — idempotent all-waits reconciliation для Where/Incoming;
- `REQ-36` — forensic result и Telegram delivery имеют независимые lifecycle;
- `REQ-37` — callback ack/background checks, cache-only navigation, explicit
  refresh и first-load dedupe;
- `AC-14…AC-18` полностью.

### 1.2 Secondary integration ownership

Plan 3 проверяет, но не переопределяет:

- `REQ-03` — retry/delivery не меняет сохранённые coverage/counts;
- `REQ-05` — Where, Deep и Incoming delivery остаются привязаны к своему mode;
- `REQ-19` — bounded background refresh устаревшего current allowance; exact
  state и scoring semantics остаются такими, как реализованы Plans 1–2;
- `REQ-38` — contradictory waits остаются waiting с diagnostic, no-cache даёт
  loading/background, а все Plan 3 cycles стартуют только после verified schema
  032 gate.

### 1.3 Forbidden scope

Plan 3 не меняет:

- score, decision, policy rows, `ScoreAnchorV2`, `preferredFactId`, USDD/collector/
  Verify20/contract semantics;
- unified Telegram result structure, headings, emoji, links, wording или
  renderers — это Plan 4; разрешён только короткий transient loading state;
- Admin UX;
- migration SQL, migration receipt/checksum, `.gitattributes` или migrator;
- `/version`, runtime label, deploy, production DB/runtime/Telegram;
- Address Poisoning detector, schema, worker, delivery, callback, copy, fixtures
  и tests;
- Plans 4–5 documents.

Plan 3 также **не** снимает и не увеличивает configured
`hard_safety_limit_exceeded`, provider/local page caps и другие bounded limits.
Тяжёлый адрес всё ещё может честно завершиться без final score. Plan 4 объясняет
это ограничение пользователю, а отдельная operational acceptance проверяет доставку no-final сообщения;
Plan 3 не обещает обработать неограниченное число страниц.

Production остаётся на предыдущем verified runtime до explicit rollout. Все PostgreSQL
проверки используют только disposable `tron_watch_plan3`. Plan 3 не запускает
production `db:migrate`, bot restart или Telegram polling.

## 2. Planning baseline и implementation checkpoint

Read-only planning baseline после локального merge Plan 2:

```text
PLAN3_PLANNING_MASTER_SHA=83f0cb967f61b814896e5d1a4cf01cecb1c56b59
```

До implementation этот документ должен быть утверждён и закоммичен отдельным
plan-only commit. Task 0 динамически фиксирует `PLAN3_BASE_SHA` от тогдашнего
`master`. Между `PLAN3_PLANNING_MASTER_SHA` и `PLAN3_BASE_SHA` разрешён ровно
один путь:

```text
docs/superpowers/plans/2026-07-15-remediation-runtime-and-delivery.md
```

Любой другой committed path блокирует выполнение и требует повторного review.
Незакоммиченные пользовательские файлы основного workspace не включаются в
worktree и не считаются частью Plan 3.

## 3. Runtime contracts и строгие инварианты

### 3.1 Canonical contracts

Plan 3 использует без переименования canonical contracts:

```ts
type TelegramDeliveryStateV1 = {
  status: "pending" | "sent" | "retryable" | "failed";
  attemptCount: number;
  lastAttemptAt: string | null;
  sentAt: string | null;
  lastError: string | null;
  messageFingerprint: string;
};

type WaitReconciliationResultV1 = {
  parentJobId: string;
  readyCount: number;
  terminalCount: number;
  cancelledCount: number;
  waitingCount: number;
  outcome: "resume_ready" | "resume_terminal" | "unchanged" | "contradictory";
  diagnosticCode: string | null;
};
```

Implementation envelope:

```ts
type TelegramMessagePayloadV1 = {
  version: "telegram-message-payload-v1";
  chatId: string;
  text: string;
  parseMode: "HTML" | null;
  replyMarkup: Record<string, unknown> | null;
};

type TelegramDeliveryEffectV1 =
  | {
      kind: "incoming_user_alert";
      watchedWalletId: string;
      incomingTxHash: string;
    }
  | null;

type TelegramDeliveryClaimV1 = {
  token: string;
  attempt: number;
  claimedAt: string;
  leaseExpiresAt: string;
};

type ForensicTelegramDeliveryV1 = {
  version: "forensic-telegram-delivery-v1";
  payload: TelegramMessagePayloadV1;
  effect: TelegramDeliveryEffectV1;
  state: TelegramDeliveryStateV1;
  claim: TelegramDeliveryClaimV1 | null;
};

type DeepSecondLayerContextV1 = {
  version: "deep-second-layer-context-v1";
  baseResultFingerprint: string;
  refreshedAt: string;
  profile: DeepSecondLayerRelationshipProfile;
};

type RecoveredForensicDeliveryIntentV1 = {
  version: "recovered-forensic-delivery-intent-v1";
  kind: "stale_failure";
  createdAt: string;
  reasonCode: string;
  preparationStatus: "pending" | "retryable" | "failed";
  preparationAttemptCount: number;
  lastPreparationAttemptAt: string | null;
  nextPreparationAttemptAt: string | null;
  lastPreparationError: string | null;
};
```

Envelope хранится как `progress_json.telegramDelivery`; `result_json` не
содержит transport state и не изменяется delivery worker. Узкое исключение для
terminal stale-recovery: recovery CAS атомарно сохраняет bounded
`progress_json.telegramDeliveryIntent`; preparation cycle превращает его в
обычный pending envelope до claim/send. Это закрывает crash-gap старого direct
send и не обрабатывает historical jobs без versioned intent. Preparation
обрабатывает максимум `10` intents за cycle и максимум `4` попытки на intent.
После ошибок attempts 1/2/3 применяет `30s / 120s / 600s`; четвёртая ошибка
атомарно оставляет intent в terminal `failed` с allowlisted code
`stale_intent_preparation_attempts_exhausted`. Terminal intent больше не
выбирается для preparation/claim/send и не меняет forensic result.

### 3.2 Wait reconciliation invariants

Для queued Where/Incoming parent с phase `waiting_for_targeted_index`:

1. Если существует хотя бы один `waiting`, outcome = `unchanged`; phase не
   меняется.
2. Если wait rows отсутствуют, outcome = `contradictory`, diagnostic =
   `missing_wait_rows`; parent остаётся waiting.
3. Если присутствует хотя бы один `cancelled`, outcome = `contradictory`,
   diagnostic = `cancelled_wait_present`; parent остаётся waiting.
4. Если waiting/cancelled нет и есть хотя бы один `terminal`, outcome =
   `resume_terminal`; mixed `ready + terminal` допустим и phase становится
   `provider_limited`.
5. Если все существующие waits `ready`, outcome = `resume_ready`; phase
   становится `reading_local_index`.
6. Running/completed/partial/failed/cancelled parent не изменяется.
7. Parent transition — один atomic compare-and-set. Повторный reconciler не
   повторяет transition и обычный claim получает parent не более одного раза.
8. Event-driven targeted-index completion обновляет durable wait row, но больше
   не является единственным владельцем parent wake-up.

### 3.3 Delivery invariants

1. Message fingerprint — lowercase SHA-256 canonical JSON от `chatId`, `text`,
   `parseMode`, `replyMarkup`; Node `crypto`, без dependency.
2. `pending`: attempts `0`, timestamps/error `null`, `claim = null`.
3. Claim атомарно переводит `pending`, due `retryable` без active lease либо
   expired in-flight attempt в representation `retryable`, увеличивает attempts
   и записывает fresh cryptographically-random claim token, `claimedAt` и
   `leaseExpiresAt`. Lease = **40 секунд**: send timeout `25s` + settlement grace
   `15s`. Token содержит минимум 128 бит энтропии; claim attempt равен
   `state.attemptCount`, а `state.lastAttemptAt = claim.claimedAt`.
4. In-flight representation: `status="retryable"`, `claim != null`,
   `lastError=null`. Settled retryable: `status="retryable"`, `claim=null`,
   `lastError` содержит allowlisted retry code и backoff считается от
   `lastAttemptAt`.
5. `sent`: attempts `1…4`, `sentAt >= lastAttemptAt`, `lastError = null`,
   `claim = null`.
6. `failed`: attempts `1…4`, `sentAt = null`, bounded diagnostic code в
   `lastError`, `claim = null`.
7. Backoff после завершённых retryable attempts 1/2/3: `30s / 120s / 600s`;
   explicit retryable settlement очищает claim. До expiry active lease другой
   claim запрещён. После crash expired attempts 1–3 atomically reclaimable;
   expired attempt 4 atomically становится `failed` с
   `telegram_attempts_exhausted` через тот же atomic effect-settlement, payload
   больше не выдаётся и attempt 5 не существует. Send timeout = `25s`; batch
   limit = `10`.
8. `pending` создаётся атомарно в том же completion CAS, что immutable result.
   False completion CAS не создаёт claimable delivery и запрещает direct send.
9. Success/failure settlement сравнивает job id, fingerprint, attempt number и
   claim token; settlement старого/superseded token игнорируется.
10. `sent` fingerprint никогда не claim/send повторно. Telegram API не имеет
   idempotency key, поэтому timeout после фактического приёма Telegram остаётся
   честной at-least-once границей; exactly-once после неизвестного network
   outcome не обещается.
11. Retry/permanent delivery failure меняет только delivery state. Forensic
    status/result/risk/coverage не меняются.
12. Incoming success или permanent failure одной PostgreSQL-транзакцией и
    одним repository settlement обновляет forensic delivery и связанный
    incoming `user_alert_status`. Ошибка/CAS miss второй записи откатывает обе.
    Retryable settlement меняет только delivery, оставляя текущий alert status
    (`sending`/`analyzing`) без изменения; worker никогда отдельно не вызывает
    `markUserAlertSent/Failed` после settlement.
13. Как только terminal Incoming job содержит versioned
    `incoming_user_alert` delivery effect, legacy `claimUserAlertsForRetry`
    исключает эту observed-transaction row при любом delivery status. Владельцем
    повторной отправки становится delivery lifecycle; повторный analysis/job
    queue не запускается.
14. Error storage/logging содержит allowlisted code, а не raw Telegram token,
    message, wallet, chat или provider payload.
15. Stale-recovery terminal transition сохраняет versioned delivery intent в
    том же CAS. Intent preparation идемпотентно создаёт pending envelope; job без
    этого exact intent не backfill-отправляется. Старый recovery direct send
    удаляется. Preparation failure атомарно увеличивает bounded attempt counter,
    сохраняет только allowlisted error и schedule; attempts 1–3 retryable,
    attempt 4 terminal failed. Success CAS разрешён только для exact текущего
    intent/attempt, поэтому stale preparation result игнорируется.
16. `result_json` любого completed/partial/failed forensic job immutable после
    completion. Deep second-layer enrichment после completion хранится только в
    `progress_json.deepSecondLayerContext` как `DeepSecondLayerContextV1`, bound
    к lowercase SHA-256 canonical JSON fingerprint базового result. Refresh
    может заменить только этот context новой версией; он не меняет result,
    score, coverage, evidence или delivery payload/fingerprint и не запускает
    повторную Telegram-доставку.

Retryable codes: `telegram_timeout`, `telegram_rate_limited`,
`telegram_server_error`, `telegram_network_error`, `telegram_unknown_retryable`.
Permanent codes: `telegram_chat_forbidden`, `telegram_bad_request`,
`telegram_attempts_exhausted`.

Stale-intent preparation retryable codes:
`stale_intent_context_unavailable`, `stale_intent_payload_build_failed`,
`stale_intent_unknown_retryable`. Они сохраняются bounded без raw exception.
Для attempts 1/2/3 `preparationStatus="retryable"`,
`nextPreparationAttemptAt = lastPreparationAttemptAt + 30s/120s/600s`. Для
attempt 4 `preparationStatus="failed"`, `nextPreparationAttemptAt=null`,
`lastPreparationError="stale_intent_preparation_attempts_exhausted"`. Pending
имеет count `0` и все attempt/error timestamps `null`; допустимый count только
целое `0…4`.

### 3.4 Background allowance refresh invariants

1. Eligible только official-USDT owner/spender rows активного watched wallet,
   которые `failed`, `stale` или имеют `allowance_fresh_until <= now`.
2. `allowance_last_attempt_at` должен отсутствовать либо быть не новее
   `now - 15 minutes`; poll может идти чаще, но full-node call не повторяется для
   каждого approval каждые 60 секунд.
3. Один cycle обрабатывает максимум `5` targets.
4. Для каждого target берётся session advisory lock по
   `allowance-refresh:<walletId>:<token>:<spender>` и после lock повторно
   проверяется eligibility.
5. Provider timeout = `15s`; один failure не останавливает batch.
6. Используется существующий `refreshApprovalAllowance` с новым reason
   `background_stale_refresh`; timeout/malformed/revert/provider failure сохраняет
   `UNKNOWN/null`, а historical event amount не становится current allowance.
7. Causality guard Plan 2 остаётся владельцем write ordering; stale result не
   перезаписывает более новый event/finalization/recheck result.
8. Worker использует existing poll cadence и отдельный non-overlap guard; новый
   scheduler label и новый dependency не добавляются.
9. Targets одного cycle обрабатываются строго последовательно (`for...of`,
   concurrency `1`). Один target удерживает pinned PostgreSQL connection и
   advisory lock до `15s`; `Promise.all`/parallel provider reads запрещены.

### 3.5 Dashboard/callback invariants

1. Обычные wallet view/analytics/risk/safety tabs читают fresh или stale cache и
   делают zero TronScan calls.
2. Cache miss сразу показывает loading, затем запускает background refresh.
3. Только explicit refresh и first cache miss вызывают live provider.
4. Одновременно существует максимум один in-flight refresh на wallet id; все
   callers присоединяются к одному promise. Entry удаляется в `finally`.
5. Explicit refresh показывает loading до provider result; provider error
   оставляет stale cache либо честный error state.
6. Non-poison callback ack остаётся до DB/provider work. Address Poisoning
   callback path не изменяется.
7. `/check`, direct check-address callback и tx check запускают existing
   background path после immediate started response; handler возвращается до
   unresolved slow promise и может принять следующий callback.

## 4. File map

### Create

- `src/forensics/waitReconciliation.ts` — pure wait decision/validation.
- `src/forensics/telegramDelivery.ts` — payload fingerprint, state validator,
  retry transition/error classification.
- `src/forensics/telegramDeliveryWorker.ts` — bounded claim/send/settle cycle.
- `src/runtime/forensicRuntimeOrchestration.ts` — schema-gated startup и
  cadence ordering для reconciliation/delivery без блокировки delivery на Where.
- `src/approvals/allowanceRefreshWorker.ts` — bounded due-state refresh cycle.
- `tests/fixtures/runtime/remediationRuntimeCases.ts`.
- `tests/runtime/waitReconciliation.acceptance.test.ts`.
- `tests/runtime/strandedParentRecovery.acceptance.test.ts`.
- `tests/runtime/telegramDelivery.acceptance.test.ts`.
- `tests/runtime/walletNavigation.acceptance.test.ts`.
- `tests/runtime/checkCallbacks.acceptance.test.ts`.
- `tests/runtime/allowanceRefresh.acceptance.test.ts`.
- `tests/runtime/runtimeSchemaGateIntegration.acceptance.test.ts`.
- `tests/storage/runtimeDelivery.postgres.test.ts`.

### Modify

- `src/types.ts` — canonical runtime contracts and delivery envelope.
- `src/forensics/forensicJobProgress.ts` — validated delivery/reconciliation
  progress projection.
- `src/storage/repositories.ts` — reconciler, completion CAS, delivery claim/
  settle, due allowance targets and advisory-lock helper.
- `src/forensics/deepForensicJob.ts` — Where/Deep completion prepares delivery,
  never sends directly.
- `src/forensics/deepSecondLayerRefresh.ts` — post-completion enrichment пишет
  versioned context, а не completed `result_json`.
- `src/forensics/incomingDepositJob.ts` — result-first completion and deferred
  delivery/alert effect.
- `src/forensics/addressIndexWorker.ts` — post-index reconciler hook only.
- `src/approvals/allowanceRefresh.ts` — add bounded background reason.
- `src/wallet/dashboard.ts` — cache-only read and explicit live refresh split.
- `src/bot/createBot.ts` — loading/dedupe/background lifecycle only; no result
  copy redesign.
- `src/index.ts` — dependencies, startup/pre-poll/post-index reconciliation,
  delivery/allowance non-overlap cycles and shutdown wait.
- Existing focused unit tests under `tests/forensics`, `tests/approvals`,
  `tests/wallet`, `tests/bot`, `tests/runtime`, `tests/storage` only where a
  legacy assertion contradicts the approved behavior.
- `tests/forensics/deepSecondLayerRefresh.test.ts` — immutable completed result
  и versioned second-layer context.
- `docs/knowledge/03-job-lifecycle.md`.
- `docs/knowledge/05-where-is-money-and-incoming.md`.
- `docs/knowledge/06-deepcheck.md`.
- `docs/knowledge/08-admin-and-bot-ux.md`.
- `docs/knowledge/09-current-decisions.md`.
- `docs/knowledge/10-open-problems.md`.
- `docs/knowledge/12-runbooks.md`.
- `docs/knowledge/13-agent-observations.md` only if implementation exposes a
  genuinely recurring agent mistake.

### Explicitly not modified

- `migrations/**`, `.gitattributes`, `scripts/migrate.ts`,
  `src/storage/schemaMigrations.ts`;
- `src/risk/**`, scoring/contract policy modules and result formatters;
- `src/admin/**`;
- `src/monitor/addressPoisoning.ts`,
  `src/monitor/addressPoisoningWorker.ts`, migration 031, poisoning fixtures/tests;
- `docs/superpowers/plans/*plan-4*`, `*plan-5*` or any equivalent documents;
- `package.json`, lockfile and dependencies.

## 5. Execution discipline

Implementation runs in isolated worktree branch
`codex/remediation-runtime-delivery`. Every task ends with:

1. stage all and only its allowlisted files;
2. `git diff --cached --check`;
3. one small task commit;
4. clean worktree;
5. independent spec review;
6. independent code-quality review;
7. task-focused GREEN before the next task.

If a review finds a defect, reopen that task, amend only its commit before any
later task starts, then repeat both reviews. User-owned files in the main
worktree are never staged, stashed, normalized or copied into this worktree.

Task 1 acceptance files are frozen after their RED commit. Tasks 2–10 run them
but do not edit them. If an acceptance test itself is proven inconsistent with
the approved spec, stop implementation and obtain approval for a separate
test-only correction; production work must not weaken a failing assertion.

Helper used after Task 0:

```powershell
function Commit-Plan3Task {
  param([string[]]$AllowedPaths, [string]$Message)
  $actual = @(git status --porcelain | ForEach-Object { $_.Substring(3) })
  $unexpected = @($actual | Where-Object { $_ -notin $AllowedPaths })
  if ($unexpected.Count -gt 0) {
    throw "plan3_unexpected_task_paths: $($unexpected -join ', ')"
  }
  git add -- $AllowedPaths
  if ($LASTEXITCODE -ne 0) { throw "plan3_stage_failed" }
  git diff --cached --check
  if ($LASTEXITCODE -ne 0) { throw "plan3_cached_diff_invalid" }
  $staged = @(git diff --cached --name-only)
  $unexpectedStaged = @($staged | Where-Object { $_ -notin $AllowedPaths })
  if ($unexpectedStaged.Count -gt 0) {
    throw "plan3_unexpected_staged_paths: $($unexpectedStaged -join ', ')"
  }
  git commit -m $Message
  if ($LASTEXITCODE -ne 0) { throw "plan3_commit_failed" }
  if ((git status --porcelain).Count -ne 0) { throw "plan3_worktree_not_clean" }
}
```

---

## Task 0 — freeze dynamic base and prove isolated prerequisites

**Files:** none. Read-only except worktree/branch metadata and disposable test DB.

- [ ] Capture and validate the approved plan-only ancestry:

```powershell
$repo = 'C:\Users\User\OneDrive\Desktop\smartcontract'
$worktree = 'C:\Users\User\OneDrive\Desktop\smartcontract-remediation-runtime-delivery'
$planning = '83f0cb967f61b814896e5d1a4cf01cecb1c56b59'
$env:PLAN3_BASE_SHA = (git -C $repo rev-parse master).Trim()
if ($env:PLAN3_BASE_SHA -notmatch '^[0-9a-f]{40}$') { throw 'plan3_base_sha_invalid' }
git -C $repo cat-file -e "$($env:PLAN3_BASE_SHA):docs/superpowers/plans/2026-07-15-remediation-runtime-and-delivery.md"
if ($LASTEXITCODE -ne 0) { throw 'approved_plan_missing_from_base' }
$changed = @(git -C $repo diff --name-only "$planning..$env:PLAN3_BASE_SHA")
$allowed = @('docs/superpowers/plans/2026-07-15-remediation-runtime-and-delivery.md')
if (@($changed | Where-Object { $_ -notin $allowed }).Count -ne 0 -or
    @($allowed | Where-Object { $_ -notin $changed }).Count -ne 0) {
  throw "plan3_unapproved_base_delta: $($changed -join ', ')"
}
```

Expected: one plan-only path between planning SHA and dynamic base. Any other
path is a hard stop.

- [ ] Record the main-workspace dirty/stash inventory without changing it:

```powershell
git -C $repo status --short
git -C $repo stash list
```

- [ ] Create the isolated worktree and immutable branch config:

```powershell
git -C $repo worktree add -b codex/remediation-runtime-delivery $worktree $env:PLAN3_BASE_SHA
git -C $worktree config branch.codex/remediation-runtime-delivery.plan3BaseSha $env:PLAN3_BASE_SHA
git -C $worktree config branch.codex/remediation-runtime-delivery.plan3PlanningMasterSha $planning
if ((git -C $worktree status --porcelain).Count -ne 0) { throw 'plan3_worktree_dirty' }
```

- [ ] Point tests at the disposable DB only:

```powershell
$env:PLAN3_TEST_DATABASE_URL = 'postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan3'
$env:TEST_DATABASE_URL = $env:PLAN3_TEST_DATABASE_URL
$env:DATABASE_URL = $env:PLAN3_TEST_DATABASE_URL
$env:REQUIRE_PLAN3_POSTGRES = '1'
```

Provision `tron_watch_plan3` if absent. Never reuse production URL. Verify the
resolved database name equals exactly `tron_watch_plan3` before migration or
cleanup.

- [ ] Verify existing schema 032 and baseline suites:

```powershell
Set-Location $worktree
npx tsx scripts/migrate.ts
npx vitest run --configLoader bundle `
  tests/storage/migration032.postgres.test.ts `
  tests/runtime/startupSchemaGate.test.ts `
  tests/storage/forensicCheckJobs.test.ts `
  tests/forensics/deepForensicJob.test.ts `
  tests/forensics/incomingDepositJob.test.ts `
  tests/wallet/dashboard.test.ts `
  tests/bot/createBot.test.ts
npm run typecheck
```

Expected: existing baseline GREEN; PostgreSQL tests execute, not skip. This is
regression baseline only and does not prove AC-14…18.

- [ ] Spec review: confirm exact ownership, plan-only ancestry and production
  boundary.
- [ ] Code-quality/safety review: confirm isolated worktree, disposable DB and
  untouched user stashes/files.

No commit.

## Task 1 — add the complete ID-linked RED acceptance batch

**Create:** all eight new acceptance files and runtime fixture listed in section
4. **Production files:** none.

- [ ] Add every exact test in sections 7–10. Future production modules are
  loaded with dynamic `import()` inside tests so Vitest discovers all test names
  before expected failures.
- [ ] PostgreSQL acceptance is mandatory in this first batch. It creates a
  unique schema, runs its cases, and drops that schema in `finally`; it throws
  instead of skipping when `REQUIRE_PLAN3_POSTGRES=1`.
- [ ] `strandedParentRecovery.acceptance` uses the same disposable PostgreSQL
  harness and inserts the exact generated wait-row counts (163, 104, 216), not
  an in-memory count stub.
- [ ] Run RED:

```powershell
$env:REQUIRE_PLAN3_POSTGRES = '1'
$env:TEST_DATABASE_URL = $env:PLAN3_TEST_DATABASE_URL
npx vitest run --configLoader bundle `
  tests/runtime/waitReconciliation.acceptance.test.ts `
  tests/runtime/strandedParentRecovery.acceptance.test.ts `
  tests/runtime/telegramDelivery.acceptance.test.ts `
  tests/runtime/walletNavigation.acceptance.test.ts `
  tests/runtime/checkCallbacks.acceptance.test.ts `
  tests/runtime/allowanceRefresh.acceptance.test.ts `
  tests/runtime/runtimeSchemaGateIntegration.acceptance.test.ts `
  tests/storage/runtimeDelivery.postgres.test.ts
```

Expected RED:

- AC-14/15: no global full-wait-set reconciler or atomic parent transition;
- AC-14 stranded-parent: no startup orchestration that recovers the sanitized
  TDEA/TYD all-ready shapes through completion and one durable Telegram send;
- AC-16: no persisted delivery envelope/claim/sent fence and completion lacks
  running-status CAS; no active lease recovery, atomic Incoming effect or
  bounded stale-intent preparation failure lifecycle;
- AC-17: stale/no-cache dashboard still enters live provider path;
- AC-18: `/check` and direct check callback await slow work;
- REQ-19: no bounded due allowance refresh worker;
- REQ-38: no contradictory-wait diagnostic and no Plan 3 worker gate test;
- REQ-03/36: completed Deep second-layer refresh still mutates `result_json`.

Old GREEN tests are explicitly not accepted as evidence for these IDs.

- [ ] Commit only RED tests/fixture:

```powershell
Commit-Plan3Task -AllowedPaths @(
  'tests/fixtures/runtime/remediationRuntimeCases.ts',
  'tests/runtime/waitReconciliation.acceptance.test.ts',
  'tests/runtime/strandedParentRecovery.acceptance.test.ts',
  'tests/runtime/telegramDelivery.acceptance.test.ts',
  'tests/runtime/walletNavigation.acceptance.test.ts',
  'tests/runtime/checkCallbacks.acceptance.test.ts',
  'tests/runtime/allowanceRefresh.acceptance.test.ts',
  'tests/runtime/runtimeSchemaGateIntegration.acceptance.test.ts',
  'tests/storage/runtimeDelivery.postgres.test.ts'
) -Message 'test: define runtime and delivery remediation acceptance'
```

- [ ] Spec review: every Plan 3 AC and secondary REQ has a concrete RED test.
- [ ] Code-quality review: deterministic clocks, unresolved promises, concurrent
  PG claims, cleanup and no production imports at module load.

## Task 2 — implement typed runtime contracts and pure transitions

**Create:** `src/forensics/waitReconciliation.ts`,
`src/forensics/telegramDelivery.ts`.

**Modify:** `src/types.ts`, `src/forensics/forensicJobProgress.ts`,
`tests/forensics/forensicJobProgress.test.ts`.

- [ ] Add canonical types/envelope without redefining Plans 1–2 result types.
- [ ] Add strict validators for count integers, delivery status/timestamps,
  fingerprint, payload, effect binding, claim token/attempt, 40-second lease and
  stale-intent preparation status/attempt/backoff/error invariants.
- [ ] Implement pure wait decision table from 3.2.
- [ ] Implement canonical recursive JSON serialization, SHA-256 fingerprint,
  pending state, due/backoff/lease calculation, claim/reclaim/success/failure
  transitions, expired-attempt-4 exhaustion and bounded Telegram error
  classification. Add validator/fingerprint binding for
  `DeepSecondLayerContextV1` without reading it as part of forensic result.
- [ ] Preserve unknown legacy progress fields unchanged; legacy jobs do not get
  a synthesized delivery state during read.
- [ ] Run GREEN for pure contracts:

```powershell
npx vitest run --configLoader bundle `
  tests/forensics/forensicJobProgress.test.ts `
  tests/runtime/waitReconciliation.acceptance.test.ts `
  tests/runtime/telegramDelivery.acceptance.test.ts
```

Expected: pure decision/validator/fingerprint cases GREEN; repository/worker
cases remain expected RED.

- [ ] Commit exactly:

```powershell
Commit-Plan3Task -AllowedPaths @(
  'src/forensics/waitReconciliation.ts',
  'src/forensics/telegramDelivery.ts',
  'src/types.ts',
  'src/forensics/forensicJobProgress.ts',
  'tests/forensics/forensicJobProgress.test.ts'
) -Message 'feat: define runtime reconciliation and delivery contracts'
```
- [ ] Spec review: canonical field names and every invariant in 3.1–3.3.
- [ ] Code-quality review: no `any` trust-boundary bypass, no dependency, stable
  canonicalization, bounded strings and exhaustive states.

## Task 3 — implement durable PostgreSQL wait reconciliation

**Modify:** `src/storage/repositories.ts`,
`tests/storage/forensicCheckJobs.test.ts`.

- [ ] Change `markWaitingForensicJobsReadyAfterTargetedIndex` so it owns durable
  wait-row status/progress only; parent phase is owned by reconciler.
- [ ] Add `reconcileWaitingForensicCheckJobs(db, { now, limit })` as one bounded
  PostgreSQL transaction/CTE over queued Where/Incoming parents.
- [ ] Left-join waits so missing rows become a diagnostic; aggregate all four
  statuses before deciding.
- [ ] CAS requires the same queued status and waiting phase at update time.
  Store a versioned `waitReconciliation` diagnostic/count snapshot in progress.
- [ ] Keep running/final parents untouched. Repeated calls return no second
  resume transition.
- [ ] Prove PG races: two concurrent reconcilers produce one transition; one
  subsequent `claimNextForensicCheckJob` wins; the second claim returns null.
- [ ] Run:

```powershell
$env:REQUIRE_PLAN3_POSTGRES = '1'
$env:TEST_DATABASE_URL = $env:PLAN3_TEST_DATABASE_URL
npx vitest run --configLoader bundle `
  tests/runtime/waitReconciliation.acceptance.test.ts `
  tests/storage/runtimeDelivery.postgres.test.ts `
  tests/storage/forensicCheckJobs.test.ts
```

Expected: AC-14/15 storage cases and contradictory/waiting guards GREEN.

- [ ] Commit exactly:

```powershell
Commit-Plan3Task -AllowedPaths @(
  'src/storage/repositories.ts',
  'tests/storage/forensicCheckJobs.test.ts'
) -Message 'feat: reconcile forensic wait sets atomically'
```
- [ ] Spec review: all-ready, mixed ready-terminal, waiting, cancelled, missing,
  running and repeated-call semantics.
- [ ] Code-quality review: `SKIP LOCKED`/CAS correctness, bounded batch, indexes,
  no dynamic SQL and exact JSON updates.

## Task 4 — wire reconciler at every required runtime boundary

**Create:** `src/runtime/forensicRuntimeOrchestration.ts`.

**Modify:** `src/forensics/addressIndexWorker.ts`, `src/index.ts`,
`tests/forensics/addressIndexWorker.test.ts`,
`tests/runtime/startupSchemaGate.test.ts`.

- [ ] Run reconciliation once after verified schema 032 and before Telegram or
  any Plan 3 worker is allowed to start.
- [ ] Run it before each Where poll and before each Incoming poll.
- [ ] After targeted-index completion, update wait row then invoke reconciler;
  a single completed sibling cannot wake a parent with another waiting sibling.
- [ ] Keep Deep strict-provenance readiness behavior unchanged.
- [ ] Log only outcome/count/diagnostic/job id; no wallet/chat/token payload.
- [ ] Do not add `StartupWorkLabel`; use existing Where/Incoming/address-index
  cadence and non-overlap so Address Poisoning scheduler code/tests stay untouched.
- [ ] Expose the production startup ordering through the small orchestration
  module so the Task 1 sanitized fixtures can execute the real sequence instead
  of duplicating it in a test. Fixtures generate exactly these all-ready sets:
  `TDEA 163/163`, repeated-start `TDEA 104/104`, and `TYD 216/216`; no real
  address, transaction, chat or production row is embedded. The acceptance
  inserts every generated wait row into disposable PostgreSQL.
- [ ] Run:

```powershell
npx vitest run --configLoader bundle `
  tests/runtime/waitReconciliation.acceptance.test.ts `
  tests/runtime/runtimeSchemaGateIntegration.acceptance.test.ts `
  tests/forensics/addressIndexWorker.test.ts `
  tests/forensics/deepForensicJob.test.ts `
  tests/forensics/incomingDepositJob.test.ts
```

Expected: orchestration AC-14/15 and schema gate GREEN.

- [ ] Commit exactly:

```powershell
Commit-Plan3Task -AllowedPaths @(
  'src/runtime/forensicRuntimeOrchestration.ts',
  'src/forensics/addressIndexWorker.ts',
  'src/index.ts',
  'tests/forensics/addressIndexWorker.test.ts',
  'tests/runtime/startupSchemaGate.test.ts'
) -Message 'fix: reconcile waiting jobs across runtime cycles'
```
- [ ] Spec review: startup, pre-poll and post-index hooks all present; sanitized
  TDEA/TYD shapes use production orchestration rather than a test-only shortcut.
- [ ] Code-quality review: no overlapping cycles, no premature parent wake and
  no Address Poisoning/shared-label change.

## Task 5 — add completion CAS and durable delivery repository operations

**Modify:** `src/storage/repositories.ts`,
`tests/storage/forensicCheckJobs.test.ts`.

- [ ] Make `completeForensicCheckJob` CAS only from `status='running'`.
- [ ] Persist result and optional pending envelope in the same update. Jobs with
  `chat_id=null` may complete without delivery; jobs with a payload must contain
  a validated fingerprint/state.
- [ ] Add bounded `claimNextForensicTelegramDelivery` over completed/partial/
  failed jobs with pending, due retryable or expired in-flight state.
- [ ] Claim atomically increments attempt, creates a random claim token and
  40-second lease, and returns exact payload/fingerprint/attempt/token. Before
  lease expiry concurrent claimers get nothing. Expired attempts 1–3 can be
  reclaimed; expired attempt 4 is atomically failed as
  `telegram_attempts_exhausted` with its Incoming effect in the same transaction,
  without returning payload or creating attempt 5.
- [ ] Add success and failure settlement CAS by
  id/fingerprint/attempt/claim-token. Superseded-token settlement is a no-op.
  Explicit retryable failure clears claim and applies the attempt backoff.
- [ ] Implement `settleForensicTelegramDelivery` with one pinned PostgreSQL
  client and transaction. For `incoming_user_alert`, success updates delivery
  to sent and its `observed_transactions.user_alert_status` to sent in the same
  transaction; permanent failure updates both to failed. A missing/CAS-failed
  effect row or any second-operation error rolls the delivery update back.
  Retryable settlement changes only delivery and leaves the current alert
  `sending`/`analyzing` state unchanged.
- [ ] Update `claimUserAlertsForRetry` so a row already owned by a terminal
  Incoming job's versioned delivery effect is not reclaimed for analysis,
  regardless of delivery status. Rows without that exact effect keep legacy
  retry behavior.
- [ ] Terminal branch `recoverStaleForensicCheckJobs` atomically stores a
  versioned `stale_failure` delivery intent when `chat_id` exists. Add an
  idempotent CAS that replaces only that exact unresolved intent with a pending
  envelope; never infer intents for historical final jobs.
- [ ] Add bounded stale-intent preparation failure settlement by exact
  job/intent/attempt. Attempts 1–3 persist retryable backoff `30/120/600s`;
  attempt 4 persists terminal `stale_intent_preparation_attempts_exhausted`.
  Terminal intents are never selected again and never create delivery.
- [ ] Never update `result_json`, score, coverage, evidence ids or forensic
  status from claim/settle functions.
- [ ] Add PG assertions for false completion CAS, concurrent claim, active lease,
  crashed-attempt reclaim, attempt-4 exhaustion, sent fence, superseded-token
  settlement and parsed-JSON-equivalent result preservation. Inject a temporary
  PostgreSQL trigger that raises on the Incoming alert update; assert that both
  delivery and alert remain unchanged after rollback, then remove the trigger
  in `finally`.
- [ ] Run:

```powershell
$env:REQUIRE_PLAN3_POSTGRES = '1'
$env:TEST_DATABASE_URL = $env:PLAN3_TEST_DATABASE_URL
npx vitest run --configLoader bundle `
  tests/runtime/telegramDelivery.acceptance.test.ts `
  tests/storage/runtimeDelivery.postgres.test.ts `
  tests/storage/forensicCheckJobs.test.ts
```

Expected: AC-16 repository/CAS cases GREEN, including atomic Incoming rollback
and bounded/terminal stale-intent preparation settlement; worker send cases
remain RED.

- [ ] Commit exactly:

```powershell
Commit-Plan3Task -AllowedPaths @(
  'src/storage/repositories.ts',
  'tests/storage/forensicCheckJobs.test.ts'
) -Message 'feat: persist and claim forensic telegram delivery'
```
- [ ] Spec review: CON-07/result immutability, false-CAS no-send fence, lease
  recovery and atomic Incoming effect settlement.
- [ ] Code-quality review: JSONB transitions, concurrency, backoff timestamps,
  transaction rollback, claim-token entropy, sanitized codes and no outbox
  table/migration.

## Task 6 — make Where, Deep and Incoming result-first producers

**Modify:** `src/forensics/deepForensicJob.ts`,
`src/forensics/deepSecondLayerRefresh.ts`,
`src/forensics/incomingDepositJob.ts`, `src/storage/repositories.ts`, `src/index.ts`,
`tests/forensics/deepForensicJob.test.ts`,
`tests/forensics/deepSecondLayerRefresh.test.ts`,
`tests/forensics/incomingDepositJob.test.ts`,
`tests/storage/forensicCheckJobs.test.ts`.

- [ ] Replace direct/best-effort send deps with pure payload builders using the
  existing formatters unchanged.
- [ ] For Where and Deep: build payload, attach pending envelope, win completion
  CAS, then run only non-delivery best-effort indexing. Remove post-completion
  direct send.
- [ ] For failure paths: save failed forensic result plus pending failure-message
  delivery; a lost completion CAS creates no delivery.
- [ ] Remove `sendForensicJobFailure` direct Telegram calls from stale recovery.
  Recovery leaves only its durable intent; no best-effort send remains.
- [ ] For Incoming: remove send-before-complete. Persist result and
  `incoming_user_alert` effect first. Do not let Telegram failure mark forensic
  job failed or change risk.
- [ ] Bind each payload to the exact job kind/subject/chat/locale. Do not use a
  Where payload as Deep fallback or vice versa.
- [ ] Keep saved CoverageV2, ScoreAnchorV2 and result JSON exactly unchanged
  across delivery retries.
- [ ] Remove the post-completion `result_json` patch from
  `deepSecondLayerRefresh`. Replace it with a repository CAS that writes only
  validated `progress_json.deepSecondLayerContext`, bound to the SHA-256
  fingerprint of the immutable base result. Pending-selection reads the latest
  context profile first and falls back to the base result only for legacy jobs.
- [ ] A later context refresh may replace only the versioned context. It must not
  rescore, rebuild Telegram payload, change delivery fingerprint, update the
  completed result, or trigger another send. Existing base-result consumers
  remain compatible; presenting the separate context differently belongs to
  Plan 4.
- [ ] Run:

```powershell
$env:REQUIRE_PLAN3_POSTGRES = '1'
$env:TEST_DATABASE_URL = $env:PLAN3_TEST_DATABASE_URL
npx vitest run --configLoader bundle `
  tests/runtime/telegramDelivery.acceptance.test.ts `
  tests/forensics/deepForensicJob.test.ts `
  tests/forensics/deepSecondLayerRefresh.test.ts `
  tests/forensics/incomingDepositJob.test.ts `
  tests/forensics/forensicJobProgress.test.ts `
  tests/storage/runtimeDelivery.postgres.test.ts `
  tests/storage/forensicCheckJobs.test.ts
```

Expected: result-first, mode-binding and completed-result immutability cases
GREEN; second-layer refresh changes only versioned context, and no bot API call
occurs in a job runner.

- [ ] Commit exactly:

```powershell
Commit-Plan3Task -AllowedPaths @(
  'src/forensics/deepForensicJob.ts',
  'src/forensics/deepSecondLayerRefresh.ts',
  'src/forensics/incomingDepositJob.ts',
  'src/storage/repositories.ts',
  'src/index.ts',
  'tests/forensics/deepForensicJob.test.ts',
  'tests/forensics/deepSecondLayerRefresh.test.ts',
  'tests/forensics/incomingDepositJob.test.ts',
  'tests/storage/forensicCheckJobs.test.ts'
) -Message 'fix: keep completed forensic results immutable'
```
- [ ] Spec review: REQ-03/05/36, every success/failure/CAS branch and immutable
  completed Deep result under later second-layer refresh.
- [ ] Code-quality review: immutable result, no swallowed delivery error, no
  duplicate builder invocation, context/result fingerprint binding and no copy
  changes.

## Task 7 — implement bounded Telegram delivery worker and runtime cadence

**Create:** `src/forensics/telegramDeliveryWorker.ts`.

**Modify:** `src/runtime/forensicRuntimeOrchestration.ts`, `src/index.ts`.

- [ ] Implement one cycle: claim up to 10, send with 25-second AbortSignal,
  classify result, settle matching attempt/token and continue after one failure.
  Recovery respects the 40-second lease: no second claim before expiry, attempts
  1–3 resume after a crashed worker, expired attempt 4 terminates without send,
  and a stale worker settlement cannot overwrite the replacement claim.
- [ ] Before claiming, resolve bounded stale-recovery intents with the existing
  failure formatter and matching Where lookup, then attach the validated pending
  envelope by CAS. Process at most 10 due intents. Preparation failure settles
  the exact attempt through Task 5: attempts 1–3 retry after bounded backoff,
  attempt 4 becomes terminal failed. Continue the batch after one error and
  never send directly from preparation.
- [ ] On Incoming success/permanent failure call only the atomic repository
  settlement from Task 5. Do not call `markUserAlertSent/Failed` separately;
  retryable leaves the alert's current `sending`/`analyzing` state unchanged.
- [ ] Use a separate `createNonOverlappingStartupWork` guard but invoke it from
  existing Where runtime cadence. Schedule delivery before starting the Where
  promise and never await Where before the delivery cycle can run. A permanently
  unresolved Where promise must not block that tick's delivery. Do not add a
  startup label.
- [ ] Run one startup delivery cycle only after schema gate; await active cycle
  during graceful shutdown.
- [ ] Execute the sanitized stranded-parent acceptance through production
  orchestration for all three shapes (`TDEA 163/163`, repeated `TDEA 104/104`,
  `TYD 216/216`). For each shape assert:
  `startup → reconciliation → one forensic claim → completion → pending
  delivery → one Telegram send`; restart/repeat must not produce a second claim
  or second send for the same fingerprint.
- [ ] Preserve fingerprint/sent fence and bounded logs. Do not log payload text,
  chat id, address, Telegram response or token.
- [ ] Run:

```powershell
$env:REQUIRE_PLAN3_POSTGRES = '1'
$env:TEST_DATABASE_URL = $env:PLAN3_TEST_DATABASE_URL
npx vitest run --configLoader bundle `
  tests/runtime/telegramDelivery.acceptance.test.ts `
  tests/runtime/strandedParentRecovery.acceptance.test.ts `
  tests/runtime/runtimeSchemaGateIntegration.acceptance.test.ts `
  tests/storage/runtimeDelivery.postgres.test.ts
```

Expected: all AC-16 tests GREEN, including lease/crash recovery, retry then
success, no resend after sent, atomic Incoming effect, unresolved-Where cadence,
the three stranded-parent chains, terminal stale-intent preparation and
immutable forensic result.

- [ ] Commit exactly:

```powershell
Commit-Plan3Task -AllowedPaths @(
  'src/forensics/telegramDeliveryWorker.ts',
  'src/runtime/forensicRuntimeOrchestration.ts',
  'src/index.ts'
) -Message 'feat: deliver forensic telegram results durably'
```
- [ ] Spec review: attempts/lease/backoff/timeout/atomic effect/sent semantics,
  real stranded-parent sequence and delivery-before-Where ordering.
- [ ] Code-quality review: AbortSignal handling, non-overlap, shutdown, error
  redaction and honest at-least-once boundary.

## Task 8 — add bounded background allowance refresh

**Create:** `src/approvals/allowanceRefreshWorker.ts`.

**Modify:** `src/approvals/allowanceRefresh.ts`,
`src/storage/repositories.ts`, `src/index.ts`,
`tests/approvals/allowanceState.test.ts`,
`tests/approvals/approvalWorker.test.ts`,
`tests/storage/repositories.test.ts`.

- [ ] Add due-target repository query with exact official-USDT/active-wallet/
  stale-or-expired/15-minute predicates and limit 5.
- [ ] Acquire per-target PostgreSQL session advisory lock with
  `pg_try_advisory_lock(hashtextextended($1, 0))`, re-read eligibility,
  call official allowance with 15-second timeout, save through the existing
  causal writer and always call the matching `pg_advisory_unlock` and release
  the pinned client in `finally`.
- [ ] Add `background_stale_refresh` reason. Do not change the three Plan 2
  event/finalization/explicit triggers.
- [ ] Process selected targets with a sequential `for...of` loop and concurrency
  exactly `1`; do not use `Promise.all`. The next target starts only after the
  previous provider call, advisory unlock and pinned-client release complete.
- [ ] Run cycle under existing polling cadence with its own non-overlap guard.
  A minute poll with no due row performs zero full-node calls.
- [ ] Failure remains `UNKNOWN/null`; never fall back to event `amount_raw`.
- [ ] Run:

```powershell
$env:REQUIRE_PLAN3_POSTGRES = '1'
$env:TEST_DATABASE_URL = $env:PLAN3_TEST_DATABASE_URL
npx vitest run --configLoader bundle `
  tests/runtime/allowanceRefresh.acceptance.test.ts `
  tests/approvals/allowanceState.test.ts `
  tests/approvals/approvalWorker.test.ts `
  tests/storage/runtimeDelivery.postgres.test.ts
```

Expected: due rows refresh in bounded batches; fresh/recently-attempted rows make
zero calls; concurrency and provider-failure cases GREEN.

- [ ] Commit exactly:

```powershell
Commit-Plan3Task -AllowedPaths @(
  'src/approvals/allowanceRefreshWorker.ts',
  'src/approvals/allowanceRefresh.ts',
  'src/storage/repositories.ts',
  'src/index.ts',
  'tests/approvals/allowanceState.test.ts',
  'tests/approvals/approvalWorker.test.ts',
  'tests/storage/repositories.test.ts'
) -Message 'feat: refresh stale allowance state in bounded batches'
```
- [ ] Spec review: REQ-19 current-state semantics, no 60-second per-approval
  read and exact concurrency-one target processing.
- [ ] Code-quality review: advisory-lock release, timeout, causality, active
  wallet binding and batch isolation.

## Task 9 — make wallet navigation cache-only with deduplicated refresh

**Modify:** `src/wallet/dashboard.ts`, `src/bot/createBot.ts`,
`tests/wallet/dashboard.test.ts`, `tests/bot/createBot.test.ts`,
with the Task 1 acceptance file executed read-only.

- [ ] Split cache read from live refresh. Cache-only function has no provider
  dependency and returns fresh cache, stale cache or cache miss.
- [ ] Normal wallet view/analytics/risk/safety routes use only cache result.
- [ ] Cache miss and explicit refresh immediately render a short localized
  loading state, then launch background live refresh.
- [ ] Add one in-memory `Map<walletId, Promise<...>>` coordinator inside bot
  composition. Same-wallet callers share work; other wallets are independent;
  cleanup occurs in `finally`.
- [ ] Only explicit refresh bypasses cache when a cache exists. Stale normal
  navigation does not silently schedule live work.
- [ ] Provider failure keeps stale cache; no-cache failure shows existing honest
  error state. Do not redesign result/card copy.
- [ ] Replace old tests that required stale navigation to call TronScan; preserve
  them as regression assertions for explicit refresh instead.
- [ ] Run:

```powershell
npx vitest run --configLoader bundle `
  tests/runtime/walletNavigation.acceptance.test.ts `
  tests/wallet/dashboard.test.ts `
  tests/bot/createBot.test.ts
```

Expected: AC-17 and cache-miss/dedupe tests GREEN.

- [ ] Commit exactly:

```powershell
Commit-Plan3Task -AllowedPaths @(
  'src/wallet/dashboard.ts',
  'src/bot/createBot.ts',
  'tests/wallet/dashboard.test.ts',
  'tests/bot/createBot.test.ts'
) -Message 'fix: keep wallet navigation cache first'
```
- [ ] Spec review: cache/stale/missing/explicit matrix and Plan 4 boundary.
- [ ] Code-quality review: promise cleanup, wallet-key isolation, context-safe
  background update and no hidden provider call.

## Task 10 — return check handlers before slow work completes

**Modify:** `src/bot/createBot.ts`, `tests/bot/createBot.test.ts`; the Task 1
acceptance file is executed read-only.

- [ ] Reuse `startPendingCheckInBackground` for `/check`, direct
  `check_address_value`, pending address/tx input and direct tx text path.
- [ ] Validate input and send immediate started/usage response before detaching;
  capture only the reply target needed by background work.
- [ ] Preserve the existing non-poison callback ack before DB/provider work.
  Do not enter or refactor the Address Poisoning callback branch.
- [ ] Test with an unresolved check promise: handler resolves, a later callback
  is acknowledged/handled, then the deferred result may finish.
- [ ] Background rejection sends the existing bounded failure message and cannot
  become an unhandled rejection.
- [ ] Run:

```powershell
npx vitest run --configLoader bundle `
  tests/runtime/checkCallbacks.acceptance.test.ts `
  tests/bot/createBot.test.ts
```

Expected: AC-18 and early-ack tests GREEN.

- [ ] Commit exactly:

```powershell
Commit-Plan3Task -AllowedPaths @(
  'src/bot/createBot.ts',
  'tests/bot/createBot.test.ts'
) -Message 'fix: run telegram checks outside update handlers'
```
- [ ] Spec review: every slow entry path and Address Poisoning exclusion.
- [ ] Code-quality review: context lifetime, rejection handling, no duplicate
  started/result message and no fire-and-forget leak.

## Task 11 — knowledge, compatibility, final verification and reviews

**Modify:** only the knowledge files listed in section 4; knowledge 13 remains
conditional. No production or test behavior is added here.

- [ ] Update knowledge to actual implemented candidate behavior only:

  - all-waits reconciliation ownership and diagnostics;
  - result-first delivery state, active lease/crash recovery, atomic Incoming
    effect, retry/sent fence and at-least-once timeout limit;
  - immutable completed Deep result and separate versioned second-layer context;
  - Where/Deep/Incoming mode-bound payload lifecycle;
  - bounded background allowance refresh and its 15-minute eligibility floor;
  - cache-only normal navigation, first-load/explicit background refresh;
  - nonblocking check handlers;
  - Plan 3 remains undeployed until explicit rollout;
  - `hard_safety_limit_exceeded` and page caps remain in force: a heavy address
    may have an honest no-final result, whose copy/delivery acceptance belongs to
    Plans 4/5;
  - remove resolved Plan 3 items from open problems, retain Plan 4/5 and
    Address Poisoning closeout; keep the configured hard-safety/page-cap
    limitation open until its separately approved owner changes it.

  Update `13-agent-observations.md` only if implementation reveals a genuinely
  recurring agent mistake not already recorded.

- [ ] Run focused Plan 3 acceptance with mandatory PostgreSQL:

```powershell
$env:REQUIRE_PLAN3_POSTGRES = '1'
$env:TEST_DATABASE_URL = $env:PLAN3_TEST_DATABASE_URL
npx vitest run --configLoader bundle `
  tests/runtime/waitReconciliation.acceptance.test.ts `
  tests/runtime/strandedParentRecovery.acceptance.test.ts `
  tests/runtime/telegramDelivery.acceptance.test.ts `
  tests/runtime/walletNavigation.acceptance.test.ts `
  tests/runtime/checkCallbacks.acceptance.test.ts `
  tests/runtime/allowanceRefresh.acceptance.test.ts `
  tests/runtime/runtimeSchemaGateIntegration.acceptance.test.ts `
  tests/storage/runtimeDelivery.postgres.test.ts `
  tests/storage/forensicCheckJobs.test.ts `
  tests/forensics/forensicJobProgress.test.ts `
  tests/forensics/addressIndexWorker.test.ts `
  tests/forensics/deepForensicJob.test.ts `
  tests/forensics/deepSecondLayerRefresh.test.ts `
  tests/forensics/incomingDepositJob.test.ts `
  tests/approvals/allowanceState.test.ts `
  tests/approvals/approvalWorker.test.ts `
  tests/wallet/dashboard.test.ts `
  tests/bot/createBot.test.ts
```

Expected: zero failures and PG acceptance reports executed, not skipped.

- [ ] Run typecheck and full suite:

```powershell
npm run typecheck
npm test
git diff --check $env:PLAN3_BASE_SHA..HEAD
```

- [ ] Run Address Poisoning read-only regression:

```powershell
npx vitest run --configLoader bundle `
  tests/monitor/addressPoisoning.test.ts `
  tests/monitor/addressPoisoningWorker.test.ts `
  tests/alerts/addressPoisoningAlert.test.ts
```

No poisoning file may be changed to make this command pass.

- [ ] Verify PostgreSQL cleanup:

```powershell
$env:PGPASSWORD = 'tron'
psql $env:PLAN3_TEST_DATABASE_URL -v ON_ERROR_STOP=1 -Atc `
  "select schema_name from information_schema.schemata where schema_name like 'plan3_%' order by 1"
```

Expected: no rows.

- [ ] Run exact scope audit:

```powershell
$PLAN3_BASE_SHA = (git config --get branch.codex/remediation-runtime-delivery.plan3BaseSha).Trim()
if ($PLAN3_BASE_SHA -notmatch '^[0-9a-f]{40}$') { throw 'plan3_base_sha_missing' }
git diff --name-only "$PLAN3_BASE_SHA..HEAD"
git diff --exit-code "$PLAN3_BASE_SHA..HEAD" -- `
  migrations .gitattributes scripts/migrate.ts src/storage/schemaMigrations.ts `
  src/risk src/admin src/alerts `
  src/monitor/addressPoisoning.ts src/monitor/addressPoisoningWorker.ts `
  migrations/031_address_poisoning_monitor.sql `
  tests/monitor/addressPoisoning.test.ts tests/monitor/addressPoisoningWorker.test.ts `
  tests/alerts/addressPoisoningAlert.test.ts package.json package-lock.json
$planDocs = @(git diff --name-only "$PLAN3_BASE_SHA..HEAD" -- docs/superpowers/plans)
$unexpectedPlans = @($planDocs | Where-Object {
  $_ -ne 'docs/superpowers/plans/2026-07-15-remediation-runtime-and-delivery.md'
})
if ($unexpectedPlans.Count -gt 0) { throw "plan3_created_other_plans: $($unexpectedPlans -join ', ')" }
```

Manual reviewer inspects `src/index.ts` only for schema-gated reconciler,
delivery and allowance cycle wiring; `src/bot/createBot.ts` only for transient
loading/cache/background behavior; no result copy/layout change is allowed.

- [ ] Commit knowledge exactly:

```powershell
Commit-Plan3Task -AllowedPaths @(
  'docs/knowledge/03-job-lifecycle.md',
  'docs/knowledge/05-where-is-money-and-incoming.md',
  'docs/knowledge/06-deepcheck.md',
  'docs/knowledge/08-admin-and-bot-ux.md',
  'docs/knowledge/09-current-decisions.md',
  'docs/knowledge/10-open-problems.md',
  'docs/knowledge/12-runbooks.md',
  'docs/knowledge/13-agent-observations.md'
) -Message 'docs: record runtime and delivery remediation'
```
- [ ] Whole-branch independent spec review against every matrix row.
- [ ] Whole-branch independent code-quality review.
- [ ] Report base SHA, final HEAD, ordered commits, focused/PG/typecheck/full/AP
  counts, scope diff and confirmation that production DB/runtime/Telegram were
  untouched.

## 6. Task commit/review sequence

| Task | Commit | Required reviews before next task |
|---:|---|---|
| 0 | none | spec; safety/code-quality |
| 1 | `test: define runtime and delivery remediation acceptance` | spec traceability; test-quality |
| 2 | `feat: define runtime reconciliation and delivery contracts` | contract spec; validator/code-quality |
| 3 | `feat: reconcile forensic wait sets atomically` | wait semantics; SQL/concurrency quality |
| 4 | `fix: reconcile waiting jobs across runtime cycles` | orchestration spec; non-overlap quality |
| 5 | `feat: persist and claim forensic telegram delivery` | delivery lifecycle; SQL/CAS quality |
| 6 | `fix: keep completed forensic results immutable` | mode/result/context spec; runner quality |
| 7 | `feat: deliver forensic telegram results durably` | retry/effect spec; worker quality |
| 8 | `feat: refresh stale allowance state in bounded batches` | REQ-19 spec; lock/provider quality |
| 9 | `fix: keep wallet navigation cache first` | AC-17 spec; async/dedupe quality |
| 10 | `fix: run telegram checks outside update handlers` | AC-18 spec; context/rejection quality |
| 11 | `docs: record runtime and delivery remediation` | whole-branch spec; whole-branch quality |

## 7. Exact RED/GREEN acceptance names

All tests below are new in Task 1. Existing GREEN tests are regression support
only.

### Wait reconciliation

- `[AC-14] reconciles and claims an all-ready parent exactly once`
- `[AC-14][STRANDED-PARENT] recovers TDEA 163 TDEA repeat 104 and TYD 216 through one completed delivery each`
- `[AC-15] resumes mixed ready-terminal waits through technical path`
- `[REQ-35][WAIT-GUARD] leaves a parent waiting while any sibling wait is waiting`
- `[REQ-35][WAIT-GUARD] never rewrites a running or final parent`
- `[REQ-38][WAIT-DIAGNOSTIC] leaves a missing wait set waiting with a diagnostic`
- `[REQ-38][WAIT-DIAGNOSTIC] leaves any cancelled wait set waiting with a diagnostic`

### Delivery

- `[AC-16] retries Telegram delivery without duplicating sent fingerprint`
- `[REQ-36][DELIVERY-CAS] does not enqueue or send after a lost completion CAS`
- `[REQ-36][DELIVERY-CLAIM] allows only one concurrent claimant per attempt`
- `[REQ-36][DELIVERY-LEASE] blocks a second claim before the active lease expires`
- `[REQ-36][DELIVERY-LEASE] reclaims crashed attempts one through three after lease expiry`
- `[REQ-36][DELIVERY-LEASE] fails an expired fourth claim without a fifth send`
- `[REQ-36][DELIVERY-LEASE] ignores settlement from a superseded claim token`
- `[REQ-36][DELIVERY-FAILURE] fails delivery without changing the forensic result`
- `[REQ-03][REQ-36][DELIVERY-IMMUTABLE] retries without mutating score coverage or evidence`
- `[REQ-03][REQ-36][RESULT-IMMUTABLE] stores completed Deep second-layer enrichment as versioned context without changing result or delivery fingerprint`
- `[REQ-05][REQ-36][DELIVERY-MODE] keeps Where Deep and Incoming payloads bound to their jobs`
- `[REQ-36][DELIVERY-EFFECT] marks Incoming alert sent only after Telegram success`
- `[REQ-36][DELIVERY-EFFECT] does not re-claim an Incoming alert owned by a versioned delivery`
- `[REQ-36][DELIVERY-EFFECT][POSTGRES] rolls back delivery settlement when Incoming alert update fails`
- `[REQ-36][DELIVERY-RECOVERY] turns stale recovery into durable delivery without direct send`
- `[REQ-36][DELIVERY-RECOVERY] bounds stale intent preparation failures and terminalizes the fourth attempt`
- `[REQ-36][DELIVERY-CADENCE] runs delivery while the Where promise remains unresolved`

### Navigation and callbacks

- `[AC-17] keeps normal navigation cache-only and refresh explicit`
- `[REQ-37][CACHE-MISS] shows loading and deduplicates first-load refresh`
- `[REQ-37][CACHE-STALE] serves stale cache without a provider call`
- `[AC-18] returns check callbacks before slow work completes`
- `[REQ-37][CALLBACK-ACK] acknowledges non-poison callbacks before database work`
- `[REQ-37][CHECK-ERROR] handles detached check rejection without an unhandled promise`

### Allowance and startup gate

- `[REQ-19][RUNTIME-REFRESH] refreshes only bounded due stale allowance rows`
- `[REQ-19][RUNTIME-REFRESH] skips fresh and recently attempted rows without a full-node call`
- `[REQ-19][RUNTIME-REFRESH] isolates provider failure as UNKNOWN null and continues the batch`
- `[REQ-19][RUNTIME-REFRESH] processes due targets sequentially with concurrency one`
- `[REQ-19][RUNTIME-REFRESH][POSTGRES] serializes the same owner spender with an advisory lock`
- `[REQ-38][RUNTIME-GATE] starts no reconciler delivery or allowance cycle before schema 032 verification`

## 8. Traceability matrix — REQ → task → new test

| REQ | Ownership | Task(s) | New concrete evidence |
|---|---|---:|---|
| REQ-03 | secondary | 5–7 | delivery retry immutability plus `[RESULT-IMMUTABLE]` second-layer context test |
| REQ-05 | secondary | 6 | `[REQ-05][REQ-36][DELIVERY-MODE]...` |
| REQ-19 | secondary runtime refresh | 8 | five `[REQ-19][RUNTIME-REFRESH]...` tests, including concurrency-one and PostgreSQL lock cases |
| REQ-35 | primary | 2–4, 7 | AC-14, sanitized stranded-parent chain, AC-15 and both `[REQ-35][WAIT-GUARD]...` tests |
| REQ-36 | primary | 2, 5–7 | AC-16; claim lease/crash/token; atomic effect rollback; bounded/terminal stale-intent preparation; result/second-layer immutability; mode/recovery/cadence tests |
| REQ-37 | primary | 9–10 | AC-17, AC-18, cache miss/stale, early ack and detached-error tests |
| REQ-38 | secondary runtime fail-closed | 3–4, 7, 9 | missing/cancelled wait diagnostics and schema-gated Plan 3 cycles; cache-miss test |

## 9. Traceability matrix — AC → task → new ID-linked test

| AC | Task(s) | New test file | Exact new test name |
|---|---:|---|---|
| AC-14 | 1, 3, 4, 7 | `tests/runtime/waitReconciliation.acceptance.test.ts`; `tests/runtime/strandedParentRecovery.acceptance.test.ts`; `tests/storage/runtimeDelivery.postgres.test.ts` | generic all-ready test plus `[AC-14][STRANDED-PARENT] recovers TDEA 163 TDEA repeat 104 and TYD 216 through one completed delivery each` |
| AC-15 | 1, 3, 4 | same | `[AC-15] resumes mixed ready-terminal waits through technical path` |
| AC-16 | 1, 2, 5–7 | `tests/runtime/telegramDelivery.acceptance.test.ts`; `tests/runtime/strandedParentRecovery.acceptance.test.ts`; `tests/storage/runtimeDelivery.postgres.test.ts` | AC-16 retry/sent test plus lease crash-recovery, atomic Incoming effect and delivery cadence tests |
| AC-17 | 1, 9 | `tests/runtime/walletNavigation.acceptance.test.ts` | `[AC-17] keeps normal navigation cache-only and refresh explicit` |
| AC-18 | 1, 10 | `tests/runtime/checkCallbacks.acceptance.test.ts` | `[AC-18] returns check callbacks before slow work completes` |

## 10. PostgreSQL acceptance contract

Combined PostgreSQL acceptance in
`tests/storage/runtimeDelivery.postgres.test.ts` and
`tests/runtime/strandedParentRecovery.acceptance.test.ts` обязательно проверяет:

1. all-ready parent transitions once and claims once;
2. ready+terminal becomes `provider_limited`;
3. waiting/cancelled/missing/running parent guards;
4. sanitized TDEA 163, repeated TDEA 104 and TYD 216 durable wait-row sets each
   pass the real startup-to-one-delivery chain;
5. false completion CAS from non-running status;
6. completion atomically stores immutable result and pending delivery;
7. two concurrent delivery claimers produce one attempt and one claim token;
8. active lease prevents a second claim before its exact expiry;
9. crashed attempts 1–3 become reclaimable only after lease expiry;
10. expired attempt 4 becomes failed with no payload and no attempt 5;
11. settlement with a superseded token cannot overwrite the current claim;
12. retry backoff and sent fingerprint fence;
13. success/permanent-failure Incoming settlement updates forensic delivery and
    alert state in one transaction;
14. a temporary trigger failure on the Incoming alert update rolls back both
    alert and delivery changes; the trigger is dropped in `finally`;
15. legacy Incoming retry claim excludes rows owned by any terminal versioned
    delivery effect, while unrelated failed alerts remain claimable;
16. delivery state mutations leave `result_json`, status, score, coverage and
    evidence arrays equivalent as parsed JSON;
17. saving a Deep second-layer context changes only its versioned progress
    field; completed result and delivery fingerprint remain equivalent as parsed
    JSON/string respectively;
18. stale-recovery CAS stores only the exact versioned intent, and intent-to-
    pending CAS is idempotent without historical backfill;
19. stale-intent preparation attempts 1–3 persist exact backoff, attempt 4 is
    terminal, stale attempt settlement is ignored and terminal intent is never
    selected or sent;
20. due allowance query respects official token, active wallet, stale/expired
    state, 15-minute floor and limit 5;
21. same allowance target cannot run concurrently under advisory lock;
22. every test schema, trigger and advisory lock is released in `finally`.

No migration is created. Existing schema 032 is a prerequisite and is verified
before these tests.

## 11. Rollback

Before local merge, discard only with explicit approval:

```powershell
git -C 'C:\Users\User\OneDrive\Desktop\smartcontract' worktree remove `
  'C:\Users\User\OneDrive\Desktop\smartcontract-remediation-runtime-delivery'
git -C 'C:\Users\User\OneDrive\Desktop\smartcontract' branch -D `
  codex/remediation-runtime-delivery
```

After a future local merge but before production rollout, revert Plan 3 commits in reverse
order. Do not reset user files, drop schema 032 or rewrite migration receipts.
Candidate `tron_watch_plan3` may be dropped only after exact database-name
verification. Since production is not updated in Plan 3, no production rollback
operation belongs here.

After production rollout, rollback is owned by operations. It must preserve schema 032,
never turn `sent` delivery back to pending and keep immutable forensic results.

## 12. Self-review checklist

- [x] Primary ownership is exactly REQ-35…37 runtime and AC-14…18.
- [x] Secondary REQ-03/05/19/38 integration is explicit and does not redefine
  data/scoring/UX semantics.
- [x] Every owned AC maps to a new exact `[AC-XX]` test.
- [x] Task 1 is tests/fixtures only, produces expected RED and includes mandatory
  PostgreSQL execution.
- [x] Old GREEN tests are marked regression-only.
- [x] Full wait-set rules cover ready, terminal, waiting, cancelled, missing,
  running and repeated reconciliation.
- [x] Completion CAS precedes delivery; false CAS cannot send.
- [x] Delivery state is in existing progress JSON; no outbox table/migration.
- [x] Fingerprint, attempts, 40-second lease, crash reclaim, attempt-4 terminal
  behavior, backoff, timeout, sent fence, token-bound stale settlement and
  at-least-once network limit are explicit.
- [x] Incoming success/permanent-failure settles delivery and alert atomically;
  injected PostgreSQL failure proves both-or-neither rollback.
- [x] Stale forensic recovery stores an exact versioned intent and no longer
  sends directly or backfills historical final jobs.
- [x] Stale intent preparation is batch-bounded, retries only attempts 1–3 and
  terminalizes attempt 4 with a dedicated new RED/PostgreSQL assertion.
- [x] Delivery retry cannot mutate result/score/coverage/evidence.
- [x] Completed Deep second-layer refresh stores versioned context and cannot
  mutate result or delivery fingerprint.
- [x] Sanitized TDEA 163, repeat 104 and TYD 216 fixtures exercise startup
  through reconciliation, one forensic claim, completion, pending delivery and
  one Telegram send.
- [x] Delivery is scheduled before/independently of Where; an unresolved Where
  promise has a dedicated acceptance test.
- [x] Background allowance refresh is bounded, lock-protected and cannot call
  every approval each 60-second poll.
- [x] Allowance targets are sequential with concurrency exactly one.
- [x] Allowance failures remain UNKNOWN/null and causality stays Plan 2-owned.
- [x] Normal navigation is cache-only; only explicit refresh or first miss is
  live and same-wallet refresh is deduplicated.
- [x] Check callbacks return before slow work and Address Poisoning callbacks are
  untouched.
- [x] New scheduler label/dependency is unnecessary and excluded.
- [x] `hard_safety_limit_exceeded` and bounded page caps are explicitly not
  changed; no unbounded completion promise is made.
- [x] Exact files, RED/GREEN commands, PostgreSQL checks, rollback, knowledge and
  scope audits are present.
- [x] Every task has one bounded commit plus separate spec/code-quality reviews.
- [x] Production DB/runtime/Telegram and `/version` stay unchanged until explicit rollout.
- [x] Later plans are not created.
- [x] Address Poisoning is forbidden scope and only its existing regressions run
  read-only.

## 13. Approval checkpoint

До явного утверждения пользователя:

- не коммитить этот документ;
- не создавать worktree/branch Plan 3;
- не добавлять RED tests;
- не менять code, DB, runtime или Telegram;
- не создавать Plans 4–5;
- не трогать Address Poisoning.

После утверждения сначала коммитится только этот plan document отдельным
commit. Затем Task 0 динамически фиксирует base и implementation может начаться
только по отдельному указанию пользователя.
