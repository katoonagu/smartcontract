import type { RiskSignalObservationInput, ScoringRiskSignalGroup } from "../types";

const scoringRiskSignalGroups = new Set<ScoringRiskSignalGroup>([
  "internal_label",
  "provider",
  "graph",
  "behavior",
  "incoming_context",
  "approval",
  "manual"
]);

export function isAmlRiskSignalObservation(
  observation: RiskSignalObservationInput
): observation is RiskSignalObservationInput & { signalGroup: ScoringRiskSignalGroup } {
  return scoringRiskSignalGroups.has(observation.signalGroup as ScoringRiskSignalGroup);
}

export function filterAmlRiskSignalObservations(
  observations: readonly RiskSignalObservationInput[]
): Array<RiskSignalObservationInput & { signalGroup: ScoringRiskSignalGroup }> {
  return observations.filter(isAmlRiskSignalObservation);
}
