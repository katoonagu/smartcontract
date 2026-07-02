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
