---
status: approved
date: 2026-07-04
owner_area: audit
supersedes: []
---

# System Audit Design

## Context

The project is a TRON USDT monitoring and forensic bot. Current product truth
lives in `docs/knowledge/*`. The audit must respect the existing product
direction:

- check modes stay separate: fast, deep, where, incoming, unified `/check`;
- facts and interpretation stay separate;
- missing data is not clean;
- technical stops are not risk verdicts;
- docs state product intent, while code proves current behavior.

The first audit pass is diagnostic only. It should map the system and produce
evidence-backed notes, not fix product code while exploring.

## Goals

- Build a system map and audit checklist from product behavior down to
  technical implementation.
- Produce separate audit notes by area so each section can be reviewed and
  continued independently.
- Record findings with enough evidence to become later tasks.
- Verify docs promises against code and, where useful, minimal runtime/manual
  checks.
- Keep the first pass focused: identify and prioritize, do not implement fixes.

## Non-Goals

- Do not refactor or fix product code during the first pass.
- Do not collapse check modes into one general provenance mode.
- Do not perform a dedicated security review unless that becomes a separate
  request.
- Do not redesign Admin or Telegram UX during this pass.
- Do not treat old database jobs as fresh runtime proof without checking job
  id, `created_at`, and `requested_by`.

ponytail: The first pass is intentionally diagnostic only. The ceiling is that
obvious bugs will remain unfixed until a follow-up task; the upgrade path is a
separate implementation plan for selected findings.

## Output Artifacts

Create audit notes under:

```text
docs/audit/2026-07-system-audit/
```

Initial file set:

```text
00-map-and-index.md
01-product-modes.md
02-data-and-indexing.md
03-job-lifecycle.md
04-forensic-logic.md
05-scoring-policy.md
06-admin-bot-ux.md
07-findings-backlog.md
08-decisions-and-improvement-ideas.md
```

Each note should use the same compact structure:

```text
Promise
Code entry points
Minimal verification
Expected vs actual
Findings
Questions
Section verdict
Improvement ideas
Keep-as-is rationale
Next action
```

`08-decisions-and-improvement-ideas.md` records decisions that are not bugs.
This keeps "leave it alone" and "improve later" visible instead of letting the
audit become only a defect list.

Decision categories:

- `leave as-is`;
- `document better`;
- `improve later`;
- `needs product decision`;
- `candidate for implementation`.

## Audit Route

The audit proceeds from product meaning to technical support:

1. Product modes
   - fast check;
   - deep check;
   - where is money;
   - incoming deposit;
   - unified `/check`.
2. Data and indexing
   - TronScan;
   - API key pool;
   - local index;
   - targeted history;
   - provider caps;
   - cache and repair paths.
3. Job lifecycle
   - queue states;
   - `waiting_for_targeted_index`;
   - wait/resume;
   - locks and heartbeat;
   - worker startup;
   - terminal technical states.
4. Forensic logic
   - money paths;
   - source provenance;
   - exact/probable/unresolved proof classes;
   - service boundaries;
   - materiality;
   - hard evidence.
5. Scoring policy
   - `score_valid`;
   - score blocked reasons;
   - technical no-final-score states;
   - floors and dampeners;
   - `REVIEW` vs `DECLINE`;
   - unified composition.
6. Admin and bot UX
   - Admin graph views;
   - Admin job cards;
   - targeted indexing progress;
   - Telegram copy;
   - support report;
   - analyst workflow.

## Cross-Cutting Invariants

Every audit area should be checked against the same product invariants:

- facts and interpretation stay separated;
- missing data is not clean;
- a technical stop is not a risk verdict;
- a service boundary is not a coverage failure;
- an old database job is not fresh runtime proof;
- `REVIEW` does not become a false `DECLINE`;
- check modes stay separate.

## Representative Scenario Matrix

The first audit pass should include representative scenarios, not only static
code reading. `00-map-and-index.md` should track which scenarios were checked,
which were only identified, and which require follow-up.

Initial scenario set:

