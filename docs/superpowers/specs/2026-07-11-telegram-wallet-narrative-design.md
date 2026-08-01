# Индивидуальная выжимка проверки кошелька в Telegram

Дата: 2026-07-11

Статус: утверждённый дизайн, перед implementation plan

## Задача

Текущий итоговый отчёт Telegram повторяет одни мысли в разделах `Почему`,
`Что это может значить`, `Что делать` и `Что важно учесть`. Технические
оговорки занимают больше места, чем сам результат.

Нужна короткая индивидуальная выжимка. Пользователь должен сразу понять:

- проводить ли операцию;
- что произошло с деньгами;
- какую роль играет проверяемый адрес;
- какой факт определил решение;
- с каким прямым контрагентом связана проверка, в каком направлении и на какую
  сумму;
- какую долю суммы удалось проследить;
- почему остальная часть не прослежена.

## Аудитория

Основной пользователь знаком с кошельками, переводами, биржами и USDT, но не
обязан знать `coverage`, `source-policy`, `transferFrom`, `layering`, внутренние
режимы проверки и коды доказательств.

Обычный отчёт:

- пишет по-русски;
- говорит о деньгах, переводах и роли адреса;
- не показывает внутренние коды;
- не перечисляет отсутствующие плохие признаки;
- не оправдывает каждый нейтральный факт фразой «это не доказывает кражу».

## Почему пользовательский текст не пишет LLM

Live-прогон `deepseek-v4-flash` и `deepseek-v4-pro` на сохранённых кейсах не
дал ни одного текста, который можно было бы публиковать без проверки. Модели
выдумывали KYC, миксеры, DeFi, фишинг, blacklist, отменённые транзакции,
управление эмиссией и другие отсутствующие факты.

Пользовательский текст строится детерминированно из сохранённых полей отчёта.
LLM не используется ни как автор, ни как selector. Существующий bounded LLM
классификатор контрактов остаётся отдельным внутренним механизмом и не пишет
финальную выжимку.

## Формат сообщения

Шапка показывает score, цветной индикатор, уровень и действие:

```text
🟢 25/100 — низкий риск. Можно принять.
🟡 45/100 — средний риск. Поставьте операцию на паузу и проверьте вручную.
🟠 78/100 — высокий риск. Операцию не проводить.
🔴 95/100 — критический риск. Операцию не проводить.
```

Эмодзи и словесный уровень берутся из score band. Действие берётся только из
canonical decision:

- `ACCEPTABLE` — `Можно принять.`;
- `REVIEW` — `Поставьте операцию на паузу и проверьте вручную.`;
- `DECLINE` — `Операцию не проводить.`;
- `NO_FINAL_DECISION` — итоговый score не публикуется.

Score сам не подменяет решение. Если score band и policy decision расходятся,
бот сохраняет честный score и явно пишет canonical action.

При `NO_FINAL_DECISION` итоговый score не показывается:

```text
⚪ Итог не рассчитан. Поставьте операцию на паузу до повторной проверки.
```

Фраза `не принимать автоматически` удаляется. Она не объясняет, можно ли
проводить операцию.

После шапки идут не больше трёх частей:

1. главный факт;
2. один дополнительный факт, если он меняет понимание адреса;
3. существенное ограничение данных.

Заголовки `Почему`, `Что делать` и `Что важно учесть` не используются.
Обычный объём основного текста — 200–500 знаков.

## Narrative case

```ts
type NarrativeAddressRole =
  | "victim"
  | "verify20_contract"
  | "drainer_spender"
  | "first_receiver"
  | "route_linked"
  | "approval_only"
  | "interaction_only"
  | "collector"
  | "unknown";

type NarrativeFactKind =
  | "usdt_blacklist"
  | "direct_counterparty_blacklist"
  | "direct_counterparty_sanction"
  | "direct_counterparty_exact_label"
  | "verify20_template"
  | "approval_drain"
  | "sanctioned_source"
  | "bridge_route"
  | "cex_source"
  | "risky_counterparty"
  | "unknown_contract"
  | "collector"
  | "gasfree_fee"
  | "coverage";

type WalletNarrativeCase = {
  locale: "ru" | "en";
  decision: "DECLINE" | "REVIEW" | "ACCEPTABLE" | "NO_FINAL_DECISION";
  score: number | null;
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  checkedAddress: string;
  checkedTransferCount: number | null;
  tracedAmountPercent: number | null;
  untracedAmountPercent: number | null;
  facts: NarrativeFact[];
  firstHopBlacklistCoverage: FirstHopBlacklistCoverage;
  coverageExplanation: CoverageExplanation | null;
};

type NarrativeFact = {
  id: string;
  kind: NarrativeFactKind;
  role: NarrativeAddressRole | null;
  proofStrength: "exact" | "strong" | "context" | "limitation";
  priority: number;
  factTextRu: string;
  factTextEn: string;
};

type CoverageExplanation = {
  reasonKind: string;
  textRu: string;
  textEn: string;
  isRiskEvidence: false;
};
```

