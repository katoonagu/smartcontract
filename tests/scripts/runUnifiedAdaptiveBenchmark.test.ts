import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateUnifiedBenchmarkPeakConcurrency,
  buildUnifiedSelectedCanaryAuthorizationMarker,
  completedCanaryTraversalPolicy,
  createUnifiedBenchmarkMemoryCapture,
  createPostgresSelectedCanaryAuthorizationStore,
  isNonterminalCheckpointedBenchmarkRun,
  createUnifiedBenchmarkReleaseOwner,
  parseUnifiedAdaptiveLiveCapacityStateV1,
  parseUnifiedSelectedRefillExportEvidenceV1,
  parseUnifiedSelectedAdaptiveBenchmarkIndexV2,
  recoverUnifiedBenchmarkCapacityStateControl,
  runSelectedIsolatedCanaryBenchmark,
  runUnifiedBenchmarkControlScope,
  runUnifiedAdaptiveBenchmarkCli,
  sealUnifiedSelectedRefillExportEvidenceV1,
  sealUnifiedSelectedAdaptiveBenchmarkIndexV2,
  UNIFIED_ADAPTIVE_LIVE_SCENARIOS,
  UnifiedAdaptiveBenchmarkRestartRequiredError
} from "../../scripts/runUnifiedAdaptiveBenchmark";
import {
  parseUnifiedAdaptiveBenchmarkEvidenceV1,
  sealUnifiedAdaptiveBenchmarkEvidenceV1,
  sealUnifiedProviderGroupAuditV1
} from "../../src/unifiedCheck/adaptiveBenchmarkEvidence";
import {
  canonicalJsonFilePayload,
  parseUnifiedProviderReplayV1,
  sealUnifiedRollingOracleReceiptV1
} from "../../src/unifiedCheck/providerReplay";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import {
  buildUnifiedPerformanceBenchmarkManifest
} from "../../src/unifiedCheck/performanceMetrics";

afterEach(() => {
  vi.unstubAllGlobals();
});

function createMemorySelectedAuthorizationStore() {
  const markers = new Set<string>();
  return {
    markers,
    async authorize(marker: { readonly authorizationSha256: string }) {
      if (markers.has(marker.authorizationSha256)) return "exists" as const;
      markers.add(marker.authorizationSha256);
      return "created" as const;
    }
  };
}

function oracleFacts(tag = "postgres-lifecycle-fact-1") {
  return {
    canonicalFacts: {
      version: "canonical-fact-inventory-v1" as const,
      facts: [{
        version: "canonical-fact-v1",
        id: fingerprintCanonicalArtifact({ tag }),
        profile: "state",
        factType: tag,
        subject: "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV",
        subjectRole: "subject",
        lane: "neutral",
        strength: "exact",
        sourceBranches: ["fast"],
        directness: "direct",
        timing: "current",
        payload: null
      }]
    },
    finalFrontier: [],
    closureCertificate: {
      version: "traversal-closure-certificate-v1" as const,
      schemaVersion: 1 as const,
      analysisManifestHash: "1".repeat(64),
      snapshotHash: "2".repeat(64),
      visitedStateHash: "3".repeat(64),
      frontierHash: "4".repeat(64),
      closed: true as const
    },
    score: 0,
    decision: "ACCEPTABLE" as const,
    evidenceBundleSha256: "5".repeat(64),
    traversalClosureSha256: "6".repeat(64),
    scoringBundleSha256: "7".repeat(64),
    reportSha256: "8".repeat(64),
    eligibleDeliveryIntentCount: 1,
    externalTelegramSends: 0,
    providerResponseArtifactSha256s: ["9".repeat(64)],
    committedSequenceCount: 1,
    duplicateCommitCount: 0,
    duplicateSequenceCount: 0
  };
}

function replayOracleRuntime(
  factTag = "postgres-lifecycle-fact-1",
  generatedAt = "2026-07-24T12:00:00.000Z"
) {
  return {
    resolveReplayOracleReceipt: vi.fn(async (input: {
      readonly replaySha256: string;
      readonly seed: number;
    }) => {
      const facts = oracleFacts(factTag);
      return sealUnifiedRollingOracleReceiptV1({
        generatedAt,
        producerVersion: "unified-postgres-lifecycle-oracle-v1",
        schemaVersion: 34,
        replaySha256: input.replaySha256,
        seed: input.seed,
        barrierFacts: facts,
        rollingFacts: [1, 4, 8, 16, 32, 100].map((capacity) => ({
          capacity,
          seed: input.seed + capacity,
          facts
        }))
      }).envelope;
    })
  };
}

