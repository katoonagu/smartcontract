---
status: current
last_verified: 2026-07-03
owner_area: forensics
code_refs:
  - src/forensics/fundingFirstSourceProvenance.ts
  - src/forensics/moneyOriginTrace.ts
  - src/forensics/moneyOriginOperationalAssessment.ts
  - src/forensics/incomingDepositJob.ts
  - src/forensics/deepForensicJob.ts
  - src/forensics/targetedHistoryCoordinator.ts
  - src/index.ts
  - tests/forensics/fundingFirstSourceProvenance.test.ts
  - tests/forensics/moneyOriginTrace.test.ts
  - tests/forensics/moneyOriginOperationalAssessment.test.ts
  - tests/forensics/incomingDepositJob.test.ts
  - tests/forensics/deepForensicJob.test.ts
  - tests/forensics/targetedHistoryCoordinator.test.ts
  - tests/forensics/tronAddressAllTimeIndex.test.ts
  - tests/forensics/targetedIndexRepair.test.ts
supersedes:
  - docs/superpowers/specs/2026-07-03-where-incoming-outcome-safety-design.md
  - docs/superpowers/plans/2026-07-03-where-incoming-outcome-safety.md
  - docs/superpowers/specs/2026-05-27-where-is-money-balance-origin-design.md
  - docs/superpowers/specs/2026-05-29-incoming-deposit-risk-design.md
---

# Where Is Money And Incoming Deposit

## Difference

`Where is money` explains the origin of the relevant funds on a wallet.

`Incoming deposit` explains one concrete incoming transaction: who sent it and
where that sender got the money before the deposit.

Do not merge these modes. They use similar provenance logic but answer
different user questions.

## Current Behavior

The trace can stop with `incoming_history_not_fetched` when a hop address needs
older incoming history and the available local/live data does not reach the
target timestamp.

Recent safety fixes make guarded approval-drain review plus legitimate service
context plus no hard bad evidence avoid a final user-facing `DECLINE`. In that
case the system can use `score_valid=false` with a technical coverage block.

Ordinary `Where is money` now has Stage 1 resumable targeted indexing for
required hops. If a hop lacks targeted history, the job queues targeted index
work, moves to `waiting_for_targeted_index`, and resumes after the index worker
marks the data ready or terminal.

Stage 1.5 makes the queued Where targeted task continue beyond the inline
four-page seed. Background targeted tasks start from a larger page budget and
retry/escalate when the partial state is caused by our page budget or by a
provider-cap path that also exhausted the local budget.

Stage 1.7 makes the targeted task more efficient for heavy TronScan addresses.
For capped windows, the indexer can walk backward from the oldest returned row
instead of repeatedly splitting by midpoint and refetching the same top page.
Where waits for the same hop address can also share a later target timestamp,
because that later target covers earlier target timestamps for the same address.

Stage 1.8 makes ordinary Where more tolerant of old retryable targeted states.
Old `partial_provider_cap` states are no longer treated as final terminal
coverage when they also exhausted the local budget; the job requeues targeted
indexing with a larger budget and stays in `waiting_for_targeted_index`.
Targeted resume also skips saved page windows when their page audit is stable.

Stage 1.9 adds a maintenance repair for old false `complete` targeted states.
After repair, ordinary Where does not wake up on that dirty coverage; it keeps
waiting while the targeted worker resumes with the existing cached pages.

Stage 1.10 fixes a same-address coverage edge case in ordinary Where. A newer
targeted state for the same hop address can cover older waits. The coordinator
now checks that covering state before deciding that an exact old
`queued`/`running` state must keep the parent job waiting. If the covering state
is terminal, Where exits waiting with a technical terminal result instead of
waiting on the stale exact state.

Stage 1.12 confirms the ordinary Where waiting/resume lifecycle for a terminal
targeted-index outcome. When the covering targeted state reached the current
12,000-page ceiling and ended as `partial_provider_cap`, all same-address waits
were marked terminal and the parent Where job exited `waiting_for_targeted_index`
with `score_valid=false`, `score_blocked_reason=provider_cap_unresolved`, and
`technical_status=provider_cap_unresolved`.

Stage 1.13 adds funding-first source provenance for ordinary Where trace hops.
For a concrete hop transfer, the trace now first asks which prior incoming
funds can explain that hop amount. It records `source_provenance` metadata with
a proof class:

- `exact`: covered funding window, amount math passes, and the trace may
  continue through the selected funders;
- `probable`: amount math supports the funding explanation, but the window is
  capped or incomplete, so it is Admin context, not hard scoring proof;
- `pre_existing_balance_possible`: reached history has no usable funding
  candidate, so the sender may have had earlier balance;
- `unresolved`: the hop source is not proven;
- `service_boundary`: reserved for service-boundary provenance context.

Probable funding-first evidence does not publish a final score by itself and
does not become hard evidence. It replaces some generic debug ambiguity with a
more precise explanation of what funding candidate was seen and why it is not
exact.

Stage 1.13 live validation on `THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7` confirmed
that a terminal targeted state no longer aborts ordinary Where before cache
analysis when local indexed transfers exist. The job completed a Where report
with source-provenance metadata from cached targeted history: exact, probable,
and unresolved proof classes were all visible. Provider-cap/capped-window
funding remains non-final context; it does not become hard evidence.

Incoming deposit can still produce `scoreValid=false` when targeted coverage is
blocked. It does not yet use the shared resumable targeted indexing flow.

The inline targeted seed path still uses `TARGETED_HISTORY_INLINE_MAX_PAGES =
4`, but ordinary Where required hops now queue background targeted indexing
with larger Stage 1.7 budget/depth settings before finishing.

## Planned Behavior

A full answer means the system either:

- traces the required path to a meaningful source;
- reaches a legitimate service boundary;
- reaches the configured depth limit with covered hop history;
- finds hard bad evidence;
- finds clean operational evidence strong enough for the scoring matrix.

A local budget stop is not a full answer.

## Honest Stops

Honest boundary stops include:

- CEX;
- DEX;
- bridge;
- router;
- known service contract;
- known service wallet.

These boundaries should be shown as boundaries, not as data failure.

## Non-Final Stops

These should not be final paid results on the main money path:

- `incoming_history_not_fetched`;
- `partial_budget_exhausted`;
- old partial targeted index reused as terminal;
- timeout before required hop coverage;
- local page cap that can be raised.

Current Where behavior: for required hops, the job requests more targeted
indexing and continues when coverage is available. If the targeted index ends
in a real provider/safety terminal state, Where finishes with `score_valid=false`
and a technical status, not a final score.

Current Incoming behavior: still partial/planned.

Current caveat: targeted worker runs now update lock heartbeat while fetching,
but Admin still presents mostly state-level progress. It is enough to tell that
the job is waiting for targeted history and the worker is alive, but it is not
yet a full per-window stream.

## `History Not Fully Fetched`

This message means the trace needed older incoming history for a hop address and
the available data did not reach the target timestamp.

The product direction is:

```text
Do not show this as final. Keep indexing or finish with a technical stop that
does not publish a final score.
```

## Score Rule

If hard evidence is absent and required provenance coverage is incomplete, the
system must not publish a final user-facing `DECLINE`.

If `score_valid=false`, Admin and Telegram must show that this is a technical
coverage block, not a verdict.

## Known Gaps

- Incoming still lacks the general continue-indexing-then-resume loop.
- Where has Stage 1 waiting/resume, Stage 1.5 background budget escalation,
  Stage 1.7 adaptive cursor indexing, and Stage 1.8 cache-aware resume for
  targeted partials. Stage 1.10 fixes finished covering targeted states
  shadowed by old exact non-covered states. Stage 1.12 confirms parent wake for
  terminal targeted coverage at the current ceiling. Stage 1.13 adds
  funding-first source-provenance metadata for concrete Where hops.
- Provider-cap terminal states can still block scoring when the indexer cannot
  resolve the range inside the current Stage 1.7 budget/safety ceiling.
- Ordinary Where can still use cached indexed transfers after a terminal
  targeted provider-cap state to produce funding-first context. That context is
  not the same as exact covered history.
- Funding-first exact-window repair is not a separate queued indexing mode yet;
  probable capped-window findings remain non-final context.
- Old incorrectly completed targeted states from pre-fix/dev runs need the
  maintenance repair before they can be trusted. The repair path exists, but it
  is not an automatic production migration.
- Admin graph can still show `History not fully fetched` for old or partial
  jobs.
- Split depth/window progress is not yet shown as a first-class Admin field.
