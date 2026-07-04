---
status: current
last_verified: 2026-07-04
owner_area: docs
code_refs:
  - src/index.ts
  - src/risk/unifiedWalletRisk.ts
  - src/check/deepForensicCheck.ts
  - src/forensics/tronAddressAllTimeIndex.ts
  - src/forensics/incomingDepositJob.ts
  - src/forensics/deepForensicJob.ts
  - src/forensics/fundingFirstSourceProvenance.ts
  - src/forensics/moneyOriginOperationalAssessment.ts
  - src/forensics/strictProvenanceBenchmark.ts
  - src/forensics/targetedHistoryCoordinator.ts
  - src/forensics/addressIndexWorker.ts
  - src/forensics/targetedIndexRepair.ts
  - tests/forensics/targetedHistoryCoordinator.test.ts
supersedes:
  - docs/superpowers/specs/2026-07-03-project-knowledge-workflow-design.md
  - docs/superpowers/specs/2026-07-03-where-incoming-outcome-safety-design.md
---

# Current Decisions

This file is the short current-decision list. If a future change reverses one
of these decisions, update this file in the same work.

## Product

- The check modes remain separate: fast, deep, where, incoming.
- Unified `/check` composes signals; it is not a replacement for the separate
  jobs.
- `Where is money` explains where relevant wallet funds came from.
- `Incoming deposit` explains one concrete deposit.
- `DeepCheck` builds a wider forensic profile.

## Provenance Completeness

### Current Behavior

- `History not fully fetched` is emitted when hop history does not reach the
  required timestamp.
- Some paths now block final score with `score_valid=false`.
- A guarded approval-drain review with legitimate service context and no hard
  bad evidence should not become a final user-facing `DECLINE`.
- Admin-only strict benchmark has partial waiting/resume behavior for targeted
  index tasks.
- Ordinary `Where is money` has waiting/resume behavior for required targeted
  hop history. Stage 1.8 includes background retry escalation, adaptive cursor
  splitting for capped TronScan windows, cache-aware saved-page resume, lock
  heartbeat, same-address covering-target lookup, and retry of old local-budget
  partial provider-cap states.
- Ordinary `Where is money` can run bounded exact-window repair for probable
  source-provenance candidates. It may upgrade a candidate to `exact` only when
  the candidate-to-target window is covered and spend/amount-continuity checks
  pass.
- Ordinary `Where is money` Admin graphs render saved funding candidates only
  when they attach to concrete route hops. Exact candidates can be shown as
  funding edges; probable candidates remain context; over-limit candidate tails
  are grouped. This is not DeepCheck relationship expansion and does not add
  arbitrary wallet neighbors.
- Ordinary `Where is money` can publish a valid `REVIEW` score when the only
  unresolved source-provenance residue is below materiality and has no hard
  evidence. Current local thresholds are 1% and 100 USDT. The unresolved residue
  must remain visible as a caveat.
- Old false `complete` targeted states from dev/pre-fix runs are repaired by a
  maintenance script, not by ordinary user flow.

### Planned Behavior

- `History not fully fetched` is not an acceptable final paid result when the
  gap is caused by our local budget or partial index state.
- A service boundary is a legitimate stop.
- A local page-budget stop is not a legitimate source-of-funds conclusion.
- Final score should not be published as valid when the main money path is not
  covered, except for explicit low-materiality residual source-provenance
  caveats with no hard evidence.
- If data is incomplete and cannot yet be scored, use `score_valid=false` and
  explain the technical block.
- `Incoming deposit` still needs the same resumable indexing flow before this
  decision is fully implemented across provenance modes.

## Data Source

### Current Behavior

- TronScan is the source for TRON USDT history in this phase.
- The scheduler supports a pool of TronScan API keys and account groups.
- Inline live targeted history is capped by `TARGETED_HISTORY_INLINE_MAX_PAGES
  = 4`.
- Queued Where hop targeted indexing uses a larger Stage 1.8 background
  budget/depth ceiling.

### Planned Behavior

- Do not add manual CSV import as a product workflow.
- Do not add another provider for this phase.
- More keys help throughput, but they do not solve local targeted budget or
  partial-state handling by themselves.

## DeepCheck

### Current Behavior

- DeepCheck all-time direct boundary works when the subject all-time index is
  complete and materializable.
- Direct hard-evidence checks for direct counterparties work.
- Second-layer metrics can still be empty even with a configured budget.

### Planned Behavior

- Second-layer work should become real and metrics must reflect actual queued
  and completed work.

## Known Gaps

- `Incoming deposit` still does not have a general resumable indexing flow to
  full main-path coverage.
- Budget escalation exists for ordinary Where targeted indexing, but the limits
  are still code constants rather than job-level/runtime product config.
- DeepCheck second-layer work is still partial/planned.

## Development Environment

- `docs/knowledge` is the current source of truth.
- Older specs, plans, research, and walkthrough docs are historical detail.
- Documentation is not code proof. Verify implementation before claiming
  current behavior.
