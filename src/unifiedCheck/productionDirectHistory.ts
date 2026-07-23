import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
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
import type { UnifiedChunkHandler } from "./worker";

const HASH = /^[0-9a-f]{64}$/u;

export function isRetryableUnifiedProviderError(error: unknown): boolean {
  const reason = error instanceof Error ? error.message : String(error);
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

type RuntimeCheckpoint = {
  readonly version: "unified-direct-history-checkpoint-v1";
  readonly history: DirectHistoryCheckpoint;
  readonly pageArtifactHashes: readonly string[];
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
): RuntimeCheckpoint {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).version === undefined
  ) {
    return {
      version: "unified-direct-history-checkpoint-v1",
      history: initialDirectHistoryCheckpoint(
        run.analysisManifest.confirmedBlockNumber,
        run.analysisManifest.confirmedBlockHash
      ),
      pageArtifactHashes: []
    };
  }
  const record = value as Partial<RuntimeCheckpoint>;
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
    version: record.version,
    history: record.history,
    pageArtifactHashes: [...record.pageArtifactHashes]
  };
}

export function createUnifiedDirectHistoryHandler(input: {
  loadRun(runId: string): Promise<LoadedRun>;
  loadPage(input: {
    run: LoadedRun;
    cursor: string | null;
  }): Promise<DirectHistoryPage | DirectHistoryProviderWait>;
  loadPageArtifact(input: {
    runId: string;
    sha256: string;
  }): Promise<UnifiedDirectHistoryPageArtifactV1>;
  persistArtifact(input: {
    runId: string;
    kind: "direct_history_page" | "direct_history";
    sha256: string;
    artifact: UnifiedDirectHistoryPageArtifactV1 | UnifiedDirectHistoryArtifactV1;
  }): Promise<void>;
}): UnifiedChunkHandler {
  return async ({ task, heartbeat }) => {
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
    const prior = checkpoint(task.checkpoint, run);
    const result = await runDirectHistoryChunk({
      address: run.subjectAddress,
      manifest: run.analysisManifest,
      checkpoint: prior.history,
      maxPagesThisChunk: 1,
      loadPage: (cursor) => input.loadPage({ run, cursor })
    });
    await heartbeat();
    if (result.outcome === "provider_wait") {
      return {
        kind: "provider_wait",
        readyAt: result.providerReadyAt!,
        reason: result.providerWaitReason ?? "unified_provider_wait",
        checkpoint: prior
      };
    }
    const providerPageHash = result.checkpoint.pageHashes.at(-1);
    if (!providerPageHash || !HASH.test(providerPageHash)) {
      return { kind: "failed", reason: "unified_direct_history_page_hash_missing" };
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
    const pageArtifactHash = fingerprintCanonicalArtifact(pageArtifact);
    await input.persistArtifact({
      runId: run.id,
      kind: "direct_history_page",
      sha256: pageArtifactHash,
      artifact: pageArtifact
    });
    const next: RuntimeCheckpoint = {
      version: "unified-direct-history-checkpoint-v1",
      history: result.checkpoint,
      pageArtifactHashes: [...prior.pageArtifactHashes, pageArtifactHash]
    };
    if (result.outcome === "more") {
      return { kind: "checkpoint", checkpoint: next };
    }
    const canonical = canonicalizeUnifiedDirectHistoryPages(
      await Promise.all(next.pageArtifactHashes.map((sha256) =>
        input.loadPageArtifact({ runId: run.id, sha256 })
      ))
    );
    const artifact: UnifiedDirectHistoryArtifactV1 = {
      version: "unified-direct-history-v1",
      schemaVersion: 1,
      runId: run.id,
      analysisManifestHash: run.analysisManifestSha256,
      snapshotHash: run.analysisManifest.snapshotHash,
      pageArtifactHashes: next.pageArtifactHashes,
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
