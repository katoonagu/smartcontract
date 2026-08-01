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

  it("does not downgrade service guarded state on incomplete later observations", () => {
    expect(nextApprovalState({
      current: "service_route_guarded",
      approvalObserved: true,
      transferFromObserved: false,
      serviceRouteGuarded: false,
      pathToCheckedWallet: false
    })).toBe("service_route_guarded");
  });

  it("does not downgrade route linked state to transferFrom observed", () => {
    expect(nextApprovalState({
      current: "route_linked",
      approvalObserved: true,
      transferFromObserved: true,
      serviceRouteGuarded: false,
      pathToCheckedWallet: false
    })).toBe("route_linked");
  });

  it("does not downgrade exact provenance unless approval disappears", () => {
    expect(nextApprovalState({
      current: "proven_approval_drain_provenance",
      approvalObserved: true,
      transferFromObserved: false,
      serviceRouteGuarded: false,
      pathToCheckedWallet: false
    })).toBe("proven_approval_drain_provenance");

    expect(nextApprovalState({
      current: "proven_approval_drain_provenance",
      approvalObserved: false,
      transferFromObserved: false,
      serviceRouteGuarded: false,
      pathToCheckedWallet: false
    })).toBe("none");
  });
});
