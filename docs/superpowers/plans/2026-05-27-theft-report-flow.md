# Theft Report Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Telegram bot flow for paid preliminary theft reports from TRON USDT transaction hashes, including a critical `reported_scam` risk label and neutral `victim` case label.

**Architecture:** Keep the flow in the existing grammy bot state-machine: callbacks set `telegram_user_sessions.pending_action`, text handlers consume the pending state, and inline keyboards drive confirmation. Store report state in a new `theft_reports` table and repository functions; keep transaction extraction in a small check-layer helper so bot code does not parse Tronscan payloads directly.

**Tech Stack:** TypeScript, Node.js, grammy, PostgreSQL migrations, Vitest, existing TRON/Tronscan client abstractions.

---

## File Structure

- Create `migrations/019_theft_report_flow.sql`: schema for `theft_reports`, session selected report id, and label constraint updates.
- Create `src/check/theftReportTransaction.ts`: official TRON USDT theft-transfer extraction from transaction info.
- Create `tests/check/theftReportTransaction.test.ts`: unit coverage for sender/receiver/amount extraction.
- Modify `src/types.ts`: add `reported_scam` and `victim` to `RiskLabel`.
- Modify `src/risk/riskEngine.ts`: score `reported_scam` as CRITICAL and `victim` as neutral.
- Modify `src/risk/evaluation.ts`: metadata severity/confidence for the two new labels.
- Modify `src/storage/repositories.ts`: add report types, parsers, mappers, CRUD helpers, session selected report id support, and label validation.
- Modify `src/config.ts`: add deposit wallet, optional guide URL, and optional admin contact config.
- Modify `.env.example`: document the new environment variables.
- Modify `tests/config/config.test.ts`: cover defaults and validation for new config fields.
- Modify `src/bot/i18n.ts`: add theft button translations.
- Modify `src/bot/keyboards.ts`: add theft callbacks and keyboards.
- Modify `src/bot/messages.ts`: add theft prompt/card/deposit/final messages.
- Modify `src/bot/createBot.ts`: wire the end-to-end report flow.
- Modify `tests/bot/createBot.test.ts`: add fake DB support and smoke coverage for the flow.
- Modify existing label/risk tests as needed: `tests/risk/evaluation.test.ts`, `tests/risk/riskEngine.test.ts`, `tests/storage/repositories.test.ts`.

## Task 1: Transaction Extraction Helper

**Files:**
- Create: `src/check/theftReportTransaction.ts`
- Create: `tests/check/theftReportTransaction.test.ts`

- [ ] **Step 1: Write the failing transaction extraction tests**

Create `tests/check/theftReportTransaction.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractTheftReportTransferFromTransactionInfo, formatRawUsdt } from "../../src/check/theftReportTransaction";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";

describe("theft report transaction extraction", () => {
  it("extracts sender receiver and amount from official TRON USDT transfer info", () => {
    const result = extractTheftReportTransferFromTransactionInfo("a".repeat(64), {
      trc20TransferInfo: [
        {
          from_address: "TSender111111111111111111111111111111",
          to_address: "TReceiver11111111111111111111111111111",
          quant: "123456789",
          contract_address: TRON_USDT_CONTRACT_ADDRESS
        }
      ]
    });

    expect(result).toEqual({
      txHash: "a".repeat(64),
      sender: "TSender111111111111111111111111111111",
      receiver: "TReceiver11111111111111111111111111111",
      amountRaw: "123456789",
      amountUsdt: "123.456789"
    });
  });

  it("prefers the official USDT transfer when several token transfers exist", () => {
    const result = extractTheftReportTransferFromTransactionInfo("b".repeat(64), {
      trc20TransferInfo: [
        {
          from_address: "TNoise1111111111111111111111111111111",
          to_address: "TNoise2222222222222222222222222222222",
          quant: "9000000",
          contract_address: "TNotUsdt1111111111111111111111111111",
          tokenInfo: { tokenAbbr: "USDT" }
        },
        {
          from_address: "TUsdtSender11111111111111111111111111",
          to_address: "TUsdtReceiver11111111111111111111111",
          amount_str: "5000000",
          tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS }
        }
      ]
    });

    expect(result?.sender).toBe("TUsdtSender11111111111111111111111111");
    expect(result?.receiver).toBe("TUsdtReceiver11111111111111111111111");
    expect(result?.amountRaw).toBe("5000000");
    expect(result?.amountUsdt).toBe("5");
  });

  it("rejects token abbreviation without the official contract", () => {
    expect(extractTheftReportTransferFromTransactionInfo("c".repeat(64), {
      trc20TransferInfo: [
        {
          from_address: "TSpoofed11111111111111111111111111111",
          to_address: "TReceiver11111111111111111111111111111",
          quant: "1000000",
          tokenInfo: { tokenAbbr: "USDT" }
        }
      ]
    })).toBeNull();
  });

  it("rejects transfers without receiver or amount", () => {
    expect(extractTheftReportTransferFromTransactionInfo("d".repeat(64), {
      trc20TransferInfo: [
        {
          from_address: "TSender111111111111111111111111111111",
          contract_address: TRON_USDT_CONTRACT_ADDRESS
        }
      ]
    })).toBeNull();
  });

  it("formats raw USDT with trimmed fractional zeros", () => {
    expect(formatRawUsdt("1000000")).toBe("1");
    expect(formatRawUsdt("1000100")).toBe("1.0001");
    expect(formatRawUsdt("0")).toBe("0");
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
npm test -- tests/check/theftReportTransaction.test.ts
```

Expected: FAIL because `src/check/theftReportTransaction.ts` does not exist.

- [ ] **Step 3: Add the helper implementation**

Create `src/check/theftReportTransaction.ts`:

```ts
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { TronClient } from "../tron/tronClient";

export type TheftReportTransfer = {
  txHash: string;
  sender: string;
  receiver: string;
  amountRaw: string;
  amountUsdt: string;
};

type TransactionInfoTransfer = {
  from_address?: unknown;
  to_address?: unknown;
  amount?: unknown;
  amount_str?: unknown;
  quant?: unknown;
  contract_address?: unknown;
  contractAddress?: unknown;
  tokenInfo?: {
    tokenId?: unknown;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOfficialUsdtTransfer(transfer: TransactionInfoTransfer): boolean {
  return (
    transfer.contract_address === TRON_USDT_CONTRACT_ADDRESS ||
    transfer.contractAddress === TRON_USDT_CONTRACT_ADDRESS ||
    transfer.tokenInfo?.tokenId === TRON_USDT_CONTRACT_ADDRESS
  );
}

export function formatRawUsdt(amountRaw: string): string {
  if (!/^\d+$/.test(amountRaw)) return amountRaw;
  const raw = BigInt(amountRaw);
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

function transferAmountRaw(transfer: TransactionInfoTransfer): string | null {
  const raw = transfer.quant ?? transfer.amount_str ?? transfer.amount;
  return isNonEmptyString(raw) && /^\d+$/.test(raw) ? raw : null;
}

export function extractTheftReportTransferFromTransactionInfo(txHash: string, raw: unknown): TheftReportTransfer | null {
  if (!isRecord(raw) || !Array.isArray(raw.trc20TransferInfo)) return null;
  const transfers = raw.trc20TransferInfo as TransactionInfoTransfer[];
  const transfer = transfers.find((item) => isOfficialUsdtTransfer(item));
  if (!transfer) return null;

  const sender = isNonEmptyString(transfer.from_address) ? transfer.from_address : null;
  const receiver = isNonEmptyString(transfer.to_address) ? transfer.to_address : null;
  const amountRaw = transferAmountRaw(transfer);
  if (!sender || !receiver || !amountRaw) return null;

  return {
    txHash,
    sender,
    receiver,
    amountRaw,
    amountUsdt: formatRawUsdt(amountRaw)
  };
}

export async function loadTheftReportTransfer(txHash: string, tronClient: TronClient): Promise<TheftReportTransfer> {
  const raw = await tronClient.getTransaction(txHash);
  const transfer = extractTheftReportTransferFromTransactionInfo(txHash, raw);
  if (!transfer) {
    throw new Error(`Could not extract official TRON USDT transfer from transaction: ${txHash}`);
  }
  return transfer;
}
```

