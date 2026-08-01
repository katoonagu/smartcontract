import { createHash } from "node:crypto";
import type { ContractRiskContext } from "../approvals/contractIntelligence";
import type { CompleteJsonResult, OpenAiCompatibleJsonClient } from "../llm/openAiCompatibleJsonClient";
import type {
  ApprovalDrainProvenanceProfile,
  ApprovalDrainReviewInterpretation,
  ApprovalDrainReviewFinding,
  BalanceFormingTransfer,
  ContractAnalysisCaseFile,
  ContractLlmVerdictKind,
  ContractLlmVerdictSummary,
  ExchangeDecision,
  MoneyOriginPath,
  MoneyOriginSenderInteractionProfile,
  ServiceClassification
} from "../types";

export const CONTRACT_LLM_VERDICT_POLICY_VERSION = "2026-07-09-contract-llm-v3";

export type BuildContractAnalysisCaseFilesInput = {
  subjectAddress: string;
  currentUsdtBalanceRaw: string | null;
  balanceFormingTransfers: BalanceFormingTransfer[];
  originPaths: MoneyOriginPath[];
  senderInteractionProfiles: MoneyOriginSenderInteractionProfile[];
  approvalDrainProvenanceProfiles: ApprovalDrainProvenanceProfile[];
  approvalDrainReviewFindings: ApprovalDrainReviewFinding[];
  classifications?: Map<string, ServiceClassification | null>;
  contractProfiles?: Map<string, ContractRiskContext | null>;
};

export type ContractLlmDecisionInput = {
  deterministicDecision: ExchangeDecision;
  deterministicRiskScore: number;
  deterministicReasons: string[];
  verdicts: ContractLlmVerdictSummary[];
  riskyMoneyPath: boolean;
};

export type ContractLlmDecisionResult = {
  decision: ExchangeDecision;
  riskScore: number;
  decisionReasons: string[];
};

export type ContractLlmVerdictCacheRecord = {
  id: string;
  contractAddress: string;
  profileHash: string;
  contractFingerprintHash: string;
  cacheScope: string;
  flowContextHash: string | null;
  caseFileHash: string;
  policyVersion: string;
  providerLabel: string;
  model: string;
  verdict: ContractLlmVerdictSummary;
  requestCaseHash: string;
  responseJson: Record<string, unknown>;
  error: string | null;
  latencyMs: number | null;
  createdAt: Date;
  expiresAt: Date;
  updatedAt: Date;
};

export type ContractLlmVerdictCacheLookup = {
  contractAddress: string;
  profileHash: string;
  cacheScope?: string;
  flowContextHash?: string | null;
  policyVersion: string;
  model: string;
  now: Date;
};

export type ContractLlmVerdictFingerprintCacheLookup = {
  contractFingerprintHash: string;
  cacheScope?: string;
  flowContextHash?: string | null;
  policyVersion: string;
  model: string;
  now: Date;
};

export type ContractLlmVerdictAnalyzerDeps = {
  client: OpenAiCompatibleJsonClient;
  providerLabel: string;
  model: string;
  cacheModelKey?: string;
  cacheTtlMs: number;
  requireCompleteCaseFile?: boolean;
  now?: () => Date;
  getCachedVerdict?(input: ContractLlmVerdictCacheLookup): Promise<ContractLlmVerdictCacheRecord | null>;
  getCachedVerdictByFingerprint?(input: ContractLlmVerdictFingerprintCacheLookup): Promise<ContractLlmVerdictCacheRecord | null>;
  upsertVerdict?(input: ContractLlmVerdictCacheRecord): Promise<void>;
};

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.keys(item as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (item as Record<string, unknown>)[key];
        return acc;
      }, {});
  });
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function hashContractAnalysisCaseFile(caseFile: ContractAnalysisCaseFile): string {
  return stableHash(caseFile);
}

export function hashContractProfileForLlm(caseFile: ContractAnalysisCaseFile): string {
  return stableHash({
    contractAddress: caseFile.contractAddress,
    serviceClassification: caseFile.serviceClassification,
    contractProfile: caseFile.contractProfile
  });
}

