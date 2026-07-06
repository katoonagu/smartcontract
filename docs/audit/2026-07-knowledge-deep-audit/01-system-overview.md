---
status: draft
audit_type: knowledge_deep_audit
scope: system overview
created: 2026-07-04
---

# System Overview

## Что За Продукт

Проект - это TRON USDT monitoring and forensic bot.

Он делает две большие работы.

Первая работа - мониторинг кошельков и входящих событий. Пользователь добавляет
адреса, система наблюдает за активностью и может отправлять Telegram alerts.

Вторая работа - forensic checks. Система проверяет кошельки и конкретные
депозиты, собирает evidence, объясняет происхождение средств, строит risk
interpretation и показывает результат в Telegram и Admin forensic console.

Ключевая особенность продукта: он не должен просто сказать "риск высокий" или
"риск низкий". Он должен объяснить, на каких фактах это основано, где данные
полные, где неполные, где путь честно уперся в service boundary, а где система
сама не докачала историю.

## Главный Product Contract

В `docs/knowledge` повторяются несколько правил, которые задают контракт всей
системы.

Facts и interpretation разделяются. Транзакции, адреса, суммы, timestamps,
contract data и labels - это фактическая или supporting часть. Risk score,
decision, source-of-funds conclusion и policy verdict - это интерпретация.

Missing data is not clean. Если система не получила нужную историю, она не
имеет права считать путь безопасным только потому, что плохого не нашла.

Technical stop is not a risk verdict. Если score заблокирован из-за
`provider_cap_unresolved`, `partial_budget_exhausted`, `provider_error` или
похожего технического статуса, это не должно выглядеть как финальный `DECLINE`.

Check modes stay separate. Fast check, DeepCheck, Where is money, Incoming
deposit и unified `/check` могут использовать общие DB, TronScan, индекс и
workers, но отвечают на разные вопросы.

## Основные Режимы

Система не имеет одного универсального "full check". Есть несколько режимов.

Fast check отвечает на вопрос: есть ли прямо сейчас очевидные risk signals по
кошельку. Это быстрый первый слой. Он не доказывает полный source of funds.

DeepCheck отвечает на вопрос: как выглядит более широкий forensic profile
кошелька. Он смотрит на subject wallet, direct counterparties, selected
second-layer relationships, services, contracts, hard evidence и operational
signals. Он строит профиль, но не заменяет Where is money.

Where is money отвечает на вопрос: откуда пришли релевантные средства на
кошелек. Это режим source-of-funds. Он идет назад по money paths и должен
различать доказанный источник, вероятный источник, unresolved source,
pre-existing balance и service boundary.

Incoming deposit отвечает на вопрос: можно ли доверять конкретному входящему
депозиту. Он стартует не с биографии receiver wallet, а с одной incoming
transaction: кто отправил депозит и откуда sender получил деньги перед ним.

Unified `/check` - это композиция address-level результата. По текущему
product contract он не должен стирать границы режимов. Он собирает fast, deep
и Where signals в итоговый user-facing address risk, но не становится новым
отдельным queueable режимом.

## Основные Поверхности

У системы есть две основные пользовательские поверхности.

Telegram - user-facing interface. Здесь пользователь запускает проверки,
видит summary, alerts и финальные сообщения. Telegram должен говорить
понятным языком и не перегружать пользователя raw technical codes, если это
можно объяснить нормальной фразой.

Admin forensic console - analyst workbench. Здесь можно видеть jobs, graph
projections, selected flows, progress, technical coverage details, raw evidence
summary, strict benchmark details and graph modes. Admin может показывать
больше диагностических деталей, чем Telegram.

Эти поверхности не равны. Admin может показывать `History not fully fetched`
или `provider_cap_unresolved` как debugging signal. Telegram должен объяснять,
что score заблокирован технически или что система продолжает indexing, а не
выглядеть как финальный риск-вердикт.

## Главные Системные Части

На верхнем уровне система собирается в `src/index.ts`.

Этот entry point:

- читает configuration через `loadConfig`;
- создает PostgreSQL connection pool через `createDb`;
- создает `TronscanScheduler`;
- создает `TronscanClient`;
- поднимает Admin dashboard, если он включен;
- создает Telegram bot через `createBot`;
- собирает runtime dependencies для forensic jobs;
- запускает background work schedule;
- корректно останавливает bot, Admin и DB на shutdown.

Это делает `src/index.ts` сборочным узлом. Он не является единственным местом
бизнес-логики, но показывает, как основные части соединены.

## Data Sources

Основной источник TRON USDT transfer history сейчас - TronScan.

В системе есть `TronscanClient`, который ходит во внешний provider, и
`TronscanScheduler`, который регулирует запросы: key pool, account groups,
endpoint pacing, global pacing, cooldown после 429 и diagnostics.

Важно: key pool не является решением полноты данных. Больше ключей может
увеличить throughput. Но если система остановилась из-за local page budget,
provider cap, stale partial state или отсутствия resumable flow, сами ключи не
доказывают полноту истории.

Локально данные сохраняются в PostgreSQL. Для forensic части важны не только
raw jobs, но и local index:

- indexed TRON USDT transfers;
- index states;
- page audits;
- coverage intervals;
- forensic jobs;
- forensic job waits;
- saved risk/evidence/results.

## Local Index And Coverage

Для source-of-funds задач системе нужна не просто последняя страница
транзакций. Ей нужно понимать, покрыта ли история до нужного момента.

В knowledge docs описаны два coverage mode:

`all_time` - попытка покрыть всю историю адреса.

`targeted` - попытка покрыть историю адреса до конкретного `targetTimestamp`,
который нужен для money path.

Targeted coverage особенно важен для Where is money и Incoming deposit. Если
hop address отправил средства дальше, системе нужно понять, откуда у этого hop
были деньги до outgoing transfer. Если история не доходит до нужного timestamp,
вывод не должен выглядеть полным.

После обновления ветки `codex/where-candidate-window-first-indexing` внутри
`targeted` coverage есть важное разделение по `request_kind`.
`broad_targeted` по-прежнему означает широкий запрос `genesis ->
targetTimestamp`. Новый `candidate_window` означает узкое окно от funding
candidate timestamp до hop timestamp. Это narrow proof material для
funding-first provenance, а не broad address history coverage.

Индексатор может закончить разными состояниями: `complete_provider_windowed`,
`partial_provider_cap`, `partial_budget_exhausted`, `partial_rate_limited`,
`partial_provider_inconsistent`, `failed_retryable`, `failed_terminal`.

Смысл этих состояний продуктово важен. `partial_budget_exhausted` означает, что
закончился наш локальный budget. Это не доказательство, что TronScan не может
дать данные. `partial_provider_cap` означает, что provider range/window
остался capped. Это тоже не риск-вердикт, а сигнал про coverage.

## Jobs And Workers

Forensic jobs хранятся в DB. Knowledge docs описывают repository statuses:

```text
queued -> running -> partial -> completed -> failed -> cancelled
```

Из кода видно, что `address_fast_check` не является queueable worker job. Fast
check сохраняется отдельно как terminal job.

Queueable forensic jobs включают:

- `address_deep_check`;
- `where_is_money_check`;
- `incoming_deposit_check`.

Отдельно есть background address index task. Это не пользовательский режим, а
техническая работа: докачать историю адреса в local index.

Background schedule запускает несколько циклов:

- обычный monitoring poll;
- Where forensic worker;
- Incoming deposit worker;
- Deep forensic worker;
- address index worker.

Это важно для понимания длинных проверок. Пользователь может видеть один
forensic check, но внутри parent job может отпустить worker, дождаться
background index task, затем продолжить анализ. Для ordinary Where это уже
часть текущего behavior. Для Incoming deposit такой shared resumable
wait/resume flow остается known gap.

## Wait And Resume

Один из ключевых механизмов - `waiting_for_targeted_index`.

Если ordinary Where во время trace понимает, что для hop address не хватает
targeted history, parent job может:

1. queue targeted address index task;
2. записать wait в `forensic_job_waits`;
3. перейти в `queued` с `jobPhase=waiting_for_targeted_index`;
4. дать address index worker докачать историю;
5. проснуться, когда targeted index state станет complete или terminal.

