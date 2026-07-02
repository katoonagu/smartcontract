import type { ForensicJobProgressPatch } from "./forensicJobProgress";

export type StrictProvenanceBenchmarkPhase =
  | "selecting_flows"
  | "tracing_paths"
  | "checking_hop_coverage"
  | "indexing_hop_history"
  | "waiting_for_targeted_index"
  | "reading_local_index"
  | "scoring"
  | "completed"
  | "provider_limited"
  | "failed";

export type StrictScoreBlockedReason =
  | "provider_error"
  | "rate_limited_after_retries"
  | "provider_inconsistent"
  | "provider_cap_unresolved"
  | "hard_safety_limit_exceeded";

export type StrictWaitingForTargetedIndex = {
  address: string;
  coverageMode: "targeted";
  targetTimestamp: string;
  queuedReason: string;
};

export type StrictProvenanceProgress = {
  phase: StrictProvenanceBenchmarkPhase;
  scoreValid: boolean;
  scoreBlockedReason: StrictScoreBlockedReason | null;
  technicalStatus: string | null;
  waitingFor: StrictWaitingForTargetedIndex | null;
  selectedFlowCount: number | null;
  pathCount: number | null;
  coveredHopCount: number;
  totalHopCount: number;
};

export type StageKey = "apiMs" | "dbWriteMs" | "dbReadMs" | "traceMs" | "scoringMs";

export type CounterPatch = Partial<{
  requestCount: number;
  successCount: number;
  failedCount: number;
  retryCount: number;
  rateLimitedCount: number;
  forbiddenCount: number;
  serverErrorCount: number;
  cooldownMs: number;
  pagesFetched: number;
  transfersFetched: number;
}>;

export function isStrictProvenanceBenchmarkJob(input: {
  progressJson: Record<string, unknown>;
}): boolean {
  return input.progressJson.strictProvenanceBenchmark === true;
}

export function buildStrictBenchmarkInitialProgress(input: {
  locale: "ru" | "en";
  keyCount: number | null;
  accountGroupCount: number | null;
  now?: Date;
}): Record<string, unknown> {
  const now = input.now ?? new Date();
  return {
    mode: "wallet_profile",
    locale: input.locale,
    strictProvenanceBenchmark: true,
    jobPhase: "selecting_flows",
    strictProvenance: {
      phase: "selecting_flows",
      scoreValid: false,
      scoreBlockedReason: null,
      technicalStatus: null,
      waitingFor: null,
      selectedFlowCount: null,
      pathCount: null,
      coveredHopCount: 0,
      totalHopCount: 0
    } satisfies StrictProvenanceProgress,
    strictBenchmarkMetrics: {
      total: {
        startedAt: now.toISOString(),
        completedAt: null,
        elapsedMs: 0,
        keyCount: input.keyCount,
        accountGroupCount: input.accountGroupCount,
        requestCount: 0,
        successCount: 0,
        failedCount: 0,
        retryCount: 0,
        rateLimitedCount: 0,
        forbiddenCount: 0,
        serverErrorCount: 0,
        cooldownMs: 0,
        pagesFetched: 0,
        transfersFetched: 0,
        effectiveRps: null
      },
      stages: {
        apiMs: 0,
        dbWriteMs: 0,
        dbReadMs: 0,
        traceMs: 0,
        scoringMs: 0
      }
    }
  };
}

export function strictWaitingProgressPatch(input: {
  address: string;
  targetTimestamp: Date;
  queuedReason: string;
}): ForensicJobProgressPatch & { strictProvenance: Partial<StrictProvenanceProgress> } {
  return {
    jobPhase: "waiting_for_targeted_index",
    strictProvenance: {
      phase: "waiting_for_targeted_index",
      scoreValid: false,
      waitingFor: {
        address: input.address,
        coverageMode: "targeted",
        targetTimestamp: input.targetTimestamp.toISOString(),
        queuedReason: input.queuedReason
      }
    }
  };
}

export function strictCompletedResultJson(): Record<string, unknown> {
  return {
    score_valid: true,
    score_blocked_reason: null,
    technical_status: "completed"
  };
}

export function strictBlockedResultJson(reason: StrictScoreBlockedReason): Record<string, unknown> {
  return {
    score_valid: false,
    score_blocked_reason: reason,
    technical_status: "provider_limited"
  };
}

