---
status: current
last_verified: 2026-07-25
owner_area: docs
code_refs:
  - src/index.ts
  - src/storage/schemaMigrations.ts
  - src/runtime/startupSchemaGate.ts
  - src/unifiedCheck
  - src/release/unifiedReleaseGateReceipt.ts
  - src/risk/scoringSignalMatrixV4.ts
  - src/risk/scoreAnchorV3.ts
  - migrations/033_unified_wallet_check.sql
  - docs/superpowers/specs/2026-07-24-unified-wallet-check-adaptive-rolling-planner-design.md
  - scripts/verifyRemediationRelease.ts
  - scripts/runSchema032ReleaseSequence.ts
  - scripts/finalizeUnifiedReleaseGates.ts
  - scripts/captureUnifiedWslMemory.ps1
---

# Current Decisions

## Status Boundary

Production is still the legacy runtime and delivery path. Unified Wallet Check
is implemented and tested in the release candidate but is not deployed.
Nothing in this page claims a production backup, schema-033 migration, runtime
cutover, generation-fence activation, or live canary.

Historical Plan 1–5 chronology lives in `docs/superpowers/plans`, specs, and
audit artifacts. It is not a second source of current product truth.

## Unified Product Contract

- One logical `/check` owns one parent run and at most one automatic Telegram
  send.
- Fast, Where, and Deep keep separate analytical responsibilities but are
  evidence-only children.
- No preliminary or branch-owned Telegram result is sent.
- `COMPLETED` always has one score and decision.
- `FAILED_TECHNICAL` has no score, decision, report, presentation, or delivery.
- Coverage is audit metadata. It never adds risk or blocks a completed score.
- `DELIVERY_UNKNOWN` forbids automatic retry. Manual resend is explicit,
  warned, and audited.

## Evidence, Traversal, And Scoring

- Every run binds one confirmed snapshot.
- Direct history exhausts snapshot-bounded pages; traversal terminates through
  exhaustion or evidence-backed boundaries, never a product coverage target.
- Dense graphs remain finite through canonical deduplication, equivalent-state
  merging, and closure certificates.
- Address history is content-addressed once per snapshot/address and reused by
  separate funding allocations. Checkpoints are bounded heads over immutable
  chunks/deltas, with deterministic V1-to-V2 rollout.
- The candidate traversal path uses schema-034 planner rows end to end. The
  traversal checkpoint transition atomically commits a bounded ready prefix,
  appends newly discovered histories in canonical parent order, and admits one
  lifecycle-valid barrier head. Initial tasks use a sentinel parent; children
  stay grouped by parent sequence before `(kind, logical_key)`, and the earlier
  parent owns duplicates. Durable reads and commit verification bind full task,
  accepted-attempt, and artifact identity. A ready next head has released its
  provider reservation, remains traversal-actionable, and does not trigger a
  provider wake; wake happens only after a newly admitted planned head commits.
  A wake that arrives during an active provider slot is coalesced without
  latching a stale restart. At the bounded chunk boundary the slot returns to
  the controller for reallocation from a fresh occupancy/epoch snapshot.
  Coordinator application and prefix commit both recompute address-history
  identity and bind it to the exact planner kind and logical key before
  mutation. Any address-history marker at the checkpoint boundary requires the
  complete expected/stored task, artifact kind/schema, and canonical-key tuple;
  generic identity handling applies only when no such marker exists. Arrival
  order cannot change the canonical traversal result.
  Adaptive rolling admission and capacity control are implemented over the
  same planner/tasks/commit path. Independent provider groups supply capacity;
  owner-to-run max-min fairness, a borrowable repair reserve, durable bounded
  lookahead, resource guards, coalesced event wakes, and rare reconciliation
  determine admission. Ordered tasks are eligible when at least one healthy
  capable group exists; no task stores or preselects a provider group.
  Allocation and claim permits use the full lane/owner/run identity. If one
  run has repair and interactive work simultaneously, both lanes remain
  independently schedulable, while their slot shares are aggregated into one
  planner refill/lookahead decision for that run.
  Provider slots expose their active permit and monotonic epoch. A controller
  snapshot subtracts active occupancy and can assign only an idle slot whose
  epoch is unchanged; a wake during an HTTP/chunk does not latch a stale
  restart, and the post-boundary controller wake performs the next allocation.
  Production configuration remains `barrier` pending Plan 3 evidence. Hot
  fallback changes admission only: unleased tail is de-admitted, leased chunks
  finish, and canonical commit is unchanged. Only the active Unified generation
  starts reconciliation or registers its Linux `SIGUSR2` handler. That signal
  invokes the one-way rolling-to-barrier production control path serialized
  with controller cycles; switching back requires restart/configuration and is
  not a hot action. Checkpoint latency is the maximum sample since the previous
  controller decision and resets after sampling, so one slow checkpoint cannot
  freeze resource state without a new slow sample.
  The rollout selector has four explicit stages for new work:
  `global_barrier`, `isolated_rolling`, `bounded_user_check`, and
  `rolling_default`. Migration 035 freezes the selected stage, stable bucket,
  admission policy, verified ceiling, and receipt SHA on each new run;
  pre-035 runs stay barrier. The one-way runtime fallback overrides the stage
  globally and does not introduce a second traversal implementation.
