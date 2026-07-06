---
status: draft
audit_type: knowledge_deep_audit
scope: open questions and improvement ideas
created: 2026-07-04
---

# Open Questions And Improvement Ideas

## What This File Does

Этот файл собирает решения, вопросы и идеи улучшений из walkthrough-разделов
`01`-`07`.

Он не является implementation plan. Здесь фиксируется, что мы уже считаем
здоровым и что требует отдельного решения перед кодовыми изменениями.

Цель файла:

- не потерять решения "оставить как есть";
- не смешать bugs, product questions and polish ideas;
- не превращать каждую идею в срочную задачу;
- явно отделить confirmed behavior от docs-only assumptions;
- подготовить shortlist следующих implementation plans.

## Reading Rules

Use this file as a ledger.

Each item has:

- area;
- status;
- current understanding;
- confidence;
- suggested next action.

Status values:

- `keep as-is`;
- `document better`;
- `improve later`;
- `needs product decision`;
- `candidate for implementation`;
- `needs runtime observation`.

Confidence values:

- `docs-only`;
- `code-inspected`;
- `test-backed`;
- `runtime-observed`.

## Keep As-Is Decisions

### 1. Keep Check Modes Separate

Status: `keep as-is`

Area: check modes, scoring, UX

Current understanding:

Fast Check, DeepCheck, Where is money, Incoming deposit and unified `/check`
answer different product questions. They can share infrastructure, but they
should not collapse into one "full check" mode.

Why keep it:

- Fast Check is a quick risk snapshot, not source-of-funds proof.
- DeepCheck is a wider wallet profile, not exact provenance for selected funds.
- Where is money explains relevant wallet funds.
- Incoming deposit explains one concrete deposit.
- Unified `/check` composes signals; it does not replace the source modes.

Confidence: `test-backed`

Next action: keep documenting mode boundaries in future plans and UI copy.

### 2. Keep `address_fast_check` Outside The Worker Queue

Status: `keep as-is`

Area: check modes, job lifecycle

Current understanding:

`address_fast_check` is saved as a terminal record. It is not a queueable
forensic worker job.

Why keep it:

This avoids mixing a quick snapshot with long-running provenance jobs.

Confidence: `code-inspected`

Next action: no implementation needed.

### 3. Keep Parent Jobs Separate From Address Index Tasks

Status: `keep as-is`

Area: job lifecycle, indexing

Current understanding:

The user-facing forensic job and the technical address index state are separate
lifecycle objects.

Why keep it:

One user check can wait for background indexing without blocking the forensic
worker and without becoming a second product mode.

Confidence: `test-backed`

Next action: document this boundary whenever changing wait/resume logic.

### 4. Keep Ordinary Where Wait/Resume

Status: `keep as-is`

Area: Where is money, job lifecycle, indexing

Current understanding:

Ordinary Where can move to `waiting_for_targeted_index`, queue targeted index
work, then resume after index completion or terminal state.

Why keep it:

This is the right product shape for long provenance checks. It avoids final
answers from shallow inline fetches.

Confidence: `test-backed`

Next action: keep extending this shape carefully rather than adding one-off
blocking fetches.

### 5. Keep `candidate_window` Separate From `broad_targeted`

Status: `keep as-is`

Area: data indexing, forensic logic

Current understanding:

`candidate_window` indexes a narrow candidate-to-hop window. `broad_targeted`
indexes broad address history up to a target timestamp. Candidate-window
coverage must not satisfy broad targeted coverage.

Why keep it:

The narrow window is useful proof material, but treating it as broad history
would overclaim coverage.

Confidence: `test-backed`

Next action: preserve this invariant in future storage/query changes.

### 6. Keep Exact/Probable Source Provenance Boundary

Status: `keep as-is`

Area: forensic logic, scoring, Admin UX

Current understanding:

`exact` source provenance can continue trace and become hard proof input.
`probable` source provenance is context unless repaired/re-evaluated into
`exact`.

Why keep it:

This prevents visible funding candidates from becoming proof just because they
look plausible.

Confidence: `test-backed`

Next action: keep UI and scoring language aligned with proof class.

### 7. Keep Technical No-Score Contract

Status: `keep as-is`

Area: scoring, Admin UX, Telegram UX

Current understanding:

If coverage blocks a trustworthy score, reports should carry `scoreValid=false`
or serialized `score_valid=false`, plus blocked reason and technical status.

Why keep it:

Provider caps, local budgets and rate limits are not risk verdicts.

Confidence: `test-backed`

