---
status: draft
audit_type: knowledge_deep_audit
scope: job lifecycle walkthrough
created: 2026-07-04
---

# Job Lifecycle Walkthrough

## What This Area Does

Этот раздел объясняет, как forensic checks живут во времени: создаются,
попадают в очередь, claim-ятся worker-ами, обновляют progress, ждут background
indexing, возобновляются, завершаются или уходят в technical terminal state.

Это слой между product modes и data indexing.

Product mode отвечает на вопрос "что проверяем". Job lifecycle отвечает на
вопрос "в каком состоянии сейчас работа и что система должна сделать дальше".

Здесь важно не путать:

- parent forensic job;
- background address index task;
- progress phase;
- final job status;
- technical no-score state;
- stale recovery.

Один пользовательский check может внутри породить background indexing work.
Это не второй продуктовый режим. Это техническая декомпозиция одной длинной
проверки.

## Why It Exists

Forensic checks могут быть долгими.

`Where is money` может упереться в непокрытую targeted history по hop address.
`DeepCheck` может требовать all-time index или queued second-layer work.
`Incoming deposit` должен не только построить report, но и аккуратно записать
risk snapshot и отправить alert.

Если все это делать одним blocking call без жизненного цикла, система быстро
получает плохие состояния:

- пользователь не понимает, идет ли работа;
- worker держит долгий process без понятного heartbeat;
- old `running` jobs остаются навсегда;
- technical coverage stop выглядит как risk verdict;
- Telegram может отправить duplicate alert after retry;
- Admin видит `QUEUED`, хотя job на самом деле ждет targeted index.

Job lifecycle нужен, чтобы система могла честно сказать:

```text
Работа еще идет.
Работа ждет индекс.
Работа завершилась.
Работа не может дать финальный score из-за technical coverage block.
Работа stale и ее можно безопасно retry/fail по правилам.
```

## Main User/Product Question

Главный вопрос раздела:

```text
Где сейчас проверка, можно ли ей доверять, и что должно случиться дальше?
```

Для пользователя это выглядит проще:

- проверка стартовала;
- проверка еще индексирует историю;
- проверка завершилась;
- проверка не может выдать финальный score из-за технического покрытия.

Для аналитика в Admin это должно быть подробнее:

- какой job kind;
- какой repository status;
- какой `jobPhase`;
- какой target history address ждем;
- есть ли active lock/heartbeat;
- сколько страниц/трансферов уже fetched;
- будет retry или terminal technical state;
- это fresh job или old cached/stale evidence.

## End-To-End Flow

### 1. Job Creation

Queueable forensic jobs создаются через `createOrReuseForensicCheckJob`.

Обычные queueable kinds:

- `where_is_money_check`;
- `address_deep_check`;
- `incoming_deposit_check`.

Создание использует guarded upsert. Если уже есть active job с тем же kind,
subject/window/request context и, для incoming, тем же `depositTxHash`, система
может reuse existing queued/running job вместо создания duplicate.

`address_fast_check` намеренно не queueable. Fast result сохраняется отдельным
terminal record через `saveAddressFastCheckJob`. Это защищает fast snapshot от
смешивания с long-running forensic lifecycle.

### 2. Background Schedule

Background work стартует из `src/index.ts` через startup schedule.

Schedule labels:

- `poll`;
- `where_forensic`;
- `incoming_deposit`;
- `deep_forensic`;
- `address_index`.

Это важно: forensic workers запускаются независимо от Telegram bot startup.
Admin может быть доступен, Telegram может стартовать позже, а queued forensic
jobs все равно должны обрабатываться scheduled workers.

Каждый poller guarded by active promise. Если предыдущий cycle еще идет,
следующий не запускает duplicate concurrent cycle для того же worker type.

`runForensicJobBatch` делает простую вещь: вызывает `runSingleCycle` до
`maxJobs` раз и останавливается, когда queue empty.

### 3. Claiming Jobs

Worker claim берет только jobs со `status='queued'`.

Claim явно исключает:

- `address_fast_check`;
- jobs with `progress_json->>'jobPhase' = 'waiting_for_targeted_index'`;
- kinds outside requested worker kind filter.

Claim переводит job в `running`, ставит `started_at`, и worker начинает
обновлять `progressJson`.

Здесь важный subtle point: `waiting_for_targeted_index` технически хранится как
`status='queued'`, но это не обычная очередь. Обычный claim его пропускает,
пока address index worker не переведет progress phase в `reading_local_index`
или `provider_limited`.

