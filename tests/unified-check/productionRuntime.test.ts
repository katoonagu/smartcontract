import { describe, expect, it, vi } from "vitest";
import {
  createUnifiedProductionRuntime
} from "../../src/unifiedCheck/productionRuntime";
import * as shadowRuntimeModule from "../../src/unifiedCheck/serviceRoleShadowRuntime";

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

      createUnifiedProductionRuntime({
        ...runtimeInput(),
        serviceRoleShadowPolicy: "service-role-shadow-100-plus-100-v1"
      });
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith({
        db: enabledInput.db,
        runtimeCommit: "candidate"
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
});
