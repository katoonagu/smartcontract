# Risk, Confidence, Coverage, And Evidence Clarity Design

## Problem Statement

The external ChatGPT Pro review and our own follow-up reached the same conclusion: the current system is already a useful forensic decision-support product, but one number now carries too many meanings.

Today a displayed risk score can mix:

- observed risk severity;
- confidence in the conclusion;
- provider/data coverage;
- strength of evidence;
- source attribution quality;
- customer/business policy.

That makes the product harder to trust. A `70/100` can mean hard evidence, strong contextual risk, a policy floor, partial source coverage, or a conservative decline policy. Those cases should not look identical internally, even if the final user-facing product still shows one score.

This design adds a trust-and-clarity layer around the existing scoring system. It does not replace the current engines. The product direction is one final user-facing risk score plus a clear explanation. Internal diagnostic metrics support that final score; they should not become a confusing bundle of public scores.

## Goals

- Keep one user-facing final risk score and decision.
- Make coverage, confidence, evidence strength, and policy decision explicit as diagnostics behind that final score.
- Prevent `completed` jobs from looking like fully covered jobs when checks were missing or partial.
- Make graph views clearly read as evidence navigation/projection, not proof by themselves.
- Make Where is money and Incoming deposit wording probabilistic unless the path is direct, amount-preserving, and high coverage.
- Give future calibration work a stable place to attach metrics without rewriting all scoring engines now.

## Non-Goals

- Do not rewrite DeepCheck traversal.
- Do not rewrite Where is money path search.
- Do not rewrite Incoming deposit source tracing.
- Do not replace floors, caps, or dampening.
- Do not introduce Bayesian scoring into production decisions.
- Do not add ML or automated calibration.
- Do not build a new graph renderer.
- Do not change provider integrations.

## Target Model

Every check result should be explainable through five separate concepts.

```text
execution_status = did the job run successfully?
coverage_status  = how complete is the data/evidence?
final_risk_score = the single user-facing score after current rules/policy combine the relevant mode outputs
evidence_strength = how strong the supporting facts are?
decision_status  = what the product policy recommends doing?
```

`confidence_score`, `coverage_score`, and `evidence_strength` are diagnostic factors. They explain the final score and help us calibrate later. They are not separate product verdicts.

```text
confidence_score = how reliable the conclusion appears, given available evidence
```

The first implementation may use heuristic values. That is acceptable if the UI and docs say these are explainability/debug metrics, not measured probabilities.

Public-facing default:

```text
Final Risk: 72/100 — HIGH
Decision: REVIEW or DECLINE
Why: reasons, hard-evidence status, coverage limitation, what was and was not found
```

Developer/admin diagnostic view:

```text
Coverage: partial
Confidence: 56
Evidence: contextual
Policy: wallet-risk-v1
```

## Status Semantics

### Execution Status

`execution_status` describes job lifecycle only:

- `queued`: job is waiting.
- `running`: job is actively processing.
- `completed`: job execution finished successfully.
- `failed`: job execution failed.

`completed` must not mean "all data was available".

### Coverage Status

`coverage_status` describes evidence completeness:

- `complete`: no known coverage warnings or missing checks that materially limit interpretation.
- `partial`: job produced useful evidence, but some intended checks, branches, providers, or enrichment were partial.
- `limited`: job has meaningful evidence but major coverage limits, sparse history, service boundary stops, provider caps, or legacy missing coverage metadata.
- `insufficient`: evidence is too incomplete for a normal acceptable/decline decision without manual review.

The exact first-version mapping can be conservative:

```text
if missingChecks.length > 0 => partial
if coverage.partial === true => partial
if fetchedAddressCount <= 1 where broader tracing was expected => limited
if provider aborted or route data is too sparse for the mode => limited or insufficient
```

### Decision Status

`decision_status` is policy output, not a pure fact:

- `acceptable`: no material risk was found under current policy and coverage.
- `review`: analyst/user should inspect the evidence.
- `decline`: current policy says do not accept this address/deposit.
- `insufficient_coverage`: not enough data to issue a normal decision.
- `manual_required`: automated checks found ambiguity that requires human review.

The first implementation may continue to expose existing `ACCEPTABLE`, `REVIEW`, `DECLINE` internally. New statuses can be added as display/policy wrappers before changing storage enums.

## Score Explanation Semantics

### Risk Score

`final_risk_score` remains the single externally understandable score. In the first implementation it can be the existing score from the relevant engine or unified wallet risk result.

Required copy:

```text
final risk score is a rule/policy severity score, not a probability.
```

The final score should be accompanied by a compact explanation, not by a wall of internal metrics.

### Coverage Score

`coverage_score` is a 0-100 summary of how complete the data appears.

First-version heuristic:

- `100`: complete.
- `70`: partial.
- `45`: limited.
- `20`: insufficient.

If a mode already has richer coverage fields, use those fields to refine the number without blocking the first rollout.

