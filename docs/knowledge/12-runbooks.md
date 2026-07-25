---
status: current
last_verified: 2026-07-23
owner_area: docs
code_refs:
  - package.json
  - scripts/verifyRemediationRelease.ts
  - scripts/finalizeUnifiedReleaseGates.ts
  - scripts/runSchema032ReleaseSequence.ts
  - scripts/runUnifiedWalletCanary.ts
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
contracts now require exact schema 034. Schema 033 remains immutable
predecessor evidence; it is not rewritten or replaced.

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

This writes `plan-a-gate-receipt-v1.json` and
`unified-wallet-release-gate-receipt-v1.json` with exclusive write semantics.
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
→ exact tracked migration through schema 034
→ startup schema-034 verification
→ candidate runtime start
→ active Unified generation fence
→ legacy wallet-delivery quarantine
→ Unified delivery authority
→ post-deploy recent-eight canary
→ GO or existing rollback/recovery
```

Migrations 033 and 034 are checksum-verified before the DB session can mutate
their respective tracked step. G07 clean/clone evidence and G13 production
receipt bind the schema-033 predecessor proof and authoritative schema-034
proof. The current G13 terminal artifact is
`schema032-production-execution-receipt-v3.json`; V2 remains historical
read-only evidence. Unknown migration 035+ fails closed.
Before rollout can advance, protected `verify_schema` repeats the exact
schema-034 and predecessor verification in a bounded read-only production
snapshot; a stale or missing migration-034 receipt fails the step.

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

TPCP, TFWG, and TXc must each be captured once on the schema-034 runtime to
their own terminal lifecycle state. Export by request identity, remove all key
material, bind the ordered response identities and label/config hashes, and
then run replay offline. Do not use the live blockchain as the benchmark and
do not reconstruct response bodies from request-only logs.

The current blocker is missing historical response pages for those three
addresses. Therefore there is no measured before/after table or proposed
internal SLO yet. Once bundles exist, compare only runs with identical semantic
identity; execution identity may differ for the declared mechanical changes.

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
