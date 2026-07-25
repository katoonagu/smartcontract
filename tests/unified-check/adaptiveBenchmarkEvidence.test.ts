import { describe, expect, it } from "vitest";
import {
  parseUnifiedAdaptiveBenchmarkEvidenceV1,
  sealUnifiedAdaptiveBenchmarkEvidenceV1,
  sealUnifiedProviderGroupAuditV1
} from "../../src/unifiedCheck/adaptiveBenchmarkEvidence";
import {
  buildUnifiedPerformanceBenchmarkManifest
} from "../../src/unifiedCheck/performanceMetrics";
import {
  canonicalizeArtifactJson
} from "../../src/forensics/canonicalJson";
import {
  PERFORMANCE_CASE
} from "../fixtures/unified-check/performanceBenchmark";

const performanceManifest =
  buildUnifiedPerformanceBenchmarkManifest(PERFORMANCE_CASE);

const liveOutcome = {
  runId: "live-run-1",
  subjectAddress: "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV",
  score: 0,
  decision: "ACCEPTABLE" as const,
  evidenceBundleSha256: "1".repeat(64),
  traversalClosureSha256: "2".repeat(64),
  scoringBundleSha256: "3".repeat(64),
  reportSha256: "4".repeat(64),
  benchmarkControlSha256: "5".repeat(64),
  auditedGroupIds: ["provider-group-1"],
  dispatchedGroupIds: ["provider-group-1"]
};
const observedMeasurement = {
  timing: "observed" as const,
  provider: "observed" as const,
  database: "observed" as const,
  memory: "observed" as const,
  lifecycle: "observed" as const,
  delivery: "observed" as const
};

function replayEvidence() {
  return {
    scenarioId: "replay:three-wallets:c4",
    scenarioKind: "three_dense_wallets",
    completedAt: "2026-07-24T12:01:00.000Z",
    mode: "replay" as const,
    admissionPolicy: "rolling" as const,
    sideEffectPolicy: "isolated" as const,
    requestedCapacity: 4,
    actualAuditedIndependentGroupCapacity: 4,
    independentGroupAudit: null,
    performanceManifest,
    timing: {
      wallTimeMs: 1_250,
      aggregateThroughputPerSecond: 2.4
    },
    capacity: {
      eligibleDemand: 12,
      targetSlots: 4,
      actualSlots: 4,
      utilization: 1
    },
    provider: {
      rollingRps: 6.5,
      requests: 18,
      errors: 1,
      rateLimited429: 1
    },
    limiting: {
      reason: { scope: "run" as const, code: "provider_cooldown" as const },
      canonicalHeadAgeMs: 400
    },
    buffer: {
      readyBytes: 4_096,
      reservedBytes: 2_048
    },
    database: {
      latencyMs: 12,
      checkpointLatencyMs: 8,
      poolWaitMs: 1
    },
    memory: {
      rssBytes: 128_000_000,
      heapUsedBytes: 64_000_000,
      availableContainerBytes: 512_000_000,
      availableHostBytes: 4_000_000_000
    },
    repair: {
      maxWaitMs: 900,
      maxWaitChunks: 2
    },
    reuse: {
      providerCacheHits: 3,
      networkFetches: 15,
      addressManifestReuses: 2,
      addressHistoryReplaysAvoided: 2
    },
    restartRecovery: {
      restartCount: 1,
      recoveryMs: 250,
      reconciliationRecoveries: 1,
      duplicateCommits: 0,
      duplicateSequences: 0
    },
    oracle: {
      replaySha256: "d".repeat(64),
      oracleSha256: "e".repeat(64),
      receiptSha256: "f".repeat(64),
      exactEquivalent: true as const
    },
    runtimeObservationArtifactSha256s: [],
    scenarioSymptomArtifactSha256s: [],
    liveOutcomes: [],
    measurement: {
      timing: "observed" as const,
      provider: "simulated" as const,
      database: "simulated" as const,
      memory: "observed" as const,
      lifecycle: "simulated" as const,
      delivery: "simulated" as const
    },
    delivery: {
      eligibleRequests: 3,
      deliveryIntents: 0,
      externalTelegramSends: 0
    }
  };
}

