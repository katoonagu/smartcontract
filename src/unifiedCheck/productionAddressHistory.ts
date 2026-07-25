import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../forensics/canonicalJson";
import { canonicalTronUsdtEventKey } from "../forensics/tronAddressAllTimeIndex";
import type { IndexedTronUsdtTransfer } from "../types";
import {
  addressHistoryManifestKey,
  buildAddressHistoryManifest,
  type AddressHistoryManifestIdentityV1,
  type AddressHistoryManifestV1
} from "./addressHistory";
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

export type UnifiedAddressHistoryPageArtifactV1 = {
  readonly version: "unified-address-history-page-v1";
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly manifestKey: string;
  readonly providerPageHash: string;
  readonly rawRowCount: number;
  readonly events: readonly (Omit<
    IndexedTronUsdtTransfer,
    "blockTimestamp"
  > & { readonly blockTimestamp: string })[];
};

export type UnifiedAddressHistoryChunkArtifactV1 = {
  readonly version: "unified-address-history-chunk-v1";
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly manifestKey: string;
  readonly previousChunkSha256: string | null;
  readonly pageArtifactHashes: readonly string[];
  readonly rawRowCount: number;
};

type AddressHistoryCheckpointV2 = {
  readonly version: "unified-address-history-checkpoint-v2";
  readonly identity: AddressHistoryManifestIdentityV1;
  readonly history: DirectHistoryCheckpoint | null;
  readonly chunkHeadSha256: string | null;
  readonly chunkCount: number;
  readonly pageCount: number;
  readonly rawRowCount: number;
};

type LoadedRun = {
  readonly id: string;
  readonly analysisManifestSha256: string;
  readonly analysisManifest: AnalysisManifestV1;
};

function checkpoint(
  value: unknown,
  run: LoadedRun,
  logicalKey: string | undefined
): AddressHistoryCheckpointV2 {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("unified_address_history_checkpoint_invalid");
  }
  const parsed = value as Partial<AddressHistoryCheckpointV2>;
  if (
    parsed.version !== "unified-address-history-checkpoint-v2" ||
    parsed.identity === undefined ||
    !(
      parsed.chunkHeadSha256 === null ||
      (
        typeof parsed.chunkHeadSha256 === "string" &&
        HASH.test(parsed.chunkHeadSha256)
      )
    ) ||
    !Number.isSafeInteger(parsed.chunkCount) ||
    Number(parsed.chunkCount) < 0 ||
    !Number.isSafeInteger(parsed.pageCount) ||
    Number(parsed.pageCount) < 0 ||
    !Number.isSafeInteger(parsed.rawRowCount) ||
    Number(parsed.rawRowCount) < 0
  ) {
    throw new Error("unified_address_history_checkpoint_invalid");
  }
  const key = addressHistoryManifestKey(parsed.identity);
  if (
    key !== logicalKey ||
    parsed.identity.snapshotHash !== run.analysisManifest.snapshotHash
  ) {
    throw new Error("unified_address_history_checkpoint_binding_mismatch");
  }
  return parsed as AddressHistoryCheckpointV2;
}

function serializedEvents(events: readonly IndexedTronUsdtTransfer[]) {
  return [...events]
    .sort((left, right) =>
      canonicalTronUsdtEventKey(left).localeCompare(
        canonicalTronUsdtEventKey(right)
      )
    )
    .map((event) => ({
      ...event,
      blockTimestamp: event.blockTimestamp.toISOString()
    }));
}

function canonicalEvents(
  pages: readonly UnifiedAddressHistoryPageArtifactV1[]
): {
  ids: string[];
  duplicateCount: number;
} {
  const byId = new Map<string, string>();
  let observed = 0;
  for (const page of pages) {
    for (const event of page.events) {
      observed += 1;
      const id = canonicalTronUsdtEventKey(event);
      const prior = byId.get(id);
      const eventHash = fingerprintCanonicalArtifact(event);
      if (prior !== undefined && prior !== eventHash) {
        throw new Error("unified_address_history_event_conflict");
      }
      byId.set(id, eventHash);
    }
  }
  const ids = [...byId.keys()].sort();
  return { ids, duplicateCount: observed - ids.length };
}

