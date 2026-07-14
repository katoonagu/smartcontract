---
status: current
last_verified: 2026-07-14
owner_area: scoring
code_refs:
  - src/risk/fastEvidence.ts
  - src/risk/scoringSignalMatrix.ts
  - src/risk/scoringSignalMatrixInputs.ts
  - src/risk/scoreAnchorV2.ts
  - src/risk/usddPsmExposure.ts
  - src/risk/finalDisposition.ts
  - src/risk/unifiedWalletRisk.ts
  - src/risk/unifiedIncomingDepositRisk.ts
  - src/forensics/moneyOriginOperationalAssessment.ts
  - src/forensics/moneyOriginPolicy.ts
  - src/risk/riskSignalGroups.ts
  - src/approvals/approvalSafetyAssessment.ts
  - src/forensics/contractDecision.ts
  - src/monitor/addressPoisoningWorker.ts
  - tests/risk/fastEvidence.test.ts
  - tests/risk/scoringSignalMatrix.test.ts
  - tests/risk/finalDisposition.test.ts
  - tests/risk/unifiedWalletRisk.test.ts
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

A numeric score never creates hard proof. Proof authority comes from explicit
evidence code, evidence class, proof level, decision scope, subject, and
eligibility. A generic Fast score of 90 is context and produces at most
`REVIEW`; only allowlisted exact Fast evidence codes enter the hard-proof row.

## Wallet Safety Is Not AML

Address-poisoning evidence belongs to `signal_group=wallet_safety`. Every such
observation has `score_impact=0`; both the database constraint and repository
write guard reject a non-zero value. AML reads explicitly exclude this group,
and the runtime scoring type accepts only the allowlisted scoring groups:
`internal_label`, `provider`, `graph`, `behavior`, `incoming_context`,
`approval`, and `manual`.

A `HIGH` or `CRITICAL` poisoning classification controls the dedicated safety
warning only. It cannot change Fast, Deep, Where, Incoming, unified score,
decision, floor, or `shouldSend` result, even if a malformed stored fixture has
a non-zero wallet-safety value. Conversely, a low AML score does not dismiss an
active address-poisoning warning. Security action and AML disposition remain
separate outputs.

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

### Plan 2 Matrix V3 And Score Anchors

The Plan 2 branch marks fresh candidate results as `scoring-signal-matrix-v3`.
Every published numeric score has exactly one `ScoreAnchorV2`; a fresh result
without a valid anchor is `NO_FINAL_DECISION`, has no final score, and records
`score_anchor_fact_binding_failed`. Legacy v2/unversioned results remain legacy
and never receive a synthesized anchor.

Anchor validation is strict: score is an integer from 0 through 100 and mirrors
the publication; policy row, decision, evidence class, proof level, authority,
and coverage dependency match the registry; subject is a valid matching TRON
address and mode matches; every evidence ID resolves exactly once to the same
subject; and one preferred score fact resolves exactly once with the same mode,
subject, decisive evidence, and score-driver role. Context, coverage, and
limitation rows cannot publish `DECLINE`. Zero or multiple active anchors fail
closed.

Collector/transit behavior alone is bounded at `35 REVIEW`. It reaches
`55 REVIEW` only with a second non-clean, non-coverage AML signal whose non-empty
episode set is fully disjoint. Partial overlap, blank episode IDs, another
collector, or repeated collector evidence does not compose.

Exact USDD PSM exposure is bounded context with base `20`, share modifiers
`3/7/12/18/25` at the `<5%`, `<20%`, `<50%`, `<80%`, and `>=80%` tiers, half-up
Deep and outbound adjustments, and a standalone cap of `45 REVIEW`. It cannot
promote its own authority to `DECLINE`.

`ApprovalSafetyAssessmentV2` remains wallet-safety output and never enters AML
matrix inputs. For an exact Verify20 spender with a fresh official-USDT direct
allowance, unlimited is `90`, finite allowance at least 100 USDT is `75`, finite
allowance below 100 USDT is `45`, and confirmed zero is `0`. Failed, malformed,
reverted, timed-out, stale, or provider-failed reads are `UNKNOWN/null`; a saved
Approval event amount cannot stand in for current allowance.

These v3 semantics are implemented in the local release candidate only.
Production remains on the previous runtime until Plan 5.

### Previous-Runtime Matrix V2 Direct-Counterparty Policy

Previous-runtime fresh reports use `scoring-signal-matrix-v2`. The
highest-priority row is the checked subject's own restriction; the next row is
`direct_counterparty_policy`. That direct row accepts only a typed material
first-hop fact with `usdt_blacklist`, `official_contract`, and current
`statusAtCheck=active`. Service identity, contract/account type, internal label,
behavioral context, or an unverified event does not qualify.

Material principal means either at least 10,000 USDT, or at least 100 USDT and
1% of an exact complete directional denominator. With partial history the
relative branch is unavailable; the absolute branch can still qualify and
contributes exactly 60. With an exact share, the bound direct-profile
contribution is clamped to 60..90. Exact GasFree service fees are excluded from
principal, while principal transferred by a GasFree account or contract remains
eligible.

The row is independent policy with `can_decline` and no provenance coverage
dependency. A confirmed positive therefore yields a valid `DECLINE` while
unrelated coverage remains partial. If required first-hop checks are incomplete
and there is no independently applicable positive fact, the final outcome is
`NO_FINAL_DECISION`; missing checks cannot support a clean negative.

