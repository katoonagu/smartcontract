# Unified Service Boundaries And Check Latency Design

**Статус:** утверждённое направление; письменная версия на проверке

**Дата:** 2026-07-26

**Базовая версия:** `2f3b9b298de91bd021ff403bd3607c6744221115`

## Назначение

Сократить время Unified и связанных legacy-проверок без произвольного
обрезания provenance-цепочки, без потери hard-risk evidence и без изменения
существующей `matrix-v4`.

Дизайн решает четыре связанные, но независимо поставляемые задачи:

1. научить `snapshot-closure-v2` получать авторитетные custodial/CEX-границы
   из точных frozen provider-tag observations, а не из плоских строк;
2. убрать доказанную задержку legacy `Where`, вызванную starvation очереди и
   последовательным `transaction-info` с интервалом 15 секунд;
3. добавить объяснимый поведенческий профиль сервисоподобного кошелька сначала
   в shadow-режиме, без влияния на traversal и score;
4. после blind review разрешить новой `snapshot-closure-v3` останавливать
   только высокоуверенные неразмеченные сервисные промежуточные EOA.

Эти задачи реализуются отдельными планами и коммитами. Каждый этап даёт
самостоятельно проверяемый результат и не требует включения следующего.

## Проверенные исходные факты

### Последний патч

Коммит `2f3b9b2` делает selected canary restart-safe и уточняет event/timer
reconciliation. Он не меняет ширину traversal, размер истории или политику
границ. Новые runs по умолчанию всё ещё получают `snapshot-closure-v1`.

### TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP

В run `5417cbf6-7cef-4b91-8367-d266eaf3857e` прямая история предмета
завершилась примерно за 41 секунду: 15 provider pages и 711 канонических
официальных USDT-событий. Долгое время возникло после direct history:

- 711 funding episodes;
- 1 244 address-history tasks на наблюдаемом срезе;
- 14 577 provider pages;
- 46 адресов на 200 страниц дали 9 200 страниц, или 66,8% общего объёма;
- 98 адресов с не менее чем 1 000 строк дали 90,2% общего объёма;
- provider сохранял примерно 2,17 страницы в секунду без устойчивых ошибок или
  cooldown.

Следовательно, первичная причина — количество обязательных историй соседей,
а не история предмета проверки и не CPU.

Поведение самого TQr соответствует `professional_operator`: длинный период,
примерно два канонических USDT-события в календарный день, медианный исходящий
интервал около 13 часов и максимум шесть исходящих за час. Он является
обязательным отрицательным Golden-примером для inferred boundary.

### TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd

У адреса около двух страниц официальной USDT-истории. В историческом snapshot
было 62 перевода, в live-ответе на момент анализа — 73. Собственная индексация
занимала около 15 секунд.

Задержка была вне истории предмета:

- Deep job `3a27291a-da20-4fa5-9681-1971ee2e3874` ждал очередь 21 минуту
  39 секунд и выполнялся 4 минуты 40 секунд;
- Where job `d5cc718b-a8aa-4c83-b5ac-7ea98a16d03c` не начал работу и был
  отменён через 38 минут 45 секунд с
  `deadline_35m_where_queue_not_started`;
- incoming-проверки тратили 98,9–99,6% времени внутри `where_is_money`;
- runtime задаёт `contractTransactionInfoMinIntervalMs = 15_000`, а
  `whereIsMoneyCheck` исполняет такие запросы одной последовательной цепочкой.

TXc соответствует `insufficient_data` или
`professional_transit_candidate`, но не production service boundary.

### Разрыв между V2 и реальными данными

`snapshot-closure-v2` уже умеет применять exact frozen custodial boundary до
планирования address history. Однако production freeze сейчас читает только
`address_labels` и `address_labels_cache`; эти строки превращаются в
`classifier_hint`, который всегда `terminalEligible = false`. В каталоге нет
exact CEX address bindings. Поэтому простое переключение на V2 не даёт
ожидаемого сокращения.

В TQr-run 15 соседей с CEX metadata всё равно были загружены по 200 страниц.
Они создали 3 000 страниц. Вместе с тремя другими узнаваемыми сервисами это
составило примерно 25% прочитанных страниц на наблюдаемом срезе.

### Текущий benchmark prerequisite

Targeted boundary/coordinator/reconciliation tests на базовом commit проходят.
Полный Windows `runUnifiedAdaptiveBenchmark.test.ts` имеет отдельный
line-ending blocker: fixture loader удаляет `\n`, но оставляет `\r`, после чего
получает `unified_provider_replay_noncanonical`. Нормализация CRLF является
маленьким самостоятельным prerequisite для release evidence. Она не считается
ускорением кошелька и не смешивается с policy changes.

## Термины

### Известный сервис

Адрес с доказанной identity и authority:

- точная запись внутреннего реестра; или
- frozen provider-tag observation, удовлетворяющая строгому контракту
  источника, exact matcher и временной применимости.

Плоский label, совпавший текст, `address_metadata.verified = true`, текущий
provider tag без сохранённого payload и classifier result сами по себе не
являются известным сервисом.

### Сервисоподобное поведение

Наблюдаемая машинная и/или массовая структура переводов, которая может
соответствовать легитимному процессингу, OTC-деску, payout-инфраструктуре,
drainer, poisoning-боту или другому автоматизированному процессу.

Сервисоподобное поведение не доказывает identity и не доказывает безопасность.

### Предмет и промежуточный адрес

