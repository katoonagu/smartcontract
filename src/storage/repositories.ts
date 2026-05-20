import type { AddressLabel, RiskLabel, TronTransferEvent, WatchedWallet } from "../types";
import type { Db } from "./db";

export type UserAlertStatus = "pending" | "sending" | "sent" | "failed";

export type WalletPollState = {
  watchedWalletId: string;
  lastSeenBlockTs: Date | null;
  lastSeenTxHash: string | null;
  backfillAnchorBlockTs: Date | null;
  backfillAnchorTxHash: string | null;
  backfillNextStart: number;
  backfillComplete: boolean;
  lastSuccessfulPollAt: Date | null;
  updatedAt: Date;
};

export type ObservedTransactionUserAlert = {
  txHash: string;
  watchedWalletId: string;
  sender: string;
  receiver: string;
  token: "USDT";
  amount: string;
  timestamp: Date;
  userAlertStatus: UserAlertStatus;
  userAlertAttempts: number;
  userAlertLastError: string | null;
  userAlertUpdatedAt: Date | null;
  createdAt: Date;
};

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
  "risky_contract"
]);

const userAlertStatuses = new Set<UserAlertStatus>(["pending", "sending", "sent", "failed"]);
const maxUserAlertErrorLength = 1024;

function parseRiskLabel(value: string): RiskLabel {
  if (!riskLabels.has(value as RiskLabel)) {
    throw new Error(`Invalid risk label from database: ${value}`);
  }
  return value as RiskLabel;
}

function parseLabelSource(value: string): "service_admin" | "system" {
  if (value !== "service_admin" && value !== "system") {
    throw new Error(`Invalid label source from database: ${value}`);
  }
  return value;
}

function parseUserAlertStatus(value: string): UserAlertStatus {
  if (!userAlertStatuses.has(value as UserAlertStatus)) {
    throw new Error(`Invalid user alert status from database: ${value}`);
  }
  return value as UserAlertStatus;
}

function mapWalletPollStateRow(row: Record<string, any>): WalletPollState {
  return {
    watchedWalletId: row.watched_wallet_id,
    lastSeenBlockTs: row.last_seen_block_ts,
    lastSeenTxHash: row.last_seen_tx_hash,
    backfillAnchorBlockTs: row.backfill_anchor_block_ts,
    backfillAnchorTxHash: row.backfill_anchor_tx_hash,
    backfillNextStart: row.backfill_next_start,
    backfillComplete: row.backfill_complete,
    lastSuccessfulPollAt: row.last_successful_poll_at,
    updatedAt: row.updated_at
  };
}

function mapObservedTransactionUserAlertRow(row: Record<string, any>): ObservedTransactionUserAlert {
  return {
    txHash: row.tx_hash,
    watchedWalletId: row.watched_wallet_id,
    sender: row.sender,
    receiver: row.receiver,
    token: row.token,
    amount: row.amount,
    timestamp: row.timestamp,
    userAlertStatus: parseUserAlertStatus(row.user_alert_status),
    userAlertAttempts: row.user_alert_attempts,
    userAlertLastError: row.user_alert_last_error,
    userAlertUpdatedAt: row.user_alert_updated_at,
    createdAt: row.created_at
  };
}

function boundedUserAlertError(error: string): string {
  return error.slice(0, maxUserAlertErrorLength);
}

function createId(): string {
  return crypto.randomUUID();
}

export async function upsertTelegramUser(db: Db, input: { telegramUserId: string; username: string | null }): Promise<void> {
  await db.query(
    `insert into telegram_users (telegram_user_id, username)
     values ($1, $2)
     on conflict (telegram_user_id) do update set username = excluded.username`,
    [input.telegramUserId, input.username]
  );
}

export async function addWatchedWallet(db: Db, input: { telegramUserId: string; address: string }): Promise<WatchedWallet> {
  const result = await db.query(
    `insert into watched_wallets (id, telegram_user_id, address)
     values ($1, $2, $3)
     on conflict (telegram_user_id, address) do update set address = excluded.address
     returning id, telegram_user_id, address, created_at`,
    [createId(), input.telegramUserId, input.address]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    telegramUsername: null,
    address: row.address,
    createdAt: row.created_at
  };
}

export async function listWatchedWallets(db: Db, telegramUserId?: string): Promise<WatchedWallet[]> {
  const query = telegramUserId
    ? `select w.id, w.telegram_user_id, u.username, w.address, w.created_at
       from watched_wallets w join telegram_users u on u.telegram_user_id = w.telegram_user_id
       where w.telegram_user_id = $1 order by w.created_at asc`
    : `select w.id, w.telegram_user_id, u.username, w.address, w.created_at
       from watched_wallets w join telegram_users u on u.telegram_user_id = w.telegram_user_id
       order by w.created_at asc`;
  const result = await db.query(query, telegramUserId ? [telegramUserId] : []);
  return result.rows.map((row) => ({
    id: row.id,
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.username,
    address: row.address,
    createdAt: row.created_at
  }));
}

