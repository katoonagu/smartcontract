# TRON USDT Monitoring Bot Design

Date: 2026-05-20
Status: Draft for user review

## Summary

The product is a standalone Telegram service for exchanges, OTC/P2P teams, and people who regularly receive TRON USDT. A user adds a working TRON wallet to the bot. The bot monitors incoming TRC20 USDT transfers 24/7, analyzes the sender address, and sends a Telegram alert with risk level, score, and reasons.

The service does not control wallets, sign transactions, decide payouts, or operate as an internal exchange workflow. It is a monitoring and risk-analysis layer.

## Product Scope

MVP v0.1 focuses on TRON USDT incoming monitoring.

The MVP does five things:

1. A user sends a TRON wallet address to the bot.
2. The bot validates and saves the address under that Telegram user.
3. The bot monitors incoming TRC20 USDT transfers to the saved wallet.
4. For each incoming transfer, the bot analyzes the sender and sends a risk alert: risk level, risk score from 0 to 100, and explainable reasons.
5. If the event is suspicious, the bot also sends it to service admins for manual review and labeling.

The product's purpose is to give a fast early warning about risky incoming money. It does not make the final business decision for the exchange or user.

## Non-Goals

MVP v0.1 does not include:

- wallet control or custody;
- private key storage;
- transaction signing;
- payouts or payout approval;
- an internal exchange operator/compliance workflow;
- comments or case CRM;
- BSC/EVM support;
- web dashboard;
- exchange API/webhook;
- automated police reports or legal filings;
- TRON Energy partnership;
- full forensic graph UI.

## Roles

### User

A Telegram user who adds one or more working TRON wallets for monitoring. The user receives alerts for their own watched wallets.

### Service Admin

A trusted Telegram ID from the service team. Service admins receive suspicious `HIGH` and `CRITICAL` events and can manually label addresses or transactions. These labels improve the shared risk database.

This is not an exchange-side admin role by default. The same person may be both a normal user and a service admin if their Telegram ID is whitelisted.

### Optional Alert Recipient

A future optional setting. A user may add extra Telegram IDs to receive alerts for that user's wallets. This is not part of default MVP behavior.

## User Flows

### Wallet Connection

1. User starts the bot with `/start`.
2. User sends a TRON address directly or uses `/add_wallet`.
3. Bot validates the address.
4. Bot saves the address with the user's Telegram ID and username.
5. Bot confirms that monitoring is active.

A wallet label is not required in MVP. Labels can be added later as an optional setting.

### Automatic Incoming Monitoring

1. The TRON indexer checks watched wallets for new incoming TRC20 USDT transfers.
2. When a new incoming transfer is found, the parser extracts:
   - watched wallet;
   - sender address;
   - receiver address;
   - amount;
   - transaction hash;
   - token;
   - timestamp.
3. The risk engine analyzes the sender address and transfer context.
4. The alert engine sends the result to the user.

### User Alert Format

The user receives a compact alert:

```text
Incoming USDT: 12,450
From: TX...
Risk: HIGH - 82/100

Reasons:
- address connected to known risky cluster
- fast transit pattern detected
- repeated split transfers in recent history

Tx: ...
```

Each alert must include a risk level, score, and human-readable reasons. The score alone is not enough.

For `LOW` risk events, MVP may send a compact alert for every incoming transfer. Noise filters can be added after usage data is available.

### Manual Check

The user can send a TRON address or transaction hash manually, or use `/check`.

The bot returns:

- risk level;
- risk score;
- reasons;
- brief transaction/address context;
- relevant internal labels or AML signals when present.

### Suspicious Event Routing

If a new incoming transfer is `HIGH` or `CRITICAL`, the bot sends the suspicious event to:

1. the owner of the watched wallet;
2. the whitelisted service admin Telegram IDs.

The default behavior does not send suspicious events to additional client-side admins. Extra alert recipients are a later optional setting.

## Service Admin Flow

Service admins receive alerts for `HIGH` and `CRITICAL` events.

Admin alert format:

```text
HIGH incoming event
User: @username - tg_id: 123456789
Watched wallet: T...
Sender: T...
Amount: 12,450 USDT
Score: 82/100

Reasons:
- split pattern
- risky 1-hop connection
- AML medium/high signal

Actions:
[mark scam] [mark trusted] [false positive] [needs review]
```

Service admin actions in MVP:

- label an address;
- label a transaction;
- mark false positive;
- set a risk category;
- trigger risk recheck after a new label.

MVP does not include comments, assigned owners, investigation statuses, or CRM-style case management.

## Risk Engine

The risk engine produces:

- `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`;
- a score from 0 to 100;
- reasons explaining the score.

The engine must not claim that an address is criminal solely from a weak graph connection. It should report risk and explain evidence.

### Risk Levels

- `LOW 0-29`: no obvious risk signals found.
- `MEDIUM 30-59`: weak signals; manual attention may be useful.
- `HIGH 60-84`: meaningful suspicious signals.
- `CRITICAL 85-100`: strong internal label, direct dirty exposure, scam cluster, sanctions/mixer-like route, or other high-confidence evidence.

### Risk Signals

#### Internal Labels

The shared internal database can label addresses and transactions as:

- `scam`;
- `stolen_funds`;
- `phishing`;
- `mule`;
- `collector`;
- `bridge`;
- `exchange`;
- `trusted`;
- `false_positive`;
- `needs_review`;
- `mixer_like`;
- `risky_contract`.

