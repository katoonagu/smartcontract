import type { RiskReason } from "../types";

export type RiskPolicyDimension =
  | "provenance"
  | "approval_drain"
  | "behavior"
  | "service_context"
  | "provider_label"
  | "dampener";

export type RiskPolicyEvidenceClass =
  | "exact_self"
  | "exact_approval_drain"
  | "exact_labeled_path"
  | "service_boundary_context"
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

export const RISK_POLICY_VERSION = "2026-05-25-phase-10a12-v1";

function isExactSelfEvidence(code: string): boolean {
  return code === "stablecoin_usdt_blacklisted" ||
    code.startsWith("internal_label_scam") ||
    code.startsWith("internal_label_stolen_funds") ||
    code.startsWith("internal_label_phishing") ||
    code.startsWith("internal_label_risky_contract") ||
    code.startsWith("internal_label_darknet_exchange") && !code.includes("proximity");
}

function isExactApprovalDrainEvidence(code: string): boolean {
  return code === "forensic_approval_drain_provenance" ||
    code === "internal_label_approval_drain_proximity" ||
    code.includes("approval_drain_exact") ||
    code.includes("exact_approval");
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

export function policyForReason(reason: Pick<RiskReason, "code" | "scoreImpact">): RiskPolicyClassification {
  const code = reason.code;

  if (reason.scoreImpact < 0) {
    return { dimension: "dampener", evidenceClass: "dampener", hardEvidence: false, cap: 40 };
  }

  if (isExactSelfEvidence(code)) {
    return { dimension: "provider_label", evidenceClass: "exact_self", hardEvidence: true, cap: 95 };
  }

  if (isExactApprovalDrainEvidence(code)) {
    return { dimension: "approval_drain", evidenceClass: "exact_approval_drain", hardEvidence: true, cap: 90 };
  }

  if (isServiceBoundaryContext(code)) {
    return { dimension: "service_context", evidenceClass: "service_boundary_context", hardEvidence: false, cap: 15 };
  }

  if (isBehaviorOnly(code)) {
    return { dimension: "behavior", evidenceClass: "behavior_only", hardEvidence: false, cap: 30 };
  }

  if (code === "internal_label_darknet_exchange_proximity") {
    return { dimension: "provenance", evidenceClass: "exact_labeled_path", hardEvidence: true, cap: 60 };
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

  return {
    ...reason,
    scoreImpact: Math.min(policy.cap, Math.max(0, reason.scoreImpact))
  };
}

export function calculateBoundedPolicyScore(reasons: RiskReason[]): number {
  let hardEvidenceScore = 0;
  const buckets: Record<RiskPolicyDimension, number> = {
    provenance: 0,
    approval_drain: 0,
    behavior: 0,
    service_context: 0,
    provider_label: 0,
    dampener: 0
  };

  for (const original of reasons) {
    const reason = boundedReasonImpact(original);
    const policy = policyForReason(reason);
    if (policy.hardEvidence) hardEvidenceScore = Math.max(hardEvidenceScore, reason.scoreImpact);
    if (policy.dimension === "dampener") {
      buckets.dampener += Math.abs(reason.scoreImpact);
    } else {
      buckets[policy.dimension] += reason.scoreImpact;
    }
  }

  const composite =
    Math.min(40, buckets.provenance) +
    Math.min(30, buckets.approval_drain) +
    Math.min(25, buckets.behavior) +
    Math.min(20, buckets.service_context) +
    Math.min(20, buckets.provider_label) -
    Math.min(40, buckets.dampener);

  return Math.max(0, Math.min(100, Math.max(hardEvidenceScore, composite)));
}
