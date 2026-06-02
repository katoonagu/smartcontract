import type {
  CrossChainAddress,
  CrossChainContinuationEdge,
  CrossChainContinuationReport,
  CrossChainContinuationSeed,
  CrossChainTerminalBoundary,
  ProviderPayloadRef
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

type TerminalSelection = {
  terminalBoundary: CrossChainTerminalBoundary;
  edgeIds: string[];
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

const CONTINUATION_CLASS_RANK: Record<CrossChainContinuationEdge["continuationEvidenceClass"], number> = {
  protocol_correlated: 40,
  split_join: 30,
  strong_amount_time: 20,
  weak_candidate: 10
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
      payloadRefs: [],
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
      payloadRefs: [],
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

  const terminalSelection = terminalSelectionForEdges(state.edgesById);
  const terminalBoundary = terminalSelection.terminalBoundary;
  const edges = reportEdges(state.edgesById, terminalSelection, width);
  const notes = terminalBoundary === "candidate_only"
    ? [...state.notes, "Bridge continuation search returned candidate-only edges without accepted terminal proof."]
    : state.notes;

  return report({
    seed: input.seed,
    terminalBoundary,
    edges,
    payloadRefs: payloadRefsFromEdges(state.edgesById),
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
        const storedEdge = upsertStrongerEdge(state.edgesById, edge);

        const terminal = detectTerminalBoundary(storedEdge);
        if (terminal !== "none") {
          if (terminalAllowedForContinuationClass(terminal, storedEdge.continuationEvidenceClass)) {
            state.terminalFound = true;
            addressFoundTerminal = true;
            continue;
          }

          state.notes.push(
            `Bridge continuation edge ${storedEdge.id} looked like ${terminal}, but ${storedEdge.continuationEvidenceClass} evidence is candidate-only for that terminal.`
          );
          continue;
        }

        for (const nextAddress of continuationAddresses(state.provider, item.address, storedEdge)) {
          if (!visited.has(addressKey(nextAddress))) {
            addressNextCandidates.push({ address: nextAddress, score: storedEdge.score });
          }
        }
      }

      if (!addressFoundTerminal) {
        nextCandidates.push(...addressNextCandidates);
      }

      if (state.terminalFound) break;
    }

    const dedupedNextCandidates = dedupeFrontier(nextCandidates)
      .sort((left, right) => right.score - left.score);
    if (!state.terminalFound && dedupedNextCandidates.length > state.width) {
      state.partial = true;
      state.notes.push(`Bridge continuation search beamWidth truncated ${dedupedNextCandidates.length - state.width} continuation candidate(s).`);
    }
    frontier = dedupedNextCandidates.slice(0, state.width);
    if (!state.terminalFound && depth === state.maxDepth - 1 && frontier.length > 0) {
      state.partial = true;
      state.notes.push(`Bridge continuation search maxDepth truncated ${frontier.length} continuation candidate(s).`);
    }
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

function terminalSelectionForEdges(edgesById: Map<string, CrossChainContinuationEdge>): TerminalSelection {
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

  if (best === "none") {
    return {
      terminalBoundary: edges.length > 0 ? "candidate_only" : "data_exhausted",
      edgeIds: []
    };
  }

  return {
    terminalBoundary: best,
    edgeIds: edges
      .filter((edge) =>
        detectTerminalBoundary(edge) === best &&
        terminalAllowedForContinuationClass(best, edge.continuationEvidenceClass)
      )
      .map((edge) => edge.id)
  };
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

function upsertStrongerEdge(
  edgesById: Map<string, CrossChainContinuationEdge>,
  edge: CrossChainContinuationEdge
): CrossChainContinuationEdge {
  const existing = edgesById.get(edge.id);
  if (!existing || compareEdgeStrength(edge, existing) > 0) {
    const merged = existing ? mergeEdgeEvidence(edge, existing) : edge;
    edgesById.set(edge.id, merged);
    return merged;
  }

  const merged = mergeEdgeEvidence(existing, edge);
  edgesById.set(edge.id, merged);
  return merged;
}

function compareEdgeStrength(left: CrossChainContinuationEdge, right: CrossChainContinuationEdge): number {
  const leftTerminal = detectTerminalBoundary(left);
  const rightTerminal = detectTerminalBoundary(right);
  const leftProofAllowed = terminalAllowedForContinuationClass(leftTerminal, left.continuationEvidenceClass);
  const rightProofAllowed = terminalAllowedForContinuationClass(rightTerminal, right.continuationEvidenceClass);
  const byProof = Number(leftTerminal !== "none" && leftProofAllowed) - Number(rightTerminal !== "none" && rightProofAllowed);
  if (byProof !== 0) return byProof;

  const byTerminal = TERMINAL_PRIORITY[leftTerminal] - TERMINAL_PRIORITY[rightTerminal];
  if (byTerminal !== 0) return byTerminal;

  const byClass = CONTINUATION_CLASS_RANK[left.continuationEvidenceClass] - CONTINUATION_CLASS_RANK[right.continuationEvidenceClass];
  if (byClass !== 0) return byClass;

  const byScore = left.score - right.score;
  if (byScore !== 0) return byScore;

  const byEvidenceCount = left.evidenceRefs.length - right.evidenceRefs.length;
  if (byEvidenceCount !== 0) return byEvidenceCount;

  return left.id.localeCompare(right.id);
}

function mergeEdgeEvidence(
  primary: CrossChainContinuationEdge,
  secondary: CrossChainContinuationEdge
): CrossChainContinuationEdge {
  const evidenceRefs = [...primary.evidenceRefs];
  const seenEvidenceIds = new Set(evidenceRefs.map((ref) => ref.id));

  for (const evidenceRef of secondary.evidenceRefs) {
    if (seenEvidenceIds.has(evidenceRef.id)) continue;
    seenEvidenceIds.add(evidenceRef.id);
    evidenceRefs.push(evidenceRef);
  }

  return {
    ...primary,
    evidenceRefs
  };
}

function reportEdges(
  edgesById: Map<string, CrossChainContinuationEdge>,
  terminalSelection: TerminalSelection,
  width: number
): CrossChainContinuationEdge[] {
  const terminalIds = new Set(terminalSelection.edgeIds);
  const terminalEdges = sortedEdges(edgesById)
    .filter((edge) => terminalIds.has(edge.id))
    .slice(0, width);
  const remaining = sortedEdges(edgesById)
    .filter((edge) => !terminalIds.has(edge.id))
    .slice(0, Math.max(0, width - terminalEdges.length));

  return [...terminalEdges, ...remaining];
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
  payloadRefs: ProviderPayloadRef[];
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
    payloadRefs: input.payloadRefs
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

function payloadRefsFromEdges(edgesById: Map<string, CrossChainContinuationEdge>): ProviderPayloadRef[] {
  const byId = new Map<string, ProviderPayloadRef>();

  for (const edge of edgesById.values()) {
    for (const evidenceRef of edge.evidenceRefs) {
      if (!evidenceRef.payloadId || byId.has(evidenceRef.payloadId)) continue;
      byId.set(evidenceRef.payloadId, {
        id: evidenceRef.payloadId,
        provider: evidenceRef.provider,
        endpoint: "continuation/evidence",
        fetchedAt: "unknown"
      });
    }
  }

  return [...byId.values()];
}
