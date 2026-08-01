# Stage B Release Evidence Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair and prove the real Stage B evidence path, then close the current release decision honestly. Real replay, PostgreSQL proof, reviewed deployment integration, accepted Where and Deep receipts, plus an installed and validated attributable observer may authorize only a separately approved reversible trial at Where concurrency `2`. The completed attributable observation decides whether to retain `2` or restore `1`; until that chain exists, retain `1`.

**Architecture:** Keep four identities separate. A harness-fix commit changes only recorder/replay tooling, a fixture commit freezes real TXc evidence under that clean recorder identity, a combined candidate integrates those commits with the correctness branch, and a later reviewed deployment-integration commit owns the tracked adapter/bridge composition. Strict replay remains bound to the historical behavior source. Missing deployment or observability capability is a successful hard-stop outcome (`default 1`), not evidence to fabricate an analyzer or canary.

**Tech Stack:** TypeScript 5.7, Node.js standard library, Vitest, PostgreSQL schema 037, existing Where replay/canary contracts, canonical JSON/SHA-256 artifacts, structured JSONL logs, Git worktrees, and current knowledge docs.

---

## Verified Boundary

- Stage B runtime core is implemented: selective raw/full enrichment, immutable evidence reuse, claim-generation fencing and the bounded work-conserving Where slot pump.
- Unit tests plus replay/canary client contracts exist, but the real capture path is not yet proven. Code inspection confirms recorder defects: PostgreSQL timestamps are rejected when returned as `Date`; completed-job reruns receive live mutation callbacks and can trip the claim fence; assertion rows can leak a forbidden `createdByTelegramId` key into the envelope; `execution.dispose()` is not called; endpoint projection can retain credentials/query material; and canonical output is not checked against configured secret values that a provider error could echo.
- The repository/runtime default is `FORENSIC_WHERE_WORKER_CONCURRENCY=1`. The actually deployed value must be observed and recorded before any trial; repository defaults alone do not prove production configuration.
- The real TXc fixture, real PostgreSQL gate, accepted Where canary receipt, separately valid Deep receipt and attributable production receipt do not exist yet.
- The trusted canary CLI expects a tracked single-file adapter inside a clean deployment root. The combined candidate has no such adapter, bridge server, cycle-isolated composition or deployment-receipt builder, so current loader requirements cannot be satisfied by dropping in an untracked external bundle.
- Current Deep residual capture uses a start bound derived from the Where poll interval, while the real Deep poll is separate and normally much longer. It is not release evidence until Deep start/poll semantics are bound and attested.
- Existing provider logs are process-global and lack legacy-Where lane attribution. They cannot prove a Where-only 30-minute comparison. TronGrid fallback must also be treated as provider degradation rather than silently excluded from any future numerator.
- TQr is a Unified run. This plan does not stop, restart, reprioritize or diagnose it, and legacy Where concurrency cannot fix its traversal latency.

## Exact File Map

### Harness-fix commit

- Modify: `scripts/captureWhereLatencyReplay.ts`
  - Accept PostgreSQL `Date` values, bind the approved non-secret config hash, build read-only capture dependencies, project safe assertion rows, and always dispose the execution.
- Modify: `src/forensics/whereLatencyReplay.ts`
  - Export the minimal canonical assertion projection already consumed by replay and reject credential/query-bearing provider endpoint identities; this file is not a legacy behavior-source input.
- Modify: `tests/forensics/whereLatencyReplay.test.ts`
  - Cover the safe assertion projection and forbidden-field removal.
- Create: `tests/scripts/captureWhereLatencyReplay.test.ts`
  - Cover timestamp decoding, read-only dependency construction, configured-secret rejection and disposal on success/failure.
- Modify: `scripts/runWhereLatencyCanary.ts`
  - Require a caller-bound create-only output path for `run`; add canonical
    run/Deep readers and a create-only evidence-binding manifest command that
    persists trusted-CLI, combined-candidate, deployment and receipt identities.
- Modify: `tests/scripts/runWhereLatencyCanary.test.ts`
  - Cover required `run --out`, canonical run/Deep readback and manifest
    create-only/trust-chain behavior.

### Produced only from real evidence

- Create: `tests/fixtures/forensics/txc-legacy-where-latency-v1.json`

### Product truth after the attempted gate

