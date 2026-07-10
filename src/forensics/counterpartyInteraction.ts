import type {
  CounterpartyRiskDirection,
  CounterpartyRiskSnapshot,
  CounterpartyRiskSnapshotEvidenceClass,
  DirectCounterpartyInteractionProfile,
  ForensicRouteEdge,
  RiskLevel,
  ServiceClassification
} from "../types";
import { isGasFreeServiceFeeEdge } from "./gasFreeSettlement";

export type CounterpartySnapshotCandidate = {
  counterpartyAddress: string;
  volumeRaw: string;
  volumeRatio: number;
  txCount: number;
  snapshot: CounterpartyRiskSnapshot | null;
};

export type SelectCounterpartiesForFastSnapshotInput = {
  profiles: CounterpartySnapshotCandidate[];
  sparseWallet: boolean;
  maxSparse?: number;
  maxActive?: number;
  priorityAddresses?: string[];
};

export type BuildDirectCounterpartyInteractionProfilesInput = {
  subjectAddress: string;
  edges: ForensicRouteEdge[];
  snapshotsByAddress: Map<string, CounterpartyRiskSnapshot>;
  classifications?: Map<string, ServiceClassification | null>;
};

const ABSOLUTE_VOLUME_BOOST_RAW = 100_000_000_000n;

function parseAmount(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function emptySnapshot(address: string, classification: ServiceClassification | null): CounterpartyRiskSnapshot {
  const serviceCategory =
    classification?.isBoundary === true && classification.category !== "none"
      ? classification.category
      : null;
  if (serviceCategory !== null) {
    return {
      address,
      riskScore: 0,
      riskLevel: "LOW",
      source: "service_boundary",
      evidenceClass: "service_boundary_context",
      reasons: ["direct counterparty is service-boundary context"],
      partialNotes: []
    };
  }

  return {
    address,
    riskScore: 0,
    riskLevel: "LOW",
    source: "none",
    evidenceClass: "no_exact_label_or_cached_taint",
    reasons: [],
    partialNotes: []
  };
}

function evidenceCap(evidenceClass: CounterpartyRiskSnapshotEvidenceClass): number {
  switch (evidenceClass) {
    case "exact_labeled_counterparty":
      return 90;
    case "derived_labeled_counterparty":
      return 80;
    case "counterparty_fast_risk_snapshot":
      return 70;
    case "counterparty_behavior_context":
      return 65;
    case "service_boundary_context":
      return 0;
    case "provider_partial":
    case "no_exact_label_or_cached_taint":
      return 0;
  }
}

function skippedReasonFor(input: {
  scoreContribution: number;
  evidenceClass: CounterpartyRiskSnapshotEvidenceClass;
  selected: boolean;
}): DirectCounterpartyInteractionProfile["skippedReason"] {
  if (input.scoreContribution > 0) return null;
  if (input.evidenceClass === "provider_partial") return "provider_partial";
  if (input.evidenceClass === "service_boundary_context") return "service_boundary_context";
  if (input.evidenceClass === "counterparty_behavior_context" || input.evidenceClass === "counterparty_fast_risk_snapshot") return "counterparty_behavior_context";
  if (!input.selected && input.evidenceClass !== "no_exact_label_or_cached_taint") return "not_selected_for_fast_snapshot";
  return "no_exact_label_or_cached_taint";
}

function groupedEdges(subjectAddress: string, edges: ForensicRouteEdge[]): Array<{
  direction: CounterpartyRiskDirection;
  counterpartyAddress: string;
  edges: ForensicRouteEdge[];
  directionalVolumeRaw: bigint;
  directionalTxCount: number;
}> {
  const incoming = edges.filter((edge) => edge.toAddress === subjectAddress);
  const outgoing = edges.filter((edge) => edge.fromAddress === subjectAddress);
  const incomingVolume = incoming.reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n);
  const outgoingVolume = outgoing.reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n);
  const groups = new Map<string, {
    direction: CounterpartyRiskDirection;
    counterpartyAddress: string;
    edges: ForensicRouteEdge[];
    directionalVolumeRaw: bigint;
    directionalTxCount: number;
  }>();

  for (const edge of incoming) {
    const key = `inbound:${edge.fromAddress}`;
    const current = groups.get(key) ?? {
      direction: "inbound" as const,
      counterpartyAddress: edge.fromAddress,
      edges: [],
      directionalVolumeRaw: incomingVolume,
      directionalTxCount: incoming.length
    };
    current.edges.push(edge);
    groups.set(key, current);
  }
  for (const edge of outgoing) {
    const key = `outbound:${edge.toAddress}`;
    const current = groups.get(key) ?? {
      direction: "outbound" as const,
      counterpartyAddress: edge.toAddress,
      edges: [],
      directionalVolumeRaw: outgoingVolume,
      directionalTxCount: outgoing.length
    };
    current.edges.push(edge);
    groups.set(key, current);
  }

  return [...groups.values()];
}

