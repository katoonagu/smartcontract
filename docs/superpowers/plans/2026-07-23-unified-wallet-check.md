# Unified Wallet Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace user-facing Fast/Where/Deep delivery with one parent-owned, snapshot-pinned Unified Wallet Check that completes all evidence branches, produces one coverage-independent score and dossier, and sends one request-scoped Telegram result.

**Architecture:** Add a durable `CheckRequest`/`UnifiedCheckRun` state machine and immutable artifact chain alongside legacy jobs. Stateless chunk workers share a pinned direct-history index and fair provider scheduler, then normalize evidence, prove traversal closure, score through matrix v4, render one locale-specific presentation, and deliver through an auditable state machine. A generation fence cuts new requests over only after the Golden comparator, replay, Telegram acceptance, migration, and canary gates pass.

**Tech Stack:** TypeScript 5.7, Node.js 22, PostgreSQL with tracked migration 033, existing `pg`/`grammy`/`tronweb`/TronScan clients, Vitest 4, SHA-256 canonical JSON. No new dependency.

---

## Source of Truth, Ordering and Scope

Implement against:

- `docs/superpowers/specs/2026-07-23-unified-wallet-check-golden-pilot-v2-design.md`;
- reviewed design commit `73e65aa6`;
- locked artifacts produced by
  `docs/superpowers/plans/2026-07-23-tron-usdt-golden-pilot-v2.md`.

The current code remains legacy until the rollout fence:

- `forensic_check_jobs` owns separate Fast/Deep/Where/Incoming jobs;
- `src/risk/unifiedWalletRisk.ts` can return `NO_FINAL_DECISION` and has a
  limited-coverage floor;
- `ScoreAnchorV2` is matrix-v3-only and contains `coverageDependency`;
- `runForensicJobBatch` is sequential;
- Deep/Where can create independent Telegram delivery.

Do not mutate those contracts in place before the fence. Build Unified beside
them, prove it, then route new `/check` requests to it. Incoming-deposit checks
remain outside this wallet-check cutover.

### Dependency on Golden V2

Tasks 1–8 may execute after Golden Task 3 locks schemas. Tasks 9–14 may be
implemented against synthetic fixtures, but Task 11 generation and the final
comparator/Telegram expectations require the locked Golden manifest from Golden
Task 8.

### Delivery milestones

```text
B0 minimal vertical slice
  request → run → synthetic branches → neutral score → report artifact

B1 durable data plane
  snapshot → shared index → fair scheduler → chunk workers

B2 forensic/scoring plane
  branch evidence → finite traversal → canonical facts → attribution → matrix v4

B3 presentation plane
  report → semantic compression → request-scoped delivery → Admin/watchdog

B4 release plane
  comparator → rollout fence → isolated canary → release receipts
```

## File Responsibility Map

### New Unified production modules

| File | Responsibility |
|---|---|
| `src/unifiedCheck/contracts.ts` | Run/request/task/artifact/delivery/report types |
| `src/unifiedCheck/stateMachine.ts` | Pure parent, branch and delivery transitions |
| `src/unifiedCheck/repository.ts` | Migration-033 persistence and immutable artifact writes |
| `src/unifiedCheck/requestService.ts` | Request correlation, snapshot-key reuse and recipients |
| `src/unifiedCheck/orchestrator.ts` | DAG readiness and `FINALIZING` transaction |
| `src/unifiedCheck/worker.ts` | Lease/heartbeat/checkpoint/cancellation chunk cycle |
| `src/unifiedCheck/snapshot.ts` | Confirmed cutoff and `AnalysisManifest` |
| `src/unifiedCheck/providerRequest.ts` | Canonical request identity and coalesced page cache |
| `src/unifiedCheck/directHistory.ts` | Snapshot-bounded direct USDT index prerequisite |
| `src/unifiedCheck/branchAdapters.ts` | Fast/Where/Deep evidence adapters without delivery authority |
| `src/unifiedCheck/traversal.ts` | Bidirectional amount/temporal traversal and closure certificate |
| `src/unifiedCheck/canonicalFacts.ts` | Cross-branch fact keys, dedup and conflicts |
| `src/unifiedCheck/report.ts` | `UnifiedWalletReport` and reconciled dossier aggregates |
| `src/unifiedCheck/presentation.ts` | RU/EN one-message renderer and completeness receipt |
| `src/unifiedCheck/delivery.ts` | Request-scoped delivery with `DELIVERY_UNKNOWN` |
| `src/unifiedCheck/watchdog.ts` | Waiting/blocked/stale-run diagnostics and explicit recovery |
| `src/unifiedCheck/rolloutFence.ts` | Legacy/Unified generation ownership |
| `src/unifiedCheck/comparator.ts` | Production-importing Golden comparator |
| `src/unifiedCheck/canary.ts` | Isolated eight-wallet release canary |

### New scoring modules

| File | Responsibility |
|---|---|
| `src/risk/scoringSignalMatrixV4.ts` | Coverage-independent canonical-candidate scoring |
| `src/risk/scoreAnchorV3.ts` | Matrix-v4 anchor; V2 remains readable |
| `src/risk/scoringPolicyV4.generated.ts` | Generated adjudicated values and Golden hash |
| `src/unifiedCheck/selectedAttributionPolicy.generated.ts` | Generated selected policy and Golden hash |
| `scripts/generateUnifiedGoldenBindings.ts` | Generate both committed bindings from locked Golden |

### Storage and runtime changes

| File | Change |
|---|---|
| `migrations/033_unified_wallet_check.sql` | Unified tables, constraints, indexes and immutability trigger |
| `src/storage/schemaMigrations.ts` | Require and verify tracked schema 033 |
| `src/runtime/startupSchemaGate.ts` | Return schema-033 verification |
| `src/runtime/startupSchedule.ts` | Add Unified worker/watchdog/delivery schedules |
| `src/runtime/forensicRuntimeOrchestration.ts` | Keep legacy orchestration isolated by generation |
| `src/tron/tronscanScheduler.ts` | Fair lanes, per-key state and exact-request coalescing |
| `src/forensics/telegramDelivery.ts` | Re-export shared canonical JSON without changing V1 hashes |
| `src/index.ts` | Wire Unified services only after schema gate/fence |
| `src/bot/createBot.ts` | Route wallet `/check` to `CheckRequest`; remove preliminary child delivery after fence |
| `src/admin/adminServer.ts` | Unified run/task/artifact/watchdog endpoints |
| `src/admin/forensicsGraph.ts` | Project parent DAG and closure/hash state |
| `src/admin/adminConsole.ts` | Show parent/branch/provider/delivery state and recovery actions |
| `package.json` | Add binding, comparator and canary commands |

### Primary new tests

All focused tests live under `tests/unified-check/`; PostgreSQL tests additionally
use `tests/storage/unifiedCheck.postgres.test.ts` and
`tests/storage/migration033.postgres.test.ts`.

## Milestone B0: Minimal Vertical Slice

### Task 1: Define contracts and pure lifecycle transitions

**Files:**

- Create: `src/unifiedCheck/contracts.ts`
- Create: `src/unifiedCheck/stateMachine.ts`
- Create: `tests/unified-check/stateMachine.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Create `tests/unified-check/stateMachine.test.ts` with table-driven transitions:

```ts
import { describe, expect, it } from "vitest";
import {
  transitionBranch,
  transitionDelivery,
  transitionRun
} from "../../src/unifiedCheck/stateMachine";

describe("Unified Check lifecycle", () => {
  it.each([
    ["RUNNING", "provider_wait", "WAITING_FOR_PROVIDER"],
    ["WAITING_FOR_PROVIDER", "provider_ready", "RUNNING"],
    ["RUNNING", "admin_block", "BLOCKED_ADMIN"],
    ["BLOCKED_ADMIN", "admin_resume", "RUNNING"],
    ["RUNNING", "begin_finalizing", "FINALIZING"],
    ["FINALIZING", "commit_completed", "COMPLETED"],
    ["RUNNING", "fail_technical", "FAILED_TECHNICAL"]
  ] as const)("%s + %s -> %s", (from, event, expected) => {
    expect(transitionRun(from, event)).toBe(expected);
  });

  it("rejects a completed run without the final artifact set", () => {
    expect(() => transitionRun("FINALIZING", "commit_completed", {
      finalScore: null,
      reportHash: null,
      traversalClosureHash: null
    })).toThrow("unified_completion_contract_invalid");
  });

  it("keeps ambiguous delivery terminal for automatic sending", () => {
    expect(transitionDelivery("LEASED", "transport_ambiguous")).toBe("DELIVERY_UNKNOWN");
    expect(() => transitionDelivery("DELIVERY_UNKNOWN", "automatic_retry"))
      .toThrow("unified_delivery_unknown_manual_only");
  });
});
```

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/unified-check/stateMachine.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Define exact enums and immutable contracts**

`contracts.ts` defines:

```ts
export type UnifiedRunStatus =
  | "RUNNING"
  | "WAITING_FOR_PROVIDER"
  | "BLOCKED_ADMIN"
  | "FINALIZING"
  | "COMPLETED"
  | "FAILED_TECHNICAL";

