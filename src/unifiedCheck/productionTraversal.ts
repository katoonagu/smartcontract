import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import { canonicalTronUsdtEventKey } from "../forensics/tronAddressAllTimeIndex";
import type { IndexedTronUsdtTransfer } from "../types";
import type { AnalysisManifestV1 } from "./contracts";
import {
  initialDirectHistoryCheckpoint,
  runDirectHistoryChunk,
  type DirectHistoryCheckpoint,
  type DirectHistoryPage,
  type DirectHistoryProviderWait
} from "./directHistory";
import {
  canonicalizeUnifiedDirectHistoryPages,
  type UnifiedDirectHistoryPageArtifactV1
} from "./productionDirectHistory";
import {
  buildTraversalCoverage,
  expandTraversalChunk,
  mergeTraversalStates,
  traversalExpansionKey,
  traversalStateId,
  type TraversalCoverageV1,
  type TraversalStateV1,
  type TraversalTerminalReason
} from "./traversal";
import type { UnifiedChunkHandler } from "./worker";
import type {
  ProductionBoundaryDecisionV2,
  ProductionBoundaryEvidenceV2
} from "./productionBoundary";

const HASH = /^[0-9a-f]{64}$/u;
const IDENTIFIED_SERVICE_LABELS = new Set([
  "cex", "exchange", "trusted", "whitebit", "bridge",
  "darknet_exchange"
]);
const RESTRICTION_LABELS = new Set([
  "scam", "reported_scam", "stolen_funds", "phishing",
  "risky_contract", "approval_drain_proximity"
]);

export type LoadedTraversalContext = {
  readonly runId: string;
  readonly manifest: AnalysisManifestV1;
  readonly directEvents: readonly IndexedTronUsdtTransfer[];
};

export type UnifiedTraversalTerminalV1 = {
  readonly stateId: string;
  readonly address: string;
  readonly direction: "backward" | "forward";
  readonly fundingEpisodeId: string;
  readonly anchorTimestamp: string;
  readonly amountRaw: string;
  readonly reason: TraversalTerminalReason;
  readonly evidenceHash: string;
  readonly labels: readonly string[];
  readonly sourceEventIds: readonly string[];
};

export type UnifiedTraversalArtifactV1 = {
  readonly version: "unified-traversal-artifact-v1";
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly analysisManifestHash: string;
  readonly snapshotHash: string;
  readonly visitedStates: readonly TraversalStateV1[];
  readonly frontier: readonly [];
  readonly terminalStates: readonly UnifiedTraversalTerminalV1[];
  readonly supersededStateIds: readonly string[];
  readonly eligibleEventIds: readonly string[];
  readonly eligibleEventCount: number;
  readonly directionCount: number;
  readonly fundingEpisodeCount: number;
  readonly expandedStateCount: number;
  readonly allocatedInputRaw: string;
  readonly terminalRaw: string;
  readonly residualRaw: string;
  readonly backwardCoverage: TraversalCoverageV1;
  readonly forwardCoverage: TraversalCoverageV1;
  readonly closed: true;
};

type ActiveHistory = {
  readonly state: TraversalStateV1;
  readonly history: DirectHistoryCheckpoint;
  readonly pageArtifactHashes: readonly string[];
};

export type UnifiedLegacyTraversalCheckpointV1 = {
  readonly version: "unified-production-traversal-checkpoint-v1";
  readonly frontier: readonly TraversalStateV1[];
  readonly visitedStates: readonly TraversalStateV1[];
  readonly expandedStateIds: readonly string[];
  readonly terminals: readonly UnifiedTraversalTerminalV1[];
  readonly supersededStateIds: readonly string[];
  readonly active: ActiveHistory | null;
  readonly eligibleEventIds: readonly string[];
  readonly expandedStateKeys: readonly string[];
  readonly selectedBackwardRaw: string;
  readonly selectedForwardRaw: string;
};

function amountSum(values: readonly string[]): bigint {
  return values.reduce((sum, value) => sum + BigInt(value), 0n);
}

function eventId(event: IndexedTronUsdtTransfer): string {
  return canonicalTronUsdtEventKey(event);
}

