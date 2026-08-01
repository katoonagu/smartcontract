---
status: draft
audit_type: knowledge_deep_audit
scope: scoring walkthrough
created: 2026-07-04
---

# Scoring Walkthrough

## What This Area Does

Этот раздел объясняет scoring layer: как система превращает forensic facts,
coverage state и policy evidence в score, risk level и user-facing decision.

Scoring не собирает данные и не строит money paths. Он получает уже
подготовленные факты:

- Fast Check signals;
- DeepCheck profiles;
- Where is money report;
- Incoming deposit fresh-bundle context;
- coverage/progress state;
- hard evidence, source policy, contract suspicion, behavior context,
  dampeners и caveats.

Задача scoring - решить, можно ли публиковать финальный риск, и если можно,
какой именно:

```text
confirmed evidence + coverage state -> score + level + user-facing decision
```

Главная дисциплина этого слоя:

```text
weak context != hard evidence
missing data != clean result
technical block != risk verdict
REVIEW != DECLINE
```

## Why It Exists

Без отдельного scoring layer проект быстро смешал бы разные типы сигналов:

- exact approval-drain proof;
- source-policy decline;
- historical transit pattern;
- behavior-only suspicion;
- clean/operational context;
- provider cap;
- stale or partial coverage.

У этих сигналов разная сила. Scoring нужен, чтобы:

- не дать слабому контексту стать `DECLINE`;
- не дать dampener снизить hard proof;
- не считать техническую остановку нормальным финальным результатом;
- показать пользователю `NO_FINAL_DECISION`, когда score нельзя использовать;
- сохранить `REVIEW`, если evidence недостаточно для финального decline;
- отделить forensic uncertainty от product verdict.

Это особенно важно для `Where is money` и `Incoming deposit`, потому что там
вопрос не просто "есть ли риск на адресе", а "можем ли мы объяснить
происхождение конкретных средств".

## Main User/Product Question

Scoring отвечает на несколько связанных вопросов.

Для analyst/user:

```text
Можно ли доверять этому итоговому score и decision?
```

Для `Where is money`:

```text
Достаточно ли доказан источник средств, чтобы принять, review или decline?
```

Для unified `/check`:

```text
Как объединить Fast Check, DeepCheck и Where is money без размывания сильных
доказательств и без превращения слабых сигналов в hard verdict?
```

Для `Incoming deposit`:

```text
Можно ли принять конкретный deposit, или свежий source-of-funds context требует
decline/no-final-decision?
```

Для технических ограничений:

```text
Если provider cap, rate limit или incomplete targeted coverage мешают
проверке, что должен увидеть пользователь: score, REVIEW или no final decision?
```

## End-To-End Flow

### 1. Evidence приходит из режимов

Scoring не начинает с нуля. Он получает входные данные из других слоев.

Fast Check дает быстрые labels, blacklist, simple risk reasons и иногда hard
evidence вроде active USDT blacklist или exact scam label.

DeepCheck дает более широкий forensic context: service exposure, operational
flow, asset continuation, address behavior, stablecoin restrictions,
inbound provenance и missing checks.

Where is money дает самый важный source-of-funds report: `originPaths`,
coverage, hard bad evidence, source policy evidence, contract verdicts,
materiality summary и `scoreValid`.

Incoming deposit добавляет deposit-scoped context: конкретный sender, receiver,
tx hash, amount, fresh bundle exposure и targeted coverage по mandatory hops.

Candidate-window-first indexing changes the quality of Where provenance input,
not the scoring contract. A completed `candidate_window` can help
funding-first logic upgrade a `probable` source to `exact`, but scoring should
still react to the resulting proof class and coverage validity. The window
itself is not a new scoring row and not hard evidence by name.

### 2. Where сначала делает свой operational assessment

`Where is money` строит `WhereIsMoneyAssessment`.

В этом assessment появляются:

- `decision` как internal exchange decision;
- `riskScore`;
- `riskBand`;
- `hardBadEvidence`;
- `sourcePolicyEvidence`;
- `riskLayers`;
- `warnings`;
- `scoreValid`;
- `scoreBlockedReason`;
- `technicalStatus`;
- `sourceProvenanceMateriality`.

