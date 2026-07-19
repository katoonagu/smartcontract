import { describe, expect, it, vi } from "vitest";
import { RUNTIME_CYCLE_NAMES } from "../../src/runtime/runtimeLiveProof";
import {
  restoreCanaryResumeStateV2,
  selectCanaryCycleOneResumeBeforeObservationV2
} from "../../src/release/productionOperationAdaptersV2";

const OPERATION_ID = `production-canary-${"a".repeat(64)}`;
const CLAIM = "b".repeat(64);
const INPUT = "c".repeat(64);
const leafResult = { inputSha256: INPUT, outputSha256: "d".repeat(64),
  observedStateSha256: "e".repeat(64) };
const cycleSnapshot = Object.fromEntries(RUNTIME_CYCLE_NAMES.map((name, index) => [name, index + 1]));
const value = {
  version: "production-canary-resume-state-v2" as const,
  operationId: OPERATION_ID,
  operationClaimSha256: CLAIM,
  canaryStartedAt: "2026-07-19T00:00:00.000Z",
  queueBaseline: 7,
  cycleSnapshot,
  leafResult,
  recordedAt: "2026-07-19T00:01:00.000Z"
};
const completedPrefix = [
  { stepId: "verify_g14", startedAt: "2026-07-19T00:00:00.000Z",
    finishedAt: "2026-07-19T00:00:10.000Z" },
  { stepId: "observe_cycle_1", startedAt: "2026-07-19T00:00:10.000Z",
    finishedAt: "2026-07-19T00:01:10.000Z" }
];

describe("production canary cross-process resume state", () => {
  it("restores the exact queue and cycle baseline only from the completed observe-cycle-1 receipt window", () => {
    expect(restoreCanaryResumeStateV2({ value, operationId: OPERATION_ID,
      operationClaimSha256: CLAIM, inputSha256: INPUT, completedPrefix })).toEqual(value);
  });

  it("restores the persisted cycle-one leaf before its receipt exists", () => {
    expect(restoreCanaryResumeStateV2({ value, operationId: OPERATION_ID,
      operationClaimSha256: CLAIM, inputSha256: INPUT,
      completedPrefix: completedPrefix.slice(0, 1) })).toEqual(value);
  });

  it("does not repeat live cycle observation after the resume state was fsynced", async () => {
    const observe = vi.fn(async () => { throw new Error("live canary observation must not repeat"); });
    await expect(selectCanaryCycleOneResumeBeforeObservationV2({ storedState: value,
      operationId: OPERATION_ID, operationClaimSha256: CLAIM, inputSha256: INPUT,
      completedPrefix: completedPrefix.slice(0, 1), observeOnlyWhenMissing: observe }))
      .resolves.toEqual(leafResult);
    expect(observe).not.toHaveBeenCalled();
  });

  it.each([
    ["foreign operation", { operationId: `production-canary-${"c".repeat(64)}` }],
    ["foreign claim", { operationClaimSha256: "d".repeat(64) }],
    ["foreign input", { inputSha256: "f".repeat(64) }],
    ["wrong completed order", { completedPrefix: [...completedPrefix].reverse() }],
    ["recorded before observation", { value: { ...value, recordedAt: "2026-07-19T00:00:09.000Z" } }],
    ["recorded after observation", { value: { ...value, recordedAt: "2026-07-19T00:01:11.000Z" } }]
  ] as const)("rejects %s instead of restoring process-local state", (_name, override) => {
    expect(() => restoreCanaryResumeStateV2({ value, operationId: OPERATION_ID,
      operationClaimSha256: CLAIM, inputSha256: INPUT,
      completedPrefix, ...override })).toThrow(/canary_resume.*binding/i);
  });
});