function normalizeForContractFingerprint(value: unknown, contractAddress: string | null): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeForContractFingerprint(item, contractAddress));
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && contractAddress && value === contractAddress) return "<contract-address>";
    return value;
  }
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, "");
      if (
        normalizedKey === "contractaddress" ||
        normalizedKey === "address" ||
        normalizedKey === "owneraddress" ||
        normalizedKey === "creatoraddress" ||
        normalizedKey === "calleraddress" ||
        normalizedKey === "topcallers" ||
        normalizedKey.endsWith("count") ||
        normalizedKey.endsWith("at") ||
        normalizedKey.endsWith("days")
      ) {
        return acc;
      }
      acc[key] = normalizeForContractFingerprint((value as Record<string, unknown>)[key], contractAddress);
      return acc;
    }, {});
}

export function hashContractFingerprintForLlm(caseFile: ContractAnalysisCaseFile): string {
  return stableHash({
    serviceClassification: {
      category: caseFile.serviceClassification?.category ?? null,
      identity: caseFile.serviceClassification?.identity ?? null,
      isBoundary: caseFile.serviceClassification?.isBoundary ?? null
    },
    contractProfile: normalizeForContractFingerprint(caseFile.contractProfile, caseFile.contractAddress)
  });
}

function amountPreservationBucket(value: number): "exact" | "high" | "medium" | "low" | "unknown" {
  if (typeof value !== "number" || Number.isNaN(value)) return "unknown";
  if (value >= 0.99) return "exact";
  if (value >= 0.8) return "high";
  if (value >= 0.5) return "medium";
  return "low";
}

function guardContext(guards: ApprovalDrainReviewFinding["falsePositiveGuards"]): Array<Record<string, string | null>> {
  return guards
    .map((guard) => ({
      code: guard.code,
      label: guard.label,
      category: guard.category,
      identity: guard.identity
    }))
    .sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
}

function supportingFingerprintCodes(
  fingerprints: ApprovalDrainReviewFinding["supportingFingerprints"] | ApprovalDrainProvenanceProfile["supportingFingerprints"]
): string[] {
  return dedupe((fingerprints ?? []).map((fingerprint) => fingerprint.code)).sort();
}

export function hashContractFlowContextForLlm(caseFile: ContractAnalysisCaseFile): string {
  const approvalEvidenceClass = caseFile.approvalDrainProvenanceProfiles.length > 0
    ? "provenance"
    : caseFile.approvalDrainReviewFindings.length > 0
      ? "review"
      : "none";
  const spenderResolutions = dedupe([
    ...caseFile.approvalDrainProvenanceProfiles.map((profile) => profile.spenderResolution ?? null),
    ...caseFile.approvalDrainReviewFindings.map((finding) => finding.spenderResolution)
  ]).sort();
  return stableHash({
    approvalEvidenceClass,
    transferFromObserved: caseFile.approvalDrainProvenanceProfiles.length > 0 || caseFile.approvalDrainReviewFindings.length > 0,
    spenderResolutions,
    approvalDrainReviewFindings: caseFile.approvalDrainReviewFindings
      .map((finding) => ({
        reason: finding.reason,
        spenderResolution: finding.spenderResolution,
        falsePositiveGuards: guardContext(finding.falsePositiveGuards),
        supportingFingerprintCodes: supportingFingerprintCodes(finding.supportingFingerprints)
      }))
      .sort((a, b) => stableJson(a).localeCompare(stableJson(b))),
    approvalDrainProvenanceProfiles: caseFile.approvalDrainProvenanceProfiles
      .map((profile) => ({
        evidenceStrength: profile.evidenceStrength,
        spenderResolution: profile.spenderResolution ?? null,
        falsePositiveGuards: guardContext(profile.falsePositiveGuards ?? []),
        supportingFingerprintCodes: supportingFingerprintCodes(profile.supportingFingerprints),
        featureCodes: dedupe(profile.features.map((feature) => feature.code)).sort(),
        hopDepth: profile.hopDepth,
        amountPreservationBucket: amountPreservationBucket(profile.amountPreservationRatio)
      }))
      .sort((a, b) => stableJson(a).localeCompare(stableJson(b))),
    serviceClassification: {
      category: caseFile.serviceClassification?.category ?? null,
      identity: caseFile.serviceClassification?.identity ?? null
    },
    originPathStoppedReasons: dedupe(caseFile.originPaths.map((path) => path.stoppedReason)).sort(),
    originPathRootSourceTypes: dedupe(caseFile.originPaths.map((path) => path.rootSourceType)).sort(),
    ...(caseFile.standaloneContractContext
      ? {
          standaloneContractRelatedApprovals: caseFile.standaloneContractContext.relatedApprovals
            .map((approval) => ({
              ownerAddress: approval.ownerAddress,
              watchedWalletAddress: approval.watchedWalletAddress,
              approvalEvidenceId: approval.approvalEvidenceId,
              tokenContract: approval.tokenContract,
              status: approval.status,
              isUnlimited: approval.isUnlimited,
              riskScore: approval.riskScore,
              lastApprovalAt: approval.lastApprovalAt
            }))
            .sort((a, b) => stableJson(a).localeCompare(stableJson(b)))
        }
      : {})
  });
}