export type UnifiedBranchStatus =
  | "RUNNING"
  | "COMPLETED"
  | "NOT_APPLICABLE"
  | "WAITING_RETRY"
  | "BLOCKED_ADMIN"
  | "FAILED_TECHNICAL";

export type UnifiedRunPurpose =
  | "user_check"
  | "admin_diagnostic"
  | "release_canary"
  | "synthetic_test"
  | "maintenance";

export type UnifiedSideEffectPolicy = "authoritative" | "isolated";

export type UnifiedDeliveryStatus =
  | "PENDING"
  | "LEASED"
  | "RETRYABLE"
  | "SENT_CONFIRMED"
  | "DELIVERY_UNKNOWN"
  | "BLOCKED_ADMIN"
  | "CANCELLED";
```

Also define versioned `CheckRequestV1`, `AnalysisManifestV1`,
`ChildAttemptArtifactV1`, `EvidenceBundleV1`,
`TraversalClosureCertificateV1`, `ScoringBundleV1`,
`UnifiedWalletReportV1`, `PresentationArtifactV1`,
`PresentationCompletenessReceiptV1`, and `DeliveryIntentV1`. Every artifact has
`version`, `schemaVersion`, and referenced hashes; orchestration-only lease and
recipient fields are excluded from forensic artifacts.

- [ ] **Step 4: Implement closed transition tables**

Use readonly transition maps. Illegal transitions throw a stable code. A reason
such as `provider_cooldown` is stored separately and never accepted where a
state is expected. `COMPLETED`/`FAILED_TECHNICAL` are terminal; only manual
delivery operations may leave `DELIVERY_UNKNOWN`.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/unified-check/stateMachine.test.ts
npm run typecheck
git add src/unifiedCheck/contracts.ts src/unifiedCheck/stateMachine.ts tests/unified-check/stateMachine.test.ts
git commit -m "feat(unified-check): define lifecycle contracts"
```

### Task 2: Add migration 033, structure verification and repository

**Files:**

- Create: `migrations/033_unified_wallet_check.sql`
- Create: `src/unifiedCheck/repository.ts`
- Create: `tests/storage/migration033.postgres.test.ts`
- Create: `tests/storage/unifiedCheck.postgres.test.ts`
- Modify: `src/storage/schemaMigrations.ts`
- Modify: `src/runtime/startupSchemaGate.ts`

- [ ] **Step 1: Write failing migration and repository tests**

Use a disposable PostgreSQL database. Assert:

- required receipt is version 33 and bound to exact migration bytes;
- all tables/constraints/indexes below exist;
- one `request_correlation_id` creates one request;
- exact analysis key reuses only a non-failed run;
- immutable artifact update/delete raises
  `unified_immutable_artifact_mutation`;
- two workers cannot lease one task;
- accepted attempt selection never rewrites an attempt;
- delivery uniqueness includes request, chat, thread and presentation hash.

- [ ] **Step 2: Run and verify RED**

```powershell
$env:TEST_DATABASE_URL = $env:PLAN3_TEST_DATABASE_URL
npm test -- tests/storage/migration033.postgres.test.ts tests/storage/unifiedCheck.postgres.test.ts
```

Expected: FAIL because migration 033 and repository are absent.

- [ ] **Step 3: Create the exact schema**

Migration 033 creates:

```sql
create table unified_check_runs (
  id text primary key,
  analysis_key_sha256 text not null,
  subject_address text not null,
  status text not null,
  status_reason text,
  run_purpose text not null,
  side_effect_policy text not null,
  analysis_manifest_sha256 text not null,
  final_score integer,
  final_decision text,
  evidence_bundle_sha256 text,
  traversal_closure_sha256 text,
  scoring_bundle_sha256 text,
  report_sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (status in (
    'RUNNING','WAITING_FOR_PROVIDER','BLOCKED_ADMIN',
    'FINALIZING','COMPLETED','FAILED_TECHNICAL'
  )),
  check (run_purpose in (
    'user_check','admin_diagnostic','release_canary',
    'synthetic_test','maintenance'
  )),
  check (side_effect_policy in ('authoritative','isolated')),
  check (final_score is null or final_score between 0 and 100),
  check (
    status <> 'COMPLETED' or
    (final_score is not null and final_decision in ('ACCEPTABLE','REVIEW','DECLINE')
      and evidence_bundle_sha256 is not null
      and traversal_closure_sha256 is not null
      and scoring_bundle_sha256 is not null
      and report_sha256 is not null)
  )
);

create unique index unified_check_runs_reusable_analysis_idx
  on unified_check_runs(analysis_key_sha256)
  where status <> 'FAILED_TECHNICAL';

create table unified_check_requests (
  id text primary key,
  request_correlation_id text not null unique,
  run_id text references unified_check_runs(id),
  subject_address text not null,
  chat_id text not null,
  message_thread_id text not null default '',
  locale text not null,
  run_purpose text not null,
  status text not null,
  status_reason text,
  ready_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (locale in ('ru','en')),
  check (status in ('ACCEPTED','ATTACHED','FAILED_TECHNICAL')),
  check (
    (status = 'ATTACHED' and run_id is not null)
    or (status <> 'ATTACHED' and run_id is null)
  )
);

create table unified_check_tasks (
  id text primary key,
  run_id text not null references unified_check_runs(id),
  kind text not null,
  status text not null,
  priority_lane text not null,
  ready_at timestamptz not null default now(),
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  attempt integer not null default 0,
  accepted_attempt_id text,
  logical_key text not null default 'main',
  checkpoint_json jsonb not null default '{}'::jsonb,
  cancellation_requested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, kind, logical_key)
);

create table unified_check_attempts (
  id text primary key,
  task_id text not null references unified_check_tasks(id),
  attempt integer not null,
  artifact_sha256 text not null,
  completed_at timestamptz not null,
  unique (task_id, attempt)
);

create table unified_check_artifacts (
  sha256 text primary key,
  created_by_run_id text not null references unified_check_runs(id),
  kind text not null,
  schema_version text not null,
  artifact_json jsonb not null,
  created_at timestamptz not null default now()
);

create table unified_check_deliveries (
  id text primary key,
  request_id text not null references unified_check_requests(id),
  presentation_sha256 text not null,
  status text not null,
  lease_token text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  last_error text,
  telegram_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, presentation_sha256)
);

create table unified_provider_pages (
  request_identity_sha256 text primary key,
  snapshot_block_hash text not null,
  payload_sha256 text not null,
  payload_json jsonb not null,
  fetched_at timestamptz not null,
  provenance_json jsonb not null
);

create table unified_check_generation_fence (
  generation_id text primary key,
  activated_at timestamptz not null,
  runtime_commit text not null,
  delivery_generation text not null,
  active boolean not null,
  created_at timestamptz not null default now()
);
```

After both tables exist, add foreign keys from
`unified_check_tasks.accepted_attempt_id` to `unified_check_attempts(id)` and
from `unified_check_attempts.artifact_sha256` to
`unified_check_artifacts(sha256)`.
Add these exact constraints and claim indexes:

```sql
alter table unified_check_tasks
  add constraint unified_check_tasks_status_check
  check (status in (
    'QUEUED','LEASED','WAITING_RETRY','COMPLETED',
    'BLOCKED_ADMIN','FAILED_TECHNICAL','CANCELLED'
  )),
  add constraint unified_check_tasks_lane_check
  check (priority_lane in ('interactive','repair','background')),
  add constraint unified_check_tasks_lease_shape_check
  check (
    (status = 'LEASED' and lease_owner is not null and lease_token is not null
      and lease_expires_at is not null)
    or
    (status <> 'LEASED' and lease_owner is null and lease_token is null
      and lease_expires_at is null)
  );

alter table unified_check_deliveries
  add constraint unified_check_deliveries_status_check
  check (status in (
    'PENDING','LEASED','RETRYABLE','SENT_CONFIRMED',
    'DELIVERY_UNKNOWN','BLOCKED_ADMIN','CANCELLED'
  ));

alter table unified_check_runs
  add constraint unified_check_runs_hash_shape_check
  check (
    analysis_key_sha256 ~ '^[0-9a-f]{64}$'
    and analysis_manifest_sha256 ~ '^[0-9a-f]{64}$'
  );

create index unified_check_tasks_claim_idx
  on unified_check_tasks(status, priority_lane, ready_at, created_at)
  where status in ('QUEUED','WAITING_RETRY');

create index unified_check_deliveries_claim_idx
  on unified_check_deliveries(status, updated_at)
  where status in ('PENDING','RETRYABLE');
```

