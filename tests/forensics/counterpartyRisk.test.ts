import { describe, expect, it } from "vitest";
import { buildCounterpartyRiskProfiles } from "../../src/forensics/counterpartyRisk";
import type { ForensicRouteEdge, ServiceClassification } from "../../src/types";

describe("counterparty risk profiles", () => {
  it("does not emit service-boundary context for a non-boundary contract", () => {
    const subjectAddress = "TSubject111111111111111111111111111";
    const contractAddress = "TGasFree111111111111111111111111111";
    const edge: ForensicRouteEdge = {
      id: "tx-direct",
      txHash: "tx-direct",
      fromAddress: subjectAddress,
      toAddress: contractAddress,
      amountRaw: "1000000000",
      timestamp: new Date("2026-07-10T00:00:00.000Z"),
      method: "transfer",
      edgeType: "normal_transfer"
    };
    const classification: ServiceClassification = {
      category: "service",
      identity: "GasFree Account",
      confidence: "high",
      evidence: ["test:gasfree_account"],
      isBoundary: false
    };
    const profiles = buildCounterpartyRiskProfiles({
      subjectAddress,
      edges: [edge],
      labelsByAddress: new Map(),
      classifications: new Map([[contractAddress, classification]])
    });

    expect(profiles).toEqual([]);
  });
});