export function initialUnifiedTraversalCheckpointV1(
  context: LoadedTraversalContext
): UnifiedLegacyTraversalCheckpointV1 {
  const subject = context.manifest.subjectAddress.toLowerCase();
  const backward = context.directEvents
    .filter((event) => event.toAddress.toLowerCase() === subject)
    .map((event): TraversalStateV1 => ({
      address: event.fromAddress,
      direction: "backward",
      anchorTimestamp: event.blockTimestamp.toISOString(),
      fundingEpisodeId: eventId(event),
      allocatedAmountRaw: event.amountRaw,
      sourceEventIds: [eventId(event)]
    }));
  const forward = context.directEvents
    .filter((event) => event.fromAddress.toLowerCase() === subject)
    .map((event): TraversalStateV1 => ({
      address: event.toAddress,
      direction: "forward",
      anchorTimestamp: event.blockTimestamp.toISOString(),
      fundingEpisodeId: eventId(event),
      allocatedAmountRaw: event.amountRaw,
      sourceEventIds: [eventId(event)]
    }));
  return {
    version: "unified-production-traversal-checkpoint-v1",
    frontier: mergeTraversalStates([...backward, ...forward]),
    visitedStates: [],
    expandedStateIds: [],
    terminals: [],
    supersededStateIds: [],
    active: null,
    eligibleEventIds: [],
    expandedStateKeys: [],
    selectedBackwardRaw: amountSum(
      backward.map((state) => state.allocatedAmountRaw)
    ).toString(),
    selectedForwardRaw: amountSum(
      forward.map((state) => state.allocatedAmountRaw)
    ).toString()
  };
}

function checkpoint(
  value: unknown,
  context: LoadedTraversalContext
): UnifiedLegacyTraversalCheckpointV1 {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).version === undefined
  ) {
    return initialUnifiedTraversalCheckpointV1(context);
  }
  const parsed = value as Partial<UnifiedLegacyTraversalCheckpointV1>;
  if (
    parsed.version !== "unified-production-traversal-checkpoint-v1" ||
    !Array.isArray(parsed.frontier) ||
    !Array.isArray(parsed.visitedStates) ||
    !Array.isArray(parsed.expandedStateIds) ||
    !Array.isArray(parsed.terminals) ||
    !Array.isArray(parsed.supersededStateIds) ||
    !Array.isArray(parsed.eligibleEventIds) ||
    !Array.isArray(parsed.expandedStateKeys) ||
    typeof parsed.selectedBackwardRaw !== "string" ||
    typeof parsed.selectedForwardRaw !== "string" ||
    parsed.eligibleEventIds.some((id) => typeof id !== "string") ||
    parsed.expandedStateKeys.some((key) => typeof key !== "string")
  ) {
    throw new Error("unified_production_traversal_checkpoint_invalid");
  }
  return parsed as UnifiedLegacyTraversalCheckpointV1;
}

export function unifiedTraversalBoundary(
  labels: readonly string[]
): TraversalTerminalReason | null {
  if (labels.some((label) => RESTRICTION_LABELS.has(label))) {
    return "policy_or_restriction_boundary";
  }
  if (labels.some((label) => IDENTIFIED_SERVICE_LABELS.has(label))) {
    return "identified_service_boundary";
  }
  return null;
}

export function buildUnifiedTraversalTerminalProof(input: {
  state: TraversalStateV1;
  reason: TraversalTerminalReason;
  labels: readonly string[];
  snapshotHash: string;
  pageArtifactHashes: readonly string[];
}) {
  return {
    version: "unified-traversal-terminal-evidence-v1" as const,
    stateId: traversalStateId(input.state),
    address: input.state.address,
    reason: input.reason,
    labels: [...new Set(input.labels)].sort(),
    snapshotHash: input.snapshotHash,
    pageArtifactHashes: [...input.pageArtifactHashes]
  };
}

export function buildUnifiedTraversalTerminalRecord(input: {
  state: TraversalStateV1;
  reason: TraversalTerminalReason;
  labels: readonly string[];
  evidenceHash: string;
  amountRaw?: string;
}): UnifiedTraversalTerminalV1 {
  return {
    stateId: traversalStateId(input.state),
    address: input.state.address,
    direction: input.state.direction,
    fundingEpisodeId: input.state.fundingEpisodeId,
    anchorTimestamp: input.state.anchorTimestamp,
    amountRaw: input.amountRaw ?? input.state.allocatedAmountRaw,
    reason: input.reason,
    evidenceHash: input.evidenceHash,
    labels: [...new Set(input.labels)].sort(),
    sourceEventIds: [...new Set(input.state.sourceEventIds)].sort()
  };
}

