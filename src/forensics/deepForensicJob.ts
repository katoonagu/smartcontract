import { runDeepAddressForensicCheck, type DeepAddressForensicDeps, type DeepAddressForensicReport } from "../check/deepForensicCheck";
import { FORENSIC_ROUTE_POLICY_VERSION } from "./routeScorer";
import { logger as defaultLogger, type Logger } from "../logging/logger";
import type { AddressLabelAssertionInput, ForensicCheckJob } from "../storage/repositories";
import type { ApprovalDrainProvenanceProfile, CounterpartyRiskProfile, InboundProvenancePath, RawEvidenceInput, RiskSignalObservationInput, StablecoinRestrictionProfile } from "../types";

export type DeepForensicJobRunnerDeps = DeepAddressForensicDeps & {
  getUsdtRestrictionStatus(address: string, options?: { includeEventTimeline?: boolean }): Promise<StablecoinRestrictionProfile>;
  claimNextForensicCheckJob(): Promise<ForensicCheckJob | null>;
  completeForensicCheckJob(input: {
    id: string;
    status: "completed" | "partial" | "failed";
    progressJson: Record<string, unknown>;
    resultJson: Record<string, unknown>;
    rawEvidenceIds: string[];
    observationIds: string[];
    lastError: string | null;
  }): Promise<boolean>;
  recordRiskEvaluation(input: {
    rawEvidence: RawEvidenceInput[];
    observations: RiskSignalObservationInput[];
  }): Promise<void>;
  upsertAddressLabelAssertion?(input: AddressLabelAssertionInput): Promise<unknown>;
  sendJobResult?(job: ForensicCheckJob, report: DeepAddressForensicReport, status: "completed" | "partial"): Promise<void>;
  sendJobFailure?(job: ForensicCheckJob, error: string): Promise<void>;
  logger?: Logger;
};

export type DeepForensicJobRunnerOptions = {
  pageLimit?: number;
  maxPagesPerAddress?: number;
  maxExpandedIntermediates?: number;
  metadataFetchLimit?: number;
  contractProfileFetchLimit?: number;
  maxInboundSenders?: number;
  maxApprovalDrainCandidates?: number;
  approvalChangeLookupLimit?: number;
  extendedSearchMode?: "disabled" | "auto" | "always";
  extendedSearchMaxDepth?: number;
  extendedSearchBeamWidth?: number;
  extendedSearchMaxAddressFetches?: number;
  recentFallbackMinTransferCount?: number;
  recentFallbackTransferLimit?: number;
  apiKeyConfigured?: boolean;
};

type DerivedLabelResult = {
  label: "darknet_exchange_proximity" | "approval_drain_proximity";
  assertionId: string;
} | null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sendDeepForensicJobResultBestEffort(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  report: DeepAddressForensicReport,
  status: "completed" | "partial"
): Promise<void> {
  if (!deps.sendJobResult) return;
  try {
    await deps.sendJobResult(job, report, status);
  } catch (error) {
    (deps.logger ?? defaultLogger).error("deep_forensic_job_result_delivery_failed", {
      job_id: job.id,
      subject_address: job.subjectAddress,
      chat_id: job.chatId,
      status,
      error: errorMessage(error)
    });
  }
}

async function sendDeepForensicJobFailureBestEffort(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  message: string
): Promise<void> {
  if (!deps.sendJobFailure) return;
  try {
    await deps.sendJobFailure(job, message);
  } catch (error) {
    (deps.logger ?? defaultLogger).error("deep_forensic_job_failure_delivery_failed", {
      job_id: job.id,
      subject_address: job.subjectAddress,
      chat_id: job.chatId,
      original_error: message,
      error: errorMessage(error)
    });
  }
}

function topDarknetExchangePath(report: DeepAddressForensicReport): InboundProvenancePath | null {
  const profile = report.inboundProvenanceProfiles[0] ?? null;
  const path = profile?.paths[0] ?? null;
  if (!profile || !path) return null;
  if (profile.score <= 0 || path.label !== "darknet_exchange") return null;
  if (path.depth > 2 || path.amountPreservationRatio < 0.7) return null;
  return path;
}

function topHighRiskCounterpartyProfile(report: DeepAddressForensicReport): CounterpartyRiskProfile | null {
  return report.counterpartyRiskProfiles.find((profile) =>
    profile.score > 0 && (profile.label === "darknet_exchange" || profile.label === "darknet_exchange_proximity")
  ) ?? null;
}

