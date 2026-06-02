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
  "failed_after_stale_recovery"
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
