import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../forensics/canonicalJson";
import type {
  ProviderRunDemand
} from "./fairProviderAllocator";
import type {
  UnifiedProviderSlotSnapshot
} from "./providerPool";
import type {
  UnifiedDecisionReason
} from "./adaptiveObservability";
import type {
  UnifiedQueryable,
  UnifiedTransactionalQueryable
} from "./repository";
import type {
  UnifiedReconciliationResult
} from "./reconciliation";
import type {
  UnifiedProviderRefillDiagnosticsSnapshotV1
} from "./providerRefillDiagnostics";

const HASH = /^[0-9a-f]{64}$/u;
const MAX_BENCHMARK_ITEMS = 4_096;
const MAX_BENCHMARK_TEXT = 4_096;
export const UNIFIED_BENCHMARK_RESTART_MAX_WAIT_MS = 10 * 60_000;

function benchmarkRecord(
  value: unknown,
  code: string
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(code);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
  code: string
): Record<string, unknown> {
  const record = benchmarkRecord(value, code);
  const allowed = new Set(keys);
  if (
    Object.keys(record).some((key) => !allowed.has(key)) ||
    keys.some((key) =>
      !Object.prototype.hasOwnProperty.call(record, key)
    )
  ) {
    throw new TypeError(code);
  }
  return record;
}

function boundedText(value: unknown, code: string): void {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_BENCHMARK_TEXT
  ) {
    throw new TypeError(code);
  }
}

function boundedArray(value: unknown, code: string): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_BENCHMARK_ITEMS
  ) {
    throw new TypeError(code);
  }
  return value;
}

export type UnifiedAdaptiveBenchmarkControlV1 = {
  readonly version: "unified-adaptive-benchmark-control-v1";
  readonly leaseOwner: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly runtimeCommit: string;
  readonly providerConfigurationSha256: string;
  readonly capacity: number;
  readonly auditedGroupIds: readonly string[];
  readonly runPlans: readonly {
    readonly runId: string;
    readonly scenarioId: string;
    readonly fault:
      | "none"
      | "provider_cooldown"
      | "slow_canonical_head"
      | "merge_buffer_full"
      | "late_interactive"
      | "restart_recovery";
    readonly faultUntil: string | null;
  }[];
};

export type LoadedUnifiedAdaptiveBenchmarkControl = {
  readonly sha256: string;
  readonly control: UnifiedAdaptiveBenchmarkControlV1;
  readonly acknowledgedRunIds: readonly string[];
};

export type UnifiedAdaptiveBenchmarkRuntimeObservationV1 = {
  readonly version:
    "unified-adaptive-benchmark-runtime-observation-v1";
  readonly controlSha256: string;
  readonly observedAt: string;
  readonly runtime: {
    readonly rssHeapScope: "process";
    readonly availableMemoryScope: "container_or_host";
    readonly instanceId: string;
    readonly processStartedAt: string;
    readonly processId: number;
    readonly rssBytes: number;
    readonly heapUsedBytes: number;
    readonly availableContainerBytes: number;
    readonly availableHostBytes: number;
  };
  readonly provider: {
    readonly requests: number;
    readonly completed: number;
    readonly errors: number;
    readonly rateLimited429: number;
    readonly requestsPerSecond: number;
    readonly dispatchedGroupIds: readonly string[];
  };
  readonly reuse: {
    readonly providerCacheHits: number;
    readonly networkFetches: number;
    readonly addressManifestReuses: number;
    readonly addressHistoryReplaysAvoided: number;
  };
  readonly integrity: {
    readonly duplicateCommits: number;
    readonly duplicateSequences: number;
    readonly deliveryIntents: number;
  };
  readonly database: {
    readonly scope: "benchmark_runtime_connection_pool";
    readonly latencyMs: number;
    readonly checkpointLatencyMs: number;
    readonly poolWaitMs: number;
  };
  readonly lifecycle: {
    readonly restartRunId: string | null;
    readonly checkpointObservationSha256: string | null;
    readonly restartCount: number;
    readonly recoveryMs: number;
    readonly reconciliationRecoveries: number;
  };
  readonly runs: readonly {
    readonly runId: string;
    readonly scenarioId: string;
    readonly planner: {
      readonly durableBacklog: number;
      readonly admitted: number;
      readonly leased: number;
      readonly ready: number;
      readonly committed: number;
    };
    readonly buffer: {
      readonly readyCount: number;
      readonly readyBytes: number;
      readonly reservedBytes: number;
    };
    readonly canonicalHeadAgeMs: number | null;
    readonly capacity: {
      readonly eligibleDemand: number;
      readonly targetSlots: number;
      readonly actualSlots: number;
    };
    readonly limitingReason: UnifiedDecisionReason | null;
  }[];
};

export type UnifiedAdaptiveBenchmarkRuntimeObservationArtifactV1 = {
  readonly sha256: string;
  readonly observation: UnifiedAdaptiveBenchmarkRuntimeObservationV1;
};

export type UnifiedProviderRefillObservationV1 = {
  readonly version: "unified-provider-refill-observation-v1";
  readonly controlSha256: string;
  readonly observedAt: string;
  readonly runtimeCommit: string;
  readonly providerConfigurationSha256: string;
  readonly diagnostics: UnifiedProviderRefillDiagnosticsSnapshotV1;
  readonly saturated: {
    readonly sampleCount: number;
    readonly activeSlotSum: number;
    readonly fourOfFourSamples: number;
    readonly unexplainedIdleSamples: number;
  };
  readonly memoryEvidence: {
    readonly samplesSha256: string;
    readonly summarySha256: string;
    readonly diagnosticStatus: "captured" | "skipped";
  };
};

export type UnifiedProviderRefillObservationArtifactV1 = {
  readonly sha256: string;
  readonly createdByRunId: string;
  readonly observation: UnifiedProviderRefillObservationV1;
};

export type UnifiedProviderSaturationSample = {
  readonly providerCapacityLimit: number;
  readonly eligibleReadyProviderWork: number;
  readonly runtimeState: "normal" | "pressure" | "critical";
  readonly healthyGroupCount: number;
  readonly activeSlots: number;
  readonly limitingReason: UnifiedDecisionReason["code"] | null;
};

export type UnifiedProviderRefillRuntimeSampleV1 = {
  readonly version: "unified-provider-refill-runtime-sample-v1";
  readonly controlSha256: string;
  readonly observedAt: string;
  readonly runtimeCommit: string;
  readonly providerConfigurationSha256: string;
  readonly runIds: readonly string[];
  readonly diagnostics: UnifiedProviderRefillDiagnosticsSnapshotV1;
  readonly saturationSample: UnifiedProviderSaturationSample;
};

export type UnifiedAdaptiveBenchmarkScenarioSymptomV1 = {
  readonly version: "unified-adaptive-benchmark-scenario-symptom-v1";
  readonly controlSha256: string;
  readonly runId: string;
  readonly scenarioId: string;
  readonly phase:
    | "run_completed"
    | "late_after_peer_checkpoint"
    | "audited_group_cooldown_observed"
    | "canonical_head_delay_observed"
    | "merge_buffer_full_observed"
    | "external_runtime_restart_attested";
  readonly observedAt: string;
  readonly observationArtifactSha256: string;
  readonly runtimeInstanceId: string;
  readonly runtimeProcessStartedAt: string;
  readonly runtimeProcessId: number;
  readonly providerCooldown?: {
    readonly groupId: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly fallbackDispatches: number;
    readonly resumedDispatches: number;
    readonly activeObserved: true;
    readonly synthetic: true;
    readonly provider429Observed: false;
  };
  readonly slowHeadAcceptance?: {
    readonly taskId: string;
    readonly canonicalSequence: number;
    readonly attemptId: string;
    readonly artifactSha256: string;
    readonly completedAt: string;
  };
  readonly restartHandoff?: {
    readonly requestedAt: string;
    readonly previousRuntimeInstanceId: string;
    readonly previousRuntimeProcessStartedAt: string;
    readonly previousRuntimeProcessId: number;
    readonly checkpointObservationSha256: string;
    readonly reconciliationArtifactSha256: string;
  };
};
export type UnifiedAdaptiveBenchmarkScenarioSymptomArtifactV1 = {
  readonly sha256: string;
  readonly symptom: UnifiedAdaptiveBenchmarkScenarioSymptomV1;
};

export function createUnifiedAdaptiveBenchmarkProviderTelemetry() {
  type RunTelemetry = {
    firstDispatchAtMs: number | null;
    dispatches: Set<number>;
    completed: Set<number>;
    errors: Set<number>;
    rateLimited429: Set<number>;
    groupIds: Set<string>;
  };
  const controlRunIds = new Map<string, Set<string>>();
  const controlByRunId = new Map<string, string>();
  const telemetryByControl = new Map<string, Map<string, RunTelemetry>>();
  const runTelemetry = (
    controlSha256: string,
    runId: string
  ): RunTelemetry => {
    let byRun = telemetryByControl.get(controlSha256);
    if (!byRun) {
      byRun = new Map();
      telemetryByControl.set(controlSha256, byRun);
    }
    let value = byRun.get(runId);
    if (!value) {
      value = {
        firstDispatchAtMs: null,
        dispatches: new Set(),
        completed: new Set(),
        errors: new Set(),
        rateLimited429: new Set(),
        groupIds: new Set()
      };
      byRun.set(runId, value);
    }
    return value;
  };
  return {
    teardownBenchmarkControl(controlSha256: string): void {
      if (!HASH.test(controlSha256)) {
        throw new TypeError(
          "unified_benchmark_telemetry_control_invalid"
        );
      }
      for (const runId of controlRunIds.get(controlSha256) ?? []) {
        if (controlByRunId.get(runId) === controlSha256) {
          controlByRunId.delete(runId);
        }
      }
      controlRunIds.delete(controlSha256);
      telemetryByControl.delete(controlSha256);
    },
    bindControl(controlSha256: string, runIds: readonly string[]): void {
      if (!HASH.test(controlSha256)) {
        throw new TypeError("unified_benchmark_telemetry_control_invalid");
      }
      const next = new Set(runIds);
      for (const previous of controlRunIds.get(controlSha256) ?? []) {
        if (!next.has(previous) &&
          controlByRunId.get(previous) === controlSha256) {
          controlByRunId.delete(previous);
        }
      }
      for (const runId of next) {
        if (!runId.trim()) {
          throw new TypeError("unified_benchmark_telemetry_run_invalid");
        }
        controlByRunId.set(runId, controlSha256);
      }
      controlRunIds.set(controlSha256, next);
    },
    recordDispatch(input: {
      readonly requestId: number;
      readonly atMs: number;
      readonly runId: string;
      readonly groupId: string;
    }): void {
      const controlSha256 = controlByRunId.get(input.runId);
      if (!controlSha256) return;
      const value = runTelemetry(controlSha256, input.runId);
      value.dispatches.add(input.requestId);
      value.groupIds.add(input.groupId);
      value.firstDispatchAtMs = value.firstDispatchAtMs === null
        ? input.atMs
        : Math.min(value.firstDispatchAtMs, input.atMs);
    },
    recordOutcome(input: {
      readonly requestId: number;
      readonly runId: string;
      readonly groupId: string;
      readonly outcome: "success" | "error" | "rate_limited_429";
    }): void {
      const controlSha256 = controlByRunId.get(input.runId);
      if (!controlSha256) return;
      const value = runTelemetry(controlSha256, input.runId);
      if (!value.dispatches.has(input.requestId)) return;
      value.completed.add(input.requestId);
      value.groupIds.add(input.groupId);
      if (input.outcome !== "success") value.errors.add(input.requestId);
      if (input.outcome === "rate_limited_429") {
        value.rateLimited429.add(input.requestId);
      }
    },
    snapshot(
      controlSha256: string,
      nowMs: number,
      runIds?: readonly string[]
    ) {
      const boundRunIds = controlRunIds.get(controlSha256) ?? new Set();
      const selectedRunIds = runIds ?? [...boundRunIds];
      if (selectedRunIds.some((runId) => !boundRunIds.has(runId))) {
        throw new Error("unified_benchmark_telemetry_run_unbound");
      }
      const byRun = telemetryByControl.get(controlSha256);
      const values = selectedRunIds.flatMap((runId) => {
        const value = byRun?.get(runId);
        return value ? [value] : [];
      });
      const union = (
        select: (value: RunTelemetry) => ReadonlySet<number>
      ): Set<number> => new Set(values.flatMap((value) => [
        ...select(value)
      ]));
      const requests = union((value) => value.dispatches).size;
      const firstDispatchAtMs = values.flatMap((value) =>
        value.firstDispatchAtMs === null
          ? []
          : [value.firstDispatchAtMs]
      ).sort((left, right) => left - right)[0] ?? null;
      return {
        requests,
        completed: union((value) => value.completed).size,
        errors: union((value) => value.errors).size,
        rateLimited429: union((value) => value.rateLimited429).size,
        requestsPerSecond: firstDispatchAtMs === null
          ? 0
          : requests / Math.max(0.001, (nowMs - firstDispatchAtMs) / 1_000),
        dispatchedGroupIds: [...new Set(values.flatMap((value) =>
          [...value.groupIds]
        ))].sort()
      };
    }
  };
}

