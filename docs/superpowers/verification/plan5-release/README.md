# Plan 5 remediation release runbook

Status: `release candidate ready/pending approval` as a human handoff state.
The machine manifest is still `not_ready`, not `ready_for_release`: fresh Task
0B operational preflight, guarded Task 9, and the manual `G05_TELEGRAM`
evidence are pending. Nothing in this runbook records a production deployment.

Tasks 0A and 1-8 are implemented by the candidate. This is the candidate-only
Task 8 handoff, not Task 9 execution or production GO. The release SHA is
always the clean checked-out `HEAD` that produced the evidence; an ancestor
implementation SHA is never a substitute. No production command described
below has been executed, and `G12_PRODUCTION_BACKUP` remains pending.

## Current production observation and external block

Task 0A observed the previous runtime without changing it:

- SHA `0172978845ec74373bd245098ee8c075e0c39acf`;
- label `master-01729788`;
- database `tron_watch` on loopback port `55999`, schema 031, no schema 032
  receipt;
- Admin HTTP 200;
- Telegram long polling.

If the live process has no repository-manager start attestation, Task 0B must
classify it as `legacy_unmanaged_previous_runtime`, never as manager-owned.
The read-only capture binds and every revalidation reproduces its exact
PID/start time, executable, command line, entrypoint, clean worktree SHA/label,
loopback Admin runtime proof, production DB/schema identity, and Telegram bot
identity plus empty webhook. Any change, disappearance, second candidate, or
ambiguity fails closed. This narrow contract permits pre-release evidence only:
it does not adopt the process: protected operation resume, normal and cleanup-
   only lease takeover, and every production start/stop/rollback authority path
   reject the legacy kind before any write until full G00-G11, merge, explicit
   production GO, and a separate action-specific amendment/authority.

If the process is manager-marked but its verified launcher predates the current
candidate manager, it remains `manager_owned_previous_runtime`. Configure its
historical launcher separately: exact protected origin root fingerprint,
origin `task0b-release-freeze.json` and `release-freeze-identity-v2.json`
hashes, full archived schemas and exact derivation, the complete canonical
prepared/receipt materialization bundle with separately pinned hashes and a
timestamp inside the archived Task 0B window, owner candidate, repository manager-
blob hash, start-evidence hash and live PID identity. The clean candidate's guarded manager has its own current
executor hash. Capture and every revalidation reread the complete protected
origin bundle, repeat owner→candidate ancestry and Git-blob proof with replace
objects and inherited Git overrides disabled, and reproduce the live process.
A later stop uses the frozen launcher only for old-process proof; the current
manager remains the action authority. Never substitute one manager hash for the
other, recreate start evidence, or use the historical launcher for action authority.

Production database, runtime, and Telegram remain unchanged until all of the
following are true: Task 9 is authorized and completed, `G00` through `G11`
are complete, the candidate is merged to `master`, the producers and strict
verifier are rerun for the exact merge SHA, and the user gives explicit release
GO. This document is not that GO.

## Trust boundaries

Use one protected absolute artifact root outside the repository and worktree.
It must be a real, non-symlink directory with restrictive access and exclusive
writes. Evidence contains hashes and redacted identities, never database URLs,
passwords, bot tokens, API keys, chat/user IDs, or Telegram response bodies.

The placeholders below are descriptive. Do not paste secrets into the
runbook, shell history, manifest, or JSON evidence:

```text
<artifact-root>              protected absolute path outside the repository
<candidate-sha>              exact clean checked-out HEAD
<candidate-runtime-label>    label bound to that SHA
<loopback-host:port>         expected PostgreSQL endpoint, without credentials
<system-identifier>          exact pg_control_system() identifier
<authority-file>             protected one-shot authority filename, not contents
<source-manifest-sha256>     lowercase SHA-256 of the exact current manifest bytes
```

Only these database bindings are accepted by the release producers:

| Role | Environment variable | Exact database name | Rule |
|---|---|---|---|
| clean rehearsal | `PLAN5_SCHEMA_CLEAN_DATABASE_URL` | `tron_watch_plan5_clean` | loopback and `--offline` |
| production-clone rehearsal | `PLAN5_SCHEMA_CLONE_DATABASE_URL` | `tron_watch_plan5_clone` | restored clone only, loopback and `--offline` |
| sanitized runtime rehearsal | `PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL` | `tron_watch_plan5_runtime_sanitized` | loopback and `--offline` |
| Task 0B PostgreSQL acceptance | `PLAN5_TASK0B_TEST_DATABASE_URL` | `tron_watch` | isolated disposable cluster; never production port `55999` |
| production | `TASK0B_PRODUCTION_DATABASE_URL` | `tron_watch` | never `--offline`; fresh protected authority required |

