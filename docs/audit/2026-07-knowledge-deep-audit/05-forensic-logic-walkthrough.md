---
status: draft
audit_type: knowledge_deep_audit
scope: forensic logic walkthrough
created: 2026-07-04
---

# Forensic Logic Walkthrough

## What This Area Does

Этот раздел объясняет forensic interpretation layer: как система превращает
USDT transfers, labels, service classifications и local coverage в понятные
money paths.

Это не то же самое, что scoring.

Forensic logic отвечает на вопросы:

- откуда пришли деньги;
- какие hops образуют путь;
- где путь доказан точно;
- где виден только вероятный funding context;
- где путь честно остановился на service boundary;
- где данных не хватило;
- какие факты можно передать в scoring, Admin и Telegram.

Scoring потом решает, какой final user-facing decision можно публиковать. Этот
раздел описывает именно входные forensic facts и их интерпретацию.

Главная граница:

```text
exact/proven fact != probable context != unresolved coverage gap != risk verdict
```

## Why It Exists

TRON USDT transfers сами по себе не отвечают на продуктовый вопрос.

Если кошелек получил 10,000 USDT, нам мало знать последний входящий transfer.
Нужно понять:

- кто funded sender до этого transfer;
- хватает ли суммы и времени для continuity;
- был ли источник clean CEX, risky label, bridge/router/DEX или unknown
  contract;
- является ли service boundary честным местом остановки;
- можно ли считать источник доказанным или только вероятным;
- что делать, если история не покрыта.

Без отдельного forensic layer система легко начинает делать плохие выводы:

- "мы не видим историю" превращается в "кошелек плохой";
- service boundary превращается в coverage failure;
- probable funding candidate превращается в exact proof;
- old partial cache превращается в свежую истину;
- source-of-funds question смешивается с wider DeepCheck profile.

Forensic logic нужен как слой дисциплины: он сохраняет evidence strength и не
дает слабому контексту выглядеть сильнее, чем он есть.

## Main User/Product Question

Для `Where is money` вопрос:

```text
Откуда пришли релевантные средства на этом wallet?
```

Для `Incoming deposit` вопрос:

```text
Можно ли доверять конкретному входящему deposit, и откуда sender взял деньги
до этого deposit?
```

Для `DeepCheck` вопрос другой:

```text
Какой общий forensic profile у wallet и его важных counterparties?
```

Эти вопросы пересекаются, но не заменяют друг друга.

`Where is money` и `Incoming deposit` используют похожую provenance tracing
логику. Но `Where` объясняет balance-forming или selected wallet funds, а
`Incoming` объясняет один concrete deposit.

`DeepCheck` может дать hard evidence, service exposure и relationship context,
но не обязан доказывать exact source of funds для выбранной суммы.

## End-To-End Flow

### 1. Выбор Scope

`Where is money` сначала выбирает, что именно надо объяснить.

Возможные scopes:

- `current_balance`;
- `requested_amount`;
- `transaction_seed`;
- `recent_flow`;
- `selected_anchor`;
- `drain_episode`.

Это важно, потому что "откуда текущий баланс" и "откуда конкретная транзакция"
это разные задачи.

Например:

- если проверяем current balance, система выбирает inbound transfers, которые
  объясняют текущий USDT balance;
- если проверяем requested amount, выбираются inbound flows, достаточные для
  этой суммы;
- если проверяем incoming deposit, используется transaction-seeded path around
  the sender/deposit.

Результат этого шага - набор seed transfers. Каждый seed становится началом
обратного trace.

### 2. Backward Trace По Hops

Trace идет назад от subject wallet к предыдущим источникам.

Для каждого current hop система:

1. Проверяет labels и service classification текущего address.
2. Если address является terminal boundary, trace останавливается.
3. Если boundary нет, читает transfers по address до нужного timestamp.
4. Ищет prior incoming transfers, которые могут объяснить outgoing hop.
5. Продолжает trace через выбранных funders или останавливается с понятным
   reason.

Trace не просто берет любой предыдущий transfer. Он учитывает:

- amount continuity;
- time continuity;
- max depth;
- max address fetches;
- beam width;
- coverage state;
- service labels;
- selected amount share.

