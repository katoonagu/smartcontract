---
status: current
last_verified: 2026-07-12
owner_area: docs
code_refs:
  - AGENTS.md
  - docs/knowledge/AGENT_BRIEF.md
  - src/monitor/addressPoisoningWorker.ts
  - src/storage/repositories.ts
  - src/tron/tronClient.ts
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

## 2026-07-10: Contract And Score Are Facts, Not Policy Shortcuts

- `isContract` does not imply service boundary or risk.
- A numeric score does not imply hard evidence.
- Fee/service roles require transaction structure; address identity alone is insufficient.
- Coverage failure changes certainty, not badness.

## 2026-07-11: Do Not Turn Every Fact Into A Theft Disclaimer

Agent mistake:

The agent repeatedly appended phrases such as `this does not prove theft` or
`this is not proof of dirty funds` to bridge, collector, service, victim, and
counterparty facts. The disclaimers made the report longer and framed ordinary
wallet behavior as presumptively criminal.

Correct rule:

State the observed fact, the address role, and the required action. Add a
boundary of knowledge only when it prevents a concrete overclaim. A victim is
simply called a victim. Collector behavior is described as a wallet role.
Bridge exposure is described as cross-chain AML risk without claiming that
every bridge transfer, or every laundering scheme, has the same meaning.

## 2026-07-11: Keep Address Fixtures And Economic Claims Grounded

Agent mistakes:

- A mixed-case TGyt placeholder was treated as a valid TRON address even though
  Base58 addresses are case-sensitive.
- A nearby 3 USDT GasFree fee was described as a settlement tied to a principal
  transfer without saved structural evidence for that relation.
- Contract and GasFree account types were used as reasons to skip ordinary
  principal scoring.

Correct rules:

- Use the canonical valid fixture
  `TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD`; validate copied addresses before
  building a regression around them.
- State only the saved economic fact. An exact service-fee edge is separate
  technical context and is excluded from principal, but timing or destination
  alone does not prove how that fee settled another transfer.
- `isContract` and GasFree-account status are address facts, not scoring
  exemptions. Exclude only an exact GasFree `service_fee` edge. Principal
  transfers remain eligible at every hop.

## 2026-07-11: Historical HTX Exposure Is Not Neutral

Agent mistake:

The agent proposed hiding pre-designation HTX/Huobi transfers behind the
neutral phrase `historical exchange source`, as if only transfers after the
sanctions date mattered to the user.

Correct rule:

The official designation date still controls whether a transfer is called a
direct sanctioned source. Earlier HTX/Huobi exposure nevertheless remains
material `REVIEW` compliance context and must be named plainly, because a
receiving service may delay the funds and request additional source-of-funds
checks. Do not call a pre-designation transfer sanctioned at that timestamp,
and do not flatten it into an ordinary clean CEX source.

## 2026-07-12: Wallet Safety Is Not An AML Score

Agent mistake:

A critical security warning can be treated as permission to raise the wallet's
AML score or change a source-of-funds decision.

Correct rule:

Keep the action urgent but keep the domains separate. Address poisoning is
`wallet_safety` with exactly zero score impact and is excluded from AML inputs.
A low AML result also cannot cancel an active safety warning.

## 2026-07-12: Unknown Or Partial History Is Not Clean

Agent mistake:

A bounded lookup found no match, so the sender was described as new or safe
even though the full window was not covered.

Correct rule:

Negative partial coverage is `inconclusive`. It becomes `clear` only after
complete negative coverage or an exact disqualifier that is already proven in
the checked evidence.

## 2026-07-12: Names Do Not Establish Trust

Agent mistake:

Provider text, a public tag, contract name, token label, or AI phrase was used
as if it authorized automatic suppression.

Correct rule:

Suppress only from an authorized manual trusted/false-positive decision, an
exact authoritative address-registry match, or an exact prior direct relation.
Names and free text are context, not authority.

## 2026-07-12: Async Ownership Needs Its Own Lease

Agent mistake:

A generic row `updated_at` was treated as delivery ownership, so unrelated
candidate changes could steal or invalidate an active Telegram send.

Correct rule:

Long external delivery needs both a monotonic claim generation and a dedicated
lease timestamp. The lease owns heartbeat, liveness, and stale reclaim. The
generation owns terminal compare-and-set writes. Keep the heartbeat active
through final acknowledgement, serialize reclaim against finalization by
generation, and state the external crash gap honestly instead of claiming
exactly-once delivery.

## 2026-07-12: Coverage Metadata Needs A Pinned Authority

Agent mistake:

Fallback rows, changing totals, short pages, or provider risk labels were
treated as enough to prove a complete clean history.

Correct rule:

Evidence used to prove negative coverage must stay pinned to one authoritative
provider and retain its range metadata, offsets, totals, hashes, and overlaps.
Missing, contradictory, mixed, or non-progressing pagination stays partial.
Provider risk labels are context, not transaction validity: a confirmed,
successful, non-reverted official-USDT relationship still counts, with the raw
flag preserved in evidence.
