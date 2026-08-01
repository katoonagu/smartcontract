import { describe, expect, it } from "vitest";
import { buildAssetContinuationProfiles } from "../../src/forensics/assetContinuation";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import type { AddressLabel } from "../../src/types";

const subjectAddress = "TSubject111111111111111111111111111111";
const protocolAddress = "TProtocol111111111111111111111111111";
const wrappedToken = "TWrappedToken1111111111111111111111";
const alternateToken = "TAlternateToken11111111111111111111";
const unknownToken = "TUnknownToken111111111111111111111";
const riskyDestination = "TRiskyDestination1111111111111111111";
const unrelatedProtocolAddress = "TUnrelated1111111111111111111111111";
const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

function transfer(overrides: Partial<RawTronscanTrc20Transfer> = {}): RawTronscanTrc20Transfer {
  return {
    transaction_id: "tx",
    from_address: "TFrom111111111111111111111111111111",
    to_address: "TTo11111111111111111111111111111111",
    quant: "1000000",
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    finalResult: "SUCCESS",
    revert: false,
    block_ts: 1770000000000,
    tokenInfo: {
      tokenAbbr: "USDT",
      tokenDecimal: 6,
      tokenId: TRON_USDT_CONTRACT_ADDRESS,
      tokenType: "trc20"
    },
    ...overrides
  };
}

function verifiedTokenTransfer(overrides: Partial<RawTronscanTrc20Transfer> = {}): RawTronscanTrc20Transfer {
  const contractAddress = overrides.contract_address ?? wrappedToken;
  const symbol = contractAddress === alternateToken ? "ALTWRAP" : "WRAPPED";
  return transfer({
    contract_address: contractAddress,
    tokenInfo: {
      tokenAbbr: symbol,
      tokenDecimal: 6,
      tokenId: contractAddress,
      tokenName: `${symbol} Protocol Token`,
      tokenType: "trc20"
    },
    ...overrides
  });
}

function internalRiskLabel(address: string): AddressLabel {
  return {
    address,
    label: "reported_scam",
    source: "service_admin",
    createdByTelegramId: null,
    createdAt: new Date("2026-06-05T00:00:00.000Z")
  };
}

