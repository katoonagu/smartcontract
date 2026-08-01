# Correctness Gate, Stage B Closure And Unified Latency Design

**Дата:** 2026-07-28

**Статус:** утверждено пользователем; разбито на два implementation plan

**Назначение:** зафиксировать порядок ближайших работ после аудита и не смешивать
legacy Stage B с latency нового Unified `/check`.

## Решение

Ближайшая работа разделяется на три независимых трека:

1. сначала закрывается correctness gate по authority и event-time semantics;
2. затем отдельно закрывается release evidence уже реализованного legacy Stage B;
3. задержка Unified TQr исследуется отдельным latency-треком и не считается
   симптомом незавершённого Stage B.

После них выполняются Stage C shadow, blind review/adjudication и только затем
Stage D. Следующий продуктовый этап после A-D — recipient precheck до подписания
или отправки транзакции.

Этот документ является sequencing design, а не одним implementation plan.
Correctness и Stage B получают отдельные исполнимые планы. C и D не включаются
в них скрыто.

## Проверенная исходная точка

### A-D

- Stage A реализован, но новые пользовательские runs по умолчанию всё ещё
  используют `snapshot-closure-v1`; operational rollout V2 не закрыт.
- Stage B runtime core (selective enrichment, claim fencing и slot pump)
  code-complete; unit/client contracts присутствуют. Реальный capture path не
  доказан: recorder требует отдельного read-only/date/assertion/dispose fix.
  Release closure для production Where concurrency `2` также блокируют
  отсутствующие deployment-owned bridge/adapter/cycle composition и строгая
  attributable rollout observability.
- Stage C существует только в design. `service-behavior-profile-v1` в runtime
  отсутствует.
- Stage D существует только в design. Production config и contracts принимают
  только `snapshot-closure-v1` и `snapshot-closure-v2`.

### Подтверждённые correctness defects

1. `route_linked` approval-drain profile может создать high-confidence
   `approval_drain_proximity`, попасть в плоский label и стать Fast exact hard
   evidence с floor 95.
2. Текущий active blacklist допускает policy candidate даже когда principal
   transfers произошли до activation; `temporalRelation` сейчас только
   modifier.
3. Blacklist timeline принимает только точные presentation strings
   `AddedBlackList(address)` и `RemovedBlackList(address)`, поэтому валидная
   декодированная форма с `address indexed _user` отвергается.
4. Missing или invalid sanctions timestamp сейчас считается active.

Зелёные текущие тесты не закрывают эти defects: часть из них прямо закрепляет
неверное поведение.

### Live TQr observation

Пользовательский `/check TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP`, принятый
2026-07-28 в 09:39 МСК, создал Unified authoritative run
`149de409-a03d-4bff-9209-5b4d0ddef2a8`.

Наблюдение в 11:06 МСК:

- policy: `snapshot-closure-v1`, `global_barrier`, capacity ceiling `1`;
- direct history, Fast и direct Deep завершены;
- 711 funding episodes;
- traversal frontier current/peak `956`;
- 348 unique address-history subjects;
- 78 histories completed, 1 leased, 269 queued;
- четыре provider groups healthy, resource state normal, cooldown отсутствует;
- runtime продолжал heartbeat и bounded progress.

Между двумя read-only snapshots completed history выросла с 68 до 78, но
uncommitted planner count остался 270: закрытые histories обнаружили новые
mandatory addresses. Это expanding traversal, а не зависший provider.

Пятиминутное Telegram-сообщение было штатным `LONG_RUNNING` lifecycle notice,
а не ошибкой.

## Трек 1. Authority And Temporal Correctness Gate

### Цель

Ни один новый hard decision не должен возникать из route-only authority,
текущего состояния, применённого задним числом, или неизвестного времени.
Исторические сохранённые scores не пересчитываются.

Четыре fixes выполняются отдельными test-first commits и сходятся только в
общем Golden/regression gate. Они не требуют одного большого risk-policy patch.

