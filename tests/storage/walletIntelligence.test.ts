import { describe, expect, it } from "vitest";
import {
  type WalletIntelligenceAddressSummary,
  type WalletIntelligenceRunInput,
  type WalletIntelligenceSightingInput,
  type WalletIntelligenceEdgeInput
} from "../../src/storage/repositories";

describe("wallet intelligence repository types", () => {
  it("exposes neutral wallet intelligence input and summary shapes", () => {
    const run: WalletIntelligenceRunInput = {
      jobId: "job-1",
      jobKind: "address_deep_check",
      jobStatus: "completed",
      subjectAddress: "TSubject111111111111111111111111111111",
      requestedBy: "42",
      chatId: "42",
      messageId: "77",
      completedAt: new Date("2026-07-06T10:00:00.000Z"),
      telegramUserId: "42",
      telegramUsername: "client_user",
      telegramLocale: "ru",
      sourcePayloadHash: "hash-1",
      indexVersion: 1,
      indexStatus: "indexed",
      indexError: null
    };
    const sighting: WalletIntelligenceSightingInput = {
      id: "sighting-1",
      address: "TSeen1111111111111111111111111111111",
      jobId: "job-1",
      jobKind: "address_deep_check",
      subjectAddress: "TSubject111111111111111111111111111111",
      requestedBy: "42",
      sourceKind: "deep_direct_counterparty",
      role: "direct_counterparty",
      depth: 1,
      pathId: "deep:direct:0",
      txHash: "tx-1",
      amountRaw: "1000000",
      firstSeenAt: new Date("2026-07-06T09:00:00.000Z"),
      lastSeenAt: new Date("2026-07-06T09:00:00.000Z"),
      metadataJson: { direction: "inbound" }
    };
    const edge: WalletIntelligenceEdgeInput = {
      id: "edge-1",
      fromAddress: "TSeen1111111111111111111111111111111",
      toAddress: "TSubject111111111111111111111111111111",
      jobId: "job-1",
      jobKind: "address_deep_check",
      sourceKind: "deep_direct_counterparty",
      depth: 1,
      pathId: "deep:direct:0",
      txHash: "tx-1",
      amountRaw: "1000000",
      timestamp: new Date("2026-07-06T09:00:00.000Z"),
      edgeRole: "transfer",
      metadataJson: {}
    };
    const summary: WalletIntelligenceAddressSummary = {
      address: sighting.address,
      uniqueSubjectCount: 2,
      uniqueRequesterCount: 2,
      jobCount: 3,
      completedJobCount: 2,
      partialJobCount: 1,
      occurrenceCount: 4,
      distinctTxCount: 1,
      distinctAmountRaw: "1000000",
      minDepth: 1,
      maxDepth: 2,
      firstSeenAt: new Date("2026-07-06T09:00:00.000Z"),
      lastSeenAt: new Date("2026-07-06T10:00:00.000Z"),
      modes: ["address_deep_check"],
      tags: ["repeated_cross_run_address"],
      serviceCategories: [],
      labelHints: []
    };

    expect(run.indexStatus).toBe("indexed");
    expect(sighting.role).toBe("direct_counterparty");
    expect(edge.edgeRole).toBe("transfer");
    expect(summary.distinctAmountRaw).toBe("1000000");
    expect(summary.tags).not.toContain("risk");
  });
});
