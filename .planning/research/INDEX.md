# Research Index And Synthesis

Generated: 2026-05-23T17:35:20+00:00

## Source Inventory

### Product And Forensic Context

- `PRODUCT-IDEA-BLOCKCHAIN-BOT.md`: original Address Guard Bot concept, target users, MVP/future scope, monetization, legal risks, technical feasibility sources.
- `FORENSIC-REPORT.md`: motivating TRON/BSC incident notes, unlimited approval root cause, drain transactions, cross-chain movement, mitigation notes.

### Research Notes

- `docs/research/2026-05-20-risk-signals-research.md`: internal labels, AML provider signals, graph proximity, behavioral patterns, incoming transfer context, recommended build order.
- `docs/research/2026-05-21-risk-intelligence-brief.md`: target architecture for ingestion, normalized events, intelligence DB, provider adapters, graph, behavior, bridge routes, approval safety, scoring, LLM explainer boundaries.
- `docs/research/2026-05-22-tlhv-wallet-forensic-case.md`: case-driven signals and how to store them in the product.
- `docs/research/2026-05-23-drain-pattern-hypotheses.md`: approval-drain detection policy, false-positive guards, public case evidence, and recommended next phase.

### Historical Plans And Specs

- `docs/superpowers/specs/2026-05-20-tron-usdt-monitoring-bot-design.md`: original MVP design.
- `docs/superpowers/plans/2026-05-20-tron-usdt-monitoring-bot.md`: Phase 1 implementation plan.
- `docs/superpowers/plans/2026-05-21-phase-2-bot-ux-wallet-dashboard.md`: Phase 2 plan.
- `docs/superpowers/plans/2026-05-21-phase-3-1-risk-observation-foundation.md`: Phase 3.1 plan.
- `docs/superpowers/plans/2026-05-22-phase-6-feesaver-style-telegram-ux-refresh.md`: Phase 6 plan.
- `docs/superpowers/plans/2026-05-23-phase-9-1-approval-drain-observation.md`: Phase 9.1 plan.
- `docs/superpowers/specs/2026-05-23-approval-session-context-design.md`: Phase 9.3 design.
- `docs/superpowers/plans/2026-05-23-phase-9-3-approval-session-context.md`: Phase 9.3 implementation plan.

## Synthesis

The research converges on one core principle: **risk claims must be evidence-backed, probabilistic, and explainable**. For this project, that means scoring should be a deterministic policy over stored observations rather than an opaque LLM/provider answer.

Most important product lessons:

1. Approval drain detection must distinguish malicious EOA/collector patterns from legitimate bridge/router/DEX `transferFrom` mechanics.
2. Provider metadata is useful identity evidence, but not final truth.
3. Public/free labels and internal labels are the natural next source layer before paid AML integrations.
4. Hop-based graph proximity is valuable but must avoid hub/service false positives.
5. The product's safest wedge remains TRON USDT dangerous approvals and high-risk incoming funds.
6. All future legal/compliance/contact workflows must be opt-in and auditable.

## Recommended Research-To-Build Order

1. Source-backed labels and free risk signals.
2. Graph proximity v0 using Hop1/Hop2 with hub/service dampening.
3. Behavioral pattern detectors using stored events and provider metadata.
4. Evidence pack generation.
5. B2B screening API/webhooks.
6. Multi-chain expansion.
7. Paid AML provider adapters.