- Direct history and direct hard evidence run in parallel with traversal, but
  only the completed parent owns scoring and delivery.
- Canonical fact identity prevents Fast/Where/Deep double counting.
- Matrix v4 gives unknown addresses zero by default and creates risk only from
  evidence or confirmed behavior combinations.
- Hard floors are not diluted by safe volume. Role, distance, and restriction
  timing retain separate semantics.
- `ScoreAnchorV3` binds facts, policy/config versions, analysis, locked Golden
  identity, and report.

## Golden Pilot V2

- Golden Pilot is offline and imports no production code.
- Exact scores exist only after two blind reviews and adjudication.
- FIFO, LIFO, and proportional attribution were compared; proportional is the
  selected locked policy.
- TBL7 and TQr are frozen regression cases. Live runs are separate canaries and
  cannot rewrite Golden expected artifacts.
- Locked manifest SHA-256 is
  `4d1f2568d3676cf1ee2e4411bc70e056d1f6fc80997b2919e3da4705811cb407`.
- The production comparator imports production code but consumes only the
  locked package contract.

## Telegram And Admin

The final Telegram dossier presents score, decisive evidence, balance
formation, outgoing movement, services/contracts/approvals, relationships and
behavior, coverage, wallet profile, and a compact conclusion. Repeated
transactions are aggregated. RU and EN share one report hash and have separate
presentation manifests.

Admin owns operational visibility: parent/child lifecycle, immutable attempts,
provider waits, closure/coverage, hashes, score anchor, delivery state, and
watchdog actions. Its progress projection reports exact discovered work and
runtime counters only; expanding work has no denominator, ETA, or percent.

## Labels, Boundaries, And Performance Evidence

- Supported labels are a versioned, snapshot-bound dataset with provenance.
- A known label is not sufficient to stop traversal; the matching
  valid-at-event route/economic predicate must also hold.
- P1 boundary predicates remain candidate-only until blind review and
  adjudication. Exact expected scores are created only after that decision.
- Benchmark identity fixes case/run IDs, clock, snapshot, provider/label/config
  hashes, policies, locale, deterministic ID seed, runtime commit, checkpoint
  version, chunk size, slot count, and harness version.
- Wall time and machine metadata are measurements outside canonical analysis
  hashes. Any eventual SLO is internal observability, never a user timeout,
  coverage gate, completion condition, or publication rule.
- Frozen replay is the exact barrier-versus-rolling oracle and exercises
  logical capacities 1, 4, 8, 16, 32, and 100. Live evidence may claim only
  audited groups actually exercised. A signed receipt can authorize ceiling
  one only after live capacity one passes, and ceiling four only after four
  independent groups pass the live gate. No such live promotion receipt exists
  yet.