- [ ] **Step 4: Run the helper tests**

Run:

```powershell
npm test -- tests/check/theftReportTransaction.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/check/theftReportTransaction.ts tests/check/theftReportTransaction.test.ts
git commit -m "feat: add theft report transaction parser"
```

## Task 2: Schema And Repository Support

**Files:**
- Create: `migrations/019_theft_report_flow.sql`
- Modify: `src/types.ts`
- Modify: `src/storage/repositories.ts`
- Modify: `tests/storage/repositories.test.ts`

- [ ] **Step 1: Write repository tests for theft report storage**

Append focused tests to `tests/storage/repositories.test.ts` using the existing test database helpers in that file. Use these assertions:

```ts
import {
  cancelTheftReport,
  confirmTheftReportDeposit,
  getTheftReport,
  setTelegramUserPendingAction,
  updateTheftReportComment,
  upsertTelegramUser,
  upsertTheftReportDraft
} from "../../src/storage/repositories";

it("stores and updates a theft report draft", async () => {
  await upsertTelegramUser(db, { telegramUserId: "42", username: "victim" });
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

  expect(report.status).toBe("draft");
  expect(report.comment).toBeNull();

  const withComment = await updateTheftReportComment(db, {
    id: report.id,
    telegramUserId: "42",
    comment: "Украли после фишинговой ссылки"
  });
  expect(withComment?.comment).toBe("Украли после фишинговой ссылки");

  const loaded = await getTheftReport(db, report.id);
  expect(loaded?.reportedScamAddress).toBe("TReceiver11111111111111111111111111111");
});

it("stores selected theft report id in telegram session", async () => {
  await upsertTelegramUser(db, { telegramUserId: "42", username: "victim" });
  await setTelegramUserPendingAction(db, {
    telegramUserId: "42",
    pendingAction: "report_theft_comment",
    selectedTheftReportId: "report-1"
  });

  const session = await getTelegramUserSession(db, "42");
  expect(session?.pendingAction).toBe("report_theft_comment");
  expect(session?.selectedTheftReportId).toBe("report-1");
});

it("confirms and cancels theft reports idempotently", async () => {
  await upsertTelegramUser(db, { telegramUserId: "42", username: "victim" });
  const report = await upsertTheftReportDraft(db, {
    telegramUserId: "42",
    txHash: "a".repeat(64),
    victimAddress: "TSender111111111111111111111111111111",
    reportedScamAddress: "TReceiver11111111111111111111111111111",
    amountRaw: "1000000",
    amountUsdt: "1",
    depositAddress: "T999999999999999999999999999999999",
    depositAmountUsdt: "1000"
  });

  const confirmed = await confirmTheftReportDeposit(db, { id: report.id, telegramUserId: "42" });
  const confirmedAgain = await confirmTheftReportDeposit(db, { id: report.id, telegramUserId: "42" });
  expect(confirmed?.status).toBe("documents_requested");
  expect(confirmedAgain?.status).toBe("documents_requested");

  const cancelled = await cancelTheftReport(db, { id: report.id, telegramUserId: "42" });
  expect(cancelled?.status).toBe("cancelled");
});
```

- [ ] **Step 2: Run the failing repository tests**

Run:

```powershell
npm test -- tests/storage/repositories.test.ts
```

Expected: FAIL because theft report repository functions and session field are missing.

- [ ] **Step 3: Add the migration**

Create `migrations/019_theft_report_flow.sql`:

```sql
alter table telegram_user_sessions
  add column if not exists selected_theft_report_id text;

alter table telegram_user_sessions drop constraint if exists telegram_user_sessions_pending_action_check;
alter table telegram_user_sessions
  add constraint telegram_user_sessions_pending_action_check
  check (pending_action is null or pending_action in (
    'add_wallet',
    'check_address',
    'check_tx',
    'add_alert_admin',
    'add_alert_admin_all',
    'add_alert_admin_suspicious_only',
    'remove_alert_admin',
    'report_theft_tx',
    'report_theft_comment'
  ));

create table if not exists theft_reports (
  id text primary key,
  telegram_user_id text not null references telegram_users(telegram_user_id) on delete cascade,
  tx_hash text not null,
  victim_address text not null,
  reported_scam_address text not null,
  amount_raw text not null,
  amount_usdt text not null,
  comment text,
  status text not null default 'draft',
  deposit_address text not null,
  deposit_amount_usdt text not null default '1000',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table theft_reports drop constraint if exists theft_reports_status_check;
alter table theft_reports
  add constraint theft_reports_status_check
  check (status in ('draft', 'awaiting_deposit', 'deposit_confirmed', 'documents_requested', 'cancelled'));

create index if not exists theft_reports_user_status_idx
  on theft_reports(telegram_user_id, status, created_at desc);

create index if not exists theft_reports_reported_scam_address_idx
  on theft_reports(reported_scam_address, created_at desc);

alter table address_labels drop constraint if exists address_labels_label_check;
alter table address_labels
  add constraint address_labels_label_check
  check (label in (
    'scam', 'stolen_funds', 'phishing', 'mule', 'collector', 'bridge', 'exchange',
    'trusted', 'false_positive', 'needs_review', 'mixer_like', 'risky_contract',
    'whitebit', 'darknet_exchange', 'darknet_exchange_proximity',
    'approval_drain_proximity', 'reported_scam', 'victim'
  ));

alter table transaction_labels drop constraint if exists transaction_labels_label_check;
alter table transaction_labels
  add constraint transaction_labels_label_check
  check (label in (
    'scam', 'stolen_funds', 'phishing', 'mule', 'collector', 'bridge', 'exchange',
    'trusted', 'false_positive', 'needs_review', 'mixer_like', 'risky_contract',
    'whitebit', 'darknet_exchange', 'darknet_exchange_proximity',
    'approval_drain_proximity', 'reported_scam', 'victim'
  ));
```

- [ ] **Step 4: Extend storage types and parsers**

Modify `src/types.ts`:

```ts
export type RiskLabel =
  | "scam"
  | "stolen_funds"
  | "phishing"
  | "mule"
  | "collector"
  | "bridge"
  | "exchange"
  | "trusted"
  | "false_positive"
  | "needs_review"
  | "mixer_like"
  | "risky_contract"
  | "whitebit"
  | "darknet_exchange"
  | "darknet_exchange_proximity"
  | "approval_drain_proximity"
  | "reported_scam"
  | "victim";
```

Modify `src/storage/repositories.ts`:

```ts
export type TelegramUserPendingAction =
  | "add_wallet"
  | "check_address"
  | "check_tx"
  | "add_alert_admin"
  | "add_alert_admin_all"
  | "add_alert_admin_suspicious_only"
  | "remove_alert_admin"
  | "report_theft_tx"
  | "report_theft_comment";

export type TelegramUserSession = {
  telegramUserId: string;
  pendingAction: TelegramUserPendingAction | null;
  selectedWalletId: string | null;
  selectedTheftReportId: string | null;
  updatedAt: Date;
};

export type TheftReportStatus = "draft" | "awaiting_deposit" | "deposit_confirmed" | "documents_requested" | "cancelled";

export type TheftReport = {
  id: string;
  telegramUserId: string;
  txHash: string;
  victimAddress: string;
  reportedScamAddress: string;
  amountRaw: string;
  amountUsdt: string;
  comment: string | null;
  status: TheftReportStatus;
  depositAddress: string;
  depositAmountUsdt: string;
  createdAt: Date;
  updatedAt: Date;
};

export type TheftReportDraftInput = {
  id?: string;
  telegramUserId: string;
  txHash: string;
  victimAddress: string;
  reportedScamAddress: string;
  amountRaw: string;
  amountUsdt: string;
  depositAddress: string;
  depositAmountUsdt: string;
};
```

