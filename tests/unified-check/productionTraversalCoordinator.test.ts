import { describe, expect, it, vi } from "vitest";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import { canonicalTronUsdtEventKey } from "../../src/forensics/tronAddressAllTimeIndex";
import type { IndexedTronUsdtTransfer } from "../../src/types";
import {
  addressHistoryManifestKey,
  buildAddressHistoryManifest
} from "../../src/unifiedCheck/addressHistory";
import type { AnalysisManifestV1 } from "../../src/unifiedCheck/contracts";
import {
  createUnifiedTraversalCoordinatorHandler
} from "../../src/unifiedCheck/productionTraversalCoordinator";

const SUBJECT = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const MID = "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9";
const CEX = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const manifest: AnalysisManifestV1 = {
  version: "analysis-manifest-v1",
  schemaVersion: 1,
  runId: "run-1",
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
  databaseSchemaVersion: 33,
  paginationCutoffBlockNumber: "100",
  paginationCutoffBlockHash: "c".repeat(64),
  branchArtifactHashes: {
    fast: "e".repeat(64),
    where: "f".repeat(64),
    deep: "1".repeat(64)
  }
};

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

function twoReadyHistories(input: {
  binding: "correct" | "swapped";
  taskKind?: string;
  mutateFirstKey?: string;
}) {
  const directEvents = [
    event({
      hash: "d".repeat(64),
      from: MID,
      to: SUBJECT,
      amountRaw: "10",
      timestamp: "2026-07-23T12:10:00.000Z"
    }),
    event({
      hash: "e".repeat(64),
      from: CEX,
      to: SUBJECT,
      amountRaw: "20",
      timestamp: "2026-07-23T12:00:00.000Z"
    })
  ];
  const histories = [MID, CEX].map((address) => {
    const identity = {
      chain: "tron" as const,
      snapshotHash: manifest.snapshotHash,
      tokenContract: USDT,
      address,
      providerRequestVersion: "tronscan-related-trc20-v1"
    };
    return {
      identity,
      artifact: buildAddressHistoryManifest({
        ...identity,
        pageArtifactHashes: [],
        canonicalEventIds: [],
        rawRowCount: 0,
        duplicateCount: 0,
        exhaustion: {
          kind: "account_creation_reached",
          evidenceSha256: "f".repeat(64)
        }
      })
    };
  }).sort((left, right) =>
    left.artifact.key.localeCompare(right.artifact.key)
  );
  const artifacts = new Map<string, unknown>();
  const heartbeat = vi.fn(async () => undefined);
  const entries = histories.map((history, canonicalSequence) => {
    const sourceIndex = input.binding === "swapped"
      ? 1 - canonicalSequence
      : canonicalSequence;
    const source = histories[sourceIndex]!.artifact;
    const artifact = canonicalSequence === 0 && input.mutateFirstKey
      ? { ...source, key: input.mutateFirstKey }
      : source;
    return {
      canonicalSequence,
      taskId: `history-task-${canonicalSequence}`,
      taskKind: input.taskKind ?? "address_history",
      logicalKey: history.artifact.key,
      acceptedAttemptId: `history-attempt-${canonicalSequence}`,
      artifactSha256: fingerprintCanonicalArtifact(artifact),
      artifactKind: "address_history_manifest",
      artifactSchemaVersion: "1",
      artifact,
      resultBytes: Buffer.byteLength(
        canonicalizeArtifactJson(artifact),
        "utf8"
      )
    };
  });
  const handler = createUnifiedTraversalCoordinatorHandler({
    commitMaxEntries: 2,
    commitMaxBytes: 8_388_608,
    manifestMaxBytes: 1_048_576,
    loadContext: async () => ({ runId: "run-1", manifest, directEvents }),
    loadLabels: async () => new Map(),
    loadDurableAddressHistoryKeys: async ({ manifestKeys }) =>
      new Set(manifestKeys),
    createTaskId: () => "unused-history-task",
    loadReadyAddressHistories: async () => entries,
    loadCommittedAddressHistories: async () => [],
    loadAddressHistoryPage: async () => {
      throw new Error("empty manifest has no pages");
    },
    loadCompactionArtifact: async ({ sha256 }) =>
      artifacts.get(sha256) as never,
    loadDeltaArtifact: async ({ sha256 }) =>
      artifacts.get(sha256) as never,
    persistArtifact: async (artifact) => {
      artifacts.set(artifact.sha256, artifact.artifact);
    }
  });
  return {
    artifacts,
    entries,
    heartbeat,
    histories,
    run: () => handler({
      task: {
        id: "task-traversal",
        runId: "run-1",
        kind: "traversal",
        logicalKey: "main",
        priorityLane: "interactive",
        attempt: 1,
        checkpoint: {},
        cancellationRequestedAt: null
      },
      leaseToken: "lease-1",
      heartbeat
    })
  };
}

