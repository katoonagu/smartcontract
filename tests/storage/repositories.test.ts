import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  claimAddressPoisoningAlertsForDelivery,
  claimAddressPoisoningChecks,
  cancelTheftReport,
  claimObservedTransactionForUserAlert,
  claimDigestTransactions,
  claimObservedApprovalEvent,
  claimObservedApprovalDrainEvent,
  claimDueApprovalContexts,
  confirmTheftReportDeposit,
  completeForensicCheckJob,
  getApprovalPollState,
  getAddressMetadata,
  getStaleAddressMetadata,
  getContractIntelligenceProfile,
  getContractLlmVerdictCache,
  getContractLlmVerdictCacheByFingerprint,
  getForensicCheckJob,
  getForensicJobTargetedHistoryProgress,
  getTelegramUserSession,
  getTheftReport,
  getCoveringTronAddressUsdtIndexState,
  getTronAddressUsdtIndexState,
  getTronUsdtIndexerCursor,
  listWatchedWallets,
  getWalletPollState,
  getWalletApprovalSummary,
  listWalletApprovalsBySpenderForTelegramUser,
  listAddressLabelCacheForAddress,
  countIndexedTronUsdtCounterpartiesForAddress,
  listIndexedTronUsdtTransfersForAddress,
  listTronAddressUsdtIndexPages,
  listWalletApprovalDrainObservations,
  claimUserAlertsForRetry,
  listCustomerAlertRecipients,
  listRecentRiskSignalObservations,
  getAddressPoisoningQueueMetrics,
  hasUndismissedAddressPoisoningCandidateForIncoming,
  getObservedTransactionForIncomingDeposit,
  markDigestSent,
  listTheftReports,
  listTheftReportsForTelegramUser,
  markApprovalOwnerAlertFailed,
  markApprovalContextExpired,
  markApprovalContextFinalAlertSent,
  markApprovalContextPending,
  markApprovalContextResolved,
  markApprovalOwnerAlertSent,
  markApprovalOwnerAlertSkipped,
  markUserAlertAnalyzing,
  markUserAlertFailed,
  markUserAlertSent,
  markUserAlertSkipped,
  markAddressPoisoningAlertFailed,
  markAddressPoisoningAlertSkipped,
  markAddressPoisoningAlertSent,
  markAddressPoisoningCheckClear,
  markAddressPoisoningCheckFailed,
  markAddressPoisoningCheckInconclusive,
  markAddressPoisoningCheckSkipped,
  removeCustomerAlertRecipient,
  recordObservedTransactionRisk,
  persistAddressPoisoningCandidate,
  recordApprovalPollFailure,
  recordApprovalPollSuccess,
  recordApprovalRisk,
  releaseApprovalContextAfterFailure,
  saveRiskEvaluationEvidence,
  resolveAddressPoisoningCandidate,
  skipExpiredAddressPoisoningChecks,
  skipPausedAddressPoisoningChecks,
  rebuildAddressFeaturesDaily,
  setTelegramUserPendingAction,
  claimQueuedTronAddressUsdtIndexStates,
  failTronAddressUsdtIndexState,
  queueTronAddressUsdtIndexState,
  updateTheftReportAdminState,
  updateTheftReportComment,
  updateWatchedWalletAlertMode,
  updateWalletPollState,
  upsertAddressLabelCache,
  upsertAddressMetadata,
  upsertContractIntelligenceProfile,
  upsertContractLlmVerdictCache,
  upsertCustomerAlertRecipient,
  upsertTheftReportDraft,
  upsertIndexedTronUsdtTransfers,
  upsertTronAddressUsdtCoverageInterval,
  upsertTronAddressUsdtIndexPage,
  upsertTronAddressUsdtIndexState,
  upsertTronUsdtIndexerCursor,
  upsertWalletApproval,
  upsertWalletPollState
} from "../../src/storage/repositories";
import type { Db } from "../../src/storage/db";
import type { RawEvidenceInput, RiskSignalObservationInput, TronTransferEvent } from "../../src/types";

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
}

function createMockDb(rowCount = 0, rows: Record<string, unknown>[] = []): { db: Db; queries: { sql: string; params: unknown[] }[] } {
  const queries: { sql: string; params: unknown[] }[] = [];
  return {
    db: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return { rowCount, rows };
      }
    } as unknown as Db,
    queries
  };
}

function createSequencedMockDb(results: { rowCount?: number; rows: Record<string, unknown>[] }[]): {
  db: Db;
  queries: { sql: string; params: unknown[] }[];
} {
  const queries: { sql: string; params: unknown[] }[] = [];
  let index = 0;
  return {
    db: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        const result = results[Math.min(index, results.length - 1)] ?? { rows: [] };
        index += 1;
        return { rowCount: result.rowCount ?? result.rows.length, rows: result.rows };
      }
    } as unknown as Db,
    queries
  };
}

function createMockTransactionalDb(options: { failOnRiskObservation?: boolean } = {}): {
  db: Db;
  queries: { sql: string; params: unknown[] }[];
  released: boolean;
} {
  const queries: { sql: string; params: unknown[] }[] = [];
  let released = false;
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes("from observed_transactions tx") && sql.includes("for update of tx")) {
        return { rows: [{ poisoning_check_status: "running" }], rowCount: 1 };
      }
      if (sql.includes("from address_poisoning_candidates candidate") && sql.includes("for update of candidate")) {
        return { rows: [], rowCount: 0 };
      }
      if (options.failOnRiskObservation && sql.includes("insert into risk_signal_observations")) {
        throw new Error("risk observation insert failed");
      }
      return { rows: [], rowCount: 1 };
    },
    release: () => {
      released = true;
    }
  };

  return {
    db: {
      connect: async () => client
    } as unknown as Db,
    queries,
    get released() {
      return released;
    }
  };
}

const event: TronTransferEvent = {
  txHash: "tx-1",
  token: "USDT",
  sender: "sender",
  receiver: "receiver",
  amount: "10",
  timestamp: new Date("2026-05-20T00:00:00.000Z")
};

const theftReportCreatedAt = new Date("2026-05-27T09:00:00.000Z");
const theftReportRow = {
  id: "report-1",
  telegram_user_id: "42",
  tx_hash: "a".repeat(64),
  victim_address: "TSender111111111111111111111111111111",
  reported_scam_address: "TReceiver11111111111111111111111111111",
  amount_raw: "123456789",
  amount_usdt: "123.456789",
  comment: null,
  status: "draft",
  deposit_address: "T999999999999999999999999999999999",
  deposit_amount_usdt: "1000",
  admin_status: "new",
  admin_note: null,
  admin_updated_at: null,
  created_at: theftReportCreatedAt,
  updated_at: theftReportCreatedAt
};

describe("theft report repositories", () => {
  it("stores and maps a theft report draft", async () => {
    const { db, queries } = createMockDb(1, [theftReportRow]);

    const report = await upsertTheftReportDraft(db, {
      telegramUserId: "42",
      txHash: "a".repeat(64),
      victimAddress: "TSender111111111111111111111111111111",
      reportedScamAddress: "TReceiver11111111111111111111111111111",
      amountRaw: "123456789",
      amountUsdt: "123.456789",
      depositAddress: "T999999999999999999999999999999999",
      depositAmountUsdt: "1000"
    });

    expect(report).toMatchObject({
      id: "report-1",
      telegramUserId: "42",
      status: "draft",
      reportedScamAddress: "TReceiver11111111111111111111111111111"
    });
    expect(queries[0].sql).toContain("insert into theft_reports");
    expect(queries[0].sql).toContain("theft_reports.status in ('draft', 'awaiting_deposit')");
    expect(queries[0].params.slice(1)).toEqual([
      "42",
      "a".repeat(64),
      "TSender111111111111111111111111111111",
      "TReceiver11111111111111111111111111111",
      "123456789",
      "123.456789",
      "T999999999999999999999999999999999",
      "1000"
    ]);
  });

  it("stores selected theft report id in telegram session", async () => {
    const { db, queries } = createMockDb();

    await setTelegramUserPendingAction(db, {
      telegramUserId: "42",
      pendingAction: "report_theft_comment",
      selectedTheftReportId: "report-1"
    });

    expect(queries[0].sql).toContain("selected_theft_report_id");
    expect(queries[0].params).toEqual(["42", "report_theft_comment", null, "report-1"]);
  });

  it("maps selected theft report id from telegram session", async () => {
    const updatedAt = new Date("2026-05-27T09:05:00.000Z");
    const { db } = createMockDb(1, [{
      telegram_user_id: "42",
      pending_action: "report_theft_comment",
      selected_wallet_id: null,
      selected_theft_report_id: "report-1",
      updated_at: updatedAt
    }]);

    const session = await getTelegramUserSession(db, "42");

    expect(session?.pendingAction).toBe("report_theft_comment");
    expect(session?.selectedTheftReportId).toBe("report-1");
  });

  it("updates comments and statuses with ownership guards", async () => {
    const withCommentRow = { ...theftReportRow, comment: "Stolen after phishing link" };
    const { db: commentDb, queries: commentQueries } = createMockDb(1, [withCommentRow]);
    const withComment = await updateTheftReportComment(commentDb, {
      id: "report-1",
      telegramUserId: "42",
      comment: "Stolen after phishing link"
    });
    expect(withComment?.comment).toBe("Stolen after phishing link");
    expect(commentQueries[0].params).toEqual(["report-1", "42", "Stolen after phishing link"]);

    const { db: confirmDb, queries: confirmQueries } = createMockDb(1, [{ ...theftReportRow, status: "documents_requested" }]);
    const confirmed = await confirmTheftReportDeposit(confirmDb, { id: "report-1", telegramUserId: "42" });
    expect(confirmed?.status).toBe("documents_requested");
    expect(confirmQueries[0].sql).toContain("status in ('awaiting_deposit', 'deposit_confirmed', 'documents_requested')");

    const { db: cancelDb, queries: cancelQueries } = createMockDb(1, [{ ...theftReportRow, status: "cancelled" }]);
    const cancelled = await cancelTheftReport(cancelDb, { id: "report-1", telegramUserId: "42" });
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelQueries[0].sql).toContain("status in ('draft', 'awaiting_deposit')");
  });

  it("loads a theft report by id", async () => {
    const { db, queries } = createMockDb(1, [theftReportRow]);

    const report = await getTheftReport(db, "report-1");

    expect(report?.id).toBe("report-1");
    expect(queries[0].sql).toContain("from theft_reports");
    expect(queries[0].params).toEqual(["report-1"]);
  });

  it("maps admin state fields on theft reports", async () => {
    const adminUpdatedAt = new Date("2026-07-08T10:00:00.000Z");
    const { db } = createMockDb(1, [{
      ...theftReportRow,
      admin_status: "in_progress",
      admin_note: "Ждем документы от пользователя",
      admin_updated_at: adminUpdatedAt
    }]);

    const report = await getTheftReport(db, "report-1");

    expect(report).toMatchObject({
      id: "report-1",
      adminStatus: "in_progress",
      adminNote: "Ждем документы от пользователя",
      adminUpdatedAt
    });
  });

  it("lists theft reports with admin, bot, and text filters", async () => {
    const { db, queries } = createMockDb(1, [{
      ...theftReportRow,
      admin_status: "awaiting_documents",
      status: "documents_requested",
      admin_note: "Проверить заявление"
    }]);

    const reports = await listTheftReports(db, {
      limit: 20,
      offset: 5,
      adminStatus: "awaiting_documents",
      botStatus: "documents_requested",
      query: "TReceiver"
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      adminStatus: "awaiting_documents",
      status: "documents_requested"
    });
    expect(compactSql(queries[0].sql)).toContain("from theft_reports");
    expect(compactSql(queries[0].sql)).toContain("admin_status = $1");
    expect(compactSql(queries[0].sql)).toContain("status = $2");
    expect(compactSql(queries[0].sql)).toContain("reported_scam_address ilike $3");
    expect(compactSql(queries[0].sql)).toContain("order by coalesce(admin_updated_at, updated_at) desc, created_at desc, id desc");
    expect(compactSql(queries[0].sql)).toContain("limit $4 offset $5");
    expect(queries[0].params).toEqual([
      "awaiting_documents",
      "documents_requested",
      "%TReceiver%",
      20,
      5
    ]);
  });

  it("lists theft reports for one Telegram user newest first", async () => {
    const { db, queries } = createMockDb(1, [{ ...theftReportRow, telegram_user_id: "42" }]);

    const reports = await listTheftReportsForTelegramUser(db, "42", { limit: 3 });

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      telegramUserId: "42",
      id: "report-1"
    });
    expect(compactSql(queries[0].sql)).toContain("from theft_reports");
    expect(compactSql(queries[0].sql)).toContain("telegram_user_id = $1");
    expect(compactSql(queries[0].sql)).toContain("order by created_at desc, id desc");
    expect(compactSql(queries[0].sql)).toContain("limit $2");
    expect(queries[0].params).toEqual(["42", 3]);
  });

  it("sanitizes theft report list pagination values", async () => {
    const { db, queries } = createMockDb();

    await listTheftReports(db, { limit: Number.NaN, offset: Number.POSITIVE_INFINITY });
    await listTheftReports(db, { limit: 12.9, offset: 5.8 });
    await listTheftReports(db, { limit: -1, offset: -4 });
    await listTheftReports(db, { limit: 1000, offset: 2 });

    expect(queries[0].params).toEqual([50, 0]);
    expect(queries[1].params).toEqual([12, 5]);
    expect(queries[2].params).toEqual([1, 0]);
    expect(queries[3].params).toEqual([100, 2]);
  });

  it("updates theft report admin state without changing bot status fields", async () => {
    const adminUpdatedAt = new Date("2026-07-08T10:00:00.000Z");
    const { db, queries } = createMockDb(1, [{
      ...theftReportRow,
      admin_status: "escalated",
      admin_note: "Передано юристу",
      admin_updated_at: adminUpdatedAt
    }]);

    const report = await updateTheftReportAdminState(db, {
      id: "report-1",
      adminStatus: "escalated",
      adminNote: "  Передано юристу  "
    });

    expect(report).toMatchObject({
      adminStatus: "escalated",
      adminNote: "Передано юристу",
      status: "draft"
    });
    expect(compactSql(queries[0].sql)).toContain("set admin_status = $2");
    expect(compactSql(queries[0].sql)).toContain("admin_note = $3");
    expect(compactSql(queries[0].sql)).not.toMatch(/\bstatus = \$/);
    expect(queries[0].params).toEqual(["report-1", "escalated", "Передано юристу"]);
  });

  it("rejects invalid theft report admin status before querying", async () => {
    const { db, queries } = createMockDb();

    await expect(updateTheftReportAdminState(db, {
      id: "report-1",
      adminStatus: "paid" as never,
      adminNote: "bad status"
    })).rejects.toThrow("Invalid theft report admin status");

    expect(queries).toEqual([]);
  });
});

