# Stage C1 Runtime Accepted-History Shadow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a disabled-by-default, score-neutral runtime observer that profiles already accepted address histories, persists only standalone shadow artifacts, reconciles them only after the authoritative checkpoint commits, and proves byte non-interference.

**Architecture:** Extend the existing pure `serviceRoleShadow` model with an anchor/sample-bound V2 wrapper, freeze one immutable `ready | unavailable` input-fence outcome per run, and invoke one failure-contained observer after each accepted address/direction group is applied. Profiles remain per traversal state, but one compound group owns one sorted precommit receipt, pending token, and post-commit runtime receipt. Reconcile only from a non-cancelled checkpoint result that proves the exact ordered planner entries and candidate delta committed; recover the callback crash window with one bounded startup sweep. Admission tooling and its one-argument parser are committed and fully tested first; only then does a clean `testedSourceCommit` run a new isolated one-group replay backed by byte-verified history from the frozen failed run. Its self-contained acceptance root embeds the replay inputs and runtime proof closure and is committed in a later direct-child evidence commit. The source run is never cloned or resumed. No Stage D transport, score, finalizer, Admin, provider request, or schema change is allowed.

**Tech Stack:** TypeScript, Node.js `AbortController`, Vitest, PostgreSQL schema 037, existing canonical JSON hashing and Unified artifact repository.

---

## Execution checkpoint — 2026-08-01

- On `1028c2a7bd14ddfbeb233d681bfec63f32974d13`, Tasks 1-2 are
  implemented and reviewed. Strict configuration landed in `d6bb5f2d` and
  `485456a4`; binding/parser work landed in `00ab51ae`, `5abc62b3` and
  `28ecd6f3`. The focused binding suite is `19/19` and typecheck passes. V1
  profile bytes remain compatible; V2 owns the deep-frozen parser, compound
  key and exact `100 + 100` binding.
- Task 3 is complete. Code landed in `9c0f1b3d`, `abb81add` and `1028c2a7`;
  the acceptance follow-up adds one whole-transaction retry for PostgreSQL
  serialization failure and a deterministic race between two independent
  connections. Both callers converge on one content-addressed bundle, V1 map
  and V2 wrapper, a third connection observes no partial trio, the final rows
  are exactly one per member, and accepted-attempt references remain zero.
  The PostgreSQL file passes `18/18` with zero skips, the unit file passes
  `19/19`, and typecheck passes. Its checklist is complete.
- Task 4 is complete. One explicit runtime factory owns the immutable run-wide
  input set/fence and compound lookup without production wiring. The unit file
  passes `24/24`; the real schema-037 PostgreSQL file passes `7/7` with zero
  skips, and combined Task 3+4 PostgreSQL passes `25/25`, including
  distinct-connection convergence, corrupt-key fail-closed handling, bounded
  normal/publication lock waits, rollback, no retained C1 lock and a later
  authoritative write.
- Task 5 is complete in code. The optional coordinator hook owns its callback
  inputs, runs once per accepted address/direction group after candidate-delta
  persistence, and is bounded by one 1,000 ms signal between authoritative
  heartbeats. Exact found-map subgroups persist per-state profiles and one
  strict idempotent precommit; the focused coordinator/runtime files pass
  `26/26` and `31/31`.
- Task 6 is complete in code. The exact enabled config wires Task 5 observation
  and the 1,000 ms post-durable checkpoint reconciler. The repository returns
  only transaction-validated committed identities; one group requires exactly
  one manifest-hash match while unrelated entries in the same valid prefix are
  retained in the receipt. Candidate delta ancestry is independently proven
  from the committed head. Pending attempt state is lease-expiring, capped and
  consumed on every post-durable outcome; each reconciliation transaction has
  500 ms local lock/statement deadlines. Relevant unit tests pass `95/95`;
  shadow-runtime and ordered-commit PostgreSQL pass `8/8 + 18/18` with zero
  skips.
- Task 7 is complete in code. Completion carries `checkpointCommit:null` into
  the real current-closure summary path; enabled startup performs one bounded
  recovery sweep. Relevant unit tests pass `98/98`; shadow-runtime and
  ordered-commit PostgreSQL pass `22/22 + 18/18` with zero skips.
- Task 8 is complete in `006a30b6` with correctness follow-ups through
  `90f4b428`. The real disabled/enabled PostgreSQL tape proves byte-identical
  authoritative state, unchanged provider/cache behavior, zero shadow
  references, exact `1/1/7/1/1/1` shadow cardinality on a completed run, and
  bounded preload/post-commit failure containment. Task 9's producer/parser,
  strict replay and gates are complete in the direct follow-up commit; Task 10
  remains, and no C1 real-history acceptance evidence exists yet.
- Guard: strict invalid-config rejection is the only product-facing contract
  change. Do not call C1 or Stage C complete; production remains matrix-v4,
  ScoreAnchorV3 and report-only checked-subject role with no suppression or
  score effect.

## Verified code truth

Plan target: `master` at design commit `c4fe5d52143002dc19c6a611f9cddb7ee50e60ca` in the dedicated `stage-c-roadmap-design` worktree.

- `src/unifiedCheck/productionTraversalCoordinator.ts` hash-validates accepted address-history entries, revives pages, applies one address/direction group, persists a traversal delta, and optionally observes owned copies before returning the unchanged checkpoint.
- `src/unifiedCheck/worker.ts::runUnifiedTaskCycle` calls `onLifecyclePersisted` only after repository checkpoint/completion succeeds, owns its inputs, and bounds the awaited callback at 1,000 ms.
- `src/unifiedCheck/productionWorker.ts::createPostgresUnifiedTaskCycleRepository` normalizes the durable row into checkpoint status/JSON plus exact ordered transaction evidence.
- `src/unifiedCheck/productionRuntime.ts::createUnifiedProductionRuntime` owns traversal assembly, generic artifact persistence, analysis worker cycles, and the PostgreSQL transaction host.
- `src/unifiedCheck/serviceRoleShadow.ts::maybeBuildServiceRoleShadowArtifactV1` is the existing pure accepted-history `100 + 100` builder. Its profile bytes and V1 map remain immutable.
- `src/unifiedCheck/serviceRoleMapMaterialization.ts` and `scripts/materializeServiceRoleEventMap.ts` atomically persist the unreferenced V1 evidence bundle, V1 role map and additive V2 wrapper; the real PostgreSQL gate and two-connection convergence race pass.
- `src/config.ts` strictly parses `UNIFIED_SERVICE_ROLE_SHADOW_POLICY`; Task 6 passes the exact value into runtime, and absence remains disabled.
- `insertUnifiedArtifact` already provides content-addressed, immutable, run-owned storage. C1 needs no table, column, index, or migration.
- The frozen source run `5417cbf6-7cef-4b91-8367-d266eaf3857e` is `FAILED_TECHNICAL`; its traversal task is `CANCELLED`, has no accepted traversal attempt, and belongs to an older runtime commit. Its graph has 888 planned entries and 100 ready entries. It is valid accepted-history provenance but is not a runnable current-worker lifecycle and must never be cloned wholesale, resumed, or relabelled as a successful production run.
- The frozen accepted address/direction group contains seven qualifying traversal states. C1 therefore expects seven per-state profiles but exactly one compound-group precommit receipt and one reconciled runtime receipt for admission.

Baseline already passed before this plan: `npm run typecheck`; full `npm test` with 5,345 passed and 175 pre-existing skipped tests. Re-run fresh gates at the end.

## Frozen C1 decisions and hard aborts

- Accepted-history anchor binding V1 is exactly `canonicalEventId + blockNumber + timestamp + eventIndex + orderAuthority: "unique_block"`. It is reconstruction authority, not physical chain-order authority.
- The run-wide preload, each independent group observer, the post-commit lifecycle callback, and the one startup recovery sweep each have their own hard `1_000 ms` deadline and `AbortSignal`; no per-state timer is allowed.
- Timeout, callback rejection, persistence failure, process loss, and missing process-local pending state collapse into deterministic terminal `unreconciled`; no row is written for an individual skip/failure.
- A found map is not qualifying when the frozen V1 profile builder still
  returns a diagnostic `insufficientReason`. Abort observed before the final
  precommit insert settles and before the transaction callback returns rolls
  back every subgroup row. If every check passed and COMMIT was already ordered
  before a later timer abort, the durable precommit is complete, has no local
  pending token, and is eligible for Task 7's bounded crash-window recovery.
