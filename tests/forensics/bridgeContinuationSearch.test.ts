import { describe, expect, it } from "vitest";
import { createCrossChainProviderBudget } from "../../src/forensics/crossChainBudget";
import { runBridgeContinuationSearch } from "../../src/forensics/bridgeContinuationSearch";
import { bsc320kEdges, bsc320kSeed } from "../fixtures/forensics/bridgeContinuationCases";
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

function provider(
  rowsByAddress: Record<string, CrossChainContinuationEdge[]>,
  chain = "ethereum"
): ChainContinuationProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    chain,
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
      [seedAddress.toLowerCase()]: [edge({
        id: "weak-only",
        source: null,
        destination: null,
        score: 25
      })]
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

  it("returns partial data-exhausted when the seed address is missing", async () => {
    const searchProvider = provider({});

    const report = await runBridgeContinuationSearch({
      seed: seed({ address: null }),
      providers: [searchProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 2,
      beamWidth: 5
    });

    expect(report).toMatchObject({
      terminalBoundary: "data_exhausted",
      partial: true,
      edges: []
    });
    expect(searchProvider.calls).toEqual([]);
    expect(report.coverageNotes.join(" ")).toMatch(/missing.*address/i);
  });

  it("selects the continuation provider matching the seed chain", async () => {
    const ethereumProvider = provider({
      [seedAddress.toLowerCase()]: [edge({ id: "ethereum-edge" })]
    }, "ethereum");
    const tronProvider = provider({
      [seedAddress.toLowerCase()]: [edge({ id: "wrong-chain-edge" })]
    }, "tron");

    const report = await runBridgeContinuationSearch({
      seed: seed(),
      providers: [tronProvider, ethereumProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 1,
      beamWidth: 5
    });

    expect(report.edges.map((candidate) => candidate.id)).toEqual(["ethereum-edge"]);
    expect(ethereumProvider.calls).toEqual([seedAddress]);
    expect(tronProvider.calls).toEqual([]);
  });

  it("includes provider call counts and budget coverage notes", async () => {
    const searchProvider = provider({
      [seedAddress.toLowerCase()]: [edge({ id: "budgeted-edge" })]
    });
    const budget = createCrossChainProviderBudget({ maxProviderCalls: 0 });

    const report = await runBridgeContinuationSearch({
      seed: seed(),
      providers: [searchProvider],
      budget,
      maxDepth: 1,
      beamWidth: 5
    });

    expect(report.providerCalls).toBe(0);
    expect(report.partial).toBe(true);
    expect(report.coverageNotes.join(" ")).toMatch(/budget exhausted/i);
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

  it("dedupes edges by stable id and derives payload refs from evidence payload ids", async () => {
    const duplicateA = edge({
      id: "duplicate-edge",
      evidenceRefs: [{
        id: "cross_chain:range:ethereum:payload-a:token_transfer",
        provider: "range",
        payloadId: "range:payload:a",
        confidence: "provider_correlated"
      }, {
        id: "cross_chain:local:ethereum:payload-b:token_transfer",
        provider: "local",
        payloadId: "local:payload:b",
        confidence: "weak"
      }]
    });
    const duplicateB = edge({
      id: "duplicate-edge",
      score: 99,
      evidenceRefs: [{
        id: "cross_chain:range:ethereum:payload-a:duplicate",
        provider: "range",
        payloadId: "range:payload:a",
        confidence: "provider_correlated"
      }]
    });
    const searchProvider = provider({
      [seedAddress.toLowerCase()]: [duplicateA, duplicateB]
    });

    const report = await runBridgeContinuationSearch({
      seed: seed(),
      providers: [searchProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 1,
      beamWidth: 5
    });

    expect(report.edges.map((candidate) => candidate.id)).toEqual(["duplicate-edge"]);
    expect(report.payloadRefs).toEqual([
      {
        id: "range:payload:a",
        provider: "range",
        endpoint: "continuation/evidence",
        fetchedAt: "unknown"
      },
      {
        id: "local:payload:b",
        provider: "local",
        endpoint: "continuation/evidence",
        fetchedAt: "unknown"
      }
    ]);
  });

  it("upgrades duplicate edge ids when a later duplicate has accepted terminal proof", async () => {
    const searchProvider = provider({
      [seedAddress.toLowerCase()]: [
        edge({
          id: "duplicate-terminal",
          labels: ["same amount candidate"],
          continuationEvidenceClass: "weak_candidate",
          score: 90
        }),
        edge({
          id: "duplicate-terminal",
          destination: { chain: "ethereum", chainId: 1, address: tornadoAddress },
          protocol: "Tornado Cash",
          labels: ["mixer withdrawal"],
          evidenceRefs: [{
            id: "cross_chain:local:ethereum:tornado-duplicate:service_boundary",
            provider: "local",
            payloadId: null,
            confidence: "protocol_correlated"
          }],
          continuationEvidenceClass: "protocol_correlated",
          score: 50
        })
      ]
    });

    const report = await runBridgeContinuationSearch({
      seed: seed(),
      providers: [searchProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 1,
      beamWidth: 5
    });

    expect(report.terminalBoundary).toBe("tornado_or_mixer");
    expect(report.edges).toHaveLength(1);
    expect(report.edges[0]).toMatchObject({
      id: "duplicate-terminal",
      protocol: "Tornado Cash",
      continuationEvidenceClass: "protocol_correlated"
    });
  });

  it("sorts candidate edges by score and caps returned edges to beam width", async () => {
    const searchProvider = provider({
      [seedAddress.toLowerCase()]: [
        edge({ id: "middle", score: 50 }),
        edge({ id: "highest", score: 90 }),
        edge({ id: "lowest", score: 10 })
      ]
    });

    const report = await runBridgeContinuationSearch({
      seed: seed(),
      providers: [searchProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 1,
      beamWidth: 2
    });

    expect(report.edges.map((candidate) => candidate.id)).toEqual(["highest", "middle"]);
  });

  it("detects sanctioned-service, no-name liquidity, and bridge terminal boundaries", async () => {
    const sanctionedProvider = provider({
      [seedAddress.toLowerCase()]: [edge({
        id: "sanctioned-terminal",
        destination: { chain: "ethereum", chainId: 1, address: otherAddress },
        labels: ["LOCAL_EXACT_SANCTIONED: OFAC SDN service"],
        evidenceRefs: [{
          id: "cross_chain:local:ethereum:sanctioned:service_boundary",
          provider: "local",
          payloadId: null,
          confidence: "exact"
        }],
        continuationEvidenceClass: "protocol_correlated",
        score: 80
      })]
    });
    const liquidityProvider = provider({
      [seedAddress.toLowerCase()]: [edge({
        id: "liquidity-terminal",
        edgeType: "unknown_token_liquidity",
        evidenceRefs: [{
          id: "cross_chain:local:ethereum:liquidity:service_boundary",
          provider: "local",
          payloadId: null,
          confidence: "protocol_correlated"
        }],
        continuationEvidenceClass: "protocol_correlated",
        score: 80
      })]
    });
    const bridgeProvider = provider({
      [seedAddress.toLowerCase()]: [edge({
        id: "bridge-terminal",
        edgeType: "bridge_protocol_link",
        protocol: "LayerZero/Stargate",
        continuationEvidenceClass: "strong_amount_time",
        score: 80
      })]
    });

    await expect(runBridgeContinuationSearch({
      seed: seed(),
      providers: [sanctionedProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 1,
      beamWidth: 5
    })).resolves.toMatchObject({ terminalBoundary: "sanctioned_service" });
    await expect(runBridgeContinuationSearch({
      seed: seed(),
      providers: [liquidityProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 1,
      beamWidth: 5
    })).resolves.toMatchObject({ terminalBoundary: "no_name_token_liquidity" });
    await expect(runBridgeContinuationSearch({
      seed: seed(),
      providers: [bridgeProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 1,
      beamWidth: 5
    })).resolves.toMatchObject({ terminalBoundary: "bridge_boundary" });
  });

  it("keeps the accepted terminal edge in the report even when a higher-score candidate would otherwise fill the cap", async () => {
    const searchProvider = provider({
      [seedAddress.toLowerCase()]: [
        edge({ id: "high-score-candidate", score: 100 }),
        edge({
          id: "lower-score-terminal",
          destination: { chain: "ethereum", chainId: 1, address: tornadoAddress },
          protocol: "Tornado Cash",
          evidenceRefs: [{
            id: "cross_chain:local:ethereum:tornado:service_boundary",
            provider: "local",
            payloadId: null,
            confidence: "protocol_correlated"
          }],
          continuationEvidenceClass: "protocol_correlated",
          score: 20
        })
      ]
    });

    const report = await runBridgeContinuationSearch({
      seed: seed(),
      providers: [searchProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 1,
      beamWidth: 1
    });

    expect(report.terminalBoundary).toBe("tornado_or_mixer");
    expect(report.edges.map((candidate) => candidate.id)).toEqual(["lower-score-terminal"]);
  });

  it("caps returned edges when multiple accepted terminal edges exist", async () => {
    const searchProvider = provider({
      [seedAddress.toLowerCase()]: [
        edge({
          id: "lower-terminal",
          destination: { chain: "ethereum", chainId: 1, address: tornadoAddress },
          protocol: "Tornado Cash",
          evidenceRefs: [{
            id: "cross_chain:local:ethereum:tornado-lower:service_boundary",
            provider: "local",
            payloadId: null,
            confidence: "protocol_correlated"
          }],
          continuationEvidenceClass: "protocol_correlated",
          score: 20
        }),
        edge({
          id: "higher-terminal",
          destination: { chain: "ethereum", chainId: 1, address: tornadoAddress },
          protocol: "Tornado Cash",
          evidenceRefs: [{
            id: "cross_chain:local:ethereum:tornado-higher:service_boundary",
            provider: "local",
            payloadId: null,
            confidence: "protocol_correlated"
          }],
          continuationEvidenceClass: "protocol_correlated",
          score: 40
        })
      ]
    });

    const report = await runBridgeContinuationSearch({
      seed: seed(),
      providers: [searchProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 1,
      beamWidth: 1
    });

    expect(report.terminalBoundary).toBe("tornado_or_mixer");
    expect(report.edges).toHaveLength(1);
    expect(report.edges[0]?.id).toBe("higher-terminal");
  });

  it("marks candidate-only results partial when maxDepth leaves continuation addresses unexplored", async () => {
    const searchProvider = provider({
      [seedAddress.toLowerCase()]: [edge({
        id: "first-hop",
        destination: { chain: "ethereum", chainId: 1, address: midAddress },
        continuationEvidenceClass: "strong_amount_time",
        score: 80
      })],
      [midAddress.toLowerCase()]: [edge({ id: "unreached" })]
    });

    const report = await runBridgeContinuationSearch({
      seed: seed(),
      providers: [searchProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 1,
      beamWidth: 5
    });

    expect(report.terminalBoundary).toBe("candidate_only");
    expect(report.partial).toBe(true);
    expect(report.coverageNotes.join(" ")).toMatch(/bounded|truncated|maxDepth/i);
  });

  it("marks candidate-only results partial when beam width drops continuation candidates", async () => {
    const searchProvider = provider({
      [seedAddress.toLowerCase()]: [
        edge({
          id: "kept-frontier",
          destination: { chain: "ethereum", chainId: 1, address: midAddress },
          continuationEvidenceClass: "strong_amount_time",
          score: 90
        }),
        edge({
          id: "dropped-frontier",
          destination: { chain: "ethereum", chainId: 1, address: otherAddress },
          continuationEvidenceClass: "strong_amount_time",
          score: 80
        })
      ],
      [midAddress.toLowerCase()]: []
    });

    const report = await runBridgeContinuationSearch({
      seed: seed(),
      providers: [searchProvider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 }),
      maxDepth: 2,
      beamWidth: 1
    });

    expect(report.terminalBoundary).toBe("candidate_only");
    expect(report.partial).toBe(true);
    expect(report.coverageNotes.join(" ")).toMatch(/beam|truncated/i);
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

  it("keeps the 320k BSC Allbridge split continuation candidate-only with the large edge present", async () => {
    const report = await runBridgeContinuationSearch({
      seed: bsc320kSeed,
      providers: [{
        chain: "bsc",
        async listEdgesForAddress(input) {
          return input.budget.run("local", "fixture:bsc-320k", async () => bsc320kEdges);
        }
      }],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 }),
      maxDepth: 2,
      beamWidth: 4
    });

    expect(report.terminalBoundary).toBe("candidate_only");
    expect(report.partial).toBe(false);
    expect(report.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "bsc-usdt-large",
        amountRaw: "309889218851"
      })
    ]));
  });
});
