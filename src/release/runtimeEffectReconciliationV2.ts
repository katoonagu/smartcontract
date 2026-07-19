import { canonicalBytesV2 } from "./releaseRootWriterStore";
import { releaseSha256V2, type ProductionOperationKindV2 } from "./remediationReleaseManifestV2";

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const EFFECT_STEPS = ["stop_previous", "start_candidate", "stop_candidate", "start_previous",
  "restart_previous"] as const;
type RuntimeEffectStepV2 = typeof EFFECT_STEPS[number];
const EFFECT_STEP_SET = new Set<string>(EFFECT_STEPS);
const STEP_KIND: Readonly<Record<RuntimeEffectStepV2, ProductionOperationKindV2>> = Object.freeze({
  stop_previous: "rollout",
  start_candidate: "rollout",
  stop_candidate: "rollback",
  start_previous: "rollback",
  restart_previous: "rollback"
});
const STEP_STATE: Readonly<Record<RuntimeEffectStepV2, "target_absent" | "target_singleton">> = Object.freeze({
  stop_previous: "target_absent",
  start_candidate: "target_singleton",
  stop_candidate: "target_absent",
  start_previous: "target_singleton",
  restart_previous: "target_singleton"
});

export type RuntimeTopologyCandidateV2 = Readonly<{
  processId: number;
  processStartedAt: string;
  runtimeSha: string;
  runtimeLabel: string;
  commandLineSha256: string;
  executablePathSha256: string;
  worktreePathFingerprintSha256: string;
  entrypointPathFingerprintSha256: string;
}>;

export type RuntimeTopologySnapshotV2 = Readonly<{
  version: "runtime-topology-snapshot-v2";
  observedAt: string;
  candidates: readonly RuntimeTopologyCandidateV2[];
}>;

export type RuntimeEffectReconciliationInputV2 = Readonly<{
  operationKind: ProductionOperationKindV2;
  operationId: string;
  operationClaimSha256: string;
  authorityConsumptionSha256: string;
  sequence: number;
  stepId: RuntimeEffectStepV2;
  intentRelativePath: string;
  intentSha256: string;
  intendedExternalEffectSha256: string;
  currentOperationLeaseSha256: string;
  currentOperationLeaseEpoch: number;
  authorityExpiresAt: string;
  operationDeadlineAt: string;
  observedAt: string;
  desiredState: "target_absent" | "target_singleton";
  effectNotBefore: string;
  target: Readonly<{
    runtimeSha: string;
    runtimeLabel: string;
    worktreePathFingerprintSha256: string;
    entrypointPathFingerprintSha256: string;
    exactProcessId: number | null;
    exactProcessStartedAt: string | null;
  }>;
}>;

export type RuntimeEffectReconciliationEvidenceV2 = Readonly<{
  version: "runtime-effect-reconciliation-evidence-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  operationClaimSha256: string;
  authorityConsumptionSha256: string;
  sequence: number;
  stepId: RuntimeEffectStepV2;
  intentRelativePath: string;
  intentSha256: string;
  intendedExternalEffectSha256: string;
  currentOperationLeaseSha256: string;
  currentOperationLeaseEpoch: number;
  authorityExpiresAt: string;
  operationDeadlineAt: string;
  topologySnapshot: RuntimeTopologySnapshotV2;
  topologySnapshotSha256: string;
  targetIdentitySha256: string;
  effectNotBefore: string;
  observedPostState: "target_absent" | "target_singleton";
  observedAt: string;
  recoveredAfterCrash: true;
  result: "effect_confirmed";
  bindingSha256: string;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}_invalid`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label}_shape_invalid`);
  }
}

