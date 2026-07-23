# Unified Wallet Check и TRON USDT Golden Pilot V2

**Статус:** утверждённый целевой дизайн, ещё не реализован

**Дата:** 2026-07-23

**Проверенный baseline:** `0024deb4da72efb843b156596ddda065750586ab`

**Будущие implementation plans:** два отдельных связанных плана после review этого design spec

## 1. Назначение документа

Документ фиксирует целевую архитектуру двух связанных направлений:

1. `TRON USDT Golden Pilot V2` — независимый offline-контур для blind review,
   adjudication, locked golden artifacts и нормативных свойств score.
2. `Unified Wallet Check` — production-переработка проверки кошелька, workers,
   traversal, scoring, Telegram dossier и delivery.

Это не описание уже работающей системы. До реализации Plan B актуальным
поведением остаются код baseline и `docs/knowledge/*`.

Исторические документы используются как входные материалы, но не как текущая
истина:

- `docs/superpowers/specs/2026-06-01-unified-address-risk-report-design.md`;
- `docs/superpowers/specs/2026-07-11-tron-usdt-golden-audit-design.md`;
- `docs/superpowers/specs/2026-07-12-telegram-forensic-results-and-runtime-reliability-design.md`;
- `docs/superpowers/specs/2026-07-12-telegram-runtime-forensics-remediation-design.md`;
- переданный пользователем исторический implementation plan Golden Pilot от
  2026-07-11, основанный на более раннем `8c7e72fa`.

Новый дизайн пересмотрен по текущему baseline. Старый Golden plan не должен
исполняться без нового implementation plan.

## 2. Проверенная текущая реальность

Перед утверждением дизайна были сверены knowledge-документы и текущий код.

| Область | Текущее состояние baseline | Целевое изменение |
|---|---|---|
| Пользовательская проверка | Fast, Where и Deep имеют раздельные jobs и delivery paths | Один родительский run и одно финальное сообщение |
| Final score | Required coverage может привести к `NO_FINAL_DECISION` | Каждый completed Unified Check имеет числовой score |
| Coverage floor | `unifiedWalletRisk.ts` поднимает limited context минимум до `30` | Coverage полностью исключается из scoring |
| Score anchor | `ScoreAnchorV2` жёстко типизирован под matrix v3 | Matrix v4 и canonical anchor подходящей версии |
| Low-balance | Порог recent-flow равен `1 000 USDT` | Пороговый пользовательский режим удаляется |
| Recent flow | Есть latest-five principal primitive | Формализовать пять последних входящих и не ограничивать ими анализ |
| Telegram | Renderer умеет typed facts, routes, coverage и no-final copy | Полное единое dossier, без child-сообщений |
| Where worker | Top-level forensic batch обрабатывает jobs последовательно | Stateless chunk tasks и fair scheduling |
| API keys | Есть key slots, groups, in-flight и rate-limit primitives | Общий scheduler всех provider tasks и coalescing |
| Index worker | Уже есть параллельные claims и resumable index primitives | Сделать общий индекс обязательным DAG prerequisite |
| Delivery | Есть immutable payload/fingerprint и durable state | Разделить presentation/recipient и честно обрабатывать ambiguous send |
| Hashing | Есть `canonicalizeJson()` и SHA-256 fingerprint | Переиспользовать как общий forensic hash contract |
| Wallet metrics | Уже доступны USDT/TRX balance, creation time и tx counts | Включить их в Unified Wallet Report |

Особенно важные проверенные места:

- `src/risk/unifiedWalletRisk.ts`;
- `src/risk/finalDisposition.ts`;
- `src/risk/scoringSignalMatrix.ts`;
- `src/risk/scoreAnchorV2.ts`;
- `src/types.ts`;
- `src/forensics/recentFlowProvenanceSelection.ts`;
- `src/check/whereIsMoneyCheck.ts`;
- `src/check/deepForensicCheck.ts`;
- `src/forensics/deepForensicJob.ts`;
- `src/forensics/addressIndexWorker.ts`;
- `src/forensics/telegramDelivery.ts`;
- `src/forensics/telegramDeliveryWorker.ts`;
- `src/telegram/forensicPresentation.ts`;
- `src/telegram/forensicPresentationAdapters.ts`;
- `src/telegram/forensicResultRenderer.ts`;
- `src/wallet/metrics.ts`;
- `src/forensics/addressBehavior.ts`.

### 2.1 Baseline live-canary на восьми последних адресах

23 июля 2026 года текущий pipeline был дополнительно проверен на восьми
последних уникальных TRON-адресах из `forensic_check_jobs`, исключая TBL7 и
TQr. Selection timestamp и запуск зафиксированы run ID
`recent-wallet-canary-2026-07-23T07-14-17-612Z`.

Проверка использовала текущий `/check` entrypoint и production Fast/Where/Deep
jobs. Все jobs имели `chat_id=null`, `requested_by=null` и
`deliveryMode=none`; Telegram API не вызывался.

Состояние на 35-минутном canary deadline:

| Адрес | Fast | Preliminary score | Deep | Where | Final report |
|---|---:|---:|---:|---:|---:|
| `TYXN5ZiJLuzUyAY2dxdzdNjbwnUkSGB1it` | partial | 15 | completed | queued | нет |
| `TV6bBsrCXz2sDSBMZhvc7vHqDwjc65ALZX` | partial | 25 | completed | queued | нет |
| `TSv32fr41xwv3dh99PmtdxkhWguMEEuoVh` | partial | 38 | running | queued | нет |
| `TRddZMs7MJmbpQFuBpFxK4BDt5tA4LLPDu` | partial | 35 | completed | queued | нет |
| `TEognYE7Sy6jiKxkDt2EbFgkUYUfsp9U2j` | partial | 20 | completed | queued | нет |
| `TFWGukC9eWTfg4DYtQAzwuAK5XV85rVYJr` | partial | 35 | completed | queued | нет |
| `TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd` | partial | 20 | completed | queued | нет |
| `TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV` | partial | 20 | completed | queued | нет |

`Preliminary score` в таблице — сохранённый internal Fast result, а не
пользовательский final score.

Canary подтвердил сразу несколько проблем baseline:

- Fast завершил все восемь запусков примерно за минуту общего wall-clock, но
  каждый result получил `partial` из-за enrichment/missing-check diagnostics.
- Семь Deep jobs завершились. Они сохранили от 2 до 34 direct counterparties,
  от 152 до 1 622 transfer edges, service, behavior и boundary profiles.
- Несмотря на эти данные, текущий Deep renderer для всех семи показал только:
  `Контекст поведения готов` и
  `Итоговый риск покажем после анализа происхождения средств`.
- Ни один canary Where job не начал выполнение. Во время наблюдения один
  старый Where job занимал последовательный worker больше трёх часов, а более
  новые jobs оставались за ним.
- Поэтому ни один из восьми адресов не получил final report или final score.
- Ни один canary job не создал Telegram delivery payload/intent.

После deadline восемь ещё не начатых canary Where jobs были переведены в
`cancelled` с причиной
`canary_execution_blocked: deadline_35m_where_queue_not_started`, чтобы
диагностический запуск не занимал живую очередь. Уже выполненные artifacts
сохранены; запущенный Deep job не прерывался небезопасным изменением статуса.

Это observational baseline, а не Golden result и не scoring calibration.
Результат подтверждает необходимость parent orchestration, fair scheduling,
одного terminal contract и dossier renderer, который публикует уже найденные
существенные факты.

## 3. Главные продуктовые инварианты

### 3.1 Один пользовательский результат

Для проверки кошелька пользователь получает ровно одно неизменяемое
Telegram-сообщение после полного завершения Unified Check.

Не допускаются:

- preliminary message;
- отдельный Fast score;
- отдельный Where score;
- отдельный Deep score;
- редактирование промежуточного сообщения;
- child delivery после unified delivery.

Fast, Where и Deep сохраняются как внутренние evidence producers. Они не
сливаются в один алгоритм и не теряют свои предметные обязанности.

### 3.2 Score всегда существует только у completed run

Успешно завершённый Unified Check публикует:

- числовой `finalScore`;
- `scoreValid=true`;
- `ACCEPTABLE`, `REVIEW` или `DECLINE`.

Coverage не блокирует и не увеличивает score.

Технически заблокированный run не получает выдуманный risk decision:

- `WAITING_RETRY`;
- `PROVIDER_COOLDOWN`;
- `BLOCKED_SOURCE_UNAVAILABLE`;
- `BLOCKED_ADMIN_REVIEW`;
- `FAILED_TECHNICAL`.

Эти состояния не являются новым названием `NO_FINAL_DECISION`.
`NO_FINAL_DECISION` остаётся только в legacy v3 и старых контрактах.

### 3.3 Нет продуктовых coverage/time/page gates

Проверка не завершается из-за:

- недостаточного процента coverage;
- максимального времени;
- максимального количества страниц;
- общего page budget;
- семантического `maxDepth`.

Page size, chunk size, concurrency и lease duration остаются operational
механикой. Они могут приостановить и продолжить работу, но не усечь
аналитический результат.

### 3.4 Граф конечный по доказательным правилам

Обход не является буквальным бесконечным раскрытием всего TRON-графа.
Завершение ветки возможно только по формализованной аналитической границе.
Плотность или число контрагентов сами по себе такой границей не являются.

## 4. Два связанных плана

### 4.1 Plan A — TRON USDT Golden Pilot V2

Plan A определяет:

- neutral evidence contract;
- blind-review protocol;
- attribution comparison;
- dossier field semantics;
- expected decisions;
- score properties и отношения между кейсами;
- adjudication;
- exact expected scores после adjudication;
- locked golden artifacts;
- формат production comparator.

Golden package:

- offline;
- не импортирует production code;
- не обращается к TronScan;
- не читает production DB;
- не получает system score или system narrative;
- не реализует comparator, который импортирует production.

### 4.2 Plan B — Unified Wallet Check

Plan B реализует:

- production state machine;
- snapshot и общий индекс;
- provider scheduler и workers;
- traversal;
- выбранную после adjudication attribution policy;
- canonical facts;
- scoring policy v4;
- dossier и presentation;
- production comparator по формату Plan A;
- Telegram delivery;
- Admin/watchdog;
- rollout fence;
- canary.

### 4.3 Направление зависимости

```text
Golden Pilot V2
→ locked contracts и golden artifacts
→ Unified Wallet Check implementation
→ production-importing comparator
→ release gate
```

Golden package не зависит от production. Production-кандидат проверяется
внешним comparator из Plan B.

## 5. Полный lifecycle Unified Check

```text
Валидация адреса
→ создание или переиспользование UnifiedCheckRun
→ фиксация AnalysisManifest
→ общий индекс прямой истории
→ Fast + Where + Deep DAG
→ Normalize
→ Deduplicate
→ Resolve conflicts
→ scoring v4
→ UnifiedWalletReport
→ PresentationArtifact для locale
→ presentation validation
→ delivery intent
→ Telegram delivery
```

### 5.1 Состояния родительского run

- `RUNNING`;
- `WAITING_FOR_PROVIDER`;
- `BLOCKED_ADMIN`;
- `FINALIZING`;
- `COMPLETED`;
- `FAILED_TECHNICAL`.

### 5.2 Состояния веток

- `RUNNING`;
- `COMPLETED`;
- `NOT_APPLICABLE`;
- `WAITING_RETRY`;
- `BLOCKED_ADMIN`;
- `FAILED_TECHNICAL`.

`NOT_APPLICABLE` является нормальным terminal state. Например, отсутствие
USDT-активности не заставляет Unified Check ждать Where бесконечно, а создаёт
кандидат `no_usdt_activity`.

### 5.3 Общий DAG

Fast, Where и Deep не должны независимо трижды загружать одну прямую историю.
Сначала создаются:

- account snapshot;
- direct USDT event index;
- canonical event identities;
- shared labels snapshot.

Ветки возвращают:

- evidence;
- facts;
- patterns;
- boundaries;
- roles;
- scoring candidates.

Их внутренние scores являются диагностическими и не публикуются как итог.

### 5.4 Повторные запросы

- Повтор одного Telegram update продолжает тот же request.
- Один `address + analysis snapshot + manifest versions` может переиспользовать
  активный анализ.
- Разные chats могут подписаться на один run.
- Новый явный запрос после изменения snapshot создаёт новый run.
- Restart worker продолжает сохранённый checkpoint.
- Двойное нажатие одного пользователя не создаёт две доставки.

## 6. Telegram dossier

### 6.1 Порядок разделов

1. Score и срочное действие.
2. Почему такая оценка.
3. Как сформировался баланс.
4. Куда ушли деньги.
5. Сервисы и границы.
6. Контракты и разрешения.
7. Поведение и связи.
8. Профиль кошелька.
9. Coverage.
10. Итоговый краткий вывод.
11. Snapshot block и время.

Вывод находится в конце: пользователь сначала видит доказательства, затем
резюме. Срочное действие при `DECLINE` остаётся рядом со score наверху.

### 6.2 Семантическая полнота

«Показать всё» означает:

- каждая существенная evidence category представлена;
- повторяющиеся транзакции агрегированы;
- критические исключения показаны отдельно;
- ничего не обрезано молча;
- каждый показанный факт связан с evidence;
- суммы и проценты проверены перед delivery.

Это не означает перечисление сотен одинаковых raw transactions. Например:

```text
Bybit → кошелёк:
41 280 USDT, 63% входящего объёма, 73 перевода.
```

### 6.3 Причина score и дополнительный контекст

`Почему такая оценка` содержит только score-driving facts.

`Поведение и связи` содержит подтверждённые связи и интерпретируемые patterns,
которые не обязаны увеличивать score.

Inference нельзя выдавать за label:

```text
Подтверждено: Bybit deposit wallet.
Поведенческий паттерн: collector-like.
```

### 6.4 Services в обе стороны

Прямые входящие и исходящие связи показываются отдельно:

```text
Bybit → кошелёк:
18 400 USDT — 42% входящего объёма, 17 переводов.

Кошелёк → Bitget:
6 200 USDT — 11% исходящего объёма, 4 перевода.
```

Прямая и косвенная связь не смешиваются:

```text
Прямая связь: кошелёк → Bitget.
Через посредника: кошелёк → TUpH…J2b9 → Bybit, 2 шага.
```

### 6.5 Явный знаменатель

Нельзя показывать голое `100%`. У каждого процента указан scope:

- текущий баланс;
- выбранная сумма;
- входящий объём;
- исходящий объём;
- конкретный денежный эпизод;
- backward trace;
- forward continuation.

Это устраняет исходную ошибку TBL7: `100%` исходящего маршрута не является
`100%` provenance coverage.

### 6.6 Отсутствие факта

Отсутствие результата не является доказательством безопасности.

Фраза:

> Подтверждённых прямых переводов на адреса из чёрного списка USDT не найдено.