- Modify: `docs/knowledge/03-job-lifecycle.md`
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/05-where-is-money-and-incoming.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`
- Modify: `docs/knowledge/12-runbooks.md`
- Modify: `docs/knowledge/14-current-roadmap.md`

### Explicitly outside this implementation plan

- No opportunistic loopback server, adapter generator, infrastructure routing, scheduler attribution, production analyzer, schema migration, provider-capacity increase, Deep concurrency increase, Unified change or TQr mutation.
- If deployment integration is absent, hand off a proposed `docs/superpowers/specs/2026-07-28-stage-b-canary-deployment-integration-design.md` for user review and brainstorming before implementation.
- If attributable rollout input is absent, hand off a proposed `docs/superpowers/specs/2026-07-28-stage-b-rollout-observability-design.md` for user review and brainstorming before implementing an analyzer.
- This plan does not create or self-approve either design.

## Task 0: Freeze identities and preserve the dirty checkout

- [ ] **Step 1: Work only in dedicated clean worktrees**

The user's current checkout contains unrelated work. Do not clean, reset, move,
stage or commit it. Use the worktree skill during execution and record each clean
root with:

```powershell
function Assert-NativeSuccess([string]$code) { if ($LASTEXITCODE -ne 0) { throw $code } }
git rev-parse HEAD
Assert-NativeSuccess 'stage_b_git_head_failed'
git rev-parse 'HEAD^{tree}'
Assert-NativeSuccess 'stage_b_git_tree_failed'
git status --short
Assert-NativeSuccess 'stage_b_git_status_failed'
```

Use distinct roots for:

1. recorder harness fix and fixture capture;
2. correctness plus Stage B combined candidate;
3. any later immutable deployment-integration candidate;
4. the trusted canary CLI host, which writes receipts outside deployment root.

- [ ] **Step 2: Read the current truth and predecessor contract**

Read in full:

```text
docs/knowledge/AGENT_BRIEF.md
docs/knowledge/03-job-lifecycle.md
docs/knowledge/04-data-sources-tronscan-indexing.md
docs/knowledge/05-where-is-money-and-incoming.md
docs/knowledge/06-deepcheck.md
docs/knowledge/09-current-decisions.md
docs/knowledge/10-open-problems.md
docs/knowledge/12-runbooks.md
docs/knowledge/14-current-roadmap.md
docs/superpowers/specs/2026-07-28-correctness-stage-b-unified-latency-design.md
docs/superpowers/plans/2026-07-26-where-queue-and-transaction-info-latency.md
```

- [ ] **Step 3: Pin the historical and future identities**

The harness-fix base is:

```text
5bb7297bc5b274209475148f5c2c6556ef305b34
```

The legacy semantic baseline remains:

```text
4861f22e697652c688489ef4be6ab9698cd6ef9f
```

Do not change `LEGACY_WHERE_REPLAY_BASELINE_COMMIT`,
`LEGACY_WHERE_BEHAVIOR_SOURCE_TREE_HASH`, expected stable facts or any file in
`LEGACY_WHERE_BEHAVIOR_SOURCE_FILES` to make capture pass.

The evidence-source/recorder commit is the future clean harness-fix descendant
of `5bb7297b`, not `5bb7297b` itself. Capture happens from a second clean checkout
of that exact SHA. The next commit adds only the fixture. Strict replay runs from
a clean checkout of the fixture commit. Later correctness changes are proven by
their own gate and must not be mislabeled as strict v1 replay.

- [ ] **Step 4: Reconfirm defaults without claiming deployed state**

```powershell
$whereDefault = rg -n 'FORENSIC_WHERE_WORKER_CONCURRENCY=1' .env.example
if ($LASTEXITCODE -ne 0) { throw 'stage_b_where_default_missing' }
$whereDefault
$whereConfig = rg -n 'FORENSIC_WHERE_WORKER_CONCURRENCY|forensicWhereWorkerConcurrency' src/config.ts
if ($LASTEXITCODE -ne 0) { throw 'stage_b_where_config_missing' }
$whereConfig
$deepWiring = rg -n 'runForensicJobsOnce\(\[[^]]*address_deep_check[^]]*\], 1\)' src/index.ts
if ($LASTEXITCODE -ne 0) { throw 'stage_b_deep_singleton_wiring_missing' }
$deepWiring
```

Expected: repository/runtime Where default `1`; actual Deep wiring singleton.
Record the deployed Where value only from an approved runtime/deployment receipt.

## Task 1: Repair the real capture adapter test-first

- [ ] **Step 1: Add failing capture regressions**

Make `scripts/captureWhereLatencyReplay.ts` import-safe with the smallest
standard-library main guard needed by tests. Export exactly the small seams the
real code calls—`parseCaptureTimestamp(value, code)`,
`assertExpectedReplayConfigSha256(resolvedConfig, expectedSha256)`,
`createReadOnlyCaptureRuntimeDeps(readDeps)` and
`runCaptureExecution(execution, checkerDeps)`. The last helper owns
`run`/`dispose`; the dependency projector accepts injected read callbacks and
returns the object passed to `createLegacyWhereIsMoneyExecution`. Do not use
source-text assertions or require a real database/network to prove these
boundaries. In
`tests/scripts/captureWhereLatencyReplay.test.ts`, cover:

- strict timestamp decoding accepts PostgreSQL `Date` and an ISO string for
  `window_start`, `window_end` and `completed_at`;
- invalid dates, other value types and `windowStart >= windowEnd` fail with the
  existing stable capture errors;
- missing/malformed `--expected-config-sha256` and a mismatch against canonical
  `projectWhereReplayConfig(loadConfig())` fail before DB/provider work;
- capture runtime dependencies retain DB/provider reads but omit
  `updateForensicCheckJobProgress`, `releaseForensicCheckJobToWaiting`,
  `queueAddressUsdtHistory`, `upsertForensicJobWait` and
  `markWaitingForensicJobsReadyAfterTargetedIndex`;
- rerunning a completed source job with `startedAt: null` keeps progress in
  memory and never calls a mutation/claim-fence callback;
- `execution.dispose()` runs exactly once after success and after a thrown rerun.
- the pre-serialization artifact is rejected before write when any string leaf
  contains any non-empty configured credential currently present in `AppConfig`:
  `botToken`, `databaseUrl`, every TronScan key, full-node key, Range/EVM/Alchemy
  keys, LLM key and `adminDashboardToken`. Include a secret with quotes,
  backslashes/control characters echoed inside provider error text; the stable
  error never prints the matched value.

Export the smallest pure seam used by the writer for that last boundary, for
example `assertCaptureValueContainsNoConfiguredSecrets(value, config)`, so the
test recursively scans actual string leaves before JSON escaping and exercises
real production wiring rather than source text. Keep one explicit extractor for
the current credential-bearing `AppConfig` fields and a regression that includes
every field above; do not infer secrets from property-name regexes.

In `tests/forensics/whereLatencyReplay.test.ts`, add a real-shaped assertion row
containing `createdByTelegramId: null`. The capture projection must retain only
`chain`, `address`, `status` and sanitized `evidenceJson`, because that is exactly
what replay consumes. It must recursively omit forbidden keys and preserve the
approval/drain/path hashes used by `assertionMatches`.

Add config-projection cases for all provider base URLs. HTTPS URLs with username,
password, query or fragment must be rejected rather than copied into
`resolvedConfig`; a safe URL retains only its reviewed origin/path identity.
Descriptor fields such as `tronscanApiKeyConfigured`, key count and group sizes
remain allowed because they contain no key value.

Add an import-safe `validate` CLI branch to the capture script. It reads an
untracked candidate fixture, requires canonical bytes, runs the complete
`parseWhereLatencyReplayV1` structured validation (including the special
validated `resolvedConfig` projection) and prints exactly one canonical object:

```ts
{
  schema: "where-latency-replay-validation-v1";
  version: 1;
  fixtureSchema: "where-latency-replay-v1";
  fixtureVersion: 1;
  fixtureFileSha256: string;
  configProjectionSha256: string;
  resolvedConfigHash: string;
}
```

`fixtureFileSha256` hashes the raw canonical file bytes;
`configProjectionSha256` uses the same canonical SHA-256 implementation as
`assertExpectedReplayConfigSha256` over parsed `resolvedConfig`; and
`resolvedConfigHash` is the already validated config-plus-options hash. The
branch performs no replay, DB or provider work. Cover valid, non-canonical,
forbidden-field and unsafe-URL fixtures in the script test.

In `tests/scripts/runWhereLatencyCanary.test.ts`, require `run --out <path>`,
prove that an existing path is never overwritten, and cover exported
`readWhereLatencyCanaryRunDocument(path)`: it must require canonical bytes,
validate the complete `where-latency-canary-run-v1` shape and self-hash, and
return the raw file SHA-256. The CLI may print the receipt only after reopening
the file through this reader. Add the symmetric
`readWhereLatencyDeepResidualDocument(path)` and make `deep-residual` reopen
through it before stdout.

Use these exact test titles for the five independent RED boundaries so the RED
gate can prove intended assertion failures rather than accept one generic
compile/setup failure:

```text
accepts PostgreSQL Date rows without capture mutations
rejects configured credentials before capture serialization
disposes the capture execution after success and failure
projects replay assertions and provider URLs safely
writes a canonical create-only canary run receipt through --out
```

Add an import-safe `attest` CLI branch in the same script, not a new analyzer. It
accepts either `--isolation-receipt` plus `--run-receipt`, or one
`--deep-receipt`, together with absolute trusted-CLI root, expected CLI
commit/tree, exact combined-candidate commit/tree, expected deployment
root/commit/tree/artifact digest and create-only `--out`. It uses the readers
above, revalidates both clean tracked roots, proves the deployment commit descends
from the combined candidate, hashes `scripts/runWhereLatencyCanary.ts`, verifies
every cross-artifact identity, then writes/reopens:

```ts
type WhereLatencyEvidenceBindingV1 = {
  schema: "where-latency-evidence-binding-v1";
  version: 1;
  kind: "where" | "deep";
  trustedCli: {
    rootRealPath: string;
    gitCommit: string;
    gitTree: string;
    runnerFileSha256: string;
  };
  combinedCandidate: { gitCommit: string; gitTree: string };
  deployment: {
    rootRealPath: string;
    gitCommit: string;
    gitTree: string;
    immutableArtifactDigest: string;
  };
  artifacts: Array<{
    kind: "isolation" | "run" | "deep";
    realPath: string;
    schema: string;
    selfSha256: string;
    fileSha256: string;
  }>;
  sha256: string;
};
```

The manifest writer is exclusive, validates its own complete shape/self-hash on
readback, and prints only the reopened document. Tests reject a dirty/wrong CLI
identity, mismatched isolation/run hashes, wrong deployment/digest, wrong
combined identity, non-canonical receipt, existing output and mutated manifest.

- [ ] **Step 2: Prove RED**

```powershell
$redCases = @(
  @{ File = 'tests/scripts/captureWhereLatencyReplay.test.ts'; Title = 'accepts PostgreSQL Date rows without capture mutations' },
  @{ File = 'tests/scripts/captureWhereLatencyReplay.test.ts'; Title = 'rejects configured credentials before capture serialization' },
  @{ File = 'tests/scripts/captureWhereLatencyReplay.test.ts'; Title = 'disposes the capture execution after success and failure' },
  @{ File = 'tests/forensics/whereLatencyReplay.test.ts'; Title = 'projects replay assertions and provider URLs safely' },
  @{ File = 'tests/scripts/runWhereLatencyCanary.test.ts'; Title = 'writes a canonical create-only canary run receipt through --out' }
)
foreach ($redCase in $redCases) {
  $redOutput = & npm.cmd test -- $redCase.File -t $redCase.Title 2>&1
  $redExit = $LASTEXITCODE
  $redText = $redOutput -join "`n"
  if ($redExit -eq 0) { throw "stage_b_capture_red_not_observed:$($redCase.Title)" }
  if ($redExit -ne 1) { $redOutput; throw "stage_b_capture_red_runner_failed:$($redCase.Title)" }
  if ($redText -notmatch [regex]::Escape($redCase.Title)) { $redOutput; throw "stage_b_capture_red_title_missing:$($redCase.Title)" }
  if ($redText -match 'Failed Suites|SyntaxError|Transform failed|Cannot find module|No test files found') { $redOutput; throw "stage_b_capture_red_setup_failure:$($redCase.Title)" }
  if ($redText -notmatch 'AssertionError|expected') { $redOutput; throw "stage_b_capture_red_not_assertion_failure:$($redCase.Title)" }
  $redOutput
}
```

Expected: failures reproduce the `Date` boundary, mutation exposure, unsafe
assertion/config projection, configured-secret echo, missing disposal and hidden
canary run output.

- [ ] **Step 3: Implement the minimum read-only fix**

In the capture script:

1. replace `requiredString(...)` around the three database timestamps with one
   strict `Date | string` decoder that clones/normalizes to a valid `Date`;
2. require `--expected-config-sha256`, hash canonical
   `projectWhereReplayConfig(config)` with Node's existing SHA-256 support, and
   fail before opening the DB when it differs;
3. delete imports and wiring for all five DB mutation callbacks listed above;
4. keep read-only indexed-history, metadata, profile, label and assertion reads;
5. keep progress only in the execution's in-memory job object;
6. project assertion rows through one exported helper in
   `whereLatencyReplay.ts` before passing them to `buildWhereLatencyReplayV1`;
7. make endpoint projection reject URL credentials, search and fragment instead
   of preserving `.href` blindly;
8. before serialization/create-only write, recursively compare every artifact
   string leaf against every non-empty current configured credential listed
   above and fail with a stable non-revealing error on any substring match;
9. implement the structured `validate --fixture <path>` branch described above;
10. wrap `execution.run(checkerDeps)` in `try/finally` and await
   `execution.dispose()` in the `finally` branch;
11. retain create-only output and all existing source/tree/stable-fact checks.

In the canary CLI, replace the hidden random `outputs/...` run path with required
`--out`, retain exclusive creation, add the run/Deep document readers and
evidence-binding `attest` branch above, and reopen every written document before
emitting canonical stdout. Do not change canary scheduling, gates or runtime
behavior.

Do not weaken `lost_forensic_job_claim` in production. The fix is isolation of
the offline recorder from mutation authority.

- [ ] **Step 4: Prove GREEN and commit only tooling**

```powershell
npm.cmd test -- tests/scripts/captureWhereLatencyReplay.test.ts tests/forensics/whereLatencyReplay.test.ts tests/forensics/whereDependencyGraph.test.ts
if ($LASTEXITCODE -ne 0) { throw 'stage_b_harness_tests_failed' }
npm.cmd test -- tests/scripts/runWhereLatencyCanary.test.ts
if ($LASTEXITCODE -ne 0) { throw 'stage_b_canary_cli_tests_failed' }
npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw 'stage_b_harness_typecheck_failed' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'stage_b_harness_diff_check_failed' }
git diff --name-only 5bb7297bc5b274209475148f5c2c6556ef305b34
if ($LASTEXITCODE -ne 0) { throw 'stage_b_harness_name_diff_failed' }
git status --short
if ($LASTEXITCODE -ne 0) { throw 'stage_b_harness_status_failed' }
```

Before committing, inspect the name-only diff: no
`LEGACY_WHERE_BEHAVIOR_SOURCE_FILES` entry may appear.

```powershell
git add scripts/captureWhereLatencyReplay.ts scripts/runWhereLatencyCanary.ts src/forensics/whereLatencyReplay.ts tests/scripts/captureWhereLatencyReplay.test.ts tests/scripts/runWhereLatencyCanary.test.ts tests/forensics/whereLatencyReplay.test.ts
if ($LASTEXITCODE -ne 0) { throw 'stage_b_harness_stage_failed' }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'stage_b_harness_cached_diff_failed' }
git commit -m "fix(forensics): harden Stage B evidence tooling"
if ($LASTEXITCODE -ne 0) { throw 'stage_b_harness_commit_failed' }
git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'stage_b_harness_commit_identity_failed' }
git rev-parse 'HEAD^{tree}'
if ($LASTEXITCODE -ne 0) { throw 'stage_b_harness_tree_identity_failed' }
git diff --name-only 5bb7297bc5b274209475148f5c2c6556ef305b34..HEAD
if ($LASTEXITCODE -ne 0) { throw 'stage_b_harness_committed_diff_failed' }
$postCommitStatus = @(git status --short)
if ($LASTEXITCODE -ne 0) { throw 'stage_b_harness_postcommit_status_failed' }
if ($postCommitStatus.Count -ne 0) { $postCommitStatus; throw 'stage_b_harness_postcommit_dirty' }
```

Expected: clean harness-fix commit; record its SHA as the recorder identity.

## Task 2: Capture and prove the real TXc replay

- [ ] **Step 1: Establish real DB and provider prerequisites**

Use a disposable non-production capture database containing a completed,
genuine legacy `where_is_money_check` for:

```text
TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd
```

It must contain the saved report and exact window/options produced with real
provider/DB dependencies compatible with the approved capture config. Synthetic,
Unified, copied or manually edited reports are not accepted.

The capture loads full runtime/provider config, not only `DATABASE_URL`. Obtain
the approved SHA-256 of canonical `projectWhereReplayConfig(loadConfig())` and
required provider secrets without printing them. The projection binds configured
key counts/groups, endpoints, timeouts and cross-chain enablement. It does not
pre-approve the report's separately captured `resolvedOptions`; inspect those
after capture and let the fixture's `resolvedConfigHash` bind config projection
plus resolved options. If the approved config-input projection differs, or the
provider config is incompatible, stop rather than accepting provider failure or
`where_latency_replay_stable_fact_mismatch` as a usable tape.

- [ ] **Step 2: Capture from a clean checkout of the exact harness SHA**

Run the validation and capture in one shell block so environment does not rely
on persistence between tool calls:

```powershell
if ([string]::IsNullOrWhiteSpace($captureDatabaseUrl)) { throw 'stage_b_capture_database_url_missing' }
if ($approvedReplayConfigSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'stage_b_capture_config_identity_missing' }
if ($harnessFixSha -notmatch '^[0-9a-fA-F]{40}$') { throw 'stage_b_capture_harness_identity_missing' }
$captureHead = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'stage_b_capture_head_read_failed' }
if ($captureHead -ne $harnessFixSha) { throw 'stage_b_capture_harness_identity_mismatch' }
$captureStatus = @(git status --short)
if ($LASTEXITCODE -ne 0) { throw 'stage_b_capture_status_failed' }
if ($captureStatus.Count -ne 0) { $captureStatus; throw 'stage_b_capture_checkout_dirty' }
$env:DATABASE_URL = $captureDatabaseUrl

