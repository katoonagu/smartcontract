import type { Db } from "../storage/db";

export type TargetedIndexRepairAction = "ignore" | "review" | "repair";

export type TargetedIndexRepairCandidate = {
  address: string;
  targetTimestampMs: number;
  targetTimestamp: Date | null;
  status: string;
  statusReason: string | null;
  providerCapHit: boolean;
  budgetExhausted: boolean;
  providerInconsistent: boolean;
  fetchedPageCount: number;
  fetchedTransferCount: number;
  budgetPages: number | null;
  attemptCount: number;
  maxAttempts: number;
  pages: number;
  cappedPages: number;
  nonCompletePages: number;
  uniqueHashes: number;
  intervals: number;
  completeIntervals: number;
  capIntervals: number;
  pageOldest: Date | null;
  pageNewest: Date | null;
};

export type TargetedIndexRepairDecision = {
  action: TargetedIndexRepairAction;
  reasons: string[];
  budgetPages: number | null;
  maxAttempts: number | null;
};

export type TargetedIndexRepairPlan = TargetedIndexRepairCandidate & {
  action: TargetedIndexRepairAction;
  reasons: string[];
  repairBudgetPages: number | null;
  repairMaxAttempts: number | null;
};

export type TargetedIndexRepairResult = {
  candidates: TargetedIndexRepairPlan[];
  repaired: TargetedIndexRepairPlan[];
};

const DEFAULT_MIN_BUDGET_PAGES = 200;
const DEFAULT_MAX_BUDGET_PAGES = 12_000;
const DEFAULT_MIN_MAX_ATTEMPTS = 8;

export function assessTargetedIndexRepairCandidate(
  candidate: TargetedIndexRepairCandidate,
  options: { minBudgetPages?: number; maxBudgetPages?: number; minMaxAttempts?: number } = {}
): TargetedIndexRepairDecision {
  if (candidate.status !== "complete" || candidate.statusReason !== "complete_provider_windowed") {
    return { action: "ignore", reasons: [], budgetPages: null, maxAttempts: null };
  }

  const reasons: string[] = [];
  const highConfidence =
    candidate.budgetExhausted ||
    candidate.providerInconsistent ||
    (candidate.cappedPages > 0 && candidate.pages > candidate.fetchedPageCount && candidate.fetchedPageCount <= 1);

  if (candidate.budgetExhausted) reasons.push("complete_state_budget_exhausted");
  if (candidate.providerInconsistent) reasons.push("complete_state_provider_inconsistent");
  if (candidate.cappedPages > 0 && candidate.pages > candidate.fetchedPageCount && candidate.fetchedPageCount <= 1) {
    reasons.push("complete_state_underreports_capped_pages");
  }
  if (candidate.cappedPages > 0 && candidate.capIntervals > 0 && candidate.capIntervals === candidate.completeIntervals) {
    reasons.push("complete_state_has_only_capped_intervals");
  }

  if (reasons.length === 0) return { action: "ignore", reasons, budgetPages: null, maxAttempts: null };

  const action: TargetedIndexRepairAction = highConfidence ? "repair" : "review";
  if (action !== "repair") return { action, reasons, budgetPages: null, maxAttempts: null };

  const minBudget = Math.max(1, Math.floor(options.minBudgetPages ?? DEFAULT_MIN_BUDGET_PAGES));
  const maxBudget = Math.max(minBudget, Math.floor(options.maxBudgetPages ?? DEFAULT_MAX_BUDGET_PAGES));
  const currentBudget = Math.max(
    minBudget,
    candidate.budgetPages ?? 0,
    candidate.pages,
    candidate.fetchedPageCount
  );
  const budgetPages = Math.min(maxBudget, currentBudget * 2);
  const minAttempts = Math.max(1, Math.floor(options.minMaxAttempts ?? DEFAULT_MIN_MAX_ATTEMPTS));
  const maxAttempts = Math.max(minAttempts, candidate.maxAttempts, candidate.attemptCount + 1);
  return { action, reasons, budgetPages, maxAttempts };
}