function interactionWeight(input: {
  amountRaw: bigint;
  volumeRatio: number;
  txCount: number;
  directionalTxCount: number;
  direction: CounterpartyRiskDirection;
}): number {
  const txRatio = input.directionalTxCount > 0 ? input.txCount / input.directionalTxCount : 0;
  const amountOrTxShare = Math.max(input.volumeRatio, txRatio * 0.5);
  const absoluteBoost = input.amountRaw >= ABSOLUTE_VOLUME_BOOST_RAW ? 0.1 : 0;
  const directionMultiplier = input.direction === "inbound" ? 1 : 0.95;
  return clamp((amountOrTxShare + absoluteBoost) * directionMultiplier, 0, 1);
}

function compareAmountDesc(left: string, right: string): number {
  const leftRaw = parseAmount(left);
  const rightRaw = parseAmount(right);
  if (leftRaw === rightRaw) return 0;
  return leftRaw > rightRaw ? -1 : 1;
}

function scoreContribution(input: {
  snapshot: CounterpartyRiskSnapshot;
  weight: number;
}): number {
  const cap = evidenceCap(input.snapshot.evidenceClass);
  if (cap <= 0 || input.snapshot.riskScore <= 0) return 0;
  return Math.min(cap, Math.round(input.snapshot.riskScore * input.weight));
}

export function buildDirectCounterpartyInteractionProfiles(
  input: BuildDirectCounterpartyInteractionProfilesInput
): DirectCounterpartyInteractionProfile[] {
  const riskEligibleEdges = input.edges.filter((edge) => !isGasFreeServiceFeeEdge(edge));
  const eligibleIncoming = riskEligibleEdges.filter((edge) => edge.toAddress === input.subjectAddress);
  const eligibleOutgoing = riskEligibleEdges.filter((edge) => edge.fromAddress === input.subjectAddress);
  const eligibleIncomingVolume = eligibleIncoming.reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n);
  const eligibleOutgoingVolume = eligibleOutgoing.reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n);
  return groupedEdges(input.subjectAddress, input.edges)
    .map((group): DirectCounterpartyInteractionProfile => {
      const amountRaw = group.edges.reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n);
      const eligibleEdges = group.edges.filter((edge) => !isGasFreeServiceFeeEdge(edge));
      const eligibleAmountRaw = eligibleEdges.reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n);
      const eligibleDirectionalVolume = group.direction === "inbound" ? eligibleIncomingVolume : eligibleOutgoingVolume;
      const eligibleDirectionalTxCount = group.direction === "inbound" ? eligibleIncoming.length : eligibleOutgoing.length;
      const sorted = [...group.edges].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const classification = input.classifications?.get(group.counterpartyAddress) ?? null;
      const serviceCategory =
        classification?.isBoundary === true && classification.category !== "none"
          ? classification.category
          : null;
      const snapshot = input.snapshotsByAddress.get(group.counterpartyAddress) ?? emptySnapshot(group.counterpartyAddress, classification);
      const weight = eligibleEdges.length === 0
        ? 0
        : interactionWeight({
            amountRaw: eligibleAmountRaw,
            volumeRatio: ratio(eligibleAmountRaw, eligibleDirectionalVolume),
            txCount: eligibleEdges.length,
            directionalTxCount: eligibleDirectionalTxCount,
            direction: group.direction
          });
      const contribution = scoreContribution({ snapshot, weight });

      return {
        subjectAddress: input.subjectAddress,
        direction: group.direction,
        counterpartyAddress: group.counterpartyAddress,
        volumeRaw: amountRaw.toString(),
        volumeRatio: ratio(amountRaw, group.directionalVolumeRaw),
        txCount: group.edges.length,
        firstSeen: sorted[0]?.timestamp.toISOString() ?? new Date(0).toISOString(),
        lastSeen: sorted.at(-1)?.timestamp.toISOString() ?? sorted[0]?.timestamp.toISOString() ?? new Date(0).toISOString(),
        txHashes: sorted.map((edge) => edge.txHash),
        transfers: sorted.map((edge) => ({
          txHash: edge.txHash,
          fromAddress: edge.fromAddress,
          toAddress: edge.toAddress,
          amountRaw: edge.amountRaw,
          timestamp: edge.timestamp.toISOString(),
          method: edge.method,
          edgeType: edge.edgeType,
          ...(edge.economicRole ? { economicRole: edge.economicRole } : {}),
          ...(edge.economicProtocol ? { economicProtocol: edge.economicProtocol } : {})
        })),
        serviceCategory,
        identity: classification?.identity ?? null,
        snapshot,
        interactionWeight: Number(weight.toFixed(4)),
        scoreContribution: contribution,
        evidenceClass: snapshot.evidenceClass,
        skippedReason: skippedReasonFor({
          scoreContribution: contribution,
          evidenceClass: snapshot.evidenceClass,
          selected: input.snapshotsByAddress.has(group.counterpartyAddress)
        })
      };
    })
    .sort((left, right) => {
      if (left.scoreContribution !== right.scoreContribution) return right.scoreContribution - left.scoreContribution;
      const amount = compareAmountDesc(left.volumeRaw, right.volumeRaw);
      if (amount !== 0) return amount;
      return left.counterpartyAddress.localeCompare(right.counterpartyAddress);
    });
}

