# Chronological Proportional Balance Provenance Design

**Статус:** утверждённый дизайн после ручного corpus replay; не реализован и
не меняет production policy до отдельного implementation/rollout решения

**Дата:** 2026-07-29

**Базовая версия:** `9e8ec47838af781d15efb82ef912c5d0c8adfa09`

## Результат

Для происхождения денег вводится один новый движок
`chronological-proportional-ledger-v1`. Он должен одинаково обслуживать:

- происхождение текущего баланса;
- происхождение выбранной части текущего баланса;
- происхождение конкретного денежного эпизода;
- каждый следующий обратный шаг цепочки.

Движение исследуется назад:

```text
D ──▶ C ──▶ B ──▶ A
                      A — проверяемый адрес

трассировка: A ← B ← C ← D
```

Переводы и их chain order являются фактами. Пропорциональное распределение
взаимозаменяемых USDT между входами и расходами является детерминированной
forensic-policy, а не утверждением, что в блокчейне существуют отдельные
«монеты B» и «монеты C».

Новая policy не переписывает старые отчёты, `Golden V2` или действующие legacy
и Unified policy. Ручной replay реального корпуса завершён 2026-07-29;
реализация получает новую версию и включается только после frozen fixtures,
тестов сохранения суммы и отдельного rollout-решения.

### Как это работает без формул

Для адреса собирается замороженная история до нужного момента и проигрывается
в реальном chain order:

1. каждый внешний входящий USDT-перевод добавляет свой остаток в общий
   inventory;
2. каждый последующий исходящий перевод пропорционально расходует все остатки,
   которые существовали перед ним;
3. остатки lots после последнего события и есть источники текущего баланса;
4. если проверяется конкретный исходящий перевод, берётся его сохранённый
   consumption vector непосредственно перед операцией;
5. каждый использованный вход становится следующим обратным hop, и на адресе
   отправителя применяется ровно та же модель;
6. если identity, порядок, история или баланс не доказаны, недостающая сумма
   остаётся явной неизвестной частью, а не подменяется похожими переводами.

Так `A ← B ← C ← D` действительно отвечает на вопрос, откуда сформировались
исследуемые деньги, и не путает `180 из входящих 300` с «покрыто только 60%».

## Почему текущей реализации недостаточно

Сейчас в проекте одновременно существуют несколько разных приближений:

- legacy current-balance выбирает самые новые входящие до покрытия числовой
  цели, но не уменьшает их остаток последующими исходящими переводами:
  `src/forensics/balanceFormingTransfers.ts`;
- legacy Where без явно запрошенной суммы переключается при балансе ниже
  `1 000 USDT` на отдельную recent-flow модель:
  `src/check/whereIsMoneyCheck.ts` и
  `src/forensics/recentFlowProvenanceSelection.ts`;
- hop bundle идёт назад newest-first через spend overhang, по умолчанию может
  остановиться на `80%` и вернуть не более трёх funder-ов:
  `src/forensics/incomingDepositCashflow.ts` и
  `src/forensics/provenanceTracingConfig.ts`;
- Unified создаёт корневые состояния из всех прямых входящих и исходящих, а на
  hop greedily набирает входы до anchor без единого source inventory:
  `src/unifiedCheck/productionTraversal.ts` и
  `src/unifiedCheck/traversal.ts`.

Поэтому существующее слово `proportional` в Golden/manifest нельзя
переиспользовать для нового смысла. Offline Golden сравнивает policy с таким
именем, а production completion строит отдельный proportional aggregate; ни то,
ни другое не доказывает единый chronological ledger, который сначала расходует
остатки входов.

## Формальный запрос

Запрос задаётся как:

\[
Q=(subject, purpose, snapshot, anchorEvent, amountRaw, policyVersion)
\]

`purpose` имеет три значения:

| Purpose | Вопрос | Anchor и denominator |
|---|---|---|
| `current_balance` | Откуда сформирован текущий баланс адреса? | Точный snapshot; denominator равен snapshot balance |
| `amount_only` | Откуда сформирована выбранная часть текущего баланса? | Тот же snapshot; пользовательская сумма не привязывается к похожей транзакции |
| `exact_episode` | Чем был профинансирован конкретный перевод? | Точный canonical event; denominator равен полной или выбранной части этого event |

`amount_only` и `exact_episode` нельзя смешивать. Совпадение суммы само по себе
не связывает пользовательский запрос с историческим переводом. Для
`exact_episode` недостаточно одного `txHash`: нужен exact movement identity.

