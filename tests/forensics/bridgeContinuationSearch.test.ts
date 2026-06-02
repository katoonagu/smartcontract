import { describe, expect, it } from "vitest";
import { createCrossChainProviderBudget } from "../../src/forensics/crossChainBudget";
import { runBridgeContinuationSearch } from "../../src/forensics/bridgeContinuationSearch";
import type {
  ChainContinuationProvider,
  CrossChainContinuationEdge,
  CrossChainContinuationSeed
} from "../../src/forensics/crossChainContinuationTypes";

const seedAddress = "0x1111111111111111111111111111111111111111";
const midAddress = "0x2222222222222222222222222222222222222222";
const otherAddress = "0x3333333333333333333333333333333333333333";
const tornadoAddress = "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b";

function seed(overrides: Partial<CrossChainContinuationSeed> = {}): CrossChainContinuationSeed {
  return {
    id: "seed:ethereum:bridge",
    chain: "ethereum",
    address: seedAddress,
    txHash: "0xseed",
    amountRaw: "100000000000",
    assetSymbol: "USDT",
    timestamp: "2026-05-05T02:41:59.000Z",
    labels: ["LayerZero", "Stargate"],
    evidenceRefs: [],
    ...overrides
  };
}

function edge(overrides: Partial<CrossChainContinuationEdge> = {}): CrossChainContinuationEdge {
  return {
    id: "edge",
    edgeType: "token_transfer",
    source: { chain: "ethereum", chainId: 1, address: seedAddress },
    destination: { chain: "ethereum", chainId: 1, address: midAddress },
    txHash: "0xedge",
    amountRaw: "100000000000",
    assetSymbol: "USDT",
    timestamp: "2026-05-05T03:00:00.000Z",
    protocol: null,
    evidenceRefs: [{
      id: "cross_chain:local:ethereum:0xedge:token_transfer",
      provider: "local",
      payloadId: null,
      confidence: "weak"
    }],
    labels: [],
    continuationEvidenceClass: "weak_candidate",
    score: 10,
    reasons: [],
    ...overrides
  };
}

function provider(rowsByAddress: Record<string, CrossChainContinuationEdge[]>): ChainContinuationProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    chain: "ethereum",
    calls,
    async listEdgesForAddress(input) {
      calls.push(input.address.address);
      return input.budget.run("local", `continuation:${input.address.address.toLowerCase()}`, async () =>
        rowsByAddress[input.address.address.toLowerCase()] ?? []
      );
    }
  };
}

