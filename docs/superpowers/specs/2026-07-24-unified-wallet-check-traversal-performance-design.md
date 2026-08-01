# Unified Wallet Check Traversal Performance Design

**Дата:** 2026-07-24
**Статус:** final approved design, implementation pending
**Область:** Unified Wallet Check, TronScan provider/indexing, traversal,
Admin observability
**Базовый commit:** `eab7dadca84744e4e83bc6588ae8b4f27256935e`

## 1. Цель

Ускорить доказательно полный Unified Wallet Check на плотных TRON USDT
кошельках без временных или coverage-ограничений, частичного score и изменения
пользовательского контракта.

Работа разделена на три связанных, но независимо проверяемых этапа:

1. **P0 — механическое ускорение:** те же frozen inputs создают те же факты,
   score, decision, hashes и Telegram presentation.
2. **P1 — доказательное уменьшение графа:** traversal завершается на
   подтверждённых экономических и сервисных границах. Изменение forensic closure
   принимается только через отдельные Golden-кейсы.
3. **P2 — наблюдаемость:** Admin объясняет фактический прогресс и причины долгой
   работы, не показывая внутренние временные ориентиры пользователю.

Время выполнения является результатом измерения, а не частью продуктовой
логики. В дизайне нет заранее заданного SLO, timeout или performance release
gate. Внутренние ориентиры определяются после одинакового frozen
before/after-сравнения.

## 2. Неизменяемый пользовательский контракт

- Проверка выполняется до доказательного завершения.
- Fast, Where и Deep остаются evidence-only children и не отправляют отдельных
  Telegram-результатов.
- После `COMPLETED` пользователь получает одно итоговое сообщение с одним
  score.
- Coverage остаётся audit metadata, не блокирует score и не добавляет риск.
- Временная недоступность provider переводит работу в
  `WAITING_FOR_PROVIDER`.
- Настоящая техническая ошибка даёт `FAILED_TECHNICAL`, а не risk decision,
  score или частичный отчёт.
- Время, глубина, число страниц, размер frontier и отсутствие label не являются
  terminal boundary.
- В Telegram не показываются внутренние SLO, estimated time или benchmark
  targets.

## 3. Проверенные причины текущей задержки

Текущий код выдаёт одну `direct_history` или `traversal` task за один
`runProviderCycle()`. В runtime работают два interval-driven schedule item,
которые вызывают один и тот же cycle. Четыре настроенных TronScan-ключа
равномерно используются scheduler-ом, но один плотный кошелёк почти всегда
создаёт только один claimable traversal task, поэтому ключи не работают над ним
параллельно.

Каждый traversal lease читает только одну provider page:

```text
productionTraversal
  → runDirectHistoryChunk(maxPagesThisChunk = 1)
  → до 50 provider rows
  → полный JSONB checkpoint
  → новый queue wait
```

State identity включает `address + direction + anchorTimestamp +
fundingEpisodeId`. Поэтому одинаковая история адреса повторно проигрывается для
разных funding episodes. Provider cache может убрать повторный HTTP-запрос, но
не убирает task claims, чтение artifacts, JSONB rewrites и queue wait.

Checkpoint копирует растущие `frontier`, `visitedStates`, `terminals`, page hash
lists и `attemptTimings`. На измеренных dense runs checkpoint достигал примерно
0.8–1.1 MB, а повторные JSONB updates раздували TOAST и замедляли PostgreSQL.

Наконец, canary label dataset содержал только две узкие метки. Поэтому
практически ни один известный CEX/DEX/bridge/contract не становился
доказательной границей, и traversal шёл к account creation.

## 4. Рассмотренные подходы

### 4.1 Только увеличить chunk и уменьшить poll interval

Минимальное изменение, но оно не устраняет повторное чтение истории, один
traversal task на кошелёк, растущий checkpoint и отсутствие доказательных
границ. Ожидаемое ускорение ограничено, а PostgreSQL продолжит деградировать.

