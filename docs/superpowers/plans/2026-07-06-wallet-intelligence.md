# Wallet Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Admin-only Wallet Intelligence workspace that indexes cross-run wallet sightings and edges from saved DeepCheck, Where is Money, and Incoming Deposit jobs without affecting scoring or user-facing output.

**Architecture:** Add a persistent PostgreSQL index for wallet intelligence runs, sightings, edges, and address summaries. Use one pure extractor for saved job payloads, repository functions for idempotent persistence/querying, best-effort indexing hooks after supported job completion, a backfill script for historical jobs, and a separate Admin table/drawer workspace.

**Tech Stack:** TypeScript, Node.js, PostgreSQL via `pg`, Vitest, existing Admin static HTML/JS in `src/admin/adminConsole.ts`, existing forensic job storage in `src/storage/repositories.ts`.

---

## File Structure

Create:

- `migrations/029_wallet_intelligence.sql` - wallet intelligence schema, checks, and indexes.
- `src/forensics/walletIntelligence.ts` - pure types, payload hashing, extraction, neutral tag helpers, and job-support guards.
- `scripts/backfillWalletIntelligence.ts` - CLI backfill for existing completed/partial supported jobs.
- `tests/forensics/walletIntelligence.test.ts` - extractor, hash, tag, and no-risk-observation unit tests.
- `tests/storage/walletIntelligence.test.ts` - repository persistence, dedupe, summary, and query tests.

Modify:

- `src/storage/repositories.ts` - exported Wallet Intelligence types and repository functions.
- `src/forensics/deepForensicJob.ts` - optional best-effort indexing hook after successful DeepCheck/Where completion.
- `src/forensics/incomingDepositJob.ts` - optional best-effort indexing hook after successful Incoming completion.
- `src/index.ts` - repository wiring for hooks, Admin deps, and backfill-compatible helpers.
- `src/admin/adminServer.ts` - Admin API routes for Wallet Intelligence.
- `src/admin/adminConsole.ts` - separate `/admin/wallet-intelligence` workspace UI with table and drawer.
- `tests/forensics/deepForensicJob.test.ts` - completion hook does not fail forensic job.
- `tests/forensics/incomingDepositJob.test.ts` - completion hook does not fail incoming job.
- `tests/admin/adminServer.test.ts` - Wallet Intelligence API auth, filters, and detail payload.
- `tests/admin/adminConsole.test.ts` or existing `tests/admin/adminServer.test.ts` shell assertions - Wallet Intelligence UI shell.
- `docs/knowledge/08-admin-and-bot-ux.md` - document new Admin-only workspace.
- `docs/knowledge/09-current-decisions.md` - record no-scoring/no-Telegram decision.
- `docs/knowledge/10-open-problems.md` - record deferred per-job hints and global graph visualization.

Do not modify:

- `src/risk/unifiedWalletRisk.ts`
- `src/forensics/moneyOriginOperationalAssessment.ts`
- Telegram message formatting files, except if a compile import requires no-op cleanup. Wallet Intelligence must not create user-facing copy.

---

### Task 1: Schema And Public Repository Types

**Files:**
- Create: `migrations/029_wallet_intelligence.sql`
- Modify: `src/storage/repositories.ts`
- Test: `tests/storage/walletIntelligence.test.ts`

- [ ] **Step 1: Create failing repository type/import test**

Create `tests/storage/walletIntelligence.test.ts` with the initial compile-facing test below. It imports the names that later tasks will implement.

```typescript
import { describe, expect, it } from "vitest";
import {
  type WalletIntelligenceAddressSummary,
  type WalletIntelligenceRunInput,
  type WalletIntelligenceSightingInput,
  type WalletIntelligenceEdgeInput
} from "../../src/storage/repositories";

describe("wallet intelligence repository types", () => {
  it("exposes neutral wallet intelligence input and summary shapes", () => {
    const run: WalletIntelligenceRunInput = {
      jobId: "job-1",
      jobKind: "address_deep_check",
      jobStatus: "completed",
      subjectAddress: "TSubject111111111111111111111111111111",
      requestedBy: "42",
      chatId: "42",
      messageId: "77",
      completedAt: new Date("2026-07-06T10:00:00.000Z"),
      telegramUserId: "42",
      telegramUsername: "client_user",
      telegramLocale: "ru",
      sourcePayloadHash: "hash-1",
      indexVersion: 1,
      indexStatus: "indexed",
      indexError: null
    };
    const sighting: WalletIntelligenceSightingInput = {
      id: "sighting-1",
      address: "TSeen1111111111111111111111111111111",
      jobId: "job-1",
      jobKind: "address_deep_check",
      subjectAddress: "TSubject111111111111111111111111111111",
      requestedBy: "42",
      sourceKind: "deep_direct_counterparty",
      role: "direct_counterparty",
      depth: 1,
      pathId: "deep:direct:0",
      txHash: "tx-1",
      amountRaw: "1000000",
      firstSeenAt: new Date("2026-07-06T09:00:00.000Z"),
      lastSeenAt: new Date("2026-07-06T09:00:00.000Z"),
      metadataJson: { direction: "inbound" }
    };
    const edge: WalletIntelligenceEdgeInput = {
      id: "edge-1",
      fromAddress: "TSeen1111111111111111111111111111111",
      toAddress: "TSubject111111111111111111111111111111",
      jobId: "job-1",
      jobKind: "address_deep_check",
      sourceKind: "deep_direct_counterparty",
      depth: 1,
      pathId: "deep:direct:0",
      txHash: "tx-1",
      amountRaw: "1000000",
      timestamp: new Date("2026-07-06T09:00:00.000Z"),
      edgeRole: "transfer",
      metadataJson: {}
    };
    const summary: WalletIntelligenceAddressSummary = {
      address: sighting.address,
      uniqueSubjectCount: 2,
      uniqueRequesterCount: 2,
      jobCount: 3,
      completedJobCount: 2,
      partialJobCount: 1,
      occurrenceCount: 4,
      distinctTxCount: 1,
      distinctAmountRaw: "1000000",
      minDepth: 1,
      maxDepth: 2,
      firstSeenAt: new Date("2026-07-06T09:00:00.000Z"),
      lastSeenAt: new Date("2026-07-06T10:00:00.000Z"),
      modes: ["address_deep_check"],
      tags: ["repeated_cross_run_address"],
      serviceCategories: [],
      labelHints: []
    };

    expect(run.indexStatus).toBe("indexed");
    expect(sighting.role).toBe("direct_counterparty");
    expect(edge.edgeRole).toBe("transfer");
    expect(summary.distinctAmountRaw).toBe("1000000");
    expect(summary.tags).not.toContain("risk");
  });
});
```

- [ ] **Step 2: Run the failing compile-targeted test**

Run:

```powershell
npm test -- --run tests/storage/walletIntelligence.test.ts
```

Expected: FAIL because `WalletIntelligenceAddressSummary`, `WalletIntelligenceRunInput`, `WalletIntelligenceSightingInput`, and `WalletIntelligenceEdgeInput` are not exported.

- [ ] **Step 3: Add migration**

Create `migrations/029_wallet_intelligence.sql`:

```sql
create table if not exists wallet_intelligence_runs (
  job_id text primary key references forensic_check_jobs(id) on delete cascade,
  job_kind text not null,
  job_status text not null,
  subject_address text not null,
  requested_by text,
  chat_id text,
  message_id text,
  completed_at timestamptz,
  telegram_user_id text,
  telegram_username text,
  telegram_locale text,
  source_payload_hash text not null,
  index_version integer not null,
  index_status text not null,
  index_error text,
  indexed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table wallet_intelligence_runs drop constraint if exists wallet_intelligence_runs_job_kind_check;
alter table wallet_intelligence_runs
  add constraint wallet_intelligence_runs_job_kind_check
  check (job_kind in ('address_deep_check', 'where_is_money_check', 'incoming_deposit_check'));

alter table wallet_intelligence_runs drop constraint if exists wallet_intelligence_runs_job_status_check;
alter table wallet_intelligence_runs
  add constraint wallet_intelligence_runs_job_status_check
  check (job_status in ('completed', 'partial'));

alter table wallet_intelligence_runs drop constraint if exists wallet_intelligence_runs_index_status_check;
alter table wallet_intelligence_runs
  add constraint wallet_intelligence_runs_index_status_check
  check (index_status in ('indexed', 'index_failed'));

create index if not exists wallet_intelligence_runs_subject_idx
  on wallet_intelligence_runs(subject_address, completed_at desc);

create index if not exists wallet_intelligence_runs_requester_idx
  on wallet_intelligence_runs(requested_by, completed_at desc);

create table if not exists wallet_intelligence_sightings (
  id text primary key,
  address text not null,
  job_id text not null references forensic_check_jobs(id) on delete cascade,
  job_kind text not null,
  subject_address text not null,
  requested_by text,
  source_kind text not null,
  role text not null,
  depth integer,
  path_id text,
  tx_hash text,
  amount_raw numeric(78, 0),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table wallet_intelligence_sightings drop constraint if exists wallet_intelligence_sightings_job_kind_check;
alter table wallet_intelligence_sightings
  add constraint wallet_intelligence_sightings_job_kind_check
  check (job_kind in ('address_deep_check', 'where_is_money_check', 'incoming_deposit_check'));

alter table wallet_intelligence_sightings drop constraint if exists wallet_intelligence_sightings_source_kind_check;
alter table wallet_intelligence_sightings
  add constraint wallet_intelligence_sightings_source_kind_check
  check (source_kind in (
    'deep_direct_counterparty',
    'deep_second_layer',
    'where_origin_path',
    'where_source_provenance',
    'incoming_origin_path',
    'incoming_funding_bundle'
  ));

alter table wallet_intelligence_sightings drop constraint if exists wallet_intelligence_sightings_role_check;
alter table wallet_intelligence_sightings
  add constraint wallet_intelligence_sightings_role_check
  check (role in (
    'subject',
    'direct_counterparty',
    'second_hop',
    'source',
    'funder',
    'service_boundary',
    'contract',
    'unknown'
  ));

alter table wallet_intelligence_sightings drop constraint if exists wallet_intelligence_sightings_depth_check;
alter table wallet_intelligence_sightings
  add constraint wallet_intelligence_sightings_depth_check
  check (depth is null or depth >= 0);

create index if not exists wallet_intelligence_sightings_address_idx
  on wallet_intelligence_sightings(address, last_seen_at desc);

create index if not exists wallet_intelligence_sightings_job_idx
  on wallet_intelligence_sightings(job_id);

create index if not exists wallet_intelligence_sightings_subject_idx
  on wallet_intelligence_sightings(subject_address);

create index if not exists wallet_intelligence_sightings_requester_idx
  on wallet_intelligence_sightings(requested_by);

create index if not exists wallet_intelligence_sightings_tx_idx
  on wallet_intelligence_sightings(tx_hash)
  where tx_hash is not null;

create table if not exists wallet_intelligence_edges (
  id text primary key,
  from_address text not null,
  to_address text not null,
  job_id text not null references forensic_check_jobs(id) on delete cascade,
  job_kind text not null,
  source_kind text not null,
  depth integer,
  path_id text,
  tx_hash text,
  amount_raw numeric(78, 0),
  timestamp timestamptz,
  edge_role text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table wallet_intelligence_edges drop constraint if exists wallet_intelligence_edges_job_kind_check;
alter table wallet_intelligence_edges
  add constraint wallet_intelligence_edges_job_kind_check
  check (job_kind in ('address_deep_check', 'where_is_money_check', 'incoming_deposit_check'));

alter table wallet_intelligence_edges drop constraint if exists wallet_intelligence_edges_source_kind_check;
alter table wallet_intelligence_edges
  add constraint wallet_intelligence_edges_source_kind_check
  check (source_kind in (
    'deep_direct_counterparty',
    'deep_second_layer',
    'where_origin_path',
    'where_source_provenance',
    'incoming_origin_path',
    'incoming_funding_bundle'
  ));

alter table wallet_intelligence_edges drop constraint if exists wallet_intelligence_edges_role_check;
alter table wallet_intelligence_edges
  add constraint wallet_intelligence_edges_role_check
  check (edge_role in ('transfer', 'context', 'funding', 'service_boundary'));

alter table wallet_intelligence_edges drop constraint if exists wallet_intelligence_edges_depth_check;
alter table wallet_intelligence_edges
  add constraint wallet_intelligence_edges_depth_check
  check (depth is null or depth >= 0);

create index if not exists wallet_intelligence_edges_from_idx
  on wallet_intelligence_edges(from_address, timestamp desc);

create index if not exists wallet_intelligence_edges_to_idx
  on wallet_intelligence_edges(to_address, timestamp desc);

create index if not exists wallet_intelligence_edges_job_idx
  on wallet_intelligence_edges(job_id);

create index if not exists wallet_intelligence_edges_tx_idx
  on wallet_intelligence_edges(tx_hash)
  where tx_hash is not null;

create table if not exists wallet_intelligence_address_summary (
  address text primary key,
  unique_subject_count integer not null default 0,
  unique_requester_count integer not null default 0,
  job_count integer not null default 0,
  completed_job_count integer not null default 0,
  partial_job_count integer not null default 0,
  occurrence_count integer not null default 0,
  distinct_tx_count integer not null default 0,
  distinct_amount_raw numeric(78, 0) not null default 0,
  min_depth integer,
  max_depth integer,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  modes jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  service_categories jsonb not null default '[]'::jsonb,
  label_hints jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists wallet_intelligence_address_summary_rank_idx
  on wallet_intelligence_address_summary(
    unique_subject_count desc,
    unique_requester_count desc,
    job_count desc,
    last_seen_at desc
  );

create index if not exists wallet_intelligence_address_summary_tags_idx
  on wallet_intelligence_address_summary using gin(tags);

create index if not exists wallet_intelligence_address_summary_categories_idx
  on wallet_intelligence_address_summary using gin(service_categories);
```

