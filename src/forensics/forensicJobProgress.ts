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
  | "failed_after_stale_recovery"
  | "selecting_flows"
  | "tracing_paths"
  | "checking_hop_coverage"
  | "checking_balance_forming_slice"
  | "indexing_hop_history"
  | "waiting_for_targeted_index"
  | "reading_local_index"
  | "scoring"
  | "provider_limited";

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
  strictProvenance?: Record<string, unknown>;
  targetedIndex?: Record<string, unknown>;
  balanceFormingSlice?: Record<string, unknown>;
  strictBenchmarkMetrics?: Record<string, unknown>;
  performanceTiming?: Record<string, unknown>;
};

export type ForensicJobRuntimeSummary = {
  phase: ForensicJobPhase | null;
  heartbeatAt: string | null;
  retryCount: number;
  lastRecoveredAt: string | null;
  staleRecoveryReason: string | null;
  crossChain: (Omit<CrossChainStage2Progress, "status"> & {
    status: CrossChainStage2ProgressStatus | null;
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
  "failed_after_stale_recovery",
  "selecting_flows",
  "tracing_paths",
  "checking_hop_coverage",
  "checking_balance_forming_slice",
  "indexing_hop_history",
  "waiting_for_targeted_index",
  "reading_local_index",
  "scoring",
  "provider_limited"
]);

const crossChainStage2ProgressStatuses = new Set<CrossChainStage2ProgressStatus>([
  "not_applicable",
  "pending",
  "running",
  "skipped",
  "partial",
  "completed",
  "failed"
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
    ? (value as ForensicJobPhase)
    : null;
}

export function parseCrossChainStage2ProgressStatus(
  value: unknown
): CrossChainStage2ProgressStatus | null {
  return typeof value === "string" &&
    crossChainStage2ProgressStatuses.has(value as CrossChainStage2ProgressStatus)
    ? (value as CrossChainStage2ProgressStatus)
    : null;
}

export function mergeForensicJobProgress(
  base: Record<string, unknown>,
  patch: ForensicJobProgressPatch,
  now: Date = new Date()
): Record<string, unknown> {
  const heartbeat = patch.jobHeartbeatAt ?? now.toISOString();
  const baseCrossChain = isRecord(base.crossChainStage2Progress)
    ? base.crossChainStage2Progress
    : undefined;
  const crossChain = (baseCrossChain || patch.crossChainStage2Progress)
    ? {
        ...(baseCrossChain ?? {}),
        ...(patch.crossChainStage2Progress ?? {}),
        updatedAt:
          patch.crossChainStage2Progress?.updatedAt ??
          baseCrossChain?.updatedAt ??
          heartbeat
      }
    : undefined;
  const strictProvenance =
    isRecord(base.strictProvenance) || patch.strictProvenance
      ? {
          ...(isRecord(base.strictProvenance) ? base.strictProvenance : {}),
          ...(patch.strictProvenance ?? {})
        }
      : undefined;
  const baseStrictBenchmarkMetrics = isRecord(base.strictBenchmarkMetrics)
    ? base.strictBenchmarkMetrics
    : undefined;
  const patchStrictBenchmarkMetrics = isRecord(patch.strictBenchmarkMetrics)
    ? patch.strictBenchmarkMetrics
    : undefined;
  const baseStrictBenchmarkTotal = isRecord(baseStrictBenchmarkMetrics?.total)
    ? baseStrictBenchmarkMetrics.total
    : undefined;
  const patchStrictBenchmarkTotal = isRecord(patchStrictBenchmarkMetrics?.total)
    ? patchStrictBenchmarkMetrics.total
    : undefined;
  const baseStrictBenchmarkStages = isRecord(baseStrictBenchmarkMetrics?.stages)
    ? baseStrictBenchmarkMetrics.stages
    : undefined;
  const patchStrictBenchmarkStages = isRecord(patchStrictBenchmarkMetrics?.stages)
    ? patchStrictBenchmarkMetrics.stages
    : undefined;
  const strictBenchmarkMetrics =
    baseStrictBenchmarkMetrics || patchStrictBenchmarkMetrics
      ? {
          ...(baseStrictBenchmarkMetrics ?? {}),
          ...(patchStrictBenchmarkMetrics ?? {}),
          ...(baseStrictBenchmarkTotal || patchStrictBenchmarkTotal
            ? { total: { ...(baseStrictBenchmarkTotal ?? {}), ...(patchStrictBenchmarkTotal ?? {}) } }
            : {}),
          ...(baseStrictBenchmarkStages || patchStrictBenchmarkStages
            ? { stages: { ...(baseStrictBenchmarkStages ?? {}), ...(patchStrictBenchmarkStages ?? {}) } }
            : {})
        }
      : undefined;

  return {
    ...base,
    ...patch,
    jobHeartbeatAt: heartbeat,
    ...(crossChain ? { crossChainStage2Progress: crossChain } : {}),
    ...(strictProvenance ? { strictProvenance } : {}),
    ...(strictBenchmarkMetrics ? { strictBenchmarkMetrics } : {})
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
        status: parseCrossChainStage2ProgressStatus(rawCrossChain.status),
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
