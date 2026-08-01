# Forensic Model Manual Corpus Replay

**Дата:** 2026-07-29

**Статус:** ручная read-only проверка завершена; design принят, production не
изменён

## Решение

| Часть | Результат | Что разрешено дальше |
|---|---|---|
| Chronological proportional ledger | Принят для implementation planning | Frozen fixtures, pure integer ledger и adapters под feature flag |
| Service probe `100 + 100` | Принят после добавления extreme-throughput признака `X` | Stage C shadow implementation и сбор blind set |
| Expansion `500 + 100` | Budget и trigger приняты, реального activation case в corpus нет | Сначала отдельный frozen ambiguous fixture |
| Stage D inferred boundary | Не разрешён | Нужны frozen bytes, `EOAAtAnchor`, complete adverse receipt, два blind review и отдельное rollout-решение |

Ни один шаг этого replay не менял production policy, очередь, Telegram,
PostgreSQL или внешние данные. Локальная БД и provider API читались только для
сверки.

## Что проверялось

Проверка объединила:

- текущий код legacy Where, Unified traversal/completion, canonical indexing,
  GasFree parsing, service classifier и direct hard evidence;
- knowledge pages `01`, `04`, `05`, `07`, `09` и `14`;
- worksheet
  `outputs/service-wallet-analysis-20260726/service_wallet_behavior_analysis_2026-07-26.xlsx`:
  `23` CSV-файла и `21` уникальный адрес;
- read-only локальный PostgreSQL;
- bracketed live TronGrid balance reads и ограниченные TronScan page reads.

CSV и live reads являются calibration evidence. Они не заменяют frozen raw
fixtures и не являются blind validation.

## Service sampling

### Исправленный predicate

Исходный baseline

```text
P = C AND B AND G AND (H OR R)
```

давал false negative для машин, которые успевают провести почти всё окно внутри
одного UTC-часа и не повторяют exact amount. Поэтому принят дополнительный
признак:

```text
X =
  dominantDirectionCount >= 80
  AND dominantDirectionShare >= 0.80
  AND uniqueDominantCounterparties >= 80
  AND (
    medianDominantDirectionGapSeconds <= 15
    OR maxDominantDirectionEventsPerUtcHour >= 80
  )

P = C AND B AND G AND (H OR R OR X)
```

`X` определяет extreme machine throughput, а не AML-риск. На `21` уникальном
CSV-case он сработал ровно на `…98cdn`, `…aEGqTr` и exact Binance
`…qJJpBXh`; остальные `18` не активировали `X`.

### Главный новый case `…W8SRL`

Для `TPkv2PcELr6uq5vqdYJ3UwKnnhdV2W8SRL` были прочитаны ровно две физические
recent pages, две historical pages и account metadata. Dedupe не добирал строки
после удаления дублей.

| Окно | In / out | Контрагенты | Median dominant gap | UTC hours-of-day | Predicate |
|---|---:|---:|---:|---:|---|
| Recent 100 | 12 / 88 | 35 | 93 s | 16 | `C/B/G/H/R=true` |
| Historical 100 | 20 / 80 | 36 | 21 s | 13 | `C/B/G/H/R=true` |

Оба окна подтверждают устойчивую автоматизированную payout/processing роль.
Конкретная организация не установлена. В этих `200` rows не обнаружены
`riskTransaction`, нестандартные contract calls или публичный опасный label;
current USDT blacklist и возвращённая provider-история blacklist также пусты.
Это window-level результат, а не complete Stage D adverse receipt.

Пять последовательных provider calls заняли около `5.8s`. Это measurement
одного запуска, не SLA. Четыре ключа могут уменьшать wall time только при
реально независимой provider capacity; число запросов остаётся `5`.

### Остальной corpus

