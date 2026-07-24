import { describe, expect, it } from "vitest";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import { canonicalTronUsdtEventKey } from "../../src/forensics/tronAddressAllTimeIndex";
import type { IndexedTronUsdtTransfer } from "../../src/types";
import {
  addressHistoryManifestKey,
  buildAddressHistoryManifest,
  type AddressHistoryManifestIdentityV1,
  type AddressHistoryManifestV1
} from "../../src/unifiedCheck/addressHistory";
import type { AnalysisManifestV1 } from "../../src/unifiedCheck/contracts";
import { selectBoundedReadyPrefix } from "../../src/unifiedCheck/planner";
import {
  canonicalOrderedDiscoveries,
  type UnifiedOrderedReadyEntry,
  type UnifiedOrderedTaskDiscoveryInput
} from "../../src/unifiedCheck/plannerRepository";
import type { UnifiedAddressHistoryPageArtifactV1 } from "../../src/unifiedCheck/productionAddressHistory";
import type { UnifiedTraversalArtifactV1 } from "../../src/unifiedCheck/productionTraversal";
import {
  createUnifiedTraversalCoordinatorHandler
} from "../../src/unifiedCheck/productionTraversalCoordinator";
import type {
  TraversalCompactionArtifactV2,
  TraversalDeltaArtifactV1
} from "../../src/unifiedCheck/traversalDelta";

const SUBJECT = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const FIRST_PARENT = "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9";
const SECOND_PARENT = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const FIRST_CHILD = "TAFdghHDf13ckUNZRw6dit4C4KfzRFWY1k";
const SHARED_CHILD = "TANPg1qXHmuc53VW4BrcJJM338X5oVs1m9";
const SECOND_CHILD = "TBL8TQTyw2GjwV3g9eZM27ajgywKZzaz3n";
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const CAPACITIES = [1, 4, 8, 16, 32, 100] as const;

const manifest: AnalysisManifestV1 = {
  version: "analysis-manifest-v1",
  schemaVersion: 1,
  runId: "replay-run",
  requestHash: "a".repeat(64),
  snapshotHash: "b".repeat(64),
  chain: "tron",
  subjectAddress: SUBJECT,
  confirmedBlockNumber: "100",
  confirmedBlockHash: "c".repeat(64),
  confirmedBlockTimestamp: "2026-07-23T13:00:00.000Z",
  labelDatasetSha256: "d".repeat(64),
  scoringPolicyVersion: "scoring-signal-matrix-v4",
  attributionPolicyVersion: "selected-attribution-policy-v1",
  traversalPolicyVersion: "snapshot-closure-v1",
  runtimeCommit: "candidate",
  databaseSchemaVersion: 34,
  paginationCutoffBlockNumber: "100",
  paginationCutoffBlockHash: "c".repeat(64),
  branchArtifactHashes: {
    fast: "e".repeat(64),
    where: "f".repeat(64),
    deep: "1".repeat(64)
  }
};

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function shuffled<T>(values: readonly T[], seed: number): T[] {
  const random = seeded(seed);
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(random() * (index + 1));
    [result[index], result[selected]] =
      [result[selected]!, result[index]!];
  }
  return result;
}

function event(input: {
  hash: string;
  from: string;
  to: string;
  amountRaw: string;
  timestamp: string;
}): IndexedTronUsdtTransfer {
  return {
    txHash: input.hash,
    blockNumber: 90,
    blockTimestamp: new Date(input.timestamp),
    eventIndex: 0,
    fromAddress: input.from,
    toAddress: input.to,
    amountRaw: input.amountRaw,
    method: "transfer",
    callerAddress: null,
    contractRet: "SUCCESS",
    confirmed: true
  };
}

