import { randomUUID } from "node:crypto";
import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import type { IndexedTronUsdtTransfer } from "../types";
import type { AnalysisManifestV1 } from "./contracts";
import type {
  DirectHistoryPage,
  DirectHistoryProviderWait
} from "./directHistory";
import {
  createUnifiedProductionBranchHandlers
} from "./productionBranches";
import {
  createUnifiedDirectHistoryHandler,
  canonicalizeUnifiedDirectHistoryPages,
  type UnifiedDirectHistoryArtifactV1,
  type UnifiedDirectHistoryPageArtifactV1
} from "./productionDirectHistory";
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
import type { UnifiedRunPurpose } from "./contracts";
import {
  createUnifiedTraversalHandler,
  type UnifiedTraversalArtifactV1
} from "./productionTraversal";
import {
  cooperateUnifiedCanaryRun,
  insertUnifiedArtifact,
  recordUnifiedTaskProviderDuration,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "./repository";
import { runUnifiedTaskCycle } from "./worker";

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

export function createUnifiedProductionRuntime(input: {
  db: UnifiedTransactionalQueryable;
  runtimeCommit: string;
  providerConfigurationSha256: string;
  runPurpose?: UnifiedRunPurpose;
  now?: () => Date;
  createId?: () => string;
  leaseMs?: number;
  loadProviderPage(input: {
    run: LoadedRun;
    address?: string;
    cursor: string | null;
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
    work: () => Promise<T>
  ): Promise<T> => {
    await execution.heartbeat();
    await cooperate(runId);
    const startedAt = performance.now();
    try {
      return await work();
    } finally {
      const recorded = await recordUnifiedTaskProviderDuration(input.db, {
        taskId: execution.taskId,
        leaseToken: execution.leaseToken,
        attempt: execution.attempt,
        durationMs: Math.max(0, performance.now() - startedAt)
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
      () => input.loadProviderPage({
        run,
        address: run.subjectAddress,
        cursor
      })
    ),
    loadPageArtifact: ({ runId, sha256 }) =>
      artifact<UnifiedDirectHistoryPageArtifactV1>(
        input.db,
        runId,
        sha256,
        "direct_history_page"
      ),
    persistArtifact
  });
  const traversal = createUnifiedTraversalHandler({
    async loadContext(runId) {
      const run = await loadRun(input.db, runId);
      const history = await loadDirectHistory(input.db, run);
      return {
        runId,
        manifest: run.analysisManifest,
        directEvents: history.events
      };
    },
    loadPage: ({
      run,
      address,
      cursor,
      taskId,
      leaseToken,
      attempt,
      heartbeat
    }) => measuredProviderCall(
      run.runId,
      { taskId, leaseToken, attempt, heartbeat },
      () => input.loadProviderPage({
        run: {
          id: run.runId,
          subjectAddress: run.manifest.subjectAddress,
          analysisManifestSha256:
            fingerprintCanonicalArtifact(run.manifest),
          analysisManifest: run.manifest
        },
        address,
        cursor
      })
    ),
    loadLabels: input.loadCounterpartyLabels,
    loadPageArtifact: ({ runId, sha256 }) =>
      artifact<UnifiedDirectHistoryPageArtifactV1>(
        input.db,
        runId,
        sha256,
        "traversal_history_page"
      ),
    persistArtifact
  });
  const branches = createUnifiedProductionBranchHandlers({
    now,
    createId,
    async loadContext(runId, branchId, execution) {
      const run = await loadRun(input.db, runId);
      const history = await loadDirectHistory(input.db, run);
      const traversal = await loadTraversal(input.db, run);
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
      const hardEvidence = branchId === "deep"
          ? await input.loadHardEvidence({
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
    runProviderCycle: () => runUnifiedTaskCycle({
      workerId: "unified-provider",
      now,
      leaseMs,
      repository: createPostgresUnifiedTaskCycleRepository(
        input.db,
        ["direct_history", "traversal"],
        input.runtimeCommit,
        input.providerConfigurationSha256,
        input.runPurpose
      ),
      handlers: { direct_history: directHistory, traversal },
      createId
    }),
    runAnalysisCycle: () => runUnifiedTaskCycle({
      workerId: "unified-analysis",
      now,
      leaseMs,
      repository: createPostgresUnifiedTaskCycleRepository(
        input.db,
        ["fast", "where", "deep"],
        input.runtimeCommit,
        input.providerConfigurationSha256,
        input.runPurpose
      ),
      handlers: branches,
      createId
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