export function buildUnifiedTraversalBoundaryCommitV2(input: {
  readonly state: TraversalStateV1;
  readonly decision: Extract<
    ProductionBoundaryDecisionV2,
    { readonly terminal: true }
  >;
  readonly evidenceHash: string;
}): {
  readonly evidence: ProductionBoundaryEvidenceV2;
  readonly terminal: UnifiedTraversalTerminalV1;
} {
  if (!HASH.test(input.evidenceHash)) {
    throw new TypeError("unified_v2_boundary_evidence_hash_invalid");
  }
  return {
    evidence: input.decision.evidence,
    terminal: buildUnifiedTraversalTerminalRecord({
      state: input.state,
      reason: input.decision.reason,
      labels: [input.decision.evidence.labelCatalogEntryId],
      evidenceHash: input.evidenceHash
    })
  };
}

function coverage(
  direction: "backward" | "forward",
  selectedRaw: string,
  terminals: readonly UnifiedTraversalTerminalV1[]
): TraversalCoverageV1 {
  const selected = BigInt(selectedRaw);
  const matching = terminals.filter((item) => item.direction === direction);
  const tracedTerminals = matching.filter((item) =>
    item.reason !== "amount_continuity_exhausted" &&
    item.reason !== "temporal_continuity_exhausted"
  );
  const traced = amountSum(tracedTerminals.map((item) => item.amountRaw));
  const identified = amountSum(tracedTerminals
    .filter((item) =>
      item.reason === "identified_service_boundary" ||
      item.reason === "policy_or_restriction_boundary" ||
      item.reason === "shared_liquidity_boundary" ||
      item.reason === "contract_economic_boundary"
    )
    .map((item) => item.amountRaw));
  const unknown = traced - identified;
  return buildTraversalCoverage({
    selectedAmountRaw: selected.toString(),
    tracedAmountRaw: traced.toString(),
    identifiedAmountRaw: identified.toString(),
    unknownBoundaryRaw: unknown.toString()
  });
}

export async function buildUnifiedTraversalCompletedArtifact(
  context: LoadedTraversalContext,
  state: Pick<
    UnifiedLegacyTraversalCheckpointV1,
    | "frontier"
    | "visitedStates"
    | "expandedStateIds"
    | "terminals"
    | "supersededStateIds"
    | "eligibleEventIds"
    | "expandedStateKeys"
    | "selectedBackwardRaw"
    | "selectedForwardRaw"
  >
): Promise<UnifiedTraversalArtifactV1> {
  const selected = BigInt(state.selectedBackwardRaw) +
    BigInt(state.selectedForwardRaw);
  const residual = amountSum(
    state.terminals
      .filter((item) =>
        item.reason === "amount_continuity_exhausted" ||
        item.reason === "temporal_continuity_exhausted"
      )
      .map((item) => item.amountRaw)
  );
  const terminal = amountSum(
    state.terminals
      .filter((item) =>
        item.reason !== "amount_continuity_exhausted" &&
        item.reason !== "temporal_continuity_exhausted"
      )
      .map((item) => item.amountRaw)
  );
  if (terminal + residual !== selected) {
    throw new Error("unified_production_traversal_amount_mismatch");
  }
  const directions = new Set(state.visitedStates.map((item) => item.direction));
  const episodes = new Set(state.visitedStates.map(
    (item) => item.fundingEpisodeId
  ));
  return {
    version: "unified-traversal-artifact-v1",
    schemaVersion: 1,
    runId: context.runId,
    analysisManifestHash: fingerprintCanonicalArtifact(context.manifest),
    snapshotHash: context.manifest.snapshotHash,
    visitedStates: [...state.visitedStates],
    frontier: [],
    terminalStates: [...state.terminals].sort((left, right) =>
      left.stateId.localeCompare(right.stateId)
    ),
    supersededStateIds: [...new Set(state.supersededStateIds)].sort(),
    eligibleEventIds: [...new Set(state.eligibleEventIds)].sort(),
    eligibleEventCount: new Set(state.eligibleEventIds).size,
    directionCount: directions.size,
    fundingEpisodeCount: episodes.size,
    expandedStateCount: new Set(state.expandedStateKeys).size,
    allocatedInputRaw: selected.toString(),
    terminalRaw: terminal.toString(),
    residualRaw: residual.toString(),
    backwardCoverage: coverage(
      "backward",
      state.selectedBackwardRaw,
      state.terminals
    ),
    forwardCoverage: coverage(
      "forward",
      state.selectedForwardRaw,
      state.terminals
    ),
    closed: true
  };
}

