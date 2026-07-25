import { randomUUID } from "node:crypto";
import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import type { IndexedTronUsdtTransfer } from "../types";
import type { AnalysisManifestV1 } from "./contracts";
import type {
  DirectHistoryPage,
  DirectHistoryProviderWait
} from "./directHistory";
import {
  createUnifiedAddressHistoryHandler,
  type UnifiedAddressHistoryChunkArtifactV1,
  type UnifiedAddressHistoryPageArtifactV1
} from "./productionAddressHistory";
import {
  createUnifiedProductionBranchHandlers
} from "./productionBranches";
import {
  createUnifiedDirectHistoryHandler,
  canonicalizeUnifiedDirectHistoryPages,
  type UnifiedDirectHistoryChunkArtifactV1,
  type UnifiedDirectHistoryArtifactV1,
  type UnifiedDirectHistoryPageArtifactV1
} from "./productionDirectHistory";
import {
  createUnifiedDirectEvidenceHandler,
  reviveUnifiedDirectHardEvidence,
  type UnifiedDirectHardEvidenceArtifactV1
} from "./productionDirectEvidence";
import type {
  UnifiedProductionHardEvidence
} from "./productionEvidence";
import {
  runUnifiedCompletedPresentationReconciliationCycle,
  runUnifiedProductionFinalizationCycle
} from "./productionFinalizer";
import {
  createPostgresUnifiedTaskCycleRepository
} from "./productionWorker";
import {
  loadUnifiedBoundedReadyPrefix,
  loadUnifiedCommittedArtifacts,
  loadUnifiedDurableOrderedTaskIdentities
} from "./plannerRepository";
import type { ProviderPageDiagnostic } from "./providerRequest";
import type { UnifiedRunPurpose } from "./contracts";
import {
  type UnifiedTraversalArtifactV1
} from "./productionTraversal";
import {
  createUnifiedTraversalCoordinatorHandler
} from "./productionTraversalCoordinator";
import type {
  TraversalCompactionArtifactV2,
  TraversalDeltaArtifactV1
} from "./traversalDelta";
import {
  cooperateUnifiedCanaryRun,
  DEFAULT_UNIFIED_ORDERED_MANIFEST_MAX_BYTES,
  insertUnifiedArtifact,
  recordUnifiedTaskProviderDuration,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "./repository";
import {
  runUnifiedTaskCycle,
  type UnifiedProviderChunkBudget
} from "./worker";

type LoadedRun = {
  readonly id: string;
  readonly subjectAddress: string;
  readonly analysisManifestSha256: string;
  readonly analysisManifest: AnalysisManifestV1;
};

function one(
  result: { rows: Array<Record<string, unknown>> },
  code: string
): Record<string, unknown> {
  const row = result.rows[0];
  if (!row) throw new Error(code);
  return row;
}

async function artifact<T>(
  db: UnifiedQueryable,
  runId: string,
  sha256: string,
  kind: string
): Promise<T> {
  const row = one(
    await db.query(
      `select artifact_json
         from unified_check_artifacts
        where sha256 = $1 and created_by_run_id = $2 and kind = $3`,
      [sha256, runId, kind]
    ),
    `unified_production_runtime_artifact_missing:${kind}`
  );
  if (fingerprintCanonicalArtifact(row.artifact_json) !== sha256) {
    throw new Error(`unified_production_runtime_artifact_mismatch:${kind}`);
  }
  return row.artifact_json as T;
}

async function loadRun(
  db: UnifiedQueryable,
  runId: string
): Promise<LoadedRun> {
  const row = one(
    await db.query(
      "select * from unified_check_runs where id = $1",
      [runId]
    ),
    "unified_production_runtime_run_missing"
  );
  const manifestHash = String(row.analysis_manifest_sha256);
  const manifest = await artifact<AnalysisManifestV1>(
    db,
    runId,
    manifestHash,
    "analysis_manifest"
  );
  return {
    id: runId,
    subjectAddress: String(row.subject_address),
    analysisManifestSha256: manifestHash,
    analysisManifest: manifest
  };
}

function reviveEvent(
  event: UnifiedDirectHistoryPageArtifactV1["events"][number]
): IndexedTronUsdtTransfer {
  const timestamp = new Date(event.blockTimestamp);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("unified_production_runtime_event_timestamp_invalid");
  }
  return { ...event, blockTimestamp: timestamp };
}

