import { describe, expect, it } from "vitest";
import { fingerprintCanonicalJson } from "../../src/forensics/canonicalJson";
import {
  completeMinimalUnifiedCheck,
  type MinimalBranchResult
} from "../../src/unifiedCheck/orchestrator";
import type { AnalysisRunRecord } from "../../src/unifiedCheck/requestService";

const analysisManifest = {
  version: "analysis-manifest-v1",
  schemaVersion: 1,
  runId: "run-1",
  requestHash: "d".repeat(64),
  snapshotHash: "",
  chain: "tron",
  subjectAddress: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
  confirmedBlockNumber: "84713573",
  confirmedBlockHash: "b".repeat(64),
  confirmedBlockTimestamp: "2026-07-23T12:53:54.000Z",
  labelDatasetSha256: "c".repeat(64),
  scoringPolicyVersion: "scoring-signal-matrix-v4",
  attributionPolicyVersion: "selected-attribution-policy-v1",
  traversalPolicyVersion: "snapshot-closure-v1",
  runtimeCommit: "candidate",
  databaseSchemaVersion: 33,
  paginationCutoffBlockNumber: "84713573",
  paginationCutoffBlockHash: "b".repeat(64),
  branchArtifactHashes: {
    fast: "e".repeat(64),
    deep: "f".repeat(64),
    where: "0".repeat(64)
  }
} as const;

const snapshot = {
  version: "confirmed-wallet-snapshot-v1",
  schemaVersion: 1,
  chain: "tron",
  subjectAddress: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
  confirmedBlockNumber: "84713573",
  confirmedBlockHash: "b".repeat(64),
  timestamp: "2026-07-23T12:53:54.000Z",
  balances: {
    usdtRaw: "0",
    trxSun: "0",
    source: "fixture",
    consistency: "exact"
  }
} as const;
const snapshotHash = fingerprintCanonicalJson(snapshot);
const boundManifest = { ...analysisManifest, snapshotHash };

const run: AnalysisRunRecord = {
  id: "run-1",
  analysisKeySha256: "a".repeat(64),
  subjectAddress: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
  runPurpose: "synthetic_test",
  sideEffectPolicy: "isolated",
  status: "RUNNING",
  snapshotHash,
  snapshot,
  analysisManifestSha256: fingerprintCanonicalJson(boundManifest),
  analysisManifest: boundManifest
};

const branches: MinimalBranchResult[] = (["fast", "deep", "where"] as const).map(
  (branchId, index) => ({
    branchId,
    attemptId: `attempt-${branchId}`,
    inputHash: Object.values(run.analysisManifest.branchArtifactHashes)[index]!,
    status: "COMPLETED",
    output: { version: `${branchId}-fake-v1`, findings: [] },
    createdAt: `2026-07-23T13:00:0${index}.000Z`
  })
);

describe("Unified Check B0 vertical slice", () => {
  it("builds one completed, hash-bound neutral report without Telegram", async () => {
    let committed = false;
    const result = await completeMinimalUnifiedCheck({
      run,
      branches,
      commit: async (candidate) => {
        expect(candidate.status).toBe("COMPLETED");
        committed = true;
      }
    });

    expect(committed).toBe(true);
    expect(result.status).toBe("COMPLETED");
    expect(result.report.score).toBe(0);
    expect(result.report.decision).toBe("ACCEPTABLE");
    expect(result.closure.closed).toBe(true);
    expect(result.frontier).toEqual([]);
    expect(result.delivery).toBeNull();
    expect(Object.keys(result.manifest.branchArtifactHashes).sort())
      .toEqual(["deep", "fast", "where"]);
    for (const [hash, artifact] of result.artifacts) {
      expect(result.fingerprint(artifact)).toBe(hash);
    }
    expect(result.artifacts.has(result.evidence.analysisManifestHash)).toBe(true);
    expect(result.artifacts.has(result.scoring.evidenceBundleHash)).toBe(true);
    expect(result.artifacts.has(result.report.scoringBundleHash)).toBe(true);
  });
});
