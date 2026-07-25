import { describe, expect, it, vi } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import type { RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import {
  createUnifiedDirectHistoryHandler,
  isRetryableUnifiedProviderError
} from "../../src/unifiedCheck/productionDirectHistory";
import {
  buildUnifiedBranchInput
} from "../../src/unifiedCheck/requestService";

const ADDRESS = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const OTHER = "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9";

function transfer(
  txHash: string,
  block: number,
  timestamp: number
): RawTronscanTrc20Transfer {
  return {
    transaction_id: txHash,
    from_address: OTHER,
    to_address: ADDRESS,
    quant: "1000000",
    block,
    block_ts: timestamp,
    confirmed: true,
    contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    tokenInfo: {
      tokenId: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      tokenAbbr: "USDT",
      tokenDecimal: 6
    }
  } as RawTronscanTrc20Transfer;
}

const snapshotHash = "a".repeat(64);
const versions = {
  labelDatasetSha256: "b".repeat(64),
  scoringPolicyVersion: "scoring-signal-matrix-v4",
  attributionPolicyVersion: "selected-attribution-policy-v1",
  runtimeCommit: "candidate",
  schemaVersion: 33
};
const manifest = {
  version: "analysis-manifest-v1",
  schemaVersion: 1,
  runId: "run-1",
  requestHash: "c".repeat(64),
  snapshotHash,
  chain: "tron",
  subjectAddress: ADDRESS,
  confirmedBlockNumber: "100",
  confirmedBlockHash: "d".repeat(64),
  confirmedBlockTimestamp: "2026-07-23T13:00:00.000Z",
  labelDatasetSha256: versions.labelDatasetSha256,
  scoringPolicyVersion: versions.scoringPolicyVersion,
  attributionPolicyVersion: versions.attributionPolicyVersion,
  traversalPolicyVersion: "snapshot-closure-v1",
  runtimeCommit: versions.runtimeCommit,
  databaseSchemaVersion: 33,
  paginationCutoffBlockNumber: "100",
  paginationCutoffBlockHash: "d".repeat(64),
  branchArtifactHashes: Object.fromEntries(
    (["fast", "where", "deep"] as const).map((branch) => [
      branch,
      fingerprintCanonicalArtifact(
        buildUnifiedBranchInput(branch, snapshotHash, versions)
      )
    ])
  )
} as const;

describe("Unified production direct history", () => {
  it("waits only for transient provider failures, not immutable cache corruption", () => {
    expect(isRetryableUnifiedProviderError(
      new Error("request timeout")
    )).toBe(true);
    expect(isRetryableUnifiedProviderError(new Error("HTTP 429"))).toBe(true);
    expect(isRetryableUnifiedProviderError(
      new Error("unified_direct_history_provider_metadata_inconsistent")
    )).toBe(true);
    expect(isRetryableUnifiedProviderError(
      new Error("unified_direct_history_cached_page_invalid")
    )).toBe(false);
  });

  it("persists one bounded page per chunk and completes only at account creation", async () => {
    const persisted: Array<{
      kind: string;
      sha256: string;
      artifact: unknown;
    }> = [];
    const artifacts = new Map<string, unknown>();
    const pages = [
      {
        cursor: null,
        nextCursor: "1",
        transfers: [transfer("1".repeat(64), 100, 1_753_276_700_000)],
        reachedAccountCreation: false,
        provider: "tronscan" as const
      },
      {
        cursor: "1",
        nextCursor: "2",
        transfers: [transfer("2".repeat(64), 90, 1_753_276_600_000)],
        reachedAccountCreation: false,
        provider: "tronscan" as const
      },
      {
        cursor: "2",
        nextCursor: null,
        transfers: [transfer("1".repeat(64), 100, 1_753_276_700_000)],
        reachedAccountCreation: true,
        provider: "tronscan" as const
      }
    ].map((page) => ({
      kind: "page" as const,
      ...page,
      pageHash: fingerprintCanonicalArtifact({
        kind: "page",
        ...page
      })
    }));
    const loadPage = vi.fn(async (cursor: string | null) =>
      pages.find((page) => page.cursor === cursor)!
    );
    const handler = createUnifiedDirectHistoryHandler({
      maxPagesThisChunk: 2,
      loadRun: async () => ({
        id: "run-1",
        subjectAddress: ADDRESS,
        analysisManifestSha256: fingerprintCanonicalArtifact(manifest),
        analysisManifest: manifest
      }),
      loadPage: ({ cursor }) => loadPage(cursor),
      loadPageArtifact: async ({ sha256 }) =>
        artifacts.get(sha256) as never,
      loadChunkArtifact: async ({ sha256 }) =>
        artifacts.get(sha256) as never,
      persistArtifact: async (input) => {
        artifacts.set(input.sha256, input.artifact);
        persisted.push(input);
      }
    });
    const heartbeat = vi.fn(async () => undefined);
    const first = await handler({
      task: {
        id: "task-history",
        runId: "run-1",
        kind: "direct_history",
        attempt: 1,
        checkpoint: {},
        cancellationRequestedAt: null
      },
      leaseToken: "test-lease-1",
      heartbeat
    });
    expect(first.kind).toBe("checkpoint");
    if (first.kind !== "checkpoint") return;
    expect(first.checkpoint).toMatchObject({
      version: "unified-direct-history-checkpoint-v2",
      chunkCount: 1,
      pageCount: 2
    });
    expect(first.checkpoint).not.toHaveProperty("pageArtifactHashes");
    expect(first.checkpoint).toMatchObject({
      history: { pageHashes: [] }
    });
    expect(JSON.stringify(first.checkpoint).length).toBeLessThan(4_096);
    const second = await handler({
      task: {
        id: "task-history",
        runId: "run-1",
        kind: "direct_history",
        attempt: 2,
        checkpoint: first.checkpoint,
        cancellationRequestedAt: null
      },
      leaseToken: "test-lease-2",
      heartbeat
    });
    expect(second).toMatchObject({ kind: "completed" });
    expect(loadPage.mock.calls.map(([cursor]) => cursor)).toEqual([
      null,
      "1",
      "2"
    ]);
    expect(persisted.map((item) => item.kind)).toEqual([
      "direct_history_page",
      "direct_history_page",
      "direct_history_chunk",
      "direct_history_page",
      "direct_history_chunk",
      "direct_history"
    ]);
    const completed = persisted.at(-1)?.artifact as {
      eventCount: number;
      eventIndexHash: string;
    };
    expect(completed.eventCount).toBe(2);
    expect(completed.eventIndexHash).not.toBe(
      fingerprintCanonicalArtifact([])
    );
    expect(heartbeat).toHaveBeenCalledTimes(3);
  });
});
