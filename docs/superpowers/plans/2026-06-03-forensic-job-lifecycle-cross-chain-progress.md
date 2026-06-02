# Forensic Job Lifecycle Cross-Chain Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make forensic jobs recover from stale `running` state and show cross-chain/manual-deep progress in the admin console while the job is still running.

**Architecture:** Reuse `progress_json` as the runtime state carrier. Add small progress helpers, wire phase updates into where-is-money and incoming-deposit workers, add repository-level stale recovery, and expose a compact runtime summary through the admin API/UI. Keep graph projection limited to completed/partial jobs.

**Tech Stack:** TypeScript, PostgreSQL JSONB, Vitest, existing admin console HTML/JS, existing forensic worker loop.

---

## File Map

- Create `src/forensics/forensicJobProgress.ts`: shared phase names, progress merge helpers, runtime summary extraction, stale policy helpers.
- Modify `src/types.ts`: add a narrow `WhereIsMoneyProgressPatch` type if the implementation wants a shared public type for the core checker callback.
- Modify `src/check/whereIsMoneyCheck.ts`: accept an optional progress callback and emit Stage 2 trigger progress before provider calls.
- Modify `src/forensics/deepForensicJob.ts`: persist phase/heartbeat updates for `where_is_money_check` and `address_deep_check`.
- Modify `src/forensics/incomingDepositJob.ts`: persist phase/heartbeat updates around trace, risk recording, notification delivery, and completion.
- Modify `src/storage/repositories.ts`: add stale-running recovery query and return summary.
- Modify `src/index.ts`: call stale recovery before each forensic worker poll and pass `updateForensicCheckJobProgress` into workers.
- Modify `src/admin/adminServer.ts`: include compact runtime summary in job list responses.
- Modify `src/admin/adminConsole.ts`: render phase, cross-chain/manual-deep badges, heartbeat age, and stale-recovery hints on job cards/details.
- Test `tests/forensics/forensicJobProgress.test.ts`.
- Test `tests/storage/forensicCheckJobs.test.ts`.
- Test `tests/check/whereIsMoneyCheck.test.ts`.
- Test `tests/forensics/deepForensicJob.test.ts`.
- Test `tests/forensics/incomingDepositJob.test.ts`.
- Test `tests/admin/adminServer.test.ts`.

---

### Task 1: Shared Runtime Progress Helpers

**Files:**
- Create: `src/forensics/forensicJobProgress.ts`
- Test: `tests/forensics/forensicJobProgress.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `tests/forensics/forensicJobProgress.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  buildForensicJobRuntimeSummary,
  isIncomingDeliverySensitivePhase,
  mergeForensicJobProgress
} from "../../src/forensics/forensicJobProgress";