- fresh ordinary `Where is money`;
- `Where is money` with targeted wait/resume;
- terminal provider cap with no final score;
- residual unresolved source provenance below materiality;
- `Incoming deposit` incomplete coverage;
- DeepCheck full evidence graph;
- old cached job vs fresh job;
- Telegram technical block copy.

## Per-Area Audit Loop

Each area follows the same balanced loop:

1. Read the relevant `docs/knowledge/*` promises.
2. Find code entry points, tests, scripts, migrations, and data models.
3. Run or describe the smallest useful verification:
   - focused tests;
   - typecheck when appropriate;
   - Admin freshness check;
   - recent jobs query;
   - manual Admin or Telegram inspection;
   - log or database inspection.
4. Compare expected behavior with actual behavior.
5. Record findings, questions, and next action.

The "enough for first pass" bar is:

- the product promise is stated;
- code entry points are named;
- a minimal verification path is identified or run;
- known gaps are linked to existing docs when present;
- any mismatch is recorded as a finding or product question.

## Findings Format

`07-findings-backlog.md` uses this shape:

```md
## F-001: <short title>

Severity: P0/P1/P2/P3
Area: product-modes | data-indexing | jobs | forensic-logic | scoring | admin-bot-ux
Status: open | needs-repro | product-question | known-gap | duplicate
Evidence:
- docs:
- code:
- runtime/manual:
Confidence: docs-only | code-inspected | test-backed | runtime-observed
Impact:
Recommended next action:
```

Severity rules:

- P0: can produce an incorrect final risk verdict or data loss.
- P1: breaks a key paid scenario, provenance completeness, job lifecycle, or
  score-validity honesty.
- P2: materially weakens analyst/user UX, diagnostics, progress visibility, or
  supportability.
- P3: docs mismatch, cleanup, wording, test coverage, or minor developer
  experience issue.

Product questions are tracked separately from bugs when the right behavior
needs a decision before implementation.

## Decision And Improvement Ledger

`08-decisions-and-improvement-ideas.md` records non-defect outcomes from each
stage:

```md
## D-001: <short title>

Area:
Decision: leave as-is | document better | improve later | needs product decision | candidate for implementation
Rationale:
Evidence:
Related findings:
Next review trigger:
```

Use this ledger for:

- choices to leave current behavior unchanged;
- small documentation improvements that should not block the audit;
- product questions that need an owner decision;
- implementation candidates that should become later plans;
- rationale for not changing a component after review.

## Skill And Tool Use

Use the minimum skill set:

- `brainstorming`: design this audit and write the approved spec.
- `writing-plans`: next step after the user reviews this spec.
- `qa-only` or `playwright`: report-only Admin/browser inspection when needed.
- `investigate`: root-cause work for a specific finding, without fixing during
  the first pass.
- `verification-before-completion`: final sanity check before claiming the audit
  pass is complete.

Do not use security, design/redesign, or implementation/fix skills unless a
future request explicitly changes the scope.

## Documentation Policy

The audit can create `docs/audit/*` notes. It should not update
`docs/knowledge/*` during the diagnostic pass unless the user separately
approves that change.

If the audit finds a docs/code mismatch, record it in findings. Later work can
decide whether to update docs, change code, or treat the mismatch as an
intentional product decision.

## Verification Policy

Runtime/manual checks must avoid stale evidence:

- confirm job id, `created_at`, and `requested_by` before treating an Admin graph
  or database result as current;
- prefer focused checks over full-suite runs while mapping;
- run broader tests only when the area or finding justifies the cost;
- state clearly when a verification was identified but not run.

## Whole-Pass Definition Of Done

The first diagnostic pass is done when:

- all planned audit notes exist;
- each section has a section verdict;
- improvement ideas and keep-as-is rationales are recorded where applicable;
- findings are deduped and prioritized;
- open product questions are listed separately;
- the representative scenario matrix shows checked vs deferred scenarios;
- there is a shortlist of follow-up implementation or fix plans.

## Approved Choices

- First pass type: system map plus audit checklist.
- Audit mode: diagnostic only, no product code fixes during the pass.
- Artifact style: separate audit notes by area.
- Route: product to technical support.
- Depth: balanced audit, not a shallow skim and not an exhaustive multi-day
  forensic run for every mode.
