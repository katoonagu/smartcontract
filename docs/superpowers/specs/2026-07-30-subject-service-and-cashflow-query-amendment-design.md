# Subject-Service And Cashflow Query Amendment Design

**Статус:** design-only correction; production mode, selector и числовые
пороги не утверждены

**Дата:** 2026-07-30

**Связанные дизайны:**

- `2026-07-29-service-boundary-sampling-amendment-design.md`;
- `2026-07-29-chronological-proportional-balance-provenance-design.md`.

## Зачем нужен amendment

Intermediate service boundary и checked-subject service mode отвечают на
разные вопросы. Первый может остановить обычный fan-out на доказанной
промежуточной границе. Второй должен ограничить дорогую работу вокруг самого
checked subject, не объявляя subject terminal и не выдавая provider window за
полную историю.

Отдельный пробел — product-level Cashflow Query Selector. Offline ledger умеет
исполнить `current_balance`, `amount_only` и `exact_episode`, но production не
имеет общего решения, какой cashflow-query создавать для конкретного subject
event или adverse relevance question.

## Проверенная production truth

- `initialUnifiedTraversalCheckpointV1()` в
  `src/unifiedCheck/productionTraversal.ts` создаёт frontier из каждого
  прямого incoming и outgoing subject event. Для каждого non-terminal frontier
  state handler загружает address history до provider completion и только
  затем расширяет следующий hop.
- TronScan `rangeTotal=10000` — capped provider sentinel. Реализованный
  `completionReason=provider_range_capped` не преобразуется в
  `reachedAccountCreation`; adapter завершается fail-closed. Ни `10 000` rows,
  ни `200` страниц не являются product policy, subject cap или доказательством
  полной истории.
- Legacy Where без requested amount переключается при известном балансе
  `<1000 USDT` на `recent_flow`. Этот путь выбирает один latest meaningful
  outgoing либо ограниченный slice из пяти newest principal events. Он прямо
  маркируется approximation и не доказывает current-balance origin.
- Legacy Incoming начинается с конкретного deposit tuple
  `(txHash, sender, watchedWallet, amount, timestamp)` и передаёт exact deposit
  seed/funding selection. Это отдельный exact-deposit path, а не общий selector
  для address `/check`.
- `selectLedgerProvenanceV1()` является pure offline executor. Он не подключён
  к production routing и не выбирает product query.

## Frozen adverse disposition

Этот раздел — единственная нормативная таблица
`provenance-adverse-terminal-matrix-v1` для связанных дизайнов. Матрица
применяется до решения о расширении:

| Evidence и обязательная binding authority | Disposition |
|---|---|
| Exact event-time blacklist, sanctions или restricted-service endpoint; exact HTX или exact restricted exchange; tracked drainer/collector; другой exact confirmed harmful endpoint | `terminal_red`; сохранить red fact, не загружать endpoint history |
| Confirmed Verify20 scene: полный fingerprint и final successful matching USDT transfer с exact selector, event, finality и movement binding | `terminal_red`; это самостоятельный exact adverse terminal |
| Exact terminal и selected-amount relevance с complete relevance binding и непустыми `knownIntermediateEventIds` | `cashflow_relevance_only`; использовать только эти уже известные intermediate events, не endpoint history |
| Exact-bound nonterminal approval/transferFrom, proxy, drainer или Verify-like lead с continuation address и непустыми `boundEventIds` | `continue_exact_path`; открыть только bound path |
| Verify20 method name без полного fingerprint либо без selector/event/finality/movement binding; любой missing binding, включая exact continuation; любой unknown authority class | `unresolved`; не выдавать terminal shortcut или произвольное продолжение |

Exact adverse terminals сохраняются как terminals. Обязательное deep
continuation создают только exact-bound nonterminal leads. Доля и materiality
не могут удалить red fact, а unknown authority остаётся fail-closed unresolved
и не даёт права открыть историю endpoint.

## Future Bounded Subject-Service Mode

Режим может появиться только как новая explicit versioned policy, выбранная
**до** загрузки полной subject history. Он не выводится задним числом из
`rangeTotal`, account totals или service-like behavior.

Обязательные свойства:

1. Checked subject всегда non-terminal. Режим ограничивает work, а не
   классифицирует subject как service boundary.
2. Для выбранных subject events ordinary neighbor-history tasks подавляются;
   они не создаются сначала ради последующей отмены.
3. Exact adverse endpoints сохраняются как terminal red facts. Exact-bound
   non-terminal leads продолжаются только по связанному пути. Missing binding
   остаётся unresolved.
4. Cashflow выполняется только для query, выбранных отдельным selector, и
   сохраняет exact event/amount authority.
5. Coverage явно говорит, что subject history bounded/incomplete: сколько
   событий наблюдалось и было выбрано, почему остальные не вошли, чем
   закончился provider window, какие exact facts/leads/query остались
   terminal, continued или unresolved. Такой результат нельзя называть
   account-creation exhaustion.

`SUBJECT_EVENT_CAP` не утверждён. Его значение и selection order должны быть
измерены frozen replay до implementation plan. Sentinel `10 000` и производная
граница `200 pages × 50 rows` не являются кандидатами по умолчанию.

`…W8SRL` остаётся recorded calibration vector: raw provider pages и exact
anchor authority не заморожены. Последовательность `300 → 70/12/180/38`
проверяет ledger arithmetic только как recorded chronology и отдельный
synthetic zero-opening control; она не доказывает real attribution. Реальный
`…PacGy` остаётся unresolved без complete canonical history и independent
pinned balance witness. `…D7NzP` остаётся negative checked-subject control:
subject non-terminal независимо от похожести на service.

## Cashflow Query Selector

Selector должен различать три product query kind:

| Query kind | Вопрос | Допустимый input |
|---|---|---|
| `current_balance` | Из чего сформирован snapshot balance? | Complete canonical ledger interval и independent pinned balance witness |
| `completed_exact_episode` | Чем профинансирован конкретный завершённый episode? | Exact canonical movement и authoritative pre-event order/balance context |
| `triggered_relevance` | Относится ли выбранная сумма к конкретному evidence trigger? | Только exact trigger-bound intermediate event IDs, уже известные текущему state |

`triggered_relevance` не разрешает загружать историю exact adverse endpoint.
Если event/amount/order binding недостаточен, query остаётся unresolved.

Предложение «episode не меньше `10 USDT` или `0.1%`» не утверждено. Для него не
зафиксированы recent window, denominator gross turnover, семантика
materiality, обязательная episode coverage и maximum ordinary episodes.
Следовательно, эти числа нельзя кодировать, использовать как fallback или
описывать как current policy.

Реальный `…1ZDqkZ → …dwxxhs → …mmGJE` остаётся recorded adverse calibration.
Recorded ingress/approval/`669` observations не являются canonical exact
proof и не заменяют frozen event tape с identity, order, opening и amount
authority; до такого tape cashflow query для `…dwxxhs` остаётся unresolved.

## Gate и non-goals

До production implementation требуются одновременно:

- explicit policy для subject selection/cap и selector semantics;
- frozen raw fixtures с canonical event/order/coverage authority;
- replay для positive calibration, negative subject и real adverse controls;
- проверки conservation, deterministic selection и explicit incomplete
  coverage.

Этот amendment не меняет traversal, scoring, report, Telegram, Admin,
PostgreSQL, job lifecycle или provider capacity; Stage D остаётся deferred,
canary и rollout не разрешены.
