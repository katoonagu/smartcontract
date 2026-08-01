import type {
  UnifiedBranchStatus,
  UnifiedDeliveryStatus,
  UnifiedRunStatus
} from "./contracts";

export type UnifiedRunEvent =
  | "provider_wait"
  | "provider_ready"
  | "admin_block"
  | "admin_resume"
  | "begin_finalizing"
  | "commit_completed"
  | "fail_technical";

export type UnifiedBranchEvent =
  | "complete"
  | "not_applicable"
  | "retry_wait"
  | "retry_ready"
  | "admin_block"
  | "admin_resume"
  | "fail_technical";

export type UnifiedDeliveryEvent =
  | "lease"
  | "transport_retryable"
  | "retry"
  | "transport_confirmed"
  | "transport_ambiguous"
  | "automatic_retry"
  | "manual_retry"
  | "admin_block"
  | "admin_resume"
  | "cancel";

const RUN_TRANSITIONS: Readonly<
  Partial<Record<UnifiedRunStatus, Partial<Record<UnifiedRunEvent, UnifiedRunStatus>>>>
> = {
  RUNNING: {
    provider_wait: "WAITING_FOR_PROVIDER",
    admin_block: "BLOCKED_ADMIN",
    begin_finalizing: "FINALIZING",
    fail_technical: "FAILED_TECHNICAL"
  },
  WAITING_FOR_PROVIDER: {
    provider_ready: "RUNNING",
    admin_block: "BLOCKED_ADMIN",
    fail_technical: "FAILED_TECHNICAL"
  },
  BLOCKED_ADMIN: {
    admin_resume: "RUNNING",
    fail_technical: "FAILED_TECHNICAL"
  },
  FINALIZING: {
    commit_completed: "COMPLETED",
    fail_technical: "FAILED_TECHNICAL"
  }
};

const BRANCH_TRANSITIONS: Readonly<
  Partial<
    Record<
      UnifiedBranchStatus,
      Partial<Record<UnifiedBranchEvent, UnifiedBranchStatus>>
    >
  >
> = {
  RUNNING: {
    complete: "COMPLETED",
    not_applicable: "NOT_APPLICABLE",
    retry_wait: "WAITING_RETRY",
    admin_block: "BLOCKED_ADMIN",
    fail_technical: "FAILED_TECHNICAL"
  },
  WAITING_RETRY: {
    retry_ready: "RUNNING",
    admin_block: "BLOCKED_ADMIN",
    fail_technical: "FAILED_TECHNICAL"
  },
  BLOCKED_ADMIN: {
    admin_resume: "RUNNING",
    fail_technical: "FAILED_TECHNICAL"
  }
};

const DELIVERY_TRANSITIONS: Readonly<
  Partial<
    Record<
      UnifiedDeliveryStatus,
      Partial<Record<UnifiedDeliveryEvent, UnifiedDeliveryStatus>>
    >
  >
> = {
  PENDING: { lease: "LEASED", admin_block: "BLOCKED_ADMIN", cancel: "CANCELLED" },
  LEASED: {
    transport_retryable: "RETRYABLE",
    transport_confirmed: "SENT_CONFIRMED",
    transport_ambiguous: "DELIVERY_UNKNOWN",
    admin_block: "BLOCKED_ADMIN"
  },
  RETRYABLE: {
    retry: "PENDING",
    admin_block: "BLOCKED_ADMIN",
    cancel: "CANCELLED"
  },
  DELIVERY_UNKNOWN: { manual_retry: "PENDING" },
  BLOCKED_ADMIN: { admin_resume: "PENDING", cancel: "CANCELLED" }
};

export function transitionRun(
  status: UnifiedRunStatus,
  event: UnifiedRunEvent,
  completion?: {
    finalScore: number | null;
    finalDecision: "ACCEPTABLE" | "REVIEW" | "DECLINE" | null;
    evidenceBundleHash: string | null;
    reportHash: string | null;
    traversalClosureHash: string | null;
    scoringBundleHash: string | null;
  }
): UnifiedRunStatus {
  const hash = /^[0-9a-f]{64}$/u;
  if (
    event === "commit_completed" &&
    (completion === undefined ||
      !Number.isInteger(completion.finalScore) ||
      (completion.finalScore as number) < 0 ||
      (completion.finalScore as number) > 100 ||
      !completion.finalDecision ||
      !hash.test(completion.evidenceBundleHash ?? "") ||
      !hash.test(completion.reportHash ?? "") ||
      !hash.test(completion.traversalClosureHash ?? "") ||
      !hash.test(completion.scoringBundleHash ?? ""))
  ) {
    throw new Error("unified_completion_contract_invalid");
  }
  const next = RUN_TRANSITIONS[status]?.[event];
  if (next === undefined) throw new Error("unified_run_transition_invalid");
  return next;
}

export function transitionBranch(
  status: UnifiedBranchStatus,
  event: UnifiedBranchEvent
): UnifiedBranchStatus {
  const next = BRANCH_TRANSITIONS[status]?.[event];
  if (next === undefined) throw new Error("unified_branch_transition_invalid");
  return next;
}

export function transitionDelivery(
  status: UnifiedDeliveryStatus,
  event: UnifiedDeliveryEvent
): UnifiedDeliveryStatus {
  if (status === "DELIVERY_UNKNOWN" && event === "automatic_retry") {
    throw new Error("unified_delivery_unknown_manual_only");
  }
  const next = DELIVERY_TRANSITIONS[status]?.[event];
  if (next === undefined) throw new Error("unified_delivery_transition_invalid");
  return next;
}
