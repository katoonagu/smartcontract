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
- sender identity and labels;
- funding candidates;
- amount continuity;
- origin coverage;
- source-policy exposure of the deposited amount;
- direct stablecoin blacklist evidence;
- sender wallet context.

Interpretation:

Incoming Deposit should not blindly inherit wallet-level score. It should score the deposit action unit first, then use sender wallet context as supporting evidence.

## Current unified scorer

Code path:

- `src/risk/unifiedWalletRisk.ts`

Layer weights:

```text
Fast  = 0.10
Deep  = 0.60
Where = 0.30
```

Risk bands:

```text
85-100: CRITICAL
60-84: HIGH
30-59: MEDIUM
0-29: LOW
```

Decision:

```text
score >= 60 => DECLINE
score < 60  => ACCEPTABLE
hard evidence >= 85 => DECLINE
```

Important floors:

- `hardEvidenceFloor`: blacklist, exact approval-drain, exact high-risk provenance, deterministic Where evidence.
- `policyFloor`: source-policy evidence with decline-level proof, generally `score >= 60` or explicit exchange policy decline.
- `assetContinuationFloor`: continuation across chains/assets, capped below hard proof when not exact hard evidence.
- `patternFloor`: historical transit, Where drain episode transit, route-linked approval pattern, and limited coverage floor.

Dampener:

- fast negative reasons;
- address behavior dampener;
- wallet role dampener:
  - clean CEX-funded: `15`;
  - operational liquidity: `10`;
- capped raw dampener at `40`;
- actual allowed dampener capped at `25` and cannot push below floor score.

Final shape:

```text
weightedLayerScore = normalized weighted layer score over available layers
floorScore = max(hardEvidenceFloor, policyFloor, assetContinuationFloor, patternFloor)
dampener = min(rawDampener, weightedLayerScore - floorScore, 25), only if weightedLayerScore > floorScore
contextScore = weightedLayerScore - dampener
finalBeforeHardCap = max(contextScore, floorScore, coverage floor)
finalScore = hardEvidenceFloor == 0 ? min(finalBeforeHardCap, 84) : finalBeforeHardCap
```

This is more careful than a naive weighted average. The issue is not that the scorer has no structure. The issue is that the UI and mental model still collapse several evidence meanings into one number.

## Current signal taxonomy

### Hard proof

Examples:

- stablecoin blacklist;
- exact approval-drain evidence;
- exact scam/blacklist/sanction label;
- deterministic Where evidence;
- exact high-risk inbound/extended provenance.

Meaning:

Hard proof should floor the score. It should not be averaged away by clean behavior or coverage gaps.

### Source policy

Examples:

- HTX/Huobi source policy;
- WhiteBIT policy exposure;
- bridge/router/DEX/cross-chain source boundary;
- no-name token liquidity;
- mixer;
- sanctioned service;
- unknown contract or unknown CEX exposure.

Current mechanics:

- severity by kind;
- exposure share;
- cap/floor by share band;
- hop/time/amount continuity;
- repetition;
- data quality;
- wallet role adjustment;
- proof level.

Meaning:

Source policy is not identical to direct scam proof. It can justify decline under exchange policy, but the report must say it is policy exposure, not direct taint proof.

### Pattern

Examples:

- historical high-volume transit;
- deposit-then-drain;
- bridge/router/DEX transit;
- route-linked approval pattern;
- exact transfer pass-through case.

Meaning:

Patterns are strong triage signals. They should cross decline threshold only when anchored by service/source evidence or repeated high-confidence cases.

### Coverage uncertainty

Examples:

- limited Where coverage;
- sparse Deep graph;
- unresolved origin paths;
- missing checks.

Meaning:

Coverage uncertainty is not badness. It should raise manual-review pressure and prevent false "clean" claims, but should be reported as uncertainty.

### Dampeners

Examples:

- clean CEX-funded role;
- operational liquidity role;
- known service/treasury behavior;
- trusted/false-positive labels.

Meaning:

Dampeners should reduce context-only risk. They should not reduce hard proof or source-policy floors.

## Research synthesis

### AML queue evaluation

Malik et al. 2026 argue that blockchain AML systems must evaluate the action unit used in compliance operations. A transaction-level score and actor-level queue can disagree. This directly applies here: wallet score, incoming deposit score, source path score, and actor cluster score are different action units.

Implication:

- score the action unit explicitly;
- use queue metrics such as yield@budget and burden decomposition;
- do not assume transaction/path scores can be averaged into a wallet score without projection rules.

### Graph and subgraph context

Bellei et al. 2024 and related graph AML work support the idea that shape, neighborhood, temporal flow, and structural patterns matter. Isolated address labels are too weak.

Implication:

- keep Deep and Where graph features;
- do not replace graph context with a single provider label score;
- report subgraph/path evidence IDs so analysts can inspect the claim.

### False-positive control

AML systems often suffer high false positives. Gueneau et al. 2025 proposes a two-threshold AML scoring approach with Benjamini-Hochberg false-positive/FDR control.

Implication:

- `60` should become a calibrated operating threshold, not a magic constant;
- we should choose thresholds under an explicit false-positive and review-capacity target;
- use at least `auto_decline`, `manual_review`, and `acceptable`, not one binary cutoff.

### Calibration

Credit scoring and classifier calibration literature distinguishes ranking quality from probability quality. A model can rank bad cases well but still be miscalibrated. Reliability diagrams, Brier score, expected calibration error, isotonic regression, and Platt scaling are standard tools.

Implication:

- our current score should be called `policyScore` or `triageScore`;
- do not call it probability;
- add a shadow calibrated score once we have labeled outcomes.

### Evidence fusion