Add an immutable-row trigger that raises
`unified_immutable_artifact_mutation` on update/delete of
`unified_check_attempts`, `unified_check_artifacts`, and
`unified_provider_pages`.

- [ ] **Step 4: Implement schema-033 verification and repository methods**

Split the current overloaded constants so historical typing remains correct:

```ts
export const SCHEMA_032_VERSION = 32;
export const SCHEMA_032_FILENAME =
  "032_telegram_runtime_forensics_data_contracts.sql";
export const REQUIRED_SCHEMA_VERSION = 33;
export const REQUIRED_SCHEMA_FILENAME = "033_unified_wallet_check.sql";

export interface Schema032Verification {
  verified: true;
  version: typeof SCHEMA_032_VERSION;
  filename: typeof SCHEMA_032_FILENAME;
  checksumSha256: string;
  shortChecksum: string;
}

export interface Schema033Verification {
  verified: true;
  version: typeof REQUIRED_SCHEMA_VERSION;
  filename: typeof REQUIRED_SCHEMA_FILENAME;
  checksumSha256: string;
  shortChecksum: string;
  schema032ChecksumSha256: string;
}
```

Retain `verifyRequiredSchema032` for historical verification. Add
`verifyRequiredSchema033` that first verifies the 032 receipt/structure, then
the 033 receipt and all Unified tables/constraints/indexes/triggers. Update
`runStartupSchemaGate` to return `Schema033Verification`.

`repository.ts` exports only focused operations:

```ts
createOrReuseUnifiedRun
createOrGetCheckRequest
insertUnifiedArtifact
createUnifiedTasks
claimUnifiedTask
heartbeatUnifiedTask
checkpointUnifiedTask
completeUnifiedTaskAttempt
selectAcceptedAttempt
finalizeUnifiedRun
createUnifiedDelivery
claimUnifiedDelivery
settleUnifiedDelivery
requestCanaryCancellation
```

Every update uses expected status plus lease token in the `where` clause.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/storage/migration033.postgres.test.ts tests/storage/unifiedCheck.postgres.test.ts tests/storage/schemaMigrations.test.ts tests/runtime/startupSchemaGate.test.ts
npm run typecheck
git add migrations/033_unified_wallet_check.sql src/unifiedCheck/repository.ts src/storage/schemaMigrations.ts src/runtime/startupSchemaGate.ts tests/storage/migration033.postgres.test.ts tests/storage/unifiedCheck.postgres.test.ts
git commit -m "feat(unified-check): add durable schema and repository"
```

### Task 3: Extract shared canonical hashing without changing legacy hashes

**Files:**

- Create: `src/forensics/canonicalJson.ts`
- Create: `tests/forensics/canonicalJson.test.ts`
- Modify: `src/forensics/telegramDelivery.ts`

- [ ] **Step 1: Capture legacy fingerprint fixtures**

Before moving code, add fixtures for:

```ts
const value = {
  chatId: "1",
  text: "Привет",
  parseMode: "HTML",
  replyMarkup: { inline_keyboard: [[{ text: "A", callback_data: "a" }]] }
};

expect(fingerprintCanonicalJson(value)).toBe(
  "44bf4efc2b39927468639a6cf51238688639bb5e699548c29e94d78fdb79e5a3"
);
```

Assert object reorder gives the same hash while array reorder changes it.

- [ ] **Step 2: Run the test against legacy code**

```powershell
npm test -- tests/forensics/canonicalJson.test.ts tests/runtime/telegramDelivery.acceptance.test.ts
```

Expected: PASS before extraction.

- [ ] **Step 3: Move, do not rewrite, canonical functions**

Move `canonicalizeJson` and `fingerprintCanonicalJson` byte-for-byte into
`src/forensics/canonicalJson.ts`. Re-export them from
`src/forensics/telegramDelivery.ts` to preserve imports. Unified artifacts use
the shared module directly.

- [ ] **Step 4: Re-run fingerprint tests**

```powershell
npm test -- tests/forensics/canonicalJson.test.ts tests/runtime/telegramDelivery.acceptance.test.ts
```

Expected: all existing fingerprints remain identical.

- [ ] **Step 5: Commit**

```powershell
git add src/forensics/canonicalJson.ts src/forensics/telegramDelivery.ts tests/forensics/canonicalJson.test.ts
git commit -m "refactor(forensics): share canonical artifact hashing"
```

### Task 4: Pin requests to confirmed snapshots and build the minimal vertical slice

**Files:**

- Create: `src/unifiedCheck/snapshot.ts`
- Create: `src/unifiedCheck/requestService.ts`
- Create: `src/unifiedCheck/orchestrator.ts`
- Create: `tests/unified-check/requestService.test.ts`
- Create: `tests/unified-check/verticalSlice.acceptance.test.ts`

- [ ] **Step 1: Write failing snapshot/reuse tests**

Assert:

- one logical UI action with the same `requestCorrelationId` returns one
  `CheckRequest`;
- two deliberate actions create two requests;
- request is durably `ACCEPTED` before snapshot acquisition and becomes
  `ATTACHED` only after a run is selected;
- same address + exact block/hash + manifest versions reuses analysis;
- a newer confirmed block creates another run;
- new blocks do not alter an existing `AnalysisManifest`;
- a canary uses `isolated` and never reuses completed analysis.

- [ ] **Step 2: Write the failing minimal slice acceptance**

Use fake providers and fake branch results:

```text
request
→ AnalysisManifest
→ fast/deep/where child attempts
→ neutral canonical fact
→ score 0 / ACCEPTABLE
→ EvidenceBundle
→ TraversalClosureCertificate(frontier=0)
→ ScoringBundle
→ UnifiedWalletReport
→ COMPLETED
```

Assert no Telegram delivery exists yet and every hash reference resolves.

- [ ] **Step 3: Run and verify RED**

```powershell
npm test -- tests/unified-check/requestService.test.ts tests/unified-check/verticalSlice.acceptance.test.ts
```

- [ ] **Step 4: Implement snapshot and orchestration**

`snapshot.ts` builds:

```ts
export type SnapshotSource = {
  latestConfirmedBlock(): Promise<{
    number: string;
    hash: string;
    timestamp: string;
  }>;
  snapshotBalances(address: string, blockNumber: string): Promise<{
    usdtRaw: string | null;
    trxSun: string | null;
    source: string;
    consistency: "exact" | "reconstructed" | "unavailable";
  }>;
};
```

`requestService.ts` computes the analysis key from chain, address, block/hash,
label hash, policy versions, runtime commit and schema version.

It first persists `CheckRequest(status=ACCEPTED)`. Snapshot acquisition may
return `provider_wait`, increment request attempt and move `readyAt` without
inventing a run/score. After a snapshot exists, one transaction creates/reuses
the exact analysis run and changes the request to `ATTACHED`. A permanent
intake failure changes only the request to `FAILED_TECHNICAL`.

`orchestrator.ts` creates three child tasks, accepts deterministic fake attempts
for this slice, and finalizes only after all branches are
`COMPLETED`/`NOT_APPLICABLE` and all required artifact hashes validate in one
transaction.

- [ ] **Step 5: Run the B0 gate once and commit**

```powershell
npm test -- tests/unified-check/stateMachine.test.ts tests/unified-check/requestService.test.ts tests/unified-check/verticalSlice.acceptance.test.ts tests/storage/unifiedCheck.postgres.test.ts
npm run typecheck
git add src/unifiedCheck/snapshot.ts src/unifiedCheck/requestService.ts src/unifiedCheck/orchestrator.ts tests/unified-check/requestService.test.ts tests/unified-check/verticalSlice.acceptance.test.ts
git commit -m "feat(unified-check): complete minimal parent-run slice"
```

Expected: B0 produces a completed, hash-bound report without provider or
Telegram integration.

## Milestone B1: Shared Data Plane and Fair Workers

### Task 5: Define exact provider identity, cache and coalescing

**Files:**

- Create: `src/unifiedCheck/providerRequest.ts`
- Create: `tests/unified-check/providerRequest.test.ts`
- Modify: `src/tron/tronscanScheduler.ts`
- Modify: `tests/tron/tronscanScheduler.test.ts`

- [ ] **Step 1: Write failing identity/coalescing tests**

Canonical identity includes:

```ts
{
  chain,
  providerFamily,
  endpoint,
  apiSchemaVersion,
  address,
  tokenContract,
  blockStart,
  blockEnd,
  direction,
  order,
  pageSize,
  cursor,
  snapshotBlockNumber,
  snapshotBlockHash,
  confirmationPolicy
}
```

Assert exact duplicates call the provider once and receive one immutable page;
changing any listed field calls it twice. API credential/key index does not
change identity.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/unified-check/providerRequest.test.ts tests/tron/tronscanScheduler.test.ts
```

- [ ] **Step 3: Implement identity and in-flight coalescing**