describe("wallet poll state repositories", () => {
  it("gets wallet poll state by watched wallet id", async () => {
    const updatedAt = new Date("2026-05-20T00:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        watched_wallet_id: "wallet-1",
        last_seen_block_ts: updatedAt,
        last_seen_tx_hash: "tx-1",
        backfill_anchor_block_ts: null,
        backfill_anchor_tx_hash: null,
        backfill_next_start: 0,
        backfill_complete: true,
        last_successful_poll_at: updatedAt,
        last_poll_event_count: 2,
        last_poll_new_count: 1,
        last_poll_error: null,
        updated_at: updatedAt
      }
    ]);

    const state = await getWalletPollState(db, "wallet-1");

    expect(state?.watchedWalletId).toBe("wallet-1");
    expect(state?.lastPollEventCount).toBe(2);
    expect(state?.lastPollNewCount).toBe(1);
    expect(state?.lastPollError).toBeNull();
    expect(queries[0].sql).toContain("from wallet_poll_state");
    expect(queries[0].params).toEqual(["wallet-1"]);
  });

  it("upserts wallet poll state keyed by watched wallet id", async () => {
    const now = new Date("2026-05-20T00:00:00.000Z");
    const { db, queries } = createMockDb();

    await upsertWalletPollState(db, {
      watchedWalletId: "wallet-1",
      lastSeenBlockTs: now,
      lastSeenTxHash: "tx-1",
      backfillAnchorBlockTs: now,
      backfillAnchorTxHash: "tx-anchor",
      backfillNextStart: 50,
      backfillComplete: true,
      lastSuccessfulPollAt: now
    });

    expect(queries[0].sql).toContain("on conflict (watched_wallet_id) do update");
    expect(queries[0].sql).toContain("updated_at = now()");
  });

  it("updates only provided wallet poll state fields", async () => {
    const { db, queries } = createMockDb();

    await updateWalletPollState(db, { watchedWalletId: "wallet-1", backfillComplete: true, backfillNextStart: 0 });

    expect(queries[0].sql).toContain("backfill_next_start = $2");
    expect(queries[0].sql).toContain("backfill_complete = $3");
    expect(queries[0].sql).toContain("updated_at = now()");
    expect(queries[0].params).toEqual(["wallet-1", 0, true]);
  });
});

describe("forensic check job repositories", () => {
  it("stores and reads cross-chain corridor result JSON without a provider", async () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    let storedResultJson: Record<string, unknown> = {};
    const queries: { sql: string; params: unknown[] }[] = [];
    const db = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes("update forensic_check_jobs")) {
          storedResultJson = params[3] as Record<string, unknown>;
          return { rowCount: 1, rows: [] };
        }
        return {
          rowCount: 1,
          rows: [
            {
              id: "job-1",
              kind: "where_is_money_check",
              subject_address: "TSubject",
              status: "completed",
              window_start: now,
              window_end: now,
              priority: 100,
              chat_id: null,
              message_id: null,
              requested_by: null,
              progress_json: {},
              result_json: storedResultJson,
              raw_evidence_ids: [],
              observation_ids: [],
              last_error: null,
              created_at: now,
              updated_at: now,
              started_at: now,
              completed_at: now
            }
          ]
        };
      }
    } as unknown as Db;
    const resultJson = {
      subjectAddress: "TSubject",
      crossChainCorridor: {
        triggered: true,
        partial: true,
        payloadRefs: [{ provider: "range", ref: "range:job-1" }]
      }
    };

    await completeForensicCheckJob(db, {
      id: "job-1",
      status: "completed",
      progressJson: {},
      resultJson,
      rawEvidenceIds: [],
      observationIds: [],
      lastError: null
    });
    const job = await getForensicCheckJob(db, "job-1");

    expect(job?.resultJson).toMatchObject({
      crossChainCorridor: {
        triggered: true,
        partial: true,
        payloadRefs: [{ provider: "range" }]
      }
    });
    expect(queries[1].sql).toContain("from forensic_check_jobs where id = $1");
  });
});