### 4. Progress Phases

Runtime progress живет в `progressJson`.

Основные phases:

- `queued`;
- `claimed`;
- `address_deep_trace`;
- `money_origin_trace`;
- `incoming_deposit_trace`;
- `risk_recording`;
- `notification_delivery`;
- `completing`;
- `waiting_for_targeted_index`;
- `checking_candidate_windows`;
- `reading_local_index`;
- `provider_limited`;
- `queued_after_stale_recovery`;
- `failed_after_stale_recovery`.

Strictly, `checking_candidate_windows` is usually a `targetedIndex.phase`
inside `jobPhase=waiting_for_targeted_index`, not a separate repository status.

`mergeForensicJobProgress` добавляет `jobHeartbeatAt` при progress update.
Это дает stale recovery более точный сигнал, чем только `started_at`.

### 5. Where Parent Job Waits For Targeted Index

Ordinary `Where is money` - самый важный lifecycle path.

Когда Where trace видит required hop с непокрытой targeted history, он вызывает
`ensureTargetedHistoryOrWait`.

Coordinator проверяет:

1. Есть ли exact complete targeted state?
2. Есть ли newer same-address covering targeted state?
3. Есть ли retryable partial state?
4. Нужно ли queue/requeue `targeted` address index task?
5. Нужно ли записать `forensic_job_waits`?
6. Нужно ли release parent job в `waiting_for_targeted_index`?

Если нужно ждать, coordinator:

- пишет wait row в `forensic_job_waits`;
- patch-ит progress to `jobPhase='waiting_for_targeted_index'`;
- release-ит parent forensic job обратно в `status='queued'`;
- бросает `TargetedHistoryWaitingForIndex`.

Worker ловит этот exception и возвращает `true`: cycle handled work, но final
report еще не готов.

Это хороший дизайн: parent job освобождает worker slot, но пользовательская
проверка не теряется.

После candidate-window-first обновления у этого lifecycle появился более
тонкий subphase. Parent job все еще хранится как `queued` +
`jobPhase=waiting_for_targeted_index`, но внутри `targetedIndex.phase` может
стоять:

```text
checking_candidate_windows
```

Это означает: Where сейчас проверяет narrow candidate windows для `probable`
funding-first provenance. Broad fallback еще не обязан быть queued. Это важно
для Admin и для чтения DB: job не stuck, и broad `genesis -> targetTimestamp`
indexing может быть legitimately `not_queued`, пока candidate windows pending.

### 6. Background Index Task

Address index worker claim-ит `tron_address_usdt_index_states`, а не
`forensic_check_jobs`.

Это другая queue, другая lifecycle table и другие locks:

- state can be `queued`, `running`, `complete`, `partial`,
  `failed_retryable`, `failed_terminal`;
- worker ставит `lockOwner`, `lockedUntil`, heartbeat;
- долгий indexing run может продлевать heartbeat;
- retryable targeted partials могут requeue with larger budget;
- terminal partials wake parent job into technical terminal phase.

Так parent job и background index task остаются связаны, но не смешиваются.

Для `candidate_window` index states worker прокидывает тот же identity through
claim, run, retry, fail and wakeup:

- `requestKind`;
- `windowStartTimestamp`;
- `windowEndTimestamp`;
- `relatedHopTxHash`;
- `candidateTxHash`.

Это предотвращает неправильный wakeup: готовность одного narrow candidate
window не должна будить waits по другому candidate tx hash или broad targeted
coverage.

### 7. Resume After Index

Когда targeted index task finishes, address index worker вызывает
`markWaitingForensicJobsReadyAfterTargetedIndex`.

Если index status `complete`, parent job progress становится:

```text
jobPhase = reading_local_index
targetedIndex.phase = reading_local_index
```

Job остается `queued`, но теперь ordinary claim снова может его забрать,
потому что `jobPhase` уже не `waiting_for_targeted_index`.

Если index status terminal, parent job progress становится:

```text
jobPhase = provider_limited
targetedIndex.phase = provider_limited
targetedIndex.scoreValid = false
```

Следующий Where worker cycle видит `provider_limited` и завершает job failed
with serialized no-score fields, например:

- `score_valid=false`;
- `score_blocked_reason=provider_cap_unresolved`;
- `technical_status=provider_cap_unresolved`.

