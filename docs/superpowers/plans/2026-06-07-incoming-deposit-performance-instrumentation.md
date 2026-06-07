# Incoming Deposit Performance Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add measured, persisted, and logged performance timing for incoming deposit checks without changing risk scoring or alert behavior.

**Architecture:** Add a small timing helper under `src/forensics`, then wire it into `runSingleIncomingDepositJobCycle` and `buildIncomingDepositReport`. Job-level timing owns queue wait, deposit age, alert delivery, and final job logging; report-level timing records major forensic stages and contributes nested stages to the same timing collector.

**Tech Stack:** TypeScript, Node `perf_hooks.performance.now`, Vitest, existing forensic job progress JSON, existing structured logger.

---

## File Structure

- Create `src/forensics/incomingDepositTiming.ts`
  - Owns timing types, a monotonic stage recorder, stage aggregation, summary building, and top-stage selection.
- Create `tests/forensics/incomingDepositTiming.test.ts`
  - Covers deterministic timing, aggregation, summary shape, and top-stage sorting.
- Modify `src/forensics/incomingDepositJob.ts`
  - Adds optional timing dependencies, job-level instrumentation, report-level stage instrumentation, progress JSON persistence, and structured timing logs.
- Modify `tests/forensics/incomingDepositJob.test.ts`
  - Covers persisted timing, timing logs, failure timing, no-job behavior, and report-level stage collection.

No database migration is required because `performanceTiming` is stored inside existing `progress_json`.

---

### Task 1: Add Incoming Deposit Timing Helper

**Files:**
- Create: `src/forensics/incomingDepositTiming.ts`
- Create: `tests/forensics/incomingDepositTiming.test.ts`

- [ ] **Step 1: Write failing timing helper tests**

Create `tests/forensics/incomingDepositTiming.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createIncomingDepositTiming } from "../../src/forensics/incomingDepositTiming";

describe("createIncomingDepositTiming", () => {
  it("records measured async stages with deterministic durations", async () => {
    let current = 10;
    const timing = createIncomingDepositTiming({
      nowMs: () => current
    });

    const result = await timing.measure("build_report", async () => {
      current = 35;
      return "ok";
    });

    expect(result).toBe("ok");
    expect(timing.summary({
      queueWaitMs: 1000,
      depositAgeAtStartMs: 2000
    })).toEqual({
      queueWaitMs: 1000,
      depositAgeAtStartMs: 2000,
      totalRunMs: 25,
      stages: [
        { name: "build_report", durationMs: 25 }
      ]
    });
  });

  it("aggregates repeated stage names", async () => {
    let current = 0;
    const timing = createIncomingDepositTiming({
      nowMs: () => current
    });

    await timing.measure("fetch_edges", async () => {
      current = 10;
    });
    await timing.measure("fetch_edges", async () => {
      current = 25;
    });

    expect(timing.summary({ queueWaitMs: null, depositAgeAtStartMs: null }).stages).toEqual([
      { name: "fetch_edges", durationMs: 25 }
    ]);
  });

  it("sorts top stages by duration descending", async () => {
    let current = 0;
    const timing = createIncomingDepositTiming({
      nowMs: () => current
    });

    await timing.measure("short", async () => {
      current = 5;
    });
    await timing.measure("long", async () => {
      current = 30;
    });
    await timing.measure("medium", async () => {
      current = 40;
    });

    expect(timing.topStages(2)).toEqual([
      { name: "long", durationMs: 25 },
      { name: "medium", durationMs: 10 }
    ]);
  });

  it("keeps thrown errors and still records the failed stage duration", async () => {
    let current = 0;
    const timing = createIncomingDepositTiming({
      nowMs: () => current
    });

    await expect(timing.measure("send_alert", async () => {
      current = 12;
      throw new Error("telegram unavailable");
    })).rejects.toThrow("telegram unavailable");

    expect(timing.summary({ queueWaitMs: null, depositAgeAtStartMs: null }).stages).toEqual([
      { name: "send_alert", durationMs: 12 }
    ]);
  });
});
```