describe("forensic job progress helpers", () => {
  it("merges a phase update and refreshes heartbeat without removing existing fields", () => {
    const progress = mergeForensicJobProgress(
      { locale: "ru", mode: "wallet_profile" },
      {
        jobPhase: "cross_chain_stage2",
        crossChainStage2Progress: {
          enabled: true,
          manualDeepMode: true,
          status: "running",
          triggered: true,
          reason: "manual_deep_mode"
        }
      },
      new Date("2026-06-03T00:00:00.000Z")
    );

    expect(progress).toMatchObject({
      locale: "ru",
      mode: "wallet_profile",
      jobPhase: "cross_chain_stage2",
      jobHeartbeatAt: "2026-06-03T00:00:00.000Z",
      crossChainStage2Progress: {
        enabled: true,
        manualDeepMode: true,
        status: "running",
        triggered: true,
        reason: "manual_deep_mode",
        updatedAt: "2026-06-03T00:00:00.000Z"
      }
    });
  });

  it("extracts a compact admin runtime summary from progress json", () => {
    const summary = buildForensicJobRuntimeSummary({
      jobPhase: "cross_chain_stage2",
      jobHeartbeatAt: "2026-06-03T00:00:00.000Z",
      retryCount: 1,
      crossChainStage2Progress: {
        enabled: true,
        manualDeepMode: true,
        status: "running",
        triggered: true,
        reason: "manual_deep_mode",
        updatedAt: "2026-06-03T00:00:00.000Z"
      }
    });

    expect(summary).toEqual({
      phase: "cross_chain_stage2",
      heartbeatAt: "2026-06-03T00:00:00.000Z",
      retryCount: 1,
      lastRecoveredAt: null,
      staleRecoveryReason: null,
      crossChain: {
        enabled: true,
        manualDeepMode: true,
        status: "running",
        triggered: true,
        reason: "manual_deep_mode",
        selectedAmountRaw: null,
        targetAmountRaw: null,
        providerCalls: null,
        updatedAt: "2026-06-03T00:00:00.000Z"
      }
    });
  });

  it("marks delivery-sensitive incoming phases", () => {
    expect(isIncomingDeliverySensitivePhase("notification_delivery")).toBe(true);
    expect(isIncomingDeliverySensitivePhase("completing")).toBe(true);
    expect(isIncomingDeliverySensitivePhase("incoming_deposit_trace")).toBe(false);
    expect(isIncomingDeliverySensitivePhase(null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- tests/forensics/forensicJobProgress.test.ts
```

Expected: FAIL because `src/forensics/forensicJobProgress.ts` does not exist.

- [ ] **Step 3: Add the helper module**

Create `src/forensics/forensicJobProgress.ts`:

```typescript
export type ForensicJobPhase =
  | "queued"
  | "claimed"
  | "address_deep_trace"
  | "money_origin_trace"
  | "cross_chain_stage2"
  | "incoming_deposit_trace"
  | "risk_recording"
  | "notification_delivery"
  | "completing"
  | "queued_after_stale_recovery"
  | "failed_after_stale_recovery";

export type CrossChainStage2ProgressStatus =
  | "not_applicable"
  | "pending"
  | "running"
  | "skipped"
  | "partial"
  | "completed"
  | "failed";

export type CrossChainStage2Progress = {
  enabled: boolean;
  manualDeepMode: boolean;
  status: CrossChainStage2ProgressStatus;
  triggered?: boolean | null;
  reason?: string | null;
  selectedAmountRaw?: string | null;
  targetAmountRaw?: string | null;
  providerCalls?: number | null;
  updatedAt?: string | null;
};

export type ForensicJobProgressPatch = {
  jobPhase?: ForensicJobPhase;
  jobHeartbeatAt?: string;
  retryCount?: number;
  lastRecoveredAt?: string | null;
  staleRecoveryReason?: string | null;
  crossChainStage2Progress?: CrossChainStage2Progress;
};

export type ForensicJobRuntimeSummary = {
  phase: ForensicJobPhase | null;
  heartbeatAt: string | null;
  retryCount: number;
  lastRecoveredAt: string | null;
  staleRecoveryReason: string | null;
  crossChain: (CrossChainStage2Progress & {
    triggered: boolean | null;
    reason: string | null;
    selectedAmountRaw: string | null;
    targetAmountRaw: string | null;
    providerCalls: number | null;
    updatedAt: string | null;
  }) | null;
};

const phases = new Set<ForensicJobPhase>([
  "queued",
  "claimed",
  "address_deep_trace",
  "money_origin_trace",
  "cross_chain_stage2",
  "incoming_deposit_trace",
  "risk_recording",
  "notification_delivery",
  "completing",
  "queued_after_stale_recovery",
  "failed_after_stale_recovery"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanField(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

export function parseForensicJobPhase(value: unknown): ForensicJobPhase | null {
  return typeof value === "string" && phases.has(value as ForensicJobPhase)
    ? value as ForensicJobPhase
    : null;
}

export function mergeForensicJobProgress(
  base: Record<string, unknown>,
  patch: ForensicJobProgressPatch,
  now: Date = new Date()
): Record<string, unknown> {
  const heartbeat = patch.jobHeartbeatAt ?? now.toISOString();
  const crossChain = patch.crossChainStage2Progress
    ? {
        ...patch.crossChainStage2Progress,
        updatedAt: patch.crossChainStage2Progress.updatedAt ?? heartbeat
      }
    : undefined;

  return {
    ...base,
    ...patch,
    jobHeartbeatAt: heartbeat,
    ...(crossChain ? { crossChainStage2Progress: crossChain } : {})
  };
}

export function buildForensicJobRuntimeSummary(progressJson: unknown): ForensicJobRuntimeSummary {
  const progress = isRecord(progressJson) ? progressJson : {};
  const phase = parseForensicJobPhase(progress.jobPhase);
  const retryCount = Math.max(0, Math.floor(numberField(progress, "retryCount") ?? 0));
  const rawCrossChain = isRecord(progress.crossChainStage2Progress)
    ? progress.crossChainStage2Progress
    : null;
  const crossChain = rawCrossChain
    ? {
        enabled: booleanField(rawCrossChain, "enabled") ?? false,
        manualDeepMode: booleanField(rawCrossChain, "manualDeepMode") ?? false,
        status: stringField(rawCrossChain, "status") as CrossChainStage2ProgressStatus,
        triggered: booleanField(rawCrossChain, "triggered"),
        reason: stringField(rawCrossChain, "reason"),
        selectedAmountRaw: stringField(rawCrossChain, "selectedAmountRaw"),
        targetAmountRaw: stringField(rawCrossChain, "targetAmountRaw"),
        providerCalls: numberField(rawCrossChain, "providerCalls"),
        updatedAt: stringField(rawCrossChain, "updatedAt")
      }
    : null;

  return {
    phase,
    heartbeatAt: stringField(progress, "jobHeartbeatAt"),
    retryCount,
    lastRecoveredAt: stringField(progress, "lastRecoveredAt"),
    staleRecoveryReason: stringField(progress, "staleRecoveryReason"),
    crossChain
  };
}

export function isIncomingDeliverySensitivePhase(phase: ForensicJobPhase | null): boolean {
  return phase === null || phase === "notification_delivery" || phase === "completing";
}
```

- [ ] **Step 4: Run the helper test**

Run:

```bash
npm test -- tests/forensics/forensicJobProgress.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit helper module**

Run:

```bash
git add src/forensics/forensicJobProgress.ts tests/forensics/forensicJobProgress.test.ts
git commit -m "feat: add forensic job progress helpers"
```

---

### Task 2: Repository Stale-Running Recovery

**Files:**
- Modify: `src/storage/repositories.ts`
- Test: `tests/storage/forensicCheckJobs.test.ts`

- [ ] **Step 1: Write failing repository tests**

Add imports in `tests/storage/forensicCheckJobs.test.ts`:

```typescript
import { recoverStaleForensicCheckJobs } from "../../src/storage/repositories";
```

Add tests:

```typescript
it("requeues stale where-is-money and deep jobs with retry metadata", async () => {
  const { db, queries } = createMockDb([
    {
      rows: [
        {
          id: "where-stale",
          kind: "where_is_money_check",
          subject_address: "TSubject111111111111111111111111111111",
          status: "queued",
          window_start: null,
          window_end: null,
          priority: 120,
          chat_id: "42",
          message_id: null,
          requested_by: "42",
          progress_json: {
            jobPhase: "queued_after_stale_recovery",
            retryCount: 1,
            lastRecoveredAt: "2026-06-03T00:00:00.000Z"
          },
          result_json: {},
          raw_evidence_ids: [],
          observation_ids: [],
          last_error: "Recovered stale running job after 1800000ms.",
          created_at: new Date("2026-06-02T23:00:00.000Z"),
          updated_at: new Date("2026-06-03T00:00:00.000Z"),
          started_at: null,
          completed_at: null
        }
      ]
    },
    { rows: [] }
  ]);

  const result = await recoverStaleForensicCheckJobs(db, {
    now: new Date("2026-06-03T00:00:00.000Z"),
    staleAfterMs: 30 * 60 * 1000,
    maxRetries: 2
  });

  expect(result.requeued.map((job) => job.id)).toEqual(["where-stale"]);
  expect(result.failed).toEqual([]);
  expect(queries[0].sql).toContain("kind in ('where_is_money_check', 'address_deep_check')");
  expect(queries[0].params).toEqual([
    new Date("2026-06-02T23:30:00.000Z"),
    "2026-06-03T00:00:00.000Z",
    2,
    "Recovered stale running job after 1800000ms."
  ]);
});

it("fails delivery-sensitive incoming stale jobs instead of requeueing them", async () => {
  const { db, queries } = createMockDb([
    { rows: [] },
    { rows: [] },
    {
      rows: [
        {
          id: "incoming-stale",
          kind: "incoming_deposit_check",
          subject_address: "TSender111111111111111111111111111111",
          status: "failed",
          window_start: null,
          window_end: null,
          priority: 140,
          chat_id: "42",
          message_id: null,
          requested_by: "42",
          progress_json: {
            jobPhase: "failed_after_stale_recovery",
            retryCount: 0,
            staleRecoveryReason: "Incoming deposit job became stale in delivery-sensitive phase."
          },
          result_json: {},
          raw_evidence_ids: [],
          observation_ids: [],
          last_error: "Incoming deposit job became stale in delivery-sensitive phase.",
          created_at: new Date("2026-06-02T23:00:00.000Z"),
          updated_at: new Date("2026-06-03T00:00:00.000Z"),
          started_at: new Date("2026-06-02T23:00:00.000Z"),
          completed_at: new Date("2026-06-03T00:00:00.000Z")
        }
      ]
    }
  ]);

  const result = await recoverStaleForensicCheckJobs(db, {
    now: new Date("2026-06-03T00:00:00.000Z"),
    staleAfterMs: 30 * 60 * 1000,
    maxRetries: 2
  });

  expect(result.requeued).toEqual([]);
  expect(result.failed.map((job) => job.id)).toEqual(["incoming-stale"]);
  expect(queries[2].sql).toContain("incoming_deposit_check");
  expect(queries[2].sql).toContain("failed_after_stale_recovery");
});

it("requeues pre-delivery incoming stale jobs once", async () => {
  const { db, queries } = createMockDb([
    { rows: [] },
    {
      rows: [
        {
          id: "incoming-predelivery",
          kind: "incoming_deposit_check",
          subject_address: "TSender111111111111111111111111111111",
          status: "queued",
          window_start: null,
          window_end: null,
          priority: 140,
          chat_id: "42",
          message_id: null,
          requested_by: "42",
          progress_json: {
            jobPhase: "queued_after_stale_recovery",
            retryCount: 1,
            lastRecoveredAt: "2026-06-03T00:00:00.000Z"
          },
          result_json: {},
          raw_evidence_ids: [],
          observation_ids: [],
          last_error: "Recovered stale incoming deposit job before notification delivery.",
          created_at: new Date("2026-06-02T23:00:00.000Z"),
          updated_at: new Date("2026-06-03T00:00:00.000Z"),
          started_at: null,
          completed_at: null
        }
      ]
    },
    { rows: [] }
  ]);

  const result = await recoverStaleForensicCheckJobs(db, {
    now: new Date("2026-06-03T00:00:00.000Z"),
    staleAfterMs: 30 * 60 * 1000,
    maxRetries: 2
  });

  expect(result.requeued.map((job) => job.id)).toEqual(["incoming-predelivery"]);
  expect(result.failed).toEqual([]);
  expect(queries[1].sql).toContain("progress_json->>'jobPhase' in ('incoming_deposit_trace', 'risk_recording')");
});
```

- [ ] **Step 2: Run repository tests to verify failure**

Run:

```bash
npm test -- tests/storage/forensicCheckJobs.test.ts
```

Expected: FAIL because `recoverStaleForensicCheckJobs` is not exported.

- [ ] **Step 3: Add repository types and function**

Add near the forensic job repository functions in `src/storage/repositories.ts`:

```typescript
export type RecoverStaleForensicCheckJobsInput = {
  now?: Date;
  staleAfterMs: number;
  maxRetries: number;
};

export type RecoverStaleForensicCheckJobsResult = {
  requeued: ForensicCheckJob[];
  failed: ForensicCheckJob[];
};

function staleRetryExpression(): string {
  return `case
    when coalesce(progress_json->>'retryCount', '') ~ '^[0-9]+$'
      then (progress_json->>'retryCount')::int
    else 0
  end`;
}

export async function recoverStaleForensicCheckJobs(
  db: Db,
  input: RecoverStaleForensicCheckJobsInput
): Promise<RecoverStaleForensicCheckJobsResult> {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - Math.max(1, input.staleAfterMs));
  const recoveredAt = now.toISOString();
  const requeueReason = `Recovered stale running job after ${Math.max(1, input.staleAfterMs)}ms.`;
  const incomingFailReason = "Incoming deposit job became stale in delivery-sensitive phase.";
  const retryExpr = staleRetryExpression();

  const routeRequeued = await db.query(
    `update forensic_check_jobs
     set status = 'queued',
       started_at = null,
       completed_at = null,
       last_error = $4,
       progress_json = progress_json || jsonb_build_object(
         'jobPhase', 'queued_after_stale_recovery',
         'jobHeartbeatAt', $2,
         'lastRecoveredAt', $2,
         'staleRecoveryReason', $4,
         'retryCount', ${retryExpr} + 1
       ),
       updated_at = now()
     where status = 'running'
       and kind in ('where_is_money_check', 'address_deep_check')
       and coalesce(started_at, created_at) < $1
       and coalesce(nullif(progress_json->>'jobHeartbeatAt', '')::timestamptz, started_at, created_at) < $1
       and ${retryExpr} < $3
     returning id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, message_id, requested_by, progress_json, result_json,
       raw_evidence_ids, observation_ids, last_error, created_at, updated_at,
       started_at, completed_at`,
    [cutoff, recoveredAt, input.maxRetries, requeueReason]
  );

  const incomingRequeued = await db.query(
    `update forensic_check_jobs
     set status = 'queued',
       started_at = null,
       completed_at = null,
       last_error = $4,
       progress_json = progress_json || jsonb_build_object(
         'jobPhase', 'queued_after_stale_recovery',
         'jobHeartbeatAt', $2,
         'lastRecoveredAt', $2,
         'staleRecoveryReason', $4,
         'retryCount', ${retryExpr} + 1
       ),
       updated_at = now()
     where status = 'running'
       and kind = 'incoming_deposit_check'
       and progress_json->>'jobPhase' in ('incoming_deposit_trace', 'risk_recording')
       and coalesce(started_at, created_at) < $1
       and coalesce(nullif(progress_json->>'jobHeartbeatAt', '')::timestamptz, started_at, created_at) < $1
       and ${retryExpr} < least($3, 1)
     returning id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, message_id, requested_by, progress_json, result_json,
       raw_evidence_ids, observation_ids, last_error, created_at, updated_at,
       started_at, completed_at`,
    [cutoff, recoveredAt, input.maxRetries, "Recovered stale incoming deposit job before notification delivery."]
  );

  const failed = await db.query(
    `update forensic_check_jobs
     set status = 'failed',
       completed_at = now(),
       last_error = $3,
       progress_json = progress_json || jsonb_build_object(
         'jobPhase', 'failed_after_stale_recovery',
         'jobHeartbeatAt', $2,
         'lastRecoveredAt', $2,
         'staleRecoveryReason', $3
       ),
       updated_at = now()
     where status = 'running'
       and kind = 'incoming_deposit_check'
       and coalesce(started_at, created_at) < $1
       and coalesce(nullif(progress_json->>'jobHeartbeatAt', '')::timestamptz, started_at, created_at) < $1
       and (
         progress_json->>'jobPhase' is null
         or progress_json->>'jobPhase' in ('notification_delivery', 'completing')
       )
     returning id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, message_id, requested_by, progress_json, result_json,
       raw_evidence_ids, observation_ids, last_error, created_at, updated_at,
       started_at, completed_at`,
    [cutoff, recoveredAt, incomingFailReason]
  );

  return {
    requeued: [...routeRequeued.rows, ...incomingRequeued.rows].map(mapForensicCheckJobRow),
    failed: failed.rows.map(mapForensicCheckJobRow)
  };
}
```

- [ ] **Step 4: Run repository tests**

Run:

```bash
npm test -- tests/storage/forensicCheckJobs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit repository recovery**

Run:

```bash
git add src/storage/repositories.ts tests/storage/forensicCheckJobs.test.ts
git commit -m "feat: recover stale forensic jobs"
```

---

### Task 3: Where-Is-Money Stage Progress

**Files:**
- Modify: `src/check/whereIsMoneyCheck.ts`
- Modify: `src/forensics/deepForensicJob.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`
- Test: `tests/forensics/deepForensicJob.test.ts`

- [ ] **Step 1: Write failing core progress callback test**

Add to `tests/check/whereIsMoneyCheck.test.ts` near existing Stage 2 tests:

```typescript
it("emits cross-chain Stage 2 progress before provider calls", async () => {
  const progress: Record<string, unknown>[] = [];
  const byAddress = stage2BridgeByAddress({ amountRaw: "100000000000" });

  await runWhereIsMoneyCheck({
    getTrc20Balance: async () => "100000000000",
    fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
    getLabelsForAddress: async () => [],
    getClassificationForAddress: async (address) =>
      address === crossChainBridgeTron ? service("bridge", "LayerZero/Stargate") : service("none", null),
    getFastWalletRisk: async () => lowFastRisk,
    crossChainDiscoveryProvider: createFixtureCrossChainDiscoveryProvider({ transfers: [] })
  }, {
    mode: "where_is_money",
    sourceAddress: subject,
    requestedAmountRaw: "100000000000",
    crossChainStage2Enabled: true,
    crossChainManualDeepMode: true,
    crossChainMaxProviderCalls: 1,
    onProgress: async (patch) => {
      progress.push(patch);
    }
  });

  expect(progress).toEqual(expect.arrayContaining([
    expect.objectContaining({
      jobPhase: "cross_chain_stage2",
      crossChainStage2Progress: expect.objectContaining({
        enabled: true,
        manualDeepMode: true,
        status: "running",
        triggered: true,
        reason: "manual_deep_mode"
      })
    })
  ]));
});
```

- [ ] **Step 2: Write failing job persistence test**

Add to `tests/forensics/deepForensicJob.test.ts`:

```typescript
it("persists running manual cross-chain progress for where-is-money jobs", async () => {
  const sourceJob = {
    ...job(),
    kind: "where_is_money_check" as const,
    progressJson: {
      mode: "wallet_profile",
      locale: "ru",
      crossChainManualDeepMode: true,
      fastRiskSnapshot: { score: 0, level: "LOW" }
    }
  };
  const progressUpdates: Record<string, unknown>[] = [];
  const completeForensicCheckJob = vi.fn(async () => true);
  const updateForensicCheckJobProgress = vi.fn(async (input: { progressJson: Record<string, unknown> }) => {
    progressUpdates.push(input.progressJson);
    return true;
  });

  await runSingleDeepForensicJobCycle({
    claimNextForensicCheckJob: async () => sourceJob,
    updateForensicCheckJobProgress,
    completeForensicCheckJob,
    recordRiskEvaluation: vi.fn(async () => undefined),
    upsertAddressLabelAssertion: vi.fn(async () => undefined),
    tronClient: {
      listRelatedTrc20Transfers: async () => []
    },
    getLabelsForAddress: async () => [],
    getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address, balanceRaw: "0" }),
    crossChainDiscoveryProvider: createFixtureCrossChainDiscoveryProvider({ transfers: [] })
  }, {
    crossChainStage2Enabled: true,
    crossChainMaxProviderCalls: 1,
    pageLimit: 1,
    maxPagesPerAddress: 1,
    maxExpandedIntermediates: 0,
    metadataFetchLimit: 0,
    contractProfileFetchLimit: 0,
    maxInboundSenders: 1
  });

  expect(progressUpdates).toEqual(expect.arrayContaining([
    expect.objectContaining({
      jobPhase: "money_origin_trace",
      crossChainStage2Progress: expect.objectContaining({
        enabled: true,
        manualDeepMode: true,
        status: "pending"
      })
    }),
    expect.objectContaining({
      jobPhase: "cross_chain_stage2",
      crossChainStage2Progress: expect.objectContaining({
        enabled: true,
        manualDeepMode: true,
        status: "running",
        triggered: true,
        reason: "manual_deep_mode"
      })
    })
  ]));
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts tests/forensics/deepForensicJob.test.ts
```

Expected: FAIL because `onProgress` and `updateForensicCheckJobProgress` are not wired.

- [ ] **Step 4: Add progress callback support in where-is-money core**

In `src/check/whereIsMoneyCheck.ts`, extend the input type:

```typescript
import type { ForensicJobProgressPatch } from "../forensics/forensicJobProgress";
```

Add to the input shape:

```typescript
onProgress?: (patch: ForensicJobProgressPatch) => Promise<void> | void;
```

Right after the initial selection is known, emit:

```typescript
await input.onProgress?.({
  jobPhase: "money_origin_trace",
  crossChainStage2Progress: {
    enabled: input.crossChainStage2Enabled === true,
    manualDeepMode: input.crossChainManualDeepMode === true,
    status: input.crossChainStage2Enabled === true ? "pending" : "not_applicable"
  }
});
```

Inside the existing `if (input.crossChainStage2Enabled === true)` branch, immediately after `crossChainTrigger` is computed and before `runCrossChainCorridorAnalysis`, add:

```typescript
await input.onProgress?.({
  jobPhase: crossChainTrigger.triggered ? "cross_chain_stage2" : "money_origin_trace",
  crossChainStage2Progress: {
    enabled: true,
    manualDeepMode: input.crossChainManualDeepMode === true,
    status: crossChainTrigger.triggered ? "running" : "skipped",
    triggered: crossChainTrigger.triggered,
    reason: crossChainTrigger.reason ?? crossChainTrigger.skippedReason ?? null,
    selectedAmountRaw: crossChainTrigger.selectedAmountRaw,
    targetAmountRaw: crossChainTrigger.targetAmountRaw,
    providerCalls: 0
  }
});
```

- [ ] **Step 5: Persist progress in deep forensic job runner**

In `src/forensics/deepForensicJob.ts`, import:

```typescript
import { mergeForensicJobProgress, type ForensicJobProgressPatch } from "./forensicJobProgress";
```

Extend `DeepForensicJobRunnerDeps`:

```typescript
updateForensicCheckJobProgress?(input: {
  id: string;
  progressJson: Record<string, unknown>;
  lastError?: string | null;
}): Promise<boolean>;
```

Inside `runWhereIsMoneyJob`, add:

```typescript
let currentProgress = job.progressJson;
const persistProgress = async (patch: ForensicJobProgressPatch) => {
  currentProgress = mergeForensicJobProgress(currentProgress, patch);
  await deps.updateForensicCheckJobProgress?.({
    id: job.id,
    progressJson: currentProgress,
    lastError: null
  });
};
```

Before `runWhereIsMoneyCheck`, after `crossChainStage2Enabled` is calculated, call:

```typescript
await persistProgress({
  jobPhase: "money_origin_trace",
  crossChainStage2Progress: {
    enabled: crossChainStage2Enabled,
    manualDeepMode: options.crossChainManualDeepMode === true || booleanField(job.progressJson.crossChainManualDeepMode),
    status: crossChainStage2Enabled ? "pending" : "not_applicable"
  }
});
```

Pass the callback to `runWhereIsMoneyCheck`:

```typescript
onProgress: persistProgress,
```

When completing the job, use `currentProgress` instead of `job.progressJson`:

```typescript
progressJson: {
  ...currentProgress,
  whereIsMoneyCoverage: report.coverage,
  decision: report.decision,
  riskScore: report.riskScore
}
```

For `address_deep_check`, add a progress update before `runDeepAddressForensicCheck`:

```typescript
await deps.updateForensicCheckJobProgress?.({
  id: job.id,
  progressJson: mergeForensicJobProgress(job.progressJson, { jobPhase: "address_deep_trace" }),
  lastError: null
});
```

- [ ] **Step 6: Run progress tests**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts tests/forensics/deepForensicJob.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit where-is-money progress**

Run:

```bash
git add src/check/whereIsMoneyCheck.ts src/forensics/deepForensicJob.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/deepForensicJob.test.ts
git commit -m "feat: persist where-is-money progress phases"
```

---

### Task 4: Incoming Deposit Progress And Delivery Safety

**Files:**
- Modify: `src/forensics/incomingDepositJob.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Write failing incoming progress test**

Add to `tests/forensics/incomingDepositJob.test.ts`:

```typescript
it("persists incoming deposit phases before trace and notification delivery", async () => {
  const progressUpdates: Record<string, unknown>[] = [];
  const completeForensicCheckJob = vi.fn(async () => true);
  const updateForensicCheckJobProgress = vi.fn(async (input: { progressJson: Record<string, unknown> }) => {
    progressUpdates.push(input.progressJson);
    return true;
  });

  await runSingleIncomingDepositJobCycle({
    claimNextForensicCheckJob: async () => job(validProgressJson),
    updateForensicCheckJobProgress,
    completeForensicCheckJob,
    markUserAlertSent: vi.fn(async () => true),
    markUserAlertFailed: vi.fn(async () => true),
    recordObservedTransactionRisk: vi.fn(async () => true),
    sendUserAlert: vi.fn(async () => undefined),
    formatIncomingDepositRiskAlert: () => ({ text: "alert", parseMode: "HTML" }),
    buildReport: vi.fn(async () => report())
  });

  expect(progressUpdates).toEqual(expect.arrayContaining([
    expect.objectContaining({ jobPhase: "incoming_deposit_trace" }),
    expect.objectContaining({ jobPhase: "risk_recording" }),
    expect.objectContaining({ jobPhase: "notification_delivery" }),
    expect.objectContaining({ jobPhase: "completing" })
  ]));
  expect(completeForensicCheckJob).toHaveBeenCalledWith(expect.objectContaining({
    progressJson: expect.objectContaining({ jobPhase: "completing" })
  }));
});
```

- [ ] **Step 2: Run incoming test to verify failure**

Run:

```bash
npm test -- tests/forensics/incomingDepositJob.test.ts
```

Expected: FAIL because `updateForensicCheckJobProgress` is not part of incoming job deps.

- [ ] **Step 3: Wire incoming progress persistence**

In `src/forensics/incomingDepositJob.ts`, import:

```typescript
import { mergeForensicJobProgress, type ForensicJobProgressPatch } from "./forensicJobProgress";
```

Extend `RunSingleIncomingDepositJobCycleDeps`:

```typescript
updateForensicCheckJobProgress?(input: {
  id: string;
  progressJson: Record<string, unknown>;
  lastError?: string | null;
}): Promise<boolean>;
```

Inside `runSingleIncomingDepositJobCycle`, after required progress fields are validated, add:

```typescript
let currentProgress = job.progressJson;
const persistProgress = async (patch: ForensicJobProgressPatch) => {
  currentProgress = mergeForensicJobProgress(currentProgress, patch);
  await deps.updateForensicCheckJobProgress?.({
    id: job.id,
    progressJson: currentProgress,
    lastError: null
  });
};
```

Before `deps.buildReport`, call:

```typescript
await persistProgress({ jobPhase: "incoming_deposit_trace" });
```

Before `recordObservedTransactionRisk`, call:

```typescript
await persistProgress({ jobPhase: "risk_recording" });
```

Immediately before `sendUserAlert`, call:

```typescript
await persistProgress({ jobPhase: "notification_delivery" });
```

Immediately before `completeForensicCheckJob`, call:

```typescript
await persistProgress({ jobPhase: "completing" });
```

Use `currentProgress` in completion and failure payloads after validation:

```typescript
progressJson: currentProgress,
```

- [ ] **Step 4: Run incoming tests**

Run:

```bash
npm test -- tests/forensics/incomingDepositJob.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit incoming progress**

Run:

```bash
git add src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "feat: track incoming deposit job phases"
```

---

### Task 5: Runtime Recovery Wiring

**Files:**
- Modify: `src/index.ts`
- Modify: `src/config.ts`
- Test: `tests/config/config.test.ts`

- [ ] **Step 1: Write failing config tests**

Add to `tests/config/config.test.ts`:

```typescript
it("uses forensic stale recovery defaults", () => {
  setRequiredEnv();
  const config = loadConfig();

  expect(config.forensicJobStaleAfterMs).toBe(30 * 60 * 1000);
  expect(config.forensicJobMaxRetries).toBe(2);
});

it("parses forensic stale recovery overrides", () => {
  setRequiredEnv({
    FORENSIC_JOB_STALE_AFTER_MS: "600000",
    FORENSIC_JOB_MAX_RETRIES: "1"
  });
  const config = loadConfig();

  expect(config.forensicJobStaleAfterMs).toBe(600000);
  expect(config.forensicJobMaxRetries).toBe(1);
});
```

- [ ] **Step 2: Run config tests to verify failure**

Run:

```bash
npm test -- tests/config/config.test.ts
```

Expected: FAIL because the config fields do not exist.

- [ ] **Step 3: Add config fields**

In `src/config.ts`, add to the config type:

```typescript
forensicJobStaleAfterMs: number;
forensicJobMaxRetries: number;
```

In config loading, add:

```typescript
forensicJobStaleAfterMs: parsePositiveInteger(
  "FORENSIC_JOB_STALE_AFTER_MS",
  process.env.FORENSIC_JOB_STALE_AFTER_MS,
  30 * 60 * 1000
),
forensicJobMaxRetries: parsePositiveInteger(
  "FORENSIC_JOB_MAX_RETRIES",
  process.env.FORENSIC_JOB_MAX_RETRIES,
  2
),
```

- [ ] **Step 4: Wire recovery and progress deps in runtime**

In `src/index.ts`, import:

```typescript
import { recoverStaleForensicCheckJobs, updateForensicCheckJobProgress } from "./storage/repositories";
```

Add a helper:

```typescript
async function recoverStaleForensicJobsOnce(): Promise<void> {
  const result = await recoverStaleForensicCheckJobs(db, {
    staleAfterMs: config.forensicJobStaleAfterMs,
    maxRetries: config.forensicJobMaxRetries
  });
  for (const job of result.requeued) {
    logger.warn("forensic_job_stale_requeued", {
      job_id: job.id,
      kind: job.kind,
      subject_address: job.subjectAddress,
      retry_count: job.progressJson.retryCount
    });
  }
  for (const job of result.failed) {
    logger.warn("forensic_job_stale_failed", {
      job_id: job.id,
      kind: job.kind,
      subject_address: job.subjectAddress,
      retry_count: job.progressJson.retryCount
    });
  }
}
```

At the start of `runForensicJobsOnce`, before `runForensicJobBatch`, call:

```typescript
await recoverStaleForensicJobsOnce();
```

At the start of `incomingDepositOnce`, before `runForensicJobBatch`, call:

```typescript
await recoverStaleForensicJobsOnce();
```

Pass progress updates into deep and incoming cycles:

```typescript
updateForensicCheckJobProgress: (input) => updateForensicCheckJobProgress(db, input),
```

- [ ] **Step 5: Run config and worker tests**

Run:

```bash
npm test -- tests/config/config.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit runtime wiring**

Run:

```bash
git add src/config.ts src/index.ts tests/config/config.test.ts
git commit -m "feat: wire stale forensic job recovery"
```

---

### Task 6: Admin Runtime Status

**Files:**
- Modify: `src/admin/adminServer.ts`
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Write failing admin API test**

Add to `tests/admin/adminServer.test.ts`:

```typescript
it("includes forensic runtime progress in job list summaries", async () => {
  const fixture = job({
    status: "running",
    progressJson: {
      jobPhase: "cross_chain_stage2",
      jobHeartbeatAt: "2026-06-03T00:00:00.000Z",
      retryCount: 1,
      crossChainStage2Progress: {
        enabled: true,
        manualDeepMode: true,
        status: "running",
        triggered: true,
        reason: "manual_deep_mode",
        updatedAt: "2026-06-03T00:00:00.000Z"
      }
    }
  });
  const server = await start({
    ...deps(),
    listJobs: async () => [fixture],
    getJob: async (id: string) => id === fixture.id ? fixture : null
  });

  const response = await fetch(`${server.url}/admin/api/forensic-jobs`, {
    headers: { Authorization: "Bearer secret-token" }
  });
  const body = await response.json();

  expect(body.jobs[0].runtime).toEqual({
    phase: "cross_chain_stage2",
    heartbeatAt: "2026-06-03T00:00:00.000Z",
    retryCount: 1,
    lastRecoveredAt: null,
    staleRecoveryReason: null,
    crossChain: {
      enabled: true,
      manualDeepMode: true,
      status: "running",
      triggered: true,
      reason: "manual_deep_mode",
      selectedAmountRaw: null,
      targetAmountRaw: null,
      providerCalls: null,
      updatedAt: "2026-06-03T00:00:00.000Z"
    }
  });
});
```

- [ ] **Step 2: Add an admin console shell assertion**

Add to the existing `serves admin console shell without exposing job data` test in `tests/admin/adminServer.test.ts`:

```typescript
expect(html).toContain("function runtimeBadges");
expect(html).toContain("manual deep");
expect(html).toContain("cross-chain");
```

- [ ] **Step 3: Run admin test to verify failure**

Run:

```bash
npm test -- tests/admin/adminServer.test.ts
```

Expected: FAIL because job summaries do not include `runtime` and the console script does not define `runtimeBadges`.

- [ ] **Step 4: Add runtime summary to admin API**

In `src/admin/adminServer.ts`, import:

```typescript
import { buildForensicJobRuntimeSummary, type ForensicJobRuntimeSummary } from "../forensics/forensicJobProgress";
```

Extend `AdminForensicJobSummary` with:

```typescript
type AdminForensicJobSummary = Pick<
  ForensicCheckJob,
  | "id"
  | "kind"
  | "subjectAddress"
  | "status"
  | "windowStart"
  | "windowEnd"
  | "priority"
  | "lastError"
  | "createdAt"
  | "updatedAt"
  | "startedAt"
  | "completedAt"
> & {
  runtime: ForensicJobRuntimeSummary;
};
```

In `summarizeForensicJob`, add:

```typescript
runtime: buildForensicJobRuntimeSummary(job.progressJson)
```

- [ ] **Step 5: Render runtime badges in admin console**

In `src/admin/adminConsole.ts`, add helpers near `classifyStatus`:

```javascript
function runtimeBadges(job) {
  const runtime = job.runtime || {};
  const badges = [];
  if (runtime.phase) badges.push(runtime.phase.replaceAll("_", " "));
  if (runtime.crossChain?.enabled) badges.push("cross-chain");
  if (runtime.crossChain?.manualDeepMode) badges.push("manual deep");
  if (runtime.retryCount > 0) badges.push("retry " + runtime.retryCount);
  return badges;
}

function runtimeLine(job) {
  const badges = runtimeBadges(job);
  return badges.length > 0 ? badges.join(" В· ") : "";
}
```

In `renderJobs`, inside the `state.jobs.map((job) => { ... })` body, add:

```javascript
const runtime = runtimeLine(job);
```

and render:

```javascript
(runtime ? '<span>' + escapeHtml(runtime) + '</span>' : '')
```

In `renderDetails`, when no graph is loaded but `state.activeJobId` has a selected job, render the runtime summary:

```javascript
const activeJob = state.jobs.find((job) => job.id === state.activeJobId);
if (!state.graph && activeJob?.runtime) {
  const runtime = activeJob.runtime;
  el("details").innerHTML = '<div class="metric-grid">' +
    metric("Phase", runtime.phase || "n/a") +
    metric("Heartbeat", runtime.heartbeatAt || "n/a") +
    metric("Retry", runtime.retryCount ?? 0) +
    metric("Cross-chain", runtime.crossChain?.enabled ? "yes" : "no") +
    metric("Manual deep", runtime.crossChain?.manualDeepMode ? "yes" : "no") +
    metric("Stage 2", runtime.crossChain?.status || "n/a") +
    '</div>';
  return;
}
```

Keep the existing graph-based details for completed/partial jobs.

- [ ] **Step 6: Run admin tests**

Run:

```bash
npm test -- tests/admin/adminServer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit admin runtime status**

Run:

```bash
git add src/admin/adminServer.ts src/admin/adminConsole.ts tests/admin/adminServer.test.ts
git commit -m "feat: show forensic runtime status in admin"
```

---

### Task 7: End-To-End Verification

**Files:**
- No new files.
- Verify: worker tests, admin API, local CLI/manual job behavior.

- [ ] **Step 1: Run focused forensic test suite**

Run:

```bash
npm test -- tests/forensics/forensicJobProgress.test.ts tests/storage/forensicCheckJobs.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts tests/admin/adminServer.test.ts
```

Expected: all listed test files PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Verify current stale jobs can be classified safely**

Run this read-only DB inspection:

```bash
node --import tsx - <<'NODE'
import "dotenv/config";
import { Pool } from "pg";
import { buildForensicJobRuntimeSummary } from "./src/forensics/forensicJobProgress.ts";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await pool.query(`
    select id, kind, status, subject_address, started_at, updated_at, progress_json
    from forensic_check_jobs
    where status = 'running'
    order by started_at asc nulls first, created_at asc
  `);
  console.log(JSON.stringify(result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    subjectAddress: row.subject_address,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    runtime: buildForensicJobRuntimeSummary(row.progress_json)
  })), null, 2));
} finally {
  await pool.end();
}
NODE
```

Expected: output lists stale jobs and their runtime summaries. Legacy jobs can have `phase: null`.

- [ ] **Step 4: Verify manual Stage 2 still completes as partial on provider errors**

Run:

```bash
npm run forensic:where-is-money -- -- --source TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb --days 45 --depth 20 --beam 8 --max-addresses 60 --max-edges 40 --contract-tx-info 0 --contract-tx-info-delay-ms 0 --cross-chain-stage2 --cross-chain-manual-deep --cross-chain-max-provider-calls 3
```

Expected:

- command exits with code `0`;
- output contains `Cross-chain Stage 2:`;
- output contains `triggered: yes`;
- output contains `partial: yes`;
- provider failures are shown as notes, not as a thrown process error.

- [ ] **Step 5: Verify clean working tree after verification commands**

Run:

```bash
git status --short
```

Expected: no new changes from verification commands.

---

## Self-Review Checklist

- Spec coverage: progress phases, cross-chain status, stale recovery, incoming delivery safety, admin visibility, and tests are covered.
- Placeholder scan: no task uses an unspecified implementation step without concrete code or command.
- Type consistency: `jobPhase`, `jobHeartbeatAt`, `retryCount`, `lastRecoveredAt`, `staleRecoveryReason`, and `crossChainStage2Progress` are used consistently across helpers, workers, repository, and admin UI.
- Risk check: incoming deposits are requeued only from known pre-delivery phases and are not retried after `notification_delivery` because Telegram sends are not idempotent.
- Scope check: graph projection for running jobs is intentionally out of scope.
