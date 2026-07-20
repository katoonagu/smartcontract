import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canonicalBytesV2 } from "../../src/release/releaseRootWriterStore";
import {
  releaseSha256V2,
  validateProductionFailureEvidenceV2
} from "../../src/release/remediationReleaseManifestV2";
import { runProductionOperationCliV2 } from "../../scripts/productionOperationCliV2";
import { resumeTakenOverProductionOperationV2 } from "../../scripts/takeoverProductionOperationLease";
import {
  executeProtectedProductionOperationV2,
  type ProtectedProductionOperationAdaptersV2,
  type ProtectedProductionOperationStoreV2
} from "../../src/release/productionReleaseOrchestratorV2";

const SHA = "a".repeat(64);
const CANDIDATE = "a".repeat(40);
const STARTED = "2026-07-19T00:00:00.000Z";

const TERMINAL_CHECKS = Object.freeze({
  immediate_runtime_checks: ["schema", "version", "admin", "singleton", "workers", "logs", "delivery", "legacy"],
  bounded_runtime_checks: ["schema", "version", "admin", "singleton", "reconciliation", "delivery", "navigation",
    "allowance", "legacy", "secrets", "queues", "honest_limits"],
  rollback_runtime_checks: ["schema032_retained", "previous_version", "admin", "singleton", "allowance", "legacy",
    "sent", "no_duplicate_send"]
} as const);

function begun(kind: "rollout" | "canary" | "rollback" | "recovery") {
  return {
    selectedAuthority: {
      commandId: `production_${kind}`,
      redactedTemplateSha256: "b".repeat(64)
    },
    selectedAuthoritySha256: "c".repeat(64),
    selectedAuthorityIssuerReceiptSha256: "d".repeat(64),
    lease: {
      operationKind: kind,
      operationId: `production-${kind}-${"e".repeat(64)}`,
      candidateSha: CANDIDATE,
      releaseGenerationId: "generation-1",
      sourceManifestSha256: "f".repeat(64),
      artifactRootFingerprintSha256: "1".repeat(64),
      capability: kind === "recovery" ? "recovery_only" : "effect_capable",
      leaseEpoch: 1,
      operationDeadlineAt: "2026-07-19T00:35:00.000Z"
    },
    leaseSha256: "2".repeat(64),
    preclaim: {},
    preclaimSha256: "3".repeat(64),
    lineage: {},
    lineageSha256: "4".repeat(64),
    claim: {
      authorityConsumptionSha256: "5".repeat(64),
      authorityConsumption: { leaseSha256AtConsumption: "2".repeat(64) },
      claimedAt: STARTED
    },
    claimSha256: "6".repeat(64)
  } as any;
}

function harness(kind: "rollout" | "canary" | "rollback" | "recovery") {
  const events: string[] = [];
  const persisted: Array<{ kind: string; path: string; value: any }> = [];
  const unresolvedIntents = new Set<string>();
  const current = begun(kind);
  const store: ProtectedProductionOperationStoreV2 = {
    async beginOperation() { events.push("begin"); return current; },
    assertOwnedAndWithinBounds(_operationId, _evaluatedAt) {
      events.push("bound");
      return { lease: current.lease, leaseSha256: current.leaseSha256,
        claim: current.claim, claimSha256: current.claimSha256, takeoverChainSha256: "7".repeat(64) };
    },
    heartbeat() { events.push("heartbeat"); return { lease: current.lease, leaseSha256: current.leaseSha256 }; },
    persistStepIntent(value: any) { events.push(`intent:${value.stepId}`);
      unresolvedIntents.add(`${value.operationId}:${value.sequence}:${value.stepId}`);
      return { kind: "intent", relativePath: value.relativePath, sha256: "8".repeat(64), created: true }; },
    persistStepReceipt(value: any) { events.push(`receipt:${value.stepId}`);
      unresolvedIntents.delete(`${value.operationId}:${value.sequence}:${value.stepId}`);
      return { kind: "receipt", relativePath: `steps/${value.sequence}.json`, sha256: releaseSha256V2(canonicalBytesV2(value)), created: true }; },
    hasUnresolvedStepIntent(value) {
      return unresolvedIntents.has(`${value.operationId}:${value.sequence}:${value.stepId}`);
    },
    persistExclusive(kindValue, path, value) { events.push(`persist:${kindValue}`);
      persisted.push({ kind: kindValue, path, value });
      return { kind: kindValue, relativePath: path, sha256: releaseSha256V2(canonicalBytesV2(value)), created: true }; },
    persistSettlement() { events.push("settlement"); return { kind: "settlement", relativePath: "settlement.json", sha256: SHA, created: true }; },
    completeTerminal() { events.push("terminal"); return { prepared: {}, receipt: {}, cleanup: {} } as any; }
  };
  const adapters: ProtectedProductionOperationAdaptersV2 = {
    now: vi.fn(() => STARTED),
    async loadReleaseContext() { return { releaseFreezeIdentitySha256: "0".repeat(64) }; },
    async validateStep(input) { events.push(`validate:${input.stepId}`); return { inputSha256: input.inputSha256,
      outputSha256: "b".repeat(64), observedStateSha256: "c".repeat(64),
      verifiedChecks: TERMINAL_CHECKS[input.stepId as keyof typeof TERMINAL_CHECKS] }; },
    async prepareEffect(input) { events.push(`prepare:${input.stepId}`); return "f".repeat(64); },
    async executeEffect(input) { events.push(`effect:${input.stepId}`); return { inputSha256: input.inputSha256,
      outputSha256: "d".repeat(64), observedStateSha256: "e".repeat(64) }; },
    async reconcileEffect(input) { events.push(`reconcile:${input.stepId}`); return null; }
  };
  return { events, persisted, store, adapters };
}

