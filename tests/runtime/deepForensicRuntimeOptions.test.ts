import { describe, expect, it } from "vitest";
import { deepForensicRuntimeOptions } from "../../src/runtime/deepForensicRuntimeOptions";

describe("deepForensicRuntimeOptions", () => {
  it("returns expanded production limits and forwards runtime config", () => {
    const options = deepForensicRuntimeOptions({
      tronscanPageLimit: 97,
      crossChainStage2Enabled: true,
      crossChainStage2MaxProviderCalls: 7
    }, false);

    expect(options).toEqual({
      pageLimit: 97,
      maxPagesPerAddress: 3,
      maxExpandedIntermediates: 30,
      metadataFetchLimit: 30,
      contractProfileFetchLimit: 15,
      maxInboundSenders: 15,
      maxApprovalDrainCandidates: 15,
      approvalChangeLookupLimit: 20,
      extendedSearchMode: "always",
      extendedSearchMaxDepth: 6,
      extendedSearchBeamWidth: 12,
      extendedSearchMaxAddressFetches: 150,
      recentFallbackMinTransferCount: 150,
      recentFallbackTransferLimit: 200,
      counterpartyFastSnapshotLimit: 60,
      counterpartyFastSnapshotActiveLimit: 30,
      crossChainStage2Enabled: true,
      crossChainMaxProviderCalls: 7,
      apiKeyConfigured: false
    });
  });
});