## Evidence Authority And Final Disposition

Matrix candidates carry their evidence class, proof level, decision subject,
decision eligibility, and coverage dependency. Merely placing a contextual row
in `hard_proof`, using a high score, or using hard-sounding text does not promote
it. Same-episode deduplication preserves an exact hard candidate over contextual
pattern candidates.

One canonical resolver produces the final Wallet and Incoming disposition:

- exact, subject-applicable hard proof with exact authority and no coverage
  dependency yields `DECLINE`, even when unrelated coverage is partial;
- the result remains `scoreValid=true` and retains `coverage=partial` and its
  caveats;
- invalid required coverage without applicable exact hard proof yields
  `NO_FINAL_DECISION`, `finalScore=null`, and `scoreValid=false`;
- the best bounded diagnostic remains available only as
  `observedContextScore`, not as a substituted final score;
- matrix `DECLINE`, `REVIEW`, and `ACCEPTABLE` map losslessly;
- matrix `INSUFFICIENT_EVIDENCE` maps to `NO_FINAL_DECISION`.

## Floors

Floors protect strong signals from being diluted:

- hard evidence floor;
- policy floor;
- asset continuation floor;
- pattern floor.

These floors should be used only when their required evidence is actually
present.

Sanctioned crypto-service exposure is a hard policy floor only after the
official designation date recorded for that service. The local sanctions
registry stores date-only official notices as UTC day starts. For example,
HTX/Huobi Global is treated as normal `htx_huobi` source-policy context before
2026-05-26, but as `sanctioned_service` for traced events on or after
2026-05-26. This prevents old historical exchange interaction from being
reinterpreted as current sanctions exposure.

Non-hard `bridge_router_dex` and `cross_chain_boundary` exposure is
amount-aware. If there is no hard evidence, sanctions, mixer, no-name liquidity,
exact approval-drain provenance, or exact bad provenance, affected selected
amount `<5k USDT` caps at 58, `5k-25k USDT` caps at 59, and
`25k-100k USDT` tapers up to 68 instead of jumping straight to the top of the
band. This is source-policy review context, not direct scam/drain proof.
Amounts `>100k USDT` or repeated material aggregate bridge/router/DEX exposure
can still reach 70+.

Wrapper-driven campaign context is not the same as exact approval-drain proof.
A broad Verify20 campaign can increase review pressure, but hard evidence
floors require exact approval/provenance profiles or another deterministic hard
evidence source. Plain canonical USDT transfers do not count as drainer-like
contract-driven evidence.
Repeated live cases have shown similar Verify20 wrapper contracts across
drainer-like flows. Treat that as strong drainer-campaign context for the
contract AI/case-file layer and manual review, not as a standalone 95/100 hard
floor unless exact approve -> transferFrom -> receiver provenance is present.

Exact approval-drain evidence is a critical hard floor at 95/100. This includes
`forensic_approval_drain_provenance` and the saved system
`approval_drain_proximity` label, because that label is created only after a
previous exact approve -> transferFrom -> receiver provenance path was found.
Behavior-only transit signals must not explain or dilute this score; they can
appear only as additional context beside the hard evidence.
Route-linked approval-drain pattern without exact proof remains review/context
evidence and must not inherit the 95/100 hard floor.

An exact Verify20 contract fingerprint is a separate deterministic pattern for
the checked contract subject. It requires the full approved four-selector set
and no trusted-service guard, yields `DECLINE` with floor 85, and does not by
itself prove a specific stolen transfer or make every interacting wallet a
drainer. A single selector, method name, or free-text/AI label is insufficient.
Exact approve -> transferFrom -> receiver provenance remains stronger at 95.

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

`REVIEW` must also not be hidden as user-facing `ACCEPTABLE` when the score is
medium source-policy context. The unified final decision preserves
`matrixDecision=REVIEW` as user-facing `REVIEW`; it must not flatten review-only
matrix rows to `ACCEPTABLE`. Low-score HTX/Huobi source-policy exposure now
stays user-facing `REVIEW`; simple score-derived alert display maps 45-59 to
`REVIEW`, 60+ to `DECLINE`, and below 45 to `ACCEPTABLE`.

For ordinary Where materiality caveats, `REVIEW` must also not collapse into
`ACCEPTABLE` just because the unified scoring matrix has only coverage
uncertainty. If `score_valid=true` and the Where result is
`residual_unresolved_below_materiality` or
`dense_hop_unresolved_below_materiality`, user-facing surfaces show the real
Where score and `REVIEW` decision. Dense-hop materiality is not a clean verdict:
the unresolved branch stays visible in Admin and Telegram and is excluded from
decisive clean or bad evidence.

Stored jobs without the exact v2 marker keep their saved score and decision.
Bot and Admin do not silently recalculate them under current policy; a fresh
run is required.

## Current Direction

For `Where is money` and `Incoming deposit`, incomplete required main-path
coverage blocks final scoring when no exact subject-applicable hard proof is
present. The product should keep indexing where possible instead of publishing
a score on partial data. An independent exact hard proof can still produce a
valid `DECLINE`; the unrelated coverage limitation remains explicit.

Exception for ordinary Where: low-materiality source-provenance caveats can be
scored when they are below their thresholds and have no hard evidence. This
includes residual unresolved source provenance and dense-hop provider-cap tails.
It does not make the unresolved branch exact or clean; it only prevents an
immaterial gap from blocking the whole report.
