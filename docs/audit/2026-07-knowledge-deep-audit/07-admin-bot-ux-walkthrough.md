---
status: draft
audit_type: knowledge_deep_audit
scope: admin and bot ux walkthrough
created: 2026-07-04
---

# Admin And Bot UX Walkthrough

## What This Area Does

Этот раздел объясняет две пользовательские поверхности проекта:

- Admin forensic console для аналитика;
- Telegram bot для конечного пользователя и support/debug запросов.

Обе поверхности читают одни и те же jobs/reports, но не должны показывать их
одинаково.

Admin должен быть рабочим местом аналитика. Он может показывать raw statuses,
technical codes, graph payload, funding candidates, page counters, provider
errors, locks и strict benchmark details.

Telegram должен быть пользовательским интерфейсом. Он должен объяснять итог
коротко, не перегружать raw-кодами и не превращать техническую остановку в
risk verdict.

Главная граница:

```text
Admin can expose diagnostic truth.
Telegram must translate it into product truth.
```

## Why It Exists

Forensic система может быть технически корректной и все равно непонятной или
опасной в интерфейсе.

Примеры:

- `provider_cap_unresolved` полезен аналитику, но пользователю без объяснения
  выглядит как бессмысленный код;
- `History not fully fetched` полезен как stop reason, но не должен выглядеть
  как финальный paid result;
- `queued` job может на самом деле ждать targeted indexing и быть живым;
- `failed` job может означать technical no-score, а не плохой адрес;
- compact graph может скрывать evidence, если не показывать visible/total
  counters;
- old cached job может выглядеть как свежая проверка.

Admin/Bot UX слой нужен, чтобы сохранить meaning:

```text
job status != product result
technical code != user verdict
hidden graph evidence != absent evidence
old cached evidence != fresh run
```

## Main User/Product Question

Для Admin:

```text
Что реально произошло в проверке, какие evidence и coverage states есть, и где
система остановилась?
```

Для Telegram:

```text
Какой понятный итог можно безопасно показать пользователю прямо сейчас?
```

Для long checks:

```text
Проверка еще работает, ждет индекс, завершилась техническим stop, или уже дала
финальный forensic result?
```

Для support/debug:

```text
Можно ли по job id увидеть достаточно деталей, чтобы понять status, coverage,
score validity и причину block?
```

## End-To-End Flow

### 1. Jobs становятся общим источником для Admin и Bot

Фундамент обеих поверхностей - `forensic_check_jobs`.

Job хранит:

- `kind`;
- `status`;
- `subjectAddress`;
- `progressJson`;
- `resultJson`;
- raw evidence ids;
- timestamps;
- `lastError`.

Admin обычно читает jobs через HTTP API:

```text
/admin/api/forensic-jobs
/admin/api/forensic-jobs/:id/graph
/admin/api/forensic-jobs/:id/raw
```

Telegram читает jobs через command/callback flows:

```text
/check_status <job-id>
incoming deposit alert callback
final delivery after worker completes
```

### 2. Admin job list превращает raw job status в analyst status

Raw repository status может быть `queued`, но для ordinary Where это не всегда
означает "просто стоит в очереди".

Если `where_is_money_check` находится в:

```text
jobPhase=waiting_for_targeted_index
```

или `targetedIndex.phase=waiting_for_targeted_index`, Admin job card показывает
это как:

```text
WAITING: TARGETED INDEX
```

и добавляет compact live progress:

- active hop address;
- pages and budget;
- unique canonical hashes and repeat ratio;
- oldest reached date;
- lock owner and expiry;
- targeted state counts;
- provider error counters.

Это правильная UX-идея. Она не заставляет аналитика угадывать, жив ли процесс,
по одному слову `queued`.

После candidate-window-first обновления у Where есть более точный waiting
status:

```text
CHECKING: CANDIDATE WINDOWS
```

Admin показывает его, когда `targetedIndex.phase=checking_candidate_windows`
или candidate-window summary имеет pending windows. Это важно: analyst должен
понимать, что система сейчас проверяет narrow funding candidates, а broad
fallback еще может быть `not_queued`.

### 3. Admin graph endpoint показывает progress graph для waiting Where

Раньше waiting job мог выглядеть как `409 not_ready`. Сейчас для ordinary Where
targeted wait graph endpoint возвращает progress graph.

Этот graph намеренно не является forensic result:

```text
decision=UNKNOWN
riskScore=null
checkedScope=targeted_history_indexing
limitation=waiting_for_targeted_index
```

В graph есть subject node, waiting/indexing node, progress-only edge и
informational limitation:

```text
Waiting for targeted history, not stuck.
```

Это сильное решение. Оно показывает работу системы, не публикуя score.

Для candidate-window phase graph endpoint возвращает тот же progress-only
семантический тип, но с другим checked scope:

```text
checkedScope=candidate_window_indexing
limitation=checking_candidate_windows
decision=UNKNOWN
riskScore=null
```

Top reason должен объяснять, что final score pending until candidate windows
complete and Where re-runs funding provenance.

### 4. Completed/failed Admin graphs проецируются по job kind

Когда job завершен как `completed`, `partial` или `failed`, graph projection
идет по kind:

- `address_fast_check`;
- `address_deep_check`;
- `where_is_money_check`;
- `incoming_deposit_check`.

Admin graph - это не просто картинка. Он возвращает structured read model:

- `summary`;
- `nodes`;
- `edges`;
- `paths`;
- `weights`;
- `limitations`;
- `evidence`;
- `layerSummary`.

Эта модель нужна, чтобы UI мог не только рисовать graph, но и объяснять его:
что является transfer, что является inferred provenance, где service boundary,
где caveat, где source policy, где technical stop.

### 5. Admin graph keeps diagnostic detail in `layerSummary`

`layerSummary` собирает важные технические и forensic детали:

- `targetedIndex`;
- `targetedHistory`;
- `strictProvenance`;
- `strictBenchmarkMetrics`;
- `sourceProvenanceMateriality`;
- `whereFundingCandidateVisibility`.

Это хороший pattern. Он не смешивает эти детали с top-level decision, но делает
их доступными аналитику.

Пример: failed ordinary Where с `provider_cap_unresolved` сохраняет
`targetedIndex` details. Admin при этом не добавляет отдельный generic
`where_origin_paths_missing` как равный-looking stop, если targeted terminal
уже объясняет причину.

### 6. Admin view modes защищают от ложного "ничего не видно"

Admin console имеет несколько режимов чтения graph:

- `Full evidence`;
- `Investigative view`;
- `Compact summary`;
- graph-specific layouts вроде flow map, deep branch map, wallet clusters.

DeepCheck completed graphs default to `Full evidence`. Это важно: DeepCheck
может содержать много second-layer evidence, и compact view не должен создавать
ощущение, что evidence нет.

Where and Incoming default to flow/investigative style. Для них основной
workflow - читать route/provenance path, а не весь wallet neighborhood.

Manual `Full evidence` bypasses local filters and показывает весь graph API
payload. Console также показывает:

```text
Visible N/E/P
Total N/E/P
Hidden by view/filter
```

Это правильный UX guardrail. Если текущий режим скрывает nodes/edges, аналитик
видит, что evidence hidden by view/filter, а не отсутствует.

### 7. Admin показывает funding-first source provenance как evidence strength

Для ordinary Where Admin показывает funding-first candidates не как один
плоский список, а по proof class:

- exact funding candidate;
- probable funding context;
- unresolved source caveat;
- pre-existing balance caveat;
- service boundary;
- grouped candidate tail.

Exact candidates могут стать rendered funding edges, если они прикреплены к
конкретному route hop.

Probable candidates остаются context, not proof.

Unresolved/pre-existing/service-boundary entries остаются caveat/boundary facts.

Candidate tails группируются с counts, чтобы UI не молча терял evidence из-за
display caps.

Это соответствует forensic policy: evidence strength сохраняется в UI.

### 8. Residual unresolved below materiality показан как caveat

Для ordinary Where residual unresolved source provenance below materiality
Admin показывает:

```text
residual_unresolved_source
severity=info
```

и сохраняет `sourceProvenanceMateriality` summary.

Индивидуальные unresolved paths могут оставаться видимыми, но label меняется:

```text
Residual source caveat
```

а не финальный terminal:

```text
History not fully fetched
```

Это хорошая UX-граница. Она не скрывает unresolved факт, но не делает его
ложной технической failure.

### 9. Incoming deposit Admin graph остается deposit-scoped

`incoming_deposit_check` projection строит graph вокруг sender, receiver,
deposit origin paths, fresh bundle exposure, wallet exposure profile,
source bundle exposure и subject exposure profile.

