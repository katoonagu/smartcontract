# Unified Wallet Check Adaptive Rolling Planner Design

**Дата:** 2026-07-24
**Статус:** final approved design, implementation pending
**Базовый commit:** `98a984277a94a7d9b7fe54df5510bc7377d33e80`
**Область:** Unified Wallet Check, traversal planner, provider scheduling,
PostgreSQL migration 034, Admin observability, benchmark и rollout

## 1. Назначение и связь с предыдущим дизайном

Этот документ фиксирует production path для параллельного Unified traversal:

- adaptive rolling refill;
- ordered canonical commit;
- durable planning и execution admission в PostgreSQL;
- provider/demand-aware capacity controller;
- work-conserving hierarchical max-min fairness;
- эластичный заимствуемый repair reserve.

Документ дополняет
`2026-07-24-unified-wallet-check-traversal-performance-design.md` и заменяет в
нём только решения о фиксированном четырёхслотовом окне, wave/barrier как
production scheduler, weighted round-robin и соответствующем benchmark.

Не заменяются:

- snapshot-bound `AddressHistoryManifest`;
- immutable provider pages, attempts, artifacts и traversal deltas;
- address-centric reuse и attribution;
- closure, scoring, report и delivery contracts;
- evidence-backed boundaries;
- правило одного итогового пользовательского результата.

Barrier сохраняется как deterministic oracle, rollout fallback и режим
сравнения. Он больше не является целевой production-архитектурой.

## 2. Проверенная текущая реальность

Текущий release candidate уже имеет:

- общую очередь `unified_check_tasks`;
- event-driven provider pool;
- четыре настроенных provider slots;
- per-group pacing, cooldown и 429 handling;
- immutable address-history manifests;
- bounded chunks и traversal deltas;
- run-aware claim ordering;
- Admin progress projection.

Но production traversal coordinator берёт первый canonical frontier group,
создаёт только требуемую ему `address_history` и возвращает checkpoint.
`claimUnifiedTask()` не разрешает следующий traversal claim, пока у run есть
незавершённая `address_history`. Поэтому один dense run обычно не создаёт
достаточно независимой claimable work, даже если provider pool имеет свободные
слоты.

Локальный isolated-прогон трёх последних уникальных кошельков на базовом
commit показал:

- `TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV` завершился примерно за 315 секунд,
  score `35`, decision `REVIEW`;
- `TFWGukC9eWTfg4DYtQAzwuAK5XV85rVYJr` и
  `TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd` оставались `RUNNING` более 31 минуты;
- запросы распределялись по четырём настроенным ключам без 429;
- WSL держался примерно в диапазоне 2.9–3.1 GB, Linux swap оставался нулевым.

Этот live-run не является frozen performance baseline: provider responses не
были сохранены как одинаковый replay input. Он доказывает operational symptom,
но не точный коэффициент ускорения и не утечку памяти.

## 3. Цели

Система должна:

1. Использовать максимально доступную безопасную provider capacity, когда
   canonical frontier уже содержит независимую обязательную работу.
2. Не иметь фиксированной архитектурной ёмкости на 4, 8, 16 или 100 workers.
3. Сохранять полный traversal closure, deterministic facts, score, decision и
   hashes при любом порядке завершения задач.
4. Позволять одному dense run использовать весь свободный provider pool.
5. Справедливо делить capacity между owner и run при конкуренции.
6. Не позволять slow canonical head или full buffer одного run остановить
   остальные.
7. Сохранять progress, manifests, admission и reservations после restart.
8. Разделять provider, analysis и finalization capacity.
9. Объяснять простой измеренным limiting reason.
10. Оставаться bounded по памяти, DB buffer и размеру commit.

«10 минут» — только сравнительная benchmark-отметка. Это не timeout, SLO,
coverage limit или потолок дизайна.

## 4. Неизменяемые correctness-инварианты

- `unified_check_tasks` остаётся единственным источником execution lifecycle:
  lease, attempt, retry, checkpoint, cancellation и provider state.
- Planner хранит только canonical ordering, execution admission и merge-state.
- Canonical traversal state меняется только ordered commit непрерывного
  ready-prefix.