describe("buildAssetContinuationProfiles", () => {
  it("detects generic verified token continuation after USDT conversion to a provider-risk destination", async () => {
    const profiles = await buildAssetContinuationProfiles({
      subjectAddress,
      usdtTransfers: [
        transfer({
          transaction_id: "tx-usdt-out",
          from_address: subjectAddress,
          to_address: protocolAddress,
          quant: "101607508600",
          block_ts: 1770000000000
        })
      ],
      allTokenTransfers: [
        verifiedTokenTransfer({
          transaction_id: "tx-token-in",
          from_address: protocolAddress,
          to_address: subjectAddress,
          quant: "101607508600",
          block_ts: 1770000003000
        }),
        verifiedTokenTransfer({
          transaction_id: "tx-token-out",
          from_address: subjectAddress,
          to_address: riskyDestination,
          quant: "101607508600",
          block_ts: 1770000010000,
          riskTransaction: true
        })
      ],
      getLabelsForAddress: async () => []
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      sourceAsset: "USDT",
      continuationAssetSymbol: "WRAPPED",
      continuationTokenContract: wrappedToken,
      conversionTxHash: "tx-token-in",
      outgoingTxHash: "tx-token-out",
      protocolAddress,
      destinationAddress: riskyDestination,
      destinationRisk: "provider_risk",
      tokenQuality: "verified",
      evidenceClass: "asset_continuation"
    });
    expect(profiles[0]?.score).toBeGreaterThanOrEqual(80);
    expect(profiles[0]?.score).toBeLessThanOrEqual(84);
  });

  it("downgrades unknown token metadata below a high floor", async () => {
    const profiles = await buildAssetContinuationProfiles({
      subjectAddress,
      usdtTransfers: [
        transfer({
          transaction_id: "tx-usdt-out",
          from_address: subjectAddress,
          to_address: protocolAddress,
          block_ts: 1770000000000
        })
      ],
      allTokenTransfers: [
        transfer({
          transaction_id: "tx-token-in",
          from_address: protocolAddress,
          to_address: subjectAddress,
          contract_address: unknownToken,
          block_ts: 1770000001000,
          tokenInfo: undefined
        }),
        transfer({
          transaction_id: "tx-token-out",
          from_address: subjectAddress,
          to_address: riskyDestination,
          contract_address: unknownToken,
          riskTransaction: true,
          block_ts: 1770000002000,
          tokenInfo: undefined
        })
      ],
      getLabelsForAddress: async () => []
    });

    expect(profiles[0]?.tokenQuality).toBe("unknown");
    expect(profiles[0]?.score ?? 0).toBeLessThan(65);
  });

  it("marks internally labeled destinations stronger than service boundary context", async () => {
    const profiles = await buildAssetContinuationProfiles({
      subjectAddress,
      usdtTransfers: [
        transfer({
          transaction_id: "tx-usdt-out",
          from_address: subjectAddress,
          to_address: protocolAddress,
          block_ts: 1770000000000
        })
      ],
      allTokenTransfers: [
        verifiedTokenTransfer({
          transaction_id: "tx-token-in",
          from_address: protocolAddress,
          to_address: subjectAddress,
          block_ts: 1770000001000
        }),
        verifiedTokenTransfer({
          transaction_id: "tx-token-out",
          from_address: subjectAddress,
          to_address: riskyDestination,
          block_ts: 1770000002000,
          toAddressIsContract: true
        })
      ],
      getLabelsForAddress: async (address) => (address === riskyDestination ? [internalRiskLabel(address)] : [])
    });

    expect(profiles[0]?.destinationRisk).toBe("internal_label");
    expect(profiles[0]?.score).toBeGreaterThanOrEqual(82);
  });

  it("does not score unrelated nearby token activity as continuation", async () => {
    const profiles = await buildAssetContinuationProfiles({
      subjectAddress,
      usdtTransfers: [
        transfer({
          transaction_id: "tx-usdt-out",
          from_address: subjectAddress,
          to_address: protocolAddress,
          quant: "101607508600",
          block_ts: 1770000000000
        })
      ],
      allTokenTransfers: [
        verifiedTokenTransfer({
          transaction_id: "tx-token-in",
          from_address: unrelatedProtocolAddress,
          to_address: subjectAddress,
          quant: "101607508600",
          block_ts: 1770000001000
        }),
        verifiedTokenTransfer({
          transaction_id: "tx-token-out",
          from_address: subjectAddress,
          to_address: riskyDestination,
          quant: "101607508600",
          block_ts: 1770000002000,
          riskTransaction: true
        })
      ],
      getLabelsForAddress: async () => []
    });

    expect(profiles).toEqual([]);
  });

  it("does not match outgoing continuation beyond the bounded episode window", async () => {
    const profiles = await buildAssetContinuationProfiles({
      subjectAddress,
      usdtTransfers: [
        transfer({
          transaction_id: "tx-usdt-out",
          from_address: subjectAddress,
          to_address: protocolAddress,
          quant: "101607508600",
          block_ts: 1770000000000
        })
      ],
      allTokenTransfers: [
        verifiedTokenTransfer({
          transaction_id: "tx-token-in",
          from_address: protocolAddress,
          to_address: subjectAddress,
          quant: "101607508600",
          block_ts: 1770000001000
        }),
        verifiedTokenTransfer({
          transaction_id: "tx-token-out",
          from_address: subjectAddress,
          to_address: riskyDestination,
          quant: "101607508600",
          block_ts: 1770000001000 + thirtyDaysMs,
          riskTransaction: true
        })
      ],
      getLabelsForAddress: async () => []
    });

    expect(profiles).toEqual([]);
  });

  it("finds a valid second inbound candidate when the nearest inbound has no outgoing continuation", async () => {
    const profiles = await buildAssetContinuationProfiles({
      subjectAddress,
      usdtTransfers: [
        transfer({
          transaction_id: "tx-usdt-out",
          from_address: subjectAddress,
          to_address: protocolAddress,
          quant: "101607508600",
          block_ts: 1770000000000
        })
      ],
      allTokenTransfers: [
        verifiedTokenTransfer({
          transaction_id: "tx-nearest-token-in",
          from_address: protocolAddress,
          to_address: subjectAddress,
          quant: "5000000",
          block_ts: 1770000000500
        }),
        verifiedTokenTransfer({
          transaction_id: "tx-valid-token-in",
          from_address: protocolAddress,
          to_address: subjectAddress,
          quant: "101607508600",
          contract_address: alternateToken,
          block_ts: 1770000001000
        }),
        verifiedTokenTransfer({
          transaction_id: "tx-valid-token-out",
          from_address: subjectAddress,
          to_address: riskyDestination,
          quant: "101607508600",
          contract_address: alternateToken,
          block_ts: 1770000002000,
          riskTransaction: true
        })
      ],
      getLabelsForAddress: async () => []
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      continuationAssetSymbol: "ALTWRAP",
      continuationTokenContract: alternateToken,
      conversionTxHash: "tx-valid-token-in",
      outgoingTxHash: "tx-valid-token-out",
      destinationRisk: "provider_risk"
    });
  });

  it("does not treat subject self-transfer as outgoing continuation", async () => {
    const profiles = await buildAssetContinuationProfiles({
      subjectAddress,
      usdtTransfers: [
        transfer({
          transaction_id: "tx-usdt-out",
          from_address: subjectAddress,
          to_address: protocolAddress,
          quant: "101607508600",
          block_ts: 1770000000000
        })
      ],
      allTokenTransfers: [
        verifiedTokenTransfer({
          transaction_id: "tx-token-in",
          from_address: protocolAddress,
          to_address: subjectAddress,
          quant: "101607508600",
          block_ts: 1770000001000
        }),
        verifiedTokenTransfer({
          transaction_id: "tx-token-self",
          from_address: subjectAddress,
          to_address: subjectAddress,
          quant: "101607508600",
          block_ts: 1770000002000,
          riskTransaction: true
        })
      ],
      getLabelsForAddress: async () => []
    });

    expect(profiles).toEqual([]);
  });

  it("does not reuse one outgoing transfer for multiple correlated inbound candidates", async () => {
    const profiles = await buildAssetContinuationProfiles({
      subjectAddress,
      usdtTransfers: [
        transfer({
          transaction_id: "tx-usdt-out",
          from_address: subjectAddress,
          to_address: protocolAddress,
          quant: "101607508600",
          block_ts: 1770000000000
        })
      ],
      allTokenTransfers: [
        verifiedTokenTransfer({
          transaction_id: "tx-token-in-one",
          from_address: protocolAddress,
          to_address: subjectAddress,
          quant: "60000000000",
          block_ts: 1770000001000
        }),
        verifiedTokenTransfer({
          transaction_id: "tx-token-in-two",
          from_address: protocolAddress,
          to_address: subjectAddress,
          quant: "60000000000",
          block_ts: 1770000001500
        }),
        verifiedTokenTransfer({
          transaction_id: "tx-token-out",
          from_address: subjectAddress,
          to_address: riskyDestination,
          quant: "101607508600",
          block_ts: 1770000002000,
          riskTransaction: true
        })
      ],
      getLabelsForAddress: async () => []
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.outgoingTxHash).toBe("tx-token-out");
  });
});
