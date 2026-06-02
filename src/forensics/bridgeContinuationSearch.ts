import type {
  CrossChainAddress,
  CrossChainContinuationEdge,
  CrossChainContinuationReport,
  CrossChainContinuationSeed,
  CrossChainTerminalBoundary
} from "../types";
import { terminalAllowedForContinuationClass } from "./bridgeContinuationScorer";
import type { CrossChainProviderBudget } from "./crossChainBudget";
import {
  detectBridgeServiceBoundary,
  detectKnownMixerOrSanctionedService
} from "./crossChainDetectors";
import type { ChainContinuationProvider } from "./crossChainContinuationTypes";

export type RunBridgeContinuationSearchInput = {
  seed: CrossChainContinuationSeed;
  providers: ChainContinuationProvider[];
  budget: CrossChainProviderBudget;
  maxDepth: number;
  beamWidth: number;
};

type FrontierAddress = {
  address: CrossChainAddress;
  score: number;
};

type SearchState = {
  provider: ChainContinuationProvider;
  seed: CrossChainContinuationSeed;
  budget: CrossChainProviderBudget;
  width: number;
  maxDepth: number;
  edgesById: Map<string, CrossChainContinuationEdge>;
  notes: string[];
  partial: boolean;
  terminalFound: boolean;
};

const CHAIN_IDS: Record<string, string | number> = {
  ethereum: 1,
  arbitrum: 42161,
  bsc: 56,
  tron: "tron-mainnet"
};

const TERMINAL_PRIORITY: Record<CrossChainTerminalBoundary, number> = {
  sanctioned_service: 60,
  tornado_or_mixer: 55,
  no_name_token_liquidity: 50,
  bridge_boundary: 40,
  dex_router_boundary: 30,
  unknown_contract: 25,
  candidate_only: 10,
  data_exhausted: 5,
  none: 0
};

export async function runBridgeContinuationSearch(
  input: RunBridgeContinuationSearchInput
): Promise<CrossChainContinuationReport> {
  const provider = providerForSeed(input.providers, input.seed);
  const missingSeedAddress = !input.seed.address?.trim();
  const preflightNotes = preflightCoverageNotes(input.seed, provider, missingSeedAddress);

  if (!provider || missingSeedAddress) {
    return report({
      seed: input.seed,
      terminalBoundary: "data_exhausted",
      edges: [],
      budget: input.budget,
      partial: true,
      notes: preflightNotes
    });
  }

  const width = normalizePositiveInteger(input.beamWidth);
  const maxDepth = normalizeDepth(input.maxDepth);
  if (maxDepth === 0) {
    return report({
      seed: input.seed,
      terminalBoundary: "data_exhausted",
      edges: [],
      budget: input.budget,
      partial: true,
      notes: ["Bridge continuation search maxDepth prevented provider expansion."]
    });
  }

  const state: SearchState = {
    provider,
    seed: input.seed,
    budget: input.budget,
    width,
    maxDepth,
    edgesById: new Map(),
    notes: [],
    partial: false,
    terminalFound: false
  };

  await searchFrontier(state, [{
    address: addressForSeed(input.seed),
    score: Number.POSITIVE_INFINITY
  }]);

  const edges = sortedEdges(state.edgesById).slice(0, width);
  const terminalBoundary = terminalBoundaryForEdges(state.edgesById);
  const notes = terminalBoundary === "candidate_only"
    ? [...state.notes, "Bridge continuation search returned candidate-only edges without accepted terminal proof."]
    : state.notes;

  return report({
    seed: input.seed,
    terminalBoundary,
    edges,
    budget: input.budget,
    partial: state.partial || terminalBoundary === "data_exhausted",
    notes
  });
}

