# Unified Fast Fix: Evidence Boundary And Immediate Refill Design

**Status:** approved design; implementation pending

**Date:** 2026-07-26

## Purpose

Reduce unnecessary Unified traversal work and eliminate avoidable provider-slot
gaps without weakening ordered commit, restart determinism, fairness, or full
traversal closure.

The saved dense-wallet run exposed two separate costs:

- production traversal discovered roughly 1,177 address histories and fetched
  roughly 6,926 provider pages while the frontier was still expanding;
- with four healthy configured key groups and ready work, observed provider
  occupancy averaged 2.39 of 4 slots and reached 4 of 4 in only 20.2% of
  samples.

Memory, swap, and provider health were not persistent limiting conditions in
that observation. The ten-minute marker remains a comparison metric, not a
timeout or correctness boundary.

## Verified Current State

The repository already contains a pure `evaluateBoundaryV1()` implementation
and frozen provenance-bearing label records. The production traversal
coordinator does not call it. Production instead uses
`unifiedTraversalBoundary()`, which treats broad legacy label strings as
terminal without the full event-time evidence contract.

The provider runtime already has an event path:

```text
chunk boundary -> controller wake -> controller cycle -> permit -> claim
```

The provider pool also already rejects assignments whose expected slot epoch
is stale. The concrete refill gap is that the controller-facing
`assignProviderPermits()` contract discards the pool's accepted-assignment
result. A proposed assignment can therefore be counted as actionable even
though the pool rejected it after an epoch race. Recovery can then wait for a
later wake or the reconciliation tick.

Provider demand already includes eligible planned backlog, not only currently
admitted rows. This design does not add a second demand model.

## Goals

- Stop a traversal branch before creating downstream address-history work when
  an exact frozen custodial/CEX boundary is proven for the canonical state.
- Treat hints, unknown addresses, legacy risk labels, bridge/DEX identities,
  and unproved contract roles as non-terminal.
- Preserve the behavior of already-created runs across deploy and restart.
- Make accepted versus rejected provider assignments explicit and recover a
  stale-epoch rejection through an immediate coalesced controller cycle.
- Use all four currently available groups during saturated provider intervals,
  subject to provider pacing and the existing resource guards.
- Attribute idle capacity to the decision that actually stopped work.
- Prove exact barrier/rolling equivalence on frozen replay and run one isolated
  four-group dense-wallet canary.

## Non-goals

This patch does not add:

- PostgreSQL migrations;
- API keys or provider groups;
- route-dependent bridge/DEX boundaries;
- contract-economic or historical-restriction boundaries;
- order-independent merge;
- worker-local claims;
- adaptive chunk tuning or PID control;
- cross-run address-history caching;
- arbitrary hop/page limits;
- scoring, Telegram report, or Admin UI changes.

## Traversal Policy Versioning

`AnalysisManifestV1.traversalPolicyVersion` accepts two immutable values:

```text
snapshot-closure-v1
snapshot-closure-v2
```

The manifest remains the authority after restart.

- Existing runs retain `snapshot-closure-v1` and the current boundary behavior.
- New isolated canaries may explicitly select `snapshot-closure-v2`.
- User checks remain on v1 until the v2 canary gate passes.
- After rollout, new user checks default to v2.
- A fallback changes only the default for new runs; it never reinterprets an
  existing v2 run as v1.

The startup-only `UNIFIED_TRAVERSAL_POLICY_VERSION` selector is validated to
one of those two values. The isolated canary command overrides the value only
for the canary run it creates; it does not mutate the process default. The run
creation transaction persists the selected value through the existing
immutable analysis-manifest artifact. No relational schema change is needed.

For v2, `labelCatalogVersion` and `boundaryPredicateVersion` are required and
must match the pinned frozen dataset. Their legacy optionality remains only for
reviving pre-P1 v1 manifests.

## Evidence-backed Custodial Boundary

### Authoritative input

The coordinator loads the exact `unified-frozen-label-dataset-v1` artifact by
`manifest.labelDatasetSha256` and verifies:

- the artifact fingerprint;
- the dataset snapshot hash against the run snapshot;
- label catalog version;
- boundary predicate version;
- each frozen record's authority, source payload hash, address, and validity
  interval.

`legacyRows` remain compatibility/context data. They cannot authorize a v2
terminal decision. Live classification is not called from traversal.

### Evaluation

For every canonical `TraversalStateV1`, the coordinator calls
`evaluateBoundaryV1()` with:

- frozen label records for the state's address;
- the state's `anchorTimestamp` as event time;
- no restriction artifact;
- no route proof;
- no economic-role proof;
- no structural proof.

An explicit v2 safety filter accepts a terminal result only when the selected
catalog entry has `terminalPolicy = custodial_boundary` and the evaluator
returns `identified_service_boundary`. Every other result is non-terminal in
this version even if future inputs or predicates become available.

This deliberately removes label-only restriction closure from v2. A scam,
stolen-funds, phishing, or similar legacy label remains risk context, but it
does not prove a restriction valid at the event time. Historical restriction
closure requires a separate provenance-bearing artifact and a later design.

### Mixed states for one address

Boundary evaluation is state-scoped, not merely address-scoped. One address may
appear with different directions, funding episodes, or event timestamps.

The coordinator deterministically partitions the frontier states for an
address into terminal and continuing states:

- terminal states are committed through a bounded traversal delta;
- continuing states remain in the frontier;
- one address-history manifest is still planned and reused when at least one
  state for that address continues;
- address-history work is omitted only when no mandatory continuing state for
  that address remains.

Terminal processing is ordered by the existing canonical traversal identity
and bounded by the existing commit entry/byte limits. Capacity and worker
completion order do not affect it.

### Boundary evidence

Each accepted v2 boundary persists one immutable
`unified-traversal-boundary-evidence-v2` artifact containing:

- traversal policy and predicate versions;
- canonical state identity;
- event timestamp;
- terminal reason;
- snapshot hash and frozen label dataset hash;
- catalog entry ID and terminal policy;
- label authority and source payload hash.

The traversal terminal record references the canonical hash of this evidence.
The artifact contains no provider page hashes because the skipped history was
not fetched. Failure after artifact insertion but before checkpoint commit is
safe: the content-addressed insert is idempotent and the pinned inputs reproduce
the same hash.

Only the traversal coordinator mutates canonical frontier/terminal state. An
address-history worker never decides closure. Barrier and rolling therefore
share the same v1/v2 evaluator and commit behavior.

## Immediate Controller-owned Refill

### Accepted assignment contract

Change the controller callback from a fire-and-forget shape to:

```ts
assignProviderPermits(assignments): AcceptedAssignment[]
```

The provider pool remains the slot-epoch authority. The controller distinguishes:

- proposed assignments;
- assignments accepted by the pool;
- assignments rejected because the slot became active, already had a pending
  assignment, retired, or changed epoch.

`actionableProviderSlots`, the pool target, active/idle reporting, and per-run
assigned-slot counts use accepted assignments only. A theoretical allocation
is never reported as active capacity.

### Stale-epoch recovery

If at least one proposal is rejected while eligible provider work and safe
capacity still exist, the current controller cycle requests one immediate
coalesced controller wake. The next cycle reads fresh:

- slot epochs and occupancy;
- provider group health;
- durable demand and admission;
- owner/run fairness;
- resource guards.

It creates new permits rather than reusing rejected ones. The worker never
claims directly and never keeps a permit across chunk boundaries.

Only one controller cycle and one pending wake may exist at a time. A wake that
arrives during a cycle sets the pending bit. The fresh cycle does not schedule
another immediate retry when the actual outcome is provider pacing, cooldown,
resource pressure, no eligible work, canonical-head wait, merge-buffer full,
or fairness wait. The periodic reconciliation tick remains the durable recovery
path after process restart or a lost best-effort wake.

Task admission, leases, accepted attempts, and ordered commit remain unchanged.
An in-flight HTTP request is not interrupted.

## Observability

Observability remains best-effort and cannot block acceptance, checkpoint, or
commit.

For benchmark/runtime diagnosis, record monotonic durations for:

```text
chunk finished
checkpoint or acceptance finished
controller decision finished
permit accepted
next task claimed
```

Add bounded aggregate counts for proposed, accepted, and stale-epoch-rejected
assignments. Do not add run IDs, owner IDs, task IDs, or key material as metric
labels.

Reuse the existing stable decision reasons:

- `no_eligible_work`;
- `fairness_wait`;
- `provider_rate_paced`;
- `provider_cooldown`;
- `provider_circuit_open`;
- `canonical_head_wait`;
- `merge_buffer_full`;
- `db_pressure`;
- `memory_pressure`;
- `admission_closed`.

Add `checkpoint_or_commit` only for a decision made while the normal bounded
checkpoint/commit transition is the actual reason a target slot cannot be
filled. Do not reconstruct it later from gauges. A stale-epoch rejection is a
measured assignment outcome, not a generic idle reason.

