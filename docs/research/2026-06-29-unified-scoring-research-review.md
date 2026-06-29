# Unified scoring research review, 2026-06-29

Purpose: document how the current Fast Check, Deep Check, balance-aware/Where layer, and Incoming Deposit scoring work today, then map the current design against AML/graph-scoring research and propose a smaller, more defensible scoring model.

Scope note: there is no separate code mode literally named `aware`. In this note I use `aware` for the balance-aware provenance layer implemented around `whereReport`, `where_is_money`, and `transaction_check` flows.

Companion numeric deep dive: `docs/research/2026-06-29-scoring-numeric-calibration-deep-research.md`.

## Executive summary

The current system is not just "Fast * 10% + Deep * 60% + Where * 30%". That weighted score exists, but the final score is also shaped by hard evidence floors, policy floors, asset-continuation floors, pattern floors, coverage floors, caps, and dampeners.

The weak part is still real: the final 0-100 score mixes different meanings:

- deterministic hard proof, such as blacklist or exact approval-drain provenance;
- policy/context decline, such as risky source boundary or exchange policy;
- behavioral patterns, such as historical transit;
- data-quality and coverage uncertainty;
- clean-source and operational-wallet dampening.

Those should not be treated as interchangeable percentages. Research on AML queues, graph AML, subgraph AML, fraud evidence fusion, and false-positive control points to the same direction: score the evidence matrix first, then derive the decision and queue rank. The final number should be a calibrated ranking/triage score, not a pseudo-probability unless we have labeled outcomes and calibration tests.

Recommended v3 direction:

1. Keep hard evidence floors/caps and the "no hard proof cap at 84".
2. Promote `sourcePolicy`, `hardProof`, `pattern`, `coverage`, `cleanSource`, and `dampener` into an explicit `riskVector`.
3. Demote the 10/60/30 weighted layer to a contextual baseline, not the core score.
4. Score wallet, incoming deposit, and source/path/subgraph as separate action units.
5. Add queue evaluation: precision/yield at review budget, burden decomposition, queue overlap, temporal backtest, and case fragmentation.
6. Use Bayesian/logit or Dempster-Shafer style evidence fusion only after evidence classes and source dependence are explicit.

## How the current system reasons

### Fast Check

Fast Check is the quick address-level screen.

Code path:

- `src/check/manualCheck.ts`
- `src/risk/riskEngine.ts`
- `src/risk/riskPolicy.ts`
- walkthrough: `docs/project-walkthrough/01-address-check-fast-check.md`

Inputs used for score-bearing risk:

- internal labels;
- graph signals;
- behavior signals;
- AML signals.

Context/evidence returned alongside the score:

- service exposure profiles;
- address behavior profiles;
- inbound provenance profiles;
- counterparty risk profiles;
- direct counterparty interaction profiles;
- stablecoin restriction profiles;
- boundary exposure profiles;
- wallet role profiles;
- extended provenance profiles;
- missing checks.

Current scoring mechanics:

- Critical local labels such as scam, reported scam, stolen funds, phishing, mixer-like, risky contract, and darknet exchange are high risk.
- Trusted/false-positive labels can reduce risk.
- External signals are sanitized by policy caps before they enter scoring.
- `calculatePolicyScoreBreakdown` buckets reasons into provenance, approval drain, behavior, service context, provider label, and dampener.
- Fast Check already has a primitive evidence matrix: exact self evidence can score much higher than provider labels or behavior-only context.

Interpretation:

Fast Check is good as a low-latency guard and hard-signal detector. It is not enough for clean-origin or path-level provenance because it mostly sees labels and precomputed signals, not the full source graph.

### Deep Check

Deep Check expands the forensic context around an address.

Code path:

- `src/check/deepForensicCheck.ts`
- `src/forensics/historicalTransitScore.ts`
- parts of `src/risk/unifiedWalletRisk.ts`

Profiles Deep can emit:

- service exposure;
- address behavior;
- inbound provenance;
- counterparty risk;
- direct counterparty interaction;
- approval-drain provenance;
- asset continuation;
- boundary exposure;
- operational flow;
- wallet role;
- extended provenance;
- coverage and coverage debug.

Current scoring mechanics in the unified scorer:

- Deep layer raw score is the max of many profile scores.
- Service exposure, deposit-then-drain, transit, operational flow, approval drain, asset continuation, inbound provenance, counterparty risk, wallet roles, extended provenance, and direct interactions can all become the Deep raw score.
- Some profiles are capped by evidence class. For example, asset continuation can floor risk but is capped below hard-evidence range when it is not direct proof.
- Historical transit pattern can create a pattern floor when volume, pass-through, and service share are strong enough.

Interpretation:

Deep Check is already closer to an evidence matrix than Fast Check. The problem is that many profile families collapse into one `deepLayerScore`, so the user sees a number but not the evidence type and confidence structure that produced it.

### Aware / Where Is Money

The aware layer is the balance-aware provenance and origin-path analysis.

Code path:

- `src/check/whereIsMoneyCheck.ts`
- `src/forensics/moneyOriginOperationalAssessment.ts`
- `src/forensics/provenanceScoring.ts`
- `src/risk/unifiedWalletRisk.ts`

What it tries to answer:

- Where did the current balance or checked funds come from?
- Which inbound paths form the selected amount?
- Is there hard bad evidence on origin paths?
- Is the decline based on source policy, insufficient coverage, LLM contract suspicion, or deterministic proof?
- Is the wallet likely clean CEX-funded, operational liquidity, risky source, or unknown?

Important current signals:

- selected inbound amount and coverage ratio;
- origin paths and source exposures;
- source exposure severity by kind;
- effective share and attributable share;
- hop/time/amount continuity;
- repetition and path context;
- data quality;
- hard evidence from fast risk, exact approval drain, risky label paths, and extra hard evidence;
- source-policy evidence and source-policy layers;
- operational liquidity score;
- provenance confidence;
- coverage completeness;
- wallet role;
- contract LLM suspicion, with guardrails.

Current scoring mechanics:

- `provenanceScoring.ts` already uses a matrix-like model: severity, share caps/floors, path context, repetition, age/data quality, wallet-role adjustment, proof level, and dampenability.
- `moneyOriginOperationalAssessment.ts` then maps evidence to decisions such as hard decline, source-policy decline, clean CEX-funded acceptable, operational-liquidity acceptable, safe-default decline, or unresolved fallback.
- Where score can mean very different things depending on branch. A `65` can mean insufficient coverage/safe default, not proven scam.

Interpretation:

Where is the most semantically rich layer. It should be the source of a structured risk vector, not just another 0-100 input to a 30% weighted blend.

### Incoming Deposit

Incoming Deposit is transaction/deposit scoped, not just sender-wallet scoped.

Code path:

- `src/forensics/incomingDepositJob.ts`
- `src/forensics/incomingDepositCashflow.ts`
- `src/risk/unifiedIncomingDepositRisk.ts`

Current flow:

- Start from the watched wallet, sender, transaction, amount, and timestamp.
- Check sender labels quickly.
- Inject stablecoin blacklist as a sender Fast risk if found.
- Select sender funding candidates before the deposit.
- Use funding coverage and continuity to seed `transaction_check` mode.
- Run Where-style provenance on the deposit amount.
- Call the unified forensic scorer with subject scope `incoming_deposit`.
- The final incoming deposit score is the unified final score for that deposit context.

Important current signals:

- deposit amount;
- sender current and historical edges;
- funding candidate coverage ratio;
- clean source coverage ratio;
- exact continuity coverage ratio;
- zero-balance sender handling;
- sender role inference;
- Where hard evidence and source-policy evidence;
- stablecoin blacklist.

Interpretation:

Incoming Deposit should remain separate from wallet score. A sender wallet can be operational or messy while a specific deposit has strong or weak provenance. Research on transaction-vs-actor AML queues strongly supports keeping these action units separate.