- [ ] **Step 4: Add exported repository types**

In `src/storage/repositories.ts`, add the following near the existing forensic job types:

```typescript
export type WalletIntelligenceSupportedJobKind =
  | "address_deep_check"
  | "where_is_money_check"
  | "incoming_deposit_check";

export type WalletIntelligenceJobStatus = Extract<ForensicCheckJobStatus, "completed" | "partial">;
export type WalletIntelligenceIndexStatus = "indexed" | "index_failed";

export type WalletIntelligenceSourceKind =
  | "deep_direct_counterparty"
  | "deep_second_layer"
  | "where_origin_path"
  | "where_source_provenance"
  | "incoming_origin_path"
  | "incoming_funding_bundle";

export type WalletIntelligenceRole =
  | "subject"
  | "direct_counterparty"
  | "second_hop"
  | "source"
  | "funder"
  | "service_boundary"
  | "contract"
  | "unknown";

export type WalletIntelligenceEdgeRole = "transfer" | "context" | "funding" | "service_boundary";

export type WalletIntelligenceTag =
  | "repeated_cross_run_address"
  | "high_activity_wallet"
  | "large_liquidity_wallet"
  | "possible_service_or_exchange_like"
  | "known_service_or_exchange"
  | "cross_mode_seen";

export type WalletIntelligenceRunInput = {
  jobId: string;
  jobKind: WalletIntelligenceSupportedJobKind;
  jobStatus: WalletIntelligenceJobStatus;
  subjectAddress: string;
  requestedBy: string | null;
  chatId: string | null;
  messageId: string | null;
  completedAt: Date | null;
  telegramUserId: string | null;
  telegramUsername: string | null;
  telegramLocale: BotLocale | null;
  sourcePayloadHash: string;
  indexVersion: number;
  indexStatus: WalletIntelligenceIndexStatus;
  indexError: string | null;
};

export type WalletIntelligenceSightingInput = {
  id: string;
  address: string;
  jobId: string;
  jobKind: WalletIntelligenceSupportedJobKind;
  subjectAddress: string;
  requestedBy: string | null;
  sourceKind: WalletIntelligenceSourceKind;
  role: WalletIntelligenceRole;
  depth: number | null;
  pathId: string | null;
  txHash: string | null;
  amountRaw: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  metadataJson: Record<string, unknown>;
};

export type WalletIntelligenceEdgeInput = {
  id: string;
  fromAddress: string;
  toAddress: string;
  jobId: string;
  jobKind: WalletIntelligenceSupportedJobKind;
  sourceKind: WalletIntelligenceSourceKind;
  depth: number | null;
  pathId: string | null;
  txHash: string | null;
  amountRaw: string | null;
  timestamp: Date | null;
  edgeRole: WalletIntelligenceEdgeRole;
  metadataJson: Record<string, unknown>;
};

export type WalletIntelligenceAddressSummary = {
  address: string;
  uniqueSubjectCount: number;
  uniqueRequesterCount: number;
  jobCount: number;
  completedJobCount: number;
  partialJobCount: number;
  occurrenceCount: number;
  distinctTxCount: number;
  distinctAmountRaw: string;
  minDepth: number | null;
  maxDepth: number | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  modes: WalletIntelligenceSupportedJobKind[];
  tags: WalletIntelligenceTag[];
  serviceCategories: string[];
  labelHints: string[];
};
```

- [ ] **Step 5: Run test to verify types pass**

Run:

```powershell
npm test -- --run tests/storage/walletIntelligence.test.ts
```

Expected: PASS for the new type-shape test.

- [ ] **Step 6: Commit schema and types**

Run:

```powershell
git add migrations/029_wallet_intelligence.sql src/storage/repositories.ts tests/storage/walletIntelligence.test.ts
git commit -m "feat(wallet-intelligence): add schema and types"
```

Expected: commit succeeds.

---

### Task 2: Pure Wallet Intelligence Extractor

**Files:**
- Create: `src/forensics/walletIntelligence.ts`
- Modify: `tests/forensics/walletIntelligence.test.ts`

- [ ] **Step 1: Write failing extractor tests**

