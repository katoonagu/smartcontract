import { CONTRACT_INTELLIGENCE_TTL_MS, type ContractIntelligenceProfile } from "../approvals/contractIntelligence";
import type { ManualRiskSignals } from "./manualCheck";
import {
  observationForStablecoinRestriction,
  rawEvidenceForStablecoinRestriction,
  signalForStablecoinRestriction
} from "./stablecoinRestriction";
import { createTrc20TransferCache, type Trc20TransferCacheOptions } from "../forensics/transferCache";
import {
  runForensicAddressExposureSearch,
  type RouteSearchTronClient
} from "../forensics/routeSearch";
import type { RawTronscanTrc20Transfer } from "../parser/transactionParser";
import type { AddressMetadata } from "../storage/repositories";
import type { RiskConfidence, RiskSeverity, StablecoinRestrictionProfile } from "../types";
import { addressBehaviorEffectiveScore } from "../forensics/addressBehavior";
import type { TronscanAddressMetadata } from "../tron/tronClient";

type AddressExposureTronClient = RouteSearchTronClient & {
  getAddressMetadata?(address: string): Promise<TronscanAddressMetadata>;
  getContractIntelligenceProfile?(
    address: string,
    options?: { now?: Date; ttlMs?: number }
  ): Promise<ContractIntelligenceProfile>;
  getUsdtRestrictionStatus?(address: string): Promise<StablecoinRestrictionProfile>;
};

export type AddressExposureRiskSignalProviderDeps = {
  tronClient: AddressExposureTronClient;
  getAddressMetadata?(address: string, now: Date): Promise<AddressMetadata | null>;
  upsertAddressMetadata?(metadata: AddressMetadata): Promise<void>;
  getContractIntelligenceProfile?(address: string, now: Date): Promise<ContractIntelligenceProfile | null>;
  upsertContractIntelligenceProfile?(profile: ContractIntelligenceProfile): Promise<void>;
  now?: () => Date;
};

export type AddressExposureRiskSignalProviderOptions = {
  days?: number;
  maxDepth?: number;
  maxPagesPerAddress?: number;
  pageLimit?: number;
  limit?: number;
  contractProfileFetchLimit?: number;
  maxExpandedIntermediates?: number;
  timeoutMs?: number;
  transferCacheTtlMs?: number;
  stablecoinRestrictionCacheTtlMs?: number;
  metadataTtlMs?: number;
  contractProfileTtlMs?: number;
  metadataFetchLimit?: number;
  recentFallbackMinTransferCount?: number;
  recentFallbackTransferLimit?: number;
};

const DEFAULT_DAYS = 90;
const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_PAGES_PER_ADDRESS = 2;
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_LIMIT = 10;
const DEFAULT_CONTRACT_PROFILE_FETCH_LIMIT = 15;
const DEFAULT_MAX_EXPANDED_INTERMEDIATES = 30;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TRANSFER_CACHE_TTL_MS = 300_000;
const DEFAULT_STABLECOIN_RESTRICTION_CACHE_TTL_MS = 300_000;
const DEFAULT_METADATA_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_METADATA_FETCH_LIMIT = 30;
const DEFAULT_RECENT_FALLBACK_MIN_TRANSFER_COUNT = 100;
const DEFAULT_RECENT_FALLBACK_TRANSFER_LIMIT = 100;

type TransferLookupOptions = Parameters<RouteSearchTronClient["listRelatedTrc20Transfers"]>[1];
type TransferSnapshots = Map<string, RawTronscanTrc20Transfer[]>;
type StablecoinRestrictionCacheEntry = {
  expiresAtMs: number;
  profile: StablecoinRestrictionProfile;
};

function emptySignals(): ManualRiskSignals {
  return {
    graphSignals: [],
    behaviorSignals: [],
    amlSignals: [],
    rawEvidence: [],
    observations: [],
    serviceExposureProfiles: [],
    addressBehaviorProfiles: [],
    boundaryExposureProfiles: [],
    walletRoleProfiles: [],
    extendedProvenanceProfiles: [],
    stablecoinRestrictionProfiles: [],
    fastCounterpartyTopsProfile: null,
    missingChecks: []
  };
}

function transferLookupKey(address: string, options: TransferLookupOptions = {}): string {
  return JSON.stringify({
    address,
    start: options?.start ?? 0,
    limit: options?.limit ?? null,
    minTimestamp: options?.minTimestamp ?? null,
    endTimestamp: options?.endTimestamp ?? null
  });
}

