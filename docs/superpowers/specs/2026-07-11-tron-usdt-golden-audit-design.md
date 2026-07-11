# Golden dataset и изолированный audit runner для TRON USDT

Дата: 2026-07-11
Статус: дизайн утверждён пользователем; реализация не утверждена

## 1. Назначение

Этот документ определяет процесс превращения существующих 31 legacy audit rows
и 73 сохранённых forensic jobs в воспроизводимый scope-specific golden dataset.
Он также задаёт границы отдельного audit runner, который сможет прогонять
текущие analyzers в live/replay режимах без изменения production scoring,
analyzers, jobs, индекса или пользовательских решений.

Цель пилота — утвердить:

- идентичность Wallet, Incoming Deposit, Selected Amount, Route и History cases;
- формат frozen evidence, facts, routes, coverage и policy expectations;
- протокол независимого manual web/on-chain research;
- authority явных TronScan service labels;
- слепой независимый второй проход;
- правила adjudication и release;
- измеримость качества и runtime-показателей;
- техническую изоляцию audit tooling.

Пилот не утверждает новую production policy, target architecture, численные
thresholds, полезную глубину трассировки или целевые FN/FP. Эти решения
принимаются после полного baseline.

## 2. Не входит в объём

До отдельного последующего approval запрещены:

- изменение production scoring или disposition;
- изменение Fast, Deep, Where Is Money и Incoming analyzers;
- изменение jobs, очередей, retry, targeted indexing или reconciliation;
- создание новых production labels/assertions;
- изменение Telegram/Admin presentation;
- реализация base/strict/compliance policy adapters;
- implementation plan целевой продуктовой архитектуры.

Audit runner является измерительным инструментом. Его архитектура не означает
автоматического утверждения canonical evidence snapshot как production target.

## 3. Принятый подход

### 3.1 Anchor-first identity

`forensic_check_jobs` — это исполнения, а не cases. Число cases нельзя получать
умножением job kinds на потенциальные возможности analyzer.

Ранее полученная оценка `до 123 scope-кандидатов` не используется как count или
верхняя граница golden dataset: она повторно считала reruns и смешивала scope с
analyzer capability.

Надёжно зафиксировано:

- 31 legacy subject rows;
- 73 historical job executions;
- 42 повторных запуска по тем же subjects;
- 28 уникальных Incoming transaction anchors среди 30 Incoming jobs;
- 55 legacy `subject row × declared action unit` stubs;
- 62 механических stubs, если 21 subject-level Incoming membership заменить 28
  transaction anchors.

`62` также не является golden count. После нормализации часть stubs останется без
достаточного anchor, а часть разделится по transaction, amount, window или
episode. Финальная cardinality является результатом adjudication.

### 3.2 Два слепых прохода

Каждый final golden case получает два независимых прохода. Второй reviewer не
читает и не подтверждает работу первого, а сначала строит собственную
реконструкцию. После блокировки обоих результатов выполняется исчерпывающий
field-level diff.

### 3.3 Critical reconstruction

Для blacklist, sanctions, drainer, mixer, любого ожидаемого `DECLINE` и любого
спорного case второй проход включает полную независимую реконструкцию, а не
проверку чек-листа или score.

### 3.4 Тонкий audit-only runner

Пилот использует отдельный file-based runner поверх существующих analyzer
entrypoints и audit adapters. Production DB доступна только команде freeze в
read-only transaction. Live и replay не открывают production DB.

Полный runtime на disposable DB clone откладывается до измерения очередей,
targeted indexing, restart/retry и экспериментов с количеством ключей.

### 3.5 Manual research отдельно от runner

Manual analysts формируют независимый эталон, используя источники шире текущей
системы. Golden Runner не делает свободный web research и не может быть автором
golden facts; он измеряет только фактический output production modules.

## 4. Модель идентичности

### 4.1 Сущности

| Сущность | Назначение |
| --- | --- |
| `investigation_id` | Навигационная группа одного адреса, депозита или доказанного episode; не denominator метрик |
| `case_id` | Ровно один scope и один action unit |
| `case_revision` | Immutable версия scope, facts, expectations и evidence hashes |
| `analyzer_run_id` | Один historical job id; все 73 jobs сохраняются 1:1 |
| `case_run_id` | Одна fresh/replay попытка case под фиксированными code/config/index/cache |
| `observation_id` | Один frozen capture: artifact hash плюс точный locator |
| `canonical_fact_key` | On-chain event identity после raw-log validation |
| `policy_evaluation_id` | `case × policy profile × policy version` |
| `review_id` | Один locked reviewer output поверх точных case/evidence hashes |

`case_id` не включает analyzer kind, policy profile, score, decision, job status
или reviewer identity.

### 4.2 Identity по scope

