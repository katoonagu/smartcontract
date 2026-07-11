import { describe, expect, it } from "vitest";
import {
  buildDirectHardEvidenceSnapshots,
  groupDirectPrincipalCounterparties,
  selectDirectPrincipalLookupAddresses
} from "../../src/forensics/directHardEvidence";
import type { ForensicRouteEdge, StablecoinRestrictionProfile } from "../../src/types";

const SUBJECT = "TSubject";

function edge(input: {
  id: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: bigint;
  txHash?: string;
  economicRole?: ForensicRouteEdge["economicRole"];
  economicProtocol?: ForensicRouteEdge["economicProtocol"];
}): ForensicRouteEdge {
  return {
    id: input.id,
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    amountRaw: input.amountRaw.toString(),
    txHash: input.txHash ?? input.id,
    timestamp: new Date(`2026-07-02T00:00:${input.id.padStart(2, "0")}.000Z`),
    method: "transfer",
    edgeType: "normal_transfer",
    ...(input.economicRole ? { economicRole: input.economicRole } : {}),
    ...(input.economicProtocol ? { economicProtocol: input.economicProtocol } : {})
  };
}

function restriction(address: string): StablecoinRestrictionProfile {
  return {
    subjectAddress: address,
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    tokenSymbol: "USDT",
    tokenStandard: "TRC20",
    decimals: 6,
    balanceRaw: "0",
    isBlacklisted: false,
    blacklistEventTxHash: null,
    blacklistEventTimestamp: null,
    blacklistEventBlock: null,
    checkedAt: "2026-07-02T00:00:00.000Z",
    evidenceStrength: "exact_contract_state",
    methods: {
      blacklist: "isBlackListed(address)",
      balance: "balanceOf(address)"
    }
  };
}

