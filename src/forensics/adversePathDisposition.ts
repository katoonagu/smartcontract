export const ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1 =
  "provenance-adverse-terminal-matrix-v1" as const;

export type AdverseAuthorityClassV1 =
  | "event_time_blacklist_endpoint"
  | "event_time_sanctions_endpoint"
  | "event_time_restricted_endpoint"
  | "restricted_exchange_endpoint"
  | "tracked_drainer_endpoint"
  | "tracked_collector_endpoint"
  | "confirmed_harmful_endpoint"
  | "approval_or_verify_pattern";

export type AdversePathDispositionInputV1 = {
  readonly policyVersion: typeof ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1;
  readonly authorityClass: AdverseAuthorityClassV1;
  readonly endpointIdentity: "exact" | "lead" | "missing";
  readonly eventBindingComplete: boolean;
  readonly selectedAmountRelevanceRequested: boolean;
  readonly continuationAddress?: string;
  readonly continuationEventIds: readonly string[];
};

export type AdversePathDispositionUnresolvedReasonV1 =
  | "unsupported_policy_version"
  | "unknown_authority_class"
  | "event_binding_incomplete"
  | "selected_amount_relevance_flag_invalid"
  | "exact_endpoint_binding_missing"
  | "lead_endpoint_binding_missing"
  | "continuation_binding_missing"
  | "cashflow_relevance_binding_missing";

export type AdversePathDispositionV1 =
  | {
      readonly policyVersion: typeof ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1;
      readonly disposition: "terminal_red";
      readonly reason: "exact_adverse_endpoint";
    }
  | {
      readonly policyVersion: typeof ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1;
      readonly disposition: "continue_exact_path";
      readonly reason: "exact_bound_adverse_lead";
      readonly continuationAddress: string;
      readonly continuationEventIds: readonly string[];
    }
  | {
      readonly policyVersion: typeof ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1;
      readonly disposition: "cashflow_relevance_only";
      readonly reason: "selected_amount_relevance_for_exact_terminal";
      readonly relevanceEventIds: readonly string[];
    }
  | {
      readonly policyVersion: typeof ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1;
      readonly disposition: "unresolved";
      readonly reason: AdversePathDispositionUnresolvedReasonV1;
    };

const TERMINAL_AUTHORITY_CLASSES: ReadonlySet<AdverseAuthorityClassV1> = new Set([
  "event_time_blacklist_endpoint",
  "event_time_sanctions_endpoint",
  "event_time_restricted_endpoint",
  "restricted_exchange_endpoint",
  "tracked_drainer_endpoint",
  "tracked_collector_endpoint",
  "confirmed_harmful_endpoint"
]);

function isAuthorityClass(value: unknown): value is AdverseAuthorityClassV1 {
  return value === "approval_or_verify_pattern" || TERMINAL_AUTHORITY_CLASSES.has(
    value as AdverseAuthorityClassV1
  );
}

function exactIdentifiers(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.some((item) =>
    typeof item !== "string" || item.length === 0 || item.trim() !== item
  )) return null;
  return [...new Set<string>(value)].sort();
}

function unresolved(
  reason: AdversePathDispositionUnresolvedReasonV1
): AdversePathDispositionV1 {
  return {
    policyVersion: ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1,
    disposition: "unresolved",
    reason
  };
}

export function decideAdversePathDispositionV1(
  input: AdversePathDispositionInputV1
): AdversePathDispositionV1 {
  if (input.policyVersion !== ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1) {
    return unresolved("unsupported_policy_version");
  }
  if (!isAuthorityClass(input.authorityClass)) {
    return unresolved("unknown_authority_class");
  }
  if (input.eventBindingComplete !== true) {
    return unresolved("event_binding_incomplete");
  }
  if (typeof input.selectedAmountRelevanceRequested !== "boolean") {
    return unresolved("selected_amount_relevance_flag_invalid");
  }

  if (TERMINAL_AUTHORITY_CLASSES.has(input.authorityClass)) {
    if (input.endpointIdentity !== "exact") {
      return unresolved("exact_endpoint_binding_missing");
    }
    if (!input.selectedAmountRelevanceRequested) {
      return {
        policyVersion: ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1,
        disposition: "terminal_red",
        reason: "exact_adverse_endpoint"
      };
    }

    const relevanceEventIds = exactIdentifiers(input.continuationEventIds);
    if (relevanceEventIds === null || relevanceEventIds.length === 0) {
      return unresolved("cashflow_relevance_binding_missing");
    }
    return {
      policyVersion: ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1,
      disposition: "cashflow_relevance_only",
      reason: "selected_amount_relevance_for_exact_terminal",
      relevanceEventIds
    };
  }

  if (input.endpointIdentity !== "lead") {
    return unresolved("lead_endpoint_binding_missing");
  }
  const continuationEventIds = exactIdentifiers(input.continuationEventIds);
  if (
    typeof input.continuationAddress !== "string" ||
    input.continuationAddress.length === 0 ||
    input.continuationAddress.trim() !== input.continuationAddress ||
    continuationEventIds === null ||
    continuationEventIds.length === 0
  ) {
    return unresolved("continuation_binding_missing");
  }
  return {
    policyVersion: ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1,
    disposition: "continue_exact_path",
    reason: "exact_bound_adverse_lead",
    continuationAddress: input.continuationAddress,
    continuationEventIds
  };
}
