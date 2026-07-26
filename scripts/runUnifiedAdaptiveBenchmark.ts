import { performance } from "node:perf_hooks";
import { freemem } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  writeFile
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  parse,
  relative,
  resolve
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../src/forensics/canonicalJson";
import {
  parseUnifiedProviderGroupAuditV1,
  parseUnifiedAdaptiveBenchmarkEvidenceV1,
  sealUnifiedAdaptiveBenchmarkEvidenceV1,
  type UnifiedAdaptiveBenchmarkEvidenceV1
} from "../src/unifiedCheck/adaptiveBenchmarkEvidence";
import {
  runUnifiedAdaptiveBenchmarkEvents,
  type UnifiedAdaptiveBenchmarkEventPlan
} from "../src/unifiedCheck/adaptiveBenchmarkRunner";
import {
  assertUnifiedAdaptiveBenchmarkControlLeaseCurrent,
  assertUnifiedSelectedDenseRefillEvidence,
  installUnifiedAdaptiveBenchmarkControl,
  listUnifiedAdaptiveBenchmarkObservationArtifacts,
  listUnifiedProviderRefillRuntimeSamples,
  parseUnifiedProviderRefillObservationV1,
  parseUnifiedAdaptiveBenchmarkRuntimeObservationV1,
  parseUnifiedAdaptiveBenchmarkScenarioSymptomV1,
  persistUnifiedAdaptiveBenchmarkLatePhaseAck,
  persistUnifiedAdaptiveBenchmarkScenarioSymptom,
  persistUnifiedProviderRefillObservation,
  releaseUnifiedAdaptiveBenchmarkControl,
  renewUnifiedAdaptiveBenchmarkControl,
  summarizeUnifiedProviderSaturationSamples,
  UNIFIED_BENCHMARK_RESTART_MAX_WAIT_MS,
  type UnifiedAdaptiveBenchmarkRuntimeObservationArtifactV1
} from "../src/unifiedCheck/adaptiveBenchmarkControl";
import {
  createUnifiedPoolTransactionHost,
  type UnifiedTransactionalQueryable
} from "../src/unifiedCheck/repository";
import {
  buildUnifiedPerformanceBenchmarkManifest
} from "../src/unifiedCheck/performanceMetrics";
import {
  createUnifiedProviderReplayerV1,
  parseUnifiedRollingOracleReceiptV1,
  parseUnifiedProviderReplayV1,
  type UnifiedRollingOracleReceiptV1
} from "../src/unifiedCheck/providerReplay";

const ALLOWED_REPLAY_CAPACITIES = new Set([1, 4, 8, 16, 32, 100]);
const ALLOWED_LIVE_CAPACITIES = new Set([1, 4]);
const UNIFIED_BENCHMARK_CONTROL_LEASE_MS = 40 * 60_000;
const UNIFIED_BENCHMARK_CONTROL_RENEW_INTERVAL_MS = 60_000;
const execFileAsync = promisify(execFile);
export const UNIFIED_ADAPTIVE_REPLAY_SCENARIOS = [
  "one_dense_wallet",
  "three_dense_wallets",
  "fifteen_dense_wallets",
  "late_interactive",
  "slow_canonical_head",
  "provider_cooldown",
  "restart_recovery",
  "full_merge_buffer",
  "repair_arrival_capacity_one"
] as const;

export const UNIFIED_ADAPTIVE_LIVE_SCENARIOS = [
  "one_dense_wallet",
  "three_dense_wallets",
  "late_interactive",
  "slow_canonical_head",
  "provider_cooldown",
  "restart_recovery",
  "full_merge_buffer",
  "isolated:TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV",
  "isolated:TFWGukC9eWTfg4DYtQAzwuAK5XV85rVYJr",
  "isolated:TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd"
] as const;
const SELECTED_LIVE_SCENARIO =
  "isolated:TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd" as const;
type TraversalPolicy =
  import("../src/unifiedCheck/contracts").UnifiedTraversalPolicyVersion;

export function isNonterminalCheckpointedBenchmarkRun(run: {
  readonly status: string;
  readonly tasks: readonly {
    readonly attemptDurations: readonly {
      readonly outcome: string;
    }[];
  }[];
} | undefined): boolean {
  return run !== undefined &&
    run.status !== "COMPLETED" &&
    run.status !== "FAILED_TECHNICAL" &&
    run.tasks.some((task) => task.attemptDurations.some((attempt) =>
      attempt.outcome === "CHECKPOINTED"
    ));
}

export function completedCanaryTraversalPolicy(
  outcomes: readonly {
    readonly traversalPolicyVersion:
      import("../src/unifiedCheck/contracts").UnifiedTraversalPolicyVersion;
  }[]
): import("../src/unifiedCheck/contracts").UnifiedTraversalPolicyVersion {
  const policies = new Set(outcomes.map((outcome) =>
    outcome.traversalPolicyVersion
  ));
  if (policies.size !== 1) {
    throw new Error("unified_benchmark_live_traversal_policy_mismatch");
  }
  const policy = [...policies][0];
  if (policy === undefined) {
    throw new Error("unified_benchmark_live_traversal_policy_missing");
  }
  return policy;
}

export function calculateUnifiedBenchmarkPeakConcurrency(
  attempts: readonly {
    readonly startedAt: string;
    readonly completedAt: string;
  }[]
): number {
  const boundaries = new Map<number, {
    starts: number;
    ends: number;
    zeroDuration: number;
  }>();
  const boundaryAt = (timestamp: number) => {
    const existing = boundaries.get(timestamp);
    if (existing) return existing;
    const created = { starts: 0, ends: 0, zeroDuration: 0 };
    boundaries.set(timestamp, created);
    return created;
  };

  for (const attempt of attempts) {
    const startedAt = Date.parse(attempt.startedAt);
    const completedAt = Date.parse(attempt.completedAt);
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(completedAt) ||
      completedAt < startedAt
    ) {
      throw new Error("unified_benchmark_live_attempt_interval_invalid");
    }
    if (startedAt === completedAt) {
      boundaryAt(startedAt).zeroDuration += 1;
      continue;
    }
    boundaryAt(startedAt).starts += 1;
    boundaryAt(completedAt).ends += 1;
  }

  let active = 0;
  let peak = 0;
  for (const [, boundary] of [...boundaries.entries()].sort(
    ([left], [right]) => left - right
  )) {
    active -= boundary.ends;
    active += boundary.starts;
    peak = Math.max(peak, active + boundary.zeroDuration);
  }
  return peak;
}

type ReplayScenarioKind =
  typeof UNIFIED_ADAPTIVE_REPLAY_SCENARIOS[number];

type CliOptions = {
  readonly mode: "replay" | "live";
  readonly capacities: readonly number[];
  readonly seed: number;
  readonly output: string;
  readonly isolated: boolean;
  readonly providerAuditPath: string | null;
  readonly oracleReceiptPath: string | null;
  readonly scenario: typeof SELECTED_LIVE_SCENARIO | null;
  readonly traversalPolicy: TraversalPolicy;
  readonly memoryEvidenceDir: string | null;
};

export type UnifiedAdaptiveBenchmarkRuntime = {
  readonly runtimeCommit?: string;
  readonly resolveReplayOracleReceipt?: (input: {
    readonly replaySha256: string;
    readonly seed: number;
    readonly requestedCapacities: readonly number[];
  }) => Promise<UnifiedRollingOracleReceiptV1>;
  readonly runIsolatedCanaryBenchmark?: (input: {
    readonly requestedCapacities: readonly number[];
    readonly output: string;
    readonly candidateCommit: string;
    readonly executionIdentitySha256: string;
    readonly providerAudit:
      ReturnType<typeof parseUnifiedProviderGroupAuditV1>;
    readonly scenarios: readonly (typeof UNIFIED_ADAPTIVE_LIVE_SCENARIOS[number])[];
    readonly traversalPolicy: TraversalPolicy;
    readonly memoryEvidenceDir: string | null;
  }) => Promise<UnifiedAdaptiveBenchmarkIndex>;
};

export type UnifiedAdaptiveBenchmarkIndexV1 = {
  readonly version: "unified-adaptive-benchmark-index-v1";
  readonly mode: "replay" | "live";
  readonly seed: number;
  readonly requestedCapacities: readonly number[];
  readonly candidateCommit: string;
  readonly executionIdentitySha256: string;
  readonly generatedAt: string;
  readonly artifacts: readonly {
    readonly scenarioId: string;
    readonly relativePath: string;
    readonly evidenceSha256: string;
    readonly candidateCommit: string;
    readonly executionIdentitySha256: string;
  }[];
  readonly indexSha256: string;
};

export type UnifiedSelectedRefillExportEvidenceV1 = {
  readonly version: "unified-selected-refill-export-evidence-v1";
  readonly schemaVersion: 1;
  readonly scenarioId: string;
  readonly executionIdentitySha256: string;
  readonly candidateCommit: string;
  readonly traversalPolicyVersion: TraversalPolicy;
  readonly benchmarkEvidenceSha256: string;
  readonly benchmarkEvidenceRelativePath: string;
  readonly runId: string;
  readonly controlSha256: string;
  readonly providerConfigurationSha256: string;
  readonly refillArtifactSha256: string;
  readonly refillArtifactCreatedByRunId: string;
  readonly refillArtifactRelativePath: string;
  readonly memoryEvidence: {
    readonly nodePid: number;
    readonly samplesRelativePath: string;
    readonly samplesSha256: string;
    readonly summaryRelativePath: string;
    readonly summarySha256: string;
  };
  readonly evidenceSha256: string;
};

type UnifiedSelectedRefillExportEvidenceInputV1 = Omit<
  UnifiedSelectedRefillExportEvidenceV1,
  "version" | "schemaVersion" | "evidenceSha256"
>;

function selectedEvidenceRecord(
  value: unknown
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("unified_benchmark_selected_refill_export_invalid");
  }
  return value as Record<string, unknown>;
}

function selectedEvidenceExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError("unified_benchmark_selected_refill_export_invalid");
  }
}

function selectedEvidenceRelativePath(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\\") &&
    !isAbsolute(value) &&
    !value.split("/").includes("..");
}

function validateUnifiedSelectedRefillExportEvidenceV1(
  value: unknown
): UnifiedSelectedRefillExportEvidenceV1 {
  const raw = selectedEvidenceRecord(value);
  selectedEvidenceExactKeys(raw, [
    "version",
    "schemaVersion",
    "scenarioId",
    "executionIdentitySha256",
    "candidateCommit",
    "traversalPolicyVersion",
    "benchmarkEvidenceSha256",
    "benchmarkEvidenceRelativePath",
    "runId",
    "controlSha256",
    "providerConfigurationSha256",
    "refillArtifactSha256",
    "refillArtifactCreatedByRunId",
    "refillArtifactRelativePath",
    "memoryEvidence",
    "evidenceSha256"
  ]);
  const memory = selectedEvidenceRecord(raw.memoryEvidence);
  selectedEvidenceExactKeys(memory, [
    "nodePid",
    "samplesRelativePath",
    "samplesSha256",
    "summaryRelativePath",
    "summarySha256"
  ]);
  const hash = /^[0-9a-f]{64}$/u;
  if (
    raw.version !== "unified-selected-refill-export-evidence-v1" ||
    raw.schemaVersion !== 1 ||
    typeof raw.scenarioId !== "string" ||
    !raw.scenarioId.trim() ||
    !hash.test(String(raw.executionIdentitySha256)) ||
    !/^[0-9a-f]{40}$/u.test(String(raw.candidateCommit)) ||
    !["snapshot-closure-v1", "snapshot-closure-v2"].includes(
      String(raw.traversalPolicyVersion)
    ) ||
    !hash.test(String(raw.benchmarkEvidenceSha256)) ||
    !selectedEvidenceRelativePath(raw.benchmarkEvidenceRelativePath) ||
    typeof raw.runId !== "string" ||
    !raw.runId.trim() ||
    !hash.test(String(raw.controlSha256)) ||
    !hash.test(String(raw.providerConfigurationSha256)) ||
    !hash.test(String(raw.refillArtifactSha256)) ||
    raw.refillArtifactCreatedByRunId !== raw.runId ||
    !selectedEvidenceRelativePath(raw.refillArtifactRelativePath) ||
    !Number.isSafeInteger(memory.nodePid) ||
    Number(memory.nodePid) < 1 ||
    !selectedEvidenceRelativePath(memory.samplesRelativePath) ||
    !hash.test(String(memory.samplesSha256)) ||
    !selectedEvidenceRelativePath(memory.summaryRelativePath) ||
    !hash.test(String(memory.summarySha256)) ||
    !hash.test(String(raw.evidenceSha256))
  ) {
    throw new TypeError("unified_benchmark_selected_refill_export_invalid");
  }
  const { evidenceSha256, ...withoutHash } = raw;
  if (fingerprintCanonicalArtifact(withoutHash) !== evidenceSha256) {
    throw new Error(
      "unified_benchmark_selected_refill_export_hash_mismatch"
    );
  }
  return raw as UnifiedSelectedRefillExportEvidenceV1;
}

export function sealUnifiedSelectedRefillExportEvidenceV1(
  input: UnifiedSelectedRefillExportEvidenceInputV1
): {
  readonly envelope: UnifiedSelectedRefillExportEvidenceV1;
  readonly canonicalJson: string;
} {
  const withoutHash = {
    version: "unified-selected-refill-export-evidence-v1" as const,
    schemaVersion: 1 as const,
    ...input
  };
  const envelope = validateUnifiedSelectedRefillExportEvidenceV1({
    ...withoutHash,
    evidenceSha256: fingerprintCanonicalArtifact(withoutHash)
  });
  return { envelope, canonicalJson: canonicalizeArtifactJson(envelope) };
}

export function parseUnifiedSelectedRefillExportEvidenceV1(
  rawCanonicalJson: string
): UnifiedSelectedRefillExportEvidenceV1 {
  const parsed = JSON.parse(rawCanonicalJson) as unknown;
  if (canonicalizeArtifactJson(parsed) !== rawCanonicalJson) {
    throw new Error("unified_benchmark_selected_refill_export_noncanonical");
  }
  return validateUnifiedSelectedRefillExportEvidenceV1(parsed);
}

export type UnifiedSelectedAdaptiveBenchmarkIndexV2 = {
  readonly version: "unified-adaptive-benchmark-index-v2";
  readonly schemaVersion: 2;
  readonly mode: "live";
  readonly seed: 1;
  readonly requestedCapacities: readonly [4];
  readonly candidateCommit: string;
  readonly executionIdentitySha256: string;
  readonly generatedAt: string;
  readonly artifacts: readonly [{
    readonly scenarioId: string;
    readonly relativePath: string;
    readonly evidenceSha256: string;
    readonly candidateCommit: string;
    readonly executionIdentitySha256: string;
    readonly refillArtifactSha256: string;
    readonly refillArtifactCreatedByRunId: string;
    readonly selectedRefillEvidenceSha256: string;
    readonly selectedRefillEvidenceRelativePath: string;
  }];
  readonly indexSha256: string;
};

export type UnifiedAdaptiveBenchmarkIndex =
  | UnifiedAdaptiveBenchmarkIndexV1
  | UnifiedSelectedAdaptiveBenchmarkIndexV2;

type UnifiedSelectedAdaptiveBenchmarkIndexInputV2 = Omit<
  UnifiedSelectedAdaptiveBenchmarkIndexV2,
  "version" | "schemaVersion" | "mode" | "indexSha256"
>;

function validateUnifiedSelectedAdaptiveBenchmarkIndexV2(
  value: unknown
): UnifiedSelectedAdaptiveBenchmarkIndexV2 {
  const raw = selectedEvidenceRecord(value);
  selectedEvidenceExactKeys(raw, [
    "version",
    "schemaVersion",
    "mode",
    "seed",
    "requestedCapacities",
    "candidateCommit",
    "executionIdentitySha256",
    "generatedAt",
    "artifacts",
    "indexSha256"
  ]);
  if (!Array.isArray(raw.artifacts) || raw.artifacts.length !== 1) {
    throw new TypeError("unified_benchmark_selected_index_invalid");
  }
  const artifact = selectedEvidenceRecord(raw.artifacts[0]);
  selectedEvidenceExactKeys(artifact, [
    "scenarioId",
    "relativePath",
    "evidenceSha256",
    "candidateCommit",
    "executionIdentitySha256",
    "refillArtifactSha256",
    "refillArtifactCreatedByRunId",
    "selectedRefillEvidenceSha256",
    "selectedRefillEvidenceRelativePath"
  ]);
  const hash = /^[0-9a-f]{64}$/u;
  if (
    raw.version !== "unified-adaptive-benchmark-index-v2" ||
    raw.schemaVersion !== 2 ||
    raw.mode !== "live" ||
    raw.seed !== 1 ||
    !Array.isArray(raw.requestedCapacities) ||
    raw.requestedCapacities.length !== 1 ||
    raw.requestedCapacities[0] !== 4 ||
    !/^[0-9a-f]{40}$/u.test(String(raw.candidateCommit)) ||
    !hash.test(String(raw.executionIdentitySha256)) ||
    typeof raw.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(raw.generatedAt)) ||
    typeof artifact.scenarioId !== "string" ||
    !artifact.scenarioId.startsWith("live:c4:isolated:") ||
    !selectedEvidenceRelativePath(artifact.relativePath) ||
    !hash.test(String(artifact.evidenceSha256)) ||
    artifact.candidateCommit !== raw.candidateCommit ||
    !hash.test(String(artifact.executionIdentitySha256)) ||
    !hash.test(String(artifact.refillArtifactSha256)) ||
    typeof artifact.refillArtifactCreatedByRunId !== "string" ||
    !artifact.refillArtifactCreatedByRunId.trim() ||
    !hash.test(String(artifact.selectedRefillEvidenceSha256)) ||
    !selectedEvidenceRelativePath(
      artifact.selectedRefillEvidenceRelativePath
    ) ||
    !hash.test(String(raw.indexSha256))
  ) {
    throw new TypeError("unified_benchmark_selected_index_invalid");
  }
  const { indexSha256, ...withoutHash } = raw;
  if (fingerprintCanonicalArtifact(withoutHash) !== indexSha256) {
    throw new Error("unified_benchmark_selected_index_hash_mismatch");
  }
  return raw as unknown as UnifiedSelectedAdaptiveBenchmarkIndexV2;
}

