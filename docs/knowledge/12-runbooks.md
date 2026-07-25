---
status: current
last_verified: 2026-07-25
owner_area: docs
code_refs:
  - package.json
  - scripts/verifyRemediationRelease.ts
  - scripts/finalizeUnifiedReleaseGates.ts
  - scripts/runSchema032ReleaseSequence.ts
  - scripts/runUnifiedWalletCanary.ts
  - scripts/runUnifiedAdaptiveBenchmark.ts
  - scripts/captureUnifiedWslMemory.ps1
  - src/release/unifiedReleaseGateReceipt.ts
  - docs/superpowers/verification/plan5-release/README.md
---

# Runbooks

## Read Russian Markdown On Windows

```powershell
Get-Content -Raw -Encoding UTF8 docs/knowledge/AGENT_BRIEF.md
```

## Canonical Protected Release Flow

The canonical backup/migration/rollout/rollback commands and authority model
remain in
`docs/superpowers/verification/plan5-release/README.md`. Do not duplicate or
bypass that protected flow. Unified adds only the deltas below.

The active candidate runtime, protected receipt, promotion, and canary
contracts now require exact schema 035. Schema 033 remains immutable and
schema 034 remains the planner predecessor; neither is rewritten.

## Final Candidate Gates

The independent Golden authority is immutable commit:

```text
5149573503394815925d771ba33b2733e3248dc3
```

After the final candidate commit, run each gate exactly once through the
write-once runner. Use one exact rollout generation and one protected external
artifact root for all six invocations:

```powershell
$root = "<protected-external-artifact-root>"
$generation = "<exact-rollout-generation>"
$authority = "5149573503394815925d771ba33b2733e3248dc3"
$ids = @(
  "full_test",
  "typecheck",
  "golden_verify",
  "golden_compare",
  "presentation_acceptance",
  "migration_startup_rehearsal"
)
foreach ($id in $ids) {
  npm run release:unified:gate:run -- `
    --artifact-root $root `
    --generation $generation `
    --command $id `
    --plan-a-authority-commit $authority
}
```

The runner itself executes the fixed commands declared by the receipt schema.
It refuses a dirty candidate, a changed Golden tree, a wrong authority commit,
or an existing log/receipt. Each `<id>.log` is paired with canonical
`<id>.command-receipt-v1.json`; the receipt binds candidate, exact command,
physical checkout hash, runtime, generation, timestamps, exit code, log byte
count, and output hash. A failed command is terminal evidence and is not
automatically repeated.

The migration milestone also materializes candidate-bound clean and
production-clone schema evidence at:

```text
schema-clean/schema032-release-evidence.json
schema-production-clone/schema032-release-evidence.json
```

Both artifacts must contain the schema-033 predecessor filename, checksum,
catalog hash and verification receipt hash, plus the schema-034 filename,
checksum, structural catalog identity and verification receipt hash. The
replay directory contains exactly one canonical JSON file per locked case.

After all gates pass and `git status` is clean:

```powershell
npm run release:unified:gates:finalize -- `
  --artifact-root <protected-or-ignored-artifact-root> `
  --generation <exact-rollout-generation> `
  --plan-a-authority-commit 5149573503394815925d771ba33b2733e3248dc3
