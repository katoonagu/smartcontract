import { describe, expect, it, vi } from "vitest";
import { RUNTIME_CYCLE_NAMES } from "../../src/runtime/runtimeLiveProof";
import { canonicalBytesV2 } from "../../src/release/releaseRootWriterStore";
import { canonicalReleaseJsonV2 } from "../../src/release/remediationReleaseManifestV2";
import { createHash } from "node:crypto";
import * as canaryApi from "../../src/release/productionOperationAdaptersV2";
import {
  restoreCanaryResumeStateV2,
  selectCanaryCycleOneResumeBeforeObservationV2
} from "../../src/release/productionOperationAdaptersV2";

const OPERATION_ID = `production-canary-${"a".repeat(64)}`;
const CLAIM = "b".repeat(64);
const INPUT = "c".repeat(64);
const LEASE = "d".repeat(64);
const BASIC_OUTPUT = "e".repeat(64);
const cycleSnapshot = Object.fromEntries(RUNTIME_CYCLE_NAMES.map((name, index) => [name, index + 1]));
const proof = {
  schemaState: "schema_032_verified" as const, schemaChecksumSha256: "f".repeat(64),
  runtimeSha: "a".repeat(40), adminStatus: 200, runtimeProcessCount: 1,
  workerScheduleCount: 1, botStartedCount: 1, fatalLogCount: 0, secretDetected: false,
  deliveryInvariantViolationCount: 0, terminalLegacyUnchanged: true,
  reconciliationStrandedCount: 0, navigationStatus: 200, allowanceMirrorMismatchCount: 0,
  queueGrowthCount: 0, honestLimitViolationCount: 0, sentFingerprintDuplicateCount: 0,
  runtimeCycleHighWatermarksVerified: true
};
const outputSha256 = createHash("sha256").update(canonicalBytesV2({
  basicOutputSha256: BASIC_OUTPUT, proof, queuePopulationCount: 7, cycleSnapshot
})).digest("hex");
const leafResult = { inputSha256: INPUT, outputSha256,
  observedStateSha256: createHash("sha256").update(Buffer.from(canonicalReleaseJsonV2({
    stepId: "observe_cycle_1", outputSha256
  }), "utf8")).digest("hex") };
const value = {
  version: "production-canary-resume-state-v2" as const,
  operationId: OPERATION_ID,
  operationClaimSha256: CLAIM,
  operationLeaseSha256: LEASE,
  operationLeaseEpoch: 2,
  inputSha256: INPUT,
  basicOutputSha256: BASIC_OUTPUT,
  canaryStartedAt: "2026-07-19T00:00:00.000Z",
  queueBaseline: 7,
  cycleSnapshot,
  proof,
  leafResult,
  recordedAt: "2026-07-19T00:01:00.000Z"
};
const lineageLeaseTips = [{ sha256: LEASE, epoch: 2 }];
const completedPrefix = [
  { stepId: "verify_g14", startedAt: "2026-07-19T00:00:00.000Z",
    finishedAt: "2026-07-19T00:00:10.000Z" },
  { stepId: "observe_cycle_1", startedAt: "2026-07-19T00:00:10.000Z",
    finishedAt: "2026-07-19T00:01:10.000Z" }
];

describe("production canary cross-process resume state", () => {
  it("restores the exact queue and cycle baseline only from the completed observe-cycle-1 receipt window", () => {
    expect(restoreCanaryResumeStateV2({ value, operationId: OPERATION_ID,
      operationClaimSha256: CLAIM, inputSha256: INPUT, lineageLeaseTips, completedPrefix })).toEqual(value);
  });

  it("restores the persisted cycle-one leaf before its receipt exists", () => {
    expect(restoreCanaryResumeStateV2({ value, operationId: OPERATION_ID,
      operationClaimSha256: CLAIM, inputSha256: INPUT, lineageLeaseTips,
      completedPrefix: completedPrefix.slice(0, 1) })).toEqual(value);
  });

  it("does not repeat live cycle observation after the resume state was fsynced", async () => {
    const observe = vi.fn(async () => { throw new Error("live canary observation must not repeat"); });
    await expect(selectCanaryCycleOneResumeBeforeObservationV2({ storedState: value,
      operationId: OPERATION_ID, operationClaimSha256: CLAIM, inputSha256: INPUT,
      lineageLeaseTips, completedPrefix: completedPrefix.slice(0, 1), observeOnlyWhenMissing: observe }))
      .resolves.toEqual(leafResult);
    expect(observe).not.toHaveBeenCalled();
  });

  it.each([
    ["foreign operation", { operationId: `production-canary-${"c".repeat(64)}` }],
    ["foreign claim", { operationClaimSha256: "d".repeat(64) }],
    ["foreign input", { inputSha256: "f".repeat(64) }],
    ["foreign lease", { value: { ...value, operationLeaseSha256: "f".repeat(64) } }],
    ["changed queue baseline", { value: { ...value, queueBaseline: 6 } }],
    ["changed cycle baseline", { value: { ...value,
      cycleSnapshot: { ...cycleSnapshot, [RUNTIME_CYCLE_NAMES[0]]: 99 } } }],
    ["wrong completed order", { completedPrefix: [...completedPrefix].reverse() }],
    ["recorded before observation", { value: { ...value, recordedAt: "2026-07-19T00:00:09.000Z" } }],
    ["recorded after observation", { value: { ...value, recordedAt: "2026-07-19T00:01:11.000Z" } }]
  ] as const)("rejects %s instead of restoring process-local state", (_name, override) => {
    expect(() => restoreCanaryResumeStateV2({ value, operationId: OPERATION_ID,
      operationClaimSha256: CLAIM, inputSha256: INPUT,
      lineageLeaseTips, completedPrefix, ...override })).toThrow(/canary_resume.*binding/i);
  });

  it("caps every canary observation at 30 minutes even when operation margin is 35 minutes", () => {
    const deadline = (canaryApi as any).productionCanaryObservationHardDeadlineV2;
    expect(typeof deadline).toBe("function");
    expect(deadline("2026-07-19T00:00:00.000Z", "2026-07-19T00:35:00.000Z",
      "2026-07-19T00:40:00.000Z")).toBe("2026-07-19T00:30:00.000Z");
    expect(deadline("2026-07-19T00:00:00.000Z", "2026-07-19T00:20:00.000Z",
      "2026-07-19T00:40:00.000Z")).toBe("2026-07-19T00:20:00.000Z");
  });
});