- `canonical_sequence` не зависит от capacity, lookahead и порядка завершения.
- Worker могут исполнять разные независимые задачи в любом порядке.
- Одна cursor-dependent history остаётся последовательной.
- Принятый artifact immutable и достигается через
  `task.accepted_attempt_id → attempt.artifact_sha256`.
- Независимые результаты не ждут canonical head, если они не изменяют
  traversal state.
- Canonical head не пропускается и не дублируется.
- `COMPLETED` требует closure и создаёт один score и decision.
- Authoritative eligible request создаёт ровно один delivery intent.
- Isolated canary не создаёт внешнюю Telegram-доставку.
- Restart или повторный commit не создаёт дополнительный delivery intent.

## 5. Рассмотренные подходы

### 5.1 Barrier waves

Просто доказываются и удобны как oracle, но ждут самую медленную задачу wave и
оставляют provider capacity пустой.

**Решение:** deterministic oracle и rollout fallback.

### 5.2 Adaptive rolling refill с ordered canonical commit

Worker выполняют независимую работу параллельно, а coordinator применяет
результаты только в canonical sequence. Lookahead, admission и buffer bounded,
но растут вместе с безопасной capacity.

**Решение:** production path.

### 5.3 Немедленный order-independent merge

Может уменьшить head-of-line blocking, но требует доказать коммутативность
каждой операции при retry, restart и разном порядке завершения.

**Решение:** отложено. `merge_class` в первой версии не добавляется.

## 6. Архитектура и resource classes

Общий flow:

```text
confirmed snapshot + canonical frontier
  → deterministic planner
  → unified_check_tasks
  → parallel bounded workers
  → immutable accepted artifacts
  → durable planner ready-prefix
  → ordered traversal commit
  → rolling refill
  → closure
  → branches/finalization
  → score/report
  → one eligible delivery intent
```

Planner применяется по семантике ordered commit, а не по одному task kind.
Через него проходят только задачи, результат которых изменяет canonical
traversal state. Это могут быть `address_history` и будущие provider tasks.

Direct history, deep evidence и будущая независимая work продолжают жить в
общей очереди и могут завершаться без ожидания planner head.

Resource classes:

- `provider`: provider requests и cursor-bound chunks;
- `analysis`: traversal planning/commit и CPU/DB-intensive evidence work;
- `finalization`: closure, scoring, report и delivery preparation.

Увеличение key-group pool расширяет только provider capacity. Оно не создаёт
дополнительную DB-, CPU- или memory-heavy параллельность.

В первой версии provider capacity адаптивно увеличивается и уменьшается.
Analysis и finalization получают небольшие конфигурационные потолки и могут
только снижаться либо приостанавливаться при resource pressure. Их
автоматическое throughput-tuning откладывается до benchmark.

## 7. Migration 034

Migration 033 не изменяется. Она уже участвовала в checksum и release evidence.
Новая additive migration:

```text
migrations/034_unified_check_adaptive_planner.sql
```

добавляет durable planner и `fairness_owner_id`.

### 7.1 Planner table

Целевая таблица `unified_check_planner_entries`:

| Поле | Тип | Назначение |
|---|---|---|
| `run_id` | `text` | Владелец canonical plan |
| `canonical_sequence` | `bigint` | Append-only ordered sequence внутри run |
| `task_id` | `text` | Существующая `unified_check_tasks` identity |
| `planner_state` | `text` | Только `planned`, `ready`, `committed` |
| `result_bytes` | `bigint null` | Размер UTF-8 canonical serialization принятого artifact |
| `admitted_at` | `timestamptz null` | Durable execution admission |
| `reserved_bytes` | `bigint null` | Durable reservation до acceptance |
| `planned_at` | `timestamptz` | Время выдачи sequence |
| `ready_at` | `timestamptz null` | Время acceptance |
| `committed_at` | `timestamptz null` | Время ordered commit |

Planner не хранит `manifest_sha256`. Единственный источник принятого результата:

```text
planner.task_id
  → unified_check_tasks.accepted_attempt_id
  → unified_check_attempts.artifact_sha256
  → unified_check_artifacts
```

`planner_state` является только merge-state. Admission выражается отдельно
через `admitted_at`.

