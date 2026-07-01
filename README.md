# TRON USDT Monitoring Bot

Read-only Telegram bot for monitoring incoming TRC20 USDT transfers on watched TRON wallets.

## What It Does

- Adds watched TRON wallets from Telegram.
- Polls incoming official TRC20 USDT transfers.
- Monitors confirmed official TRON USDT approvals for watched wallets.
- Sends risk level, score, and reasons for each new incoming transfer.
- Supports per-wallet alert modes: realtime, risk-only, digest, and paused.
- Lets wallet owners add optional customer alert admin Telegram IDs.
- Sends HIGH and CRITICAL events to whitelisted service admins.
- Lets service admins label risky or trusted addresses.
- Supports manual `/check <address-or-tx-hash>`.
- Shows an inline Telegram wallet dashboard with monitoring status, balances, 30d flow, fees, analytics, and limited beta risk intelligence.

## What It Does Not Do

- It does not ask for private keys or seed phrases.
- It does not sign transactions.
- It does not revoke approvals or ask the user to sign revoke transactions.
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
DATABASE_URL=postgres://postgres:postgres@localhost:55433/tron_guard
TRONSCAN_BASE_URL=https://apilist.tronscanapi.com
TRON_FULLNODE_BASE_URL=https://api.trongrid.io
TRONSCAN_API_KEY=key_a,key_b
TRONSCAN_API_KEY_GROUPS=account_a:key_a;account_b:key_b
TRON_FULLNODE_API_KEY=
TRONSCAN_REQUEST_MIN_INTERVAL_MS=250
TRONSCAN_GLOBAL_REQUEST_MIN_INTERVAL_MS=280
TRONSCAN_ACCOUNT_GROUP_REQUEST_MIN_INTERVAL_MS=250
TRONSCAN_RATE_LIMIT_COOLDOWN_MS=30000
TRONSCAN_DASHBOARD_CACHE_TTL_MS=300000
TRONSCAN_DASHBOARD_MAX_PAGES=5
TRONSCAN_DASHBOARD_FORCE_REFRESH_COOLDOWN_MS=60000
POLL_INTERVAL_MS=60000
SERVICE_ADMIN_TG_IDS=123456789,987654321
```

`TRONSCAN_API_KEY` is optional for local testing, but should be configured for production reliability. Multiple keys can be separated by commas. Use `TRONSCAN_API_KEY_GROUPS` to model provider-side quota buckets: keys from the same TronScan account should share one group, while keys from independent accounts should use separate groups. The scheduler applies global and endpoint pacing per group, and a 429 cooldown only stops the affected group instead of the whole pool.

## Telegram UX

`/start` registers the Telegram user and opens the main inline menu.

Main buttons:

- `📁 Wallets` opens the watched wallet list.
- `➕ Add` asks for a TRON address and then shows the wallet dashboard.
- `🔎 Address` checks an address without adding it to monitoring.
- `🧾 Tx` checks a transaction sender without adding a wallet.
- `🛡 Risk intel` shows active and planned risk-intelligence modules.
- `👤 Profile` shows Telegram ID, username, wallet count, and language mode.
- `⚙️ Settings` shows current alert behavior and customer alert admin controls.
- `❔ Help` explains the product shell and current risk-score limits.

Wallet dashboard buttons:

- `🛡 Safety` shows current USDT approval counts, risky spenders, session context, contract intelligence, and read-only revoke guidance.
- `📊 Analytics` shows detailed tx counts, 30d flow, fees, and partial-data status.
- `🔄 Refresh` bypasses dashboard cache and asks TronScan again.
- `🔔 Alert mode` switches realtime, risk-only, digest, or paused delivery for that wallet.
- `🔎 Address` checks an address without adding it to monitoring.
- `🧾 Tx` checks a transaction sender without adding a wallet.
- `📁 Wallets` returns to the wallet list.
- `⚙️ Settings` opens alert and profile settings.
- `🗑 Remove` asks for confirmation before deleting the watched wallet.

Commands still supported:

- `/add_wallet <TRON-address>` enables monitoring.
- `/wallets` lists watched wallets.
- `/remove_wallet <TRON-address>` removes a watched wallet.
- `/wallet_mode <TRON-address> <realtime|risk_only|digest|paused> [minutes]` changes delivery mode for one watched wallet.
- `/check <TRON-address-or-tx-hash>` runs a manual risk check.
- `/settings` shows current MVP alert behavior.
- `/profile` shows the compact Telegram profile screen.
- `/my_id` shows your numeric Telegram ID, useful when another owner needs to add you as an alert admin.
- `/alert_admins` lists customer alert admins. Alias: `/alert_recipients`.
- `/add_alert_admin <telegram-id> [suspicious|suspicious_only|all]` adds or updates a customer alert admin. Alias: `/alert_add`.
- `/remove_alert_admin <telegram-id>` removes a customer alert admin. Alias: `/alert_remove`.
- `/alert_mode <telegram-id> <suspicious|suspicious_only|all>` updates an existing customer alert admin mode.
- `/help` lists commands.
- `/mark <TRON-address> <label>` labels an address, admin-only.
- `/labels` lists available labels, admin-only.
- `/admin_users` lists configured service admin IDs, admin-only.

## Checks

```bash
npm test
npm run typecheck
```

## Phase 6 Telegram UX

The bot uses a compact bilingual Telegram UI inspired by high-density utility bots:

- emoji-led status rows;
- RU/EN mixed copy;
- two-column inline menus;
- separate Profile, Settings, Wallets, Analytics, Risk intel, and Alert admins screens;
- Telegram HTML formatting with escaped dynamic values;
- copyable `<code>` wallet addresses, transaction hashes, scores, and Telegram IDs;
- read-only safety copy on user-facing screens.

Telegram message style guide artifacts:

- `docs/superpowers/specs/2026-05-23-telegram-message-style-guide-design.md`
- `docs/superpowers/plans/2026-05-24-telegram-message-style-guide-status.md`

Approval Guard is active for official TRON USDT approvals. AML providers, graph forensics, and wallet-control features remain out of scope.

## Phase 1 Manual Live Checklist

Use this checklist only with a real Telegram bot token, a reachable Postgres database, and a TRON wallet address you control or can safely monitor. Do not paste secrets into commits, chat logs, or issue text.

1. Create `.env` from `.env.example` and fill in real local values:
   - `BOT_TOKEN` from BotFather.
   - `DATABASE_URL` for the local or staging Postgres instance.
   - `TRONSCAN_BASE_URL=https://apilist.tronscanapi.com`.
   - `TRON_FULLNODE_BASE_URL=https://api.trongrid.io`.
   - `TRONSCAN_API_KEY` if available. Use comma-separated values for a key pool.
   - `TRONSCAN_API_KEY_GROUPS` when the pool contains keys from separate TronScan accounts.
   - `TRON_FULLNODE_API_KEY` if your full node provider requires a separate key.
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
- incoming transfer context through the polling worker;
- USDT approval signals through Approval Guard.