Это важно: Incoming должен объяснять конкретный deposit, а не всю биографию
receiver wallet.

В Admin это отдельный graph kind, и console использует route/flow-style view.
При этом knowledge docs правы: Incoming пока не имеет такого же полного
resumable progress UX, как ordinary Where targeted indexing.

### 10. Telegram final address report строится user-first

Telegram final report для address/unified check строится через
`formatUnifiedAddressFinalReport`.

Если Where score invalid:

```text
whereScoreValid(report) === false
```

formatter уходит в отдельный no-final report:

- `Address check - no final decision`;
- `Decision: NO_FINAL_DECISION`;
- `Blocked reason`;
- `Technical status`;
- coverage explanation.

Это правильное поведение. Оно не превращает invalid Where в `DECLINE`.

Если DeepCheck еще running, Telegram может показать preliminary Where result:

- preliminary risk;
- почему;
- что DeepCheck еще продолжает анализ;
- что final result придет позже.

Это тоже хороший product pattern: пользователь видит прогресс смыслом, а не
raw job state.

### 11. Telegram support/debug отличается от обычной delivery

`/check_status` для persisted Where result возвращает support formatter:

```text
Where-is-money - support/debug
```

Там показываются:

- job id;
- status;
- decision;
- Where risk;
- coverage;
- checked scope;
- proof level;
- score valid;
- blocked reason;
- technical status;
- coverage notes.

Обычная user delivery не должна всегда показывать support/debug details.

Это хорошая граница: support может видеть больше, пользовательский итог должен
быть проще.

### 12. Incoming deposit Telegram alert показывает result, but less technical detail

Incoming deposit alert formatter показывает:

- title with timestamp;
- decision;
- deposit risk score and band;
- amount;
- watched wallet;
- sender;
- reasons;
- AI contract verdict section if present;
- checks: fast sender risk, deposit funding coverage, clean-source proof,
  origin confidence, sender role;
- tx hash;
- keyboard with job id, sender and tx hash.

Если report decision is `NO_FINAL_DECISION`, formatter покажет это значение в
decision line.

Но formatter не выделяет отдельными строками:

- `scoreValid`;
- `scoreBlockedReason`;
- `technicalStatus`.

Некоторая причина block может попасть в `Reasons`, потому что incoming report
добавляет reason вроде "Final incoming-deposit scoring is blocked...". Но
technical status живет в warnings, а этот formatter warnings не показывает
как отдельный block.

Это не обязательно runtime bug, но UX gap: no-final Incoming alert может быть
менее ясным, чем no-final Where final report.

### 13. Generic Telegram job status still has DeepCheck wording

Generic `formatForensicJobStatus` используется не только для DeepCheck. Его
title сейчас:

```text
Deep forensic status
```

Если его вызвать для malformed Where result или incoming deposit callback,
сообщение все равно может называться deep forensic status.

Тесты это фактически фиксируют для generic fallback.

Это небольшой, но понятный UX gap: generic job status должен называть job kind
или хотя бы "Forensic job status".

## Important Data Structures / States

### AdminForensicsGraph

Admin graph содержит:

- `job`;
- `subject`;
- `summary`;
- `nodes`;
- `edges`;
- `paths`;
- `weights`;
- `limitations`;
- `evidence`.

Для UX важнее всего не сами nodes/edges, а то, что graph сохраняет:

- decision and risk score;
- coverage ratio;
- risk clarity;
- checked scope;
- top reasons;
- limitations;
- layer summary.

### Admin node/edge/path metadata

Metadata используется для объяснения:

- money direction;
- source provenance proof class;
- funding bundle context;
- service boundary;
- stop reason;
- stop meaning;
- amount role;
- grouped hidden candidates;
- path id;
- evidence ids.

Это позволяет UI рисовать graph не только по direction `from -> to`, но и по
semantic money direction.

### Targeted index summary

`targetedIndex` показывает current/last targeted state:

- phase;
- score validity;
- blocked reason;
- technical status;
- waiting address;
- target timestamp;
- last index status;
- status reason;
- pages/transfers;
- unique hashes/repeat ratio;
- oldest/newest fetched dates;
- budget/attempt/retry;
- provider errors;
- provider cap/budget flags.

Для candidate-window-first Where `targetedIndex` also includes:

- `candidateWindows.total`;
- `candidateWindows.queued`;
- `candidateWindows.running`;
- `candidateWindows.complete`;
- `candidateWindows.terminal`;
- `candidateWindows.pending`;
- `broadFallback`.

### Targeted history summary

`targetedHistory` показывает aggregate state:

- total states;
- queued/running/complete/partial/failed counts;
- terminal count when present;
- pages/transfers;
- unique hashes/repeat ratio;
- oldest/newest dates;
- request and provider error counters;
- state rows with locks and retry data.

State rows may now include `requestKind=candidate_window`, window start/end and
candidate tx hash. Admin should preserve those fields because they explain why
multiple waits can exist for one address and target timestamp.

### Strict provenance summary

`strictProvenance` показывает:

- benchmark flag;
- phase;
- score validity;
- blocked reason;
- technical status;
- covered/total hop count.

### Where funding candidate visibility

`whereFundingCandidateVisibility` показывает:

- exact shown/total;
- probable shown/total;
- grouped hidden count;
- unresolved caveat count;
- pre-existing balance caveat count;
- service boundary count;
- route hop count;
- max proven route depth.

### Telegram message families

Основные families:

- user final address report;
- preliminary Where report while DeepCheck is still running;
- invalid Where no-final report;
- Where support/debug report;
- DeepCheck context/final report;
- generic forensic job status;
- incoming deposit risk alert.

## What The Knowledge Docs Claim

Knowledge docs утверждают:

- Admin is analyst workbench and can show more diagnostic detail than Telegram.
- Telegram should be clear and not overclaim.
- Ordinary Where targeted waiting should be visible in Admin.
- Ordinary Where candidate-window checking should be visible as a distinct
  progress phase from broad targeted fallback.
- Waiting targeted indexing is progress, not final failure.
- Admin graph endpoint should return progress graph instead of `409 not_ready`
  for waiting ordinary Where.
- Completed/failed ordinary Where should keep targeted terminal details visible.
- Funding-first probable sources should be context, not proof.
- Residual unresolved below materiality should stay a caveat and preserve
  `REVIEW` with real score.
- Raw technical codes are acceptable in Admin/debug but need plain-language
  context in Telegram.
- Telegram does not yet have complete live progress UX for long ordinary
  Where/Incoming indexing.
- Admin should distinguish old cached jobs from fresh live runs more clearly.
- Job-start buttons should confirm address and queued job id more clearly.

## What The Code Appears To Implement

### Admin implementation is broad and fairly consistent

Admin implements:

- authenticated forensic jobs API;
- job filtering by status, kind, subject and query;
- graph endpoint;
- raw job endpoint;
- strict benchmark job creation;
- DeepCheck second-layer refresh endpoint;
- waiting Where targeted progress graph;
- candidate-window progress graph and job-card status;
- targeted progress hydration from admin read model;
- graph projections for fast, Where, DeepCheck and Incoming;
- graph modes and counters in the console;
- targeted history detail rendering;
- strict provenance detail rendering;
- Where funding candidate visibility;
- residual materiality caveat rendering;
- saved wallet risk enrichment for graph nodes.

The code matches the knowledge docs well for ordinary Where Admin progress and
graph visibility.

### Telegram implements strong Where no-final safety

Telegram implements:

- invalid Where final report as `NO_FINAL_DECISION`;
- support/debug Where report with `scoreValid`, blocked reason and technical
  status;
- preliminary Where result when matching DeepCheck is still running;
- final unified report that keeps residual materiality `REVIEW` with real
  score.

This matches the high-risk product rules from the knowledge docs.

### Telegram progress for long checks is partial

Generic `/check_status` can show job status, job id, subject, window and last
error.

For persisted Where result, it gives a richer support/debug report.

But there is no complete Telegram progress equivalent of Admin targeted history
progress. A user does not get the same pages/budget/oldest-date/provider-error
stream that Admin gets.

This matches the known gap in docs.

### Incoming Telegram alert is useful but less explicit for technical blocks

Incoming alert formatter gives useful user-facing summary for normal completed
deposit checks.

However, compared with invalid Where final report, it does not explicitly
display `scoreValid`, blocked reason or technical status. If Incoming has
`NO_FINAL_DECISION`, the decision line can show it, and reasons may explain
coverage block, but the technical state is less direct.

