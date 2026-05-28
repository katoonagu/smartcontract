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
  if (!input.transferFromObserved) return "approval_only";
  if (input.serviceRouteGuarded) return "service_route_guarded";
  if (input.pathToCheckedWallet) return "proven_approval_drain_provenance";
  return "transfer_from_observed";
}
