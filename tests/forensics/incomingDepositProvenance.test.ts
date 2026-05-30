import { describe, expect, it } from "vitest";
import type { ForensicRouteEdge, ServiceClassification } from "../../src/types";
import { traceIncomingDepositProvenance } from "../../src/forensics/incomingDepositProvenance";

function edge(id: string, fromAddress: string, toAddress: string, amountRaw: string, timestamp: string): ForensicRouteEdge {
  return {
    id,
    txHash: id,
    fromAddress,
    toAddress,
    amountRaw,
    timestamp: new Date(timestamp),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

describe("traceIncomingDepositProvenance", () => {
  it("finds smart-contract funding before the incoming deposit even when sender current balance is zero", async () => {
    const sender = "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs";
    const watchedWallet = "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM";
    const contract = "TFcRN111111111111111111111111FLR5hvh";
    const deposit = edge("48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b", sender, watchedWallet, "384064001319", "2026-05-29T14:01:00.000Z");
    const edgesByAddress = new Map<string, ForensicRouteEdge[]>([
      [sender, [
        edge("contract-in-1", contract, sender, "117568000000", "2026-05-29T13:30:00.000Z"),
        edge("contract-in-2", contract, sender, "37000000000", "2026-05-29T13:35:00.000Z"),
        edge("contract-in-3", contract, sender, "30045000000", "2026-05-29T13:40:00.000Z"),
        deposit
      ]],
      [contract, []]
    ]);

    const report = await traceIncomingDepositProvenance({
      deposit,
      maxDepth: 4,
      fetchEdgesForAddress: async (address) => edgesByAddress.get(address) ?? [],
      getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
        address === contract
          ? { category: "unknown_contract", identity: null, confidence: "medium", evidence: ["test contract"], isBoundary: true }
          : null
    });

    expect(report.paths[0]?.stoppedReason).toBe("unknown_contract_reached");
    expect(report.paths[0]?.pathAddresses).toContain(contract);
    expect(report.originCoverage).toBeGreaterThan(0.45);
  });

  it("keeps terminal no-previous-transfer steps in origin-to-deposit order after an upstream hop", async () => {
    const sender = "TESender11111111111111111111111111111";
    const watchedWallet = "TEWatched111111111111111111111111111";
    const sourceB = "TBSource11111111111111111111111111111";
    const deposit = edge("deposit", sender, watchedWallet, "100000000", "2026-05-29T14:01:00.000Z");
    const bToSender = edge("b-to-sender", sourceB, sender, "100000000", "2026-05-29T13:55:00.000Z");
    const edgesByAddress = new Map<string, ForensicRouteEdge[]>([
      [sender, [bToSender, deposit]],
      [sourceB, []]
    ]);

    const report = await traceIncomingDepositProvenance({
      deposit,
      maxDepth: 4,
      fetchEdgesForAddress: async (address) => edgesByAddress.get(address) ?? [],
      getClassificationForAddress: async (): Promise<ServiceClassification | null> => null
    });

    expect(report.paths[0]?.stoppedReason).toBe("no_previous_transfer");
    expect(report.paths[0]?.steps.map((item) => item.txHash)).toEqual(["b-to-sender", "deposit"]);
    expect(report.paths[0]?.txHashes).toEqual(["b-to-sender", "deposit"]);
    expect(report.paths[0]?.pathAddresses).toEqual([sourceB, sender, watchedWallet]);
  });

  it.each(["HTX", "Huobi"])("hard-declines close incoming deposit provenance from %s", async (identity) => {
    const sender = "TESender11111111111111111111111111111";
    const watchedWallet = "TEWatched111111111111111111111111111";
    const cex = "TCex1111111111111111111111111111111";
    const deposit = edge("deposit", sender, watchedWallet, "100000000", "2026-05-29T14:01:00.000Z");
    const cexToSender = edge("cex-to-sender", cex, sender, "100000000", "2026-05-29T13:55:00.000Z");
    const edgesByAddress = new Map<string, ForensicRouteEdge[]>([[sender, [cexToSender, deposit]]]);

    const report = await traceIncomingDepositProvenance({
      deposit,
      maxDepth: 4,
      fetchEdgesForAddress: async (address) => edgesByAddress.get(address) ?? [],
      getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
        address === cex
          ? { category: "cex", identity, confidence: "high", evidence: [`tag:${identity}`], isBoundary: true }
          : null
    });

    expect(report.paths[0]).toMatchObject({
      stoppedReason: "htx_huobi_reached",
      sourcePolicy: "hard_decline",
      verdict: "DECLINE"
    });
  });

  it.each(["Coinbase", "Kraken", "KuCoin", "Bitget", "MEXC", "Bitstamp", "Crypto.com"])(
    "accepts close incoming deposit provenance from clean CEX %s",
    async (identity) => {
      const sender = "TESender11111111111111111111111111111";
      const watchedWallet = "TEWatched111111111111111111111111111";
      const cex = "TCleanCex11111111111111111111111111";
      const deposit = edge("deposit", sender, watchedWallet, "100000000", "2026-05-29T14:01:00.000Z");
      const cexToSender = edge("cex-to-sender", cex, sender, "100000000", "2026-05-29T13:55:00.000Z");
      const edgesByAddress = new Map<string, ForensicRouteEdge[]>([[sender, [cexToSender, deposit]]]);

      const report = await traceIncomingDepositProvenance({
        deposit,
        maxDepth: 4,
        fetchEdgesForAddress: async (address) => edgesByAddress.get(address) ?? [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === cex
            ? { category: "cex", identity, confidence: "high", evidence: [`tag:${identity}`], isBoundary: true }
            : null
      });

      expect(report.paths[0]).toMatchObject({
        stoppedReason: "clean_cex_reached",
        sourcePolicy: "clean",
        verdict: "ACCEPTABLE",
        score: 5
      });
    }
  );

  it("hard-declines close incoming deposit provenance from swap adapters", async () => {
    const sender = "TESender11111111111111111111111111111";
    const watchedWallet = "TEWatched111111111111111111111111111";
    const adapter = "TSwapAdapter111111111111111111111111";
    const deposit = edge("deposit", sender, watchedWallet, "100000000", "2026-05-29T14:01:00.000Z");
    const adapterToSender = edge("adapter-to-sender", adapter, sender, "100000000", "2026-05-29T13:55:00.000Z");
    const edgesByAddress = new Map<string, ForensicRouteEdge[]>([[sender, [adapterToSender, deposit]]]);

    const report = await traceIncomingDepositProvenance({
      deposit,
      maxDepth: 4,
      fetchEdgesForAddress: async (address) => edgesByAddress.get(address) ?? [],
      getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
        address === adapter
          ? { category: "swap_adapter", identity: "Swap Adapter", confidence: "high", evidence: ["tag:adapter"], isBoundary: true }
          : null
    });

    expect(report.paths[0]).toMatchObject({
      stoppedReason: "bridge_router_dex_reached",
      sourcePolicy: "hard_decline",
      verdict: "DECLINE"
    });
    expect(report.paths[0]?.score).toBeGreaterThanOrEqual(70);
  });

  it("treats close WhiteBIT provenance as medium policy instead of hard decline", async () => {
    const sender = "TESender11111111111111111111111111111";
    const watchedWallet = "TEWatched111111111111111111111111111";
    const whitebit = "TWhiteBIT11111111111111111111111111";
    const deposit = edge("deposit", sender, watchedWallet, "100000000", "2026-05-29T14:01:00.000Z");
    const whitebitToSender = edge("whitebit-to-sender", whitebit, sender, "100000000", "2026-05-29T13:55:00.000Z");
    const edgesByAddress = new Map<string, ForensicRouteEdge[]>([[sender, [whitebitToSender, deposit]]]);

    const report = await traceIncomingDepositProvenance({
      deposit,
      maxDepth: 4,
      fetchEdgesForAddress: async (address) => edgesByAddress.get(address) ?? [],
      getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
        address === whitebit
          ? { category: "cex", identity: "WhiteBIT", confidence: "high", evidence: ["tag:WhiteBIT"], isBoundary: true }
          : null
    });

    expect(report.paths[0]).toMatchObject({
      stoppedReason: "whitebit_reached",
      sourcePolicy: "medium_policy",
      verdict: "DECLINE"
    });
    expect(report.paths[0]?.score).toBeGreaterThanOrEqual(45);
    expect(report.paths[0]?.score).toBeLessThan(70);
  });
});
