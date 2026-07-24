import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import { canonicalTronUsdtEventKey } from "../forensics/tronAddressAllTimeIndex";
import {
  TRON_USDT_CONTRACT_ADDRESS
} from "../parser/transactionParser";
import type { IndexedTronUsdtTransfer } from "../types";
import {
  addressHistoryManifestKey,
  type AddressHistoryManifestIdentityV1,
  type AddressHistoryManifestV1
} from "./addressHistory";
import type {
  UnifiedAddressHistoryPageArtifactV1
} from "./productionAddressHistory";
import {
  buildUnifiedTraversalCompletedArtifact,
  buildUnifiedTraversalTerminalProof,
  buildUnifiedTraversalTerminalRecord,
  initialUnifiedTraversalCheckpointV1,
  unifiedTraversalBoundary,
  type LoadedTraversalContext,
  type UnifiedTraversalTerminalV1
} from "./productionTraversal";
import {
  expandTraversalChunk,
  mergeTraversalStates,
  traversalExpansionKey,
  traversalStateId,
  type TraversalStateV1
} from "./traversal";
import {
  appendTraversalDelta,
  replayTraversalDeltas,
  upgradeTraversalCheckpointV1,
  type TraversalCheckpointV2,
  type TraversalCompactionArtifactV2,
  type TraversalDeltaArtifactV1
} from "./traversalDelta";
import type { UnifiedChunkHandler } from "./worker";

const ADDRESS_HISTORY_PROVIDER_VERSION =
  "tronscan-related-trc20-v1" as const;

type CoordinatorState = {
  frontier: TraversalStateV1[];
  visitedStates: TraversalStateV1[];
  expandedStateIds: string[];
  terminals: UnifiedTraversalTerminalV1[];
  supersededStateIds: string[];
  eligibleEventIds: string[];
  expandedStateKeys: string[];
  selectedBackwardRaw: string;
  selectedForwardRaw: string;
};

type PersistKind =
  | "traversal_compaction_v2"
  | "traversal_checkpoint_upgrade"
  | "traversal_delta"
  | "traversal_terminal_evidence"
  | "traversal_result";

function identity(
  context: LoadedTraversalContext,
  address: string
): AddressHistoryManifestIdentityV1 {
  return {
    chain: "tron",
    snapshotHash: context.manifest.snapshotHash,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    address,
    providerRequestVersion: ADDRESS_HISTORY_PROVIDER_VERSION
  };
}