export function isDistinctUnifiedBenchmarkRuntimeStartup(
  requested: {
    readonly runtimeInstanceId: string;
    readonly runtimeProcessStartedAt: string;
    readonly runtimeProcessId: number;
  },
  current: {
    readonly runtimeInstanceId: string;
    readonly runtimeProcessStartedAt: string;
    readonly runtimeProcessId: number;
  }
): boolean {
  return requested.runtimeInstanceId !== current.runtimeInstanceId &&
    (
      requested.runtimeProcessStartedAt !== current.runtimeProcessStartedAt ||
      requested.runtimeProcessId !== current.runtimeProcessId
  );
}

export async function acknowledgeUnifiedAdaptiveBenchmarkRestartHandoffs(
  input: {
    readonly db: UnifiedQueryable;
    readonly now: Date;
    readonly runtime: {
      readonly instanceId: string;
      readonly processStartedAt: string;
      readonly processId: number;
    };
    readonly reconciliationResult: UnifiedReconciliationResult;
    readonly tickObservedAt: string;
  }
): Promise<number> {
  const rows = (await input.db.query(
    `select handoff.sha256, handoff.artifact_json
       from unified_check_artifacts handoff
      where handoff.kind = 'adaptive_benchmark_restart_handoff'
        and not exists (
          select 1
            from unified_check_artifacts symptom
           where symptom.kind = 'adaptive_benchmark_scenario_symptom'
             and symptom.artifact_json->>'controlSha256' =
               handoff.artifact_json->>'controlSha256'
             and symptom.artifact_json->>'runId' =
               handoff.artifact_json->>'runId'
             and symptom.artifact_json->>'phase' =
               'external_runtime_restart_attested'
        )
      order by handoff.created_at, handoff.sha256`
  )).rows;
  let acknowledged = 0;
  for (const row of rows) {
    const handoff = exactKeys(row.artifact_json, [
      "version",
      "controlSha256",
      "runId",
      "scenarioId",
      "requestedAt",
      "resumeDeadline",
      "runtimeInstanceId",
      "runtimeProcessStartedAt",
      "runtimeProcessId",
      "checkpointObservationSha256",
      "checkpointTaskId",
      "checkpointCanonicalSequence",
      "checkpointAttempt"
    ], "unified_benchmark_restart_handoff_invalid") as {
      version?: string;
      controlSha256?: string;
      runId?: string;
      scenarioId?: string;
      requestedAt?: string;
      resumeDeadline?: string;
      runtimeInstanceId?: string;
      runtimeProcessStartedAt?: string;
      runtimeProcessId?: number;
      checkpointObservationSha256?: string;
      checkpointTaskId?: string;
      checkpointCanonicalSequence?: number;
      checkpointAttempt?: number;
    };
    if (
      handoff.version !==
        "unified-adaptive-benchmark-restart-handoff-v1" ||
      !handoff.controlSha256 ||
      !HASH.test(handoff.controlSha256) ||
      !handoff.runId?.trim() ||
      !handoff.scenarioId?.trim() ||
      !handoff.requestedAt ||
      !Number.isFinite(Date.parse(handoff.requestedAt)) ||
      !handoff.resumeDeadline ||
      !Number.isFinite(Date.parse(handoff.resumeDeadline)) ||
      Date.parse(handoff.resumeDeadline) <= Date.parse(handoff.requestedAt) ||
      Date.parse(handoff.resumeDeadline) - Date.parse(handoff.requestedAt) >
        UNIFIED_BENCHMARK_RESTART_MAX_WAIT_MS ||
      !handoff.runtimeInstanceId?.trim() ||
      !handoff.runtimeProcessStartedAt ||
      !Number.isFinite(Date.parse(handoff.runtimeProcessStartedAt)) ||
      !Number.isSafeInteger(handoff.runtimeProcessId) ||
      Number(handoff.runtimeProcessId) < 1 ||
      !handoff.checkpointObservationSha256 ||
      !HASH.test(handoff.checkpointObservationSha256) ||
      !handoff.checkpointTaskId?.trim() ||
      !Number.isSafeInteger(handoff.checkpointCanonicalSequence) ||
      Number(handoff.checkpointCanonicalSequence) < 0 ||
      !Number.isSafeInteger(handoff.checkpointAttempt) ||
      Number(handoff.checkpointAttempt) < 1 ||
      fingerprintCanonicalArtifact(handoff) !== String(row.sha256)
    ) {
      throw new Error("unified_benchmark_restart_handoff_invalid");
    }
    if (input.now.getTime() > Date.parse(handoff.resumeDeadline)) {
      continue;
    }
    if (!isDistinctUnifiedBenchmarkRuntimeStartup(
      {
        runtimeInstanceId: handoff.runtimeInstanceId,
        runtimeProcessStartedAt: handoff.runtimeProcessStartedAt,
        runtimeProcessId: Number(handoff.runtimeProcessId)
      },
      {
        runtimeInstanceId: input.runtime.instanceId,
        runtimeProcessStartedAt: input.runtime.processStartedAt,
        runtimeProcessId: input.runtime.processId
      }
    )) {
      continue;
    }
    const checkpointRow = (await input.db.query(
      `select artifact_json
         from unified_check_artifacts
        where sha256 = $1
          and kind = 'adaptive_benchmark_runtime_observation'
        limit 1`,
      [handoff.checkpointObservationSha256]
    )).rows[0];
    if (!checkpointRow) continue;
    const checkpointObservation =
      checkpointRow.artifact_json as
        UnifiedAdaptiveBenchmarkRuntimeObservationV1;
    validateObservation(checkpointObservation);
    const baselineCommitted = checkpointObservation.runs.find((run) =>
      run.runId === handoff.runId
    )?.planner.committed;
    if (
      checkpointObservation.controlSha256 !== handoff.controlSha256 ||
      baselineCommitted === undefined
    ) {
      throw new Error("unified_benchmark_restart_handoff_invalid");
    }
    const progress = (await input.db.query(
      `select planner.planner_state,
              planner.committed_at
         from unified_check_planner_entries planner
        where planner.run_id = $1
          and planner.task_id = $2
          and planner.canonical_sequence = $3
        limit 1`,
      [
        handoff.runId,
        handoff.checkpointTaskId,
        handoff.checkpointCanonicalSequence
      ]
    )).rows[0];
    const reconciliationIdentity = {
      version:
        "unified-adaptive-benchmark-restart-reconciliation-v1",
      handoffSha256: String(row.sha256),
      controlSha256: handoff.controlSha256,
      runId: handoff.runId,
      runtimeInstanceId: input.runtime.instanceId,
      runtimeProcessStartedAt: input.runtime.processStartedAt,
      runtimeProcessId: input.runtime.processId,
      baselineCommitted,
      checkpointTaskId: handoff.checkpointTaskId,
      checkpointCanonicalSequence:
        handoff.checkpointCanonicalSequence,
      checkpointAttempt: handoff.checkpointAttempt,
      tickObservedAt: input.tickObservedAt,
      reconciliationResult: input.reconciliationResult
    };
    let reconciliationSha256 =
      fingerprintCanonicalArtifact(reconciliationIdentity);
    const reconciliationRow = (await input.db.query(
      `select sha256, artifact_json
         from unified_check_artifacts
        where kind = 'adaptive_benchmark_restart_reconciliation'
          and artifact_json->>'handoffSha256' = $1
          and artifact_json->>'runtimeInstanceId' = $2
        limit 1`,
      [String(row.sha256), input.runtime.instanceId]
    )).rows[0];
    if (!reconciliationRow) {
      if (!input.reconciliationResult.actionableWorkFound) continue;
      await input.db.query(
        `insert into unified_check_artifacts (
           sha256, created_by_run_id, kind, schema_version,
           artifact_json
         ) values (
           $1,$2,'adaptive_benchmark_restart_reconciliation',
           '1',$3::jsonb
         ) on conflict (sha256) do nothing`,
        [
          reconciliationSha256,
          handoff.runId,
          JSON.stringify(reconciliationIdentity)
        ]
      );
      continue;
    }
    const persistedReconciliation = exactKeys(
      reconciliationRow.artifact_json,
      [
        "version",
        "handoffSha256",
        "controlSha256",
        "runId",
        "runtimeInstanceId",
        "runtimeProcessStartedAt",
        "runtimeProcessId",
        "baselineCommitted",
        "checkpointTaskId",
        "checkpointCanonicalSequence",
        "checkpointAttempt",
        "tickObservedAt",
        "reconciliationResult"
      ],
      "unified_benchmark_restart_reconciliation_invalid"
    );
    const persistedResult = exactKeys(
      persistedReconciliation.reconciliationResult,
      ["actionableWorkFound", "admitted", "wokenSlots"],
      "unified_benchmark_restart_reconciliation_invalid"
    );
    reconciliationSha256 = String(reconciliationRow.sha256);
    if (
      persistedReconciliation.version !==
        "unified-adaptive-benchmark-restart-reconciliation-v1" ||
      persistedReconciliation.handoffSha256 !== String(row.sha256) ||
      persistedReconciliation.controlSha256 !== handoff.controlSha256 ||
      persistedReconciliation.runId !== handoff.runId ||
      persistedReconciliation.runtimeInstanceId !==
        input.runtime.instanceId ||
      persistedResult.actionableWorkFound !== true ||
      !HASH.test(reconciliationSha256) ||
      fingerprintCanonicalArtifact(persistedReconciliation) !==
        reconciliationSha256
    ) {
      throw new Error(
        "unified_benchmark_restart_reconciliation_invalid"
      );
    }
    if (
      progress?.planner_state !== "committed" ||
      progress.committed_at === null ||
      progress.committed_at === undefined
    ) {
      continue;
    }
    const recoveredObservationRow = (await input.db.query(
      `select sha256, artifact_json
         from unified_check_artifacts
        where kind = 'adaptive_benchmark_runtime_observation'
          and artifact_json->>'controlSha256' = $1
          and artifact_json @> $2::jsonb
        order by created_at desc, sha256 desc
        limit 1`,
      [
        handoff.controlSha256,
        JSON.stringify({ runs: [{ runId: handoff.runId }] })
      ]
    )).rows[0];
    if (!recoveredObservationRow) continue;
    const recoveredObservation =
      recoveredObservationRow.artifact_json as
        UnifiedAdaptiveBenchmarkRuntimeObservationV1;
    validateObservation(recoveredObservation);
    const recoveredCommitted = recoveredObservation.runs.find((run) =>
      run.runId === handoff.runId
    )?.planner.committed;
    if (
      recoveredObservation.controlSha256 !== handoff.controlSha256 ||
      recoveredCommitted === undefined ||
      recoveredCommitted <= baselineCommitted
    ) {
      continue;
    }
    await persistUnifiedAdaptiveBenchmarkScenarioSymptom({
      db: input.db,
      createdByRunId: handoff.runId,
      symptom: {
        version: "unified-adaptive-benchmark-scenario-symptom-v1",
        controlSha256: handoff.controlSha256,
        runId: handoff.runId,
        scenarioId: handoff.scenarioId,
        phase: "external_runtime_restart_attested",
        observedAt: input.now.toISOString(),
        observationArtifactSha256: String(
          recoveredObservationRow.sha256
        ),
        runtimeInstanceId: input.runtime.instanceId,
        runtimeProcessStartedAt: input.runtime.processStartedAt,
        runtimeProcessId: input.runtime.processId,
        restartHandoff: {
          requestedAt: handoff.requestedAt,
          previousRuntimeInstanceId: handoff.runtimeInstanceId,
          previousRuntimeProcessStartedAt:
            handoff.runtimeProcessStartedAt,
          previousRuntimeProcessId: Number(handoff.runtimeProcessId),
          checkpointObservationSha256:
            handoff.checkpointObservationSha256,
          reconciliationArtifactSha256: reconciliationSha256
        }
      }
    });
    acknowledged += 1;
  }
  return acknowledged;
}