This is a likely improvement area.

### Generic job status wording is too DeepCheck-specific

`formatForensicJobStatus` is generic in usage but says `Deep forensic status`.
That wording is wrong or at least confusing for incoming deposit and generic
fallbacks.

This is a small but clear UX mismatch.

## Confirmed Vs Not Confirmed

### Confirmed By Docs And Code Inspection

Confirmed:

- Admin job list can receive targeted history progress through
  `withTargetedHistoryProgress`.
- Admin graph endpoint returns progress graph for waiting ordinary Where.
- Progress graph uses `UNKNOWN` decision and `null` risk score.
- Admin console labels waiting targeted indexing separately from plain queued.
- Admin console labels candidate-window checking separately from broad targeted
  waiting.
- Admin console renders targeted history and strict benchmark diagnostic lines.
- Admin graph supports full evidence mode and visible/total/hidden counters.
- Where funding candidates are classified and counted by proof class.
- Residual unresolved below materiality is represented as informational caveat.
- Telegram Where invalid-score path produces no-final-decision output.
- Telegram Where support/debug shows score validity and technical fields.
- Incoming alert formatter exists separately from bot command code.

### Confirmed By Tests

Focused Admin/Bot UX tests passed:

```text
7 test files passed
541 tests passed
```

The test set covered:

- Admin graph projection;
- Admin console rendering logic;
- Admin server endpoints;
- Where funding candidate visibility;
- Incoming alert formatter;
- Telegram bot formatting/callback flows;
- Incoming deposit job behavior that feeds alerts.

Specific tested behaviors include:

- waiting Where targeted job projects as progress, not final failure;
- candidate-window Where job projects as progress with
  `checkedScope=candidate_window_indexing`;
- waiting graph has `decision=UNKNOWN` and `riskScore=null`;
- Admin server hydrates targeted history progress;
- Admin job card labels waiting targeted history as indexing;
- full evidence mode bypasses filters and separates visible/total counters;
- DeepCheck defaults to full evidence;
- Where/Incoming use flow map style;
- target/provider terminal details stay in Admin summary;
- residual materiality caveat does not appear as terminal `History not fully
  fetched`;
- Where invalid score does not become final decline in Telegram;
- Where support/debug includes blocked reason and technical status;
- residual materiality Where remains `REVIEW 45` in Telegram final/support;
- incoming deposit job can produce `NO_FINAL_DECISION` with technical status in
  report data;
- incoming alert formatter displays decision, score/band, reasons and checks.

### Not Runtime-Observed In This Pass

Not observed live in this section:

- in-browser Admin visual rendering with a real running targeted worker;
- Telegram live delivery during a real long waiting Where job;
- Telegram incoming alert for a real `NO_FINAL_DECISION` deposit;
- analyst behavior around old cached jobs versus fresh runs;
- whether non-technical users understand current no-final wording.

Confidence:

- Admin graph/projection behavior: `test-backed`;
- Admin browser console source behavior: `test-backed`, not visually
  runtime-observed;
- Telegram Where invalid/residual behavior: `test-backed`;
- Telegram Incoming no-final clarity: `code-inspected`;
- stale cached job confusion: `docs-only` plus code-inspected risk, not
  runtime-observed.

## Known Gaps

### 1. Telegram lacks full live progress for long targeted indexing

Admin can show pages, budgets, locks, state counts and provider errors for
ordinary Where targeted waits.

Telegram cannot yet show the same product-level progress. Generic status only
shows job id/status/window/last error unless the job already has a persisted
Where result.

This now includes candidate-window progress too. Admin can distinguish
candidate windows from broad fallback; Telegram does not yet have an equivalent
plain-language progress surface for that subphase.

This is already documented as a known gap.

### 2. Incoming does not have Where-level resumable progress UX

Incoming deposit has job phases and final report data, but not the same
targeted wait/resume progress model exposed in Admin.

This mirrors the backend gap: Incoming is not wired to the shared resumable
targeted indexing flow yet.

### 3. Incoming no-final alert is less explicit than Where no-final report

Where invalid final report explicitly shows:

```text
Decision: NO_FINAL_DECISION
Blocked reason
Technical status
Coverage
```

Incoming alert formatter shows `Decision`, risk score/band, reasons and checks.
It does not have a separate technical block section.

If an Incoming report has `scoreValid=false`, this can make the user-facing
message less clear than the underlying report data.

