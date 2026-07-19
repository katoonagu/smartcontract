import { describe, expect, it } from "vitest";
import { canonicalBytesV2 } from "../../src/release/releaseRootWriterStore";
import { releaseSha256V2 } from "../../src/release/remediationReleaseManifestV2";
import {
  classifyRuntimeRollbackTopologyV2,
  createRuntimeRollbackTopologyEvidenceV2,
  resolveRuntimeEffectReconciliationV2,
  runtimeCandidateFromReconciledStartV2,
  validateRuntimeEffectReconciliationEvidenceV2,
  validateRuntimeTopologySnapshotV2,
  validateRuntimeRollbackTopologyEvidenceV2,
  type RuntimeTopologyCandidateV2
} from "../../src/release/runtimeEffectReconciliationV2";
import { assertFrozenPreviousRuntimeSingletonV2, assertRollbackTopologyEvidenceAgainstCurrentAuthorityV2,
  assertTask0BPreviousIdentityFreezeBindingV2 } from
  "../../src/release/productionOperationAdaptersV2";

const SHA40 = "a".repeat(40);
const SHA256 = "b".repeat(64);
const OBSERVED_AT = "2026-07-19T00:00:05.000Z";

function candidate(overrides: Partial<RuntimeTopologyCandidateV2> = {}): RuntimeTopologyCandidateV2 {
  return {
    processId: 4242,
    processStartedAt: "2026-07-19T00:00:01.000Z",
    runtimeSha: SHA40,
    runtimeLabel: `master-${SHA40.slice(0, 8)}`,
    commandLineSha256: "1".repeat(64),
    executablePathSha256: "2".repeat(64),
    worktreePathFingerprintSha256: "3".repeat(64),
    entrypointPathFingerprintSha256: "4".repeat(64),
    ...overrides
  };
}

function topology(candidates: readonly RuntimeTopologyCandidateV2[]) {
  return validateRuntimeTopologySnapshotV2({
    version: "runtime-topology-snapshot-v2",
    observedAt: OBSERVED_AT,
    candidates
  });
}

function reconciliationInput(stepId: "stop_previous" | "start_candidate" | "stop_candidate" | "start_previous"
  | "restart_previous") {
  const isStart = stepId === "start_candidate" || stepId === "start_previous" || stepId === "restart_previous";
  const operationId = `production-${stepId === "stop_previous" || stepId === "start_candidate" ? "rollout" : "rollback"}-${"5".repeat(64)}`;
  return {
    operationKind: stepId === "stop_previous" || stepId === "start_candidate" ? "rollout" as const : "rollback" as const,
    operationId,
    operationClaimSha256: "6".repeat(64),
    authorityConsumptionSha256: "7".repeat(64),
    sequence: 5,
    stepId,
    intentRelativePath: `production-operation-step-intents/${operationId}/5-${stepId}-1-v2.json`,
    intentSha256: "8".repeat(64),
    intendedExternalEffectSha256: "9".repeat(64),
    currentOperationLeaseSha256: "a".repeat(64),
    currentOperationLeaseEpoch: 3,
    authorityExpiresAt: "2026-07-19T00:10:00.000Z",
    operationDeadlineAt: "2026-07-19T00:20:00.000Z",
    observedAt: OBSERVED_AT,
    desiredState: isStart ? "target_singleton" as const : "target_absent" as const,
    effectNotBefore: "2026-07-19T00:00:01.000Z",
    target: {
      runtimeSha: SHA40,
      runtimeLabel: `master-${SHA40.slice(0, 8)}`,
      worktreePathFingerprintSha256: "3".repeat(64),
      entrypointPathFingerprintSha256: "4".repeat(64),
      exactProcessId: null,
      exactProcessStartedAt: null
    }
  };
}

function expectedBinding(input: ReturnType<typeof reconciliationInput>, topologySnapshotSha256: string) {
  return {
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
    topologySnapshotSha256,
    targetIdentitySha256: releaseSha256V2(canonicalBytesV2(input.target)),
    effectNotBefore: input.effectNotBefore,
    observedPostState: input.desiredState,
    observedAt: input.observedAt
  };
}