допустима только после completed проверки соответствующего scope.

Незавершённая approval branch не позволяет писать:

> Опасных разрешений не обнаружено.

### 6.7 Telegram size

Renderer формирует компактные aggregates до отправки. Он не использует
последующее слепое truncation. Если нормативные разделы не помещаются:

- повторяющиеся rows объединяются;
- малые однотипные rows сворачиваются в проверенный aggregate;
- критические exceptions сохраняются;
- reconciled totals должны совпадать с evidence.

## 7. Wallet profile и денежные scope

### 7.1 Профиль

Профиль содержит:

- ordinary address или contract;
- confirmed service identity;
- creation time и wallet age;
- USDT и TRX balance;
- first/last USDT activity;
- inbound/outbound amount и count;
- unique inbound/outbound counterparties;
- основной behavior type;
- label source, confidence, dataset version и effective time в полном artifact.

Другие tokens, NFT, Energy, Bandwidth и fees показываются только когда они
объясняют риск или contract behavior.

### 7.2 Scope каждого показателя

Отчёт различает:

```text
За всё время:
получено 58 420 USDT, 436 переводов.

Текущий баланс:
82,41 USDT.

Формирование текущего баланса по принятой attribution-модели:
79,20 USDT связано с перечисленными поступлениями.

Последний денежный эпизод:
получено 4 100 USDT, затем отправлено 4 080 USDT.
```

### 7.3 Формирование баланса

USDT взаимозаменяемы. Блокчейн не доказывает, какие физические units остались
в текущем балансе.

Нормативная формулировка:

> В формировании текущего баланса по принятой модели участвовали следующие
> поступления.

Golden Pilot сравнивает:

- FIFO;
- LIFO;
- proportional attribution.

Ни одна модель не утверждается заранее. Итог выбирается только после blind
review и adjudication.

Для attribution result сохраняются:

- model/version;
- original amount;
- allocated amount;
- share;
- time interval;
- alternative candidates;
- evidence.

### 7.4 Последние пять пополнений

UI selection:

- confirmed inbound USDT;
- principal amount only;
- без GasFree fees;
- без self-transfer;
- сортировка `timestamp DESC → txHash ASC → eventIndex ASC`;
- пять последних;
- уже показанные в balance formation не дублируются;
- если входящих нет, показываются последние principal outgoing movements.

Пять — только UI-выборка. Полная история анализируется целиком.

### 7.5 Snapshot line

Сообщение заканчивается точным scope:

```text
Данные зафиксированы на блоке 78 421 550
23.07.2026 в 14:32 МСК.
```

## 8. Worker и scheduler architecture

### 8.1 Logical orchestrator

`UnifiedCheckRun` — database state machine, а не один физический процесс.

Stateless worker:

1. claim task по lease;
2. выполняет небольшой chunk;
3. сохраняет checkpoint;
4. освобождает lease;
5. другой worker может продолжить.

Task contract:

```text
idempotencyKey
leaseOwner
leaseExpiresAt
heartbeatAt
attempt
readyAt
checkpointCursor
```

### 8.2 Общий key scheduler

Scheduler поддерживает произвольное число TronScan keys; текущая конфигурация
имеет четыре.

Для каждого key:

- rate-limit state;
- `inFlight`;
- cooldown после `429`;
- daily quota;
- health;
- last success;
- temporary block reason.

Исчерпание key приостанавливает task и переключает готовые запросы на здоровые
keys. Оно не завершает анализ.

### 8.3 Provider request coalescing

Canonical page request:

```text
address + token + blockRange + cursor
```

Одновременный запрос Fast, Where и Deep:

- вызывает provider один раз;
- имеет coalesced waiters;
- сохраняет page в local index;
- переиспользуется для того же snapshot.

### 8.4 Fair scheduling

Provider lanes:

- interactive user checks — weight `8`;
- reconciliation/repair — weight `2`;
- background backfill — weight `1`.

Правила:

- round-robin между активными Unified runs;
- retry возвращается по `readyAt`, а не старому `createdAt`;
- при конкуренции один run занимает не более половины healthy slots;
- при отсутствии конкуренции run может занять свободные slots;
- новый run получает короткий bootstrap для account snapshot/direct history;
- background получает гарантированную долю;
- concurrency limit управляет ресурсами, но не сокращает анализ.

### 8.5 Очереди по ресурсу

- provider I/O;
- indexing;
- CPU/aggregation;
- scoring/rendering;
- Telegram delivery.

Отдельные конкурирующие очереди Fast/Where/Deep не являются планировочной
моделью Unified Check.

## 9. Доказательный traversal

### 9.1 Полный snapshot

Analysis snapshot фиксирует:

- confirmed block number и hash;
- timestamp;
- USDT/TRX balance и источник balance;
- labels dataset hash;
- scoring, attribution и traversal policies;
- runtime/commit;
- pagination end boundary.

Overlap provider pages дедуплицируется по:

```text
txHash + eventIndex + tokenContract
```

### 9.2 Вся direct history