```

This writes `plan-a-gate-receipt-v1.json`,
`unified-wallet-release-gate-receipt-v1.json`, and
`adaptive-rolling-release-gate-receipt-v1.json` with exclusive write semantics.
The input approval is `adaptive-rolling-promotion-approval-v1.json`; the fixed
authority file is `adaptive-rolling-authority-public-key.pem`. Both are
no-follow regular files, and the key bytes must match the public-key hash and
key ID pinned in code. The finalizer accepts no key path from the caller. It
derives the approved body from the fixed replay/live indexes, PostgreSQL oracle
receipt, restart/fallback evidence, target-Linux memory gate, and raw
memory-source attestation before writing the same canonical receipt bytes
consumed by G06. G06 independently validates those exact artifact bytes,
candidate, rollout generation, pinned key ID, and Ed25519 signature; a
structurally valid or re-sealed unsigned value is rejected. Benchmark indexes
carry one global invocation identity, while every entry binds its own distinct
scenario performance identity and matching scenario evidence.
The finalizer never executes or adopts bare logs: it accepts only canonical
command receipts whose bytes and referenced regular log files match. Aggregate
receipts bind the exact commit, immutable Plan-A authority/tree,
lock/control hashes, schema proofs, replay root, versions, generation,
commands, exit codes, provenance receipt hashes, and output hashes. Do not
change the candidate after receipt creation.

## Unified Production Delta

Use the existing protected flow in this order:

```text
approved final receipts
→ protected production backup
→ exact tracked migration through schema 035
→ startup schema-035 verification
→ candidate runtime start
→ active Unified generation fence
→ legacy wallet-delivery quarantine
→ Unified delivery authority
→ post-deploy recent-eight canary
→ GO or existing rollback/recovery
```

Migrations 033, 034, and 035 are checksum-verified before the DB session can mutate
their respective tracked step. G07 clean/clone evidence and G13 production
receipt bind the schema-033 predecessor proof and authoritative schema-034
proof. The current G13 terminal artifact is
`schema032-production-execution-receipt-v3.json`; V2 remains historical
read-only evidence. Unknown migration 036+ fails closed. The historical Plan-5
G13 artifact remains an exact schema-034 receipt and must not be rewritten;
rollout remains blocked until the protected producer emits additive schema-035
execution/settlement evidence. Before rollout can advance, protected
`verify_schema` must repeat exact schema-035 and predecessor verification in a
bounded read-only production snapshot; a stale or missing migration-035
receipt fails the step.
Running the schema-034 verifier by itself against any partial schema-035
column, constraint, or immutable-policy trigger is an integrity failure. The
forward projection is enabled only as part of exact schema-035 verification.

## Frozen Performance Capture

The deterministic benchmark manifest is implemented and separates semantic
identity from execution identity. A real-address benchmark is runnable only
after every request made by the case has an immutable
`unified_provider_pages` row containing:

```text
request_identity_sha256
snapshot_block_hash
payload_sha256
payload_json
fetched_at
provenance_json
```

TPCP, TFWG, and TXc must each be captured once on the schema-035 runtime to
their own terminal lifecycle state. Export by request identity, remove all key
material, bind the ordered response identities and label/config hashes, and
then run replay offline. Do not use the live blockchain as the benchmark and
do not reconstruct response bodies from request-only logs.

The current blocker is missing historical response pages for those three
addresses. Therefore there is no measured before/after table or proposed
internal SLO yet. Once bundles exist, compare only runs with identical semantic
identity; execution identity may differ for the declared mechanical changes.

## Adaptive Provider Controller Checks

The candidate defaults to the global barrier rollout stage:

```powershell
$env:UNIFIED_ADMISSION_POLICY = "barrier"
$env:UNIFIED_ROLLING_ROLLOUT_STAGE = "global_barrier"
$env:UNIFIED_ROLLING_USER_CHECK_BASIS_POINTS = "0"
$env:UNIFIED_VERIFIED_PROVIDER_CAPACITY_CEILING = "1"
$env:UNIFIED_ADAPTIVE_RELEASE_RECEIPT_PATH = ""
```

Run deterministic controller, fairness, pool, admission, reconciliation,
fallback, and scale checks before Plan 3:

```powershell
npm test -- tests/unified-check/providerCapacityController.test.ts tests/unified-check/fairProviderAllocator.test.ts tests/unified-check/providerPool.test.ts tests/unified-check/rollingAdmission.test.ts tests/unified-check/adaptiveRuntime.test.ts tests/unified-check/admissionRuntimeControl.test.ts tests/unified-check/reconciliation.test.ts tests/unified-check/providerScaleSimulation.test.ts
```

PostgreSQL recovery and fallback checks require the temporary test database
and are not a pass when Vitest reports them skipped:

```powershell
$env:TEST_DATABASE_URL = "<temporary-postgresql-url>"
npm.cmd test -- tests/storage/migration034.postgres.test.ts tests/storage/migration035.postgres.test.ts tests/unified-check/requestService.postgres.test.ts tests/unified-check/rollingAdmission.postgres.test.ts tests/unified-check/claimPermits.postgres.test.ts tests/unified-check/reconciliation.postgres.test.ts tests/unified-check/barrierFallback.postgres.test.ts tests/unified-check/productionRuntime.postgres.test.ts tests/unified-check/plannerRestart.postgres.test.ts tests/unified-check/orderedCommit.postgres.test.ts
```

Run `npm.cmd run db:migrate` twice against the same disposable database. The
first run must apply and verify 032–035; the second must report all four as
already verified. Unit catalog fixtures do not replace this check because
PostgreSQL driver types such as `name[]` can differ from mocked JavaScript
arrays.

Capacities above the four currently configured independent groups are
simulation evidence only. Raise the live ceiling only after the matching Plan
3 canary and memory gate.

Run the frozen benchmark directly on Windows so PowerShell does not consume or
rewrite arguments through `npm.ps1`:

```powershell
node --import tsx scripts/runUnifiedAdaptiveBenchmark.ts `
  --mode replay `
  --capacity 1,4,8,16,32,100 `
  --seed 24072026 `
  --oracle-receipt <oracle-receipt.json> `
  --output <artifact-root>/unified-adaptive/replay.json
```