describe("approval guard repositories", () => {
  it("gets fresh cached address metadata", async () => {
    const fetchedAt = new Date("2026-05-23T00:00:00.000Z");
    const expiresAt = new Date("2026-05-24T00:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        address: "TSpender",
        source: "tronscan",
        name: "Bridgers",
        tag: null,
        is_contract: true,
        verified: null,
        account_type: 2,
        raw_json: { name: "Bridgers" },
        fetched_at: fetchedAt,
        expires_at: expiresAt
      }
    ]);

    const metadata = await getAddressMetadata(db, "TSpender", new Date("2026-05-23T01:00:00.000Z"));

    expect(metadata).toMatchObject({
      address: "TSpender",
      source: "tronscan",
      name: "Bridgers",
      isContract: true,
      accountType: 2
    });
    expect(queries[0].sql).toContain("from address_metadata");
    expect(queries[0].sql).toContain("expires_at > $2");
  });

  it("gets stale cached address metadata without applying expiry", async () => {
    const fetchedAt = new Date("2026-05-20T00:00:00.000Z");
    const expiresAt = new Date("2026-05-21T00:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        address: "TSpender",
        source: "tronscan",
        name: null,
        tag: "WhiteBIT",
        is_contract: false,
        verified: null,
        account_type: 0,
        raw_json: { tag: "WhiteBIT" },
        fetched_at: fetchedAt,
        expires_at: expiresAt
      }
    ]);

    const metadata = await getStaleAddressMetadata(db, "TSpender");

    expect(metadata).toMatchObject({
      address: "TSpender",
      source: "tronscan",
      tag: "WhiteBIT",
      isContract: false
    });
    expect(queries[0].sql).toContain("from address_metadata");
    expect(queries[0].sql).not.toContain("expires_at >");
    expect(queries[0].sql).toContain("order by fetched_at desc");
  });

  it("upserts address metadata cache entries", async () => {
    const { db, queries } = createMockDb();
    const fetchedAt = new Date("2026-05-23T00:00:00.000Z");
    const expiresAt = new Date("2026-05-24T00:00:00.000Z");

    await upsertAddressMetadata(db, {
      address: "TSpender",
      source: "tronscan",
      name: "Bridgers",
      tag: null,
      isContract: true,
      verified: null,
      accountType: 2,
      rawJson: { name: "Bridgers" },
      fetchedAt,
      expiresAt
    });

    expect(queries[0].sql).toContain("insert into address_metadata");
    expect(queries[0].sql).toContain("on conflict (address) do update");
    expect(queries[0].params).toContain("Bridgers");
  });

  it("gets and upserts contract intelligence profile cache entries", async () => {
    const fetchedAt = new Date("2026-05-23T00:00:00.000Z");
    const expiresAt = new Date("2026-05-24T00:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        contract_address: "TContract",
        provider_tags: [{ kind: "tag1", label: "Bridgers:Cross-chain Bridge", url: "bridgers.xyz" }],
        public_tags: [{ label: "Bridgers:Cross-chain Bridge", description: null }],
        is_verified: true,
        verify_status: 2,
        source_status: "available",
        provider_risk: false,
        contract_created_at: new Date("2024-07-20T18:36:00.000Z"),
        contract_age_days: 671,
        tx_count: "4380107",
        recent_call_count: "224309",
        total_call_count: "224309",
        total_caller_count: "45552",
        top_methods: [{ methodId: "d9caed12", signature: "withdraw(address,address,uint256)", count: 85070, ratio: 0.3793, method: "withdraw(address,address,uint256)", calls: 85070, percentage: 0.3793 }],
        top_callers: [{ address: "TCaller", addressTag: null, count: 136656, ratio: 0.6092, calls: 136656, percentage: 0.6092 }],
        method_map: { d9caed12: "withdraw(address,address,uint256)" },
        raw_payload: { source: "test" },
        fetched_at: fetchedAt,
        expires_at: expiresAt
      }
    ]);

    const profile = await getContractIntelligenceProfile(db, "TContract", new Date("2026-05-23T01:00:00.000Z"));
    await upsertContractIntelligenceProfile(db, profile!);

    expect(profile).toMatchObject({
      address: "TContract",
      serviceTag: "Bridgers:Cross-chain Bridge",
      verified: true,
      activityLevel: "high",
      topMethods: [{ method: "withdraw(address,address,uint256)", calls: 85070, percentage: 0.3793 }]
    });
    expect(queries[0].sql).toContain("from contract_intelligence_profiles");
    expect(queries[1].sql).toContain("insert into contract_intelligence_profiles");
    expect(queries[1].sql).toContain("on conflict (contract_address) do update");
  });

  it("gets and upserts contract LLM verdict cache entries", async () => {
    const createdAt = new Date("2026-05-24T00:00:00.000Z");
    const expiresAt = new Date("2026-06-23T00:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        id: "llm-cache-1",
        contract_address: "TContract",
        profile_hash: "profile-hash",
        contract_fingerprint_hash: "fingerprint-hash",
        cache_scope: "address_flow",
        flow_context_hash: "flow-hash",
        case_file_hash: "case-hash",
        policy_version: "2026-05-31-contract-llm-v2",
        provider_label: "deepseek",
        model: "deepseek-v4-flash",
        verdict_json: {
          source: "llm",
          providerLabel: "deepseek",
          model: "deepseek-v4-flash",
          contractAddress: "TContract",
          caseFileHash: "case-hash",
          cacheId: "llm-cache-1",
          verdict: "drainer_like",
          confidence: 0.82,
          contractRiskScore: 88,
          decisionRecommendation: "DECLINE",
          reasons: ["Wrapper method hides token movement."],
          citedEvidenceIds: ["tx-wrapper-drain"],
          falsePositiveNotes: []
        },
        request_case_hash: "case-hash",
        response_json: { verdict: "drainer_like" },
        error: null,
        latency_ms: 1200,
        created_at: createdAt,
        expires_at: expiresAt,
        updated_at: createdAt
      }
    ]);

    const cached = await getContractLlmVerdictCache(db, {
      contractAddress: "TContract",
      profileHash: "profile-hash",
      cacheScope: "address_flow",
      flowContextHash: "flow-hash",
      policyVersion: "2026-05-31-contract-llm-v2",
      model: "deepseek-v4-flash",
      now: createdAt
    });
    await upsertContractLlmVerdictCache(db, cached!);

    expect(cached).toMatchObject({
      id: "llm-cache-1",
      contractAddress: "TContract",
      profileHash: "profile-hash",
      contractFingerprintHash: "fingerprint-hash",
      cacheScope: "address_flow",
      flowContextHash: "flow-hash",
      verdict: {
        verdict: "drainer_like",
        contractRiskScore: 88
      }
    });
    expect(queries[0].sql).toContain("from contract_llm_verdict_cache");
    expect(queries[0].sql).toContain("expires_at > $5");
    expect(queries[0].sql).toContain("cache_scope = $6");
    expect(queries[0].sql).toContain("flow_context_hash is not distinct from $7");
    expect(queries[0].params).toEqual([
      "TContract",
      "profile-hash",
      "2026-05-31-contract-llm-v2",
      "deepseek-v4-flash",
      createdAt,
      "address_flow",
      "flow-hash"
    ]);
    expect(queries[1].sql).toContain("insert into contract_llm_verdict_cache");
    expect(queries[1].sql).toContain("cache_scope");
    expect(queries[1].sql).toContain("flow_context_hash");
    expect(queries[1].sql).toContain("on conflict (id) do update");
  });

  it("gets contract LLM verdict cache entries by exact fingerprint across contract addresses", async () => {
    const createdAt = new Date("2026-05-24T00:00:00.000Z");
    const expiresAt = new Date("2026-06-23T00:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        id: "llm-cache-1",
        contract_address: "TOriginalContract",
        profile_hash: "profile-hash",
        contract_fingerprint_hash: "fingerprint-hash",
        cache_scope: "address_flow",
        flow_context_hash: "flow-hash",
        case_file_hash: "case-hash",
        policy_version: "2026-05-31-contract-llm-v2",
        provider_label: "deepseek",
        model: "deepseek-v4-flash",
        verdict_json: {
          source: "llm",
          providerLabel: "deepseek",
          model: "deepseek-v4-flash",
          contractAddress: "TOriginalContract",
          caseFileHash: "case-hash",
          cacheId: "llm-cache-1",
          verdict: "drainer_like",
          confidence: 0.82,
          contractRiskScore: 88,
          decisionRecommendation: "DECLINE",
          reasons: ["Wrapper method hides token movement."],
          citedEvidenceIds: ["tx-wrapper-drain"],
          falsePositiveNotes: []
        },
        request_case_hash: "case-hash",
        response_json: { verdict: "drainer_like" },
        error: null,
        latency_ms: 1200,
        created_at: createdAt,
        expires_at: expiresAt,
        updated_at: createdAt
      }
    ]);

    const cached = await getContractLlmVerdictCacheByFingerprint(db, {
      contractFingerprintHash: "fingerprint-hash",
      cacheScope: "address_flow",
      flowContextHash: "flow-hash",
      policyVersion: "2026-05-31-contract-llm-v2",
      model: "deepseek-v4-flash",
      now: createdAt
    });

    expect(cached).toMatchObject({
      contractAddress: "TOriginalContract",
      contractFingerprintHash: "fingerprint-hash",
      cacheScope: "address_flow",
      flowContextHash: "flow-hash",
      verdict: { verdict: "drainer_like" }
    });
    expect(queries[0].sql).toContain("contract_fingerprint_hash = $1");
    expect(queries[0].sql).toContain("cache_scope = $2");
    expect(queries[0].sql).toContain("flow_context_hash is not distinct from $3");
    expect(queries[0].sql).toContain("order by updated_at desc");
    expect(queries[0].params).toEqual([
      "fingerprint-hash",
      "address_flow",
      "flow-hash",
      "2026-05-31-contract-llm-v2",
      "deepseek-v4-flash",
      createdAt
    ]);
  });

  it("gets approval poll state by watched wallet id", async () => {
    const updatedAt = new Date("2026-05-23T00:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        watched_wallet_id: "wallet-1",
        last_seen_approval_ts: new Date("2026-05-06T19:06:15.000Z"),
        last_seen_tx_hash: "approval-tx",
        last_successful_poll_at: updatedAt,
        last_error: null,
        updated_at: updatedAt
      }
    ]);

    const state = await getApprovalPollState(db, "wallet-1");

    expect(state).toMatchObject({
      watchedWalletId: "wallet-1",
      lastSeenTxHash: "approval-tx",
      lastError: null
    });
    expect(queries[0].sql).toContain("from wallet_approval_poll_state");
    expect(queries[0].params).toEqual(["wallet-1"]);
  });

  it("records approval poll success and clears prior errors", async () => {
    const { db, queries } = createMockDb();
    const now = new Date("2026-05-23T00:00:00.000Z");

    await recordApprovalPollSuccess(db, {
      watchedWalletId: "wallet-1",
      lastSeenApprovalTs: new Date("2026-05-06T19:06:15.000Z"),
      lastSeenTxHash: "approval-tx",
      lastSuccessfulPollAt: now
    });

    expect(queries[0].sql).toContain("insert into wallet_approval_poll_state");
    expect(queries[0].sql).toContain("last_error = null");
    expect(queries[0].params).toContain("approval-tx");
  });

  it("records approval poll failures without cursor fields", async () => {
    const { db, queries } = createMockDb();

    await recordApprovalPollFailure(db, { watchedWalletId: "wallet-1", error: "x".repeat(3000) });

    expect(queries[0].sql).toContain("insert into wallet_approval_poll_state");
    expect(queries[0].sql).toContain("last_error");
    expect(queries[0].params[1]).toHaveLength(1024);
  });

  it("upserts the wallet approval read model", async () => {
    const { db, queries } = createMockDb();

    await upsertWalletApproval(db, {
      watchedWalletId: "wallet-1",
      tokenContract: "TR7",
      spenderAddress: "TSpender",
      amountRaw: "999",
      isUnlimited: true,
      spenderType: "eoa",
      lastApprovalTxHash: "approval-tx",
      lastApprovalAt: new Date("2026-05-06T19:06:15.000Z"),
      riskLevel: "HIGH",
      riskScore: 80,
      riskReasons: [{ code: "approval_unlimited_usdt", message: "Unlimited", scoreImpact: 80 }],
      lastAlertedTxHash: "approval-tx"
    });

    expect(queries[0].sql).toContain("insert into wallet_approvals");
    expect(queries[0].sql).toContain("on conflict (watched_wallet_id, token_contract, spender_address) do update");
    expect(queries[0].params).toContain("TSpender");
    expect(queries[0].params).toContain("HIGH");
  });

  it("lists wallet approvals by spender for a telegram user", async () => {
    const updatedAt = new Date("2026-05-23T00:00:00.000Z");
    const telegramUserId = "42";
    const spenderAddress = "TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5";
    const { db, queries } = createMockDb(1, [
      {
        watched_wallet_id: "wallet-1",
        token_contract: "TR7",
        spender_address: spenderAddress,
        amount_raw: "999",
        is_unlimited: true,
        current_allowance_raw: "999",
        spender_type: "contract",
        status: "active",
        last_approval_tx_hash: "approval-tx",
        last_approval_at: updatedAt,
        risk_level: "HIGH",
        risk_score: 80,
        risk_reasons: [{ code: "approval_unlimited_usdt", message: "Unlimited", scoreImpact: 80 }],
        last_alerted_tx_hash: null,
        updated_at: updatedAt,
        metadata_name: "Suspicious spender",
        metadata_tag: "Risky DApp",
        metadata_source: "tronscan",
        metadata_is_contract: true,
        contract_service_tag: "Risky DApp",
        contract_verified: false,
        contract_activity_level: "normal",
        contract_top_methods: [{ method: "transferFrom(address,address,uint256)", calls: 10, percentage: 0.5 }],
        contract_has_transfer_from_selector: true,
        contract_has_owner_only_pattern: false,
        approval_context_status: "resolved",
        approval_context_result: "collector_drain",
        approval_context_deadline_at: updatedAt,
        approval_final_context_alert_sent_at: updatedAt,
        watched_wallet_address: "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe",
        watched_wallet_telegram_user_id: telegramUserId
      }
    ]);

    const relations = await listWalletApprovalsBySpenderForTelegramUser(db, { telegramUserId, spenderAddress });

    expect(queries[0].sql).toContain("join watched_wallets w");
    expect(queries[0].sql).toContain("left join address_metadata am");
    expect(queries[0].sql).toContain("left join contract_intelligence_profiles cip");
    expect(queries[0].sql).toContain("left join observed_approval_events oae");
    expect(queries[0].sql).toContain("oae.token_contract = wa.token_contract");
    expect(queries[0].sql).toContain("oae.owner_address = w.address");
    expect(queries[0].sql).toContain("wa.spender_address = $2");
    expect(queries[0].params).toEqual([telegramUserId, spenderAddress]);
    expect(relations[0]).toMatchObject({
      watchedWalletAddress: "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe",
      watchedWalletTelegramUserId: telegramUserId,
      spenderAddress: "TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5",
      isUnlimited: true,
      status: "active",
      metadataName: "Suspicious spender",
      contractHasTransferFromSelector: true,
      approvalContextStatus: "resolved",
      approvalContextResult: "collector_drain"
    });
  });

  it("atomically claims observed approval events", async () => {
    const { db, queries } = createMockDb(1);

    const claimed = await claimObservedApprovalEvent(db, {
      approvalTxHash: "approval-tx",
      watchedWalletId: "wallet-1",
      ownerAddress: "TOwner",
      tokenContract: "TR7",
      spenderAddress: "TSpender",
      spenderType: "eoa",
      amountRaw: "999",
      isUnlimited: true,
      approvalAt: new Date("2026-05-06T19:06:15.000Z")
    });

    expect(claimed).toBe(true);
    expect(queries[0].sql).toContain("insert into observed_approval_events");
    expect(queries[0].sql).toContain("'sending'");
    expect(queries[0].sql).toContain("on conflict");
  });

  it("records approval risk and alert status transitions", async () => {
    const { db, queries } = createMockDb(1);

    await recordApprovalRisk(db, {
      approvalTxHash: "approval-tx",
      watchedWalletId: "wallet-1",
      report: {
        subjectAddress: "TSpender",
        level: "HIGH",
        score: 80,
        reasons: [{ code: "approval_unlimited_usdt", message: "Unlimited", scoreImpact: 80 }]
      }
    });
    await markApprovalOwnerAlertSent(db, { approvalTxHash: "approval-tx", watchedWalletId: "wallet-1" });
    await markApprovalOwnerAlertSkipped(db, { approvalTxHash: "approval-tx", watchedWalletId: "wallet-1", reason: "paused" });
    await markApprovalOwnerAlertFailed(db, { approvalTxHash: "approval-tx", watchedWalletId: "wallet-1", error: "send failed" });

    expect(queries[0].sql).toContain("risk_level = $3");
    expect(queries[1].sql).toContain("owner_alert_status = 'sent'");
    expect(queries[2].sql).toContain("owner_alert_status = 'skipped'");
    expect(queries[3].sql).toContain("owner_alert_status = 'failed'");
  });

  it("records and claims approval context follow-up lifecycle rows", async () => {
    const now = new Date("2026-05-05T13:53:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        approval_tx_hash: "approval-tx",
        watched_wallet_id: "wallet-1",
        owner_address: "TOwner",
        token_contract: "TR7",
        spender_address: "TSpender",
        spender_type: "contract",
        amount_raw: "999",
        is_unlimited: true,
        approval_at: now,
        owner_alert_status: "sent",
        owner_alert_attempts: 0,
        owner_alert_last_error: null,
        owner_alert_updated_at: now,
        risk_level: "HIGH",
        risk_score: 70,
        risk_reasons: [],
        created_at: now,
        context_status: "finalizing",
        context_deadline_at: now,
        context_result: "unknown",
        initial_risk_level: "HIGH",
        initial_risk_score: 70,
        initial_risk_reasons: [],
        final_risk_level: null,
        final_risk_score: null,
        final_risk_reasons: [],
        final_context_alert_sent_at: null,
        context_last_error: null,
        context_updated_at: now,
        wallet_id: "wallet-1",
        wallet_telegram_user_id: "42",
        wallet_username: "tester",
        wallet_address: "TOwner",
        wallet_created_at: now,
        wallet_alert_mode: "realtime",
        wallet_digest_interval_minutes: 10
      }
    ]);
    const report = {
      subjectAddress: "TSpender",
      level: "HIGH" as const,
      score: 70,
      reasons: [{ code: "approval_context_pending", message: "Pending context", scoreImpact: 10 }]
    };

    await markApprovalContextPending(db, {
      approvalTxHash: "approval-tx",
      watchedWalletId: "wallet-1",
      contextDeadlineAt: now,
      initialReport: report
    });
    const claimed = await claimDueApprovalContexts(db, { now, limit: 10 });
    await markApprovalContextResolved(db, {
      approvalTxHash: "approval-tx",
      watchedWalletId: "wallet-1",
      result: "linked_swap_route",
      finalReport: { ...report, level: "MEDIUM", score: 35 }
    });
    await markApprovalContextExpired(db, {
      approvalTxHash: "approval-tx",
      watchedWalletId: "wallet-1",
      finalReport: report
    });
    await markApprovalContextFinalAlertSent(db, { approvalTxHash: "approval-tx", watchedWalletId: "wallet-1", sentAt: now });
    await releaseApprovalContextAfterFailure(db, { approvalTxHash: "approval-tx", watchedWalletId: "wallet-1", error: "TronScan timeout" });

    expect(claimed[0]).toMatchObject({
      approvalTxHash: "approval-tx",
      contextStatus: "finalizing",
      wallet: {
        id: "wallet-1",
        telegramUserId: "42"
      }
    });
    expect(queries[0].sql).toContain("context_status = 'pending'");
    expect(queries[1].sql).toContain("for update skip locked");
    expect(queries[2].sql).toContain("context_status = 'resolved'");
    expect(queries[3].sql).toContain("context_status = 'expired'");
    expect(queries[4].sql).toContain("final_context_alert_sent_at");
    expect(queries[5].sql).toContain("context_status = 'pending'");
  });

  it("atomically claims observed approval drain events in shadow mode", async () => {
    const { db, queries } = createMockDb(1);

    const claimed = await claimObservedApprovalDrainEvent(db, {
      id: "drain-1",
      watchedWalletId: "wallet-1",
      approvalTxHash: "approval-tx",
      transferTxHash: "transfer-tx",
      ownerAddress: "TOwner",
      spenderAddress: "TSpender",
      receiverAddress: "TReceiver",
      tokenContract: "TR7",
      amountRaw: "320652450320",
      callerAddress: "TSpender",
      method: "transferFrom",
      approvalAt: new Date("2026-05-06T19:06:15.000Z"),
      transferAt: new Date("2026-05-09T10:13:12.000Z"),
      timeToTransferMs: 228_417_000,
      spenderType: "eoa",
      receiverType: "eoa",
      report: {
        subjectAddress: "TSpender",
        level: "CRITICAL",
        score: 95,
        reasons: [{ code: "approval_drain_unknown_eoa_spender", message: "EOA spender", scoreImpact: 60 }]
      },
      rawEvidenceId: "evidence-1"
    });

    expect(claimed).toBe(true);
    expect(queries[0].sql).toContain("insert into observed_approval_drain_events");
    expect(queries[0].sql).toContain("'shadow'");
    expect(queries[0].sql).toContain("on conflict");
    expect(queries[0].params).toContain("transferFrom");
    expect(queries[0].params).toContain("CRITICAL");
  });

  it("lists observed approval drain events for a wallet", async () => {
    const transferAt = new Date("2026-05-09T10:13:12.000Z");
    const { db, queries } = createMockDb(1, [
      {
        id: "drain-1",
        watched_wallet_id: "wallet-1",
        approval_tx_hash: "approval-tx",
        transfer_tx_hash: "transfer-tx",
        owner_address: "TOwner",
        spender_address: "TSpender",
        receiver_address: "TReceiver",
        token_contract: "TR7",
        amount_raw: "320652450320",
        caller_address: "TSpender",
        method: "transferFrom",
        approval_at: new Date("2026-05-06T19:06:15.000Z"),
        transfer_at: transferAt,
        time_to_transfer_ms: "228417000",
        spender_type: "eoa",
        receiver_type: "eoa",
        observed_mode: "shadow",
        risk_level: "CRITICAL",
        risk_score: 95,
        risk_reasons: [{ code: "approval_drain_unknown_eoa_spender", message: "EOA spender", scoreImpact: 60 }],
        raw_evidence_id: "evidence-1",
        created_at: transferAt,
        updated_at: transferAt
      }
    ]);

    const observations = await listWalletApprovalDrainObservations(db, "wallet-1", 5);

    expect(observations[0]).toMatchObject({
      id: "drain-1",
      transferTxHash: "transfer-tx",
      receiverAddress: "TReceiver",
      riskLevel: "CRITICAL",
      riskScore: 95
    });
    expect(queries[0].sql).toContain("from observed_approval_drain_events");
    expect(queries[0].params).toEqual(["wallet-1", 5]);
  });

  it("builds a wallet approval summary from current approvals", async () => {
    const updatedAt = new Date("2026-05-23T00:00:00.000Z");
    const queries: { sql: string; params: unknown[] }[] = [];
    const approvalRows = [
      {
        watched_wallet_id: "wallet-1",
        token_contract: "TR7",
        spender_address: "TSpenderRisk",
        amount_raw: "999",
        is_unlimited: true,
        current_allowance_raw: "999",
        spender_type: "eoa",
        status: "active",
        last_approval_tx_hash: "tx-1",
        last_approval_at: updatedAt,
        risk_level: "HIGH",
        risk_score: 80,
        risk_reasons: [{ code: "approval_unlimited_usdt", message: "Unlimited", scoreImpact: 80 }],
        last_alerted_tx_hash: "tx-1",
        metadata_name: null,
        metadata_tag: null,
        metadata_source: null,
        metadata_is_contract: false,
        contract_service_tag: null,
        contract_verified: null,
        contract_activity_level: null,
        contract_top_methods: [],
        contract_has_transfer_from_selector: null,
        contract_has_owner_only_pattern: null,
        approval_context_status: "resolved",
        approval_context_result: "linked_swap_route",
        approval_context_deadline_at: updatedAt,
        approval_final_context_alert_sent_at: updatedAt,
        updated_at: updatedAt
      },
      {
        watched_wallet_id: "wallet-1",
        token_contract: "TR7",
        spender_address: "TSpenderLow",
        amount_raw: "1",
        is_unlimited: false,
        current_allowance_raw: "1",
        spender_type: "contract",
        status: "active",
        last_approval_tx_hash: "tx-2",
        last_approval_at: updatedAt,
        risk_level: "LOW",
        risk_score: 0,
        risk_reasons: [],
        last_alerted_tx_hash: null,
        metadata_name: null,
        metadata_tag: null,
        metadata_source: null,
        metadata_is_contract: true,
        contract_service_tag: "Known service",
        contract_verified: true,
        contract_activity_level: "normal",
        contract_top_methods: [{ method: "swap(address,string,string,uint256,uint256)", calls: 10, percentage: 1 }],
        contract_has_transfer_from_selector: false,
        contract_has_owner_only_pattern: false,
        approval_context_status: null,
        approval_context_result: null,
        approval_context_deadline_at: null,
        approval_final_context_alert_sent_at: null,
        updated_at: updatedAt
      }
    ];
    const drainRows = [
      {
        id: "drain-1",
        watched_wallet_id: "wallet-1",
        approval_tx_hash: "approval-tx",
        transfer_tx_hash: "transfer-tx",
        owner_address: "TOwner",
        spender_address: "TSpenderRisk",
        receiver_address: "TReceiver",
        token_contract: "TR7",
        amount_raw: "320652450320",
        caller_address: "TSpenderRisk",
        method: "transferFrom",
        approval_at: updatedAt,
        transfer_at: updatedAt,
        time_to_transfer_ms: "1000",
        spender_type: "eoa",
        receiver_type: "eoa",
        observed_mode: "shadow",
        risk_level: "CRITICAL",
        risk_score: 95,
        risk_reasons: [{ code: "approval_drain_unknown_eoa_spender", message: "EOA spender", scoreImpact: 60 }],
        raw_evidence_id: "evidence-1",
        created_at: updatedAt,
        updated_at: updatedAt
      }
    ];
    const db = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes("from wallet_approvals")) return { rowCount: approvalRows.length, rows: approvalRows };
        if (sql.includes("count(*)") && sql.includes("from observed_approval_drain_events")) {
          return { rowCount: 1, rows: [{ total_count: 1, high_risk_count: 1 }] };
        }
        return { rowCount: drainRows.length, rows: drainRows };
      }
    } as unknown as Db;

    const summary = await getWalletApprovalSummary(db, "wallet-1");

    expect(summary.usdtApprovalCount).toBe(2);
    expect(summary.unlimitedApprovalCount).toBe(1);
    expect(summary.highRiskApprovalCount).toBe(1);
    expect(summary.topRiskyApprovals[0].spenderAddress).toBe("TSpenderRisk");
    expect(summary.topRiskyApprovals[0].approvalContextStatus).toBe("resolved");
    expect(summary.topRiskyApprovals[0].approvalContextResult).toBe("linked_swap_route");
    expect(summary.drainObservationCount).toBe(1);
    expect(summary.highRiskDrainObservationCount).toBe(1);
    expect(summary.topDrainObservations[0].transferTxHash).toBe("transfer-tx");
  });
});

const addressIndexNow = new Date("2026-07-02T00:00:00.000Z");

function tronAddressIndexStateRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    address: "TSubject111111111111111111111111111111",
    token_contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    coverage_mode: "all_time",
    coverage_kind: "provider_windowed",
    target_timestamp_ms: 0,
    target_timestamp: null,
    status: "queued",
    status_reason: null,
    provider: null,
    total_reported: null,
    fetched_transfer_count: 0,
    unique_counterparty_count: 0,
    newest_transfer_at: null,
    oldest_transfer_at: null,
    covered_until_timestamp: null,
    fetched_page_count: 0,
    planned_page_count: null,
    current_end_timestamp: null,
    provider_cap_hit: false,
    budget_exhausted: false,
    provider_inconsistent: false,
    priority: 0,
    next_run_at: addressIndexNow,
    attempt_count: 0,
    max_attempts: 5,
    retry_count: 0,
    last_error: null,
    last_error_class: null,
    last_successful_page_at: null,
    queued_reason: "deep_subject",
    requested_by_job_id: "job-1",
    locked_at: null,
    locked_until: null,
    heartbeat_at: null,
    lock_owner: null,
    budget_pages: null,
    budget_seconds: null,
    completed_at: null,
    created_at: addressIndexNow,
    updated_at: addressIndexNow,
    ...overrides
  };
}

function tronAddressIndexPageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    address: "TSubject111111111111111111111111111111",
    token_contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    coverage_mode: "all_time",
    target_timestamp_ms: 0,
    window_start_timestamp_ms: 0,
    window_end_timestamp_ms: 1_780_100_000_000,
    start_offset: 50,
    limit_count: 50,
    status: "complete",
    transfer_count: 50,
    provider: "tronscan",
    total_reported: 12500,
    range_total: 10000,
    raw_response_hash: "raw-hash",
    canonical_transfer_hash: "canonical-hash",
    attempt_count: 1,
    error: null,
    newest_transfer_at: new Date("2026-06-14T15:05:15.000Z"),
    oldest_transfer_at: new Date("2026-06-09T10:50:36.000Z"),
    created_at: addressIndexNow,
    updated_at: addressIndexNow,
    ...overrides
  };
}

