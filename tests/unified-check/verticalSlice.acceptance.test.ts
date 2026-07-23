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
  snapshotHash: "b".repeat(64),
  branchArtifactHashes: {
    fast: "e".repeat(64),
    deep: "f".repeat(64),
    where: "0".repeat(64)
  }
} as const;

const run: AnalysisRunRecord = {
  id: "run-1",
  analysisKeySha256: "a".repeat(64),
  subjectAddress: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
  runPurpose: "synthetic_test",
  sideEffectPolicy: "isolated",
  status: "RUNNING",
  snapshotHash: "b".repeat(64),
  analysisManifestSha256: fingerprintCanonicalJson(analysisManifest),
  analysisManifest
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
