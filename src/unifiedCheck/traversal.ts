import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";

export type TraversalStateV1 = {
  readonly address: string;
  readonly direction: "backward" | "forward";
  readonly anchorTimestamp: string;
  readonly fundingEpisodeId: string;
  readonly allocatedAmountRaw: string;
  readonly sourceEventIds: readonly string[];
};

export type TraversalTerminalReason =
  | "identified_service_boundary"
  | "shared_liquidity_boundary"
  | "policy_or_restriction_boundary"
  | "contract_economic_boundary"
  | "history_exhausted_to_account_creation"
  | "amount_continuity_exhausted"
  | "temporal_continuity_exhausted"
  | "unidentified_structural_boundary";

export type TraversalEventV1 = {
  readonly id: string;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly amountRaw: string;
  readonly timestamp: string;
};

export type TraversalCoverageV1 = {
  readonly selectionCoverage: number;
  readonly traceCoverage: number;
  readonly identifiedCoverage: number;
  readonly unknownBoundaryShare: number;
  readonly untracedShare: number;
  readonly selectedAmountRaw: string;
  readonly tracedAmountRaw: string;
  readonly identifiedAmountRaw: string;
};

const RAW = /^(0|[1-9][0-9]*)$/u;

function amount(value: string, code: string): bigint {
  if (!RAW.test(value)) throw new TypeError(code);
  return BigInt(value);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError("unified_traversal_timestamp_invalid");
  }
  return parsed;
}

function stateMergeKey(state: TraversalStateV1): string {
  return fingerprintCanonicalArtifact([
    "traversal-state-merge-key-v1",
    state.address,
    state.direction,
    state.anchorTimestamp,
    state.fundingEpisodeId
  ]);
}

export function traversalStateId(state: TraversalStateV1): string {
  return fingerprintCanonicalArtifact([
    "traversal-state-v1",
    state.address,
    state.direction,
    state.anchorTimestamp,
    state.fundingEpisodeId,
    state.allocatedAmountRaw,
    [...new Set(state.sourceEventIds)].sort()
  ]);
}

export function mergeTraversalStates(
  states: readonly TraversalStateV1[]
): TraversalStateV1[] {
  const merged = new Map<string, TraversalStateV1>();
  for (const state of states) {
    timestamp(state.anchorTimestamp);
    const stateAmount = amount(
      state.allocatedAmountRaw,
      "unified_traversal_state_amount_invalid"
    );
    if (stateAmount === 0n) continue;
    const key = stateMergeKey(state);
    const prior = merged.get(key);
    merged.set(key, prior
      ? {
          ...prior,
          allocatedAmountRaw:
            (amount(prior.allocatedAmountRaw, "unified_traversal_state_amount_invalid") +
              stateAmount).toString(),
          sourceEventIds: [...new Set([
            ...prior.sourceEventIds,
            ...state.sourceEventIds
          ])].sort()
        }
      : {
          ...state,
          sourceEventIds: [...new Set(state.sourceEventIds)].sort()
        });
  }
  return [...merged.values()].sort((left, right) =>
    traversalStateId(left).localeCompare(traversalStateId(right))
  );
}

function eligible(
  state: TraversalStateV1,
  event: TraversalEventV1
): boolean {
  const eventTime = timestamp(event.timestamp);
  const anchor = timestamp(state.anchorTimestamp);
  if (state.sourceEventIds.includes(event.id)) return false;
  return state.direction === "backward"
    ? event.toAddress === state.address && eventTime <= anchor
    : event.fromAddress === state.address && eventTime >= anchor;
}