describe("runBridgeContinuationSearch", () => {
  it("accepts protocol-correlated Tornado evidence as a terminal boundary", async () => {
    const searchProvider = provider({
      [seedAddress.toLowerCase()]: [edge({
        id: "tornado-protocol",
        edgeType: "tornado_withdrawal",
        destination: { chain: "ethereum", chainId: 1, address: tornadoAddress },
        protocol: "Tornado Cash",
        labels: ["mixer withdrawal"],
        evidenceRefs: [{
          id: "cross_chain:local:ethereum:tornado:service_boundary",
          provider: "local",
          payloadId: null,
          confidence: "protocol_correlated"
        }],
        continuationEvidenceClass: "protocol_correlated",
        score: 95
      })]
    });

    const report = await runBridgeContinuationSearch({
      seed: seed(),
      providers: [searchProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 2,
      beamWidth: 5
    });

    expect(report.terminalBoundary).toBe("tornado_or_mixer");
    expect(report.partial).toBe(false);
    expect(report.edges.map((candidate) => candidate.id)).toEqual(["tornado-protocol"]);
  });

  it("keeps weak evidence candidate-only and explains the candidate status", async () => {
    const searchProvider = provider({
      [seedAddress.toLowerCase()]: [edge({ id: "weak-only", score: 25 })]
    });

    const report = await runBridgeContinuationSearch({
      seed: seed(),
      providers: [searchProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 1,
      beamWidth: 5
    });

    expect(report.terminalBoundary).toBe("candidate_only");
    expect(report.partial).toBe(false);
    expect(report.coverageNotes.join(" ")).toMatch(/candidate/i);
  });

  it("returns partial data-exhausted when the seed chain is unsupported", async () => {
    const report = await runBridgeContinuationSearch({
      seed: seed({ chain: "solana" }),
      providers: [provider({})],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 2,
      beamWidth: 5
    });

    expect(report).toMatchObject({
      enabled: true,
      terminalBoundary: "data_exhausted",
      partial: true,
      edges: []
    });
    expect(report.coverageNotes.join(" ")).toMatch(/provider.*solana/i);
  });

  it("marks provider failures partial instead of throwing", async () => {
    const failingProvider: ChainContinuationProvider = {
      chain: "ethereum",
      async listEdgesForAddress() {
        throw new Error("local continuation unavailable");
      }
    };

    const report = await runBridgeContinuationSearch({
      seed: seed(),
      providers: [failingProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 2,
      beamWidth: 5
    });

    expect(report.terminalBoundary).toBe("data_exhausted");
    expect(report.partial).toBe(true);
    expect(report.coverageNotes.join(" ")).toMatch(/provider.*failed.*unavailable/i);
  });

  it("gates strong amount-time Tornado-looking edges to candidate-only", async () => {
    const searchProvider = provider({
      [seedAddress.toLowerCase()]: [edge({
        id: "strong-tornado-looking",
        edgeType: "tornado_withdrawal",
        destination: { chain: "ethereum", chainId: 1, address: tornadoAddress },
        labels: ["Tornado Cash"],
        continuationEvidenceClass: "strong_amount_time",
        score: 70
      })]
    });

    const report = await runBridgeContinuationSearch({
      seed: seed(),
      providers: [searchProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 2,
      beamWidth: 5
    });

    expect(report.terminalBoundary).toBe("candidate_only");
    expect(report.coverageNotes.join(" ")).toMatch(/candidate/i);
  });

  it("bounds expansion by depth and beam width and stops when a terminal is found", async () => {
    const continuationEdge = edge({
      id: "first-hop",
      destination: { chain: "ethereum", chainId: 1, address: midAddress },
      continuationEvidenceClass: "strong_amount_time",
      score: 80
    });
    const lowerRankedEdge = edge({
      id: "lower-ranked-hop",
      destination: { chain: "ethereum", chainId: 1, address: otherAddress },
      continuationEvidenceClass: "strong_amount_time",
      score: 50
    });
    const terminalEdge = edge({
      id: "second-hop-terminal",
      source: { chain: "ethereum", chainId: 1, address: midAddress },
      destination: { chain: "ethereum", chainId: 1, address: tornadoAddress },
      protocol: "Tornado Cash",
      evidenceRefs: [{
        id: "cross_chain:local:ethereum:tornado:service_boundary",
        provider: "local",
        payloadId: null,
        confidence: "protocol_correlated"
      }],
      continuationEvidenceClass: "protocol_correlated",
      score: 95
    });

    const depthOneProvider = provider({
      [seedAddress.toLowerCase()]: [continuationEdge, lowerRankedEdge],
      [midAddress.toLowerCase()]: [terminalEdge]
    });
    const depthOne = await runBridgeContinuationSearch({
      seed: seed(),
      providers: [depthOneProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 1,
      beamWidth: 1
    });
    expect(depthOne.terminalBoundary).toBe("candidate_only");
    expect(depthOneProvider.calls).toEqual([seedAddress]);

    const depthTwoProvider = provider({
      [seedAddress.toLowerCase()]: [continuationEdge, lowerRankedEdge],
      [midAddress.toLowerCase()]: [terminalEdge],
      [otherAddress.toLowerCase()]: [terminalEdge]
    });
    const depthTwo = await runBridgeContinuationSearch({
      seed: seed(),
      providers: [depthTwoProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 2,
      beamWidth: 1
    });
    expect(depthTwo.terminalBoundary).toBe("tornado_or_mixer");
    expect(depthTwoProvider.calls).toEqual([seedAddress, midAddress]);

    const terminalFirstProvider = provider({
      [seedAddress.toLowerCase()]: [terminalEdge, continuationEdge]
    });
    const terminalFirst = await runBridgeContinuationSearch({
      seed: seed(),
      providers: [terminalFirstProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 2,
      beamWidth: 2
    });
    expect(terminalFirst.terminalBoundary).toBe("tornado_or_mixer");
    expect(terminalFirstProvider.calls).toEqual([seedAddress]);
  });
});
