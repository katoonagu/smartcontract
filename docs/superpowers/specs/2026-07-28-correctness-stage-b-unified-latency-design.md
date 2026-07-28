# Correctness Gate, Stage B Closure And Unified Latency Design

**Дата:** 2026-07-28

**Статус:** структура утверждена; письменная спецификация ожидает review

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
- Stage B code-complete. Release evidence для production Where concurrency `2`
  не закрыто.
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

- Authority определяется official USDT contract, canonical event topic,
  confirmed successful transaction, matching user topic/result, block, log
  index и timestamp.
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

Release-closure plan сначала переиспользует существующие harness и contracts.
Новый production code добавляется только если конкретный обязательный gate
обнаружит defect, который нельзя закрыть окружением или evidence artifact.

### Уже готово

- selective resolver и восемь hard triggers;
- immutable raw/full evidence и in-flight dedupe;
- claim-generation fencing и heartbeat coordination;
- Where slot pump с default `1`, candidate `2`;
- strict replay reader, diagnostics и isolated canary harness;
- локальный deterministic Stage B gate: 20 files / 996 tests passed.

### Отсутствующее evidence

1. Реальный pre-Stage-B TXc tape
   `tests/fixtures/forensics/txc-legacy-where-latency-v1.json` и passing strict
   replay. Synthetic fixture запрещено выдавать за release evidence.
2. Real PostgreSQL claim-generation/fairness tests и `schema:verify`.
3. Dedicated canary clone/config, immutable deployment receipt и attested
   runtime adapter. Shared environment не используется.
4. Accepted concurrency-two Where receipt без foreign scheduler activity,
   provider errors, 429 или delivery.
5. Separate `where-latency-deep-residual-v1` receipt при Deep concurrency `1`.
6. Clean 30-minute before/after provider-error and delivery observation вокруг
   reversible production trial.

### Stop rules

- Missing real tape блокирует replay; оно не заменяется синтетикой.
- Missing dedicated clone/attestation блокирует canary; текущие user jobs не
  отменяются и не переносятся ради теста.
- Любая contamination, duplicate delivery, рост 429/error rate или
  unreconciled counter оставляет production Where на `1`.
- Deep остаётся `1`; высокий residual открывает отдельный design, а не скрытое
  повышение concurrency.

### Acceptance

После items 1-5 Stage B получает статус `canary-accepted`, что разрешает только
reversible production trial с Where concurrency `2`. После passing item 6 он
получает статус `rollout-complete`; при failed или contaminated observation
значение возвращается на `1`. Code-complete без этих artifacts не равно ни
canary-accepted, ни rollout-complete.

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
