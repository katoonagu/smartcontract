import { mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ProductionOperationStoreV2 } from "../../src/release/productionOperationStore";
import { canonicalBytesV2 } from "../../src/release/releaseRootWriterStore";
import { releaseSha256V2 } from "../../src/release/remediationReleaseManifestV2";
import {
  assertExactManagerRuntimeReconciliationBindingV2,
  selectDurableReconciliationBeforeObservationV2,
  selectExactRuntimeAuthorityV2
} from "../../src/release/productionOperationAdaptersV2";

const S = "a".repeat(64);

function protectedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "runtime-reconcile-root-"));
  if (process.platform === "win32") {
    const sid = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"], { encoding: "utf8" }).trim();
    execFileSync("icacls.exe", [root, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  }
  return root;
}

function exactInput() {
  const intent = {
    operationId: `production-rollout-${"b".repeat(64)}`,
    operationClaimSha256: "c".repeat(64),
    authorityConsumptionSha256: "d".repeat(64),
    sequence: 5,
    stepId: "stop_previous",
    inputSha256: "e".repeat(64),
    intendedExternalEffectSha256: "f".repeat(64),
    relativePath: `production-operation-step-intents/production-rollout-${"b".repeat(64)}/5-stop_previous-1-v2.json`,
    currentOperationLeaseSha256: "1".repeat(64),
    currentOperationLeaseEpoch: 1
  };
  return {
    operationKind: "rollout",
    operationId: intent.operationId,
    operationClaimSha256: intent.operationClaimSha256,
    authorityConsumptionSha256: intent.authorityConsumptionSha256,
    sequence: 5,
    stepId: "stop_previous",
    inputSha256: intent.inputSha256,
    intendedExternalEffectSha256: intent.intendedExternalEffectSha256,
    intent,
    intentSha256: releaseSha256V2(canonicalBytesV2(intent)),
    releaseFreezeIdentitySha256: "2".repeat(64),
    sourceManifestSha256: "3".repeat(64)
  } as any;
}

function exactAuthority(input: ReturnType<typeof exactInput>) {
  return {
    operationKind: input.operationKind,
    operationId: input.operationId,
    operationClaimSha256: input.operationClaimSha256,
    authorityConsumptionSha256: input.authorityConsumptionSha256,
    sequence: input.sequence,
    stepId: input.stepId,
    inputSha256: input.inputSha256,
    intendedExternalEffectSha256: input.intendedExternalEffectSha256,
    intentSha256: input.intentSha256,
    intentRelativePath: input.intent.relativePath,
    operationLeaseSha256: input.intent.currentOperationLeaseSha256,
    operationLeaseEpoch: input.intent.currentOperationLeaseEpoch,
    releaseFreezeIdentitySha256: input.releaseFreezeIdentitySha256,
    sourceManifestSha256: input.sourceManifestSha256
  } as any;
}

describe("runtime reconciliation adapter boundaries", () => {
  it("returns exact durable reconciliation without invoking changed or unavailable live topology", async () => {
    const durable = { inputSha256: "1".repeat(64), outputSha256: "2".repeat(64),
      observedStateSha256: "3".repeat(64) };
    const observe = vi.fn(async () => { throw new Error("live topology changed after fsync"); });
    await expect(selectDurableReconciliationBeforeObservationV2({
      loadDurable: () => durable,
      observeOnlyWhenMissing: observe
    })).resolves.toEqual(durable);
    expect(observe).not.toHaveBeenCalled();
  });

  it("allows only its dedicated nested root and rejects traversal or an alternate root", () => {
    const root = protectedRoot();
    const store = new ProductionOperationStoreV2(root);
    expect(store.persistExclusive("runtime_effect_reconciliation",
      `production-runtime-effect-reconciliations/production-rollout-${"b".repeat(64)}/1-stop_previous-${S}-v2.json`,
      { ok: true }).created).toBe(true);
    expect(() => store.persistExclusive("bad", "production-runtime-effect-reconciliations/../escape.json", {}))
      .toThrow(/relative_path|directory/i);
    expect(() => store.persistExclusive("bad", `runtime-reconciliations/${S}.json`, {}))
      .toThrow(/directory_forbidden/i);
  });

  it("accepts manager evidence only when every active operation and intent field is exact", () => {
    const input = exactInput();
    const authority = exactAuthority(input);
    expect(() => assertExactManagerRuntimeReconciliationBindingV2({
      effectIdentitySha256: input.intendedExternalEffectSha256,
      authority
    }, input)).not.toThrow();
    for (const mutation of [
      { operationId: `production-rollout-${"9".repeat(64)}` },
      { operationClaimSha256: "9".repeat(64) },
      { intentSha256: "9".repeat(64) },
      { operationLeaseSha256: "9".repeat(64) }
    ]) {
      expect(() => assertExactManagerRuntimeReconciliationBindingV2({
        effectIdentitySha256: input.intendedExternalEffectSha256,
        authority: { ...authority, ...mutation }
      }, input)).toThrow(/reconciliation_binding_invalid/i);
    }
  });

  it("ignores foreign same-command authorities but rejects two exact authorities", () => {
    const input = exactInput();
    const exact = { id: "exact", authority: exactAuthority(input) };
    const foreign = { id: "foreign", authority: { ...exact.authority,
      operationId: `production-rollout-${"8".repeat(64)}` } };
    const binding = { operationId: input.operationId,
      operationClaimSha256: input.operationClaimSha256, intentSha256: input.intentSha256 };
    expect(selectExactRuntimeAuthorityV2([foreign, exact], input.stepId, binding)).toBe(exact);
    expect(() => selectExactRuntimeAuthorityV2([exact, { ...exact, id: "duplicate" }],
      input.stepId, binding)).toThrow(/evidence_ambiguous/i);
  });
});
