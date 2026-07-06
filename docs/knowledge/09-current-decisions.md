---
status: current
last_verified: 2026-07-06
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
- Ordinary `Where is money` queues durable candidate-window targeted indexing
  before broad targeted fallback for probable source-provenance candidates. A
  candidate window has a lower and upper timestamp plus candidate identity; it
  does not count as broad address-history coverage.
- Ordinary `Where is money` does not queue broad targeted history just because
  candidate windows were requested or are pending. Ordinary material unresolved
  or aggregate unresolved source exposure also does not automatically queue the
  old broad `genesis -> targetTimestamp` targeted index. The normal path is a
  bounded balance-forming slice for the concrete hop: read incoming history only
  up to the target transfer and only far enough to explain the target amount,
  then continue through the funders that formed that spend. If the bounded slice
  cannot cover the amount, the result stays an unresolved/pre-existing/dense
  caveat according to materiality rules instead of starting a 12k-page broad run.
  Service/CEX boundaries stop before candidate-window, balance-slice, or broad
  fallback work for that boundary address.
- Ordinary `Where is money` post-assessment broad fallback is reserved for
  unresolved source branches that intersect hard evidence, such as exact
  approval-drain provenance. Material unresolved context alone is not hard
  evidence and does not trigger broad fallback.
- Ordinary `Where is money` Admin graphs render saved funding candidates only
  when they attach to concrete route hops. Exact candidates can be shown as
  funding edges; probable candidates remain context; over-limit candidate tails
  are grouped. This is not DeepCheck relationship expansion and does not add
  arbitrary wallet neighbors.
- Ordinary `Where is money` can publish a valid `REVIEW` score when the only
  unresolved source-provenance residue or dense-hop provider-cap tail is below
  its materiality thresholds and has no hard evidence. Residual thresholds are
  1% and 100 USDT; dense-hop thresholds are 1% per branch, 2% aggregate, and
  10,000 USDT per branch. The unresolved branch must remain visible as a caveat.
- Exact approval-drain evidence is a 95/100 critical hard floor across FastCheck,
  DeepCheck, and unified final scoring. The saved `approval_drain_proximity`
  system label inherits the same floor because it represents prior exact
  approve -> transferFrom -> receiver evidence. Telegram must explain that hard
  evidence first and move behavior/transit signals to additional context.
- Sanctioned crypto-service labels from explorer/service text are matched
  through a local registry with aliases, authority, and official designation
  date. A traced event is treated as `sanctioned_service` only on or after that
  service's designation date; before that date, HTX/Huobi remains ordinary
  `htx_huobi` source-policy context.
- Medium source-policy context must not be flattened to `ACCEPTABLE`.
  Low-score HTX/Huobi policy exposure remains user-facing `REVIEW`, and simple
  alert score display maps 45-59 to `REVIEW` instead of `ACCEPTABLE`.
- Unified final scoring preserves matrix `REVIEW` as user-facing `REVIEW`.
  Review-only source-policy, contract-suspicion, and pattern rows should give a
  clear final state plus review requirement, not a final `ACCEPTABLE` label.
- Final Telegram address reports are user-facing compliance summaries, not
  scoring dumps. Matrix `REVIEW` displays as `REVIEW`, exact hard evidence is
  deduplicated into one clear reason, and raw scoring diagnostics stay in
  support/admin/debug surfaces.
- A fresh ordinary Where job resumed from targeted `partial_provider_cap`
  progress must run the report builder and materiality assessment before
  deciding score validity. It must not complete directly from
  `provider_limited` progress with a minimal `provider_cap_unresolved` result.
- Old false `complete` targeted states from dev/pre-fix runs are repaired by a
  maintenance script, not by ordinary user flow.
- Wallet Intelligence is Admin-only investigative context. Completed or partial
  DeepCheck, Where, and Incoming jobs are best-effort indexed only after the job
  completion update succeeds, using already collected saved payloads. It stores
  cross-run sightings and edges, does not call TronScan, does not create labels
  or assertions, does not write risk observations, and does not affect scoring,
  Telegram output, or the original job result. Index failures are logged as
  runtime warnings.

### 2026-07-05 Dense-Hop Materiality For Where

- Dense-hop materiality changes scoring interpretation only; it does not change
  TronScan indexing or provider fetching.
- A provider-capped dense-hop unresolved source tail can be a score-valid caveat
  only below branch and aggregate thresholds and with no hard evidence.
- The tail stays visible in Admin and Telegram and is excluded from decisive
  clean/bad evidence. It is not a clean verdict.
- Material unresolved source, threshold failure, or hard evidence still blocks
  final scoring or drives the result.
- Old cached failed jobs are not silently recalculated. A fresh check must build
  a new result before Admin, bot, or support treats the dense-hop materiality
  policy as applied.

### Planned Behavior

- `History not fully fetched` is not an acceptable final paid result when the
  gap is caused by our local budget or partial index state.
- A service boundary is a legitimate stop.
- A local page-budget stop is not a legitimate source-of-funds conclusion.
- Final score should not be published as valid when the main money path is not
  covered, except for explicit low-materiality source-provenance caveats with no
  hard evidence.
- If data is incomplete and cannot yet be scored, use `score_valid=false` and
  explain the technical block.
- `Incoming deposit` uses the shared candidate-window-first targeted
  wait/resume primitive, but still has separate gaps around terminal
  provider/budget stops and product progress visibility before provenance
  completeness is fully implemented across modes.

## Data Source

### Current Behavior

- TronScan is the source for TRON USDT history in this phase.
- The scheduler supports a pool of TronScan API keys and account groups.
- Inline live targeted history is capped by `TARGETED_HISTORY_INLINE_MAX_PAGES
  = 4`.
- Broad Where hop targeted indexing, when required by an unresolved
  hard-evidence branch, uses a larger Stage 1.8 background budget/depth
  ceiling. Ordinary material unresolved context uses candidate windows and the
  bounded balance-forming slice instead of this broad run.
- Candidate-window targeted indexing reads only
  `windowStartTimestamp -> windowEndTimestamp`; broad targeted indexing remains
  `genesis -> targetTimestamp`.

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

### 2026-07-05 DeepCheck Drainer-Campaign Visibility

- DeepCheck separates broad drainer-campaign context from exact approval-drain
  proof.
- Canonical USDT transfers stay plain; Verify20 and similar non-USDT wrapper
  calls are campaign context until exact approval/provenance proof is
  established.
- Reports include enrichment denominators and complete/lower-bound status so
  partial campaign counts are not presented as complete totals.

### Planned Behavior

- Second-layer work should become real and metrics must reflect actual queued
  and completed work.

## Known Gaps

- `Incoming deposit` has the shared candidate-window-first targeted
  wait/resume primitive, but full main-path coverage and progress visibility are
  still less complete than ordinary Where.
- Budget escalation exists for ordinary Where targeted indexing, but the limits
  are still code constants rather than job-level/runtime product config.
- DeepCheck second-layer work is still partial/planned.

## Development Environment

- `docs/knowledge` is the current source of truth.
- Older specs, plans, research, and walkthrough docs are historical detail.
- Documentation is not code proof. Verify implementation before claiming
  current behavior.
