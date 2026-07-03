---
status: current
last_verified: 2026-07-03
owner_area: forensics
code_refs:
  - src/forensics/moneyOriginTrace.ts
  - src/forensics/moneyOriginOperationalAssessment.ts
  - src/forensics/incomingDepositJob.ts
  - src/forensics/deepForensicJob.ts
  - src/index.ts
  - tests/forensics/moneyOriginTrace.test.ts
  - tests/forensics/moneyOriginOperationalAssessment.test.ts
  - tests/forensics/incomingDepositJob.test.ts
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

Incoming deposit can also produce `scoreValid=false` when targeted coverage is
blocked.

Ordinary `Where is money` and `Incoming deposit` do not yet have a shared
general resumable indexing flow that keeps requesting targeted hop history
until the main path is fully covered.

The live targeted index path currently uses
`TARGETED_HISTORY_INLINE_MAX_PAGES = 4`, so active hop addresses can still stop
with incomplete history.

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

Planned behavior: in these cases, the job requests more indexing and continues
when coverage is available. Current ordinary jobs only do this partially.

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

- Ordinary Where/Incoming still lack the general continue-indexing-then-resume
  loop.
- The targeted live budget is four pages per targeted run.
- Partial targeted states can be reused as terminal in strict benchmark.
- Admin graph can still show `History not fully fetched` for old or partial
  jobs.