Create `tests/forensics/walletIntelligence.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { ForensicCheckJob } from "../../src/storage/repositories";
import {
  WALLET_INTELLIGENCE_INDEX_VERSION,
  extractWalletIntelligenceFromJob,
  sourcePayloadHash,
  supportedWalletIntelligenceJob
} from "../../src/forensics/walletIntelligence";

function baseJob(overrides: Partial<ForensicCheckJob> = {}): ForensicCheckJob {
  return {
    id: "job-1",
    kind: "address_deep_check",
    subjectAddress: "TSubject111111111111111111111111111111",
    status: "completed",
    windowStart: new Date("2026-07-06T00:00:00.000Z"),
    windowEnd: new Date("2026-07-06T01:00:00.000Z"),
    priority: 100,
    chatId: "42",
    messageId: "77",
    requestedBy: "42",
    progressJson: {},
    resultJson: {},
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: new Date("2026-07-06T00:00:00.000Z"),
    updatedAt: new Date("2026-07-06T01:00:00.000Z"),
    startedAt: new Date("2026-07-06T00:00:01.000Z"),
    completedAt: new Date("2026-07-06T01:00:00.000Z"),
    ...overrides
  };
}

describe("wallet intelligence extraction", () => {
  it("supports only completed or partial DeepCheck, Where, and Incoming jobs", () => {
    expect(supportedWalletIntelligenceJob(baseJob())).toBe(true);
    expect(supportedWalletIntelligenceJob(baseJob({ kind: "where_is_money_check" }))).toBe(true);
    expect(supportedWalletIntelligenceJob(baseJob({ kind: "incoming_deposit_check" }))).toBe(true);
    expect(supportedWalletIntelligenceJob(baseJob({ kind: "address_fast_check" }))).toBe(false);
    expect(supportedWalletIntelligenceJob(baseJob({ status: "running" }))).toBe(false);
    expect(WALLET_INTELLIGENCE_INDEX_VERSION).toBe(1);
  });

  it("hashes result payload plus relevant incoming progress fields", () => {
    const first = sourcePayloadHash(baseJob({
      kind: "incoming_deposit_check",
      resultJson: { originPaths: [] },
      progressJson: { depositTxHash: "tx-1", sender: "TSender", watchedWallet: "TWallet" }
    }));
    const second = sourcePayloadHash(baseJob({
      kind: "incoming_deposit_check",
      resultJson: { originPaths: [] },
      progressJson: { depositTxHash: "tx-2", sender: "TSender", watchedWallet: "TWallet" }
    }));

    expect(first).not.toBe(second);
  });

  it("extracts DeepCheck direct counterparties and second-layer paths", () => {
    const extracted = extractWalletIntelligenceFromJob(baseJob({
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        directCounterpartyInteractionProfiles: [{
          subjectAddress: "TSubject111111111111111111111111111111",
          direction: "inbound",
          counterpartyAddress: "TDirect1111111111111111111111111111111",
          volumeRaw: "1000000",
          txCount: 1,
          firstSeen: "2026-07-06T00:10:00.000Z",
          lastSeen: "2026-07-06T00:10:00.000Z",
          txHashes: ["tx-direct"],
          transfers: [{
            txHash: "tx-direct",
            fromAddress: "TDirect1111111111111111111111111111111",
            toAddress: "TSubject111111111111111111111111111111",
            amountRaw: "1000000",
            timestamp: "2026-07-06T00:10:00.000Z",
            method: "transfer",
            edgeType: "normal_transfer"
          }],
          serviceCategory: null,
          identity: null,
          snapshot: {},
          interactionWeight: 1,
          scoreContribution: 0,
          evidenceClass: "behavior",
          skippedReason: null
        }],
        secondLayerRelationshipProfiles: {
          paths: [{
            id: "second-path-1",
            directWalletAddress: "TDirect1111111111111111111111111111111",
            secondHopAddress: "TSecond1111111111111111111111111111111",
            pathAddresses: [
              "TSubject111111111111111111111111111111",
              "TDirect1111111111111111111111111111111",
              "TSecond1111111111111111111111111111111"
            ],
            txHashes: ["tx-second"],
            amountRaw: "2000000",
            firstSeen: "2026-07-06T00:20:00.000Z",
            lastSeen: "2026-07-06T00:20:00.000Z",
            evidence: [{
              txHash: "tx-second",
              fromAddress: "TSecond1111111111111111111111111111111",
              toAddress: "TDirect1111111111111111111111111111111",
              amountRaw: "2000000",
              timestamp: "2026-07-06T00:20:00.000Z"
            }]
          }],
          groups: []
        }
      }
    }));

    expect(extracted.run.jobKind).toBe("address_deep_check");
    expect(extracted.sightings.map((item) => item.address)).toContain("TDirect1111111111111111111111111111111");
    expect(extracted.sightings.map((item) => item.address)).toContain("TSecond1111111111111111111111111111111");
    expect(extracted.edges.map((item) => item.txHash)).toEqual(expect.arrayContaining(["tx-direct", "tx-second"]));
  });

  it("extracts Where origin steps and source provenance context", () => {
    const extracted = extractWalletIntelligenceFromJob(baseJob({
      kind: "where_is_money_check",
      resultJson: {
        originPaths: [{
          pathAddresses: ["TSource1111111111111111111111111111111", "TSubject111111111111111111111111111111"],
          txHashes: ["tx-where"],
          steps: [{
            txHash: "tx-where",
            fromAddress: "TSource1111111111111111111111111111111",
            toAddress: "TSubject111111111111111111111111111111",
            amountRaw: "3000000",
            timestamp: "2026-07-06T00:30:00.000Z",
            method: "transfer",
            edgeType: "normal_transfer"
          }],
          sourceProvenance: [{
            mode: "source_provenance",
            targetTxHash: "tx-where",
            targetFromAddress: "TSource1111111111111111111111111111111",
            targetToAddress: "TSubject111111111111111111111111111111",
            targetTimestamp: "2026-07-06T00:30:00.000Z",
            targetAmountRaw: "3000000",
            proofClass: "probable",
            coveredAmountRaw: "3000000",
            coverageRatio: 1,
            amountContinuity: "strong",
            stopReason: null,
            fundingBundle: null,
            coverageWindow: { startTimestamp: null, endTimestamp: "2026-07-06T00:30:00.000Z", complete: false, capped: true, providerInconsistent: false },
            reasons: ["capped_window"]
          }]
        }]
      }
    }));

    expect(extracted.sightings.some((item) => item.sourceKind === "where_source_provenance")).toBe(true);
    expect(extracted.edges[0]).toMatchObject({ txHash: "tx-where", edgeRole: "transfer" });
  });

  it("extracts Incoming origin paths and funding bundles", () => {
    const extracted = extractWalletIntelligenceFromJob(baseJob({
      kind: "incoming_deposit_check",
      progressJson: {
        depositTxHash: "tx-deposit",
        watchedWallet: "TWatched11111111111111111111111111111",
        sender: "TSender1111111111111111111111111111111"
      },
      resultJson: {
        originPaths: [{
          pathAddresses: ["TFunder111111111111111111111111111111", "TSender1111111111111111111111111111111"],
          txHashes: ["tx-fund"],
          steps: [{
            txHash: "tx-fund",
            fromAddress: "TFunder111111111111111111111111111111",
            toAddress: "TSender1111111111111111111111111111111",
            amountRaw: "4000000",
            timestamp: "2026-07-06T00:40:00.000Z",
            method: "transfer",
            edgeType: "normal_transfer"
          }],
          fundingBundles: [{
            targetTxHash: "tx-fund",
            fundingAddresses: ["TFunder111111111111111111111111111111"],
            fundingFunders: [{
              address: "TUpstream11111111111111111111111111111",
              amountRaw: "4000000",
              txHashes: ["tx-upstream"]
            }]
          }]
        }]
      }
    }));

    expect(extracted.sightings.map((item) => item.address)).toContain("TUpstream11111111111111111111111111111");
    expect(extracted.sightings.some((item) => item.sourceKind === "incoming_funding_bundle")).toBe(true);
  });

  it("keeps tags neutral and never emits risk terms", () => {
    const extracted = extractWalletIntelligenceFromJob(baseJob({
      resultJson: {
        directCounterpartyInteractionProfiles: [{
          counterpartyAddress: "TDirect1111111111111111111111111111111",
          serviceCategory: "cex",
          txCount: 50,
          volumeRaw: "1000000000000"
        }]
      }
    }));
    const serialized = JSON.stringify(extracted);

    expect(serialized).not.toContain("suspicious");
    expect(serialized).not.toContain("dirty");
    expect(serialized).not.toContain("risk_score");
  });
});
```

- [ ] **Step 2: Run extractor tests and verify failure**

Run:

```powershell
npm test -- --run tests/forensics/walletIntelligence.test.ts
```

Expected: FAIL because `src/forensics/walletIntelligence.ts` does not exist.

- [ ] **Step 3: Implement extractor module**

Create `src/forensics/walletIntelligence.ts` with this structure and names:

```typescript
import { createHash } from "node:crypto";
import type {
  ForensicCheckJob,
  WalletIntelligenceEdgeInput,
  WalletIntelligenceRunInput,
  WalletIntelligenceSightingInput,
  WalletIntelligenceSupportedJobKind
} from "../storage/repositories";

export const WALLET_INTELLIGENCE_INDEX_VERSION = 1;

export type WalletIntelligenceExtraction = {
  run: WalletIntelligenceRunInput;
  sightings: WalletIntelligenceSightingInput[];
  edges: WalletIntelligenceEdgeInput[];
  touchedAddresses: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateField(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(stableJson(parts)).digest("hex");
}

function isSupportedKind(kind: string): kind is WalletIntelligenceSupportedJobKind {
  return kind === "address_deep_check" || kind === "where_is_money_check" || kind === "incoming_deposit_check";
}

export function supportedWalletIntelligenceJob(job: ForensicCheckJob): boolean {
  return isSupportedKind(job.kind) && (job.status === "completed" || job.status === "partial") && Object.keys(job.resultJson).length > 0;
}

function relevantProgressPayload(job: ForensicCheckJob): Record<string, unknown> {
  return {
    depositTxHash: job.progressJson.depositTxHash ?? null,
    watchedWallet: job.progressJson.watchedWallet ?? null,
    sender: job.progressJson.sender ?? null,
    amountRaw: job.progressJson.amountRaw ?? null,
    timestamp: job.progressJson.timestamp ?? null
  };
}

export function sourcePayloadHash(job: ForensicCheckJob): string {
  return createHash("sha256").update(stableJson({
    indexVersion: WALLET_INTELLIGENCE_INDEX_VERSION,
    resultJson: job.resultJson,
    progressJson: relevantProgressPayload(job)
  })).digest("hex");
}

function addUnique<T extends { id: string }>(items: T[], item: T): void {
  if (!items.some((existing) => existing.id === item.id)) items.push(item);
}

function addSighting(
  sightings: WalletIntelligenceSightingInput[],
  input: Omit<WalletIntelligenceSightingInput, "id">
): void {
  addUnique(sightings, {
    id: stableId(["wallet_intelligence_sighting", input.jobId, input.address, input.sourceKind, input.role, input.pathId, input.depth, input.txHash]),
    ...input
  });
}

function addEdge(
  edges: WalletIntelligenceEdgeInput[],
  input: Omit<WalletIntelligenceEdgeInput, "id">
): void {
  addUnique(edges, {
    id: stableId(["wallet_intelligence_edge", input.jobId, input.fromAddress, input.toAddress, input.txHash, input.pathId, input.depth, input.sourceKind]),
    ...input
  });
}
```

After the helpers, implement `extractWalletIntelligenceFromJob(job)` by calling focused private functions:

```typescript
export function extractWalletIntelligenceFromJob(job: ForensicCheckJob): WalletIntelligenceExtraction {
  if (!supportedWalletIntelligenceJob(job) || !isSupportedKind(job.kind)) {
    throw new Error(`Unsupported wallet intelligence job: ${job.kind}/${job.status}`);
  }
  const sightings: WalletIntelligenceSightingInput[] = [];
  const edges: WalletIntelligenceEdgeInput[] = [];
  const run: WalletIntelligenceRunInput = {
    jobId: job.id,
    jobKind: job.kind,
    jobStatus: job.status,
    subjectAddress: job.subjectAddress,
    requestedBy: job.requestedBy,
    chatId: job.chatId,
    messageId: job.messageId,
    completedAt: job.completedAt,
    telegramUserId: null,
    telegramUsername: null,
    telegramLocale: null,
    sourcePayloadHash: sourcePayloadHash(job),
    indexVersion: WALLET_INTELLIGENCE_INDEX_VERSION,
    indexStatus: "indexed",
    indexError: null
  };

  if (job.kind === "address_deep_check") extractDeepCheck(job, sightings, edges);
  if (job.kind === "where_is_money_check") extractWhere(job, sightings, edges);
  if (job.kind === "incoming_deposit_check") extractIncoming(job, sightings, edges);

  return {
    run,
    sightings,
    edges,
    touchedAddresses: [...new Set([
      ...sightings.map((item) => item.address),
      ...edges.flatMap((edge) => [edge.fromAddress, edge.toAddress])
    ])]
  };
}
```

Implement `extractDeepCheck`, `extractWhere`, and `extractIncoming` using the field names from the tests. Keep the first version direct and boring:

- use `directCounterpartyInteractionProfiles[].counterpartyAddress`;
- use `directCounterpartyInteractionProfiles[].transfers[]` when present;
- use `secondLayerRelationshipProfiles.paths[].evidence[]` for second-layer edges;
- use `secondLayerRelationshipProfiles.groups[].members[]` for grouped sightings only;
- use `originPaths[].steps[]` for Where and Incoming transfer edges;
- use `originPaths[].pathAddresses[]` for path sightings with depth equal to array index;
- use Where `sourceProvenance.targetFromAddress` and `targetToAddress` as context sightings;
- use Incoming `fundingBundles[].fundingAddresses[]` and `fundingFunders[].address` as funding sightings.