При нулевом текущем балансе `current_balance` возвращает `not_applicable`.
Последний денежный эпизод можно исследовать отдельным запросом, но нельзя
называть происхождением нулевого баланса.

## Canonical input

До расчёта ledger обязан получить:

- official USDT contract и frozen chain snapshot;
- canonical dedupe identity каждого движения;
- authoritative execution order;
- independent frozen balance witness для `current_balance`/`amount_only`;
- доказанно непрерывную историю от genesis, exact start checkpoint либо
  boundary, для которой opening выводится из exact anchor-balance witness;
- structural economic role для GasFree и других составных движений;
- event-time-valid ownership evidence, если заявлена связь разных адресов.

Movement identity и execution order — разные доказательства. Сейчас
`stableEventIndex()` в `src/forensics/tronAddressAllTimeIndex.ts` при отсутствии
provider event/log index может создать hash-derived число. Оно годится для
стабильной дедупликации, но не доказывает порядок исполнения.

Авторитетный ключ порядка:

```text
blockNumber → transactionIndex → log/eventIndex
```

`transactionIndex` сейчас отсутствует и в `ForensicRouteEdge`, и в
`IndexedTronUsdtTransfer`. Новая policy должна получить его из frozen
full-node/block witness либо другого отдельно проверенного chain-order source.
До этого corpus cases с mixed transactions в одном block остаются
`temporal_order_unresolved`; synthetic `eventIndex` их не чинит.

Timestamp используется как время, но не как достаточный tie-breaker. `txHash`
в лексикографическом порядке тоже не является chain order.

## Хронологический proportional ledger

Каждый внешний входящий principal создаёт source lot:

\[
L_i=(lotId_i, sourceRef_i, original_i, remaining_i)
\]

Для обычного входа `lotId=canonicalEventId`, а `sourceRef` указывает на exact
sender/event. Для opening lot ID является content hash от policy version,
address, history-start boundary и opening evidence hash; у него
`sourceRef=unknown_opening`. Поэтому largest-remainder tie-break воспроизводим,
не требуя вымышленного адреса или события.

Изначально:

\[
remaining_i=original_i
\]

Перед исходящим debit `d` доступный инвентарь равен:

\[
R=\sum_i remaining_i
\]

Если `0 < d \le R`, базовый расход каждого lot:

\[
base_i=\left\lfloor\frac{d\cdot remaining_i}{R}\right\rfloor
\]

Оставшиеся raw-единицы распределяются методом largest remainder: сначала по
убыванию остатка деления, при равенстве — по canonical lot ID. После этого:

\[
\sum_i consumed_i=d
\]

\[
0\le consumed_i\le remaining_i
\]

\[
remaining'_i=remaining_i-consumed_i\ge0
\]

Все вычисления выполняются в integer raw USDT. `Number` и floating point не
используются для amount authority.

Authoritative ledger не запускается с неизвестным размером opening inventory.
Если после принятого genesis/checkpoint/derived-opening входа возникает
`d > R`, это уже противоречие frozen history или balance authority: весь
затронутый state получает `provider_or_snapshot_inconsistent` и amount-bearing
unresolved terminal. Известные lots остаются diagnostics, но их нельзя
публиковать как частично доказанную proportional allocation, а поздние входы
не могут снова сделать query «точным».

## Полная история, checkpoint и неизвестный opening balance

До первого ledger event opening inventory определяется ровно одним из трёх
authority-контрактов:

1. `genesis_complete`: история доказанно дошла до создания адреса, opening
   balance равен нулю;
2. `start_checkpoint`: exact balance checkpoint задаёт opening amount
   непосредственно, а непрерывная история начинается строго после его
   `checkpointOrder`;
3. `derived_from_anchor`: exact end/snapshot balance либо pre-event balance
   witness и доказанно непрерывный интервал позволяют вычислить баланс на
   `historyStartOrder` обратной формулой.

Если start checkpoint содержит только exact balance, но не accepted source-lot
inventory, он создаёт один exact-amount `unknown_opening_balance` lot так же,
как derived opening. Только checkpoint, связанный с ранее принятой versioned
ledger artifact, может импортировать её source lots вместо неизвестного lot.

`checkpointOrder` не является просто первой загруженной строкой. Для
`start_checkpoint` он связан с exact balance evidence; для
`derived_from_anchor` отдельно хранятся `historyStartOrder`,
`anchorBalanceRaw/ref` и `intervalCompletenessEvidenceRef`.

