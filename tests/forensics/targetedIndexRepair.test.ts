import { describe, expect, it } from "vitest";
import type { Db } from "../../src/storage/db";
import {
  assessTargetedIndexRepairCandidate,
  repairInvalidCompleteTargetedIndexStates,
  type TargetedIndexRepairCandidate
} from "../../src/forensics/targetedIndexRepair";

function createMockDb(rows: Record<string, unknown>[]): { db: Db; queries: { sql: string; params: unknown[] }[] } {
  const queries: { sql: string; params: unknown[] }[] = [];
  return {
    db: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return sql.includes("update tron_address_usdt_index_states")
          ? { rowCount: 1, rows: [{ address: params[0], target_timestamp_ms: params[1], status: "queued" }] }
          : { rowCount: rows.length, rows };
      }
    } as unknown as Db,
    queries
  };
}

function candidate(overrides: Partial<TargetedIndexRepairCandidate> = {}): TargetedIndexRepairCandidate {
  return {
    address: "TWkvffFDMsqbmTLkMHMABmw452Hyq98cdn",
    targetTimestampMs: 1_783_000_000_000,
    targetTimestamp: new Date("2026-07-01T12:47:39.000Z"),
    status: "complete",
    statusReason: "complete_provider_windowed",
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    fetchedPageCount: 1,
    fetchedTransferCount: 40,
    budgetPages: 3200,
    attemptCount: 17,
    maxAttempts: 17,
    pages: 800,
    cappedPages: 800,
    nonCompletePages: 0,
    uniqueHashes: 398,
    intervals: 7,
    completeIntervals: 7,
    capIntervals: 7,
    pageOldest: new Date("2026-06-13T21:55:24.000Z"),
    pageNewest: new Date("2026-07-01T12:47:39.000Z"),
    ...overrides
  };
}

describe("targeted index repair", () => {
  it("flags invalid complete targeted coverage when capped saved pages exceed state page count", () => {
    const decision = assessTargetedIndexRepairCandidate(candidate());

    expect(decision.action).toBe("repair");
    expect(decision.reasons).toContain("complete_state_underreports_capped_pages");
    expect(decision.budgetPages).toBe(6400);
    expect(decision.maxAttempts).toBe(18);
  });

  it("keeps single capped complete states in review instead of bulk repairing them", () => {
    const decision = assessTargetedIndexRepairCandidate(candidate({
      pages: 1,
      cappedPages: 1,
      fetchedPageCount: 1,
      budgetPages: null,
      attemptCount: 0,
      maxAttempts: 5
    }));

    expect(decision.action).toBe("review");
    expect(decision.reasons).toContain("complete_state_has_only_capped_intervals");
  });

  it("repairs invalid complete states without deleting cached page audits or transfers", async () => {
    const db = createMockDb([{
      address: "TWkvffFDMsqbmTLkMHMABmw452Hyq98cdn",
      target_timestamp_ms: 1_783_000_000_000,
      target_timestamp: new Date("2026-07-01T12:47:39.000Z"),
      status: "complete",
      status_reason: "complete_provider_windowed",
      provider_cap_hit: false,
      budget_exhausted: false,
      provider_inconsistent: false,
      fetched_page_count: 1,
      fetched_transfer_count: 40,
      budget_pages: 3200,
      attempt_count: 17,
      max_attempts: 17,
      pages: 800,
      capped_pages: 800,
      non_complete_pages: 0,
      unique_hashes: 398,
      intervals: 7,
      complete_intervals: 7,
      cap_intervals: 7,
      page_oldest: new Date("2026-06-13T21:55:24.000Z"),
      page_newest: new Date("2026-07-01T12:47:39.000Z")
    }]);

    const result = await repairInvalidCompleteTargetedIndexStates(db.db, {
      address: "TWkvffFDMsqbmTLkMHMABmw452Hyq98cdn",
      apply: true
    });

    expect(result.repaired).toHaveLength(1);
    expect(result.repaired[0]?.repairBudgetPages).toBe(6400);
    expect(result.repaired[0]?.repairMaxAttempts).toBe(18);
    expect(db.queries.some((query) => /\bdelete\b/i.test(query.sql))).toBe(false);
    expect(db.queries[1]?.sql).toContain("update tron_address_usdt_index_states");
    expect(db.queries[1]?.sql).toContain("status = 'queued'");
    expect(db.queries[1]?.sql).toContain("locked_until = null");
  });
});