export function sealUnifiedSelectedAdaptiveBenchmarkIndexV2(
  input: UnifiedSelectedAdaptiveBenchmarkIndexInputV2
): {
  readonly envelope: UnifiedSelectedAdaptiveBenchmarkIndexV2;
  readonly canonicalJson: string;
} {
  const withoutHash = {
    version: "unified-adaptive-benchmark-index-v2" as const,
    schemaVersion: 2 as const,
    mode: "live" as const,
    ...input
  };
  const envelope = validateUnifiedSelectedAdaptiveBenchmarkIndexV2({
    ...withoutHash,
    indexSha256: fingerprintCanonicalArtifact(withoutHash)
  });
  return { envelope, canonicalJson: canonicalizeArtifactJson(envelope) };
}

export function parseUnifiedSelectedAdaptiveBenchmarkIndexV2(
  rawCanonicalJson: string
): UnifiedSelectedAdaptiveBenchmarkIndexV2 {
  const parsed = JSON.parse(rawCanonicalJson) as unknown;
  if (canonicalizeArtifactJson(parsed) !== rawCanonicalJson) {
    throw new Error("unified_benchmark_selected_index_noncanonical");
  }
  return validateUnifiedSelectedAdaptiveBenchmarkIndexV2(parsed);
}

export class UnifiedAdaptiveBenchmarkRestartRequiredError extends Error {
  readonly exitCode = 75;
  readonly phase;

  constructor(input: {
    readonly output: string;
    readonly scenarioId: string;
    readonly runIds: readonly string[];
    readonly benchmarkControlSha256: string;
    readonly executionIdentitySha256: string;
    readonly stateIdentitySha256: string;
    readonly handoffArtifactSha256: string;
    readonly resumeDeadline: string;
  }) {
    if (
      !/^[0-9a-f]{64}$/u.test(input.executionIdentitySha256) ||
      !/^[0-9a-f]{64}$/u.test(input.stateIdentitySha256) ||
      !Number.isFinite(Date.parse(input.resumeDeadline))
    ) {
      throw new TypeError("unified_benchmark_resume_deadline_invalid");
    }
    super("unified_benchmark_restart_required");
    this.phase = {
      version: "unified-adaptive-benchmark-phase-v1" as const,
      status: "restart_required" as const,
      output: input.output,
      scenarioId: input.scenarioId,
      runIds: [...input.runIds],
      benchmarkControlSha256: input.benchmarkControlSha256,
      executionIdentitySha256: input.executionIdentitySha256,
      stateIdentitySha256: input.stateIdentitySha256,
      handoffArtifactSha256: input.handoffArtifactSha256,
      resumeDeadline: input.resumeDeadline,
      resumeRequired: true as const
    };
  }
}

type UnifiedBenchmarkRestartIdentity = {
  readonly output: string;
  readonly scenarioId: string;
  readonly runIds: readonly string[];
  readonly benchmarkControlSha256: string;
  readonly executionIdentitySha256: string;
  readonly stateIdentitySha256: string;
  readonly handoffArtifactSha256: string;
  readonly resumeDeadline: string;
};

const genuineRestartScopeByError = new WeakMap<
  UnifiedAdaptiveBenchmarkRestartRequiredError,
  symbol
>();

function createGenuineUnifiedBenchmarkRestartRequiredError(
  input: UnifiedBenchmarkRestartIdentity,
  scopeToken: symbol
): UnifiedAdaptiveBenchmarkRestartRequiredError {
  const error =
    new UnifiedAdaptiveBenchmarkRestartRequiredError(input);
  genuineRestartScopeByError.set(error, scopeToken);
  return error;
}

export function createUnifiedBenchmarkReleaseOwner() {
  let release: () => Promise<void> = async () => undefined;
  let released = false;
  return {
    set(next: () => Promise<void>): void {
      if (released) {
        throw new Error("unified_benchmark_release_owner_closed");
      }
      release = next;
    },
    async callbackRelease(): Promise<void> {
      // The outer benchmark owns the control across primary and late canaries.
    },
    async releaseOnce(): Promise<void> {
      if (released) return;
      await release();
      released = true;
    }
  };
}

function createUnifiedBenchmarkRenewalLoop() {
  let renew: ((expiresAt: Date) => Promise<void>) | null = null;
  let timer: NodeJS.Timeout | null = null;
  let pending = Promise.resolve();
  let failure: unknown = null;
  let stopped = false;
  const renewOnce = async (now = new Date()): Promise<void> => {
    if (stopped || renew === null) return;
    if (failure !== null) throw failure;
    await pending;
    pending = renew(new Date(
      now.getTime() + UNIFIED_BENCHMARK_CONTROL_LEASE_MS
    ));
    try {
      await pending;
    } catch (error) {
      failure = error;
      throw error;
    }
  };
  return {
    set(next: (expiresAt: Date) => Promise<void>): void {
      if (stopped) {
        throw new Error("unified_benchmark_renewal_loop_closed");
      }
      renew = next;
      if (timer !== null) return;
      timer = setInterval(() => {
        void renewOnce().catch(() => undefined);
      }, UNIFIED_BENCHMARK_CONTROL_RENEW_INTERVAL_MS);
      timer.unref();
    },
    renewNow: renewOnce,
    async stop(): Promise<void> {
      if (timer !== null) clearInterval(timer);
      timer = null;
      stopped = true;
      await pending;
      if (failure !== null) throw failure;
    }
  };
}

export async function runUnifiedBenchmarkControlScope<T>(input: {
  readonly releaseOwner: {
    releaseOnce(): Promise<void>;
  };
  readonly renewalLoop: {
    stop(): Promise<void>;
  };
  readonly restartIdentity: () =>
    UnifiedBenchmarkRestartIdentity | null;
  readonly work: (control: {
    restartRequired(
      identity: UnifiedBenchmarkRestartIdentity
    ): never;
  }) => Promise<T>;
}): Promise<T> {
  const scopeToken = Symbol("unified-benchmark-restart-scope");
  let preserveCandidate = false;
  try {
    return await input.work({
      restartRequired(identity): never {
        throw createGenuineUnifiedBenchmarkRestartRequiredError(
          identity,
          scopeToken
        );
      }
    });
  } catch (error) {
    const expected = input.restartIdentity();
    preserveCandidate =
      error instanceof UnifiedAdaptiveBenchmarkRestartRequiredError &&
      genuineRestartScopeByError.get(error) === scopeToken &&
      expected !== null &&
      error.phase.output === expected.output &&
      error.phase.benchmarkControlSha256 ===
        expected.benchmarkControlSha256 &&
      error.phase.executionIdentitySha256 ===
        expected.executionIdentitySha256 &&
      error.phase.stateIdentitySha256 ===
        expected.stateIdentitySha256 &&
      error.phase.handoffArtifactSha256 ===
        expected.handoffArtifactSha256 &&
      error.phase.resumeDeadline === expected.resumeDeadline &&
      error.phase.scenarioId === expected.scenarioId &&
      error.phase.runIds.length === expected.runIds.length &&
      error.phase.runIds.every((runId, index) =>
        runId === expected.runIds[index]
      );
    throw error;
  } finally {
    let cleanupError: unknown = null;
    try {
      await input.renewalLoop.stop();
    } catch (error) {
      cleanupError = error;
      preserveCandidate = false;
    }
    if (!preserveCandidate) {
      try {
        await input.releaseOwner.releaseOnce();
      } catch (error) {
        cleanupError = cleanupError === null
          ? error
          : new AggregateError(
              [cleanupError, error],
              "unified_benchmark_control_cleanup_failed"
            );
      }
    }
    if (cleanupError !== null) throw cleanupError;
  }
}

export async function recoverUnifiedBenchmarkCapacityStateControl(
  input: {
    readonly db: UnifiedTransactionalQueryable;
    readonly state: UnifiedAdaptiveLiveCapacityStateV1;
    readonly now: Date;
    readonly releaseOwner: {
      set(release: () => Promise<void>): void;
    };
    readonly renewalLoop: {
      set(renew: (expiresAt: Date) => Promise<void>): void;
    };
  }
): Promise<void> {
  await assertUnifiedAdaptiveBenchmarkControlLeaseCurrent({
    db: input.db,
    controlSha256: input.state.primaryControlSha256,
    leaseOwner: input.state.primaryControlLeaseOwner,
    createdByRunId: input.state.primaryControlCreatedByRunId,
    now: input.now
  });
  input.releaseOwner.set(() =>
    releaseUnifiedAdaptiveBenchmarkControl({
      db: input.db,
      controlSha256: input.state.primaryControlSha256,
      leaseOwner: input.state.primaryControlLeaseOwner,
      createdByRunId: input.state.primaryControlCreatedByRunId,
      releasedAt: new Date()
    })
  );
  input.renewalLoop.set((expiresAt) =>
    renewUnifiedAdaptiveBenchmarkControl({
      db: input.db,
      controlSha256: input.state.primaryControlSha256,
      leaseOwner: input.state.primaryControlLeaseOwner,
      createdByRunId: input.state.primaryControlCreatedByRunId,
      now: new Date(),
      expiresAt
    })
  );
}

function parsePositiveInteger(value: string, code: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new TypeError(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(code);
  return parsed;
}

function parseCli(args: readonly string[]): CliOptions {
  let mode: CliOptions["mode"] | null = null;
  let capacities: readonly number[] | null = null;
  let seed: number | null = null;
  let output: string | null = null;
  let isolated = false;
  let providerAuditPath: string | null = null;
  let oracleReceiptPath: string | null = null;
  let scenario: typeof SELECTED_LIVE_SCENARIO | null = null;
  let traversalPolicy: TraversalPolicy = "snapshot-closure-v1";
  let memoryEvidenceDir: string | null = null;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    if (flag === "--isolated") {
      if (seen.has(flag)) throw new TypeError("unified_benchmark_cli_duplicate");
      seen.add(flag);
      isolated = true;
      continue;
    }
    if (![
      "--mode",
      "--capacity",
      "--seed",
      "--output",
      "--provider-audit",
      "--oracle-receipt",
      "--scenario",
      "--traversal-policy",
      "--memory-evidence-dir"
    ].includes(flag)) {
      throw new TypeError(`unified_benchmark_cli_unknown:${flag}`);
    }
    if (seen.has(flag)) throw new TypeError("unified_benchmark_cli_duplicate");
    seen.add(flag);
    const value = args[++index];
    if (value === undefined || value.length === 0) {
      throw new TypeError(`unified_benchmark_cli_value_missing:${flag}`);
    }
    if (flag === "--mode") {
      if (value !== "replay" && value !== "live") {
        throw new TypeError("unified_benchmark_cli_mode_invalid");
      }
      mode = value;
    } else if (flag === "--capacity") {
      capacities = value.split(",").map((item) =>
        parsePositiveInteger(
          item,
          "unified_benchmark_cli_capacity_invalid"
        )
      );
    } else if (flag === "--seed") {
      seed = parsePositiveInteger(
        value,
        "unified_benchmark_cli_seed_invalid"
      );
    } else if (flag === "--output") {
      output = value;
    } else if (flag === "--provider-audit") {
      providerAuditPath = value;
    } else if (flag === "--oracle-receipt") {
      oracleReceiptPath = value;
    } else if (flag === "--scenario") {
      if (value !== SELECTED_LIVE_SCENARIO) {
        throw new TypeError("unified_benchmark_cli_scenario_invalid");
      }
      scenario = value;
    } else if (flag === "--traversal-policy") {
      if (
        value !== "snapshot-closure-v1" &&
        value !== "snapshot-closure-v2"
      ) {
        throw new TypeError(
          "unified_benchmark_cli_traversal_policy_invalid"
        );
      }
      traversalPolicy = value;
    } else {
      memoryEvidenceDir = value;
    }
  }
  if (mode === null || capacities === null || output === null) {
    throw new TypeError("unified_benchmark_cli_required_missing");
  }
  if (
    capacities.length === 0 ||
    new Set(capacities).size !== capacities.length
  ) {
    throw new TypeError("unified_benchmark_cli_capacity_invalid");
  }
  const allowed = mode === "replay"
    ? ALLOWED_REPLAY_CAPACITIES
    : ALLOWED_LIVE_CAPACITIES;
  if (capacities.some((capacity) => !allowed.has(capacity))) {
    throw new TypeError("unified_benchmark_cli_capacity_invalid");
  }
  if (mode === "replay") {
    if (seed === null) {
      throw new TypeError("unified_benchmark_cli_seed_required");
    }
    if (
      isolated ||
      providerAuditPath !== null ||
      scenario !== null ||
      memoryEvidenceDir !== null
    ) {
      throw new TypeError("unified_benchmark_cli_replay_option_invalid");
    }
  } else {
    if (!isolated) {
      throw new Error("unified_benchmark_live_isolation_required");
    }
    if (providerAuditPath === null) {
      throw new Error("unified_benchmark_live_group_audit_required");
    }
    if (oracleReceiptPath !== null) {
      throw new TypeError("unified_benchmark_cli_live_option_invalid");
    }
    if (
      (scenario === null) !== (memoryEvidenceDir === null)
    ) {
      throw new TypeError(
        "unified_benchmark_live_selected_memory_required"
      );
    }
  }
  return {
    mode,
    capacities: [...capacities].sort((left, right) => left - right),
    seed: seed ?? 1,
    output,
    isolated,
    providerAuditPath,
    oracleReceiptPath,
    scenario,
    traversalPolicy,
    memoryEvidenceDir
  };
}

function safeOutputPath(value: string): string {
  const output = resolve(value);
  const segments = output.replaceAll("\\", "/").split("/");
  if (
    extname(output).toLowerCase() !== ".json" ||
    segments.includes(".codex-live") ||
    output === parse(output).root ||
    basename(output).startsWith(".")
  ) {
    throw new Error("unified_benchmark_output_forbidden");
  }
  return output;
}

