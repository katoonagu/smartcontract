import type { ContractIntelligenceProfile } from "../approvals/contractIntelligence";
import type { Logger } from "../logging/logger";
import type { ServiceClassification } from "../types";
import { classifyServiceAddress, type ServiceAddressMetadata } from "./serviceClassifier";

export type ContractEnrichmentResult = {
  address: string;
  metadata: ServiceAddressMetadata | null;
  contractProfile: ContractIntelligenceProfile | null;
  classification: ServiceClassification;
  profileSource: "cache" | "live" | "none";
  liveFetchError: string | null;
};

export type EnrichContractClassificationInput = {
  address: string;
  getMetadata(address: string): Promise<ServiceAddressMetadata | null>;
  getCachedProfile(address: string, now: Date): Promise<ContractIntelligenceProfile | null>;
  fetchLiveProfile(address: string, now: Date): Promise<ContractIntelligenceProfile | null>;
  upsertProfile(profile: ContractIntelligenceProfile): Promise<void>;
  logger?: Pick<Logger, "warn">;
  now?: () => Date;
};

function isResolvedBoundary(classification: ServiceClassification): boolean {
  return classification.category !== "none" && classification.category !== "unknown_contract";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readOrNull<T>(
  read: () => Promise<T | null>,
  onError: (error: unknown) => void
): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    onError(error);
    return null;
  }
}

function profileSource(profile: ContractIntelligenceProfile | null, source: "cache" | "live"): "cache" | "live" | "none" {
  return profile ? source : "none";
}

export async function enrichContractClassification(
  input: EnrichContractClassificationInput
): Promise<ContractEnrichmentResult> {
  const now = (input.now ?? (() => new Date()))();
  const [metadata, cachedProfile] = await Promise.all([
    readOrNull(
      () => input.getMetadata(input.address),
      (error) => input.logger?.warn("contract_enrichment_metadata_read_failed", {
        address: input.address,
        error: errorMessage(error)
      })
    ),
    readOrNull(
      () => input.getCachedProfile(input.address, now),
      (error) => input.logger?.warn("contract_enrichment_cached_profile_read_failed", {
        address: input.address,
        error: errorMessage(error)
      })
    )
  ]);
  const cachedClassification = classifyServiceAddress({
    address: input.address,
    metadata,
    contractProfile: cachedProfile
  });

  if (isResolvedBoundary(cachedClassification)) {
    return {
      address: input.address,
      metadata,
      contractProfile: cachedProfile,
      classification: cachedClassification,
      profileSource: profileSource(cachedProfile, "cache"),
      liveFetchError: null
    };
  }

  let liveProfile: ContractIntelligenceProfile | null = null;
  let liveFetchError: string | null = null;
  try {
    liveProfile = await input.fetchLiveProfile(input.address, now);
  } catch (error) {
    liveFetchError = errorMessage(error);
    input.logger?.warn("contract_enrichment_live_fetch_failed", {
      address: input.address,
      error: liveFetchError
    });
  }

  if (liveProfile) {
    try {
      await input.upsertProfile(liveProfile);
    } catch (error) {
      input.logger?.warn("contract_enrichment_profile_upsert_failed", {
        address: input.address,
        error: errorMessage(error)
      });
      // Best-effort cache write; enrichment still returns the live classification.
    }
  }

  const contractProfile = liveProfile ?? (liveFetchError && cachedProfile?.lowMetadata === true ? null : cachedProfile);
  return {
    address: input.address,
    metadata,
    contractProfile,
    classification: classifyServiceAddress({
      address: input.address,
      metadata,
      contractProfile
    }),
    profileSource: liveProfile ? "live" : profileSource(cachedProfile, "cache"),
    liveFetchError
  };
}