export async function measureStrictBenchmarkStage<T>(
  progressJson: Record<string, unknown>,
  stage: StageKey,
  fn: () => Promise<T>,
  options: { nowMs?: () => number } = {}
): Promise<{ value: T; progress: Record<string, any> }> {
  const nowMs = options.nowMs ?? (() => Date.now());
  const started = nowMs();
  const value = await fn();
  const elapsedMs = Math.max(0, nowMs() - started);
  const metrics = strictBenchmarkMetrics(progressJson, nowMs());
  const stages = strictBenchmarkStages(metrics);
  stages[stage] = Math.max(0, numberField(stages[stage])) + elapsedMs;
  return {
    value,
    progress: {
      ...withoutApiKeyValues(progressJson),
      strictBenchmarkMetrics: {
        ...metrics,
        total: recomputeBenchmarkTotal(strictBenchmarkTotal(metrics), nowMs()),
        stages
      }
    }
  };
}

export function addStrictBenchmarkCounters(
  progressJson: Record<string, unknown>,
  patch: CounterPatch
): Record<string, any> {
  const metrics = strictBenchmarkMetrics(progressJson);
  const total = strictBenchmarkTotal(metrics);
  for (const key of Object.keys(patch) as Array<keyof CounterPatch>) {
    const value = patch[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    total[key] = Math.max(0, numberField(total[key])) + Math.max(0, value);
  }
  return {
    ...withoutApiKeyValues(progressJson),
    strictBenchmarkMetrics: {
      ...metrics,
      total: recomputeBenchmarkTotal(total),
      stages: strictBenchmarkStages(metrics)
    }
  };
}

function strictBenchmarkMetrics(progressJson: Record<string, unknown>, nowMs = Date.now()): Record<string, any> {
  const existing = isRecord(progressJson.strictBenchmarkMetrics)
    ? withoutApiKeyValues(progressJson.strictBenchmarkMetrics)
    : {};
  return {
    ...existing,
    total: recomputeBenchmarkTotal(strictBenchmarkTotal(existing), nowMs),
    stages: strictBenchmarkStages(existing)
  };
}

function strictBenchmarkTotal(metrics: Record<string, unknown>): Record<string, any> {
  return isRecord(metrics.total) ? withoutApiKeyValues(metrics.total) : {};
}

function strictBenchmarkStages(metrics: Record<string, unknown>): Record<StageKey, number> & Record<string, unknown> {
  const existing = isRecord(metrics.stages) ? metrics.stages : {};
  return {
    ...existing,
    apiMs: Math.max(0, numberField(existing.apiMs)),
    dbWriteMs: Math.max(0, numberField(existing.dbWriteMs)),
    dbReadMs: Math.max(0, numberField(existing.dbReadMs)),
    traceMs: Math.max(0, numberField(existing.traceMs)),
    scoringMs: Math.max(0, numberField(existing.scoringMs))
  };
}

function recomputeBenchmarkTotal(total: Record<string, any>, nowMs = Date.now()): Record<string, any> {
  const startedAt = typeof total.startedAt === "string" ? Date.parse(total.startedAt) : NaN;
  const elapsedMs = Number.isFinite(startedAt)
    ? Math.max(0, nowMs - startedAt)
    : Math.max(0, numberField(total.elapsedMs));
  const requestCount = Math.max(0, numberField(total.requestCount));
  return {
    ...total,
    elapsedMs,
    effectiveRps: elapsedMs > 0 && requestCount > 0 ? requestCount / (elapsedMs / 1000) : null
  };
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function withoutApiKeyValues<T extends Record<string, unknown>>(record: T): Record<string, any> {
  const next: Record<string, any> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isApiKeyValueField(key)) continue;
    if (Array.isArray(value)) {
      next[key] = value.map((item) => isRecord(item) ? withoutApiKeyValues(item) : item);
      continue;
    }
    next[key] = isRecord(value) ? withoutApiKeyValues(value) : value;
  }
  return next;
}

function isApiKeyValueField(key: string): boolean {
  const normalized = key.replace(/[_-]/g, "").toLowerCase();
  return normalized === "apikey" ||
    normalized === "apikeys" ||
    normalized === "apikeyvalue" ||
    normalized === "apikeyvalues";
}