### 7.2 Constraints

- Primary key: `(run_id, canonical_sequence)`.
- Unique: `(run_id, task_id)`.
- `canonical_sequence >= 0`.
- `result_bytes >= 0`, когда задан.
- `reserved_bytes >= 0`, когда задан.
- Composite foreign key `(run_id, task_id)` ссылается на
  `unified_check_tasks(run_id, id)`.
- Migration добавляет совместимый unique key
  `unified_check_tasks(run_id, id)`.
- Все planner timestamps создаются PostgreSQL clock.

State shape:

- `planned`: `result_bytes`, `ready_at`, `committed_at` равны `null`;
- non-admitted `planned`: `admitted_at` и `reserved_bytes` равны `null`;
- admitted `planned`: `admitted_at` и `reserved_bytes` заданы вместе;
- `ready`: `admitted_at`, `result_bytes`, `ready_at` заданы,
  `reserved_bytes` и `committed_at` равны `null`;
- `committed`: дополнительно задан `committed_at`;
- заданные timestamps сохраняют причинный порядок
  `planned_at <= admitted_at <= ready_at <= committed_at`.

При de-admission ещё не leased tail entry снова получает
`admitted_at = null` и `reserved_bytes = null`.

### 7.3 Индексы

Индексы поддерживают:

1. Первый незакоммиченный sequence конкретного run.
2. Ordered scan непрерывного ready-prefix.
3. Claim join только admitted ordered tasks.
4. Aggregate ready-buffer count/bytes и durable reserved bytes.

Planner не получает materialized counters в первой версии. Indexed
`count/sum` проверяются на representative benchmark dataset. Маленькая unit
таблица не обязана всегда получать конкретный PostgreSQL query plan.

### 7.4 Fairness owner

Migration 034 добавляет `fairness_owner_id` в `unified_check_runs`.

- Для нового `user_check` owner identity фиксируется при создании run.
- Identity является устойчивой и opaque; raw user/chat identifier не
  используется как Admin/metrics label.
- Все кошельки одного owner делят owner-level fair share.
- Existing legacy rows и technical/synthetic work используют `run_id` как
  fallback.

Backfill не превращает старые активные run в planner runs. Он только даёт им
безопасную fallback identity.

### 7.5 Release schema contract

Migration 034 добавляется в:

- migration checksum contract;
- structural verification;
- startup/release schema gate;
- restart-recovery tests;
- compatibility rehearsal поверх schema 033.

До реализации и прохождения этих gates текущая release truth остаётся
«exact through migration 033».

## 8. Canonical planning

### 8.1 Run-row serialization

При первом создании или расширении plan coordinator выполняет:

```sql
select id
from unified_check_runs
where id = $1
for update;
```

Формулировка «planner scope lock» не используется: при первом plan planner rows
ещё нет, поэтому такой lock не предотвращает гонку.

### 8.2 Capacity-independent sequence

Planning запускается только после deterministic events:

- создание initial frontier;
- commit очередного canonical prefix;
- появление новых обязательных identities из применённых manifests.

Под run-row lock coordinator:

1. Получает полный набор новых обязательных task identities, открытых этим
   canonical transition.
2. Удаляет identities, уже существующие в tasks/planner.
3. Сортирует новые identities по stable canonical identity.
4. Назначает последовательные номера после текущего maximum sequence.
5. Идемпотентно создаёт task и planner entry.

Если commit применяет несколько manifests, новые identities рассматриваются
по sequence родителя и затем по canonical identity внутри его результата.

Sequence append-only. Новая discovery не вставляется между существующими
номерами. Durable backlog может содержать больше задач, чем execution
lookahead. Это принципиальное разделение:

- canonical planning не зависит от мощности;
- execution admission зависит от мощности и demand.

Sequential oracle использует тот же planning/commit algorithm. Он отличается
только admission policy.

## 9. Durable execution admission

`planned` с `admitted_at = null` является durable backlog и не может быть
claimed worker.

Claim query для ordered task обязательно требует:

```text
planner_state = planned
and admitted_at is not null
```

Независимые tasks без planner используют обычный lifecycle schema 033.

### 9.1 Lookahead target

