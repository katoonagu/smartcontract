---
status: draft
audit_type: knowledge_deep_audit
scope: data indexing walkthrough
created: 2026-07-04
---

# Data Indexing Walkthrough

## What This Area Does

Этот раздел объясняет, как система получает TRON USDT history из TronScan,
сохраняет ее в local index и решает, можно ли считать историю покрытой для
forensic trace.

Это не просто "клиент к TronScan". В продукте indexing отвечает за более
важный вопрос: есть ли у нас достаточно данных, чтобы честно сделать
source-of-funds вывод.

Архитектурно область состоит из нескольких слоев:

- TronScan client and scheduler;
- local DB state для address USDT index;
- page audits;
- indexed transfer rows;
- coverage intervals;
- address index worker;
- targeted wait/resume coordinator;
- repair script для старых dirty targeted states.

Эти слои вместе превращают live provider pages в evidence, которым потом
пользуются `Where is money`, `Incoming deposit`, `DeepCheck` и Admin graph.

## Why It Exists

Forensic answer не может быть лучше, чем data coverage под ним.

Если hop history не дошла до нужного timestamp, система не знает, что было
раньше. Это не "чистый путь". Это missing data.

Раньше опасный путь выглядел так: система брала несколько live страниц, не
находила плохой источник, писала `History not fully fetched` и могла выглядеть
как будто проверка закончена. Current product direction другой:

```text
If required provenance history is incomplete, continue indexing or return a
technical no-score state.
```

Поэтому indexing нужен не только для скорости. Он нужен для честности.

TronScan может быть capped, rate-limited, inconsistent или просто тяжелым для
адресов с плотной историей. Local page budget тоже может закончиться. Все эти
ситуации должны быть отличимы друг от друга, потому что они дают разные
продуктовые выводы.

## Main User/Product Question

Главный вопрос раздела:

```text
Достаточно ли покрыта история, чтобы использовать trace/scoring как forensic
result?
```

Для `Where is money` это обычно означает:

```text
Для hop address A есть targeted USDT history до target timestamp T.
```

После candidate-window-first обновления это надо читать точнее:

```text
broad_targeted coverage: address A covered from genesis-like start to target T.
candidate_window coverage: address A covered only for candidate window S -> T.
```

Candidate window can help prove a specific funding candidate, but it does not
mean the whole broad targeted address history is covered.

Для `DeepCheck` это может означать:

```text
Для subject wallet есть all_time USDT history, если DeepCheck работает в
strict all-time mode.
```

Для `Incoming deposit` продуктовый смысл похож на Where: sender path должен
быть покрыт до relevant deposit/funding timestamp. Но текущая реализация еще
не использует общий resumable wait/resume loop как ordinary Where.

## End-To-End Flow

### 1. Provider Requests

TRON USDT transfer data приходит из TronScan через `TronscanClient`.

Все requests идут через `TronscanScheduler`. Scheduler умеет:

- использовать pool TronScan API keys;
- разделять keys на account groups;
- держать per-key pacing;
- держать account-group pacing;
- держать endpoint pacing для transfer/approval/contract/fullnode/trongrid;
- охлаждать slot/group/scope после 429;
- coalesce identical in-flight transfer requests by cache key;
- отдавать diagnostics без раскрытия самих ключей.

Это решает throughput и rate-limit hygiene. Но это не решает coverage само по
себе. Больше ключей может ускорить работу, но не превращает локальный
`partial_budget_exhausted` в покрытую историю.

### 2. Index Request

Центральный entry point в runtime - `ensureAddressUsdtHistory`.

Ему передают:

- `address`;
- `coverageMode`: `all_time` или `targeted`;
- `targetTimestamp` / `stopAtTimestamp`;
- `requestedByJobId`;
- `queuedReason`;
- page/window budget overrides;
- lock owner/window, если вызов пришел из background worker.

Функция сначала проверяет existing index state. Если state уже
`complete` with `complete_provider_windowed`, она возвращает его. Если нет,
она читает saved page audits и запускает `indexTronAddressUsdtHistory`.

Для targeted inline path есть важный default:

```text
TARGETED_HISTORY_INLINE_MAX_PAGES = 4
```

Это быстрый seed, а не финальная гарантия coverage для required Where hops.
Обычный Where при нехватке required targeted history должен уйти в background
targeted indexing.