### 4. Generic job status says `Deep forensic status`

The generic status formatter is reused for non-Deep jobs and malformed fallbacks
but still uses DeepCheck wording.

This is not a core forensic bug, but it creates avoidable confusion.

### 5. Old cached job versus fresh run is still not first-class in UI

Knowledge docs explicitly say Admin should distinguish old cached jobs from
fresh live runs more clearly.

The current job summary has timestamps, job id and status. That helps, but it
does not fully solve the product problem. An analyst can still compare an old
historical result and a fresh run without an obvious "freshness" affordance.

### 6. Raw codes remain visible in some user-facing paths

Where no-final report now exposes raw blocked reason and technical status, but
with some explanation.

Incoming and generic status paths can still surface raw codes or sparse
technical messages without the same plain-language wrapper.

### 7. Admin console tests are source-level, not visual runtime checks

Admin console behavior is heavily tested by checking generated HTML/JS
snippets. That is useful and fast, but it does not prove layout readability in
a real browser for dense graphs.

No browser visual QA was run in this pass.

## Risks / Failure Modes

### User mistakes technical stop for risk verdict

If Telegram shows `NO_FINAL_DECISION`, `provider_cap_unresolved` or
`History not fully fetched` without enough plain-language explanation, user can
read it as "address is bad" or "system declined".

Where final report mostly handles this. Incoming/generic status are weaker.

### Analyst mistakes hidden evidence for absent evidence

Compact graph views can hide nodes/edges. The visible/total/hidden counters
reduce this risk. Full evidence mode also helps.

Residual risk remains if analysts do not notice the counters or if dense graphs
are visually hard to inspect.

### Analyst mistakes old job for fresh result

Job timestamps and ids exist, but old cached jobs are not visually separated
enough. This matters because old targeted states and old partial results can
carry stale coverage assumptions.

### Generic fallback downgrades product clarity

If a specialized formatter cannot parse a result, the system falls back to a
generic status message. That is safer than crashing, but the fallback can lose
mode-specific explanation and currently uses DeepCheck wording.

### Incoming alert shows score/band alongside no-final decision

If an incoming report has `NO_FINAL_DECISION` but still includes
`depositRiskScore` and `riskBand`, the alert may look contradictory unless the
technical block is explicit.

This needs a product decision: should no-final Incoming suppress the risk line,
or show it as preliminary/diagnostic?

## What To Keep As-Is

Keep Admin as diagnostic workbench.

The current Admin surface is allowed to expose raw codes, technical status,
progress counters and detailed graph metadata. That is the right role for an
analyst console.

Keep waiting Where progress graph.

Returning a progress graph with `UNKNOWN` decision and `riskScore=null` is much
better than `409 not_ready` or a misleading final result.

Keep candidate-window progress distinct from broad targeted progress. It avoids
showing broad fallback as active while only narrow candidate proof windows are
being checked.

Keep `WAITING: TARGETED INDEX` job card status.

It solves a real operator problem: queued-looking jobs that are actually alive
and waiting on background index work.

Keep visible/total/hidden graph counters.

They protect against false "no evidence" readings in compact views.

Keep Full evidence mode.

It gives analysts a way to bypass local hiding filters when they need the full
payload.

Keep funding candidate proof-class categories.

Exact/probable/caveat/service-boundary distinctions are central to honest
forensic UX.

Keep Telegram Where no-final report.

It is the right user-facing shape for invalid forensic score.

Keep separate support/debug formatter.

It gives support enough details without forcing normal users to read every raw
technical field.

## Improvement Ideas

### 1. Add Telegram progress for waiting targeted indexing

A minimal useful Telegram progress message could show:

- current phase;
- waiting hop address;
- whether the phase is candidate-window checking or broad targeted indexing;
- pages fetched / budget;
- oldest reached date;
- provider errors;
- "still indexing, final score not ready".

This does not need Admin-level density. It just needs to avoid silence.

### 2. Add explicit Incoming no-final technical block

When `IncomingDepositRiskReport.scoreValid === false`, alert formatting could
show a dedicated block:

```text
No final decision
Blocked reason: ...
Technical status: ...
What happens next / why score is blocked
```

It may also suppress or relabel the risk score as preliminary/diagnostic.

### 3. Rename generic status formatter

Change generic title from:

```text
Deep forensic status
```