function dedupe(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.length > 0)))];
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function contractProfileForCaseFile(profile: ContractRiskContext | null | undefined): Record<string, unknown> | null {
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
    topCallers: profile.topCallers ?? [],
    methodMap: profile.methodMap ?? {},
    hasTransferFromSelector: profile.hasTransferFromSelector ?? null,
    hasOwnerOnlyPattern: profile.hasOwnerOnlyPattern ?? null,
    lowMetadata: profile.lowMetadata ?? null,
    rawPayload: profile.rawPayload ?? profile.rawJson ?? {}
  };
}

function contractAddressesFromInput(input: BuildContractAnalysisCaseFilesInput): string[] {
  const highShareTerminalBoundaryAddresses = new Set(
    input.originPaths
      .filter(isHighShareTerminalBoundary)
      .map((path) => path.rootSourceAddress)
      .filter((address): address is string => Boolean(address))
  );
  const addresses = [
    ...input.approvalDrainProvenanceProfiles.map((profile) => profile.spenderAddress),
    ...input.approvalDrainReviewFindings.map((finding) => finding.spenderAddress),
    ...input.originPaths.flatMap((path) => [path.rootSourceAddress, ...path.pathAddresses])
  ];
  return dedupe(addresses).filter((address) => {
    const classification = input.classifications?.get(address) ?? null;
    return Boolean(
      input.contractProfiles?.has(address) ||
      classification?.category === "unknown_contract" ||
      classification?.category === "router" ||
      classification?.category === "bridge" ||
      classification?.category === "bridge_pool" ||
      classification?.category === "dex" ||
      classification?.category === "swap_adapter" ||
      highShareTerminalBoundaryAddresses.has(address) ||
      input.approvalDrainReviewFindings.some((finding) => finding.spenderAddress === address && finding.spenderResolution === "wrapper_contract") ||
      input.approvalDrainProvenanceProfiles.some((profile) => profile.spenderAddress === address && profile.spenderResolution === "wrapper_contract")
    );
  });
}

function isHighShareTerminalBoundary(path: MoneyOriginPath): boolean {
  return Boolean(path.rootSourceAddress) &&
    (path.stoppedReason === "unlabeled_service_boundary" ||
      path.sourceExposureKind === "unknown_contract" ||
      path.sourceExposureKind === "bridge_router_dex") &&
    ((path.balanceShare ?? 0) >= 0.5 || path.riskScoreContribution >= 35);
}

