---
status: current
last_verified: 2026-07-28
owner_area: scoring
code_refs:
  - src/index.ts
  - src/risk/scoringSignalMatrix.ts
  - src/risk/scoreAnchorV2.ts
  - src/risk/scoringSignalMatrixV4.ts
  - src/risk/scoringPolicyV4.generated.ts
  - src/risk/scoreAnchorV3.ts
  - src/unifiedCheck/canonicalFacts.ts
  - src/unifiedCheck/comparator.ts
---

# Risk Scoring Matrix

## Core Rule

Score is a deterministic consequence of evidence, role, timing, and policy.
Wallet-safety warnings are not AML evidence. Coverage and an unknown label are
not risk signals.

## Production Truth

Production uses split scoring paths. A new Unified address `/check` uses
matrix v4 and `ScoreAnchorV3` at parent completion. Independent legacy jobs and
their saved results retain their existing matrix/anchor versions. Historical
scores are not recalculated and no newer anchor is synthesized for them.

## Unified Scoring

Fresh Unified runs use `scoring-signal-matrix-v4` and one `ScoreAnchorV3`.
The anchor binds canonical fact hashes, the locked Golden manifest,
policy/config versions, analysis manifest, and final report.

Every `COMPLETED` run has an explicit candidate, including
`clean_or_operational`, `unknown_without_risk_pattern`, and
`no_usdt_activity`. Unknown addresses alone add zero. Coverage has no row,
floor, penalty, dampener, or publication gate; `limited_coverage_floor` is not
part of matrix v4.

Facts are deduplicated by chain/event identity and semantic role before
classification. One fact contributes through one selected scoring role. Hard
floors are not diluted by safe exchange volume. Direct/indirect evidence,
victim/drainer/recipient role, and frozen-at-transfer/later-frozen timing remain
different signals. Unknown behavior becomes suspicious only through confirmed
combinations such as fan-in, rapid outflow, and concentration.

The locked Golden V2 blind review selected proportional attribution. Exact
scores, relations, duplicate/reorder/coverage invariance, deterministic replay,
and RU/EN presentation expectations are fixed only by adjudicated artifacts
and the production comparator.

Matrix v4 is implemented and tested for Unified runs. Historical legacy
results are not recalculated.
