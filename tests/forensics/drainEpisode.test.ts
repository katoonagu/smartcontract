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

  it("returns null when the anchor is the only outgoing transfer in scope", () => {
    const episode = detectDrainEpisode({
      subjectAddress: "TLhV",
      anchorTxHash: "anchor-only",
      edges: [
        edge("anchor-only", "TLhV", "TPwez", "135300000000", "2026-05-05T15:00:30.000Z")
      ],
      serviceAddresses: new Set(["tpwez"])
    });

    expect(episode).toBeNull();
  });

  it("ignores outgoing transfers outside the drain window", () => {
    const episode = detectDrainEpisode({
      subjectAddress: "TLhV",
      anchorTxHash: "anchor-135k",
      edges: [
        edge("outside-window", "TLhV", "TPwez", "500000000000", "2026-05-04T14:00:00.000Z"),
        edge("inside-window", "TLhV", "TPwez", "200000000000", "2026-05-05T14:00:00.000Z"),
        edge("anchor-135k", "TLhV", "TPwez", "135300000000", "2026-05-05T15:00:30.000Z")
      ],
      serviceAddresses: new Set(["tpwez"])
    });

    expect(episode).toMatchObject({
      episodeOutgoingRaw: "335300000000",
      bridgeOutgoingRaw: "335300000000"
    });
    expect(episode?.outgoingTxHashes).toEqual(["inside-window", "anchor-135k"]);
  });

  it("matches subject and service addresses case-insensitively", () => {
    const episode = detectDrainEpisode({
      subjectAddress: "tlhv",
      anchorTxHash: "anchor-135k",
      edges: [
        edge("out-200k", "TLhV", "TPwez", "200000000000", "2026-05-05T14:00:00.000Z"),
        edge("anchor-135k", "tLHv", "tPWEZ", "135300000000", "2026-05-05T15:00:30.000Z")
      ],
      serviceAddresses: new Set(["tpwez"])
    });

    expect(episode).toMatchObject({
      episodeOutgoingRaw: "335300000000",
      bridgeOutgoingRaw: "335300000000",
      bridgeOutgoingShare: 1
    });
  });

  it("ignores zero and non-numeric outgoing amounts", () => {
    const episode = detectDrainEpisode({
      subjectAddress: "TLhV",
      anchorTxHash: "anchor-135k",
      edges: [
        edge("zero", "TLhV", "TPwez", "0", "2026-05-05T13:00:00.000Z"),
        edge("non-numeric", "TLhV", "TPwez", "bad", "2026-05-05T13:30:00.000Z"),
        edge("valid", "TLhV", "TPwez", "200000000000", "2026-05-05T14:00:00.000Z"),
        edge("anchor-135k", "TLhV", "TPwez", "135300000000", "2026-05-05T15:00:30.000Z")
      ],
      serviceAddresses: new Set(["tpwez"])
    });

    expect(episode).toMatchObject({
      episodeOutgoingRaw: "335300000000",
      bridgeOutgoingRaw: "335300000000"
    });
    expect(episode?.outgoingTxHashes).toEqual(["valid", "anchor-135k"]);
  });
});
