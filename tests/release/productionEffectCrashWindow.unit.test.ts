import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canonicalBytesV2 } from "../../src/release/releaseRootWriterStore";
import { canonicalReleaseJsonV2, releaseSha256V2 } from "../../src/release/remediationReleaseManifestV2";
import {
  executeProtectedProductionOperationV2,
  type ProtectedProductionOperationAdaptersV2,
  type ProtectedProductionOperationStoreV2,
  type ProtectedRollbackWindowV2
} from "../../src/release/productionReleaseOrchestratorV2";
import {
  assertOwnedObservationContinuityV2,
  assertPriorRollbackManagerStopBindingV2,
  assertRollbackFailureTransitionLineageV2,
  assertRuntimeStartReceiptProofBindingV2,
  mergePriorAbandonedRollbackAttemptsV2,
  selectLatestPriorAbandonedRollbackRuntimeStartProofV2,
  selectRuntimeEffectRecoverySourceV2
} from "../../src/release/productionOperationAdaptersV2";
import {
  completeTask0BManagedRuntimeStart,
  completeTask0BManagedRuntimeStop
} from "../../scripts/manageTask0BRuntime";

const SHA40 = "a".repeat(40);
const SHA256 = "b".repeat(64);
const NOW = "2026-07-19T00:00:00.000Z";

const TERMINAL_CHECKS = Object.freeze({
  immediate_runtime_checks: ["schema", "version", "admin", "singleton", "workers", "logs", "delivery", "legacy"],
  rollback_runtime_checks: ["schema032_retained", "previous_version", "admin", "singleton", "allowance", "legacy",
    "sent", "no_duplicate_send"]
} as const);

type OperationKind = "rollout" | "rollback";
const ROLLOUT_STEP_IDS = ["verify_g13", "verify_schema", "verify_previous_runtime_identity",
  "verify_singleton_precondition", "stop_previous", "prove_previous_stopped", "start_candidate",
  "prove_candidate_started", "immediate_runtime_checks"] as const;

function operation(kind: OperationKind) {
  return {
    selectedAuthority: { commandId: `production_${kind}`, redactedTemplateSha256: "c".repeat(64) },
    selectedAuthoritySha256: "d".repeat(64),
    selectedAuthorityIssuerReceiptSha256: "e".repeat(64),
    lease: {
      operationKind: kind,
      operationId: `production-${kind}-${"f".repeat(64)}`,
      candidateSha: SHA40,
      releaseGenerationId: "generation-1",
      sourceManifestSha256: "1".repeat(64),
      artifactRootFingerprintSha256: "2".repeat(64),
      capability: "effect_capable",
      leaseEpoch: 1,
      operationDeadlineAt: "2026-07-19T00:35:00.000Z"
    },
    leaseSha256: "3".repeat(64),
    preclaim: {},
    preclaimSha256: "4".repeat(64),
    lineage: {},
    lineageSha256: "5".repeat(64),
    claim: { authorityConsumptionSha256: "6".repeat(64) },
    claimSha256: "7".repeat(64)
  } as any;
}