export function unifiedAdaptiveBenchmarkControlHash(
  control: UnifiedAdaptiveBenchmarkControlV1
): string {
  return fingerprintCanonicalArtifact(control);
}

export async function persistUnifiedAdaptiveBenchmarkLatePhaseAck(input: {
  readonly db: UnifiedQueryable;
  readonly createdByRunId: string;
  readonly artifact: {
    readonly version: "unified-adaptive-benchmark-late-phase-v1";
    readonly phaseIdentity: string;
    readonly peerRunId: string;
    readonly peerCheckpointObservationSha256: string;
    readonly acknowledgedAt: string;
  };
}): Promise<string> {
  if (
    input.artifact.version !==
      "unified-adaptive-benchmark-late-phase-v1" ||
    !input.artifact.phaseIdentity.trim() ||
    input.artifact.peerRunId !== input.createdByRunId ||
    !HASH.test(input.artifact.peerCheckpointObservationSha256) ||
    !Number.isFinite(Date.parse(input.artifact.acknowledgedAt))
  ) {
    throw new TypeError("unified_benchmark_late_phase_invalid");
  }
  const sha256 = fingerprintCanonicalArtifact(input.artifact);
  await input.db.query(
    `insert into unified_check_artifacts (
       sha256, created_by_run_id, kind, schema_version, artifact_json
     ) values (
       $1,$2,'adaptive_benchmark_late_phase','1',$3::jsonb
     ) on conflict (sha256) do nothing`,
    [
      sha256,
      input.createdByRunId,
      JSON.stringify(input.artifact)
    ]
  );
  return sha256;
}

export async function releaseUnifiedAdaptiveBenchmarkControl(input: {
  readonly db: UnifiedTransactionalQueryable;
  readonly controlSha256: string;
  readonly leaseOwner: string;
  readonly createdByRunId: string;
  readonly releasedAt: Date;
}): Promise<void> {
  if (
    !HASH.test(input.controlSha256) ||
    !input.leaseOwner.trim() ||
    !input.createdByRunId.trim() ||
    !Number.isFinite(input.releasedAt.getTime())
  ) {
    throw new TypeError("unified_benchmark_control_release_invalid");
  }
  const artifact = {
    version: "unified-adaptive-benchmark-control-release-v1",
    controlSha256: input.controlSha256,
    leaseOwner: input.leaseOwner,
    releasedAt: input.releasedAt.toISOString()
  };
  await input.db.transaction(async (tx) => {
    await tx.query(
      "select pg_advisory_xact_lock(hashtext($1))",
      ["unified-adaptive-benchmark-control"]
    );
    const current = (await tx.query(
      `select control.sha256,
              exists (
                select 1
                  from unified_check_artifacts released
                 where released.kind =
                   'adaptive_benchmark_control_release'
                   and released.artifact_json->>'controlSha256' =
                     control.sha256
              ) as released
         from unified_check_artifacts control
        where control.sha256 = $1
          and control.kind = 'adaptive_benchmark_control'
          and control.artifact_json->>'leaseOwner' = $2
          and not exists (
            select 1
              from unified_check_artifacts successor
             where successor.kind = 'adaptive_benchmark_control'
               and successor.sha256 <> control.sha256
               and (
                 successor.created_at > control.created_at or
                 (
                   successor.created_at = control.created_at and
                   successor.sha256 > control.sha256
                 )
               )
          )
        for update of control`,
      [input.controlSha256, input.leaseOwner]
    )).rows[0];
    if (!current) {
      throw new Error("unified_benchmark_control_release_stale");
    }
    if (current.released === true) return;
    await tx.query(
      `insert into unified_check_artifacts (
         sha256, created_by_run_id, kind, schema_version, artifact_json
       ) values ($1,$2,'adaptive_benchmark_control_release','1',$3::jsonb)
       on conflict (sha256) do nothing`,
      [
        fingerprintCanonicalArtifact(artifact),
        input.createdByRunId,
        JSON.stringify(artifact)
      ]
    );
  });
}

export async function renewUnifiedAdaptiveBenchmarkControl(input: {
  readonly db: UnifiedTransactionalQueryable;
  readonly controlSha256: string;
  readonly leaseOwner: string;
  readonly createdByRunId: string;
  readonly now: Date;
  readonly expiresAt: Date;
}): Promise<void> {
  if (
    !HASH.test(input.controlSha256) ||
    !input.leaseOwner.trim() ||
    !input.createdByRunId.trim() ||
    !Number.isFinite(input.now.getTime()) ||
    !Number.isFinite(input.expiresAt.getTime()) ||
    input.expiresAt.getTime() <= input.now.getTime()
  ) {
    throw new TypeError("unified_benchmark_control_renew_invalid");
  }
  const artifact = {
    version: "unified-adaptive-benchmark-control-renewal-v1",
    controlSha256: input.controlSha256,
    leaseOwner: input.leaseOwner,
    expiresAt: input.expiresAt.toISOString()
  };
  await input.db.transaction(async (tx) => {
    await tx.query(
      "select pg_advisory_xact_lock(hashtext($1))",
      ["unified-adaptive-benchmark-control"]
    );
    const current = (await tx.query(
      `select control.sha256
         from unified_check_artifacts control
         left join lateral (
           select case
                    when value.artifact_json->>'expiresAt' ~
                      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                    then (
                      value.artifact_json->>'expiresAt'
                    )::timestamptz
                    else '-infinity'::timestamptz
                  end as expires_at
             from unified_check_artifacts value
            where value.kind =
              'adaptive_benchmark_control_renewal'
              and value.artifact_json->>'version' =
                'unified-adaptive-benchmark-control-renewal-v1'
              and value.artifact_json->>'controlSha256' =
                control.sha256
              and value.artifact_json->>'leaseOwner' = $2
            order by value.created_at desc, value.sha256 desc
            limit 1
         ) renewal on true
        where control.sha256 = $1
          and control.kind = 'adaptive_benchmark_control'
          and control.artifact_json->>'leaseOwner' = $2
          and greatest(
            case
              when control.artifact_json->>'expiresAt' ~
                '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
              then (
                control.artifact_json->>'expiresAt'
              )::timestamptz
              else '-infinity'::timestamptz
            end,
            coalesce(renewal.expires_at, '-infinity'::timestamptz)
          ) > $3
          and $4::timestamptz > greatest(
            case
              when control.artifact_json->>'expiresAt' ~
                '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
              then (
                control.artifact_json->>'expiresAt'
              )::timestamptz
              else '-infinity'::timestamptz
            end,
            coalesce(renewal.expires_at, '-infinity'::timestamptz)
          )
          and not exists (
            select 1
              from unified_check_artifacts released
             where released.kind =
               'adaptive_benchmark_control_release'
               and released.artifact_json->>'controlSha256' =
                 control.sha256
          )
          and not exists (
            select 1
              from unified_check_artifacts successor
             where successor.kind = 'adaptive_benchmark_control'
               and successor.sha256 <> control.sha256
               and (
                 successor.created_at > control.created_at or
                 (
                   successor.created_at = control.created_at and
                   successor.sha256 > control.sha256
                 )
               )
          )
        for update of control`,
      [
        input.controlSha256,
        input.leaseOwner,
        input.now.toISOString(),
        input.expiresAt.toISOString()
      ]
    )).rows;
    if (current.length !== 1) {
      throw new Error("unified_benchmark_control_renew_stale");
    }
    await tx.query(
      `insert into unified_check_artifacts (
         sha256, created_by_run_id, kind, schema_version, artifact_json
       ) values (
         $1,$2,'adaptive_benchmark_control_renewal','1',$3::jsonb
       ) on conflict (sha256) do nothing`,
      [
        fingerprintCanonicalArtifact(artifact),
        input.createdByRunId,
        JSON.stringify(artifact)
      ]
    );
  });
}

export async function assertUnifiedAdaptiveBenchmarkControlLeaseCurrent(
  input: {
    readonly db: UnifiedTransactionalQueryable;
    readonly controlSha256: string;
    readonly leaseOwner: string;
    readonly createdByRunId: string;
    readonly now: Date;
  }
): Promise<void> {
  if (
    !HASH.test(input.controlSha256) ||
    !input.leaseOwner.trim() ||
    !input.createdByRunId.trim() ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new TypeError(
      "unified_benchmark_control_resume_lease_invalid"
    );
  }
  await input.db.transaction(async (tx) => {
    await tx.query(
      "select pg_advisory_xact_lock(hashtext($1))",
      ["unified-adaptive-benchmark-control"]
    );
    const current = (await tx.query(
      `select control.sha256
         from unified_check_artifacts control
         left join lateral (
           select case
                    when value.artifact_json->>'expiresAt' ~
                      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                    then (
                      value.artifact_json->>'expiresAt'
                    )::timestamptz
                    else '-infinity'::timestamptz
                  end as expires_at
             from unified_check_artifacts value
            where value.kind =
              'adaptive_benchmark_control_renewal'
              and value.artifact_json->>'controlSha256' =
                control.sha256
              and value.artifact_json->>'leaseOwner' = $2
            order by value.created_at desc, value.sha256 desc
            limit 1
         ) renewal on true
        where control.sha256 = $1
          and control.kind = 'adaptive_benchmark_control'
          and control.created_by_run_id = $3
          and control.artifact_json->>'leaseOwner' = $2
          and greatest(
            case
              when control.artifact_json->>'expiresAt' ~
                '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
              then (
                control.artifact_json->>'expiresAt'
              )::timestamptz
              else '-infinity'::timestamptz
            end,
            coalesce(renewal.expires_at, '-infinity'::timestamptz)
          ) > $4::timestamptz
          and not exists (
            select 1
              from unified_check_artifacts released
             where released.kind =
               'adaptive_benchmark_control_release'
               and released.artifact_json->>'controlSha256' =
                 control.sha256
          )
          and not exists (
            select 1
              from unified_check_artifacts successor
             where successor.kind = 'adaptive_benchmark_control'
               and successor.sha256 <> control.sha256
               and (
                 successor.created_at > control.created_at or
                 (
                   successor.created_at = control.created_at and
                   successor.sha256 > control.sha256
                 )
               )
          )
        for update of control`,
      [
        input.controlSha256,
        input.leaseOwner,
        input.createdByRunId,
        input.now.toISOString()
      ]
    )).rows;
    if (current.length !== 1) {
      throw new Error("unified_benchmark_control_resume_lease_stale");
    }
  });
}