npm.cmd run forensic:where-latency:capture -- `
  --source TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd `
  --expected-config-sha256 $approvedReplayConfigSha256 `
  --out tests/fixtures/forensics/txc-legacy-where-latency-v1.json
if ($LASTEXITCODE -ne 0) { throw 'stage_b_real_capture_failed' }
```

Expected: checkout HEAD equals the recorded harness-fix SHA and is clean before
the command. `where_latency_replay_completed_legacy_job_missing` is an external
prerequisite failure; do not insert a synthetic job.

- [ ] **Step 3: Inspect and commit the create-only artifact**

```powershell
$fixturePath = 'tests/fixtures/forensics/txc-legacy-where-latency-v1.json'
if ($approvedReplayConfigSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'stage_b_fixture_config_identity_missing' }
$validation = & npm.cmd --silent run forensic:where-latency:capture -- validate --fixture $fixturePath
if ($LASTEXITCODE -ne 0) { throw 'stage_b_fixture_validation_failed' }
$validationDocument = $validation | ConvertFrom-Json
$fixtureFileSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $fixturePath).Hash.ToLowerInvariant()
if ($validationDocument.schema -ne 'where-latency-replay-validation-v1' -or $validationDocument.version -ne 1 -or $validationDocument.fixtureSchema -ne 'where-latency-replay-v1' -or $validationDocument.fixtureVersion -ne 1) { throw 'stage_b_fixture_validation_identity_invalid' }
if ($validationDocument.fixtureFileSha256 -ne $fixtureFileSha256) { throw 'stage_b_fixture_validator_file_hash_mismatch' }
if ($validationDocument.configProjectionSha256 -ne $approvedReplayConfigSha256.ToLowerInvariant()) { throw 'stage_b_fixture_validator_config_hash_mismatch' }
if ($validationDocument.resolvedConfigHash -notmatch '^[0-9a-f]{64}$') { throw 'stage_b_fixture_resolved_config_hash_invalid' }
Get-Item -LiteralPath $fixturePath | Select-Object FullName,Length
$changes = @(git status --short)
if ($LASTEXITCODE -ne 0) { throw 'stage_b_fixture_status_failed' }
if (($changes -join "`n") -ne "?? $fixturePath") { $changes; throw 'stage_b_fixture_not_only_change' }
git add -- $fixturePath
if ($LASTEXITCODE -ne 0) { throw 'stage_b_fixture_stage_failed' }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'stage_b_fixture_cached_diff_failed' }
git commit -m "test(forensics): freeze real TXc latency replay"
if ($LASTEXITCODE -ne 0) { throw 'stage_b_fixture_commit_failed' }
git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'stage_b_fixture_commit_identity_failed' }
git rev-parse HEAD:tests/fixtures/forensics/txc-legacy-where-latency-v1.json
if ($LASTEXITCODE -ne 0) { throw 'stage_b_fixture_blob_identity_failed' }
```

Expected: structured validation passes; the recorder's pre-write configured-secret
check already rejected any exact secret value without printing it; safe descriptor
names such as `tronscanApiKeyConfigured` remain legal; and the fixture was the
only pre-commit change. Record validator output, raw `$fixtureFileSha256`, commit
and blob. Its config-input projection hash matches the approved SHA-256 used for
capture; inspect the separately bound `resolvedOptions` in the fixture.

- [ ] **Step 4: Run release replay from a second clean checkout**

```powershell
$required = @($fixtureCommit,$fixtureBlob,$fixtureFileSha256)
if (@($required | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) { throw 'stage_b_release_replay_identity_missing' }
if ($fixtureCommit -notmatch '^[0-9a-fA-F]{40}$' -or $fixtureBlob -notmatch '^[0-9a-fA-F]{40}$' -or $fixtureFileSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'stage_b_release_replay_identity_invalid' }
$fixturePath = 'tests/fixtures/forensics/txc-legacy-where-latency-v1.json'
$replayHead = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $replayHead -ne $fixtureCommit) { throw 'stage_b_release_replay_commit_mismatch' }
$replayStatus = @(git status --short)
if ($LASTEXITCODE -ne 0) { throw 'stage_b_release_replay_status_failed' }
if ($replayStatus.Count -ne 0) { $replayStatus; throw 'stage_b_release_replay_checkout_dirty' }
$actualFixtureBlob = (git rev-parse "HEAD:$fixturePath").Trim()
if ($LASTEXITCODE -ne 0 -or $actualFixtureBlob -ne $fixtureBlob) { throw 'stage_b_release_replay_blob_mismatch' }
$actualFixtureFileSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $fixturePath).Hash.ToLowerInvariant()
if ($actualFixtureFileSha256 -ne $fixtureFileSha256.ToLowerInvariant()) { throw 'stage_b_release_replay_file_hash_mismatch' }
$validation = & npm.cmd --silent run forensic:where-latency:capture -- validate --fixture $fixturePath
if ($LASTEXITCODE -ne 0) { throw 'stage_b_release_replay_fixture_validation_failed' }
$validationDocument = $validation | ConvertFrom-Json
if ($validationDocument.fixtureFileSha256 -ne $actualFixtureFileSha256) { throw 'stage_b_release_replay_validator_hash_mismatch' }
npm.cmd run forensic:where-latency:replay -- `
  --fixture $fixturePath
if ($LASTEXITCODE -ne 0) { throw 'stage_b_release_replay_failed' }
```

Acceptance:

- the second checkout is clean at the exact fixture commit, and fixture path,
  Git blob, validator hash and raw-content SHA-256 are rebound immediately before
  replay;
- recorder commit equals the harness-fix SHA and the recorder tree was clean;
- tape completeness is `complete`;
- `stableFactsEqual` and every stable-field comparison are true;
- ordinary official-USDT hashes make zero full transaction-info calls;
- first-run full and total provider calls are below baseline;
- each full identity dispatches at most once;
- second run makes zero provider calls and reuses identical evidence IDs/facts.

Preserve canonical CLI output externally; do not add generated `outputs/` receipts.

## Task 3: Run the real PostgreSQL claim/fairness gate

- [ ] **Step 1: Prove schema 037 and idempotent migration**

Every command block is self-contained because shell invocations do not retain
environment variables:

```powershell
$env:PLAN3_TEST_DATABASE_URL = 'postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan3'
$env:TEST_DATABASE_URL = $env:PLAN3_TEST_DATABASE_URL
$env:DATABASE_URL = $env:PLAN3_TEST_DATABASE_URL
$env:REQUIRE_PLAN3_POSTGRES = '1'
npm.cmd run db:migrate
if ($LASTEXITCODE -ne 0) { throw 'stage_b_first_migration_failed' }
npm.cmd run db:migrate
if ($LASTEXITCODE -ne 0) { throw 'stage_b_idempotent_migration_failed' }
npm.cmd run schema:verify
if ($LASTEXITCODE -ne 0) { throw 'stage_b_schema_verify_failed' }
npm.cmd test -- tests/storage/migration034.postgres.test.ts tests/storage/migration035.postgres.test.ts tests/storage/migration036.postgres.test.ts tests/storage/migration037.postgres.test.ts
if ($LASTEXITCODE -ne 0) { throw 'stage_b_migration_tests_failed' }
```

Expected: schema 037 verifies, the second migration is idempotent, and no named
migration test skips.

- [ ] **Step 2: Prove Stage B repository behavior on PostgreSQL**

```powershell
$env:PLAN3_TEST_DATABASE_URL = 'postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan3'
$env:TEST_DATABASE_URL = $env:PLAN3_TEST_DATABASE_URL
$env:DATABASE_URL = $env:PLAN3_TEST_DATABASE_URL
$env:REQUIRE_PLAN3_POSTGRES = '1'
npm.cmd test -- tests/storage/forensicCheckJobs.test.ts tests/storage/runtimeDelivery.postgres.test.ts tests/storage/transactionEvidenceRepository.test.ts tests/storage/addressLabelAssertions.test.ts
if ($LASTEXITCODE -ne 0) { throw 'stage_b_postgres_behavior_tests_failed' }
```

Acceptance includes actual execution, not a green skip, of claim-generation
fencing, stale-worker rejection, same-millisecond claim separation, priority/FIFO
fairness, no cross-lane leakage, immutable evidence conflict/reuse and null-chat
delivery ownership without duplicate settlement.

## Task 4: Build and verify the combined candidate

- [ ] **Step 1: Integrate the two Stage B evidence commits explicitly**