Вся прямая USDT-история проверяемого адреса загружается до snapshot boundary:

- без semantic page cap;
- resumable по cursor;
- с immutable saved pages;
- до provider exhaustion/account creation.

Постоянно недоступная история переводит run в technical blocked state, а не
создаёт аналитическую границу.

### 9.3 Два направления

`backward provenance` отвечает, какие предыдущие поступления могли
финансировать выбранную сумму.

`forward continuation` отвечает, куда allocated value двигался после anchor.

У направлений разные temporal/amount rules.

### 9.4 Traversal state и cycles

Простой `visitedAddress` запрещён.

State key:

```text
address
+ direction
+ anchor timestamp
+ funding episode
+ allocated amount bundle
```

Cycles устраняются по edge/state. Один address может законно участвовать в
разных эпизодах.

### 9.5 Aggregation node не terminal boundary

Dense collector может агрегировать сотни rows, но не останавливает traversal.

- aggregation node экономит обработку и presentation;
- terminal boundary означает потерю доказательного смысла продолжения.

### 9.6 Terminal reasons

- `identified_service_boundary`;
- `shared_liquidity_boundary`;
- `policy_or_restriction_boundary`;
- `contract_economic_boundary`;
- `history_exhausted_to_account_creation`;
- `amount_continuity_exhausted`;
- `temporal_continuity_exhausted`;
- `unidentified_structural_boundary`.

Условия:

- DEX/router не терминален, если route доказательно продолжается;
- contract не терминален без economic boundary;
- collector не равен pooled service;
- account creation считается достигнутым только после полной history;
- unidentified boundary требует structural evidence, а не просто missing label.

Semantic `maxDepth` удаляется. Depth остаётся metric. Checkpoint хранит frontier
cursor, pages и processed states.

### 9.7 Многомерный coverage

Для backward и forward отдельно:

- `selectionCoverage`;
- `traceCoverage`;
- `identifiedCoverage`;
- `unknownBoundaryShare`;
- `untracedShare`.

Coverage является audit/report metadata и не входит в scoring evidence.

## 10. Scoring policy v4

### 10.1 Версионирование

Новая семантика получает:

```text
scoring-signal-matrix-v4
```

V3 и старые anchors остаются воспроизводимыми. Anchor version не утверждается
в этом дизайне заранее.

Обязательное правило:

> Completed run имеет ровно один активный canonical score anchor версии,
> совместимой с matrix v4.

Текущий `ScoreAnchorV2` в baseline типизирован только под v3 и содержит
`coverageDependency`. Plan B обязан провести schema audit. Нельзя молча менять
старую семантику; новая версия anchor создаётся только если существующую схему
нельзя расширить без нарушения воспроизводимости.

### 10.2 Coverage удаляется из scoring

Удаляются:

- `limited coverage → minimum score 30`;
- coverage floor/candidate;
- invalid coverage как причина no-score completed run;
- coverage penalty/dampener.

Метаморфный инвариант:

```text
те же canonical facts + другое coverage = тот же score
```

### 10.3 Canonical facts

Event fact key:

```text
chain
+ tokenContract
+ txHash
+ eventIndex
+ factType
+ subject
+ counterparty
+ subjectRole
```

Path fact key использует ordered event-key hash, fact type, subject и role.

Разные source `evidenceIds` могут ссылаться на один canonical fact. Он входит
в score один раз.

### 10.4 Кандидаты

Neutral/fallback candidates:

- `clean_confirmed_context`;
- `neutral_no_observed_risk`;
- `unknown_without_risk_pattern`;
- `no_usdt_activity`.

Composite risk candidate:

- `unknown_with_correlated_pattern`.

Unknown address сам по себе добавляет `0` баллов. Composite появляется только
при подтверждённой комбинации независимых фактов, например:

```text
unknown sources
+ fan-in
+ rapid forwarding
+ concentration
+ repeated pattern
```

### 10.5 Conflict rules

- Hard evidence нельзя снизить safe noise или Bybit dampener.
- Safe facts корректируют только context, не floors.
- Approval risk не отменяется отсутствием blacklist link.
- Direct link сильнее indirect.
- `blacklisted_at_transfer` отличается от `counterparty_later_frozen`.
- Victim не получает scoring role drainer/spender/receiver.
- Один canonical fact относится только к одной scoring lane.
- Correlated weak signals создают один composite candidate, а не несколько
  независимых начислений.
- Отсутствие scoring risk facts не является hard proof безопасности.

### 10.6 До и после adjudication

До adjudication Golden Pilot фиксирует:

- expected decisions;
- score properties;
- допустимые отношения между кейсами;
- floors/monotonicity expectations;
- role/link/timing semantics.

Exact expected scores до adjudication запрещены.

После adjudication фиксируются:

- точные scores;
- thresholds;
- selected attribution policy;
- canonical expected anchors;
- Telegram fixtures.

## 11. Artifacts, manifests и hash chain