### 1. Approval-drain authority

- `route_linked` остаётся review/context и не создаёт exact durable label.
- Только `exact_approval_and_transfer_from` может создавать direct hard
  approval-drain assertion.
- Плоский label code сам по себе больше не является достаточной authority для
  Fast 95. Exact Fast evidence обязано сохранять проверяемую direct provenance,
  а не восстанавливать authority из строки label.
- Та же граница действует вне Fast: плоский marker не становится
  `risky_label` stop/hard Incoming evidence, сохранённый Where proof-level не
  является authority без связанного exact path/reason, а Admin не доверяет
  strength, feature code или `exactApprovalDrainCount` без subject-bound
  direct hop-zero profile.
- Stale `rootSourceType`/aggregate share также не восстанавливает authority:
  risky-label source bundle, saved policy/layer rows и broad-history fallback
  требуют того же bound exact-label path и совпадения evidence IDs.
- Durable assertion и reconstructed Fast reason связываются с полным retained
  raw-profile-observation chain. Совпадение approval/drain tx IDs при другом
  `hopDepth`, receiver или subject недостаточно.
- Existing assertions не переписываются автоматически. Regression проверяет,
  что route-linked-only recomposition не даёт `exact_hard_proof`.

### 2. Blacklist event-time eligibility

- `became_active_after` не создаёт `can_decline` candidate из текущего active
  состояния.
- `unknown` остаётся unresolved/context и не доказывает active-at-transfer.
- Для `mixed` policy candidate использует только
  `activeAmountRaw`/`activeTxCount` и создаётся лишь при complete timeline/direct
  coverage, exact share для active subset и самостоятельном прохождении этим
  subset materiality gate. Pre-activation и unknown amounts не участвуют в
  hard candidate.
- Positive regression сохраняет decline-authority для material
  `active_at_transfer` с complete authoritative timeline.

### 3. Blacklist event decoding

- Authority определяется official USDT contract, confirmed successful
  transaction, matching user/result, block, log index и timestamp. Если provider
  отдаёт raw topics, canonical event/user topics обязаны совпасть; уже
  декодированное verified provider event без `topics` сохраняет текущую
  совместимость и проверяется по тем же остальным authority-полям.
- Декодированная signature является семантическим corroboration, а не
  побайтовым presentation contract.
- Каноническая форма и эквивалентная форма `address indexed _user` принимаются
  одинаково; несовпадающие topic/name/signature/address по-прежнему fail closed.

### 4. Sanctions time

- Temporal evaluator возвращает явное `active`, `inactive` или `unknown` для
  risk-producing callers.
- Только `active` может создать hard sanctions fact.
- Missing/invalid event time или invalid designation time возвращает `unknown`.
  Unknown не считается clean evidence и не становится active по умолчанию.

### Acceptance

- Новые negative regressions сначала воспроизводят каждый defect.
- Route-linked-only evidence не создаёт durable exact label и Fast 95.
- Pre-activation/unknown blacklist evidence не создаёт independent decline.
- Canonical и indexed decoded blacklist events дают одинаковую verified
  timeline; conflicting events отвергаются.
- Unknown sanctions time не создаёт hard fact.
- Existing positive exact/event-time cases сохраняются.
- Targeted tests, Golden/regression checks, PostgreSQL-gated checks где они
  применимы, typecheck и full suite проходят без skipped DB proof, названного
  passed.
- Соответствующие knowledge pages обновлены в том же change set.

## Трек 2. Stage B Release Evidence Closure

### Scope

Stage B остаётся legacy change:

- shared selective raw/full transaction enrichment;
- claim fencing;
- bounded work-conserving Where slot pump;
- isolated candidate concurrency `2`.

Он не меняет Unified traversal, C/D, provider capacity, Deep/Incoming
concurrency, scoring или delivery contract.