**Решение:** отклонено как самостоятельный фикс. Larger chunk остаётся одной из
частей P0.

### 4.2 Address-centric pipeline поверх существующего Unified runtime

История адреса становится отдельным snapshot-bound immutable artifact,
funding episodes применяют свои attribution filters к одной истории, provider
работает event-driven pool-ом, а компактный coordinator checkpoint ссылается на
artifacts и отдельные address-history tasks.

Подход сохраняет существующие manifests, canonical facts, scoring и delivery,
но исправляет фактические bottlenecks без полной замены Unified architecture.

**Решение:** выбран.

### 4.3 Полная замена traversal внешним graph engine

Может дать развитое распределённое выполнение, но требует нового runtime,
нового operational model и повторного доказательства почти всех Unified
контрактов. Для четырёх ключей и текущего масштаба это преждевременная
архитектура.

**Решение:** отклонено по YAGNI.

## 5. Общая архитектура

```text
CheckRequest
  → confirmed snapshot + frozen labels
  → direct history
  ├─→ Fast + direct hard evidence
  └─→ TraversalCoordinator
       → deduplicated AddressHistoryTask(address A) ┐
       → deduplicated AddressHistoryTask(address B) ├─ four-slot provider pool
       → deduplicated AddressHistoryTask(address C) ┘
       → immutable AddressHistoryManifest per address
       → deterministic episode attribution
       → terminal evidence / next frontier
  → remaining Where + Deep evidence children
  → parent reconciliation + score + report
  → one Telegram delivery
```

Coordinator отвечает за deterministic frontier, attribution и closure.
Address-history task отвечает только за полное snapshot-bound получение одной
USDT-истории. Это разделение даёт параллельность и не смешивает provider fetch с
forensic interpretation.

Fast и та часть direct hard evidence, которой достаточно direct history, не
ждут traversal. Они запускаются параллельно с ним, сохраняют evidence-only
artifacts и не получают delivery authority. Parent finalizer по-прежнему ждёт
все обязательные children и отправляет только один итоговый результат.

## 6. P0 — ускорение без изменения forensic-смысла

### 6.1 AddressHistoryManifest

Канонический ключ:

```text
chain
+ snapshotHash
+ tokenContract
+ normalizedAddress
+ providerRequestVersion
```

`AddressHistoryManifestV1` является immutable content-addressed result и
содержит:

- нормализованный address;
- snapshot identity;
- token contract;
- ordered immutable page artifact hashes;
- canonical event inventory hash;
- provider exhaustion/account-creation proof;
- raw row count, canonical event count и duplicate count;
- manifest hash.

Manifest не содержит funding episode, direction или allocated amount. Одна и та
же история переиспользуется всеми эпизодами текущего snapshot. Existing
provider-request coalescing остаётся нижним уровнем защиты от одинакового
network fetch; manifest убирает повторную работу уже на уровне traversal.

История не считается полной из-за одного cache hit. Reuse разрешён только для
manifest с тем же snapshot, token, address, provider request version и
валидированным exhaustion proof.

### 6.2 Address-centric attribution

Traversal coordinator группирует ready states по:

```text
normalizedAddress + direction
```

После загрузки manifest он один раз читает canonical events и применяет к ним
каждый funding episode с его собственными:

- anchor timestamp;
- allocated amount;
- source event IDs;
- attribution policy, закреплённой в analysis manifest;
- direction.

Результаты снова переводятся в существующие canonical states. Amount
conservation, source lineage и роли не теряются. История загружается один раз,
но эпизоды не сливаются в одну сумму.

Текущая locked policy — `proportional`, но P0 не выбирает её заново и не
переводит все внутренние операции в новую модель. Он исполняет exact version и
policy hash из analysis manifest. P0 не меняет eligibility predicate,
attribution policy, terminal predicates, canonical fact keys, score matrix или
presentation.

### 6.3 Отдельные address-history tasks

