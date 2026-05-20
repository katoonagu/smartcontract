import type { AddressLabel, RiskLabel, TronTransferEvent, WatchedWallet } from "../types";
import type { Db } from "./db";

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
    `insert into watched_wallets (telegram_user_id, address)
     values ($1, $2)
     on conflict (telegram_user_id, address) do update set address = excluded.address
     returning id, telegram_user_id, address, created_at`,
    [input.telegramUserId, input.address]
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

export async function hasObservedTransaction(db: Db, txHash: string): Promise<boolean> {
  const result = await db.query(`select 1 from observed_transactions where tx_hash = $1`, [txHash]);
  return result.rowCount === 1;
}

export async function saveObservedTransaction(db: Db, input: { watchedWalletId: string; event: TronTransferEvent }): Promise<void> {
  await db.query(
    `insert into observed_transactions (tx_hash, watched_wallet_id, sender, receiver, token, amount, timestamp)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (tx_hash) do nothing`,
    [input.event.txHash, input.watchedWalletId, input.event.sender, input.event.receiver, input.event.token, input.event.amount, input.event.timestamp]
  );
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
    label: row.label,
    source: row.source,
    createdByTelegramId: row.created_by_telegram_id,
    createdAt: row.created_at
  }));
}