describe("direct hard evidence helper", () => {
  it("groups directed principal transfers with unique transaction counts and stable descending amount order", () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [
        edge({ id: "1", fromAddress: "TSame", toAddress: SUBJECT, amountRaw: 200_000000n, txHash: "tx-shared" }),
        edge({ id: "2", fromAddress: "TSame", toAddress: SUBJECT, amountRaw: 100_000000n, txHash: "tx-shared" }),
        edge({ id: "3", fromAddress: SUBJECT, toAddress: "TSame", amountRaw: 400_000000n }),
        edge({ id: "4", fromAddress: "TStableFirst", toAddress: SUBJECT, amountRaw: 150_000000n }),
        edge({ id: "5", fromAddress: "TStableSecond", toAddress: SUBJECT, amountRaw: 150_000000n })
      ]
    });

    expect(groups.map((group) => [group.direction, group.address, group.principalAmountRaw])).toEqual([
      ["outbound", "TSame", 400_000000n],
      ["inbound", "TSame", 300_000000n],
      ["inbound", "TStableFirst", 150_000000n],
      ["inbound", "TStableSecond", 150_000000n]
    ]);
    expect(groups[1]).toMatchObject({
      principalTxCount: 1,
      transferTxHashes: ["tx-shared"],
      directionalPrincipalShare: 0.5,
      shareSemantics: "exact"
    });
    expect(groups[0]).toMatchObject({
      directionalPrincipalShare: 1,
      shareSemantics: "exact"
    });
  });

  it("counts an exact repeated edge id once", () => {
    const repeated = edge({
      id: "10",
      fromAddress: "TRepeated",
      toAddress: SUBJECT,
      amountRaw: 125_000000n,
      txHash: "tx-repeated"
    });
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [repeated, { ...repeated }]
    });

    expect(groups[0]).toMatchObject({
      principalAmountRaw: 125_000000n,
      principalTxCount: 1,
      transferTxHashes: ["tx-repeated"]
    });
  });

  it("counts distinct movements in one transaction by edge id while keeping one transaction count", () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [
        edge({ id: "10", fromAddress: "TMulti", toAddress: SUBJECT, amountRaw: 125_000000n, txHash: "tx-multi" }),
        edge({ id: "11", fromAddress: "TMulti", toAddress: SUBJECT, amountRaw: 75_000000n, txHash: "tx-multi" })
      ]
    });

    expect(groups[0]).toMatchObject({
      principalAmountRaw: 200_000000n,
      principalTxCount: 1,
      transferTxHashes: ["tx-multi"]
    });
  });

  it("keeps distinct movements with empty edge ids instead of tuple-merging them", () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [
        edge({ id: "", fromAddress: "TNoId", toAddress: SUBJECT, amountRaw: 125_000000n, txHash: "tx-no-id" }),
        edge({ id: "", fromAddress: "TNoId", toAddress: SUBJECT, amountRaw: 75_000000n, txHash: "tx-no-id" })
      ]
    });

    expect(groups[0]).toMatchObject({ principalAmountRaw: 200_000000n, principalTxCount: 1 });
  });

  it("applies exact absolute and complete-directional-share materiality boundaries", () => {
    const partialBelow = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "partial",
      edges: [edge({ id: "1", fromAddress: "TBelow", toAddress: SUBJECT, amountRaw: 9_999_999000n })]
    });
    const partialAt = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "partial",
      edges: [edge({ id: "2", fromAddress: "TAt", toAddress: SUBJECT, amountRaw: 10_000_000000n })]
    });
    const amountBoundary = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [
        edge({ id: "3", fromAddress: "T99", toAddress: SUBJECT, amountRaw: 99_999000n }),
        edge({ id: "4", fromAddress: "T100", toAddress: SUBJECT, amountRaw: 100_000000n }),
        edge({ id: "5", fromAddress: "TRemainder", toAddress: SUBJECT, amountRaw: 800_001000n })
      ]
    });
    const shareBelow = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [
        edge({ id: "6", fromAddress: "TShareBelow", toAddress: SUBJECT, amountRaw: 999_000000n }),
        edge({ id: "7", fromAddress: "TRemainder", toAddress: SUBJECT, amountRaw: 99_001_000000n })
      ]
    });
    const shareAt = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [
        edge({ id: "8", fromAddress: "TShareAt", toAddress: SUBJECT, amountRaw: 1_000_000000n }),
        edge({ id: "9", fromAddress: "TRemainder", toAddress: SUBJECT, amountRaw: 99_000_000000n })
      ]
    });

    expect(partialBelow[0]).toMatchObject({
      principalAmountRaw: 9_999_999000n,
      directionalPrincipalShare: null,
      shareSemantics: "unavailable",
      material: false
    });
    expect(partialAt[0]).toMatchObject({ principalAmountRaw: 10_000_000000n, material: true });
    expect(amountBoundary.find((group) => group.address === "T99")?.material).toBe(false);
    expect(amountBoundary.find((group) => group.address === "T100")?.material).toBe(true);
    expect(shareBelow.find((group) => group.address === "TShareBelow")).toMatchObject({
      directionalPrincipalShare: 0.00999,
      material: false
    });
    expect(shareAt.find((group) => group.address === "TShareAt")).toMatchObject({
      directionalPrincipalShare: 0.01,
      material: true
    });
  });

  it("excludes only structurally proven GasFree service fees and keeps GasFree principal", () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [
        edge({
          id: "1",
          fromAddress: "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm",
          toAddress: SUBJECT,
          amountRaw: 1_176_317_000000n,
          economicProtocol: "tron_gasfree",
          economicRole: "principal"
        }),
        edge({
          id: "2",
          fromAddress: SUBJECT,
          toAddress: "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird",
          amountRaw: 3_000000n,
          economicProtocol: "tron_gasfree",
          economicRole: "service_fee"
        })
      ]
    });

    expect(groups[0]).toMatchObject({
      address: "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm",
      principalAmountRaw: 1_176_317_000000n,
      material: true
    });
    expect(groups.some((group) => group.principalAmountRaw === 3_000000n)).toBe(false);
  });

  it("selects unique material lookup addresses by combined directed principal before applying the live limit", () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [
        edge({ id: "1", fromAddress: "TBoth", toAddress: SUBJECT, amountRaw: 6_000_000000n }),
        edge({ id: "2", fromAddress: SUBJECT, toAddress: "TBoth", amountRaw: 5_000_000000n }),
        edge({ id: "3", fromAddress: "TSingle", toAddress: SUBJECT, amountRaw: 10_500_000000n }),
        edge({ id: "4", fromAddress: "TStableFirst", toAddress: SUBJECT, amountRaw: 10_000_000000n }),
        edge({ id: "5", fromAddress: "TStableSecond", toAddress: SUBJECT, amountRaw: 10_000_000000n })
      ]
    });

    expect(selectDirectPrincipalLookupAddresses(groups, 3)).toEqual([
      "TBoth",
      "TSingle",
      "TStableFirst"
    ]);
  });

  it("sorts material lookup addresses by principal combined across material and non-material directions", () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "partial",
      edges: [
        edge({ id: "1", fromAddress: "TBoth", toAddress: SUBJECT, amountRaw: 10_000_000000n }),
        edge({ id: "2", fromAddress: SUBJECT, toAddress: "TBoth", amountRaw: 9_000_000000n }),
        edge({ id: "3", fromAddress: "TMaterialOnly", toAddress: SUBJECT, amountRaw: 15_000_000000n })
      ]
    });

    expect(groups.find((group) => group.direction === "outbound")?.material).toBe(false);
    expect(selectDirectPrincipalLookupAddresses(groups, 2)).toEqual(["TBoth", "TMaterialOnly"]);
  });

  it("preserves case-significant TRON addresses when grouping, matching the subject, and selecting lookups", () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "partial",
      edges: [
        edge({ id: "1", fromAddress: "TCase", toAddress: SUBJECT, amountRaw: 10_000_000000n }),
        edge({ id: "2", fromAddress: "Tcase", toAddress: SUBJECT, amountRaw: 11_000_000000n }),
        edge({ id: "3", fromAddress: "Tsubject", toAddress: "TUnrelated", amountRaw: 20_000_000000n })
      ]
    });

    expect(groups.map((group) => group.address)).toEqual(["Tcase", "TCase"]);
    expect(selectDirectPrincipalLookupAddresses(groups, 2)).toEqual(["Tcase", "TCase"]);
  });

  it("excludes subject self-transfers from groups and lookup candidates", () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [edge({ id: "1", fromAddress: SUBJECT, toAddress: SUBJECT, amountRaw: 10_000_000000n })]
    });

    expect(groups).toEqual([]);
    expect(selectDirectPrincipalLookupAddresses(groups, 1)).toEqual([]);
  });

  it("uses canonical address and direction tie breakers independent of edge input order", () => {
    const edges = [
      edge({ id: "1", fromAddress: "TBravo", toAddress: SUBJECT, amountRaw: 10_000_000000n }),
      edge({ id: "2", fromAddress: SUBJECT, toAddress: "TSame", amountRaw: 10_000_000000n }),
      edge({ id: "3", fromAddress: "TSame", toAddress: SUBJECT, amountRaw: 10_000_000000n }),
      edge({ id: "4", fromAddress: "TAlpha", toAddress: SUBJECT, amountRaw: 10_000_000000n })
    ];
    const expected = [
      ["TAlpha", "inbound"],
      ["TBravo", "inbound"],
      ["TSame", "inbound"],
      ["TSame", "outbound"]
    ];

    for (const permutation of [edges, [...edges].reverse()]) {
      const groups = groupDirectPrincipalCounterparties({
        subjectAddress: SUBJECT,
        directTransferCoverage: "complete",
        edges: permutation
      });
      expect(groups.map((group) => [group.address, group.direction])).toEqual(expected);
    }
  });

  it("uses an address tie breaker before liveLimit independent of group input order", () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "partial",
      edges: [
        edge({ id: "1", fromAddress: "TBravo", toAddress: SUBJECT, amountRaw: 10_000_000000n }),
        edge({ id: "2", fromAddress: "TAlpha", toAddress: SUBJECT, amountRaw: 10_000_000000n })
      ]
    });

    expect(selectDirectPrincipalLookupAddresses(groups, 1)).toEqual(["TAlpha"]);
    expect(selectDirectPrincipalLookupAddresses([...groups].reverse(), 1)).toEqual(["TAlpha"]);
  });

  it("runs live checks with bounded concurrency and liveLimit", async () => {
    let active = 0;
    let maxActive = 0;
    const checked: string[] = [];

    const result = await buildDirectHardEvidenceSnapshots({
      addresses: Array.from({ length: 8 }, (_, index) => `TDirect${index}`),
      liveLimit: 5,
      concurrency: 2,
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        checked.push(address);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return restriction(address);
      }
    });

    expect(checked).toHaveLength(5);
    expect(result.liveCheckedCount).toBe(5);
    expect(result.checkedCount).toBe(8);
    expect(result.status).toBe("live_budget_exhausted");
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("does not report complete when a live blacklist lookup fails", async () => {
    const result = await buildDirectHardEvidenceSnapshots({
      addresses: ["TDirect0", "TDirect1"],
      liveLimit: 2,
      concurrency: 2,
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => {
        if (address === "TDirect1") throw new Error("429");
        return restriction(address);
      }
    });

    expect(result.status).toBe("local_only_partial");
    expect(result.liveCheckedCount).toBe(1);
    expect(result.liveFailedCount).toBe(1);
    expect(result.missingChecks[0]).toContain("TDirect1");
  });
});
