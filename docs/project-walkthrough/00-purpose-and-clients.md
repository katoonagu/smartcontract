# Purpose, Problem, And Clients

## Status

This document captures the current understanding of the product purpose and audience. It is based on repository documents, migrations, and code symbols inspected during the project walkthrough.

## Fact From Code And Docs

The active project is a read-only Telegram bot and backend service for TRON/TRC20 USDT monitoring.

The project mission is to help users, exchange operators, and service admins monitor TRON/TRC20 USDT wallets for incoming transfer risk, wallet safety issues, and dangerous approval patterns before they become fund-loss, compliance, or support incidents.

Sources:

- `README.md` describes the project as a read-only Telegram bot for monitoring incoming TRC20 USDT transfers on watched TRON wallets.
- `.planning/PROJECT.md` defines the mission and explicitly narrows the implemented scope to TRON USDT monitoring with read-only risk intelligence and Approval Guard.
- `.planning/REQUIREMENTS.md` defines the active product as a TRON/TRC20 USDT read-only Telegram monitoring bot.

The implemented product surface includes:

- Telegram onboarding and profile/settings/help screens.
- Adding, listing, opening, and removing watched TRON wallets.
- Manual `/check <address-or-tx-hash>` checks.
- Polling incoming official TRC20 USDT transfers for watched wallets.
- Risk level, score, and reasons for incoming transfers.
- Per-wallet alert modes: `realtime`, `risk_only`, `digest`, and `paused`.
- Alert routing to wallet owners, optional customer alert admins, and service admins.
- Service-admin address labels that can affect risk scoring.
- Evidence-first deterministic risk observations.
- Approval Guard for confirmed official TRON USDT approvals.
- Wallet dashboard with monitoring status, balances, 30d flow, fees, analytics, risk intel, and safety status.

Code and database evidence:

- `src/types.ts` defines `WatchedWallet` with `telegramUserId`, `telegramUsername`, `address`, `alertMode`, and `digestIntervalMinutes`.
- `migrations/001_init.sql` creates `telegram_users`, `watched_wallets`, `observed_transactions`, `wallet_poll_state`, `address_labels`, `transaction_labels`, and `risk_reports`.
- `migrations/003_risk_observation_foundation.sql` creates `raw_evidence` and `risk_signal_observations`.
- `migrations/004_alert_settings.sql` creates `customer_alert_recipients`.
- `migrations/005_wallet_alert_modes.sql` adds wallet alert modes.
- `migrations/006_approval_guard.sql` creates approval polling, wallet approval, and observed approval event tables.

## Problem It Solves

The project closes the monitoring gap between raw blockchain data and operational decisions.

Without this bot, a user or exchange operator must manually inspect TronScan, approvals, transaction history, labels, counterparties, and suspicious patterns. The bot automates the first warning layer: it watches known wallets, detects relevant incoming transfers and approval events, scores risk with evidence, and sends Telegram alerts.

The narrow current wedge is:

> Telegram bot for TRON USDT that warns a user or exchange operator about dangerous approvals and high-risk incoming funds.

This wording is taken from the product idea document and is aligned with the implemented MVP scope.

## Clients And Roles

Implemented roles:

- **Wallet owner**: adds their own TRON wallets, sees dashboard and safety views, receives alerts according to wallet alert mode.
- **Customer alert admin**: optional Telegram recipient configured by a wallet owner for suspicious-only or all alerts.
- **Service admin**: trusted platform operator configured through `SERVICE_ADMIN_TG_IDS`; can label addresses and receives HIGH/CRITICAL service-side events.

Target customer segments from the product idea:

- Individuals with TRON/BSC USDT wallets.
- Exchanges, OTC operators, and P2P teams.
- Crypto-processing and small payment services.
- Legal teams helping victims of crypto fraud.

Current implementation is focused on the TRON USDT MVP. BSC/EVM, B2B API/webhooks, legal workflows, full graph forensics, and commercial AML provider integrations are not live product claims.

## Safety Boundaries

The bot is explicitly read-only.

It does not:

- ask for private keys or seed phrases;
- sign transactions;
- revoke approvals;
- control wallets or funds;
- decide payouts for an exchange;
- deanonymize arbitrary third-party blockchain addresses into Telegram users.

Risk language must stay probabilistic and evidence-backed. The project requirements explicitly prohibit unsupported accusations and require honest UI status for active, limited, planned, and not-connected risk modules.

## Reasoned Interpretation

This repository is not a smart-contract development project. It is a risk, compliance, monitoring, and forensics backend with a Telegram interface around TRON USDT.

The core value is early warning plus evidence: help a wallet owner or operational team notice risky funds, unsafe approvals, and suspicious counterparties before they become financial, support, or compliance incidents.

## Not Found Or Needs Verification

The following are present as product vision or future backlog, but should not be described as implemented without a dedicated code review of a completed phase:

- commercial AML provider integration;
- full graph forensics claims;
- BSC/EVM support;
- B2B API/webhooks;
- legal/police outreach workflow;
- arbitrary address-to-Telegram deanonymization;
- automatic revoke or transaction signing.
