---
status: current
last_verified: 2026-07-03
owner_area: scoring
code_refs:
  - src/risk/unifiedWalletRisk.ts
  - src/forensics/moneyOriginOperationalAssessment.ts
  - src/forensics/moneyOriginPolicy.ts
supersedes:
  - docs/superpowers/specs/2026-07-01-scoring-signal-matrix-v1-design.md
  - docs/project-walkthrough/07-unified-wallet-risk-plain-language.md
  - docs/project-walkthrough/12-risk-logic-operational-rules.md
---

# Risk Scoring Matrix

## Core Rule

The score must reflect evidence strength.

Hard evidence can drive a strong decision. Weak context should remain bounded.
Incomplete coverage must not be treated as clean and must not be silently
converted into a final decline.

## Important Fields

`score_valid` tells whether the score can be used as a forensic result.

If `score_valid=false`, the result should include:

- `score_blocked_reason`;
- `technical_status`;
- supporting coverage/progress details.

## Floors

Floors protect strong signals from being diluted:

- hard evidence floor;
- policy floor;
- asset continuation floor;
- pattern floor.

These floors should be used only when their required evidence is actually
present.

## Dampener

Dampeners can reduce weak or contextual risk. They must not reduce hard
evidence or exact bad provenance.

## User-Facing Decisions

Possible user-facing outcomes:

- acceptable;
- review;
- decline;
- technical no-final-score state.

`REVIEW` internally must not accidentally map to a final user-facing `DECLINE`
when there is no hard evidence and coverage is incomplete.

## Current Direction

For `Where is money` and `Incoming deposit`, incomplete main-path coverage
blocks final scoring. The product should keep indexing where possible instead
of publishing a score on partial data.
