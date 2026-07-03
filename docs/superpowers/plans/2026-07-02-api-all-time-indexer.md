# API All-Time Indexer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automatic coverage-aware TRON USDT address indexer that powers DeepCheck, Where Is Money, Incoming Deposit, and Admin coverage without CSV, browser export, or captcha paths.

**Architecture:** Keep the existing `tron_usdt_transfers` table as the canonical transfer store, add provider-windowed coverage/page/interval state, and add a bounded async TronScan scheduler so API-key groups can work in parallel without intentionally running into 429s. Coverage state distinguishes `all_time` from `targeted`, but `complete` means "complete for this provider-windowed coverage model", not guaranteed chain-wide truth. Admin DeepCheck can wait for strict subject coverage, while bot jobs return partial coverage and continue indexing in the background. DeepCheck builds the complete direct wallet boundary from indexed subject history and runs cheap hard-evidence checks for every direct wallet. Ranked second-layer address indexing stays budgeted and post-MVP by default.

**Tech Stack:** TypeScript, Vitest, PostgreSQL migrations, existing TronScan/TronGrid clients, existing forensic job queue, existing Admin projection.

---

## Scope Check

This spec touches scheduler, storage, indexer, DeepCheck, Where Is Money, Incoming Deposit, and Admin. They are not independent products: each later phase depends on address index coverage state. Keep one plan, but commit after every task so the work can stop safely after any phase.

The first useful MVP is:

1. Provider probe scripts verify TronScan pagination behavior on real addresses before migrations and workers depend on it.
2. Scheduler can dispatch independent account groups concurrently, with global/group/endpoint pacing, conservative ramp-up, and per-group in-flight caps.
3. Address indexer can complete or mark partial provider-windowed all-time TRON USDT history for one subject address, and can also complete a targeted backfill without pretending it is all-time complete.
4. Admin DeepCheck uses strict subject coverage and full direct wallet boundary.
5. Bot DeepCheck can return partial output while queueing background subject/targeted indexing.
6. Where Is Money and Incoming retry history-limited hops through the indexer.
7. Admin displays all-time coverage counters, targeted coverage counters, provider caps, queue state, and partial/failed reasons.

Post-MVP: ranked second-layer indexing, service/high-degree suppression, manual expand, and larger address budgets.

Safe initial defaults: `TRONSCAN_MAX_IN_FLIGHT=20`, `TRON_ADDRESS_INDEX_PAGE_BATCH_SIZE=2`, bot second-layer budget `0`, Admin second-layer budget `25`, direct hard-evidence live limit `250`, direct hard-evidence concurrency `8`. Raise only after Task 0 probe and runtime diagnostics show stable 429/403/latency.

MVP targeted coverage means "until timestamp": `[0, targetTimestamp]`. This is enough for Where Is Money and history-limited hop checks. True bounded Incoming Deposit coverage for an arbitrary `[minTimestamp, maxTimestamp]` window is post-MVP unless the storage key is extended with a separate requirement kind and start/end target timestamps. Do not silently treat an Incoming window request as cheap if the implementation actually has to backfill from genesis.

Do not implement CSV import, browser automation, captcha solving, or a global TRON-wide USDT index.

## File Structure

Create:

- `scripts/tronscan-pagination-probe.ts` - probe TronScan pagination, cap, duplicate, and same-timestamp behavior before indexer implementation.
- `docs/provider-observations/tronscan-usdt-pagination.md` - checked observations from real probe runs.
- `migrations/026_tron_address_all_time_index.sql` - address-level coverage and page-state tables for the API all-time indexer.
- `src/forensics/tronAddressAllTimeIndex.ts` - page planner, raw transfer normalization, all-time/targeted indexing runner, per-window page batches, and second-layer queue helper.
- `src/forensics/directHardEvidence.ts` - bounded direct-wallet hard evidence collection for labels, service classification, and exact USDT restriction state.
- `tests/forensics/tronAddressAllTimeIndex.test.ts` - unit tests for page planning, time-window continuation, targeted vs all-time coverage state, resume, page batches, and idempotent transfer normalization.
- `tests/forensics/directHardEvidence.test.ts` - unit tests for direct-wallet hard evidence coverage and bounded concurrency.

Modify:

- `src/config.ts` - change `TRONSCAN_PAGE_LIMIT` default/max to 50 and add indexer/scheduler config knobs.
- `.env.example` - document 10-key setup and new indexer knobs.
- `src/tron/tronscanScheduler.ts` - add bounded concurrent dispatch, token-bucket pacing, max in-flight diagnostics, request counters, per-group in-flight caps, and per-group cooldown diagnostics.
- `tests/tron/tronscanScheduler.test.ts` - change serialization expectations and add concurrency/cap tests.
- `src/tron/tronClient.ts` - add transfer page method that returns rows plus `total`/`rangeTotal` and provider.
- `tests/tron/tronClient.test.ts` - cover transfer page metadata and `limit=50`.
- `src/types.ts` - add index coverage types and DeepCheck all-time coverage fields.
- `src/storage/repositories.ts` - add repository types/functions for address index state and pages.
- `tests/storage/repositories.test.ts` - cover new repository SQL and row mapping.
- existing TRON USDT transfer migration/repository - add stable `transfer_id` if the canonical table still relies only on `(tx_hash, event_index)`.
- `src/forensics/localTronUsdtIndex.ts` - reuse conversion helpers and keep indexed-client behavior unchanged.
- `src/check/deepForensicCheck.ts` - add all-time subject mode, full direct wallet boundary, direct hard evidence output, and coverage fields.
- `tests/check/deepForensicCheck.test.ts` - cover all-time direct boundary and no top-15 cap in all-time mode.
- `src/forensics/deepForensicJob.ts` - run/queue indexer before DeepCheck according to strict/partial job mode and use indexer for history-limited Where Is Money hops.
- `tests/forensics/deepForensicJob.test.ts` - cover Admin all-time wait, bot partial mode, progress JSON, and targeted history retry.
- `src/check/whereIsMoneyCheck.ts` - keep trace behavior unchanged, but accept stronger coverage from deps after indexer retry.
- `tests/check/whereIsMoneyCheck.test.ts` - cover `incoming_history_not_fetched` resolving to `no_previous_transfer` when indexed coverage reaches the hop.
- `src/forensics/incomingDepositJob.ts` - make `run_where_is_money` and `build_funding_bundles` share indexed edge reads, targeted backfill, and coverage-aware live-read skipping.
- `tests/forensics/incomingDepositJob.test.ts` - cover coverage-aware no-live-read behavior for a fully indexed address/window.
- `src/index.ts` - wire repository functions, indexer runner, background address-index worker, config, and job deps.
- `src/admin/forensicsGraph.ts` - project all-time coverage into graph summary.
- `src/admin/adminConsole.ts` - show all-time coverage lines in the right rail.
- `tests/admin/forensicsGraph.test.ts` - cover graph summary coverage fields.
- `tests/admin/adminConsole.test.ts` - cover visible all-time coverage copy.

## Shared Types

Use these names consistently through tasks:

```ts
export type TronAddressUsdtIndexStatus =
  | "queued"
  | "running"
  | "complete"
  | "partial"
  | "failed_retryable"
  | "failed_terminal";

export type TronAddressUsdtCoverageKind = "provider_windowed";

export type TronAddressUsdtCoverageStatusReason =
  | "complete_provider_windowed"
  | "partial_provider_cap"
  | "partial_budget_exhausted"
  | "partial_rate_limited"
  | "partial_provider_inconsistent"
  | "too_large_deferred"
  | "failed_retryable"
  | "failed_terminal";

export type TronAddressUsdtIndexProvider = "tronscan" | "trongrid_fallback" | "mixed";

export type TronAddressUsdtCoverageMode = "all_time" | "targeted";

export type DeepCheckAllTimeMode = "strict" | "partial";

export type TronAddressUsdtIndexState = {
  address: string;
  tokenContract: string;
  coverageMode: TronAddressUsdtCoverageMode;
  coverageKind: TronAddressUsdtCoverageKind;
  status: TronAddressUsdtIndexStatus;
  statusReason: TronAddressUsdtCoverageStatusReason | null;
  provider: TronAddressUsdtIndexProvider | null;
  totalReported: number | null;
  fetchedTransferCount: number;
  uniqueCounterpartyCount: number;
  newestTransferAt: Date | null;
  oldestTransferAt: Date | null;
  coveredUntilTimestamp: Date | null;
  targetTimestamp: Date | null;
  fetchedPageCount: number;
  plannedPageCount: number | null;
  currentEndTimestamp: Date | null;
  providerCapHit: boolean;
  budgetExhausted: boolean;
  providerInconsistent: boolean;
  priority: number;
  nextRunAt: Date;
  attemptCount: number;
  maxAttempts: number;
  retryCount: number;
  lastError: string | null;
  lastErrorClass: string | null;
  lastSuccessfulPageAt: Date | null;
  queuedReason: string | null;
  requestedByJobId: string | null;
  lockedAt: Date | null;
  lockedUntil: Date | null;
  heartbeatAt: Date | null;
  lockOwner: string | null;
  budgetPages: number | null;
  budgetSeconds: number | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TronAddressUsdtCoverageInterval = {
  address: string;
  tokenContract: string;
  coverageMode: TronAddressUsdtCoverageMode;
  targetTimestamp: Date | null;
  provider: TronAddressUsdtIndexProvider;
  startTimestamp: Date;
  endTimestamp: Date;
  status: "complete" | "partial";
  statusReason: TronAddressUsdtCoverageStatusReason;
  totalReported: number | null;
  rangeTotal: number | null;
  pagesFetched: number;
  rowsFetched: number;
  uniqueRowsInserted: number;
  capHit: boolean;
  providerInconsistent: boolean;
  completedAt: Date | null;
};

export type TronAddressUsdtIndexPageStatus = "queued" | "running" | "complete" | "empty" | "failed";

export type TronAddressUsdtIndexPage = {
  address: string;
  tokenContract: string;
  coverageMode: TronAddressUsdtCoverageMode;
  targetTimestampMs: number;
  windowStartTimestampMs: number;
  windowEndTimestampMs: number;
  startOffset: number;
  limitCount: number;
  status: TronAddressUsdtIndexPageStatus;
  transferCount: number;
  provider: TronAddressUsdtIndexProvider | null;
  totalReported: number | null;
  rangeTotal: number | null;
  rawResponseHash: string | null;
  canonicalTransferHash: string | null;
  attemptCount: number;
  error: string | null;
  newestTransferAt: Date | null;
  oldestTransferAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type IndexedTronUsdtTransferIdentity = {
  transferId: string;
  provider: TronAddressUsdtIndexProvider;
};

export type IndexedTronUsdtTransfer = {
  transferId: string;
  txHash: string;
  blockNumber: number;
  blockTimestamp: Date;
  eventIndex: number;
  providerRowOrdinalInTx: number | null;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  method: "transfer" | "transferFrom" | "unknown";
  eventType: string | null;
  callerAddress: string | null;
  contractRet: string | null;
  finalResult: string | null;
  reverted: boolean;
  riskTransaction: boolean;
  confirmed: boolean;
};

export type DeepCheckAllTimeCoverage = {
  mode: DeepCheckAllTimeMode;
  subjectIndexStatus: TronAddressUsdtIndexStatus | "not_requested";
  subjectCoverageMode: TronAddressUsdtCoverageMode | null;
  subjectAllTimeComplete: boolean;
  subjectStatusReason: TronAddressUsdtCoverageStatusReason | null;
  subjectCoveredUntilTimestamp: string | null;
  subjectTargetTimestamp: string | null;
  subjectTransfersFetched: number;
  subjectUniqueDirectWallets: number;
  directWalletsHardEvidenceChecked: number;
  directWalletsHardEvidenceLiveChecked: number;
  directHardEvidenceStatus: "complete" | "local_only_partial" | "live_budget_exhausted";
  directWalletsQueuedForIndexing: number;
  secondLayerActiveBudget: number;
  secondLayerQueued: number;
  secondLayerComplete: number;
  providerEffectiveRps: number | null;
  providerRateLimitedRequests: number;
  providerCapHit: boolean;
  providerInconsistent: boolean;
  suppressedServiceWallets: number;
  suppressedHighDegreeWallets: number;
};
```

## Task 0: TronScan Provider Probe

**Files:**

- Create: `scripts/tronscan-pagination-probe.ts`
- Create: `docs/provider-observations/tronscan-usdt-pagination.md`

- [ ] **Step 1: Add probe script**

The probe script must call the same TronScan transfer endpoint planned for production with `limit=50`, `start`, `start_timestamp`, and `end_timestamp`. It writes raw JSON pages to `logs/tronscan-probe/` and a compact markdown summary.

Probe at least:

```text
start=0
start=50
start=9950
start=10000
limit=50
range windows with rangeTotal near 10000
end_timestamp walk with overlap
same timestamp/block boundary
```

Record:

```text
http_status
actual_rows
total
rangeTotal
raw_response_hash
canonical_transfer_hash
oldest_timestamp
newest_timestamp
duplicate_transfer_ids
same_timestamp_boundary_count
empty_page_after_non_empty_window
429/403/5xx count by key/group
p50/p95 latency
```

- [ ] **Step 2: Add observations doc**

Create `docs/provider-observations/tronscan-usdt-pagination.md` with:

```text
addresses tested
endpoint tested
API key setup used
limit and start behavior
rangeTotal cap behavior
same-timestamp overlap behavior
RPS ramp result
known provider inconsistencies
implementation rules accepted from probe
```

Additional probes before Task 4:

```text
same window/page fetched 5 times: raw_response_hash may change, canonical_transfer_hash must stay stable
transaction with multiple TRC20 events: confirm event_index/log_index presence or ordinal fallback behavior
failed/reverted/approval rows: confirm event_type, confirmed, contractRet, finalResult, revert, riskTransaction shape
incoming sample: compare cost of [0,maxTimestamp] vs [minTimestamp,maxTimestamp]
```

- [ ] **Step 3: Acceptance**

Do not start storage/indexer implementation until the doc answers these yes/no questions:

```text
Can start+limit silently cap or empty?
Does rangeTotal hit 10000 on real dense windows?
Do same-timestamp rows require inclusive overlap plus transfer_id dedupe?
What initial global RPS is stable with the actual key pool?
Which endpoint shape gives the most stable TRC20 USDT rows?
Can provider metadata change raw_response_hash without changing canonical_transfer_hash?
Can one transaction contain multiple indistinguishable Transfer rows without event/log index?
Which row filters are required for canonical USDT transfer ledger?
How much more expensive is until_timestamp than true window coverage for Incoming samples?
```

- [ ] **Step 4: Commit**

```bash
git add scripts/tronscan-pagination-probe.ts docs/provider-observations/tronscan-usdt-pagination.md
git commit -m "chore(tron): document provider pagination behavior"
```

## Task 1: Config Defaults And Knobs

**Files:**