- A run's first valid `service-role-shadow-input-fence-v1` outcome is immutable. `ready` binds the complete sorted V2 input set; `unavailable` binds `preload_timeout | malformed | conflict`. Restart reuses that outcome and never rescans a later role-map population.
- A returned checkpoint row is not sufficient authority: `CANCELLED`, claim-loss, an absent/mismatched ordered-entry commit, or a candidate delta not reachable from the committed head produces no runtime receipt.
- Acceptance generation is forbidden from a dirty tree. Producer, owning serializer/parser, and tests must already exist in a clean `testedSourceCommit`; replay input, identity, and receipt all bind that exact commit.
- `service-role-shadow-c1-acceptance-v1` is the only C6 root. It embeds the canonical replay input, identity, disabled/enabled authoritative projections, and complete C1 runtime-artifact closure, so `parseServiceRoleShadowC1AcceptanceV1(value)` needs no path, database, resolver, or sibling artifact.
- Generated C1 evidence is committed only in the immediate child of `testedSourceCommit`; that evidence commit may touch only the three C1 audit files and the listed knowledge pages.
- Non-interference compares an explicitly frozen authoritative projection. The PostgreSQL harness installs a schema-local frozen clock before migrations and injects deterministic IDs.
- Abort immediately if implementation requires a migration, provider call, finalizer change, Admin change, scoring change, Stage D artifact, checked-subject classifier, provider-configuration hash change, or shadow hash in an accepted attempt/final hash.
- Do not modify `src/unifiedCheck/productionFinalizer.ts`, `src/admin/**`, `src/risk/**`, scoring matrix files, migrations, Telegram presentation code, or delivery code.

## File map

Create:

- `src/unifiedCheck/serviceRoleShadowRuntime.ts` — run-wide V2 input fence, lookup, group observation, pending tokens, post-commit reconciliation, terminal summary.
- `tests/unified-check/serviceRoleShadowRuntime.test.ts` — pure runtime contracts, deadlines, grouping, failure containment.
- `tests/unified-check/serviceRoleShadowRuntime.postgres.test.ts` — run lock/input fence, receipts, restart, summary, and enabled/disabled projection.
- `scripts/replayServiceRoleShadowRuntimeAcceptance.ts` — isolated disabled/enabled one-group replay from the frozen run's accepted-history bytes, explicit source-to-replay identity translation, and canonical acceptance receipt.
- `tests/scripts/replayServiceRoleShadowRuntimeAcceptance.test.ts` — strict CLI, disposable-schema safety, and receipt validation.

Modify:

- `src/unifiedCheck/serviceRoleShadow.ts` — accepted-history binding V1, V2 wrapper/parser, compound key; preserve V1 bytes.
- `src/unifiedCheck/serviceRoleMapMaterialization.ts` — build V2 wrapper from the accepted V1 pair.
- `scripts/materializeServiceRoleEventMap.ts` — atomically persist/reuse schema-2 wrapper.
- `src/unifiedCheck/productionTraversalCoordinator.ts` — optional group observer and candidate delta metadata.
- `src/unifiedCheck/repository.ts` — return explicit ordered-checkpoint commit evidence from the transaction; no persistence/schema change.
- `src/unifiedCheck/worker.ts` — await failure-contained post-persist callback and expose committed checkpoint.
- `src/unifiedCheck/productionWorker.ts` — forward committed `checkpoint_json`.
- `src/unifiedCheck/productionRuntime.ts` — assemble disabled/enabled shadow runtime and lifecycle hooks.
- `src/config.ts`, `src/index.ts` — strict flag and wiring only.
- Focused tests beside every modified component.
- `docs/knowledge/02-check-modes.md`, `03-job-lifecycle.md`, `04-data-sources-tronscan-indexing.md`, `09-current-decisions.md`, `10-open-problems.md`, `14-current-roadmap.md` — record implemented score-neutral C1 truth.

### Task 1: Strict disabled-by-default configuration

**Files:** Modify `src/config.ts`; test `tests/config/config.test.ts`.

- [x] **Step 1: Write failing config cases** for unset, both valid literals, and `""`, `"true"`, `"false"`, `"1"`, and an unknown version. Assert unset is `disabled` and every invalid value throws with `UNIFIED_SERVICE_ROLE_SHADOW_POLICY`.
- [x] **Step 2: Run the red test.**

  Run: `npm test -- tests/config/config.test.ts`

  Expected: FAIL because `unifiedServiceRoleShadowPolicy` does not exist.

- [x] **Step 3: Add the exact config contract.**

  ```ts
  function parseUnifiedServiceRoleShadowPolicy(
    value: string | undefined
  ): ServiceRoleShadowMode {
    if (value === undefined || value === "disabled") return "disabled";
    if (value === "service-role-shadow-100-plus-100-v1") return value;
    throw new Error(
      "UNIFIED_SERVICE_ROLE_SHADOW_POLICY must be disabled or " +
      "service-role-shadow-100-plus-100-v1"
    );
  }
  ```

  Add `unifiedServiceRoleShadowPolicy: ServiceRoleShadowMode` to `AppConfig` and parse the raw environment value without trimming/default substitution. Runtime wiring is deliberately deferred to Task 6 so this commit remains typecheck-clean.

- [x] **Step 4: Run the green test.** Expected: PASS.
- [x] **Step 5: Commit.**

  ```powershell
  git add src/config.ts tests/config/config.test.ts
  git commit -m "feat: add strict service role shadow policy"
  ```

### Task 2: Anchor/sample binding V1 and role-map wrapper V2

**Files:** Modify `src/unifiedCheck/serviceRoleShadow.ts`; test `tests/unified-check/serviceRoleShadow.test.ts`.

- [x] **Step 1: Write failing tests** proving exact anchor fields, lexically sorted recent/historical ID sets, stable sample hash, wrong anchor collision, different sampled set collision, V1 rejection at the V2 parser, duplicate sample rejection, and unchanged V1 profile hash.
- [x] **Step 2: Run the red test.**

  Run: `npm test -- tests/unified-check/serviceRoleShadow.test.ts`

  Expected: FAIL on missing `deriveServiceRoleShadowAcceptedHistoryBindingV1` and V2 types.

- [x] **Step 3: Add these contracts without changing `ServiceRoleShadowArtifactV1`.**

  ```ts
  export type ServiceRoleShadowAnchorBindingV1 = {
    canonicalEventId: string;
    blockNumber: number;
    timestamp: string;
    eventIndex: number;
    orderAuthority: "unique_block";
  };

  export type ServiceRoleShadowAcceptedHistoryBindingV1 = {
    profiledAddress: string;
    direction: TraversalStateV1["direction"];
    anchorBinding: ServiceRoleShadowAnchorBindingV1;
    sampledCanonicalEventIds: {
      recent: readonly string[];
      historical: readonly string[];
    };
    sampledEventIdsSha256: string;
  };

  export type ServiceRoleShadowEventRoleMapV2 = {
    schemaVersion: "service-role-shadow-event-role-map-v2";
    policyVersion: "service-role-shadow-100-plus-100-v1";
    runId: string;
    snapshotHash: string;
    addressHistoryManifestSha256: string;
    sourceEventRoleMapV1Sha256: string;
    evidenceBundleSha256: string;
    binding: ServiceRoleShadowAcceptedHistoryBindingV1;
    exactCoverage: { recent: 100; historical: 100; total: 200 };
    productionEffect: false;
  };
  ```

  Refactor the existing canonical/anchor/window selection into one private primitive used by both `maybeBuildServiceRoleShadowArtifactV1` and exported `deriveServiceRoleShadowAcceptedHistoryBindingV1`. The binding sorts copies of the two ID sets before hashing; the existing profile retains its original event order and byte shape.

- [x] **Step 4: Add strict `parseServiceRoleShadowEventRoleMapV2` and `serviceRoleShadowCompoundBindingKeyV1`.** Require exact keys, canonical body hash supplied by the caller, `100/100/200`, disjoint unique IDs, and the frozen anchor authority.
- [x] **Step 5: Run the test.** Expected: PASS with the old V1 hash assertion unchanged.
- [x] **Step 6: Commit.**

  ```powershell
  git add src/unifiedCheck/serviceRoleShadow.ts tests/unified-check/serviceRoleShadow.test.ts
  git commit -m "feat: bind service role maps to anchor samples"
  ```