```text
UnifiedCheckRun
├── AnalysisManifest
├── mutable OrchestrationState
├── immutable ChildAttemptArtifacts
├── immutable EvidenceBundle
├── immutable ScoringBundle
├── immutable UnifiedWalletReport
├── immutable PresentationArtifacts
└── DeliveryRecipients
```

### 11.1 AnalysisManifest

- chain/asset;
- address;
- block number/hash/timestamp;
- balance и balance source;
- attribution/traversal policy;
- labels dataset hash;
- scoring policy;
- runtime/commit;
- schema version.

Renderer и locale сюда не входят.

### 11.2 PresentationManifest

- `unifiedWalletReportHash`;
- renderer version;
- template version;
- locale.

Один report может иметь несколько presentation artifacts. Новый renderer не
изменяет старый HTML и не перезапускает analysis.

### 11.3 Canonical hashing

Переиспользуется существующий подход:

```text
SHA-256(canonical JSON UTF-8)
```

Нормативные правила:

- sorted object keys;
- deterministic sorting arrays, где order не является доказательным;
- сохранение order route arrays;
- canonical validated TRON Base58Check;
- normalized tx hashes;
- raw amounts как decimal strings;
- timestamps ISO UTC;
- schema version в каждом artifact;
- запрет `undefined`, cycles и non-finite numbers.

### 11.4 Immutable child attempts

Каждый успешный attempt немедленно создаёт immutable artifact. Retry создаёт
новый artifact. Orchestration state выбирает accepted attempt, не переписывая
предыдущий.

Evidence bundle перечисляет hashes всех accepted child artifacts.

### 11.5 Hash ownership

```text
AnalysisManifest hash
→ accepted child artifact hashes
→ EvidenceBundle hash
→ ScoringBundle hash
→ UnifiedWalletReport hash
→ PresentationArtifact hash
→ DeliveryIntent
```

Recipient metadata не входит в forensic hash chain.

### 11.6 FINALIZING validation

Перед `COMPLETED`:

- branches completed/not-applicable;
- нет waiting/source-blocked branches;
- manifest hashes совпадают;
- evidence canonically deduplicated;
- money/attribution aggregates reconcile;
- final score numeric;
- decision valid;
- canonical anchor valid;
- report references scoring/evidence hashes;
- current-recipient presentations valid и помещаются в Telegram.

Одна DB transaction фиксирует immutable refs/hashes, completed status и
delivery intents.

## 12. Delivery и rollout

### 12.1 Recipient

- `chatId`;
- `messageThreadId`;
- locale;
- presentation artifact hash;
- request correlation ID;
- delivery state.

Delivery uniqueness:

```text
runId + chatId + messageThreadId + presentationArtifactHash
```

### 12.2 Delivery states

- `PENDING`;
- `LEASED`;
- `RETRYABLE`;
- `SENT_CONFIRMED`;
- `DELIVERY_UNKNOWN`;
- `BLOCKED_ADMIN`;
- `CANCELLED`.

Честная гарантия:

> После ambiguous transport result автоматическая отправка не повторяется;
> confirmed delivery никогда не отправляется повторно автоматически.

Manual action после `DELIVERY_UNKNOWN` создаёт отдельную auditable operation с
предупреждением о возможном duplicate.

### 12.3 Rollout fence

Cutover фиксирует:

- generation ID;
- timestamp;
- runtime/commit;
- delivery generation.

После fence:

- новые requests создают только Unified runs;
- pending legacy child deliveries quarantined;
- waiting users при необходимости получают новый Unified run;
- legacy analysis может закончиться как Admin artifact без child delivery;
- already-confirmed legacy delivery сохраняется;
- один `chatId + address` не принадлежит одновременно legacy/unified delivery;
- legacy child result не присоединяется автоматически к Unified;
- Admin явно показывает generation.

## 13. Golden Pilot V2

### 13.1 Case groups

#### Blind-review pilot cases

Основные нейтральные cases исходного пилота, пересобранные под current
contracts.

#### Regression cases

- TBL7;
- TQr.

Они работают только на frozen evidence bundles.

#### Synthetic/property/performance cases

- dense wallet;
- 500 direct-history pages;
- duplicate evidence;
- reordered evidence;
- worker restart;
- provider key exhaustion;
- fan-in/fan-out;
- delivery ambiguity.

### 13.2 Live canary отдельно

Live TBL7, TQr и dense-wallet runs не являются Golden.

Они оформляются отдельным canary:

- новый snapshot;
- runtime/provider metrics;
- no mutation golden expected;
- сравнение только с invariant ranges и completion properties.

Кроме именованных regression-адресов, перед release выполняется
`recent-wallet canary` на восьми последних уникальных TRON-адресах из рабочей
БД. Выборка фиксируется один раз перед запуском:

1. источник — `forensic_check_jobs.subject_address`;
2. для каждого адреса берётся `max(created_at)`;
3. TBL7 и TQr исключаются;
4. невалидные TRON-адреса исключаются;
5. порядок — `latest_created_at desc, subject_address asc`;
6. первые восемь адресов и timestamp выборки записываются в immutable canary
   manifest.

