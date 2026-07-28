---
status: current
last_verified: 2026-07-28
owner_area: docs
code_refs:
  - AGENTS.md
supersedes:
  - docs/project-walkthrough/README.md
---

# Knowledge Index

This folder is the current source of truth for product and engineering
direction. Older `docs/superpowers/*`, `docs/research/*`, and
`docs/project-walkthrough/*` files remain useful history, but this folder wins
when describing current intent.

## Reading Order

1. `AGENT_BRIEF.md`: start here for any non-trivial task.
2. `14-current-roadmap.md`: current execution order and gate status.
3. `09-current-decisions.md`: current product and architecture decisions.
4. One focused page for the area you are touching.
5. `10-open-problems.md`: check whether the issue is already known.
6. `12-runbooks.md`: use for local commands and verification.

## Files

- `01-product-principles.md`: product rules and promises.
- `02-check-modes.md`: roles of fast, deep, where, incoming, and unified check.
- `03-job-lifecycle.md`: how jobs run, wait, resume, and finish.
- `04-data-sources-tronscan-indexing.md`: TronScan, indexing, key pool,
  coverage, and provider limits.
- `05-where-is-money-and-incoming.md`: provenance rules for money origin and
  concrete deposits.
- `06-deepcheck.md`: DeepCheck role and current gaps.
- `07-risk-scoring-matrix.md`: score validity and risk policy.
- `08-admin-and-bot-ux.md`: how results and progress should be shown.
- `09-current-decisions.md`: short list of current decisions.
- `10-open-problems.md`: architectural and product gaps.
- `11-glossary.md`: current terms.
- `12-runbooks.md`: commands and operating procedures.
- `13-agent-observations.md`: repeated agent mistakes and corrections.
- `14-current-roadmap.md`: current execution order, status, and acceptance
  boundaries.

## Maintenance Rule

When behavior changes, update the matching page. When a repeated problem is
found but not fixed, add it to `10-open-problems.md`. When an agent makes a
repeatable misunderstanding, add it to `13-agent-observations.md`.
