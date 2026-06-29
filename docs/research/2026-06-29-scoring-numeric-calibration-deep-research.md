# Numeric scoring calibration deep research, 2026-06-29

This note deepens `2026-06-29-unified-scoring-research-review.md`.

Question: why do we assign the exact numbers we assign now, how objective are they, and how should wallet/deposit/path scores be calculated so that a `59`, `60`, `85`, or `95` has a defensible meaning?

Short answer: most current constants are policy cutoffs, not calibrated probabilities. That is acceptable only if we label them as policy scores and keep hard evidence, source-policy evidence, behavior patterns, coverage uncertainty, and dampeners separate. If we want objective weights, we need a temporal labeled dataset and calibration/backtesting.

## Evidence status

Facts from code:

- Unified wallet score uses Fast `0.10`, Deep `0.60`, Where/Aware `0.30`, but final score is not only this weighted average.
- Final score is `max(context after dampener, floorScore)`, capped at `84` when there is no hard evidence.
- `60` is the default user-facing decline threshold.
- `85+` is CRITICAL/hard-evidence territory.
- stablecoin blacklist and exact scam/approval-drain evidence can force `90-95+`.
- pattern floors and source-policy floors can hold a score even when layer averaging would reduce it.
- dampeners can reduce contextual score, but cannot reduce a stronger floor.

Evidence from research:

- AML work should evaluate investigation queues, not just global accuracy. Actor-level action units can differ from transaction-level model scores, so projection/aggregation matters.
- False-positive control matters more than a pretty 0-100 score. Thresholds should be selected against review budget, FPR/FDR, and recall/yield.
- Calibrated scores need observed outcomes. A score is calibrated if cases scored around `p` are bad about `p` of the time.
- Risk matrices are useful for display, but unreliable as mathematical decision engines if bins and weights are not validated.
- Dempster-Shafer/Bayesian fusion is useful only after source reliability, dependence, uncertainty, and conflict are explicit.

Inference:

- Our current numbers are internally consistent as a policy ladder, but not objectively calibrated.
- The current system can explain why a wallet is near `59`, but not prove that `59` means "59% risk".
- The next scoring system should keep two products separate:
  - `policyScore`: deterministic decision/risk ladder for exchange operations.
  - `calibratedRisk`: empirical probability/ranking score learned and calibrated from outcomes.

Recommendation:

- Keep hard-proof floors.
- Keep source-policy share/path math, but document every cap and floor as policy.
- Split behavior-only transit from source-linked transit.
- Stop letting behavior-only patterns cross the `60` decline threshold without source/hard proof.
- Backtest thresholds and weights before calling the final number objective.

## Where the current important numbers come from

### `59`

`59` appears in two important places.

First, bridge/cross-chain source-policy exposure has a share cap of `59` when attributable/effective share is between `20%` and `50%`. That means: significant bridge/cross-chain exposure, but below automatic decline unless other evidence pushes it over `60`.

Second, weak source-policy layers are aggregated as:

```text
aggregate = strongest + min(10, second * 0.15) + min(5, third * 0.05)
```

So the test case `[52, 38, 35]` becomes `52 + 5.7 + 1.75 = 59`. This is intentional saturation: multiple weak signals can reinforce each other, but cannot explode into a hard decline.

Interpretation: `59` is not a probability. It is "almost high, but not enough for automatic decline". It is a policy boundary below `60`.

### `60`

`60` is the HIGH/DECLINE threshold in wallet scoring and source-policy proof levels. It means "we are willing to take exchange action or treat the evidence as decline-level policy evidence".

This is not currently derived from empirical false-positive rate. It should be.

### `84`

`84` is the cap for non-hard evidence in the unified wallet score. It prevents a wallet from looking CRITICAL without deterministic/hard proof.

This is a good design idea: contextual evidence can be high, but should not visually equal blacklist, sanction, or exact approval-drain proof.

### `85`

`85` is CRITICAL/hard evidence territory. Deterministic Where evidence, exact approval-drain provenance, exact high-risk inbound provenance, or other hard labels can floor the score here.

### `90-95+`

These values are used for stablecoin blacklist, exact approval-drain, direct risky labels, sanctioned/mixer-like cases, and similar deterministic evidence.

This range should remain reserved for hard proof, not for aggregate behavior.

## What is currently objective and what is not

Objective enough:

- monotonic share curves: more attributable source exposure cannot reduce source-policy score;
- hop/time/amount continuity adjustments: closer, faster, amount-preserving paths score higher;
- hard floors: deterministic evidence cannot be averaged away;
- no-hard cap: contextual evidence cannot masquerade as hard proof;
- dampener guard: dampeners do not lower hard/policy/pattern floors.