- Modify: `src/config.ts`
- Modify: `tests/config/config.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing config test**

Add this to `tests/config/config.test.ts` inside `describe("loadConfig", () => {`:

```ts
it("loads API all-time indexer defaults", () => {
  setRequiredEnv();

  const config = loadConfig();

  expect(config.tronscanPageLimit).toBe(50);
  expect(config.tronscanMaxInFlight).toBe(20);
  expect(config.tronscanGroupMaxInFlight).toBe(2);
  expect(config.tronscanAccountGroupRequestMinIntervalMs).toBe(400);
  expect(config.tronAddressIndexSecondLayerMaxActiveWalletsPerJob).toBe(0);
  expect(config.adminSecondLayerMaxActiveWallets).toBe(25);
  expect(config.tronAddressIndexClaimLimit).toBe(3);
  expect(config.tronAddressIndexLockMs).toBe(10 * 60 * 1000);
  expect(config.tronAddressIndexPollIntervalMs).toBe(15_000);
  expect(config.tronAddressIndexPageBatchSize).toBe(2);
  expect(config.directHardEvidenceLiveLimit).toBe(250);
  expect(config.directHardEvidenceConcurrency).toBe(8);
});
```

Add this test near the page-limit parsing tests:

```ts
it("rejects TronScan page limits above the provider limit", () => {
  setRequiredEnv({ TRONSCAN_PAGE_LIMIT: "100" });

  expect(() => loadConfig()).toThrow("TRONSCAN_PAGE_LIMIT must be a safe integer between 1 and 50");
});
```

- [ ] **Step 2: Run the failing config tests**

Run:

```bash
npx vitest run tests/config/config.test.ts --configLoader bundle
```

Expected: FAIL because `tronscanMaxInFlight`, `tronscanGroupMaxInFlight`, `tronAddressIndexSecondLayerMaxActiveWalletsPerJob`, `adminSecondLayerMaxActiveWallets`, `tronAddressIndexClaimLimit`, `tronAddressIndexLockMs`, `tronAddressIndexPollIntervalMs`, `tronAddressIndexPageBatchSize`, `directHardEvidenceLiveLimit`, and `directHardEvidenceConcurrency` do not exist, `tronscanAccountGroupRequestMinIntervalMs` still defaults to 250, and `tronscanPageLimit` still defaults to 100.

- [ ] **Step 3: Add config fields**

In `src/config.ts`, extend `AppConfig`:

```ts
  tronscanMaxInFlight: number;
  tronscanGroupMaxInFlight: number;
  tronAddressIndexSecondLayerMaxActiveWalletsPerJob: number;
  adminSecondLayerMaxActiveWallets: number;
  tronAddressIndexClaimLimit: number;
  tronAddressIndexLockMs: number;
  tronAddressIndexPollIntervalMs: number;
  tronAddressIndexPageBatchSize: number;
  directHardEvidenceLiveLimit: number;
  directHardEvidenceConcurrency: number;
```

In `loadConfig()`, change page-limit parsing and add new values:

```ts
    tronscanPageLimit: parseIntegerInRange("TRONSCAN_PAGE_LIMIT", process.env.TRONSCAN_PAGE_LIMIT ?? "50", 1, 50),
    tronscanMaxInFlight: parsePositiveInteger("TRONSCAN_MAX_IN_FLIGHT", process.env.TRONSCAN_MAX_IN_FLIGHT ?? "20", 1),
    tronscanGroupMaxInFlight: parsePositiveInteger("TRONSCAN_GROUP_MAX_IN_FLIGHT", process.env.TRONSCAN_GROUP_MAX_IN_FLIGHT ?? "2", 1),
    tronscanAccountGroupRequestMinIntervalMs: parsePositiveInteger(
      "TRONSCAN_ACCOUNT_GROUP_REQUEST_MIN_INTERVAL_MS",
      process.env.TRONSCAN_ACCOUNT_GROUP_REQUEST_MIN_INTERVAL_MS ?? "400",
      0
    ),
    tronAddressIndexSecondLayerMaxActiveWalletsPerJob: parseIntegerInRange(
      "TRON_ADDRESS_INDEX_SECOND_LAYER_MAX_ACTIVE_WALLETS_PER_JOB",
      process.env.TRON_ADDRESS_INDEX_SECOND_LAYER_MAX_ACTIVE_WALLETS_PER_JOB ?? "0",
      0,
      1000
    ),
    adminSecondLayerMaxActiveWallets: parseIntegerInRange(
      "ADMIN_SECOND_LAYER_MAX_ACTIVE_WALLETS",
      process.env.ADMIN_SECOND_LAYER_MAX_ACTIVE_WALLETS ?? "25",
      0,
      1000
    ),
    tronAddressIndexClaimLimit: parsePositiveInteger(
      "TRON_ADDRESS_INDEX_CLAIM_LIMIT",
      process.env.TRON_ADDRESS_INDEX_CLAIM_LIMIT ?? "3",
      1
    ),
    tronAddressIndexLockMs: parsePositiveInteger(
      "TRON_ADDRESS_INDEX_LOCK_MS",
      process.env.TRON_ADDRESS_INDEX_LOCK_MS ?? "600000",
      1
    ),
    tronAddressIndexPollIntervalMs: parsePositiveInteger(
      "TRON_ADDRESS_INDEX_POLL_INTERVAL_MS",
      process.env.TRON_ADDRESS_INDEX_POLL_INTERVAL_MS ?? "15000",
      1
    ),
    tronAddressIndexPageBatchSize: parsePositiveInteger(
      "TRON_ADDRESS_INDEX_PAGE_BATCH_SIZE",
      process.env.TRON_ADDRESS_INDEX_PAGE_BATCH_SIZE ?? "2",
      1
    ),
    directHardEvidenceLiveLimit: parseIntegerInRange(
      "DIRECT_HARD_EVIDENCE_LIVE_LIMIT",
      process.env.DIRECT_HARD_EVIDENCE_LIVE_LIMIT ?? "250",
      0,
      100_000
    ),
    directHardEvidenceConcurrency: parsePositiveInteger(
      "DIRECT_HARD_EVIDENCE_CONCURRENCY",
      process.env.DIRECT_HARD_EVIDENCE_CONCURRENCY ?? "8",
      1
    ),
```

If `tronscanAccountGroupRequestMinIntervalMs` already exists in `loadConfig()`, change only its default from `"250"` to `"400"` instead of adding a duplicate property. This is an upper bound for pacing math, not a throughput promise. The real initial value should come from Task 0 probe results and ramp up only while 429/403/latency stay healthy.

- [ ] **Step 4: Document env**

In `.env.example`, add:

```text
# TronScan API pool. Use one free API key per account group.
TRONSCAN_API_KEY=key1,key2,key3,key4,key5,key6,key7,key8,key9,key10
TRONSCAN_API_KEY_GROUPS=account_1:key1;account_2:key2;account_3:key3;account_4:key4;account_5:key5;account_6:key6;account_7:key7;account_8:key8;account_9:key9;account_10:key10
TRONSCAN_PAGE_LIMIT=50
TRONSCAN_MAX_IN_FLIGHT=20
TRONSCAN_GROUP_MAX_IN_FLIGHT=2
TRONSCAN_ACCOUNT_GROUP_REQUEST_MIN_INTERVAL_MS=400
TRON_ADDRESS_INDEX_SECOND_LAYER_MAX_ACTIVE_WALLETS_PER_JOB=0
ADMIN_SECOND_LAYER_MAX_ACTIVE_WALLETS=25
TRON_ADDRESS_INDEX_CLAIM_LIMIT=3
TRON_ADDRESS_INDEX_LOCK_MS=600000
TRON_ADDRESS_INDEX_POLL_INTERVAL_MS=15000
TRON_ADDRESS_INDEX_PAGE_BATCH_SIZE=2
DIRECT_HARD_EVIDENCE_LIVE_LIMIT=250
DIRECT_HARD_EVIDENCE_CONCURRENCY=8
```

- [ ] **Step 5: Run config tests**

Run:

```bash
npx vitest run tests/config/config.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts tests/config/config.test.ts .env.example
git commit -m "config: add all-time indexer knobs"
```

## Task 2: Bounded Async TronScan Scheduler

**Files:**

- Modify: `src/tron/tronscanScheduler.ts`
- Modify: `tests/tron/tronscanScheduler.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing scheduler concurrency tests**

Add this test to `tests/tron/tronscanScheduler.test.ts`:

```ts
it("dispatches independent account groups without waiting for previous work to finish", async () => {
  let now = 1_000;
  const releases: Array<() => void> = [];
  const scheduler = createTronscanScheduler({
    requestMinIntervalMs: 0,
    globalRequestMinIntervalMs: 0,
    accountGroupRequestMinIntervalMs: 0,
    rateLimitCooldownMs: 250,
    maxInFlight: 2,
    apiKeys: ["key-a", "key-b"],
    apiKeyGroups: [
      { groupId: "account-a", apiKeys: ["key-a"] },
      { groupId: "account-b", apiKeys: ["key-b"] }
    ],
    now: () => now,
    delay: async (ms) => {
      now += ms;
    }
  });
  const events: string[] = [];

  const first = scheduler.schedule({ requestName: "a", path: "/a" }, async () => {
    events.push("a:start");
    await new Promise<void>((resolve) => {
      releases.push(resolve);
    });
    events.push("a:end");
    return "a";
  });
  await Promise.resolve();

  const second = scheduler.schedule({ requestName: "b", path: "/b" }, async () => {
    events.push("b");
    return "b";
  });
  await Promise.resolve();

  expect(events).toEqual(["a:start", "b"]);
  releases[0]?.();
  await expect(first).resolves.toBe("a");
  await expect(second).resolves.toBe("b");
  expect(events).toEqual(["a:start", "b", "a:end"]);
});
```

Add this cap test:

```ts
it("does not exceed max in-flight work", async () => {
  const releases: Array<() => void> = [];
  const scheduler = createTronscanScheduler({
    requestMinIntervalMs: 0,
    rateLimitCooldownMs: 250,
    maxInFlight: 1,
    apiKeys: ["key-a", "key-b"],
    now: () => 1_000,
    delay: async () => undefined
  });
  const events: string[] = [];

  const first = scheduler.schedule({ requestName: "a", path: "/a" }, async () => {
    events.push("a:start");
    await new Promise<void>((resolve) => {
      releases.push(resolve);
    });
    events.push("a:end");
    return "a";
  });
  await Promise.resolve();

  const second = scheduler.schedule({ requestName: "b", path: "/b" }, async () => {
    events.push("b");
    return "b";
  });
  await Promise.resolve();

  expect(events).toEqual(["a:start"]);
  releases[0]?.();
  await first;
  await second;
  expect(events).toEqual(["a:start", "a:end", "b"]);
});
```

Add this per-group cap test:

```ts
it("does not let one account group consume every in-flight slot", async () => {
  const releases: Array<() => void> = [];
  const scheduler = createTronscanScheduler({
    requestMinIntervalMs: 0,
    globalRequestMinIntervalMs: 0,
    accountGroupRequestMinIntervalMs: 0,
    rateLimitCooldownMs: 250,
    maxInFlight: 3,
    maxInFlightPerGroup: 1,
    apiKeys: ["key-a1", "key-a2", "key-b"],
    apiKeyGroups: [
      { groupId: "account-a", apiKeys: ["key-a1", "key-a2"] },
      { groupId: "account-b", apiKeys: ["key-b"] }
    ],
    now: () => 1_000,
    delay: async () => undefined
  });
  const events: string[] = [];

  const first = scheduler.schedule({ requestName: "a1", path: "/a1" }, async () => {
    events.push("a1:start");
    await new Promise<void>((resolve) => releases.push(resolve));
    events.push("a1:end");
    return "a1";
  });
  await Promise.resolve();

  const secondSameGroup = scheduler.schedule({ requestName: "a2", path: "/a2" }, async () => {
    events.push("a2");
    return "a2";
  });
  const thirdOtherGroup = scheduler.schedule({ requestName: "b", path: "/b" }, async () => {
    events.push("b");
    return "b";
  });
  await Promise.resolve();

  expect(events).toEqual(["a1:start", "b"]);
  releases[0]?.();
  await expect(first).resolves.toBe("a1");
  await expect(secondSameGroup).resolves.toBe("a2");
  await expect(thirdOtherGroup).resolves.toBe("b");
  expect(events).toEqual(["a1:start", "b", "a1:end", "a2"]);
});
```

Add this ready-item selection test so a cooled or paced group cannot block a ready group behind it:

```ts
it("skips a waiting group and dispatches the next ready group", async () => {
  let now = 1_000;
  const scheduler = createTronscanScheduler({
    requestMinIntervalMs: 0,
    globalRequestMinIntervalMs: 0,
    accountGroupRequestMinIntervalMs: 1_000,
    rateLimitCooldownMs: 250,
    maxInFlight: 2,
    maxInFlightPerGroup: 1,
    apiKeys: ["key-a", "key-b"],
    apiKeyGroups: [
      { groupId: "account-a", apiKeys: ["key-a"] },
      { groupId: "account-b", apiKeys: ["key-b"] }
    ],
    now: () => now,
    delay: async (ms) => {
      now += ms;
    }
  });
  const events: string[] = [];

  await scheduler.schedule({ requestName: "a1", path: "/a1" }, async () => {
    events.push("a1");
    return "a1";
  });
  const a2 = scheduler.schedule({ requestName: "a2", path: "/a2" }, async () => {
    events.push("a2");
    return "a2";
  });
  const b = scheduler.schedule({ requestName: "b", path: "/b" }, async () => {
    events.push("b");
    return "b";
  });
  await Promise.resolve();

  expect(events).toEqual(["a1", "b"]);
  await expect(a2).resolves.toBe("a2");
  await expect(b).resolves.toBe("b");
});
```

- [ ] **Step 2: Run failing scheduler tests**

Run:

```bash
npx vitest run tests/tron/tronscanScheduler.test.ts --configLoader bundle
```

Expected: FAIL because `maxInFlight`, `maxInFlightPerGroup`, and ready-item selection are not implemented, and `drain()` awaits `item.work()`.

- [ ] **Step 3: Extend scheduler options and diagnostics**

In `src/tron/tronscanScheduler.ts`, update types:

```ts
export type TronscanSchedulerDiagnostics = {
  apiKeyConfigured: boolean;
  apiKeyCount: number;
  apiKeyGroupCount: number;
  queued: number;
  inFlight: number;
  maxInFlight: number;
  maxInFlightPerGroup: number;
  dispatchedRequests: number;
  completedRequests: number;
  failedRequests: number;
  rateLimitedRequests: number;
  cooldownUntilMs: number;
  globalCooldownUntilMs: number;
  globalCooldownUntilMsByScope: Partial<Record<TronscanRateLimitScope, number>>;
  endpointCooldownUntilMs: Partial<Record<TronscanEndpointBucket, number>>;
  inFlightByAccountGroup: Record<string, number>;
  accountGroupCooldownUntilMs: Record<string, number>;
};

export type TronscanSchedulerOptions = {
  requestMinIntervalMs: number;
  rateLimitCooldownMs: number;
  globalRequestMinIntervalMs?: number;
  endpointMinIntervalMs?: Partial<Record<TronscanEndpointBucket, number>>;
  apiKeyGroups?: readonly TronscanApiKeyGroup[];
  accountGroupRequestMinIntervalMs?: number;
  maxInFlight?: number;
  maxInFlightPerGroup?: number;
  apiKeyConfigured?: boolean;
  apiKeys?: readonly string[];
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
};
```

Inside `createTronscanScheduler`, add:

```ts
  const maxInFlight = Math.max(1, options.maxInFlight ?? Math.max(1, slots.length));
  const maxInFlightPerGroup = Math.max(1, options.maxInFlightPerGroup ?? 2);
  let inFlight = 0;
  let dispatchedRequests = 0;
  let completedRequests = 0;
  let failedRequests = 0;
  let rateLimitedRequests = 0;
```

Extend `AccountGroupState`:

```ts
type AccountGroupState = {
  nextRequestAtMs: number;
  cooldownUntilMs: number;
  inFlight: number;
  nextRequestAtMsByScope: Record<TronscanRateLimitScope, number>;
  endpointNextRequestAtMs: Record<TronscanEndpointBucket, number>;
  endpointCooldownUntilMs: Record<TronscanEndpointBucket, number>;
};
```

- [ ] **Step 4: Replace await-in-loop dispatch**

Keep `slotReadyAtMs`, priority selection, cooldown math, and cache coalescing. Replace the body of `drain()` with a bounded dispatcher:

First refactor the existing `earliestSlot(item)` helper into `earliestSlotFrom(item, candidateSlots)`, then keep `earliestSlot(item)` as a one-line wrapper over all slots. The dispatcher needs the same selection logic for "all keys" and "only keys whose account group still has capacity".

```ts
  function applyRateLimitCooldown(slot: ApiKeySlot, item: QueueItem<unknown>, error: unknown): void {
    if (!isRateLimitError(error) || rateLimitCooldownMs <= 0) return;
    rateLimitedRequests += 1;
    const scope = rateLimitScope(item);
    slot.consecutive429CountByScope[scope] += 1;
    const cooldownMs = Math.min(
      rateLimitCooldownMs * 2 ** (slot.consecutive429CountByScope[scope] - 1),
      MAX_RATE_LIMIT_COOLDOWN_MS
    );
    const cooldownStartedAtMs = now();
    const cooldownUntilMs = cooldownStartedAtMs + cooldownMs;
    const bucketState = endpointState[endpointBucket(item)];
    const scopedGlobalState = scopeState[scope];
    const accountGroup = accountGroupPacingEnabled ? accountGroupForSlot(slot) : undefined;
    slot.last429AtMsByScope[scope] = cooldownStartedAtMs;
    slot.cooldownUntilMsByScope[scope] = Math.max(slot.cooldownUntilMsByScope[scope], cooldownUntilMs);
    if (accountGroup) {
      accountGroup.cooldownUntilMs = Math.max(accountGroup.cooldownUntilMs, cooldownUntilMs);
      accountGroup.endpointCooldownUntilMs[endpointBucket(item)] = Math.max(
        accountGroup.endpointCooldownUntilMs[endpointBucket(item)],
        cooldownUntilMs
      );
      return;
    }
    scopedGlobalState.cooldownUntilMs = Math.max(scopedGlobalState.cooldownUntilMs, cooldownUntilMs);
    bucketState.cooldownUntilMs = Math.max(bucketState.cooldownUntilMs, cooldownUntilMs);
  }

  type DispatchCandidate = {
    queueIndex: number;
    item: QueueItem<unknown>;
    slot: ApiKeySlot;
    rank: number;
  };

  function groupStateForDispatch(slot: ApiKeySlot): AccountGroupState | null {
    return accountGroupPacingEnabled ? accountGroupForSlot(slot) : null;
  }

  function canUseGroup(slot: ApiKeySlot): boolean {
    const groupState = groupStateForDispatch(slot);
    return !groupState || groupState.inFlight < maxInFlightPerGroup;
  }

  function earliestEligibleSlot(item: QueueItem<unknown>): ApiKeySlot | null {
    const eligibleSlots = slots.filter(canUseGroup);
    if (eligibleSlots.length === 0) return null;
    return earliestSlotFrom(item, eligibleSlots);
  }

  function dispatchRank(item: QueueItem<unknown>, queueIndex: number): number {
    return priorityRank[item.input.priority ?? "deep_transfer"] * 1_000_000 + queueIndex;
  }

  function nextDispatchCandidate(): { candidate: DispatchCandidate | null; wakeAtMs: number | null } {
    const currentMs = now();
    let candidate: DispatchCandidate | null = null;
    let wakeAtMs: number | null = null;

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
      const item = queue[queueIndex] as QueueItem<unknown>;
      const slot = earliestEligibleSlot(item);
      if (!slot) {
        wakeAtMs = wakeAtMs === null ? currentMs + 10 : Math.min(wakeAtMs, currentMs + 10);
        continue;
      }
      const readyAtMs = slotReadyAtMs(slot, item);
      if (readyAtMs > currentMs) {
        wakeAtMs = wakeAtMs === null ? readyAtMs : Math.min(wakeAtMs, readyAtMs);
        continue;
      }
      const rank = dispatchRank(item, queueIndex);
      if (!candidate || rank < candidate.rank) {
        candidate = { queueIndex, item, slot, rank };
      }
    }

    return { candidate, wakeAtMs };
  }

  function markDispatchPacing(item: QueueItem<unknown>, slot: ApiKeySlot): void {
    const dispatchNow = now();
    const bucket = endpointBucket(item);
    const bucketState = endpointState[bucket];
    const scope = rateLimitScope(item);
    const scopedGlobalState = scopeState[scope];
    const groupState = groupStateForDispatch(slot);
    const endpointIntervalMs = Math.max(0, endpointMinIntervalMs[bucket] ?? endpointMinIntervalMs.default ?? 0);

    slot.nextRequestAtMs = dispatchNow + requestMinIntervalMs;
    if (groupState) {
      groupState.nextRequestAtMs = dispatchNow + accountGroupRequestMinIntervalMs;
      groupState.nextRequestAtMsByScope[scope] = dispatchNow + globalRequestMinIntervalMs;
      groupState.endpointNextRequestAtMs[bucket] = dispatchNow + endpointIntervalMs;
      return;
    }

    scopedGlobalState.nextRequestAtMs = dispatchNow + globalRequestMinIntervalMs;
    bucketState.nextRequestAtMs = dispatchNow + endpointIntervalMs;
  }

  function dispatch(item: QueueItem<unknown>, slot: ApiKeySlot): void {
    const groupState = groupStateForDispatch(slot);
    inFlight += 1;
    if (groupState) groupState.inFlight += 1;
    dispatchedRequests += 1;
    void item.work({ apiKey: slot.apiKey, apiKeyIndex: slot.apiKeyIndex })
      .then((value) => {
        slot.consecutive429CountByScope[rateLimitScope(item)] = 0;
        completedRequests += 1;
        item.resolve(value);
      })
      .catch((error) => {
        failedRequests += 1;
        applyRateLimitCooldown(slot, item, error);
        item.reject(error);
      })
      .finally(() => {
        if (groupState) groupState.inFlight = Math.max(0, groupState.inFlight - 1);
        inFlight -= 1;
        scheduleDrain();
      });
  }

  let drainWakeTimerArmed = false;

  function armDrainWakeTimer(wakeAtMs: number): void {
    if (drainWakeTimerArmed) return;
    drainWakeTimerArmed = true;
    void delay(Math.max(0, wakeAtMs - now())).then(() => {
      drainWakeTimerArmed = false;
      scheduleDrain();
    });
  }
```

Then rewrite `drain()`:

```ts
  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    let waitingForWakeTimer = false;
    try {
      while (queue.length > 0 && inFlight < maxInFlight) {
        const { candidate, wakeAtMs } = nextDispatchCandidate();
        if (!candidate) {
          if (wakeAtMs !== null) {
            armDrainWakeTimer(wakeAtMs);
            waitingForWakeTimer = true;
          }
          break;
        }
        queue.splice(candidate.queueIndex, 1);
        markDispatchPacing(candidate.item, candidate.slot);
        dispatch(candidate.item, candidate.slot);
      }
    } finally {
      running = false;
      if (!waitingForWakeTimer && queue.length > 0 && inFlight < maxInFlight) scheduleDrain();
    }
  }
```

In `diagnostics()`, add:

```ts
        inFlight,
        maxInFlight,
        dispatchedRequests,
        completedRequests,
        failedRequests,
        rateLimitedRequests,
```

- [ ] **Step 5: Wire config in runtime**

In `src/index.ts`, pass:

```ts
  maxInFlight: config.tronscanMaxInFlight,
  maxInFlightPerGroup: config.tronscanGroupMaxInFlight,
```

to `createTronscanScheduler`.

- [ ] **Step 6: Run scheduler tests**

Run:

```bash
npx vitest run tests/tron/tronscanScheduler.test.ts --configLoader bundle
```

Expected: PASS after the old strict-serialization assertion is updated to the new bounded-concurrency contract. Keep the existing assertions for priority, cache coalescing, endpoint pacing, group pacing, and cooldown behavior.

- [ ] **Step 7: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/tron/tronscanScheduler.ts tests/tron/tronscanScheduler.test.ts src/index.ts
git commit -m "feat(tron): dispatch provider requests concurrently"
```

## Task 3: TronScan Transfer Page Metadata

**Files:**

- Modify: `src/tron/tronClient.ts`
- Modify: `tests/tron/tronClient.test.ts`

- [ ] **Step 1: Write failing page metadata test**

Add to `tests/tron/tronClient.test.ts`:

```ts
it("returns related transfer page metadata for address indexing", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({
    total: 10000,
    rangeTotal: 10000,
    token_transfers: [
      {
        transaction_id: "tx1",
        from_address: "TFrom1111111111111111111111111111111",
        to_address: "TTo111111111111111111111111111111111",
        quant: "1000000",
        block_ts: 1_780_090_767_000,
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        confirmed: true
      }
    ]
  }));
  const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

  const page = await client.listRelatedTrc20TransferPage("TSubject111111111111111111111111111111", {
    start: 50,
    limit: 50,
    startTimestamp: 0,
    endTimestamp: 1_780_100_000_000
  });

  expect(page).toMatchObject({
    provider: "tronscan",
    total: 10000,
    rangeTotal: 10000,
    transfers: [{ transaction_id: "tx1" }]
  });
  expect(page.rawResponseHash).toMatch(/^[a-f0-9]{64}$/);
  expect(page.canonicalTransferHash).toMatch(/^[a-f0-9]{64}$/);
  const [url] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.searchParams.get("relatedAddress")).toBe("TSubject111111111111111111111111111111");
  expect(url.searchParams.get("limit")).toBe("50");
  expect(url.searchParams.get("start")).toBe("50");
  expect(url.searchParams.get("start_timestamp")).toBe("0");
  expect(url.searchParams.get("end_timestamp")).toBe("1780100000000");
});
```

- [ ] **Step 2: Run failing client test**

Run:

```bash
npx vitest run tests/tron/tronClient.test.ts --configLoader bundle
```

Expected: FAIL because `listRelatedTrc20TransferPage` does not exist.

- [ ] **Step 3: Add page type and method**

In `src/tron/tronClient.ts`, add:

```ts
import { createHash } from "node:crypto";

export type TronscanTrc20TransferPage = {
  provider: "tronscan" | "trongrid_fallback";
  transfers: RawTronscanTrc20Transfer[];
  total: number | null;
  rangeTotal: number | null;
  rawResponseHash: string | null;
  canonicalTransferHash: string | null;
};
```

Add to `TronDashboardClient`:

```ts
  listRelatedTrc20TransferPage?(
    address: string,
    options?: ListRelatedTrc20TransfersOptions
  ): Promise<TronscanTrc20TransferPage>;
```

Add public method to `TronscanClient`:

First extend `ListRelatedTrc20TransfersOptions` / `ListIncomingTrc20TransfersOptions` with optional `startTimestamp?: number` and `endTimestamp?: number` if they do not already carry both bounds. `buildTronscanTransferHistoryUrl` must emit both `start_timestamp` and `end_timestamp` when present.

```ts
  async listRelatedTrc20TransferPage(
    address: string,
    options: ListRelatedTrc20TransfersOptions = {}
  ): Promise<TronscanTrc20TransferPage> {
    const url = this.buildTronscanTransferHistoryUrl(address, "related", options);
    return this.fetchTransferPageWithFallback(url, {
      address,
      direction: "related",
      options
    });
  }
