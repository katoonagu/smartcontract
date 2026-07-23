import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import type { ChildAttemptArtifactV1 } from "./contracts";
import {
  runUnifiedDeepBranch,
  runUnifiedFastBranch,
  runUnifiedWhereBranch,
  type UnifiedBranchContext
} from "./branchAdapters";
import {
  buildUnifiedProductionEvidence,
  type UnifiedProductionHardEvidence
} from "./productionEvidence";
import type { UnifiedChunkHandler } from "./worker";
import { UnifiedProviderWaitError } from "./requestService";
import type {
  UnifiedTraversalArtifactV1
} from "./productionTraversal";

type ProductionBranchContext = UnifiedBranchContext & {
  readonly knownCounterparties: ReadonlyMap<string, readonly string[]>;
  readonly hardEvidence: UnifiedProductionHardEvidence;
  readonly traversal: UnifiedTraversalArtifactV1;
};

type BranchId = "fast" | "where" | "deep";

const RUNNERS = {
  fast: runUnifiedFastBranch,
  where: runUnifiedWhereBranch,
  deep: runUnifiedDeepBranch
} as const;

export function createUnifiedProductionBranchHandlers(input: {
  now(): Date;
  createId(): string;
  loadContext(
    runId: string,
    branchId: BranchId
  ): Promise<ProductionBranchContext>;
  previousAttemptHash(taskId: string): Promise<string | null>;
  persistArtifact(input: {
    runId: string;
    kind: `${BranchId}_branch_output` | "child_attempt";
    sha256: string;
    artifact: unknown;
  }): Promise<void>;
}): Record<BranchId, UnifiedChunkHandler> {
  return Object.fromEntries(
    (["fast", "where", "deep"] as const).map((branchId) => {
      const handler: UnifiedChunkHandler = async ({ task, heartbeat }) => {
        if (task.kind !== branchId) {
          return {
            kind: "blocked",
            reason: `unified_branch_kind_mismatch:${branchId}`
          };
        }
        let context: ProductionBranchContext;
        try {
          context = await input.loadContext(task.runId, branchId);
        } catch (error) {
          if (error instanceof UnifiedProviderWaitError) {
            return {
              kind: "provider_wait",
              readyAt: error.readyAt,
              reason: error.message
            };
          }
          throw error;
        }
        const evidence = buildUnifiedProductionEvidence({
          subjectAddress: context.manifest.subjectAddress,
          snapshotBlock: context.manifest.confirmedBlockNumber,
          events: context.directEvents,
          knownCounterparties: context.knownCounterparties,
          hardEvidence: context.hardEvidence,
          traversal: context.traversal
        });
        const output = await RUNNERS[branchId]({
          context,
          analyze: async () => evidence[branchId]
        });
        await heartbeat();
        const outputHash = fingerprintCanonicalArtifact(output);
        await input.persistArtifact({
          runId: task.runId,
          kind: `${branchId}_branch_output`,
          sha256: outputHash,
          artifact: output
        });
        const attemptId = input.createId();
        const attempt: ChildAttemptArtifactV1 = {
          version: "child-attempt-artifact-v1",
          schemaVersion: 1,
          runId: task.runId,
          branchId,
          attemptId,
          previousAttemptHash: await input.previousAttemptHash(task.id),
          inputHash: context.manifest.branchArtifactHashes[branchId],
          outputHash,
          status: "COMPLETED",
          createdAt: input.now().toISOString()
        };
        const attemptHash = fingerprintCanonicalArtifact(attempt);
        await input.persistArtifact({
          runId: task.runId,
          kind: "child_attempt",
          sha256: attemptHash,
          artifact: attempt
        });
        return {
          kind: "completed",
          attemptId,
          artifactSha256: attemptHash
        };
      };
      return [branchId, handler];
    })
  ) as Record<BranchId, UnifiedChunkHandler>;
}