function evidenceIds(input: {
  contractAddress: string | null;
  balanceFormingTransfers: BalanceFormingTransfer[];
  originPaths: MoneyOriginPath[];
  approvalDrainProvenanceProfiles: ApprovalDrainProvenanceProfile[];
  approvalDrainReviewFindings: ApprovalDrainReviewFinding[];
}): string[] {
  return dedupe([
    input.contractAddress,
    ...input.balanceFormingTransfers.map((transfer) => transfer.txHash),
    ...input.originPaths.flatMap((path) => path.txHashes),
    ...input.approvalDrainProvenanceProfiles.flatMap((profile) => [
      profile.approvalTxHash,
      profile.drainTxHash,
      ...profile.pathTxHashes
    ]),
    ...input.approvalDrainReviewFindings.map((finding) => finding.drainTxHash)
  ]);
}

function matchingProvenanceProfile(
  finding: ApprovalDrainReviewFinding,
  profiles: ApprovalDrainProvenanceProfile[]
): ApprovalDrainProvenanceProfile | null {
  if (finding.reason === "approval_not_found") return null;
  return profiles.find((profile) =>
    profile.drainTxHash === finding.drainTxHash &&
    profile.spenderAddress === finding.spenderAddress &&
    profile.victimAddress === finding.victimAddress &&
    profile.firstReceiverAddress === finding.firstReceiverAddress &&
    profile.subjectAddress === finding.subjectAddress
  ) ?? null;
}

function approvalDrainReviewInterpretations(input: {
  approvalDrainReviewFindings: ApprovalDrainReviewFinding[];
  approvalDrainProvenanceProfiles: ApprovalDrainProvenanceProfile[];
}): ApprovalDrainReviewInterpretation[] {
  return input.approvalDrainReviewFindings.map((finding) => {
    const matchingProfile = matchingProvenanceProfile(finding, input.approvalDrainProvenanceProfiles);
    return {
      drainTxHash: finding.drainTxHash,
      spenderAddress: finding.spenderAddress,
      firstReceiverAddress: finding.firstReceiverAddress,
      reason: finding.reason,
      reviewFindingInterpretation: "candidate_only_not_exact_proof",
      exactApprovalProofStatus: matchingProfile
        ? "found"
        : finding.reason === "approval_not_found"
          ? "not_found"
          : "not_checked",
      transferFromProofStatus: matchingProfile?.evidenceStrength === "exact_approval_and_transfer_from"
        ? "confirmed"
        : finding.spenderResolution === "wrapper_contract"
          ? "suspected_wrapper"
          : "not_confirmed",
      spenderMatchStatus: finding.spenderAddress
        ? finding.spenderResolution === "unknown" ? "unknown" : "matched"
        : "not_matched",
      pathToCheckedWalletStatus: matchingProfile
        ? "proven"
        : finding.reason === "service_boundary_guard"
          ? "blocked_by_service_boundary"
          : "not_proven"
    };
  });
}

export function buildContractAnalysisCaseFiles(input: BuildContractAnalysisCaseFilesInput): ContractAnalysisCaseFile[] {
  return contractAddressesFromInput(input).map((contractAddress) => {
    const approvalDrainProvenanceProfiles = input.approvalDrainProvenanceProfiles
      .filter((profile) => profile.spenderAddress === contractAddress);
    const approvalDrainReviewFindings = input.approvalDrainReviewFindings
      .filter((finding) => finding.spenderAddress === contractAddress);
    const originPaths = input.originPaths
      .filter((path) => path.rootSourceAddress === contractAddress || path.pathAddresses.includes(contractAddress));
    const caseFile: ContractAnalysisCaseFile = {
      policyVersion: CONTRACT_LLM_VERDICT_POLICY_VERSION,
      subjectAddress: input.subjectAddress,
      checkedWalletAddress: input.subjectAddress,
      contractAddress,
      currentUsdtBalanceRaw: input.currentUsdtBalanceRaw,
      balanceFormingTransfers: input.balanceFormingTransfers,
      originPaths,
      senderInteractionProfiles: input.senderInteractionProfiles,
      approvalDrainProvenanceProfiles,
      approvalDrainReviewFindings,
      approvalDrainReviewInterpretations: approvalDrainReviewInterpretations({
        approvalDrainReviewFindings,
        approvalDrainProvenanceProfiles
      }),
      serviceClassification: input.classifications?.get(contractAddress) ?? null,
      contractProfile: contractProfileForCaseFile(input.contractProfiles?.get(contractAddress) ?? null),
      evidenceIds: [],
      policyQuestion: "Classify whether this contract/flow is a legitimate service route or a drainer-like approval/transferFrom scenario. Return JSON only."
    };
    caseFile.evidenceIds = evidenceIds(caseFile);
    return caseFile;
  });
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string" && value.trim().length > 0) return [value.trim()];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function confidenceValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return clampNumber(value, 0, 1, 0);
  if (typeof value !== "string") return 0;
  const normalized = value.trim().toLowerCase();
  if (normalized === "high") return 0.9;
  if (normalized === "medium") return 0.6;
  if (normalized === "low") return 0.3;
  const percentMatch = normalized.match(/^(\d+(?:\.\d+)?)%$/);
  if (percentMatch) return clampNumber(Number(percentMatch[1]) / 100, 0, 1, 0);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return clampNumber(parsed > 1 ? parsed / 100 : parsed, 0, 1, 0);
}

