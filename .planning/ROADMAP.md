# Roadmap

Generated: 2026-05-23T17:35:20+00:00

## Current Status Summary

The codebase is already beyond the original Phase 1 MVP. It includes the TRON USDT monitoring core, Telegram dashboard UX, evidence-first risk observations, alert routing/modes, Approval Guard, contract intelligence, drain observation, and approval session context. The next roadmap should build on that rather than restart from scaffold.

## Completed / Implemented Baseline

### Phase 1 — TRON USDT Monitoring Bot Foundation

Status: implemented.

Deliverables:

- TypeScript project and config.
- TRON address validation and input classification.
- PostgreSQL schema/repositories.
- TRC20 transfer parser.
- Basic risk engine and alert formatting.
- TronScan/TRON client adapter.
- Manual check service.
- Monitor worker.
- Telegram bot commands.

Verification references:

- `docs/superpowers/plans/2026-05-20-tron-usdt-monitoring-bot.md`
- `README.md` Phase 1 checklist
- Current tests under `tests/`

### Phase 2 — Bot UX + Wallet Dashboard

Status: implemented.

Deliverables:

- Inline Telegram UX.
- Wallet dashboard data aggregation and cache.
- Balance, wallet age, 30d flow, gas/fee metrics.
- Dashboard refresh/analytics/risk intel flows.

References:

- `docs/superpowers/plans/2026-05-21-phase-2-bot-ux-wallet-dashboard.md`
- `migrations/002_bot_ux_dashboard.sql`

### Phase 3.1 — Risk Observation Foundation

Status: implemented.

Deliverables:

- `raw_evidence` / `risk_signal_observations` storage model.
- Deterministic, evidence-backed risk evaluation.
- Manual check and incoming alert integration.
- Recent observation read model.

References:

- `docs/superpowers/plans/2026-05-21-phase-3-1-risk-observation-foundation.md`
- `migrations/003_risk_observation_foundation.sql`

### Phase 4 — Risk Intel Product Shell And Honest Copy

Status: implemented in product surface/docs.

Deliverables:

- User-facing copy that marks AML/graph/bridge/provider modules as not connected/planned where appropriate.
- Dashboard risk score labeled as limited beta.
- Help/risk-intel copy aligned with read-only constraints.

### Phase 5 — Customer Alert Admins

Status: implemented.

Deliverables:

- Customer alert admin storage/settings.
- Suspicious-only/all alert recipient modes.
- Owner delivery remains authoritative; customer delivery is best-effort.

References:

- `migrations/004_alert_settings.sql`

### Phase 6 — FeeSaver-Style Telegram UX Refresh

Status: implemented.

Deliverables:

- Compact bilingual utility-bot style screens.
- Profile/settings/wallet/help/risk-intel polish.
- Navigation/back/menu consistency.

References:

- `docs/superpowers/plans/2026-05-22-phase-6-feesaver-style-telegram-ux-refresh.md`

### Phase 7 — Wallet Alert Modes

Status: implemented.

Deliverables:

- `realtime`, `risk_only`, `digest`, `paused` per wallet.
- Digest and LOW-event spam control.
- TronScan rate-limit dashboard cache behavior.

References:

- `migrations/005_wallet_alert_modes.sql`

### Phase 8 — Approval Guard

Status: implemented.

Deliverables:

- Official TRON USDT approval monitoring.
- Approval storage/evidence.
- Unknown EOA, known service, risky label, trusted label, finite/unlimited policy.
- Safety dashboard and read-only revoke guidance.

References:

- `migrations/006_approval_guard.sql`
- `README.md` Approval Guard and Phase 8 checklist

### Phase 9.1 — Approval Drain Observation

Status: implemented/test-covered in current codebase.

Deliverables:

- Spender-initiated `transferFrom` observation.
- Composite scoring with spender/receiver/timing context.
- Avoid treating every `transferFrom` as scam proof.

References:

- `docs/superpowers/plans/2026-05-23-phase-9-1-approval-drain-observation.md`
- `docs/research/2026-05-23-drain-pattern-hypotheses.md`
- `src/approvals/drainObservation.ts`
- `migrations/008_approval_drain_observations.sql`

