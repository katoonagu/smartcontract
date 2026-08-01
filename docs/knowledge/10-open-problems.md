---
status: current
last_verified: 2026-08-01
owner_area: docs
code_refs:
  - scripts/captureWhereLatencyReplay.ts
  - scripts/runWhereLatencyCanary.ts
  - scripts/runUnifiedWalletCanary.ts
  - scripts/runUnifiedAdaptiveBenchmark.ts
  - src/unifiedCheck
  - src/unifiedCheck/providerRequest.ts
  - src/unifiedCheck/serviceRoleShadow.ts
  - src/forensics/chronologicalProportionalLedger.ts
  - docs/superpowers/specs/2026-07-24-unified-wallet-check-adaptive-rolling-planner-design.md
  - docs/superpowers/specs/2026-07-31-stage-c-runtime-blind-and-stage-d-exact-scoring-design.md
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
- The repaired recorder path has a second fail-closed blocker. Recorder commit
  `6bf24285` has behavior tree
  `f9a294399150075f2f832fe681917fa1ceb1acbc75b5c82f473aa9bd6468a1c8`,
  while the approved historical tree is
  `b5ad8d43fbcfd693f8d998100f22070c0ef4dbbeeb228e5eeb0e722b3831fde2`.
  The approved historical checkout does not expose the later execution
  `dispose` and replay-schema contracts required by the repaired recorder.
  Resolve this as a reviewed recorder-identity design; do not rewrite the
  baseline hash or behavior files merely to obtain a fixture.
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
- The former PostgreSQL proof gap is closed locally: on 2026-07-29 the dedicated
  `tron_watch_plan3` database verified schema 037, four migration tests passed,
  and 168 claim-generation/fairness/evidence/delivery tests executed without
  skips. This does not supply replay, deployment, canary, Deep, or rollout
  evidence.

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

## Stage C And Stage D Authority Acquisition

- C0 physical-population Task 3 stopped before files, tests or a commit. The
  nine required query literals and nine artifact-kind literals currently exist
  only in its plan; no exact owning schema versions, codecs, fixtures or real
  producers define their inventory/leaf rows, joins, eligibility/candidate
  derivation, provider exhaustion, or EOA/order/role/control/adverse-witness
  formats. Do not implement private codecs or synthesize complete authority.
  C0a and C2-C4 remain blocked until a separately reviewed amendment freezes
  those schemas and connects them to real producers.
- C0b has not started. Accepted history still lacks authoritative transaction
  order and an independent pinned USDT balance witness, so its available-real
  control cannot be constructed honestly.
- The former C1 Task 3 PostgreSQL gap is closed: its real database file passes
  `18/18` with zero skips, including a deterministic two-connection race that
  converges on one atomic unreferenced bundle/V1-map/V2-wrapper trio. C1 Task 4
  is also closed: one immutable run-wide input set/fence now reuses only strict
  run-owned wrapper/V1-map/bundle closure, treats corrupt non-hash wrapper keys
  as malformed without placing them in strict observed hashes, and passes
  `22/22` unit plus `6/6` real PostgreSQL tests with zero skips. Together Tasks
  3+4 pass `24/24` PostgreSQL tests. The preload ceiling is one normal plus at
  most two publication attempts with separate 1,000 ms deadlines, or about
  3,000 ms plus jitter under an indefinitely held external lock. Exhaustion
  evicts the rejected cache entry; a later caller can retry and rescan only
  while no durable fence exists. C1 Tasks 5-10, including coordinator/config
  wiring, post-checkpoint reconciliation, non-interference and the evidence
  producer, have not started. The enabled config literal remains unwired.
- Current account metadata does not prove EOA status at a historical anchor.
  Stage C needs either a block-bound historical account-state witness or a
  complete account-role timeline. If no provider can supply one, inferred
  service boundary remains unavailable and traversal continues in full.
- Accepted Unified transfer rows do not carry authoritative transactionIndex.
  Provider row order cannot replace transaction position inside a block.
- Current snapshots do not provide an independent pinned USDT balance witness.
  Until exact transaction order, complete history and that balance witness are
  available together, the production cashflow adapter must return typed
  unavailable.
- Only one of 3 745 accepted histories currently has a complete 200/200
  role-map binding. Runtime shadow must treat missing maps as expected
  coverage, avoid one database row per skip and avoid presenting the historical
  map as authority for a different runtime commit or anchor.
- The current role-map V1 has no route-anchor or sampled-event-set binding, and
  no post-checkpoint reconciliation proves that a precommit shadow observation
  corresponds to committed traversal state. The artifact table also has no
  run/kind lookup index, so C1 must use an additive anchor-bound wrapper and one
  frozen run-wide input-set load rather than per-state scans.
- The existing 21-address manual research workbook must receive an immutable
  canonical export with its original source hash. The current runtime fixture
  preserves addresses, vectors and source hashes but not every manual
  explanation field.
- No new non-overlapping, deterministically sampled blind 24 + 6 corpus with
  mandatory subject/contract/incomplete negative strata, two-review lock,
  adjudication or acceptance receipt exists yet.
- Matrix-v5 exact numeric rows do not exist. They must be adjudicated after
  Stage C closure and cannot be selected opportunistically during
  implementation.

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

`npm.cmd run db:migrate` still replays every legacy migration below schema 032
before entering the tracked receipt chain. On a populated database this can
repeat a long `ALTER TABLE tron_usdt_transfers`, hold a relation lock, and
outlive the invoking shell timeout. Until the legacy runner skips migrations
already implied by the schema-032 receipt, production rollout must apply the
current tracked migration through `applyVerifiedTrackedMigration` and then run
`schema:verify`; do not start a second migration process or terminate an
unverified PostgreSQL backend.

## Anti-Loop Rule

Every rerun answers a changed input or diagnostic hypothesis. A repeated
identical failure becomes a specific blocker; it does not reopen completed
milestones or the whole plan.
