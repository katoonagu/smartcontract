import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../forensics/canonicalJson";
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
  shouldCheckpointUnifiedProviderChunk,
  type UnifiedChunkHandler,
  type UnifiedProviderChunkBudget
} from "./worker";

const HASH = /^[0-9a-f]{64}$/u;

export function isRetryableUnifiedProviderError(error: unknown): boolean {
  const reason = error instanceof Error ? error.message : String(error);
  if (reason === "unified_direct_history_provider_metadata_inconsistent") {
    return true;
  }
  return /(?:\b429\b|rate.?limit|timeout|timed.?out|fetch failed|econnreset|etimedout|eai_again|temporar(?:y|ily))/iu
    .test(reason);
}

export type UnifiedDirectHistoryPageArtifactV1 = {
  readonly version: "unified-direct-history-page-v1";
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly providerPageHash: string;
  readonly events: readonly (Omit<
    IndexedTronUsdtTransfer,
    "blockTimestamp"
  > & { readonly blockTimestamp: string })[];
};

export type UnifiedDirectHistoryArtifactV1 = {
  readonly version: "unified-direct-history-v1";
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly analysisManifestHash: string;
  readonly snapshotHash: string;
  readonly pageArtifactHashes: readonly string[];
  readonly eventIndexHash: string;
  readonly eventCount: number;
  readonly reachedAccountCreation: true;
};

export function canonicalizeUnifiedDirectHistoryPages(
  pages: readonly UnifiedDirectHistoryPageArtifactV1[]
): {
  readonly events: UnifiedDirectHistoryPageArtifactV1["events"];
  readonly eventIndexHash: string;
  readonly eventCount: number;
} {
  const byKey = new Map<
    string,
    UnifiedDirectHistoryPageArtifactV1["events"][number]
  >();
  for (const page of pages) {
    for (const event of page.events) {
      const key = canonicalTronUsdtEventKey(event);
      const prior = byKey.get(key);
      if (
        prior !== undefined &&
        fingerprintCanonicalArtifact(prior) !==
          fingerprintCanonicalArtifact(event)
      ) {
        throw new Error("unified_direct_history_event_conflict");
      }
      byKey.set(key, event);
    }
  }
  const entries = [...byKey.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return {
    events: entries.map(([, event]) => event),
    eventIndexHash: fingerprintCanonicalArtifact(
      entries.map(([key]) => key)
    ),
    eventCount: entries.length
  };
}

type LegacyRuntimeCheckpointV1 = {
  readonly version: "unified-direct-history-checkpoint-v1";
  readonly history: DirectHistoryCheckpoint;
  readonly pageArtifactHashes: readonly string[];
};

export type UnifiedDirectHistoryChunkArtifactV1 = {
  readonly version: "unified-direct-history-chunk-v1";
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly previousChunkSha256: string | null;
  readonly pageArtifactHashes: readonly string[];
};

type RuntimeCheckpointV2 = {
  readonly version: "unified-direct-history-checkpoint-v2";
  readonly history: DirectHistoryCheckpoint;
  readonly chunkHeadSha256: string | null;
  readonly chunkCount: number;
  readonly pageCount: number;
};

type LoadedRun = {
  readonly id: string;
  readonly subjectAddress: string;
  readonly analysisManifestSha256: string;
  readonly analysisManifest: AnalysisManifestV1;
};

function checkpoint(
  value: unknown,
  run: LoadedRun
): {
  state: RuntimeCheckpointV2;
  legacyPageArtifactHashes: readonly string[];
} {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).version === undefined
  ) {
    return {
      state: {
        version: "unified-direct-history-checkpoint-v2",
        history: initialDirectHistoryCheckpoint(
          run.analysisManifest.confirmedBlockNumber,
          run.analysisManifest.confirmedBlockHash
        ),
        chunkHeadSha256: null,
        chunkCount: 0,
        pageCount: 0
      },
      legacyPageArtifactHashes: []
    };
  }
  const record = value as
    | Partial<RuntimeCheckpointV2>
    | Partial<LegacyRuntimeCheckpointV1>;
  if (record.version === "unified-direct-history-checkpoint-v2") {
    if (
      record.history === undefined ||
      !(
        record.chunkHeadSha256 === null ||
        (
          typeof record.chunkHeadSha256 === "string" &&
          HASH.test(record.chunkHeadSha256)
        )
      ) ||
      !Number.isSafeInteger(record.chunkCount) ||
      Number(record.chunkCount) < 0 ||
      !Number.isSafeInteger(record.pageCount) ||
      Number(record.pageCount) < 0
    ) {
      throw new Error("unified_direct_history_runtime_checkpoint_invalid");
    }
    return {
      state: record as RuntimeCheckpointV2,
      legacyPageArtifactHashes: []
    };
  }
  if (
    record.version !== "unified-direct-history-checkpoint-v1" ||
    record.history === undefined ||
    !Array.isArray(record.pageArtifactHashes) ||
    record.pageArtifactHashes.some((hash) =>
      typeof hash !== "string" || !HASH.test(hash)
    )
  ) {
    throw new Error("unified_direct_history_runtime_checkpoint_invalid");
  }
  return {
    state: {
      version: "unified-direct-history-checkpoint-v2",
      history: record.history,
      chunkHeadSha256: null,
      chunkCount: 0,
      pageCount: 0
    },
    legacyPageArtifactHashes: [...record.pageArtifactHashes]
  };
}