describe("TRON address USDT index repositories", () => {
  it("migration normalizes broad candidate hashes before identity constraints", () => {
    const sql = readFileSync("migrations/028_candidate_window_indexing.sql", "utf8");

    expect(sql.indexOf("drop constraint if exists tron_address_usdt_index_states_window_check")).toBeLessThan(
      sql.indexOf("update tron_address_usdt_index_states")
    );
    expect(sql.indexOf("drop constraint if exists forensic_job_waits_window_check")).toBeLessThan(
      sql.indexOf("update forensic_job_waits")
    );
    expect(sql).toContain("set candidate_tx_hash = ''");
    expect(sql).toContain("alter column candidate_tx_hash set default ''");
    expect(sql).toContain("alter column candidate_tx_hash set not null");
    expect(sql).toContain("do $$");
    expect(sql).toContain("from pg_constraint c");
    expect(sql).toContain("drop constraint if exists forensic_job_waits_identity_unique");
    expect(sql).toContain("forensic_job_waits_identity_unique");
  });

  it("upserts and reads TRON address USDT index state", async () => {
    const { db, queries } = createSequencedMockDb([{ rows: [tronAddressIndexStateRow()] }]);

    const state = await upsertTronAddressUsdtIndexState(db, {
      address: "TSubject111111111111111111111111111111",
      coverageMode: "all_time",
      status: "queued",
      queuedReason: "deep_subject",
      requestedByJobId: "job-1"
    });

    expect(state.status).toBe("queued");
    expect(state.coverageKind).toBe("provider_windowed");
    expect(state.queuedReason).toBe("deep_subject");
    expect(queries[0].sql).toContain("insert into tron_address_usdt_index_states");

    const readDb = createSequencedMockDb([{ rows: [tronAddressIndexStateRow({ total_reported: 77 })] }]);
    const readState = await getTronAddressUsdtIndexState(readDb.db, {
      address: "TSubject111111111111111111111111111111",
      coverageMode: "all_time"
    });
    expect(readState?.totalReported).toBe(77);
  });

  it("upsert preserves an existing requested owner before incoming owner", async () => {
    const { db, queries } = createSequencedMockDb([
      { rows: [tronAddressIndexStateRow({ requested_by_job_id: "original-job" })] }
    ]);

    const state = await upsertTronAddressUsdtIndexState(db, {
      address: "TSubject111111111111111111111111111111",
      coverageMode: "targeted",
      targetTimestamp: new Date("2026-06-01T00:00:00.000Z"),
      status: "queued",
      queuedReason: "where_is_money_hop",
      requestedByJobId: "new-job"
    });

    expect(state.requestedByJobId).toBe("original-job");
    expect(queries[0].sql).toContain(
      "requested_by_job_id = coalesce(tron_address_usdt_index_states.requested_by_job_id, excluded.requested_by_job_id)"
    );
    expect(queries[0].sql).not.toContain(
      "requested_by_job_id = coalesce(excluded.requested_by_job_id, tron_address_usdt_index_states.requested_by_job_id)"
    );
  });

  it("upsert still passes incoming requested owner for first assignment", async () => {
    const { db, queries } = createSequencedMockDb([
      { rows: [tronAddressIndexStateRow({ requested_by_job_id: "new-job" })] }
    ]);

    const state = await upsertTronAddressUsdtIndexState(db, {
      address: "TSubject111111111111111111111111111111",
      coverageMode: "targeted",
      targetTimestamp: new Date("2026-06-01T00:00:00.000Z"),
      status: "queued",
      queuedReason: "where_is_money_hop",
      requestedByJobId: "new-job"
    });

    expect(state.requestedByJobId).toBe("new-job");
    expect(queries[0].sql).toContain(
      "requested_by_job_id = coalesce(tron_address_usdt_index_states.requested_by_job_id, excluded.requested_by_job_id)"
    );
    expect(queries[0].params[28]).toBe("new-job");
  });

  it("upsert preserves claim locks while refreshing running index state", async () => {
    const { db, queries } = createSequencedMockDb([{ rows: [tronAddressIndexStateRow({ status: "running" })] }]);

    await upsertTronAddressUsdtIndexState(db, {
      address: "TSubject111111111111111111111111111111",
      coverageMode: "targeted",
      targetTimestamp: new Date("2026-06-01T00:00:00.000Z"),
      status: "running",
      queuedReason: "where_is_money_hop"
    });

    expect(queries[0].sql).toContain("when excluded.status in ('complete', 'partial', 'failed_terminal') then excluded.locked_until");
    expect(queries[0].sql).toContain("else coalesce(excluded.locked_until, tron_address_usdt_index_states.locked_until)");
    expect(queries[0].sql).toContain("else coalesce(excluded.lock_owner, tron_address_usdt_index_states.lock_owner)");
  });

  it("queue helper uses a guarded upsert without clearing locks when merging queued rows", async () => {
    const lockedAt = new Date("2026-07-02T00:01:00.000Z");
    const queuedDb = createSequencedMockDb([
      {
        rows: [
          tronAddressIndexStateRow({
            status: "queued",
            fetched_transfer_count: 123,
            fetched_page_count: 4,
            priority: 9,
            budget_pages: 10,
            locked_at: lockedAt,
            locked_until: new Date("2026-07-02T00:11:00.000Z"),
            heartbeat_at: lockedAt,
            lock_owner: "worker-a"
          })
        ]
      }
    ]);

    const state = await queueTronAddressUsdtIndexState(queuedDb.db, {
      address: "TSubject111111111111111111111111111111",
      coverageMode: "all_time",
      queuedReason: "deep_subject",
      priority: 9
    });

    expect(state.fetchedTransferCount).toBe(123);
    expect(state.lockOwner).toBe("worker-a");
    expect(queuedDb.queries).toHaveLength(1);
    expect(queuedDb.queries[0].sql).toContain("request_kind, window_start_timestamp_ms, candidate_tx_hash");
    expect(compactSql(queuedDb.queries[0].sql)).toContain(
      "on conflict (address, token_contract, coverage_mode, target_timestamp_ms, request_kind, window_start_timestamp_ms, candidate_tx_hash) do update set"
    );
    expect(queuedDb.queries[0].sql).toContain("status not in ('complete', 'running', 'failed_terminal')");
    expect(queuedDb.queries[0].sql).toContain("status = 'partial'");
    expect(queuedDb.queries[0].sql).toContain("status = 'failed_retryable'");
    expect(queuedDb.queries[0].sql).toContain("next_run_at > now()");
    expect(queuedDb.queries[0].sql).not.toContain("locked_at =");
    expect(queuedDb.queries[0].sql).not.toContain("locked_until =");
    expect(queuedDb.queries[0].sql).not.toContain("heartbeat_at =");
    expect(queuedDb.queries[0].sql).not.toContain("lock_owner =");
    expect(queuedDb.queries[0].sql).not.toContain("fetched_transfer_count =");
    expect(queuedDb.queries[0].params[6]).toBe(9);
  });

  it("queue helper preserves existing requested owner when requeueing targeted rows", async () => {
    const queuedDb = createSequencedMockDb([
      {
        rows: [
          tronAddressIndexStateRow({
            coverage_mode: "targeted",
            target_timestamp_ms: 1_780_100_000_000,
            target_timestamp: new Date("2026-06-01T00:00:00.000Z"),
            requested_by_job_id: "original-job"
          })
        ]
      }
    ]);

    const state = await queueTronAddressUsdtIndexState(queuedDb.db, {
      address: "TSubject111111111111111111111111111111",
      coverageMode: "targeted",
      targetTimestamp: new Date("2026-06-01T00:00:00.000Z"),
      queuedReason: "where_is_money_hop",
      requestedByJobId: "new-job"
    });

    expect(state.requestedByJobId).toBe("original-job");
    expect(queuedDb.queries).toHaveLength(1);
    expect(queuedDb.queries[0].sql).toContain(
      "requested_by_job_id = coalesce(tron_address_usdt_index_states.requested_by_job_id, excluded.requested_by_job_id)"
    );
    expect(queuedDb.queries[0].params[5]).toBe("new-job");
  });

  it("queue helper can requeue a stale running targeted state and clear stale locks", async () => {
    const queuedDb = createSequencedMockDb([
      {
        rows: [
          tronAddressIndexStateRow({
            coverage_mode: "targeted",
            target_timestamp_ms: 1_780_100_000_000,
            target_timestamp: new Date("2026-06-01T00:00:00.000Z"),
            status: "queued",
            budget_pages: 4000,
            max_attempts: 17,
            locked_at: null,
            locked_until: null,
            heartbeat_at: null,
            lock_owner: null
          })
        ]
      }
    ]);

    const state = await queueTronAddressUsdtIndexState(queuedDb.db, {
      address: "TSubject111111111111111111111111111111",
      coverageMode: "targeted",
      targetTimestamp: new Date("2026-06-01T00:00:00.000Z"),
      queuedReason: "where_is_money_hop",
      budgetPages: 4000,
      maxAttempts: 17,
      allowRunningRequeue: true
    });

    expect(state.status).toBe("queued");
    expect(state.budgetPages).toBe(4000);
    expect(queuedDb.queries).toHaveLength(1);
    expect(queuedDb.queries[0].sql).toContain("or tron_address_usdt_index_states.status = 'running'");
    expect(queuedDb.queries[0].sql).toContain("locked_at = null");
    expect(queuedDb.queries[0].sql).toContain("locked_until = null");
    expect(queuedDb.queries[0].sql).toContain("heartbeat_at = null");
    expect(queuedDb.queries[0].sql).toContain("lock_owner = null");
  });

  it("queue helper reselects states rejected by the guarded requeue checks", async () => {
    const blockedStates = [
      { status: "complete" },
      { status: "running" },
      { status: "failed_terminal" },
      { status: "partial", coverage_mode: "all_time" },
      { status: "failed_retryable", next_run_at: new Date("2026-07-03T00:00:00.000Z") }
    ] as const;

    for (const overrides of blockedStates) {
      const db = createSequencedMockDb([
        { rows: [] },
        { rows: [tronAddressIndexStateRow(overrides)] }
      ]);
      const state = await queueTronAddressUsdtIndexState(db.db, {
        address: "TSubject111111111111111111111111111111",
        coverageMode: "all_time",
        queuedReason: "deep_subject"
      });
      expect(state.status).toBe(overrides.status);
      expect(db.queries).toHaveLength(2);
      expect(db.queries[0].sql).toContain("status not in ('complete', 'running', 'failed_terminal')");
      expect(db.queries[1].sql).toContain("from tron_address_usdt_index_states");
    }
  });

  it("stores multiple candidate-window targeted states for one address and end timestamp", async () => {
    const end = new Date("2026-07-04T12:00:00.000Z");
    const firstStart = new Date("2026-07-04T11:55:00.000Z");
    const secondStart = new Date("2026-07-04T11:58:00.000Z");
    const db = createSequencedMockDb([
      {
        rows: [tronAddressIndexStateRow({
          coverage_mode: "targeted",
          target_timestamp_ms: end.getTime(),
          target_timestamp: end,
          request_kind: "candidate_window",
          window_start_timestamp_ms: firstStart.getTime(),
          window_start_timestamp: firstStart,
          window_end_timestamp_ms: end.getTime(),
          window_end_timestamp: end,
          related_hop_tx_hash: "hop-tx-1",
          candidate_tx_hash: "candidate-tx-1"
        })]
      },
      {
        rows: [tronAddressIndexStateRow({
          coverage_mode: "targeted",
          target_timestamp_ms: end.getTime(),
          target_timestamp: end,
          request_kind: "candidate_window",
          window_start_timestamp_ms: secondStart.getTime(),
          window_start_timestamp: secondStart,
          window_end_timestamp_ms: end.getTime(),
          window_end_timestamp: end,
          related_hop_tx_hash: "hop-tx-1",
          candidate_tx_hash: "candidate-tx-2"
        })]
      },
      {
        rows: [tronAddressIndexStateRow({
          coverage_mode: "targeted",
          target_timestamp_ms: end.getTime(),
          target_timestamp: end,
          request_kind: "candidate_window",
          window_start_timestamp_ms: firstStart.getTime(),
          window_start_timestamp: firstStart,
          window_end_timestamp_ms: end.getTime(),
          window_end_timestamp: end,
          related_hop_tx_hash: "hop-tx-1",
          candidate_tx_hash: "candidate-tx-1"
        })]
      },
      {
        rows: [tronAddressIndexStateRow({
          coverage_mode: "targeted",
          target_timestamp_ms: end.getTime(),
          target_timestamp: end,
          request_kind: "candidate_window",
          window_start_timestamp_ms: secondStart.getTime(),
          window_start_timestamp: secondStart,
          window_end_timestamp_ms: end.getTime(),
          window_end_timestamp: end,
          related_hop_tx_hash: "hop-tx-1",
          candidate_tx_hash: "candidate-tx-2"
        })]
      }
    ]);

    await queueTronAddressUsdtIndexState(db.db, {
      address: "TCandidateWindow1111111111111111111111111",
      coverageMode: "targeted",
      requestKind: "candidate_window",
      windowStartTimestamp: firstStart,
      windowEndTimestamp: end,
      targetTimestamp: end,
      relatedHopTxHash: "hop-tx-1",
      candidateTxHash: "candidate-tx-1",
      queuedReason: "where_candidate_window",
      requestedByJobId: "where-job-1"
    });

    await queueTronAddressUsdtIndexState(db.db, {
      address: "TCandidateWindow1111111111111111111111111",
      coverageMode: "targeted",
      requestKind: "candidate_window",
      windowStartTimestamp: secondStart,
      windowEndTimestamp: end,
      targetTimestamp: end,
      relatedHopTxHash: "hop-tx-1",
      candidateTxHash: "candidate-tx-2",
      queuedReason: "where_candidate_window",
      requestedByJobId: "where-job-1"
    });

    const first = await getTronAddressUsdtIndexState(db.db, {
      address: "TCandidateWindow1111111111111111111111111",
      coverageMode: "targeted",
      requestKind: "candidate_window",
      windowStartTimestamp: firstStart,
      windowEndTimestamp: end,
      candidateTxHash: "candidate-tx-1"
    });
    const second = await getTronAddressUsdtIndexState(db.db, {
      address: "TCandidateWindow1111111111111111111111111",
      coverageMode: "targeted",
      requestKind: "candidate_window",
      windowStartTimestamp: secondStart,
      windowEndTimestamp: end,
      candidateTxHash: "candidate-tx-2"
    });

    expect(first?.candidateTxHash).toBe("candidate-tx-1");
    expect(second?.candidateTxHash).toBe("candidate-tx-2");
    expect(first?.windowStartTimestamp?.toISOString()).toBe(firstStart.toISOString());
    expect(second?.windowStartTimestamp?.toISOString()).toBe(secondStart.toISOString());
    expect(db.queries[0].sql).toContain("request_kind");
    expect(db.queries[0].sql).toContain("window_start_timestamp_ms");
    expect(db.queries[0].sql).toContain("candidate_tx_hash");
    expect(db.queries[0].sql).toContain("on conflict (");
    expect(db.queries[2].sql).toContain("request_kind = $4");
    expect(db.queries[2].sql).toContain("window_start_timestamp_ms = $5");
    expect(db.queries[2].sql).toContain("coalesce(candidate_tx_hash, '') = $6");
  });

  it("derives candidate-window lookup target timestamp from window end when target is omitted", async () => {
    const end = new Date("2026-07-04T12:00:00.000Z");
    const start = new Date("2026-07-04T11:55:00.000Z");
    const { db, queries } = createMockDb(1, [tronAddressIndexStateRow({
      coverage_mode: "targeted",
      target_timestamp_ms: end.getTime(),
      target_timestamp: end,
      request_kind: "candidate_window",
      window_start_timestamp_ms: start.getTime(),
      window_start_timestamp: start,
      window_end_timestamp_ms: end.getTime(),
      window_end_timestamp: end,
      candidate_tx_hash: "candidate-tx-1"
    })]);

    await getTronAddressUsdtIndexState(db, {
      address: "TCandidateWindow3333333333333333333333333",
      coverageMode: "targeted",
      requestKind: "candidate_window",
      windowStartTimestamp: start,
      windowEndTimestamp: end,
      candidateTxHash: "candidate-tx-1"
    });

    expect(queries[0].params[2]).toBe(end.getTime());
    expect(queries[0].params[3]).toBe("candidate_window");
    expect(queries[0].params[4]).toBe(start.getTime());
    expect(queries[0].params[5]).toBe("candidate-tx-1");
  });

  it("does not use candidate-window state as broad targeted coverage", async () => {
    const db = createMockDb(0, []);

    await getCoveringTronAddressUsdtIndexState(db.db, {
      address: "TCandidateWindow2222222222222222222222222",
      coverageMode: "targeted",
      targetTimestamp: new Date("2026-07-04T11:59:00.000Z")
    });

    expect(db.queries[0].sql).toContain("request_kind = 'broad_targeted'");
  });

  it("claims queued TRON address index states with skip-locked queue ordering", async () => {
    const { db, queries } = createMockDb(0, []);

    await claimQueuedTronAddressUsdtIndexStates(db, {
      limit: 3,
      lockOwner: "worker-a",
      lockMs: 600_000,
      coverageMode: "all_time"
    });

    expect(queries[0].sql).toContain("for update skip locked");
    expect(queries[0].sql).toContain("status in ('queued', 'failed_retryable')");
    expect(queries[0].sql).toContain("status = 'running' and (locked_until is null or locked_until < now())");
    expect(queries[0].sql).toContain("status as claim_previous_status");
    expect(queries[0].sql).toContain("candidates.claim_previous_status");
    expect(queries[0].sql).toContain("next_run_at <= now()");
    expect(queries[0].sql).toContain("not exists");
    expect(queries[0].sql).toContain("newer.target_timestamp_ms > state.target_timestamp_ms");
    expect(queries[0].sql).toContain("order by priority desc, created_at asc");
  });

  it("does not let newer broad targeted states suppress candidate-window states", async () => {
    const { db, queries } = createMockDb(0, []);

    await claimQueuedTronAddressUsdtIndexStates(db, {
      limit: 3,
      lockOwner: "worker-a",
      lockMs: 600_000,
      coverageMode: "targeted"
    });

    expect(queries[0].sql).toContain("state.request_kind = 'broad_targeted'");
    expect(queries[0].sql).toContain("newer.request_kind = 'broad_targeted'");
  });

  it("claims candidate-window targeted states by default", async () => {
    const { db, queries } = createMockDb(0, []);

    await claimQueuedTronAddressUsdtIndexStates(db, {
      limit: 3,
      lockOwner: "worker-a",
      lockMs: 600_000
    });

    expect(queries[0].sql).toContain("state.coverage_mode = 'all_time'");
    expect(queries[0].sql).toContain("state.request_kind in ('broad_targeted', 'candidate_window')");
  });

  it("updates failed TRON address index state with retry semantics", async () => {
    const { db, queries } = createMockDb(0, []);

    await failTronAddressUsdtIndexState(db, {
      address: "TSubject111111111111111111111111111111",
      coverageMode: "all_time",
      error: "too many requests",
      errorClass: "rate_limited"
    });

    expect(queries[0].sql).toContain("failed_retryable");
    expect(queries[0].sql).toContain("partial_rate_limited");
    expect(queries[0].params).toContain("rate_limited");
  });

  it("upserts and lists page state for a time-window offset", async () => {
    const pageDb = createMockDb(0, []);

    await upsertTronAddressUsdtIndexPage(pageDb.db, {
      address: "TSubject111111111111111111111111111111",
      coverageMode: "all_time",
      targetTimestampMs: 0,
      windowStartTimestampMs: 0,
      windowEndTimestampMs: 1_780_100_000_000,
      startOffset: 50,
      limitCount: 50,
      status: "complete",
      transferCount: 50,
      provider: "tronscan",
      totalReported: 12500,
      rangeTotal: 10000,
      rawResponseHash: "raw-hash",
      canonicalTransferHash: "canonical-hash",
      attemptCount: 1,
      error: null,
      newestTransferAt: new Date("2026-06-14T15:05:15.000Z"),
      oldestTransferAt: new Date("2026-06-09T10:50:36.000Z")
    });

    expect(pageDb.queries[0].sql).toContain("insert into tron_address_usdt_index_pages");
    expect(pageDb.queries[0].sql).toContain("total_reported = coalesce(excluded.total_reported, tron_address_usdt_index_pages.total_reported)");
    expect(pageDb.queries[0].sql).toContain("raw_response_hash = coalesce(excluded.raw_response_hash, tron_address_usdt_index_pages.raw_response_hash)");
    expect(pageDb.queries[0].sql).toContain("newest_transfer_at = coalesce(excluded.newest_transfer_at, tron_address_usdt_index_pages.newest_transfer_at)");
    expect(pageDb.queries[0].params).toContain(1_780_100_000_000);
    expect(pageDb.queries[0].params).toContain("canonical-hash");

    const listDb = createMockDb(1, [tronAddressIndexPageRow()]);
    const pages = await listTronAddressUsdtIndexPages(listDb.db, {
      address: "TSubject111111111111111111111111111111",
      coverageMode: "all_time"
    });
    expect(pages[0]).toMatchObject({
      targetTimestampMs: 0,
      rangeTotal: 10000,
      rawResponseHash: "raw-hash",
      canonicalTransferHash: "canonical-hash"
    });
  });

  it("loads enough cached index pages by default for background targeted resume", async () => {
    const listDb = createMockDb(0, []);

    await listTronAddressUsdtIndexPages(listDb.db, {
      address: "TSubject111111111111111111111111111111",
      coverageMode: "targeted",
      targetTimestampMs: new Date("2026-07-01T14:10:36.000Z").getTime()
    });

    expect(listDb.queries[0].params[3]).toBe(20_000);
  });

  it("validates page coverage target timestamp before writing", async () => {
    const db = createMockDb(0, []);
    const pageInput = {
      address: "TSubject111111111111111111111111111111",
      coverageMode: "targeted" as const,
      targetTimestampMs: 0,
      windowStartTimestampMs: 0,
      windowEndTimestampMs: 1_780_100_000_000,
      startOffset: 0,
      limitCount: 50,
      status: "queued" as const,
      transferCount: 0,
      provider: null,
      totalReported: null,
      rangeTotal: null,
      rawResponseHash: null,
      canonicalTransferHash: null,
      attemptCount: 0,
      error: null,
      newestTransferAt: null,
      oldestTransferAt: null
    };

    await expect(upsertTronAddressUsdtIndexPage(db.db, pageInput)).rejects.toThrow("targeted coverage requires a non-zero target timestamp");
    await expect(upsertTronAddressUsdtIndexPage(db.db, { ...pageInput, coverageMode: "all_time", targetTimestampMs: 1 })).rejects.toThrow(
      "all_time coverage requires a zero target timestamp"
    );
    expect(db.queries).toHaveLength(0);
  });

  it("keeps targeted coverage separate from all-time coverage by target timestamp", async () => {
    const targetTimestamp = new Date("2026-06-14T15:05:15.000Z");
    const { db, queries } = createSequencedMockDb([
      { rows: [tronAddressIndexStateRow({ coverage_mode: "targeted", target_timestamp_ms: targetTimestamp.getTime(), target_timestamp: targetTimestamp, status: "complete" })] }
    ]);

    await upsertTronAddressUsdtIndexState(db, {
      address: "TSubject111111111111111111111111111111",
      coverageMode: "targeted",
      targetTimestamp,
      status: "complete",
      queuedReason: "where_is_money_hop"
    });

    expect(queries[0].sql).toContain("request_kind, window_start_timestamp_ms, candidate_tx_hash");
    expect(compactSql(queries[0].sql)).toContain(
      "on conflict (address, token_contract, coverage_mode, target_timestamp_ms, request_kind, window_start_timestamp_ms, candidate_tx_hash)"
    );
    expect(queries[0].params).toContain("targeted");
    expect(queries[0].params).toContain(targetTimestamp.getTime());
  });

  it("includes live targeted page uniqueness stats in forensic job progress", async () => {
    const targetTimestamp = new Date("2026-07-01T12:59:30.000Z");
    const db = createMockDb(1, [{
      address: "TWkvffFDMsqbmTLkMHMABmw452Hyq98cdn",
      required_for: "where_hop",
      wait_status: "waiting",
      wait_status_reason: null,
      wait_last_error: null,
      target_timestamp: targetTimestamp,
      index_status: "running",
      index_status_reason: null,
      fetched_page_count: 2399,
      fetched_transfer_count: 66404,
      oldest_transfer_at: new Date("2026-06-18T15:34:15.000Z"),
      newest_transfer_at: targetTimestamp,
      budget_pages: 12000,
      attempt_count: 16,
      max_attempts: 20,
      retry_count: 15,
      provider_cap_hit: true,
      budget_exhausted: true,
      provider_inconsistent: false,
      locked_until: new Date("2026-07-03T13:40:00.000Z"),
      lock_owner: "pid-47020",
      next_run_at: null,
      index_last_error: null,
      live_page_count: 2399,
      unique_canonical_hash_count: 1994,
      repeat_ratio: "0.1688"
    }]);

    const progress = await getForensicJobTargetedHistoryProgress(db.db, "job-1");

    expect(db.queries[0].sql).toContain("tron_address_usdt_index_pages");
    expect(db.queries[0].sql).toContain("unique_canonical_hash_count");
    expect(progress).toMatchObject({
      fetchedPageCount: 2399,
      uniqueCanonicalHashCount: 1994,
      repeatRatio: 0.1688,
      states: [expect.objectContaining({
        fetchedPageCount: 2399,
        uniqueCanonicalHashCount: 1994,
        repeatRatio: 0.1688
      })]
    });
  });

  it("includes candidate-window identity and counters in forensic job progress", async () => {
    const targetTimestamp = new Date("2026-07-04T12:00:00.000Z");
    const windowStart = new Date("2026-07-04T11:55:00.000Z");
    const db = createMockDb(1, [{
      address: "THop111111111111111111111111111111",
      required_for: "where_hop",
      wait_status: "waiting",
      wait_status_reason: null,
      wait_last_error: null,
      target_timestamp: targetTimestamp,
      request_kind: "candidate_window",
      window_start_timestamp: windowStart,
      window_end_timestamp: targetTimestamp,
      related_hop_tx_hash: "hop-tx-1",
      candidate_tx_hash: "candidate-tx-1",
      index_status: "running",
      index_status_reason: null,
      fetched_page_count: 12,
      fetched_transfer_count: 42,
      oldest_transfer_at: windowStart,
      newest_transfer_at: targetTimestamp,
      budget_pages: 200,
      attempt_count: 1,
      max_attempts: 3,
      retry_count: 0,
      provider_cap_hit: false,
      budget_exhausted: false,
      provider_inconsistent: false,
      locked_until: null,
      lock_owner: null,
      next_run_at: null,
      index_last_error: null,
      unique_canonical_hash_count: 40,
      repeat_ratio: "0.0476"
    }]);

    const progress = await getForensicJobTargetedHistoryProgress(db.db, "job-1");

    expect(db.queries[0].sql).toContain("wait.request_kind");
    expect(db.queries[0].sql).toContain("page.window_start_timestamp_ms = state.window_start_timestamp_ms");
    expect(db.queries[0].sql).toContain("page.window_end_timestamp_ms = state.window_end_timestamp_ms");
    expect(progress).toMatchObject({
      totalTargetedStates: 1,
      candidateWindows: {
        total: 1,
        queued: 0,
        running: 1,
        complete: 0,
        terminal: 0,
        pending: 1
      },
      states: [expect.objectContaining({
        requestKind: "candidate_window",
        windowStartTimestamp: windowStart.toISOString(),
        windowEndTimestamp: targetTimestamp.toISOString(),
        relatedHopTxHash: "hop-tx-1",
        candidateTxHash: "candidate-tx-1",
        fetchedPageCount: 12,
        uniqueCanonicalHashCount: 40,
        repeatRatio: 0.0476
      })]
    });
  });

  it("upserts coverage interval provider evidence fields", async () => {
    const { db, queries } = createMockDb(0, []);

    await upsertTronAddressUsdtCoverageInterval(db, {
      address: "TSubject111111111111111111111111111111",
      coverageMode: "targeted",
      targetTimestamp: new Date("2026-06-14T15:05:15.000Z"),
      provider: "tronscan",
      startTimestamp: new Date("2026-01-01T00:00:00.000Z"),
      endTimestamp: new Date("2026-06-14T15:05:15.000Z"),
      status: "partial",
      statusReason: "partial_provider_cap",
      totalReported: 12500,
      rangeTotal: 10000,
      pagesFetched: 200,
      rowsFetched: 10000,
      uniqueRowsInserted: 9950,
      capHit: true,
      providerInconsistent: true,
      completedAt: addressIndexNow
    });

    expect(queries[0].sql).toContain("range_total");
    expect(queries[0].sql).toContain("provider_inconsistent");
    expect(queries[0].sql).toContain("total_reported = coalesce(excluded.total_reported, tron_address_usdt_coverage_intervals.total_reported)");
    expect(queries[0].sql).toContain("range_total = coalesce(excluded.range_total, tron_address_usdt_coverage_intervals.range_total)");
    expect(queries[0].sql).toContain("cap_hit = tron_address_usdt_coverage_intervals.cap_hit or excluded.cap_hit");
    expect(queries[0].sql).toContain("provider_inconsistent = tron_address_usdt_coverage_intervals.provider_inconsistent or excluded.provider_inconsistent");
    expect(queries[0].params).toContain(10000);
    expect(queries[0].params).toContain(true);
  });

  it("validates interval coverage target timestamp before writing", async () => {
    const db = createMockDb(0, []);
    const intervalInput = {
      address: "TSubject111111111111111111111111111111",
      coverageMode: "targeted" as const,
      targetTimestamp: null,
      provider: "tronscan" as const,
      startTimestamp: new Date("2026-01-01T00:00:00.000Z"),
      endTimestamp: new Date("2026-06-14T15:05:15.000Z"),
      status: "partial" as const,
      statusReason: "partial_provider_cap" as const,
      totalReported: null,
      rangeTotal: null,
      pagesFetched: 0,
      rowsFetched: 0,
      uniqueRowsInserted: 0,
      capHit: false,
      providerInconsistent: false,
      completedAt: null
    };

    await expect(upsertTronAddressUsdtCoverageInterval(db.db, intervalInput)).rejects.toThrow(
      "targeted coverage requires a non-zero target timestamp"
    );
    await expect(
      upsertTronAddressUsdtCoverageInterval(db.db, {
        ...intervalInput,
        coverageMode: "all_time",
        targetTimestamp: new Date("2026-06-14T15:05:15.000Z")
      })
    ).rejects.toThrow("all_time coverage requires a zero target timestamp");
    expect(db.queries).toHaveLength(0);
  });
});