async function writeSelectedLiveResumeBundle(root: string) {
  const selected = "isolated:TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd";
  const scenarioId = `live:c4:${selected}`;
  const runId = "run-txc";
  const candidateCommit = "a".repeat(40);
  const controlSha256 = "b".repeat(64);
  const providerConfigurationSha256 = "c".repeat(64);
  const output = join(root, "selected.json");
  const scenarioDirectory = join(root, "selected.scenarios");
  await mkdir(scenarioDirectory);
  const audit = sealUnifiedProviderGroupAuditV1({
    auditedAt: "2026-07-24T12:00:00.000Z",
    groups: Array.from({ length: 4 }, (_, index) => ({
      opaqueGroupId: `provider-group-${index + 1}`,
      state: "healthy" as const,
      concurrencyLimit: 1,
      independenceEvidenceSha256: String(index + 1).repeat(64)
    }))
  });
  const auditPath = join(root, "provider-audit.json");
  await writeFile(auditPath, audit.canonicalJson, "utf8");
  const executionIdentitySha256 = fingerprintCanonicalArtifact({
    version: "unified-adaptive-benchmark-execution-identity-v1",
    mode: "live",
    seed: 1,
    requestedCapacities: [4],
    candidateCommit,
    sourceIdentitySha256: audit.envelope.auditSha256,
    traversalPolicyVersion: "snapshot-closure-v2",
    scenarioIds: [selected]
  });
  const groups = audit.envelope.groups.map((group) => group.opaqueGroupId);
  const observation = {
    version: "unified-adaptive-benchmark-runtime-observation-v1",
    controlSha256,
    observedAt: "2026-07-24T12:00:30.000Z",
    runtime: {
      rssHeapScope: "process",
      availableMemoryScope: "container_or_host",
      instanceId: "runtime-selected-resume",
      processStartedAt: "2026-07-24T12:00:00.000Z",
      processId: 123,
      rssBytes: 100,
      heapUsedBytes: 50,
      availableContainerBytes: 1_000,
      availableHostBytes: 2_000
    },
    provider: {
      requests: 4,
      completed: 4,
      errors: 0,
      rateLimited429: 0,
      requestsPerSecond: 4,
      dispatchedGroupIds: groups
    },
    reuse: {
      providerCacheHits: 0,
      networkFetches: 4,
      addressManifestReuses: 0,
      addressHistoryReplaysAvoided: 0
    },
    integrity: {
      duplicateCommits: 0,
      duplicateSequences: 0,
      deliveryIntents: 0
    },
    database: {
      scope: "benchmark_runtime_connection_pool",
      latencyMs: 1,
      checkpointLatencyMs: 1,
      poolWaitMs: 0
    },
    lifecycle: {
      restartRunId: null,
      checkpointObservationSha256: null,
      restartCount: 0,
      recoveryMs: 0,
      reconciliationRecoveries: 0
    },
    runs: [{
      runId,
      scenarioId: selected,
      planner: {
        durableBacklog: 0,
        admitted: 0,
        leased: 0,
        ready: 0,
        committed: 1
      },
      buffer: { readyCount: 0, readyBytes: 0, reservedBytes: 0 },
      canonicalHeadAgeMs: 1,
      capacity: { eligibleDemand: 4, targetSlots: 4, actualSlots: 4 },
      limitingReason: null
    }]
  } as const;
  const observationSha256 = fingerprintCanonicalArtifact(observation);
  const observationRelativePath =
    `selected.scenarios/observation-${observationSha256}.json`;
  await writeFile(
    join(root, observationRelativePath),
    `${canonicalizeArtifactJson(observation)}\n`,
    "utf8"
  );
  const symptom = {
    version: "unified-adaptive-benchmark-scenario-symptom-v1",
    controlSha256,
    runId,
    scenarioId: selected,
    phase: "run_completed",
    observedAt: "2026-07-24T12:00:31.000Z",
    observationArtifactSha256: observationSha256,
    runtimeInstanceId: "runtime-selected-resume",
    runtimeProcessStartedAt: "2026-07-24T12:00:00.000Z",
    runtimeProcessId: 123
  } as const;
  const symptomSha256 = fingerprintCanonicalArtifact(symptom);
  await writeFile(
    join(scenarioDirectory, `symptom-${symptomSha256}.json`),
    `${canonicalizeArtifactJson(symptom)}\n`,
    "utf8"
  );
  const performanceManifest = buildUnifiedPerformanceBenchmarkManifest({
    version: "unified-performance-benchmark-input-v1",
    caseId: scenarioId,
    runId,
    frozenClockIso: "2026-07-24T12:00:00.000Z",
    snapshot: {
      blockNumber: "1",
      blockHash: "2".repeat(64),
      timestamp: "2026-07-24T12:00:00.000Z"
    },
    providerBundleSha256: controlSha256,
    labelDatasetSha256: "3".repeat(64),
    providerConfigurationSha256,
    scoringPolicyVersion: "scoring-signal-matrix-v4",
    attributionPolicyVersion: "selected-attribution-policy-v1",
    analysisPolicyVersion: "snapshot-closure-v2",
    presentationPolicyVersion: "unified-presentation-v1",
    locale: "ru",
    deterministicIdSeed: scenarioId,
    runtimeCommit: candidateCommit,
    checkpointVersion: "unified-production-traversal-checkpoint-v2",
    logicalChunkEvents: 1,
    providerSlots: 4,
    harnessVersion: "unified-adaptive-live-canary-v1"
  });
  const benchmark = sealUnifiedAdaptiveBenchmarkEvidenceV1({
    scenarioId,
    scenarioKind: selected,
    completedAt: "2026-07-24T12:01:00.000Z",
    mode: "live",
    admissionPolicy: "rolling",
    sideEffectPolicy: "isolated",
    requestedCapacity: 4,
    actualAuditedIndependentGroupCapacity: 4,
    independentGroupAudit: audit.envelope,
    performanceManifest,
    timing: { wallTimeMs: 1, aggregateThroughputPerSecond: 1 },
    capacity: {
      eligibleDemand: 4,
      targetSlots: 4,
      actualSlots: 4,
      utilization: 1
    },
    provider: { rollingRps: 4, requests: 4, errors: 0, rateLimited429: 0 },
    limiting: { reason: null, canonicalHeadAgeMs: null },
    buffer: { readyBytes: 0, reservedBytes: 0 },
    database: { latencyMs: 1, checkpointLatencyMs: 1, poolWaitMs: 0 },
    memory: {
      rssBytes: 100,
      heapUsedBytes: 50,
      availableContainerBytes: 1_000,
      availableHostBytes: 2_000
    },
    repair: { maxWaitMs: 0, maxWaitChunks: 0 },
    reuse: {
      providerCacheHits: 0,
      networkFetches: 4,
      addressManifestReuses: 0,
      addressHistoryReplaysAvoided: 0
    },
    restartRecovery: {
      restartCount: 0,
      recoveryMs: 0,
      reconciliationRecoveries: 0,
      duplicateCommits: 0,
      duplicateSequences: 0
    },
    oracle: null,
    runtimeObservationArtifactSha256s: [observationSha256],
    scenarioSymptomArtifactSha256s: [symptomSha256],
    liveOutcomes: [{
      runId,
      subjectAddress: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
      score: 0,
      decision: "ACCEPTABLE",
      evidenceBundleSha256: "4".repeat(64),
      traversalClosureSha256: "5".repeat(64),
      scoringBundleSha256: "6".repeat(64),
      reportSha256: "7".repeat(64),
      benchmarkControlSha256: controlSha256,
      auditedGroupIds: groups,
      dispatchedGroupIds: groups
    }],
    measurement: {
      timing: "observed",
      provider: "observed",
      database: "observed",
      memory: "observed",
      lifecycle: "observed",
      delivery: "observed"
    },
    delivery: {
      eligibleRequests: 1,
      deliveryIntents: 0,
      externalTelegramSends: 0
    }
  });
  const benchmarkFile = "001-selected.json";
  const benchmarkRelativePath = `selected.scenarios/${benchmarkFile}`;
  await writeFile(
    join(scenarioDirectory, benchmarkFile),
    `${benchmark.canonicalJson}\n`,
    "utf8"
  );
  const memorySamples = ["before", "during", "after"].map((phase, index) => ({
    capturedAt: `2026-07-24T12:00:0${index + 1}.000Z`,
    localWslDiagnostic: {
      linuxMemAvailableBytes: null,
      linuxSwapFreeBytes: null,
      linuxSwapTotalBytes: null,
      status: "skipped",
      vmmemWslWorkingSetBytes: null
    },
    nodePid: 123,
    phase,
    runId,
    runtime: { heapUsedBytes: 50, rssBytes: 100 },
    scenarioId: selected,
    version: "unified-memory-sample-v1"
  }));
  const samplesBytes = canonicalizeArtifactJson(memorySamples);
  const summaryBytes = canonicalizeArtifactJson({
    completedAt: "2026-07-24T12:00:03.000Z",
    diagnosticStatus: "skipped",
    runId,
    runtimeTrend: {
      afterRssBytes: 100,
      beforeRssBytes: 100,
      peakRssBytes: 100,
      postRunRssDeltaBytes: 0
    },
    scenarioId: selected,
    scope: "local_wsl_diagnostic",
    verdict: "diagnostic_only",
    version: "unified-local-wsl-memory-summary-v1",
    wslTrend: {
      linuxAvailableDeltaBytes: null,
      postRunVmmemDeltaBytes: null,
      swapUsedGrowthBytes: null
    }
  });
  const samplesSha256 = fingerprintCanonicalArtifact(memorySamples);
  const summarySha256 = fingerprintCanonicalArtifact(JSON.parse(summaryBytes));
  const samplesFile = `memory-samples-${samplesSha256}.json`;
  const summaryFile = `memory-summary-${summarySha256}.json`;
  await writeFile(join(scenarioDirectory, samplesFile), samplesBytes, "utf8");
  await writeFile(join(scenarioDirectory, summaryFile), summaryBytes, "utf8");
  const refill = {
    version: "unified-provider-refill-observation-v1",
    schemaVersion: 1,
    controlSha256,
    observedAt: "2026-07-24T12:00:32.000Z",
    runtimeCommit: candidateCommit,
    providerConfigurationSha256,
    diagnostics: {
      version: "unified-provider-refill-diagnostics-v1",
      assignments: {
        proposed: 4,
        accepted: 4,
        rejected: 0,
        rejections: {
          draining: 0,
          slotActive: 0,
          pendingAssignment: 0,
          staleEpoch: 0
        }
      },
      phases: Object.fromEntries([
        "chunkToCheckpoint",
        "checkpointToController",
        "controllerToPermit",
        "permitToClaim",
        "checkpointToClaim"
      ].map((name) => [name, {
        p50: 1,
        p95: 1,
        max: 1,
        sampleCount: 1
      }])),
      diagnostics: {
        incomplete: 0,
        evictedIncomplete: 0,
        discontinuities: 0,
        invalidClocks: 0
      }
    },
    saturated: {
      sampleCount: 2,
      activeSlotSum: 7,
      fourOfFourSamples: 1,
      unexplainedIdleSamples: 0
    },
    memoryEvidence: {
      samplesSha256,
      summarySha256,
      diagnosticStatus: "skipped"
    }
  } as const;
  const refillBytes = canonicalizeArtifactJson(refill);
  const refillArtifactSha256 = fingerprintCanonicalArtifact(refill);
  const refillFile = `refill-${refillArtifactSha256}.json`;
  await writeFile(join(scenarioDirectory, refillFile), `${refillBytes}\n`, "utf8");
  const exportEvidence = sealUnifiedSelectedRefillExportEvidenceV1({
    scenarioId,
    executionIdentitySha256,
    candidateCommit,
    traversalPolicyVersion: "snapshot-closure-v2",
    benchmarkEvidenceSha256: benchmark.envelope.evidenceSha256,
    benchmarkEvidenceRelativePath: benchmarkRelativePath,
    runId,
    controlSha256,
    providerConfigurationSha256,
    refillArtifactSha256,
    refillArtifactCreatedByRunId: runId,
    refillArtifactRelativePath: `selected.scenarios/${refillFile}`,
    memoryEvidence: {
      nodePid: 123,
      samplesRelativePath: `selected.scenarios/${samplesFile}`,
      samplesSha256,
      summaryRelativePath: `selected.scenarios/${summaryFile}`,
      summarySha256
    }
  });
  const exportFile = `selected-refill-${exportEvidence.envelope.evidenceSha256}.json`;
  await writeFile(
    join(scenarioDirectory, exportFile),
    `${exportEvidence.canonicalJson}\n`,
    "utf8"
  );
  const index = sealUnifiedSelectedAdaptiveBenchmarkIndexV2({
    seed: 1,
    requestedCapacities: [4],
    candidateCommit,
    executionIdentitySha256,
    generatedAt: "2026-07-24T12:01:00.000Z",
    artifacts: [{
      scenarioId,
      relativePath: benchmarkRelativePath,
      evidenceSha256: benchmark.envelope.evidenceSha256,
      candidateCommit,
      executionIdentitySha256:
        benchmark.envelope.performanceManifest.executionIdentitySha256,
      refillArtifactSha256,
      refillArtifactCreatedByRunId: runId,
      selectedRefillEvidenceSha256: exportEvidence.envelope.evidenceSha256,
      selectedRefillEvidenceRelativePath:
        `selected.scenarios/${exportFile}`
    }]
  });
  await writeFile(output, `${index.canonicalJson}\n`, "utf8");
  return {
    args: [
      "--mode", "live",
      "--capacity", "4",
      "--isolated",
      "--scenario", selected,
      "--traversal-policy", "snapshot-closure-v2",
      "--memory-evidence-dir", root,
      "--provider-audit", auditPath,
      "--output", output
    ] as const,
    candidateCommit,
    index: index.envelope,
    refillPath: join(scenarioDirectory, refillFile),
    refillBytes: `${refillBytes}\n`,
    samplesPath: join(scenarioDirectory, samplesFile),
    samplesBytes
  };
}

