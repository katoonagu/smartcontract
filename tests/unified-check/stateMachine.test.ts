import { describe, expect, it } from "vitest";
import {
  transitionBranch,
  transitionDelivery,
  transitionRun
} from "../../src/unifiedCheck/stateMachine";

describe("Unified Check lifecycle", () => {
  it.each([
    ["RUNNING", "provider_wait", "WAITING_FOR_PROVIDER"],
    ["WAITING_FOR_PROVIDER", "provider_ready", "RUNNING"],
    ["RUNNING", "admin_block", "BLOCKED_ADMIN"],
    ["BLOCKED_ADMIN", "admin_resume", "RUNNING"],
    ["RUNNING", "begin_finalizing", "FINALIZING"],
    ["FINALIZING", "commit_completed", "COMPLETED"],
    ["RUNNING", "fail_technical", "FAILED_TECHNICAL"]
  ] as const)("%s + %s -> %s", (from, event, expected) => {
    expect(transitionRun(from, event)).toBe(expected);
  });

  it("rejects a completed run without the final artifact set", () => {
    expect(() =>
      transitionRun("FINALIZING", "commit_completed", {
        finalScore: null,
        reportHash: null,
        traversalClosureHash: null
      })
    ).toThrow("unified_completion_contract_invalid");
  });

  it("closes branches without inventing a result for technical failure", () => {
    expect(transitionBranch("RUNNING", "complete")).toBe("COMPLETED");
    expect(transitionBranch("RUNNING", "not_applicable")).toBe(
      "NOT_APPLICABLE"
    );
    expect(transitionBranch("RUNNING", "fail_technical")).toBe(
      "FAILED_TECHNICAL"
    );
    expect(() => transitionBranch("COMPLETED", "complete")).toThrow(
      "unified_branch_transition_invalid"
    );
  });

  it("keeps ambiguous delivery terminal for automatic sending", () => {
    expect(transitionDelivery("LEASED", "transport_ambiguous")).toBe(
      "DELIVERY_UNKNOWN"
    );
    expect(() =>
      transitionDelivery("DELIVERY_UNKNOWN", "automatic_retry")
    ).toThrow("unified_delivery_unknown_manual_only");
    expect(transitionDelivery("DELIVERY_UNKNOWN", "manual_retry")).toBe(
      "PENDING"
    );
  });
});