`npm.cmd run benchmark:unified-adaptive -- ...` is also acceptable. Do not
weaken the CLI's isolation, provider-audit, canonical-output, or resume checks
to work around PowerShell flag handling.

Capture each local phase from the runtime metrics snapshot:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts/captureUnifiedWslMemory.ps1 `
  -RunId <run-id> -ScenarioId <scenario-id> `
  -Phase before -NodePid <node-pid> `
  -RuntimeSnapshotPath <runtime-memory.json> `
  -OutputPath <memory-samples.json>
```

Repeat for `during` and `after`; pass `-SummaryPath` on the final sample. A
missing WSL process is a diagnostic skip. The local summary deliberately says
`diagnostic_only`; only signed `target_linux_cgroup_gate` evidence can promote.

### Adaptive rollout stages

Advance one signed receipt at a time:

```text
global_barrier
→ isolated_rolling
→ bounded_user_check
→ rolling_default
```

The bounded stage uses
`UNIFIED_ROLLING_USER_CHECK_BASIS_POINTS` from 0 through 10000. A hot
rolling-to-barrier fallback is one-way for that process. A pre-035 binary
rollback is not hot: close new claims, drain or block active rolling runs, stop
the new runtime, start the old binary, and retain schema 035. Never apply or
generate a down migration. Set
`UNIFIED_ADAPTIVE_RELEASE_RECEIPT_PATH` to the fixed finalized receipt. Without
a valid signed receipt, only `global_barrier` with ceiling 1 starts.
Configured stage/capacity may match or narrow the receipt but cannot broaden
it; mismatch fails startup. The ceiling also applies while the one-way barrier
fallback is active.

### Emergency rolling-to-barrier fallback

On the Linux runtime whose active generation fence assigns ownership to
Unified, request the one-way hot fallback with:

```bash
kill -USR2 <bot-pid>
```

The `unified_admission_barrier_fallback` log confirms the serialized switch and
lists affected runs/de-admitted task IDs. New rolling admissions stop before
the switch completes. Unleased ordered tails are de-admitted; an already
leased provider request is not interrupted and yields at its bounded chunk
before the next barrier controller cycle. Repeating `SIGUSR2` is idempotent.
There is intentionally no hot barrier-to-rolling signal in this rollout.
The process does not register this signal handler while the legacy generation
owns delivery.

## Live Canary

Live canary is post-deployment only. It selects exactly eight most recent
unique eligible addresses without score/outcome selection, excludes TBL7/TQr,
persists cutoff/query/list identity, and sends no Telegram. Each address has a
35-minute observation deadline; expiry records a technical blocker rather than
fabricating completion.

Do not run live canary before the deployed runtime proves the same candidate
SHA and active generation as the canary batch.

## Delivery Recovery

`DELIVERY_UNKNOWN` is inspected manually and never auto-retried. Any manual
resend uses the explicit warned/audited path. Never grant legacy and Unified
automatic delivery authority at the same time.
