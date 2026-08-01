import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import {
  canonicalTronUsdtEventKey,
  normalizeTronscanTransferForAddressIndex,
  shouldIndexCanonicalTronscanUsdtTransfer
} from "../forensics/tronAddressAllTimeIndex";
import type { RawTronscanTrc20Transfer } from "../parser/transactionParser";
import type {
  IndexedTronUsdtTransfer,
  TronAddressUsdtIndexProvider
} from "../types";
import type { AnalysisManifestV1 } from "./contracts";
import { TronWeb } from "tronweb";

const HASH = /^[0-9a-f]{64}$/u;
const RAW = /^(0|[1-9][0-9]*)$/u;

export type DirectHistoryCheckpoint = {
  readonly snapshotBlockNumber: string;
  readonly snapshotBlockHash: string;
  readonly nextCursor: string | null;
  readonly pageHashes: readonly string[];
  readonly eventCount: number;
  readonly reachedAccountCreation: boolean;
  readonly lastPageEventKeys: readonly string[];
};

export type DirectHistoryPage = {
  readonly kind: "page";
  readonly cursor: string | null;
  readonly nextCursor: string | null;
  readonly transfers: readonly RawTronscanTrc20Transfer[];
  readonly reachedAccountCreation: boolean;
  readonly provider: Exclude<TronAddressUsdtIndexProvider, "mixed">;
  readonly pageHash: string;
};

export type DirectHistoryProviderWait = {
  readonly kind: "provider_wait";
  readonly readyAt: string;
  readonly reason: string;
};

export type LoadProviderPage = (
  cursor: string | null
) => Promise<DirectHistoryPage | DirectHistoryProviderWait>;

export function initialDirectHistoryCheckpoint(
  snapshotBlockNumber: string,
  snapshotBlockHash: string
): DirectHistoryCheckpoint {
  if (!RAW.test(snapshotBlockNumber) || !HASH.test(snapshotBlockHash)) {
    throw new TypeError("unified_direct_history_invalid_snapshot");
  }
  return {
    snapshotBlockNumber,
    snapshotBlockHash,
    nextCursor: null,
    pageHashes: [],
    eventCount: 0,
    reachedAccountCreation: false,
    lastPageEventKeys: []
  };
}

function canonicalTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError("unified_direct_history_invalid_ready_at");
  }
  return value;
}

function rawBlock(transfer: RawTronscanTrc20Transfer): bigint {
  const value = (transfer as RawTronscanTrc20Transfer & { block?: unknown }).block;
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !RAW.test(String(value))
  ) {
    throw new Error("unified_direct_history_block_missing");
  }
  return BigInt(String(value));
}

function verifyPage(page: DirectHistoryPage, expectedCursor: string | null): void {
  if (page.cursor !== expectedCursor || !HASH.test(page.pageHash)) {
    throw new Error("unified_direct_history_page_identity_mismatch");
  }
  const { pageHash: _pageHash, ...content } = page;
  if (fingerprintCanonicalArtifact(content) !== page.pageHash) {
    throw new Error("unified_direct_history_page_hash_mismatch");
  }
  if (
    !page.reachedAccountCreation &&
    page.nextCursor === page.cursor
  ) {
    throw new Error("unified_direct_history_cursor_stalled");
  }
}