| Scope | Обязательная identity |
| --- | --- |
| Wallet | chain, token, subject role, `as_of` block/time |
| Incoming Deposit | chain, token contract, tx hash, log index; sender, receiver, amount и timestamp проверяют identity |
| Selected Amount | subject, token, amount raw, denominator, cutoff/anchor и allocation convention |
| Route | requested episode/primary tx, start/end roles и event interval |
| History | subject и явное окно `[from, to]` либо зафиксированный all-time cutoff |

Ordered route steps являются adjudicated facts/hypotheses, а не частью
неизменяемого case id: reviewers могут независимо найти competing routes.

Если log index Incoming event не восстановлен, используются tx/token/roles/
amount/timestamp как locator, но case остаётся `unresolved_scope_stub` и не
попадает в golden denominators до raw-log validation.

### 4.3 Split и merge

- Incoming split выполняется по canonical deposit Transfer event, не по sender
  или subject row.
- Wallet split выполняется по subject и `as_of` snapshot.
- History split выполняется по явному окну.
- Selected Amount split выполняется при различии amount, cutoff/anchor,
  balance/recent-flow question или allocation convention.
- Route split выполняется по requested episode/start/end/window. Competing
  hypotheses, split/merge branches и cycles одного principal остаются внутри
  case.
- Merge допустим только при полном совпадении identity key.
- Различие job kind/status/score/policy создаёт разные runs/evaluations, но не
  новый case.
- Sibling links, найденные по chat/requester/time, не используются как identity.
- `followUpJobs` может быть только `related_run_ids`.
- Missing anchor не восстанавливается по latest job или эвристике.

## 5. Пилот

Пилот начинается с пяти primary scope seeds. Каждый analyst дополнительно
проверяет полноту case inventory. Найденный отдельный action unit создаёт новый
candidate case и не поглощается subject-level verdict.

| Scope | Pilot | Проверяемое правило |
| --- | --- | --- |
| Wallet | `TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD` → `TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm` | Historical transfers до blacklist activation не становятся adverse-at-event из-за current state |
| Selected Amount | `TPdrEz6N5pJoUbnnEcSz56e3wumV5mmGJE`, source locator job `f2e76e7c-bc04-4aa0-87ec-1f740effd3b9` | Exact approve/transferFrom/drain relation и affected amount |
| Route | `TNAraW3cWKETcRz9p6obg7SzeiMzH2Z9i1` | `route_linked`, hop 1 остаётся route-correlated и не повышается до exact drainer/95 |
| Incoming Deposit | tx `d411b5f1ee00b8261b95444a97f191fabc1ab6cd3d806005df5f770be5a674db` → `TC3dkHK8kqgv81Fko7AG31Qd2EyRDbNGMf` | Clean CEX deposit не наследует автоматически noisy wallet history |
| History | `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe` | Service boundary, unknown contract, partial coverage и спорный legacy `DECLINE` |

Таблица фиксирует pilot seeds, а не завершённые identities. До перехода в
`scope_locked` каждый seed обязан получить все identity-поля из раздела 4.2.
Historical job id является только lineage locator: для TPdr/TNAra должны быть
отдельно зафиксированы exact primary transaction/log или episode anchor, для
Wallet — `as_of`, для History — exact window. Seed без такого anchor остаётся
`unresolved_scope_stub` и не подменяется догадкой.

Сразу после пилота первой очередью обрабатываются:

- `THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7` с paired technical-stop/materiality runs;
- current subject blacklist `TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm`;
- HTX до и после designation;
- observed либо authoritative synthetic mixer control;
- sanctions, DEX/proxy и GasFree fee controls.

Observed и synthetic cases всегда находятся в разных cohorts и denominators.

## 6. Manual Forensic Research Protocol

### 6.1 Разделение ответственности

Golden truth строит ручной forensic research, а не Golden Runner. Для каждого
pilot/legacy investigation создаются отдельные blind analyst sessions. Analyst
может свободно использовать explorers, API, интернет-поиск, официальные
документы и внешние расследования, чтобы найти факты, отсутствующие в текущей
системе.

Golden Runner начинает работу только после lock ручных expectations. Он:

- не занимается свободным поиском в интернете;
- не выбирает новые сервисы для golden dataset;
- не сообщает analyst результаты Fast/Deep/Where/Incoming до adjudication;
- воспроизводимо запускает текущую систему;
- передаёт Comparator frozen outputs и metrics.

Это предотвращает круговую проверку, при которой ручной эталон копирует только
те же данные и выводы, которые уже использует production.

### 6.2 Обязательный порядок исследования

Для каждого investigation analyst выполняет:

1. **Общую идентификацию:** валидность адреса, EOA/contract, current blacklist,
   TronScan labels, известные entities и observation time.
2. **Доступную USDT-историю:** входящие/исходящие transfers, amounts, dates,
   balance-forming candidates, повторяющиеся counterparties, contract-driven
   transfers и fees отдельно от principal.
