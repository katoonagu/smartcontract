import { describe, expect, it } from "vitest";
import { createFixtureCrossChainDiscoveryProvider } from "../../src/forensics/crossChainProviders";
import { manualGaryStargateTornadoCase } from "../fixtures/forensics/crossChainCases";

const provider = createFixtureCrossChainDiscoveryProvider(manualGaryStargateTornadoCase.data);

describe("fixture cross-chain discovery provider", () => {
  it("finds Range-like transfers by tx with inclusive time-window support", async () => {
    const transfers = await provider.findTransfersByTx({
      chain: "ethereum",
      txHash: "0X72846A16B3C7436B8E878A68B8A4FFD7105B4A2530186EDE3500B888B9EB371F",
      timeWindow: {
        start: "2026-05-05T02:41:59.000Z",
        end: "2026-05-05T02:41:59.000Z"
      }
    });

    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      protocol: "LayerZero/Stargate",
      assetSymbol: "USDT",
      amountRaw: "100000000000"
    });
    expect(transfers[0]?.evidenceRefs[0]?.provider).toBe("range");
    expect(transfers[0]?.payloadRef?.provider).toBe("range");
  });

  it("finds bridge transfers by address", async () => {
    const transfers = await provider.findTransfersByAddress({
      address: "0x6ca63c963948597eaf85c6a193fedf1d96c62ea7"
    });

    expect(transfers.map((transfer) => transfer.amountRaw)).toEqual([
      "247770000000000000000",
      "250000000000000000000"
    ]);
  });

  it("filters address discovery by time window, asset symbol, and minimum raw amount", async () => {
    const transfers = await provider.findTransfersByAddress({
      address: "0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60",
      timeWindow: {
        start: "2026-05-05T01:05:45.000Z",
        end: "2026-05-05T01:11:26.000Z"
      },
      assetSymbol: "eth",
      minAmountRaw: "250000000000000000000"
    });

    expect(transfers.map((transfer) => transfer.amountRaw)).toEqual(["250000000000000000000"]);
  });

  it("binds address chain filtering to the side where the address matched", async () => {
    const transfers = await provider.findTransfersByAddress({
      chain: "ethereum",
      address: "0x6Ca63c963948597EAF85C6A193FedF1d96c62eA7"
    });

    expect(transfers).toEqual([]);
  });

  it("excludes records without parseable timestamps when a time window is provided", async () => {
    const baseTransfer = manualGaryStargateTornadoCase.data.transfers[0];
    const timestampProvider = createFixtureCrossChainDiscoveryProvider({
      transfers: [
        { ...baseTransfer, id: "missing-timestamp", timestamp: null },
        { ...baseTransfer, id: "invalid-timestamp", timestamp: "not-a-date" }
      ],
      riskSnapshots: []
    });

    const transfers = await timestampProvider.findTransfersByTx({
      chain: "ethereum",
      txHash: baseTransfer.sourceTxHash ?? "",
      timeWindow: {
        start: "2026-05-05T02:40:59.000Z",
        end: "2026-05-05T02:42:59.000Z"
      }
    });

    expect(transfers).toEqual([]);
  });

  it("matches tx, chain, and address filters with different casing", async () => {
    const transfers = await provider.findTransfersByTx({
      chain: "ETHEREUM",
      txHash: "0X72846A16B3C7436B8E878A68B8A4FFD7105B4A2530186EDE3500B888B9EB371F",
      address: "0X2CFEEE2394AC0F01C92CDADCB697FEC0CF8DA315"
    });

    expect(transfers.map((transfer) => transfer.id)).toEqual(["range-ethereum-tron-usdt-100k"]);
  });

  it("returns a matching address risk snapshot", async () => {
    const snapshot = await provider.getAddressRisk({
      chain: "ETHEREUM",
      address: "0x7c3721c33ce975118d1bf3f153c8ebb8945e5f60"
    });

    expect(snapshot).toMatchObject({
      provider: "local",
      riskScore: 90,
      labels: ["Tornado-funded actor", "Stargate recipient"]
    });
  });

  it("returns cloned transfer and risk snapshot objects", async () => {
    const [firstTransfer] = await provider.findTransfersByTx({
      chain: "ethereum",
      txHash: "0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f"
    });
    const firstSnapshot = await provider.getAddressRisk({
      chain: "ethereum",
      address: "0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60"
    });

    if (firstTransfer) {
      (firstTransfer.labels as string[]).push("mutated");
      firstTransfer.source.address = "mutated";
      (firstTransfer.evidenceRefs as unknown as Array<{ id: string }>)[0].id = "mutated";
      if (firstTransfer.payloadRef) {
        firstTransfer.payloadRef.endpoint = "mutated";
      }
    }
    if (firstSnapshot) {
      (firstSnapshot.labels as string[]).push("mutated");
      firstSnapshot.address.address = "mutated";
      (firstSnapshot.evidenceRefs as unknown as Array<{ id: string }>)[0].id = "mutated";
    }

    const [secondTransfer] = await provider.findTransfersByTx({
      chain: "ethereum",
      txHash: "0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f"
    });
    const secondSnapshot = await provider.getAddressRisk({
      chain: "ethereum",
      address: "0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60"
    });

    expect(secondTransfer?.source.address).toBe("0x2cFEEE2394aC0f01c92CDaDCb697feC0cF8Da315");
    expect(secondTransfer?.labels).not.toContain("mutated");
    expect(secondTransfer?.evidenceRefs[0]?.id).toBe(
      "cross_chain:range:ethereum:0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f:bridge_source"
    );
    expect(secondTransfer?.payloadRef?.endpoint).toBe("transfers/by-tx");
    expect(secondSnapshot?.address.address).toBe("0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60");
    expect(secondSnapshot?.labels).not.toContain("mutated");
    expect(secondSnapshot?.evidenceRefs[0]?.id).toBe(
      "cross_chain:local:ethereum:0x7c3721c33ce975118d1bf3f153c8ebb8945e5f60:tornado_context"
    );
  });

  it("does not match invalid or negative raw amounts", async () => {
    const baseTransfer = manualGaryStargateTornadoCase.data.transfers[0];
    const amountProvider = createFixtureCrossChainDiscoveryProvider({
      transfers: [
        { ...baseTransfer, id: "negative-amount", amountRaw: "-1" },
        { ...baseTransfer, id: "invalid-amount", amountRaw: "not-a-number" },
        { ...baseTransfer, id: "valid-amount", amountRaw: "100000000000" }
      ],
      riskSnapshots: []
    });

    await expect(amountProvider.findTransfersByAddress({
      address: "TGyTCHDm9k4r6QPvine8c6A3WWaqTBZAZD",
      minAmountRaw: "-1"
    })).resolves.toEqual([]);

    await expect(amountProvider.findTransfersByAddress({
      address: "TGyTCHDm9k4r6QPvine8c6A3WWaqTBZAZD",
      minAmountRaw: "bad"
    })).resolves.toEqual([]);

    await expect(amountProvider.findTransfersByAddress({
      address: "TGyTCHDm9k4r6QPvine8c6A3WWaqTBZAZD",
      minAmountRaw: ""
    })).resolves.toEqual([]);

    await expect(amountProvider.findTransfersByAddress({
      address: "TGyTCHDm9k4r6QPvine8c6A3WWaqTBZAZD",
      minAmountRaw: " 1 "
    })).resolves.toEqual([]);

    await expect(amountProvider.findTransfersByAddress({
      address: "TGyTCHDm9k4r6QPvine8c6A3WWaqTBZAZD",
      minAmountRaw: "1"
    })).resolves.toHaveLength(1);
  });
});
