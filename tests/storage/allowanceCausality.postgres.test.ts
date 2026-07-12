import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  saveWalletApprovalAllowanceStateV2,
  upsertWalletApproval
} from "../../src/storage/repositories";
import type { Db } from "../../src/storage/db";
import type { ApprovalAllowanceStateV2 } from "../../src/types";
import {
  maxAllowanceState,
  TNARA_OWNER
} from "../fixtures/forensics/remediationDataCases";

const required = process.env.REQUIRE_PLAN1_POSTGRES === "1";
const connectionString = process.env.TEST_DATABASE_URL;
if (required && !connectionString) throw new Error("PLAN1 PostgreSQL acceptance requires TEST_DATABASE_URL");
const postgresDescribe = connectionString ? describe : describe.skip;

async function installMinimalAllowanceSchema(client: pg.PoolClient): Promise<void> {
  await client.query(`create table watched_wallets (
    id text primary key,
    address text not null
  )`);
  await client.query(`create table wallet_approvals (
    watched_wallet_id text not null references watched_wallets(id),
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
  )`);
}

function activeState(at: Date): ApprovalAllowanceStateV2 {
  return {
    ...maxAllowanceState,
    confirmedAt: at.toISOString(),
    freshUntil: new Date(at.getTime() + 15 * 60 * 1000).toISOString(),
    lastAttemptAt: at.toISOString()
  };
}

function eventInput(watchedWalletId: string, txHash: string, at: Date, amountRaw: string) {
  return {
    watchedWalletId,
    tokenContract: maxAllowanceState.tokenContract,
    spenderAddress: maxAllowanceState.spenderAddress,
    amountRaw,
    isUnlimited: true,
    spenderType: "contract" as const,
    lastApprovalTxHash: txHash,
    lastApprovalAt: at,
    riskLevel: "HIGH" as const,
    riskScore: 80,
    riskReasons: []
  };
}

postgresDescribe("wallet approval causal persistence", () => {
  it("[REQ-19][DATA] preserves event and direct-call watermarks under delayed delivery", async () => {
    const pool = new pg.Pool({ connectionString });
    const client = await pool.connect();
    const schema = `plan1_allowance_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await installMinimalAllowanceSchema(client);
      const db = { query: client.query.bind(client) } as unknown as Db;
      console.log(`[PLAN1_PG_TEMP_SCHEMA] ${schema}`);
      await client.query(
        "insert into watched_wallets (id, address) values ($1, $2), ($3, $2)",
        ["wallet-event-first", TNARA_OWNER, "wallet-call-first"]
      );

      const now = new Date();
      const event1205 = new Date(now.getTime() - 60_000);
      const event1200 = new Date(now.getTime() - 6 * 60_000);
      const call1201 = new Date(now.getTime() - 5 * 60_000);

      await upsertWalletApproval(db, eventInput("wallet-event-first", "event-1205", event1205, "10"));
      await upsertWalletApproval(db, eventInput("wallet-event-first", "event-1200", event1200, "999"));
      await expect(saveWalletApprovalAllowanceStateV2(db, {
        watchedWalletId: "wallet-event-first",
        allowance: activeState(call1201)
      })).rejects.toThrow("allowance_state_stale_write");

      const eventFirst = await client.query(
        `select last_approval_tx_hash, last_approval_at, amount_raw,
          allowance_check_status, allowance_confirmed_raw, allowance_last_attempt_at,
          current_allowance_raw, is_unlimited, status
         from wallet_approvals where watched_wallet_id = $1`,
        ["wallet-event-first"]
      );
      expect(eventFirst.rows[0]).toMatchObject({
        last_approval_tx_hash: "event-1205",
        amount_raw: "10",
        allowance_check_status: "stale",
        allowance_confirmed_raw: null,
        allowance_last_attempt_at: null,
        current_allowance_raw: "0",
        is_unlimited: false,
        status: "unknown"
      });
      expect(new Date(eventFirst.rows[0].last_approval_at).getTime()).toBe(event1205.getTime());

      const call1210 = new Date(now.getTime() - 30_000);
      const olderEvent1205 = new Date(now.getTime() - 2 * 60_000);
      await saveWalletApprovalAllowanceStateV2(db, {
        watchedWalletId: "wallet-call-first",
        allowance: activeState(call1210)
      });
      await expect(saveWalletApprovalAllowanceStateV2(db, {
        watchedWalletId: "wallet-call-first",
        allowance: activeState(call1210)
      })).resolves.toBeUndefined();
      await upsertWalletApproval(db, eventInput("wallet-call-first", "older-event", olderEvent1205, "20"));

      const callFirst = await client.query(
        `select last_approval_tx_hash, last_approval_at,
          allowance_check_status, allowance_confirmed_raw, allowance_last_attempt_at,
          current_allowance_raw, is_unlimited, status
         from wallet_approvals where watched_wallet_id = $1`,
        ["wallet-call-first"]
      );
      expect(callFirst.rows[0]).toMatchObject({
        last_approval_tx_hash: "older-event",
        allowance_check_status: "confirmed_active",
        allowance_confirmed_raw: maxAllowanceState.confirmedAllowanceRaw,
        current_allowance_raw: maxAllowanceState.confirmedAllowanceRaw,
        is_unlimited: true,
        status: "active"
      });
      expect(new Date(callFirst.rows[0].last_approval_at).getTime()).toBe(olderEvent1205.getTime());
      expect(new Date(callFirst.rows[0].allowance_last_attempt_at).getTime()).toBe(call1210.getTime());
    } finally {
      await client.query("reset search_path").catch(() => undefined);
      await client.query(`drop schema if exists "${schema}" cascade`).catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