### Phase 9.2 — Contract Intelligence Profiles

Status: implemented/test-covered in current codebase.

Deliverables:

- Address/contract metadata profiles.
- Service tags, names, verification, account type, top-call/service activity.
- Use metadata as evidence, not final truth.

References:

- `src/approvals/contractIntelligence.ts`
- `migrations/007_address_metadata.sql`
- `migrations/009_contract_intelligence_profiles.sql`

### Phase 9.3 — Approval Session Context

Status: implemented/test-covered in current codebase.

Deliverables:

- Pure session context detector.
- Nearby route/transfer evidence fetch in Approval Guard flow.
- Dampening for service-linked helper approvals.
- Raw evidence and risk observations for session context.
- Better wording for route-linked helper approvals.

References:

- `docs/superpowers/specs/2026-05-23-approval-session-context-design.md`
- `docs/superpowers/plans/2026-05-23-phase-9-3-approval-session-context.md`
- `src/approvals/sessionContext.ts`
- `tests/approvals/sessionContext.test.ts`

## Recommended Next Phases

### Phase 10 — Source Labels And Free Signals

Goal: move beyond manual internal labels by importing source-backed public/free signals with provenance.

Deliverables:

- Label source model: source name, URL/reference, confidence, severity, fetched/imported timestamp, expiration/review status.
- Import path for curated public reports and local CSV/manual review.
- Admin command or script to add source-backed labels without editing DB by hand.
- Risk scoring uses source labels but keeps exact provenance visible in evidence.
- Safety copy distinguishes internal manual label vs public/provider source.

Verification:

- Unit tests for source precedence and expiration.
- Repository tests for label provenance storage.
- Manual check shows sourced label reason and does not overclaim.

### Phase 11 — Graph Proximity v0

Goal: detect hop-limited exposure to risky addresses without claiming certainty.

Deliverables:

- Store normalized address edges for watched wallet incoming/outgoing context.
- Compute Hop1/Hop2 exposure from watched wallets to labeled risky addresses.
- Separate direct exposure, route/service exposure, and weak shared-counterparty exposure.
- Dashboard/Risk intel copy explains confidence and source.

Verification:

- Fixtures from `docs/research/2026-05-22-tlhv-wallet-forensic-case.md`.
- False-positive tests for exchange/bridge/service hubs.

### Phase 12 — Behavioral Pattern Detectors v0

Goal: add transparent pattern signals for suspicious movement shapes.

Candidate signals:

- fresh wallet + large incoming/outgoing;
- collector wallet consolidation;
- split/merge behavior;
- near-full-balance pull after approval;
- delayed signed-to-chain approval context;
- bridge route vs collector route distinction.

Verification:

- Detector tests with positive and benign-service fixtures.
- Every score impact stores `risk_signal_observations` and raw evidence.

### Phase 13 — Evidence Pack Export

Goal: create incident exports for users/admins/legal/AML review.

Deliverables:

- Markdown export first; PDF/CSV later.
- Include timeline, tx hashes, addresses, labels, evidence sources, confidence, and caveats.
- No private/sensitive `.env` or bot secrets.

Verification:

- Snapshot tests for report content.
- Manual export from a known forensic fixture.

### Phase 14 — B2B Screening API/Webhooks

Goal: serve exchanges/OTC/P2P teams with address screening before receive/send workflows.

Deliverables:

- Authenticated API or webhook endpoint.
- Request/response schema with risk level, score, reasons, evidence links.
- Rate limits and audit logging.
- Organization/team model if needed.

Verification:

- API contract tests.
- Security/privacy review before production use.

### Phase 15 — BSC/EVM Expansion

Goal: add BSC/EVM support after TRON risk foundations are stable.

Deliverables:

- Ethers v6 provider adapter.
- ERC20 Transfer/Approval parser.
- Etherscan/BscScan API V2 fallback.
- Multi-chain wallet identity and dashboard model.
- EVM approval safety policy.

Verification:

- Chain-specific parser tests.
- Multi-chain dashboard tests.
- No regression to TRON-only behavior.
