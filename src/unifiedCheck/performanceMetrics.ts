import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";

const HASH = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;

export type UnifiedPerformanceCountersV1 = {
  readonly providerCalls: number;
  readonly networkFetches: number;
  readonly providerErrors: number;
  readonly rateLimited429: number;
  readonly providerCacheHits: number;
  readonly addressManifestReuses: number;
  readonly addressHistoryReplaysAvoided: number;
  readonly taskClaims: number;
  readonly checkpoints: number;
  readonly logicalChunks: number;
  readonly dbWrites: number;
  readonly checkpointBytes: number;
  readonly maxCheckpointBytes: number;
  readonly currentInFlight: number;
  readonly maxInFlight: number;
  readonly restartRecoveries: number;
  readonly reconciliationRecoveries: number;
  readonly deliveryIntents: number;
  readonly externalTelegramSends: number;
};

export type UnifiedPerformanceBenchmarkInputV1 = {
  readonly version: "unified-performance-benchmark-input-v1";
  readonly caseId: string;
  readonly runId: string;
  readonly frozenClockIso: string;
  readonly snapshot: {
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly timestamp: string;
  };
  readonly providerBundleSha256: string;
  readonly labelDatasetSha256: string;
  readonly providerConfigurationSha256: string;
  readonly scoringPolicyVersion: string;
  readonly attributionPolicyVersion: string;
  readonly analysisPolicyVersion: string;
  readonly presentationPolicyVersion: string;
  readonly locale: "ru" | "en";
  readonly deterministicIdSeed: string;
  readonly runtimeCommit: string;
  readonly checkpointVersion: string;
  readonly logicalChunkEvents: number;
  readonly providerSlots: number;
  readonly harnessVersion: string;
};

export type UnifiedPerformanceBenchmarkManifestV1 = {
  readonly version: "unified-performance-benchmark-manifest-v1";
  readonly caseId: string;
  readonly runId: string;
  readonly frozenClockIso: string;
  readonly semanticIdentitySha256: string;
  readonly executionIdentitySha256: string;
};

function requiredText(value: string, code: string): string {
  if (value.trim().length === 0) throw new TypeError(code);
  return value;
}

function sha256(value: string, code: string): string {
  if (!HASH.test(value)) throw new TypeError(code);
  return value;
}

function iso(value: string, code: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(code);
  }
  return value;
}

function positiveInteger(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(code);
  return value;
}

export function createUnifiedPerformanceCounters(): UnifiedPerformanceCountersV1 {
  return {
    providerCalls: 0,
    networkFetches: 0,
    providerErrors: 0,
    rateLimited429: 0,
    providerCacheHits: 0,
    addressManifestReuses: 0,
    addressHistoryReplaysAvoided: 0,
    taskClaims: 0,
    checkpoints: 0,
    logicalChunks: 0,
    dbWrites: 0,
    checkpointBytes: 0,
    maxCheckpointBytes: 0,
    currentInFlight: 0,
    maxInFlight: 0,
    restartRecoveries: 0,
    reconciliationRecoveries: 0,
    deliveryIntents: 0,
    externalTelegramSends: 0
  };
}

export function patchUnifiedPerformanceCounters(
  current: UnifiedPerformanceCountersV1,
  patch: Partial<UnifiedPerformanceCountersV1>
): UnifiedPerformanceCountersV1 {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value === undefined ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new TypeError("unified_performance_counter_invalid");
    }
    const typed = key as keyof UnifiedPerformanceCountersV1;
    if (typed === "maxInFlight" || typed === "maxCheckpointBytes") {
      next[typed] = Math.max(next[typed], value);
    } else if (typed === "currentInFlight" || typed === "checkpointBytes") {
      next[typed] = value;
    } else {
      next[typed] += value;
    }
  }
  if (next.currentInFlight > next.maxInFlight) {
    next.maxInFlight = next.currentInFlight;
  }
  if (next.checkpointBytes > next.maxCheckpointBytes) {
    next.maxCheckpointBytes = next.checkpointBytes;
  }
  return next;
}

export function buildUnifiedPerformanceBenchmarkManifest(
  input: UnifiedPerformanceBenchmarkInputV1
): UnifiedPerformanceBenchmarkManifestV1 {
  if (input.version !== "unified-performance-benchmark-input-v1") {
    throw new TypeError("unified_performance_input_version_invalid");
  }
  const caseId = requiredText(input.caseId, "unified_performance_case_id_invalid");
  const runId = requiredText(input.runId, "unified_performance_run_id_invalid");
  const frozenClockIso = iso(
    input.frozenClockIso,
    "unified_performance_clock_invalid"
  );
  const snapshot = {
    blockNumber: requiredText(
      input.snapshot.blockNumber,
      "unified_performance_snapshot_block_invalid"
    ),
    blockHash: sha256(
      input.snapshot.blockHash,
      "unified_performance_snapshot_hash_invalid"
    ),
    timestamp: iso(
      input.snapshot.timestamp,
      "unified_performance_snapshot_time_invalid"
    )
  };
  const semanticIdentitySha256 = fingerprintCanonicalArtifact({
    version: "unified-performance-semantic-identity-v1",
    caseId,
    runId,
    frozenClockIso,
    snapshot,
    providerBundleSha256: sha256(
      input.providerBundleSha256,
      "unified_performance_provider_bundle_invalid"
    ),
    labelDatasetSha256: sha256(
      input.labelDatasetSha256,
      "unified_performance_label_dataset_invalid"
    ),
    scoringPolicyVersion: requiredText(
      input.scoringPolicyVersion,
      "unified_performance_scoring_policy_invalid"
    ),
    attributionPolicyVersion: requiredText(
      input.attributionPolicyVersion,
      "unified_performance_attribution_policy_invalid"
    ),
    analysisPolicyVersion: requiredText(
      input.analysisPolicyVersion,
      "unified_performance_analysis_policy_invalid"
    ),
    presentationPolicyVersion: requiredText(
      input.presentationPolicyVersion,
      "unified_performance_presentation_policy_invalid"
    ),
    locale: input.locale,
    deterministicIdSeed: requiredText(
      input.deterministicIdSeed,
      "unified_performance_id_seed_invalid"
    )
  });
  if (!COMMIT.test(input.runtimeCommit)) {
    throw new TypeError("unified_performance_runtime_commit_invalid");
  }
  const executionIdentitySha256 = fingerprintCanonicalArtifact({
    version: "unified-performance-execution-identity-v1",
    semanticIdentitySha256,
    providerConfigurationSha256: sha256(
      input.providerConfigurationSha256,
      "unified_performance_provider_configuration_invalid"
    ),
    runtimeCommit: input.runtimeCommit,
    checkpointVersion: requiredText(
      input.checkpointVersion,
      "unified_performance_checkpoint_version_invalid"
    ),
    logicalChunkEvents: positiveInteger(
      input.logicalChunkEvents,
      "unified_performance_chunk_invalid"
    ),
    providerSlots: positiveInteger(
      input.providerSlots,
      "unified_performance_slots_invalid"
    ),
    harnessVersion: requiredText(
      input.harnessVersion,
      "unified_performance_harness_invalid"
    )
  });
  return {
    version: "unified-performance-benchmark-manifest-v1",
    caseId,
    runId,
    frozenClockIso,
    semanticIdentitySha256,
    executionIdentitySha256
  };
}
