export const ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1 =
  "provenance-adverse-terminal-matrix-v1" as const;

export type ExactAdverseEndpointAuthorityClassV1 =
  | "event_time_blacklist_endpoint"
  | "event_time_sanctions_endpoint"
  | "event_time_restricted_endpoint"
  | "exact_htx_endpoint"
  | "exact_restricted_exchange_endpoint"
  | "tracked_drainer_endpoint"
  | "tracked_collector_endpoint"
  | "confirmed_harmful_endpoint"
  | "confirmed_verify20_usdt_scene";

export type ExactBoundLeadAuthorityClassV1 =
  | "confirmed_approval_lead"
  | "confirmed_transfer_from_lead"
  | "confirmed_proxy_lead"
  | "confirmed_drainer_pattern_lead"
  | "confirmed_verify_like_lead";

export type UnconfirmedAdverseHintClassV1 =
  | "verify20_method_name_only"
  | "unconfirmed_pattern";

export type ExactEndpointSafetyInputV1 = {
  readonly policyVersion: typeof ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1;
  readonly purpose: "safety";
  readonly evidenceKind: "exact_adverse_endpoint";
  readonly authorityClass: ExactAdverseEndpointAuthorityClassV1;
  readonly endpointBindingComplete: boolean;
};

export type SelectedAmountRelevanceInputV1 = {
  readonly policyVersion: typeof ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1;
  readonly purpose: "selected_amount_relevance";
  readonly evidenceKind: "exact_adverse_endpoint";
  readonly authorityClass: ExactAdverseEndpointAuthorityClassV1;
  readonly endpointBindingComplete: boolean;
  readonly relevanceBindingComplete: boolean;
  readonly knownIntermediateEventIds: readonly string[];
};

export type ExactBoundLeadInputV1 = {
  readonly policyVersion: typeof ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1;
  readonly purpose: "path_continuation";
  readonly evidenceKind: "exact_bound_lead";
  readonly authorityClass: ExactBoundLeadAuthorityClassV1;
  readonly leadBindingComplete: boolean;
  readonly continuationAddress: string;
  readonly boundEventIds: readonly string[];
};

export type UnconfirmedAdverseHintInputV1 = {
  readonly policyVersion: typeof ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1;
  readonly purpose: "safety";
  readonly evidenceKind: "unconfirmed_hint";
  readonly authorityClass: UnconfirmedAdverseHintClassV1;
};

export type AdversePathDispositionInputV1 =
  | ExactEndpointSafetyInputV1
  | SelectedAmountRelevanceInputV1
  | ExactBoundLeadInputV1
  | UnconfirmedAdverseHintInputV1;

export type AdversePathDispositionUnresolvedReasonV1 =
  | "unsupported_policy_version"
  | "unknown_input_variant"
  | "input_fields_invalid"
  | "unknown_authority_class"
  | "endpoint_binding_incomplete"
  | "selected_amount_binding_incomplete"
  | "selected_amount_events_missing"
  | "lead_binding_incomplete"
  | "continuation_binding_missing"
  | "unconfirmed_adverse_hint";

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
      readonly boundEventIds: readonly string[];
    }
  | {
      readonly policyVersion: typeof ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1;
      readonly disposition: "cashflow_relevance_only";
      readonly reason: "selected_amount_relevance_for_exact_terminal";
      readonly knownIntermediateEventIds: readonly string[];
    }
  | {
      readonly policyVersion: typeof ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1;
      readonly disposition: "unresolved";
      readonly reason: AdversePathDispositionUnresolvedReasonV1;
    };

const EXACT_ENDPOINT_AUTHORITIES: ReadonlySet<ExactAdverseEndpointAuthorityClassV1> =
  new Set([
    "event_time_blacklist_endpoint",
    "event_time_sanctions_endpoint",
    "event_time_restricted_endpoint",
    "exact_htx_endpoint",
    "exact_restricted_exchange_endpoint",
    "tracked_drainer_endpoint",
    "tracked_collector_endpoint",
    "confirmed_harmful_endpoint",
    "confirmed_verify20_usdt_scene"
  ]);

const EXACT_LEAD_AUTHORITIES: ReadonlySet<ExactBoundLeadAuthorityClassV1> = new Set([
  "confirmed_approval_lead",
  "confirmed_transfer_from_lead",
  "confirmed_proxy_lead",
  "confirmed_drainer_pattern_lead",
  "confirmed_verify_like_lead"
]);