### Task 3: Materialize the additive V2 wrapper

**Files:** Modify `src/unifiedCheck/serviceRoleMapMaterialization.ts`, `scripts/materializeServiceRoleEventMap.ts`; test both existing materialization test files.

- [x] **Step 1: Add failing tests** for a complete V1 bundle/map producing one wrapper, exact evidence-bundle cardinality, source V1 hash tamper, bundle hash tamper, anchor/sample collision, idempotent re-run, and zero accepted-attempt references.
- [x] **Step 2: Run the red tests.**

  Run: `npm test -- tests/unified-check/serviceRoleMapMaterialization.test.ts`

  Expected: FAIL because the materialization result has no V2 wrapper.

- [x] **Step 3: Add `materializeServiceRoleEventMapV2`.** It must require the V1 map entries and V1 evidence-bundle entries to cover exactly the same 200 sampled IDs, require every V1 map entry to cite the bundle hash, derive the binding through Task 2, and return canonical artifact bytes plus SHA-256.
- [x] **Step 4: Extend `ServiceRoleMaterializationRunResult`** with `eventRoleMapV2Sha256: string | null`; in materialize mode insert the wrapper as kind `service_role_event_role_map`, DB schema version `"2"`, in the same read-write transaction as the existing pair. Preserve existing V1 rows.
- [x] **Step 5: Run unit tests.** Expected: PASS.
- [x] **Step 6: Run PostgreSQL materialization tests with a real test database.**

  ```powershell
  if (-not $env:TEST_DATABASE_URL) { throw "TEST_DATABASE_URL is required" }
  $env:UNIFIED_RELEASE_GATE_MODE="1"
  npm test -- tests/unified-check/serviceRoleMapMaterialization.postgres.test.ts
  ```

  Expected: the file executes, all tests pass, skipped count is zero, and the complete case stores one bundle plus V1 and V2 maps with no attempt reference.

  Acceptance: `18/18` passed with zero skips, including a deterministic
  two-connection race with a third observer proving no partial trio is visible.

- [x] **Step 7: Commit.**

  ```powershell
  git add src/unifiedCheck/serviceRoleMapMaterialization.ts scripts/materializeServiceRoleEventMap.ts tests/unified-check/serviceRoleMapMaterialization.test.ts tests/unified-check/serviceRoleMapMaterialization.postgres.test.ts
  git commit -m "feat: materialize service role map wrappers"
  ```

### Task 4: Freeze one run-wide input set

**Files:** Create `src/unifiedCheck/serviceRoleShadowRuntime.ts`, `tests/unified-check/serviceRoleShadowRuntime.test.ts`, `tests/unified-check/serviceRoleShadowRuntime.postgres.test.ts`.

- [x] **Step 1: Write failing tests** for one V2 scan on first load, empty-set caching, restart reuse of the first valid fence, source V1/bundle validation, compound `missing | found | conflict`, and separate 1,000 ms attempt deadlines. Cover `SET LOCAL lock_timeout = '1000ms'` and `SET LOCAL statement_timeout = '1000ms'`, rollback before unavailable publication, deterministic `malformed | conflict | preload_timeout` outcomes, corrupt non-hash wrapper keys with only valid hashes retained in an initial no-fence malformed outcome, pre-existing ready fences with missing closure converging once on restart-stable conflict without row proliferation, huge sparse public-parser rejection before length-sized allocation, code-unit hash ordering, two concurrent initializers converging on one content hash, and a later role-map insertion never changing a prior `ready` or `unavailable` fence.
- [x] **Step 2: Run the red test.** Expected: FAIL because the runtime module is absent.
- [x] **Step 3: Add the frozen input-set, immutable outcome-fence, and lookup contracts.**

  ```ts
  export type ServiceRoleShadowInputSetV1 = {
    schemaVersion: "service-role-shadow-input-set-v1";
    policyVersion: "service-role-shadow-100-plus-100-v1";
    runId: string;
    snapshotHash: string;
    roleMapV2Sha256s: readonly string[];
    productionEffect: false;
  };

  export type ServiceRoleShadowInputFenceV1 = {
    schemaVersion: "service-role-shadow-input-fence-v1";
    policyVersion: "service-role-shadow-100-plus-100-v1";
    runId: string;
    snapshotHash: string;
    runtimeCommit: string;
    outcome:
      | {
          kind: "ready";
          inputSetSha256: string;
          roleMapV2Sha256s: readonly string[];
        }
      | {
          kind: "unavailable";
          reason: "preload_timeout" | "malformed" | "conflict";
          observedRoleMapV2Sha256s: readonly string[] | null;
        };
    productionEffect: false;
  };

  export type ServiceRoleShadowMapLookupV1 =
    | { kind: "missing" }
    | { kind: "found"; wrapperSha256: string; wrapper: ServiceRoleShadowEventRoleMapV2; sourceMapSha256: string; sourceMap: ServiceRoleShadowEventRoleMapV1 }
    | { kind: "conflict"; wrapperSha256s: readonly string[] };
  ```

- [x] **Step 4: Implement `createServiceRoleShadowRuntimeV1` around the fence, not around a retrying scan.** Cache one promise per active run initialization; keep a resolved durable fence cached, but evict a terminal rejection before any fence exists. The normal short transaction sets both PostgreSQL local timeouts before taking a C1 run-key advisory transaction lock and `unified_check_runs FOR UPDATE`. It first resolves the run's existing fence; exactly one strict valid fence with a reusable input-set/wrapper/source closure is reused, while multiple/different fence bodies or a non-reusable pre-existing ready closure collapse to `unavailable/conflict`. With no fence, scan only run-owned kind `service_role_event_role_map`, schema `2`, validate all wrapper/source/bundle bytes, sort hashes by code unit, insert the input set, and publish the deterministic `ready` fence in the same transaction. Empty input is a valid ready set.
- [x] **Step 5: Publish timeout or validation failure with at most two attempts after normal rollback.** A lock/statement timeout or typed malformed/conflict request rolls the normal transaction back completely. Each publication attempt opens a fresh short transaction, applies both 1,000 ms local deadlines, acquires the same C1 advisory key, and re-checks for a winner before inserting the deterministic `unavailable` fence (`observedRoleMapV2Sha256s:null` for preload timeout). A first publication timeout re-enters once; there are at most two publication attempts after the normal attempt, for about 3,000 ms plus scheduling jitter under an indefinitely held external lock. Only an initial scan with no fence may publish malformed; it binds only sorted unique lowercase SHA-256 keys actually observed, and any invalid key still makes that scan malformed. A non-reusable pre-existing ready closure instead publishes or reuses deterministic conflict, with no additional row after the first restart. The artifact body has no wall-clock field, so concurrent publishers converge by content hash. If both publication attempts expire, evict the rejected cache entry so a later caller may retry and rescan only because no durable fence exists. Once a fence is durable, restart resolves it without a new V2 scan.
- [x] **Step 6: Run unit and PostgreSQL tests.** Expected: PASS; query spy shows no per-state JSONB scan, every lock/statement attempt is bounded by 1,000 ms plus test jitter, exact backend/query/lock-state barriers distinguish fresh publication transactions, `pg_locks` shows no retained C1 lock, and an authoritative write proceeds after the normal timeout transaction rolls back. The focused unit file passes `24/24`, Task 4 PostgreSQL passes `7/7` with zero skips, and combined Task 3+4 PostgreSQL passes `25/25`.
- [x] **Step 7: Commit.**

  ```powershell
  git add src/unifiedCheck/serviceRoleShadowRuntime.ts tests/unified-check/serviceRoleShadowRuntime.test.ts tests/unified-check/serviceRoleShadowRuntime.postgres.test.ts
  git commit -m "feat: freeze run-wide service role inputs"
  ```

### Task 5: Observe one accepted address-history group

**Files:** Modify `src/unifiedCheck/productionTraversalCoordinator.ts`, `src/unifiedCheck/serviceRoleShadowRuntime.ts`; test coordinator/runtime files.