- `subject` — адрес, который пользователь отправил на проверку;
- `intermediate` — адрес, найденный как звено backward/forward traversal.

Subject никогда не становится inferred terminal boundary. Его профиль только
объясняет поведение. Inferred boundary может применяться только к intermediate
EOA в новой policy version.

### Probe budget

Предел данных, разрешённых для попытки доказать оптимизационную границу. Это не
лимит окончательной истории. Если proof недостаточен, adverse или недоступен,
обычная полная address history остаётся обязательной.

## Неподвижные инварианты

1. Существующие `snapshot-closure-v1` и `snapshot-closure-v2` manifests и
   hashes не переосмысляются.
2. Coverage не добавляет риск и не делает неизвестный адрес подозрительным.
3. Service likelihood не добавляет и не вычитает AML score.
4. Hard evidence никогда не подавляется сервисным статусом.
5. Высокий баланс, оборот или одна плотная вспышка не доказывают сервис.
6. Dust, `riskTransaction` и вероятное address poisoning не увеличивают
   клиентскую широту сервиса.
   Одна малая сумма сама по себе не считается dust/poisoning proof.
7. Любая production boundary привязана к snapshot, event time, policy version
   и неизменяемому evidence artifact.
8. Недостаточное, противоречивое или недоступное evidence означает
   `continue`, а не `stop`.
9. Bridge, DEX, router и контракт не становятся behavioral boundary. Для них
   сохраняются route-dependent и economic-role правила.
10. Arbitrary hop/page/time limit не может выдавать результат полного closure.

## Целевая архитектура

```text
frontier state
    |
    +-- subject? --------------------------> полная история + context profile
    |
    +-- frozen authoritative identity
    |       |
    |       +-- custodial CEX ------------> exact boundary + independent risk facts
    |       +-- bridge/DEX/contract ------> существующий route/economic path
    |       +-- нет exact identity
    |                                           |
    |                                           v
    |                                  behavior probe (<= 500)
    |                                           |
    |                    +----------------------+----------------------+
    |                    |                      |                      |
    |               insufficient           adverse              high inferred
    |                    |                      |                      |
    +--------------------+----------------------+                      v
    |                                                           V3 boundary
    v
обычная полная address history и существующий traversal
```

Архитектура deliberately разделяет три независимых решения:

- identity: кто контролирует адрес;
- behavior: насколько адрес похож на машинный сервис;
- adverse evidence: есть ли санкции, blacklist, drainer, опасный approval или
  контрактная угроза.

Ни один общий «процент сервиса» не заменяет эти решения.

## Этап A. Authority-preserving exact boundaries

### Источники

Новые frozen datasets продолжают использовать существующий
`unified-frozen-label-dataset-v1`, поскольку он уже поддерживает
`exact_registry` и `verified_provider`. Менять старые artifacts или schema
discriminator не требуется.

Production freeze для каждого нового run выполняет свежий DB-read и получает:

1. существующие compatibility `legacyRows`, которые остаются hint-only;
2. точные internal-registry bindings, уже разрешённые каталогом;
3. `AcceptedProviderServiceAssertionV1`, декодированные напрямую из свежих
   `address_metadata` по контракту `tronscan-address-tag-observation-v1`.

Этот дополнительный read и provider records включаются только при выбранной
`snapshot-closure-v2` или более новой policy. Новые V1 runs продолжают вызывать
старый builder с прежними `legacyRows`; неиспользуемые authoritative records не
меняют их dataset bytes или request identity.

Существующие `address_label_assertions`, `address_labels`,
`address_labels_cache` и classifier results не повышаются до service authority.
В assertions нет обязательных `catalogEntryId`, authority и validity interval,
а их автоматическая проекция в плоские labels могла бы скрыто изменить V1.
Они остаются risk/context evidence.

`address_metadata.verified` не является service proof: обычно это верификация
кода контракта. `name` также никогда не создаёт terminal authority. EOA с
точным provider tag не обязан иметь `verified = true`.

### Контракт authoritative binding

Логическая форма принятого provider observation:

```text
version = tronscan-address-tag-observation-v1
chain = tron
address
catalogEntryId
authority = tronscan_verified_metadata
source.provider = tronscan
source.matchedField = tag
source.matchedValue
source.matcherVersion = unified-tronscan-cex-tag-map-v1
source.fetchedAt
source.expiresAt
source.sourcePayloadSha256
validity.validFrom
validity.validTo = null
validity.basis = provider_observed_from
```

Принятая запись преобразуется существующим `buildFrozenLabelRecord` в
`strength = verified_provider`, `authority = tronscan_verified_metadata` и
`terminalEligible = true`. Source payload hash система считает сама от
канонического envelope, содержащего raw JSON, tag, адрес, времена и matcher
version; значение из БД не принимается на веру.

Обязательные условия:

- address является каноническим TRON Base58 и точно совпадает с
  `raw_json.address`;
- source равен `tronscan`;
- непустой `tag` точно совпадает с `raw_json.tag`;
- `fetchedAt <= frozenAt < expiresAt`; stale-while-revalidate row запрещена;
- tag полностью, не по substring, совпадает с versioned allowlist matcher;
- catalog entry существует, имеет category `cex` и policy
  `custodial_boundary`;
- payload hash и validity interval воспроизводимы;
- name-only, generic `exchange`/`hot wallet`, route-linked, proximity и inferred
  evidence запрещены как exact identity.

