import type {
  UnifiedProviderAssignmentResult,
  UnifiedProviderSlotAssignment
} from "./providerPool";

const SAMPLE_LIMIT = 512;

type RefillCorrelation = {
  readonly slotId: number;
  readonly activeEpoch: number;
  readonly chunkFinishedAtMs: number;
  checkpointFinishedAtMs?: number;
  controllerDecisionFinishedAtMs?: number;
  permitAcceptedAtMs?: number;
};

type PhaseName =
  | "chunkToCheckpoint"
  | "checkpointToController"
  | "controllerToPermit"
  | "permitToClaim"
  | "checkpointToClaim";

export type UnifiedProviderRefillMetricSnapshot = {
  readonly p50: number | null;
  readonly p95: number | null;
  readonly max: number | null;
  readonly sampleCount: number;
};

export type UnifiedProviderRefillDiagnosticsSnapshotV1 = {
  readonly version: "unified-provider-refill-diagnostics-v1";
  readonly assignments: {
    readonly proposed: number;
    readonly accepted: number;
    readonly rejected: number;
    readonly rejections: {
      readonly draining: number;
      readonly slotActive: number;
      readonly pendingAssignment: number;
      readonly staleEpoch: number;
    };
  };
  readonly phases: Record<PhaseName, UnifiedProviderRefillMetricSnapshot>;
  readonly diagnostics: {
    readonly incomplete: number;
    readonly evictedIncomplete: number;
    readonly discontinuities: number;
    readonly invalidClocks: number;
  };
};

function validIdentity(slotId: number, epoch: number): boolean {
  return Number.isSafeInteger(slotId) && slotId >= 0 &&
    Number.isSafeInteger(epoch) && epoch >= 0;
}

