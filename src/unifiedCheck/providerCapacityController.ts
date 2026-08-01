export type ProviderGroupState = "healthy" | "cooldown" | "circuit_open";
export type RuntimeResourceState = "normal" | "pressure" | "critical";

export interface ProviderCapacitySupply {
  healthyIndependentGroupConcurrency: number;
  configuredProviderConcurrencyLimit: number;
  providerWorkerLimit: number;
  dbAndMemoryGuardLimit: number;
}

export type ProviderCapacityRampState = {
  target: number;
  lastIncreaseAtMs: number;
};

export function calculateProviderCapacityLimit(
  supply: ProviderCapacitySupply
): number {
  return Math.max(0, Math.min(
    supply.healthyIndependentGroupConcurrency,
    supply.configuredProviderConcurrencyLimit,
    supply.providerWorkerLimit,
    supply.dbAndMemoryGuardLimit
  ));
}

export function calculateTargetActiveProviderSlots(input: {
  providerCapacityLimit: number;
  eligibleReadyProviderWork: number;
}): number {
  return Math.max(0, Math.min(
    input.providerCapacityLimit,
    input.eligibleReadyProviderWork
  ));
}

export function calculateRunLookaheadTarget(input: {
  providerCapacity: number;
  fairProviderShare: number;
  configuredLookaheadFactor: number;
  configuredPerRunMaximum: number;
}): number {
  if (input.providerCapacity <= 0) return 0;
  return Math.min(
    input.configuredPerRunMaximum,
    Math.max(1, Math.ceil(
      input.fairProviderShare * input.configuredLookaheadFactor
    ))
  );
}

export function applyRuntimeResourceState(input: {
  state: RuntimeResourceState;
  providerGuardLimit: number;
  analysisConcurrencyLimit: number;
  finalizationConcurrencyLimit: number;
}): {
  providerGuardLimit: number;
  analysisConcurrencyLimit: number;
  finalizationConcurrencyLimit: number;
} {
  if (input.state === "critical") {
    return {
      providerGuardLimit: 0,
      analysisConcurrencyLimit: 0,
      finalizationConcurrencyLimit: 0
    };
  }
  if (input.state === "pressure") {
    return {
      providerGuardLimit: Math.floor(input.providerGuardLimit / 2),
      analysisConcurrencyLimit: 0,
      finalizationConcurrencyLimit: 0
    };
  }
  return {
    providerGuardLimit: input.providerGuardLimit,
    analysisConcurrencyLimit: input.analysisConcurrencyLimit,
    finalizationConcurrencyLimit: input.finalizationConcurrencyLimit
  };
}

export function applyProviderCapacityRamp(input: {
  state: ProviderCapacityRampState;
  capacityLimit: number;
  nowMs: number;
  increaseStep: number;
  increaseIntervalMs: number;
}): ProviderCapacityRampState {
  if (input.nowMs < input.state.lastIncreaseAtMs) {
    return {
      target: Math.min(input.state.target, Math.max(0, input.capacityLimit)),
      lastIncreaseAtMs: input.nowMs
    };
  }
  if (input.capacityLimit <= input.state.target) {
    return {
      target: Math.max(0, input.capacityLimit),
      lastIncreaseAtMs: input.state.lastIncreaseAtMs
    };
  }
  if (input.nowMs - input.state.lastIncreaseAtMs < input.increaseIntervalMs) {
    return input.state;
  }
  return {
    target: Math.min(input.capacityLimit, input.state.target + input.increaseStep),
    lastIncreaseAtMs: input.nowMs
  };
}
