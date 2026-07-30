import { describe, expect, it } from "vitest";
import {
  ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1,
  decideAdversePathDispositionV1,
  type AdverseAuthorityClassV1,
  type AdversePathDispositionInputV1
} from "../../src/forensics/adversePathDisposition.js";

const baseInput: AdversePathDispositionInputV1 = {
  policyVersion: ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1,
  authorityClass: "event_time_restricted_endpoint",
  endpointIdentity: "exact",
  eventBindingComplete: true,
  selectedAmountRelevanceRequested: false,
  continuationEventIds: []
};

function input(
  overrides: Partial<AdversePathDispositionInputV1>
): AdversePathDispositionInputV1 {
  return { ...baseInput, ...overrides };
}

describe("adverse path disposition v1", () => {
  it.each<readonly [string, AdverseAuthorityClassV1]>([
    ["event-time blacklist", "event_time_blacklist_endpoint"],
    ["event-time sanctions", "event_time_sanctions_endpoint"],
    ["event-time restricted service", "event_time_restricted_endpoint"],
    ["HTX/restricted exchange", "restricted_exchange_endpoint"],
    ["tracked drainer", "tracked_drainer_endpoint"],
    ["tracked collector", "tracked_collector_endpoint"],
    ["confirmed harmful endpoint", "confirmed_harmful_endpoint"]
  ])("makes an exact %s endpoint terminal red", (_label, authorityClass) => {
    const result = decideAdversePathDispositionV1(input({
      authorityClass,
      continuationAddress: "TExactEndpointMustNotExpand",
      continuationEventIds: ["event:ignored"]
    }));

    expect(result).toEqual({
      policyVersion: ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1,
      disposition: "terminal_red",
      reason: "exact_adverse_endpoint"
    });
    expect(Object.keys(result).sort()).toEqual([
      "disposition",
      "policyVersion",
      "reason"
    ]);
  });

  it("continues only the exact address and events bound to an approval/Verify lead", () => {
    const result = decideAdversePathDispositionV1(input({
      authorityClass: "approval_or_verify_pattern",
      endpointIdentity: "lead",
      continuationAddress: "TExactLinkedCollector",
      continuationEventIds: ["event:z", "event:a", "event:z"]
    }));

    expect(result).toEqual({
      policyVersion: ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1,
      disposition: "continue_exact_path",
      reason: "exact_bound_adverse_lead",
      continuationAddress: "TExactLinkedCollector",
      continuationEventIds: ["event:a", "event:z"]
    });
  });

  it("uses only known intermediate event IDs for selected-amount relevance", () => {
    const result = decideAdversePathDispositionV1(input({
      selectedAmountRelevanceRequested: true,
      continuationAddress: "TTerminalEndpointMustNotOpen",
      continuationEventIds: ["event:middle-2", "event:middle-1", "event:middle-2"]
    }));

    expect(result).toEqual({
      policyVersion: ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1,
      disposition: "cashflow_relevance_only",
      reason: "selected_amount_relevance_for_exact_terminal",
      relevanceEventIds: ["event:middle-1", "event:middle-2"]
    });
    expect(result).not.toHaveProperty("continuationAddress");
    expect(result).not.toHaveProperty("continuationEventIds");
  });

  it.each([
    {
      label: "incomplete event evidence",
      overrides: { eventBindingComplete: false },
      reason: "event_binding_incomplete"
    },
    {
      label: "missing exact endpoint identity",
      overrides: { endpointIdentity: "missing" as const },
      reason: "exact_endpoint_binding_missing"
    },
    {
      label: "terminal authority supplied only as a lead",
      overrides: { endpointIdentity: "lead" as const },
      reason: "exact_endpoint_binding_missing"
    },
    {
      label: "lead without an exact next address",
      overrides: {
        authorityClass: "approval_or_verify_pattern" as const,
        endpointIdentity: "lead" as const,
        continuationEventIds: ["event:bound"]
      },
      reason: "continuation_binding_missing"
    },
    {
      label: "lead without an exact bound event",
      overrides: {
        authorityClass: "approval_or_verify_pattern" as const,
        endpointIdentity: "lead" as const,
        continuationAddress: "TExactLinkedCollector"
      },
      reason: "continuation_binding_missing"
    },
    {
      label: "selected amount without known intermediate events",
      overrides: { selectedAmountRelevanceRequested: true },
      reason: "cashflow_relevance_binding_missing"
    }
  ])("fails closed for $label", ({ overrides, reason }) => {
    const result = decideAdversePathDispositionV1(input(overrides));

    expect(result).toEqual({
      policyVersion: ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1,
      disposition: "unresolved",
      reason
    });
    expect(result).not.toHaveProperty("continuationAddress");
    expect(result).not.toHaveProperty("continuationEventIds");
    expect(result).not.toHaveProperty("relevanceEventIds");
  });

  it.each(["recorded_calibration_vector", "future_authority_class"])(
    "does not promote unknown authority class %s to exact evidence",
    (authorityClass) => {
      const result = decideAdversePathDispositionV1({
        ...baseInput,
        authorityClass
      } as unknown as AdversePathDispositionInputV1);

      expect(result).toEqual({
        policyVersion: ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1,
        disposition: "unresolved",
        reason: "unknown_authority_class"
      });
    }
  );

  it("fails closed for an unsupported policy version", () => {
    const result = decideAdversePathDispositionV1({
      ...baseInput,
      policyVersion: "provenance-adverse-terminal-matrix-v2"
    } as unknown as AdversePathDispositionInputV1);

    expect(result).toEqual({
      policyVersion: ADVERSE_PATH_DISPOSITION_POLICY_VERSION_V1,
      disposition: "unresolved",
      reason: "unsupported_policy_version"
    });
  });

  it("is deterministic and does not mutate caller event IDs", () => {
    const continuationEventIds = ["event:z", "event:a", "event:z"];
    const value = input({
      authorityClass: "approval_or_verify_pattern",
      endpointIdentity: "lead",
      continuationAddress: "TExactLinkedCollector",
      continuationEventIds
    });

    expect(decideAdversePathDispositionV1(value)).toEqual(
      decideAdversePathDispositionV1(value)
    );
    expect(continuationEventIds).toEqual(["event:z", "event:a", "event:z"]);
  });
});