to something mode-aware:

```text
Forensic job status
Where is money status
Incoming deposit status
DeepCheck status
```

This is small and likely high-value.

### 4. Add freshness indicators in Admin

Admin could show:

- job age;
- completed at;
- "latest job for this address" marker;
- "older cached result" marker;
- fresh run id after start buttons.

This would address the stale cached job risk directly.

### 5. Make job-start feedback more explicit

When Admin starts a job, show:

- address used;
- job kind;
- queued job id;
- link to graph/status;
- whether this is a fresh run or existing cached job.

This is in knowledge docs as a planned UX improvement.

### 6. Add visual browser QA for Admin graph modes

Source-level tests are good, but dense graph UI needs occasional browser QA:

- waiting progress graph;
- full evidence DeepCheck;
- route-focused Where;
- incoming flow map;
- residual caveat lane;
- hidden-by-view counters.

This audit did not run browser screenshots.

## Questions For You

1. Для Telegram Incoming no-final case: показываем ли risk score/band как
   diagnostic/preliminary, или скрываем risk line до valid score?

2. Нужно ли сделать Telegram progress для ordinary Where targeted indexing
   ближайшим implementation candidate, или пока достаточно Admin progress?

3. Generic status title `Deep forensic status` для non-Deep jobs считаем
   мелкой polish-задачей или важным confusion bug?

4. Какие freshness markers тебе важнее в Admin: latest-job badge, job age,
   explicit "old cached result", или start-confirmation with queued job id?

5. Должен ли Admin visual QA стать обязательной проверкой после изменений graph
   rendering, или достаточно текущих source-level tests до следующего UI pass?

## Section Verdict

Admin UX по ordinary Where и graph evidence выглядит сильнее, чем Telegram UX.

Что хорошо:

- Admin показывает waiting targeted indexing как progress, not stuck;
- graph endpoint возвращает progress graph с `UNKNOWN` и `riskScore=null`;
- targeted progress, provider counters, locks and states visible;
- full evidence mode and visible/total/hidden counters reduce false hiding;
- funding-first candidates keep exact/probable/caveat boundaries;
- residual materiality caveat no longer looks like terminal failure;
- Telegram Where no-final and residual REVIEW flows are protected by tests.

Что слабее:

- Telegram does not yet have rich live progress for long indexing;
- Incoming no-final UX is less explicit than Where no-final UX;
- generic status still uses DeepCheck wording;
- stale cached vs fresh run remains mostly an analyst discipline problem, not a
  first-class UI affordance;
- Admin visual behavior was not browser-observed in this audit pass.

Мой текущий verdict:

```text
keep Admin's current diagnostic architecture; improve Telegram no-final/progress
copy and add clearer freshness/status affordances before treating UX as fully
settled.
```

Delta verdict after candidate-window-first update:

```text
keep the new Admin candidate-window progress distinction; Telegram still needs
a simpler explanation for long Where subphases if users will wait on these jobs.
```

## Evidence Appendix

Knowledge docs read:

- `docs/knowledge/AGENT_BRIEF.md`
- `docs/knowledge/02-check-modes.md`
- `docs/knowledge/03-job-lifecycle.md`
- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/07-risk-scoring-matrix.md`
- `docs/knowledge/08-admin-and-bot-ux.md`
- `docs/knowledge/09-current-decisions.md`
- `docs/knowledge/10-open-problems.md`
- `docs/knowledge/11-glossary.md`
- `docs/knowledge/13-agent-observations.md`

Code paths inspected:

- `src/admin/adminServer.ts`
- `src/admin/adminConsole.ts`
- `src/admin/forensicsGraph.ts`
- `src/admin/whereFundingCandidateVisibility.ts`
- `src/forensics/candidateWindowTargeting.ts`
- `src/forensics/targetedHistoryCoordinator.ts`
- `src/bot/createBot.ts`
- `src/alerts/formatters.ts`
- `src/forensics/incomingDepositJob.ts`

Focused tests run:

```text
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts tests/admin/whereFundingCandidateVisibility.test.ts tests/alerts/formatters.test.ts tests/bot/createBot.test.ts tests/forensics/incomingDepositJob.test.ts
```

Result:

```text
7 test files passed
541 tests passed
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

Runtime observation for this delta:

```text
Admin /admin/forensics returned HTTP 200 from the local live process.
```
