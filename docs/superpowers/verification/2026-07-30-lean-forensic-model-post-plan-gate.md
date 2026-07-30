# Lean Forensic Model — post-plan gate

Дата проверки: 2026-07-30

Проверенный HEAD: `d6113b066bb933b785793c2950dac5db329b4953`
Ветка: `codex/lean-forensic-model-validation`

## Решение

Offline-план реализовал две полезные чистые библиотеки, но общий corpus gate **не
пройден**. Детерминированный runner завершился с кодом `1`: совпали только `8`
из `37` результатов, `29` замороженных ожиданий не были реально переиграны, а
данные содержат `4` честно зафиксированных пробела.

Поэтому на этом gate:

- production-код не добавляем;
- production-интеграцию cashflow не начинаем, пока все семь ledger-кейсов не
  станут исполняемыми и не будет принят хотя бы один настоящий canonical tape;
- Stage C runtime wiring не начинаем, пока отдельный service/adverse admission
  gate не даст полный результат и не появится пригодная реальная role-authority;
- Stage D не планируем к исполнению.

| Часть | Фактический результат | Вердикт |
|---|---|---|
| Pure cashflow library | Реализована, focused/property-тесты проходят | Хорошая основа, но не corpus acceptance |
| Cashflow corpus | `0/7`; шесть `expectation_level`, реальный `…PacGy` unresolved | Gate failed |
| Pure service classifier | Реализован `100 + 100`, пороги и fail-closed состояния тестируются | Годен для следующего offline/shadow gate |
| Service corpus | `3/24` совпали; `21/24` не переиграны полностью | Gate failed |
| Adverse corpus | `5/6`; blacklist-результат не сравнил вложенные temporal expectations | Неполный |
| Broad ordinary-wallet scope | `0` кейсов | Не проверен этим планом |
| Production readiness | Нет | Заблокирована |
| Stage C shadow readiness | Нет: нет полного admission receipt и пригодной реальной role-authority для wiring; blind set собирается на/после shadow и не блокирует сам shadow | Admission/wiring blocked; action/Stage D blocked by later blind review/adjudication |
| Stage D | Только design | Отложена |

## Детерминированный receipt

Два запуска дали одинаковый stdout и пустой stderr:

| Поле | Значение |
|---|---:|
| Exit code | `1` |
| Всего кейсов | `37` |
| Совпало | `8` |
| Не переиграно | `29` |
| Из них `expectation_level` | `27` |
| Другие два | `…PacGy` unresolved; blacklist с непереигранными вложенными ожиданиями |
| Data gaps | `4` |
| stdout | `11,958` bytes |
| SHA-256 | `6ddce2ac4814f5cd9a6f5e38359662c63c706004feea7f31af4b133323adb109` |
| stderr | `0` bytes |

Последний commit `d6113b06` усилил тест доказательства CLI write-safety и
обновил только metadata `last_verified` в roadmap. Он не изменил corpus counts,
exit code, bytes или hash.

Четыре data gaps:

1. `pacgy-recorded-chronology` — `history_incomplete`;
2. `tqr-d7nzp-recorded-control` — `recorded_partial_vector`;
3. `txc-vusxvhd-recorded-control` — `insufficient_service_windows`;
4. `w8srl-two-window-calibration` — `recorded_partial_vector`.

## Cashflow: сверка со спецификацией

Сверка выполнена с
[chronological proportional cashflow spec](../specs/2026-07-29-chronological-proportional-balance-provenance-design.md).

### Уже реализовано в pure library