async function pageArtifactHashesFromChain(input: {
  runId: string;
  manifestKey: string;
  headSha256: string | null;
  expectedChunkCount: number;
  expectedPageCount: number;
  loadChunkArtifact(args: {
    runId: string;
    sha256: string;
  }): Promise<UnifiedAddressHistoryChunkArtifactV1>;
}): Promise<string[]> {
  const chunks: UnifiedAddressHistoryChunkArtifactV1[] = [];
  const seen = new Set<string>();
  let sha256 = input.headSha256;
  while (sha256 !== null) {
    if (seen.has(sha256)) {
      throw new Error("unified_address_history_chunk_cycle");
    }
    seen.add(sha256);
    const chunk = await input.loadChunkArtifact({
      runId: input.runId,
      sha256
    });
    if (
      fingerprintCanonicalArtifact(chunk) !== sha256 ||
      chunk.version !== "unified-address-history-chunk-v1" ||
      chunk.runId !== input.runId ||
      chunk.manifestKey !== input.manifestKey ||
      chunk.pageArtifactHashes.length === 0 ||
      chunk.pageArtifactHashes.some((value) => !HASH.test(value))
    ) {
      throw new Error("unified_address_history_chunk_invalid");
    }
    chunks.push(chunk);
    sha256 = chunk.previousChunkSha256;
  }
  if (chunks.length !== input.expectedChunkCount) {
    throw new Error("unified_address_history_chunk_count_mismatch");
  }
  const pageHashes = chunks
    .reverse()
    .flatMap((chunk) => [...chunk.pageArtifactHashes]);
  if (pageHashes.length !== input.expectedPageCount) {
    throw new Error("unified_address_history_page_count_mismatch");
  }
  return pageHashes;
}