### Evidence Strength

`evidence_strength` is a 0-100 summary of how strong the supporting evidence is.

Suggested first-version bands:

- `90-100`: exact hard evidence, direct blacklist, exact drain/proven path, exact high-risk label.
- `70-89`: strong amount-linked path or strong source policy evidence.
- `45-69`: contextual graph/service/source exposure with material volume.
- `20-44`: weak context, low materiality, inferred relation, generic service exposure.
- `0-19`: no material supporting evidence.

This should be derived from existing reason/evidence metadata where available. It should not try to invent evidence.

### Confidence Score

`confidence_score` should combine coverage and evidence quality.

First-version heuristic:

```text
confidence_score = round(coverage_score * evidence_strength_multiplier)
```

Where:

- hard evidence multiplier: `1.0`;
- strong linked evidence multiplier: `0.85`;
- contextual evidence multiplier: `0.65`;
- weak/inferred evidence multiplier: `0.45`;
- no material evidence multiplier: `0.35`.

Clamp to `0-100`.

This is intentionally simple. It creates a consistent display metric without pretending to be a calibrated probability.

### Hard Evidence Note

If `final_risk_score >= 60` but there is no hard evidence, the UI should say:

```text
High contextual risk; no hard evidence observed.
```

This is one of the highest-value trust improvements.

### Policy Version

Displayed decisions should carry a `policy_version` string.

First version can be static:

```text
wallet-risk-v1
incoming-deposit-risk-v1
where-is-money-v1
approval-risk-v1
```

This prepares the system for future calibration and audit comparisons.

## Admin UX Requirements

The admin console should show the new clarity layer near the case brief and decision area.

For every completed or partial job view, show:

- job execution status;
- coverage status;
- final risk score and band;
- confidence score;
- evidence strength;
- decision status;
- policy version;
- short limitation note if coverage is partial/limited/insufficient.

Example:

```text
Final Risk: 72 / HIGH
Decision: DECLINE
Coverage: partial
Confidence: 56
Evidence: contextual
Policy: wallet-risk-v1
Note: High contextual risk; no hard evidence observed.
```

Admin must not hide partial coverage behind a green `completed` badge.

Recommended display:

```text
COMPLETED · COVERAGE PARTIAL
```

instead of only:

```text
COMPLETED
```

## Telegram UX Requirements

Telegram should stay short.

The long-term user-facing Telegram message should show one final risk score, one decision, and a short explanation. The bot should not become an analyst dashboard.

During beta, Telegram may temporarily include diagnostic fields for developers and operators:

```text
Beta diagnostics: coverage partial · confidence 56 · evidence contextual
```

These diagnostics must be visually separated from the final user result and easy to remove later.

Required Telegram behavior:

- If coverage is complete, do not add extra noise.
- If coverage is partial/limited, include one clear sentence.
- If high contextual risk has no hard evidence, say that briefly.
- If decision is acceptable under limited coverage, avoid language that sounds like "clean".
- If beta diagnostics are enabled, label them as beta/internal diagnostics.

Example Russian copy:

```text
Финальный риск: HIGH 72/100.
Данные: частичные.
Важно: это контекстный риск, прямого hard evidence не найдено.

Beta diagnostics: coverage partial · confidence 56 · evidence contextual.
```

For acceptable results with partial data:

```text
Материальный риск не найден, но данные частичные. Это не гарантия чистоты.
```

## Graph Semantics Requirements

Graph views must be described as projection/navigation, not proof.

Required rule:

```text
Graph evidence can support investigation. It is not the source of truth for risk by itself.
```

### Threshold Alignment

Current graph projection thresholds should either:

1. match unified risk thresholds; or
2. be explicitly labeled as projection-only thresholds.

Recommended first step: align graph summary thresholds with unified thresholds unless a specific graph-only reason exists.

Unified wallet thresholds:

```text
CRITICAL >= 85
HIGH     >= 60
MEDIUM   >= 30
LOW      < 30
```

Where/Incoming may keep `LOW-MEDIUM` if already part of those engines, but graph summaries should not silently use `>=65` / `>=35` while unified wallet risk uses `>=60` / `>=30`.

### Edge/Node Meaning

The graph should visually separate:

- direct evidence;
- inferred/contextual edge;
- service/boundary stop;
- peer link;
- collapsed group/bundle.

This design does not require a new layout. It requires the legend, labels, and details panel to stop implying all lines mean the same thing.

## Where Is Money And Incoming Deposit Wording

Replace overly certain wording.

Avoid:

```text
Money came from X
Source proven
Clean source reached
Dirty source reached
```

Prefer:

```text
Source candidate
Probable source
Observed source path
Boundary reached
Coverage limited
Amount-linked path
Context exposure
```

Use stronger language only when all are true:

- direct or short path;
- amount-preserving or amount-linked;
- high coverage;
- exact evidence or exact label;
- no competing material source candidate.

Otherwise, show uncertainty.