Начальный matcher принимает только закреплённые полные семейства provider tags,
например `Binance`, `Binance-Hot N`, `Bybit`, `OKX Hot Wallet N`, `Okex N`,
`WhiteBIT`, `Kraken[: Hot Wallet]`, `Kucoin N`, `Bitget N`, `MEXC/MXC N`,
`HTX N` и `Huobi N`. Значения вроде `Fake Binance` не принимаются.

### Временная семантика

Provider observation не backdate-ится. Без отдельного исторического реестра:

```text
validFrom = address_metadata.fetchedAt
validTo = null
```

`expiresAt` определяет только freshness строки при freeze и не означает конец
принадлежности. Событие раньше `fetchedAt` не получает CEX boundary; событие в
этот момент или позже может её получить. Изменение live metadata после старта
не меняет frozen run, а restart использует прежний immutable dataset.

HTX/Huobi и другие event-time-sensitive identities требуют попадания route
event в interval. Текущий tag, появившийся после события, остаётся context.
Следовательно, этап A безопасно ускоряет только event-time-valid states и сам по
себе не ускорит старые anchors TQr. Ретроактивная история требует отдельного
append-only реестра с аттестованными интервалами; дата создания адреса и текущий
tag для этого недостаточны.

### Независимые risk facts

Этап A не добавляет новый prerequisite в уже определённую V2 predicate:
это изменило бы смысл активного V2 manifest. Exact custodial identity остаётся
структурной границей по существующему контракту. Санкции, blacklist и другие
risk facts сохраняются независимо и не обнуляются из-за service boundary.

Если отдельный risk source не имеет event-time evidence, он остаётся current
context и не становится historical fact. Более строгий adverse preflight как
обязательное условие применяется только к новой inferred boundary в V3.

### Completion mapping

Completion не разбирает строки вроде `cex:binance` вручную. Он разрешает
`labelCatalogEntryId` через frozen catalog и получает канонические:

```text
service identity
service category
terminal policy
authority
```

Один resolver используется boundary evidence, production completion и
service links. Это устраняет расхождение между `cex:binance` и legacy
`cex/exchange/whitebit`. V2 direct service link создаётся event-by-event только
при попадании transfer timestamp в interval; frozen identity нельзя добавлять
в address-wide `knownCounterparties` без временной проверки.

### Результат этапа A

- V1 неизменна;
- V2 начинает пропускать только exact и event-time-valid CEX-историю;
- hints и более поздние labels продолжают ветку;
- score и Telegram contract не меняются;
- migration не требуется: сырьё уже есть в `address_metadata`, а immutable
  records — в существующем frozen dataset;
- append-only исторический service registry, если понадобится, проектируется
  отдельно и не прячется в mutable `evidence_json`.

## Этап B. Queue fairness и selective transaction-info

Этап B не объединяется с Unified provider controller. Он исправляет конкретный
legacy путь, на котором задержался TXc.

### Приоритет кандидатов transaction-info

`Where` перестаёт считать любой `REVIEW/unknown` достаточной причиной для
дорогого TronScan `transaction-info`. Для route-critical transaction сначала
переиспользуется точное сохранённое или in-flight evidence по
`(chain, txHash, provider/schema version)`, затем выполняется дешёвый raw
preflight через существующий full-node путь `gettransactionbyid`.

Raw preflight фиксирует contract address/type, selector, caller и соответствие
ожидаемому official-USDT edge. Полный `transaction-info` вызывается только при
одном из triggers:

1. raw contract не является official USDT;
2. selector не равен простому `transfer(address,uint256)` (`a9059cbb`);
3. transfer row содержит `transfer_from`, Verify20, permit или другой
   non-plain method;
4. одна transaction содержит несколько official-USDT movements;
5. caller, contract, event, sender, receiver или amount не согласованы;
6. wrapper/proxy/GasFree/service-fee edge имеет нерешённую экономическую роль;
7. exact route-linked drainer/approval/contract assertion требует live
   подтверждения;
8. raw preflight недоступен или неоднозначен для route-critical transaction.

Если raw доказал вызов official USDT, ровно один простой transfer, полное
совпадение edge и отсутствие adverse assertion, full `transaction-info` не
вызывается. В evidence сохраняется причина `plain_usdt_raw_proven`.

Кандидаты дедуплицируются по tx hash до provider scheduling. Hard-evidence
triggers обрабатываются раньше optional context. Ошибка raw и full enrichment
даёт `coverage_incomplete/technical_unknown`, а не clean fact. Плоский label и
сам verdict `REVIEW` не являются triggers.

### Pacing

Жёсткая локальная последовательная пауза `15_000 ms` удаляется только после
того, как raw и full запросы проходят через существующий provider-group
scheduler/cache с in-flight dedupe. Он отвечает за endpoint pacing, cooldown,
429 и независимость ключей. Если endpoint действительно требует минимальный
интервал, он задаётся один раз на уровне endpoint group, а не как `N - 1`
последовательных пауз внутри каждого job.

Запрещено заменять очередь неконтролируемым `Promise.all`.

Для intermediate boundary probe действует максимум пять triggered
transaction-info requests. Превышение не отбрасывает facts: adverse gate
становится `incomplete`, inferred stop запрещается, а state продолжает обычный
traversal. Для subject нет произвольного hard cap: сокращение достигается
исключением обычных transfers из кандидатов и scheduler-backed pacing.

### Queue fairness

