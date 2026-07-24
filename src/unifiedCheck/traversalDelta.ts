import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import {
  traversalStateId,
  type TraversalStateV1
} from "./traversal";

const HASH = /^[0-9a-f]{64}$/u;
const MAX_RECENT_DIAGNOSTICS = 8;

export type TraversalDiagnosticSampleV1 = {
  readonly at: string;
  readonly code: string;
};

export type TraversalDeltaCountersV1 = {
  readonly expanded: number;
  readonly terminal: number;
  readonly superseded: number;
};

export type TraversalCheckpointV2 = {
  readonly version: "unified-production-traversal-checkpoint-v2";
  readonly analysisManifestHash: string;
  readonly snapshotHash: string;
  readonly deltaHeadSha256: string | null;
  readonly compactionSha256: string | null;
  readonly counters: TraversalDeltaCountersV1;
  readonly recentDiagnostics: readonly TraversalDiagnosticSampleV1[];
};

export type TraversalDeltaArtifactV1 = {
  readonly version: "unified-traversal-delta-v1";
  readonly previousDeltaHash: string | null;
  readonly addedFrontier: readonly TraversalStateV1[];
  readonly removedFrontierStateIds: readonly string[];
  readonly addedVisited: readonly TraversalStateV1[];
  readonly addedTerminals: readonly unknown[];
  readonly addedSupersededStateIds: readonly string[];
  readonly addedExpandedStateIds: readonly string[];
  readonly addedEligibleEventIds: readonly string[];
  readonly addedExpandedStateKeys: readonly string[];
  readonly counterDeltas: TraversalDeltaCountersV1;
};

export type TraversalCompactionArtifactV2 = {
  readonly version: "unified-traversal-compaction-v2";
  readonly analysisManifestHash: string;
  readonly snapshotHash: string;
  readonly sourceCheckpointSha256: string;
  readonly frontier: readonly TraversalStateV1[];
  readonly visited: readonly TraversalStateV1[];
  readonly terminals: readonly unknown[];
  readonly supersededStateIds: readonly string[];
  readonly expandedStateIds: readonly string[];
  readonly eligibleEventIds: readonly string[];
  readonly expandedStateKeys: readonly string[];
  readonly selectedBackwardRaw: string;
  readonly selectedForwardRaw: string;
};

export type TraversalCheckpointUpgradeArtifactV1 = {
  readonly version: "unified-traversal-checkpoint-upgrade-v1";
  readonly upgraderVersion: "unified-traversal-v1-to-v2";
  readonly sourceCheckpointSha256: string;
  readonly compactionSha256: string;
  readonly targetCheckpointSha256: string;
};

type LegacyTraversalCheckpointV1 = {
  readonly version: "unified-production-traversal-checkpoint-v1";
  readonly frontier: readonly TraversalStateV1[];
  readonly visitedStates: readonly TraversalStateV1[];
  readonly expandedStateIds: readonly string[];
  readonly terminals: readonly unknown[];
  readonly supersededStateIds: readonly string[];
  readonly active: unknown;
  readonly eligibleEventIds: readonly string[];
  readonly expandedStateKeys: readonly string[];
  readonly selectedBackwardRaw: string;
  readonly selectedForwardRaw: string;
};

function hash(value: string, code: string): string {
  if (!HASH.test(value)) throw new TypeError(code);
  return value;
}

function count(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(code);
  return value;
}

function timestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError("unified_traversal_delta_diagnostic_time_invalid");
  }
  return value;
}

function sortStates(states: Iterable<TraversalStateV1>): TraversalStateV1[] {
  return [...states].sort((left, right) =>
    traversalStateId(left).localeCompare(traversalStateId(right))
  );
}

