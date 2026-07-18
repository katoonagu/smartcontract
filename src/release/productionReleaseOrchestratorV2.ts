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
  type ProductionOrchestrationStepIntentV2,
  type ProductionOrchestrationStepReceiptV2,
  type ProductionRecoveryInputV2,
  type ProductionRollbackOutcomeV2
} from "./remediationReleaseManifestV2";
import { canonicalBytesV2 } from "./releaseRootWriterStore";
import {
  ProductionOperationStoreV2,
  type BegunProductionOperationV2,
  type ProductionOperationStoreRecordV2
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

export type ProtectedRollbackWindowV2 =
  | Readonly<{ kind: "previous_runtime_retained";
      failedGateId: "G13_PRODUCTION_MIGRATION" | "G14_PRODUCTION_ROLLOUT" }>
  | Readonly<{ kind: "previous_runtime_restarted_without_candidate";
      failedGateId: "G14_PRODUCTION_ROLLOUT"; previousStopEvidenceSha256: string }>
  | Readonly<{ kind: "candidate_replaced_with_previous";
      failedGateId: "G14_PRODUCTION_ROLLOUT" | "G15_PRODUCTION_CANARY";
      candidateStartEvidenceSha256: string }>;

export type ProtectedProductionOperationAdaptersV2 = Readonly<{
  now(): string;
  loadReleaseContext(artifactRoot: string): Promise<{ releaseFreezeIdentitySha256: string }>;
  validateStep(input: ProtectedProductionLeafInputV2): Promise<ProtectedProductionLeafResultV2>;
  prepareEffect(input: ProtectedProductionLeafInputV2): Promise<string>;
  executeEffect(input: ProtectedProductionLeafInputV2): Promise<ProtectedProductionLeafResultV2>;
  reconcileEffect(input: ProtectedProductionLeafInputV2 & {
    intent: ProductionOrchestrationStepIntentV2;
    intentSha256: string;
  }): Promise<ProtectedProductionLeafResultV2 | null>;
  resolveRollbackContext?(artifactRoot: string): Promise<{
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
  persistStepIntent(value: unknown): ProductionOperationStoreRecordV2;
  persistStepReceipt(value: unknown): ProductionOperationStoreRecordV2;
  persistExclusive(kind: string, relativePath: string, value: unknown): ProductionOperationStoreRecordV2;
  persistSettlement(value: unknown): ProductionOperationStoreRecordV2;
  completeTerminal(input: { operationId: string; terminalStateKind: "settlement";
    terminalStateSha256: string; evaluatedAt: string }): unknown;
}>;

type ProtectedExecutorDependenciesV2 = Readonly<{
  store?: ProtectedProductionOperationStoreV2;
  adapters: ProtectedProductionOperationAdaptersV2;
}>;

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

/**
 * The only effect-capable production entry point. Its caller supplies a protected root and
 * a closed operation kind; every command, query and capture is selected by fixed adapters.
 */
export async function executeProtectedProductionOperationV2(
  input: { artifactRoot: string; operationKind: ProductionOperationKindV2 },
  dependencies: ProtectedExecutorDependenciesV2
): Promise<{ operationId: string; leaseEpoch: number; receiptSha256: string; completedSteps: readonly string[] }> {
  const adapters = dependencies.adapters;
  const store = dependencies.store ?? new ProductionOperationStoreV2(input.artifactRoot);
  const releaseContext = await adapters.loadReleaseContext(input.artifactRoot);
  let recoveryContext: Awaited<ReturnType<NonNullable<typeof adapters.loadRecoveryContext>>> | null = null;
  let rollbackContext: Awaited<ReturnType<NonNullable<typeof adapters.resolveRollbackContext>>> | null = null;
  if (input.operationKind === "recovery") {
    if (!adapters.loadRecoveryContext) throw new Error("production_recovery_context_unavailable");
    recoveryContext = await adapters.loadRecoveryContext(input.artifactRoot);
  }
  if (input.operationKind === "rollback") {
    if (!adapters.resolveRollbackContext) throw new Error("production_rollback_context_unavailable");
    rollbackContext = await adapters.resolveRollbackContext(input.artifactRoot);
  }
  const beganAt = adapters.now();
  const begun = await store.beginOperation({
    operationKind: input.operationKind,
    evaluatedAt: beganAt,
    recoveryFromAbandonedOperationSha256: recoveryContext?.priorTerminalAbandonedSha256 ?? null
  });
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
    recoveryProductionLeaseSha256: begun.leaseSha256,
    recoveryAuthorityPreclaimSha256: begun.preclaimSha256,
    recoveryOperationClaimSha256: begun.claimSha256,
    recoveryAuthorityConsumptionSha256: begun.claim.authorityConsumptionSha256,
    verifiedAt: adapters.now()
  });
  const stepIds = input.operationKind === "rollback"
    ? rollbackSteps(rollbackContext!.window)
    : PROTECTED_STEPS[input.operationKind];
  const commandId = PROTECTED_COMMAND[input.operationKind];
  const captures: Array<{ stepId: string; sequence: number; executionKind: string;
    outputSha256: string; observedStateSha256: string }> = [];
  const completedStepReceipts: Array<{ relativePath: string; sha256: string;
    receipt: ProductionOrchestrationStepReceiptV2 }> = [];
  let attemptedExternalEffect = false;

  for (const [offset, stepId] of stepIds.entries()) {
    const sequence = offset + 1;
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
      const intendedExternalEffectSha256 = await adapters.prepareEffect(leafInput);
      if (!/^[0-9a-f]{64}$/u.test(intendedExternalEffectSha256)) {
        throw new Error("production_intended_effect_binding_invalid");
      }
      const relativePath = `production-operation-step-intents/${begun.lease.operationId}/${sequence}-${stepId}-1-v2.json`;
      const intent = validateProductionOrchestrationStepIntentV2({
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
      const persistedIntent = store.persistStepIntent(intent);
      intentPath = persistedIntent.relativePath;
      intentSha256 = persistedIntent.sha256;
      owned = store.assertOwnedAndWithinBounds(begun.lease.operationId, adapters.now());
      if (persistedIntent.created) {
        leaf = await adapters.executeEffect({ ...leafInput, intendedExternalEffectSha256 });
        attemptedExternalEffect = true;
      } else {
        const reconciled = await adapters.reconcileEffect({ ...leafInput, intendedExternalEffectSha256,
          intent, intentSha256 });
        if (reconciled === null) throw new Error(`production_effect_outcome_uncertain:${stepId}`);
        leaf = reconciled;
        attemptedExternalEffect = true;
        recoveredAfterCrash = true;
      }
    } else {
      leaf = await adapters.validateStep(leafInput);
    }
    exactLeafResult(leaf, inputSha256);
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
    completedStepReceipts.push({ relativePath: persisted.relativePath, sha256: persisted.sha256, receipt });
    captures.push({ stepId, sequence, executionKind, outputSha256: leaf.outputSha256,
      observedStateSha256: leaf.observedStateSha256 });
  }

  const completedAt = adapters.now();
  const final = store.assertOwnedAndWithinBounds(begun.lease.operationId, completedAt);
  const orchestrationReceipt = validateProductionOrchestrationReceiptV2({
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
  const orchestrationRecord = store.persistExclusive(`${input.operationKind}_orchestration`,
    PROTECTED_RECEIPT_PATH[input.operationKind], orchestrationReceipt);
  if (orchestrationRecord.sha256 !== protectedHash(orchestrationReceipt)) {
    throw new Error("production_orchestration_receipt_hash_invalid");
  }

  const capturesRecord = store.persistExclusive(`${input.operationKind}_captures`,
    input.operationKind === "rollout" ? "production-rollout-query-captures-v2.json"
      : input.operationKind === "canary" ? "production-canary-query-captures-v2.json"
        : input.operationKind === "rollback" ? "production-rollback-query-captures-v2.json"
          : "production-recovery-validation-captures-v2.json",
    { version: "production-orchestration-captures-v2", operationId: begun.lease.operationId, captures });
  let terminalEvidence: ProductionOperationStoreRecordV2;
  if (input.operationKind === "rollout") {
    const manager = store.persistExclusive("production_rollout_manager",
      "production-rollout-manager-captures-v2.json",
      { version: "production-manager-captures-v2", operationId: begun.lease.operationId,
        captures: captures.filter((item) => item.executionKind === "external_effect") });
    const evidence = validateProductionRolloutEvidenceV2({
      version: "production-rollout-evidence-v2", candidateSha: final.lease.candidateSha,
      releaseFreezeIdentitySha256: releaseContext.releaseFreezeIdentitySha256,
      operationalAttestationConsumptionSha256: final.claim.authorityConsumptionSha256,
      sourceManifestSha256: final.lease.sourceManifestSha256,
      previousStopEvidenceSha256: captures.find((item) => item.stepId === "stop_previous")!.outputSha256,
      candidateStartEvidenceSha256: captures.find((item) => item.stepId === "start_candidate")!.outputSha256,
      managerCapturesSha256: manager.sha256, queryCapturesSha256: capturesRecord.sha256,
      orchestrationReceiptSha256: orchestrationRecord.sha256,
      checks: { schema: true, version: true, admin: true, singleton: true, workers: true,
        logs: true, delivery: true, legacy: true }, result: "passed"
    });
    terminalEvidence = store.persistExclusive("production_rollout_evidence",
      "production-rollout-evidence-v2.json", evidence);
  } else if (input.operationKind === "canary") {
    const logs = store.persistExclusive("production_canary_logs", "production-canary-log-captures-v2.json",
      { version: "production-canary-log-captures-v2", operationId: begun.lease.operationId,
        captureSha256s: captures.map((item) => item.outputSha256) });
    const evidence = validateProductionCanaryEvidenceV2({
      version: "production-canary-evidence-v2", candidateSha: final.lease.candidateSha,
      releaseFreezeIdentitySha256: releaseContext.releaseFreezeIdentitySha256,
      operationalAttestationConsumptionSha256: final.claim.authorityConsumptionSha256,
      sourceManifestSha256: final.lease.sourceManifestSha256,
      observationStartedAt: beganAt, observationFinishedAt: completedAt, completedPollingCycles: 2,
      queryCapturesSha256: capturesRecord.sha256, logCapturesSha256: logs.sha256,
      orchestrationReceiptSha256: orchestrationRecord.sha256,
      checks: { schema: true, version: true, admin: true, singleton: true, reconciliation: true,
        delivery: true, navigation: true, allowance: true, legacy: true, secrets: true,
        queues: true, honest_limits: true }, result: "passed"
    });
    terminalEvidence = store.persistExclusive("production_canary_evidence",
      "production-canary-evidence-v2.json", evidence);
  } else if (input.operationKind === "rollback") {
    const manager = store.persistExclusive("production_rollback_manager",
      "production-rollback-manager-captures-v2.json",
      { version: "production-manager-captures-v2", operationId: begun.lease.operationId,
        captures: captures.filter((item) => item.executionKind === "external_effect") });
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
      checks: { schema032_retained: true, previous_version: true, admin: true, singleton: true,
        allowance: true, legacy: true, sent: true, no_duplicate_send: true }
    });
    void manager;
    terminalEvidence = store.persistExclusive("production_rollback_evidence",
      "production-rollback-evidence-v2.json", evidence);
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
      recoveryProductionLeaseSha256: final.leaseSha256,
      recoveryAuthorityPreclaimSha256: begun.preclaimSha256,
      recoveryOperationClaimSha256: final.claimSha256,
      recoveryAuthorityConsumptionSha256: final.claim.authorityConsumptionSha256,
      failureCode: recoveryContext!.failureCode
    });
    terminalEvidence = store.persistExclusive("production_failure_evidence",
      "production-failure-evidence-v2.json", evidence);
  }

  const settlementTime = adapters.now();
  const settlementOwned = store.assertOwnedAndWithinBounds(begun.lease.operationId, settlementTime);
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
  store.completeTerminal({ operationId: begun.lease.operationId, terminalStateKind: "settlement",
    terminalStateSha256: settlementRecord.sha256, evaluatedAt: settlementTime });
  return { operationId: begun.lease.operationId, leaseEpoch: settlementOwned.lease.leaseEpoch,
    receiptSha256: orchestrationRecord.sha256, completedSteps: [...stepIds] };
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
