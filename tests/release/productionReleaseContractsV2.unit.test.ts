import { expect, it } from "vitest";
import {
  canonicalReleaseJsonV2,
  releaseSha256V2,
  validateOperationalAttestationConsumptionV2,
  validateProductionOperationClaimV2,
  validateProductionOperationLeaseV2,
  validateProductionOrchestrationReceiptV2,
  validateProductionOrchestrationStepReceiptV2,
  validateProductionRecoveryInputV2,
  validatePreparedProductionOperationLeaseRemovalV2,
  validateProductionOrchestrationStepIntentV2,
  validatePreparedSchema032ProductionSettlementV2,
  validateSchema032ProductionExecutionAttemptV2,
  validateSchema032ProductionExecutionReceiptV2
} from "../../src/release/remediationReleaseManifestV2";

const S = "a".repeat(64);
const C = "b".repeat(40);
const T0 = "2026-07-18T10:00:00.000Z";
const T1 = "2026-07-18T10:10:00.000Z";
const bytes = (value: unknown) => Buffer.from(`${canonicalReleaseJsonV2(value)}\n`, "utf8");

const ROLLOUT_STEPS = ["verify_g13", "verify_schema", "verify_previous_runtime_identity",
  "verify_singleton_precondition", "stop_previous", "prove_previous_stopped", "start_candidate",
  "prove_candidate_started", "immediate_runtime_checks"] as const;

function rolloutStep(sequence: number, stepId: typeof ROLLOUT_STEPS[number]) {
  const external = stepId === "stop_previous" || stepId === "start_candidate";
  return {
    version: "production-orchestration-step-receipt-v2" as const,
    operationId: "rollout-operation-1", operationClaimSha256: S,
    authorityConsumptionSha256: S, operationLeaseSha256: S, operationLeaseEpoch: 1,
    operationDeadlineAt: T1, inputSha256: S, outputSha256: S, observedStateSha256: S,
    sequence, startedAt: T0, finishedAt: T0, recoveredAfterCrash: false, verifiedChecks: null,
    result: "completed" as const, capability: "effect_capable" as const,
    commandId: "production_rollout" as const, redactedTemplateSha256: S,
    executionKind: external ? "external_effect" as const : "local_validation" as const,
    stepIntentRelativePath: external
      ? `production-operation-step-intents/rollout-operation-1/${sequence}-${stepId}-1-v2.json`
      : null,
    stepIntentSha256: external ? S : null,
    orchestration: "rollout" as const, stepId
  };
}

function rolloutReceipt() {
  return {
    version: "production-orchestration-receipt-v2" as const,
    candidateSha: C, releaseGenerationId: "release-generation-0123456789abcdef",
    sourceManifestSha256: S, operationId: "rollout-operation-1", operationClaimSha256: S,
    finalOperationLeaseSha256: S, finalOperationLeaseEpoch: 1, operationDeadlineAt: T1,
    operationLeaseTakeoverChainSha256: S, operationalAttestationConsumptionSha256: S,
    redactedTemplateSha256: S, result: "completed" as const, orchestration: "rollout" as const,
    capability: "effect_capable" as const, commandId: "production_rollout" as const,
    recoveryInputSha256: null,
    completedStepReceipts: ROLLOUT_STEPS.map((stepId, index) => {
      const receipt = rolloutStep(index + 1, stepId);
      return { relativePath: `production-operation-steps/rollout-operation-1/${index + 1}-${stepId}-v2.json`,
        sha256: releaseSha256V2(bytes(receipt)), receipt };
    })
  };
}