export async function installUnifiedAdaptiveBenchmarkControl(input: {
  readonly db: UnifiedTransactionalQueryable;
  readonly leaseOwner: string;
  readonly now: Date;
  readonly expiresAt: Date;
  readonly runtimeCommit: string;
  readonly providerConfigurationSha256: string;
  readonly capacity: number;
  readonly auditedGroupIds: readonly string[];
  readonly runPlans: UnifiedAdaptiveBenchmarkControlV1["runPlans"];
}): Promise<{
  readonly control: UnifiedAdaptiveBenchmarkControlV1;
  readonly sha256: string;
  extendRunPlans(
    runPlans: UnifiedAdaptiveBenchmarkControlV1["runPlans"],
    addedAt: Date
  ): Promise<void>;
  renew(expiresAt: Date): Promise<void>;
  release(): Promise<void>;
}> {
  const control: UnifiedAdaptiveBenchmarkControlV1 = {
    version: "unified-adaptive-benchmark-control-v1",
    leaseOwner: input.leaseOwner,
    createdAt: input.now.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    runtimeCommit: input.runtimeCommit,
    providerConfigurationSha256: input.providerConfigurationSha256,
    capacity: input.capacity,
    auditedGroupIds: [...input.auditedGroupIds],
    runPlans: input.runPlans
  };
  validateControl(control, input.now);
  const sha256 = unifiedAdaptiveBenchmarkControlHash(control);
  await input.db.transaction(async (tx) => {
    await tx.query(
      "select pg_advisory_xact_lock(hashtext($1))",
      ["unified-adaptive-benchmark-control"]
    );
    const active = (await tx.query(
      `select 1
         from unified_check_artifacts artifact
         left join lateral (
           select case
                    when value.artifact_json->>'expiresAt' ~
                      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                    then (
                      value.artifact_json->>'expiresAt'
                    )::timestamptz
                    else '-infinity'::timestamptz
                  end as expires_at
             from unified_check_artifacts value
            where value.kind = 'adaptive_benchmark_control_renewal'
              and value.artifact_json->>'version' =
                'unified-adaptive-benchmark-control-renewal-v1'
              and value.artifact_json->>'controlSha256' = artifact.sha256
              and value.artifact_json->>'leaseOwner' =
                artifact.artifact_json->>'leaseOwner'
            order by value.created_at desc, value.sha256 desc
            limit 1
         ) renewal on true
        where artifact.kind = 'adaptive_benchmark_control'
          and greatest(
            case
              when artifact.artifact_json->>'expiresAt' ~
                '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
              then (
                artifact.artifact_json->>'expiresAt'
              )::timestamptz
              else '-infinity'::timestamptz
            end,
            coalesce(renewal.expires_at, '-infinity'::timestamptz)
          ) > $1
          and not exists (
            select 1 from unified_check_artifacts released
             where released.kind = 'adaptive_benchmark_control_release'
               and released.artifact_json->>'controlSha256' = artifact.sha256
          )
        limit 1`,
      [input.now.toISOString()]
    )).rows;
    if (active.length > 0) {
      throw new Error("unified_benchmark_control_lease_conflict");
    }
    await tx.query(
      `insert into unified_check_artifacts (
         sha256, created_by_run_id, kind, schema_version, artifact_json
       ) values ($1,$2,'adaptive_benchmark_control','1',$3::jsonb)`,
      [
        sha256,
        control.runPlans[0]!.runId,
        JSON.stringify(control)
      ]
    );
  });
  let released = false;
  return {
    control,
    sha256,
    async extendRunPlans(runPlans, addedAt) {
      const extension = {
        version: "unified-adaptive-benchmark-control-extension-v1",
        controlSha256: sha256,
        leaseOwner: control.leaseOwner,
        addedAt: addedAt.toISOString(),
        runPlans
      } as const;
      validateControl({
        ...control,
        runPlans: [...control.runPlans, ...runPlans]
      }, new Date(control.createdAt));
      const extensionSha256 = fingerprintCanonicalArtifact(extension);
      await input.db.transaction(async (tx) => {
        await tx.query(
          "select pg_advisory_xact_lock(hashtext($1))",
          ["unified-adaptive-benchmark-control"]
        );
        const current = (await tx.query(
          `select control.sha256
             from unified_check_artifacts control
            where control.sha256 = $1
              and control.kind = 'adaptive_benchmark_control'
              and control.artifact_json->>'leaseOwner' = $2
              and greatest(
                (control.artifact_json->>'expiresAt')::timestamptz,
                coalesce((
                  select max(
                    (renewal.artifact_json->>'expiresAt')::timestamptz
                  )
                    from unified_check_artifacts renewal
                   where renewal.kind =
                     'adaptive_benchmark_control_renewal'
                     and renewal.artifact_json->>'controlSha256' =
                       control.sha256
                     and renewal.artifact_json->>'leaseOwner' = $2
                     and renewal.artifact_json->>'expiresAt' ~
                       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                ), '-infinity'::timestamptz)
              ) > clock_timestamp()
              and not exists (
                select 1
                  from unified_check_artifacts released
                 where released.kind =
                   'adaptive_benchmark_control_release'
                   and released.artifact_json->>'controlSha256' =
                     control.sha256
              )
              and not exists (
                select 1
                  from unified_check_artifacts successor
                 where successor.kind = 'adaptive_benchmark_control'
                   and successor.sha256 <> control.sha256
                   and (
                     successor.created_at > control.created_at or
                     (
                       successor.created_at = control.created_at and
                       successor.sha256 > control.sha256
                     )
                   )
              )
            for update of control`,
          [sha256, control.leaseOwner]
        )).rows;
        if (current.length !== 1) {
          throw new Error(
            "unified_benchmark_control_extension_stale"
          );
        }
        const existingExtensions = (await tx.query(
          `select sha256, artifact_json
             from unified_check_artifacts
            where kind = 'adaptive_benchmark_control_extension'
              and artifact_json->>'controlSha256' = $1
              and artifact_json->>'leaseOwner' = $2
            order by created_at, sha256
            for update`,
          [sha256, control.leaseOwner]
        )).rows;
        const requestedRunIds = new Set(
          runPlans.map((plan) => plan.runId)
        );
        for (const row of existingExtensions) {
          if (String(row.sha256) === extensionSha256) return;
          const value = benchmarkRecord(
            row.artifact_json,
            "unified_benchmark_control_extension_invalid"
          );
          const plans = boundedArray(
            value.runPlans,
            "unified_benchmark_control_extension_invalid"
          ) as UnifiedAdaptiveBenchmarkControlV1["runPlans"];
          if (plans.some((plan) => requestedRunIds.has(plan.runId))) {
            throw new Error(
              "unified_benchmark_control_extension_conflict"
            );
          }
        }
        const boundRuns = (await tx.query(
          `select id
             from unified_check_runs
            where id = any($1::text[])
              and run_purpose = 'release_canary'
              and side_effect_policy = 'isolated'`,
          [runPlans.map((plan) => plan.runId)]
        )).rows;
        if (boundRuns.length !== runPlans.length) {
          throw new Error(
            "unified_benchmark_control_extension_run_binding_invalid"
          );
        }
        await tx.query(
          `insert into unified_check_artifacts (
             sha256, created_by_run_id, kind, schema_version,
             artifact_json
           ) values (
             $1,$2,'adaptive_benchmark_control_extension','1',$3::jsonb
           ) on conflict (sha256) do nothing`,
          [
            extensionSha256,
            runPlans[0]!.runId,
            JSON.stringify(extension)
          ]
        );
      });
    },
    async renew(expiresAt) {
      if (released) {
        throw new Error("unified_benchmark_control_renew_invalid");
      }
      const renewalNow = new Date();
      await renewUnifiedAdaptiveBenchmarkControl({
        db: input.db,
        controlSha256: sha256,
        leaseOwner: control.leaseOwner,
        createdByRunId: control.runPlans[0]!.runId,
        now: renewalNow,
        expiresAt
      });
    },
    async release() {
      if (released) return;
      await releaseUnifiedAdaptiveBenchmarkControl({
        db: input.db,
        controlSha256: sha256,
        leaseOwner: control.leaseOwner,
        createdByRunId: control.runPlans[0]!.runId,
        releasedAt: new Date()
      });
      released = true;
    }
  };
}

function validateControl(
  control: UnifiedAdaptiveBenchmarkControlV1,
  now: Date
): void {
  const raw = exactKeys(control, [
    "version",
    "leaseOwner",
    "createdAt",
    "expiresAt",
    "runtimeCommit",
    "providerConfigurationSha256",
    "capacity",
    "auditedGroupIds",
    "runPlans"
  ], "unified_benchmark_control_invalid");
  boundedText(raw.leaseOwner, "unified_benchmark_control_invalid");
  const auditedGroupIds = boundedArray(
    raw.auditedGroupIds,
    "unified_benchmark_control_invalid"
  );
  const runPlans = boundedArray(
    raw.runPlans,
    "unified_benchmark_control_invalid"
  );
  if (
    auditedGroupIds.some((groupId) =>
      typeof groupId !== "string" ||
      groupId.length < 1 ||
      groupId.length > MAX_BENCHMARK_TEXT
    ) ||
    runPlans.some((plan) => {
      const value = exactKeys(plan, [
        "runId",
        "scenarioId",
        "fault",
        "faultUntil"
      ], "unified_benchmark_control_invalid");
      return typeof value.runId !== "string" ||
        value.runId.length < 1 ||
        value.runId.length > MAX_BENCHMARK_TEXT ||
        typeof value.scenarioId !== "string" ||
        value.scenarioId.length < 1 ||
        value.scenarioId.length > MAX_BENCHMARK_TEXT;
    })
  ) {
    throw new Error("unified_benchmark_control_invalid");
  }
  if (
    control.version !== "unified-adaptive-benchmark-control-v1" ||
    !control.leaseOwner.trim() ||
    !/^[0-9a-f]{40}$/u.test(control.runtimeCommit) ||
    !HASH.test(control.providerConfigurationSha256) ||
    !Number.isSafeInteger(control.capacity) ||
    control.capacity < 1 ||
    control.auditedGroupIds.length < control.capacity ||
    new Set(control.auditedGroupIds).size !==
      control.auditedGroupIds.length ||
    control.runPlans.length < 1 ||
    new Set(control.runPlans.map((plan) => plan.runId)).size !==
      control.runPlans.length ||
    !Number.isFinite(Date.parse(control.createdAt)) ||
    !Number.isFinite(Date.parse(control.expiresAt)) ||
    Date.parse(control.createdAt) > now.getTime() ||
    Date.parse(control.expiresAt) <= now.getTime() ||
    control.runPlans.some((plan) =>
      !plan.runId.trim() ||
      !plan.scenarioId.trim() ||
      ![
        "none",
        "provider_cooldown",
        "slow_canonical_head",
        "merge_buffer_full",
        "late_interactive",
        "restart_recovery"
      ].includes(plan.fault) ||
      (
        plan.fault === "none"
          ? plan.faultUntil !== null
          : plan.faultUntil === null ||
            !Number.isFinite(Date.parse(plan.faultUntil)) ||
            Date.parse(plan.faultUntil) <= Date.parse(control.createdAt)
      )
    )
  ) {
    throw new Error("unified_benchmark_control_invalid");
  }
}

export function parseUnifiedAdaptiveBenchmarkControlV1(
  rawCanonicalJson: string
): UnifiedAdaptiveBenchmarkControlV1 {
  const parsed = JSON.parse(
    rawCanonicalJson
  ) as UnifiedAdaptiveBenchmarkControlV1;
  if (canonicalizeArtifactJson(parsed) !== rawCanonicalJson) {
    throw new Error("unified_benchmark_control_noncanonical");
  }
  validateControl(parsed, new Date(parsed.createdAt));
  return parsed;
}

