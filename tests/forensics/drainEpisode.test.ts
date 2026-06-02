import { describe, expect, it } from "vitest";
import { detectDrainEpisode } from "../../src/forensics/drainEpisode";
import type { ForensicRouteEdge } from "../../src/types";

function edge(txHash: string, fromAddress: string, toAddress: string, amountRaw: string, timestamp: string): ForensicRouteEdge {
  return {
    id: txHash,
    txHash,
    fromAddress,
    toAddress,
    amountRaw,
    timestamp: new Date(timestamp),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

describe("drain episode detection", () => {
  it("detects bridge/adapter drain episode after a large inbound", () => {
    const episode = detectDrainEpisode({
      subjectAddress: "TLhV",
      anchorTxHash: "anchor-135k",
      edges: [
        edge("in-1885k", "TUU1", "TLhV", "1885262475832", "2026-05-05T13:31:30.000Z"),
        edge("out-200k-a", "TLhV", "TPwez", "199994920000", "2026-05-05T13:57:27.000Z"),
        edge("out-200k-b", "TLhV", "TPwez", "199994920000", "2026-05-05T13:58:45.000Z"),
        edge("out-200k-c", "TLhV", "TUrnbc", "200007090000", "2026-05-05T14:23:18.000Z"),
        edge("anchor-135k", "TLhV", "TPwez", "135300000000", "2026-05-05T15:00:30.000Z")
      ],
      serviceAddresses: new Set(["tpwez", "turnbc"])
    });

    expect(episode).toMatchObject({
      anchorTxHash: "anchor-135k",
      episodeOutgoingRaw: "735296930000",
      bridgeOutgoingRaw: "735296930000",
      bridgeOutgoingShare: 1
    });
    expect(episode?.outgoingTxHashes).toEqual(["out-200k-a", "out-200k-b", "out-200k-c", "anchor-135k"]);
  });
});