3. **Transaction/contract inspection:** logs, calls, ABI, approve/permit,
   `transferFrom`, proxy/implementation relationship и service interaction.
4. **Материальные маршруты:** direction, ordered hops, amount preservation,
   split/merge/cycle, delays, transit behavior и service boundaries.
5. **Внешнее исследование:** address, transaction hash, contract, entity name,
   official service documentation, sanctions/blacklist sources, public warnings
   и расследования.
6. **Scope split:** отдельные Wallet, Incoming Deposit, Selected Amount, Route и
   History cases без переноса disposition между ними.
7. **Досье:** facts, assertions, leads, routes, amounts/shares, temporal
   relations, limitations, alternatives, sources, dates и content hashes.

Analyst сохраняет не только найденный вывод, но и отрицательный результат
поиска: какие источники и окна проверены и что осталось неизвестным.

### 6.3 TronScan service label authority

Явный service label, отображаемый TronScan для конкретного адреса, является
достаточным доказательством того, что адрес принадлежит указанной entity и
service category. Для подтверждения самой identity не требуется второй внешний
источник.

Authority называется `tronscan_service_label` и может создавать
`verified_service_assertion` для CEX, bridge, DEX, mixer, payment/exchange
service или другой явно названной категории.

Каждый reviewer независимо сохраняет:

- address;
- exact displayed label;
- normalized entity name;
- normalized service category;
- TronScan page/API locator;
- raw API response либо screenshot;
- `observed_at`;
- content hash;
- reviewer capture id.

Два независимых captures должны показывать согласованную identity. Если label
между captures изменился или исчез, assertion получает `timeline_conflict` либо
versioned intervals; один reviewer не копирует screenshot другого.

### 6.4 Границы доказательства TronScan label

| Label доказывает | Label не доказывает автоматически |
| --- | --- |
| Принадлежность конкретного адреса named service | Принадлежность соседних unlabeled addresses тому же service |
| Service category адреса | Что конкретный перевод clean, adverse или будет принят биржей |
| Наличие on-chain service boundary | Продолжение маршрута внутри custody/service boundary |
| Mixer identity, если label явно называет mixer | Amount, direction, temporal applicability и materiality конкретной связи |
| CEX/bridge/DEX identity | Sanctions status и designation interval |
| Identity на observation time | Что тот же label уже существовал на любую историческую дату |

Следствия:

- `Binance`, `KuCoin` или другой CEX label подтверждает CEX identity; `clean`,
  `allowed` или `risky` остаётся отдельным versioned policy property.
- Bridge label подтверждает bridge identity и границу публичной трассировки.
- DEX label подтверждает DEX identity, но не незаконность и не adverse origin.
- Mixer label подтверждает mixer identity; policy всё равно проверяет route,
  amount, event time и materiality.
- Drainer/scam label может подтверждать classification адреса, но exact drain
  конкретной транзакции требует approve/permit/transferFrom proof.
- Sanctions подтверждаются official list/authority и temporal interval.
- USDT blacklist подтверждается contract state/events.
- Отсутствие TronScan label не доказывает, что адрес не принадлежит сервису.

### 6.5 Другие внешние источники

Информация не из явного TronScan service label классифицируется отдельно:

| Статус | Смысл |
| --- | --- |
| `official_assertion` | Официальный contract, registry, service documentation или authority document |
| `corroborated_assertion` | Согласующиеся независимые источники с достаточной entity linkage |
| `lead` | Неподтверждённое упоминание, статья, пост или search result |
| `behavior_pattern` | Наблюдаемое exchange/bridge/mixer/transit-like поведение без установленной identity |
| `unresolved_entity` | Исследование не установило service identity |

`lead` не становится fact из-за повторения в нескольких копирующих источниках.
Behavior может поддерживать `REVIEW`, но не подменяет named service identity.

### 6.6 Adaptive depth и materiality

Research не обязан бесконечно обходить каждый dust-сосед. Trace продолжается,
если выполняется хотя бы одно условие:

- сохраняется материальная доля principal или сопоставимая сумма;
- короткий временной interval поддерживает continuity;
- направление ведёт к blacklist, sanctions, drainer или mixer;
- появляется DEX, bridge, CEX, proxy/aggregator либо unknown contract;
- адрес демонстрирует transit/collector/mule behavior;
- route повторяется;
- split/merge может изменить attribution;
- existing evidence допускает competing material hypotheses.

Hop depth сама по себе не является stop/risk rule. Dust фиксируется как факт,
но не расширяет research без materiality или отдельного exact adverse evidence.

### 6.7 Статусы новых адресов

Каждый найденный сосед получает один статус:

- `supporting_node` — нужен для доказательства route;
- `candidate_service` — потенциальная новая service identity;
- `candidate_golden_case` — проверяет самостоятельный action unit или новую
  способность системы;
- `locator_only` — нематериальная или случайная связь;
- `unresolved_entity` — данных недостаточно.

Не каждый supporting node становится golden case. Promotion требует отдельного
scope/anchor и измеримой способности системы, которую он проверяет.

### 6.8 Stop rules

Research может остановиться, когда выполнено одно из условий:

- mandatory fact/route подтверждён с требуемой authority;
- достигнута verified service boundary;
- material amount полностью распределён по disjoint ledger;
- дальнейшие branches нематериальны по case-specific rule;
- два analyst независимо фиксируют одинаковый data-source limit;
- provider/history gap делает следующий вывод недоказуемым;
- все remaining hypotheses сохранены как contested/unresolved.

Stop reason, checked sources, deepest material hop, unresolved amount и gaps
обязательны. Stop никогда не интерпретируется как clean или adverse.

### 6.9 Incremental service registry

Полный dataset всех CEX/bridge/DEX/mixer/proxy addresses не является
предусловием пилота или `golden v0`. Registry пополняется case-driven:

```text
service encountered
→ independent source captures
→ entity/category normalization
→ dual review
→ versioned registry assertion
→ use in new case revisions
```

TronScan-labeled address после согласованных captures может быть добавлен как
`verified_service_assertion`. Unlabeled address добавляется только с authority,
которую установил manual research. Registry entry хранит source, observed time,
content hash, validity knowledge и history изменений.

Новая/изменённая label создаёт новую registry version и не переписывает старые
golden facts. Historical event использует assertion, temporal applicability
которой явно установлена; current label может оставаться `current_state_only`
для вопроса о прошлом.

### 6.10 Golden coverage gaps и versioning

Каждая service/case category имеет dataset coverage status:

- `observed_verified`;
- `synthetic_only`;
- `unresolved_candidates`;
- `missing`.

`golden v0` может быть выпущен с `missing` или `synthetic_only` categories, если:

- gaps перечислены в manifest;
- quality metrics по отсутствующему class не рассчитываются;
- product coverage не заявляется шире фактического panel;
- unresolved entities не считаются ни clean, ни adverse;
- новые cases выпускаются как versioned `v0.x` additions;
- предыдущие runs/reports остаются immutable.

Добавление service/case расширяет dataset coverage, но не меняет truth старых
cases без новой evidence-backed revision.

## 7. Adjudication workflow

### 7.1 Neutral envelope

Координатор фиксирует только:

- chain/network и token contract;
- primary subject/entities и их роли;
- action unit и scope;
- primary tx/amount/window/event/check time;
- вопросы, которые должен разрешить reviewer;
- версии adjudication protocol и policy profiles.

Neutral envelope не содержит legacy manual outcome, текущий production score/
decision, Analyst 1 output или system-derived label, представленный как truth.

### 7.2 Frozen source bundle

До review сохраняются:

- redacted historical job payloads;
- raw provider/chain responses, необходимые для mandatory facts;
- external web/official source snapshots, URLs и retrieval dates;
- independent TronScan label captures;
- registry/service/label/sanctions assertions с retrieval time;
- official source references;
- exact source locators и content hashes;
- DB/index snapshot identity;
- known source limitations.

Saved job является P1 observation, а не ground truth. Явный TronScan service
label создаёт sufficient `tronscan_service_label` authority для service
identity/category по правилам раздела 6.3. Derived/system/provider labels другого
типа хранятся как assertions с собственной authority, source и validity.

Frozen archive и reviewer input являются разными projections одного snapshot.
Archive может сохранять redacted historical score/decision для последующего
baseline diff, но blind reviewer bundle обязан исключать:

- legacy manual outcome;
- production decision, score и risk band;
- policy reasons и presentation text;
- derived/system label, если он не показан только как versioned assertion с
  authority; independent TronScan service-label capture остаётся допустимым
  source evidence;
- outputs другого reviewer.

Verifier проверяет отсутствие этих полей до выдачи workspace. Доступ reviewer к
полному archive до lock фиксируется как `blinding_breach`; affected review
аннулируется и выполняется новой независимой сессией/reviewer.

### 7.3 Analyst 1

Analyst 1 не видит legacy/current automatic outcomes. Он:

1. исследует весь адрес или episode;
2. формирует собственный scope inventory;
3. фиксирует observations и facts;
4. строит routes/competing hypotheses;
5. составляет disjoint amount ledger;
6. описывает coverage и limitations;
7. фиксирует forbidden inferences;
8. после fact-stage применяет named policy profiles;
9. сохраняет expected/allowed outcomes и rationale;
10. блокирует output content hash.

### 7.4 Analyst 2