Такой flow нужен, чтобы длинная проверка не блокировала worker одним большим
await и чтобы система могла показывать progress. Product truth говорит, что
long checks are allowed, если они делают полезную работу и показывают прогресс.

Для ordinary Where теперь есть дополнительная стадия перед broad targeted
fallback. Если funding-first provenance нашел `probable` candidate, Where
сначала ставит durable `candidate_window` targeted states и ждет их. Только
после того, как эти узкие окна complete или terminal, система решает, нужен ли
старый broad fallback. Это сохраняет главный product contract: probable
candidate не становится proof сам по себе, но система получает более дешевый и
точный способ проверить candidate-to-hop window.

## Forensic Logic

Forensic logic отвечает за объяснение происхождения денег и risk evidence.

На уровне system overview важно различать три слоя.

Первый слой - route or path. Это цепочка transfers, через которую деньги идут
от источника через hops к subject wallet или deposit sender.

Второй слой - provenance proof. Для Where сейчас важны proof classes:
`exact`, `probable`, `pre_existing_balance_possible`, `unresolved`,
`service_boundary`.

Третий слой - risk interpretation. На основе provenance, hard evidence,
service context, coverage и policy rules система решает, можно ли публиковать
score, какой decision показывать и какие caveats оставить видимыми.

Service boundary является честной остановкой. Например, CEX, DEX, bridge,
router или known service wallet могут быть местом, где public-chain path
логически заканчивается. Это не то же самое, что "мы не докачали страницы".

## Scoring

Scoring не должен быть простой суммой подозрений.

Knowledge docs задают несколько правил.

Hard evidence может давать сильный score через floors. Weak context должен
оставаться bounded и не превращаться в критический verdict просто накоплением.

`score_valid` показывает, можно ли использовать score как forensic result. Если
`score_valid=false`, результат должен объяснять `score_blocked_reason` и
`technical_status`.

`REVIEW` не должен случайно стать финальным `DECLINE`, если нет hard evidence и
coverage incomplete.

Для ordinary Where есть важное исключение: residual unresolved source
provenance below materiality может остаться caveat, а не блокировать весь
score. Но это не делает unresolved branch чистой или exact. Это только значит,
что небольшой residual gap без hard evidence не должен ломать весь report.

## Как Данные Проходят Через Систему

Упрощенный flow выглядит так.

Пользователь или Admin запускает проверку.

Telegram bot или Admin создает job в DB, либо fast check сохраняется сразу как
terminal job.

Background worker забирает queued job.

Worker использует TronScan, local DB, metadata, labels, service classifier,
index state и forensic logic.

Если данных не хватает, Where может поставить parent job в
`waiting_for_targeted_index` и queue targeted index work.

Address index worker докачивает историю, пишет page audits, coverage intervals
и index state.

Parent job просыпается, продолжает trace, строит report и scoring summary.

Результат сохраняется в DB.

Admin строит graph/read model по saved result and evidence. Telegram получает
user-facing summary or final report.

## Что Хорошо Видно Уже На Уровне Overview

Архитектура не пытается делать все одной функцией. Есть явные границы:

- Telegram bot как user-facing command/surface layer;
- Admin как analyst workbench;
- DB repositories как persistence boundary;
- TronScan client/scheduler как provider boundary;
- address index worker как data coverage layer;
- forensic workers как job execution layer;
- scoring как interpretation layer.

Отдельно хорошо, что project knowledge явно защищает несколько продуктовых
инвариантов: не смешивать modes, не считать missing data clean, не превращать
technical stop в risk verdict, не путать service boundary с coverage failure.

## Что Уже Видно Как Known Gaps

Incoming deposit еще не имеет общего continue-indexing-then-resume flow, который
есть у ordinary Where.

Targeted background budgets пока являются code constants, а не полноценной
runtime/product configuration.

DeepCheck second-layer work частично реализован, но в docs все еще отмечен как
partial/planned в важных аспектах.

Telegram progress для длинных Where/Incoming проверок слабее Admin progress.

Admin должен лучше различать old cached job и fresh live run.