- [ ] **Step 2: Run timing helper tests and verify they fail**

Run:

```bash
npx vitest run tests/forensics/incomingDepositTiming.test.ts
```

Expected: FAIL because `src/forensics/incomingDepositTiming.ts` does not exist.

- [ ] **Step 3: Implement timing helper**

Create `src/forensics/incomingDepositTiming.ts`:

```ts
import { performance } from "node:perf_hooks";

export type IncomingDepositTimingStage = {
  name: string;
  durationMs: number;
};

export type IncomingDepositTimingSummary = {
  queueWaitMs: number | null;
  depositAgeAtStartMs: number | null;
  totalRunMs: number;
  stages: IncomingDepositTimingStage[];
};

export type IncomingDepositTimingClock = {
  nowMs(): number;
};

export type IncomingDepositTimingSummaryInput = {
  queueWaitMs: number | null;
  depositAgeAtStartMs: number | null;
};

export type IncomingDepositTimingRecorder = {
  measure<T>(name: string, fn: () => Promise<T>): Promise<T>;
  add(name: string, durationMs: number): void;
  summary(input: IncomingDepositTimingSummaryInput): IncomingDepositTimingSummary;
  topStages(limit: number): IncomingDepositTimingStage[];
};

function normalizeDurationMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function sortedStages(stages: Map<string, number>): IncomingDepositTimingStage[] {
  return [...stages.entries()]
    .map(([name, durationMs]) => ({ name, durationMs: normalizeDurationMs(durationMs) }))
    .sort((a, b) => {
      const byDuration = b.durationMs - a.durationMs;
      if (byDuration !== 0) return byDuration;
      return a.name.localeCompare(b.name);
    });
}

export function createIncomingDepositTiming(
  clock: IncomingDepositTimingClock = { nowMs: () => performance.now() }
): IncomingDepositTimingRecorder {
  const startedAtMs = clock.nowMs();
  const stages = new Map<string, number>();

  function add(name: string, durationMs: number): void {
    const existing = stages.get(name) ?? 0;
    stages.set(name, existing + normalizeDurationMs(durationMs));
  }

  async function measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const stageStartedAtMs = clock.nowMs();
    try {
      return await fn();
    } finally {
      add(name, clock.nowMs() - stageStartedAtMs);
    }
  }

  function summary(input: IncomingDepositTimingSummaryInput): IncomingDepositTimingSummary {
    return {
      queueWaitMs: input.queueWaitMs,
      depositAgeAtStartMs: input.depositAgeAtStartMs,
      totalRunMs: normalizeDurationMs(clock.nowMs() - startedAtMs),
      stages: [...stages.entries()]
        .map(([name, durationMs]) => ({ name, durationMs: normalizeDurationMs(durationMs) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    };
  }

  function topStages(limit: number): IncomingDepositTimingStage[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    return sortedStages(stages).slice(0, safeLimit);
  }

  return { measure, add, summary, topStages };
}
```

- [ ] **Step 4: Run timing helper tests and verify they pass**

Run:

