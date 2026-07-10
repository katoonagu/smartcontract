import { describe, expect, it, vi } from "vitest";
import { runForensicAddressExposureSearch, runForensicRouteSearch } from "../../src/forensics/routeSearch";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";

const source = "TSource111111111111111111111111111111";
const hop = "THop1111111111111111111111111111111";
const target = "TTarget111111111111111111111111111111";

function transfer(overrides: Partial<RawTronscanTrc20Transfer> = {}): RawTronscanTrc20Transfer {
  return {
    transaction_id: overrides.transaction_id ?? "tx-1",
    from_address: overrides.from_address ?? source,
    to_address: overrides.to_address ?? target,
    quant: overrides.quant ?? "320000000000",
    contract_address: overrides.contract_address ?? TRON_USDT_CONTRACT_ADDRESS,
    confirmed: overrides.confirmed ?? true,
    contractRet: overrides.contractRet ?? "SUCCESS",
    block_ts: overrides.block_ts ?? new Date("2026-05-05T10:00:00.000Z").getTime(),
    trigger_info: overrides.trigger_info,
    tokenInfo: overrides.tokenInfo,
    finalResult: overrides.finalResult,
    revert: overrides.revert,
    status: overrides.status
  };
}

describe("forensic route search", () => {
  it("builds direct and hop candidate paths while filtering failed and non-USDT transfers", async () => {
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string) => {
        if (address === source) {
          return [
            transfer({ transaction_id: "direct", to_address: target }),
            transfer({ transaction_id: "to-hop", to_address: hop }),
            transfer({ transaction_id: "failed", to_address: target, contractRet: "REVERT" }),
            transfer({ transaction_id: "not-usdt", to_address: target, contract_address: "TNotUsdt1111111111111111111111111111" })
          ];
        }
        if (address === hop) {
          return [transfer({ transaction_id: "hop-target", from_address: hop, to_address: target, quant: "318000000000" })];
        }
        if (address === target) {
          return [transfer({ transaction_id: "target-in", from_address: hop, to_address: target, quant: "318000000000" })];
        }
        return [];
      })
    };

    const report = await runForensicRouteSearch({
      sourceAddress: source,
      targetAddress: target,
      amountUsdt: "320000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 2,
      maxPagesPerAddress: 1,
      pageLimit: 50,
      limit: 5
    });

    expect(report.paths.map((path) => path.pathAddresses)).toEqual(
      expect.arrayContaining([
        [source, target],
        [source, hop, target]
      ])
    );
    expect(report.paths.flatMap((path) => path.edges.map((edge) => edge.txHash))).not.toContain("failed");
    expect(report.paths.flatMap((path) => path.edges.map((edge) => edge.txHash))).not.toContain("not-usdt");
  });

  it("enforces page and depth caps during graph collection", async () => {
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string, options?: { start?: number }) => {
        if (address === source && options?.start === 0) {
          return [transfer({ transaction_id: "to-hop", to_address: hop })];
        }
        return [];
      })
    };

    await runForensicRouteSearch({
      sourceAddress: source,
      targetAddress: target,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 1,
      maxPagesPerAddress: 1,
      pageLimit: 1,
      limit: 5
    });

    expect(client.listRelatedTrc20Transfers.mock.calls.filter(([address]) => address === source)).toHaveLength(1);
    expect(client.listRelatedTrc20Transfers.mock.calls.some(([address]) => address === hop)).toBe(false);
  });

  it("rejects exact candidate paths whose hops go backward in time", async () => {
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string) => {
        if (address === source) {
          return [
            transfer({
              transaction_id: "source-hop",
              from_address: source,
              to_address: hop,
              block_ts: Date.parse("2026-05-05T10:00:00.000Z")
            })
          ];
        }
        if (address === hop) {
          return [
            transfer({
              transaction_id: "hop-target-before",
              from_address: hop,
              to_address: target,
              block_ts: Date.parse("2026-05-05T09:59:00.000Z")
            })
          ];
        }
        return [];
      })
    };

    const report = await runForensicRouteSearch({
      sourceAddress: source,
      targetAddress: target,
      amountUsdt: "320000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 2,
      maxPagesPerAddress: 1,
      pageLimit: 50,
      limit: 5
    });

    expect(report.paths.map((path) => path.pathAddresses)).not.toContainEqual([source, hop, target]);
    expect(report.case.status).not.toBe("completed");
  });

  it("keeps same-timestamp candidate hops valid because TronScan timestamps are coarse", async () => {
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string) => {
        if (address === source) {
          return [
            transfer({
              transaction_id: "source-hop",
              from_address: source,
              to_address: hop,
              block_ts: Date.parse("2026-05-05T10:00:00.000Z")
            })
          ];
        }
        if (address === hop) {
          return [
            transfer({
              transaction_id: "hop-target-same-time",
              from_address: hop,
              to_address: target,
              block_ts: Date.parse("2026-05-05T10:00:00.000Z")
            })
          ];
        }
        return [];
      })
    };

    const report = await runForensicRouteSearch({
      sourceAddress: source,
      targetAddress: target,
      amountUsdt: "320000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 2,
      maxPagesPerAddress: 1,
      pageLimit: 50,
      limit: 5
    });

    expect(report.paths.map((path) => path.pathAddresses)).toContainEqual([source, hop, target]);
  });

  it("stores service exposure observations with raw evidence references", async () => {
    const bridge = "TBridge111111111111111111111111111111";
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string) => {
        if (address === source) {
          return [transfer({ transaction_id: "source-bridge", from_address: source, to_address: bridge })];
        }
        return [];
      })
    };

    const report = await runForensicRouteSearch({
      sourceAddress: source,
      targetAddress: target,
      amountUsdt: "320000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 2,
      maxPagesPerAddress: 1,
      pageLimit: 50,
      limit: 5,
      getAddressMetadata: async (address) => address === bridge
        ? {
            address,
            name: "Allbridge Bridge",
            tag: "Allbridge:Cross-chain Bridge",
            isContract: true,
            verified: true
          }
        : null
    });

    const exposureObservation = report.observations.find((item) => item.code === "forensic_service_exposure");
    expect(report.serviceExposureProfiles[0].exposureScore).toBeGreaterThan(0);
    expect(exposureObservation?.rawEvidenceId).toBeTruthy();
    expect(report.rawEvidence.some((item) => item.id === exposureObservation?.rawEvidenceId)).toBe(true);
  });

  it("uses latest historical transfers for sparse source windows in address exposure", async () => {
    const bridge = "TBridge111111111111111111111111111111";
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (_address: string, options?: { minTimestamp?: number }) => {
        if (options?.minTimestamp !== undefined) return [];
        return [
          transfer({
            transaction_id: "old-source-bridge",
            from_address: source,
            to_address: bridge,
            block_ts: Date.parse("2026-03-01T10:00:00.000Z")
          })
        ];
      })
    };

    const report = await runForensicAddressExposureSearch({
      sourceAddress: source,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 1,
      maxPagesPerAddress: 1,
      pageLimit: 50,
      limit: 5,
      recentFallbackMinTransferCount: 10,
      recentFallbackTransferLimit: 60,
      getAddressMetadata: async (address) => address === bridge
        ? {
            address,
            name: "Allbridge Bridge",
            tag: "Allbridge:Cross-chain Bridge",
            isContract: true,
            verified: true
          }
        : null
    });

    expect(client.listRelatedTrc20Transfers.mock.calls.some(([, options]) => options?.minTimestamp === undefined)).toBe(true);
    expect(report.serviceExposureProfiles[0]).toMatchObject({
      dominantCategory: "bridge",
      exposureScore: expect.any(Number)
    });
    expect(report.missingChecks.some((check) => check.includes("sparse-wallet context"))).toBe(true);
  });

  it("stops expansion at service boundaries while allowing routes to reach them through forward edges", async () => {
    const bridgePool = target;
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string) => {
        if (address === source) {
          return [
            transfer({
              transaction_id: "source-hop",
              from_address: source,
              to_address: hop,
              quant: "311851000000",
              block_ts: Date.parse("2026-05-09T21:06:51.000Z")
            })
          ];
        }
        if (address === hop) {
          return [
            transfer({
              transaction_id: "hop-bridge-pool",
              from_address: hop,
              to_address: bridgePool,
              quant: "311752000000",
              block_ts: Date.parse("2026-05-09T23:14:06.000Z")
            })
          ];
        }
        if (address === bridgePool) {
          return [
            transfer({
              transaction_id: "bridge-pool-noisy",
              from_address: bridgePool,
              to_address: "TNoisy111111111111111111111111111111",
              quant: "1"
            })
          ];
        }
        return [];
      })
    };

    const report = await runForensicRouteSearch({
      sourceAddress: source,
      targetAddress: bridgePool,
      amountUsdt: "311752",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 2,
      maxPagesPerAddress: 1,
      pageLimit: 50,
      limit: 5,
      getAddressMetadata: async (address) => address === bridgePool
        ? {
            address,
            name: "Allbridge LP (LP-USDT)",
            tag: "Allbridge Bridge Pool",
            isContract: true,
            verified: true
          }
        : null
    });

    expect(report.paths.map((path) => path.pathAddresses)).toContainEqual([source, hop, bridgePool]);
    expect(client.listRelatedTrc20Transfers.mock.calls.some(([address]) => address === bridgePool)).toBe(false);
    expect(report.missingChecks).toContain(`Expansion stopped at service boundary ${bridgePool} (bridge_pool)`);
  });

  it("expands through a GasFree Account but stops at the registered pooled provider", async () => {
    const gasFreeAccount = "TGasFreeHop111111111111111111111111";
    const tronLinkProvider = "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird";
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string) => {
        if (address === source) {
          return [
            transfer({ transaction_id: "source-gasfree", from_address: source, to_address: gasFreeAccount, quant: "100000000" }),
            transfer({ transaction_id: "source-provider", from_address: source, to_address: tronLinkProvider, quant: "100000000" })
          ];
        }
        return [];
      })
    };

    const report = await runForensicAddressExposureSearch({
      sourceAddress: source,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 2,
      maxPagesPerAddress: 1,
      pageLimit: 50,
      limit: 5,
      getAddressMetadata: async (address) => address === gasFreeAccount
        ? {
            address,
            name: "CreatedByContract",
            tag: "GasFree Account",
            isContract: true,
            verified: false
          }
        : null
    });

    expect(report.fastCounterpartyTopsProfile?.topOutgoingCounterparties.map((row) => row.address)).toEqual(
      expect.arrayContaining([gasFreeAccount, tronLinkProvider])
    );
    expect(client.listRelatedTrc20Transfers.mock.calls.some(([address]) => address === gasFreeAccount)).toBe(true);
    expect(client.listRelatedTrc20Transfers.mock.calls.some(([address]) => address === tronLinkProvider)).toBe(false);
    expect(report.missingChecks).not.toContain(`Expansion stopped at service boundary ${gasFreeAccount} (service)`);
    expect(report.missingChecks).toContain(`Expansion stopped at service boundary ${tronLinkProvider} (service)`);
  });

  it("does not complete a route by traversing beyond an intermediate service boundary", async () => {
    const bridgePool = "TPool111111111111111111111111111111";
    const downstreamTarget = target;
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string) => {
        if (address === source) {
          return [
            transfer({
              transaction_id: "source-bridge-pool",
              from_address: source,
              to_address: bridgePool,
              quant: "100000000",
              block_ts: Date.parse("2026-05-05T10:00:00.000Z")
            })
          ];
        }
        if (address === downstreamTarget) {
          return [
            transfer({
              transaction_id: "bridge-pool-target",
              from_address: bridgePool,
              to_address: downstreamTarget,
              quant: "100000000",
              block_ts: Date.parse("2026-05-05T10:10:00.000Z")
            })
          ];
        }
        return [];
      })
    };

    const report = await runForensicRouteSearch({
      sourceAddress: source,
      targetAddress: downstreamTarget,
      amountUsdt: "100",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 2,
      maxPagesPerAddress: 1,
      pageLimit: 50,
      limit: 5,
      getAddressMetadata: async (address) => address === bridgePool
        ? {
            address,
            name: "Allbridge LP (LP-USDT)",
            tag: "Allbridge Bridge Pool",
            isContract: true,
            verified: true
          }
        : null
    });

    expect(report.paths.map((path) => path.pathAddresses)).not.toContainEqual([source, bridgePool, downstreamTarget]);
    expect(report.case.status).not.toBe("completed");
    expect(report.paths.map((path) => path.pathAddresses)).toContainEqual([source, bridgePool]);
  });

  it("keeps route raw evidence separate from service exposure inference", async () => {
    const bridge = "TBridge111111111111111111111111111111";
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string) => {
        if (address === source) {
          return [
            transfer({
              transaction_id: "source-target",
              from_address: source,
              to_address: target
            }),
            transfer({
              transaction_id: "source-bridge",
              from_address: source,
              to_address: bridge,
              quant: "100000000"
            })
          ];
        }
        return [];
      })
    };

    const report = await runForensicRouteSearch({
      sourceAddress: source,
      targetAddress: target,
      amountUsdt: "320000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 2,
      maxPagesPerAddress: 1,
      pageLimit: 50,
      limit: 5,
      getAddressMetadata: async (address) => address === bridge
        ? {
            address,
            name: "Allbridge Bridge",
            tag: "Allbridge:Cross-chain Bridge",
            isContract: true,
            verified: true
          }
        : null
    });

    const routeEvidence = report.rawEvidence.find((item) => item.id === report.paths[0].rawEvidenceId);
    const exposureEvidence = report.rawEvidence.find((item) =>
      Object.hasOwn(item.evidenceJson, "serviceExposureProfile")
    );

    expect(routeEvidence?.evidenceJson).not.toHaveProperty("serviceExposureProfiles");
    expect(exposureEvidence?.evidenceJson).toHaveProperty("serviceExposureProfile");
  });

  it("builds an address-only service exposure report without requiring a target", async () => {
    const bridgePool = "TPool111111111111111111111111111111";
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string) => {
        if (address === source) {
          return [
            transfer({
              transaction_id: "chunk-1",
              from_address: source,
              to_address: hop,
              quant: "999000000",
              block_ts: Date.parse("2026-05-09T21:06:51.000Z")
            }),
            transfer({
              transaction_id: "chunk-2",
              from_address: source,
              to_address: hop,
              quant: "99999000000",
              block_ts: Date.parse("2026-05-09T21:59:18.000Z")
            }),
            transfer({
              transaction_id: "chunk-3",
              from_address: source,
              to_address: hop,
              quant: "111111000000",
              block_ts: Date.parse("2026-05-09T22:52:27.000Z")
            }),
            transfer({
              transaction_id: "chunk-4",
              from_address: source,
              to_address: hop,
              quant: "99742000000",
              block_ts: Date.parse("2026-05-09T23:00:51.000Z")
            })
          ];
        }
        if (address === hop) {
          return [
            transfer({
              transaction_id: "hop-bridge-pool",
              from_address: hop,
              to_address: bridgePool,
              quant: "311752000000",
              block_ts: Date.parse("2026-05-09T23:14:06.000Z")
            })
          ];
        }
        return [];
      })
    };

    const report = await runForensicAddressExposureSearch({
      sourceAddress: source,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 2,
      maxPagesPerAddress: 1,
      pageLimit: 50,
      limit: 5,
      getAddressMetadata: async (address) => address === bridgePool
        ? {
            address,
            name: "Allbridge LP (LP-USDT)",
            tag: "Allbridge Bridge Pool",
            isContract: true,
            verified: true
          }
        : null
    });

    expect(report.subjectAddress).toBe(source);
    expect(report.serviceExposureProfiles[0].mergedServiceVolumeRatio).toBe(1);
    expect(report.serviceExposureProfiles[0].topMergedServiceFlows[0]).toMatchObject({
      intermediateAddress: hop,
      serviceAddress: bridgePool,
      category: "bridge_pool",
      incomingRaw: "311851000000",
      outgoingServiceRaw: "311752000000",
      sourceTxCount: 4,
      serviceTxCount: 1
    });
    expect(report.boundaryExposureProfiles?.[0]).toMatchObject({
      subjectAddress: source,
      outgoingBoundaryVolumeRaw: "311851000000",
      twoHopBoundaryTxCount: 4,
      contextScore: 15
    });
    expect(report.walletRoleProfiles?.[0]).toBeDefined();
    expect(report.rawEvidence.some((item) => "boundaryExposureProfile" in item.evidenceJson)).toBe(true);
    expect(report.rawEvidence.some((item) => "walletRoleProfile" in item.evidenceJson)).toBe(true);
    expect(report.observations.some((item) => item.code === "forensic_service_exposure")).toBe(true);
    expect(report.observations.some((item) => item.code === "forensic_address_behavior")).toBe(true);
    expect(report.observations.some((item) => item.code === "forensic_boundary_exposure_context")).toBe(true);
  });

  it("returns fast counterparty tops for address exposure reports", async () => {
    const sender = "TSender111111111111111111111111111111";
    const bridgePool = "TPool111111111111111111111111111111";
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string) => {
        if (address === source) {
          return [
            transfer({ transaction_id: "sender-source", from_address: sender, to_address: source, quant: "200000000" }),
            transfer({ transaction_id: "source-bridge-pool", from_address: source, to_address: bridgePool, quant: "150000000" })
          ];
        }
        return [];
      })
    };

    const report = await runForensicAddressExposureSearch({
      sourceAddress: source,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 1,
      maxPagesPerAddress: 1,
      pageLimit: 50,
      limit: 5,
      getAddressMetadata: async (address) => address === bridgePool
        ? {
            address,
            name: "Allbridge LP (LP-USDT)",
            tag: "Allbridge Bridge Pool",
            isContract: true,
            verified: true
          }
        : null
    });

    expect(report.fastCounterpartyTopsProfile).toMatchObject({
      subjectAddress: source,
      incomingVolumeRaw: "200000000",
      outgoingVolumeRaw: "150000000",
      topIncomingCounterparties: [
        expect.objectContaining({ address: sender, direction: "incoming", volumeRaw: "200000000" })
      ],
      topOutgoingCounterparties: [
        expect.objectContaining({ address: bridgePool, direction: "outgoing", category: "bridge_pool" })
      ],
      topServiceCounterparties: [
        expect.objectContaining({ address: bridgePool, direction: "service", category: "bridge_pool" })
      ]
    });
  });

  it("caps only queued intermediate expansions in address exposure search", async () => {
    const firstHop = "THopA111111111111111111111111111111";
    const secondHop = "THopB111111111111111111111111111111";
    const firstService = "TPoolA111111111111111111111111111111";
    const secondService = "TPoolB111111111111111111111111111111";
    const directService = "TPoolDirect11111111111111111111111111";
    const client = {
      listRelatedTrc20Transfers: vi.fn(async (address: string) => {
        if (address === source) {
          return [
            transfer({ transaction_id: "source-first-hop", from_address: source, to_address: firstHop, quant: "100000000" }),
            transfer({ transaction_id: "source-second-hop", from_address: source, to_address: secondHop, quant: "100000000" }),
            transfer({ transaction_id: "source-direct-service", from_address: source, to_address: directService, quant: "100000000" })
          ];
        }
        if (address === firstHop) {
          return [
            transfer({ transaction_id: "first-hop-service", from_address: firstHop, to_address: firstService, quant: "100000000" })
          ];
        }
        if (address === secondHop) {
          return [
            transfer({ transaction_id: "second-hop-service", from_address: secondHop, to_address: secondService, quant: "100000000" })
          ];
        }
        if (address === directService) {
          return [
            transfer({ transaction_id: "direct-service-noise", from_address: directService, to_address: target, quant: "1" })
          ];
        }
        return [];
      })
    };

    const report = await runForensicAddressExposureSearch({
      sourceAddress: source,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      tronClient: client,
      maxDepth: 2,
      maxExpandedIntermediates: 1,
      maxPagesPerAddress: 1,
      pageLimit: 50,
      limit: 5,
      getAddressMetadata: async (address) => [firstService, secondService, directService].includes(address)
        ? {
            address,
            name: "Allbridge LP (LP-USDT)",
            tag: "Allbridge Bridge Pool",
            isContract: true,
            verified: true
          }
        : null
    });

    expect(client.listRelatedTrc20Transfers.mock.calls.map(([address]) => address)).toEqual([source, firstHop]);
    expect(report.serviceExposureProfiles[0].topServiceCounterparties.map((flow) => flow.address)).toEqual(
      expect.arrayContaining([firstService, directService])
    );
    expect(report.serviceExposureProfiles[0].topServiceCounterparties.map((flow) => flow.address)).not.toContain(secondService);
    expect(report.serviceExposureProfiles[0].categoryBreakdown.some((item) => item.category === "bridge_pool")).toBe(true);
  });
});
