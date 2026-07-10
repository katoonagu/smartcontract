import { describe, expect, it } from "vitest";
import { buildCounterpartyRiskProfiles } from "../../src/forensics/counterpartyRisk";
import type { AddressLabel, ForensicRouteEdge, ServiceClassification } from "../../src/types";

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

    const highRiskLabel: AddressLabel = {
      address: contractAddress,
      label: "darknet_exchange",
      source: "system",
      createdByTelegramId: null,
      createdAt: new Date("2026-07-10T00:00:00.000Z")
    };
    const labeledProfiles = buildCounterpartyRiskProfiles({
      subjectAddress,
      edges: [edge],
      labelsByAddress: new Map([[contractAddress, [highRiskLabel]]]),
      classifications: new Map([[contractAddress, classification]])
    });
    const profile = labeledProfiles[0];

    expect(profile?.score).toBeGreaterThan(0);
    expect(profile?.serviceCategory).toBeNull();
    expect(profile?.features.map((feature) => feature.code)).toContain("counterparty_direct_darknet_exchange");
    expect(profile?.features.map((feature) => feature.code)).not.toContain("counterparty_service_boundary_context");
  });

  it("excludes exact GasFree fees while keeping principal counterparty risk", () => {
    const subjectAddress = "TSubjectGasFreeRisk1111111111111111";
    const tlnt = "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird";
    const principalPeer = "TPrincipalRisk111111111111111111111";
    const at = new Date("2026-07-10T00:00:00.000Z");
    const riskyLabel = (address: string): AddressLabel => ({
      address,
      label: "darknet_exchange",
      source: "system",
      createdByTelegramId: null,
      createdAt: at
    });
    const profiles = buildCounterpartyRiskProfiles({
      subjectAddress,
      edges: [
        {
          id: "fee",
          txHash: "fee",
          fromAddress: subjectAddress,
          toAddress: tlnt,
          amountRaw: "3000000",
          timestamp: at,
          method: "permitTransfer",
          edgeType: "transfer_from",
          economicRole: "service_fee",
          economicProtocol: "tron_gasfree"
        },
        {
          id: "principal",
          txHash: "principal",
          fromAddress: subjectAddress,
          toAddress: principalPeer,
          amountRaw: "97000000",
          timestamp: at,
          method: "permitTransfer",
          edgeType: "transfer_from",
          economicRole: "principal",
          economicProtocol: "tron_gasfree"
        }
      ],
      labelsByAddress: new Map([
        [tlnt, [riskyLabel(tlnt)]],
        [principalPeer, [riskyLabel(principalPeer)]]
      ]),
      minMeaningfulRaw: 1n,
      minMeaningfulRatio: 0,
      absoluteMeaningfulRaw: 1n
    });

    expect(profiles.some((profile) => profile.counterpartyAddress === tlnt)).toBe(false);
    expect(profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ counterpartyAddress: principalPeer, amountRaw: "97000000", score: 80 })
    ]));
  });
});