Это делает route более осторожным: большой downstream transfer нельзя
доказывать маленьким upstream hop без amount continuity.

### 3. Stop Classification

Перед тем как читать еще историю, trace смотрит, не дошел ли он до честной
границы.

Примеры terminal stops:

- allowlisted CEX -> `allowlist_cex_reached`, обычно acceptable source;
- risky label -> `risky_label_reached`, hard bad evidence candidate;
- HTX/Huobi/WhiteBIT/source-policy boundary -> policy/context risk;
- bridge/router/DEX -> service/source-policy boundary;
- unknown contract -> review context, not automatic scam proof;
- generic service boundary -> manual review/context.

Здесь уже есть важная продуктовая идея:

```text
service boundary is not missing data
```

Если public-chain trace честно дошел до exchange, bridge, router, DEX или
service contract, это не то же самое, что "мы не смогли fetch history".

### 4. Funding-First Source Provenance

Для конкретного hop transfer система пытается сначала понять, какие prior
incoming funds могли профинансировать этот outgoing hop.

Это хранится как `sourceProvenance`.

Proof classes:

- `exact`;
- `probable`;
- `pre_existing_balance_possible`;
- `unresolved`;
- `service_boundary`.

На практике в проверенном evaluator сейчас явно строятся:

- `exact`;
- `probable`;
- `pre_existing_balance_possible`;
- `unresolved`.

`service_boundary` есть в types и Admin projection как поддерживаемый proof
class, но основной funding-first evaluator, который я смотрел, чаще доходит до
service meaning через path stop/classification layer, а не через отдельный
funding-first `service_boundary` result. Это важно не перепутать.

### 5. Exact Vs Probable

`exact` означает:

- funding bundle покрывает нужную сумму;
- history window достаточно покрыта;
- нет provider cap / budget cap / inconsistency flags;
- amount continuity не broken;
- можно продолжать trace через selected funders.

`probable` означает:

- amount-matching funding candidate виден;
- но coverage window не exact;
- история capped, incomplete, budget-limited или provider-limited;
- это Admin context, но не hard proof.

Кодовое поведение подтверждает эту границу: trace продолжает путь через funders
только если effective `sourceProvenance.proofClass === "exact"`.

Если proof class остается `probable`, путь останавливается как incomplete
context, а не превращается в доказанный source.

### 6. Exact-Window Repair

Есть bounded repair для probable funding candidates.

Сценарий:

1. Широкая history по sender capped или incomplete.
2. Но внутри нее виден конкретный funding candidate.
3. Система читает узкое окно от candidate timestamp до target hop timestamp.
4. Если это узкое окно complete и amount continuity проходит, `probable`
   может стать `exact`.

Это хорошая архитектурная форма: система не делает full re-index всего address
сразу, а сначала проверяет candidate-to-target window.

Актуальное обновление меняет lifecycle этого шага. Candidate-to-target window
теперь может быть не только bounded inline repair, но и durable queued
`candidate_window` targeted indexing stage. Если probable source provenance
нашел funding candidate, trace сначала просит `requestCandidateWindows`.
Parent Where job уходит в `waiting_for_targeted_index` с subphase
`checking_candidate_windows`, address index worker индексирует узкие окна, а
после resume trace снова запускает funding-first provenance.

Если exact candidate windows покрывают material hop amount, broad targeted
fallback не нужен. Если не покрывают, Where может перейти к старому broad
`genesis -> targetTimestamp` fallback. Если narrow window тоже capped,
inconsistent или amount/spend guard fails, proof остается `probable` or
`unresolved`.

### 7. Single-Candidate Fallback

Если funding-first bundle не дал exact route, trace может использовать обычный
single candidate approach:

- выбрать prior incoming transfer по amount/time continuity;
- продолжить trace через его sender;
- ограничить branch count через beam width.

Если candidates нет, trace смотрит на coverage.

Возможные outcomes:

- `incoming_history_not_fetched` - history не дошла до нужного timestamp;
- `pre_existing_balance_possible` - history покрыта, но usable funding
  candidate нет;
- `incoming_seen_but_below_continuity` - prior incoming transfers есть, но не
  проходят amount/time continuity;
