import type {
  UnifiedDeliveryStatus,
  UnifiedRunPurpose,
  UnifiedRunStatus,
  UnifiedSideEffectPolicy
} from "./contracts";

export type UnifiedWatchdogFinding =
  | "healthy"
  | "waiting_provider"
  | "stale_lease_reclaimable"
  | "blocked_source_unavailable"
  | "blocked_admin_review"
  | "delivery_unknown"
  | "canary_deadline_reached";

export type UnifiedWatchdogRunV1 = {
  readonly id: string;
  readonly subjectAddress: string;
  readonly status: UnifiedRunStatus;
  readonly statusReason: string | null;
  readonly runPurpose: UnifiedRunPurpose;
  readonly sideEffectPolicy: UnifiedSideEffectPolicy;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly canaryDeadlineAt: string | null;
  readonly finalScore: number | null;
  readonly finalDecision: "ACCEPTABLE" | "REVIEW" | "DECLINE" | null;
  readonly hashes: {
    readonly snapshot: string;
    readonly analysisManifest: string;
    readonly evidence: string | null;
    readonly closure: string | null;
    readonly scoring: string | null;
    readonly report: string | null;
  };
  readonly versions: {
    readonly scoringPolicy: string;
    readonly attributionPolicy: string;
    readonly traversalPolicy: string;
    readonly runtimeCommit: string;
    readonly databaseSchema: number;
  };
  readonly traversal: {
    readonly closed: boolean | null;
    readonly visitedCount: number | null;
    readonly frontierCount: number | null;
  };
  readonly generation: {
    readonly analysis: "unified";
    readonly deliveryAuthority: "legacy" | "unified" | "shadow";
    readonly fenceId: string | null;
    readonly activatedAt: string | null;
  };
  readonly tasks: readonly {
    readonly id: string;
    readonly kind: string;
    readonly status:
      | "QUEUED"
      | "LEASED"
      | "WAITING_RETRY"
      | "COMPLETED"
      | "BLOCKED_ADMIN"
      | "FAILED_TECHNICAL"
      | "CANCELLED";
    readonly priorityLane: "interactive" | "repair" | "background";
    readonly readyAt: string;
    readonly leaseExpiresAt: string | null;
    readonly heartbeatAt: string | null;
    readonly cancellationRequestedAt: string | null;
    readonly providerState: "ready" | "waiting" | "unavailable";
    readonly checkpoint: Readonly<Record<string, unknown>>;
    readonly attempts: readonly {
      readonly id: string;
      readonly attempt: number;
      readonly artifactSha256: string | null;
      readonly completedAt: string | null;
    }[];
    readonly durationsMs: {
      readonly queue: number;
      readonly provider: number;
      readonly compute: number;
    };
  }[];
  readonly deliveries: readonly {
    readonly id: string;
    readonly status: UnifiedDeliveryStatus;
    readonly presentationSha256: string;
    readonly attemptCount: number;
    readonly lastError: string | null;
    readonly telegramMessageId: string | null;
  }[];
};

export type UnifiedWatchdogProjectionV1 = UnifiedWatchdogRunV1 & {
  readonly finding: UnifiedWatchdogFinding;
  readonly score: number | null;
  readonly decision: "ACCEPTABLE" | "REVIEW" | "DECLINE" | null;
};

function time(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new TypeError("unified_watchdog_invalid_time");
  }
  return parsed;
}

function finding(
  run: UnifiedWatchdogRunV1,
  now: number,
  staleHeartbeatMs: number
): UnifiedWatchdogFinding {
  if (run.deliveries.some((delivery) =>
    delivery.status === "DELIVERY_UNKNOWN"
  )) {
    return "delivery_unknown";
  }
  if (
    run.runPurpose === "release_canary" &&
    run.status !== "COMPLETED" &&
    run.status !== "FAILED_TECHNICAL" &&
    run.canaryDeadlineAt !== null &&
    time(run.canaryDeadlineAt) <= now
  ) {
    return "canary_deadline_reached";
  }
  if (
    run.status === "BLOCKED_ADMIN" ||
    run.tasks.some((task) => task.status === "BLOCKED_ADMIN")
  ) {
    return "blocked_admin_review";
  }
  if (run.tasks.some((task) => task.providerState === "unavailable")) {
    return "blocked_source_unavailable";
  }
  if (run.tasks.some((task) => {
    if (task.status !== "LEASED") return false;
    if (
      task.leaseExpiresAt !== null &&
      time(task.leaseExpiresAt) <= now
    ) {
      return true;
    }
    return task.heartbeatAt !== null &&
      now - time(task.heartbeatAt) > staleHeartbeatMs;
  })) {
    return "stale_lease_reclaimable";
  }
  if (
    run.status === "WAITING_FOR_PROVIDER" ||
    run.tasks.some((task) => task.providerState === "waiting")
  ) {
    return "waiting_provider";
  }
  return "healthy";
}

export function inspectUnifiedRuns(
  runs: readonly UnifiedWatchdogRunV1[],
  input: { readonly now: Date; readonly staleHeartbeatMs: number }
): UnifiedWatchdogProjectionV1[] {
  const now = input.now.getTime();
  if (
    Number.isNaN(now) ||
    !Number.isSafeInteger(input.staleHeartbeatMs) ||
    input.staleHeartbeatMs < 1
  ) {
    throw new TypeError("unified_watchdog_input_invalid");
  }
  return [...runs]
    .sort((left, right) =>
      time(right.updatedAt) - time(left.updatedAt) ||
      left.id.localeCompare(right.id)
    )
    .map((run) => ({
      ...structuredClone(run),
      finding: finding(run, now, input.staleHeartbeatMs),
      finalScore: run.status === "COMPLETED" ? run.finalScore : null,
      finalDecision: run.status === "COMPLETED" ? run.finalDecision : null,
      score: run.status === "COMPLETED" ? run.finalScore : null,
      decision: run.status === "COMPLETED" ? run.finalDecision : null
    }));
}
