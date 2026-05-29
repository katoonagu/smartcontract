import { describe, expect, it } from "vitest";
import type { ForensicRouteEdge } from "../../src/types";
import { selectIncomingDepositFundingCandidates } from "../../src/forensics/incomingDepositCashflow";

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

describe("selectIncomingDepositFundingCandidates", () => {
  it("uses sender cashflow before the deposit timestamp instead of current balance", () => {
    const sender = "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs";
    const watchedWallet = "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM";
    const contract = "TFcRN111111111111111111111111FLR5hvh";
    const other = "TOther111111111111111111111111111111";

    const result = selectIncomingDepositFundingCandidates({
      sender,
      watchedWallet,
      depositAmountRaw: "384064001319",
      depositTimestamp: new Date("2026-05-29T14:01:00.000Z"),
      edges: [
        edge("contract-in-1", contract, sender, "117568000000", "2026-05-29T13:30:00.000Z"),
        edge("contract-in-2", contract, sender, "37000000000", "2026-05-29T13:35:00.000Z"),
        edge("contract-in-3", contract, sender, "30045000000", "2026-05-29T13:40:00.000Z"),
        edge("other-in", other, sender, "250000000000", "2026-05-29T13:45:00.000Z"),
        edge("deposit", sender, watchedWallet, "384064001319", "2026-05-29T14:01:00.000Z")
      ]
    });

    expect(result.coverageRatio).toBeGreaterThan(0.9);
    expect(result.candidates.map((item) => item.edge.txHash)).toEqual([
      "other-in",
      "contract-in-3",
      "contract-in-2",
      "contract-in-1"
    ]);
    expect(result.amountContinuity).toBe("strong");
  });

  it("penalizes funding that was likely spent before the watched-wallet deposit", () => {
    const sender = "TSender111111111111111111111111111111";
    const watchedWallet = "TWatched1111111111111111111111111111";
    const funder = "TFunder111111111111111111111111111111";
    const sink = "TSink11111111111111111111111111111111";

    const result = selectIncomingDepositFundingCandidates({
      sender,
      watchedWallet,
      depositAmountRaw: "384000000000",
      depositTimestamp: new Date("2026-05-29T14:00:00.000Z"),
      edges: [
        edge("old-in", funder, sender, "500000000000", "2026-05-29T12:00:00.000Z"),
        edge("spent-before", sender, sink, "300000000000", "2026-05-29T13:00:00.000Z"),
        edge("new-in", funder, sender, "250000000000", "2026-05-29T13:30:00.000Z"),
        edge("deposit", sender, watchedWallet, "384000000000", "2026-05-29T14:00:00.000Z")
      ]
    });

    expect(result.candidates[0]?.edge.txHash).toBe("new-in");
    expect(result.coverageRatio).toBeGreaterThan(0.5);
    expect(result.amountContinuity).toBe("medium");
  });
});