Вместо одного активного history внутри traversal checkpoint coordinator создаёт
deduplicated child tasks для разных frontier-адресов.

Task identity:

```text
runId + addressHistoryManifestKey
```

Одинаковый key создаёт не более одной логической task. Task row имеет обычный
mutable lifecycle (`QUEUED`, `LEASED`, `WAITING_RETRY`, terminal state).
Immutable являются её child attempts, provider/page artifacts и принятый
`AddressHistoryManifest`, а не сама task row. Несколько traversal states ждут
один result. Task lifecycle использует существующие состояния и lease fencing:

- provider cooldown/rate limit → `WAITING_FOR_PROVIDER`;
- recoverable lease loss → новая immutable attempt, не перезапись старой;
- provider contradiction, invalid page identity или исчерпанные технические
  retries → `FAILED_TECHNICAL`;
- только validated exhaustion → completed manifest.

Coordinator не завершает run, пока все требуемые address histories и
атрибуции не terminal.

### 6.4 Event-driven provider pool

Unified provider runner получает configurable concurrency, по умолчанию равную
числу независимых provider key groups и ограниченную безопасным верхним
пределом. Для текущей конфигурации создаются четыре worker slots.

Каждый slot выполняет цикл:

1. claim;
2. provider work;
3. checkpoint/complete/wait;
4. немедленный следующий claim, пока работа доступна;
5. wake по enqueue/ready-at либо короткий idle backoff, если очередь пуста.

Interval остаётся safety wake-up, а не pacing mechanism. Pool не создаёт больше
in-flight provider calls, чем разрешают scheduler и key/group cooldown.

Один slot никогда не обходит lease fencing, cancellation, heartbeat,
provider-call measurement или fair scheduling.

Fairness действует на двух уровнях:

- scheduler сохраняет per-key/per-group pacing и cooldown;
- dispatcher делает weighted round-robin по interactive runs, а не исчерпывает
  весь frontier одного run до перехода к следующему.

Один dense wallet может занять до четырёх slots только если нет ready work
других interactive runs. При конкуренции каждый active interactive run
получает возможность progress до выдачи дополнительных slots уже
обслуженному run. Background/repair lanes не вытесняют interactive checks, а
старый heavy run не может вызвать starvation новой пользовательской проверки.

### 6.5 Logical chunks

Физический TronScan subrequest остаётся ограничен provider-лимитом. Один task
lease может последовательно собрать 200–500 canonical events из нескольких
subrequests, сохраняя heartbeat и cancellation checks между subrequests.

Checkpoint выполняется при первом наступившем условии:

- logical chunk заполнен;
- history exhausted;
- provider wait;
- cancellation;
- lease nearing expiry;
- доказанная page inconsistency/error.

Chunk size — operational tuning, не coverage или traversal limit. Он не меняет
итоговый event inventory.

### 6.6 Компактный checkpoint и delta artifacts

Coordinator checkpoint хранит:

- version и manifest bindings;
- head hashes append-only frontier/visited/terminal delta chains;
- pending/completed address-history keys;
- aggregate counters;
- last progress timestamp;
- только bounded recent diagnostics.

Checkpoint не материализует и не сохраняет новую полную копию растущих
frontier/visited/terminal collections. Каждая обработанная logical chunk
создаёт маленький immutable `TraversalDeltaArtifactV1`:

```text
previousDeltaHash
+ addedFrontier
+ removedFrontierStateIds
+ addedVisited
+ addedTerminals
+ addedSupersededStateIds
+ counterDeltas
```

Периодический compaction artifact разрешён только как отдельный
content-addressed snapshot с hash предыдущей delta chain. Он создаётся редко,
не при каждом provider page, и не меняет canonical replay. Coordinator
checkpoint хранит только chain heads и bounded working set.

Unbounded `attemptTimings` удаляется из JSONB checkpoint; timings записываются
как bounded counters/histograms либо append-only operational samples.