function consumption() {
  return {
    version: "operational-attestation-consumption-v2" as const,
    operationKind: "rollout" as const,
    operationId: "rollout-operation-1",
    candidateSha: C,
    releaseGenerationId: "release-generation-0123456789abcdef",
    sourceManifestSha256: S,
    artifactRootFingerprintSha256: S,
    operationalAttestationSha256: S,
    operationalAttestationIssuerReceiptSha256: S,
    recoveryFromAbandonedOperationSha256: null,
    preclaimValidationSha256: S,
    preclaimLeaseLineageRelativePath: `production-preclaim-lease-lineages/rollout-operation-1/${S}.json`,
    preclaimLeaseLineageSha256: S,
    preclaimLeaseLineageCurrentTipSha256: S,
    commandId: "production_rollout" as const,
    redactedTemplateSha256: S,
    leaseSha256AtConsumption: S,
    leaseEpochAtConsumption: 1,
    consumedAt: T0,
    expiresAt: T1,
    operationDeadlineAt: T1
  };
}

it("validates exact consumption and claim keys and embedded consumption binding", () => {
  const consumed = consumption();
  expect(validateOperationalAttestationConsumptionV2(consumed)).toEqual(consumed);
  expect(() => validateOperationalAttestationConsumptionV2({ ...consumed, extra: true }))
    .toThrow(/keys/i);
  const claim = {
    version: "production-operation-claim-v2" as const,
    operationKind: consumed.operationKind,
    operationId: consumed.operationId,
    candidateSha: consumed.candidateSha,
    releaseGenerationId: consumed.releaseGenerationId,
    sourceManifestSha256: consumed.sourceManifestSha256,
    artifactRootFingerprintSha256: consumed.artifactRootFingerprintSha256,
    operationalAttestationSha256: consumed.operationalAttestationSha256,
    operationalAttestationIssuerReceiptSha256: consumed.operationalAttestationIssuerReceiptSha256,
    recoveryFromAbandonedOperationSha256: null,
    authorityConsumption: consumed,
    authorityConsumptionSha256: releaseSha256V2(bytes(consumed)),
    preclaimLeaseLineageRelativePath: consumed.preclaimLeaseLineageRelativePath,
    preclaimLeaseLineageSha256: consumed.preclaimLeaseLineageSha256,
    preclaimLeaseLineageCurrentTipSha256: consumed.preclaimLeaseLineageCurrentTipSha256,
    capability: "effect_capable" as const,
    leaseEpochAtConsumption: 1,
    operationDeadlineAt: T1,
    claimedAt: T0,
    claimantPid: 123,
    claimantProcessStartFingerprintSha256: S
  };
  expect(validateProductionOperationClaimV2(claim)).toEqual(claim);
  expect(() => validateProductionOperationClaimV2({ ...claim, operationId: "swapped" }))
    .toThrow(/binding/i);
  expect(() => validateOperationalAttestationConsumptionV2({
    ...consumed, leaseSha256AtConsumption: "c".repeat(64)
  })).toThrow(/lineage|binding/i);
  expect(() => validateProductionOperationClaimV2({ ...claim, claimedAt: T1 }))
    .toThrow(/time|binding/i);
});

it("allows cleanup-only recovery lease without granting recovery-only effects", () => {
  const lease = {
    version: "production-operation-lease-v2" as const,
    scope: "artifact_root_production_operation" as const,
    relativePath: "production-operation-root.lease.json" as const,
    operationKind: "recovery" as const, operationId: "recovery-operation-1",
    candidateSha: C, releaseGenerationId: "release-generation-0123456789abcdef",
    sourceManifestSha256: S, artifactRootFingerprintSha256: S,
    operationalAttestationSha256: S, recoveryFromAbandonedOperationSha256: S,
    capability: "cleanup_only" as const, leaseEpoch: 2, ownerPid: 123,
    ownerProcessStartFingerprintSha256: S, acquiredAt: T0, heartbeatAt: T0,
    expiresAt: T1, operationDeadlineAt: T1
  };
  expect(validateProductionOperationLeaseV2(lease)).toEqual(lease);
});

