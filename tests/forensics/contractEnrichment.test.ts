import { describe, expect, it, vi } from "vitest";
import type { ContractRiskContext } from "../../src/approvals/contractIntelligence";
import {
  enrichContractClassification,
  type EnrichContractClassificationInput
} from "../../src/forensics/contractEnrichment";
import type { ServiceAddressMetadata } from "../../src/forensics/serviceClassifier";

function buildInput(
  overrides: Partial<EnrichContractClassificationInput>
): EnrichContractClassificationInput {
  return {
    address: "TContract111111111111111111111111111",
    getMetadata: vi.fn(async () => null),
    getCachedProfile: vi.fn(async () => null),
    fetchLiveProfile: vi.fn(async () => null),
    upsertProfile: vi.fn(async () => undefined),
    now: () => new Date("2026-05-30T00:00:00.000Z"),
    ...overrides
  };
}

describe("contract classification enrichment", () => {
  it("fetches live profile when cached profile is missing and reclassifies GasFree", async () => {
    const metadata: ServiceAddressMetadata = {
      address: "TGasFree1111111111111111111111111111",
      name: "CreatedByContract",
      tag: null,
      isContract: true,
      verified: false
    };
    const liveProfile: ContractRiskContext = {
      providerTags: [{ kind: "greyTag", label: "GasFree Account", url: null }],
      verified: false,
      providerRisk: false,
      methodMap: {
        a1b2c3d4: "permitTransfer(address,address,uint256,uint256,bytes)"
      },
      topMethods: []
    };
    const upsertProfile = vi.fn(async () => undefined);

    const result = await enrichContractClassification(buildInput({
      address: metadata.address,
      getMetadata: vi.fn(async () => metadata),
      fetchLiveProfile: vi.fn(async () => liveProfile),
      upsertProfile
    }));

    expect(result.classification.category).toBe("service");
    expect(result.classification.identity).toContain("GasFree");
    expect(result.profileSource).toBe("live");
    expect(result.liveFetchError).toBeNull();
    expect(upsertProfile).toHaveBeenCalledTimes(1);
    expect(upsertProfile).toHaveBeenCalledWith(liveProfile);
  });

  it("does not call live fetch when cached or metadata classification already resolves a protocol", async () => {
    const metadata: ServiceAddressMetadata = {
      address: "TUSDDPsm111111111111111111111111111",
      name: null,
      tag: "USDD: PSM GemJoin (USDT)",
      isContract: true,
      verified: true
    };
    const fetchLiveProfile = vi.fn(async () => null);

    const result = await enrichContractClassification(buildInput({
      address: metadata.address,
      getMetadata: vi.fn(async () => metadata),
      fetchLiveProfile
    }));

    expect(result.classification.category).toBe("protocol");
    expect(result.profileSource).toBe("none");
    expect(fetchLiveProfile).not.toHaveBeenCalled();
  });

  it("returns cached classification and liveFetchError when live fetch fails", async () => {
    const metadata: ServiceAddressMetadata = {
      address: "TUnknownContract111111111111111111111",
      name: "CreatedByContract",
      tag: null,
      isContract: true,
      verified: false
    };
    const fetchLiveProfile = vi.fn(async () => {
      throw new Error("tronscan timeout");
    });

    const result = await enrichContractClassification(buildInput({
      address: metadata.address,
      getMetadata: vi.fn(async () => metadata),
      fetchLiveProfile
    }));

    expect(result.classification.category).toBe("unknown_contract");
    expect(result.profileSource).toBe("none");
    expect(result.liveFetchError).toBe("tronscan timeout");
  });
});