const UNCONFIRMED_HINTS: ReadonlySet<UnconfirmedAdverseHintClassV1> = new Set([
  "verify20_method_name_only",
  "unconfirmed_pattern"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactOwnKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function exactIdentifiers(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const identifiers: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return null;
    const item: unknown = value[index];
    if (typeof item !== "string" || item.length === 0 || item.trim() !== item) return null;
    identifiers.push(item);
  }
  return [...new Set(identifiers)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
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
  if (!isRecord(input)) return unresolved("unknown_input_variant");
  if (input.policyVersion !== ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1) {
    return unresolved("unsupported_policy_version");
  }

  if (input.purpose === "safety" && input.evidenceKind === "exact_adverse_endpoint") {
    if (!hasExactOwnKeys(input, [
      "policyVersion",
      "purpose",
      "evidenceKind",
      "authorityClass",
      "endpointBindingComplete"
    ])) return unresolved("input_fields_invalid");
    if (!EXACT_ENDPOINT_AUTHORITIES.has(
      input.authorityClass as ExactAdverseEndpointAuthorityClassV1
    )) return unresolved("unknown_authority_class");
    if (input.endpointBindingComplete !== true) {
      return unresolved("endpoint_binding_incomplete");
    }
    return {
      policyVersion: ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1,
      disposition: "terminal_red",
      reason: "exact_adverse_endpoint"
    };
  }

  if (
    input.purpose === "selected_amount_relevance" &&
    input.evidenceKind === "exact_adverse_endpoint"
  ) {
    if (!hasExactOwnKeys(input, [
      "policyVersion",
      "purpose",
      "evidenceKind",
      "authorityClass",
      "endpointBindingComplete",
      "relevanceBindingComplete",
      "knownIntermediateEventIds"
    ])) return unresolved("input_fields_invalid");
    if (!EXACT_ENDPOINT_AUTHORITIES.has(
      input.authorityClass as ExactAdverseEndpointAuthorityClassV1
    )) return unresolved("unknown_authority_class");
    if (input.endpointBindingComplete !== true) {
      return unresolved("endpoint_binding_incomplete");
    }
    if (input.relevanceBindingComplete !== true) {
      return unresolved("selected_amount_binding_incomplete");
    }
    const knownIntermediateEventIds = exactIdentifiers(input.knownIntermediateEventIds);
    if (knownIntermediateEventIds === null || knownIntermediateEventIds.length === 0) {
      return unresolved("selected_amount_events_missing");
    }
    return {
      policyVersion: ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1,
      disposition: "cashflow_relevance_only",
      reason: "selected_amount_relevance_for_exact_terminal",
      knownIntermediateEventIds
    };
  }

  if (input.purpose === "path_continuation" && input.evidenceKind === "exact_bound_lead") {
    if (!hasExactOwnKeys(input, [
      "policyVersion",
      "purpose",
      "evidenceKind",
      "authorityClass",
      "leadBindingComplete",
      "continuationAddress",
      "boundEventIds"
    ])) return unresolved("input_fields_invalid");
    if (!EXACT_LEAD_AUTHORITIES.has(
      input.authorityClass as ExactBoundLeadAuthorityClassV1
    )) return unresolved("unknown_authority_class");
    if (input.leadBindingComplete !== true) return unresolved("lead_binding_incomplete");
    const boundEventIds = exactIdentifiers(input.boundEventIds);
    if (
      typeof input.continuationAddress !== "string" ||
      input.continuationAddress.length === 0 ||
      input.continuationAddress.trim() !== input.continuationAddress ||
      boundEventIds === null ||
      boundEventIds.length === 0
    ) return unresolved("continuation_binding_missing");
    return {
      policyVersion: ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1,
      disposition: "continue_exact_path",
      reason: "exact_bound_adverse_lead",
      continuationAddress: input.continuationAddress,
      boundEventIds
    };
  }

  if (input.purpose === "safety" && input.evidenceKind === "unconfirmed_hint") {
    if (!hasExactOwnKeys(input, [
      "policyVersion",
      "purpose",
      "evidenceKind",
      "authorityClass"
    ])) return unresolved("input_fields_invalid");
    if (!UNCONFIRMED_HINTS.has(
      input.authorityClass as UnconfirmedAdverseHintClassV1
    )) return unresolved("unknown_authority_class");
    return unresolved("unconfirmed_adverse_hint");
  }

  return unresolved("unknown_input_variant");
}