Starvation возникает до provider: единственный `activeWhereForensicPoll`
ожидает `runForensicJobsOnce`, а batch внутри последовательно ждёт до трёх jobs.
Новый timer tick возвращает тот же promise. Поэтому ни увеличение
`FORENSIC_WHERE_JOBS_PER_POLL`, ни простой `Promise.all` fixed batch не решают
refill: общий guard всё равно ждёт самый долгий job.

Минимальное тактическое исправление — маленький набор независимых Where-слотов:

- новый config `FORENSIC_WHERE_WORKER_CONCURRENCY`: default `1`, canary `2`,
  затем production `2` после acceptance;
- короткий `activeWherePumpPoll` защищает только reconciliation, stale recovery
  и заполнение свободных slots;
- каждый свободный slot claim-ит ровно один job через существующий PostgreSQL
  `FOR UPDATE SKIP LOCKED`, полностью исполняет его и сразу инициирует refill;
- pump заполняет slots, но не ожидает завершения всех активных promises;
- пустой claim ждёт следующего timer tick и не создаёт microtask spin;
- завершение или ошибка одного slot не блокирует другой;
- shutdown запрещает новые claims и дожидается реестра активных promises;
- Deep и Incoming lanes на этом этапе не меняются;
- общие TronScan concurrency limits не увеличиваются.

База остаётся единственным источником истины для claim и сохраняет
`priority DESC, created_at ASC`. Локальный реестр хранит только активные
execution slots, а не вторую очередь.

Concurrency `2` решает наблюдавшийся случай: один slot продолжает долгий TDEA,
второй берёт новый TXc на ближайшем poll. Это не абсолютная bounded-fairness
гарантия: два монолитных многочасовых jobs могут занять оба slots. Полная
гарантия старта при любой нагрузке потребовала бы checkpoint/yield/chunking.
Такое durable решение уже соответствует Unified lane; переписывать legacy Where
в preemptive scheduler в этом этапе не требуется.

### Остаточная очередь Deep

У TXc отдельный Deep child ждал 21 минуту 39 секунд в собственной singleton
lane. Where-slots и selective transaction-info эту задержку не скрывают и не
объявляются полным исправлением parent latency. В первом production patch Deep
concurrency не повышается: одновременно менять две тяжёлые lanes без измерения
provider headroom небезопасно.

Plan 2 добавляет одинаковые queue-age/active-slot diagnostics для Deep. После
Where canary отдельно воспроизводится TXc Deep queue. Если очередь остаётся
доминирующей причиной, маленький Deep slot-pool `default 1 / isolated canary 2`
проходит собственные memory, 429, duplicate-delivery и restart gates до любого
production повышения. Durable решение остаётся переводом новых user runs на
chunked Unified, а не бесконечным наращиванием legacy concurrency.

### Результат этапа B

- TXc-подобный адрес не тратит минуты на details обычных transfers;
- при одном долгом Where второй runnable job получает свободный slot;
- остаточная Deep queue измеряется и не маскируется в итоговом latency breakdown;
- provider safety сохраняется;
- пропущенный обязательный enrichment отражается как coverage/missing evidence,
  а не как clean fact.

## Этап C. Shadow service-behavior-profile-v1

### Почему сначала shadow

CSV-набор содержит 21 уникальный кошелёк и полезен для формулировки признаков,
но не является статистически откалиброванной population sample. Production
stop нельзя включать на тех же адресах, на которых подобраны пороги.

Shadow implementation:

- использует только уже accepted full direct/address histories;
- не делает дополнительных API-запросов;
- не изменяет frontier, terminals, closure, score, decision или delivery;
- сохраняет `wouldStop` и причины для blind review и performance replay.

### Artifact contract

`service-behavior-profile-v1` является run-scoped immutable artifact:

```text
version = service-behavior-profile-v1
schemaVersion = 1
policyVersion = service-behavior-research-v1
snapshotHash
address
role = subject | intermediate
anchorTimestamp
sampleInventory
features
windowScores
automationScore
serviceStructureScore
confidence
classification
humanAlternative
wouldStop
boundaryEligible
boundaryBlockers
adverseEvidenceRefs
```

В shadow policy `boundaryEligible` всегда равен `false`, а исследовательское
решение хранится отдельно как `wouldStop`. После adjudication та же schema может
использоваться с новой immutable production policy version; старые shadow
artifacts не получают новое значение задним числом.

`sampleInventory` содержит canonical event IDs, provider page hashes, окно,
число физических и канонических rows, число исключённых risk/poisoning rows и
причину каждого исключения. Сам профиль не хранит self-hash; его identity —
hash canonical artifact bytes в существующем artifact repository.

Отдельная глобальная profile table на этапе shadow не создаётся. Сначала
доказывается повторное использование; затем, при необходимости, проектируется
additive cache migration.

### Детерминированная выборка shadow

Для subject используются уже загруженные события:

- до 500 самых новых канонических events на snapshot;
- до 500 самых старых канонических events;
- пересечение дедуплицируется по canonical event identity.

Для intermediate профиль строится относительно route anchor:

- все события строго не позже `anchorTimestamp`;
- recent window — до 250 ближайших к anchor событий;
- historical window — до 250 событий, заканчивающихся не позже более ранней из
  двух границ: `anchor - 7d` и `recentWindowStart - 7d`;
- окна дедуплицируются;
- если full accepted history содержит меньше данных, профиль честно отражает
  фактическое количество и exhaustion.

Таким образом, окна не пересекаются и разделены минимум семью сутками: две
части одного короткого burst не становятся двумя независимыми периодами.
Для high confidence нужны не менее 100 канонических events в каждом окне,
не менее 300 уникальных events суммарно и временной разрыв не менее семи суток.