Это не risk verdict. Это technical no-final-score state.

Для `candidate_window` wakeup есть дополнительное правило: parent Where job
готов к resume только когда все candidate-window waits для этого job больше не
`waiting`. Если часть windows complete, а другая еще queued/running, parent
остается waiting. Если все candidate windows complete или terminal, Where
resume-ится and re-runs funding-first provenance. Только после этого он может
решить, нужен ли broad targeted fallback.

### 8. DeepCheck Lifecycle

`address_deep_check` claim-ится отдельным poller path.

Deep worker:

- ставит `jobPhase='address_deep_trace'`;
- при `allTimeDeepCheckMode='strict'` может вызвать `ensureAddressUsdtHistory`
  for `all_time`;
- запускает `runDeepAddressForensicCheck`;
- может queue second-layer address index requests;
- сохраняет completed result.

DeepCheck может kick address index worker opportunistically, но не должен
зависнуть в `queued` только потому, что address index worker busy.

В текущей модели Deep second-layer indexing больше похож на follow-up profile
enrichment, чем на same parent wait/resume loop. Это соответствует knowledge
docs: second-layer work still partial/planned.

### 9. Incoming Deposit Lifecycle

`incoming_deposit_check` claim-ится отдельным incoming worker.

Incoming job требует deposit-specific fields in `progressJson`:

- `depositTxHash`;
- `watchedWallet`;
- `watchedWalletId`;
- `sender`;
- `amountRaw`;
- `timestamp`;
- `telegramUserId`.

Worker phases:

1. `incoming_deposit_trace`;
2. `risk_recording`;
3. `notification_delivery`, если alert надо отправить;
4. `completing`;
5. terminal `completed` or `failed`.

Incoming специально обрабатывает timing and slow-stage warnings. Он также
пишет observed transaction risk and alert sent/failed state.

Главное отличие от Where: Incoming сейчас не использует shared parent
wait/resume lifecycle for targeted indexing. Он может получить invalid/no-score
report when targeted coverage blocked, но не release-ится как ordinary Where в
`waiting_for_targeted_index`.

### 10. Stale Recovery

`recoverStaleForensicCheckJobs` смотрит на `running` jobs.

Stale определяется по:

- `progressJson.jobHeartbeatAt`, если это валидный ISO timestamp;
- fallback to `started_at` or `created_at`, если heartbeat нет или он malformed.

Recovery rules разные для job kinds:

- route jobs `where_is_money_check` и `address_deep_check` can be requeued
  below configured max retries;
- incoming jobs can be requeued once only in pre-delivery phases
  `incoming_deposit_trace` and `risk_recording`;
- incoming jobs in `notification_delivery`, `completing`, null or unknown
  phases are delivery-sensitive and fail rather than retry blindly;
- retry-exhausted jobs fail.

Это важная product safety: лучше явно failed job, чем duplicate Telegram alert
или повторная запись side effects после непонятного состояния доставки.

### 11. Admin Progress

Admin не должен показывать waiting Where job как обычный plain `QUEUED`.

Для `where_is_money_check` with `waiting_for_targeted_index` Admin может
подмешать targeted history progress и вернуть progress graph:

- decision `UNKNOWN`;
- risk score `null`;
- limitation `waiting_for_targeted_index`;
- explanation "Waiting for targeted history, not stuck";
- targeted state counters, pages, dates, lock owner, attempts, provider flags.

Это progress-only view, не final forensic graph.

Для candidate-window phase Admin должен показывать не просто
`WAITING: TARGETED INDEX`, а более точный status:

```text
CHECKING: CANDIDATE WINDOWS
```

и отдельно broad fallback state:

```text
Broad fallback: not queued / queued / running
```

Это защищает аналитика от ложного вывода, что broad targeted history уже
активно индексируется, когда на самом деле система проверяет только narrow
candidate windows.

## Important Data Structures / States

### `forensic_check_jobs`

Основная таблица пользовательских forensic jobs.

Важные поля:

- `id`;
- `kind`;
- `subject_address`;
- `status`;
- `window_start`;
- `window_end`;
- `priority`;
- `chat_id`;
- `requested_by`;
- `progress_json`;
- `result_json`;
- `last_error`;
- `started_at`;
- `completed_at`.

Repository statuses:

- `queued`;
- `running`;
- `partial`;
- `completed`;
- `failed`;
- `cancelled`.