## Mode-Specific Requirements

### FastCheck

FastCheck remains bounded. It should expose:

- direct neighborhood summary;
- top incoming/outgoing;
- top services;
- labels/restrictions;
- missing checks/coverage;
- clarity summary.

It should not become a hidden DeepCheck.

### DeepCheck

DeepCheck should separate:

- direct hard evidence;
- profile/context graph;
- multi-hop context;
- service exposure;
- missing coverage.

If DeepCheck analyzed multiple steps, admin can show that context. But Telegram should not over-explain it.

### Where Is Money

Where is money should show:

- source candidates;
- amount share;
- path strength;
- coverage status;
- boundary/unknown mass where available.

It should not imply absolute proof of current balance origin unless evidence is direct and high-confidence.

### Incoming Deposit

Incoming deposit should show:

- deposit tx;
- sender;
- predecessor/source candidates;
- amount preservation;
- time gaps;
- boundary stops;
- source vs sender-background separation.

Sender background risk must not be presented as deposit source proof.

### Approval Checks

Approval checks should show:

- spender;
- allowance amount;
- spender risk;
- token;
- known drain/transferFrom evidence if any;
- action limitation.

Required copy:

```text
The system can warn. It cannot revoke or sign transactions for the user.
```

## Data Contract Requirements

The first implementation can add an explainability wrapper without changing every engine result.

Suggested shape:

```ts
type RiskClaritySummary = {
  executionStatus: "queued" | "running" | "completed" | "failed";
  coverageStatus: "complete" | "partial" | "limited" | "insufficient";
  decisionStatus: "acceptable" | "review" | "decline" | "insufficient_coverage" | "manual_required";
  finalRiskScore: number | null;
  riskLevel: string | null;
  confidenceScore: number | null;
  coverageScore: number | null;
  evidenceStrength: number | null;
  evidenceClass: "hard" | "strong_linked" | "contextual" | "weak" | "none" | "unknown";
  policyVersion: string;
  hardEvidenceObserved: boolean;
  betaDiagnosticsVisible: boolean;
  limitations: string[];
  displayNotes: string[];
};
```

The exact TypeScript names can follow existing project style during implementation. The concepts should stay stable.

## Error Handling

If the clarity wrapper cannot derive a field, it should degrade to `unknown`/`null` and add a limitation note. It must not throw away the underlying job result.

Examples:

- Missing legacy `coverageDebug`: set `coverageStatus = "limited"` and add `Legacy job has no coverage debug object`.
- Missing risk score: set score fields to `null` and decision to `manual_required`.
- Malformed result JSON: admin should show projection error as it does today.

## Testing Requirements

Add focused tests for:

- completed Deep job with `missingChecks` surfaces partial/limited coverage in admin clarity summary;
- completed Where job with `coverage.partial = true` surfaces partial coverage;
- graph projection thresholds match unified wallet thresholds or explicitly declare projection-only semantics;
- high contextual risk without hard evidence shows `no hard evidence observed`;
- acceptable result with partial coverage does not display as clean/guaranteed;
- Telegram summary includes partial/limited data warning when coverage is not complete;
- Telegram beta diagnostics, when enabled, are labeled as beta/internal and separated from the final risk result;
- Where/Incoming copy uses source-candidate language for inferred paths;
- approval copy says warning-only, no automatic revoke.

## Rollout Plan

### Phase 1: Clarity Wrapper

Create the shared summary model and derive it for existing job results.

### Phase 2: Admin Display

Show clarity summary in the case brief/details panel.

### Phase 3: Telegram Copy

Add short coverage and hard-evidence notes without overloading messages.

If beta diagnostics are enabled, show them as a clearly labeled internal/debug block. The implementation should make that block easy to hide in the future.

### Phase 4: Graph Threshold/Legend Cleanup

Align thresholds or label projection-only semantics. Add graph-as-navigation copy.

### Phase 5: Documentation Update

Update walkthrough docs to explain:

- risk score is not probability;
- final risk score is the public result;
- confidence/coverage/evidence are internal diagnostic factors;
- decision is policy-dependent;
- source attribution can be probabilistic.

## Success Criteria

- An analyst can tell whether a job is technically completed but coverage-limited.
- High contextual risk cannot be mistaken for direct hard evidence.
- `acceptable` cannot be mistaken for "guaranteed clean" when coverage is partial.
- Admin graph thresholds no longer contradict unified risk thresholds silently.
- Telegram warnings remain concise and keep one final score as the main result.
- Beta Telegram diagnostics are clearly labeled as internal/debug and can later be hidden without changing scoring logic.
- No existing DeepCheck, Where is money, Incoming deposit, or Approval engine behavior is rewritten in this phase.

## Future Work

After this layer is stable, the next specs can cover:

- source attribution probability;
- calibration dataset and analyst dispositions;
- shadow Bayesian scoring;
- floor/cap impact analysis;
- decision threshold tuning by customer policy.