function crashHarness(input: {
  operationKind: OperationKind;
  crashStep: "stop_previous" | "start_candidate" | "stop_candidate" | "start_previous";
}) {
  const begun = operation(input.operationKind);
  const events: string[] = [];
  const persisted: Array<{ kind: string; value: unknown }> = [];
  const unresolvedIntents = new Set<string>();
  const rollbackWindow: ProtectedRollbackWindowV2 = {
    kind: "candidate_replaced_with_previous",
    failedGateId: "G14_PRODUCTION_ROLLOUT",
    candidateStartEvidenceSha256: "8".repeat(64)
  };
  const store: ProtectedProductionOperationStoreV2 = {
    async beginOperation() { events.push("begin"); return begun; },
    assertOwnedAndWithinBounds() {
      events.push("bound");
      return { lease: begun.lease, leaseSha256: begun.leaseSha256, claim: begun.claim,
        claimSha256: begun.claimSha256, takeoverChainSha256: "9".repeat(64) };
    },
    heartbeat() { return { lease: begun.lease, leaseSha256: begun.leaseSha256 }; },
    persistStepIntent(value: any) {
      events.push(`intent:${value.stepId}`);
      const key = `${value.operationId}:${value.sequence}:${value.stepId}`;
      const created = !unresolvedIntents.has(key) && !events.includes(`receipt:${value.stepId}`);
      unresolvedIntents.add(key);
      return { kind: "intent", relativePath: value.relativePath, sha256: "a".repeat(64), created };
    },
    persistStepReceipt(value: any) {
      events.push(`receipt:${value.stepId}`);
      unresolvedIntents.delete(`${value.operationId}:${value.sequence}:${value.stepId}`);
      return { kind: "receipt", relativePath: `steps/${value.sequence}.json`,
        sha256: releaseSha256V2(canonicalBytesV2(value)), created: true };
    },
    hasUnresolvedStepIntent(value) {
      return unresolvedIntents.has(`${value.operationId}:${value.sequence}:${value.stepId}`);
    },
    persistExclusive(kind, relativePath, value) {
      events.push(`persist:${kind}`);
      persisted.push({ kind, value });
      return { kind, relativePath, sha256: releaseSha256V2(canonicalBytesV2(value)), created: true };
    },
    persistSettlement(value) {
      events.push("settlement");
      persisted.push({ kind: "settlement", value });
      return { kind: "settlement", relativePath: "settlement.json", sha256: SHA256, created: true };
    },
    completeTerminal() { events.push("terminal"); return {} as any; }
  };
  const adapters: ProtectedProductionOperationAdaptersV2 = {
    now: vi.fn(() => NOW),
    async loadReleaseContext() { return { releaseFreezeIdentitySha256: "0".repeat(64) }; },
    async validateStep(leaf) {
      events.push(`validate:${leaf.stepId}`);
      return { inputSha256: leaf.inputSha256, outputSha256: "b".repeat(64),
        observedStateSha256: "c".repeat(64),
        verifiedChecks: TERMINAL_CHECKS[leaf.stepId as keyof typeof TERMINAL_CHECKS] };
    },
    async prepareEffect(leaf) { events.push(`prepare:${leaf.stepId}`); return "d".repeat(64); },
    async executeEffect(leaf) {
      events.push(`effect:${leaf.stepId}`);
      if (leaf.stepId === input.crashStep) throw new Error(`manager_crashed_after_mutation:${leaf.stepId}`);
      return { inputSha256: leaf.inputSha256, outputSha256: "e".repeat(64),
        observedStateSha256: "f".repeat(64) };
    },
    async reconcileEffect(leaf) { events.push(`reconcile:${leaf.stepId}`); return null; },
    async resolveRollbackContext() {
      return { window: rollbackWindow, failureEvidenceSha256: "1".repeat(64),
        previousRuntimeIdentitySha256: "2".repeat(64) };
    }
  };
  return { events, persisted, store, adapters };
}

function rolloutPrefix(length: number) {
  const begun = operation("rollout");
  return ROLLOUT_STEP_IDS.slice(0, length).map((stepId, offset) => {
    const sequence = offset + 1;
    const inputSha256 = releaseSha256V2(canonicalBytesV2({ version: "production-leaf-input-v2",
      operationId: begun.lease.operationId, operationKind: "rollout", sequence, stepId }));
    const external = stepId === "stop_previous" || stepId === "start_candidate";
    const relativePath = `production-operation-steps/${begun.lease.operationId}/${sequence}-${stepId}-v2.json`;
    const intentPath = external
      ? `production-operation-step-intents/${begun.lease.operationId}/${sequence}-${stepId}-1-v2.json` : null;
    const receipt = {
      version: "production-orchestration-step-receipt-v2" as const,
      operationId: begun.lease.operationId,
      operationClaimSha256: begun.claimSha256,
      authorityConsumptionSha256: begun.claim.authorityConsumptionSha256,
      operationLeaseSha256: begun.leaseSha256,
      operationLeaseEpoch: begun.lease.leaseEpoch,
      operationDeadlineAt: begun.lease.operationDeadlineAt,
      inputSha256, outputSha256: String(sequence).repeat(64).slice(0, 64),
      observedStateSha256: "a".repeat(64), sequence,
      startedAt: NOW, finishedAt: NOW, recoveredAfterCrash: false,
      verifiedChecks: stepId === "immediate_runtime_checks" ? [...TERMINAL_CHECKS.immediate_runtime_checks] : null,
      result: "completed" as const, capability: "effect_capable" as const,
      commandId: "production_rollout" as const,
      redactedTemplateSha256: begun.selectedAuthority.redactedTemplateSha256,
      executionKind: external ? "external_effect" as const : "local_validation" as const,
      stepIntentRelativePath: intentPath,
      stepIntentSha256: external ? "b".repeat(64) : null,
      orchestration: "rollout" as const, stepId
    };
    return { relativePath, sha256: releaseSha256V2(canonicalBytesV2(receipt)), receipt: receipt as any };
  });
}