export function expandTraversalChunk(input: {
  frontier: readonly TraversalStateV1[];
  events: readonly TraversalEventV1[];
  expandedStateIds: ReadonlySet<string>;
  maxStatesThisChunk: number;
  terminalReason(
    state: TraversalStateV1
  ): { reason: TraversalTerminalReason; evidenceHash: string } | null;
  accountCreationExhausted(address: string): boolean;
}): {
  processedStateIds: readonly string[];
  nextFrontier: readonly TraversalStateV1[];
  terminals: ReadonlyArray<{
    state: TraversalStateV1;
    reason: TraversalTerminalReason;
    evidenceHash: string | null;
    amountRaw: string;
  }>;
  supersededStateIds: readonly string[];
  eligibleEventCount: number;
  continuedRaw: string;
  terminalRaw: string;
  residualRaw: string;
} {
  if (
    !Number.isSafeInteger(input.maxStatesThisChunk) ||
    input.maxStatesThisChunk < 1
  ) throw new TypeError("unified_traversal_chunk_size_invalid");
  const frontier = mergeTraversalStates(input.frontier);
  const processedStateIds: string[] = [];
  const supersededStateIds: string[] = [];
  const terminals: Array<{
    state: TraversalStateV1;
    reason: TraversalTerminalReason;
    evidenceHash: string | null;
    amountRaw: string;
  }> = [];
  const generated: TraversalStateV1[] = [];
  let eligibleEventCount = 0;
  let continuedRaw = 0n;
  let terminalRaw = 0n;
  let residualRaw = 0n;

  for (const state of frontier.slice(0, input.maxStatesThisChunk)) {
    const stateId = traversalStateId(state);
    if (input.expandedStateIds.has(stateId)) {
      supersededStateIds.push(stateId);
      continue;
    }
    processedStateIds.push(stateId);
    const stateAmount = amount(
      state.allocatedAmountRaw,
      "unified_traversal_state_amount_invalid"
    );
    const terminal = input.terminalReason(state);
    if (terminal) {
      if (!/^[0-9a-f]{64}$/u.test(terminal.evidenceHash)) {
        throw new Error("unified_traversal_terminal_evidence_invalid");
      }
      terminals.push({
        state,
        reason: terminal.reason,
        evidenceHash: terminal.evidenceHash,
        amountRaw: stateAmount.toString()
      });
      terminalRaw += stateAmount;
      continue;
    }
    const candidates = input.events
      .filter((event) => {
        amount(event.amountRaw, "unified_traversal_event_amount_invalid");
        return eligible(state, event);
      })
      .sort((left, right) => {
        const timeOrder = state.direction === "backward"
          ? timestamp(right.timestamp) - timestamp(left.timestamp)
          : timestamp(left.timestamp) - timestamp(right.timestamp);
        return timeOrder || left.id.localeCompare(right.id);
      });
    eligibleEventCount += candidates.length;
    let remaining = stateAmount;
    for (const event of candidates) {
      if (remaining === 0n) break;
      const allocated = amount(
        event.amountRaw,
        "unified_traversal_event_amount_invalid"
      );
      if (allocated === 0n) continue;
      const used = allocated < remaining ? allocated : remaining;
      generated.push({
        address: state.direction === "backward"
          ? event.fromAddress
          : event.toAddress,
        direction: state.direction,
        anchorTimestamp: event.timestamp,
        fundingEpisodeId: state.fundingEpisodeId,
        allocatedAmountRaw: used.toString(),
        sourceEventIds: [...state.sourceEventIds, event.id]
      });
      continuedRaw += used;
      remaining -= used;
    }
    if (candidates.length === 0) {
      terminals.push({
        state,
        reason: input.accountCreationExhausted(state.address)
          ? "history_exhausted_to_account_creation"
          : "unidentified_structural_boundary",
        evidenceHash: null,
        amountRaw: remaining.toString()
      });
      terminalRaw += remaining;
    } else if (remaining > 0n) {
      terminals.push({
        state,
        reason: "amount_continuity_exhausted",
        evidenceHash: null,
        amountRaw: remaining.toString()
      });
      residualRaw += remaining;
    }
  }
  return {
    processedStateIds,
    nextFrontier: mergeTraversalStates([
      ...frontier.slice(input.maxStatesThisChunk),
      ...generated
    ]),
    terminals,
    supersededStateIds,
    eligibleEventCount,
    continuedRaw: continuedRaw.toString(),
    terminalRaw: terminalRaw.toString(),
    residualRaw: residualRaw.toString()
  };
}