- Local WSL samples are diagnostics only. They record vmmemWSL, Linux
  available memory/swap, and process RSS/heap trends, but only a target
  Linux cgroup/host gate with observed source bytes, process PID/start and
  executable identity, DB/checkpoint latency, and a derived bounded RSS trend
  can satisfy production memory evidence.

## Release Safety

- The active candidate startup contract is exact through
  `035_unified_check_run_rollout_policy.sql`; database receipt versions 036+
  fail closed. Migration 033 remains immutable and migration 034 remains the
  planner predecessor.
- Startup verifies the exact migration-035 checksum and the verified
  schema-032/schema-033/schema-034 predecessor checksums and receipts before provider,
  bot, or worker initialization.
- Adaptive promotion and candidate runtime inputs require schema 035 and retain
  exact schema-034 planner evidence as predecessor. Historical Plan-5
  schema-034 receipt readers remain exact rather than being rewritten.
- Current schema evidence uses release-evidence V2; G13 uses execution receipt
  V3 and prepared settlement V3. Exact historical V1/V2 readers remain
  available and do not accept schema-034 fields as optional extensions.
- The generic tracked migrator applies migration 035 additively. The historical
  protected Plan-5 migration receipt remains schema-034 evidence; production
  rollout cannot advance until its protected additive schema-035 step and
  receipt are materialized. Standalone schema-034 verification rejects even a
  partial schema-035 column, constraint, or trigger; only the schema-035
  verifier may explicitly project those additions while proving its exact
  structure.
- Protected rollout `verify_schema` re-runs the exact schema-034 checksum,
  predecessor-receipt, and structural verification in a bounded read-only
  production snapshot and binds that result to the accepted V3 receipt.
- Candidate scope uses exact tracked paths for the Golden lock; unknown files
  below the locked root are rejected.
- Final full suite, typecheck, Golden verify, comparator, RU/EN acceptance, and
  migration/startup rehearsal run once after the final candidate commit.
- Adaptive rolling promotion additionally consumes a separate canonical
  Ed25519-signed receipt. The key ID, public key, and public-key hash are pinned;
  an arbitrary CLI key/path is not authority. The finalizer canonical-loads
  replay/live indexes and their artifacts, the PostgreSQL oracle,
  restart/fallback transition evidence, target-Linux memory evidence, and the
  raw memory-source attestation before materializing the official receipt. It
  fails closed unless schema 035, exact frozen
  replay, retry/restart, logical scale, live capacity one, the three named
  isolated wallets, zero Telegram sends, target-Linux memory, and the tested
  rolling-to-barrier fallback are present. Capacity four is either explicitly
  verified from four independent groups or remains explicitly unverified with
  a ceiling of one. The benchmark index execution identity names the whole
  benchmark invocation and is distinct from every scenario performance
  identity stored in its artifact entries. G06 revalidates the exact adaptive
  receipt bytes against the pinned signature and rollout generation; it never
  treats resealing a caller-provided value as authority.
- The independently reviewed Golden lock is rooted in immutable commit
  `5149573503394815925d771ba33b2733e3248dc3`; a candidate must prove the
  locked tree is byte-identical to that authority before any final gate runs.
- Each final command has an external canonical write-once provenance receipt
  binding the exact candidate, command, physical checkout identity, runtime,
  generation, time interval, exit code, log path, byte count, and log hash.
- Plan-A and Unified aggregate receipts consume only those command receipts
  and bind the immutable Golden authority, schema proof, replay root, versions,
  and rollout generation.
- The existing protected backup/migration/rollout/recovery flow remains the
  only production path. No deploy or live canary occurs without explicit GO.
- Rollback to a pre-034 binary is not hot: close new claims, drain or block
  rolling runs, stop the new runtime, start the old binary, and retain
  migration 034. No destructive down-migration is generated.

## Separate Decisions

Address-poisoning remains a separate wallet-safety feature and cannot influence
AML score. Recipient precheck before signing is a follow-up, not part of this
release.