Update the validation sets:

```ts
const riskLabels = new Set<RiskLabel>([
  "scam",
  "stolen_funds",
  "phishing",
  "mule",
  "collector",
  "bridge",
  "exchange",
  "trusted",
  "false_positive",
  "needs_review",
  "mixer_like",
  "risky_contract",
  "whitebit",
  "darknet_exchange",
  "darknet_exchange_proximity",
  "approval_drain_proximity",
  "reported_scam",
  "victim"
]);

const telegramUserPendingActions = new Set<TelegramUserPendingAction>([
  "add_wallet",
  "check_address",
  "check_tx",
  "add_alert_admin",
  "add_alert_admin_all",
  "add_alert_admin_suspicious_only",
  "remove_alert_admin",
  "report_theft_tx",
  "report_theft_comment"
]);

const theftReportStatuses = new Set<TheftReportStatus>(["draft", "awaiting_deposit", "deposit_confirmed", "documents_requested", "cancelled"]);
```

Add parser and mapper:

```ts
function parseTheftReportStatus(value: string): TheftReportStatus {
  if (!theftReportStatuses.has(value as TheftReportStatus)) {
    throw new Error(`Invalid theft report status: ${value}`);
  }
  return value as TheftReportStatus;
}

function mapTheftReportRow(row: Record<string, any>): TheftReport {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    txHash: row.tx_hash,
    victimAddress: row.victim_address,
    reportedScamAddress: row.reported_scam_address,
    amountRaw: String(row.amount_raw),
    amountUsdt: String(row.amount_usdt),
    comment: row.comment ?? null,
    status: parseTheftReportStatus(row.status),
    depositAddress: row.deposit_address,
    depositAmountUsdt: String(row.deposit_amount_usdt),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
```

Update session mapping and SQL:

```ts
function mapTelegramUserSessionRow(row: Record<string, any>): TelegramUserSession {
  return {
    telegramUserId: row.telegram_user_id,
    pendingAction: parseTelegramUserPendingAction(row.pending_action),
    selectedWalletId: row.selected_wallet_id,
    selectedTheftReportId: row.selected_theft_report_id ?? null,
    updatedAt: row.updated_at
  };
}
```

Change `getTelegramUserSession` select:

```ts
`select telegram_user_id, pending_action, selected_wallet_id, selected_theft_report_id, updated_at
 from telegram_user_sessions
 where telegram_user_id = $1`
```

Change `setTelegramUserPendingAction` signature and query:

```ts
export async function setTelegramUserPendingAction(
  db: Db,
  input: {
    telegramUserId: string;
    pendingAction: TelegramUserPendingAction;
    selectedWalletId?: string | null;
    selectedTheftReportId?: string | null;
  }
): Promise<void> {
  await db.query(
    `insert into telegram_user_sessions (telegram_user_id, pending_action, selected_wallet_id, selected_theft_report_id)
     values ($1, $2, $3, $4)
     on conflict (telegram_user_id) do update set
       pending_action = excluded.pending_action,
       selected_wallet_id = excluded.selected_wallet_id,
       selected_theft_report_id = excluded.selected_theft_report_id,
       updated_at = now()`,
    [input.telegramUserId, input.pendingAction, input.selectedWalletId ?? null, input.selectedTheftReportId ?? null]
  );
}
```

Change `clearTelegramUserPendingAction`:

```ts
`update telegram_user_sessions
 set pending_action = null,
   selected_wallet_id = null,
   selected_theft_report_id = null,
   updated_at = now()
 where telegram_user_id = $1`
```

- [ ] **Step 5: Add repository functions**

Add to `src/storage/repositories.ts` near other repository exports:

```ts
export async function upsertTheftReportDraft(db: Db, input: TheftReportDraftInput): Promise<TheftReport> {
  const id = input.id ?? createId();
  const result = await db.query(
    `insert into theft_reports (
       id, telegram_user_id, tx_hash, victim_address, reported_scam_address,
       amount_raw, amount_usdt, comment, status, deposit_address, deposit_amount_usdt
     )
     values ($1, $2, $3, $4, $5, $6, $7, null, 'draft', $8, $9)
     on conflict (id) do update set
       tx_hash = excluded.tx_hash,
       victim_address = excluded.victim_address,
       reported_scam_address = excluded.reported_scam_address,
       amount_raw = excluded.amount_raw,
       amount_usdt = excluded.amount_usdt,
       status = 'draft',
       deposit_address = excluded.deposit_address,
       deposit_amount_usdt = excluded.deposit_amount_usdt,
       updated_at = now()
     where theft_reports.telegram_user_id = excluded.telegram_user_id
     returning id, telegram_user_id, tx_hash, victim_address, reported_scam_address,
       amount_raw, amount_usdt, comment, status, deposit_address, deposit_amount_usdt,
       created_at, updated_at`,
    [
      id,
      input.telegramUserId,
      input.txHash,
      input.victimAddress,
      input.reportedScamAddress,
      input.amountRaw,
      input.amountUsdt,
      input.depositAddress,
      input.depositAmountUsdt
    ]
  );
  return mapTheftReportRow(result.rows[0]);
}

export async function getTheftReport(db: Db, id: string): Promise<TheftReport | null> {
  const result = await db.query(
    `select id, telegram_user_id, tx_hash, victim_address, reported_scam_address,
       amount_raw, amount_usdt, comment, status, deposit_address, deposit_amount_usdt,
       created_at, updated_at
     from theft_reports
     where id = $1`,
    [id]
  );
  return result.rows[0] ? mapTheftReportRow(result.rows[0]) : null;
}

export async function updateTheftReportComment(
  db: Db,
  input: { id: string; telegramUserId: string; comment: string }
): Promise<TheftReport | null> {
  const boundedComment = input.comment.trim().slice(0, 1000);
  const result = await db.query(
    `update theft_reports
     set comment = $3,
       updated_at = now()
     where id = $1 and telegram_user_id = $2 and status in ('draft', 'awaiting_deposit')
     returning id, telegram_user_id, tx_hash, victim_address, reported_scam_address,
       amount_raw, amount_usdt, comment, status, deposit_address, deposit_amount_usdt,
       created_at, updated_at`,
    [input.id, input.telegramUserId, boundedComment]
  );
  return result.rows[0] ? mapTheftReportRow(result.rows[0]) : null;
}

export async function markTheftReportAwaitingDeposit(
  db: Db,
  input: { id: string; telegramUserId: string }
): Promise<TheftReport | null> {
  const result = await db.query(
    `update theft_reports
     set status = 'awaiting_deposit',
       updated_at = now()
     where id = $1 and telegram_user_id = $2 and status in ('draft', 'awaiting_deposit')
     returning id, telegram_user_id, tx_hash, victim_address, reported_scam_address,
       amount_raw, amount_usdt, comment, status, deposit_address, deposit_amount_usdt,
       created_at, updated_at`,
    [input.id, input.telegramUserId]
  );
  return result.rows[0] ? mapTheftReportRow(result.rows[0]) : null;
}

export async function confirmTheftReportDeposit(
  db: Db,
  input: { id: string; telegramUserId: string }
): Promise<TheftReport | null> {
  const result = await db.query(
    `update theft_reports
     set status = 'documents_requested',
       updated_at = now()
     where id = $1 and telegram_user_id = $2 and status in ('awaiting_deposit', 'deposit_confirmed', 'documents_requested')
     returning id, telegram_user_id, tx_hash, victim_address, reported_scam_address,
       amount_raw, amount_usdt, comment, status, deposit_address, deposit_amount_usdt,
       created_at, updated_at`,
    [input.id, input.telegramUserId]
  );
  return result.rows[0] ? mapTheftReportRow(result.rows[0]) : null;
}

export async function cancelTheftReport(
  db: Db,
  input: { id: string; telegramUserId: string }
): Promise<TheftReport | null> {
  const result = await db.query(
    `update theft_reports
     set status = 'cancelled',
       updated_at = now()
     where id = $1 and telegram_user_id = $2
     returning id, telegram_user_id, tx_hash, victim_address, reported_scam_address,
       amount_raw, amount_usdt, comment, status, deposit_address, deposit_amount_usdt,
       created_at, updated_at`,
    [input.id, input.telegramUserId]
  );
  return result.rows[0] ? mapTheftReportRow(result.rows[0]) : null;
}
```

