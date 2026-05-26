import type {
  AddressBehaviorProfile,
  ApprovalDrainProvenanceProfile,
  BoundaryExposureProfile,
  RiskConfidence,
  RouteScoreFeature,
  ServiceClassification,
  ServiceExposureProfile,
  WalletRole,
  WalletRoleProfile,
  WalletRoleReason
} from "../types";
import { isServiceBoundary } from "./serviceClassifier";

export type BuildWalletRoleProfileInput = {
  subjectAddress: string;
  approvalDrainProfiles: ApprovalDrainProvenanceProfile[];
  addressBehaviorProfile: AddressBehaviorProfile | null;
  serviceExposureProfile: ServiceExposureProfile | null;
  boundaryExposureProfile: BoundaryExposureProfile | null;
  subjectClassification: ServiceClassification | null;
};

type RoleCandidate = {
  role: WalletRole;
  confidence: RiskConfidence;
  score: number;
  reasons: WalletRoleReason[];
};

function sameAddress(left: string | null | undefined, right: string): boolean {
  return left === right;
}

function roleReason(role: WalletRole, feature: RouteScoreFeature): WalletRoleReason {
  return { ...feature, role };
}

function pushCandidate(candidates: RoleCandidate[], candidate: RoleCandidate): void {
  if (candidate.score <= 0) return;
  const existing = candidates.find((item) => item.role === candidate.role);
  if (!existing) {
    candidates.push(candidate);
    return;
  }

  existing.score = Math.max(existing.score, candidate.score);
  existing.confidence = confidenceMax(existing.confidence, candidate.confidence);
  existing.reasons.push(...candidate.reasons);
}

function confidenceMax(left: RiskConfidence, right: RiskConfidence): RiskConfidence {
  const rank: Record<RiskConfidence, number> = { low: 0, medium: 1, high: 2 };
  return rank[right] > rank[left] ? right : left;
}

function scoreFromFeatures(features: RouteScoreFeature[], fallback: number): number {
  const positive = features.reduce((sum, feature) => sum + Math.max(0, feature.scoreImpact), 0);
  return Math.max(fallback, positive);
}

function treasuryDampenerFeature(behavior: AddressBehaviorProfile | null): RouteScoreFeature | null {
  return behavior?.features.find((feature) =>
    feature.code === "known_service_or_treasury_dampener" ||
    feature.code === "long_lived_high_activity_wallet_dampener"
  ) ?? null;
}

function suppressBehaviorOnlyRoles(input: BuildWalletRoleProfileInput): boolean {
  return isServiceBoundary(input.subjectClassification) || Boolean(treasuryDampenerFeature(input.addressBehaviorProfile));
}

function approvalEvidenceIsExact(profile: ApprovalDrainProvenanceProfile): boolean {
  return profile.evidenceStrength === "exact_approval_and_transfer_from";
}

function addApprovalRoles(input: BuildWalletRoleProfileInput, candidates: RoleCandidate[]): void {
  for (const profile of input.approvalDrainProfiles) {
    const exact = approvalEvidenceIsExact(profile);
    const confidence: RiskConfidence = exact ? "high" : "medium";

    if (sameAddress(profile.victimAddress, input.subjectAddress)) {
      pushCandidate(candidates, {
        role: "victim",
        confidence,
        score: exact ? 100 : 75,
        reasons: [
          roleReason("victim", {
            code: "wallet_role_approval_drain_victim",
            label: "Subject is the approval-drain victim address.",
            scoreImpact: exact ? 100 : 75,
            value: profile.drainTxHash
          })
        ]
      });
      continue;
    }

    if (sameAddress(profile.spenderAddress, input.subjectAddress)) {
      pushCandidate(candidates, {
        role: "drainer_spender",
        confidence,
        score: exact ? 95 : 70,
        reasons: [
          roleReason("drainer_spender", {
            code: "wallet_role_approval_drain_spender",
            label: "Subject is the spender in an approval-drain transferFrom flow.",
            scoreImpact: exact ? 95 : 70,
            value: profile.approvalTxHash
          })
        ]
      });
    }

    if (sameAddress(profile.firstReceiverAddress, input.subjectAddress) || (sameAddress(profile.subjectAddress, input.subjectAddress) && profile.hopDepth === 0)) {
      pushCandidate(candidates, {
        role: "first_receiver",
        confidence,
        score: exact ? 90 : 65,
        reasons: [
          roleReason("first_receiver", {
            code: "wallet_role_approval_drain_first_receiver",
            label: "Subject is the first receiver in an approval-drain transferFrom flow.",
            scoreImpact: exact ? 90 : 65,
            value: profile.drainTxHash
          })
        ]
      });
    }
  }
}

