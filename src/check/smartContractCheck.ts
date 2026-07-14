import {
  contractProfileHasServiceActivity,
  serviceTagFromContractProfile
} from "../approvals/contractIntelligence";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import { findKnownServiceBySpender } from "../approvals/knownServiceRegistry";
import type { ContractIntelligenceProfile } from "../approvals/contractIntelligence";
import type { AddressMetadata, WalletApprovalSpenderRelation } from "../storage/repositories";
import {
  detectVerify20Fingerprint,
  type Verify20FingerprintResult
} from "../forensics/verify20Fingerprint";
import {
  buildContractDecisionEvidenceV1,
  resolveContractDecisionV2
} from "../forensics/contractDecision";
import type {
  ContractAnalysisCaseFile,
  ApprovalSafetyAssessmentV2,
  ContractDecisionEvidenceV1,
  ContractLlmVerdictSummary,
  ContractDecisionV2,
  ExchangeDecision,
  RiskLevel,
  RiskReport,
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
  verify20Fingerprint: Verify20FingerprintResult;
  serviceLabel: string | null;
  activityLabel: "none" | "low" | "normal" | "high" | "unknown";
  reasons: string[];
  limitations: string[];
  contractDecisionV2?: ContractDecisionV2;
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
  approvalSafetyAssessments?: ApprovalSafetyAssessmentV2[];
  contractDecisionEvidence?: ContractDecisionEvidenceV1[];
};

export type ApprovalSafetyContractDecisionBinding = {
  assessment: ApprovalSafetyAssessmentV2 & { authoritativeServiceId?: string | null };
  evidence: ContractDecisionEvidenceV1[];
};

export function bindApprovalSafetyAuditForContractDecision(input: {
  subjectAddress: string;
  approvalEvidenceId: string;
  sessionEvidenceId: string | null;
  assessment: ApprovalSafetyAssessmentV2;
}): ApprovalSafetyContractDecisionBinding | null {
  const allowance = input.assessment.allowance;
  if (!input.approvalEvidenceId || allowance.spenderAddress !== input.subjectAddress ||
    allowance.tokenContract !== TRON_USDT_CONTRACT_ADDRESS ||
    allowance.ownerAddress !== input.assessment.subjectAddress ||
    !allowance.observedApprovalTxHash) return null;
  const allowanceEvidenceId = `allowance:${input.approvalEvidenceId}`;
  const evidence: ContractDecisionEvidenceV1[] = [
    {
      id: allowance.observedApprovalTxHash,
      kind: "approval_event",
      subjectAddress: input.subjectAddress,
      spenderAddress: input.subjectAddress,
      tokenContract: TRON_USDT_CONTRACT_ADDRESS
    },
    {
      id: allowanceEvidenceId,
      kind: "allowance_read",
      subjectAddress: input.subjectAddress,
      spenderAddress: input.subjectAddress,
      tokenContract: TRON_USDT_CONTRACT_ADDRESS
    }
  ];
  const session = input.assessment.serviceSession;
  const registered = findKnownServiceBySpender(input.subjectAddress);
  if (session) {
    if (!input.sessionEvidenceId || !registered ||
      session.walletAddress !== allowance.ownerAddress || session.spenderAddress !== input.subjectAddress ||
      session.approvalTxHash !== allowance.observedApprovalTxHash ||
      session.authoritativeServiceId !== registered.id || !registered.actionKinds.includes(session.actionKind)) return null;
    evidence.push({
      id: session.actionTxHash,
      kind: "service_action",
      subjectAddress: input.subjectAddress,
      spenderAddress: input.subjectAddress,
      tokenContract: TRON_USDT_CONTRACT_ADDRESS
    });
  }
  return {
    assessment: {
      ...input.assessment,
      campaignEvidenceIds: [...input.assessment.campaignEvidenceIds, allowanceEvidenceId],
      authoritativeServiceId: registered?.id ?? null
    },
    evidence
  };
}

