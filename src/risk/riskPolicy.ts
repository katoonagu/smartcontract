import type { RiskReason } from "../types";
import { isExactFastHardEvidenceReason } from "./fastEvidence";

export type RiskPolicyDimension =
  | "provenance"
  | "approval_drain"
  | "behavior"
  | "service_context"
  | "provider_label"
  | "dampener";

export type RiskDominantRiskType = "none" | "taint" | "laundering_pattern" | "mixed";

export type RiskPolicyEvidenceClass =
  | "exact_self"
  | "exact_approval_drain"
  | "exact_labeled_path"
  | "service_boundary_context"
  | "operational_flow_pattern"
  | "weak_inferred"
  | "behavior_only"
  | "provider_label"
  | "dampener";

export type RiskPolicyClassification = {
  dimension: RiskPolicyDimension;
  evidenceClass: RiskPolicyEvidenceClass;
  hardEvidence: boolean;
  cap: number;
};

export type RiskPolicyScoreBreakdown = {
  score: number;
  taintScore: number;
  launderingPatternScore: number;
  dominantRiskType: RiskDominantRiskType;
};

export const RISK_POLICY_VERSION = "2026-05-25-phase-10a12-v1";

function isOperationalFlowPattern(code: string): boolean {
  return code === "forensic_operational_boundary_flow" ||
    code.startsWith("operational_flow_") ||
    code.includes("terminal_liquidity") ||
    code.includes("bridge_dex_router");
}

function isServiceBoundaryContext(code: string): boolean {
  return code.includes("boundary") ||
    code.startsWith("service_exposure") ||
    code === "forensic_service_exposure" ||
    code.includes("service_exposure") ||
    code.includes("service_context");
}

function isBehaviorOnly(code: string): boolean {
  return code === "forensic_address_behavior" ||
    code.startsWith("address_behavior_") ||
    code.includes("behavior") ||
    code.includes("transit") ||
    code.includes("split_pattern") ||
    code.includes("collector") ||
    code.includes("fan_in") ||
    code.includes("fan_out");
}

function isProvenanceContext(code: string): boolean {
  return code.includes("provenance") ||
    code.includes("route") ||
    code.includes("counterparty") ||
    code.includes("_hop") ||
    code.startsWith("risky_") ||
    code === "internal_label_darknet_exchange_proximity";
}

export function policyForReason(reason: Pick<RiskReason, "code" | "scoreImpact" | "evidenceRef">): RiskPolicyClassification {
  const code = reason.code;

  if (isExactFastHardEvidenceReason(reason as RiskReason)) {
    return code === "forensic_approval_drain_provenance"
      ? { dimension: "approval_drain", evidenceClass: "exact_approval_drain", hardEvidence: true, cap: 95 }
      : { dimension: "provider_label", evidenceClass: "exact_self", hardEvidence: true, cap: 95 };
  }

  if (reason.scoreImpact < 0) {
    return { dimension: "dampener", evidenceClass: "dampener", hardEvidence: false, cap: 40 };
  }

  if (isOperationalFlowPattern(code)) {
    return { dimension: "service_context", evidenceClass: "operational_flow_pattern", hardEvidence: false, cap: 50 };
  }

  if (code === "forensic_route_linked_approval_pattern") {
    return { dimension: "provenance", evidenceClass: "weak_inferred", hardEvidence: false, cap: 80 };
  }

  if (code === "forensic_approval_drain_provenance" || code === "internal_label_approval_drain_proximity") {
    return { dimension: "provenance", evidenceClass: "weak_inferred", hardEvidence: false, cap: 80 };
  }

  if (isServiceBoundaryContext(code)) {
    return { dimension: "service_context", evidenceClass: "service_boundary_context", hardEvidence: false, cap: 15 };
  }

  if (isBehaviorOnly(code)) {
    return { dimension: "behavior", evidenceClass: "behavior_only", hardEvidence: false, cap: 30 };
  }

  if (code === "internal_label_darknet_exchange_proximity") {
    return { dimension: "provenance", evidenceClass: "exact_labeled_path", hardEvidence: false, cap: 60 };
  }

  if (code === "forensic_counterparty_whitebit") {
    return { dimension: "provenance", evidenceClass: "exact_labeled_path", hardEvidence: false, cap: 80 };
  }

  if (isProvenanceContext(code)) {
    return { dimension: "provenance", evidenceClass: "exact_labeled_path", hardEvidence: false, cap: 60 };
  }

  return { dimension: "provider_label", evidenceClass: "provider_label", hardEvidence: false, cap: 20 };
}

export function boundedReasonImpact(reason: RiskReason): RiskReason {
  const policy = policyForReason(reason);
  if (reason.scoreImpact < 0) {
    return {
      ...reason,
      scoreImpact: Math.max(-policy.cap, reason.scoreImpact)
    };
  }

  if (policy.evidenceClass === "exact_approval_drain") {
    return {
      ...reason,
      scoreImpact: Math.min(policy.cap, Math.max(95, reason.scoreImpact))
    };
  }

  return {
    ...reason,
    scoreImpact: Math.min(policy.cap, Math.max(0, reason.scoreImpact))
  };
}

function clampPolicyScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function isTaintEvidence(policy: RiskPolicyClassification): boolean {
  return policy.hardEvidence && (
    policy.evidenceClass === "exact_self" ||
    policy.evidenceClass === "exact_approval_drain" ||
    policy.evidenceClass === "exact_labeled_path"
  );
}

function isOperationalProvenanceContext(reason: RiskReason, policy: RiskPolicyClassification): boolean {
  return policy.dimension === "provenance" &&
    !policy.hardEvidence &&
    (
      reason.code.startsWith("forensic_") ||
      reason.code.includes("extended_provenance") ||
      reason.code.includes("service_boundary")
    );
}

export function calculatePolicyScoreBreakdown(reasons: RiskReason[]): RiskPolicyScoreBreakdown {
  let hardEvidenceScore = 0;
  let strongCounterpartyContextScore = 0;
  let strongProvenanceContextScore = 0;
  let strongApprovalContextScore = 0;
  const buckets: Record<RiskPolicyDimension, number> = {
    provenance: 0,
    approval_drain: 0,
    behavior: 0,
    service_context: 0,
    provider_label: 0,
    dampener: 0
  };
  const operationalBuckets = {
    provenance: 0,
    behavior: 0,
    service_context: 0,
    operational_flow: 0,
    dampener: 0
  };
  let taintScore = 0;

  for (const original of reasons) {
    const reason = boundedReasonImpact(original);
    const policy = policyForReason(reason);
    if (reason.code === "forensic_counterparty_fast_snapshot_context" || reason.code.startsWith("forensic_counterparty_")) {
      strongCounterpartyContextScore = Math.max(strongCounterpartyContextScore, reason.scoreImpact);
    }
    if (reason.code === "internal_label_darknet_exchange_proximity") {
      strongProvenanceContextScore = Math.max(strongProvenanceContextScore, reason.scoreImpact);
    }
    if (
      reason.code === "forensic_route_linked_approval_pattern" ||
      reason.code === "forensic_approval_drain_provenance" ||
      reason.code === "internal_label_approval_drain_proximity"
    ) {
      strongApprovalContextScore = Math.max(strongApprovalContextScore, reason.scoreImpact);
    }
    if (policy.hardEvidence) hardEvidenceScore = Math.max(hardEvidenceScore, reason.scoreImpact);
    if (isTaintEvidence(policy)) taintScore = Math.max(taintScore, reason.scoreImpact);
    if (policy.dimension === "dampener") {
      buckets.dampener += Math.abs(reason.scoreImpact);
      operationalBuckets.dampener += Math.abs(reason.scoreImpact);
    } else {
      buckets[policy.dimension] += reason.scoreImpact;
      if (policy.evidenceClass === "operational_flow_pattern") {
        operationalBuckets.operational_flow += reason.scoreImpact;
      } else if (policy.dimension === "service_context") {
        operationalBuckets.service_context += reason.scoreImpact;
      } else if (policy.dimension === "behavior") {
        operationalBuckets.behavior += reason.scoreImpact;
      } else if (isOperationalProvenanceContext(reason, policy)) {
        operationalBuckets.provenance += reason.scoreImpact;
      }
    }
  }

  const composite =
    Math.min(40, buckets.provenance) +
    Math.min(30, buckets.approval_drain) +
    Math.min(25, buckets.behavior) +
    Math.min(20, buckets.service_context) +
    Math.min(20, buckets.provider_label) -
    Math.min(40, buckets.dampener);

  const operationalContextScore = Math.min(50, operationalBuckets.operational_flow) +
    Math.min(30, operationalBuckets.service_context) +
    Math.min(40, operationalBuckets.provenance);
  const behaviorCap = operationalContextScore > 0 ? 30 : 25;
  const launderingPatternCap = operationalBuckets.operational_flow > 0
    ? (taintScore > 0 ? 90 : 85)
    : 80;
  const launderingPatternScore = clampPolicyScore(Math.max(
    Math.min(
      launderingPatternCap,
      operationalContextScore +
        Math.min(behaviorCap, operationalBuckets.behavior) -
        Math.min(40, operationalBuckets.dampener)
    ),
    strongCounterpartyContextScore,
    strongProvenanceContextScore,
    strongApprovalContextScore
  ));
  const boundedPolicyScore = clampPolicyScore(Math.max(hardEvidenceScore, composite));
  const score = clampPolicyScore(Math.max(boundedPolicyScore, taintScore, launderingPatternScore));
  const dominantRiskType: RiskDominantRiskType = taintScore > 0 && launderingPatternScore >= 30
    ? "mixed"
    : taintScore > 0
      ? "taint"
      : launderingPatternScore > 0 && launderingPatternScore >= score
        ? "laundering_pattern"
        : "none";

  return {
    score,
    taintScore,
    launderingPatternScore,
    dominantRiskType
  };
}

export function calculateBoundedPolicyScore(reasons: RiskReason[]): number {
  return calculatePolicyScoreBreakdown(reasons).score;
}