describe("Unified address-centric traversal coordinator", () => {
  it("rejects swapped valid manifests before either mandatory state mutates", async () => {
    const scenario = twoReadyHistories({ binding: "swapped" });

    await expect(scenario.run()).rejects.toThrow(
      "unified_traversal_address_manifest_mismatch"
    );
    expect(scenario.heartbeat).not.toHaveBeenCalled();
    expect([...scenario.artifacts.values()].filter((artifact) =>
      (artifact as { version?: string }).version ===
        "unified-traversal-delta-v1"
    )).toHaveLength(0);
  });

  it("applies correctly bound manifests in planner order", async () => {
    const scenario = twoReadyHistories({ binding: "correct" });

    const result = await scenario.run();
    expect(result.kind).toBe("checkpoint");
    if (result.kind !== "checkpoint") throw new Error("checkpoint expected");
    expect(result.orderedCommit?.entries.map((entry) => entry.logicalKey))
      .toEqual(scenario.histories.map((history) => history.artifact.key));
    expect(scenario.heartbeat).toHaveBeenCalledTimes(2);
  });

  it("rejects a manifest key that does not match its authoritative identity", async () => {
    const scenario = twoReadyHistories({
      binding: "correct",
      mutateFirstKey: "0".repeat(64)
    });

    await expect(scenario.run()).rejects.toThrow(
      "unified_traversal_address_manifest_mismatch"
    );
    expect(scenario.heartbeat).not.toHaveBeenCalled();
  });

  it("rejects a non-address-history planner task before traversal mutation", async () => {
    const scenario = twoReadyHistories({
      binding: "correct",
      taskKind: "other_kind"
    });

    await expect(scenario.run()).rejects.toThrow(
      "unified_traversal_address_manifest_mismatch"
    );
    expect(scenario.heartbeat).not.toHaveBeenCalled();
  });

  it("loads one address history for several funding episodes and persists V2 deltas", async () => {
    const directEvents = [
      event({
        hash: "2".repeat(64),
        from: MID,
        to: SUBJECT,
        amountRaw: "100",
        timestamp: "2026-07-23T12:00:00.000Z"
      }),
      event({
        hash: "3".repeat(64),
        from: MID,
        to: SUBJECT,
        amountRaw: "100",
        timestamp: "2026-07-23T12:05:00.000Z"
      })
    ];
    const upstream = event({
      hash: "4".repeat(64),
      from: CEX,
      to: MID,
      amountRaw: "200",
      timestamp: "2026-07-23T11:00:00.000Z"
    });
    const identity = {
      chain: "tron" as const,
      snapshotHash: manifest.snapshotHash,
      tokenContract: USDT,
      address: MID,
      providerRequestVersion: "tronscan-related-trc20-v1"
    };
    const key = addressHistoryManifestKey(identity);
    const page = {
      version: "unified-address-history-page-v1",
      schemaVersion: 1,
      runId: "run-1",
      manifestKey: key,
      providerPageHash: "5".repeat(64),
      rawRowCount: 1,
      events: [{
        ...upstream,
        blockTimestamp: upstream.blockTimestamp.toISOString()
      }]
    } as const;
    const pageSha256 = fingerprintCanonicalArtifact(page);
    const history = buildAddressHistoryManifest({
      ...identity,
      pageArtifactHashes: [pageSha256],
      canonicalEventIds: [canonicalTronUsdtEventKey(upstream)],
      rawRowCount: 1,
      duplicateCount: 0,
      exhaustion: {
        kind: "account_creation_reached",
        evidenceSha256: "6".repeat(64)
      }
    });
    const artifacts = new Map<string, unknown>([[pageSha256, page]]);
    let planned = false;
    let ready = false;
    const loadHistoryPage = vi.fn(async ({ sha256 }: { sha256: string }) =>
      artifacts.get(sha256) as never
    );
    const handler = createUnifiedTraversalCoordinatorHandler({
      commitMaxEntries: 1,
      commitMaxBytes: 8_388_608,
      manifestMaxBytes: 1_048_576,
      loadContext: async () => ({
        runId: "run-1",
        manifest,
        directEvents
      }),
      loadLabels: async ({ addresses }) => new Map(
        addresses.includes(CEX) ? [[CEX, ["cex", "Bybit"]]] : []
      ),
      loadDurableAddressHistoryKeys: async () =>
        planned ? new Set([key]) : new Set(),
      createTaskId: () => "task-address-history",
      loadReadyAddressHistories: async () => ready
        ? [{
            canonicalSequence: 0,
            taskId: "task-address-history",
            taskKind: "address_history",
            logicalKey: key,
            acceptedAttemptId: "attempt-address-history",
            artifactSha256: fingerprintCanonicalArtifact(history),
            artifactKind: "address_history_manifest",
            artifactSchemaVersion: "1",
            artifact: history,
            resultBytes:
              Buffer.byteLength(canonicalizeArtifactJson(history), "utf8")
          }]
        : [],
      loadCommittedAddressHistories: async () => [],
      loadAddressHistoryPage: loadHistoryPage,
      loadCompactionArtifact: async ({ sha256 }) =>
        artifacts.get(sha256) as never,
      loadDeltaArtifact: async ({ sha256 }) =>
        artifacts.get(sha256) as never,
      persistArtifact: async (input) => {
        artifacts.set(input.sha256, input.artifact);
      }
    });
    const baseTask = {
      id: "task-traversal",
      runId: "run-1",
      kind: "traversal",
      logicalKey: "main",
      priorityLane: "interactive" as const,
      cancellationRequestedAt: null
    };
    const first = await handler({
      task: { ...baseTask, attempt: 1, checkpoint: {} },
      leaseToken: "lease-1",
      heartbeat: vi.fn(async () => undefined)
    });
    expect(first.kind).toBe("checkpoint");
    if (first.kind !== "checkpoint") throw new Error("checkpoint expected");
    expect(JSON.stringify(first.checkpoint).length).toBeLessThan(4_096);
    expect(first.checkpoint).toMatchObject({
      version: "unified-production-traversal-checkpoint-v2"
    });
    expect(first.orderedCommit).toMatchObject({
      runId: "run-1",
      entries: [],
      discoveredTasks: [{
        parentCanonicalSequence: -1,
        taskId: "task-address-history",
        kind: "address_history",
        logicalKey: key,
        priorityLane: "interactive",
        checkpoint: { identity }
      }]
    });

    planned = true;
    ready = true;
    const second = await handler({
      task: { ...baseTask, attempt: 2, checkpoint: first.checkpoint },
      leaseToken: "lease-2",
      heartbeat: vi.fn(async () => undefined)
    });
    expect(second.kind).toBe("checkpoint");
    if (second.kind !== "checkpoint") throw new Error("checkpoint expected");
    expect(second.orderedCommit).toEqual({
      runId: "run-1",
      expectedDeltaHeadSha256: null,
      entries: [{
        canonicalSequence: 0,
        taskId: "task-address-history",
        logicalKey: key,
        acceptedAttemptId: "attempt-address-history",
        resultBytes: Buffer.byteLength(canonicalizeArtifactJson(history), "utf8"),
        taskKind: "address_history",
        artifactKind: "address_history_manifest",
        artifactSchemaVersion: "1"
      }],
      discoveredTasks: []
    });
    expect(JSON.stringify(second.checkpoint).length).toBeLessThan(4_096);
    ready = false;
    const finish = () => handler({
      task: { ...baseTask, attempt: 3, checkpoint: second.checkpoint },
      leaseToken: "lease-3",
      heartbeat: vi.fn(async () => undefined)
    });
    const third = await finish();
    const retry = await finish();
    expect(third.kind).toBe("completed");
    expect(retry.kind).toBe("completed");
    if (third.kind !== "completed" || retry.kind !== "completed") {
      throw new Error("completion expected");
    }
    expect(retry.artifactSha256).toBe(third.artifactSha256);
    expect(loadHistoryPage).toHaveBeenCalledTimes(1);
    const completed = artifacts.get(third.artifactSha256) as {
      closed: boolean;
      terminalRaw: string;
      residualRaw: string;
      terminalStates: Array<{ address: string; reason: string }>;
    };
    expect(completed).toMatchObject({
      closed: true,
      terminalRaw: "200",
      residualRaw: "0"
    });
    expect(completed.terminalStates).toHaveLength(2);
    expect(completed.terminalStates.every((item) =>
      item.address === CEX &&
      item.reason === "identified_service_boundary"
    )).toBe(true);
  });

  it("plans every distinct mandatory history in one stable canonical batch", async () => {
    const identities = [MID, CEX].map((address) => ({
      chain: "tron" as const,
      snapshotHash: manifest.snapshotHash,
      tokenContract: USDT,
      address,
      providerRequestVersion: "tronscan-related-trc20-v1"
    }));
    const byKey = identities.map((item) => ({
      manifestKey: addressHistoryManifestKey(item),
      identity: item
    })).sort((left, right) => left.manifestKey.localeCompare(right.manifestKey));
    const laterAddress = byKey[1]!.identity.address;
    const earlierAddress = byKey[0]!.identity.address;
    const artifacts = new Map<string, unknown>();
    let nextTask = 0;
    const handler = createUnifiedTraversalCoordinatorHandler({
      commitMaxEntries: 32,
      commitMaxBytes: 8_388_608,
      manifestMaxBytes: 1_048_576,
      loadContext: async () => ({
        runId: "run-1",
        manifest,
        directEvents: [
          event({
            hash: "7".repeat(64),
            from: laterAddress,
            to: SUBJECT,
            amountRaw: "10",
            timestamp: "2026-07-23T12:10:00.000Z"
          }),
          event({
            hash: "8".repeat(64),
            from: earlierAddress,
            to: SUBJECT,
            amountRaw: "20",
            timestamp: "2026-07-23T12:00:00.000Z"
          }),
          event({
            hash: "9".repeat(64),
            from: laterAddress,
            to: SUBJECT,
            amountRaw: "30",
            timestamp: "2026-07-23T11:50:00.000Z"
          })
        ]
      }),
      loadLabels: async () => new Map(),
      loadDurableAddressHistoryKeys: async () => new Set(),
      createTaskId: () => `history-task-${nextTask++}`,
      loadReadyAddressHistories: async () => [],
      loadCommittedAddressHistories: async () => [],
      loadAddressHistoryPage: async () => {
        throw new Error("not ready");
      },
      loadCompactionArtifact: async ({ sha256 }) =>
        artifacts.get(sha256) as never,
      loadDeltaArtifact: async ({ sha256 }) =>
        artifacts.get(sha256) as never,
      persistArtifact: async (input) => {
        artifacts.set(input.sha256, input.artifact);
      }
    });

    const result = await handler({
      task: {
        id: "task-traversal",
        runId: "run-1",
        kind: "traversal",
        logicalKey: "main",
        priorityLane: "interactive",
        attempt: 1,
        checkpoint: {},
        cancellationRequestedAt: null
      },
      leaseToken: "lease-1",
      heartbeat: vi.fn(async () => undefined)
    });

    expect(result.kind).toBe("checkpoint");
    if (result.kind !== "checkpoint") throw new Error("checkpoint expected");
    expect(result.orderedCommit?.discoveredTasks.map((task) => ({
      parentCanonicalSequence: task.parentCanonicalSequence,
      logicalKey: task.logicalKey
    }))).toEqual(byKey.map((history) => ({
      parentCanonicalSequence: -1,
      logicalKey: history.manifestKey
    })));
    expect([...artifacts.values()].filter((artifact) =>
      (artifact as { version?: string }).version ===
        "unified-traversal-delta-v1"
    )).toHaveLength(0);
  });

  it("produces the same canonical delta head for random completion arrival order", async () => {
    const run = async (arrival: "head-first" | "tail-first") => {
      const directEvents = [
        event({
          hash: "a".repeat(64),
          from: MID,
          to: SUBJECT,
          amountRaw: "10",
          timestamp: "2026-07-23T12:10:00.000Z"
        }),
        event({
          hash: "b".repeat(64),
          from: CEX,
          to: SUBJECT,
          amountRaw: "20",
          timestamp: "2026-07-23T12:00:00.000Z"
        })
      ];
      const histories = [MID, CEX].map((address) => {
        const identity = {
          chain: "tron" as const,
          snapshotHash: manifest.snapshotHash,
          tokenContract: USDT,
          address,
          providerRequestVersion: "tronscan-related-trc20-v1"
        };
        const artifact = buildAddressHistoryManifest({
          ...identity,
          pageArtifactHashes: [],
          canonicalEventIds: [],
          rawRowCount: 0,
          duplicateCount: 0,
          exhaustion: {
            kind: "account_creation_reached",
            evidenceSha256: "c".repeat(64)
          }
        });
        return {
          manifestKey: addressHistoryManifestKey(identity),
          identity,
          artifact
        };
      }).sort((left, right) =>
        left.manifestKey.localeCompare(right.manifestKey)
      );
      const artifacts = new Map<string, unknown>();
      const planned = new Set<string>();
      const ready = new Set<string>();
      const committed = new Set<string>();
      let taskId = 0;
      const handler = createUnifiedTraversalCoordinatorHandler({
        commitMaxEntries: 32,
        commitMaxBytes: 8_388_608,
        manifestMaxBytes: 1_048_576,
        loadContext: async () => ({ runId: "run-1", manifest, directEvents }),
        loadLabels: async () => new Map(),
        loadDurableAddressHistoryKeys: async ({ manifestKeys }) =>
          new Set(manifestKeys.filter((key) => planned.has(key))),
        createTaskId: () => `history-task-${taskId++}`,
        loadReadyAddressHistories: async () => {
          const head = histories.find((history) =>
            !committed.has(history.manifestKey)
          );
          if (!head || !ready.has(head.manifestKey)) return [];
          const prefix = [];
          for (const [canonicalSequence, history] of histories.entries()) {
            if (committed.has(history.manifestKey)) continue;
            if (!ready.has(history.manifestKey)) break;
            prefix.push({
              canonicalSequence,
              taskId: `task-${canonicalSequence}`,
              taskKind: "address_history",
              logicalKey: history.manifestKey,
              acceptedAttemptId: `attempt-${canonicalSequence}`,
              artifactSha256:
                fingerprintCanonicalArtifact(history.artifact),
              artifactKind: "address_history_manifest",
              artifactSchemaVersion: "1",
              artifact: history.artifact,
              resultBytes: Buffer.byteLength(
                canonicalizeArtifactJson(history.artifact),
                "utf8"
              )
            });
          }
          return prefix;
        },
        loadCommittedAddressHistories: async () => [],
        loadAddressHistoryPage: async () => {
          throw new Error("empty manifest has no pages");
        },
        loadCompactionArtifact: async ({ sha256 }) =>
          artifacts.get(sha256) as never,
        loadDeltaArtifact: async ({ sha256 }) =>
          artifacts.get(sha256) as never,
        persistArtifact: async (input) => {
          artifacts.set(input.sha256, input.artifact);
        }
      });
      let checkpoint: unknown = {};
      let attempt = 0;
      let finalDeltaHead: string | null = null;
      const cycle = async () => {
        const result = await handler({
          task: {
            id: "task-traversal",
            runId: "run-1",
            kind: "traversal",
            logicalKey: "main",
            priorityLane: "interactive",
            attempt: ++attempt,
            checkpoint,
            cancellationRequestedAt: null
          },
          leaseToken: `lease-${attempt}`,
          heartbeat: vi.fn(async () => undefined)
        });
        if (result.kind === "checkpoint") {
          checkpoint = result.checkpoint;
          if (result.orderedCommit) {
            finalDeltaHead = (
              result.checkpoint as { deltaHeadSha256: string | null }
            ).deltaHeadSha256;
            for (const discovered of result.orderedCommit.discoveredTasks) {
              planned.add(discovered.logicalKey);
            }
            for (const entry of result.orderedCommit.entries) {
              committed.add(histories[entry.canonicalSequence]!.manifestKey);
            }
          }
        }
        return result;
      };

      await cycle();
      const arrivalOrder = arrival === "head-first"
        ? histories
        : [...histories].reverse();
      for (const history of arrivalOrder) {
        ready.add(history.manifestKey);
        await cycle();
      }
      let completed = await cycle();
      while (completed.kind !== "completed") completed = await cycle();
      return {
        artifactSha256: completed.artifactSha256,
        finalDeltaHead
      };
    };

    const headFirst = await run("head-first");
    const tailFirst = await run("tail-first");
    expect(tailFirst).toEqual(headFirst);
  });
});