Release-closure plan сначала минимально чинит подтверждённые defects capture
adapter, затем переиспользует существующие replay/canary contracts. Он не
маскирует отсутствующую deployment integration как operational input:
если approved deployment layer не предоставляет bridge/adapter/cycle
composition, Stage B остаётся на default `1`, а интеграция получает отдельный
security-reviewed design. То же правило действует для отсутствующей
request-lane attribution в production observation.

### Уже готово

- selective resolver и восемь hard triggers;
- immutable raw/full evidence и in-flight dedupe;
- claim-generation fencing и heartbeat coordination;
- Where slot pump с default `1`, candidate `2`;
- strict replay reader, diagnostics и isolated canary client contracts;
- предыдущий локальный target: 21 file, из них 20 passed + 1 skipped; 996 tests
  passed + 80 skipped. Это не PostgreSQL proof.

### Незакрытые release capabilities и evidence

1. Test-first repair capture adapter: PostgreSQL `Date|string` timestamps,
   read-only dependency surface, safe assertion projection и guaranteed
   `execution.dispose()`; safe endpoint identity и pre-write rejection любых
   настроенных secret values, попавших в canonical bytes.
2. Реальный pre-Stage-B TXc tape
   `tests/fixtures/forensics/txc-legacy-where-latency-v1.json` и passing strict
   replay. Synthetic fixture запрещено выдавать за release evidence.
3. Real PostgreSQL claim-generation/fairness tests и `schema:verify`.
4. Deployment-owned loopback bridge server, tracked single-file adapter,
   реальная
   cycle-isolated runtime composition и canonical deployment-receipt builder.
   Текущий repository содержит trusted CLI/client contract, но не эту
   production integration.
5. Dedicated canary clone/config, immutable deployment receipt и attested
   runtime adapter. Shared environment не используется.
6. Accepted concurrency-two Where receipt без foreign scheduler activity,
   provider errors, 429 или delivery, записанный в caller-bound create-only path
   и повторно проверенный по canonical bytes, self-hash и raw-file SHA-256.
   Отдельный create-only binding manifest связывает receipt с clean trusted-CLI,
   exact combined candidate и deployment commit/tree/artifact.
7. Separate `where-latency-deep-residual-v1` receipt при Deep concurrency `1`,
   где receipt связывает реальный Deep poll/start contract, а не Where poll, и
   имеет собственный canonical binding manifest с новой deployment identity.
8. Attributable или cycle-isolated 30-minute before/after provider-error and
   delivery observation вокруг reversible production trial. Текущих
   process-global request logs без legacy-Where ownership недостаточно.
   Сам observer и canonical manifest writer должны быть отдельно reviewed,
   установлены и проверены до trial; итоговый observation receipt появляется
   уже во время trial и потому не является условием для собственного создания.

### Stop rules

- Missing или неотремонтированный read-only capture adapter блокирует tape.
- Missing real tape блокирует replay; оно не заменяется синтетикой.
- Missing real bridge/adapter/cycle composition блокирует canary; normal
  runtime не становится isolated от одного CLI env value.
- Missing dedicated clone/attestation блокирует canary; текущие user jobs не
  отменяются и не переносятся ради теста.
- Missing attributable or cycle-isolated production logs блокирует rollout;
  process-global endpoint counts нельзя выдавать за Where-only causality.
- Любая contamination, duplicate delivery, рост 429/error rate или
  unreconciled counter оставляет production Where на `1`.
- Deep остаётся `1`; высокий residual открывает отдельный design, а не скрытое
  повышение concurrency.

### Acceptance

После replay, PostgreSQL proof, real deployment integration, accepted Where
canary, separate Deep receipt и readiness receipt заранее установленного
attributable observer Stage B получает статус `canary-accepted`, что разрешает
только отдельно подтверждённый reversible production trial с Where concurrency
`2`. После passing attributable observation он получает статус
`rollout-complete`; при failed, missing или contaminated observation значение
возвращается на `1` по заранее утверждённому rollback contract.
Runtime-core complete и наличие unit/client contracts без этих
capabilities/artifacts не равно ни canary-accepted, ни rollout-complete.

