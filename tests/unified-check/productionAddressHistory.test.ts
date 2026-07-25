import { describe, expect, it, vi } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import type { RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import {
  addressHistoryManifestKey
} from "../../src/unifiedCheck/addressHistory";
import {
  createUnifiedAddressHistoryHandler
} from "../../src/unifiedCheck/productionAddressHistory";
import {
  buildUnifiedBranchInput
} from "../../src/unifiedCheck/requestService";

const ADDRESS = "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV";
const OTHER = "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9";
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
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
  subjectAddress: OTHER,
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
const identity = {
  chain: "tron" as const,
  snapshotHash,
  tokenContract: USDT,
  address: ADDRESS,
  providerRequestVersion: "tronscan-related-trc20-v1"
};
const manifestKey = addressHistoryManifestKey(identity);

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
    contract_address: USDT,
    tokenInfo: {
      tokenId: USDT,
      tokenAbbr: "USDT",
      tokenDecimal: 6
    }
  } as RawTronscanTrc20Transfer;
}

function initialCheckpoint() {
  return {
    version: "unified-address-history-checkpoint-v2",
    identity,
    history: null,
    chunkHeadSha256: null,
    chunkCount: 0,
    pageCount: 0,
    rawRowCount: 0
  } as const;
}

describe("Unified production address history", () => {
  it.each([
    "work_units",
    "wall_time",
    "response_bytes",
    "checkpoint_bytes"
  ] as const)("checkpoints after the current provider operation reaches %s", async (limit) => {
    const artifacts = new Map<string, unknown>();
    const page = {
      kind: "page" as const,
      cursor: null,
      nextCursor: "1",
      transfers: [transfer("9".repeat(64), 80, 1_753_276_500_000)],
      reachedAccountCreation: false,
      provider: "tronscan" as const
    };
    const loaded = {
      ...page,
      pageHash: fingerprintCanonicalArtifact(page)
    };
    let clock = 0;
    const loadPage = vi.fn(async () => {
      if (limit === "wall_time") clock = 10;
      return loaded;
    });
    const handler = createUnifiedAddressHistoryHandler({
      chunkBudget: {
        maxWorkUnits: limit === "work_units" ? 1 : 100,
        maxWallMs: limit === "wall_time" ? 1 : 1_000_000,
        maxResponseBytes: limit === "response_bytes" ? 1 : 1_000_000,
        maxCheckpointBytes: limit === "checkpoint_bytes" ? 1 : 1_000_000
      },
      now: () => clock,
      loadRun: async () => ({
        id: "run-1",
        analysisManifestSha256: fingerprintCanonicalArtifact(manifest),
        analysisManifest: manifest
      }),
      loadPage,
      loadPageArtifact: async ({ sha256 }) => artifacts.get(sha256) as never,
      loadChunkArtifact: async ({ sha256 }) => artifacts.get(sha256) as never,
      persistArtifact: async (input) => {
        artifacts.set(input.sha256, input.artifact);
      }
    });

    const result = await handler({
      task: {
        id: "task-address-history",
        runId: "run-1",
        kind: "address_history",
        logicalKey: manifestKey,
        attempt: 1,
        checkpoint: initialCheckpoint(),
        cancellationRequestedAt: null
      },
      leaseToken: "lease-1",
      heartbeat: vi.fn(async () => undefined)
    });

    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      kind: "checkpoint",
      checkpoint: {
        version: "unified-address-history-checkpoint-v2",
        pageCount: 1,
        rawRowCount: 1
      }
    });
  });

  it("completes several physical pages in one logical chunk", async () => {
    const artifacts = new Map<string, unknown>();
    const persisted: Array<{
      kind: string;
      sha256: string;
      artifact: unknown;
    }> = [];
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
        nextCursor: null,
        transfers: [transfer("2".repeat(64), 90, 1_753_276_600_000)],
        reachedAccountCreation: true,
        provider: "tronscan" as const
      }
    ].map((page) => ({
      kind: "page" as const,
      ...page,
      pageHash: fingerprintCanonicalArtifact({ kind: "page", ...page })
    }));
    const loadPage = vi.fn(async (cursor: string | null) =>
      pages.find((page) => page.cursor === cursor)!
    );
    const handler = createUnifiedAddressHistoryHandler({
      maxPagesThisChunk: 5,
      loadRun: async () => ({
        id: "run-1",
        analysisManifestSha256: fingerprintCanonicalArtifact(manifest),
        analysisManifest: manifest
      }),
      loadPage: ({ cursor }) => loadPage(cursor),
      loadPageArtifact: async ({ sha256 }) => artifacts.get(sha256) as never,
      loadChunkArtifact: async ({ sha256 }) => artifacts.get(sha256) as never,
      persistArtifact: async (input) => {
        persisted.push(input);
        artifacts.set(input.sha256, input.artifact);
      }
    });

    const result = await handler({
      task: {
        id: "task-address-history",
        runId: "run-1",
        kind: "address_history",
        logicalKey: manifestKey,
        attempt: 1,
        checkpoint: initialCheckpoint(),
        cancellationRequestedAt: null
      },
      leaseToken: "lease-1",
      heartbeat: vi.fn(async () => undefined)
    });

    expect(result).toMatchObject({
      kind: "completed",
      artifactSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      acceptedArtifact: {
        kind: "address_history_manifest",
        schemaVersion: "1",
        value: {
          key: manifestKey,
          canonicalEventCount: 2,
          rawRowCount: 2
        }
      }
    });
    expect(loadPage.mock.calls.map(([cursor]) => cursor)).toEqual([null, "1"]);
    expect(persisted.map((item) => item.kind)).toEqual([
      "address_history_page",
      "address_history_page",
      "address_history_chunk",
      "address_history_exhaustion"
    ]);
    if (result.kind !== "completed") throw new Error("completion expected");
    const completed = result.acceptedArtifact?.value as {
      key: string;
      canonicalEventCount: number;
      rawRowCount: number;
    };
    expect(completed).toMatchObject({
      key: manifestKey,
      canonicalEventCount: 2,
      rawRowCount: 2
    });
    expect(result.artifactSha256).toBe(
      fingerprintCanonicalArtifact(completed)
    );
    expect(
      persisted.some((item) => item.sha256 === result.artifactSha256)
    ).toBe(false);
  });

  it("persists resumable progress when the provider asks to wait", async () => {
    const readyAt = "2026-07-24T00:01:00.000Z";
    const handler = createUnifiedAddressHistoryHandler({
      maxPagesThisChunk: 5,
      loadRun: async () => ({
        id: "run-1",
        analysisManifestSha256: fingerprintCanonicalArtifact(manifest),
        analysisManifest: manifest
      }),
      loadPage: async () => ({
        kind: "provider_wait",
        readyAt,
        reason: "provider_cooldown"
      }),
      loadPageArtifact: async () => {
        throw new Error("unexpected artifact load");
      },
      loadChunkArtifact: async () => {
        throw new Error("unexpected chunk load");
      },
      persistArtifact: async () => {
        throw new Error("unexpected artifact write");
      }
    });

    const result = await handler({
      task: {
        id: "task-address-history",
        runId: "run-1",
        kind: "address_history",
        logicalKey: manifestKey,
        attempt: 1,
        checkpoint: initialCheckpoint(),
        cancellationRequestedAt: null
      },
      leaseToken: "lease-1",
      heartbeat: vi.fn(async () => undefined)
    });

    expect(result).toMatchObject({
      kind: "provider_wait",
      readyAt,
      reason: "provider_cooldown",
      checkpoint: initialCheckpoint()
    });
  });

  it("keeps checkpoint size bounded by storing only the chunk-chain head", async () => {
    const artifacts = new Map<string, unknown>();
    const pages = [0, 1].map((pageIndex) => {
      const page = {
        cursor: pageIndex === 0 ? null : String(pageIndex),
        nextCursor: pageIndex === 0 ? "1" : "2",
        transfers: [
          transfer(String(pageIndex + 3).repeat(64), 80 - pageIndex, 1_753_276_500_000)
        ],
        reachedAccountCreation: false,
        provider: "tronscan" as const
      };
      return {
        kind: "page" as const,
        ...page,
        pageHash: fingerprintCanonicalArtifact({ kind: "page", ...page })
      };
    });
    const handler = createUnifiedAddressHistoryHandler({
      maxPagesThisChunk: 1,
      loadRun: async () => ({
        id: "run-1",
        analysisManifestSha256: fingerprintCanonicalArtifact(manifest),
        analysisManifest: manifest
      }),
      loadPage: async ({ cursor }) =>
        pages.find((page) => page.cursor === cursor)!,
      loadPageArtifact: async ({ sha256 }) => artifacts.get(sha256) as never,
      loadChunkArtifact: async ({ sha256 }) => artifacts.get(sha256) as never,
      persistArtifact: async (input) => {
        artifacts.set(input.sha256, input.artifact);
      }
    });
    const first = await handler({
      task: {
        id: "task-address-history",
        runId: "run-1",
        kind: "address_history",
        logicalKey: manifestKey,
        attempt: 1,
        checkpoint: initialCheckpoint(),
        cancellationRequestedAt: null
      },
      leaseToken: "lease-1",
      heartbeat: vi.fn(async () => undefined)
    });
    expect(first.kind).toBe("checkpoint");
    if (first.kind !== "checkpoint") throw new Error("checkpoint expected");

    const second = await handler({
      task: {
        id: "task-address-history",
        runId: "run-1",
        kind: "address_history",
        logicalKey: manifestKey,
        attempt: 2,
        checkpoint: first.checkpoint,
        cancellationRequestedAt: null
      },
      leaseToken: "lease-2",
      heartbeat: vi.fn(async () => undefined)
    });
    expect(second.kind).toBe("checkpoint");
    if (second.kind !== "checkpoint") throw new Error("checkpoint expected");

    const compact = second.checkpoint as Record<string, unknown>;
    expect(compact).toMatchObject({
      version: "unified-address-history-checkpoint-v2",
      chunkCount: 2,
      pageCount: 2,
      rawRowCount: 2
    });
    expect(compact.chunkHeadSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(compact).not.toHaveProperty("pageArtifactHashes");
    expect(compact.history).toMatchObject({ pageHashes: [] });
    expect(JSON.stringify(compact).length).toBeLessThan(1_000);
  });
});
