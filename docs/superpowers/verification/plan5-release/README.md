# Plan 5 remediation release runbook

Status: `release candidate ready/pending approval` as a human handoff state.
The machine manifest is still `not_ready`, not `ready_for_release`: fresh Task
0B operational preflight, guarded Task 9, and the manual `G05_TELEGRAM`
evidence are pending. Nothing in this runbook records a production deployment.

Tasks 0A and 1-8 are complete. Task 8 is this candidate-only documentation
handoff. The controlled schema producer corrections in
`4d674590`, `87218388`, `9c13bfbf`, and `16af807a` are part of the candidate
behavior. The release SHA is always the clean checked-out `HEAD` used to
produce the evidence; do not substitute one of those ancestor SHAs.

Backup implementation commit `359e83ca1534dc06481ba9bc724ee803744f55f9`
added the controlled `release:production:backup` producer, and its local
acceptance tests pass. The release candidate SHA remains the dynamically
observed current clean `HEAD`; the implementation commit is not a frozen
candidate identity. The producer has not been run against production and
`G12_PRODUCTION_BACKUP` is still pending.

## Current production observation and external block

Task 0A observed the previous runtime without changing it:

- SHA `0172978845ec74373bd245098ee8c075e0c39acf`;
- label `master-01729788`;
- database `tron_watch` on loopback port `55999`, schema 031, no schema 032
  receipt;
- Admin HTTP 200;
- Telegram long polling.

The live process was not started by the new repository runtime manager and is
therefore unmarked by its `runtime_manager_previous_identity` attestation.
Operational preflight is externally blocked before Task 9. Do not adopt,
restart, stop, or replace that process under this documentation task. Task 9
requires separate user approval for controlled adoption/restart (or a plan
amendment), followed by a fresh Task 0B capture.

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
```

Only these database names are accepted by the schema producer:

| Role | Environment variable | Exact database name | Rule |
|---|---|---|---|
| clean rehearsal | `PLAN5_SCHEMA_CLEAN_DATABASE_URL` | `tron_watch_plan5_clean` | loopback and `--offline` |
| production-clone rehearsal | `PLAN5_SCHEMA_CLONE_DATABASE_URL` | `tron_watch_plan5_clone` | restored clone only, loopback and `--offline` |
| sanitized runtime rehearsal | `PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL` | `tron_watch_plan5_runtime_sanitized` | loopback and `--offline` |
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
| Telegram fixture support | `plan4_focused` | `release:suite plan4 <artifact-root>` |
| `G05_TELEGRAM` | `manual_telegram_acceptance` | `release:telegram:manual <artifact-root>` |
| `G06_FULL` | `full_regression` | `npm test && npm run typecheck && git diff --check && release:scope-audit && release:postgres-cleanup` |
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
order is producer-first, strict-verifier-last.

1. After the separately approved adoption/restart decision or plan amendment
   required before Task 9, capture a fresh read-only Task 0B against the
   protected configuration:

   ```powershell
   npm run release:task0b:preflight -- <artifact-root>
   ```

   The capture must record zero runtime stops/starts, zero database migrations,
   and zero Telegram sends. Until the current unmarked-runtime block is
   resolved, do not run the manager to force this step through.

2. Set the exact candidate identity and run each focused suite producer. Each
   PostgreSQL acceptance suite must execute rather than skip:

   ```powershell
   $env:RELEASE_SHA = (git rev-parse HEAD).Trim()
   node --import tsx scripts/verifyRemediationRelease.ts --suite-group plan1 <artifact-root>
   node --import tsx scripts/verifyRemediationRelease.ts --suite-group plan2 <artifact-root>
   node --import tsx scripts/verifyRemediationRelease.ts --suite-group plan3 <artifact-root>
   node --import tsx scripts/verifyRemediationRelease.ts --suite-group plan4 <artifact-root>
   node --import tsx scripts/verifyRemediationRelease.ts --suite-group plan5 <artifact-root>
   node --import tsx scripts/verifyRemediationRelease.ts --suite-group addressPoisoningRegression <artifact-root>
   ```

3. Produce the non-Vitest full-regression evidence, then capture the acceptance
   trace from its protected capture spec and the actual executions:

   ```powershell
   $env:PLAN5_BASE_SHA = '4761e1453ea03a96845b68039e6d6f4812aae540'
   npm run release:verify:non-vitest -- <artifact-root>
   npm run release:trace:capture -- <artifact-root>
   ```

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
   npm run release:runtime:rehearse -- <artifact-root>
   ```

   The rehearsal starts the candidate and previous runtime only through the
   controlled manager against the sanitized database. Telegram transport is
   `recording_disabled`; no real Telegram request is allowed. Evidence must
   show `/version`, Admin 200, one process/worker schedule, schema 032 verified,
   candidate stop, previous-runtime rollback start, and rollback stop. `G10`
   must pass before production GO, not after rollout has already failed.

6. Snapshot the terminal legacy population in a read-only transaction. The
   cutoff is exactly Task 0B `freezeCutoff`; it is not the command start time or
   an operator-chosen timestamp. It includes only jobs created at or before the
   cutoff with `completed`, `failed`, or `cancelled` status and without current
   `scoring-signal-matrix-v3`. The immutable job/result and sent-fingerprint
   aggregate hashes must remain identical after rehearsal, rollout, or
   rollback.

   ```powershell
   npm run release:legacy:snapshot -- `
     --offline `
     --database-url-env PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL `
     --expected-endpoint <loopback-host:port> `
     --expected-system-identifier <system-identifier> `
     --artifact-root <artifact-root> `
     --task0b-evidence task0b-release-freeze.json
   ```