Next action: new report paths should set score validity explicitly.

### 8. Keep Admin Richer Than Telegram

Status: `keep as-is`

Area: Admin and bot UX

Current understanding:

Admin is an analyst workbench and can show raw codes, progress states, provider
counters, graph payloads and funding candidates. Telegram should translate the
same meaning into simpler user-facing language.

Why keep it:

Analysts need diagnostic detail; end users need clarity and no overclaiming.

Confidence: `test-backed`

Next action: improve Telegram without removing Admin diagnostic depth.

## Product Decisions Needed

### 0. Should Small Dense-Hop Provider Caps Become Caveats Instead Of Job-Level No-Score?

Status: `candidate for implementation`

Area: Where is money, forensic logic, scoring, Admin UX

Current understanding:

A live manual review of `THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7` found a case where
ordinary Where completed many targeted waits but failed the whole report on one
dense `broad_targeted` hop:

```text
TYCBsKvJSrLoj6pudJCLFNFYdBcntNP1gU
status_reason=partial_provider_cap
fetched_page_count=26
fetched_transfer_count=1297
unique_counterparty_count=1191
attempt_count=8/max_attempts=8
```

The visible transfer from that dense hop was `1,562 USDT` into a much larger
route branch. The current behavior converted that branch-level provider cap
into job-level `score_valid=false`.

Why it matters:

The system should not treat missing data as clean. But it also should not make
every small unresolved dense-hop tail block the whole Where result when the
covered part is enough for a useful score and no hard evidence is present in
the unresolved branch.

Suggested policy:

Score the covered part, exclude the unresolved branch from decisive clean/bad
evidence, and keep the unresolved branch visible as a caveat when it is below
materiality and has no hard evidence.

Chosen threshold direction:

Use tiered materiality, not a single strict `1% + 100 USDT` gate. The tiers are:

- dust residual;
- small-relative dense-hop tail;
- material unresolved source;
- hard-evidence unresolved source.

This matters because a THJ-like `1,562 USDT` unresolved tail can be tiny
relative to a large flow while still exceeding 100 USDT.

Confidence: `runtime-observed`

Suggested next action: treat
`09-where-dense-hop-materiality-finding.md` as a first implementation-plan
candidate after product review.

### 1. What Should Unified Do With `INSUFFICIENT_EVIDENCE`?

Status: `needs product decision`

Area: scoring

Current understanding:

Scoring Signal Matrix can return:

```text
matrixDecision=INSUFFICIENT_EVIDENCE
policyScore=null
```

Unified wallet risk can still publish:

```text
finalDecision=ACCEPTABLE
finalScore=0
```

if explicit `scoreValid=false` is absent.

Why it matters:

This sits close to the forbidden interpretation "missing data is clean".

Options:

- keep current behavior, but make coverage caveat very visible;
- map some insufficient-evidence cases to `REVIEW`;
- map mandatory provenance gaps to `NO_FINAL_DECISION`;
- split soft coverage caveat from hard mandatory blocker.

Confidence: `test-backed`

Suggested next action: product decision before changing scoring.

### 2. Should Incoming Deposit Have Top-Level `REVIEW`?

Status: `needs product decision`

Area: incoming deposit, scoring, Telegram UX

Current understanding:

`IncomingDepositDecision` currently supports:

```text
ACCEPTABLE | DECLINE | NO_FINAL_DECISION
```

There is no top-level `REVIEW`.

Why it matters:

Deposit reports may have medium/contextual risk that is not a decline and not a
technical block. Today that nuance lives in score/band/reasons, while top-level
decision can still be `ACCEPTABLE`.

Options:

- keep binary deposit decision plus technical no-final;
- add `REVIEW`;
- keep type as-is but improve copy for medium-risk deposits.

Confidence: `test-backed`

Suggested next action: product decision before any type/API change.

### 3. Should `scoreValid=true` Be Explicit In New Reports?

Status: `needs product decision`

Area: scoring, report schemas

Current understanding:

Consumers usually treat only `scoreValid === false` as invalid. Missing
`scoreValid` behaves like usable score.

Why it matters:

This is backward-compatible but fragile for new paths.

Suggested policy:

New report outputs should prefer explicit `scoreValid=true` or
`scoreValid=false`, while old consumers keep compatibility with missing fields.

Confidence: `code-inspected`

Suggested next action: decide schema policy; implementation can be separate.

### 4. Is The 12,000-Page Where Targeted Ceiling Product-Acceptable?

Status: `needs product decision`

