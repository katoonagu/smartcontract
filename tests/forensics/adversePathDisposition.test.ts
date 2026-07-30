import { describe, expect, it } from "vitest";
import {
  ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1,
  decideAdversePathDispositionV1,
  type AdversePathDispositionInputV1,
  type ExactAdverseEndpointAuthorityClassV1,
  type ExactBoundLeadAuthorityClassV1,
  type ExactBoundLeadInputV1,
  type ExactEndpointSafetyInputV1,
  type SelectedAmountRelevanceInputV1
} from "../../src/forensics/adversePathDisposition.js";

const POLICY_VERSION = ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1;

function exactEndpointSafety(
  authorityClass: ExactAdverseEndpointAuthorityClassV1 = "event_time_restricted_endpoint",
  endpointBindingComplete = true
): ExactEndpointSafetyInputV1 {
  return {
    policyVersion: POLICY_VERSION,
    purpose: "safety",
    evidenceKind: "exact_adverse_endpoint",
    authorityClass,
    endpointBindingComplete
  };
}

function exactBoundLead(
  authorityClass: ExactBoundLeadAuthorityClassV1 = "confirmed_approval_lead",
  boundEventIds: readonly string[] = ["event:bound"],
  leadBindingComplete = true
): ExactBoundLeadInputV1 {
  return {
    policyVersion: POLICY_VERSION,
    purpose: "path_continuation",
    evidenceKind: "exact_bound_lead",
    authorityClass,
    leadBindingComplete,
    continuationAddress: "TExactLinkedEndpoint",
    boundEventIds
  };
}

function selectedAmountRelevance(
  knownIntermediateEventIds: readonly string[] = ["event:middle"],
  endpointBindingComplete = true,
  relevanceBindingComplete = true
): SelectedAmountRelevanceInputV1 {
  return {
    policyVersion: POLICY_VERSION,
    purpose: "selected_amount_relevance",
    evidenceKind: "exact_adverse_endpoint",
    authorityClass: "tracked_drainer_endpoint",
    endpointBindingComplete,
    relevanceBindingComplete,
    knownIntermediateEventIds
  };
}