- [ ] **Step 6: Run migration and repository tests**

Run:

```powershell
npm run db:migrate
npm test -- tests/storage/repositories.test.ts
```

Expected: migration succeeds; repository tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add migrations/019_theft_report_flow.sql src/types.ts src/storage/repositories.ts tests/storage/repositories.test.ts
git commit -m "feat: add theft report persistence"
```

## Task 3: Risk Policy For `reported_scam` And `victim`

**Files:**
- Modify: `src/risk/riskEngine.ts`
- Modify: `src/risk/evaluation.ts`
- Modify: `tests/risk/riskEngine.test.ts`
- Modify: `tests/risk/evaluation.test.ts`

- [ ] **Step 1: Write risk tests**

Add to `tests/risk/riskEngine.test.ts`:

```ts
it("treats reported_scam as critical paid preliminary evidence", () => {
  const report = calculateRisk({
    subjectAddress: "TReceiver11111111111111111111111111111",
    labels: [{
      address: "TReceiver11111111111111111111111111111",
      label: "reported_scam",
      source: "system",
      createdByTelegramId: "42",
      createdAt: new Date("2026-05-27T00:00:00.000Z")
    }],
    graphSignals: [],
    behaviorSignals: [],
    amlSignals: []
  });

  expect(report.level).toBe("CRITICAL");
  expect(report.score).toBe(90);
  expect(report.reasons[0]).toMatchObject({
    code: "internal_label_reported_scam",
    message: "Paid preliminary theft report: depositor reported this wallet as the receiver of stolen funds.",
    scoreImpact: 90
  });
  expect(report.reasons.map((reason) => reason.message).join("\n")).not.toMatch(/confirmed scam|fraud proven/i);
});

it("keeps victim label neutral", () => {
  const report = calculateRisk({
    subjectAddress: "TSender111111111111111111111111111111",
    labels: [{
      address: "TSender111111111111111111111111111111",
      label: "victim",
      source: "system",
      createdByTelegramId: "42",
      createdAt: new Date("2026-05-27T00:00:00.000Z")
    }],
    graphSignals: [],
    behaviorSignals: [],
    amlSignals: []
  });

  expect(report.level).toBe("LOW");
  expect(report.score).toBe(0);
  expect(report.reasons).toEqual([]);
});
```

Add to `tests/risk/evaluation.test.ts`:

```ts
it("records reported_scam evidence as critical internal label metadata", () => {
  const result = evaluateAddressRisk({
    context: { subjectAddress: "TReceiver11111111111111111111111111111" },
    labels: [{
      address: "TReceiver11111111111111111111111111111",
      label: "reported_scam",
      source: "system",
      createdByTelegramId: "42",
      createdAt: new Date("2026-05-27T00:00:00.000Z")
    }]
  });

  expect(result.report.level).toBe("CRITICAL");
  expect(result.observations[0]).toMatchObject({
    code: "internal_label_reported_scam",
    confidence: "high",
    severity: "critical",
    signalGroup: "internal_label"
  });
  expect(result.rawEvidence[0].evidenceJson).toMatchObject({ label: "reported_scam", source: "system" });
});
```

- [ ] **Step 2: Run the failing risk tests**

Run:

```powershell
npm test -- tests/risk/riskEngine.test.ts tests/risk/evaluation.test.ts
```

Expected: FAIL because risk scoring does not know the new labels.

- [ ] **Step 3: Update risk scoring**

Modify `src/risk/riskEngine.ts`:

```ts
const criticalLabels = new Set(["scam", "stolen_funds", "phishing", "mixer_like", "risky_contract", "whitebit", "darknet_exchange", "reported_scam"]);
const highRiskLabels = new Set(["darknet_exchange_proximity", "approval_drain_proximity"]);
const mitigatingLabels = new Set(["trusted", "false_positive"]);
const neutralLabels = new Set(["victim"]);
```

Replace `labelScoreImpact`:

```ts
function labelScoreImpact(label: AddressLabel["label"]): number {
  if (neutralLabels.has(label)) return 0;
  if (criticalLabels.has(label)) return 90;
  if (highRiskLabels.has(label)) return 80;
  return 35;
}
```

Replace `labelMessage`:

```ts
function labelMessage(label: AddressLabel["label"]): string {
  if (label === "reported_scam") {
    return "Paid preliminary theft report: depositor reported this wallet as the receiver of stolen funds.";
  }
  if (label === "victim") {
    return "Case context: wallet reported as the victim source in a theft report.";
  }
  if (label === "darknet_exchange_proximity") {
    return "Derived high-risk marker: confirmed on-chain exposure to known darknet exchange seed within 2 hops.";
  }
  if (label === "approval_drain_proximity") {
    return "Derived high-risk marker: exact upstream approval-drain provenance linked to this address.";
  }
  return `Internal label: ${label}`;
}
```

- [ ] **Step 4: Update evaluation metadata**

Modify `src/risk/evaluation.ts`:

```ts
const criticalLabels = new Set(["scam", "stolen_funds", "phishing", "mixer_like", "risky_contract", "whitebit", "darknet_exchange", "reported_scam"]);
const highRiskLabels = new Set(["darknet_exchange_proximity", "approval_drain_proximity"]);
const mitigatingLabels = new Set(["trusted", "false_positive"]);
const neutralLabels = new Set(["victim"]);
```

Replace the helper functions:

```ts
function labelScoreImpact(label: string): number {
  if (neutralLabels.has(label)) return 0;
  if (mitigatingLabels.has(label)) return -40;
  if (highRiskLabels.has(label)) return 80;
  return criticalLabels.has(label) ? 90 : 35;
}

function labelSeverity(label: string): RiskSeverity {
  if (neutralLabels.has(label)) return "info";
  if (mitigatingLabels.has(label)) return "info";
  if (highRiskLabels.has(label)) return "high";
  return criticalLabels.has(label) ? "critical" : "medium";
}

function labelConfidence(label: AddressLabel): RiskConfidence {
  if (label.label === "reported_scam") return "high";
  if (label.label === "victim") return "medium";
  if (label.label === "darknet_exchange_proximity" || label.label === "approval_drain_proximity") return "high";
  return label.source === "service_admin" ? "high" : "medium";
}
```

- [ ] **Step 5: Run risk tests**

Run:

```powershell
npm test -- tests/risk/riskEngine.test.ts tests/risk/evaluation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/risk/riskEngine.ts src/risk/evaluation.ts tests/risk/riskEngine.test.ts tests/risk/evaluation.test.ts
git commit -m "feat: score preliminary theft reports"
```

## Task 4: Config For Deposit And Contact

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`
- Modify: `tests/config/config.test.ts`

- [ ] **Step 1: Write config tests**

Add tests to `tests/config/config.test.ts`:

```ts
it("loads theft report defaults", () => {
  process.env.BOT_TOKEN = "123:test";
  process.env.DATABASE_URL = "postgres://postgres:postgres@localhost:5432/tron_guard";
  delete process.env.THEFT_REPORT_DEPOSIT_ADDRESS;
  delete process.env.THEFT_REPORT_GUIDE_URL;
  delete process.env.THEFT_REPORT_ADMIN_CONTACT;

  const config = loadConfig();

  expect(config.theftReportDepositAddress).toBe("T999999999999999999999999999999999");
  expect(config.theftReportDepositAmountUsdt).toBe("1000");
  expect(config.theftReportGuideUrl).toBeUndefined();
  expect(config.theftReportAdminContact).toBeUndefined();
});

it("validates theft report deposit address and optional guide URL", () => {
  process.env.BOT_TOKEN = "123:test";
  process.env.DATABASE_URL = "postgres://postgres:postgres@localhost:5432/tron_guard";
  process.env.THEFT_REPORT_DEPOSIT_ADDRESS = "bad";

  expect(() => loadConfig()).toThrow("THEFT_REPORT_DEPOSIT_ADDRESS must be a TRON address");

  process.env.THEFT_REPORT_DEPOSIT_ADDRESS = "T888888888888888888888888888888888";
  process.env.THEFT_REPORT_GUIDE_URL = "http://example.com";

  expect(() => loadConfig()).toThrow("THEFT_REPORT_GUIDE_URL must use https");
});
```

- [ ] **Step 2: Run the failing config tests**

Run:

```powershell
npm test -- tests/config/config.test.ts
```

Expected: FAIL because config fields do not exist.

- [ ] **Step 3: Extend config**

Modify `src/config.ts` `AppConfig`:

```ts
  theftReportDepositAddress: string;
  theftReportDepositAmountUsdt: "1000";
  theftReportGuideUrl: URL | undefined;
  theftReportAdminContact: string | undefined;
```

Add helpers:

```ts
function parseTronAddress(name: string, rawValue: string): string {
  const value = rawValue.trim();
  if (!/^T[a-zA-Z0-9]{33}$/.test(value)) {
    throw new Error(`${name} must be a TRON address`);
  }
  return value;
}

function parseOptionalHttpsUrl(name: string, rawValue: string | undefined): URL | undefined {
  const value = rawValue?.trim();
  if (!value) return undefined;
  return parseHttpsUrl(name, value);
}
```

Add fields in `loadConfig()` return:

```ts
    theftReportDepositAddress: parseTronAddress(
      "THEFT_REPORT_DEPOSIT_ADDRESS",
      process.env.THEFT_REPORT_DEPOSIT_ADDRESS ?? "T999999999999999999999999999999999"
    ),
    theftReportDepositAmountUsdt: "1000",
    theftReportGuideUrl: parseOptionalHttpsUrl("THEFT_REPORT_GUIDE_URL", process.env.THEFT_REPORT_GUIDE_URL),
    theftReportAdminContact: process.env.THEFT_REPORT_ADMIN_CONTACT?.trim() || undefined,
```

- [ ] **Step 4: Update `.env.example`**

Append:

```dotenv
THEFT_REPORT_DEPOSIT_ADDRESS=T999999999999999999999999999999999
THEFT_REPORT_GUIDE_URL=
THEFT_REPORT_ADMIN_CONTACT=
```

- [ ] **Step 5: Run config tests**

Run:

```powershell
npm test -- tests/config/config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/config.ts .env.example tests/config/config.test.ts
git commit -m "feat: configure theft report deposit"
```

## Task 5: Bot Keyboards And Messages

**Files:**
- Modify: `src/bot/i18n.ts`
- Modify: `src/bot/keyboards.ts`
- Modify: `src/bot/messages.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Write menu and message expectation tests**

Update the `/start` button rows test in `tests/bot/createBot.test.ts`:

```ts
expect(buttonRows(lastMessagePayload(calls))).toEqual([
  ["📁 Wallets", "➕ Add"],
  ["🔎 Address", "🧾 Tx"],
  ["🚨 Report theft"],
  ["🛡 Risk intel", "👤 Profile"],
  ["⚙️ Settings", "❔ Help"]
]);
```

Add Russian default assertion in the locale test:

```ts
expect(buttonTexts(lastMessagePayload(calls))).toContain("🚨 Сообщить о краже");
```

- [ ] **Step 2: Run failing bot tests**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts
```

Expected: FAIL because theft menu button does not exist.

- [ ] **Step 3: Add i18n keys**

Modify `src/bot/i18n.ts` dictionaries:

```ts
"button.reportTheft": "🚨 Сообщить о краже",
"button.confirm": "✅ Подтвердить",
"button.changeTx": "🧾 Изменить tx",
"button.addComment": "💬 Добавить комментарий",
"button.sent": "📤 Отправлено",
"button.guide": "📘 Инструкция",
"button.contactAdmin": "👤 Связаться с админом",
```

English:

```ts
"button.reportTheft": "🚨 Report theft",
"button.confirm": "✅ Confirm",
"button.changeTx": "🧾 Change tx",
"button.addComment": "💬 Add comment",
"button.sent": "📤 Sent",
"button.guide": "📘 Guide",
"button.contactAdmin": "👤 Contact admin",
```

Add these keys to the `I18nKey` dictionary by placing them in both locale objects.

- [ ] **Step 4: Add keyboard callbacks and builders**

Modify `src/bot/keyboards.ts` `BotCallback`:

```ts
  | { kind: "theft_start" }
  | { kind: "theft_confirm"; reportId: string }
  | { kind: "theft_change_tx"; reportId: string }
  | { kind: "theft_comment"; reportId: string }
  | { kind: "theft_cancel"; reportId: string }
  | { kind: "theft_deposit_sent"; reportId: string }
  | { kind: "theft_guide"; reportId: string }
  | { kind: "theft_admin"; reportId: string }
```

Add parse branches before wallet callback parsing:

```ts
if (data === "theft:start") return { kind: "theft_start" };
const theftMatch = /^theft:(confirm|change_tx|comment|cancel|deposit_sent|guide|admin):([^:]+)$/.exec(data);
if (theftMatch) {
  const reportId = theftMatch[2];
  switch (theftMatch[1]) {
    case "confirm":
      return { kind: "theft_confirm", reportId };
    case "change_tx":
      return { kind: "theft_change_tx", reportId };
    case "comment":
      return { kind: "theft_comment", reportId };
    case "cancel":
      return { kind: "theft_cancel", reportId };
    case "deposit_sent":
      return { kind: "theft_deposit_sent", reportId };
    case "guide":
      return { kind: "theft_guide", reportId };
    case "admin":
      return { kind: "theft_admin", reportId };
  }
}
```

Update `mainMenuKeyboard`:

```ts
    .text(t(locale, "button.address"), "check:addr")
    .text(t(locale, "button.tx"), "check:tx")
    .row()
    .text(t(locale, "button.reportTheft"), "theft:start")
```

Add keyboard builders:

```ts
export function theftReportCardKeyboard(reportId: string, locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(locale, "button.confirm"), `theft:confirm:${reportId}`)
    .row()
    .text(t(locale, "button.changeTx"), `theft:change_tx:${reportId}`)
    .text(t(locale, "button.addComment"), `theft:comment:${reportId}`)
    .row()
    .text(t(locale, "button.cancel"), `theft:cancel:${reportId}`);
}

export function theftReportDepositKeyboard(reportId: string, locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(locale, "button.sent"), `theft:deposit_sent:${reportId}`)
    .text(t(locale, "button.cancel"), `theft:cancel:${reportId}`);
}

export function theftReportNextStepsKeyboard(reportId: string, locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(locale, "button.guide"), `theft:guide:${reportId}`)
    .text(t(locale, "button.contactAdmin"), `theft:admin:${reportId}`)
    .row()
    .text(t(locale, "button.menu"), "home");
}
```

- [ ] **Step 5: Add message builders**

Modify `src/bot/messages.ts` imports:

```ts
import type { CustomerAlertMode, CustomerAlertRecipient, ObservedApprovalDrainEvent, TheftReport, WalletApproval } from "../storage/repositories";
```

Add message builders:

```ts
export function theftReportTxPrompt(locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  return msg([
    bold(locale === "en" ? "🚨 Report theft" : "🚨 Сообщить о краже"),
    locale === "en"
      ? "Send the TRON transaction hash for the USDT transfer that left your wallet."
      : "Отправьте TRON transaction hash перевода USDT, который ушел с вашего кошелька.",
    `${bold(locale === "en" ? "Format" : "Формат")}: ${code("64 hex chars")}`
  ]);
}

export function theftReportInvalidTxMessage(locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  return msg([
    bold(locale === "en" ? "Transaction hash needed" : "Нужен transaction hash"),
    locale === "en" ? "Send a valid TRON transaction hash." : "Отправьте корректный TRON transaction hash."
  ]);
}

export function theftReportTxParseFailedMessage(locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  return msg([
    bold(locale === "en" ? "Could not read USDT transfer" : "Не удалось прочитать USDT перевод"),
    locale === "en"
      ? "The bot did not find an official TRON USDT transfer in this transaction. Send another tx hash."
      : "Бот не нашел официальный TRON USDT перевод в этой транзакции. Отправьте другой tx hash."
  ]);
}

export function theftReportCardMessage(report: TheftReport, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  return msg([
    bold(locale === "en" ? "🚨 Report theft" : "🚨 Сообщить о краже"),
    [
      kv(locale === "en" ? "From wallet" : "С этого кошелька", code(report.victimAddress)),
      kv(locale === "en" ? "Amount sent" : "Ушла сумма", `${code(report.amountUsdt)} USDT`),
      kv(locale === "en" ? "To wallet" : "На кошелек", code(report.reportedScamAddress)),
      kv("Tx", code(report.txHash)),
      kv(locale === "en" ? "Comment" : "Комментарий", report.comment ? escapeHtml(report.comment) : (locale === "en" ? "not set" : "не указан"))
    ].join("\n")
  ]);
}

export function theftReportDepositMessage(report: TheftReport, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  return msg([
    bold(locale === "en" ? "Deposit required" : "Нужен депозит"),
    locale === "en"
      ? `Send ${report.depositAmountUsdt} USDT to the wallet below so the report is accepted as a paid preliminary signal.`
      : `Отправьте ${report.depositAmountUsdt} USDT на кошелек ниже, чтобы заявка была принята как платный предварительный сигнал.`,
    kv(locale === "en" ? "Deposit wallet" : "Кошелек для депозита", code(report.depositAddress)),
    kv(locale === "en" ? "Amount" : "Сумма", `${code(report.depositAmountUsdt)} USDT`)
  ]);
}

export function theftReportNextStepsMessage(report: TheftReport, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  return msg([
    bold(locale === "en" ? "Report accepted" : "Заявка принята"),
    locale === "en"
      ? "The paid preliminary signal is active. The receiving wallet was marked as reported_scam."
      : "Платный предварительный сигнал активен. Кошелек получателя помечен как reported_scam.",
    section(locale === "en" ? "Next step" : "Следующий шаг", [
      locale === "en"
        ? "Prepare a formal statement and provide the documents in the bot or to an admin."
        : "Подготовьте заявление и передайте документы в боте или админу.",
      locale === "en"
        ? "After documents arrive, we can help with tracing and freezing attempts. Service fee: 20% of the deposit."
        : "После поступления документов мы сможем помочь с трассировкой и попыткой заморозки. Стоимость: 20% от депозита."
    ]),
    kv(locale === "en" ? "Report ID" : "ID заявки", code(report.id))
  ]);
}

export function theftReportGuideFallbackMessage(locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  return msg([
    bold(locale === "en" ? "Statement guide" : "Инструкция по заявлению"),
    bulletList(locale === "en"
      ? [
          "Record the transaction hash and both wallet addresses.",
          "Describe how the theft happened and when you noticed it.",
          "Prepare proof that the source wallet belongs to you.",
          "Send the statement and supporting documents to an admin."
        ]
      : [
          "Зафиксируйте tx hash и оба адреса кошельков.",
          "Опишите, как произошла кража и когда вы ее заметили.",
          "Подготовьте подтверждение, что исходный кошелек принадлежит вам.",
          "Передайте заявление и документы админу."
        ])
  ]);
}

export function theftReportAdminContactMessage(report: TheftReport, contact: string | undefined, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  return msg([
    bold(locale === "en" ? "Contact admin" : "Связаться с админом"),
    contact
      ? (locale === "en" ? `Admin contact: ${escapeHtml(contact)}` : `Контакт админа: ${escapeHtml(contact)}`)
      : (locale === "en" ? "Send this report id to support/admin." : "Передайте этот ID заявки поддержке или админу."),
    kv(locale === "en" ? "Report ID" : "ID заявки", code(report.id))
  ]);
}
```

- [ ] **Step 6: Run bot tests**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts
```

Expected: existing tests PASS after updating expected button rows.

- [ ] **Step 7: Commit**

```powershell
git add src/bot/i18n.ts src/bot/keyboards.ts src/bot/messages.ts tests/bot/createBot.test.ts
git commit -m "feat: add theft report bot copy"
```

## Task 6: Bot Flow Wiring

**Files:**
- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Extend fake DB and Tron client in bot tests**

In `tests/bot/createBot.test.ts`, extend `createFakeDb`:

```ts
type FakeTheftReport = {
  id: string;
  telegramUserId: string;
  txHash: string;
  victimAddress: string;
  reportedScamAddress: string;
  amountRaw: string;
  amountUsdt: string;
  comment: string | null;
  status: "draft" | "awaiting_deposit" | "deposit_confirmed" | "documents_requested" | "cancelled";
  depositAddress: string;
  depositAmountUsdt: string;
  createdAt: Date;
  updatedAt: Date;
};
```

Add storage:

```ts
const theftReports: FakeTheftReport[] = [];
```

Update fake session row to include `selected_theft_report_id`, and update insert/update session handling to read `params[3]` when the SQL contains `selected_theft_report_id`.

Add fake query branches before the final unexpected-query throw:

```ts
if (sql.includes("insert into theft_reports")) {
  const id = String(params[0]);
  const existing = theftReports.find((report) => report.id === id);
  const row: FakeTheftReport = {
    id,
    telegramUserId: String(params[1]),
    txHash: String(params[2]),
    victimAddress: String(params[3]),
    reportedScamAddress: String(params[4]),
    amountRaw: String(params[5]),
    amountUsdt: String(params[6]),
    comment: existing?.comment ?? null,
    status: "draft",
    depositAddress: String(params[7]),
    depositAmountUsdt: String(params[8]),
    createdAt: existing?.createdAt ?? new Date("2026-05-27T00:00:00.000Z"),
    updatedAt: new Date("2026-05-27T00:01:00.000Z")
  };
  if (existing) Object.assign(existing, row);
  else theftReports.push(row);
  return { rows: [theftReportRow(existing ?? row)], rowCount: 1 };
}

if (sql.includes("from theft_reports") && sql.includes("where id = $1")) {
  const report = theftReports.find((item) => item.id === String(params[0]));
  return { rows: report ? [theftReportRow(report)] : [], rowCount: report ? 1 : 0 };
}

if (sql.includes("update theft_reports") && sql.includes("comment = $3")) {
  const report = theftReports.find((item) => item.id === String(params[0]) && item.telegramUserId === String(params[1]));
  if (!report) return { rows: [], rowCount: 0 };
  report.comment = String(params[2]);
  report.updatedAt = new Date("2026-05-27T00:02:00.000Z");
  return { rows: [theftReportRow(report)], rowCount: 1 };
}