Один update не переписывает историю всех предыдущих attempts. Размер
coordinator checkpoint измеряется и должен оставаться bounded относительно
числа provider pages. Конкретный alert threshold определяется по benchmark, а
не становится условием completion.

### 6.7 P0 instrumentation

Минимальная измерительная плоскость реализуется вместе с P0, до Admin P2. Она
нужна, чтобы доказать эффект оптимизации и не смешивается с пользовательской
проекцией:

- provider calls, network fetches, cache hits и manifest reuses;
- active/max provider in-flight и slot utilization;
- key-group distribution;
- logical chunks, task claims и checkpoints;
- replayed/avoided address histories;
- delta/checkpoint bytes и DB writes;
- unique addresses, funding episodes и frontier peak;
- monotonic timestamps фаз.

P0 instrumentation доступна benchmark harness и structured logs. Она не
влияет на hashes анализа и не обязана иметь Admin UI до P2.

### 6.8 P0 invariants

Для одного frozen input до и после P0 должны совпадать:

- canonical event inventory;
- traversal terminals и причины;
- closure certificate;
- coverage metadata;
- Fast/Where/Deep canonical facts;
- score, decision и score anchor;
- report hash;
- RU/EN presentation hashes и Telegram text;
- delivery intent count.

Дополнительно:

- duplicate или reordered task completion не меняет результат;
- restart посередине address history даёт тот же manifest;
- один address/snapshot не сканируется повторно из-за разных episodes;
- четыре provider slots реально могут обслуживать один dense wallet;
- один provider wait не блокирует остальные ready histories.
- dense run не вызывает starvation параллельного interactive run;
- ранний Fast/direct hard evidence artifact не создаёт ранний score или
  отдельную delivery.

### 6.9 Versioned checkpoint rollout

Новый coordinator использует
`unified-production-traversal-checkpoint-v2`. Старый V1 checkpoint нельзя
неявно интерпретировать как V2.

Rollout contract:

- новый run сразу создаёт V2 delta-chain checkpoint;
- terminal V1 run остаётся историческим и не переписывается;
- активный V1 run проходит deterministic one-time upgrader, который валидирует
  manifest bindings, материализует один initial compaction artifact и causal
  write-ом заменяет checkpoint на V2;
- upgrade создаёт immutable migration artifact с source checkpoint hash,
  target checkpoint hash и upgrader version;
- повтор upgrade идемпотентен;
- невалидный/неполный V1 checkpoint остаётся `FAILED_TECHNICAL` или
  `BLOCKED_ADMIN` по существующей recoverability policy, но не перезапускается
  с нуля и не получает score;
- rollout fence не допускает одновременную запись V1 и V2 worker-ами в одну
  task.

V1/V2 restart и mixed-queue behavior имеют отдельные PostgreSQL targeted tests.

## 7. P1 — доказательное уменьшение графа

P1 начинается только после подтверждения P0-equivalence. Он может изменить
terminal facts и closure, поэтому его результаты не сравниваются с P0 как
byte-identical. Вместо этого они проходят отдельную Golden adjudication.

### 7.1 Полноценный frozen label dataset

До traversal run получает content-addressed label snapshot с provenance:

- CEX catalog: Binance, Bybit, OKX, WhiteBIT, Coinbase, Kraken, KuCoin,
  Bitget, MEXC, Bitstamp, Crypto.com и HTX/Huobi с отдельной temporal sanctions
  semantics;
- TRON DEX/router catalog: SunSwap/SUN, verified router/aggregator entries из
  `serviceRouteRegistry`;
- bridge catalog: Allbridge/Allbridge LP, Bridgers и другие verified
  cross-chain/bridge-registry entries;
- protocol catalog: USDD PSM/GemJoin, включая exact reserve
  `TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ`, и verified stablecoin protocol entries;
- registered service endpoints: GasFree Controller
  `TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U`, TronLink GasFree provider
  `TLntW9Z59LYY5KEi9cmwk3PKjQga828ird`;