describe("adverse path disposition v1", () => {
  it.each<readonly [string, ExactAdverseEndpointAuthorityClassV1]>([
    ["event-time blacklist", "event_time_blacklist_endpoint"],
    ["event-time sanctions", "event_time_sanctions_endpoint"],
    ["event-time restricted service", "event_time_restricted_endpoint"],
    ["exact HTX", "exact_htx_endpoint"],
    ["tracked drainer", "tracked_drainer_endpoint"],
    ["tracked collector", "tracked_collector_endpoint"],
    ["confirmed harmful endpoint", "confirmed_harmful_endpoint"],
    [
      "confirmed Verify20 fingerprint with a successful matching USDT transfer",
      "confirmed_verify20_usdt_scene"
    ]
  ])("makes an exact %s terminal red", (_label, authorityClass) => {
    const result = decideAdversePathDispositionV1(exactEndpointSafety(authorityClass));

    expect(result).toEqual({
      policyVersion: POLICY_VERSION,
      disposition: "terminal_red",
      reason: "exact_adverse_endpoint"
    });
    expect(Object.keys(result).sort()).toEqual([
      "disposition",
      "policyVersion",
      "reason"
    ]);
  });

  it("keeps a method-name-only Verify20 hint unresolved", () => {
    const result = decideAdversePathDispositionV1({
      policyVersion: POLICY_VERSION,
      purpose: "safety",
      evidenceKind: "unconfirmed_hint",
      authorityClass: "verify20_method_name_only"
    });

    expect(result).toEqual({
      policyVersion: POLICY_VERSION,
      disposition: "unresolved",
      reason: "unconfirmed_adverse_hint"
    });
    expect(Object.keys(result).sort()).toEqual([
      "disposition",
      "policyVersion",
      "reason"
    ]);
  });

  it.each<readonly [string, ExactBoundLeadAuthorityClassV1]>([
    ["approval", "confirmed_approval_lead"],
    ["transferFrom", "confirmed_transfer_from_lead"],
    ["proxy", "confirmed_proxy_lead"],
    ["drainer pattern", "confirmed_drainer_pattern_lead"],
    ["Verify-like non-terminal pattern", "confirmed_verify_like_lead"]
  ])("continues only an exact-bound %s lead", (_label, authorityClass) => {
    const result = decideAdversePathDispositionV1(exactBoundLead(
      authorityClass,
      ["event:z", "event:a", "event:z"]
    ));

    expect(result).toEqual({
      policyVersion: POLICY_VERSION,
      disposition: "continue_exact_path",
      reason: "exact_bound_adverse_lead",
      continuationAddress: "TExactLinkedEndpoint",
      boundEventIds: ["event:a", "event:z"]
    });
  });

  it("uses only known intermediate events for selected-amount relevance", () => {
    const result = decideAdversePathDispositionV1(selectedAmountRelevance([
      "event:middle-2",
      "event:middle-1",
      "event:middle-2"
    ]));

    expect(result).toEqual({
      policyVersion: POLICY_VERSION,
      disposition: "cashflow_relevance_only",
      reason: "selected_amount_relevance_for_exact_terminal",
      knownIntermediateEventIds: ["event:middle-1", "event:middle-2"]
    });
    expect(result).not.toHaveProperty("continuationAddress");
    expect(result).not.toHaveProperty("boundEventIds");
  });

  it("rejects endpoint continuation fields on selected-amount relevance", () => {
    const impossibleInput: AdversePathDispositionInputV1 = {
      policyVersion: POLICY_VERSION,
      purpose: "selected_amount_relevance",
      evidenceKind: "exact_adverse_endpoint",
      authorityClass: "tracked_drainer_endpoint",
      endpointBindingComplete: true,
      relevanceBindingComplete: true,
      knownIntermediateEventIds: ["event:middle"],
      // @ts-expect-error selected-amount relevance cannot carry an endpoint continuation address
      continuationAddress: "TEndpointMustNotExpand"
    };

    const result = decideAdversePathDispositionV1(impossibleInput);

    expect(result).toEqual({
      policyVersion: POLICY_VERSION,
      disposition: "unresolved",
      reason: "input_fields_invalid"
    });
    expect(result).not.toHaveProperty("continuationAddress");
    expect(result).not.toHaveProperty("boundEventIds");
    expect(result).not.toHaveProperty("knownIntermediateEventIds");
  });

  it.each([
    {
      label: "incomplete exact endpoint binding",
      value: exactEndpointSafety("tracked_drainer_endpoint", false),
      reason: "endpoint_binding_incomplete"
    },
    {
      label: "incomplete terminal binding for relevance",
      value: selectedAmountRelevance(["event:middle"], false, true),
      reason: "endpoint_binding_incomplete"
    },
    {
      label: "incomplete selected-amount binding",
      value: selectedAmountRelevance(["event:middle"], true, false),
      reason: "selected_amount_binding_incomplete"
    },
    {
      label: "missing known intermediate events",
      value: selectedAmountRelevance([]),
      reason: "selected_amount_events_missing"
    },
    {
      label: "incomplete lead binding",
      value: exactBoundLead("confirmed_approval_lead", ["event:bound"], false),
      reason: "lead_binding_incomplete"
    }
  ])("fails closed for $label", ({ value, reason }) => {
    const result = decideAdversePathDispositionV1(value);

    expect(result).toEqual({
      policyVersion: POLICY_VERSION,
      disposition: "unresolved",
      reason
    });
    expect(Object.keys(result).sort()).toEqual([
      "disposition",
      "policyVersion",
      "reason"
    ]);
  });

  it("fails closed when an exact-bound lead lacks its address or event binding", () => {
    const result = decideAdversePathDispositionV1({
      ...exactBoundLead(),
      continuationAddress: "",
      boundEventIds: []
    });

    expect(result).toEqual({
      policyVersion: POLICY_VERSION,
      disposition: "unresolved",
      reason: "continuation_binding_missing"
    });
  });

  it.each([
    {
      label: "sparse bound lead events",
      value: exactBoundLead("confirmed_approval_lead", new Array<string>(1)),
      reason: "continuation_binding_missing"
    },
    {
      label: "sparse known intermediate events",
      value: selectedAmountRelevance(new Array<string>(1)),
      reason: "selected_amount_events_missing"
    }
  ])("fails closed for $label", ({ value, reason }) => {
    expect(decideAdversePathDispositionV1(value)).toEqual({
      policyVersion: POLICY_VERSION,
      disposition: "unresolved",
      reason
    });
  });

  it.each(["recorded_calibration_vector", "future_authority_class"])(
    "does not promote unknown authority class %s to exact evidence",
    (authorityClass) => {
      const result = decideAdversePathDispositionV1({
        ...exactEndpointSafety(),
        authorityClass
      } as unknown as AdversePathDispositionInputV1);

      expect(result).toEqual({
        policyVersion: POLICY_VERSION,
        disposition: "unresolved",
        reason: "unknown_authority_class"
      });
    }
  );

  it("fails closed for an unknown input variant", () => {
    const result = decideAdversePathDispositionV1({
      policyVersion: POLICY_VERSION,
      purpose: "future_purpose",
      evidenceKind: "future_evidence"
    } as unknown as AdversePathDispositionInputV1);

    expect(result).toEqual({
      policyVersion: POLICY_VERSION,
      disposition: "unresolved",
      reason: "unknown_input_variant"
    });
  });

  it("fails closed for an unsupported policy version", () => {
    const result = decideAdversePathDispositionV1({
      ...exactEndpointSafety(),
      policyVersion: "provenance-adverse-terminal-matrix-v2"
    } as unknown as AdversePathDispositionInputV1);

    expect(result).toEqual({
      policyVersion: POLICY_VERSION,
      disposition: "unresolved",
      reason: "unsupported_policy_version"
    });
  });

  it("is deterministic and does not mutate caller event IDs", () => {
    const boundEventIds = ["event:z", "event:a", "event:z"];
    const knownIntermediateEventIds = ["event:middle-z", "event:middle-a"];
    const lead = exactBoundLead("confirmed_proxy_lead", boundEventIds);
    const relevance = selectedAmountRelevance(knownIntermediateEventIds);

    expect(decideAdversePathDispositionV1(lead)).toEqual(
      decideAdversePathDispositionV1(lead)
    );
    expect(decideAdversePathDispositionV1(relevance)).toEqual(
      decideAdversePathDispositionV1(relevance)
    );
    expect(boundEventIds).toEqual(["event:z", "event:a", "event:z"]);
    expect(knownIntermediateEventIds).toEqual(["event:middle-z", "event:middle-a"]);
  });
});
