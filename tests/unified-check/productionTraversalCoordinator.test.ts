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
  buildFrozenLabelDataset,
  type FrozenLabelDatasetV1
} from "../../src/unifiedCheck/frozenLabels";
import { buildFrozenLabelRecord } from "../../src/unifiedCheck/labelCatalog";
import { initialUnifiedTraversalCheckpointV1 } from "../../src/unifiedCheck/productionTraversal";
import {
  buildProductionBoundaryCandidateV2,
  createUnifiedTraversalCoordinatorHandler
} from "../../src/unifiedCheck/productionTraversalCoordinator";

const SUBJECT = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const MID = "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9";
const MID_TWO = "TV6bBsrCXz2sDSBMZhvc7vHqDwjc65ALZX";
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

function frozenDataset(input: {
  catalogEntryId?: "cex:bybit" | "cex:htx-huobi";
  validFrom?: string | null;
  legacyRows?: FrozenLabelDatasetV1["legacyRows"];
} = {}) {
  const labels = input.catalogEntryId === undefined
    ? []
    : [buildFrozenLabelRecord({
        address: CEX,
        classifierHint: null,
        exactRegistryBinding: null,
        verifiedProviderBinding: {
          catalogEntryId: input.catalogEntryId,
          authority: "tronscan_verified_metadata",
          sourcePayloadSha256: "7".repeat(64),
          validFrom: input.validFrom ?? "2025-01-01T00:00:00.000Z",
          validTo: null
        }
      })];
  return buildFrozenLabelDataset({
    frozenAt: manifest.confirmedBlockTimestamp,
    snapshotHash: manifest.snapshotHash,
    labels,
    legacyRows: input.legacyRows ?? []
  });
}

function v2Manifest(dataset: ReturnType<typeof frozenDataset>): AnalysisManifestV1 {
  return {
    ...manifest,
    labelDatasetSha256: dataset.sha256,
    labelCatalogVersion: "unified-label-catalog-v1",
    boundaryPredicateVersion: "unified-boundary-predicates-v1",
    traversalPolicyVersion: "snapshot-closure-v2"
  };
}