describe("protected production orchestrator", () => {
  it("continues a normal takeover in the same owner process instead of stranding its lease", async () => {
    const root = mkdtempSync(join(tmpdir(), "plan5-protected-takeover-resume-"));
    const execute = vi.fn(async () => ({ operationId: "operation", leaseEpoch: 2,
      receiptSha256: SHA, completedSteps: [] as string[] }));
    const takeover = { operationKind: "rollout", operationId: `production-rollout-${"e".repeat(64)}` } as any;

    const adapters = {} as ProtectedProductionOperationAdaptersV2;
    await expect(resumeTakenOverProductionOperationV2(root, takeover, execute as any, () => adapters))
      .resolves.toMatchObject({ receiptSha256: SHA });
    expect(execute).toHaveBeenCalledWith({ artifactRoot: root, operationKind: "rollout" },
      { adapters });
  });

  it("accepts only the protected root at the CLI and never reads an operator-authored input bundle", async () => {
    const root = mkdtempSync(join(tmpdir(), "plan5-protected-cli-"));
    writeFileSync(join(root, "production-rollout-input-v2.json"), "{not-json", "utf8");
    const execute = vi.fn(async () => ({ operationId: "operation", leaseEpoch: 1,
      receiptSha256: SHA, completedSteps: [] }));

    await expect(runProductionOperationCliV2([root], "rollout", { executeProtected: execute })).resolves.toMatchObject({ operationId: "operation" });
    expect(execute).toHaveBeenCalledWith({ artifactRoot: root, operationKind: "rollout" });
    await expect(runProductionOperationCliV2([root, "extra"], "rollout", { executeProtected: execute })).rejects.toThrow(/usage/);
  });

  it("fences every rollout leaf and persists intent before each external effect", async () => {
    const { events, store, adapters } = harness("rollout");
    const root = mkdtempSync(join(tmpdir(), "plan5-protected-rollout-"));
    mkdirSync(root, { recursive: true });

    const result = await executeProtectedProductionOperationV2({ artifactRoot: root, operationKind: "rollout" }, { store, adapters });

    expect(result.completedSteps).toEqual([
      "verify_g13", "verify_schema", "verify_previous_runtime_identity", "verify_singleton_precondition",
      "stop_previous", "prove_previous_stopped", "start_candidate", "prove_candidate_started",
      "immediate_runtime_checks"
    ]);
    expect(events.indexOf("intent:stop_previous")).toBeLessThan(events.indexOf("effect:stop_previous"));
    expect(events.indexOf("intent:start_candidate")).toBeLessThan(events.indexOf("effect:start_candidate"));
    expect(events.filter((value) => value === "bound")).toHaveLength(22);
    expect(events.slice(-2)).toEqual(["settlement", "terminal"]);
  });

  it("persists the immutable recovery source input before deriving terminal failure evidence", async () => {
    const { persisted, store, adapters } = harness("recovery");
    const prefixSha256 = releaseSha256V2(canonicalBytesV2([]));
    const recoveryAdapters: ProtectedProductionOperationAdaptersV2 = {
      ...adapters,
      async loadRecoveryContext() {
        return {
          priorOperationKind: "rollout",
          priorOperationId: `production-rollout-${"f".repeat(64)}`,
          priorTerminalAbandonedSha256: "1".repeat(64),
          priorTerminalCleanupSha256: "2".repeat(64),
          completedStepReceiptPrefix: [],
          completedStepReceiptPrefixSha256: prefixSha256,
          uncertainStepMarker: null,
          uncertainStepMarkerSha256: null,
          failedGateId: "G14_PRODUCTION_ROLLOUT",
          failureCode: "operation_deadline_reached",
          priorAttemptedExternalEffect: false
        };
      }
    };
    await executeProtectedProductionOperationV2({
      artifactRoot: mkdtempSync(join(tmpdir(), "plan5-protected-recovery-input-")),
      operationKind: "recovery"
    }, { store, adapters: recoveryAdapters });

    const recoveryInput = persisted.find((entry) => entry.kind === "production_recovery_input");
    expect(recoveryInput).toMatchObject({ path: "production-recovery-input-v2.json",
      value: { recoveryProductionLeaseSha256: "2".repeat(64), verifiedAt: STARTED } });
    expect(persisted.find((entry) => entry.kind === "production_failure_evidence")?.value)
      .toMatchObject({ recoveryInputSha256: releaseSha256V2(canonicalBytesV2(recoveryInput!.value)) });
  });

  it("renews the operation lease at most every ten seconds during a long validation leaf", async () => {
    vi.useFakeTimers();
    const { events, store, adapters } = harness("rollout");
    let delayed = false;
    const slowAdapters: ProtectedProductionOperationAdaptersV2 = {
      ...adapters,
      async validateStep(input) {
        if (!delayed) {
          delayed = true;
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 11_000));
        }
        return adapters.validateStep(input);
      }
    };
    const root = mkdtempSync(join(tmpdir(), "plan5-protected-heartbeat-"));
    const execution = executeProtectedProductionOperationV2(
      { artifactRoot: root, operationKind: "rollout" }, { store, adapters: slowAdapters });

    await vi.advanceTimersByTimeAsync(11_000);
    await execution;

    expect(events.filter((value) => value === "heartbeat")).toHaveLength(2);
    vi.useRealTimers();
  });

  it("never repeats an effect after a durable intent and requires read-only reconciliation", async () => {
    const { events, store, adapters } = harness("rollout");
    const replayStore: ProtectedProductionOperationStoreV2 = { ...store, persistStepIntent: (value: any) => {
      events.push(`intent:${value.stepId}`);
      return { kind: "intent", relativePath: value.relativePath, sha256: "8".repeat(64),
        created: value.stepId !== "stop_previous" };
    } };
    const replayAdapters: ProtectedProductionOperationAdaptersV2 = { ...adapters, reconcileEffect: async (input) => {
      events.push(`reconcile:${input.stepId}`);
      return input.stepId === "stop_previous" ? { inputSha256: input.inputSha256, outputSha256: "d".repeat(64),
        observedStateSha256: "e".repeat(64) } : null;
    } };
    const root = mkdtempSync(join(tmpdir(), "plan5-protected-reconcile-"));

    await executeProtectedProductionOperationV2({ artifactRoot: root, operationKind: "rollout" }, { store: replayStore, adapters: replayAdapters });

    expect(events).toContain("reconcile:stop_previous");
    expect(events).not.toContain("effect:stop_previous");
  });

  it("settles a rollout preflight failure as typed no-effect evidence before rethrowing", async () => {
    const { events, store, adapters } = harness("rollout");
    const captured: unknown[] = [];
    const failureStore: ProtectedProductionOperationStoreV2 = {
      ...store,
      persistExclusive(kind, path, value) {
        captured.push(value);
        return store.persistExclusive(kind, path, value);
      }
    };
    const failureAdapters: ProtectedProductionOperationAdaptersV2 = {
      ...adapters,
      async validateStep(input) {
        if (input.stepId === "verify_schema") throw new Error("schema verification failed");
        return adapters.validateStep(input);
      }
    };
    const root = mkdtempSync(join(tmpdir(), "plan5-protected-rollout-failure-"));

    await expect(executeProtectedProductionOperationV2(
      { artifactRoot: root, operationKind: "rollout" },
      { store: failureStore, adapters: failureAdapters }
    )).rejects.toThrow("schema verification failed");

    const evidence = captured.find((value: any) => value?.version === "production-failure-evidence-v2");
    expect(validateProductionFailureEvidenceV2(evidence)).toMatchObject({
      failedGateId: "G14_PRODUCTION_ROLLOUT",
      evidenceKind: "runtime_rollout_preflight",
      attemptedExternalEffect: false,
      failureCode: "schema_verification_failed"
    });
    expect(events).not.toContain("effect:stop_previous");
    expect(events.slice(-2)).toEqual(["settlement", "terminal"]);
  });

  it("settles a canary check failure as typed terminal evidence before rethrowing", async () => {
    const { events, store, adapters } = harness("canary");
    const captured: unknown[] = [];
    const failureStore: ProtectedProductionOperationStoreV2 = {
      ...store,
      persistExclusive(kind, path, value) {
        captured.push(value);
        return store.persistExclusive(kind, path, value);
      }
    };
    const failureAdapters: ProtectedProductionOperationAdaptersV2 = {
      ...adapters,
      async validateStep(input) {
        if (input.stepId === "observe_cycle_1") throw new Error("delivery invariant failed");
        return adapters.validateStep(input);
      }
    };
    const root = mkdtempSync(join(tmpdir(), "plan5-protected-canary-failure-"));

    await expect(executeProtectedProductionOperationV2(
      { artifactRoot: root, operationKind: "canary" },
      { store: failureStore, adapters: failureAdapters }
    )).rejects.toThrow("delivery invariant failed");

    const evidence = captured.find((value: any) => value?.version === "production-failure-evidence-v2");
    expect(validateProductionFailureEvidenceV2(evidence)).toMatchObject({
      failedGateId: "G15_PRODUCTION_CANARY",
      evidenceKind: "runtime_canary_checks",
      attemptedExternalEffect: true,
      failureCode: "delivery_invariant_failed"
    });
    expect(events.slice(-2)).toEqual(["settlement", "terminal"]);
  });

  it("fails closed when the exact terminal live-proof check set is missing or has extras", async () => {
    for (const verifiedChecks of [undefined, [...TERMINAL_CHECKS.immediate_runtime_checks, "invented"]]) {
      const { events, store, adapters } = harness("rollout");
      const invalidProofAdapters: ProtectedProductionOperationAdaptersV2 = {
        ...adapters,
        async validateStep(input) {
          const result = await adapters.validateStep(input);
          return input.stepId === "immediate_runtime_checks" ? { ...result, verifiedChecks } : result;
        }
      };
      const root = mkdtempSync(join(tmpdir(), "plan5-protected-live-proof-invalid-"));

      await expect(executeProtectedProductionOperationV2(
        { artifactRoot: root, operationKind: "rollout" },
        { store, adapters: invalidProofAdapters }
      )).rejects.toThrow(/verified.*checks|live.*proof/i);

      expect(events.slice(-2)).toEqual(["settlement", "terminal"]);
    }
  });

  it("settles exactly once when pass-evidence preparation fails after every step receipt", async () => {
    const { events, store, adapters } = harness("rollout");
    const failingStore: ProtectedProductionOperationStoreV2 = {
      ...store,
      persistExclusive(kind, path, value) {
        if (kind === "rollout_orchestration") throw new Error("delivery invariant failed after receipts");
        return store.persistExclusive(kind, path, value);
      }
    };
    const root = mkdtempSync(join(tmpdir(), "plan5-protected-post-step-failure-"));

    await expect(executeProtectedProductionOperationV2(
      { artifactRoot: root, operationKind: "rollout" },
      { store: failingStore, adapters }
    )).rejects.toThrow("delivery invariant failed after receipts");

    expect(events.filter((event) => event === "settlement")).toHaveLength(1);
    expect(events.filter((event) => event === "terminal")).toHaveLength(1);
    expect(events.slice(-2)).toEqual(["settlement", "terminal"]);
  });
});