При `providerCapacityLimit = 0` target равен нулю. Иначе:

```text
runLookaheadTarget = min(
  configuredPerRunMaximum,
  max(1, ceil(fairProviderShare × configuredLookaheadFactor))
)
```

После формулы применяются:

- per-run ready-buffer count limit;
- per-run ready-buffer byte limit;
- durable reservations;
- global DB/memory guard;
- resource pressure;
- actual eligible canonical backlog.

Коэффициент и максимумы определяются benchmark. Ни один из них не равен
архитектурно фиксированным четырём.

### 9.2 Admission transaction

Coordinator атомарно:

1. Блокирует строку run.
2. Пересчитывает admitted, ready и reserved usage из durable rows.
3. Выбирает lowest-sequence tail entries до target.
4. Устанавливает `admitted_at` и `reserved_bytes`.

Durable reservation не позволяет нескольким процессам независимо решить, что
в buffer одного run осталось одно и то же место.

При уменьшении capacity coordinator может de-admit только tail entries,
которые ещё не leased. Уже leased task не прерывается и завершает bounded
chunk.

Canonical head может быть admitted при наличии capacity даже при заполненном
ready-buffer, потому что её завершение разблокирует commit. Обычные eligibility
условия всё равно обязательны: `ready_at` task наступил, task не leased другим
worker и её provider group не заблокирована cooldown/circuit.

## 10. Atomic acceptance

Для ordered task один repository operation выполняет одну PostgreSQL
транзакцию:

1. Валидирует hard manifest limit.
2. Сохраняет immutable artifact.
3. Создаёт attempt с unique `(task_id, attempt)`.
4. Устанавливает `task.accepted_attempt_id`.
5. Переводит task в `COMPLETED`.
6. Освобождает `reserved_bytes`.
7. Сохраняет фактический `result_bytes`.
8. Переводит planner `planned → ready` и задаёт `ready_at`.

`result_bytes` — длина UTF-8 canonical serialization принятого artifact.

Идемпотентный повтор после неопределённого ответа worker определяется по:

```text
(task_id, attempt, artifact hash)
```

Если первая транзакция уже завершилась, повтор возвращает тот же успех, даже
если lease снят. Совпадение artifact означает успех; несовпадение означает
invariant violation.

Состояние «accepted task, но planner planned» не возникает, поэтому
reconciliation его не ремонтирует.

Независимая task выполняет тот же attempt/artifact acceptance lifecycle, но
без planner transition.

### 10.1 Manifest hard limit

Один planner manifest имеет configurable hard byte limit. Большой результат
представляется bounded manifest со ссылками на immutable chunks.

Artifact, превышающий hard manifest limit, не принимается как ready manifest.
`commitMaxBytes` валидируется так, чтобы хотя бы один допустимый manifest всегда
мог продвинуть canonical head.

## 11. Ordered canonical commit

Coordinator:

1. Находит первый незакоммиченный sequence.
2. Получает непрерывный ready-prefix.
3. Обрезает prefix по `commitMaxEntries` и `commitMaxBytes`.
4. Загружает artifacts обычным accepted-attempt join.
5. Вычисляет следующий canonical traversal state вне длинной транзакции.
6. В короткой транзакции повторно проверяет:
   - текущий traversal head;
   - первую и последнюю sequence;
   - непрерывность prefix;
   - accepted attempt identity каждой task.
7. Атомарно фиксирует checkpoint/delta-head и переводит bounded prefix в
   `committed`.

При conflict предварительное вычисление отбрасывается и повторяется от нового
head. Повтор после restart либо применяет ещё не committed prefix, либо видит
его уже committed. Повторного добавления canonical facts нет.

После commit coordinator:

- освобождает ready-buffer bytes;
- детерминированно планирует новые identities;
- пересчитывает lookahead и admission.

Если процесс упал после commit и до refill, reconciliation повторяет planning
от текущего committed traversal head. Existing task identities и sequences
находятся идемпотентно; новые номера им не выдаются.

## 12. Capacity controller

### 12.1 Supply и demand

Supply и текущий demand считаются отдельно:

```text
providerCapacityLimit = min(
  healthyIndependentGroupConcurrency,
  configuredProviderConcurrencyLimit,
  providerWorkerLimit,
  dbAndMemoryGuardLimit
)

targetActiveProviderSlots = min(
  providerCapacityLimit,
  eligibleReadyProviderWork
)
```

Несколько ключей одной provider/account group могут делить quota и не
увеличивают `healthyIndependentGroupConcurrency`.

RPS и concurrency не смешиваются:

- controller управляет числом одновременно выполняемых chunks;
- существующий provider scheduler отдельно применяет pacing,
  endpoint/account-group limits, cooldown и 429 handling.

### 12.2 Состояния

Provider group:

- `healthy`;
- `cooldown`;
- `circuit_open`.

Runtime:

- `normal`;
- `pressure`;
- `critical`.

Это разные state machines. Provider health не подменяет memory/DB pressure.

### 12.3 Ramp

- Provider capacity увеличивается фиксированным конфигурируемым шагом через
  заданный interval.
- Уменьшение capacity для новых claims происходит сразу.
- Текущий HTTP request не прерывается.
- PID, self-learning и непрерывное autotuning отсутствуют в первой версии.

### 12.4 Resource guards

Production memory guard использует:

- process RSS;
- process heap;
- available container/cgroup memory;
- host memory, если container/cgroup signal отсутствует.

Также учитываются DB pool waiting, DB latency и checkpoint latency.

WSL memory является только дополнительной локальной диагностикой и не входит в
production capacity contract.

## 13. Work-conserving hierarchical max-min fairness

Для каждой lane и resource class scheduler:

1. Делит capacity между eligible `fairness_owner_id`.
2. Делит owner share между eligible run этого owner.
3. Распределяет surplus новыми равными кругами.
4. Внутри равного круга выбирает least-recently-served.

Примеры:

- один ready run и 16 slots получает все 16;
- три ready run стремятся к 6/5/5;
- если два run могут использовать только по одному slot, третий получает 14;
- 15 ready run и 16 slots получают по одному, дополнительный slot получает
  least-recently-served run;
- если ready run больше, чем slots, они вращаются на chunk boundaries.

Share не резервируется за run без work, с закрытым admission или под resource
guard. Capacity сразу передаётся способному её использовать run.

### 13.1 Canonical-head priority

Если run получил fair slot, scheduler сначала выбирает его eligible
canonical-head task, затем ordered lookahead, затем независимую работу run.

Head priority:

- не создаёт duplicate claim;
- не обходит owner fairness;
- не игнорирует `ready_at`, cooldown, circuit или чужой lease;
- даёт bounded wait, а не постоянный дополнительный slot.

### 13.2 Bounded scheduling chunks

Chunk заканчивается после текущей атомарной provider operation, когда достигнут
первый configured limit:

- provider pages или work units;
- wall time;
- response bytes;
- checkpoint bytes.

Текущий HTTP request не прерывается. После checkpoint task повторно конкурирует
за capacity.

### 13.3 Elastic repair reserve

В этой формуле `effectiveCapacity` означает доступную supply текущего resource
class после provider/runtime guards и до разделения между lanes. Для provider
work это `providerCapacityLimit`; demand в это значение не входит.

При ready repair work:

```text
repairMinimum = min(
  readyRepairTasks,
  repairMaxSlots,
  max(1, ceil(effectiveCapacity × repairShare))
)
```

Если repair work нет, reserve полностью заимствуется interactive lane.
Возврат происходит после ближайших chunk boundaries.

При capacity 1 используется weighted alternation: repair получает chunk не
позднее `repairMaxWaitChunks`, но не захватывает единственный slot постоянно.

Interactive и repair имеют отдельную owner→run max-min fairness. Background
использует только остаток, когда interactive и обязательный repair не могут
загрузить capacity.

## 14. Buffer и backpressure

Merge-buffer состоит только из planner entries в `ready`, но ещё не
`committed`. Durable `planned` backlog в buffer не входит.

Отдельно ограничиваются:

- ready entry count;
- ready `result_bytes`;
- durable `reserved_bytes`;
- execution-eligible task count;
- bounded prefix load/commit.