Интервал событий фиксирован: `(checkpointOrder, snapshotOrder]` для
`after_snapshot` при start checkpoint, либо `(historyStartOrder,
snapshotOrder]`; для `before_event` правая граница всегда открыта и равна
`targetEventOrder`. Exact self-transfer имеет net zero, exact GasFree
settlement учитывается gross debit.

\[
Opening=B_{anchor}-\sum Incoming+\sum Outgoing
\]

Для `derived_from_anchor` формула допустима только когда `Opening >= 0`, ни один
префикс ledger не требует отрицательного остатка, anchor witness и события
относятся к одной frozen chain history, а полнота всего интервала доказана.
Такой lot называется `unknown_opening_balance`: его **amount известен точно** и
поэтому он участвует в proportional расходах, но его provenance неизвестно; все
его contributions становятся unresolved terminals и не могут попасть в
«проверенный нейтральный хвост».

Для `exact_episode` режим `derived_from_anchor` требует отдельный exact
`preEventBalanceEvidenceRef` для состояния непосредственно перед target event.
Обычный current balance или баланс после event его не заменяет.

Без одного из трёх authority-контрактов opening amount неизвестен. Тогда весь
затронутый query/state становится amount-bearing unresolved до какой-либо
proportional allocation: известные входы нельзя считать использованными на
100%, потому что неизвестный opening тоже мог финансировать каждый debit.

Например, при известном входе `50`, exact opening `100` и debit `100`
proportional policy расходует примерно `33` из известного lot и `67` из
unknown-opening lot с точным integer remainder. Если известно только, что
opening мог существовать, но его размер не доказан, нельзя заявить даже эти
`33`: unresolved становится весь state.

При доказанно полной genesis/checkpoint history любое несовпадение
reconstructed и snapshot balance означает `snapshot_balance_mismatch`:
предварительные lots остаются diagnostics, но authoritative allocation не
публикуется, весь query target остаётся unresolved, а абсолютная разница
сохраняется как `reconciliationResidualRaw`.

## Current balance и amount-only

Для `current_balance` независимый `snapshotBalanceEvidenceRef` обязателен:
reconstructed balance из тех же transfer rows нельзя одновременно считать
входом и независимой reconciliation-проверкой. Без block-bound balance witness
current-balance case остаётся unresolved.

При наличии witness:

\[
Target=B_{snapshot}
\]

После обработки всех движений вклад входа `i` равен его фактическому остатку:

\[
used_i=remaining_i
\]

Для `amount_only`, где `0 < A \le B_{snapshot}`, выбранная сумма
распределяется по оставшимся lots тем же integer proportional/largest-remainder
алгоритмом:

\[
used_i=Apportion(A,\{remaining_i\})
\]

Если `A > B_snapshot`, результат —
`requested_amount_exceeds_snapshot_balance`. Система не подбирает уже
потраченные исторические входы только потому, что их суммы подходят.

## Exact episode и следующий hop

Для каждого точного исходящего event `e` суммой `q` ledger сначала строит
состояние непосредственно **до** event, не включая сам `e`, а затем сохраняет
его consumption vector:

\[
C_e=\{c_{i,e}\},\qquad
\sum_i c_{i,e}=q
\]

Если `q > R_before_e`, authoritative consumption vector не создаётся: по
правилу выше весь затронутый state становится amount-bearing unresolved с
детерминированным terminal ID, построенным из query/state/event/reason. У такого
terminal нет выдуманного source address и upstream child.

Если исследуется только часть `a \le q`, она ещё раз детерминированно
распределяется внутри этого vector:

\[
used_{i,e}=Apportion(a,\{c_{i,e}\})
\]

Каждый ненулевой вклад **из известного source lot** создаёт отдельное upstream
state. Вклад `unknown_opening_balance` вместо child создаёт amount-bearing
`opening_balance_unresolved` terminal с собственным deterministic ID:

```text
address        = source address lot i
targetEventId  = exact inbound event i
allocatedRaw   = usedAmountRaw
anchorOrder    = position immediately before event i
```

На следующем адресе применяется тот же ledger. `usedAmountRaw` является одной
и той же amount authority для selection, recursive trace, branch share и
coverage. `originalAmountRaw` остаётся фактом о полном переводе.

Несколько переводов одного funder можно суммировать для приоритета и API cache,
но нельзя склеивать в одно episode state с общим timestamp: у каждого остаются
собственный event ID, anchor и `usedAmountRaw`.