- [ ] **Step 4: Run extractor tests**

Run:

```powershell
npm test -- --run tests/forensics/walletIntelligence.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit extractor**

Run:

```powershell
git add src/forensics/walletIntelligence.ts tests/forensics/walletIntelligence.test.ts
git commit -m "feat(wallet-intelligence): extract saved job relationships"
```

Expected: commit succeeds.

---

### Task 3: Repository Persistence, Summary Refresh, And Queries

**Files:**
- Modify: `src/storage/repositories.ts`
- Modify: `tests/storage/walletIntelligence.test.ts`

- [ ] **Step 1: Add failing repository persistence and ranking tests**

Append to `tests/storage/walletIntelligence.test.ts`:

```typescript
import {
  getWalletIntelligenceAddressDetail,
  getWalletIntelligenceRunState,
  indexWalletIntelligenceJobPayload,
  listWalletIntelligenceAddressSummaries,
  listWalletIntelligenceBackfillJobs
} from "../../src/storage/repositories";

function createMockDb(rows: Record<string, unknown>[][] = []) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let index = 0;
  return {
    queries,
    db: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return { rows: rows[index++] ?? [], rowCount: rows[index - 1]?.length ?? 0 };
      },
      connect: async () => ({
        query: async (sql: string, params: unknown[] = []) => {
          queries.push({ sql, params });
          return { rows: rows[index++] ?? [], rowCount: rows[index - 1]?.length ?? 0 };
        },
        release: () => undefined
      })
    } as any
  };
}

