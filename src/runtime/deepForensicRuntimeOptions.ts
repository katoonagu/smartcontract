import type { AppConfig } from "../config";
import type { DeepForensicJobRunnerOptions } from "../forensics/deepForensicJob";

export function deepForensicRuntimeOptions(
  config: Pick<AppConfig, "tronscanPageLimit" | "crossChainStage2Enabled" | "crossChainStage2MaxProviderCalls">,
  apiKeyConfigured: boolean
): DeepForensicJobRunnerOptions {
  return {
    pageLimit: config.tronscanPageLimit,
    maxPagesPerAddress: 3,
    maxExpandedIntermediates: 30,
    metadataFetchLimit: 30,
    contractProfileFetchLimit: 15,
    maxInboundSenders: 15,
    maxApprovalDrainCandidates: 15,
    approvalChangeLookupLimit: 20,
    extendedSearchMode: "always",
    extendedSearchMaxDepth: 6,
    extendedSearchBeamWidth: 12,
    extendedSearchMaxAddressFetches: 150,
    recentFallbackMinTransferCount: 150,
    recentFallbackTransferLimit: 200,
    counterpartyFastSnapshotLimit: 60,
    counterpartyFastSnapshotActiveLimit: 30,
    crossChainStage2Enabled: config.crossChainStage2Enabled,
    crossChainMaxProviderCalls: config.crossChainStage2MaxProviderCalls,
    apiKeyConfigured
  };
}