describe("runUnifiedAdaptiveBenchmark CLI", () => {
  it("allows only the registered TXc selected live scenario and binds policy plus sorted scenarios", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-selected-txc-"));
    const memoryEvidenceDir = join(root, "memory");
    await mkdir(memoryEvidenceDir);
    const audit = sealUnifiedProviderGroupAuditV1({
      auditedAt: "2026-07-24T12:00:00.000Z",
      groups: Array.from({ length: 4 }, (_, index) => ({
        opaqueGroupId: `provider-group-${index + 1}`,
        state: "healthy" as const,
        concurrencyLimit: 1,
        independenceEvidenceSha256: String(index + 1).repeat(64)
      }))
    });
    const auditPath = join(root, "provider-audit.json");
    await writeFile(auditPath, audit.canonicalJson, "utf8");
    const runIsolatedCanaryBenchmark = vi.fn(async () => {
      throw new Error("selected_runtime_invoked");
    });
    const selectedArgs = [
      "--mode", "live",
      "--capacity", "4",
      "--isolated",
      "--scenario", "isolated:TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
      "--traversal-policy", "snapshot-closure-v2",
      "--memory-evidence-dir", memoryEvidenceDir,
      "--provider-audit", auditPath,
      "--output", join(root, "selected.json")
    ] as const;
    await expect(runUnifiedAdaptiveBenchmarkCli(selectedArgs, {
      runtimeCommit: "a".repeat(40),
      runIsolatedCanaryBenchmark
    })).rejects.toThrow("selected_runtime_invoked");
    expect(runIsolatedCanaryBenchmark).toHaveBeenCalledWith(
      expect.objectContaining({
        traversalPolicy: "snapshot-closure-v2",
        scenarios: [
          "isolated:TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd"
        ],
        memoryEvidenceDir
      })
    );

    for (const invalid of [
      "isolated:TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV",
      "isolated:arbitrary"
    ]) {
      await expect(runUnifiedAdaptiveBenchmarkCli([
        ...selectedArgs.slice(0, 6),
        invalid,
        ...selectedArgs.slice(7)
      ], { runIsolatedCanaryBenchmark })).rejects.toThrow(
        "unified_benchmark_cli_scenario_invalid"
      );
    }
    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--scenario", "isolated:TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
      "--traversal-policy", "snapshot-closure-v1",
      "--output", join(root, "replay.json")
    ], replayOracleRuntime())).rejects.toThrow(
      "unified_benchmark_cli_replay_option_invalid"
    );
    await expect(runUnifiedAdaptiveBenchmarkCli([
      ...selectedArgs,
      "--scenario", "isolated:TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd"
    ], { runIsolatedCanaryBenchmark })).rejects.toThrow(
      "unified_benchmark_cli_duplicate"
    );
  });

  it("stops after the single selected canary when the before capture fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-selected-capture-fail-"));
    const audit = sealUnifiedProviderGroupAuditV1({
      auditedAt: "2026-07-24T12:00:00.000Z",
      groups: Array.from({ length: 4 }, (_, index) => ({
        opaqueGroupId: `provider-group-${index + 1}`,
        state: "healthy" as const,
        concurrencyLimit: 1,
        independenceEvidenceSha256: String(index + 1).repeat(64)
      }))
    }).envelope;
    const memoryCapture = {
      before: vi.fn(async () => {
        throw new Error("memory_capture_failed");
      }),
      during: vi.fn(async () => undefined),
      after: vi.fn(async () => {
        throw new Error("after_must_not_run");
      })
    };
    const runCanary = vi.fn(async (_args: readonly string[], hooks: {
      readonly onBatchReady?: (batch: {
        readonly runIds: readonly string[];
        readonly providerConfigurationSha256: string;
        readonly db: { query(): Promise<{ rows: readonly unknown[] }> };
      }) => Promise<unknown>;
    }) => {
      await hooks.onBatchReady?.({
        runIds: ["run-txc"],
        providerConfigurationSha256: "5".repeat(64),
        db: { query: async () => ({ rows: [] }) }
      });
      throw new Error("canary_must_stop_after_capture_failure");
    });

    await expect(runSelectedIsolatedCanaryBenchmark({
      requestedCapacities: [4],
      output: join(root, "selected.json"),
      candidateCommit: "1".repeat(40),
      executionIdentitySha256: "2".repeat(64),
      providerAudit: audit,
      traversalPolicy: "snapshot-closure-v2",
      memoryEvidenceDir: root,
      authorizationStore: createMemorySelectedAuthorizationStore(),
      runCanary: runCanary as never,
      memoryCapture: memoryCapture as never
    })).rejects.toThrow("memory_capture_failed");
    expect(runCanary).toHaveBeenCalledOnce();
    expect(memoryCapture.before).toHaveBeenCalledOnce();
    expect(memoryCapture.during).not.toHaveBeenCalled();
    expect(memoryCapture.after).not.toHaveBeenCalled();
  });

  it("persists an isolated failed maintenance request marker without creating run, task, delivery, or cleanup state", async () => {
    const query = vi.fn(async (
      _sql: string,
      _values?: readonly unknown[]
    ) => ({
      rows: [{ id: "selected-canary-authorization" }]
    }));
    const db = {
      query,
      transaction: async <T>(work: (client: { query: typeof query }) =>
        Promise<T>) => work({ query })
    };
    const marker = buildUnifiedSelectedCanaryAuthorizationMarker({
      candidateCommit: "1".repeat(40),
      executionIdentitySha256: "2".repeat(64),
      traversalPolicyVersion: "snapshot-closure-v2"
    });

    await expect(createPostgresSelectedCanaryAuthorizationStore(
      db as never
    ).authorize(marker)).resolves.toBe("created");

    expect(query).toHaveBeenCalledOnce();
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain("insert into unified_check_requests");
    expect(sql).toContain("'maintenance','isolated','FAILED_TECHNICAL'");
    expect(sql).not.toMatch(/unified_check_(runs|tasks|deliveries)/u);
    expect(sql).not.toMatch(/delete\s+from/iu);
    expect(values).toContain(marker.authorizationSha256);
    expect(values).toContain(canonicalizeArtifactJson(marker));
  });

  it("fails closed when an existing authorization row does not exactly match canonical marker bytes", async () => {
    const marker = buildUnifiedSelectedCanaryAuthorizationMarker({
      candidateCommit: "1".repeat(40),
      executionIdentitySha256: "2".repeat(64),
      traversalPolicyVersion: "snapshot-closure-v2"
    });
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: `selected-canary-authorization:${marker.authorizationSha256}`,
          request_correlation_id:
            `selected-canary-authorization:${marker.authorizationSha256}`,
          run_id: null,
          subject_address: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
          chat_id: "selected-canary-authorization",
          message_thread_id: marker.authorizationSha256,
          locale: "ru",
          run_purpose: "maintenance",
          side_effect_policy: "isolated",
          status: "FAILED_TECHNICAL",
          status_reason: "{}"
        }]
      });
    const db = {
      query,
      transaction: async <T>(work: (client: { query: typeof query }) =>
        Promise<T>) => work({ query })
    };

    await expect(createPostgresSelectedCanaryAuthorizationStore(
      db as never
    ).authorize(marker)).rejects.toThrow(
      "unified_benchmark_selected_authorization_mismatch"
    );
  });

  it("returns exists from the PostgreSQL fence after the first transactional marker insert", async () => {
    const marker = buildUnifiedSelectedCanaryAuthorizationMarker({
      candidateCommit: "1".repeat(40),
      executionIdentitySha256: "2".repeat(64),
      traversalPolicyVersion: "snapshot-closure-v2"
    });
    const id = `selected-canary-authorization:${
      marker.authorizationSha256
    }`;
    let persisted = false;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("insert into unified_check_requests")) {
        if (persisted) return { rows: [] };
        persisted = true;
        return { rows: [{ id }] };
      }
      return {
        rows: [{
          id,
          request_correlation_id: id,
          run_id: null,
          subject_address: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
          chat_id: "selected-canary-authorization",
          message_thread_id: marker.authorizationSha256,
          locale: "ru",
          run_purpose: "maintenance",
          side_effect_policy: "isolated",
          status: "FAILED_TECHNICAL",
          status_reason: canonicalizeArtifactJson(marker)
        }]
      };
    });
    const db = {
      query,
      transaction: async <T>(work: (client: { query: typeof query }) =>
        Promise<T>) => work({ query })
    };
    const store = createPostgresSelectedCanaryAuthorizationStore(db as never);

    await expect(store.authorize(marker)).resolves.toBe("created");
    await expect(store.authorize(marker)).resolves.toBe("exists");
  });

  it("fails closed on restart after selected canary partial state instead of creating a second batch", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-selected-partial-"));
    const input = {
      requestedCapacities: [4] as const,
      output: join(root, "selected.json"),
      candidateCommit: "1".repeat(40),
      executionIdentitySha256: "2".repeat(64),
      providerAudit: sealUnifiedProviderGroupAuditV1({
        auditedAt: "2026-07-24T12:00:00.000Z",
        groups: Array.from({ length: 4 }, (_, index) => ({
          opaqueGroupId: `provider-group-${index + 1}`,
          state: "healthy" as const,
          concurrencyLimit: 1,
          independenceEvidenceSha256: String(index + 1).repeat(64)
        }))
      }).envelope,
      traversalPolicy: "snapshot-closure-v2" as const,
      memoryEvidenceDir: root,
      authorizationStore: createMemorySelectedAuthorizationStore(),
      memoryCapture: {
        before: vi.fn(async () => {
          throw new Error("simulated_process_crash");
        }),
        during: vi.fn(async () => undefined),
        after: vi.fn(async () => {
          throw new Error("after_not_reached");
        })
      } as never
    };
    const runCanary = vi.fn(async (_args: readonly string[], hooks: {
      readonly onBatchReady?: (batch: {
        readonly runIds: readonly string[];
        readonly providerConfigurationSha256: string;
        readonly db: { query(): Promise<{ rows: readonly unknown[] }> };
      }) => Promise<unknown>;
    }) => {
      await hooks.onBatchReady?.({
        runIds: ["run-txc"],
        providerConfigurationSha256: "5".repeat(64),
        db: { query: async () => ({ rows: [] }) }
      });
      throw new Error("canary_continued_after_crash");
    });

    await expect(runSelectedIsolatedCanaryBenchmark({
      ...input,
      runCanary: runCanary as never
    })).rejects.toThrow("simulated_process_crash");
    await expect(runSelectedIsolatedCanaryBenchmark({
      ...input,
      runCanary: runCanary as never
    })).rejects.toThrow("unified_benchmark_selected_partial_state");
    expect(runCanary).toHaveBeenCalledOnce();
  });

  it("does not start the canary when PostgreSQL marker persistence fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-selected-db-fail-"));
    const runCanary = vi.fn(async () => {
      throw new Error("canary_must_not_start");
    });
    const input = {
      requestedCapacities: [4] as const,
      output: join(root, "selected.json"),
      candidateCommit: "1".repeat(40),
      executionIdentitySha256: "2".repeat(64),
      providerAudit: sealUnifiedProviderGroupAuditV1({
        auditedAt: "2026-07-24T12:00:00.000Z",
        groups: Array.from({ length: 4 }, (_, index) => ({
          opaqueGroupId: `provider-group-${index + 1}`,
          state: "healthy" as const,
          concurrencyLimit: 1,
          independenceEvidenceSha256: String(index + 1).repeat(64)
        }))
      }).envelope,
      traversalPolicy: "snapshot-closure-v2" as const,
      memoryEvidenceDir: root,
      authorizationStore: {
        async authorize() {
          throw new Error("selected_marker_persistence_failed");
        }
      },
      runCanary: runCanary as never
    };

    await expect(runSelectedIsolatedCanaryBenchmark(input))
      .rejects.toThrow("selected_marker_persistence_failed");
    expect(runCanary).not.toHaveBeenCalled();
  });

  it("blocks restart after an ancestor pathname swap when the DB marker committed before runner", async () => {
    const firstRoot = await mkdtemp(join(tmpdir(), "unified-selected-db-first-"));
    const secondRoot = await mkdtemp(join(tmpdir(), "unified-selected-db-second-"));
    const swappedAncestor = join(firstRoot, "output");
    const durableMarkers = new Set<string>();
    let crash = true;
    const authorizationStore = {
      async authorize(marker: { readonly authorizationSha256: string }) {
        if (durableMarkers.has(marker.authorizationSha256)) {
          return "exists" as const;
        }
        durableMarkers.add(marker.authorizationSha256);
        if (crash) {
          crash = false;
          throw new Error("simulated_crash_after_marker_commit");
        }
        return "created" as const;
      }
    };
    const runCanary = vi.fn(async () => {
      throw new Error("canary_must_not_start");
    });
    const common = {
      requestedCapacities: [4] as const,
      candidateCommit: "1".repeat(40),
      executionIdentitySha256: "2".repeat(64),
      providerAudit: sealUnifiedProviderGroupAuditV1({
        auditedAt: "2026-07-24T12:00:00.000Z",
        groups: Array.from({ length: 4 }, (_, index) => ({
          opaqueGroupId: `provider-group-${index + 1}`,
          state: "healthy" as const,
          concurrencyLimit: 1,
          independenceEvidenceSha256: String(index + 1).repeat(64)
        }))
      }).envelope,
      traversalPolicy: "snapshot-closure-v2" as const,
      authorizationStore,
      runCanary: runCanary as never
    };

    await expect(runSelectedIsolatedCanaryBenchmark({
      ...common,
      output: join(swappedAncestor, "selected.json"),
      memoryEvidenceDir: firstRoot
    })).rejects.toThrow("simulated_crash_after_marker_commit");
    await symlink(secondRoot, swappedAncestor, "junction");
    await expect(runSelectedIsolatedCanaryBenchmark({
      ...common,
      output: join(swappedAncestor, "selected.json"),
      memoryEvidenceDir: secondRoot
    })).rejects.toThrow("unified_benchmark_selected_partial_state");
    expect(runCanary).not.toHaveBeenCalled();
  });

  it("resumes selected evidence without recapture and rejects replaced refill or memory bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-selected-resume-"));
    const fixture = await writeSelectedLiveResumeBundle(root);
    const runIsolatedCanaryBenchmark = vi.fn(async () => {
      throw new Error("selected_canary_must_not_rerun");
    });
    const runtime = {
      runtimeCommit: fixture.candidateCommit,
      runIsolatedCanaryBenchmark
    };

    await expect(runUnifiedAdaptiveBenchmarkCli(fixture.args, runtime))
      .resolves.toEqual(fixture.index);
    expect(runIsolatedCanaryBenchmark).not.toHaveBeenCalled();

    await writeFile(fixture.refillPath, "{}\n", "utf8");
    await expect(runUnifiedAdaptiveBenchmarkCli(fixture.args, runtime))
      .rejects.toThrow("unified_benchmark_existing_artifact_mismatch");
    expect(runIsolatedCanaryBenchmark).not.toHaveBeenCalled();

    await writeFile(fixture.refillPath, fixture.refillBytes, "utf8");
    await writeFile(fixture.samplesPath, "[]", "utf8");
    await expect(runUnifiedAdaptiveBenchmarkCli(fixture.args, runtime))
      .rejects.toThrow("unified_benchmark_existing_artifact_mismatch");
    expect(runIsolatedCanaryBenchmark).not.toHaveBeenCalled();
  });

  it("captures one before/during/after process sample with stable IDs and validates summary bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-memory-capture-"));
    const calls: Array<{
      phase: string;
      runId: string;
      scenarioId: string;
      nodePid: number;
    }> = [];
    const phaseRunner = vi.fn(async (input: {
      readonly phase: "before" | "during" | "after";
      readonly runId: string;
      readonly scenarioId: string;
      readonly nodePid: number;
    }) => {
      calls.push(input);
      return { sampleBytes: canonicalizeArtifactJson({
        capturedAt: `2026-07-24T12:00:0${calls.length}.000Z`,
        localWslDiagnostic: {
          linuxMemAvailableBytes: 300,
          linuxSwapFreeBytes: 0,
          linuxSwapTotalBytes: 0,
          status: "captured",
          vmmemWslWorkingSetBytes: 200
        },
        nodePid: input.nodePid,
        phase: input.phase,
        runId: input.runId,
        runtime: { heapUsedBytes: 50, rssBytes: 100 },
        scenarioId: input.scenarioId,
        version: "unified-memory-sample-v1"
      }) };
    });
    const capture = createUnifiedBenchmarkMemoryCapture({
      directory: root,
      scenarioId: "isolated:TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
      nodePid: 123,
      memoryUsage: () => ({ rss: 100, heapUsed: 50 }),
      phaseRunner
    });
    await capture.before("run-txc");
    await capture.during("run-txc");
    await capture.during("run-txc");
    const evidence = await capture.after("run-txc");
    expect(calls.map((call) => call.phase))
      .toEqual(["before", "during", "after"]);
    expect(calls.every((call) =>
      call.runId === "run-txc" &&
      call.scenarioId ===
        "isolated:TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd" &&
      call.nodePid === 123
    )).toBe(true);
    expect(evidence).toEqual({
      samplesSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      summarySha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      diagnosticStatus: "captured",
      nodePid: 123,
      samplesBytes: expect.any(String),
      summaryBytes: expect.any(String)
    });
  });

  it("rejects a phase response whose runtime values differ from Node-captured input", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-memory-runtime-swap-"));
    const capture = createUnifiedBenchmarkMemoryCapture({
      directory: root,
      scenarioId: "selected",
      nodePid: 123,
      memoryUsage: () => ({ rss: 100, heapUsed: 50 }),
      phaseRunner: async (input: {
        readonly phase: "before" | "during" | "after";
        readonly runId: string;
        readonly scenarioId: string;
        readonly nodePid: number;
        readonly runtime: {
          readonly rssBytes: number;
          readonly heapUsedBytes: number;
        };
      }) => ({
        sampleBytes: canonicalizeArtifactJson({
          capturedAt: "2026-07-24T12:00:01.000Z",
          localWslDiagnostic: {
            linuxMemAvailableBytes: null,
            linuxSwapFreeBytes: null,
            linuxSwapTotalBytes: null,
            status: "skipped",
            vmmemWslWorkingSetBytes: null
          },
          nodePid: input.nodePid,
          phase: input.phase,
          runId: input.runId,
          runtime: {
            heapUsedBytes: input.runtime.heapUsedBytes,
            rssBytes: input.runtime.rssBytes + 1
          },
          scenarioId: input.scenarioId,
          version: "unified-memory-sample-v1"
        })
      })
    });

    await expect(capture.before("run-txc"))
      .rejects.toThrow("unified_benchmark_memory_runtime_mismatch");
  });

  it("uses a fresh capture directory and never follows a preexisting child symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-memory-link-"));
    const external = join(root, "external.json");
    await writeFile(external, "unchanged", "utf8");
    await symlink(external, join(root, "memory-samples.json"), "file");
    const phaseRunner = vi.fn(async (input: {
      readonly phase: "before" | "during" | "after";
      readonly runId: string;
      readonly scenarioId: string;
      readonly nodePid: number;
      readonly samplesPath: string;
    }) => {
      return { sampleBytes: canonicalizeArtifactJson({
          capturedAt: `2026-07-24T12:00:0${
            ["before", "during", "after"].indexOf(input.phase) + 1
          }.000Z`,
          localWslDiagnostic: {
            linuxMemAvailableBytes: null,
            linuxSwapFreeBytes: null,
            linuxSwapTotalBytes: null,
            status: "skipped",
            vmmemWslWorkingSetBytes: null
          },
          nodePid: input.nodePid,
          phase: input.phase,
          runId: input.runId,
          runtime: { heapUsedBytes: 50, rssBytes: 100 },
          scenarioId: input.scenarioId,
          version: "unified-memory-sample-v1"
        }) };
    });
    const capture = createUnifiedBenchmarkMemoryCapture({
      directory: root,
      scenarioId: "selected",
      nodePid: 123,
      memoryUsage: () => ({ rss: 100, heapUsed: 50 }),
      phaseRunner
    });

    await capture.before("run-txc");
    await capture.during("run-txc");
    await capture.after("run-txc");

    expect(await readFile(external, "utf8")).toBe("unchanged");
    expect(phaseRunner.mock.calls[0]?.[0].samplesPath)
      .not.toBe(join(root, "memory-samples.json"));
  });

  it("fails an injected child-link swap without touching its external target", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-memory-swap-"));
    const external = join(root, "external.json");
    await writeFile(external, "unchanged", "utf8");
    const phaseRunner = vi.fn(async (input: {
      readonly phase: "before" | "during" | "after";
      readonly runId: string;
      readonly scenarioId: string;
      readonly nodePid: number;
      readonly samplesPath: string;
    }) => {
      if (input.phase === "after") {
        await symlink(external, input.samplesPath, "file");
      }
      return {
        sampleBytes: canonicalizeArtifactJson({
          capturedAt: `2026-07-24T12:00:0${
            ["before", "during", "after"].indexOf(input.phase) + 1
          }.000Z`,
          localWslDiagnostic: {
            linuxMemAvailableBytes: null,
            linuxSwapFreeBytes: null,
            linuxSwapTotalBytes: null,
            status: "skipped",
            vmmemWslWorkingSetBytes: null
          },
          nodePid: input.nodePid,
          phase: input.phase,
          runId: input.runId,
          runtime: { heapUsedBytes: 50, rssBytes: 100 },
          scenarioId: input.scenarioId,
          version: "unified-memory-sample-v1"
        })
      };
    });
    const capture = createUnifiedBenchmarkMemoryCapture({
      directory: root,
      scenarioId: "selected",
      nodePid: 123,
      memoryUsage: () => ({ rss: 100, heapUsed: 50 }),
      phaseRunner
    });

    await capture.before("run-txc");
    await capture.during("run-txc");
    await expect(capture.after("run-txc"))
      .rejects.toThrow("unified_benchmark_memory_child_exists");
    expect(await readFile(external, "utf8")).toBe("unchanged");
  });

  it("seals the refill artifact creator, runtime, provider configuration, policy, execution, and exact memory files", () => {
    const sealed = sealUnifiedSelectedRefillExportEvidenceV1({
      scenarioId: "live:c4:isolated:TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
      executionIdentitySha256: "1".repeat(64),
      candidateCommit: "2".repeat(40),
      traversalPolicyVersion: "snapshot-closure-v2",
      benchmarkEvidenceSha256: "3".repeat(64),
      benchmarkEvidenceRelativePath: "selected.scenarios/001.json",
      runId: "run-txc",
      controlSha256: "4".repeat(64),
      providerConfigurationSha256: "5".repeat(64),
      refillArtifactSha256: "6".repeat(64),
      refillArtifactCreatedByRunId: "run-txc",
      refillArtifactRelativePath: "selected.scenarios/refill.json",
      memoryEvidence: {
        nodePid: 123,
        samplesRelativePath: "selected.scenarios/memory-samples.json",
        samplesSha256: "7".repeat(64),
        summaryRelativePath: "selected.scenarios/memory-summary.json",
        summarySha256: "8".repeat(64)
      }
    });

    expect(parseUnifiedSelectedRefillExportEvidenceV1(
      sealed.canonicalJson
    )).toEqual(sealed.envelope);
    expect(sealed.envelope).toMatchObject({
      schemaVersion: 1,
      refillArtifactCreatedByRunId: "run-txc",
      refillArtifactSha256: "6".repeat(64)
    });
    expect(() => parseUnifiedSelectedRefillExportEvidenceV1(
      canonicalizeArtifactJson({
        ...sealed.envelope,
        refillArtifactCreatedByRunId: "replacement-run"
      })
    )).toThrow("unified_benchmark_selected_refill_export_invalid");
  });

  it("binds the selected refill artifact hash and creator directly into the live index", () => {
    const sealed = sealUnifiedSelectedAdaptiveBenchmarkIndexV2({
      seed: 1,
      requestedCapacities: [4],
      candidateCommit: "1".repeat(40),
      executionIdentitySha256: "2".repeat(64),
      generatedAt: "2026-07-24T12:00:00.000Z",
      artifacts: [{
        scenarioId: "live:c4:isolated:TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
        relativePath: "selected.scenarios/001.json",
        evidenceSha256: "3".repeat(64),
        candidateCommit: "1".repeat(40),
        executionIdentitySha256: "4".repeat(64),
        refillArtifactSha256: "5".repeat(64),
        refillArtifactCreatedByRunId: "run-txc",
        selectedRefillEvidenceSha256: "6".repeat(64),
        selectedRefillEvidenceRelativePath:
          "selected.scenarios/selected-refill.json"
      }]
    });

    expect(parseUnifiedSelectedAdaptiveBenchmarkIndexV2(
      sealed.canonicalJson
    )).toEqual(sealed.envelope);
    expect(sealed.envelope).toMatchObject({
      version: "unified-adaptive-benchmark-index-v2",
      schemaVersion: 2,
      artifacts: [{
        refillArtifactSha256: "5".repeat(64),
        refillArtifactCreatedByRunId: "run-txc"
      }]
    });
  });

  it("uses the completed canary traversal policy for live performance identity", () => {
    expect(completedCanaryTraversalPolicy([
      { traversalPolicyVersion: "snapshot-closure-v2" },
      { traversalPolicyVersion: "snapshot-closure-v2" }
    ])).toBe("snapshot-closure-v2");
    expect(() => completedCanaryTraversalPolicy([
      { traversalPolicyVersion: "snapshot-closure-v1" },
      { traversalPolicyVersion: "snapshot-closure-v2" }
    ])).toThrow("unified_benchmark_live_traversal_policy_mismatch");
  });

  it("counts zero-duration live attempts at the same timestamp", () => {
    expect(calculateUnifiedBenchmarkPeakConcurrency([{
      startedAt: "2026-07-25T09:00:00.000Z",
      completedAt: "2026-07-25T09:00:00.000Z"
    }])).toBe(1);
    expect(calculateUnifiedBenchmarkPeakConcurrency([
      {
        startedAt: "2026-07-25T09:00:00.000Z",
        completedAt: "2026-07-25T09:00:00.000Z"
      },
      {
        startedAt: "2026-07-25T09:00:00.000Z",
        completedAt: "2026-07-25T09:00:00.000Z"
      },
      {
        startedAt: "2026-07-25T09:00:00.000Z",
        completedAt: "2026-07-25T09:00:00.000Z"
      }
    ])).toBe(3);
  });

  it("uses half-open boundaries while counting zero-duration attempts within overlaps", () => {
    expect(calculateUnifiedBenchmarkPeakConcurrency([
      {
        startedAt: "2026-07-25T09:00:00.000Z",
        completedAt: "2026-07-25T09:00:10.000Z"
      },
      {
        startedAt: "2026-07-25T09:00:05.000Z",
        completedAt: "2026-07-25T09:00:15.000Z"
      },
      {
        startedAt: "2026-07-25T09:00:07.000Z",
        completedAt: "2026-07-25T09:00:07.000Z"
      }
    ])).toBe(3);
    expect(calculateUnifiedBenchmarkPeakConcurrency([
      {
        startedAt: "2026-07-25T09:00:00.000Z",
        completedAt: "2026-07-25T09:00:10.000Z"
      },
      {
        startedAt: "2026-07-25T09:00:10.000Z",
        completedAt: "2026-07-25T09:00:20.000Z"
      }
    ])).toBe(1);
  });

  it("exposes a machine-readable restart-required phase for process-boundary resume", () => {
    const error = new UnifiedAdaptiveBenchmarkRestartRequiredError({
      output: "benchmark.json",
      scenarioId: "live:c1:restart_recovery",
      runIds: ["restart-run"],
      benchmarkControlSha256: "a".repeat(64),
      executionIdentitySha256: "c".repeat(64),
      stateIdentitySha256: "d".repeat(64),
      handoffArtifactSha256: "b".repeat(64),
      resumeDeadline: "2026-07-25T09:10:00.000Z"
    });

    expect(error.exitCode).toBe(75);
    expect(error.phase).toEqual({
      version: "unified-adaptive-benchmark-phase-v1",
      status: "restart_required",
      output: "benchmark.json",
      scenarioId: "live:c1:restart_recovery",
      runIds: ["restart-run"],
      benchmarkControlSha256: "a".repeat(64),
      executionIdentitySha256: "c".repeat(64),
      stateIdentitySha256: "d".repeat(64),
      handoffArtifactSha256: "b".repeat(64),
      resumeDeadline: "2026-07-25T09:10:00.000Z",
      resumeRequired: true
    });
  });

  it("keeps canary callbacks release-noop and lets the outer owner release exactly once", async () => {
    const release = vi.fn(async () => undefined);
    const owner = createUnifiedBenchmarkReleaseOwner();
    owner.set(release);

    await owner.callbackRelease();
    await owner.callbackRelease();
    expect(release).not.toHaveBeenCalled();
    await owner.releaseOnce();
    await owner.releaseOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("strictly binds a kill-boundary capacity state to its control lease identity", () => {
    const leaseIdentity = {
      version: "unified-adaptive-control-lease-identity-v1",
      controlSha256: "a".repeat(64),
      leaseOwner: "lease-owner",
      createdByRunId: "primary-run"
    };
    const withoutHash = {
      version: "unified-adaptive-live-capacity-state-v1",
      candidateCommit: "b".repeat(40),
      executionIdentitySha256: "c".repeat(64),
      capacity: 1,
      primaryBatchIdentitySha256: "d".repeat(64),
      primaryControlSha256: leaseIdentity.controlSha256,
      primaryControlLeaseOwner: leaseIdentity.leaseOwner,
      primaryControlCreatedByRunId: leaseIdentity.createdByRunId,
      primaryControlLeaseIdentitySha256:
        fingerprintCanonicalArtifact(leaseIdentity),
      primaryRunIds: ["primary-run"],
      lateBatchIdentitySha256: "e".repeat(64),
      lateControlSha256: leaseIdentity.controlSha256,
      lateRunId: "late-run"
    };
    const state = {
      ...withoutHash,
      stateSha256: fingerprintCanonicalArtifact(withoutHash)
    };
    expect(parseUnifiedAdaptiveLiveCapacityStateV1(
      canonicalizeArtifactJson(state),
      {
        candidateCommit: withoutHash.candidateCommit,
        executionIdentitySha256:
          withoutHash.executionIdentitySha256,
        capacity: 1
      }
    )).toEqual(state);

    const { primaryControlLeaseOwner: _missing, ...missingLease } =
      state;
    expect(() => parseUnifiedAdaptiveLiveCapacityStateV1(
      canonicalizeArtifactJson(missingLease),
      {
        candidateCommit: withoutHash.candidateCommit,
        executionIdentitySha256:
          withoutHash.executionIdentitySha256,
        capacity: 1
      }
    )).toThrow("unified_benchmark_existing_artifact_mismatch");
    expect(() => parseUnifiedAdaptiveLiveCapacityStateV1(
      canonicalizeArtifactJson({
        ...state,
        primaryControlLeaseOwner: "forged-owner"
      }),
      {
        candidateCommit: withoutHash.candidateCommit,
        executionIdentitySha256:
          withoutHash.executionIdentitySha256,
        capacity: 1
      }
    )).toThrow("unified_benchmark_existing_artifact_mismatch");
  });

  it.each(["success", "error"])(
    "recovers and releases a kill-boundary capacity lease exactly once on %s",
    async (outcome) => {
      const leaseIdentity = {
        version: "unified-adaptive-control-lease-identity-v1",
        controlSha256: "a".repeat(64),
        leaseOwner: "lease-owner",
        createdByRunId: "primary-run"
      };
      const withoutHash = {
        version: "unified-adaptive-live-capacity-state-v1" as const,
        candidateCommit: "b".repeat(40),
        executionIdentitySha256: "c".repeat(64),
        capacity: 1,
        primaryBatchIdentitySha256: "d".repeat(64),
        primaryControlSha256: leaseIdentity.controlSha256,
        primaryControlLeaseOwner: leaseIdentity.leaseOwner,
        primaryControlCreatedByRunId: leaseIdentity.createdByRunId,
        primaryControlLeaseIdentitySha256:
          fingerprintCanonicalArtifact(leaseIdentity),
        primaryRunIds: ["primary-run"],
        lateBatchIdentitySha256: "e".repeat(64),
        lateControlSha256: leaseIdentity.controlSha256,
        lateRunId: "late-run"
      };
      const state = {
        ...withoutHash,
        stateSha256: fingerprintCanonicalArtifact(withoutHash)
      };
      const query = vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ sha256: leaseIdentity.controlSha256 }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            sha256: leaseIdentity.controlSha256,
            released: false
          }]
        })
        .mockResolvedValueOnce({ rows: [] });
      const db = {
        query,
        transaction: async <T>(
          work: (tx: { query: typeof query }) => Promise<T>
        ) => work({ query })
      };
      const owner = createUnifiedBenchmarkReleaseOwner();
      const renewal = {
        set: vi.fn(),
        stop: vi.fn(async () => undefined)
      };
      await recoverUnifiedBenchmarkCapacityStateControl({
        db,
        state,
        now: new Date("2026-07-25T09:00:00.000Z"),
        releaseOwner: owner,
        renewalLoop: renewal
      });
      const scoped = runUnifiedBenchmarkControlScope({
        releaseOwner: owner,
        renewalLoop: renewal,
        restartIdentity: () => null,
        work: async () => {
          if (outcome === "error") throw new Error("canary_failed");
          return "completed";
        }
      });
      if (outcome === "error") {
        await expect(scoped).rejects.toThrow("canary_failed");
      } else {
        await expect(scoped).resolves.toBe("completed");
      }
      expect(renewal.stop).toHaveBeenCalledOnce();
      expect(query.mock.calls.filter((call) =>
        String(call[0]).includes(
          "'adaptive_benchmark_control_release','1'"
        )
      )).toHaveLength(1);
    }
  );

  it.each(["primary", "late"])(
    "releases the shared control once when the %s canary fails",
    async (phase) => {
      const release = vi.fn(async () => undefined);
      const stop = vi.fn(async () => undefined);
      const owner = createUnifiedBenchmarkReleaseOwner();
      owner.set(release);

      await expect(runUnifiedBenchmarkControlScope({
        releaseOwner: owner,
        renewalLoop: { stop },
        restartIdentity: () => null,
        work: async () => {
          throw new Error(`${phase}_canary_failed`);
        }
      })).rejects.toThrow(`${phase}_canary_failed`);

      expect(stop).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
    }
  );

  it("releases on a generic restart-like error", async () => {
    const release = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const owner = createUnifiedBenchmarkReleaseOwner();
    owner.set(release);

    await expect(runUnifiedBenchmarkControlScope({
      releaseOwner: owner,
      renewalLoop: { stop },
      restartIdentity: () => ({
        output: "benchmark.json",
        benchmarkControlSha256: "a".repeat(64),
        executionIdentitySha256: "c".repeat(64),
        stateIdentitySha256: "d".repeat(64),
        scenarioId: "live:c1:restart_recovery",
        runIds: ["restart-run"],
        handoffArtifactSha256: "b".repeat(64),
        resumeDeadline: "2026-07-25T09:10:00.000Z"
      }),
      work: async () => {
        throw new Error("restart_required");
      }
    })).rejects.toThrow("restart_required");

    expect(stop).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("preserves only a scope-authenticated exact restart handoff identity", async () => {
    const identity = {
      output: "benchmark.json",
      benchmarkControlSha256: "a".repeat(64),
      executionIdentitySha256: "c".repeat(64),
      stateIdentitySha256: "d".repeat(64),
      scenarioId: "live:c1:restart_recovery",
      runIds: ["restart-run"],
      handoffArtifactSha256: "b".repeat(64),
      resumeDeadline: "2026-07-25T09:10:00.000Z"
    };
    const runPublicError = async (error: Error) => {
      const release = vi.fn(async () => undefined);
      const stop = vi.fn(async () => undefined);
      const owner = createUnifiedBenchmarkReleaseOwner();
      owner.set(release);
      await expect(runUnifiedBenchmarkControlScope({
        releaseOwner: owner,
        renewalLoop: { stop },
        restartIdentity: () => identity,
        work: async () => {
          throw error;
        }
      })).rejects.toBe(error);
      return { release, stop };
    };
    const publiclyConstructed =
      new UnifiedAdaptiveBenchmarkRestartRequiredError(identity);
    const publicResult = await runPublicError(publiclyConstructed);
    expect(publicResult.stop).toHaveBeenCalledOnce();
    expect(publicResult.release).toHaveBeenCalledOnce();

    const forgedIdentity =
      new UnifiedAdaptiveBenchmarkRestartRequiredError({
        ...identity,
        executionIdentitySha256: "e".repeat(64)
      });
    const forged = await runPublicError(forgedIdentity);
    expect(forged.stop).toHaveBeenCalledOnce();
    expect(forged.release).toHaveBeenCalledOnce();

    const release = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const owner = createUnifiedBenchmarkReleaseOwner();
    owner.set(release);
    await expect(runUnifiedBenchmarkControlScope({
      releaseOwner: owner,
      renewalLoop: { stop },
      restartIdentity: () => identity,
      work: async ({ restartRequired }) => {
        restartRequired(identity);
      }
    })).rejects.toMatchObject({
      exitCode: 75,
      phase: identity
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
  });

  it("releases instead of preserving when restart renewal cleanup fails", async () => {
    const identity = {
      output: "benchmark.json",
      benchmarkControlSha256: "a".repeat(64),
      executionIdentitySha256: "c".repeat(64),
      stateIdentitySha256: "d".repeat(64),
      scenarioId: "live:c1:restart_recovery",
      runIds: ["restart-run"],
      handoffArtifactSha256: "b".repeat(64),
      resumeDeadline: "2026-07-25T09:10:00.000Z"
    };
    const release = vi.fn(async () => undefined);
    const stopError = new Error("renewal_stop_failed");
    const owner = createUnifiedBenchmarkReleaseOwner();
    owner.set(release);
    const failure = runUnifiedBenchmarkControlScope({
      releaseOwner: owner,
      renewalLoop: {
        stop: vi.fn(async () => {
          throw stopError;
        })
      },
      restartIdentity: () => identity,
      work: async ({ restartRequired }) => {
        restartRequired(identity);
      }
    });
    await expect(failure).rejects.toBe(stopError);
    await expect(failure).rejects.not.toBeInstanceOf(
      UnifiedAdaptiveBenchmarkRestartRequiredError
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it("surfaces both renewal-stop and fenced-release failures", async () => {
    const identity = {
      output: "benchmark.json",
      benchmarkControlSha256: "a".repeat(64),
      executionIdentitySha256: "c".repeat(64),
      stateIdentitySha256: "d".repeat(64),
      scenarioId: "live:c1:restart_recovery",
      runIds: ["restart-run"],
      handoffArtifactSha256: "b".repeat(64),
      resumeDeadline: "2026-07-25T09:10:00.000Z"
    };
    const owner = createUnifiedBenchmarkReleaseOwner();
    owner.set(async () => {
      throw new Error("release_failed");
    });
    await expect(runUnifiedBenchmarkControlScope({
      releaseOwner: owner,
      renewalLoop: {
        stop: async () => {
          throw new Error("renewal_stop_failed");
        }
      },
      restartIdentity: () => identity,
      work: async ({ restartRequired }) => {
        restartRequired(identity);
      }
    })).rejects.toMatchObject({
      name: "AggregateError",
      message: "unified_benchmark_control_cleanup_failed",
      errors: [
        expect.objectContaining({ message: "renewal_stop_failed" }),
        expect.objectContaining({ message: "release_failed" })
      ]
    });
  });

  it("opens lifecycle seams only after a bounded checkpoint and before terminal state", () => {
    const checkpointed = {
      status: "RUNNING",
      tasks: [{ attemptDurations: [{ outcome: "CHECKPOINTED" }] }]
    };
    expect(isNonterminalCheckpointedBenchmarkRun(checkpointed)).toBe(true);
    expect(isNonterminalCheckpointedBenchmarkRun({
      ...checkpointed,
      status: "COMPLETED"
    })).toBe(false);
    expect(isNonterminalCheckpointedBenchmarkRun({
      status: "RUNNING",
      tasks: [{ attemptDurations: [{ outcome: "COMPLETED" }] }]
    })).toBe(false);
  });

  it("consumes a canonical immutable PostgreSQL lifecycle receipt on the production replay path", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-adaptive-receipt-"));
    const fixtureBytes = await readFile(
      "tests/fixtures/unified-wallet/adaptive-rolling-provider-replay.json",
      "utf8"
    );
    const replay = parseUnifiedProviderReplayV1(
      canonicalJsonFilePayload(fixtureBytes)
    );
    const facts = oracleFacts();
    const receipt = sealUnifiedRollingOracleReceiptV1({
      generatedAt: replay.frozenClockIso,
      producerVersion: "unified-postgres-lifecycle-oracle-v1",
      schemaVersion: 34,
      replaySha256: replay.expectedReplaySha256,
      seed: 24072026,
      barrierFacts: facts,
      rollingFacts: [1, 4, 8, 16, 32, 100].map((capacity) => ({
        capacity,
        seed: 24072026 + capacity,
        facts
      }))
    });
    const receiptPath = join(root, "rolling-oracle-receipt.json");
    await writeFile(receiptPath, `${receipt.canonicalJson}\n`, "utf8");

    const index = await runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--oracle-receipt", receiptPath,
      "--output", join(root, "replay-index.json")
    ]);

    expect(index.artifacts).toHaveLength(9);
  });

  it("runs the real offline replay matrix, writes each immutable scenario first, and resumes exact artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-adaptive-replay-"));
    const output = join(root, "replay-index.json");
    const fetch = vi.fn(async () => {
      throw new Error("network must not be called");
    });
    vi.stubGlobal("fetch", fetch);
    const runtime = replayOracleRuntime();

    const first = await runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", output
    ], runtime);
    expect(first.mode).toBe("replay");
    expect(first.artifacts.every((item) =>
      item.relativePath.startsWith("replay-index.scenarios/")
    )).toBe(true);
    expect(first.artifacts.map((item) => item.scenarioId)).toEqual([
      "replay:c1:one_dense_wallet",
      "replay:c1:three_dense_wallets",
      "replay:c1:fifteen_dense_wallets",
      "replay:c1:late_interactive",
      "replay:c1:slow_canonical_head",
      "replay:c1:provider_cooldown",
      "replay:c1:restart_recovery",
      "replay:c1:full_merge_buffer",
      "replay:c1:repair_arrival_capacity_one"
    ]);
    expect(fetch).not.toHaveBeenCalled();

    const scenarioDirectory = join(root, "replay-index.scenarios");
    const scenarioFiles = (await readdir(scenarioDirectory)).sort();
    expect(scenarioFiles).toHaveLength(first.artifacts.length);
    const before = new Map(await Promise.all(scenarioFiles.map(async (file) => [
      file,
      (await stat(join(scenarioDirectory, file))).mtimeMs
    ] as const)));
    for (const file of scenarioFiles) {
      const raw = await readFile(join(scenarioDirectory, file), "utf8");
      const evidence = parseUnifiedAdaptiveBenchmarkEvidenceV1(
        raw.endsWith("\n") ? raw.slice(0, -1) : raw
      );
      expect(evidence.oracle?.exactEquivalent).toBe(true);
      expect(evidence.delivery.externalTelegramSends).toBe(0);
    }

    const resumed = await runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", output
    ], runtime);
    expect(resumed).toEqual(first);
    expect(runtime.resolveReplayOracleReceipt).toHaveBeenCalledTimes(2);
    for (const file of scenarioFiles) {
      expect((await stat(join(scenarioDirectory, file))).mtimeMs)
        .toBe(before.get(file));
    }
  });

  it("selects the policy-matched built-in replay and refuses cross-policy resume", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-replay-policy-"));
    const output = join(root, "policy-index.json");
    const v1Runtime = replayOracleRuntime();
    const v1 = await runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1,4,8,16,32,100",
      "--seed", "24072026",
      "--traversal-policy", "snapshot-closure-v1",
      "--output", output
    ], v1Runtime);
    const v1Fixture = parseUnifiedProviderReplayV1(
      canonicalJsonFilePayload(await readFile(
        "tests/fixtures/unified-wallet/adaptive-rolling-provider-replay.json",
        "utf8"
      ))
    );
    expect(v1Runtime.resolveReplayOracleReceipt)
      .toHaveBeenCalledWith(expect.objectContaining({
        replaySha256: v1Fixture.expectedReplaySha256
      }));

    const v2Runtime = replayOracleRuntime();
    const v2Args = [
      "--mode", "replay",
      "--capacity", "1,4,8,16,32,100",
      "--seed", "24072026",
      "--traversal-policy", "snapshot-closure-v2",
      "--output", join(root, "policy-v2-index.json")
    ] as const;
    const v2 = await runUnifiedAdaptiveBenchmarkCli(v2Args, v2Runtime);
    await expect(runUnifiedAdaptiveBenchmarkCli([
      ...v2Args.slice(0, -1),
      output
    ], v2Runtime)).rejects.toThrow(
      "unified_benchmark_existing_artifact_mismatch"
    );
    const v2Fixture = parseUnifiedProviderReplayV1(
      canonicalJsonFilePayload(await readFile(
        "tests/fixtures/unified-wallet/adaptive-rolling-provider-replay-v2.json",
        "utf8"
      ))
    );
    expect(v2Runtime.resolveReplayOracleReceipt)
      .toHaveBeenCalledWith(expect.objectContaining({
        replaySha256: v2Fixture.expectedReplaySha256
      }));
    expect(v1.executionIdentitySha256)
      .not.toBe(v2.executionIdentitySha256);
  });

  it("fails rather than adopting a mismatched existing scenario artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-adaptive-mismatch-"));
    const output = join(root, "replay-index.json");
    const runtime = replayOracleRuntime();
    const first = await runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", output
    ], runtime);
    const artifactPath = join(
      root,
      first.artifacts[0]!.relativePath
    );
    const parsed = JSON.parse(await readFile(artifactPath, "utf8"));
    parsed.scenarioId = "tampered";
    await writeFile(artifactPath, JSON.stringify(parsed), "utf8");

    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", output
    ], runtime)).rejects.toThrow(
      "unified_benchmark_existing_artifact_mismatch"
    );
  });

  it("refuses to resume artifacts bound to a different oracle receipt", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-adaptive-oracle-"));
    const output = join(root, "replay-index.json");
    await runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", output
    ], replayOracleRuntime(
      "same-oracle",
      "2026-07-24T12:00:00.000Z"
    ));

    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", output
    ], replayOracleRuntime(
      "same-oracle",
      "2026-07-24T12:00:01.000Z"
    ))).rejects.toThrow(
      "unified_benchmark_existing_artifact_mismatch"
    );
  });

  it("rejects unsafe output and invokes only the audited isolated-canary live seam", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-adaptive-live-"));
    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", join(root, ".codex-live", "forbidden.json")
    ], replayOracleRuntime())).rejects.toThrow(
      "unified_benchmark_output_forbidden"
    );

    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", join(root, "missing-receipt.json")
    ])).rejects.toThrow("unified_benchmark_replay_oracle_receipt_required");

    const output = join(root, "live-index.json");
    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "live",
      "--capacity", "4",
      "--isolated",
      "--output", output
    ])).rejects.toThrow("unified_benchmark_live_group_audit_required");

    const audit = sealUnifiedProviderGroupAuditV1({
      auditedAt: "2026-07-24T12:00:00.000Z",
      groups: Array.from({ length: 4 }, (_, index) => ({
        opaqueGroupId: `provider-group-${index + 1}`,
        state: "healthy" as const,
        concurrencyLimit: 1,
        independenceEvidenceSha256: String(index + 1).repeat(64)
      }))
    });
    const auditPath = join(root, "provider-audit.json");
    await writeFile(auditPath, audit.canonicalJson, "utf8");
    const runIsolatedCanaryBenchmark = vi.fn(async () => {
      throw new Error("isolated_canary_runtime_invoked");
    });
    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "live",
      "--capacity", "4",
      "--isolated",
      "--provider-audit", auditPath,
      "--output", output
    ], { runIsolatedCanaryBenchmark })).rejects.toThrow(
      "isolated_canary_runtime_invoked"
    );
    expect(runIsolatedCanaryBenchmark).toHaveBeenCalledOnce();
  });

  it("rejects an output whose existing parent is a symlink or junction", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-adaptive-link-"));
    const physical = join(root, "physical");
    const redirected = join(root, "redirected");
    await mkdir(physical);
    await symlink(
      physical,
      redirected,
      process.platform === "win32" ? "junction" : "dir"
    );

    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", join(redirected, "benchmark.json")
    ], replayOracleRuntime())).rejects.toThrow(
      "unified_benchmark_output_symlink_forbidden"
    );
  });

  it("resumes a hash-bound live index without rerunning the canary and rejects corrupted exported observations", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-adaptive-live-resume-"));
    const output = join(root, "live-index.json");
    const scenarioDirectory = join(root, "live-index.scenarios");
    await mkdir(scenarioDirectory);
    const audit = sealUnifiedProviderGroupAuditV1({
      auditedAt: "2026-07-24T12:00:00.000Z",
      groups: [{
        opaqueGroupId: "provider-group-1",
        state: "healthy",
        concurrencyLimit: 1,
        independenceEvidenceSha256: "1".repeat(64)
      }]
    });
    const auditPath = join(root, "provider-audit.json");
    await writeFile(auditPath, audit.canonicalJson, "utf8");
    const candidateCommit = "a".repeat(40);
    const executionIdentitySha256 = fingerprintCanonicalArtifact({
      version: "unified-adaptive-benchmark-execution-identity-v1",
      mode: "live",
      seed: 1,
      requestedCapacities: [1],
      candidateCommit,
      sourceIdentitySha256: audit.envelope.auditSha256,
      traversalPolicyVersion: "snapshot-closure-v1",
      scenarioIds: [...UNIFIED_ADAPTIVE_LIVE_SCENARIOS].sort()
    });
    const artifacts = [];
    let firstObservationPath = "";
    for (
      const [index, kind] of UNIFIED_ADAPTIVE_LIVE_SCENARIOS.entries()
    ) {
      const scenarioId = `live:c1:${kind}`;
      const runId = `run-${index + 1}`;
      const controlSha256 = "b".repeat(64);
      const observation = {
        version: "unified-adaptive-benchmark-runtime-observation-v1",
        controlSha256,
        observedAt: "2026-07-24T12:00:30.000Z",
        runtime: {
          rssHeapScope: "process",
          availableMemoryScope: "container_or_host",
          instanceId: "runtime-live-resume",
          processStartedAt: "2026-07-24T12:00:00.000Z",
          processId: 123,
          rssBytes: 1,
          heapUsedBytes: 1,
          availableContainerBytes: 1,
          availableHostBytes: 1
        },
        provider: {
          requests: 1,
          completed: 1,
          errors: 0,
          rateLimited429: 0,
          requestsPerSecond: 1,
          dispatchedGroupIds: ["provider-group-1"]
        },
        reuse: {
          providerCacheHits: 0,
          networkFetches: 1,
          addressManifestReuses: 0,
          addressHistoryReplaysAvoided: 0
        },
        integrity: {
          duplicateCommits: 0,
          duplicateSequences: 0,
          deliveryIntents: 0
        },
        database: {
          scope: "benchmark_runtime_connection_pool",
          latencyMs: 1,
          checkpointLatencyMs: 1,
          poolWaitMs: 0
        },
        lifecycle: kind === "restart_recovery"
          ? {
              restartRunId: runId,
              checkpointObservationSha256: "d".repeat(64),
              restartCount: 1,
              recoveryMs: 1,
              reconciliationRecoveries: 1
            }
          : {
              restartRunId: null,
              checkpointObservationSha256: null,
              restartCount: 0,
              recoveryMs: 0,
              reconciliationRecoveries: 0
            },
        runs: [{
          runId,
          scenarioId: kind,
          planner: {
            durableBacklog: 0,
            admitted: 0,
            leased: 0,
            ready: 0,
            committed: 1
          },
          buffer: {
            readyCount: 0,
            readyBytes: 0,
            reservedBytes: 0
          },
          canonicalHeadAgeMs: 1,
          capacity: {
            eligibleDemand: 1,
            targetSlots: 1,
            actualSlots: 1
          },
          limitingReason: null
        }]
      };
      const observationSha256 =
        fingerprintCanonicalArtifact(observation);
      const phase = kind === "provider_cooldown"
        ? "audited_group_cooldown_observed"
        : kind === "slow_canonical_head"
          ? "canonical_head_delay_observed"
          : kind === "full_merge_buffer"
            ? "merge_buffer_full_observed"
            : kind === "late_interactive"
              ? "late_after_peer_checkpoint"
              : kind === "restart_recovery"
                ? "external_runtime_restart_attested"
                : "run_completed";
      const symptom = {
        version: "unified-adaptive-benchmark-scenario-symptom-v1",
        controlSha256,
        runId,
        scenarioId: kind,
        phase,
        observedAt: "2026-07-24T12:00:31.000Z",
        observationArtifactSha256: observationSha256,
        runtimeInstanceId: "runtime-live-resume",
        runtimeProcessStartedAt: "2026-07-24T12:00:00.000Z",
        runtimeProcessId: 123,
        ...(kind === "provider_cooldown" ? {
          providerCooldown: {
            groupId: "provider-group-1",
            startsAt: "2026-07-24T12:00:01.000Z",
            endsAt: "2026-07-24T12:00:02.000Z",
            fallbackDispatches: 1,
            resumedDispatches: 1,
            activeObserved: true,
            synthetic: true,
            provider429Observed: false
          }
        } : {}),
        ...(kind === "slow_canonical_head" ? {
          slowHeadAcceptance: {
            taskId: "slow-head-task",
            canonicalSequence: 0,
            attemptId: "slow-head-accepted-attempt",
            artifactSha256: "f".repeat(64),
            completedAt: "2026-07-24T12:00:30.000Z"
          }
        } : {}),
        ...(kind === "restart_recovery" ? {
          restartHandoff: {
            requestedAt: "2026-07-24T12:00:20.000Z",
            previousRuntimeInstanceId: "runtime-before-restart",
            previousRuntimeProcessStartedAt:
              "2026-07-24T11:59:00.000Z",
            previousRuntimeProcessId: 122,
            checkpointObservationSha256: "d".repeat(64),
            reconciliationArtifactSha256: "e".repeat(64)
          }
        } : {})
      };
      const symptomSha256 = fingerprintCanonicalArtifact(symptom);
      const observationPath = join(
        scenarioDirectory,
        `observation-${observationSha256}.json`
      );
      if (firstObservationPath === "") firstObservationPath = observationPath;
      await writeFile(
        observationPath,
        `${canonicalizeArtifactJson(observation)}\n`,
        "utf8"
      );
      await writeFile(
        join(scenarioDirectory, `symptom-${symptomSha256}.json`),
        `${canonicalizeArtifactJson(symptom)}\n`,
        "utf8"
      );
      const performanceManifest =
        buildUnifiedPerformanceBenchmarkManifest({
          version: "unified-performance-benchmark-input-v1",
          caseId: scenarioId,
          runId: scenarioId,
          frozenClockIso: "2026-07-24T12:00:00.000Z",
          snapshot: {
            blockNumber: "1",
            blockHash: "2".repeat(64),
            timestamp: "2026-07-24T12:00:00.000Z"
          },
          providerBundleSha256: "3".repeat(64),
          labelDatasetSha256: "4".repeat(64),
          providerConfigurationSha256: "5".repeat(64),
          scoringPolicyVersion: "scoring-signal-matrix-v4",
          attributionPolicyVersion: "selected-attribution-policy-v1",
          analysisPolicyVersion: "snapshot-closure-v1",
          presentationPolicyVersion: "unified-presentation-v1",
          locale: "ru",
          deterministicIdSeed: scenarioId,
          runtimeCommit: "a".repeat(40),
          checkpointVersion: "unified-production-traversal-checkpoint-v2",
          logicalChunkEvents: 1,
          providerSlots: 1,
          harnessVersion: "unified-adaptive-live-canary-v1"
        });
      const evidence = sealUnifiedAdaptiveBenchmarkEvidenceV1({
        scenarioId,
        scenarioKind: kind,
        completedAt: "2026-07-24T12:01:00.000Z",
        mode: "live",
        admissionPolicy: "rolling",
        sideEffectPolicy: "isolated",
        requestedCapacity: 1,
        actualAuditedIndependentGroupCapacity: 1,
        independentGroupAudit: audit.envelope,
        performanceManifest,
        timing: {
          wallTimeMs: 1,
          aggregateThroughputPerSecond: 1
        },
        capacity: {
          eligibleDemand: 1,
          targetSlots: 1,
          actualSlots: 1,
          utilization: 1
        },
        provider: {
          rollingRps: 1,
          requests: 1,
          errors: 0,
          rateLimited429: 0
        },
        limiting: {
          reason: null,
          canonicalHeadAgeMs: null
        },
        buffer: { readyBytes: 0, reservedBytes: 0 },
        database: {
          latencyMs: 1,
          checkpointLatencyMs: 1,
          poolWaitMs: 0
        },
        memory: {
          rssBytes: 1,
          heapUsedBytes: 1,
          availableContainerBytes: 1,
          availableHostBytes: 1
        },
        repair: { maxWaitMs: 0, maxWaitChunks: 0 },
        reuse: {
          providerCacheHits: 0,
          networkFetches: 1,
          addressManifestReuses: 0,
          addressHistoryReplaysAvoided: 0
        },
        restartRecovery: {
          restartCount: kind === "restart_recovery" ? 1 : 0,
          recoveryMs: kind === "restart_recovery" ? 1 : 0,
          reconciliationRecoveries: kind === "restart_recovery" ? 1 : 0,
          duplicateCommits: 0,
          duplicateSequences: 0
        },
        oracle: null,
        runtimeObservationArtifactSha256s: [observationSha256],
        scenarioSymptomArtifactSha256s: [symptomSha256],
        liveOutcomes: [{
          runId: `run-${index + 1}`,
          subjectAddress: "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV",
          score: 0,
          decision: "ACCEPTABLE",
          evidenceBundleSha256: "6".repeat(64),
          traversalClosureSha256: "7".repeat(64),
          scoringBundleSha256: "8".repeat(64),
          reportSha256: "9".repeat(64),
          benchmarkControlSha256: "b".repeat(64),
          auditedGroupIds: ["provider-group-1"],
          dispatchedGroupIds: ["provider-group-1"]
        }],
        measurement: {
          timing: "observed",
          provider: "observed",
          database: "observed",
          memory: "observed",
          lifecycle: "observed",
          delivery: "observed"
        },
        delivery: {
          eligibleRequests: 1,
          deliveryIntents: 0,
          externalTelegramSends: 0
        }
      }).envelope;
      const relativePath =
        `${basename(scenarioDirectory)}/${String(index + 1).padStart(3, "0")}.json`;
      await writeFile(
        join(root, relativePath),
        `${canonicalizeArtifactJson(evidence)}\n`,
        "utf8"
      );
      artifacts.push({
        scenarioId,
        relativePath,
        evidenceSha256: evidence.evidenceSha256,
        candidateCommit,
        executionIdentitySha256:
          evidence.performanceManifest.executionIdentitySha256
      });
    }
    const withoutHash = {
      version: "unified-adaptive-benchmark-index-v1" as const,
      mode: "live" as const,
      seed: 1,
      requestedCapacities: [1],
      candidateCommit,
      executionIdentitySha256,
      generatedAt: "2026-07-24T12:01:00.000Z",
      artifacts
    };
    const index = {
      ...withoutHash,
      indexSha256: fingerprintCanonicalArtifact(withoutHash)
    };
    await writeFile(
      output,
      `${canonicalizeArtifactJson(index)}\n`,
      "utf8"
    );
    const conflatedIdentityWithoutHash = {
      ...withoutHash,
      executionIdentitySha256:
        artifacts[0]!.executionIdentitySha256
    };
    await writeFile(
      output,
      `${canonicalizeArtifactJson({
        ...conflatedIdentityWithoutHash,
        indexSha256: fingerprintCanonicalArtifact(
          conflatedIdentityWithoutHash
        )
      })}\n`,
      "utf8"
    );
    await writeFile(
      output,
      `${canonicalizeArtifactJson(index)}\n`,
      "utf8"
    );
    const runIsolatedCanaryBenchmark = vi.fn(async () => {
      throw new Error("live canary must not rerun");
    });
    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "live",
      "--capacity", "1",
      "--isolated",
      "--provider-audit", auditPath,
      "--output", output
    ], {
      runtimeCommit: candidateCommit,
      runIsolatedCanaryBenchmark
    })).resolves.toEqual(index);
    expect(runIsolatedCanaryBenchmark).not.toHaveBeenCalled();

    const foreignCandidateWithoutHash = {
      ...withoutHash,
      candidateCommit: "f".repeat(40),
      artifacts: artifacts.map((artifact) => ({
        ...artifact,
        candidateCommit: "f".repeat(40)
      }))
    };
    await writeFile(
      output,
      `${canonicalizeArtifactJson({
        ...foreignCandidateWithoutHash,
        indexSha256:
          fingerprintCanonicalArtifact(foreignCandidateWithoutHash)
      })}\n`,
      "utf8"
    );
    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "live",
      "--capacity", "1",
      "--isolated",
      "--provider-audit", auditPath,
      "--output", output
    ], {
      runtimeCommit: candidateCommit,
      runIsolatedCanaryBenchmark
    })).rejects.toThrow("unified_benchmark_existing_artifact_mismatch");
    await writeFile(
      output,
      `${canonicalizeArtifactJson(index)}\n`,
      "utf8"
    );

    await writeFile(firstObservationPath, "{}\n", "utf8");
    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "live",
      "--capacity", "1",
      "--isolated",
      "--provider-audit", auditPath,
      "--output", output
    ], {
      runtimeCommit: candidateCommit,
      runIsolatedCanaryBenchmark
    })).rejects.toThrow(
      "unified_benchmark_existing_artifact_mismatch"
    );

    await unlink(firstObservationPath);
    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "live",
      "--capacity", "1",
      "--isolated",
      "--provider-audit", auditPath,
      "--output", output
    ], {
      runtimeCommit: candidateCommit,
      runIsolatedCanaryBenchmark
    })).rejects.toThrow(
      "unified_benchmark_existing_artifact_mismatch"
    );
  });

  it("registers the package benchmark command", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    expect(packageJson.scripts["benchmark:unified-adaptive"])
      .toBe("tsx scripts/runUnifiedAdaptiveBenchmark.ts");
  });
});