export async function removeWatchedWallet(db: Db, input: { telegramUserId: string; address: string }): Promise<boolean> {
  const result = await db.query(
    `delete from watched_wallets where telegram_user_id = $1 and address = $2`,
    [input.telegramUserId, input.address]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function hasObservedTransaction(db: Db, txHash: string, watchedWalletId?: string): Promise<boolean> {
  const result = watchedWalletId
    ? await db.query(`select 1 from observed_transactions where tx_hash = $1 and watched_wallet_id = $2`, [txHash, watchedWalletId])
    : await db.query(`select 1 from observed_transactions where tx_hash = $1 limit 1`, [txHash]);
  return result.rowCount === 1;
}

export async function getWalletPollState(db: Db, watchedWalletId: string): Promise<WalletPollState | null> {
  const result = await db.query(
    `select watched_wallet_id, last_seen_block_ts, last_seen_tx_hash,
       backfill_anchor_block_ts, backfill_anchor_tx_hash, backfill_next_start,
       backfill_complete, last_successful_poll_at, updated_at
     from wallet_poll_state
     where watched_wallet_id = $1`,
    [watchedWalletId]
  );
  return result.rows[0] ? mapWalletPollStateRow(result.rows[0]) : null;
}

export async function upsertWalletPollState(
  db: Db,
  input: {
    watchedWalletId: string;
    lastSeenBlockTs?: Date | null;
    lastSeenTxHash?: string | null;
    backfillAnchorBlockTs?: Date | null;
    backfillAnchorTxHash?: string | null;
    backfillNextStart?: number;
    backfillComplete?: boolean;
    lastSuccessfulPollAt?: Date | null;
  }
): Promise<void> {
  await db.query(
    `insert into wallet_poll_state (
       watched_wallet_id,
       last_seen_block_ts,
       last_seen_tx_hash,
       backfill_anchor_block_ts,
       backfill_anchor_tx_hash,
       backfill_next_start,
       backfill_complete,
       last_successful_poll_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (watched_wallet_id) do update set
       last_seen_block_ts = excluded.last_seen_block_ts,
       last_seen_tx_hash = excluded.last_seen_tx_hash,
       backfill_anchor_block_ts = excluded.backfill_anchor_block_ts,
       backfill_anchor_tx_hash = excluded.backfill_anchor_tx_hash,
       backfill_next_start = excluded.backfill_next_start,
       backfill_complete = excluded.backfill_complete,
       last_successful_poll_at = excluded.last_successful_poll_at,
       updated_at = now()`,
    [
      input.watchedWalletId,
      input.lastSeenBlockTs ?? null,
      input.lastSeenTxHash ?? null,
      input.backfillAnchorBlockTs ?? null,
      input.backfillAnchorTxHash ?? null,
      input.backfillNextStart ?? 0,
      input.backfillComplete ?? false,
      input.lastSuccessfulPollAt ?? null
    ]
  );
}

export async function updateWalletPollState(
  db: Db,
  input: {
    watchedWalletId: string;
    lastSeenBlockTs?: Date | null;
    lastSeenTxHash?: string | null;
    backfillAnchorBlockTs?: Date | null;
    backfillAnchorTxHash?: string | null;
    backfillNextStart?: number;
    backfillComplete?: boolean;
    lastSuccessfulPollAt?: Date | null;
  }
): Promise<boolean> {
  const assignments: string[] = [];
  const params: unknown[] = [input.watchedWalletId];

  if ("lastSeenBlockTs" in input) {
    params.push(input.lastSeenBlockTs ?? null);
    assignments.push(`last_seen_block_ts = $${params.length}`);
  }
  if ("lastSeenTxHash" in input) {
    params.push(input.lastSeenTxHash ?? null);
    assignments.push(`last_seen_tx_hash = $${params.length}`);
  }
  if ("backfillAnchorBlockTs" in input) {
    params.push(input.backfillAnchorBlockTs ?? null);
    assignments.push(`backfill_anchor_block_ts = $${params.length}`);
  }
  if ("backfillAnchorTxHash" in input) {
    params.push(input.backfillAnchorTxHash ?? null);
    assignments.push(`backfill_anchor_tx_hash = $${params.length}`);
  }
  if ("backfillNextStart" in input) {
    params.push(input.backfillNextStart ?? 0);
    assignments.push(`backfill_next_start = $${params.length}`);
  }
  if ("backfillComplete" in input) {
    params.push(input.backfillComplete);
    assignments.push(`backfill_complete = $${params.length}`);
  }
  if ("lastSuccessfulPollAt" in input) {
    params.push(input.lastSuccessfulPollAt ?? null);
    assignments.push(`last_successful_poll_at = $${params.length}`);
  }

  const setClause = [...assignments, "updated_at = now()"].join(", ");
  const result = await db.query(`update wallet_poll_state set ${setClause} where watched_wallet_id = $1`, params);
  return (result.rowCount ?? 0) > 0;
}

export async function saveObservedTransaction(db: Db, input: { watchedWalletId: string; event: TronTransferEvent }): Promise<void> {
  await db.query(
    `insert into observed_transactions (tx_hash, watched_wallet_id, sender, receiver, token, amount, timestamp)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (tx_hash, watched_wallet_id) do nothing`,
    [input.event.txHash, input.watchedWalletId, input.event.sender, input.event.receiver, input.event.token, input.event.amount, input.event.timestamp]
  );
}

export async function claimObservedTransactionForUserAlert(
  db: Db,
  input: { watchedWalletId: string; event: TronTransferEvent }
): Promise<boolean> {
  const result = await db.query(
    `insert into observed_transactions (
       tx_hash,
       watched_wallet_id,
       sender,
       receiver,
       token,
       amount,
       timestamp,
       user_alert_status,
       user_alert_attempts,
       user_alert_updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, 'sending', 0, now())
     on conflict (tx_hash, watched_wallet_id) do nothing`,
    [input.event.txHash, input.watchedWalletId, input.event.sender, input.event.receiver, input.event.token, input.event.amount, input.event.timestamp]
  );
  return (result.rowCount ?? 0) === 1;
}

export async function claimUserAlertsForRetry(
  db: Db,
  input: { limit: number; staleSendingBefore: Date }
): Promise<ObservedTransactionUserAlert[]> {
  const result = await db.query(
    `with claimed as (
       select tx_hash, watched_wallet_id
       from observed_transactions
       where user_alert_status in ('pending', 'failed')
          or (user_alert_status = 'sending' and user_alert_updated_at < $2)
       order by coalesce(user_alert_updated_at, created_at) asc
       limit $1
       for update skip locked
     )
     update observed_transactions tx
     set user_alert_status = 'sending',
       user_alert_updated_at = now()
     from claimed
     where tx.tx_hash = claimed.tx_hash and tx.watched_wallet_id = claimed.watched_wallet_id
     returning tx.tx_hash, tx.watched_wallet_id, tx.sender, tx.receiver, tx.token, tx.amount, tx.timestamp,
       tx.user_alert_status, tx.user_alert_attempts, tx.user_alert_last_error, tx.user_alert_updated_at, tx.created_at`,
    [input.limit, input.staleSendingBefore]
  );
  return result.rows.map(mapObservedTransactionUserAlertRow);
}

export async function markUserAlertSent(db: Db, input: { txHash: string; watchedWalletId: string }): Promise<boolean> {
  const result = await db.query(
    `update observed_transactions
     set user_alert_status = 'sent',
       user_alert_last_error = null,
       user_alert_updated_at = now()
     where tx_hash = $1 and watched_wallet_id = $2 and user_alert_status = 'sending'`,
    [input.txHash, input.watchedWalletId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markUserAlertFailed(
  db: Db,
  input: { txHash: string; watchedWalletId: string; error: string }
): Promise<boolean> {
  const result = await db.query(
    `update observed_transactions
     set user_alert_status = 'failed',
       user_alert_attempts = user_alert_attempts + 1,
       user_alert_last_error = $3,
       user_alert_updated_at = now()
     where tx_hash = $1 and watched_wallet_id = $2 and user_alert_status = 'sending'`,
    [input.txHash, input.watchedWalletId, boundedUserAlertError(input.error)]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function saveAddressLabel(
  db: Db,
  input: { address: string; label: RiskLabel; source: "service_admin" | "system"; createdByTelegramId: string | null }
): Promise<void> {
  await db.query(
    `insert into address_labels (address, label, source, created_by_telegram_id)
     values ($1, $2, $3, $4)
     on conflict (address, label) do update set source = excluded.source, created_by_telegram_id = excluded.created_by_telegram_id`,
    [input.address, input.label, input.source, input.createdByTelegramId]
  );
}

export async function listAddressLabels(db: Db, address: string): Promise<AddressLabel[]> {
  const result = await db.query(
    `select address, label, source, created_by_telegram_id, created_at
     from address_labels where address = $1 order by created_at asc`,
    [address]
  );
  return result.rows.map((row) => ({
    address: row.address,
    label: parseRiskLabel(row.label),
    source: parseLabelSource(row.source),
    createdByTelegramId: row.created_by_telegram_id,
    createdAt: row.created_at
  }));
}
