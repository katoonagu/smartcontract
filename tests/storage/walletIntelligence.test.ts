import { describe, expect, it } from "vitest";
import {
  getWalletIntelligenceAddressDetail,
  getWalletIntelligenceRunState,
  indexWalletIntelligenceJobPayload,
  listWalletIntelligenceAddressSummaries,
  listWalletIntelligenceBackfillJobs,
  type WalletIntelligenceAddressSummary,
  type WalletIntelligenceRunInput,
  type WalletIntelligenceSightingInput,
  type WalletIntelligenceEdgeInput
} from "../../src/storage/repositories";

describe("wallet intelligence repository types", () => {
  it("exposes neutral wallet intelligence input and summary shapes", () => {
    const run: WalletIntelligenceRunInput = {
      jobId: "job-1",
      jobKind: "address_deep_check",
      jobStatus: "completed",
      subjectAddress: "TSubject111111111111111111111111111111",
      requestedBy: "42",
      chatId: "42",
      messageId: "77",
      completedAt: new Date("2026-07-06T10:00:00.000Z"),
      telegramUserId: "42",
      telegramUsername: "client_user",
      telegramLocale: "ru",
      sourcePayloadHash: "hash-1",
      indexVersion: 1,
      indexStatus: "indexed",
      indexError: null
    };
    const sighting: WalletIntelligenceSightingInput = {
      id: "sighting-1",
      address: "TSeen1111111111111111111111111111111",
      jobId: "job-1",
      jobKind: "address_deep_check",
      subjectAddress: "TSubject111111111111111111111111111111",
      requestedBy: "42",
      sourceKind: "deep_direct_counterparty",
      role: "direct_counterparty",
      depth: 1,
      pathId: "deep:direct:0",
      txHash: "tx-1",
      amountRaw: "1000000",
      firstSeenAt: new Date("2026-07-06T09:00:00.000Z"),
      lastSeenAt: new Date("2026-07-06T09:00:00.000Z"),
      metadataJson: { direction: "inbound" }
    };
    const edge: WalletIntelligenceEdgeInput = {
      id: "edge-1",
      fromAddress: "TSeen1111111111111111111111111111111",
      toAddress: "TSubject111111111111111111111111111111",
      jobId: "job-1",
      jobKind: "address_deep_check",
      sourceKind: "deep_direct_counterparty",
      depth: 1,
      pathId: "deep:direct:0",
      txHash: "tx-1",
      amountRaw: "1000000",
      timestamp: new Date("2026-07-06T09:00:00.000Z"),
      edgeRole: "transfer",
      metadataJson: {}
    };
    const summary: WalletIntelligenceAddressSummary = {
      address: sighting.address,
      uniqueSubjectCount: 2,
      uniqueRequesterCount: 2,
      jobCount: 3,
      completedJobCount: 2,
      partialJobCount: 1,
      occurrenceCount: 4,
      distinctTxCount: 1,
      distinctAmountRaw: "1000000",
      minDepth: 1,
      maxDepth: 2,
      firstSeenAt: new Date("2026-07-06T09:00:00.000Z"),
      lastSeenAt: new Date("2026-07-06T10:00:00.000Z"),
      modes: ["address_deep_check"],
      tags: ["repeated_cross_run_address"],
      serviceCategories: [],
      labelHints: []
    };

    expect(run.indexStatus).toBe("indexed");
    expect(sighting.role).toBe("direct_counterparty");
    expect(edge.edgeRole).toBe("transfer");
    expect(summary.distinctAmountRaw).toBe("1000000");
    expect(summary.tags).not.toContain("risk");
  });
});

function createMockDb(
  rows: Record<string, unknown>[][] = [],
  options: { throwOnSql?: (sql: string) => boolean } = {}
) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let index = 0;
  let released = false;
  return {
    queries,
    released: () => released,
    db: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (options.throwOnSql?.(sql)) throw new Error("forced db failure");
        return { rows: rows[index++] ?? [], rowCount: rows[index - 1]?.length ?? 0 };
      },
      connect: async () => ({
        query: async (sql: string, params: unknown[] = []) => {
          queries.push({ sql, params });
          if (options.throwOnSql?.(sql)) throw new Error("forced db failure");
          return { rows: rows[index++] ?? [], rowCount: rows[index - 1]?.length ?? 0 };
        },
        release: () => {
          released = true;
        }
      })
    } as any
  };
}

