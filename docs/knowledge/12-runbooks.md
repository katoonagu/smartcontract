---
status: current
last_verified: 2026-07-18
owner_area: docs
code_refs:
  - package.json
  - src/index.ts
  - src/runtime/forensicRuntimeOrchestration.ts
  - src/config.ts
  - src/admin/adminConsole.ts
  - src/admin/adminServer.ts
  - tests/admin/adminConsole.test.ts
  - tests/admin/adminServer.test.ts
  - scripts/verifyRemediationRelease.ts
  - scripts/captureTask0BPreflight.ts
  - scripts/createProductionBackupEvidence.ts
  - scripts/manageTask0BRuntime.ts
  - scripts/runSchema032ReleaseSequence.ts
supersedes:
  - docs/project-walkthrough/16-qa-and-release-checks.md
---

# Runbooks

## Read Russian Markdown On Windows

PowerShell may show UTF-8 Russian text as mojibake. Use:

```powershell
Get-Content -Encoding UTF8 docs\knowledge\AGENT_BRIEF.md
```

or:

```powershell
rg -n "Where is money" docs/knowledge
```

## Start Bot And Admin

From the repository or worktree:

```powershell
$env:DOTENV_CONFIG_PATH='..\..\.env'; npm run dev
```

Admin should start at:

```text
http://127.0.0.1:8787/admin/forensics
```

## Verify Admin HTML Is Fresh

```powershell
@'
const res = await fetch("http://127.0.0.1:8787/admin/forensics");
const html = await res.text();
console.log(res.status, html.includes("Strict benchmark"), html.includes("/admin/api/forensic-jobs"));
'@ | node --input-type=module
```

Expected output should include status `200` and `true true`. Do not use the old
page-name marker from earlier runbooks; it is not a stable current HTML marker.

## Export Static Admin Snapshot

Use this when you need to send a historical, read-only Admin forensics snapshot
as a single HTML file:

```powershell
npm run admin:snapshot
```

The file is written to `artifacts/admin-snapshots/` and can be opened directly
in a browser. It embeds the current Admin shell, captured job/graph API JSON,
Wallet Intelligence list/detail JSON, and role-mark assets. It is read-only;
live refresh and mutations are not part of the snapshot.

To capture a narrower case:

```powershell
node --import tsx scripts/exportAdminSnapshot.ts --address T...
node --import tsx scripts/exportAdminSnapshot.ts --job job-id
```

## Run Tests

```powershell
npm test
npm run typecheck
```

For focused Admin tests:

```powershell
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
```

## Plan 5 Candidate Release Commands

Current human status is `release candidate ready/pending approval`; the machine
manifest remains `not_ready`. The complete protected-artifact, database guard,
manual Telegram, backup/migration, rollout, canary, and rollback procedure is in
`docs/superpowers/verification/plan5-release/README.md`.

`release:manifest:advance` is the only manifest/gate writer. Manifest-mode
`release:verify` is byte-identical and read-only for the artifact root: it does
not execute producers, write evidence, repair artifacts, or mutate the
manifest. Run focused suite groups, non-Vitest checks, trace capture,
controlled schema producer, sanitized runtime/rollback rehearsal, terminal
legacy snapshot, and manual evidence first. Materialize the freeze, advance
with the exact source token, then verify:

```powershell
$env:RELEASE_SHA = (git rev-parse HEAD).Trim()
npm run release:task0b:preflight -- <protected-artifact-root>
npm run release:freeze:materialize -- <protected-artifact-root>
npm run release:task0b:revalidate -- <protected-artifact-root>
node --import tsx scripts/verifyRemediationRelease.ts --suite-group plan1 <protected-artifact-root>
npm run release:verify:non-vitest -- <protected-artifact-root>
npm run release:trace:prepare -- <protected-artifact-root>
npm run release:trace:capture -- <protected-artifact-root>
npm run schema:release:sequence -- --offline `
  --database-url-env PLAN5_SCHEMA_CLONE_DATABASE_URL `
  --expected-endpoint <loopback-host:port> `
  --expected-system-identifier <system-identifier> `
  --artifact-root <protected-clone-sequence-root>
npm run release:runtime:rehearse -- <protected-artifact-root>
npm run release:legacy:snapshot -- <exact-guarded-arguments-from-plan5-runbook>
npm run release:telegram:manual -- <protected-artifact-root>
npm run release:manifest:advance -- pre_manual absent <protected-artifact-root>
npm run release:verify -- --phase pre-manual --artifact-root <protected-artifact-root>
```

