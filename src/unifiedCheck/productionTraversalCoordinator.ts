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
import type { UnifiedOrderedReadyEntry } from "./plannerRepository";
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

type TraversalApplicationInput = {
  runId: string;
  context: LoadedTraversalContext;
  checkpoint: TraversalCheckpointV2;
  state: CoordinatorState;
  group: TraversalStateV1[];
  generated: TraversalStateV1[];
  addedExpandedStateIds: string[];
  addedEligibleEventIds: string[];
  addedExpandedStateKeys: string[];
  addedSupersededStateIds: string[];
  addedTerminals: UnifiedTraversalTerminalV1[];
  persistArtifact(args: {
    runId: string;
    kind: PersistKind;
    sha256: string;
    artifact: unknown;
  }): Promise<void>;
};

async function persistTraversalApplication(
  input: TraversalApplicationInput
): Promise<{ checkpoint: TraversalCheckpointV2; state: CoordinatorState }> {
  const first = input.group[0]!;
  const groupIds = new Set(input.group.map(traversalStateId));
  const remaining = input.state.frontier.filter((item) =>
    !groupIds.has(traversalStateId(item))
  );
  const nextFrontier = mergeTraversalStates([
    ...remaining,
    ...input.generated
  ]);
  const difference = stateDifference(input.state.frontier, nextFrontier);
  const observedAddresses = new Set([
    ...input.state.visitedStates.map((item) => item.address),
    ...input.group.map((item) => item.address),
    ...nextFrontier.map((item) => item.address),
    ...input.state.terminals.map((item) => item.address),
    ...input.addedTerminals.map((item) => item.address)
  ]);
  const observedEpisodes = new Set([
    ...input.state.visitedStates.map((item) => item.fundingEpisodeId),
    ...input.group.map((item) => item.fundingEpisodeId),
    ...nextFrontier.map((item) => item.fundingEpisodeId),
    ...input.state.terminals.map((item) => item.fundingEpisodeId),
    ...input.addedTerminals.map((item) => item.fundingEpisodeId)
  ]);
  const appended = appendTraversalDelta(input.checkpoint, {
    addedFrontier: difference.added,
    removedFrontierStateIds: difference.removed,
    addedVisited: input.group,
    addedTerminals: input.addedTerminals,
    addedSupersededStateIds: input.addedSupersededStateIds,
    addedExpandedStateIds: input.addedExpandedStateIds,
    addedEligibleEventIds: input.addedEligibleEventIds,
    addedExpandedStateKeys: input.addedExpandedStateKeys,
    counterDeltas: {
      expanded: input.addedExpandedStateIds.length,
      terminal: input.addedTerminals.length,
      superseded: input.addedSupersededStateIds.length
    },
    operational: {
      frontierCount: nextFrontier.length,
      frontierPeak: Math.max(
        input.checkpoint.operational?.frontierPeak ??
          input.state.frontier.length,
        nextFrontier.length
      ),
      uniqueAddresses: observedAddresses.size,
      fundingEpisodes: observedEpisodes.size
    },
    diagnostic: {
      at: input.context.manifest.confirmedBlockTimestamp,
      code: `address-group:${first.direction}`
    }
  });
  await input.persistArtifact({
    runId: input.runId,
    kind: "traversal_delta",
    sha256: appended.sha256,
    artifact: appended.artifact
  });
  return {
    checkpoint: appended.checkpoint,
    state: {
      ...input.state,
      frontier: nextFrontier,
      visitedStates: [
        ...new Map(
          [...input.state.visitedStates, ...input.group]
            .map((item) => [traversalStateId(item), item])
        ).values()
      ].sort((left, right) =>
        traversalStateId(left).localeCompare(traversalStateId(right))
      ),
      expandedStateIds: [...new Set([
        ...input.state.expandedStateIds,
        ...input.addedExpandedStateIds
      ])].sort(),
      terminals: [
        ...input.state.terminals,
        ...input.addedTerminals
      ],
      supersededStateIds: [...new Set([
        ...input.state.supersededStateIds,
        ...input.addedSupersededStateIds
      ])].sort(),
      eligibleEventIds: [...new Set([
        ...input.state.eligibleEventIds,
        ...input.addedEligibleEventIds
      ])].sort(),
      expandedStateKeys: [...new Set([
        ...input.state.expandedStateKeys,
        ...input.addedExpandedStateKeys
      ])].sort()
    }
  };
}