## Unified wallet score today

Code path: `src/risk/unifiedWalletRisk.ts`.

The unified scorer has three layers:

| Layer | Current weight |
| --- | ---: |
| Fast | 0.10 |
| Deep | 0.60 |
| Where | 0.30 |

The weights are normalized over available layers, so missing layers do not automatically zero the final score.

Then the score is modified by non-weighted mechanisms:

| Mechanism | Current role |
| --- | --- |
| Hard evidence floor | Direct proof can force high score and `DECLINE`; examples include USDT blacklist, exact approval drain, active blacklist, risky exact provenance. |
| Policy floor | Source-policy decline can create a floor around 70-84 without hard proof. |
| Asset continuation floor | Strong asset continuation can floor score, capped below hard-proof range. |
| Pattern floor | Historical transit, drain episode, and route-linked approval patterns can floor score, usually capped below hard proof. |
| Coverage floor | Limited coverage can floor at low/medium risk, currently around 30. |
| Dampener | Clean CEX/operational context and negative risk reasons can reduce contextual score but cannot erase floors. |
| No-hard cap | Without hard evidence, final score is capped at 84. |

Final bands:

| Score | Level |
| ---: | --- |
| 85+ | CRITICAL |
| 60-84 | HIGH |
| 30-59 | MEDIUM |
| 0-29 | LOW |

Decision:

- `DECLINE` for score >= 60;
- hard evidence at or above hard threshold forces `DECLINE`;
- otherwise `ACCEPTABLE`.

Important stale-doc note: older walkthrough text may imply that a Where `DECLINE` stays a final unified decline. The code currently derives final decision from final score and hard evidence, so a Where safe-default decline can be softened if the unified score lands below 60.

## Diagnosis

### What is already good

The system already has the right instincts:

- It separates hard evidence from contextual evidence.
- It caps weak evidence so context does not become fake proof.
- It keeps coverage and provenance confidence around the score.
- It treats stablecoin blacklist and exact approval-drain evidence as hard anchors.
- It has special handling for operational/liquidity wallets and clean CEX-funded wallets.
- Incoming Deposit uses transaction-scoped provenance rather than only sender reputation.
- `provenanceScoring.ts` already models share, continuity, source kind, proof level, and dampenability.

### What is weak

The top-level 10/60/30 blend is hard to defend empirically.

The same score range can mean different things:

- `65 HIGH` can mean source-policy decline.
- `65 HIGH` can also mean insufficient coverage safe default.
- `75 HIGH` can mean LLM/source-policy suspicion.
- `90+ CRITICAL` can mean deterministic hard evidence.

This is bad for product explanation and calibration. A user or analyst needs to know whether the decision is "proven bad", "policy decline", "not enough clean provenance", or "behavioral warning".

The current score is also not a probability. It is a policy/ranking score. That is fine, but the UI and docs should not imply probability unless we add calibration.

## Research corpus