`buildProviderRequestIdentity` validates all fields and returns canonical JSON
plus SHA-256. `loadOrFetchProviderPage` checks
`unified_provider_pages`, joins an in-flight promise keyed by identity hash, and
persists only a provenance-bound response matching the requested snapshot.
Rejected requests are removed from the in-flight map.

- [ ] **Step 4: Test crash and mismatch behavior**

Add tests that a payload whose block/cursor/provenance does not match identity
is rejected and not cached; a process restart reuses the DB page; overlapping
pages dedup later by event identity, not by silently changing the page.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/unified-check/providerRequest.test.ts tests/tron/tronscanScheduler.test.ts
git add src/unifiedCheck/providerRequest.ts src/tron/tronscanScheduler.ts tests/unified-check/providerRequest.test.ts tests/tron/tronscanScheduler.test.ts
git commit -m "feat(unified-check): coalesce exact provider pages"
```

### Task 6: Add fair run lanes and arbitrary key health

**Files:**

- Modify: `src/tron/tronscanScheduler.ts`
- Create: `tests/unified-check/fairScheduler.test.ts`

- [ ] **Step 1: Write failing deterministic scheduler tests**

With a fake clock and four key slots, assert:

- lane weights are interactive `8`, repair `2`, background `1`;
- active runs round-robin inside a lane;
- one run uses at most half healthy slots while another waits;
- alone, one run may use all free slots;
- `429` cools only the affected key/scope and ready work moves to healthy keys;
- retry order uses `readyAt`, not original `createdAt`;
- background receives a bounded share under sustained interactive load;
- adding 8 or 16 keys requires no code/config shape change.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/unified-check/fairScheduler.test.ts
```

- [ ] **Step 3: Extend scheduler inputs and diagnostics**

Add:

```ts
type UnifiedProviderLane = "interactive" | "repair" | "background";

type UnifiedScheduleMetadata = {
  runId: string;
  taskId: string;
  lane: UnifiedProviderLane;
  readyAtMs: number;
};
```

Track per-key `inFlight`, daily quota, cooldown by scope, health, last success,
and temporary block reason. Do not hardcode four keys.

- [ ] **Step 4: Implement weighted round-robin**

Use a deterministic deficit/weighted round-robin over non-empty lanes, then
round-robin active `runId`s. Page/chunk/concurrency sizes remain operational and
never become analytic terminal reasons.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/unified-check/fairScheduler.test.ts tests/tron/tronscanScheduler.test.ts
git add src/tron/tronscanScheduler.ts tests/unified-check/fairScheduler.test.ts
git commit -m "feat(unified-check): schedule provider work fairly"
```

### Task 7: Build snapshot-bounded shared direct history

**Files:**

- Create: `src/unifiedCheck/directHistory.ts`
- Create: `tests/unified-check/directHistory.test.ts`
- Modify: `src/forensics/tronAddressAllTimeIndex.ts`
- Modify: `tests/forensics/tronAddressAllTimeIndex.test.ts`

- [ ] **Step 1: Write failing 500-page and cutoff tests**

Feed 500 immutable pages with deliberate one-event overlaps. Assert:

- all authoritative pages are consumed until an empty range reaches account
  creation;
- events after cutoff are rejected;
- dedup key is `txHash + eventIndex + tokenContract`;
- same transaction with different event index is retained;
- rate limit/key exhaustion returns provider wait, not history completion;
- checkpoint restart resumes at the saved cursor without missing/repeating an
  event.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/unified-check/directHistory.test.ts
```

- [ ] **Step 3: Implement direct-history prerequisite**

Export:

```ts
export type DirectHistoryCheckpoint = {
  snapshotBlockNumber: string;
  snapshotBlockHash: string;
  nextCursor: string | null;
  pageHashes: string[];
  eventCount: number;
  reachedAccountCreation: boolean;
};

export async function runDirectHistoryChunk(input: {
  address: string;
  manifest: AnalysisManifestV1;
  checkpoint: DirectHistoryCheckpoint;
  maxPagesThisChunk: number;
  loadPage: LoadProviderPage;
}): Promise<{
  checkpoint: DirectHistoryCheckpoint;
  events: IndexedTronUsdtTransfer[];
  outcome: "more" | "complete" | "provider_wait";
}>;
```

`maxPagesThisChunk` controls lease duration only. Returning `more` creates
another task chunk; it never marks analysis complete.

- [ ] **Step 4: Preserve existing index behavior**

Reuse `normalizeTronscanTransferForAddressIndex` and
`shouldIndexCanonicalTronscanUsdtTransfer`; add snapshot parameters rather than
forking transfer normalization. Existing legacy callers retain current
all-time behavior.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/unified-check/directHistory.test.ts tests/forensics/tronAddressAllTimeIndex.test.ts
git add src/unifiedCheck/directHistory.ts src/forensics/tronAddressAllTimeIndex.ts tests/unified-check/directHistory.test.ts tests/forensics/tronAddressAllTimeIndex.test.ts
git commit -m "feat(unified-check): share snapshot direct history"
```

### Task 8: Execute stateless chunks with immutable attempts

**Files:**

- Create: `src/unifiedCheck/worker.ts`
- Create: `tests/unified-check/worker.test.ts`
- Modify: `src/runtime/startupSchedule.ts`
- Modify: `tests/runtime/startupSchedule.test.ts`

- [ ] **Step 1: Write failing lease/checkpoint/restart tests**

Use two workers and a fake clock. Assert:

- only one worker receives a task/lease token;
- heartbeat extends only the matching live lease;
- checkpoint update requires expected attempt and lease token;
- stale worker cannot publish after lease takeover;
- retry creates another immutable attempt row;
- accepted attempt changes orchestration state but never edits old attempts;
- `cancellation_requested_at` is observed at the next chunk boundary;
- a provider wait releases the lease and sets `readyAt`.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/unified-check/worker.test.ts
```

- [ ] **Step 3: Implement one small worker cycle**

Export:

```ts
export async function runUnifiedTaskCycle(input: {
  workerId: string;
  now(): Date;
  leaseMs: number;
  repository: UnifiedCheckRepository;
  handlers: Record<string, UnifiedChunkHandler>;
}): Promise<{
  claimed: boolean;
  taskId: string | null;
  outcome: "idle" | "checkpointed" | "completed" | "waiting" | "blocked" | "failed";
}>;
```

The cycle claims one task, runs one bounded chunk, writes one checkpoint or
immutable attempt, and returns. It contains no loop over an entire wallet.

- [ ] **Step 4: Add schedules by resource**

Add guarded schedules for provider I/O, indexing, CPU/aggregation,
scoring/rendering, delivery, and watchdog. Do not create separate competing
top-level Fast/Where/Deep polling loops for Unified tasks.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/unified-check/worker.test.ts tests/runtime/startupSchedule.test.ts
git add src/unifiedCheck/worker.ts src/runtime/startupSchedule.ts tests/unified-check/worker.test.ts tests/runtime/startupSchedule.test.ts
git commit -m "feat(unified-check): run resumable task chunks"
```

## Milestone B2: Forensic Evidence and Scoring

### Task 9: Adapt Fast, Where and Deep into evidence-only branches

**Files:**

- Create: `src/unifiedCheck/branchAdapters.ts`
- Create: `tests/unified-check/branchAdapters.test.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Modify: `src/check/deepForensicCheck.ts`
- Modify: `src/check/manualCheck.ts`

- [ ] **Step 1: Write failing branch-authority tests**

For the same shared direct-history fixture, assert:

- Fast/Where/Deep adapters receive the same snapshot and event-index hash;
- adapters emit evidence/facts/patterns/boundaries/roles/candidates;
- no adapter returns a Telegram payload, delivery intent or authoritative final
  score;
- internal diagnostic scores are tagged `diagnostic`;
- no-USDT marks only provenance as `NOT_APPLICABLE`;
- a no-USDT wallet with a dangerous approval still runs approval/security
  evidence and can emit a hard candidate;
- branch failure cannot be converted into `REVIEW`.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/unified-check/branchAdapters.test.ts
```

- [ ] **Step 3: Add explicit evidence-only entrypoints**

Each existing analyzer receives an optional Unified context:

```ts
type UnifiedBranchContext = {
  runId: string;
  manifest: AnalysisManifestV1;
  directHistoryArtifactSha256: string;
  directEvents: readonly IndexedTronUsdtTransfer[];
  labelsDatasetSha256: string;
  deliveryAuthority: false;
};
```

Add adapter entrypoints without deleting legacy entrypoints:

```ts
runUnifiedFastBranch
runUnifiedWhereBranch
runUnifiedDeepBranch
```

They return `UnifiedBranchArtifactV1`, never a job completion with Telegram
fields.

- [ ] **Step 4: Remove branch-local data duplication**

When Unified context is supplied, existing checks must read direct history from
that context and request only branch-specific continuation/enrichment through
the shared provider layer. Tests count provider calls and prove direct pages are
not fetched three times.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/unified-check/branchAdapters.test.ts tests/check/manualCheck.test.ts tests/check/whereIsMoneyCheck.test.ts tests/check/deepForensicCheck.test.ts
git add src/unifiedCheck/branchAdapters.ts src/check/manualCheck.ts src/check/whereIsMoneyCheck.ts src/check/deepForensicCheck.ts tests/unified-check/branchAdapters.test.ts
git commit -m "feat(unified-check): adapt evidence-only branches"
```

