import { describe, expect, it, vi } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import { canonicalTronUsdtEventKey } from "../../src/forensics/tronAddressAllTimeIndex";
import type { IndexedTronUsdtTransfer } from "../../src/types";
import {
  addressHistoryManifestKey,
  buildAddressHistoryManifest
} from "../../src/unifiedCheck/addressHistory";
import type { AnalysisManifestV1 } from "../../src/unifiedCheck/contracts";
import {
  createUnifiedTraversalCoordinatorHandler
} from "../../src/unifiedCheck/productionTraversalCoordinator";

const SUBJECT = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const MID = "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9";
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

describe("Unified address-centric traversal coordinator", () => {
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
    let historiesReady = false;
    const ensured = vi.fn(async (_input: unknown) => {
      historiesReady = true;
    });
    const loadHistoryPage = vi.fn(async ({ sha256 }: { sha256: string }) =>
      artifacts.get(sha256) as never
    );
    const handler = createUnifiedTraversalCoordinatorHandler({
      maxAddressesThisChunk: 1,
      loadContext: async () => ({
        runId: "run-1",
        manifest,
        directEvents
      }),
      loadLabels: async ({ addresses }) => new Map(
        addresses.includes(CEX) ? [[CEX, ["cex", "Bybit"]]] : []
      ),
      ensureAddressHistories: ensured,
      loadAddressHistoryManifests: async ({ manifestKeys }) =>
        historiesReady && manifestKeys.includes(key)
          ? new Map([[key, history]])
          : new Map(),
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
    expect(ensured).toHaveBeenCalledTimes(1);
    expect(ensured.mock.calls[0]?.[0]).toMatchObject({
      runId: "run-1",
      priorityLane: "interactive",
      histories: [{ manifestKey: key, identity }]
    });

    const second = await handler({
      task: { ...baseTask, attempt: 2, checkpoint: first.checkpoint },
      leaseToken: "lease-2",
      heartbeat: vi.fn(async () => undefined)
    });
    expect(second.kind).toBe("checkpoint");
    if (second.kind !== "checkpoint") throw new Error("checkpoint expected");
    expect(JSON.stringify(second.checkpoint).length).toBeLessThan(4_096);
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
});
