# Scoring Calibration First Design

Date: 2026-06-26.

## Goal

Build the next scoring iteration without changing production verdicts blindly.

The system already has one user-facing final score and a risk-clarity layer that separates risk, coverage, confidence, evidence strength, and policy. The next step is to verify whether the current scoring policy is fair on real saved jobs, then add source-attribution and coverage states where the current model is too confident.

This design keeps the current production score as the baseline until audit reports show which rules should change.

## Non-Goals

This phase does not:

- replace the unified wallet risk engine;
- change `>=60 DECLINE` or `>=85 CRITICAL` thresholds immediately;
- add a machine-learning classifier;
- claim that risk score is probability;
- show multiple competing scores to the final Telegram user;
- rewrite FastCheck, DeepCheck, Where is money, Incoming deposit, or the graph UI.

## Core Product Principle

The user should see one final answer.

Operators and developers should see why that answer exists:

- what evidence exists;
- how complete the data is;
- how strong the source attribution is;
- which floor, cap, dampener, or policy rule influenced the result;
- where the current formula may be overconfident or underconfident.

## Current Problem

The current scoring model is useful, but it is still an expert-rule heuristic. It can produce a clean-looking number even when the underlying situation is more nuanced.

Important risky cases:

- high score under partial coverage;
- low score under incomplete coverage;
- `ACCEPTABLE` when the system did not have enough data;
- `DECLINE` caused by source-policy context without hard evidence;
- service, bridge, DEX, or CEX exposure that looks stronger than the real attribution;
- disagreement between FastCheck, DeepCheck, Where is money, and Incoming deposit.

## Recommended Approach

Use a calibration-first workflow.

1. Audit saved jobs with the current scorer.
2. Produce reports that show where the current model is questionable.
3. Add source-attribution probability-like metrics for Where is money and Incoming deposit.
4. Add first-class coverage decision states such as `INSUFFICIENT_COVERAGE`.
5. Add shadow scoring that computes a candidate result next to the current result.
6. Only after reviewing calibration reports, adjust thresholds, floors, dampeners, or policy defaults.

## Key Concepts

### Risk Score

The risk score remains a severity and policy score. It is not a probability.

Example:

```text
risk_score = 70
```

means:

```text
current policy considers this case high enough to decline or review
```

It does not mean:

```text
70% probability of illicit funds
```

### Coverage Status

Coverage answers: "Did we have enough data to support the decision?"

Recommended states:

- `complete`: expected checks completed and enough evidence was collected;
- `partial`: useful result exists, but some checks or providers were incomplete;
- `limited`: too little path/source coverage to treat the result as strong;
- `insufficient`: not enough data for a confident accept/decline decision.

### Evidence Strength

Evidence strength answers: "How factual is the signal?"

Recommended classes:

- `hard`: exact blacklist, exact risky label, exact approval-drain, exact high-risk path;
- `strong_linked`: amount-linked source path, strong continuity, high source share;
- `contextual`: service exposure, historical behavior, peer links, weak clusters;
- `weak`: low-confidence hints or incomplete context;
- `none`: no material evidence found;
- `unknown`: insufficient data to classify.

### Source Attribution Probability-Like Metrics

For Where is money and Incoming deposit, the system should explain source attribution separately from risk.

This is not a legal probability. It is a transparent heuristic confidence for the visible source path.

Useful fields:

```text
explained_amount_share
unknown_amount_share
top_source_candidate
top_source_share
path_strength
source_confidence
attribution_basis
boundary_reason
```

Example:

```text
explained_amount_share: 82%
unknown_amount_share: 18%
top_source_candidate: Binance
top_source_share: 68%
path_strength: strong
source_confidence: 74
attribution_basis: amount + time + path continuity
```

## Phase 1: Scoring Audit Report

Add a read-only audit tool that processes saved forensic jobs and produces JSON and Markdown reports.

The report should not alter job results.