- approval/action registry: Bridgers spender
  `TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s`;
- contracts с доказанной economic role из verified metadata/profile и
  versioned route registry;
- restrictions и risk labels с validity interval;
- authority, source, observed/frozen timestamps и confidence.

Это минимальный supported catalog V1. Наличие имени в каталоге не создаёт
адресную метку автоматически: каждый address binding требует exact registry
entry либо verified provider metadata с provenance. Простое keyword match без
address/evidence binding остаётся hint и не становится terminal boundary.
Расширение каталога меняет `labelCatalogVersion` и dataset hash.

Dynamic enrichment, если используется, завершается до freeze. Traversal читает
только закреплённый dataset hash. Live metadata не может незаметно изменить
уже начатый run.

Label сам по себе не всегда terminal. Predicate учитывает роль, направление,
route continuity и validity at event time.

### 7.2 Boundary predicates

Каждая граница создаёт versioned canonical evidence artifact. Разрешены:

- `identified_service_boundary` — подтверждённый custodial/service endpoint,
  после которого on-chain attribution теряет пользовательский смысл;
- `shared_liquidity_boundary` — доказанный pooled-liquidity endpoint, где
  конкретные входы смешиваются и индивидуальное продолжение нельзя обосновать;
- `contract_economic_boundary` — контракт и economic role доказаны, а
  дальнейшее движение относится к внутренней механике протокола;
- `policy_or_restriction_boundary` — существующая доказательная
  policy/restriction семантика;
- `unidentified_structural_boundary` — только versioned structural evidence,
  доказывающее смешивание/потерю индивидуальной атрибуции.

Не являются границей:

- отсутствие label;
- большой frontier;
- высокий fan-in сам по себе;
- число страниц, depth, elapsed time или queue pressure;
- обычный collector без доказательства pooled ownership;
- DEX/router, если route доказательно продолжается;
- contract metadata без economic role.

`unidentified_structural_boundary` нельзя включить только по эвристике размера.
До Golden adjudication predicate остаётся выключенным либо применяется только к
synthetic cases с доказанным structural proof.

### 7.3 Golden-контракт P1

Для каждого boundary case фиксируются:

- evidence input и provenance;
- expected terminal/non-terminal decision;
- expected direction и temporal validity;
- amount conservation;
- direct/indirect semantics;
- допустимые отношения score, но exact score только если boundary создаёт
  scoring evidence и прошёл adjudication.

До P1 adjudication фиксируются expected terminal decisions, score properties и
отношения между кейсами. Exact expected scores и обновлённые locked comparator
artifacts создаются только после blind review/adjudication. Production code не
назначает новые exact значения сам и не обновляет Golden package из live runs.

Обязательные отрицательные кейсы:

- unknown high-volume wallet не становится boundary;
- collector не становится shared liquidity;
- later label не применяется к прошлому event;
- DEX route с доказанным continuation продолжается;
- safe service context не снижает hard-evidence floor.

P1 не вводит coverage или time gate и не меняет правило одного финального
сообщения.

## 8. P2 — Admin observability

Admin получает read-only progress projection:

- provider slots: configured, active, idle, cooling down;
- requests/sec суммарно и по key group;
- network fetch, provider-cache hit и address-manifest reuse;
- unique addresses, funding episodes и replay avoided;
- frontier ready/waiting/in-progress/completed;
- frontier growth rate;
- canonical events и logical chunks processed;
- coordinator checkpoint bytes и artifact bytes;
- DB write count/bytes для task/checkpoint path;
- exact discovered outstanding address histories;
- undiscovered remainder как monotonic lower-bound/range только при
  продолжающемся frontier expansion;
- текущая причина отсутствия score:
  `direct_history`, `traversal_fetch`, `traversal_attribution`,
  `provider_wait`, `branch_analysis`, `finalization` или technical failure.

