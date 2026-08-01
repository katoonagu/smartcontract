import { createHash } from "node:crypto";
import { FORENSIC_ROUTE_POLICY_VERSION } from "../forensics/routeScorer";
import type { AssetContinuationProfile, RawEvidenceInput, RiskSignalObservationInput } from "../types";

type DeepDetectorEvidenceBuilderInput<TProfile> = {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profile: TProfile;
};

type DeepDetectorObservationBuilderInput<TProfile> = {
  subjectAddress: string;
  profile: TProfile;
  rawEvidenceId: string;
};

export type DeepDetectorAssemblyInput<TProfile> = {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profiles: TProfile[];
  shouldPersistProfile(profile: TProfile): boolean;
  buildRawEvidence(input: DeepDetectorEvidenceBuilderInput<TProfile>): RawEvidenceInput;
  buildObservation(input: DeepDetectorObservationBuilderInput<TProfile>): RiskSignalObservationInput | null;
};

export type DeepDetectorAssemblyResult<TProfile> = {
  profiles: TProfile[];
  persistedProfiles: TProfile[];
  rawEvidence: RawEvidenceInput[];
  observations: RiskSignalObservationInput[];
};

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function notNull<T>(value: T | null): value is T {
  return value !== null;
}

export function assembleDeepDetectorProfiles<TProfile>(
  input: DeepDetectorAssemblyInput<TProfile>
): DeepDetectorAssemblyResult<TProfile> {
  const persistedProfiles = input.profiles.filter(input.shouldPersistProfile);
  const rawEvidence = persistedProfiles.map((profile) =>
    input.buildRawEvidence({
      subjectAddress: input.subjectAddress,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      profile
    })
  );
  const observations = rawEvidence
    .map((evidence, index) =>
      input.buildObservation({
        subjectAddress: input.subjectAddress,
        profile: persistedProfiles[index],
        rawEvidenceId: evidence.id
      })
    )
    .filter(notNull);

  return {
    profiles: input.profiles,
    persistedProfiles,
    rawEvidence,
    observations
  };
}

function rawEvidenceForAssetContinuation(input: {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profile: AssetContinuationProfile;
}): RawEvidenceInput {
  return {
    id: stableId([
      "forensic_asset_continuation_raw",
      input.subjectAddress,
      input.profile.conversionTxHash,
      input.profile.outgoingTxHash,
      input.windowStart.toISOString(),
      input.windowEnd.toISOString()
    ]),
    source: "tronscan_all_token_transfer_history",
    sourceType: "detector_output",
    chain: "tron",
    address: input.subjectAddress,
    txHash: input.profile.conversionTxHash,
    observedTransactionHash: input.profile.outgoingTxHash,
    evidenceJson: {
      assetContinuationProfile: input.profile,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString()
    }
  };
}

function observationForAssetContinuation(input: {
  subjectAddress: string;
  profile: AssetContinuationProfile;
  rawEvidenceId: string;
}): RiskSignalObservationInput | null {
  if (input.profile.score < 65) return null;

  return {
    id: stableId([
      "forensic_asset_continuation_observation",
      input.subjectAddress,
      input.profile.conversionTxHash,
      input.profile.outgoingTxHash,
      FORENSIC_ROUTE_POLICY_VERSION
    ]),
    subjectChain: "tron",
    subjectAddress: input.subjectAddress,
    subjectTxHash: input.profile.conversionTxHash,
    observedTransactionHash: input.profile.outgoingTxHash,
    signalGroup: "incoming_context",
    code: "forensic_asset_continuation",
    message: "USDT movement continued through another verified TRC20 asset.",
    scoreImpact: input.profile.score,
    confidence: input.profile.tokenQuality === "verified" ? "high" : "medium",
    severity: input.profile.score >= 80 ? "high" : "medium",
    source: "asset_continuation",
    policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
    rawEvidenceId: input.rawEvidenceId
  };
}

export function assembleAssetContinuationProfiles(input: {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profiles: AssetContinuationProfile[];
}): DeepDetectorAssemblyResult<AssetContinuationProfile> {
  return assembleDeepDetectorProfiles({
    subjectAddress: input.subjectAddress,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    profiles: input.profiles,
    shouldPersistProfile: (profile) => profile.score >= 65,
    buildRawEvidence: rawEvidenceForAssetContinuation,
    buildObservation: observationForAssetContinuation
  });
}
