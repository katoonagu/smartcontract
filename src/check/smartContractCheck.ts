import {
  contractProfileHasServiceActivity,
  serviceTagFromContractProfile
} from "../approvals/contractIntelligence";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { ContractIntelligenceProfile } from "../approvals/contractIntelligence";
import type { AddressMetadata, WalletApprovalSpenderRelation } from "../storage/repositories";
import type { ContractLlmVerdictSummary, ExchangeDecision, RiskLevel } from "../types";

export type SmartContractCheckReport = {
  subjectAddress: string;
  decision: ExchangeDecision;
  decisionScope: "contract_safety" | "approval_safety";
  riskScore: number;
  riskLevel: RiskLevel;
  metadata: AddressMetadata;
  contractProfile: ContractIntelligenceProfile | null;
  relatedApprovals: WalletApprovalSpenderRelation[];
  llmVerdict: ContractLlmVerdictSummary | null;
  exactDrainProven: boolean;
  serviceLabel: string | null;
  activityLabel: "none" | "low" | "normal" | "high" | "unknown";
  reasons: string[];
  limitations: string[];
};

export type EvaluateSmartContractAddressInput = {
  subjectAddress: string;
  metadata: AddressMetadata;
  contractProfile?: ContractIntelligenceProfile | null;
  relatedApprovals?: WalletApprovalSpenderRelation[];
  llmVerdict?: ContractLlmVerdictSummary | null;
};

const EXACT_DRAIN_NOT_PROVEN = "exact_drain_not_proven_in_standalone_check";
const SERVICE_KEYWORDS = /(bridge|cross-chain|cross chain|swap|router|dex|exchange|payment|energy|bandwidth|staking)/;

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

function addReason(reasons: string[], code: string): void {
  if (!reasons.includes(code)) reasons.push(code);
}

function serviceLabelFromMetadata(metadata: AddressMetadata): string | null {
  const text = [metadata.tag, metadata.name].filter(Boolean).join(" ").toLowerCase();
  if (!text) return null;
  if (SERVICE_KEYWORDS.test(text)) {
    return metadata.tag ?? metadata.name;
  }
  return null;
}

function isServiceLikeLabel(label: string | null): boolean {
  return label !== null && SERVICE_KEYWORDS.test(label.toLowerCase());
}

function verifiedServiceLabel(
  metadata: AddressMetadata,
  contractProfile: ContractIntelligenceProfile | null
): string | null {
  if (contractProfile?.providerRisk === true) return null;
  const label = serviceTagFromContractProfile(contractProfile) ?? serviceLabelFromMetadata(metadata);
  if (!label) return null;

  const verified = metadata.verified === true || contractProfile?.isVerified === true || contractProfile?.verified === true;
  const serviceEvidence = contractProfile
    ? isServiceLikeLabel(label) && (
        contractProfileHasServiceActivity(contractProfile) ||
        contractProfile.activityLevel === "normal" ||
        contractProfile.activityLevel === "high"
      )
    : metadata.verified === true && Boolean(metadata.tag);
  return verified && serviceEvidence ? label : null;
}

function activityLabel(contractProfile: ContractIntelligenceProfile | null): SmartContractCheckReport["activityLabel"] {
  const level = contractProfile?.activityLevel;
  if (level === "none" || level === "low" || level === "normal" || level === "high" || level === "unknown") {
    return level;
  }
  return "unknown";
}

function hasWeakUnknownMetadata(metadata: AddressMetadata, contractProfile: ContractIntelligenceProfile | null, serviceLabel: string | null): boolean {
  if (serviceLabel) return false;
  return metadata.verified !== true ||
    contractProfile === null ||
    contractProfile.lowMetadata === true ||
    contractProfile.isVerified === false ||
    contractProfile.verified === false ||
    contractProfile.sourceStatus === "missing";
}

function isOfficialUsdtApproval(approval: WalletApprovalSpenderRelation): boolean {
  return approval.tokenContract === TRON_USDT_CONTRACT_ADDRESS;
}

function activeUnlimitedApprovals(
  subjectAddress: string,
  approvals: WalletApprovalSpenderRelation[]
): WalletApprovalSpenderRelation[] {
  return approvals.filter((approval) =>
    approval.spenderAddress === subjectAddress &&
    approval.status === "active" &&
    approval.isUnlimited &&
    isOfficialUsdtApproval(approval)
  );
}

function activeRiskyRelatedApprovals(
  subjectAddress: string,
  approvals: WalletApprovalSpenderRelation[]
): WalletApprovalSpenderRelation[] {
  return approvals.filter((approval) =>
    approval.spenderAddress === subjectAddress &&
    approval.status === "active" &&
    isOfficialUsdtApproval(approval) &&
    (
      approval.riskScore >= 45 ||
      approval.riskLevel === "HIGH" ||
      approval.riskLevel === "CRITICAL"
    )
  );
}

function maxRelatedApprovalRiskScore(approvals: WalletApprovalSpenderRelation[]): number {
  return approvals.reduce((maxScore, approval) => {
    const levelScore = approval.riskLevel === "CRITICAL" ? 85 : approval.riskLevel === "HIGH" ? 60 : 45;
    return Math.max(maxScore, approval.riskScore, levelScore);
  }, 45);
}

function hasTransferFromSurface(
  contractProfile: ContractIntelligenceProfile | null,
  activeApprovals: WalletApprovalSpenderRelation[]
): boolean {
  return contractProfile?.hasTransferFromSelector === true ||
    activeApprovals.some((approval) => approval.contractHasTransferFromSelector === true);
}