Analyst 2 получает тот же neutral envelope и не видит Analyst 1 output. Он
независимо выполняет те же десять шагов и отдельно проверяет полноту scope
inventory.

Для ordinary cases допускается использование того же frozen source bundle, но
не выводов и evidence selection первого analyst. Для critical reconstruction
второй analyst начинает с neutral anchor, самостоятельно отбирает raw/official
sources и создаёт отдельный reconstruction bundle.

### 7.5 Unblind и adjudication

После блокировки обоих outputs сравниваются:

- A-only и B-only cases;
- каждый fact и authority;
- каждый route edge/branch;
- direction, amount, share и denominator;
- event/check-time relation;
- coverage и technical limitations;
- required/optional/context-only signals;
- forbidden inferences;
- каждый policy outcome и decisive predicate.

Каждый элемент получает disposition:

- `confirmed`;
- `rejected`;
- `unresolved`;
- `out_of_scope`;
- `allowed_alternative`.

Factual/route/amount conflict разрешается по первичным источникам. Policy
conflict передаётся владельцу named policy. Score не усредняется. Если authority
не позволяет выбрать единственный вывод, сохраняются competing hypotheses или
allowed outcomes.

Human resolver вызывается только при конфликте и не заменяет обязательный
второй проход. Для спорного compliance-case после AI review resolver должен быть
человеком.

### 7.6 Reveal production output

Historical/current automated outputs раскрываются только после lock и
adjudication. Затем comparator фиксирует:

- найденные и пропущенные mandatory facts/routes;
- authority overclaim;
- scope leakage;
- false `ACCEPTABLE`/`DECLINE`;
- technical no-score;
- explanation completeness;
- runtime/request metrics.

Golden expectation никогда не передаётся production scorer.

### 7.7 State machine

```text
candidate
→ scope_locked
→ evidence_frozen
→ analyst_1_locked
→ analyst_2_locked
→ compared
   ├─ agreed
   ├─ allowed_alternatives
   ├─ conflict_open → resolved
   └─ provisional_human_pending
→ release_ready
→ golden
```

Blocking states:

- `missing_evidence`;
- `scope_changed`;
- `evidence_changed`;
- `decisive_fact_unresolved`;
- `reconstruction_incomplete`;
- `isolation_violation`.

Материальное изменение scope или evidence после unblind создаёт новую revision.
Затронутая часть требует нового слепого второго прохода; прежний reviewer не
может снова считаться blind.

## 8. Critical reconstruction contract

### 8.1 Blacklist

Обязательно независимо восстановить:

- official USDT contract state;
- verified add/remove event, block и timestamp;
- event time и check time;
- subject/counterparty role;
- direction;
- principal amount и fee distinction;
- relation `active_at_event`, `became_active_after_event`, `current_state_only`
  или другое допустимое temporal state.

### 8.2 Sanctions

Обязательно независимо восстановить:

- verified service identity;
- official authority, jurisdiction и list;
- designation/removal interval;
- transaction event time;
- применимость assertion к entity/service;
- route amount и service boundary.

Service identity predicate может быть подтверждён `tronscan_service_label`.
Юридический sanctions status и designation/removal interval всё равно требуют
official authority source.

### 8.3 Drainer

Exact relation требует независимой проверки:

- owner;
- spender;
- approval/permit;
- `transferFrom` или эквивалентной transaction-exact token relation;
- token movement;
- first receiver;
- false-positive guards.

Downstream hop > 0 хранится отдельно как route-correlated. Campaign/Verify20
pattern не повышается до exact transaction relation.

### 8.4 Mixer

Обязательно независимо восстановить service identity, authority, route, amount,
time и boundary. Явный TronScan mixer label достаточен для mixer identity при
двух independent captures. Неподтверждённый text mention из другого источника
или похожее поведение не являются named mixer identity.

### 8.5 DECLINE

Второй reviewer воспроизводит каждый decisive fact и каждый temporal/identity/
amount/coverage predicate policy. Совпадение score или outcome не считается
реконструкцией.

## 9. AI second review

Отдельная AI-session/model может быть вторым reviewer, если:

- она не наследует conversation/context Analyst 1;
- ей передаётся только neutral input bundle;
- сохраняются provider/model/version, prompt hash, input bundle hash и session
  identity;
- она создаёт собственный scope inventory и reconstruction;
- critical cases выполняются по тому же contract без упрощения.

Case получает явный reviewer composition, например `human_ai` или
`dual_human`. Пока хотя бы один спорный compliance-case после AI review не имеет
human confirmation, dataset status остаётся `provisional`. Human confirmation
является evidence-level adjudication, а не отметкой согласия.

## 10. Golden case schema

Каждый final `case.json` содержит минимум:

### Identity и lineage

- schema/protocol version;
- `investigation_id`, `case_id`, `case_revision`;
- `observed | synthetic | hybrid`;
- chain/network/token;
- scope/action unit;
- subject/entities и роли;
- primary transaction/log/amount/window/event time;
- legacy row ids, historical job ids и source hashes.

