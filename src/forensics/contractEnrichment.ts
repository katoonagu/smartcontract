import type { ContractRiskContext } from "../approvals/contractIntelligence";
import type { ServiceClassification } from "../types";
import { classifyServiceAddress, type ServiceAddressMetadata } from "./serviceClassifier";

export type ContractEnrichmentResult = {
  address: string;
  metadata: ServiceAddressMetadata | null;
  contractProfile: ContractRiskContext | null;
  classification: ServiceClassification;
  profileSource: "cache" | "live" | "none";
  liveFetchError: string | null;
};

export type EnrichContractClassificationInput = {
  address: string;
  getMetadata(address: string): Promise<ServiceAddressMetadata | null>;
  getCachedProfile(address: string, now: Date): Promise<ContractRiskContext | null>;
  fetchLiveProfile(address: string, now: Date): Promise<ContractRiskContext | null>;
  upsertProfile(profile: ContractRiskContext): Promise<void>;
  now?: () => Date;
};

function isResolvedBoundary(classification: ServiceClassification): boolean {
  return classification.category !== "none" && classification.category !== "unknown_contract";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readOrNull<T>(read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

function profileSource(profile: ContractRiskContext | null, source: "cache" | "live"): "cache" | "live" | "none" {
  return profile ? source : "none";
}

export async function enrichContractClassification(
  input: EnrichContractClassificationInput
): Promise<ContractEnrichmentResult> {
  const now = (input.now ?? (() => new Date()))();
  const [metadata, cachedProfile] = await Promise.all([
    readOrNull(() => input.getMetadata(input.address)),
    readOrNull(() => input.getCachedProfile(input.address, now))
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

  let liveProfile: ContractRiskContext | null = null;
  let liveFetchError: string | null = null;
  try {
    liveProfile = await input.fetchLiveProfile(input.address, now);
  } catch (error) {
    liveFetchError = errorMessage(error);
  }

  if (liveProfile) {
    try {
      await input.upsertProfile(liveProfile);
    } catch {
      // Best-effort cache write; enrichment still returns the live classification.
    }
  }

  const contractProfile = liveProfile ?? cachedProfile;
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