- [x] **Step 1: Add failing tests** for stable state ordering, subgrouping by compound binding, one callback per accepted address/direction group, one 1,000 ms `AbortSignal` deadline, heartbeat before/after, disabled zero-callback behavior, timeout, callback throw, late rejection, and no change to returned checkpoint/delta. Pin the cardinality rule: profiles are per qualifying state, while each compound subgroup gets exactly one sorted precommit receipt and pending token; the frozen seven-state group therefore yields seven profiles and one precommit receipt.
- [x] **Step 2: Run the red tests.** Expected: FAIL because the coordinator has no hook. RED was `23` tests with the new observer assertion failing `expected 1, received 0`; the runtime RED was `25` tests with `observeAcceptedAddressHistoryGroup is not a function`.
- [x] **Step 3: Extend `persistTraversalApplication` return value** with `deltaSha256`, then add this optional factory input:

  ```ts
  onAcceptedAddressHistoryShadowGroup?(input: {
    taskId: string;
    attempt: number;
    runId: string;
    snapshotHash: string;
    subjectAddress: string;
    manifestKey: string;
    manifestSha256: string;
    acceptedPageArtifactHashes: readonly string[];
    events: readonly IndexedTronUsdtTransfer[];
    states: readonly TraversalStateV1[];
    candidateCheckpoint: TraversalCheckpointV2;
    candidateDeltaSha256: string;
    signal: AbortSignal;
  }): Promise<void>;
  ```

- [x] **Step 4: Invoke the hook after successful application and delta persistence, before handler return.** Heartbeats remain authoritative and may throw claim loss; catch only observer/timeout errors. Abort at 1,000 ms, stop new per-state operations when `signal.aborted`, and attach a rejection handler to late work. Callback checkpoint/events/states are owned deep copies, including `Date`, so synchronous or late mutation cannot reach authoritative state.
- [x] **Step 5: Persist only complete found-map compound groups.** Insert the existing profile once per qualifying state; a diagnostic profile with non-null `insufficientReason` is not qualifying. After every profile insert for one compound binding settles before abort, insert exactly one `service-role-shadow-precommit-receipt-v1` whose body binds fence/input-set hashes, accepted manifest and page hashes, candidate checkpoint/delta hashes, the compound binding key, and a lexically sorted exact array of `{ traversalStateId, shadowStateId, profileSha256, wrapperSha256 }`; set `commitStatus:"unconfirmed"` and `productionEffect:false`. Recheck abort immediately after the final insert and before returning to the transaction host. Register one pending token for that group only after all profile and group-receipt inserts and COMMIT settle. Partial profiles never create a precommit receipt and can never be reconciled; a commit already ordered after all checks is a complete crash-window precommit even if the callback's timer aborts before the commit reply.
- [x] **Step 6: Run tests.** Expected: PASS; missing/conflict/malformed/insufficient/failure paths add no per-skip artifact. The coordinator/runtime files pass `26/26` and `31/31`; typecheck and diff check pass.
- [x] **Step 7: Commit.**

  ```powershell
  git add src/unifiedCheck/productionTraversalCoordinator.ts src/unifiedCheck/serviceRoleShadowRuntime.ts tests/unified-check/productionTraversalCoordinator.test.ts tests/unified-check/serviceRoleShadowRuntime.test.ts
  git commit -m "feat: observe accepted traversal histories"
  ```

### Task 6: Reconcile only after the authoritative checkpoint commits

**Files:** Modify `src/unifiedCheck/repository.ts`, `worker.ts`, `productionWorker.ts`, `productionRuntime.ts`, `serviceRoleShadowRuntime.ts`, `src/index.ts`; test corresponding files including `tests/unified-check/orderedCommit.test.ts` and `orderedCommit.postgres.test.ts`.

- [x] **Step 1: Write failing tests** proving hook order, exact committed checkpoint forwarding, ordered-entry identities returned only after their atomic `ready -> committed` transition, and candidate-delta reachability through the committed delta chain. Cover claim loss, prefix mismatch, rollback, and the existing cancellation branch: a durable `CANCELLED` checkpoint row has `orderedCommit.applied:false` and produces no runtime receipt. Add a never-settling lifecycle hook test that observes abort at 1,000 ms while durable checkpoint success and provider wake remain intact; also cover callback throw and late rejection.
- [x] **Step 2: Run the red tests.** Worker RED was `13` tests with `2` failures because signal/commit authority were absent and late rejection was unhandled. Ordered unit RED was `3` tests with `1` failure because the adapter discarded committed status/checkpoint/entry identities. Runtime RED was `33` tests with `2` failures because `reconcileCheckpoint` did not exist. Production-runtime RED was `3` tests with `2` failures because enabled wiring/validation did not exist.
- [x] **Step 3: Extend the existing seam minimally.**

  ```ts
  export type UnifiedCheckpointCommitResult = {
    readonly checkpointed: boolean;
    readonly providerWorkAvailable: boolean;
    readonly committedTaskStatus: "QUEUED" | "CANCELLED" | null;
    readonly committedCheckpoint: unknown | null;
    readonly orderedCommit: {
      readonly applied: boolean;
      readonly runId: string;
      readonly committedEntries: readonly {
        readonly canonicalSequence: number;
        readonly taskId: string;
        readonly acceptedAttemptId: string;
        readonly artifactSha256: string;
      }[];
    } | null;
  };

  checkpoint(input: UnifiedCheckpointRequest): Promise<UnifiedCheckpointCommitResult>;

  onLifecyclePersisted?(input: {
    readonly task: UnifiedWorkerTask;
    readonly result: UnifiedCompletedChunkOutcome | Extract<UnifiedChunkOutcome, { kind: "checkpoint" }>;
    readonly checkpointCommit: UnifiedCheckpointCommitResult | null;
    readonly signal: AbortSignal;
  }): void | Promise<void>;
  ```

  Inside the existing ordered transaction, return `orderedCommit.applied:true` only when the task row committed as `QUEUED` and every expected planner entry was updated to `committed`; return the exact validated entry identities from that transaction. The current `CANCELLED` early return explicitly reports `applied:false` and an empty committed-entry array. This is an internal return shape only—no schema/migration. `productionWorker` forwards the row's `status` and `checkpoint_json` plus this ordered evidence instead of reducing it to booleans.
- [x] **Step 4: Bound and contain the post-commit callback.** `runUnifiedTaskCycle` invokes it only after the repository operation is durable, supplies a fresh `AbortSignal`, aborts at 1,000 ms, attaches a rejection handler to late work, and swallows observer timeout/rejection. Neither the returned lifecycle result nor `onProviderWorkAvailable` can be lost because of this observer. A completion lifecycle passes `checkpointCommit:null`; a checkpoint lifecycle passes the exact normalized commit result.
- [x] **Step 5: Wire analysis lifecycle in `createUnifiedProductionRuntime`.** Add optional input `serviceRoleShadowPolicy?: ServiceRoleShadowMode`, normalize absence to `disabled`, and pass the explicit config value from `src/index.ts`. Disabled policy passes no coordinator hook and performs no shadow query. Enabled traversal checkpoints reconcile only from `QUEUED` plus applied ordered evidence and proved candidate-delta ancestry. Each precommit requires exactly one committed manifest-hash match; unrelated entries in the same valid atomic prefix are allowed and bound in full, while zero/duplicate matches fail closed. Completion passes `checkpointCommit:null` through the worker seam but deliberately does not call a stub: Task 7 owns the real `summarizeRun` implementation and wiring. The policy is not part of provider configuration or authoritative identity.
- [x] **Step 6: Implement one `service-role-shadow-runtime-receipt-v1` per compound group.** Require pending task/attempt and group-key match, the one group precommit hash, the exact sorted seven-profile array when processing the frozen admission group, canonical committed checkpoint hash, candidate delta reachable from committed `deltaHeadSha256`, exact committed planner-entry identities, manifest/fence/input-set/runtime commit, `commitStatus:"reconciled"`, and `productionEffect:false`. A caller-supplied boolean is never authority.
- [x] **Step 7: Run focused tests.** PASS: six focused unit files execute `81/81`; `orderedCommit.postgres.test.ts` executes `18/18` with zero skips; typecheck passes.
- [x] **Step 8: Commit.**

  ```powershell
  git add src/unifiedCheck/repository.ts src/unifiedCheck/worker.ts src/unifiedCheck/productionWorker.ts src/unifiedCheck/productionRuntime.ts src/unifiedCheck/serviceRoleShadowRuntime.ts src/index.ts tests/unified-check/orderedCommit.test.ts tests/unified-check/orderedCommit.postgres.test.ts tests/unified-check/worker.test.ts tests/unified-check/productionWorker.test.ts tests/unified-check/productionRuntime.test.ts tests/unified-check/serviceRoleShadowRuntime.test.ts
  git commit -m "feat: reconcile shadow receipts after checkpoints"
  ```