| Source | Why it matters here | Practical takeaway |
| --- | --- | --- |
| Malik, 2026, [Do Transaction-Level and Actor-Level AML Queues Agree?](https://arxiv.org/abs/2604.23494) | Directly studies transaction vs actor/address scoring queues on Elliptic++. | Do not blindly merge deposit/transaction and wallet scores. Evaluate queue overlap, yield at review budget, burden, and fragmentation. |
| Bellei et al., 2024, [The Shape of Money Laundering](https://arxiv.org/abs/2404.19109) | Frames AML as subgraph classification using Elliptic2. | Preserve and score laundering shapes/subgraphs, not only individual address scores. |
| Song et al., 2024, [Identifying Money Laundering Subgraphs on the Blockchain](https://arxiv.org/abs/2410.08394) | Shows sender/receiver boundary information is important and candidate subgraph discovery is a practical bottleneck. | Our source/sink, origin path, receiver, and terminal service evidence should become first-class case-graph signals. |
| Deprez et al., 2024/2025, [Network Analytics for AML](https://arxiv.org/abs/2405.19383) | Systematic review plus experiments across AML network methods. | Use AUC-PR, precision@K, temporal evaluation, and interpretability; be cautious with GNNs under imbalance. |
| Weber et al., 2019, [Anti-Money Laundering in Bitcoin](https://arxiv.org/abs/1908.02591) | Elliptic benchmark paper; compares RF, GCN, temporal split, explainability. | Use temporal splits and keep transparent feature/rule baselines. |
| Naser Eddin et al., 2022, [AML Alert Optimization Using ML with Graphs](https://arxiv.org/abs/2112.07508) | Real-world banking alert triage with graph/entity features. | ML works well as downstream alert optimization, not necessarily as replacement for rules. |
| Cardoso et al., 2022, [LaundroGraph](https://arxiv.org/abs/2210.14360) | Self-supervised graph anomaly scoring on bipartite transaction graphs. | Potential future anomaly layer, capped/contextual until validated. |
| Daniel, 2021, [Bayesian and Dempster-Shafer models for combining evidence](https://arxiv.org/abs/2104.07440) | Mathematical evidence fusion for fraud scores. | Bayesian fusion needs priors/likelihoods; Dempster-Shafer can represent uncertainty/conflict but source dependence must be handled. |
| Gueneau et al., 2025, [Transformer contrastive learning for money laundering detection](https://arxiv.org/abs/2507.08835) | Proposes two thresholds and FDR control with Benjamini-Hochberg. | Use data-driven thresholds for "clear low risk" and "high risk review/decline" when labeled outcomes exist. |
| Torres et al., 2026, [Explainable AML Triage with LLMs](https://arxiv.org/abs/2604.19755) | Evidence-constrained LLM triage with citations and counterfactual checks. | LLM contract suspicion should remain evidence-grounded, cited, structured, and verified; not free-form hard proof. |

Source-quality note: several sources are arXiv preprints, not regulatory standards. Treat them as research direction and evaluation design, not production law or compliance advice.

## Research implications for our scorer

### 1. Granularity matters

The Malik paper is directly relevant: transaction-level and actor-level AML queues can disagree heavily. That means a wallet score, incoming deposit score, and origin-path/subgraph score should not be collapsed too early.

For us:

- Wallet score answers: "Should we trust this address as a counterparty/profile?"
- Incoming deposit score answers: "Should this specific deposit be accepted?"
- Path/subgraph score answers: "Is this movement pattern or provenance chain suspicious?"

Those are different action units. Their scores can be linked, but the projection operator should be explicit:

- max projection for hard evidence;
- amount-weighted projection for source-policy exposure;
- recency-weighted projection for fresh deposit risk;
- top-k or noisy-or style projection for repeated weak signals;
- no projection for data-quality uncertainty except as review/coverage state.

### 2. AML is often a subgraph problem

The Elliptic2 and RevTrack papers both argue that laundering is a shape in a transaction graph. Our Deep and Where layers already collect these shapes:

- origin paths;
- drain episodes;
- route-linked approval patterns;
- historical transit profiles;
- sender funding bundles;
- source/sink/terminal service boundaries.

The missing product object is a first-class `caseGraph` or `riskCase`.

Proposed object:

```ts
type RiskCase = {
  actionUnit: "wallet" | "incoming_deposit" | "origin_path" | "subgraph";
  evidenceClass: "hard_proof" | "source_policy" | "behavior_pattern" | "coverage_gap" | "clean_source";
  nodes: string[];
  edges: string[];
  amountShare: number;
  continuity: "strong" | "medium" | "weak" | "unknown";
  terminalKind?: string;
  proofLevel: string;
  score: number;
  dampenable: boolean;
};
```

This can be a documentation/type target first. It does not need a new dependency.

### 3. Metrics should be queue metrics, not only score bands

AML scoring is a review-budget problem. Research repeatedly recommends precision/yield at budget, AUC-PR, false-positive control, temporal validation, and burden decomposition.

For us, the shadow evaluation table should include:

| Metric | Why |
| --- | --- |
| `precision@K` / `yield@budget` | Measures whether top alerts are worth analyst time. |
| `AUC-PR` | Better than accuracy under extreme imbalance. |
| `queueJaccard(old,new)` | Shows how much a scoring change rearranges top alerts. |
| `burdenBreakdown` | Splits hard proof, source-policy, unknown coverage, clean/false-positive burden. |
| `caseFragmentation` | Detects one case split into too many alerts or many addresses. |
| temporal backtest | Avoids random-split optimism and catches regime drift. |
| decisionType distribution | Prevents "DECLINE" from hiding hard vs policy vs coverage cases. |

Without this, changing weights from 10/60/30 to any other numbers is still mostly aesthetic.

### 4. Evidence fusion is useful only after evidence ontology is clean

Bayesian fusion could work if we have calibrated likelihoods:

```text
logit(P(risk)) =
  prior
  + logLR(hardProof)
  + logLR(sourcePolicy)
  + logLR(pattern)
  + logLR(counterparty)
  - logLR(cleanSource)
```

But Fast, Deep, and Where are not independent sources. They often reuse the same labels, transfers, or paths. A naive Bayesian product would double-count evidence.

Dempster-Shafer is attractive when evidence is uncertain or conflicting because it can represent belief, plausibility, uncertainty, and conflict. That maps well to:

- hard evidence: high belief, low uncertainty;
- source-policy context: moderate belief, moderate uncertainty;
- coverage gap: high uncertainty, not high badness;
- clean CEX source: belief for low risk;
- conflicting evidence: high conflict flag instead of average score.

But Dempster-Shafer should be internal math only until users understand it. Product output should say "evidence: hard/policy/context/coverage" rather than "belief mass".

### 5. LLM signals must be evidence-constrained

The current code already treats contract LLM suspicion as dampenable and capped unless it is supported by actionable conditions. Keep that.

Recommended LLM rule:

- LLM may summarize evidence and classify contract suspicion.
- LLM may not create hard proof without cited deterministic evidence.
- Every material LLM claim must point to a stable evidence item.
- Numerical and temporal claims should be checked against structured fields.
- LLM output should separate supporting, contradicting, and missing evidence.

This matches the explainable AML triage paper and protects the scorer from hallucinated policy or invented facts.

## Proposed scoring v3

### Core idea

Make final score an output of an evidence matrix, not a weighted average of modes.

Current:

```text
weightedLayerScore = Fast * 0.10 + Deep * 0.60 + Where * 0.30
finalScore = floors/caps/dampeners(weightedLayerScore)
```

Recommended:

```text
riskVector = extractEvidenceMatrix(Fast, Deep, Where, Incoming)

hard = max(riskVector.hardProof)
policy = aggregateSaturating(riskVector.sourcePolicy)
pattern = max(riskVector.behaviorPattern)
context = calibratedOrCappedContext(riskVector.context)
coverage = riskVector.coverage
dampener = allowedDampener(riskVector.cleanSource, hard, policy, pattern)

if hard >= hardThreshold:
  finalScore = hard
else:
  finalScore = min(84, max(policy, pattern, context, coverage.floor) - dampener)

decision = decisionPolicy(finalScore, hard, policy, coverage, actionUnit)
```

This keeps the current floors/caps style but makes the reason explicit.

### Evidence matrix

| Dimension | Examples | Score role |
| --- | --- | --- |
| `hardProof` | active stablecoin blacklist, exact approval drain, exact scam/stolen/phishing label path | Can force high score and decline. |
| `sourcePolicy` | HTX/Huobi/WhiteBIT/no-name liquidity/mixer/sanctioned boundary with share and continuity | Can force policy decline, usually capped below hard proof unless sanctioned/mixer. |
| `behaviorPattern` | historical transit, deposit-then-drain, drain episode, route-linked approval pattern | Floors context risk, capped without hard proof. |
| `depositProvenance` | funding coverage, exact continuity coverage, clean source coverage | Applies mainly to incoming deposit action unit. |
| `counterpartyExposure` | direct interactions, inbound provenance, repeated risky counterparties | Context or pattern evidence depending on link strength. |
| `contractSuspicion` | LLM/source contract verdict with cited code/behavior evidence | Context/policy warning, capped and dampenable unless deterministic evidence exists. |
| `coverage` | partial fetch, low selected amount coverage, unresolved origin | Uncertainty/review dimension, not badness by itself. |
| `cleanSource` | clean CEX-funded, trusted allowlist, operational liquidity role | Dampener and explanation, cannot erase hard proof. |

### Decision type

Add a separate `decisionType` next to score:

| Type | Meaning |
| --- | --- |
| `hard_decline` | Direct deterministic bad evidence. |
| `source_policy_decline` | Policy/source boundary risk is above threshold. |
| `safe_default_decline` | System cannot prove clean provenance under product policy. |
| `manual_review_insufficient_coverage` | Coverage too weak for automated accept/decline. |
| `acceptable_clean_source` | Clean source/provenance is strong enough. |
| `acceptable_operational_context` | Operational/liquidity pattern with no hard/policy bad evidence. |
| `context_warning` | Non-blocking risk signal. |

This is more important than changing numeric weights.

### Thresholds

Keep current bands for backward compatibility:

- `85+ CRITICAL`;
- `60-84 HIGH`;
- `30-59 MEDIUM`;
- `<30 LOW`.

But define what crosses them:

- `85+`: hard proof or strongest deterministic/near-deterministic source proof.
- `60-84`: source-policy or strong behavior pattern, not automatically criminal proof.
- `30-59`: weak/moderate context or coverage concern.
- `<30`: low evidence of risk, possibly with clean-source/operational dampener.

If we get labeled outcomes, calibrate thresholds with:

- temporal split;
- precision/yield at review budget;
- AUC-PR;
- FDR/BH thresholding for high-risk and low-risk buckets;
- reliability curves only if we claim probability.

## What to keep, remove, improve

### Keep

- Hard evidence floors.
- No-hard cap below critical range.
- Source exposure scoring by kind, share, continuity, path context, and proof level.
- Incoming Deposit as deposit-scoped analysis.
- Coverage and provenance confidence as visible outputs.
- Dampener constraints: clean context can reduce context score, not erase hard proof.
- LLM guardrails and caps.

### Remove or demote

- Do not explain the final score as "10% Fast, 60% Deep, 30% Aware".
- Do not use a single `DECLINE` reason without `decisionType`.
- Do not let `coverage gap` masquerade as high criminal risk.
- Do not average hard proof with weak context.
- Do not add more top-level weights until we have queue evaluation.

### Improve

- Add `riskVector` and `decisionType` to unified output.
- Move layer-weight contribution into `contextBaseline`.
- Add a shadow scorer that emits old and v3 scores side by side.
- Build an evaluation harness over historical checks/incoming alerts.
- Store review outcomes, admin overrides, and user complaint/false-positive outcomes for calibration.
- Add case/subgraph IDs so related alerts can be grouped.

## Minimal implementation roadmap

### Phase 0: documentation and fixtures

No scoring behavior change.

- Add fixtures for known cases:
  - hard blacklist;
  - exact approval drain;
  - source-policy decline;
  - historical transit;
  - insufficient coverage;
  - clean CEX-funded;
  - operational liquidity;
  - incoming deposit with exact funding continuity.
- For each fixture, assert score, decision, and `decisionType` target.

### Phase 1: expose risk vector

No behavior change at first.

- Add `riskVector` to unified outputs.
- Fill it from existing reasons/floors/profiles.
- Keep `finalScore` as today.
- Add UI/report labels that distinguish hard proof, policy, context, coverage, and dampener.

### Phase 2: shadow v3 scorer

Behavior still unchanged for users.

- Implement v3 scorer behind a flag.
- Emit old score and v3 score into logs/reports.
- Compare queue ordering and decision changes.

### Phase 3: queue evaluation

- Build a small evaluator over saved checks and incoming deposit alerts.
- Report precision/yield if labels exist.
- If labels do not exist, report burden decomposition and manual-review sample sets.
- Use temporal splits by alert/check date.

### Phase 4: controlled rollout

- Keep hard-proof behavior unchanged.
- Switch safe-default/coverage and operational-liquidity branches first, because those are the most likely false-positive source.
- Keep source-policy thresholds conservative until product policy is explicit.

### Phase 5: optional learned calibration

Only after enough labeled outcomes:

- Start with logistic/isotonic calibration or gradient-boosted trees over risk-vector features.
- Keep rule anchors as constraints.
- Evaluate against current scorer using temporal backtest and queue metrics.
- Consider self-supervised graph anomaly only as a capped context feature.

## Proposed first code-level target

The smallest useful change is not a new model. It is adding the missing semantics:

```ts
type UnifiedDecisionType =
  | "hard_decline"
  | "source_policy_decline"
  | "safe_default_decline"
  | "manual_review_insufficient_coverage"
  | "acceptable_clean_source"
  | "acceptable_operational_context"
  | "context_warning";

type UnifiedRiskVector = {
  hardProofScore: number;
  sourcePolicyScore: number;
  behaviorPatternScore: number;
  depositProvenanceScore: number;
  counterpartyExposureScore: number;
  contractSuspicionScore: number;
  coverageUncertaintyScore: number;
  cleanSourceDampener: number;
};
```

Then reports can say:

- `Risk: 65 HIGH`
- `Decision type: source_policy_decline`
- `Hard bad evidence: none`
- `Coverage: partial`
- `Reason: source policy exposure, not direct scam proof`

That alone fixes much of the product ambiguity without changing the math.

## Devil's advocate

Do we actually need a new scoring algorithm immediately?

Maybe not. The current code already has the important safety mechanics. The fastest useful work is to expose the hidden evidence classes and evaluate the current scorer. A brand-new model without labels would mostly move arbitrary numbers around.

Do we need GNNs or transformers?

Not yet. The research says graph ML can help, but imbalance, scale, interpretability, and temporal drift are real problems. Our current rule/evidence system is more auditable and cheaper. Use ML later for calibration or anomaly features, not as the first fix.

Do we need Dempster-Shafer?

Maybe later. It matches uncertainty/conflict better than plain averages, but it can become opaque fast. First make the evidence matrix explicit. Then decide whether belief intervals are worth the complexity.

Do we need to remove the score?

No. Users need a compact number. The fix is to stop pretending the number carries all semantics. Score plus `decisionType`, `proofLevel`, `coverage`, and `activeAnchor` is defensible.

## Open questions

- What is the product policy for `safe_default_decline` when no hard evidence exists?
- Should `insufficient_coverage` ever produce user-facing `DECLINE`, or should it become `REVIEW`/`manual review` internally?
- What review budget matters: top 1%, top 5%, or fixed daily number of alerts?
- Which outcome labels can we collect: analyst decision, user appeal, admin override, later blacklist, chargeback/loss?
- Should incoming deposit acceptance use stricter thresholds than wallet profile scoring?
- How much source-policy exposure is unacceptable by amount share for each business mode?

## Bottom line

The current scorer is stronger than a naive weighted average, but its public shape is still too numeric and too mode-weighted. The right redesign is an evidence matrix with explicit action units and queue evaluation.

Do not start by tuning `0.10 / 0.60 / 0.30`. Start by exposing:

- what kind of evidence won;
- what scope it applies to;
- how much money/share it covers;
- how strong the link is;
- how complete the data is;
- whether the decision is hard proof, source policy, coverage default, or context warning.

After that, the weights can be calibrated with historical queues instead of guessed.
