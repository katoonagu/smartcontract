import type { AppConfig } from "../config";
import { DEFAULT_DEEP_ECONOMIC_EDGE_TRANSACTION_INFO_FETCH_LIMIT } from "../check/deepForensicCheck";
import {
  DEEP_FORENSIC_RUNTIME_RECENT_FALLBACK_MIN_TRANSFER_COUNT,
  DEEP_FORENSIC_RUNTIME_RECENT_FALLBACK_TRANSFER_LIMIT,
  type DeepForensicJobRunnerOptions
} from "../forensics/deepForensicJob";

export function deepForensicRuntimeOptions(
  config: Pick<
    AppConfig,
    | "tronscanPageLimit"
    | "crossChainStage2Enabled"
    | "crossChainStage2MaxProviderCalls"
    | "tronAddressIndexSecondLayerMaxActiveWalletsPerJob"
    | "adminSecondLayerMaxActiveWallets"
    | "directHardEvidenceLiveLimit"
    | "directHardEvidenceConcurrency"
  >,
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
    economicEdgeTransactionInfoFetchLimit: DEFAULT_DEEP_ECONOMIC_EDGE_TRANSACTION_INFO_FETCH_LIMIT,
    extendedSearchMode: "always",
    extendedSearchMaxDepth: 6,
    extendedSearchBeamWidth: 12,
    extendedSearchMaxAddressFetches: 150,
    recentFallbackMinTransferCount: DEEP_FORENSIC_RUNTIME_RECENT_FALLBACK_MIN_TRANSFER_COUNT,
    maxEdgesPerAddress: 100,
    recentFallbackTransferLimit: DEEP_FORENSIC_RUNTIME_RECENT_FALLBACK_TRANSFER_LIMIT,
    counterpartyFastSnapshotLimit: 60,
    counterpartyFastSnapshotActiveLimit: 30,
    crossChainStage2Enabled: config.crossChainStage2Enabled,
    crossChainMaxProviderCalls: config.crossChainStage2MaxProviderCalls,
    allTimeDeepCheckMode: "partial",
    secondLayerMaxActiveWalletsPerJob: config.tronAddressIndexSecondLayerMaxActiveWalletsPerJob && config.tronAddressIndexSecondLayerMaxActiveWalletsPerJob > 0
      ? config.tronAddressIndexSecondLayerMaxActiveWalletsPerJob
      : config.adminSecondLayerMaxActiveWallets ?? 0,
    directHardEvidenceLiveLimit: config.directHardEvidenceLiveLimit ?? 250,
    directHardEvidenceConcurrency: config.directHardEvidenceConcurrency ?? 8,
    apiKeyConfigured
  };
}