## Трек 3. Unified TQr Latency

### Отделение от Stage B

TQr run использует Unified tables, planner и provider controller. Его Unified
Where child на момент observation ещё не стартовал. Поэтому
`FORENSIC_WHERE_WORKER_CONCURRENCY` не может быть причиной или исправлением
этой задержки.

### Неподвижная correctness граница

- TQr является mandatory negative inferred-boundary case и ожидается как
  `professional_operator`, `wouldStop = false`.
- Subject никогда не становится inferred terminal.
- Stage C shadow не меняет frontier, score, report или delivery.
- Stage D может остановить только adjudicated high-confidence intermediate EOA
  с complete clean adverse preflight.

Следовательно, обещание «D обрежет TQr» запрещено. Возможная экономия для этого
case приходит только от exact event-time-valid boundaries соседей или от иных
intermediate nodes, прошедших будущую adjudicated V3 policy.

### Отдельные измерения

- сохранить terminal/technical outcome текущего V1 run как observation, не как
  frozen before/after proof;
- отдельно измерять exact V2 savings на event-time-valid соседях, включая
  честный ноль для post-event observations;
- отдельно измерять C shadow potential savings при обязательном
  `TQr wouldStop=false`;
- rolling/capacity сравнивать только в isolated replay/canary и не смешивать с
  boundary correctness;
- expanding frontier не получает выдуманный процент или ETA.

## Дальнейшая последовательность

1. Correctness implementation plan и выполнение.
2. Stage B release-closure plan и сбор operational evidence.
3. Stage C shadow implementation.
4. Frozen blind set, два независимых review и adjudication.
5. Отдельный Stage D/V3 implementation plan, disabled-by-default code и canary.
6. Recipient wallet precheck before signing/broadcasting.

## Repository Size Audit Snapshot

Read-only snapshot на 2026-07-28, привязанный к base
`5bb7297bc5b274209475148f5c2c6556ef305b34`:

- tracked Git content: около 25.84 MiB, 1,130 files и 599,080 text lines;
- TypeScript: около 370,540 lines;
- физический workspace: около 3.99 GiB, причём основной лишний объём находится
  в старых worktrees и повторных `node_modules`, а не в tracked source;
- обычные scoped `rg`, diff и patch operations остаются быстрыми; само число
  строк не является причиной долгого TQr run и не делает маленький patch
  пропорционально тяжёлым;
- заметная стоимость возникает у full-repository typecheck/test, широкого
  чтения контекста и дублированных dependency trees.

Вывод аудита: не дробить большие файлы и не удалять код ради метрики строк.
Полезные отдельные changes — retire только подтверждённо завершённые worktrees,
добавить app-only inner-loop typecheck, определить retention для `outputs/`/CSV
и выполнить deletion-first pass только по доказанно мёртвым test/helper seams.

Maintenance-аудит не блокирует эту цепочку. Очистка старых worktrees, быстрый
app-only typecheck, политика `outputs/`/CSV и deletion pass выполняются
отдельными маленькими changes без смешивания с risk policy.

## Documentation Contract

- `docs/knowledge/14-current-roadmap.md` является короткой текущей статусной
  картой и ссылается на этот design.
- Точные implementation details остаются в отдельных plans; roadmap не
  копирует тысячи строк task instructions.
- После каждого gate roadmap меняет status и evidence links в том же commit.
- Knowledge claims о production routing должны соответствовать проверенному
  live `/check`: primary `/check` и legacy mode-specific workers описываются
  раздельно.

## Не входит в scope

- исправление production code в этом documentation change;
- принудительное завершение, retry или restart текущего TQr run;
- переключение user default на V2/V3 или rolling;
- production Where concurrency `2` без evidence;
- пересчёт historical scores;
- объединение correctness, B и Unified latency в один patch;
- рефакторинг крупных файлов только ради числа строк.