Do not recapture or rematerialize Task 0B after the freeze exists. Its
15-minute live observation is renewed only by another complete read-only
`release:task0b:revalidate` receipt against the same immutable generation. Run
that command at Task 9 entry and again immediately before runtime rehearsal,
terminal-legacy snapshot, manual Telegram prepare/finalize, or strict release
verification when the latest receipt has expired. G12 backup entry and G13
migration entry always read a currently fresh receipt and reject the original
freeze TTL as a substitute. The controlled runtime
rehearsal writes candidate/previous start evidence after successful execution;
operators do not precreate those files.

The focused-suite line is repeated for `plan2`, `plan3`, `plan4`, `plan5`, and
`addressPoisoningRegression`. The schema producer also runs in separate
protected sequence roots for exact databases `tron_watch_plan5_clean` and
`tron_watch_plan5_runtime_sanitized`; all disposable targets are loopback and
offline. The suite producer serializes test files and applies bounded 120-second
test and hook timeouts so database-backed files cannot race shared disposable
state. The literal full test inside the non-Vitest producer invokes the
repository-local `node_modules/vitest/vitest.mjs` directly, is serialized with
five-minute test/hook bounds, and has a one-hour whole-process-tree bound. This
avoids npm argv rewriting, orphan workers after timeout, and cross-file
release-store contention without treating normal filesystem variance as a
failure. Set
`TEST_DATABASE_URL` to the matching `tron_watch_plan1` through
`tron_watch_plan4` database only while its suite runs. The forced Plan 5
PostgreSQL suite additionally requires `PLAN5_TASK0B_TEST_DATABASE_URL` bound
to an isolated disposable `tron_watch` database; production port `55999` is
rejected. Remove both suite-only variables outside their exact group.
`schema:verify` is read-only and cannot replace the producer.

Trace preparation normally requires an exact behavioral assertion failure.
Only AC-07/08/09/12/13/27/39 may use the corrective typed
`local_product_module_absent` form: zero tests executed in the exact failed
file, one relative missing `src/*` product import whose importer is that file,
the exact frozen test patch, test-commit-to-owner-to-candidate ancestry, module
absence at the test commit, and module presence at owner plus candidate.
External dependencies and generic import/no-test/environment failures fail
closed.

AC-20/21/24 remain behavioral RED. Their exact original Plan 4 test patch is
bound to `20ee8a75…`; the archived RED execution is `a0f74b3b…`, where the
Telegram modules load and all three exact assertions fail behaviorally. The
validator requires test-commit → RED-execution → owner → candidate ancestry.

After manual evidence finalization, and after every later transition, hash the
exact current manifest bytes. Never reuse a prior source SHA or edit the store:

```powershell
$source = (Get-FileHash -Algorithm SHA256 `
  (Join-Path '<protected-artifact-root>' 'release-manifest.json')).Hash.ToLowerInvariant()
npm run release:manifest:advance -- readiness $source <protected-artifact-root>
npm run release:verify -- --phase readiness --artifact-root <protected-artifact-root>
```

An unmarked previous process no longer blocks the read-only Task 0B evidence
phase by itself. Configure it only as `legacy_unmanaged_previous_runtime` and
provide the exact protected PID/start/process/path/Admin/Telegram bindings.
Each Task 0B capture and revalidation re-reads the single matching process,
clean exact-SHA worktree, loopback Admin runtime proof, production DB/schema,
and Telegram `getMe` plus empty `getWebhookInfo.url`; secrets stay in the two
fixed read-only-auth environment variables and never enter evidence. Any drift,
missing process, second runtime candidate, unexpected webhook, or identity
mismatch fails closed. This is not adoption: production start/stop/rollback
remains rejected for the legacy kind pending full G00-G11, merge, explicit GO,
and separate action-specific authority/amendment.

No production command has run. After complete G00-G11, exact-SHA merge rerun,
pre-GO report, explicit user GO, and fresh action authority, the exact future
G12/G13 order is:

```powershell
npm run release:task0b:revalidate -- <protected-artifact-root>
npm run release:authority:issue -- g12_backup_passed <protected-artifact-root>
npm run release:production:backup -- <protected-artifact-root>
$source = (Get-FileHash -Algorithm SHA256 `
  (Join-Path '<protected-artifact-root>' 'release-manifest.json')).Hash.ToLowerInvariant()
npm run release:manifest:advance -- g12_backup_passed $source <protected-artifact-root>
npm run release:verify -- --phase g12 --artifact-root <protected-artifact-root>

npm run release:task0b:revalidate -- <protected-artifact-root>
npm run release:authority:issue -- g13_migration_passed <protected-artifact-root>
npm run schema:release:sequence -- `
  --database-url-env TASK0B_PRODUCTION_DATABASE_URL `
  --expected-endpoint <loopback-host:port> `
  --expected-system-identifier <system-identifier> `
  --artifact-root <protected-artifact-root>
$source = (Get-FileHash -Algorithm SHA256 `
  (Join-Path '<protected-artifact-root>' 'release-manifest.json')).Hash.ToLowerInvariant()