export async function loadUnifiedAdaptiveBenchmarkControl(
  db: UnifiedQueryable,
  input: {
    readonly now: Date;
    readonly runtimeCommit: string;
    readonly providerConfigurationSha256: string;
  }
): Promise<LoadedUnifiedAdaptiveBenchmarkControl | null> {
  const row = (await db.query(
    `select artifact.sha256, artifact.artifact_json,
            greatest(
              (artifact.artifact_json->>'expiresAt')::timestamptz,
              coalesce(renewal.expires_at, '-infinity'::timestamptz)
            ) as effective_expires_at
       from unified_check_artifacts artifact
       left join lateral (
         select case
                  when value.artifact_json->>'expiresAt' ~
                    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                  then (
                    value.artifact_json->>'expiresAt'
                  )::timestamptz
                  else '-infinity'::timestamptz
                end as expires_at
           from unified_check_artifacts value
          where value.kind = 'adaptive_benchmark_control_renewal'
            and value.artifact_json->>'version' =
              'unified-adaptive-benchmark-control-renewal-v1'
            and value.artifact_json->>'controlSha256' = artifact.sha256
            and value.artifact_json->>'leaseOwner' =
              artifact.artifact_json->>'leaseOwner'
          order by value.created_at desc, value.sha256 desc
          limit 1
       ) renewal on true
      where artifact.kind = 'adaptive_benchmark_control'
        and greatest(
          case
            when artifact.artifact_json->>'expiresAt' ~
              '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            then (
              artifact.artifact_json->>'expiresAt'
            )::timestamptz
            else '-infinity'::timestamptz
          end,
          coalesce(renewal.expires_at, '-infinity'::timestamptz)
        ) > $1
        and artifact.artifact_json->>'runtimeCommit' = $2
        and artifact.artifact_json->>'providerConfigurationSha256' = $3
        and not exists (
          select 1 from unified_check_artifacts released
           where released.kind = 'adaptive_benchmark_control_release'
             and released.artifact_json->>'controlSha256' = artifact.sha256
        )
      order by artifact.created_at desc, artifact.sha256
      limit 2`,
    [
      input.now,
      input.runtimeCommit,
      input.providerConfigurationSha256
    ]
  )).rows;
  if (row.length === 0) return null;
  if (row.length !== 1) return null;
  let control =
    row[0]!.artifact_json as UnifiedAdaptiveBenchmarkControlV1;
  validateControl(control, new Date(control.createdAt));
  if (
    unifiedAdaptiveBenchmarkControlHash(control) !==
      String(row[0]!.sha256)
  ) {
    throw new Error("unified_benchmark_control_hash_mismatch");
  }
  const extensionRows = (await db.query(
    `select sha256, artifact_json
       from unified_check_artifacts
      where kind = 'adaptive_benchmark_control_extension'
        and artifact_json->>'controlSha256' = $1
        and artifact_json->>'leaseOwner' = $2
      order by created_at, sha256`,
    [String(row[0]!.sha256), control.leaseOwner]
  )).rows;
  const extendedPlans = [...control.runPlans];
  for (const extensionRow of extensionRows) {
    const extension = exactKeys(extensionRow.artifact_json, [
      "version",
      "controlSha256",
      "leaseOwner",
      "addedAt",
      "runPlans"
    ], "unified_benchmark_control_extension_invalid");
    const runPlans = boundedArray(
      extension.runPlans,
      "unified_benchmark_control_extension_invalid"
    ) as UnifiedAdaptiveBenchmarkControlV1["runPlans"];
    if (
      extension.version !==
        "unified-adaptive-benchmark-control-extension-v1" ||
      extension.controlSha256 !== String(row[0]!.sha256) ||
      extension.leaseOwner !== control.leaseOwner ||
      typeof extension.addedAt !== "string" ||
      !Number.isFinite(Date.parse(extension.addedAt)) ||
      fingerprintCanonicalArtifact(extension) !==
        String(extensionRow.sha256)
    ) {
      throw new Error("unified_benchmark_control_extension_invalid");
    }
    extendedPlans.push(...runPlans);
  }
  control = { ...control, runPlans: extendedPlans };
  validateControl(control, new Date(control.createdAt));
  const boundRuns = (await db.query(
    `select id
       from unified_check_runs
      where id = any($1::text[])
        and run_purpose = 'release_canary'
        and side_effect_policy = 'isolated'`,
    [control.runPlans.map((plan) => plan.runId)]
  )).rows;
  if (boundRuns.length !== control.runPlans.length) {
    throw new Error("unified_benchmark_control_run_binding_invalid");
  }
  const symptomRows = (await db.query(
    `select sha256, created_by_run_id, artifact_json
       from unified_check_artifacts
      where kind = 'adaptive_benchmark_scenario_symptom'
        and artifact_json->>'controlSha256' = $1
        and created_by_run_id = any($2::text[])
      order by created_at, sha256`,
    [
      String(row[0]!.sha256),
      control.runPlans.map((plan) => plan.runId)
    ]
  )).rows;
  const plansByRunId = new Map(control.runPlans.map((plan) => [
    plan.runId,
    plan
  ]));
  const expectedPhaseByFault = {
    none: "run_completed",
    provider_cooldown: "audited_group_cooldown_observed",
    slow_canonical_head: "canonical_head_delay_observed",
    merge_buffer_full: "merge_buffer_full_observed",
    late_interactive: "late_after_peer_checkpoint",
    restart_recovery: "external_runtime_restart_attested"
  } as const;
  const acknowledgedRunIds = [...new Set(symptomRows.flatMap((item) => {
    const symptom =
      item.artifact_json as UnifiedAdaptiveBenchmarkScenarioSymptomV1;
    const runId = String(item.created_by_run_id);
    const plan = plansByRunId.get(runId);
    if (
      plan === undefined ||
      symptom.controlSha256 !== String(row[0]!.sha256) ||
      symptom.runId !== runId ||
      symptom.scenarioId !== plan.scenarioId ||
      symptom.phase !== (
        plan.scenarioId === "late_interactive"
          ? "late_after_peer_checkpoint"
          : expectedPhaseByFault[plan.fault]
      ) ||
      fingerprintCanonicalArtifact(symptom) !== String(item.sha256)
    ) {
      return [];
    }
    return [runId];
  }))].sort();
  return {
    sha256: String(row[0]!.sha256),
    control,
    acknowledgedRunIds
  };
}

export function applyUnifiedAdaptiveBenchmarkControl(input: {
  readonly demand: readonly ProviderRunDemand[];
  readonly providerSlots: readonly UnifiedProviderSlotSnapshot[];
  readonly control: UnifiedAdaptiveBenchmarkControlV1 | null;
  readonly acknowledgedRunIds: readonly string[];
  readonly now: Date;
}): ProviderRunDemand[] {
  if (input.control === null) return [...input.demand];
  const controlledRunIds = new Set(
    input.control.runPlans.map((plan) => plan.runId)
  );
  const activeControlledSlots = input.providerSlots.filter((slot) =>
    slot.active &&
    slot.activePermit !== null &&
    controlledRunIds.has(slot.activePermit.runId)
  ).length;
  let remaining = Math.max(
    0,
    input.control.capacity - activeControlledSlots
  );
  const planByRun = new Map(
    input.control.runPlans.map((plan) => [plan.runId, plan])
  );
  return input.demand.map((item) => {
    const plan = planByRun.get(item.runId);
    if (!plan) return item;
    const eligibleReadyWork = Math.min(
      item.eligibleReadyWork,
      remaining
    );
    remaining -= eligibleReadyWork;
    return {
      ...item,
      eligibleReadyWork,
      providerAvailable: item.providerAvailable,
      providerBlocker: item.providerBlocker,
      canonicalHeadEligible: item.canonicalHeadEligible,
      mergeBufferFull: item.mergeBufferFull
    };
  });
}

export function isUnifiedBenchmarkCooldownSymptomReady(input: {
  readonly capacity: number;
  readonly controlSha256: string;
  readonly auditedGroupIds: readonly string[];
  readonly nowMs: number;
  readonly cooldown: {
    readonly controlSha256: string;
    readonly groupId: string;
    readonly endsAtMs: number;
    readonly fallbackDispatches: number;
    readonly resumedDispatches: number;
    readonly activeObserved: boolean;
  } | null;
}): boolean {
  const value = input.cooldown;
  if (
    value === null ||
    !Number.isSafeInteger(input.capacity) ||
    input.capacity < 1 ||
    value.controlSha256 !== input.controlSha256 ||
    !input.auditedGroupIds.includes(value.groupId) ||
    !value.activeObserved ||
    input.nowMs < value.endsAtMs ||
    value.resumedDispatches < 1
  ) {
    return false;
  }
  return input.capacity === 1 || value.fallbackDispatches > 0;
}

export function isUnifiedBenchmarkSlowHeadSymptomReady(input: {
  readonly controlSha256: string;
  readonly committed: boolean;
  readonly faultUntilMs: number;
  readonly acceptedAttempt: {
    readonly taskId: string;
    readonly canonicalSequence: number;
    readonly attempt: number;
    readonly completedAtMs: number;
  } | null;
  readonly delay: {
    readonly controlSha256: string;
    readonly taskId: string;
    readonly canonicalSequence: number;
    readonly activeObserved: boolean;
    readonly resumedDispatches: number;
    readonly resumedSuccessfulOutcomes: number;
    readonly successfulAttemptNumbers: readonly number[];
  } | null;
}): boolean {
  return input.delay !== null &&
    input.acceptedAttempt !== null &&
    input.delay.controlSha256 === input.controlSha256 &&
    input.delay.taskId.trim().length > 0 &&
    Number.isSafeInteger(input.delay.canonicalSequence) &&
    input.delay.canonicalSequence >= 0 &&
    input.acceptedAttempt.taskId === input.delay.taskId &&
    input.acceptedAttempt.canonicalSequence ===
      input.delay.canonicalSequence &&
    Number.isSafeInteger(input.acceptedAttempt.attempt) &&
    input.acceptedAttempt.attempt > 0 &&
    Number.isFinite(input.acceptedAttempt.completedAtMs) &&
    input.acceptedAttempt.completedAtMs >= input.faultUntilMs &&
    input.delay.successfulAttemptNumbers.includes(
      input.acceptedAttempt.attempt
    ) &&
    input.delay.activeObserved &&
    input.delay.resumedDispatches > 0 &&
    input.delay.resumedSuccessfulOutcomes > 0 &&
    input.committed;
}

function finiteNonNegative(value: number, code: string): void {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(code);
}

function safeCount(value: number, code: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(code);
  }
}

