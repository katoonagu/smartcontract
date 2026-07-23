import { describe, expect, it } from "vitest";
import type { RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { AnalysisManifestV1 } from "../../src/unifiedCheck/contracts";
import {
  initialDirectHistoryCheckpoint,
  runDirectHistoryChunk,
  type DirectHistoryPage
} from "../../src/unifiedCheck/directHistory";
import { fingerprintCanonicalJson } from "../../src/forensics/canonicalJson";

const ADDRESS = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const SNAPSHOT_HASH = "a".repeat(64);
const manifest: AnalysisManifestV1 = {
  version: "analysis-manifest-v1",
  schemaVersion: 1,
  runId: "run-direct",
  requestHash: "b".repeat(64),
  snapshotHash: "c".repeat(64),
  chain: "tron",
  subjectAddress: ADDRESS,
  confirmedBlockNumber: "1000",
  confirmedBlockHash: SNAPSHOT_HASH,
  confirmedBlockTimestamp: "2026-07-23T12:53:54.000Z",
  labelDatasetSha256: "d".repeat(64),
  scoringPolicyVersion: "scoring-signal-matrix-v4",
  attributionPolicyVersion: "selected-attribution-policy-v1",
  traversalPolicyVersion: "snapshot-closure-v1",
  runtimeCommit: "candidate",
  databaseSchemaVersion: 33,
  paginationCutoffBlockNumber: "1000",
  paginationCutoffBlockHash: SNAPSHOT_HASH,
  branchArtifactHashes: {}
};

function transfer(id: number, eventIndex = id, block = 100 + id): RawTronscanTrc20Transfer {
  return {
    transaction_id: id.toString(16).padStart(64, "0"),
    from_address: "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP",
    to_address: ADDRESS,
    quant: "1000000",
    block_ts: 1_700_000_000_000 + id,
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    event_type: "Transfer",
    event_index: eventIndex,
    block
  } as RawTronscanTrc20Transfer;
}

function page(input: Omit<DirectHistoryPage, "pageHash">): DirectHistoryPage {
  return { ...input, pageHash: fingerprintCanonicalJson(input) };
}

describe("Unified snapshot-bounded direct history", () => {
  it("consumes 500 pages through account creation and deduplicates one-event overlaps", async () => {
    const pages = Array.from({ length: 500 }, (_, index) =>
      page({
        kind: "page" as const,
        cursor: index === 0 ? null : String(index),
        nextCursor: index === 499 ? null : String(index + 1),
        transfers: index === 499 ? [] : [transfer(index), transfer(index + 1)],
        reachedAccountCreation: index === 499,
        provider: "tronscan" as const
      })
    );
    let calls = 0;
    const result = await runDirectHistoryChunk({
      address: ADDRESS,
      manifest,
      checkpoint: initialDirectHistoryCheckpoint("1000", SNAPSHOT_HASH),
      maxPagesThisChunk: 1_000,
      loadPage: async (cursor) => {
        const next = pages[calls++]!;
        expect(next.cursor).toBe(cursor);
        return next;
      }
    });
    expect(result.outcome).toBe("complete");
    expect(calls).toBe(500);
    expect(result.events).toHaveLength(500);
    expect(result.checkpoint.pageHashes).toHaveLength(500);
    expect(result.checkpoint.eventCount).toBe(500);
    expect(result.checkpoint.reachedAccountCreation).toBe(true);
  });

  it("rejects events after the confirmed snapshot and preserves distinct event indexes", async () => {
    const distinct = page({
      kind: "page" as const,
      cursor: null,
      nextCursor: null,
      transfers: [transfer(1, 1), transfer(1, 2)],
      reachedAccountCreation: true,
      provider: "tronscan" as const
    });
    const accepted = await runDirectHistoryChunk({
      address: ADDRESS,
      manifest,
      checkpoint: initialDirectHistoryCheckpoint("1000", SNAPSHOT_HASH),
      maxPagesThisChunk: 1,
      loadPage: async () => distinct
    });
    expect(accepted.events).toHaveLength(2);

    await expect(runDirectHistoryChunk({
      address: ADDRESS,
      manifest,
      checkpoint: initialDirectHistoryCheckpoint("1000", SNAPSHOT_HASH),
      maxPagesThisChunk: 1,
      loadPage: async () => page({
        kind: "page",
        cursor: null,
        nextCursor: null,
        transfers: [transfer(2, 2, 1001)],
        reachedAccountCreation: true,
        provider: "tronscan"
      })
    })).rejects.toThrow("unified_direct_history_after_snapshot");
  });

  it("returns provider_wait without pretending history is complete", async () => {
    const checkpoint = initialDirectHistoryCheckpoint("1000", SNAPSHOT_HASH);
    const result = await runDirectHistoryChunk({
      address: ADDRESS,
      manifest,
      checkpoint,
      maxPagesThisChunk: 10,
      loadPage: async () => ({
        kind: "provider_wait",
        readyAt: "2026-07-23T13:01:00.000Z",
        reason: "all_keys_cooling"
      })
    });
    expect(result.outcome).toBe("provider_wait");
    expect(result.checkpoint).toEqual(checkpoint);
    expect(result.checkpoint.reachedAccountCreation).toBe(false);
  });

  it("resumes from a checkpoint cursor without repeating the page overlap", async () => {
    const first = await runDirectHistoryChunk({
      address: ADDRESS,
      manifest,
      checkpoint: initialDirectHistoryCheckpoint("1000", SNAPSHOT_HASH),
      maxPagesThisChunk: 1,
      loadPage: async () => page({
        kind: "page",
        cursor: null,
        nextCursor: "next",
        transfers: [transfer(1), transfer(2)],
        reachedAccountCreation: false,
        provider: "tronscan"
      })
    });
    expect(first.outcome).toBe("more");
    const second = await runDirectHistoryChunk({
      address: ADDRESS,
      manifest,
      checkpoint: first.checkpoint,
      maxPagesThisChunk: 1,
      loadPage: async (cursor) => {
        expect(cursor).toBe("next");
        return page({
          kind: "page",
          cursor: "next",
          nextCursor: null,
          transfers: [transfer(2), transfer(3)],
          reachedAccountCreation: true,
          provider: "tronscan"
        });
      }
    });
    expect(second.outcome).toBe("complete");
    expect(second.events.map((event) => event.txHash)).toEqual([
      transfer(3).transaction_id
    ]);
    expect(second.checkpoint.eventCount).toBe(3);
  });
});