npm run release:manifest:advance -- g13_migration_passed $source <protected-artifact-root>
npm run release:verify -- --phase g13 --artifact-root <protected-artifact-root>
```

`TASK0B_PRODUCTION_DATABASE_URL` is supplied only as a protected process
environment secret outside argv and artifacts. Neither producer accepts a raw
authority path; each selects the exact issuer-chain tip from the protected
root. The fixed bootstrap/frozen root-writer lifecycle, expired-unclaimed
terminalizer, G14/G15/recovery/rollback sole orchestrators, normal and
cleanup-only takeover commands, strict bounds, and terminal receipt order are
defined in the Plan 5 release README. Direct production leaf stop/start/query,
SQL, reconciliation, health, or capture commands are forbidden.

An expired never-claimed tip is closed by transition, never by operator-chosen
JSON path. For G13 the terminalizer uses the protected production URL only from
`TASK0B_PRODUCTION_DATABASE_URL`, verifies the frozen DB fingerprint, and holds
the schema-032 advisory lock until the exact terminal receipt is published:

```powershell
npm run release:authority:terminalize -- <transition> <protected-artifact-root>
```

G12 claim requires 65 minutes of its 70-minute authority window remaining;
G13 claim requires 25 minutes of its 30-minute window remaining.

## Verify The Unreleased Plan 3 Candidate

Use only the disposable database named exactly `tron_watch_plan3`. Do not point
these commands at production, start Telegram polling, or run a production
migration:

```powershell
$env:REQUIRE_PLAN3_POSTGRES='1'
$env:TEST_DATABASE_URL='postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan3'
npx vitest run --configLoader bundle `
  tests/runtime/waitReconciliation.acceptance.test.ts `
  tests/runtime/strandedParentRecovery.acceptance.test.ts `
  tests/runtime/telegramDelivery.acceptance.test.ts `
  tests/runtime/walletNavigation.acceptance.test.ts `
  tests/runtime/checkCallbacks.acceptance.test.ts `
  tests/runtime/allowanceRefresh.acceptance.test.ts `
  tests/runtime/runtimeSchemaGateIntegration.acceptance.test.ts `
  tests/storage/runtimeDelivery.postgres.test.ts `
  tests/storage/forensicCheckJobs.test.ts `
  tests/forensics/forensicJobProgress.test.ts `
  tests/forensics/addressIndexWorker.test.ts `
  tests/forensics/deepForensicJob.test.ts `
  tests/forensics/deepSecondLayerRefresh.test.ts `
  tests/forensics/incomingDepositJob.test.ts `
  tests/approvals/allowanceState.test.ts `
  tests/approvals/approvalWorker.test.ts `
  tests/wallet/dashboard.test.ts `
  tests/bot/createBot.test.ts
```

The PostgreSQL acceptance files must execute rather than skip. Then run:

```powershell
npm run typecheck
npm test
```

After the focused suite, the disposable database must contain no leftover
`plan3_%` schemas. If `psql` is unavailable, inspect it through the installed
`pg` package:

```powershell
@'
import pg from "pg";
const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await client.connect();
const { rows } = await client.query(
  "select schema_name from information_schema.schemata where schema_name like 'plan3_%' order by 1"
);
console.log(rows);
await client.end();
'@ | node --input-type=module
```

Expected cleanup output is `[]`. This verifies only the local unreleased
candidate; production remains unchanged until Plan 5.

## Check Recent Jobs

Use the database connection from `.env`:

```powershell
@'
import dotenv from "dotenv";
import pg from "pg";
dotenv.config({ path: "../../.env" });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(`
 select id, kind, subject_address, status, requested_by, created_at, completed_at, last_error
 from forensic_check_jobs
 order by created_at desc
 limit 10
`);
console.table(rows.map((r) => ({
  id: r.id.slice(0, 8),
  kind: r.kind,
  subject: r.subject_address?.slice(0, 10),
  status: r.status,
  requested: r.requested_by,
  created: r.created_at,
  completed: r.completed_at,
  err: r.last_error
})));
await client.end();
'@ | node --import tsx
```

## Old DB Result Or Fresh Run

Check `created_at`, `requested_by`, and job id. A graph can look new while
showing an old completed job from the database.

## Check Workers Are Running

Admin can be alive even when the currently selected graph is an old completed
job. Queue a small forensic job or inspect recent `queued` rows; they should
move to `running`/`completed` after the startup schedule delay. The background
schedule starts independently of Telegram bot `onStart`, so Admin-only local
runs should still process forensic queues.

## Check TronScan Key Pool At Startup

Look for `tronscan_scheduler_configured` in runtime logs. Important fields:

- `apiKeyCount`;
- `apiKeyGroupCount`;
- `maxInFlight`;
- `rateLimitedRequests`;
- `accountGroupCooldownUntilMs`.