Для classification рассчитываются отдельные recent/historical automation
scores. Консервативный `automationScore` равен меньшему из двух, когда оба окна
qualifying; service structure считается на дедуплицированном объединении окон.
Так один экстремальный период не компенсирует спокойный второй период, а
объединённый sample до 500 событий всё ещё способен доказать широкую topology.

### Признаки автоматизации A

`automationScore` лежит в диапазоне 0–100 и является объяснимой суммой:

| Признак | Максимум |
|---|---:|
| события на календарный день наблюдаемого периода | 30 |
| медианный исходящий интервал | 25 |
| максимальное число исходящих в час | 20 |
| медианный охват активного дня | 15 |
| доля активных дней с охватом не менее 16 часов | 10 |

Стартовые bins адаптируют исследовательскую книгу к bounded canonical sample:

- events/day: `>=1000:30`, `>=100:24`, `>=40:18`, `>=20:12`, `>=10:6`;
- median outgoing gap: `<=15s:25`, `<=60s:20`, `<=300s:14`,
  `<=900s:8`, `<=1800s:4`;
- max outgoing/hour: `>=500:20`, `>=100:15`, `>=30:10`, `>=10:5`;
- median active-day span: `>=16h:15`, `>=12h:10`, `>=8h:5`;
- share of qualifying days spanning at least 16h:
  `>=50%:10`, `>=25%:5`.

Это намеренно не побайтовая копия Excel. В книге первый компонент использовал
`всего tx аккаунта / возраст`, а пятый — абсолютное `всего tx аккаунта`.
Production-профиль считает canonical official-USDT events/day внутри каждого
окна и заменяет абсолютный масштаб долей длительных активных дней. Иначе probe
зависел бы от полной истории, смешивал USDT с посторонними transactions и дважды
вознаграждал размер аккаунта. Поэтому A/S из книги и A/S profile-v1 нельзя
сравнивать как одно измерение; bins и пороги являются research hypothesis до
blind review.

Qualifying day содержит не менее пяти sample events. Пустой или неприменимый
признак даёт ноль и снижает confidence; он не подставляет благоприятное
значение.

### Признаки сервисной структуры S

`serviceStructureScore` также лежит в диапазоне 0–100:

| Признак | Максимум |
|---|---:|
| уникальные контрагенты | 25 |
| уникальные получатели | 25 |
| отношение контрагентов к canonical events | 15 |
| низкая концентрация крупнейшего контрагента | 15 |
| fan-in/fan-out geometry | 10 |
| размер canonical sample | 10 |

Для bounded sample абсолютные breadth bins масштабируются, иначе при лимите 500
physical rows порог S >= 80 был бы достижим только при ровно 500 чистых и
уникальных recipients. Profile-v1 использует:

- unique counterparties/recipients: `>=400:25`, `>=250:20`, `>=150:15`,
  `>=75:10`, `>=30:5`;
- counterparty ratio: `>=0.50:15`, `>=0.30:12`, `>=0.15:8`, `>=0.05:4`;
- top-counterparty share: `<=0.01:15`, `<=0.05:12`, `<=0.15:8`,
  `<=0.30:4`;
- geometry, первое совпавшее условие: one-to-many с outgoing share `>=0.95` и
  `>=200` recipients — 10; many-to-many с `>=150` senders и `>=75`
  recipients — 10; one-to-many с outgoing share `>=0.80` и `>=100`
  recipients либо many-to-many с `>=75` senders и `>=50` recipients — 8;
  `>=50` recipients — 5; иначе 0;
- sample size: `>=500:10`, `>=300:7`, `>=200:4`, `>=100:2`.

Excel raw bins сохраняются только как исследовательская колонка исходного
отчёта. Решение profile-v1 использует приведённые выше versioned bins; их
монотонность, достижимость внутри hard budget и false positives проверяются до
freeze production policy.

Малая сумма сама по себе не исключается: сервис действительно может массово
обрабатывать переводы по 1 USDT и меньше. Из breadth/geometry исключаются только
provider `riskTransaction`, exact versioned poisoning match, duplicate event и
недоказанная collision row. Все они остаются в отдельном evidence inventory с
причиной. Tiny amount сохраняется как контекстный feature, но не даёт
самостоятельных positive или adverse points.

### Confidence и классы

Confidence определяется отдельно от A/S:

- `high`: два независимых применимых окна, не менее 300 canonical events,
  достаточная временная протяжённость, exact anchor и полный sample inventory;
- `medium`: не менее 100 canonical events и хотя бы одно применимое окно;
- `low`: всё остальное.

Классификация вычисляется в следующем порядке:

| Класс | Условие |
|---|---|
| `insufficient_data` | confidence low или менее 100 canonical events |
| `high_inferred_service` | A >= 80, S >= 80, confidence high, нет сильной human alternative |
| `probable_service` | A >= 45, S >= 60, confidence не low |
| `service_like` | A >= 30, S >= 55, не менее 100 events |
| `professional_operator` | широкая структура при A < 45 и правдоподобном рабочем/дискреционном ритме |
| `human_like` | остальные достаточные выборки |

Сильная human alternative фиксируется, если хотя бы одно из условий мешает
high inferred:

- период короче семи суток;
- менее трёх активных дней;
- медианный исходящий gap больше 30 минут при max outgoing/hour меньше 10;
- один короткий burst без независимого периода;
- профиль зависит от входящей пыли или одного доминирующего контрагента.

