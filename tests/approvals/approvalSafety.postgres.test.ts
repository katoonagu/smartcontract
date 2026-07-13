import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  listWalletApprovals,
  saveWalletApprovalAllowanceStateV2,
  upsertWalletApproval
} from "../../src/storage/repositories";
import type { Db } from "../../src/storage/db";
import type { ApprovalAllowanceStateV2 } from "../../src/types";
import {
  activeAllowance,
  APPROVAL_TX,
  OWNER,
  VERIFY20
} from "../fixtures/forensics/remediationScoringCases";

const PLAN2_DATABASE_URL = "postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan2";
const required = process.env.REQUIRE_PLAN2_POSTGRES === "1";
const connectionString = process.env.TEST_DATABASE_URL;
if (required && connectionString !== PLAN2_DATABASE_URL) {
  throw new Error(`PLAN2 PostgreSQL acceptance requires TEST_DATABASE_URL=${PLAN2_DATABASE_URL}`);
}
const postgresDescribe = required ? describe : describe.skip;
const MAX_UINT256_RAW = activeAllowance().confirmedAllowanceRaw!;

async function installMinimalApprovalSchema(client: pg.PoolClient): Promise<void> {
  await client.query(`
    create table watched_wallets (
      id text primary key,
      address text not null
    );
    create table wallet_approvals (
      watched_wallet_id text not null references watched_wallets(id) on delete cascade,
      token_contract text not null,
      spender_address text not null,
      amount_raw text not null,
      is_unlimited boolean not null default false,
      current_allowance_raw text not null,
      spender_type text not null default 'unknown',
      status text not null default 'unknown',
      allowance_confirmed_raw text,
      allowance_check_status text not null default 'stale',
      allowance_checked_at timestamptz,
      allowance_fresh_until timestamptz,
      allowance_last_attempt_at timestamptz,
      allowance_failure_code text,
      last_approval_tx_hash text,
      last_approval_at timestamptz,
      risk_level text not null default 'LOW',
      risk_score integer not null default 0,
      risk_reasons jsonb not null default '[]'::jsonb,
      last_alerted_tx_hash text,
      updated_at timestamptz not null default now(),
      primary key (watched_wallet_id, token_contract, spender_address)
    );
    create table address_metadata (
      address text primary key,
      source text not null,
      name text,
      tag text,
      is_contract boolean
    );
    create table contract_intelligence_profiles (
      contract_address text primary key,
      provider_tags jsonb not null default '[]'::jsonb,
      public_tags jsonb not null default '[]'::jsonb,
      is_verified boolean,
      tx_count bigint,
      total_call_count bigint,
      total_caller_count bigint,
      top_methods jsonb not null default '[]'::jsonb,
      method_map jsonb not null default '{}'::jsonb,
      raw_payload jsonb not null default '{}'::jsonb
    );
    create table observed_approval_events (
      approval_tx_hash text not null,
      watched_wallet_id text not null references watched_wallets(id) on delete cascade,
      owner_address text not null,
      token_contract text not null,
      spender_address text not null,
      context_status text not null default 'not_needed',
      context_result text not null default 'unknown',
      context_deadline_at timestamptz,
      final_context_alert_sent_at timestamptz,
      primary key (approval_tx_hash, watched_wallet_id, owner_address, token_contract, spender_address)
    );
  `);
}

async function withDisposableWallet(
  run: (db: Db, watchedWalletId: string) => Promise<void>
): Promise<void> {
  const pool = new pg.Pool({ connectionString: PLAN2_DATABASE_URL });
  let client: pg.PoolClient | null = null;
  const schema = `plan2_approval_${randomUUID().replaceAll("-", "")}`;
  const watchedWalletId = `plan2-wallet-${randomUUID()}`;
  try {
    client = await pool.connect();
    await client.query(`create schema "${schema}"`);
    await client.query(`set search_path to "${schema}"`);
    await installMinimalApprovalSchema(client);
    await client.query("begin");
    await client.query(
      "insert into watched_wallets (id, address) values ($1, $2)",
      [watchedWalletId, OWNER]
    );
    const db = { query: client.query.bind(client) } as unknown as Db;
    await run(db, watchedWalletId);
  } finally {
    if (client) {
      await client.query("rollback").catch(() => undefined);
      await client.query("reset search_path");
      await client.query(`drop schema if exists "${schema}" cascade`);
      const cleanup = await client.query("select to_regnamespace($1) as schema_name", [schema]);
      console.log(`[PLAN2_PG_CLEANUP] ${schema}=${cleanup.rows[0]?.schema_name === null ? "dropped" : "present"}`);
      client.release();
    }
    await pool.end();
  }
}

function confirmedState(
  raw: string,
  at: Date,
  observedApprovalTxHash = APPROVAL_TX
): ApprovalAllowanceStateV2 {
  const zero = raw === "0";
  return {
    ...activeAllowance(raw, VERIFY20),
    state: zero ? "confirmed_zero" : "confirmed_active",
    confirmedAllowanceRaw: raw,
    isUnlimited: raw === MAX_UINT256_RAW,
    confirmedAt: at.toISOString(),
    freshUntil: new Date(at.getTime() + 15 * 60 * 1000).toISOString(),
    lastAttemptAt: at.toISOString(),
    observedApprovalTxHash
  };
}

