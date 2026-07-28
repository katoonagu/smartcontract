---
status: current
last_verified: 2026-07-27
owner_area: docs
code_refs:
  - scripts/captureWhereLatencyReplay.ts
  - scripts/runWhereLatencyCanary.ts
  - scripts/runUnifiedWalletCanary.ts
  - scripts/runUnifiedAdaptiveBenchmark.ts
  - src/unifiedCheck
  - docs/superpowers/specs/2026-07-24-unified-wallet-check-adaptive-rolling-planner-design.md
---

# Open Problems

## Provider Replay Evidence

- Capture canonical provider request identities and response pages for TPCP,
  TFWG, and TXc, then freeze the bundles. Existing request-only logs do not
  contain enough response data for a truthful before/after replay.
- The TXc legacy `where_is_money_check` replay capture is blocked: the configured
  database has no completed job for `TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd` to
  freeze. Do not create a synthetic replacement. Stage B release and concurrency
  2 remain blocked until the capture is made from the pre-Stage-B commit with its
  full provider/DB dependency tape and supplemental raw/full transaction facts.
  The expected checked-in path is
  `tests/fixtures/forensics/txc-legacy-where-latency-v1.json`; the 2026-07-27
  final replay audit found it missing and stopped with
  `where_latency_replay_fixture_missing`, as required.
- Exact barrier-versus-rolling hash comparison remains tied to one frozen
  provider snapshot. Separate live runs cannot substitute for it.

## Live Capacity Boundary

The controller and deterministic simulation support logical capacities through
100. Real throughput, provider grouping, RPS, cooldown behavior, and memory are
only proven up to the largest live pool actually exercised.

Before raising a configured production ceiling:

- audit that added keys are independent provider groups rather than aliases of
  one account limit;
- run the one-wallet, three-wallet, newcomer, slow-head, cooldown, buffer-full,
  and restart scenarios at the proposed ceiling;
- verify closure and no external delivery for isolated runs;
- capture process/container or host memory, DB latency, checkpoint latency,
  active/idle slots, requests per group, errors, and 429;
- explain idle capacity with a stable limiting reason.

Local WSL measurements remain diagnostic. The real production ceiling needs an
equivalent Linux container/cgroup or host-memory run.

The policy-specific production-path PostgreSQL oracle and separate scheduler
replay are complete for logical capacities 1, 4, 8, 16, 32, and 100. They do
not verify live
utilization. The selected isolated TXc canary, independent-group dispatch,
zero-error saturated refill, and target Linux memory gate remain outstanding;
until they pass, user checks and rollout stay on V1.

A selected-canary PostgreSQL authorization marker without a completed index is
intentionally fail-closed: automatic retry could create a second batch. The
terminal maintenance marker is never automatic-cleanup material. Recovery
currently requires operator investigation of the marker and any recorded
run/control plus an explicit decision about the orphan; automatic continuation
is deferred until a durable phase-resume protocol can prove ownership of every
phase.

## Stage B Operational Evidence

- No accepted concurrency-two receipt exists under
  `outputs/where-latency-canary/`. This checkout also has no dedicated canary
  clone/configuration, pre-authorized immutable deployment receipt, or
  deployment-owned attested runtime adapter. Do not run the harness against a
  shared environment.
- Deep remains one slot. Its required
  `where-latency-deep-residual-v1` measurement has not been produced, so Deep
  queue/provider residual latency is unmeasured rather than zero.
- The 2026-07-27 local release gate had no `TEST_DATABASE_URL` or
  `DATABASE_URL`. PostgreSQL-gated tests therefore skipped and `schema:verify`
  could not connect. Deterministic coverage is code evidence only; real
  claim-generation/fairness and schema verification remain required before the
  canary.

## Dense Traversal Performance

Durable ordered commit intentionally permits head-of-line blocking. Canonical
head priority, adaptive bounded lookahead, short chunks, and per-run buffer
isolation reduce the cost. Order-independent merge remains deferred until
benchmark data shows that `canonical_head` or `merge_buffer_full` loss is a
material bottleneck and commutativity is proven by invariants and property
tests.

The next saturation component after provider capacity—DB, CPU analysis,
checkpoint throughput, or memory—must be determined from measurements. Full
feedback control for analysis/finalization is not justified until then.

`checkpoint_or_commit` still lacks a direct causal signal proving that the
transition holds the last otherwise-fillable provider slot. Do not reconstruct
that explanation after the fact; add it only when the runtime emits the direct
signal with tests.

## Product Follow-Ups

- Blind-review/adjudicate the P1 positive and negative boundary cases before
  enabling those predicates or creating exact expected scores.
- Recipient wallet precheck before signing.
- Additional Admin exploration and presentation refinements that do not change
  correctness contracts.
The former silent old-runtime orphan is closed by schema 037: incompatible
unfinished work now receives a no-score technical terminal state and a durable
user notification. Dense traversal duration remains a separate performance
problem and is not reclassified as a handoff failure before the deadline.

## Anti-Loop Rule

Every rerun answers a changed input or diagnostic hypothesis. A repeated
identical failure becomes a specific blocker; it does not reopen completed
milestones or the whole plan.