### Evidence и facts

- immutable evidence bundle hash;
- observations с exact locators;
- facts с direction, amount, share semantics и authority;
- source/date/content hash;
- TronScan label text/category/capture ids, если применимо;
- assertion validity interval;
- supporting и contradicting evidence;
- limitations и unresolved authority.

### Routes и amount ledger

- ordered mandatory и optional steps;
- split/merge/cycle/service-boundary states;
- alternative routes;
- allocation convention;
- disjoint partition:

```text
resolved_adverse
+ resolved_clean
+ resolved_service_only
+ contested
+ unresolved
= target_amount
```

Competing hypotheses внутри `contested` не суммируются повторно.

### Coverage

- requested scope/window/amount;
- source mode: frozen/live/replay/mixed;
- complete intervals и gaps;
- history, amount, route, temporal, service-identity и enrichment completeness;
- provider cap, budget, local limit и read failure;
- technical terminal reason.

Coverage не содержит verdict.

### Policy expectations

Для base, strict pre-deal и conservative compliance profiles:

- profile/version;
- `uniquely_adjudicated | allowed_alternatives | disputed | not_applicable`;
- allowed outcomes;
- expected outcome только при unique decision;
- decisive/context-only fact ids;
- required coverage;
- optional score band либо `null`;
- policy rationale.

Profile definitions в golden pack являются adjudication expectations, а не
реализацией production policy.

### Reviews

- оба independent review outputs и hashes;
- reviewer kind и independence attestation;
- complete diff;
- conflict/resolution records;
- human confirmation при необходимости;
- eligibility для fact/route/unique-decision metrics.

## 11. Audit tooling alternatives

### A. Расширить существующие scripts

Не выбран. `forensicScoringAudit.ts` читает mutable jobs и не делает replay.
`forensicWalletCalibrationRerun.ts` использует собственные bounded budgets и
может писать metadata/profile caches. `tronscan-pagination-probe.ts` измеряет
provider, но не product scope; его `redactUrl` сейчас возвращает URL без
редактирования.

### B. Audit-only adapters поверх production modules

Выбран. Один Golden Runner вызывает существующие analyzer functions через
explicit read/capture/replay ports. Все mutable operations направляются в
artifact-local store или fail closed.

### C. Full runtime на disposable clone

Отложен. Используется после quality baseline для job lifecycle, waits, restart,
targeted indexing и controlled key-scaling experiments.

## 12. Golden Runner

### 12.1 CLI

Один entrypoint без новых dependencies:

```text
npm run forensic:golden -- freeze --cases <manifest> --out <bundle>
npm run forensic:golden -- prepare-review --bundle <bundle> --reviewer <id>
npm run forensic:golden -- lock-review --workspace <path>
npm run forensic:golden -- run --mode live|replay --cases <manifest> --bundle <bundle>
npm run forensic:golden -- diff --golden <pack> --run <run>
npm run forensic:golden -- verify --path <bundle-or-run>
```

CLI reviewer id является audit metadata, а не authentication. Реальная reviewer
identity подтверждается организационным процессом и code review/commit history.

### 12.2 Freeze

Только `freeze` может открыть source DB. Он:

1. загружает exact job ids из seed manifest;
2. использует один checked-out connection;
3. выполняет `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`;
4. проверяет `SHOW transaction_read_only = on`;
5. использует allowlisted tables/queries;
6. экспортирует deterministic ordered rows;
7. создаёт redacted content-addressed blobs;
8. записывает snapshot identity и counts;
9. всегда выполняет `ROLLBACK` в `finally`.

Официальный freeze выполняется с отдельными read-only DB credentials. Любая
write-capable audit connection является configuration error.

### 12.3 Live

Live mode:

- не открывает production DB;
- читает frozen DB/index bundle;
- разрешает сеть только через injected recorder;
- использует explicit HTTPS endpoint allowlist из run manifest;
- пишет только в новый artifact run directory;
- использует artifact-local caches/index states;
- фиксирует каждый would-write intent;
- превращает required targeted-index intent в typed `would_queue`/technical
  stop, если его нельзя завершить локально.

Execution fidelity фиксируется как `analyzer_direct_frozen_db_live_provider`, а
не как production E2E.

### 12.4 Replay

Replay mode:

- не открывает DB;
- блокирует global и injected network access;
- разрешает dependency result только по `provider + operation + canonical args
  hash`;
- не имеет live fallback;
- возвращает `replay_miss` при отсутствующем/mismatched call;
- использует frozen clock/window/config/budgets;
- проверяет raw и semantic output hashes.

Volatile run metadata не входит в semantic output hash и сравнивается отдельно.

### 12.5 Разрешённые production entrypoints

