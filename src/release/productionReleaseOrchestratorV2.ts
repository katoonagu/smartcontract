import { createHash } from "node:crypto";
import { validateProductionReleaseEvidenceBundleV2 } from "./productionReleaseEvidenceV2";
import {
  releaseSha256V2,
  validateProductionCanaryEvidenceV2,
  validateProductionFailureEvidenceV2,
  validateProductionOperationSettlementV2,
  validateProductionOrchestrationReceiptV2,
  validateProductionOrchestrationStepIntentV2,
  validateProductionOrchestrationStepReceiptV2,
  validateProductionRecoveryInputV2,
  validateProductionRollbackEvidenceV2,
  validateProductionRolloutEvidenceV2,
  type ProductionOperationKindV2,
  type ProductionOrchestrationReceiptV2,
  type ProductionOrchestrationStepIntentV2,
  type ProductionOrchestrationStepReceiptV2,
  type ProductionRecoveryInputV2,
  type ProductionRollbackOutcomeV2
} from "./remediationReleaseManifestV2";
import { canonicalBytesV2 } from "./releaseRootWriterStore";
import {
  ProductionOperationStoreV2,
  type BegunProductionOperationV2,
  type ProductionOperationStoreRecordV2,
  type SettledRollbackHistoricalProofVerifierV2
} from "./productionOperationStore";

type ProductionDependenciesV2 = {
  persist(kind: string, value?: unknown): Promise<void>;
  effect(kind: string, value?: unknown): Promise<{ exitCode: number; outputSha256?: string }>;
  observe(kind: string, value?: unknown): Promise<{ ok: boolean; outputSha256?: string }>;
  now?: () => string;
};

const ROLLOUT_STEPS = ["verify_g13", "verify_schema", "verify_previous_runtime_identity",
  "verify_singleton_precondition", "stop_previous", "prove_previous_stopped", "start_candidate",
  "prove_candidate_started", "immediate_runtime_checks"] as const;
const CANARY_STEPS = ["verify_g14", "observe_cycle_1", "observe_cycle_2", "bounded_runtime_checks"] as const;
const ROLLBACK_STEPS = ["verify_failure", "prove_previous_healthy", "prove_no_previous_stop",
  "prove_no_candidate_start"] as const;
const RECOVERY_STEPS = ["verify_abandoned_cleanup", "verify_completed_prefix",
  "verify_uncertain_step_intent", "validate_failure_derivation_inputs"] as const;
const EFFECT_STEPS = new Set(["stop_previous", "start_candidate", "restart_previous",
  "stop_candidate", "start_previous"]);
const OBSERVATION_STEPS = new Set(["observe_cycle_1", "observe_cycle_2", "bounded_runtime_checks",
  "prove_previous_stopped", "prove_candidate_started", "immediate_runtime_checks"]);
const VERIFIED_TERMINAL_CHECKS = Object.freeze({
  rollout: ["schema", "version", "admin", "singleton", "workers", "logs", "delivery", "legacy"],
  canary: ["schema", "version", "admin", "singleton", "reconciliation", "delivery", "navigation",
    "allowance", "legacy", "secrets", "queues", "honest_limits"],
  rollback: ["schema032_retained", "previous_version", "admin", "singleton", "allowance", "legacy", "sent",
    "no_duplicate_send"]
} as const);

const PROTECTED_STEPS = Object.freeze({
  rollout: ROLLOUT_STEPS,
  canary: CANARY_STEPS,
  recovery: RECOVERY_STEPS
});
const PROTECTED_COMMAND = Object.freeze({
  rollout: "production_rollout",
  canary: "production_canary",
  rollback: "production_rollback",
  recovery: "production_recovery"
} as const);
const PROTECTED_RECEIPT_PATH = Object.freeze({
  rollout: "production-rollout-orchestration-receipt-v2.json",
  canary: "production-canary-orchestration-receipt-v2.json",
  rollback: "production-rollback-orchestration-receipt-v2.json",
  recovery: "production-recovery-orchestration-receipt-v2.json"
} as const);

export type ProtectedProductionLeafResultV2 = Readonly<{
  inputSha256: string;
  outputSha256: string;
  observedStateSha256: string;
  verifiedChecks?: readonly string[];
}>;

export type ProtectedProductionLeafInputV2 = Readonly<{
  artifactRoot: string;
  operationKind: ProductionOperationKindV2;
  operationId: string;
  sequence: number;
  stepId: string;
  inputSha256: string;
  intendedExternalEffectSha256?: string;
}>;

export type ProtectedProductionEffectPreparationInputV2 = ProtectedProductionLeafInputV2 & Readonly<{
  operationClaimSha256: string;
  authorityConsumptionSha256: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  releaseFreezeIdentitySha256: string;
}>;

export type ProtectedProductionEffectExecutionInputV2 = ProtectedProductionEffectPreparationInputV2 & Readonly<{
  intendedExternalEffectSha256: string;
  intent: ProductionOrchestrationStepIntentV2;
  intentSha256: string;
}>;

export type ProtectedRollbackWindowV2 =
  | Readonly<{ kind: "previous_runtime_retained";
      failedGateId: "G13_PRODUCTION_MIGRATION" | "G14_PRODUCTION_ROLLOUT" }>
  | Readonly<{ kind: "previous_runtime_restarted_without_candidate";
      failedGateId: "G14_PRODUCTION_ROLLOUT"; previousStopEvidenceSha256: string }>
  | Readonly<{ kind: "candidate_replaced_with_previous";
      failedGateId: "G14_PRODUCTION_ROLLOUT" | "G15_PRODUCTION_CANARY";
      candidateStartEvidenceSha256: string }>
  | Readonly<{ kind: "previous_already_restarted_without_candidate";
      failedGateId: "G14_PRODUCTION_ROLLOUT";
      previousStopEvidenceSha256: string; previousStartEvidenceSha256: string }>
  | Readonly<{ kind: "candidate_already_replaced_with_previous";
      failedGateId: "G14_PRODUCTION_ROLLOUT" | "G15_PRODUCTION_CANARY";
      candidateStartEvidenceSha256: string; candidateStopEvidenceSha256: string;
      previousStartEvidenceSha256: string }>
  | Readonly<{ kind: "candidate_already_stopped_previous_not_started";
      failedGateId: "G14_PRODUCTION_ROLLOUT" | "G15_PRODUCTION_CANARY";
      candidateStartEvidenceSha256: string; candidateStopEvidenceSha256: string }>;

export type ProtectedProductionOperationAdaptersV2 = Readonly<{
  now(): string;
  loadReleaseContext(artifactRoot: string): Promise<{
    releaseFreezeIdentitySha256: string;
    previousRuntimeKind: "manager_owned_previous_runtime" | "legacy_unmanaged_previous_runtime";
  }>;
  validateStep(input: ProtectedProductionLeafInputV2): Promise<ProtectedProductionLeafResultV2>;
  prepareEffect(input: ProtectedProductionEffectPreparationInputV2): Promise<string>;
  executeEffect(input: ProtectedProductionEffectExecutionInputV2): Promise<ProtectedProductionLeafResultV2>;
  reconcileEffect(input: ProtectedProductionEffectExecutionInputV2): Promise<ProtectedProductionLeafResultV2 | null>;
  verifySettledRollbackHistoricalProofs?: SettledRollbackHistoricalProofVerifierV2;
  resolveRollbackContext?(input: Readonly<{ artifactRoot: string; operationId: string }>): Promise<{
    window: ProtectedRollbackWindowV2;
    failureEvidenceSha256: string;
    previousRuntimeIdentitySha256: string;
  }>;
  loadRecoveryContext?(artifactRoot: string): Promise<{
    priorOperationKind: "rollout" | "canary";
    priorOperationId: string;
    priorTerminalAbandonedSha256: string;
    priorTerminalCleanupSha256: string;
    completedStepReceiptPrefix: ProductionRecoveryInputV2["completedStepReceiptPrefix"];
    completedStepReceiptPrefixSha256: string;
    uncertainStepMarker: ProductionRecoveryInputV2["uncertainStepMarker"];
    uncertainStepMarkerSha256: string | null;
    failedGateId: "G14_PRODUCTION_ROLLOUT" | "G15_PRODUCTION_CANARY";
    failureCode: "authority_expired_before_claim" | "authority_expired_after_claim" | "operation_deadline_reached";
    priorAttemptedExternalEffect: boolean;
  }>;
}>;