async function loadDirectHistory(
  db: UnifiedQueryable,
  run: LoadedRun
): Promise<{
  artifactSha256: string;
  events: IndexedTronUsdtTransfer[];
}> {
  const row = one(
    await db.query(
      `select attempt.artifact_sha256
         from unified_check_tasks task
         join unified_check_attempts attempt
           on attempt.id = task.accepted_attempt_id
        where task.run_id = $1 and task.kind = 'direct_history'
          and task.status = 'COMPLETED'`,
      [run.id]
    ),
    "unified_production_runtime_history_not_ready"
  );
  const artifactSha256 = String(row.artifact_sha256);
  const history = await artifact<UnifiedDirectHistoryArtifactV1>(
    db,
    run.id,
    artifactSha256,
    "direct_history"
  );
  if (
    history.analysisManifestHash !== run.analysisManifestSha256 ||
    history.snapshotHash !== run.analysisManifest.snapshotHash ||
    history.reachedAccountCreation !== true
  ) {
    throw new Error("unified_production_runtime_history_mismatch");
  }
  const pages: UnifiedDirectHistoryPageArtifactV1[] = [];
  for (const pageHash of history.pageArtifactHashes) {
    const page = await artifact<UnifiedDirectHistoryPageArtifactV1>(
      db,
      run.id,
      pageHash,
      "direct_history_page"
    );
    pages.push(page);
  }
  const canonical = canonicalizeUnifiedDirectHistoryPages(pages);
  if (
    canonical.eventCount !== history.eventCount ||
    canonical.eventIndexHash !== history.eventIndexHash
  ) {
    throw new Error("unified_production_runtime_history_index_mismatch");
  }
  const events = canonical.events.map(reviveEvent);
  return { artifactSha256, events };
}

async function loadTraversal(
  db: UnifiedQueryable,
  run: LoadedRun
): Promise<UnifiedTraversalArtifactV1> {
  const row = one(
    await db.query(
      `select attempt.artifact_sha256
         from unified_check_tasks task
         join unified_check_attempts attempt
           on attempt.id = task.accepted_attempt_id
        where task.run_id = $1 and task.kind = 'traversal'
          and task.status = 'COMPLETED'`,
      [run.id]
    ),
    "unified_production_runtime_traversal_not_ready"
  );
  const traversal = await artifact<UnifiedTraversalArtifactV1>(
    db,
    run.id,
    String(row.artifact_sha256),
    "traversal_result"
  );
  if (
    traversal.runId !== run.id ||
    traversal.analysisManifestHash !== run.analysisManifestSha256 ||
    traversal.snapshotHash !== run.analysisManifest.snapshotHash ||
    traversal.closed !== true ||
    traversal.frontier.length !== 0
  ) {
    throw new Error("unified_production_runtime_traversal_mismatch");
  }
  return traversal;
}

async function loadDirectHardEvidence(
  db: UnifiedQueryable,
  run: LoadedRun,
  directHistoryArtifactSha256: string
): Promise<UnifiedProductionHardEvidence | null> {
  const row = (
    await db.query(
      `select attempt.artifact_sha256
         from unified_check_tasks task
         join unified_check_attempts attempt
           on attempt.id = task.accepted_attempt_id
        where task.run_id = $1 and task.kind = 'deep_direct'
          and task.status = 'COMPLETED'`,
      [run.id]
    )
  ).rows[0];
  if (!row) return null;
  const evidence = await artifact<UnifiedDirectHardEvidenceArtifactV1>(
    db,
    run.id,
    String(row.artifact_sha256),
    "deep_direct_evidence"
  );
  if (
    evidence.runId !== run.id ||
    evidence.snapshotHash !== run.analysisManifest.snapshotHash ||
    evidence.directHistoryArtifactSha256 !== directHistoryArtifactSha256
  ) {
    throw new Error("unified_direct_hard_evidence_binding_mismatch");
  }
  return reviveUnifiedDirectHardEvidence(evidence);
}