- [x] **Quality follow-up: bound process memory and the real database wait.**
  Store pending handoff by exact run/task/attempt with only durable precommit
  hashes, refresh one unreferenced attempt timer, expire after twice the worker
  lease, and cap the shadow-only fallback at 512 attempt buckets. The first
  post-durable reconciliation retires the complete matching bucket in `finally`
  for success, cancellation, missing/unapplied/duplicate/unproved authority and
  database failure; Task 7 recovers a durable precommit that no longer has a
  local token. Before every reconciliation authority query, set transaction-
  local lock and statement timeouts to 500 ms. Unit regression covers expiry,
  ceiling, newest-attempt retention and every terminal outcome; a real
  PostgreSQL `ACCESS EXCLUSIVE` lock proves timeout, rollback, pool reuse and no
  later receipt from the retired token inside the 1,000 ms outer deadline.
  Current gates: `95/95` relevant unit tests, `8/8` shadow-runtime PostgreSQL
  and `18/18` ordered-commit PostgreSQL, all without skips; typecheck passes.

### Task 7: Build one deterministic terminal run summary

**Files:** Modify runtime module, production startup/lifecycle wiring, and tests.

- [x] **Step 1: Add failing tests** for final accepted-history inventory replay, sorted group receipt hashes, seven-profile/one-group cardinality, orphan profile/precommit counts, ready and unavailable fences, restart-stable hash, duplicate summary idempotence, and all process failures represented only as `unreconciled`.
- [x] **Step 2: Implement `service-role-shadow-run-summary-v1`.** Load the accepted traversal result after completion, group final visited states by accepted manifest/address/direction/compound binding, rederive bindings from hash-valid pages and the immutable fence, validate reconciled group receipts, and compute `missing`, `conflict`, `malformed`, `eligibleGroup`, `eligibleProfile`, `reconciledGroup`, `reconciledProfile`, `unreconciledGroup`, `profileOrphan`, and `precommitOrphan` counts. `complete` requires a ready fence, at least one reconciled group, and zero missing/conflict/malformed/unreconciled/orphan. Recompute current closure on each publication: unchanged evidence is hash-idempotent, while recovery can append a complete summary after an earlier incomplete immutable snapshot. Real-data admission is checked separately in Task 9 by frozen identities.
- [x] **Step 3: Add one bounded startup recovery sweep outside the finalizer.** `reconcileCommittedServiceRoleShadowRunsV1({ signal })` is called once from enabled runtime startup in `src/index.ts`, never from `productionFinalizer`, and reuses the same strict durable-precommit reconciler as the exact post-commit group. One run-level query unions non-cancelled `QUEUED | COMPLETED` rows with durable group precommits, every non-cancelled `COMPLETED` traversal, and existing summary rows, so a terminal summary does not depend on receipt evidence. A hash-valid complete summary makes that run terminal for later startup sweeps; a hash-valid incomplete summary skips only the unchanged no-precommit publication, while a durable precommit still reopens recovery and can append the later complete summary. Malformed summaries and corrupt or mismatched runtime-receipt bodies cannot suppress recovery. For each precommit candidate it re-reads the committed checkpoint/delta chain and committed planner-entry identities and reconciles only an exact match. The public ceiling is 1,000 ms; enabled startup uses a separate max-one PostgreSQL pool with a native 400 ms acquisition timeout and closes it in `finally`, without changing the authoritative main pool. After acquisition, an internal 700 ms absolute budget, explicit loop/query checks, 150 ms local statement/lock deadlines, and awaited rollback/release keep the whole sweep inside it without background database work. It does not retain a DB lock, poll, delay, or mutate task lifecycle.
- [x] **Step 4: Preserve the evidence boundary during recovery.** Reconstruct a lost process-local token only from an immutable group precommit plus the authoritative non-cancelled commit. Never fabricate a precommit receipt after commit; a profile-only partial write or a group with no durable precommit remains `unreconciled`, but every non-cancelled completed traversal with a reusable fence still gets its terminal incomplete summary. A `CANCELLED` row is never recoverable or summarized even if its checkpoint JSON resembles the candidate. Exactly one valid precommit may match an eligible group; duplicate matches force unreconciled and deterministic extras are precommit orphans. Only fully exact nested profile artifacts count as profile orphans.
- [x] **Step 5: Run tests.** PASS: identical current summary SHA after a new runtime instance; a simulated process loss is recovered once; stale incomplete summary evolves to a distinct complete hash; a receipt from checkpoint attempt 2 remains valid after the same task completes on attempt 3 only through its DB-authored `CHECKPOINTED` history plus current checkpoint/delta authority; future, missing-history and other-task identities remain unreconciled; cancelled, no-precommit, duplicate-precommit, malformed nested profile, corrupt-artifact, cumulative-delay, hanging-sweep, and saturated-acquisition cases fail closed. Relevant unit tests pass `98/98`; the committed Task 7 shadow-runtime plus ordered-commit PostgreSQL files pass `22/22 + 18/18` with zero skips; typecheck and diff check pass.
- [x] **Step 6: Commit.**

  ```powershell
  git add src/unifiedCheck/serviceRoleShadowRuntime.ts tests/unified-check/serviceRoleShadowRuntime.test.ts tests/unified-check/serviceRoleShadowRuntime.postgres.test.ts
  git commit -m "feat: summarize service role shadow runs"
  ```

### Task 8: PostgreSQL authoritative byte non-interference

**Files:** Modify only `tests/unified-check/serviceRoleShadowRuntime.postgres.test.ts`.

- [x] **Step 1: Add a frozen-clock schema harness before applying migrations.** Define schema-local `now()`, `statement_timestamp()`, `transaction_timestamp()`, and `clock_timestamp()` returning `2026-07-31T12:00:00.000Z`; set search path to the test schema before migration SQL is parsed. Inject the same deterministic IDs in disabled/enabled runs.
- [x] **Step 2: Define `authoritativeProjection`.** Canonicalize provider calls/cache decisions and all run/request/task/checkpoint/planner/attempt/final artifact/report/presentation/delivery/Admin-DAG fields, excluding only artifact kinds `service_role_shadow_input_set`, `service_role_shadow_input_fence`, `service_role_shadow_profile`, `service_role_shadow_precommit_receipt`, `service_role_shadow_runtime_receipt`, and `service_role_shadow_run_summary`.
- [x] **Step 3: Run identical deterministic tapes** in isolated disabled and enabled schemas with the same complete V2 map. Assert projection bytes equal, provider calls do not increase, shadow hashes occur in no attempt/final hash, and enabled alone has one ready fence, seven profiles, one compound-group precommit, one reconciled runtime receipt, and one summary. Repeat with a held preload lock and hanging post-commit callback to prove both deadlines release and authoritative bytes still match.
- [x] **Step 4: Run the dedicated gate.**

  ```powershell
  if (-not $env:TEST_DATABASE_URL) { throw "TEST_DATABASE_URL is required" }
  $env:UNIFIED_RELEASE_GATE_MODE="1"
  npm test -- tests/unified-check/serviceRoleShadowRuntime.postgres.test.ts tests/storage/unifiedCheck.postgres.test.ts tests/unified-check/productionFinalizer.postgres.test.ts
  ```

  Expected: three files execute, all tests pass, skipped count is zero; existing finalizer equality remains unchanged without editing finalizer code.
- [x] **Step 5: Commit.** Landed in `006a30b6`; timeout and historical-attempt correctness follow-ups landed through `90f4b428`.

  ```powershell
  git add tests/unified-check/serviceRoleShadowRuntime.postgres.test.ts
  git commit -m "test: prove service role shadow noninterference"
  ```

### Task 9: Commit and test the acceptance producer before using it