Для `current_balance` и `amount_only` anchor означает состояние **после** всех
events, вошедших в frozen snapshot. Для `exact_episode` anchor означает
состояние **до** target outgoing. Каждый backward child обязан иметь exact
anchor строго раньше parent target по authoritative order. State identity
включает query, episode, address, anchor и allocation; одного address-cycle
guard недостаточно для конечности цепочек вида `A ← B ← A`.

### Пример `300 → 180`

Адрес `B` получил `300`, затем отправил `70`, `12`, `180` и `38`. Если перед
этими переводами других lots и self/internal movements нет, episode `180`
полностью финансируется из входа `300`:

- покрытие target: `180 / 180 = 100%`;
- использование исходного входа: `180 / 300 = 60%`.

`60%` описывает долю исходного bundle, а не неполное покрытие target. Наличие
других funder-ов или собственных внутренних переводов меняет allocation по
ledger, поэтому совпадение сумм не используется как shortcut.

## Правило глубокого раскрытия 95%

`95%` управляет только expensive deep expansion. Ledger обязан распределить
все `100%` target либо сохранить явный unresolved lot.

Порядок:

1. Ledger распределяет весь target по exact episodes и exact-amount
   `unknown_opening_balance`; неизвестный размер opening запрещает allocation
   целиком.
2. Exact policy terminals определяются до deep selection: уже доказанную
   границу не требуется раскрывать ещё раз.
3. Каждый contributing event/funder проходит
   `provenance-funder-adverse-probe-v1`, привязанный к event ID, времени,
   направлению и обязательной матрице gates.
4. Для приоритета episodes агрегируются по funder. Если funder выбран, глубоко
   раскрываются **все его non-terminal contributing episodes**; уже принятые
   exact terminals сохраняются как terminals и не открываются повторно.
   Агрегат не становится amount authority.
5. Уже terminal episodes удаляются из funder-prefix inventory. Среди оставшейся
   known allocation выбирается минимальный funder prefix по exact integer
   условию
   `100 * (ExactTerminalRaw + DeepSelectedRaw) >= 95 * KnownRaw`.
6. Любой proven-red funder и все его **non-terminal** contributing episodes
   раскрываются независимо от доли, top-k и позиции. Исключение только одно:
   versioned terminal matrix уже доказывает сам adverse source endpoint для
   конкретного episode (например, exact event-time
   blacklist/restricted-service/drainer boundary). Тогда этот episode остаётся
   `exact_adverse_source_terminal`; proxy, mule, approval/Verify pattern и любой
   нетерминальный red path остаются mandatory continuation.
7. Probe-complete, non-red остаток не более `5%` от `KnownRaw` сохраняется
   episode-за-episode как terminal `screened_nonmaterial_tail`.

Здесь:

\[
KnownRaw=TargetRaw-UnresolvedRaw
\]

Unknown opening, order ambiguity и reconciliation residual не входят в
denominator `95%` и не становятся хвостом; из-за них весь query остаётся
incomplete, даже если известная часть исследована.

Этот terminal обязан содержать exact event IDs, event-time bound gates, точный
raw amount, hash завершённого non-red adverse receipt и policy version. Он
закрывает обязанность дорогого раскрытия, но:

- не является адресной или сервисной границей;
- не входит в `identifiedOriginRaw`;
- не считается глубоко прослеженным источником;
- не доказывает происхождение за непосредственным funder.

Если adverse-probe вернул `unresolved`, упал или не охватил обязательный
сигнал, `screened_nonmaterial_tail` запрещён. Ветка остаётся mandatory либо
итог provenance становится incomplete.

`provenance-funder-adverse-probe-v1` — отдельный query-scoped receipt. Он может
переиспользовать те же lower-level blacklist, restriction, label и selective
contract results, что
`2026-07-29-service-boundary-sampling-amendment-design.md`, но не заменяется
service-neighbor receipt. Для каждого contributing event он связывает address,
direction, event ID/time/order, amount, authority и каждый required gate с
outcome `proven | not_found | not_applicable | unresolved`. Current status
адреса нельзя применять задним числом ко всем его episodes.

Решение «этот proven-red endpoint уже terminal или путь надо продолжить»
принимает отдельная frozen `provenance-adverse-terminal-matrix-v1`. Artifact и
receipt обязаны хранить её `version` и content hash. Начальная матрица:

| Exact authority class | Disposition |
|---|---|
| Event-time-active blacklist/sanctions/restricted-service endpoint | `exact_adverse_source_terminal` |
| Exact known drainer/collector address из versioned tracked registry | `exact_adverse_source_terminal` |
| Exact HTX/restricted exchange identity | `exact_adverse_source_terminal` с красным product result |
| Approval/Verify/transferFrom/drainer pattern без exact endpoint identity | `mandatory_continuation` к связанному receiver/caller/collector |
| Mule/transit behavior, provider-risk hint или indirect association | `mandatory_continuation` либо `unresolved`, но не terminal shortcut |
| Неизвестный новый authority class | fail-closed `mandatory_continuation` |

Terminal применяется только к exact event-time evidence самого source endpoint.
Совпадение label сегодня, один behavior score или красный сосед не разрешают
остановить provenance. Изменение матрицы создаёт новую immutable version; один
и тот же receipt не может получить другое traversal-решение без нового policy
artifact.

Для каждого state выполняется локальная сверка:

\[
InputRaw(state)=
\sum ChildAllocationRaw+
\sum TerminalAtStateRaw
\]

`TerminalAtStateRaw` включает exact source/service boundaries,
`screened_nonmaterial_tail`, proven-adverse terminal и unresolved. Пока child
остаётся continued, state не завершён.

Для завершённого запроса отдельная leaf-сверка:

\[
QueryTargetRaw=\sum TerminalLeafRaw
\]

Открытых `DeepContinued` в финальном результате нет; descendant terminals не
суммируются второй раз на уровне родителя. Risk-context investigation, не
привязанное ledger к target amount, имеет
`countsTowardProvenanceClosure=false`.

Семантических `top-3` и `beamWidth`-отсечений больше нет. `250` адресов может
быть размером технического batch, но не лимитом, удаляющим оставшиеся ветки.

Пример: `90 + 5 + 4 + 1(red) = 100`. Deep prefix покрывает `95`, красный funder
`1` добавляется обязательно, а `4` остаётся явным
`screened_nonmaterial_tail`. Если `90` уже является exact terminal, deep нужен
ещё минимум для `5` known units, а не повторное раскрытие этих `90`.

## Self-transfer и exact ownership

Exact normalized `from == to`:

- не меняет баланс;
- не создаёт lot;
- не расходует source inventory;
- не создаёт provenance path.

TRON Base58 нельзя сравнивать через case-folding: используется canonical
decoded identity.

Разные адреса нельзя объединять по похожему поведению, общему сервису,
контроллеру или времени операций. Только frozen exact ownership evidence,
действующее во время события, разрешает роль `same_owner_internal`.

Даже при exact ownership ledger остаётся per-address. Реальный внутренний
перевод переносит allocation в ledger адреса-отправителя, но не считается
новым third-party exposure. Он создаёт recipient inventory с унаследованной
lineage и продолжает трассировку через sender. Blacklist, sanctions, drainer и
другое hard evidence любого адреса подтверждённой entity всё равно сохраняется
и может быть решающим. Балансы разных адресов нельзя виртуально сложить без
отдельного query scope.

Source inventory различает как минимум external principal, inherited
same-owner lineage, exact GasFree fee revenue и exact system movement. Mint,
burn или иной structural balance change получает отдельную роль только при
exact authority; иначе он остаётся unresolved.

## GasFree

Только exact settlement из строгого parser в
`src/forensics/gasFreeSettlement.ts` разрешает отделить principal от fee.
Суммы `1`, `1.5`, `2` или `3 USDT`, адрес получателя либо GasFree-похожее
поведение сами по себе исключение не разрешают.

Для exact settlement:

\[
gross=principal+fee
\]

Settlement обрабатывается как одна ordered economic group только после
one-to-one binding каждого parser movement к canonical event ID:

1. `gross` пропорционально расходует source inventory;
2. если parser доказал, что movements являются одной атомарной economic group,
   колонки получают детерминированный **policy order** по
   `(economicRoleRank, canonicalEventId)`, где `principal=0`,
   `service_fee=1` (точные роли текущего parser), а неизвестная structural role
   запрещает exact settlement; это только tie-break распределения, а не
   утверждение об их chain order;
3. для каждой колонки, кроме последней, её сумма распределяется методом
   `Apportion` по текущим remaining row capacities, после чего capacities
   уменьшаются; последняя колонка получает все оставшиеся capacities;
4. полученная deterministic integer matrix `lot × movement` обязана иметь row
   sums, равные gross lot consumption, и column sums, равные точным суммам
   каждого principal/fee event; mismatch делает settlement unresolved;
5. каждый principal event получает собственный consumption vector и продолжает
   обычную AML/provenance-ветку;
6. для ledger плательщика fee является accounting-only consumption и не
   создаёт AML-ветку к пользователю;