- receipt-log identity, дедупликация provider aliases, collision и unresolved
  identity: [chronologicalProportionalLedger.ts:211](../../../src/forensics/chronologicalProportionalLedger.ts#L211);
- порядок только по `blockNumber / transactionIndex / eventIndex`; timestamp и
  hash не используются вместо отсутствующего transaction order;
- integer proportional allocation с largest remainder и стабильным tie-break:
  [chronologicalProportionalLedger.ts:274](../../../src/forensics/chronologicalProportionalLedger.ts#L274);
- zero-opening `genesis_complete` ledger, входящие lots и пропорциональное
  потребление каждым исходящим событием:
  [chronologicalProportionalLedger.ts:338](../../../src/forensics/chronologicalProportionalLedger.ts#L338);
- exact self-transfer — cashflow no-op:
  [chronologicalProportionalLedger.ts:371](../../../src/forensics/chronologicalProportionalLedger.ts#L371);
- overdraw переводит весь ledger в unresolved `debit_exceeds_inventory`:
  [chronologicalProportionalLedger.ts:389](../../../src/forensics/chronologicalProportionalLedger.ts#L389);
- три отдельные проекции `current_balance`, `amount_only`, `exact_episode`,
  pinned independent balance witness для первых двух:
  [chronologicalProportionalLedger.ts:466](../../../src/forensics/chronologicalProportionalLedger.ts#L466);
- правило deep selection `95%` и обязательное сохранение exact-red contributor:
  [chronologicalProportionalLedger.ts:442](../../../src/forensics/chronologicalProportionalLedger.ts#L442);
- property/regression-проверки сохранения суммы, permutation, duplicate,
  collision, order, remainder, self-transfer, overdraw и witness binding.

### Осталось design-only или требует исправления

- corpus compositor не вызывает ledger для шести synthetic-кейсов: он выдаёт
  `expectation_level`; следовательно, unit-тесты библиотеки не заменяют corpus
  acceptance ([offlineForensicModelReplay.ts:312](../../../src/forensics/offlineForensicModelReplay.ts#L312));
- настоящий canonical input/tape с независимой source/opening/order authority;
- `start_checkpoint`, `derived_from_anchor` и exact
  `unknown_opening_balance` lot; текущая библиотека принимает authoritative
  replay только для `genesis_complete` и zero opening;
- рекурсивное движение `A <- B <- C <- D`, state/leaf closure и единый artifact
  contract с version/hash;
- exact ownership merge и полноценная GasFree economic-group интеграция;
  нынешний GasFree adverse-кейс проверяет роли principal/fee, но ledger не
  исполняет эту сцену;
- полный adverse-probe всех funder-ов и versioned adverse terminal matrix;
- fail-closed public reason mapping, persistence, restart/recovery и любая
  legacy/Unified/Where/Incoming integration;
- спецификация требует `0 < amount_only <= balance`, а pure API сейчас может
  вернуть complete для нулевого `requestedAmountRaw`; это надо закрыть до
  production foundation acceptance.

### Все семь ledger-кейсов

| Кейс | Evidence class | Фактический replay | Match | Что доказано / чего не хватает |
|---|---|---|---:|---|
| `pacgy-synthetic-zero-opening-control` | synthetic | `expectation_level` | Нет | Библиотечный тест отдельно доказывает `180/180` coverage и `180/300` source utilization; corpus runner это ожидание не исполняет |
| `integer-remainder-control` | synthetic | `expectation_level` | Нет | Pure largest-remainder покрыт тестом, но corpus-case не replayed |
| `exact-self-transfer-control` | synthetic | `expectation_level` | Нет | Pure no-op покрыт тестом, но corpus-case не replayed |
| `identity-collision-control` | synthetic | `expectation_level` | Нет | Pure collision fail-closed покрыт тестом, но corpus-case не replayed |
| `missing-order-control` | synthetic | `expectation_level` | Нет | Pure order fail-closed покрыт тестом, но corpus-case не replayed |
| `debit-over-inventory-control` | synthetic | `expectation_level` | Нет | Pure overdraw fail-closed покрыт тестом, но corpus-case не replayed |
| `pacgy-recorded-chronology` | recorded calibration vector | `unresolved / history_incomplete` | Нет | Правильный fail-closed итог, но nested frozen current-balance expectation не replayed; opening/history/balance authority отсутствует |

Synthetic `300 -> 70 -> 12 -> 180 -> 38` означает только:

```text
покрытие выбранного episode = 180 / 180 = 100%
использование входного lot   = 180 / 300 = 60%
```

Это не доказательство для настоящего `…PacGy`. Recorded chronology показывает
полезный сценарий, но без доказанно полной истории и pinned independent balance
witness реальный `…PacGy` остаётся unresolved.

## Service boundary: сверка со спецификацией

Сверка выполнена с
[service-boundary sampling spec](../specs/2026-07-29-service-boundary-sampling-amendment-design.md).

### Уже реализовано в pure classifier

- максимум первые `100` физических rows и отсутствие top-up после dedupe:
  [serviceBehaviorResearch.ts:169](../../../src/forensics/serviceBehaviorResearch.ts#L169);
- canonical dedupe, collision inventory и проверка exact order slots;
- exclusion `poisoning_only` и `gasfree_fee`, при этом `gasfree_principal`
  остаётся feature-eligible:
  [serviceBehaviorResearch.ts:206](../../../src/forensics/serviceBehaviorResearch.ts#L206);
- feature vector: direction, breadth, concentration, cadence, hourly activity,
  repeated amounts и extreme throughput;
- точные integer predicates `C/B/G/H/R/X` и формула
  `C AND B AND G AND (H OR R OR X)`:
  [serviceBehaviorResearch.ts:286](../../../src/forensics/serviceBehaviorResearch.ts#L286);
- оба окна должны иметь по `100` canonical событий, authoritative order и
  разделение минимум семь дней;
- состояния `high_inferred_service`, `non_service_profile`,
  `insufficient_data`, `role_conflict`:
  [serviceBehaviorResearch.ts:328](../../../src/forensics/serviceBehaviorResearch.ts#L328).

### Осталось design-only

- canonical anchor и самостоятельная выборка recent/historical provider pages;
  classifier сейчас получает уже подготовленные окна;
- hash-bound raw/accepted history reconstruction; recorded vectors не являются
  exact evidence;
- доказанная economic role каждого sampled event, включая provider-risk;
- проверка checked-subject и EOA-at-anchor authority внутри интеграционного
  контракта; pure classifier сам этого не знает;
- exact Binance/HTX role binding именно в proposed Stage C shadow path;
  production V2 exact CEX boundary/completion уже существует, но в этот shadow
  path не входит;
- one-hop adverse probe всех sampled counterparties, temporal blacklist,
  drainer red-branch continuation и incomplete-provider semantics;
- immutable profile/adverse artifacts, page-quality proof, restart/recovery и
  `reportReady` lifecycle;
- Stage C shadow hook, persistence и byte-for-byte non-interference;
- frozen blind set, два review и adjudication для boundary action/Stage D;
- любые `wouldAction`, `boundaryEligible`, fan-out suppression и Stage D;
- `500 + 100`: ни один реальный ambiguous-case его не активировал.

## Реальные и recorded service-кейсы

`Matched` здесь означает лишь совпадение с полями, которые runner действительно
сравнил. Оно не повышает evidence class.

| Адрес / кейс | Фактический результат | Match | Вывод |
|---|---|---:|---|
| `…W8SRL` | `high_inferred_service` | Да | Два recorded-вектора проходят predicate, но raw pages не сохранены и не replayed; результат не authoritative и не разрешает boundary |
| `…D7NzP` | `expectation_level`; `recorded_partial_vector` | Нет | Sparse evidence содержит `C=false` и checked-subject; полного vector/window replay нет. Subject обязан `continue_full` по design, не по выполненному classifier replay |
| `…98cdn` | `expectation_level`; recorded `P=true`, `X=true` | Нет | Whole-export calibration, а не `100 + 100` replay |
| `…aEGqTr` | `expectation_level`; recorded `P=true`, `X=true` | Нет | Whole-export calibration, а не `100 + 100` replay |
| `…SH14eaf` | `expectation_level`; recorded `P=false` | Нет | Recorded vector: `C=false`, `B=false`; classifier в runner не переигран |
| `…VUSXVhd` | `insufficient_data` | Да | Recent только `73`, historical baseline пуст; unresolved/insufficient не повышен до положительного результата |
| exact Binance `…JJpBXh` | `exact_service_role`, inferred bypassed | Да | Exact temporal resolution по hash-locked normalized row; исходное provider assertion не replayed |
| exact HTX `…V8x5jLu` | `exact service role`, `adverse=true`, inferred bypassed | Да | Boundary-role и adverse semantics разделены; исходное provider assertion не replayed |

Остальные recorded CSV controls также учтены все, но не replayed:

- recorded `P=true`, actual `expectation_level`:
  `…owfnme`, `…eXDwoq`, `…aEGqTr`, `…q98cdn`;
- recorded `P=false`, actual `expectation_level`:
  `…SqPaM9`, `…hQBSuW`, `…cKQz2J`, `…m7MWZv`, `…H14eaf`,
  `…EMCMLc`, `…DbNGMf`, `…Yw8Pet`, `…A94s8d`, `…Fa5pk8`,
  `…Riiwed`, `…k1Hjbo`, `…r7RZVx`, `…axRTDo`, `…oqZ4dZ`,
  `…ujBwhV`.

Это `20` expectation-only CSV controls. `…JJpBXh` — двадцать первый CSV
control; он matched только через exact normalized label resolution, не через
replay его recorded behavior vector.

## Adverse и drainer/Verify20

| Кейс | Evidence class | Фактический результат | Match | Ограничение |
|---|---|---|---:|---|
| `drainer-complete-evidence` | `synthetic_edge_case` | `exact_drainer_red` | Да | Full unblocked Verify20 fingerprint + exact confirmed successful call + matching official-USDT movement; `approvalCall` этим evaluator не проверяется, это не captured real path |
| `drainer-method-only` | synthetic | `context_only`, red=false | Да | Один метод/fingerprint без exact movement не повышается до red |
| `event-time-blacklist-partitions` | synthetic | правильные `before/active/unknown` суммы | Нет | Верхний результат вычислен, но вложенные per-transfer temporal expectations runner не сравнил |
| `exact-binance-label` | exact frozen normalized row | non-adverse exact service | Да | `raw_provider_assertion_not_replayed` |
| `exact-htx-label` | exact frozen normalized row | exact service + adverse | Да | `raw_provider_assertion_not_replayed` |
| `gasfree-principal-fee-classification` | synthetic parser scene from recorded amounts | principal AML path; fee accounting-only | Да | `ledgerExecuted=false`; provenance остаётся не доказанным |

Реальные ранее наблюдавшиеся drainer/Verify20-цепочки в этот frozen corpus не
включены. Поэтому текущий gate не подтверждает detection на настоящем пути в
два, три или четыре hop. `drainer-complete-evidence` нельзя называть реальным
captured case.

## Полный список matched и mismatches

Совпали ровно восемь ID:

```text
csv-JJpBXh
txc-vusxvhd-recorded-control
w8srl-two-window-calibration
drainer-complete-evidence
drainer-method-only
exact-binance-label
exact-htx-label
gasfree-principal-fee-classification
```

Не совпали `29`: все `7` ledger cases, `20` CSV behavior controls кроме
`csv-JJpBXh`, sparse `tqr-d7nzp-recorded-control` и
`event-time-blacklist-partitions`. В corpus нет ни одного broad-scope кейса,
поэтому обычный контракт subject/direct-neighbor/second-hop этим gate не
проверен.

## Diff и scope audit

Аудит сравнивал offline implementation с commit `3824f65a` и отдельно проверял
последние test-only hardening commits.

До `bcca8ee5` scope составлял ровно `7` файлов, `7,641` добавление и `2`
удаления; mixed replay был `1,317` строк, тест — `3,665` строк. После
`d6113b06` фактический итоговый diff — те же `7` файлов, `7,649` добавлений и
`3` удаления, а тест вырос до `3,672` строк: последние `+11/-4` в тесте усилили
CLI write-safety proof, а `+1/-1` в roadmap обновили только `last_verified`.
Import-graph proof и runtime receipt не изменились.

Изменены только:

```text
docs/knowledge/14-current-roadmap.md
scripts/replayForensicModelCorpus.ts
src/forensics/chronologicalProportionalLedger.ts
src/forensics/offlineForensicModelReplay.ts
src/forensics/serviceBehaviorResearch.ts
tests/fixtures/forensics/forensic-model-offline-corpus-v1.json
tests/forensics/offlineForensicModelReplay.test.ts
```

Не добавлены и не стали runtime-reachable:

- production routing, traversal или completion;
- Stage D и fan-out suppression;
- scoring;
- Telegram/Admin output;
- PostgreSQL, migration, jobs или persistence;
- provider/network calls;
- `500 + 100`;
- config flag, dependency или новая package dependency;
- canary, rollout или activation.

CLI runtime import graph отдельно проверен через TypeScript AST; локальные
runtime edges разрешены, type-only edges исключены, production paths не
достижимы. `git diff --check` проходит.

Большой риск сопровождаемости уже виден: mixed replay `1,317` строк и один тест
`3,672` строки. Следующий cashflow foundation-план специально выносит ledger
corpus replay, parser и shadow artifact в отдельные узкие файлы. Само по себе
разбиение строк не является целью; причина — независимая authority boundary и
исполняемый seven-case gate.

## Проверки

На проверенном дереве зафиксированы:

| Команда / gate | Результат |
|---|---|
| `npm test -- tests/forensics/offlineForensicModelReplay.test.ts` | `155` passed |
| Eight-file authority gate | `374` passed |
| Companion regressions | `33` passed |
| `npm test` | `5,106` passed, `157` skipped; `288` passed files, `27` skipped |
| `npm run typecheck` | passed |
| Два byte-captured CLI запуска | оба exit `1`, byte-identical `11,958`, одинаковый SHA-256, stderr `0` |
| Runtime import graph audit | passed; production graph excluded |
| `git diff --check` | passed |

Skip не выдаются за PostgreSQL или production proof. Последний `d6113b06` —
test-only fix; он не изменил перечисленные corpus counts/bytes/hash.

## Следующие отдельные планы

### 1. Cashflow production foundation — сначала, но сейчас blocked

Готов отдельный
[Cashflow Corpus Gate And Shadow Foundation plan](../plans/2026-07-30-cashflow-corpus-gate-and-shadow-foundation.md).
Он сначала делает исполняемыми все `7/7` ledger-кейсов, требует независимо
принятый настоящий canonical tape и строит только JSON-safe in-memory shadow
artifact. Production integration остаётся за следующим отдельным планом и не
может начаться до человеческого approval foundation receipt.

Таким образом, запрошенная будущая последовательность сохраняется:

1. закрыть cashflow corpus/authority gate;
2. после отдельного подтверждения спланировать disabled cashflow policy;
3. доказать нулевое влияние policy-off и только затем обсуждать подключение к
   Where/Incoming/Unified.

### 2. Stage C shadow `100 + 100` — отдельно; cashflow-first только продуктовая последовательность

Готов отдельный
[Stage C Shadow Service 100 + 100 plan](../plans/2026-07-30-stage-c-shadow-service-100-plus-100.md).
Stage C plan технически не зависит от cashflow; порядок cashflow-first здесь
фиксирует выбранную продуктовую последовательность, а не prerequisite между
библиотеками.

Его первый admission unit обязан дать service `24/24`, adverse `6/6`, хотя бы
одну реально реконструированную accepted history и честные per-case evidence
limitations. После этого обязательна остановка для человеческого approval.

Даже после approval wiring разрешено только если:

- есть хотя бы одна реальная accepted history с `200` hash-bound economic roles;
- standalone immutable storage и finalizer isolation доказаны;
- shadow on/off сохраняет одинаковые provider tape, frontier, terminals,
  score, report, presentation, Telegram, delivery и Admin bytes;
- default остаётся disabled и shadow failure/timeout не влияет на основной run.

Текущий ожидаемый prerequisite — zero useful real role coverage, то есть план
должен остановиться до runtime wiring, пока отдельный role-materialization
producer не будет спроектирован и принят.

### 3. Stage D

Не планировать к исполнению. В выбранной продуктовой последовательности к нему
возвращаются после cashflow foundation; это не техническая зависимость Stage C
от cashflow. Непосредственные gates для action/Stage D — полный Stage C
admission, frozen blind set, два review, adjudication и отдельное новое решение
пользователя.

## Knowledge и рабочее дерево

Прочитаны `docs/knowledge/AGENT_BRIEF.md`,
`docs/knowledge/14-current-roadmap.md`, обе целевые спецификации, lean-план и
два следующих implementation-плана. Product truth уже обновлён в roadmap по
измеренному failed gate. Этот документ добавляет post-plan сопоставление, но не
меняет product behavior.

Pre-existing пользовательские изменения в `docs/audit/*`,
`docs/knowledge/10-open-problems.md`, `docs/knowledge/13-agent-observations.md`,
`csv addresses/`, `outputs/` и других незакоммиченных файлах сохранены. Ничего
не staged и не committed.

## Что можно утвердить сейчас

1. Утвердить только post-plan вывод и разрешить отдельное выполнение cashflow
   foundation-плана.
2. Попросить сначала скорректировать cashflow foundation-план.
3. Оставить оба следующих плана без исполнения и вернуться к evidence corpus.

Ни один вариант не разрешает Stage D или автоматический переход к
production-коду.