For every offline run, `DATABASE_URL` must be absent and no production runtime,
Telegram, or provider environment may be inherited. The production clone is an
offline restored copy, never a connection to the live `tron_watch` database.
The endpoint, database name, database OID, server version, system identifier,
role-specific environment variable, and derived fingerprint must all agree.

`npm run schema:verify` / `verifySchema032` is read-only. It does not apply
migration 032. Only `npm run schema:release:sequence` owns the controlled
first migration, first verification, second no-op migration, and final
verification sequence.

## Manifest V2 and fixed root-writer lifecycle

`release:manifest:advance` is the only manifest/gate writer. Never create or
edit `release-manifest.json`, `gates/*`, snapshots, prepared transitions, or
transition receipts manually. The first transition alone uses source token
`absent`; every later transition uses the lowercase SHA-256 of the exact
current `release-manifest.json` bytes. A stale, skipped, or substituted source
SHA fails the CAS transition.

`release:verify` manifest mode is byte-identical and read-only for the entire
artifact root: it validates the canonical manifest, its hash-chained receipts,
snapshots, freeze, gate artifacts, and requested phase, but writes, repairs,
or aggregates nothing. Producer subcommands such as `release:verify:non-vitest`
are separate commands and run before manifest verification.

The fixed `manifest-transition-root.lease.json` has two discriminated states.
Before the freeze it is a bootstrap lease used only by
`release:freeze:materialize`; after the immutable freeze it is a frozen,
generation-bound lease used by manifest transitions, prepared authority
issuance, and expired-unclaimed terminalization. A dead bootstrap owner before
freeze prepare seals that protected root and requires a new root. If exact
prepared freeze bytes exist, takeover resumes those bytes byte-for-byte. Both
successful freeze paths remove the fixed root-writer lease before success.
After freeze, takeover is explicit and preserves the prepared operation:

```powershell
npm run release:manifest:takeover -- <expected-old-lease-sha256> <protected-artifact-root>
```

The issuer appends content-addressed attestation, previous-hash issuer receipt,
and committed marker under the same frozen lease. A crash replays the exact
prepared bytes and timestamp; it cannot reread the clock or branch the issuer
chain. An expired authority that was never claimed is closed only by its
allowlisted transition token; the terminalizer selects the exact current chain
tip from the protected root, then a replacement may be issued:

```powershell
npm run release:authority:terminalize -- <transition> <protected-artifact-root>
npm run release:authority:issue -- <allowlisted-transition> <protected-artifact-root>
```

Terminalization rejects early expiry and any preclaim, claim, consumption,
action lease, G13 bound session/advisory lock, operation, or effect artifact.
For G13 it verifies the frozen production database identity and holds the exact
schema-032 advisory lock as an absence guard until terminal publication ends.

## Allowlisted gate identities

The strings below are redacted evidence templates, not an invitation to invent
shell commands. Evidence stores the SHA-256 of the exact UTF-8 template and is
rejected if the gate, command ID, or template hash differs.

| Gate/use | Command ID | Exact redacted template |
|---|---|---|
| `G00_BASE` | `base_audit` | `release:base-audit <candidate-sha> <plan-base-sha>` |
| `G01_TRACE` | `acceptance_trace` | `release:trace:verify <artifact-root>` |
| `G02_DATA` | `plan1_focused` | `release:suite plan1 <artifact-root>` |
| `G03_SCORING` | `plan2_focused` | `release:suite plan2 <artifact-root>` |
| `G04_RUNTIME` | `plan3_focused` | `release:suite plan3 <artifact-root>` |
| `G01_TRACE` Plan 4 suite support | `plan4_focused` | `release:suite plan4 <artifact-root>` |
| `G05_TELEGRAM` | `manual_telegram_acceptance` | `release:telegram:manual <artifact-root>` |
| `G06_FULL` | `full_regression` | `git clone --no-checkout <repo> <snapshot> && git checkout --detach <candidate-sha> && npm ci && npm run typecheck && node <snapshot>/node_modules/vitest/vitest.mjs run --configLoader bundle --no-file-parallelism --testTimeout=300000 --hookTimeout=300000 && git diff --check && release:scope-audit && release:postgres-cleanup` |
| clean schema support | `schema_clean_rehearsal` | `release:schema clean <database-fingerprint>` |
| `G07_SCHEMA_OFFLINE` | `schema_production_clone_rehearsal` | `release:schema production_clone <database-fingerprint>` |
| `G08_VERSION_SANITIZED` | `runtime_sanitized_rehearsal` | `release:runtime runtime_sanitized recording_disabled` |
| `G09_LEGACY_TERMINAL` | `legacy_terminal_population` | `release:legacy:snapshot <cutoff> <database-fingerprint>` |
| `G10_ROLLBACK_REHEARSAL` | `rollback_rehearsal` | `rollback:start-previous-runtime --db <runtime_sanitized> --telegram recording_disabled` |
| `G11_POISONING_REGRESSION` | `address_poisoning_regression` | `release:suite addressPoisoningRegression <artifact-root>` |
| `G12_PRODUCTION_BACKUP` | `production_backup` | `release:production:backup <database-fingerprint> <protected-artifact-root>` |
| `G13_PRODUCTION_MIGRATION` | `production_migration` | `release:production:migrate schema-032 <database-fingerprint>` |
| `G14_PRODUCTION_ROLLOUT` | `production_rollout` | `release:production:rollout <candidate-sha> <runtime-label>` |
| `G15_PRODUCTION_CANARY` | `production_canary` | `release:production:canary <candidate-sha> <runtime-label>` |