### 3. Page Audit And Cache-Aware Resume

Indexer fetches provider pages by time window and offset.

Каждая fetched page сохраняется как page audit:

- address;
- coverage mode;
- target timestamp key;
- window start/end;
- offset/limit;
- status `complete` или `empty`;
- provider;
- total/rangeTotal;
- raw response hash;
- canonical transfer hash;
- newest/oldest transfer timestamps.

При следующем запуске stable saved page может заменить live TronScan request,
если у нее есть стабильные hashes и provider metadata. Это и есть
cache-aware resume.

Важное следствие: saved page audit - это не просто debug artifact. Это
материал для продолжения тяжелого indexing run без повторного скачивания уже
проверенных окон.

### 4. Window Coverage

Indexer пытается покрыть временное окно от genesis-like start до нужного end:

- для `targeted` end = target timestamp;
- для `all_time` end = current runtime time.

Если окно uncapped, indexer забирает offset pages, dedupes rows, пишет indexed
transfers и coverage interval.

Если provider сообщает capped range, indexer не должен сразу сдаваться. Он
сначала пытается adaptive cursor split: берет oldest raw row в capped page и
сдвигает older window до момента перед этой строкой. Это снижает повторное
скачивание одного и того же heavy top page.

Если cursor не помогает, fallback - midpoint split.

Если даже после splits/budget окно нельзя доказать, state становится partial:

- `partial_provider_cap`;
- `partial_budget_exhausted`;
- `partial_rate_limited`;
- `partial_provider_inconsistent`.

### 5. Indexed Transfers

Нормализованные canonical USDT transfer rows пишутся в local transfer table.

Trace code потом читает их через indexed transfer queries. Это важно: trace
должен опираться на local covered/indexed history, а не только на одноразовый
live response.

Но наличие transfer rows не всегда означает exact coverage. Например, после
terminal provider cap в cache могут быть полезные transfers, которые помогают
funding-first context. Пока конкретное окно не покрыто, такие данные могут
быть `probable` context, но не hard exact source proof.

### 6. Background Address Index Worker

Background worker claims queued address index states.

Он отвечает за техническую lifecycle часть:

- claim queued or stale `running` states;
- поставить lock owner и lock TTL;
- передать lock context в `ensureAddressUsdtHistory`;
- продлевать heartbeat во время долгого run;
- requeue retryable targeted partials;
- escalate targeted page budget where allowed;
- mark waiting forensic jobs ready or terminal after targeted indexing.

Для ordinary Where background targeted budget сейчас задается code constants:

```text
TARGETED_HISTORY_BACKGROUND_MAX_PAGES = 200
TARGETED_HISTORY_BACKGROUND_MAX_PAGES_PER_HOP = 12000
TARGETED_HISTORY_BACKGROUND_MAX_WINDOW_SPLIT_DEPTH = 24
TARGETED_HISTORY_BACKGROUND_MAX_ATTEMPTS = 8
```

Это намного лучше, чем old four-page inline stop, но это все еще hard-coded
operational policy, а не product/runtime config.

### 7. Targeted Wait/Resume Coordinator

Когда Where trace доходит до required hop и видит, что targeted history
не покрыта, он вызывает targeted coordinator.

Coordinator делает несколько проверок:

1. Есть ли exact complete state for address + target timestamp?
2. Есть ли newer same-address covering state, который покрывает более ранний
   target timestamp?
3. Является ли existing/covering partial retryable?
4. Нужно ли queue/requeue targeted index work?
5. Нужно ли release parent forensic job в `waiting_for_targeted_index`?
6. Если state terminal, каким technical no-score status это станет?

Главная продуктовая защита здесь: parent Where job не должен завершаться
псевдо-результатом только потому, что inline fetch не хватило. Он должен ждать
targeted index task, пока есть осмысленный retry/escalation path.

Если retry budget достиг ceiling или provider state terminal, parent job
получает technical terminal status. Это честнее, чем финальный score на
непокрытой истории.

### 8. Candidate-Window Targeted Indexing

В актуальной ветке `codex/where-candidate-window-first-indexing` ordinary Where
получил более узкий targeted request kind:

```text
request_kind = candidate_window
```