async function searchFrontier(state: SearchState, initialFrontier: FrontierAddress[]): Promise<void> {
  let frontier = initialFrontier;
  const visited = new Set<string>();

  for (let depth = 0; depth < state.maxDepth && frontier.length > 0 && !state.terminalFound; depth += 1) {
    const nextCandidates: FrontierAddress[] = [];

    for (const item of frontier.slice(0, state.width)) {
      const key = addressKey(item.address);
      if (visited.has(key)) continue;
      visited.add(key);

      const edges = await loadEdges(state, item.address);
      const addressNextCandidates: FrontierAddress[] = [];
      let addressFoundTerminal = false;

      for (const edge of edges) {
        if (!state.edgesById.has(edge.id)) {
          state.edgesById.set(edge.id, edge);
        }

        const terminal = detectTerminalBoundary(edge);
        if (terminal !== "none") {
          if (terminalAllowedForContinuationClass(terminal, edge.continuationEvidenceClass)) {
            state.terminalFound = true;
            addressFoundTerminal = true;
            continue;
          }

          state.notes.push(
            `Bridge continuation edge ${edge.id} looked like ${terminal}, but ${edge.continuationEvidenceClass} evidence is candidate-only for that terminal.`
          );
          continue;
        }

        for (const nextAddress of continuationAddresses(state.provider, item.address, edge)) {
          if (!visited.has(addressKey(nextAddress))) {
            addressNextCandidates.push({ address: nextAddress, score: edge.score });
          }
        }
      }

      if (!addressFoundTerminal) {
        nextCandidates.push(...addressNextCandidates);
      }

      if (state.terminalFound) break;
    }

    frontier = dedupeFrontier(nextCandidates)
      .sort((left, right) => right.score - left.score)
      .slice(0, state.width);
  }
}

async function loadEdges(state: SearchState, address: CrossChainAddress): Promise<CrossChainContinuationEdge[]> {
  try {
    return await state.provider.listEdgesForAddress({
      address,
      seed: state.seed,
      budget: state.budget
    });
  } catch (error) {
    state.partial = true;
    state.notes.push(providerFailureNote(state.provider, address, error));
    return [];
  }
}

function detectTerminalBoundary(edge: CrossChainContinuationEdge): CrossChainTerminalBoundary {
  const labels = labelsForDetection(edge);
  for (const address of [edge.destination, edge.source]) {
    const result = detectKnownMixerOrSanctionedService({
      chain: String(address?.chain ?? ""),
      address: address?.address ?? null,
      labels,
      protocol: edge.protocol,
      evidenceRefs: edge.evidenceRefs
    });

    if (result.terminalBoundary === "tornado_or_mixer" || result.terminalBoundary === "sanctioned_service") {
      return result.terminalBoundary;
    }
  }

  if (edge.edgeType === "unknown_token_liquidity") {
    return "no_name_token_liquidity";
  }

  if (edge.edgeType === "bridge_source" || edge.edgeType === "bridge_destination" || edge.edgeType === "bridge_protocol_link") {
    return "bridge_boundary";
  }

  const bridge = detectBridgeServiceBoundary({
    chain: String(edge.destination?.chain ?? edge.source?.chain ?? ""),
    address: edge.destination?.address ?? edge.source?.address ?? null,
    labels,
    protocol: edge.protocol,
    evidenceRefs: edge.evidenceRefs
  });
  return bridge.terminalBoundary === "bridge_boundary" ? "bridge_boundary" : "none";
}

function terminalBoundaryForEdges(edgesById: Map<string, CrossChainContinuationEdge>): CrossChainTerminalBoundary {
  const edges = sortedEdges(edgesById);
  let best: CrossChainTerminalBoundary = "none";

  for (const edge of edges) {
    const terminal = detectTerminalBoundary(edge);
    if (terminal === "none") continue;
    if (!terminalAllowedForContinuationClass(terminal, edge.continuationEvidenceClass)) continue;
    if (TERMINAL_PRIORITY[terminal] > TERMINAL_PRIORITY[best]) {
      best = terminal;
    }
  }

  if (best !== "none") return best;
  return edges.length > 0 ? "candidate_only" : "data_exhausted";
}

