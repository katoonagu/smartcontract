import { describe, expect, it, vi } from "vitest";
import {
  createUnifiedProductionRuntime
} from "../../src/unifiedCheck/productionRuntime";
import * as shadowRuntimeModule from "../../src/unifiedCheck/serviceRoleShadowRuntime";
import * as workerModule from "../../src/unifiedCheck/worker";

function runtimeInput() {
  return {
    db: {} as never,
    runtimeCommit: "candidate",
    providerConfigurationSha256: "a".repeat(64),
    loadProviderPage: async () => {
      throw new Error("unused");
    },
    loadCounterpartyLabels: async () => new Map(),
    loadFrozenLabelDataset: async () => {
      throw new Error("unused");
    },
    loadHardEvidence: async () => ({})
  };
}

describe("Unified production runtime configuration", () => {
  it("rejects a commit ceiling below the manifest ceiling", () => {
    expect(() => createUnifiedProductionRuntime({
      ...runtimeInput(),
      manifestMaxBytes: 2_048,
      commitMaxBytes: 1_024
    })).toThrow("unified_production_commit_max_bytes_too_small");
  });

  it("constructs shadow runtime only for the exact enabled policy", () => {
    const create = vi.spyOn(
      shadowRuntimeModule,
      "createServiceRoleShadowRuntimeV1"
    );
    try {
      const enabledInput = runtimeInput();
      createUnifiedProductionRuntime(runtimeInput());
      createUnifiedProductionRuntime({
        ...enabledInput,
        serviceRoleShadowPolicy: "disabled"
      });
      expect(create).not.toHaveBeenCalled();

      const recoveryDb = {} as never;
      createUnifiedProductionRuntime({
        ...enabledInput,
        serviceRoleShadowRecoveryDb: recoveryDb,
        serviceRoleShadowPolicy: "service-role-shadow-100-plus-100-v1"
      });
      expect(create).toHaveBeenCalledTimes(2);
      expect(create).toHaveBeenNthCalledWith(1, {
        db: enabledInput.db,
        runtimeCommit: "candidate",
        pendingGroupRetentionMs: 120_000
      });
      expect(create).toHaveBeenNthCalledWith(2, {
        db: recoveryDb,
        runtimeCommit: "candidate",
        pendingGroupRetentionMs: 120_000
      });
    } finally {
      create.mockRestore();
    }
  });

  it("rejects an unknown runtime shadow policy", () => {
    expect(() => createUnifiedProductionRuntime({
      ...runtimeInput(),
      serviceRoleShadowPolicy: "enabled" as never
    })).toThrow("unified_production_service_role_shadow_policy_invalid");
  });

  it("requires an isolated recovery database when shadow mode is enabled", () => {
    expect(() => createUnifiedProductionRuntime({
      ...runtimeInput(),
      serviceRoleShadowPolicy: "service-role-shadow-100-plus-100-v1"
    })).toThrow("unified_production_service_role_shadow_recovery_db_required");
  });

  it("exposes enabled startup recovery and summarizes only completed traversal", async () => {
    const reconcileCheckpoint = vi.fn();
    const summarizeRun = vi.fn();
    const lifecycleRecover = vi.fn();
    const recoveryRecover = vi.fn();
    const recoverySummarizeRun = vi.fn();
    const create = vi.spyOn(
      shadowRuntimeModule,
      "createServiceRoleShadowRuntimeV1"
    ).mockReturnValueOnce({
      loadInputFence: vi.fn(),
      lookupMap: vi.fn(),
      observeAcceptedAddressHistoryGroup: vi.fn(),
      reconcileCheckpoint,
      summarizeRun,
      reconcileCommittedServiceRoleShadowRunsV1: lifecycleRecover
    }).mockReturnValueOnce({
      loadInputFence: vi.fn(),
      lookupMap: vi.fn(),
      observeAcceptedAddressHistoryGroup: vi.fn(),
      reconcileCheckpoint: vi.fn(),
      summarizeRun: recoverySummarizeRun,
      reconcileCommittedServiceRoleShadowRunsV1: recoveryRecover
    });
    const runCycle = vi.spyOn(workerModule, "runUnifiedTaskCycle")
      .mockImplementation(async (cycle) => {
        const signal = new AbortController().signal;
        await cycle.onLifecyclePersisted?.({
          task: {
            id: "task-traversal",
            runId: "run-1",
            kind: "traversal",
            attempt: 1,
            checkpoint: {},
            cancellationRequestedAt: null
          },
          result: {
            kind: "completed",
            artifactSha256: "b".repeat(64)
          },
          checkpointCommit: null,
          signal
        });
        return { claimed: false, taskId: null, outcome: "idle" };
      });
    try {
      const disabled = createUnifiedProductionRuntime(runtimeInput());
      expect(disabled.reconcileCommittedServiceRoleShadowRunsV1).toBeNull();

      const enabled = createUnifiedProductionRuntime({
        ...runtimeInput(),
        serviceRoleShadowRecoveryDb: {} as never,
        serviceRoleShadowPolicy: "service-role-shadow-100-plus-100-v1"
      });
      const startupSignal = new AbortController().signal;
      await enabled.reconcileCommittedServiceRoleShadowRunsV1!(startupSignal);
      expect(recoveryRecover).toHaveBeenCalledWith({ signal: startupSignal });
      expect(lifecycleRecover).not.toHaveBeenCalled();
      await enabled.runAnalysisCycle();
      expect(summarizeRun).toHaveBeenCalledWith({
        runId: "run-1",
        signal: expect.any(AbortSignal)
      });
      expect(recoverySummarizeRun).not.toHaveBeenCalled();
      expect(reconcileCheckpoint).not.toHaveBeenCalled();
    } finally {
      runCycle.mockRestore();
      create.mockRestore();
    }
  });
});