Он используется только для `probable` funding-first source provenance. Trace
выбирает funding candidates, сортирует их по usable amount and timestamp, и
ставит до пяти candidate windows per hop, с общим cap на job-level requests.

Candidate-window state хранит:

- `address`;
- `targetTimestamp`;
- `windowStartTimestamp`;
- `windowEndTimestamp`;
- `relatedHopTxHash`;
- `candidateTxHash`.

Indexer для такого state читает только окно `windowStartTimestamp ->
windowEndTimestamp`. Broad targeted state продолжает читать `genesis ->
targetTimestamp`.

Главный invariant:

```text
candidate_window coverage does not satisfy broad_targeted coverage.
```

Storage это защищает на уровне identity: primary/unique keys включают
`request_kind`, `window_start_timestamp_ms` и `candidate_tx_hash`. Broad
covering lookup явно фильтруется по `request_kind='broad_targeted'`, поэтому
узкое candidate window не может случайно закрыть broad same-address wait.

### 9. Repair Path

В проекте есть maintenance script `repairTargetedIndexCoverage.ts`.

Он нужен для старых dev/pre-fix targeted states, которые могли быть ошибочно
помечены `complete`. Repair path:

- ищет suspicious complete targeted states;
- оценивает high-confidence repair candidates;
- может работать dry-run или apply;
- не удаляет page audits;
- не удаляет indexed transfers;
- переводит dirty state обратно в queued/retryable path с большим budget.

Это не ordinary product flow. Это maintenance для старых данных.

## Important Data Structures / States

### `TronAddressUsdtIndexState`

Это главный state для address indexing.

Ключевые поля:

- `address`;
- `coverageMode`;
- `targetTimestamp`;
- `status`;
- `statusReason`;
- `provider`;
- `fetchedTransferCount`;
- `uniqueCounterpartyCount`;
- `newestTransferAt`;
- `oldestTransferAt`;
- `fetchedPageCount`;
- `providerCapHit`;
- `budgetExhausted`;
- `providerInconsistent`;
- `attemptCount`;
- `maxAttempts`;
- `queuedReason`;
- `requestedByJobId`;
- `lockedUntil`;
- `heartbeatAt`;
- `budgetPages`.

Этот state говорит не только "что получилось", но и почему indexing остановился.

### Coverage Modes

`all_time` означает широкую историю адреса. В DeepCheck это используется для
subject all-time profile.

`targeted` означает историю адреса до конкретного target timestamp. Для money
path это важнее, чем просто последние страницы, потому что source-of-funds
часто требует данных до момента конкретного hop transfer.

Targeted coverage имеет covering semantics: если для того же address есть
complete/terminal state с более поздним target timestamp, он может покрывать
ожидание более раннего target timestamp.

Это covering semantics относится к broad targeted coverage. Для
`candidate_window` identity intentionally narrower: разные candidate tx hashes
и разные window starts для одного address/target могут сосуществовать и не
подменять друг друга.

### Coverage Status Reasons

`complete_provider_windowed` - история считается покрытой в provider-windowed
модели.

`partial_budget_exhausted` - остановились из-за локального page budget.

`partial_rate_limited` - уперлись в rate limit/retry policy.

`partial_provider_cap` - provider window остался capped/unresolved.

`partial_provider_inconsistent` - provider/page data изменилась или не
согласовалась с предыдущим audit.

`failed_retryable` и `failed_terminal` - worker-level failures.

### Page Audits

Page audit фиксирует provider response for a page/window/offset. Она нужна для
cache-aware resume и для расследования, почему coverage state стал partial или
complete.

Stable page audit может быть reused. Dirty or inconsistent page audit не должен
молча становиться proof.

### Coverage Intervals

Coverage interval фиксирует, что конкретное time window было покрыто или
осталось partial, с provider evidence. Это ближе к "какой кусок истории
проверен", чем общий index state.

### Indexed Transfers

Indexed transfer row - normalized canonical USDT transfer, доступный для trace
queries.

Он полезен как fact. Но сам по себе transfer row не доказывает, что весь
нужный time window covered.

## What The Knowledge Docs Claim

`docs/knowledge/04-data-sources-tronscan-indexing.md` говорит, что TronScan -
primary source для TRON USDT history на этом этапе. Manual CSV workflow не
является продуктовым направлением.

