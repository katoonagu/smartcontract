# Forensic Model Completion Roadmap And Exact Role Capture Design

**Статус:** утверждённый design; implementation plan и production activation
не разрешены этим документом

**Дата:** 2026-07-30

**Текущая ветка при проверке:**
`codex/forensic-offline-integration-20260730` на
`54df36f850da92fc141fe4c8fb4b18905cefa0a5`

## Результат

Новая forensic-модель завершается последовательностью независимых gated
поставок. Первая поставка получает exact economic-role evidence для одной уже
принятой реальной address history, материализует первую реальную role map
`200/200` и закрывает Stage C Task 2. Она не подключает Stage C к runtime.

Дальнейшие поставки отдельно подключают Stage C как disabled shadow, проводят
blind validation, создают authoritative cashflow input и минимальный selector,
подключают cashflow как disabled shadow и только затем готовят Stage D plan.

## Проверенная текущая truth

- Focused Stage C gate выполняется как service `24/24`, adverse `6/6`, с одним
  synthetic accepted-history reconstruction. Это accounting по объявленным
  evidence levels, а не blind accuracy.
- Cashflow ledger gate выполняется `7/7`. Реальный PacGy остаётся
  `unresolved / history_incomplete_before_anchor / authoritative:false`.
- Pure Stage C builder, typed offline gate и role-map materializer находятся в
  текущей integration-ветке.
- Для известной реальной accepted history выбраны точные окна `100 + 100`, но
  authoritative role coverage равен `0/200`; реальной role map нет.
- Stage C и cashflow не импортируются production runtime, не имеют enabled
  config и не влияют на traversal, score, report, Telegram или delivery.
- Готовый Stage C Task 2 proof находится незакоммиченным в worktree
  `stage-c-task2-proof-20260730`: два tracked и два untracked файла. Worktree
  нельзя удалять или очищать до переноса patch; untracked-файлы не защищены
  обычным `git diff`.
- Generic immutable Unified artifact storage существует, но cashflow-specific
  binding/lookup/cardinality API и non-interference proof отсутствуют.
- Accepted address history не доказывает `transactionIndex`, opening balance и
  independent pinned USDT balance. Поэтому она сама по себе не является
  authoritative cashflow tape.
- Полный claim `5,241` tests в переданном контексте этим design-аудитом не
  воспроизводился; focused Stage C и ledger gates были воспроизведены.

## Master roadmap

Каждый пункт после первого получает собственные design, implementation plan,
verification receipt и human approval. Провал gate не открывает следующий
пункт автоматически.

1. **Real Stage C evidence admission.** Exact capture для одной frozen accepted
   history, role map `200/200`, перенос Task 2 proof и prerequisite audit
   `exit 0`.
2. **Stage C runtime shadow.** Оставшиеся Tasks 3–5 существующего плана:
   strict disabled-by-default policy, один profile на state/anchor, standalone
   storage и полная byte non-interference.
3. **Frozen blind validation.** Новый непересекающийся набор, pre-registered
   evidence/criteria, два reviewer-а и отдельный adjudicator без изменения
   thresholds после раскрытия результата.
4. **Cashflow authority acquisition.** Production-owned producer возвращает
   canonical tape либо typed unavailable после проверки identity, order,
   history/opening, balance и economic roles.
5. **Cashflow Query Selector v1.** Первая версия выбирает только
   `current_balance`; Incoming сохраняет собственный exact-deposit contract,
   а `amount_only` не угадывается по сумме.
6. **Cashflow runtime shadow.** Strict disabled policy, отдельный immutable
   run/query-bound artifact, byte non-interference и реальные complete плюс
   unresolved controls.
7. **Stage D plan.** Отдельный disabled `snapshot-closure-v3` plan только после
   принятого blind review, exact physical-page authority, `EOAAtAnchor`,
   complete adverse receipt и Stage C non-interference.
8. **Knowledge conformance.** После каждой поставки обновляется соответствующая
   product truth; в конце проводится полная code/receipt/knowledge сверка.

Stage B concurrency 2, Deep concurrency, score, Telegram, rollout, activation,
bounded subject-service mode и `500 + 100` не входят в эту последовательность.
`500 + 100` возвращается только после отдельного frozen ambiguous fixture.

## Первая поставка: цель и граница

Первая поставка заканчивается следующей цепочкой:

```text
frozen accepted history
  -> bounded operator capture
  -> immutable raw transaction-info
  -> exact three-dimension dispositions
  -> completed capture receipt
  -> existing role-map materializer
  -> real map 200/200
  -> preserved Task 2 proof
  -> prerequisite audit exit 0
```

