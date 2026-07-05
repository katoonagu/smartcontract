---
status: draft
audit_type: knowledge_deep_audit
scope: check modes walkthrough
created: 2026-07-04
---

# Check Modes Walkthrough

## What This Area Does

Этот раздел объясняет, как в системе устроены check modes: `Fast check`,
`DeepCheck`, `Where is money`, `Incoming deposit` и unified `/check`.

Главная мысль: это не пять названий одного и того же процесса. Это разные
продуктовые вопросы, разные входы, разные ожидания к данным и разные способы
выдавать результат.

Режимы могут делить инфраструктуру: Telegram bot, Admin, DB table
`forensic_check_jobs`, TronScan client, local USDT index, forensic workers,
risk scoring helpers. Но пользовательский смысл у них разный.

Если эти режимы смешать, система начинает давать опасно уверенные ответы.
Например, быстрый label-based check можно ошибочно прочитать как полный
source-of-funds verdict, а техническую остановку `Where is money` можно
ошибочно показать как финальное risk decision.

## Why It Exists

Разделение режимов существует потому, что blockchain forensic product отвечает
не на один общий вопрос "кошелек плохой или хороший".

Пользователь может спрашивать разные вещи:

- "Есть ли у этого адреса очевидные risk signals прямо сейчас?"
- "Какой общий forensic profile у кошелька?"
- "Откуда пришли релевантные деньги на этот кошелек?"
- "Можно ли принимать вот этот конкретный депозит?"
- "Какой итоговый address-level риск, если собрать fast, deep и Where?"

Для каждого вопроса нужна разная честность.

`Fast check` может быть быстрым и неполным. Это нормально, если он не
притворяется полной проверкой происхождения средств.

`DeepCheck` может строить широкий профиль и находить сильный контекст, но он не
обязан доказывать источник конкретных funds так, как это делает `Where is
money`.

`Where is money` должен быть строже к coverage. Если нужная история не покрыта,
это не "чисто", а missing data.

`Incoming deposit` должен смотреть на один конкретный перевод. Он не должен
подменяться общей биографией receiver wallet.

Unified `/check` нужен как user-facing composition layer. Он полезен только
пока не стирает границы исходных режимов.

## Main User/Product Question

### Fast Check

Вопрос пользователя: "Есть ли быстрый сигнал риска по адресу или tx?"

Продуктовый ответ: быстрый risk snapshot на основе labels, graph signals,
behavior signals и AML/context signals, если они доступны. Это первый слой,
не полный forensic trace.

### DeepCheck

Вопрос пользователя: "Что известно о кошельке шире, чем один быстрый label?"

Продуктовый ответ: forensic profile кошелька: direct counterparties, selected
second-layer relationships, hard evidence, service exposure, contracts,
approval/drain patterns, missing checks и coverage.

### Where Is Money

Вопрос пользователя: "Откуда пришли релевантные funds?"

Продуктовый ответ: source-of-funds explanation. Система выбирает
balance-forming или transaction-seeded funds, идет назад по money paths и
разделяет `exact`, `probable`, `unresolved`, `pre_existing_balance_possible` и
`service_boundary`.

### Incoming Deposit

Вопрос пользователя: "Можно ли доверять конкретному входящему депозиту?"

Продуктовый ответ: risk report по одному deposit transaction. Проверяется
sender, sender source path и связь этого path с конкретным депозитом.

### Unified `/check`

Вопрос пользователя: "Какой итоговый address-level риск, если собрать все
доступные слои?"

Продуктовый ответ: композиция fast, deep и Where. Это не отдельный новый
forensic mode и не замена существующих режимов.

## End-To-End Flow

### Address `/check`

Когда пользователь отправляет адрес в Telegram `/check`, бот сначала
классифицирует input как TRON address.

Если включена smart-contract ветка и адрес оказывается contract case, бот может
вернуть smart-contract report отдельно. В обычном wallet path дальше идет fast
address check.

Fast check выполняется сразу в request path. Он читает labels/signals,
вызывает risk evaluation и получает `fastRiskSnapshot`: score, level и reasons.
Затем этот snapshot используется как быстрый контекст для последующих jobs.

После fast check бот создает два queued follow-up job:

- `where_is_money_check`;
- `address_deep_check`.

Они создаются отдельно, с разными priorities и с разным смыслом. Where получает
mode вроде `wallet_profile` и должен объяснить relevant funds. Deep получает
настройки вроде `allTimeDeepCheckMode: "strict"` и second-layer budget, если он
разрешен конфигом.

