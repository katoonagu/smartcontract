# Requirements

Generated: 2026-05-23T17:35:20+00:00

## Scope Baseline

The active product is a TRON/TRC20 USDT read-only Telegram monitoring bot. Future product ideas are tracked separately and must not be presented as live functionality until implemented and verified.

## Functional Requirements

### User, Wallet, And Telegram UX

- **REQ-001 — Opt-in Telegram user registry:** The bot must register users only after they initiate interaction.
- **REQ-002 — Wallet management:** Users must be able to add, list, open, and remove watched TRON wallets.
- **REQ-003 — Address validation:** TRON addresses must be validated before storage or monitoring.
- **REQ-004 — Inline dashboard:** Users must have a compact inline dashboard showing monitoring status, last check/result, balances, wallet age, 30d flow, fees, risk intel, and safety status.
- **REQ-005 — Manual checks:** Users must be able to run `/check <address-or-tx-hash>` or equivalent inline flows without adding the address to monitoring.
- **REQ-006 — Help/profile/settings:** The Telegram UX must expose profile, settings, help, risk-intel, wallet, analytics, and safety views.

### Monitoring And Alerts

- **REQ-010 — Incoming USDT polling:** The worker must poll confirmed official TRC20 USDT transfers for watched wallets.
- **REQ-011 — Cursor safety:** Failed provider polls must not advance cursors.
- **REQ-012 — Alert modes:** Wallet owners must be able to choose `realtime`, `risk_only`, `digest`, or `paused` per wallet.
- **REQ-013 — Alert routing:** Alerts must route to wallet owners, optional customer alert admins, and service admins according to configured severity/mode rules.
- **REQ-014 — Digest behavior:** LOW events in digest mode must be grouped and not resent after `digest_sent_at` is set.
- **REQ-015 — Delivery isolation:** Customer/service-admin delivery failures must not block owner alert status.

### Risk Intelligence

- **REQ-020 — Deterministic scoring:** Risk scores must be deterministic and auditable.
- **REQ-021 — Evidence-first policy:** Every non-zero scoring reason should have a stored `risk_signal_observations` row and, when available, linked `raw_evidence`.
- **REQ-022 — Internal labels:** Service admins must be able to add labels that affect risk scoring.
- **REQ-023 — Honest module status:** UI copy must distinguish active, limited, planned, and not-connected risk modules.
- **REQ-024 — No unsupported accusations:** User-facing language must avoid declaring an address criminal/scam without source-backed evidence.

### Approval Guard And Wallet Safety

- **REQ-030 — Official USDT approvals:** The bot must detect confirmed TRC20 approvals for the official TRON USDT contract.
- **REQ-031 — Unlimited/large allowance detection:** Approval Guard must identify unlimited and large approvals.
- **REQ-032 — Read-only safety guidance:** Safety screens and alerts may link users to external review/revoke tools but must never sign or revoke.
- **REQ-033 — Spender identity:** Risk evaluation must use spender account type, contract metadata, provider tags, internal labels, and verification status.
- **REQ-034 — Service-tag dampening:** Verified service-tagged contracts may be dampened, while exact malicious labels or confirmed drain evidence must override dampening.
- **REQ-035 — Unknown EOA escalation:** Unlimited USDT approval to an unknown EOA/non-contract spender is high-risk and may become CRITICAL with confirmed drain or suspicious signing context.
- **REQ-036 — Contract intelligence profiles:** The bot must preserve provider metadata such as names, tags, verification, top-call/service activity, and raw evidence.
- **REQ-037 — Drain observation:** The bot must detect spender-initiated `transferFrom` from a watched wallet and score it with identity/receiver/timing context.
- **REQ-038 — Session context:** Approval evaluation must detect nearby swap/bridge route evidence and dampen unverified helper approvals when strong route evidence exists.
- **REQ-039 — Recheck:** Safety recheck must be idempotent and must not send owner/customer alerts unless a future phase explicitly enables that behavior.

### Storage, Operations, And Observability

- **REQ-050 — Migrations:** New persistent data changes must ship as ordered SQL migrations.
- **REQ-051 — Secret hygiene:** Logs, docs, tests, and errors must not print `BOT_TOKEN`, API keys, full `.env`, private keys, or seed phrases.
- **REQ-052 — Rate-limit resilience:** TronScan/API requests must support retry/backoff/cooldown and continue polling safely after transient failures.
- **REQ-053 — Type and test gates:** `npm run typecheck` and `npm test` must pass before claiming implementation complete.

## Non-Functional Requirements

- **NFR-001 — Read-only trust boundary:** The system must never become a wallet controller in the MVP.
- **NFR-002 — Privacy by design:** Telegram IDs and wallet addresses are sensitive and must be handled as opt-in user data.
- **NFR-003 — Auditability:** Risk decisions must be reproducible from stored observations and evidence.
- **NFR-004 — False-positive control:** Approval and AML-like signals must be composite; single weak signals must not trigger unsupported CRITICAL claims.
- **NFR-005 — Provider independence:** External AML/provider integrations must be adapters, not hard-coded scoring authorities.
- **NFR-006 — Graceful degradation:** If provider metadata or session context is unavailable, the bot should keep conservative risk and explain incomplete evidence.

## Explicit Non-Goals For Current MVP

- No private-key import.
- No seed phrase handling.
- No transaction signing.
- No automatic revoke.
- No full graph forensics claim.
- No commercial AML provider claim until integrated.
- No arbitrary address → Telegram user deanonymization.
- No BSC/EVM support until a dedicated phase adds it.
- No legal/police outreach workflow until consent, policy, and audit requirements are designed.

## Future Requirements Backlog

- **FUT-001 — Public/free source labels:** Import public risk reports, sanctions/free feeds where legally usable, Chainabuse-style reports, provider tags, and internal CSV/manual sources with provenance.
- **FUT-002 — Graph proximity v0:** Hop1/Hop2 exposure from watched wallets to risky addresses, with source and confidence.
- **FUT-003 — Behavioral detectors:** Fresh wallet, collector wallet, splitting/merging, bridge route, delayed drain, near-full-balance pull.
- **FUT-004 — Evidence pack:** Markdown/PDF/CSV incident exports for users, exchanges, lawyers, and AML teams.
- **FUT-005 — B2B API/webhooks:** Address screening endpoints for exchanges/OTC/P2P operators.
- **FUT-006 — Multi-chain:** BSC/EVM USDT/USDC, ERC20 approvals, Etherscan/BscScan API V2, and cross-chain bridge intelligence.
- **FUT-007 — Energy partner:** Optional TRON energy/bandwidth partner flow that does not require user private keys.
