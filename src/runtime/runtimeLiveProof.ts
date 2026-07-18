import { createHash } from "node:crypto";
import { formatRuntimeVersion, type RuntimeVersionV1 } from "./runtimeVersion";

export const RUNTIME_CYCLE_NAMES = [
  "poll",
  "where_forensic",
  "incoming_deposit",
  "deep_forensic",
  "address_index",
  "wait_reconciliation",
  "forensic_delivery",
  "allowance_refresh"
] as const;

export type RuntimeCycleName = typeof RUNTIME_CYCLE_NAMES[number];

export type RuntimeCycleWorkSummary = Readonly<{
  sourceQueryCompleted: true;
  examinedCount: number;
  completedCount: number;
}>;

export type RuntimeCycleHighWatermarkV1 = Readonly<{
  sequence: number;
  completedAt: string;
}>;

export type RuntimeProofV1 = Readonly<{
  version: "runtime-proof-v1";
  runtimeVersion: RuntimeVersionV1;
  runtimeVersionSha256: string;
  formattedRuSha256: string;
  formattedEnSha256: string;
  cycleHighWatermarks: Readonly<Record<RuntimeCycleName, RuntimeCycleHighWatermarkV1 | null>>;
}>;

export type RuntimeNavigationProbeV1 = Readonly<{
  version: "runtime-navigation-probe-v1";
  runtimeSha: string;
  cacheOnly: Readonly<{
    reads: 2;
    providerCalls: 0;
    sources: readonly ["cache" | "stale", "cache" | "stale"];
  }>;
  explicitRefresh: Readonly<{
    attempts: 1;
    providerCalls: number;
    completed: true;
  }>;
  callback: Readonly<{
    ackCompleted: true;
    ackBeforeWork: true;
    returnedWhileWorkPending: true;
  }>;
  telegramTransport: "absent";
  completedAt: string;
}>;

type CycleLogger = {
  info(event: string, fields: Record<string, unknown>): void;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeCount(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}

function emptyHighWatermarks(): Record<RuntimeCycleName, RuntimeCycleHighWatermarkV1 | null> {
  return Object.fromEntries(RUNTIME_CYCLE_NAMES.map((name) => [name, null])) as Record<
    RuntimeCycleName,
    RuntimeCycleHighWatermarkV1 | null
  >;
}

export function createRuntimeCycleRecorder(input: {
  runtimeVersion: RuntimeVersionV1;
  logger: CycleLogger;
  now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());
  const sequences = new Map<RuntimeCycleName, number>();
  const highWatermarks = emptyHighWatermarks();

  return {
    start(cycle: RuntimeCycleName) {
      const startedAt = now();
      let terminal = false;
      return {
        complete(summary: RuntimeCycleWorkSummary): void {
          if (terminal) throw new Error("runtime_cycle_already_terminal");
          terminal = true;
          safeCount(summary.examinedCount, "runtime_cycle_examined_count_invalid");
          safeCount(summary.completedCount, "runtime_cycle_completed_count_invalid");
          if (summary.completedCount > summary.examinedCount) {
            throw new Error("runtime_cycle_completed_count_exceeds_examined");
          }
          const finishedAt = now();
          const durationMs = finishedAt.getTime() - startedAt.getTime();
          if (durationMs < 0) throw new Error("runtime_cycle_time_invalid");
          const sequence = (sequences.get(cycle) ?? 0) + 1;
          sequences.set(cycle, sequence);
          highWatermarks[cycle] = Object.freeze({ sequence, completedAt: finishedAt.toISOString() });
          input.logger.info("runtime_cycle_completed", {
            runtimeSha: input.runtimeVersion.gitCommitSha,
            cycle,
            sequence,
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs,
            sourceQueryCompleted: summary.sourceQueryCompleted,
            examinedCount: summary.examinedCount,
            completedCount: summary.completedCount
          });
        },
        fail(): void {
          if (terminal) throw new Error("runtime_cycle_already_terminal");
          terminal = true;
        }
      };
    },
    proof(): RuntimeProofV1 {
      const runtimeJson = JSON.stringify(input.runtimeVersion);
      return Object.freeze({
        version: "runtime-proof-v1",
        runtimeVersion: input.runtimeVersion,
        runtimeVersionSha256: sha256(runtimeJson),
        formattedRuSha256: sha256(formatRuntimeVersion(input.runtimeVersion, "ru")),
        formattedEnSha256: sha256(formatRuntimeVersion(input.runtimeVersion, "en")),
        cycleHighWatermarks: Object.freeze({ ...highWatermarks })
      });
    }
  };
}

export async function runAckBeforeDeferredWork<T>(
  acknowledge: () => Promise<void>,
  startWork: () => Promise<T>
): Promise<Readonly<{ work: Promise<T>; workSettled(): boolean }>> {
  await acknowledge();
  let settled = false;
  const work = Promise.resolve().then(startWork).finally(() => { settled = true; });
  return Object.freeze({ work, workSettled: () => settled });
}

export async function runRuntimeNavigationProbeV1(input: {
  runtimeVersion: RuntimeVersionV1;
  providerCallCount(): number;
  readCachedDashboard(): Promise<"cache" | "stale" | null>;
  refreshDashboard(): Promise<"fresh" | "stale" | "error">;
  now?: () => Date;
}): Promise<RuntimeNavigationProbeV1> {
  const beforeCache = safeCount(input.providerCallCount(), "runtime_probe_provider_count_invalid");
  const first = await input.readCachedDashboard();
  const second = await input.readCachedDashboard();
  if (first === null || second === null) throw new Error("runtime_probe_cached_wallet_unavailable");
  const afterCache = safeCount(input.providerCallCount(), "runtime_probe_provider_count_invalid");
  if (afterCache !== beforeCache) throw new Error("runtime_probe_cache_called_provider");

  const beforeRefresh = afterCache;
  let refreshed: "fresh" | "stale" | "error";
  try {
    refreshed = await input.refreshDashboard();
  } catch {
    throw new Error("runtime_probe_explicit_refresh_failed");
  }
  const afterRefresh = safeCount(input.providerCallCount(), "runtime_probe_provider_count_invalid");
  if (refreshed !== "fresh" || afterRefresh <= beforeRefresh) {
    throw new Error("runtime_probe_explicit_refresh_unverified");
  }

  let acknowledged = false;
  let workStartedAfterAck = false;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const callback = await runAckBeforeDeferredWork(
    async () => { acknowledged = true; },
    () => {
      workStartedAfterAck = acknowledged;
      return pending;
    }
  );
  await Promise.resolve();
  const returnedWhileWorkPending = !callback.workSettled();
  release();
  await callback.work;
  if (!acknowledged || !workStartedAfterAck || !returnedWhileWorkPending) {
    throw new Error("runtime_probe_callback_lifecycle_unverified");
  }

  return Object.freeze({
    version: "runtime-navigation-probe-v1",
    runtimeSha: input.runtimeVersion.gitCommitSha,
    cacheOnly: Object.freeze({ reads: 2, providerCalls: 0, sources: [first, second] as const }),
    explicitRefresh: Object.freeze({ attempts: 1, providerCalls: afterRefresh - beforeRefresh, completed: true }),
    callback: Object.freeze({ ackCompleted: true, ackBeforeWork: true, returnedWhileWorkPending: true }),
    telegramTransport: "absent",
    completedAt: (input.now?.() ?? new Date()).toISOString()
  });
}