describe("offline TRON USDT index repositories", () => {
  it("upserts indexed transfers by compatible transfer id", async () => {
    const tx = createMockTransactionalDb();

    await upsertIndexedTronUsdtTransfers(tx.db, [
      {
        txHash: "tx-1",
        blockNumber: 100,
        blockTimestamp: new Date("2026-05-20T10:00:00.000Z"),
        eventIndex: 0,
        fromAddress: "TFrom",
        toAddress: "TTo",
        amountRaw: "1000000",
        method: "transfer",
        callerAddress: null,
        contractRet: "SUCCESS",
        confirmed: true
      }
    ]);

    expect(tx.queries.some((query) => query.sql.includes("insert into tron_usdt_transfers"))).toBe(true);
    expect(tx.queries.some((query) => query.sql.includes("on conflict (transfer_id)"))).toBe(true);
    expect(tx.queries.some((query) => query.params.includes("legacy:tx-1:0"))).toBe(true);
    expect(tx.released).toBe(true);
  });

  it("derives provider-aware transfer ids for address indexing rows", async () => {
    const tx = createMockTransactionalDb();

    await upsertIndexedTronUsdtTransfers(tx.db, [
      {
        txHash: "tx-1",
        blockNumber: 100,
        blockTimestamp: new Date("2026-05-20T10:00:00.000Z"),
        eventIndex: 0,
        provider: "tronscan",
        providerRowOrdinalInTx: 1,
        eventType: "Transfer",
        fromAddress: "TFrom",
        toAddress: "TTo",
        amountRaw: "1000000",
        method: "transfer",
        callerAddress: null,
        contractRet: "SUCCESS",
        finalResult: "SUCCESS",
        reverted: false,
        riskTransaction: false,
        confirmed: true
      }
    ]);

    expect(tx.queries.some((query) => query.params.some((param) => typeof param === "string" && param.startsWith("tron-usdt:")))).toBe(true);
  });

  it("queries indexed transfers by related address and time window", async () => {
    const blockTimestamp = new Date("2026-05-20T10:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        tx_hash: "tx-1",
        block_number: 100,
        block_timestamp: blockTimestamp,
        event_index: 0,
        transfer_id: "transfer-1",
        provider: "tronscan",
        provider_row_ordinal_in_tx: 0,
        from_address: "TFrom",
        to_address: "TTo",
        amount_raw: "1000000",
        method: "transferFrom",
        event_type: "Transfer",
        caller_address: "TCaller",
        contract_ret: "SUCCESS",
        final_result: "SUCCESS",
        reverted: false,
        risk_transaction: false,
        confirmed: true
      }
    ]);

    const transfers = await listIndexedTronUsdtTransfersForAddress(db, {
      address: "TTo",
      minTimestamp: new Date("2026-05-20T00:00:00.000Z"),
      maxTimestamp: new Date("2026-05-21T00:00:00.000Z"),
      direction: "incoming",
      limit: 50,
      offset: 7
    });

    expect(transfers[0]).toMatchObject({
      txHash: "tx-1",
      transferId: "transfer-1",
      method: "transferFrom",
      callerAddress: "TCaller"
    });
    expect(queries[0].sql).toContain("from tron_usdt_transfers");
    expect(queries[0].sql).toContain("to_address = $1");
    expect(compactSql(queries[0].sql)).toContain(
      "order by block_timestamp desc, block_number desc, event_index desc, transfer_id desc limit $4 offset $5"
    );
  });

  it("can prioritize indexed transfers by amount for bounded forensic expansion", async () => {
    const { db, queries } = createMockDb(1, []);

    await listIndexedTronUsdtTransfersForAddress(db, {
      address: "TActive",
      minTimestamp: new Date("2026-05-20T00:00:00.000Z"),
      maxTimestamp: new Date("2026-05-21T00:00:00.000Z"),
      direction: "both",
      limit: 50,
      offset: 7,
      orderBy: "amount_desc"
    });

    expect(compactSql(queries[0].sql)).toContain(
      "order by length(amount_raw) desc, amount_raw desc, block_timestamp desc, block_number desc, event_index desc, transfer_id desc limit $4 offset $5"
    );
  });

  it("counts distinct indexed USDT counterparties for an address", async () => {
    const { db, queries } = createMockDb(1, [{ count: 3 }]);

    const count = await countIndexedTronUsdtCounterpartiesForAddress(db, "TSubject");

    expect(count).toBe(3);
    expect(queries[0].sql).toContain("count(distinct nullif");
    expect(queries[0].sql).toContain("from tron_usdt_transfers");
    expect(queries[0].params).toEqual(["TSubject"]);
  });

  it("upserts provider label cache entries separately from internal assertions", async () => {
    const seenAt = new Date("2026-05-20T00:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        chain: "tron",
        address: "TAddress",
        provider: "oklink",
        label: "HTX",
        category: "cex",
        confidence: "high",
        source_url: "https://example.test",
        raw_json: { label: "HTX" },
        first_seen_at: seenAt,
        last_seen_at: seenAt
      }
    ]);

    const entry = await upsertAddressLabelCache(db, {
      chain: "tron",
      address: "TAddress",
      provider: "oklink",
      label: "HTX",
      category: "cex",
      confidence: "high",
      sourceUrl: "https://example.test",
      rawJson: { label: "HTX" },
      firstSeenAt: seenAt,
      lastSeenAt: seenAt
    });

    expect(entry).toMatchObject({ provider: "oklink", category: "cex", confidence: "high" });
    expect(queries[0].sql).toContain("insert into address_labels_cache");
  });

  it("lists cached provider labels for an address", async () => {
    const seenAt = new Date("2026-05-20T00:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        chain: "tron",
        address: "TAddress",
        provider: "arkham",
        label: "Bybit",
        category: "cex",
        confidence: "medium",
        source_url: null,
        raw_json: {},
        first_seen_at: seenAt,
        last_seen_at: seenAt
      }
    ]);

    const labels = await listAddressLabelCacheForAddress(db, "TAddress");

    expect(labels[0]).toMatchObject({ provider: "arkham", label: "Bybit" });
    expect(queries[0].sql).toContain("from address_labels_cache");
  });

  it("stores and reads indexer cursor state", async () => {
    const now = new Date("2026-05-20T00:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        id: "cursor-1",
        status: "running",
        last_indexed_block: 100,
        last_indexed_timestamp: now,
        last_fingerprint: "fp",
        progress_json: { pages: 2 },
        last_error: null,
        created_at: now,
        updated_at: now
      }
    ]);

    const cursor = await upsertTronUsdtIndexerCursor(db, {
      id: "cursor-1",
      status: "running",
      lastIndexedBlock: 100,
      lastIndexedTimestamp: now,
      lastFingerprint: "fp",
      progressJson: { pages: 2 }
    });

    expect(cursor).toMatchObject({ id: "cursor-1", status: "running", lastIndexedBlock: 100 });
    expect(queries[0].sql).toContain("insert into tron_usdt_indexer_cursors");
  });

  it("reads indexer cursor state", async () => {
    const now = new Date("2026-05-20T00:00:00.000Z");
    const { db } = createMockDb(1, [
      {
        id: "cursor-1",
        status: "completed",
        last_indexed_block: 100,
        last_indexed_timestamp: now,
        last_fingerprint: null,
        progress_json: {},
        last_error: null,
        created_at: now,
        updated_at: now
      }
    ]);

    const cursor = await getTronUsdtIndexerCursor(db, "cursor-1");

    expect(cursor).toMatchObject({ id: "cursor-1", status: "completed" });
  });

  it("rebuilds daily address features from indexed transfer rows", async () => {
    const day = new Date("2026-05-20T00:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        address: "TAddress",
        day,
        in_volume_raw: "1000000",
        out_volume_raw: "500000",
        in_count: 1,
        out_count: 1,
        unique_in: 1,
        unique_out: 1,
        first_seen: day,
        last_seen: day
      }
    ]);

    const features = await rebuildAddressFeaturesDaily(db, {
      dayStart: day,
      dayEnd: new Date("2026-05-21T00:00:00.000Z")
    });

    expect(features[0]).toMatchObject({ address: "TAddress", inVolumeRaw: "1000000", outCount: 1 });
    expect(queries[0].sql).toContain("insert into address_features_daily");
  });
});

describe("observed transaction user alert repositories", () => {
  it("atomically claims an observed transaction for user alerting on insert", async () => {
    const { db, queries } = createMockDb(1);

    const claimed = await claimObservedTransactionForUserAlert(db, { watchedWalletId: "wallet-1", event });

    expect(claimed).toBe(true);
    expect(queries[0].sql).toContain("user_alert_status");
    expect(queries[0].sql).toContain("'sending'");
    expect(queries[0].sql).toContain("on conflict (tx_hash, watched_wallet_id) do nothing");
  });

  it("returns false when atomic claim hits an existing observed transaction", async () => {
    const { db } = createMockDb(0);

    await expect(claimObservedTransactionForUserAlert(db, { watchedWalletId: "wallet-1", event })).resolves.toBe(false);
  });

  it("atomically claims pending or failed user alerts for retry", async () => {
    const { db, queries } = createMockDb();

    await claimUserAlertsForRetry(db, { limit: 25, staleSendingBefore: new Date("2026-05-20T00:00:00.000Z") });

    expect(queries[0].sql).toContain("for update skip locked");
    expect(queries[0].sql).toContain("user_alert_status = 'sending' and user_alert_updated_at < $2");
    expect(queries[0].sql).toContain("user_alert_status = 'analyzing' and user_alert_updated_at < $2");
    expect(queries[0].sql).toContain("user_alert_status = 'sending'");
    expect(queries[0].params).toEqual([25, new Date("2026-05-20T00:00:00.000Z")]);
  });

  it("marks user alerts sent", async () => {
    const { db, queries } = createMockDb();

    await markUserAlertSent(db, { txHash: "tx-1", watchedWalletId: "wallet-1" });

    expect(queries[0].sql).toContain("user_alert_status = 'sent'");
    expect(queries[0].sql).toContain("user_alert_status = 'sending'");
    expect(queries[0].sql).toContain("user_alert_updated_at = now()");
  });

  it("allows analyzing user alerts to be marked sent", async () => {
    const { db, queries } = createMockDb();

    await markUserAlertSent(db, { txHash: "tx-1", watchedWalletId: "wallet-1" });

    expect(queries[0].sql).toContain("user_alert_status = 'analyzing'");
  });

  it("marks user alerts failed with bounded error text and incremented attempts", async () => {
    const { db, queries } = createMockDb();
    const longError = "x".repeat(3000);

    await markUserAlertFailed(db, { txHash: "tx-1", watchedWalletId: "wallet-1", error: longError });

    expect(queries[0].sql).toContain("user_alert_attempts = user_alert_attempts + 1");
    expect(queries[0].sql).toContain("user_alert_status = 'sending'");
    expect(queries[0].params[2]).toHaveLength(1024);
  });

  it("allows analyzing user alerts to be marked failed", async () => {
    const { db, queries } = createMockDb();

    await markUserAlertFailed(db, { txHash: "tx-1", watchedWalletId: "wallet-1", error: "failed" });

    expect(queries[0].sql).toContain("user_alert_status = 'analyzing'");
  });

  it("marks user alerts skipped for non-immediate alert modes", async () => {
    const { db, queries } = createMockDb();

    await markUserAlertSkipped(db, { txHash: "tx-1", watchedWalletId: "wallet-1", reason: "risk_only" });

    expect(queries[0].sql).toContain("user_alert_status = 'skipped'");
    expect(queries[0].sql).toContain("user_alert_last_error = $3");
    expect(queries[0].params).toEqual(["tx-1", "wallet-1", "risk_only"]);
  });

  it("allows analyzing user alerts to be marked skipped", async () => {
    const { db, queries } = createMockDb();

    await markUserAlertSkipped(db, { txHash: "tx-1", watchedWalletId: "wallet-1", reason: "risk_only" });

    expect(queries[0].sql).toContain("user_alert_status = 'analyzing'");
  });

  it("marks observed transaction as analyzing while incoming deposit job runs", async () => {
    const wallet = { id: "wallet-1", address: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM" };
    const txHash = "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b";
    const timestamp = new Date("2026-05-29T14:01:00.000Z");
    const { db } = createMockDb(1, [
      {
        tx_hash: txHash,
        watched_wallet_id: wallet.id,
        sender: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
        receiver: wallet.address,
        token: "USDT",
        amount: "384064.001319",
        timestamp,
        user_alert_status: "analyzing",
        user_alert_attempts: 0,
        user_alert_last_error: null,
        user_alert_updated_at: timestamp,
        created_at: timestamp
      }
    ]);

    await claimObservedTransactionForUserAlert(db, {
      watchedWalletId: wallet.id,
      event: {
        txHash,
        token: "USDT",
        sender: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
        receiver: wallet.address,
        amount: "384064.001319",
        timestamp
      }
    });

    await markUserAlertAnalyzing(db, {
      txHash,
      watchedWalletId: wallet.id
    });

    const row = await getObservedTransactionForIncomingDeposit(db, {
      txHash,
      watchedWalletId: wallet.id
    });

    expect(row?.userAlertStatus).toBe("analyzing");
  });

  it("records observed transaction risk snapshot for digest and skipped alerts", async () => {
    const { db, queries } = createMockDb(1);

    await recordObservedTransactionRisk(db, {
      txHash: "tx-1",
      watchedWalletId: "wallet-1",
      report: {
        subjectAddress: "sender",
        level: "MEDIUM",
        score: 35,
        reasons: [{ code: "medium", message: "Medium risk", scoreImpact: 35 }]
      }
    });

    expect(queries[0].sql).toContain("risk_level = $3");
    expect(queries[0].sql).toContain("risk_score = $4");
    expect(queries[0].sql).toContain("risk_reasons = $5");
    expect(queries[0].params[2]).toBe("MEDIUM");
    expect(queries[0].params[3]).toBe(35);
    expect(queries[0].params[4]).toBe('[{\"code\":\"medium\",\"message\":\"Medium risk\",\"scoreImpact\":35}]');
  });

  it("claims due digest transactions with stored risk snapshots", async () => {
    const createdAt = new Date("2026-05-20T00:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        tx_hash: "tx-1",
        watched_wallet_id: "wallet-1",
        sender: "sender",
        receiver: "receiver",
        token: "USDT",
        amount: "10",
        timestamp: createdAt,
        user_alert_status: "skipped",
        user_alert_attempts: 0,
        user_alert_last_error: null,
        user_alert_updated_at: createdAt,
        created_at: createdAt,
        risk_level: "LOW",
        risk_score: 0,
        risk_reasons: [],
        digest_sent_at: null
      }
    ]);

    const items = await claimDigestTransactions(db, { limit: 50, now: new Date("2026-05-20T00:10:00.000Z") });

    expect(items[0]).toMatchObject({ txHash: "tx-1", riskLevel: "LOW", riskScore: 0, riskReasons: [] });
    expect(queries[0].sql).toContain("join watched_wallets w");
    expect(queries[0].sql).toContain("w.alert_mode = 'digest'");
    expect(queries[0].sql).toContain("digest_sent_at is null");
    expect(queries[0].sql).toContain("backfill_stale_transaction");
    expect(queries[0].params).toEqual([50, new Date("2026-05-20T00:10:00.000Z")]);
  });

  it("marks digest transactions sent after grouped delivery", async () => {
    const { db, queries } = createMockDb(2);

    const updated = await markDigestSent(db, { watchedWalletId: "wallet-1", txHashes: ["tx-1", "tx-2"] });

    expect(updated).toBe(2);
    expect(queries[0].sql).toContain("digest_sent_at = now()");
    expect(queries[0].sql).toContain("tx_hash = any($2)");
    expect(queries[0].params).toEqual(["wallet-1", ["tx-1", "tx-2"]]);
  });
});