```

Add private parser:

```ts
function canonicalTransferPageHash(input: {
  total: number | null;
  rangeTotal: number | null;
  transfers: RawTronscanTrc20Transfer[];
}): string {
  const canonicalRows = input.transfers.map((transfer) => ({
    tx: transfer.transaction_id,
    block: (transfer as RawTronscanTrc20Transfer & { block?: unknown }).block ?? null,
    eventIndex: (transfer as RawTronscanTrc20Transfer & { event_index?: unknown }).event_index ?? null,
    logIndex: (transfer as RawTronscanTrc20Transfer & { log_index?: unknown }).log_index ?? null,
    eventType: (transfer as RawTronscanTrc20Transfer & { event_type?: unknown }).event_type ?? null,
    from: transfer.from_address,
    to: transfer.to_address,
    contract: transfer.contract_address,
    amount: transfer.quant,
    ts: transfer.block_ts
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return createHash("sha256").update(JSON.stringify({
    total: input.total,
    rangeTotal: input.rangeTotal,
    transfers: canonicalRows
  })).digest("hex");
}

  private integerOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  }

  private async fetchTronscanTransferPage(url: URL): Promise<TronscanTrc20TransferPage> {
    const json = await this.fetchJson(url, "transfer", {}, undefined, {
      logFinalError: (error) => !this.shouldFallbackToTronGridTransferHistory(error),
      shouldRetry: (error) => this.isTransientError(error) && !this.shouldFallbackToTronGridTransferHistory(error)
    });
    const transfers = (json as { token_transfers?: unknown }).token_transfers;
    if (transfers === undefined) {
      throw new Error("Tronscan transfer response token_transfers field is missing");
    }
    if (!Array.isArray(transfers)) {
      throw new Error("Tronscan transfer response token_transfers must be an array");
    }
    return {
      provider: "tronscan",
      transfers: transfers as RawTronscanTrc20Transfer[],
      total: this.integerOrNull((json as { total?: unknown }).total),
      rangeTotal: this.integerOrNull((json as { rangeTotal?: unknown }).rangeTotal),
      rawResponseHash: createHash("sha256").update(JSON.stringify(json)).digest("hex"),
      canonicalTransferHash: canonicalTransferPageHash({
        total: this.integerOrNull((json as { total?: unknown }).total),
        rangeTotal: this.integerOrNull((json as { rangeTotal?: unknown }).rangeTotal),
        transfers: transfers as RawTronscanTrc20Transfer[]
      })
    };
  }
```

Add fallback wrapper:

```ts
  private async fetchTransferPageWithFallback(
    url: URL,
    fallback: {
      address: string;
      direction: TronGridTransferDirection;
      options: ListIncomingTrc20TransfersOptions | ListRelatedTrc20TransfersOptions;
      tokenContractAddress?: string | null;
    }
  ): Promise<TronscanTrc20TransferPage> {
    try {
      return await this.fetchTronscanTransferPage(url);
    } catch (error) {
      if (!this.shouldFallbackToTronGridTransferHistory(error)) throw error;
      this.logger.warn("tronscan_transfer_history_fallback_to_trongrid", {
        address: fallback.address,
        direction: fallback.direction,
        token_contract: fallback.tokenContractAddress === undefined
          ? TRON_USDT_CONTRACT_ADDRESS
          : fallback.tokenContractAddress,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        provider: "trongrid_fallback",
        transfers: await this.fetchTronGridTransferArray(fallback),
        total: null,
        rangeTotal: null,
        rawResponseHash: null,
        canonicalTransferHash: null
      };
    }
  }
```

- [ ] **Step 4: Keep old array method behavior**

Change `fetchTronscanTransferArray` to reuse page parser:

```ts
  private async fetchTronscanTransferArray(url: URL): Promise<RawTronscanTrc20Transfer[]> {
    return (await this.fetchTronscanTransferPage(url)).transfers;
  }
```

- [ ] **Step 5: Run client tests**

Run:

```bash
npx vitest run tests/tron/tronClient.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tron/tronClient.ts tests/tron/tronClient.test.ts
git commit -m "feat(tron): expose transfer page metadata"
```

## Task 4: Address Index Storage

**Files:**

- Create: `migrations/026_tron_address_all_time_index.sql`
- Modify: `src/types.ts`
- Modify: `src/storage/repositories.ts`
- Modify: `tests/storage/repositories.test.ts`

- [ ] **Step 1: Write failing repository tests**

Add imports in `tests/storage/repositories.test.ts`:

```ts
  getTronAddressUsdtIndexState,
  upsertTronAddressUsdtIndexState,
  claimQueuedTronAddressUsdtIndexStates,
  upsertTronAddressUsdtIndexPage,
  upsertTronAddressUsdtCoverageInterval,
  listTronAddressUsdtIndexPages,
```

Add tests:

```ts
it("upserts and reads TRON address USDT index state", async () => {
  const db = fakeDb([
    {
      rows: [{
        address: "TSubject111111111111111111111111111111",
        token_contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        coverage_mode: "all_time",
        coverage_kind: "provider_windowed",
        target_timestamp_ms: 0,
        target_timestamp: null,
        status: "queued",
        status_reason: null,
        provider: null,
        total_reported: null,
        fetched_transfer_count: 0,
        unique_counterparty_count: 0,
        newest_transfer_at: null,
        oldest_transfer_at: null,
        covered_until_timestamp: null,
        fetched_page_count: 0,
        planned_page_count: null,
        current_end_timestamp: null,
        provider_cap_hit: false,
        budget_exhausted: false,
        provider_inconsistent: false,
        priority: 0,
        next_run_at: new Date("2026-07-02T00:00:00.000Z"),
        attempt_count: 0,
        max_attempts: 5,
        retry_count: 0,
        last_error: null,
        last_error_class: null,
        last_successful_page_at: null,
        queued_reason: "deep_subject",
        requested_by_job_id: "job-1",
        locked_at: null,
        locked_until: null,
        heartbeat_at: null,
        lock_owner: null,
        budget_pages: null,
        budget_seconds: null,
        completed_at: null,
        created_at: new Date("2026-07-02T00:00:00.000Z"),
        updated_at: new Date("2026-07-02T00:00:00.000Z")
      }]
    }
  ]);

  const state = await upsertTronAddressUsdtIndexState(db, {
    address: "TSubject111111111111111111111111111111",
    coverageMode: "all_time",
    status: "queued",
    queuedReason: "deep_subject",
    requestedByJobId: "job-1"
  });

  expect(state.status).toBe("queued");
  expect(state.queuedReason).toBe("deep_subject");
  expect(queries[0].sql).toContain("insert into tron_address_usdt_index_states");
});

it("claims queued TRON address index states without exposing keys or broad locks", async () => {
  const db = fakeDb([{ rows: [] }]);

  await claimQueuedTronAddressUsdtIndexStates(db, {
    limit: 3,
    lockOwner: "worker-a",
    lockMs: 600_000,
    coverageMode: "all_time"
  });

  expect(queries[0].sql).toContain("for update skip locked");
  expect(queries[0].sql).toContain("status in ('queued', 'failed_retryable')");
  expect(queries[0].sql).toContain("next_run_at <= now()");
  expect(queries[0].sql).toContain("order by priority desc, created_at asc");
});

it("upserts page state for a time-window offset", async () => {
  const db = fakeDb([{ rows: [] }]);

  await upsertTronAddressUsdtIndexPage(db, {
    address: "TSubject111111111111111111111111111111",
    coverageMode: "all_time",
    targetTimestampMs: 0,
    windowStartTimestampMs: 0,
    windowEndTimestampMs: 1_780_100_000_000,
    startOffset: 50,
    limitCount: 50,
    status: "complete",
    transferCount: 50,
    provider: "tronscan",
    attemptCount: 1,
    error: null,
    newestTransferAt: new Date("2026-06-14T15:05:15.000Z"),
    oldestTransferAt: new Date("2026-06-09T10:50:36.000Z")
  });

  expect(queries[0].sql).toContain("insert into tron_address_usdt_index_pages");
  expect(queries[0].params).toContain(1_780_100_000_000);
});

it("keeps targeted coverage separate from all-time coverage", async () => {
  const db = fakeDb([{ rows: [] }]);

  await upsertTronAddressUsdtIndexState(db, {
    address: "TSubject111111111111111111111111111111",
    coverageMode: "targeted",
    targetTimestamp: new Date("2026-06-14T15:05:15.000Z"),
    status: "complete",
    queuedReason: "where_is_money_hop"
  });

  expect(queries[0].sql).toContain("on conflict (address, token_contract, coverage_mode, target_timestamp_ms)");
  expect(queries[0].params).toContain("targeted");
});
```

- [ ] **Step 2: Run failing storage tests**

Run:

```bash
npx vitest run tests/storage/repositories.test.ts --configLoader bundle
```

Expected: FAIL because repository functions and types do not exist.

- [ ] **Step 3: Add migration**

Create `migrations/026_tron_address_all_time_index.sql`:

```sql
create table if not exists tron_address_usdt_index_states (
  address text not null,
  token_contract text not null default 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  coverage_mode text not null default 'all_time',
  coverage_kind text not null default 'provider_windowed',
  target_timestamp_ms bigint not null default 0,
  target_timestamp timestamptz,
  status text not null,
  status_reason text,
  provider text,
  total_reported integer,
  fetched_transfer_count integer not null default 0,
  unique_counterparty_count integer not null default 0,
  newest_transfer_at timestamptz,
  oldest_transfer_at timestamptz,
  covered_until_timestamp timestamptz,
  fetched_page_count integer not null default 0,
  planned_page_count integer,
  current_end_timestamp timestamptz,
  provider_cap_hit boolean not null default false,
  budget_exhausted boolean not null default false,
  provider_inconsistent boolean not null default false,
  priority integer not null default 0,
  next_run_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  retry_count integer not null default 0,
  last_error text,
  last_error_class text,
  last_successful_page_at timestamptz,
  queued_reason text,
  requested_by_job_id text,
  locked_at timestamptz,
  locked_until timestamptz,
  heartbeat_at timestamptz,
  lock_owner text,
  budget_pages integer,
  budget_seconds integer,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (address, token_contract, coverage_mode, target_timestamp_ms)
);

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_coverage_mode_check;
alter table tron_address_usdt_index_states
  add constraint tron_address_usdt_index_states_coverage_mode_check
  check (coverage_mode in ('all_time', 'targeted'));

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_coverage_kind_check;
alter table tron_address_usdt_index_states
  add constraint tron_address_usdt_index_states_coverage_kind_check
  check (coverage_kind in ('provider_windowed'));

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_target_check;
alter table tron_address_usdt_index_states
  add constraint tron_address_usdt_index_states_target_check
  check (
    (coverage_mode = 'all_time' and target_timestamp_ms = 0 and target_timestamp is null)
    or
    (coverage_mode = 'targeted' and target_timestamp_ms > 0 and target_timestamp is not null)
  );

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_status_check;
alter table tron_address_usdt_index_states
  add constraint tron_address_usdt_index_states_status_check
  check (status in ('queued', 'running', 'complete', 'partial', 'failed_retryable', 'failed_terminal'));

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_status_reason_check;
alter table tron_address_usdt_index_states
  add constraint tron_address_usdt_index_states_status_reason_check
  check (status_reason is null or status_reason in (
    'complete_provider_windowed',
    'partial_provider_cap',
    'partial_budget_exhausted',
    'partial_rate_limited',
    'partial_provider_inconsistent',
    'too_large_deferred',
    'failed_retryable',
    'failed_terminal'
  ));

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_provider_check;
alter table tron_address_usdt_index_states
  add constraint tron_address_usdt_index_states_provider_check
  check (provider is null or provider in ('tronscan', 'trongrid_fallback', 'mixed'));

create index if not exists tron_address_usdt_index_states_queue_idx
  on tron_address_usdt_index_states(coverage_mode, status, priority desc, next_run_at, created_at);

create index if not exists tron_address_usdt_index_states_lock_idx
  on tron_address_usdt_index_states(coverage_mode, status, locked_until, heartbeat_at);

create table if not exists tron_address_usdt_coverage_intervals (
  address text not null,
  token_contract text not null default 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  coverage_mode text not null,
  target_timestamp_ms bigint not null default 0,
  provider text not null,
  start_timestamp timestamptz not null,
  end_timestamp timestamptz not null,
  status text not null,
  status_reason text not null,
  total_reported integer,
  range_total integer,
  pages_fetched integer not null default 0,
  rows_fetched integer not null default 0,
  unique_rows_inserted integer not null default 0,
  cap_hit boolean not null default false,
  provider_inconsistent boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (address, token_contract, coverage_mode, target_timestamp_ms, provider, start_timestamp, end_timestamp)
);

create index if not exists tron_address_usdt_coverage_intervals_lookup_idx
  on tron_address_usdt_coverage_intervals(address, token_contract, coverage_mode, start_timestamp, end_timestamp);

create table if not exists tron_address_usdt_index_pages (
  address text not null,
  token_contract text not null default 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  coverage_mode text not null default 'all_time',
  target_timestamp_ms bigint not null default 0,
  window_start_timestamp_ms bigint not null,
  window_end_timestamp_ms bigint not null,
  start_offset integer not null,
  limit_count integer not null,
  status text not null,
  transfer_count integer not null default 0,
  provider text,
  total_reported integer,
  range_total integer,
  raw_response_hash text,
  canonical_transfer_hash text,
  attempt_count integer not null default 0,
  error text,
  newest_transfer_at timestamptz,
  oldest_transfer_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (address, token_contract, coverage_mode, target_timestamp_ms, window_start_timestamp_ms, window_end_timestamp_ms, start_offset)
);

alter table tron_address_usdt_index_pages drop constraint if exists tron_address_usdt_index_pages_coverage_mode_check;
alter table tron_address_usdt_index_pages
  add constraint tron_address_usdt_index_pages_coverage_mode_check
  check (coverage_mode in ('all_time', 'targeted'));

alter table tron_address_usdt_index_pages drop constraint if exists tron_address_usdt_index_pages_status_check;
alter table tron_address_usdt_index_pages
  add constraint tron_address_usdt_index_pages_status_check
  check (status in ('queued', 'running', 'complete', 'empty', 'failed'));

alter table tron_address_usdt_index_pages drop constraint if exists tron_address_usdt_index_pages_provider_check;
alter table tron_address_usdt_index_pages
  add constraint tron_address_usdt_index_pages_provider_check
  check (provider is null or provider in ('tronscan', 'trongrid_fallback', 'mixed'));

create index if not exists tron_address_usdt_index_pages_address_status_idx
  on tron_address_usdt_index_pages(address, coverage_mode, target_timestamp_ms, window_start_timestamp_ms, window_end_timestamp_ms, status, updated_at);
```

- [ ] **Step 4: Add types**

Add the shared types from the top of this plan to `src/types.ts`. Export all names exactly as listed.

- [ ] **Step 4A: Add mandatory stable transfer identity before indexing**

Before Task 5, add a stable `transfer_id` column and use it for every idempotent indexed-transfer upsert. Treat `(tx_hash, event_index)` as insufficient for provider-windowed indexing: TronScan can omit or reshape event indexes, and same-timestamp overlap must dedupe by a provider-stable identity.

`transfer_id` must hash at least:

```text
provider
tx_hash
event_type / method
from_address
to_address
contract_address
amount_raw
block_timestamp
block_number if present
log_index / event_index / ordinal-in-tx if present
provider_row_ordinal_in_tx when event/log index is missing
```

Acceptance:

```text
same address indexed twice inserts 0 duplicates on the second run
same tx with multiple TRC20 Transfer events keeps distinct rows
missing provider event_index does not collapse unrelated rows
same-timestamp boundary overlap dedupes cleanly
```

- [ ] **Step 5: Add repository functions**

In `src/storage/repositories.ts`, import the new types from `../types` and add parser sets:

```ts
const tronAddressUsdtIndexStatuses = new Set<TronAddressUsdtIndexStatus>([
  "queued",
  "running",
  "complete",
  "partial",
  "failed_retryable",
  "failed_terminal"
]);
const tronAddressUsdtIndexPageStatuses = new Set<TronAddressUsdtIndexPageStatus>(["queued", "running", "complete", "empty", "failed"]);
const tronAddressUsdtIndexProviders = new Set<TronAddressUsdtIndexProvider>(["tronscan", "trongrid_fallback", "mixed"]);
const tronAddressUsdtCoverageModes = new Set<TronAddressUsdtCoverageMode>(["all_time", "targeted"]);
const tronAddressUsdtCoverageStatusReasons = new Set<TronAddressUsdtCoverageStatusReason>([
  "complete_provider_windowed",
  "partial_provider_cap",
  "partial_budget_exhausted",
  "partial_rate_limited",
  "partial_provider_inconsistent",
  "too_large_deferred",
  "failed_retryable",
  "failed_terminal"
]);
```

Add parsers and mappers:

```ts
function parseTronAddressUsdtIndexStatus(value: string): TronAddressUsdtIndexStatus {
  if (!tronAddressUsdtIndexStatuses.has(value as TronAddressUsdtIndexStatus)) {
    throw new Error(`Unknown TRON address USDT index status: ${value}`);
  }
  return value as TronAddressUsdtIndexStatus;
}

function parseNullableTronAddressUsdtIndexProvider(value: string | null): TronAddressUsdtIndexProvider | null {
  if (value === null) return null;
  if (!tronAddressUsdtIndexProviders.has(value as TronAddressUsdtIndexProvider)) {
    throw new Error(`Unknown TRON address USDT index provider: ${value}`);
  }
  return value as TronAddressUsdtIndexProvider;
}

function parseTronAddressUsdtIndexPageStatus(value: string): TronAddressUsdtIndexPageStatus {
  if (!tronAddressUsdtIndexPageStatuses.has(value as TronAddressUsdtIndexPageStatus)) {
    throw new Error(`Unknown TRON address USDT index page status: ${value}`);
  }
  return value as TronAddressUsdtIndexPageStatus;
}

function parseTronAddressUsdtCoverageMode(value: string): TronAddressUsdtCoverageMode {
  if (!tronAddressUsdtCoverageModes.has(value as TronAddressUsdtCoverageMode)) {
    throw new Error(`Unknown TRON address USDT coverage mode: ${value}`);
  }
  return value as TronAddressUsdtCoverageMode;
}

function parseNullableTronAddressUsdtCoverageStatusReason(value: string | null): TronAddressUsdtCoverageStatusReason | null {
  if (value === null) return null;
  if (!tronAddressUsdtCoverageStatusReasons.has(value as TronAddressUsdtCoverageStatusReason)) {
    throw new Error(`Unknown TRON address USDT coverage status reason: ${value}`);
  }
  return value as TronAddressUsdtCoverageStatusReason;
}

function targetTimestampMsForCoverage(input: {
  coverageMode: TronAddressUsdtCoverageMode;
  targetTimestamp?: Date | null;
}): number {
  return input.coverageMode === "targeted" && input.targetTimestamp
    ? input.targetTimestamp.getTime()
    : 0;
}

function mapTronAddressUsdtIndexStateRow(row: Record<string, any>): TronAddressUsdtIndexState {
  return {
    address: row.address,
    tokenContract: row.token_contract,
    coverageMode: parseTronAddressUsdtCoverageMode(row.coverage_mode),
    coverageKind: "provider_windowed",
    targetTimestamp: row.target_timestamp ?? null,
    status: parseTronAddressUsdtIndexStatus(row.status),
    statusReason: parseNullableTronAddressUsdtCoverageStatusReason(row.status_reason ?? null),
    provider: parseNullableTronAddressUsdtIndexProvider(row.provider ?? null),
    totalReported: row.total_reported === null ? null : Number(row.total_reported),
    fetchedTransferCount: Number(row.fetched_transfer_count),
    uniqueCounterpartyCount: Number(row.unique_counterparty_count),
    newestTransferAt: row.newest_transfer_at ?? null,
    oldestTransferAt: row.oldest_transfer_at ?? null,
    coveredUntilTimestamp: row.covered_until_timestamp ?? null,
    fetchedPageCount: Number(row.fetched_page_count),
    plannedPageCount: row.planned_page_count === null ? null : Number(row.planned_page_count),
    currentEndTimestamp: row.current_end_timestamp ?? null,
    providerCapHit: Boolean(row.provider_cap_hit),
    budgetExhausted: Boolean(row.budget_exhausted),
    providerInconsistent: Boolean(row.provider_inconsistent),
    priority: Number(row.priority),
    nextRunAt: row.next_run_at,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    retryCount: Number(row.retry_count),
    lastError: row.last_error ?? null,
    lastErrorClass: row.last_error_class ?? null,
    lastSuccessfulPageAt: row.last_successful_page_at ?? null,
    queuedReason: row.queued_reason ?? null,
    requestedByJobId: row.requested_by_job_id ?? null,
    lockedAt: row.locked_at ?? null,
    lockedUntil: row.locked_until ?? null,
    heartbeatAt: row.heartbeat_at ?? null,
    lockOwner: row.lock_owner ?? null,
    budgetPages: row.budget_pages === null ? null : Number(row.budget_pages),
    budgetSeconds: row.budget_seconds === null ? null : Number(row.budget_seconds),
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTronAddressUsdtIndexPageRow(row: Record<string, any>): TronAddressUsdtIndexPage {
  return {
    address: row.address,
    tokenContract: row.token_contract,
    coverageMode: parseTronAddressUsdtCoverageMode(row.coverage_mode),
    targetTimestampMs: Number(row.target_timestamp_ms),
    windowStartTimestampMs: Number(row.window_start_timestamp_ms),
    windowEndTimestampMs: Number(row.window_end_timestamp_ms),
    startOffset: Number(row.start_offset),
    limitCount: Number(row.limit_count),
    status: parseTronAddressUsdtIndexPageStatus(row.status),
    transferCount: Number(row.transfer_count),
    provider: parseNullableTronAddressUsdtIndexProvider(row.provider ?? null),
    totalReported: row.total_reported === null ? null : Number(row.total_reported),
    rangeTotal: row.range_total === null ? null : Number(row.range_total),
    rawResponseHash: row.raw_response_hash ?? null,
    canonicalTransferHash: row.canonical_transfer_hash ?? null,
    attemptCount: Number(row.attempt_count),
    error: row.error ?? null,
    newestTransferAt: row.newest_transfer_at ?? null,
    oldestTransferAt: row.oldest_transfer_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
```

Add functions:

```ts
// ponytail: one boring upsert is enough for the first implementation,
// but it must not overwrite existing counters with zero when a caller only queues work.
export async function getTronAddressUsdtIndexState(
  db: Db,
  input: {
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp?: Date | null;
  }
): Promise<TronAddressUsdtIndexState | null> {
  const targetTimestampMs = targetTimestampMsForCoverage(input);
  const result = await db.query(
    `select address, token_contract, coverage_mode, coverage_kind, target_timestamp_ms, target_timestamp,
       status, status_reason, provider, total_reported,
       fetched_transfer_count, unique_counterparty_count, newest_transfer_at,
       oldest_transfer_at, covered_until_timestamp, fetched_page_count, planned_page_count,
       current_end_timestamp, provider_cap_hit, budget_exhausted, provider_inconsistent,
       priority, next_run_at, attempt_count, max_attempts, retry_count, last_error, last_error_class,
       last_successful_page_at, queued_reason, requested_by_job_id, locked_at, locked_until,
       heartbeat_at, lock_owner, budget_pages, budget_seconds,
       completed_at, created_at, updated_at
     from tron_address_usdt_index_states
     where address = $1
       and coverage_mode = $2
       and target_timestamp_ms = $3`,
    [input.address, input.coverageMode, targetTimestampMs]
  );
  return result.rows[0] ? mapTronAddressUsdtIndexStateRow(result.rows[0]) : null;
}

type UpsertTronAddressUsdtIndexStateInput = {
  address: string;
  coverageMode: TronAddressUsdtCoverageMode;
  targetTimestamp?: Date | null;
  status: TronAddressUsdtIndexStatus;
  statusReason?: TronAddressUsdtCoverageStatusReason | null;
  provider?: TronAddressUsdtIndexProvider | null;
  totalReported?: number | null;
  fetchedTransferCount?: number;
  uniqueCounterpartyCount?: number;
  newestTransferAt?: Date | null;
  oldestTransferAt?: Date | null;
  coveredUntilTimestamp?: Date | null;
  fetchedPageCount?: number;
  plannedPageCount?: number | null;
  currentEndTimestamp?: Date | null;
  providerCapHit?: boolean;
  budgetExhausted?: boolean;
  providerInconsistent?: boolean;
  priority?: number;
  nextRunAt?: Date | null;
  attemptCount?: number;
  maxAttempts?: number;
  retryCount?: number;
  lastError?: string | null;
  lastErrorClass?: string | null;
  lastSuccessfulPageAt?: Date | null;
  queuedReason?: string | null;
  requestedByJobId?: string | null;
  lockedAt?: Date | null;
  lockedUntil?: Date | null;
  heartbeatAt?: Date | null;
  lockOwner?: string | null;
  budgetPages?: number | null;
  budgetSeconds?: number | null;
  completedAt?: Date | null;
};

export async function upsertTronAddressUsdtIndexState(
  db: Db,
  input: UpsertTronAddressUsdtIndexStateInput
): Promise<TronAddressUsdtIndexState> {
  const targetTimestampMs = targetTimestampMsForCoverage(input);
  const result = await db.query(
    `insert into tron_address_usdt_index_states (
       address, coverage_mode, target_timestamp_ms, target_timestamp,
       status, status_reason, provider, total_reported, fetched_transfer_count,
       unique_counterparty_count, newest_transfer_at, oldest_transfer_at, covered_until_timestamp,
       fetched_page_count, planned_page_count, current_end_timestamp,
       provider_cap_hit, budget_exhausted, provider_inconsistent,
       priority, next_run_at, attempt_count, max_attempts, retry_count,
       last_error, last_error_class, last_successful_page_at, queued_reason,
       requested_by_job_id, locked_at, locked_until, heartbeat_at, lock_owner,
       budget_pages, budget_seconds, completed_at
     )
     values (
       $1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,0),coalesce($10,0),$11,$12,$13,
       coalesce($14,0),$15,$16,coalesce($17,false),coalesce($18,false),coalesce($19,false),
       coalesce($20,0),coalesce($21,now()),coalesce($22,0),coalesce($23,5),coalesce($24,0),
       $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36
     )
     on conflict (address, token_contract, coverage_mode, target_timestamp_ms) do update set
       status = excluded.status,
       status_reason = excluded.status_reason,
       provider = coalesce(excluded.provider, tron_address_usdt_index_states.provider),
       total_reported = coalesce(excluded.total_reported, tron_address_usdt_index_states.total_reported),
       fetched_transfer_count = coalesce($9, tron_address_usdt_index_states.fetched_transfer_count),
       unique_counterparty_count = coalesce($10, tron_address_usdt_index_states.unique_counterparty_count),
       newest_transfer_at = coalesce(excluded.newest_transfer_at, tron_address_usdt_index_states.newest_transfer_at),
       oldest_transfer_at = coalesce(excluded.oldest_transfer_at, tron_address_usdt_index_states.oldest_transfer_at),
       covered_until_timestamp = coalesce(excluded.covered_until_timestamp, tron_address_usdt_index_states.covered_until_timestamp),
       fetched_page_count = coalesce($14, tron_address_usdt_index_states.fetched_page_count),
       planned_page_count = coalesce(excluded.planned_page_count, tron_address_usdt_index_states.planned_page_count),
       current_end_timestamp = coalesce(excluded.current_end_timestamp, tron_address_usdt_index_states.current_end_timestamp),
       provider_cap_hit = coalesce($17, tron_address_usdt_index_states.provider_cap_hit),
       budget_exhausted = coalesce($18, tron_address_usdt_index_states.budget_exhausted),
       provider_inconsistent = coalesce($19, tron_address_usdt_index_states.provider_inconsistent),
       priority = coalesce($20, tron_address_usdt_index_states.priority),
       next_run_at = coalesce(excluded.next_run_at, tron_address_usdt_index_states.next_run_at),
       attempt_count = coalesce($22, tron_address_usdt_index_states.attempt_count),
       max_attempts = coalesce($23, tron_address_usdt_index_states.max_attempts),
       retry_count = coalesce($24, tron_address_usdt_index_states.retry_count),
       last_error = excluded.last_error,
       last_error_class = excluded.last_error_class,
       last_successful_page_at = coalesce(excluded.last_successful_page_at, tron_address_usdt_index_states.last_successful_page_at),
       queued_reason = coalesce(excluded.queued_reason, tron_address_usdt_index_states.queued_reason),
       requested_by_job_id = coalesce(excluded.requested_by_job_id, tron_address_usdt_index_states.requested_by_job_id),
       locked_at = excluded.locked_at,
       locked_until = excluded.locked_until,
       heartbeat_at = excluded.heartbeat_at,
       lock_owner = excluded.lock_owner,
       budget_pages = coalesce(excluded.budget_pages, tron_address_usdt_index_states.budget_pages),
       budget_seconds = coalesce(excluded.budget_seconds, tron_address_usdt_index_states.budget_seconds),
       completed_at = excluded.completed_at,
       updated_at = now()
     returning address, token_contract, coverage_mode, coverage_kind, target_timestamp_ms, target_timestamp,
       status, status_reason, provider, total_reported,
       fetched_transfer_count, unique_counterparty_count, newest_transfer_at,
       oldest_transfer_at, covered_until_timestamp, fetched_page_count, planned_page_count,
       current_end_timestamp, provider_cap_hit, budget_exhausted, provider_inconsistent,
       priority, next_run_at, attempt_count, max_attempts, retry_count, last_error, last_error_class,
       last_successful_page_at, queued_reason, requested_by_job_id, locked_at, locked_until,
       heartbeat_at, lock_owner, budget_pages, budget_seconds,
       completed_at, created_at, updated_at`,
    [
      input.address,
      input.coverageMode,
      targetTimestampMs,
      input.coverageMode === "targeted" ? input.targetTimestamp ?? null : null,
      input.status,
      input.statusReason ?? null,
      input.provider ?? null,
      input.totalReported ?? null,
      input.fetchedTransferCount ?? null,
      input.uniqueCounterpartyCount ?? null,
      input.newestTransferAt ?? null,
      input.oldestTransferAt ?? null,
      input.coveredUntilTimestamp ?? null,
      input.fetchedPageCount ?? null,
      input.plannedPageCount ?? null,
      input.currentEndTimestamp ?? null,
      input.providerCapHit ?? null,
      input.budgetExhausted ?? null,
      input.providerInconsistent ?? null,
      input.priority ?? null,
      input.nextRunAt ?? null,
      input.attemptCount ?? null,
      input.maxAttempts ?? null,
      input.retryCount ?? null,
      input.lastError ?? null,
      input.lastErrorClass ?? null,
      input.lastSuccessfulPageAt ?? null,
      input.queuedReason ?? null,
      input.requestedByJobId ?? null,
      input.lockedAt ?? null,
      input.lockedUntil ?? null,
      input.heartbeatAt ?? null,
      input.lockOwner ?? null,
      input.budgetPages ?? null,
      input.budgetSeconds ?? null,
      input.completedAt ?? null
    ]
  );
  return mapTronAddressUsdtIndexStateRow(result.rows[0]);
}
```

Add a separate queue helper. Do not call the broad upsert from queue paths.

Queue state rules:

```text
complete -> return existing
running -> return existing; do not steal the lock
queued -> merge priority/reason/budget without resetting counters
partial -> return existing unless the new request has a stricter budget or targeted timestamp
failed_terminal -> return existing; no automatic requeue
failed_retryable -> requeue only when next_run_at/backoff allows it
```

```ts
export async function queueTronAddressUsdtIndexState(
  db: Db,
  input: {
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp?: Date | null;
    queuedReason: string;
    requestedByJobId?: string | null;
    priority?: number;
    nextRunAt?: Date | null;
    budgetPages?: number | null;
    budgetSeconds?: number | null;
  }
): Promise<TronAddressUsdtIndexState> {
  const existing = await getTronAddressUsdtIndexState(db, input);
  if (existing?.status === "complete" || existing?.status === "running" || existing?.status === "failed_terminal") {
    return existing;
  }
  if (existing?.status === "partial" && input.coverageMode === "all_time") {
    return existing;
  }
  if (existing?.status === "failed_retryable" && existing.nextRunAt > new Date()) {
    return existing;
  }

  return upsertTronAddressUsdtIndexState(db, {
    address: input.address,
    coverageMode: input.coverageMode,
    targetTimestamp: input.targetTimestamp ?? null,
    status: "queued",
    statusReason: null,
    queuedReason: input.queuedReason,
    requestedByJobId: input.requestedByJobId ?? null,
    priority: input.priority ?? existing?.priority ?? 0,
    nextRunAt: input.nextRunAt ?? existing?.nextRunAt ?? new Date(),
    budgetPages: input.budgetPages ?? existing?.budgetPages ?? null,
    budgetSeconds: input.budgetSeconds ?? existing?.budgetSeconds ?? null
  });
}
```

Add the claim function with row locking:

```ts
export async function claimQueuedTronAddressUsdtIndexStates(
  db: Db,
  input: {
    limit: number;
    lockOwner: string;
    lockMs: number;
    coverageMode?: TronAddressUsdtCoverageMode;
  }
): Promise<TronAddressUsdtIndexState[]> {
  const result = await db.query(
    `with candidates as (
       select address, token_contract, coverage_mode, target_timestamp_ms
       from tron_address_usdt_index_states
       where ($4::text is null or coverage_mode = $4)
         and status in ('queued', 'failed_retryable')
         and next_run_at <= now()
         and (locked_until is null or locked_until < now())
       order by priority desc, created_at asc
       limit $1
       for update skip locked
     )
     update tron_address_usdt_index_states state
     set status = 'running',
       locked_at = now(),
       locked_until = now() + ($2::text || ' milliseconds')::interval,
       heartbeat_at = now(),
       lock_owner = $3,
       attempt_count = state.attempt_count + 1,
       retry_count = state.retry_count + 1,
       updated_at = now()
     from candidates
     where state.address = candidates.address
       and state.token_contract = candidates.token_contract
       and state.coverage_mode = candidates.coverage_mode
       and state.target_timestamp_ms = candidates.target_timestamp_ms
     returning state.address, state.token_contract, state.coverage_mode, state.coverage_kind, state.target_timestamp_ms, state.target_timestamp,
       state.status, state.status_reason, state.provider, state.total_reported,
       state.fetched_transfer_count, state.unique_counterparty_count, state.newest_transfer_at,
       state.oldest_transfer_at, state.covered_until_timestamp, state.fetched_page_count, state.planned_page_count,
       state.current_end_timestamp, state.provider_cap_hit, state.budget_exhausted, state.provider_inconsistent,
       state.priority, state.next_run_at, state.attempt_count, state.max_attempts, state.retry_count,
       state.last_error, state.last_error_class, state.last_successful_page_at,
       state.queued_reason, state.requested_by_job_id, state.locked_at, state.locked_until,
       state.heartbeat_at, state.lock_owner, state.budget_pages, state.budget_seconds,
       state.completed_at, state.created_at, state.updated_at`,
    [input.limit, input.lockMs, input.lockOwner, input.coverageMode ?? null]
  );
  return result.rows.map(mapTronAddressUsdtIndexStateRow);
}
```

Add a failure helper with explicit retry semantics:

```ts
export async function failTronAddressUsdtIndexState(
  db: Db,
  input: {
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp?: Date | null;
    error: string;
    errorClass: "rate_limited" | "provider_error" | "provider_inconsistent" | "terminal";
    nextRunAt?: Date | null;
  }
): Promise<void> {
  const targetTimestampMs = targetTimestampMsForCoverage(input);
  const retryable = input.errorClass !== "terminal";
  await db.query(
    `update tron_address_usdt_index_states
     set status = case
         when $5::boolean = true and attempt_count < max_attempts then 'failed_retryable'
         else 'failed_terminal'
       end,
       status_reason = case
         when $4 = 'provider_inconsistent' then 'partial_provider_inconsistent'
         when $4 = 'rate_limited' then 'partial_rate_limited'
         when $5::boolean = true and attempt_count < max_attempts then 'failed_retryable'
         else 'failed_terminal'
       end,
       last_error = $3,
       last_error_class = $4,
       next_run_at = coalesce($6, now() + interval '5 minutes'),
       locked_at = null,
       locked_until = null,
       heartbeat_at = null,
       lock_owner = null,
       updated_at = now()
     where address = $1
       and coverage_mode = $2
       and target_timestamp_ms = $7`,
    [input.address, input.coverageMode, input.error, input.errorClass, retryable, input.nextRunAt ?? null, targetTimestampMs]
  );
}
```

Add page upsert:

```ts
export async function upsertTronAddressUsdtIndexPage(
  db: Db,
  input: Omit<TronAddressUsdtIndexPage, "tokenContract" | "createdAt" | "updatedAt">
): Promise<void> {
  await db.query(
    `insert into tron_address_usdt_index_pages (
       address, coverage_mode, target_timestamp_ms, window_start_timestamp_ms, window_end_timestamp_ms, start_offset, limit_count,
       status, transfer_count, provider, total_reported, range_total, raw_response_hash, canonical_transfer_hash, attempt_count, error,
       newest_transfer_at, oldest_transfer_at
     )
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     on conflict (address, token_contract, coverage_mode, target_timestamp_ms, window_start_timestamp_ms, window_end_timestamp_ms, start_offset) do update set
       limit_count = excluded.limit_count,
       status = excluded.status,
       transfer_count = excluded.transfer_count,
       provider = excluded.provider,
       total_reported = excluded.total_reported,
       range_total = excluded.range_total,
       raw_response_hash = excluded.raw_response_hash,
       canonical_transfer_hash = excluded.canonical_transfer_hash,
       attempt_count = excluded.attempt_count,
       error = excluded.error,
       newest_transfer_at = excluded.newest_transfer_at,
       oldest_transfer_at = excluded.oldest_transfer_at,
       updated_at = now()`,
    [
      input.address,
      input.coverageMode,
      input.targetTimestampMs,
      input.windowStartTimestampMs,
      input.windowEndTimestampMs,
      input.startOffset,
      input.limitCount,
      input.status,
      input.transferCount,
      input.provider,
      input.totalReported,
      input.rangeTotal,
      input.rawResponseHash,
      input.canonicalTransferHash,
      input.attemptCount,
      input.error,
      input.newestTransferAt,
      input.oldestTransferAt
    ]
  );
}
```

Add page listing:

```ts
export async function listTronAddressUsdtIndexPages(
  db: Db,
  input: {
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestampMs?: number;
    limit?: number;
  }
): Promise<TronAddressUsdtIndexPage[]> {
  const result = await db.query(
    `select address, token_contract, coverage_mode, target_timestamp_ms,
       window_start_timestamp_ms, window_end_timestamp_ms, start_offset,
       limit_count, status, transfer_count, provider, total_reported, range_total, raw_response_hash, canonical_transfer_hash, attempt_count,
       error, newest_transfer_at, oldest_transfer_at, created_at, updated_at
     from tron_address_usdt_index_pages
     where address = $1
       and coverage_mode = $2
       and target_timestamp_ms = $3
     order by window_start_timestamp_ms asc, window_end_timestamp_ms desc, start_offset asc
     limit $4`,
    [input.address, input.coverageMode, input.targetTimestampMs ?? 0, input.limit ?? 500]
  );
  return result.rows.map(mapTronAddressUsdtIndexPageRow);
}
```

Add interval upsert/list helpers:

```ts
export async function upsertTronAddressUsdtCoverageInterval(
  db: Db,
  input: Omit<TronAddressUsdtCoverageInterval, "tokenContract">
): Promise<void> {
  await db.query(
    `insert into tron_address_usdt_coverage_intervals (
       address, coverage_mode, target_timestamp_ms, provider,
       start_timestamp, end_timestamp, status, status_reason,
       total_reported, range_total, pages_fetched, rows_fetched,
       unique_rows_inserted, cap_hit, provider_inconsistent, completed_at
     )
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     on conflict (address, token_contract, coverage_mode, target_timestamp_ms, provider, start_timestamp, end_timestamp)
     do update set
       status = excluded.status,
       status_reason = excluded.status_reason,
       total_reported = excluded.total_reported,
       range_total = excluded.range_total,
       pages_fetched = excluded.pages_fetched,
       rows_fetched = excluded.rows_fetched,
       unique_rows_inserted = excluded.unique_rows_inserted,
       cap_hit = excluded.cap_hit,
       provider_inconsistent = excluded.provider_inconsistent,
       completed_at = excluded.completed_at,
       updated_at = now()`,
    [
      input.address,
      input.coverageMode,
      input.targetTimestamp?.getTime() ?? 0,
      input.provider,
      input.startTimestamp,
      input.endTimestamp,
      input.status,
      input.statusReason,
      input.totalReported,
      input.rangeTotal,
      input.pagesFetched,
      input.rowsFetched,
      input.uniqueRowsInserted,
      input.capHit,
      input.providerInconsistent,
      input.completedAt
    ]
  );
}
```

Every `select`/`insert`/`returning` snippet above must include the new state/page fields from the migration: `coverage_kind`, `status_reason`, `provider_cap_hit`, `budget_exhausted`, `provider_inconsistent`, `total_reported`, `range_total`, `raw_response_hash`, and `canonical_transfer_hash`. This is intentional: simple `complete` is only a rollup, while intervals and page audit carry the provider evidence.

- [ ] **Step 6: Run storage tests**

Run:

```bash
npx vitest run tests/storage/repositories.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add migrations/026_tron_address_all_time_index.sql src/types.ts src/storage/repositories.ts tests/storage/repositories.test.ts
git commit -m "feat(storage): track address index coverage"
```

## Task 5: Address All-Time Indexer Core

**Files:**

- Create: `src/forensics/tronAddressAllTimeIndex.ts`
- Create: `tests/forensics/tronAddressAllTimeIndex.test.ts`

- [ ] **Step 1: Write failing coverage-window tests**

Create `tests/forensics/tronAddressAllTimeIndex.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  indexTronAddressUsdtHistory,
  normalizeTronscanTransferForAddressIndex
} from "../../src/forensics/tronAddressAllTimeIndex";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { TronAddressUsdtIndexState } from "../../src/types";

const address = "TSubject111111111111111111111111111111";

function raw(tx: string, from: string, to: string, amount: string, ts: number) {
  return {
    transaction_id: tx,
    block: 55_000_001,
    event_type: "Transfer",
    from_address: from,
    to_address: to,
    quant: amount,
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    finalResult: "SUCCESS",
    revert: false,
    riskTransaction: false,
    block_ts: ts
  };
}

describe("tron address all-time indexer", () => {
  it("normalizes raw TronScan transfers into stable transfer ids", () => {
    const transfer = normalizeTronscanTransferForAddressIndex(raw(
      "tx1",
      "TFrom1111111111111111111111111111111",
      "TTo111111111111111111111111111111111",
      "1000000",
      1_780_090_767_000
    ));

    expect(transfer).toMatchObject({
      txHash: "tx1",
      blockNumber: 55_000_001,
      blockTimestamp: new Date(1_780_090_767_000),
      fromAddress: "TFrom1111111111111111111111111111111",
      toAddress: "TTo111111111111111111111111111111111",
      amountRaw: "1000000",
      method: "transfer",
      eventType: "Transfer",
      confirmed: true
    });
    expect(Number.isInteger(transfer.eventIndex)).toBe(true);
    expect(transfer.transferId).toMatch(/^tronscan:/);
  });

  it("uses startTimestamp and endTimestamp for every provider window", async () => {
    const windows: Array<{ startTimestamp?: number; endTimestamp?: number; offset: number }> = [];
    const page = vi.fn(async (_address: string, options: { start?: number; limit?: number; startTimestamp?: number; endTimestamp?: number }) => {
      windows.push({
        startTimestamp: options.startTimestamp,
        endTimestamp: options.endTimestamp,
        offset: options.start ?? 0
      });
      return {
        provider: "tronscan" as const,
        total: 2,
        rangeTotal: 2,
        transfers: options.start === 0
          ? [raw("tx-a", "TA", address, "100", 1_780_000_000_000), raw("tx-b", "TB", address, "100", 1_770_000_000_000)]
          : []
      };
    });

    const result = await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      pageLimit: 2,
      pageBatchSize: 1,
      maxPagesPerRun: 4,
      listTransferPage: page,
      upsertTransfers: async () => undefined,
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(windows[0]).toEqual({ startTimestamp: 0, endTimestamp: 1_790_000_000_000, offset: 0 });
    expect(result.status).toBe("complete");
    expect(result.statusReason).toBe("complete_provider_windowed");
  });

  it("splits capped windows and never marks rangeTotal 10000 complete", async () => {
    const windows: Array<{ startTimestamp?: number; endTimestamp?: number }> = [];
    const page = vi.fn(async (_address: string, options: { start?: number; limit?: number; startTimestamp?: number; endTimestamp?: number }) => {
      windows.push({ startTimestamp: options.startTimestamp, endTimestamp: options.endTimestamp });
      return {
        provider: "tronscan" as const,
        total: 10_000,
        rangeTotal: 10_000,
        transfers: [raw(`dense-${windows.length}`, "TA", address, "100", options.endTimestamp ?? 1_790_000_000_000)]
      };
    });

    const result = await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      pageLimit: 50,
      pageBatchSize: 1,
      maxPagesPerRun: 8,
      maxWindowSplitDepth: 2,
      listTransferPage: page,
      upsertTransfers: async () => undefined,
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(windows.length).toBeGreaterThan(1);
    expect(result.status).toBe("partial");
    expect(result.statusReason).toBe("partial_provider_cap");
  });

  it("writes page audit and a complete coverage interval for an uncapped window", async () => {
    const pages: Array<{ rangeTotal: number | null; rawResponseHash: string | null; canonicalTransferHash: string | null }> = [];
    const intervals: Array<{ status: string; rangeTotal: number | null; rowsFetched: number }> = [];
    const page = vi.fn(async (_address: string, options: { start?: number }) => ({
      provider: "tronscan" as const,
      total: 3,
      rangeTotal: 3,
      transfers: options.start === 0
        ? [raw("tx-a", "TA", address, "100", 1_780_000_000_000), raw("tx-b", "TB", address, "100", 1_770_000_000_000)]
        : [raw("tx-c", "TC", address, "100", 1_760_000_000_000)]
    }));

    await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      pageLimit: 2,
      pageBatchSize: 1,
      maxPagesPerRun: 4,
      listTransferPage: page,
      upsertTransfers: async () => undefined,
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async (pageAudit) => {
        pages.push({
          rangeTotal: pageAudit.rangeTotal,
          rawResponseHash: pageAudit.rawResponseHash,
          canonicalTransferHash: pageAudit.canonicalTransferHash
        });
      },
      upsertCoverageInterval: async (interval) => {
        intervals.push({ status: interval.status, rangeTotal: interval.rangeTotal, rowsFetched: interval.rowsFetched });
      }
    });

    expect(pages.every((pageAudit) => pageAudit.rangeTotal === 3 && pageAudit.rawResponseHash && pageAudit.canonicalTransferHash)).toBe(true);
    expect(intervals).toEqual([{ status: "complete", rangeTotal: 3, rowsFetched: 3 }]);
  });

  it("dedupes overlap rows by transferId", async () => {
    const insertedTransferIds: string[] = [];
    const page = vi.fn(async (_address: string, options: { start?: number; startTimestamp?: number; endTimestamp?: number }) => ({
      provider: "tronscan" as const,
      total: 4,
      rangeTotal: 4,
      transfers: options.start === 0
        ? [raw("tx-a", "TA", address, "100", 1_780_000_000_000), raw("tx-b", "TB", address, "100", 1_770_000_000_000)]
        : [raw("tx-b", "TB", address, "100", 1_770_000_000_000), raw("tx-c", "TC", address, "100", 1_760_000_000_000)]
    }));

    await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      pageLimit: 2,
      pageBatchSize: 1,
      maxPagesPerRun: 4,
      listTransferPage: page,
      upsertTransfers: async (transfers) => {
        insertedTransferIds.push(...transfers.map((transfer) => transfer.transferId));
      },
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(new Set(insertedTransferIds).size).toBe(insertedTransferIds.length);
  });

  it("marks targeted backfill as targeted coverage only", async () => {
    const targetTimestamp = new Date("2026-06-14T15:05:15.000Z");
    const page = vi.fn(async () => ({
      provider: "tronscan" as const,
      total: 10_000,
      rangeTotal: 10_000,
      transfers: [raw("target-1", "TA", address, "100", targetTimestamp.getTime() - 1_000)]
    }));
    const upsertState = vi.fn(async (state) => ({
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      coverageKind: "provider_windowed" as const,
      provider: "tronscan" as const,
      totalReported: 10_000,
      fetchedTransferCount: 1,
      uniqueCounterpartyCount: 1,
      newestTransferAt: targetTimestamp,
      oldestTransferAt: targetTimestamp,
      fetchedPageCount: 1,
      plannedPageCount: null,
      currentEndTimestamp: null,
      providerCapHit: false,
      budgetExhausted: false,
      providerInconsistent: false,
      priority: 10,
      nextRunAt: targetTimestamp,
      attemptCount: 1,
      maxAttempts: 5,
      retryCount: 0,
      lastError: null,
      lastErrorClass: null,
      lastSuccessfulPageAt: targetTimestamp,
      queuedReason: "where_is_money_hop",
      requestedByJobId: "job-1",
      lockedAt: null,
      lockedUntil: null,
      heartbeatAt: null,
      lockOwner: null,
      budgetPages: null,
      budgetSeconds: null,
      completedAt: targetTimestamp,
      createdAt: targetTimestamp,
      updatedAt: targetTimestamp,
      ...state
    }));

    const result = await indexTronAddressUsdtHistory({
      address,
      coverageMode: "targeted",
      targetTimestamp,
      stopAtTimestamp: targetTimestamp,
      now: () => new Date("2026-07-02T00:00:00.000Z"),
      pageLimit: 50,
      pageBatchSize: 1,
      maxPagesPerRun: 1,
      listTransferPage: page,
      upsertTransfers: async () => undefined,
      upsertState,
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(result.coverageMode).toBe("targeted");
    expect(result.targetTimestamp).toEqual(targetTimestamp);
    expect(upsertState).toHaveBeenCalledWith(expect.objectContaining({
      coverageMode: "targeted",
      targetTimestamp
    }));
  });

  it("marks provider inconsistent when the same page canonical transfer hash changes", async () => {
    const page = vi.fn(async () => ({
      provider: "tronscan" as const,
      total: 1,
      rangeTotal: 1,
      transfers: [raw("tx-a", "TA", address, "100", 1_780_000_000_000)]
    }));

    const result = await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      initialPagesByKey: new Map([["0:1790000000000:0", { rawResponseHash: "old-raw-hash", canonicalTransferHash: "old-canonical-hash" }]]),
      pageLimit: 50,
      pageBatchSize: 1,
      maxPagesPerRun: 1,
      listTransferPage: page,
      upsertTransfers: async () => undefined,
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(result.status).toBe("partial");
    expect(result.statusReason).toBe("partial_provider_inconsistent");
  });

  it("does not mark TronGrid fallback complete without rangeTotal or equivalent coverage", async () => {
    const result = await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      pageLimit: 50,
      pageBatchSize: 1,
      maxPagesPerRun: 1,
      listTransferPage: async () => ({
        provider: "trongrid_fallback" as const,
        total: null,
        rangeTotal: null,
        transfers: []
      }),
      upsertTransfers: async () => undefined,
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(result.status).toBe("partial");
    expect(result.statusReason).toBe("partial_provider_cap");
  });
});
```

- [ ] **Step 2: Run failing indexer tests**

Run:

```bash
npx vitest run tests/forensics/tronAddressAllTimeIndex.test.ts --configLoader bundle
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement normalization and page hashing**

Create `src/forensics/tronAddressAllTimeIndex.ts` with imports and helpers:

```ts
import { createHash } from "node:crypto";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../parser/transactionParser";
import type {
  IndexedTronUsdtTransfer,
  TronAddressUsdtCoverageInterval,
  TronAddressUsdtCoverageMode,
  TronAddressUsdtIndexPage,
  TronAddressUsdtIndexProvider,
  TronAddressUsdtIndexState,
  TronAddressUsdtIndexStatus
} from "../types";
import type { TronscanTrc20TransferPage } from "../tron/tronClient";

const GENESIS_WINDOW_START_MS = 0;
const DEFAULT_MAX_PAGES_PER_RUN = 200;
const DEFAULT_MAX_WINDOW_SPLIT_DEPTH = 16;

function pageKey(startTimestampMs: number, endTimestampMs: number, startOffset: number): string {
  return `${startTimestampMs}:${endTimestampMs}:${startOffset}`;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function providerEventIndex(transfer: RawTronscanTrc20Transfer): number | null {
  return integerOrNull((transfer as RawTronscanTrc20Transfer & { event_index?: unknown }).event_index);
}

function providerLogIndex(transfer: RawTronscanTrc20Transfer): number | null {
  return integerOrNull((transfer as RawTronscanTrc20Transfer & { log_index?: unknown }).log_index);
}

function blockNumber(transfer: RawTronscanTrc20Transfer): number {
  return integerOrNull((transfer as RawTronscanTrc20Transfer & { block?: unknown }).block) ?? 0;
}

function eventType(transfer: RawTronscanTrc20Transfer): string | null {
  return stringOrNull((transfer as RawTronscanTrc20Transfer & { event_type?: unknown }).event_type);
}

function providerOrdinalInTx(transfer: RawTronscanTrc20Transfer, ordinalInTx?: number | null): number | null {
  return providerEventIndex(transfer) === null && providerLogIndex(transfer) === null
    ? ordinalInTx ?? null
    : null;
}

function stableTransferId(provider: TronAddressUsdtIndexProvider, transfer: RawTronscanTrc20Transfer, ordinalInTx?: number | null): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([
      provider,
      transfer.transaction_id,
      eventType(transfer),
      transfer.from_address,
      transfer.to_address,
      transfer.contract_address,
      transfer.quant,
      transfer.block_ts,
      blockNumber(transfer),
      providerEventIndex(transfer),
      providerLogIndex(transfer),
      providerOrdinalInTx(transfer, ordinalInTx)
    ]))
    .digest("hex");
  return `${provider}:${digest}`;
}

function stableEventIndex(provider: TronAddressUsdtIndexProvider, transfer: RawTronscanTrc20Transfer, ordinalInTx?: number | null): number {
  const explicit = providerEventIndex(transfer) ?? providerLogIndex(transfer);
  if (explicit !== null) return explicit;
  const hash = createHash("sha256")
    .update(stableTransferId(provider, transfer, ordinalInTx))
    .digest("hex")
    .slice(0, 7);
  return Number.parseInt(hash, 16);
}

function shouldIndexCanonicalUsdtTransfer(transfer: RawTronscanTrc20Transfer): boolean {
  return transfer.contract_address === TRON_USDT_CONTRACT_ADDRESS
    && eventType(transfer) === "Transfer"
    && transfer.confirmed === true
    && transfer.contractRet === "SUCCESS"
    && (transfer.finalResult === undefined || transfer.finalResult === "SUCCESS")
    && (transfer as RawTronscanTrc20Transfer & { revert?: unknown }).revert !== true;
}

export function normalizeTronscanTransferForAddressIndex(
  transfer: RawTronscanTrc20Transfer,
  provider: TronAddressUsdtIndexProvider = "tronscan",
  ordinalInTx?: number | null
): IndexedTronUsdtTransfer {
  return {
    transferId: stableTransferId(provider, transfer, ordinalInTx),
    txHash: transfer.transaction_id,
    blockNumber: blockNumber(transfer),
    blockTimestamp: new Date(transfer.block_ts),
    eventIndex: stableEventIndex(provider, transfer, ordinalInTx),
    providerRowOrdinalInTx: providerOrdinalInTx(transfer, ordinalInTx),
    fromAddress: transfer.from_address,
    toAddress: transfer.to_address,
    amountRaw: transfer.quant,
    method: transfer.trigger_info && JSON.stringify(transfer.trigger_info).includes("transferFrom")
      ? "transferFrom"
      : "transfer",
    eventType: eventType(transfer),
    callerAddress: null,
    contractRet: transfer.contractRet ?? transfer.finalResult ?? null,
    finalResult: transfer.finalResult ?? null,
    reverted: (transfer as RawTronscanTrc20Transfer & { revert?: unknown }).revert === true,
    riskTransaction: (transfer as RawTronscanTrc20Transfer & { riskTransaction?: unknown }).riskTransaction === true,
    confirmed: transfer.confirmed !== false
  };
}

function rawResponseHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
```

- [ ] **Step 4: Implement adaptive index runner**

The runner must not rely on open-ended offset paging or provider total alone as proof of completion. Use bounded coverage windows with inclusive overlap and `transfer_id` dedupe:

```text
initial all_time window = [0, now]
initial targeted window = [0, targetTimestamp]
ensureWindow(window):
  fetch page 0 with startTimestamp, endTimestamp, limit=50
  store page audit with total/rangeTotal/rawResponseHash
  if provider lacks rangeTotal/equivalent coverage:
    stop with partial_provider_cap
  if the same page key already exists with a different rawResponseHash:
    stop with partial_provider_inconsistent
  if rangeTotal >= 10000:
    split the time window and recurse until maxWindowSplitDepth/page/second budget
    if depth or budget stops the split, mark partial_provider_cap or partial_budget_exhausted
  else:
    fetch offsets 50,100,... until fetched rows >= rangeTotal
    store every page audit row with rawResponseHash
    dedupe by transfer_id before upsert
    store complete coverage interval for this exact [startTimestamp,endTimestamp]
roll up complete only when intervals cover the requested whole window
if provider returns inconsistent totals/pages for the same page key:
  mark partial_provider_inconsistent
if budget/rate/cap stops the run:
  mark partial_budget_exhausted / partial_rate_limited / partial_provider_cap
```

`complete_provider_windowed` means the provider-windowed algorithm found no older rows within the tested provider windows. It is not a claim that a local full-chain index exists.

Add deps and runner:

```ts
export type IndexTronAddressUsdtHistoryDeps = {
  address: string;
  coverageMode: TronAddressUsdtCoverageMode;
  targetTimestamp?: Date | null;
  initialState?: TronAddressUsdtIndexState | null;
  initialPagesByKey?: ReadonlyMap<string, { rawResponseHash: string | null; canonicalTransferHash: string | null }>;
  pageLimit: number;
  pageBatchSize?: number;
  maxPagesPerRun?: number;
  maxWindowSplitDepth?: number;
  now?: () => Date;
  stopAtTimestamp?: Date | null;
  requestedByJobId?: string | null;
  queuedReason?: string | null;
  listTransferPage(address: string, options: { start: number; limit: number; startTimestamp?: number; endTimestamp?: number }): Promise<TronscanTrc20TransferPage>;
  upsertTransfers(transfers: IndexedTronUsdtTransfer[]): Promise<void>;
  countIndexedCounterparties?(address: string): Promise<number>;
  upsertState(input: Partial<TronAddressUsdtIndexState> & {
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp?: Date | null;
    status: TronAddressUsdtIndexStatus;
  }): Promise<TronAddressUsdtIndexState>;
  upsertPage(input: Omit<TronAddressUsdtIndexPage, "tokenContract" | "createdAt" | "updatedAt">): Promise<void>;
  upsertCoverageInterval(input: Omit<TronAddressUsdtCoverageInterval, "tokenContract">): Promise<void>;
};

type TimeWindow = { startMs: number; endMs: number; depth: number };
type AuditedPage = {
  provider: TronAddressUsdtIndexProvider;
  total: number | null;
  rangeTotal: number | null;
  rows: IndexedTronUsdtTransfer[];
  rawResponseHash: string;
  inconsistent: boolean;
};
type WindowResult =
  | { status: "complete"; pagesFetched: number; rowsFetched: number; uniqueRowsInserted: number }
  | { status: "partial"; reason: TronAddressUsdtCoverageStatusReason; pagesFetched: number; rowsFetched: number };

async function fetchAndAuditPage(
  deps: IndexTronAddressUsdtHistoryDeps,
  window: TimeWindow,
  offset: number
): Promise<AuditedPage> {
  const result = await deps.listTransferPage(deps.address, {
    start: offset,
    limit: Math.min(50, Math.max(1, deps.pageLimit)),
    startTimestamp: window.startMs,
    endTimestamp: window.endMs
  });
  const hash = result.rawResponseHash ?? rawResponseHash(result);
  const key = pageKey(window.startMs, window.endMs, offset);
  const previous = deps.initialPagesByKey?.get(key);
  const ordinalByTx = new Map<string, number>();
  const rows = result.transfers
    .filter(shouldIndexCanonicalUsdtTransfer)
    .map((transfer) => {
      const ordinal = ordinalByTx.get(transfer.transaction_id) ?? 0;
      ordinalByTx.set(transfer.transaction_id, ordinal + 1);
      return normalizeTronscanTransferForAddressIndex(transfer, result.provider, ordinal);
    });
  const canonicalHash = result.canonicalTransferHash ?? rawResponseHash({
    total: result.total,
    rangeTotal: result.rangeTotal,
    transferIds: rows.map((transfer) => transfer.transferId).sort()
  });

  await deps.upsertPage({
    address: deps.address,
    coverageMode: deps.coverageMode,
    targetTimestampMs: deps.targetTimestamp?.getTime() ?? deps.stopAtTimestamp?.getTime() ?? 0,
    windowStartTimestampMs: window.startMs,
    windowEndTimestampMs: window.endMs,
    startOffset: offset,
    limitCount: Math.min(50, Math.max(1, deps.pageLimit)),
    status: rows.length === 0 ? "empty" : "complete",
    transferCount: rows.length,
    provider: result.provider,
    totalReported: result.total,
    rangeTotal: result.rangeTotal,
    rawResponseHash: hash,
    canonicalTransferHash: canonicalHash,
    attemptCount: 1,
    error: null,
    newestTransferAt: rows[0]?.blockTimestamp ?? null,
    oldestTransferAt: rows.at(-1)?.blockTimestamp ?? null
  });

  return {
    provider: result.provider,
    total: result.total,
    rangeTotal: result.provider === "trongrid_fallback" && result.rangeTotal === null ? null : result.rangeTotal,
    rows,
    rawResponseHash: hash,
    inconsistent: Boolean(previous?.canonicalTransferHash && previous.canonicalTransferHash !== canonicalHash)
  };
}

function rollupWindowResults(left: WindowResult, right: WindowResult): WindowResult {
  if (left.status === "partial") return left;
  if (right.status === "partial") return right;
  return {
    status: "complete",
    pagesFetched: left.pagesFetched + right.pagesFetched,
    rowsFetched: left.rowsFetched + right.rowsFetched,
    uniqueRowsInserted: left.uniqueRowsInserted + right.uniqueRowsInserted
  };
}

async function ensureWindow(deps: IndexTronAddressUsdtHistoryDeps, window: TimeWindow, budget: { pagesLeft: number }): Promise<WindowResult> {
  if (budget.pagesLeft <= 0) return { status: "partial", reason: "partial_budget_exhausted", pagesFetched: 0, rowsFetched: 0 };

  const first = await fetchAndAuditPage(deps, window, 0);
  budget.pagesLeft -= 1;
  if (first.inconsistent) return { status: "partial", reason: "partial_provider_inconsistent", pagesFetched: 1, rowsFetched: 0 };
  if (first.rangeTotal === null) return { status: "partial", reason: "partial_provider_cap", pagesFetched: 1, rowsFetched: first.rows.length };

  if (first.rangeTotal >= 10_000) {
    if (window.depth >= (deps.maxWindowSplitDepth ?? DEFAULT_MAX_WINDOW_SPLIT_DEPTH)) {
      return { status: "partial", reason: "partial_provider_cap", pagesFetched: 1, rowsFetched: first.rows.length };
    }
    const midMs = Math.floor((window.startMs + window.endMs) / 2);
    const newer = await ensureWindow(deps, { startMs: midMs, endMs: window.endMs, depth: window.depth + 1 }, budget);
    const older = await ensureWindow(deps, { startMs: window.startMs, endMs: midMs, depth: window.depth + 1 }, budget);
    return rollupWindowResults(newer, older);
  }

  const deduped = new Map(first.rows.map((transfer) => [transfer.transferId, transfer]));
  let pagesFetched = 1;
  for (let offset = deps.pageLimit; offset < first.rangeTotal; offset += deps.pageLimit) {
    if (budget.pagesLeft <= 0) return { status: "partial", reason: "partial_budget_exhausted", pagesFetched, rowsFetched: deduped.size };
    const page = await fetchAndAuditPage(deps, window, offset);
    budget.pagesLeft -= 1;
    pagesFetched += 1;
    if (page.inconsistent) return { status: "partial", reason: "partial_provider_inconsistent", pagesFetched, rowsFetched: deduped.size };
    for (const transfer of page.rows) deduped.set(transfer.transferId, transfer);
  }

  await deps.upsertTransfers([...deduped.values()]);
  await deps.upsertCoverageInterval({
    address: deps.address,
    coverageMode: deps.coverageMode,
    targetTimestamp: deps.targetTimestamp ?? null,
    provider: first.provider,
    startTimestamp: new Date(window.startMs),
    endTimestamp: new Date(window.endMs),
    status: "complete",
    statusReason: "complete_provider_windowed",
    totalReported: first.total,
    rangeTotal: first.rangeTotal,
    pagesFetched,
    rowsFetched: deduped.size,
    uniqueRowsInserted: deduped.size,
    capHit: false,
    providerInconsistent: false,
    completedAt: new Date()
  });
  return { status: "complete", pagesFetched, rowsFetched: deduped.size, uniqueRowsInserted: deduped.size };
}

export async function indexTronAddressUsdtHistory(deps: IndexTronAddressUsdtHistoryDeps): Promise<TronAddressUsdtIndexState> {
  const now = deps.now?.() ?? new Date();
  const targetTimestamp = deps.coverageMode === "targeted" ? deps.targetTimestamp ?? deps.stopAtTimestamp ?? null : null;
  const endMs = targetTimestamp?.getTime() ?? now.getTime();
  const budget = { pagesLeft: deps.maxPagesPerRun ?? DEFAULT_MAX_PAGES_PER_RUN };

  await deps.upsertState({
    address: deps.address,
    coverageMode: deps.coverageMode,
    targetTimestamp,
    status: "running",
    statusReason: null,
    requestedByJobId: deps.requestedByJobId ?? null,
    queuedReason: deps.queuedReason ?? "all_time"
  });

  const result = await ensureWindow(deps, { startMs: GENESIS_WINDOW_START_MS, endMs, depth: 0 }, budget);
  if (result.status === "partial") {
    return deps.upsertState({
      address: deps.address,
      coverageMode: deps.coverageMode,
      targetTimestamp,
      status: "partial",
      statusReason: result.reason,
      fetchedPageCount: result.pagesFetched,
      fetchedTransferCount: result.rowsFetched,
      budgetExhausted: result.reason === "partial_budget_exhausted",
      providerCapHit: result.reason === "partial_provider_cap",
      providerInconsistent: result.reason === "partial_provider_inconsistent",
      lockedAt: null,
      lockedUntil: null,
      heartbeatAt: null,
      lockOwner: null
    });
  }

  return deps.upsertState({
    address: deps.address,
    coverageMode: deps.coverageMode,
    targetTimestamp,
    status: "complete",
    statusReason: "complete_provider_windowed",
    coveredUntilTimestamp: new Date(GENESIS_WINDOW_START_MS),
    fetchedPageCount: result.pagesFetched,
    fetchedTransferCount: result.rowsFetched,
    completedAt: new Date(),
    lockedAt: null,
    lockedUntil: null,
    heartbeatAt: null,
    lockOwner: null
  });
}
```

- [ ] **Step 5: Run indexer tests**

Run:

```bash
npx vitest run tests/forensics/tronAddressAllTimeIndex.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/forensics/tronAddressAllTimeIndex.ts tests/forensics/tronAddressAllTimeIndex.test.ts
git commit -m "feat(forensics): index all-time address transfers"
```

## Task 6: Wire Indexer Into Runtime

**Files:**

- Modify: `src/index.ts`
- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `tests/forensics/deepForensicJob.test.ts`

- [ ] **Step 1: Add failing job-cycle tests**

In `tests/forensics/deepForensicJob.test.ts`, add tests that mock `runDeepAddressForensicCheck` and prove the two runtime modes:

```ts
function queuedIndexState(address: string): TronAddressUsdtIndexState {
  const now = new Date("2026-07-02T00:00:00.000Z");
  return {
    address,
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    coverageMode: "all_time",
    coverageKind: "provider_windowed",
    targetTimestamp: null,
    status: "queued",
    statusReason: null,
    provider: null,
    totalReported: null,
    fetchedTransferCount: 0,
    uniqueCounterpartyCount: 0,
    newestTransferAt: null,
    oldestTransferAt: null,
    coveredUntilTimestamp: null,
    fetchedPageCount: 0,
    plannedPageCount: null,
    currentEndTimestamp: null,
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    priority: 0,
    nextRunAt: now,
    attemptCount: 0,
    maxAttempts: 5,
    retryCount: 0,
    lastError: null,
    lastErrorClass: null,
    lastSuccessfulPageAt: null,
    queuedReason: "deep_subject",
    requestedByJobId: "job-1",
    lockedAt: null,
    lockedUntil: null,
    heartbeatAt: null,
    lockOwner: null,
    budgetPages: null,
    budgetSeconds: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

it("waits for all-time subject indexing before strict Admin DeepCheck", async () => {
  const calls: string[] = [];
  vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
    runDeepAddressForensicCheck: async () => {
      calls.push("deep");
      return emptyDeepReport();
    }
  }));
  const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");

  await runCycleWithMock({
    claimNextForensicCheckJob: async () => job(),
    completeForensicCheckJob: vi.fn(async () => true),
    recordRiskEvaluation: vi.fn(async () => undefined),
    tronClient: {
      listRelatedTrc20Transfers: async () => []
    },
    getLabelsForAddress: async () => [],
    getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address }),
    ensureAddressUsdtHistory: async (input) => {
      calls.push(`index:${input.address}:${input.coverageMode}`);
      return {
        address: input.address,
        tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        coverageMode: "all_time",
        coverageKind: "provider_windowed",
        targetTimestamp: null,
        status: "complete",
        statusReason: "complete_provider_windowed",
        provider: "tronscan",
        totalReported: null,
        fetchedTransferCount: 4,
        uniqueCounterpartyCount: 2,
        newestTransferAt: new Date("2026-07-01T00:00:00.000Z"),
        oldestTransferAt: new Date("2026-01-01T00:00:00.000Z"),
        coveredUntilTimestamp: new Date("2026-01-01T00:00:00.000Z"),
        fetchedPageCount: 1,
        plannedPageCount: null,
        currentEndTimestamp: null,
        providerCapHit: false,
        budgetExhausted: false,
        providerInconsistent: false,
        priority: 100,
        nextRunAt: new Date("2026-07-02T00:00:00.000Z"),
        attemptCount: 1,
        maxAttempts: 5,
        retryCount: 0,
        lastError: null,
        lastErrorClass: null,
        lastSuccessfulPageAt: new Date("2026-07-02T00:00:00.000Z"),
        queuedReason: "deep_subject",
        requestedByJobId: "job-1",
        lockedAt: null,
        lockedUntil: null,
        heartbeatAt: null,
        lockOwner: null,
        budgetPages: null,
        budgetSeconds: null,
        completedAt: new Date("2026-07-02T00:00:00.000Z"),
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
        updatedAt: new Date("2026-07-02T00:00:00.000Z")
      };
    }
  }, {
    pageLimit: 50,
    allTimeDeepCheckMode: "strict"
  });

  expect(calls).toEqual(["index:TSubject111111111111111111111111111111:all_time", "deep"]);
  vi.doUnmock("../../src/check/deepForensicCheck");
});

it("queues all-time subject indexing but does not wait in partial bot mode", async () => {
  const calls: string[] = [];
  vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
    runDeepAddressForensicCheck: async () => {
      calls.push("deep");
      return emptyDeepReport();
    }
  }));
  const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");

  await runCycleWithMock({
    claimNextForensicCheckJob: async () => job(),
    completeForensicCheckJob: vi.fn(async () => true),
    recordRiskEvaluation: vi.fn(async () => undefined),
    tronClient: { listRelatedTrc20Transfers: async () => [] },
    getLabelsForAddress: async () => [],
    getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address }),
    ensureAddressUsdtHistory: async () => {
      throw new Error("partial mode must not block on all-time indexing");
    },
    queueAddressUsdtHistory: async (input) => {
      calls.push(`queue:${input.address}:${input.coverageMode}`);
      return queuedIndexState(input.address);
    }
  }, {
    pageLimit: 50,
    allTimeDeepCheckMode: "partial"
  });

  expect(calls).toEqual(["queue:TSubject111111111111111111111111111111:all_time", "deep"]);
  vi.doUnmock("../../src/check/deepForensicCheck");
});
```

- [ ] **Step 2: Run failing job test**

Run:

```bash
npx vitest run tests/forensics/deepForensicJob.test.ts --configLoader bundle
```

Expected: FAIL because deps/options do not include all-time indexing.

- [ ] **Step 3: Extend job deps and options**

In `src/forensics/deepForensicJob.ts`, import `DeepCheckAllTimeMode`, `TronAddressUsdtCoverageMode`, and `TronAddressUsdtIndexState`, then extend deps:

```ts
  ensureAddressUsdtHistory?(input: {
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp?: Date | null;
    stopAtTimestamp?: Date | null;
    requestedByJobId?: string | null;
    queuedReason: string;
  }): Promise<TronAddressUsdtIndexState>;
  queueAddressUsdtHistory?(input: {
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp?: Date | null;
    requestedByJobId?: string | null;
    queuedReason: string;
  }): Promise<TronAddressUsdtIndexState>;
```

Extend options:

```ts
  allTimeDeepCheckMode?: DeepCheckAllTimeMode;
  secondLayerMaxActiveWalletsPerJob?: number;
  directHardEvidenceLiveLimit?: number;
  directHardEvidenceConcurrency?: number;
```

Before `runDeepAddressForensicCheck`, resolve mode and index state:

```ts
    const allTimeMode: DeepCheckAllTimeMode = options.allTimeDeepCheckMode ?? "partial";
    const subjectIndexState = allTimeMode === "strict" && deps.ensureAddressUsdtHistory
      ? await deps.ensureAddressUsdtHistory({
          address: job.subjectAddress,
          coverageMode: "all_time",
          requestedByJobId: job.id,
          queuedReason: "deep_subject"
        })
      : null;
    if (allTimeMode === "partial" && deps.queueAddressUsdtHistory) {
      await deps.queueAddressUsdtHistory({
        address: job.subjectAddress,
        coverageMode: "all_time",
        requestedByJobId: job.id,
        queuedReason: "deep_subject"
      });
    }
```

Pass into `runDeepAddressForensicCheck`:

```ts
      allTimeSubjectIndexState: subjectIndexState,
      allTimeMode,
      secondLayerMaxActiveWalletsPerJob: options.secondLayerMaxActiveWalletsPerJob,
      directHardEvidenceLiveLimit: options.directHardEvidenceLiveLimit,
      directHardEvidenceConcurrency: options.directHardEvidenceConcurrency,
```

Add these fields to `progressJson` completion:

```ts
          allTimeCoverage: report.coverage.allTime ?? null,
```

- [ ] **Step 4: Wire runtime deps**

In `src/index.ts`, import:

```ts
  claimQueuedTronAddressUsdtIndexStates,
  getTronAddressUsdtIndexState,
  listTronAddressUsdtIndexPages,
  queueTronAddressUsdtIndexState,
  upsertTronAddressUsdtCoverageInterval,
  upsertTronAddressUsdtIndexPage,
  upsertTronAddressUsdtIndexState,
  upsertIndexedTronUsdtTransfers,
```

and:

```ts
import { indexTronAddressUsdtHistory } from "./forensics/tronAddressAllTimeIndex";
```

Create helper near runtime setup:

```ts
async function ensureAddressUsdtHistory(input: {
  address: string;
  coverageMode: "all_time" | "targeted";
  targetTimestamp?: Date | null;
  stopAtTimestamp?: Date | null;
  requestedByJobId?: string | null;
  queuedReason: string;
}) {
  const existing = await getTronAddressUsdtIndexState(db, {
    address: input.address,
    coverageMode: input.coverageMode,
    targetTimestamp: input.targetTimestamp ?? input.stopAtTimestamp ?? null
  });
  if (existing?.status === "complete" && existing.statusReason === "complete_provider_windowed") return existing;
  const completedPages = await listTronAddressUsdtIndexPages(db, {
    address: input.address,
    coverageMode: input.coverageMode,
    targetTimestampMs: (input.targetTimestamp ?? input.stopAtTimestamp)?.getTime() ?? 0
  });
  return indexTronAddressUsdtHistory({
    address: input.address,
    coverageMode: input.coverageMode,
    targetTimestamp: input.targetTimestamp ?? input.stopAtTimestamp ?? null,
    initialState: existing,
    initialPagesByKey: new Map(completedPages
      .filter((page) => (page.status === "complete" || page.status === "empty") && page.rawResponseHash && page.canonicalTransferHash)
      .map((page) => [`${page.windowStartTimestampMs}:${page.windowEndTimestampMs}:${page.startOffset}`, {
        rawResponseHash: page.rawResponseHash,
        canonicalTransferHash: page.canonicalTransferHash
      }])),
    pageLimit: config.tronscanPageLimit,
    pageBatchSize: config.tronAddressIndexPageBatchSize,
    stopAtTimestamp: input.stopAtTimestamp ?? null,
    requestedByJobId: input.requestedByJobId ?? null,
    queuedReason: input.queuedReason,
    listTransferPage: (address, options) => tronClient.listRelatedTrc20TransferPage(address, options),
    upsertTransfers: (transfers) => upsertIndexedTronUsdtTransfers(db, transfers),
    upsertState: (state) => upsertTronAddressUsdtIndexState(db, state),
    upsertPage: (page) => upsertTronAddressUsdtIndexPage(db, page),
    upsertCoverageInterval: (interval) => upsertTronAddressUsdtCoverageInterval(db, interval)
  });
}
```

In `runForensicJobsOnce`, pass:

```ts
      ensureAddressUsdtHistory,
      queueAddressUsdtHistory: (input) => queueTronAddressUsdtIndexState(db, {
        address: input.address,
        coverageMode: input.coverageMode,
        targetTimestamp: input.targetTimestamp ?? null,
        queuedReason: input.queuedReason,
        requestedByJobId: input.requestedByJobId ?? null,
        priority: input.queuedReason === "deep_subject" ? 100 : 10,
        nextRunAt: new Date()
      }),
```

In `deepForensicRuntimeOptions`, pass the bot-safe defaults:

```ts
      allTimeDeepCheckMode: "partial",
      secondLayerMaxActiveWalletsPerJob: config.tronAddressIndexSecondLayerMaxActiveWalletsPerJob,
      directHardEvidenceLiveLimit: config.directHardEvidenceLiveLimit,
      directHardEvidenceConcurrency: config.directHardEvidenceConcurrency,
```

When Admin creates a DeepCheck job, store `allTimeDeepCheckMode: "strict"` and `secondLayerMaxActiveWalletsPerJob: config.adminSecondLayerMaxActiveWallets` in the job payload/progress JSON. When bot creates the same job, omit these fields and let runtime use `"partial"` plus the bot default of `0` second-layer active wallets. Strict means the job waits for complete all-time subject coverage before scoring. Partial means the job queues all-time indexing and uses whatever indexed/history data is already available.

- [ ] **Step 5: Run job tests**

Run:

```bash
npx vitest run tests/forensics/deepForensicJob.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/forensics/deepForensicJob.ts tests/forensics/deepForensicJob.test.ts
git commit -m "feat(forensics): wait for subject index before deep check"
```

## Task 6A: Background Address Index Worker

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/index.test.ts` or the existing runtime test file that covers job loops

- [ ] **Step 1: Write failing worker test**

Add a runtime test that seeds two queued all-time states and one targeted state, runs one worker tick, and asserts it claims only the configured limit and passes the exact coverage key into `ensureAddressUsdtHistory`:

```ts
it("claims queued address index states and indexes them by coverage key", async () => {
  const claimed = [
    queuedIndexState("TDirect111111111111111111111111111111"),
    {
      ...queuedIndexState("THop11111111111111111111111111111111"),
      coverageMode: "targeted" as const,
      targetTimestamp: new Date("2026-06-14T15:05:15.000Z")
    }
  ];
  const ensured: string[] = [];

  await runAddressIndexWorkerOnce({
    claimQueuedTronAddressUsdtIndexStates: async () => claimed,
    ensureAddressUsdtHistory: async (input) => {
      ensured.push(`${input.address}:${input.coverageMode}:${input.targetTimestamp?.getTime() ?? 0}`);
      return { ...claimed[0], address: input.address, coverageMode: input.coverageMode, targetTimestamp: input.targetTimestamp ?? null, status: "complete" };
    },
    failTronAddressUsdtIndexState: async () => undefined,
    now: () => new Date("2026-07-02T00:00:00.000Z")
  }, {
    claimLimit: 2,
    lockMs: 600_000,
    workerId: "worker-a"
  });

  expect(ensured).toEqual([
    "TDirect111111111111111111111111111111:all_time:0",
    "THop11111111111111111111111111111111:targeted:1781449515000"
  ]);
});
```

- [ ] **Step 2: Implement one worker tick**

In `src/index.ts`, keep the worker boring: one function claims states, runs the existing `ensureAddressUsdtHistory`, and marks failure through the repository if indexing throws.

```ts
function classifyAddressIndexError(error: unknown): "rate_limited" | "provider_error" | "provider_inconsistent" | "terminal" {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b(429|rate limit|too many requests|403)\b/i.test(message)) return "rate_limited";
  if (/inconsistent/i.test(message)) return "provider_inconsistent";
  return "provider_error";
}

export async function runAddressIndexWorkerOnce(
  deps: {
    claimQueuedTronAddressUsdtIndexStates(input: {
      limit: number;
      lockOwner: string;
      lockMs: number;
    }): Promise<TronAddressUsdtIndexState[]>;
    ensureAddressUsdtHistory(input: {
      address: string;
      coverageMode: TronAddressUsdtCoverageMode;
      targetTimestamp?: Date | null;
      requestedByJobId?: string | null;
      queuedReason: string;
    }): Promise<TronAddressUsdtIndexState>;
    failTronAddressUsdtIndexState(input: {
      address: string;
      coverageMode: TronAddressUsdtCoverageMode;
      targetTimestamp?: Date | null;
      error: string;
      errorClass: "rate_limited" | "provider_error" | "provider_inconsistent" | "terminal";
    }): Promise<void>;
    now(): Date;
  },
  options: { claimLimit: number; lockMs: number; workerId: string }
): Promise<void> {
  const states = await deps.claimQueuedTronAddressUsdtIndexStates({
    limit: options.claimLimit,
    lockOwner: options.workerId,
    lockMs: options.lockMs
  });

  await Promise.all(states.map(async (state) => {
    try {
      await deps.ensureAddressUsdtHistory({
        address: state.address,
        coverageMode: state.coverageMode,
        targetTimestamp: state.targetTimestamp,
        requestedByJobId: state.requestedByJobId,
        queuedReason: state.queuedReason ?? "background_index"
      });
    } catch (error) {
      await deps.failTronAddressUsdtIndexState({
        address: state.address,
        coverageMode: state.coverageMode,
        targetTimestamp: state.targetTimestamp,
        error: error instanceof Error ? error.message : String(error),
        errorClass: classifyAddressIndexError(error)
      });
    }
  }));
}
```

- [ ] **Step 3: Start polling loop**

When the app starts, start a small loop controlled by config:

```ts
void (async function addressIndexWorkerLoop() {
  for (;;) {
    await runAddressIndexWorkerOnce(addressIndexWorkerDeps, {
      claimLimit: config.tronAddressIndexClaimLimit,
      lockMs: config.tronAddressIndexLockMs,
      workerId: process.env.HOSTNAME ?? `pid-${process.pid}`
    });
    await sleep(config.tronAddressIndexPollIntervalMs);
  }
})();
```

Use the existing shutdown pattern if the app already has one. Do not create a new queue system for MVP.

- [ ] **Step 4: Run runtime tests**

Run:

```bash
npx vitest run tests/index.test.ts --configLoader bundle
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat(forensics): index queued addresses in background"
```

## Task 7: DeepCheck All-Time Direct Boundary

**Files:**

- Create: `src/forensics/directHardEvidence.ts`
- Create: `tests/forensics/directHardEvidence.test.ts`
- Modify: `src/check/deepForensicCheck.ts`
- Modify: `tests/check/deepForensicCheck.test.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing direct-boundary test**

In `tests/check/deepForensicCheck.test.ts`, add this helper near the existing `usdtRestriction` helper:

```ts
function completeIndexState(address: string, fetchedTransferCount: number, uniqueCounterpartyCount: number) {
  return {
    address,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    coverageMode: "all_time" as const,
    coverageKind: "provider_windowed" as const,
    targetTimestamp: null,
    status: "complete" as const,
    statusReason: "complete_provider_windowed" as const,
    provider: "tronscan" as const,
    totalReported: null,
    fetchedTransferCount,
    uniqueCounterpartyCount,
    newestTransferAt: new Date("2026-07-01T00:00:00.000Z"),
    oldestTransferAt: new Date("2026-01-01T00:00:00.000Z"),
    coveredUntilTimestamp: new Date("2026-01-01T00:00:00.000Z"),
    fetchedPageCount: 1,
    plannedPageCount: null,
    currentEndTimestamp: null,
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    priority: 100,
    nextRunAt: new Date("2026-07-02T00:00:00.000Z"),
    attemptCount: 1,
    maxAttempts: 5,
    retryCount: 0,
    lastError: null,
    lastErrorClass: null,
    lastSuccessfulPageAt: new Date("2026-07-02T00:00:00.000Z"),
    queuedReason: "deep_subject",
    requestedByJobId: "job-1",
    lockedAt: null,
    lockedUntil: null,
    heartbeatAt: null,
    lockOwner: null,
    budgetPages: null,
    budgetSeconds: null,
    completedAt: new Date("2026-07-02T00:00:00.000Z"),
    createdAt: new Date("2026-07-02T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z")
  };
}
```

Then add a test with 20 direct senders and `maxInboundSenders: 1`. The all-time mode must include all 20 direct counterparties:

```ts
it("uses the full all-time direct boundary instead of top incoming-sender cap", async () => {
  const subject = "TSubject111111111111111111111111111111";
  const transfers = Array.from({ length: 20 }, (_, index) => ({
    txHash: `tx-${index}`,
    blockNumber: index + 1,
    blockTimestamp: new Date(`2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
    eventIndex: index,
    fromAddress: `TSender${String(index).padStart(2, "0")}111111111111111111111`,
    toAddress: subject,
    amountRaw: String((index + 1) * 1_000_000),
    method: "transfer" as const,
    callerAddress: null,
    contractRet: "SUCCESS",
    confirmed: true
  }));

  const report = await runDeepAddressForensicCheck({
    tronClient: { listRelatedTrc20Transfers: async () => [] },
    listIndexedUsdtTransfersForAddress: async (address, options) => {
      if (address !== subject) return [];
      return transfers.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
    },
    getLabelsForAddress: async () => [],
    getAddressMetadata: async () => null,
    getContractIntelligenceProfile: async () => null,
    getUsdtRestrictionStatus: async (address) => usdtRestriction(address)
  }, {
    sourceAddress: subject,
    windowStart: new Date(0),
    windowEnd: new Date("2026-07-02T00:00:00.000Z"),
    pageLimit: 50,
    maxPagesPerAddress: 3,
    maxInboundSenders: 1,
    allTimeSubjectIndexState: completeIndexState(subject, 20, 20),
    allTimeMode: "strict",
    secondLayerMaxActiveWalletsPerJob: 25
  });

  expect(report.coverage.allTime?.subjectUniqueDirectWallets).toBe(20);
  expect(report.directCounterpartyInteractionProfiles ?? []).toHaveLength(20);
});
```

- [ ] **Step 2: Create hard-evidence helper tests**

Create `tests/forensics/directHardEvidence.test.ts`:

Hard evidence is intentionally bounded and non-recursive. Local labels, local service classification, subject interaction stats, and provider tags already present in indexed transfer rows run for every direct wallet. Live checks, including exact USDT blacklist/restriction state, run only for a ranked subset capped by `DIRECT_HARD_EVIDENCE_LIVE_LIMIT`. It must not start all-time indexing or multi-hop DeepCheck for every direct wallet.

```ts
import { describe, expect, it } from "vitest";
import { buildDirectHardEvidenceSnapshots } from "../../src/forensics/directHardEvidence";

