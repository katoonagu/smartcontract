export type ApprovalMonitoringState =
  | "none"
  | "approval_only"
  | "transfer_from_observed"
  | "service_route_guarded"
  | "route_linked"
  | "proven_approval_drain_provenance";

export function nextApprovalState(input: {
  current: ApprovalMonitoringState;
  approvalObserved: boolean;
  transferFromObserved: boolean;
  serviceRouteGuarded: boolean;
  pathToCheckedWallet: boolean;
}): ApprovalMonitoringState {
  if (!input.approvalObserved) return "none";

  const next = classifyApprovalState(input);
  return stateRank(next) > stateRank(input.current) ? next : input.current;
}

function classifyApprovalState(input: {
  transferFromObserved: boolean;
  serviceRouteGuarded: boolean;
  pathToCheckedWallet: boolean;
}): ApprovalMonitoringState {
  if (!input.transferFromObserved) return "approval_only";
  if (input.serviceRouteGuarded) return "service_route_guarded";
  if (input.pathToCheckedWallet) return "proven_approval_drain_provenance";
  return "transfer_from_observed";
}

function stateRank(state: ApprovalMonitoringState): number {
  switch (state) {
    case "none":
      return 0;
    case "approval_only":
      return 1;
    case "transfer_from_observed":
      return 2;
    case "service_route_guarded":
      return 3;
    case "route_linked":
      return 4;
    case "proven_approval_drain_provenance":
      return 5;
  }
}