The first implemented scoring source is internal labels. External providers and deeper graph/behavior rules are intentionally behind interfaces so they can be researched and added one by one without changing the bot surface.

The wallet dashboard risk score is intentionally marked as limited beta. It currently uses:

- internal labels;
- wallet age;
- 30d USDT activity;
- incoming monitor context;
- limited USDT approval context.

It does not yet use AML databases, graph proximity, mixer/bridge route tracing, or MetaSleuth-style graph intelligence.

The `Risk intel` dashboard is a product shell for these modules. It shows their status honestly:

- `Internal labels: active`
- `Wallet activity: limited`
- `Incoming monitor: active`
- `AML providers: not connected`
- `Hop1/Hop2 graph: planned`
- `Behavioral patterns: planned`
- `Approvals/security: limited`
- `Bridge tracing: planned`
- `Case forensics: planned`

## Approval Guard

Approval Guard is read-only and USDT-only in this MVP. It monitors confirmed on-chain TRC20 approvals for the official TRON USDT contract `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`.

Current policy:

- Spender labeled `scam`, `phishing`, `stolen_funds`, or `risky_contract`: `CRITICAL`, score `95`.
- Spender labeled `trusted` or `false_positive`: dampened to `LOW`.
- Unlimited USDT approval to an unknown EOA/non-contract spender: `HIGH`, score `80`.
- Unknown EOA approvals with raw transaction signing metadata showing long signing-to-block delay and extended expiration can escalate to `CRITICAL`.
- Provider service-tagged smart contracts from TronScan contract metadata, for example `Bridgers:Cross-chain Bridge`, are dampened to `LOW` unless another risk signal overrides them.
- Provider-named smart contracts without a service tag, for example `tokenApprove`, are dampened to `MEDIUM` for dashboard review.
- Unknown/unverified contracts remain `HIGH` for large/unlimited approvals.
- Finite approvals are stored for evidence, but do not alert unless the spender is risky-labeled.

Provider metadata is identity evidence, not final truth. The bot uses exact spender address, contract/account type, TronScan contract search fields such as `name`, `tag1`, `risk`, `verify_status`, and raw transaction signing metadata from `TRON_FULLNODE_BASE_URL`. It still treats confirmed approvals as read-only warnings and does not revoke or sign anything.

The bot only alerts and links out to TronScan/TronLink/revoke tools. It never signs revoke transactions and never asks for private keys.

