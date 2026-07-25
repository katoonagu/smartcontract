import { describe, expect, it } from "vitest";
import {
  applyProviderCapacityRamp,
  applyRuntimeResourceState,
  calculateProviderCapacityLimit,
  calculateRunLookaheadTarget,
  calculateTargetActiveProviderSlots
} from "../../src/unifiedCheck/providerCapacityController";

describe("Unified provider capacity controller", () => {
  it("calculates provider supply separately from ready demand", () => {
    expect(calculateProviderCapacityLimit({
      healthyIndependentGroupConcurrency: 16,
      configuredProviderConcurrencyLimit: 32,
      providerWorkerLimit: 24,
      dbAndMemoryGuardLimit: 12
    })).toBe(12);

    expect(calculateTargetActiveProviderSlots({
      providerCapacityLimit: 12,
      eligibleReadyProviderWork: 5
    })).toBe(5);
  });

  it("scales lookahead from fair provider share and returns zero without capacity", () => {
    expect(calculateRunLookaheadTarget({
      providerCapacity: 4,
      fairProviderShare: 1.1,
      configuredLookaheadFactor: 2,
      configuredPerRunMaximum: 20
    })).toBe(3);

    expect(calculateRunLookaheadTarget({
      providerCapacity: 0,
      fairProviderShare: 10,
      configuredLookaheadFactor: 2,
      configuredPerRunMaximum: 20
    })).toBe(0);
  });

  it("lowers claim ceilings under pressure and pauses every new claim when critical", () => {
    const configured = {
      providerGuardLimit: 12,
      analysisConcurrencyLimit: 3,
      finalizationConcurrencyLimit: 2
    };

    expect(applyRuntimeResourceState({ state: "normal", ...configured })).toEqual({
      providerGuardLimit: 12,
      analysisConcurrencyLimit: 3,
      finalizationConcurrencyLimit: 2
    });
    expect(applyRuntimeResourceState({ state: "pressure", ...configured })).toEqual({
      providerGuardLimit: 6,
      analysisConcurrencyLimit: 0,
      finalizationConcurrencyLimit: 0
    });
    expect(applyRuntimeResourceState({ state: "critical", ...configured })).toEqual({
      providerGuardLimit: 0,
      analysisConcurrencyLimit: 0,
      finalizationConcurrencyLimit: 0
    });
  });

  it("decreases immediately and increases by one configured step per interval", () => {
    expect(applyProviderCapacityRamp({
      state: { target: 8, lastIncreaseAtMs: 1_000 },
      capacityLimit: 3,
      nowMs: 1_100,
      increaseStep: 2,
      increaseIntervalMs: 500
    })).toEqual({ target: 3, lastIncreaseAtMs: 1_000 });

    expect(applyProviderCapacityRamp({
      state: { target: 3, lastIncreaseAtMs: 1_000 },
      capacityLimit: 10,
      nowMs: 1_499,
      increaseStep: 2,
      increaseIntervalMs: 500
    })).toEqual({ target: 3, lastIncreaseAtMs: 1_000 });

    expect(applyProviderCapacityRamp({
      state: { target: 3, lastIncreaseAtMs: 1_000 },
      capacityLimit: 10,
      nowMs: 1_500,
      increaseStep: 2,
      increaseIntervalMs: 500
    })).toEqual({ target: 5, lastIncreaseAtMs: 1_500 });
  });

  it("resets the increase baseline without growing capacity when the clock moves backwards", () => {
    expect(applyProviderCapacityRamp({
      state: { target: 3, lastIncreaseAtMs: 5_000 },
      capacityLimit: 10,
      nowMs: 4_000,
      increaseStep: 2,
      increaseIntervalMs: 500
    })).toEqual({ target: 3, lastIncreaseAtMs: 4_000 });
  });
});