Raw reason strings не попадают в обычный Telegram.

Точные first-hop факты не восстанавливаются из `snapshot.reasons`. Producer
сохраняет отдельную структурированную запись:

```ts
type FirstHopTemporalRelation =
  | "active_at_transfer"
  | "became_active_after"
  | "mixed"
  | "unknown";

type UsdtBlacklistTimelineEvent = {
  eventKind: "added" | "removed";
  occurredAt: string;
  txHash: string;
  tokenContract: string;
  blockNumber: number | null;
  logIndex: number | null;
  verification: "verified_contract_log" | "unverified";
};

type FirstHopBlacklistFact = {
  counterpartyAddress: string;
  direction: "inbound" | "outbound";
  evidenceKind: "usdt_blacklist";
  evidenceAuthority: "official_contract";
  statusAtCheck: "active" | "inactive" | "unknown";
  temporalRelation: FirstHopTemporalRelation;
  effectiveAt: string | null;
  effectiveTxHash: string | null;
  checkedAt: string;
  principalAmountRaw: string;
  principalTxCount: number;
  directionalPrincipalShare: number | null;
  shareSemantics: "exact" | "lower_bound" | "unavailable";
  transferTxHashes: string[];
  beforeEffectiveAmountRaw: string;
  beforeEffectiveTxCount: number;
  activeAmountRaw: string;
  activeTxCount: number;
  unknownTimingAmountRaw: string;
  unknownTimingTxCount: number;
  directTransferCoverage: "complete" | "partial";
  timelineCoverage: "complete" | "partial";
  timelineEvents: UsdtBlacklistTimelineEvent[];
};

type FirstHopBlacklistCoverage = {
  requiredForDecision: boolean;
  scope: "all_time" | "checked_window";
  windowStart: string | null;
  windowEnd: string | null;
  directPrincipalTransferCoverage: "complete" | "partial";
  materialCounterpartyCount: number;
  checkedMaterialCounterpartyCount: number;
  failedMaterialCounterpartyCount: number;
  uncheckedMaterialCounterpartyCount: number;
  blacklistCheckCoverage:
    | "complete"
    | "running"
    | "provider_failed"
    | "budget_exhausted"
    | "history_partial";
  incompleteReason: string | null;
  confirmedAdverseFactCount: number;
  completeTimelineFactCount: number;
  partialTimelineFactCount: number;
};

type FirstHopLabelFact = {
  counterpartyAddress: string;
  direction: "inbound" | "outbound";
  labelCode: RiskLabel;
  evidenceAuthority: "exact_internal" | "derived";
  recordedAt: string;
  effectiveAt: null;
  principalAmountRaw: string;
  principalTxCount: number;
  directionalPrincipalShare: number | null;
  shareSemantics: "exact" | "lower_bound" | "unavailable";
  transferTxHashes: string[];
  linkedToSelectedProvenance: boolean;
};
```

Один контрагент с входящими и исходящими переводами создаёт два направленных
факта. Если переводы были и до, и после даты метки, суммы и количество
разделяются; агрегат не получает одну неточную дату.

Для каждого факта действует инвариант: суммы и количества в `before`, `active`
и `unknown` вместе равны всей principal-связи. Report-level coverage хранится
даже когда плохих фактов не найдено: отсутствие `FirstHopBlacklistFact` не
означает, что все материальные контрагенты проверены.

## Роль адреса

Роль берётся из существующего `walletRoleClassifier` и approval-drain профиля:

| Роль | Пользовательский смысл | Действие сигнала |
|---|---|---|
| `victim` | с адреса списали USDT | не считать адрес дрейнером |
| Verify20 contract | контракт совпал с известным шаблоном | операция запрещена |
| `drainer_spender` | контракт получил доступ и списал USDT | операция запрещена |
| `first_receiver` | адрес первым получил списанные USDT | операция запрещена |
| route-linked | адрес получил деньги дальше по цепочке | решение по глубине, доле и сохранению суммы |
| approval only | адрес открыл доступ, списания ещё нет | отозвать разрешение |
| interaction only | роль не установлена | ручная проверка |

Один адрес не получает одновременно противоречивые роли. `victim` подавляет
дрейнер-формулировки для проверяемого адреса.

## Verify20

Обычный `transferFrom` не является пользовательским сигналом и отдельно не
показывается. Это стандартный механизм TRC20.

`Verify20` определяется не поиском одного слова, а точным совпадением с
известным семейством контрактов. Минимальный детерминированный fingerprint
включает согласованный набор селекторов и сигнатур:

- `5082dd12` — `Verify20(address,address,address,uint256)`;
- `fc61dd23` — `Verify10(address,uint256)`;
- `ea4418d9` — `withdrawAllTrxTo(address)`;
- `f2fde38b` — `transferOwnership(address)`.

Совпадение требует полного набора и отсутствия доверенной сервисной метки.
Одно название метода или один selector недостаточны.

Если проверяется сам контракт с точным Verify20 fingerprint, это отдельный
детерминированный drainer-template сигнал: `DECLINE`, floor `85/100`. Это
доказательство совпадения с известным шаблоном, но не утверждение о конкретной
сумме или жертве. Exact `approve -> transferFrom -> receiver` по-прежнему
остаётся более сильным доказательством с floor `95/100`.

Для обычного кошелька взаимодействие с Verify20 не переносит drainer-роль
автоматически. Сначала определяется роль: жертва, первый получатель, следующее
звено или только взаимодействие.

## Тексты сильных сигналов

Active USDT blacklist:

```text
Адрес находится в чёрном списке USDT. Переводы USDT для него заблокированы.
```

Verify20 без найденного списания:

```text
Контракт совпадает с известным шаблоном дрейнера Verify20. Такие контракты
списывают USDT после того, как владелец открыл им доступ.
```

Разрешение выдано, списания нет:

```text
Кошелёк открыл контракту Verify20 доступ к USDT. Списания пока не было.
Отзовите разрешение.
```

Жертва:

```text
С кошелька списали 850 USDT после разрешения контракту. Проверяемый адрес —
жертва.
```

Контракт-дрейнер:

```text
Проверяемый контракт получил доступ к USDT и списал их с двух кошельков. Это
контракт-дрейнер.
```

Первый получатель:

```text
Кошелёк первым получил 3 857 USDT, списанные с двух других адресов. Это первый
получатель в подтверждённой дрейнер-цепочке.
```

Следующее звено:

```text
Кошелёк получил деньги от первого получателя дрейнера через один перевод. До
него дошло 96% списанной суммы. Это следующее звено дрейнер-цепочки.
```

## Мосты, биржи и сервисы

Мост не подаётся как нейтральный источник. Переход между сетями разрывает
видимую в TRON историю и повышает AML-риск. При этом amount-aware scoring
сохраняется: один небольшой перевод и повторяющийся материальный маршрут не
получают одинаковый score.

Один маршрут через мост:

```text
Вся проверяемая сумма пришла через мост UsdtOFT. История денег до моста
находится в другой сети и не видна в TRON.

Мосты используют как для обычного обмена, так и для сокрытия происхождения
денег. Поэтому такой источник повышает AML-риск.
```

Повторяющийся маршрут:

```text
83% проверяемой суммы пришло через мост UsdtOFT в десяти переводах. После
поступления деньги быстро уходили дальше.

Такой маршрут усложняет отслеживание происхождения денег. Для обычного
клиентского депозита он нетипичен и заметно повышает риск.
```

HTX/Huobi:

```text
40% проверяемой суммы пришло с HTX. HTX/Huobi находится под санкциями
Великобритании с 26 мая 2026 года.

Для переводов после этой даты это санкционный источник. Операцию не проводить.
```

