# System Audit Map And Index

## Scope

This is a diagnostic audit pass for the TRON USDT monitoring and forensic bot.
It maps product promises to code, minimal verification, findings, and decisions.
Product code is not changed during this pass.

This file is the control page. It keeps the audit ordered and prevents the work
from becoming unrelated notes.

## Reading Order

1. `01-product-modes.md`
2. `02-data-and-indexing.md`
3. `03-job-lifecycle.md`
4. `04-forensic-logic.md`
5. `05-scoring-policy.md`
6. `06-admin-bot-ux.md`
7. `07-findings-backlog.md`
8. `08-decisions-and-improvement-ideas.md`

## Cross-Cutting Invariants

- Facts and interpretation stay separated.
- Missing data is not clean.
- A technical stop is not a risk verdict.
- A service boundary is not a coverage failure.
- An old database job is not fresh runtime proof.
- `REVIEW` does not become a false `DECLINE`.
- Check modes stay separate.

## Representative Scenario Matrix

| Scenario | Status | Evidence Location | Confidence | Notes |
| --- | --- | --- | --- | --- |
| Fresh ordinary `Where is money` | not checked | `04-forensic-logic.md` | docs-only | Planned representative scenario. |
| `Where is money` with targeted wait/resume | not checked | `03-job-lifecycle.md` | docs-only | Planned representative scenario. |
| Terminal provider cap with no final score | not checked | `03-job-lifecycle.md` | docs-only | Planned representative scenario. |
| Residual unresolved source provenance below materiality | not checked | `05-scoring-policy.md` | docs-only | Planned representative scenario. |
| `Incoming deposit` incomplete coverage | not checked | `04-forensic-logic.md` | docs-only | Planned representative scenario. |
| DeepCheck full evidence graph | not checked | `06-admin-bot-ux.md` | docs-only | Planned representative scenario. |
| Old cached job vs fresh job | not checked | `06-admin-bot-ux.md` | docs-only | Planned representative scenario. |
| Telegram technical block copy | not checked | `06-admin-bot-ux.md` | docs-only | Planned representative scenario. |

## Audit Progress

| Note | Status | Section Verdict |
| --- | --- | --- |
| `01-product-modes.md` | drafted | healthy with known adjacent gaps |
| `02-data-and-indexing.md` | not started | not reviewed |
| `03-job-lifecycle.md` | not started | not reviewed |
| `04-forensic-logic.md` | not started | not reviewed |
| `05-scoring-policy.md` | not started | not reviewed |
| `06-admin-bot-ux.md` | not started | not reviewed |

## Current Checkpoint

Pilot scope:

- `00-map-and-index.md`;
- `01-product-modes.md`.

The pilot is limited to product-mode boundaries and audit structure. Live
Admin, Telegram, and database scenarios are not part of this checkpoint.

## Baseline Caveat

At the time of the pilot, the working tree contained unrelated uncommitted
product-file changes outside the audit scope. They were not edited by this
audit pass. Focused tests still passed on the current working tree, so the
product-mode evidence is useful, but later sections should keep this baseline
in mind when comparing results.

## Section 00 Verdict

Status: ready as a control page.

Confidence: docs-only.

Keep as-is rationale: a separate control page is useful because it carries the
reading order, invariants, scenario matrix, and progress table. It should stay
lightweight and should not become the place for detailed product conclusions.