При acceptance reservation заменяется фактическим размером. Корректный
результат уже выполняющейся task не отбрасывается из-за soft buffer overflow.
Run помечается ограниченным, и новый non-head admission останавливается.

Soft overflow bounded числом уже leased tasks и hard manifest limit.

Если buffer run заполнен:

- его non-head refill/admission останавливается;
- eligible canonical head сохраняет приоритет;
- другие run продолжают использовать свободную capacity.

Coordinator не загружает весь buffer в process memory. Он читает только
bounded ready-prefix.

## 15. Retry, failure и reconciliation

- Retry, lease expiry и cooldown оставляют planner entry в `planned`.
- Successful acceptance переводит её в `ready`.
- Sequence не пропускается и не переиспользуется.
- Temporary unavailable head позволяет later tasks работать только до buffer
  limits.
- Exhausted head не обходится. Run переходит в существующее
  `WAITING_FOR_PROVIDER`, `BLOCKED_ADMIN` или `FAILED_TECHNICAL` по policy.
- Уже сохранённые artifacts остаются durable и могут быть reused.

Основной wake path событийный:

- ordered acceptance;
- committed prefix;
- provider capacity/health transition;
- buffer release;
- новый run.

Сохраняется редкий configurable reconciliation tick. Он продолжает durable
work после restart, потерянного wake-сигнала или временной process error:

- подбирает admitted/ready work;
- запускает available commit;
- повторяет deterministic refill после committed head.

Tick не ремонтирует противоречивые task/planner состояния, не реконструирует
ordering из JSON и не становится частым polling loop. `LISTEN/NOTIFY` в первой
версии не нужен.

## 16. Barrier fallback

Barrier использует те же:

- tasks;
- planner entries;
- accepted artifacts;
- planning function;
- commit function.

Меняется только admission policy.

При переключении `rolling → barrier`:

1. Новые rolling admissions прекращаются.
2. Ещё не leased tail entries de-admit.
3. Leased tasks заканчивают bounded chunk.
4. Дальнейшее выполнение использует barrier admission.

Separate legacy traversal algorithm не создаётся.

## 17. Минимальный observability contract

Observability best-effort и не участвует в correctness lifecycle. Ошибка Admin,
structured logging или metrics exporter не блокирует acceptance, checkpoint
или ordered commit.

### 17.1 Постоянные агрегированные метрики

- provider capacity limit, ready demand, target и actual active slots;
- healthy, cooldown и circuit-open group count;
- rolling one-minute RPS, total requests, errors и 429;
- runtime state и фактический limiting reason;
- process RSS/heap и available container/host memory;
- DB pool waiting count и DB latency;
- checkpoint latency;
- planner entries по merge-state;
- ready-buffer count/bytes и reserved bytes;
- canonical-head age;
- repair minimum, actual repair slots и `repairMaxWaitChunks` violations;
- reconciliation ticks, нашедшие actionable work.

### 17.2 Admin run snapshot по запросу

- opaque owner, lane и fair share;
- active slots и last-served time;
- lookahead target;
- durable backlog, admitted, leased, ready и committed;
- canonical-head task, state и age;
- buffer и reservations;
- последний bounded commit;
- текущая причина отсутствия progress;
- elapsed time, completed chunks и throughput.

High-cardinality owner/run data не экспортируются как постоянные metric labels.
ETA не показывается до появления подтверждённой benchmark-модели.

### 17.3 Структурированные события

Сохраняются только transitions и существенные anomalies:

- cooldown/circuit transition;
- resource pressure;
- soft overflow;
- hard manifest rejection;
- repair wait violation;
- reconciliation recovery;
- invariant violation;
- idempotent acceptance после неопределённого ответа.

Не создаётся durable DB row для каждого chunk, scheduler cycle или surplus
transfer. События имеют bounded retention и sampling.

### 17.4 Reason codes

Reason создаётся непосредственно controller/scheduler в момент решения и имеет
scope `pool`, `run` или `task`. Он не восстанавливается постфактум из gauges.
Если действует несколько guards, фиксируется тот, который остановил выбранное
действие.

Начальный набор:

- `no_eligible_work`;
- `fairness_wait`;
- `admission_closed`;
- `provider_rate_paced`;
- `provider_cooldown`;
- `provider_circuit_open`;
- `canonical_head_wait`;
- `merge_buffer_full`;
- `db_pressure`;
- `memory_pressure`;
- `class_capacity_limit`;
- `repair_reserve_reclaim`;
- `background_preempted`;
- `reconciliation_wait`.

`fairness_wait` и `background_preempted` являются run/task reasons, а не
объяснением общего idle pool.

## 18. Verification

### 18.1 Deterministic tests и provider replay

Replay симулирует logical capacity:

- 1;
- 4;
- 8;
- 16;
- 32;
- 100.

Он доказывает:

- capacity-independent sequence;
- owner→run fairness и repair reserve;
- bounded admission и buffer;
- restart/retry semantics;
- отсутствие conflict при большой logical capacity;
- распределение slots при достаточной eligible work.

Симуляция не доказывает реальный RPS или ускорение со ста API groups.

Property tests используют reproducible seeds. Seed любого падения печатается
в test output.

### 18.2 Correctness comparison

Oracle и rolling используют один frozen provider replay:

- одинаковый snapshot;
- одинаковые provider page artifacts;
- frozen time;
- deterministic identities;
- одинаковые policy/config versions.

Обязаны совпасть:

- canonical facts;
- конечный frontier;
- closure certificate;
- score и decision;
- evidence bundle hash;
- traversal closure hash;
- scoring bundle hash;
- report hash;
- eligible delivery intent count.

Randomized tests меняют completion order, retry, lease expiry, restart points,
lost wakes, cooldown, capacity, lookahead, buffer и concurrent run.

### 18.3 Transactional и schema tests

Проверяются:

- schema 033 → 034 на существующей DB;
- неизменный checksum 033;
- checksum и structural contract 034;
- constraints, foreign keys и indexes;
- atomic acceptance;
- idempotent retry после commit-before-response;
- kill после prefix commit и до refill;
- admission/de-admission crash points;
- restart без duplicate sequence или commit.

Использование индексов проверяется на representative benchmark dataset, а не
как обязательный PostgreSQL plan маленькой test table.

### 18.4 Scheduler cases

- Один ready run и 16 logical slots получает 16.
- Три run стремятся к 6/5/5.
- Ограниченная demand передаёт surplus.
- 15 run и 16 slots получают fair round и LRS surplus.
- Десять run одного owner не вытесняют один run другого owner.
- Новый interactive run получает progress на bounded chunk boundary.
- Full buffer одного run не останавливает остальные.
- Eligible canonical head получает приоритет.
- Repair reserve заимствуется и возвращается.
- Capacity 1 соблюдает `repairMaxWaitChunks`.
- Ramp-up ступенчатый, decrease немедленный.
- RPS pacing не смешивается с concurrency.

## 19. Benchmark

### 19.1 Текущий live gate

Live matrix ограничена реально доступной capacity:

- 1 independent key group;
- 4 independent key groups, только если конфигурационный аудит подтверждает,
  что четыре ключа принадлежат независимым quota groups.

Сценарии:

- один dense wallet;
- три dense wallets одновременно;
- новый interactive run во время тяжёлого traversal;
- slow canonical head;
- cooldown одной group;
- kill/restart;
- full buffer одного run;
- три последних реальных кошелька в isolated mode.

Пятнадцать concurrent run достаточно проверить на replay. Live-вариант
добавляется только при реальной operational необходимости.

Live runs в разное время не обязаны иметь одинаковые hashes: blockchain
history и provider responses могут измениться. Live canary проверяет
внутреннюю consistency, closure, отсутствие ошибок и performance.

### 19.2 Future scale gate

Реальные 8, 16, 32, 50 и 100 groups не входят в текущий rollout gate.

Перед повышением production limit выше уже проверенной capacity обязательны:

1. Реально добавленные independent groups.
2. Live canary на новом значении.
3. Memory/DB/provider saturation report.
4. Следующее ступенчатое повышение.

До этого разрешено утверждать, что architecture и replay поддерживают большую
capacity. Нельзя утверждать измеренное live ускорение на отсутствующих ключах.

### 19.3 Измерения