function metric(values: readonly number[]): UnifiedProviderRefillMetricSnapshot {
  if (values.length === 0) {
    return { p50: null, p95: null, max: null, sampleCount: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const nearestRank = (percentile: number) =>
    sorted[Math.ceil(percentile * sorted.length) - 1]!;
  return {
    p50: nearestRank(0.5),
    p95: nearestRank(0.95),
    max: sorted[sorted.length - 1]!,
    sampleCount: sorted.length
  };
}

export function createUnifiedProviderRefillDiagnostics() {
  const incomplete = new Map<number, RefillCorrelation>();
  const phases: Record<PhaseName, number[]> = {
    chunkToCheckpoint: [],
    checkpointToController: [],
    controllerToPermit: [],
    permitToClaim: [],
    checkpointToClaim: []
  };
  const assignments = {
    proposed: 0,
    accepted: 0,
    rejected: 0,
    rejections: {
      draining: 0,
      slotActive: 0,
      pendingAssignment: 0,
      staleEpoch: 0
    }
  };
  let evictedIncomplete = 0;
  let discontinuities = 0;
  let invalidClocks = 0;

  const validClock = (atMs: number): boolean => {
    if (Number.isFinite(atMs) && atMs >= 0) return true;
    invalidClocks += 1;
    return false;
  };
  const drop = (slotId: number, discontinuity: boolean) => {
    if (!incomplete.delete(slotId)) return;
    if (discontinuity) discontinuities += 1;
  };
  const append = (name: PhaseName, durationMs: number) => {
    const samples = phases[name];
    samples.push(durationMs);
    if (samples.length > SAMPLE_LIMIT) samples.shift();
  };
  const correlateAssignment = (
    assignment: UnifiedProviderSlotAssignment
  ): RefillCorrelation | null => {
    const sample = incomplete.get(assignment.slotId);
    if (!sample) return null;
    if (assignment.expectedEpoch !== sample.activeEpoch + 1) {
      drop(assignment.slotId, true);
      return null;
    }
    return sample;
  };

  return {
    recordChunkFinished(event: {
      readonly slotId: number;
      readonly epoch: number;
      readonly atMs: number;
    }): void {
      if (!validIdentity(event.slotId, event.epoch) ||
        !validClock(event.atMs)) return;
      drop(event.slotId, true);
      incomplete.set(event.slotId, {
        slotId: event.slotId,
        activeEpoch: event.epoch,
        chunkFinishedAtMs: event.atMs
      });
      if (incomplete.size > SAMPLE_LIMIT) {
        const oldestSlotId = incomplete.keys().next().value as number;
        incomplete.delete(oldestSlotId);
        evictedIncomplete += 1;
      }
    },
    recordCheckpointFinished(event: {
      readonly slotId: number;
      readonly epoch: number;
      readonly atMs: number;
    }): void {
      if (!validIdentity(event.slotId, event.epoch) ||
        !validClock(event.atMs)) return;
      const sample = incomplete.get(event.slotId);
      if (!sample) return;
      if (sample.activeEpoch !== event.epoch) {
        drop(event.slotId, true);
        return;
      }
      if (event.atMs < sample.chunkFinishedAtMs) {
        invalidClocks += 1;
        drop(event.slotId, false);
        return;
      }
      sample.checkpointFinishedAtMs = event.atMs;
    },
    recordControllerDecisionFinished(event: {
      readonly assignments: readonly UnifiedProviderSlotAssignment[];
      readonly atMs: number;
    }): void {
      if (!validClock(event.atMs)) return;
      for (const assignment of event.assignments) {
        const sample = correlateAssignment(assignment);
        if (!sample) continue;
        if (sample.checkpointFinishedAtMs === undefined) {
          drop(assignment.slotId, true);
          continue;
        }
        if (sample.controllerDecisionFinishedAtMs !== undefined ||
          sample.permitAcceptedAtMs !== undefined) {
          drop(assignment.slotId, true);
          continue;
        }
        if (event.atMs < sample.checkpointFinishedAtMs) {
          invalidClocks += 1;
          drop(assignment.slotId, false);
          continue;
        }
        sample.controllerDecisionFinishedAtMs = event.atMs;
      }
    },
    recordAssignmentsEvaluated(
      result: UnifiedProviderAssignmentResult,
      atMs: number
    ): void {
      assignments.proposed += result.accepted.length + result.rejected.length;
      assignments.accepted += result.accepted.length;
      assignments.rejected += result.rejected.length;
      for (const rejection of result.rejected) {
        if (rejection.reason === "slot_active") {
          assignments.rejections.slotActive += 1;
        } else if (rejection.reason === "pending_assignment") {
          assignments.rejections.pendingAssignment += 1;
        } else if (rejection.reason === "stale_epoch") {
          assignments.rejections.staleEpoch += 1;
        } else {
          assignments.rejections.draining += 1;
        }
      }
      if (!validClock(atMs)) return;
      for (const assignment of result.accepted) {
        const sample = correlateAssignment(assignment);
        if (!sample) continue;
        if (sample.controllerDecisionFinishedAtMs === undefined) {
          drop(assignment.slotId, true);
          continue;
        }
        if (sample.permitAcceptedAtMs !== undefined) {
          drop(assignment.slotId, true);
          continue;
        }
        if (atMs < sample.controllerDecisionFinishedAtMs) {
          invalidClocks += 1;
          drop(assignment.slotId, false);
          continue;
        }
        sample.permitAcceptedAtMs = atMs;
      }
    },
    recordTaskClaimed(event: {
      readonly slotId: number;
      readonly epoch: number;
      readonly atMs: number;
    }): void {
      if (!validIdentity(event.slotId, event.epoch) ||
        !validClock(event.atMs)) return;
      const sample = incomplete.get(event.slotId);
      if (!sample) return;
      if (event.epoch !== sample.activeEpoch + 2 ||
        sample.checkpointFinishedAtMs === undefined ||
        sample.controllerDecisionFinishedAtMs === undefined ||
        sample.permitAcceptedAtMs === undefined) {
        drop(event.slotId, true);
        return;
      }
      if (event.atMs < sample.permitAcceptedAtMs) {
        invalidClocks += 1;
        drop(event.slotId, false);
        return;
      }
      append(
        "chunkToCheckpoint",
        sample.checkpointFinishedAtMs - sample.chunkFinishedAtMs
      );
      append(
        "checkpointToController",
        sample.controllerDecisionFinishedAtMs -
          sample.checkpointFinishedAtMs
      );
      append(
        "controllerToPermit",
        sample.permitAcceptedAtMs - sample.controllerDecisionFinishedAtMs
      );
      append("permitToClaim", event.atMs - sample.permitAcceptedAtMs);
      append(
        "checkpointToClaim",
        event.atMs - sample.checkpointFinishedAtMs
      );
      incomplete.delete(event.slotId);
    },
    snapshot(): UnifiedProviderRefillDiagnosticsSnapshotV1 {
      return {
        version: "unified-provider-refill-diagnostics-v1",
        assignments: {
          ...assignments,
          rejections: { ...assignments.rejections }
        },
        phases: {
          chunkToCheckpoint: metric(phases.chunkToCheckpoint),
          checkpointToController: metric(phases.checkpointToController),
          controllerToPermit: metric(phases.controllerToPermit),
          permitToClaim: metric(phases.permitToClaim),
          checkpointToClaim: metric(phases.checkpointToClaim)
        },
        diagnostics: {
          incomplete: incomplete.size,
          evictedIncomplete,
          discontinuities,
          invalidClocks
        }
      };
    }
  };
}

export type UnifiedProviderRefillDiagnostics = ReturnType<
  typeof createUnifiedProviderRefillDiagnostics
>;
