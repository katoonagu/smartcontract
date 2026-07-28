import { describe, expect, it } from "vitest";
import {
  buildDirectHardEvidenceSnapshots,
  groupDirectPrincipalCounterparties,
  selectDirectPrincipalLookupAddresses
} from "../../src/forensics/directHardEvidence";
import * as directHardEvidence from "../../src/forensics/directHardEvidence";
import { normalizePersistedDeepFirstHopEvidence } from "../../src/check/deepForensicCheck";
import type {
  ForensicRouteEdge,
  TimelineBearingStablecoinRestrictionProfile,
  UsdtBlacklistTimeline
} from "../../src/types";

const SUBJECT = "TSubject";

function edge(input: {
  id: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: bigint;
  txHash?: string;
  economicRole?: ForensicRouteEdge["economicRole"];
  economicProtocol?: ForensicRouteEdge["economicProtocol"];
  timestamp?: Date;
}): ForensicRouteEdge {
  return {
    id: input.id,
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    amountRaw: input.amountRaw.toString(),
    txHash: input.txHash ?? input.id,
    timestamp: input.timestamp ?? new Date(`2026-07-02T00:00:${input.id.padStart(2, "0")}.000Z`),
    method: "transfer",
    edgeType: "normal_transfer",
    ...(input.economicRole ? { economicRole: input.economicRole } : {}),
    ...(input.economicProtocol ? { economicProtocol: input.economicProtocol } : {})
  };
}