export function createUnifiedAddressHistoryHandler(input: {
  maxPagesThisChunk?: number;
  chunkBudget?: UnifiedProviderChunkBudget;
  now?: () => number;
  loadRun(runId: string): Promise<LoadedRun>;
  loadPage(input: {
    run: LoadedRun;
    address: string;
    cursor: string | null;
    taskId: string;
    leaseToken: string;
    attempt: number;
    heartbeat(): Promise<void>;
  }): Promise<DirectHistoryPage | DirectHistoryProviderWait>;
  loadPageArtifact(input: {
    runId: string;
    sha256: string;
  }): Promise<UnifiedAddressHistoryPageArtifactV1>;
  loadChunkArtifact(input: {
    runId: string;
    sha256: string;
  }): Promise<UnifiedAddressHistoryChunkArtifactV1>;
  persistArtifact(input: {
    runId: string;
    kind:
      | "address_history_page"
      | "address_history_chunk"
      | "address_history_exhaustion";
    sha256: string;
    artifact: unknown;
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
    throw new TypeError("unified_address_history_chunk_invalid");
  }
  const now = input.now ?? Date.now;
  return async ({ task, heartbeat, leaseToken }) => {
    const chunkStartedAt = now();
    if (task.kind !== "address_history") {
      return { kind: "blocked", reason: "unified_address_history_kind_invalid" };
    }
    const run = await input.loadRun(task.runId);
    if (
      run.id !== task.runId ||
      run.analysisManifest.runId !== task.runId ||
      fingerprintCanonicalArtifact(run.analysisManifest) !==
        run.analysisManifestSha256
    ) {
      return { kind: "blocked", reason: "unified_address_history_run_mismatch" };
    }
    let state = checkpoint(task.checkpoint, run, task.logicalKey);
    let history = state.history ?? initialDirectHistoryCheckpoint(
      run.analysisManifest.confirmedBlockNumber,
      run.analysisManifest.confirmedBlockHash
    );
    let completed = history.reachedAccountCreation;
    const chunkPageArtifactHashes: string[] = [];
    let chunkRawRowCount = 0;
    let workUnits = 0;
    let responseBytes = 0;

    const flushChunk = async () => {
      if (chunkPageArtifactHashes.length === 0) return;
      const chunk: UnifiedAddressHistoryChunkArtifactV1 = {
        version: "unified-address-history-chunk-v1",
        schemaVersion: 1,
        runId: task.runId,
        manifestKey: task.logicalKey!,
        previousChunkSha256: state.chunkHeadSha256,
        pageArtifactHashes: [...chunkPageArtifactHashes],
        rawRowCount: chunkRawRowCount
      };
      const chunkSha256 = fingerprintCanonicalArtifact(chunk);
      await input.persistArtifact({
        runId: task.runId,
        kind: "address_history_chunk",
        sha256: chunkSha256,
        artifact: chunk
      });
      state = {
        ...state,
        history,
        chunkHeadSha256: chunkSha256,
        chunkCount: state.chunkCount + 1,
        pageCount: state.pageCount + chunkPageArtifactHashes.length,
        rawRowCount: state.rawRowCount + chunkRawRowCount
      };
      chunkPageArtifactHashes.length = 0;
      chunkRawRowCount = 0;
    };

    while (!completed) {
      let loadedPage: DirectHistoryPage | null = null;
      const result = await runDirectHistoryChunk({
        address: state.identity.address,
        manifest: run.analysisManifest,
        checkpoint: history,
        maxPagesThisChunk: 1,
        loadPage: async (cursor) => {
          const loaded = await input.loadPage({
            run,
            address: state.identity.address,
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
          reason: "unified_address_history_loaded_page_missing"
        };
      }
      const providerPageHash = result.checkpoint.pageHashes.at(-1);
      if (!providerPageHash || !HASH.test(providerPageHash)) {
        return {
          kind: "failed",
          reason: "unified_address_history_page_hash_missing"
        };
      }
      const physicalPage = loadedPage as DirectHistoryPage;
      responseBytes += Buffer.byteLength(
        canonicalizeArtifactJson(physicalPage),
        "utf8"
      );
      const pageArtifact: UnifiedAddressHistoryPageArtifactV1 = {
        version: "unified-address-history-page-v1",
        schemaVersion: 1,
        runId: task.runId,
        manifestKey: task.logicalKey!,
        providerPageHash,
        rawRowCount: physicalPage.transfers.length,
        events: serializedEvents(result.events)
      };
      const pageArtifactHash = fingerprintCanonicalArtifact(pageArtifact);
      await input.persistArtifact({
        runId: task.runId,
        kind: "address_history_page",
        sha256: pageArtifactHash,
        artifact: pageArtifact
      });
      history = {
        ...result.checkpoint,
        // Page identities are already durable in the immutable chunk chain.
        pageHashes: []
      };
      chunkPageArtifactHashes.push(pageArtifactHash);
      chunkRawRowCount += physicalPage.transfers.length;
      completed = result.outcome === "complete";
      workUnits += 1;
      await heartbeat();
      const projectedCheckpoint: AddressHistoryCheckpointV2 = {
        ...state,
        history,
        chunkHeadSha256: "0".repeat(64),
        chunkCount: state.chunkCount + 1,
        pageCount: state.pageCount + chunkPageArtifactHashes.length,
        rawRowCount: state.rawRowCount + chunkRawRowCount
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
    const pageArtifactHashes = await pageArtifactHashesFromChain({
      runId: task.runId,
      manifestKey: task.logicalKey!,
      headSha256: state.chunkHeadSha256,
      expectedChunkCount: state.chunkCount,
      expectedPageCount: state.pageCount,
      loadChunkArtifact: input.loadChunkArtifact
    });
    const pages = await Promise.all(pageArtifactHashes.map((sha256) =>
      input.loadPageArtifact({ runId: task.runId, sha256 })
    ));
    const canonical = canonicalEvents(pages);
    const exhaustion = {
      version: "unified-address-history-exhaustion-v1" as const,
      manifestKey: task.logicalKey!,
      snapshotHash: run.analysisManifest.snapshotHash,
      address: state.identity.address,
      pageArtifactHashes,
      reachedAccountCreation: true as const
    };
    const exhaustionSha256 = fingerprintCanonicalArtifact(exhaustion);
    await input.persistArtifact({
      runId: task.runId,
      kind: "address_history_exhaustion",
      sha256: exhaustionSha256,
      artifact: exhaustion
    });
    const artifact: AddressHistoryManifestV1 = buildAddressHistoryManifest({
      ...state.identity,
      pageArtifactHashes,
      canonicalEventIds: canonical.ids,
      rawRowCount: state.rawRowCount,
      duplicateCount:
        Math.max(canonical.duplicateCount, state.rawRowCount - canonical.ids.length),
      exhaustion: {
        kind: "account_creation_reached",
        evidenceSha256: exhaustionSha256
      }
    });
    if (artifact.key !== task.logicalKey) {
      return {
        kind: "failed",
        reason: "unified_address_history_manifest_key_mismatch"
      };
    }
    const artifactSha256 = fingerprintCanonicalArtifact(artifact);
    return {
      kind: "completed",
      artifactSha256,
      acceptedArtifact: {
        kind: "address_history_manifest",
        schemaVersion: "1",
        value: artifact
      }
    };
  };
}