function reviveEvents(
  manifest: AddressHistoryManifestV1,
  pages: readonly UnifiedAddressHistoryPageArtifactV1[]
): IndexedTronUsdtTransfer[] {
  const byId = new Map<string, IndexedTronUsdtTransfer>();
  let rawRowCount = 0;
  for (const page of pages) {
    if (
      page.version !== "unified-address-history-page-v1" ||
      page.runId.length === 0 ||
      page.manifestKey !== manifest.key
    ) {
      throw new Error("unified_traversal_address_page_mismatch");
    }
    rawRowCount += page.rawRowCount;
    for (const serialized of page.events) {
      const blockTimestamp = new Date(serialized.blockTimestamp);
      if (
        Number.isNaN(blockTimestamp.getTime()) ||
        blockTimestamp.toISOString() !== serialized.blockTimestamp
      ) {
        throw new Error("unified_traversal_address_event_time_invalid");
      }
      const event = { ...serialized, blockTimestamp };
      const eventId = canonicalTronUsdtEventKey(event);
      const prior = byId.get(eventId);
      if (
        prior !== undefined &&
        fingerprintCanonicalArtifact(prior) !==
          fingerprintCanonicalArtifact(event)
      ) {
        throw new Error("unified_traversal_address_event_conflict");
      }
      byId.set(eventId, event);
    }
  }
  const entries = [...byId.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  if (
    rawRowCount !== manifest.rawRowCount ||
    entries.length !== manifest.canonicalEventCount ||
    fingerprintCanonicalArtifact(entries.map(([eventId]) => eventId)) !==
      manifest.eventInventorySha256
  ) {
    throw new Error("unified_traversal_address_inventory_mismatch");
  }
  return entries.map(([, event]) => event);
}

function traversalEvents(events: readonly IndexedTronUsdtTransfer[]) {
  return events.map((event) => ({
    id: canonicalTronUsdtEventKey(event),
    fromAddress: event.fromAddress,
    toAddress: event.toAddress,
    amountRaw: event.amountRaw,
    timestamp: event.blockTimestamp.toISOString()
  }));
}

function sameNumbers(
  left: TraversalCheckpointV2["counters"],
  right: TraversalCheckpointV2["counters"]
): boolean {
  return left.expanded === right.expanded &&
    left.terminal === right.terminal &&
    left.superseded === right.superseded;
}

async function loadCoordinatorState(input: {
  runId: string;
  checkpoint: TraversalCheckpointV2;
  loadCompactionArtifact(args: {
    runId: string;
    sha256: string;
  }): Promise<TraversalCompactionArtifactV2>;
  loadDeltaArtifact(args: {
    runId: string;
    sha256: string;
  }): Promise<TraversalDeltaArtifactV1>;
}): Promise<CoordinatorState> {
  if (input.checkpoint.compactionSha256 === null) {
    throw new Error("unified_traversal_compaction_missing");
  }
  const compaction = await input.loadCompactionArtifact({
    runId: input.runId,
    sha256: input.checkpoint.compactionSha256
  });
  if (
    fingerprintCanonicalArtifact(compaction) !==
      input.checkpoint.compactionSha256 ||
    compaction.version !== "unified-traversal-compaction-v2" ||
    compaction.analysisManifestHash !==
      input.checkpoint.analysisManifestHash ||
    compaction.snapshotHash !== input.checkpoint.snapshotHash
  ) {
    throw new Error("unified_traversal_compaction_mismatch");
  }
  const reversed: TraversalDeltaArtifactV1[] = [];
  const seen = new Set<string>();
  let deltaSha256 = input.checkpoint.deltaHeadSha256;
  while (deltaSha256 !== null) {
    if (seen.has(deltaSha256)) {
      throw new Error("unified_traversal_delta_cycle");
    }
    seen.add(deltaSha256);
    const delta = await input.loadDeltaArtifact({
      runId: input.runId,
      sha256: deltaSha256
    });
    if (fingerprintCanonicalArtifact(delta) !== deltaSha256) {
      throw new Error("unified_traversal_delta_hash_mismatch");
    }
    reversed.push(delta);
    deltaSha256 = delta.previousDeltaHash;
  }
  const replayed = replayTraversalDeltas(reversed.reverse(), {
    frontier: compaction.frontier,
    visited: compaction.visited,
    terminals: compaction.terminals,
    supersededStateIds: compaction.supersededStateIds,
    expandedStateIds: compaction.expandedStateIds,
    eligibleEventIds: compaction.eligibleEventIds,
    expandedStateKeys: compaction.expandedStateKeys,
    counters: {
      expanded: compaction.expandedStateIds.length,
      terminal: compaction.terminals.length,
      superseded: compaction.supersededStateIds.length
    }
  });
  if (!sameNumbers(replayed.counters, input.checkpoint.counters)) {
    throw new Error("unified_traversal_delta_counter_mismatch");
  }
  return {
    frontier: [...replayed.frontier],
    visitedStates: [...replayed.visited],
    expandedStateIds: [...replayed.expandedStateIds],
    terminals: replayed.terminals as UnifiedTraversalTerminalV1[],
    supersededStateIds: [...replayed.supersededStateIds],
    eligibleEventIds: [...replayed.eligibleEventIds],
    expandedStateKeys: [...replayed.expandedStateKeys],
    selectedBackwardRaw: compaction.selectedBackwardRaw,
    selectedForwardRaw: compaction.selectedForwardRaw
  };
}

function stateDifference(
  current: readonly TraversalStateV1[],
  next: readonly TraversalStateV1[]
): {
  removed: string[];
  added: TraversalStateV1[];
} {
  const currentIds = new Set(current.map(traversalStateId));
  const nextIds = new Set(next.map(traversalStateId));
  return {
    removed: [...currentIds].filter((stateId) => !nextIds.has(stateId)).sort(),
    added: next.filter((state) => !currentIds.has(traversalStateId(state)))
  };
}

export function createUnifiedTraversalCoordinatorHandler(input: {
  maxAddressesThisChunk: number;
  loadContext(runId: string): Promise<LoadedTraversalContext>;
  loadLabels(args: {
    labelDatasetSha256: string;
    addresses: readonly string[];
  }): Promise<ReadonlyMap<string, readonly string[]>>;
  ensureAddressHistories(args: {
    runId: string;
    priorityLane: "interactive" | "repair" | "background";
    histories: readonly {
      manifestKey: string;
      identity: AddressHistoryManifestIdentityV1;
    }[];
  }): Promise<void>;
  loadAddressHistoryManifests(args: {
    runId: string;
    manifestKeys: readonly string[];
  }): Promise<ReadonlyMap<string, AddressHistoryManifestV1>>;
  loadAddressHistoryPage(args: {
    runId: string;
    sha256: string;
  }): Promise<UnifiedAddressHistoryPageArtifactV1>;
  loadCompactionArtifact(args: {
    runId: string;
    sha256: string;
  }): Promise<TraversalCompactionArtifactV2>;
  loadDeltaArtifact(args: {
    runId: string;
    sha256: string;
  }): Promise<TraversalDeltaArtifactV1>;
  persistArtifact(args: {
    runId: string;
    kind: PersistKind;
    sha256: string;
    artifact: unknown;
  }): Promise<void>;
}): UnifiedChunkHandler {
  if (
    !Number.isSafeInteger(input.maxAddressesThisChunk) ||
    input.maxAddressesThisChunk < 1
  ) {
    throw new TypeError("unified_traversal_address_chunk_invalid");
  }
  return async ({ task, heartbeat }) => {
    if (task.kind !== "traversal") {
      return { kind: "blocked", reason: "unified_traversal_kind_invalid" };
    }
    const context = await input.loadContext(task.runId);
    const manifestHash = fingerprintCanonicalArtifact(context.manifest);
    let v2: TraversalCheckpointV2;
    let state: CoordinatorState;
    const record = (
      task.checkpoint !== null &&
      typeof task.checkpoint === "object" &&
      !Array.isArray(task.checkpoint)
    )
      ? task.checkpoint as { version?: unknown }
      : {};
    if (
      record.version !== "unified-production-traversal-checkpoint-v2"
    ) {
      const source = record.version ===
        "unified-production-traversal-checkpoint-v1"
        ? task.checkpoint
        : initialUnifiedTraversalCheckpointV1(context);
      const upgraded = upgradeTraversalCheckpointV1({
        checkpoint: source,
        analysisManifestHash: manifestHash,
        snapshotHash: context.manifest.snapshotHash
      });
      if (
        !upgraded.upgraded ||
        upgraded.compactionArtifact === null ||
        upgraded.upgradeArtifact === null
      ) {
        throw new Error("unified_traversal_checkpoint_upgrade_missing");
      }
      const compactionSha256 = fingerprintCanonicalArtifact(
        upgraded.compactionArtifact
      );
      const upgradeSha256 = fingerprintCanonicalArtifact(
        upgraded.upgradeArtifact
      );
      await input.persistArtifact({
        runId: task.runId,
        kind: "traversal_compaction_v2",
        sha256: compactionSha256,
        artifact: upgraded.compactionArtifact
      });
      await input.persistArtifact({
        runId: task.runId,
        kind: "traversal_checkpoint_upgrade",
        sha256: upgradeSha256,
        artifact: upgraded.upgradeArtifact
      });
      v2 = upgraded.checkpoint;
      state = {
        frontier: [...upgraded.compactionArtifact.frontier],
        visitedStates: [...upgraded.compactionArtifact.visited],
        expandedStateIds: [...upgraded.compactionArtifact.expandedStateIds],
        terminals:
          upgraded.compactionArtifact.terminals as UnifiedTraversalTerminalV1[],
        supersededStateIds: [
          ...upgraded.compactionArtifact.supersededStateIds
        ],
        eligibleEventIds: [...upgraded.compactionArtifact.eligibleEventIds],
        expandedStateKeys: [...upgraded.compactionArtifact.expandedStateKeys],
        selectedBackwardRaw: upgraded.compactionArtifact.selectedBackwardRaw,
        selectedForwardRaw: upgraded.compactionArtifact.selectedForwardRaw
      };
    } else {
      const upgraded = upgradeTraversalCheckpointV1({
        checkpoint: task.checkpoint,
        analysisManifestHash: manifestHash,
        snapshotHash: context.manifest.snapshotHash
      });
      v2 = upgraded.checkpoint;
      state = await loadCoordinatorState({
        runId: task.runId,
        checkpoint: v2,
        loadCompactionArtifact: input.loadCompactionArtifact,
        loadDeltaArtifact: input.loadDeltaArtifact
      });
    }

    const manifestCache = new Map<string, AddressHistoryManifestV1>();
    const eventCache = new Map<string, IndexedTronUsdtTransfer[]>();
    let processedAddressGroups = 0;
    while (
      state.frontier.length > 0 &&
      processedAddressGroups < input.maxAddressesThisChunk
    ) {
      const first = state.frontier[0]!;
      const group = state.frontier.filter((candidate) =>
        candidate.address === first.address &&
        candidate.direction === first.direction
      );
      const groupIds = new Set(group.map(traversalStateId));
      const labels = await input.loadLabels({
        labelDatasetSha256: context.manifest.labelDatasetSha256,
        addresses: [first.address]
      });
      const addressLabels = labels.get(first.address) ?? [];
      const boundary = unifiedTraversalBoundary(addressLabels);
      let generated: TraversalStateV1[] = [];
      let addedExpandedStateIds: string[] = [];
      let addedEligibleEventIds: string[] = [];
      let addedExpandedStateKeys: string[] = [];
      let addedSupersededStateIds: string[] = [];
      const addedTerminals: UnifiedTraversalTerminalV1[] = [];

      if (boundary !== null) {
        for (const item of group) {
          const proof = buildUnifiedTraversalTerminalProof({
            state: item,
            reason: boundary,
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
          addedTerminals.push(buildUnifiedTraversalTerminalRecord({
            state: item,
            reason: boundary,
            labels: addressLabels,
            evidenceHash
          }));
        }
      } else {
        const addressIdentity = identity(context, first.address);
        const manifestKey = addressHistoryManifestKey(addressIdentity);
        let addressManifest = manifestCache.get(manifestKey);
        if (addressManifest === undefined) {
          const loaded = await input.loadAddressHistoryManifests({
            runId: task.runId,
            manifestKeys: [manifestKey]
          });
          addressManifest = loaded.get(manifestKey);
          if (addressManifest === undefined) {
            await input.ensureAddressHistories({
              runId: task.runId,
              priorityLane: task.priorityLane ?? "interactive",
              histories: [{ manifestKey, identity: addressIdentity }]
            });
            return { kind: "checkpoint", checkpoint: v2 };
          }
          if (
            addressManifest.snapshotHash !==
              context.manifest.snapshotHash ||
            addressManifest.address !== addressIdentity.address ||
            addressManifest.tokenContract !==
              TRON_USDT_CONTRACT_ADDRESS ||
            addressManifest.providerRequestVersion !==
              ADDRESS_HISTORY_PROVIDER_VERSION
          ) {
            return {
              kind: "failed",
              reason: "unified_traversal_address_manifest_mismatch"
            };
          }
          manifestCache.set(manifestKey, addressManifest);
        }
        let addressEvents = eventCache.get(manifestKey);
        if (addressEvents === undefined) {
          const pages = await Promise.all(
            addressManifest.pageArtifactHashes.map(async (sha256) => {
              const page = await input.loadAddressHistoryPage({
                runId: task.runId,
                sha256
              });
              if (fingerprintCanonicalArtifact(page) !== sha256) {
                throw new Error("unified_traversal_address_page_hash_mismatch");
              }
              return page;
            })
          );
          addressEvents = reviveEvents(addressManifest, pages);
          eventCache.set(manifestKey, addressEvents);
        }
        const expanded = expandTraversalChunk({
          frontier: group,
          events: traversalEvents(addressEvents),
          expandedStateIds: new Set(state.expandedStateIds),
          maxStatesThisChunk: group.length,
          terminalReason: () => null,
          accountCreationExhausted: () =>
            addressManifest!.exhaustion.kind === "account_creation_reached"
        });
        generated = [...expanded.nextFrontier];
        addedExpandedStateIds = [...expanded.processedStateIds];
        addedEligibleEventIds = [...expanded.eligibleEventIds];
        const eligibleStateIds = new Set(
          expanded.expandedStateIdsWithEligibleEvents
        );
        addedExpandedStateKeys = group
          .filter((item) => eligibleStateIds.has(traversalStateId(item)))
          .map(traversalExpansionKey);
        addedSupersededStateIds = [...expanded.supersededStateIds];
        for (const item of expanded.terminals) {
          const proof = buildUnifiedTraversalTerminalProof({
            state: item.state,
            reason: item.reason,
            labels: addressLabels,
            snapshotHash: context.manifest.snapshotHash,
            pageArtifactHashes: addressManifest.pageArtifactHashes
          });
          const evidenceHash = fingerprintCanonicalArtifact(proof);
          await input.persistArtifact({
            runId: task.runId,
            kind: "traversal_terminal_evidence",
            sha256: evidenceHash,
            artifact: proof
          });
          addedTerminals.push(buildUnifiedTraversalTerminalRecord({
            state: item.state,
            reason: item.reason,
            labels: addressLabels,
            evidenceHash,
            amountRaw: item.amountRaw
          }));
        }
      }

      const remaining = state.frontier.filter((item) =>
        !groupIds.has(traversalStateId(item))
      );
      const nextFrontier = mergeTraversalStates([...remaining, ...generated]);
      const difference = stateDifference(state.frontier, nextFrontier);
      const appended = appendTraversalDelta(v2, {
        addedFrontier: difference.added,
        removedFrontierStateIds: difference.removed,
        addedVisited: group,
        addedTerminals,
        addedSupersededStateIds,
        addedExpandedStateIds,
        addedEligibleEventIds,
        addedExpandedStateKeys,
        counterDeltas: {
          expanded: addedExpandedStateIds.length,
          terminal: addedTerminals.length,
          superseded: addedSupersededStateIds.length
        },
        diagnostic: {
          at: context.manifest.confirmedBlockTimestamp,
          code: `address-group:${first.direction}`
        }
      });
      await input.persistArtifact({
        runId: task.runId,
        kind: "traversal_delta",
        sha256: appended.sha256,
        artifact: appended.artifact
      });
      v2 = appended.checkpoint;
      state = {
        ...state,
        frontier: nextFrontier,
        visitedStates: [
          ...new Map(
            [...state.visitedStates, ...group]
              .map((item) => [traversalStateId(item), item])
          ).values()
        ].sort((left, right) =>
          traversalStateId(left).localeCompare(traversalStateId(right))
        ),
        expandedStateIds: [...new Set([
          ...state.expandedStateIds,
          ...addedExpandedStateIds
        ])].sort(),
        terminals: [...state.terminals, ...addedTerminals],
        supersededStateIds: [...new Set([
          ...state.supersededStateIds,
          ...addedSupersededStateIds
        ])].sort(),
        eligibleEventIds: [...new Set([
          ...state.eligibleEventIds,
          ...addedEligibleEventIds
        ])].sort(),
        expandedStateKeys: [...new Set([
          ...state.expandedStateKeys,
          ...addedExpandedStateKeys
        ])].sort()
      };
      processedAddressGroups += 1;
      await heartbeat();
    }

    if (state.frontier.length > 0) {
      return { kind: "checkpoint", checkpoint: v2 };
    }
    const artifact = await buildUnifiedTraversalCompletedArtifact(
      context,
      state
    );
    const artifactSha256 = fingerprintCanonicalArtifact(artifact);
    await input.persistArtifact({
      runId: task.runId,
      kind: "traversal_result",
      sha256: artifactSha256,
      artifact
    });
    return { kind: "completed", artifactSha256 };
  };
}