describe("wallet intelligence repositories", () => {
  it("indexes a job payload transactionally and refreshes touched summaries", async () => {
    const { db, queries } = createMockDb();

    await indexWalletIntelligenceJobPayload(db, {
      run: {
        jobId: "job-1",
        jobKind: "address_deep_check",
        jobStatus: "completed",
        subjectAddress: "TSubject111111111111111111111111111111",
        requestedBy: "42",
        chatId: "42",
        messageId: "77",
        completedAt: new Date("2026-07-06T10:00:00.000Z"),
        telegramUserId: "42",
        telegramUsername: "client_user",
        telegramLocale: "ru",
        sourcePayloadHash: "hash-1",
        indexVersion: 1,
        indexStatus: "indexed",
        indexError: null
      },
      sightings: [],
      edges: [],
      touchedAddresses: ["TSeen1111111111111111111111111111111"]
    });

    expect(queries[0].sql).toBe("begin");
    expect(queries.some((query) => query.sql.includes("insert into wallet_intelligence_runs"))).toBe(true);
    expect(queries.some((query) => query.sql.includes("delete from wallet_intelligence_sightings where job_id = $1"))).toBe(true);
    expect(queries.some((query) => query.sql.includes("insert into wallet_intelligence_address_summary"))).toBe(true);
    expect(queries.at(-1)?.sql).toBe("commit");
  });

  it("lists backfill jobs from completed and partial supported modes only", async () => {
    const { db, queries } = createMockDb([[]]);

    await listWalletIntelligenceBackfillJobs(db, { limit: 25, offset: 5 });

    expect(queries[0].sql).toContain("from forensic_check_jobs job");
    expect(queries[0].sql).toContain("kind in ('address_deep_check', 'where_is_money_check', 'incoming_deposit_check')");
    expect(queries[0].sql).toContain("status in ('completed', 'partial')");
    expect(queries[0].sql).toContain("result_json <> '{}'::jsonb");
    expect(queries[0].params).toEqual([25, 5]);
  });

  it("reads an indexed run state for idempotent backfill skips", async () => {
    const { db, queries } = createMockDb([[
      { source_payload_hash: "hash-1", index_version: 1, index_status: "indexed" }
    ]]);

    const state = await getWalletIntelligenceRunState(db, "job-1");

    expect(state).toEqual({
      sourcePayloadHash: "hash-1",
      indexVersion: 1,
      indexStatus: "indexed"
    });
    expect(queries[0].sql).toContain("from wallet_intelligence_runs");
    expect(queries[0].params).toEqual(["job-1"]);
  });

  it("lists address summaries ranked by unique subjects then requesters", async () => {
    const { db, queries } = createMockDb([[
      {
        address: "TSeen1111111111111111111111111111111",
        unique_subject_count: 3,
        unique_requester_count: 2,
        job_count: 5,
        completed_job_count: 4,
        partial_job_count: 1,
        occurrence_count: 8,
        distinct_tx_count: 2,
        distinct_amount_raw: "3000000",
        min_depth: 1,
        max_depth: 2,
        first_seen_at: new Date("2026-07-06T09:00:00.000Z"),
        last_seen_at: new Date("2026-07-06T10:00:00.000Z"),
        modes: ["address_deep_check"],
        tags: ["repeated_cross_run_address"],
        service_categories: [],
        label_hints: []
      }
    ]]);

    const rows = await listWalletIntelligenceAddressSummaries(db, {
      limit: 20,
      offset: 0,
      minUniqueSubjects: 2,
      minUniqueRequesters: 2,
      tag: "repeated_cross_run_address"
    });

    expect(rows[0]?.address).toBe("TSeen1111111111111111111111111111111");
    expect(rows[0]?.distinctAmountRaw).toBe("3000000");
    expect(queries[0].sql).toContain("unique_subject_count >= $1");
    expect(queries[0].sql).toContain("unique_requester_count >= $2");
    expect(queries[0].sql).toContain("tags ? $3");
    expect(queries[0].sql).toContain("order by unique_subject_count desc, unique_requester_count desc, job_count desc, last_seen_at desc");
  });

  it("loads address detail with requesters, jobs, sightings, edges, and labels", async () => {
    const { db, queries } = createMockDb([
      [{
        address: "TSeen1111111111111111111111111111111",
        unique_subject_count: 1,
        unique_requester_count: 1,
        job_count: 1,
        completed_job_count: 1,
        partial_job_count: 0,
        occurrence_count: 1,
        distinct_tx_count: 1,
        distinct_amount_raw: "1000000",
        min_depth: 1,
        max_depth: 1,
        first_seen_at: new Date("2026-07-06T09:00:00.000Z"),
        last_seen_at: new Date("2026-07-06T09:00:00.000Z"),
        modes: ["address_deep_check"],
        tags: ["repeated_cross_run_address"],
        service_categories: ["cex"],
        label_hints: ["Binance"]
      }],
      [{ requested_by: "42", telegram_user_id: "42", username: "client_user", locale: "ru", chat_id: "42", message_id: "77", job_count: 1 }],
      [{ job_id: "job-1", job_kind: "address_deep_check", job_status: "completed", subject_address: "TSubject111111111111111111111111111111", completed_at: new Date("2026-07-06T10:00:00.000Z") }],
      [{ id: "sighting-1", address: "TSeen1111111111111111111111111111111", job_id: "job-1", job_kind: "address_deep_check", subject_address: "TSubject111111111111111111111111111111", requested_by: "42", source_kind: "deep_direct_counterparty", role: "direct_counterparty", depth: 1, path_id: "p", tx_hash: "tx-1", amount_raw: "1000000", first_seen_at: new Date("2026-07-06T09:00:00.000Z"), last_seen_at: new Date("2026-07-06T09:00:00.000Z"), metadata_json: {} }],
      [{ id: "edge-1", from_address: "TSeen1111111111111111111111111111111", to_address: "TSubject111111111111111111111111111111", job_id: "job-1", job_kind: "address_deep_check", source_kind: "deep_direct_counterparty", depth: 1, path_id: "p", tx_hash: "tx-1", amount_raw: "1000000", timestamp: new Date("2026-07-06T09:00:00.000Z"), edge_role: "transfer", metadata_json: {} }]
    ]);

    const detail = await getWalletIntelligenceAddressDetail(db, "TSeen1111111111111111111111111111111");

    expect(detail?.summary.address).toBe("TSeen1111111111111111111111111111111");
    expect(detail?.requesters[0]?.username).toBe("client_user");
    expect(detail?.jobs[0]?.jobId).toBe("job-1");
    expect(detail?.sightings[0]?.sourceKind).toBe("deep_direct_counterparty");
    expect(detail?.edges[0]?.txHash).toBe("tx-1");
    expect(queries).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run repository tests and verify failure**

Run:

```powershell
npm test -- --run tests/storage/walletIntelligence.test.ts
```

Expected: FAIL because repository functions are missing.

- [ ] **Step 3: Add repository input/query types**

In `src/storage/repositories.ts`, add:

```typescript
export type WalletIntelligenceIndexPayload = {
  run: WalletIntelligenceRunInput;
  sightings: WalletIntelligenceSightingInput[];
  edges: WalletIntelligenceEdgeInput[];
  touchedAddresses: string[];
};

export type ListWalletIntelligenceBackfillJobsInput = {
  limit?: number;
  offset?: number;
};

export type ListWalletIntelligenceAddressSummariesInput = {
  limit?: number;
  offset?: number;
  mode?: WalletIntelligenceSupportedJobKind;
  tag?: WalletIntelligenceTag;
  minUniqueSubjects?: number;
  minUniqueRequesters?: number;
  startDate?: Date;
  endDate?: Date;
  addressQuery?: string;
  minDepth?: number;
  maxDepth?: number;
  minDistinctAmountRaw?: string;
  maxDistinctAmountRaw?: string;
  serviceCategory?: string;
  requesterQuery?: string;
  subjectAddress?: string;
  jobStatus?: WalletIntelligenceJobStatus;
};

export type WalletIntelligenceRequesterSummary = {
  requestedBy: string | null;
  telegramUserId: string | null;
  username: string | null;
  locale: BotLocale | null;
  chatId: string | null;
  messageId: string | null;
  jobCount: number;
};

export type WalletIntelligenceSourceJobSummary = {
  jobId: string;
  jobKind: WalletIntelligenceSupportedJobKind;
  jobStatus: WalletIntelligenceJobStatus;
  subjectAddress: string;
  completedAt: Date | null;
};

export type WalletIntelligenceSighting = WalletIntelligenceSightingInput;
export type WalletIntelligenceEdge = WalletIntelligenceEdgeInput;

export type WalletIntelligenceAddressDetail = {
  summary: WalletIntelligenceAddressSummary;
  requesters: WalletIntelligenceRequesterSummary[];
  jobs: WalletIntelligenceSourceJobSummary[];
  sightings: WalletIntelligenceSighting[];
  edges: WalletIntelligenceEdge[];
};

export type WalletIntelligenceRunState = {
  sourcePayloadHash: string;
  indexVersion: number;
  indexStatus: WalletIntelligenceIndexStatus;
};
```

- [ ] **Step 4: Add row mappers**

Add helper mappers near existing mapper functions:

```typescript
function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function jsonWalletTags(value: unknown): WalletIntelligenceTag[] {
  const allowed = new Set<WalletIntelligenceTag>([
    "repeated_cross_run_address",
    "high_activity_wallet",
    "large_liquidity_wallet",
    "possible_service_or_exchange_like",
    "known_service_or_exchange",
    "cross_mode_seen"
  ]);
  return jsonStringArray(value).filter((item): item is WalletIntelligenceTag => allowed.has(item as WalletIntelligenceTag));
}

function mapWalletIntelligenceAddressSummaryRow(row: Record<string, any>): WalletIntelligenceAddressSummary {
  return {
    address: row.address,
    uniqueSubjectCount: Number(row.unique_subject_count ?? 0),
    uniqueRequesterCount: Number(row.unique_requester_count ?? 0),
    jobCount: Number(row.job_count ?? 0),
    completedJobCount: Number(row.completed_job_count ?? 0),
    partialJobCount: Number(row.partial_job_count ?? 0),
    occurrenceCount: Number(row.occurrence_count ?? 0),
    distinctTxCount: Number(row.distinct_tx_count ?? 0),
    distinctAmountRaw: String(row.distinct_amount_raw ?? "0"),
    minDepth: nullableNumber(row.min_depth),
    maxDepth: nullableNumber(row.max_depth),
    firstSeenAt: row.first_seen_at ?? null,
    lastSeenAt: row.last_seen_at ?? null,
    modes: jsonStringArray(row.modes) as WalletIntelligenceSupportedJobKind[],
    tags: jsonWalletTags(row.tags),
    serviceCategories: jsonStringArray(row.service_categories),
    labelHints: jsonStringArray(row.label_hints)
  };
}
```

Use the existing `nullableNumber` helper if available in the file. If its local position makes it inaccessible, move the mapper below it instead of duplicating logic.

- [ ] **Step 5: Implement persistence and summary refresh**

Add `indexWalletIntelligenceJobPayload`:

```typescript
export async function indexWalletIntelligenceJobPayload(db: Db, input: WalletIntelligenceIndexPayload): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into wallet_intelligence_runs (
         job_id, job_kind, job_status, subject_address, requested_by,
         chat_id, message_id, completed_at, telegram_user_id, telegram_username,
         telegram_locale, source_payload_hash, index_version, index_status, index_error
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       on conflict (job_id) do update set
         job_kind = excluded.job_kind,
         job_status = excluded.job_status,
         subject_address = excluded.subject_address,
         requested_by = excluded.requested_by,
         chat_id = excluded.chat_id,
         message_id = excluded.message_id,
         completed_at = excluded.completed_at,
         telegram_user_id = excluded.telegram_user_id,
         telegram_username = excluded.telegram_username,
         telegram_locale = excluded.telegram_locale,
         source_payload_hash = excluded.source_payload_hash,
         index_version = excluded.index_version,
         index_status = excluded.index_status,
         index_error = excluded.index_error,
         indexed_at = now(),
         updated_at = now()`,
      [
        input.run.jobId,
        input.run.jobKind,
        input.run.jobStatus,
        input.run.subjectAddress,
        input.run.requestedBy,
        input.run.chatId,
        input.run.messageId,
        input.run.completedAt,
        input.run.telegramUserId,
        input.run.telegramUsername,
        input.run.telegramLocale,
        input.run.sourcePayloadHash,
        input.run.indexVersion,
        input.run.indexStatus,
        input.run.indexError
      ]
    );

    await client.query(`delete from wallet_intelligence_sightings where job_id = $1`, [input.run.jobId]);
    await client.query(`delete from wallet_intelligence_edges where job_id = $1`, [input.run.jobId]);

    for (const sighting of input.sightings) {
      await client.query(
        `insert into wallet_intelligence_sightings (
           id, address, job_id, job_kind, subject_address, requested_by,
           source_kind, role, depth, path_id, tx_hash, amount_raw,
           first_seen_at, last_seen_at, metadata_json
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::numeric, $13, $14, $15)
         on conflict (id) do update set
           metadata_json = excluded.metadata_json,
           updated_at = now()`,
        [
          sighting.id,
          sighting.address,
          sighting.jobId,
          sighting.jobKind,
          sighting.subjectAddress,
          sighting.requestedBy,
          sighting.sourceKind,
          sighting.role,
          sighting.depth,
          sighting.pathId,
          sighting.txHash,
          sighting.amountRaw,
          sighting.firstSeenAt,
          sighting.lastSeenAt,
          sighting.metadataJson
        ]
      );
    }

    for (const edge of input.edges) {
      await client.query(
        `insert into wallet_intelligence_edges (
           id, from_address, to_address, job_id, job_kind, source_kind,
           depth, path_id, tx_hash, amount_raw, timestamp, edge_role, metadata_json
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric, $11, $12, $13)
         on conflict (id) do update set
           metadata_json = excluded.metadata_json,
           updated_at = now()`,
        [
          edge.id,
          edge.fromAddress,
          edge.toAddress,
          edge.jobId,
          edge.jobKind,
          edge.sourceKind,
          edge.depth,
          edge.pathId,
          edge.txHash,
          edge.amountRaw,
          edge.timestamp,
          edge.edgeRole,
          edge.metadataJson
        ]
      );
    }

    await refreshWalletIntelligenceAddressSummariesWithClient(client, input.touchedAddresses);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
```

Implement `refreshWalletIntelligenceAddressSummariesWithClient(client, addresses)` with one SQL `insert into ... select` query. The query should:

- `delete from wallet_intelligence_address_summary where address = any($1::text[])` before reinsert for touched addresses;
- aggregate from `wallet_intelligence_sightings`;
- join `wallet_intelligence_runs`;
- compute `count(distinct subject_address)`;
- compute `count(distinct requested_by) filter (where requested_by is not null)`;
- compute `count(distinct job_id)`;
- compute `count(*)` as `occurrence_count`;
- compute `count(distinct tx_hash) filter (where tx_hash is not null)` as `distinct_tx_count`;
- compute `sum(amount_raw)` from a CTE that first dedupes `(address, tx_hash, amount_raw)`; do not use `sum(distinct amount_raw)`, because two different txs can have the same amount;
- set tags with SQL case logic for:
  - `repeated_cross_run_address` when unique subjects > 1 or unique requesters > 1;
  - `cross_mode_seen` when mode count > 1;
  - `large_liquidity_wallet` when distinct amount is at least `1000000000000`;
  - `high_activity_wallet` when occurrence count >= 25 or distinct tx count >= 25;
  - `known_service_or_exchange` when label/cache category is in `cex`, `bridge`, `router`, `dex`, `hot_wallet`;
  - `possible_service_or_exchange_like` when unique subject count >= 3 and distinct tx count >= 10.

This is intentionally simple V1 calibration.

- [ ] **Step 6: Implement backfill/list/detail queries**

Add:

```typescript
export async function listWalletIntelligenceBackfillJobs(
  db: Db,
  input: ListWalletIntelligenceBackfillJobsInput = {}
): Promise<ForensicCheckJob[]> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const offset = Math.max(input.offset ?? 0, 0);
  const result = await db.query(
    `select job.id, job.kind, job.subject_address, job.status, job.window_start, job.window_end,
       job.priority, job.chat_id, job.message_id, job.requested_by, job.progress_json, job.result_json,
       job.raw_evidence_ids, job.observation_ids, job.last_error, job.created_at, job.updated_at,
       job.started_at, job.completed_at
     from forensic_check_jobs job
     left join wallet_intelligence_runs run on run.job_id = job.id
     where job.kind in ('address_deep_check', 'where_is_money_check', 'incoming_deposit_check')
       and job.status in ('completed', 'partial')
       and job.result_json <> '{}'::jsonb
     order by job.completed_at asc nulls last, job.created_at asc
     limit $1 offset $2`,
    [limit, offset]
  );
  return result.rows.map(mapForensicCheckJobRow);
}
```

Implement `listWalletIntelligenceAddressSummaries` and `getWalletIntelligenceAddressDetail` using the filter names from the tests and Admin spec. Escape ILIKE patterns the same way `listAdminForensicCheckJobs` does.

Implement `getWalletIntelligenceRunState`:

```typescript
export async function getWalletIntelligenceRunState(db: Db, jobId: string): Promise<WalletIntelligenceRunState | null> {
  const result = await db.query(
    `select source_payload_hash, index_version, index_status
     from wallet_intelligence_runs
     where job_id = $1`,
    [jobId]
  );
  const row = result.rows[0];
  return row ? {
    sourcePayloadHash: row.source_payload_hash,
    indexVersion: Number(row.index_version),
    indexStatus: row.index_status
  } : null;
}
```

- [ ] **Step 7: Run repository tests**

Run:

```powershell
npm test -- --run tests/storage/walletIntelligence.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit repository implementation**

Run:

```powershell
git add src/storage/repositories.ts tests/storage/walletIntelligence.test.ts
git commit -m "feat(wallet-intelligence): persist and query address intelligence"
```

Expected: commit succeeds.

---

### Task 4: Backfill Script

**Files:**
- Create: `scripts/backfillWalletIntelligence.ts`
- Modify: `package.json`

- [ ] **Step 1: Add script command**

Modify `package.json` scripts:

```json
"wallet-intelligence:backfill": "node --import tsx scripts/backfillWalletIntelligence.ts"
```

- [ ] **Step 2: Create backfill script**

Create `scripts/backfillWalletIntelligence.ts`:

```typescript
import "dotenv/config";
import { closeDb, createDb } from "../src/storage/db";
import {
  getTelegramUserProfile,
  getWalletIntelligenceRunState,
  indexWalletIntelligenceJobPayload,
  listWalletIntelligenceBackfillJobs
} from "../src/storage/repositories";
import { extractWalletIntelligenceFromJob } from "../src/forensics/walletIntelligence";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Missing required environment variable: DATABASE_URL");

const batchSize = Number(process.env.WALLET_INTELLIGENCE_BACKFILL_BATCH_SIZE ?? 100);
const limit = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 100;
const db = createDb(databaseUrl);

let offset = 0;
let indexed = 0;
let failed = 0;

try {
  for (;;) {
    const jobs = await listWalletIntelligenceBackfillJobs(db, { limit, offset });
    if (jobs.length === 0) break;

    for (const job of jobs) {
      try {
        const extraction = extractWalletIntelligenceFromJob(job);
        const existing = await getWalletIntelligenceRunState(db, job.id);
        if (
          existing?.sourcePayloadHash === extraction.run.sourcePayloadHash &&
          existing.indexVersion === extraction.run.indexVersion &&
          existing.indexStatus === "indexed"
        ) {
          continue;
        }
        const profile = job.requestedBy ? await getTelegramUserProfile(db, job.requestedBy).catch(() => null) : null;
        await indexWalletIntelligenceJobPayload(db, {
          ...extraction,
          run: {
            ...extraction.run,
            telegramUserId: profile?.telegramUserId ?? job.requestedBy,
            telegramUsername: profile?.username ?? null,
            telegramLocale: profile?.locale ?? null
          }
        });
        indexed += 1;
      } catch (error) {
        failed += 1;
        console.warn("wallet_intelligence_backfill_job_failed", {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    offset += jobs.length;
    console.log(`Wallet Intelligence backfill progress: indexed=${indexed} failed=${failed} offset=${offset}`);
  }
} finally {
  await closeDb(db);
}

console.log(`Wallet Intelligence backfill complete: indexed=${indexed} failed=${failed}`);
```

If `getTelegramUserProfile` does not exist, add it in `src/storage/repositories.ts`:

```typescript
export async function getTelegramUserProfile(db: Db, telegramUserId: string): Promise<TelegramUserProfile | null> {
  const result = await db.query(
    `select telegram_user_id, username, locale, created_at
     from telegram_users
     where telegram_user_id = $1`,
    [telegramUserId]
  );
  return result.rows[0] ? {
    telegramUserId: result.rows[0].telegram_user_id,
    username: result.rows[0].username ?? null,
    locale: parseBotLocale(result.rows[0].locale),
    createdAt: result.rows[0].created_at
  } : null;
}
```

- [ ] **Step 3: Run typecheck for script**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit backfill script**

Run:

```powershell
git add package.json scripts/backfillWalletIntelligence.ts src/storage/repositories.ts
git commit -m "feat(wallet-intelligence): add backfill script"
```

Expected: commit succeeds.

---

### Task 5: Best-Effort Indexing Hooks For New Jobs

**Files:**
- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `src/index.ts`
- Modify: `tests/forensics/deepForensicJob.test.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Add failing DeepCheck/Where hook test**

Append a test near the existing delivery-failure best-effort test in `tests/forensics/deepForensicJob.test.ts`:

```typescript
it("does not fail a completed deep job when wallet intelligence indexing fails", async () => {
  const completeForensicCheckJob = vi.fn(async () => true);
  const indexWalletIntelligenceJob = vi.fn(async () => {
    throw new Error("wallet intelligence unavailable");
  });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const handled = await runSingleDeepForensicJobCycle({
    claimNextForensicCheckJob: async () => job(),
    completeForensicCheckJob,
    indexWalletIntelligenceJob,
    recordRiskEvaluation: vi.fn(async () => undefined),
    upsertAddressLabelAssertion: vi.fn(async () => undefined),
    tronClient: { listRelatedTrc20Transfers: async () => [] },
    getLabelsForAddress: async () => [],
    getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address }),
    logger
  }, {
    pageLimit: 1,
    maxPagesPerAddress: 1,
    maxExpandedIntermediates: 0,
    metadataFetchLimit: 0,
    contractProfileFetchLimit: 0,
    maxInboundSenders: 1
  });

  expect(handled).toBe(true);
  expect(completeForensicCheckJob).toHaveBeenCalledTimes(1);
  expect(indexWalletIntelligenceJob).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith("wallet_intelligence_index_failed", expect.objectContaining({
    job_id: "job-1",
    error: "wallet intelligence unavailable"
  }));
});
```

- [ ] **Step 2: Add failing Incoming hook test**

Append to `tests/forensics/incomingDepositJob.test.ts` near the successful job-cycle tests:

```typescript
it("does not fail an incoming job when wallet intelligence indexing fails", async () => {
  const completeForensicCheckJob = vi.fn(async () => true);
  const indexWalletIntelligenceJob = vi.fn(async () => {
    throw new Error("wallet intelligence unavailable");
  });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const handled = await runSingleIncomingDepositJobCycle({
    claimNextForensicCheckJob: async () => job(validProgressJson),
    completeForensicCheckJob,
    updateForensicCheckJobProgress: vi.fn(async () => true),
    markUserAlertSent: vi.fn(async () => true),
    markUserAlertFailed: vi.fn(async () => true),
    recordObservedTransactionRisk: vi.fn(async () => true),
    sendUserAlert: vi.fn(async () => undefined),
    formatIncomingDepositRiskAlert: () => ({ text: "ok", parseMode: "HTML" }),
    buildReport: async () => ({
      decision: "ACCEPTABLE",
      riskScore: 10,
      riskBand: "LOW",
      dataQuality: "high",
      sourcePolicy: "clean",
      originCoverage: 1,
      originPaths: [],
      reasons: [],
      hardBadEvidence: [],
      fundingCoverage: {
        depositFundingCoverageRatio: 1,
        cleanSourceCoverageRatio: 1,
        exactContinuityCoverageRatio: 1,
        serviceBoundaryCoverageRatio: 0,
        unresolvedCoverageRatio: 0
      },
      corridorSummary: null,
      score_valid: true,
      technical_status: "completed"
    } as any),
    indexWalletIntelligenceJob,
    logger
  });

  expect(handled).toBe(true);
  expect(completeForensicCheckJob).toHaveBeenCalledTimes(1);
  expect(indexWalletIntelligenceJob).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith("wallet_intelligence_index_failed", expect.objectContaining({
    error: "wallet intelligence unavailable"
  }));
});
```

- [ ] **Step 3: Run hook tests and verify failure**

Run:

```powershell
npm test -- --run tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts
```

Expected: FAIL because dependency types do not include `indexWalletIntelligenceJob`.

- [ ] **Step 4: Add optional hook deps and best-effort helper**

In `src/forensics/deepForensicJob.ts`, add to `DeepForensicJobRunnerDeps`:

```typescript
  indexWalletIntelligenceJob?(input: {
    job: ForensicCheckJob;
    progressJson: Record<string, unknown>;
    resultJson: Record<string, unknown>;
    status: "completed" | "partial";
  }): Promise<void>;
