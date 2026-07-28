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

Approval-drain authority is direct and subject-bound. A hop-zero exact approval
plus transferFrom profile can supply matrix hard evidence, while a
`route_linked` profile is review-only and a flat approval-proximity marker is
non-hard context. Reconstructing a separate Fast exact reason is stricter than
using the direct profile in the matrix: it also requires the matching retained
raw/profile/observation chain and its non-empty `rawEvidenceId` as the Fast
evidence reference.

Blacklist policy uses state at each transfer, not current state retroactively.
`became_active_after` and `unknown` timing create no hard candidate. A complete
`mixed` fact may contribute only its exact active subset after that subset
independently passes absolute or relative materiality; it scores 60 and carries
only active movement hashes plus the matching final verified event and current
state identity. Pre-activation and unknown-time amounts cannot increase its
materiality or evidence set.

Local sanctions time is tri-state: `active`, `inactive`, or `unknown`. Only an
active, consistently resolved registry service on an authoritative local path,
with evidence-ID overlap to the saved artifact, can create local sanctions hard
authority. Missing or invalid time, conflicting identity, and stale evidence
remain context. Separately typed cross-chain sanctioned-terminal evidence keeps
its own authority domain and is not synthesized from local registry IDs.

The locked Golden V2 blind review selected proportional attribution. Exact
scores, relations, duplicate/reorder/coverage invariance, deterministic replay,
and RU/EN presentation expectations are fixed only by adjudicated artifacts
and the production comparator.

Matrix v4 is implemented and tested for Unified runs. Historical legacy
results are not recalculated.