function metadataFromProvider(metadata: TronscanAddressMetadata, now: Date, ttlMs: number): AddressMetadata {
  return {
    address: metadata.address,
    source: metadata.source,
    name: metadata.name,
    tag: metadata.tag,
    isContract: metadata.isContract,
    verified: metadata.verified,
    accountType: metadata.accountType,
    rawJson: metadata.rawJson,
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + ttlMs)
  };
}

function partialSignals(message: string): ManualRiskSignals {
  return {
    graphSignals: [],
    behaviorSignals: [],
    amlSignals: [],
    rawEvidence: [],
    observations: [],
    serviceExposureProfiles: [],
    addressBehaviorProfiles: [],
    boundaryExposureProfiles: [],
    walletRoleProfiles: [],
    extendedProvenanceProfiles: [],
    stablecoinRestrictionProfiles: [],
    fastCounterpartyTopsProfile: null,
    missingChecks: [`Service exposure check incomplete: ${message}`]
  };
}

function timeoutSignals(timeoutMs: number): ManualRiskSignals {
  return partialSignals(`timed out after ${timeoutMs}ms`);
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function severityForScore(score: number): RiskSeverity {
  if (score >= 85) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "info";
}

function confidenceForScore(score: number): RiskConfidence {
  return score >= 60 ? "high" : "medium";
}

function withTimeout(
  work: (signal: AbortSignal) => Promise<ManualRiskSignals>,
  timeoutMs: number,
  fallback?: () => Promise<ManualRiskSignals>
): Promise<ManualRiskSignals> {
  let timeout: NodeJS.Timeout | null = null;
  const controller = new AbortController();
  const timeoutPromise = new Promise<ManualRiskSignals>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      if (!fallback) {
        resolve(timeoutSignals(timeoutMs));
        return;
      }
      fallback()
        .then((signals) => resolve(signals))
        .catch(() => resolve(timeoutSignals(timeoutMs)));
    }, timeoutMs);
  });
  const workPromise = work(controller.signal);
  workPromise.catch(() => undefined);
  return Promise.race([workPromise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function signalsFromReport(report: Awaited<ReturnType<typeof runForensicAddressExposureSearch>>): ManualRiskSignals {
  const profile = report.serviceExposureProfiles[0] ?? null;
  const behaviorProfile = report.addressBehaviorProfiles[0] ?? null;
  const exposureEvidence = report.rawEvidence.find((evidence) => "serviceExposureProfile" in evidence.evidenceJson) ?? null;
  const behaviorEvidence = report.rawEvidence.find((evidence) => "addressBehaviorProfile" in evidence.evidenceJson) ?? null;
  const boundaryEvidence = report.rawEvidence.find((evidence) => "boundaryExposureProfile" in evidence.evidenceJson) ?? null;
  const exposureObservation = report.observations.find((observation) => observation.code === "forensic_service_exposure") ?? null;
  const behaviorObservation = report.observations.find((observation) => observation.code === "forensic_address_behavior") ?? null;
  const boundaryObservation = report.observations.find((observation) => observation.code === "forensic_boundary_exposure_context") ?? null;
  const boundaryProfile = report.boundaryExposureProfiles?.[0] ?? null;
  const graphSignals = [
    ...(profile && profile.exposureScore > 0
      ? [
        {
          code: "forensic_service_exposure",
          message: "Service exposure candidate; manual review required.",
          scoreImpact: Math.min(50, profile.exposureScore),
          source: "forensic_route_search",
          confidence: exposureObservation?.confidence ?? confidenceForScore(profile.exposureScore),
          severity: exposureObservation?.severity ?? severityForScore(profile.exposureScore),
          evidenceRef: exposureEvidence?.id
        }
      ]
      : []),
    ...(boundaryProfile && boundaryProfile.contextScore > 0
      ? [
        {
          code: "forensic_boundary_exposure_context",
          message: boundaryObservation?.message ?? "Funds touched service-boundary infrastructure; public-chain continuity after this point should not be assumed.",
          scoreImpact: boundaryProfile.contextScore,
          source: "forensic_route_search",
          confidence: boundaryObservation?.confidence ?? confidenceForScore(boundaryProfile.contextScore),
          severity: boundaryObservation?.severity ?? severityForScore(boundaryProfile.contextScore),
          evidenceRef: boundaryEvidence?.id
        }
      ]
      : []),
    ...(behaviorProfile && addressBehaviorEffectiveScore(behaviorProfile) > 0
      ? [
        {
          code: "forensic_address_behavior",
          message: behaviorObservation?.message ?? "Address behavior profile requires manual review.",
          scoreImpact: Math.min(30, addressBehaviorEffectiveScore(behaviorProfile)),
          source: "forensic_route_search",
          confidence: behaviorObservation?.confidence ?? confidenceForScore(addressBehaviorEffectiveScore(behaviorProfile)),
          severity: behaviorObservation?.severity ?? severityForScore(addressBehaviorEffectiveScore(behaviorProfile)),
          evidenceRef: behaviorEvidence?.id
        }
      ]
      : [])
  ];

  return {
    graphSignals,
    behaviorSignals: [],
    amlSignals: [],
    rawEvidence: report.rawEvidence,
    observations: report.observations,
    serviceExposureProfiles: report.serviceExposureProfiles,
    addressBehaviorProfiles: report.addressBehaviorProfiles,
    boundaryExposureProfiles: report.boundaryExposureProfiles ?? [],
    walletRoleProfiles: report.walletRoleProfiles ?? [],
    extendedProvenanceProfiles: report.extendedProvenanceProfiles ?? [],
    stablecoinRestrictionProfiles: report.stablecoinRestrictionProfiles ?? [],
    fastCounterpartyTopsProfile: report.fastCounterpartyTopsProfile ?? null,
    missingChecks: report.missingChecks
  };
}

function mergeSignals(primary: ManualRiskSignals, secondary: ManualRiskSignals): ManualRiskSignals {
  return {
    graphSignals: [...primary.graphSignals, ...secondary.graphSignals],
    behaviorSignals: [...primary.behaviorSignals, ...secondary.behaviorSignals],
    amlSignals: [...primary.amlSignals, ...secondary.amlSignals],
    rawEvidence: [...(primary.rawEvidence ?? []), ...(secondary.rawEvidence ?? [])],
    observations: [...(primary.observations ?? []), ...(secondary.observations ?? [])],
    serviceExposureProfiles: [...(primary.serviceExposureProfiles ?? []), ...(secondary.serviceExposureProfiles ?? [])],
    addressBehaviorProfiles: [...(primary.addressBehaviorProfiles ?? []), ...(secondary.addressBehaviorProfiles ?? [])],
    inboundProvenanceProfiles: [...(primary.inboundProvenanceProfiles ?? []), ...(secondary.inboundProvenanceProfiles ?? [])],
    counterpartyRiskProfiles: [...(primary.counterpartyRiskProfiles ?? []), ...(secondary.counterpartyRiskProfiles ?? [])],
    directCounterpartyInteractionProfiles: [
      ...(primary.directCounterpartyInteractionProfiles ?? []),
      ...(secondary.directCounterpartyInteractionProfiles ?? [])
    ],
    stablecoinRestrictionProfiles: [...(primary.stablecoinRestrictionProfiles ?? []), ...(secondary.stablecoinRestrictionProfiles ?? [])],
    boundaryExposureProfiles: [...(primary.boundaryExposureProfiles ?? []), ...(secondary.boundaryExposureProfiles ?? [])],
    walletRoleProfiles: [...(primary.walletRoleProfiles ?? []), ...(secondary.walletRoleProfiles ?? [])],
    extendedProvenanceProfiles: [...(primary.extendedProvenanceProfiles ?? []), ...(secondary.extendedProvenanceProfiles ?? [])],
    fastCounterpartyTopsProfile: primary.fastCounterpartyTopsProfile ?? secondary.fastCounterpartyTopsProfile ?? null,
    missingChecks: [...(primary.missingChecks ?? []), ...(secondary.missingChecks ?? [])]
  };
}

export function createAddressExposureRiskSignalProvider(
  deps: AddressExposureRiskSignalProviderDeps,
  options: AddressExposureRiskSignalProviderOptions = {}
): (address: string) => Promise<ManualRiskSignals> {
  const now = deps.now ?? (() => new Date());
  const transferCacheTtlMs = options.transferCacheTtlMs ?? DEFAULT_TRANSFER_CACHE_TTL_MS;
  const stablecoinRestrictionCacheTtlMs = options.stablecoinRestrictionCacheTtlMs ?? DEFAULT_STABLECOIN_RESTRICTION_CACHE_TTL_MS;
  const transferCache = createTrc20TransferCache({
    ttlMs: transferCacheTtlMs,
    now: () => now().getTime()
  } satisfies Trc20TransferCacheOptions);
  const stablecoinRestrictionCache = new Map<string, StablecoinRestrictionCacheEntry>();

  const resolveAddressMetadata = async (address: string): Promise<AddressMetadata | null> => {
    const fetchedAt = now();
    const cached = await deps.getAddressMetadata?.(address, fetchedAt);
    if (cached) return cached;
    if (!deps.tronClient.getAddressMetadata) return null;

    const providerMetadata = await deps.tronClient.getAddressMetadata(address);
    const metadata = metadataFromProvider(
      providerMetadata,
      fetchedAt,
      options.metadataTtlMs ?? DEFAULT_METADATA_TTL_MS
    );
    await deps.upsertAddressMetadata?.(metadata);
    return metadata;
  };

  const resolveContractProfile = async (address: string): Promise<ContractIntelligenceProfile | null> => {
    const fetchedAt = now();
    const cached = await deps.getContractIntelligenceProfile?.(address, fetchedAt);
    if (cached) return cached;
    if (!deps.tronClient.getContractIntelligenceProfile) return null;

    const profile = await deps.tronClient.getContractIntelligenceProfile(address, {
      now: fetchedAt,
      ttlMs: options.contractProfileTtlMs ?? CONTRACT_INTELLIGENCE_TTL_MS
    });
    await deps.upsertContractIntelligenceProfile?.(profile);
    return profile;
  };

  const resolveStablecoinRestrictionProfile = async (address: string): Promise<StablecoinRestrictionProfile | null> => {
    if (!deps.tronClient.getUsdtRestrictionStatus) return null;
    const cacheKey = `tron:usdt-restriction:${address}`;
    const cached = stablecoinRestrictionCache.get(cacheKey);
    const currentMs = now().getTime();
    if (cached && cached.expiresAtMs > currentMs) return cached.profile;

    const profile = await deps.tronClient.getUsdtRestrictionStatus(address);
    stablecoinRestrictionCache.set(cacheKey, {
      profile,
      expiresAtMs: currentMs + stablecoinRestrictionCacheTtlMs
    });
    return profile;
  };

  const buildStablecoinRestrictionSignals = async (address: string): Promise<ManualRiskSignals> => {
    if (!deps.tronClient.getUsdtRestrictionStatus) return emptySignals();
    try {
      const profile = await resolveStablecoinRestrictionProfile(address);
      if (!profile?.isBlacklisted) return emptySignals();
      const evidence = rawEvidenceForStablecoinRestriction(profile);
      const signal = signalForStablecoinRestriction({ profile, rawEvidenceId: evidence.id });
      const observation = observationForStablecoinRestriction({ profile, rawEvidenceId: evidence.id });
      const missingChecks = profile.blacklistEventTxHash ? [] : ["Blacklist event timeline unavailable"];
      return {
        graphSignals: [],
        behaviorSignals: [],
        amlSignals: signal ? [signal] : [],
        rawEvidence: [evidence],
        observations: observation ? [observation] : [],
        stablecoinRestrictionProfiles: [profile],
        missingChecks
      };
    } catch (error) {
      return {
        graphSignals: [],
        behaviorSignals: [],
        amlSignals: [],
        rawEvidence: [],
        observations: [],
        stablecoinRestrictionProfiles: [],
        missingChecks: [`Stablecoin restriction check incomplete: ${messageFromError(error)}`]
      };
    }
  };

  const buildWindow = () => {
    const currentMs = now().getTime();
    const bucketMs = Math.max(1, transferCacheTtlMs);
    const windowEnd = new Date(Math.floor(currentMs / bucketMs) * bucketMs);
    const windowStart = new Date(windowEnd.getTime() - (options.days ?? DEFAULT_DAYS) * 24 * 60 * 60 * 1000);
    return { windowStart, windowEnd };
  };

  const buildCachedTronClient = (transferSnapshots: TransferSnapshots): RouteSearchTronClient => ({
    listRelatedTrc20Transfers: async (address, lookupOptions = {}) => {
      const transfers = await transferCache.getOrFetch(address, lookupOptions, () =>
        deps.tronClient.listRelatedTrc20Transfers(address, lookupOptions)
      );
      transferSnapshots.set(transferLookupKey(address, lookupOptions), transfers);
      return transfers;
    }
  });

  const buildFallbackSignals = async (
    address: string,
    transferSnapshots: TransferSnapshots,
    timeoutMs: number,
    window: { windowStart: Date; windowEnd: Date }
  ): Promise<ManualRiskSignals> => {
    const stablecoinSignals = await buildStablecoinRestrictionSignals(address);
    if ((stablecoinSignals.stablecoinRestrictionProfiles ?? []).some((profile) => profile.isBlacklisted)) {
      return stablecoinSignals;
    }
    const snapshotOnlyClient: RouteSearchTronClient = {
      listRelatedTrc20Transfers: async (lookupAddress, lookupOptions = {}) =>
        transferSnapshots.get(transferLookupKey(lookupAddress, lookupOptions)) ?? []
    };
    const report = await runForensicAddressExposureSearch({
      sourceAddress: address,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      maxDepth: 1,
      maxPagesPerAddress: 1,
      pageLimit: options.pageLimit ?? DEFAULT_PAGE_LIMIT,
      limit: options.limit ?? DEFAULT_LIMIT,
      tronClient: snapshotOnlyClient,
      contractProfileFetchLimit: 0,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      recentFallbackMinTransferCount: options.recentFallbackMinTransferCount ?? DEFAULT_RECENT_FALLBACK_MIN_TRANSFER_COUNT,
      recentFallbackTransferLimit: options.recentFallbackTransferLimit ?? DEFAULT_RECENT_FALLBACK_TRANSFER_LIMIT
    });
    const signals = signalsFromReport(report);
    return mergeSignals(stablecoinSignals, {
      ...signals,
      missingChecks: [`Service exposure check incomplete: timed out after ${timeoutMs}ms`, ...(signals.missingChecks ?? [])]
    });
  };

  const buildSignals = async (
    address: string,
    abortSignal: AbortSignal,
    transferSnapshots: TransferSnapshots,
    window: { windowStart: Date; windowEnd: Date }
  ): Promise<ManualRiskSignals> => {
    const stablecoinSignals = await buildStablecoinRestrictionSignals(address);
    if ((stablecoinSignals.stablecoinRestrictionProfiles ?? []).some((profile) => profile.isBlacklisted)) {
      return stablecoinSignals;
    }
    const cachedTronClient = buildCachedTronClient(transferSnapshots);
    const report = await runForensicAddressExposureSearch({
      sourceAddress: address,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
      maxPagesPerAddress: options.maxPagesPerAddress ?? DEFAULT_MAX_PAGES_PER_ADDRESS,
      pageLimit: options.pageLimit ?? DEFAULT_PAGE_LIMIT,
      limit: options.limit ?? DEFAULT_LIMIT,
      tronClient: cachedTronClient,
      getAddressMetadata: resolveAddressMetadata,
      getContractIntelligenceProfile: resolveContractProfile,
      contractProfileFetchLimit: options.contractProfileFetchLimit ?? DEFAULT_CONTRACT_PROFILE_FETCH_LIMIT,
      maxExpandedIntermediates: options.maxExpandedIntermediates ?? DEFAULT_MAX_EXPANDED_INTERMEDIATES,
      metadataFetchLimit: options.metadataFetchLimit ?? DEFAULT_METADATA_FETCH_LIMIT,
      recentFallbackMinTransferCount: options.recentFallbackMinTransferCount ?? DEFAULT_RECENT_FALLBACK_MIN_TRANSFER_COUNT,
      recentFallbackTransferLimit: options.recentFallbackTransferLimit ?? DEFAULT_RECENT_FALLBACK_TRANSFER_LIMIT,
      abortSignal
    });
    return mergeSignals(stablecoinSignals, signalsFromReport(report));
  };

  return (address) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const transferSnapshots: TransferSnapshots = new Map();
    const window = buildWindow();
    return withTimeout(
      (signal) => buildSignals(address, signal, transferSnapshots, window).catch((error) => {
        if (signal.aborted) {
          return new Promise<ManualRiskSignals>(() => undefined);
        }
        return partialSignals(messageFromError(error));
      }),
      timeoutMs,
      () => buildFallbackSignals(address, transferSnapshots, timeoutMs, window)
    );
  };
}