Area: data indexing, operations

Current understanding:

Current broad Where targeted indexing can escalate up to the code-level
ceiling. Heavy addresses can still end in terminal provider/budget states.

Why it matters:

This is partly product policy and partly operational cost.

Options:

- keep current ceiling and accept no-final technical stops;
- raise ceiling for some jobs;
- make budgets runtime/product config;
- invest in better split/progress strategy before raising budgets.

Confidence: `test-backed`

Suggested next action: decide whether current ceiling is acceptable for paid
Where results.

### 5. Which Freshness Marker Should Admin Prioritize?

Status: `needs product decision`

Area: Admin UX, job lifecycle

Current understanding:

Admin has timestamps and job ids, but old cached jobs and fresh runs are not
first-class separate visual states.

Why it matters:

Old completed jobs can be mistaken for fresh behavior or fresh proof.

Options:

- latest-job badge;
- job age;
- explicit "old cached result" marker;
- fresh run id after start buttons;
- all of the above, if UI density allows.

Confidence: `docs-only` plus `code-inspected risk`

Suggested next action: choose UX marker before implementation.

## Known Gaps

### 0. DeepCheck Underreports Verify20 Campaigns And Overcounts Plain Transfers As Contract-Driven

Status: `candidate for implementation`

Area: DeepCheck, forensic logic, Admin UX, scoring evidence quality

Current understanding:

Manual runtime review of `TPdrEz6N5pJoUbnnEcSz56e3wumV5mmGJE` found a mismatch
between the full incoming transaction-info footprint and the saved DeepCheck
contract-driven summary.

The local all-time subject index had:

```text
251 dedup subject transfer edges
116 incoming tx
```

Manual `transaction-info` classification of all 116 incoming tx found:

```text
101 Verify20 wrapper incoming tx
15 plain USDT transfer incoming tx
```

The saved DeepCheck job reported only:

```text
29 contractDrivenTransferProfiles
14 Verify20 wrapper profiles
15 plain USDT transfer profiles counted as contract-driven
0 exact approvalDrainProvenanceProfiles
```

Why it matters:

DeepCheck is the wallet-profile mode. It should expose broad drainer-campaign
context even when `Where is Money` only needs a smaller current-balance proof
subset. It also should not mix canonical USDT `transfer(...)` calls with
drainer-like wrapper calls such as `Verify20`.

Confidence: `runtime-observed`

User decision:

```text
Confirmed as the next implementation candidate after the current audit/spec
documentation pass.
```

Suggested next action: treat
`10-deepcheck-contract-driven-drainer-campaign-finding.md` as a high-priority
candidate implementation spec after product review.

### 1. Incoming Deposit Lacks Shared Wait/Resume Targeted Indexing

Status: `candidate for implementation`

Area: incoming deposit, job lifecycle, data indexing

Current understanding:

Incoming can produce `NO_FINAL_DECISION` when targeted coverage is blocked, but
it does not yet use the ordinary Where parent-job wait/resume lifecycle.

Impact:

Incoming can stop safely, but it may not automatically continue indexing and
resume the same way ordinary Where does.

Confidence: `test-backed`

Suggested next action: separate implementation plan.

### 2. Telegram Lacks Full Live Progress For Long Where/Incoming Checks

Status: `candidate for implementation`

Area: Telegram UX

Current understanding:

Admin can show targeted pages, budgets, locks, provider errors and now
candidate-window progress. Telegram does not yet have equivalent plain-language
progress.

Impact:

Users may see less useful feedback while a long check is still working.

Confidence: `test-backed` for Admin, `code-inspected` for Telegram gap

Suggested next action: design minimal Telegram progress copy before building.

### 3. Incoming No-Final Telegram Alert Is Less Explicit Than Where No-Final

Status: `candidate for implementation`

Area: Telegram UX, Incoming deposit

Current understanding:

Where no-final report shows decision, blocked reason and technical status.
Incoming alert can show `NO_FINAL_DECISION`, but technical block details are
less explicit.

Impact:

Incoming no-final result may look less clear to users.

Confidence: `code-inspected`

Suggested next action: improve alert formatting after product decision on risk
score/band visibility in no-final cases.

### 4. Generic Telegram Job Status Says `Deep forensic status`

Status: `candidate for implementation`

Area: Telegram UX polish

Current understanding:

Generic status formatting can be used for non-Deep jobs but still has
DeepCheck-specific title text.

Impact:

Small but avoidable confusion.

Confidence: `test-backed`