For each job, extract:

- job id, kind, subject, status;
- final score, level, decision;
- coverage status and missing checks;
- hard evidence yes/no;
- evidence class;
- active floor;
- active dampener;
- active cap;
- active policy version;
- Fast, Deep, Where, Incoming scores if available;
- graph/result limitations.

The report should highlight cohorts:

- `high_score_partial_coverage`: score `>=60` with partial/limited/insufficient coverage;
- `low_score_incomplete_coverage`: score `<30` with partial/limited/insufficient coverage;
- `acceptable_limited_coverage`: `ACCEPTABLE` with limited or insufficient coverage;
- `decline_without_hard_evidence`: `DECLINE` where evidence is contextual or policy-only;
- `conflicting_layers`: one mode declines while final unified decision accepts, or the reverse;
- `hard_evidence_cases`: exact hard evidence and the floor it activated;
- `policy_floor_cases`: source-policy floors and their source shares;
- `dampener_cases`: large dampener impact on final score.

Success criteria:

- operators can see which rules most often drive decisions;
- questionable decisions are grouped for manual review;
- no production behavior changes.

## Phase 2: Source Attribution Metrics

Add a shared source-attribution summary for Where is money and Incoming deposit results.

The summary should be computed from already available path fields where possible:

- amount continuity;
- selected amount share;
- path hops;
- time gaps;
- source classification;
- service/boundary stop;
- missing checks;
- unknown/unexplained amount.

Recommended scoring shape:

```text
path_strength = amount_continuity + time_quality + hop_quality + source_reliability - boundary_penalty
source_confidence = clamp(path_strength * coverage_factor)
unknown_amount_share = 1 - explained_amount_share
```

This should remain explainable, not ML-driven.

The admin console should show this in analytics/details. Telegram can mention it only when needed, in plain language.

Example Telegram wording:

```text
Funds are partially explained: about 68% is linked to a Binance path; 18% remains unknown.
```

## Phase 3: First-Class Coverage Decisions

Add a decision state for insufficient evidence.

Recommended public/internal states:

- `ACCEPTABLE`: no material risk found with enough coverage;
- `REVIEW`: context or uncertainty needs manual review;
- `DECLINE`: policy or hard evidence says reject;
- `INSUFFICIENT_COVERAGE`: not enough data to call it clean or risky;
- `MANUAL_REQUIRED`: malformed, failed, or unsupported case.

Important distinction:

`INSUFFICIENT_COVERAGE` is not a risk accusation. It means the system cannot responsibly say `ACCEPTABLE`.

Initial rule examples:

- if final score `<30` but coverage is `insufficient`, decision becomes `INSUFFICIENT_COVERAGE`;
- if score `>=60` but evidence is contextual and coverage is partial, admin flags `DECLINE_WITH_LIMITED_EVIDENCE`;
- if hard evidence exists, hard evidence still wins.

This phase may affect product wording before it affects exchange-style decline logic.

## Phase 4: Shadow Scoring

Add a candidate scorer that runs next to the current scorer.

It should return:

```text
current_score
current_decision
candidate_score
candidate_decision
delta
delta_reasons
candidate_policy_version
```

The candidate scorer should be visible in admin only.

It should not change final Telegram user decisions until calibration confirms it improves quality.

Shadow scoring can test:

- stricter insufficient-coverage handling;
- different review/decline thresholds;
- lower source-policy floors for weak attribution;
- stronger floors for exact source attribution;
- different dampener ceilings;
- separate customer policy profiles.

## Phase 5: Calibration Dataset

Create a small calibration dataset from saved jobs.

Target size:

- first pass: 30-50 jobs;
- second pass: 100-200 jobs;
- later: 200-500 jobs if analyst review is available.

Each case should have a manual disposition:

- `correct_accept`;
- `correct_review`;
- `correct_decline`;
- `false_positive`;
- `false_negative`;
- `insufficient_data`;
- `needs_more_investigation`.