async function persistDerivedDarknetExchangeProximityLabel(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  report: DeepAddressForensicReport
): Promise<DerivedLabelResult> {
  if (!deps.upsertAddressLabelAssertion) return null;
  const path = topDarknetExchangePath(report);
  const counterpartyProfile = path ? null : topHighRiskCounterpartyProfile(report);
  if (!path && !counterpartyProfile) return null;

  const inboundProfile = report.inboundProvenanceProfiles[0];
  const rawEvidenceId = path
    ? report.rawEvidence.find((evidence) => "inboundProvenanceProfile" in evidence.evidenceJson)?.id ?? null
    : report.rawEvidence.find((evidence) => "counterpartyRiskProfile" in evidence.evidenceJson)?.id ?? null;
  const observationId = path
    ? report.observations.find((observation) => observation.code === "forensic_darknet_exchange_provenance")?.id ?? null
    : report.observations.find((observation) => observation.code.startsWith("forensic_counterparty_darknet_exchange"))?.id ?? null;
  const assertionId = `derived_tron_darknet_exchange_proximity_${report.subjectAddress}`;
  const firstSeenAt = path?.firstTransferAt ?? counterpartyProfile?.firstTransferAt;
  const lastSeenAt = path?.lastTransferAt ?? counterpartyProfile?.lastTransferAt;

  await deps.upsertAddressLabelAssertion({
    id: assertionId,
    chain: "tron",
    address: report.subjectAddress,
    label: "darknet_exchange_proximity",
    entityName: "Derived darknet exchange proximity",
    category: "darknet_exchange_proximity",
    confidence: "high",
    severity: "high",
    status: "active",
    sourceName: "forensic_route_search",
    sourceUrl: null,
    notes: "System-derived marker from exact TRON USDT exposure to a manually verified darknet exchange seed or derived high-risk counterparty.",
    evidenceJson: {
      policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
      phase: "10A.8",
      source: "forensic_route_search",
      subjectAddress: report.subjectAddress,
      ...(path ? {
        seedAddress: path.sourceAddress,
        hopDepth: path.depth,
        viaAddresses: path.viaAddresses,
        txHashes: path.txHashes,
        amountRaw: path.amountRaw,
        amountPreservationRatio: path.amountPreservationRatio,
        matchedInboundVolumeRaw: inboundProfile?.matchedInboundVolumeRaw ?? "0"
      } : {
        counterpartyAddress: counterpartyProfile?.counterpartyAddress,
        counterpartyLabel: counterpartyProfile?.label,
        direction: counterpartyProfile?.direction,
        txHashes: counterpartyProfile?.txHashes ?? [],
        amountRaw: counterpartyProfile?.amountRaw ?? "0",
        volumeRatio: counterpartyProfile?.volumeRatio ?? 0,
        txCount: counterpartyProfile?.txCount ?? 0
      }),
      firstTransferAt: firstSeenAt,
      lastTransferAt: lastSeenAt,
      windowStart: report.windowStart.toISOString(),
      windowEnd: report.windowEnd.toISOString(),
      rawEvidenceId,
      observationId,
      jobId: job.id
    },
    createdByTelegramId: null,
    derivedLabelSource: "system",
    firstSeenAt: new Date(firstSeenAt ?? report.windowStart.toISOString()),
    lastSeenAt: new Date(lastSeenAt ?? report.windowEnd.toISOString())
  });

  return {
    label: "darknet_exchange_proximity",
    assertionId
  };
}

function topApprovalDrainProfile(report: DeepAddressForensicReport): ApprovalDrainProvenanceProfile | null {
  return report.approvalDrainProvenanceProfiles.find((profile) => profile.score > 0) ?? null;
}

async function persistDerivedApprovalDrainProximityLabel(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  report: DeepAddressForensicReport
): Promise<DerivedLabelResult> {
  if (!deps.upsertAddressLabelAssertion) return null;
  const profile = topApprovalDrainProfile(report);
  if (!profile) return null;
  const rawEvidenceId = report.rawEvidence.find((evidence) => "approvalDrainProvenanceProfile" in evidence.evidenceJson)?.id ?? null;
  const observationId = report.observations.find((observation) => observation.code === "forensic_approval_drain_provenance")?.id ?? null;
  const assertionId = `derived_tron_approval_drain_proximity_${report.subjectAddress}`;

  await deps.upsertAddressLabelAssertion({
    id: assertionId,
    chain: "tron",
    address: report.subjectAddress,
    label: "approval_drain_proximity",
    entityName: "Derived approval-drain proximity",
    category: "approval_drain_proximity",
    confidence: "high",
    severity: profile.score >= 90 ? "critical" : "high",
    status: "active",
    sourceName: "forensic_route_search",
    sourceUrl: null,
    notes: "System-derived marker from exact TRON USDT approval-drain provenance linked to this address.",
    evidenceJson: {
      policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
      phase: "10A.10",
      source: "forensic_route_search",
      subjectAddress: report.subjectAddress,
      victimAddress: profile.victimAddress,
      spenderAddress: profile.spenderAddress,
      firstReceiverAddress: profile.firstReceiverAddress,
      hopDepth: profile.hopDepth,
      approvalTxHash: profile.approvalTxHash,
      drainTxHash: profile.drainTxHash,
      pathTxHashes: profile.pathTxHashes,
      pathAddresses: profile.pathAddresses,
      amountRaw: profile.amountRaw,
      amountPreservationRatio: profile.amountPreservationRatio,
      score: profile.score,
      evidenceStrength: profile.evidenceStrength,
      approvalAt: profile.approvalAt,
      drainAt: profile.drainAt,
      windowStart: report.windowStart.toISOString(),
      windowEnd: report.windowEnd.toISOString(),
      rawEvidenceId,
      observationId,
      jobId: job.id
    },
    createdByTelegramId: null,
    derivedLabelSource: "system",
    firstSeenAt: new Date(profile.approvalAt),
    lastSeenAt: new Date(profile.drainAt)
  });

  return {
    label: "approval_drain_proximity",
    assertionId
  };
}