Ключевая логика здесь: если найдено deterministic hard bad evidence, оно имеет
приоритет. Incomplete coverage может быть warning, но hard evidence не
обнуляется из-за missing data.

Если hard evidence нет, а есть guarded approval review и неполная hop history,
система различает два случая:

- residual unresolved source ниже materiality - score остается usable,
  `scoreValid=true`, `technicalStatus=completed`, decision остается `REVIEW`;
- material unresolved source или серьезный coverage block - score становится
  unusable: `scoreValid=false`, `scoreBlockedReason=insufficient_coverage`,
  `technicalStatus=provider_cap_unresolved`.

Это хорошая граница. Она не превращает маленький остаточный gap в технический
block, но и не публикует final score, если missing coverage materially affects
the answer.

### 3. Where report переносит score validity наружу

`WhereIsMoneyReport` копирует score validity из assessment:

- `scoreValid`;
- `scoreBlockedReason`;
- `technicalStatus`;
- `sourceProvenanceMateriality`.

Также report строит пару решений:

- `internalDecision` - внутренний `ACCEPTABLE`/`REVIEW`/`DECLINE`;
- `userDecision` - пользовательский decision, где invalid score превращается в
  `NO_FINAL_DECISION`.

То есть если assessment говорит `scoreValid=false`, пользовательский слой не
должен видеть обычный `REVIEW` или `DECLINE` как финальный verdict. Он должен
видеть no-final technical state.

### 4. Job runner может завершить работу техническим no-score result

Если targeted history не покрыта и индексатор дошел до terminal provider/safety
state, job runner сохраняет result в snake_case:

```text
score_valid=false
score_blocked_reason=...
technical_status=...
```

Это может быть `provider_cap_unresolved`, `rate_limited_after_retries`,
`provider_inconsistent`, `partial_budget_exhausted` или
`hard_safety_limit_exceeded`.

Важно: такой job может иметь `status=failed`, но product-смысл не "адрес
плохой". Это техническое состояние: система не смогла честно опубликовать
финальный forensic score.

### 5. Unified wallet risk строится через Scoring Signal Matrix

Unified scoring берет Fast, Deep и Where и строит `MatrixCandidate[]`.

Кандидаты раскладываются по rows:

- `hard_proof`;
- `source_policy`;
- `incoming_deposit_source_policy`;
- `service_linked_pattern`;
- `route_linked_approval_pattern`;
- `asset_continuation`;
- `typology_subgraph_pattern`;
- `contract_suspicion`;
- `counterparty_context`;
- `behavior_only_prior`;
- `coverage_uncertainty`;
- `clean_or_operational`.

Matrix делает несколько важных вещей:

- caps `coverage_uncertainty` до no-badness state;
- caps behavior-only evidence ниже decline threshold;
- caps contract suspicion ниже decline threshold;
- caps typology-only pattern ниже decline threshold, если нет anchor;
- deduplicates candidates по evidence episode;
- выбирает winning row по score и row priority;
- возвращает `policyScore`, `matrixDecision`, `winningRow`, `riskVector` и
  `uncertaintyState`.

Сейчас `queuePriorityScore` и `calibratedRiskProbability` возвращаются как
`null`. Это честно: calibration layer еще не реализован как реальная
вероятность.

### 6. Legacy weighted/floor/dampener layer все еще считается

В unified wallet risk также считаются:

- weighted layer score;
- hard evidence floor;
- policy floor;
- asset continuation floor;
- pattern floor;
- dampener;
- coverage level;
- active anchor;
- no-hard-evidence critical cap.

Но текущий final score и final decision в unified wallet path берутся из
matrix path:

```text
finalScore = matrix policyScore or special residual-materiality fallback
finalDecision = matrix decision, unless scoreValid=false or residual REVIEW fallback
```

Это важный момент для чтения кода и UI. В результате report может содержать
legacy/floor/dampener breakdown, но продуктовый итог уже определяется
Scoring Signal Matrix.

### 7. Incoming deposit добавляет deposit-scoped overlay

Incoming deposit использует базовый unified forensic risk для sender, но затем
добавляет deposit-scoped candidates:

- fresh risky-label source;
- fresh HTX/Huobi source;
- fresh bridge/router/DEX source;
- unknown contract fresh source;
- HTX/Huobi corridor context;
- service corridor context;
- wallet exposure background score.