async function applyAcceptedAddressHistory(input: {
  runId: string;
  context: LoadedTraversalContext;
  checkpoint: TraversalCheckpointV2;
  state: CoordinatorState;
  group: TraversalStateV1[];
  addressLabels: readonly string[];
  manifest: AddressHistoryManifestV1;
  eventCache: Map<string, IndexedTronUsdtTransfer[]>;
  loadAddressHistoryPage(args: {
    runId: string;
    sha256: string;
  }): Promise<UnifiedAddressHistoryPageArtifactV1>;
  persistArtifact(args: {
    runId: string;
    kind: PersistKind;
    sha256: string;
    artifact: unknown;
  }): Promise<void>;
}): Promise<{ checkpoint: TraversalCheckpointV2; state: CoordinatorState }> {
  let addressEvents = input.eventCache.get(input.manifest.key);
  if (addressEvents === undefined) {
    const pages = await Promise.all(
      input.manifest.pageArtifactHashes.map(async (sha256) => {
        const page = await input.loadAddressHistoryPage({
          runId: input.runId,
          sha256
        });
        if (fingerprintCanonicalArtifact(page) !== sha256) {
          throw new Error("unified_traversal_address_page_hash_mismatch");
        }
        return page;
      })
    );
    addressEvents = reviveEvents(input.manifest, pages);
    input.eventCache.set(input.manifest.key, addressEvents);
  }
  const expanded = expandTraversalChunk({
    frontier: input.group,
    events: traversalEvents(addressEvents),
    expandedStateIds: new Set(input.state.expandedStateIds),
    maxStatesThisChunk: input.group.length,
    terminalReason: () => null,
    accountCreationExhausted: () =>
      input.manifest.exhaustion.kind === "account_creation_reached"
  });
  const eligibleStateIds = new Set(
    expanded.expandedStateIdsWithEligibleEvents
  );
  const addedTerminals: UnifiedTraversalTerminalV1[] = [];
  for (const item of expanded.terminals) {
    const proof = buildUnifiedTraversalTerminalProof({
      state: item.state,
      reason: item.reason,
      labels: input.addressLabels,
      snapshotHash: input.context.manifest.snapshotHash,
      pageArtifactHashes: input.manifest.pageArtifactHashes
    });
    const evidenceHash = fingerprintCanonicalArtifact(proof);
    await input.persistArtifact({
      runId: input.runId,
      kind: "traversal_terminal_evidence",
      sha256: evidenceHash,
      artifact: proof
    });
    addedTerminals.push(buildUnifiedTraversalTerminalRecord({
      state: item.state,
      reason: item.reason,
      labels: input.addressLabels,
      evidenceHash,
      amountRaw: item.amountRaw
    }));
  }
  return persistTraversalApplication({
    runId: input.runId,
    context: input.context,
    checkpoint: input.checkpoint,
    state: input.state,
    group: input.group,
    generated: [...expanded.nextFrontier],
    addedExpandedStateIds: [...expanded.processedStateIds],
    addedEligibleEventIds: [...expanded.eligibleEventIds],
    addedExpandedStateKeys: input.group
      .filter((item) => eligibleStateIds.has(traversalStateId(item)))
      .map(traversalExpansionKey),
    addedSupersededStateIds: [...expanded.supersededStateIds],
    addedTerminals,
    persistArtifact: input.persistArtifact
  });
}

