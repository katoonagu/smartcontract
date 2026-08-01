import {
  refillOrderedAdmissions
} from "./plannerRepository";
import type {
  UnifiedTransactionalQueryable
} from "./repository";

export type UnifiedAdmissionPolicy = "barrier" | "rolling";

export type UnifiedBarrierFallbackResult = {
  readonly runIds: readonly string[];
  readonly deAdmittedTaskIds: readonly string[];
};

export type UnifiedAdmissionRuntimeControl = {
  current(): UnifiedAdmissionPolicy;
  runControllerCycle<T>(
    cycle: (policy: UnifiedAdmissionPolicy) => Promise<T>
  ): Promise<T>;
  switchToBarrier(): Promise<{
    readonly changed: boolean;
    readonly runIds: readonly string[];
    readonly deAdmittedTaskIds: readonly string[];
  }>;
};

export function createUnifiedAdmissionRuntimeControl(input: {
  readonly initialPolicy: UnifiedAdmissionPolicy;
  applyBarrierFallback(): Promise<UnifiedBarrierFallbackResult>;
  wake(): void;
}): UnifiedAdmissionRuntimeControl {
  if (!["barrier", "rolling"].includes(input.initialPolicy)) {
    throw new TypeError("unified_admission_policy_invalid");
  }
  let policy = input.initialPolicy;
  let serialized: Promise<void> = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const result = serialized.then(work);
    serialized = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
  return {
    current: () => policy,
    runControllerCycle: (cycle) => exclusive(() => cycle(policy)),
    switchToBarrier: () => exclusive(async () => {
      if (policy === "barrier") {
        return {
          changed: false,
          runIds: [],
          deAdmittedTaskIds: []
        };
      }
      const fallback = await input.applyBarrierFallback();
      policy = "barrier";
      try {
        input.wake();
      } catch {
        // Durable de-admission is authoritative; reconciliation is the retry.
      }
      return { changed: true, ...fallback };
    })
  };
}

export function createPostgresUnifiedAdmissionRuntimeControl(input: {
  readonly db: UnifiedTransactionalQueryable;
  readonly initialPolicy: UnifiedAdmissionPolicy;
  readonly readyBufferMaxEntries: number;
  readonly readyBufferMaxBytes: number;
  readonly reservedBufferMaxBytes: number;
  readonly reservationBytesPerTask: number;
  now(): Date;
  wake(): void;
}): UnifiedAdmissionRuntimeControl {
  return createUnifiedAdmissionRuntimeControl({
    initialPolicy: input.initialPolicy,
    wake: input.wake,
    async applyBarrierFallback() {
      const runIds = await input.db.transaction(async (client) => {
        const result = await client.query(
          `select distinct entry.run_id
             from unified_check_planner_entries entry
             join unified_check_runs run on run.id = entry.run_id
            where run.status = 'RUNNING'
              and entry.planner_state <> 'committed'
            order by entry.run_id`
        );
        return result.rows.map((row) => String(row.run_id));
      });
      const deAdmittedTaskIds: string[] = [];
      for (const runId of runIds) {
        const result = await refillOrderedAdmissions(input.db, {
          runId,
          policy: "barrier",
          lookaheadTarget: 1,
          readyBufferMaxEntries: input.readyBufferMaxEntries,
          readyBufferMaxBytes: input.readyBufferMaxBytes,
          reservedBufferMaxBytes: input.reservedBufferMaxBytes,
          reservationBytesPerTask: input.reservationBytesPerTask,
          now: input.now()
        });
        deAdmittedTaskIds.push(...result.deAdmittedTaskIds);
      }
      return { runIds, deAdmittedTaskIds };
    }
  });
}