| Case | Наблюдение | Replay action |
|---|---|---|
| `…98cdn` | Extreme unlabeled machine; оба окна проходят через `X` | Shadow high; authority/adverse incomplete |
| `…aEGqTr` | Extreme unlabeled processing; оба окна проходят через `X` | Shadow high; authority/adverse incomplete |
| `…qJJpBXh` | Current exact `Binance-Hot 10` label | Exact service path; inferred sampler не нужен |
| `…SH14eaf` | `C=false` в обоих окнах | Continue traversal |
| `…D7NzP` | `C=false`; это checked subject; sample содержит HTX-tagged current counterparties | Continue full; subject не boundary; event-time label authority ещё не доказана |
| `…VUSXVhd` | Только 73 live rows и нет historical baseline | Insufficient data; continue traversal |
| `…MnxP`, `…ZAZD` | Current contract role / GasFree controls | Не inferred EOA boundary |

Контроли `…8Pet`, `…NGMf`, `…MWZv`, `…fnme`, `…BSuW` и `…UZBM` не стали
high service. Ни один case не активировал expansion `500 + 100`; этот путь
нельзя считать replay-proven до отдельного fixture.

У прежнего broad attempt `…98cdn` наблюдалось `8 884` page calls. Если future
Stage D докажет полную boundary authority, fixed sampling потенциально убирает
порядка `8 880` обычных history-page calls. Для `…aEGqTr` аналогичная верхняя
оценка — около `355`. Это avoided-work estimate, не уже достигнутое ускорение.

## Cashflow replay

### Exact episode и current balance — разные запросы

Реальная последовательность `…W8SRL → …PacGy → …WqQPC`:

```text
…W8SRL ──300──▶ …PacGy
                   ├──70
                   ├──12
                   ├──180──▶ …WqQPC
                   └──38

…gsFCa ──82.7──▶ …PacGy   (новый current-balance lot)
```

- exact episode `180` имеет target coverage `100%` из lot `300`;
- `60%` относится только к utilization lot `300`;
- весь lot `300` затем исчерпан расходом `38`;
- current balance `…PacGy = 82.7 USDT` сформирован `…gsFCa`, а не `…W8SRL`.

Транзакция `180` сохранена в локальном индексе дважды под разными synthetic
`event_index`, хотя full-node receipt содержит один USDT log. Canonical dedupe
обязан предшествовать allocation.

Баланс `82.7` был прочитан внутри неизменившегося solidified head `84888238`.
Это bracketed live witness, но не historical balance, параметризованный exact
block hash.

### GasFree

`…ZAZD` полностью сошёлся: два exact settlement включают principal и fees
`2 + 1 USDT`, а вычисленный остаток `538.044722 USDT` совпал с bracketed live
balance. Это положительный контроль правила «principal — AML path, fee — только
accounting debit».

`…MnxP` имеет exact settlement `4691 + 1.5 USDT`, но локальная реконструкция
current balance расходится с live на `10.699978 USDT`. У `…VSZ9` exact
settlement доказан, однако история обрывается после provider ceiling `200`.
`…UZBM` имеет stale local history. Все три случая обязаны остаться unresolved
для current provenance, а не получать приблизительное происхождение.

### Drainer-pattern

Цепочка `…1ZDqkZ → …dwxxhs → …mmGJE` подтверждает ingress
`669.889034 USDT`, approval и последующее списание `669 USDT`; остаток
`0.889034 USDT` совпал с bracketed live balance. Такая exact red-ветка не
отбрасывается из-за `95%`, top-k или малой доли. В пользовательском тексте
показывается понятный drainer-паттерн без внутреннего selector name.

## Authority gaps до кода и Stage D

- Сохранить raw provider bytes и canonical request identity для принятых cases.
- Добавить authoritative `(blockNumber, transactionIndex, logIndex)`; hash-like
  `event_index` не является порядком.
- Реализовать `EOAAtAnchor`, а не переносить current account role в прошлое.
- Заморозить complete one-hop adverse receipt, включая event-time blacklist и
  exact service authority в обе стороны.
- Добавить ambiguous case, который действительно включает `500 + 100`.
- Провести отдельный frozen blind set, два review и adjudication.
- Только после этого проектировать disabled-by-default Stage D и canary.

## Следующий шаг

Следующая самостоятельная работа — versioned implementation plan. Первая
поставка должна заморозить fixtures и реализовать чистый integer chronological
ledger с conservation/order tests. Stage C shadow sampler идёт отдельной
поставкой; production stop не входит ни в одну из них.
