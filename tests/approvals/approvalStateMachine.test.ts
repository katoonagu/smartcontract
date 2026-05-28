import { describe, expect, it } from "vitest";
import { nextApprovalState } from "../../src/approvals/approvalStateMachine";

describe("approval state machine", () => {
  it("keeps approval-only unknown spender below exact proof", () => {
    expect(nextApprovalState({
      current: "none",
      approvalObserved: true,
      transferFromObserved: false,
      serviceRouteGuarded: false,
      pathToCheckedWallet: false
    })).toBe("approval_only");
  });

  it("guards known service route after transferFrom", () => {
    expect(nextApprovalState({
      current: "approval_only",
      approvalObserved: true,
      transferFromObserved: true,
      serviceRouteGuarded: true,
      pathToCheckedWallet: false
    })).toBe("service_route_guarded");
  });

  it("promotes matching path to exact provenance only without service boundary", () => {
    expect(nextApprovalState({
      current: "transfer_from_observed",
      approvalObserved: true,
      transferFromObserved: true,
      serviceRouteGuarded: false,
      pathToCheckedWallet: true
    })).toBe("proven_approval_drain_provenance");
  });
});