Метрики не влияют на lifecycle, score, boundary или delivery. Admin явно
разделяет `discovered remaining` и `lower bound while expanding`; он не
показывает это как точное общее число, процент завершения или ETA. Remaining
work — диагностическая проекция, не completion contract.

Telegram не получает эти operational details.

## 9. Ошибки и восстановление

- Provider 429/cooldown/temporary outage сохраняет cursor и переводит только
  затронутые tasks в `WAITING_FOR_PROVIDER`; другие slots продолжают ready work.
- Invalid/contradictory provider page не превращается в exhaustion proof.
- Crash после immutable artifact, но до checkpoint, безопасен: повторная attempt
  переиспользует artifact по hash и идемпотентно завершает causal write.
- Crash после checkpoint не создаёт duplicate address-history task.
- Coordinator обнаруживает missing/corrupt artifact до expansion и завершает
  run как `FAILED_TECHNICAL`, без score.
- Cancellation проверяется между provider subrequests и перед causal writes.
- Ambiguous Telegram effect остаётся `DELIVERY_UNKNOWN`; performance changes не
  меняют delivery retry policy.

## 10. Реализационные этапы и dependency DAG

```text
P0 baseline capture
  → AddressHistoryManifest
  → delta-chain coordinator checkpoint + V1→V2 upgrader
  → address-history child tasks
  → event-driven fair four-slot pool
  → larger logical chunks
  → parallel Fast/direct hard evidence
  → P0 instrumentation
  → P0 equivalence + performance comparison
       → P1 frozen labels
       → P1 boundary predicates + Golden review
       → P1 comparison
            → P2 Admin metrics/projection
            → final frozen comparison
            → internal SLO proposal
```

P2 schema/projection work может разрабатываться после стабильных metric
contracts P0, но не меняет P0/P1 artifacts. Ошибка P2 не переоткрывает
forensic implementation.

Сначала строится минимальный сквозной path:

```text
one run → two independent address histories → two provider slots
→ reused manifest for two episodes → same final hash
```

После этого масштабируется до четырёх slots и dense fixtures.

## 11. Проверки

### 11.1 TDD и targeted tests

Каждый production change начинается с failing targeted test. После изменения
запускаются только относящиеся к нему тесты:

- manifest identity/reuse/restart;
- address-centric attribution equivalence;
- compact checkpoint serialization;
- provider pool concurrency/fairness/wait;
- chunk pagination equivalence/cancellation;
- PostgreSQL task deduplication and causal fencing;
- P1 boundary positive/negative Golden cases;
- Admin progress projection;
- single parent finalization/delivery regression.

Полный suite не запускается после каждой задачи. Один полный milestone check
допустим после завершения связанного этапа и один финальный check перед
release, если release-инструкция снова его потребует.

### 11.2 Deterministic benchmark identity

Каждый before/after case использует versioned
`UnifiedPerformanceBenchmarkManifestV1`, который фиксирует:

- stable benchmark `runId`/case ID, не production-generated UUID;
- frozen clock: start instant и deterministic monotonic tick source;
- snapshot block/hash/timestamp;
- provider bundle hashes и ordered response identities;
- label dataset/catalog hash;
- provider/scheduler configuration hash, key-group count и logical chunk size;
- runtime commit, schema/checkpoint version и benchmark harness version;
- scoring, attribution, analysis и presentation policy versions;
- locale и deterministic ID generator seed.

Wall-clock duration и machine/runtime metadata записываются в отдельный
measurement envelope и не входят в canonical analysis hashes. Before и after
считаются сопоставимыми только при одинаковой semantic identity; разрешённые
mechanical differences, например checkpoint version/chunk size, перечисляются
явно. Случайный run ID или реальное системное время не могут создавать ложный
hash diff.

### 11.3 Frozen performance comparison

Одинаковые evidence/provider bundles и одна runtime configuration прогоняются
до и после:

- `TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV`;
- `TFWGukC9eWTfg4DYtQAzwuAK5XV85rVYJr`;
- `TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd`;
- synthetic dense case, включая 500-page history, repeated episodes,
  duplicate/reordered evidence и restart.