Controlled runtime and tool attestations use these additional exact IDs and
templates:

| Command ID | Exact redacted template |
|---|---|
| `runtime_sanitized_stop` | `release:runtime:stop <candidate-sha> <runtime-label>` |
| `rollback_stop` | `rollback:stop-previous-runtime <previous-sha> <runtime-label>` |
| `runtime_manager_start_candidate` | `release:task0b:runtime-manager start <artifact-root> <production-go-authority-file>` |
| `runtime_manager_stop_candidate` | `release:task0b:runtime-manager stop <artifact-root> <production-go-authority-file>` |
| `runtime_manager_stop_previous` | `release:task0b:runtime-manager stop <artifact-root> <production-go-authority-file>` |
| `runtime_manager_rollback_previous` | `release:task0b:runtime-manager start <artifact-root> <production-go-authority-file>` |
| `runtime_manager_previous_identity` | `task0b_repo_runtime_manager_v1 start-attestation <pid> <process-started-at> <absolute-entrypoint> <worktree-fingerprint> <sha> <label>` |
| `postgres_tool_pg_dump_attest` | `postgres-tool:attest pg_dump <provider-kind> <immutable-provider-identity>` |
| `postgres_tool_pg_restore_attest` | `postgres-tool:attest pg_restore <provider-kind> <immutable-provider-identity>` |

The manager accepts only a fresh, protected, one-shot authority bound to the
candidate, Task 0B, exact runtime target, manifest, database and Telegram
identities. A start or stop is never inferred from a verifier result.

## Producer order before strict verification

`release:verify` is verifier-only: it validates and aggregates artifacts that
already exist. It does not execute the `G00`-`G11` producers. The required
order is producer-first, strict-verifier-last. The V2 verifier does not accept
hashable arbitrary JSON: it runs concrete semantic validation for the trace,
all six exact suite reports and sidecars, Task 8B RED cleanup, non-Vitest,
schema, sanitized runtime, terminal legacy, rollback, and manual Telegram
artifacts. Every trace GREEN hash and exact file/fullName must resolve in its
owner-plan suite report; this includes the sole AC-33 auxiliary GREEN.

1. Capture a fresh read-only Task 0B against the protected configuration. A
   manager-owned previous runtime uses its exact protected start evidence. If
   its launcher differs from the current guarded manager, it also requires the
   historical protected-origin and Git lineage described above. An
   unmarked one uses only the strict `legacy_unmanaged_previous_runtime`
   branch described above:

   ```powershell
   npm run release:task0b:preflight -- <artifact-root>
   npm run release:freeze:materialize -- <artifact-root>
   npm run release:task0b:revalidate -- <artifact-root>
   ```

   The capture must record zero runtime stops/starts, zero database migrations,
   and zero Telegram sends. Never run the manager to manufacture identity or
   force this step through.