Если fresh source достаточно сильный, matrix может дать deposit-scoped
`DECLINE`. Если coverage по mandatory hops заблокирована, incoming report
ставит:

```text
decision=NO_FINAL_DECISION
scoreValid=false
scoreBlockedReason=...
technicalStatus=...
```

Incoming также наследует invalid state от Where. Если underlying Where report
`scoreValid=false`, incoming не должен публиковать final deposit decision.

### 8. Admin и Telegram должны показывать technical block как technical block

Admin извлекает summaries из `strictProvenance`, `targetedIndex` и job result.
Там отдельно показываются:

- score validity;
- blocked reason;
- technical status;
- provider cap terminal state;
- targeted index state.

For candidate-window-first Where runs, Admin may show
`targetedIndex.phase=checking_candidate_windows`. Scoring should still treat
that as pending/no-final progress. It is not a score state and it does not make
`probable` evidence hard.

Telegram для unified address final report сначала проверяет:

```text
whereScoreValid(report) === false
```

Если score invalid, formatter уходит в отдельный no-final-decision report и
показывает:

- `Decision: NO_FINAL_DECISION`;
- blocked reason;
- technical status;
- coverage explanation.

Это правильная UX-граница: raw технические коды допустимы как diagnostic
detail, но они не должны выглядеть как обычный risk verdict.

## Important Data Structures / States

### Decision types

`ExchangeDecision`:

```text
ACCEPTABLE | REVIEW | DECLINE
```

Это внутренний exchange-style decision.

`UserExchangeDecision`:

```text
ACCEPTABLE | REVIEW | DECLINE | NO_FINAL_DECISION
```

Это decision, который может быть показан пользователю. `NO_FINAL_DECISION`
нужен именно для technical no-score cases.

`IncomingDepositDecision`:

```text
ACCEPTABLE | DECLINE | NO_FINAL_DECISION
```

У Incoming сейчас нет отдельного `REVIEW` в deposit decision type. Контекстный
риск может жить в score/risk band/reasons, но top-level decision у deposit
сводится к accept, decline или no-final. Это стоит подтвердить как осознанную
product policy.

### Score validity

`ForensicScoreValidity` содержит:

```text
scoreValid?: boolean
scoreBlockedReason?: ForensicScoreBlockedReason | null
technicalStatus?: ForensicTechnicalStatus | null
```

Важная деталь: `scoreValid` optional. В большинстве consumer-логики именно
`scoreValid === false` считается invalid state. Отсутствующее значение обычно
ведет себя как "не заблокировано".

Это удобно для backward compatibility, но создает риск: если новый path забудет
явно поставить `scoreValid=false`, partial coverage может пройти дальше как
usable score.

### Blocked reasons

Поддерживаемые blocked reasons:

```text
insufficient_coverage
partial_budget_exhausted
provider_error
rate_limited_after_retries
provider_inconsistent
provider_cap_unresolved
hard_safety_limit_exceeded
```

Они отвечают на вопрос "почему score нельзя использовать".

### Technical statuses

Поддерживаемые technical statuses:

```text
completed
budget_limited
provider_error
provider_limited
provider_cap_unresolved
hard_safety_limit_exceeded
```

Они отвечают на вопрос "в каком техническом состоянии завершилась проверка".

### Matrix candidate/result

`MatrixCandidate` хранит:

- row;
- action unit;
- score;
- decision eligibility;
- evidence ids;
- episode ids;
- atomic signals;
- modifiers;
- caps;
- dampeners;
- caveats.

`MatrixScoringResult` хранит:

- `policyVersion`;
- `policyScore`;
- `matrixDecision`;
- `winningRow`;
- `actionUnit`;
- `riskVector`;
- `uncertaintyState`;
- `queuePriorityScore`;
- `calibratedRiskProbability`.

Главная идея matrix: scoring decision должен зависеть не только от числа, но и
от класса evidence. Один и тот же score от hard proof и behavior-only prior не
равны по силе.

### Source provenance materiality

`sourceProvenanceMateriality` объясняет, что именно произошло с unresolved
source provenance.

Возможные outcomes:

- `residual_unresolved_below_materiality`;
- `material_unresolved_source`;
- `unresolved_source_with_hard_evidence`.