if (sql.includes("update theft_reports") && sql.includes("status = 'awaiting_deposit'")) {
  const report = theftReports.find((item) => item.id === String(params[0]) && item.telegramUserId === String(params[1]));
  if (!report) return { rows: [], rowCount: 0 };
  report.status = "awaiting_deposit";
  return { rows: [theftReportRow(report)], rowCount: 1 };
}

if (sql.includes("update theft_reports") && sql.includes("status = 'documents_requested'")) {
  const report = theftReports.find((item) => item.id === String(params[0]) && item.telegramUserId === String(params[1]));
  if (!report) return { rows: [], rowCount: 0 };
  report.status = "documents_requested";
  return { rows: [theftReportRow(report)], rowCount: 1 };
}

if (sql.includes("update theft_reports") && sql.includes("status = 'cancelled'")) {
  const report = theftReports.find((item) => item.id === String(params[0]) && item.telegramUserId === String(params[1]));
  if (!report) return { rows: [], rowCount: 0 };
  report.status = "cancelled";
  return { rows: [theftReportRow(report)], rowCount: 1 };
}
```

Add helper near fake DB helpers:

```ts
function theftReportRow(report: FakeTheftReport) {
  return {
    id: report.id,
    telegram_user_id: report.telegramUserId,
    tx_hash: report.txHash,
    victim_address: report.victimAddress,
    reported_scam_address: report.reportedScamAddress,
    amount_raw: report.amountRaw,
    amount_usdt: report.amountUsdt,
    comment: report.comment,
    status: report.status,
    deposit_address: report.depositAddress,
    deposit_amount_usdt: report.depositAmountUsdt,
    created_at: report.createdAt,
    updated_at: report.updatedAt
  };
}
```

Update `createTronClient().getTransaction()`:

```ts
async getTransaction() {
  return {
    trc20TransferInfo: [
      {
        from_address: walletAddress,
        to_address: secondWalletAddress,
        quant: "12500000",
        contract_address: TRON_USDT_CONTRACT_ADDRESS
      }
    ]
  };
},
```

Existing transaction-check test should then expect `Subject: ${walletAddress}` instead of `secondWalletAddress`.

- [ ] **Step 2: Write end-to-end bot flow tests**

Add tests to `tests/bot/createBot.test.ts`:

```ts
it("creates a theft report draft from a transaction hash and comment", async () => {
  const { bot, calls } = await createSmokeBot({ defaultLocale: "ru" });

  await bot.handleUpdate(callbackQueryUpdate("theft:start", userId));
  expect(lastPlainText(calls)).toContain("Отправьте TRON transaction hash");
  expect(buttonTexts(lastMessagePayload(calls))).toContain("🚫 Отмена");

  await bot.handleUpdate(messageUpdate(txHash, userId));
  expect(lastPlainText(calls)).toContain("Сообщить о краже");
  expect(lastPlainText(calls)).toContain(walletAddress);
  expect(lastPlainText(calls)).toContain(secondWalletAddress);
  expect(lastPlainText(calls)).toContain("12.5 USDT");
  expect(lastPlainText(calls)).toContain("Комментарий: не указан");

  const commentCallback = findCallbackData(lastMessagePayload(calls), "theft:comment:");
  await bot.handleUpdate(callbackQueryUpdate(commentCallback, userId));
  await bot.handleUpdate(messageUpdate("Украли после фишинговой ссылки", userId));

  expect(lastPlainText(calls)).toContain("Украли после фишинговой ссылки");
});

it("confirms theft report deposit and marks victim plus reported_scam", async () => {
  const { bot, calls } = await createSmokeBot({ defaultLocale: "ru" });

  await bot.handleUpdate(callbackQueryUpdate("theft:start", userId));
  await bot.handleUpdate(messageUpdate(txHash, userId));

  const confirmCallback = findCallbackData(lastMessagePayload(calls), "theft:confirm:");
  await bot.handleUpdate(callbackQueryUpdate(confirmCallback, userId));

  expect(lastPlainText(calls)).toContain("Нужен депозит");
  expect(lastPlainText(calls)).toContain("1000 USDT");
  expect(buttonTexts(lastMessagePayload(calls))).toContain("📤 Отправлено");

  const sentCallback = findCallbackData(lastMessagePayload(calls), "theft:deposit_sent:");
  await bot.handleUpdate(callbackQueryUpdate(sentCallback, userId));

  expect(lastPlainText(calls)).toContain("Заявка принята");
  expect(lastPlainText(calls)).toContain("reported_scam");
  expect(buttonTexts(lastMessagePayload(calls))).toContain("📘 Инструкция");
  expect(buttonTexts(lastMessagePayload(calls))).toContain("👤 Связаться с админом");

  await bot.handleUpdate(messageUpdate(`/check ${secondWalletAddress}`, userId));
  expect(lastPlainText(calls)).toContain("90/100 (критический / CRITICAL, beta)");
  expect(lastPlainText(calls)).toContain("Paid preliminary theft report");

  await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));
  expect(lastPlainText(calls)).toContain("0/100");
});

it("keeps theft report pending on invalid transaction input and cancels cleanly", async () => {
  const { bot, calls } = await createSmokeBot({ defaultLocale: "ru" });

  await bot.handleUpdate(callbackQueryUpdate("theft:start", userId));
  await bot.handleUpdate(messageUpdate("not-a-tx", userId));

  expect(lastPlainText(calls)).toContain("Нужен transaction hash");
  expect(buttonTexts(lastMessagePayload(calls))).toContain("🚫 Отмена");

  await bot.handleUpdate(callbackQueryUpdate("cancel", userId));
  expect(lastPlainText(calls)).toContain("Мониторинг TRON / USDT кошельков");
});
```

- [ ] **Step 3: Run failing bot flow tests**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts
```

Expected: FAIL because bot callbacks and pending actions are not wired.

- [ ] **Step 4: Wire imports in `createBot.ts`**

Add imports:

```ts
import { loadTheftReportTransfer } from "../check/theftReportTransaction";
import {
  cancelTheftReport,
  confirmTheftReportDeposit,
  getTheftReport,
  markTheftReportAwaitingDeposit,
  updateTheftReportComment,
  upsertTheftReportDraft
} from "../storage/repositories";
```

Add message imports:

```ts
  theftReportAdminContactMessage,
  theftReportCardMessage,
  theftReportDepositMessage,
  theftReportGuideFallbackMessage,
  theftReportInvalidTxMessage,
  theftReportNextStepsMessage,
  theftReportTxParseFailedMessage,
  theftReportTxPrompt,
```

Add keyboard imports:

```ts
  theftReportCardKeyboard,
  theftReportDepositKeyboard,
  theftReportNextStepsKeyboard,
```

- [ ] **Step 5: Add helper functions in `createBot.ts`**

Place near other bot helper functions:

```ts
async function getOwnedTheftReport(db: Db, telegramUserId: string, reportId: string) {
  const report = await getTheftReport(db, reportId);
  return report && report.telegramUserId === telegramUserId ? report : null;
}

async function showTheftReportMissing(ctx: Context, db: Db, telegramUserId: string, locale: BotLocale): Promise<void> {
  await clearTelegramUserPendingAction(db, telegramUserId);
  await replyOrEdit(ctx, locale === "en" ? "Theft report not found or expired." : "Заявка не найдена или устарела.", mainMenuKeyboard(locale));
}

async function createOrUpdateTheftReportFromTx(
  ctx: Context,
  config: AppConfig,
  db: Db,
  tronClient: TronClient,
  telegramUserId: string,
  txHash: string,
  reportId: string | null,
  locale: BotLocale
): Promise<void> {
  let transfer;
  try {
    transfer = await loadTheftReportTransfer(txHash, tronClient);
  } catch {
    await sendMessage(ctx, theftReportTxParseFailedMessage(locale), cancelKeyboard(locale));
    return;
  }

  const report = await upsertTheftReportDraft(db, {
    id: reportId ?? undefined,
    telegramUserId,
    txHash: transfer.txHash,
    victimAddress: transfer.sender,
    reportedScamAddress: transfer.receiver,
    amountRaw: transfer.amountRaw,
    amountUsdt: transfer.amountUsdt,
    depositAddress: config.theftReportDepositAddress,
    depositAmountUsdt: config.theftReportDepositAmountUsdt
  });
  await clearTelegramUserPendingAction(db, telegramUserId);
  await sendMessage(ctx, theftReportCardMessage(report, locale), theftReportCardKeyboard(report.id, locale));
}
```