## Failure Behavior

- Missing, malformed, or hash-mismatched v2 frozen evidence is a technical
  failure. It does not silently continue with empty labels.
- Unsupported or insufficient evidence returns non-terminal and traversal
  continues.
- A boundary artifact mismatch is an invariant failure; no checkpoint is
  committed.
- A rejected slot assignment does not alter task state and is retried only
  through a fresh controller decision.
- Provider cooldown and pacing use the existing scheduler and do not trigger a
  refill busy-loop.
- Restart reloads the traversal policy from the immutable manifest, committed
  deltas from PostgreSQL, and accepted manifests from the planner chain.
- Fallback affects new-run policy only. It cannot change hashes of an active
  run.

## Verification

### Targeted tests

Boundary tests prove:

- v1 retains its existing behavior across restart;
- exact frozen custodial/CEX evidence closes only the matching v2 state;
- a hint, unknown address, legacy risk label, later-valid label, bridge/DEX,
  and generic contract all continue;
- mixed states for one address are partitioned correctly;
- a continuing state still causes one reusable address history to be planned;
- capacity and completion order do not change boundary facts;
- boundary evidence binds exact state, timestamp, snapshot, dataset, catalog,
  authority, and source payload hashes;
- restart neither reopens a terminal state nor duplicates a commit.

Refill tests prove:

- a deliberately stale epoch rejects the first assignment;
- the rejection is excluded from actionable/assigned counts;
- one coalesced fresh cycle assigns the current epoch without waiting for the
  reconciliation interval;
- repeated wakes do not create concurrent controller cycles;
- pacing/cooldown/no-work outcomes do not spin;
- a new interactive run receives its fair share at the nearest bounded chunk
  boundary;
- four logical slots stay filled while at least four tasks are eligible and no
  blocker applies.

### Frozen replay

Run barrier and rolling against one identical frozen provider replay, snapshot,
clock, identities, label dataset, and traversal policy version. For each policy
version, require exact equality of:

- frontier and terminal facts;
- closure certificate;
- score and decision;
- evidence, report, and presentation hashes;
- restart/retry result.

V1 and v2 are separate policies and are not required to have equal hashes to
each other.

### One live canary

After targeted and replay gates pass, run exactly one isolated canary for the
preserved dense-wallet subject referenced by the saved baseline evidence, with
the four currently configured healthy groups. It creates no Telegram delivery
intent.

Capture:

- wall time, discovered histories, provider pages, and terminal boundaries;
- active slots and the fraction of 4/4 saturated samples;
- checkpoint-to-next-claim p50/p95;
- requests per group, rolling RPS, errors, and 429;
- limiting reasons and assignment rejection counts;
- process RSS/heap, vmmemWSL, Linux available memory, and swap before, during,
  and after the run;
- internal closure, score, decision, and evidence identities.

A separate live run may observe a different chain/provider snapshot and is not
an exact hash oracle. Exact equality belongs to frozen replay.

## Acceptance Criteria

The patch is accepted only when:

- frozen barrier and rolling results are exactly equal for the same policy;
- v2 skips history only behind exact frozen custodial/CEX evidence;
- insufficient evidence never creates false closure;
- restart preserves the selected policy and creates no duplicate commit;
- stale-epoch assignment rejection recovers through the event path rather than
  the reconciliation interval;
- during intervals with capacity at least four, at least four eligible tasks,
  healthy groups, and normal resources, average occupancy is at least 3.5/4;
- every saturated idle sample has the actual limiting reason;
- all four configured groups perform provider requests;
- memory remains bounded and swap does not show sustained growth;
- the live canary reduces wall time and/or mandatory provider work versus the
  saved baseline without weakening closure;
- the isolated canary creates zero delivery intents.

Short bounded checkpoint and commit pauses are included in saturated
utilization. Overall run-average occupancy is not an acceptance gate because it
mixes provider saturation with sequential analysis and finalization phases.

## Rollout And Fallback

1. Ship code capable of running both v1 and v2 while keeping new user checks on
   v1.
2. Run targeted tests and exact frozen replay.
3. Run one isolated v2 canary for the preserved dense-wallet baseline subject
   with four groups and memory capture.
4. If all gates pass, switch the startup default for new user checks to v2.
5. Preserve all existing manifests and active-run semantics.
6. On regression, return the new-run default to v1; do not reinterpret or
   cancel active v2 runs automatically.

Only if four-slot utilization remains poor after this patch should a separate
design consider adaptive chunks, cross-run history reuse, or a larger provider
pool handoff change.