export function createUnifiedTraversalHandler(input: {
  loadContext(runId: string): Promise<LoadedTraversalContext>;
  loadPage(input: {
    run: LoadedTraversalContext;
    address: string;
    cursor: string | null;
    taskId: string;
    leaseToken: string;
    attempt: number;
    heartbeat(): Promise<void>;
  }): Promise<DirectHistoryPage | DirectHistoryProviderWait>;
  loadLabels(input: {
    labelDatasetSha256: string;
    addresses: readonly string[];
  }): Promise<ReadonlyMap<string, readonly string[]>>;
  loadPageArtifact(input: {
    runId: string;
    sha256: string;
  }): Promise<UnifiedDirectHistoryPageArtifactV1>;
  persistArtifact(input: {
    runId: string;
    kind:
      | "traversal_history_page"
      | "traversal_terminal_evidence"
      | "traversal_result";
    sha256: string;
    artifact: unknown;
  }): Promise<void>;
}): UnifiedChunkHandler {
  return async ({ task, heartbeat, leaseToken }) => {
    if (task.kind !== "traversal") {
      return { kind: "blocked", reason: "unified_traversal_kind_invalid" };
    }
    const context = await input.loadContext(task.runId);
    let state = checkpoint(task.checkpoint, context);
    if (state.frontier.length === 0 && state.active === null) {
      const artifact = await buildUnifiedTraversalCompletedArtifact(
        context,
        state
      );
      const sha256 = fingerprintCanonicalArtifact(artifact);
      await input.persistArtifact({
        runId: task.runId,
        kind: "traversal_result",
        sha256,
        artifact
      });
      await heartbeat();
      return { kind: "completed", artifactSha256: sha256 };
    }
    const active = state.active ?? {
      state: state.frontier[0]!,
      history: initialDirectHistoryCheckpoint(
        context.manifest.confirmedBlockNumber,
        context.manifest.confirmedBlockHash
      ),
      pageArtifactHashes: []
    };
    const remainingFrontier = state.active === null
      ? state.frontier.slice(1)
      : state.frontier;
    const activeStateId = traversalStateId(active.state);
    const activeExpansionKey = traversalExpansionKey(active.state);
    if (
      state.expandedStateKeys.includes(activeExpansionKey) &&
      !state.expandedStateIds.includes(activeStateId)
    ) {
      return {
        kind: "failed",
        reason: "unified_production_traversal_late_state_merge"
      };
    }
    const labels = await input.loadLabels({
      labelDatasetSha256: context.manifest.labelDatasetSha256,
      addresses: [active.state.address]
    });
    const addressLabels = labels.get(active.state.address) ?? [];
    const reason = unifiedTraversalBoundary(addressLabels);
    if (reason !== null && active.pageArtifactHashes.length === 0) {
      const proof = buildUnifiedTraversalTerminalProof({
        state: active.state,
        reason,
        labels: addressLabels,
        snapshotHash: context.manifest.snapshotHash,
        pageArtifactHashes: []
      });
      const evidenceHash = fingerprintCanonicalArtifact(proof);
      await input.persistArtifact({
        runId: task.runId,
        kind: "traversal_terminal_evidence",
        sha256: evidenceHash,
        artifact: proof
      });
      state = {
        ...state,
        frontier: mergeTraversalStates(remainingFrontier),
        visitedStates: [...state.visitedStates, active.state],
        terminals: [
          ...state.terminals,
          buildUnifiedTraversalTerminalRecord({
          state: active.state,
          reason,
          labels: addressLabels,
          evidenceHash
          })
        ],
        active: null
      };
    } else {
      const result = await runDirectHistoryChunk({
        address: active.state.address,
        manifest: context.manifest,
        checkpoint: active.history,
        maxPagesThisChunk: 1,
        loadPage: (cursor) => input.loadPage({
          run: context,
          address: active.state.address,
          cursor,
          taskId: task.id,
          leaseToken,
          attempt: task.attempt,
          heartbeat
        })
      });
      if (result.outcome === "provider_wait") {
        return {
          kind: "provider_wait",
          readyAt: result.providerReadyAt!,
          reason: result.providerWaitReason ?? "unified_provider_wait",
          checkpoint: { ...state, active }
        };
      }
      const providerPageHash = result.checkpoint.pageHashes.at(-1);
      if (!providerPageHash || !HASH.test(providerPageHash)) {
        return {
          kind: "failed",
          reason: "unified_traversal_page_hash_missing"
        };
      }
      const pageArtifact: UnifiedDirectHistoryPageArtifactV1 = {
        version: "unified-direct-history-page-v1",
        schemaVersion: 1,
        runId: task.runId,
        providerPageHash,
        events: [...result.events]
          .sort((left, right) =>
            eventId(left).localeCompare(eventId(right))
          )
          .map((event) => ({
            ...event,
            blockTimestamp: event.blockTimestamp.toISOString()
          }))
      };
      const pageHash = fingerprintCanonicalArtifact(pageArtifact);
      await input.persistArtifact({
        runId: task.runId,
        kind: "traversal_history_page",
        sha256: pageHash,
        artifact: pageArtifact
      });
      const pageArtifactHashes = [
        ...active.pageArtifactHashes,
        pageHash
      ];
      if (result.outcome === "more") {
        state = {
          ...state,
          frontier: remainingFrontier,
          active: {
            state: active.state,
            history: result.checkpoint,
            pageArtifactHashes
          }
        };
      } else {
        const pages = await Promise.all(pageArtifactHashes.map((sha256) =>
          input.loadPageArtifact({ runId: task.runId, sha256 })
        ));
        const events = canonicalizeUnifiedDirectHistoryPages(pages).events
          .map((event) => ({
            id: canonicalTronUsdtEventKey(event),
            fromAddress: event.fromAddress,
            toAddress: event.toAddress,
            amountRaw: event.amountRaw,
            timestamp: event.blockTimestamp
          }));
        const expanded = expandTraversalChunk({
          frontier: [active.state],
          events,
          expandedStateIds: new Set(state.expandedStateIds),
          maxStatesThisChunk: 1,
          terminalReason: () => null,
          accountCreationExhausted: () => true
        });
        const terminals: UnifiedTraversalTerminalV1[] = [];
        for (const item of expanded.terminals) {
          const proof = buildUnifiedTraversalTerminalProof({
            state: item.state,
            reason: item.reason,
            labels: addressLabels,
            snapshotHash: context.manifest.snapshotHash,
            pageArtifactHashes
          });
          const evidenceHash = fingerprintCanonicalArtifact(proof);
          await input.persistArtifact({
            runId: task.runId,
            kind: "traversal_terminal_evidence",
            sha256: evidenceHash,
            artifact: proof
          });
          terminals.push(buildUnifiedTraversalTerminalRecord({
            state: item.state,
            reason: item.reason,
            labels: addressLabels,
            evidenceHash,
            amountRaw: item.amountRaw
          }));
        }
        state = {
          ...state,
          frontier: mergeTraversalStates([
            ...remainingFrontier,
            ...expanded.nextFrontier
          ]),
          visitedStates: [...state.visitedStates, active.state],
          expandedStateIds: [...new Set([
            ...state.expandedStateIds,
            ...expanded.processedStateIds
          ])].sort(),
          eligibleEventIds: [...new Set([
            ...state.eligibleEventIds,
            ...expanded.eligibleEventIds
          ])].sort(),
          expandedStateKeys: expanded.eligibleEventCount > 0
            ? [...new Set([
                ...state.expandedStateKeys,
                activeExpansionKey
              ])].sort()
            : state.expandedStateKeys,
          terminals: [...state.terminals, ...terminals],
          supersededStateIds: [...state.supersededStateIds,
            ...expanded.supersededStateIds],
          active: null
        };
      }
    }
    await heartbeat();
    if (state.frontier.length === 0 && state.active === null) {
      const artifact = await buildUnifiedTraversalCompletedArtifact(
        context,
        state
      );
      const sha256 = fingerprintCanonicalArtifact(artifact);
      await input.persistArtifact({
        runId: task.runId,
        kind: "traversal_result",
        sha256,
        artifact
      });
      return { kind: "completed", artifactSha256: sha256 };
    }
    return { kind: "checkpoint", checkpoint: state };
  };
}
