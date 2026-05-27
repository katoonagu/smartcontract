import { describe, expect, it, vi } from "vitest";
import { createAddressExposureRiskSignalProvider } from "../../src/check/addressExposureSignals";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";

const sourceAddress = "TSource111111111111111111111111111111";
const serviceAddress = "TService11111111111111111111111111111";

function transfer(txHash: string): RawTronscanTrc20Transfer {
  return {
    transaction_id: txHash,
    from_address: sourceAddress,
    to_address: serviceAddress,
    quant: "100000000",
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    block_ts: Date.parse("2026-05-20T10:00:00.000Z")
  };
}

describe("address exposure risk signal provider", () => {
  it("converts bounded service exposure into a capped graph signal with evidence", async () => {
    const provider = createAddressExposureRiskSignalProvider({
      tronClient: {
        listRelatedTrc20Transfers: async () => [transfer("tx-direct-service")]
      },
      getAddressMetadata: async (address) =>
        address === serviceAddress
          ? {
              address,
              source: "tronscan",
              name: "Allbridge LP (LP-USDT)",
              tag: "Pool",
              isContract: true,
              verified: true,
              accountType: 2,
              rawJson: {},
              fetchedAt: new Date("2026-05-24T00:00:00.000Z"),
              expiresAt: new Date("2026-05-25T00:00:00.000Z")
            }
          : null,
      now: () => new Date("2026-05-24T00:00:00.000Z")
    }, {
      pageLimit: 5,
      maxPagesPerAddress: 1,
      timeoutMs: 10_000
    });

    const signals = await provider(sourceAddress);

    expect(signals.graphSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "forensic_service_exposure",
        scoreImpact: 50,
        source: "forensic_route_search",
        evidenceRef: expect.any(String)
      }),
      expect.objectContaining({
        code: "forensic_boundary_exposure_context",
        scoreImpact: 15,
        source: "forensic_route_search",
        evidenceRef: expect.any(String)
      })
    ]));
    expect(signals.rawEvidence).toHaveLength(2);
    expect(signals.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "forensic_service_exposure" }),
      expect.objectContaining({ code: "forensic_boundary_exposure_context" })
    ]));
    expect(signals.serviceExposureProfiles?.[0]).toMatchObject({
      subjectAddress: sourceAddress,
      dominantCategory: "bridge_pool",
      exposureScore: 65
    });
    expect(signals.boundaryExposureProfiles?.[0]).toMatchObject({
      subjectAddress: sourceAddress,
      contextScore: 15
    });
  });

  it("adds a critical provider signal when TRON USDT blacklist state is active", async () => {
    const listRelatedTrc20Transfers = vi.fn(async () => {
      throw new Error("transfer crawl should not run for active blacklist status");
    });
    const provider = createAddressExposureRiskSignalProvider({
      tronClient: {
        listRelatedTrc20Transfers,
        getUsdtRestrictionStatus: async () => ({
          subjectAddress: sourceAddress,
          tokenContract: TRON_USDT_CONTRACT_ADDRESS,
          tokenSymbol: "USDT",
          tokenStandard: "TRC20",
          decimals: 6,
          isBlacklisted: true,
          balanceRaw: "2642746070000",
          checkedAt: "2026-05-24T00:00:00.000Z",
          evidenceStrength: "exact_contract_state",
          blacklistEventTxHash: "tx-blacklist",
          blacklistEventTimestamp: "2026-05-23T12:00:00.000Z",
          blacklistEventBlock: 123,
          methods: {
            blacklist: "isBlackListed(address)",
            balance: "balanceOf(address)"
          }
        })
      },
      now: () => new Date("2026-05-24T00:00:00.000Z")
    }, {
      pageLimit: 5,
      maxPagesPerAddress: 1,
      timeoutMs: 10_000
    });

    const signals = await provider(sourceAddress);

    expect(signals.amlSignals).toEqual([
      expect.objectContaining({
        code: "stablecoin_usdt_blacklisted",
        scoreImpact: 90,
        source: "stablecoin_contract",
        severity: "critical",
        evidenceRef: expect.any(String)
      })
    ]);
    expect(signals.stablecoinRestrictionProfiles?.[0]).toMatchObject({
      subjectAddress: sourceAddress,
      isBlacklisted: true,
      balanceRaw: "2642746070000",
      blacklistEventTxHash: "tx-blacklist"
    });
    expect(signals.rawEvidence?.some((evidence) => "stablecoinRestrictionProfile" in evidence.evidenceJson)).toBe(true);
    expect(signals.observations?.some((observation) => observation.code === "stablecoin_usdt_blacklisted")).toBe(true);
    expect(listRelatedTrc20Transfers).not.toHaveBeenCalled();
  });

  it("reuses successful stablecoin restriction checks and does not cache failures", async () => {
    let nowMs = Date.parse("2026-05-24T00:00:00.000Z");
    const getUsdtRestrictionStatus = vi
      .fn()
      .mockResolvedValueOnce({
        subjectAddress: sourceAddress,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        tokenSymbol: "USDT",
        tokenStandard: "TRC20",
        decimals: 6,
        isBlacklisted: true,
        balanceRaw: "100000000",
        checkedAt: "2026-05-24T00:00:00.000Z",
        evidenceStrength: "exact_contract_state",
        methods: {
          blacklist: "isBlackListed(address)",
          balance: "balanceOf(address)"
        }
      })
      .mockRejectedValueOnce(new Error("fullnode unavailable"))
      .mockResolvedValueOnce({
        subjectAddress: `${sourceAddress}2`,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        tokenSymbol: "USDT",
        tokenStandard: "TRC20",
        decimals: 6,
        isBlacklisted: false,
        balanceRaw: "0",
        checkedAt: "2026-05-24T00:01:00.000Z",
        evidenceStrength: "exact_contract_state",
        methods: {
          blacklist: "isBlackListed(address)",
          balance: "balanceOf(address)"
        }
      });
    const provider = createAddressExposureRiskSignalProvider({
      tronClient: {
        listRelatedTrc20Transfers: async () => [],
        getUsdtRestrictionStatus
      },
      now: () => new Date(nowMs)
    }, {
      stablecoinRestrictionCacheTtlMs: 300_000,
      timeoutMs: 10_000
    });

    await provider(sourceAddress);
    nowMs += 1_000;
    await provider(sourceAddress);
    await provider(`${sourceAddress}2`);
    await provider(`${sourceAddress}2`);

    expect(getUsdtRestrictionStatus).toHaveBeenCalledTimes(3);
  });

  it("does not convert dust unknown-contract exposure into a graph signal", async () => {
    const unknown = "TUnknown1111111111111111111111111111";
    const provider = createAddressExposureRiskSignalProvider({
      tronClient: {
        listRelatedTrc20Transfers: async () => [
          {
            ...transfer("tx-large-normal"),
            to_address: "TNormal1111111111111111111111111111",
            quant: "1329857820000"
          },
          {
            ...transfer("tx-dust-unknown"),
            to_address: unknown,
            quant: "20000000"
          }
        ]
      },
      getAddressMetadata: async (address) =>
        address === unknown
          ? {
              address,
              source: "tronscan",
              name: "CreatedByContract",
              tag: null,
              isContract: true,
              verified: false,
              accountType: 2,
              rawJson: {},
              fetchedAt: new Date("2026-05-24T00:00:00.000Z"),
              expiresAt: new Date("2026-05-25T00:00:00.000Z")
            }
          : null,
      now: () => new Date("2026-05-24T00:00:00.000Z")
    }, {
      pageLimit: 5,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      timeoutMs: 10_000
    });

    const signals = await provider(sourceAddress);

    expect(signals.graphSignals.map((signal) => signal.code)).not.toContain("forensic_service_exposure");
    expect(signals.serviceExposureProfiles?.[0]).toMatchObject({
      exposureScore: 0,
      dominantCategory: "unknown_contract"
    });
  });

  it("reuses fulfilled transfer lookups across repeated checks", async () => {
    const listRelatedTrc20Transfers = vi.fn(async () => [transfer("tx-cached")]);
    let nowMs = Date.parse("2026-05-24T00:00:00.000Z");
    const provider = createAddressExposureRiskSignalProvider({
      tronClient: { listRelatedTrc20Transfers },
      getAddressMetadata: async (address) =>
        address === serviceAddress
          ? {
              address,
              source: "tronscan",
              name: "Allbridge LP (LP-USDT)",
              tag: "Pool",
              isContract: true,
              verified: true,
              accountType: 2,
              rawJson: {},
              fetchedAt: new Date("2026-05-24T00:00:00.000Z"),
              expiresAt: new Date("2026-05-25T00:00:00.000Z")
            }
          : null,
      now: () => new Date(nowMs)
    }, {
      pageLimit: 5,
      maxPagesPerAddress: 1,
      transferCacheTtlMs: 300_000,
      timeoutMs: 10_000
    });

    await provider(sourceAddress);
    nowMs += 1_000;
    await provider(sourceAddress);

    expect(listRelatedTrc20Transfers).toHaveBeenCalledTimes(2);
  });

  it("returns a partial note instead of throwing when exposure lookup fails", async () => {
    const provider = createAddressExposureRiskSignalProvider({
      tronClient: {
        listRelatedTrc20Transfers: async () => {
          throw new Error("rate limited");
        }
      },
      now: () => new Date("2026-05-24T00:00:00.000Z")
    }, {
      pageLimit: 5,
      maxPagesPerAddress: 1,
      timeoutMs: 10_000
    });

    const signals = await provider(sourceAddress);

    expect(signals.graphSignals).toEqual([]);
    expect(signals.rawEvidence).toEqual([]);
    expect(signals.observations).toEqual([]);
    expect(signals.missingChecks?.[0]).toContain("Service exposure check incomplete");
  });

  it("stops scheduling metadata enrichment after timeout", async () => {
    let metadataCalls = 0;
    const transfers = Array.from({ length: 20 }, (_, index) => ({
      ...transfer(`tx-${index}`),
      to_address: `TReceiver${String(index).padStart(2, "0")}111111111111111111111`
    }));
    const provider = createAddressExposureRiskSignalProvider({
      tronClient: {
        listRelatedTrc20Transfers: async () => transfers
      },
      getAddressMetadata: async () => {
        metadataCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return null;
      },
      now: () => new Date("2026-05-24T00:00:00.000Z")
    }, {
      pageLimit: 20,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      timeoutMs: 5
    });

    const signals = await provider(sourceAddress);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(signals.missingChecks?.[0]).toContain("timed out after 5ms");
    expect(metadataCalls).toBeLessThanOrEqual(1);
  });

  it("returns behavior fallback when enrichment times out after source transfers are cached", async () => {
    const transfers: RawTronscanTrc20Transfer[] = [
      {
        ...transfer("in-1"),
        from_address: "TA",
        to_address: sourceAddress,
        quant: "100000000000"
      },
      {
        ...transfer("in-2"),
        from_address: "TB",
        to_address: sourceAddress,
        quant: "90000000000"
      },
      {
        ...transfer("in-3"),
        from_address: "TC",
        to_address: sourceAddress,
        quant: "80000000000"
      },
      {
        ...transfer("in-4"),
        from_address: "TD",
        to_address: sourceAddress,
        quant: "70000000000"
      },
      {
        ...transfer("in-5"),
        from_address: "TE",
        to_address: sourceAddress,
        quant: "60000000000"
      },
      {
        ...transfer("out-1"),
        from_address: sourceAddress,
        to_address: "TX",
        quant: "180000000000"
      },
      {
        ...transfer("out-2"),
        from_address: sourceAddress,
        to_address: "TY",
        quant: "90000000000"
      },
      {
        ...transfer("out-3"),
        from_address: sourceAddress,
        to_address: "TZ",
        quant: "80000000000"
      },
      {
        ...transfer("out-4"),
        from_address: sourceAddress,
        to_address: "TU",
        quant: "30000000000"
      },
      {
        ...transfer("out-5"),
        from_address: sourceAddress,
        to_address: "TV",
        quant: "20000000000"
      }
    ];
    const provider = createAddressExposureRiskSignalProvider({
      tronClient: {
        listRelatedTrc20Transfers: async () => transfers
      },
      getAddressMetadata: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return null;
      },
      now: () => new Date("2026-05-24T00:00:00.000Z")
    }, {
      pageLimit: 20,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      timeoutMs: 5
    });

    const signals = await provider(sourceAddress);

    expect(signals.graphSignals).toEqual([
      expect.objectContaining({ code: "forensic_address_behavior", scoreImpact: 30 })
    ]);
    expect(signals.addressBehaviorProfiles?.[0].transitScore).toBeGreaterThan(0);
    expect(signals.missingChecks?.[0]).toContain("timed out after 5ms");
  });

  it("converts behavior-only transit context into a capped graph signal", async () => {
    const transfers: RawTronscanTrc20Transfer[] = [
      {
        ...transfer("in-1"),
        from_address: "TA",
        to_address: sourceAddress,
        quant: "100000000000"
      },
      {
        ...transfer("in-2"),
        from_address: "TB",
        to_address: sourceAddress,
        quant: "90000000000"
      },
      {
        ...transfer("in-3"),
        from_address: "TC",
        to_address: sourceAddress,
        quant: "80000000000"
      },
      {
        ...transfer("in-4"),
        from_address: "TD",
        to_address: sourceAddress,
        quant: "70000000000"
      },
      {
        ...transfer("in-5"),
        from_address: "TE",
        to_address: sourceAddress,
        quant: "60000000000"
      },
      {
        ...transfer("out-1"),
        from_address: sourceAddress,
        to_address: "TX",
        quant: "180000000000"
      },
      {
        ...transfer("out-2"),
        from_address: sourceAddress,
        to_address: "TY",
        quant: "90000000000"
      },
      {
        ...transfer("out-3"),
        from_address: sourceAddress,
        to_address: "TZ",
        quant: "80000000000"
      },
      {
        ...transfer("out-4"),
        from_address: sourceAddress,
        to_address: "TU",
        quant: "30000000000"
      },
      {
        ...transfer("out-5"),
        from_address: sourceAddress,
        to_address: "TV",
        quant: "20000000000"
      }
    ];
    const provider = createAddressExposureRiskSignalProvider({
      tronClient: {
        listRelatedTrc20Transfers: async () => transfers
      },
      now: () => new Date("2026-05-24T00:00:00.000Z")
    }, {
      pageLimit: 20,
      maxPagesPerAddress: 1,
      timeoutMs: 10_000
    });

    const signals = await provider(sourceAddress);

    expect(signals.graphSignals).toEqual([
      expect.objectContaining({
        code: "forensic_address_behavior",
        scoreImpact: 30,
        message: expect.stringContaining("transit-like behavior")
      })
    ]);
    expect(signals.addressBehaviorProfiles?.[0].transitScore).toBeGreaterThan(0);
    expect(signals.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "forensic_address_behavior" }),
      expect.objectContaining({ code: "forensic_wallet_role_context" })
    ]));
    expect(signals.walletRoleProfiles?.[0]).toMatchObject({
      subjectAddress: sourceAddress,
      primaryRole: "collector"
    });
  });
});
