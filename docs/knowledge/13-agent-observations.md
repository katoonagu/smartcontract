---
status: current
last_verified: 2026-07-03
owner_area: docs
code_refs:
  - AGENTS.md
  - docs/knowledge/AGENT_BRIEF.md
supersedes:
  - docs/superpowers/specs/2026-07-03-project-knowledge-workflow-design.md
---

# Agent Observations

This file stores repeated agent mistakes and user corrections that future
agents should remember.

## 2026-07-03: Do Not Collapse Check Modes

Agent mistake:

The agent described a "single full provenance mode" in a way that sounded like
it would replace existing modes.

Correct rule:

The product keeps separate modes: fast, deep, where, incoming, and unified
`/check`. They can share indexing infrastructure, but they answer different
questions.

Fixed in:

- `docs/knowledge/02-check-modes.md`
- `docs/knowledge/09-current-decisions.md`

## 2026-07-03: `History Not Fully Fetched` Is Not A Product Answer

Agent mistake:

The agent treated incomplete history as a technical explanation that could be
shown as an end state.

Correct rule:

For paid forensic provenance, if the main money path is incomplete because of
our page budget or partial index state, the system should continue indexing or
finish with a technical no-score state. It should not publish a final score.

Fixed in:

- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/09-current-decisions.md`

## 2026-07-03: Docs Are Not Code Proof

Agent mistake:

The agent can over-trust documentation when describing current behavior.

Correct rule:

Knowledge docs define product intent. Code proves current implementation. If
they disagree, report the disagreement and verify code before changing behavior.

Fixed in:

- `docs/knowledge/01-product-principles.md`
- `AGENTS.md`