Каждый выбранный адрес проходит тот же полный production analysis и renderer,
которые использует Unified Check, но в `no-delivery` режиме: Telegram API не
вызывается, а точный HTML, score, decision, manifests, hashes, child attempts и
runtime metrics сохраняются как canary artifacts.

Для одного адреса устанавливается 35-минутный наблюдательный deadline. Это
ограничение live-canary harness, а не coverage/page/time gate пользовательского
анализа. По достижении deadline проверка классифицируется как
`canary_execution_blocked`, сохраняются последняя фаза, heartbeat, provider
state, queue age и логи. Harness не превращает этот исход в risk decision, не
публикует частичный Telegram-отчёт и не запускает адрес повторно без новой
диагностической гипотезы либо изменения кода, данных или конфигурации.

Canary report для каждого адреса показывает:

- итог `COMPLETED`, `FAILED_TECHNICAL` или `canary_execution_blocked`;
- длительности parent run и каждой child attempt;
- queue wait и provider wait отдельно от compute time;
- numeric score/decision только для `COMPLETED`;
- exact Telegram HTML и его hash только для `COMPLETED`;
- основные доказательные агрегаты и причины score;
- invariant violations и конкретный blocker;
- подтверждение, что Telegram delivery не создавалась.

Live-chain результаты не становятся Golden expected и не калибруют scoring
автоматически. Они используются для UX review, проверки завершения реальных
кошельков и обнаружения scheduler/provider regressions.

### 13.3 Neutral evidence export

Каждый export имеет:

- canonical content hash;
- provenance manifest;
- source snapshot;
- exporter/runtime version;
- schema version;
- label dataset hash;
- included raw evidence inventory;
- validator receipt.

Доказательство отсутствия system score/narrative:

- allowlist schema;
- forbidden-field scan;
- canonical field inventory hash;
- validation receipt;
- отсутствие production scoring/presentation imports в Golden package.

### 13.4 Blind review

- Reviewer A и Reviewer B получают одинаковый neutral bundle.
- System score, narrative и production decision скрыты.
- Reviews immutable после submit.
- Unblind только после обоих reviews.
- Disagreements проходят adjudication.
- Attribution FIFO/LIFO/proportional сравнивается до выбора policy.

### 13.5 Locked artifacts

Plan A выпускает:

- neutral bundle schema;
- evidence export/provenance manifest;
- review records;
- adjudication record;
- selected attribution policy;
- expected decisions;
- exact scores после adjudication;
- score properties;
- dossier aggregates;
- Telegram expectations;
- locked manifest;
- comparator input/output format.

Comparator, импортирующий production, принадлежит Plan B.

## 14. Обязательные Golden cases и свойства

### 14.1 Edge cases

- совершенно пустой wallet;
- новый wallet без USDT;
- одна legitimate transaction;
- 100% unknown sources без risky pattern;
- 1% direct blacklist exposure;
- 99% Bybit + 1% hard evidence;
- dangerous approval без debit;
- victim confirmed debit;
- old active operational wallet;
- dust/spam;
- TBL7;
- TQr.

### 14.2 Metamorphic properties

- duplicate evidence не меняет score;
- input order не меняет result;
- изменение только coverage не меняет score;
- safe transfers не снижают hard floor;
- retry равен ordinary run;
- child branch не публикует final score;
- direct/indirect имеют различную семантику;
- later label учитывается по temporal semantics;
- один snapshot создаёт одинаковые hashes, score и HTML;
- все contributions объяснимы canonical evidence;
- restart даёт byte-identical report.

## 15. Acceptance и release gates

### 15.1 Product

- Один immutable Telegram report.
- Нет Fast/Where/Deep user delivery.
- Completed run всегда имеет numeric score.
- Нет coverage/no-final copy для completed run.
- Dossier содержит существенные facts и reconciled aggregates.
- Percent scopes явны.

### 15.2 Data и traversal

- 500 direct-history pages обработаны до конца.
- Overlap pages не дублируют event.
- Worker crash не теряет cursor.
- Backward/forward coverage раздельны.
- Dense node агрегируется, но не останавливается автоматически.
- Terminal reasons валидируются.

### 15.3 Scoring

- Matrix v4 не содержит coverage floor.
- Unknown alone добавляет zero.
- Neutral candidate обязателен.
- Canonical dedup работает между child modes.
- Conflict rules соблюдаются.
- Coverage-only mutation score-invariant.

### 15.4 Scheduler

- Fast/Where/Deep page request coalesced.
- Exhausted key переключает ready work на healthy keys.
- Old retry не блокирует new run.
- Dense wallet не занимает весь pool.
- Background не голодает.

### 15.5 Artifacts

- Hashes stable при non-semantic reorder.
- Route reorder меняет hash.
- Retry child не переписывает old artifact.
- RU/EN share report hash и имеют разные presentation hashes.
- Recipient deletion не меняет forensic chain.

### 15.6 Delivery

- Legacy/Unified разделены fence.
- Ambiguous Telegram result не resends automatically.
- Confirmed delivery не повторяется.
- Double request не создаёт duplicate delivery.
- HTML valid, links не дублируются, сообщение не truncated.