describe("watched wallet repositories", () => {
  it("lists watched wallets with the owner locale", async () => {
    const createdAt = new Date("2026-05-20T00:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        id: "wallet-1",
        telegram_user_id: "42",
        username: "client_user",
        locale: "en",
        address: "TWallet111111111111111111111111111111",
        created_at: createdAt,
        alert_mode: "realtime",
        digest_interval_minutes: 10
      }
    ]);

    const wallets = await listWatchedWallets(db, "42");

    expect(wallets[0]).toMatchObject({
      address: "TWallet111111111111111111111111111111",
      locale: "en"
    });
    expect(queries[0].sql).toContain("u.locale");
  });
});

describe("watched wallet alert mode repositories", () => {
  it("updates alert mode and digest interval for an owned wallet", async () => {
    const { db, queries } = createMockDb(1);

    const updated = await updateWatchedWalletAlertMode(db, {
      telegramUserId: "42",
      address: "TReceiver11111111111111111111111111111",
      alertMode: "digest",
      digestIntervalMinutes: 15
    });

    expect(updated).toBe(true);
    expect(queries[0].sql).toContain("update watched_wallets");
    expect(queries[0].sql).toContain("alert_mode = $3");
    expect(queries[0].sql).toContain("digest_interval_minutes = $4");
    expect(queries[0].params).toEqual(["42", "TReceiver11111111111111111111111111111", "digest", 15]);
  });
});

describe("risk evidence repositories", () => {
  const rawEvidence: RawEvidenceInput = {
    id: "evidence-1",
    source: "service_admin",
    sourceType: "internal_label",
    chain: "tron",
    address: "TSubject111111111111111111111111111111",
    txHash: null,
    observedTransactionHash: "tx-1",
    evidenceJson: {
      label: "scam",
      source: "service_admin"
    }
  };
  const observation: RiskSignalObservationInput = {
    id: "observation-1",
    subjectChain: "tron",
    subjectAddress: "TSubject111111111111111111111111111111",
    subjectTxHash: null,
    observedTransactionHash: "tx-1",
    signalGroup: "internal_label",
    code: "internal_label_scam",
    message: "Internal label: scam",
    scoreImpact: 90,
    confidence: "high",
    severity: "critical",
    source: "service_admin",
    policyVersion: "2026-05-21-v1",
    rawEvidenceId: "evidence-1"
  };

  it("saves raw evidence and risk signal observations in one transaction", async () => {
    const tx = createMockTransactionalDb();

    await saveRiskEvaluationEvidence(tx.db, { rawEvidence: [rawEvidence], observations: [observation] });

    expect(tx.queries[0].sql).toBe("begin");
    expect(tx.queries.some((query) => query.sql.includes("insert into raw_evidence"))).toBe(true);
    expect(tx.queries.some((query) => query.sql.includes("insert into risk_signal_observations"))).toBe(true);
    expect(tx.queries.at(-1)?.sql).toBe("commit");
    expect(tx.released).toBe(true);
    const rawInsert = tx.queries.find((query) => query.sql.includes("insert into raw_evidence"));
    expect(rawInsert?.params).toContain("service_admin");
    expect(rawInsert?.params).not.toContain("replace_with_telegram_bot_token");
  });

  it("rolls back and releases the client when observation insert fails", async () => {
    const tx = createMockTransactionalDb({ failOnRiskObservation: true });

    await expect(saveRiskEvaluationEvidence(tx.db, { rawEvidence: [rawEvidence], observations: [observation] })).rejects.toThrow(
      "risk observation insert failed"
    );

    expect(tx.queries.some((query) => query.sql === "rollback")).toBe(true);
    expect(tx.queries.some((query) => query.sql === "commit")).toBe(false);
    expect(tx.released).toBe(true);
  });

  it("lists recent risk observations for an address with default chain and limit", async () => {
    const { db, queries } = createMockDb(1, [
      {
        id: "observation-1",
        subject_chain: "tron",
        subject_address: "TSubject111111111111111111111111111111",
        subject_tx_hash: null,
        observed_transaction_hash: "tx-1",
        signal_group: "internal_label",
        code: "internal_label_scam",
        message: "Internal label: scam",
        score_impact: 90,
        confidence: "high",
        severity: "critical",
        source: "service_admin",
        policy_version: "2026-05-21-v1",
        raw_evidence_id: "evidence-1"
      }
    ]);

    const observations = await listRecentRiskSignalObservations(db, {
      subjectAddress: "TSubject111111111111111111111111111111"
    });

    expect(observations).toEqual([observation]);
    expect(queries[0].sql).toContain("from risk_signal_observations");
    expect(queries[0].params).toEqual(["tron", "TSubject111111111111111111111111111111", 25]);
  });
});

describe("customer alert recipient repositories", () => {
  it("upserts a recipient with default suspicious mode", async () => {
    const createdAt = new Date("2026-05-22T00:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        owner_telegram_user_id: "42",
        recipient_telegram_user_id: "777",
        alert_mode: "suspicious_only",
        created_at: createdAt,
        updated_at: createdAt
      }
    ]);

    const recipient = await upsertCustomerAlertRecipient(db, {
      ownerTelegramUserId: "42",
      recipientTelegramUserId: "777"
    });

    expect(recipient).toEqual({
      ownerTelegramUserId: "42",
      recipientTelegramUserId: "777",
      alertMode: "suspicious_only",
      createdAt,
      updatedAt: createdAt
    });
    expect(queries[0].sql).toContain("insert into customer_alert_recipients");
    expect(queries[0].sql).toContain("on conflict (owner_telegram_user_id, recipient_telegram_user_id) do update");
    expect(queries[0].params).toEqual(["42", "777", "suspicious_only"]);
  });

  it("upserts a recipient with explicit all-alert mode", async () => {
    const createdAt = new Date("2026-05-22T00:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        owner_telegram_user_id: "42",
        recipient_telegram_user_id: "888",
        alert_mode: "all",
        created_at: createdAt,
        updated_at: createdAt
      }
    ]);

    const recipient = await upsertCustomerAlertRecipient(db, {
      ownerTelegramUserId: "42",
      recipientTelegramUserId: "888",
      alertMode: "all"
    });

    expect(recipient.alertMode).toBe("all");
    expect(queries[0].params).toEqual(["42", "888", "all"]);
  });

  it("lists recipients for one owner sorted by creation time", async () => {
    const firstCreatedAt = new Date("2026-05-21T00:00:00.000Z");
    const secondCreatedAt = new Date("2026-05-22T00:00:00.000Z");
    const { db, queries } = createMockDb(2, [
      {
        owner_telegram_user_id: "42",
        recipient_telegram_user_id: "777",
        alert_mode: "suspicious_only",
        created_at: firstCreatedAt,
        updated_at: firstCreatedAt
      },
      {
        owner_telegram_user_id: "42",
        recipient_telegram_user_id: "888",
        alert_mode: "all",
        created_at: secondCreatedAt,
        updated_at: secondCreatedAt
      }
    ]);

    const recipients = await listCustomerAlertRecipients(db, "42");

    expect(recipients.map((recipient) => [recipient.recipientTelegramUserId, recipient.alertMode])).toEqual([
      ["777", "suspicious_only"],
      ["888", "all"]
    ]);
    expect(queries[0].sql).toContain("from customer_alert_recipients");
    expect(queries[0].sql).toContain("order by created_at asc");
    expect(queries[0].params).toEqual(["42"]);
  });

  it("removes a recipient for the owner and reports whether a row was deleted", async () => {
    const { db, queries } = createMockDb(1);

    const removed = await removeCustomerAlertRecipient(db, {
      ownerTelegramUserId: "42",
      recipientTelegramUserId: "777"
    });

    expect(removed).toBe(true);
    expect(queries[0].sql).toContain("delete from customer_alert_recipients");
    expect(queries[0].params).toEqual(["42", "777"]);
  });

  it("rejects invalid alert modes returned by the database", async () => {
    const { db } = createMockDb(1, [
      {
        owner_telegram_user_id: "42",
        recipient_telegram_user_id: "777",
        alert_mode: "everything",
        created_at: new Date("2026-05-22T00:00:00.000Z"),
        updated_at: new Date("2026-05-22T00:00:00.000Z")
      }
    ]);

    await expect(listCustomerAlertRecipients(db, "42")).rejects.toThrow("Invalid customer alert mode from database: everything");
  });
});