Knowledge docs фиксируют API key pool и account groups как throughput
инфраструктуру, но явно говорят: more keys do not fix local page budgets or
partial targeted-index states by themselves.

Docs также фиксируют текущие budgets:

- inline targeted seed = 4 pages;
- background base = 200 pages;
- per-hop ceiling = 12000 pages;
- split depth = 24;
- attempts = 8.

Для ordinary Where docs утверждают, что required targeted hops теперь queue
background index task, parent job moves to `waiting_for_targeted_index`, and
resumes after ready or terminal.

Актуальные knowledge docs после `14b4c97` уточняют: для `probable`
funding-first candidates ordinary Where сначала queues durable
`candidate_window` targeted indexing. Только если candidate windows already
done/terminal and still insufficient, Where may queue older broad
`where_is_money_hop` fallback.

Для Incoming docs утверждают обратное: Incoming still lacks shared resumable
targeted indexing flow.

Knowledge docs also claim:

- provider cap is not automatically a final user result;
- local budget is not provider truth;
- old false `complete` targeted states need maintenance repair;
- cache-aware resume should reuse stable saved page audits;
- split depth/window progress is not yet first-class product progress.

## What The Code Appears To Implement

Code inspection broadly matches the knowledge docs.

`TronscanScheduler` implements key slots, account groups, pacing, endpoint
buckets, rate-limit cooldowns, in-flight coalescing and diagnostics.

`TronscanClient` routes provider requests through that scheduler and sets
`TRON-PRO-API-KEY` from either the pool or a fixed key path.

`ensureAddressUsdtHistory` is the runtime bridge between product jobs and the
indexer. It checks existing state, loads saved page audits, passes stable cache
pages into `indexTronAddressUsdtHistory`, applies inline targeted page default,
writes progress heartbeat and returns a `TronAddressUsdtIndexState`.

`indexTronAddressUsdtHistory` writes a `running` state, recursively ensures
windows, writes page audits, coverage intervals and indexed transfers, then
updates the final state to `complete` or `partial`.

`addressIndexWorker` claims queued/stale states, runs indexing with lock
context, retries targeted partials where allowed and wakes waiting forensic
jobs only when coverage is ready or terminal.

`targetedHistoryCoordinator` implements the ordinary Where wait/resume gate. It
checks exact state, newer covering state, retryable partials, terminal partials,
queues target indexing and releases parent forensic job to
`waiting_for_targeted_index`.

`candidateWindowTargeting` and `ensureCandidateWindowsOrWait` implement the
new narrow candidate-window path. They select windows from `probable`
source-provenance funding members, queue `request_kind='candidate_window'`
states, write matching `forensic_job_waits`, and keep the parent Where job in
`waiting_for_targeted_index` while the windows are pending.

`targetedIndexRepair` and `repairTargetedIndexCoverage.ts` implement a
maintenance-only repair path for dirty old complete states.

## Confirmed Vs Not Confirmed

`docs-only`:

- Product principle that TronScan remains the primary source for this phase;
- no manual CSV product workflow;
- long checks may take a long time if needed for coverage;
- Incoming should eventually get the same resumable indexing behavior as
  ordinary Where.

`code-inspected`:

- Scheduler key pool/account group mechanics;
- `all_time` and `targeted` state keys;
- stable page audit reuse by raw/canonical hash;
- provider cap split behavior;
- inline targeted 4-page default;
- background Where targeted budgets;
- targeted covering-state lookup;
- candidate-window identity and broad/candidate separation;
- retry/terminal mapping for partial states;
- maintenance repair script behavior.

`test-backed`:

- focused test run passed: 8 files, 196 tests;
- covered config parsing, scheduler behavior, indexer window/page behavior,
  cache reuse, targeted mode separation, address worker retry/escalation,
  targeted coordinator, repair candidates and storage coverage/page audit
  cases.

`runtime-observed`:

- this section did not run a live TronScan indexing job;
- this section did not inspect current production/dev DB targeted states;
- this section did not open Admin progress graph live;
- live throughput with real API key pool was not measured here.

## Known Gaps

Incoming deposit still does not use the shared resumable targeted indexing
flow. It can produce `scoreValid=false` when coverage is blocked, but it does
not yet behave like ordinary Where with parent job wait/resume.