В поставку входят operator CLI, pure capture validation/disposition logic,
reusable raw evidence persistence, complete-only disposition/receipt
persistence, обязательная связь completed receipt с materializer и перенос
готового proof после появления map.

Не входят production config/runtime/coordinator hook, новый job/queue,
migration, новые address-history или neighbor calls, Admin, scoring, report,
Telegram, delivery, Stage C Tasks 3–5, blind set, cashflow и Stage D.

## Frozen source

Первая попытка фиксирует только следующий уже проверенный источник:

```text
runId:   5417cbf6-7cef-4b91-8367-d266eaf3857e
manifest: 08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0
anchor:  2026-06-04T09:20:33.000Z
```

До provider calls read-only preflight обязан снова доказать accepted-attempt
authority, manifest/page hashes, exact anchor, 100 recent и 100 historical
unique canonical events, seven-day separation и нужную poisoning comparison
coverage.

Если preflight не проходит, provider calls не выполняются. Если после обычной
scheduler policy часть transaction-info остаётся недоступной, этот capture
заканчивается unresolved. Другой manifest выбирается отдельным новым frozen
selection receipt; CLI не переключается на него автоматически.

## Архитектура capture

### Operator CLI

Один bounded CLI имеет два режима:

```text
audit   --run <uuid> --manifest <sha256> --anchor <ISO timestamp>
capture --confirm --run <uuid> --manifest <sha256> --anchor <ISO timestamp>
```

`audit` работает в read-only transaction, не вызывает provider и печатает
canonical preflight receipt. `capture --confirm` сначала сохраняет immutable
capture manifest, затем запрашивает только отсутствующие transaction-info и
при полном наборе публикует dispositions/receipt.

CLI переиспользует существующие Tron client, central scheduler и transaction
evidence repository. Он не добавляет собственный retry loop, sleep, key pool,
rate limiter или provider-capacity class.

За один запуск выполняется не более одного logical transaction-info request на
каждый отсутствующий unique tx hash. Scheduler владеет retries, key rotation,
cooldown и pacing. Повторный запуск переиспользует сохранённые evidence и
запрашивает только unresolved tx.

### Capture manifest

`service-role-exact-evidence-capture-manifest-v1` связывает:

- capture schema/policy/parser versions;
- run ID, snapshot block/hash и profiled address;
- address-history manifest key/hash и sorted page artifact hashes;
- traversal state ID, exact anchor и source event IDs;
- ровно 100 recent и 100 historical canonical event IDs;
- для каждого события tx hash, block, timestamp, direction, from/to, amount,
  event identity и canonical event-body hash;
- разрешённый provider endpoint `transaction-info`.

Manifest content-addressed и создаётся до первого provider call. Run, source
или event set после этого не меняются. API keys, account names и secrets в
manifest не входят.

### Raw transaction evidence

Events группируются по normalized tx hash; один transaction-info может
обслуживать несколько events только после отдельной exact movement binding
для каждого event.

До сохранения ответ обязан иметь:

- matching full transaction hash;
- confirmed successful finality;
- поддерживаемую transaction-info schema;
- явный boolean `riskTransaction`;
- canonical payload hash и finality witness hash.

TronScan документирует `riskTransaction` как required boolean для
`transaction-info`:
`https://docs.tronscan.org/en/api/transactions-and-transfers/transaction-info`.

Ответ с missing/unknown required field не сохраняется как permanent capture
evidence. Уже существующая immutable transaction evidence переиспользуется
только после того же capture validation. Insufficient или conflicting legacy
evidence не переписывается и останавливает capture до отдельного versioned
evidence решения.

Каждый валидный raw response сохраняется сразу через существующий repository.
Это единственный incremental side effect после manifest и делает capture
возобновляемым.

## Exact disposition contract

Каждый из 200 canonical events получает три независимых disposition.

### GasFree

Источник — только hash-validated transaction-info и существующий strict parser.

Допустимы:

- `exact_settlement` с exact event binding, settlement hash и movement role
  `principal | fee`;
- `not_gasfree` только для доказанного controller/selector negative;
- `unresolved` для invalid/ambiguous registered payload, отсутствующего
  one-to-one movement match или multi-log ambiguity.

GasFree disposition хранится внутри completed capture receipt. Отдельные 200
GasFree artifact rows не создаются. Materializer повторно запускает parser и
сверяет disposition с raw evidence.

### Poisoning

Используется только существующая `address-poisoning-v1` policy.