it("validates exact step-intent path and rejects a mismatched path", () => {
  const intent = {
    version: "production-orchestration-step-intent-v2" as const,
    capability: "effect_capable" as const,
    orchestration: "rollout" as const,
    operationId: "rollout-operation-1",
    operationClaimSha256: S,
    authorityConsumptionSha256: S,
    sequence: 5,
    stepId: "stop_previous" as const,
    attempt: 1 as const,
    relativePath: "production-operation-step-intents/rollout-operation-1/5-stop_previous-1-v2.json",
    currentOperationLeaseSha256: S,
    currentOperationLeaseEpoch: 1,
    commandId: "production_rollout" as const,
    redactedTemplateSha256: S,
    inputSha256: S,
    intendedExternalEffectSha256: S,
    preparedAt: T0
  };
  expect(validateProductionOrchestrationStepIntentV2(intent)).toEqual(intent);
  expect(() => validateProductionOrchestrationStepIntentV2({ ...intent, relativePath: "wrong.json" }))
    .toThrow(/path|binding/i);
});

it("rejects arbitrary receipt intent paths and incomplete orchestration sequences", () => {
  const external = rolloutStep(5, "stop_previous");
  expect(validateProductionOrchestrationStepReceiptV2(external)).toEqual(external);
  expect(() => validateProductionOrchestrationStepReceiptV2({
    ...external, stepIntentRelativePath: "safe-but-wrong.json"
  })).toThrow(/intent.*path|binding/i);

  const complete = rolloutReceipt();
  expect(validateProductionOrchestrationReceiptV2(complete)).toEqual(complete);
  expect(() => validateProductionOrchestrationReceiptV2({
    ...complete, completedStepReceipts: complete.completedStepReceipts.slice(0, -1)
  })).toThrow(/sequence.*incomplete/i);
  expect(() => validateProductionOrchestrationReceiptV2({
    ...complete,
    completedStepReceipts: complete.completedStepReceipts.map((entry, index) => index === 1
      ? { ...entry, receipt: { ...entry.receipt, sequence: 3 } } : entry)
  })).toThrow(/binding/i);
});

it("requires a contiguous recovery prefix and exact next uncertain intent", () => {
  const prefix = ROLLOUT_STEPS.slice(0, 4).map((stepId, index) => ({
    sequence: index + 1, stepId, receiptSha256: S
  }));
  const marker = {
    sequence: 5, stepId: "stop_previous" as const, attempt: 1 as const,
    stepIntentRelativePath: "production-operation-step-intents/rollout-operation-1/5-stop_previous-1-v2.json",
    stepIntentSha256: S, externalEffectMayHaveStarted: true as const, observedOutcome: "unknown" as const
  };
  const recovery = {
    version: "production-recovery-input-v2" as const, priorOperationKind: "rollout" as const,
    priorOperationId: "rollout-operation-1", priorTerminalAbandonedSha256: S,
    priorTerminalCleanupSha256: S, completedStepReceiptPrefix: prefix,
    completedStepReceiptPrefixSha256: releaseSha256V2(bytes(prefix)), uncertainStepMarker: marker,
    uncertainStepMarkerSha256: releaseSha256V2(bytes(marker)), recoveryOperationalAttestationSha256: S,
    recoveryProductionLeaseSha256: S, recoveryAuthorityPreclaimSha256: S,
    recoveryOperationClaimSha256: S, recoveryAuthorityConsumptionSha256: S, verifiedAt: T0
  };
  expect(validateProductionRecoveryInputV2(recovery)).toEqual(recovery);
  const gapped = [{ ...prefix[0]!, sequence: 2 }, ...prefix.slice(1)];
  expect(() => validateProductionRecoveryInputV2({
    ...recovery, completedStepReceiptPrefix: gapped,
    completedStepReceiptPrefixSha256: releaseSha256V2(bytes(gapped))
  })).toThrow(/prefix.*order/i);
  const wrongMarker = { ...marker,
    stepIntentRelativePath: "production-operation-step-intents/rollout-operation-1/6-stop_previous-1-v2.json" };
  expect(() => validateProductionRecoveryInputV2({
    ...recovery, uncertainStepMarker: wrongMarker,
    uncertainStepMarkerSha256: releaseSha256V2(bytes(wrongMarker))
  })).toThrow(/uncertain.*binding/i);
});