The dataset does not need perfect labels at first. It only needs enough structure to find obvious policy mistakes.

## Phase 6: Threshold And Rule Review

Only after audit and calibration, review:

- `>=60 DECLINE`;
- `>=85 CRITICAL`;
- no-hard-evidence cap at `84`;
- coverage floors;
- source-policy floors;
- historical transit pattern floor;
- dampener max `25`;
- layer weights Fast `10%`, Deep `60%`, Where `30%`;
- whether customer-specific policy profiles are needed.

Expected output:

- keep rule unchanged;
- lower/raise threshold;
- move rule from decline to review;
- require stronger source attribution before applying floor;
- make rule customer-configurable.

## Admin UX

Admin should expose this as an analyst tool, not as another public verdict.

Recommended views:

1. `Scoring audit` report list.
2. Per-job current vs candidate scoring panel.
3. Cohort filters:
   - high score + partial coverage;
   - low score + incomplete coverage;
   - decline without hard evidence;
   - source-policy only;
   - hard evidence;
   - rule disagreement.
4. Export JSON/Markdown for review.

## Telegram UX

Telegram should remain simple.

Do show:

- one final risk;
- decision;
- short explanation;
- coverage warning when needed.

Do not show:

- shadow score;
- internal cohorts;
- raw formula details;
- multiple competing final decisions.

During beta, developer diagnostics may remain behind the existing beta flag.

## Data Flow

```text
saved forensic jobs
  -> audit extractor
  -> normalized scoring audit rows
  -> cohort report
  -> optional manual disposition
  -> shadow scorer comparison
  -> calibration report
  -> policy decision on whether to change production scoring
```

For source attribution:

```text
Where/Incoming paths
  -> amount/time/hop/source/boundary factors
  -> attribution summary
  -> admin details
  -> optional Telegram wording
```

## Error Handling

The audit tool should be tolerant of legacy jobs.

If fields are missing:

- mark them as `unknown`;
- include the missing field in `limitations`;
- continue processing the rest of the dataset.

If a job has malformed JSON:

- skip scoring extraction for that job;
- include it in a `malformed_jobs` section;
- do not fail the full report unless strict mode is enabled.

If a candidate scorer cannot compute a result:

- keep the current score;
- mark candidate as unavailable;
- record the reason.

## Testing Strategy

Add focused tests for:

- audit extraction from Fast, Deep, Where, and Incoming jobs;
- cohort classification;
- source attribution summary with strong, weak, unknown, and boundary paths;
- insufficient coverage decision mapping;
- shadow scorer returning candidate output without changing current output;
- legacy/malformed job tolerance.

Use fixture-based tests rather than live provider calls.

## Success Criteria

This phase is successful when:

- saved jobs can be audited without provider calls;
- admin can show where current scoring is questionable;
- source attribution has explicit explained/unknown shares;
- `ACCEPTABLE` is not used when coverage is insufficient;
- candidate scoring can be compared without changing production decisions;
- final user-facing output still has one clear score and one clear decision.

## Rollout Order

1. Build read-only audit report.
2. Add source attribution summaries.
3. Add coverage decision mapping in admin/beta diagnostics.
4. Add shadow scorer.
5. Build calibration fixtures.
6. Review thresholds and policy rules.
7. Only then consider production scoring changes.

## Open Decisions Before Implementation Plan

The implementation plan should choose:

- whether audit reports are generated by CLI only or also from admin;
- where calibration labels are stored: JSON fixture first, database later;
- which first 30-50 jobs to include in calibration;
- whether `INSUFFICIENT_COVERAGE` affects Telegram immediately or only admin at first.

Recommended defaults:

- start with CLI + JSON/Markdown reports;
- store manual labels in versioned fixture files;
- expose `INSUFFICIENT_COVERAGE` in admin first;
- keep Telegram behavior conservative until we inspect real audit output.