Некоторые raw technical phrases все еще допустимы в Admin, но для Telegram им
нужна human wording.

## Confirmed Vs Not Confirmed In This Checkpoint

Confirmed as `docs-only`:

- product principles from `docs/knowledge`;
- current decisions and known gaps;
- intended separation of check modes;
- intended difference between technical stops and risk verdicts.

Confirmed as `code-inspected`:

- `src/index.ts` is the main composition point for config, DB, TronScan,
  Admin, bot and background schedule;
- `createBot` queues Where and Deep jobs and saves fast check separately;
- repository code keeps `address_fast_check` out of the queueable forensic job
  path;
- background schedule has separate cycles for polling, Where, Deep, Incoming
  and address indexing;
- targeted index states and forensic job waits are represented in repository
  code;
- feature branch `codex/where-candidate-window-first-indexing` adds
  `request_kind`, `window_start_timestamp_ms` and `candidate_tx_hash` identity
  for targeted index states and forensic waits.

Not confirmed in this checkpoint:

- live Admin behavior;
- live Telegram wording;
- fresh DB job behavior;
- live TronScan provider behavior;
- end-to-end runtime behavior for a new user check.

Those need later walkthrough sections and, where useful, runtime observation.

## How To Use This Overview

Use this file as the map, not as the final proof.

If you want to understand "which mode answers which question", read
`02-check-modes-walkthrough.md` next.

If you want to understand "what does covered history mean", read
`03-data-indexing-walkthrough.md`.

If you want to understand "why a job is queued but waiting", read
`04-job-lifecycle-walkthrough.md`.

If you want to understand "how money paths and provenance are built", read
`05-forensic-logic-walkthrough.md`.

If you want to understand "why the score is valid or blocked", read
`06-scoring-walkthrough.md`.

If you want to understand "what analysts and users see", read
`07-admin-bot-ux-walkthrough.md`.

If you want the resulting questions and possible next plans, read
`08-open-questions-and-improvement-ideas.md`.

## Evidence Appendix

Knowledge files read:

- `docs/knowledge/AGENT_BRIEF.md`
- `docs/knowledge/00-index.md`
- `docs/knowledge/01-product-principles.md`
- `docs/knowledge/02-check-modes.md`
- `docs/knowledge/03-job-lifecycle.md`
- `docs/knowledge/04-data-sources-tronscan-indexing.md`
- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/06-deepcheck.md`
- `docs/knowledge/07-risk-scoring-matrix.md`
- `docs/knowledge/08-admin-and-bot-ux.md`
- `docs/knowledge/09-current-decisions.md`
- `docs/knowledge/10-open-problems.md`
- `docs/knowledge/11-glossary.md`
- `docs/knowledge/12-runbooks.md`
- `docs/knowledge/13-agent-observations.md`

Code entry points inspected:

- `src/index.ts`
- `src/bot/createBot.ts`
- `src/storage/repositories.ts`
- `src/tron/tronClient.ts`
- `src/tron/tronscanScheduler.ts`
- `src/forensics/addressIndexWorker.ts`
- `src/forensics/candidateWindowTargeting.ts`
- `src/forensics/targetedHistoryCoordinator.ts`
- `src/forensics/tronAddressAllTimeIndex.ts`
- `src/forensics/deepForensicJob.ts`
- `src/forensics/incomingDepositJob.ts`
- `src/risk/unifiedWalletRisk.ts`

Checks run for this checkpoint:

- no focused test suite was run for these two introductory documents;
- this checkpoint is `docs-only` plus `code-inspected`, not `test-backed` or
  `runtime-observed`.

Delta verification for `codex/where-candidate-window-first-indexing`:

```text
npm test -- tests/forensics/candidateWindowTargeting.test.ts tests/forensics/targetedHistoryCoordinator.test.ts tests/forensics/moneyOriginTrace.test.ts tests/forensics/tronAddressAllTimeIndex.test.ts tests/storage/repositories.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
```

Result:

```text
Test Files  8 passed (8)
Tests       452 passed (452)
```

Runtime observation for this delta:

```text
Admin /admin/forensics on local live process returned HTTP 200.
Process pid 27072 was a live node process.
```