function ratio(part: bigint, total: bigint): number {
  return total === 0n ? 0 : Number((part * 10_000n) / total) / 100;
}

export function buildTraversalCoverage(input: {
  selectedAmountRaw: string;
  tracedAmountRaw: string;
  identifiedAmountRaw: string;
  unknownBoundaryRaw: string;
}): TraversalCoverageV1 {
  const selected = amount(input.selectedAmountRaw, "unified_coverage_selected_invalid");
  const traced = amount(input.tracedAmountRaw, "unified_coverage_traced_invalid");
  const identified = amount(input.identifiedAmountRaw, "unified_coverage_identified_invalid");
  const unknown = amount(input.unknownBoundaryRaw, "unified_coverage_unknown_invalid");
  if (traced > selected || identified > traced || unknown > traced) {
    throw new Error("unified_traversal_coverage_inconsistent");
  }
  return {
    selectionCoverage: selected === 0n ? 100 : 100,
    traceCoverage: ratio(traced, selected),
    identifiedCoverage: ratio(identified, selected),
    unknownBoundaryShare: ratio(unknown, selected),
    untracedShare: selected === 0n ? 0 : 100 - ratio(traced, selected),
    selectedAmountRaw: selected.toString(),
    tracedAmountRaw: traced.toString(),
    identifiedAmountRaw: identified.toString()
  };
}

export function buildTraversalClosureCertificate(input: {
  analysisManifestHash: string;
  evidenceBundleHash: string;
  snapshotHash: string;
  visitedStates: readonly TraversalStateV1[];
  frontier: readonly TraversalStateV1[];
  terminalStateIds: readonly string[];
  supersededStateIds: readonly string[];
  unclassifiedCount: number;
  droppedCount: number;
  eligibleEventCount: number;
  directionCount: number;
  fundingEpisodeCount: number;
  expandedStateCount: number;
  allocatedInputRaw: string;
  terminalRaw: string;
  continuedRaw: string;
  residualRaw: string;
  backwardCoverage: TraversalCoverageV1;
  forwardCoverage: TraversalCoverageV1;
}) {
  const allocated = amount(input.allocatedInputRaw, "unified_closure_allocated_invalid");
  const terminal = amount(input.terminalRaw, "unified_closure_terminal_invalid");
  const continued = amount(input.continuedRaw, "unified_closure_continued_invalid");
  const residual = amount(input.residualRaw, "unified_closure_residual_invalid");
  const stateBound =
    input.eligibleEventCount * input.directionCount * input.fundingEpisodeCount;
  if (
    input.frontier.length !== 0 ||
    input.unclassifiedCount !== 0 ||
    input.droppedCount !== 0 ||
    input.expandedStateCount > stateBound ||
    allocated !== terminal + continued + residual
  ) {
    throw new Error("unified_traversal_not_closed");
  }
  const visitedStateHash = fingerprintCanonicalArtifact({
    version: "traversal-visited-state-v1",
    states: [...new Set(input.visitedStates.map(traversalStateId))].sort()
  });
  const frontierHash = fingerprintCanonicalArtifact({
    version: "traversal-frontier-v1",
    states: []
  });
  return {
    version: "traversal-closure-certificate-v1",
    schemaVersion: 1,
    analysisManifestHash: input.analysisManifestHash,
    evidenceBundleHash: input.evidenceBundleHash,
    snapshotHash: input.snapshotHash,
    visitedStateHash,
    frontierHash,
    terminalStateHash: fingerprintCanonicalArtifact(
      [...new Set(input.terminalStateIds)].sort()
    ),
    supersededStateHash: fingerprintCanonicalArtifact(
      [...new Set(input.supersededStateIds)].sort()
    ),
    backwardCoverage: input.backwardCoverage,
    forwardCoverage: input.forwardCoverage,
    expandedStateCount: input.expandedStateCount,
    structuralStateBound: stateBound,
    unclassifiedCount: 0,
    droppedCount: 0,
    closed: true
  } as const;
}
