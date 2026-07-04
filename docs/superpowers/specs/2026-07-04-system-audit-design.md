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
```

Each note should use the same compact structure:

```text
Promise
Code entry points
Minimal verification
Expected vs actual
Findings
Questions
Next action
```

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

## Approved Choices

- First pass type: system map plus audit checklist.
- Audit mode: diagnostic only, no product code fixes during the pass.
- Artifact style: separate audit notes by area.
- Route: product to technical support.
- Depth: balanced audit, not a shallow skim and not an exhaustive multi-day
  forensic run for every mode.