Большая медианная сумма, баланс или оборот не являются ни positive feature, ни
human blocker: они показываются отдельно как контекст.

### Обязательные Golden cases

Положительные seed-примеры:

- `TWkvffFDMsqbmTLkMHMABmw452Hyq98cdn`;
- `TDEA1UnGUPETFiYs2uoZqjPjphJEaEGqTr`;
- exact `TCLgK89AnXbC9rewvhNb9UgXCc2qJJpBXh` только как known-service control.

Пограничный пример:

- `TBXv9qAU1UtbqAWDYEanLKoAjSVSH14eaf`.

Обязательные отрицательные примеры:

- TQr и TXc;
- длинные истории трейдеров/казначейств из CSV;
- однодневный профессиональный burst;
- кошелёк с большим оборотом и малым количеством событий;
- dust/poisoning-heavy адрес.

Адреса, использованные для выбора bins, не могут быть единственным blind test.
Перед production V3 нужен отдельный frozen набор, два blind reviews и
adjudication artifact.

### Результат этапа C

- в Admin/research artifact видны A, S, confidence, class и `wouldStop`;
- Telegram и пользовательский score неизменны;
- можно измерить потенциально пропущенные pages на frozen TQr replay;
- false-positive boundary на TQr/TXc равна нулю;
- ни один adverse case не получает `boundaryEligible = true`.

## Этап D. service_boundary_probe и snapshot-closure-v3

Этап D начинается только после acceptance этапа C. Он получает отдельный
implementation plan и отдельный rollout gate.

### Новая policy

Поведенческая terminal semantics добавляется только как новая immutable policy:

```text
snapshot-closure-v3
```

V1 и V2 не меняются. Manifest V3 обязательно связывает:

- label catalog version;
- boundary predicate version;
- service behavior policy version;
- sampling policy version;
- adverse preflight policy version;
- frozen adjudication identity.

Новый terminal reason:

```text
inferred_service_boundary
```

Он не переиспользует `identified_service_boundary` и явно показывает, что
identity неизвестна.

### Provider task

Cold intermediate получает отдельную ordered provider task
`service_boundary_probe` до создания полной `address_history`.

Identity содержит:

```text
snapshotHash
address
anchorTimestamp
samplingPolicyVersion
serviceBehaviorPolicyVersion
```

Run ID не входит в canonical provider request identity. Accepted task/artifact
всё равно связывается с конкретным run через planner и attempt contracts.

Provider request обязан передавать `endTimestamp = anchorTimestamp`. Нельзя
начинать от текущего snapshot и читать тысячи событий, произошедших после
исследуемого route event.

### Probe sampling

1. Первые две provider pages, не более 100 физических rows, образуют triage.
2. Если triage не достигает ни `A >= 30`, ни `S >= 55`, probe завершается
   non-terminal и планируется обычная история.
3. Candidate расширяется до двух окон максимум по пять страниц и 250
   физических rows, суммарно не более десяти страниц и 500 физических rows.
4. Physical rows, отфильтрованные как risk/poisoning/duplicate, не расходуют
   canonical score count, но расходуют provider/page budget, входят в raw
   inventory и adverse gate.
5. Если provider не может доказать оконную полноту или event-time ordering,
   profile становится incomplete.

Probe использует тот же content-addressed provider-page/event cache. Совпавшая
exact request identity не может вызвать второй HTTP request. Различные
cursor/time-window identities не объявляются reuse задним числом: их overlap
измеряется отдельно. Дополнительная цена неуспешного probe остаётся жёстко
ограниченной десятью страницами.

### Дедупликация по anchor

Первая V3 дедуплицирует только states с точным совпадением
`(snapshotHash, address, anchorTimestamp, samplingPolicyVersion,
serviceBehaviorPolicyVersion)`. Профиль одного anchor нельзя применять к более
раннему или более позднему anchor: отсутствие future leakage ещё не доказывает,
что поведение кошелька не изменилось со временем или после смены контроля.

Разные anchors могут переиспользовать только exact provider page/request bytes
через content-addressed cache, но получают отдельные profile и terminal
decisions. Более широкое validity window разрешается лишь новой policy version
после отдельной temporal adjudication; календарный bucket не вводится скрыто.

### Adverse gate

`high_inferred_service` может стать terminal только когда:

- role равна `intermediate`;
- address доказан как EOA;
- confidence high;
- два независимых окна выполнены;
- frozen behavior policy adjudicated;
- нет human alternative;
- adverse preflight завершён и не содержит блокирующего факта.

Блокирующие причины:

```text
subject_address
contract_or_role_unresolved
sample_insufficient
event_time_invalid
behavior_policy_not_adjudicated
blacklist_or_sanction_at_event
drainer_or_dangerous_approval
risky_contract_or_verify20_match
provider_risk_unresolved
adverse_preflight_incomplete
probe_failed
probe_budget_exhausted
```

Verify20/contract intelligence вызывается через API только для triggered
contract/approval edges. Сохранённая flat label не заменяет selector/signature,
tx/event binding и authority. Route-linked approval-drain assertion остаётся
context и не становится exact direct proof.

Если adverse найден или gate incomplete, state получает context evidence и
продолжает обычную полную историю. Adverse fact должен попасть в versioned
Unified evidence inventory даже когда boundary не создана.