## Alert Routing

Incoming alerts are routed in three layers:

- Wallet owner: receives alerts according to each wallet's alert mode. Immediate owner delivery is status-tracked and retried.
- Customer alert admins: optional Telegram IDs configured by the wallet owner. Delivery is best-effort and does not block the owner alert.
- Service admins: platform-level IDs from `SERVICE_ADMIN_TG_IDS`; they receive HIGH and CRITICAL events only.

Wallet alert modes:

- `realtime`: every new incoming official TRC20 USDT transfer is sent immediately.
- `risk_only`: MEDIUM/HIGH/CRITICAL events are sent immediately; LOW events are stored without Telegram spam.
- `digest`: MEDIUM/HIGH/CRITICAL events are sent immediately; LOW events are grouped into a digest every 10 minutes by default.
- `paused`: incoming transfers and risk snapshots are stored, but owner alerts are not sent.

Approval Guard follows the same wallet pause rule for owner/customer alerts, but sends every confirmed USDT approval level to the owner and configured customer alert admins because approvals are low-volume and safety-relevant. HIGH and CRITICAL approval events are still sent best-effort to service admins for service-side review.

Customer alert admin modes:

- `suspicious_only`: receives MEDIUM, HIGH, and CRITICAL incoming events. Approval Guard alerts are still delivered for all approval levels.
- `all`: receives every incoming event and every Approval Guard alert.

Use `/my_id` in Telegram to discover the numeric ID that should be passed to `/add_alert_admin`.

## Evidence-First Risk Intelligence

Risk score is deterministic. Every non-zero reason should be backed by a stored `risk_signal_observations` row and, when available, a `raw_evidence` row. LLM summaries and provider adapters are future layers and must not be the only source of scoring truth.

Phase 8 stores Approval Guard evidence for confirmed USDT approvals. It does not yet connect TronScan Security as an authority, sanctions feeds, Chainabuse, graph proximity, bridge attribution, or paid AML providers.

## Phase 2 Manual Live Checklist

Run this after Phase 1 smoke works and migrations are applied.

1. Start the bot:
   ```bash
   npm run dev
   ```
2. In Telegram, send `/start`. Confirm inline buttons appear.
3. Press `Add wallet`, send a TRON address, and confirm the dashboard appears.
4. Confirm the dashboard shows:
   - `Monitoring: active`
   - `Last check`
   - `Last result`
   - `Risk score`
   - USDT/TRX balances
   - wallet age
   - 30d in/out and gas/fees
5. Press `Refresh`, `Analytics`, `Risk intel`, and `Wallets`. Confirm each view responds.
6. Press `Check address`, send a TRON address, and confirm it returns a check result without adding a wallet.
7. Press `Remove`, confirm removal, and verify `/wallets` no longer shows that wallet.
8. Confirm logs do not print `BOT_TOKEN`, `TRONSCAN_API_KEY`, or full `.env` values.

## Phase 3.1 Manual Live Checklist

Use this after applying migrations and restarting the bot.

1. Apply migrations:
   ```bash
   npm run db:migrate
   ```
2. As a service admin, label a test address:
   ```text
   /mark <TRON-address> scam
   ```
3. Check the same address:
   ```text
   /check <TRON-address>
   ```
4. Confirm the response still shows `Risk: CRITICAL`.
5. In Postgres, query observations for that address:
   ```sql
   select code, score_impact, confidence, severity, source, policy_version
   from risk_signal_observations
   where subject_address = '<TRON-address>'
   order by created_at desc
   limit 5;
   ```
   Confirm an `internal_label_scam` row exists.
6. Query linked raw evidence:
   ```sql
   select source_type, evidence_json
   from raw_evidence
   where address = '<TRON-address>'
   order by created_at desc
   limit 5;
   ```
   Confirm the label evidence JSON is stored.

## Phase 4 Manual Live Checklist

Run this after Phase 4 changes are deployed.

1. Start the bot:
   ```bash
   npm run dev
   ```
2. Send `/start`. Confirm the message explains monitoring, incoming USDT alerts, wallet analytics, and limited beta risk checks.
3. Confirm the main inline menu shows:
   - `My wallets`
   - `Add wallet`
   - `Check address`
   - `Check tx`
   - `Settings`
   - `Help`
4. Press `Help`. Confirm it explains current risk-score limits and planned modules.
5. Open a wallet dashboard and confirm it shows:
   - `Monitoring: active`
   - `Last check`
   - `Last result`
   - `Risk score: ... (limited beta)`
   - balances, wallet age, 30d in/out, gas/fees
