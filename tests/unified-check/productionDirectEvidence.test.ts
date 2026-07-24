import { describe, expect, it } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import {
  createUnifiedDirectEvidenceHandler,
  reviveUnifiedDirectHardEvidence
} from "../../src/unifiedCheck/productionDirectEvidence";

describe("Unified direct hard evidence task", () => {
  it("persists deterministic evidence independently from traversal", async () => {
    const persisted: Array<{ kind: string; sha256: string; artifact: unknown }> =
      [];
    const handler = createUnifiedDirectEvidenceHandler({
      loadContext: async () => ({
        runId: "run-1",
        snapshotHash: "a".repeat(64),
        directHistoryArtifactSha256: "b".repeat(64)
      }),
      loadEvidence: async () => ({
        blacklistedAtEventKeys: new Set(["tx:2", "tx:1"]),
        confirmedVictimDebitEventKeys: new Set(["victim:1"]),
        dangerousApprovalIds: new Set(["spender:1"])
      }),
      persistArtifact: async (input) => {
        persisted.push(input);
      }
    });

    const result = await handler({
      task: {
        id: "task-deep-direct",
        runId: "run-1",
        kind: "deep_direct",
        attempt: 1,
        checkpoint: {},
        cancellationRequestedAt: null
      },
      leaseToken: "lease-1",
      heartbeat: async () => undefined
    });

    expect(result.kind).toBe("completed");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      kind: "deep_direct_evidence",
      sha256: fingerprintCanonicalArtifact(persisted[0]?.artifact)
    });
    expect(reviveUnifiedDirectHardEvidence(persisted[0]!.artifact))
      .toEqual({
        blacklistedAtEventKeys: new Set(["tx:1", "tx:2"]),
        confirmedVictimDebitEventKeys: new Set(["victim:1"]),
        dangerousApprovalIds: new Set(["spender:1"])
      });
  });
});