Not objective yet:

- source severity constants such as HTX `80`, WhiteBIT `60`, bridge/cross-chain `65`;
- share cap boundaries like `<20%`, `<50%`, `<80%`;
- path adjustments like `+12` for fast path or `-12` for stale/weak continuity;
- layer weights `10/60/30`;
- decision threshold `60`;
- dampener sizes `10`, `15`, `25`, `40`;
- behavior-only pattern weights.

Those numbers can be reasonable expert priors, but they become objective only after temporal backtest and calibration.

## Research-backed scoring principle

Do not ask: "what percent should this signal add?"

Ask instead:

1. What is the action unit: wallet, incoming deposit, source path, transaction, actor cluster, or investigation queue item?
2. What is the evidence class: hard proof, source policy, pattern, coverage uncertainty, clean-source dampener, or weak context?
3. Is this signal independent from the other signals?
4. What false-positive rate or investigation budget are we willing to tolerate?
5. On historical labeled data, how often does this feature bucket correspond to bad outcomes?

This matches the AML queue literature: the useful score is the score that ranks the right action units under a fixed review budget, not necessarily the score with the nicest single-number story.

## Proposed v3 numeric architecture

### 1. Keep an evidence matrix

Each scoring row should have:

```text
scope:
  wallet | incoming_deposit | source_path | route | actor_cluster

evidenceClass:
  hard_proof | source_policy | service_linked_pattern | behavior_only |
  coverage_uncertainty | clean_source | operational_dampener

inputs:
  sourceKind
  severity
  rawShare
  effectiveShare
  attributableShare
  hops
  elapsedTime
  amountContinuity
  pathCount
  walletRole
  coverageCompleteness
  provenanceConfidence
  ageSignals

outputs:
  rawScore
  cap
  floor
  adjustedScore
  proofLevel
  canBeDampened
  uncertainty
  evidenceIds
```

### 2. Aggregate by evidence class, not by blind average

Recommended high-level formula:

```text
hardFloor = max(hard proof rows)
policyFloor = max(source-policy rows with proofLevel=decline or score>=60)
patternFloor = max(service-linked pattern rows, route-linked rows, asset-continuation rows)
coverageFloor = 30 only for limited coverage

floorScore = max(hardFloor, policyFloor, patternFloor, coverageFloor)

contextScore = normalized contextual layers
allowedDampener = min(rawDampener, contextScore - floorScore, 25), only if contextScore > floorScore

finalScore =
  if hardFloor > 0:
    max(floorScore, contextScore - allowedDampener)
  else:
    min(84, max(floorScore, contextScore - allowedDampener))
```

This mostly matches the current unified scorer. The improvement is semantic: report the matrix and explain which row won.

### 3. Split pattern scoring into two different things

Current issue: "pattern score" can sound like one unified signal, but it mixes very different proof strength.

#### A. Service-linked transit pattern

Keep the current historical transit idea when a wallet is actually moving through bridge/router/DEX/unknown-contract infrastructure:

```text
eligible if:
  flow > 0
  outgoing > 0
  serviceShare >= 20%

score = 35
  + min(20, log10(flowUsdt + 1) / 6 * 20)
  + passThroughRatio * 20
  + serviceShare * 25

if score >= 60:
  patternFloor = min(84, score)
else:
  no pattern floor
```

This is a policy pattern, not hard proof. It can go above `60` only because there is a service/source anchor, not behavior alone.

#### B. Behavior-only transit prior

For wallets with high volume and pass-through behavior but no source/service proof, use a separate score capped below decline:

```text
featureScore =
  0.20 * volumeNorm
  + 0.25 * turnoverNorm
  + 0.20 * topologyNorm
  + 0.15 * recencyNorm
  + 0.20 * speedContinuityNorm

behaviorOnlyScore = min(59, round(20 + 39 * featureScore))
```

Feature definitions:

```text
volumeNorm = min(1, log10(max(incomingUsdt, outgoingUsdt) + 1) / 6)
turnoverNorm = min(1, outgoingUsdt / incomingUsdt)
topologyNorm = max(topSenderShare, min(1, outgoingTxCount / 50) * 0.60)
recencyNorm = max(0, 1 - walletAgeDays / 30)
speedContinuityNorm = max observed exact/near-exact pass-through strength, 0..1
```

Why cap at `59`: behavior alone is a triage signal. It should create review/context, not automatic exchange decline. If source-policy or hard proof appears, that proof gets its own floor and can cross `60`.