### `progressJson.jobPhase`

`jobPhase` уточняет runtime state внутри broad repository status.

Самый важный пример:

```text
status = queued
jobPhase = waiting_for_targeted_index
```

Это означает не "очередь свободна", а "parent job released while background
targeted indexing works".

### `forensic_job_waits`

Wait rows связывают parent job с required targeted history.

Они хранят:

- job id;
- wait type `targeted_usdt_history`;
- address;
- coverage mode `targeted`;
- target timestamp;
- request kind `broad_targeted` or `candidate_window`;
- candidate-window identity fields when request kind is `candidate_window`;
- required-for context;
- wait status `waiting`, `ready`, `terminal`, `cancelled`;
- status reason and last error.

Эта таблица позволяет same-address covering target wake up multiple parent
waits.

### `tron_address_usdt_index_states`

Background indexing queue/state.

Это не user forensic job. Это technical index task state.

Ключевые fields:

- `coverageMode`;
- `targetTimestamp`;
- `status`;
- `statusReason`;
- `budgetPages`;
- `attemptCount`;
- `maxAttempts`;
- `lockedUntil`;
- `heartbeatAt`;
- `requestedByJobId`.

### Technical Terminal Fields

Для no-final-score states используются serialized fields:

- `score_valid=false`;
- `score_blocked_reason`;
- `technical_status`.

Они должны читаться как "score blocked", not "risk accepted/declined".

## What The Knowledge Docs Claim

`docs/knowledge/03-job-lifecycle.md` говорит, что forensic jobs имеют repository
statuses `queued -> running -> partial -> completed -> failed -> cancelled`.

Knowledge docs фиксируют, что `address_fast_check` сохраняется directly as
finished job и не claim-ится worker queue.

Docs также утверждают, что background worker schedule starts independently of
Telegram bot startup. Admin can be reachable while Telegram delayed, and queued
forensic jobs should still be claimed.

Ordinary Where должен иметь Stage 1 targeted wait/resume:

- required hop lacks targeted history;
- parent job queues index task;
- parent job moves to `waiting_for_targeted_index`;
- address index worker marks ready or terminal;
- parent job resumes or finishes technical terminal.

Updated knowledge docs now add candidate-window-first lifecycle for ordinary
Where: probable funding-first candidates queue `request_kind=candidate_window`
states first, and broad `where_is_money_hop` fallback is queued only after
candidate windows are done/terminal or insufficient.

Docs отдельно говорят, что Incoming deposit jobs do not yet use this shared
resumable indexing flow.

`docs/knowledge/08-admin-and-bot-ux.md` claims Admin can show waiting targeted
history progress and should not present it as final score.

`docs/knowledge/10-open-problems.md` adds live-history context: stale locks,
targeted wait progress, old exact states, terminal provider-cap events and the
remaining gap around Incoming.

## What The Code Appears To Implement

Code inspection matches the main lifecycle claims.

Queue creation separates queueable jobs from terminal fast check records.

Claim logic skips `address_fast_check` and skips jobs whose `jobPhase` is
`waiting_for_targeted_index`.

Where targeted wait/resume is implemented through:

- `ensureTargetedHistoryOrWait`;
- `ensureCandidateWindowsOrWait`;
- `forensic_job_waits`;
- `releaseForensicCheckJobToWaiting`;
- `markWaitingForensicJobsReadyAfterTargetedIndex`;
- `TargetedHistoryWaitingForIndex` as a control-flow signal.

Address index worker is a separate worker over index states. It handles locks,
heartbeat, retryable partial requeue and parent wakeup.

Deep worker and Where worker share `runSingleDeepForensicJobCycle`, but branch
on `job.kind`. The shared file name is mildly confusing, but behavior keeps
Where and Deep semantics separate.

Incoming worker has explicit phase persistence and conservative failure/retry
behavior around alert delivery.

Stale recovery is implemented centrally and is phase-aware. It uses heartbeat
where available and fallback timestamps where necessary.

Admin graph and server code can enrich waiting Where jobs with targeted
history progress and render a progress-only graph with `UNKNOWN` decision and
`riskScore=null`.

## Confirmed Vs Not Confirmed

`docs-only`:

- product expectation that the user should still perceive one long check while
  background index tasks run internally;
- planned richer lifecycle copy for Telegram;
- planned full progress stream with selected transfers, covered hops and
  window-level details.

