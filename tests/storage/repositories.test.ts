import { describe, expect, it } from "vitest";
import {
  claimObservedTransactionForUserAlert,
  claimDigestTransactions,
  claimObservedApprovalEvent,
  claimObservedApprovalDrainEvent,
  getApprovalPollState,
  getAddressMetadata,
  getContractIntelligenceProfile,
  getWalletPollState,
  getWalletApprovalSummary,
  listWalletApprovalDrainObservations,
  claimUserAlertsForRetry,
  listCustomerAlertRecipients,
  listRecentRiskSignalObservations,
  markDigestSent,
  markApprovalOwnerAlertFailed,
  markApprovalOwnerAlertSent,
  markApprovalOwnerAlertSkipped,
  markUserAlertFailed,
  markUserAlertSent,
  markUserAlertSkipped,
  removeCustomerAlertRecipient,
  recordObservedTransactionRisk,
  recordApprovalPollFailure,
  recordApprovalPollSuccess,
  recordApprovalRisk,
  saveRiskEvaluationEvidence,
  updateWatchedWalletAlertMode,
  updateWalletPollState,
  upsertAddressMetadata,
  upsertContractIntelligenceProfile,
  upsertCustomerAlertRecipient,
  upsertWalletApproval,
  upsertWalletPollState
} from "../../src/storage/repositories";
import type { Db } from "../../src/storage/db";
import type { RawEvidenceInput, RiskSignalObservationInput, TronTransferEvent } from "../../src/types";

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
    expect(summary.drainObservationCount).toBe(1);
    expect(summary.highRiskDrainObservationCount).toBe(1);
    expect(summary.topDrainObservations[0].transferTxHash).toBe("transfer-tx");
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

  it("marks user alerts failed with bounded error text and incremented attempts", async () => {
    const { db, queries } = createMockDb();
    const longError = "x".repeat(3000);

    await markUserAlertFailed(db, { txHash: "tx-1", watchedWalletId: "wallet-1", error: longError });

    expect(queries[0].sql).toContain("user_alert_attempts = user_alert_attempts + 1");
    expect(queries[0].sql).toContain("user_alert_status = 'sending'");
    expect(queries[0].params[2]).toHaveLength(1024);
  });

  it("marks user alerts skipped for non-immediate alert modes", async () => {
    const { db, queries } = createMockDb();

    await markUserAlertSkipped(db, { txHash: "tx-1", watchedWalletId: "wallet-1", reason: "risk_only" });

    expect(queries[0].sql).toContain("user_alert_status = 'skipped'");
    expect(queries[0].sql).toContain("user_alert_last_error = $3");
    expect(queries[0].params).toEqual(["tx-1", "wallet-1", "risk_only"]);
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
