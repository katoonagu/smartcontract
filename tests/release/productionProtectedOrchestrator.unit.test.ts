import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canonicalBytesV2 } from "../../src/release/releaseRootWriterStore";
import { releaseSha256V2 } from "../../src/release/remediationReleaseManifestV2";
import { runProductionOperationCliV2 } from "../../scripts/productionOperationCliV2";
import {
  executeProtectedProductionOperationV2,
  type ProtectedProductionOperationAdaptersV2,
  type ProtectedProductionOperationStoreV2
} from "../../src/release/productionReleaseOrchestratorV2";

const SHA = "a".repeat(64);
const CANDIDATE = "a".repeat(40);
const STARTED = "2026-07-19T00:00:00.000Z";

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
    claim: { authorityConsumptionSha256: "5".repeat(64) },
    claimSha256: "6".repeat(64)
  } as any;
}

function harness(kind: "rollout" | "canary" | "rollback" | "recovery") {
  const events: string[] = [];
  const current = begun(kind);
  const store: ProtectedProductionOperationStoreV2 = {
    async beginOperation() { events.push("begin"); return current; },
    assertOwnedAndWithinBounds(_operationId, _evaluatedAt) {
      events.push("bound");
      return { lease: current.lease, leaseSha256: current.leaseSha256,
        claim: current.claim, claimSha256: current.claimSha256, takeoverChainSha256: "7".repeat(64) };
    },
    persistStepIntent(value: any) { events.push(`intent:${value.stepId}`); return { kind: "intent", relativePath: value.relativePath, sha256: "8".repeat(64), created: true }; },
    persistStepReceipt(value: any) { events.push(`receipt:${value.stepId}`); return { kind: "receipt", relativePath: `steps/${value.sequence}.json`, sha256: releaseSha256V2(canonicalBytesV2(value)), created: true }; },
    persistExclusive(kindValue, path, value) { events.push(`persist:${kindValue}`); return { kind: kindValue, relativePath: path, sha256: releaseSha256V2(canonicalBytesV2(value)), created: true }; },
    persistSettlement() { events.push("settlement"); return { kind: "settlement", relativePath: "settlement.json", sha256: SHA, created: true }; },
    completeTerminal() { events.push("terminal"); return { prepared: {}, receipt: {}, cleanup: {} } as any; }
  };
  const adapters: ProtectedProductionOperationAdaptersV2 = {
    now: vi.fn(() => STARTED),
    async loadReleaseContext() { return { releaseFreezeIdentitySha256: "0".repeat(64) }; },
    async validateStep(input) { events.push(`validate:${input.stepId}`); return { inputSha256: input.inputSha256,
      outputSha256: "b".repeat(64), observedStateSha256: "c".repeat(64) }; },
    async prepareEffect(input) { events.push(`prepare:${input.stepId}`); return "f".repeat(64); },
    async executeEffect(input) { events.push(`effect:${input.stepId}`); return { inputSha256: input.inputSha256,
      outputSha256: "d".repeat(64), observedStateSha256: "e".repeat(64) }; },
    async reconcileEffect(input) { events.push(`reconcile:${input.stepId}`); return null; }
  };
  return { events, store, adapters };
}

describe("protected production orchestrator", () => {
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
});