function isVerdict(value: unknown): value is ContractLlmVerdictKind {
  return value === "legitimate_service" ||
    value === "drainer_like" ||
    value === "unknown_suspicious" ||
    value === "unknown_insufficient_data";
}

function parseVerdictJson(input: {
  json: Record<string, unknown>;
  caseFile: ContractAnalysisCaseFile;
  providerLabel: string;
  model: string;
  caseFileHash: string;
  cacheId: string | null;
}): ContractLlmVerdictSummary | null {
  if (!isVerdict(input.json.verdict)) return null;
  const recommendation = input.json.decisionRecommendation === "ACCEPTABLE" ? "ACCEPTABLE" : "DECLINE";
  return {
    source: "llm",
    cacheMatch: null,
    reusedFromContractAddress: null,
    providerLabel: input.providerLabel,
    model: input.model,
    contractAddress: input.caseFile.contractAddress,
    caseFileHash: input.caseFileHash,
    cacheId: input.cacheId,
    verdict: input.json.verdict,
    confidence: confidenceValue(input.json.confidence),
    contractRiskScore: clampNumber(input.json.contractRiskScore, 0, 100, 65),
    decisionRecommendation: recommendation,
    reasons: stringArray(input.json.reasons).slice(0, 5),
    citedEvidenceIds: stringArray(input.json.citedEvidenceIds).slice(0, 10),
    falsePositiveNotes: stringArray(input.json.falsePositiveNotes).slice(0, 5)
  };
}

export function createUnavailableContractLlmVerdict(input: {
  contractAddress: string | null;
  caseFileHash: string;
  providerLabel: string;
  model: string;
  error: string;
  cacheId?: string | null;
}): ContractLlmVerdictSummary {
  return {
    source: "unavailable",
    cacheMatch: null,
    reusedFromContractAddress: null,
    providerLabel: input.providerLabel,
    model: input.model,
    contractAddress: input.contractAddress,
    caseFileHash: input.caseFileHash,
    cacheId: input.cacheId ?? null,
    verdict: "unknown_insufficient_data",
    confidence: 0,
    contractRiskScore: 65,
    decisionRecommendation: "DECLINE",
    reasons: ["Clean contract intent could not be verified automatically."],
    citedEvidenceIds: [],
    falsePositiveNotes: [],
    error: input.error
  };
}

function caseFileEnrichmentError(caseFile: ContractAnalysisCaseFile): string | null {
  if (!caseFile.contractAddress) return null;
  if (!caseFile.serviceClassification) return "contract service classification was not fully enriched before LLM analysis";
  if (!caseFile.contractProfile) return "contract intelligence profile was not fully enriched before LLM analysis";
  return null;
}

function verdictReason(verdict: ContractLlmVerdictSummary): string {
  const confidence = `${Math.round(verdict.confidence * 100)}%`;
  const reason = verdict.reasons[0] ? `; ${verdict.reasons[0]}` : "";
  return `AI contract verdict: ${verdict.verdict} ${confidence} confidence${reason}`;
}