**Files:** Create `scripts/replayServiceRoleShadowRuntimeAcceptance.ts`, `tests/scripts/replayServiceRoleShadowRuntimeAcceptance.test.ts`; modify `src/unifiedCheck/serviceRoleShadowRuntime.ts`, remove the unreliable `unref()` from the existing one-second observer deadline in `src/unifiedCheck/productionTraversalCoordinator.ts`, extend `tests/unified-check/serviceRoleShadowRuntime.postgres.test.ts` for malformed-summary recovery, this corrected plan, and the six knowledge pages listed in File map. The PostgreSQL deadline/recovery regressions are the runnable checks for these bounded corrections. Do not create or stage `docs/audit/2026-07-stage-c/c1/**` in this task.

- [x] **Step 1: Re-run the existing corpus gate.**

  Run: `npm test -- tests/forensics/serviceRoleShadowGate.test.ts tests/unified-check/serviceRoleShadowPrerequisites.test.ts`

  Expected: PASS with legacy service `24/24`, adverse `6/6`, and the existing fully role-bound real-history prerequisite unchanged.

- [x] **Step 2: Define the self-contained replay and acceptance contracts.** `ServiceRoleShadowRuntimeReplayInputV1` binds the source run/manifest/snapshot/anchor, observed failed/cancelled source statuses and source runtime commit, the one accepted address-history planner entry/attempt, sorted seven qualifying traversal-state IDs, target `testedSourceCommit`, and `productionEffect:false`. Its sorted `sourceArtifacts` array embeds `{ kind, schemaVersion, sha256, artifactJson }` for the source analysis manifest, source compaction, accepted history manifest/pages, source V2/source-map/bundle, and exactly the null-rooted traversal-delta prefix through the uniquely selected target delta. Later source deltas are deliberately omitted: they are not replay inputs. A separate `observedTraversalCheckpoint:{ sha256, checkpointJson }` embeds and re-hashes the exact final task-row checkpoint because checkpoint JSON is not a Unified artifact. It proves the recorded failed/cancelled lifecycle identity and compaction binding only; it does not claim or prove final-head-to-target ancestry. `sourceFrozenLabelDataset:{ sha256, datasetJson }` embeds and re-hashes the exact immutable dataset named by the source analysis manifest. The owning serializer recomputes every SHA from the embedded canonical JSON.

  `ServiceRoleShadowRuntimeReplayIdentityV1` embeds the replay-input SHA, creates distinct replay run/request/traversal IDs plus deterministic replay-local direct-history task/attempt IDs, and maps exactly one source accepted planner entry to exactly one replay entry. The final cancelled task-row checkpoint is not the predecessor of that already committed planner entry and is not used to select the target. The parser instead requires the embedded delta inventory itself to be one complete null-rooted chain ending at exactly one target whose sorted `addedVisited` and `removedFrontierStateIds` equal the seven qualifying state IDs, replays the exact source compaction plus prefix deltas through that target's previous hash, and derives one explicit `sourceTargetDeltaSha256` and `derivedSourcePredecessorCheckpoint`. The derived checkpoint contains that exact previous delta head, replay-derived counters/operational inventory, and an empty replay diagnostic window; it is code-derived replay authority, not a claim that PostgreSQL persisted a historical checkpoint body. Every source delta body/hash remains byte-identical, and the runtime's newly produced candidate delta must equal `sourceTargetDeltaSha256`.

  The analysis manifest and traversal compaction/checkpoint are run-bound. Therefore `translatedTraversalAuthority` embeds the replay analysis manifest, replay-bound compaction, and replay predecessor checkpoint. The replay analysis parser permits only `runId`, `runtimeCommit`, and `databaseSchemaVersion` to change from the embedded source manifest; it reuses the exact source frozen-label dataset/hash and every forensic/traversal policy field. The compaction/checkpoint parser permits only their `analysisManifestHash` fields and the consequent checkpoint `compactionSha256` to change from the derived source predecessor; its delta head/counters/operational inventory and every other field remain identical. Accepted address-history pages are also not run-neutral: `UnifiedAddressHistoryPageArtifactV1.runId` is checked against the owning run and one artifact row cannot belong to two runs. Therefore `translatedAcceptedHistory` embeds deterministic replay-bound page bodies/hashes plus the consequent rebuilt manifest body/hash. The parser permits only each page `runId`, the consequent page hashes in the manifest, and the mapped accepted planner entry's consequent manifest hash to change; provider-page hashes, raw rows, canonical events, manifest key, snapshot, address, provider version, event inventory, counts, exhaustion, and every other field must remain identical. This narrow translation is the only accepted-history rewrite allowed; importing source page bytes directly into the distinct replay run or changing any semantic history byte is rejected. Existing role bundle/map/wrapper bodies likewise cannot be reused as runtime inputs because their contracts bind `runId`; `translatedShadowInputs` embeds the deterministic replay-bound bundle, V1 map, and V2 wrapper bodies/hashes. Its parser permits only the replay `runId`, new bundle/map reference hashes, and consequent wrapper hash to change; sampled event IDs, roles, evidence rows, snapshot, manifest key, anchor, coverage, and policy must remain identical. Translated accepted-history artifacts are authoritative only for the isolated replay's accepted address-history attempt; translated shadow inputs remain standalone and are never accepted-attempt or production-authority artifacts. Neither contract may call the failed source run successful.

  Define `ServiceRoleShadowC1AcceptanceV1` as one transitive root. It embeds, rather than merely references:

  - the complete canonical `replayInput` and `replayIdentity` bodies plus their recomputed hashes;
  - disabled and enabled authoritative projection JSON values plus their recomputed hashes;
  - the sorted enabled `runtimeArtifacts` array with exact `{ kind, schemaVersion, sha256, artifactJson }` values for one input set, one fence, seven profiles, one group precommit, and one runtime receipt; the isolated real-history replay deliberately has no terminal summary because inferred roles do not stop traversal and its newly discovered provider work is not executed;
  - exact provider-call/reference counters, cardinalities, `testedSourceCommit`, and `productionEffect:false`.

  Export `parseServiceRoleShadowC1AcceptanceV1(value: unknown)` and `serializeServiceRoleShadowC1AcceptanceV1(value)` from `serviceRoleShadowRuntime.ts`. These are exact-key, side-effect-free owning APIs. Serialization is `canonicalizeArtifactJson` with no added LF. The one-argument parser recomputes every embedded hash, validates the replay-input/identity relation and exact role-input translation, validates the full translated wrapper → fence → input-set → seven profiles → one precommit → one runtime receipt reference closure, and resolves the runtime receipt's committed checkpoint/delta references against the exact replay task and authoritative artifacts inside the embedded enabled projection. It requires the traversal to remain non-terminal `QUEUED` after that durable checkpoint, requires the consequent next address-history provider task/planner discovery in both projections, and requires zero run summaries rather than pretending that inferred service role stopped traversal. It compares disabled/enabled authoritative projection bytes, recursively proves that neither projection references a shadow hash, and requires zero provider calls. It accepts no resolver, file path, database handle, or optional sibling evidence. Task 7 plus Task 8 remain the executable proof that genuinely completed runs publish the deterministic terminal summary; this real-history one-group admission proves the group runtime path only.