function validateCheckpoint(checkpoint: TraversalCheckpointV2): void {
  if (
    checkpoint.version !== "unified-production-traversal-checkpoint-v2" ||
    !HASH.test(checkpoint.analysisManifestHash) ||
    !HASH.test(checkpoint.snapshotHash) ||
    (checkpoint.deltaHeadSha256 !== null &&
      !HASH.test(checkpoint.deltaHeadSha256)) ||
    (checkpoint.compactionSha256 !== null &&
      !HASH.test(checkpoint.compactionSha256)) ||
    checkpoint.recentDiagnostics.length > MAX_RECENT_DIAGNOSTICS
  ) {
    throw new Error("unified_traversal_checkpoint_v2_invalid");
  }
  count(checkpoint.counters.expanded, "unified_traversal_counter_invalid");
  count(checkpoint.counters.terminal, "unified_traversal_counter_invalid");
  count(checkpoint.counters.superseded, "unified_traversal_counter_invalid");
}

export function initialTraversalCheckpointV2(input: {
  analysisManifestHash: string;
  snapshotHash: string;
}): TraversalCheckpointV2 {
  return {
    version: "unified-production-traversal-checkpoint-v2",
    analysisManifestHash: hash(
      input.analysisManifestHash,
      "unified_traversal_manifest_hash_invalid"
    ),
    snapshotHash: hash(
      input.snapshotHash,
      "unified_traversal_snapshot_hash_invalid"
    ),
    deltaHeadSha256: null,
    compactionSha256: null,
    counters: { expanded: 0, terminal: 0, superseded: 0 },
    recentDiagnostics: []
  };
}

export function appendTraversalDelta(
  checkpoint: TraversalCheckpointV2,
  delta: Omit<TraversalDeltaArtifactV1, "version" | "previousDeltaHash"> & {
    readonly diagnostic?: TraversalDiagnosticSampleV1;
  }
): {
  readonly checkpoint: TraversalCheckpointV2;
  readonly artifact: TraversalDeltaArtifactV1;
  readonly sha256: string;
} {
  validateCheckpoint(checkpoint);
  const counterDeltas = {
    expanded: count(
      delta.counterDeltas.expanded,
      "unified_traversal_delta_counter_invalid"
    ),
    terminal: count(
      delta.counterDeltas.terminal,
      "unified_traversal_delta_counter_invalid"
    ),
    superseded: count(
      delta.counterDeltas.superseded,
      "unified_traversal_delta_counter_invalid"
    )
  };
  const artifact: TraversalDeltaArtifactV1 = {
    version: "unified-traversal-delta-v1",
    previousDeltaHash: checkpoint.deltaHeadSha256,
    addedFrontier: sortStates(delta.addedFrontier),
    removedFrontierStateIds:
      [...new Set(delta.removedFrontierStateIds)].sort(),
    addedVisited: sortStates(delta.addedVisited),
    addedTerminals: [...delta.addedTerminals],
    addedSupersededStateIds:
      [...new Set(delta.addedSupersededStateIds)].sort(),
    addedExpandedStateIds:
      [...new Set(delta.addedExpandedStateIds)].sort(),
    addedEligibleEventIds:
      [...new Set(delta.addedEligibleEventIds)].sort(),
    addedExpandedStateKeys:
      [...new Set(delta.addedExpandedStateKeys)].sort(),
    counterDeltas
  };
  const sha256 = fingerprintCanonicalArtifact(artifact);
  const diagnostics = delta.diagnostic === undefined
    ? checkpoint.recentDiagnostics
    : [
        ...checkpoint.recentDiagnostics,
        {
          at: timestamp(delta.diagnostic.at),
          code: delta.diagnostic.code
        }
      ].slice(-MAX_RECENT_DIAGNOSTICS);
  return {
    artifact,
    sha256,
    checkpoint: {
      ...checkpoint,
      deltaHeadSha256: sha256,
      counters: {
        expanded: checkpoint.counters.expanded + counterDeltas.expanded,
        terminal: checkpoint.counters.terminal + counterDeltas.terminal,
        superseded:
          checkpoint.counters.superseded + counterDeltas.superseded
      },
      recentDiagnostics: diagnostics
    }
  };
}

