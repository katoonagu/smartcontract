import { describe, expect, it, vi } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import type { RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import type { IndexedTronUsdtTransfer } from "../../src/types";
import {
  createUnifiedTraversalHandler
} from "../../src/unifiedCheck/productionTraversal";
import type { AnalysisManifestV1 } from "../../src/unifiedCheck/contracts";
import {
  DENSE_SUBJECT,
  denseTraversalFixture
} from "../fixtures/unified-check/denseTraversal";

const SUBJECT = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const MID = "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9";
const CEX = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
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

function indexed(): IndexedTronUsdtTransfer {
  return {
    txHash: "2".repeat(64),
    blockNumber: 90,
    blockTimestamp: new Date("2026-07-23T12:00:00.000Z"),
    eventIndex: 0,
    fromAddress: MID,
    toAddress: SUBJECT,
    amountRaw: "10000000",
    method: "transfer",
    callerAddress: null,
    contractRet: "SUCCESS",
    confirmed: true
  };
}

function raw(): RawTronscanTrc20Transfer {
  return {
    transaction_id: "3".repeat(64),
    from_address: CEX,
    to_address: MID,
    quant: "10000000",
    block: 80,
    block_ts: Date.parse("2026-07-23T11:00:00.000Z"),
    confirmed: true,
    contractRet: "SUCCESS",
    contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
  } as RawTronscanTrc20Transfer;
}

describe("Unified production finite traversal", () => {
  it("resumes by provider page and closes only at an evidenced service boundary", async () => {
    const artifacts = new Map<string, unknown>();
    const loadPage = vi.fn(async ({ address, cursor }: {
      address: string;
      cursor: string | null;
    }) => {
      expect(address).toBe(MID);
      expect(cursor).toBeNull();
      const content = {
        kind: "page" as const,
        cursor,
        nextCursor: null,
        transfers: [raw()],
        reachedAccountCreation: true,
        provider: "tronscan" as const
      };
      return {
        ...content,
        pageHash: fingerprintCanonicalArtifact(content)
      };
    });
    const handler = createUnifiedTraversalHandler({
      loadContext: async () => ({
        runId: "run-1",
        manifest,
        directEvents: [indexed()]
      }),
      loadPage,
      loadLabels: async (addresses) => new Map(
        addresses.includes(CEX) ? [[CEX, ["cex", "Bybit"]]] : []
      ),
      loadPageArtifact: async ({ sha256 }) =>
        artifacts.get(sha256) as never,
      persistArtifact: async (input) => {
        artifacts.set(input.sha256, input.artifact);
      }
    });
    const heartbeat = vi.fn(async () => undefined);
    const first = await handler({
      task: {
        id: "task-traversal",
        runId: "run-1",
        kind: "traversal",
        attempt: 1,
        checkpoint: {},
        cancellationRequestedAt: null
      },
      heartbeat
    });
    expect(first.kind).toBe("checkpoint");
    if (first.kind !== "checkpoint") return;
    const second = await handler({
      task: {
        id: "task-traversal",
        runId: "run-1",
        kind: "traversal",
        attempt: 2,
        checkpoint: first.checkpoint,
        cancellationRequestedAt: null
      },
      heartbeat
    });
    expect(second.kind).toBe("completed");
    if (second.kind !== "completed") return;
    const completed = artifacts.get(second.artifactSha256) as {
      closed: boolean;
      frontier: unknown[];
      terminalStates: Array<{
        address: string;
        reason: string;
        evidenceHash: string;
      }>;
      backwardCoverage: { traceCoverage: number };
    };
    expect(completed.closed).toBe(true);
    expect(completed.frontier).toEqual([]);
    expect(completed.terminalStates).toEqual([
      expect.objectContaining({
        address: CEX,
        reason: "identified_service_boundary",
        evidenceHash: expect.stringMatching(/^[0-9a-f]{64}$/u)
      })
    ]);
    expect(completed.backwardCoverage.traceCoverage).toBe(100);
    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });

  it("reports amount-continuity residual as untraced instead of traced", async () => {
    const artifacts = new Map<string, unknown>();
    const direct = { ...indexed(), amountRaw: "100" };
    const upstream = { ...raw(), quant: "40" };
    const handler = createUnifiedTraversalHandler({
      loadContext: async () => ({
        runId: "run-1",
        manifest,
        directEvents: [direct]
      }),
      loadPage: async ({ address, cursor }) => {
        expect(address).toBe(MID);
        expect(cursor).toBeNull();
        const content = {
          kind: "page" as const,
          cursor,
          nextCursor: null,
          transfers: [upstream],
          reachedAccountCreation: true,
          provider: "tronscan" as const
        };
        return {
          ...content,
          pageHash: fingerprintCanonicalArtifact(content)
        };
      },
      loadLabels: async (addresses) => new Map(
        addresses.includes(CEX) ? [[CEX, ["cex", "Bybit"]]] : []
      ),
      loadPageArtifact: async ({ sha256 }) =>
        artifacts.get(sha256) as never,
      persistArtifact: async (input) => {
        artifacts.set(input.sha256, input.artifact);
      }
    });
    const first = await handler({
      task: {
        id: "task-traversal",
        runId: "run-1",
        kind: "traversal",
        attempt: 1,
        checkpoint: {},
        cancellationRequestedAt: null
      },
      heartbeat: async () => undefined
    });
    expect(first.kind).toBe("checkpoint");
    if (first.kind !== "checkpoint") return;
    const second = await handler({
      task: {
        id: "task-traversal",
        runId: "run-1",
        kind: "traversal",
        attempt: 2,
        checkpoint: first.checkpoint,
        cancellationRequestedAt: null
      },
      heartbeat: async () => undefined
    });
    expect(second.kind).toBe("completed");
    if (second.kind !== "completed") return;
    expect(artifacts.get(second.artifactSha256)).toMatchObject({
      terminalRaw: "40",
      residualRaw: "60",
      backwardCoverage: {
        traceCoverage: 40,
        identifiedCoverage: 40,
        untracedShare: 60
      }
    });
  });

  it("merges dense bidirectional fan-in/out before expansion", async () => {
    const fixture = denseTraversalFixture();
    const artifacts = new Map<string, unknown>();
    const loadedAddresses: string[] = [];
    const denseManifest: AnalysisManifestV1 = {
      ...manifest,
      subjectAddress: DENSE_SUBJECT
    };
    const handler = createUnifiedTraversalHandler({
      loadContext: async () => ({
        runId: "run-1",
        manifest: denseManifest,
        directEvents: fixture.directEvents
      }),
      loadPage: async ({ address, cursor }) => {
        expect(cursor).toBeNull();
        loadedAddresses.push(address);
        const content = {
          kind: "page" as const,
          cursor,
          nextCursor: null,
          transfers: [...(fixture.histories.get(address) ?? [])],
          reachedAccountCreation: true,
          provider: "tronscan" as const
        };
        return {
          ...content,
          pageHash: fingerprintCanonicalArtifact(content)
        };
      },
      loadLabels: async (addresses) => new Map(
        addresses.flatMap((address) => {
          const labels = fixture.boundaryLabels.get(address);
          return labels ? [[address, labels] as const] : [];
        })
      ),
      loadPageArtifact: async ({ sha256 }) =>
        artifacts.get(sha256) as never,
      persistArtifact: async (input) => {
        artifacts.set(input.sha256, input.artifact);
      }
    });
    let checkpoint: unknown = {};
    let completedHash: string | null = null;
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const result = await handler({
        task: {
          id: "task-traversal",
          runId: "run-1",
          kind: "traversal",
          attempt,
          checkpoint,
          cancellationRequestedAt: null
        },
        heartbeat: async () => undefined
      });
      if (result.kind === "completed") {
        completedHash = result.artifactSha256;
        break;
      }
      expect(result.kind).toBe("checkpoint");
      if (result.kind !== "checkpoint") break;
      checkpoint = result.checkpoint;
    }
    expect(completedHash).not.toBeNull();
    const completed = artifacts.get(completedHash!) as {
      eligibleEventCount: number;
      expandedStateCount: number;
      allocatedInputRaw: string;
      terminalRaw: string;
      residualRaw: string;
      closed: boolean;
    };
    expect(completed).toMatchObject({
      eligibleEventCount: fixture.uniqueTraversalEventCount,
      expandedStateCount: fixture.expandedStateCount,
      allocatedInputRaw: "1600",
      terminalRaw: "1600",
      residualRaw: "0",
      closed: true
    });
    expect(new Set(loadedAddresses).size)
      .toBe(fixture.providerAddressCount);
    expect(loadedAddresses).toHaveLength(fixture.providerAddressCount);
  });
});