function validateObservation(
  observation: UnifiedAdaptiveBenchmarkRuntimeObservationV1
): void {
  const raw = exactKeys(observation, [
    "version",
    "controlSha256",
    "observedAt",
    "runtime",
    "provider",
    "reuse",
    "integrity",
    "database",
    "lifecycle",
    "runs"
  ], "unified_benchmark_observation_invalid");
  exactKeys(raw.runtime, [
    "rssHeapScope",
    "availableMemoryScope",
    "instanceId",
    "processStartedAt",
    "processId",
    "rssBytes",
    "heapUsedBytes",
    "availableContainerBytes",
    "availableHostBytes"
  ], "unified_benchmark_observation_invalid");
  const runtime = raw.runtime as Record<string, unknown>;
  boundedText(
    runtime.instanceId,
    "unified_benchmark_observation_invalid"
  );
  const provider = exactKeys(raw.provider, [
    "requests",
    "completed",
    "errors",
    "rateLimited429",
    "requestsPerSecond",
    "dispatchedGroupIds"
  ], "unified_benchmark_observation_invalid");
  const dispatchedGroups = boundedArray(
    provider.dispatchedGroupIds,
    "unified_benchmark_observation_invalid"
  );
  if (dispatchedGroups.some((groupId) =>
    typeof groupId !== "string" ||
    groupId.length < 1 ||
    groupId.length > MAX_BENCHMARK_TEXT
  )) {
    throw new TypeError("unified_benchmark_observation_invalid");
  }
  exactKeys(raw.reuse, [
    "providerCacheHits",
    "networkFetches",
    "addressManifestReuses",
    "addressHistoryReplaysAvoided"
  ], "unified_benchmark_observation_invalid");
  exactKeys(raw.integrity, [
    "duplicateCommits",
    "duplicateSequences",
    "deliveryIntents"
  ], "unified_benchmark_observation_invalid");
  exactKeys(raw.database, [
    "scope",
    "latencyMs",
    "checkpointLatencyMs",
    "poolWaitMs"
  ], "unified_benchmark_observation_invalid");
  exactKeys(raw.lifecycle, [
    "restartRunId",
    "checkpointObservationSha256",
    "restartCount",
    "recoveryMs",
    "reconciliationRecoveries"
  ], "unified_benchmark_observation_invalid");
  const rawRuns = boundedArray(
    raw.runs,
    "unified_benchmark_observation_invalid"
  );
  for (const rawRun of rawRuns) {
    const run = exactKeys(rawRun, [
      "runId",
      "scenarioId",
      "planner",
      "buffer",
      "canonicalHeadAgeMs",
      "capacity",
      "limitingReason"
    ], "unified_benchmark_observation_invalid");
    boundedText(run.runId, "unified_benchmark_observation_invalid");
    boundedText(
      run.scenarioId,
      "unified_benchmark_observation_invalid"
    );
    exactKeys(run.planner, [
      "durableBacklog",
      "admitted",
      "leased",
      "ready",
      "committed"
    ], "unified_benchmark_observation_invalid");
    exactKeys(run.buffer, [
      "readyCount",
      "readyBytes",
      "reservedBytes"
    ], "unified_benchmark_observation_invalid");
    exactKeys(run.capacity, [
      "eligibleDemand",
      "targetSlots",
      "actualSlots"
    ], "unified_benchmark_observation_invalid");
    if (run.limitingReason !== null) {
      const reason = exactKeys(run.limitingReason, [
        "scope",
        "code"
      ], "unified_benchmark_observation_invalid");
      if (
        !["pool", "run", "task"].includes(String(reason.scope)) ||
        ![
          "no_eligible_work",
          "fairness_wait",
          "admission_closed",
          "provider_rate_paced",
          "provider_cooldown",
          "provider_circuit_open",
          "canonical_head_wait",
          "merge_buffer_full",
          "db_pressure",
          "memory_pressure",
          "class_capacity_limit",
          "repair_reserve_reclaim",
          "background_preempted",
          "reconciliation_wait"
        ].includes(String(reason.code))
      ) {
        throw new TypeError("unified_benchmark_observation_invalid");
      }
    }
  }
  if (
    observation.version !==
      "unified-adaptive-benchmark-runtime-observation-v1" ||
    !HASH.test(observation.controlSha256) ||
    !Number.isFinite(Date.parse(observation.observedAt)) ||
    observation.runs.length < 1 ||
    new Set(observation.runs.map((run) => run.runId)).size !==
      observation.runs.length
  ) {
    throw new TypeError("unified_benchmark_observation_invalid");
  }
  finiteNonNegative(
    observation.database.latencyMs,
    "unified_benchmark_observation_database_invalid"
  );
  for (const value of [
    observation.runtime.processId,
    observation.runtime.rssBytes,
    observation.runtime.heapUsedBytes,
    observation.runtime.availableContainerBytes,
    observation.runtime.availableHostBytes,
    observation.provider.requests,
    observation.provider.completed,
    observation.provider.errors,
    observation.provider.rateLimited429,
    observation.reuse.providerCacheHits,
    observation.reuse.networkFetches,
    observation.reuse.addressManifestReuses,
    observation.reuse.addressHistoryReplaysAvoided,
    observation.integrity.duplicateCommits,
    observation.integrity.duplicateSequences,
    observation.integrity.deliveryIntents
  ]) {
    safeCount(value, "unified_benchmark_observation_telemetry_invalid");
  }
  finiteNonNegative(
    observation.provider.requestsPerSecond,
    "unified_benchmark_observation_telemetry_invalid"
  );
  if (
    !observation.runtime.instanceId.trim() ||
    observation.runtime.rssHeapScope !== "process" ||
    observation.runtime.availableMemoryScope !== "container_or_host" ||
    observation.database.scope !==
      "benchmark_runtime_connection_pool" ||
    observation.runtime.processId < 1 ||
    !Number.isFinite(Date.parse(observation.runtime.processStartedAt)) ||
    observation.provider.completed > observation.provider.requests ||
    observation.provider.errors > observation.provider.requests ||
    observation.provider.rateLimited429 > observation.provider.errors ||
    new Set(observation.provider.dispatchedGroupIds).size !==
      observation.provider.dispatchedGroupIds.length ||
    observation.provider.dispatchedGroupIds.some((id) => !id.trim())
  ) {
    throw new TypeError("unified_benchmark_observation_telemetry_invalid");
  }
  finiteNonNegative(
    observation.database.checkpointLatencyMs,
    "unified_benchmark_observation_checkpoint_invalid"
  );
  finiteNonNegative(
    observation.database.poolWaitMs,
    "unified_benchmark_observation_pool_wait_invalid"
  );
  safeCount(
    observation.lifecycle.restartCount,
    "unified_benchmark_observation_lifecycle_invalid"
  );
  safeCount(
    observation.lifecycle.reconciliationRecoveries,
    "unified_benchmark_observation_lifecycle_invalid"
  );
  finiteNonNegative(
    observation.lifecycle.recoveryMs,
    "unified_benchmark_observation_lifecycle_invalid"
  );
  if (
    (
      observation.lifecycle.restartCount === 0 &&
      (
        observation.lifecycle.restartRunId !== null ||
        observation.lifecycle.checkpointObservationSha256 !== null ||
        observation.lifecycle.recoveryMs !== 0 ||
        observation.lifecycle.reconciliationRecoveries !== 0
      )
    ) ||
    (
      observation.lifecycle.restartCount > 0 &&
      (
        observation.lifecycle.restartRunId === null ||
        observation.lifecycle.checkpointObservationSha256 === null ||
        !HASH.test(
          observation.lifecycle.checkpointObservationSha256
        ) ||
        !observation.runs.some((run) =>
          run.runId === observation.lifecycle.restartRunId
        ) ||
        observation.lifecycle.reconciliationRecoveries >
          observation.lifecycle.restartCount
      )
    )
  ) {
    throw new TypeError(
      "unified_benchmark_observation_lifecycle_invalid"
    );
  }
  for (const run of observation.runs) {
    if (!run.runId.trim() || !run.scenarioId.trim()) {
      throw new TypeError("unified_benchmark_observation_run_invalid");
    }
    for (const value of Object.values(run.planner)) {
      safeCount(
        value,
        "unified_benchmark_observation_planner_invalid"
      );
    }
    for (const value of Object.values(run.buffer)) {
      safeCount(
        value,
        "unified_benchmark_observation_buffer_invalid"
      );
    }
    if (
      run.canonicalHeadAgeMs !== null &&
      (!Number.isFinite(run.canonicalHeadAgeMs) ||
        run.canonicalHeadAgeMs < 0)
    ) {
      throw new TypeError(
        "unified_benchmark_observation_canonical_head_invalid"
      );
    }
    for (const value of Object.values(run.capacity)) {
      safeCount(
        value,
        "unified_benchmark_observation_capacity_invalid"
      );
    }
  }
}

export function parseUnifiedAdaptiveBenchmarkRuntimeObservationV1(
  rawCanonicalJson: string
): UnifiedAdaptiveBenchmarkRuntimeObservationV1 {
  const parsed = JSON.parse(
    rawCanonicalJson
  ) as UnifiedAdaptiveBenchmarkRuntimeObservationV1;
  if (canonicalizeArtifactJson(parsed) !== rawCanonicalJson) {
    throw new Error("unified_benchmark_observation_noncanonical");
  }
  validateObservation(parsed);
  return parsed;
}

export async function persistUnifiedAdaptiveBenchmarkObservation(input: {
  readonly db: UnifiedQueryable;
  readonly createdByRunId: string;
  readonly observation: UnifiedAdaptiveBenchmarkRuntimeObservationV1;
}): Promise<string> {
  validateObservation(input.observation);
  if (
    !input.observation.runs.some((run) =>
      run.runId === input.createdByRunId
    )
  ) {
    throw new Error("unified_benchmark_observation_creator_unbound");
  }
  const sha256 = fingerprintCanonicalArtifact(input.observation);
  await input.db.query(
    `insert into unified_check_artifacts (
       sha256, created_by_run_id, kind, schema_version, artifact_json
     ) values (
       $1,$2,'adaptive_benchmark_runtime_observation','1',$3::jsonb
     )
     on conflict (sha256) do nothing`,
    [
      sha256,
      input.createdByRunId,
      JSON.stringify(input.observation)
    ]
  );
  return sha256;
}

export async function persistUnifiedAdaptiveBenchmarkScenarioSymptom(input: {
  readonly db: UnifiedQueryable;
  readonly createdByRunId: string;
  readonly symptom: UnifiedAdaptiveBenchmarkScenarioSymptomV1;
}): Promise<string> {
  const value = input.symptom;
  validateScenarioSymptom(value);
  if (value.runId !== input.createdByRunId) {
    throw new TypeError("unified_benchmark_scenario_symptom_invalid");
  }
  const sha256 = fingerprintCanonicalArtifact(value);
  await input.db.query(
    `insert into unified_check_artifacts (
       sha256, created_by_run_id, kind, schema_version, artifact_json
     ) values (
       $1,$2,'adaptive_benchmark_scenario_symptom','1',$3::jsonb
     ) on conflict (sha256) do nothing`,
    [sha256, input.createdByRunId, JSON.stringify(value)]
  );
  return sha256;
}