#### AML Provider Signals

External AML sources are used as one signal. They are not treated as absolute truth. The alert should state when a reason comes from an external provider.

#### Graph Proximity

The engine checks whether the sender is connected to risky addresses through:

- direct transfer;
- 1-hop connection;
- 2-hop connection;
- shared collector address;
- repeated route through the same cluster.

#### Behavioral Patterns

The MVP should detect or leave clear extension points for:

- amount splitting;
- fast transit through a wallet;
- fresh wallet with large activity;
- collector wallet behavior;
- repeated equal or near-equal amounts;
- bridge-like routes;
- mixer-like routes;
- many inputs followed by one quick output;
- frequent approval and `transferFrom` patterns;
- interaction with known risky contracts or services.

#### Incoming Transfer Context

The engine considers:

- amount;
- sender age;
- sender transaction count;
- transfer frequency;
- prior interaction with the watched wallet;
- whether this is first contact.

## Bot Interface

### User Commands

- `/start`: register user and show basic menu.
- `/add_wallet`: add a TRON address for monitoring.
- `/wallets`: list watched wallets.
- `/remove_wallet`: remove a wallet from monitoring.
- `/check`: manually check a TRON address or tx hash.
- `/settings`: basic notification settings.
- `/help`: explain risk levels and accepted inputs.

The bot should also support free text input:

- if the user sends a valid TRON address, offer to add it or check it;
- if the user sends a tx hash, check the transaction.

### Admin-Only Commands

- `/admin_alerts`: show recent suspicious events.
- `/mark`: label an address or tx.
- `/recheck`: recompute risk after a new label.
- `/labels`: list available labels.
- `/admin_users`: list whitelisted service admins.

Admin-only commands are available only to whitelisted Telegram IDs.

## Technical Architecture

### Components

#### Telegram Bot API Layer

Handles Telegram commands, inline buttons, free text input, and outbound alerts. Recommended framework: grammY or Telegraf.

#### User and Wallet Store

Stores:

- Telegram user ID;
- Telegram username;
- watched TRON addresses;
- notification settings;
- created/updated timestamps.

#### TRON Indexer Worker

Polls watched wallets for incoming TRC20 USDT transfers.

For MVP, polling through TronGrid/Tronscan API every 30-120 seconds is acceptable. Later versions can move to a dedicated TRON node or event stream.

#### Transaction Parser

Normalizes raw TRON data into internal events:

- sender;
- receiver;
- token;
- amount;
- tx hash;
- timestamp;
- direction.

#### Risk Engine

Computes risk level, risk score, and reasons from internal labels, AML signals, graph proximity, behavioral patterns, and transfer context.

#### Admin Label System

Lets service admins label addresses and transactions from Telegram commands or buttons. Labels are stored and used in future scoring.

#### Alert Engine

Sends normal incoming alerts to users and suspicious alerts to service admins.

#### Database

Use PostgreSQL for:

- users;
- watched wallets;
- observed transactions;
- risk reports;
- labels;
- admin actions;
- alert delivery records.

Redis and BullMQ can be added if polling, rechecks, or alert delivery need queues.

### Recommended Stack

- Node.js;
- TypeScript;
- grammY or Telegraf;
- PostgreSQL;
- Redis + BullMQ if needed;
- TronWeb;
- TronGrid/Tronscan API;
- Docker.

## Security and Privacy Constraints

- The bot is read-only.
- The bot never asks for private keys or seed phrases.
- The bot never signs transactions.
- The bot never controls funds.
- Telegram user IDs and wallet addresses are sensitive data.
- Service admin commands are restricted by Telegram ID whitelist.
- Risk labels should avoid unsupported absolute claims. Prefer `risk`, `possible exposure`, and `needs review`.
- External AML results must be shown as provider signals, not final truth.

## MVP Roadmap

### v0.1

- Telegram registration.
- Add/remove/list watched TRON wallets.
- Monitor incoming TRC20 USDT.
- Send incoming alerts with risk level, score, and reasons.
- Manual `/check` for address or tx.
- Send `HIGH/CRITICAL` alerts to service admins.
- Admin labels for addresses and transactions.
- Basic internal risk database.
- External AML provider hook as one signal.

### v0.2

- Richer labels and risk rules.
- Basic admin page or Telegram report view for suspicious events.
- Mini-report export.
- Optional extra alert Telegram IDs per user.
- Basic Approval Guard for watched wallets.

### v0.3

- BSC USDT/USDC.
- TRON to BSC bridge detection.
- Graph visualization.
- API/webhook.
- Forensic report pack.
- TRON Energy partnership.

## Success Criteria

MVP is successful if:

- a user can add a wallet in under one minute;
- a new incoming USDT transfer is detected within 1-2 minutes;
- each alert includes risk level, score, and clear reasons;
- service admins receive all `HIGH` and `CRITICAL` events;
- service admin labels affect future risk checks;
- the bot stays fully read-only and never handles keys or funds.

## MVP Defaults

- External AML is implemented behind a provider adapter. MVP can run with an internal-only provider until the first commercial AML provider is selected.
- Polling target is every 60 seconds per watched wallet, with backoff when API rate limits are hit.
- `LOW` incoming alerts are sent for every transfer in MVP. Grouping and thresholds are added after real usage data shows the noise level.
- First scoring weights are rule-based and explainable. Internal high-confidence labels dominate the score; AML and graph/behavioral signals contribute as supporting reasons.
