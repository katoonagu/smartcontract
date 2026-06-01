import {
  contractProfileHasServiceActivity,
  serviceTagFromContractProfile
} from "../approvals/contractIntelligence";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { ContractIntelligenceProfile } from "../approvals/contractIntelligence";
import type { AddressMetadata, WalletApprovalSpenderRelation } from "../storage/repositories";
import type {
  ContractAnalysisCaseFile,
  ContractLlmVerdictSummary,
  ExchangeDecision,
  RiskLevel,
  StandaloneContractApprovalContext
} from "../types";

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

export type BuildStandaloneContractAnalysisCaseFileInput = {
  address: string;
  metadata: AddressMetadata;
  contractProfile: ContractIntelligenceProfile | null;
  serviceClassification: ContractAnalysisCaseFile["serviceClassification"];
  relatedApprovals: WalletApprovalSpenderRelation[];
  knownLimitations?: string[];
};

export type CheckSmartContractAddressInput = {
  address: string;
  metadata: AddressMetadata;
  contractProfile: ContractIntelligenceProfile | null;
  serviceClassification: ContractAnalysisCaseFile["serviceClassification"];
  relatedApprovals: WalletApprovalSpenderRelation[];
  analyzeContractLlmCaseFiles?: (caseFiles: ContractAnalysisCaseFile[]) => Promise<ContractLlmVerdictSummary[]>;
};

const EXACT_DRAIN_NOT_PROVEN = "exact_drain_not_proven_in_standalone_check";
const STANDALONE_CONTRACT_POLICY_VERSION = "2026-06-01-standalone-contract-check-v1";
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

function stableDateString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function contractProfileForCaseFile(profile: ContractIntelligenceProfile | null): Record<string, unknown> | null {
  if (!profile) return null;
  return {
    contractAddress: profile.contractAddress ?? profile.address ?? null,
    name: profile.name ?? null,
    serviceTag: profile.serviceTag ?? null,
    publicTag: profile.publicTag ?? null,
    providerTags: profile.providerTags ?? [],
    publicTags: profile.publicTags ?? [],
    isVerified: profile.isVerified ?? profile.verified ?? null,
    verifyStatus: profile.verifyStatus ?? null,
    sourceStatus: profile.sourceStatus ?? null,
    providerRisk: profile.providerRisk ?? null,
    activityLevel: profile.activityLevel ?? null,
    txCount: profile.txCount ?? profile.trxCount ?? null,
    recentCallCount: profile.recentCallCount ?? null,
    totalCallCount: profile.totalCallCount ?? null,
    totalCallerCount: profile.totalCallerCount ?? profile.uniqueCallerCount ?? null,
    topMethods: profile.topMethods ?? [],
    methodMap: profile.methodMap ?? {},
    hasTransferFromSelector: profile.hasTransferFromSelector ?? null,
    hasOwnerOnlyPattern: profile.hasOwnerOnlyPattern ?? null,
    lowMetadata: profile.lowMetadata ?? null
  };
}

function metadataForCaseFile(metadata: AddressMetadata): Record<string, unknown> {
  return {
    address: metadata.address,
    source: metadata.source,
    name: metadata.name,
    tag: metadata.tag,
    isContract: metadata.isContract,
    verified: metadata.verified,
    accountType: metadata.accountType,
    fetchedAt: stableDateString(metadata.fetchedAt),
    expiresAt: stableDateString(metadata.expiresAt)
  };
}

function approvalStatus(status: WalletApprovalSpenderRelation["status"]): StandaloneContractApprovalContext["status"] {
  if (status === "active" || status === "revoked") return status;
  return "unknown";
}

function pseudonymizeWatchedWallets(approvals: WalletApprovalSpenderRelation[]): Map<string, number> {
  const walletIndexes = new Map<string, number>();
  for (const approval of approvals) {
    if (!walletIndexes.has(approval.watchedWalletAddress)) {
      walletIndexes.set(approval.watchedWalletAddress, walletIndexes.size + 1);
    }
  }
  return walletIndexes;
}