Fast result сохраняется в `forensic_check_jobs` как `address_fast_check`, но
это terminal record, а не queueable worker job. У него статус `completed` или
`partial`, result JSON и ссылки на evidence/observations.

Пользователь в Telegram получает сообщение, что проверка стартовала, и ссылки
на follow-up jobs, если они созданы. Дальше worker loops обрабатывают Where и
Deep независимо.

Когда Where и Deep завершаются, user-facing форматтер может собрать unified
final report. Важная защита: если Where говорит, что score invalid, финальный
address report не должен притворяться валидным score. Тогда возвращается
invalid/no-final-score message.

### Transaction `/check`

Если input классифицирован как TRON transaction hash, бот пытается извлечь
официальный TRC20 USDT transfer seed.

Дальше есть две параллельные идеи:

- fast transaction check фактически оценивает sender как адресный fast check с
  контекстом observed transaction;
- Where origin job стартует от transaction seed, то есть проверяемая
  transaction становится provenance seed.

Это отличается от address `/check`: пользователь спрашивает не "что за
кошелек", а "что за перевод". Поэтому seed и window берутся от самой
transaction.

### Where Worker

`where_is_money_check` забирается из очереди отдельным poller path. Реальная
runner-функция живет в shared worker module вместе с Deep, но внутри first-class
branch по `job.kind === "where_is_money_check"`.

Where строит money-origin trace. Он читает history coverage, local index,
TronScan edges, service classifications, current USDT balance и fast wallet
risk. Если нужная targeted history еще не покрыта, обычный Where может
перевести parent job в `waiting_for_targeted_index`, поставить background
targeted indexing и потом resume после index worker.

После обновления `codex/where-candidate-window-first-indexing` Where делает
это в два шага для `probable` funding-first source provenance. Сначала он
выбирает narrow candidate-to-hop windows и ставит `candidate_window` targeted
states. Если эти окна не дают `exact` proof по существующим funding-first
rules, Where может перейти к broad `where_is_money_hop` fallback. То есть
candidate-window stage меняет порядок проверки coverage, но не создает новый
product mode.

Если targeted coverage заканчивается настоящим provider/safety terminal state,
Where должен завершиться техническим no-score результатом:
`score_valid=false`, `score_blocked_reason` и `technical_status`.

### Deep Worker

`address_deep_check` забирается отдельным poller path. Worker переводит job в
phase `address_deep_trace`, при необходимости запускает или проверяет all-time
subject index и вызывает `runDeepAddressForensicCheck`.

Deep собирает широкий forensic profile. Он может использовать all-time index,
direct hard evidence, selected second-layer relationship expansion, contract
signals и service exposure. По текущим docs второй слой есть, но остается
частичным/planned в audited path.

### Incoming Deposit Worker

`incoming_deposit_check` - отдельный job kind и отдельный worker cycle.

Он стартует не из ручного `/check`, а из monitored incoming deposit flow. В job
progress должны быть конкретные поля депозита: `depositTxHash`, `watchedWallet`,
`watchedWalletId`, `sender`, `amountRaw`, `timestamp`,
`telegramUserId`.

Worker строит report по конкретному депозиту: оценивает sender, выбирает
deposit seed/funding candidates, вызывает shared Where logic для sender path и
затем считает incoming-specific unified risk.

Если coverage для main path неполный, Incoming может вернуть
`NO_FINAL_DECISION`. Но важный текущий gap: Incoming еще не подключен к такому
же общему resumable targeted indexing flow, который есть у ordinary Where.

### Unified Report

Unified layer собирает fast, deep и Where reports в итоговый address-level
result.

Он не создает отдельный job kind. Он использует уже полученные результаты и
применяет scoring matrix, floors, dampeners, coverage handling и decision
rules.

Главное ограничение: unified layer не должен лечить invalid Where coverage
тем, что просто посчитает score по fast/deep context. Если Where score invalid,
финальный user-facing ответ должен честно сказать, что финальный score
заблокирован.

## Important Data Structures / States

### Job Kinds

`address_fast_check` - terminal record для fast result. Его нельзя claim как
queue job.

`where_is_money_check` - queued forensic job для source-of-funds explanation.

`address_deep_check` - queued forensic job для широкого wallet forensic
profile.

`incoming_deposit_check` - queued forensic job для конкретного watched incoming
deposit.