describe("runtime effect crash reconciliation", () => {
  it("classifies only exact none, previous singleton or candidate singleton rollback topology", () => {
    const previous = { ...reconciliationInput("start_previous").target,
      runtimeSha: "c".repeat(40), runtimeLabel: `master-${"c".repeat(8)}`,
      worktreePathFingerprintSha256: "d".repeat(64),
      entrypointPathFingerprintSha256: "e".repeat(64) };
    const next = reconciliationInput("start_candidate").target;
    const previousCandidate = candidate({ runtimeSha: previous.runtimeSha, runtimeLabel: previous.runtimeLabel,
      processId: 4243,
      worktreePathFingerprintSha256: previous.worktreePathFingerprintSha256,
      entrypointPathFingerprintSha256: previous.entrypointPathFingerprintSha256 });
    expect(classifyRuntimeRollbackTopologyV2(topology([]), previous, next)).toBe("none");
    expect(classifyRuntimeRollbackTopologyV2(topology([previousCandidate]), previous, next))
      .toBe("previous_singleton");
    expect(classifyRuntimeRollbackTopologyV2(topology([candidate()]), previous, next))
      .toBe("candidate_singleton");
    expect(classifyRuntimeRollbackTopologyV2(topology([candidate(), previousCandidate]), previous, next)).toBeNull();
    expect(classifyRuntimeRollbackTopologyV2(topology([candidate({ runtimeSha: "f".repeat(40) })]),
      previous, next)).toBeNull();
  });

  it("accepts retained previous runtime only with the complete frozen process identity", () => {
    const exact = candidate();
    const frozen = {
      processId: exact.processId, processStartedAt: exact.processStartedAt,
      runtimeSha: exact.runtimeSha, runtimeLabel: exact.runtimeLabel,
      commandLineSha256: exact.commandLineSha256, executablePathSha256: exact.executablePathSha256,
      workingDirectoryFingerprintSha256: exact.worktreePathFingerprintSha256,
      entrypointPathFingerprintSha256: exact.entrypointPathFingerprintSha256
    };
    expect(() => assertFrozenPreviousRuntimeSingletonV2(topology([exact]), frozen)).not.toThrow();
    expect(() => assertFrozenPreviousRuntimeSingletonV2(topology([
      { ...exact, processStartedAt: "2026-07-19T00:00:02.000Z" }
    ]), frozen)).toThrow(/retained.previous.identity/i);
    expect(() => assertFrozenPreviousRuntimeSingletonV2(topology([
      { ...exact, commandLineSha256: "9".repeat(64) }
    ]), frozen)).toThrow(/retained.previous.identity/i);
    expect(() => assertFrozenPreviousRuntimeSingletonV2(topology([
      { ...exact, executablePathSha256: "8".repeat(64) }
    ]), frozen)).toThrow(/retained.previous.identity/i);
  });

  it("rejects a replaced Task0B previous identity after the release freeze", () => {
    const frozen = { processId: 4242, processStartedAt: "2026-07-19T00:00:01.000Z" };
    const frozenSha256 = releaseSha256V2(canonicalBytesV2(frozen));
    expect(() => assertTask0BPreviousIdentityFreezeBindingV2(frozen, frozenSha256)).not.toThrow();
    expect(() => assertTask0BPreviousIdentityFreezeBindingV2({ ...frozen, processId: 4243 }, frozenSha256))
      .toThrow(/previous.identity.freeze.binding/i);
  });

  it("binds rollback topology evidence to the claimed operation, exact snapshot, identities and compatible window", () => {
    const previous = { ...reconciliationInput("start_previous").target,
      runtimeSha: "c".repeat(40), runtimeLabel: `master-${"c".repeat(8)}`,
      worktreePathFingerprintSha256: "d".repeat(64),
      entrypointPathFingerprintSha256: "e".repeat(64) };
    const next = reconciliationInput("start_candidate").target;
    const snapshot = topology([candidate()]);
    const window = { kind: "candidate_replaced_with_previous" as const,
      failedGateId: "G14_PRODUCTION_ROLLOUT" as const, candidateStartEvidenceSha256: "f".repeat(64) };
    const withoutBinding = {
      version: "runtime-rollback-topology-evidence-v2" as const,
      operationId: `production-rollback-${"1".repeat(64)}`,
      operationClaimSha256: "2".repeat(64), authorityConsumptionSha256: "3".repeat(64),
      operationLeaseSha256: "4".repeat(64), operationLeaseEpoch: 2,
      authorityExpiresAt: "2026-07-19T00:10:00.000Z",
      operationDeadlineAt: "2026-07-19T00:20:00.000Z",
      candidateSha: SHA40, releaseGenerationId: "generation-123456",
      sourceManifestSha256: "5".repeat(64), releaseFreezeIdentitySha256: "6".repeat(64),
      failureEvidenceSha256: "7".repeat(64), topology: snapshot,
      topologySnapshotSha256: releaseSha256V2(canonicalBytesV2(snapshot)),
      previousRuntimeIdentitySha256: "8".repeat(64),
      previousTarget: previous, previousTargetSha256: releaseSha256V2(canonicalBytesV2(previous)),
      candidateTarget: next, candidateTargetSha256: releaseSha256V2(canonicalBytesV2(next)),
      topologyState: "candidate_singleton" as const,
      selectedWindow: window, selectedWindowSha256: releaseSha256V2(canonicalBytesV2(window)),
      observedAt: OBSERVED_AT
    };
    const evidence = createRuntimeRollbackTopologyEvidenceV2(withoutBinding);
    expect(validateRuntimeRollbackTopologyEvidenceV2(evidence, {
      operationId: withoutBinding.operationId,
      operationClaimSha256: withoutBinding.operationClaimSha256,
      topologySnapshotSha256: withoutBinding.topologySnapshotSha256,
      selectedWindowSha256: withoutBinding.selectedWindowSha256
    })).toEqual(evidence);
    expect(() => validateRuntimeRollbackTopologyEvidenceV2(evidence, {
      operationId: `production-rollback-${"9".repeat(64)}`
    })).toThrow(/expected_binding/i);
    expect(() => createRuntimeRollbackTopologyEvidenceV2({ ...withoutBinding,
      topology: topology([]), topologyState: "candidate_singleton" })).toThrow(/topology_binding/i);
    expect(() => createRuntimeRollbackTopologyEvidenceV2({ ...withoutBinding,
      selectedWindow: { kind: "previous_runtime_retained", failedGateId: "G14_PRODUCTION_ROLLOUT" },
      selectedWindowSha256: releaseSha256V2(canonicalBytesV2({
        kind: "previous_runtime_retained", failedGateId: "G14_PRODUCTION_ROLLOUT" }))
    })).toThrow(/topology_binding/i);
    const current = {
      lease: { operationId: withoutBinding.operationId, candidateSha: withoutBinding.candidateSha,
        releaseGenerationId: withoutBinding.releaseGenerationId,
        sourceManifestSha256: withoutBinding.sourceManifestSha256,
        operationDeadlineAt: withoutBinding.operationDeadlineAt },
      leaseSha256: "9".repeat(64),
      claim: { authorityConsumptionSha256: withoutBinding.authorityConsumptionSha256,
        authorityConsumption: { expiresAt: withoutBinding.authorityExpiresAt } },
      claimSha256: withoutBinding.operationClaimSha256,
      lineageLeaseTips: [
        { sha256: withoutBinding.operationLeaseSha256, epoch: withoutBinding.operationLeaseEpoch },
        { sha256: "9".repeat(64), epoch: withoutBinding.operationLeaseEpoch + 1 }
      ]
    };
    expect(() => assertRollbackTopologyEvidenceAgainstCurrentAuthorityV2(evidence, current)).not.toThrow();
    expect(() => assertRollbackTopologyEvidenceAgainstCurrentAuthorityV2(evidence, {
      ...current, lineageLeaseTips: [{ sha256: "9".repeat(64), epoch: withoutBinding.operationLeaseEpoch + 1 }]
    })).toThrow(/lease_lineage/i);
    expect(() => assertRollbackTopologyEvidenceAgainstCurrentAuthorityV2(evidence, {
      ...current, claimSha256: "8".repeat(64)
    })).toThrow(/expected_binding/i);
  });
  for (const stepId of ["stop_previous", "start_candidate", "stop_candidate", "start_previous",
    "restart_previous"] as const) {
    it(`[PRODUCTION-EFFECT-CRASH-RECONCILE] confirms ${stepId} from one canonical topology snapshot`, () => {
      const input = reconciliationInput(stepId);
      const snapshot = topology(input.desiredState === "target_absent" ? [] : [candidate()]);
      const evidence = resolveRuntimeEffectReconciliationV2(input, snapshot);

      expect(evidence).not.toBeNull();
      expect(validateRuntimeEffectReconciliationEvidenceV2(evidence,
        expectedBinding(input, releaseSha256V2(canonicalBytesV2(snapshot))))).toMatchObject({
        operationId: input.operationId,
        operationClaimSha256: input.operationClaimSha256,
        authorityConsumptionSha256: input.authorityConsumptionSha256,
        stepId,
        intentSha256: input.intentSha256,
        currentOperationLeaseSha256: input.currentOperationLeaseSha256,
        currentOperationLeaseEpoch: 3,
        recoveredAfterCrash: true,
        observedPostState: input.desiredState,
        topologySnapshotSha256: releaseSha256V2(canonicalBytesV2(snapshot))
      });
    });
  }

  it("recovers the exact live runtime identity from operation-bound start reconciliation", () => {
    const input = reconciliationInput("start_candidate");
    const evidence = resolveRuntimeEffectReconciliationV2(input, topology([candidate()]))!;
    expect(runtimeCandidateFromReconciledStartV2(evidence, input.target)).toEqual(candidate());
    expect(() => runtimeCandidateFromReconciledStartV2(evidence,
      { ...input.target, runtimeSha: "f".repeat(40) })).toThrow(/target|identity/i);
  });

  it.each([
    ["desired start none", "start_candidate", []],
    ["desired stop target remains", "stop_previous", [candidate()]],
    ["multiple", "start_candidate", [candidate(), candidate({ processId: 4243 })]],
    ["foreign sha", "start_candidate", [candidate({ runtimeSha: "f".repeat(40) })]],
    ["wrong label", "start_candidate", [candidate({ runtimeLabel: "master-wrong" })]],
    ["wrong worktree", "start_candidate", [candidate({ worktreePathFingerprintSha256: "f".repeat(64) })]],
    ["wrong entrypoint", "start_candidate", [candidate({ entrypointPathFingerprintSha256: "e".repeat(64) })]],
    ["PID start predates intent", "start_candidate", [candidate({ processStartedAt: "2026-07-19T00:00:00.999Z" })]],
    ["foreign while stop", "stop_candidate", [candidate({ runtimeSha: "f".repeat(40) })]]
  ] as const)("[PRODUCTION-EFFECT-CRASH-AMBIGUOUS] %s remains uncertain", (_name, stepId, candidates) => {
    expect(resolveRuntimeEffectReconciliationV2(reconciliationInput(stepId as any), topology(candidates)))
      .toBeNull();
  });

  it("rejects malformed PID/start time and equality at either strict bound before accepting an observation", () => {
    expect(() => topology([candidate({ processId: 0 })])).toThrow(/topology.*candidate/i);
    expect(() => topology([candidate({ processStartedAt: "not-a-time" })])).toThrow(/topology.*candidate/i);
    expect(() => topology([candidate({ processStartedAt: "2026-07-19T00:00:05.001Z" })]))
      .toThrow(/topology.*candidate/i);
    const input = reconciliationInput("start_candidate");
    for (const observedAt of [input.authorityExpiresAt, input.operationDeadlineAt]) {
      expect(() => resolveRuntimeEffectReconciliationV2({ ...input, observedAt },
        { ...topology([candidate()]), observedAt })).toThrow(/reconciliation.*bound/i);
    }
  });

  it("rejects any evidence field, lease epoch or topology hash not bound to the active operation", () => {
    const input = reconciliationInput("start_candidate");
    const evidence = resolveRuntimeEffectReconciliationV2(input, topology([candidate()]))!;
    const expected = expectedBinding(input, evidence.topologySnapshotSha256);
    for (const mutation of [
      { operationClaimSha256: SHA256 },
      { authorityConsumptionSha256: SHA256 },
      { intendedExternalEffectSha256: SHA256 },
      { intentSha256: SHA256 },
      { currentOperationLeaseEpoch: 4 },
      { topologySnapshotSha256: SHA256 },
      { targetIdentitySha256: SHA256 },
      { observedAt: "2026-07-19T00:00:04.999Z" }
    ]) expect(() => validateRuntimeEffectReconciliationEvidenceV2({ ...evidence, ...mutation }, expected))
      .toThrow(/reconciliation.*binding|reconciliation.*invalid/i);
  });

  it.each([
    ["wrong operation id", { operationId: `production-rollout-${"c".repeat(64)}` }],
    ["wrong kind for step", { operationKind: "rollback" as const }],
    ["wrong desired state", { desiredState: "target_absent" as const }],
    ["wrong intent path", { intentRelativePath: "production-operation-step-intents/foreign/5-start_candidate-1-v2.json" }],
    ["malformed SHA", { operationClaimSha256: "not-a-sha" }]
  ])("rejects %s before accepting topology", (_name, mutation) => {
    const input = { ...reconciliationInput("start_candidate"), ...mutation };
    expect(() => resolveRuntimeEffectReconciliationV2(input as ReturnType<typeof reconciliationInput>,
      topology([candidate()]))).toThrow(/reconciliation.*scope|reconciliation.*input/i);
  });
});