async function applyBoundaryAddressHistory(input: {
  runId: string;
  context: LoadedTraversalContext;
  checkpoint: TraversalCheckpointV2;
  state: CoordinatorState;
  group: TraversalStateV1[];
  addressLabels: readonly string[];
  reason: NonNullable<ReturnType<typeof unifiedTraversalBoundary>>;
  persistArtifact(args: {
    runId: string;
    kind: PersistKind;
    sha256: string;
    artifact: unknown;
  }): Promise<void>;
}): Promise<{ checkpoint: TraversalCheckpointV2; state: CoordinatorState }> {
  const addedTerminals: UnifiedTraversalTerminalV1[] = [];
  for (const item of input.group) {
    const proof = buildUnifiedTraversalTerminalProof({
      state: item,
      reason: input.reason,
      labels: input.addressLabels,
      snapshotHash: input.context.manifest.snapshotHash,
      pageArtifactHashes: []
    });
    const evidenceHash = fingerprintCanonicalArtifact(proof);
    await input.persistArtifact({
      runId: input.runId,
      kind: "traversal_terminal_evidence",
      sha256: evidenceHash,
      artifact: proof
    });
    addedTerminals.push(buildUnifiedTraversalTerminalRecord({
      state: item,
      reason: input.reason,
      labels: input.addressLabels,
      evidenceHash
    }));
  }
  return persistTraversalApplication({
    runId: input.runId,
    context: input.context,
    checkpoint: input.checkpoint,
    state: input.state,
    group: input.group,
    generated: [],
    addedExpandedStateIds: [],
    addedEligibleEventIds: [],
    addedExpandedStateKeys: [],
    addedSupersededStateIds: [],
    addedTerminals,
    persistArtifact: input.persistArtifact
  });
}