function providerForSeed(
  providers: ChainContinuationProvider[],
  seed: CrossChainContinuationSeed
): ChainContinuationProvider | null {
  const seedChain = String(seed.chain).toLowerCase();
  return providers.find((provider) => provider.chain.toLowerCase() === seedChain) ?? null;
}

function preflightCoverageNotes(
  seed: CrossChainContinuationSeed,
  provider: ChainContinuationProvider | null,
  missingSeedAddress: boolean
): string[] {
  const notes: string[] = [];
  if (!provider) {
    notes.push(`Bridge continuation provider is unavailable for seed chain ${String(seed.chain)}.`);
  }
  if (missingSeedAddress) {
    notes.push("Bridge continuation seed is missing an address.");
  }
  return notes;
}

function addressForSeed(seed: CrossChainContinuationSeed): CrossChainAddress {
  const chain = String(seed.chain);
  return {
    chain: seed.chain,
    chainId: CHAIN_IDS[chain.toLowerCase()] ?? chain,
    address: seed.address ?? ""
  };
}

function continuationAddresses(
  provider: ChainContinuationProvider,
  current: CrossChainAddress,
  edge: CrossChainContinuationEdge
): CrossChainAddress[] {
  const sourceMatches = sameAddress(edge.source, current);
  const destinationMatches = sameAddress(edge.destination, current);
  const candidates = sourceMatches
    ? [edge.destination]
    : destinationMatches
      ? [edge.source]
      : [edge.destination, edge.source];

  return candidates
    .filter((address): address is CrossChainAddress => address !== null)
    .filter((address) => address.chain.toString().toLowerCase() === provider.chain.toLowerCase())
    .filter((address) => !sameAddress(address, current));
}

function labelsForDetection(edge: CrossChainContinuationEdge): string[] {
  return [edge.protocol, ...edge.labels].filter((label): label is string => Boolean(label?.trim()));
}

function sortedEdges(edgesById: Map<string, CrossChainContinuationEdge>): CrossChainContinuationEdge[] {
  return [...edgesById.values()].sort((left, right) => {
    const byScore = right.score - left.score;
    if (byScore !== 0) return byScore;
    return left.id.localeCompare(right.id);
  });
}

function dedupeFrontier(frontier: FrontierAddress[]): FrontierAddress[] {
  const byAddress = new Map<string, FrontierAddress>();
  for (const item of frontier) {
    const key = addressKey(item.address);
    const existing = byAddress.get(key);
    if (!existing || item.score > existing.score) {
      byAddress.set(key, item);
    }
  }
  return [...byAddress.values()];
}

function report(input: {
  seed: CrossChainContinuationSeed;
  terminalBoundary: CrossChainTerminalBoundary;
  edges: CrossChainContinuationEdge[];
  budget: CrossChainProviderBudget;
  partial: boolean;
  notes: string[];
}): CrossChainContinuationReport {
  const budgetNotes = input.budget.coverageNotes();
  return {
    enabled: true,
    seed: input.seed,
    terminalBoundary: input.terminalBoundary,
    edges: input.edges,
    providerCalls: input.budget.providerCalls(),
    partial: input.partial || budgetNotes.length > 0,
    coverageNotes: uniqueStrings([...input.notes, ...budgetNotes]),
    payloadRefs: []
  };
}

function providerFailureNote(
  provider: ChainContinuationProvider,
  address: CrossChainAddress,
  error: unknown
): string {
  const message = error instanceof Error && error.message ? `: ${error.message}` : ".";
  return `Bridge continuation provider ${provider.chain} failed for address ${address.address}${message}`;
}

function sameAddress(left: CrossChainAddress | null | undefined, right: CrossChainAddress | null | undefined): boolean {
  return Boolean(
    left &&
    right &&
    String(left.chain).toLowerCase() === String(right.chain).toLowerCase() &&
    left.address.toLowerCase() === right.address.toLowerCase()
  );
}

function addressKey(address: CrossChainAddress): string {
  return `${String(address.chain).toLowerCase()}:${address.address.toLowerCase()}`;
}

function normalizePositiveInteger(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function normalizeDepth(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}