```bash
npx vitest run tests/forensics/incomingDepositTiming.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit timing helper**

Run:

```bash
git add src/forensics/incomingDepositTiming.ts tests/forensics/incomingDepositTiming.test.ts
git commit -m "Add incoming deposit timing helper"
```

---

### Task 2: Add Job-Level Incoming Deposit Timing

**Files:**
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Add failing job-level timing tests**

In `tests/forensics/incomingDepositJob.test.ts`, extend the existing `runSingleIncomingDepositJobCycle` describe block with these tests:

```ts
  it("persists incoming deposit performance timing on completed jobs", async () => {
    let currentMs = 0;
    const progressUpdates: Record<string, unknown>[] = [];
    const complete = vi.fn(async () => true);

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      updateForensicCheckJobProgress: async (input) => {
        progressUpdates.push(input.progressJson);
        return true;
      },
      completeForensicCheckJob: complete,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => {
        currentMs += 5;
      },
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => {
        currentMs += 20;
        return report();
      },
      timingClock: {
        nowMs: () => currentMs
      },
      now: () => new Date("2026-05-29T14:02:05.000Z")
    });

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
      progressJson: expect.objectContaining({
        performanceTiming: expect.objectContaining({
          queueWaitMs: 1000,
          depositAgeAtStartMs: 65000,
          totalRunMs: expect.any(Number),
          stages: expect.arrayContaining([
            { name: "build_report", durationMs: 20 },
            { name: "send_alert", durationMs: 5 }
          ])
        })
      })
    }));
    expect(progressUpdates.at(-1)).toEqual(expect.objectContaining({
      performanceTiming: expect.objectContaining({
        stages: expect.arrayContaining([
          { name: "build_report", durationMs: 20 }
        ])
      })
    }));
  });

  it("logs incoming deposit job timing after completion", async () => {
    let currentMs = 0;
    const infoLogs: Array<{ event: string; fields: Record<string, unknown> | undefined }> = [];

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: async () => true,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => {
        currentMs += 3;
      },
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => {
        currentMs += 40;
        return report();
      },
      timingClock: {
        nowMs: () => currentMs
      },
      now: () => new Date("2026-05-29T14:02:05.000Z"),
      logger: {
        info: (event, fields) => infoLogs.push({ event, fields }),
        warn: () => {},
        error: () => {}
      }
    });

    expect(infoLogs).toContainEqual({
      event: "incoming_deposit_job_timing",
      fields: expect.objectContaining({
        job_id: "job-incoming-1",
        deposit_tx_hash: depositTxHash,
        watched_wallet_id: watchedWalletId,
        sender: validProgressJson.sender,
        status: "completed",
        queue_wait_ms: 1000,
        deposit_age_at_start_ms: 65000,
        total_run_ms: expect.any(Number),
        top_stages: expect.arrayContaining([
          { name: "build_report", durationMs: 40 }
        ])
      })
    });
  });

  it("does not log timing when no incoming deposit job is claimed", async () => {
    const info = vi.fn();

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => null,
      completeForensicCheckJob: async () => true,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => undefined,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => report(),
      logger: {
        info,
        warn: () => {},
        error: () => {}
      }
    });

    expect(handled).toBe(false);
    expect(info).not.toHaveBeenCalledWith("incoming_deposit_job_timing", expect.anything());
  });