export function createUnifiedTraversalCoordinatorHandler(input: {
  commitMaxEntries: number;
  commitMaxBytes: number;
  manifestMaxBytes: number;
  loadContext(runId: string): Promise<LoadedTraversalContext>;
  loadLabels(args: {
    labelDatasetSha256: string;
    addresses: readonly string[];
  }): Promise<ReadonlyMap<string, readonly string[]>>;
  loadDurableAddressHistoryKeys(args: {
    runId: string;
    manifestKeys: readonly string[];
  }): Promise<ReadonlySet<string>>;
  createTaskId(): string;
  loadReadyAddressHistories(args: {
    runId: string;
    maxEntries: number;
    maxBytes: number;
  }): Promise<readonly UnifiedOrderedReadyEntry[]>;
  loadCommittedAddressHistories(args: {
    runId: string;
    manifestKeys: readonly string[];
  }): Promise<readonly UnifiedOrderedReadyEntry[]>;
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
    !Number.isSafeInteger(input.commitMaxEntries) ||
    input.commitMaxEntries < 1
  ) {
    throw new TypeError("unified_traversal_commit_entries_invalid");
  }
  if (
    !Number.isSafeInteger(input.commitMaxBytes) ||
    input.commitMaxBytes < 1
  ) {
    throw new TypeError("unified_traversal_commit_bytes_invalid");
  }
  if (
    !Number.isSafeInteger(input.manifestMaxBytes) ||
    input.manifestMaxBytes < 1
  ) {
    throw new TypeError("unified_traversal_manifest_bytes_invalid");
  }
  if (input.commitMaxBytes < input.manifestMaxBytes) {
    throw new TypeError("unified_traversal_commit_bytes_too_small");
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
    const persistedDeltaHeadSha256 = v2.deltaHeadSha256;
    const eventCache = new Map<string, IndexedTronUsdtTransfer[]>();

    type MandatoryHistory = {
      manifestKey: string;
      identity: AddressHistoryManifestIdentityV1;
    };
    const loadMandatory = async () => {
      const frontierAddresses = [...new Set(
        state.frontier.map((item) => item.address)
      )];
      const loadedLabels = await input.loadLabels({
        labelDatasetSha256: context.manifest.labelDatasetSha256,
        addresses: frontierAddresses
      });
      const loadedMandatory = new Map<string, MandatoryHistory>();
      for (const item of state.frontier) {
        if (
          unifiedTraversalBoundary(
            loadedLabels.get(item.address) ?? []
          ) !== null
        ) {
          continue;
        }
        const addressIdentity = identity(context, item.address);
        const manifestKey = addressHistoryManifestKey(addressIdentity);
        if (!loadedMandatory.has(manifestKey)) {
          loadedMandatory.set(manifestKey, {
            manifestKey,
            identity: addressIdentity
          });
        }
      }
      return { labels: loadedLabels, mandatory: loadedMandatory };
    };
    let { labels, mandatory } = await loadMandatory();
    const mandatoryKeys = [...mandatory.keys()].sort();
    const durable = new Set(await input.loadDurableAddressHistoryKeys({
      runId: task.runId,
      manifestKeys: mandatoryKeys
    }));
    const discoveries = new Map<string, {
      parentCanonicalSequence: number;
      taskId: string;
      kind: "address_history";
      logicalKey: string;
      priorityLane: "interactive" | "repair" | "background";
      checkpoint: unknown;
    }>();
    const discover = (
      history: MandatoryHistory,
      parentCanonicalSequence: number
    ) => {
      if (
        durable.has(history.manifestKey) ||
        discoveries.has(history.manifestKey)
      ) {
        return;
      }
      discoveries.set(history.manifestKey, {
        parentCanonicalSequence,
        taskId: input.createTaskId(),
        kind: "address_history",
        logicalKey: history.manifestKey,
        priorityLane: task.priorityLane ?? "interactive",
        checkpoint: {
          version: "unified-address-history-checkpoint-v2",
          identity: history.identity,
          history: null,
          chunkHeadSha256: null,
          chunkCount: 0,
          pageCount: 0,
          rawRowCount: 0
        }
      });
    };
    const newlyMandatory = [...mandatory.values()]
      .filter((history) => !durable.has(history.manifestKey))
      .sort((left, right) =>
        left.manifestKey.localeCompare(right.manifestKey)
      );
    for (const history of newlyMandatory) discover(history, -1);
    if (discoveries.size > 0) {
      return {
        kind: "checkpoint",
        checkpoint: v2,
        orderedCommit: {
          runId: task.runId,
          expectedDeltaHeadSha256: persistedDeltaHeadSha256,
          entries: [],
          discoveredTasks: [...discoveries.values()]
        }
      };
    }
    const collectDiscoveries = async (parentCanonicalSequence: number) => {
      ({ labels, mandatory } = await loadMandatory());
      const candidates = [...mandatory.values()]
        .filter((history) =>
          !durable.has(history.manifestKey) &&
          !discoveries.has(history.manifestKey)
        )
        .sort((left, right) =>
          left.manifestKey.localeCompare(right.manifestKey)
        );
      if (candidates.length === 0) return;
      const existing = await input.loadDurableAddressHistoryKeys({
        runId: task.runId,
        manifestKeys: candidates.map((history) => history.manifestKey)
      });
      for (const manifestKey of existing) durable.add(manifestKey);
      for (const history of candidates) {
        discover(history, parentCanonicalSequence);
      }
    };
    const applyManifestEntry = async (
      entry: UnifiedOrderedReadyEntry
    ): Promise<void> => {
      const addressManifest = entry.artifact as
        Partial<AddressHistoryManifestV1>;
      if (
        entry.artifactKind !== "address_history_manifest" ||
        entry.artifactSchemaVersion !== "1" ||
        addressManifest.version !==
          "unified-address-history-manifest-v1" ||
        addressManifest.schemaVersion !== 1 ||
        typeof addressManifest.key !== "string"
      ) {
        throw new Error("unified_traversal_address_manifest_mismatch");
      }
      const planned = mandatory.get(addressManifest.key);
      if (
        !planned ||
        addressManifest.snapshotHash !==
          context.manifest.snapshotHash ||
        addressManifest.address !== planned.identity.address ||
        addressManifest.tokenContract !==
          TRON_USDT_CONTRACT_ADDRESS ||
        addressManifest.providerRequestVersion !==
          ADDRESS_HISTORY_PROVIDER_VERSION
      ) {
        throw new Error("unified_traversal_address_manifest_mismatch");
      }
      while (true) {
        const first = state.frontier.find((candidate) =>
          candidate.address === addressManifest.address
        );
        if (!first) break;
        const group = state.frontier.filter((candidate) =>
          candidate.address === first.address &&
          candidate.direction === first.direction
        );
        const applied = await applyAcceptedAddressHistory({
          runId: task.runId,
          context,
          checkpoint: v2,
          state,
          group,
          addressLabels: labels.get(first.address) ?? [],
          manifest: addressManifest as AddressHistoryManifestV1,
          eventCache,
          loadAddressHistoryPage: input.loadAddressHistoryPage,
          persistArtifact: input.persistArtifact
        });
        v2 = applied.checkpoint;
        state = applied.state;
        await heartbeat();
      }
      await collectDiscoveries(entry.canonicalSequence);
    };
    const committedHistories = await input.loadCommittedAddressHistories({
      runId: task.runId,
      manifestKeys: mandatoryKeys
    });
    for (const entry of committedHistories) await applyManifestEntry(entry);
    const reusedCommittedHistory = committedHistories.length > 0;
    const readyPrefix = await input.loadReadyAddressHistories({
      runId: task.runId,
      maxEntries: input.commitMaxEntries,
      maxBytes: input.commitMaxBytes
    });

    if (readyPrefix.length > 0) {
      for (const entry of readyPrefix) await applyManifestEntry(entry);
      return {
        kind: "checkpoint",
        checkpoint: v2,
        orderedCommit: {
          runId: task.runId,
          expectedDeltaHeadSha256: persistedDeltaHeadSha256,
          entries: readyPrefix.map((entry) => ({
            canonicalSequence: entry.canonicalSequence,
            taskId: entry.taskId,
            logicalKey: entry.logicalKey,
            acceptedAttemptId: entry.acceptedAttemptId,
            resultBytes: entry.resultBytes,
            taskKind: "address_history",
            artifactKind: "address_history_manifest",
            artifactSchemaVersion: "1"
          })),
          discoveredTasks: [...discoveries.values()]
        }
      };
    }

    if (reusedCommittedHistory) {
      return discoveries.size > 0
        ? {
            kind: "checkpoint",
            checkpoint: v2,
            orderedCommit: {
              runId: task.runId,
              expectedDeltaHeadSha256: persistedDeltaHeadSha256,
              entries: [],
              discoveredTasks: [...discoveries.values()]
            }
          }
        : { kind: "checkpoint", checkpoint: v2 };
    }
    if (mandatoryKeys.length > 0) {
      return { kind: "checkpoint", checkpoint: v2 };
    }

    let processedBoundaryGroups = 0;
    while (
      state.frontier.length > 0 &&
      processedBoundaryGroups < input.commitMaxEntries
    ) {
      const first = state.frontier[0]!;
      const addressLabels = labels.get(first.address) ?? [];
      const boundary = unifiedTraversalBoundary(addressLabels);
      if (boundary === null) break;
      const group = state.frontier.filter((candidate) =>
        candidate.address === first.address &&
        candidate.direction === first.direction
      );
      const applied = await applyBoundaryAddressHistory({
        runId: task.runId,
        context,
        checkpoint: v2,
        state,
        group,
        addressLabels,
        reason: boundary,
        persistArtifact: input.persistArtifact
      });
      v2 = applied.checkpoint;
      state = applied.state;
      processedBoundaryGroups += 1;
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