7. для ledger fee-получателя тот же canonical transfer создаёт реальный
   `gasfree_fee_revenue` lot, который завершается на exact technical-service
   роли, а не исчезает из accounting;
8. denominator выбранного principal равен principal, а не gross.

Неподтверждённый fee-like перевод остаётся обычным money movement. При
проверке GasFree Account его principal-переводы также остаются обычными
денежными движениями; сам contract/account label не делает их безопасными или
опасными.

Если parser распознал составную операцию, но не смог one-to-one связать её с
canonical events и сохранить column/row sums, результат
`economic_role_unresolved`. Просто похожая сумма без structural match не
является ошибкой и консервативно остаётся обычным movement.

## Неоднозначный порядок

Если authoritative chain order отсутствует:

- группу только входящих можно добавить атомарно, когда результат не зависит
  от порядка внутри группы;
- два или больше неупорядоченных исходящих нельзя сворачивать в один debit:
  integer apportion не ассоциативен, и порядок может изменить composition
  оставшихся lots даже для current balance;
- mixed incoming/outgoing group получает `temporal_order_unresolved`;
- несколько неупорядоченных outgoing, один из которых является target episode,
  также получают `temporal_order_unresolved`;
- exact GasFree settlement можно обработать как одну economic group, только
  когда parser доказал atomic binding всех principal/fee movements; внутренний
  policy order matrix не превращается в chain-order evidence.

Никакой hash-derived или лексикографический tie-breaker не превращается в
доказанный порядок.

Если `canonical_event_identity_unresolved`, mixed-order ambiguity,
`economic_role_unresolved`, ownership conflict или provider inconsistency могут
изменить source composition для текущего state, весь его `InputRaw` становится
amount-bearing `unresolved` terminal. Частично известные lots остаются только
diagnostics и не продолжаются параллельно как будто unaffected. Более узкий
unresolved amount разрешён лишь когда независимое exact evidence доказывает,
что неопределённость локализована и не влияет на остальные allocations.

## Artifact contract

Расчёт сохраняется как immutable `chronological-proportional-ledger-v1`:

```text
schemaVersion
policyVersion
queryPurpose
subjectAddress
tokenContract
snapshotHash / snapshotBlock
anchorSide = before_event | after_snapshot
anchorEventId / anchorOrder / orderAuthorityRef
anchorBalanceRaw / anchorBalanceEvidenceRef
preEventBalanceEvidenceRef
requestedAmountRaw
targetAmountRaw
snapshotBalanceRaw
snapshotBalanceEvidenceRef
historyInventoryHash
historyStartOrder / intervalCompletenessEvidenceRef
canonicalOrderAuthority
openingDerivationMode = genesis_complete | start_checkpoint | derived_from_anchor
checkpointBalanceRaw / checkpointEvidenceRef
openingLot / openingEvidenceRef
sourceLots
episodeConsumptionVectors
gasFreeSettlementEventBindings
allocationStates
parentStateId / childStateIds
stateInputRaw
stateContinuedRaw
stateTerminalRaw
terminalDispositions
adverseReceiptEventRefs
adverseTerminalMatrixVersion / adverseTerminalMatrixHash
terminalDecisionEvidenceRefs
reconciliationResidualRaw
reconstructedBalanceRaw
reconciliationOutcome
queryTerminalLeafRaw
conservationCertificate
```

Artifact хранит raw integer amounts и exact event references. Presentation
может агрегировать их по адресу, но агрегат не становится authority для
следующего hop.

## Failure semantics

Обязательные явные состояния:

```text
canonical_event_identity_unresolved
temporal_order_unresolved
history_incomplete_before_anchor
opening_balance_unresolved
opening_scope_unproven
anchor_balance_witness_missing
snapshot_balance_mismatch
outgoing_exceeds_reconstructed_inventory
requested_amount_exceeds_snapshot_balance
ownership_evidence_conflict
adverse_probe_incomplete
economic_role_unresolved
provider_or_snapshot_inconsistent
```

Ни одно из них не превращается в clean result, inferred service boundary или
молчаливый ноль.

## Pre-code corpus replay

До implementation plan модель считается только design. Ручной read-only replay
проводится существующими запросами, выгрузками и worksheet — без написания
нового движка или runner. Для canonical evidence вручную сравниваются текущие
legacy/Unified результаты и расчёт по формулам этого документа:

- source lots до и после каждого debit;
- exact target coverage и отдельный source utilization;
- причины unresolved;
- число deep, red-forced и screened-tail branches;
- conservation на каждом hop;
- оценку provider work без отправки пользовательского отчёта.