async function rejectSymlink(path: string): Promise<void> {
  const absolute = resolve(path);
  const ancestors: string[] = [];
  for (
    let current = absolute;
    ;
    current = dirname(current)
  ) {
    ancestors.push(current);
    if (current === parse(current).root) break;
  }
  for (const current of ancestors.reverse()) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new Error("unified_benchmark_output_symlink_forbidden");
      }
      const physical = resolve(await realpath(current));
      const normalize = (value: string) => process.platform === "win32"
        ? value.toLowerCase()
        : value;
      if (normalize(physical) !== normalize(resolve(current))) {
        throw new Error("unified_benchmark_output_symlink_forbidden");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

async function readNoFollow(path: string): Promise<string> {
  await rejectSymlink(path);
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await open(path, fsConstants.O_RDONLY | noFollow);
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function mkdirNoFollow(path: string): Promise<void> {
  await rejectSymlink(path);
  await mkdir(path, { recursive: true });
  await rejectSymlink(path);
}

async function requireExistingDirectoryNoFollow(path: string): Promise<string> {
  const absolute = resolve(path);
  await rejectSymlink(absolute);
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("unified_benchmark_memory_directory_invalid");
  }
  return absolute;
}

async function writeImmutable(path: string, content: string): Promise<void> {
  await rejectSymlink(path);
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  try {
    const handle = await open(
      path,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        noFollow,
      0o600
    );
    try {
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (await readNoFollow(path) !== content) {
      throw new Error("unified_benchmark_existing_artifact_mismatch");
    }
  }
}

type UnifiedBenchmarkMemoryPhase = "before" | "during" | "after";

export type UnifiedBenchmarkMemoryPhaseRunner = (input: {
  readonly phase: UnifiedBenchmarkMemoryPhase;
  readonly runId: string;
  readonly scenarioId: string;
  readonly nodePid: number;
  readonly runtimeSnapshotPath: string;
  readonly samplesPath: string;
  readonly summaryPath: string;
}) => Promise<void>;

function memoryExactKeys(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("unified_benchmark_memory_evidence_invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
  ) {
    throw new Error("unified_benchmark_memory_evidence_invalid");
  }
  return record;
}

function memoryPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function memoryNonNegative(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) && value >= 0;
}

function validateMemoryEvidenceFiles(input: {
  readonly samplesBytes: string;
  readonly summaryBytes: string;
  readonly runId: string;
  readonly scenarioId: string;
  readonly nodePid: number;
}): "captured" | "skipped" {
  const samples = JSON.parse(input.samplesBytes) as unknown;
  if (!Array.isArray(samples) || samples.length !== 3) {
    throw new Error("unified_benchmark_memory_evidence_invalid");
  }
  const phases = ["before", "during", "after"] as const;
  for (const [index, rawSample] of samples.entries()) {
    const sample = memoryExactKeys(rawSample, [
      "capturedAt",
      "localWslDiagnostic",
      "nodePid",
      "phase",
      "runId",
      "runtime",
      "scenarioId",
      "version"
    ]);
    const runtime = memoryExactKeys(sample.runtime, [
      "heapUsedBytes",
      "rssBytes"
    ]);
    const local = memoryExactKeys(sample.localWslDiagnostic, [
      "linuxMemAvailableBytes",
      "linuxSwapFreeBytes",
      "linuxSwapTotalBytes",
      "status",
      "vmmemWslWorkingSetBytes"
    ]);
    if (
      sample.version !== "unified-memory-sample-v1" ||
      sample.runId !== input.runId ||
      sample.scenarioId !== input.scenarioId ||
      sample.nodePid !== input.nodePid ||
      sample.phase !== phases[index] ||
      typeof sample.capturedAt !== "string" ||
      !Number.isFinite(Date.parse(sample.capturedAt)) ||
      !memoryPositive(runtime.rssBytes) ||
      !memoryPositive(runtime.heapUsedBytes) ||
      runtime.heapUsedBytes > runtime.rssBytes ||
      !["captured", "skipped"].includes(String(local.status))
    ) {
      throw new Error("unified_benchmark_memory_evidence_invalid");
    }
    const localValues = [
      local.linuxMemAvailableBytes,
      local.linuxSwapFreeBytes,
      local.linuxSwapTotalBytes,
      local.vmmemWslWorkingSetBytes
    ];
    if (
      (local.status === "skipped" &&
        localValues.some((value) => value !== null)) ||
      (
        local.status === "captured" &&
        (
          !memoryPositive(local.linuxMemAvailableBytes) ||
          !memoryNonNegative(local.linuxSwapFreeBytes) ||
          !memoryNonNegative(local.linuxSwapTotalBytes) ||
          local.linuxSwapFreeBytes > local.linuxSwapTotalBytes ||
          !memoryPositive(local.vmmemWslWorkingSetBytes)
        )
      )
    ) {
      throw new Error("unified_benchmark_memory_evidence_invalid");
    }
  }
  const summary = memoryExactKeys(JSON.parse(input.summaryBytes), [
    "completedAt",
    "diagnosticStatus",
    "runId",
    "runtimeTrend",
    "scenarioId",
    "scope",
    "verdict",
    "version",
    "wslTrend"
  ]);
  const runtimeTrend = memoryExactKeys(summary.runtimeTrend, [
    "afterRssBytes",
    "beforeRssBytes",
    "peakRssBytes",
    "postRunRssDeltaBytes"
  ]);
  const wslTrend = memoryExactKeys(summary.wslTrend, [
    "linuxAvailableDeltaBytes",
    "postRunVmmemDeltaBytes",
    "swapUsedGrowthBytes"
  ]);
  if (
    summary.version !== "unified-local-wsl-memory-summary-v1" ||
    summary.scope !== "local_wsl_diagnostic" ||
    summary.verdict !== "diagnostic_only" ||
    summary.runId !== input.runId ||
    summary.scenarioId !== input.scenarioId ||
    typeof summary.completedAt !== "string" ||
    !Number.isFinite(Date.parse(summary.completedAt)) ||
    !["captured", "skipped"].includes(
      String(summary.diagnosticStatus)
    ) ||
    !memoryPositive(runtimeTrend.afterRssBytes) ||
    !memoryPositive(runtimeTrend.beforeRssBytes) ||
    !memoryPositive(runtimeTrend.peakRssBytes) ||
    typeof runtimeTrend.postRunRssDeltaBytes !== "number" ||
    !Number.isSafeInteger(runtimeTrend.postRunRssDeltaBytes) ||
    Object.values(wslTrend).some((value) =>
      value !== null &&
      (typeof value !== "number" || !Number.isSafeInteger(value))
    )
  ) {
    throw new Error("unified_benchmark_memory_evidence_invalid");
  }
  return summary.diagnosticStatus as "captured" | "skipped";
}

const runUnifiedBenchmarkMemoryPowerShell: UnifiedBenchmarkMemoryPhaseRunner =
  async (input) => {
    const args = [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", resolve("scripts/captureUnifiedWslMemory.ps1"),
      "-RunId", input.runId,
      "-ScenarioId", input.scenarioId,
      "-Phase", input.phase,
      "-NodePid", String(input.nodePid),
      "-RuntimeSnapshotPath", input.runtimeSnapshotPath,
      "-OutputPath", input.samplesPath
    ];
    if (input.phase === "after") {
      args.push("-SummaryPath", input.summaryPath);
    }
    await execFileAsync("powershell.exe", args, { windowsHide: true });
  };

export function createUnifiedBenchmarkMemoryCapture(input: {
  readonly directory: string;
  readonly scenarioId: string;
  readonly nodePid?: number;
  readonly memoryUsage?: () => { readonly rss: number; readonly heapUsed: number };
  readonly phaseRunner?: UnifiedBenchmarkMemoryPhaseRunner;
}) {
  const directory = resolve(input.directory);
  const nodePid = input.nodePid ?? process.pid;
  const memoryUsage = input.memoryUsage ?? (() => process.memoryUsage());
  const phaseRunner = input.phaseRunner ??
    runUnifiedBenchmarkMemoryPowerShell;
  const runtimeSnapshotPath = resolve(directory, "runtime-memory.json");
  const samplesPath = resolve(directory, "memory-samples.json");
  const summaryPath = resolve(directory, "memory-summary.json");
  let stableRunId: string | null = null;
  const completed = new Set<UnifiedBenchmarkMemoryPhase>();
  const capture = async (
    phase: UnifiedBenchmarkMemoryPhase,
    runId: string
  ): Promise<void> => {
    if (!runId.trim() || !input.scenarioId.trim()) {
      throw new Error("unified_benchmark_memory_identity_invalid");
    }
    if (stableRunId !== null && stableRunId !== runId) {
      throw new Error("unified_benchmark_memory_identity_mismatch");
    }
    stableRunId = runId;
    if (completed.has(phase)) {
      if (phase === "during") return;
      throw new Error("unified_benchmark_memory_phase_duplicate");
    }
    if (
      (phase === "during" && !completed.has("before")) ||
      (phase === "after" &&
        (!completed.has("before") || !completed.has("during")))
    ) {
      throw new Error("unified_benchmark_memory_phase_order_invalid");
    }
    const memory = memoryUsage();
    if (
      !memoryPositive(memory.rss) ||
      !memoryPositive(memory.heapUsed) ||
      memory.heapUsed > memory.rss
    ) {
      throw new Error("unified_benchmark_memory_runtime_invalid");
    }
    await writeFile(
      runtimeSnapshotPath,
      canonicalizeArtifactJson({
        heapUsedBytes: memory.heapUsed,
        rssBytes: memory.rss
      }),
      "utf8"
    );
    await phaseRunner({
      phase,
      runId,
      scenarioId: input.scenarioId,
      nodePid,
      runtimeSnapshotPath,
      samplesPath,
      summaryPath
    });
    completed.add(phase);
  };
  return {
    before: (runId: string) => capture("before", runId),
    during: (runId: string) => capture("during", runId),
    async after(runId: string) {
      await capture("after", runId);
      const [samplesBytes, summaryBytes] = await Promise.all([
        readFile(samplesPath, "utf8"),
        readFile(summaryPath, "utf8")
      ]);
      const diagnosticStatus = validateMemoryEvidenceFiles({
        samplesBytes,
        summaryBytes,
        runId,
        scenarioId: input.scenarioId,
        nodePid
      });
      return {
        samplesSha256: createHash("sha256").update(samplesBytes).digest("hex"),
        summarySha256: createHash("sha256").update(summaryBytes).digest("hex"),
        diagnosticStatus,
        nodePid,
        samplesBytes,
        summaryBytes
      } as const;
    }
  };
}

export type UnifiedAdaptiveLiveCapacityStateV1 = {
  readonly version: "unified-adaptive-live-capacity-state-v1";
  readonly candidateCommit: string;
  readonly executionIdentitySha256: string;
  readonly capacity: number;
  readonly primaryBatchIdentitySha256: string;
  readonly primaryControlSha256: string;
  readonly primaryControlLeaseOwner: string;
  readonly primaryControlCreatedByRunId: string;
  readonly primaryControlLeaseIdentitySha256: string;
  readonly primaryRunIds: readonly string[];
  readonly lateBatchIdentitySha256: string;
  readonly lateControlSha256: string;
  readonly lateRunId: string;
  readonly stateSha256: string;
};

type UnifiedAdaptiveLivePrimaryStateV1 = {
  readonly version: "unified-adaptive-live-primary-state-v1";
  readonly candidateCommit: string;
  readonly executionIdentitySha256: string;
  readonly capacity: number;
  readonly batchIdentitySha256: string;
  readonly controlSha256: string;
  readonly leaseOwner: string;
  readonly runIds: readonly string[];
  readonly stateSha256: string;
};

type UnifiedAdaptiveLiveLateStateV1 = {
  readonly version: "unified-adaptive-live-late-state-v1";
  readonly candidateCommit: string;
  readonly executionIdentitySha256: string;
  readonly capacity: number;
  readonly batchIdentitySha256: string;
  readonly controlSha256: string;
  readonly runId: string;
  readonly stateSha256: string;
};

function parseCanonicalResumeRecord(
  raw: string,
  keys: readonly string[]
): Record<string, unknown> {
  const canonical = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  const parsed = JSON.parse(canonical) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    canonicalizeArtifactJson(parsed) !== canonical ||
    Object.keys(parsed).some((key) => !keys.includes(key)) ||
    keys.some((key) =>
      !Object.prototype.hasOwnProperty.call(parsed, key)
    )
  ) {
    throw new Error("unified_benchmark_existing_artifact_mismatch");
  }
  return parsed as Record<string, unknown>;
}

function unifiedBenchmarkControlLeaseIdentity(input: {
  readonly controlSha256: string;
  readonly leaseOwner: string;
  readonly createdByRunId: string;
}): string {
  return fingerprintCanonicalArtifact({
    version: "unified-adaptive-control-lease-identity-v1",
    ...input
  });
}

export function parseUnifiedAdaptiveLiveCapacityStateV1(
  raw: string,
  input: {
    readonly candidateCommit: string;
    readonly executionIdentitySha256: string;
    readonly capacity: number;
  }
): UnifiedAdaptiveLiveCapacityStateV1 {
  const parsed = parseCanonicalResumeRecord(raw, [
    "version",
    "candidateCommit",
    "executionIdentitySha256",
    "capacity",
    "primaryBatchIdentitySha256",
    "primaryControlSha256",
    "primaryControlLeaseOwner",
    "primaryControlCreatedByRunId",
    "primaryControlLeaseIdentitySha256",
    "primaryRunIds",
    "lateBatchIdentitySha256",
    "lateControlSha256",
    "lateRunId",
    "stateSha256"
  ]) as unknown as UnifiedAdaptiveLiveCapacityStateV1;
  const { stateSha256, ...withoutHash } = parsed;
  if (
    parsed.version !== "unified-adaptive-live-capacity-state-v1" ||
    parsed.candidateCommit !== input.candidateCommit ||
    parsed.executionIdentitySha256 !==
      input.executionIdentitySha256 ||
    parsed.capacity !== input.capacity ||
    !/^[0-9a-f]{64}$/u.test(parsed.primaryBatchIdentitySha256) ||
    !/^[0-9a-f]{64}$/u.test(parsed.primaryControlSha256) ||
    !parsed.primaryControlLeaseOwner?.trim() ||
    !parsed.primaryControlCreatedByRunId?.trim() ||
    !/^[0-9a-f]{64}$/u.test(
      parsed.primaryControlLeaseIdentitySha256
    ) ||
    !/^[0-9a-f]{64}$/u.test(parsed.lateBatchIdentitySha256) ||
    parsed.lateControlSha256 !== parsed.primaryControlSha256 ||
    !parsed.lateRunId?.trim() ||
    !Array.isArray(parsed.primaryRunIds) ||
    parsed.primaryRunIds.length < 1 ||
    parsed.primaryRunIds.length > 4_096 ||
    parsed.primaryRunIds.some((runId) => !runId.trim()) ||
    new Set(parsed.primaryRunIds).size !== parsed.primaryRunIds.length ||
    parsed.primaryControlCreatedByRunId !== parsed.primaryRunIds[0] ||
    parsed.primaryRunIds.includes(parsed.lateRunId) ||
    unifiedBenchmarkControlLeaseIdentity({
      controlSha256: parsed.primaryControlSha256,
      leaseOwner: parsed.primaryControlLeaseOwner,
      createdByRunId: parsed.primaryControlCreatedByRunId
    }) !== parsed.primaryControlLeaseIdentitySha256 ||
    !/^[0-9a-f]{64}$/u.test(stateSha256) ||
    fingerprintCanonicalArtifact(withoutHash) !== stateSha256
  ) {
    throw new Error("unified_benchmark_existing_artifact_mismatch");
  }
  return parsed;
}