function approvalContext(
  approval: WalletApprovalSpenderRelation,
  walletIndexes: Map<string, number>,
  approvalIndex: number
): StandaloneContractApprovalContext {
  const walletIndex = walletIndexes.get(approval.watchedWalletAddress) ?? 0;
  const approvalEvidenceId = approval.lastApprovalTxHash ? `approval_${approvalIndex + 1}` : null;
  return {
    ownerAddress: `owner_wallet_${walletIndex}`,
    watchedWalletAddress: `watched_wallet_${walletIndex}`,
    approvalEvidenceId,
    tokenContract: approval.tokenContract,
    status: approvalStatus(approval.status),
    isUnlimited: approval.isUnlimited,
    riskScore: approval.riskScore ?? 0,
    lastApprovalAt: stableDateString(approval.lastApprovalAt)
  };
}

function standaloneEvidenceIds(input: BuildStandaloneContractAnalysisCaseFileInput): string[] {
  return [
    input.address,
    ...input.relatedApprovals
      .flatMap((approval, index) => [approval.lastApprovalTxHash ? `approval_${index + 1}` : null, approval.tokenContract])
      .filter((value): value is string => Boolean(value))
  ];
}

export function buildStandaloneContractAnalysisCaseFile(
  input: BuildStandaloneContractAnalysisCaseFileInput
): ContractAnalysisCaseFile {
  const knownLimitations = input.knownLimitations ?? [EXACT_DRAIN_NOT_PROVEN];
  const walletIndexes = pseudonymizeWatchedWallets(input.relatedApprovals);
  const relatedApprovals = input.relatedApprovals.map((approval, index) => approvalContext(approval, walletIndexes, index));
  return {
    policyVersion: STANDALONE_CONTRACT_POLICY_VERSION,
    subjectAddress: input.address,
    checkedWalletAddress: input.address,
    contractAddress: input.address,
    currentUsdtBalanceRaw: null,
    balanceFormingTransfers: [],
    originPaths: [],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    approvalDrainReviewInterpretations: [],
    serviceClassification: input.serviceClassification,
    contractProfile: contractProfileForCaseFile(input.contractProfile),
    evidenceIds: standaloneEvidenceIds(input),
    policyQuestion: "Classify this standalone smart contract for approval safety. Do not claim exact drain unless provided facts prove approve -> transferFrom -> funds movement.",
    standaloneContractContext: {
      mode: "standalone_contract_check",
      metadata: metadataForCaseFile(input.metadata),
      relatedApprovals,
      knownLimitations
    }
  };
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

function shouldAnalyzeStandaloneContract(input: {
  metadata: AddressMetadata;
  contractProfile: ContractIntelligenceProfile | null;
  serviceLabel: string | null;
  activeUnlimitedApprovalCount: number;
}): boolean {
  return input.activeUnlimitedApprovalCount > 0 ||
    input.serviceLabel === null ||
    hasWeakUnknownMetadata(input.metadata, input.contractProfile, input.serviceLabel);
}

export async function checkSmartContractAddress(input: CheckSmartContractAddressInput): Promise<SmartContractCheckReport> {
  const serviceLabel = verifiedServiceLabel(input.metadata, input.contractProfile);
  const activeUnlimited = activeUnlimitedApprovals(input.address, input.relatedApprovals);
  let llmVerdict: ContractLlmVerdictSummary | null = null;

  if (
    input.analyzeContractLlmCaseFiles &&
    shouldAnalyzeStandaloneContract({
      metadata: input.metadata,
      contractProfile: input.contractProfile,
      serviceLabel,
      activeUnlimitedApprovalCount: activeUnlimited.length
    })
  ) {
    const caseFile = buildStandaloneContractAnalysisCaseFile({
      address: input.address,
      metadata: input.metadata,
      contractProfile: input.contractProfile,
      serviceClassification: input.serviceClassification,
      relatedApprovals: input.relatedApprovals
    });
    const verdicts = await input.analyzeContractLlmCaseFiles([caseFile]).catch(() => []);
    llmVerdict = verdicts[0] ?? null;
  }

  return evaluateSmartContractAddress({
    subjectAddress: input.address,
    metadata: input.metadata,
    contractProfile: input.contractProfile,
    relatedApprovals: input.relatedApprovals,
    llmVerdict
  });
}
