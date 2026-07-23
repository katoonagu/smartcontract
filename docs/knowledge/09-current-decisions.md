---
status: current
last_verified: 2026-07-23
owner_area: docs
code_refs:
  - src/index.ts
  - src/storage/schemaMigrations.ts
  - src/runtime/startupSchemaGate.ts
  - src/unifiedCheck
  - src/risk/scoringSignalMatrixV4.ts
  - src/risk/scoreAnchorV3.ts
  - migrations/033_unified_wallet_check.sql
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
watchdog actions.

## Release Safety

- The tracked migration chain is exact through
  `033_unified_wallet_check.sql`; 034+ and unknown files fail closed.
- Migration 033 checksum is verified before any DB session/mutation and its
  receipt/catalog proof is bound in offline and production evidence.
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