До даты designation HTX остаётся историческим source-policy контекстом, но не
нейтральной обычной биржей. Такая связь продолжает давать `REVIEW` и должна
быть явно названа: принимающая биржа может задержать средства и запросить
дополнительную проверку их происхождения. После даты designation применяется
существующая санкционная политика.

Обычная биржа:

```text
72% проверяемой суммы пришло с Binance в четырёх переводах. Это похоже на вывод
средств с биржи.
```

Неизвестный контракт:

```text
Часть денег пришла через контракт без названия. Источник до контракта не
установлен.
```

Сам факт `isContract` не создаёт риск и не останавливает трассировку.

## Поведение и комиссии

Кошелёк-сборщик:

```text
Кошелёк собирает переводы от 18 адресов и отправляет 98% поступлений на Bybit.

Это кошелёк-сборщик, который концентрирует деньги на бирже. Такой режим работы
сам по себе даёт небольшой риск.
```

Рискованный контрагент:

```text
35% проверяемой суммы пришло от адреса с высоким риском. Повышенный риск
относится к этой части суммы.
```

## Прямой контрагент в USDT blacklist

Текущий `directCounterpartyInteractionProfile` недостаточен для итогового
решения: он хранит переводы, но сворачивает источник blacklist в общий snapshot,
не сохраняет дату события, а scoring безусловно превращает его в
`counterparty_context` с потолком 59.

Новая модель разделяет три утверждения:

1. сам проверяемый адрес находится в blacklist;
2. проверяемый адрес получил USDT от контрагента в blacklist;
3. проверяемый адрес отправил USDT контрагенту в blacklist.

Второе и третье — точные факты о прямой связи, но не утверждение, что сам
проверяемый адрес заблокирован. Исходящая связь также не называется
происхождением текущего баланса.

Каждый material principal-контрагент проходит один набор проверок: current USDT
blacklist, официальный sanctions registry, exact/derived internal labels и
service classification. Проверка одинакова для кошелька, GasFree Account и
неизвестного контракта. Меняется не сбор фактов, а их интерпретация.

### Строгая policy

Утверждён вариант 3: любая материальная прямая связь с контрагентом, который
сейчас находится в активном USDT blacklist, даёт `DECLINE` независимо от даты
блокировки контрагента.

Материальная связь определяется существующим правилом:

- не менее 10 000 USDT независимо от доли; или
- не менее 100 USDT и не менее 1% principal-объёма соответствующего
  направления.

Абсолютная ветка `10 000 USDT` работает и при неполной истории: сама сумма
подтверждена переводами. Ветка `100 USDT + 1%` работает только при полном
principal-denominator соответствующего направления. При partial history доля
помечается как `lower_bound` или `unavailable` и не создаёт `DECLINE`.

Для matrix создаётся отдельный `direct_counterparty_policy`, а не
`hard_proof` проверяемого адреса и не generic `counterparty_context`.
Кандидат получает `can_decline`. При полном denominator score равен
`max(60, scoreContribution)` с cap 90. При `shareSemantics != exact` нельзя
использовать relative share и tx-share из partial-окна: абсолютная ветка
10 000 USDT получает amount-only score 60. Поэтому partial history не может
ложно повысить score до 90, а связь почти на весь полный объём сохраняет текущий
вклад 90.

Этот row применяется только к сочетанию `usdt_blacklist + official_contract +
statusAtCheck=active`. Санкции и внутренние метки не наследуют strict option 3.

Matrix contract:

- row: `direct_counterparty_policy`, приоритет сразу после blacklist самого
  проверяемого адреса;
- action unit: `wallet` в Deep/Wallet и `incoming_deposit` только для
  конкретного проверяемого депозита;
- subject: проверяемый адрес, direction хранится modifier;
- score: `max(60, scoreContribution)`, cap 90;
- evidence ids: tx прямой связи, blacklist-event tx и current contract-state
  evidence;
- authority: `policy/can_decline` с `coverageDependency=none`, потому что
  прямой перевод и текущее состояние контрагента проверены независимо от
  происхождения остальных денег.

Это точечное изменение canonical resolver. Такой independent policy-кандидат
сохраняет `DECLINE`, даже если unrelated provenance или остальные first-hop
проверки имеют partial coverage. Бот отдельно пишет об ограничении. Partial
coverage без положительного факта по-прежнему не считается чистым результатом.