### 15.7 Live canary

- Детерминированная выборка последних восьми уникальных адресов зафиксирована
  до запуска; TBL7/TQr в неё не входят.
- Каждый адрес запущен ровно один раз в `no-delivery` режиме.
- На каждый адрес существует terminal canary artifact либо конкретный
  `canary_execution_blocked` artifact после 35-минутного deadline.
- Для `COMPLETED` сохранены exact HTML/hash, score, decision и runtime metrics.
- Ни один canary не создаёт Telegram delivery intent.
- Повторный запуск разрешён только после зафиксированного изменения или новой
  диагностической гипотезы.

## 16. Migration и compatibility

- Legacy results не пересчитываются.
- V3 и old anchors остаются readable.
- Old `NO_FINAL_DECISION` остаётся историческим.
- New Unified scoring использует v4.
- User-facing Deep/Where routes перенаправляются на Unified `/check` или
  скрываются после rollout.
- Admin diagnostic child runs могут сохраниться без delivery authority.
- Schema migrations additive.
- Completed artifacts immutable.

## 17. Риски и принятые trade-offs

### Долгая тишина для пользователя

Пользователь явно выбрал отсутствие progress-message до полного результата.
Наблюдаемость обеспечивается Admin/watchdog, не Telegram.

### Telegram size

Literal raw completeness невозможна в одном сообщении. Принята semantic
completeness с доказательными aggregates.

### Attribution uncertainty

Ни одна attribution model не выдаётся за физическую истину. Выбор делается
только после blind review/adjudication.

### Provider permanent unavailability

Бесконечный retry не маскирует permanent source failure. Run блокируется
технически и не получает risk score.

### Telegram exactly-once

Telegram не даёт application idempotency key. Поэтому используется
at-most-one automatic attempt after ambiguity, а не ложное обещание строгого
exactly-once.

### Live-chain drift

Golden regression использует frozen bundles. Live behavior проверяется canary
и не меняет locked expected.

## 18. Защита от зацикливания выполнения

Эти правила относятся к разработке, тестам и review-процессу. Они не
ограничивают полноту анализа пользовательских кошельков.

Каждый этап имеет заранее определённые входы, результат и условие завершения.
Завершённый этап не открывается повторно, если его контракт не изменился или не
найдено доказанное нарушение.

Повтор одной и той же проверки без изменения кода, данных, конфигурации или
диагностической гипотезы запрещён. Одинаковое падение второй раз переводится в
отдельный blocker для анализа причины, а не запускается снова.

После изменения выполняются только относящиеся к нему targeted tests. Полный
test suite, Golden comparator, replay и Telegram acceptance запускаются один
раз на соответствующем milestone и один раз перед release.

Ошибка возвращает на доработку только затронутый artifact или модуль. Она не
возвращает весь план к первому этапу и не требует повторять уже подтверждённые
независимые проверки.

Review проводится одним основным проходом. После исправления P0/P1-замечаний
повторно проверяются только изменённые места и связанные с ними контракты.
Новые необязательные улучшения записываются отдельно и не расширяют текущую
реализацию.

Список обязательных release gates фиксируется до начала реализации. Добавление
нового блокирующего gate требует отдельного обоснования и явного решения;
диагностические проверки не становятся блокирующими автоматически.

Долгая команда должна иметь ожидаемую длительность и признак прогресса. Если
прогресса нет, команда останавливается, её логи сохраняются, а причина
оформляется как конкретный blocker. Полный процесс после этого не начинается
заново.

Глобальная заморозка кода, ветки или проекта не используется. Неизменяемыми
становятся только уже утверждённые Golden-артефакты и завершённые результаты.
Разработка остальных частей продолжается независимо.

Зависимости этапов образуют направленный граф без циклов. Ни один этап не
должен одновременно ждать результат следующего этапа и являться его
обязательным входом.

Сначала реализуется минимальный сквозной путь от входа до результата.
Масштабирование, плотные графы, дополнительные оптимизации и расширенные
проверки добавляются после того, как этот путь работает и имеет небольшой
runnable check.

Любой повторный запуск обязан отвечать на конкретный вопрос и давать новую
информацию. Запуски «на всякий случай», повторные полные review и проверки без
изменившихся условий не выполняются.

Работа считается завершённой, когда выполнены заранее зафиксированные
acceptance criteria. Отсутствие новых идей или замечаний не является условием
завершения; необязательные улучшения переходят в отдельный follow-up.

## 19. Переход к implementation planning

После review этого design spec создаются два отдельных подробных плана:

1. `2026-07-23-tron-usdt-golden-pilot-v2.md`;
2. `2026-07-23-unified-wallet-check.md`.

Plan A сначала фиксирует schemas, review protocol и pre-adjudication
expectations. Infrastructure части Plan B могут идти параллельно после schema
lock. Финальная scoring calibration и renderer fixtures зависят от adjudicated
Golden results.

Production release запрещён до прохождения обоих plan gates.
