# TRON USDT Monitoring Bot

Read-only Telegram bot for monitoring incoming TRC20 USDT transfers on watched TRON wallets.

## What It Does

- Adds watched TRON wallets from Telegram.
- Polls incoming official TRC20 USDT transfers.
- Sends risk level, score, and reasons for each new incoming transfer.
- Sends HIGH and CRITICAL events to whitelisted service admins.
- Lets service admins label risky or trusted addresses.
- Supports manual `/check <address-or-tx-hash>`.

## What It Does Not Do

- It does not ask for private keys or seed phrases.
- It does not sign transactions.
- It does not control wallets or funds.
- It does not decide payouts for an exchange.

## Setup

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npm run db:migrate
npm run dev
```

Set these values in `.env`:

```text
BOT_TOKEN=...
DATABASE_URL=postgres://postgres:postgres@localhost:5432/tron_guard
TRONSCAN_BASE_URL=https://apilist.tronscanapi.com
TRONSCAN_API_KEY=
POLL_INTERVAL_MS=60000
SERVICE_ADMIN_TG_IDS=123456789,987654321
```

`TRONSCAN_API_KEY` is optional for local testing, but should be configured for production reliability.

## Telegram Commands

- `/start` registers the Telegram user.
- `/add_wallet <TRON-address>` enables monitoring.
- `/wallets` lists watched wallets.
- `/remove_wallet <TRON-address>` removes a watched wallet.
- `/check <TRON-address-or-tx-hash>` runs a manual risk check.
- `/settings` shows current MVP alert behavior.
- `/help` lists commands.
- `/mark <TRON-address> <label>` labels an address, admin-only.
- `/labels` lists available labels, admin-only.
- `/admin_users` lists configured service admin IDs, admin-only.

## Checks

```bash
npm test
npm run typecheck
```

## Phase 1 Manual Live Checklist

Use this checklist only with a real Telegram bot token, a reachable Postgres database, and a TRON wallet address you control or can safely monitor. Do not paste secrets into commits, chat logs, or issue text.

1. Create `.env` from `.env.example` and fill in real local values:
   - `BOT_TOKEN` from BotFather.
   - `DATABASE_URL` for the local or staging Postgres instance.
   - `TRONSCAN_BASE_URL=https://apilist.tronscanapi.com`.
   - `TRONSCAN_API_KEY` if available.
   - `SERVICE_ADMIN_TG_IDS` with your Telegram numeric ID for admin-only commands.
2. Start Postgres and apply migrations:
   ```bash
   docker compose up -d postgres
   npm run db:migrate
   ```
3. Start the bot:
   ```bash
   npm run dev
   ```
   Confirm the process logs `bot_started` and no migration or Telegram startup errors.
4. In Telegram, send `/start` to the bot. Confirm it replies with the monitoring prompt.
5. Add a wallet:
   ```text
   /add_wallet <TRON-address>
   ```
   Confirm the bot replies that monitoring is enabled.
6. List wallets with `/wallets`. Confirm the added address appears exactly once.
7. Run a manual check:
   ```text
   /check <TRON-address-or-tx-hash>
   ```
   Confirm the reply includes `Subject:`, `Risk:`, and `Reasons:`.
8. As a non-admin Telegram user, run:
   ```text
   /mark <TRON-address> scam
   ```
   Confirm the bot rejects the command as admin-only.
9. As a configured service admin, run:
   ```text
   /mark <TRON-address> scam
   /check <TRON-address>
   ```
   Confirm the mark succeeds and the manual check reflects the stored label.
10. Observe one incoming official TRC20 USDT transfer to a watched wallet. Confirm the bot sends the user alert and, for HIGH or CRITICAL risk, sends the service-admin alert.
11. Stop the bot with `Ctrl+C`. Confirm shutdown logs appear and the process exits cleanly.

## Risk Model

The current foundation supports:

- internal labels;
- external AML signals as a future provider hook;
- graph proximity signals as a future provider hook;
- behavioral pattern signals as a future provider hook;
- incoming transfer context through the polling worker.

The first implemented scoring source is internal labels. External providers and deeper graph/behavior rules are intentionally behind interfaces so they can be researched and added one by one without changing the bot surface.
