import type {
  UnifiedPerformanceBenchmarkInputV1
} from "../../../src/unifiedCheck/performanceMetrics";

export const PERFORMANCE_CASE: UnifiedPerformanceBenchmarkInputV1 = {
  version: "unified-performance-benchmark-input-v1",
  caseId: "tpcp",
  runId: "perf:tpcp:v1",
  frozenClockIso: "2026-07-24T00:00:00.000Z",
  snapshot: {
    blockNumber: "84713573",
    blockHash: "1".repeat(64),
    timestamp: "2026-07-23T12:53:54.000Z"
  },
  providerBundleSha256: "2".repeat(64),
  labelDatasetSha256: "3".repeat(64),
  providerConfigurationSha256: "4".repeat(64),
  scoringPolicyVersion: "scoring-signal-matrix-v4",
  attributionPolicyVersion: "proportional-v1",
  analysisPolicyVersion: "unified-analysis-v1",
  presentationPolicyVersion: "unified-presentation-v1",
  locale: "ru",
  deterministicIdSeed: "perf:tpcp:v1",
  runtimeCommit: "a".repeat(40),
  checkpointVersion: "unified-production-traversal-checkpoint-v1",
  logicalChunkEvents: 50,
  providerSlots: 2,
  harnessVersion: "unified-performance-harness-v1"
};