export async function runDirectHistoryChunk(input: {
  address: string;
  manifest: AnalysisManifestV1;
  checkpoint: DirectHistoryCheckpoint;
  maxPagesThisChunk: number;
  loadPage: LoadProviderPage;
}): Promise<{
  checkpoint: DirectHistoryCheckpoint;
  events: IndexedTronUsdtTransfer[];
  outcome: "more" | "complete" | "provider_wait";
  providerReadyAt?: string;
  providerWaitReason?: string;
}> {
  if (!TronWeb.isAddress(input.address)) {
    throw new TypeError("unified_direct_history_invalid_address");
  }
  if (
    input.manifest.confirmedBlockNumber !== input.checkpoint.snapshotBlockNumber ||
    input.manifest.confirmedBlockHash !== input.checkpoint.snapshotBlockHash ||
    !RAW.test(input.checkpoint.snapshotBlockNumber) ||
    !HASH.test(input.checkpoint.snapshotBlockHash) ||
    !Number.isSafeInteger(input.checkpoint.eventCount) ||
    input.checkpoint.eventCount < 0 ||
    input.checkpoint.pageHashes.some((hash) => !HASH.test(hash))
  ) {
    throw new Error("unified_direct_history_checkpoint_mismatch");
  }
  if (!Number.isSafeInteger(input.maxPagesThisChunk) || input.maxPagesThisChunk < 1) {
    throw new TypeError("unified_direct_history_invalid_chunk_size");
  }
  if (input.checkpoint.reachedAccountCreation) {
    return { checkpoint: input.checkpoint, events: [], outcome: "complete" };
  }

  let cursor = input.checkpoint.nextCursor;
  let eventCount = input.checkpoint.eventCount;
  let reachedAccountCreation = false;
  let lastPageEventKeys = [...input.checkpoint.lastPageEventKeys];
  const pageHashes = [...input.checkpoint.pageHashes];
  const events: IndexedTronUsdtTransfer[] = [];
  const seenThisChunk = new Set(input.checkpoint.lastPageEventKeys);

  for (let pageIndex = 0; pageIndex < input.maxPagesThisChunk; pageIndex += 1) {
    const loaded = await input.loadPage(cursor);
    if (loaded.kind === "provider_wait") {
      return {
        checkpoint: {
          ...input.checkpoint,
          nextCursor: cursor,
          pageHashes,
          eventCount,
          reachedAccountCreation,
          lastPageEventKeys
        },
        events,
        outcome: "provider_wait",
        providerReadyAt: canonicalTimestamp(loaded.readyAt),
        providerWaitReason: loaded.reason
      };
    }
    verifyPage(loaded, cursor);
    const pageEventKeys: string[] = [];
    const ordinalByTx = new Map<string, number>();
    for (const raw of loaded.transfers) {
      if (rawBlock(raw) > BigInt(input.checkpoint.snapshotBlockNumber)) {
        throw new Error("unified_direct_history_after_snapshot");
      }
      if (!shouldIndexCanonicalTronscanUsdtTransfer(raw)) continue;
      const ordinal = ordinalByTx.get(raw.transaction_id) ?? 0;
      ordinalByTx.set(raw.transaction_id, ordinal + 1);
      const normalized = normalizeTronscanTransferForAddressIndex(
        raw,
        loaded.provider,
        ordinal
      );
      const key = canonicalTronUsdtEventKey(normalized);
      pageEventKeys.push(key);
      if (seenThisChunk.has(key)) continue;
      seenThisChunk.add(key);
      events.push(normalized);
      eventCount += 1;
    }
    pageHashes.push(loaded.pageHash);
    // ponytail: cursor APIs overlap adjacent pages; persist canonical keys in the
    // event store if a future provider can replay non-adjacent pages after restart.
    lastPageEventKeys = [...new Set(pageEventKeys)].sort();
    cursor = loaded.nextCursor;
    reachedAccountCreation = loaded.reachedAccountCreation;
    if (reachedAccountCreation) {
      return {
        checkpoint: {
          snapshotBlockNumber: input.checkpoint.snapshotBlockNumber,
          snapshotBlockHash: input.checkpoint.snapshotBlockHash,
          nextCursor: cursor,
          pageHashes,
          eventCount,
          reachedAccountCreation: true,
          lastPageEventKeys
        },
        events,
        outcome: "complete"
      };
    }
  }

  return {
    checkpoint: {
      snapshotBlockNumber: input.checkpoint.snapshotBlockNumber,
      snapshotBlockHash: input.checkpoint.snapshotBlockHash,
      nextCursor: cursor,
      pageHashes,
      eventCount,
      reachedAccountCreation: false,
      lastPageEventKeys
    },
    events,
    outcome: "more"
  };
}