Для incoming event в profiled address требуется complete local comparison
interval за предыдущие 24 часа. Interval строится из hash-verified accepted
pages. Evidence связывает bounds, page hashes, canonical comparison inventory
hash и policy version. Events с тем же timestamp допускаются только при exact
order до incoming; иначе negative authority отсутствует.

Исходящее событие может получить exact structural negative
`not_incoming_to_profiled_address`. Для применимого входа `candidate` даёт
`poisoning_only`, complete clear даёт `not_poisoning`, а partial coverage,
identity/order ambiguity или неполный interval дают `unresolved`.

### Provider risk

Источник — явный `riskTransaction` из того же hash-validated transaction-info.
Accepted address-history page является только corroboration: текущая
нормализация не сохраняет различие между отсутствующим значением и явным
`false`.

- `riskTransaction=true` даёт event-level `provider_risk` только когда exact
  source дополнительно доказывает, что canonical event является единственным
  подходящим official-USDT movement в tx, либо уже существует отдельная точная
  event-specific binding; transaction-level positive для multi-event tx иначе
  остаётся `unresolved`;
- `riskTransaction=false` даёт только `not_provider_risk`;
- missing, non-boolean, hash/schema conflict дают `unresolved`.

`not_provider_risk` не доказывает clean, safe или ordinary само по себе.

### Role composition

Role создаётся только после разрешения всех трёх dimensions:

- три exact negative дают `ordinary`;
- ровно один exact positive даёт соответствующую роль;
- два positive, missing binding, invalid source или любой unresolved дают
  missing/conflict, а не role.

Ни page hash, ни `riskTransaction=false`, ни отсутствие database row, ни null
GasFree parser не default-ятся в `ordinary`.

## Persistence and completion

Неполный запуск сохраняет только capture manifest и валидные raw transaction
evidence. CLI печатает deterministic
`service-role-exact-evidence-capture-coverage-v1` и выходит `2`.

Только при полном наборе одна PostgreSQL transaction:

1. повторно загружает и проверяет source/evidence under lock;
2. сохраняет 200 `service_role_poisoning_disposition` artifacts;
3. сохраняет 200 `service_role_provider_risk_disposition` artifacts;
4. сохраняет один
   `service_role_exact_evidence_capture` completed receipt.

Completed receipt содержит sorted 200 event entries, три dispositions, raw
transaction evidence IDs, payload/finality/source hashes и disposition hashes.
Все artifacts content-addressed, created by the bound run, immutable,
idempotent и не referenced by accepted attempts.

Existing materializer получает дополнительный hard prerequisite: ровно один
hash-valid completed capture receipt для run/manifest/sample. Он проверяет,
что каждое transaction evidence и каждый disposition hash входит в receipt,
повторяет GasFree/event binding и лишь затем создаёт существующие evidence
bundle и role map.

Повторный capture или materialize создаёт те же hashes и не добавляет строки.
Conflicting existing artifact откатывает complete transaction.

## Error semantics

CLI exits:

- `0`: completed capture receipt существует и повторно проверен;
- `2`: честная неполнота, provider data пока недоступны или disposition
  unresolved;
- `1`: invalid arguments, corrupt source, hash/binding conflict,
  contradictory finality, unsupported schema или immutable artifact conflict.

Provider wait/429/retry остаются scheduler semantics. Capture не ждёт tx
бесконечно и не добавляет собственные повторы поверх scheduler.

Process interruption безопасно оставляет только manifest и reusable raw
evidence. Partial dispositions, bundle, map или accepted result не появляются.

## Role map and Task 2 closure

После completed capture:

1. materializer audit обязан вернуть `sampledEventCount=200`,
   `fullyAuthorizedEventCount=200`, `missing=[]`, `conflicts=[]`;
2. `materialize --confirm` создаёт один evidence bundle и одну role map;
3. повторный запуск возвращает те же hashes и не создаёт duplicate rows;
4. готовый four-file Task 2 patch переносится из
   `stage-c-task2-proof-20260730` только после проверки текущих file/diff
   hashes и отсутствия неожиданного overlap;
5. PostgreSQL storage/finalizer tests выполняются без skip;
6. prerequisite audit возвращает `exit 0` и как минимум одну
   `fullyRoleBoundHistory`;
7. только после green audit proof коммитится; исходный dirty worktree не
   удаляется до принятого commit.

Главный dirty integration worktree не очищается и не bulk-stage-ится. Каждый
commit использует точный allowlist файлов.

## Verification

### Pure tests

- exact manifest/source/anchor/window validation and tamper rejection;
- exactly 200 unique event IDs and input-order determinism;
- explicit provider-risk false/true, missing field and wrong schema/hash;
- transaction-level provider-risk positive in a multi-event tx remains
  unresolved without event-specific binding;