Live blockchain state не используется для benchmark. Каждый run обязан
дойти до собственного terminal lifecycle state; benchmark harness не
обрывает analysis по elapsed time.

Сравниваются:

- wall time и active provider time;
- provider network requests и requests/sec;
- фактический max/average in-flight;
- key-group distribution;
- provider cache hits;
- address manifest reuses и replay avoided;
- task claims/checkpoints/DB updates;
- checkpoint max/average bytes;
- DB table/TOAST growth;
- unique addresses, episodes и frontier peak;
- canonical inventory/report/score/presentation hashes.

Кроме одиночных cases запускается deterministic concurrency fixture:

```text
one dense interactive run
+ two small interactive runs submitted later
```

Он доказывает, что dense wallet использует четыре slots при свободной системе,
но освобождает progress opportunities для других пользователей при конкуренции.

P0 принимается только при идентичности результатов. Ускорение измеряется, но
заранее заданный коэффициент не является release gate. Если ускорения нет,
результат становится конкретным performance blocker с профилем причины, а не
поводом менять пользовательский контракт.

P1 сравнивается с adjudicated boundary expectations и отдельно показывает,
какая доля уменьшения work получена из доказательных terminal boundaries.

После измерений предлагаются внутренние operational SLO/alerts. Они требуют
отдельного решения и не становятся пользовательским timeout или условием
публикации.

## 12. Acceptance criteria

### P0

- Один snapshot-bound address history физически материализуется один раз и
  переиспользуется всеми funding episodes.
- Один dense wallet создаёт параллельную provider work минимум для нескольких
  независимых frontier addresses; текущие четыре key groups могут быть заняты
  одновременно.
- Provider pool продолжает работу без обязательной interval-паузы между ready
  tasks.
- Larger chunks уменьшают checkpoint count, сохраняя pagination inventory.
- Checkpoint не растёт линейно с количеством обработанных provider pages из-за
  timings или copied collections.
- Frozen P0 outputs идентичны baseline.
- V1 active checkpoint детерминированно и идемпотентно переходит в V2 без
  потери progress; V1/V2 writers не конкурируют.
- Fast/direct hard evidence выполняется параллельно с traversal, но score и
  delivery остаются parent-owned.
- P0 structured instrumentation достаточно для before/after comparison до
  появления Admin P2.
- Межпользовательская fairness не допускает starvation small interactive runs.

### P1

- Frozen dataset содержит versioned service/economic labels с provenance.
- Каждая terminal boundary имеет canonical evidence и versioned predicate.
- Missing label, elapsed time, coverage, depth и graph size не завершают state.
- Positive и negative Golden boundary cases проходят adjudicated expectations.
- Exact expected scores публикуются только после P1 blind
  review/adjudication.

### P2

- Admin объясняет active/waiting/discovered remaining work и использование
  provider pool, не выдавая lower bound за процент завершения или ETA.
- Метрики различают network, provider cache и address-manifest reuse.
- Наблюдаемость не меняет artifacts, lifecycle, score или Telegram delivery.

### End-to-end

- `COMPLETED` создаёт один score и одно итоговое Telegram-сообщение.
- `WAITING_FOR_PROVIDER` сохраняет прогресс без partial result.
- `FAILED_TECHNICAL` не создаёт score или delivery.
- Coverage не влияет на score или публикацию.
- Frozen comparison содержит before/after-таблицу и предложение внутренних
  ориентиров, основанное на измерениях.

## 13. Не входит в работу

- Пользовательский timeout или отмена dense analysis по времени.
- Предварительный/частичный score.
- Отдельные Telegram-сообщения Fast, Where или Deep.
- Coverage threshold.
- Миграция на внешний graph engine.
- Автоматическое превращение benchmark target в release gate.
- Изменение scoring policy ради ускорения.
- Production deploy или live mass canary без отдельной operational authority.