- `no_incoming_transfers_seen`;
- `weak_amount_or_time_continuity`;
- `data_budget_exhausted`.

Это хорошая детализация: она не сваливает все непонятные случаи в один
`unknown`.

### 8. Operational Assessment

После построения origin paths система строит `WhereIsMoneyAssessment`.

Assessment учитывает:

- fast wallet risk;
- origin paths;
- approval-drain provenance;
- approval-drain review findings;
- contract LLM verdicts;
- source-policy evidence;
- subject exposure context;
- source bundle exposure;
- operational liquidity profile;
- coverage completeness;
- residual source-provenance materiality.

Assessment не должен терять разницу между:

- hard proof;
- source policy;
- contract suspicion;
- unknown origin;
- data quality;
- dampener;
- clean source.

Особенно важно: `probable` и unresolved source provenance не становятся hard
evidence.

### 9. Residual Unresolved Materiality

Есть специальное исключение для ordinary Where.

Если unresolved `sourceProvenance`:

- ниже 1% от checked/selected amount;
- ниже 100 USDT;
- не содержит hard evidence в unresolved branches;

то оно может остаться caveat, а не блокировать весь report.

Текущий outcome:

```text
residual_unresolved_below_materiality
```

Это не означает "источник чистый". Это означает:

```text
остаток не доказан, но он достаточно мал, чтобы не делать весь score invalid
при отсутствии hard evidence
```

Tests подтверждают, что такой result сохраняет `REVIEW 45`, `scoreValid=true`,
`technicalStatus=completed`, и не превращается ни в fake `ACCEPTABLE 0/100`, ни
в false `DECLINE`.

Сами thresholds сейчас local code constants, не product/runtime config.

### 10. Incoming Deposit Flow

`Incoming deposit` начинается с конкретного deposit:

- `depositTxHash`;
- watched wallet;
- sender;
- amount;
- timestamp.

Дальше builder:

1. Строит deposit edge.
2. Считает fast sender risk.
3. Читает sender transfers around deposit window.
4. Выбирает funding candidates for the deposit.
5. Запускает `runWhereIsMoneyCheck` в `transaction_check` mode.
6. Конвертирует Where origin paths в incoming origin paths.
7. Считает incoming-specific coverage, funding coverage, fresh bundle exposure,
   wallet exposure и final incoming report.

Incoming использует похожую source tracing логику, но результат другой:

- `decision`: `ACCEPTABLE`, `DECLINE`, `NO_FINAL_DECISION`;
- `depositRiskScore`;
- `originPaths`;
- `originCoverage`;
- `fundingCoverage`;
- `targetedHistoryCoverage`;
- `hardBadEvidence`;
- `sourcePolicyEvidence`;
- `senderRole`;
- `dataQuality`.

Важное отличие от ordinary Where lifecycle:

Incoming builder может вызвать `ensureAddressUsdtHistory` для targeted hops и
пометить scoring invalid при failure/partial targeted coverage. Но он не
использует тот же parent-job `waiting_for_targeted_index` wait/resume loop,
который уже есть у ordinary Where.

Поэтому корректная формулировка:

```text
Incoming has targeted coverage checks and no-final-score behavior, but does
not yet have the shared resumable targeted indexing lifecycle.
```

### 11. DeepCheck Relationship

DeepCheck связан с forensic logic, но отвечает на другой вопрос.

DeepCheck может:

- смотреть direct counterparties;
- строить service exposure;
- находить approval-drain evidence;
- добавлять second-layer relationship context;
- учитывать all-time direct boundary, если index complete и materializable;
- давать hard evidence для unified wallet risk.

Но DeepCheck не заменяет exact source-of-funds trace.

Если `Where is money` спрашивает "откуда пришли выбранные funds", то DeepCheck
спрашивает "какой forensic profile у wallet".

Эта граница в knowledge docs и коде в целом сохраняется.

### 12. Admin Graph Projection

Admin graph берет saved report и превращает его в readable evidence graph.

Для ordinary Where он показывает:

- route steps;
- transfer edges;
- funding bundles;
- exact funding candidates;
- probable funding context;
- unresolved caveats;
- service boundary facts;
- residual materiality caveats;
- hidden/grouped candidate counts.