```

Add helper:

```typescript
async function indexWalletIntelligenceBestEffort(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  input: { progressJson: Record<string, unknown>; resultJson: Record<string, unknown>; status: "completed" | "partial" }
): Promise<void> {
  if (!deps.indexWalletIntelligenceJob) return;
  try {
    await deps.indexWalletIntelligenceJob({ job, ...input });
  } catch (error) {
    (deps.logger ?? defaultLogger).warn("wallet_intelligence_index_failed", {
      job_id: job.id,
      kind: job.kind,
      subject_address: job.subjectAddress,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
```

Call it immediately after successful `completeForensicCheckJob` for DeepCheck completed/partial paths and Where completed/partial paths. Do not call it in failed paths.

In `src/forensics/incomingDepositJob.ts`, add the same optional dependency to `RunSingleIncomingDepositJobCycleDeps` and call a local `indexWalletIntelligenceBestEffort` after successful `completeForensicCheckJob` only.

- [ ] **Step 5: Wire repository-backed hook in `src/index.ts`**

Import:

```typescript
import { extractWalletIntelligenceFromJob } from "./forensics/walletIntelligence";
```

Import repository functions:

```typescript
  getTelegramUserProfile,
  indexWalletIntelligenceJobPayload,
  listWalletIntelligenceAddressSummaries,
  getWalletIntelligenceAddressDetail,
```

Add helper:

```typescript
async function indexWalletIntelligenceCompletedJob(input: {
  job: ForensicCheckJob;
  progressJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  status: "completed" | "partial";
}): Promise<void> {
  const completedJob: ForensicCheckJob = {
    ...input.job,
    status: input.status,
    progressJson: input.progressJson,
    resultJson: input.resultJson,
    completedAt: input.job.completedAt ?? new Date(),
    updatedAt: new Date()
  };
  const extracted = extractWalletIntelligenceFromJob(completedJob);
  const profile = completedJob.requestedBy
    ? await getTelegramUserProfile(db, completedJob.requestedBy).catch(() => null)
    : null;
  await indexWalletIntelligenceJobPayload(db, {
    ...extracted,
    run: {
      ...extracted.run,
      telegramUserId: profile?.telegramUserId ?? completedJob.requestedBy,
      telegramUsername: profile?.username ?? null,
      telegramLocale: profile?.locale ?? null
    }
  });
}
```

Pass `indexWalletIntelligenceJob: indexWalletIntelligenceCompletedJob` into `runSingleDeepForensicJobCycle` and `runSingleIncomingDepositJobCycle`.

- [ ] **Step 6: Run hook tests**

Run:

```powershell
npm test -- --run tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit hooks**

Run:

```powershell
git add src/forensics/deepForensicJob.ts src/forensics/incomingDepositJob.ts src/index.ts tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "feat(wallet-intelligence): index completed jobs best effort"
```

Expected: commit succeeds.

---

### Task 6: Admin API

**Files:**
- Modify: `src/admin/adminServer.ts`
- Modify: `src/index.ts`
- Modify: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Add failing Admin API tests**

Append to `tests/admin/adminServer.test.ts`:

```typescript
it("lists wallet intelligence summaries for authorized admins", async () => {
  let receivedInput: unknown = null;
  const server = await start({
    ...deps(),
    listWalletIntelligenceAddressSummaries: async (input) => {
      receivedInput = input;
      return [{
        address: "TSeen1111111111111111111111111111111",
        uniqueSubjectCount: 2,
        uniqueRequesterCount: 2,
        jobCount: 3,
        completedJobCount: 2,
        partialJobCount: 1,
        occurrenceCount: 4,
        distinctTxCount: 2,
        distinctAmountRaw: "3000000",
        minDepth: 1,
        maxDepth: 2,
        firstSeenAt: new Date("2026-07-06T09:00:00.000Z"),
        lastSeenAt: new Date("2026-07-06T10:00:00.000Z"),
        modes: ["address_deep_check"],
        tags: ["repeated_cross_run_address"],
        serviceCategories: ["cex"],
        labelHints: ["Binance"]
      }];
    },
    getWalletIntelligenceAddressDetail: async () => null
  });

  const response = await fetch(
    `${server.url}/admin/api/wallet-intelligence/addresses?limit=20&offset=5&mode=address_deep_check&tag=repeated_cross_run_address&minUniqueSubjects=2&minUniqueRequesters=2&requester=client_user`,
    { headers: { authorization: "Bearer secret-token" } }
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    addresses: [{
      address: "TSeen1111111111111111111111111111111",
      uniqueSubjectCount: 2,
      uniqueRequesterCount: 2,
      distinctAmountRaw: "3000000"
    }]
  });
  expect(receivedInput).toMatchObject({
    limit: 20,
    offset: 5,
    mode: "address_deep_check",
    tag: "repeated_cross_run_address",
    minUniqueSubjects: 2,
    minUniqueRequesters: 2,
    requesterQuery: "client_user"
  });
});

it("returns wallet intelligence address detail", async () => {
  const server = await start({
    ...deps(),
    listWalletIntelligenceAddressSummaries: async () => [],
    getWalletIntelligenceAddressDetail: async (address) => ({
      summary: {
        address,
        uniqueSubjectCount: 1,
        uniqueRequesterCount: 1,
        jobCount: 1,
        completedJobCount: 1,
        partialJobCount: 0,
        occurrenceCount: 1,
        distinctTxCount: 1,
        distinctAmountRaw: "1000000",
        minDepth: 1,
        maxDepth: 1,
        firstSeenAt: new Date("2026-07-06T09:00:00.000Z"),
        lastSeenAt: new Date("2026-07-06T09:00:00.000Z"),
        modes: ["address_deep_check"],
        tags: ["repeated_cross_run_address"],
        serviceCategories: [],
        labelHints: []
      },
      requesters: [{ requestedBy: "42", telegramUserId: "42", username: "client_user", locale: "ru", chatId: "42", messageId: "77", jobCount: 1 }],
      jobs: [{ jobId: "job-1", jobKind: "address_deep_check", jobStatus: "completed", subjectAddress: "TSubject111111111111111111111111111111", completedAt: new Date("2026-07-06T10:00:00.000Z") }],
      sightings: [],
      edges: []
    })
  });

  const response = await fetch(
    `${server.url}/admin/api/wallet-intelligence/addresses/TSeen1111111111111111111111111111111`,
    { headers: { authorization: "Bearer secret-token" } }
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    detail: {
      summary: { address: "TSeen1111111111111111111111111111111" },
      requesters: [{ username: "client_user" }]
    }
  });
});

it("rejects wallet intelligence requests without bearer token", async () => {
  const server = await start({
    ...deps(),
    listWalletIntelligenceAddressSummaries: async () => [],
    getWalletIntelligenceAddressDetail: async () => null
  });

  const response = await fetch(`${server.url}/admin/api/wallet-intelligence/addresses`);

  expect(response.status).toBe(401);
});
```

- [ ] **Step 2: Run Admin API tests and verify failure**

Run:

```powershell
npm test -- --run tests/admin/adminServer.test.ts
```

Expected: FAIL because Admin deps/routes do not exist.

- [ ] **Step 3: Extend Admin deps and parse filters**

In `src/admin/adminServer.ts`, extend `AdminServerDeps`:

```typescript
  listWalletIntelligenceAddressSummaries?(input: ListWalletIntelligenceAddressSummariesInput): Promise<WalletIntelligenceAddressSummary[]>;
  getWalletIntelligenceAddressDetail?(address: string): Promise<WalletIntelligenceAddressDetail | null>;
```

Import the new types from `../storage/repositories`.

Add parser helpers:

```typescript
function parsePositiveIntegerQuery(url: URL, key: string): ParseResult<number | undefined> {
  const value = firstQueryValue(url, key);
  if (value === undefined) return { ok: true, value: undefined };
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0
    ? { ok: true, value: parsed }
    : { ok: false, message: `Invalid wallet intelligence ${key}.` };
}
```

Add `parseWalletIntelligenceListInput(url)` supporting the exact query names:

- `limit`
- `offset`
- `mode`
- `tag`
- `minUniqueSubjects`
- `minUniqueRequesters`
- `startDate`
- `endDate`
- `address`
- `minDepth`
- `maxDepth`
- `minDistinctAmountRaw`
- `maxDistinctAmountRaw`
- `serviceCategory`
- `requester`
- `subjectAddress`
- `jobStatus`

- [ ] **Step 4: Add API routes**

In `handleApiRequest`, before forensic job id routing, add:

```typescript
if (url.pathname === "/admin/api/wallet-intelligence/addresses") {
  if (!deps.listWalletIntelligenceAddressSummaries) {
    writeJson(response, 501, { error: "Wallet Intelligence is not configured." });
    return;
  }
  const input = parseWalletIntelligenceListInput(url);
  if (!input.ok) {
    writeJson(response, 400, { error: input.message });
    return;
  }
  const addresses = await deps.listWalletIntelligenceAddressSummaries(input.value);
  writeJson(response, 200, { addresses });
  return;
}

const walletIntelligenceDetailMatch = /^\/admin\/api\/wallet-intelligence\/addresses\/([^/]+)$/.exec(url.pathname);
if (walletIntelligenceDetailMatch) {
  if (!deps.getWalletIntelligenceAddressDetail) {
    writeJson(response, 501, { error: "Wallet Intelligence is not configured." });
    return;
  }
  const address = safeDecodeUriComponent(walletIntelligenceDetailMatch[1]);
  if (!address.ok) {
    writeJson(response, 400, { error: address.message });
    return;
  }
  const detail = await deps.getWalletIntelligenceAddressDetail(address.value);
  if (!detail) {
    writeJson(response, 404, { error: "Wallet Intelligence address not found." });
    return;
  }
  writeJson(response, 200, { detail });
  return;
}
```

- [ ] **Step 5: Wire Admin deps in `src/index.ts`**

In the `startAdminServer` dependency object, pass:

```typescript
    listWalletIntelligenceAddressSummaries: (input) => listWalletIntelligenceAddressSummaries(db, input),
    getWalletIntelligenceAddressDetail: (address) => getWalletIntelligenceAddressDetail(db, address),
```

- [ ] **Step 6: Run Admin API tests**

Run:

```powershell
npm test -- --run tests/admin/adminServer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Admin API**

Run:

```powershell
git add src/admin/adminServer.ts src/index.ts tests/admin/adminServer.test.ts
git commit -m "feat(wallet-intelligence): expose admin API"
```

Expected: commit succeeds.

---

### Task 7: Admin Wallet Intelligence Workspace UI

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Add failing shell assertions**

In the existing `"serves admin console shell without exposing job data"` test, add assertions:

```typescript
expect(html).toContain("Wallet Intelligence");
expect(html).toContain("data-wallet-intelligence-workspace");
expect(html).toContain("/admin/api/wallet-intelligence/addresses");
expect(html).toContain("function loadWalletIntelligenceAddresses");
expect(html).toContain("function renderWalletIntelligenceTable");
expect(html).toContain("function renderWalletIntelligenceDrawer");
expect(html).toContain("Unique subjects");
expect(html).toContain("Distinct amount");
expect(html).toContain("This is analyst context, not scoring evidence.");
```

- [ ] **Step 2: Run shell test and verify failure**

Run:

```powershell
npm test -- --run tests/admin/adminServer.test.ts -t "serves admin console shell"
```

Expected: FAIL because the UI shell does not include Wallet Intelligence.

- [ ] **Step 3: Add route shell and topbar controls**

In `src/admin/adminConsole.ts`, add a second workspace section near the existing graph workspace:

```html
<section id="walletIntelligenceWorkspace" class="wallet-intelligence-workspace" data-wallet-intelligence-workspace hidden>
  <header class="wallet-intelligence-header">
    <div>
      <h2>Wallet Intelligence</h2>
      <p>This is analyst context, not scoring evidence.</p>
    </div>
    <a class="link" href="/admin/forensics">Forensics</a>
  </header>
  <section class="wallet-intelligence-filters">
    <input id="walletIntelAddress" placeholder="Address" autocomplete="off">
    <select id="walletIntelMode">
      <option value="">All modes</option>
      <option value="address_deep_check">DeepCheck</option>
      <option value="where_is_money_check">Where is money</option>
      <option value="incoming_deposit_check">Incoming deposit</option>
    </select>
    <select id="walletIntelTag">
      <option value="">All tags</option>
      <option value="repeated_cross_run_address">Repeated cross-run</option>
      <option value="high_activity_wallet">High activity</option>
      <option value="large_liquidity_wallet">Large liquidity</option>
      <option value="possible_service_or_exchange_like">Possible service-like</option>
      <option value="known_service_or_exchange">Known service</option>
      <option value="cross_mode_seen">Cross-mode seen</option>
    </select>
    <input id="walletIntelRequester" placeholder="Requester id or username" autocomplete="off">
    <input id="walletIntelSubject" placeholder="Subject address" autocomplete="off">
    <button id="walletIntelReload" type="button">Reload</button>
  </section>
  <main class="wallet-intelligence-main">
    <div id="walletIntelTable" class="wallet-intelligence-table"></div>
    <aside id="walletIntelDrawer" class="wallet-intelligence-drawer"></aside>
  </main>
</section>
```

Add CSS with stable dimensions:

```css
.wallet-intelligence-workspace {
  height: calc(100dvh - 56px);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  background: var(--bg);
}
.wallet-intelligence-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 14px;
  border-bottom: 1px solid var(--line);
}
.wallet-intelligence-header h2 { margin: 0; font-size: 18px; }
.wallet-intelligence-header p { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
.wallet-intelligence-filters {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 180px 190px minmax(180px, 1fr) minmax(180px, 1fr) auto;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
}
.wallet-intelligence-main {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 420px;
}
.wallet-intelligence-table, .wallet-intelligence-drawer {
  min-height: 0;
  overflow: auto;
}
.wallet-intelligence-drawer {
  border-left: 1px solid var(--line);
  background: var(--surface-panel);
}
.wallet-intelligence-row {
  display: grid;
  grid-template-columns: minmax(220px, 1.2fr) 190px repeat(6, minmax(86px, .6fr));
  gap: 8px;
  align-items: center;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line);
}
.wallet-intelligence-row button {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  text-align: left;
}
.wallet-intelligence-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.wallet-intelligence-drawer-section { padding: 12px; border-bottom: 1px solid var(--line); }
```

- [ ] **Step 4: Add UI state and API functions**

In the JS state object, add:

```javascript
walletIntel: {
  addresses: [],
  activeAddress: null,
  detail: null,
  loading: false,
  error: null
}
```

Add:

```javascript
function walletIntelligenceActive() {
  return window.location.pathname === "/admin/wallet-intelligence";
}

function syncWorkspaceVisibility() {
  const wallet = el("walletIntelligenceWorkspace");
  const graph = document.querySelector("[data-graph-first-shell]");
  if (wallet) wallet.hidden = !walletIntelligenceActive();
  if (graph) graph.hidden = walletIntelligenceActive();
}

async function loadWalletIntelligenceAddresses() {
  state.walletIntel.loading = true;
  renderWalletIntelligenceTable();
  const params = new URLSearchParams();
  const address = el("walletIntelAddress")?.value?.trim();
  const mode = el("walletIntelMode")?.value;
  const tag = el("walletIntelTag")?.value;
  const requester = el("walletIntelRequester")?.value?.trim();
  const subjectAddress = el("walletIntelSubject")?.value?.trim();
  if (address) params.set("address", address);
  if (mode) params.set("mode", mode);
  if (tag) params.set("tag", tag);
  if (requester) params.set("requester", requester);
  if (subjectAddress) params.set("subjectAddress", subjectAddress);
  params.set("limit", "50");
  const body = await api("/admin/api/wallet-intelligence/addresses?" + params.toString());
  state.walletIntel.addresses = body.addresses || [];
  state.walletIntel.loading = false;
  renderWalletIntelligenceTable();
}
```

- [ ] **Step 5: Add table and drawer rendering**

Add:

```javascript
function tagPills(tags) {
  return '<div class="wallet-intelligence-tags">' + asArray(tags).map((tag) => '<span class="chip">' + escapeHtml(tag) + '</span>').join("") + '</div>';
}

function renderWalletIntelligenceTable() {
  const root = el("walletIntelTable");
  if (!root) return;
  if (state.walletIntel.loading) {
    root.innerHTML = '<div class="empty">Loading Wallet Intelligence...</div>';
    return;
  }
  const header = '<div class="wallet-intelligence-row muted"><strong>Address</strong><strong>Tags</strong><strong>Unique subjects</strong><strong>Unique requesters</strong><strong>Jobs</strong><strong>Max depth</strong><strong>Distinct tx</strong><strong>Distinct amount</strong></div>';
  const rows = asArray(state.walletIntel.addresses).map((row) =>
    '<div class="wallet-intelligence-row">' +
      '<button type="button" data-wallet-intel-address="' + escapeHtml(row.address) + '">' + escapeHtml(short(row.address, 8)) + '</button>' +
      tagPills(row.tags) +
      '<span>' + escapeHtml(row.uniqueSubjectCount ?? 0) + '</span>' +
      '<span>' + escapeHtml(row.uniqueRequesterCount ?? 0) + '</span>' +
      '<span>' + escapeHtml(row.jobCount ?? 0) + '</span>' +
      '<span>' + escapeHtml(row.maxDepth ?? "") + '</span>' +
      '<span>' + escapeHtml(row.distinctTxCount ?? 0) + '</span>' +
      '<span>' + escapeHtml(row.distinctAmountRaw ?? "0") + '</span>' +
    '</div>'
  ).join("");
  root.innerHTML = header + (rows || '<div class="empty">No wallet intelligence rows.</div>');
}

async function openWalletIntelligenceAddress(address) {
  state.walletIntel.activeAddress = address;
  state.walletIntel.detail = null;
  renderWalletIntelligenceDrawer();
  const body = await api("/admin/api/wallet-intelligence/addresses/" + encodeURIComponent(address));
  state.walletIntel.detail = body.detail;
  renderWalletIntelligenceDrawer();
}

function renderWalletIntelligenceDrawer() {
  const root = el("walletIntelDrawer");
  if (!root) return;
  const detail = state.walletIntel.detail;
  if (!state.walletIntel.activeAddress) {
    root.innerHTML = '<div class="wallet-intelligence-drawer-section muted">Select an address.</div>';
    return;
  }
  if (!detail) {
    root.innerHTML = '<div class="wallet-intelligence-drawer-section muted">Loading ' + escapeHtml(short(state.walletIntel.activeAddress, 8)) + '...</div>';
    return;
  }
  const requesters = asArray(detail.requesters).map((item) =>
    '<div class="tx-main"><strong>' + escapeHtml(item.username ? "@" + item.username : item.requestedBy || "unknown") + '</strong><span>ID ' + escapeHtml(item.telegramUserId || item.requestedBy || "unknown") + ' / chat ' + escapeHtml(item.chatId || "n/a") + '</span></div>'
  ).join("");
  const jobs = asArray(detail.jobs).map((job) =>
    '<div class="tx-main"><a class="link" href="/admin/forensics?job=' + encodeURIComponent(job.jobId) + '">' + escapeHtml(short(job.jobId, 8)) + '</a><span>' + escapeHtml(job.jobKind) + ' / ' + escapeHtml(job.jobStatus) + ' / ' + escapeHtml(short(job.subjectAddress, 8)) + '</span></div>'
  ).join("");
  const edges = asArray(detail.edges).slice(0, 80).map((edge) =>
    '<div class="tx-main"><strong>' + explorerLink(tronscanTxUrl(edge.txHash), short(edge.txHash || "no tx", 8)) + '</strong><span>' + escapeHtml(short(edge.fromAddress, 6)) + ' -> ' + escapeHtml(short(edge.toAddress, 6)) + ' / ' + escapeHtml(edge.amountRaw || "0") + '</span></div>'
  ).join("");
  root.innerHTML =
    '<section class="wallet-intelligence-drawer-section"><h3>' + escapeHtml(short(detail.summary.address, 8)) + '</h3>' + tagPills(detail.summary.tags) + '<p class="muted">This is analyst context, not scoring evidence.</p></section>' +
    '<section class="wallet-intelligence-drawer-section"><h4>Requesters</h4>' + (requesters || '<span class="muted">No requesters.</span>') + '</section>' +
    '<section class="wallet-intelligence-drawer-section"><h4>Source jobs</h4>' + (jobs || '<span class="muted">No source jobs.</span>') + '</section>' +
    '<section class="wallet-intelligence-drawer-section"><h4>Edges</h4>' + (edges || '<span class="muted">No edges.</span>') + '</section>';
}
```

Add event listeners:

```javascript
el("walletIntelReload")?.addEventListener("click", () => loadWalletIntelligenceAddresses().catch((error) => setStatus(error.message)));
el("walletIntelTable")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-wallet-intel-address]");
  if (!button) return;
  openWalletIntelligenceAddress(button.getAttribute("data-wallet-intel-address")).catch((error) => setStatus(error.message));
});
```

Call `syncWorkspaceVisibility()` on startup. If `walletIntelligenceActive()` is true, call `loadWalletIntelligenceAddresses()` instead of loading graph jobs first.

- [ ] **Step 6: Serve same shell at `/admin/wallet-intelligence`**

In `src/admin/adminServer.ts`, update the HTML route condition:

```typescript
if (url.pathname === "/admin/forensics" || url.pathname === "/admin/wallet-intelligence") {
  if (request.method !== "GET") {
    writeJson(response, 405, { error: "Method not allowed." });
    return;
  }
  writeHtml(response, adminConsoleHtml());
  return;
}
```

- [ ] **Step 7: Run Admin shell tests**

Run:

```powershell
npm test -- --run tests/admin/adminServer.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Admin UI**