2. Set the exact candidate identity and run each focused suite producer. Each
   PostgreSQL acceptance suite must execute rather than skip:

   Before `plan1` through `plan4`, set `TEST_DATABASE_URL` to that group's
   exact disposable database and remove it before `plan5` or
   `addressPoisoningRegression`. For `plan5`, set
   `PLAN5_TASK0B_TEST_DATABASE_URL` to database `tron_watch` on the isolated
   disposable cluster; production port `55999` is rejected before the suite
   starts.

   ```powershell
   $env:RELEASE_SHA = (git rev-parse HEAD).Trim()
   node --import tsx scripts/verifyRemediationRelease.ts --suite-group plan1 <artifact-root>
   node --import tsx scripts/verifyRemediationRelease.ts --suite-group plan2 <artifact-root>
   node --import tsx scripts/verifyRemediationRelease.ts --suite-group plan3 <artifact-root>
   node --import tsx scripts/verifyRemediationRelease.ts --suite-group plan4 <artifact-root>
   node --import tsx scripts/verifyRemediationRelease.ts --suite-group plan5 <artifact-root>
   node --import tsx scripts/verifyRemediationRelease.ts --suite-group addressPoisoningRegression <artifact-root>
   ```

   The suite producer runs test files serially and bounds every test and hook at
   120 seconds; this prevents database-backed files from racing the shared
   disposable databases while preserving a finite producer timeout. It rejects
   any staged, unstaged, or untracked candidate change both immediately before
   execution and immediately before publishing its sidecar. The non-Vitest
   producer applies the same clean-`HEAD` checks around its full run. Each suite
   and the full non-Vitest run executes from a fresh ephemeral detached local
   Git clone at the exact candidate SHA with lockfile-enforced `npm ci`; ignored worktree
   dependencies and skip-worktree content cannot influence release evidence.
   Plan 4 report/sidecar are owned by `G01_TRACE`; Plan 5 report/sidecar and the
   non-Vitest evidence are owned by `G06_FULL`. The other four suite pairs are
   owned by G02/G03/G04/G11, and every kind/path must occur exactly once.

3. Produce the non-Vitest full-regression evidence, reconstruct the exact
   owner RED runs and missing Task 0A baseline, then capture the acceptance
   trace from the protected capture spec and actual executions:

   ```powershell
   $env:PLAN5_BASE_SHA = '4761e1453ea03a96845b68039e6d6f4812aae540'
   npm run release:verify:non-vitest -- <artifact-root>
   npm run release:trace:prepare -- <artifact-root>
   npm run release:trace:capture -- <artifact-root>
   ```

   Its literal full Vitest run is serialized with five-minute test/hook bounds
   and a one-hour process bound. This retains finite failure handling while
   protecting the whole-repository run from shared filesystem variance.
   Trace preparation uses immutable Git archives for the approved test-only
   commits, applies only the canonical AC-10/11 and AC-33 title patches, and
   requires actual behavioral failures in Vitest JSON. Corrective exceptions
   are closed allowlists, not generic import evidence. AC-07/08/09/12/13/27/39
   accept typed zero-execution `local_product_module_absent` from exact frozen
   Plan 4 commit `20ee8a75…`. The 17 exact Plan 2 primary traces
   AC-03/04/05/06/19/22/23/25/26/28/29/30/31/32/33/36/37 accept assertion-bound
   `local_product_module_absent` from frozen commit `01a29fef…` only. Each Plan 2
   record binds its exact test `fullName`, one and only one exact `src/*`
   module-absence message, exact test patch, owner `83f0cb96…`, and current
   candidate. AC-29/30 may retain their other behavioral assertion messages;
   only the single exact module-absence line is classified as local evidence.
   Their behavioral companions must equal the exact frozen multiset of three
   no-call plus one decision-object `AssertionError`; all other local assertions
   allow no companions. Assertion-mode suite messages are forbidden, and
   aggregate failed-test/failed-suite counts must reconcile exactly. Every
   approved behavioral failure binds SHA-256 of its complete normalized Vitest
   message bytes, not only its first line; normalization removes only absolute
   runtime and snapshot path roots.
   Git must prove every named module absent at the frozen test commit and present
   at owner plus candidate. Generic/no-test/dependency/fixture/environment/
   timeout/synthetic failures, a foreign importer, or multiple local-absence
   messages fail closed.

   The separate secondary `[AC-33][LLM-DAMPENING]` regression is the only
   `candidate_green_only` auxiliary proof. It is not another AC, adds no RED
   coverage, and cannot replace primary AC-33 or its approved RED. Capture
   requires exact fullName, test commit `db5d49a9…`, test patch SHA-256
   `ae069e6d00158fe1a5e05bfe463ee4814257c3f3c3e3f0648f110679df4c9132`,
   owner `83f0cb96…`, final candidate SHA, `passed`, and SHA-256 of the complete
   `suite-plan2.vitest.json` candidate report. That hash must equal primary
   AC-33's full Plan 2 GREEN report hash. The trace set contains exactly 41
   primary RED/GREEN records; this auxiliary is the only secondary record. Any
   additional non-primary trace or auxiliary record, RED substitution, or
   changed binding fails closed.

   Strict release verification replays the trace producer read-only: it reads
   the capture spec plus all concrete RED/GREEN reports and patch bytes, repeats
   exact Git lineage and extension-aware module resolution, rebuilds the trace,
   and requires byte identity with `acceptance-trace.json`. A structurally valid
   trace whose underlying reports or patches are missing or changed is invalid.

   Plan 3 RED preparation always sets `REQUIRE_PLAN3_POSTGRES=1` and binds both
   `PLAN3_TEST_DATABASE_URL` and `TEST_DATABASE_URL` to the exact disposable
   `tron_watch_plan3` database. AC-14/15 must execute; skipped PostgreSQL tests
   are invalid trace evidence. Because the immutable Plan 3 test pins legacy
   loopback port `55432`, the producer recreates that endpoint only inside the
   pinned `node:22-bookworm` image on the disposable PostgreSQL container
   network; it never binds or proxies the production endpoint. The producer
   first verifies the exact loopback publish binding, pinned running PostgreSQL
   container/image and live database/system identity. It creates the frozen
   test-only `tron` login only on that verified disposable database and removes
   it after execution; identity, authentication, connection, transport, setup
   or cleanup drift fails closed. Exact identity pins are container
   `fbb25bec0cfa79a35efddb287f3ae9ba1921fb645558b0b48dfce8b45d60d39e`,
   name `/plan5-release-pg-f97549bc`, and system identifier
   `7664744009044738089`. Failed executions must match the positive frozen
   behavioral allowlist; AC-14/15 specifically require the exact
   `reconcileWaitingForensicCheckJobs` failure and frozen stack location. RED
   execution selects only `[AC-NN]` tests. The Node runner records its exact CID
   in a private control file and carries a cryptographically unique invocation
   label. Cleanup inspects CID, name, pinned image and label before removing by
   CID; it never deletes by name after a collision or failed create. Cleanup
   uses a fresh identity-verified
   admin connection to disable the frozen login, terminate its sessions, revoke
   its grant, drop only objects owned by that new disposable role, drop the role,
   and verify absence even after a failed test run. Its pinned Node container
   has a cryptographically unique tracked name; `finally` force-removes that
   exact container and verifies it absent after success, failure, or timeout.

   AC-20/21/24 are not part of that exception. Preparation replays their exact
   original test patch from frozen commit `20ee8a75…` and runs their behavioral
   RED at `a0f74b3b…`, where local modules load but those exact assertions fail.
   Evidence binds test commit, RED execution commit, owner and candidate as one
   verified ancestry chain.

   Exact patch SHA-256 pins: alerts
   `544fc122c2012bb27452659a795dadbbadcedc4930d54194442558d85737e2b2`,
   renderer
   `c9a755269b1e3935bf8c6d71797e17493a57d4e55e6aa26b63c63c36494118e5`,
   coverage
   `27aa2e5102bee4d1cbba5009f70c2cd2719ceab35c46e4764ab89a0c422ee771`.

