# Ingest Conflict Report

Generated: 2026-05-23T17:35:20+00:00

Result: no unresolved blockers. `.planning/` was generated.

## Auto-Resolved Decisions

- **Broad product vision vs current MVP:** `PRODUCT-IDEA-BLOCKCHAIN-BOT.md` describes Address Guard Bot across TRON, BSC/EVM, AML, graph forensics, evidence packs, B2B, and legal/compliance services. Current implementation is narrower: TRON/TRC20 USDT Telegram monitoring and Approval Guard. Resolution: current code/README define live scope; broader vision goes to roadmap/backlog.
- **"Online police" framing vs legal/privacy-safe product:** The audio-derived idea includes proactive warnings and Telegram/address association. The same document already includes legal correction: only opt-in users and consent-backed flows. Resolution: planning files encode opt-in, privacy, and no-deanonymization as hard constraints.
- **AML/graph claims vs limited beta risk intelligence:** Product docs discuss AML providers and graph proximity, but README marks these as not connected/planned. Resolution: active product copy must say limited/planned until implemented.
- **Approvals as scam signal vs legitimate router/bridge behavior:** Research shows `transferFrom` and unlimited approvals can be legitimate for services. Resolution: Approval Guard must use composite evidence, provider metadata, route/session context, and conservative wording.
- **Service name keywords vs trusted service evidence:** Names like `SwapTRX`/`tokenApprove` are not sufficient trust evidence. Resolution: provider service tags, verified/source evidence, internal labels, and behavior are required.

## Competing Variants Kept As Backlog

- Individual-user free/pro subscription vs B2B exchange/OTC workflow.
- Telegram-only UX vs future web/API/webhook surface.
- TRON-only MVP vs BSC/EVM/multi-chain expansion.
- Markdown evidence export first vs PDF/CSV/case-management suite.
- Manual/internal labels first vs paid AML provider integration.

## Unresolved Blockers

None for initialization.

Future phases must resolve their own source licensing, privacy, security, and product-copy questions before shipping.