Это важный мост между forensic logic и scoring. Он позволяет не блокировать
score из-за tiny residual gap, но блокировать или усиливать результат, если gap
material или содержит hard evidence.

## What The Knowledge Docs Claim

Knowledge docs задают такую политику:

- score должен отражать силу evidence;
- incomplete data must not be treated as clean;
- technical stop is not a risk verdict;
- hard evidence can drive strong decision;
- weak context should stay bounded;
- `REVIEW` must not become false `DECLINE`;
- if `score_valid=false`, consumers must not use the score as a final forensic
  result;
- invalid score should include blocked reason, technical status and
  coverage/progress details;
- old/cached job evidence must not be confused with fresh proof;
- residual unresolved below materiality can remain valid and visible as caveat;
- provider cap or mandatory missing targeted coverage can require
  `NO_FINAL_DECISION`.

The docs also describe floors and dampeners:

- hard evidence floor;
- policy floor;
- asset continuation floor;
- pattern floor;
- dampeners for trusted/clean/regular operational context.

The important product meaning is not "always raise score". It is "strong
evidence should not be diluted, weak evidence should not overclaim, and
coverage uncertainty should remain visible".

## What The Code Appears To Implement

### Strongly implemented

The code implements explicit no-score states for important targeted coverage
failures.

`WhereIsMoneyAssessment` can set `scoreValid=false`, blocked reason and
technical status. `WhereIsMoneyReport` propagates those fields. Unified report
formatting and job result JSON preserve them.

Incoming deposit also propagates invalid Where state and its own targeted
coverage block into `NO_FINAL_DECISION`.

Telegram has a separate final-report path for invalid Where score.

Admin exposes strict provenance and targeted index summaries, including
score validity and technical status.

### Scoring Signal Matrix is the current final decision engine

The unified wallet path still calculates legacy weighted layers, floors and
dampeners. But final score and final decision are currently based on matrix
output, with only a special fallback for residual unresolved below materiality.

This is a meaningful architecture decision. It makes final scoring more
evidence-class-aware, but it also means some legacy breakdown fields can be
diagnostic rather than decisive.

### Coverage uncertainty is modeled, but not always user-blocking

Matrix has a `coverage_uncertainty` row. It intentionally does not create
badness:

```text
coverage_uncertainty -> policyScore=null -> matrixDecision=INSUFFICIENT_EVIDENCE
```

However, in unified wallet risk, `INSUFFICIENT_EVIDENCE` does not automatically
become `NO_FINAL_DECISION`. If `whereReport.scoreValid` is not explicitly
`false`, the final decision can become `ACCEPTABLE` with final score `0`.

Tests currently assert this behavior for limited/partial coverage cases.

This is the most important scoring audit point in this section. It may be
intentional product policy for "no bad evidence found, but coverage caveats are
shown". It may also conflict with the knowledge invariant "missing data is not
clean", depending on how final UI presents the result.

### Hard evidence remains protected

Hard evidence paths are protected in several ways:

- hard proof rows can decline;
- hard evidence floor stays high;
- dampeners do not reduce policy or asset-continuation floors in tested cases;
- active USDT blacklist remains critical;
- exact approval-drain provenance remains critical;
- unresolved residual path with hard evidence is not downgraded into a tiny
  materiality caveat.

This part looks solid and test-backed.

### Weak context is bounded

Behavior-only evidence and contract suspicion are capped below decline threshold
by matrix rules. Typology-only pattern without anchor is also capped below
decline threshold.

This matches the product policy: weak context may produce review/context, but
should not become deterministic decline by itself.

### Incoming deposit has a stricter top-level decision shape

Incoming deposit uses matrix source-policy candidates for fresh deposit-scoped
source exposure. Strong fresh risky label or strong HTX/Huobi exposure can
decline.

But top-level `IncomingDepositDecision` has no `REVIEW`. Non-decline matrix
outcomes become `ACCEPTABLE`, unless score is invalid and becomes
`NO_FINAL_DECISION`.

That might be fine if product wants deposit decisions to be binary plus
technical block. It is still worth confirming, because risk bands/reasons may
show medium context while top-level decision says acceptable.

## What Is Confirmed Vs Not Confirmed

### Confirmed By Docs And Code Inspection