describe("buildDirectHardEvidenceSnapshots", () => {
  it("checks every direct wallet and counts exact USDT blacklist evidence", async () => {
    const addresses = ["TA", "TB", "TC"];
    const result = await buildDirectHardEvidenceSnapshots({
      addresses,
      concurrency: 2,
      liveLimit: 3,
      getLabelsForAddress: async (address) => address === "TA" ? [{ address, label: "HTX", source: "service_admin", createdAt: new Date() }] : [],
      getClassificationForAddress: async (address) => address === "TB"
        ? { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true }
        : { category: "none", identity: null, confidence: "low", evidence: [], isBoundary: false },
      getUsdtRestrictionStatus: async (address) => ({
        subjectAddress: address,
        tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        tokenSymbol: "USDT",
        tokenStandard: "TRC20",
        decimals: 6,
        isBlacklisted: address === "TC",
        balanceRaw: null,
        checkedAt: new Date().toISOString(),
        evidenceStrength: "exact_contract_state",
        methods: { blacklist: "isBlackListed(address)" }
      })
    });

    expect(result.checkedCount).toBe(3);
    expect(result.liveCheckedCount).toBe(3);
    expect(result.status).toBe("complete");
    expect(result.snapshots.map((snapshot) => snapshot.address)).toEqual(addresses);
    expect(result.blacklistedCount).toBe(1);
    expect(result.serviceCount).toBe(2);
  });
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
npx vitest run tests/forensics/directHardEvidence.test.ts tests/check/deepForensicCheck.test.ts --configLoader bundle
```

Expected: FAIL because helper and all-time input do not exist.

- [ ] **Step 4: Implement hard-evidence helper**

Create `src/forensics/directHardEvidence.ts`:

```ts
import type { AddressLabel, ServiceClassification, StablecoinRestrictionProfile } from "../types";

export type DirectHardEvidenceSnapshot = {
  address: string;
  labels: AddressLabel[];
  classification: ServiceClassification | null;
  usdtRestriction: StablecoinRestrictionProfile | null;
  evidenceStatus: "live_checked" | "local_only";
  hasHardEvidence: boolean;
  reasons: string[];
};

export type DirectHardEvidenceResult = {
  status: "complete" | "local_only_partial" | "live_budget_exhausted";
  checkedCount: number;
  liveCheckedCount: number;
  serviceCount: number;
  blacklistedCount: number;
  snapshots: DirectHardEvidenceSnapshot[];
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function buildDirectHardEvidenceSnapshots(input: {
  addresses: string[];
  concurrency?: number;
  liveLimit?: number;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
  getUsdtRestrictionStatus?(address: string): Promise<StablecoinRestrictionProfile>;
}): Promise<DirectHardEvidenceResult> {
  const uniqueAddresses = [...new Set(input.addresses)];
  const liveLimit = Math.max(0, input.liveLimit ?? 250);
  const liveSet = new Set(uniqueAddresses.slice(0, liveLimit));
  const snapshots = await mapWithConcurrency(uniqueAddresses, input.concurrency ?? 8, async (address) => {
    const [labels, classification, usdtRestriction] = await Promise.all([
      input.getLabelsForAddress(address),
      input.getClassificationForAddress(address),
      input.getUsdtRestrictionStatus && liveSet.has(address)
        ? input.getUsdtRestrictionStatus(address).catch(() => null)
        : Promise.resolve(null)
    ]);
    const reasons = [
      ...labels.map((label) => `label:${label.label}`),
      ...(classification?.isBoundary ? [`service:${classification.identity ?? classification.category}`] : []),
      ...(usdtRestriction?.isBlacklisted ? ["usdt_blacklist"] : [])
    ];
    return {
      address,
      labels,
      classification,
      usdtRestriction,
      evidenceStatus: liveSet.has(address) ? "live_checked" : "local_only",
      hasHardEvidence: reasons.length > 0,
      reasons
    };
  });
  return {
    status: liveSet.size >= uniqueAddresses.length ? "complete" : "live_budget_exhausted",
    checkedCount: snapshots.length,
    liveCheckedCount: liveSet.size,
    serviceCount: snapshots.filter((snapshot) => snapshot.labels.length > 0 || snapshot.classification?.isBoundary).length,
    blacklistedCount: snapshots.filter((snapshot) => snapshot.usdtRestriction?.isBlacklisted).length,
    snapshots
  };
}
```

- [ ] **Step 5: Add all-time read path in DeepCheck**

In `src/check/deepForensicCheck.ts`, extend input:

```ts
  allTimeSubjectIndexState?: TronAddressUsdtIndexState | null;
  allTimeMode?: DeepCheckAllTimeMode;
  secondLayerMaxActiveWalletsPerJob?: number;
  directHardEvidenceLiveLimit?: number;
  directHardEvidenceConcurrency?: number;
```

Extend report coverage:

```ts
    allTime?: DeepCheckAllTimeCoverage;
```

Add helper:

```ts
async function fetchAllIndexedEdgesForAddress(
  deps: DeepAddressForensicDeps,
  address: string,
  maxTimestamp: Date,
  pageSize = 1000
): Promise<ForensicRouteEdge[]> {
  if (!deps.listIndexedUsdtTransfersForAddress) return [];
  const edges: ForensicRouteEdge[] = [];
  for (let offset = 0;; offset += pageSize) {
    const rows = await deps.listIndexedUsdtTransfersForAddress(address, {
      minTimestamp: new Date(0),
      maxTimestamp,
      limit: pageSize,
      offset,
      orderBy: "newest"
    });
    edges.push(...rows.map(indexedTransferToRouteEdge));
    if (rows.length < pageSize) break;
  }
  return dedupeEdges(edges);
}
```

MVP memory guard: if `input.allTimeSubjectIndexState.fetchedTransferCount > 50_000`, do not materialize every transfer edge in Node for the direct boundary. Add a repository aggregate helper instead:

```sql
select counterparty_address,
       count(*) as transfer_count,
       sum(amount_raw::numeric) as total_amount_raw,
       min(block_timestamp) as first_seen_at,
       max(block_timestamp) as last_seen_at
from <existing indexed-transfer address projection>
where address = $1
group by counterparty_address
```

Use full per-transfer rows only for selected graph detail or paginated Admin views.

At the start of `runDeepAddressForensicCheck`, choose source edges:

```ts
  const subjectAllTimeComplete = input.allTimeSubjectIndexState?.coverageMode === "all_time"
    && input.allTimeSubjectIndexState.status === "complete";
  const allTimeSubjectEdges = subjectAllTimeComplete
    ? await fetchAllIndexedEdgesForAddress(deps, input.sourceAddress, input.windowEnd)
    : [];
  const sourceTransfers = allTimeSubjectEdges.length > 0
    ? {
        edges: allTimeSubjectEdges,
        pages: input.allTimeSubjectIndexState?.fetchedPageCount ?? 0,
        missingChecks: [],
        windowEdgeCount: allTimeSubjectEdges.length,
        recentFallbackEdgeCount: 0,
        recentFallbackRequestedLimit: null
      }
    : await fetchEdgesForAddress(deps.tronClient, input, input.sourceAddress, input.maxPagesPerAddress ?? DEFAULT_MAX_PAGES_PER_ADDRESS, {
        allowRecentFallback: true
      });
```

Remove the older duplicate `const sourceTransfers = await fetchEdgesForAddress(...)` line.

Build direct addresses from all source edges:

```ts
  const allDirectCounterpartyAddresses = directCounterpartyAddresses(input.sourceAddress, sourceTransfers.edges);
```

Use `allDirectCounterpartyAddresses` for full direct profiles. Keep `topIncomingSenders` only for second-hop expansion:

```ts
  const senders = subjectAllTimeComplete
    ? allDirectCounterpartyAddresses.filter((address) =>
        sourceTransfers.edges.some((edge) => edge.fromAddress === address && edge.toAddress === input.sourceAddress)
      )
    : topIncomingSenders(input.sourceAddress, sourceTransfers.edges, input.maxInboundSenders ?? DEFAULT_MAX_INBOUND_SENDERS);
```

Import and call `buildDirectHardEvidenceSnapshots` before coverage:

```ts
  const directHardEvidence = await buildDirectHardEvidenceSnapshots({
    addresses: allDirectCounterpartyAddresses,
    concurrency: input.directHardEvidenceConcurrency ?? 8,
    liveLimit: input.directHardEvidenceLiveLimit ?? 250,
    getLabelsForAddress: deps.getLabelsForAddress,
    getClassificationForAddress: async (address) => classifications.get(address) ?? null,
    getUsdtRestrictionStatus: deps.getUsdtRestrictionStatus
  });
```

Add all-time coverage:

```ts
    allTime: input.allTimeSubjectIndexState ? {
      mode: input.allTimeMode ?? "partial",
      subjectCoverageMode: input.allTimeSubjectIndexState.coverageMode,
      subjectAllTimeComplete,
      subjectIndexStatus: input.allTimeSubjectIndexState.status,
      subjectStatusReason: input.allTimeSubjectIndexState.statusReason,
      subjectTransfersFetched: input.allTimeSubjectIndexState.fetchedTransferCount,
      subjectCoveredUntilTimestamp: input.allTimeSubjectIndexState.coveredUntilTimestamp?.toISOString() ?? null,
      subjectTargetTimestamp: input.allTimeSubjectIndexState.targetTimestamp?.toISOString() ?? null,
      subjectUniqueDirectWallets: allDirectCounterpartyAddresses.length,
      directWalletsHardEvidenceChecked: directHardEvidence.checkedCount,
      directWalletsHardEvidenceLiveChecked: directHardEvidence.liveCheckedCount,
      directHardEvidenceStatus: directHardEvidence.status,
      directWalletsQueuedForIndexing: Math.min(
        allDirectCounterpartyAddresses.length,
        input.secondLayerMaxActiveWalletsPerJob ?? 0
      ),
      secondLayerActiveBudget: input.secondLayerMaxActiveWalletsPerJob ?? 0,
      secondLayerQueued: 0,
      secondLayerComplete: 0,
      providerEffectiveRps: null,
      providerRateLimitedRequests: 0,
      providerCapHit: input.allTimeSubjectIndexState.providerCapHit,
      providerInconsistent: input.allTimeSubjectIndexState.providerInconsistent,
      suppressedServiceWallets: directHardEvidence.snapshots.filter((snapshot) => snapshot.classification?.isBoundary).length,
      suppressedHighDegreeWallets: 0
    } : undefined
```

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest run tests/forensics/directHardEvidence.test.ts tests/check/deepForensicCheck.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/forensics/directHardEvidence.ts tests/forensics/directHardEvidence.test.ts src/check/deepForensicCheck.ts tests/check/deepForensicCheck.test.ts src/types.ts
git commit -m "feat(deepcheck): use all-time direct boundary"
```

## Task 8: Ranked Second-Layer Address Indexing

**Phase:** Post-MVP. Implement after Tasks 9-12 are stable unless Admin explicitly needs ranked second-layer expansion for a case.

**Files:**

- Modify: `src/check/deepForensicCheck.ts`
- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `tests/forensics/deepForensicJob.test.ts`

- [ ] **Step 1: Write failing ranked queue test**

In `tests/forensics/deepForensicJob.test.ts`, add these helpers near `emptyDeepReport()`:

```ts
function completeIndexStateForJob(address: string, fetchedTransferCount: number, uniqueCounterpartyCount: number) {
  return {
    address,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    coverageMode: "all_time" as const,
    coverageKind: "provider_windowed" as const,
    targetTimestamp: null,
    status: "complete" as const,
    statusReason: "complete_provider_windowed" as const,
    provider: "tronscan" as const,
    totalReported: null,
    fetchedTransferCount,
    uniqueCounterpartyCount,
    newestTransferAt: new Date("2026-07-01T00:00:00.000Z"),
    oldestTransferAt: new Date("2026-01-01T00:00:00.000Z"),
    coveredUntilTimestamp: new Date("2026-01-01T00:00:00.000Z"),
    fetchedPageCount: 1,
    plannedPageCount: null,
    currentEndTimestamp: null,
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    priority: 100,
    nextRunAt: new Date("2026-07-02T00:00:00.000Z"),
    attemptCount: 1,
    maxAttempts: 5,
    retryCount: 0,
    lastError: null,
    lastErrorClass: null,
    lastSuccessfulPageAt: new Date("2026-07-02T00:00:00.000Z"),
    queuedReason: "deep_subject",
    requestedByJobId: "job-1",
    lockedAt: null,
    lockedUntil: null,
    heartbeatAt: null,
    lockOwner: null,
    budgetPages: null,
    budgetSeconds: null,
    completedAt: new Date("2026-07-02T00:00:00.000Z"),
    createdAt: new Date("2026-07-02T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z")
  };
}

function queuedIndexStateForJob(address: string) {
  return {
    ...completeIndexStateForJob(address, 0, 0),
    status: "queued" as const,
    statusReason: null,
    provider: null,
    priority: 10,
    attemptCount: 0,
    completedAt: null
  };
}
```

Then add:

```ts
it("queues ranked non-service direct wallets for second-layer indexing after all-time DeepCheck", async () => {
  const queued: string[] = [];
  const report = {
    ...emptyDeepReport(),
    allTimeDirectWalletAddresses: ["TService", "TRankedA", "TRankedB", "TLow"],
    directCounterpartyInteractionProfiles: [
      { address: "TService", totalAmountRaw: "1000000000000", isService: true, highDegree: true, score: 1000 },
      { address: "TRankedA", totalAmountRaw: "900000000", isService: false, highDegree: false, score: 90 },
      { address: "TRankedB", totalAmountRaw: "800000000", isService: false, highDegree: false, score: 80 },
      { address: "TLow", totalAmountRaw: "1", isService: false, highDegree: false, score: 1 }
    ],
    coverage: {
      ...emptyDeepReport().coverage,
      allTime: {
        mode: "strict" as const,
        subjectCoverageMode: "all_time" as const,
        subjectAllTimeComplete: true,
        subjectIndexStatus: "complete" as const,
        subjectStatusReason: "complete_provider_windowed" as const,
        subjectTransfersFetched: 3,
        subjectCoveredUntilTimestamp: "2026-01-01T00:00:00.000Z",
        subjectTargetTimestamp: null,
        subjectUniqueDirectWallets: 3,
        directWalletsHardEvidenceChecked: 3,
        directWalletsHardEvidenceLiveChecked: 3,
        directHardEvidenceStatus: "complete",
        directWalletsQueuedForIndexing: 0,
        secondLayerActiveBudget: 2,
        secondLayerQueued: 0,
        secondLayerComplete: 0,
        providerEffectiveRps: null,
        providerRateLimitedRequests: 0,
        providerCapHit: false,
        providerInconsistent: false,
        suppressedServiceWallets: 1,
        suppressedHighDegreeWallets: 1
      }
    }
  };
  vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
    runDeepAddressForensicCheck: async () => report
  }));
  const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");

  await runCycleWithMock({
    claimNextForensicCheckJob: async () => job(),
    completeForensicCheckJob: vi.fn(async () => true),
    recordRiskEvaluation: vi.fn(async () => undefined),
    tronClient: {
      listRelatedTrc20Transfers: async () => []
    },
    getLabelsForAddress: async () => [],
    getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address }),
    ensureAddressUsdtHistory: async (input) => completeIndexStateForJob(input.address, 3, 3),
    queueAddressUsdtHistory: async (input) => {
      queued.push(input.address);
      return queuedIndexStateForJob(input.address);
    }
  }, {
    pageLimit: 50,
    allTimeDeepCheckMode: "strict",
    secondLayerMaxActiveWalletsPerJob: 2
  });

  expect(queued).toEqual(["TRankedA", "TRankedB"]);
  vi.doUnmock("../../src/check/deepForensicCheck");
});
```

- [ ] **Step 2: Add direct wallet addresses to report**

In `DeepAddressForensicReport`, add:

```ts
  allTimeDirectWalletAddresses?: string[];
```

Return:

```ts
    allTimeDirectWalletAddresses: subjectAllTimeComplete ? allDirectCounterpartyAddresses : undefined,
```

- [ ] **Step 3: Queue ranked subset in job runner**

In `runSingleDeepForensicJobCycle`, after `recordRiskEvaluation` and before completing the job:

```ts
    const rankedDirectWallets = rankDirectWalletsForSecondLayer(report)
      .filter((candidate) => !candidate.isService && !candidate.highDegree)
      .map((candidate) => candidate.address);
    const queuedDirectWallets = report.allTimeDirectWalletAddresses && deps.queueAddressUsdtHistory
      ? rankedDirectWallets.slice(0, options.secondLayerMaxActiveWalletsPerJob ?? 0)
      : [];
    for (const address of queuedDirectWallets) {
      if (address === job.subjectAddress) continue;
      await deps.queueAddressUsdtHistory({
        address,
        coverageMode: "all_time",
        requestedByJobId: job.id,
        queuedReason: "deep_direct_counterparty"
      });
    }
```

Use simple MVP ranking first:

```text
known service/high-degree -> suppress
larger subject-counterparty USDT amount -> higher
recent path-critical transfer -> higher
known risky/HTX/sanctions label -> higher
unknown non-service wallet -> higher than known exchange hot wallet
```

Do not all-time index known exchange/service/high-degree wallets by default. Show them as aggregate/suppressed nodes and allow manual expand later.

Patch `report.coverage.allTime` before completion:

```ts
    if (report.coverage.allTime) {
      report.coverage.allTime.directWalletsQueuedForIndexing = queuedDirectWallets.length;
      report.coverage.allTime.secondLayerQueued = queuedDirectWallets.length;
    }
```

- [ ] **Step 4: Run job tests**

Run:

```bash
npx vitest run tests/forensics/deepForensicJob.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/check/deepForensicCheck.ts src/forensics/deepForensicJob.ts tests/forensics/deepForensicJob.test.ts
git commit -m "feat(deepcheck): queue direct wallets for indexing"
```

## Task 9: Where Is Money Targeted Backfill

**Files:**

- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `tests/forensics/deepForensicJob.test.ts`
- Modify: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Add trace-level test for stronger coverage semantics**

In `tests/check/whereIsMoneyCheck.test.ts`, add a case where `getHistoryCoverageForAddress` returns reached coverage and no prior transfer. Assert stop reason is `no_incoming_transfers_seen`, not `incoming_history_not_fetched`:

```ts
it("uses complete indexed history coverage to avoid incoming_history_not_fetched", async () => {
  const report = await runWhereIsMoneyCheck({
    getTrc20Balance: async () => "1000000",
    fetchEdgesForAddress: async () => [],
    fetchLatestEdgesForAddress: async () => [],
    getHistoryCoverageForAddress: async (address, options) => ({
      address,
      targetTimestamp: options.latestTimestamp?.toISOString() ?? new Date().toISOString(),
      fetchedTransferCount: 0,
      fetchedPageCount: 12,
      oldestFetchedTransferAt: null,
      reachedTargetHop: true,
      source: "local_index"
    }),
    getLabelsForAddress: async () => [],
    getClassificationForAddress: async () => ({ category: "none", identity: null, confidence: "low", evidence: [], isBoundary: false })
  }, {
    sourceAddress: "TSubject111111111111111111111111111111",
    seedTransfers: [{
      txHash: "seed",
      fromAddress: "TSender1111111111111111111111111111111",
      toAddress: "TSubject111111111111111111111111111111",
      amountRaw: "1000000",
      timestamp: "2026-07-01T00:00:00.000Z",
      coverageShare: 1,
      selectedReason: "covers_current_balance"
    }],
    windowStart: new Date(0),
    windowEnd: new Date("2026-07-02T00:00:00.000Z"),
    maxDepth: 3
  });

  expect(report.originPaths[0].stoppedReason).toBe("no_incoming_transfers_seen");
});
```

- [ ] **Step 2: Add job-level targeted backfill test**

In `tests/forensics/deepForensicJob.test.ts`, add:

```ts
it("runs targeted index backfill when where-is-money history coverage does not reach the hop", async () => {
  const ensured: string[] = [];
  const targetJob: ForensicCheckJob = {
    ...job(),
    kind: "where_is_money_check",
    progressJson: {
      ...job().progressJson,
      requestedAmountRaw: "1000000"
    }
  };

  await runSingleDeepForensicJobCycle({
    claimNextForensicCheckJob: async () => targetJob,
    completeForensicCheckJob: vi.fn(async () => true),
    recordRiskEvaluation: vi.fn(async () => undefined),
    tronClient: {
      listRelatedTrc20Transfers: async () => []
    },
    getLabelsForAddress: async () => [],
    getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address, balanceRaw: "1000000" }),
    ensureAddressUsdtHistory: async (input) => {
      ensured.push(`${input.address}:${input.coverageMode}`);
      return {
        ...completeIndexStateForJob(input.address, 0, 0),
        coverageMode: input.coverageMode,
        targetTimestamp: input.targetTimestamp ?? input.stopAtTimestamp ?? null
      };
    },
    listIndexedUsdtTransfersForAddress: async () => []
  }, {
    pageLimit: 50,
    recentFallbackTransferLimit: 1,
    maxEdgesPerAddress: 1
  });

  expect(ensured.some((item) => item.endsWith(":targeted"))).toBe(true);
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
npx vitest run tests/check/whereIsMoneyCheck.test.ts tests/forensics/deepForensicJob.test.ts --configLoader bundle
```

Expected: the trace-level test may PASS before implementation because it documents existing coverage semantics. The job-level targeted-backfill test must FAIL until `runWhereIsMoneyJob` calls the indexer on insufficient coverage.

- [ ] **Step 4: Retry fetch after targeted index**

In `runWhereIsMoneyJob` inside `src/forensics/deepForensicJob.ts`, change `getHistoryCoverageForAddress` so when coverage does not reach the hop and `deps.ensureAddressUsdtHistory` exists:

```ts
    const coverage = historyCoverageCache.get(cacheKey) ?? {
      address,
      targetTimestamp: maxTimestamp.toISOString(),
      fetchedTransferCount: 0,
      fetchedPageCount: 0,
      oldestFetchedTransferAt: null,
      reachedTargetHop: false,
      source: "unknown"
    };
    if (!coverage.reachedTargetHop && deps.ensureAddressUsdtHistory) {
      await deps.ensureAddressUsdtHistory({
        address,
        coverageMode: "targeted",
        targetTimestamp: fetchOptions.latestTimestamp ?? maxTimestamp,
        stopAtTimestamp: fetchOptions.latestTimestamp ?? maxTimestamp,
        requestedByJobId: job.id,
        queuedReason: "where_incoming_history"
      });
      edgeCache.delete(cacheKey);
      historyCoverageCache.delete(cacheKey);
      await fetchEdgesForAddress(address, fetchOptions);
      return historyCoverageCache.get(cacheKey) ?? coverage;
    }
    return coverage;
```

This keeps `traceMoneyOriginPath` unchanged. It only gives the trace stronger history coverage after the job runner has fetched the missing data.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run tests/check/whereIsMoneyCheck.test.ts tests/forensics/deepForensicJob.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/forensics/deepForensicJob.ts tests/forensics/deepForensicJob.test.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "feat(where): backfill incomplete incoming history"
```

## Task 10: Incoming Deposit Shared Indexed Reads

**Files:**

- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add failing no-duplicate-live-read test**

In `tests/forensics/incomingDepositJob.test.ts`, add a test around a report where `run_where_is_money` and `build_funding_bundles` inspect the same address/window:

```ts
it("reuses fetched edge cache between where-is-money and funding bundles", async () => {
  const liveReads: string[] = [];
  const report = await buildIncomingDepositReport({
    job: job(validProgressJson),
    sender: "TSender1111111111111111111111111111111",
    watchedWallet: "TWatched111111111111111111111111111111",
    depositTxHash: "deposit",
    amountRaw: "1000000000",
    timestamp: new Date("2026-07-01T00:00:00.000Z"),
    deps: stage2IncomingDeps({
      listIndexedUsdtTransfersForAddress: async () => [],
      listRelatedTrc20Transfers: async (address) => {
        liveReads.push(address);
        return [];
      }
    })
  });

  expect(report).toBeTruthy();
  expect(liveReads.filter((address) => address === "TSender1111111111111111111111111111111")).toHaveLength(1);
});
```

- [ ] **Step 2: Run failing Incoming test**

Run:

```bash
npx vitest run tests/forensics/incomingDepositJob.test.ts --configLoader bundle
```

Expected: FAIL if current code does duplicate live reads for the same sender/window.

- [ ] **Step 3: Add optional targeted index dep**

In `IncomingDepositRuntimeDeps`, add:

```ts
  ensureAddressUsdtHistory?(input: {
    address: string;
    coverageMode: "all_time" | "targeted";
    targetTimestamp?: Date | null;
    stopAtTimestamp?: Date | null;
    requestedByJobId?: string | null;
    queuedReason: string;
  }): Promise<TronAddressUsdtIndexState>;
  getAddressUsdtHistoryCoverage?(input: {
    address: string;
    coverageMode: "all_time" | "targeted";
    targetTimestamp?: Date | null;
    maxTimestamp: Date;
  }): Promise<{ complete: boolean; status: TronAddressUsdtIndexStatus | null }>;
```

MVP note: targeted coverage here means `[0, maxTimestamp]`, not the exact Incoming window `[minTimestamp, maxTimestamp]`. That can fetch more history than the visible window, so keep normal page/second budgets. Do not add a fake "window complete" status until storage has a requirement key for `window`.

In `fetchEdgesForAddress`, keep the existing `edgeCache` check at the top and replace the indexed/live read order with this coverage-aware structure:

```ts
    const targetTimestamp = maxTimestamp;
    const coverageBefore = input.deps.getAddressUsdtHistoryCoverage
      ? await input.deps.getAddressUsdtHistoryCoverage({
          address,
          coverageMode: "targeted",
          targetTimestamp,
          maxTimestamp
        })
      : { complete: false, status: null };

    let indexedTransfers = await measureReportStage("fetch_window_indexed_edges", () =>
      readTransfersOrEmpty("indexed", "window", address, () =>
        input.deps.listIndexedUsdtTransfersForAddress(address, {
          minTimestamp,
          maxTimestamp,
          limit: RUNTIME_TRANSFER_LIMIT,
          orderBy: "newest",
          direction: "both"
        })
      )
    );

    if (!coverageBefore.complete && input.deps.ensureAddressUsdtHistory) {
      await input.deps.ensureAddressUsdtHistory({
        address,
        coverageMode: "targeted",
        targetTimestamp,
        stopAtTimestamp: targetTimestamp,
        requestedByJobId: input.job.id,
        queuedReason: "incoming_deposit_until_timestamp"
      });
      indexedTransfers = await measureReportStage("fetch_window_indexed_edges_after_backfill", () =>
        readTransfersOrEmpty("indexed", "window", address, () =>
          input.deps.listIndexedUsdtTransfersForAddress(address, {
            minTimestamp,
            maxTimestamp,
            limit: RUNTIME_TRANSFER_LIMIT,
            orderBy: "newest",
            direction: "both"
          })
        )
      );
    }

    const coverageAfter = input.deps.getAddressUsdtHistoryCoverage
      ? await input.deps.getAddressUsdtHistoryCoverage({
          address,
          coverageMode: "targeted",
          targetTimestamp,
          maxTimestamp
        })
      : { complete: false, status: null };

    const liveTransfers = coverageAfter.complete || indexedTransfers.length >= RUNTIME_TRANSFER_LIMIT
      ? []
      : await measureReportStage("fetch_window_live_edges", () =>
          readTransfersOrEmpty("live", "window", address, () =>
            input.deps.listRelatedTrc20Transfers(address, {
              start: 0,
              limit: RUNTIME_TRANSFER_LIMIT,
              minTimestamp: minTimestamp.getTime(),
              endTimestamp: maxTimestamp.getTime()
            })
          )
        );
```

Then keep the existing `mergeEdges(...)`, `edgeCache.set(address, edges)`, and return path. This gives both `run_where_is_money` and `build_funding_bundles` the same cached edge array for the address/window. The indexed coverage proof is broader than the visible window in MVP; Admin/report copy must call it targeted-until coverage, not exact window coverage.

- [ ] **Step 4: Wire runtime dep**

In `src/index.ts`, pass `ensureAddressUsdtHistory` into `runSingleIncomingDepositJobCycle` deps.

- [ ] **Step 5: Run Incoming tests**

Run:

```bash
npx vitest run tests/forensics/incomingDepositJob.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts src/index.ts
git commit -m "feat(incoming): reuse indexed history reads"
```

## Task 11: Admin All-Time Coverage

**Files:**

- Modify: `src/admin/forensicsGraph.ts`
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add graph projection test**

In `tests/admin/forensicsGraph.test.ts`, add:

```ts
it("projects all-time DeepCheck coverage into graph summary", () => {
  const result = projectForensicJobGraph({
    ...baseDeepJob(),
    resultJson: {
      subjectAddress: "TSubject111111111111111111111111111111",
      coverage: {
        transferEdges: 42,
        allTime: {
          mode: "strict",
          subjectCoverageMode: "all_time",
          subjectAllTimeComplete: true,
          subjectIndexStatus: "complete",
          subjectStatusReason: "complete_provider_windowed",
          subjectTransfersFetched: 4612,
          subjectCoveredUntilTimestamp: "2020-01-01T00:00:00.000Z",
          subjectTargetTimestamp: null,
          subjectUniqueDirectWallets: 138,
          directWalletsHardEvidenceChecked: 138,
          directWalletsHardEvidenceLiveChecked: 25,
          directHardEvidenceStatus: "live_budget_exhausted",
          directWalletsQueuedForIndexing: 96,
          secondLayerActiveBudget: 25,
          secondLayerQueued: 25,
          secondLayerComplete: 4,
          providerEffectiveRps: 21.5,
          providerRateLimitedRequests: 0,
          providerCapHit: false,
          providerInconsistent: false,
          suppressedServiceWallets: 4,
          suppressedHighDegreeWallets: 1
        }
      },
      coverageDebug: { missingChecks: [] },
      directCounterpartyInteractionProfiles: [],
      inboundProvenanceProfiles: [],
      counterpartyRiskProfiles: [],
      boundaryExposureProfiles: [],
      walletRoleProfiles: []
    }
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.graph.summary.layerSummary?.deepCheckCoverage).toMatchObject({
    allTimeMode: "strict",
    allTimeSubjectCoverageMode: "all_time",
    allTimeSubjectComplete: true,
    allTimeSubjectStatus: "complete",
    allTimeSubjectStatusReason: "complete_provider_windowed",
    allTimeSubjectTransfers: 4612,
    allTimeDirectWallets: 138,
    allTimeHardEvidenceChecked: 138,
    allTimeHardEvidenceLiveChecked: 25,
    allTimeDirectHardEvidenceStatus: "live_budget_exhausted"
  });
});
```

- [ ] **Step 2: Add console rendering test**

In `tests/admin/adminConsole.test.ts`, add:

```ts
it("renders all-time DeepCheck coverage lines", () => {
  const html = adminConsoleHtml();

  expect(html).toContain("All-time subject history");
  expect(html).toContain("Direct wallets found");
  expect(html).toContain("Hard evidence checked");
  expect(html).toContain("Live hard evidence checked");
  expect(html).toContain("Second layer queued");
});
```

- [ ] **Step 3: Run failing Admin tests**

Run:

```bash
npx vitest run tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts --configLoader bundle
```

Expected: FAIL because summary and UI lines do not exist.

- [ ] **Step 4: Extend graph summary**

In `src/admin/forensicsGraph.ts`, update `deepCheckCoverageSummary`:

```ts
  const allTime = recordField(coverage, "allTime");
```

If the file only has `stringField` and `numberField`, add:

```ts
function booleanField(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}
```

Return additional fields:

```ts
    allTimeSubjectStatus: stringField(allTime ?? {}, "subjectIndexStatus"),
    allTimeSubjectStatusReason: stringField(allTime ?? {}, "subjectStatusReason"),
    allTimeMode: stringField(allTime ?? {}, "mode"),
    allTimeSubjectCoverageMode: stringField(allTime ?? {}, "subjectCoverageMode"),
    allTimeSubjectComplete: booleanField(allTime ?? {}, "subjectAllTimeComplete"),
    allTimeSubjectCoveredUntil: stringField(allTime ?? {}, "subjectCoveredUntilTimestamp"),
    allTimeSubjectTargetTimestamp: stringField(allTime ?? {}, "subjectTargetTimestamp"),
    allTimeSubjectTransfers: numberField(allTime ?? {}, "subjectTransfersFetched"),
    allTimeDirectWallets: numberField(allTime ?? {}, "subjectUniqueDirectWallets"),
    allTimeHardEvidenceChecked: numberField(allTime ?? {}, "directWalletsHardEvidenceChecked"),
    allTimeHardEvidenceLiveChecked: numberField(allTime ?? {}, "directWalletsHardEvidenceLiveChecked"),
    allTimeDirectHardEvidenceStatus: stringField(allTime ?? {}, "directHardEvidenceStatus"),
    allTimeDirectWalletsQueued: numberField(allTime ?? {}, "directWalletsQueuedForIndexing"),
    allTimeSecondLayerQueued: numberField(allTime ?? {}, "secondLayerQueued"),
    allTimeSecondLayerComplete: numberField(allTime ?? {}, "secondLayerComplete"),
    providerEffectiveRps: numberField(allTime ?? {}, "providerEffectiveRps"),
    providerRateLimitedRequests: numberField(allTime ?? {}, "providerRateLimitedRequests"),
    providerCapHit: booleanField(allTime ?? {}, "providerCapHit"),
    providerInconsistent: booleanField(allTime ?? {}, "providerInconsistent"),
    suppressedServiceWallets: numberField(allTime ?? {}, "suppressedServiceWallets"),
    suppressedHighDegreeWallets: numberField(allTime ?? {}, "suppressedHighDegreeWallets"),
```

- [ ] **Step 5: Render right-rail lines**

In `src/admin/adminConsole.ts`, update `deepCheckCoverageLines(summary)`:

```js
      if (coverage.allTimeSubjectStatus) {
        lines.push("All-time subject history: " + coverage.allTimeSubjectStatus);
      }
      if (coverage.allTimeSubjectStatusReason) {
        lines.push("Coverage reason: " + coverage.allTimeSubjectStatusReason);
      }
      if (coverage.allTimeMode) {
        lines.push("Coverage mode: " + coverage.allTimeMode);
      }
      if (coverage.allTimeSubjectCoverageMode) {
        lines.push("Subject coverage: " + coverage.allTimeSubjectCoverageMode);
      }
      if (coverage.allTimeSubjectComplete !== null && coverage.allTimeSubjectComplete !== undefined) {
        lines.push("Provider-windowed subject coverage: " + (coverage.allTimeSubjectComplete ? "complete" : "partial"));
      }
      if (coverage.allTimeSubjectCoveredUntil) {
        lines.push("Covered until: " + coverage.allTimeSubjectCoveredUntil);
      }
      if (coverage.allTimeSubjectTransfers !== null && coverage.allTimeSubjectTransfers !== undefined) {
        lines.push("All-time subject transfers: " + coverage.allTimeSubjectTransfers);
      }
      if (coverage.allTimeDirectWallets !== null && coverage.allTimeDirectWallets !== undefined) {
        lines.push("Direct wallets found: " + coverage.allTimeDirectWallets);
      }
      if (coverage.allTimeHardEvidenceChecked !== null && coverage.allTimeHardEvidenceChecked !== undefined) {
        lines.push("Hard evidence checked: " + coverage.allTimeHardEvidenceChecked);
      }
      if (coverage.allTimeHardEvidenceLiveChecked !== null && coverage.allTimeHardEvidenceLiveChecked !== undefined) {
        lines.push("Live hard evidence checked: " + coverage.allTimeHardEvidenceLiveChecked);
      }
      if (coverage.allTimeDirectHardEvidenceStatus) {
        lines.push("Hard evidence status: " + coverage.allTimeDirectHardEvidenceStatus);
      }
      if (coverage.allTimeSecondLayerQueued !== null && coverage.allTimeSecondLayerQueued !== undefined) {
        lines.push("Second layer queued: " + coverage.allTimeSecondLayerQueued);
      }
      if (coverage.allTimeSecondLayerComplete !== null && coverage.allTimeSecondLayerComplete !== undefined) {
        lines.push("Second layer complete: " + coverage.allTimeSecondLayerComplete);
      }
      if (coverage.providerCapHit === true) {
        lines.push("Provider cap hit");
      }
      if (coverage.providerInconsistent === true) {
        lines.push("Provider inconsistent");
      }
      if (coverage.suppressedServiceWallets !== null && coverage.suppressedServiceWallets !== undefined) {
        lines.push("Service wallets suppressed: " + coverage.suppressedServiceWallets);
      }
```

- [ ] **Step 6: Run Admin tests**

Run:

```bash
npx vitest run tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git commit -m "feat(admin): show all-time coverage"
```

## Task 12: Runtime Verification And Regression Suite

**Files:**

- Modify: `src/runtime/deepForensicRuntimeOptions.ts`
- Modify: `tests/runtime/deepForensicRuntimeOptions.test.ts`
- Modify: `docs/superpowers/specs/2026-07-02-api-all-time-indexer-design.md`

- [ ] **Step 1: Add runtime option test**

In `tests/runtime/deepForensicRuntimeOptions.test.ts`, add:

```ts
it("returns partial all-time DeepCheck runtime options by default", () => {
  const options = deepForensicRuntimeOptions({
    tronscanPageLimit: 50,
    crossChainStage2Enabled: false,
    crossChainStage2MaxProviderCalls: 200,
    tronAddressIndexSecondLayerMaxActiveWalletsPerJob: 0,
    adminSecondLayerMaxActiveWallets: 25,
    directHardEvidenceLiveLimit: 250,
    directHardEvidenceConcurrency: 8
  }, true);

  expect(options.pageLimit).toBe(50);
  expect(options.allTimeDeepCheckMode).toBe("partial");
  expect(options.secondLayerMaxActiveWalletsPerJob).toBe(0);
  expect(options.directHardEvidenceLiveLimit).toBe(250);
  expect(options.directHardEvidenceConcurrency).toBe(8);
});
```

- [ ] **Step 2: Update runtime options**

In `src/runtime/deepForensicRuntimeOptions.ts`, include `tronAddressIndexSecondLayerMaxActiveWalletsPerJob` in the picked config type and return the bot-safe value:

```ts
    allTimeDeepCheckMode: "partial",
    secondLayerMaxActiveWalletsPerJob: config.tronAddressIndexSecondLayerMaxActiveWalletsPerJob,
    directHardEvidenceLiveLimit: config.directHardEvidenceLiveLimit,
    directHardEvidenceConcurrency: config.directHardEvidenceConcurrency,
```

Admin job creation overrides this per job with `allTimeDeepCheckMode: "strict"`. Keep the runtime default partial so bot checks do not block on a multi-thousand-transfer index build.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npx vitest run tests/runtime/deepForensicRuntimeOptions.test.ts tests/tron/tronscanScheduler.test.ts tests/forensics/tronAddressAllTimeIndex.test.ts tests/check/deepForensicCheck.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Update spec status**

In `docs/superpowers/specs/2026-07-02-api-all-time-indexer-design.md`, change:

```text
Status: Draft for user review
```

to:

```text
Status: Implementation planned
```

- [ ] **Step 7: Commit**

```bash
git add src/runtime/deepForensicRuntimeOptions.ts tests/runtime/deepForensicRuntimeOptions.test.ts docs/superpowers/specs/2026-07-02-api-all-time-indexer-design.md
git commit -m "test: verify all-time indexer runtime"
```

## Final Verification Checklist

- [ ] Run `git status --short` and confirm only intentional files are modified.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run db:migrate` against a local development database.
- [ ] Run a dry DeepCheck job for an address with more than 4,000 transfers.
- [ ] Confirm Admin coverage includes all-time subject status, transfer count, direct wallet count, hard-evidence count, and second-layer queue count.
- [ ] Confirm no code path uses CSV import, browser export, captcha solving, or cookie warming.