### Job Statuses

Основные states, которые важны для чтения режимов:

- `queued` - job ожидает worker;
- `running` - worker забрал job;
- `completed` - job завершился с usable result;
- `partial` - fast/manual результат сохранен с missing checks;
- `failed` - job завершился технически или ошибкой;
- `waiting_for_targeted_index` в `progressJson.jobPhase` - Where ждет
  background targeted indexing и не должен claim-иться обычным worker до
  готовности.
- `checking_candidate_windows` в `targetedIndex.phase` - Where ждет узкие
  candidate-window targeted states перед broad fallback.

### Progress And Result JSON

`progressJson` хранит mode-specific runtime state: locale, mode, seed
transfers, fast snapshot, targeted index progress, job phase, selected runtime
options и timing.

`resultJson` хранит итоговый report. Его нельзя читать одинаково для всех
режимов: fast result, Where report, Deep report и Incoming report имеют разный
product meaning.

### Score Validity

`scoreValid` или serialized `score_valid=false` означает, что score нельзя
использовать как финальный forensic result.

Это не значит "низкий риск". Это значит "нет честного final score из-за
coverage/technical blocker".

Для user-facing UX это критично: raw technical status допустим в Admin, но для
Telegram его нужно объяснять человеческим языком.

## What The Knowledge Docs Claim

`docs/knowledge/02-check-modes.md` задает главное правило: checks нельзя
collapse в один mode. Fast, Deep, Where, Incoming и Unified отвечают на разные
вопросы.

`docs/knowledge/05-where-is-money-and-incoming.md` уточняет границу Where и
Incoming. Они используют похожую provenance logic, но Where объясняет funds на
wallet, а Incoming объясняет конкретный deposit.

Эта же knowledge page говорит, что ordinary Where уже имеет Stage 1
waiting/resume для targeted history. Если required hop не покрыт, job может
ждать targeted index и возобновиться позже.

Для Incoming docs фиксируют ограничение: режим еще не имеет общего
continue-indexing-then-resume loop. Он может блокировать score, но не wired к
той же resumable lifecycle как ordinary Where.

`docs/knowledge/06-deepcheck.md` утверждает, что DeepCheck строит forensic
profile кошелька и не заменяет Where. Он может давать hard evidence и context в
unified score, но не обязан доказывать exact source of funds.

`docs/knowledge/07-risk-scoring-matrix.md` фиксирует scoring contract:
incomplete coverage is not clean, `score_valid=false` должен блокировать
финальный forensic score, а `REVIEW` не должен случайно превращаться в false
`DECLINE` или false `ACCEPTABLE`.

`docs/knowledge/09-current-decisions.md` подтверждает текущие решения:
режимы остаются separate, unified `/check` only composes signals, а old cached
jobs или stale DB evidence нельзя считать fresh proof.

`docs/knowledge/13-agent-observations.md` отдельно предупреждает о повторной
ошибке агентов: не описывать систему как single full provenance mode, который
заменяет существующие режимы.

## What The Code Appears To Implement

Код в целом подтверждает текущий product contract.

Для address `/check` Telegram bot сначала делает fast `checkAddress`, затем
создает два follow-up job: Where и Deep. Fast result сохраняется отдельно через
специальный save path.

Repository layer явно запрещает создавать или claim-ить `address_fast_check`
как queueable job. Это хорошая архитектурная защита: fast record остается
terminal evidence of quick check, а не смешивается с long-running workers.

Where и Deep используют shared runner module, но branch по `job.kind`
сохраняет разные semantics. Where branch вызывает `runWhereIsMoneyCheck` и
имеет targeted wait/resume behavior. Deep branch ставит `address_deep_trace`,
работает с all-time subject index и вызывает `runDeepAddressForensicCheck`.

В актуальной ветке Where branch также прокидывает `requestCandidateWindows` в
trace. Trace вызывает `selectCandidateWindowsForSourceProvenance` только для
`probable` funding-first provenance, а coordinator ставит
`request_kind=candidate_window` waits. Это остается частью Where mode, не
отдельной проверкой для пользователя.

Incoming deposit реализован отдельным worker cycle. Он требует deposit-specific
fields в `progressJson`, строит incoming report и вызывает shared Where logic
для provenance части, но scoring и decision остаются incoming-specific.

Unified wallet risk считается отдельной функцией composition/scoring. Telegram
formatter сначала проверяет Where score validity и только потом считает
unified score. Это соответствует product rule: invalid Where coverage не
должен превращаться в красивый final score.