export function replayTraversalDeltas(
  artifacts: readonly TraversalDeltaArtifactV1[],
  base: {
    readonly frontier?: readonly TraversalStateV1[];
    readonly visited?: readonly TraversalStateV1[];
    readonly terminals?: readonly unknown[];
    readonly supersededStateIds?: readonly string[];
    readonly expandedStateIds?: readonly string[];
    readonly eligibleEventIds?: readonly string[];
    readonly expandedStateKeys?: readonly string[];
    readonly counters?: TraversalDeltaCountersV1;
    readonly previousDeltaHash?: string | null;
  } = {}
): {
  readonly frontier: readonly TraversalStateV1[];
  readonly visited: readonly TraversalStateV1[];
  readonly terminals: readonly unknown[];
  readonly supersededStateIds: readonly string[];
  readonly expandedStateIds: readonly string[];
  readonly eligibleEventIds: readonly string[];
  readonly expandedStateKeys: readonly string[];
  readonly counters: TraversalDeltaCountersV1;
} {
  const frontier = new Map(
    (base.frontier ?? []).map((item) => [traversalStateId(item), item])
  );
  const visited = new Map(
    (base.visited ?? []).map((item) => [traversalStateId(item), item])
  );
  const terminals = [...(base.terminals ?? [])];
  const superseded = new Set(base.supersededStateIds ?? []);
  const expandedStateIds = new Set(base.expandedStateIds ?? []);
  const eligibleEventIds = new Set(base.eligibleEventIds ?? []);
  const expandedStateKeys = new Set(base.expandedStateKeys ?? []);
  const counters = { ...(base.counters ?? {
    expanded: 0,
    terminal: 0,
    superseded: 0
  }) };
  let previous = base.previousDeltaHash ?? null;

  for (const artifact of artifacts) {
    if (
      artifact.version !== "unified-traversal-delta-v1" ||
      artifact.previousDeltaHash !== previous
    ) {
      throw new Error("unified_traversal_delta_chain_invalid");
    }
    for (const stateId of artifact.removedFrontierStateIds) {
      frontier.delete(stateId);
    }
    for (const item of artifact.addedFrontier) {
      frontier.set(traversalStateId(item), item);
    }
    for (const item of artifact.addedVisited) {
      visited.set(traversalStateId(item), item);
    }
    terminals.push(...artifact.addedTerminals);
    for (const stateId of artifact.addedSupersededStateIds) {
      superseded.add(stateId);
    }
    for (const stateId of artifact.addedExpandedStateIds) {
      expandedStateIds.add(stateId);
    }
    for (const eventId of artifact.addedEligibleEventIds) {
      eligibleEventIds.add(eventId);
    }
    for (const key of artifact.addedExpandedStateKeys) {
      expandedStateKeys.add(key);
    }
    counters.expanded += artifact.counterDeltas.expanded;
    counters.terminal += artifact.counterDeltas.terminal;
    counters.superseded += artifact.counterDeltas.superseded;
    previous = fingerprintCanonicalArtifact(artifact);
  }
  return {
    frontier: sortStates(frontier.values()),
    visited: sortStates(visited.values()),
    terminals,
    supersededStateIds: [...superseded].sort(),
    expandedStateIds: [...expandedStateIds].sort(),
    eligibleEventIds: [...eligibleEventIds].sort(),
    expandedStateKeys: [...expandedStateKeys].sort(),
    counters
  };
}

function isV2(value: unknown): value is TraversalCheckpointV2 {
  return Boolean(
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { version?: unknown }).version ===
      "unified-production-traversal-checkpoint-v2"
  );
}