const directEvents = [
  event({
    hash: "2".repeat(64),
    from: FIRST_PARENT,
    to: SUBJECT,
    amountRaw: "10",
    timestamp: "2026-07-23T12:10:00.000Z"
  }),
  event({
    hash: "3".repeat(64),
    from: SECOND_PARENT,
    to: SUBJECT,
    amountRaw: "20",
    timestamp: "2026-07-23T12:00:00.000Z"
  })
] as const;

const historyEvents = new Map<string, readonly IndexedTronUsdtTransfer[]>([
  [FIRST_PARENT, [
    event({
      hash: "4".repeat(64),
      from: FIRST_CHILD,
      to: FIRST_PARENT,
      amountRaw: "4",
      timestamp: "2026-07-23T11:10:00.000Z"
    }),
    event({
      hash: "5".repeat(64),
      from: SHARED_CHILD,
      to: FIRST_PARENT,
      amountRaw: "6",
      timestamp: "2026-07-23T11:00:00.000Z"
    })
  ]],
  [SECOND_PARENT, [
    event({
      hash: "6".repeat(64),
      from: SHARED_CHILD,
      to: SECOND_PARENT,
      amountRaw: "8",
      timestamp: "2026-07-23T10:50:00.000Z"
    }),
    event({
      hash: "7".repeat(64),
      from: SECOND_CHILD,
      to: SECOND_PARENT,
      amountRaw: "12",
      timestamp: "2026-07-23T10:40:00.000Z"
    })
  ]],
  [FIRST_CHILD, []],
  [SHARED_CHILD, []],
  [SECOND_CHILD, []]
]);

type FrozenHistory = {
  readonly identity: AddressHistoryManifestIdentityV1;
  readonly manifest: AddressHistoryManifestV1;
  readonly pages: readonly UnifiedAddressHistoryPageArtifactV1[];
};

function frozenHistory(
  address: string,
  events: readonly IndexedTronUsdtTransfer[]
): FrozenHistory {
  const identity = {
    chain: "tron" as const,
    snapshotHash: manifest.snapshotHash,
    tokenContract: USDT,
    address,
    providerRequestVersion: "tronscan-related-trc20-v1"
  };
  const manifestKey = addressHistoryManifestKey(identity);
  const serializedEvents = events.map((item) => ({
    ...item,
    blockTimestamp: item.blockTimestamp.toISOString()
  }));
  const page: UnifiedAddressHistoryPageArtifactV1 = {
    version: "unified-address-history-page-v1",
    schemaVersion: 1,
    runId: manifest.runId,
    manifestKey,
    providerPageHash: fingerprintCanonicalArtifact({
      address,
      events: serializedEvents
    }),
    rawRowCount: events.length,
    events: serializedEvents
  };
  const pages = events.length === 0 ? [] : [page];
  return {
    identity,
    manifest: buildAddressHistoryManifest({
      ...identity,
      pageArtifactHashes: pages.map(fingerprintCanonicalArtifact),
      canonicalEventIds: events.map((item) =>
        canonicalTronUsdtEventKey(item)
      ),
      rawRowCount: events.length,
      duplicateCount: 0,
      exhaustion: {
        kind: "account_creation_reached",
        evidenceSha256: fingerprintCanonicalArtifact({
          version: "replay-exhaustion-v1",
          address
        })
      }
    }),
    pages
  };
}

const frozenHistories = new Map(
  [...historyEvents].map(([address, events]) => {
    const history = frozenHistory(address, events);
    return [history.manifest.key, history] as const;
  })
);
const frozenPages = new Map(
  [...frozenHistories.values()].flatMap((history) =>
    history.pages.map((page) =>
      [fingerprintCanonicalArtifact(page), page] as const
    )
  )
);

type InMemoryPlannerEntry = UnifiedOrderedReadyEntry & {
  plannerState: "planned" | "ready" | "committed";
  parentCanonicalSequence: number;
};