export function selectCounterpartiesForFastSnapshot(
  input: SelectCounterpartiesForFastSnapshotInput
): string[] {
  const max = input.sparseWallet ? (input.maxSparse ?? 30) : (input.maxActive ?? 10);
  const selected = new Set<string>();
  const profilesByAddress = new Map(input.profiles.map((profile) => [profile.counterpartyAddress, profile]));
  const sorted = [...input.profiles].sort((left, right) => {
    if (left.volumeRatio !== right.volumeRatio) return right.volumeRatio - left.volumeRatio;
    if (left.txCount !== right.txCount) return right.txCount - left.txCount;
    if ((left.snapshot?.riskScore ?? 0) !== (right.snapshot?.riskScore ?? 0)) {
      return (right.snapshot?.riskScore ?? 0) - (left.snapshot?.riskScore ?? 0);
    }
    const amount = compareAmountDesc(left.volumeRaw, right.volumeRaw);
    if (amount !== 0) return amount;
    return left.counterpartyAddress.localeCompare(right.counterpartyAddress);
  });

  for (const address of input.priorityAddresses ?? []) {
    if (selected.size >= max) break;
    const profile = profilesByAddress.get(address);
    if (!profile || selected.has(profile.counterpartyAddress)) continue;
    selected.add(profile.counterpartyAddress);
  }

  if (input.sparseWallet) {
    for (const profile of sorted) {
      if (selected.size >= max) break;
      if (selected.has(profile.counterpartyAddress)) continue;
      selected.add(profile.counterpartyAddress);
    }
    return [...selected];
  }

  const highPriority = sorted.filter((profile) =>
    profile.volumeRatio >= 0.5 || profile.txCount >= 3 || (profile.snapshot?.riskScore ?? 0) > 0
  );
  for (const profile of highPriority) {
    if (selected.size >= max) break;
    if (selected.has(profile.counterpartyAddress)) continue;
    selected.add(profile.counterpartyAddress);
  }
  for (const profile of sorted) {
    if (selected.size >= max) break;
    if (selected.has(profile.counterpartyAddress)) continue;
    selected.add(profile.counterpartyAddress);
  }
  return [...selected];
}