4. Rehearse schema 032 on the clean database and the offline production clone.
   Use a separate protected sequence directory per database because the
   producer writes an exclusive four-file sequence. Preserve/promote each
   validated final artifact under the release-root names required by the
   verifier: `schema-clean-evidence.json` and
   `schema-production-clone-evidence.json`.

   ```powershell
   npm run schema:release:sequence -- --offline `
     --database-url-env PLAN5_SCHEMA_CLEAN_DATABASE_URL `
     --expected-endpoint <loopback-host:port> `
     --expected-system-identifier <system-identifier> `
     --artifact-root <protected-clean-sequence-root>

   npm run schema:release:sequence -- --offline `
     --database-url-env PLAN5_SCHEMA_CLONE_DATABASE_URL `
     --expected-endpoint <loopback-host:port> `
     --expected-system-identifier <system-identifier> `
     --artifact-root <protected-clone-sequence-root>
   ```

   The exact full migration-byte and receipt checksum is
   `41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d`.
   The evidence must retain that full value, not only the 12-character display
   prefix. It must also retain the database fingerprint, first apply outcome,
   exact postconditions hash, second `already_verified` outcome, and final
   verification. The candidate repository must be clean, migration 032 must be
   the only version 032 and the newest migration, and no 033+ file may exist.

5. Run the same controlled schema sequence on
   `tron_watch_plan5_runtime_sanitized`, promote its final evidence as
   `schema-runtime-sanitized-evidence.json`, and run the sanitized runtime plus
   pre-GO rollback rehearsal:

   ```powershell
   npm run schema:release:sequence -- --offline `
     --database-url-env PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL `
     --expected-endpoint <loopback-host:port> `
     --expected-system-identifier <system-identifier> `
     --artifact-root <protected-runtime-sequence-root>

   $env:PLAN5_CANDIDATE_RUNTIME_LABEL = '<candidate-runtime-label>'
   npm run release:task0b:revalidate -- <artifact-root>
   npm run release:runtime:rehearse -- <artifact-root>
   ```

   The rehearsal starts the candidate and previous runtime only through the
   controlled manager against the sanitized database. Telegram transport is
   `recording_disabled`; no real Telegram request is allowed. Evidence must
   show `/version`, Admin 200, one process/worker schedule, schema 032 verified,
   candidate stop, previous-runtime rollback start, and rollback stop. `G10`
   must pass before production GO, not after rollout has already failed.
   Candidate/previous start evidence is generated and written by this
   controlled runner after successful execution; no start-evidence fixture is
   created in advance.

