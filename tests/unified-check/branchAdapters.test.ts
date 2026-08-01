import { describe, expect, it, vi } from "vitest";
import type { IndexedTronUsdtTransfer } from "../../src/types";
import {
  runUnifiedDeepBranch,
  runUnifiedFastBranch,
  runUnifiedWhereBranch,
  type UnifiedBranchAnalysis,
  type UnifiedBranchContext
} from "../../src/unifiedCheck/branchAdapters";
import type { AnalysisManifestV1 } from "../../src/unifiedCheck/contracts";

const ADDRESS = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const manifest: AnalysisManifestV1 = {
  version: "analysis-manifest-v1",
  schemaVersion: 1,
  runId: "run-1",
  requestHash: "a".repeat(64),
  snapshotHash: "b".repeat(64),
  chain: "tron",
  subjectAddress: ADDRESS,
  confirmedBlockNumber: "84713573",
  confirmedBlockHash: "c".repeat(64),
  confirmedBlockTimestamp: "2026-07-23T12:53:54.000Z",
  labelDatasetSha256: "d".repeat(64),
  scoringPolicyVersion: "scoring-signal-matrix-v4",
  attributionPolicyVersion: "selected-attribution-policy-v1",
  traversalPolicyVersion: "snapshot-closure-v1",
  runtimeCommit: "candidate",
  databaseSchemaVersion: 33,
  paginationCutoffBlockNumber: "84713573",
  paginationCutoffBlockHash: "c".repeat(64),
  branchArtifactHashes: {}
};
const event = {
  txHash: "e".repeat(64),
  eventIndex: 1,
  tokenContract: "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj"
} as unknown as IndexedTronUsdtTransfer;

function context(
  directEvents: readonly IndexedTronUsdtTransfer[] = [event]
): UnifiedBranchContext {
  return {
    runId: manifest.runId,
    manifest,
    directHistoryArtifactSha256: "f".repeat(64),
    directEvents,
    labelsDatasetSha256: manifest.labelDatasetSha256,
    deliveryAuthority: false
  };
}

const analysis: UnifiedBranchAnalysis = {
  evidence: [{ kind: "direct_transfer" }],
  facts: [{ kind: "service_relation" }],
  patterns: [{ kind: "fan_in" }],
  boundaries: [{ kind: "identified_service" }],
  roles: [{ role: "subject" }],
  candidates: [{ kind: "unknown_with_correlated_pattern" }],
  diagnosticScore: { authority: "diagnostic", value: 35, source: "legacy-fast" }
};

describe("Unified evidence-only branches", () => {
  it("binds Fast, Where and Deep to one snapshot and shared direct index", async () => {
    const analyze = vi.fn(async () => analysis);
    const shared = context();
    const results = await Promise.all([
      runUnifiedFastBranch({ context: shared, analyze }),
      runUnifiedWhereBranch({ context: shared, analyze }),
      runUnifiedDeepBranch({ context: shared, analyze })
    ]);
    expect(analyze).toHaveBeenCalledTimes(3);
    expect(new Set(results.map((result) => result.snapshotHash))).toEqual(
      new Set([manifest.snapshotHash])
    );
    expect(new Set(results.map((result) => result.directEventIndexHash)).size)
      .toBe(1);
    expect(new Set(results.map((result) => result.directHistoryArtifactSha256)))
      .toEqual(new Set(["f".repeat(64)]));
    for (const result of results) {
      expect(result.deliveryAuthority).toBe(false);
      expect(result).not.toHaveProperty("telegramPayload");
      expect(result).not.toHaveProperty("deliveryIntent");
      expect(result).not.toHaveProperty("finalScore");
      expect(result.analysis.diagnosticScore?.authority).toBe("diagnostic");
    }
  });

  it("marks only provenance NOT_APPLICABLE for no-USDT and preserves approval evidence", async () => {
    const dangerousApproval: UnifiedBranchAnalysis = {
      ...analysis,
      evidence: [{ kind: "dangerous_approval", spender: "malicious-contract" }],
      candidates: [{ kind: "dangerous_approval_without_debit" }]
    };
    const result = await runUnifiedWhereBranch({
      context: context([]),
      analyze: async () => dangerousApproval
    });
    expect(result.scopeStatus).toEqual({
      provenance: "NOT_APPLICABLE",
      security: "COMPLETED"
    });
    expect(result.analysis.evidence).toEqual(dangerousApproval.evidence);
    expect(result.analysis.candidates).toEqual(dangerousApproval.candidates);
  });

  it("cannot convert branch failure or forbidden output into a REVIEW result", async () => {
    await expect(runUnifiedDeepBranch({
      context: context(),
      analyze: async () => {
        throw new Error("provider_failed");
      }
    })).rejects.toThrow("provider_failed");
    await expect(runUnifiedFastBranch({
      context: context(),
      analyze: async () => ({
        ...analysis,
        finalScore: 50
      } as UnifiedBranchAnalysis)
    })).rejects.toThrow("unified_branch_analysis_invalid");
  });
});