type ReplayResult = {
  canonicalSequence: readonly {
    sequence: number;
    taskId: string;
    kind: string;
    logicalKey: string;
  }[];
  discoveredChildOrdering: readonly {
    parentCanonicalSequence: number;
    logicalKey: string;
  }[];
  committedSequence: readonly number[];
  frontier: UnifiedTraversalArtifactV1["frontier"];
  artifactSha256: string;
  deltaHeadSha256: string | null;
};

async function replay(input: {
  seed: number;
  capacity: number;
  completionOrder: "canonical" | "shuffled";
}): Promise<ReplayResult> {
  const artifacts = new Map<string, unknown>();
  const entries: InMemoryPlannerEntry[] = [];
  const committedSequence: number[] = [];
  let checkpoint: unknown = {};
  let taskId = 0;
  let traversalAttempt = 0;
  let completedArtifactSha256: string | null = null;
  let completionWave = 0;

  const readyEntry = (
    task: UnifiedOrderedTaskDiscoveryInput,
    canonicalSequence: number
  ): InMemoryPlannerEntry => {
    const history = frozenHistories.get(task.logicalKey);
    if (!history) throw new Error("replay_frozen_history_missing");
    const artifactSha256 =
      fingerprintCanonicalArtifact(history.manifest);
    return {
      canonicalSequence,
      taskId: task.taskId,
      taskKind: task.kind,
      logicalKey: task.logicalKey,
      acceptedAttemptId: `attempt-${canonicalSequence}`,
      artifactSha256,
      artifactKind: "address_history_manifest",
      artifactSchemaVersion: "1",
      artifact: history.manifest,
      resultBytes: Buffer.byteLength(
        canonicalizeArtifactJson(history.manifest),
        "utf8"
      ),
      plannerState: "planned",
      parentCanonicalSequence: task.parentCanonicalSequence
    };
  };

  const handler = createUnifiedTraversalCoordinatorHandler({
    commitMaxEntries: 32,
    commitMaxBytes: 8_388_608,
    manifestMaxBytes: 1_048_576,
    loadContext: async () => ({
      runId: manifest.runId,
      manifest,
      directEvents
    }),
    loadLabels: async () => new Map(),
    loadDurableAddressHistoryKeys: async ({ manifestKeys }) =>
      new Set(manifestKeys.filter((key) =>
        entries.some((entry) => entry.logicalKey === key)
      )),
    createTaskId: () => `history-task-${++taskId}`,
    loadReadyAddressHistories: async ({ maxEntries, maxBytes }) => {
      const uncommitted = entries
        .filter((entry) => entry.plannerState !== "committed")
        .sort((left, right) =>
          left.canonicalSequence - right.canonicalSequence
        );
      return selectBoundedReadyPrefix(uncommitted, {
        maxEntries,
        maxBytes
      });
    },
    loadCommittedAddressHistories: async ({ manifestKeys }) =>
      entries.filter((entry) =>
        entry.plannerState === "committed" &&
        manifestKeys.includes(entry.logicalKey)
      ),
    loadAddressHistoryPage: async ({ sha256 }) => {
      const page = frozenPages.get(sha256);
      if (!page) throw new Error("replay_frozen_page_missing");
      return page;
    },
    loadCompactionArtifact: async ({ sha256 }) =>
      artifacts.get(sha256) as TraversalCompactionArtifactV2,
    loadDeltaArtifact: async ({ sha256 }) =>
      artifacts.get(sha256) as TraversalDeltaArtifactV1,
    persistArtifact: async (artifact) => {
      artifacts.set(artifact.sha256, artifact.artifact);
    }
  });

  const cycle = async (): Promise<boolean> => {
    const result = await handler({
      task: {
        id: "task-traversal",
        runId: manifest.runId,
        kind: "traversal",
        logicalKey: "main",
        priorityLane: "interactive",
        attempt: ++traversalAttempt,
        checkpoint,
        cancellationRequestedAt: null
      },
      leaseToken: `lease-${traversalAttempt}`,
      heartbeat: async () => undefined
    });
    if (result.kind === "completed") {
      completedArtifactSha256 = result.artifactSha256;
      return false;
    }
    if (result.kind !== "checkpoint") {
      throw new Error(`replay_unexpected_result:${result.kind}`);
    }
    checkpoint = result.checkpoint;
    const orderedCommit = result.orderedCommit;
    if (!orderedCommit) return false;
    for (const committed of orderedCommit.entries) {
      const entry = entries[committed.canonicalSequence];
      if (
        !entry ||
        entry.plannerState !== "ready" ||
        entry.taskId !== committed.taskId ||
        entry.acceptedAttemptId !== committed.acceptedAttemptId
      ) {
        throw new Error("replay_commit_prefix_mismatch");
      }
      entry.plannerState = "committed";
      committedSequence.push(entry.canonicalSequence);
    }
    const discovered = canonicalOrderedDiscoveries(
      orderedCommit.discoveredTasks
    );
    for (const task of discovered) {
      if (entries.some((entry) =>
        entry.taskKind === task.kind &&
        entry.logicalKey === task.logicalKey
      )) {
        continue;
      }
      entries.push(readyEntry(task, entries.length));
    }
    return orderedCommit.entries.length > 0 ||
      orderedCommit.discoveredTasks.length > 0;
  };

  const drainCommittedPrefix = async () => {
    while (await cycle()) {
      // The production coordinator owns apply/discovery; this loop only
      // models the next immediately actionable analysis cycle.
    }
  };

  await drainCommittedPrefix();
  while (completedArtifactSha256 === null) {
    const pending = entries.filter((entry) =>
      entry.plannerState === "planned"
    );
    if (pending.length === 0) {
      await drainCommittedPrefix();
      if (completedArtifactSha256 === null) {
        throw new Error("replay_stalled_without_pending_work");
      }
      break;
    }
    const ordered = input.completionOrder === "canonical"
      ? pending
      : shuffled(pending, input.seed + completionWave);
    for (const entry of ordered.slice(0, input.capacity)) {
      entry.plannerState = "ready";
    }
    completionWave += 1;
    await drainCommittedPrefix();
  }

  const completedArtifact = artifacts.get(
    completedArtifactSha256
  ) as UnifiedTraversalArtifactV1 | undefined;
  if (!completedArtifact) throw new Error("replay_completed_artifact_missing");
  const v2 = checkpoint as { deltaHeadSha256?: string | null };
  return {
    canonicalSequence: entries.map((entry) => ({
      sequence: entry.canonicalSequence,
      taskId: entry.taskId,
      kind: entry.taskKind,
      logicalKey: entry.logicalKey
    })),
    discoveredChildOrdering: entries
      .filter((entry) => entry.parentCanonicalSequence >= 0)
      .map((entry) => ({
        parentCanonicalSequence: entry.parentCanonicalSequence,
        logicalKey: entry.logicalKey
      })),
    committedSequence,
    frontier: completedArtifact.frontier,
    artifactSha256: completedArtifactSha256,
    deltaHeadSha256: v2.deltaHeadSha256 ?? null
  };
}

describe("Unified ordered planner replay", () => {
  it("matches the sequential barrier oracle for 600 deterministic shuffled completion schedules", async () => {
    const oracle = await replay({
      seed: 1,
      capacity: 1,
      completionOrder: "canonical"
    });
    expect(oracle.canonicalSequence).toHaveLength(5);
    expect(oracle.discoveredChildOrdering).toHaveLength(3);
    expect(oracle.frontier).toEqual([]);

    for (const capacity of CAPACITIES) {
      for (let seed = 1; seed <= 100; seed += 1) {
        let actual: ReplayResult;
        try {
          actual = await replay({
            seed,
            capacity,
            completionOrder: "shuffled"
          });
        } catch (error) {
          throw new Error(
            `seed=${seed} capacity=${capacity}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
        expect(
          actual,
          `seed=${seed} capacity=${capacity}`
        ).toEqual(oracle);
      }
    }
  });
});