export function applyContractLlmVerdictsToDecision(input: ContractLlmDecisionInput): ContractLlmDecisionResult {
  if (input.deterministicDecision === "DECLINE") {
    return {
      decision: input.deterministicDecision,
      riskScore: input.deterministicRiskScore,
      decisionReasons: input.deterministicReasons
    };
  }

  const drainer = input.verdicts
    .filter((verdict) =>
      verdict.verdict === "drainer_like" &&
      verdict.confidence >= 0.75 &&
      verdict.decisionRecommendation === "DECLINE"
    )
    .sort((a, b) => b.contractRiskScore - a.contractRiskScore)[0] ?? null;
  if (drainer) {
    return {
      decision: "DECLINE",
      riskScore: Math.max(input.deterministicRiskScore, drainer.contractRiskScore),
      decisionReasons: [verdictReason(drainer), ...input.deterministicReasons]
    };
  }

  const unknownSuspicious = input.verdicts
    .find((verdict) =>
      verdict.verdict === "unknown_suspicious" &&
      input.riskyMoneyPath &&
      verdict.confidence >= 0.7 &&
      verdict.contractRiskScore >= 65
    );
  if (unknownSuspicious) {
    return {
      decision: "DECLINE",
      riskScore: Math.max(input.deterministicRiskScore, unknownSuspicious.contractRiskScore, 78),
      decisionReasons: [verdictReason(unknownSuspicious), ...input.deterministicReasons]
    };
  }

  if (input.deterministicDecision === "REVIEW") {
    const reason = input.verdicts.find((verdict) => verdict.source === "unavailable")?.error;
    return {
      decision: "DECLINE",
      riskScore: Math.max(input.deterministicRiskScore, 65),
      decisionReasons: [
        `Clean source could not be proven; exchange policy declines this wallet by safe default.${reason ? ` LLM unavailable: ${reason}.` : ""}`,
        ...input.deterministicReasons
      ]
    };
  }

  return {
    decision: input.deterministicDecision,
    riskScore: input.deterministicRiskScore,
    decisionReasons: input.deterministicReasons
  };
}

const systemPrompt = [
  "You are a deterministic crypto-forensics contract classifier.",
  "Use only facts in the case file. Do not invent labels, victims, source code, or intent.",
  "Return a single JSON object with keys: verdict, confidence, contractRiskScore, decisionRecommendation, reasons, citedEvidenceIds, falsePositiveNotes.",
  "verdict must be one of legitimate_service, drainer_like, unknown_suspicious, unknown_insufficient_data.",
  "decisionRecommendation must be ACCEPTABLE or DECLINE.",
  "approvalDrainProvenanceProfiles are deterministic evidence candidates; exact approval-drain requires deterministic approve, spender, transferFrom, and path proof in the case file.",
  "approvalDrainReviewFindings are unresolved review candidates, not confirmed drains. Use approvalDrainReviewInterpretations for their proof status.",
  "approval_not_found means exact approval proof was not found and weakens exact approval-drain proof.",
  "Do not call exact approval-drain unless the case file contains deterministic approve/spender/transferFrom/path proof.",
  "Service classifications, receiver classifications, route adapters, bridge/router/DEX labels, and economic output are false-positive guards.",
  "Verify20 and similar wrapper methods have been observed across drainer-like campaigns. Treat them as strong drainer-campaign context when they appear with approval/transferFrom evidence, repeated receiver patterns, or weak service guards.",
  "Do not classify a contract as exact drainer proof from the Verify20 method name alone; exact proof still requires deterministic approve, spender, transferFrom, and receiver/path evidence.",
  "Dust/marker tokens, misleading method names, single-method proxies, unverified contracts, and low post-flow balance are supporting context only.",
  "If verdict is drainer_like or unknown_suspicious, include falsePositiveNotes explaining why the case may still be a normal bridge/router/service route."
].join("\n");