Важная confirmed деталь:

- exact funding candidates могут отображаться как real transfer/funding edges;
- probable candidates отображаются как inferred/context, not proven bundle;
- unresolved/pre-existing/service-boundary outcomes видны как caveat/boundary
  facts;
- residual unresolved below materiality получает label `Residual source caveat`,
  а не terminal `History not fully fetched`.

Admin здесь полезен именно как analyst workbench: он показывает больше raw
forensic context, чем Telegram.

## Important Data Structures / States

### `MoneyOriginPath`

Один traced path.

Ключевые поля:

- `balanceTransferTxHash`;
- `rootSourceAddress`;
- `rootSourceType`;
- `pathAddresses`;
- `txHashes`;
- `steps`;
- `fundingBundles`;
- `sourceProvenance`;
- `historyCoverage`;
- `rejectedCandidates`;
- `amountPreservationRatio`;
- `stoppedReason`;
- `verdict`;
- `riskScoreContribution`;
- `reasons`.

Это главный carrier для source-of-funds explanation.

### `MoneyOriginFundingSourceProvenance`

Описание funding-first proof для конкретного hop.

Ключевые поля:

- `targetTxHash`;
- `targetFromAddress`;
- `targetToAddress`;
- `targetTimestamp`;
- `targetAmountRaw`;
- `proofClass`;
- `coveredAmountRaw`;
- `coverageRatio`;
- `amountContinuity`;
- `stopReason`;
- `fundingBundle`;
- `coverageWindow`;
- `reasons`.

Это место, где система явно говорит: exact это proof, probable это context,
unresolved это caveat/blocker depending on materiality.

### `MoneyOriginTraceHistoryCoverage`

Coverage metadata for hop history.

Ключевые поля:

- `address`;
- `targetTimestamp`;
- `fetchedTransferCount`;
- `fetchedPageCount`;
- `oldestFetchedTransferAt`;
- `reachedTargetHop`;
- `source`;
- `coverageComplete`;
- `providerCapHit`;
- `budgetExhausted`;
- `providerInconsistent`;
- `statusReason`.

Этот объект помогает не путать "нет кандидатов" и "история не покрыта".

### `WhereIsMoneyAssessment`

Operational assessment поверх origin paths.

Ключевые поля:

- `decision`;
- `riskScore`;
- `riskBand`;
- `provenanceConfidence`;
- `coverageCompleteness`;
- `walletRole`;
- `hardBadEvidence`;
- `sourcePolicyEvidence`;
- `riskLayers`;
- `sourceProvenanceMateriality`;
- `scoreValid`;
- `scoreBlockedReason`;
- `technicalStatus`;
- `reasons`;
- `warnings`.

Важно: `scoreValid` опциональный. Для обычных valid reports он может быть
undefined, а consumers трактуют explicit `false` как no-final-score state.

### `IncomingDepositRiskReport`

Deposit-focused report.

Ключевые поля:

- `decision`;
- `scoreValid`;
- `scoreBlockedReason`;
- `technicalStatus`;
- `depositRiskScore`;
- `originPaths`;
- `originCoverage`;
- `fundingCoverage`;
- `targetedHistoryCoverage`;
- `hardBadEvidence`;
- `sourcePolicyEvidence`;
- `freshBundleExposure`;
- `sourceBundleExposure`;
- `unifiedRiskSummary`;
- `reasons`;
- `warnings`.

Incoming explicitly uses `NO_FINAL_DECISION` when targeted coverage or inherited
Where score is invalid.

## What The Knowledge Docs Claim

Knowledge docs claim:

- modes must stay separate;
- `Where is money` explains relevant wallet funds;
- `Incoming deposit` explains one concrete deposit;
- DeepCheck is a wider forensic profile, not exact source-of-funds proof;
- `History not fully fetched` is not a paid final answer when caused by local
  budget or partial index state;
- service boundary is a legitimate stop;
- local budget stop is not a legitimate source conclusion;
- ordinary Where has resumable targeted indexing for required hop history;
- ordinary Where now has candidate-window-first targeted indexing for
  `probable` funding-first source provenance before broad fallback;