- [x] **Step 3: Implement and test a strict four-command CLI.** `prepare` accepts only `--run`, `--manifest`, `--anchor`, `--tested-source-commit`, exclusive `--output-root`, and `--confirm`. `verify-input` accepts only `--input` and `--identity`. `replay` accepts only `--input`, `--identity`, exclusive `--output`, and `--confirm`. `verify-acceptance` accepts only `--acceptance` and calls the same one-argument owning parser. Commands that query or mutate PostgreSQL require `DATABASE_URL`; every unknown, duplicate, missing, symlinked, malformed-UTF-8, or existing output is rejected before DB mutation. The secure reader uses one explicit 512 MiB ceiling: the real self-contained root repeats about 71 MiB of delta bodies and 6 MiB of accepted pages across its embedded input and two projections, so the former 32 MiB limit could not read its own output; larger files still fail before allocation. The two verify commands emit canonical one-line JSON; both expose `testedSourceCommit`, `replayInputSha256`, and `replayIdentitySha256`, while acceptance verification additionally exposes its root SHA.

  Add git-state enforcement inside the producer. Resolve the repository containing the running script, reject a script outside that root, and verify with `git ls-tree` that the producer, owning parser module, runtime seam, and named tests are tracked at `testedSourceCommit`. `prepare` requires `HEAD === testedSourceCommit` and an entirely clean worktree/index including untracked files. `verify-input` and `replay` require the same `HEAD` and allow only the exact untracked C1 input/identity paths whose bytes match their arguments; `verify-acceptance` reads only its one root and performs no Git, filesystem-neighbor, or DB resolution. A 40/64-character lowercase commit string that is not the current clean `HEAD` is rejected. Unit-test the pure Git-state guard with an injected command runner; the first real `prepare` invocation occurs only after the Task 9 commit.

  Run: `npm test -- tests/scripts/replayServiceRoleShadowRuntimeAcceptance.test.ts tests/unified-check/serviceRoleShadowRuntime.test.ts`

  Expected: PASS for exact-key parsing, missing/altered embedded source and runtime artifacts, source page reuse without replay translation, accepted-history rewrite beyond page `runId` and consequent hashes, wrong/ambiguous target-delta selection, derived-predecessor counter/state drift, source checkpoint/compaction reuse without the required replay translation, analysis/checkpoint/compaction rewrite beyond the explicit narrow fields, source role-map reuse without run translation, changed sampled roles during translation, broken reference closure, extra keys, unequal embedded projections, shadow-hash leakage, non-seven-state input, dirty/staged/wrong-HEAD rejection, exact allowlist behavior, path containment, source-status mismatch, source-data absence, existing-schema/output refusal, and canonical receipt bytes. Copy only the acceptance root into an empty temporary directory with no database and prove `parseServiceRoleShadowC1AcceptanceV1(JSON.parse(bytes))` succeeds there; deleting the separate replay input/identity files must not matter.

- [x] **Step 4: Update knowledge truth before admission.** Record the implemented strict disabled flag, immutable fence, standalone artifacts, group cardinality, proved ordered checkpoint requirement, bounded post-commit/startup recovery, isolated one-group acceptance mechanism, one-root C6 parser contract, and no provider/finalizer/Admin/score effect. State explicitly that the isolated real-history replay stops after the reconciled checkpoint with consequent provider work still planned and therefore has zero terminal summaries; completed-run summary behavior remains separately covered by Tasks 7-8. Real-history admission is still pending Task 10; do not invent receipt hashes or close the admission blocker yet.

- [x] **Step 5: Run focused, PostgreSQL, and full gates on the producer code.**

  ```powershell
  npm test -- tests/config/config.test.ts tests/unified-check/serviceRoleShadow.test.ts tests/unified-check/serviceRoleMapMaterialization.test.ts tests/unified-check/productionTraversalCoordinator.test.ts tests/unified-check/orderedCommit.test.ts tests/unified-check/worker.test.ts tests/unified-check/productionWorker.test.ts tests/unified-check/productionRuntime.test.ts tests/unified-check/serviceRoleShadowRuntime.test.ts tests/scripts/replayServiceRoleShadowRuntimeAcceptance.test.ts
  npm run typecheck
  if (-not $env:TEST_DATABASE_URL) { throw "TEST_DATABASE_URL is required" }
  $env:UNIFIED_RELEASE_GATE_MODE="1"
  npm test -- tests/unified-check/orderedCommit.postgres.test.ts tests/unified-check/serviceRoleShadowRuntime.postgres.test.ts tests/storage/unifiedCheck.postgres.test.ts tests/unified-check/productionFinalizer.postgres.test.ts tests/scripts/replayServiceRoleShadowRuntimeAcceptance.test.ts
  npm test
  git diff --check
  git diff --name-only
  ```

  Expected: all named PostgreSQL files execute with zero skips, the full suite exits 0 with no new skip, diff check is empty, and changed names contain only the Task 9 producer/parser/tests, the one-line coordinator deadline correction, this corrected plan, and the six knowledge pages—no audit output, migration, finalizer, Admin, risk/scoring, report, presentation, delivery, or Stage D file. Task 9 compares exact raw schema-037 rows; Task 8 remains the separate full Admin-DAG non-interference proof.

- [x] **Step 6: Commit the tested producer, parser, tests, and preliminary knowledge truth.**

  ```powershell
  git add scripts/replayServiceRoleShadowRuntimeAcceptance.ts tests/scripts/replayServiceRoleShadowRuntimeAcceptance.test.ts tests/unified-check/serviceRoleShadowRuntime.postgres.test.ts src/unifiedCheck/serviceRoleShadowRuntime.ts src/unifiedCheck/productionTraversalCoordinator.ts docs/superpowers/plans/2026-07-31-stage-c1-runtime-accepted-history-shadow.md docs/knowledge/02-check-modes.md docs/knowledge/03-job-lifecycle.md docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/14-current-roadmap.md
  git commit -m "feat: add Stage C1 acceptance replay"
  if (git status --porcelain) { throw "tested source worktree must be clean" }
  $testedSourceCommit=(git rev-parse HEAD).Trim()
  npm test -- tests/scripts/replayServiceRoleShadowRuntimeAcceptance.test.ts tests/unified-check/serviceRoleShadowRuntime.test.ts tests/forensics/serviceRoleShadowGate.test.ts
  npm run typecheck
  if ((git rev-parse HEAD).Trim() -ne $testedSourceCommit -or (git status --porcelain)) { throw "post-commit producer verification changed tested source" }
  ```

  Expected: commit and post-commit checks succeed, no C1 audit evidence exists or is staged, the worktree/index remains clean, and `$testedSourceCommit` is the exact clean commit containing every producer/parser byte and passing test used by Task 10.

### Task 10: Generate and commit C1 evidence from the clean tested source

**Files:** Create only `docs/audit/2026-07-stage-c/c1/runtime-shadow-replay-input-v1.json`, `runtime-shadow-replay-identity-v1.json`, and `runtime-shadow-acceptance-v1.json`; update only the six knowledge pages listed in File map with final receipt hashes/admission status. Production code, producer code, and tests are frozen at `testedSourceCommit` throughout this task.

- [ ] **Step 1: Establish the clean source boundary.** Begin immediately on Task 9's commit, before any other commit.

  ```powershell
  if (git status --porcelain) { throw "evidence generation requires a clean worktree" }
  $testedSourceCommit=(git rev-parse HEAD).Trim()
  ```

  Expected: `HEAD` is the clean Task 9 producer commit. Record it in all three generated bodies. Abort on any code/test/tooling change, detached alternate worktree content, staged path, or intervening commit.

- [ ] **Step 2: Materialize the V2 wrapper twice in a disposable proof schema.** Point `DATABASE_URL` at a UUID-suffixed schema-037 copy containing the frozen run's byte-identical accepted artifacts and authoritative rows. The original frozen database/run remains read-only; only the disposable copy receives the additive standalone wrapper.

  ```powershell
  node --import tsx scripts/materializeServiceRoleEventMap.ts materialize --confirm --run 5417cbf6-7cef-4b91-8367-d266eaf3857e --manifest 08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0 --anchor 2026-06-04T09:20:33.000Z
  node --import tsx scripts/materializeServiceRoleEventMap.ts materialize --confirm --run 5417cbf6-7cef-4b91-8367-d266eaf3857e --manifest 08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0 --anchor 2026-06-04T09:20:33.000Z
  ```

  Expected: both exit 0; the wrapper hash is identical, no V1/V2/bundle hash is referenced by an accepted attempt, and before/after source projections prove the original source run/database was not mutated.

- [ ] **Step 3: Prepare and review the isolated source-to-replay baseline.** `prepare` reads original source authority plus the deterministically derived wrapper from the disposable proof schema. It selects only the one fully role-bound accepted address/direction group, embeds its exact canonical source artifacts and predecessor delta chain, and never mutates, resumes, or clones the failed source run or its 888-entry graph.

  ```powershell
  node --import tsx scripts/replayServiceRoleShadowRuntimeAcceptance.ts prepare --run 5417cbf6-7cef-4b91-8367-d266eaf3857e --manifest 08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0 --anchor 2026-06-04T09:20:33.000Z --tested-source-commit $testedSourceCommit --output-root docs/audit/2026-07-stage-c/c1 --confirm
  $inputProof=(node --import tsx scripts/replayServiceRoleShadowRuntimeAcceptance.ts verify-input --input docs/audit/2026-07-stage-c/c1/runtime-shadow-replay-input-v1.json --identity docs/audit/2026-07-stage-c/c1/runtime-shadow-replay-identity-v1.json | ConvertFrom-Json)
  ```

  Expected: both exit 0. Git still has `HEAD === testedSourceCommit`; the only porcelain entries are the two exact untracked C1 input files. Both bodies bind `testedSourceCommit`, distinguish failed/cancelled `sourceRunId` from the new replay identity, contain seven states, one planner entry, the exact observed final source checkpoint, the uniquely selected target delta, and the strictly derived/translated replay predecessor authority. The derived predecessor is visibly code-derived from immutable source deltas and is never described as a persisted historical checkpoint or synthetic data fixture. Inspect both canonical files before continuing.