export async function listTargetedIndexRepairCandidates(
  db: Db,
  input: {
    address?: string | null;
    limit?: number | null;
    includeReview?: boolean | null;
    maxBudgetPages?: number | null;
  } = {}
): Promise<TargetedIndexRepairPlan[]> {
  const limit = Math.max(1, Math.floor(input.limit ?? 200));
  const rows = await db.query(
    `with page_stats as (
       select address, coverage_mode, target_timestamp_ms,
              count(*)::int as pages,
              count(*) filter (where range_total >= 10000)::int as capped_pages,
              count(*) filter (where status not in ('complete','empty'))::int as non_complete_pages,
              count(distinct canonical_transfer_hash)::int as unique_hashes,
              min(oldest_transfer_at) as page_oldest,
              max(newest_transfer_at) as page_newest
       from tron_address_usdt_index_pages
       where coverage_mode = 'targeted'
       group by address, coverage_mode, target_timestamp_ms
     ), interval_stats as (
       select address, coverage_mode, target_timestamp_ms,
              count(*)::int as intervals,
              count(*) filter (where status = 'complete')::int as complete_intervals,
              count(*) filter (where cap_hit = true)::int as cap_intervals
       from tron_address_usdt_coverage_intervals
       where coverage_mode = 'targeted'
       group by address, coverage_mode, target_timestamp_ms
     )
     select s.address, s.target_timestamp_ms, s.target_timestamp, s.status, s.status_reason,
            s.provider_cap_hit, s.budget_exhausted, s.provider_inconsistent,
            s.fetched_page_count, s.fetched_transfer_count, s.budget_pages,
            s.attempt_count, s.max_attempts,
            coalesce(p.pages, 0) as pages,
            coalesce(p.capped_pages, 0) as capped_pages,
            coalesce(p.non_complete_pages, 0) as non_complete_pages,
            coalesce(p.unique_hashes, 0) as unique_hashes,
            p.page_oldest, p.page_newest,
            coalesce(i.intervals, 0) as intervals,
            coalesce(i.complete_intervals, 0) as complete_intervals,
            coalesce(i.cap_intervals, 0) as cap_intervals
     from tron_address_usdt_index_states s
     left join page_stats p using(address, coverage_mode, target_timestamp_ms)
     left join interval_stats i using(address, coverage_mode, target_timestamp_ms)
     where s.coverage_mode = 'targeted'
       and s.request_kind = 'broad_targeted'
       and s.status = 'complete'
       and ($1::text is null or s.address = $1)
     order by s.updated_at desc
     limit $2`,
    [input.address ?? null, limit]
  );

  return rows.rows
    .map(rowToCandidate)
    .map((candidate) => {
      const decision = assessTargetedIndexRepairCandidate(candidate, {
        maxBudgetPages: input.maxBudgetPages ?? undefined
      });
      return {
        ...candidate,
        action: decision.action,
        reasons: decision.reasons,
        repairBudgetPages: decision.budgetPages,
        repairMaxAttempts: decision.maxAttempts
      };
    })
    .filter((plan) => plan.action === "repair" || (input.includeReview === true && plan.action === "review"));
}

export async function repairInvalidCompleteTargetedIndexStates(
  db: Db,
  input: {
    address?: string | null;
    limit?: number | null;
    apply?: boolean | null;
    includeReview?: boolean | null;
    maxBudgetPages?: number | null;
  } = {}
): Promise<TargetedIndexRepairResult> {
  const candidates = await listTargetedIndexRepairCandidates(db, input);
  const repairable = candidates.filter((candidate) => candidate.action === "repair");
  if (input.apply !== true) return { candidates, repaired: [] };

  const repaired: TargetedIndexRepairPlan[] = [];
  for (const candidate of repairable) {
    const updated = await db.query(
      `update tron_address_usdt_index_states
       set status = 'queued',
           status_reason = null,
           provider_cap_hit = true,
           budget_exhausted = true,
           provider_inconsistent = false,
           budget_pages = $3,
           max_attempts = $4,
           next_run_at = now(),
           locked_at = null,
           locked_until = null,
           heartbeat_at = null,
           lock_owner = null,
           last_error = null,
           last_error_class = null,
           completed_at = null,
           updated_at = now()
       where address = $1
         and coverage_mode = 'targeted'
         and request_kind = 'broad_targeted'
         and target_timestamp_ms = $2
         and status = 'complete'`,
      [
        candidate.address,
        candidate.targetTimestampMs,
        candidate.repairBudgetPages,
        candidate.repairMaxAttempts
      ]
    );
    if ((updated.rowCount ?? 0) > 0) repaired.push(candidate);
  }

  return { candidates, repaired };
}

function rowToCandidate(row: Record<string, any>): TargetedIndexRepairCandidate {
  return {
    address: String(row.address),
    targetTimestampMs: Number(row.target_timestamp_ms),
    targetTimestamp: row.target_timestamp ?? null,
    status: String(row.status),
    statusReason: row.status_reason ?? null,
    providerCapHit: row.provider_cap_hit === true,
    budgetExhausted: row.budget_exhausted === true,
    providerInconsistent: row.provider_inconsistent === true,
    fetchedPageCount: Number(row.fetched_page_count ?? 0),
    fetchedTransferCount: Number(row.fetched_transfer_count ?? 0),
    budgetPages: row.budget_pages === null || row.budget_pages === undefined ? null : Number(row.budget_pages),
    attemptCount: Number(row.attempt_count ?? 0),
    maxAttempts: Number(row.max_attempts ?? 0),
    pages: Number(row.pages ?? 0),
    cappedPages: Number(row.capped_pages ?? 0),
    nonCompletePages: Number(row.non_complete_pages ?? 0),
    uniqueHashes: Number(row.unique_hashes ?? 0),
    intervals: Number(row.intervals ?? 0),
    completeIntervals: Number(row.complete_intervals ?? 0),
    capIntervals: Number(row.cap_intervals ?? 0),
    pageOldest: row.page_oldest ?? null,
    pageNewest: row.page_newest ?? null
  };
}
