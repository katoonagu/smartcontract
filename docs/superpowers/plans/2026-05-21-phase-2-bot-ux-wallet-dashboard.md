# Phase 2 Bot UX + Wallet Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the command-only Telegram bot into a product-like wallet dashboard with inline buttons, monitoring status, wallet analytics, gas/fee visibility, and an honest risk-score shell.

**Architecture:** Keep the bot read-only. Add small bot UI modules for inline keyboards/messages, DB-backed pending actions for multi-step button flows, and a cached wallet dashboard service fed by TronScan. Do not implement AML, approvals, graph proximity, or real dirty-funds intelligence in this phase; expose them as "not connected yet" in the safety view.

**Tech Stack:** TypeScript, Node.js, grammY `InlineKeyboard` / callback queries, Postgres migrations, existing TronScan client, Vitest.

---

## Scope Decisions

- Main MVP direction is **B: UX + wallet analytics**.
- Dashboard should show `Last check` and `Last result`, not `Last poll`.
- Main dashboard should not show separate incoming/outgoing tx counts; show `Activity: N tx total`. Detailed tx counts live under `Analytics`.
- Add `Wallet safety` / `Risk score` as the main security block, but label confidence as limited until AML, graph, and approvals providers exist.
- Include wallet age in MVP.
- Include 30d gas/fees in TRX and approximate USD.
- Use all-time tx counts from account data in MVP; defer all-time USDT volume unless it is available from cached/backfilled analytics without extra rate-limit risk.

## File Structure

- Create `src/bot/keyboards.ts`: inline keyboard builders and callback data helpers.
- Create `src/bot/messages.ts`: text formatters for home, wallet dashboard, analytics, security, prompts, and errors.
- Create `src/bot/pendingActions.ts`: pending user action types and handlers.
- Create `src/wallet/dashboard.ts`: dashboard aggregation service.
- Create `src/wallet/metrics.ts`: parsers and calculations for balances, 30d flow, tx counts, fees, wallet age, and basic safety score.
- Modify `src/bot/createBot.ts`: wire callbacks, pending actions, and new dashboard responses.
- Modify `src/tron/tronClient.ts`: add account, related transfer, and transaction-history methods.
- Modify `src/storage/repositories.ts`: add pending action, dashboard snapshot, and poll-state status helpers.
- Add migration `migrations/002_bot_ux_dashboard.sql`.
- Add tests under `tests/bot`, `tests/tron`, `tests/storage`, and `tests/wallet`.

## Data Model

Add `telegram_user_sessions`:

```sql
create table if not exists telegram_user_sessions (
  telegram_user_id text primary key references telegram_users(telegram_user_id) on delete cascade,
  pending_action text check (pending_action in ('add_wallet', 'check_address', 'check_tx')),
  selected_wallet_id text references watched_wallets(id) on delete set null,
  updated_at timestamptz not null default now()
);
```

Add fields to `wallet_poll_state`:

```sql
alter table wallet_poll_state
  add column if not exists last_poll_event_count integer not null default 0,
  add column if not exists last_poll_new_count integer not null default 0,
  add column if not exists last_poll_error text;
```

Add `wallet_dashboard_snapshots`:

```sql
create table if not exists wallet_dashboard_snapshots (
  watched_wallet_id text primary key references watched_wallets(id) on delete cascade,
  trx_balance_sun numeric(38,0) not null,
  usdt_balance_micro numeric(38,0) not null,
  wallet_created_at timestamptz,
  total_tx_count integer,
  incoming_tx_count integer,
  outgoing_tx_count integer,
  thirty_day_in_usdt numeric(38,6) not null default 0,
  thirty_day_out_usdt numeric(38,6) not null default 0,
  thirty_day_transfer_count integer not null default 0,
  thirty_day_fee_sun numeric(38,0) not null default 0,
  trx_usd_price numeric(18,8),
  analytics_partial boolean not null default false,
  refreshed_at timestamptz not null default now(),
  last_error text
);
```

## Task 1: TronScan Dashboard Methods

**Files:**
- Modify: `src/tron/tronClient.ts`
- Test: `tests/tron/tronClient.test.ts`

- [ ] Add types:

```ts
export type TronscanAccount = {
  balance?: unknown;
  date_created?: unknown;
  transactions_in?: unknown;
  transactions_out?: unknown;
  totalTransactionCount?: unknown;
  trc20token_balances?: unknown;
  tokenBalances?: unknown;
};

export type ListRelatedTrc20TransfersOptions = {
  start?: number;
  limit?: number;
  minTimestamp?: number;
  endTimestamp?: number;
};

export type ListTransactionsOptions = {
  start?: number;
  limit?: number;
  minTimestamp?: number;
  endTimestamp?: number;
};
```

