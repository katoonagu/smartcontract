---
status: current
last_verified: 2026-07-05
owner_area: scoring
code_refs:
  - src/risk/unifiedWalletRisk.ts
  - src/forensics/moneyOriginOperationalAssessment.ts
  - src/forensics/moneyOriginPolicy.ts
  - tests/forensics/moneyOriginOperationalAssessment.test.ts
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

For ordinary Where source provenance, `sourceProvenanceMateriality` records
whether unresolved funding-source entries are material. Residual unresolved
source provenance uses current local thresholds of 1% and 100 USDT. Dense-hop
provider-cap tails use 1% per branch, 2% aggregate, and 10,000 USDT per branch.
Below-threshold unresolved source provenance with no hard evidence is a caveat
and can keep `score_valid=true`; above-threshold unresolved source provenance
or hard evidence remains a coverage blocker.

Dense-hop provider-capped unresolved source can also keep `score_valid=true`
only below its branch and aggregate thresholds and without hard evidence. This
is a score-valid caveat, not a clean verdict; Admin and Telegram keep it
visible, and scoring excludes it from decisive clean/bad evidence.

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

For ordinary Where materiality caveats, `REVIEW` must also not collapse into
`ACCEPTABLE` just because the unified scoring matrix has only coverage
uncertainty. If `score_valid=true` and the Where result is
`residual_unresolved_below_materiality` or
`dense_hop_unresolved_below_materiality`, user-facing surfaces show the real
Where score and `REVIEW` decision. Dense-hop materiality is not a clean verdict:
the unresolved branch stays visible in Admin and Telegram and is excluded from
decisive clean or bad evidence.

## Current Direction

For `Where is money` and `Incoming deposit`, incomplete main-path coverage
blocks final scoring. The product should keep indexing where possible instead
of publishing a score on partial data.

Exception for ordinary Where: low-materiality source-provenance caveats can be
scored when they are below their thresholds and have no hard evidence. This
includes residual unresolved source provenance and dense-hop provider-cap tails.
It does not make the unresolved branch exact or clean; it only prevents an
immaterial gap from blocking the whole report.