export function createUnifiedProductionRuntime(input: {
  db: UnifiedTransactionalQueryable;
  runtimeCommit: string;
  providerConfigurationSha256: string;
  runPurpose?: UnifiedRunPurpose;
  now?: () => Date;
  createId?: () => string;
  leaseMs?: number;
  addressHistoryPagesPerChunk?: number;
  providerChunkBudget?: UnifiedProviderChunkBudget;
  manifestMaxBytes?: number;
  commitMaxEntries?: number;
  commitMaxBytes?: number;
  onProviderWorkAvailable?(): void;
  loadProviderPage(input: {
    run: LoadedRun;
    address?: string;
    cursor: string | null;
    onDiagnostic?: (diagnostic: ProviderPageDiagnostic) => void;
  }): Promise<DirectHistoryPage | DirectHistoryProviderWait>;
  loadCounterpartyLabels(input: {
    labelDatasetSha256: string;
    addresses: readonly string[];
  }): Promise<ReadonlyMap<string, readonly string[]>>;
  loadHardEvidence(input: {
    subjectAddress: string;
    snapshotBlockNumber: string;
    snapshotTimestamp: string;
    events: readonly IndexedTronUsdtTransfer[];
    knownCounterparties: ReadonlyMap<string, readonly string[]>;
    cooperate(): Promise<void>;
    providerCall<T>(work: () => Promise<T>): Promise<T>;
  }): Promise<UnifiedProductionHardEvidence>;
}) {
  if (!input.runtimeCommit.trim()) {
    throw new TypeError("unified_production_runtime_commit_invalid");
  }
  if (!/^[0-9a-f]{64}$/u.test(input.providerConfigurationSha256)) {
    throw new TypeError(
      "unified_production_provider_configuration_invalid"
    );
  }
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? randomUUID;
  const leaseMs = input.leaseMs ?? 60_000;
  const manifestMaxBytes = input.manifestMaxBytes ??
    DEFAULT_UNIFIED_ORDERED_MANIFEST_MAX_BYTES;
  const commitMaxEntries = input.commitMaxEntries ?? 32;
  const commitMaxBytes = input.commitMaxBytes ?? 8_388_608;
  const providerChunkBudget = input.providerChunkBudget ?? {
    maxWorkUnits: input.addressHistoryPagesPerChunk ?? 4,
    maxWallMs: Number.MAX_SAFE_INTEGER,
    maxResponseBytes: Number.MAX_SAFE_INTEGER,
    maxCheckpointBytes: Number.MAX_SAFE_INTEGER
  };
  for (const [value, code] of [
    [manifestMaxBytes, "unified_production_manifest_max_bytes_invalid"],
    [commitMaxEntries, "unified_production_commit_max_entries_invalid"],
    [commitMaxBytes, "unified_production_commit_max_bytes_invalid"]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(code);
    }
  }
  if (commitMaxBytes < manifestMaxBytes) {
    throw new TypeError("unified_production_commit_max_bytes_too_small");
  }
  const cooperate = async (runId: string): Promise<void> => {
    if (!await cooperateUnifiedCanaryRun(input.db, { runId })) {
      throw new Error("unified_canary_deadline_or_cancellation_reached");
    }
  };
  const measuredProviderCall = async <T>(
    runId: string,
    execution: {
      taskId: string;
      leaseToken: string;
      attempt: number;
      heartbeat(): Promise<void>;
    },
    work: (
      onDiagnostic: (diagnostic: ProviderPageDiagnostic) => void
    ) => Promise<T>
  ): Promise<T> => {
    await execution.heartbeat();
    await cooperate(runId);
    const startedAt = performance.now();
    let providerSource: ProviderPageDiagnostic["source"] | undefined;
    try {
      return await work((diagnostic) => {
        providerSource = diagnostic.source;
      });
    } finally {
      const recorded = await recordUnifiedTaskProviderDuration(input.db, {
        taskId: execution.taskId,
        leaseToken: execution.leaseToken,
        attempt: execution.attempt,
        durationMs: Math.max(0, performance.now() - startedAt),
        providerSource
      });
      if (recorded === null) throw new Error("unified_worker_lease_lost");
      await execution.heartbeat();
      await cooperate(runId);
    }
  };
  const persistArtifact = async (artifactInput: {
    runId: string;
    kind: string;
    sha256: string;
    artifact: unknown;
  }) => {
    await insertUnifiedArtifact(input.db, {
      ...artifactInput,
      createdByRunId: artifactInput.runId,
      schemaVersion: "1"
    });
  };
  const directHistory = createUnifiedDirectHistoryHandler({
    chunkBudget: providerChunkBudget,
    loadRun: (runId) => loadRun(input.db, runId),
    loadPage: ({
      run,
      cursor,
      taskId,
      leaseToken,
      attempt,
      heartbeat
    }) => measuredProviderCall(
      run.id,
      { taskId, leaseToken, attempt, heartbeat },
      (onDiagnostic) => input.loadProviderPage({
        run,
        address: run.subjectAddress,
        cursor,
        onDiagnostic
      })
    ),
    loadPageArtifact: ({ runId, sha256 }) =>
      artifact<UnifiedDirectHistoryPageArtifactV1>(
        input.db,
        runId,
        sha256,
        "direct_history_page"
      ),
    loadChunkArtifact: ({ runId, sha256 }) =>
      artifact<UnifiedDirectHistoryChunkArtifactV1>(
        input.db,
        runId,
        sha256,
        "direct_history_chunk"
      ),
    persistArtifact
  });
  const addressHistory = createUnifiedAddressHistoryHandler({
    chunkBudget: providerChunkBudget,
    loadRun: (runId) => loadRun(input.db, runId),
    loadPage: ({
      run,
      address,
      cursor,
      taskId,
      leaseToken,
      attempt,
      heartbeat
    }) => measuredProviderCall(
      run.id,
      { taskId, leaseToken, attempt, heartbeat },
      (onDiagnostic) => input.loadProviderPage({
        run: {
          ...run,
          subjectAddress: run.analysisManifest.subjectAddress
        },
        address,
        cursor,
        onDiagnostic
      })
    ),
    loadPageArtifact: ({ runId, sha256 }) =>
      artifact<UnifiedAddressHistoryPageArtifactV1>(
        input.db,
        runId,
        sha256,
        "address_history_page"
      ),
    loadChunkArtifact: ({ runId, sha256 }) =>
      artifact<UnifiedAddressHistoryChunkArtifactV1>(
        input.db,
        runId,
        sha256,
        "address_history_chunk"
      ),
    persistArtifact
  });
  const traversal = createUnifiedTraversalCoordinatorHandler({
    commitMaxEntries,
    commitMaxBytes,
    manifestMaxBytes,
    async loadContext(runId) {
      const run = await loadRun(input.db, runId);
      const history = await loadDirectHistory(input.db, run);
      return {
        runId,
        manifest: run.analysisManifest,
        directEvents: history.events
      };
    },
    loadLabels: input.loadCounterpartyLabels,
    loadDurableAddressHistoryKeys: async ({ runId, manifestKeys }) => {
      const identities = await loadUnifiedDurableOrderedTaskIdentities(
        input.db,
        {
          runId,
          identities: manifestKeys.map((logicalKey) => ({
            kind: "address_history",
            logicalKey
          }))
        }
      );
      return new Set(manifestKeys.filter((logicalKey) =>
        identities.has(JSON.stringify(["address_history", logicalKey]))
      ));
    },
    createTaskId: createId,
    loadReadyAddressHistories: (args) =>
      loadUnifiedBoundedReadyPrefix(input.db, {
        ...args,
        expectedTaskKind: "address_history",
        expectedArtifactKind: "address_history_manifest",
        expectedArtifactSchemaVersion: "1"
      }),
    loadCommittedAddressHistories: ({ runId, manifestKeys }) =>
      loadUnifiedCommittedArtifacts(input.db, {
        runId,
        identities: manifestKeys.map((logicalKey) => ({
          kind: "address_history",
          logicalKey
        })),
        expectedArtifactKind: "address_history_manifest",
        expectedArtifactSchemaVersion: "1"
      }),
    loadAddressHistoryPage: ({ runId, sha256 }) =>
      artifact<UnifiedAddressHistoryPageArtifactV1>(
        input.db,
        runId,
        sha256,
        "address_history_page"
      ),
    loadCompactionArtifact: ({ runId, sha256 }) =>
      artifact<TraversalCompactionArtifactV2>(
        input.db,
        runId,
        sha256,
        "traversal_compaction_v2"
      ),
    loadDeltaArtifact: ({ runId, sha256 }) =>
      artifact<TraversalDeltaArtifactV1>(
        input.db,
        runId,
        sha256,
        "traversal_delta"
      ),
    persistArtifact
  });
  const directEvidence = createUnifiedDirectEvidenceHandler({
    async loadContext(runId) {
      const run = await loadRun(input.db, runId);
      const history = await loadDirectHistory(input.db, run);
      return {
        runId,
        snapshotHash: run.analysisManifest.snapshotHash,
        directHistoryArtifactSha256: history.artifactSha256
      };
    },
    async loadEvidence({
      runId,
      taskId,
      leaseToken,
      attempt,
      heartbeat
    }) {
      const run = await loadRun(input.db, runId);
      const history = await loadDirectHistory(input.db, run);
      const counterparties = [...new Set(history.events.flatMap((event) => [
        event.fromAddress,
        event.toAddress
      ]).filter((address) =>
        address.toLowerCase() !== run.subjectAddress.toLowerCase()
      ))].sort();
      const labels = await input.loadCounterpartyLabels({
        labelDatasetSha256: run.analysisManifest.labelDatasetSha256,
        addresses: counterparties
      });
      return input.loadHardEvidence({
        subjectAddress: run.subjectAddress,
        snapshotBlockNumber: run.analysisManifest.confirmedBlockNumber,
        snapshotTimestamp: run.analysisManifest.confirmedBlockTimestamp,
        events: history.events,
        knownCounterparties: labels,
        cooperate: async () => {
          await heartbeat();
          await cooperate(runId);
        },
        providerCall: (work) => measuredProviderCall(
          runId,
          { taskId, leaseToken, attempt, heartbeat },
          work
        )
      });
    },
    persistArtifact
  });
  const branches = createUnifiedProductionBranchHandlers({
    now,
    createId,
    async loadContext(runId, branchId, execution) {
      const run = await loadRun(input.db, runId);
      const history = await loadDirectHistory(input.db, run);
      const traversal = branchId === "fast"
        ? undefined
        : await loadTraversal(input.db, run);
      const counterparties = [...new Set(history.events.flatMap((event) => [
        event.fromAddress,
        event.toAddress
      ]).filter((address) =>
        address.toLowerCase() !== run.subjectAddress.toLowerCase()
      ))].sort();
      const labels = await input.loadCounterpartyLabels({
        labelDatasetSha256: run.analysisManifest.labelDatasetSha256,
        addresses: counterparties
      });
      const persistedHardEvidence = branchId === "deep"
        ? await loadDirectHardEvidence(
            input.db,
            run,
            history.artifactSha256
          )
        : null;
      const hardEvidence = branchId === "deep"
          ? persistedHardEvidence ?? await input.loadHardEvidence({
              subjectAddress: run.subjectAddress,
              snapshotBlockNumber:
                run.analysisManifest.confirmedBlockNumber,
              snapshotTimestamp:
                run.analysisManifest.confirmedBlockTimestamp,
              events: history.events,
              knownCounterparties: labels,
              cooperate: async () => {
                await execution.heartbeat();
                await cooperate(runId);
              },
              providerCall: (work) =>
                measuredProviderCall(runId, execution, work)
            })
        : {};
      return {
        runId,
        manifest: run.analysisManifest,
        directHistoryArtifactSha256: history.artifactSha256,
        directEvents: history.events,
        labelsDatasetSha256:
          run.analysisManifest.labelDatasetSha256,
        deliveryAuthority: false,
        knownCounterparties: labels,
        hardEvidence
        ,
        traversal
      };
    },
    async previousAttemptHash(taskId) {
      const row = (
        await input.db.query(
          `select attempt.artifact_sha256
             from unified_check_attempts attempt
            where attempt.task_id = $1
            order by attempt.attempt desc
            limit 1`,
          [taskId]
        )
      ).rows[0];
      return row ? String(row.artifact_sha256) : null;
    },
    persistArtifact
  });
  return {
    runProviderCycle: (slotId = 0) => runUnifiedTaskCycle({
      workerId: `unified-provider-${slotId}`,
      now,
      leaseMs,
      repository: createPostgresUnifiedTaskCycleRepository(
        input.db,
        ["direct_history", "address_history", "deep_direct"],
        input.runtimeCommit,
        input.providerConfigurationSha256,
        input.runPurpose,
        { manifestMaxBytes }
      ),
      handlers: {
        direct_history: directHistory,
        address_history: addressHistory,
        deep_direct: directEvidence
      },
      createId
    }),
    runAnalysisCycle: () => runUnifiedTaskCycle({
      workerId: "unified-analysis",
      now,
      leaseMs,
      repository: createPostgresUnifiedTaskCycleRepository(
        input.db,
        ["traversal", "fast", "where", "deep"],
        input.runtimeCommit,
        input.providerConfigurationSha256,
        input.runPurpose,
        { manifestMaxBytes }
      ),
      handlers: { traversal, ...branches },
      createId,
      onProviderWorkAvailable: input.onProviderWorkAvailable
    }),
    runFinalizationCycle: async () => {
      const finalized = await runUnifiedProductionFinalizationCycle({
        db: input.db,
        now,
        createId,
        runtimeCommit: input.runtimeCommit,
        providerConfigurationSha256: input.providerConfigurationSha256,
        runPurpose: input.runPurpose
      });
      if (input.runPurpose === "release_canary") {
        return {
          ...finalized,
          reconciled: false,
          requestId: null
        };
      }
      const reconciliation =
        await runUnifiedCompletedPresentationReconciliationCycle({
          db: input.db,
          createId
        });
      return { ...finalized, ...reconciliation };
    }
  };
}
