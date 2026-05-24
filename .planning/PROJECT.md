# TRON USDT Monitoring Bot — Project Context

Generated: 2026-05-23T17:35:20+00:00

## Mission

Build a read-only Telegram bot and backend service that helps users, exchange operators, and service admins monitor TRON/TRC20 USDT wallets for incoming transfer risk, wallet safety issues, and dangerous approval patterns before they become fund-loss, compliance, or support incidents.

The product direction in `PRODUCT-IDEA-BLOCKCHAIN-BOT.md` is broader (`Address Guard Bot` across TRON/BSC/EVM, AML, graph forensics, evidence packs, and B2B workflows). The implemented project is currently scoped to the narrower and safer MVP: **TRON USDT monitoring with read-only risk intelligence and Approval Guard**.

## Current Product Surface

Implemented or represented in the codebase/docs:

- Telegram bot onboarding and profile screens.
- Wallet add/list/remove flows for watched TRON addresses.
- Manual `/check <address-or-tx-hash>` checks.
- Incoming official TRC20 USDT monitoring via polling.
- User/customer/service-admin alert routing.
- Per-wallet alert modes: `realtime`, `risk_only`, `digest`, and `paused`.
- Inline wallet dashboard with monitoring status, balances, 30d flow, fees, analytics, risk intel, and safety status.
- Admin-only internal address labels (`scam`, `phishing`, `stolen_funds`, `risky_contract`, `trusted`, `false_positive`, etc.).
- Evidence-first deterministic risk scoring.
- Approval Guard for official TRON USDT approvals.
- Contract intelligence/profile fetches for spender identity and service-tag analysis.
- Approval drain observation heuristics.
- Approval session context to dampen false positives for helper approvals linked to known swap/bridge sessions.
- Safety recheck script for approval/risk reevaluation.

## Non-Negotiable Safety Constraints

- The bot must remain read-only.
- Never ask for, store, log, or transmit private keys or seed phrases.
- Never sign transactions for users.
- Never automatically revoke approvals.
- User-facing revoke guidance must send users to external wallet/revoke tooling and must clearly state that the bot does not control funds.
- Risk language must be probabilistic and evidence-backed (`HIGH risk`, `manual review`, `possible exposure`) rather than unsupported accusations.
- Telegram ID ↔ blockchain address mapping is opt-in only. The product must not claim it can deanonymize arbitrary third-party addresses.
- Any future B2B/legal workflow must preserve consent, role-based access, auditability, and source-backed risk claims.

## Users And Roles

- **Wallet owner:** Adds their own TRON wallet(s), sees dashboard/safety, receives alerts according to wallet mode.
- **Customer alert admin:** Optional Telegram recipient configured by a wallet owner for suspicious/all alerts.
- **Service admin:** Platform-level trusted operator from `SERVICE_ADMIN_TG_IDS`; can label addresses and receives HIGH/CRITICAL service-side events.
- **Future B2B operator:** Exchange/OTC/compliance staff using webhooks/API/case workflows; not yet implemented.

## Architecture Snapshot

- **Runtime:** Node.js + TypeScript ESM.
- **Bot framework:** grammY with auto-retry.
- **Blockchain/data clients:** TronWeb plus TronScan/TRON full-node HTTP access.
- **Storage:** PostgreSQL migrations in `migrations/`.
- **Testing:** Vitest, TypeScript typecheck.
- **Entrypoint:** `src/index.ts`.

Primary components:

- `src/bot/`: Telegram command and inline-menu UX.
- `src/monitor/`: polling worker for incoming transfers.
- `src/tron/`: TRON/TronScan client and address handling.
- `src/parser/`: normalized TRC20 transfer parsing.
- `src/risk/`: deterministic risk evaluation.
- `src/approvals/`: Approval Guard, contract intelligence, drain observations, session context, recheck.
- `src/wallet/`: dashboard and wallet metrics.
- `src/alerts/`: alert formatting, keyboards, and admin delivery.
- `src/storage/`: PostgreSQL repositories.
- `scripts/`: database migration and safety recheck commands.

## Environment And Commands

Setup:

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npm run db:migrate
npm run dev
```

Verification:

```bash
npm run typecheck
npm test
```

Notes:

- `.env` is intentionally gitignored.
- `TRONSCAN_API_KEY` is optional for local testing but expected for production reliability.
- `TRON_FULLNODE_BASE_URL` is required for raw transaction/signing metadata when Approval Guard needs it.

## Source Documents Ingested

- `README.md` — current product behavior, setup, UX, checklists, risk model, Approval Guard, alert routing.
- `PRODUCT-IDEA-BLOCKCHAIN-BOT.md` — original product vision and MVP/future roadmap.
- `FORENSIC-REPORT.md` — motivating approval-drain forensic notes.
- `docs/research/2026-05-20-risk-signals-research.md` — risk-signal sources and build order.
- `docs/research/2026-05-21-risk-intelligence-brief.md` — target architecture and risk intelligence roadmap.
- `docs/research/2026-05-22-tlhv-wallet-forensic-case.md` — wallet forensic case and product signals.
- `docs/research/2026-05-23-drain-pattern-hypotheses.md` — approval drain false-positive/false-negative analysis.
- `docs/superpowers/specs/2026-05-20-tron-usdt-monitoring-bot-design.md` — initial product and technical design.
- `docs/superpowers/specs/2026-05-23-approval-session-context-design.md` — Phase 9.3 design.
- `docs/superpowers/plans/*.md` — historical implementation plans for shipped phases.

## Current Strategic Focus

The highest-value next work is improving **evidence-backed risk intelligence** without breaking the read-only trust model:

1. Import free/public source labels with provenance.
2. Add graph proximity v0 for hop-limited exposure without overclaiming.
3. Improve behavioral drain/collector heuristics with transparent evidence.
4. Package incident evidence for users/admins.
5. Later, add B2B API/webhooks and multi-chain support.