function validateScenarioSymptom(
  value: UnifiedAdaptiveBenchmarkScenarioSymptomV1
): void {
  const raw = exactKeys(value, [
    "version",
    "controlSha256",
    "runId",
    "scenarioId",
    "phase",
    "observedAt",
    "observationArtifactSha256",
    "runtimeInstanceId",
    "runtimeProcessStartedAt",
    "runtimeProcessId",
    ...(value.providerCooldown === undefined
      ? []
      : ["providerCooldown"]),
    ...(value.slowHeadAcceptance === undefined
      ? []
      : ["slowHeadAcceptance"]),
    ...(value.restartHandoff === undefined
      ? []
      : ["restartHandoff"])
  ], "unified_benchmark_scenario_symptom_invalid");
  for (const text of [
    raw.runId,
    raw.scenarioId,
    raw.runtimeInstanceId
  ]) {
    boundedText(
      text,
      "unified_benchmark_scenario_symptom_invalid"
    );
  }
  if (raw.providerCooldown !== undefined) {
    exactKeys(raw.providerCooldown, [
      "groupId",
      "startsAt",
      "endsAt",
      "fallbackDispatches",
      "resumedDispatches",
      "activeObserved",
      "synthetic",
      "provider429Observed"
    ], "unified_benchmark_scenario_symptom_invalid");
  }
  if (raw.restartHandoff !== undefined) {
    exactKeys(raw.restartHandoff, [
      "requestedAt",
      "previousRuntimeInstanceId",
      "previousRuntimeProcessStartedAt",
      "previousRuntimeProcessId",
      "checkpointObservationSha256",
      "reconciliationArtifactSha256"
    ], "unified_benchmark_scenario_symptom_invalid");
  }
  if (raw.slowHeadAcceptance !== undefined) {
    const rawSlowHead = exactKeys(raw.slowHeadAcceptance, [
      "taskId",
      "canonicalSequence",
      "attemptId",
      "artifactSha256",
      "completedAt"
    ], "unified_benchmark_scenario_symptom_invalid");
    boundedText(
      rawSlowHead.taskId,
      "unified_benchmark_scenario_symptom_invalid"
    );
    boundedText(
      rawSlowHead.attemptId,
      "unified_benchmark_scenario_symptom_invalid"
    );
  }
  const cooldown = value.providerCooldown;
  const slowHead = value.slowHeadAcceptance;
  const restart = value.restartHandoff;
  const expectedPhase = value.scenarioId === "provider_cooldown"
    ? "audited_group_cooldown_observed"
    : value.scenarioId === "slow_canonical_head"
      ? "canonical_head_delay_observed"
      : value.scenarioId === "full_merge_buffer"
        ? "merge_buffer_full_observed"
        : value.scenarioId === "late_interactive"
          ? "late_after_peer_checkpoint"
          : value.scenarioId === "restart_recovery"
            ? "external_runtime_restart_attested"
            : "run_completed";
  if (
    value.version !==
      "unified-adaptive-benchmark-scenario-symptom-v1" ||
    !HASH.test(value.controlSha256) ||
    !HASH.test(value.observationArtifactSha256) ||
    !value.runId.trim() ||
    !value.scenarioId.trim() ||
    !value.runtimeInstanceId.trim() ||
    !Number.isSafeInteger(value.runtimeProcessId) ||
    value.runtimeProcessId < 1 ||
    !Number.isFinite(Date.parse(value.runtimeProcessStartedAt)) ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    value.phase !== expectedPhase ||
    ![
      "run_completed",
      "late_after_peer_checkpoint",
      "audited_group_cooldown_observed",
      "canonical_head_delay_observed",
      "merge_buffer_full_observed",
      "external_runtime_restart_attested"
    ].includes(value.phase) ||
    (
      value.phase === "audited_group_cooldown_observed"
        ? (
            cooldown === undefined ||
            !cooldown.groupId.trim() ||
            !Number.isFinite(Date.parse(cooldown.startsAt)) ||
            !Number.isFinite(Date.parse(cooldown.endsAt)) ||
            Date.parse(cooldown.endsAt) <= Date.parse(cooldown.startsAt) ||
            !Number.isSafeInteger(cooldown.fallbackDispatches) ||
            cooldown.fallbackDispatches < 0 ||
            !Number.isSafeInteger(cooldown.resumedDispatches) ||
            cooldown.resumedDispatches < 0 ||
            cooldown.fallbackDispatches + cooldown.resumedDispatches < 1 ||
            cooldown.activeObserved !== true ||
            cooldown.synthetic !== true ||
            cooldown.provider429Observed !== false
          )
        : cooldown !== undefined
    ) ||
    (
      value.phase === "canonical_head_delay_observed"
        ? (
            slowHead === undefined ||
            !slowHead.taskId.trim() ||
            !Number.isSafeInteger(slowHead.canonicalSequence) ||
            slowHead.canonicalSequence < 0 ||
            !slowHead.attemptId.trim() ||
            !HASH.test(slowHead.artifactSha256) ||
            !Number.isFinite(Date.parse(slowHead.completedAt)) ||
            Date.parse(slowHead.completedAt) > Date.parse(value.observedAt)
          )
        : slowHead !== undefined
    ) ||
    (
      value.phase === "external_runtime_restart_attested"
        ? (
            restart === undefined ||
            !Number.isFinite(Date.parse(restart.requestedAt)) ||
            !restart.previousRuntimeInstanceId.trim() ||
            !Number.isFinite(Date.parse(
              restart.previousRuntimeProcessStartedAt
            )) ||
            !Number.isSafeInteger(restart.previousRuntimeProcessId) ||
            restart.previousRuntimeProcessId < 1 ||
            !HASH.test(restart.checkpointObservationSha256) ||
            !HASH.test(restart.reconciliationArtifactSha256)
          )
        : restart !== undefined
    )
  ) {
    throw new TypeError("unified_benchmark_scenario_symptom_invalid");
  }
}

export function parseUnifiedAdaptiveBenchmarkScenarioSymptomV1(
  rawCanonicalJson: string
): UnifiedAdaptiveBenchmarkScenarioSymptomV1 {
  const parsed = JSON.parse(
    rawCanonicalJson
  ) as UnifiedAdaptiveBenchmarkScenarioSymptomV1;
  if (canonicalizeArtifactJson(parsed) !== rawCanonicalJson) {
    throw new Error("unified_benchmark_scenario_symptom_noncanonical");
  }
  validateScenarioSymptom(parsed);
  return parsed;
}

export async function listUnifiedAdaptiveBenchmarkScenarioSymptoms(input: {
  readonly db: UnifiedQueryable;
  readonly controlSha256: string;
  readonly runIds: readonly string[];
}): Promise<readonly UnifiedAdaptiveBenchmarkScenarioSymptomArtifactV1[]> {
  if (
    !HASH.test(input.controlSha256) ||
    input.runIds.length < 1 ||
    input.runIds.some((runId) => !runId.trim())
  ) {
    throw new TypeError("unified_benchmark_scenario_symptom_query_invalid");
  }
  const rows = (await input.db.query(
    `select sha256, artifact_json
       from unified_check_artifacts
      where kind = 'adaptive_benchmark_scenario_symptom'
        and artifact_json->>'controlSha256' = $1
        and created_by_run_id = any($2::text[])
      order by created_at, sha256`,
    [input.controlSha256, input.runIds]
  )).rows;
  return rows.map((row) => {
    const symptom =
      row.artifact_json as UnifiedAdaptiveBenchmarkScenarioSymptomV1;
    validateScenarioSymptom(symptom);
    const sha256 = String(row.sha256);
    if (
      symptom.controlSha256 !== input.controlSha256 ||
      !input.runIds.includes(symptom.runId) ||
      !HASH.test(sha256) ||
      fingerprintCanonicalArtifact(symptom) !== sha256
    ) {
      throw new Error("unified_benchmark_scenario_symptom_binding_invalid");
    }
    return { sha256, symptom };
  });
}

export async function listUnifiedAdaptiveBenchmarkObservationArtifacts(input: {
  readonly db: UnifiedQueryable;
  readonly controlSha256: string;
  readonly runIds: readonly string[];
}): Promise<UnifiedAdaptiveBenchmarkRuntimeObservationArtifactV1[]> {
  if (
    !HASH.test(input.controlSha256) ||
    input.runIds.length < 1 ||
    input.runIds.some((runId) => !runId.trim())
  ) {
    throw new TypeError("unified_benchmark_observation_query_invalid");
  }
  const rows = (await input.db.query(
    `select sha256, artifact_json
       from unified_check_artifacts
      where kind = 'adaptive_benchmark_runtime_observation'
        and artifact_json->>'controlSha256' = $1
        and created_by_run_id = any($2::text[])
      order by created_at, sha256`,
    [input.controlSha256, input.runIds]
  )).rows;
  return rows.map((row) => {
    const observation =
      row.artifact_json as UnifiedAdaptiveBenchmarkRuntimeObservationV1;
    validateObservation(observation);
    if (
      observation.controlSha256 !== input.controlSha256 ||
      observation.runs.some((run) => !input.runIds.includes(run.runId))
    ) {
      throw new Error("unified_benchmark_observation_binding_invalid");
    }
    const sha256 = String(row.sha256);
    if (
      !HASH.test(sha256) ||
      fingerprintCanonicalArtifact(observation) !== sha256
    ) {
      throw new Error("unified_benchmark_observation_hash_mismatch");
    }
    return { sha256, observation };
  });
}

export async function listUnifiedAdaptiveBenchmarkObservations(input: {
  readonly db: UnifiedQueryable;
  readonly controlSha256: string;
  readonly runIds: readonly string[];
}): Promise<UnifiedAdaptiveBenchmarkRuntimeObservationV1[]> {
  return (await listUnifiedAdaptiveBenchmarkObservationArtifacts(input))
    .map((artifact) => artifact.observation);
}

const REFILL_PHASES = [
  "chunkToCheckpoint",
  "checkpointToController",
  "controllerToPermit",
  "permitToClaim",
  "checkpointToClaim"
] as const;

function validateRefillMetric(value: unknown): void {
  const metric = exactKeys(value, [
    "p50",
    "p95",
    "max",
    "sampleCount"
  ], "unified_provider_refill_observation_invalid");
  safeCount(
    Number(metric.sampleCount),
    "unified_provider_refill_observation_invalid"
  );
  const sampleCount = Number(metric.sampleCount);
  const percentiles = [metric.p50, metric.p95, metric.max];
  if (sampleCount === 0) {
    if (percentiles.some((item) => item !== null)) {
      throw new TypeError("unified_provider_refill_observation_invalid");
    }
    return;
  }
  if (percentiles.some((item) =>
    typeof item !== "number" || !Number.isFinite(item) || item < 0
  )) {
    throw new TypeError("unified_provider_refill_observation_invalid");
  }
  const [p50, p95, maximum] = percentiles as number[];
  if (p50! > p95! || p95! > maximum!) {
    throw new TypeError("unified_provider_refill_observation_invalid");
  }
}

function validateProviderRefillObservation(
  observation: UnifiedProviderRefillObservationV1
): void {
  const raw = exactKeys(observation, [
    "version",
    "controlSha256",
    "observedAt",
    "runtimeCommit",
    "providerConfigurationSha256",
    "diagnostics",
    "saturated",
    "memoryEvidence"
  ], "unified_provider_refill_observation_invalid");
  const diagnostics = exactKeys(raw.diagnostics, [
    "version",
    "assignments",
    "phases",
    "diagnostics"
  ], "unified_provider_refill_observation_invalid");
  const assignments = exactKeys(diagnostics.assignments, [
    "proposed",
    "accepted",
    "rejected",
    "rejections"
  ], "unified_provider_refill_observation_invalid");
  const rejections = exactKeys(assignments.rejections, [
    "draining",
    "slotActive",
    "pendingAssignment",
    "staleEpoch"
  ], "unified_provider_refill_observation_invalid");
  const phases = exactKeys(
    diagnostics.phases,
    REFILL_PHASES,
    "unified_provider_refill_observation_invalid"
  );
  const diagnosticCounts = exactKeys(diagnostics.diagnostics, [
    "incomplete",
    "evictedIncomplete",
    "discontinuities",
    "invalidClocks"
  ], "unified_provider_refill_observation_invalid");
  const saturated = exactKeys(raw.saturated, [
    "sampleCount",
    "activeSlotSum",
    "fourOfFourSamples",
    "unexplainedIdleSamples"
  ], "unified_provider_refill_observation_invalid");
  const memoryEvidence = exactKeys(raw.memoryEvidence, [
    "samplesSha256",
    "summarySha256",
    "diagnosticStatus"
  ], "unified_provider_refill_observation_invalid");
  for (const phase of REFILL_PHASES) validateRefillMetric(phases[phase]);
  for (const value of [
    assignments.proposed,
    assignments.accepted,
    assignments.rejected,
    ...Object.values(rejections),
    ...Object.values(diagnosticCounts),
    ...Object.values(saturated)
  ]) {
    if (typeof value !== "number") {
      throw new TypeError("unified_provider_refill_observation_invalid");
    }
    safeCount(value, "unified_provider_refill_observation_invalid");
  }
  if (
    observation.version !== "unified-provider-refill-observation-v1" ||
    diagnostics.version !== "unified-provider-refill-diagnostics-v1" ||
    !HASH.test(observation.controlSha256) ||
    !/^[0-9a-f]{40}$/u.test(observation.runtimeCommit) ||
    !HASH.test(observation.providerConfigurationSha256) ||
    !Number.isFinite(Date.parse(observation.observedAt)) ||
    Number(assignments.proposed) !==
      Number(assignments.accepted) + Number(assignments.rejected) ||
    Number(assignments.rejected) !== Object.values(rejections)
      .reduce<number>((sum, value) => sum + Number(value), 0) ||
    Number(saturated.activeSlotSum) >
      Number(saturated.sampleCount) * 4 ||
    Number(saturated.fourOfFourSamples) >
      Number(saturated.sampleCount) ||
    Number(saturated.unexplainedIdleSamples) >
      Number(saturated.sampleCount) ||
    !HASH.test(String(memoryEvidence.samplesSha256)) ||
    !HASH.test(String(memoryEvidence.summarySha256)) ||
    !["captured", "skipped"].includes(
      String(memoryEvidence.diagnosticStatus)
    )
  ) {
    throw new TypeError("unified_provider_refill_observation_invalid");
  }
}