async function loadLiveCapacityState(
  path: string,
  candidateCommit: string,
  executionIdentitySha256: string,
  capacity: number
): Promise<UnifiedAdaptiveLiveCapacityStateV1 | null> {
  try {
    const raw = await readNoFollow(path);
    return parseUnifiedAdaptiveLiveCapacityStateV1(raw, {
      candidateCommit,
      executionIdentitySha256,
      capacity
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function loadLivePrimaryState(
  path: string,
  candidateCommit: string,
  executionIdentitySha256: string,
  capacity: number
): Promise<UnifiedAdaptiveLivePrimaryStateV1 | null> {
  try {
    const raw = await readNoFollow(path);
    const parsed = parseCanonicalResumeRecord(raw, [
      "version",
      "candidateCommit",
      "executionIdentitySha256",
      "capacity",
      "batchIdentitySha256",
      "controlSha256",
      "leaseOwner",
      "runIds",
      "stateSha256"
    ]) as unknown as UnifiedAdaptiveLivePrimaryStateV1;
    const { stateSha256, ...withoutHash } = parsed;
    if (
      parsed.version !== "unified-adaptive-live-primary-state-v1" ||
      parsed.candidateCommit !== candidateCommit ||
      parsed.executionIdentitySha256 !== executionIdentitySha256 ||
      parsed.capacity !== capacity ||
      !/^[0-9a-f]{64}$/u.test(parsed.batchIdentitySha256) ||
      !/^[0-9a-f]{64}$/u.test(parsed.controlSha256) ||
      !parsed.leaseOwner?.trim() ||
      !Array.isArray(parsed.runIds) ||
      parsed.runIds.length < 1 ||
      parsed.runIds.length > 4_096 ||
      parsed.runIds.some((runId) => !runId.trim()) ||
      new Set(parsed.runIds).size !== parsed.runIds.length ||
      !/^[0-9a-f]{64}$/u.test(stateSha256) ||
      fingerprintCanonicalArtifact(withoutHash) !== stateSha256
    ) {
      throw new Error("unified_benchmark_existing_artifact_mismatch");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function loadLiveLateState(
  path: string,
  candidateCommit: string,
  executionIdentitySha256: string,
  capacity: number
): Promise<UnifiedAdaptiveLiveLateStateV1 | null> {
  try {
    const raw = await readNoFollow(path);
    const parsed = parseCanonicalResumeRecord(raw, [
      "version",
      "candidateCommit",
      "executionIdentitySha256",
      "capacity",
      "batchIdentitySha256",
      "controlSha256",
      "runId",
      "stateSha256"
    ]) as unknown as UnifiedAdaptiveLiveLateStateV1;
    const { stateSha256, ...withoutHash } = parsed;
    if (
      parsed.version !== "unified-adaptive-live-late-state-v1" ||
      parsed.candidateCommit !== candidateCommit ||
      parsed.executionIdentitySha256 !== executionIdentitySha256 ||
      parsed.capacity !== capacity ||
      !/^[0-9a-f]{64}$/u.test(parsed.batchIdentitySha256) ||
      !/^[0-9a-f]{64}$/u.test(parsed.controlSha256) ||
      !parsed.runId?.trim() ||
      !/^[0-9a-f]{64}$/u.test(stateSha256) ||
      fingerprintCanonicalArtifact(withoutHash) !== stateSha256
    ) {
      throw new Error("unified_benchmark_existing_artifact_mismatch");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function deterministicOrder<T>(
  values: readonly T[],
  seed: number
): T[] {
  let state = seed >>> 0;
  const output = [...values];
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  for (let index = output.length - 1; index > 0; index -= 1) {
    const other = next() % (index + 1);
    [output[index], output[other]] = [output[other]!, output[index]!];
  }
  return output;
}

function walletCount(kind: ReplayScenarioKind): number {
  if (kind === "one_dense_wallet") return 1;
  if (kind === "fifteen_dense_wallets") return 15;
  return 3;
}

function replayEventPlan(
  kind: ReplayScenarioKind,
  capacity: number,
  seed: number,
  requests: ReturnType<typeof parseUnifiedProviderReplayV1>["requests"]
): UnifiedAdaptiveBenchmarkEventPlan {
  const count = walletCount(kind);
  const ordered = deterministicOrder(requests, seed + capacity);
  const runs: Array<
    UnifiedAdaptiveBenchmarkEventPlan["runs"][number]
  > = Array.from(
    { length: count },
    (_, index) => ({
      runId: `run-${index + 1}`,
      ownerId: `owner-${index + 1}`,
      lane: "interactive",
      activeAtRound:
        kind === "late_interactive" && index === count - 1 ? 2 : 0,
      requests: ordered.map((request, requestIndex) => ({
        id: `run-${index + 1}:request-${requestIndex + 1}`,
        requestIdentity: request.canonicalRequestSha256
      }))
    })
  );
  if (kind === "repair_arrival_capacity_one") {
    runs.push({
      runId: "repair-run",
      ownerId: "repair-owner",
      lane: "repair",
      activeAtRound: 1,
      requests: [{
        id: "repair-run:request-1",
        requestIdentity: ordered[0]!.canonicalRequestSha256
      }]
    });
  }
  return {
    capacity,
    seed,
    runs,
    cooldownAtRound: kind === "provider_cooldown" ? 1 : null,
    restartAtRound: kind === "restart_recovery" ? 2 : null,
    slowCanonicalHead: kind === "slow_canonical_head",
    commitEveryRounds: kind === "full_merge_buffer" ? 5 : 1
  };
}

async function resolveRuntimeCommit(
  runtime: UnifiedAdaptiveBenchmarkRuntime
): Promise<string> {
  const configured = runtime.runtimeCommit ??
    process.env.RUNTIME_GIT_SHA?.toLowerCase();
  if (configured !== undefined) {
    if (!/^[0-9a-f]{40}$/u.test(configured)) {
      throw new Error("unified_benchmark_runtime_commit_invalid");
    }
    return configured;
  }
  try {
    const result = await execFileAsync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8"
    });
    const commit = result.stdout.trim().toLowerCase();
    if (/^[0-9a-f]{40}$/u.test(commit)) return commit;
  } catch {
    // Fail closed below: a benchmark identity cannot use a placeholder commit.
  }
  throw new Error("unified_benchmark_runtime_commit_unavailable");
}

function highestObservedReplayBlock(
  replay: ReturnType<typeof parseUnifiedProviderReplayV1>
): string {
  const blocks = replay.responses.flatMap((response) => {
    const artifact = response.artifact as {
      readonly transfers?: readonly { readonly block?: unknown }[];
    };
    return (artifact.transfers ?? []).flatMap((transfer) =>
      typeof transfer.block === "string" && /^[0-9]+$/u.test(transfer.block)
        ? [BigInt(transfer.block)]
        : []
    );
  });
  if (blocks.length === 0) {
    throw new Error("unified_benchmark_replay_snapshot_block_missing");
  }
  return blocks.reduce((maximum, block) =>
    block > maximum ? block : maximum
  ).toString();
}

async function loadReplayFixture(policy: TraversalPolicy): Promise<{
  readonly canonicalJson: string;
  readonly envelope: ReturnType<typeof parseUnifiedProviderReplayV1>;
}> {
  const path = fileURLToPath(new URL(
    "../tests/fixtures/unified-wallet/" +
    (policy === "snapshot-closure-v1"
      ? "adaptive-rolling-provider-replay.json"
      : "adaptive-rolling-provider-replay-v2.json"),
    import.meta.url
  ));
  const file = await readFile(path, "utf8");
  const canonicalJson = file.endsWith("\n") ? file.slice(0, -1) : file;
  return {
    canonicalJson,
    envelope: parseUnifiedProviderReplayV1(canonicalJson)
  };
}

async function runReplayScenario(input: {
  readonly canonicalReplay: string;
  readonly replay: ReturnType<typeof parseUnifiedProviderReplayV1>;
  readonly kind: ReplayScenarioKind;
  readonly capacity: number;
  readonly seed: number;
  readonly scenarioId: string;
  readonly oracleReceipt: UnifiedRollingOracleReceiptV1;
  readonly runtimeCommit: string;
}): Promise<UnifiedAdaptiveBenchmarkEvidenceV1> {
  const startedAt = performance.now();
  const replayer = createUnifiedProviderReplayerV1(input.canonicalReplay);
  const count = walletCount(input.kind);
  const requestByIdentity = new Map(input.replay.requests.map((request) => [
    request.canonicalRequestSha256,
    request
  ]));
  const observed = await runUnifiedAdaptiveBenchmarkEvents({
    plan: replayEventPlan(
      input.kind,
      input.capacity,
      input.seed,
      input.replay.requests
    ),
    async executeReplay(requestIdentity) {
      const request = requestByIdentity.get(requestIdentity);
      if (!request) {
        throw new Error("unified_benchmark_replay_request_missing");
      }
      const artifact = replayer.replayByIdentity({
        endpoint: request.endpoint,
        canonicalRequestSha256: request.canonicalRequestSha256
      });
      return {
        responseBytes: Buffer.byteLength(
          canonicalizeArtifactJson(artifact),
          "utf8"
        )
      };
    }
  });
  const wallTimeMs = Math.max(performance.now() - startedAt, 0.001);
  const memory = process.memoryUsage();
  const performanceManifest = buildUnifiedPerformanceBenchmarkManifest({
    version: "unified-performance-benchmark-input-v1",
    caseId: input.scenarioId,
    runId: `${input.scenarioId}:seed:${input.seed}`,
    frozenClockIso: input.replay.frozenClockIso,
    snapshot: {
      blockNumber: highestObservedReplayBlock(input.replay),
      blockHash: input.replay.sourceSnapshotSha256,
      timestamp: input.replay.frozenAt
    },
    providerBundleSha256: input.replay.expectedReplaySha256,
    labelDatasetSha256:
      input.replay.deterministic.labelDatasetSha256,
    providerConfigurationSha256:
      input.replay.deterministic.providerConfigurationSha256,
    scoringPolicyVersion:
      input.replay.deterministic.scoringPolicyVersion,
    attributionPolicyVersion:
      input.replay.deterministic.attributionPolicyVersion,
    analysisPolicyVersion:
      input.replay.deterministic.traversalPolicyVersion,
    presentationPolicyVersion: "unified-presentation-v1",
    locale: "ru",
    deterministicIdSeed:
      `${input.replay.deterministic.runIdSeed}:${input.seed}`,
    runtimeCommit: input.runtimeCommit,
    checkpointVersion: "unified-production-traversal-checkpoint-v2",
    logicalChunkEvents: 250,
    providerSlots: input.capacity,
    harnessVersion: "unified-adaptive-benchmark-v1"
  });
  return sealUnifiedAdaptiveBenchmarkEvidenceV1({
    scenarioId: input.scenarioId,
    scenarioKind: input.kind,
    completedAt: input.replay.frozenClockIso,
    mode: "replay",
    admissionPolicy: "rolling",
    sideEffectPolicy: "isolated",
    requestedCapacity: input.capacity,
    actualAuditedIndependentGroupCapacity: input.capacity,
    independentGroupAudit: null,
    performanceManifest,
    timing: {
      wallTimeMs,
      aggregateThroughputPerSecond: count / (wallTimeMs / 1_000)
    },
    capacity: observed.capacity,
    provider: {
      rollingRps: observed.provider.requests / (wallTimeMs / 1_000),
      ...observed.provider
    },
    limiting: observed.limiting,
    buffer: observed.buffer,
    database: {
      latencyMs: null,
      checkpointLatencyMs: null,
      poolWaitMs: null
    },
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      availableContainerBytes: freemem(),
      availableHostBytes: freemem()
    },
    repair: observed.repair,
    reuse: observed.reuse,
    restartRecovery: observed.restartRecovery,
    oracle: {
      replaySha256: input.replay.expectedReplaySha256,
      oracleSha256: fingerprintCanonicalArtifact(
        input.oracleReceipt.barrierFacts
      ),
      receiptSha256: input.oracleReceipt.receiptSha256,
      exactEquivalent: true
    },
    runtimeObservationArtifactSha256s: [],
    scenarioSymptomArtifactSha256s: [],
    liveOutcomes: [],
    measurement: {
      timing: "observed",
      provider: "simulated",
      database: "not_applicable",
      memory: "observed",
      lifecycle: "simulated",
      delivery: "simulated"
    },
    delivery: {
      eligibleRequests: count,
      deliveryIntents: 0,
      externalTelegramSends: 0
    }
  }).envelope;
}

function scenarioFileName(index: number, scenarioId: string): string {
  return [
    String(index + 1).padStart(3, "0"),
    fingerprintCanonicalArtifact({
      version: "unified-benchmark-scenario-identity-v1",
      scenarioId
    }).slice(0, 16)
  ].join("-") + ".json";
}

async function loadCompletedScenario(input: {
  readonly path: string;
  readonly scenarioId: string;
  readonly capacity: number;
  readonly seed: number;
  readonly replaySha256: string;
  readonly oracleSha256: string;
  readonly receiptSha256: string;
  readonly runtimeCommit: string;
  readonly providerConfigurationSha256: string;
}): Promise<UnifiedAdaptiveBenchmarkEvidenceV1 | null> {
  try {
    await rejectSymlink(input.path);
    const bytes = await readNoFollow(input.path);
    const canonical = bytes.endsWith("\n") ? bytes.slice(0, -1) : bytes;
    const evidence = parseUnifiedAdaptiveBenchmarkEvidenceV1(canonical);
    if (
      evidence.scenarioId !== input.scenarioId ||
      evidence.mode !== "replay" ||
      evidence.admissionPolicy !== "rolling" ||
      evidence.requestedCapacity !== input.capacity ||
      evidence.performanceManifest.runId !==
        `${input.scenarioId}:seed:${input.seed}` ||
      evidence.oracle?.replaySha256 !== input.replaySha256 ||
      evidence.oracle?.oracleSha256 !== input.oracleSha256 ||
      evidence.oracle?.receiptSha256 !== input.receiptSha256 ||
      evidence.performanceManifest.executionIdentitySha256 !==
        fingerprintCanonicalArtifact({
          version: "unified-performance-execution-identity-v1",
          semanticIdentitySha256:
            evidence.performanceManifest.semanticIdentitySha256,
          providerConfigurationSha256:
            input.providerConfigurationSha256,
          runtimeCommit: input.runtimeCommit,
          checkpointVersion:
            "unified-production-traversal-checkpoint-v2",
          logicalChunkEvents: 250,
          providerSlots: input.capacity,
          harnessVersion: "unified-adaptive-benchmark-v1"
        })
    ) {
      throw new Error("unified_benchmark_existing_artifact_mismatch");
    }
    return evidence;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (
      error instanceof Error &&
      error.message === "unified_benchmark_existing_artifact_mismatch"
    ) {
      throw error;
    }
    throw new Error(
      "unified_benchmark_existing_artifact_mismatch",
      { cause: error }
    );
  }
}

function indexEnvelope(input: {
  readonly mode: "replay" | "live";
  readonly seed: number;
  readonly capacities: readonly number[];
  readonly candidateCommit: string;
  readonly executionIdentitySha256: string;
  readonly generatedAt: string;
  readonly artifacts: UnifiedAdaptiveBenchmarkIndexV1["artifacts"];
}): UnifiedAdaptiveBenchmarkIndexV1 {
  const withoutHash = {
    version: "unified-adaptive-benchmark-index-v1" as const,
    mode: input.mode,
    seed: input.seed,
    requestedCapacities: input.capacities,
    candidateCommit: input.candidateCommit,
    executionIdentitySha256: input.executionIdentitySha256,
    generatedAt: input.generatedAt,
    artifacts: input.artifacts
  };
  return {
    ...withoutHash,
    indexSha256: fingerprintCanonicalArtifact(withoutHash)
  };
}

function benchmarkExecutionIdentity(input: {
  readonly mode: "replay" | "live";
  readonly seed: number;
  readonly capacities: readonly number[];
  readonly candidateCommit: string;
  readonly sourceIdentitySha256: string;
  readonly traversalPolicy: TraversalPolicy;
  readonly scenarioIds: readonly string[];
}): string {
  return fingerprintCanonicalArtifact({
    version: "unified-adaptive-benchmark-execution-identity-v1",
    mode: input.mode,
    seed: input.seed,
    requestedCapacities: input.capacities,
    candidateCommit: input.candidateCommit,
    sourceIdentitySha256: input.sourceIdentitySha256,
    traversalPolicyVersion: input.traversalPolicy,
    scenarioIds: [...input.scenarioIds].sort()
  });
}

async function validateLivePrerequisites(
  options: CliOptions
): Promise<ReturnType<typeof parseUnifiedProviderGroupAuditV1>> {
  const auditPath = resolve(options.providerAuditPath!);
  const bytes = await readFile(auditPath, "utf8");
  const audit = parseUnifiedProviderGroupAuditV1(
    bytes.endsWith("\n") ? bytes.slice(0, -1) : bytes
  );
  const healthyGroups = audit.groups.filter((group) =>
    group.state === "healthy" && group.concurrencyLimit > 0
  ).length;
  if (options.capacities.some((capacity) => capacity > healthyGroups)) {
    throw new Error("unified_benchmark_live_capacity_unaudited");
  }
  return audit;
}

async function loadCompletedLiveIndex(input: {
  readonly output: string;
  readonly capacities: readonly number[];
  readonly candidateCommit: string;
  readonly executionIdentitySha256: string;
  readonly providerAudit:
    ReturnType<typeof parseUnifiedProviderGroupAuditV1>;
  readonly scenarios: readonly (typeof UNIFIED_ADAPTIVE_LIVE_SCENARIOS[number])[];
  readonly traversalPolicy: TraversalPolicy;
}): Promise<UnifiedAdaptiveBenchmarkIndex | null> {
  let raw: string;
  try {
    await rejectSymlink(input.output);
    raw = await readNoFollow(input.output);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const selected = input.scenarios.length === 1 &&
      input.scenarios[0] === SELECTED_LIVE_SCENARIO;
    const canonical = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
    const parsed: UnifiedAdaptiveBenchmarkIndex = selected
      ? parseUnifiedSelectedAdaptiveBenchmarkIndexV2(canonical)
      : parseCanonicalResumeRecord(raw, [
          "version",
          "mode",
          "seed",
          "requestedCapacities",
          "candidateCommit",
          "executionIdentitySha256",
          "generatedAt",
          "artifacts",
          "indexSha256"
        ]) as unknown as UnifiedAdaptiveBenchmarkIndexV1;
    const expectedScenarios = input.capacities.flatMap((capacity) =>
      input.scenarios.map((kind) => ({
        scenarioId: `live:c${capacity}:${kind}`,
        capacity
      }))
    );
    if (
      (
        selected
          ? parsed.version !== "unified-adaptive-benchmark-index-v2"
          : parsed.version !== "unified-adaptive-benchmark-index-v1"
      ) ||
      parsed.mode !== "live" ||
      parsed.seed !== 1 ||
      parsed.candidateCommit !== input.candidateCommit ||
      parsed.executionIdentitySha256 !== input.executionIdentitySha256 ||
      !Number.isFinite(Date.parse(parsed.generatedAt)) ||
      !Array.isArray(parsed.requestedCapacities) ||
      parsed.requestedCapacities.length !== input.capacities.length ||
      parsed.requestedCapacities.some((value, index) =>
        value !== input.capacities[index]
      ) ||
      !Array.isArray(parsed.artifacts) ||
      parsed.artifacts.length !== expectedScenarios.length ||
      (
        parsed.version === "unified-adaptive-benchmark-index-v1" &&
        parsed.indexSha256 !== fingerprintCanonicalArtifact({
          version: parsed.version,
          mode: parsed.mode,
          seed: parsed.seed,
          requestedCapacities: parsed.requestedCapacities,
          candidateCommit: parsed.candidateCommit,
          executionIdentitySha256: parsed.executionIdentitySha256,
          generatedAt: parsed.generatedAt,
          artifacts: parsed.artifacts
        })
      )
    ) {
      throw new Error("unified_benchmark_existing_artifact_mismatch");
    }
    const outputDirectory = dirname(input.output);
    const scenarioDirectory = resolve(
      outputDirectory,
      `${parse(input.output).name}.scenarios`
    );
    for (const [index, artifact] of parsed.artifacts.entries()) {
      if (
        typeof artifact !== "object" ||
        artifact === null ||
        Object.keys(artifact).some((key) => ![
          "scenarioId",
          "evidenceSha256",
          "candidateCommit",
          "executionIdentitySha256",
          "relativePath",
          ...(selected ? [
            "refillArtifactSha256",
            "refillArtifactCreatedByRunId",
            "selectedRefillEvidenceSha256",
            "selectedRefillEvidenceRelativePath"
          ] : [])
        ].includes(key))
      ) {
        throw new Error("unified_benchmark_existing_artifact_mismatch");
      }
      const expected = expectedScenarios[index]!;
      if (
        artifact.scenarioId !== expected.scenarioId ||
        !/^[0-9a-f]{64}$/u.test(artifact.evidenceSha256) ||
        artifact.candidateCommit !== input.candidateCommit ||
        !/^[0-9a-f]{64}$/u.test(artifact.executionIdentitySha256) ||
        !artifact.relativePath.endsWith(".json") ||
        artifact.relativePath.includes("\\") ||
        isAbsolute(artifact.relativePath)
      ) {
        throw new Error("unified_benchmark_existing_artifact_mismatch");
      }
      const evidencePath = resolve(outputDirectory, artifact.relativePath);
      const pathFromOutput = relative(outputDirectory, evidencePath);
      if (
        pathFromOutput.startsWith("..") ||
        isAbsolute(pathFromOutput) ||
        dirname(evidencePath) !== scenarioDirectory
      ) {
        throw new Error("unified_benchmark_existing_artifact_mismatch");
      }
      await rejectSymlink(evidencePath);
      const evidenceRaw = await readNoFollow(evidencePath);
      const evidence = parseUnifiedAdaptiveBenchmarkEvidenceV1(
        evidenceRaw.endsWith("\n")
          ? evidenceRaw.slice(0, -1)
          : evidenceRaw
      );
      if (
        evidence.scenarioId !== expected.scenarioId ||
        evidence.mode !== "live" ||
        evidence.admissionPolicy !== "rolling" ||
        evidence.sideEffectPolicy !== "isolated" ||
        evidence.requestedCapacity !== expected.capacity ||
        evidence.evidenceSha256 !== artifact.evidenceSha256 ||
        evidence.performanceManifest.executionIdentitySha256 !==
          artifact.executionIdentitySha256 ||
        evidence.independentGroupAudit?.auditSha256 !==
          input.providerAudit.auditSha256
      ) {
        throw new Error("unified_benchmark_existing_artifact_mismatch");
      }
      const runIds = new Set(evidence.liveOutcomes.map((item) =>
        item.runId
      ));
      const controls = new Set(evidence.liveOutcomes.map((item) =>
        item.benchmarkControlSha256
      ));
      const controlSha256 = [...controls][0];
      if (runIds.size < 1 || controls.size !== 1 || !controlSha256) {
        throw new Error("unified_benchmark_existing_artifact_mismatch");
      }
      const observedRunIds = new Set<string>();
      const exportedObservations: UnifiedAdaptiveBenchmarkRuntimeObservationArtifactV1[] = [];
      for (
        const sha256 of
        evidence.runtimeObservationArtifactSha256s
      ) {
        const exportedPath = resolve(
          scenarioDirectory,
          `observation-${sha256}.json`
        );
        await rejectSymlink(exportedPath);
        const exportedRaw = await readNoFollow(exportedPath);
        const canonical = exportedRaw.endsWith("\n")
          ? exportedRaw.slice(0, -1)
          : exportedRaw;
        const observation =
          parseUnifiedAdaptiveBenchmarkRuntimeObservationV1(canonical);
        if (
          fingerprintCanonicalArtifact(observation) !== sha256 ||
          observation.controlSha256 !== controlSha256 ||
          observation.runs.length < 1 ||
          observation.runs.some((run) => !runIds.has(run.runId))
        ) {
          throw new Error(
            "unified_benchmark_existing_artifact_mismatch"
          );
        }
        for (const run of observation.runs) observedRunIds.add(run.runId);
        exportedObservations.push({ sha256, observation });
      }
      const kind = expected.scenarioId.slice(
        `live:c${expected.capacity}:`.length
      );
      const expectedPhase =
        kind === "provider_cooldown"
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
      for (const sha256 of evidence.scenarioSymptomArtifactSha256s) {
        const exportedPath = resolve(
          scenarioDirectory,
          `symptom-${sha256}.json`
        );
        await rejectSymlink(exportedPath);
        const exportedRaw = await readNoFollow(exportedPath);
        const canonical = exportedRaw.endsWith("\n")
          ? exportedRaw.slice(0, -1)
          : exportedRaw;
        const symptom =
          parseUnifiedAdaptiveBenchmarkScenarioSymptomV1(canonical);
        if (
          fingerprintCanonicalArtifact(symptom) !== sha256 ||
          symptom.controlSha256 !== controlSha256 ||
          !runIds.has(symptom.runId) ||
          symptom.scenarioId !== kind ||
          symptom.phase !== expectedPhase ||
          !evidence.runtimeObservationArtifactSha256s.includes(
            symptom.observationArtifactSha256
          )
        ) {
          throw new Error(
            "unified_benchmark_existing_artifact_mismatch"
          );
        }
      }
      if (
        kind === SELECTED_LIVE_SCENARIO &&
        input.scenarios.length === 1
      ) {
        if (parsed.version !== "unified-adaptive-benchmark-index-v2") {
          throw new Error("unified_benchmark_existing_artifact_mismatch");
        }
        const selectedArtifact = artifact as
          UnifiedSelectedAdaptiveBenchmarkIndexV2["artifacts"][number];
        const relativeExportPath = selectedArtifact
          .selectedRefillEvidenceRelativePath;
        const exportPath = resolve(outputDirectory, relativeExportPath);
        if (
          relative(outputDirectory, exportPath).startsWith("..") ||
          isAbsolute(relative(outputDirectory, exportPath)) ||
          dirname(exportPath) !== scenarioDirectory
        ) {
          throw new Error("unified_benchmark_existing_artifact_mismatch");
        }
        await rejectSymlink(exportPath);
        const exportRaw = await readNoFollow(exportPath);
        const selectedEvidence =
          parseUnifiedSelectedRefillExportEvidenceV1(
            exportRaw.endsWith("\n") ? exportRaw.slice(0, -1) : exportRaw
          );
        const liveOutcome = evidence.liveOutcomes[0];
        if (
          !liveOutcome ||
          selectedEvidence.evidenceSha256 !==
            selectedArtifact.selectedRefillEvidenceSha256 ||
          selectedEvidence.refillArtifactSha256 !==
            selectedArtifact.refillArtifactSha256 ||
          selectedEvidence.refillArtifactCreatedByRunId !==
            selectedArtifact.refillArtifactCreatedByRunId ||
          selectedEvidence.scenarioId !== expected.scenarioId ||
          selectedEvidence.executionIdentitySha256 !==
            input.executionIdentitySha256 ||
          selectedEvidence.candidateCommit !== input.candidateCommit ||
          selectedEvidence.traversalPolicyVersion !== input.traversalPolicy ||
          selectedEvidence.benchmarkEvidenceSha256 !==
            evidence.evidenceSha256 ||
          selectedEvidence.benchmarkEvidenceRelativePath !==
            artifact.relativePath ||
          selectedEvidence.runId !== liveOutcome.runId ||
          selectedEvidence.refillArtifactCreatedByRunId !==
            liveOutcome.runId ||
          selectedEvidence.controlSha256 !== controlSha256
        ) {
          throw new Error("unified_benchmark_existing_artifact_mismatch");
        }
        const refillPath = resolve(
          outputDirectory,
          selectedEvidence.refillArtifactRelativePath
        );
        if (
          relative(outputDirectory, refillPath).startsWith("..") ||
          isAbsolute(relative(outputDirectory, refillPath)) ||
          dirname(refillPath) !== scenarioDirectory
        ) {
          throw new Error("unified_benchmark_existing_artifact_mismatch");
        }
        await rejectSymlink(refillPath);
        const refillRaw = await readNoFollow(refillPath);
        const refill = parseUnifiedProviderRefillObservationV1(
          refillRaw.endsWith("\n")
            ? refillRaw.slice(0, -1)
            : refillRaw
        );
        const latest = exportedObservations.map((item) => item.observation)
          .sort((left, right) =>
            left.provider.requests - right.provider.requests ||
            Date.parse(left.observedAt) - Date.parse(right.observedAt)
          ).at(-1);
        if (
          !latest ||
          fingerprintCanonicalArtifact(refill) !==
            selectedEvidence.refillArtifactSha256 ||
          refill.controlSha256 !== controlSha256 ||
          refill.runtimeCommit !== input.candidateCommit ||
          refill.providerConfigurationSha256 !==
            selectedEvidence.providerConfigurationSha256 ||
          refill.memoryEvidence.samplesSha256 !==
            selectedEvidence.memoryEvidence.samplesSha256 ||
          refill.memoryEvidence.summarySha256 !==
            selectedEvidence.memoryEvidence.summarySha256
        ) {
          throw new Error("unified_benchmark_existing_artifact_mismatch");
        }
        const memoryFile = async (
          relativePath: string,
          expectedSha256: string
        ) => {
          const path = resolve(outputDirectory, relativePath);
          if (
            relative(outputDirectory, path).startsWith("..") ||
            isAbsolute(relative(outputDirectory, path)) ||
            dirname(path) !== scenarioDirectory
          ) {
            throw new Error("unified_benchmark_existing_artifact_mismatch");
          }
          await rejectSymlink(path);
          const bytes = await readNoFollow(path);
          if (
            createHash("sha256").update(bytes).digest("hex") !==
              expectedSha256
          ) {
            throw new Error("unified_benchmark_existing_artifact_mismatch");
          }
          return bytes;
        };
        const [samplesBytes, summaryBytes] = await Promise.all([
          memoryFile(
            selectedEvidence.memoryEvidence.samplesRelativePath,
            selectedEvidence.memoryEvidence.samplesSha256
          ),
          memoryFile(
            selectedEvidence.memoryEvidence.summaryRelativePath,
            selectedEvidence.memoryEvidence.summarySha256
          )
        ]);
        if (validateMemoryEvidenceFiles({
          samplesBytes,
          summaryBytes,
          runId: liveOutcome.runId,
          scenarioId: SELECTED_LIVE_SCENARIO,
          nodePid: selectedEvidence.memoryEvidence.nodePid
        }) !== refill.memoryEvidence.diagnosticStatus) {
          throw new Error("unified_benchmark_existing_artifact_mismatch");
        }
        assertUnifiedSelectedDenseRefillEvidence({
          saturated: refill.saturated,
          auditedGroupIds: liveOutcome.auditedGroupIds,
          dispatchedGroupIds: liveOutcome.dispatchedGroupIds,
          providerErrors: evidence.provider.errors,
          rateLimited429: evidence.provider.rateLimited429,
          deliveryIntents: evidence.delivery.deliveryIntents,
          externalSends: evidence.delivery.externalTelegramSends,
          reconciliationRecoveries:
            evidence.restartRecovery.reconciliationRecoveries
        });
      }
      if ([...runIds].some((runId) => !observedRunIds.has(runId))) {
        throw new Error("unified_benchmark_existing_artifact_mismatch");
      }
    }
    return parsed;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "unified_benchmark_existing_artifact_mismatch"
    ) {
      throw error;
    }
    throw new Error(
      "unified_benchmark_existing_artifact_mismatch",
      { cause: error }
    );
  }
}

async function resolveReplayOracleReceipt(
  options: CliOptions,
  runtime: UnifiedAdaptiveBenchmarkRuntime,
  replaySha256: string
): Promise<UnifiedRollingOracleReceiptV1> {
  let candidate: UnifiedRollingOracleReceiptV1;
  if (runtime.resolveReplayOracleReceipt) {
    candidate = await runtime.resolveReplayOracleReceipt({
      replaySha256,
      seed: options.seed,
      requestedCapacities: options.capacities
    });
  } else {
    if (options.oracleReceiptPath === null) {
      throw new Error(
        "unified_benchmark_replay_oracle_receipt_required"
      );
    }
    const bytes = await readFile(resolve(options.oracleReceiptPath), "utf8");
    candidate = parseUnifiedRollingOracleReceiptV1(
      bytes.endsWith("\n") ? bytes.slice(0, -1) : bytes
    );
  }
  const verified = parseUnifiedRollingOracleReceiptV1(
    canonicalizeArtifactJson(candidate)
  );
  if (
    verified.replaySha256 !== replaySha256 ||
    verified.seed !== options.seed ||
    options.capacities.some((capacity) =>
      !verified.rollingFacts.some((row) => row.capacity === capacity)
    )
  ) {
    throw new Error("unified_benchmark_replay_oracle_receipt_mismatch");
  }
  return verified;
}

export async function runSelectedIsolatedCanaryBenchmark(input: {
  readonly requestedCapacities: readonly number[];
  readonly output: string;
  readonly candidateCommit: string;
  readonly executionIdentitySha256: string;
  readonly providerAudit:
    ReturnType<typeof parseUnifiedProviderGroupAuditV1>;
  readonly traversalPolicy: TraversalPolicy;
  readonly memoryEvidenceDir: string;
  readonly runCanary: typeof import("./runUnifiedWalletCanary")["runUnifiedWalletCanaryCli"];
  readonly memoryCapture?: Pick<
    ReturnType<typeof createUnifiedBenchmarkMemoryCapture>,
    "before" | "during" | "after"
  >;
}): Promise<UnifiedSelectedAdaptiveBenchmarkIndexV2> {
  if (
    input.requestedCapacities.length !== 1 ||
    input.requestedCapacities[0] !== 4
  ) {
    throw new Error("unified_benchmark_selected_capacity_invalid");
  }
  const capacity = 4;
  const auditedGroupIds = input.providerAudit.groups
    .filter((group) =>
      group.state === "healthy" && group.concurrencyLimit > 0
    )
    .sort((left, right) =>
      left.opaqueGroupId.localeCompare(right.opaqueGroupId)
    )
    .slice(0, capacity)
    .map((group) => group.opaqueGroupId);
  const outputDirectory = dirname(input.output);
  const scenarioDirectory = resolve(
    outputDirectory,
    `${parse(input.output).name}.scenarios`
  );
  await mkdirNoFollow(scenarioDirectory);
  const memoryCapture = input.memoryCapture ??
    createUnifiedBenchmarkMemoryCapture({
      directory: input.memoryEvidenceDir,
      scenarioId: SELECTED_LIVE_SCENARIO
    });
  let runId = "";
  let controlSha256 = "";
  const refillArtifacts: {
    readonly sha256: string;
    readonly createdByRunId: string;
    readonly observation: import("../src/unifiedCheck/adaptiveBenchmarkControl")
      .UnifiedProviderRefillObservationV1;
  }[] = [];
  const capturedMemoryHolder: {
    value: Awaited<ReturnType<
      ReturnType<typeof createUnifiedBenchmarkMemoryCapture>["after"]
    >> | null;
  } = { value: null };
  const canary = await input.runCanary([
    "--candidate", input.candidateCommit,
    "--cutoff", new Date().toISOString(),
    "--output", resolve(
      outputDirectory,
      `${parse(input.output).name}.canary-selected-txc`
    )
  ], {
    emitResult: false,
    traversalPolicyVersion: input.traversalPolicy,
    explicitBenchmarkScenarios: [{
      scenarioId: SELECTED_LIVE_SCENARIO,
      subjectAddress: SELECTED_LIVE_SCENARIO.slice("isolated:".length),
      locale: "ru"
    }],
    async onBatchReady(batch) {
      if (batch.runIds.length !== 1) {
        throw new Error("unified_benchmark_selected_run_count_invalid");
      }
      runId = batch.runIds[0]!;
      await memoryCapture.before(runId);
      const now = new Date();
      const installed = await installUnifiedAdaptiveBenchmarkControl({
        db: createUnifiedPoolTransactionHost(batch.db),
        leaseOwner: randomUUID(),
        now,
        expiresAt: new Date(now.getTime() +
          UNIFIED_BENCHMARK_CONTROL_LEASE_MS),
        runtimeCommit: input.candidateCommit,
        providerConfigurationSha256:
          batch.providerConfigurationSha256,
        capacity,
        auditedGroupIds,
        runPlans: [{
          runId,
          scenarioId: SELECTED_LIVE_SCENARIO,
          fault: "none",
          faultUntil: null
        }]
      });
      controlSha256 = installed.sha256;
      return {
        benchmarkControlSha256: installed.sha256,
        release: installed.release
      };
    },
    async onProgress({ runs }) {
      const providerKinds = new Set([
        "direct_history",
        "address_history",
        "deep_direct"
      ]);
      const claimed = runs.some((run) => run.id === runId &&
        run.tasks.some((task) =>
          providerKinds.has(task.kind) &&
          (
            task.status === "LEASED" ||
            task.attemptDurations.length > 0
          )
        ));
      if (claimed) await memoryCapture.during(runId);
    },
    async onComplete({
      db,
      runIds,
      benchmarkControlSha256,
      providerConfigurationSha256,
      outcomes
    }) {
      if (
        runIds.length !== 1 ||
        runIds[0] !== runId ||
        benchmarkControlSha256 !== controlSha256 ||
        outcomes.length !== 1
      ) {
        throw new Error("unified_benchmark_selected_binding_invalid");
      }
      const memoryCaptureResult = await memoryCapture.after(runId);
      capturedMemoryHolder.value = memoryCaptureResult;
      const memoryEvidence = {
        samplesSha256: memoryCaptureResult.samplesSha256,
        summarySha256: memoryCaptureResult.summarySha256,
        diagnosticStatus: memoryCaptureResult.diagnosticStatus
      };
      const [samples, observations] = await Promise.all([
        listUnifiedProviderRefillRuntimeSamples({
          db,
          controlSha256,
          runtimeCommit: input.candidateCommit,
          providerConfigurationSha256,
          runIds
        }),
        listUnifiedAdaptiveBenchmarkObservationArtifacts({
          db,
          controlSha256,
          runIds
        })
      ]);
      if (samples.length < 1 || observations.length < 1) {
        throw new Error("unified_benchmark_selected_refill_missing");
      }
      const saturated = summarizeUnifiedProviderSaturationSamples(
        samples.map((sample) => sample.saturationSample)
      );
      const latestRuntime = observations.map((item) => item.observation)
        .sort((left, right) =>
          left.provider.requests - right.provider.requests ||
          Date.parse(left.observedAt) - Date.parse(right.observedAt)
        ).at(-1)!;
      assertUnifiedSelectedDenseRefillEvidence({
        saturated,
        auditedGroupIds,
        dispatchedGroupIds: latestRuntime.provider.dispatchedGroupIds,
        providerErrors: latestRuntime.provider.errors,
        rateLimited429: latestRuntime.provider.rateLimited429,
        deliveryIntents: latestRuntime.integrity.deliveryIntents,
        externalSends: 0,
        reconciliationRecoveries:
          latestRuntime.lifecycle.reconciliationRecoveries
      });
      const observation = {
        version: "unified-provider-refill-observation-v1" as const,
        schemaVersion: 1 as const,
        controlSha256,
        observedAt: new Date().toISOString(),
        runtimeCommit: input.candidateCommit,
        providerConfigurationSha256,
        diagnostics: samples.at(-1)!.diagnostics,
        saturated,
        memoryEvidence
      };
      const sha256 = await persistUnifiedProviderRefillObservation({
        db,
        createdByRunId: runId,
        observation
      });
      refillArtifacts.push({
        sha256,
        createdByRunId: runId,
        observation
      });
    }
  });
  const refillArtifact = refillArtifacts[0];
  if (refillArtifact === undefined || refillArtifacts.length !== 1) {
    throw new Error("unified_benchmark_selected_refill_missing");
  }
  const capturedMemory = capturedMemoryHolder.value;
  if (capturedMemory === null) {
    throw new Error("unified_benchmark_selected_memory_missing");
  }
  const outcome = canary.outcomes[0];
  const result = canary.report.results[0];
  if (
    !outcome ||
    !result ||
    result.outcome !== "COMPLETED" ||
    outcome.score === null ||
    outcome.decision === null ||
    !outcome.evidenceBundleSha256 ||
    !outcome.traversalClosureSha256 ||
    !outcome.scoringBundleSha256 ||
    !outcome.reportSha256 ||
    canary.benchmarkObservationArtifacts.length < 1 ||
    canary.benchmarkScenarioSymptoms.length < 1
  ) {
    throw new Error("unified_benchmark_selected_result_incomplete");
  }
  const observations = canary.benchmarkObservationArtifacts;
  const runtimeTelemetry = observations.map((item) => item.observation)
    .sort((left, right) =>
      left.provider.requests - right.provider.requests ||
      Date.parse(left.observedAt) - Date.parse(right.observedAt)
    ).at(-1)!;
  const providerKinds = new Set([
    "direct_history",
    "address_history",
    "deep_direct"
  ]);
  const attempts = result.childAttempts.filter((attempt) =>
    providerKinds.has(attempt.kind)
  );
  const peak = calculateUnifiedBenchmarkPeakConcurrency(attempts);
  const eligibleDemand = Math.max(...observations.map((item) =>
    item.observation.runs.reduce((sum, run) =>
      sum + run.capacity.eligibleDemand, 0)
  ));
  const targetSlots = Math.max(...observations.map((item) =>
    item.observation.runs.reduce((sum, run) =>
      sum + run.capacity.targetSlots, 0)
  ));
  const actualSlots = Math.max(peak, ...observations.map((item) =>
    item.observation.runs.reduce((sum, run) =>
      sum + run.capacity.actualSlots, 0)
  ));
  if (
    targetSlots > capacity ||
    actualSlots > targetSlots ||
    targetSlots > eligibleDemand
  ) {
    throw new Error("unified_benchmark_selected_capacity_invalid");
  }
  const performanceManifest = buildUnifiedPerformanceBenchmarkManifest({
    version: "unified-performance-benchmark-input-v1",
    caseId: `live:c4:${SELECTED_LIVE_SCENARIO}`,
    runId,
    frozenClockIso: outcome.snapshot.timestamp,
    snapshot: outcome.snapshot,
    providerBundleSha256: controlSha256,
    labelDatasetSha256: outcome.labelDatasetSha256,
    providerConfigurationSha256:
      outcome.providerConfigurationSha256,
    scoringPolicyVersion: "scoring-signal-matrix-v4",
    attributionPolicyVersion: "selected-attribution-policy-v1",
    analysisPolicyVersion: completedCanaryTraversalPolicy([outcome]),
    presentationPolicyVersion: "unified-presentation-v1",
    locale: "ru",
    deterministicIdSeed: `live:c4:${SELECTED_LIVE_SCENARIO}`,
    runtimeCommit: input.candidateCommit,
    checkpointVersion: "unified-production-traversal-checkpoint-v2",
    logicalChunkEvents: Math.max(1, attempts.length),
    providerSlots: capacity,
    harnessVersion: "unified-adaptive-live-canary-v1"
  });
  const scenarioId = `live:c4:${SELECTED_LIVE_SCENARIO}`;
  const evidence = sealUnifiedAdaptiveBenchmarkEvidenceV1({
    scenarioId,
    scenarioKind: SELECTED_LIVE_SCENARIO,
    completedAt: canary.report.generatedAt,
    mode: "live",
    admissionPolicy: "rolling",
    sideEffectPolicy: "isolated",
    requestedCapacity: capacity,
    actualAuditedIndependentGroupCapacity: auditedGroupIds.length,
    independentGroupAudit: input.providerAudit,
    performanceManifest,
    timing: {
      wallTimeMs: Math.max(0.001, result.parentDurationMs),
      aggregateThroughputPerSecond:
        1 / Math.max(0.001, result.parentDurationMs / 1_000)
    },
    capacity: {
      eligibleDemand,
      targetSlots,
      actualSlots,
      utilization: targetSlots === 0 ? 0 : actualSlots / targetSlots
    },
    provider: {
      rollingRps: runtimeTelemetry.provider.requestsPerSecond,
      requests: runtimeTelemetry.provider.requests,
      errors: runtimeTelemetry.provider.errors,
      rateLimited429: runtimeTelemetry.provider.rateLimited429
    },
    limiting: {
      reason: observations.flatMap((item) =>
        item.observation.runs.map((run) => run.limitingReason)
      ).find((reason) => reason !== null) ?? null,
      canonicalHeadAgeMs: Math.max(0, ...observations.flatMap((item) =>
        item.observation.runs.flatMap((run) =>
          run.canonicalHeadAgeMs === null ? [] : [run.canonicalHeadAgeMs]
        )
      ))
    },
    buffer: {
      readyBytes: Math.max(...observations.map((item) =>
        item.observation.runs.reduce((sum, run) =>
          sum + run.buffer.readyBytes, 0)
      )),
      reservedBytes: Math.max(...observations.map((item) =>
        item.observation.runs.reduce((sum, run) =>
          sum + run.buffer.reservedBytes, 0)
      ))
    },
    database: {
      latencyMs: Math.max(...observations.map((item) =>
        item.observation.database.latencyMs
      )),
      checkpointLatencyMs: Math.max(...observations.map((item) =>
        item.observation.database.checkpointLatencyMs
      )),
      poolWaitMs: Math.max(...observations.map((item) =>
        item.observation.database.poolWaitMs
      ))
    },
    memory: {
      rssBytes: runtimeTelemetry.runtime.rssBytes,
      heapUsedBytes: runtimeTelemetry.runtime.heapUsedBytes,
      availableContainerBytes:
        runtimeTelemetry.runtime.availableContainerBytes,
      availableHostBytes: runtimeTelemetry.runtime.availableHostBytes
    },
    repair: { maxWaitMs: 0, maxWaitChunks: 0 },
    reuse: runtimeTelemetry.reuse,
    restartRecovery: {
      restartCount: 0,
      recoveryMs: 0,
      reconciliationRecoveries: 0,
      duplicateCommits: runtimeTelemetry.integrity.duplicateCommits,
      duplicateSequences: runtimeTelemetry.integrity.duplicateSequences
    },
    oracle: null,
    runtimeObservationArtifactSha256s: observations.map((item) =>
      item.sha256
    ).sort(),
    scenarioSymptomArtifactSha256s:
      canary.benchmarkScenarioSymptoms.map((item) => item.sha256).sort(),
    liveOutcomes: [{
      runId,
      subjectAddress: outcome.address,
      score: outcome.score,
      decision: outcome.decision,
      evidenceBundleSha256: outcome.evidenceBundleSha256,
      traversalClosureSha256: outcome.traversalClosureSha256,
      scoringBundleSha256: outcome.scoringBundleSha256,
      reportSha256: outcome.reportSha256,
      benchmarkControlSha256: controlSha256,
      auditedGroupIds,
      dispatchedGroupIds: runtimeTelemetry.provider.dispatchedGroupIds
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
      deliveryIntents: runtimeTelemetry.integrity.deliveryIntents,
      externalTelegramSends: 0
    }
  }).envelope;
  for (const item of observations) {
    await writeImmutable(
      resolve(scenarioDirectory, `observation-${item.sha256}.json`),
      `${canonicalizeArtifactJson(item.observation)}\n`
    );
  }
  for (const item of canary.benchmarkScenarioSymptoms) {
    await writeImmutable(
      resolve(scenarioDirectory, `symptom-${item.sha256}.json`),
      `${canonicalizeArtifactJson(item.symptom)}\n`
    );
  }
  const fileName = scenarioFileName(0, scenarioId);
  await writeImmutable(
    resolve(scenarioDirectory, fileName),
    `${canonicalizeArtifactJson(evidence)}\n`
  );
  const refillFileName = `refill-${refillArtifact.sha256}.json`;
  const samplesFileName =
    `memory-samples-${capturedMemory.samplesSha256}.json`;
  const summaryFileName =
    `memory-summary-${capturedMemory.summarySha256}.json`;
  await writeImmutable(
    resolve(scenarioDirectory, refillFileName),
    `${canonicalizeArtifactJson(refillArtifact.observation)}\n`
  );
  await writeImmutable(
    resolve(scenarioDirectory, samplesFileName),
    capturedMemory.samplesBytes
  );
  await writeImmutable(
    resolve(scenarioDirectory, summaryFileName),
    capturedMemory.summaryBytes
  );
  const relativeScenarioDirectory = basename(scenarioDirectory);
  const selectedRefillEvidence =
    sealUnifiedSelectedRefillExportEvidenceV1({
      scenarioId,
      executionIdentitySha256: input.executionIdentitySha256,
      candidateCommit: input.candidateCommit,
      traversalPolicyVersion: input.traversalPolicy,
      benchmarkEvidenceSha256: evidence.evidenceSha256,
      benchmarkEvidenceRelativePath:
        `${relativeScenarioDirectory}/${fileName}`,
      runId,
      controlSha256,
      providerConfigurationSha256:
        refillArtifact.observation.providerConfigurationSha256,
      refillArtifactSha256: refillArtifact.sha256,
      refillArtifactCreatedByRunId: refillArtifact.createdByRunId,
      refillArtifactRelativePath:
        `${relativeScenarioDirectory}/${refillFileName}`,
      memoryEvidence: {
        nodePid: capturedMemory.nodePid,
        samplesRelativePath:
          `${relativeScenarioDirectory}/${samplesFileName}`,
        samplesSha256: capturedMemory.samplesSha256,
        summaryRelativePath:
          `${relativeScenarioDirectory}/${summaryFileName}`,
        summarySha256: capturedMemory.summarySha256
      }
    });
  const selectedRefillEvidenceFileName =
    `selected-refill-${selectedRefillEvidence.envelope.evidenceSha256}.json`;
  await writeImmutable(
    resolve(scenarioDirectory, selectedRefillEvidenceFileName),
    `${selectedRefillEvidence.canonicalJson}\n`
  );
  const index = sealUnifiedSelectedAdaptiveBenchmarkIndexV2({
    seed: 1,
    requestedCapacities: [capacity],
    candidateCommit: input.candidateCommit,
    executionIdentitySha256: input.executionIdentitySha256,
    generatedAt: canary.report.generatedAt,
    artifacts: [{
      scenarioId,
      relativePath: `${relativeScenarioDirectory}/${fileName}`,
      evidenceSha256: evidence.evidenceSha256,
      candidateCommit: input.candidateCommit,
      executionIdentitySha256:
        evidence.performanceManifest.executionIdentitySha256,
      refillArtifactSha256: refillArtifact.sha256,
      refillArtifactCreatedByRunId: refillArtifact.createdByRunId,
      selectedRefillEvidenceSha256:
        selectedRefillEvidence.envelope.evidenceSha256,
      selectedRefillEvidenceRelativePath:
        `${relativeScenarioDirectory}/${selectedRefillEvidenceFileName}`
    }]
  });
  await writeImmutable(input.output, `${index.canonicalJson}\n`);
  return index.envelope;
}

async function runExistingIsolatedCanaryBenchmark(input: {
  readonly requestedCapacities: readonly number[];
  readonly output: string;
  readonly candidateCommit: string;
  readonly executionIdentitySha256: string;
  readonly providerAudit:
    ReturnType<typeof parseUnifiedProviderGroupAuditV1>;
  readonly scenarios: readonly (typeof UNIFIED_ADAPTIVE_LIVE_SCENARIOS[number])[];
  readonly traversalPolicy: TraversalPolicy;
  readonly memoryEvidenceDir: string | null;
}): Promise<UnifiedAdaptiveBenchmarkIndex> {
  const candidateCommit = input.candidateCommit;
  const { runUnifiedWalletCanaryCli } = await import(
    "./runUnifiedWalletCanary"
  );
  if (
    input.scenarios.length === 1 &&
    input.scenarios[0] === SELECTED_LIVE_SCENARIO
  ) {
    if (input.memoryEvidenceDir === null) {
      throw new Error("unified_benchmark_selected_memory_required");
    }
    return runSelectedIsolatedCanaryBenchmark({
      ...input,
      memoryEvidenceDir: input.memoryEvidenceDir,
      runCanary: runUnifiedWalletCanaryCli
    });
  }
  const namedWallets = [
    "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV",
    "TFWGukC9eWTfg4DYtQAzwuAK5XV85rVYJr",
    "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd"
  ] as const;
  const healthyGroups = input.providerAudit.groups.filter((group) =>
    group.state === "healthy" && group.concurrencyLimit > 0
  ).sort((left, right) =>
    left.opaqueGroupId.localeCompare(right.opaqueGroupId)
  );
  const outputDirectory = dirname(input.output);
  const scenarioDirectory = resolve(
    outputDirectory,
    `${parse(input.output).name}.scenarios`
  );
  await mkdirNoFollow(scenarioDirectory);
  const artifacts: Array<
    UnifiedAdaptiveBenchmarkIndexV1["artifacts"][number]
  > = [];
  let artifactIndex = 0;
  for (const capacity of input.requestedCapacities) {
    const auditedGroupIds = healthyGroups.slice(0, capacity)
      .map((group) => group.opaqueGroupId);
    const primaryExecutionBindings = input.scenarios
      .filter((scenarioId) => scenarioId !== "late_interactive")
      .flatMap((scenarioId) => {
      const addresses = scenarioId === "three_dense_wallets"
        ? namedWallets
        : scenarioId.startsWith("isolated:")
          ? [scenarioId.slice("isolated:".length)]
          : [namedWallets[0]];
      return addresses.map((subjectAddress, walletIndex) => ({
        parentScenarioId: scenarioId,
        scenarioId: `${scenarioId}:wallet:${walletIndex + 1}`,
        subjectAddress,
        locale: "ru" as const
      }));
    });
    const executionBindings: Array<{
      parentScenarioId: string;
      scenarioId: string;
      subjectAddress: string;
      locale: "ru";
    }> = [...primaryExecutionBindings];
    const controlByRunId = new Map<string, string>();
    let controlSha256 = "";
    let controlLeaseOwner = "";
    let boundRunIds: string[] = [];
    let lateRunId = "";
    const lateBinding = {
      parentScenarioId: "late_interactive" as const,
      scenarioId: "late_interactive:wallet:1",
      subjectAddress: namedWallets[0],
      locale: "ru" as const
    };
    const statePath = resolve(
      scenarioDirectory,
      `capacity-${capacity}-state.json`
    );
    const primaryStatePath = resolve(
      scenarioDirectory,
      `capacity-${capacity}-primary-state.json`
    );
    const lateStatePath = resolve(
      scenarioDirectory,
      `capacity-${capacity}-late-state.json`
    );
    const capacityState = await loadLiveCapacityState(
      statePath,
      candidateCommit,
      input.executionIdentitySha256,
      capacity
    );
    const primaryState = capacityState === null
      ? await loadLivePrimaryState(
          primaryStatePath,
          candidateCommit,
          input.executionIdentitySha256,
          capacity
        )
      : null;
    const lateState = capacityState === null
      ? await loadLiveLateState(
          lateStatePath,
          candidateCommit,
          input.executionIdentitySha256,
          capacity
        )
      : null;
    let primaryCanary:
      Awaited<ReturnType<typeof runUnifiedWalletCanaryCli>> | null =
        null;
    let lateCanary:
      Awaited<ReturnType<typeof runUnifiedWalletCanaryCli>> | null =
        null;
    const primaryControlRelease =
      createUnifiedBenchmarkReleaseOwner();
    const primaryControlRenewal =
      createUnifiedBenchmarkRenewalLoop();
    let extendPrimaryControl: ((
      runPlans: Parameters<
        Awaited<
          ReturnType<typeof installUnifiedAdaptiveBenchmarkControl>
        >["extendRunPlans"]
      >[0],
      addedAt: Date
    ) => Promise<void>) | null = null;
    let earlyLateCanaryPromise:
      Promise<Awaited<ReturnType<typeof runUnifiedWalletCanaryCli>>> |
      null = null;
    let startingLateCanary = false;
    let lateEnrollmentPromise: Promise<void> | null = null;
    let resolveLateEnrollment: (() => void) | null = null;
    let restartHandoffIdentity:
      UnifiedBenchmarkRestartIdentity | null = null;
    const restartStateIdentitySha256 =
      fingerprintCanonicalArtifact({
        version: "unified-adaptive-restart-state-identity-v1",
        output: input.output,
        executionIdentitySha256: input.executionIdentitySha256,
        capacity,
        primaryStatePath,
        lateStatePath
      });
    const completedCanaries =
      await runUnifiedBenchmarkControlScope({
      releaseOwner: primaryControlRelease,
      renewalLoop: primaryControlRenewal,
      restartIdentity: () => restartHandoffIdentity,
      work: async ({ restartRequired }) => {
    const startLateCanary = (
      peerRunId: string,
      peerObservation:
        UnifiedAdaptiveBenchmarkRuntimeObservationArtifactV1
    ) => runUnifiedWalletCanaryCli([
      "--candidate", candidateCommit,
      "--cutoff", new Date().toISOString(),
      "--output", resolve(
        outputDirectory,
        `${parse(input.output).name}.canary-c${capacity}-late`
      )
    ], {
      emitResult: false,
      traversalPolicyVersion: input.traversalPolicy,
      explicitBenchmarkScenarios: [lateBinding],
      beforeBatchCreate: async ({ db }) => {
        await persistUnifiedAdaptiveBenchmarkLatePhaseAck({
          db,
          createdByRunId: peerRunId,
          artifact: {
            version: "unified-adaptive-benchmark-late-phase-v1",
            phaseIdentity: `live:c${capacity}:late_interactive`,
            peerRunId,
            peerCheckpointObservationSha256: peerObservation.sha256,
            acknowledgedAt: peerObservation.observation.observedAt
          }
        });
      },
      async onBatchReady(batch) {
        lateRunId = batch.runIds[0]!;
        const now = new Date();
        if (extendPrimaryControl === null || controlSha256 === "") {
          throw new Error(
            "unified_benchmark_primary_control_extension_missing"
          );
        }
        await extendPrimaryControl([{
          runId: lateRunId,
          scenarioId: "late_interactive",
          fault: "late_interactive",
          faultUntil: new Date(now.getTime() + 5_000).toISOString()
        }], now);
        controlByRunId.set(lateRunId, controlSha256);
        const lateStateWithoutHash = {
          version: "unified-adaptive-live-late-state-v1" as const,
          candidateCommit,
          executionIdentitySha256: input.executionIdentitySha256,
          capacity,
          batchIdentitySha256: batch.batchIdentitySha256,
          controlSha256,
          runId: lateRunId
        };
        await writeImmutable(
          lateStatePath,
          `${canonicalizeArtifactJson({
            ...lateStateWithoutHash,
            stateSha256:
              fingerprintCanonicalArtifact(lateStateWithoutHash)
          })}\n`
        );
        resolveLateEnrollment?.();
        return {
          benchmarkControlSha256: controlSha256,
          release: async () => undefined
        };
      },
      async onProgress({ db, runs, benchmarkControlSha256 }) {
        if (
          benchmarkControlSha256 === null ||
          lateRunId === "" ||
          !runs.some((run) => run.id === lateRunId)
        ) {
          return;
        }
        const observations =
          await listUnifiedAdaptiveBenchmarkObservationArtifacts({
            db,
            controlSha256: benchmarkControlSha256,
            runIds: [lateRunId]
          });
        const observation = observations.at(-1);
        if (!observation) return;
        await persistUnifiedAdaptiveBenchmarkScenarioSymptom({
          db,
          createdByRunId: lateRunId,
          symptom: {
            version: "unified-adaptive-benchmark-scenario-symptom-v1",
            controlSha256: benchmarkControlSha256,
            runId: lateRunId,
            scenarioId: "late_interactive",
            phase: "late_after_peer_checkpoint",
            observedAt: observation.observation.observedAt,
            observationArtifactSha256: observation.sha256,
            runtimeInstanceId:
              observation.observation.runtime.instanceId,
            runtimeProcessStartedAt:
              observation.observation.runtime.processStartedAt,
            runtimeProcessId:
              observation.observation.runtime.processId
          }
        });
      }
    });
    if (capacityState !== null) {
      boundRunIds = [
        ...capacityState.primaryRunIds,
        capacityState.lateRunId
      ];
      lateRunId = capacityState.lateRunId;
      controlSha256 = capacityState.primaryControlSha256;
      controlLeaseOwner =
        capacityState.primaryControlLeaseOwner;
      for (const runId of capacityState.primaryRunIds) {
        controlByRunId.set(runId, capacityState.primaryControlSha256);
      }
      controlByRunId.set(
        lateRunId,
        capacityState.lateControlSha256
      );
      primaryCanary = await runUnifiedWalletCanaryCli([
        "--candidate", candidateCommit,
        "--resume", capacityState.primaryBatchIdentitySha256,
        "--output", resolve(
          outputDirectory,
          `${parse(input.output).name}.canary-c${capacity}`
        )
      ], {
        emitResult: false,
        traversalPolicyVersion: input.traversalPolicy,
        onBatchReady: async (batch) => {
          const transactionHost =
            createUnifiedPoolTransactionHost(batch.db);
          await recoverUnifiedBenchmarkCapacityStateControl({
            db: transactionHost,
            state: capacityState,
            now: new Date(),
            releaseOwner: primaryControlRelease,
            renewalLoop: primaryControlRenewal
          });
          return {
            benchmarkControlSha256:
              capacityState.primaryControlSha256,
            release: primaryControlRelease.callbackRelease
          };
        }
      });
      lateCanary = await runUnifiedWalletCanaryCli([
        "--candidate", candidateCommit,
        "--resume", capacityState.lateBatchIdentitySha256,
        "--output", resolve(
          outputDirectory,
          `${parse(input.output).name}.canary-c${capacity}-late`
        )
      ], {
        emitResult: false,
        traversalPolicyVersion: input.traversalPolicy,
        onBatchReady: async () => ({
          benchmarkControlSha256: capacityState.lateControlSha256,
          release: async () => undefined
        })
      });
    } else {
    if (primaryState !== null) {
      boundRunIds = [...primaryState.runIds];
      controlSha256 = primaryState.controlSha256;
      controlLeaseOwner = primaryState.leaseOwner;
      for (const runId of boundRunIds) {
        controlByRunId.set(runId, controlSha256);
      }
      primaryCanary = await runUnifiedWalletCanaryCli([
        "--candidate", candidateCommit,
        "--resume", primaryState.batchIdentitySha256,
        "--output", resolve(
          outputDirectory,
          `${parse(input.output).name}.canary-c${capacity}`
        )
      ], {
        emitResult: false,
        traversalPolicyVersion: input.traversalPolicy,
        onBatchReady: async (batch) => {
          const transactionHost =
            createUnifiedPoolTransactionHost(batch.db);
          primaryControlRelease.set(() =>
            releaseUnifiedAdaptiveBenchmarkControl({
              db: transactionHost,
              controlSha256: primaryState.controlSha256,
              leaseOwner: primaryState.leaseOwner,
              createdByRunId: primaryState.runIds[0]!,
              releasedAt: new Date()
            })
          );
          primaryControlRenewal.set((expiresAt) =>
            renewUnifiedAdaptiveBenchmarkControl({
              db: transactionHost,
              controlSha256: primaryState.controlSha256,
              leaseOwner: primaryState.leaseOwner,
              createdByRunId: primaryState.runIds[0]!,
              now: new Date(),
              expiresAt
            })
          );
          return {
            benchmarkControlSha256: primaryState.controlSha256,
            release: primaryControlRelease.callbackRelease
          };
        }
      });
    } else {
    primaryCanary = await runUnifiedWalletCanaryCli([
      "--candidate", candidateCommit,
      "--cutoff", new Date().toISOString(),
      "--output", resolve(
        outputDirectory,
        `${parse(input.output).name}.canary-c${capacity}`
      )
    ], {
      emitResult: false,
      traversalPolicyVersion: input.traversalPolicy,
      explicitBenchmarkScenarios: primaryExecutionBindings,
      async onBatchReady(batch) {
        boundRunIds = [...batch.runIds];
        const now = new Date();
        const leaseOwner = randomUUID();
        const faultUntil = new Date(now.getTime() + 5_000).toISOString();
        const installed = await installUnifiedAdaptiveBenchmarkControl({
          db: createUnifiedPoolTransactionHost(batch.db),
          leaseOwner,
          now,
          expiresAt: new Date(now.getTime() + 40 * 60_000),
          runtimeCommit: candidateCommit,
          providerConfigurationSha256:
            batch.providerConfigurationSha256,
          capacity,
          auditedGroupIds,
          runPlans: batch.runIds.map((runId, index) => {
            const scenarioId =
              primaryExecutionBindings[index]!.parentScenarioId;
            const fault = scenarioId === "provider_cooldown"
              ? "provider_cooldown" as const
              : scenarioId === "slow_canonical_head"
                ? "slow_canonical_head" as const
                : scenarioId === "full_merge_buffer"
                  ? "merge_buffer_full" as const
                  : scenarioId === "restart_recovery"
                    ? "restart_recovery" as const
                  : "none" as const;
            return {
              runId,
              scenarioId,
              fault,
              faultUntil: fault === "none" ? null : faultUntil
            };
          })
        });
        controlSha256 = installed.sha256;
        controlLeaseOwner = leaseOwner;
        primaryControlRelease.set(installed.release);
        primaryControlRenewal.set(installed.renew);
        extendPrimaryControl = installed.extendRunPlans;
        for (const runId of batch.runIds) {
          controlByRunId.set(runId, installed.sha256);
        }
        const primaryStateWithoutHash = {
          version: "unified-adaptive-live-primary-state-v1" as const,
          candidateCommit,
          executionIdentitySha256: input.executionIdentitySha256,
          capacity,
          batchIdentitySha256: batch.batchIdentitySha256,
          controlSha256: installed.sha256,
          leaseOwner,
          runIds: [...batch.runIds]
        };
        await writeImmutable(
          primaryStatePath,
          `${canonicalizeArtifactJson({
            ...primaryStateWithoutHash,
            stateSha256:
              fingerprintCanonicalArtifact(primaryStateWithoutHash)
          })}\n`
        );
        return {
          benchmarkControlSha256: installed.sha256,
          release: primaryControlRelease.callbackRelease
        };
      },
      async onProgress({ db, runs, benchmarkControlSha256 }) {
        if (benchmarkControlSha256 === null) return;
        if (!startingLateCanary && earlyLateCanaryPromise === null) {
          const peerIndex = primaryExecutionBindings.findIndex(
            (binding) =>
              binding.parentScenarioId === "one_dense_wallet"
          );
          const peerRunId = boundRunIds[peerIndex];
          const peer = runs.find((run) => run.id === peerRunId);
          if (!peer || !isNonterminalCheckpointedBenchmarkRun(peer)) {
            return;
          }
          const observations =
            await listUnifiedAdaptiveBenchmarkObservationArtifacts({
              db,
              controlSha256: benchmarkControlSha256,
              runIds: [peer.id]
            });
          const peerObservation = observations
            .filter((artifact) => artifact.observation.runs.some((run) =>
              run.runId === peer.id
            ))
            .at(-1);
          if (!peerObservation) return;
          startingLateCanary = true;
          lateEnrollmentPromise = new Promise<void>((resolve) => {
            resolveLateEnrollment = resolve;
          });
          earlyLateCanaryPromise = startLateCanary(
            peer.id,
            peerObservation
          );
          void earlyLateCanaryPromise.catch(() =>
            resolveLateEnrollment?.()
          );
        }
        if (
          earlyLateCanaryPromise === null ||
          lateEnrollmentPromise === null
        ) {
          return;
        }
        await lateEnrollmentPromise;
        if (lateRunId === "") return;
        const restartIndex = primaryExecutionBindings.findIndex(
          (binding) =>
            binding.parentScenarioId === "restart_recovery"
        );
        const restartRunId = boundRunIds[restartIndex];
        const restartRun = runs.find((run) =>
          run.id === restartRunId
        );
        if (
          restartRun === undefined ||
          !isNonterminalCheckpointedBenchmarkRun(restartRun)
        ) {
          return;
        }
        const handoff = (await db.query(
          `select sha256,
                  artifact_json->>'resumeDeadline' as resume_deadline
             from unified_check_artifacts
            where kind = 'adaptive_benchmark_restart_handoff'
              and artifact_json->>'controlSha256' = $1
              and artifact_json->>'runId' = $2
            limit 1`,
          [benchmarkControlSha256, restartRun.id]
        )).rows[0];
        if (!handoff) return;
        const resumeDeadline = String(handoff.resume_deadline);
        if (
          !Number.isFinite(Date.parse(resumeDeadline)) ||
          Date.parse(resumeDeadline) <= Date.now() ||
          Date.parse(resumeDeadline) - Date.now() >
            UNIFIED_BENCHMARK_RESTART_MAX_WAIT_MS
        ) {
          throw new Error("unified_benchmark_resume_deadline_invalid");
        }
        await primaryControlRenewal.renewNow();
        await primaryControlRenewal.stop();
        restartHandoffIdentity = {
          output: input.output,
          scenarioId: `live:c${capacity}:restart_recovery`,
          runIds: [restartRun.id],
          benchmarkControlSha256,
          executionIdentitySha256: input.executionIdentitySha256,
          stateIdentitySha256: restartStateIdentitySha256,
          handoffArtifactSha256: String(handoff.sha256),
          resumeDeadline
        };
        restartRequired(restartHandoffIdentity);
      }
    });
    const primaryStateWithoutHash = {
      version: "unified-adaptive-live-primary-state-v1" as const,
      candidateCommit,
      executionIdentitySha256: input.executionIdentitySha256,
      capacity,
      batchIdentitySha256: primaryCanary.batchIdentitySha256,
      controlSha256,
      leaseOwner: controlLeaseOwner,
      runIds: [...boundRunIds]
    };
    await writeImmutable(
      primaryStatePath,
      `${canonicalizeArtifactJson({
        ...primaryStateWithoutHash,
        stateSha256: fingerprintCanonicalArtifact(
          primaryStateWithoutHash
        )
      })}\n`
    );
    }
    const peerEntry = [...boundRunIds].map((runId, index) => ({
      runId,
      binding: primaryExecutionBindings[index]!
    })).find((item) =>
      item.binding.parentScenarioId === "one_dense_wallet"
    );
    const peerObservation = primaryCanary.benchmarkObservationArtifacts
      .filter((artifact) => artifact.observation.runs.some((run) =>
        run.runId === peerEntry?.runId &&
        run.planner.committed > 0
      )).at(-1);
    if (!peerEntry || !peerObservation) {
      throw new Error("unified_benchmark_late_peer_checkpoint_missing");
    }
    const startedLateCanary = earlyLateCanaryPromise;
    if (startedLateCanary !== null) {
      lateCanary = await startedLateCanary;
    } else if (lateState !== null) {
      lateRunId = lateState.runId;
      controlByRunId.set(lateRunId, lateState.controlSha256);
      lateCanary = await runUnifiedWalletCanaryCli([
        "--candidate", candidateCommit,
        "--resume", lateState.batchIdentitySha256,
        "--output", resolve(
          outputDirectory,
          `${parse(input.output).name}.canary-c${capacity}-late`
        )
      ], {
        emitResult: false,
        traversalPolicyVersion: input.traversalPolicy,
        onBatchReady: async () => ({
          benchmarkControlSha256: lateState.controlSha256,
          release: async () => undefined
        })
      });
    } else {
      throw new Error(
        "unified_benchmark_late_nonterminal_checkpoint_missing"
      );
    }
    const stateWithoutHash = {
      version: "unified-adaptive-live-capacity-state-v1" as const,
      candidateCommit,
      executionIdentitySha256: input.executionIdentitySha256,
      capacity,
      primaryBatchIdentitySha256:
        primaryCanary.batchIdentitySha256,
      primaryControlSha256: controlSha256,
      primaryControlLeaseOwner: controlLeaseOwner,
      primaryControlCreatedByRunId: boundRunIds[0]!,
      primaryControlLeaseIdentitySha256:
        unifiedBenchmarkControlLeaseIdentity({
          controlSha256,
          leaseOwner: controlLeaseOwner,
          createdByRunId: boundRunIds[0]!
        }),
      primaryRunIds: [...boundRunIds],
      lateBatchIdentitySha256: lateCanary.batchIdentitySha256,
      lateControlSha256: controlByRunId.get(lateRunId)!,
      lateRunId
    };
    await writeImmutable(
      statePath,
      `${canonicalizeArtifactJson({
        ...stateWithoutHash,
        stateSha256: fingerprintCanonicalArtifact(stateWithoutHash)
      })}\n`
    );
    }
    if (primaryCanary === null || lateCanary === null) {
      throw new Error("unified_benchmark_canary_result_missing");
    }
    return { primaryCanary, lateCanary };
      }
    });
    const primaryCanaryResult = completedCanaries.primaryCanary;
    const lateCanaryResult = completedCanaries.lateCanary;
    executionBindings.push(lateBinding);
    if (!boundRunIds.includes(lateRunId)) boundRunIds.push(lateRunId);
    const canary = {
      ...primaryCanaryResult,
      report: {
        ...primaryCanaryResult.report,
        results: [
          ...primaryCanaryResult.report.results,
          ...lateCanaryResult.report.results
        ]
      },
      outcomes: [
        ...primaryCanaryResult.outcomes,
        ...lateCanaryResult.outcomes
      ],
      benchmarkObservationArtifacts: [
        ...primaryCanaryResult.benchmarkObservationArtifacts,
        ...lateCanaryResult.benchmarkObservationArtifacts
      ],
      benchmarkScenarioSymptoms: [
        ...primaryCanaryResult.benchmarkScenarioSymptoms,
        ...lateCanaryResult.benchmarkScenarioSymptoms
      ]
    };
    if (
      !/^[0-9a-f]{64}$/u.test(controlSha256) ||
      boundRunIds.length !== executionBindings.length
    ) {
      throw new Error("unified_benchmark_live_control_missing");
    }
    const executionByRunId = new Map(boundRunIds.map((runId, index) => [
      runId,
      executionBindings[index]!
    ]));
    const reportByRunId = new Map(canary.report.results.map((result) => [
      result.runId,
      result
    ]));
    const outcomeByRunId = new Map(canary.outcomes.map((outcome) => [
      outcome.runId,
      outcome
    ]));
    for (const kind of input.scenarios) {
      const scenarioId = `live:c${capacity}:${kind}`;
      const runIds = [...executionByRunId.entries()]
        .filter(([, binding]) => binding.parentScenarioId === kind)
        .map(([runId]) => runId);
      const scenarioControls = new Set(runIds.map((runId) =>
        controlByRunId.get(runId)
      ));
      const scenarioControlSha256 = [...scenarioControls][0];
      if (
        scenarioControls.size !== 1 ||
        scenarioControlSha256 === undefined
      ) {
        throw new Error(
          `unified_benchmark_live_control_missing:${scenarioId}`
        );
      }
      const results = runIds.map((runId) => reportByRunId.get(runId)!);
      const outcomes = runIds.map((runId) => outcomeByRunId.get(runId)!);
      const observationSamples = canary.benchmarkObservationArtifacts.map(
        (artifact) => ({
          artifactSha256: artifact.sha256,
          observation: artifact.observation,
          runs: artifact.observation.runs.filter((run) =>
            runIds.includes(run.runId)
          )
        })
      ).filter((sample) => sample.runs.length > 0);
      const symptomSamples = canary.benchmarkScenarioSymptoms.filter(
        (artifact) =>
          runIds.includes(artifact.symptom.runId) &&
          artifact.symptom.scenarioId === kind
      );
      if (
        kind === "restart_recovery" &&
        !symptomSamples.some((artifact) =>
          artifact.symptom.phase ===
            "external_runtime_restart_attested"
        )
      ) {
        throw new Error(
          "unified_benchmark_live_restart_recovery_unobserved"
        );
      }
      if (
        results.length === 0 ||
        observationSamples.length === 0 ||
        symptomSamples.length === 0 ||
        results.some((result) => result?.outcome !== "COMPLETED") ||
        outcomes.some((outcome) =>
          !outcome ||
          outcome.score === null ||
          outcome.decision === null ||
          !outcome.evidenceBundleSha256 ||
          !outcome.traversalClosureSha256 ||
          !outcome.scoringBundleSha256 ||
          !outcome.reportSha256
        )
      ) {
        throw new Error(
          `unified_benchmark_live_scenario_incomplete:${scenarioId}`
        );
      }
      const providerKinds = new Set([
        "direct_history",
        "address_history",
        "deep_direct"
      ]);
      const attempts = results.flatMap((result) =>
        result.childAttempts.filter((attempt) =>
          providerKinds.has(attempt.kind)
        )
      );
      const peak = calculateUnifiedBenchmarkPeakConcurrency(attempts);
      const eligibleDemand = Math.max(...observationSamples.map(
        (sample) => sample.runs.reduce((sum, run) =>
          sum + run.capacity.eligibleDemand, 0)
      ));
      const targetSlots = Math.max(...observationSamples.map(
        (sample) => sample.runs.reduce((sum, run) =>
          sum + run.capacity.targetSlots, 0)
      ));
      const observedActualSlots = Math.max(...observationSamples.map(
        (sample) => sample.runs.reduce((sum, run) =>
          sum + run.capacity.actualSlots, 0)
      ));
      const actualSlots = Math.max(observedActualSlots, peak);
      if (
        targetSlots > capacity ||
        actualSlots > targetSlots ||
        targetSlots > eligibleDemand
      ) {
        throw new Error(
          `unified_benchmark_live_capacity_observation_invalid:${scenarioId}`
        );
      }
      const readyBytes = Math.max(...observationSamples.map(
        (sample) => sample.runs.reduce((sum, run) =>
          sum + run.buffer.readyBytes, 0)
      ));
      const reservedBytes = Math.max(...observationSamples.map(
        (sample) => sample.runs.reduce((sum, run) =>
          sum + run.buffer.reservedBytes, 0)
      ));
      const canonicalHeadAges = observationSamples.flatMap((sample) =>
        sample.runs.flatMap((run) =>
          run.canonicalHeadAgeMs === null
            ? []
            : [run.canonicalHeadAgeMs]
        )
      );
      const limitingReason = observationSamples.flatMap((sample) =>
        sample.runs.map((run) => run.limitingReason)
      ).find((reason) => reason !== null) ?? null;
      const databaseLatencyMs = Math.max(...observationSamples.map(
        (sample) => sample.observation.database.latencyMs
      ));
      const checkpointLatencyMs = Math.max(...observationSamples.map(
        (sample) => sample.observation.database.checkpointLatencyMs
      ));
      const poolWaitMs = Math.max(...observationSamples.map(
        (sample) => sample.observation.database.poolWaitMs
      ));
      const lifecycleSamples = observationSamples
        .map((sample) => sample.observation.lifecycle)
        .filter((lifecycle) =>
          lifecycle.restartRunId !== null &&
          runIds.includes(lifecycle.restartRunId)
        );
      const restartSymptom = symptomSamples.find((artifact) =>
        artifact.symptom.phase ===
          "external_runtime_restart_attested"
      )?.symptom;
      const attestedReconciliationSha256 =
        restartSymptom?.restartHandoff
          ?.reconciliationArtifactSha256 ?? null;
      const restartCount = attestedReconciliationSha256 !== null
        ? 1
        : 0;
      const recoveryMs = restartSymptom?.restartHandoff
        ? Math.max(
            0.001,
            Date.parse(restartSymptom.observedAt) -
              Date.parse(restartSymptom.restartHandoff.requestedAt)
          )
        : lifecycleSamples.length === 0
        ? 0
        : Math.max(...lifecycleSamples.map((value) =>
            value.recoveryMs
          ));
      const reconciliationRecoveries =
        attestedReconciliationSha256 !== null ? 1 : 0;
      const runtimeTelemetry = observationSamples.map((sample) =>
        sample.observation
      ).sort((left, right) =>
        left.provider.requests - right.provider.requests ||
        Date.parse(left.observedAt) - Date.parse(right.observedAt)
      ).at(-1)!;
      const dispatchedGroupIds = [...new Set(
        observationSamples.flatMap((sample) =>
          sample.observation.provider.dispatchedGroupIds
        )
      )].filter((groupId) => auditedGroupIds.includes(groupId)).sort();
      if (dispatchedGroupIds.length === 0) {
        throw new Error(
          `unified_benchmark_live_provider_dispatch_unobserved:${scenarioId}`
        );
      }
      if (
        kind === "restart_recovery" &&
        (
          restartCount < 1 ||
          recoveryMs <= 0 ||
          reconciliationRecoveries < 1
        )
      ) {
        throw new Error(
          "unified_benchmark_live_restart_recovery_unobserved"
        );
      }
      const wallTimeMs = Math.max(
        0.001,
        ...results.map((result) => result.parentDurationMs)
      );
      const snapshots = outcomes.map((outcome) => outcome.snapshot);
      const snapshot = snapshots.length === 1
        ? snapshots[0]!
        : {
            blockNumber: `aggregate:${snapshots.length}`,
            blockHash: fingerprintCanonicalArtifact({
              version: "unified-live-benchmark-snapshots-v1",
              snapshots
            }),
            timestamp: snapshots.map((item) => item.timestamp)
              .sort((left, right) =>
                Date.parse(right) - Date.parse(left)
              )[0]!
          };
      const performanceManifest =
        buildUnifiedPerformanceBenchmarkManifest({
          version: "unified-performance-benchmark-input-v1",
          caseId: scenarioId,
          runId: scenarioId,
          frozenClockIso: snapshot.timestamp,
          snapshot,
          providerBundleSha256: scenarioControlSha256,
          labelDatasetSha256: outcomes[0]!.labelDatasetSha256,
          providerConfigurationSha256:
            outcomes[0]!.providerConfigurationSha256,
          scoringPolicyVersion: "scoring-signal-matrix-v4",
          attributionPolicyVersion: "selected-attribution-policy-v1",
          analysisPolicyVersion: completedCanaryTraversalPolicy(outcomes),
          presentationPolicyVersion: "unified-presentation-v1",
          locale: "ru",
          deterministicIdSeed: scenarioId,
          runtimeCommit: candidateCommit,
          checkpointVersion:
            "unified-production-traversal-checkpoint-v2",
          logicalChunkEvents: Math.max(1, attempts.length),
          providerSlots: capacity,
          harnessVersion: "unified-adaptive-live-canary-v1"
        });
      const evidence = sealUnifiedAdaptiveBenchmarkEvidenceV1({
        scenarioId,
        scenarioKind: kind,
        completedAt: canary.report.generatedAt,
        mode: "live",
        admissionPolicy: "rolling",
        sideEffectPolicy: "isolated",
        requestedCapacity: capacity,
        actualAuditedIndependentGroupCapacity: healthyGroups.length,
        independentGroupAudit: input.providerAudit,
        performanceManifest,
        timing: {
          wallTimeMs,
          aggregateThroughputPerSecond:
            results.length / (wallTimeMs / 1_000)
        },
        capacity: {
          eligibleDemand,
          targetSlots,
          actualSlots,
          utilization: targetSlots === 0
            ? 0
            : actualSlots / targetSlots
        },
        provider: {
          rollingRps: runtimeTelemetry.provider.requestsPerSecond,
          requests: runtimeTelemetry.provider.requests,
          errors: runtimeTelemetry.provider.errors,
          rateLimited429: runtimeTelemetry.provider.rateLimited429
        },
        limiting: {
          reason: limitingReason,
          canonicalHeadAgeMs: canonicalHeadAges.length === 0
            ? null
            : Math.max(...canonicalHeadAges)
        },
        buffer: { readyBytes, reservedBytes },
        database: {
          latencyMs: databaseLatencyMs,
          checkpointLatencyMs,
          poolWaitMs
        },
        memory: {
          rssBytes: runtimeTelemetry.runtime.rssBytes,
          heapUsedBytes: runtimeTelemetry.runtime.heapUsedBytes,
          availableContainerBytes:
            runtimeTelemetry.runtime.availableContainerBytes,
          availableHostBytes:
            runtimeTelemetry.runtime.availableHostBytes
        },
        repair: { maxWaitMs: 0, maxWaitChunks: 0 },
        reuse: {
          ...runtimeTelemetry.reuse
        },
        restartRecovery: {
          restartCount,
          recoveryMs,
          reconciliationRecoveries,
          duplicateCommits: runtimeTelemetry.integrity.duplicateCommits,
          duplicateSequences:
            runtimeTelemetry.integrity.duplicateSequences
        },
        oracle: null,
        runtimeObservationArtifactSha256s: [...new Set(
          observationSamples.map((sample) => sample.artifactSha256)
        )].sort(),
        scenarioSymptomArtifactSha256s: [...new Set(
          symptomSamples.map((sample) => sample.sha256)
        )].sort(),
        liveOutcomes: outcomes.map((outcome) => ({
          runId: outcome.runId,
          subjectAddress: outcome.address,
          score: outcome.score!,
          decision: outcome.decision!,
          evidenceBundleSha256: outcome.evidenceBundleSha256!,
          traversalClosureSha256: outcome.traversalClosureSha256!,
          scoringBundleSha256: outcome.scoringBundleSha256!,
          reportSha256: outcome.reportSha256!,
          benchmarkControlSha256: scenarioControlSha256,
          auditedGroupIds,
          dispatchedGroupIds
        })),
        measurement: {
          timing: "observed",
          provider: "observed",
          database: "observed",
          memory: "observed",
          lifecycle: "observed",
          delivery: "observed"
        },
        delivery: {
          eligibleRequests: results.length,
          deliveryIntents: runtimeTelemetry.integrity.deliveryIntents,
          externalTelegramSends: 0
        }
      }).envelope;
      const fileName = scenarioFileName(artifactIndex, scenarioId);
      for (const sample of observationSamples) {
        await writeImmutable(
          resolve(
            scenarioDirectory,
            `observation-${sample.artifactSha256}.json`
          ),
          `${canonicalizeArtifactJson(sample.observation)}\n`
        );
      }
      for (const sample of symptomSamples) {
        await writeImmutable(
          resolve(scenarioDirectory, `symptom-${sample.sha256}.json`),
          `${canonicalizeArtifactJson(sample.symptom)}\n`
        );
      }
      await writeImmutable(
        resolve(scenarioDirectory, fileName),
        `${canonicalizeArtifactJson(evidence)}\n`
      );
      artifacts.push({
        scenarioId,
        relativePath: `${basename(scenarioDirectory)}/${fileName}`,
        evidenceSha256: evidence.evidenceSha256,
        candidateCommit,
        executionIdentitySha256:
          evidence.performanceManifest.executionIdentitySha256
      });
      artifactIndex += 1;
    }
  }
  const index = indexEnvelope({
    mode: "live",
    seed: 1,
    capacities: input.requestedCapacities,
    candidateCommit,
    executionIdentitySha256: input.executionIdentitySha256,
    generatedAt: new Date().toISOString(),
    artifacts
  });
  await writeImmutable(input.output, `${canonicalizeArtifactJson(index)}\n`);
  return index;
}

export async function runUnifiedAdaptiveBenchmarkCli(
  args: readonly string[],
  runtime: UnifiedAdaptiveBenchmarkRuntime = {}
): Promise<UnifiedAdaptiveBenchmarkIndex> {
  const options = parseCli(args);
  const output = safeOutputPath(options.output);
  if (options.mode === "live") {
    const providerAudit = await validateLivePrerequisites(options);
    const memoryEvidenceDir = options.memoryEvidenceDir === null
      ? null
      : await requireExistingDirectoryNoFollow(options.memoryEvidenceDir);
    const scenarios = options.scenario === null
      ? UNIFIED_ADAPTIVE_LIVE_SCENARIOS
      : [options.scenario] as const;
    const candidateCommit = await resolveRuntimeCommit(runtime);
    const executionIdentitySha256 = benchmarkExecutionIdentity({
      mode: "live",
      seed: 1,
      capacities: options.capacities,
      candidateCommit,
      sourceIdentitySha256: providerAudit.auditSha256,
      traversalPolicy: options.traversalPolicy,
      scenarioIds: scenarios
    });
    const completed = await loadCompletedLiveIndex({
      output,
      capacities: options.capacities,
      candidateCommit,
      executionIdentitySha256,
      providerAudit,
      scenarios,
      traversalPolicy: options.traversalPolicy
    });
    if (completed !== null) return completed;
    const runLive = runtime.runIsolatedCanaryBenchmark ??
      runExistingIsolatedCanaryBenchmark;
    return runLive({
      requestedCapacities: options.capacities,
      output,
      candidateCommit,
      executionIdentitySha256,
      providerAudit,
      scenarios,
      traversalPolicy: options.traversalPolicy,
      memoryEvidenceDir
    });
  }
  const { canonicalJson, envelope: replay } = await loadReplayFixture(
    options.traversalPolicy
  );
  const oracleReceipt = await resolveReplayOracleReceipt(
    options,
    runtime,
    replay.expectedReplaySha256
  );
  const runtimeCommit = await resolveRuntimeCommit(runtime);
  const executionIdentitySha256 = benchmarkExecutionIdentity({
    mode: "replay",
    seed: options.seed,
    capacities: options.capacities,
    candidateCommit: runtimeCommit,
    sourceIdentitySha256: fingerprintCanonicalArtifact({
      replaySha256: replay.expectedReplaySha256,
      receiptSha256: oracleReceipt.receiptSha256
    }),
    traversalPolicy: options.traversalPolicy,
    scenarioIds: UNIFIED_ADAPTIVE_REPLAY_SCENARIOS
  });
  const outputDirectory = dirname(output);
  const scenarioDirectory = resolve(
    outputDirectory,
    `${parse(output).name}.scenarios`
  );
  await rejectSymlink(outputDirectory);
  await rejectSymlink(scenarioDirectory);
  await mkdirNoFollow(scenarioDirectory);
  const artifacts: Array<
    UnifiedAdaptiveBenchmarkIndexV1["artifacts"][number]
  > = [];
  const oracleSha256 = fingerprintCanonicalArtifact(
    oracleReceipt.barrierFacts
  );
  let scenarioIndex = 0;
  for (const capacity of options.capacities) {
    for (const kind of UNIFIED_ADAPTIVE_REPLAY_SCENARIOS) {
      if (kind === "repair_arrival_capacity_one" && capacity !== 1) {
        continue;
      }
      const scenarioId = `replay:c${capacity}:${kind}`;
      const fileName = scenarioFileName(scenarioIndex, scenarioId);
      const relativePath = `${basename(scenarioDirectory)}/${fileName}`;
      const path = resolve(scenarioDirectory, fileName);
      const completed = await loadCompletedScenario({
        path,
        scenarioId,
        capacity,
        seed: options.seed,
        replaySha256: replay.expectedReplaySha256,
        oracleSha256,
        receiptSha256: oracleReceipt.receiptSha256,
        runtimeCommit,
        providerConfigurationSha256:
          replay.deterministic.providerConfigurationSha256
      });
      const evidence = completed ?? await runReplayScenario({
        canonicalReplay: canonicalJson,
        replay,
        kind,
        capacity,
        seed: options.seed,
        scenarioId,
        oracleReceipt,
        runtimeCommit
      });
      if (completed === null) {
        await writeImmutable(
          path,
          `${canonicalizeArtifactJson(evidence)}\n`
        );
      }
      artifacts.push({
        scenarioId,
        relativePath,
        evidenceSha256: evidence.evidenceSha256,
        candidateCommit: runtimeCommit,
        executionIdentitySha256:
          evidence.performanceManifest.executionIdentitySha256
      });
      scenarioIndex += 1;
    }
  }
  const index = indexEnvelope({
    mode: "replay",
    seed: options.seed,
    capacities: options.capacities,
    candidateCommit: runtimeCommit,
    executionIdentitySha256,
    generatedAt: replay.frozenClockIso,
    artifacts
  });
  await mkdirNoFollow(outputDirectory);
  await writeImmutable(output, `${canonicalizeArtifactJson(index)}\n`);
  return index;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  runUnifiedAdaptiveBenchmarkCli(process.argv.slice(2))
    .then((index) => {
      process.stdout.write(`${canonicalizeArtifactJson(index)}\n`);
    })
    .catch((error) => {
      if (error instanceof UnifiedAdaptiveBenchmarkRestartRequiredError) {
        process.stdout.write(
          `${canonicalizeArtifactJson(error.phase)}\n`
        );
        process.exitCode = error.exitCode;
        return;
      }
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    });
}