### Task 10: Implement finite bidirectional traversal and closure certificate

**Files:**

- Create: `src/unifiedCheck/traversal.ts`
- Create: `tests/unified-check/traversal.test.ts`
- Create: `tests/fixtures/unified-check/denseTraversal.ts`

- [ ] **Step 1: Write failing traversal invariants**

Cover:

- backward provenance and forward continuation have separate
  amount/temporal predicates;
- a repeated edge/state is expanded once;
- path narratives do not create Cartesian-product states;
- same address may occur in different funding episodes;
- DEX/router/contract/collector are not terminal solely by label/type;
- service/restriction/economic/account-creation/amount/temporal boundaries are
  terminal only with canonical evidence;
- missing label, depth, queue pressure and density are not terminal reasons;
- dense fan-in/fan-out satisfies the structural state bound;
- frontier-empty closure reconciles amounts and has zero dropped/unclassified
  states.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/unified-check/traversal.test.ts
```

- [ ] **Step 3: Define canonical state and terminal reason**

```ts
export type TraversalStateV1 = {
  address: string;
  direction: "backward" | "forward";
  anchorTimestamp: string;
  fundingEpisodeId: string;
  allocatedAmountRaw: string;
  sourceEventIds: string[];
};

export type TraversalTerminalReason =
  | "identified_service_boundary"
  | "shared_liquidity_boundary"
  | "policy_or_restriction_boundary"
  | "contract_economic_boundary"
  | "history_exhausted_to_account_creation"
  | "amount_continuity_exhausted"
  | "temporal_continuity_exhausted"
  | "unidentified_structural_boundary";
```

Canonical state identity hashes normalized state fields. Allocations for the
same event/direction/episode merge before expansion.

- [ ] **Step 4: Implement chunk expansion and closure**

Export `expandTraversalChunk` and `buildTraversalClosureCertificate`.
Completion requires:

```ts
frontierCount === 0
unclassifiedCount === 0
droppedCount === 0
expandedStateCount <= eligibleEventCount * directionCount * fundingEpisodeCount
allocatedInputRaw === terminalRaw + continuedRaw + residualRaw
```

The certificate binds manifest, evidence and processed/terminal/superseded set
hashes.

Emit backward and forward coverage separately:

```ts
type TraversalCoverageV1 = {
  selectionCoverage: number;
  traceCoverage: number;
  identifiedCoverage: number;
  unknownBoundaryShare: number;
  untracedShare: number;
  selectedAmountRaw: string;
  tracedAmountRaw: string;
  identifiedAmountRaw: string;
};
```

These values enter the audit/report artifact and never a scoring candidate.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/unified-check/traversal.test.ts
git add src/unifiedCheck/traversal.ts tests/unified-check/traversal.test.ts tests/fixtures/unified-check/denseTraversal.ts
git commit -m "feat(unified-check): prove traversal closure"
```

### Task 11: Canonicalize facts, deduplicate branches and resolve conflicts

**Files:**

- Create: `src/unifiedCheck/canonicalFacts.ts`
- Create: `tests/unified-check/canonicalFacts.test.ts`

- [ ] **Step 1: Write failing key-profile tests**

Test:

- Fast/Where/Deep IDs for the same transaction become one canonical event fact;
- event index is on-chain index, not input-array position;
- event/state/path profiles never collision-merge;
- optional values use typed sentinels;
- direct and indirect facts remain distinct;
- `blacklisted_at_transfer` differs from `counterparty_later_frozen`;
- victim/drainer/spender/receiver roles remain distinct;
- one canonical fact enters one scoring lane only;
- correlated weak facts create one composite candidate;
- input reorder and duplicate branch artifacts do not change output hash.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/unified-check/canonicalFacts.test.ts
```

- [ ] **Step 3: Implement the three key profiles**

Event key:

```ts
[
  "canonical-fact-key-v1", "event", chain, tokenContract, txHash, eventIndex,
  factType, subject, counterparty, subjectRole
]
```

State/relationship key:

```ts
[
  "canonical-fact-key-v1", "state", chain, factType, subject,
  counterpartyOrObject, subjectRole, effectiveAt, snapshotBlock
]
```

Path key contains the ordered event-key hash, fact type, subject and role.

- [ ] **Step 4: Implement ordered conflict resolution**

Rules:

1. exact hard evidence wins over duplicate contextual projection;
2. safe/service context cannot lower a hard floor;
3. approval hard evidence is independent of blacklist absence;
4. direct and at-event semantics outrank indirect/later context without
   deleting that context;
5. unknown alone contributes zero;
6. `unknown_with_correlated_pattern` requires the configured independent
   fan-in/rapid-forwarding/concentration/repetition facts;
7. negative facts are emitted only for a completed matching scope.

Emit a conflict receipt listing every retained/superseded fact and reason.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/unified-check/canonicalFacts.test.ts
git add src/unifiedCheck/canonicalFacts.ts tests/unified-check/canonicalFacts.test.ts
git commit -m "feat(unified-check): canonicalize evidence facts"
```

### Task 12: Generate the adjudicated attribution and scoring bindings

**Files:**

- Create: `scripts/generateUnifiedGoldenBindings.ts`
- Create: `src/risk/scoringPolicyV4.generated.ts`
- Create: `src/unifiedCheck/selectedAttributionPolicy.generated.ts`
- Create: `tests/unified-check/goldenBindings.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing generator tests**

In a temporary root, assert the generator:

- verifies `locked-golden-manifest-v2`;
- refuses a pre-adjudication manifest;
- emits one selected policy;
- emits exact matrix rows/thresholds/scores only from adjudicated records;
- embeds the locked manifest hash;
- is deterministic under input file reorder;
- refuses to overwrite a generated file whose source hash differs unless
  `--replace` is explicitly supplied.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/unified-check/goldenBindings.test.ts
```

- [ ] **Step 3: Implement deterministic generation**

Generate the attribution module from validated values:

```ts
function renderAttributionBinding(
  policy: "fifo" | "lifo" | "proportional",
  lockedGoldenManifestSha256: string
): string {
  return [
    "export const SELECTED_ATTRIBUTION_POLICY = {",
    '  version: "selected-attribution-policy-v1",',
    `  policy: ${JSON.stringify(policy)},`,
    `  lockedGoldenManifestSha256: ${JSON.stringify(lockedGoldenManifestSha256)}`,
    "} as const;",
    ""
  ].join("\n");
}
```

The generated literal is therefore the adjudicated value rather than a
manually chosen default. Render the scoring module from rows sorted by
`rowId`, with raw integer values and the same Golden hash.

Add:

```json
{
  "unified:generate-golden-bindings": "node --import tsx scripts/generateUnifiedGoldenBindings.ts"
}
```

- [ ] **Step 4: Generate from the locked Golden root**

```powershell
npm run unified:generate-golden-bindings -- --golden docs/audit/2026-07-system-audit/golden-v2/locked
npm test -- tests/unified-check/goldenBindings.test.ts
git diff --check
```

Expected: both generated files contain the same locked manifest hash and no
coverage row/floor.

- [ ] **Step 5: Commit**

```powershell
git add scripts/generateUnifiedGoldenBindings.ts src/risk/scoringPolicyV4.generated.ts src/unifiedCheck/selectedAttributionPolicy.generated.ts tests/unified-check/goldenBindings.test.ts package.json
git commit -m "feat(unified-check): bind adjudicated golden policy"
```

### Task 13: Implement matrix v4 and ScoreAnchorV3

**Files:**

- Create: `src/risk/scoringSignalMatrixV4.ts`
- Create: `src/risk/scoreAnchorV3.ts`
- Create: `tests/risk/scoringSignalMatrixV4.test.ts`
- Create: `tests/risk/scoreAnchorV3.test.ts`
- Modify: `src/unifiedCheck/orchestrator.ts`

- [ ] **Step 1: Write failing Golden/property tests**

Load locked expected decisions/scores after adjudication and assert:

- every completed case has one numeric score and decision;
- coverage-only mutation does not change score/anchor;
- duplicate/reordered facts do not change score;
- safe transfers do not lower hard floor;
- unknown alone adds zero;
- neutral candidate exists for clean/no-risk/no-USDT cases;
- direct/indirect, at-event/later, and victim/drainer semantics differ;
- 99% Bybit plus 1% hard evidence preserves the hard floor;
- dangerous approval/no debit and victim debit follow their adjudicated rows.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/risk/scoringSignalMatrixV4.test.ts tests/risk/scoreAnchorV3.test.ts
```

- [ ] **Step 3: Implement matrix v4 without changing v3**

`scoringSignalMatrixV4.ts` accepts only canonical facts/candidates and generated
policy rows. It has no `coverage` evidence class, floor, penalty or dampener.
Neutral candidates are explicit:

```ts
type NeutralCandidateCode =
  | "clean_confirmed_context"
  | "neutral_no_observed_risk"
  | "unknown_without_risk_pattern"
  | "no_usdt_activity";
```

The highest applicable floor plus allowed context determines the score; one
fact cannot be floor, pattern and context simultaneously.

- [ ] **Step 4: Add ScoreAnchorV3**

Current `ScoreAnchorV2` is matrix-v3-only and contains
`coverageDependency`; the schema audit therefore requires a new version:

```ts
export type ScoreAnchorV3 = {
  version: "score-anchor-v3";
  policyVersion: "scoring-signal-matrix-v4";
  subjectAddress: string;
  mode: "unified";
  score: number;
  decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
  matrixRow: string;
  evidenceClass: string;
  proofLevel: string;
  authority: string;
  canonicalFactIds: string[];
  primaryFactIds: string[];
  preferredFactId: string;
  lockedGoldenManifestSha256: string;
};
```

Validate one active anchor, exact subject/fact binding and generated-policy
membership. Keep all V2 readers unchanged.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/risk/scoringSignalMatrixV4.test.ts tests/risk/scoreAnchorV3.test.ts tests/risk/scoringSignalMatrix.test.ts tests/risk/scoreAnchorV2.acceptance.test.ts tests/risk/unifiedWalletRisk.test.ts
git add src/risk/scoringSignalMatrixV4.ts src/risk/scoreAnchorV3.ts src/unifiedCheck/orchestrator.ts tests/risk/scoringSignalMatrixV4.test.ts tests/risk/scoreAnchorV3.test.ts
git commit -m "feat(scoring): add coverage-independent matrix v4"
```

## Milestone B3: Dossier, Presentation and Delivery

### Task 14: Build the reconciled Unified Wallet Report

**Files:**

- Create: `src/unifiedCheck/report.ts`
- Create: `tests/unified-check/report.test.ts`
- Modify: `src/wallet/metrics.ts`
- Modify: `tests/wallet/metrics.test.ts`

- [ ] **Step 1: Write failing dossier tests**

For a complete scoring/evidence bundle assert the report order and content:

1. score/action;
2. score drivers;
3. balance formation;
4. outgoing movement;
5. services/boundaries in both directions;
6. contracts/approvals;
7. behavior/connections;
8. wallet profile;
9. multidimensional coverage;
10. conclusion;
11. snapshot line.

Also assert:

- direct and indirect service links are separate;
- every percentage has scope/denominator/raw amount;
- incoming and outgoing service totals reconcile independently;
- no sharp 1,000/100 USDT presentation branch exists;
- current-balance attribution and latest-five episode are distinct scopes;
- zero/small balance includes five newest principal inbound events without
  limiting full analysis;
- negative facts appear only for a completed matching scope.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/unified-check/report.test.ts tests/wallet/metrics.test.ts
```

- [ ] **Step 3: Implement report assembly**

`buildUnifiedWalletReport` takes only immutable artifacts:

```ts
export function buildUnifiedWalletReport(input: {
  manifest: AnalysisManifestV1;
  evidence: EvidenceBundleV1;
  closure: TraversalClosureCertificateV1;
  scoring: ScoringBundleV1;
  walletMetrics: WalletMetrics;
  selectedAttributionPolicy: "fifo" | "lifo" | "proportional";
}): UnifiedWalletReportV1;
```

It verifies every referenced hash, uses raw decimal strings/`BigInt`, emits
deterministically sorted aggregates, and never reads provider/DB state.

- [ ] **Step 4: Extend wallet metrics with explicit scopes**

Reuse existing creation time, USDT/TRX balance, first/last activity and counts.
Add exact `asOfBlock`/`observedAt`/consistency metadata. A live balance after
cutoff may be a dated profile metric but cannot alter scoring or attribution.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/unified-check/report.test.ts tests/wallet/metrics.test.ts
git add src/unifiedCheck/report.ts src/wallet/metrics.ts tests/unified-check/report.test.ts tests/wallet/metrics.test.ts
git commit -m "feat(unified-check): assemble reconciled wallet dossier"
```

### Task 15: Render one Telegram message with completeness proof

**Files:**

- Create: `src/unifiedCheck/presentation.ts`
- Create: `tests/unified-check/presentation.test.ts`
- Create: `tests/unified-check/presentation.golden.test.ts`
- Modify: `src/unifiedCheck/orchestrator.ts`
- Modify: `src/telegram/forensicPresentation.ts`

- [ ] **Step 1: Write failing semantic-compression tests**

Assert:

- one report/locale renders one immutable HTML payload;
- RU/EN share report hash and have different presentation hashes;
- same `PresentationManifest` produces byte-identical HTML/hash;
- address links render once, with no duplicated raw URL;
- repeated rows aggregate by service/risk class/role/temporal semantics;
- category total, denominator and collapsed fact count remain;
- critical counts/amounts remain even when examples are removed;
- output fits Telegram maximum and is never sliced/truncated;
- impossible formatting returns `presentation_contract_failed` and no payload;
- `PresentationCompletenessReceipt` inventory covers every normative section
  and reconciles totals.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/unified-check/presentation.test.ts tests/unified-check/presentation.golden.test.ts
```

- [ ] **Step 3: Implement deterministic compaction passes**

Use this fixed sequence:

```text
full aggregates with bounded examples
→ remove non-critical examples
→ merge same service/risk/role/time groups
→ shorten address display, never target URL
→ compact profile prose
→ validate size and completeness
```

No pass drops a category total, score driver, hard-risk class, scope,
denominator, snapshot, or collapsed fact count.

For the initial recipients, `orchestrator.ts` validates report, score, closure,
all required locale presentations and completeness receipts, then records
`COMPLETED` plus delivery intents in one DB transaction. If presentation cannot
fit, the run stays out of `COMPLETED` and no partial delivery is created.

`ensurePresentationForRequest` may add/reuse a locale presentation for a later
request attached to an already completed immutable analysis; it does not reopen
or rerun that analysis.

- [ ] **Step 4: Bind exact Golden expectations**

The Golden test reads locale-specific exact HTML from the locked Golden
artifacts and compares production renderer output. It never generates expected
HTML from the renderer. Pre-adjudication fixtures remain property-only.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/unified-check/presentation.test.ts tests/unified-check/presentation.golden.test.ts tests/telegram/forensicPresentationContract.acceptance.test.ts
git add src/unifiedCheck/presentation.ts src/telegram/forensicPresentation.ts tests/unified-check/presentation.test.ts tests/unified-check/presentation.golden.test.ts
git commit -m "feat(unified-check): render one complete Telegram dossier"
```

### Task 16: Deliver once per logical request and preserve ambiguity

**Files:**

- Create: `src/unifiedCheck/delivery.ts`
- Create: `tests/unified-check/delivery.test.ts`
- Modify: `src/unifiedCheck/repository.ts`
- Modify: `src/runtime/forensicRuntimeOrchestration.ts`

- [ ] **Step 1: Write failing delivery tests**

Assert:

- retry/double-tap of one logical action reuses `requestCorrelationId` and one
  delivery;
- a deliberate new request gets one new delivery even if analysis/presentation
  is reused;
- confirmed send is never resent;
- explicit pre-acceptance retryable rejection may retry;
- timeout/reset after transport handoff becomes `DELIVERY_UNKNOWN`;
- `DELIVERY_UNKNOWN` is never automatically leased;
- manual resend creates a separate audited operation and warning;
- legacy and Unified delivery workers cannot claim each other's rows.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/unified-check/delivery.test.ts
```

- [ ] **Step 3: Define a phase-aware transport result**

```ts
export type UnifiedTelegramSendResult =
  | { kind: "confirmed"; telegramMessageId: string }
  | { kind: "rejected_retryable"; code: string; retryAt: string }
  | { kind: "rejected_permanent"; code: string }
  | { kind: "ambiguous"; code: string };
```

The adapter classifies errors before returning; the state machine never guesses
whether a thrown error happened before or after transport handoff.

- [ ] **Step 4: Implement claim and settle**

`runUnifiedDeliveryCycle` claims only `PENDING`/due `RETRYABLE`, verifies request
and presentation hashes, performs one send attempt, and settles transactionally.
Recipient/chat metadata remains outside the forensic hash chain.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/unified-check/delivery.test.ts tests/runtime/telegramDelivery.acceptance.test.ts
git add src/unifiedCheck/delivery.ts src/unifiedCheck/repository.ts src/runtime/forensicRuntimeOrchestration.ts tests/unified-check/delivery.test.ts
git commit -m "feat(unified-check): add request-scoped delivery"
```