export function parseUnifiedProviderRefillObservationV1(
  rawCanonicalJson: string
): UnifiedProviderRefillObservationV1 {
  const parsed = JSON.parse(rawCanonicalJson) as
    UnifiedProviderRefillObservationV1;
  if (canonicalizeArtifactJson(parsed) !== rawCanonicalJson) {
    throw new Error("unified_provider_refill_observation_noncanonical");
  }
  validateProviderRefillObservation(parsed);
  return parsed;
}

export function summarizeUnifiedProviderSaturationSamples(
  samples: readonly UnifiedProviderSaturationSample[]
): UnifiedProviderRefillObservationV1["saturated"] {
  const saturated = samples.filter((sample) => {
    for (const value of [
      sample.providerCapacityLimit,
      sample.eligibleReadyProviderWork,
      sample.healthyGroupCount,
      sample.activeSlots
    ]) {
      safeCount(value, "unified_provider_saturation_sample_invalid");
    }
    if (sample.activeSlots > sample.providerCapacityLimit) {
      throw new TypeError("unified_provider_saturation_sample_invalid");
    }
    return sample.providerCapacityLimit >= 4 &&
      sample.eligibleReadyProviderWork >= 4 &&
      sample.runtimeState === "normal" &&
      sample.healthyGroupCount >= 4;
  });
  return {
    sampleCount: saturated.length,
    activeSlotSum: saturated.reduce((sum, sample) =>
      sum + Math.min(sample.activeSlots, 4), 0),
    fourOfFourSamples: saturated.filter((sample) =>
      sample.activeSlots >= 4
    ).length,
    unexplainedIdleSamples: saturated.filter((sample) =>
      sample.activeSlots < 4 && sample.limitingReason === null
    ).length
  };
}

export function assertUnifiedSelectedDenseRefillEvidence(input: {
  readonly saturated: UnifiedProviderRefillObservationV1["saturated"];
  readonly auditedGroupIds: readonly string[];
  readonly dispatchedGroupIds: readonly string[];
  readonly providerErrors: number;
  readonly rateLimited429: number;
  readonly deliveryIntents: number;
  readonly externalSends: number;
  readonly reconciliationRecoveries: number;
}): void {
  for (const value of [
    ...Object.values(input.saturated),
    input.providerErrors,
    input.rateLimited429,
    input.deliveryIntents,
    input.externalSends,
    input.reconciliationRecoveries
  ]) {
    safeCount(
      value,
      "unified_provider_refill_selected_dense_rejected"
    );
  }
  const audited = [...new Set(input.auditedGroupIds)].sort();
  const dispatched = [...new Set(input.dispatchedGroupIds)].sort();
  if (
    audited.length !== 4 ||
    input.auditedGroupIds.length !== 4 ||
    input.dispatchedGroupIds.length !== dispatched.length ||
    audited.some((groupId) => !groupId.trim()) ||
    canonicalizeArtifactJson(audited) !==
      canonicalizeArtifactJson(dispatched) ||
    input.saturated.sampleCount < 1 ||
    input.saturated.activeSlotSum * 2 <
      input.saturated.sampleCount * 7 ||
    input.saturated.unexplainedIdleSamples !== 0 ||
    input.providerErrors !== 0 ||
    input.rateLimited429 !== 0 ||
    input.deliveryIntents !== 0 ||
    input.externalSends !== 0 ||
    input.reconciliationRecoveries !== 0
  ) {
    throw new Error("unified_provider_refill_selected_dense_rejected");
  }
}

function validateProviderRefillRuntimeSample(
  sample: UnifiedProviderRefillRuntimeSampleV1
): void {
  exactKeys(sample, [
    "version",
    "controlSha256",
    "observedAt",
    "runtimeCommit",
    "providerConfigurationSha256",
    "runIds",
    "diagnostics",
    "saturationSample"
  ], "unified_provider_refill_sample_invalid");
  exactKeys(sample.saturationSample, [
    "providerCapacityLimit",
    "eligibleReadyProviderWork",
    "runtimeState",
    "healthyGroupCount",
    "activeSlots",
    "limitingReason"
  ], "unified_provider_refill_sample_invalid");
  validateProviderRefillObservation({
    version: "unified-provider-refill-observation-v1",
    controlSha256: sample.controlSha256,
    observedAt: sample.observedAt,
    runtimeCommit: sample.runtimeCommit,
    providerConfigurationSha256: sample.providerConfigurationSha256,
    diagnostics: sample.diagnostics,
    saturated: {
      sampleCount: 0,
      activeSlotSum: 0,
      fourOfFourSamples: 0,
      unexplainedIdleSamples: 0
    },
    memoryEvidence: {
      samplesSha256: "0".repeat(64),
      summarySha256: "0".repeat(64),
      diagnosticStatus: "skipped"
    }
  });
  summarizeUnifiedProviderSaturationSamples([sample.saturationSample]);
  const runIds = boundedArray(
    sample.runIds,
    "unified_provider_refill_sample_invalid"
  );
  if (
    sample.version !== "unified-provider-refill-runtime-sample-v1" ||
    runIds.length < 1 ||
    runIds.some((runId) =>
      typeof runId !== "string" || !runId.trim()
    ) ||
    new Set(runIds).size !== runIds.length ||
    !["normal", "pressure", "critical"].includes(
      sample.saturationSample.runtimeState
    ) ||
    (
      sample.saturationSample.limitingReason !== null &&
      ![
        "no_eligible_work",
        "fairness_wait",
        "admission_closed",
        "provider_rate_paced",
        "provider_cooldown",
        "provider_circuit_open",
        "canonical_head_wait",
        "merge_buffer_full",
        "db_pressure",
        "memory_pressure",
        "class_capacity_limit",
        "repair_reserve_reclaim",
        "background_preempted",
        "reconciliation_wait",
        "checkpoint_or_commit"
      ].includes(sample.saturationSample.limitingReason)
    )
  ) {
    throw new TypeError("unified_provider_refill_sample_invalid");
  }
}

export async function persistUnifiedProviderRefillRuntimeSample(input: {
  readonly db: UnifiedQueryable;
  readonly createdByRunId: string;
  readonly sample: UnifiedProviderRefillRuntimeSampleV1;
}): Promise<string> {
  validateProviderRefillRuntimeSample(input.sample);
  if (!input.sample.runIds.includes(input.createdByRunId)) {
    throw new Error("unified_provider_refill_sample_creator_unbound");
  }
  const sha256 = fingerprintCanonicalArtifact(input.sample);
  await input.db.query(
    `insert into unified_check_artifacts (
       sha256, created_by_run_id, kind, schema_version, artifact_json
     ) values (
       $1,$2,'adaptive_benchmark_refill_sample','1',$3::jsonb
     ) on conflict (sha256) do nothing`,
    [sha256, input.createdByRunId, JSON.stringify(input.sample)]
  );
  return sha256;
}

export async function listUnifiedProviderRefillRuntimeSamples(input: {
  readonly db: UnifiedQueryable;
  readonly controlSha256: string;
  readonly runtimeCommit: string;
  readonly providerConfigurationSha256: string;
  readonly runIds: readonly string[];
}): Promise<UnifiedProviderRefillRuntimeSampleV1[]> {
  if (
    !HASH.test(input.controlSha256) ||
    !/^[0-9a-f]{40}$/u.test(input.runtimeCommit) ||
    !HASH.test(input.providerConfigurationSha256) ||
    input.runIds.length < 1 ||
    input.runIds.some((runId) => !runId.trim())
  ) {
    throw new TypeError("unified_provider_refill_sample_query_invalid");
  }
  const rows = (await input.db.query(
    `select sha256, artifact_json
       from unified_check_artifacts
      where kind = 'adaptive_benchmark_refill_sample'
        and artifact_json->>'controlSha256' = $1
        and created_by_run_id = any($2::text[])
      order by created_at, sha256`,
    [input.controlSha256, input.runIds]
  )).rows;
  return rows.map((row) => {
    const sample = row.artifact_json as
      UnifiedProviderRefillRuntimeSampleV1;
    validateProviderRefillRuntimeSample(sample);
    if (
      sample.controlSha256 !== input.controlSha256 ||
      sample.runtimeCommit !== input.runtimeCommit ||
      sample.providerConfigurationSha256 !==
        input.providerConfigurationSha256 ||
      sample.runIds.some((runId) => !input.runIds.includes(runId)) ||
      !HASH.test(String(row.sha256)) ||
      fingerprintCanonicalArtifact(sample) !== String(row.sha256)
    ) {
      throw new Error("unified_provider_refill_sample_binding_invalid");
    }
    return sample;
  });
}

export async function persistUnifiedProviderRefillObservation(input: {
  readonly db: UnifiedQueryable;
  readonly createdByRunId: string;
  readonly observation: UnifiedProviderRefillObservationV1;
}): Promise<string> {
  if (!input.createdByRunId.trim()) {
    throw new TypeError("unified_provider_refill_observation_creator_invalid");
  }
  validateProviderRefillObservation(input.observation);
  const sha256 = fingerprintCanonicalArtifact(input.observation);
  await input.db.query(
    `insert into unified_check_artifacts (
       sha256, created_by_run_id, kind, schema_version, artifact_json
     ) values (
       $1,$2,'adaptive_benchmark_refill_observation','1',$3::jsonb
     ) on conflict (sha256) do nothing`,
    [
      sha256,
      input.createdByRunId,
      JSON.stringify(input.observation)
    ]
  );
  return sha256;
}

export async function listUnifiedProviderRefillObservationArtifacts(input: {
  readonly db: UnifiedQueryable;
  readonly controlSha256: string;
  readonly runtimeCommit: string;
  readonly providerConfigurationSha256: string;
  readonly runIds: readonly string[];
}): Promise<UnifiedProviderRefillObservationArtifactV1[]> {
  if (
    !HASH.test(input.controlSha256) ||
    !/^[0-9a-f]{40}$/u.test(input.runtimeCommit) ||
    !HASH.test(input.providerConfigurationSha256) ||
    input.runIds.length < 1 ||
    input.runIds.some((runId) => !runId.trim())
  ) {
    throw new TypeError("unified_provider_refill_observation_query_invalid");
  }
  const rows = (await input.db.query(
    `select sha256, created_by_run_id, artifact_json
       from unified_check_artifacts
      where kind = 'adaptive_benchmark_refill_observation'
        and artifact_json->>'controlSha256' = $1
        and created_by_run_id = any($2::text[])
      order by created_at, sha256`,
    [input.controlSha256, input.runIds]
  )).rows;
  return rows.map((row) => {
    const observation = row.artifact_json as
      UnifiedProviderRefillObservationV1;
    validateProviderRefillObservation(observation);
    const sha256 = String(row.sha256);
    const createdByRunId = String(row.created_by_run_id);
    if (
      observation.controlSha256 !== input.controlSha256 ||
      observation.runtimeCommit !== input.runtimeCommit ||
      observation.providerConfigurationSha256 !==
        input.providerConfigurationSha256 ||
      !input.runIds.includes(createdByRunId) ||
      !HASH.test(sha256) ||
      fingerprintCanonicalArtifact(observation) !== sha256
    ) {
      throw new Error(
        "unified_provider_refill_observation_binding_invalid"
      );
    }
    return { sha256, createdByRunId, observation };
  });
}

export async function captureUnifiedAdaptiveBenchmarkObservationBestEffort<T>(
  input: {
    capture(): Promise<T>;
    onError(error: unknown): void | Promise<void>;
  }
): Promise<T | null> {
  try {
    return await input.capture();
  } catch (error) {
    try {
      await input.onError(error);
    } catch {
      // ponytail: benchmark diagnostics never participate in correctness.
    }
    return null;
  }
}