function userPrompt(caseFile: ContractAnalysisCaseFile): string {
  return JSON.stringify({
    instructions: "Classify this case file for an exchange wallet check. Return JSON only.",
    caseFile
  });
}

function cacheRecord(input: {
  id: string;
  caseFile: ContractAnalysisCaseFile;
  profileHash: string;
  contractFingerprintHash: string;
  flowContextHash: string;
  caseFileHash: string;
  verdict: ContractLlmVerdictSummary;
  providerLabel: string;
  model: string;
  responseJson: Record<string, unknown>;
  error: string | null;
  latencyMs: number | null;
  now: Date;
  cacheTtlMs: number;
}): ContractLlmVerdictCacheRecord {
  return {
    id: input.id,
    contractAddress: input.caseFile.contractAddress ?? "unknown",
    profileHash: input.profileHash,
    contractFingerprintHash: input.contractFingerprintHash,
    cacheScope: "address_flow",
    flowContextHash: input.flowContextHash,
    caseFileHash: input.caseFileHash,
    policyVersion: input.caseFile.policyVersion,
    providerLabel: input.providerLabel,
    model: input.model,
    verdict: { ...input.verdict, cacheId: input.id },
    requestCaseHash: input.caseFileHash,
    responseJson: input.responseJson,
    error: input.error,
    latencyMs: input.latencyMs,
    createdAt: input.now,
    expiresAt: new Date(input.now.getTime() + input.cacheTtlMs),
    updatedAt: input.now
  };
}

function adaptCachedVerdict(input: {
  cached: ContractLlmVerdictCacheRecord;
  caseFile: ContractAnalysisCaseFile;
  caseFileHash: string;
  cacheMatch: "address" | "fingerprint";
}): ContractLlmVerdictSummary {
  const currentEvidenceIds = new Set(input.caseFile.evidenceIds);
  const reparsedVerdict = parseVerdictJson({
    json: input.cached.responseJson,
    caseFile: input.caseFile,
    providerLabel: input.cached.verdict.providerLabel,
    model: input.cached.verdict.model,
    caseFileHash: input.caseFileHash,
    cacheId: input.cached.id
  });
  const baseVerdict = reparsedVerdict ?? input.cached.verdict;
  const citedEvidenceIds = baseVerdict.citedEvidenceIds
    .filter((id) => currentEvidenceIds.has(id));
  return {
    ...baseVerdict,
    source: "cache",
    cacheMatch: input.cacheMatch,
    reusedFromContractAddress: input.cacheMatch === "fingerprint" ? input.cached.contractAddress : null,
    contractAddress: input.caseFile.contractAddress,
    caseFileHash: input.caseFileHash,
    cacheId: input.cached.id,
    citedEvidenceIds: citedEvidenceIds.length > 0 ? citedEvidenceIds : input.caseFile.evidenceIds.slice(0, 10)
  };
}