- GasFree principal, fee, exact negative, ambiguous payload and multi-log
  mismatch;
- poisoning positive, complete negative, structural negative, partial
  24-hour coverage and same-time order ambiguity;
- ordinary only after three negative; positive conflict and `199/200` fail
  closed.

### Scheduler and repository tests

- `audit` makes zero network and write calls;
- provider tape contains only transaction-info for missing unique tx hashes;
- second run makes no call for already valid evidence;
- missing required fields are not persisted as permanent capture evidence;
- partial capture writes raw evidence only;
- complete finalize is atomic, immutable and idempotent;
- conflict rolls back every complete-only artifact.

### PostgreSQL and integration tests

- completed receipt is required and source-bound by materializer;
- exact `200/200` creates one bundle and one map;
- standalone artifacts remain unreferenced by attempts;
- finalizer authoritative bytes are identical with and without standalone
  capture/map artifacts;
- transplanted Task 2 prerequisite audit returns `0` on the real map.

Focused tests, PostgreSQL tests without skips, typecheck, full suite and
`git diff --check` are mandatory. A skipped PostgreSQL file is not a pass.

## First-delivery acceptance gate

```text
sampled events                 = 200
fully authorized events        = 200
missing/conflicts               = []
completed capture receipt       = exactly 1
evidence bundle                 = exactly 1
service role map                = exactly 1
fullyRoleBoundHistories         >= 1
prerequisite audit exit         = 0
repeat-run hashes               = identical
production runtime/config diff  = none
```

Evidence packet содержит capture manifest/coverage/completed receipt hashes,
raw evidence IDs/hashes, disposition hashes, provider logical-request summary,
bundle/map hashes, idempotency proof и точные test commands/results. API keys,
provider account identity и secrets не публикуются.

После green gate knowledge `02/03/04/09/14` обновляются по фактическому коду и
data coverage. `10-open-problems` меняется только при оставшемся recurring gap.

## Later-delivery gates

### Stage C runtime shadow

- unset means `disabled`; единственное enabled value versioned;
- один standalone profile на каждый state/anchor, без cross-anchor dedupe;
- local role-map lookup only, no provider calls;
- hook timeout, malformed map, persistence или observer error не меняют
  authoritative work и не блокируют следующие states;
- provider tape, frontier, terminals, accepted tasks, planner, score, final
  hashes, report, presentation, Telegram payload, delivery и Admin DAG
  совпадают с disabled bytes.

### Frozen blind validation

- address list, source hashes, snapshot, exclusions и pass/fail criteria
  заморожены до model execution;
- calibration, CSV analysis и regression subjects исключены;
- blind evidence использует exact frozen page/role/adverse authority, а не
  accepted-history reconstruction с `boundaryPageAuthority=false`;
- два independent reviews и отдельная adjudication;
- rejected blind set не становится новым calibration set для той же версии.

### Cashflow authority and selector

Producer обязан доказать canonical receipt/log identity, transaction order,
complete interval/opening authority, independent pinned balance и event-level
economic roles. Отсутствие любой authority возвращает typed unavailable.

Selector v1 создаёт только `current_balance`. Он не извлекает данные из report,
Telegram или risk result и не подменяет unavailable legacy approximation.
Production shadow начинается только после реального authoritative complete
case и отдельного unresolved control.

### Stage D

Implementation plan не пишется до accepted blind review, exact physical-page
authority, `EOAAtAnchor`, complete adverse receipt и доказанной Stage C
non-interference. Stage D остаётся disabled-by-default отдельной V3 policy и не
активируется этим roadmap.

## Hard aborts

- Source, anchor, event set или page hashes нельзя доказать до provider calls.
- Poisoning comparison interval incomplete для любого применимого event.
- Transaction-info не содержит matching hash, successful finality или explicit
  `riskTransaction`.
- GasFree settlement нельзя one-to-one связать с canonical event.
- Любой event имеет unresolved dimension или более одной positive role.
- Completed receipt, bundle или map предлагается при `199/200`.
- Capture пытается вызвать address history, account, neighbor, graph или новый
  provider endpoint.
- Нужны production runtime/config/job/migration changes для первой поставки.
- Task 2 patch изменился или был потерян до проверенного переноса.
- PostgreSQL proof skipped, prerequisite audit не `0` или повторный запуск
  меняет hashes.

При любом abort сохраняются только уже валидные immutable raw evidence и
честный coverage receipt. Пропуски не заполняются synthetic ordinary roles.