- wall time каждого run;
- aggregate throughput;
- provider capacity, demand и utilization;
- rolling RPS, requests, errors и 429;
- limiting reason;
- canonical-head age;
- ready-buffer и reserved bytes;
- DB latency и pool waiting;
- checkpoint latency;
- RSS/heap и available container/host memory;
- repair wait;
- cache/reuse;
- restart recovery;
- oracle equivalence на frozen replay.

### 19.4 Локальная память и WSL

Во время локального benchmark отдельно записываются:

- `vmmemWSL`;
- Linux available memory;
- swap;
- process RSS/heap;
- память до, во время и после одинакового прогона.

«70% Windows memory» само по себе не доказывает leak. Проблемой считается:

- устойчивый рост RSS/WSL между одинаковыми runs;
- отсутствие освобождения после завершения;
- систематическое уменьшение available memory;
- рост swap.

Перед production rollout performance и memory scenarios повторяются на
целевом Linux VPS или эквивалентном container/cgroup limit. Локальный WSL не
доказывает ёмкость сервера.

### 19.5 Критерий результата

Основной benchmark result:

- correctness совпадает с oracle;
- rolling уменьшает wall time или увеличивает throughput относительно frozen
  barrier baseline;
- memory и DB usage bounded;
- idle capacity объясняется фактическим limiting reason.

Десять минут остаются сравнительной отметкой, а не gate.

## 20. Rollout

1. Реализовать migration 034 и schema gates.
2. Пройти transactional, property и deterministic replay tests.
3. Проверить barrier oracle на frozen replay.
4. Включить rolling только для synthetic/isolated run.
5. Выполнить live gate на одной и четырёх доступных independent groups.
6. Повторить три последних wallets в isolated mode без Telegram delivery.
7. Ограниченно включить rolling для новых `user_check`.
8. Сделать adaptive rolling production default.

Старые активные run без planner entries автоматически не реконструируются.
Перед включением rolling они:

- завершаются старым path; либо
- generation дренируется.

Новые run после migration 034 используют planner.

Hot fallback внутри новой версии переключает только admission policy.

Binary rollback на версию до 034 не является горячим: generation закрывается,
новые claims прекращаются, active rolling run дренируются или блокируются, и
только затем запускается старый binary. Migration 034 не удаляется.

## 21. Переход к order-independent merge

Вторая фаза рассматривается только если benchmark показывает, что заметная
доля доступного slot-time теряется именно из-за:

- `canonical_head_wait`;
- `merge_buffer_full`;
- idle provider capacity при уже выполненной независимой работе.

Сначала loss измеряется. Затем отдельный design доказывает commutativity,
property invariants, retry и restart semantics. Поле `merge_class` добавляется
только вместе с этим отдельным изменением.

## 22. Acceptance criteria

- Migration 033 не изменена; migration 034 additive и fail-closed verified.
- Planner хранит ordering, admission, reservations и merge-state, но не
  дублирует accepted artifact identity.
- Acceptance task/attempt/planner-ready атомарна.
- Sequence append-only и capacity-independent.
- Ordered commit bounded по entries и bytes.
- Restart не создаёт duplicate sequence, commit или delivery.
- Один dense run может использовать весь свободный provider pool.
- Owner→run fairness не допускает starvation.
- Repair получает bounded progress и отдаёт reserve при отсутствии work.
- Buffer одного run не блокирует остальные.
- Provider capacity растёт динамически и не смешивает RPS с concurrency.
- Analysis/finalization не растут вместе с key pool автоматически.
- Observability best-effort и не блокирует correctness lifecycle.
- Frozen replay даёт identical canonical outputs и hashes.
- Live rollout ограничен реально проверенными одной и четырьмя groups.
- WSL используется как локальная диагностика, не как production capacity proof.

## 23. Не входит в первую реализацию

- Order-independent merge и `merge_class`.
- PID, machine learning или self-tuning controller.
- Throughput autotuning analysis/finalization.
- `LISTEN/NOTIFY`.
- Частый polling.
- Durable per-chunk или per-scheduler-cycle event table.
- User-visible ETA или percent complete.
- Пользовательский timeout либо partial score.
- Claim измеренного ускорения на 8–100 реальных groups до появления этих
  groups и live scale gate.