## Confirmed Vs Not Confirmed

`docs-only`:

- product naming и intended semantics режимов взяты из `docs/knowledge`;
- текущие product decisions по "не смешивать режимы" и Incoming gap взяты из
  knowledge docs;
- утверждение о том, каким должен быть user-facing language в Telegram, в этом
  разделе проверено только как product rule, не как live UX.

`code-inspected`:

- address `/check` path: fast check выполняется до queueing Where/Deep;
- `address_fast_check` сохраняется отдельно и не является queueable job;
- Where и Deep claim-ятся разными scheduler paths;
- Incoming имеет отдельный job cycle и deposit-specific input fields;
- unified report checks Where score validity before final scoring;
- candidate-window-first Where path is wired as an internal Where
  wait/resume step, not as a new check mode.

`test-backed`:

- focused test run прошел: 7 files, 405 tests;
- покрыты manual/fast checks, forensic job queue semantics, bot orchestration,
  Where, Deep, Incoming и unified wallet risk.

`runtime-observed`:

- в этом разделе не проводилось live-наблюдение Telegram, Admin, real DB state
  или real TronScan provider behavior;
- поэтому UX формулировки, фактические live progress screens и поведение
  конкретных свежих jobs остаются не runtime-confirmed в рамках этого файла.

## Known Gaps

Incoming deposit еще не подключен к общему resumable targeted indexing flow,
который появился у ordinary Where. Это главный functional gap именно по
разделу check modes.

DeepCheck second-layer behavior есть в docs/code/tests, но knowledge docs
прямо говорят, что audited path остается частичным/planned. Это не выглядит
как blocker для режима, но важно не продавать Deep как уже полностью
исчерпывающий граф отношений.

Shared worker file naming может путать читателя. `deepForensicJob.ts`
обслуживает не только Deep, но и Where branch. Поведение технически нормальное,
но название файла делает архитектуру менее очевидной.

Unified `/check` в UX легко понять неправильно как "главный полный режим".
Product docs говорят обратное: unified только composes signals.

Live behavior не проверялось. У нас есть docs, code inspection и focused tests,
но нет runtime-observed fresh Telegram/Admin run для этого раздела.

## Risks / Failure Modes

Fast result могут ошибочно читать как full provenance check. Это риск для
аналитика и пользователя: быстрый snapshot полезен, но не доказывает источник
денег.

DeepCheck могут ошибочно читать как exact source-of-funds answer. Deep дает
широкий профиль и hard/context evidence, но Where отвечает за релевантные
funding paths.

Where technical blocker могут ошибочно показать как risk verdict. Например,
`provider_cap_unresolved` должен быть no-final-score state, а не `DECLINE` и не
`ACCEPTABLE`.

Incoming deposit могут ошибочно читать как wallet biography. Этот режим
про конкретный deposit, sender и sender path, а не про весь receiver wallet.

Unified `/check` может стать semantic trap: если UI или docs назовут его
"полной проверкой", команда снова начнет смешивать режимы.

Old cached/stale jobs могут создать ложное впечатление, что fresh behavior
проверен. Для аудита это важно: старый completed result не равен live proof
актуального path.

## What To Keep As-Is

Разделение job kinds стоит оставить. Оно хорошо отражает продуктовые границы.

`address_fast_check` как terminal record, а не queueable job, стоит оставить.
Это простая и сильная защита от смешивания fast и long-running forensic jobs.

Unified `/check` как composition layer стоит оставить. Проблема не в unified
идеe, а в том, чтобы не превращать ее в replacement for modes.

Shared infrastructure между Where, Deep и Incoming стоит оставить. Повторное
использование TronScan/indexing/forensic primitives разумно, пока product
question остается явным.

No-final-score behavior при invalid Where coverage стоит оставить. Это
центральная защита качества forensic answer.

## Improvement Ideas

Добавить короткую mode matrix в audit или будущую product docs:

| Mode | User question | Trigger | Job kind | Output | Main risk |
| --- | --- | --- | --- | --- | --- |
| Fast | obvious risk now? | `/check address` or tx sender | `address_fast_check` record | quick snapshot | mistaken for provenance |
| Deep | wallet profile? | follow-up job | `address_deep_check` | forensic profile | mistaken for source-of-funds |
| Where | where did funds come from? | follow-up job or tx seed | `where_is_money_check` | source-of-funds report | technical stop shown as verdict |
| Incoming | can we trust this deposit? | monitored deposit | `incoming_deposit_check` | deposit risk report | no shared resume yet |
| Unified | address-level final? | formatter/composition | no separate job kind | composed score/decision | modes get collapsed |