`code-inspected`:

- queue creation/reuse;
- claim skip for `waiting_for_targeted_index`;
- wait row creation and parent job release;
- candidate-window wait identity and all-windows-before-resume behavior;
- address index worker wakeup path;
- provider-limited no-score completion path;
- stale recovery policy;
- Incoming phase sequence and delivery-sensitive recovery;
- Admin waiting progress projection.

`test-backed`:

- focused lifecycle test run passed: 10 files, 489 tests;
- covered repository queue/wait/stale behavior, job progress parsing, batch
  loop, Where/Deep lifecycle, Incoming lifecycle, address index worker,
  targeted coordinator and Admin targeted progress projection.

`runtime-observed`:

- this section did not observe a live long-running job in Admin;
- no current DB stale jobs were inspected;
- no live Telegram progress or failure copy was tested in this section.

## Known Gaps

Incoming deposit still lacks shared wait/resume targeted indexing. It has a
good job lifecycle for trace/risk/alert delivery, but not the same parent
waits-for-background-index lifecycle as ordinary Where.

Telegram progress is still behind Admin progress. Admin can show a waiting
Where progress graph; Telegram does not yet have equivalent live progress for
long targeted indexing.

Some lifecycle semantics are encoded in `progressJson` string phases. This is
pragmatic and flexible, but it makes job state depend on conventions rather
than a strongly typed DB enum.

Completed and failed historical jobs still need careful UX separation from
fresh live runs. Admin has progress and graph counters, but knowledge docs say
old cached jobs can still confuse interpretation.

The shared file `deepForensicJob.ts` runs both Where and Deep jobs. That is
technically fine, but it hides architecture from readers.

Budget/retry decisions are still code-level constants. Lifecycle can recover
and requeue within those limits, but it cannot yet express product-level policy
per job.

## Risks / Failure Modes

Treating `queued + waiting_for_targeted_index` as a stuck queue item is wrong.
It is a deliberate waiting state.

Treating `provider_limited` as risk verdict is wrong. It is a technical
terminal state for coverage/scoring.

Retrying Incoming jobs after `notification_delivery` is dangerous. The current
code avoids blind retry there; that behavior should be preserved.

Losing heartbeat updates during long indexing can make live work look stale.
The index worker heartbeat reduces this risk, but Admin still does not show a
full per-window stream.

Old completed/failed jobs can be mistaken for fresh proof if UI does not make
run freshness clear.

Parallel trace branches can discover multiple waits. Release-to-wait must stay
idempotent so a second branch does not fail an already-waiting parent job.

## What To Keep As-Is

Keep `address_fast_check` outside the queue. It is a simple and valuable
boundary.

Keep parent forensic jobs separate from background address index tasks. This
keeps product request lifecycle distinct from technical indexing lifecycle.

Keep `waiting_for_targeted_index` as a non-claimable queued phase for ordinary
Where. It allows long indexing without blocking the forensic worker.

Keep same-address covering-target wakeup. A later targeted state can cover
earlier waits and avoids duplicate work.

Keep phase-aware stale recovery. Route jobs and Incoming alert jobs have
different retry risks.

Keep Admin progress-only graph for waiting Where jobs. `UNKNOWN` decision and
`riskScore=null` are the right semantics.

Keep technical no-score fields. They protect the product from turning coverage
failure into false risk certainty.

## Improvement Ideas

Document a single lifecycle state matrix:

| Repository status | `jobPhase` | Meaning | Claimable |
| --- | --- | --- | --- |
| `queued` | absent or normal phase | ready for worker | yes |
| `running` | trace phase | worker is active | no |
| `queued` | `waiting_for_targeted_index` | parent waits for index task | no |
| `queued` | `waiting_for_targeted_index` + `targetedIndex.phase=checking_candidate_windows` | parent waits for narrow candidate windows | no |
| `queued` | `reading_local_index` | targeted index ready, parent can resume | yes |
| `queued` | `provider_limited` | targeted index terminal, finish no-score | yes |
| `completed` | any | terminal success | no |
| `failed` | any | terminal failure/no-score | no |

Add lifecycle glossary to Admin or audit summary: parent job, index state,
wait row, heartbeat, technical terminal.

Make Telegram long-check progress more explicit. Even a compact message like
"Индексируем историю адреса X до даты Y" would reduce confusion.

Consider stronger typed representation for `jobPhase` if lifecycle grows
further. Current JSON string phases are workable, but brittle across code paths.