Important: these weights are still expert priors. They are better than an opaque percentage because they are monotonic and auditable, but they should be replaced by calibrated coefficients when labeled outcomes exist.

#### C. Exact transfer/case pattern

A specific deposit or path can score differently from the whole wallet:

```text
casePatternScore = min(59, round(20 + 39 * (
  0.35 * amountContinuityNorm
  + 0.35 * timeProximityNorm
  + 0.20 * sourceRiskNorm
  + 0.10 * repetitionNorm
)))
```

If the exact pass-through is from a known bad source, this should stop being behavior-only and become source-policy or hard provenance.

### 4. Calibrate the objective score separately

For a truly objective score, create a shadow model:

```text
logit(P(bad)) = beta0
  + beta_sourceKindShareBucket
  + beta_hopBucket
  + beta_timeBucket
  + beta_amountContinuityBucket
  + beta_repetitionBucket
  + beta_behaviorTransitBucket
  + beta_walletRoleBucket
  + beta_coverageBucket
```

Recommended transparent implementation:

- bin features into monotonic buckets;
- compute Weight of Evidence / log-odds by bucket;
- fit logistic regression or a monotonic tree model;
- calibrate with isotonic regression or Platt scaling;
- validate with Brier score, expected calibration error, reliability diagrams, PR-AUC, recall at fixed FPR/FDR, and yield@budget;
- choose `decline`, `review`, and `acceptable` thresholds from false-positive limits and analyst capacity.

Only this second track should be called calibrated probability.

## How this changes the two wallet examples

Data limitation: I only have public TRON event/account facts from the earlier check, not a successful local full Deep/Where run with Postgres labels. So the example below is behavior-prior math, not a final exchange decision.

### `TYznvCkMPQLEmKHmjxNM1yQn88yabRqSdM`

Observed public facts from the earlier pull:

- created `2026-06-21T18:02:48Z`;
- latest operation observed `2026-06-28T20:37:54Z`;
- visible USDT incoming in last 100 TRC20 events: about `1,002,948`;
- visible USDT outgoing in last 100 TRC20 events: about `1,072,358`;
- top sender contributes about `97.5%` of visible incoming;
- many outgoing recipients;
- no local source-policy label confirmed in the failed local run.

Behavior-only prior:

```text
volumeNorm ~= 1.00
turnoverNorm ~= 1.00
topologyNorm ~= 0.98
recencyNorm ~= 0.77
speedContinuityNorm ~= 0.50, because exact downstream continuity is not fully proven at wallet level

featureScore ~= 0.86
behaviorOnlyScore ~= 54/100
```

Interpretation:

- Under the new logic this should not automatically be `59` just because it has big flow.
- It is still a strong behavior-prior warning: new wallet, concentrated funding, high turnover, many outgoing transfers.
- Without source-policy/hard proof, it stays below `60`.
- If the dominant funder or outgoing route is later classified as bridge/cross-chain/no-name/mixer/sanctioned with sufficient share and continuity, the source-policy score can replace this behavior prior and cross `60`.

### `TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC`

Observed public facts from the earlier pull:

- created `2026-05-15T13:16:24Z`;
- latest operation observed `2026-06-28T17:15:42Z`;
- visible USDT incoming in last 100 TRC20 events: about `1,769,233`;
- visible USDT outgoing in last 100 TRC20 events: about `1,617,753`;
- top sender contributes about `12%` of visible incoming;
- large retained USDT balance observed;
- a specific `10,030 USDT` incoming from `TYznv...` was followed by an outgoing `10,030 USDT` about 4m45s later.

Wallet-level behavior-only prior:

```text
volumeNorm ~= 1.00
turnoverNorm ~= 0.91
topologyNorm ~= 0.58, because activity is broad but not dominated by one sender
recencyNorm ~= 0.00, because wallet is older than 30 days
speedContinuityNorm ~= 0.20 at wallet level

featureScore ~= 0.58
behaviorOnlyScore ~= 43/100
```

Case-level exact pass-through prior for the `10,030 USDT` episode:

```text
same amount and fast timing raise speedContinuityNorm
case-like behaviorOnlyScore ~= 47/100 before any source-risk proof
```

Interpretation:

- The wallet should not inherit the same `59` pattern score as `TYznv` at wallet level.
- It has a specific suspicious transfer episode, but the whole wallet looks more operational and less concentrated.
- This is why lowering the wallet-level score is defensible.
- If the `TYznv -> TYDae -> TFcs...` path is tied to a risky source or repeated across many cases, the score should move from behavior-only into source-policy or route-linked pattern, and then crossing `60` becomes justified.