In the clean correctness branch after its gate commits, bind the two SHAs from
the recorded Task 1/2 outputs, then cherry-pick the harness fix and fixture
commits (or merge their reviewed branch if repository policy requires it).
Resolve only genuine overlap; never regenerate the fixture against the
correctness behavior tree.

```powershell
if ($harnessFixSha -notmatch '^[0-9a-fA-F]{40}$') { throw 'stage_b_harness_fix_sha_missing' }
if ($fixtureCommit -notmatch '^[0-9a-fA-F]{40}$' -or $fixtureBlob -notmatch '^[0-9a-fA-F]{40}$' -or $fixtureFileSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'stage_b_fixture_identity_missing' }
git cherry-pick -x $harnessFixSha
if ($LASTEXITCODE -ne 0) { throw 'stage_b_harness_cherry_pick_failed' }
$integratedHarnessSha = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'stage_b_integrated_harness_identity_failed' }
git cherry-pick -x $fixtureCommit
if ($LASTEXITCODE -ne 0) { throw 'stage_b_fixture_cherry_pick_failed' }
$combinedCandidateCommit = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'stage_b_combined_commit_identity_failed' }
$combinedCandidateTree = (git rev-parse 'HEAD^{tree}').Trim()
if ($LASTEXITCODE -ne 0) { throw 'stage_b_combined_tree_identity_failed' }
git diff --exit-code $harnessFixSha HEAD -- scripts/captureWhereLatencyReplay.ts scripts/runWhereLatencyCanary.ts src/forensics/whereLatencyReplay.ts tests/scripts/captureWhereLatencyReplay.test.ts tests/scripts/runWhereLatencyCanary.test.ts tests/forensics/whereLatencyReplay.test.ts
if ($LASTEXITCODE -ne 0) { throw 'stage_b_harness_content_mapping_failed' }
git diff --exit-code $fixtureCommit HEAD -- tests/fixtures/forensics/txc-legacy-where-latency-v1.json
if ($LASTEXITCODE -ne 0) { throw 'stage_b_fixture_content_mapping_failed' }
$integratedFixtureBlob = (git rev-parse 'HEAD:tests/fixtures/forensics/txc-legacy-where-latency-v1.json').Trim()
if ($LASTEXITCODE -ne 0 -or $integratedFixtureBlob -ne $fixtureBlob) { throw 'stage_b_integrated_fixture_blob_mismatch' }
$integratedFixtureFileSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath 'tests/fixtures/forensics/txc-legacy-where-latency-v1.json').Hash.ToLowerInvariant()
if ($integratedFixtureFileSha256 -ne $fixtureFileSha256.ToLowerInvariant()) { throw 'stage_b_integrated_fixture_file_hash_mismatch' }
$combinedStatus = @(git status --short)
if ($LASTEXITCODE -ne 0) { throw 'stage_b_combined_status_failed' }
if ($combinedStatus.Count -ne 0) { $combinedStatus; throw 'stage_b_combined_candidate_dirty' }
```

Expected: clean combined candidate with exact harness, fixture and correctness
provenance recorded. Because cherry-pick creates new commit identities, record
the source→integrated commit mapping and prove exact file/blob content as above;
do not claim the source SHAs are ancestors. Strict v1 replay remains historical
fixture evidence; the correctness suite proves intentional later semantic changes.

- [ ] **Step 2: Run the complete targeted Stage B suite with PostgreSQL bound**

```powershell
$env:PLAN3_TEST_DATABASE_URL = 'postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan3'
$env:TEST_DATABASE_URL = $env:PLAN3_TEST_DATABASE_URL
$env:DATABASE_URL = $env:PLAN3_TEST_DATABASE_URL
$env:REQUIRE_PLAN3_POSTGRES = '1'
npm.cmd test -- tests/scripts/captureWhereLatencyReplay.test.ts tests/tron/rawTransactionPreflight.test.ts tests/tron/tronClient.test.ts tests/tron/tronscanScheduler.test.ts tests/storage/transactionEvidenceRepository.test.ts tests/storage/addressLabelAssertions.test.ts tests/storage/forensicCheckJobs.test.ts tests/storage/repositories.test.ts tests/storage/runtimeDelivery.postgres.test.ts tests/forensics/selectiveTransactionEnrichment.test.ts tests/forensics/forensicSlotPump.test.ts tests/forensics/whereLatencyReplay.test.ts tests/forensics/whereDependencyGraph.test.ts tests/forensics/localTronUsdtIndex.test.ts tests/forensics/routeSearch.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/targetedHistoryCoordinator.test.ts tests/forensics/whereIsMoneyCliArgs.test.ts tests/scripts/forensicWalletCalibrationRerun.test.ts tests/config/config.test.ts tests/scripts/runWhereLatencyCanary.test.ts
if ($LASTEXITCODE -ne 0) { throw 'stage_b_combined_targeted_tests_failed' }
```

Do not reuse the historical statement `20 files / 996 tests passed` as
PostgreSQL proof: that prior target contained 21 files and reported 20 passed +
1 skipped, 996 passed + 80 skipped. Here the named PostgreSQL tests must execute.

- [ ] **Step 3: Run typecheck, full regression and exact shortcut checks**

```powershell
npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw 'stage_b_combined_typecheck_failed' }
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'stage_b_combined_full_suite_failed' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'stage_b_combined_diff_check_failed' }

$forbidden = rg -n 'DEFAULT_CONTRACT_TRANSACTION_INFO_MIN_INTERVAL_MS|transactionInfoQueue|if \(waitMs > 0\) await sleep\(waitMs\)|runForensicJobsOnce\(\[[^]]*where_is_money_check[^]]*\]' src/check/whereIsMoneyCheck.ts src/forensics/deepForensicJob.ts src/index.ts
$rgExit = $LASTEXITCODE
if ($rgExit -eq 0) { $forbidden; throw 'stage_b_shortcut_reintroduced' }
if ($rgExit -ne 1) { throw 'stage_b_shortcut_audit_failed' }
$forbidden = rg -U -n 'Promise\.all\(\s*candidates\.map' src/forensics/selectiveTransactionEnrichment.ts
$rgExit = $LASTEXITCODE
if ($rgExit -eq 0) { $forbidden; throw 'stage_b_shortcut_reintroduced' }
if ($rgExit -ne 1) { throw 'stage_b_shortcut_audit_failed' }

$pumpConstruction = rg -n '^\s*const whereForensicPump = createForensicSlotPump' src/index.ts
if ($LASTEXITCODE -ne 0) { throw 'stage_b_slot_pump_construction_missing' }
$pumpConstruction
$whereConcurrencyBinding = rg -n 'concurrency: config\.forensicWhereWorkerConcurrency' src/index.ts
if ($LASTEXITCODE -ne 0) { throw 'stage_b_where_concurrency_binding_missing' }
$whereConcurrencyBinding
$deepSingleton = rg -n 'runForensicJobsOnce\(\[[^]]*address_deep_check[^]]*\], 1\)' src/index.ts
if ($LASTEXITCODE -ne 0) { throw 'stage_b_deep_singleton_wiring_missing' }
$deepSingleton
$whereDefault = rg -n 'FORENSIC_WHERE_WORKER_CONCURRENCY=1' .env.example
if ($LASTEXITCODE -ne 0) { throw 'stage_b_where_default_missing' }
$whereDefault
```

The allowlisted `TRACE_PROGRESS_MIN_INTERVAL_MS=15_000`, artifact limits and
unrelated `Promise.all` calls are not failures. Acceptance is binary: no local
15-second transaction-info sleep, no unbounded transaction-candidate fan-out,
no old serial Where batch, real slot-pump wiring, Where default `1`, Deep
singleton and unchanged scheduler/provider capacity.

## Task 5: Resolve the deployment-integration prerequisite

- [ ] **Step 1: Reconfirm the repository gap**

```powershell
$cycleContract = rg -n 'WHERE_LATENCY_CANARY_ENABLED_CYCLES' scripts/runWhereLatencyCanary.ts src/index.ts src/config.ts
if ($LASTEXITCODE -gt 1) { throw 'stage_b_cycle_contract_audit_failed' }
$cycleContract
$bridgeContract = rg -n 'where-latency-canary-bridge-v1|createWhereLatencyCanaryRuntime' scripts src
if ($LASTEXITCODE -gt 1) { throw 'stage_b_bridge_contract_audit_failed' }
$bridgeContract
$deploymentFiles = rg --files scripts src | rg 'canary.*(adapter|bridge|deployment)|whereLatency.*(adapter|bridge|deployment)'
$deploymentFileExit = $LASTEXITCODE
if ($deploymentFileExit -gt 1) { throw 'stage_b_deployment_file_audit_failed' }
if ($deploymentFileExit -eq 0) { $deploymentFiles } else { Write-Output 'no deployment-owned adapter/bridge files found' }
```

Expected today: client contracts exist; deployment-owned bridge, tracked adapter,
cycle composition and receipt builder do not.

- [ ] **Step 2: Apply the hard branch**

The current loader requires the adapter inside `deploymentRoot`, as the sole
tracked module-graph file, with a completely clean checkout at the receipt's
commit/tree. Therefore an untracked external bundle beside the combined
candidate is invalid.

Proceed only after a separately reviewed integration commit or redesigned
identity contract supplies all of:

- clean immutable deployment root at its own reviewed integration commit/tree,
  descended from the exact Task 4 combined-candidate commit/tree (or carrying an
  equally strict reviewed content-mapping receipt if ancestry is impossible);
- tracked one-file ESM adapter bound to real Where pump, scheduler, forensic and
  delivery repositories, address-index worker and Deep worker;
- attested loopback bridge implementing `where-latency-canary-bridge-v1`;
- real cycle-isolated runtime composition, not only a CLI environment value;
- canonical deployment receipt plus raw-file SHA-256 and artifact digest, all
  binding that same combined-candidate commit/tree; bridge runtime attestation
  must echo the identical code/artifact identity before canary work starts;
- key custody and separate trusted CLI host;
- dedicated schema-037 clone; canary `prepare` must attest that the measured
  lanes have no runnable/running jobs or foreign ownership at the start (past
  historical rows alone do not invalidate an otherwise isolated clone);
- exact non-secret runtime-config and enabled-cycle identity.

If any item is absent:

1. retain repository and deployed Where at `1` (or restore deployed value to `1`
   through separately authorized operations if observation finds otherwise);