7. Prepare manual Telegram evidence with no network send:

   ```powershell
   npm run release:telegram:manual -- <artifact-root>
   ```

   With no action variable, this is `prepare` only. It verifies Task 0B,
   candidate/runtime identity, the loopback sanitized database, schema 032,
   and seeds non-claimable terminal fixture jobs. The sanitized transport stays
   `recording_disabled`, and `progress_json.telegramDelivery` is forbidden for
   these jobs.

8. Build the manifest from the automated producer evidence, then run only the
   `pre-manual` verifier while `G05_TELEGRAM` is still pending:

   ```powershell
   npm run release:verify -- pre-manual <artifact-root>
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

11. Update the manifest from the finalized manual evidence, then run the strict
    `readiness` verifier:

    ```powershell
    npm run release:verify -- readiness <artifact-root>
    ```

    `readiness` is valid only after every `G00`-`G11` gate passes and production
    gates remain pending; only then may the manifest say `ready_for_release`.

After merging to `master`, compare the merge SHA to the finalized candidate
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

1. Obtain explicit user release GO and fresh, narrowly scoped, protected
   one-shot authorities. Revalidate Task 0B, exact merge SHA, runtime label,
   production database fingerprint, Telegram identity, and the ready manifest
   immediately before each controlled mutation.
2. Supply the production database URL only through the protected process
   environment as `TASK0B_PRODUCTION_DATABASE_URL`; never put it in argv, the
   authority, logs, or artifacts. Then run the controlled producer with the
   protected root and authority filename only:

   ```powershell
   npm run release:production:backup -- <protected-artifact-root> <production-backup-authority-...json>
   ```

   The fresh authority is a single-use explicit GO valid for at most ten
   minutes. It is bound byte-for-byte to Task 0B, the `ready_for_release`
   manifest, exact clean candidate SHA, protected-root fingerprint, production
   database identity, command ID, and template hash. The producer uses only the
   Task 0B-attested immutable Docker image: pinned `pg_dump --format=custom`
   receives the password through stdin, and pinned `pg_restore --list` runs
   with `--network none`, `--pull never`, and a read-only artifact mount.

   Before the exclusive claim, before the first dump, and immediately before
   atomically linking final evidence, the producer revalidates the exact
   authority, Task 0B, manifest, candidate, root, database identity, and active
   operation ownership. A generation-bound consumption claim, exclusive
   operation lease, dump progress receipt, and restore-list progress receipt
   serialize retries and prove ownership. A new operation must claim and start
   while the authority is fresh. A lease acquired while fresh may finish after
   GO expiry only within its bounded one-hour child timeout. After expiry,
   resume is allowed only from the exact owned dump progress receipt and never
   invokes a second dump; a claim without that receipt fails closed.

   Successful output consists of the stable custom-format
   `production-backup.dump`, `production-backup-restore-list.txt`, and
   `production-backup-evidence.json`, with actual sizes, hashes, restore-list
   entry count, database identity, and path fingerprint. The producer does not
   mutate `release-manifest.json`.
3. Run the verifier/aggregator over the completed evidence; only it may mark
   `G12_PRODUCTION_BACKUP=passed`. At that point the manifest must deliberately
   return to `overall=not_ready`: `G00`-`G12` passed and `G13`-`G15` pending.
   This is the required mutation interlock, not a failure or an invented
   pending-reason enum.
4. Issue a fresh production migration authority named
   `schema032-production-authority-<generation>.json`, valid for at most ten
   minutes and bound to that protected Task 0B, current `not_ready` manifest,
   backup hash, database fingerprint, exact candidate, `explicitGo=true`, and
   command ID `production_migration`. The schema producer rechecks the
   authority and protected backup again immediately before consuming it.
5. Run the controlled production sequence without `--offline` and only with
   the authority filename:

   ```powershell
   npm run schema:release:sequence -- `
     --database-url-env TASK0B_PRODUCTION_DATABASE_URL `
     --expected-endpoint <loopback-host:port> `
     --expected-system-identifier <system-identifier> `
     --artifact-root <artifact-root> `
     --production-authority-file <authority-file>
   ```

   The producer owns child database role/identity binding and the advisory
   lock. It runs migration 032 once, verifies the full checksum/receipt and all
   postconditions, runs the second migration as `already_verified`, and
   performs final verification. `schema:verify` alone cannot satisfy G13.
6. Mark `G13_PRODUCTION_MIGRATION=passed`, then use fresh runtime-manager
   authorities to stop the exact previous managed runtime and start the exact
   candidate. Never use a generic process kill or an unmarked-process guess.
   Mark G14 only after one candidate process/worker schedule is observed,
   `/version` reports the merge SHA, candidate label, policy/result/narrative
   versions and schema 032 checksum, and Admin returns 200.
7. Canary the actual candidate: Where, Incoming, targeted-index, reconciler,
   delivery and allowance-refresh cycles alive; stranded all-ready resume once;
   sent fingerprint not resent; retry attempts bounded; normal navigation
   cache-only; explicit refresh live; stale allowance not called active; no raw
   secrets/actors in logs. Mark `G15_PRODUCTION_CANARY=passed` only after these
   observations. The strict `released` phase is valid only when G00-G15 all
   pass.

## Rollback

Any migration, rollout, or canary mismatch stops forward progress. Use a fresh
one-shot `runtime_manager_stop_candidate` authority to stop the exact managed
candidate, then `runtime_manager_rollback_previous` to start the exact
Task 0B-bound previous SHA/label. Repeat `/version`, Admin 200, singleton
process/workers, database compatibility, and Telegram transport checks. The
additive schema 032 migration remains in place; do not destructively roll it
back. Sent delivery fingerprints stay sent, completed jobs are not rescored,
and the terminal legacy snapshot must remain unchanged. Record the manifest as
`rolled_back` only through its validated rollback state.

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