describe("address poisoning persistence", () => {
  const now = new Date("2026-07-12T12:00:00.000Z");
  const candidateRow = {
    id: "candidate-1",
    callback_token: "abcdefghijklmnopqrst",
    watched_wallet_id: "wallet-1",
    token_contract: "TToken111111111111111111111111111111",
    token_symbol: "USDT",
    token_decimals: 6,
    suspicious_incoming_tx_hash: "incoming-1",
    suspicious_sender: "TSuspicious1111111111111111111111111",
    suspicious_amount_raw: "10000000",
    suspicious_incoming_at: now,
    matched_outgoing_tx_hash: "outgoing-1",
    genuine_recipient: "TGenuine11111111111111111111111111111",
    matched_outgoing_amount_raw: "10000000",
    matched_outgoing_at: new Date("2026-07-12T11:59:00.000Z"),
    raw_prefix_length: 1,
    meaningful_prefix_length: 0,
    suffix_length: 7,
    classification: "CRITICAL",
    confidence: "high",
    raw_evidence_id: "raw-id",
    secondary_matches_json: [],
    evidence_json: { exactAmount: true },
    status: "candidate",
    alert_fingerprint: "fingerprint-1",
    alert_status: "pending",
    alert_attempts: 0,
    alert_next_retry_at: null,
    alert_last_error: null,
    telegram_chat_id: null,
    telegram_message_id: null,
    later_loss_tx_hash: null,
    later_loss_evidence_json: null,
    created_at: now,
    updated_at: now,
    resolved_at: null,
    alert_sent_at: null,
    alert_mode: "paused"
  };

  const persistInput = {
    policyVersion: "address-poisoning-v1",
    watchedWalletId: "wallet-1",
    walletAddress: "TWallet111111111111111111111111111111",
    tokenContract: candidateRow.token_contract,
    tokenSymbol: "USDT",
    tokenDecimals: 6,
    suspiciousIncomingTxHash: candidateRow.suspicious_incoming_tx_hash,
    suspiciousSender: candidateRow.suspicious_sender,
    suspiciousAmountRaw: candidateRow.suspicious_amount_raw,
    suspiciousIncomingAt: candidateRow.suspicious_incoming_at,
    matchedOutgoingTxHash: candidateRow.matched_outgoing_tx_hash,
    genuineRecipient: candidateRow.genuine_recipient,
    matchedOutgoingAmountRaw: candidateRow.matched_outgoing_amount_raw,
    matchedOutgoingAt: candidateRow.matched_outgoing_at,
    rawPrefixLength: 1,
    meaningfulPrefixLength: 0,
    suffixLength: 7,
    classification: "CRITICAL" as const,
    confidence: "high" as const,
    secondaryMatches: [],
    evidenceJson: { exactAmount: true },
    coverage: "complete" as const,
    logicalOffset: 200,
    pageCount: 2,
    fetchedCount: 183,
    oldestFetchedAt: new Date("2026-07-11T12:00:00.000Z"),
    accumulatedLookupJson: { transfers: ["outgoing-1"] }
  };

  it("migrates historical rows to skipped_backfill and keeps that safe default", () => {
    const sql = readFileSync("migrations/031_address_poisoning_monitor.sql", "utf8");
    expect(compactSql(sql)).toContain("poisoning_check_status text not null default 'skipped_backfill'");
    expect(sql).toContain("'wallet_safety'");
    expect(compactSql(sql)).toContain("signal_group <> 'wallet_safety' or score_impact = 0");
    expect(sql).toContain("unique (watched_wallet_id, token_contract, suspicious_incoming_tx_hash)");
    expect(compactSql(sql)).toContain("check (confidence in ('low','medium','high'))");
  });

  it("claims fresh work with a row lock and leaves fifth-page partials terminal", async () => {
    const { db, queries } = createMockDb();
    await claimAddressPoisoningChecks(db, { limit: 10, now, staleRunningBefore: new Date(now.getTime() - 30_000) });
    const sql = compactSql(queries[0].sql);
    expect(sql).toContain("for update of tx skip locked");
    expect(sql).toContain("order by tx.timestamp desc");
    expect(sql).toContain("poisoning_page_count < 5");
    expect(sql).toContain("poisoning_attempts < 3");
    expect(sql).toContain("poisoning_check_status = 'running'");
  });

  it("skips expired and paused queued checks without claiming them", async () => {
    const expired = createMockDb(2);
    const paused = createMockDb(3);
    expect(await skipExpiredAddressPoisoningChecks(expired.db, { expiredBefore: now })).toBe(2);
    expect(compactSql(expired.queries[0].sql)).toContain("poisoning_check_status in ('pending', 'running', 'failed', 'inconclusive')");
    expect(compactSql(expired.queries[0].sql)).toContain("poisoning_check_status = 'skipped_backfill'");
    expect(await skipPausedAddressPoisoningChecks(paused.db)).toBe(3);
    expect(compactSql(paused.queries[0].sql)).toContain("from watched_wallets w");
    expect(compactSql(paused.queries[0].sql)).toContain("w.alert_mode = 'paused'");
  });

  it("persists continuation state and only clears a complete negative", async () => {
    const clear = createMockDb(1);
    const partial = createMockDb(1);
    const skipped = createMockDb(1);
    expect(await markAddressPoisoningCheckClear(clear.db, {
      txHash: "incoming-1",
      watchedWalletId: "wallet-1",
      coverage: "complete",
      logicalOffset: 240,
      pageCount: 3,
      fetchedCount: 212,
      oldestFetchedAt: new Date("2026-07-11T10:00:00.000Z"),
      accumulatedLookupJson: { transfers: ["tx-final"] }
    })).toBe(true);
    expect(compactSql(clear.queries[0].sql)).toContain("poisoning_lookup_coverage = 'complete'");
    expect(compactSql(clear.queries[0].sql)).toContain("poisoning_logical_offset = $3");
    expect(clear.queries[0].params).toEqual([
      "incoming-1",
      "wallet-1",
      240,
      3,
      212,
      new Date("2026-07-11T10:00:00.000Z"),
      { transfers: ["tx-final"] }
    ]);
    expect(await markAddressPoisoningCheckInconclusive(partial.db, {
      txHash: "incoming-1",
      watchedWalletId: "wallet-1",
      coverage: "partial",
      logicalOffset: 100,
      pageCount: 1,
      fetchedCount: 100,
      oldestFetchedAt: new Date("2026-07-12T11:00:00.000Z"),
      accumulatedLookupJson: { transfers: ["tx-1"] },
      nextRetryAt: new Date("2026-07-12T12:01:00.000Z"),
      reason: "provider_cap"
    })).toBe(true);
    expect(partial.queries[0].params).toContain(100);
    expect(compactSql(partial.queries[0].sql)).toContain("poisoning_page_count = $6");
    expect(await markAddressPoisoningCheckSkipped(skipped.db, {
      txHash: "incoming-1", watchedWalletId: "wallet-1", reason: "ineligible"
    })).toBe(true);
    expect(compactSql(skipped.queries[0].sql)).toContain("poisoning_check_status = 'skipped'");
  });

  it("records the 30/60/120 retry schedule and stops claiming after three failures", async () => {
    for (const seconds of [30, 60, 120]) {
      const failed = createMockDb(1);
      expect(await markAddressPoisoningCheckFailed(failed.db, {
        txHash: "incoming-1", watchedWalletId: "wallet-1", error: "provider", now
      })).toBe(true);
      expect(compactSql(failed.queries[0].sql)).toContain(`${seconds} seconds`);
    }
  });

  it("atomically writes deterministic zero-impact safety evidence and preserves candidate state", async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes("from observed_transactions tx") && sql.includes("for update of tx")) {
          return { rowCount: 1, rows: [{ poisoning_check_status: "running" }] };
        }
        if (sql.includes("from address_poisoning_candidates candidate") && sql.includes("for update of candidate")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("insert into address_poisoning_candidates")) return { rowCount: 1, rows: [candidateRow] };
        return { rowCount: 1, rows: [] };
      },
      release: () => undefined
    };
    const db = { connect: async () => client } as unknown as Db;
    const first = await persistAddressPoisoningCandidate(db, persistInput);
    const secondQueries: { sql: string; params: unknown[] }[] = [];
    const secondClient = {
      query: async (sql: string, params: unknown[] = []) => {
        secondQueries.push({ sql, params });
        if (sql.includes("from observed_transactions tx") && sql.includes("for update of tx")) {
          return { rowCount: 1, rows: [{ poisoning_check_status: "running" }] };
        }
        if (sql.includes("from address_poisoning_candidates candidate") && sql.includes("for update of candidate")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("insert into address_poisoning_candidates")) return { rowCount: 1, rows: [{ ...candidateRow, status: "confirmed", alert_status: "sent" }] };
        return { rowCount: 1, rows: [] };
      },
      release: () => undefined
    };
    await persistAddressPoisoningCandidate({ connect: async () => secondClient } as unknown as Db, persistInput);
    expect(first.callbackToken).toBe(candidateRow.callback_token);
    expect(queries[0].sql).toBe("begin");
    const observation = queries.find((query) => query.sql.includes("insert into risk_signal_observations"));
    expect(compactSql(observation!.sql)).toContain("'wallet_safety'");
    expect(compactSql(observation!.sql)).toContain("0, $4");
    expect(queries.find((query) => query.sql.includes("insert into raw_evidence"))?.params[0]).toBe(
      secondQueries.find((query) => query.sql.includes("insert into raw_evidence"))?.params[0]
    );
    const upsert = compactSql(queries.find((query) => query.sql.includes("insert into address_poisoning_candidates"))!.sql);
    expect(upsert).toContain("on conflict (watched_wallet_id, token_contract, suspicious_incoming_tx_hash)");
    expect(upsert).toContain("do nothing");
    expect(upsert).not.toContain("status = excluded.status");
    expect(upsert).not.toContain("callback_token = excluded.callback_token");
    expect(upsert).not.toContain("alert_status = excluded.alert_status");
    expect(compactSql(queries.at(-2)!.sql)).toContain("poisoning_check_status = 'running'");
    expect(compactSql(queries.at(-2)!.sql)).toContain("poisoning_lookup_coverage = $3");
    expect(queries.at(-2)!.params).toEqual([
      "incoming-1", "wallet-1", "complete", 200, 2, 183,
      new Date("2026-07-11T12:00:00.000Z"), { transfers: ["outgoing-1"] }
    ]);
    expect(queries.at(-1)?.sql).toBe("commit");
  });

  it("rolls back the whole candidate transaction when the observation cannot be saved", async () => {
    const tx = createMockTransactionalDb({ failOnRiskObservation: true });
    await expect(persistAddressPoisoningCandidate(tx.db, persistInput)).rejects.toThrow("risk observation insert failed");
    expect(tx.queries.at(-1)?.sql).toBe("rollback");
  });

  it("claims alerts with a lease and supports delivery transitions", async () => {
    const claimed = createMockDb(1, [candidateRow]);
    const rows = await claimAddressPoisoningAlertsForDelivery(claimed.db, {
      limit: 10, now, staleSendingBefore: new Date(now.getTime() - 30_000)
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].alertMode).toBe("paused");
    expect(compactSql(claimed.queries[0].sql)).toContain("for update of candidate skip locked");
    const sent = createMockDb(1);
    expect(await markAddressPoisoningAlertSent(sent.db, {
      candidateId: "candidate-1", telegramChatId: "42", telegramMessageId: "99"
    })).toBe(true);
    expect(compactSql(sent.queries[0].sql)).toContain("alert_status = 'sent'");
    const failed = createMockDb(1);
    expect(await markAddressPoisoningAlertFailed(failed.db, { candidateId: "candidate-1", error: "telegram", now })).toBe(true);
    expect(compactSql(failed.queries[0].sql)).toContain("alert_attempts = alert_attempts + 1");
    const skipped = createMockDb(1);
    expect(await markAddressPoisoningAlertSkipped(skipped.db, { candidateId: "candidate-1", reason: "paused" })).toBe(true);
  });

  it("resolves callbacks only through an owner-bound mutation and maps CAS outcomes", async () => {
    for (const [outcome, rows] of [
      ["updated", [{ ...candidateRow, outcome: "updated", status: "confirmed" }]],
      ["idempotent", [{ ...candidateRow, outcome: "idempotent", status: "confirmed" }]],
      ["conflict", [{ ...candidateRow, outcome: "conflict", status: "dismissed" }]],
      ["unavailable", []]
    ] as const) {
      const mock = createMockDb(rows.length, [...rows]);
      const result = await resolveAddressPoisoningCandidate(mock.db, {
        callbackToken: candidateRow.callback_token,
        telegramUserId: "42",
        resolution: "confirmed"
      });
      expect(result.outcome).toBe(outcome);
      const sql = compactSql(mock.queries[0].sql);
      expect(sql).toContain("join watched_wallets w");
      expect(sql).toContain("w.telegram_user_id = $2");
      expect(sql).toContain("candidate.callback_token = $1");
      expect(sql).toContain("returning candidate.*");
    }
  });

  it("returns the committed candidate on replay without rewriting evidence or terminal alert facts", async () => {
    const immutable = {
      ...candidateRow,
      status: "confirmed",
      alert_status: "sent",
      callback_token: "immutablecallbacktok",
      alert_fingerprint: "immutable-fingerprint",
      matched_outgoing_tx_hash: "original-outgoing"
    };
    const queries: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes("from observed_transactions tx") && sql.includes("for update of tx")) {
          return { rowCount: 1, rows: [{ poisoning_check_status: "candidate" }] };
        }
        if (sql.includes("from address_poisoning_candidates candidate") && sql.includes("suspicious_incoming_tx_hash")) {
          return { rowCount: 1, rows: [immutable] };
        }
        return { rowCount: 1, rows: [] };
      },
      release: () => undefined
    };
    const replay = await persistAddressPoisoningCandidate({ connect: async () => client } as unknown as Db, {
      ...persistInput,
      matchedOutgoingTxHash: "replacement-outgoing"
    });
    expect(replay.matchedOutgoingTxHash).toBe("original-outgoing");
    expect(replay.callbackToken).toBe("immutablecallbacktok");
    expect(replay.alertFingerprint).toBe("immutable-fingerprint");
    expect(replay.alertStatus).toBe("sent");
    expect(queries.some((query) => query.sql.includes("insert into raw_evidence"))).toBe(false);
    expect(queries.some((query) => query.sql.includes("insert into address_poisoning_candidates"))).toBe(false);
    expect(queries.at(-1)?.sql).toBe("commit");
  });

  it("rolls back a new candidate when the observed running-to-candidate CAS loses", async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes("from observed_transactions tx") && sql.includes("for update of tx")) {
          return { rowCount: 1, rows: [{ poisoning_check_status: "running" }] };
        }
        if (sql.includes("from address_poisoning_candidates candidate")) return { rowCount: 0, rows: [] };
        if (sql.includes("insert into address_poisoning_candidates")) return { rowCount: 1, rows: [candidateRow] };
        if (sql.includes("update observed_transactions")) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [] };
      },
      release: () => undefined
    };
    await expect(persistAddressPoisoningCandidate({ connect: async () => client } as unknown as Db, persistInput))
      .rejects.toThrow("running check lease");
    expect(queries.at(-1)).toBe("rollback");
  });

  it("persists partial candidate progress without coercing it", async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes("from observed_transactions tx") && sql.includes("for update of tx")) {
          return { rowCount: 1, rows: [{ poisoning_check_status: "running" }] };
        }
        if (sql.includes("from address_poisoning_candidates candidate")) return { rowCount: 0, rows: [] };
        if (sql.includes("insert into address_poisoning_candidates")) return { rowCount: 1, rows: [candidateRow] };
        return { rowCount: 1, rows: [] };
      },
      release: () => undefined
    };
    await persistAddressPoisoningCandidate({ connect: async () => client } as unknown as Db, {
      ...persistInput,
      coverage: "partial"
    });
    const finalized = queries.find((query) => query.sql.includes("update observed_transactions"))!;
    expect(finalized.params).toContain("partial");
    expect(compactSql(finalized.sql)).not.toContain("coalesce(poisoning_lookup_coverage, 'partial')");
  });

  it("returns updated callback timestamps from the successful CAS row", async () => {
    const resolvedAt = new Date("2026-07-12T12:01:00.000Z");
    const updatedAt = new Date("2026-07-12T12:01:01.000Z");
    const queries: string[] = [];
    const db = {
      query: async (sql: string) => {
        queries.push(sql);
        const returnsUpdatedRow = compactSql(sql).includes("returning candidate.*");
        return {
          rowCount: 1,
          rows: [{
            ...candidateRow,
            outcome: "updated",
            status: returnsUpdatedRow ? "confirmed" : "candidate",
            resolved_at: returnsUpdatedRow ? resolvedAt : null,
            updated_at: returnsUpdatedRow ? updatedAt : candidateRow.updated_at
          }]
        };
      }
    } as unknown as Db;
    const result = await resolveAddressPoisoningCandidate(db, {
      callbackToken: candidateRow.callback_token,
      telegramUserId: "42",
      resolution: "confirmed"
    });
    expect(result.outcome).toBe("updated");
    expect(result.candidate?.status).toBe("confirmed");
    expect(result.candidate?.resolvedAt).toEqual(resolvedAt);
    expect(result.candidate?.updatedAt).toEqual(updatedAt);
  });

  it("returns the existing resolved row accurately for an idempotent callback", async () => {
    const resolvedAt = new Date("2026-07-12T12:02:00.000Z");
    const updatedAt = new Date("2026-07-12T12:02:01.000Z");
    const db = createMockDb(1, [{
      ...candidateRow,
      outcome: "idempotent",
      status: "dismissed",
      resolved_at: resolvedAt,
      updated_at: updatedAt
    }]);
    const result = await resolveAddressPoisoningCandidate(db.db, {
      callbackToken: candidateRow.callback_token,
      telegramUserId: "42",
      resolution: "dismissed"
    });
    expect(result).toMatchObject({
      outcome: "idempotent",
      candidate: { status: "dismissed", resolvedAt, updatedAt }
    });
  });

  it("models 30/60/120 provider retries and leaves the third failure terminal", async () => {
    const state = { status: "running", attempts: 0, nextRetryAt: null as Date | null };
    const db = {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.includes("update observed_transactions")) {
          if (state.status !== "running") return { rowCount: 0, rows: [] };
          const seconds = [30, 60, 120][Math.min(state.attempts, 2)];
          state.attempts += 1;
          state.status = "failed";
          state.nextRetryAt = new Date((params[3] as Date).getTime() + seconds * 1000);
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("with claimed as")) {
          return { rowCount: state.attempts < 3 ? 1 : 0, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      }
    } as unknown as Db;
    for (const seconds of [30, 60, 120]) {
      state.status = "running";
      await markAddressPoisoningCheckFailed(db, {
        txHash: "incoming-1", watchedWalletId: "wallet-1", error: "provider", now
      });
      expect(state.nextRetryAt).toEqual(new Date(now.getTime() + seconds * 1000));
    }
    expect(await claimAddressPoisoningChecks(db, { limit: 1, now, staleRunningBefore: now })).toEqual([]);
  });

  it("models a full fifth partial page as terminal inconclusive", async () => {
    const state = { status: "running", pageCount: 0 };
    const db = {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.includes("set poisoning_check_status = 'inconclusive'")) {
          state.status = "inconclusive";
          state.pageCount = Number(params[5]);
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("with claimed as")) return { rowCount: state.pageCount < 5 ? 1 : 0, rows: [] };
        return { rowCount: 0, rows: [] };
      }
    } as unknown as Db;
    await markAddressPoisoningCheckInconclusive(db, {
      txHash: "incoming-1",
      watchedWalletId: "wallet-1",
      coverage: "partial",
      logicalOffset: 500,
      pageCount: 5,
      fetchedCount: 500,
      oldestFetchedAt: now,
      accumulatedLookupJson: { transfers: [] },
      nextRetryAt: now,
      reason: "provider_cap"
    });
    expect(await claimAddressPoisoningChecks(db, { limit: 1, now, staleRunningBefore: now })).toEqual([]);
  });

  it("looks up active candidates and reports queue age", async () => {
    const active = createMockDb(1, [{ exists: true }]);
    expect(await hasUndismissedAddressPoisoningCandidateForIncoming(active.db, {
      watchedWalletId: "wallet-1", txHash: "incoming-1"
    })).toBe(true);
    expect(compactSql(active.queries[0].sql)).toContain("status <> 'dismissed'");
    const metrics = createMockDb(1, [{ queue_depth: "4", oldest_queue_age_ms: "91000" }]);
    expect(await getAddressPoisoningQueueMetrics(metrics.db, now)).toEqual({ queueDepth: 4, oldestQueueAgeMs: 91000 });
    expect(compactSql(metrics.queries[0].sql)).toContain("extract(epoch from ($1 - min(timestamp))) * 1000");
  });
});