function llmRiskScore(verdict: ContractLlmVerdictSummary): number {
  if (Number.isFinite(verdict.contractRiskScore) && verdict.contractRiskScore > 0) {
    return verdict.contractRiskScore;
  }
  return verdict.verdict === "drainer_like" ? 70 : verdict.verdict === "unknown_suspicious" ? 50 : 20;
}

function applyLlmVerdict(input: {
  score: number;
  reasons: string[];
  llmVerdict: ContractLlmVerdictSummary | null;
  serviceLabel: string | null;
  activeUnlimitedApprovalCount: number;
}): number {
  const verdict = input.llmVerdict;
  if (!verdict) return input.score;

  if (verdict.verdict === "legitimate_service" && verdict.confidence >= 0.8 && input.serviceLabel) {
    addReason(input.reasons, "llm_legitimate_service_with_service_evidence");
    const floor = input.activeUnlimitedApprovalCount > 0 ? 45 : 10;
    return Math.max(floor, Math.min(input.score, 20));
  }

  if (verdict.verdict === "unknown_suspicious" && verdict.confidence >= 0.75) {
    addReason(input.reasons, "llm_unknown_suspicious_high_confidence");
    return Math.max(input.score, Math.max(45, Math.min(55, llmRiskScore(verdict))));
  }

  if (verdict.verdict === "drainer_like" && verdict.confidence >= 0.85) {
    addReason(input.reasons, "llm_drainer_like_high_confidence");
    return Math.max(input.score, Math.max(65, Math.min(75, llmRiskScore(verdict))));
  }

  return input.score;
}

function decisionForScore(input: {
  score: number;
  knownVerifiedService: boolean;
  hasApprovalSafetyRisk: boolean;
  hasProviderRisk: boolean;
}): ExchangeDecision {
  if (input.hasProviderRisk || input.hasApprovalSafetyRisk) return "DECLINE";
  if (input.knownVerifiedService && input.score <= 20) return "ACCEPTABLE";
  if (input.score >= 35) return "REVIEW";
  return "ACCEPTABLE";
}

export function evaluateSmartContractAddress(input: EvaluateSmartContractAddressInput): SmartContractCheckReport {
  const contractProfile = input.contractProfile ?? null;
  const relatedApprovals = input.relatedApprovals ?? [];
  const llmVerdict = input.llmVerdict ?? null;
  const reasons: string[] = [];
  const limitations = [EXACT_DRAIN_NOT_PROVEN];
  const serviceLabel = verifiedServiceLabel(input.metadata, contractProfile);
  const activeUnlimited = activeUnlimitedApprovals(input.subjectAddress, relatedApprovals);
  const activeRiskyRelated = activeRiskyRelatedApprovals(input.subjectAddress, relatedApprovals);
  const knownVerifiedService = serviceLabel !== null;
  const providerRisk = contractProfile?.providerRisk === true;
  const verifiedWithoutServiceEvidence = !knownVerifiedService && (
    input.metadata.verified === true ||
    contractProfile?.isVerified === true ||
    contractProfile?.verified === true
  );

  if (input.metadata.isContract === true || contractProfile !== null) {
    addReason(reasons, "address_is_smart_contract");
  }

  let riskScore = knownVerifiedService ? 10 : 20;
  if (knownVerifiedService) {
    addReason(reasons, "known_verified_service_contract");
  }

  if (providerRisk) {
    addReason(reasons, "provider_risk_contract");
    riskScore = Math.max(riskScore, 90);
  } else if (verifiedWithoutServiceEvidence) {
    addReason(reasons, "verified_contract_without_service_evidence");
    riskScore = Math.max(riskScore, 35);
  }

  if (hasWeakUnknownMetadata(input.metadata, contractProfile, serviceLabel)) {
    addReason(reasons, "unknown_weak_contract_metadata");
    riskScore = Math.max(riskScore, 35);
  }

  if (activeUnlimited.length > 0) {
    addReason(reasons, "active_unlimited_usdt_approval_spender");
    riskScore = Math.max(riskScore, 45);
  }

  if (activeRiskyRelated.length > 0) {
    addReason(reasons, "active_risky_related_approval_spender");
    riskScore = Math.max(riskScore, maxRelatedApprovalRiskScore(activeRiskyRelated));
  }

  if (activeUnlimited.length > 0 && hasTransferFromSurface(contractProfile, activeUnlimited)) {
    addReason(reasons, "transferfrom_surface_with_active_unlimited_approval");
    riskScore = Math.max(riskScore, 65);
  }

  riskScore = applyLlmVerdict({
    score: riskScore,
    reasons,
    llmVerdict,
    serviceLabel,
    activeUnlimitedApprovalCount: activeUnlimited.length
  });

  const finalScore = clampScore(riskScore);
  const hasApprovalSafetyRisk = activeUnlimited.length > 0 || activeRiskyRelated.length > 0;
  return {
    subjectAddress: input.subjectAddress,
    decision: decisionForScore({
      score: finalScore,
      knownVerifiedService,
      hasApprovalSafetyRisk,
      hasProviderRisk: providerRisk
    }),
    decisionScope: hasApprovalSafetyRisk ? "approval_safety" : "contract_safety",
    riskScore: finalScore,
    riskLevel: riskLevelFromScore(finalScore),
    metadata: input.metadata,
    contractProfile,
    relatedApprovals,
    llmVerdict,
    exactDrainProven: false,
    serviceLabel,
    activityLabel: activityLabel(contractProfile),
    reasons,
    limitations
  };
}

export const checkSmartContractAddress = evaluateSmartContractAddress;