Runner может вызывать через explicit adapters:

- `checkAddress`;
- `runDeepAddressForensicCheck`;
- `runWhereIsMoneyCheck`;
- `buildIncomingDepositReport`;
- текущие unified risk/final disposition functions;
- `TronscanClient` только через injected recording/replay `fetchFn`;
- acquisition/index primitives только с artifact-local repositories.

Runner исполняет только текущую production policy и маркирует её
`current_system`. Он не симулирует ещё не реализованные base/strict/compliance
profiles.

### 12.6 Запрещённые вызовы

Runner не импортирует/не вызывает:

- `src/index.ts`, bot/Admin starters и background schedules;
- `runSingleDeepForensicJobCycle`;
- `runSingleIncomingDepositJobCycle`;
- production address-index worker;
- `create`, `claim`, `queue`, `release`, `update`, `complete` job functions;
- repository `upsert`, `save`, `record`, `rebuild`, `mark`, `fail` functions;
- `recordRiskEvaluation`;
- production `persistProgress`;
- targeted wait/release callbacks;
- Telegram/alert callbacks;
- production metadata/profile/LLM cache writes;
- label/assertion/Wallet Intelligence writes;
- repair/backfill/migration functions.

Forbidden port invocation завершает case как `isolation_violation` и делает run
invalid.

## 13. Артефакты

### 13.1 Staging и run output

```text
artifacts/forensic-audit/<run-id>/
  run.json
  cases/<case-id>.json
  blobs/<sha256>.json
  metrics.json
  checksums.json
```

Artifacts записываются через staging file и atomic rename. Existing immutable
run не перезаписывается.

### 13.2 Curated golden pack

```text
docs/audit/2026-07-system-audit/golden/
  manifest.json
  protocol.json
  cases/<case-id>.json
  evidence/<sha256>.json
  evidence/screenshots/<sha256>.<ext>
```

Final pack self-contained для обязательных evidence. Full diagnostic payload,
не влияющий на adjudication, может оставаться в run archive, но его hash и
retention location фиксируются.

### 13.3 Canonical JSON

`canonical-json-v1` определяет:

- recursive lexicographic key sort;
- UTF-8 и LF;
- сохранение array order, если order семантичен;
- явную сортировку set-like arrays до serialization;
- ISO-8601 UTC для дат;
- decimal string для `BigInt`/raw token amounts;
- запрет `NaN`, `Infinity`, `undefined` и platform-dependent paths;
- SHA-256 после redaction и canonicalization.

Deterministic content и volatile runtime metadata имеют разные hashes.

### 13.4 Redaction

Persisted config строится allowlist-ом. Удаляются:

- DB URL;
- API/bot/LLM tokens и их hashes/prefixes;
- authorization/cookie headers;
- secret query parameters;
- chat/message/requester identifiers;
- Telegram ids/usernames/locales;
- watched-wallet database ids;
- local filesystem paths и machine names;
- raw environment values;
- free-form errors, способные содержать secrets.

Public chain address/transaction/block/amount/time сохраняются как evidence и
маркируются `public_chain_identifier`.

Перед finalization выполняется secret-canary scan по точным загруженным secret
values. Existing probe `redactUrl` не переиспользуется.

## 14. Run manifest и request accounting

Каждый run сохраняет:

- run/case/analyzer ids;
- code commit и clean/dirty status;
- dirty diff hash, если run неофициальный;
- `package-lock.json` hash и runtime versions;
- evidence, analyzer, scoring, classifier, registry и explanation versions;
- sanitized config hash и actual budgets;
- key count и account-group topology без key identity/group names;
- DB/index snapshot identity;
- cache mode;
- scope, tx, amount, window и frozen clock;
- started/completed timestamps и stage timings;
- technical stops;
- raw/semantic output hashes;
- artifact checksums.

Официальный baseline требует clean executable-code tree. Docs-only changes
записываются отдельной version identity.

Request accounting:

- logical request — один dependency/provider intent до cache/retry;
- physical attempt — каждый `fetchFn` invocation;
- retry — physical attempt после первой попытки одного logical request;
- cache hit — logical request без physical attempt;
- отдельно считаются 429, 403, 5xx, timeout, bytes и response hash;
- DB read хранит operation, row count и duration;
- `physical_attempts` обязан равняться числу attempt ledger rows.

Старое неоднозначное поле `requestCount` не используется в baseline metrics.

## 15. Error model

Case terminal statuses:

- `completed`;
- `technical_stop`;
- `failed`;
- `timeout`;
- `would_queue`;
- `replay_miss`;
- `isolation_violation`.

Provider/DB/coverage failure никогда не превращается в пустое clean evidence.
Missing required acquisition создаёт typed no-score/limitation.