Если для case нет authoritative `transactionIndex`/block witness, worksheet
записывает `temporal_order_unresolved`, а не подставляет порядок. После
утверждения ручных результатов implementation plan может включить
автоматический replay tool и regression fixtures.

Обязательные сценарии:

- несколько funder-ов и несколько последующих расходов;
- exact self-transfer и exact same-owner relocation;
- одинаковые timestamps с отсутствующим chain order;
- duplicate provider rows и два разных events в одном tx;
- `current_balance`, `amount_only` и `exact_episode` одной суммы;
- цепочка `D → C → B → A` с неизменным `usedAmountRaw`;
- `300 → 70 → 12 → 180 → 38`;
- `90 + 5 + 4 + 1(red)`;
- exact и похожий, но неподтверждённый GasFree fee;
- неполная история и unknown opening lot;
- реальные GasFree cases `…MnxP`, `…ZAZD`, `…VSZ9`, `…UZBM`;
- drainer/Verify20 chains, где малый red funder нельзя потерять.

## Результат ручного replay 2026-07-29

Сводный evidence register находится в
`docs/superpowers/verification/2026-07-29-forensic-model-manual-corpus-replay.md`.

Реальный корпус подтвердил основную семантику ledger и одновременно показал,
почему текущие production-пути нельзя переименовать в эту модель без новой
policy version.

### `…W8SRL → …PacGy → …WqQPC`

Canonical chain evidence показывает один вход `300 USDT` из `…W8SRL` в
`…PacGy`, после которого последовательно произошли расходы `70`, `12`, `180`
и `38 USDT`. Поэтому:

- exact episode `…PacGy → …WqQPC` на `180 USDT` на 100% покрыт lot из
  `…W8SRL`;
- `60%` — это utilization входного lot `300`, а не coverage цели `180`;
- после последнего расхода `38` исходный lot `300` полностью исчерпан;
- текущий остаток `…PacGy` равен `82.7 USDT` и сформирован новым входом от
  `…gsFCa`, а не старым входом от `…W8SRL`;
- принадлежность нынешнего баланса `…WqQPC` к старому эпизоду нельзя заявить,
  пока его собственная последующая история не проиграна тем же ledger.

Exact `180 USDT` event имеет tx
`676a97390c99f997e3c9af9a57e8c684c7b6253710e8b009950f73b8b25fe7ca`,
block `83711746`, timestamp `2026-06-18T17:44:12Z`. В локальном индексе он
сохранён дважды под разными synthetic `event_index`; full-node receipt
подтверждает один USDT log. Значит, canonical dedupe должен опираться на exact
chain identity и происходить до ledger allocation.

Баланс `82.7 USDT` подтверждён bracketed live-read вокруг одного solidified
head `84888238`, а не параметризованным historical balance RPC. Такой witness
годится для ручного текущего контроля, но не называется pinned snapshot.

### GasFree accounting

`…ZAZD` дал полностью замкнутый реальный пример. Его два structurally proven
GasFree settlement расходуют principal плюс fees `2` и `1 USDT`; после
integer-учёта остаток равен наблюдавшимся `538.044722 USDT`. Principal остаётся
AML-путём, fee уменьшает inventory и не создаёт отдельную AML-ветку.

Остальные GasFree controls сохраняют fail-closed различия:

- `…MnxP`: один exact settlement (`4691` principal + `1.5` fee) доказан, но
  локально реконструированный current balance отличается от live на
  `10.699978 USDT`; current provenance остаётся unresolved;
- `…VSZ9`: exact settlement (`2548` principal + `2` fee) доказан, но provider
  history обрывается после `200` строк; opening scope не доказан;
- `…UZBM`: локальная история stale и не согласуется с положительным live
  balance; её нельзя использовать как current-balance truth.

Current `accountType=2`/contract observation также не доказывает роль адреса в
старом anchor. GasFree Account отделяется от обычного smart contract только
structural settlement evidence: зарегистрированный controller, selector,
успешная транзакция, official-USDT logs и balanced principal/fee rows.

### Drainer-pattern control

Реальная цепочка `…1ZDqkZ → …dwxxhs → …mmGJE` содержит подтверждённые ingress,
approval и последующее списание `669 USDT`. Сохранение суммы выполняется:
после входа `669.889034 USDT` и списания `669 USDT` остаток жертвы равен
`0.889034 USDT`. Это самостоятельная red-ветка, которая обязана продолжаться
или завершаться по frozen adverse matrix независимо от доли, top-k и порога
`95%`. Пользовательский отчёт описывает найденный drainer-паттерн и не раскрывает
внутреннее имя selector/signature.

