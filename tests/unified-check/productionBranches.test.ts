import { describe, expect, it } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import {
  createUnifiedProductionBranchHandlers
} from "../../src/unifiedCheck/productionBranches";
import type { AnalysisManifestV1 } from "../../src/unifiedCheck/contracts";
import type { IndexedTronUsdtTransfer } from "../../src/types";
import {
  buildTraversalCoverage
} from "../../src/unifiedCheck/traversal";

const ADDRESS = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const manifest = {
  version: "analysis-manifest-v1",
  schemaVersion: 1,
  runId: "run-1",
  requestHash: "a".repeat(64),
  snapshotHash: "b".repeat(64),
  chain: "tron",
  subjectAddress: ADDRESS,
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
} as AnalysisManifestV1;

describe("Unified production branch handlers", () => {
  it("persists evidence-only output and an immutable child attempt", async () => {
    const artifacts: Array<{ kind: string; sha256: string; artifact: unknown }> = [];
    const handlers = createUnifiedProductionBranchHandlers({
      now: () => new Date("2026-07-23T13:01:00.000Z"),
      createId: () => "attempt-fast",
      loadContext: async () => ({
        runId: "run-1",
        manifest,
        directHistoryArtifactSha256: "2".repeat(64),
        directEvents: [] as IndexedTronUsdtTransfer[],
        labelsDatasetSha256: manifest.labelDatasetSha256,
        deliveryAuthority: false,
        knownCounterparties: new Map(),
        hardEvidence: {},
        traversal: {
          version: "unified-traversal-artifact-v1",
          schemaVersion: 1,
          runId: "run-1",
          analysisManifestHash: fingerprintCanonicalArtifact(manifest),
          snapshotHash: manifest.snapshotHash,
          visitedStates: [],
          frontier: [],
          terminalStates: [],
          supersededStateIds: [],
          eligibleEventIds: [],
          eligibleEventCount: 0,
          directionCount: 0,
          fundingEpisodeCount: 0,
          expandedStateCount: 0,
          allocatedInputRaw: "0",
          terminalRaw: "0",
          residualRaw: "0",
          backwardCoverage: buildTraversalCoverage({
            selectedAmountRaw: "0",
            tracedAmountRaw: "0",
            identifiedAmountRaw: "0",
            unknownBoundaryRaw: "0"
          }),
          forwardCoverage: buildTraversalCoverage({
            selectedAmountRaw: "0",
            tracedAmountRaw: "0",
            identifiedAmountRaw: "0",
            unknownBoundaryRaw: "0"
          }),
          closed: true
        }
      }),
      previousAttemptHash: async () => null,
      persistArtifact: async (input) => {
        artifacts.push(input);
      }
    });

    const result = await handlers.fast!({
      task: {
        id: "task-fast",
        runId: "run-1",
        kind: "fast",
        attempt: 1,
        checkpoint: {},
        cancellationRequestedAt: null
      },
      heartbeat: async () => undefined
    });

    expect(result).toMatchObject({
      kind: "completed",
      attemptId: "attempt-fast"
    });
    expect(artifacts.map((item) => item.kind)).toEqual([
      "fast_branch_output",
      "child_attempt"
    ]);
    expect(artifacts[0]?.sha256).toBe(
      fingerprintCanonicalArtifact(artifacts[0]?.artifact)
    );
    expect(artifacts[1]?.artifact).toMatchObject({
      version: "child-attempt-artifact-v1",
      runId: "run-1",
      branchId: "fast",
      previousAttemptHash: null,
      outputHash: artifacts[0]?.sha256,
      status: "COMPLETED"
    });
  });
});