function legacyCheckpoint(value: unknown): LegacyTraversalCheckpointV1 {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { version?: unknown }).version !==
      "unified-production-traversal-checkpoint-v1"
  ) {
    throw new Error("unified_traversal_checkpoint_upgrade_source_invalid");
  }
  const record = value as Partial<LegacyTraversalCheckpointV1>;
  for (const collection of [
    record.frontier,
    record.visitedStates,
    record.expandedStateIds,
    record.terminals,
    record.supersededStateIds,
    record.eligibleEventIds,
    record.expandedStateKeys
  ]) {
    if (!Array.isArray(collection)) {
      throw new Error("unified_traversal_checkpoint_upgrade_source_invalid");
    }
  }
  if (
    typeof record.selectedBackwardRaw !== "string" ||
    typeof record.selectedForwardRaw !== "string"
  ) {
    throw new Error("unified_traversal_checkpoint_upgrade_source_invalid");
  }
  return record as LegacyTraversalCheckpointV1;
}

export function upgradeTraversalCheckpointV1(input: {
  checkpoint: unknown;
  analysisManifestHash: string;
  snapshotHash: string;
}): {
  readonly upgraded: boolean;
  readonly checkpoint: TraversalCheckpointV2;
  readonly compactionArtifact: TraversalCompactionArtifactV2 | null;
  readonly upgradeArtifact: TraversalCheckpointUpgradeArtifactV1 | null;
} {
  if (isV2(input.checkpoint)) {
    validateCheckpoint(input.checkpoint);
    if (
      input.checkpoint.analysisManifestHash !== input.analysisManifestHash ||
      input.checkpoint.snapshotHash !== input.snapshotHash
    ) {
      throw new Error("unified_traversal_checkpoint_upgrade_binding_mismatch");
    }
    return {
      upgraded: false,
      checkpoint: input.checkpoint,
      compactionArtifact: null,
      upgradeArtifact: null
    };
  }
  const source = legacyCheckpoint(input.checkpoint);
  const analysisManifestHash = hash(
    input.analysisManifestHash,
    "unified_traversal_manifest_hash_invalid"
  );
  const snapshotHash = hash(
    input.snapshotHash,
    "unified_traversal_snapshot_hash_invalid"
  );
  const sourceCheckpointSha256 = fingerprintCanonicalArtifact(source);
  const compactionArtifact: TraversalCompactionArtifactV2 = {
    version: "unified-traversal-compaction-v2",
    analysisManifestHash,
    snapshotHash,
    sourceCheckpointSha256,
    frontier: sortStates(source.frontier),
    visited: sortStates(source.visitedStates),
    terminals: [...source.terminals],
    supersededStateIds: [...new Set(source.supersededStateIds)].sort(),
    expandedStateIds: [...new Set(source.expandedStateIds)].sort(),
    eligibleEventIds: [...new Set(source.eligibleEventIds)].sort(),
    expandedStateKeys: [...new Set(source.expandedStateKeys)].sort(),
    selectedBackwardRaw: source.selectedBackwardRaw,
    selectedForwardRaw: source.selectedForwardRaw
  };
  const compactionSha256 = fingerprintCanonicalArtifact(compactionArtifact);
  const checkpoint: TraversalCheckpointV2 = {
    version: "unified-production-traversal-checkpoint-v2",
    analysisManifestHash,
    snapshotHash,
    deltaHeadSha256: null,
    compactionSha256,
    counters: {
      expanded: source.expandedStateIds.length,
      terminal: source.terminals.length,
      superseded: source.supersededStateIds.length
    },
    recentDiagnostics: [{
      at: "1970-01-01T00:00:00.000Z",
      code: "checkpoint:v1-to-v2"
    }]
  };
  const upgradeArtifact: TraversalCheckpointUpgradeArtifactV1 = {
    version: "unified-traversal-checkpoint-upgrade-v1",
    upgraderVersion: "unified-traversal-v1-to-v2",
    sourceCheckpointSha256,
    compactionSha256,
    targetCheckpointSha256: fingerprintCanonicalArtifact(checkpoint)
  };
  return {
    upgraded: true,
    checkpoint,
    compactionArtifact,
    upgradeArtifact
  };
}