Budgets are still code constants. The current ceiling is much better than the
old inline stop, but product/runtime owners cannot yet tune it per job, address
density, customer tier or observed provider behavior without code changes.

Heavy addresses can still hit the 12000-page ceiling. At that point the system
can correctly produce a technical terminal result, but the product question
remains: should we raise budget, improve splitting/indexing, or accept the
technical no-score for those cases?

`all_time` freshness needs explicit attention in later sections. Code inspection
shows `ensureAddressUsdtHistory` returns an existing `complete` state without a
freshness check. That is safe for fixed targeted timestamps, but for `all_time`
the product meaning of "fresh enough" should be clarified before treating an
old complete state as proof for a fresh run.

Repair of old false `complete` targeted states is maintenance-only, not an
ordinary product migration. That is reasonable, but analysts/agents need to
remember that old DB evidence can be dirty until repaired.

Admin progress shows useful targeted state data, but split depth/window-level
progress is not yet first-class. Page counts, transfer counts and provider
errors help, but they do not fully explain how the window splitting strategy is
progressing.

Candidate-window counts are now first-class in Admin progress, but general
split-depth/window-count progress for broad targeted indexing is still not
first-class. Это разные вещи: candidate-window counts say how many selected
narrow proof windows are pending; split-depth progress would explain how the
broad indexer is recursively splitting capped provider windows.

More API keys improve throughput only if provider quota is the bottleneck.
They do not solve local budget ceilings, stale dirty states, missing
wait/resume wiring or product policy around incomplete coverage.

## Risks / Failure Modes

Treating `partial_provider_cap` as "TronScan cannot provide the data" is risky.
It may only mean the current window is capped and needs narrower windows or
more budget.

Treating `partial_budget_exhausted` as provider truth is wrong. It is our local
budget stop.

Treating indexed transfer rows as exact coverage is risky. Rows are facts, but
coverage depends on whether the relevant window was fully covered.

Treating old `complete` targeted states as fresh proof is risky when those
states came from pre-fix/dev runs. The repair script exists exactly because
old complete states can be false.

Treating API key count as the main product solution is risky. Scheduler
throughput and forensic completeness are connected, but not equivalent.

Treating `all_time` complete state as permanently fresh may become risky for
DeepCheck or future scoring if the address keeps transacting after the index
was completed.

## What To Keep As-Is

Keep the separation between provider scheduler and coverage logic. Scheduler
should manage requests, not decide forensic truth.

Keep `all_time` and `targeted` as separate coverage modes. They answer
different questions and should not share one vague "indexed" flag.

Keep `broad_targeted` and `candidate_window` separated inside targeted
coverage. Candidate-window proof is useful exactly because it is narrow; it
would be unsafe to let it masquerade as broad history coverage.

Keep page audits. They are valuable for cache-aware resume, debugging and
evidence confidence.

Keep provider-cap window splitting. It is the correct response to capped
provider ranges, especially the adaptive cursor path that avoids replaying the
same dense top page.

Keep targeted wait/resume for ordinary Where. This is the right product shape:
one user check can internally wait for background indexing instead of returning
a fake final answer.

Keep terminal technical no-score mapping. When coverage cannot be completed
inside the current ceiling, the honest answer is a technical blocker, not a
risk verdict.

Keep repair as maintenance-only for old dirty states. It should not silently
rewrite product truth during ordinary user checks.

## Improvement Ideas

Promote targeted budgets from code constants to runtime/product config. At
minimum, expose current values in Admin/readiness diagnostics so an analyst can
see which ceiling a job is using.

Add clearer freshness semantics for `all_time` index states. This could be a
documented TTL, a `covered_until` rule, or a mode-specific policy that says
when an old all-time state is acceptable.

Bring Incoming deposit into the shared wait/resume targeted indexing flow. This
is the biggest product-aligned improvement for data completeness.

Improve Admin progress for split windows: current window count, split depth,
cached page reuse count, live fetch count and estimated remaining windows would
make long jobs easier to interpret.

Add an Admin/read-only explanation for candidate-window vs broad targeted
coverage. Analysts should see that "candidate windows complete" means "narrow
proof windows checked", not "all broad hop history covered".

Add a compact "coverage vocabulary" doc or Admin help table:

| Status | Meaning | Product interpretation |
| --- | --- | --- |
| `complete_provider_windowed` | Required window covered | usable coverage |
| `partial_budget_exhausted` | local budget ended | not provider truth |
| `partial_provider_cap` | provider range still capped | split/retry or technical no-score |
| `partial_rate_limited` | provider throttled after retries | retry/technical blocker |
| `partial_provider_inconsistent` | saved/live page mismatch | do not trust silently |

Consider a read-only coverage inspector command for a single address/target.
The pieces exist in DB, but an analyst-friendly explanation would reduce
manual SQL and reduce confusion between page audits, intervals and final state.

## Questions For You

1. Should `all_time` freshness be treated as an explicit audit question in
   `04-job-lifecycle-walkthrough.md` or saved for `06-scoring-walkthrough.md`?

2. Do you agree that "more TronScan keys" should be documented as throughput,
   not as the main solution to coverage completeness?

3. Should the current 12000-page targeted ceiling be considered acceptable
   safety policy for now, or should we mark it as `needs product decision`?

4. For Incoming deposit, do we record shared wait/resume indexing as a
   high-priority improvement idea now, or keep it as a known gap until the
   later Incoming/forensic sections?

## Evidence Appendix

Knowledge docs used:

- `docs/knowledge/AGENT_BRIEF.md`
- `docs/knowledge/03-job-lifecycle.md`
- `docs/knowledge/04-data-sources-tronscan-indexing.md`
- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/09-current-decisions.md`
- `docs/knowledge/10-open-problems.md`
- `docs/knowledge/13-agent-observations.md`

Code entry points inspected:

- `src/index.ts`
  - `createTronscanScheduler` runtime wiring
  - `ensureAddressUsdtHistory`
  - `addressIndexOnce`
  - `runForensicJobsOnce` indexing deps
- `src/tron/tronscanScheduler.ts`
  - `createTronscanScheduler`
  - `schedule`
  - `diagnostics`
- `src/tron/tronClient.ts`
  - scheduler-backed provider request path
- `src/forensics/tronAddressAllTimeIndex.ts`
  - `indexTronAddressUsdtHistory`
  - page audit/cache-aware resume logic
  - provider-cap split logic
- `src/forensics/addressIndexWorker.ts`
  - `runAddressIndexWorkerOnce`
  - targeted retry/escalation helpers
- `src/forensics/candidateWindowTargeting.ts`
  - `selectCandidateWindowsForSourceProvenance`
- `src/forensics/targetedHistoryCoordinator.ts`
  - `ensureTargetedHistoryOrWait`
  - `ensureCandidateWindowsOrWait`
  - `targetedHistoryTerminalStatus`
- `src/forensics/targetedIndexRepair.ts`
  - `assessTargetedIndexRepairCandidate`
  - `repairInvalidCompleteTargetedIndexStates`
- `scripts/repairTargetedIndexCoverage.ts`
- `src/storage/repositories.ts`
  - `getTronAddressUsdtIndexState`
  - `getCoveringTronAddressUsdtIndexState`
  - `queueTronAddressUsdtIndexState`
  - `claimQueuedTronAddressUsdtIndexStates`
  - `upsertTronAddressUsdtIndexPage`
  - `listTronAddressUsdtIndexPages`
  - `upsertTronAddressUsdtCoverageInterval`
  - `listIndexedTronUsdtTransfersForAddress`
- `src/types.ts`
  - `TronAddressUsdtIndexStatus`
  - `TronAddressUsdtCoverageStatusReason`
  - `TronAddressUsdtCoverageMode`
  - `TronAddressUsdtIndexState`
  - `TronAddressUsdtIndexRequestKind`
  - `WhereCandidateWindowRequest`

Focused verification:

```text
npm test -- tests/config/config.test.ts tests/tron/tronscanScheduler.test.ts tests/forensics/tronAddressAllTimeIndex.test.ts tests/forensics/addressIndexWorker.test.ts tests/forensics/targetedHistoryCoordinator.test.ts tests/forensics/targetedIndexRepair.test.ts tests/storage/repositories.test.ts tests/forensics/fundingFirstSourceProvenance.test.ts
```

Result:

```text
Test Files  8 passed (8)
Tests       196 passed (196)
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

Runtime observation for this delta:

```text
Admin /admin/forensics returned HTTP 200 from the local live process.
```