it("validates byte-exact lease-removal prepare and schema-032 ordered receipt", () => {
  const removal = {
    version: "production-operation-lease-removal-receipt-v2" as const,
    operationKind: "rollout" as const,
    operationId: "rollout-operation-1",
    terminalStateKind: "settlement" as const,
    terminalStateSha256: S,
    capability: "effect_capable" as const,
    removedLeaseSha256: S,
    removedLeaseEpoch: 2,
    removedAt: T0
  };
  const removalBytes = bytes(removal);
  const prepared = {
    version: "prepared-production-operation-lease-removal-v2" as const,
    operationKind: removal.operationKind,
    operationId: removal.operationId,
    terminalStateKind: removal.terminalStateKind,
    terminalStateSha256: removal.terminalStateSha256,
    capability: removal.capability,
    exactCurrentLeaseSha256: removal.removedLeaseSha256,
    exactCurrentLeaseEpoch: removal.removedLeaseEpoch,
    canonicalRemovalReceipt: removal,
    canonicalRemovalReceiptUtf8Base64: removalBytes.toString("base64"),
    canonicalRemovalReceiptSha256: releaseSha256V2(removalBytes),
    preparedAt: removal.removedAt
  };
  expect(validatePreparedProductionOperationLeaseRemovalV2(prepared)).toEqual(prepared);
  expect(() => validatePreparedProductionOperationLeaseRemovalV2({
    ...prepared, exactCurrentLeaseEpoch: 3
  })).toThrow(/binding/i);

  const completedStages = ["first_migration", "first_verification", "second_migration", "final_verification"]
    .map((step) => ({ step, receiptSha256: S }));
  const schema = {
    version: "schema-032-production-execution-receipt-v2" as const,
    candidateSha: C,
    releaseFreezeIdentitySha256: S,
    operationalAttestationSha256: S,
    authorityConsumptionSha256: S,
    sourceManifestSha256: S,
    g12TransitionReceiptSha256: S,
    productionBackupEvidenceSha256: S,
    executionAttemptRelativePath: `schema032-production-attempt-schema-migration-generation-0001-${S}.json`,
    executionAttemptSha256: S,
    advisoryLockKey: 320032500 as const,
    databaseSessionIdentitySha256: S,
    lockAcquiredAt: T0,
    lockReleasedAt: T1,
    preparedSettlementRelativePath: `schema032-production-settlement-prepared-${S}.json`,
    preparedSettlementSha256: S,
    migrationBytesChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
    result: "applied_and_verified" as const,
    completedStages,
    receiptChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
    postconditionsSha256: S
  };
  expect(validateSchema032ProductionExecutionReceiptV2(schema)).toEqual(schema);
  expect(() => validateSchema032ProductionExecutionReceiptV2({
    ...schema, completedStages: [...completedStages].reverse()
  })).toThrow(/stage|order/i);
  const { lockReleasedAt: _released, preparedSettlementRelativePath: _preparedPath,
    preparedSettlementSha256: _preparedSha, ...executionReceiptCore } = schema;
  expect(validatePreparedSchema032ProductionSettlementV2({
    version: "prepared-schema-032-production-settlement-v2",
    preparedAt: T1,
    executionReceiptCore
  }).executionReceiptCore).toEqual(executionReceiptCore);
  const attempt = {
    version: "schema-032-production-execution-attempt-v2" as const,
    generationId: "schema-migration-generation-0001",
    candidateSha: C,
    authorityConsumptionSha256: S,
    attemptOrdinal: 2,
    previousAttemptSha256: S,
    advisoryLockKey: 320032500 as const,
    databaseSessionIdentitySha256: S,
    lockAcquiredAt: T0
  };
  expect(validateSchema032ProductionExecutionAttemptV2(attempt)).toEqual(attempt);
  expect(() => validateSchema032ProductionExecutionAttemptV2({ ...attempt, attemptOrdinal: 0 })).toThrow(/attempt/i);
});
