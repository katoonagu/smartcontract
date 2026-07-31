import type { UnifiedQueryable } from "../../src/unifiedCheck/repository";

export async function normalizeUnifiedSemanticReadiness(
  db: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly frozenClockIso: string;
  }
): Promise<void> {
  // ponytail: semantic suites intentionally bypass scheduling-time/backoff,
  // which dedicated tests own.
  await db.query(
    `update unified_check_tasks
        set ready_at = $2::timestamptz
      where run_id = $1
        and status in ('QUEUED','WAITING_RETRY')
        and ready_at > $2::timestamptz`,
    [input.runId, input.frozenClockIso]
  );
}