describe("Unified adaptive benchmark evidence V1", () => {
  it("seals one canonical scenario while reusing performance semantic and execution identities", () => {
    const sealed = sealUnifiedAdaptiveBenchmarkEvidenceV1(replayEvidence());
    const parsed = parseUnifiedAdaptiveBenchmarkEvidenceV1(
      sealed.canonicalJson
    );

    expect(canonicalizeArtifactJson(parsed)).toBe(sealed.canonicalJson);
    expect(parsed.performanceManifest.semanticIdentitySha256).toBe(
      performanceManifest.semanticIdentitySha256
    );
    expect(parsed.performanceManifest.executionIdentitySha256).toBe(
      performanceManifest.executionIdentitySha256
    );
    expect(parsed.evidenceSha256).toBe(sealed.envelope.evidenceSha256);
    expect(parsed.oracle?.exactEquivalent).toBe(true);
  });

  it("fails closed when live capacity is not present in an audited independent-group snapshot", () => {
    const audit = sealUnifiedProviderGroupAuditV1({
      auditedAt: "2026-07-24T12:00:00.000Z",
      groups: [{
        opaqueGroupId: "provider-group-a",
        state: "healthy",
        concurrencyLimit: 1,
        independenceEvidenceSha256: "1".repeat(64)
      }]
    }).envelope;
    const live = {
      ...replayEvidence(),
      scenarioId: "live:capacity-4",
      mode: "live" as const,
      requestedCapacity: 4,
      actualAuditedIndependentGroupCapacity: 4,
      independentGroupAudit: audit,
      oracle: null,
      runtimeObservationArtifactSha256s: ["a".repeat(64)],
      scenarioSymptomArtifactSha256s: ["b".repeat(64)],
      measurement: observedMeasurement,
      liveOutcomes: [liveOutcome]
    };

    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1(live))
      .toThrow("unified_benchmark_live_capacity_unaudited");
    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...live,
      independentGroupAudit: {
        groupIds: ["key-a", "key-b", "key-c", "key-d"]
      } as never
    })).toThrow("unified_benchmark_group_audit_invalid");
  });

  it("accepts live capacity four only from four independently audited healthy groups", () => {
    const audit = sealUnifiedProviderGroupAuditV1({
      auditedAt: "2026-07-24T12:00:00.000Z",
      groups: Array.from({ length: 4 }, (_, index) => ({
        opaqueGroupId: `provider-group-${index + 1}`,
        state: "healthy" as const,
        concurrencyLimit: 1,
        independenceEvidenceSha256: String(index + 1).repeat(64)
      }))
    }).envelope;
    const sealed = sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...replayEvidence(),
      scenarioId: "live:capacity-4",
      mode: "live",
      requestedCapacity: 4,
      actualAuditedIndependentGroupCapacity: 4,
      independentGroupAudit: audit,
      oracle: null,
      runtimeObservationArtifactSha256s: ["a".repeat(64)],
      scenarioSymptomArtifactSha256s: ["b".repeat(64)],
      measurement: observedMeasurement,
      liveOutcomes: [{
        ...liveOutcome,
        auditedGroupIds: [
          "provider-group-1",
          "provider-group-2",
          "provider-group-3",
          "provider-group-4"
        ],
        dispatchedGroupIds: [
          "provider-group-1",
          "provider-group-2",
          "provider-group-3",
          "provider-group-4"
        ]
      }]
    });

    expect(sealed.envelope.actualAuditedIndependentGroupCapacity).toBe(4);
    expect(sealed.envelope.oracle).toBeNull();
  });

  it("rejects live capacity four when only one audited group was dispatched", () => {
    const audit = sealUnifiedProviderGroupAuditV1({
      auditedAt: "2026-07-24T12:00:00.000Z",
      groups: Array.from({ length: 4 }, (_, index) => ({
        opaqueGroupId: `provider-group-${index + 1}`,
        state: "healthy" as const,
        concurrencyLimit: 1,
        independenceEvidenceSha256: String(index + 1).repeat(64)
      }))
    }).envelope;

    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...replayEvidence(),
      scenarioId: "live:capacity-4-one-dispatched-group",
      mode: "live",
      requestedCapacity: 4,
      actualAuditedIndependentGroupCapacity: 4,
      independentGroupAudit: audit,
      oracle: null,
      runtimeObservationArtifactSha256s: ["a".repeat(64)],
      scenarioSymptomArtifactSha256s: ["b".repeat(64)],
      measurement: observedMeasurement,
      liveOutcomes: [{
        ...liveOutcome,
        auditedGroupIds: [
          "provider-group-1",
          "provider-group-2",
          "provider-group-3",
          "provider-group-4"
        ],
        dispatchedGroupIds: ["provider-group-1"]
      }]
    })).toThrow("unified_benchmark_live_capacity_unaudited");
  });

  it("binds every live outcome to one control and the audited healthy groups", () => {
    const audit = sealUnifiedProviderGroupAuditV1({
      auditedAt: "2026-07-24T12:00:00.000Z",
      groups: [{
        opaqueGroupId: "provider-group-1",
        state: "healthy",
        concurrencyLimit: 1,
        independenceEvidenceSha256: "1".repeat(64)
      }]
    }).envelope;
    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...replayEvidence(),
      mode: "live",
      requestedCapacity: 1,
      actualAuditedIndependentGroupCapacity: 1,
      independentGroupAudit: audit,
      oracle: null,
      runtimeObservationArtifactSha256s: ["a".repeat(64)],
      scenarioSymptomArtifactSha256s: ["b".repeat(64)],
      measurement: observedMeasurement,
      capacity: {
        eligibleDemand: 1,
        targetSlots: 1,
        actualSlots: 1,
        utilization: 1
      },
      liveOutcomes: [
        liveOutcome,
        {
          ...liveOutcome,
          runId: "live-run-2",
          benchmarkControlSha256: "6".repeat(64)
        }
      ]
    })).toThrow("unified_benchmark_live_capacity_unaudited");
  });

  it("forbids exact replay equality claims in live mode", () => {
    const audit = sealUnifiedProviderGroupAuditV1({
      auditedAt: "2026-07-24T12:00:00.000Z",
      groups: [{
        opaqueGroupId: "provider-group-a",
        state: "healthy",
        concurrencyLimit: 1,
        independenceEvidenceSha256: "1".repeat(64)
      }]
    }).envelope;
    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...replayEvidence(),
      mode: "live",
      requestedCapacity: 1,
      actualAuditedIndependentGroupCapacity: 1,
      independentGroupAudit: audit,
      runtimeObservationArtifactSha256s: ["a".repeat(64)],
      scenarioSymptomArtifactSha256s: ["b".repeat(64)],
      measurement: observedMeasurement,
      liveOutcomes: [liveOutcome],
      capacity: {
        eligibleDemand: 12,
        targetSlots: 1,
        actualSlots: 1,
        utilization: 1
      }
    })).toThrow("unified_benchmark_live_oracle_forbidden");
  });

  it("validates all numeric, ISO, reason, and immutable hash fields", () => {
    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...replayEvidence(),
      completedAt: "not-an-iso"
    })).toThrow("unified_benchmark_completed_at_invalid");
    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...replayEvidence(),
      provider: { ...replayEvidence().provider, errors: -1 }
    })).toThrow("unified_benchmark_number_invalid");
    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...replayEvidence(),
      limiting: {
        ...replayEvidence().limiting,
        reason: { scope: "pool", code: "fairness_wait" } as never
      }
    })).toThrow("unified_benchmark_reason_invalid");

    const sealed = sealUnifiedAdaptiveBenchmarkEvidenceV1(replayEvidence());
    const tampered = {
      ...sealed.envelope,
      evidenceSha256: "0".repeat(64)
    };
    expect(() => parseUnifiedAdaptiveBenchmarkEvidenceV1(
      canonicalizeArtifactJson(tampered)
    )).toThrow("unified_benchmark_evidence_hash_mismatch");
    expect(() => parseUnifiedAdaptiveBenchmarkEvidenceV1(
      `${sealed.canonicalJson}\n`
    )).toThrow("unified_benchmark_evidence_noncanonical");
  });

  it("rejects impossible slot, audit, and delivery combinations", () => {
    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...replayEvidence(),
      requestedCapacity: 1,
      actualAuditedIndependentGroupCapacity: 1,
      capacity: {
        eligibleDemand: 100,
        targetSlots: 100,
        actualSlots: 100,
        utilization: 1
      }
    })).toThrow("unified_benchmark_capacity_inconsistent");
    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...replayEvidence(),
      capacity: {
        eligibleDemand: 2,
        targetSlots: 4,
        actualSlots: 4,
        utilization: 1
      }
    })).toThrow("unified_benchmark_capacity_inconsistent");
    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...replayEvidence(),
      delivery: {
        eligibleRequests: 3,
        deliveryIntents: 999,
        externalTelegramSends: 0
      }
    })).toThrow("unified_benchmark_delivery_inconsistent");
    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...replayEvidence(),
      sideEffectPolicy: "authoritative",
      delivery: {
        eligibleRequests: 3,
        deliveryIntents: 2,
        externalTelegramSends: 0
      }
    })).toThrow("unified_benchmark_delivery_inconsistent");
  });

  it("requires metric provenance and receipt-bound replay correctness", () => {
    const {
      receiptSha256: _receiptSha256,
      ...oracleWithoutReceipt
    } = replayEvidence().oracle;
    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...replayEvidence(),
      oracle: oracleWithoutReceipt as never
    })).toThrow("unified_benchmark_oracle_invalid");
    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...replayEvidence(),
      measurement: {
        ...replayEvidence().measurement,
        database: "not_applicable"
      },
      database: {
        latencyMs: 12,
        checkpointLatencyMs: 8,
        poolWaitMs: 1
      }
    } as never)).toThrow("unified_benchmark_measurement_inconsistent");

    const audit = sealUnifiedProviderGroupAuditV1({
      auditedAt: "2026-07-24T12:00:00.000Z",
      groups: [{
        opaqueGroupId: "provider-group-1",
        state: "healthy",
        concurrencyLimit: 1,
        independenceEvidenceSha256: "1".repeat(64)
      }]
    }).envelope;
    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...replayEvidence(),
      mode: "live",
      requestedCapacity: 1,
      actualAuditedIndependentGroupCapacity: 1,
      independentGroupAudit: audit,
      oracle: null,
      runtimeObservationArtifactSha256s: [],
      scenarioSymptomArtifactSha256s: ["b".repeat(64)],
      measurement: observedMeasurement,
      liveOutcomes: [liveOutcome],
      capacity: {
        eligibleDemand: 1,
        targetSlots: 1,
        actualSlots: 1,
        utilization: 1
      }
    })).toThrow("unified_benchmark_runtime_observation_provenance_invalid");
    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...replayEvidence(),
      runtimeObservationArtifactSha256s: ["a".repeat(64)]
    })).toThrow("unified_benchmark_runtime_observation_provenance_invalid");
    expect(() => sealUnifiedAdaptiveBenchmarkEvidenceV1({
      ...replayEvidence(),
      mode: "live",
      requestedCapacity: 1,
      actualAuditedIndependentGroupCapacity: 1,
      independentGroupAudit: audit,
      oracle: null,
      runtimeObservationArtifactSha256s: ["a".repeat(64)],
      scenarioSymptomArtifactSha256s: [],
      measurement: observedMeasurement,
      liveOutcomes: [liveOutcome],
      capacity: {
        eligibleDemand: 1,
        targetSlots: 1,
        actualSlots: 1,
        utilization: 1
      }
    })).toThrow("unified_benchmark_live_observation_required");
  });
});