Текущий `unified-direct-hard-evidence-v1` не переосмысляется: его плоских
массивов недостаточно для triggered contract proof. V3 добавляет отдельный
immutable `service-boundary-adverse-preflight-v1`, в котором каждая проверка
содержит:

```text
kind = sanction | blacklist | approval | drainer | verify20 | risky_contract |
       provider_risk
subjectRole
addressOrContract
txHash
eventIdentity
selectorOrSignature
eventTimestamp
effectiveFrom / effectiveTo
authority
sourceRequestHash
outcome = proven | not_found | unresolved
```

Неприменимые поля явно `null`, а не исчезают. `not_found` допустим только после
успешного authoritative запроса; timeout, unsupported schema и budget overflow
дают `unresolved`. Profile и terminal evidence ссылаются на hash этого
artifact, поэтому негативный API-результат, положительный Verify20 match и
неполное покрытие воспроизводятся раздельно.

### Terminal commit

Boundary evidence V3 содержит:

- canonical traversal state identity;
- subject/intermediate role;
- snapshot и event time;
- behavior/sampling/adverse policy versions;
- profile artifact hash;
- canonical sample/page hashes;
- A, S, confidence и classification;
- adverse preflight artifact hash;
- `identityKnown = false`;
- reason `inferred_service_boundary`.

Evidence и bounded traversal delta сохраняются до checkpoint тем же
content-addressed, idempotent и restart-safe способом, что V2. Только traversal
coordinator изменяет frontier/terminal state.

### Scoring и presentation

- `high_inferred_service`, `probable_service` и `service_like` дают ноль AML
  points;
- V3 boundary не уменьшает transit, collector или hard-evidence score;
- matrix-v4 остаётся неизменной;
- completion показывает отдельный context:
  `Высокоуверенная неразмеченная сервисная граница; identity неизвестна`;
- known service и inferred service не объединяются в один label;
- числовой score dampening возможен только в отдельной matrix-v5 после новой
  adjudication.

## Failure и restart semantics

- malformed/stale metadata candidate — `continue` и diagnostic rejection;
- hash/schema mismatch уже принятого frozen authoritative record — invariant
  failure, а не hint;
- unsupported provider tag или context/risk assertion — non-terminal, а не
  ошибка всей проверки;
- отсутствующий probe — обычная полная история;
- provider failure probe — полный путь или обычная provider failure semantics,
  но никогда inferred stop;
- hash mismatch accepted artifact — invariant failure;
- crash после artifact insert и до checkpoint оставляет переиспользуемый
  unreferenced artifact и не открывает terminal state;
- event wake новой task участвует в controller flow; timer recovery не
  маскируется как нормальный event;
- существующий run всегда возобновляет frozen policy из manifest;
- fallback меняет только default новых runs.

## Observability

Без адресов и key material в metric labels сохраняются:

- exact boundary candidates/accepted/rejected и причины;
- queue wait по job kind;
- transaction-info candidates/requested/cache hits/provider waits;
- shadow class distribution;
- `wouldStop` count и blocker distribution;
- probe physical/canonical rows и pages;
- pages reused после non-terminal probe;
- estimated и replay-proven avoided pages;
- adverse-preflight outcomes;
- restart/reconciliation reason.

Admin drill-down по конкретному run может показывать адрес и evidence hashes,
поскольку это не metric label и доступ уже ограничен существующей Admin
моделью.

## Проверки

### Этап A

Тесты обязаны доказать:

- exact registry и event-time-valid exact provider tag дают terminal V2;
- matcher принимает закреплённые `Binance-Hot 8`, `HTX 4`, `Okex 1`, `MXC 2`,
  но отвергает name-only, `Fake Binance`, generic `exchange`, несовпадающие raw
  address/tag, stale и post-snapshot rows;
- `address_metadata.verified`, flat/cache label, classifier hint, proximity и
  route-linked assertion не дают terminal;
- label с `validFrom` позже route event не останавливает state;
- изменение payload, времени или matcher version меняет source hash;
- изменение live metadata после freeze не меняет dataset или restart;
- catalog resolver создаёт корректный `serviceLink` для `cex:binance` и других
  CEX identities только для event-time-valid transfer;
- accepted CEX terminal фиксируется до планирования `address_history`;
- restart не меняет dataset или terminal facts;
- V1 bytes и поведение неизменны.

### Этап B

Тесты обязаны доказать:

- raw-proven обычный USDT `Transfer` не вызывает full transaction-info;
- Verify20 wrapper, approval, `transferFrom`, permit, non-plain selector,
  multi-movement и unresolved GasFree/service-fee вызывают full enrichment;
- `REVIEW` без других triggers не вызывает full enrichment;
- одинаковый tx hash запрашивается один раз и переиспользуется ветками/jobs;
- отказ raw вызывает full fallback, а отказ обоих источников даёт incomplete;
- pacing выполняет provider scheduler, а не локальный 15-секундный sleep;
- 429/cooldown не создаёт busy-loop;
- overflow intermediate probe запрещает boundary;
- при concurrency `2` заблокированный первый job не мешает второму войти в
  handler не позднее двух poll intervals; при concurrency `1` fixture
  воспроизводит head-of-line blocking;
- одновременно работает не больше configured slots, каждый ID claim-ится один
  раз, FIFO/priority базы сохраняются;
- свободный slot refill-ится без ожидания остальных, пустая очередь не spin-ит,
  ошибка одного slot не останавливает другой;