### Итог gate

Core ledger semantics приняты для отдельного implementation plan. Production
остаётся на текущих legacy/Unified алгоритмах. Перед интеграцией нужны frozen
raw fixtures, authoritative order для mixed same-block cases, property tests,
semantic comparator и disabled-by-default adapters.

## Минимальные проверки реализации

- Property tests: lots неотрицательны, raw conservation выполняется на каждом
  event и hop.
- Перестановка provider rows не меняет результат после canonical ordering.
- Mixed unordered group даёт unresolved, а не придуманную последовательность.
- Same-block mixed events без authoritative transaction index остаются
  unresolved.
- Exact episode использует pre-event balance; current balance использует
  post-snapshot balance.
- Opening interval использует точные open/closed anchor bounds.
- Неизвестный размер opening до allocation переносит весь state в unresolved;
  exact derived opening участвует в proportional расходах как отдельный lot.
- `d > inventory` после любого принятого opening authority fail-closed весь
  затронутый state.
- Start checkpoint и derived-from-anchor имеют разные evidence refs; для
  `exact_episode` derived mode требует exact pre-event balance witness.
- Reconstructed balance без independent snapshot witness не проходит
  reconciliation сам с собой.
- `Q > balance` не возвращает потраченные исторические входы.
- Повторные events одного funder сохраняют разные anchors.
- Выбранный агрегированный funder раскрывает все non-terminal contributing
  episodes, а child anchor всегда строго раньше parent target; уже terminal
  episode того же funder не открывается повторно.
- Exact GasFree principal продолжается, fee расходует inventory без AML path.
- GasFree fee создаёт accounting lot у exact fee recipient; multi-movement
  allocation matrix сохраняет все row/column sums.
- GasFree matrix policy order детерминирован, но не выдаётся за chain order;
  без exact atomic parser binding settlement unresolved.
- Два неупорядоченных outgoing не агрегируются ради current balance.
- Same-owner relocation наследует lineage, но hard evidence entity не теряется.
- Incomplete adverse-probe запрещает `screened_nonmaterial_tail`.
- `95%` проверяются integer inequality; exact terminal episode не попадает
  одновременно в funder prefix.
- Exact adverse source endpoint становится terminal, а proxy/pattern red path
  остаётся mandatory continuation по frozen matrix.
- Version/hash adverse terminal matrix входят в artifact и изменение матрицы
  требует новой policy identity.
- Любая нелокализованная order/economic/ownership ambiguity переносит весь
  state amount в unresolved leaf.
- Scheduler concurrency, batch size, top-k и restart не меняют semantic output.
- Legacy и Unified adapters при одинаковых normalized query, snapshot, policy,
  boundary/adverse evidence и canonical tape получают одинаковые
  ledger/allocation artifact bytes; их внешние branch/report artifacts не
  обязаны быть побайтно одинаковыми.

## Разбиение будущей реализации

После утверждения дизайна и ручного replay implementation plan делится на
отдельные поставки:

1. canonical order и history/checkpoint contract;
2. чистый integer ledger с property tests;
3. query adapters для трёх purpose;
4. recursive hop states, adverse-probe и `screened_nonmaterial_tail`;
5. GasFree/ownership integration;
6. автоматизация уже принятого frozen corpus и semantic comparator;
7. disabled-by-default legacy/Unified integration и отдельный rollout gate.

Ни одна поставка не меняет production policy скрыто.

## Уже подтверждённая основа

- Основа — chronological proportional ledger.
- Источник текущего баланса определяется после учёта всех последующих расходов.
- `amount_only` и exact transaction episode — разные запросы.
- Все hops используют одну модель и один `usedAmountRaw`.
- Все funder-ы проходят adverse-probe; deep раскрывает минимум `95%` плюс все
  proven-red ветки.
- Exact self-transfer не меняет cashflow.
- Разные адреса связываются только exact ownership evidence.
- Exact GasFree fee уменьшает остаток, но не создаёт AML-ветку; principal
  остаётся обычным денежным движением.
- Если точный порядок способен изменить allocation, его отсутствие означает
  unresolved, а не приблизительный ответ.

Детали integer remainder, opening/residual lots, state/leaf closure, exact
GasFree matrix, adverse receipt и artifact schema являются утверждённым
design-контрактом. Это не rollout approval: до реализации и отдельного
acceptance текущие production paths не меняются.