Confirmed:

- `scoreValid=false` is the explicit contract for unusable forensic score.
- Where report propagates score validity from assessment.
- User-facing Where decision becomes `NO_FINAL_DECISION` when score invalid.
- Targeted provider terminal states are mapped to blocked reason and technical
  status.
- Incoming deposit inherits invalid Where and targeted coverage blocks.
- Matrix caps coverage uncertainty so it does not create badness.
- Matrix caps behavior-only and contract suspicion below decline threshold.
- Unified wallet final score/decision currently use matrix output, not legacy
  weighted/floor final score.
- Telegram has separate invalid-score final output.
- Admin exposes targeted/strict technical scoring summaries.
- Candidate-window progress is diagnostic/progress state; scoring still depends
  on whether provenance becomes `exact`, remains `probable`, or blocks score.

### Confirmed By Tests

Focused scoring tests passed:

```text
9 test files passed
600 tests passed
```

The test set covered:

- Scoring Signal Matrix behavior;
- matrix candidate inputs;
- unified wallet risk;
- operational assessment materiality;
- Where is money report behavior;
- Incoming deposit invalid-score behavior;
- Deep forensic job no-score result JSON;
- Admin graph projection;
- Telegram formatting.

Specific behaviors confirmed by tests:

- `coverage_uncertainty` produces `INSUFFICIENT_EVIDENCE` and no policy score.
- behavior-only evidence is capped below decline.
- contract suspicion is capped below decline.
- source-policy evidence can decline when eligibility and score allow it.
- invalid Where score preserves `NO_FINAL_DECISION`.
- residual unresolved below materiality keeps score valid.
- material unresolved source blocks score.
- hard evidence inside unresolved source is not downgraded.
- no-score Telegram report includes decision, blocked reason and technical
  status.

### Not Runtime-Observed In This Pass

Not confirmed by live runtime in this section:

- real TronScan/provider behavior under current live limits;
- a fresh end-to-end provider-cap run from API to Telegram message;
- Admin browser rendering for all no-score states;
- whether analysts interpret `ACCEPTABLE + coverage uncertainty` correctly in
  the live UI;
- calibration quality of score thresholds.

So confidence for the main code behavior is `test-backed`. Confidence for live
provider UX is `code-inspected`, not runtime-observed.

## Known Gaps

### 1. `INSUFFICIENT_EVIDENCE` can become user-facing `ACCEPTABLE`

This is the main conceptual gap.

Matrix can say:

```text
matrixDecision=INSUFFICIENT_EVIDENCE
policyScore=null
```

Unified wallet risk can then return:

```text
finalScore=0
finalDecision=ACCEPTABLE
```

when `whereReport.scoreValid !== false` and the residual-materiality REVIEW
fallback does not apply.

Tests currently lock this in.

This may be intentional. But from an audit perspective it needs a product
decision because it sits close to the forbidden interpretation:

```text
missing data -> clean result
```

If the UI clearly says "acceptable because no bad evidence, but coverage was
insufficient", it may be acceptable. If the UI only emphasizes
`ACCEPTABLE / LOW / 0`, it is risky.

### 2. `scoreValid` is optional

Only explicit `scoreValid=false` blocks final scoring.

That gives backward compatibility, but it means every new path must remember to
set invalid score explicitly. A missing field is not the same as
`scoreValid=true`, but many consumers effectively treat it as usable.

This is a recurring risk at mode boundaries and job result boundaries.

### 3. Snake_case and camelCase scoring fields coexist

Reports/progress use camelCase:

```text
scoreValid
scoreBlockedReason
technicalStatus
```

Job result JSON can use snake_case:

```text
score_valid
score_blocked_reason
technical_status
```

Admin handles both in several places. That is practical, but fragile. New
consumers can easily miss one representation.

### 4. Terminal status mapping is duplicated

Targeted history terminal mapping appears in multiple areas:

- general targeted history coordinator;
- incoming deposit targeted coverage block;
- deep job strict/targeted failure handling.

The mappings are close, but duplication means future status additions can drift.

### 5. Legacy scoring breakdown can confuse readers

`calculateUnifiedWalletRisk` still exposes weighted score, floors, dampener and
legacy cap metadata. These are useful diagnostics, but final score is currently
matrix-based.