Bayesian and Dempster-Shafer evidence fusion can combine heterogeneous evidence, but only if uncertainty, source reliability, and source dependence are explicit.

Implication:

- do not sum correlated signals as if independent;
- store evidence conflict;
- separate "unknown" from "clean";
- use evidence fusion after, not before, the evidence matrix is explicit.

### Risk matrices

Cox 2008 shows that risk matrices can mis-rank risks when categories and bins are poorly designed.

Implication:

- risk bands are communication labels, not proof of mathematical calibration;
- the 0-100 score should be backed by monotonic features, calibration, and threshold validation.

## Proposed v3 model

### Risk vector

Every final report should expose:

```text
hardProofScore
sourcePolicyScore
serviceLinkedPatternScore
behaviorOnlyScore
casePatternScore
coverageUncertaintyScore
cleanSourceDampener
operationalDampener
contextScore
finalPolicyScore
calibratedRiskProbability, optional later
winningEvidenceClass
winningEvidenceIds
```

### Evidence classes

Recommended class ladder:

```text
95-100: deterministic blacklist/sanction/stablecoin restriction/exact hard proof
85-94: exact taint or exact approval-drain/known scam proof
70-84: strong source-policy or service-linked laundering pattern, not hard proof
60-69: decline-level policy exposure or strong pattern with source anchor
45-59: suspicious behavior/context, manual review candidate
30-44: weak context or limited coverage warning
0-29: low evidence of risk, or clean/operational context after dampener
```

### Aggregation

Recommended decision logic:

```text
hard = max(hard proof rows)
policy = aggregate source-policy rows by kind with saturation
pattern = max(service-linked pattern, route-linked approval, case pattern with source anchor)
coverage = limited coverage floor only

floor = max(hard, policy decline floor, pattern floor, coverage floor)
context = normalized context layers
dampener = allowed only against context, never against hard/policy/pattern floor
finalPolicyScore = hard ? max(floor, context - dampener) : min(84, max(floor, context - dampener))
```

### Behavior-only cap

Behavior-only patterns should not cross `60` by themselves. They should create a review signal and queue priority. If a source/path label later appears, the score moves into source-policy or hard-proof class.

This directly addresses the confusing case where two wallets both appear to receive a `59` pattern-like score but one should be lowered by operational context.

### Incoming deposit

Incoming deposit should use deposit-scoped scoring first:

```text
depositSourcePolicy
depositHardProof
depositCasePattern
senderWalletContext
originCoverage
finalDepositScore
```

The sender wallet score can support but should not dominate the deposit if the deposit amount has clean, high-coverage provenance.

## What to keep, remove, and improve

Keep:

- hard evidence floors;
- no-hard cap at `84`;
- source-policy share/path scoring;
- dampener cannot reduce floors;
- separate incoming deposit flow;
- audit/debug fields.

Remove or demote:

- treating 10/60/30 as the main explanation;
- one generic "pattern score";
- behavior-only scores that imply direct decline;
- coverage gaps presented as badness;
- any claim that `score/100` is probability.

Improve:

- show evidence matrix in reports;
- rename pattern classes;
- add behavior-only transit prior capped below `60`;
- calibrate thresholds from historical outcomes;
- evaluate by review queue metrics;
- export scoring audit rows for backtest.

## Suggested implementation plan

1. Add a `riskVector` object to unified scoring output.
2. Preserve the existing `finalScore` for compatibility.
3. Split pattern output into:
   - `serviceLinkedPatternScore`;
   - `behaviorOnlyTransitScore`;
   - `casePatternScore`;
   - `routeLinkedPatternScore`.
4. Add `winningEvidenceClass` and `winningEvidenceIds`.
5. Update bot/admin wording so the user sees why the score exists.
6. Add scoring audit export for backtests.
7. Build a temporal labeled dataset and run shadow calibration.
8. Choose thresholds from false-positive/FDR/review-capacity targets.

## Source notes

- Malik et al., 2026, "Do Transaction-Level and Actor-Level AML Queues Agree?", arXiv `2604.23494`: action unit and queue-budget evaluation matter for blockchain AML. https://arxiv.org/abs/2604.23494
- Bellei et al., 2024, arXiv `2404.19109`: graph/subgraph structure should be considered, not only isolated transaction scores. https://arxiv.org/abs/2404.19109
- Deprez et al., 2024, arXiv `2405.19383`: AML graph analytics should account for class imbalance, temporal validation, interpretability, and AUC-PR/queue-oriented metrics. https://arxiv.org/abs/2405.19383
- Weber et al., 2019, arXiv `1908.02591`: Elliptic-style blockchain AML work shows the importance of temporal splits and drift. https://arxiv.org/abs/1908.02591
- Naser Eddin et al., 2021, "Anti-Money Laundering Alert Optimization Using Machine Learning with Graphs", arXiv `2112.07508`: AML systems face high false positives; graph ML is evaluated as alert triage. https://arxiv.org/abs/2112.07508
- Gueneau et al., 2025, "Representation learning with a transformer by contrastive learning for money laundering detection", arXiv `2507.08835`: proposes AML scoring with a two-threshold approach and Benjamini-Hochberg false-positive/FDR control. https://arxiv.org/abs/2507.08835
- Daniel and Thomas, 2021, "Bayesian and Dempster-Shafer models for combining multiple sources of evidence in a fraud detection system", arXiv `2104.07440`: evidence fusion requires priors/likelihoods or explicit uncertainty/conflict handling. https://arxiv.org/abs/2104.07440
- Cox, 2008, "What's Wrong with Risk Matrices?", Risk Analysis: risk matrices can mis-rank quantitative risk if bins are not carefully designed. https://pubmed.ncbi.nlm.nih.gov/18419665/