async function pageHashesFromChunks(input: {
  runId: string;
  headSha256: string | null;
  expectedChunkCount: number;
  expectedPageCount: number;
  loadChunkArtifact(args: {
    runId: string;
    sha256: string;
  }): Promise<UnifiedDirectHistoryChunkArtifactV1>;
}): Promise<string[]> {
  const chunks: UnifiedDirectHistoryChunkArtifactV1[] = [];
  const seen = new Set<string>();
  let sha256 = input.headSha256;
  while (sha256 !== null) {
    if (seen.has(sha256)) {
      throw new Error("unified_direct_history_chunk_cycle");
    }
    seen.add(sha256);
    const chunk = await input.loadChunkArtifact({
      runId: input.runId,
      sha256
    });
    if (
      fingerprintCanonicalArtifact(chunk) !== sha256 ||
      chunk.version !== "unified-direct-history-chunk-v1" ||
      chunk.runId !== input.runId ||
      chunk.pageArtifactHashes.length === 0 ||
      chunk.pageArtifactHashes.some((value) => !HASH.test(value))
    ) {
      throw new Error("unified_direct_history_chunk_invalid");
    }
    chunks.push(chunk);
    sha256 = chunk.previousChunkSha256;
  }
  if (chunks.length !== input.expectedChunkCount) {
    throw new Error("unified_direct_history_chunk_count_mismatch");
  }
  const pageHashes = chunks
    .reverse()
    .flatMap((chunk) => [...chunk.pageArtifactHashes]);
  if (pageHashes.length !== input.expectedPageCount) {
    throw new Error("unified_direct_history_page_count_mismatch");
  }
  return pageHashes;
}

