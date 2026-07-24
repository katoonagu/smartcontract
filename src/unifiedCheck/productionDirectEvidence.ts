import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import type { UnifiedProductionHardEvidence } from "./productionEvidence";
import { UnifiedProviderWaitError } from "./requestService";
import type { UnifiedChunkHandler } from "./worker";

export type UnifiedDirectHardEvidenceArtifactV1 = {
  readonly version: "unified-direct-hard-evidence-v1";
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly snapshotHash: string;
  readonly directHistoryArtifactSha256: string;
  readonly blacklistedAtEventKeys: readonly string[];
  readonly confirmedVictimDebitEventKeys: readonly string[];
  readonly dangerousApprovalIds: readonly string[];
};

function sorted(values: ReadonlySet<string> | undefined): string[] {
  return [...new Set(values ?? [])].sort();
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length > 0);
}

export function reviveUnifiedDirectHardEvidence(
  value: unknown
): UnifiedProductionHardEvidence {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("unified_direct_hard_evidence_invalid");
  }
  const artifact = value as Partial<UnifiedDirectHardEvidenceArtifactV1>;
  if (
    artifact.version !== "unified-direct-hard-evidence-v1" ||
    artifact.schemaVersion !== 1 ||
    !stringArray(artifact.blacklistedAtEventKeys) ||
    !stringArray(artifact.confirmedVictimDebitEventKeys) ||
    !stringArray(artifact.dangerousApprovalIds)
  ) {
    throw new Error("unified_direct_hard_evidence_invalid");
  }
  return {
    blacklistedAtEventKeys: new Set(artifact.blacklistedAtEventKeys),
    confirmedVictimDebitEventKeys:
      new Set(artifact.confirmedVictimDebitEventKeys),
    dangerousApprovalIds: new Set(artifact.dangerousApprovalIds)
  };
}

export function createUnifiedDirectEvidenceHandler(input: {
  loadContext(runId: string): Promise<{
    runId: string;
    snapshotHash: string;
    directHistoryArtifactSha256: string;
  }>;
  loadEvidence(args: {
    runId: string;
    taskId: string;
    leaseToken: string;
    attempt: number;
    heartbeat(): Promise<void>;
  }): Promise<UnifiedProductionHardEvidence>;
  persistArtifact(args: {
    runId: string;
    kind: "deep_direct_evidence";
    sha256: string;
    artifact: UnifiedDirectHardEvidenceArtifactV1;
  }): Promise<void>;
}): UnifiedChunkHandler {
  return async ({ task, leaseToken, heartbeat }) => {
    if (task.kind !== "deep_direct") {
      return {
        kind: "blocked",
        reason: "unified_direct_hard_evidence_kind_invalid"
      };
    }
    const context = await input.loadContext(task.runId);
    if (
      context.runId !== task.runId ||
      !/^[0-9a-f]{64}$/u.test(context.snapshotHash) ||
      !/^[0-9a-f]{64}$/u.test(context.directHistoryArtifactSha256)
    ) {
      return {
        kind: "blocked",
        reason: "unified_direct_hard_evidence_context_invalid"
      };
    }
    let evidence: UnifiedProductionHardEvidence;
    try {
      evidence = await input.loadEvidence({
        runId: task.runId,
        taskId: task.id,
        leaseToken,
        attempt: task.attempt,
        heartbeat
      });
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
    const artifact: UnifiedDirectHardEvidenceArtifactV1 = {
      version: "unified-direct-hard-evidence-v1",
      schemaVersion: 1,
      runId: task.runId,
      snapshotHash: context.snapshotHash,
      directHistoryArtifactSha256: context.directHistoryArtifactSha256,
      blacklistedAtEventKeys: sorted(evidence.blacklistedAtEventKeys),
      confirmedVictimDebitEventKeys:
        sorted(evidence.confirmedVictimDebitEventKeys),
      dangerousApprovalIds: sorted(evidence.dangerousApprovalIds)
    };
    const artifactSha256 = fingerprintCanonicalArtifact(artifact);
    await input.persistArtifact({
      runId: task.runId,
      kind: "deep_direct_evidence",
      sha256: artifactSha256,
      artifact
    });
    await heartbeat();
    return { kind: "completed", artifactSha256 };
  };
}