export type ProtectedProductionOperationStoreV2 = Readonly<{
  beginOperation(input: { operationKind: ProductionOperationKindV2; evaluatedAt: string;
    recoveryFromAbandonedOperationSha256?: string | null }): Promise<BegunProductionOperationV2>;
  assertOwnedAndWithinBounds(operationId: string, evaluatedAt: string): {
    lease: BegunProductionOperationV2["lease"];
    leaseSha256: string;
    claim: BegunProductionOperationV2["claim"];
    claimSha256: string;
    takeoverChainSha256: string;
  };
  heartbeat(operationId: string, evaluatedAt: string): {
    lease: BegunProductionOperationV2["lease"];
    leaseSha256: string;
  };
  persistStepIntent(value: unknown): ProductionOperationStoreRecordV2;
  loadStepIntent?(operationId: string, sequence: number, stepId: string, evaluatedAt: string): null | Readonly<{
    relativePath: string;
    sha256: string;
    intent: ProductionOrchestrationStepIntentV2;
  }>;
  persistStepReceipt(value: unknown): ProductionOperationStoreRecordV2;
  loadCompletedStepPrefix?(operationId: string, evaluatedAt: string): readonly Readonly<{
    relativePath: string;
    sha256: string;
    receipt: ProductionOrchestrationStepReceiptV2;
  }>[];
  loadCompletedOrchestrationReceipt?(operationId: string, evaluatedAt: string): null | Readonly<{
    relativePath: string;
    sha256: string;
    receipt: ProductionOrchestrationReceiptV2;
  }>;
  hasUnresolvedStepIntent(input: { operationId: string; sequence: number; stepId: string }): boolean;
  persistExclusive(kind: string, relativePath: string, value: unknown): ProductionOperationStoreRecordV2;
  loadOrPersistFailureDraft?(input: Readonly<{
    operationKind: "rollout" | "canary";
    operationId: string;
    operationClaimSha256: string;
    stepId: string;
    failureCode: string;
    attemptedExternalEffect: boolean;
    completedStepReceiptPrefixSha256: string;
    orchestrationProgressSha256: string;
  }>, evaluatedAt: string): Readonly<{ value: Readonly<{ observedAt: string }>; sha256: string }>;
  loadFailureDraft?(operationId: string, evaluatedAt: string): null | Readonly<{ value: Readonly<{
    operationKind: "rollout" | "canary";
    operationId: string;
    operationClaimSha256: string;
    stepId: string;
    failureCode: string;
    attemptedExternalEffect: boolean;
    completedStepReceiptPrefixSha256: string;
    orchestrationProgressSha256: string;
    observedAt: string;
  }>; sha256: string }>;
  persistTerminalArtifactIndex?(value: unknown, evaluatedAt: string): ProductionOperationStoreRecordV2;
  publishTerminalArtifacts?(operationId: string): void;
  persistSettlement(value: unknown): ProductionOperationStoreRecordV2;
  resumeCompletedSettlementBeforeBegin?(operationKind: ProductionOperationKindV2, evaluatedAt: string,
    verifySettledRollbackHistoricalProofs?: SettledRollbackHistoricalProofVerifierV2): null | Readonly<{
    result: "passed" | "failed";
    operationId: string;
    finalLeaseEpoch: number;
    orchestrationReceipt: Readonly<{ completedStepReceipts: readonly Readonly<{
      receipt: Readonly<{ stepId: string }>;
    }>[] }> | null;
    orchestrationReceiptSha256: string | null;
  }>;
  resumeCompletedSettlement?(operationId: string, evaluatedAt: string,
    verifySettledRollbackHistoricalProofs?: SettledRollbackHistoricalProofVerifierV2): null | Readonly<{
    settlement: Readonly<{ finalLeaseEpoch: number; result: "passed" | "failed" }>;
    orchestrationReceipt: Readonly<{ completedStepReceipts: readonly Readonly<{
      receipt: Readonly<{ stepId: string }>;
    }>[] }> | null;
    orchestrationReceiptSha256: string | null;
  }>;
  completeTerminal(input: { operationId: string; terminalStateKind: "settlement";
    terminalStateSha256: string; evaluatedAt: string; faultAt?: string }): unknown;
}>;

function terminalArtifactPath(
  store: ProtectedProductionOperationStoreV2,
  operationId: string,
  canonicalRelativePath: string
): string {
  return store.persistTerminalArtifactIndex === undefined ? canonicalRelativePath
    : `production-operation-terminal-artifacts/${operationId}/${canonicalRelativePath}`;
}

function injectedOperationFault(actual: string | undefined, expected: string): void {
  if (actual === expected) throw new Error(`injected_operation_fault:${expected}`);
}

type ProtectedExecutorDependenciesV2 = Readonly<{
  store?: ProtectedProductionOperationStoreV2;
  adapters: ProtectedProductionOperationAdaptersV2;
}>;