- [ ] Extend `TronClient`:

```ts
getAccount(address: string): Promise<TronscanAccount>;
listRelatedTrc20Transfers(address: string, options?: ListRelatedTrc20TransfersOptions): Promise<RawTronscanTrc20Transfer[]>;
listTransactions(address: string, options?: ListTransactionsOptions): Promise<unknown[]>;
```

- [ ] Implement:
  - `getAccount` calls `/api/account?address=<address>`.
  - `listRelatedTrc20Transfers` calls `/api/token_trc20/transfers` with `relatedAddress`, official USDT contract, `confirm=0`, `sort=-timestamp`, pagination, and timestamps.
  - `listTransactions` calls `/api/transaction` with `address`, `sort=-timestamp`, pagination, and timestamps.
  - Reuse existing retry/backoff and malformed-shape validation.

- [ ] Tests:
  - account method sends API key and correct path.
  - related transfer method uses `relatedAddress`, not `toAddress`.
  - transactions method returns `data` array and rejects malformed non-array `data`.
  - transient `429/5xx/timeout` retry behavior remains shared.

## Task 2: Dashboard Metrics

**Files:**
- Create: `src/wallet/metrics.ts`
- Test: `tests/wallet/metrics.test.ts`

- [ ] Implement account parsing:
  - TRX balance from account `balance` in sun.
  - USDT balance from `trc20token_balances` where `tokenId` is official USDT.
  - Wallet age from `date_created`.
  - Tx counts from `transactions_in`, `transactions_out`, `totalTransactionCount`.
  - TRX/USD estimate from USDT `tokenPriceInTrx`: `trxUsd = 1 / tokenPriceInTrx`.

- [ ] Implement transfer flow calculation:
  - Only official USDT, confirmed/successful transfers.
  - If `to_address === wallet`, add to 30d in.
  - If `from_address === wallet`, add to 30d out.
  - Format micro-USDT to decimal USDT using 6 decimals.

- [ ] Implement fee calculation:
  - For transaction records where `ownerAddress === wallet`, sum `cost.fee` in sun.
  - Ignore failed/reverted transactions.
  - USD estimate is `feeTrx * trxUsd`, if `trxUsd` exists.

- [ ] Implement basic wallet safety report:
  - Use existing internal labels for the wallet address.
  - Add light activity signals only when they are explainable:
    - wallet age under 7 days and 30d volume over 10,000 USDT: +20.
    - wallet age under 30 days and 30d volume over 50,000 USDT: +20.
  - Always include confidence metadata:
    - checked: internal labels, wallet age, 30d activity, incoming monitor.
    - not connected: AML, graph proximity, approvals.

## Task 3: Dashboard Aggregation + Cache

**Files:**
- Create: `src/wallet/dashboard.ts`
- Modify: `src/storage/repositories.ts`
- Test: `tests/wallet/dashboard.test.ts`, `tests/storage/repositoriesDashboard.test.ts`

- [ ] Add repository methods:
  - `getTelegramUserSession`.
  - `setTelegramUserPendingAction`.
  - `clearTelegramUserPendingAction`.
  - `getWalletDashboardSnapshot`.
  - `upsertWalletDashboardSnapshot`.
  - `getWalletPollState` already exists; extend mapper for new last-result fields.

- [ ] Add dashboard service:
  - `getWalletDashboard(wallet, deps, { forceRefresh?: boolean })`.
  - Return cached snapshot if `refreshed_at` is less than 5 minutes old and `forceRefresh` is false.
  - Refresh account, 30d USDT transfers, and 30d transactions from TronScan.
  - Page through at most `TRONSCAN_DASHBOARD_MAX_PAGES`, default 5, limit 50.
  - Set `analytics_partial=true` if page cap is hit before the 30d range is exhausted.
  - Store errors in snapshot `last_error`; do not crash the bot message flow.

- [ ] Add config defaults:
  - `TRONSCAN_DASHBOARD_CACHE_TTL_MS=300000`.
  - `TRONSCAN_DASHBOARD_MAX_PAGES=5`.

## Task 4: Poll State Last Result

**Files:**
- Modify: `src/monitor/monitorWorker.ts`
- Modify: `src/storage/repositories.ts`
- Test: `tests/monitor/monitorWorker.test.ts`

- [ ] Extend wallet poll state updates:
  - On successful wallet poll, store `last_poll_event_count`, `last_poll_new_count`, and clear `last_poll_error`.
  - On wallet-level TronScan/poll failure, store `last_poll_error` without deleting the wallet or crashing other wallets.