2. record `runtime core verified; deployment integration blocked`;
3. keep canary/rollout open problems open;
4. hand the proposed deployment-design filename to the user for a separate
   brainstorming/review task;
5. skip Tasks 6-8 and continue to Task 9 documentation.

Do not create and self-approve the security-sensitive integration in this plan.

- [ ] **Step 3: If integration exists, prove its clone and identity**

Run clone verification in the same bound shell invocation:

```powershell
$required = @($canaryDatabaseUrl,$approvedDeploymentRoot,$expectedDeploymentCommit,$expectedDeploymentTree,$expectedCombinedCandidateCommit,$expectedCombinedCandidateTree)
if (@($required | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) { throw 'stage_b_deployment_identity_input_missing' }
function Test-AbsoluteWindowsPath([string]$path) {
  return $path -match '^[A-Za-z]:[\\/]' -or $path -match '^[\\/]{2}[^\\/]+[\\/][^\\/]+'
}
if (-not (Test-AbsoluteWindowsPath $approvedDeploymentRoot)) { throw 'stage_b_deployment_root_not_absolute' }
$deploymentRoot = (Resolve-Path -LiteralPath $approvedDeploymentRoot -ErrorAction Stop).Path
$canonicalApprovedRoot = [IO.Path]::GetFullPath($approvedDeploymentRoot)
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($deploymentRoot,$canonicalApprovedRoot)) { throw 'stage_b_deployment_root_identity_mismatch' }
$actualDeploymentCommit = (git -C $deploymentRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'stage_b_deployment_commit_read_failed' }
$actualDeploymentTree = (git -C $deploymentRoot rev-parse 'HEAD^{tree}').Trim()
if ($LASTEXITCODE -ne 0) { throw 'stage_b_deployment_tree_read_failed' }
if ($actualDeploymentCommit -ne $expectedDeploymentCommit -or $actualDeploymentTree -ne $expectedDeploymentTree) { throw 'stage_b_deployment_identity_mismatch' }
$actualCombinedTree = (git -C $deploymentRoot rev-parse "${expectedCombinedCandidateCommit}^{tree}").Trim()
if ($LASTEXITCODE -ne 0 -or $actualCombinedTree -ne $expectedCombinedCandidateTree) { throw 'stage_b_combined_candidate_identity_mismatch' }
git -C $deploymentRoot merge-base --is-ancestor $expectedCombinedCandidateCommit $actualDeploymentCommit
if ($LASTEXITCODE -ne 0) { throw 'stage_b_deployment_not_descended_from_combined_candidate' }
$deploymentStatus = @(git -C $deploymentRoot status --short)
if ($LASTEXITCODE -ne 0) { throw 'stage_b_deployment_status_failed' }
if ($deploymentStatus.Count -ne 0) { $deploymentStatus; throw 'stage_b_deployment_root_dirty' }
$env:DATABASE_URL = $canaryDatabaseUrl
npm.cmd --prefix $deploymentRoot run schema:verify
if ($LASTEXITCODE -ne 0) { throw 'stage_b_canary_schema_verify_failed' }
```

Expected: schema 037 and an empty deployment-root status at the reviewed
integration identity descended from the exact combined candidate. Record the
canonical resolved root and both identities. If a reviewed content-mapping
contract replaces ancestry, execute its dedicated verifier here instead of
silently skipping `merge-base`.

## Task 6: Run the isolated Where-concurrency-two canary conditionally

This task is conditional on Task 5 passing and explicit canary authorization.

- [ ] **Step 1: Validate, bind and run in one shell block**

The operator pre-binds approved variables without printing secrets. The block
must validate every value and set all environment variables before the command;
do not assume a previous shell kept them. Revalidate the trusted CLI Git identity
immediately before `prepare`/`run`; an earlier Task 0 observation is not enough.