async function withProductionHeartbeatV2<T>(input: {
  store: ProtectedProductionOperationStoreV2;
  adapters: ProtectedProductionOperationAdaptersV2;
  operationId: string;
  run(): Promise<T>;
}): Promise<T> {
  let heartbeatFailure: unknown = null;
  let heartbeatTail = Promise.resolve();
  const timer = setInterval(() => {
    heartbeatTail = heartbeatTail.then(() => {
      input.store.heartbeat(input.operationId, input.adapters.now());
    }).catch((error) => { heartbeatFailure = error; });
  }, 5_000);
  timer.unref?.();
  try {
    const result = await input.run();
    await heartbeatTail;
    if (heartbeatFailure !== null) throw heartbeatFailure;
    return result;
  } finally {
    clearInterval(timer);
    await heartbeatTail;
  }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function protectedHash(value: unknown): string {
  return releaseSha256V2(canonicalBytesV2(value));
}

function rollbackSteps(outcome: ProtectedRollbackWindowV2): readonly string[] {
  if (outcome.kind === "previous_runtime_retained") {
    return ["verify_failure", "prove_previous_healthy", "prove_no_previous_stop", "prove_no_candidate_start"];
  }
  if (outcome.kind === "previous_runtime_restarted_without_candidate") {
    return ["verify_failure", "restart_previous", "prove_no_candidate_start", "rollback_runtime_checks"];
  }
  if (outcome.kind === "previous_already_restarted_without_candidate"
      || outcome.kind === "candidate_already_replaced_with_previous") {
    return ["verify_failure", "prove_previous_healthy", "prove_no_candidate_running", "rollback_runtime_checks"];
  }
  if (outcome.kind === "candidate_already_stopped_previous_not_started") {
    return ["verify_failure", "start_previous", "rollback_runtime_checks"];
  }
  return ["verify_failure", "stop_candidate", "start_previous", "rollback_runtime_checks"];
}

function materializeRollbackOutcome(
  selected: ProtectedRollbackWindowV2,
  captures: ReadonlyArray<{ stepId: string; outputSha256: string }>
): ProductionRollbackOutcomeV2 {
  const output = (stepId: string): string => {
    const value = captures.find((item) => item.stepId === stepId)?.outputSha256;
    if (!value) throw new Error(`production_rollback_capture_missing:${stepId}`);
    return value;
  };
  if (selected.kind === "previous_runtime_retained") {
    return { kind: selected.kind, failedGateId: selected.failedGateId,
      previousRuntimeHealthEvidenceSha256: output("prove_previous_healthy"),
      noPreviousStopEvidenceSha256: output("prove_no_previous_stop"),
      noCandidateStartEvidenceSha256: output("prove_no_candidate_start") };
  }
  if (selected.kind === "previous_runtime_restarted_without_candidate") {
    return { kind: selected.kind, failedGateId: selected.failedGateId,
      previousStopEvidenceSha256: selected.previousStopEvidenceSha256,
      noCandidateStartEvidenceSha256: output("prove_no_candidate_start"),
      previousStartEvidenceSha256: output("restart_previous") };
  }
  if (selected.kind === "previous_already_restarted_without_candidate") {
    return { kind: "previous_runtime_restarted_without_candidate", failedGateId: selected.failedGateId,
      previousStopEvidenceSha256: selected.previousStopEvidenceSha256,
      noCandidateStartEvidenceSha256: output("prove_no_candidate_running"),
      previousStartEvidenceSha256: selected.previousStartEvidenceSha256 };
  }
  if (selected.kind === "candidate_already_replaced_with_previous") {
    return { kind: "candidate_replaced_with_previous", failedGateId: selected.failedGateId,
      candidateStartEvidenceSha256: selected.candidateStartEvidenceSha256,
      candidateStopEvidenceSha256: selected.candidateStopEvidenceSha256,
      previousStartEvidenceSha256: selected.previousStartEvidenceSha256 };
  }
  if (selected.kind === "candidate_already_stopped_previous_not_started") {
    return { kind: "candidate_replaced_with_previous", failedGateId: selected.failedGateId,
      candidateStartEvidenceSha256: selected.candidateStartEvidenceSha256,
      candidateStopEvidenceSha256: selected.candidateStopEvidenceSha256,
      previousStartEvidenceSha256: output("start_previous") };
  }
  return { kind: selected.kind, failedGateId: selected.failedGateId,
    candidateStartEvidenceSha256: selected.candidateStartEvidenceSha256,
    candidateStopEvidenceSha256: output("stop_candidate"),
    previousStartEvidenceSha256: output("start_previous") };
}

function exactLeafResult(result: ProtectedProductionLeafResultV2, inputSha256: string): void {
  if (result.inputSha256 !== inputSha256
      || !/^[0-9a-f]{64}$/u.test(result.outputSha256)
      || !/^[0-9a-f]{64}$/u.test(result.observedStateSha256)) {
    throw new Error("production_leaf_capture_binding_invalid");
  }
}

function exactTerminalVerifiedChecks(
  operationKind: ProductionOperationKindV2,
  stepId: string,
  terminalStepId: string,
  checks: readonly string[] | undefined
): void {
  if (operationKind === "recovery") {
    if (checks !== undefined) throw new Error("production_recovery_verified_checks_forbidden");
    return;
  }
  const expected = VERIFIED_TERMINAL_CHECKS[operationKind];
  if (stepId !== terminalStepId) {
    if (checks !== undefined) throw new Error("production_verified_checks_nonterminal_forbidden");
    return;
  }
  if (checks === undefined
      || checks.length !== expected.length
      || checks.some((check, index) => check !== expected[index])) {
    throw new Error("production_terminal_verified_checks_invalid");
  }
}

function verifiedCheckRecord(checks: readonly string[] | undefined): Record<string, true> {
  if (!checks) throw new Error("production_terminal_verified_checks_missing");
  return Object.fromEntries(checks.map((check) => [check, true])) as Record<string, true>;
}

function productionFailureCode(
  operationKind: "rollout" | "canary",
  stepId: string,
  error: unknown
): string {
  const message = error instanceof Error ? error.message : "";
  if (operationKind === "rollout") {
    const byStep: Record<string, string> = {
      verify_g13: "g13_reverification_failed",
      verify_schema: "schema_verification_failed",
      verify_previous_runtime_identity: "previous_runtime_identity_mismatch",
      verify_singleton_precondition: "singleton_precondition_failed",
      stop_previous: "previous_runtime_stop_failed",
      start_candidate: "candidate_start_failed"
    };
    if (byStep[stepId]) return byStep[stepId]!;
    if (/admin/iu.test(message)) return "admin_unhealthy";
    if (/singleton/iu.test(message)) return "singleton_violation";
    if (/schema/iu.test(message)) return "schema_verification_failed";
    if (/delivery/iu.test(message)) return "delivery_invariant_failed";
    if (/legacy/iu.test(message)) return "legacy_population_changed";
    if (/secret/iu.test(message)) return "secret_detected";
    return "worker_start_failed";
  }
  if (/schema/iu.test(message)) return "schema_verification_failed";
  if (/polling|cycle/iu.test(message)) return "polling_cycles_incomplete";
  if (/version|runtime_sha|runtime_identity/iu.test(message)) return "runtime_version_mismatch";
  if (/admin/iu.test(message)) return "admin_unhealthy";
  if (/singleton/iu.test(message)) return "singleton_violation";
  if (/reconcil/iu.test(message)) return "reconciliation_failed";
  if (/delivery/iu.test(message)) return "delivery_invariant_failed";
  if (/navigation/iu.test(message)) return "navigation_invariant_failed";
  if (/allowance/iu.test(message)) return "allowance_invariant_failed";
  if (/legacy/iu.test(message)) return "legacy_population_changed";
  if (/queue/iu.test(message)) return "queue_growth_detected";
  if (/limit/iu.test(message)) return "honest_limit_misreported";
  if (/secret/iu.test(message)) return "secret_detected";
  return "canary_timeout";
}

function settleProtectedFailure(input: {
  operationKind: "rollout" | "canary";
  stepId: string;
  error: unknown;
  store: ProtectedProductionOperationStoreV2;
  adapters: ProtectedProductionOperationAdaptersV2;
  begun: BegunProductionOperationV2;
  releaseFreezeIdentitySha256: string;
  completedStepReceipts: ReadonlyArray<{ relativePath: string; sha256: string }>;
  captures: ReadonlyArray<{ stepId: string; sequence: number; executionKind: string;
    outputSha256: string; observedStateSha256: string; verifiedChecks?: readonly string[] }>;
  attemptedExternalEffect: boolean;
  faultAt?: string;
  failureCodeOverride?: string;
}): void {
  const evaluatedAt = input.adapters.now();
  const owned = input.store.assertOwnedAndWithinBounds(input.begun.lease.operationId, evaluatedAt);
  const failureCode = input.failureCodeOverride
    ?? productionFailureCode(input.operationKind, input.stepId, input.error);
  const progressSha256 = protectedHash({ completedStepReceipts: input.completedStepReceipts,
    captures: input.captures });
  const attemptedExternalEffect = input.operationKind === "canary" ? true : input.attemptedExternalEffect;
  const draft = input.store.loadOrPersistFailureDraft?.({ operationKind: input.operationKind,
    operationId: owned.lease.operationId, operationClaimSha256: owned.claimSha256,
    stepId: input.stepId, failureCode, attemptedExternalEffect,
    completedStepReceiptPrefixSha256: protectedHash(input.completedStepReceipts),
    orchestrationProgressSha256: progressSha256 }, evaluatedAt);
  const observedAt = draft?.value.observedAt ?? evaluatedAt;
  injectedOperationFault(input.faultAt, "after_failure_draft");
  const failureCaptureCanonicalPath = `production-operation-failure-capture-${owned.lease.operationId}.json`;
  const failureCapture = input.store.persistExclusive("production_operation_failure_capture",
    terminalArtifactPath(input.store, owned.lease.operationId, failureCaptureCanonicalPath), {
      version: "production-operation-failure-capture-v2",
      operationKind: input.operationKind,
      operationId: owned.lease.operationId,
      operationClaimSha256: owned.claimSha256,
      stepId: input.stepId,
      failureCode,
      attemptedExternalEffect,
      completedStepReceiptPrefixSha256: protectedHash(input.completedStepReceipts),
      orchestrationProgressSha256: progressSha256,
      observedAt
    });
  injectedOperationFault(input.faultAt, "after_failure_capture");
  const common = {
    version: "production-failure-evidence-v2" as const,
    candidateSha: owned.lease.candidateSha,
    releaseFreezeIdentitySha256: input.releaseFreezeIdentitySha256,
    sourceManifestSha256: owned.lease.sourceManifestSha256,
    failedExecutionEvidenceSha256: failureCapture.sha256,
    observedAt,
    failedGateId: input.operationKind === "rollout"
      ? "G14_PRODUCTION_ROLLOUT" as const : "G15_PRODUCTION_CANARY" as const
  };
  const preEffect = input.operationKind === "rollout"
    && ["verify_g13", "verify_schema", "verify_previous_runtime_identity", "verify_singleton_precondition"]
      .includes(input.stepId);
  const evidence = input.operationKind === "canary"
    ? validateProductionFailureEvidenceV2({ ...common, evidenceKind: "runtime_canary_checks",
      attemptedExternalEffect: true, orchestrationProgressSha256: progressSha256, failureCode })
    : preEffect
      ? validateProductionFailureEvidenceV2({ ...common, evidenceKind: "runtime_rollout_preflight",
        attemptedExternalEffect: false, orchestrationProgressSha256: progressSha256,
        preEffectValidationReceiptsSha256: protectedHash(input.completedStepReceipts), failureCode })
      : validateProductionFailureEvidenceV2({ ...common,
        evidenceKind: input.stepId === "stop_previous" || input.stepId === "start_candidate"
          ? "runtime_manager_capture" : "runtime_rollout_checks",
        attemptedExternalEffect: true, orchestrationProgressSha256: progressSha256, failureCode });
  const evidenceCanonicalPath = "production-failure-evidence-v2.json";
  const evidenceRecord = input.store.persistExclusive("production_failure_evidence",
    terminalArtifactPath(input.store, owned.lease.operationId, evidenceCanonicalPath), evidence);
  injectedOperationFault(input.faultAt, "after_failure_evidence");
  input.store.persistTerminalArtifactIndex?.({
    version: "production-terminal-artifact-index-v2",
    operationKind: input.operationKind,
    operationId: owned.lease.operationId,
    operationClaimSha256: owned.claimSha256,
    authorityConsumptionSha256: owned.claim.authorityConsumptionSha256,
    terminalEvidenceSha256: evidenceRecord.sha256,
    orchestrationReceiptSha256: null,
    artifacts: [
      { kind: "failure_capture", operationQualifiedRelativePath: failureCapture.relativePath,
        canonicalRelativePath: failureCaptureCanonicalPath, sha256: failureCapture.sha256 },
      { kind: "failure_evidence", operationQualifiedRelativePath: evidenceRecord.relativePath,
        canonicalRelativePath: evidenceCanonicalPath, sha256: evidenceRecord.sha256 }
    ]
  }, evaluatedAt);
  injectedOperationFault(input.faultAt, "after_failure_terminal_index");
  const settlement = validateProductionOperationSettlementV2({
    version: "production-operation-settlement-v2", operationKind: input.operationKind,
    operationId: owned.lease.operationId, candidateSha: owned.lease.candidateSha,
    releaseGenerationId: owned.lease.releaseGenerationId,
    sourceManifestSha256: owned.lease.sourceManifestSha256,
    claimSha256: owned.claimSha256,
    authorityConsumptionSha256: owned.claim.authorityConsumptionSha256,
    finalLeaseSha256: owned.leaseSha256, finalLeaseEpoch: owned.lease.leaseEpoch,
    operationDeadlineAt: owned.lease.operationDeadlineAt,
    terminalEvidenceSha256: evidenceRecord.sha256,
    authorityRevalidatedAt: observedAt, deadlineRevalidatedAt: observedAt, settledAt: observedAt,
    capability: "effect_capable", result: "failed", orchestrationReceiptSha256: null,
    attemptedExternalEffect
  });
  const settlementRecord = input.store.persistSettlement(settlement);
  injectedOperationFault(input.faultAt, "after_failure_settlement");
  input.store.publishTerminalArtifacts?.(owned.lease.operationId);
  injectedOperationFault(input.faultAt, "after_failure_terminal_publication");
  input.store.completeTerminal({ operationId: owned.lease.operationId, terminalStateKind: "settlement",
    terminalStateSha256: settlementRecord.sha256, evaluatedAt,
    faultAt: input.faultAt });
}

/**
 * The only effect-capable production entry point. Its caller supplies a protected root and
 * a closed operation kind; every command, query and capture is selected by fixed adapters.
 */
export async function executeProtectedProductionOperationV2(
  input: { artifactRoot: string; operationKind: ProductionOperationKindV2; faultAt?: string },
  dependencies: ProtectedExecutorDependenciesV2
): Promise<{ operationId: string; leaseEpoch: number; receiptSha256: string; completedSteps: readonly string[] }> {
  const adapters = dependencies.adapters;
  const store = dependencies.store ?? new ProductionOperationStoreV2(input.artifactRoot);
  const preBeginSettlement = store.resumeCompletedSettlementBeforeBegin?.(
    input.operationKind, adapters.now(), adapters.verifySettledRollbackHistoricalProofs) ?? null;
  if (preBeginSettlement !== null) {
    if ((preBeginSettlement.result !== "passed" && input.operationKind !== "recovery")
        || preBeginSettlement.orchestrationReceipt === null
        || preBeginSettlement.orchestrationReceiptSha256 === null) {
      throw new Error("production_operation_previous_failure_settled");
    }
    return { operationId: preBeginSettlement.operationId,
      leaseEpoch: preBeginSettlement.finalLeaseEpoch,
      receiptSha256: preBeginSettlement.orchestrationReceiptSha256,
      completedSteps: preBeginSettlement.orchestrationReceipt.completedStepReceipts
        .map((record) => record.receipt.stepId) };
  }
  const releaseContext = await adapters.loadReleaseContext(input.artifactRoot);
  if (releaseContext.previousRuntimeKind !== "manager_owned_previous_runtime") {
    throw new Error("legacy_unmanaged_previous_runtime_action_forbidden");
  }
  let recoveryContext: Awaited<ReturnType<NonNullable<typeof adapters.loadRecoveryContext>>> | null = null;
  let rollbackContext: Awaited<ReturnType<NonNullable<typeof adapters.resolveRollbackContext>>> | null = null;
  if (input.operationKind === "recovery") {
    if (!adapters.loadRecoveryContext) throw new Error("production_recovery_context_unavailable");
    recoveryContext = await adapters.loadRecoveryContext(input.artifactRoot);
  }
  const beganAt = adapters.now();
  const begun = await store.beginOperation({
    operationKind: input.operationKind,
    evaluatedAt: beganAt,
    recoveryFromAbandonedOperationSha256: recoveryContext?.priorTerminalAbandonedSha256 ?? null
  });
  const completedSettlement = store.resumeCompletedSettlement?.(begun.lease.operationId, adapters.now(),
    adapters.verifySettledRollbackHistoricalProofs) ?? null;
  if (completedSettlement !== null) {
    if (completedSettlement.settlement.result !== "passed"
        || completedSettlement.orchestrationReceipt === null
        || completedSettlement.orchestrationReceiptSha256 === null) {
      throw new Error("production_operation_previous_failure_settled");
    }
    return { operationId: begun.lease.operationId,
      leaseEpoch: completedSettlement.settlement.finalLeaseEpoch,
      receiptSha256: completedSettlement.orchestrationReceiptSha256,
      completedSteps: completedSettlement.orchestrationReceipt.completedStepReceipts
        .map((record) => record.receipt.stepId) };
  }
  if (input.operationKind === "rollback") {
    if (!adapters.resolveRollbackContext) throw new Error("production_rollback_context_unavailable");
    store.assertOwnedAndWithinBounds(begun.lease.operationId, adapters.now());
    rollbackContext = await adapters.resolveRollbackContext({
      artifactRoot: input.artifactRoot,
      operationId: begun.lease.operationId
    });
    store.assertOwnedAndWithinBounds(begun.lease.operationId, adapters.now());
  }
  const recoveryInput = recoveryContext === null ? null : validateProductionRecoveryInputV2({
    version: "production-recovery-input-v2",
    priorOperationKind: recoveryContext.priorOperationKind,
    priorOperationId: recoveryContext.priorOperationId,
    priorTerminalAbandonedSha256: recoveryContext.priorTerminalAbandonedSha256,
    priorTerminalCleanupSha256: recoveryContext.priorTerminalCleanupSha256,
    completedStepReceiptPrefix: recoveryContext.completedStepReceiptPrefix,
    completedStepReceiptPrefixSha256: recoveryContext.completedStepReceiptPrefixSha256,
    uncertainStepMarker: recoveryContext.uncertainStepMarker,
    uncertainStepMarkerSha256: recoveryContext.uncertainStepMarkerSha256,
    recoveryOperationalAttestationSha256: begun.selectedAuthoritySha256,
    recoveryProductionLeaseSha256: begun.claim.authorityConsumption.leaseSha256AtConsumption,
    recoveryAuthorityPreclaimSha256: begun.preclaimSha256,
    recoveryOperationClaimSha256: begun.claimSha256,
    recoveryAuthorityConsumptionSha256: begun.claim.authorityConsumptionSha256,
    verifiedAt: begun.claim.claimedAt
  });
  if (recoveryInput !== null) {
    const recoveryInputRecord = store.persistExclusive("production_recovery_input",
      "production-recovery-input-v2.json", recoveryInput);
    if (recoveryInputRecord.sha256 !== protectedHash(recoveryInput)) {
      throw new Error("production_recovery_input_persistence_invalid");
    }
  }
  const stepIds = input.operationKind === "rollback"
    ? rollbackSteps(rollbackContext!.window)
    : PROTECTED_STEPS[input.operationKind];
  const commandId = PROTECTED_COMMAND[input.operationKind];
  const captures: Array<{ stepId: string; sequence: number; executionKind: string;
    outputSha256: string; observedStateSha256: string; verifiedChecks?: readonly string[] }> = [];
  const completedStepReceipts: Array<{ relativePath: string; sha256: string;
    receipt: ProductionOrchestrationStepReceiptV2 }> = [];
  let attemptedExternalEffect = false;
  let activeStepId = "";
  let successSettlementPersisted = false;
  let unresolvedEffectIntent = false;
  let activeEffectIntent: { operationId: string; sequence: number; stepId: string } | null = null;
  let activeStepSequence = 0;

  const durablePrefix = store.loadCompletedStepPrefix?.(begun.lease.operationId, adapters.now()) ?? [];
  durablePrefix.forEach((record, index) => {
    const expectedStepId = stepIds[index];
    const receipt = record.receipt;
    const expectedInputSha256 = protectedHash({ version: "production-leaf-input-v2",
      operationId: begun.lease.operationId, operationKind: input.operationKind,
      sequence: index + 1, stepId: expectedStepId });
    if (expectedStepId === undefined || receipt.sequence !== index + 1 || receipt.stepId !== expectedStepId
        || receipt.inputSha256 !== expectedInputSha256 || receipt.commandId !== commandId
        || receipt.redactedTemplateSha256 !== begun.selectedAuthority.redactedTemplateSha256) {
      throw new Error("production_completed_step_prefix_binding_invalid");
    }
    const checks = receipt.verifiedChecks === null ? undefined : receipt.verifiedChecks;
    exactTerminalVerifiedChecks(input.operationKind, receipt.stepId, stepIds[stepIds.length - 1]!, checks);
    completedStepReceipts.push(record);
    captures.push({ stepId: receipt.stepId, sequence: receipt.sequence,
      executionKind: receipt.executionKind, outputSha256: receipt.outputSha256,
      observedStateSha256: receipt.observedStateSha256,
      ...(checks === undefined ? {} : { verifiedChecks: [...checks] }) });
    if (receipt.executionKind === "external_effect") attemptedExternalEffect = true;
  });

  const durableFailure = store.loadFailureDraft?.(begun.lease.operationId, adapters.now()) ?? null;
  if (durableFailure !== null) {
    const expectedFailedStep = stepIds[durablePrefix.length];
    const expectedAttemptedEffect = input.operationKind === "canary" ? true : attemptedExternalEffect;
    if ((input.operationKind !== "rollout" && input.operationKind !== "canary")
        || expectedFailedStep === undefined
        || durableFailure.value.operationKind !== input.operationKind
        || durableFailure.value.operationId !== begun.lease.operationId
        || durableFailure.value.operationClaimSha256 !== begun.claimSha256
        || durableFailure.value.stepId !== expectedFailedStep
        || durableFailure.value.attemptedExternalEffect !== expectedAttemptedEffect
        || durableFailure.value.completedStepReceiptPrefixSha256 !== protectedHash(completedStepReceipts)
        || durableFailure.value.orchestrationProgressSha256 !== protectedHash({ completedStepReceipts,
          captures })) {
      throw new Error("production_failure_draft_resume_binding_invalid");
    }
    settleProtectedFailure({ operationKind: input.operationKind, stepId: expectedFailedStep,
      error: new Error("durable production failure"), failureCodeOverride: durableFailure.value.failureCode,
      store, adapters, begun, releaseFreezeIdentitySha256: releaseContext.releaseFreezeIdentitySha256,
      completedStepReceipts, captures, attemptedExternalEffect, faultAt: input.faultAt });
    throw new Error("production_operation_previous_failure_settled");
  }

  try {
  for (const [offset, stepId] of stepIds.entries()) {
    activeStepId = stepId;
    const sequence = offset + 1;
    activeStepSequence = sequence;
    if (sequence <= durablePrefix.length) continue;
    const startedAt = adapters.now();
    let owned = store.assertOwnedAndWithinBounds(begun.lease.operationId, startedAt);
    const inputSha256 = protectedHash({ version: "production-leaf-input-v2", operationId: begun.lease.operationId,
      operationKind: input.operationKind, sequence, stepId });
    const leafInput = { artifactRoot: input.artifactRoot, operationKind: input.operationKind,
      operationId: begun.lease.operationId, sequence, stepId, inputSha256 };
    let leaf: ProtectedProductionLeafResultV2;
    let executionKind: "external_effect" | "local_validation" = "local_validation";
    let intentPath: string | null = null;
    let intentSha256: string | null = null;
    let recoveredAfterCrash = false;
    if (EFFECT_STEPS.has(stepId)) {
      executionKind = "external_effect";
      const effectPreparation = {
        ...leafInput,
        operationClaimSha256: owned.claimSha256,
        authorityConsumptionSha256: owned.claim.authorityConsumptionSha256,
        releaseGenerationId: owned.lease.releaseGenerationId,
        sourceManifestSha256: owned.lease.sourceManifestSha256,
        releaseFreezeIdentitySha256: releaseContext.releaseFreezeIdentitySha256
      };
      const relativePath = `production-operation-step-intents/${begun.lease.operationId}/${sequence}-${stepId}-1-v2.json`;
      const existingIntent = store.loadStepIntent?.(begun.lease.operationId, sequence, stepId, startedAt) ?? null;
      const intendedExternalEffectSha256 = existingIntent?.intent.intendedExternalEffectSha256
        ?? await adapters.prepareEffect(effectPreparation);
      if (!/^[0-9a-f]{64}$/u.test(intendedExternalEffectSha256)) {
        throw new Error("production_intended_effect_binding_invalid");
      }
      const intent = existingIntent?.intent ?? validateProductionOrchestrationStepIntentV2({
        version: "production-orchestration-step-intent-v2",
        capability: "effect_capable",
        orchestration: input.operationKind,
        operationId: begun.lease.operationId,
        operationClaimSha256: owned.claimSha256,
        authorityConsumptionSha256: owned.claim.authorityConsumptionSha256,
        sequence,
        stepId,
        attempt: 1,
        relativePath,
        currentOperationLeaseSha256: owned.leaseSha256,
        currentOperationLeaseEpoch: owned.lease.leaseEpoch,
        commandId,
        redactedTemplateSha256: begun.selectedAuthority.redactedTemplateSha256,
        inputSha256,
        intendedExternalEffectSha256,
        preparedAt: startedAt
      });
      if (intent.inputSha256 !== inputSha256 || intent.intendedExternalEffectSha256 !== intendedExternalEffectSha256
          || intent.commandId !== commandId
          || intent.redactedTemplateSha256 !== begun.selectedAuthority.redactedTemplateSha256) {
        throw new Error("production_existing_step_intent_binding_invalid");
      }
      activeEffectIntent = { operationId: begun.lease.operationId, sequence, stepId };
      const persistedIntent = existingIntent === null ? store.persistStepIntent(intent)
        : { kind: "production_orchestration_step_intent", relativePath: existingIntent.relativePath,
          sha256: existingIntent.sha256, created: false };
      intentPath = persistedIntent.relativePath;
      intentSha256 = persistedIntent.sha256;
      // ponytail: one durable attempt per effect; an intent without its exact receipt is
      // uncertain and must remain available for bounded read-only reconciliation.
      unresolvedEffectIntent = true;
      injectedOperationFault(input.faultAt, `after_step_intent:${stepId}`);
      owned = store.assertOwnedAndWithinBounds(begun.lease.operationId, adapters.now());
      if (persistedIntent.created) {
        attemptedExternalEffect = true;
        leaf = await adapters.executeEffect({ ...effectPreparation, intendedExternalEffectSha256,
          intent, intentSha256 });
        injectedOperationFault(input.faultAt, `after_external_effect:${stepId}`);
      } else {
        const reconciled = await adapters.reconcileEffect({ ...effectPreparation, intendedExternalEffectSha256,
          intent, intentSha256 });
        if (reconciled === null) throw new Error(`production_effect_outcome_uncertain:${stepId}`);
        leaf = reconciled;
        attemptedExternalEffect = true;
        recoveredAfterCrash = true;
      }
    } else {
      leaf = await withProductionHeartbeatV2({ store, adapters,
        operationId: begun.lease.operationId,
        run: () => adapters.validateStep(leafInput) });
    }
    exactLeafResult(leaf, inputSha256);
    exactTerminalVerifiedChecks(input.operationKind, stepId, stepIds[stepIds.length - 1]!, leaf.verifiedChecks);
    const finishedAt = adapters.now();
    owned = store.assertOwnedAndWithinBounds(begun.lease.operationId, finishedAt);
    const receipt = validateProductionOrchestrationStepReceiptV2({
      version: "production-orchestration-step-receipt-v2",
      operationId: begun.lease.operationId,
      operationClaimSha256: owned.claimSha256,
      authorityConsumptionSha256: owned.claim.authorityConsumptionSha256,
      operationLeaseSha256: owned.leaseSha256,
      operationLeaseEpoch: owned.lease.leaseEpoch,
      operationDeadlineAt: owned.lease.operationDeadlineAt,
      inputSha256,
      outputSha256: leaf.outputSha256,
      observedStateSha256: leaf.observedStateSha256,
      sequence,
      startedAt,
      finishedAt,
      recoveredAfterCrash,
      verifiedChecks: leaf.verifiedChecks === undefined ? null : [...leaf.verifiedChecks],
      result: "completed",
      capability: begun.lease.capability,
      commandId,
      redactedTemplateSha256: begun.selectedAuthority.redactedTemplateSha256,
      executionKind,
      stepIntentRelativePath: intentPath,
      stepIntentSha256: intentSha256,
      orchestration: input.operationKind,
      stepId
    });
    const persisted = store.persistStepReceipt(receipt);
    if (persisted.sha256 !== protectedHash(receipt)) throw new Error("production_step_receipt_hash_invalid");
    unresolvedEffectIntent = false;
    activeEffectIntent = null;
    completedStepReceipts.push({ relativePath: persisted.relativePath, sha256: persisted.sha256, receipt });
    captures.push({ stepId, sequence, executionKind, outputSha256: leaf.outputSha256,
      observedStateSha256: leaf.observedStateSha256, ...(leaf.verifiedChecks === undefined
        ? {} : { verifiedChecks: [...leaf.verifiedChecks] }) });
    injectedOperationFault(input.faultAt, `after_step_receipt:${stepId}`);
  }

  const completedAt = completedStepReceipts.at(-1)?.receipt.finishedAt ?? adapters.now();
  const final = store.assertOwnedAndWithinBounds(begun.lease.operationId, completedAt);
  const existingOrchestration = store.loadCompletedOrchestrationReceipt?.(
    begun.lease.operationId, adapters.now()) ?? null;
  const orchestrationReceipt = existingOrchestration?.receipt ?? validateProductionOrchestrationReceiptV2({
    version: "production-orchestration-receipt-v2",
    candidateSha: final.lease.candidateSha,
    releaseGenerationId: final.lease.releaseGenerationId,
    sourceManifestSha256: final.lease.sourceManifestSha256,
    operationId: final.lease.operationId,
    operationClaimSha256: final.claimSha256,
    finalOperationLeaseSha256: final.leaseSha256,
    finalOperationLeaseEpoch: final.lease.leaseEpoch,
    operationDeadlineAt: final.lease.operationDeadlineAt,
    operationLeaseTakeoverChainSha256: final.takeoverChainSha256,
    operationalAttestationConsumptionSha256: final.claim.authorityConsumptionSha256,
    redactedTemplateSha256: begun.selectedAuthority.redactedTemplateSha256,
    result: "completed",
    orchestration: input.operationKind,
    capability: final.lease.capability,
    commandId,
    recoveryInputSha256: recoveryInput === null ? null : protectedHash(recoveryInput),
    ...(recoveryInput === null ? {} : {
      recoveryAttemptedExternalEffect: false,
      priorAttemptedExternalEffect: recoveryContext!.priorAttemptedExternalEffect,
      priorCompletedStepReceiptPrefixSha256: recoveryInput.completedStepReceiptPrefixSha256,
      priorUncertainStepMarkerSha256: recoveryInput.uncertainStepMarkerSha256
    }),
    completedStepReceipts
  });
  const orchestrationRecord = existingOrchestration === null
    ? store.persistExclusive(`${input.operationKind}_orchestration`,
      terminalArtifactPath(store, begun.lease.operationId, PROTECTED_RECEIPT_PATH[input.operationKind]),
      orchestrationReceipt)
    : { kind: `${input.operationKind}_orchestration`, relativePath: existingOrchestration.relativePath,
      sha256: existingOrchestration.sha256, created: false };
  if (orchestrationRecord.sha256 !== protectedHash(orchestrationReceipt)) {
    throw new Error("production_orchestration_receipt_hash_invalid");
  }
  injectedOperationFault(input.faultAt, "after_orchestration_receipt");

  const capturesCanonicalPath = input.operationKind === "rollout" ? "production-rollout-query-captures-v2.json"
      : input.operationKind === "canary" ? "production-canary-query-captures-v2.json"
        : input.operationKind === "rollback" ? "production-rollback-query-captures-v2.json"
          : "production-recovery-validation-captures-v2.json";
  const capturesRecord = store.persistExclusive(`${input.operationKind}_captures`,
    terminalArtifactPath(store, begun.lease.operationId, capturesCanonicalPath),
    { version: "production-orchestration-captures-v2", operationId: begun.lease.operationId, captures });
  injectedOperationFault(input.faultAt, "after_query_captures");
  const terminalArtifactRefs: Array<{ kind: string; operationQualifiedRelativePath: string;
    canonicalRelativePath: string | null; sha256: string }> = [
    { kind: `${input.operationKind}_orchestration`, operationQualifiedRelativePath: orchestrationRecord.relativePath,
      canonicalRelativePath: PROTECTED_RECEIPT_PATH[input.operationKind], sha256: orchestrationRecord.sha256 },
    { kind: `${input.operationKind}_captures`, operationQualifiedRelativePath: capturesRecord.relativePath,
      canonicalRelativePath: capturesCanonicalPath, sha256: capturesRecord.sha256 }
  ];
  let terminalEvidence: ProductionOperationStoreRecordV2;
  if (input.operationKind === "rollout") {
    const managerCanonicalPath = "production-rollout-manager-captures-v2.json";
    const manager = store.persistExclusive("production_rollout_manager",
      terminalArtifactPath(store, begun.lease.operationId, managerCanonicalPath),
      { version: "production-manager-captures-v2", operationId: begun.lease.operationId,
        captures: captures.filter((item) => item.executionKind === "external_effect") });
    injectedOperationFault(input.faultAt, "after_auxiliary_captures");
    const evidence = validateProductionRolloutEvidenceV2({
      version: "production-rollout-evidence-v2", candidateSha: final.lease.candidateSha,
      releaseFreezeIdentitySha256: releaseContext.releaseFreezeIdentitySha256,
      operationalAttestationConsumptionSha256: final.claim.authorityConsumptionSha256,
      sourceManifestSha256: final.lease.sourceManifestSha256,
      previousStopEvidenceSha256: captures.find((item) => item.stepId === "stop_previous")!.outputSha256,
      candidateStartEvidenceSha256: captures.find((item) => item.stepId === "start_candidate")!.outputSha256,
      managerCapturesSha256: manager.sha256, queryCapturesSha256: capturesRecord.sha256,
      orchestrationReceiptSha256: orchestrationRecord.sha256,
      checks: verifiedCheckRecord(captures.at(-1)?.verifiedChecks), result: "passed"
    });
    const evidenceCanonicalPath = "production-rollout-evidence-v2.json";
    terminalEvidence = store.persistExclusive("production_rollout_evidence",
      terminalArtifactPath(store, begun.lease.operationId, evidenceCanonicalPath), evidence);
    terminalArtifactRefs.push(
      { kind: "rollout_manager", operationQualifiedRelativePath: manager.relativePath,
        canonicalRelativePath: managerCanonicalPath, sha256: manager.sha256 },
      { kind: "rollout_evidence", operationQualifiedRelativePath: terminalEvidence.relativePath,
        canonicalRelativePath: evidenceCanonicalPath, sha256: terminalEvidence.sha256 });
  } else if (input.operationKind === "canary") {
    const logsCanonicalPath = "production-canary-log-captures-v2.json";
    const logs = store.persistExclusive("production_canary_logs",
      terminalArtifactPath(store, begun.lease.operationId, logsCanonicalPath),
      { version: "production-canary-log-captures-v2", operationId: begun.lease.operationId,
        captureSha256s: captures.map((item) => item.outputSha256) });
    injectedOperationFault(input.faultAt, "after_auxiliary_captures");
    const evidence = validateProductionCanaryEvidenceV2({
      version: "production-canary-evidence-v2", candidateSha: final.lease.candidateSha,
      releaseFreezeIdentitySha256: releaseContext.releaseFreezeIdentitySha256,
      operationalAttestationConsumptionSha256: final.claim.authorityConsumptionSha256,
      sourceManifestSha256: final.lease.sourceManifestSha256,
      observationStartedAt: completedStepReceipts[0]?.receipt.startedAt ?? beganAt,
      observationFinishedAt: completedAt, completedPollingCycles: 2,
      queryCapturesSha256: capturesRecord.sha256, logCapturesSha256: logs.sha256,
      orchestrationReceiptSha256: orchestrationRecord.sha256,
      checks: verifiedCheckRecord(captures.at(-1)?.verifiedChecks), result: "passed"
    });
    const evidenceCanonicalPath = "production-canary-evidence-v2.json";
    terminalEvidence = store.persistExclusive("production_canary_evidence",
      terminalArtifactPath(store, begun.lease.operationId, evidenceCanonicalPath), evidence);
    terminalArtifactRefs.push(
      { kind: "canary_logs", operationQualifiedRelativePath: logs.relativePath,
        canonicalRelativePath: logsCanonicalPath, sha256: logs.sha256 },
      { kind: "canary_evidence", operationQualifiedRelativePath: terminalEvidence.relativePath,
        canonicalRelativePath: evidenceCanonicalPath, sha256: terminalEvidence.sha256 });
  } else if (input.operationKind === "rollback") {
    const managerCanonicalPath = "production-rollback-manager-captures-v2.json";
    const manager = store.persistExclusive("production_rollback_manager",
      terminalArtifactPath(store, begun.lease.operationId, managerCanonicalPath),
      { version: "production-manager-captures-v2", operationId: begun.lease.operationId,
        captures: captures.filter((item) => item.executionKind === "external_effect") });
    injectedOperationFault(input.faultAt, "after_auxiliary_captures");
    const evidence = validateProductionRollbackEvidenceV2({
      version: "production-rollback-evidence-v2", candidateSha: final.lease.candidateSha,
      releaseFreezeIdentitySha256: releaseContext.releaseFreezeIdentitySha256,
      artifactRootFingerprintSha256: final.lease.artifactRootFingerprintSha256,
      sourceManifestSha256: final.lease.sourceManifestSha256,
      failureEvidenceSha256: rollbackContext!.failureEvidenceSha256,
      operationalAttestationSha256: begun.selectedAuthoritySha256,
      operationalAttestationConsumptionSha256: final.claim.authorityConsumptionSha256,
      commandId: "production_rollback", redactedTemplateSha256: begun.selectedAuthority.redactedTemplateSha256,
      previousRuntimeIdentitySha256: rollbackContext!.previousRuntimeIdentitySha256,
      orchestrationReceiptSha256: orchestrationRecord.sha256,
      outcome: materializeRollbackOutcome(rollbackContext!.window, captures),
      queryCapturesSha256: capturesRecord.sha256,
      checks: verifiedCheckRecord(captures.at(-1)?.verifiedChecks)
    });
    void manager;
    const evidenceCanonicalPath = "production-rollback-evidence-v2.json";
    terminalEvidence = store.persistExclusive("production_rollback_evidence",
      terminalArtifactPath(store, begun.lease.operationId, evidenceCanonicalPath), evidence);
    terminalArtifactRefs.push(
      { kind: "rollback_manager", operationQualifiedRelativePath: manager.relativePath,
        canonicalRelativePath: managerCanonicalPath, sha256: manager.sha256 },
      { kind: "rollback_evidence", operationQualifiedRelativePath: terminalEvidence.relativePath,
        canonicalRelativePath: evidenceCanonicalPath, sha256: terminalEvidence.sha256 });
  } else {
    const evidence = validateProductionFailureEvidenceV2({
      version: "production-failure-evidence-v2", candidateSha: final.lease.candidateSha,
      releaseFreezeIdentitySha256: releaseContext.releaseFreezeIdentitySha256,
      sourceManifestSha256: final.lease.sourceManifestSha256,
      failedExecutionEvidenceSha256: orchestrationRecord.sha256,
      observedAt: completedAt, failedGateId: recoveryContext!.failedGateId,
      evidenceKind: "abandoned_operation_recovery",
      priorAttemptedExternalEffect: recoveryContext!.priorAttemptedExternalEffect,
      recoveryAttemptedExternalEffect: false,
      recoveryInputSha256: protectedHash(recoveryInput!),
      recoveryOrchestrationReceiptSha256: orchestrationRecord.sha256,
      priorTerminalAbandonedSha256: recoveryInput!.priorTerminalAbandonedSha256,
      priorTerminalCleanupSha256: recoveryInput!.priorTerminalCleanupSha256,
      completedStepReceiptPrefixSha256: recoveryInput!.completedStepReceiptPrefixSha256,
      uncertainStepMarkerSha256: recoveryInput!.uncertainStepMarkerSha256,
      recoveryOperationalAttestationSha256: begun.selectedAuthoritySha256,
      recoveryProductionLeaseSha256: recoveryInput!.recoveryProductionLeaseSha256,
      recoveryAuthorityPreclaimSha256: begun.preclaimSha256,
      recoveryOperationClaimSha256: final.claimSha256,
      recoveryAuthorityConsumptionSha256: final.claim.authorityConsumptionSha256,
      failureCode: recoveryContext!.failureCode
    });
    const evidenceCanonicalPath = "production-failure-evidence-v2.json";
    terminalEvidence = store.persistExclusive("production_failure_evidence",
      terminalArtifactPath(store, begun.lease.operationId, evidenceCanonicalPath), evidence);
    terminalArtifactRefs.push({ kind: "recovery_failure_evidence",
      operationQualifiedRelativePath: terminalEvidence.relativePath,
      canonicalRelativePath: evidenceCanonicalPath, sha256: terminalEvidence.sha256 });
  }

  injectedOperationFault(input.faultAt, "after_terminal_evidence");

  const settlementTime = adapters.now();
  const settlementOwned = store.assertOwnedAndWithinBounds(begun.lease.operationId, settlementTime);
  store.persistTerminalArtifactIndex?.({
    version: "production-terminal-artifact-index-v2",
    operationKind: input.operationKind,
    operationId: settlementOwned.lease.operationId,
    operationClaimSha256: settlementOwned.claimSha256,
    authorityConsumptionSha256: settlementOwned.claim.authorityConsumptionSha256,
    terminalEvidenceSha256: terminalEvidence.sha256,
    orchestrationReceiptSha256: orchestrationRecord.sha256,
    artifacts: terminalArtifactRefs
  }, settlementTime);
  injectedOperationFault(input.faultAt, "after_terminal_index");
  const settlement = validateProductionOperationSettlementV2(input.operationKind === "recovery" ? {
    version: "production-operation-settlement-v2", operationKind: input.operationKind,
    operationId: settlementOwned.lease.operationId, candidateSha: settlementOwned.lease.candidateSha,
    releaseGenerationId: settlementOwned.lease.releaseGenerationId,
    sourceManifestSha256: settlementOwned.lease.sourceManifestSha256,
    claimSha256: settlementOwned.claimSha256,
    authorityConsumptionSha256: settlementOwned.claim.authorityConsumptionSha256,
    finalLeaseSha256: settlementOwned.leaseSha256, finalLeaseEpoch: settlementOwned.lease.leaseEpoch,
    operationDeadlineAt: settlementOwned.lease.operationDeadlineAt,
    terminalEvidenceSha256: terminalEvidence.sha256,
    authorityRevalidatedAt: settlementTime, deadlineRevalidatedAt: settlementTime, settledAt: settlementTime,
    capability: "recovery_only", result: "failed", orchestrationReceiptSha256: orchestrationRecord.sha256,
    recoveryAttemptedExternalEffect: false,
    priorAttemptedExternalEffect: recoveryContext!.priorAttemptedExternalEffect
  } : {
    version: "production-operation-settlement-v2", operationKind: input.operationKind,
    operationId: settlementOwned.lease.operationId, candidateSha: settlementOwned.lease.candidateSha,
    releaseGenerationId: settlementOwned.lease.releaseGenerationId,
    sourceManifestSha256: settlementOwned.lease.sourceManifestSha256,
    claimSha256: settlementOwned.claimSha256,
    authorityConsumptionSha256: settlementOwned.claim.authorityConsumptionSha256,
    finalLeaseSha256: settlementOwned.leaseSha256, finalLeaseEpoch: settlementOwned.lease.leaseEpoch,
    operationDeadlineAt: settlementOwned.lease.operationDeadlineAt,
    terminalEvidenceSha256: terminalEvidence.sha256,
    authorityRevalidatedAt: settlementTime, deadlineRevalidatedAt: settlementTime, settledAt: settlementTime,
    capability: "effect_capable", result: "passed", orchestrationReceiptSha256: orchestrationRecord.sha256,
    attemptedExternalEffect: attemptedExternalEffect || input.operationKind === "canary"
  });
  const settlementRecord = store.persistSettlement(settlement);
  successSettlementPersisted = true;
  injectedOperationFault(input.faultAt, "after_settlement");
  store.publishTerminalArtifacts?.(begun.lease.operationId);
  injectedOperationFault(input.faultAt, "after_terminal_publication");
  store.completeTerminal({ operationId: begun.lease.operationId, terminalStateKind: "settlement",
    terminalStateSha256: settlementRecord.sha256, evaluatedAt: settlementTime,
    faultAt: input.faultAt });
  return { operationId: begun.lease.operationId, leaseEpoch: settlementOwned.lease.leaseEpoch,
    receiptSha256: orchestrationRecord.sha256, completedSteps: [...stepIds] };
  } catch (error) {
    let activeStepDurablyCompleted = false;
    if (activeStepSequence > 0 && store.loadCompletedStepPrefix) {
      try {
        const prefix = store.loadCompletedStepPrefix(begun.lease.operationId, adapters.now());
        activeStepDurablyCompleted = prefix.some((record) =>
          record.receipt.sequence === activeStepSequence && record.receipt.stepId === activeStepId);
      } catch {
        // A corrupt or racing prefix is not authority to synthesize a failure settlement.
        activeStepDurablyCompleted = true;
      }
    }
    if (activeEffectIntent !== null) {
      try {
        unresolvedEffectIntent = store.hasUnresolvedStepIntent(activeEffectIntent);
      } catch {
        // An unreadable intent/receipt boundary is itself uncertain and cannot authorize failure settlement.
        unresolvedEffectIntent = true;
      }
    }
    if ((input.operationKind === "rollout" || input.operationKind === "canary")
        && !successSettlementPersisted && !unresolvedEffectIntent && !activeStepDurablyCompleted) {
      try {
        settleProtectedFailure({ operationKind: input.operationKind, stepId: activeStepId, error,
          store, adapters, begun, releaseFreezeIdentitySha256: releaseContext.releaseFreezeIdentitySha256,
          completedStepReceipts, captures, attemptedExternalEffect, faultAt: input.faultAt });
      } catch (settlementError) {
        throw new AggregateError([error, settlementError], "production_operation_failure_settlement_failed");
      }
    }
    throw error;
  }
}

function ensureOwnedAndFresh(bundle: any, now: string): void {
  if (Date.parse(now) >= Date.parse(bundle.authority.expiresAt)) throw new Error("production_authority_expired");
  if (Date.parse(now) >= Date.parse(bundle.operation.operationDeadlineAt)) throw new Error("production_operation_deadline_reached");
  if (bundle.operation.ownerId === "" || Number(bundle.operation.leaseEpoch) < 1) {
    throw new Error("production_operation_ownership_invalid");
  }
}

function stepsFor(bundle: any): readonly string[] {
  if (bundle.scenario.startsWith("recovery_") || bundle.operation.kind === "recovery") return RECOVERY_STEPS;
  if (bundle.operation.kind === "canary") return CANARY_STEPS;
  if (bundle.operation.kind === "rollback") return ROLLBACK_STEPS;
  return ROLLOUT_STEPS;
}

export async function executeProductionOperationV2(
  value: unknown,
  dependencies: ProductionDependenciesV2
): Promise<{ operationId: string; leaseEpoch: number; receiptSha256: string; completedSteps: readonly string[] }> {
  const bundle: any = validateProductionReleaseEvidenceBundleV2(value);
  const now = dependencies.now?.() ?? bundle.evaluatedAt;
  ensureOwnedAndFresh(bundle, now);
  const cleanupOnly = bundle.scenario.includes("cleanup_only") || bundle.operation.capability === "cleanup_only";
  const recoveryNoReplay = bundle.scenario === "recovery_no_replay";
  const leaseEpoch = bundle.takeover?.ownerDead === true && bundle.takeover?.boundsValid === true
    ? Number(bundle.takeover.newEpoch) : Number(bundle.operation.leaseEpoch);
  await dependencies.persist("production_operation_lease", { operationId: bundle.operation.operationId, leaseEpoch });
  await dependencies.persist("production_authority_preclaim", { operationId: bundle.operation.operationId,
    authority: hash(bundle.authority), originalLeaseEpoch: bundle.operation.leaseEpoch });
  if (bundle.takeover !== undefined) await dependencies.persist("production_operation_lease_takeover", bundle.takeover);
  if (cleanupOnly) {
    await dependencies.persist("production_operation_terminal_abandoned", { operationId: bundle.operation.operationId });
    await dependencies.persist("production_operation_cleanup", { operationId: bundle.operation.operationId });
    return { operationId: bundle.operation.operationId, leaseEpoch,
      receiptSha256: hash([bundle.operation.operationId, "cleanup_only"]), completedSteps: [] };
  }
  await dependencies.persist("production_operation_claim", { operationId: bundle.operation.operationId,
    authorityConsumption: hash([bundle.authority, leaseEpoch]) });
  const completed: string[] = [];
  for (const [index, step] of stepsFor(bundle).entries()) {
    ensureOwnedAndFresh(bundle, dependencies.now?.() ?? now);
    const sequence = index + 1;
    if (recoveryNoReplay && (EFFECT_STEPS.has(step) || OBSERVATION_STEPS.has(step))) {
      throw new Error("production_recovery_external_action_forbidden");
    }
    if (EFFECT_STEPS.has(step)) {
      await dependencies.persist("production_orchestration_step_intent", { sequence, step, attempt: 1 });
      const result = await dependencies.effect(step, { operationId: bundle.operation.operationId, sequence });
      if (result.exitCode !== 0) throw new Error(`production_effect_failed:${step}`);
    } else if (OBSERVATION_STEPS.has(step)) {
      const result = await dependencies.observe(step, { operationId: bundle.operation.operationId, sequence });
      if (!result.ok) throw new Error(`production_observation_failed:${step}`);
    }
    await dependencies.persist("production_orchestration_step_receipt", { sequence, step, result: "completed" });
    completed.push(step);
  }
  const receiptSha256 = hash([bundle.operation.operationId, completed]);
  await dependencies.persist("production_orchestration_receipt", { operationId: bundle.operation.operationId,
    receiptSha256, completedSteps: completed });
  await dependencies.persist("production_operation_settlement", { operationId: bundle.operation.operationId,
    result: bundle.scenario.includes("failure") ? "failed" : "passed" });
  await dependencies.persist("production_operation_lease_removal_prepared", { operationId: bundle.operation.operationId,
    leaseEpoch });
  await dependencies.persist("production_operation_lease_removal", { operationId: bundle.operation.operationId,
    leaseEpoch });
  await dependencies.persist("production_operation_cleanup", { operationId: bundle.operation.operationId });
  return { operationId: bundle.operation.operationId, leaseEpoch, receiptSha256, completedSteps: completed };
}