Hash, schema, redaction, replay или isolation violation делают run invalid и
возвращают non-zero exit. Ожидаемый analyzer technical stop остаётся валидным
измеренным terminal outcome и не маскируется tool failure.

Partial diagnostic artifact сохраняется до возврата ошибки, если его запись не
нарушает redaction/hash contract.

## 16. Метрики

### 16.1 Evidence

- mandatory fact recall;
- detected fact precision;
- authority-overclaim rate;
- mandatory route recall;
- disjoint amount coverage;
- scope leakage;
- temporal applicability accuracy;
- structured explanation completeness.

### 16.2 Decision

- false `ACCEPTABLE` count/rate/share;
- false `DECLINE` count/rate/share;
- policy disagreement;
- allowed alternative;
- technical no-score.

Decision metrics считаются только по eligible `case × profile`. Disputed policy
case может участвовать в fact/route metrics, но не в unique-decision denominator.

### 16.3 Runtime

- queue wait, processing и E2E для clone runs;
- direct analyzer time для Golden Runner;
- logical requests;
- physical attempts/retries/cache hits;
- provider errors;
- DB reads/rows;
- coverage/stop distribution;
- key count/account-group topology.

Pilot из пяти cases проверяет корректность denominators и instrumentation. Он не
используется для утверждения статистических targets или calibration.

## 17. Verification и acceptance

### 17.1 Tooling checks

- intentional write внутри freeze transaction отклоняется read-only DB;
- live/replay выполняют zero production DB writes;
- replay выполняет zero network calls;
- unknown HTTPS host блокируется;
- replay miss не вызывает live fallback;
- два replay дают одинаковые semantic hashes;
- mock `429 → 200` даёт 1 logical request, 2 attempts и 1 retry;
- secret/PII canary отсутствует в artifacts;
- checksums полностью пересчитываются;
- forbidden port invocation даёт `isolation_violation`;
- missing coverage даёт typed no-score;
- scope identity детерминирована;
- все 73 historical jobs импортированы ровно один раз как runs.

### 17.2 Review checks

- pass 1 и pass 2 получают одинаковый neutral input hash;
- pass 2 bundle не содержит pass 1/current/legacy outcomes;
- оба reviewers создают independent case inventory;
- TronScan service identity опирается на два independent captures с exact label,
  address, observed time и content hash;
- отсутствие TronScan label не преобразуется в `not_a_service`;
- diff покрывает 100% A-only/B-only/shared elements;
- critical reconstruction checklist завершён;
- amount ledger сходится;
- temporal assertions разделяют event/check time;
- unresolved decisive fact блокирует unique outcome;
- AI-reviewed disputed compliance case имеет human confirmation до golden
  release.

### 17.3 Pilot gate

Пилот принят, если:

- 5/5 primary cases имеют validated scope и anchor;
- оба passes locked;
- все review disagreements разрешены либо утверждены как allowed alternatives;
- нет unresolved decisive factual conflicts;
- known TGyt temporal defect обнаружен comparator-ом;
- known TNAra authority promotion обнаружен comparator-ом;
- scope leakage clean-deposit/noisy-wallet обнаруживается;
- service boundary и partial coverage не превращаются автоматически в badness;
- production scoring/analyzer files не изменены.

Если harness показывает полностью зелёный результат для известных TGyt/TNAra
дефектов, пилот считается проваленным.

## 18. Rollout после пилота

1. Заморозить pilot source bundles.
2. Провести два независимых manual web/on-chain исследования.
3. Выполнить adjudication и заморозить manual expectations.
4. Запустить Golden Runner и Comparator.
5. Провести pilot retrospective.
6. Зафиксировать `adjudication-protocol-v1`.
7. При материальном изменении protocol повторить затронутые pilot cases.
8. Нормализовать все 31 legacy rows и 73 runs.
9. Сформировать и дважды проверить все scope-specific cases.
10. Пополнять incremental service registry и добавлять отсутствующие
    observed/synthetic controls.
11. Запустить полный current-system quality baseline.
12. Составить quality report и пересмотреть target product/architecture options.
13. На disposable DB clone измерить lifecycle и 4/10/exact `K>10` arms, когда
    доступны необходимые keys.

Только после quality baseline снова рассматриваются target evidence/scoring
model, product modes и architecture A/B/C. Phased implementation plan production
системы начинается только после отдельного approval итоговой product/technical
spec.

## 19. Approval boundaries

Утверждение этого документа разрешает только последующее проектирование и
реализацию изолированного audit tooling отдельным решением. Оно не разрешает
менять production scoring, analyzers, lifecycle, index, labels, UI или policy.

Следующий обязательный gate — review этого записанного design document. После
его подтверждения может быть подготовлен отдельный implementation plan только
для audit tooling. Production implementation plan остаётся заблокированным до
полного baseline и утверждения итоговой продуктово-технической спецификации.
