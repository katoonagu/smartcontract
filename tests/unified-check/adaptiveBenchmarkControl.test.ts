import { describe, expect, it, vi } from "vitest";
import {
  applyUnifiedAdaptiveBenchmarkControl,
  acknowledgeUnifiedAdaptiveBenchmarkRestartHandoffs,
  assertUnifiedSelectedDenseRefillEvidence,
  assertUnifiedAdaptiveBenchmarkControlLeaseCurrent,
  captureUnifiedAdaptiveBenchmarkObservationBestEffort,
  createUnifiedAdaptiveBenchmarkProviderTelemetry,
  createUnifiedSelectedReconciliationCounter,
  buildUnifiedScopedProviderSaturationSample,
  isDistinctUnifiedBenchmarkRuntimeStartup,
  isUnifiedBenchmarkCooldownSymptomReady,
  isUnifiedBenchmarkSlowHeadSymptomReady,
  installUnifiedAdaptiveBenchmarkControl,
  listUnifiedAdaptiveBenchmarkObservationArtifacts,
  listUnifiedAdaptiveBenchmarkObservations,
  listUnifiedProviderRefillObservationArtifacts,
  listUnifiedProviderRefillRuntimeSamples,
  loadUnifiedAdaptiveBenchmarkControl,
  persistUnifiedAdaptiveBenchmarkLatePhaseAck,
  persistUnifiedAdaptiveBenchmarkObservation,
  persistUnifiedProviderRefillObservation,
  persistUnifiedProviderRefillRuntimeSample,
  parseUnifiedAdaptiveBenchmarkControlV1,
  parseUnifiedProviderRefillObservationV1,
  parseUnifiedAdaptiveBenchmarkScenarioSymptomV1,
  summarizeUnifiedProviderSaturationSamples,
  type UnifiedProviderRefillObservationV1,
  type UnifiedProviderRefillRuntimeSampleV1,
  type UnifiedAdaptiveBenchmarkRuntimeObservationV1
} from "../../src/unifiedCheck/adaptiveBenchmarkControl";
import type { ProviderRunDemand } from "../../src/unifiedCheck/fairProviderAllocator";
import type {
  UnifiedQueryable,
  UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import { createUnifiedReconciliation } from "../../src/unifiedCheck/reconciliation";

const NOW = new Date("2026-07-25T09:00:00.000Z");

function transactionHost(
  query: ReturnType<typeof vi.fn>
): UnifiedTransactionalQueryable {
  return {
    query: query as UnifiedTransactionalQueryable["query"],
    transaction: <T>(
      work: (client: UnifiedQueryable) => Promise<T>
    ) => work({
      query: query as UnifiedTransactionalQueryable["query"]
    })
  };
}

function demand(runId: string): ProviderRunDemand {
  return {
    runId,
    ownerId: `${runId}-owner`,
    lane: "interactive",
    eligibleReadyWork: 5,
    ownerLastServedAtMs: 0,
    lastServedAtMs: 0,
    mergeBufferFull: false,
    providerAvailable: true,
    resourceGuarded: false,
    canonicalHeadEligible: true
  };
}

describe("adaptive benchmark leased runtime control", () => {
  it("seals separate exact refill evidence and enforces control, runtime, provider, and run bindings", async () => {
    const diagnostics: UnifiedProviderRefillObservationV1["diagnostics"] = {
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
        p95: 2,
        max: 2,
        sampleCount: 1
      }])) as UnifiedProviderRefillObservationV1["diagnostics"]["phases"],
      diagnostics: {
        incomplete: 0,
        evictedIncomplete: 0,
        discontinuities: 0,
        invalidClocks: 0
      }
    };
    const observation: UnifiedProviderRefillObservationV1 = {
      version: "unified-provider-refill-observation-v1",
      schemaVersion: 1,
      controlSha256: "a".repeat(64),
      observedAt: NOW.toISOString(),
      runtimeCommit: "b".repeat(40),
      providerConfigurationSha256: "c".repeat(64),
      diagnostics,
      saturated: {
        sampleCount: 2,
        activeSlotSum: 7,
        fourOfFourSamples: 1,
        unexplainedIdleSamples: 0
      },
      memoryEvidence: {
        samplesSha256: "d".repeat(64),
        summarySha256: "e".repeat(64),
        diagnosticStatus: "captured"
      }
    };
    const canonical = canonicalizeArtifactJson(observation);
    expect(parseUnifiedProviderRefillObservationV1(canonical))
      .toEqual(observation);
    expect(() => parseUnifiedProviderRefillObservationV1(
      canonicalizeArtifactJson({ ...observation, unexpected: true })
    )).toThrow("unified_provider_refill_observation_invalid");
    const { schemaVersion: _schemaVersion, ...withoutSchemaVersion } =
      observation;
    expect(() => parseUnifiedProviderRefillObservationV1(
      canonicalizeArtifactJson(withoutSchemaVersion)
    )).toThrow("unified_provider_refill_observation_invalid");
    expect(() => parseUnifiedProviderRefillObservationV1(
      canonicalizeArtifactJson({
        ...observation,
        memoryEvidence: {
          samplesSha256: observation.memoryEvidence.samplesSha256,
          diagnosticStatus: "captured"
        }
      })
    )).toThrow("unified_provider_refill_observation_invalid");
    expect(() => parseUnifiedProviderRefillObservationV1(
      canonicalizeArtifactJson({
        ...observation,
        diagnostics: {
          ...diagnostics,
          phases: {
            ...diagnostics.phases,
            permitToClaim: {
              ...diagnostics.phases.permitToClaim,
              sampleCount: "1"
            }
          }
        }
      })
    )).toThrow("unified_provider_refill_observation_invalid");

    const query = vi.fn(async () => ({ rows: [] }));
    const sha256 = await persistUnifiedProviderRefillObservation({
      db: { query },
      createdByRunId: "run-txc",
      observation
    });
    expect(query).toHaveBeenCalledOnce();
    expect(String((query.mock.calls[0] as unknown[] | undefined)?.[0]))
      .toContain("'adaptive_benchmark_refill_observation'");
    const load = (overrides: Partial<{
      controlSha256: string;
      runtimeCommit: string;
      providerConfigurationSha256: string;
      runIds: readonly string[];
    }> = {}) => listUnifiedProviderRefillObservationArtifacts({
      db: {
        query: vi.fn(async () => ({
          rows: [{
            sha256,
            created_by_run_id: "run-txc",
            artifact_json: observation
          }]
        }))
      },
      controlSha256: observation.controlSha256,
      runtimeCommit: observation.runtimeCommit,
      providerConfigurationSha256:
        observation.providerConfigurationSha256,
      runIds: ["run-txc"],
      ...overrides
    });
    await expect(load()).resolves.toEqual([{
      sha256,
      createdByRunId: "run-txc",
      observation
    }]);
    await expect(load({ controlSha256: "f".repeat(64) }))
      .rejects.toThrow("unified_provider_refill_observation_binding_invalid");
    await expect(load({ runtimeCommit: "f".repeat(40) }))
      .rejects.toThrow("unified_provider_refill_observation_binding_invalid");
    await expect(load({
      providerConfigurationSha256: "f".repeat(64)
    })).rejects.toThrow(
      "unified_provider_refill_observation_binding_invalid"
    );
    await expect(load({ runIds: ["run-other"] }))
      .rejects.toThrow("unified_provider_refill_observation_binding_invalid");
  });

  it("keeps every truly saturated normal sample in the utilization denominator", () => {
    expect(summarizeUnifiedProviderSaturationSamples([
      {
        providerCapacityLimit: 4,
        eligibleReadyProviderWork: 4,
        runtimeState: "normal",
        healthyGroupCount: 4,
        activeSlots: 4,
        limitingReason: null
      },
      {
        providerCapacityLimit: 4,
        eligibleReadyProviderWork: 8,
        runtimeState: "normal",
        healthyGroupCount: 4,
        activeSlots: 3,
        limitingReason: "checkpoint_or_commit"
      },
      {
        providerCapacityLimit: 4,
        eligibleReadyProviderWork: 4,
        runtimeState: "normal",
        healthyGroupCount: 4,
        activeSlots: 3,
        limitingReason: null
      },
      {
        providerCapacityLimit: 3,
        eligibleReadyProviderWork: 99,
        runtimeState: "normal",
        healthyGroupCount: 4,
        activeSlots: 0,
        limitingReason: null
      },
      {
        providerCapacityLimit: 4,
        eligibleReadyProviderWork: 4,
        runtimeState: "pressure",
        healthyGroupCount: 4,
        activeSlots: 0,
        limitingReason: "memory_pressure"
      }
    ])).toEqual({
      sampleCount: 3,
      activeSlotSum: 10,
      fourOfFourSamples: 1,
      unexplainedIdleSamples: 1
    });
  });

  it("persists separate exact runtime refill samples for final aggregation", async () => {
    const emptyMetric = {
      p50: null,
      p95: null,
      max: null,
      sampleCount: 0
    };
    const sample: UnifiedProviderRefillRuntimeSampleV1 = {
      version: "unified-provider-refill-runtime-sample-v1",
      controlSha256: "a".repeat(64),
      observedAt: NOW.toISOString(),
      runtimeCommit: "b".repeat(40),
      providerConfigurationSha256: "c".repeat(64),
      runIds: ["run-txc"],
      diagnostics: {
        version: "unified-provider-refill-diagnostics-v1",
        assignments: {
          proposed: 0,
          accepted: 0,
          rejected: 0,
          rejections: {
            draining: 0,
            slotActive: 0,
            pendingAssignment: 0,
            staleEpoch: 0
          }
        },
        phases: {
          chunkToCheckpoint: emptyMetric,
          checkpointToController: emptyMetric,
          controllerToPermit: emptyMetric,
          permitToClaim: emptyMetric,
          checkpointToClaim: emptyMetric
        },
        diagnostics: {
          incomplete: 0,
          evictedIncomplete: 0,
          discontinuities: 0,
          invalidClocks: 0
        }
      },
      saturationSample: {
        providerCapacityLimit: 4,
        eligibleReadyProviderWork: 8,
        runtimeState: "normal",
        healthyGroupCount: 4,
        activeSlots: 4,
        limitingReason: null
      }
    };
    const write = vi.fn(async () => ({ rows: [] }));
    const sha256 = await persistUnifiedProviderRefillRuntimeSample({
      db: { query: write },
      createdByRunId: "run-txc",
      sample
    });
    expect(String((write.mock.calls[0] as unknown[] | undefined)?.[0]))
      .toContain("'adaptive_benchmark_refill_sample'");
    await expect(listUnifiedProviderRefillRuntimeSamples({
      db: {
        query: vi.fn(async () => ({
          rows: [{ sha256, artifact_json: sample }]
        }))
      },
      controlSha256: sample.controlSha256,
      runtimeCommit: sample.runtimeCommit,
      providerConfigurationSha256:
        sample.providerConfigurationSha256,
      runIds: ["run-txc"]
    })).resolves.toEqual([sample]);
    await expect(listUnifiedProviderRefillRuntimeSamples({
      db: {
        query: vi.fn(async () => ({
          rows: [{ sha256, artifact_json: sample }]
        }))
      },
      controlSha256: sample.controlSha256,
      runtimeCommit: "f".repeat(40),
      providerConfigurationSha256:
        sample.providerConfigurationSha256,
      runIds: ["run-txc"]
    })).rejects.toThrow("unified_provider_refill_sample_binding_invalid");
  });

  it("accepts selected dense refill evidence only with four audited dispatch groups and zero side effects, provider failures, or recovery", () => {
    const saturated = {
      sampleCount: 4,
      activeSlotSum: 14,
      fourOfFourSamples: 2,
      unexplainedIdleSamples: 0
    };
    const input = {
      saturated,
      auditedGroupIds: ["g1", "g2", "g3", "g4"],
      dispatchedGroupIds: ["g4", "g2", "g1", "g3"],
      providerErrors: 0,
      rateLimited429: 0,
      deliveryIntents: 0,
      externalSends: 0,
      reconciliationRecoveries: 0
    };
    expect(() => assertUnifiedSelectedDenseRefillEvidence(input))
      .not.toThrow();
    for (const [invalid, error] of [
      [
        { providerErrors: -1 },
        "unified_fast_fix_dense_input_invalid"
      ],
      [
        { auditedGroupIds: ["g1", "g2", "g3"] },
        "unified_fast_fix_group_audit_invalid"
      ],
      [
        { dispatchedGroupIds: ["g1", "g2", "g3"] },
        "unified_fast_fix_group_dispatch_incomplete"
      ],
      [
        { saturated: { ...saturated, sampleCount: 0, activeSlotSum: 0 } },
        "unified_fast_fix_saturation_missing"
      ],
      [
        { saturated: { ...saturated, activeSlotSum: 13 } },
        "unified_fast_fix_utilization_below_gate"
      ],
      [
        { saturated: { ...saturated, unexplainedIdleSamples: 1 } },
        "unified_fast_fix_idle_reason_missing"
      ],
      [
        { providerErrors: 1 },
        "unified_fast_fix_provider_errors_observed"
      ],
      [
        { rateLimited429: 1 },
        "unified_fast_fix_rate_limited_429_observed"
      ],
      [
        { deliveryIntents: 1 },
        "unified_fast_fix_delivery_observed"
      ],
      [
        { externalSends: 1 },
        "unified_fast_fix_delivery_observed"
      ],
      [
        { reconciliationRecoveries: 1 },
        "unified_fast_fix_reconciliation_observed"
      ]
    ] as const) {
      expect(() => assertUnifiedSelectedDenseRefillEvidence({
        ...input,
        ...invalid
      })).toThrow(error);
    }
  });

  it("does not let another run's four active slots satisfy the selected TXc gate", () => {
    const sample = buildUnifiedScopedProviderSaturationSample({
      controlledRunIds: ["run-txc"],
      providerCapacityLimit: 4,
      runtimeState: "pressure",
      healthyGroupCount: 0,
      runs: [{
        runId: "run-txc",
        eligibleDemand: 0,
        actualSlots: 0,
        limitingReason: null
      }],
      activeProviderRunIds: ["other", "other", "other", "other"]
    });
    expect(sample).toEqual(expect.objectContaining({
      eligibleReadyProviderWork: 4,
      runtimeState: "normal",
      healthyGroupCount: 4,
      activeSlots: 0,
      limitingReason: null
    }));
    expect(() => assertUnifiedSelectedDenseRefillEvidence({
      saturated: summarizeUnifiedProviderSaturationSamples([sample]),
      auditedGroupIds: ["g1", "g2", "g3", "g4"],
      dispatchedGroupIds: ["g1", "g2", "g3", "g4"],
      providerErrors: 0,
      rateLimited429: 0,
      deliveryIntents: 0,
      externalSends: 0,
      reconciliationRecoveries: 0
    })).toThrow("unified_fast_fix_utilization_below_gate");
  });

  it("counts only timer recovery for the active selected control and rejects the gate", async () => {
    const counter = createUnifiedSelectedReconciliationCounter();
    counter.activate("a".repeat(64), ["run-txc"]);
    const reconciliation = createUnifiedReconciliation({
      intervalMs: 60_000,
      runCycle: async () => ({
        actionableWorkFound: true,
        admitted: 1,
        wokenSlots: 1
      }),
      onAdaptiveEvent: (event) => counter.record(event)
    });

    reconciliation.wake();
    await reconciliation.waitForIdle();
    expect(counter.count("a".repeat(64), "run-txc")).toBe(0);
    await reconciliation.tick();
    expect(counter.count("a".repeat(64), "run-txc")).toBe(1);
    expect(() => assertUnifiedSelectedDenseRefillEvidence({
      saturated: {
        sampleCount: 1,
        activeSlotSum: 4,
        fourOfFourSamples: 1,
        unexplainedIdleSamples: 0
      },
      auditedGroupIds: ["g1", "g2", "g3", "g4"],
      dispatchedGroupIds: ["g1", "g2", "g3", "g4"],
      providerErrors: 0,
      rateLimited429: 0,
      deliveryIntents: 0,
      externalSends: 0,
      reconciliationRecoveries:
        counter.count("a".repeat(64), "run-txc")
    })).toThrow("unified_fast_fix_reconciliation_observed");
  });

  it("requires exact-group resume and multi-group fallback before cooldown evidence", () => {
    const cooldown = {
      controlSha256: "a".repeat(64),
      groupId: "group-a",
      endsAtMs: 1_100,
      fallbackDispatches: 0,
      resumedDispatches: 1,
      activeObserved: true
    };
    expect(isUnifiedBenchmarkCooldownSymptomReady({
      capacity: 1,
      controlSha256: cooldown.controlSha256,
      auditedGroupIds: ["group-a"],
      nowMs: 1_101,
      cooldown
    })).toBe(true);
    expect(isUnifiedBenchmarkCooldownSymptomReady({
      capacity: 4,
      controlSha256: cooldown.controlSha256,
      auditedGroupIds: ["group-a", "group-b"],
      nowMs: 1_101,
      cooldown
    })).toBe(false);
    expect(isUnifiedBenchmarkCooldownSymptomReady({
      capacity: 4,
      controlSha256: cooldown.controlSha256,
      auditedGroupIds: ["group-a", "group-b"],
      nowMs: 1_101,
      cooldown: { ...cooldown, fallbackDispatches: 1 }
    })).toBe(true);
    expect(isUnifiedBenchmarkCooldownSymptomReady({
      capacity: 4,
      controlSha256: "b".repeat(64),
      auditedGroupIds: ["group-a", "group-b"],
      nowMs: 1_101,
      cooldown: { ...cooldown, fallbackDispatches: 1 }
    })).toBe(false);
  });

  it("requires post-window success and exact committed head before slow-head evidence", () => {
    const delay = {
      controlSha256: "a".repeat(64),
      taskId: "head-task",
      canonicalSequence: 3,
      activeObserved: true,
      resumedDispatches: 1,
      resumedSuccessfulOutcomes: 1,
      successfulAttemptNumbers: [4]
    };
    const acceptedAttempt = {
      taskId: "head-task",
      canonicalSequence: 3,
      attempt: 4,
      completedAtMs: 1_101
    };
    expect(isUnifiedBenchmarkSlowHeadSymptomReady({
      controlSha256: delay.controlSha256,
      committed: true,
      faultUntilMs: 1_100,
      acceptedAttempt,
      delay
    })).toBe(true);
    expect(isUnifiedBenchmarkSlowHeadSymptomReady({
      controlSha256: delay.controlSha256,
      committed: false,
      faultUntilMs: 1_100,
      acceptedAttempt,
      delay
    })).toBe(false);
    expect(isUnifiedBenchmarkSlowHeadSymptomReady({
      controlSha256: delay.controlSha256,
      committed: true,
      faultUntilMs: 1_100,
      acceptedAttempt,
      delay: { ...delay, resumedSuccessfulOutcomes: 0 }
    })).toBe(false);
    expect(isUnifiedBenchmarkSlowHeadSymptomReady({
      controlSha256: delay.controlSha256,
      committed: true,
      faultUntilMs: 1_100,
      acceptedAttempt: { ...acceptedAttempt, attempt: 3 },
      delay
    })).toBe(false);
  });
  it("rejects unknown keys in control and nested symptom payloads", () => {
    const control = {
      version: "unified-adaptive-benchmark-control-v1",
      leaseOwner: "lease-owner",
      createdAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      runtimeCommit: "a".repeat(40),
      providerConfigurationSha256: "b".repeat(64),
      capacity: 1,
      auditedGroupIds: ["group-a"],
      runPlans: [{
        runId: "run-a",
        scenarioId: "provider_cooldown",
        fault: "provider_cooldown",
        faultUntil: new Date(NOW.getTime() + 5_000).toISOString(),
        injected: true
      }]
    };
    expect(() => parseUnifiedAdaptiveBenchmarkControlV1(
      canonicalizeArtifactJson(control)
    )).toThrow("unified_benchmark_control_invalid");
    const validControl = {
      ...control,
      runPlans: [{
        runId: "run-a",
        scenarioId: "provider_cooldown",
        fault: "provider_cooldown",
        faultUntil: new Date(NOW.getTime() + 5_000).toISOString()
      }]
    };
    for (const key of ["createdAt", "expiresAt"] as const) {
      const missing = { ...validControl };
      delete missing[key];
      expect(() => parseUnifiedAdaptiveBenchmarkControlV1(
        canonicalizeArtifactJson(missing)
      )).toThrow("unified_benchmark_control_invalid");
    }
    expect(() => parseUnifiedAdaptiveBenchmarkControlV1(
      canonicalizeArtifactJson({
        ...validControl,
        createdAt: "not-a-date"
      })
    )).toThrow("unified_benchmark_control_invalid");
    expect(() => parseUnifiedAdaptiveBenchmarkControlV1(
      canonicalizeArtifactJson({
        ...validControl,
        runPlans: [{
          runId: "run-a",
          scenarioId: "provider_cooldown",
          fault: "provider_cooldown"
        }]
      })
    )).toThrow("unified_benchmark_control_invalid");

    const symptom = {
      version: "unified-adaptive-benchmark-scenario-symptom-v1",
      controlSha256: "c".repeat(64),
      runId: "run-a",
      scenarioId: "provider_cooldown",
      phase: "audited_group_cooldown_observed",
      observedAt: NOW.toISOString(),
      observationArtifactSha256: "d".repeat(64),
      runtimeInstanceId: "runtime-a",
      runtimeProcessStartedAt: NOW.toISOString(),
      runtimeProcessId: 1,
      providerCooldown: {
        groupId: "group-a",
        startsAt: NOW.toISOString(),
        endsAt: new Date(NOW.getTime() + 5_000).toISOString(),
        fallbackDispatches: 1,
        resumedDispatches: 1,
        activeObserved: true,
        synthetic: true,
        provider429Observed: false,
        injected: true
      }
    };
    expect(() => parseUnifiedAdaptiveBenchmarkScenarioSymptomV1(
      canonicalizeArtifactJson(symptom)
    )).toThrow("unified_benchmark_scenario_symptom_invalid");
  });

  it("requires exact accepted-attempt identity for slow-head symptoms", () => {
    const symptom = {
      version: "unified-adaptive-benchmark-scenario-symptom-v1",
      controlSha256: "a".repeat(64),
      runId: "run-a",
      scenarioId: "slow_canonical_head",
      phase: "canonical_head_delay_observed",
      observedAt: "2026-07-25T09:00:06.000Z",
      observationArtifactSha256: "b".repeat(64),
      runtimeInstanceId: "runtime-a",
      runtimeProcessStartedAt: NOW.toISOString(),
      runtimeProcessId: 1
    };
    expect(() => parseUnifiedAdaptiveBenchmarkScenarioSymptomV1(
      canonicalizeArtifactJson(symptom)
    )).toThrow("unified_benchmark_scenario_symptom_invalid");
    expect(parseUnifiedAdaptiveBenchmarkScenarioSymptomV1(
      canonicalizeArtifactJson({
        ...symptom,
        slowHeadAcceptance: {
          taskId: "head-task",
          canonicalSequence: 2,
          attemptId: "accepted-attempt",
          artifactSha256: "c".repeat(64),
          completedAt: "2026-07-25T09:00:05.000Z"
        }
      })
    ).slowHeadAcceptance).toMatchObject({
      taskId: "head-task",
      attemptId: "accepted-attempt"
    });
  });
  it("reports provider telemetry only for runs bound to one benchmark control", () => {
    const telemetry = createUnifiedAdaptiveBenchmarkProviderTelemetry();
    const controlSha256 = "c".repeat(64);
    telemetry.bindControl(controlSha256, ["controlled-run"]);
    telemetry.recordDispatch({
      requestId: 1,
      atMs: 1_000,
      runId: "unrelated-run",
      groupId: "unrelated-group"
    });
    telemetry.recordOutcome({
      requestId: 1,
      runId: "unrelated-run",
      groupId: "unrelated-group",
      outcome: "rate_limited_429"
    });
    telemetry.recordDispatch({
      requestId: 2,
      atMs: 2_000,
      runId: "controlled-run",
      groupId: "audited-group"
    });
    telemetry.recordOutcome({
      requestId: 2,
      runId: "controlled-run",
      groupId: "audited-group",
      outcome: "success"
    });

    expect(telemetry.snapshot(controlSha256, 3_000)).toEqual({
      requests: 1,
      completed: 1,
      errors: 0,
      rateLimited429: 0,
      requestsPerSecond: 1,
      dispatchedGroupIds: ["audited-group"]
    });
  });

  it("tears down repeated benchmark telemetry without touching unrelated controls", () => {
    const telemetry = createUnifiedAdaptiveBenchmarkProviderTelemetry();
    const unrelated = "f".repeat(64);
    telemetry.bindControl(unrelated, ["unrelated-run"]);
    telemetry.recordDispatch({
      requestId: 1,
      atMs: 1_000,
      runId: "unrelated-run",
      groupId: "group-u"
    });
    for (let index = 0; index < 100; index += 1) {
      const control = index.toString(16).padStart(64, "0");
      const runId = `run-${index}`;
      telemetry.bindControl(control, [runId]);
      telemetry.recordDispatch({
        requestId: index + 2,
        atMs: 1_000,
        runId,
        groupId: "group-a"
      });
      telemetry.teardownBenchmarkControl(control);
      expect(telemetry.snapshot(control, 2_000).requests).toBe(0);
    }
    expect(telemetry.snapshot(unrelated, 2_000)).toMatchObject({
      requests: 1,
      dispatchedGroupIds: ["group-u"]
    });
    telemetry.teardownBenchmarkControl(unrelated);
    telemetry.teardownBenchmarkControl(unrelated);
    expect(telemetry.snapshot(unrelated, 2_000).requests).toBe(0);
  });

  it("does not detach a run rebound to a newer control when the old control tears down", () => {
    const telemetry = createUnifiedAdaptiveBenchmarkProviderTelemetry();
    const oldControl = "a".repeat(64);
    const newControl = "b".repeat(64);
    telemetry.bindControl(oldControl, ["shared-run"]);
    telemetry.bindControl(newControl, ["shared-run"]);

    telemetry.teardownBenchmarkControl(oldControl);
    telemetry.recordDispatch({
      requestId: 1,
      atMs: 1_000,
      runId: "shared-run",
      groupId: "group-new"
    });

    expect(telemetry.snapshot(oldControl, 2_000).requests).toBe(0);
    expect(telemetry.snapshot(newControl, 2_000)).toMatchObject({
      requests: 1,
      dispatchedGroupIds: ["group-new"]
    });
  });

  it("counts a coalesced physical request once and supports bound run subsets", () => {
    const telemetry = createUnifiedAdaptiveBenchmarkProviderTelemetry();
    const controlSha256 = "d".repeat(64);
    telemetry.bindControl(controlSha256, ["run-a", "run-b"]);
    for (const runId of ["run-a", "run-b"]) {
      telemetry.recordDispatch({
        requestId: 7,
        atMs: 1_000,
        runId,
        groupId: "group-shared"
      });
      telemetry.recordOutcome({
        requestId: 7,
        runId,
        groupId: "group-shared",
        outcome: "success"
      });
    }
    telemetry.recordDispatch({
      requestId: 8,
      atMs: 1_500,
      runId: "run-b",
      groupId: "group-b"
    });
    telemetry.recordOutcome({
      requestId: 8,
      runId: "run-b",
      groupId: "group-b",
      outcome: "rate_limited_429"
    });
    telemetry.recordDispatch({
      requestId: 99,
      atMs: 1_500,
      runId: "unrelated-run",
      groupId: "unrelated-group"
    });

    expect(telemetry.snapshot(controlSha256, 2_000)).toMatchObject({
      requests: 2,
      completed: 2,
      errors: 1,
      rateLimited429: 1,
      dispatchedGroupIds: ["group-b", "group-shared"]
    });
    expect(telemetry.snapshot(controlSha256, 2_000, ["run-a"]))
      .toMatchObject({
        requests: 1,
        completed: 1,
        errors: 0,
        rateLimited429: 0,
        dispatchedGroupIds: ["group-shared"]
      });
    expect(() => telemetry.snapshot(
      controlSha256,
      2_000,
      ["unrelated-run"]
    )).toThrow("unified_benchmark_telemetry_run_unbound");
  });

  it("persists an idempotent late-creation phase acknowledgement before the late run exists", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const artifact = {
      version: "unified-adaptive-benchmark-late-phase-v1" as const,
      phaseIdentity: "late:c1",
      peerRunId: "heavy-peer",
      peerCheckpointObservationSha256: "a".repeat(64),
      acknowledgedAt: NOW.toISOString()
    };
    const first = await persistUnifiedAdaptiveBenchmarkLatePhaseAck({
      db: { query },
      createdByRunId: "heavy-peer",
      artifact
    });
    const second = await persistUnifiedAdaptiveBenchmarkLatePhaseAck({
      db: { query },
      createdByRunId: "heavy-peer",
      artifact
    });

    expect(second).toBe(first);
    expect(query).toHaveBeenCalledTimes(2);
    expect(String((query.mock.calls[0] as unknown[])[0])).toContain(
      "adaptive_benchmark_late_phase"
    );
    expect(String((query.mock.calls[0] as unknown[])[0])).toContain(
      "on conflict (sha256) do nothing"
    );
  });

  it("acknowledges a restart handoff only from a distinct process startup", async () => {
    const handoff = {
      version: "unified-adaptive-benchmark-restart-handoff-v1",
      controlSha256: "a".repeat(64),
      runId: "restart-run",
      scenarioId: "restart_recovery",
      requestedAt: NOW.toISOString(),
      resumeDeadline: new Date(
        NOW.getTime() + 10 * 60_000
      ).toISOString(),
      runtimeInstanceId: "old-runtime",
      runtimeProcessStartedAt: "2026-07-25T08:00:00.000Z",
      runtimeProcessId: 111,
      checkpointObservationSha256: "b".repeat(64),
      checkpointTaskId: "restart-head-task",
      checkpointCanonicalSequence: 0,
      checkpointAttempt: 1
    };
    const observation = (committed: number) => ({
      version: "unified-adaptive-benchmark-runtime-observation-v1" as const,
      controlSha256: handoff.controlSha256,
      observedAt: NOW.toISOString(),
      runtime: {
        rssHeapScope: "process" as const,
        availableMemoryScope: "container_or_host" as const,
        instanceId: "new-runtime",
        processStartedAt: "2026-07-25T09:00:01.000Z",
        processId: 222,
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
        dispatchedGroupIds: ["group-a"]
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
        scope: "benchmark_runtime_connection_pool" as const,
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
        runId: handoff.runId,
        scenarioId: handoff.scenarioId,
        planner: {
          durableBacklog: 1,
          admitted: 1,
          leased: 0,
          ready: 0,
          committed
        },
        buffer: { readyCount: 0, readyBytes: 0, reservedBytes: 1 },
        canonicalHeadAgeMs: 1,
        capacity: { eligibleDemand: 1, targetSlots: 1, actualSlots: 1 },
        limitingReason: null
      }]
    });
    const writes: unknown[][] = [];
    let reconciliation: {
      sha256: string;
      artifact_json: unknown;
    } | null = null;
    let committed = 0;
    const db = {
      async query(sql: string, params?: readonly unknown[]) {
        if (sql.includes("adaptive_benchmark_restart_handoff")) {
          return {
            rows: [{
              sha256: fingerprintCanonicalArtifact(handoff),
              artifact_json: handoff
            }]
          };
        }
        if (
          sql.includes("sha256 = $1") &&
          sql.includes("adaptive_benchmark_runtime_observation")
        ) {
          return { rows: [{ artifact_json: observation(0) }] };
        }
        if (sql.includes("planner.planner_state")) {
          return {
            rows: [{
              planner_state: committed > 0 ? "committed" : "planned",
              committed_at: committed > 0 ? NOW.toISOString() : null
            }]
          };
        }
        if (
          sql.includes("kind = 'adaptive_benchmark_restart_reconciliation'")
        ) {
          return { rows: reconciliation ? [reconciliation] : [] };
        }
        if (sql.includes("adaptive_benchmark_restart_reconciliation")) {
          reconciliation = {
            sha256: String(params?.[0]),
            artifact_json: JSON.parse(String(params?.[2]))
          };
          writes.push([sql, params]);
          return { rows: [] };
        }
        if (sql.includes("artifact_json @>")) {
          const current = observation(1);
          return {
            rows: [{
              sha256: fingerprintCanonicalArtifact(current),
              artifact_json: current
            }]
          };
        }
        writes.push([sql, params]);
        return { rows: [] };
      }
    };

    await expect(acknowledgeUnifiedAdaptiveBenchmarkRestartHandoffs({
      db,
      now: new Date("2026-07-25T09:10:01.000Z"),
      runtime: {
        instanceId: "new-runtime",
        processStartedAt: "2026-07-25T09:00:01.000Z",
        processId: 222
      },
      reconciliationResult: {
        actionableWorkFound: true,
        admitted: 1,
        wokenSlots: 1
      },
      tickObservedAt: "2026-07-25T09:10:01.000Z"
    })).resolves.toBe(0);
    expect(writes).toHaveLength(0);
    await expect(acknowledgeUnifiedAdaptiveBenchmarkRestartHandoffs({
      db,
      now: new Date("2026-07-25T09:00:01.000Z"),
      runtime: {
        instanceId: "old-runtime",
        processStartedAt: "2026-07-25T08:00:00.000Z",
        processId: 111
      },
      reconciliationResult: {
        actionableWorkFound: true,
        admitted: 1,
        wokenSlots: 1
      },
      tickObservedAt: "2026-07-25T09:00:01.000Z"
    })).resolves.toBe(0);
    await expect(acknowledgeUnifiedAdaptiveBenchmarkRestartHandoffs({
      db,
      now: new Date("2026-07-25T09:00:02.000Z"),
      runtime: {
        instanceId: "new-runtime",
        processStartedAt: "2026-07-25T09:00:01.000Z",
        processId: 222
      },
      reconciliationResult: {
        actionableWorkFound: true,
        admitted: 1,
        wokenSlots: 1
      },
      tickObservedAt: "2026-07-25T09:00:02.000Z"
    })).resolves.toBe(0);
    committed = 1;
    await expect(acknowledgeUnifiedAdaptiveBenchmarkRestartHandoffs({
      db,
      now: new Date("2026-07-25T09:00:03.000Z"),
      runtime: {
        instanceId: "new-runtime",
        processStartedAt: "2026-07-25T09:00:01.000Z",
        processId: 222
      },
      reconciliationResult: {
        actionableWorkFound: true,
        admitted: 0,
        wokenSlots: 1
      },
      tickObservedAt: "2026-07-25T09:00:02.000Z"
    })).resolves.toBe(1);
    expect(writes).toHaveLength(2);
    expect(String(writes[1]![0])).toContain(
      "adaptive_benchmark_scenario_symptom"
    );
  });

  it("caps only bound runs without fabricating execution symptoms", () => {
    const controlled = applyUnifiedAdaptiveBenchmarkControl({
      demand: [
        demand("controlled-a"),
        demand("controlled-b"),
        demand("unrelated-user-run")
      ],
      providerSlots: [{
        slotId: 0,
        epoch: 1,
        active: true,
        activePermit: {
          runId: "controlled-a",
          ownerId: "controlled-a-owner",
          lane: "interactive",
          canonicalHeadPreferred: false
        }
      }],
      now: NOW,
      acknowledgedRunIds: [],
      control: {
        version: "unified-adaptive-benchmark-control-v1",
        leaseOwner: "lease",
        createdAt: "2026-07-25T08:59:59.000Z",
        expiresAt: "2026-07-25T09:10:00.000Z",
        runtimeCommit: "a".repeat(40),
        providerConfigurationSha256: "b".repeat(64),
        capacity: 2,
        auditedGroupIds: ["group-a", "group-b"],
        runPlans: [{
          runId: "controlled-a",
          scenarioId: "slow",
          fault: "slow_canonical_head",
          faultUntil: "2026-07-25T09:00:05.000Z"
        }, {
          runId: "controlled-b",
          scenarioId: "cooldown",
          fault: "provider_cooldown",
          faultUntil: "2026-07-25T09:00:05.000Z"
        }]
      }
    });

    expect(controlled[0]).toMatchObject({
      eligibleReadyWork: 1,
      canonicalHeadEligible: true,
      mergeBufferFull: false
    });
    expect(controlled[1]).toMatchObject({
      eligibleReadyWork: 0,
      providerAvailable: true
    });
    expect(controlled[2]).toEqual(demand("unrelated-user-run"));
    expect(Object.keys(controlled[0]!)).not.toContain("providerGroupId");
  });

  it("leaves slow-head eligibility to the real execution seam", () => {
    const control = {
      version: "unified-adaptive-benchmark-control-v1" as const,
      leaseOwner: "lease",
      createdAt: "2026-07-25T08:59:59.000Z",
      expiresAt: "2026-07-25T09:10:00.000Z",
      runtimeCommit: "a".repeat(40),
      providerConfigurationSha256: "b".repeat(64),
      capacity: 1,
      auditedGroupIds: ["group-a"],
      runPlans: [{
        runId: "controlled-a",
        scenarioId: "slow",
        fault: "slow_canonical_head" as const,
        faultUntil: "2026-07-25T09:00:05.000Z"
      }]
    };
    const afterDeadline = new Date("2026-07-25T09:00:06.000Z");

    expect(applyUnifiedAdaptiveBenchmarkControl({
      demand: [demand("controlled-a")],
      providerSlots: [],
      control,
      acknowledgedRunIds: [],
      now: afterDeadline
    })[0]).toMatchObject({
      canonicalHeadEligible: true
    });
    expect(applyUnifiedAdaptiveBenchmarkControl({
      demand: [demand("controlled-a")],
      providerSlots: [],
      control,
      acknowledgedRunIds: ["controlled-a"],
      now: afterDeadline
    })[0]).toMatchObject({
      canonicalHeadEligible: true
    });
  });

  it("does not fabricate zero demand for a late interactive run", () => {
    const control = {
      version: "unified-adaptive-benchmark-control-v1" as const,
      leaseOwner: "lease",
      createdAt: "2026-07-25T08:59:59.000Z",
      expiresAt: "2026-07-25T09:10:00.000Z",
      runtimeCommit: "a".repeat(40),
      providerConfigurationSha256: "b".repeat(64),
      capacity: 1,
      auditedGroupIds: ["group-a"],
      runPlans: [{
        runId: "late-run",
        scenarioId: "late_interactive",
        fault: "late_interactive" as const,
        faultUntil: "2026-07-25T09:00:05.000Z"
      }]
    };

    expect(applyUnifiedAdaptiveBenchmarkControl({
      demand: [demand("late-run")],
      providerSlots: [],
      control,
      acknowledgedRunIds: [],
      now: NOW
    })[0]!.eligibleReadyWork).toBe(1);
    expect(applyUnifiedAdaptiveBenchmarkControl({
      demand: [demand("late-run")],
      providerSlots: [],
      control,
      acknowledgedRunIds: ["late-run"],
      now: NOW
    })[0]!.eligibleReadyWork).toBe(1);
  });

  it("persists one hash-bound lease, loads only its isolated runs, and releases idempotently", async () => {
    const writes = vi.fn(async (sql: string) => ({
      rows: sql.includes("select control.sha256")
        ? [{ sha256: "control", released: false }]
        : []
    }));
    const installed = await installUnifiedAdaptiveBenchmarkControl({
      db: transactionHost(writes),
      leaseOwner: "lease-owner",
      now: NOW,
      expiresAt: new Date("2026-07-25T09:20:00.000Z"),
      runtimeCommit: "a".repeat(40),
      providerConfigurationSha256: "b".repeat(64),
      capacity: 1,
      auditedGroupIds: ["group-a"],
      runPlans: [{
        runId: "run-a",
        scenarioId: "one",
        fault: "none",
        faultUntil: null
      }]
    });
    await installed.release();
    await installed.release();
    expect(writes.mock.calls.some((call) =>
      String((call as unknown[])[0]).includes("pg_advisory_xact_lock")
    )).toBe(true);
    expect(writes.mock.calls.some((call) =>
      String((call as unknown[])[0]).includes(
        "adaptive_benchmark_control_release"
      )
    )).toBe(true);

    const symptom = {
      version: "unified-adaptive-benchmark-scenario-symptom-v1" as const,
      controlSha256: installed.sha256,
      runId: "run-a",
      scenarioId: "one",
      phase: "run_completed" as const,
      observedAt: NOW.toISOString(),
      observationArtifactSha256: "d".repeat(64),
      runtimeInstanceId: "runtime-a",
      runtimeProcessStartedAt: "2026-07-25T08:00:00.000Z",
      runtimeProcessId: 123
    };
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          sha256: installed.sha256,
          artifact_json: installed.control
        }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "run-a" }] })
      .mockResolvedValueOnce({
        rows: [{
          sha256: fingerprintCanonicalArtifact(symptom),
          created_by_run_id: "run-a",
          artifact_json: symptom
        }]
      });
    await expect(loadUnifiedAdaptiveBenchmarkControl(
      { query },
      {
        now: new Date("2026-07-25T09:00:01.000Z"),
        runtimeCommit: "a".repeat(40),
        providerConfigurationSha256: "b".repeat(64)
      }
    )).resolves.toEqual({
      sha256: installed.sha256,
      control: installed.control,
      acknowledgedRunIds: ["run-a"]
    });
  });

  it("atomically and idempotently extends the current lease with a late run", async () => {
    const query = vi.fn(async (
      sql: string,
      _params?: readonly unknown[]
    ) => {
      if (sql.includes("select control.sha256")) {
        return { rows: [{ sha256: "control" }] };
      }
      if (sql.includes("from unified_check_runs")) {
        return { rows: [{ id: "late-run" }] };
      }
      return { rows: [] };
    });
    const installed = await installUnifiedAdaptiveBenchmarkControl({
      db: transactionHost(query),
      leaseOwner: "lease-owner",
      now: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000),
      runtimeCommit: "a".repeat(40),
      providerConfigurationSha256: "b".repeat(64),
      capacity: 1,
      auditedGroupIds: ["group-a"],
      runPlans: [{
        runId: "primary-run",
        scenarioId: "one_dense_wallet",
        fault: "none",
        faultUntil: null
      }]
    });
    const plan = [{
      runId: "late-run",
      scenarioId: "late_interactive",
      fault: "late_interactive" as const,
      faultUntil: new Date(NOW.getTime() + 5_000).toISOString()
    }];
    await installed.extendRunPlans(plan, NOW);
    await installed.extendRunPlans(plan, NOW);

    const fenceSql = query.mock.calls
      .map((call) => String((call as unknown[])[0]))
      .find((sql) => sql.includes("select control.sha256"))!;
    expect(fenceSql).toContain("adaptive_benchmark_control_release");
    expect(fenceSql).toContain("successor");
    expect(fenceSql).toContain("clock_timestamp()");
    const extensionWrites = query.mock.calls.filter((call) =>
      String((call as unknown[])[0]).includes(
        "insert into unified_check_artifacts"
      ) &&
      String((call as unknown[])[0]).includes(
        "'adaptive_benchmark_control_extension'"
      )
    );
    expect(extensionWrites).toHaveLength(2);
    expect(extensionWrites[0]![1]).toEqual(extensionWrites[1]![1]);
  });

  it("loads primary and late plans from one control so primary observations remain owned", async () => {
    const control = {
      version: "unified-adaptive-benchmark-control-v1" as const,
      leaseOwner: "lease-owner",
      createdAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      runtimeCommit: "a".repeat(40),
      providerConfigurationSha256: "b".repeat(64),
      capacity: 1,
      auditedGroupIds: ["group-a"],
      runPlans: [{
        runId: "primary-run",
        scenarioId: "one_dense_wallet",
        fault: "none" as const,
        faultUntil: null
      }]
    };
    const controlSha256 = fingerprintCanonicalArtifact(control);
    const extension = {
      version: "unified-adaptive-benchmark-control-extension-v1",
      controlSha256,
      leaseOwner: control.leaseOwner,
      addedAt: new Date(NOW.getTime() + 1_000).toISOString(),
      runPlans: [{
        runId: "late-run",
        scenarioId: "late_interactive",
        fault: "late_interactive" as const,
        faultUntil: new Date(NOW.getTime() + 5_000).toISOString()
      }]
    };
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ sha256: controlSha256, artifact_json: control }]
      })
      .mockResolvedValueOnce({
        rows: [{
          sha256: fingerprintCanonicalArtifact(extension),
          artifact_json: extension
        }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: "primary-run" }, { id: "late-run" }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const loaded = await loadUnifiedAdaptiveBenchmarkControl(
      { query },
      {
        now: new Date(NOW.getTime() + 2_000),
        runtimeCommit: control.runtimeCommit,
        providerConfigurationSha256:
          control.providerConfigurationSha256
      }
    );
    expect(loaded?.control.runPlans.map((plan) => plan.runId))
      .toEqual(["primary-run", "late-run"]);
    const telemetry = createUnifiedAdaptiveBenchmarkProviderTelemetry();
    telemetry.bindControl(
      loaded!.sha256,
      loaded!.control.runPlans.map((plan) => plan.runId)
    );
    for (const [requestId, runId] of [
      [1, "primary-run"],
      [2, "late-run"]
    ] as const) {
      telemetry.recordDispatch({
        requestId,
        atMs: 1_000,
        runId,
        groupId: "group-a"
      });
    }
    expect(telemetry.snapshot(loaded!.sha256, 2_000).requests).toBe(2);
  });

  it("fails closed on overlapping active leases", async () => {
    await expect(loadUnifiedAdaptiveBenchmarkControl(
      {
        query: vi.fn(async () => ({
          rows: [{}, {}]
        }))
      },
      {
        now: NOW,
        runtimeCommit: "a".repeat(40),
        providerConfigurationSha256: "b".repeat(64)
      }
    )).resolves.toBeNull();
  });

  it("serializes lease installation and propagates durable release failures", async () => {
    const conflictingQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ active: 1 }] });
    await expect(installUnifiedAdaptiveBenchmarkControl({
      db: transactionHost(conflictingQuery),
      leaseOwner: "lease-owner",
      now: NOW,
      expiresAt: new Date("2026-07-25T09:20:00.000Z"),
      runtimeCommit: "a".repeat(40),
      providerConfigurationSha256: "b".repeat(64),
      capacity: 1,
      auditedGroupIds: ["group-a"],
      runPlans: [{
        runId: "run-a",
        scenarioId: "one",
        fault: "none",
        faultUntil: null
      }]
    })).rejects.toThrow("unified_benchmark_control_lease_conflict");

    const releaseQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("release store unavailable"));
    const installed = await installUnifiedAdaptiveBenchmarkControl({
      db: transactionHost(releaseQuery),
      leaseOwner: "lease-owner",
      now: NOW,
      expiresAt: new Date("2026-07-25T09:20:00.000Z"),
      runtimeCommit: "a".repeat(40),
      providerConfigurationSha256: "b".repeat(64),
      capacity: 1,
      auditedGroupIds: ["group-a"],
      runPlans: [{
        runId: "run-a",
        scenarioId: "one",
        fault: "none",
        faultUntil: null
      }]
    });
    await expect(installed.release()).rejects.toThrow(
      "release store unavailable"
    );
  });

  it("fences renewal to the current unexpired unreleased lease owner", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const installed = await installUnifiedAdaptiveBenchmarkControl({
      db: transactionHost(query),
      leaseOwner: "lease-owner",
      now: NOW,
      expiresAt: new Date("2099-07-25T09:20:00.000Z"),
      runtimeCommit: "a".repeat(40),
      providerConfigurationSha256: "b".repeat(64),
      capacity: 1,
      auditedGroupIds: ["group-a"],
      runPlans: [{
        runId: "run-a",
        scenarioId: "one",
        fault: "none",
        faultUntil: null
      }]
    });

    await expect(installed.renew(
      new Date("2099-07-25T09:40:00.000Z")
    )).rejects.toThrow("unified_benchmark_control_renew_stale");
    const installLeaseSql = String((query.mock.calls[1] as unknown[])[0]);
    const renewalFenceSql = String((query.mock.calls[4] as unknown[])[0]);
    expect(installLeaseSql).toContain("adaptive_benchmark_control_renewal");
    expect(installLeaseSql).toContain("greatest");
    expect(renewalFenceSql).toContain("adaptive_benchmark_control_release");
    expect(renewalFenceSql).toContain("successor");
    expect(query.mock.calls.some((call) =>
      String((call as unknown[])[0]).includes(
        "'adaptive_benchmark_control_renewal','1'"
      )
    )).toBe(false);
  });

  it("recovers only the exact current unexpired benchmark control lease", async () => {
    const currentQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ sha256: "a".repeat(64) }] });
    await expect(assertUnifiedAdaptiveBenchmarkControlLeaseCurrent({
      db: transactionHost(currentQuery),
      controlSha256: "a".repeat(64),
      leaseOwner: "lease-owner",
      createdByRunId: "run-a",
      now: NOW
    })).resolves.toBeUndefined();
    const fenceSql = String((currentQuery.mock.calls[1] as unknown[])[0]);
    expect(fenceSql).toContain("created_by_run_id = $3");
    expect(fenceSql).toContain("adaptive_benchmark_control_release");
    expect(fenceSql).toContain("successor");
    expect(fenceSql).toContain("greatest");

    const staleQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(assertUnifiedAdaptiveBenchmarkControlLeaseCurrent({
      db: transactionHost(staleQuery),
      controlSha256: "a".repeat(64),
      leaseOwner: "stale-owner",
      createdByRunId: "run-a",
      now: NOW
    })).rejects.toThrow(
      "unified_benchmark_control_resume_lease_stale"
    );
  });

  it("persists and reloads only hash-bound run-scoped observations", async () => {
    const observation: UnifiedAdaptiveBenchmarkRuntimeObservationV1 = {
      version: "unified-adaptive-benchmark-runtime-observation-v1",
      controlSha256: "c".repeat(64),
      observedAt: NOW.toISOString(),
      runtime: {
        rssHeapScope: "process",
        availableMemoryScope: "container_or_host",
        instanceId: "runtime-a",
        processStartedAt: "2026-07-25T08:00:00.000Z",
        processId: 123,
        rssBytes: 100,
        heapUsedBytes: 50,
        availableContainerBytes: 1_000,
        availableHostBytes: 2_000
      },
      provider: {
        requests: 10,
        completed: 9,
        errors: 1,
        rateLimited429: 1,
        requestsPerSecond: 2,
        dispatchedGroupIds: ["group-a"]
      },
      reuse: {
        providerCacheHits: 1,
        networkFetches: 9,
        addressManifestReuses: 1,
        addressHistoryReplaysAvoided: 1
      },
      integrity: {
        duplicateCommits: 0,
        duplicateSequences: 0,
        deliveryIntents: 0
      },
      database: {
        scope: "benchmark_runtime_connection_pool",
        latencyMs: 12.5,
        checkpointLatencyMs: 4.5,
        poolWaitMs: 1.5
      },
      lifecycle: {
        restartRunId: "run-a",
        checkpointObservationSha256: "d".repeat(64),
        restartCount: 1,
        recoveryMs: 20,
        reconciliationRecoveries: 1
      },
      runs: [{
        runId: "run-a",
        scenarioId: "restart_recovery",
        planner: {
          durableBacklog: 1,
          admitted: 1,
          leased: 0,
          ready: 0,
          committed: 0
        },
        buffer: {
          readyCount: 0,
          readyBytes: 0,
          reservedBytes: 1_024
        },
        canonicalHeadAgeMs: 50,
        capacity: {
          eligibleDemand: 1,
          targetSlots: 1,
          actualSlots: 1
        },
        limitingReason: null
      }]
    };
    const write = vi.fn(async () => ({ rows: [] }));
    await expect(persistUnifiedAdaptiveBenchmarkObservation({
      db: { query: write },
      createdByRunId: "run-a",
      observation
    })).resolves.toMatch(/^[0-9a-f]{64}$/u);
    expect(write).toHaveBeenCalledOnce();

    const observationSha256 =
      await persistUnifiedAdaptiveBenchmarkObservation({
        db: { query: vi.fn(async () => ({ rows: [] })) },
        createdByRunId: "run-a",
        observation
      });
    await expect(listUnifiedAdaptiveBenchmarkObservations({
      db: {
        query: vi.fn(async () => ({
          rows: [{
            sha256: observationSha256,
            artifact_json: observation
          }]
        }))
      },
      controlSha256: observation.controlSha256,
      runIds: ["run-a"]
    })).resolves.toEqual([observation]);

    await expect(listUnifiedAdaptiveBenchmarkObservationArtifacts({
      db: {
        query: vi.fn(async () => ({
          rows: [{
            sha256: observationSha256,
            artifact_json: observation
          }]
        }))
      },
      controlSha256: observation.controlSha256,
      runIds: ["run-a"]
    })).resolves.toEqual([{
      sha256: observationSha256,
      observation
    }]);

    await expect(listUnifiedAdaptiveBenchmarkObservationArtifacts({
      db: {
        query: vi.fn(async () => ({
          rows: [{
            sha256: "f".repeat(64),
            artifact_json: observation
          }]
        }))
      },
      controlSha256: observation.controlSha256,
      runIds: ["run-a"]
    })).rejects.toThrow("unified_benchmark_observation_hash_mismatch");

    await expect(listUnifiedAdaptiveBenchmarkObservations({
      db: {
        query: vi.fn(async () => ({
          rows: [{
            sha256: observationSha256,
            artifact_json: {
              ...observation,
              lifecycle: {
                ...observation.lifecycle,
                restartRunId: "unbound-run"
              },
              runs: [{
                ...observation.runs[0],
                runId: "unbound-run"
              }]
            }
          }]
        }))
      },
      controlSha256: observation.controlSha256,
      runIds: ["run-a"]
    })).rejects.toThrow("unified_benchmark_observation_binding_invalid");
  });

  it("keeps observation capture best-effort when storage and reporting both fail", async () => {
    const onError = vi.fn(() => {
      throw new Error("logger unavailable");
    });
    await expect(captureUnifiedAdaptiveBenchmarkObservationBestEffort({
      capture: async () => {
        throw new Error("artifact store unavailable");
      },
      onError
    })).resolves.toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("acknowledges restart only from a distinct process startup attestation", () => {
    const oldRuntime = {
      runtimeInstanceId: "instance-old",
      runtimeProcessStartedAt: "2026-07-25T09:00:00.000Z",
      runtimeProcessId: 100
    };
    expect(isDistinctUnifiedBenchmarkRuntimeStartup(
      oldRuntime,
      oldRuntime
    )).toBe(false);
    expect(isDistinctUnifiedBenchmarkRuntimeStartup(oldRuntime, {
      ...oldRuntime,
      runtimeInstanceId: "instance-renamed-in-same-process"
    })).toBe(false);
    expect(isDistinctUnifiedBenchmarkRuntimeStartup(oldRuntime, {
      runtimeInstanceId: "instance-new",
      runtimeProcessStartedAt: "2026-07-25T09:01:00.000Z",
      runtimeProcessId: 200
    })).toBe(true);
  });
});
