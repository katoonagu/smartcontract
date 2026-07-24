---
status: current
last_verified: 2026-07-25
owner_area: docs
code_refs:
  - src/index.ts
  - src/storage/schemaMigrations.ts
  - src/runtime/startupSchemaGate.ts
  - src/unifiedCheck
  - src/risk/scoringSignalMatrixV4.ts
  - src/risk/scoreAnchorV3.ts
  - migrations/033_unified_wallet_check.sql
  - docs/superpowers/specs/2026-07-24-unified-wallet-check-adaptive-rolling-planner-design.md
  - scripts/verifyRemediationRelease.ts
  - scripts/runSchema032ReleaseSequence.ts
  - scripts/finalizeUnifiedReleaseGates.ts
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
  A wake that arrives during an active provider slot is latched per slot;
  repeated wakes coalesce, the slot restarts once immediately, and drain waits
  through that restart.
  Coordinator application and prefix commit both recompute address-history
  identity and bind it to the exact planner kind and logical key before
  mutation. Any address-history marker at the checkpoint boundary requires the
  complete expected/stored task, artifact kind/schema, and canonical-key tuple;
  generic identity handling applies only when no such marker exists. Arrival
  order cannot change the canonical traversal result.
  Adaptive rolling admission, provider-group selection, and capacity control
  remain later work.
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

## Release Safety

- The active candidate startup contract is exact through
  `034_unified_check_adaptive_planner.sql`; database receipt versions 035+
  fail closed. Future migration files on disk remain Task-7 allowlist scope.
- Startup verifies the exact migration-034 checksum and the verified
  schema-032/schema-033 predecessor checksums and receipts before provider,
  bot, or worker initialization.
- Existing release receipts and protected promotion/canary inputs remain
  pinned to schema 033 until Task 7. They cannot promote the schema-034
  candidate without that explicit update.
- Candidate scope uses exact tracked paths for the Golden lock; unknown files
  below the locked root are rejected.
- Final full suite, typecheck, Golden verify, comparator, RU/EN acceptance, and
  migration/startup rehearsal run once after the final candidate commit.
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

## Separate Decisions

Address-poisoning remains a separate wallet-safety feature and cannot influence
AML score. Recipient precheck before signing is a follow-up, not part of this
release.