describe("wallet intelligence repositories", () => {
  it("indexes a job payload transactionally and refreshes touched summaries", async () => {
    const { db, queries } = createMockDb([
      [],
      [{ address: "TOld11111111111111111111111111111111" }]
    ]);

    await indexWalletIntelligenceJobPayload(db, {
      run: {
        jobId: "job-1",
        jobKind: "address_deep_check",
        jobStatus: "completed",
        subjectAddress: "TSubject111111111111111111111111111111",
        requestedBy: "42",
        chatId: "42",
        messageId: "77",
        completedAt: new Date("2026-07-06T10:00:00.000Z"),
        telegramUserId: "42",
        telegramUsername: "client_user",
        telegramLocale: "ru",
        sourcePayloadHash: "hash-1",
        indexVersion: 1,
        indexStatus: "indexed",
        indexError: null
      },
      sightings: [],
      edges: [],
      touchedAddresses: ["TSeen1111111111111111111111111111111"]
    });

    expect(queries[0].sql).toBe("begin");
    expect(queries.some((query) => query.sql.includes("insert into wallet_intelligence_runs"))).toBe(true);
    expect(queries.some((query) => query.sql.includes("delete from wallet_intelligence_sightings where job_id = $1"))).toBe(true);
    const refreshQuery = queries.find((query) => query.sql.includes("insert into wallet_intelligence_address_summary"));
    expect(refreshQuery).toBeDefined();
    const refreshSql = refreshQuery?.sql ?? "";
    expect(refreshSql).toContain("select distinct address, tx_hash, amount_raw");
    expect(refreshSql).toContain("where tx_hash is not null and amount_raw is not null");
    expect(refreshSql).not.toContain("null_tx_amount_rows");
    expect(refreshSql).not.toContain("id as tx_hash");
    expect(refreshSql).toContain("coalesce(amount_stats.distinct_amount_raw, 0) >= 1000000000000 then 'large_liquidity_wallet'");
    expect(refreshSql).not.toContain("coalesce(amount_stats.distinct_amount_raw, 0) >= 10000000000 then 'large_liquidity_wallet'");
    expect(refreshSql).toContain("stats.occurrence_count >= 25 or stats.distinct_tx_count >= 25 then 'high_activity_wallet'");
    expect(refreshSql).not.toContain("stats.occurrence_count >= 20 or stats.distinct_tx_count >= 10 then 'high_activity_wallet'");
    expect(refreshSql).toMatch(/stats\.unique_subject_count >= 3\s+and stats\.distinct_tx_count >= 10/);
    expect(refreshSql).not.toContain("stats.unique_subject_count >= 5 or stats.unique_requester_count >= 5 or stats.distinct_tx_count >= 25");
    expect(refreshQuery?.params[0]).toEqual([
      "TSeen1111111111111111111111111111111",
      "TOld11111111111111111111111111111111"
    ]);
    expect(queries.at(-1)?.sql).toBe("commit");
  });

  it("rolls back and releases the client when indexing fails", async () => {
    const mock = createMockDb([[], []], {
      throwOnSql: (sql) => sql.includes("insert into wallet_intelligence_runs")
    });

    await expect(indexWalletIntelligenceJobPayload(mock.db, {
      run: {
        jobId: "job-1",
        jobKind: "address_deep_check",
        jobStatus: "completed",
        subjectAddress: "TSubject111111111111111111111111111111",
        requestedBy: "42",
        chatId: "42",
        messageId: "77",
        completedAt: new Date("2026-07-06T10:00:00.000Z"),
        telegramUserId: "42",
        telegramUsername: "client_user",
        telegramLocale: "ru",
        sourcePayloadHash: "hash-1",
        indexVersion: 1,
        indexStatus: "indexed",
        indexError: null
      },
      sightings: [],
      edges: [],
      touchedAddresses: ["TSeen1111111111111111111111111111111"]
    })).rejects.toThrow("forced db failure");

    expect(mock.queries[0]?.sql).toBe("begin");
    expect(mock.queries.some((query) => query.sql === "rollback")).toBe(true);
    expect(mock.queries.some((query) => query.sql === "commit")).toBe(false);
    expect(mock.released()).toBe(true);
  });

  it("lists backfill jobs from completed and partial supported modes only", async () => {
    const { db, queries } = createMockDb([[]]);

    await listWalletIntelligenceBackfillJobs(db, { limit: 25, offset: 5 });

    expect(queries[0].sql).toContain("from forensic_check_jobs job");
    expect(queries[0].sql).toContain("kind in ('address_deep_check', 'where_is_money_check', 'incoming_deposit_check')");
    expect(queries[0].sql).toContain("status in ('completed', 'partial')");
    expect(queries[0].sql).toContain("result_json <> '{}'::jsonb");
    expect(queries[0].params).toEqual([25, 5]);
  });

  it("reads an indexed run state for idempotent backfill skips", async () => {
    const { db, queries } = createMockDb([[
      { source_payload_hash: "hash-1", index_version: 1, index_status: "indexed" }
    ]]);

    const state = await getWalletIntelligenceRunState(db, "job-1");

    expect(state).toEqual({
      sourcePayloadHash: "hash-1",
      indexVersion: 1,
      indexStatus: "indexed"
    });
    expect(queries[0].sql).toContain("from wallet_intelligence_runs");
    expect(queries[0].params).toEqual(["job-1"]);
  });

  it("lists address summaries ranked by unique subjects then requesters", async () => {
    const { db, queries } = createMockDb([[
      {
        address: "TSeen1111111111111111111111111111111",
        unique_subject_count: 3,
        unique_requester_count: 2,
        job_count: 5,
        completed_job_count: 4,
        partial_job_count: 1,
        occurrence_count: 8,
        distinct_tx_count: 2,
        distinct_amount_raw: "3000000",
        min_depth: 1,
        max_depth: 2,
        first_seen_at: new Date("2026-07-06T09:00:00.000Z"),
        last_seen_at: new Date("2026-07-06T10:00:00.000Z"),
        modes: ["address_deep_check"],
        tags: ["repeated_cross_run_address"],
        service_categories: [],
        label_hints: []
      }
    ]]);

    const rows = await listWalletIntelligenceAddressSummaries(db, {
      limit: 20,
      offset: 0,
      minUniqueSubjects: 2,
      minUniqueRequesters: 2,
      tag: "repeated_cross_run_address"
    });

    expect(rows[0]?.address).toBe("TSeen1111111111111111111111111111111");
    expect(rows[0]?.distinctAmountRaw).toBe("3000000");
    expect(queries[0].sql).toContain("unique_subject_count >= $1");
    expect(queries[0].sql).toContain("unique_requester_count >= $2");
    expect(queries[0].sql).toContain("tags ? $3");
    expect(queries[0].sql).toContain("order by unique_subject_count desc, unique_requester_count desc, job_count desc, last_seen_at desc");
  });

  it("loads address detail with requesters, jobs, sightings, edges, and labels", async () => {
    const { db, queries } = createMockDb([
      [{
        address: "TSeen1111111111111111111111111111111",
        unique_subject_count: 1,
        unique_requester_count: 1,
        job_count: 1,
        completed_job_count: 1,
        partial_job_count: 0,
        occurrence_count: 1,
        distinct_tx_count: 1,
        distinct_amount_raw: "1000000",
        min_depth: 1,
        max_depth: 1,
        first_seen_at: new Date("2026-07-06T09:00:00.000Z"),
        last_seen_at: new Date("2026-07-06T09:00:00.000Z"),
        modes: ["address_deep_check"],
        tags: ["repeated_cross_run_address"],
        service_categories: ["cex"],
        label_hints: ["Binance"]
      }],
      [{ requested_by: "42", telegram_user_id: "42", username: "client_user", locale: "ru", chat_id: "42", message_id: "77", job_count: 1 }],
      [{ job_id: "job-1", job_kind: "address_deep_check", job_status: "completed", subject_address: "TSubject111111111111111111111111111111", completed_at: new Date("2026-07-06T10:00:00.000Z") }],
      [{ id: "sighting-1", address: "TSeen1111111111111111111111111111111", job_id: "job-1", job_kind: "address_deep_check", job_status: "completed", subject_address: "TSubject111111111111111111111111111111", requested_by: "42", source_kind: "deep_direct_counterparty", role: "direct_counterparty", depth: 1, path_id: "p", tx_hash: "tx-1", amount_raw: "1000000", first_seen_at: new Date("2026-07-06T09:00:00.000Z"), last_seen_at: new Date("2026-07-06T09:00:00.000Z"), metadata_json: {} }],
      [{ id: "edge-1", from_address: "TSeen1111111111111111111111111111111", to_address: "TSubject111111111111111111111111111111", job_id: "job-1", job_kind: "address_deep_check", source_kind: "deep_direct_counterparty", depth: 1, path_id: "p", tx_hash: "tx-1", amount_raw: "1000000", timestamp: new Date("2026-07-06T09:00:00.000Z"), edge_role: "transfer", metadata_json: {} }]
    ]);

    const detail = await getWalletIntelligenceAddressDetail(db, "TSeen1111111111111111111111111111111");

    expect(detail?.summary.address).toBe("TSeen1111111111111111111111111111111");
    expect(detail?.requesters[0]?.username).toBe("client_user");
    expect(detail?.jobs[0]?.jobId).toBe("job-1");
    expect(detail?.sightings[0]?.sourceKind).toBe("deep_direct_counterparty");
    expect(detail?.edges[0]?.txHash).toBe("tx-1");
    expect(queries).toHaveLength(5);
  });
});