6. Snapshot the terminal legacy population in a read-only transaction. The
   cutoff is exactly Task 0B `freezeCutoff`; it is not the command start time or
   an operator-chosen timestamp. It includes only jobs created at or before the
   cutoff with `completed`, `failed`, or `cancelled` status and without current
   `scoring-signal-matrix-v3`. The immutable job/result and sent-fingerprint
   aggregate hashes must remain identical after rehearsal, rollout, or
   rollback.

   ```powershell
   npm run release:task0b:revalidate -- <artifact-root>
   npm run release:legacy:snapshot -- `
     --offline `
     --database-url-env PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL `
     --expected-endpoint <loopback-host:port> `
     --expected-system-identifier <system-identifier> `
     --artifact-root <artifact-root> `
     --task0b-evidence task0b-release-freeze.json
   ```

The canonical Task 0B preflight and materialized freeze never change in this
root. Re-run only `release:task0b:revalidate` at Task 9 entry and immediately
before each liveness-sensitive runtime, terminal-legacy, manual-Telegram, or
strict verification consumer if the latest 15-minute receipt has expired. The
receipt is append-only and content-addressed; any mismatch from the frozen
operational tuple, other than the fresh exclusive-write probe, blocks the
release.

7. Prepare manual Telegram evidence with no network send:

   ```powershell
   npm run release:telegram:manual -- <artifact-root>
   ```

   With no action variable, this is `prepare` only. It verifies Task 0B,
   candidate/runtime identity, the loopback sanitized database, schema 032,
   and seeds non-claimable terminal fixture jobs. The sanitized transport stays
   `recording_disabled`, and `progress_json.telegramDelivery` is forbidden for
   these jobs.

8. Create the first manifest transition from the automated producer evidence,
   using the only legal initial source token, then run the read-only
   `pre-manual` verifier while `G05_TELEGRAM` is still pending:

   ```powershell
   npm run release:manifest:advance -- pre_manual absent <artifact-root>
   npm run release:verify -- --phase pre-manual --artifact-root <artifact-root>
   ```

   `pre-manual` requires all automated `G00`-`G11` gates passed except
   `G05_TELEGRAM=pending`; `overall` remains `not_ready`. It does not send or
   finalize Telegram evidence.

9. Only in guarded Task 9, after separate user authorization, send the frozen
   payloads once through a dedicated test bot to a non-production test chat:

   ```powershell
   $env:PLAN5_TELEGRAM_MANUAL_ACTION = 'send'
   $env:PLAN4_TELEGRAM_ALLOW_SEND = '1'
   npm run release:telegram:manual -- <artifact-root>
   ```

   `PLAN4_TELEGRAM_TEST_BOT_TOKEN` and
   `PLAN4_TELEGRAM_TEST_CHAT_ID` are supplied at runtime only. The current
   production `BOT_TOKEN` and `SERVICE_ADMIN_TG_IDS` are read solely to prove
   token/chat inequality. They are never copied into evidence. There are no
   retries or polling. A partial journal is terminal and blocks a blind rerun.

10. Add the reviewed screenshots and finalize explicitly:

   ```powershell
   $env:PLAN5_TELEGRAM_MANUAL_ACTION = 'finalize'
   npm run release:telegram:manual -- <artifact-root>
   ```

   Finalization accepts exactly 15 scenario summaries, 19 message records, and
   11 golden comparisons. Every message is bound to fixture ID, checked wallet,
   synthetic terminal job, payload hash, Telegram message ID, and screenshot
   hash. Screenshots are bounded regular non-symlink PNG files within the
   protected root. `G05_TELEGRAM` stays `pending` until all 15/19/11 evidence is
   present and finalized. No real Telegram send occurs before guarded Task 9.