This can confuse both engineers and analysts if UI/docs do not clearly separate:

```text
diagnostic breakdown != final decision engine
```

### 6. Incoming deposit has no top-level `REVIEW`

`IncomingDepositDecision` supports only:

```text
ACCEPTABLE | DECLINE | NO_FINAL_DECISION
```

So a medium contextual deposit can be represented through risk band/reasons, but
not as top-level `REVIEW`.

This may be deliberate. It still deserves confirmation because product language
around deposits may need an analyst-review state.

### 7. Calibration outputs are placeholders

Matrix returns:

```text
queuePriorityScore=null
calibratedRiskProbability=null
```

This is better than fake precision, but downstream readers should understand
that current score is policy score, not calibrated probability.

## Risks / Failure Modes

### False clean result from coverage uncertainty

If a result has insufficient coverage but no explicit `scoreValid=false`, the
final unified decision can be `ACCEPTABLE`. The risk is not in the matrix row
itself; the matrix correctly says insufficient evidence. The risk is in the
final mapping from insufficient evidence to acceptable.

### False decline from weak context

This is mostly controlled by matrix caps. Behavior-only and contract suspicion
are capped below decline. Still, new candidate rows must preserve this rule.

### Technical block hidden behind generic failure

A job can be `failed` for technical no-score reasons. If a consumer looks only
at job status, it may misread the result. Consumers must read
`score_valid/scoreValid`, blocked reason and technical status.

### Stale DB result mistaken for fresh scoring proof

Scoring fields are only meaningful for the run that produced them. If Admin or
support compares old cached job result with a new run, old `score_valid=true`
or old no-score state can mislead. This is more lifecycle/UX than scoring
math, but scoring fields are part of the risk.

### Materiality threshold misunderstood as clean proof

Residual unresolved below materiality means "not blocking final score", not
"the residual source is proven clean". The caveat should stay visible.

### Dampener applied to wrong evidence class

Current tested behavior protects hard evidence and floors. New scoring
extensions must keep dampeners away from deterministic proof and source-policy
floors.

## What To Keep As-Is

Keep explicit `scoreValid=false` contract.

It is the right abstraction. It lets the system say "we cannot score this
honestly" without pretending that provider limits are risk evidence.

Keep `NO_FINAL_DECISION`.

This is cleaner than overloading `REVIEW` or `DECLINE` for technical states.

Keep Scoring Signal Matrix as evidence-class-aware decision layer.

The row model is more readable than pure weighted scoring. It makes it easier
to explain why hard proof, source policy, behavior context and coverage
uncertainty are not interchangeable.

Keep caps for behavior-only, contract suspicion and unanchored typology.

These caps directly protect against overclaiming.

Keep residual materiality handling.

The split between residual below materiality and material unresolved source is
pragmatic and matches the real product need.

Keep hard evidence protection.

Hard proof should not be dampened away by clean-role context or regular
activity heuristics.

Keep Telegram's separate invalid-score final report.

That is the correct user-facing shape for technical no-score states.

## Improvement Ideas

### 1. Decide final mapping for matrix `INSUFFICIENT_EVIDENCE`

This is the highest-value product decision.

Options:

- keep current behavior: `ACCEPTABLE / 0` with clear coverage caveats;
- map insufficient evidence to `REVIEW`;
- map certain insufficient evidence states to `NO_FINAL_DECISION`;
- split coverage uncertainty into soft caveat vs hard mandatory blocker.

The current code already has the raw signal. The question is product semantics.

### 2. Make score validity less ambiguous in new reports

For new report types, prefer explicit:

```text
scoreValid=true
```

instead of relying on undefined-as-usable.

Backward compatibility can remain, but new outputs should be explicit.

### 3. Centralize technical status mapping

Create one shared mapping from provider/index status reason to:

```text
scoreBlockedReason + technicalStatus
```

This would reduce drift between Where, Incoming, targeted history and strict
provenance paths.

### 4. Label legacy breakdown as diagnostic

In docs and maybe Admin UI, clearly label weighted/floor/dampener fields as
diagnostic when final score is matrix-based.

This prevents readers from asking why `contextScore=30` but `finalScore=0`, or
why a floor exists but matrix final score is different.

### 5. Consider top-level `REVIEW` for Incoming deposit