Add a freshness indicator for job result consumption: fresh run vs cached old
job vs stale recovered job. This belongs partly in Admin/Bot UX, but lifecycle
is where the raw signals live.

Consider renaming or documenting `deepForensicJob.ts` as shared forensic job
runner for Where and Deep.

## Questions For You

1. Согласен ли ты считать current Where wait/resume lifecycle `keep as-is` как
   правильную архитектурную форму?

2. Нужно ли в будущем выделять `waiting_for_targeted_index` в отдельный DB
   status, или текущая комбинация `status='queued' + jobPhase` достаточно
   прагматична?

3. Для Incoming: считаем ли shared wait/resume targeted indexing
   high-priority improvement после аудита, или пока оставляем как known gap?

4. Хочешь ли ты, чтобы в следующем разделе мы уже начали собирать отдельный
   decision/improvement ledger, или продолжаем до `08` и там сводим решения?

## Evidence Appendix

Knowledge docs used:

- `docs/knowledge/AGENT_BRIEF.md`
- `docs/knowledge/03-job-lifecycle.md`
- `docs/knowledge/04-data-sources-tronscan-indexing.md`
- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/08-admin-and-bot-ux.md`
- `docs/knowledge/09-current-decisions.md`
- `docs/knowledge/10-open-problems.md`
- `docs/knowledge/13-agent-observations.md`

Code entry points inspected:

- `src/runtime/startupSchedule.ts`
  - `buildStartupWorkSchedule`
  - `startStartupWorkSchedule`
- `src/index.ts`
  - `recoverStaleForensicJobsOnce`
  - `runForensicJobsOnce`
  - `whereForensicOnce`
  - `deepForensicOnce`
  - `incomingDepositOnce`
  - `addressIndexOnce`
- `src/storage/repositories.ts`
  - `createOrReuseForensicCheckJob`
  - `saveAddressFastCheckJob`
  - `claimNextForensicCheckJob`
  - `releaseForensicCheckJobToWaiting`
  - `upsertForensicJobWait`
  - `markWaitingForensicJobsReadyAfterTargetedIndex`
  - `patchWaitingForensicJobsTargetedIndexProgress`
  - `getForensicJobTargetedHistoryProgress`
  - `recoverStaleForensicCheckJobs`
  - `completeForensicCheckJob`
- `src/forensics/forensicJobProgress.ts`
  - `ForensicJobPhase`
  - `mergeForensicJobProgress`
  - `buildForensicJobRuntimeSummary`
  - `isIncomingDeliverySensitivePhase`
- `src/forensics/forensicJobBatch.ts`
  - `runForensicJobBatch`
- `src/forensics/deepForensicJob.ts`
  - `runSingleDeepForensicJobCycle`
  - `runWhereIsMoneyJob`
- `src/forensics/incomingDepositJob.ts`
  - `runSingleIncomingDepositJobCycle`
- `src/forensics/addressIndexWorker.ts`
  - `runAddressIndexWorkerOnce`
- `src/forensics/targetedHistoryCoordinator.ts`
  - `ensureTargetedHistoryOrWait`
  - `ensureCandidateWindowsOrWait`
  - `targetedHistoryWaitingProgressPatch`
  - `candidateWindowWaitingProgressPatch`
  - `targetedHistoryReadyProgressPatch`
- `src/admin/adminServer.ts`
  - `withTargetedHistoryProgress`
- `src/admin/forensicsGraph.ts`
  - waiting targeted history progress projection

Focused verification:

```text
npm test -- tests/storage/forensicCheckJobs.test.ts tests/forensics/forensicJobBatch.test.ts tests/forensics/forensicJobProgress.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/addressIndexWorker.test.ts tests/forensics/targetedHistoryCoordinator.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminServer.test.ts tests/admin/adminConsole.test.ts
```

Result:

```text
Test Files  10 passed (10)
Tests       489 passed (489)
```

Delta verification for `codex/where-candidate-window-first-indexing`:

```text
npm test -- tests/forensics/candidateWindowTargeting.test.ts tests/forensics/targetedHistoryCoordinator.test.ts tests/forensics/moneyOriginTrace.test.ts tests/forensics/tronAddressAllTimeIndex.test.ts tests/storage/repositories.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
```

Result:

```text
Test Files  8 passed (8)
Tests       452 passed (452)
```