- Incoming does not yet have the same general resumable indexing flow;
- funding-first source provenance has exact/probable/pre-existing/unresolved
  classes;
- probable funding is Admin context, not hard scoring proof;
- residual unresolved below materiality can remain caveat instead of blocker;
- Admin should show exact/probable/unresolved/boundary distinctions.

This is mostly consistent with inspected code.

## What The Code Appears To Implement

### Where Trace

`traceMoneyOriginPath` implements backward tracing.

It:

- starts from a selected balance/seed transfer;
- checks labels and service classification at each hop;
- stops at known boundaries;
- fetches transfers for the current address at the relevant hop timestamp;
- evaluates funding-first source provenance;
- requests durable candidate-window indexing for probable candidates when the
  job can wait, then attempts exact-window repair/re-evaluation from covered
  narrow windows;
- continues only through exact funding bundles or acceptable candidate edges;
- emits incomplete paths when history or continuity is insufficient.

### Funding-First Proof

`evaluateFundingFirstSourceProvenance` classifies a hop as:

- exact if funding bundle and coverage are exact;
- probable if amount is covered but coverage is not exact;
- pre-existing balance possible if covered history has no usable funding
  candidate;
- unresolved if amount continuity breaks or funding cannot be proven.

`repairFundingSourceExactWindow` can upgrade probable to exact only when the
narrow window is complete and amount/spend checks pass. The candidate-window
queue does not relax that rule; it only gives the trace a durable way to fetch
the narrow proof window before deciding.

### Operational Assessment

`buildMoneyOriginOperationalAssessment` aggregates:

- hard evidence;
- source-policy evidence;
- contract suspicion;
- unknown origin evidence;
- operational liquidity context;
- residual materiality.

It has an explicit materiality path where residual unresolved source provenance
below thresholds can keep score usable as a `REVIEW` caveat.

### Incoming Deposit

`buildIncomingDepositReport` builds deposit-specific report by running
transaction-seeded Where logic and then converting paths to incoming semantics.

It can:

- target-index hops via `ensureAddressUsdtHistory`;
- build targeted coverage summary;
- produce `NO_FINAL_DECISION` when mandatory hop coverage is blocked;
- keep source policy and hard evidence separate;
- add incoming-specific fresh bundle exposure and sender role context.

But it does not yet use shared job-level wait/resume targeted indexing.

### Admin Projection

`projectForensicJobGraph` and the Where projection logic expose the distinction
between:

- route transfer;
- exact funding candidate;
- probable inferred provenance;
- grouped candidate tail;
- unresolved source caveat;
- service boundary;
- residual materiality caveat.

This is consistent with the product goal of making Admin an analyst workbench.

## Confirmed Vs Not Confirmed

### Confirmed From Knowledge Docs

- Check modes remain separate.
- Ordinary Where should continue indexing or no-score on incomplete required
  main-path coverage.
- Incoming still lacks full resumable indexing.
- Service boundaries are legitimate stops.
- Probable source provenance must remain context.
- Residual unresolved below materiality can be caveat, not blocker.

### Confirmed From Code Inspection

- `traceMoneyOriginPath` only continues through funding-first funders when
  proof class is `exact`.
- `probable` source provenance first requests candidate-window proof when
  wait/resume is available.
- `probable` source provenance still stops as incomplete context unless
  candidate-window repair/re-evaluation upgrades it to `exact`.
- Candidate-window repair is narrow and candidate-scoped; it is not broad
  address-history coverage.
- `MoneyOriginTraceHistoryCoverage` carries coverage/provider/budget flags.
- Incoming builder has targeted ensure and no-final-score mapping, but not
  shared parent-job wait/resume.
- Admin projection handles exact, probable, unresolved, pre-existing balance,
  service boundary and residual caveat differently.
- `scoreValid=false` is explicit no-final-score state; ordinary valid results
  may rely on absence of false.

### Confirmed From Tests

Focused tests passed:

```text
Test Files  9 passed (9)
Tests       615 passed (615)
```

Covered behaviors include:

- exact funding-first classification;
- probable capped-window classification;
- pre-existing balance possible;
- amount-continuity broken;
- exact-window repair;
- candidate-window request before broad fallback;
- capped repair staying probable;
- spend-overhang preventing overproof;
- ordinary trace path behavior;
- Incoming targeted ensure success/failure;
- Incoming `NO_FINAL_DECISION` for targeted coverage block;
- Admin probable funding context;
- Admin exact funding candidate visibility;
- Admin unresolved/service boundary caveats;
- Admin residual materiality caveat;
- bot formatting preserving materiality `REVIEW`.

### Not Confirmed In This Pass

- No fresh live runtime job was observed in browser/Admin for this section.
- I did not fully audit every scoring matrix row here; that belongs in
  `06-scoring-walkthrough.md`.
- I did not exhaustively prove every legacy/fallback path avoids false final
  decline under every partial coverage condition.
- I did not validate production DB data freshness or old cached job behavior in
  this section.

## Known Gaps

### 1. Incoming Does Not Yet Share Where Wait/Resume

Incoming has targeted coverage checks, but it still lacks the ordinary Where
parent-job wait/resume lifecycle.

Current behavior is safer than silently scoring partial data because it can
produce `NO_FINAL_DECISION`. But product-wise this is still incomplete: the
better path is to keep indexing and resume.

### 2. `scoreValid` Semantics Are Split Between Optional And Explicit Fields

For valid results, `scoreValid` can be undefined. For invalid results,
`scoreValid=false` is explicit.

This is workable and tests cover important paths, but it is easy to misread
when auditing raw JSON. A reader might expect every final report to say
`scoreValid=true`.

### 3. Materiality Thresholds Are Local Constants

Residual unresolved materiality thresholds are currently local constants:

- 1%;
- 100 USDT.

This is acceptable for current calibration, but these are product policy
values. They probably need runtime/product config after more real examples.

### 4. Service Boundary Has Two Representations

Service boundary can appear as:

- path stop/classification;
- Admin caveat/boundary projection;
- `MoneyOriginFundingProofClass = "service_boundary"` in types.

The checked funding-first evaluator mostly produces exact/probable/
pre-existing/unresolved, while service boundaries are usually represented by
classification/path stops. This is not necessarily wrong, but it needs clear
documentation so analysts do not expect `proofClass=service_boundary` in every
boundary case.

### 5. Large Files Carry Too Much Interpretation

The core forensic behavior is concentrated in large files:

- `moneyOriginTrace.ts`;
- `whereIsMoneyCheck.ts`;
- `moneyOriginOperationalAssessment.ts`;
- `incomingDepositJob.ts`;
- `forensicsGraph.ts`.

This is manageable for now, but it makes future changes risky because product
rules, evidence classification, runtime fetching and presentation are close
together.

### 6. Admin Is Ahead Of Telegram

Admin shows nuanced provenance context.

Telegram and support formatting preserve the important residual materiality
case, but the broader live progress and forensic nuance are still more limited
there.

### 7. Coverage Metadata Depends On Producer Quality

`MoneyOriginTraceHistoryCoverage` is useful only if producers correctly set:

- `coverageComplete`;
- `providerCapHit`;
- `budgetExhausted`;
- `providerInconsistent`;
- `statusReason`.

The current Where job path does meaningful work here, but older jobs or weaker
producers can still be less precise.

## Risks / Failure Modes

### Probable Context Overread As Proof

Risk:

```text
Analyst sees probable funding candidate and treats it as exact source.
```

Current mitigation:

- code does not continue trace through probable candidate;
- Admin labels probable separately;
- tests cover probable not becoming proven bundle.

Remaining risk:

- external readers or Telegram copy might still overread if wording is too
  confident.

### Coverage Gap Overread As Risk

Risk:

```text
incoming_history_not_fetched becomes perceived as bad source.
```

Current mitigation:

- targeted wait/resume for ordinary Where;
- terminal no-score fields for provider/budget blocks;
- residual materiality caveat labeling;
- Admin caveat semantics.

Remaining risk:

- old jobs and some fallback paths can still show technical raw wording;
- scoring behavior needs separate full audit.

### Service Boundary Overread As Clean

Risk:

```text
service boundary is treated as clean source.
```

Current mitigation:

- allowlisted CEX is separated from generic CEX/unknown contract/bridge/DEX;
- bridge/router/DEX are policy context;
- unknown contract stays review/context unless stronger evidence exists.

Remaining risk:

- service identity quality depends on classification/enrichment quality.

### Minor Residual Caveat Overread As Fully Proven

Risk:

```text
residual_unresolved_below_materiality is treated as exact full provenance.
```

Current mitigation:

- Admin labels it as caveat;
- report keeps `REVIEW 45`;
- tests assert no fake `ACCEPTABLE 0/100`.

Remaining risk:

- product copy must keep saying "caveat", not "clean".

### Incoming Stops Too Early

Risk:

```text
Incoming sees targeted coverage block and returns no-final-score, but does not
schedule/resume the same way Where does.
```

Current mitigation:

- no-final-score behavior is explicit.

Remaining risk:

- user may need rerun/manual wait instead of automatic completion.

## What To Keep As-Is

### Keep Separate Modes

The code and docs are right to keep:

- `Where is money`;
- `Incoming deposit`;
- `DeepCheck`;
- unified `/check`

as separate product questions.

### Keep Exact/Probable Boundary

The strongest part of this layer is the exact/probable separation.

Probable funding is useful and should remain visible, but it must not become
hard proof or trace continuation.

### Keep Candidate-Window Exact Repair

Candidate-window exact repair is a pragmatic improvement.

It turns some probable candidates into exact proof without immediately
requiring an unbounded full-address fetch. The current queued version is better
than the older purely inline shape because it survives long provider/indexing
work and gives Admin progress.

Keep the current invariant: candidate-window proof does not count as broad
history coverage and cannot become hard proof unless the existing
funding-first exact rules pass.

### Keep Service Boundary Semantics

Service boundary should remain a legitimate stop, not a data failure.

But only allowlisted CEX should behave like clean source. Other boundaries
need policy/context handling.

### Keep Residual Materiality Caveat

The materiality exception is useful.

It prevents tiny unresolved residue from blocking an otherwise useful report,
while keeping the caveat visible.

### Keep Admin Richer Than Telegram

Admin should continue showing raw details, proof classes, grouped candidates,
and caveats. Telegram should stay simpler and avoid overclaiming.

## Improvement Ideas

### 1. Add A Provenance Glossary Table

Create a small table in audit/knowledge later:

```text
proofClass | means | can continue trace | can affect score | user-facing wording
```

This would reduce confusion around exact/probable/unresolved/service boundary.

### 2. Make Materiality Thresholds Product Config

Move 1% / 100 USDT from local constants to explicit product/runtime config
after enough calibration.

This does not need to happen during this audit, but it should be a decision.

### 3. Give Incoming Shared Wait/Resume

Incoming should eventually use the same generic targeted waiter lifecycle as
ordinary Where.

The existing `TargetedHistoryRequiredFor = "incoming_hop"` type suggests this
was anticipated, but the current Incoming builder is not wired to parent-job
wait/resume.

### 4. Add A Report Freshness Marker

For forensic interpretation, freshness matters.

Admin should make it hard to confuse:

- fresh live run;
- old completed job;
- old partial job;
- cached report after code changes.

This overlaps with Admin UX, but it affects trust in forensic interpretation.

### 5. Split Some Forensic Policy Helpers

If this area grows, consider extracting small policy modules for:

- source provenance proof class semantics;
- materiality policy;
- service boundary semantics;
- Incoming targeted coverage block mapping.

Do not refactor just for aesthetics. Do this only when changing behavior or
adding more cases.

### 6. Add Tests For Funding-First `service_boundary` If Intended

Because the type supports `proofClass="service_boundary"`, add explicit tests
if the product expects evaluator-created service-boundary source provenance.

If not, document that service boundaries usually live in path stop
classification, not funding-first proof class.

### 7. Improve Telegram Copy For Probable And Caveat Cases

Admin can keep raw technical detail. Telegram should use plain language:

- "source candidate seen, but history window is incomplete";
- "small unresolved residue remains visible as a caveat";
- "no final score because required hop history is not covered".

### 8. Document Candidate-Window Proof In The Provenance Glossary

The glossary should explicitly say:

```text
candidate_window = narrow proof window for one funding candidate.
broad_targeted = broad address history to a target timestamp.
```

This matters because analysts may otherwise read "candidate windows complete"
as "hop history complete".

## Questions For You

1. Согласен ли ты с формулировкой, что `probable` funding candidate должен
   оставаться Admin/context evidence и не должен вести trace дальше?

2. По `service_boundary`: считаем текущую модель нормальной, где service
   boundary чаще живет как path stop/classification, а не как
   `sourceProvenance.proofClass`, или хочешь сделать это отдельным future
   improvement?

3. Для Incoming: ставим shared wait/resume targeted indexing как high-priority
   improvement после аудита, или пока просто фиксируем as known gap?

4. Materiality thresholds 1% / 100 USDT пока оставляем как local policy
   constants, или в `08` надо явно вынести product decision "нужна настройка"?

5. В следующем разделе `06-scoring-walkthrough.md` глубоко разбираем
   `score_valid`, `NO_FINAL_DECISION`, `REVIEW` vs `DECLINE`, floors/dampeners
   и где incomplete coverage должна блокировать score. Подтверди, что это
   правильный следующий фокус.

## Evidence Appendix

Knowledge docs used:

- `docs/knowledge/AGENT_BRIEF.md`
- `docs/knowledge/02-check-modes.md`
- `docs/knowledge/04-data-sources-tronscan-indexing.md`
- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/06-deepcheck.md`
- `docs/knowledge/07-risk-scoring-matrix.md`
- `docs/knowledge/08-admin-and-bot-ux.md`
- `docs/knowledge/09-current-decisions.md`
- `docs/knowledge/10-open-problems.md`
- `docs/knowledge/11-glossary.md`
- `docs/knowledge/13-agent-observations.md`

Audit context used:

- `docs/audit/2026-07-knowledge-deep-audit/04-job-lifecycle-walkthrough.md`

Code entry points inspected:

- `src/check/whereIsMoneyCheck.ts`
  - `runWhereIsMoneyCheck`
- `src/forensics/moneyOriginTrace.ts`
  - `traceMoneyOriginPath`
- `src/forensics/candidateWindowTargeting.ts`
  - `selectCandidateWindowsForSourceProvenance`
- `src/forensics/fundingFirstSourceProvenance.ts`
  - `evaluateFundingFirstSourceProvenance`
  - `repairFundingSourceExactWindow`
- `src/forensics/moneyOriginOperationalAssessment.ts`
  - `buildMoneyOriginOperationalAssessment`
- `src/forensics/moneyOriginPolicy.ts`
  - `classifyMoneyOriginStop`
  - `combineMoneyOriginDecision`
- `src/forensics/incomingDepositJob.ts`
  - `buildIncomingDepositReport`
  - `incomingReportFromWhere`
  - `buildIncomingTargetedCoverageSummary`
- `src/forensics/deepForensicJob.ts`
  - `runWhereIsMoneyJob`
  - `runSingleDeepForensicJobCycle`
- `src/forensics/targetedHistoryCoordinator.ts`
  - `ensureTargetedHistoryOrWait`
  - `ensureCandidateWindowsOrWait`
  - `targetedHistoryTerminalStatus`
- `src/admin/forensicsGraph.ts`
  - `projectWhereIsMoneyJob`
  - source-provenance graph projection helpers
- `src/risk/unifiedWalletRisk.ts`
  - score validity and residual materiality preservation references
- `src/bot/createBot.ts`
  - Where support/final formatting helpers
- `src/types.ts`
  - `MoneyOriginPath`
  - `MoneyOriginFundingSourceProvenance`
  - `MoneyOriginTraceHistoryCoverage`
  - `WhereIsMoneyReport`
  - `IncomingDepositRiskReport`

Focused verification:

```text
npm test -- tests/forensics/moneyOriginTrace.test.ts tests/forensics/fundingFirstSourceProvenance.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/deepForensicJob.test.ts tests/admin/forensicsGraph.test.ts tests/risk/unifiedWalletRisk.test.ts tests/bot/createBot.test.ts
```

Result:

```text
Test Files  9 passed (9)
Tests       615 passed (615)
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