function exactIso(value: unknown, label: string): string {
  if (typeof value !== "string" || !ISO.test(value) || new Date(value).toISOString() !== value) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

function validateCandidate(value: unknown): RuntimeTopologyCandidateV2 {
  const input = record(value, "runtime_topology_candidate");
  exactKeys(input, ["processId", "processStartedAt", "runtimeSha", "runtimeLabel", "commandLineSha256",
    "executablePathSha256", "worktreePathFingerprintSha256", "entrypointPathFingerprintSha256"],
  "runtime_topology_candidate");
  if (!Number.isSafeInteger(input.processId) || Number(input.processId) < 1
      || typeof input.runtimeLabel !== "string" || input.runtimeLabel.length === 0
      || !SHA40.test(String(input.runtimeSha))) throw new Error("runtime_topology_candidate_invalid");
  exactIso(input.processStartedAt, "runtime_topology_candidate_started_at");
  for (const key of ["commandLineSha256", "executablePathSha256", "worktreePathFingerprintSha256",
    "entrypointPathFingerprintSha256"] as const) {
    if (!SHA256.test(String(input[key]))) throw new Error("runtime_topology_candidate_invalid");
  }
  return input as RuntimeTopologyCandidateV2;
}

export function validateRuntimeTopologySnapshotV2(value: unknown): RuntimeTopologySnapshotV2 {
  const input = record(value, "runtime_topology_snapshot");
  exactKeys(input, ["version", "observedAt", "candidates"], "runtime_topology_snapshot");
  if (input.version !== "runtime-topology-snapshot-v2" || !Array.isArray(input.candidates)) {
    throw new Error("runtime_topology_snapshot_invalid");
  }
  const candidates = input.candidates.map(validateCandidate);
  const observedAt = exactIso(input.observedAt, "runtime_topology_observed_at");
  if (new Set(candidates.map((candidate) => candidate.processId)).size !== candidates.length
      || new Set(candidates.map((candidate) => `${candidate.processId}:${candidate.processStartedAt}`)).size
        !== candidates.length
      || candidates.some((candidate, index) => index > 0
        && candidates[index - 1]!.processId >= candidate.processId)
      || candidates.some((candidate) => Date.parse(candidate.processStartedAt) > Date.parse(observedAt))) {
    throw new Error("runtime_topology_snapshot_candidate_duplicate");
  }
  return { version: "runtime-topology-snapshot-v2", observedAt, candidates };
}

function matchesTarget(
  candidate: RuntimeTopologyCandidateV2,
  input: RuntimeEffectReconciliationInputV2
): boolean {
  const target = input.target;
  return candidate.runtimeSha === target.runtimeSha
    && candidate.runtimeLabel === target.runtimeLabel
    && candidate.worktreePathFingerprintSha256 === target.worktreePathFingerprintSha256
    && candidate.entrypointPathFingerprintSha256 === target.entrypointPathFingerprintSha256
    && (target.exactProcessId === null || candidate.processId === target.exactProcessId)
    && (target.exactProcessStartedAt === null || candidate.processStartedAt === target.exactProcessStartedAt)
    && Date.parse(candidate.processStartedAt) >= Date.parse(input.effectNotBefore)
    && Date.parse(candidate.processStartedAt) <= Date.parse(input.observedAt);
}

function evidenceBinding(value: Omit<RuntimeEffectReconciliationEvidenceV2, "bindingSha256">): string {
  return releaseSha256V2(canonicalBytesV2(value));
}

export function resolveRuntimeEffectReconciliationV2(
  input: RuntimeEffectReconciliationInputV2,
  topologyValue: unknown
): RuntimeEffectReconciliationEvidenceV2 | null {
  const topology = validateRuntimeTopologySnapshotV2(topologyValue);
  if (!EFFECT_STEP_SET.has(input.stepId) || !Number.isSafeInteger(input.sequence) || input.sequence < 1
      || !Number.isSafeInteger(input.currentOperationLeaseEpoch) || input.currentOperationLeaseEpoch < 1) {
    throw new Error("runtime_effect_reconciliation_input_invalid");
  }
  const stepId = input.stepId as RuntimeEffectStepV2;
  if (STEP_KIND[stepId] !== input.operationKind || STEP_STATE[stepId] !== input.desiredState
      || input.operationId !== `production-${input.operationKind}-${input.operationId.slice(-64)}`
      || !SHA256.test(input.operationId.slice(-64))
      || input.intentRelativePath !== `production-operation-step-intents/${input.operationId}/${input.sequence}-${stepId}-1-v2.json`) {
    throw new Error("runtime_effect_reconciliation_scope_invalid");
  }
  for (const value of [input.operationClaimSha256, input.authorityConsumptionSha256, input.intentSha256,
    input.intendedExternalEffectSha256, input.currentOperationLeaseSha256]) {
    if (!SHA256.test(value)) throw new Error("runtime_effect_reconciliation_input_invalid");
  }
  const observedAt = exactIso(input.observedAt, "runtime_effect_reconciliation_observed_at");
  if (topology.observedAt !== observedAt || Date.parse(observedAt) >= Date.parse(exactIso(input.authorityExpiresAt,
    "runtime_effect_reconciliation_authority_expiry"))
      || Date.parse(observedAt) >= Date.parse(exactIso(input.operationDeadlineAt,
        "runtime_effect_reconciliation_operation_deadline"))) {
    throw new Error("runtime_effect_reconciliation_bound_reached");
  }
  const effectNotBefore = exactIso(input.effectNotBefore, "runtime_effect_reconciliation_effect_not_before");
  const target = input.target;
  if (!SHA40.test(target.runtimeSha) || typeof target.runtimeLabel !== "string" || target.runtimeLabel.length === 0
      || !SHA256.test(target.worktreePathFingerprintSha256)
      || !SHA256.test(target.entrypointPathFingerprintSha256)
      || (target.exactProcessId !== null && (!Number.isSafeInteger(target.exactProcessId)
        || target.exactProcessId < 1))
      || (target.exactProcessStartedAt !== null
        && exactIso(target.exactProcessStartedAt, "runtime_effect_reconciliation_target_started_at")
          !== target.exactProcessStartedAt)
      || (target.exactProcessId === null) !== (target.exactProcessStartedAt === null)
      || Date.parse(effectNotBefore) > Date.parse(observedAt)) {
    throw new Error("runtime_effect_reconciliation_target_invalid");
  }
  const confirmed = input.desiredState === "target_absent"
    ? topology.candidates.length === 0
    : topology.candidates.length === 1 && matchesTarget(topology.candidates[0]!, input);
  if (!confirmed) return null;
  const withoutBinding = {
    version: "runtime-effect-reconciliation-evidence-v2" as const,
    operationKind: input.operationKind,
    operationId: input.operationId,
    operationClaimSha256: input.operationClaimSha256,
    authorityConsumptionSha256: input.authorityConsumptionSha256,
    sequence: input.sequence,
    stepId: input.stepId,
    intentRelativePath: input.intentRelativePath,
    intentSha256: input.intentSha256,
    intendedExternalEffectSha256: input.intendedExternalEffectSha256,
    currentOperationLeaseSha256: input.currentOperationLeaseSha256,
    currentOperationLeaseEpoch: input.currentOperationLeaseEpoch,
    authorityExpiresAt: input.authorityExpiresAt,
    operationDeadlineAt: input.operationDeadlineAt,
    topologySnapshot: topology,
    topologySnapshotSha256: releaseSha256V2(canonicalBytesV2(topology)),
    targetIdentitySha256: releaseSha256V2(canonicalBytesV2(target)),
    effectNotBefore,
    observedPostState: input.desiredState,
    observedAt,
    recoveredAfterCrash: true as const,
    result: "effect_confirmed" as const
  };
  return validateRuntimeEffectReconciliationEvidenceV2({ ...withoutBinding,
    bindingSha256: evidenceBinding(withoutBinding) });
}

export function validateRuntimeEffectReconciliationEvidenceV2(
  value: unknown,
  expected?: Readonly<{
    operationKind: ProductionOperationKindV2;
    operationId: string;
    operationClaimSha256: string;
    authorityConsumptionSha256: string;
    sequence: number;
    stepId: RuntimeEffectStepV2;
    intentRelativePath: string;
    intentSha256: string;
    intendedExternalEffectSha256: string;
    currentOperationLeaseSha256: string;
    currentOperationLeaseEpoch: number;
    authorityExpiresAt: string;
    operationDeadlineAt: string;
    topologySnapshotSha256: string;
    targetIdentitySha256: string;
    effectNotBefore: string;
    observedPostState: "target_absent" | "target_singleton";
    observedAt: string;
  }>
): RuntimeEffectReconciliationEvidenceV2 {
  const input = record(value, "runtime_effect_reconciliation_evidence");
  exactKeys(input, ["version", "operationKind", "operationId", "operationClaimSha256",
    "authorityConsumptionSha256", "sequence", "stepId", "intentRelativePath", "intentSha256",
    "intendedExternalEffectSha256", "currentOperationLeaseSha256", "currentOperationLeaseEpoch",
    "authorityExpiresAt", "operationDeadlineAt", "topologySnapshot", "topologySnapshotSha256",
    "targetIdentitySha256", "effectNotBefore",
    "observedPostState", "observedAt", "recoveredAfterCrash", "result", "bindingSha256"],
  "runtime_effect_reconciliation_evidence");
  if (input.version !== "runtime-effect-reconciliation-evidence-v2"
      || !new Set(["rollout", "rollback"]).has(String(input.operationKind))
      || typeof input.operationId !== "string" || input.operationId.length === 0
      || !Number.isSafeInteger(input.sequence) || Number(input.sequence) < 1
      || !EFFECT_STEP_SET.has(String(input.stepId))
      || typeof input.intentRelativePath !== "string" || input.intentRelativePath.length === 0
      || !Number.isSafeInteger(input.currentOperationLeaseEpoch) || Number(input.currentOperationLeaseEpoch) < 1
      || !new Set(["target_absent", "target_singleton"]).has(String(input.observedPostState))
      || input.recoveredAfterCrash !== true || input.result !== "effect_confirmed") {
    throw new Error("runtime_effect_reconciliation_evidence_invalid");
  }
  for (const key of ["operationClaimSha256", "authorityConsumptionSha256", "intentSha256",
    "intendedExternalEffectSha256", "currentOperationLeaseSha256", "topologySnapshotSha256",
    "targetIdentitySha256", "bindingSha256"] as const) {
    if (!SHA256.test(String(input[key]))) throw new Error("runtime_effect_reconciliation_evidence_invalid");
  }
  exactIso(input.authorityExpiresAt, "runtime_effect_reconciliation_authority_expiry");
  exactIso(input.operationDeadlineAt, "runtime_effect_reconciliation_operation_deadline");
  exactIso(input.effectNotBefore, "runtime_effect_reconciliation_effect_not_before");
  exactIso(input.observedAt, "runtime_effect_reconciliation_observed_at");
  const topologySnapshot = validateRuntimeTopologySnapshotV2(input.topologySnapshot);
  if (input.topologySnapshotSha256 !== releaseSha256V2(canonicalBytesV2(topologySnapshot))
      || topologySnapshot.observedAt !== input.observedAt) {
    throw new Error("runtime_effect_reconciliation_topology_binding_invalid");
  }
  const evidenceStepId = input.stepId as RuntimeEffectStepV2;
  if (STEP_KIND[evidenceStepId] !== input.operationKind
      || STEP_STATE[evidenceStepId] !== input.observedPostState
      || input.operationId !== `production-${input.operationKind}-${String(input.operationId).slice(-64)}`
      || !SHA256.test(String(input.operationId).slice(-64))
      || input.intentRelativePath !== `production-operation-step-intents/${input.operationId}/${input.sequence}-${input.stepId}-1-v2.json`
      || topologyBoundViolated(input)) {
    throw new Error("runtime_effect_reconciliation_evidence_scope_invalid");
  }
  const { bindingSha256, ...withoutBinding } = input;
  if (bindingSha256 !== evidenceBinding(withoutBinding as Omit<RuntimeEffectReconciliationEvidenceV2,
    "bindingSha256">)) throw new Error("runtime_effect_reconciliation_binding_invalid");
  if (expected !== undefined && (input.operationKind !== expected.operationKind
      || input.operationId !== expected.operationId
      || input.operationClaimSha256 !== expected.operationClaimSha256
      || input.authorityConsumptionSha256 !== expected.authorityConsumptionSha256
      || input.sequence !== expected.sequence
      || input.stepId !== expected.stepId
      || input.intentRelativePath !== expected.intentRelativePath
      || input.intentSha256 !== expected.intentSha256
      || input.intendedExternalEffectSha256 !== expected.intendedExternalEffectSha256
      || input.currentOperationLeaseSha256 !== expected.currentOperationLeaseSha256
      || input.currentOperationLeaseEpoch !== expected.currentOperationLeaseEpoch
      || input.authorityExpiresAt !== expected.authorityExpiresAt
      || input.operationDeadlineAt !== expected.operationDeadlineAt
      || input.topologySnapshotSha256 !== expected.topologySnapshotSha256
      || input.targetIdentitySha256 !== expected.targetIdentitySha256
      || input.effectNotBefore !== expected.effectNotBefore
      || input.observedPostState !== expected.observedPostState
      || input.observedAt !== expected.observedAt)) {
    throw new Error("runtime_effect_reconciliation_expected_binding_invalid");
  }
  return input as RuntimeEffectReconciliationEvidenceV2;
}

function topologyBoundViolated(input: Record<string, unknown>): boolean {
  const observedAt = Date.parse(String(input.observedAt));
  return observedAt >= Date.parse(String(input.authorityExpiresAt))
    || observedAt >= Date.parse(String(input.operationDeadlineAt))
    || Date.parse(String(input.effectNotBefore)) > observedAt;
}