Хронология меняет объяснение, но не отменяет strict policy:

- `active_at_transfer` — `Перевод выполнен адресу, который уже находился в
  чёрном списке USDT.`;
- `became_active_after` — `Контрагент был внесён в чёрный список USDT после
  перевода.`;
- `mixed` — отдельно показываются суммы до и после блокировки;
- `unknown` — `На момент проверки контрагент находился в чёрном списке USDT.
  Дату блокировки установить не удалось.`

Направление пишется первым:

```text
Входящий: адрес получил 25 000 USDT от контрагента, который на момент проверки
находился в чёрном списке USDT.

Исходящий: адрес отправил 25 000 USDT контрагенту, который на момент проверки
находился в чёрном списке USDT.

Смешанная дата: до блокировки прошло 20 000 USDT, после блокировки — 5 000
USDT.
```

Если дата неизвестна, нельзя писать, что blacklist уже действовал или появился
позже. `AddressLabel.createdAt` — дата записи нашей метки, а не доказанная дата
начала плохой активности.

### Источник хронологии

Текущий поиск по 50 последним глобальным событиям `AddedBlackList` удаляется из
этого пути. После положительной проверки текущего состояния система запрашивает
официальный адресный
[TronScan endpoint](https://docs.tronscan.org/en/api/deep-analysis/blacklist)
`/api/stableCoin/blackList`, получает события для контрагента и проверяет
tx/log официального контракта USDT.

Provider DTO валидируется до попадания в forensic report:

```ts
type TronScanBlacklistRow = {
  blackAddress: string;
  tokenName: string;
  num: string;
  time: number; // Unix seconds
  transHash: string;
  contractAddress: string;
};

type UsdtBlacklistTimeline = {
  events: UsdtBlacklistTimelineEvent[];
  pagination: "complete" | "partial";
  failureReason:
    | "provider_failed"
    | "address_mismatch"
    | "wrong_contract"
    | "transaction_unconfirmed"
    | "event_log_unverified"
    | "state_timeline_inconsistent"
    | null;
};
```

`time` переводится из Unix seconds в ISO один раз. Endpoint служит индексом
tx-кандидатов: `eventKind`, block и log index берутся только из подтверждённого
contract log. Timeline считается полной, когда получены все страницы
`rows == total`, адрес и USDT contract совпали, каждый tx подтверждён, все
логи декодированы, а последовательность событий согласуется с current contract
state. Иначе relation становится `unknown`, а coverage — `partial` с причиной.

Проверяются `AddedBlackList` и снятие ограничения. При повторном добавлении или
неполной истории temporal relation остаётся `unknown`. Переводы с одинаковым
timestamp и недоказанным порядком внутри блока также не получают выдуманную
последовательность.

### Кейс `TGyt...BZAZD`

Два principal-перевода в `TWGC...dTm`:

- 15 USDT в 09:44:33 UTC;
- 1 176 302 USDT в 09:56:18 UTC;
- всего 1 176 317 USDT, или 100% исходящего principal-объёма.

`TWGC...dTm` был внесён в USDT blacklist в 12:49:03 UTC транзакцией
[`2413649b...05a5c`](https://tronscan.org/#/transaction/2413649b2f5b898b156b533e60f0066e727a0a4b96d7384d7ba37cdb1c005a5c).
Первый перевод был за 3 часа 4 минуты 30 секунд до события, перевод на
1 176 302 USDT — за 2 часа 52 минуты 45 секунд.

Итоговый текст:

```text
🔴 90/100 — критический риск. Операцию не проводить.

С проверяемого адреса отправили 1 176 317 USDT на TWGC…dTm. Этот получатель
на момент проверки находился в чёрном списке USDT. На него пришлась вся
исходящая сумма без учёта 3 USDT комиссии GasFree.

Получателя внесли в чёрный список через 2 часа 52 минуты после перевода на
1 176 302 USDT. Сам проверяемый адрес в чёрный список не внесён.
```

Фраза `через 2 часа 52 минуты` относится к переводу на 1 176 302 USDT. Для
двух переводов нельзя писать один общий интервал без уточнения.

### Санкции и внутренние метки

First-hop screening продолжает проверять санкции и внутренние метки для тех же
материальных principal-контрагентов, но strict option 3 относится только к
официальному USDT blacklist.

Входящий санкционный источник после designation date сохраняет существующий
`source_policy/DECLINE` только когда тот же transfer входит в выбранный
Where/Incoming provenance. Прочая историческая first-hop inbound связь остаётся
`REVIEW` context. До designation date связь также остаётся историческим
контекстом. Исходящий перевод на санкционный сервис показывается как отдельная
прямая связь и остаётся `REVIEW`, пока для destination-sanctions не утверждена
отдельная policy. Направление, principal-сумма и доля сохраняются.

Exact internal label показывает текущую прямую связь и конкретный тип метки.
Он меняет решение только по уже существующим label-specific правилам или при
подтверждённой роли в цепочке. Derived/proximity label остаётся контекстом.
Время создания внутренней записи не выдаётся за время преступления,
блокировки или санкционного назначения.

Конкретный `RiskLabel` сохраняется в `FirstHopLabelFact.labelCode`. Formatter
не разбирает `snapshot.reasons` и не угадывает тип метки по тексту.

GasFree:

```text
GasFree удержал комиссию перед переводом и отправил её провайдеру. Это комиссия
сервиса.
```

GasFree fee исключается из происхождения денег, peer diversity и обычного risk
propagation. GasFree Account остаётся трассируемым и оцениваемым адресом.

Для adverse first-hop факта используются только `principalAmountRaw`,
principal tx count и доля principal-объёма. Gross-поля, включающие комиссию, в
такой текст и score не попадают. Перевод признаётся GasFree fee только по
структурному settlement proof; совпадение адреса или суммы недостаточно.

Точная GasFree fee не запускает `direct_counterparty_policy`, даже если
провайдер комиссии сам получил blacklist- или sanctions-метку: пользователь не
выбирал его как получателя principal. Юридически значимая метка провайдера
показывается как service-compliance context. Principal-переводы GasFree Account
никаких исключений не получают.

## Coverage простыми словами

В пользовательском тексте запрещены `drain episode`, `anchor coverage`,
`coverage ratio`, `partial provenance` и внутренние technical status codes.

Пишем через переводы и деньги:

```text
Мы проверили 10 входящих переводов и проследили происхождение 83% суммы.

Оставшиеся 17% не удалось проверить: источник данных не отдал более старые
переводы.
```

Если остаток ниже materiality и не меняет итог:

```text
Мы проследили 99,6% суммы. Оставшиеся 24 USDT находились на кошельке раньше
доступной истории. Эта небольшая часть не меняет итог.
```

Если required coverage невалиден, но job ещё работает:

```text
Итог не рассчитан: не удалось проследить 42% суммы. Система ещё загружает
нужную историю переводов.
```

First-hop coverage считается отдельно:

- полнота прямых переводов проверяемого адреса;
- доля материальных контрагентов, проверенных по blacklist и меткам;
- полнота хронологии найденной метки.

Scope всегда указан в отчёте: `all_time` только при полном subject index,
иначе конкретный `checked_window` с началом и концом. Частичное окно нельзя
называть полной историей адреса.

В unified Wallet/Deep result эта coverage-ось помечается
`requiredForDecision=true`. Fast-only preview может показать partial context,
но не выдаёт его за полный first-hop результат.

Проверки текущего USDT blacklist сначала выполняются для всех материальных
principal-контрагентов, отсортированных по сумме, а не по случайному порядку
получения transfer rows. Если обязательный набор не проверен и точного плохого
факта нет, система не утверждает, что связей нет, и не публикует финальный
результат.

Если хотя бы одна материальная blacklisted-связь уже подтверждена, она даёт
`DECLINE` даже при partial coverage остальных контрагентов. Неполное покрытие
показывается отдельным ограничением и не отменяет найденный факт.

Причина partial coverage управляет текстом:

- `running` — `Проверка остальных прямых контрагентов ещё продолжается.`;
- `provider_failed` — `Не удалось проверить часть прямых контрагентов. Нужен
  повторный запуск.`;
- `budget_exhausted` — `Проверка остановилась на техническом лимите. Часть
  контрагентов не проверена.`;
- `history_partial` — `Доступна только часть истории прямых переводов.`

При независимом exact hard proof частичное coverage не отменяет запрет:

```text
Найдена подтверждённая дрейнер-цепочка.

Отдельно не удалось проследить 17% суммы из-за недоступной старой истории. Это
не меняет решение: операцию не проводить.
```

Количество переводов не заменяет долю суммы. `10 переводов` и `83% суммы` не
означают `8 из 10 переводов`.

## Приоритет и дедупликация

Главный факт выбирается в таком порядке:

1. active USDT blacklist;
2. материальная прямая связь с USDT-blacklisted контрагентом;
3. подтверждённая роль в approval-drain цепочке;
4. санкционный или подтверждённый плохой источник;
5. точный Verify20 fingerprint;
6. материальный bridge/DEX/risky-service маршрут;
7. рискованный контрагент;
8. чистый CEX-source;
9. collector/operational role;
10. GasFree fee.

Если итог не рассчитан, coverage blocker показывается сразу после шапки. Exact
hard proof и независимый `direct_counterparty_policy` остаются главным фактом
даже при unrelated partial coverage.

Один physical transfer или forensic episode описывается один раз, даже если его
нашли Fast, Where и Deep. Behavior context не повторяет exact hard evidence.

## Проверенные fixtures

1. `TPVV...AvjKw`: KuCoin/OKX, полный source coverage, collector behavior,
   score 25.
2. `TGMS...jBwhV`: Bybit/Binance, 98% turnover, GasFree fee, score 25.
3. `THRS...Pjgf`: 88% суммы, старая история недоступна, score 35.
4. `TNQd...ZdDAC`: один bridge-перевод на 100% суммы, затем Bybit, score 78.
5. `TGyt...BZAZD`: прямой outbound в текущий USDT blacklist на 100%
   principal-объёма;
   два перевода были примерно за три часа до блокировки контрагента; ожидаемый
   primary score 90 и `DECLINE`. UsdtOFT на 83% остаётся вторичным route-фактом.
6. `TPdr...mmGJE`: direct first receiver exact approval-drain, score 95.
7. `TNAra...H2Z9i1`: следующее звено approval-drain цепочки, не direct drainer.
8. `TH7t...MYSkU`: Verify20 spender contract из двух подтверждённых цепочек.

Сохранённый job `TGyt...BZAZD` используется только как forensic fixture. В нём
ещё нет `FirstHopBlacklistFact`, timeline и новой coverage-модели. Старые jobs
не пересчитываются молча: реализация повышает scoring-policy version, а новый
результат появляется только после fresh rerun. Legacy-отчёт сохраняет своё
решение и просит запустить проверку заново.

## Tests

1. Цветной индикатор есть у каждого опубликованного score.
2. `NO_FINAL_DECISION` не показывает итоговый score.
3. `DECLINE` пишет `Операцию не проводить`.
4. Жертва не получает drainer-формулировку.
5. Spender и first receiver получают точную роль.
6. Route-linked адрес не называется контрактом-дрейнером.
7. Обычный `transferFrom` не попадает в обычный отчёт.
8. Один метод `Verify20` без полного fingerprint не создаёт hard stop.
9. Полный Verify20 fingerprint без trusted-service guard даёт direct-contract
   `DECLINE` и floor 85.
10. Exact approval-drain сохраняет floor 95.
11. Мост описывается как AML-риск и разрыв видимой cross-chain истории.
12. Один небольшой мост и повторяющийся материальный маршрут получают разные
    scores и тексты.
13. HTX после 2026-05-26 описывается как санкционный источник с запретом.
14. Collector/Bybit behavior не получает формулировки о грязных деньгах.
15. GasFree fee показывается как комиссия и не создаёт provenance risk.
16. Partial coverage показывает процент, остаток и конкретную причину.
17. Exact hard proof остаётся решающим при unrelated partial coverage.
18. Один факт не повторяется между Fast, Where и Deep.
19. Обычный текст не содержит raw English reasons и внутренних кодов.
20. Ни один пользовательский formatter не вызывает LLM.
21. Direct blacklist факт сохраняет адрес, направление, principal-сумму, долю
    и количество переводов.
22. Outbound blacklist связь не называется источником текущего баланса.
23. `active_at_transfer`, `became_active_after`, `mixed` и `unknown` получают
    разные тексты.
24. Material direct current-blacklist связь даёт `DECLINE` с floor 60 даже
    когда блокировка появилась после перевода или её дата неизвестна.
25. Subject и counterparty blacklist не смешиваются.
26. Один контрагент с inbound и outbound создаёт два направленных факта.
27. GasFree fee не входит в adverse amount/share; GasFree principal входит.
28. При непроверенных material counterparties без положительного факта нет
    финального результата; подтверждённый плохой факт остаётся решающим.
29. Внутренняя `createdAt` не используется как effective date метки.
30. При blacklisted-контрагенте бот не пишет обобщённое `USDT blacklist не
    найдено`; он отдельно указывает состояние проверяемого адреса и
    контрагента.
31. Materiality boundaries проверяются на `9 999,999/10 000 USDT`,
    `99,999/100 USDT` и `0,999%/1%`.
32. Percentage materiality не применяется при partial denominator; абсолютные
    10 000 USDT остаются достаточными.
33. Material counterparties сортируются по principal-сумме до применения live
    limit; blacklisted-контрагент за пределами исходного insertion order не
    пропускается.
34. Provider tests покрывают address/contract mismatch, seconds-to-ISO,
    pagination, unconfirmed tx, неверный log, removal/re-add и несовпадение
    timeline с current state.
35. Legacy TGyt job не пересчитывается; fresh rerun создаёт новую policy version
    и новый результат.
36. Report-level first-hop coverage различает `ничего не найдено` и
    `материальные контрагенты не проверены`.
37. Partial denominator использует amount-only score 60 и не получает
    relative-share boost.
38. Sanctioned inbound даёт `DECLINE` только при связи с выбранным
    Where/Incoming provenance; прочая историческая связь остаётся `REVIEW`.
39. Exact internal label хранит typed `labelCode`; formatter не разбирает
    `snapshot.reasons`.

## Implementation surface

- небольшой `walletNarrativeSummary.ts`;
- детерминированный Verify20 family matcher без новой зависимости;
- targeted scoring-matrix input для direct Verify20 contract subject;
- structured `FirstHopBlacklistFact`, `FirstHopBlacklistCoverage` и
  `FirstHopLabelFact` на границе direct evidence;
- адресный TronScan blacklist timeline lookup и проверка event tx/log;
- отдельный `direct_counterparty_policy` matrix row;
- targeted independent-policy rule в final disposition;
- новая scoring-policy version без пересчёта legacy jobs;
- `src/bot/createBot.ts` — новая шапка и финальный formatter;
- focused unit tests и bot integration tests;
- после реализации — обновление `docs/knowledge/07-risk-scoring-matrix.md`,
  `08-admin-and-bot-ux.md` и `09-current-decisions.md`.

Не меняются:

- глубина и алгоритм построения forensic trace;
- Admin graph role model;
- support/debug отчёт;
- existing contract LLM classifier;
- amount-aware bridge caps;
- coverage rules для остальных evidence-классов.

## Self-review checklist

- LLM не участвует в пользовательском narrative.
- Действие ясно из шапки.
- Нет фразы `не принимать автоматически`.
- Role precedes generic behavior interpretation.
- Verify20 hard stop требует полного fingerprint.
- Обычный `transferFrom` скрыт.
- HTX designation применяется по timestamp перевода.
- Direct current-blacklist policy применяется независимо от даты блокировки,
  но текст честно показывает temporal relation.
- Independent direct policy имеет `coverageDependency=none`; другие evidence
  classes сохраняют прежние coverage rules.
- Outbound direct relation не называется происхождением денег.
- Bridge wording показывает AML-риск без утверждения, что любой bridge —
  отмывание.
- Coverage объяснено долей денег и причиной.
- Количество переводов не смешано с долей суммы.
- GasFree fee остаётся комиссией.
- First-hop materiality считается только по principal-переводам.
- Percentage materiality требует полного denominator.
- Partial denominator не получает relative-share boost.
- Exact internal label хранится как typed code, а не reason string.
- Неполная timeline не превращается в выдуманную дату.
- Старые jobs не пересчитываются без fresh rerun.
- Новых таблиц, публичных API и зависимостей нет.