```powershell
$required = @($canaryDatabaseUrl,$runtimeInstanceLabel,$adapterPath,$runtimeConfigSha256,$bridgeUrl,$clientKeyPath,$deploymentReceiptPath,$deploymentReceiptFileSha256,$immutableArtifactDigest,$evidenceRoot,$approvedTrustedCliRoot,$expectedTrustedCliCommit,$expectedTrustedCliTree,$approvedDeploymentRoot,$expectedDeploymentCommit,$expectedDeploymentTree,$expectedCombinedCandidateCommit,$expectedCombinedCandidateTree)
if (@($required | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) { throw 'stage_b_canary_input_missing' }
function Test-AbsoluteWindowsPath([string]$path) {
  return $path -match '^[A-Za-z]:[\\/]' -or $path -match '^[\\/]{2}[^\\/]+[\\/][^\\/]+'
}
function Get-NativeRealPath([string]$path,[string]$failureCode) {
  $output = & node -e "process.stdout.write(require('node:fs').realpathSync.native(process.argv[1]))" -- $path 2>&1
  if ($LASTEXITCODE -ne 0) { $output; throw $failureCode }
  $realPath = ($output -join "`n").Trim()
  if ([string]::IsNullOrWhiteSpace($realPath)) { throw $failureCode }
  return [IO.Path]::GetFullPath($realPath)
}
if (-not (Test-AbsoluteWindowsPath $approvedTrustedCliRoot)) { throw 'stage_b_trusted_cli_root_not_absolute' }
if (-not (Test-AbsoluteWindowsPath $approvedDeploymentRoot)) { throw 'stage_b_canary_deployment_root_not_absolute' }
if (-not (Test-AbsoluteWindowsPath $evidenceRoot)) { throw 'stage_b_evidence_root_not_absolute' }
$trustedCliRoot = (Resolve-Path -LiteralPath $approvedTrustedCliRoot -ErrorAction Stop).Path
$canonicalTrustedCliRoot = [IO.Path]::GetFullPath($approvedTrustedCliRoot)
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($trustedCliRoot,$canonicalTrustedCliRoot)) { throw 'stage_b_trusted_cli_root_identity_mismatch' }
$trustedCliRealPath = Get-NativeRealPath $trustedCliRoot 'stage_b_trusted_cli_realpath_failed'
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($trustedCliRoot,$trustedCliRealPath)) { throw 'stage_b_trusted_cli_reparse_alias_rejected' }
$trustedCliRoot = $trustedCliRealPath
$deploymentRoot = (Resolve-Path -LiteralPath $approvedDeploymentRoot -ErrorAction Stop).Path
$canonicalDeploymentRoot = [IO.Path]::GetFullPath($approvedDeploymentRoot)
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($deploymentRoot,$canonicalDeploymentRoot)) { throw 'stage_b_canary_deployment_root_identity_mismatch' }
$deploymentRealPath = Get-NativeRealPath $deploymentRoot 'stage_b_canary_deployment_realpath_failed'
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($deploymentRoot,$deploymentRealPath)) { throw 'stage_b_canary_deployment_reparse_alias_rejected' }
$deploymentRoot = $deploymentRealPath
$canonicalEvidenceRoot = [IO.Path]::GetFullPath($evidenceRoot)
[IO.Directory]::CreateDirectory($canonicalEvidenceRoot) | Out-Null
$evidenceRoot = (Resolve-Path -LiteralPath $evidenceRoot -ErrorAction Stop).Path
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($evidenceRoot,$canonicalEvidenceRoot)) { throw 'stage_b_evidence_root_identity_mismatch' }
$evidenceRealPath = Get-NativeRealPath $evidenceRoot 'stage_b_evidence_root_realpath_failed'
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($evidenceRoot,$evidenceRealPath)) { throw 'stage_b_evidence_root_reparse_alias_rejected' }
$evidenceRoot = $evidenceRealPath
function Test-PathWithin([string]$child,[string]$parent) {
  $childCanonical = [IO.Path]::GetFullPath($child).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
  $parentCanonical = [IO.Path]::GetFullPath($parent).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
  if ([StringComparer]::OrdinalIgnoreCase.Equals($childCanonical,$parentCanonical)) { return $true }
  $prefix = $parentCanonical + [IO.Path]::DirectorySeparatorChar
  return $childCanonical.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)
}
if ((Test-PathWithin $evidenceRoot $trustedCliRoot) -or (Test-PathWithin $trustedCliRoot $evidenceRoot) -or (Test-PathWithin $evidenceRoot $deploymentRoot) -or (Test-PathWithin $deploymentRoot $evidenceRoot)) { throw 'stage_b_evidence_root_not_isolated' }
if ((Test-PathWithin $trustedCliRoot $deploymentRoot) -or (Test-PathWithin $deploymentRoot $trustedCliRoot)) { throw 'stage_b_trust_domains_not_isolated' }
$actualTrustedCliCommit = (git -C $trustedCliRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'stage_b_trusted_cli_commit_read_failed' }
$actualTrustedCliTree = (git -C $trustedCliRoot rev-parse 'HEAD^{tree}').Trim()
if ($LASTEXITCODE -ne 0) { throw 'stage_b_trusted_cli_tree_read_failed' }
if ($actualTrustedCliCommit -ne $expectedTrustedCliCommit -or $actualTrustedCliTree -ne $expectedTrustedCliTree) { throw 'stage_b_trusted_cli_identity_mismatch' }
$trustedCliStatus = @(git -C $trustedCliRoot status --short)
if ($LASTEXITCODE -ne 0) { throw 'stage_b_trusted_cli_status_failed' }
if ($trustedCliStatus.Count -ne 0) { $trustedCliStatus; throw 'stage_b_trusted_cli_root_dirty' }
$actualDeploymentCommit = (git -C $deploymentRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'stage_b_canary_deployment_commit_read_failed' }
$actualDeploymentTree = (git -C $deploymentRoot rev-parse 'HEAD^{tree}').Trim()
if ($LASTEXITCODE -ne 0) { throw 'stage_b_canary_deployment_tree_read_failed' }
if ($actualDeploymentCommit -ne $expectedDeploymentCommit -or $actualDeploymentTree -ne $expectedDeploymentTree) { throw 'stage_b_canary_deployment_identity_mismatch' }
$actualCombinedTree = (git -C $deploymentRoot rev-parse "${expectedCombinedCandidateCommit}^{tree}").Trim()
if ($LASTEXITCODE -ne 0 -or $actualCombinedTree -ne $expectedCombinedCandidateTree) { throw 'stage_b_canary_combined_identity_mismatch' }
git -C $deploymentRoot merge-base --is-ancestor $expectedCombinedCandidateCommit $actualDeploymentCommit
if ($LASTEXITCODE -ne 0) { throw 'stage_b_canary_deployment_not_descended_from_combined_candidate' }
$deploymentStatus = @(git -C $deploymentRoot status --short)
if ($LASTEXITCODE -ne 0) { throw 'stage_b_canary_deployment_status_failed' }
if ($deploymentStatus.Count -ne 0) { $deploymentStatus; throw 'stage_b_canary_deployment_root_dirty' }
$env:DATABASE_URL = $canaryDatabaseUrl
$env:RUNTIME_INSTANCE_LABEL = $runtimeInstanceLabel
$env:WHERE_LATENCY_CANARY_DEDICATED = 'true'
$env:WHERE_LATENCY_CANARY_ENABLED_CYCLES = 'where,address_index,delivery_reconciliation'
$env:WHERE_LATENCY_CANARY_RUNTIME_ADAPTER = $adapterPath
$env:WHERE_LATENCY_CANARY_RUNTIME_CONFIG_SHA256 = $runtimeConfigSha256
$env:WHERE_LATENCY_CANARY_RUNTIME_BRIDGE_URL = $bridgeUrl
$env:WHERE_LATENCY_CANARY_RUNTIME_BRIDGE_TIMEOUT_MS = '10000'
$env:WHERE_LATENCY_CANARY_RUNTIME_BRIDGE_CLIENT_KEY_FILE = $clientKeyPath
$env:WHERE_LATENCY_CANARY_DEPLOYMENT_RECEIPT = $deploymentReceiptPath
$env:WHERE_LATENCY_CANARY_DEPLOYMENT_RECEIPT_SHA256 = $deploymentReceiptFileSha256
$env:WHERE_LATENCY_CANARY_IMMUTABLE_ARTIFACT_DIGEST = $immutableArtifactDigest
$env:WHERE_LATENCY_CANARY_TERMINAL_TIMEOUT_MS = '7200000'
$env:WHERE_LATENCY_CANARY_DRAIN_TIMEOUT_MS = '60000'
$env:FORENSIC_WHERE_POLL_INTERVAL_MS = '2000'
$env:FORENSIC_WHERE_WORKER_CONCURRENCY = '2'
npm.cmd --silent --prefix $trustedCliRoot run schema:verify
if ($LASTEXITCODE -ne 0) { throw 'stage_b_canary_schema_verify_failed' }
$canaryId = [guid]::NewGuid().ToString('N')
$isolationReceipt = Join-Path $evidenceRoot "where-isolation-$canaryId.json"
$whereRunReceipt = Join-Path $evidenceRoot "where-run-$canaryId.json"
$prepareStdout = & npm.cmd --silent --prefix $trustedCliRoot run forensic:where-latency:canary -- prepare --out $isolationReceipt
if ($LASTEXITCODE -ne 0) { throw 'stage_b_canary_prepare_failed' }
$prepareDocument = $prepareStdout | ConvertFrom-Json
if ($prepareDocument.schema -ne 'where-latency-canary-isolation-v1' -or $prepareDocument.version -ne 1) { throw 'stage_b_canary_prepare_identity_invalid' }
if ($prepareDocument.runtimeAttestation.runtimeConfigIdentity -ne $runtimeConfigSha256) { throw 'stage_b_canary_prepare_runtime_config_binding_mismatch' }
if ($prepareDocument.deploymentIdentity.gitCommit -ne $expectedDeploymentCommit -or $prepareDocument.deploymentIdentity.gitTree -ne $expectedDeploymentTree -or $prepareDocument.deploymentIdentity.immutableArtifactDigest -ne $immutableArtifactDigest) { throw 'stage_b_canary_deployment_binding_mismatch' }
if ($prepareDocument.runtimeAttestation.deploymentIdentity.gitCommit -ne $expectedDeploymentCommit -or $prepareDocument.runtimeAttestation.deploymentIdentity.gitTree -ne $expectedDeploymentTree -or $prepareDocument.runtimeAttestation.deploymentIdentity.immutableArtifactDigest -ne $immutableArtifactDigest) { throw 'stage_b_canary_runtime_attestation_binding_mismatch' }
$persistedIsolationDocument = Get-Content -Raw -Encoding UTF8 -LiteralPath $isolationReceipt | ConvertFrom-Json
if ($persistedIsolationDocument.sha256 -ne $prepareDocument.sha256) { throw 'stage_b_canary_isolation_self_hash_binding_mismatch' }
$isolationFileSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $isolationReceipt).Hash.ToLowerInvariant()
$runStdout = & npm.cmd --silent --prefix $trustedCliRoot run forensic:where-latency:canary -- run --confirm --isolation-receipt $isolationReceipt --out $whereRunReceipt
if ($LASTEXITCODE -ne 0) { throw 'stage_b_canary_run_failed' }
$runDocument = $runStdout | ConvertFrom-Json
if ($runDocument.schema -ne 'where-latency-canary-run-v1' -or $runDocument.version -ne 1 -or $runDocument.result -ne 'pass') { throw 'stage_b_canary_run_not_accepted' }
$persistedRunDocument = Get-Content -Raw -Encoding UTF8 -LiteralPath $whereRunReceipt | ConvertFrom-Json
if ($persistedRunDocument.sha256 -ne $runDocument.sha256) { throw 'stage_b_canary_run_self_hash_binding_mismatch' }
$whereRunFileSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $whereRunReceipt).Hash.ToLowerInvariant()
if ($runDocument.isolationReceiptSha256 -ne $prepareDocument.sha256 -or $runDocument.isolationReceiptFileSha256 -ne $isolationFileSha256) { throw 'stage_b_canary_run_isolation_binding_mismatch' }
if ($runDocument.runtimeAttestation.runtimeConfigIdentity -ne $runtimeConfigSha256) { throw 'stage_b_canary_run_runtime_config_binding_mismatch' }
if ($runDocument.deploymentIdentity.gitCommit -ne $expectedDeploymentCommit -or $runDocument.deploymentIdentity.gitTree -ne $expectedDeploymentTree -or $runDocument.deploymentIdentity.immutableArtifactDigest -ne $immutableArtifactDigest) { throw 'stage_b_canary_run_deployment_binding_mismatch' }
if ($runDocument.runtimeAttestation.deploymentIdentity.gitCommit -ne $expectedDeploymentCommit -or $runDocument.runtimeAttestation.deploymentIdentity.gitTree -ne $expectedDeploymentTree -or $runDocument.runtimeAttestation.deploymentIdentity.immutableArtifactDigest -ne $immutableArtifactDigest) { throw 'stage_b_canary_run_runtime_attestation_binding_mismatch' }
$whereBindingManifest = Join-Path $evidenceRoot "where-binding-$canaryId.json"
$bindingStdout = & npm.cmd --silent --prefix $trustedCliRoot run forensic:where-latency:canary -- attest --trusted-cli-root $trustedCliRoot --expected-cli-commit $expectedTrustedCliCommit --expected-cli-tree $expectedTrustedCliTree --deployment-root $deploymentRoot --expected-deployment-commit $expectedDeploymentCommit --expected-deployment-tree $expectedDeploymentTree --combined-commit $expectedCombinedCandidateCommit --combined-tree $expectedCombinedCandidateTree --immutable-artifact-digest $immutableArtifactDigest --isolation-receipt $isolationReceipt --run-receipt $whereRunReceipt --out $whereBindingManifest
if ($LASTEXITCODE -ne 0) { throw 'stage_b_where_binding_manifest_failed' }
$bindingDocument = $bindingStdout | ConvertFrom-Json
if ($bindingDocument.schema -ne 'where-latency-evidence-binding-v1' -or $bindingDocument.version -ne 1 -or $bindingDocument.kind -ne 'where') { throw 'stage_b_where_binding_manifest_identity_invalid' }
if ($bindingDocument.trustedCli.rootRealPath -ne $trustedCliRoot -or $bindingDocument.trustedCli.gitCommit -ne $expectedTrustedCliCommit -or $bindingDocument.trustedCli.gitTree -ne $expectedTrustedCliTree -or $bindingDocument.combinedCandidate.gitCommit -ne $expectedCombinedCandidateCommit -or $bindingDocument.combinedCandidate.gitTree -ne $expectedCombinedCandidateTree) { throw 'stage_b_where_binding_manifest_code_identity_mismatch' }
if ($bindingDocument.deployment.rootRealPath -ne $deploymentRoot -or $bindingDocument.deployment.gitCommit -ne $expectedDeploymentCommit -or $bindingDocument.deployment.gitTree -ne $expectedDeploymentTree -or $bindingDocument.deployment.immutableArtifactDigest -ne $immutableArtifactDigest) { throw 'stage_b_where_binding_manifest_deployment_identity_mismatch' }
$persistedBindingDocument = Get-Content -Raw -Encoding UTF8 -LiteralPath $whereBindingManifest | ConvertFrom-Json
if ($persistedBindingDocument.sha256 -ne $bindingDocument.sha256) { throw 'stage_b_where_binding_manifest_self_hash_mismatch' }
$whereBindingFileSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $whereBindingManifest).Hash.ToLowerInvariant()
```

Acceptance requires a `where-latency-canary-run-v1` pass: exactly two Where
handlers at TXc start, bounded TXc start, both terminal, drained scheduler,
unchanged capacity, zero foreign ownership, zero provider failure/429 and zero
Telegram intent/claim. Timeout, contamination, identity mismatch,
`non_gating_not_isolated`, delivery or provider error is not a pass.

The create-only `where-latency-evidence-binding-v1` manifest records canonical
trusted-CLI/deployment roots, CLI/combined/deployment identities, isolation/run
paths, both receipt self-hashes and raw file SHA-256 values. Record the manifest
path, self-hash and `$whereBindingFileSha256` in product truth.
The deployment receipt and bridge runtime attestation must bind the exact Task 4
combined-candidate identity and the same immutable artifact digest; any mismatch
stops before jobs are queued. The create-only run path plus CLI readback is the
authoritative receipt—stdout without that file binding is not evidence.

## Task 7: Measure Deep residual only after binding Deep start semantics

This task is conditional on an accepted Where receipt.

- [ ] **Step 1: Audit the Deep harness contract before restarting**

Record the actual Deep poll interval and how the canary triggers or awaits the
Deep cycle. The receipt/config must bind that interval/start policy and derive
its allowed start bound from Deep semantics, or attest a real immediate wake.

If the CLI still hard-fails using `min(5000, wherePollIntervalMs * 2)` while the
deployment uses the normal separate Deep poll, stop. Do not lower an unrelated
Where poll or manually invoke internal work merely to obtain a receipt. Add this
contract to the deployment-integration design and leave Deep residual open.

- [ ] **Step 2: Restart under a distinct attested Deep identity**

Use only:

```text
deep,address_index,delivery_reconciliation
```

The changed cycle set requires a new runtime-config SHA, deployment receipt and
raw receipt-file SHA-256. Deep concurrency remains observed at `1`; Where cycle
is disabled.

- [ ] **Step 3: Bind the complete new identity and run**

```powershell
$required = @($canaryDatabaseUrl,$runtimeInstanceLabel,$adapterPath,$runtimeConfigSha256,$bridgeUrl,$clientKeyPath,$deploymentReceiptPath,$deploymentReceiptFileSha256,$immutableArtifactDigest,$evidenceRoot,$approvedTrustedCliRoot,$expectedTrustedCliCommit,$expectedTrustedCliTree,$approvedDeepDeploymentRoot,$expectedDeepDeploymentCommit,$expectedDeepDeploymentTree,$expectedCombinedCandidateCommit,$expectedCombinedCandidateTree)
if (@($required | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) { throw 'stage_b_deep_input_missing' }
function Test-AbsoluteWindowsPath([string]$path) {
  return $path -match '^[A-Za-z]:[\\/]' -or $path -match '^[\\/]{2}[^\\/]+[\\/][^\\/]+'
}
function Get-NativeRealPath([string]$path,[string]$failureCode) {
  $output = & node -e "process.stdout.write(require('node:fs').realpathSync.native(process.argv[1]))" -- $path 2>&1
  if ($LASTEXITCODE -ne 0) { $output; throw $failureCode }
  $realPath = ($output -join "`n").Trim()
  if ([string]::IsNullOrWhiteSpace($realPath)) { throw $failureCode }
  return [IO.Path]::GetFullPath($realPath)
}
if (-not (Test-AbsoluteWindowsPath $approvedTrustedCliRoot)) { throw 'stage_b_deep_trusted_cli_root_not_absolute' }
if (-not (Test-AbsoluteWindowsPath $approvedDeepDeploymentRoot)) { throw 'stage_b_deep_deployment_root_not_absolute' }
if (-not (Test-AbsoluteWindowsPath $evidenceRoot)) { throw 'stage_b_deep_evidence_root_not_absolute' }
$trustedCliRoot = (Resolve-Path -LiteralPath $approvedTrustedCliRoot -ErrorAction Stop).Path
$canonicalTrustedCliRoot = [IO.Path]::GetFullPath($approvedTrustedCliRoot)
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($trustedCliRoot,$canonicalTrustedCliRoot)) { throw 'stage_b_deep_trusted_cli_root_identity_mismatch' }
$trustedCliRealPath = Get-NativeRealPath $trustedCliRoot 'stage_b_deep_trusted_cli_realpath_failed'
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($trustedCliRoot,$trustedCliRealPath)) { throw 'stage_b_deep_trusted_cli_reparse_alias_rejected' }
$trustedCliRoot = $trustedCliRealPath
$deepDeploymentRoot = (Resolve-Path -LiteralPath $approvedDeepDeploymentRoot -ErrorAction Stop).Path
$canonicalDeepDeploymentRoot = [IO.Path]::GetFullPath($approvedDeepDeploymentRoot)
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($deepDeploymentRoot,$canonicalDeepDeploymentRoot)) { throw 'stage_b_deep_deployment_root_identity_mismatch' }
$deepDeploymentRealPath = Get-NativeRealPath $deepDeploymentRoot 'stage_b_deep_deployment_realpath_failed'
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($deepDeploymentRoot,$deepDeploymentRealPath)) { throw 'stage_b_deep_deployment_reparse_alias_rejected' }
$deepDeploymentRoot = $deepDeploymentRealPath
$canonicalEvidenceRoot = [IO.Path]::GetFullPath($evidenceRoot)
[IO.Directory]::CreateDirectory($canonicalEvidenceRoot) | Out-Null
$evidenceRoot = (Resolve-Path -LiteralPath $evidenceRoot -ErrorAction Stop).Path
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($evidenceRoot,$canonicalEvidenceRoot)) { throw 'stage_b_deep_evidence_root_identity_mismatch' }
$evidenceRealPath = Get-NativeRealPath $evidenceRoot 'stage_b_deep_evidence_root_realpath_failed'
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($evidenceRoot,$evidenceRealPath)) { throw 'stage_b_deep_evidence_root_reparse_alias_rejected' }
$evidenceRoot = $evidenceRealPath
function Test-PathWithin([string]$child,[string]$parent) {
  $childCanonical = [IO.Path]::GetFullPath($child).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
  $parentCanonical = [IO.Path]::GetFullPath($parent).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
  if ([StringComparer]::OrdinalIgnoreCase.Equals($childCanonical,$parentCanonical)) { return $true }
  $prefix = $parentCanonical + [IO.Path]::DirectorySeparatorChar
  return $childCanonical.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)
}
if ((Test-PathWithin $evidenceRoot $trustedCliRoot) -or (Test-PathWithin $trustedCliRoot $evidenceRoot) -or (Test-PathWithin $evidenceRoot $deepDeploymentRoot) -or (Test-PathWithin $deepDeploymentRoot $evidenceRoot)) { throw 'stage_b_deep_evidence_root_not_isolated' }
if ((Test-PathWithin $trustedCliRoot $deepDeploymentRoot) -or (Test-PathWithin $deepDeploymentRoot $trustedCliRoot)) { throw 'stage_b_deep_trust_domains_not_isolated' }
$actualTrustedCliCommit = (git -C $trustedCliRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'stage_b_deep_trusted_cli_commit_read_failed' }
$actualTrustedCliTree = (git -C $trustedCliRoot rev-parse 'HEAD^{tree}').Trim()
if ($LASTEXITCODE -ne 0) { throw 'stage_b_deep_trusted_cli_tree_read_failed' }
if ($actualTrustedCliCommit -ne $expectedTrustedCliCommit -or $actualTrustedCliTree -ne $expectedTrustedCliTree) { throw 'stage_b_deep_trusted_cli_identity_mismatch' }
$trustedCliStatus = @(git -C $trustedCliRoot status --short)
if ($LASTEXITCODE -ne 0) { throw 'stage_b_deep_trusted_cli_status_failed' }
if ($trustedCliStatus.Count -ne 0) { $trustedCliStatus; throw 'stage_b_deep_trusted_cli_root_dirty' }
$actualDeepDeploymentCommit = (git -C $deepDeploymentRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'stage_b_deep_deployment_commit_read_failed' }
$actualDeepDeploymentTree = (git -C $deepDeploymentRoot rev-parse 'HEAD^{tree}').Trim()
if ($LASTEXITCODE -ne 0) { throw 'stage_b_deep_deployment_tree_read_failed' }
if ($actualDeepDeploymentCommit -ne $expectedDeepDeploymentCommit -or $actualDeepDeploymentTree -ne $expectedDeepDeploymentTree) { throw 'stage_b_deep_deployment_identity_mismatch' }
$actualCombinedTree = (git -C $deepDeploymentRoot rev-parse "${expectedCombinedCandidateCommit}^{tree}").Trim()
if ($LASTEXITCODE -ne 0 -or $actualCombinedTree -ne $expectedCombinedCandidateTree) { throw 'stage_b_deep_combined_identity_mismatch' }
git -C $deepDeploymentRoot merge-base --is-ancestor $expectedCombinedCandidateCommit $actualDeepDeploymentCommit
if ($LASTEXITCODE -ne 0) { throw 'stage_b_deep_deployment_not_descended_from_combined_candidate' }
$deepDeploymentStatus = @(git -C $deepDeploymentRoot status --short)
if ($LASTEXITCODE -ne 0) { throw 'stage_b_deep_deployment_status_failed' }
if ($deepDeploymentStatus.Count -ne 0) { $deepDeploymentStatus; throw 'stage_b_deep_deployment_root_dirty' }
$env:DATABASE_URL = $canaryDatabaseUrl
$env:RUNTIME_INSTANCE_LABEL = $runtimeInstanceLabel
$env:WHERE_LATENCY_CANARY_DEDICATED = 'true'
$env:WHERE_LATENCY_CANARY_ENABLED_CYCLES = 'deep,address_index,delivery_reconciliation'
$env:WHERE_LATENCY_CANARY_RUNTIME_ADAPTER = $adapterPath
$env:WHERE_LATENCY_CANARY_RUNTIME_CONFIG_SHA256 = $runtimeConfigSha256
$env:WHERE_LATENCY_CANARY_RUNTIME_BRIDGE_URL = $bridgeUrl
$env:WHERE_LATENCY_CANARY_RUNTIME_BRIDGE_TIMEOUT_MS = '10000'
$env:WHERE_LATENCY_CANARY_RUNTIME_BRIDGE_CLIENT_KEY_FILE = $clientKeyPath
$env:WHERE_LATENCY_CANARY_DEPLOYMENT_RECEIPT = $deploymentReceiptPath
$env:WHERE_LATENCY_CANARY_DEPLOYMENT_RECEIPT_SHA256 = $deploymentReceiptFileSha256
$env:WHERE_LATENCY_CANARY_IMMUTABLE_ARTIFACT_DIGEST = $immutableArtifactDigest
$env:WHERE_LATENCY_CANARY_TERMINAL_TIMEOUT_MS = '7200000'
$env:WHERE_LATENCY_CANARY_DRAIN_TIMEOUT_MS = '60000'
$env:FORENSIC_WHERE_POLL_INTERVAL_MS = '2000'
$env:FORENSIC_WHERE_WORKER_CONCURRENCY = '2'
$deepId = [guid]::NewGuid().ToString('N')
$deepReceipt = Join-Path $evidenceRoot "deep-residual-$deepId.json"
$deepStdout = & npm.cmd --silent --prefix $trustedCliRoot run forensic:where-latency:canary -- deep-residual --confirm --address TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd --out $deepReceipt
if ($LASTEXITCODE -ne 0) { throw 'stage_b_deep_residual_run_failed' }
$deepDocument = $deepStdout | ConvertFrom-Json
if ($deepDocument.schema -ne 'where-latency-deep-residual-v1' -or $deepDocument.version -ne 1 -or $deepDocument.result -ne 'measured') { throw 'stage_b_deep_residual_identity_invalid' }
$persistedDeepDocument = Get-Content -Raw -Encoding UTF8 -LiteralPath $deepReceipt | ConvertFrom-Json
if ($persistedDeepDocument.sha256 -ne $deepDocument.sha256) { throw 'stage_b_deep_residual_self_hash_binding_mismatch' }
$deepFileSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $deepReceipt).Hash.ToLowerInvariant()
if ($deepDocument.configSha256 -notmatch '^[0-9a-f]{64}$' -or $deepDocument.runtimeAttestation.runtimeConfigIdentity -ne $runtimeConfigSha256) { throw 'stage_b_deep_runtime_config_binding_mismatch' }
if ($deepDocument.deploymentIdentity.gitCommit -ne $expectedDeepDeploymentCommit -or $deepDocument.deploymentIdentity.gitTree -ne $expectedDeepDeploymentTree -or $deepDocument.deploymentIdentity.immutableArtifactDigest -ne $immutableArtifactDigest) { throw 'stage_b_deep_deployment_binding_mismatch' }
if ($deepDocument.runtimeAttestation.deploymentIdentity.gitCommit -ne $expectedDeepDeploymentCommit -or $deepDocument.runtimeAttestation.deploymentIdentity.gitTree -ne $expectedDeepDeploymentTree -or $deepDocument.runtimeAttestation.deploymentIdentity.immutableArtifactDigest -ne $immutableArtifactDigest) { throw 'stage_b_deep_runtime_attestation_binding_mismatch' }
$deepBindingManifest = Join-Path $evidenceRoot "deep-binding-$deepId.json"
$deepBindingStdout = & npm.cmd --silent --prefix $trustedCliRoot run forensic:where-latency:canary -- attest --trusted-cli-root $trustedCliRoot --expected-cli-commit $expectedTrustedCliCommit --expected-cli-tree $expectedTrustedCliTree --deployment-root $deepDeploymentRoot --expected-deployment-commit $expectedDeepDeploymentCommit --expected-deployment-tree $expectedDeepDeploymentTree --combined-commit $expectedCombinedCandidateCommit --combined-tree $expectedCombinedCandidateTree --immutable-artifact-digest $immutableArtifactDigest --deep-receipt $deepReceipt --out $deepBindingManifest
if ($LASTEXITCODE -ne 0) { throw 'stage_b_deep_binding_manifest_failed' }
$deepBindingDocument = $deepBindingStdout | ConvertFrom-Json
if ($deepBindingDocument.schema -ne 'where-latency-evidence-binding-v1' -or $deepBindingDocument.version -ne 1 -or $deepBindingDocument.kind -ne 'deep') { throw 'stage_b_deep_binding_manifest_identity_invalid' }
if ($deepBindingDocument.trustedCli.rootRealPath -ne $trustedCliRoot -or $deepBindingDocument.trustedCli.gitCommit -ne $expectedTrustedCliCommit -or $deepBindingDocument.trustedCli.gitTree -ne $expectedTrustedCliTree -or $deepBindingDocument.combinedCandidate.gitCommit -ne $expectedCombinedCandidateCommit -or $deepBindingDocument.combinedCandidate.gitTree -ne $expectedCombinedCandidateTree) { throw 'stage_b_deep_binding_manifest_code_identity_mismatch' }
if ($deepBindingDocument.deployment.rootRealPath -ne $deepDeploymentRoot -or $deepBindingDocument.deployment.gitCommit -ne $expectedDeepDeploymentCommit -or $deepBindingDocument.deployment.gitTree -ne $expectedDeepDeploymentTree -or $deepBindingDocument.deployment.immutableArtifactDigest -ne $immutableArtifactDigest) { throw 'stage_b_deep_binding_manifest_deployment_identity_mismatch' }
$persistedDeepBindingDocument = Get-Content -Raw -Encoding UTF8 -LiteralPath $deepBindingManifest | ConvertFrom-Json
if ($persistedDeepBindingDocument.sha256 -ne $deepBindingDocument.sha256) { throw 'stage_b_deep_binding_manifest_self_hash_mismatch' }
$deepBindingFileSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $deepBindingManifest).Hash.ToLowerInvariant()
```

The Where value `2` is required by the current canary base-config validator; it
does not start a Where handler because the attested Deep cycle set disables that
lane.

Acceptance is a measured receipt under the attested Deep start bound: singleton
handler, terminal job, zero delivery, clean ownership/drain, unchanged capacity
and complete queue-age/provider-error/memory measurements. This acceptance is
structural: `queueAgeMs` and residual latency are recorded observations and
neither authorize nor block the separate Where-concurrency trial. Stage B
defines no Deep latency threshold; Deep remains at `1`, and any future Deep
classification/threshold must be predeclared in a separate Deep design.

The Deep CLI stdout is accepted only after canonical full-shape/self-hash
readback. Record `$deepFileSha256`, the create-only Deep binding-manifest path,
its self-hash and `$deepBindingFileSha256`; copied JSON fields without those
reader and manifest gates are not Deep evidence.

## Task 8: Take the observability branch; do not invent a rollout analyzer

- [ ] **Step 1: Verify attributable input is still absent or present**

A future production analyzer may proceed only with either cycle-isolated
single-process windows or exact legacy-Where ownership on every provider attempt,
retry, fallback, failure and rate-limit event. It also needs a reviewed canonical
manifest schema binding raw-log SHA-256, commit/tree/artifact, config identity,
capacity fingerprint, cycle set, concurrency and half-open UTC boundaries.

Current process-global `tronscan_request_*` events are insufficient. In
particular, `TronscanClient` can intentionally suppress a final Tronscan error
when TronGrid transfer-history fallback succeeds, emitting
`trongrid_transfer_history_fallback` instead. A future design must count that as
a separate degradation metric or include it in the failure numerator. It must
also name the exact rate-limit numerator (for example enabled
`tronscan_rate_limit_cooldown`) and the request denominator.

This is a two-phase gate, not a circular requirement. Before any production
concurrency change, a separately reviewed observer and canonical manifest writer
must already be installed and validated against controlled input, with exact
cycle/ownership attribution and fail-closed receipt creation. Only then may an
operator separately authorize a reversible trial at `2`. The attributable
before/after receipt produced during that trial decides retain `2` versus restore
`1`; it cannot exist before the trial and is not required to authorize its own
creation.

- [ ] **Step 2: Stop at a reviewed design handoff**

If the attributable exporter and canonical manifest contract are absent—which
is the verified repository state—do not create
`whereLatencyRolloutEvidence.ts`, an analyzer script or synthetic rollout
receipts. Retain Where `1`, hand the proposed observability-design filename to
the user, and require a separate approved design plus implementation plan before
any reversible production trial.

If an approved external implementation already exists, verify it under its own
plan and readiness receipt before proposing the trial; do not silently absorb it
into this evidence plan. After a separately authorized trial, accept only a
complete attributable observation bound to the combined/deployment/trusted-CLI
identities and raw manifest/log hashes. Missing, failed or contaminated
observation requires restoration to `1` through the authorized rollback path.

## Task 9: Update product truth and close only proven gates

- [ ] **Step 1: Correct schema documentation**

Update `04-data-sources-tronscan-indexing.md` and `12-runbooks.md` so current
startup/migration instructions name schema 037 and verified 032→037 lineage.
Keep old schema descriptions explicitly historical.

- [ ] **Step 2: Record exact Stage B outcome**

Update `03`, `04`, `05`, `09`, `10`, `12` and `14` with every artifact that
actually exists:

- harness-fix, fixture, correctness, combined and any deployment identities;
- TXc fixture/replay output;
- PostgreSQL/schema output;
- targeted/full-suite output;
- Where/Deep receipts only if accepted;
- deployed concurrency from an observed receipt, not a repository inference;
- explicit deployment, Deep-start or observability blockers.

If Tasks 5, 7 or 8 stop, close the current decision as `default 1` and retain the
open problem. Do not call Stage B `canary-accepted` or `rollout-complete`.

- [ ] **Step 3: Verify and commit only actual docs/evidence state**

```powershell
rg -n "schema 036|032.?036|schema 037|Stage B|Where.*concurrency|TXc|capture|canary|Deep residual|rollout" docs/knowledge/03-job-lifecycle.md docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/05-where-is-money-and-incoming.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/12-runbooks.md docs/knowledge/14-current-roadmap.md
if ($LASTEXITCODE -ne 0) { throw 'stage_b_documentation_audit_failed' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'stage_b_documentation_diff_check_failed' }
git add docs/knowledge/03-job-lifecycle.md docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/05-where-is-money-and-incoming.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/12-runbooks.md docs/knowledge/14-current-roadmap.md
if ($LASTEXITCODE -ne 0) { throw 'stage_b_documentation_stage_failed' }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'stage_b_documentation_cached_diff_failed' }
git commit -m "docs(forensics): record Stage B evidence outcome"
if ($LASTEXITCODE -ne 0) { throw 'stage_b_documentation_commit_failed' }
```

Stage only changed files. Generated receipts under `outputs/` remain external.

## Final Acceptance Checklist

- [ ] Capture accepts real PostgreSQL timestamps, is DB-read-only after selecting the source job, projects secret-safe assertions and always disposes execution.
- [ ] Harness fix changes no legacy behavior-source file and has its own clean recorder SHA/tree.
- [ ] Real TXc fixture is secret-free, tracked, recorder-bound and passes strict replay from a clean fixture checkout.
- [ ] Schema 037, idempotent migration, claims, fairness, evidence reuse and delivery tests run on real PostgreSQL with no named skip.
- [ ] Harness and fixture commits are explicitly integrated with correctness into one clean combined candidate.
- [ ] Targeted suite, typecheck, full suite, exact shortcut checks and `git diff --check` pass.
- [ ] Repository and deployed Where stay or return to `1` until replay, PostgreSQL, reviewed deployment, accepted Where/Deep receipts, and a validated attributable observer are ready; those gates may authorize only a separately approved reversible trial at `2`.
- [ ] The trial's completed attributable observation—not a circular pre-trial receipt—decides retain `2` versus restore `1`, with rollback authority and criteria fixed before the trial.
- [ ] Any canary uses a tracked adapter in a clean immutable integration root and a verified schema-037 clone, never a fake/untracked adapter or shared user runtime.
- [ ] Deep residual binds actual Deep start/poll semantics and remains concurrency `1`.
- [ ] Process-global request counts alone are rejected; TronGrid fallback and rate-limit numerators are explicit in any future observability design.
- [ ] TQr Unified execution is untouched and never cited as Stage B proof.
- [ ] Knowledge docs distinguish runtime-core verification, capture proof, canary acceptance, rollout completion and a deliberate `default 1` decision.