Run:

```powershell
git add src/admin/adminConsole.ts src/admin/adminServer.ts tests/admin/adminServer.test.ts
git commit -m "feat(wallet-intelligence): add admin workspace"
```

Expected: commit succeeds.

---

### Task 8: Documentation And Guardrail Verification

**Files:**
- Modify: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`
- Test: full focused test set

- [ ] **Step 1: Update Admin knowledge doc**

In `docs/knowledge/08-admin-and-bot-ux.md`, add a short section under Current Behavior:

```markdown
Admin now has a separate Wallet Intelligence workspace for cross-run address
sightings and relationship analytics. It indexes completed/partial DeepCheck,
Where is Money, and Incoming Deposit jobs from saved payloads only. The view is
global analyst context: repeated appearances, source jobs, requesters, and
normalized edges are visible for triage, but they are not forensic verdicts.
Wallet Intelligence is not shown in Telegram and does not change per-job graph
evidence.
```

- [ ] **Step 2: Update current decisions**

In `docs/knowledge/09-current-decisions.md`, add under Product or Admin decisions:

```markdown
- Wallet Intelligence is Admin-only investigative context. It stores
  cross-run sightings and edges from completed/partial DeepCheck, Where, and
  Incoming jobs, using already collected data. It does not call TronScan, does
  not create labels/assertions, does not write risk observations, and does not
  affect scoring or Telegram output.
