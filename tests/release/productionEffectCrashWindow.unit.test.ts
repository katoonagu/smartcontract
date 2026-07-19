import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canonicalBytesV2 } from "../../src/release/releaseRootWriterStore";
import { releaseSha256V2 } from "../../src/release/remediationReleaseManifestV2";
import {
  executeProtectedProductionOperationV2,
  type ProtectedProductionOperationAdaptersV2,
  type ProtectedProductionOperationStoreV2,
  type ProtectedRollbackWindowV2
} from "../../src/release/productionReleaseOrchestratorV2";

const SHA40 = "a".repeat(40);
const SHA256 = "b".repeat(64);
const NOW = "2026-07-19T00:00:00.000Z";

const TERMINAL_CHECKS = Object.freeze({
  immediate_runtime_checks: ["schema", "version", "admin", "singleton", "workers", "logs", "delivery", "legacy"],
  rollback_runtime_checks: ["schema032_retained", "previous_version", "admin", "singleton", "allowance", "legacy",
    "sent", "no_duplicate_send"]
} as const);

type OperationKind = "rollout" | "rollback";

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
      unresolvedIntents.add(`${value.operationId}:${value.sequence}:${value.stepId}`);
      return { kind: "intent", relativePath: value.relativePath, sha256: "a".repeat(64), created: true };
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

describe("production effect crash windows", () => {
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
});
