---
status: current
last_verified: 2026-07-25
owner_area: forensics
code_refs:
  - src/forensics/moneyOriginTrace.ts
  - src/forensics/incomingDepositJob.ts
  - src/forensics/forensicCoverageV2.ts
  - src/forensics/recentFlowProvenanceSelection.ts
  - src/unifiedCheck/branchAdapters.ts
  - src/unifiedCheck/report.ts
  - src/unifiedCheck/presentation.ts
---

# Where Is Money And Incoming Deposit

## Questions

Where Is Money explains where the wallet sent funds. Incoming Deposit explains
where a selected received amount came from. They use related transfer evidence
but have different subjects, denominators, and directions.

## Production Truth

The deployed runtime still runs legacy Where/Incoming jobs and their existing
score-validity/coverage behavior. A technical coverage stop is not a clean
verdict. Unknown labels are not evidence of safety or risk by themselves.

## Implemented Release Candidate

Where and balance-origin analysis are evidence-only Unified children. They may
fetch and resume work but cannot send Telegram or choose the final score. Their
facts are normalized and deduplicated with Fast and Deep before scoring.

The report aggregates repeated direct transfers by service and direction,
showing amount, share, and transaction count. Direct incoming, direct outgoing,
and indirect paths remain semantically distinct. Confirmed CEX/DEX/bridge
labels are shown with their direction; unknown counterparties remain neutral
unless behavior supplies a separate risk pattern.

For a zero or very small current balance, the deterministic recent-funding
episode uses up to five latest relevant funding events, filters dust/spam, and
follows where those funds moved. There is no abrupt 1,000-USDT product switch.

Coverage remains a factual denominator, not a risk floor or publication gate.
`COMPLETED` requires traversal closure and produces one parent score.
Provider/execution failure remains `FAILED_TECHNICAL` without a partial report.

This contract is implemented and tested but not deployed. Production keeps the
legacy Where/Incoming path until schema 034 and the generation fence activate.