```

- [ ] **Step 3: Update open problems**

In `docs/knowledge/10-open-problems.md`, add under UX:

```markdown
- Wallet Intelligence V1 intentionally defers per-job "seen elsewhere" hints
  and global graph visualization. Analysts should first validate the separate
  table/drawer workflow before this context is embedded into single-job views.
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- --run tests/forensics/walletIntelligence.test.ts tests/storage/walletIntelligence.test.ts tests/admin/adminServer.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Run full test suite**

Run:

```powershell
npm test
```

Expected: PASS. If runtime is too long for the current session, keep the focused test and typecheck outputs and state that full suite was not run.

- [ ] **Step 7: Commit docs and verification fixes**

Run:

```powershell
git add docs/knowledge/08-admin-and-bot-ux.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md
git commit -m "docs: document wallet intelligence admin behavior"
```

Expected: commit succeeds.

---

## Final Verification Checklist

- [ ] `npm run typecheck` passes.
- [ ] `npm test -- --run tests/forensics/walletIntelligence.test.ts tests/storage/walletIntelligence.test.ts tests/admin/adminServer.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts` passes.
- [ ] `npm test` passes, or the final handoff states why it was not run.
- [ ] `rg -n "wallet_intelligence|Wallet Intelligence" src docs tests migrations scripts` shows only Admin/intelligence references, not scoring code.
- [ ] `rg -n "risk_signal_observations|saveRiskEvaluationEvidence|recordRiskEvaluation" src/forensics/walletIntelligence.ts src/storage/repositories.ts scripts/backfillWalletIntelligence.ts` confirms Wallet Intelligence does not write risk observations.
- [ ] `rg -n "Wallet Intelligence" src/bot src/alerts` returns no user-facing Telegram additions.
- [ ] Admin `/admin/wallet-intelligence` loads the table shell.
- [ ] Admin API `/admin/api/wallet-intelligence/addresses` requires the same bearer token as other Admin APIs.
- [ ] Backfill command `npm run wallet-intelligence:backfill` is documented in handoff but not run against production data without operator approval.