export function mergeContractSafetyContext(
  fastReport: RiskReport,
  contractReport: SmartContractCheckReport
): RiskReport {
  const contextScore = Math.min(59, Math.max(0, contractReport.riskScore));
  return {
    ...fastReport,
    score: Math.max(fastReport.score, contextScore),
    level: contextScore >= 30 && fastReport.level === "LOW" ? "MEDIUM" : fastReport.level,
    reasons: [
      ...fastReport.reasons,
      ...contractReport.reasons.map((reason) => ({
        code: `contract_safety_${reason}`,
        message: `Contract safety context: ${reason}`,
        scoreImpact: contextScore,
        source: "contract_safety",
        confidence: "medium" as const,
        severity: contextScore >= 45 ? "medium" as const : "low" as const,
        evidenceRef: `contract_safety:${contractReport.subjectAddress}:${reason}`
      }))
    ]
  };
}

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
  const text = metadata.tag?.toLowerCase() ?? "";
  if (!text) return null;
  if (SERVICE_KEYWORDS.test(text)) {
    return metadata.tag;
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

function authoritativeVerify20ServiceLabel(
  metadata: AddressMetadata,
  contractProfile: ContractIntelligenceProfile | null
): string | null {
  if (contractProfile?.providerRisk === true) return null;
  const verified = metadata.verified === true ||
    contractProfile?.isVerified === true ||
    contractProfile?.verified === true;
  if (!verified) return null;
  const labels = [
    metadata.tag,
    contractProfile?.serviceTag,
    ...(contractProfile?.providerTags ?? []).map((tag) => tag.label),
    contractProfile?.publicTag,
    ...(contractProfile?.publicTags ?? []).map((tag) => tag.label)
  ];
  return labels.find((label): label is string => typeof label === "string" && isServiceLikeLabel(label)) ?? null;
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

function decisionForScore(input: {
  score: number;
  knownVerifiedService: boolean;
  hasApprovalSafetyRisk: boolean;
  hasProviderRisk: boolean;
  exactVerify20Pattern: boolean;
}): ExchangeDecision {
  if (input.hasProviderRisk || input.hasApprovalSafetyRisk || input.exactVerify20Pattern) return "DECLINE";
  if (input.knownVerifiedService && input.score <= 20) return "ACCEPTABLE";
  if (input.score >= 35) return "REVIEW";
  return "ACCEPTABLE";
}

export function evaluateSmartContractAddress(input: EvaluateSmartContractAddressInput): SmartContractCheckReport {
  const contractProfile = input.contractProfile ?? null;
  const relatedApprovals = input.relatedApprovals ?? [];
  const reasons: string[] = [];
  const limitations = [EXACT_DRAIN_NOT_PROVEN];
  const verify20ServiceLabel = authoritativeVerify20ServiceLabel(input.metadata, contractProfile);
  const serviceLabel = verify20ServiceLabel ?? verifiedServiceLabel(input.metadata, contractProfile);
  const verify20Fingerprint = detectVerify20Fingerprint({
    methodMap: contractProfile?.methodMap,
    topMethods: contractProfile?.topMethods,
    serviceLabel: verify20ServiceLabel
  });
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

  if (verify20Fingerprint.matched) {
    addReason(reasons, "exact_verify20_contract_pattern");
    riskScore = Math.max(riskScore, 85);
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

  const finalScore = clampScore(riskScore);
  const hasApprovalSafetyRisk = activeUnlimited.length > 0 || activeRiskyRelated.length > 0;
  return {
    subjectAddress: input.subjectAddress,
    decision: decisionForScore({
      score: finalScore,
      knownVerifiedService,
      hasApprovalSafetyRisk,
      hasProviderRisk: providerRisk,
      exactVerify20Pattern: verify20Fingerprint.matched
    }),
    decisionScope: hasApprovalSafetyRisk ? "approval_safety" : "contract_safety",
    riskScore: finalScore,
    riskLevel: riskLevelFromScore(finalScore),
    metadata: input.metadata,
    contractProfile,
    relatedApprovals,
    llmVerdict: null,
    exactDrainProven: false,
    verify20Fingerprint,
    serviceLabel,
    activityLabel: activityLabel(contractProfile),
    reasons,
    limitations
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function sameAddress(left: string, right: string): boolean {
  return left === right;
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function optionalNullableString(value: unknown): boolean {
  return value === undefined || nullableString(value);
}

function optionalNullableBoolean(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "boolean";
}

function validPersistedMetadata(value: Record<string, unknown>, subjectAddress: string): value is AddressMetadata & Record<string, unknown> {
  return value.address === subjectAddress &&
    value.source === "tronscan" &&
    nullableString(value.name) &&
    nullableString(value.tag) &&
    (value.isContract === null || typeof value.isContract === "boolean") &&
    (value.verified === null || typeof value.verified === "boolean") &&
    (value.accountType === null || typeof value.accountType === "number" && Number.isFinite(value.accountType)) &&
    record(value.rawJson) !== null;
}

function validPersistedContractProfile(
  value: Record<string, unknown>,
  subjectAddress: string
): value is ContractIntelligenceProfile & Record<string, unknown> {
  if (value.contractAddress !== subjectAddress ||
    !Array.isArray(value.providerTags) ||
    !Array.isArray(value.publicTags) ||
    (value.isVerified !== null && typeof value.isVerified !== "boolean") ||
    !optionalNullableBoolean(value.verified) ||
    (value.providerRisk !== null && typeof value.providerRisk !== "boolean") ||
    !optionalNullableString(value.serviceTag) ||
    !optionalNullableString(value.publicTag) ||
    !optionalNullableString(value.publicTagDesc) ||
    (value.activityLevel !== "none" && value.activityLevel !== "low" && value.activityLevel !== "normal" && value.activityLevel !== "high" && value.activityLevel !== "unknown") ||
    !record(value.methodMap) ||
    !Array.isArray(value.topMethods)) return false;
  if (!value.providerTags.every((item) => {
    const tag = record(item);
    return tag !== null && typeof tag.label === "string";
  })) return false;
  if (!value.publicTags.every((item) => {
    const tag = record(item);
    return tag !== null && typeof tag.label === "string" && optionalNullableString(tag.description);
  })) return false;
  if (!Object.values(value.methodMap as Record<string, unknown>).every((item) => typeof item === "string")) return false;
  return value.topMethods.every((item) => {
    const method = record(item);
    return method !== null && typeof method.methodId === "string" &&
      nullableString(method.signature) &&
      (method.method === undefined || typeof method.method === "string");
  });
}

function sameFingerprint(left: Verify20FingerprintResult, right: Verify20FingerprintResult): boolean {
  return left.matched === right.matched &&
    left.blockedByTrustedService === right.blockedByTrustedService &&
    left.selectors.join(":") === right.selectors.join(":") &&
    left.missingSelectors.join(":") === right.missingSelectors.join(":") &&
    left.mismatchedSelectors.join(":") === right.mismatchedSelectors.join(":");
}

/** Treat persisted contract analysis as untrusted; exact fingerprints are re-derived from the saved profile. */
export function normalizeSmartContractCheckReport(
  value: unknown,
  expectedSubjectAddress?: string
): SmartContractCheckReport | null {
  const report = record(value);
  if (!report || typeof report.subjectAddress !== "string" || report.subjectAddress.length === 0) return null;
  if (expectedSubjectAddress && !sameAddress(report.subjectAddress, expectedSubjectAddress)) return null;
  if (report.decision !== "ACCEPTABLE" && report.decision !== "REVIEW" && report.decision !== "DECLINE") return null;
  if (report.decisionScope !== "contract_safety" && report.decisionScope !== "approval_safety") return null;
  if (typeof report.riskScore !== "number" || !Number.isInteger(report.riskScore) || report.riskScore < 0 || report.riskScore > 100) return null;
  if (report.riskLevel !== riskLevelFromScore(report.riskScore)) return null;
  if (typeof report.exactDrainProven !== "boolean") return null;
  if (report.exactDrainProven) return null;
  if (report.serviceLabel !== null && typeof report.serviceLabel !== "string") return null;
  if (report.activityLabel !== "none" && report.activityLabel !== "low" && report.activityLabel !== "normal" && report.activityLabel !== "high" && report.activityLabel !== "unknown") return null;
  if (!stringArray(report.reasons) || !stringArray(report.limitations) || !Array.isArray(report.relatedApprovals)) return null;
  if (report.llmVerdict !== null && !record(report.llmVerdict)) return null;

  const metadata = record(report.metadata);
  if (!metadata || !validPersistedMetadata(metadata, report.subjectAddress)) return null;
  const profile = report.contractProfile === null ? null : record(report.contractProfile);
  if (report.contractProfile !== null && !profile) return null;
  if (profile && !validPersistedContractProfile(profile, report.subjectAddress)) return null;
  if (report.activityLabel !== activityLabel(profile)) return null;

  const verify20ServiceLabel = authoritativeVerify20ServiceLabel(metadata, profile);
  const trustedServiceLabel = verify20ServiceLabel ?? verifiedServiceLabel(metadata, profile);
  if (report.serviceLabel !== trustedServiceLabel) return null;

  const fingerprint = record(report.verify20Fingerprint);
  if (!fingerprint || typeof fingerprint.matched !== "boolean" ||
    typeof fingerprint.blockedByTrustedService !== "boolean" ||
    !stringArray(fingerprint.selectors) || !stringArray(fingerprint.missingSelectors) || !stringArray(fingerprint.mismatchedSelectors)) return null;
  const derived = detectVerify20Fingerprint({
    methodMap: profile?.methodMap as Record<string, string> | undefined,
    topMethods: profile?.topMethods as ContractIntelligenceProfile["topMethods"] | undefined,
    serviceLabel: verify20ServiceLabel
  });
  if (!sameFingerprint(fingerprint as Verify20FingerprintResult, derived)) return null;
  if (derived.matched && (report.decision !== "DECLINE" || report.riskScore < 85 || report.serviceLabel !== null)) return null;

  return { ...report, llmVerdict: null } as unknown as SmartContractCheckReport;
}

export async function checkSmartContractAddress(input: CheckSmartContractAddressInput): Promise<SmartContractCheckReport> {
  const decisionInput = {
    subjectAddress: input.address,
    metadata: input.metadata,
    contractProfile: input.contractProfile,
    serviceClassification: input.serviceClassification,
    approvalSafetyAssessments: input.approvalSafetyAssessments ?? []
  };
  const evidence = input.contractDecisionEvidence ?? buildContractDecisionEvidenceV1(decisionInput);
  const contractDecisionV2 = resolveContractDecisionV2({ ...decisionInput, evidence });
  const legacy = evaluateSmartContractAddress({
    subjectAddress: input.address,
    metadata: input.metadata,
    contractProfile: input.contractProfile,
    relatedApprovals: input.relatedApprovals,
    llmVerdict: null
  });
  if (!contractDecisionV2) throw new Error("contract_decision_binding_failed");
  const deterministic = contractDecisionV2.deterministic;
  return {
    ...legacy,
    decision: deterministic.decision,
    riskScore: deterministic.score,
    riskLevel: deterministic.level,
    reasons: [`contract_decision_${deterministic.authority}`],
    llmVerdict: null,
    contractDecisionV2
  };
}