- shutdown прекращает новые claims, видит и дожидается активных promises;
- Incoming и Deep продолжают обслуживать собственные lanes;
- FIFO внутри одинакового kind/priority сохраняется;
- TXc frozen replay сохраняет forensic facts при меньшем числе provider calls.

### Этап C

Pure tests фиксируют каждую bin-границу A/S, пустые признаки, dedupe,
risk/poisoning exclusion, два независимых окна, event-time cutoff, confidence,
human alternatives и class order. Отдельный property test доказывает
монотонность bins и достижимость `S >= 80` внутри 500-row physical budget без
требования ровно 500 canonical recipients.

Golden tests требуют:

- TWkv и TDEA — high inferred в research shadow;
- TQr — professional operator, `wouldStop = false`;
- TXc — insufficient/professional transit, `wouldStop = false`;
- TBX — probable или service-like, но не production stop;
- однодневный burst — не high confidence;
- dust-heavy адрес не получает ложную широту;
- adverse fixture никогда не boundary-eligible;
- shadow mode не меняет closure, score, report hash или delivery intent.

### Этап D

V3 tests требуют:

- subject никогда не terminal;
- contract/bridge/DEX никогда не behavioral terminal;
- только high-confidence adjudicated profile с complete clean adverse gate
  создаёт `inferred_service_boundary`;
- candidate, probable, service-like, insufficient, adverse и incomplete
  продолжают полную историю;
- profile не читает events после anchor;
- Verify20/approval/drainer trigger создаёт API-bound adverse artifact с
  selector/signature и tx/event binding; flat label этого не делает;
- timeout/overflow сохраняется как `unresolved` и запрещает boundary, а
  доказанный `not_found` не смешивается с отсутствующим запросом;
- одинаковый exact anchor дедуплицируется, а разные anchors получают отдельные
  profile decisions без temporal leakage;
- probe pages повторно используются полной history;
- capacity и completion order не меняют terminal facts;
- crash/restart не дублирует task, evidence или delta;
- barrier/rolling exact replay равны внутри V3;
- matrix-v4 facts и score не меняются от service likelihood.

## Acceptance criteria

### Безопасность

- ноль false-positive production boundaries на locked negative set;
- ноль suppressed hard-risk facts;
- ноль inferred boundaries при incomplete adverse gate;
- ноль event-time future leakage;
- все terminal decisions воспроизводятся по persisted bytes;
- V1/V2 existing-run compatibility сохраняется.

### Производительность

- authoritative V2 replay не загружает history за exact valid CEX states;
- TQr replay показывает отдельно event-time-valid экономию exact labels
  (включая честный ноль для post-event observations) и потенциальную экономию
  shadow `wouldStop`;
- non-terminal probe не повторяет HTTP request с той же exact identity, а
  неизбежный overlap разных окон измеряется;
- TXc replay исключает transaction-info для ordinary transfers;
- с одним занятым Where-slot свежий TXc стартует не позднее пяти секунд при
  concurrency `2`; отсутствие абсолютной гарантии при двух занятых slots явно
  отражено в diagnostics;
- число 429/provider errors и повторных Telegram deliveries не растёт;
- увеличение provider capacity не является условием достижения результата.

### Rollout

1. Этап A выпускается с user default V1 и isolated V2 replay/canary.
2. Этап B выпускается независимо после TXc replay и fairness tests.
3. Этап C работает только shadow и собирает blind-review dataset.
4. После двух blind reviews и adjudication создаётся frozen behavior policy.
5. Код V3 выпускается disabled by default.
6. Изолированный V3 replay и live canary подтверждают closure, restart,
   provider work, memory и отсутствие delivery.
7. Только после gate новый-run default может быть изменён отдельным решением.

## Разбиение реализации

После письменного утверждения создаются четыре отдельных implementation plans:

1. `unified-authoritative-service-boundaries` — rich ingestion, temporal rules,
   независимое сохранение risk facts и completion resolver;
2. `where-queue-and-transaction-info-latency` — candidate selection, provider
   pacing и bounded fairness;
3. `service-behavior-shadow-profile` — pure features, artifacts, Golden и
   observability без runtime stop;
4. `unified-inferred-service-boundary-v3` — только после shadow adjudication.

Первым выполняется plan 1. Plans 1 и 2 могут быть выпущены без V3. Plan 4 не
начинается до зафиксированного acceptance результата plan 3.

## Не входит в scope

- обучение ML-модели на 21 CSV-кошельке;
- автоматическое присвоение brand identity inferred адресу;
- глобальный 500-row hard cap итоговой проверки;
- произвольный timeout полного Unified closure;
- изменение matrix-v4 или автоматическое снижение риска;
- добавление API-ключей как основной способ ускорения;
- order-independent traversal merge;
- автоматическое backdating текущего provider tag;
- переписывание старых manifests, artifacts или migrations;
- автоматический rollout V3 без blind review и canary.

## Зафиксированные решения

- TQr и TXc — отрицательные boundary cases.
- `Сервисная структура /100` — структурный score, не вероятность.
- Inferred service — identity unknown и 0 AML points.
- 500 — probe budget, а не предел полной истории.
- Subject всегда получает полный Unified analysis.
- Intermediate high inferred может стать boundary только в V3.
- Verify20 и approval/drainer evidence проверяются через trigger-based API path,
  а не считаются присутствующими из-за плоского label.
- Первое production-ускорение — authority-preserving exact CEX boundaries.
- Второе независимое ускорение — selective transaction-info и queue fairness.
- Поведенческая логика сначала поставляется только shadow.