Документировать shared worker naming. Можно не переименовывать файл сразу, но в
architecture docs стоит явно сказать: `deepForensicJob.ts` is a shared
forensic job runner for Where and Deep.

Для Incoming позже нужен отдельный implementation plan по shared
wait/resume targeted indexing. Это уже зафиксировано в knowledge docs как gap,
но в режиме аудита его стоит держать как high-value follow-up.

В Admin и Telegram можно позже проверить wording: где пользователь видит
"final score", где "technical no-score", где "in progress", где raw code
допустим только для аналитика.

Добавить small regression scenario list для modes: fresh address `/check`,
tx-seeded Where, Where waiting/resume, terminal provider cap no-score,
Incoming incomplete coverage, Deep direct hard evidence, unified invalid Where
guard.

## Questions For You

1. Подтверждаешь ли, что разделение режимов считаем `keep as-is` как
   архитектурное решение, а не как временный компромисс?

2. Называем ли confusion вокруг `deepForensicJob.ts` просто documentation gap,
   или позже стоит рассмотреть rename/refactor?

3. Incoming resumable targeted indexing фиксируем как главный check-mode gap в
   этом разделе, или переносим основную тяжесть обсуждения в будущий
   `03-data-indexing-walkthrough.md` и `04-job-lifecycle-walkthrough.md`?

4. Нужно ли в следующем проходе вручную открыть Admin/Telegram и сделать
   runtime-observed сценарии по режимам, или пока продолжаем docs/code/tests
   walkthrough?

## Evidence Appendix

Knowledge docs used:

- `docs/knowledge/AGENT_BRIEF.md`
- `docs/knowledge/02-check-modes.md`
- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/06-deepcheck.md`
- `docs/knowledge/07-risk-scoring-matrix.md`
- `docs/knowledge/09-current-decisions.md`
- `docs/knowledge/10-open-problems.md`
- `docs/knowledge/13-agent-observations.md`

Code entry points inspected:

- `src/bot/createBot.ts`
  - `replyWithCheck`
  - `createQueuedAddressJob`
  - `formatUnifiedAddressFinalReport`
- `src/check/manualCheck.ts`
  - `checkAddress`
  - `checkTransactionHash`
- `src/check/whereIsMoneyCheck.ts`
  - `runWhereIsMoneyCheck`
- `src/forensics/candidateWindowTargeting.ts`
  - `selectCandidateWindowsForSourceProvenance`
- `src/forensics/deepForensicJob.ts`
  - `runSingleDeepForensicJobCycle`
  - `runWhereIsMoneyJob`
- `src/forensics/targetedHistoryCoordinator.ts`
  - `ensureCandidateWindowsOrWait`
- `src/forensics/incomingDepositJob.ts`
  - `buildIncomingDepositReport`
  - `runSingleIncomingDepositJobCycle`
  - `INCOMING_DEPOSIT_JOB_KIND`
- `src/risk/unifiedWalletRisk.ts`
  - `calculateUnifiedWalletRisk`
- `src/storage/repositories.ts`
  - `createOrReuseForensicCheckJob`
  - `saveAddressFastCheckJob`
  - `claimNextForensicCheckJob`
- `src/index.ts`
  - `whereForensicOnce`
  - `deepForensicOnce`
  - `incomingDepositOnce`

Focused verification:

```text
npm test -- tests/check/manualCheck.test.ts tests/storage/forensicCheckJobs.test.ts tests/bot/createBot.test.ts tests/check/whereIsMoneyCheck.test.ts tests/check/deepForensicCheck.test.ts tests/forensics/incomingDepositJob.test.ts tests/risk/unifiedWalletRisk.test.ts
```

Result:

```text
Test Files  7 passed (7)
Tests       405 passed (405)
```

Delta verification for `codex/where-candidate-window-first-indexing`:

```text
npm test -- tests/forensics/candidateWindowTargeting.test.ts tests/forensics/targetedHistoryCoordinator.test.ts tests/forensics/moneyOriginTrace.test.ts tests/forensics/tronAddressAllTimeIndex.test.ts tests/storage/repositories.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
```

Result:

```text
Test Files  8 passed (8)
Tests       452 passed (452)
```