### Task 17: Add Admin/watchdog observability and explicit recovery

**Files:**

- Create: `src/unifiedCheck/watchdog.ts`
- Create: `tests/unified-check/watchdog.test.ts`
- Modify: `src/admin/adminServer.ts`
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminServer.test.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing watchdog/Admin tests**

Admin projection must show:

- parent state/reason and run purpose;
- each child task/attempt/lease/checkpoint/heartbeat;
- queue/provider/compute durations separately;
- snapshot/policy/runtime hashes;
- traversal frontier/closure counts;
- score only for `COMPLETED`;
- presentation/delivery status including `DELIVERY_UNKNOWN`;
- legacy/Unified generation;
- canary isolation and cancellation state.

Recovery tests prove Admin can resume `BLOCKED_ADMIN`, mark a proven permanent
failure `FAILED_TECHNICAL`, retry a failed task with a new immutable attempt,
or manually act on unknown delivery. It cannot manufacture a score, change an
artifact, or resend automatically.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/unified-check/watchdog.test.ts tests/admin/adminServer.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
```

- [ ] **Step 3: Implement watchdog classification**

`inspectUnifiedRuns` uses heartbeat, lease expiry, provider state and task
readiness to emit:

```ts
type WatchdogFinding =
  | "healthy"
  | "waiting_provider"
  | "stale_lease_reclaimable"
  | "blocked_source_unavailable"
  | "blocked_admin_review"
  | "delivery_unknown"
  | "canary_deadline_reached";
```

It reports findings; only explicit repository commands change state.

- [ ] **Step 4: Add authenticated endpoints and UI**

Add read endpoints for run list/detail/artifact graph and POST actions with
existing Admin authentication/CSRF conventions. Render the Unified DAG beside,
not inside, the legacy job graph.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/unified-check/watchdog.test.ts tests/admin/adminServer.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git add src/unifiedCheck/watchdog.ts src/admin/adminServer.ts src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/unified-check/watchdog.test.ts tests/admin/adminServer.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git commit -m "feat(unified-check): expose watchdog and Admin DAG"
```

## Milestone B4: Cutover, Comparator and Canary

### Task 18: Fence legacy delivery and route new wallet checks to Unified

**Files:**

- Create: `src/unifiedCheck/rolloutFence.ts`
- Create: `tests/unified-check/rolloutFence.test.ts`
- Modify: `src/bot/createBot.ts`
- Modify: `src/index.ts`
- Modify: `src/runtime/startupSchedule.ts`
- Modify: `tests/bot/unifiedTelegramModeWiring.acceptance.test.ts`
- Modify: `tests/bot/unifiedTelegramProductionPaths.acceptance.test.ts`

- [ ] **Step 1: Write failing fence and bot tests**

Assert:

- before fence, legacy path remains unchanged and Unified can run shadow/no
  delivery;
- after fence, new wallet `/check` creates only `CheckRequest`/Unified run;
- user receives no preliminary/progress/child message;
- Deep/Where child completion cannot create delivery;
- pending legacy child delivery for a fenced address is quarantined;
- already confirmed legacy delivery remains immutable;
- one `chatId + address` is not simultaneously owned by both generations;
- Incoming deposit remains on its existing route;
- restart reads the durable fence before starting workers.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/unified-check/rolloutFence.test.ts tests/bot/unifiedTelegramModeWiring.acceptance.test.ts tests/bot/unifiedTelegramProductionPaths.acceptance.test.ts
```

- [ ] **Step 3: Implement generation ownership**

`rolloutFence.ts` exports:

```ts
activateUnifiedGeneration
getActiveCheckGeneration
ownsWalletDelivery
quarantineLegacyWalletDeliveries
```

Activation binds generation ID, timestamp, runtime commit and delivery
generation. It is transactional and refuses two active fences.

- [ ] **Step 4: Rewire bot/runtime**

Replace the wallet `/check` orchestration at the current
`createQueuedAddressChecks`/check callback boundary with
`createUnifiedCheckRequest`. Do not delete legacy read/render code in this task;
keep it for historical/Admin display. Start Unified schedules only after schema
033 verification and fence-mode initialization.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/unified-check/rolloutFence.test.ts tests/bot/unifiedTelegramModeWiring.acceptance.test.ts tests/bot/unifiedTelegramProductionPaths.acceptance.test.ts tests/runtime/startupSchedule.test.ts
git add src/unifiedCheck/rolloutFence.ts src/bot/createBot.ts src/index.ts src/runtime/startupSchedule.ts tests/unified-check/rolloutFence.test.ts tests/bot/unifiedTelegramModeWiring.acceptance.test.ts tests/bot/unifiedTelegramProductionPaths.acceptance.test.ts
git commit -m "feat(unified-check): fence legacy wallet delivery"
```

### Task 19: Implement the production comparator and property replay

**Files:**

- Create: `src/unifiedCheck/comparator.ts`
- Create: `scripts/compareUnifiedWalletGolden.ts`
- Create: `tests/unified-check/comparator.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing comparator tests**

The test imports production report/scoring/presentation modules and locked
Golden artifacts, then asserts:

- exact decision/score after adjudication;
- exact anchor/report/presentation hashes where locked;
- dossier aggregate equality;
- expected score relations/floors;
- coverage-only mutation invariance;
- duplicate/reorder invariance;
- direct/indirect and role/timing differences;
- retry/restart byte identity;
- locale-specific HTML equality;
- a mismatch produces a structured violation and non-zero CLI exit.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/unified-check/comparator.test.ts
```

- [ ] **Step 3: Implement the Plan-A contract exactly**

`compareUnifiedWalletGolden` accepts
`unified-wallet-comparator-input-v1` and returns
`unified-wallet-comparator-output-v1`. It imports production only here, outside
the Golden package. Violations are stable records:

```ts
{
  property: "score" | "decision" | "anchor" | "aggregate" | "presentation" | "hash" | "relation",
  expected: unknown,
  actual: unknown
}
```

The comparator never mutates Golden artifacts or updates production state.

- [ ] **Step 4: Add CLI**

Add:

```json
{
  "unified:golden:compare": "node --import tsx scripts/compareUnifiedWalletGolden.ts"
}
```

Run:

```powershell
npm run unified:golden:compare -- --golden docs/audit/2026-07-system-audit/golden-v2/locked --candidate artifacts/unified-wallet-replay
```

Expected: one result per case and zero violations for an accepted candidate.

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/comparator.ts scripts/compareUnifiedWalletGolden.ts tests/unified-check/comparator.test.ts package.json
git commit -m "feat(unified-check): compare production with Golden V2"
```

### Task 20: Build the isolated eight-wallet live canary

**Files:**

- Create: `src/unifiedCheck/canary.ts`
- Create: `scripts/runUnifiedWalletCanary.ts`
- Create: `tests/unified-check/canary.test.ts`
- Modify: `src/unifiedCheck/repository.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing selection/isolation/deadline tests**

Seed requests containing:

- current user checks;
- prior release canaries;
- synthetic, Admin and maintenance runs;
- invalid addresses;
- TBL7/TQr;
- repeated addresses with different times.

Assert selection:

1. freezes a cutoff;
2. allows only proven `runPurpose=user_check`;
3. groups by address using max accepted/created time;
4. excludes TBL7/TQr and invalid addresses;
5. sorts latest descending then address ascending;
6. returns exactly eight or blocks before execution;
7. persists source row IDs/query/schema version in an immutable manifest.

Runtime tests assert eight fresh parent runs, `analysisReuse=forbid`,
`sideEffectPolicy=isolated`, no delivery intent, and no authoritative derived
write.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/unified-check/canary.test.ts
```

- [ ] **Step 3: Implement batch and namespace isolation**

Canary may reuse only exact immutable provider pages/direct index. Derived
labels, observations, risk decisions, watch/payment state, user indexes and
delivery writers receive an isolated sink that rejects authoritative writes.

All eight parent runs are created in one batch. Each deadline is
`run.createdAt + 35 minutes`, including queue/provider/compute time.

- [ ] **Step 4: Implement cooperative deadline handling**

At deadline:

- stop leasing new canary chunks;
- set cancellation request;
- allow only the current atomic provider/checkpoint operation to settle;
- reject a late accepted result;
- preserve completed child artifacts;
- emit `canary_execution_blocked` with phase, heartbeat, provider state, queue
  age and logs;
- never manually flip a live worker status;
- never retry without a changed code/data/config input or recorded diagnostic
  hypothesis.

The batch report records per address:

- `COMPLETED`, `FAILED_TECHNICAL` or `canary_execution_blocked`;
- parent/child durations and queue/provider/compute time separately;
- score/decision and exact HTML/hash only for `COMPLETED`;
- main evidence aggregates and score reasons;
- invariant violations or a concrete blocker;
- zero delivery intents and zero authoritative derived writes.

Add:

```json
{
  "unified:canary": "node --import tsx scripts/runUnifiedWalletCanary.ts"
}
```

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/unified-check/canary.test.ts
git add src/unifiedCheck/canary.ts src/unifiedCheck/repository.ts scripts/runUnifiedWalletCanary.ts tests/unified-check/canary.test.ts package.json
git commit -m "feat(unified-check): add isolated wallet canary"
```