11. Hash the exact current manifest, advance from that source, then run the
    strict read-only `readiness` verifier:

    ```powershell
    $source = (Get-FileHash -Algorithm SHA256 `
      (Join-Path '<artifact-root>' 'release-manifest.json')).Hash.ToLowerInvariant()
    npm run release:manifest:advance -- readiness $source <artifact-root>
    npm run release:verify -- --phase readiness --artifact-root <artifact-root>
    ```

    `readiness` is valid only after every `G00`-`G11` gate passes and production
    gates remain pending; only then may the manifest say `ready_for_release`.

After a separately authorized merge to `master`, compare the merge SHA to the finalized candidate
SHA. A fast-forward that preserves the exact SHA also preserves the finalized
15 scenario summaries, 19 message records, and 11 golden comparisons. Rerun
only the automated producers/gates and strict verifier for that same SHA; never
resend the terminal 19-message journal. If the merge changes the SHA, the
candidate freeze and SHA-bound manual evidence are invalid. A new manual cycle
then requires an explicit plan amendment and user decision; do not resend by
default. A green branch manifest does not authorize production.

## Explicit GO, protected backup, migration, rollout, and canary

These are future Tasks 10-12 operations: Task 10 merges to `master`, performs
the exact-SHA rerun, and obtains explicit release GO; Task 11 owns
`G12_PRODUCTION_BACKUP` and `G13_PRODUCTION_MIGRATION`; Task 12 owns
`G14_PRODUCTION_ROLLOUT` and `G15_PRODUCTION_CANARY`. They are listed so the
rollback and evidence boundaries are fixed; none has been executed now.

Obtain explicit user release GO first. Revalidate the exact clean release SHA,
immutable freeze, current manifest, Task 0B, runtime/Telegram identities,
production database fingerprint, rollback rehearsal, and terminal legacy
snapshot before every action. Supply the production URL only as protected
environment variable `TASK0B_PRODUCTION_DATABASE_URL`; never place it in argv
or evidence.

### G12 and G13 exact order

G12 keeps its dedicated backup claim/lease/progress protocol. The sole issuer
and producer select the unique compatible V2 authority from the protected root;
the operator never supplies an authority filename:

```powershell
npm run release:authority:issue -- g12_backup_passed <protected-artifact-root>
npm run release:production:backup -- <protected-artifact-root>
$source = (Get-FileHash -Algorithm SHA256 `
  (Join-Path '<protected-artifact-root>' 'release-manifest.json')).Hash.ToLowerInvariant()
npm run release:manifest:advance -- g12_backup_passed $source <protected-artifact-root>
npm run release:verify -- --phase g12 --artifact-root <protected-artifact-root>
```

The backup producer alone owns pinned `pg_dump --format=custom` and
`pg_restore --list`, exact database identity, claim/lease, progress, bounded
resume, and final evidence. It never writes the manifest. Only the manifest
advance marks G12 passed and deliberately returns `overall=not_ready` with
G13-G15 pending. Issuance is bounded to 70 minutes; claim requires at least 65
minutes remaining for the one-hour child bound plus settlement margin.

G13 keeps its same-session advisory-lock claim protocol and also accepts only
the protected root, never a raw authority path:

```powershell
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

The sequence owns migration 032, checksum/receipt/postcondition verification,
the second `already_verified` no-op, and final verification. G12/G13 revalidate
their consumed authority as strictly unexpired before each database/tool leaf
and settlement; they do not use the Task 12 immutable operation deadline. G13
issuance is bounded to 30 minutes and claim requires at least 25 minutes
remaining for the bounded sequence plus settlement margin.

### G14, G15, takeover, and terminal order

For G14, G15, recovery, and actual rollback the only claim order is: select the
unique active compatible issuer-chain tip → acquire the original production
lease → persist an immutable preclaim bound to that original lease hash, epoch,
owner, operation, freeze, source manifest, and authority → resolve the exact
linear committed takeover lineage/current tip → atomically create claim and
consumption. A branch, gap, swapped or foreign receipt/lease/lineage, stale tip,
conflicting extension, or orphan preclaim fails closed. Takeover never rewrites
the original preclaim.

Before every external stop/start effect, the orchestrator fsyncs its exact
claim/consumption-bound step intent. It then fsyncs the receipt and terminal
evidence. Success or typed failure always closes in this order: durable
settlement → canonical prepared lease removal → removal of the exact owned
current lease → publication of the prepared byte-exact removal receipt →
terminal cleanup binding. Crash recovery resumes the first missing durable
boundary and never regenerates removal time or repeats an uncertain effect.

Every G14/G15/recovery/actual-rollback leaf, reconciliation, query, settlement,
and normal takeover requires both `now < consumedAuthority.expiresAt` and
`now < immutable operationDeadlineAt`; equality fails closed and neither bound
is extended. Normal dead-owner takeover preserves the original bounds and then
automatically resumes the same orchestrator:

```powershell
npm run release:production:lease:takeover -- `
  <expected-old-lease-sha256> <protected-artifact-root>
```

After either bound, a proven-dead expired lease permits cleanup only:

```powershell
npm run release:production:lease:cleanup-only-takeover -- `
  <expected-old-lease-sha256> <protected-artifact-root>
```

Cleanup-only may publish abandonment and the removal/cleanup chain. It cannot
query production, run an effect, settle a gate, emit gate evidence, or advance
the manifest.

G14 is one orchestrator command; direct runtime-manager stop/start, health,
SQL, reconciliation, and capture leaf commands are forbidden:

```powershell
npm run release:authority:issue -- g14_rollout_passed <protected-artifact-root>
npm run release:production:rollout:execute -- <protected-artifact-root>
$source = (Get-FileHash -Algorithm SHA256 `
  (Join-Path '<protected-artifact-root>' 'release-manifest.json')).Hash.ToLowerInvariant()
npm run release:manifest:advance -- g14_rollout_passed $source <protected-artifact-root>
npm run release:verify -- --phase g14 --artifact-root <protected-artifact-root>
```

A typed G14 pre-effect schema/runtime-identity/singleton failure records only
local validation, has `attemptedExternalEffect:false`, selects
`previous_runtime_retained`, and emits no invented stop/start/candidate
capture. Any typed production failure advances only `production_failed`:

```powershell
$source = (Get-FileHash -Algorithm SHA256 `
  (Join-Path '<protected-artifact-root>' 'release-manifest.json')).Hash.ToLowerInvariant()
npm run release:manifest:advance -- production_failed $source <protected-artifact-root>
npm run release:verify -- --phase manifest --artifact-root <protected-artifact-root>
```

G15 likewise exposes only its orchestrator:

```powershell
npm run release:authority:issue -- g15_canary_released <protected-artifact-root>
npm run release:production:canary:execute -- <protected-artifact-root>
$source = (Get-FileHash -Algorithm SHA256 `
  (Join-Path '<protected-artifact-root>' 'release-manifest.json')).Hash.ToLowerInvariant()
npm run release:manifest:advance -- g15_canary_released $source <protected-artifact-root>
npm run release:verify -- --phase released --artifact-root <protected-artifact-root>
```

### Recovery-only and actual rollback

After cleanup-only abandonment, recovery uses a separate fresh authority and
new lease/claim. It validates the exact abandonment+cleanup chain, contiguous
completed receipt prefix, and at most one uncertain marker backed by the actual
fsynced unmatched step-intent path/hash. It emits typed local-validation step
receipts and an overall recovery receipt before failure evidence references
them, emits no normal gate evidence, and never observes, reconciles, or replays
the uncertain effect:

```powershell
npm run release:authority:issue -- production_failed <protected-artifact-root>
npm run release:production:recovery:execute -- <protected-artifact-root>
$source = (Get-FileHash -Algorithm SHA256 `
  (Join-Path '<protected-artifact-root>' 'release-manifest.json')).Hash.ToLowerInvariant()
npm run release:manifest:advance -- production_failed $source <protected-artifact-root>
npm run release:verify -- --phase manifest --artifact-root <protected-artifact-root>
```

Any migration, rollout, or canary mismatch stops forward progress. Actual
rollback begins only from the exact current `production_failed` lineage and is
also a sole orchestrator; direct leaf commands are forbidden:

```powershell
npm run release:authority:issue -- rollback_rolled_back <protected-artifact-root>
npm run release:production:rollback:execute -- <protected-artifact-root>
$source = (Get-FileHash -Algorithm SHA256 `
  (Join-Path '<protected-artifact-root>' 'release-manifest.json')).Hash.ToLowerInvariant()
npm run release:manifest:advance -- rollback_rolled_back $source <protected-artifact-root>
npm run release:verify -- --phase rolled-back --artifact-root <protected-artifact-root>
```

Rollback selects only its typed observed branch, keeps additive schema 032,
and rechecks Admin, singleton, `/version`, queues, conservative allowance,
sent delivery, and immutable completed results. No production backup,
migration, rollout, canary, recovery, rollback, takeover, runtime, database, or
Telegram command in this section has been executed. A live runtime without
manager start evidence may be observed only through the strict read-only
legacy-unmanaged Task 0B contract; it must not be adopted, stopped, restarted,
or replaced implicitly.

## Honest residual limits and forbidden scope

Plan 5 does not promise unlimited history. Configured
`hard_safety_limit_exceeded`, inline/broad page ceilings, local materialization
ceilings, provider caps, retries, and provider availability remain honest
technical no-final outcomes. A release can prove the bounded behavior without
claiming those ceilings no longer exist.

Address Poisoning implementation is forbidden Plan 5 scope. Only its regression
suite runs at `G11`; no detector, scoring isolation, alert copy, migration, or
runtime behavior is changed here. The separate `APC-01` closeout may begin only
after the release manifest reaches `released` or `rolled_back`.