## Why the old "first 59, second 59 but lowered" felt wrong

It felt wrong because it compressed two different claims into one number:

1. `TYznv` as a wallet has a strong pass-through behavior prior.
2. `TYDae` as a wallet has one strong pass-through episode but more mixed operational behavior.

Those should not both start from the same wallet-level pattern score unless the evidence rows are actually the same. The new design makes this explicit:

- wallet-level behavior score for `TYznv`: around `54`, possibly up to `59` if exact fast continuity is repeatedly proven;
- wallet-level behavior score for `TYDae`: around `43`;
- case-level transfer pattern for the exact `10,030 USDT` pass-through: around `47`;
- source-policy/hard-proof score: separate, can exceed `60` only with source evidence.

## Recommended implementation changes

1. Add `behaviorOnlyTransitScore` as a separate non-floor or capped floor below `60`.
2. Keep `historicalTransitScore` only for service-linked transit, where service share is known.
3. In reports, show:
   - `hardProofScore`;
   - `sourcePolicyScore`;
   - `serviceLinkedPatternScore`;
   - `behaviorOnlyTransitScore`;
   - `casePatternScore`;
   - `coverageUncertaintyScore`;
   - `dampenerScore`;
   - winning score row.
4. Rename "pattern score" in the UI/report to "service-linked pattern" or "behavior-only prior" depending on evidence class.
5. Add a scoring audit export with all feature buckets and final rows.
6. Build a shadow calibration dataset:
   - wallet/day action unit;
   - incoming deposit action unit;
   - source path action unit;
   - manually resolved outcome;
   - label source and label date;
   - features frozen at decision time.
7. Backtest temporally and choose thresholds:
   - `auto_decline`: FDR/FPR target;
   - `manual_review`: analyst capacity target;
   - `acceptable`: high negative predictive value target.

## Source notes

- Malik et al., 2026, "Do Transaction-Level and Actor-Level AML Queues Agree?", arXiv `2604.23494`: action unit and queue-budget evaluation matter for blockchain AML. https://arxiv.org/abs/2604.23494
- Bellei et al., 2024, arXiv `2404.19109`: graph/subgraph structure should be considered, not only isolated transaction scores. https://arxiv.org/abs/2404.19109
- Naser Eddin et al., 2021, "Anti-Money Laundering Alert Optimization Using Machine Learning with Graphs", arXiv `2112.07508`: AML systems face high false positives; graph ML is evaluated as alert triage. https://arxiv.org/abs/2112.07508
- Gueneau et al., 2025, "Representation learning with a transformer by contrastive learning for money laundering detection", arXiv `2507.08835`: proposes AML scoring with a two-threshold approach and Benjamini-Hochberg false-positive/FDR control. https://arxiv.org/abs/2507.08835
- Daniel and Thomas, 2021, "Bayesian and Dempster-Shafer models for combining multiple sources of evidence in a fraud detection system", arXiv `2104.07440`: evidence fusion requires priors/likelihoods or explicit uncertainty/conflict handling. https://arxiv.org/abs/2104.07440
- "Calibration of Machine Learning Classifiers for Probability of Default Modelling", arXiv `1710.08901`: credit/default scoring validation needs calibration, not only ranking. https://arxiv.org/abs/1710.08901
- "Evaluating probabilistic classifiers: Reliability diagrams and score decompositions revisited", arXiv `2008.03033`: reliability diagrams and isotonic methods help test whether probability scores match observed frequencies. https://arxiv.org/abs/2008.03033
- Guo et al., 2017, "On Calibration of Modern Neural Networks", arXiv `1706.04599`: high discrimination does not imply calibrated probabilities. https://arxiv.org/abs/1706.04599
- Cox, 2008, "What's Wrong with Risk Matrices?", Risk Analysis: risk matrices can mis-rank quantitative risk if bins are not carefully designed. https://pubmed.ncbi.nlm.nih.gov/18419665/
- Benjamini and Hochberg, 1995, "Controlling the False Discovery Rate": thresholding can target expected false discovery rate under assumptions. https://rss.onlinelibrary.wiley.com/doi/10.1111/j.2517-6161.1995.tb02031.x
- Niculescu-Mizil and Caruana, 2005, "Predicting Good Probabilities With Supervised Learning": probability quality must be evaluated directly. https://www.cs.cornell.edu/~alexn/papers/calibration.icml05.crc.rev3.pdf