export function createContractLlmVerdictAnalyzer(deps: ContractLlmVerdictAnalyzerDeps): (caseFiles: ContractAnalysisCaseFile[]) => Promise<ContractLlmVerdictSummary[]> {
  const now = deps.now ?? (() => new Date());
  const fingerprintMemory = new Map<string, ContractLlmVerdictCacheRecord>();
  return async (caseFiles) => {
    const cacheModelKey = deps.cacheModelKey ?? deps.model;
    const results: ContractLlmVerdictSummary[] = [];
    for (const caseFile of caseFiles) {
      const caseFileHash = hashContractAnalysisCaseFile(caseFile);
      const enrichmentError = deps.requireCompleteCaseFile === true ? caseFileEnrichmentError(caseFile) : null;
      if (enrichmentError) {
        results.push(createUnavailableContractLlmVerdict({
          contractAddress: caseFile.contractAddress,
          caseFileHash,
          providerLabel: deps.providerLabel,
          model: deps.model,
          error: enrichmentError
        }));
        continue;
      }
      const profileHash = hashContractProfileForLlm(caseFile);
      const contractFingerprintHash = hashContractFingerprintForLlm(caseFile);
      const flowContextHash = hashContractFlowContextForLlm(caseFile);
      const policyVersion = caseFile.policyVersion;
      const fingerprintMemoryKey = `${policyVersion}:${contractFingerprintHash}:${flowContextHash}`;
      const contractAddress = caseFile.contractAddress ?? "unknown";
      const cached = caseFile.contractAddress
        ? await deps.getCachedVerdict?.({
            contractAddress,
            profileHash,
            cacheScope: "address_flow",
            flowContextHash,
            policyVersion,
            model: cacheModelKey,
            now: now()
          }).catch(() => null) ?? null
        : null;
      if (cached && cached.verdict.source !== "unavailable" && !cached.error) {
        fingerprintMemory.set(fingerprintMemoryKey, cached);
        results.push(adaptCachedVerdict({ cached, caseFile, caseFileHash, cacheMatch: "address" }));
        continue;
      }

      const memoryCached = fingerprintMemory.get(fingerprintMemoryKey) ?? null;
      const storedFingerprintCached = await deps.getCachedVerdictByFingerprint?.({
        contractFingerprintHash,
        cacheScope: "address_flow",
        flowContextHash,
        policyVersion,
        model: cacheModelKey,
        now: now()
      }).catch(() => null) ?? null;
      const fingerprintCached = memoryCached ?? storedFingerprintCached;
      if (fingerprintCached && fingerprintCached.verdict.source !== "unavailable" && !fingerprintCached.error) {
        const adapted = adaptCachedVerdict({
          cached: fingerprintCached,
          caseFile,
          caseFileHash,
          cacheMatch: "fingerprint"
        });
        const aliasCacheId = stableHash([policyVersion, contractAddress, profileHash, flowContextHash, cacheModelKey]);
        const current = now();
        await deps.upsertVerdict?.(cacheRecord({
          id: aliasCacheId,
          caseFile,
          profileHash,
          contractFingerprintHash,
          flowContextHash,
          caseFileHash,
          verdict: { ...adapted, cacheId: aliasCacheId },
          providerLabel: deps.providerLabel,
          model: cacheModelKey,
          responseJson: fingerprintCached.responseJson,
          error: fingerprintCached.error,
          latencyMs: null,
          now: current,
          cacheTtlMs: deps.cacheTtlMs
        })).catch(() => undefined);
        results.push(adapted);
        continue;
      }

      const response: CompleteJsonResult = await deps.client.completeJson({
        systemPrompt,
        userPrompt: userPrompt(caseFile)
      });
      const cacheId = stableHash([policyVersion, contractAddress, profileHash, flowContextHash, cacheModelKey]);
      const verdict = response.ok
        ? parseVerdictJson({
            json: response.json,
            caseFile,
            providerLabel: deps.providerLabel,
            model: deps.model,
            caseFileHash,
            cacheId
          }) ?? createUnavailableContractLlmVerdict({
            contractAddress: caseFile.contractAddress,
            caseFileHash,
            providerLabel: deps.providerLabel,
            model: deps.model,
            error: "invalid verdict schema",
            cacheId
          })
        : createUnavailableContractLlmVerdict({
            contractAddress: caseFile.contractAddress,
            caseFileHash,
            providerLabel: deps.providerLabel,
            model: deps.model,
            error: response.error,
            cacheId
          });

      const current = now();
      if (verdict.source === "llm") {
        const record = cacheRecord({
          id: cacheId,
          caseFile,
          profileHash,
          contractFingerprintHash,
          flowContextHash,
          caseFileHash,
          verdict,
          providerLabel: deps.providerLabel,
          model: cacheModelKey,
          responseJson: response.ok ? response.json : objectRecord({ error: response.errorCode, message: response.error }) ?? {},
          error: null,
          latencyMs: response.latencyMs,
          now: current,
          cacheTtlMs: deps.cacheTtlMs
        });
        fingerprintMemory.set(fingerprintMemoryKey, record);
        await deps.upsertVerdict?.(record).catch(() => undefined);
      }
      results.push(verdict);
    }
    return results;
  };
}