export async function runSingleDeepForensicJobCycle(
  deps: DeepForensicJobRunnerDeps,
  options: DeepForensicJobRunnerOptions = {}
): Promise<boolean> {
  const job = await deps.claimNextForensicCheckJob();
  if (!job) return false;

  try {
    const report = await runDeepAddressForensicCheck(deps, {
      sourceAddress: job.subjectAddress,
      windowStart: job.windowStart,
      windowEnd: job.windowEnd,
      maxDepth: 2,
      pageLimit: options.pageLimit,
      maxPagesPerAddress: options.maxPagesPerAddress ?? 2,
      maxExpandedIntermediates: options.maxExpandedIntermediates ?? 10,
      metadataFetchLimit: options.metadataFetchLimit ?? 12,
      contractProfileFetchLimit: options.contractProfileFetchLimit ?? 5,
      maxInboundSenders: options.maxInboundSenders ?? 5,
      maxApprovalDrainCandidates: options.maxApprovalDrainCandidates ?? 5,
      approvalChangeLookupLimit: options.approvalChangeLookupLimit ?? 5,
      extendedSearchMode: options.extendedSearchMode ?? "auto",
      extendedSearchMaxDepth: options.extendedSearchMaxDepth ?? 4,
      extendedSearchBeamWidth: options.extendedSearchBeamWidth ?? 8,
      extendedSearchMaxAddressFetches: options.extendedSearchMaxAddressFetches ?? 60,
      recentFallbackMinTransferCount: options.recentFallbackMinTransferCount ?? 60,
      recentFallbackTransferLimit: options.recentFallbackTransferLimit ?? 60,
      apiKeyConfigured: options.apiKeyConfigured
    });
    await deps.recordRiskEvaluation({
      rawEvidence: report.rawEvidence,
      observations: report.observations
    });
    const derivedLabels = [
      await persistDerivedDarknetExchangeProximityLabel(deps, job, report),
      await persistDerivedApprovalDrainProximityLabel(deps, job, report)
    ].filter((label): label is Exclude<DerivedLabelResult, null> => label !== null);
    const derivedLabel = derivedLabels[0] ?? null;
    const status = report.missingChecks.length > 0 ? "partial" : "completed";
    await deps.completeForensicCheckJob({
      id: job.id,
      status,
      progressJson: { ...job.progressJson, ...report.coverage, derivedLabel },
      resultJson: {
        subjectAddress: report.subjectAddress,
        windowStart: report.windowStart.toISOString(),
        windowEnd: report.windowEnd.toISOString(),
        serviceExposureProfiles: report.serviceExposureProfiles,
        addressBehaviorProfiles: report.addressBehaviorProfiles,
        inboundProvenanceProfiles: report.inboundProvenanceProfiles,
        counterpartyRiskProfiles: report.counterpartyRiskProfiles,
        approvalDrainProvenanceProfiles: report.approvalDrainProvenanceProfiles,
        stablecoinRestrictionProfiles: report.stablecoinRestrictionProfiles ?? [],
        extendedProvenanceProfiles: report.extendedProvenanceProfiles ?? [],
        derivedLabel,
        derivedLabels,
        missingChecks: report.missingChecks,
        coverage: report.coverage,
        coverageDebug: { ...report.coverageDebug, jobId: job.id, status }
      },
      rawEvidenceIds: report.rawEvidence.map((evidence) => evidence.id),
      observationIds: report.observations.map((observation) => observation.id),
      lastError: null
    });
    await sendDeepForensicJobResultBestEffort(deps, job, report, status);
    return true;
  } catch (error) {
    const message = errorMessage(error);
    await deps.completeForensicCheckJob({
      id: job.id,
      status: "failed",
      progressJson: {},
      resultJson: {},
      rawEvidenceIds: [],
      observationIds: [],
      lastError: message
    });
    await sendDeepForensicJobFailureBestEffort(deps, job, message);
    return true;
  }
}