6. Press `Risk intel`. Confirm it lists active, limited, not-connected, and planned modules without claiming AML/graph/bridge/approval forensics are live.
7. Trigger or mock an incoming user alert. Confirm it includes watched wallet, sender, risk score, reasons, tx hash, and buttons for `Check sender`, `Open tx`, and `Open sender`.

## Phase 5 Manual Live Checklist

Run this after applying `004_alert_settings.sql` and restarting the bot.

1. Ask the extra alert recipient to send `/my_id` to the bot and share the numeric Telegram ID.
2. As the wallet owner, add the recipient:
   ```text
   /add_alert_admin <telegram-id> suspicious
   ```
3. Confirm `/alert_admins` lists the ID with `MEDIUM/HIGH/CRITICAL alerts only`.
4. Update the same ID to all incoming alerts:
   ```text
   /alert_mode <telegram-id> all
   ```
5. Confirm `/alert_admins` lists the ID with `all incoming alerts` and no duplicate row.
6. Open `Settings` and confirm `Alert admins`, `Add suspicious admin`, `Add all-alerts admin`, and remove controls work.
7. Trigger or mock a LOW incoming alert. Confirm the owner receives it and an `all` recipient receives it; `suspicious_only` recipients should not.
8. Trigger or mock a MEDIUM/HIGH/CRITICAL incoming alert. Confirm `suspicious_only` recipients receive it.
9. Block or use an invalid recipient chat and confirm owner alert status still becomes `sent`; customer alert failure should only be logged.
10. Remove the recipient:
   ```text
    /remove_alert_admin <telegram-id>
    ```

## Phase 6 Manual Live Checklist

1. Restart the bot with `npm run dev`.
2. Send `/start`.
3. Confirm the first screen says `TRON Guard`, `РњРѕРЅРёС‚РѕСЂРёРЅРі TRON / USDT`, wallet count, risk beta, and alert status.
4. Confirm the main menu has 8 buttons in 4 rows.
5. Open `Profile` and confirm Telegram ID, username, wallet count, and RU/EN language row.
6. Open `Settings` and confirm owner/service/customer alert descriptions.
7. Add a wallet and confirm dashboard rows are compact with emoji markers.
8. Open `Risk intel` and confirm planned modules are still clearly marked planned/not connected.
9. Press `Back/Menu` buttons from every screen and confirm navigation works.
10. Confirm the bot never asks for private keys, seed phrase, signing, or wallet access.

## Phase 7 Manual Live Checklist

Run this after applying `005_wallet_alert_modes.sql` and restarting the bot.

1. Add or open a normal watched wallet. Confirm the dashboard shows `Alerts: realtime`.
2. Press `Alert mode`, choose `Digest 10m`, and confirm the dashboard changes to `Alerts: digest 10m`.
3. Use the command path:
   ```text
   /wallet_mode <TRON-address> risk_only
   /wallet_mode <TRON-address> digest 15
   /wallet_mode <TRON-address> paused
   /wallet_mode <TRON-address> realtime
   ```
4. On a high-volume wallet, switch to `digest` or `risk_only` before waiting for polling cycles.
5. Trigger or mock a LOW incoming transfer in `risk_only`; confirm it is stored and no owner alert is sent.
6. Trigger or mock MEDIUM/HIGH/CRITICAL in `risk_only` or `digest`; confirm it is sent immediately.
7. For digest mode, confirm LOW transfers are grouped into one summary and are not repeated after `digest_sent_at` is set.
8. Press `Refresh` repeatedly on a busy wallet; confirm dashboard data is served from recent cache during `TRONSCAN_DASHBOARD_FORCE_REFRESH_COOLDOWN_MS`.
9. Simulate or observe a TronScan `429`; confirm logs show rate-limit cooldown and polling continues without moving cursor on failed polls.

## Phase 8 Manual Live Checklist

Run this after applying `006_approval_guard.sql` and restarting the bot.

1. Apply migrations:
   ```bash
   npm run db:migrate
   ```
2. Start the bot:
   ```bash
   npm run dev
   ```
3. Open a watched wallet dashboard and confirm it shows `Wallet safety: OK` or a warning/review status.
4. Press `Safety`. Confirm it shows USDT approval count, unlimited approval count, risky approval count, and read-only revoke guidance.
5. Open `Risk intel`. Confirm `Approvals/security: limited`.
6. Use the 320k approval tx fixture in tests or a wallet with a known unlimited USDT approval:
   ```text
   aa4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2
   ```
7. Confirm the bot records `wallet_approvals`, `observed_approval_events`, and `risk_signal_observations` with `signal_group = approval`.
8. Confirm HIGH/CRITICAL approval alerts include approval tx, spender, score, reasons, and TronScan buttons.
9. Set the wallet to `paused` and confirm owner/customer approval alerts are skipped while evidence is still stored.