function addBehaviorRoles(input: BuildWalletRoleProfileInput, candidates: RoleCandidate[]): void {
  const behavior = input.addressBehaviorProfile;
  if (!behavior) return;

  const treasuryFeature = treasuryDampenerFeature(behavior);
  if (treasuryFeature) {
    pushCandidate(candidates, {
      role: "treasury_like",
      confidence: "medium",
      score: 40,
      reasons: [roleReason("treasury_like", treasuryFeature)]
    });
  }

  if (suppressBehaviorOnlyRoles(input)) return;

  const collectorFeature = behavior.features.find((feature) => feature.code === "address_behavior_collector_like_wallet");
  const fanInCollector = behavior.uniqueIncomingCounterparties >= 5 &&
    behavior.uniqueOutgoingCounterparties <= 3 &&
    behavior.topOutgoingCounterpartyRatio >= 0.5;

  if (collectorFeature || fanInCollector) {
    const feature = collectorFeature ?? {
      code: "wallet_role_fan_in_collector_pattern",
      label: "Fan-in/fan-out pattern suggests collector-like wallet behavior.",
      scoreImpact: 55,
      value: behavior.topOutgoingCounterpartyRatio
    };
    pushCandidate(candidates, {
      role: "collector",
      confidence: collectorFeature ? "high" : "medium",
      score: scoreFromFeatures([feature], 55),
      reasons: [roleReason("collector", feature)]
    });
  }

  const muleFeatures = behavior.features.filter((feature) =>
    feature.code.includes("deposit_then_drain") ||
    feature.code.includes("transit") ||
    feature.code.includes("redistribution")
  );
  if (behavior.depositThenDrainScore > 0 || behavior.transitScore > 0 || muleFeatures.length > 0) {
    const feature = muleFeatures[0] ?? {
      code: "wallet_role_mule_transit_pattern",
      label: "Deposit-then-drain or transit-like activity suggests mule behavior.",
      scoreImpact: Math.max(behavior.depositThenDrainScore, behavior.transitScore, 45),
      value: behavior.timeToFirstOutgoingMs
    };
    pushCandidate(candidates, {
      role: "mule",
      confidence: behavior.depositThenDrainScore >= 20 || behavior.transitScore >= 20 ? "medium" : "low",
      score: scoreFromFeatures([feature], 45),
      reasons: [roleReason("mule", feature)]
    });
  }
}

function addServiceRoles(input: BuildWalletRoleProfileInput, candidates: RoleCandidate[]): void {
  if (isServiceBoundary(input.subjectClassification)) {
    pushCandidate(candidates, {
      role: "cashout_service",
      confidence: input.subjectClassification?.confidence ?? "medium",
      score: 50,
      reasons: [
        roleReason("cashout_service", {
          code: "wallet_role_subject_service_boundary",
          label: "Subject address is classified as service boundary infrastructure.",
          scoreImpact: 50,
          value: input.subjectClassification?.identity ?? input.subjectClassification?.category ?? null
        })
      ]
    });
  }

  const service = input.serviceExposureProfile;
  const behavior = input.addressBehaviorProfile;
  if (suppressBehaviorOnlyRoles(input)) return;

  const fastServiceExit = behavior?.timeToFirstServiceExitMs !== null &&
    behavior?.timeToFirstServiceExitMs !== undefined &&
    behavior.timeToFirstServiceExitMs <= 60 * 60 * 1000;
  const meaningfulServicePreservation = (behavior?.drainToServiceRatio ?? 0) >= 0.5 ||
    (service?.bestAmountPreservationRatio ?? 0) >= 0.7;
  if (
    service &&
    behavior &&
    service.combinedServiceVolumeRatio >= 0.5 &&
    fastServiceExit &&
    meaningfulServicePreservation &&
    (behavior.depositThenDrainScore > 0 || behavior.transitScore > 0 || service.exposureScore > 0)
  ) {
    pushCandidate(candidates, {
      role: "mule",
      confidence: "medium",
      score: 50,
      reasons: [
        roleReason("mule", {
          code: "wallet_role_fast_service_redistribution",
          label: "Subject quickly redistributes funds toward service infrastructure.",
          scoreImpact: 50,
          value: service.combinedServiceVolumeRatio
        })
      ]
    });
  }
}

function evidenceStrengthFor(candidates: RoleCandidate[]): WalletRoleProfile["evidenceStrength"] {
  if (candidates.some((candidate) => ["victim", "drainer_spender", "first_receiver"].includes(candidate.role))) return "exact";
  if (candidates.some((candidate) => ["collector", "mule", "treasury_like"].includes(candidate.role))) return "strong_behavior";
  if (candidates.some((candidate) => candidate.role === "cashout_service")) return "context";
  return "weak";
}

function sortRoles(candidates: RoleCandidate[]): RoleCandidate[] {
  const rolePriority: Record<WalletRole, number> = {
    victim: 0,
    drainer_spender: 1,
    first_receiver: 2,
    collector: 3,
    mule: 4,
    cashout_service: 5,
    treasury_like: 6,
    unknown: 7
  };
  return [...candidates].sort((left, right) =>
    right.score - left.score || rolePriority[left.role] - rolePriority[right.role] || left.role.localeCompare(right.role)
  );
}

export function buildWalletRoleProfile(input: BuildWalletRoleProfileInput): WalletRoleProfile {
  const candidates: RoleCandidate[] = [];
  addApprovalRoles(input, candidates);
  addBehaviorRoles(input, candidates);
  addServiceRoles(input, candidates);

  const roles = sortRoles(candidates);
  if (roles.length === 0) {
    return {
      subjectAddress: input.subjectAddress,
      primaryRole: "unknown",
      roles: [{ role: "unknown", confidence: "low", score: 0, reasons: [] }],
      evidenceStrength: "weak",
      features: []
    };
  }

  const features = roles.flatMap((role) => role.reasons);
  return {
    subjectAddress: input.subjectAddress,
    primaryRole: roles[0].role,
    roles,
    evidenceStrength: evidenceStrengthFor(roles),
    features
  };
}