- [ ] **Step 6: Wire callback handlers**

Add before wallet-specific callback resolution:

```ts
    if (callback.kind === "theft_start") {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "report_theft_tx" });
      await replyOrEdit(ctx, theftReportTxPrompt(locale), cancelKeyboard(locale));
      return;
    }

    if (callback.kind === "theft_confirm") {
      const report = await markTheftReportAwaitingDeposit(db, { id: callback.reportId, telegramUserId: id });
      if (!report) {
        await showTheftReportMissing(ctx, db, id, locale);
        return;
      }
      await clearTelegramUserPendingAction(db, id);
      await replyOrEdit(ctx, theftReportDepositMessage(report, locale), theftReportDepositKeyboard(report.id, locale));
      return;
    }

    if (callback.kind === "theft_change_tx") {
      const report = await getOwnedTheftReport(db, id, callback.reportId);
      if (!report) {
        await showTheftReportMissing(ctx, db, id, locale);
        return;
      }
      await setTelegramUserPendingAction(db, {
        telegramUserId: id,
        pendingAction: "report_theft_tx",
        selectedTheftReportId: report.id
      });
      await replyOrEdit(ctx, theftReportTxPrompt(locale), cancelKeyboard(locale));
      return;
    }

    if (callback.kind === "theft_comment") {
      const report = await getOwnedTheftReport(db, id, callback.reportId);
      if (!report) {
        await showTheftReportMissing(ctx, db, id, locale);
        return;
      }
      await setTelegramUserPendingAction(db, {
        telegramUserId: id,
        pendingAction: "report_theft_comment",
        selectedTheftReportId: report.id
      });
      await replyOrEdit(ctx, locale === "en" ? "Send a comment for this report." : "Отправьте комментарий к заявке.", cancelKeyboard(locale));
      return;
    }

    if (callback.kind === "theft_cancel") {
      await cancelTheftReport(db, { id: callback.reportId, telegramUserId: id });
      await clearTelegramUserPendingAction(db, id);
      const wallets = await listWatchedWallets(db, id);
      await replyOrEdit(ctx, homeMessage(wallets.length, locale), mainMenuKeyboard(locale));
      return;
    }

    if (callback.kind === "theft_deposit_sent") {
      const report = await confirmTheftReportDeposit(db, { id: callback.reportId, telegramUserId: id });
      if (!report) {
        await showTheftReportMissing(ctx, db, id, locale);
        return;
      }
      await saveAddressLabel(db, {
        address: report.victimAddress,
        label: "victim",
        source: "system",
        createdByTelegramId: id
      });
      await saveAddressLabel(db, {
        address: report.reportedScamAddress,
        label: "reported_scam",
        source: "system",
        createdByTelegramId: id
      });
      await clearTelegramUserPendingAction(db, id);
      await replyOrEdit(ctx, theftReportNextStepsMessage(report, locale), theftReportNextStepsKeyboard(report.id, locale));
      return;
    }

    if (callback.kind === "theft_guide") {
      const report = await getOwnedTheftReport(db, id, callback.reportId);
      if (!report) {
        await showTheftReportMissing(ctx, db, id, locale);
        return;
      }
      if (config.theftReportGuideUrl) {
        await replyOrEdit(ctx, `${locale === "en" ? "Guide" : "Инструкция"}: ${config.theftReportGuideUrl.toString()}`, theftReportNextStepsKeyboard(report.id, locale));
      } else {
        await replyOrEdit(ctx, theftReportGuideFallbackMessage(locale), theftReportNextStepsKeyboard(report.id, locale));
      }
      return;
    }

    if (callback.kind === "theft_admin") {
      const report = await getOwnedTheftReport(db, id, callback.reportId);
      if (!report) {
        await showTheftReportMissing(ctx, db, id, locale);
        return;
      }
      await replyOrEdit(ctx, theftReportAdminContactMessage(report, config.theftReportAdminContact, locale), theftReportNextStepsKeyboard(report.id, locale));
      return;
    }
```

- [ ] **Step 7: Wire pending text handlers**

In the `shouldHandlePendingText` block, before alert-admin handling:

```ts
      if (session.pendingAction === "report_theft_tx") {
        if (input.kind !== "tron_tx") {
          await sendMessage(ctx, theftReportInvalidTxMessage(locale), cancelKeyboard(locale));
          return;
        }
        await createOrUpdateTheftReportFromTx(
          ctx,
          config,
          db,
          tronClient,
          id,
          input.value,
          session.selectedTheftReportId,
          locale
        );
        return;
      }

      if (session.pendingAction === "report_theft_comment") {
        if (!session.selectedTheftReportId) {
          await clearTelegramUserPendingAction(db, id);
          await ctx.reply(locale === "en" ? "Theft report not found or expired." : "Заявка не найдена или устарела.", { reply_markup: mainMenuKeyboard(locale) });
          return;
        }
        const report = await updateTheftReportComment(db, {
          id: session.selectedTheftReportId,
          telegramUserId: id,
          comment: text
        });
        if (!report) {
          await clearTelegramUserPendingAction(db, id);
          await ctx.reply(locale === "en" ? "Theft report not found or expired." : "Заявка не найдена или устарела.", { reply_markup: mainMenuKeyboard(locale) });
          return;
        }
        await clearTelegramUserPendingAction(db, id);
        await sendMessage(ctx, theftReportCardMessage(report, locale), theftReportCardKeyboard(report.id, locale));
        return;
      }
```

- [ ] **Step 8: Run bot flow tests**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: wire theft report bot flow"
```

## Task 7: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 3: Inspect final diff**

Run:

```powershell
git status --short
git diff --stat HEAD
```

Expected: only intended theft-report files are modified or all implementation commits are clean. Existing unrelated dirty files from before this work may still appear; do not revert them.

- [ ] **Step 4: Commit any verification fixes**

If typecheck or tests required fixes, commit only files touched for this feature:

```powershell
git add migrations/019_theft_report_flow.sql src/check/theftReportTransaction.ts src/config.ts src/types.ts src/storage/repositories.ts src/risk/riskEngine.ts src/risk/evaluation.ts src/bot/i18n.ts src/bot/keyboards.ts src/bot/messages.ts src/bot/createBot.ts tests/check/theftReportTransaction.test.ts tests/config/config.test.ts tests/risk/riskEngine.test.ts tests/risk/evaluation.test.ts tests/storage/repositories.test.ts tests/bot/createBot.test.ts .env.example
git commit -m "fix: complete theft report verification"
```

## Self-Review

- Spec coverage: main menu, tx entry, cancel, report card, comments, tx change, 1000 USDT deposit stub, `Отправлено`, `victim`, `reported_scam`, instruction/admin buttons, critical risk scoring, neutral victim scoring, and tests are covered.
- Placeholder scan: the plan contains concrete file paths, function names, SQL, commands, callback data, messages, and test expectations. No open requirement is delegated to an unnamed future step.
- Type consistency: `reported_scam`, `victim`, `report_theft_tx`, `report_theft_comment`, `selectedTheftReportId`, and `TheftReport` names are consistent across storage, bot, messages, keyboards, tests, and risk policy.