- [ ] Dashboard display rules:
  - If `last_successful_poll_at` exists and `last_poll_new_count = 0`: `Last result: no new transfers`.
  - If `last_poll_new_count > 0`: `Last result: N new transfer(s)`.
  - If `last_poll_error` exists: `Last result: check failed`.
  - If no state exists: `Last result: not checked yet`.

## Task 5: Telegram Inline UX

**Files:**
- Create: `src/bot/keyboards.ts`
- Create: `src/bot/messages.ts`
- Create: `src/bot/pendingActions.ts`
- Modify: `src/bot/createBot.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] Keyboard callbacks:
  - `menu:home`
  - `wallets:list`
  - `wallet:add`
  - `wallet:view:<walletId>`
  - `wallet:refresh:<walletId>`
  - `wallet:analytics:<walletId>`
  - `wallet:security:<walletId>`
  - `wallet:remove:<walletId>`
  - `wallet:remove_confirm:<walletId>`
  - `check:address`
  - `check:tx`
  - `settings:view`
  - `action:cancel`

- [ ] Home message:

```text
TRON Guard

Monitoring wallets: {count}
Last check: {latest successful check or "not checked yet"}

Choose an action below.
```

- [ ] Wallet dashboard message:

```text
Wallet dashboard
{shortAddress}

Wallet safety: {level} - {score}/100
Confidence: limited

Monitoring: active
Last check: {relative time}
Last result: {last result}

USDT balance: {amount}
TRX balance: {amount}
Wallet age: {age}
Activity: {totalTxCount} tx total

30d flow
In: {amount} USDT
Out: {amount} USDT
Tx: {transferCount}

Gas / fees 30d
{feeTrx} TRX (~${feeUsd})
{energyHint}
```

- [ ] Dashboard buttons:
  - Row 1: `Refresh`, `Analytics`
  - Row 2: `Security`, `Wallets`
  - Row 3: `Check address`, `Check tx`
  - Row 4: `Settings`, `Remove`

- [ ] Analytics message:
  - Show detailed incoming/outgoing tx counts.
  - Show 30d flow and whether analytics are partial.
  - Show fee summary and energy-savings hint only when fees are above a simple threshold, e.g. `50 TRX / 30d`.

- [ ] Security message:
  - Show wallet safety score.
  - Show reasons.
  - Show checked/not-connected sections.
  - Do not claim AML, approvals, graph, or dirty-funds graph checks are active.

- [ ] Pending action behavior:
  - Clicking `Add wallet` sets `pending_action=add_wallet`.
  - Clicking `Check address` sets `pending_action=check_address`.
  - Clicking `Check tx` sets `pending_action=check_tx`.
  - Next text message is interpreted by pending action first.
  - `Cancel` clears pending action.
  - Text address without pending action keeps existing behavior: add wallet.

- [ ] Callback behavior:
  - Every callback handler calls `ctx.answerCallbackQuery()`.
  - Prefer editing existing messages for navigation when possible.
  - Send a new message when editing fails due to old/deleted message.

## Task 6: Tests + Docs + Live Smoke

**Files:**
- Modify: `README.md`
- Test: all new tests above

- [ ] Test scenarios:
  - `/start` replies with home menu and inline buttons.
  - `Add wallet` button sets pending action; next address stores wallet and shows dashboard.
  - `Check address` button sets pending action; next address returns check result and does not add wallet.
  - `/wallets` still works as command and includes wallet list.
  - `wallet:view` shows dashboard with cached analytics.
  - `Refresh` bypasses cache.
  - `Security` shows limited confidence and not-connected providers.
  - `Analytics` shows detailed tx counts and partial flag when page cap hit.
  - Remove wallet requires confirmation.

- [ ] Verification:

```bash
npm test
npm run typecheck
```

- [ ] Manual smoke:
  - Start Postgres and migrate.
  - Start bot.
  - Send `/start`.
  - Add wallet through button flow.
  - Open dashboard.
  - Press `Refresh`, `Analytics`, `Security`, `Wallets`.
  - Use `Check address` and confirm it does not add a wallet.
  - Confirm dashboard shows `Last check` and `Last result`.
  - Confirm no secrets are logged.

## Explicit Non-Goals

- No real AML provider integration.
- No approvals/smart-contract allowance scanner.
- No graph proximity, 1-hop/2-hop, bridge/mixer route detection.
- No payout decisions or wallet control.
- No private keys, seed phrases, signing, or transaction sending.
- No paid Energy/Bandwidth integration; only a fee-savings hint based on observed gas usage.

## Suggested Commit Slices

1. `feat: add dashboard tronscan methods`
2. `feat: calculate wallet dashboard metrics`
3. `feat: cache wallet dashboard snapshots`
4. `feat: track wallet poll result state`
5. `feat: add telegram inline dashboard ux`
6. `docs: document phase 2 dashboard smoke flow`