function restriction(
  address: string,
  overrides: Partial<TimelineBearingStablecoinRestrictionProfile> = {}
): TimelineBearingStablecoinRestrictionProfile {
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
    },
    ...overrides
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
      directionalPrincipalTotalRaw: 600_000000n,
      directionalPrincipalShare: 0.5,
      shareSemantics: "exact"
    });
    expect(groups[0]).toMatchObject({
      directionalPrincipalTotalRaw: 400_000000n,
      directionalPrincipalShare: 1,
      shareSemantics: "exact"
    });
  });

  it("exports one exact share helper and a pure blacklist-timeline partition", () => {
    expect(directHardEvidence.exactEightDecimalShare(1n, 3n)).toBe(0.33333333);
    const event = {
      eventKind: "added" as const,
      occurredAt: "2026-07-02T00:00:00.000Z",
      txHash: "b".repeat(64),
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      blockNumber: 100,
      logIndex: 1,
      verification: "verified_contract_log" as const
    };
    const result = directHardEvidence.partitionPrincipalTransfersByBlacklistTimeline({
      principalTransfers: [{
        txHash: "a".repeat(64),
        amountRaw: 5_000_000000n,
        occurredAt: "2026-07-01T00:00:00.000Z"
      }, {
        txHash: "c".repeat(64),
        amountRaw: 10_000_000000n,
        occurredAt: "2026-07-03T00:00:00.000Z"
      }],
      timeline: { events: [event], pagination: "complete", failureReason: null },
      conflictingTxHashes: new Set<string>()
    });

    expect(result).toEqual({
      before: { amountRaw: 5_000_000000n, txHashes: ["a".repeat(64)] },
      active: { amountRaw: 10_000_000000n, txHashes: ["c".repeat(64)] },
      unknown: { amountRaw: 0n, txHashes: [] },
      temporalRelation: "mixed"
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
      windowStart: new Date("2026-07-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-03T00:00:00.000Z"),
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
      windowStart: new Date("2026-07-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-03T00:00:00.000Z"),
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

  it("marks a required final first-hop check provider_failed when no restriction provider exists", async () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "partial",
      edges: [edge({ id: "1", fromAddress: "TNoProvider", toAddress: SUBJECT, amountRaw: 10_000_000000n })]
    });
    const result = await buildDirectHardEvidenceSnapshots({
      addresses: [],
      principalGroups: groups,
      directTransferCoverage: "partial",
      windowStart: new Date("2026-07-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-03T00:00:00.000Z"),
      requiredForDecision: true,
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null
    });

    expect(result.firstHopBlacklistCoverage).toMatchObject({
      requiredForDecision: true,
      blacklistCheckCoverage: "provider_failed",
      incompleteReason: expect.stringMatching(/provider.*not available/i)
    });
  });

  it("filters invalid timeline events and canonically sorts snapshot labels and reasons", async () => {
    const address = "TCanonicalSnapshot";
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [edge({
        id: "1",
        fromAddress: address,
        toAddress: SUBJECT,
        amountRaw: 10_000_000000n,
        timestamp: new Date("2026-07-03T00:00:00.000Z")
      })]
    });
    const validEvent = {
      eventKind: "added" as const,
      occurredAt: "2026-07-02T00:00:00.000Z",
      txHash: "b".repeat(64),
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      blockNumber: 100,
      logIndex: 1,
      verification: "verified_contract_log" as const
    };
    const result = await buildDirectHardEvidenceSnapshots({
      addresses: [],
      principalGroups: groups,
      directTransferCoverage: "complete",
      getLabelsForAddress: async () => [{
        address,
        label: "victim",
        source: "system",
        createdByTelegramId: null,
        createdAt: new Date("2026-07-02T00:00:00.000Z")
      }, {
        address,
        label: "phishing",
        source: "service_admin",
        createdByTelegramId: "1",
        createdAt: new Date("2026-07-01T00:00:00.000Z")
      }],
      getClassificationForAddress: async () => ({
        category: "cex",
        identity: null,
        confidence: "high",
        evidence: ["fixture"],
        isBoundary: true
      }),
      getUsdtRestrictionStatus: async () => restriction(address, {
        isBlacklisted: true,
        blacklistTimeline: {
          events: [
            { ...validEvent, occurredAt: "not-a-date" },
            { ...validEvent, occurredAt: "2026-07-02T00:00:00Z" },
            { ...validEvent, txHash: "valid-event" },
            { ...validEvent, eventKind: "paused" as never },
            { ...validEvent, blockNumber: Number.MAX_SAFE_INTEGER + 1 },
            { ...validEvent, tokenContract: "TWrongContract" },
            validEvent
          ],
          pagination: "complete",
          failureReason: null
        }
      })
    });

    expect(result.blacklistFacts[0]).toMatchObject({
      effectiveAt: validEvent.occurredAt,
      effectiveTxHash: validEvent.txHash,
      timelineCoverage: "partial",
      timelineEvents: [validEvent]
    });
    expect(result.snapshots[0].labels.map((item) => item.label)).toEqual(["phishing", "victim"]);
    expect(result.snapshots[0].reasons).toEqual([
      "label:phishing",
      "label:victim",
      "service:cex",
      "usdt_blacklist"
    ]);
  });

  it("survives producer JSON persistence through the shared first-hop decoder", async () => {
    const address = "TRoundTripEvidence";
    const directTxHash = "a".repeat(64);
    const event = {
      eventKind: "added" as const,
      occurredAt: "2026-07-02T00:00:00.000Z",
      txHash: "b".repeat(64),
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      blockNumber: 100,
      logIndex: 1,
      verification: "verified_contract_log" as const
    };
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [edge({
        id: "1",
        fromAddress: address,
        toAddress: SUBJECT,
        amountRaw: 10_000_000000n,
        txHash: directTxHash,
        timestamp: new Date("2026-07-03T00:00:00.000Z")
      })]
    });
    const produced = await buildDirectHardEvidenceSnapshots({
      addresses: [],
      principalGroups: groups,
      directTransferCoverage: "complete",
      getLabelsForAddress: async () => [{
        address,
        label: "phishing",
        source: "service_admin",
        createdByTelegramId: "1",
        createdAt: new Date("2026-07-01T00:00:00.000Z")
      }],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async () => restriction(address, {
        isBlacklisted: true,
        blacklistEventTimestamp: event.occurredAt,
        blacklistEventTxHash: event.txHash,
        blacklistEventBlock: event.blockNumber,
        blacklistTimeline: { events: [event], pagination: "complete", failureReason: null }
      })
    });
    const persisted = JSON.parse(JSON.stringify({
      firstHopBlacklistFacts: produced.blacklistFacts,
      firstHopLabelFacts: produced.labelFacts,
      firstHopBlacklistCoverage: produced.firstHopBlacklistCoverage,
      directHardEvidenceSnapshots: produced.snapshots
    })) as Record<string, unknown>;

    expect(normalizePersistedDeepFirstHopEvidence(persisted)).toEqual({
      firstHopBlacklistFacts: produced.blacklistFacts,
      firstHopLabelFacts: produced.labelFacts,
      firstHopBlacklistCoverage: produced.firstHopBlacklistCoverage,
      directHardEvidenceSnapshots: produced.snapshots
    });
  });

  it("applies liveLimit after combining material and non-material directions for each address", async () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "partial",
      edges: [
        edge({ id: "1", fromAddress: "TBoth", toAddress: SUBJECT, amountRaw: 10_000_000000n }),
        edge({ id: "2", fromAddress: SUBJECT, toAddress: "TBoth", amountRaw: 9_000_000000n }),
        edge({ id: "3", fromAddress: "TSingle", toAddress: SUBJECT, amountRaw: 15_000_000000n })
      ]
    });
    const checked: string[] = [];
    const result = await buildDirectHardEvidenceSnapshots({
      addresses: [],
      principalGroups: groups,
      directTransferCoverage: "partial",
      windowStart: new Date("2026-07-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-03T00:00:00.000Z"),
      liveLimit: 1,
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => {
        checked.push(address);
        return restriction(address);
      }
    });

    expect(checked).toEqual(["TBoth"]);
    expect(result.firstHopBlacklistCoverage).toMatchObject({
      materialCounterpartyCount: 2,
      checkedMaterialCounterpartyCount: 1,
      uncheckedMaterialCounterpartyCount: 1,
      blacklistCheckCoverage: "budget_exhausted"
    });
  });

  it("rejects complete coverage when any directed group lacks an exact share", async () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "partial",
      edges: [edge({ id: "1", fromAddress: "TUnavailableShare", toAddress: SUBJECT, amountRaw: 10_000_000000n })]
    });
    await expect(buildDirectHardEvidenceSnapshots({
      addresses: [],
      principalGroups: groups,
      directTransferCoverage: "complete",
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => restriction(address)
    })).rejects.toThrow(/share|coverage/i);
  });

  it("rejects partial coverage when a directed group exposes an exact share", async () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [edge({ id: "1", fromAddress: "TExactShare", toAddress: SUBJECT, amountRaw: 10_000_000000n })]
    });
    await expect(buildDirectHardEvidenceSnapshots({
      addresses: [],
      principalGroups: groups,
      directTransferCoverage: "partial",
      windowStart: new Date("2026-07-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-03T00:00:00.000Z"),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => restriction(address)
    })).rejects.toThrow(/share|coverage/i);
  });

  it("persists directed blacklist facts with exact chronology partitions", async () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [
        edge({ id: "1", fromAddress: "TActive", toAddress: SUBJECT, amountRaw: 10_000_000000n, timestamp: new Date("2026-07-02T12:00:00.000Z") }),
        edge({ id: "2", fromAddress: SUBJECT, toAddress: "TAfter", amountRaw: 11_000_000000n, timestamp: new Date("2026-07-01T12:00:00.000Z") }),
        edge({ id: "3", fromAddress: "TMixed", toAddress: SUBJECT, amountRaw: 6_000_000000n, timestamp: new Date("2026-07-01T12:00:00.000Z") }),
        edge({ id: "4", fromAddress: "TMixed", toAddress: SUBJECT, amountRaw: 6_000_000000n, timestamp: new Date("2026-07-03T12:00:00.000Z") }),
        edge({ id: "5", fromAddress: "TUnknown", toAddress: SUBJECT, amountRaw: 12_000_000000n, timestamp: new Date("2026-07-02T00:00:00.000Z") })
      ]
    });
    const added = {
      eventKind: "added" as const,
      occurredAt: "2026-07-02T00:00:00.000Z",
      txHash: "c".repeat(64),
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      blockNumber: 100,
      logIndex: 1,
      verification: "verified_contract_log" as const
    };

    const result = await buildDirectHardEvidenceSnapshots({
      addresses: groups.map((group) => group.address),
      principalGroups: groups,
      directTransferCoverage: "complete",
      liveLimit: 10,
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address, options) => {
        expect(options).toEqual({ includeEventTimeline: true });
        return restriction(address, {
          isBlacklisted: true,
          blacklistEventTimestamp: added.occurredAt,
          blacklistEventTxHash: added.txHash,
          blacklistTimeline: { events: [added], pagination: "complete", failureReason: null }
        }) as never;
      }
    });

    expect(result.blacklistFacts.map((fact) => [fact.counterpartyAddress, fact.temporalRelation])).toEqual([
      ["TMixed", "mixed"],
      ["TUnknown", "unknown"],
      ["TAfter", "became_active_after"],
      ["TActive", "active_at_transfer"]
    ]);
    expect(result.blacklistFacts[0]).toMatchObject({
      evidenceKind: "usdt_blacklist",
      evidenceAuthority: "official_contract",
      statusAtCheck: "active",
      effectiveAt: added.occurredAt,
      effectiveTxHash: added.txHash,
      checkedAt: "2026-07-02T00:00:00.000Z",
      principalAmountRaw: "12000000000",
      principalTxCount: 2,
      directionalPrincipalTotalRaw: "34000000000",
      beforeEffectiveAmountRaw: "6000000000",
      beforeEffectiveTxCount: 1,
      activeAmountRaw: "6000000000",
      activeTxCount: 1,
      unknownTimingAmountRaw: "0",
      unknownTimingTxCount: 0,
      directTransferCoverage: "complete",
      timelineCoverage: "complete",
      timelineEvents: [added]
    });
    expect(result.blacklistFacts[1]).toMatchObject({
      beforeEffectiveAmountRaw: "0",
      activeAmountRaw: "0",
      unknownTimingAmountRaw: "12000000000",
      unknownTimingTxCount: 1
    });
    for (const fact of result.blacklistFacts) {
      expect(BigInt(fact.beforeEffectiveAmountRaw) + BigInt(fact.activeAmountRaw) + BigInt(fact.unknownTimingAmountRaw))
        .toBe(BigInt(fact.principalAmountRaw));
      expect(fact.beforeEffectiveTxCount + fact.activeTxCount + fact.unknownTimingTxCount).toBe(fact.principalTxCount);
      expect(() => JSON.stringify(fact)).not.toThrow();
    }
    expect(result.firstHopBlacklistCoverage).toMatchObject({
      requiredForDecision: true,
      scope: "all_time",
      windowStart: null,
      windowEnd: null,
      directPrincipalTransferCoverage: "complete",
      materialCounterpartyCount: 4,
      checkedMaterialCounterpartyCount: 4,
      failedMaterialCounterpartyCount: 0,
      uncheckedMaterialCounterpartyCount: 0,
      blacklistCheckCoverage: "complete",
      incompleteReason: null,
      confirmedAdverseFactCount: 4,
      completeTimelineFactCount: 4,
      partialTimelineFactCount: 0
    });
  });

  it("keeps current active facts adverse with partial history and never promotes inactive or failed lookups", async () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "partial",
      edges: [
        edge({ id: "1", fromAddress: "TActive", toAddress: SUBJECT, amountRaw: 12_000_000000n }),
        edge({ id: "2", fromAddress: "TInactive", toAddress: SUBJECT, amountRaw: 11_000_000000n }),
        edge({ id: "3", fromAddress: "TFailed", toAddress: SUBJECT, amountRaw: 10_000_000000n })
      ]
    });
    const result = await buildDirectHardEvidenceSnapshots({
      addresses: groups.map((group) => group.address),
      principalGroups: groups,
      directTransferCoverage: "partial",
      windowStart: new Date("2026-07-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-04T00:00:00.000Z"),
      liveLimit: 3,
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => {
        if (address === "TFailed") throw new Error("provider down");
        return restriction(address, {
          isBlacklisted: address === "TActive",
          blacklistTimeline: address === "TActive"
            ? { events: [], pagination: "partial", failureReason: "provider_failed" }
            : null
        }) as never;
      }
    });

    expect(result.blacklistFacts).toHaveLength(1);
    expect(result.blacklistFacts[0]).toMatchObject({
      counterpartyAddress: "TActive",
      statusAtCheck: "active",
      temporalRelation: "unknown",
      timelineCoverage: "partial",
      unknownTimingAmountRaw: "12000000000",
      unknownTimingTxCount: 1
    });
    expect(result.blacklistFacts[0]).not.toHaveProperty("directionalPrincipalTotalRaw");
    expect(result.firstHopBlacklistCoverage).toMatchObject({
      scope: "checked_window",
      windowStart: "2026-07-01T00:00:00.000Z",
      windowEnd: "2026-07-04T00:00:00.000Z",
      directPrincipalTransferCoverage: "partial",
      materialCounterpartyCount: 3,
      checkedMaterialCounterpartyCount: 2,
      failedMaterialCounterpartyCount: 1,
      uncheckedMaterialCounterpartyCount: 0,
      blacklistCheckCoverage: "provider_failed",
      confirmedAdverseFactCount: 1,
      completeTimelineFactCount: 0,
      partialTimelineFactCount: 1
    });
  });

  it("persists typed internal labels without treating record time as effective time and dates sanctions by transfer", async () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [
        edge({ id: "1", fromAddress: "TLabelled", toAddress: SUBJECT, amountRaw: 10_000_000000n, timestamp: new Date("2026-05-20T00:00:00.000Z") }),
        edge({ id: "2", fromAddress: SUBJECT, toAddress: "TLabelled", amountRaw: 11_000_000000n, timestamp: new Date("2026-05-27T00:00:00.000Z") })
      ]
    });
    const result = await buildDirectHardEvidenceSnapshots({
      addresses: ["TLabelled"],
      principalGroups: [...groups].reverse(),
      directTransferCoverage: "complete",
      selectedProvenanceTxHashes: ["2"],
      liveLimit: 1,
      getLabelsForAddress: async () => [
        {
          address: "TLabelled",
          label: "approval_drain_proximity",
          source: "system",
          createdByTelegramId: null,
          createdAt: new Date("2026-06-01T00:00:00.000Z")
        },
        {
          address: "TLabelled",
          label: "reported_scam",
          source: "service_admin",
          createdByTelegramId: "42",
          createdAt: new Date("2026-06-02T00:00:00.000Z")
        }
      ],
      getClassificationForAddress: async () => ({
        category: "cex",
        identity: "HTX/Huobi Global",
        confidence: "high",
        evidence: ["sanctioned_service:htx_huobi"],
        isBoundary: true
      }),
      getUsdtRestrictionStatus: async (address) => restriction(address)
    });

    expect(result.labelFacts).toHaveLength(4);
    expect(result.labelFacts[0]).toMatchObject({
      direction: "outbound",
      labelCode: "approval_drain_proximity",
      evidenceAuthority: "derived",
      recordedAt: "2026-06-01T00:00:00.000Z",
      effectiveAt: null,
      linkedToSelectedProvenance: true
    });
    expect(result.labelFacts.find((fact) => fact.direction === "inbound" && fact.labelCode === "approval_drain_proximity"))
      .toMatchObject({ linkedToSelectedProvenance: false });
    expect(result.labelFacts.some((fact) =>
      fact.labelCode === "reported_scam" && fact.evidenceAuthority === "exact_internal"
    )).toBe(true);
    expect(result.snapshots[0].reasons).not.toContain("sanctioned_service:htx_huobi");

    const withoutSelection = await buildDirectHardEvidenceSnapshots({
      addresses: ["TLabelled"],
      principalGroups: groups,
      directTransferCoverage: "complete",
      getLabelsForAddress: async () => [{
        address: "TLabelled",
        label: "reported_scam",
        source: "service_admin",
        createdByTelegramId: "42",
        createdAt: new Date("2026-06-02T00:00:00.000Z")
      }],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => restriction(address)
    });
    expect(withoutSelection.labelFacts.every((fact) => fact.linkedToSelectedProvenance === false)).toBe(true);

    const preDesignationGroups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [edge({
        id: "9",
        fromAddress: "TPreDesignation",
        toAddress: SUBJECT,
        amountRaw: 10_000_000000n,
        timestamp: new Date("2026-05-20T00:00:00.000Z")
      })]
    });
    const preDesignation = await buildDirectHardEvidenceSnapshots({
      addresses: ["TPreDesignation"],
      principalGroups: preDesignationGroups,
      directTransferCoverage: "complete",
      selectedProvenanceTxHashes: ["9"],
      liveLimit: 1,
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => ({
        category: "cex",
        identity: "HTX/Huobi Global",
        confidence: "high",
        evidence: ["sanctioned_service:htx_huobi"],
        isBoundary: true
      }),
      getUsdtRestrictionStatus: async (address) => restriction(address)
    });
    expect(preDesignation.snapshots[0].reasons).not.toContain("sanctioned_service:htx_huobi");

    const postDesignationGroups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [edge({
        id: "10",
        fromAddress: "TPostDesignation",
        toAddress: SUBJECT,
        amountRaw: 10_000_000000n,
        txHash: "tx-selected-inbound",
        timestamp: new Date("2026-05-27T00:00:00.000Z")
      })]
    });
    const postDesignation = await buildDirectHardEvidenceSnapshots({
      addresses: ["TPostDesignation"],
      principalGroups: postDesignationGroups,
      directTransferCoverage: "complete",
      selectedProvenanceTxHashes: ["tx-selected-inbound"],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => ({
        category: "cex",
        identity: "HTX/Huobi Global",
        confidence: "high",
        evidence: ["sanctioned_service:htx_huobi"],
        isBoundary: true
      }),
      getUsdtRestrictionStatus: async (address) => restriction(address)
    });
    expect(postDesignation.snapshots[0].reasons).toContain("sanctioned_service:htx_huobi");
    expect(() => JSON.stringify(postDesignation)).not.toThrow();
  });

  it("distinguishes budget-limited unchecked unique addresses from checked clean addresses", async () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [
        edge({ id: "1", fromAddress: "TBoth", toAddress: SUBJECT, amountRaw: 10_000_000000n }),
        edge({ id: "2", fromAddress: SUBJECT, toAddress: "TBoth", amountRaw: 10_000_000000n }),
        edge({ id: "3", fromAddress: "TOther", toAddress: SUBJECT, amountRaw: 11_000_000000n })
      ]
    });
    const result = await buildDirectHardEvidenceSnapshots({
      addresses: ["TBoth", "TOther"],
      principalGroups: groups,
      directTransferCoverage: "complete",
      liveLimit: 1,
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => restriction(address)
    });

    expect(result.blacklistFacts).toEqual([]);
    expect(result.firstHopBlacklistCoverage).toMatchObject({
      materialCounterpartyCount: 2,
      checkedMaterialCounterpartyCount: 1,
      failedMaterialCounterpartyCount: 0,
      uncheckedMaterialCounterpartyCount: 1,
      blacklistCheckCoverage: "budget_exhausted"
    });
  });

  it("reports history_partial when an active fact has only a partial verified timeline", async () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [edge({ id: "1", fromAddress: "TPartialTimeline", toAddress: SUBJECT, amountRaw: 10_000_000000n })]
    });
    const result = await buildDirectHardEvidenceSnapshots({
      addresses: ["TPartialTimeline"],
      principalGroups: groups,
      directTransferCoverage: "complete",
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => restriction(address, {
        isBlacklisted: true,
        blacklistTimeline: { events: [], pagination: "partial", failureReason: "provider_failed" }
      })
    });

    expect(result.blacklistFacts[0].timelineCoverage).toBe("partial");
    expect(result.firstHopBlacklistCoverage).toMatchObject({
      blacklistCheckCoverage: "history_partial",
      completeTimelineFactCount: 0,
      partialTimelineFactCount: 1
    });
  });

  it("does not treat a timeline with a non-finite event timestamp as complete", async () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [edge({ id: "1", fromAddress: "TInvalidTimelineDate", toAddress: SUBJECT, amountRaw: 10_000_000000n })]
    });
    const result = await buildDirectHardEvidenceSnapshots({
      addresses: [],
      principalGroups: groups,
      directTransferCoverage: "complete",
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => restriction(address, {
        isBlacklisted: true,
        blacklistTimeline: {
          events: [{
            eventKind: "added",
            occurredAt: "not-a-date",
            txHash: "tx-invalid-date",
            tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
            blockNumber: 100,
            logIndex: 1,
            verification: "verified_contract_log"
          }],
          pagination: "complete",
          failureReason: null
        }
      })
    });

    expect(result.blacklistFacts[0]).toMatchObject({
      timelineCoverage: "partial",
      temporalRelation: "unknown",
      unknownTimingAmountRaw: "10000000000"
    });
    expect(result.firstHopBlacklistCoverage).toMatchObject({
      blacklistCheckCoverage: "history_partial",
      completeTimelineFactCount: 0,
      partialTimelineFactCount: 1
    });
  });

  it("assigns every movement in one transaction to unknown when its timestamps imply conflicting relations", async () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [
        edge({
          id: "1",
          fromAddress: "TConflictingTx",
          toAddress: SUBJECT,
          amountRaw: 6_000_000000n,
          txHash: "tx-conflicting-time",
          timestamp: new Date("2026-07-01T00:00:00.000Z")
        }),
        edge({
          id: "2",
          fromAddress: "TConflictingTx",
          toAddress: SUBJECT,
          amountRaw: 6_000_000000n,
          txHash: "tx-conflicting-time",
          timestamp: new Date("2026-07-03T00:00:00.000Z")
        })
      ]
    });
    const added = {
      eventKind: "added" as const,
      occurredAt: "2026-07-02T00:00:00.000Z",
      txHash: "d".repeat(64),
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      blockNumber: 100,
      logIndex: 1,
      verification: "verified_contract_log" as const
    };
    const result = await buildDirectHardEvidenceSnapshots({
      addresses: ["TConflictingTx"],
      principalGroups: groups,
      directTransferCoverage: "complete",
      windowStart: new Date("2026-07-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-03T00:00:00.000Z"),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => restriction(address, {
        isBlacklisted: true,
        blacklistTimeline: { events: [added], pagination: "complete", failureReason: null }
      })
    });

    expect(result.blacklistFacts[0]).toMatchObject({
      temporalRelation: "unknown",
      principalAmountRaw: "12000000000",
      principalTxCount: 1,
      beforeEffectiveAmountRaw: "0",
      beforeEffectiveTxCount: 0,
      activeAmountRaw: "0",
      activeTxCount: 0,
      unknownTimingAmountRaw: "12000000000",
      unknownTimingTxCount: 1
    });
    expect(result.firstHopBlacklistCoverage).toMatchObject({
      scope: "checked_window",
      directPrincipalTransferCoverage: "partial",
      blacklistCheckCoverage: "history_partial"
    });
  });

  it("degrades inactive clean coverage when one transaction has conflicting timestamps", async () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [
        edge({
          id: "1",
          fromAddress: "TInactiveConflict",
          toAddress: SUBJECT,
          amountRaw: 6_000_000000n,
          txHash: "tx-inactive-conflict",
          timestamp: new Date("2026-07-01T00:00:00.000Z")
        }),
        edge({
          id: "2",
          fromAddress: "TInactiveConflict",
          toAddress: SUBJECT,
          amountRaw: 6_000_000000n,
          txHash: "tx-inactive-conflict",
          timestamp: new Date("2026-07-03T00:00:00.000Z")
        })
      ]
    });
    const result = await buildDirectHardEvidenceSnapshots({
      addresses: ["TInactiveConflict"],
      principalGroups: groups,
      directTransferCoverage: "complete",
      windowStart: new Date("2026-07-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-03T00:00:00.000Z"),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => restriction(address, { isBlacklisted: false })
    });

    expect(result.blacklistFacts).toEqual([]);
    expect(result.firstHopBlacklistCoverage).toMatchObject({
      requiredForDecision: true,
      scope: "checked_window",
      windowStart: "2026-07-01T00:00:00.000Z",
      windowEnd: "2026-07-03T00:00:00.000Z",
      directPrincipalTransferCoverage: "partial",
      materialCounterpartyCount: 1,
      checkedMaterialCounterpartyCount: 1,
      failedMaterialCounterpartyCount: 0,
      uncheckedMaterialCounterpartyCount: 0,
      blacklistCheckCoverage: "history_partial",
      confirmedAdverseFactCount: 0
    });
    expect(result.firstHopBlacklistCoverage.incompleteReason).toMatch(/conflicting timestamps/i);
  });

  it("keeps complete removal and re-add lifecycles temporally unknown", async () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [edge({
        id: "1",
        fromAddress: "TReadded",
        toAddress: SUBJECT,
        amountRaw: 10_000_000000n,
        timestamp: new Date("2026-07-04T00:00:00.000Z")
      })]
    });
    const timelineEvents: UsdtBlacklistTimeline["events"] = [
      {
        eventKind: "added",
        occurredAt: "2026-07-01T00:00:00.000Z",
        txHash: "e".repeat(64),
        tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        blockNumber: 100,
        logIndex: 1,
        verification: "verified_contract_log"
      },
      {
        eventKind: "removed",
        occurredAt: "2026-07-02T00:00:00.000Z",
        txHash: "f".repeat(64),
        tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        blockNumber: 101,
        logIndex: 1,
        verification: "verified_contract_log"
      },
      {
        eventKind: "added",
        occurredAt: "2026-07-03T00:00:00.000Z",
        txHash: "0".repeat(64),
        tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        blockNumber: 102,
        logIndex: 1,
        verification: "verified_contract_log"
      }
    ];
    const result = await buildDirectHardEvidenceSnapshots({
      addresses: ["TReadded"],
      principalGroups: groups,
      directTransferCoverage: "complete",
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => restriction(address, {
        isBlacklisted: true,
        blacklistTimeline: { events: timelineEvents, pagination: "complete", failureReason: null }
      })
    });

    expect(result.blacklistFacts[0]).toMatchObject({
      temporalRelation: "unknown",
      timelineCoverage: "complete",
      beforeEffectiveAmountRaw: "0",
      activeAmountRaw: "0",
      unknownTimingAmountRaw: "10000000000",
      unknownTimingTxCount: 1
    });
  });

  it("keeps legacy address-only snapshots outside coherent material decision coverage", async () => {
    const result = await buildDirectHardEvidenceSnapshots({
      addresses: ["TLegacy0", "TLegacy1"],
      windowStart: new Date("2026-07-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-03T00:00:00.000Z"),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => restriction(address)
    });

    expect(result.liveCheckedCount).toBe(2);
    expect(result.firstHopBlacklistCoverage).toMatchObject({
      requiredForDecision: false,
      scope: "checked_window",
      windowStart: "2026-07-01T00:00:00.000Z",
      windowEnd: "2026-07-03T00:00:00.000Z",
      directPrincipalTransferCoverage: "partial",
      materialCounterpartyCount: 0,
      checkedMaterialCounterpartyCount: 0,
      failedMaterialCounterpartyCount: 0,
      uncheckedMaterialCounterpartyCount: 0,
      blacklistCheckCoverage: "history_partial"
    });
    expect(result.firstHopBlacklistCoverage.incompleteReason).toMatch(/directed principal groups/i);

    const compatibilityResult = await buildDirectHardEvidenceSnapshots({
      addresses: ["TLegacy0"],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => restriction(address)
    });
    expect(compatibilityResult.firstHopBlacklistCoverage).toMatchObject({
      requiredForDecision: false,
      scope: "checked_window",
      windowStart: null,
      windowEnd: null,
      directPrincipalTransferCoverage: "partial",
      materialCounterpartyCount: 0,
      checkedMaterialCounterpartyCount: 0,
      failedMaterialCounterpartyCount: 0,
      uncheckedMaterialCounterpartyCount: 0,
      blacklistCheckCoverage: "history_partial"
    });
    expect(compatibilityResult.firstHopBlacklistCoverage.incompleteReason).toMatch(/integration.pending|legacy/i);

    await expect(buildDirectHardEvidenceSnapshots({
      addresses: ["TLegacy0"],
      windowStart: new Date("2026-07-03T00:00:00.000Z"),
      windowEnd: new Date("2026-07-01T00:00:00.000Z"),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => restriction(address)
    })).rejects.toThrow(/window/i);
  });

  it("rejects malformed or conflicting direct transfer rows instead of producing clean coverage", () => {
    expect(() => groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [{ ...edge({ id: "bad", fromAddress: "TBad", toAddress: SUBJECT, amountRaw: 1n }), amountRaw: "not-an-amount" }]
    })).toThrow(/amount/i);

    const first = edge({
      id: "same",
      fromAddress: "TBad",
      toAddress: SUBJECT,
      amountRaw: 10_000_000000n,
      timestamp: new Date("2026-07-02T00:00:00.000Z")
    });
    expect(() => groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "complete",
      edges: [first, { ...first, amountRaw: "11000000000" }]
    })).toThrow(/conflicting/i);
  });

  it("rejects partial first-hop coverage without an explicit checked window", async () => {
    const groups = groupDirectPrincipalCounterparties({
      subjectAddress: SUBJECT,
      directTransferCoverage: "partial",
      edges: [edge({ id: "1", fromAddress: "TPartial", toAddress: SUBJECT, amountRaw: 10_000_000000n })]
    });
    await expect(buildDirectHardEvidenceSnapshots({
      addresses: ["TPartial"],
      principalGroups: groups,
      directTransferCoverage: "partial",
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => restriction(address)
    })).rejects.toThrow(/window/i);
  });
});
