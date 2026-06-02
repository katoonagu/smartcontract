import { describe, expect, it } from "vitest";
import {
  claimObservedTransactionForUserAlert,
  claimDigestTransactions,
  claimObservedApprovalEvent,
  claimObservedApprovalDrainEvent,
  claimDueApprovalContexts,
  completeForensicCheckJob,
  getApprovalPollState,
  getAddressMetadata,
  getStaleAddressMetadata,
  getContractIntelligenceProfile,
  getContractLlmVerdictCache,
  getContractLlmVerdictCacheByFingerprint,
  getForensicCheckJob,
  getTronUsdtIndexerCursor,
  listWatchedWallets,
  getWalletPollState,
  getWalletApprovalSummary,
  listAddressLabelCacheForAddress,
  listIndexedTronUsdtTransfersForAddress,
  listWalletApprovalDrainObservations,
  claimUserAlertsForRetry,
  listCustomerAlertRecipients,
  listRecentRiskSignalObservations,
  getObservedTransactionForIncomingDeposit,
  markDigestSent,
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
  removeCustomerAlertRecipient,
  recordObservedTransactionRisk,
  recordApprovalPollFailure,
  recordApprovalPollSuccess,
  recordApprovalRisk,
  releaseApprovalContextAfterFailure,
  saveRiskEvaluationEvidence,
  rebuildAddressFeaturesDaily,
  updateWatchedWalletAlertMode,
  updateWalletPollState,
  upsertAddressLabelCache,
  upsertAddressMetadata,
  upsertContractIntelligenceProfile,
  upsertContractLlmVerdictCache,
  upsertCustomerAlertRecipient,
  upsertIndexedTronUsdtTransfers,
  upsertTronUsdtIndexerCursor,
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

describe("offline TRON USDT index repositories", () => {
  it("upserts indexed transfers by tx hash and event index", async () => {
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
    expect(tx.queries.some((query) => query.sql.includes("on conflict (tx_hash, event_index)"))).toBe(true);
    expect(tx.released).toBe(true);
  });

  it("queries indexed transfers by related address and time window", async () => {
    const blockTimestamp = new Date("2026-05-20T10:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        tx_hash: "tx-1",
        block_number: 100,
        block_timestamp: blockTimestamp,
        event_index: 0,
        from_address: "TFrom",
        to_address: "TTo",
        amount_raw: "1000000",
        method: "transferFrom",
        caller_address: "TCaller",
        contract_ret: "SUCCESS",
        confirmed: true
      }
    ]);

    const transfers = await listIndexedTronUsdtTransfersForAddress(db, {
      address: "TTo",
      minTimestamp: new Date("2026-05-20T00:00:00.000Z"),
      maxTimestamp: new Date("2026-05-21T00:00:00.000Z"),
      direction: "incoming",
      limit: 50
    });

    expect(transfers[0]).toMatchObject({
      txHash: "tx-1",
      method: "transferFrom",
      callerAddress: "TCaller"
    });
    expect(queries[0].sql).toContain("from tron_usdt_transfers");
    expect(queries[0].sql).toContain("to_address = $1");
  });

  it("can prioritize indexed transfers by amount for bounded forensic expansion", async () => {
    const { db, queries } = createMockDb(1, []);

    await listIndexedTronUsdtTransfersForAddress(db, {
      address: "TActive",
      minTimestamp: new Date("2026-05-20T00:00:00.000Z"),
      maxTimestamp: new Date("2026-05-21T00:00:00.000Z"),
      direction: "both",
      limit: 50,
      orderBy: "amount_desc"
    });

    expect(queries[0].sql).toContain("order by length(amount_raw) desc, amount_raw desc");
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