```

- [ ] **Step 2: Run incoming job tests and verify they fail**

Run:

```bash
npx vitest run tests/forensics/incomingDepositJob.test.ts
```

Expected: FAIL because `timingClock`, `now`, `logger`, and `performanceTiming` are not wired.

- [ ] **Step 3: Add job-level timing dependencies and imports**

Modify the top of `src/forensics/incomingDepositJob.ts`.

Add:

```ts
import type { Logger } from "../logging/logger";
import {
  createIncomingDepositTiming,
  type IncomingDepositTimingClock,
  type IncomingDepositTimingRecorder,
  type IncomingDepositTimingSummary
} from "./incomingDepositTiming";
```

Extend `BuildIncomingDepositReportInput`:

```ts
export type BuildIncomingDepositReportInput = {
  deps: IncomingDepositRuntimeDeps;
  job: ForensicCheckJob;
  depositTxHash: string;
  watchedWallet: string;
  sender: string;
  amountRaw: string;
  timestamp: Date;
  timing?: IncomingDepositTimingRecorder;
};
```

Extend `RunSingleIncomingDepositJobCycleDeps`:

```ts
export type RunSingleIncomingDepositJobCycleDeps = {
  claimNextForensicCheckJob(): Promise<ForensicCheckJob | null>;
  completeForensicCheckJob(input: CompleteJobInput): Promise<boolean>;
  updateForensicCheckJobProgress?(input: {
    id: string;
    progressJson: Record<string, unknown>;
    lastError?: string | null;
  }): Promise<boolean>;
  markUserAlertSent(input: { txHash: string; watchedWalletId: string }): Promise<boolean>;
  markUserAlertFailed(input: { txHash: string; watchedWalletId: string; error: string }): Promise<boolean>;
  recordObservedTransactionRisk(input: { txHash: string; watchedWalletId: string; report: RiskReport }): Promise<boolean>;
  sendUserAlert(
    telegramUserId: string,
    message: string,
    options?: { parse_mode?: "HTML"; reply_markup?: unknown }
  ): Promise<void>;
  formatIncomingDepositRiskAlert(input: {
    jobId: string;
    amount: string;
    watchedWallet: string;
    sender: string;
    txHash: string;
    timestamp?: Date | null;
    locale?: BotLocale;
    report: IncomingDepositRiskReport;
  }): { text: string; parseMode: "HTML"; replyMarkup?: unknown };
  buildReport(input: {
    job: ForensicCheckJob;
    depositTxHash: string;
    watchedWallet: string;
    sender: string;
    amountRaw: string;
    timestamp: Date;
    timing?: IncomingDepositTimingRecorder;
  }): Promise<IncomingDepositRiskReport>;
  logger?: Logger;
  now?: () => Date;
  timingClock?: IncomingDepositTimingClock;
};
```

- [ ] **Step 4: Add timing helper functions inside incomingDepositJob**

Add these functions above `runSingleIncomingDepositJobCycle`:

```ts
function safeDurationMs(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function queueWaitMs(job: ForensicCheckJob): number | null {
  if (!job.startedAt) return null;
  return safeDurationMs(job.startedAt.getTime() - job.createdAt.getTime());
}

function depositAgeAtStartMs(startedAt: Date, depositTimestamp: Date): number | null {
  const timestampMs = depositTimestamp.getTime();
  if (!Number.isFinite(timestampMs)) return null;
  return safeDurationMs(startedAt.getTime() - timestampMs);
}

function buildTimingSummary(input: {
  timing: IncomingDepositTimingRecorder;
  job: ForensicCheckJob;
  processingStartedAt: Date;
  depositTimestamp: Date | null;
}): IncomingDepositTimingSummary {
  return input.timing.summary({
    queueWaitMs: queueWaitMs(input.job),
    depositAgeAtStartMs: input.depositTimestamp
      ? depositAgeAtStartMs(input.processingStartedAt, input.depositTimestamp)
      : null
  });
}

function timingProgressPatch(summary: IncomingDepositTimingSummary): ForensicJobProgressPatch {
  return {
    performanceTiming: summary as unknown as Record<string, unknown>
  };
}

function logIncomingDepositTiming(input: {
  deps: RunSingleIncomingDepositJobCycleDeps;
  job: ForensicCheckJob;
  status: "completed" | "failed";
  depositTxHash: string | null;
  watchedWalletId: string | null;
  sender: string | null;
  summary: IncomingDepositTimingSummary;
  timing: IncomingDepositTimingRecorder;
}): void {
  input.deps.logger?.info("incoming_deposit_job_timing", {
    job_id: input.job.id,
    deposit_tx_hash: input.depositTxHash,
    watched_wallet_id: input.watchedWalletId,
    sender: input.sender,
    status: input.status,
    queue_wait_ms: input.summary.queueWaitMs,
    deposit_age_at_start_ms: input.summary.depositAgeAtStartMs,
    total_run_ms: input.summary.totalRunMs,
    top_stages: input.timing.topStages(5)
  });
}
```

- [ ] **Step 5: Wire timing into runSingleIncomingDepositJobCycle**

Replace the start of `runSingleIncomingDepositJobCycle` with this shape:

```ts
export async function runSingleIncomingDepositJobCycle(
  deps: RunSingleIncomingDepositJobCycleDeps
): Promise<boolean> {
  const timing = createIncomingDepositTiming(deps.timingClock);
  const job = await timing.measure("claim_job", () => deps.claimNextForensicCheckJob());
  if (!job) return false;

  const processingStartedAt = (deps.now ?? (() => new Date()))();
```

After `let currentProgress = job.progressJson;`, add:

```ts
  const persistTiming = async (summary: IncomingDepositTimingSummary): Promise<void> => {
    currentProgress = mergeForensicJobProgress(currentProgress, timingProgressPatch(summary));
    try {
      await deps.updateForensicCheckJobProgress?.({
        id: job.id,
        progressJson: currentProgress,
        lastError: null
      });
    } catch (error) {
      deps.logger?.warn("incoming_deposit_timing_persist_failed", {
        job_id: job.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };
```

In the success path, wrap existing awaits:

```ts
    await timing.measure("persist_phase_incoming_deposit_trace", () =>
      persistProgress({ jobPhase: "incoming_deposit_trace" })
    );
    const report = await timing.measure("build_report", () => deps.buildReport({
      job,
      depositTxHash,
      watchedWallet,
      sender,
      amountRaw,
      timestamp,
      timing
    }));
    const riskReport = riskReportFromIncoming(sender, report);
    await timing.measure("persist_phase_risk_recording", () =>
      persistProgress({ jobPhase: "risk_recording" })
    );
    await timing.measure("record_risk", () =>
      deps.recordObservedTransactionRisk({ txHash: depositTxHash, watchedWalletId, report: riskReport })
    );
```

For the alert block, use:

```ts
      const message = timing.measure("format_alert", async () => deps.formatIncomingDepositRiskAlert({
        jobId: job.id,
        amount: stringField(job.progressJson.amount) ?? amountRaw,
        watchedWallet,
        sender,
        txHash: depositTxHash,
        timestamp,
        locale,
        report
      }));
      const resolvedMessage = await message;
      await timing.measure("persist_phase_notification_delivery", () =>
        persistProgress({ jobPhase: "notification_delivery" })
      );
      await timing.measure("send_alert", () => deps.sendUserAlert(telegramUserId, resolvedMessage.text, {
        parse_mode: resolvedMessage.parseMode,
        reply_markup: resolvedMessage.replyMarkup
      }));
```

Then wrap mark sent and final timing persistence:

```ts
    await timing.measure("mark_alert_sent", () =>
      deps.markUserAlertSent({ txHash: depositTxHash, watchedWalletId })
    );
    await timing.measure("persist_phase_completing", () =>
      persistProgress({ jobPhase: "completing" })
    );
    const successSummary = buildTimingSummary({
      timing,
      job,
      processingStartedAt,
      depositTimestamp: timestamp
    });
    await persistTiming(successSummary);
    await timing.measure("complete_job", () => deps.completeForensicCheckJob({
      id: job.id,
      status: "completed",
      progressJson: currentProgress,
      resultJson: report as unknown as Record<string, unknown>,
      rawEvidenceIds: [],
      observationIds: [],
      lastError: null
    }));
    logIncomingDepositTiming({
      deps,
      job,
      status: "completed",
      depositTxHash,
      watchedWalletId,
      sender,
      summary: buildTimingSummary({ timing, job, processingStartedAt, depositTimestamp: timestamp }),
      timing
    });
```

In the catch block, keep the existing failure behavior and add timing:

```ts
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await timing.measure("mark_alert_failed", () =>
      deps.markUserAlertFailed({ txHash: depositTxHash, watchedWalletId, error: message })
    );
    const failureTimestamp = timestampText ? new Date(timestampText) : null;
    const failureSummary = buildTimingSummary({
      timing,
      job,
      processingStartedAt,
      depositTimestamp: failureTimestamp && Number.isFinite(failureTimestamp.getTime()) ? failureTimestamp : null
    });
    await persistTiming(failureSummary);
    await timing.measure("fail_job", () => deps.completeForensicCheckJob({
      id: job.id,
      status: "failed",
      progressJson: currentProgress,
      resultJson: {},
      rawEvidenceIds: [],
      observationIds: [],
      lastError: message
    }));
    logIncomingDepositTiming({
      deps,
      job,
      status: "failed",
      depositTxHash,
      watchedWalletId,
      sender,
      summary: buildTimingSummary({
        timing,
        job,
        processingStartedAt,
        depositTimestamp: failureTimestamp && Number.isFinite(failureTimestamp.getTime()) ? failureTimestamp : null
      }),
      timing
    });
    return true;
  }
```

The persisted `performanceTiming` is written before the final complete/fail DB update. The structured log includes the final `complete_job` or `fail_job` stage because it is emitted after the final write.

- [ ] **Step 6: Run job-level tests and fix TypeScript errors**

Run:

```bash
npx vitest run tests/forensics/incomingDepositJob.test.ts
npm run typecheck
```

Expected: PASS after adjusting local variable names and import ordering to match the file.

- [ ] **Step 7: Commit job-level timing**

Run:

```bash
git add src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "Add incoming deposit job timing"
```

---

### Task 3: Add Report-Level Stage Timing

**Files:**
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Add failing report-level timing test**

In `tests/forensics/incomingDepositJob.test.ts`, inside `describe("buildIncomingDepositReport", ...)`, add:

```ts
  it("records report-level performance stages without changing the report", async () => {
    let currentMs = 0;
    const timingStages: Array<{ name: string; durationMs: number }> = [];
    const timing = {
      async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
        const before = currentMs;
        const result = await fn();
        currentMs += 7;
        timingStages.push({ name, durationMs: currentMs - before });
        return result;
      },
      add(name: string, durationMs: number): void {
        timingStages.push({ name, durationMs });
      },
      summary() {
        return {
          queueWaitMs: null,
          depositAgeAtStartMs: null,
          totalRunMs: currentMs,
          stages: timingStages
        };
      },
      topStages() {
        return timingStages;
      }
    };

    const result = await buildIncomingDepositReport({
      deps: createIncomingDepositRuntimeDeps({
        listIndexedUsdtTransfersForAddress: async () => [
          indexedTransfer({ txHash: "fresh-funding" })
        ],
        listRelatedTrc20Transfers: async () => [],
        getClassificationForAddress: async () => null,
        getContractIntelligenceProfile: async () => null,
        getUsdtRestrictionStatus: async () => null
      }),
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp),
      timing
    });

    expect(result.depositRiskScore).toEqual(expect.any(Number));
    expect(timingStages.map((stage) => stage.name)).toEqual(expect.arrayContaining([
      "report_load_sender_labels",
      "report_evaluate_fast_sender_risk",
      "report_fetch_sender_edges",
      "report_run_where_is_money",
      "report_build_funding_bundles",
      "report_build_wallet_exposure_profile",
      "report_infer_sender_role",
      "report_assemble"
    ]));
  });
```

If the test file does not already expose `createIncomingDepositRuntimeDeps`, create it near the existing build-report tests by extracting the repeated deps object used in those tests. The helper must return a complete `IncomingDepositRuntimeDeps` with safe defaults:

```ts
function createIncomingDepositRuntimeDeps(
  overrides: Partial<IncomingDepositRuntimeDeps> = {}
): IncomingDepositRuntimeDeps {
  return {
    listIndexedUsdtTransfersForAddress: async () => [],
    listRelatedTrc20Transfers: async () => [],
    getLabelsForAddress: async () => [],
    getClassificationForAddress: async () => null,
    getContractIntelligenceProfile: async () => null,
    getTransaction: async () => ({}),
    getUsdtRestrictionStatus: async () => null,
    ...overrides
  };
}
```

- [ ] **Step 2: Run report-level test and verify it fails**

Run:

```bash
npx vitest run tests/forensics/incomingDepositJob.test.ts -t "records report-level performance stages"
```

Expected: FAIL because `buildIncomingDepositReport` does not call `timing.measure(...)`.

- [ ] **Step 3: Add a local report timing wrapper**

Inside `buildIncomingDepositReport`, immediately after function start, add:

```ts
  const measureReportStage = <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    if (!input.timing) return fn();
    return input.timing.measure(`report_${name}`, fn);
  };
```

- [ ] **Step 4: Wrap sender labels and fast risk evaluation**

Replace:

```ts
  const labels = await input.deps.getLabelsForAddress(input.sender);
  const fastSenderRisk = evaluateAddressRisk({
```

with:

```ts
  const labels = await measureReportStage("load_sender_labels", () =>
    input.deps.getLabelsForAddress(input.sender)
  );
  const fastSenderRisk = await measureReportStage("evaluate_fast_sender_risk", async () => evaluateAddressRisk({
    context: {
      subjectAddress: input.sender,
      observedTransactionHash: input.depositTxHash
    },
    labels
  }).report);
```

Remove the old duplicated `context` block from the original `evaluateAddressRisk` call so the function still compiles.

- [ ] **Step 5: Wrap transfer fetch helpers**

Inside `fetchEdgesForAddress`, wrap indexed and live reads:

```ts
    const indexedTransfers = await measureReportStage("fetch_window_indexed_edges", () =>
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
    const liveTransfers = await measureReportStage("fetch_window_live_edges", () =>
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

Inside `fetchLatestEdgesForAddress`, wrap indexed and live reads:

```ts
    const indexedTransfers = await measureReportStage("fetch_latest_indexed_edges", () =>
      readTransfersOrEmpty("indexed", "latest", address, () =>
        input.deps.listIndexedUsdtTransfersForAddress(address, {
          minTimestamp: new Date(0),
          maxTimestamp,
          limit,
          orderBy: "newest",
          direction: "both"
        })
      )
    );
    const liveTransfers = await measureReportStage("fetch_latest_live_edges", () =>
      readTransfersOrEmpty("live", "latest", address, () =>
        input.deps.listRelatedTrc20Transfers(address, {
          start: 0,
          limit,
          endTimestamp: maxTimestamp.getTime()
        })
      )
    );
```

- [ ] **Step 6: Wrap major buildIncomingDepositReport awaits**

Replace these existing awaits with measured versions:

```ts
  const senderStablecoinState = await measureReportStage("sender_stablecoin_state", () =>
    getStablecoinState(input.sender)
  );
  const senderEdges = await measureReportStage("fetch_sender_edges", () =>
    fetchEdgesForAddress(input.sender)
  );
```

Wrap `runWhereIsMoneyCheck`:

```ts
  const whereReport = await measureReportStage("run_where_is_money", () => runWhereIsMoneyCheck({
```

Keep the existing object passed to `runWhereIsMoneyCheck` unchanged and close the wrapper with:

```ts
  }));
```

Wrap funding bundles:

```ts
  const fundingBundlesByTxHash = await measureReportStage("build_funding_bundles", () =>
    buildFundingBundlesByTxHash({
      whereReport,
      fetchEdgesForAddress,
      fetchLatestEdgesForAddress,
      deposit: seedDeposit
    })
  );
```

Wrap wallet exposure:

```ts
  const walletExposureProfile = await measureReportStage("build_wallet_exposure_profile", () =>
    buildIncomingWalletExposureProfile({
      sender: input.sender,
      senderEdges,
      fundingBundlesByTxHash,
      whereReport,
      getClassificationForAddress: async (address) => {
        const classification = await getClassificationForAddress(address);
        return deterministicLegitimateServiceClassifications.get(address) ?? classification;
      }
    })
  );
```

Wrap sender role:

```ts
  const senderRole = await measureReportStage("infer_sender_role", () =>
    inferIncomingDepositSenderRole({
      sender: input.sender,
      senderEdges,
      originPaths: report.originPaths,
      stablecoinState: senderStablecoinState,
      getClassificationForAddress
    })
  );
```

Wrap final report assembly by moving object construction into the stage:

```ts
  return measureReportStage("assemble", async () => ({
    ...report,
    senderRole
  }));
```

If the current code mutates `report.senderRole` before return, replace that mutation with the returned object above.

- [ ] **Step 7: Run report-level tests**

Run:

```bash
npx vitest run tests/forensics/incomingDepositJob.test.ts -t "records report-level performance stages"
npx vitest run tests/forensics/incomingDepositJob.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit report-level timing**

Run:

```bash
git add src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "Add incoming deposit report timing"
```

---

### Task 4: Add Slow Stage Warning Logs

**Files:**
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Add failing slow-stage warning test**

In `tests/forensics/incomingDepositJob.test.ts`, add:

```ts
  it("warns when an incoming deposit stage exceeds the slow-stage threshold", async () => {
    let currentMs = 0;
    const warnings: Array<{ event: string; fields: Record<string, unknown> | undefined }> = [];

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: async () => true,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => undefined,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => {
        currentMs += 31_000;
        return report();
      },
      timingClock: {
        nowMs: () => currentMs
      },
      now: () => new Date("2026-05-29T14:02:05.000Z"),
      logger: {
        info: () => {},
        warn: (event, fields) => warnings.push({ event, fields }),
        error: () => {}
      }
    });

    expect(warnings).toContainEqual({
      event: "incoming_deposit_stage_slow",
      fields: expect.objectContaining({
        job_id: "job-incoming-1",
        stage: "build_report",
        duration_ms: 31000
      })
    });
  });
```

- [ ] **Step 2: Run slow-stage test and verify it fails**

Run:

```bash
npx vitest run tests/forensics/incomingDepositJob.test.ts -t "warns when an incoming deposit stage exceeds"
```

Expected: FAIL because no warning is emitted.

- [ ] **Step 3: Implement slow-stage warning**

Add near the timing helper functions:

```ts
const INCOMING_DEPOSIT_SLOW_STAGE_THRESHOLD_MS = 30_000;

function warnSlowIncomingDepositStages(input: {
  deps: RunSingleIncomingDepositJobCycleDeps;
  job: ForensicCheckJob;
  timing: IncomingDepositTimingRecorder;
}): void {
  for (const stage of input.timing.topStages(20)) {
    if (stage.durationMs < INCOMING_DEPOSIT_SLOW_STAGE_THRESHOLD_MS) continue;
    input.deps.logger?.warn("incoming_deposit_stage_slow", {
      job_id: input.job.id,
      stage: stage.name,
      duration_ms: stage.durationMs
    });
  }
}
```

Call it immediately before `logIncomingDepositTiming(...)` in both success and failure paths:

```ts
    warnSlowIncomingDepositStages({ deps, job, timing });
```

- [ ] **Step 4: Run slow-stage and incoming tests**

Run:

```bash
npx vitest run tests/forensics/incomingDepositJob.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit slow-stage warning**

Run:

```bash
git add src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "Warn on slow incoming deposit stages"
```

---

### Task 5: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npx vitest run tests/forensics/incomingDepositTiming.test.ts tests/forensics/incomingDepositJob.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git log -5 --oneline
```

Expected:

```text
git status --short
```

prints no unstaged or uncommitted files.

`git log -5 --oneline` includes the implementation commits from Tasks 1-4.

---

## Self-Review

Spec coverage:

- Queue wait: Task 2.
- Deposit age at processing start: Task 2.
- Total runtime: Task 1 and Task 2.
- Job-level stages: Task 2.
- Report-level stages: Task 3.
- Progress JSON persistence: Task 2.
- Structured final timing log: Task 2.
- Slow-stage warning log: Task 4.
- No score or alert behavior changes: maintained by existing incoming deposit tests and full suite.

Consistency check:

- The timing helper type is `IncomingDepositTimingRecorder`.
- The dependency clock type is `IncomingDepositTimingClock`.
- The progress JSON key is `performanceTiming`.
- The final log event is `incoming_deposit_job_timing`.
- The slow-stage warning event is `incoming_deposit_stage_slow`.

Implementation note:

- Persisted `performanceTiming` is written before the final complete/fail DB write, so it covers every stage before the final write. The final structured log is emitted after the final write and includes `complete_job` or `fail_job`.
