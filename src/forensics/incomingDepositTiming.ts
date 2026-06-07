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
    const normalizeInputMs = (value: number | null): number | null =>
      value === null ? null : normalizeDurationMs(value);

    return {
      queueWaitMs: normalizeInputMs(input.queueWaitMs),
      depositAgeAtStartMs: normalizeInputMs(input.depositAgeAtStartMs),
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