function coordinatorHarness(input: {
  manifest: AnalysisManifestV1;
  directEvents: readonly IndexedTronUsdtTransfer[];
  dataset: ReturnType<typeof frozenDataset>;
  commitMaxEntries?: number;
  commitMaxBytes?: number;
  manifestMaxBytes?: number;
  legacyLabels?: ReadonlyMap<string, readonly string[]>;
}) {
  const artifacts = new Map<string, unknown>();
  let taskId = 0;
  const loadLabels = vi.fn(async () => input.legacyLabels ?? new Map());
  const loadFrozenLabelDataset = vi.fn(async () => input.dataset.dataset);
  const handler = createUnifiedTraversalCoordinatorHandler({
    commitMaxEntries: input.commitMaxEntries ?? 32,
    commitMaxBytes: input.commitMaxBytes ?? 8_388_608,
    manifestMaxBytes: input.manifestMaxBytes ?? 1_048_576,
    loadContext: async () => ({
      runId: "run-1",
      manifest: input.manifest,
      directEvents: input.directEvents
    }),
    loadLabels,
    loadFrozenLabelDataset,
    loadDurableAddressHistoryKeys: async () => new Set(),
    createTaskId: () => `v2-history-${++taskId}`,
    loadReadyAddressHistories: async () => [],
    loadCommittedAddressHistories: async () => [],
    loadAddressHistoryPage: async () => {
      throw new Error("history not ready");
    },
    loadCompactionArtifact: async ({ sha256 }) =>
      artifacts.get(sha256) as never,
    loadDeltaArtifact: async ({ sha256 }) =>
      artifacts.get(sha256) as never,
    persistArtifact: async (artifact) => {
      artifacts.set(artifact.sha256, artifact.artifact);
    }
  });
  let attempt = 0;
  return {
    artifacts,
    loadLabels,
    loadFrozenLabelDataset,
    run: (checkpoint: unknown = {}) => handler({
      task: {
        id: "task-traversal-v2",
        runId: "run-1",
        kind: "traversal",
        logicalKey: "main",
        priorityLane: "interactive",
        attempt: ++attempt,
        checkpoint,
        cancellationRequestedAt: null
      },
      leaseToken: `lease-v2-${attempt}`,
      heartbeat: vi.fn(async () => undefined)
    })
  };
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

function twoReadyHistories(input: {
  binding: "correct" | "swapped";
  taskKind?: string;
  mutateFirstKey?: string;
  commitMaxBytes?: number;
  manifestMaxBytes?: number;
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
    commitMaxBytes: input.commitMaxBytes ?? 8_388_608,
    manifestMaxBytes: input.manifestMaxBytes ?? 1_048_576,
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
  it("rejects an unknown persisted traversal policy before mutation", async () => {
    const scenario = coordinatorHarness({
      manifest: {
        ...manifest,
        traversalPolicyVersion: "snapshot-closure-v3"
      } as never,
      directEvents: [],
      dataset: frozenDataset()
    });

    await expect(scenario.run()).rejects.toThrow(
      "unified_traversal_policy_version_invalid"
    );
    expect(scenario.artifacts.size).toBe(0);
    expect(scenario.loadLabels).not.toHaveBeenCalled();
    expect(scenario.loadFrozenLabelDataset).not.toHaveBeenCalled();
  });

  it("rejects a commit ceiling below the manifest ceiling before v1 ready work", () => {
    expect(() => twoReadyHistories({
      binding: "correct",
      commitMaxBytes: 1_024,
      manifestMaxBytes: 2_048
    })).toThrow("unified_traversal_commit_bytes_too_small");
  });

  it("commits only the state-valid v2 boundary before discovering one reusable address history", async () => {
    const dataset = frozenDataset({
      catalogEntryId: "cex:htx-huobi",
      validFrom: "2026-07-23T12:05:00.000Z"
    });
    const directEvents = [
      event({
        hash: "1".repeat(64),
        from: CEX,
        to: SUBJECT,
        amountRaw: "10",
        timestamp: "2026-07-23T12:10:00.000Z"
      }),
      event({
        hash: "2".repeat(64),
        from: CEX,
        to: SUBJECT,
        amountRaw: "20",
        timestamp: "2026-07-23T12:00:00.000Z"
      })
    ];
    const scenario = coordinatorHarness({
      manifest: v2Manifest(dataset),
      directEvents,
      dataset
    });

    const boundary = await scenario.run();
    expect(boundary.kind).toBe("checkpoint");
    if (boundary.kind !== "checkpoint") return;
    expect(boundary.orderedCommit).toBeUndefined();
    const evidence = [...scenario.artifacts.values()].filter((artifact) =>
      (artifact as { version?: string }).version ===
        "unified-traversal-boundary-evidence-v2"
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      state: { address: CEX, anchorTimestamp: "2026-07-23T12:10:00.000Z" }
    });

    const planning = await scenario.run(boundary.checkpoint);
    expect(planning.kind).toBe("checkpoint");
    if (planning.kind !== "checkpoint") return;
    expect(planning.orderedCommit?.entries).toEqual([]);
    expect(planning.orderedCommit?.discoveredTasks).toHaveLength(1);
    expect(planning.orderedCommit?.discoveredTasks[0]?.checkpoint)
      .toMatchObject({ identity: { address: CEX } });
  });

  it("checkpoints an all-terminal v2 frontier without planner work", async () => {
    const dataset = frozenDataset({ catalogEntryId: "cex:bybit" });
    const scenario = coordinatorHarness({
      manifest: v2Manifest(dataset),
      directEvents: [
        event({
          hash: "3".repeat(64),
          from: CEX,
          to: SUBJECT,
          amountRaw: "10",
          timestamp: "2026-07-23T12:10:00.000Z"
        }),
        event({
          hash: "4".repeat(64),
          from: CEX,
          to: SUBJECT,
          amountRaw: "20",
          timestamp: "2026-07-23T12:00:00.000Z"
        })
      ],
      dataset
    });

    const result = await scenario.run();
    expect(result.kind).toBe("checkpoint");
    if (result.kind !== "checkpoint") return;
    expect(result.orderedCommit).toBeUndefined();
    expect((result.checkpoint as { operational?: { frontierCount: number } })
      .operational?.frontierCount).toBe(0);
    expect([...scenario.artifacts.values()].filter((artifact) =>
      (artifact as { version?: string }).version ===
        "unified-traversal-boundary-evidence-v2"
    )).toHaveLength(2);
  });

  it("keeps v1 legacy boundary behavior unchanged", async () => {
    const dataset = frozenDataset();
    const scenario = coordinatorHarness({
      manifest,
      directEvents: [event({
        hash: "5".repeat(64),
        from: CEX,
        to: SUBJECT,
        amountRaw: "10",
        timestamp: "2026-07-23T12:00:00.000Z"
      })],
      dataset,
      legacyLabels: new Map([[CEX, ["cex", "Bybit"]]])
    });

    const result = await scenario.run();
    expect(result.kind).toBe("completed");
    expect([...scenario.artifacts.values()].some((artifact) =>
      (artifact as { version?: string }).version ===
        "unified-traversal-terminal-evidence-v1"
    )).toBe(true);
    expect(scenario.loadFrozenLabelDataset).not.toHaveBeenCalled();
  });

  it("does not let legacy risk context authorize a v2 boundary", async () => {
    const dataset = frozenDataset({
      legacyRows: [{
        address: CEX,
        label: "Bybit",
        category: "cex",
        provider: "legacy-risk-context",
        observedAt: "2026-07-23T12:00:00.000Z"
      }]
    });
    const scenario = coordinatorHarness({
      manifest: v2Manifest(dataset),
      directEvents: [event({
        hash: "6".repeat(64),
        from: CEX,
        to: SUBJECT,
        amountRaw: "10",
        timestamp: "2026-07-23T12:00:00.000Z"
      })],
      dataset,
      legacyLabels: new Map([[CEX, ["cex", "Bybit"]]])
    });

    const result = await scenario.run();
    expect(result.kind).toBe("checkpoint");
    if (result.kind !== "checkpoint") return;
    expect(result.orderedCommit?.discoveredTasks).toHaveLength(1);
    expect([...scenario.artifacts.values()].some((artifact) =>
      (artifact as { version?: string }).version ===
        "unified-traversal-boundary-evidence-v2"
    )).toBe(false);
  });

  it.each([
    ["missing", null, "unified_v2_boundary_versions_missing"],
    ["mismatched", "wrong-catalog", "unified_v2_boundary_versions_mismatch"]
  ])("fails for %s manifest boundary versions before loading labels", async (
    _name,
    catalogVersion,
    code
  ) => {
    const dataset = frozenDataset({ catalogEntryId: "cex:bybit" });
    const current = v2Manifest(dataset) as unknown as Record<string, unknown>;
    const changed = catalogVersion === null
      ? Object.fromEntries(Object.entries(current).filter(([key]) =>
          key !== "labelCatalogVersion"
        ))
      : { ...current, labelCatalogVersion: catalogVersion };
    const scenario = coordinatorHarness({
      manifest: changed as unknown as AnalysisManifestV1,
      directEvents: [event({
        hash: "7".repeat(64),
        from: CEX,
        to: SUBJECT,
        amountRaw: "10",
        timestamp: "2026-07-23T12:00:00.000Z"
      })],
      dataset
    });

    await expect(scenario.run()).rejects.toThrow(code);
    expect(scenario.loadFrozenLabelDataset).not.toHaveBeenCalled();
    expect(scenario.loadLabels).not.toHaveBeenCalled();
  });

  it("commits a byte-bounded canonical terminal prefix once across restart", async () => {
    const dataset = frozenDataset({ catalogEntryId: "cex:bybit" });
    const currentManifest = v2Manifest(dataset);
    const directEvents = [
      event({
        hash: "8".repeat(64),
        from: CEX,
        to: SUBJECT,
        amountRaw: "10",
        timestamp: "2026-07-23T12:10:00.000Z"
      }),
      event({
        hash: "9".repeat(64),
        from: CEX,
        to: SUBJECT,
        amountRaw: "20",
        timestamp: "2026-07-23T12:00:00.000Z"
      })
    ];
    const probe = coordinatorHarness({
      manifest: currentManifest,
      directEvents,
      dataset
    });
    await probe.run();
    const probeArtifacts = [...probe.artifacts.values()].filter((artifact) =>
      [
        "unified-traversal-boundary-evidence-v2",
        "unified-traversal-delta-v1"
      ].includes(String((artifact as { version?: string }).version))
    );
    const exactTwoCandidateBytes = probeArtifacts.reduce<number>(
      (sum, artifact) => sum + Buffer.byteLength(
        canonicalizeArtifactJson(artifact),
        "utf8"
      ),
      0
    );
    const evidenceBytes = Math.max(...probeArtifacts
      .filter((artifact) =>
        (artifact as { version?: string }).version ===
          "unified-traversal-boundary-evidence-v2"
      )
      .map((artifact) => Buffer.byteLength(
        canonicalizeArtifactJson(artifact),
        "utf8"
      )));
    const commitMaxBytes = exactTwoCandidateBytes - 1;
    const scenario = coordinatorHarness({
      manifest: currentManifest,
      directEvents,
      dataset,
      commitMaxBytes,
      manifestMaxBytes: evidenceBytes
    });

    const first = await scenario.run();
    expect(first.kind).toBe("checkpoint");
    if (first.kind !== "checkpoint") return;
    expect([...scenario.artifacts.values()].filter((artifact) =>
      (artifact as { version?: string }).version ===
        "unified-traversal-boundary-evidence-v2"
    )).toHaveLength(1);
    const firstCommitBytes = [...scenario.artifacts.values()]
      .filter((artifact) => [
        "unified-traversal-boundary-evidence-v2",
        "unified-traversal-delta-v1"
      ].includes(String((artifact as { version?: string }).version)))
      .reduce<number>((sum, artifact) => sum + Buffer.byteLength(
        canonicalizeArtifactJson(artifact),
        "utf8"
      ), 0);
    expect(firstCommitBytes).toBeLessThanOrEqual(commitMaxBytes);
    const second = await scenario.run(first.checkpoint);
    expect(second.kind).toBe("checkpoint");
    expect([...scenario.artifacts.values()].filter((artifact) =>
      (artifact as { version?: string }).version ===
        "unified-traversal-boundary-evidence-v2"
    )).toHaveLength(2);
    expect(new Set([...scenario.artifacts.values()].filter((artifact) =>
      (artifact as { version?: string }).version ===
        "unified-traversal-boundary-evidence-v2"
    ).map((artifact) => fingerprintCanonicalArtifact(artifact))).size).toBe(2);
  });

  it("rejects boundary candidates over the manifest byte ceiling", async () => {
    const dataset = frozenDataset({ catalogEntryId: "cex:bybit" });
    const currentManifest = v2Manifest(dataset);
    const directEvents = [event({
      hash: "a".repeat(64),
      from: CEX,
      to: SUBJECT,
      amountRaw: "10",
      timestamp: "2026-07-23T12:00:00.000Z"
    })];
    const state = initialUnifiedTraversalCheckpointV1({
      runId: "run-1",
      manifest: currentManifest,
      directEvents
    }).frontier[0]!;
    const candidate = buildProductionBoundaryCandidateV2({
      state,
      labels: dataset.dataset.labels,
      snapshotHash: currentManifest.snapshotHash,
      labelDatasetSha256: currentManifest.labelDatasetSha256
    });
    const evidenceBytes = Buffer.byteLength(
      canonicalizeArtifactJson(candidate.evidence),
      "utf8"
    );
    const overManifest = coordinatorHarness({
      manifest: currentManifest,
      directEvents,
      dataset,
      manifestMaxBytes: evidenceBytes - 1,
      commitMaxBytes: evidenceBytes
    });
    await expect(overManifest.run()).rejects.toThrow(
      "unified_v2_boundary_manifest_bytes_exceeded"
    );
  });

  it("rejects when the first exact evidence plus delta pair cannot fit", async () => {
    const dataset = frozenDataset({ catalogEntryId: "cex:bybit" });
    const currentManifest = v2Manifest(dataset);
    const directEvents = [event({
      hash: "b".repeat(64),
      from: CEX,
      to: SUBJECT,
      amountRaw: "10",
      timestamp: "2026-07-23T12:00:00.000Z"
    })];
    const probe = coordinatorHarness({
      manifest: currentManifest,
      directEvents,
      dataset
    });
    await probe.run();
    const artifacts = [...probe.artifacts.values()].filter((artifact) => [
      "unified-traversal-boundary-evidence-v2",
      "unified-traversal-delta-v1"
    ].includes(String((artifact as { version?: string }).version)));
    const exactBytes = artifacts.reduce<number>(
      (sum, artifact) => sum + Buffer.byteLength(
        canonicalizeArtifactJson(artifact),
        "utf8"
      ),
      0
    );
    const evidenceBytes = Buffer.byteLength(
      canonicalizeArtifactJson(artifacts.find((artifact) =>
        (artifact as { version?: string }).version ===
          "unified-traversal-boundary-evidence-v2"
      )),
      "utf8"
    );
    const constrained = coordinatorHarness({
      manifest: currentManifest,
      directEvents,
      dataset,
      manifestMaxBytes: evidenceBytes,
      commitMaxBytes: exactBytes - 1
    });

    await expect(constrained.run()).rejects.toThrow(
      "unified_v2_boundary_commit_bytes_exceeded"
    );
    expect([...constrained.artifacts.values()].filter((artifact) => [
      "unified-traversal-boundary-evidence-v2",
      "unified-traversal-delta-v1"
    ].includes(String((artifact as { version?: string }).version)))).toEqual([]);
  });

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

  it("partitions a generated v2 custodial frontier before discovery", async () => {
    const dataset = frozenDataset({ catalogEntryId: "cex:bybit" });
    const currentManifest = v2Manifest(dataset);
    const direct = event({
      hash: "a".repeat(64),
      from: MID,
      to: SUBJECT,
      amountRaw: "100",
      timestamp: "2026-07-23T12:00:00.000Z"
    });
    const upstream = event({
      hash: "b".repeat(64),
      from: CEX,
      to: MID,
      amountRaw: "100",
      timestamp: "2026-07-23T11:00:00.000Z"
    });
    const identity = {
      chain: "tron" as const,
      snapshotHash: currentManifest.snapshotHash,
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
    let plannedHistory = false;
    let ready = false;
    const handler = createUnifiedTraversalCoordinatorHandler({
      commitMaxEntries: 32,
      commitMaxBytes: 8_388_608,
      manifestMaxBytes: 1_048_576,
      loadContext: async () => ({
        runId: "run-1",
        manifest: currentManifest,
        directEvents: [direct]
      }),
      loadLabels: async () => new Map(),
      loadFrozenLabelDataset: async () => dataset.dataset,
      loadDurableAddressHistoryKeys: async ({ manifestKeys }) =>
        new Set(plannedHistory
          ? manifestKeys.filter((manifestKey) => manifestKey === key)
          : []),
      createTaskId: () => "unexpected-cex-history",
      loadReadyAddressHistories: async () => ready
        ? [{
            canonicalSequence: 0,
            taskId: "task-mid-history",
            taskKind: "address_history",
            logicalKey: key,
            acceptedAttemptId: "attempt-mid-history",
            artifactSha256: fingerprintCanonicalArtifact(history),
            artifactKind: "address_history_manifest",
            artifactSchemaVersion: "1",
            artifact: history,
            resultBytes: Buffer.byteLength(
              canonicalizeArtifactJson(history),
              "utf8"
            )
          }]
        : [],
      loadCommittedAddressHistories: async () => [],
      loadAddressHistoryPage: async () => page,
      loadCompactionArtifact: async ({ sha256 }) =>
        artifacts.get(sha256) as never,
      loadDeltaArtifact: async ({ sha256 }) =>
        artifacts.get(sha256) as never,
      persistArtifact: async (artifact) => {
        artifacts.set(artifact.sha256, artifact.artifact);
      }
    });
    const task = (attempt: number, checkpoint: unknown) => ({
      task: {
        id: "task-traversal",
        runId: "run-1",
        kind: "traversal",
        logicalKey: "main",
        priorityLane: "interactive" as const,
        attempt,
        checkpoint,
        cancellationRequestedAt: null
      },
      leaseToken: `lease-${attempt}`,
      heartbeat: vi.fn(async () => undefined)
    });
    const planned = await handler(task(1, {}));
    expect(planned.kind).toBe("checkpoint");
    if (planned.kind !== "checkpoint") return;
    expect(planned.orderedCommit?.discoveredTasks).toHaveLength(1);
    plannedHistory = true;
    ready = true;

    const applied = await handler(task(2, planned.checkpoint));

    expect(applied.kind).toBe("checkpoint");
    if (applied.kind !== "checkpoint") return;
    expect(applied.orderedCommit?.entries).toHaveLength(1);
    expect(applied.orderedCommit?.discoveredTasks).toEqual([]);
    expect([...artifacts.values()].filter((artifact) =>
      (artifact as { version?: string }).version ===
        "unified-traversal-boundary-evidence-v2"
    )).toHaveLength(1);
    ready = false;
    const completed = await handler(task(3, applied.checkpoint));
    expect(completed.kind).toBe("completed");
    expect([...artifacts.values()].filter((artifact) =>
      (artifact as { version?: string }).version ===
        "unified-traversal-boundary-evidence-v2"
    )).toHaveLength(1);
  });

  it("shares one generated-boundary entry and byte budget across ready histories", async () => {
    const dataset = frozenDataset({ catalogEntryId: "cex:bybit" });
    const currentManifest = v2Manifest(dataset);
    const mids = [MID, MID_TWO] as const;
    const directEvents = mids.flatMap((mid, midIndex) => [0, 1].map((episode) =>
      event({
        hash: String(midIndex * 2 + episode + 1).repeat(64),
        from: mid,
        to: SUBJECT,
        amountRaw: "50",
        timestamp: `2026-07-23T12:${midIndex}${episode}:00.000Z`
      })
    ));
    const histories = mids.map((mid, midIndex) => {
      const identity = {
        chain: "tron" as const,
        snapshotHash: currentManifest.snapshotHash,
        tokenContract: USDT,
        address: mid,
        providerRequestVersion: "tronscan-related-trc20-v1"
      };
      const key = addressHistoryManifestKey(identity);
      const upstream = [0, 1].map((episode) => event({
        hash: String(midIndex * 2 + episode + 5).repeat(64),
        from: CEX,
        to: mid,
        amountRaw: "50",
        timestamp: `2026-07-23T11:${midIndex}${episode}:00.000Z`
      }));
      const page = {
        version: "unified-address-history-page-v1",
        schemaVersion: 1,
        runId: "run-1",
        manifestKey: key,
        providerPageHash: String(midIndex + 7).repeat(64),
        rawRowCount: upstream.length,
        events: upstream.map((item) => ({
          ...item,
          blockTimestamp: item.blockTimestamp.toISOString()
        }))
      } as const;
      const pageSha256 = fingerprintCanonicalArtifact(page);
      const history = buildAddressHistoryManifest({
        ...identity,
        pageArtifactHashes: [pageSha256],
        canonicalEventIds: upstream.map((item) =>
          canonicalTronUsdtEventKey(item)
        ).sort(),
        rawRowCount: upstream.length,
        duplicateCount: 0,
        exhaustion: {
          kind: "account_creation_reached",
          evidenceSha256: ["9", "a"][midIndex]!.repeat(64)
        }
      });
      return { key, page, pageSha256, history };
    }).sort((left, right) => left.key.localeCompare(right.key));
    const artifacts = new Map<string, unknown>(histories.map((item) =>
      [item.pageSha256, item.page]
    ));
    for (const item of histories) {
      expect(fingerprintCanonicalArtifact(item.page.events.map((event) =>
        canonicalTronUsdtEventKey(event)
      ).sort())).toBe(item.history.eventInventorySha256);
    }
    const persisted: Array<{ kind: string; artifact: unknown }> = [];
    let planned = false;
    let ready = false;
    const commitMaxEntries = 2;
    const commitMaxBytes = 5_500;
    const handler = createUnifiedTraversalCoordinatorHandler({
      commitMaxEntries,
      commitMaxBytes,
      manifestMaxBytes: 2_000,
      loadContext: async () => ({
        runId: "run-1",
        manifest: currentManifest,
        directEvents
      }),
      loadLabels: async () => new Map(),
      loadFrozenLabelDataset: async () => dataset.dataset,
      loadDurableAddressHistoryKeys: async ({ manifestKeys }) =>
        new Set(planned ? manifestKeys : []),
      createTaskId: () => "unexpected-generated-history",
      loadReadyAddressHistories: async () => ready
        ? histories.map((item, canonicalSequence) => ({
            canonicalSequence,
            taskId: `task-history-${canonicalSequence}`,
            taskKind: "address_history",
            logicalKey: item.key,
            acceptedAttemptId: `attempt-history-${canonicalSequence}`,
            artifactSha256: fingerprintCanonicalArtifact(item.history),
            artifactKind: "address_history_manifest",
            artifactSchemaVersion: "1",
            artifact: item.history,
            resultBytes: Buffer.byteLength(
              canonicalizeArtifactJson(item.history),
              "utf8"
            )
          }))
        : [],
      loadCommittedAddressHistories: async () => [],
      loadAddressHistoryPage: async ({ sha256 }) =>
        artifacts.get(sha256) as never,
      loadCompactionArtifact: async ({ sha256 }) =>
        artifacts.get(sha256) as never,
      loadDeltaArtifact: async ({ sha256 }) =>
        artifacts.get(sha256) as never,
      persistArtifact: async (item) => {
        artifacts.set(item.sha256, item.artifact);
        persisted.push({ kind: item.kind, artifact: item.artifact });
      }
    });
    const task = (attempt: number, checkpoint: unknown) => ({
      task: {
        id: "task-traversal",
        runId: "run-1",
        kind: "traversal",
        logicalKey: "main",
        priorityLane: "interactive" as const,
        attempt,
        checkpoint,
        cancellationRequestedAt: null
      },
      leaseToken: `lease-budget-${attempt}`,
      heartbeat: vi.fn(async () => undefined)
    });
    const plannedResult = await handler(task(1, {}));
    expect(plannedResult.kind).toBe("checkpoint");
    if (plannedResult.kind !== "checkpoint") return;
    expect(plannedResult.orderedCommit?.discoveredTasks).toHaveLength(2);
    planned = true;
    ready = true;
    persisted.length = 0;

    const applied = await handler(task(2, plannedResult.checkpoint));

    expect(applied.kind).toBe("checkpoint");
    if (applied.kind !== "checkpoint") return;
    const boundaryArtifacts = persisted.filter((item) =>
      item.kind === "traversal_terminal_evidence" ||
      (
        item.kind === "traversal_delta" &&
        Array.isArray((item.artifact as { addedTerminals?: unknown }).addedTerminals) &&
        (item.artifact as { addedTerminals: unknown[] }).addedTerminals.length > 0
      )
    );
    const evidence = boundaryArtifacts.filter((item) =>
      item.kind === "traversal_terminal_evidence"
    );
    const exactBytes = boundaryArtifacts.reduce((sum, item) =>
      sum + Buffer.byteLength(canonicalizeArtifactJson(item.artifact), "utf8"),
    0);
    expect(exactBytes).toBeLessThanOrEqual(commitMaxBytes);
    expect(evidence.length).toBeLessThanOrEqual(commitMaxEntries);
    expect(applied.orderedCommit?.entries).toHaveLength(1);
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