If analysts need a middle state for deposit-specific context, consider adding
`REVIEW` to `IncomingDepositDecision`.

If product deliberately wants deposits to be accept/decline/no-final only, keep
the current shape and document it explicitly.

### 6. Add a compact scoring decision ledger

For future audit/debug work, it would help to have a single generated/debug
object that says:

```text
why final decision is X
which engine decided it
which candidates were ignored or capped
whether score validity was explicit or inferred
```

The existing `matrixScore` and `scoreBreakdown` are close, but a short
human-readable ledger would make support/debugging easier.

## Questions For You

1. Когда matrix возвращает `INSUFFICIENT_EVIDENCE`, но explicit
   `scoreValid=false` нет, должен ли final user decision быть `ACCEPTABLE`,
   `REVIEW` или `NO_FINAL_DECISION`?

2. Для Incoming deposit нужен ли top-level `REVIEW`, или текущая модель
   `ACCEPTABLE | DECLINE | NO_FINAL_DECISION` правильная?

3. Хотим ли мы считать `scoreValid` обязательным explicit field для всех новых
   forensic/scoring reports?

4. Достаточно ли показывать coverage uncertainty в Data trust/Limitations, если
   главный decision при этом `ACCEPTABLE`?

5. Нужно ли в Admin/Telegram явно писать, что `finalScore` сейчас matrix policy
   score, а weighted/floor/dampener breakdown является diagnostic metadata?

## Section Verdict

Scoring architecture стала заметно более дисциплинированной, чем простой
weighted score. Сильные части:

- explicit no-score contract;
- `NO_FINAL_DECISION`;
- evidence-class-aware Scoring Signal Matrix;
- caps for weak context;
- hard evidence protection;
- materiality-aware residual handling;
- technical no-score propagation into Admin and Telegram.

Главный риск не в hard-evidence scoring. Он выглядит хорошо покрытым.

Главный риск в semantics coverage uncertainty:

```text
INSUFFICIENT_EVIDENCE can still become ACCEPTABLE / 0
```

Это может быть правильной продуктовой политикой, но тогда ее нужно явно
подтвердить и очень аккуратно показывать в UI. Если же принцип "missing data is
not clean" должен быть жестким, это место требует отдельного implementation
plan.

Candidate-window-first indexing reduces some cases that would otherwise remain
`probable` or incomplete, but it does not remove this scoring question. If all
candidate windows finish and proof remains incomplete, the same
insufficient-evidence/no-final decision policy still applies.

Мой текущий verdict:

```text
keep the current scoring architecture, but review the insufficient-evidence to
acceptable mapping before calling scoring policy fully settled.
```

## Evidence Appendix

Knowledge docs read:

- `docs/knowledge/AGENT_BRIEF.md`
- `docs/knowledge/02-check-modes.md`
- `docs/knowledge/03-job-lifecycle.md`
- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/06-deepcheck.md`
- `docs/knowledge/07-risk-scoring-matrix.md`
- `docs/knowledge/08-admin-and-bot-ux.md`
- `docs/knowledge/09-current-decisions.md`
- `docs/knowledge/10-open-problems.md`
- `docs/knowledge/11-glossary.md`
- `docs/knowledge/13-agent-observations.md`

Code paths inspected:

- `src/types.ts`
- `src/forensics/moneyOriginOperationalAssessment.ts`
- `src/check/whereIsMoneyCheck.ts`
- `src/risk/scoringSignalMatrix.ts`
- `src/risk/scoringSignalMatrixInputs.ts`
- `src/risk/unifiedWalletRisk.ts`
- `src/risk/unifiedIncomingDepositRisk.ts`
- `src/forensics/targetedHistoryCoordinator.ts`
- `src/forensics/candidateWindowTargeting.ts`
- `src/forensics/deepForensicJob.ts`
- `src/forensics/incomingDepositJob.ts`
- `src/admin/forensicsGraph.ts`
- `src/bot/createBot.ts`

Focused tests run:

```text
npm test -- tests/risk/scoringSignalMatrix.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/unifiedWalletRisk.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/deepForensicJob.test.ts tests/admin/forensicsGraph.test.ts tests/bot/createBot.test.ts
```

Result:

```text
9 test files passed
600 tests passed
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