describe("production effect crash windows", () => {
  it.each([[4, 2], [5, 1], [9, 0]] as const)(
    "[PRODUCTION-COMPLETED-PREFIX] hydrates %i exact receipts and executes only %i remaining effects",
    async (prefixLength, remainingEffects) => {
      const { events, store, adapters } = crashHarness({ operationKind: "rollout", crashStep: "start_candidate" });
      const prefix = rolloutPrefix(prefixLength);
      const effect = vi.fn(async (leaf: any) => ({ inputSha256: leaf.inputSha256,
        outputSha256: "e".repeat(64), observedStateSha256: "f".repeat(64) }));
      const validate = vi.fn(async (leaf: any) => ({ inputSha256: leaf.inputSha256,
        outputSha256: "b".repeat(64), observedStateSha256: "c".repeat(64),
        verifiedChecks: leaf.stepId === "immediate_runtime_checks"
          ? TERMINAL_CHECKS.immediate_runtime_checks : undefined }));
      const prefixStore = { ...store, loadCompletedStepPrefix: () => prefix };
      await expect(executeProtectedProductionOperationV2({
        artifactRoot: mkdtempSync(join(tmpdir(), "plan5-prefix-resume-")), operationKind: "rollout"
      }, { store: prefixStore, adapters: { ...adapters, validateStep: validate, executeEffect: effect } }))
        .resolves.toMatchObject({ completedSteps: [...ROLLOUT_STEP_IDS] });
      expect(effect).toHaveBeenCalledTimes(remainingEffects);
      expect(validate).toHaveBeenCalledTimes(ROLLOUT_STEP_IDS.length - prefixLength - remainingEffects);
      for (const record of prefix) expect(events).not.toContain(`effect:${record.receipt.stepId}`);
    }
  );
  it("resolves rollback topology only after a fresh operation claim and an in-bound ownership check", async () => {
    const begun = operation("rollback");
    const events: string[] = [];
    const store = {
      async beginOperation() { events.push("begin+claim"); return begun; },
      assertOwnedAndWithinBounds() { events.push("owned+in-bound"); return { lease: begun.lease,
        leaseSha256: begun.leaseSha256, claim: begun.claim, claimSha256: begun.claimSha256,
        takeoverChainSha256: SHA256 }; }
    } as any;
    const adapters = {
      now: () => NOW,
      async loadReleaseContext() { return { releaseFreezeIdentitySha256: SHA256 }; },
      async resolveRollbackContext(input: any) {
        events.push(`resolve:${input.operationId}`);
        throw new Error("stop_after_bound_topology_query");
      }
    } as any;
    await expect(executeProtectedProductionOperationV2({ artifactRoot: "C:/protected", operationKind: "rollback" },
      { store, adapters })).rejects.toThrow("stop_after_bound_topology_query");
    expect(events).toEqual(["begin+claim", "owned+in-bound", `resolve:${begun.lease.operationId}`]);
  });

  it.each(["claim unavailable", "strict bound equality"])("does not query rollback topology when %s", async (kind) => {
    const begun = operation("rollback");
    const resolver = vi.fn();
    const store = {
      async beginOperation() {
        if (kind === "claim unavailable") throw new Error("fresh_claim_unavailable");
        return begun;
      },
      assertOwnedAndWithinBounds() { throw new Error("production_operation_authority_bound_reached"); }
    } as any;
    const adapters = { now: () => NOW,
      async loadReleaseContext() { return { releaseFreezeIdentitySha256: SHA256 }; },
      resolveRollbackContext: resolver } as any;
    await expect(executeProtectedProductionOperationV2({ artifactRoot: "C:/protected", operationKind: "rollback" },
      { store, adapters })).rejects.toThrow(/claim_unavailable|bound_reached/);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("resumes rollback after candidate stop by starting only the previous runtime", async () => {
    const { events, store, adapters } = crashHarness({ operationKind: "rollback", crashStep: "start_previous" });
    const resumedAdapters = { ...adapters,
      async executeEffect(leaf: any) {
        events.push(`effect:${leaf.stepId}`);
        return { inputSha256: leaf.inputSha256, outputSha256: "e".repeat(64),
          observedStateSha256: "f".repeat(64) };
      },
      async resolveRollbackContext() {
      return { window: {
        kind: "candidate_already_stopped_previous_not_started",
        failedGateId: "G15_PRODUCTION_CANARY",
        candidateStartEvidenceSha256: "8".repeat(64),
        candidateStopEvidenceSha256: "9".repeat(64)
      } as any, failureEvidenceSha256: "1".repeat(64),
      previousRuntimeIdentitySha256: "2".repeat(64) };
    } };
    await executeProtectedProductionOperationV2({
      artifactRoot: mkdtempSync(join(tmpdir(), "plan5-rollback-stopped-candidate-")),
      operationKind: "rollback"
    }, { store, adapters: resumedAdapters });
    expect(events).not.toContain("effect:stop_candidate");
    expect(events).toContain("effect:start_previous");
  });

  it("combines consecutive abandoned rollback attempts for the same failure without mixing old releases", () => {
    const expected = { failureEvidenceSha256: "1".repeat(64), releaseFreezeIdentitySha256: "2".repeat(64),
      candidateSha: SHA40, releaseGenerationId: "generation-1", sourceManifestSha256: "3".repeat(64) };
    const binding = { ...expected };
    const unrelated = { ...binding, failureEvidenceSha256: "9".repeat(64) };
    const merged = mergePriorAbandonedRollbackAttemptsV2([
      { ...binding, operationId: `production-rollback-${"1".repeat(64)}`, abandonedAt: "2026-07-19T00:01:00.000Z",
        attemptedExternalEffect: true,
        stepIds: new Set(["verify_failure", "stop_candidate"]),
        completedStepIds: new Set(["verify_failure", "stop_candidate"]),
        proofSha256: (stepId: string) => stepId === "stop_candidate" ? "4".repeat(64) : null },
      { ...binding, operationId: `production-rollback-${"2".repeat(64)}`, abandonedAt: "2026-07-19T00:02:00.000Z",
        attemptedExternalEffect: true,
        stepIds: new Set(["verify_failure", "start_previous"]),
        completedStepIds: new Set(["verify_failure", "start_previous"]),
        proofSha256: (stepId: string) => stepId === "start_previous" ? "5".repeat(64) : null },
      { ...unrelated, operationId: `production-rollback-${"3".repeat(64)}`, abandonedAt: "2026-07-19T00:03:00.000Z",
        attemptedExternalEffect: false,
        stepIds: new Set(["restart_previous"]), completedStepIds: new Set(["restart_previous"]),
        proofSha256: () => "6".repeat(64) }
    ], expected);
    expect([...merged!.stepIds]).toEqual(["verify_failure", "stop_candidate", "start_previous"]);
    expect([...merged!.completedStepIds]).toEqual(["verify_failure", "stop_candidate", "start_previous"]);
    expect(merged!.proofSha256("stop_candidate")).toBe("4".repeat(64));
    expect(merged!.proofSha256("start_previous")).toBe("5".repeat(64));
  });

  it("ignores only an empty no-effect rollback abandoned before topology persistence", () => {
    const expected = { failureEvidenceSha256: "1".repeat(64), releaseFreezeIdentitySha256: "2".repeat(64),
      candidateSha: SHA40, releaseGenerationId: "generation-1", sourceManifestSha256: "3".repeat(64) };
    const topologyless = { ...expected, failureEvidenceSha256: null, releaseFreezeIdentitySha256: null,
      operationId: `production-rollback-${"4".repeat(64)}`, abandonedAt: "2026-07-19T00:00:00.000Z",
      attemptedExternalEffect: false, stepIds: new Set<string>(), completedStepIds: new Set<string>(),
      proofSha256: () => null };
    expect(mergePriorAbandonedRollbackAttemptsV2([topologyless], expected)).toBeNull();
    expect(() => mergePriorAbandonedRollbackAttemptsV2([
      { ...topologyless, stepIds: new Set(["verify_failure"]) }
    ], expected)).toThrow("production_prior_rollback_topology_missing_with_history");
  });

  it("does not promote an orphan start intent into completed abandoned rollback history", () => {
    const expected = { failureEvidenceSha256: "1".repeat(64), releaseFreezeIdentitySha256: "2".repeat(64),
      candidateSha: SHA40, releaseGenerationId: "generation-1", sourceManifestSha256: "3".repeat(64) };
    const orphan = { ...expected, operationId: `production-rollback-${"5".repeat(64)}`,
      abandonedAt: "2026-07-19T00:01:00.000Z", attemptedExternalEffect: true,
      stepIds: new Set(["verify_failure", "start_previous"]), completedStepIds: new Set(["verify_failure"]),
      proofSha256: () => null };
    const merged = mergePriorAbandonedRollbackAttemptsV2([orphan], expected)!;
    expect(merged.stepIds.has("start_previous")).toBe(true);
    expect(merged.completedStepIds.has("start_previous")).toBe(false);
    expect(merged.runtimeStartProof?.()).toBeNull();
  });

  it("uses the latest operation-bound previous-runtime start across abandoned rollback attempts", () => {
    const expected = { failureEvidenceSha256: "1".repeat(64), releaseFreezeIdentitySha256: "2".repeat(64),
      candidateSha: SHA40, releaseGenerationId: "generation-1", sourceManifestSha256: "3".repeat(64) };
    const runtimeProof = (processId: number, proofSha256: string) => ({
      candidate: { processId, processStartedAt: "2026-07-19T00:01:00.000Z", runtimeSha: SHA40,
        runtimeLabel: "previous", commandLineSha256: "4".repeat(64), executablePathSha256: "5".repeat(64),
        worktreePathFingerprintSha256: "6".repeat(64), entrypointPathFingerprintSha256: "7".repeat(64) },
      generationId: "generation-1", commandId: "runtime_manager_rollback_previous" as const,
      authoritySha256: "8".repeat(64), proofRelativePath: "runtime-start-evidence-generation-1.json",
      proofSha256
    });
    const attempts = [
      { ...expected, operationId: `production-rollback-${"1".repeat(64)}`,
        abandonedAt: "2026-07-19T00:01:00.000Z", attemptedExternalEffect: true,
        stepIds: new Set(["start_previous"]), completedStepIds: new Set(["start_previous"]),
        proofSha256: () => "9".repeat(64),
        runtimeStartProof: () => runtimeProof(101, "9".repeat(64)) },
      { ...expected, operationId: `production-rollback-${"2".repeat(64)}`,
        abandonedAt: "2026-07-19T00:02:00.000Z", attemptedExternalEffect: true,
        stepIds: new Set(["start_previous"]), completedStepIds: new Set(["start_previous"]),
        proofSha256: () => "a".repeat(64),
        runtimeStartProof: () => runtimeProof(202, "a".repeat(64)) },
      { ...expected, operationId: `production-rollback-${"3".repeat(64)}`,
        abandonedAt: "2026-07-19T00:03:00.000Z", attemptedExternalEffect: false,
        stepIds: new Set<string>(), completedStepIds: new Set<string>(), proofSha256: () => null }
    ];
    expect(selectLatestPriorAbandonedRollbackRuntimeStartProofV2(attempts, expected)?.candidate.processId).toBe(202);
    expect(mergePriorAbandonedRollbackAttemptsV2(attempts, expected)?.proofSha256("start_previous"))
      .toBe("a".repeat(64));
  });

  it("accepts an own heartbeat across topology observation but rejects a foreign owner", () => {
    const immutable = { operationId: `production-rollback-${"7".repeat(64)}`, candidateSha: SHA40,
      releaseGenerationId: "generation-1", sourceManifestSha256: "1".repeat(64),
      operationDeadlineAt: "2026-07-19T00:35:00.000Z", ownerPid: 101,
      ownerProcessStartFingerprintSha256: "2".repeat(64) };
    const before = { lease: { ...immutable, leaseEpoch: 1 }, leaseSha256: "3".repeat(64),
      claimSha256: "4".repeat(64), claim: { authorityConsumptionSha256: "5".repeat(64) },
      lineageLeaseTips: [{ sha256: "3".repeat(64), epoch: 1 }] };
    const heartbeat = { ...before, lease: { ...immutable, leaseEpoch: 2 }, leaseSha256: "6".repeat(64),
      lineageLeaseTips: [{ sha256: "3".repeat(64), epoch: 1 }, { sha256: "6".repeat(64), epoch: 2 }] };
    expect(() => assertOwnedObservationContinuityV2(before, heartbeat)).not.toThrow();
    expect(() => assertOwnedObservationContinuityV2(before, { ...heartbeat,
      lease: { ...heartbeat.lease, ownerPid: 202 } })).toThrow(/owner|continuity/i);
  });

  it("binds rollback authority to the committed production-failed transition lineage", () => {
    const failureSha256 = "1".repeat(64);
    const oldManifestSha256 = "2".repeat(64);
    const failedManifestSha256 = "3".repeat(64);
    const input = { rollbackSourceManifestSha256: failedManifestSha256,
      currentManifestSha256: failedManifestSha256, currentTransitionId: "production_failed",
      currentPreviousManifestSha256: oldManifestSha256, receiptTransitionId: "production_failed",
      receiptSourceManifestSha256: oldManifestSha256, failureEvidenceSha256: failureSha256,
      failureSourceManifestSha256: oldManifestSha256, transitionFailureEvidenceSha256: failureSha256,
      transitionFailureSourceManifestSha256: oldManifestSha256 } as const;
    expect(() => assertRollbackFailureTransitionLineageV2(input)).not.toThrow();
    expect(() => assertRollbackFailureTransitionLineageV2({ ...input,
      rollbackSourceManifestSha256: oldManifestSha256 })).toThrow(/lineage/i);
  });

  it("binds recovered runtime start proof bytes to the durable receipt output and observed state", () => {
    const proofSha256 = "8".repeat(64);
    const observedStateSha256 = createHash("sha256").update(Buffer.from(canonicalReleaseJsonV2({
      stepId: "start_candidate", outputSha256: proofSha256 }), "utf8")).digest("hex");
    expect(() => assertRuntimeStartReceiptProofBindingV2({ stepId: "start_candidate", outputSha256: proofSha256,
      observedStateSha256 }, proofSha256)).not.toThrow();
    expect(() => assertRuntimeStartReceiptProofBindingV2({ stepId: "start_candidate", outputSha256: proofSha256,
      observedStateSha256 }, "9".repeat(64))).toThrow(/receipt|proof|binding/i);
  });

  it("binds historical manager stop evidence to the exact candidate start identity and strict time window", () => {
    const startEvidencePath = `runtime-start-evidence-generation-1-runtime_manager_start_candidate-${"1".repeat(64)}.json`;
    const startProof = { candidate: { processId: 101, processStartedAt: "2026-07-19T00:00:01.000Z",
      runtimeSha: SHA40, runtimeLabel: "candidate", commandLineSha256: "2".repeat(64),
      executablePathSha256: "3".repeat(64), worktreePathFingerprintSha256: "4".repeat(64),
      entrypointPathFingerprintSha256: "5".repeat(64) }, generationId: "generation-1",
      commandId: "runtime_manager_start_candidate" as const, authoritySha256: "1".repeat(64),
      proofRelativePath: startEvidencePath, proofSha256: "6".repeat(64) };
    const authority = { startEvidencePath, startEvidenceSha256: startProof.proofSha256,
      forcePolicy: "graceful_only", issuedAt: "2026-07-19T00:01:00.000Z",
      expiresAt: "2026-07-19T00:05:00.000Z" } as any;
    const stopEvidence = { startEvidencePath, startEvidenceSha256: startProof.proofSha256,
      stoppedProcessId: 101, stoppedProcessStartedAt: startProof.candidate.processStartedAt,
      stoppedAt: "2026-07-19T00:02:00.000Z", forcePolicy: "graceful_only" } as any;
    const input = { startProof, authority, stopEvidence, exactStartEvidencePath: startEvidencePath,
      intentPreparedAt: "2026-07-19T00:00:30.000Z", receiptStartedAt: "2026-07-19T00:00:45.000Z",
      receiptFinishedAt: "2026-07-19T00:02:30.000Z", operationDeadlineAt: "2026-07-19T00:10:00.000Z" };
    expect(() => assertPriorRollbackManagerStopBindingV2(input)).not.toThrow();
    expect(() => assertPriorRollbackManagerStopBindingV2({ ...input,
      stopEvidence: { ...stopEvidence, stoppedProcessId: 202 } })).toThrow(/manager.stop.binding/i);
    expect(() => assertPriorRollbackManagerStopBindingV2({ ...input,
      stopEvidence: { ...stopEvidence, startEvidenceSha256: "7".repeat(64) } })).toThrow(/manager.stop.binding/i);
    expect(() => assertPriorRollbackManagerStopBindingV2({ ...input,
      stopEvidence: { ...stopEvidence, stoppedAt: authority.expiresAt } })).toThrow(/manager.stop.binding/i);
  });

  for (const scenario of [
    { operationKind: "rollout", crashStep: "stop_previous", forbiddenLaterEffect: "start_candidate" },
    { operationKind: "rollout", crashStep: "start_candidate", forbiddenLaterEffect: null },
    { operationKind: "rollback", crashStep: "stop_candidate", forbiddenLaterEffect: "start_previous" },
    { operationKind: "rollback", crashStep: "start_previous", forbiddenLaterEffect: null }
  ] as const) {
    it(`[PRODUCTION-EFFECT-UNCERTAIN-NO-SETTLEMENT] leaves ${scenario.crashStep} intent unresolved without normal failure settlement`, async () => {
      const { events, persisted, store, adapters } = crashHarness(scenario);
      const root = mkdtempSync(join(tmpdir(), "plan5-effect-crash-"));

      await expect(executeProtectedProductionOperationV2(
        { artifactRoot: root, operationKind: scenario.operationKind },
        { store, adapters }
      )).rejects.toThrow(`manager_crashed_after_mutation:${scenario.crashStep}`);

      expect(events).toContain(`intent:${scenario.crashStep}`);
      expect(events).toContain(`effect:${scenario.crashStep}`);
      if (scenario.forbiddenLaterEffect) expect(events).not.toContain(`effect:${scenario.forbiddenLaterEffect}`);
      expect(persisted.map((entry) => entry.kind)).not.toContain("production_failure_evidence");
      expect(events).not.toContain("settlement");
      expect(events).not.toContain("terminal");
    });
  }

  it("[PRODUCTION-EFFECT-UNCERTAIN-NO-SETTLEMENT] detects an intent durably written before persist returns", async () => {
    const { events, persisted, store, adapters } = crashHarness({
      operationKind: "rollout", crashStep: "start_candidate"
    });
    const writesThenCrashes: ProtectedProductionOperationStoreV2 = {
      ...store,
      persistStepIntent(value: any) {
        const record = store.persistStepIntent(value);
        if (value.stepId === "stop_previous") throw new Error("crash_after_intent_fsync_before_return");
        return record;
      }
    };
    const root = mkdtempSync(join(tmpdir(), "plan5-intent-fsync-crash-"));

    await expect(executeProtectedProductionOperationV2(
      { artifactRoot: root, operationKind: "rollout" },
      { store: writesThenCrashes, adapters }
    )).rejects.toThrow("crash_after_intent_fsync_before_return");

    expect(events).not.toContain("effect:stop_previous");
    expect(persisted.map((entry) => entry.kind)).not.toContain("production_failure_evidence");
    expect(events).not.toContain("settlement");
    expect(events).not.toContain("terminal");
  });

  it.each([
    ["after_stop_before_evidence", "stop_previous", "target_absent", false],
    ["after_spawn_observed_before_evidence", "start_candidate", "target_singleton", false],
    ["after_evidence_before_stdout", "start_candidate", "observer_forbidden", true]
  ] as const)("[PRODUCTION-MANAGER-CRASH-POINT] %s recovers the exact receipt without replaying the uncertain effect",
    async (crashPoint, crashStep, topologyState, durableManagerEvidence) => {
      const { events, store, adapters } = crashHarness({ operationKind: "rollout", crashStep });
      const root = mkdtempSync(join(tmpdir(), "plan5-manager-crash-point-"));
      let effectCalls = 0;
      let managerEvidence: { outputSha256: string } | null = null;
      const managerFault = () => { throw new Error(`manager_crash_point:${crashPoint}`); };
      const recoveringAdapters = {
        ...adapters,
        async executeEffect(leaf: any) {
          events.push(`effect:${leaf.stepId}`);
          if (leaf.stepId === crashStep) {
            effectCalls += 1;
            if (crashPoint === "after_stop_before_evidence") {
              await completeTask0BManagedRuntimeStop({
                processId: 77,
                evidencePath: "stop-evidence.json",
                async performStop() {},
                buildEvidence: () => ({ outputSha256: "e".repeat(64) }),
                async writeEvidence(_path, value) { managerEvidence = value; },
                faultHooks: { afterStopBeforeEvidence: managerFault }
              });
              throw new Error("unreachable_manager_stop_completion");
            }
            await completeTask0BManagedRuntimeStart({
              generationId: "generation-123456",
              commandId: "runtime_manager_start_candidate",
              authoritySha256: "a".repeat(64),
              processId: 77,
              evidence: { outputSha256: "e".repeat(64) },
              async writeEvidence(_path, value) { managerEvidence = value as { outputSha256: string }; },
              async terminateAndVerify() {},
              faultHooks: crashPoint === "after_spawn_observed_before_evidence"
                ? { afterObservedBeforeEvidence: managerFault }
                : { afterEvidenceBeforeReturn: managerFault }
            });
            throw new Error("unreachable_manager_start_completion");
          }
          return { inputSha256: leaf.inputSha256, outputSha256: "e".repeat(64),
            observedStateSha256: "f".repeat(64) };
        },
        async reconcileEffect(leaf: any) {
          events.push(`reconcile:${leaf.stepId}`);
          const observer = vi.fn(async () => {
            if (topologyState === "observer_forbidden") throw new Error("topology_observer_must_not_run");
            return topologyState;
          });
          const recovered = await selectRuntimeEffectRecoverySourceV2({
            managerEvidence,
            validateManagerEvidence(value) {
              expect(value).toEqual({ outputSha256: "e".repeat(64) });
            },
            observeTopology: observer
          });
          expect(recovered.source).toBe(durableManagerEvidence ? "manager_evidence" : "topology");
          expect(observer).toHaveBeenCalledTimes(durableManagerEvidence ? 0 : 1);
          return { inputSha256: leaf.inputSha256, outputSha256: "e".repeat(64),
            observedStateSha256: "f".repeat(64) };
        }
      };
      await expect(executeProtectedProductionOperationV2({ artifactRoot: root, operationKind: "rollout" },
        { store, adapters: recoveringAdapters })).rejects.toThrow(`manager_crash_point:${crashPoint}`);
      await expect(executeProtectedProductionOperationV2({ artifactRoot: root, operationKind: "rollout" },
        { store, adapters: recoveringAdapters })).resolves.toMatchObject({ operationId: operation("rollout").lease.operationId });
      expect(effectCalls).toBe(1);
      expect(events.filter((event) => event === `receipt:${crashStep}`)).toHaveLength(1);
      expect(events).toContain(`reconcile:${crashStep}`);
    });
});
