import { describe, expect, it } from "vitest";
import {
  createUnifiedProductionRuntime
} from "../../src/unifiedCheck/productionRuntime";

describe("Unified production runtime configuration", () => {
  it("rejects a commit ceiling below the manifest ceiling", () => {
    expect(() => createUnifiedProductionRuntime({
      db: {} as never,
      runtimeCommit: "candidate",
      providerConfigurationSha256: "a".repeat(64),
      manifestMaxBytes: 2_048,
      commitMaxBytes: 1_024,
      loadProviderPage: async () => {
        throw new Error("unused");
      },
      loadCounterpartyLabels: async () => new Map(),
      loadFrozenLabelDataset: async () => {
        throw new Error("unused");
      },
      loadHardEvidence: async () => ({})
    })).toThrow("unified_production_commit_max_bytes_too_small");
  });
});