Suggested next action: small mode-aware wording fix.

### 5. `all_time` Freshness Is Not First-Class

Status: `needs product decision`

Area: data indexing, DeepCheck, Admin UX

Current understanding:

For fixed targeted timestamps, old complete coverage can still be meaningful.
For `all_time`, "complete" may age as the address keeps transacting.

Impact:

DeepCheck or future all-time scoring can overtrust stale all-time states if
freshness semantics stay implicit.

Confidence: `code-inspected`

Suggested next action: define freshness policy before implementation.

### 6. Split-Depth And Window-Level Broad Index Progress Is Still Weak

Status: `improve later`

Area: Admin UX, indexing

Current understanding:

Admin shows pages, transfers, dates, errors, candidate-window counts and state
counts. It does not yet explain broad index split depth/window tree progress as
a first-class concept.

Impact:

Analysts can see work is happening, but not always why a heavy broad run is
still long.

Confidence: `code-inspected`

Suggested next action: improve after higher-priority product decisions.

### 7. Scoring Technical Status Mapping Is Duplicated

Status: `improve later`

Area: scoring, job lifecycle

Current understanding:

Similar provider/index terminal status mappings appear in multiple paths.

Impact:

Future status additions can drift across Where, Incoming, strict provenance and
Deep job paths.

Confidence: `code-inspected`

Suggested next action: centralize when touching this behavior next.

## Candidate Implementation Plans

These are not approved implementation plans yet. They are shortlist candidates.

### Plan 0: Dense-Hop Materiality For Where

Status: `candidate for implementation`

Why this first:

It directly addresses live `Where is money` usefulness. The current behavior
can fail a full report on one small provider-capped dense-hop tail.

Expected shape:

- compute branch and aggregate unresolved materiality before job-level
  no-score;
- use scope-specific denominators: current balance, selected anchor, recent
  flow, requested amount, or transaction seed;
- apply tiered materiality: dust residual, small-relative dense-hop tail,
  material unresolved source, hard-evidence unresolved source;
- prefer candidate-window proof before broad dense-hop fallback;
- allow valid score for covered evidence when unresolved dense-hop residue is
  below materiality and has no hard evidence;
- keep aggregate unresolved amount from passing just because each branch is
  individually small;
- keep excluded unresolved branches visible in Admin/Telegram caveats;
- preserve hard evidence and material unresolved blockers.

Risk:

The implementation must not hide material missing provenance or hard evidence.
The unresolved branch can be excluded from decisive scoring only when the
materiality and evidence-strength rules say it is safe.

### Plan A: Incoming Shared Wait/Resume Targeted Indexing

Status: `candidate for implementation`

Why this first:

It is the largest remaining provenance completeness gap after ordinary Where
got wait/resume and candidate-window-first indexing.

Expected shape:

- define Incoming wait identity;
- reuse or extend `forensic_job_waits`;
- add parent release/resume behavior for Incoming;
- preserve delivery-sensitive alert lifecycle;
- update Admin and Telegram progress copy.

Risk:

Incoming alert side effects make stale recovery and duplicate delivery more
sensitive than Where.

### Plan A2: DeepCheck Drainer-Campaign Visibility

Status: `candidate for implementation`

Why this matters:

DeepCheck should be able to tell an analyst that a wallet has a broad
`Verify20` wrapper campaign footprint. In the TPdr runtime review, manual
transaction-info classification found 101 wrapper incoming tx, while saved
DeepCheck showed only 14 wrapper profiles and mixed in 15 plain transfers.

Expected shape:

- classify canonical USDT `transfer(...)` as plain transfer, not drainer-like
  contract-driven evidence;
- enrich enough subject incoming tx to build a campaign footprint when the
  count is modest;
- show enrichment denominators, for example `116/116` or `200/2400`, so partial
  campaign counts are not mistaken for totals;
- rank approval-drain candidates by suspicious method/operator/cluster signals,
  not only amount;
- allow DeepCheck to return multiple exact approval-drain profiles where proof
  exists;
- show wrapper campaign context separately from exact approval-drain proof.

Risk:

The implementation must not turn every `Verify20` context signal into exact
hard evidence. Exact proof still requires deterministic approval, spender,
transferFrom, and path evidence.

### Plan B: Telegram Long-Check Progress

Status: `candidate for implementation`

Why this matters:

Admin can explain long targeted and candidate-window indexing. Telegram users
do not get the same confidence that the check is still working.

Expected shape:

- compact progress message for Where waits;
- distinguish candidate-window checking from broad targeted indexing;
- show no final score until coverage/provenance is ready;
- avoid raw provider codes unless wrapped in user language.

Risk:

Too much progress detail can confuse users. Keep it small.

### Plan C: Scoring Insufficient-Evidence Policy

Status: `needs product decision first`

Why this matters:

`INSUFFICIENT_EVIDENCE -> ACCEPTABLE / 0` is the sharpest unresolved policy
question in the current scoring audit.

Expected shape after decision:

- update scoring mapping;
- update Admin and Telegram copy;
- add regression tests for selected cases;
- update `docs/knowledge/07-risk-scoring-matrix.md` if product behavior
  changes.

Risk:

Changing this can alter user-facing decisions. It needs product approval.

### Plan D: Admin Freshness Markers

Status: `candidate for implementation`

Why this matters:

Old cached jobs and fresh runs can be confused by analysts.

Expected shape:

- latest job badge;
- age/completed-at emphasis;
- old cached result marker;
- start-job confirmation with address and queued job id.

Risk:

Mostly UI clarity risk, low backend risk.

### Plan E: Candidate-Window Glossary And Admin Explanation

Status: `document better`

Why this matters:

`candidate_window` is now a real coverage identity. Analysts need to know it is
narrow proof material, not broad coverage.

Expected shape:

- add a glossary row in audit or knowledge after approval;
- add Admin help/label text later if needed;
- preserve exact/probable language.

Risk:

Documentation-only unless Admin UI copy changes.

## Runtime Observation Wishlist

These checks would raise confidence from `test-backed`/`code-inspected` to
`runtime-observed`.

### 1. Fresh Where Candidate-Window Run

Observe a fresh Where job that enters:

```text
targetedIndex.phase=checking_candidate_windows
```

Confirm:

- Admin job card says `CHECKING: CANDIDATE WINDOWS`;
- graph summary uses `checkedScope=candidate_window_indexing`;
- broad fallback is shown separately;
- final score remains pending while windows are incomplete.

### 2. Fresh Where Broad Fallback After Candidate Windows

Observe a case where candidate windows finish but do not prove enough, then
broad `where_is_money_hop` fallback queues.

Confirm:

- candidate-window waits are done/terminal;
- broad targeted state starts separately;
- Admin does not claim candidate windows covered broad history.

### 3. Terminal Provider-Cap No-Final Flow

Observe a fresh job reaching terminal provider cap.

Confirm:

- result has invalid score fields;
- Admin shows technical terminal state;
- Telegram does not show final `DECLINE` or fake clean result.

### 4. Incoming No-Final Alert

Observe a real or controlled Incoming report with `scoreValid=false`.

Confirm:

- Telegram alert wording is understandable;
- risk score/band does not look contradictory;
- support/debug has enough technical detail.

### 5. Old Cached Job Versus Fresh Run

In Admin, compare an old completed Where job and a fresh job for the same
address.

Confirm:

- analyst can tell which one is fresh;
- start action confirms queued job id;
- graph/status does not silently reuse old evidence as fresh proof.

## Suggested Review Order

If reviewing manually, start here:

1. `candidate_window` semantics: accept the narrow-vs-broad distinction.
2. Scoring policy: decide `INSUFFICIENT_EVIDENCE` mapping.
3. Incoming lifecycle: decide whether it gets next implementation plan.
4. Telegram progress/no-final wording: decide minimum user-facing clarity.
5. Admin freshness: decide the marker style.

## Evidence Appendix

Audit files summarized:

- `01-system-overview.md`
- `02-check-modes-walkthrough.md`
- `03-data-indexing-walkthrough.md`
- `04-job-lifecycle-walkthrough.md`
- `05-forensic-logic-walkthrough.md`
- `06-scoring-walkthrough.md`
- `07-admin-bot-ux-walkthrough.md`

Knowledge docs used across the audit:

- `docs/knowledge/AGENT_BRIEF.md`
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
- `docs/knowledge/13-agent-observations.md`

Most recent delta verification referenced:

```text
npm test -- tests/forensics/candidateWindowTargeting.test.ts tests/forensics/targetedHistoryCoordinator.test.ts tests/forensics/moneyOriginTrace.test.ts tests/forensics/tronAddressAllTimeIndex.test.ts tests/storage/repositories.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
```

Result:

```text
Test Files  8 passed (8)
Tests       452 passed (452)
```

Runtime observation referenced:

```text
Admin /admin/forensics returned HTTP 200 from local live process.
```