export function createUnifiedDirectHistoryHandler(input: {
  maxPagesThisChunk?: number;
  chunkBudget?: UnifiedProviderChunkBudget;
  now?: () => number;
  loadRun(runId: string): Promise<LoadedRun>;
  loadPage(input: {
    run: LoadedRun;
    cursor: string | null;
    taskId: string;
    leaseToken: string;
    attempt: number;
    heartbeat(): Promise<void>;
  }): Promise<DirectHistoryPage | DirectHistoryProviderWait>;
  loadPageArtifact(input: {
    runId: string;
    sha256: string;
  }): Promise<UnifiedDirectHistoryPageArtifactV1>;
  loadChunkArtifact(input: {
    runId: string;
    sha256: string;
  }): Promise<UnifiedDirectHistoryChunkArtifactV1>;
  persistArtifact(input: {
    runId: string;
    kind:
      | "direct_history_page"
      | "direct_history_chunk"
      | "direct_history";
    sha256: string;
    artifact:
      | UnifiedDirectHistoryPageArtifactV1
      | UnifiedDirectHistoryChunkArtifactV1
      | UnifiedDirectHistoryArtifactV1;
  }): Promise<void>;
}): UnifiedChunkHandler {
  const chunkBudget = input.chunkBudget ?? {
    maxWorkUnits: input.maxPagesThisChunk ?? 1,
    maxWallMs: Number.MAX_SAFE_INTEGER,
    maxResponseBytes: Number.MAX_SAFE_INTEGER,
    maxCheckpointBytes: Number.MAX_SAFE_INTEGER
  };
  try {
    shouldCheckpointUnifiedProviderChunk(chunkBudget, {
      workUnits: 0,
      elapsedMs: 0,
      responseBytes: 0,
      checkpointBytes: 0
    });
  } catch {
    throw new TypeError("unified_direct_history_chunk_invalid");
  }
  const now = input.now ?? Date.now;
  return async ({ task, heartbeat, leaseToken }) => {
    const chunkStartedAt = now();
    if (task.kind !== "direct_history") {
      return { kind: "blocked", reason: "unified_direct_history_kind_invalid" };
    }
    const run = await input.loadRun(task.runId);
    if (
      run.id !== task.runId ||
      run.analysisManifest.runId !== task.runId ||
      run.subjectAddress !== run.analysisManifest.subjectAddress ||
      fingerprintCanonicalArtifact(run.analysisManifest) !==
        run.analysisManifestSha256
    ) {
      return { kind: "blocked", reason: "unified_direct_history_run_mismatch" };
    }
    const parsed = checkpoint(task.checkpoint, run);
    let state = parsed.state;
    let history = state.history;
    let completed = history.reachedAccountCreation;
    const chunkPageArtifactHashes = [
      ...parsed.legacyPageArtifactHashes
    ];
    let workUnits = 0;
    let responseBytes = 0;

    const flushChunk = async () => {
      if (chunkPageArtifactHashes.length === 0) return;
      const chunk: UnifiedDirectHistoryChunkArtifactV1 = {
        version: "unified-direct-history-chunk-v1",
        schemaVersion: 1,
        runId: run.id,
        previousChunkSha256: state.chunkHeadSha256,
        pageArtifactHashes: [...chunkPageArtifactHashes]
      };
      const sha256 = fingerprintCanonicalArtifact(chunk);
      await input.persistArtifact({
        runId: run.id,
        kind: "direct_history_chunk",
        sha256,
        artifact: chunk
      });
      state = {
        ...state,
        history,
        chunkHeadSha256: sha256,
        chunkCount: state.chunkCount + 1,
        pageCount: state.pageCount + chunkPageArtifactHashes.length
      };
      chunkPageArtifactHashes.length = 0;
    };

    while (!completed) {
      let loadedPage: DirectHistoryPage | null = null;
      const result = await runDirectHistoryChunk({
        address: run.subjectAddress,
        manifest: run.analysisManifest,
        checkpoint: history,
        maxPagesThisChunk: 1,
        loadPage: async (cursor) => {
          const loaded = await input.loadPage({
            run,
            cursor,
            taskId: task.id,
            leaseToken,
            attempt: task.attempt,
            heartbeat
          });
          if (loaded.kind === "page") loadedPage = loaded;
          return loaded;
        }
      });
      if (result.outcome === "provider_wait") {
        await flushChunk();
        return {
          kind: "provider_wait",
          readyAt: result.providerReadyAt!,
          reason: result.providerWaitReason ?? "unified_provider_wait",
          checkpoint: state
        };
      }
      if (loadedPage === null) {
        return {
          kind: "failed",
          reason: "unified_direct_history_loaded_page_missing"
        };
      }
      const providerPageHash = result.checkpoint.pageHashes.at(-1);
      if (!providerPageHash || !HASH.test(providerPageHash)) {
        return {
          kind: "failed",
          reason: "unified_direct_history_page_hash_missing"
        };
      }
      const pageArtifact: UnifiedDirectHistoryPageArtifactV1 = {
        version: "unified-direct-history-page-v1",
        schemaVersion: 1,
        runId: run.id,
        providerPageHash,
        events: [...result.events]
          .sort((left, right) =>
            canonicalTronUsdtEventKey(left).localeCompare(
              canonicalTronUsdtEventKey(right)
            )
          )
          .map((event) => ({
            ...event,
            blockTimestamp: event.blockTimestamp.toISOString()
          }))
      };
      responseBytes += Buffer.byteLength(
        canonicalizeArtifactJson(loadedPage),
        "utf8"
      );
      const pageArtifactHash = fingerprintCanonicalArtifact(pageArtifact);
      await input.persistArtifact({
        runId: run.id,
        kind: "direct_history_page",
        sha256: pageArtifactHash,
        artifact: pageArtifact
      });
      chunkPageArtifactHashes.push(pageArtifactHash);
      history = {
        ...result.checkpoint,
        // Page identities are already durable in the immutable chunk chain.
        pageHashes: []
      };
      completed = result.outcome === "complete";
      workUnits += 1;
      await heartbeat();
      const projectedCheckpoint: RuntimeCheckpointV2 = {
        ...state,
        history,
        chunkHeadSha256: "0".repeat(64),
        chunkCount: state.chunkCount + 1,
        pageCount: state.pageCount + chunkPageArtifactHashes.length
      };
      if (
        !completed &&
        shouldCheckpointUnifiedProviderChunk(chunkBudget, {
          workUnits,
          elapsedMs: Math.max(0, now() - chunkStartedAt),
          responseBytes,
          checkpointBytes: Buffer.byteLength(
            canonicalizeArtifactJson(projectedCheckpoint),
            "utf8"
          )
        })
      ) {
        await flushChunk();
        return { kind: "checkpoint", checkpoint: state };
      }
    }

    await flushChunk();
    if (!completed) {
      return { kind: "checkpoint", checkpoint: state };
    }
    const pageArtifactHashes = await pageHashesFromChunks({
      runId: run.id,
      headSha256: state.chunkHeadSha256,
      expectedChunkCount: state.chunkCount,
      expectedPageCount: state.pageCount,
      loadChunkArtifact: input.loadChunkArtifact
    });
    const canonical = canonicalizeUnifiedDirectHistoryPages(
      await Promise.all(pageArtifactHashes.map((sha256) =>
        input.loadPageArtifact({ runId: run.id, sha256 })
      ))
    );
    const artifact: UnifiedDirectHistoryArtifactV1 = {
      version: "unified-direct-history-v1",
      schemaVersion: 1,
      runId: run.id,
      analysisManifestHash: run.analysisManifestSha256,
      snapshotHash: run.analysisManifest.snapshotHash,
      pageArtifactHashes,
      eventIndexHash: canonical.eventIndexHash,
      eventCount: canonical.eventCount,
      reachedAccountCreation: true
    };
    const artifactSha256 = fingerprintCanonicalArtifact(artifact);
    await input.persistArtifact({
      runId: run.id,
      kind: "direct_history",
      sha256: artifactSha256,
      artifact
    });
    return { kind: "completed", artifactSha256 };
  };
}