function safetyInput(allowance: ApprovalAllowanceStateV2) {
  return {
    subjectAddress: allowance.spenderAddress,
    allowance,
    balanceAtRiskRaw: null,
    exactVerify20: true,
    exactDebit: false,
    debitFoundFromSubject: false,
    campaignEvidenceIds: ["campaign:verify20"],
    serviceSession: null,
    authoritativeServiceId: null,
    providerRisk: false,
    contractContext: { selectors: [], providerName: null, freeText: null },
    transactionExpirationAt: null
  };
}

postgresDescribe("Approval Safety V2 PostgreSQL acceptance", () => {
  it("[REQ-19][AC-19][POSTGRES] scores the persisted fresh direct allowance state", async () => {
    await withDisposableWallet(async (db, watchedWalletId) => {
      const checkedAt = new Date(Date.now() - 60_000);
      await saveWalletApprovalAllowanceStateV2(db, {
        watchedWalletId,
        allowance: confirmedState(MAX_UINT256_RAW, checkedAt)
      });

      const [approval] = await listWalletApprovals(db, watchedWalletId);
      expect(approval.allowanceStateV2).toMatchObject({
        state: "confirmed_active",
        confirmedAllowanceRaw: MAX_UINT256_RAW,
        isUnlimited: true
      });

      const { evaluateApprovalSafetyV2 } = await import("../../src/approvals/approvalSafetyAssessment");
      const result = evaluateApprovalSafetyV2(safetyInput(approval.allowanceStateV2!) as any);
      expect(result).toMatchObject({ score: 90, level: "CRITICAL" });
    });
  });

  it("[REQ-19][AC-23][POSTGRES] removes active threat after a later confirmed zero", async () => {
    await withDisposableWallet(async (db, watchedWalletId) => {
      const firstCheckedAt = new Date(Date.now() - 120_000);
      const laterCheckedAt = new Date(firstCheckedAt.getTime() + 60_000);
      const approvalTxHash = APPROVAL_TX;
      await saveWalletApprovalAllowanceStateV2(db, {
        watchedWalletId,
        allowance: confirmedState(MAX_UINT256_RAW, firstCheckedAt, approvalTxHash)
      });
      await saveWalletApprovalAllowanceStateV2(db, {
        watchedWalletId,
        allowance: confirmedState("0", laterCheckedAt, approvalTxHash)
      });

      const [approval] = await listWalletApprovals(db, watchedWalletId);
      expect(approval.allowanceStateV2).toMatchObject({
        state: "confirmed_zero",
        confirmedAllowanceRaw: "0",
        isUnlimited: false,
        observedApprovalTxHash: approvalTxHash
      });

      const { evaluateApprovalSafetyV2 } = await import("../../src/approvals/approvalSafetyAssessment");
      const result = evaluateApprovalSafetyV2(safetyInput(approval.allowanceStateV2!) as any);
      expect(result).toMatchObject({ score: 0, level: "LOW" });
      expect(result.allowance.observedApprovalTxHash).toBe(approvalTxHash);
    });
  });

  it("[REQ-19][POSTGRES][ALLOWANCE-FAILURE] keeps historical event amount out of current allowance", async () => {
    await withDisposableWallet(async (db, watchedWalletId) => {
      const historicalAmountRaw = "900000000";
      const approvalTxHash = APPROVAL_TX;
      const approvalAt = new Date(Date.now() - 120_000);
      const failedAt = new Date(approvalAt.getTime() + 60_000);
      await upsertWalletApproval(db, {
        watchedWalletId,
        tokenContract: activeAllowance().tokenContract,
        spenderAddress: VERIFY20,
        amountRaw: historicalAmountRaw,
        isUnlimited: false,
        spenderType: "contract",
        lastApprovalTxHash: approvalTxHash,
        lastApprovalAt: approvalAt,
        riskLevel: "HIGH",
        riskScore: 80,
        riskReasons: []
      });
      await saveWalletApprovalAllowanceStateV2(db, {
        watchedWalletId,
        allowance: {
          ...activeAllowance(undefined, VERIFY20),
          state: "failed",
          confirmedAllowanceRaw: null,
          isUnlimited: null,
          confirmedAt: null,
          freshUntil: null,
          lastAttemptAt: failedAt.toISOString(),
          failureCode: "provider_unavailable",
          observedApprovalTxHash: approvalTxHash
        }
      });

      const [approval] = await listWalletApprovals(db, watchedWalletId);
      expect(approval).toMatchObject({
        amountRaw: historicalAmountRaw,
        currentAllowanceRaw: "0",
        isUnlimited: false,
        status: "unknown"
      });
      expect(approval.allowanceStateV2).toMatchObject({
        state: "failed",
        confirmedAllowanceRaw: null,
        isUnlimited: null,
        observedApprovalTxHash: approvalTxHash
      });
      expect(JSON.stringify(approval.allowanceStateV2)).not.toContain(historicalAmountRaw);

      const { evaluateApprovalSafetyV2 } = await import("../../src/approvals/approvalSafetyAssessment");
      const result = evaluateApprovalSafetyV2(safetyInput(approval.allowanceStateV2!) as any);
      expect(result).toMatchObject({ score: null, level: "UNKNOWN" });
    });
  });
});