- [ ] **Step 4: Execute the disabled/enabled one-group replay and publish one self-contained root.** In two UUID-suffixed disposable schema-037 databases, create the same new replay identity under `testedSourceCommit`. Import the identity contract's strictly validated replay-bound address-history pages and consequent rebuilt manifest, the exact source frozen-label dataset, and only the run-neutral predecessor delta prefix reachable through the derived predecessor head plus the strictly translated replay-bound checkpoint/compaction authority. Insert only the identity contract's strictly validated replay-bound role bundle/map/V2 wrapper as new standalone shadow inputs. Accepted-history translation may change only page `runId` and consequent page/manifest/accepted-entry hashes. Analysis translation may change only replay `runId`, current `runtimeCommit`, and schema version; traversal-authority translation may change only the compaction/checkpoint `analysisManifestHash` fields and the consequent checkpoint `compactionSha256`. No source frozen-label, delta, or other semantic history/checkpoint/compaction byte may change, and the produced candidate delta must equal the source target delta byte-for-byte. Via existing repository APIs create one accepted address-history attempt/planner entry bound to that translated manifest and one traversal task. The current production traversal loader also requires completed direct-history authority; create one deterministic replay-local empty direct-history task/attempt/artifact prerequisite without executing a provider worker. Include this transparent prerequisite in both authoritative projections and never delete it before projection or publication. Do not copy any source provider task, source lifecycle status, the 888-entry graph, or the cancelled source traversal row; provider adapters are fail-fast spies and provider-call/reference counts remain zero.

  Run exactly the normal coordinator/worker checkpoint lifecycle in both schemas. Disabled has no C1 hook. Enabled applies the one real group, commits the exact ordered entry/delta, produces seven profiles and one group receipt, and reconciles one runtime receipt after the durable checkpoint. The accepted group legitimately generates a next frontier and one consequent provider task; retain that real `QUEUED` traversal plus planned provider work in both projections, do not execute a provider worker, do not run a second analysis cycle, and do not create a terminal traversal result or run summary. Before dropping only those two exact schemas in `finally`, embed both authoritative projections and the complete sorted runtime-artifact closure in the acceptance root.

  ```powershell
  node --import tsx scripts/replayServiceRoleShadowRuntimeAcceptance.ts replay --input docs/audit/2026-07-stage-c/c1/runtime-shadow-replay-input-v1.json --identity docs/audit/2026-07-stage-c/c1/runtime-shadow-replay-identity-v1.json --output docs/audit/2026-07-stage-c/c1/runtime-shadow-acceptance-v1.json --confirm
  node --import tsx scripts/replayServiceRoleShadowRuntimeAcceptance.ts verify-acceptance --acceptance docs/audit/2026-07-stage-c/c1/runtime-shadow-acceptance-v1.json
  ```

  Expected: both exit 0. The root embeds byte-identical copies of the two reviewed bodies, all required source/runtime/projection bodies, and their recomputed hashes; it records seven profiles, one precommit, one runtime receipt, zero summaries, the same retained next provider task in both projections, equal authoritative projection bytes, zero provider-call/reference delta, and no authoritative reference to any shadow hash. Verification uses only the acceptance file and the one-argument parser; it succeeds after disposable schemas are gone and never reads sibling files. The result describes an isolated one-group checkpoint replay, never a resumption, inferred-role boundary stop, or successful whole-run replay.

- [ ] **Step 5: Re-verify the three-file evidence set and C6 handoff before editing docs.** At this point the Git-state guard still sees only the exact three untracked C1 audit files. Reuse the already validated `$inputProof` from Step 3, run the one-root parser again, compare its embedded replay hashes and commit to that proof, and re-run the legacy corpus gate. Do not invoke `verify-input` again after the acceptance root exists: its strict Git-state allowlist intentionally admits only the two review files.

  ```powershell
  $acceptanceProof=(node --import tsx scripts/replayServiceRoleShadowRuntimeAcceptance.ts verify-acceptance --acceptance docs/audit/2026-07-stage-c/c1/runtime-shadow-acceptance-v1.json | ConvertFrom-Json)
  if ($inputProof.testedSourceCommit -ne $acceptanceProof.testedSourceCommit -or $inputProof.replayInputSha256 -ne $acceptanceProof.replayInputSha256 -or $inputProof.replayIdentitySha256 -ne $acceptanceProof.replayIdentitySha256) { throw "review files differ from embedded C1 root" }
  npm test -- tests/forensics/serviceRoleShadowGate.test.ts tests/unified-check/serviceRoleShadowPrerequisites.test.ts
  git status --short
  ```

  Expected: verification and corpus pass; the only porcelain entries are the three C1 audit files. C6 consumes only `runtime-shadow-acceptance-v1.json` via `parseServiceRoleShadowC1AcceptanceV1(value)`; it does not resolve the two review files, query replay schemas, or trust caller-supplied counts/hashes.

- [ ] **Step 6: Update final knowledge truth without changing tested code.** Record the three generated SHA-256 values, exact `testedSourceCommit`, self-contained C1 root path/parser, isolated replay result, and remaining C2-C6 blockers. Close only the C1 runtime/admission blocker. Do not edit producer, parser, tests, or production files after evidence generation. Run `git diff --check`, then require the only changed paths to be the three C1 audit files and six knowledge pages before staging.

- [ ] **Step 7: Commit only allowlisted evidence as the direct child of `testedSourceCommit`.**

  ```powershell
  git add docs/audit/2026-07-stage-c/c1/runtime-shadow-replay-input-v1.json docs/audit/2026-07-stage-c/c1/runtime-shadow-replay-identity-v1.json docs/audit/2026-07-stage-c/c1/runtime-shadow-acceptance-v1.json docs/knowledge/02-check-modes.md docs/knowledge/03-job-lifecycle.md docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/14-current-roadmap.md
  $expected=@("docs/audit/2026-07-stage-c/c1/runtime-shadow-acceptance-v1.json","docs/audit/2026-07-stage-c/c1/runtime-shadow-replay-identity-v1.json","docs/audit/2026-07-stage-c/c1/runtime-shadow-replay-input-v1.json","docs/knowledge/02-check-modes.md","docs/knowledge/03-job-lifecycle.md","docs/knowledge/04-data-sources-tronscan-indexing.md","docs/knowledge/09-current-decisions.md","docs/knowledge/10-open-problems.md","docs/knowledge/14-current-roadmap.md") | Sort-Object
  $staged=@(git diff --cached --name-only | Sort-Object)
  if (Compare-Object $expected $staged) { throw "unexpected C1 evidence path" }
  $porcelain=@(git status --porcelain=v1)
  $changed=@($porcelain | ForEach-Object { $_.Substring(3) } | Sort-Object)
  if (Compare-Object $expected $changed) { throw "unexpected staged or unstaged C1 path" }
  if ($porcelain | Where-Object { $_.Substring(0,1) -eq " " -or $_.Substring(1,1) -ne " " }) { throw "C1 evidence is not fully staged" }
  git commit -m "docs: record Stage C1 runtime shadow evidence"
  $evidenceCommit=(git rev-parse HEAD).Trim()
  $evidenceParent=(git rev-parse HEAD^).Trim()
  if ($evidenceParent -ne $testedSourceCommit) { throw "C1 evidence is not a direct child of tested source" }
  if (git status --porcelain) { throw "C1 evidence commit left a dirty worktree" }
  ```

  Expected: the commit succeeds, its parent is exactly the receipt's embedded `testedSourceCommit`, its diff is limited to the nine allowlisted paths, and the worktree is clean. For the later C6 handoff, locate the commit that last changed the acceptance root, require its parent to equal the embedded tested-source commit, verify that commit's path allowlist, then call the one-argument C1 parser. C1 is complete; C2-C6 remain separate gated plans and Stage D remains unauthorized.
