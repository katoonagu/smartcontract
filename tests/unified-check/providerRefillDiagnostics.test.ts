import { describe, expect, it } from "vitest";
import {
  createUnifiedProviderRefillDiagnostics
} from "../../src/unifiedCheck/providerRefillDiagnostics";

const permit = {
  lane: "interactive" as const,
  ownerId: "secret-owner",
  runId: "secret-run",
  canonicalHeadPreferred: true
};

function completeSample(input: {
  diagnostics: ReturnType<typeof createUnifiedProviderRefillDiagnostics>;
  slotId?: number;
  epoch?: number;
  startMs?: number;
}) {
  const slotId = input.slotId ?? 0;
  const epoch = input.epoch ?? 1;
  const startMs = input.startMs ?? 10;
  const assignment = { slotId, expectedEpoch: epoch + 1, permit };
  input.diagnostics.recordChunkFinished({ slotId, epoch, atMs: startMs });
  input.diagnostics.recordCheckpointFinished({
    slotId,
    epoch,
    atMs: startMs + 8
  });
  input.diagnostics.recordControllerDecisionFinished({
    assignments: [assignment],
    atMs: startMs + 11
  });
  input.diagnostics.recordAssignmentsEvaluated({
    accepted: [assignment],
    rejected: []
  }, startMs + 13);
  input.diagnostics.recordTaskClaimed({
    slotId,
    epoch: epoch + 2,
    atMs: startMs + 17
  });
}

describe("Unified provider refill diagnostics", () => {
  it("correlates exact epoch transitions and exports bounded identity-free phase metrics", () => {
    const diagnostics = createUnifiedProviderRefillDiagnostics();
    completeSample({ diagnostics });

    expect(diagnostics.snapshot()).toEqual({
      version: "unified-provider-refill-diagnostics-v1",
      assignments: {
        proposed: 1,
        accepted: 1,
        rejected: 0,
        rejections: {
          draining: 0,
          slotActive: 0,
          pendingAssignment: 0,
          staleEpoch: 0
        }
      },
      phases: {
        chunkToCheckpoint: {
          p50: 8,
          p95: 8,
          max: 8,
          sampleCount: 1
        },
        checkpointToController: {
          p50: 3,
          p95: 3,
          max: 3,
          sampleCount: 1
        },
        controllerToPermit: {
          p50: 2,
          p95: 2,
          max: 2,
          sampleCount: 1
        },
        permitToClaim: {
          p50: 4,
          p95: 4,
          max: 4,
          sampleCount: 1
        },
        checkpointToClaim: {
          p50: 9,
          p95: 9,
          max: 9,
          sampleCount: 1
        }
      },
      diagnostics: {
        incomplete: 0,
        evictedIncomplete: 0,
        discontinuities: 0,
        invalidClocks: 0
      }
    });
    expect(JSON.stringify(diagnostics.snapshot())).not.toMatch(
      /secret|runId|ownerId|task|address|key|group/u
    );
  });

  it("aggregates every rejection reason including stale epochs", () => {
    const diagnostics = createUnifiedProviderRefillDiagnostics();
    const assignments = ["draining", "slot_active", "pending_assignment",
      "stale_epoch"].map((reason, slotId) => ({
      assignment: { slotId, expectedEpoch: 0, permit },
      reason: reason as "draining" | "slot_active" |
        "pending_assignment" | "stale_epoch"
    }));

    diagnostics.recordAssignmentsEvaluated({
      accepted: [{ slotId: 4, expectedEpoch: 0, permit }],
      rejected: assignments
    }, 10);

    expect(diagnostics.snapshot().assignments).toEqual({
      proposed: 5,
      accepted: 1,
      rejected: 4,
      rejections: {
        draining: 1,
        slotActive: 1,
        pendingAssignment: 1,
        staleEpoch: 1
      }
    });
  });

  it("drops epoch discontinuities instead of guessing elapsed time", () => {
    const diagnostics = createUnifiedProviderRefillDiagnostics();
    const assignment = { slotId: 0, expectedEpoch: 4, permit };
    diagnostics.recordChunkFinished({ slotId: 0, epoch: 1, atMs: 1 });
    diagnostics.recordCheckpointFinished({ slotId: 0, epoch: 1, atMs: 2 });
    diagnostics.recordControllerDecisionFinished({
      assignments: [assignment],
      atMs: 3
    });
    diagnostics.recordAssignmentsEvaluated({
      accepted: [assignment],
      rejected: []
    }, 4);
    diagnostics.recordTaskClaimed({ slotId: 0, epoch: 6, atMs: 5 });

    expect(diagnostics.snapshot().phases.checkpointToClaim.sampleCount).toBe(0);
    expect(diagnostics.snapshot().diagnostics.discontinuities).toBeGreaterThan(0);
    expect(diagnostics.snapshot().diagnostics.incomplete).toBe(0);
  });

  it("evicts the oldest incomplete correlation and bounds every metric at 512", () => {
    const diagnostics = createUnifiedProviderRefillDiagnostics();
    for (let slotId = 0; slotId < 513; slotId += 1) {
      diagnostics.recordChunkFinished({ slotId, epoch: 1, atMs: slotId });
    }
    expect(diagnostics.snapshot().diagnostics).toMatchObject({
      incomplete: 512,
      evictedIncomplete: 1
    });

    for (let sample = 0; sample < 513; sample += 1) {
      completeSample({
        diagnostics,
        slotId: 1_000 + sample,
        startMs: 10_000 + sample * 20
      });
    }
    expect(diagnostics.snapshot().phases.chunkToCheckpoint).toEqual({
      p50: 8,
      p95: 8,
      max: 8,
      sampleCount: 512
    });
  });

  it("ignores invalid and nonmonotonic clocks without throwing", () => {
    const diagnostics = createUnifiedProviderRefillDiagnostics();
    expect(() => {
      diagnostics.recordChunkFinished({ slotId: 0, epoch: 1, atMs: NaN });
      diagnostics.recordChunkFinished({ slotId: 1, epoch: 1, atMs: 10 });
      diagnostics.recordCheckpointFinished({ slotId: 1, epoch: 1, atMs: 9 });
      diagnostics.recordTaskClaimed({ slotId: 1, epoch: 3, atMs: Infinity });
    }).not.toThrow();
    expect(diagnostics.snapshot().diagnostics).toEqual({
      incomplete: 0,
      evictedIncomplete: 0,
      discontinuities: 0,
      invalidClocks: 3
    });
  });
});