### Task 21: Run acceptance gates, update knowledge and prepare release

**Files:**

- Modify: `docs/knowledge/02-check-modes.md`
- Modify: `docs/knowledge/03-job-lifecycle.md`
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/05-where-is-money-and-incoming.md`
- Modify: `docs/knowledge/06-deepcheck.md`
- Modify: `docs/knowledge/07-risk-scoring-matrix.md`
- Modify: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`
- Modify: `docs/knowledge/11-glossary.md`
- Modify: `docs/knowledge/12-runbooks.md`
- Modify: existing release evidence scripts only where required to bind schema
  033, the new candidate and new gates

- [ ] **Step 1: Run targeted pre-release groups once**

```powershell
npm test -- tests/unified-check tests/risk/scoringSignalMatrixV4.test.ts tests/risk/scoreAnchorV3.test.ts tests/storage/migration033.postgres.test.ts tests/storage/unifiedCheck.postgres.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run the full candidate gates once**

Bind environment to disposable/test resources and the exact candidate commit,
then run:

```powershell
npm test
npm run typecheck
npm run golden:v2 -- verify --input docs/audit/2026-07-system-audit/golden-v2/locked
npm run unified:golden:compare -- --golden docs/audit/2026-07-system-audit/golden-v2/locked --candidate artifacts/unified-wallet-replay
```

Run Telegram acceptance once against exact Golden RU/EN presentations and run
the migration/startup rehearsal once against a disposable PostgreSQL database.
Do not run live wallet canary before deployment.

- [ ] **Step 3: Bind release receipts to the exact candidate**

Each receipt records:

- candidate commit/runtime hash;
- config/policy versions;
- migration 033 filename/checksum/receipt;
- locked Golden manifest hash;
- generator/comparator/renderer versions;
- test/replay/Telegram commands and exit codes;
- rollout generation ID.

Any later change invalidates only gates depending on changed inputs. Re-run
those once for the new candidate; do not restart unrelated milestones.

- [ ] **Step 4: Update knowledge after the candidate behavior exists**

Document:

- one parent and one final wallet report;
- current lifecycle/recovery states;
- snapshot/index/coalescing/fair-scheduler behavior;
- traversal closure and multidimensional coverage;
- matrix v4/ScoreAnchorV3 and preserved V2 history;
- dossier order and no-progress UX;
- delivery ambiguity;
- generation fence, comparator and canary runbooks.

Remove an open problem only when the corresponding acceptance receipt exists.
Do not describe a deployed cutover before production fence activation.

- [ ] **Step 5: Apply migration and activate through protected release flow**

Use the existing backup/migration/rollout/recovery authority workflow, extended
for schema 033 and the Unified generation. Required order:

```text
backup
→ migration 033 apply/verify
→ runtime startup gate
→ shadow Unified checks/no delivery
→ comparator/replay/Telegram receipts verified
→ activate generation fence
→ quarantine pending legacy wallet deliveries
→ start Unified delivery authority
→ run recent-eight live canary
→ inspect canary artifacts
→ approve or execute existing rollback/recovery path
```

Canary outcomes are `COMPLETED`, `FAILED_TECHNICAL`, or
`canary_execution_blocked`; only `COMPLETED` has score/decision/HTML.

- [ ] **Step 6: Run the live canary once**

```powershell
npm run unified:canary -- --candidate (git rev-parse HEAD).Trim() --output artifacts/unified-wallet-canary
```

Expected:

- immutable selection manifest for exactly eight addresses;
- one terminal/blocker artifact per address;
- exact HTML/hash/score/decision only for completed runs;
- queue/provider/compute timings;
- zero Telegram delivery intents;
- zero authoritative derived writes from canary purpose.

- [ ] **Step 7: Commit documentation and release bindings**

```powershell
git add docs/knowledge package.json scripts src tests migrations
git commit -m "docs(unified-check): bind release contracts and runbooks"
```

Do not include unrelated files or mutable runtime artifacts in this commit.

## Required Acceptance Matrix

### Product

- [ ] One immutable Telegram report per logical wallet-check request.
- [ ] No Fast/Where/Deep user delivery after fence.
- [ ] Every `COMPLETED` run has numeric score, decision, one active anchor and
  valid report/presentation hashes.
- [ ] Technical failure never becomes a risk decision.
- [ ] No coverage/no-final user copy for a completed run.

### Data and traversal

- [ ] Confirmed snapshot cutoff is immutable and ignores later blocks.
- [ ] 500 direct-history pages reach authoritative exhaustion/account creation.
- [ ] Page overlaps do not duplicate events.
- [ ] Worker restart preserves cursor and hashes.
- [ ] Dense graphs merge states without becoming a terminal boundary.
- [ ] Closure certificate has empty frontier, conservation, zero dropped and
  zero unclassified states.

### Scoring

- [ ] Matrix v4 contains no coverage row/floor/penalty/dampener.
- [ ] Unknown alone adds zero.
- [ ] A neutral candidate always exists.
- [ ] Cross-branch canonical dedup is order/retry invariant.
- [ ] Direct/indirect, role and temporal semantics remain distinct.
- [ ] Safe facts do not lower hard floors.
- [ ] Golden exact scores and relations pass after adjudication.

### Scheduler and artifacts

- [ ] Exact provider requests coalesce; semantically different requests do not.
- [ ] Ready work moves from exhausted/cooling keys to healthy keys.
- [ ] Old retry does not block a new run.
- [ ] One dense wallet cannot occupy the whole pool under contention.
- [ ] Every artifact/attempt/hash edge verifies; immutable rows reject mutation.
- [ ] RU/EN share report hash and differ only in presentation artifacts.

### Delivery, rollout and canary

- [ ] Same logical request does not duplicate delivery.
- [ ] New deliberate request gets one outcome even when analysis is reused.
- [ ] Ambiguous send becomes `DELIVERY_UNKNOWN` and is not retried automatically.
- [ ] Fence prevents legacy and Unified wallet delivery from racing.
- [ ] Canary selection excludes prior canary/synthetic/Admin/TBL7/TQr rows.
- [ ] Canary runs are isolated, fresh, no-delivery and cooperatively cancelled
  at the 35-minute harness deadline.

## Execution Anti-Loop Rules

- Complete and commit one task before opening the next task.
- A failed targeted test returns only to the owning task/module.
- The same unchanged failure is run at most twice; the second identical failure
  becomes a named blocker and diagnostic hypothesis.
- Full suite, Golden comparator, replay and Telegram acceptance run only at
  their listed milestone/release gate and once again only if a bound input
  changed.
- No release uses a receipt from a different commit/config/schema/Golden hash.
- Review has one primary pass. After P0/P1 fixes, recheck only changed files and
  dependent contracts.
- Long commands expose phase/progress; no-progress execution is stopped with
  logs preserved.
- The minimal B0 path remains runnable while dense scaling and optimizations are
  added.
- Optional improvements discovered during implementation become follow-up work;
  they do not silently expand these acceptance gates.

## Design Coverage Map

| Design section/contract | Implemented by |
|---|---|
| §3 product invariants and no product coverage/time/page gates | Tasks 1, 4, 7, 10, 13 |
| §5 parent lifecycle, child DAG and repeated requests | Tasks 1, 2, 4, 8, 9 |
| §6 Telegram dossier and semantic completeness | Tasks 14–15 |
| §7 wallet profile, scopes and latest-five episode | Task 14 |
| §8 workers, arbitrary keys, coalescing and fair lanes | Tasks 5–8 |
| §9 snapshot, direct history, bidirectional traversal and closure | Tasks 4, 7, 10 |
| §10 matrix v4, canonical facts, neutral candidates and conflicts | Tasks 11–13 |
| §11 manifests, immutable attempts and hash chain | Tasks 2–4, 8, 10, 14–15 |
| §12 request-scoped delivery, ambiguity and rollout fence | Tasks 16 and 18 |
| §13 production comparator and separate live canary | Tasks 19–20 |
| §14 Golden/property invariants | Tasks 10–13, 15, 19 |
| §15 release gates | Task 21 and Required Acceptance Matrix |
| §16 legacy compatibility | Tasks 2, 3, 13, 16, 18 |
| §17 explicit trade-offs/scope | Tasks 10, 15–16, 20 |
| §18 anti-loop execution rules | Task 21 and Execution Anti-Loop Rules |
