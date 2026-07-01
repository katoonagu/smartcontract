# Scoring Signal Matrix v1 Design

Date: 2026-07-01

## Goal

Define an implementation-facing signal matrix for wallet and incoming-deposit scoring.

The matrix must make every score explainable as:

```text
atomic signal -> evidence row -> score band -> in-band modifiers -> caps -> decision
```

This replaces the current ambiguous pattern where independent scores from fast, deep, where-is-money, coverage, and behavior can combine into a high final score without a single strong evidence row.

## Non-Goals

- Do not implement the scorer in this spec.
- Do not treat the score as a calibrated probability.
- Do not remove existing evidence collection.
- Do not hide old signals. Existing signals are preserved as inputs, but their scoring authority is reclassified.

## Core Policy

The matrix is a policy scorecard, not an additive risk sum.

The final score is selected by the strongest supported evidence row. Secondary signals can move the score inside that row's band, but cannot move a weak row into a stronger row.

```text
final_score = score(strongest_supported_evidence_row)
```

Not:

```text
final_score = fast * 0.10 + deep * 0.60 + where * 0.30
```

Not:

```text
final_score = behavior + coverage + unknown_source + wallet_role
```

## Research Review Addendum

This spec was reviewed against AML graph-scoring and risk-scoring literature before implementation planning.

Research implications:

- AML scoring must be tied to the action unit. Transaction-level, deposit-level, wallet-level, actor-level, and subgraph-level queues can disagree even when built from the same data. The implementation must preserve scope instead of collapsing everything into one wallet number.
- AML systems should be evaluated as investigation queues under fixed review budgets, not only by a global score. Backtesting should report yield at budget, false-positive burden, queue overlap, and case fragmentation.
- AML on blockchains is often a subgraph/typology problem. Patterns such as split-merge, peeling-chain-like movement, fast cashout through services, and illicit-to-licit service paths should be modeled as typology candidates, not merely as address behavior sums.
- Qualitative risk matrices are useful for policy display but can mis-rank risks if ordinal bins are treated as arithmetic. This spec therefore uses winner-row aggregation and explicit caps.
- Probability calibration is a separate product. A policy score is not `P(bad)` unless validated with temporal labeled outcomes and calibration curves.
- Evidence fusion methods such as Bayesian or Dempster-Shafer are only appropriate after source reliability, evidence dependence, uncertainty, and conflict are explicit.
- FATF virtual-asset red flags support keeping transaction pattern, transaction size, sender/recipient profile, anonymity/service use, and source-of-funds indicators separate rather than summing them blindly.

Sources:

- Malik, 2026, actor-level vs transaction-level AML queue evaluation: https://arxiv.org/html/2604.23494v1
- Bellei et al., 2024, Elliptic2 subgraph AML representation learning: https://arxiv.org/html/2404.19109v2
- Naser Eddin et al., 2021/2022, AML alert optimization with graph features: https://arxiv.org/abs/2112.07508
- FATF, 2020, virtual asset red flag indicators: https://www.fatf-gafi.org/en/publications/Methodsandtrends/Virtual-assets-red-flag-indicators.html
- Cox, 2008, risk matrix limitations: https://pubmed.ncbi.nlm.nih.gov/18419665/
- Classifier probability calibration / reliability diagrams: https://scikit-learn.org/stable/modules/calibration.html
- Daniel, 2021, Bayesian and Dempster-Shafer fraud evidence fusion: https://arxiv.org/abs/2104.07440

## Score Products

Implementation must not expose only one ambiguous number internally.

Emit these separate products:

| Product | Type | Meaning |
|---|---|---|
| `policyScore` | `0-100` | Human-readable policy ladder from the winning evidence row. |
| `matrixDecision` | enum | `ACCEPTABLE`, `REVIEW`, `DECLINE`, or `INSUFFICIENT_EVIDENCE`. |
| `winningRow` | enum | Evidence row that controls the policy score. |
| `riskVector` | object | Per-row candidate scores before winner selection. |
| `uncertaintyState` | enum/object | Coverage, continuity, provider, and stale-data uncertainty. |
| `queuePriorityScore` | nullable number | Optional investigation ranking score once backtested. |
| `calibratedRiskProbability` | nullable number | Must stay `null` until trained/calibrated on labeled outcomes. |

Recommended distinction:

```text
policyScore: what policy says this evidence warrants
queuePriorityScore: how high this case should be in a finite analyst queue
calibratedRiskProbability: empirical probability, only after calibration
```

## Current System Inputs

The current code already produces useful evidence. The problem is not missing signals; it is that signals are not separated by proof strength.

### Modes

| Mode | Current role | Matrix role |
|---|---|---|
| `address_fast_check` | Fast labels, graph signals, behavior, AML signals | Provides hard proof labels and quick context. Cannot decide high risk from weak context alone. |
| `address_deep_check` | Deep profiles over service exposure, behavior, provenance, counterparties, roles, approvals | Provides most atomic signals and pattern candidates. |
| `where_is_money_check` | Balance/current/recent-flow provenance and source policy | Primary source-policy and origin-path evidence. |
| `incoming_deposit_check` | Deposit-scoped provenance with sender risk overlays | Scores the checked deposit amount, not the whole sender wallet. |

### Action Units

Every score must declare the action unit it applies to.

| Action unit | Examples | Scoring implication |
|---|---|---|
| `wallet` | address-level fast/deep check | Behavior and role context can describe the wallet, but deposit-specific provenance should not automatically label the whole wallet. |
| `incoming_deposit` | checked sender -> watched wallet tx | Score the checked amount and its source bundle. |
| `source_path` | where-is-money origin path | Score path/share/continuity evidence. |
| `transaction` | approval, transferFrom, monitored transfer | Useful as evidence; usually projected to wallet/deposit/action unit. |
| `actor_cluster` | linked addresses controlled by same actor | Future scope; needed for calibrated AML queues. |
| `subgraph_typology` | split-merge, peeling-like, illicit-to-licit service path | Typology candidate; review by itself, stronger when anchored to hard/source evidence. |

Projection rule:

```text
lower-level evidence can support a higher-level action unit only through an explicit projection operator:
max, noisy-or, capped-sum, top-k mean, or winner-row.
```

Default projection for this spec is winner-row with de-duplication by evidence episode.

### Current Aggregators To Replace Or Constrain

| Current component | Current behavior | Matrix correction |
|---|---|---|
| `riskPolicyEngine.decideRiskPolicy` | `insufficient_coverage` can create score `65` and user `DECLINE`. | Coverage is uncertainty, not badness. It can block `ACCEPTABLE`, but cannot create `60+`. |
| `riskPolicy.calculatePolicyScoreBreakdown` | Sums capped buckets into taint/laundering pattern score. | Keep only if each bucket maps to a row with explicit caps. No cross-row weak-signal summing. |
| `unifiedWalletRisk` | Uses weighted layer score plus floors and coverage floor. | Floors are useful, but final score should be winner-row based. Coverage floor must not be risk. |
| `unifiedIncomingDepositRisk` | Adds fresh-bundle floor and background score. | Fresh bundle source-policy can win. Background sender profile can only be context. |

## Evidence Rows

Every atomic signal must map to one evidence row.

| Evidence row | Band | Default decision | What it means |
|---|---:|---|---|
| `hard_proof` | `90-100` | `DECLINE` | Deterministic or exact bad evidence. |
| `source_policy` | `30-95` | Depends on source and share | Risky source exposure with path/share evidence. |
| `incoming_deposit_source_policy` | source-policy band | Depends on source and share | Checked deposit amount is funded by risky source exposure. |
| `service_linked_pattern` | `60-84` | `DECLINE` or `REVIEW` | High-volume pass-through to service infrastructure with a clear service/source anchor. |
| `route_linked_approval_pattern` | `60-80` | Usually `REVIEW` | Approval-drain route context without exact drain proof. |
| `asset_continuation` | `65-84` | `REVIEW` or `DECLINE` | Verified continuation across asset/chain with non-unknown token quality. |
| `typology_subgraph_pattern` | `45-84` | `REVIEW` or anchored `DECLINE` | Known laundering-like subgraph shape such as split-merge, peeling-like movement, smurfing-like structuring, or illicit-to-licit service path. |
| `contract_suspicion` | `35-59` | `REVIEW` | LLM or contract metadata suspicion without exact drain/source proof. |
| `counterparty_context` | `30-59` | `REVIEW` | Direct/derived risky counterparty context that is not exact source proof. |
| `behavior_only_prior` | `30-59` | `REVIEW` | Transit, fast exit, mule/collector, concentration without source proof. |
| `coverage_uncertainty` | no badness score | `REVIEW` or `INSUFFICIENT_EVIDENCE` | Missing graph, weak continuity, no previous transfer, budget exhaustion. |
| `clean_or_operational` | `0-29` | `ACCEPTABLE` or dampener | Clean CEX, operational liquidity, long-lived repeated relationship, trusted service context. |

## Hard Caps

These caps are mandatory:

- Behavior-only never reaches `60`.
- Unknown contract alone never reaches `60`.
- Unknown CEX alone never reaches `60`.
- Coverage uncertainty never creates `60+`.
- Typology-only without hard, source-policy, or clear service anchor never creates `60+`.
- Multiple signals from the same transaction, path, or funding episode do not stack as independent evidence.
- LLM contract suspicion alone never creates hard proof.
- Direct service-boundary context alone never creates source proof.
- Clean CEX and operational dampeners never reduce hard proof.
- Exact approval drain wins over all dampeners.
- Stablecoin blacklist, sanctions, and exact restrictions win over all dampeners.

## Decision States

The current `UserExchangeDecision` type only supports `ACCEPTABLE | DECLINE`. The matrix needs an internal analyst decision model:

```text
ACCEPTABLE
REVIEW
DECLINE
INSUFFICIENT_EVIDENCE
```

Implementation can map this to the existing user-facing API later, but the scoring layer must keep the distinction. `45 REVIEW`, `45 DECLINE`, and `45 INSUFFICIENT_EVIDENCE` are different outcomes.

Decision rules:

| Decision | Rule |
|---|---|
| `DECLINE` | Score `>=60` and winning row allows decline: hard proof, source-policy decline, strong service-linked/source-anchored pattern, or deposit-scoped hard/source proof. |
| `REVIEW` | Score `30-59`, or score `>=60` where proof is route-linked/contextual and not exact enough for auto-decline. |
| `INSUFFICIENT_EVIDENCE` | Source is not proven because coverage, continuity, or graph depth is weak. This is not a badness score. |
| `ACCEPTABLE` | Score `<30` with enough evidence to treat the checked scope as low risk. |

## Signal Catalog

### 1. Hard Proof Signals

These signals map to `hard_proof`.

| Atomic signal/code | Current source | Row score | Notes |
|---|---|---:|---|
| `stablecoin_usdt_blacklisted`, `usdt_blacklist` | `stablecoinRestriction`, fast/deep/incoming overlays | `95-100` | Use `100` when blacklist is active on subject or deposit sender. |
| `sanctioned_service` | cross-chain terminal, where hard evidence | `95-100` | Treat exact sanctioned path as hard-like. |
| `exact_taint`, `scam_or_blacklist`, `internal_label_scam`, `internal_label_reported_scam`, `internal_label_stolen_funds`, `internal_label_phishing`, `internal_label_risky_contract` | labels, where hard evidence | `90-95` | Direct subject/source label. |
| `approval_drain_exact`, `exact_approval_drain`, `forensic_approval_drain_provenance`, `approval_drain_exact_transfer_from` | approval drain provenance, where, fast/deep | `90-95` | Exact approval plus `transferFrom` path. |
| `deep_high_risk_inbound_provenance`, `deep_high_risk_extended_provenance` | deep provenance profiles | `85-94` | Exact labeled path with short/high-continuity path. |
| `incoming_fresh_risky_label_source` | incoming fresh bundle | `85-94` | Deposit-scoped hard/risky label source. |

Hard proof scoring:

| Condition | Score |
|---|---:|
| Active blacklist or sanction on subject/deposit source | `100` |
| Active blacklist or sanction on exact source path | `95-100` |
| Exact approval-drain provenance, 0-1 hop, direct amount proof | `95` |
| Exact approval-drain provenance with less complete context | `90-94` |
| Exact scam/taint source path | `90-95` |
| Exact high-risk extended provenance | `85-94` |

### 2. Source-Policy Signals

These signals map to `source_policy` or `incoming_deposit_source_policy`.

Source kinds currently present in code:

```text
htx_huobi
whitebit
bridge_router_dex
cross_chain_boundary
no_name_token_liquidity
mixer
sanctioned_service
unknown_contract
unknown_cex
allowlisted_cex
risky_label
```

Origin stop reasons currently present in code:

```text
allowlist_cex_reached
decline_boundary_reached
risky_label_reached
data_budget_exhausted
no_previous_transfer
no_incoming_transfers_seen
incoming_history_not_fetched
incoming_seen_but_below_continuity
weak_amount_or_time_continuity
unlabeled_service_boundary
```

Source-policy matrix:

| Source kind | Band | Auto-decline condition | Notes |
|---|---:|---|---|
| `sanctioned_service` | `95-100` | exact path | Hard-like. |
| `mixer` | `78-95` | material path/share | Source-policy unless exact sanctioned evidence exists. |
| `no_name_token_liquidity` | `70-88` | material path/share | Non-dampenable high source-policy row. |
| `risky_label` | `85-94` | exact labeled source path | Hard-like when label/path is exact. |
| `htx_huobi` | `30-85` | score `>=60` | Source-policy, not scam/drain proof. |
| `whitebit` | `30-60` | only at `60` | Medium source-policy risk. |
| `bridge_router_dex` | `10-78` | score `>=60` | Public-chain continuity stops at service boundary. |
| `cross_chain_boundary` | `10-78` | score `>=60` | Same share rules as bridge/router/DEX. |
| `unknown_contract` | `15-55` | never alone | Review context only unless corroborated. |
| `unknown_cex` | `35-50` | never alone | Review context only. |
| `allowlisted_cex` | `0-10` | never | Clean source row, can dampen context. |

Share bands:

| Kind | Share | Score |
|---|---:|---:|
| `htx_huobi` | `>=80%` | `85` |
| `htx_huobi` | `50-79%` | `78-82` |
| `htx_huobi` | `30-49%` | `68-75` |
| `htx_huobi` | `20-29%` | `60-68` |
| `htx_huobi` | `10-19%` | `55` |
| `htx_huobi` | `<10%` | `30-45` |
| `whitebit` | `>=50%` | `60` |
| `whitebit` | `30-49%` | `55` |
| `whitebit` | `10-29%` | `50` |
| `whitebit` | `5-9%` | `38` |
| `whitebit` | `<5%` | `30` |
| `bridge_router_dex`, `cross_chain_boundary` | `>=80%` | `78` |
| `bridge_router_dex`, `cross_chain_boundary` | `50-79%` | `70` |
| `bridge_router_dex`, `cross_chain_boundary` | `20-49%` | `59` cap |
| `bridge_router_dex`, `cross_chain_boundary` | `10-19%` | `45` |
| `bridge_router_dex`, `cross_chain_boundary` | `5-9%` | `30` |
| `bridge_router_dex`, `cross_chain_boundary` | `<5%` | `10-20` |
| `unknown_contract` | `>=50%` | `45-55` |
| `unknown_contract` | `20-49%` | `35-45` |
| `unknown_contract` | `10-19%` | `25-35` |
| `unknown_contract` | `<10%` | `15-25` |
| `unknown_cex` | `>=50%` | `50` |
| `unknown_cex` | `20-49%` | `45` |
| `unknown_cex` | `<20%` | `35` |

### 3. Incoming Deposit Signals

Incoming deposit scoring is deposit-scoped. It answers:

```text
What funded this checked deposit amount?
```

It does not directly answer:

```text
Is the sender wallet globally bad?
```

Current incoming overlay codes:

```text
incoming_fresh_htx_huobi_source
incoming_fresh_htx_huobi_context
incoming_fresh_risky_label_source
incoming_fresh_bridge_router_dex_source
incoming_fresh_unknown_contract_source
incoming_htx_huobi_corridor_context
incoming_service_corridor_context
incoming_wallet_exposure_profile
```

Deposit-source rules:

| Signal | Row | Score | Decision |
|---|---|---:|---|
| `incoming_fresh_risky_label_source` | `incoming_deposit_source_policy` | `85-94` | `DECLINE` |
| `incoming_fresh_htx_huobi_source`, share `>=70%` | `incoming_deposit_source_policy` | `85` | `DECLINE` |
| `incoming_fresh_htx_huobi_source`, share `30-69%` | `incoming_deposit_source_policy` | `70-82` | `DECLINE` |
| `incoming_fresh_htx_huobi_context`, share `10-29%` | `incoming_deposit_source_policy` | `55` | `REVIEW` |
| `incoming_fresh_bridge_router_dex_source`, share `>=50%` | `incoming_deposit_source_policy` | `70` | `DECLINE` |
| `incoming_fresh_bridge_router_dex_source`, share `20-49%` | `incoming_deposit_source_policy` | `59` cap | `REVIEW` |
| `incoming_fresh_unknown_contract_source`, share `>=50%` | `incoming_deposit_source_policy` | `45-55` | `REVIEW` |
| `incoming_htx_huobi_corridor_context`, share `<10%` | `counterparty_context` | `35-40` | `REVIEW` |
| `incoming_service_corridor_context` | `counterparty_context` | `30-40` | `REVIEW` |
| `incoming_wallet_exposure_profile` | `behavior_only_prior` | `0-20` | context only |

Deposit clean-source rules:

| Condition | Score | Decision |
|---|---:|---|
| Clean CEX covers `>=90%` of checked deposit source with strong continuity | `3-8` | `ACCEPTABLE` |
| Clean CEX covers `50-89%`; rest unknown but not suspicious | `15-25` | `ACCEPTABLE` or `INSUFFICIENT_EVIDENCE` |
| Clean CEX covers `<50%`; material unknown remainder | `30-40` | `INSUFFICIENT_EVIDENCE` |
| Transaction seed only, no prior source proof | `30-45` | `INSUFFICIENT_EVIDENCE` |

### 4. Approval and Drain Signals

Approval signals split into three rows.

| Signal/code | Row | Band | Notes |
|---|---|---:|---|
| `approval_drain_exact_transfer_from`, `forensic_approval_drain_provenance` | `hard_proof` | `90-95` | Exact approval plus transferFrom and path. |
| `approval_drain_route_linked`, `route_linked_approval_pattern` | `route_linked_approval_pattern` | `60-80` | Review unless exact proof is established. |
| `approval_drain_direct_receiver` | `route_linked_approval_pattern` or `hard_proof` | `65-90` | Hard only if exact transferFrom provenance is proven. |
| `approval_drain_amount_preserved` | modifier | in-band | Boosts exact/route-linked row only. |
| `multiple_exact_approval_drain_profiles` | modifier | in-band | Repetition boost for hard row. |
| `same_spender_cluster`, `same_receiver_cluster` | modifier/context | in-band | Not hard proof by itself. |
| `approval_unlimited_usdt` | `contract_suspicion` | `45-59` | Standalone approval risk, not theft proof. |
| `approval_very_large_finite_usdt` | `contract_suspicion` | `45-55` | Standalone approval risk. |
| `approval_large_finite_usdt` | `contract_suspicion` | `30-45` | Context. |
| `approval_spender_unknown_eoa` | modifier | in-band | Raises approval suspicion. |
| `approval_spender_risky_label`, `approval_provider_risky_contract` | `hard_proof` or `source_policy` | `90-95` | Depends on whether label is exact and applicable to spender/source. |
| `approval_provider_service_tag`, `approval_spender_service_label`, `approval_spender_trusted` | `clean_or_operational` | dampener | Lowers context-only approval suspicion. |

### 5. Contract and LLM Signals

Contract/LLM evidence is useful, but not deterministic unless tied to exact proof.

| Signal/code | Row | Band | Notes |
|---|---|---:|---|
| `llm_contract_suspicion`, verdict `drainer_like` | `contract_suspicion` | `50-59` | Cannot cross `60` without corroboration. |
| verdict `unknown_suspicious` | `contract_suspicion` | `35-49` | Review only. |
| verdict `unknown_insufficient_data` | `coverage_uncertainty` | no badness score | Insufficient evidence. |
| verdict `legitimate_service` | `clean_or_operational` | dampener | Can dampen unknown-contract context. |
| `contract_profile_provider_risk` | `contract_suspicion` or `hard_proof` | `60-90` | Hard only if provider label is exact risk label. |
| `contract_profile_unverified_source` | `contract_suspicion` | `20-35` | Weak context. |
| `contract_profile_young_contract` | `contract_suspicion` | `10-25` | Weak context. |
| `contract_profile_low_call_history` | `contract_suspicion` | `10-25` | Weak context. |
| `contract_intel_transferfrom_capable` | `contract_suspicion` | `15-35` | Capability, not abuse. |
| `contract_intel_owner_only_pull_pattern` | `contract_suspicion` | `15-40` | Context unless tied to drain. |
| `contract_intel_known_service_activity` | `clean_or_operational` | dampener | Lowers context only. |

### 6. Provenance Signals

Current codes include:

```text
forensic_darknet_exchange_provenance
forensic_whitebit_provenance
forensic_inbound_provenance
forensic_extended_provenance
inbound_provenance_darknet_exchange_direct
inbound_provenance_darknet_exchange_two_hop
inbound_provenance_whitebit_direct
inbound_provenance_whitebit_two_hop
inbound_provenance_direct_labeled_source
inbound_provenance_two_hop_labeled_source
inbound_provenance_amount_preserved
inbound_provenance_fast_transit
```

Rules:

| Provenance shape | Row | Band |
|---|---|---:|
| Direct exact high-risk source path, no service boundary | `hard_proof` or `source_policy` | `85-95` |
| Two-hop high-risk source path, strong continuity | `source_policy` | `70-90` |
| WhiteBIT direct/two-hop | `source_policy` | WhiteBIT share band |
| Darknet exchange direct/two-hop | `source_policy` or `hard_proof` | `60-90` depending label quality |
| Amount preserved | modifier | in-band |
| Fast transit | modifier | in-band |
| Service boundary reached before label | `coverage_uncertainty` or `counterparty_context` | no source proof |

### 7. Cross-Chain Signals

Current terminal boundaries:

```text
tornado_or_mixer
sanctioned_service
no_name_token_liquidity
bridge_boundary
dex_router_boundary
unknown_contract
data_exhausted
candidate_only
none
```

Current continuation evidence classes:

```text
protocol_correlated
strong_amount_time
split_join
weak_candidate
```

Rules:

| Terminal boundary | Row | Band | Notes |
|---|---|---:|---|
| `sanctioned_service` | `hard_proof` | `95-100` | Hard-like. |
| `tornado_or_mixer` | `source_policy` | `78-95` | Source-policy unless exact sanction proof. |
| `no_name_token_liquidity` | `source_policy` | `70-88` | Non-dampenable source-policy. |
| `bridge_boundary` | `source_policy` | bridge/cross-chain share band | Service boundary stops public-chain continuity. |
| `dex_router_boundary` | `source_policy` | bridge/router/DEX share band | Same. |
| `unknown_contract` | `source_policy` | `15-55` | Review only by itself. |
| `data_exhausted` | `coverage_uncertainty` | no badness score | Does not create decline. |
| `candidate_only` | `coverage_uncertainty` | `0-29` or review note | Candidate only. |
| `none` | no risk row | `0` | No terminal boundary. |

Cross-chain triggers such as `large_single_boundary`, `large_split_boundary`, `medium_direct_high_risk`, `drain_episode_bridge_exposure`, `deep_service_exposure_bridge`, and `manual_deep_mode` are search triggers. They are not final risk rows.

### 8. Service-Linked Pattern Signals

Current service exposure codes:

```text
service_exposure_high_volume
service_exposure_medium_volume
service_exposure_low_volume
service_exposure_bridge_preserved_amount
service_exposure_merged_high_volume
service_exposure_merged_bridge_preserved_amount
service_exposure_merged_fast_exit
service_exposure_merge_pattern
service_exposure_fast_exit
service_exposure_same_day_exit
service_exposure_24h_exit
service_exposure_repeated_exits
service_exposure_multiple_categories
service_exposure_unknown_contract
```

Service-linked pattern row:

| Condition | Score | Decision |
|---|---:|---|
| High-volume pass-through to bridge/router/DEX or unknown-contract service, `>=80%` service share, strong amount continuity | `75-84` | `DECLINE` if service/source anchor is clear |
| High-volume pass-through, `50-79%` service share | `68-75` | `DECLINE` or `REVIEW` depending anchor |
| Material service share `20-49%` | `55-59` | `REVIEW` |
| Service exposure without source/amount continuity | `30-49` | `REVIEW` |
| Known service/treasury context | dampener | no risk by itself |

Important rule:

```text
service exposure + pass-through can cross 60 only when there is a clear service/source anchor.
```

If it is merely "the wallet touches a service", it is context.

### 9. Typology And Subgraph Signals

Typology signals describe the shape of movement across a local graph, not just properties of one wallet.

Current/future typology candidates:

```text
fast_cashout_to_legitimate_service
split_merge_service_exit
peeling_chain_like_partial_exits
smurfing_like_many_small_flows
illicit_to_licit_service_path
risky_to_clean_service_path
```

Typology row:

| Condition | Row | Score | Decision |
|---|---|---:|---|
| Exact hard source plus typology | `hard_proof` or `source_policy` | hard/source band | `DECLINE` |
| Source-policy anchor plus typology, strong continuity | `source_policy` or `service_linked_pattern` | `70-84` | `DECLINE` or `REVIEW` by source policy |
| Clear service anchor plus strong typology, no risky source proof | `typology_subgraph_pattern` | `60-75` | `REVIEW`, `DECLINE` only if policy treats the service/source as decline-level |
| Strong typology only, no hard/source/service anchor | `typology_subgraph_pattern` | `45-59` | `REVIEW` |
| Weak typology candidate or incomplete graph | `coverage_uncertainty` or `behavior_only_prior` | `30-44` | `REVIEW` or `INSUFFICIENT_EVIDENCE` |

Typology is useful for queue priority and investigation routing. It is not hard proof by itself.

### 10. Boundary Exposure Signals

Current boundary codes:

```text
boundary_exposure_direct_service
boundary_exposure_two_hop_service
boundary_exposure_high_volume_context
boundary_exposure_fast_context
boundary_exposure_exchange_identity
boundary_exposure_continuity_stop
```

Boundary exposure is not source proof by default.

| Boundary shape | Row | Band |
|---|---|---:|
| Direct or two-hop service boundary context only | `counterparty_context` | `10-25` |
| High-volume boundary context | `counterparty_context` | `20-35` |
| Fast boundary context | modifier | in-band |
| Exchange/hot-wallet identity | `clean_or_operational` or `counterparty_context` | depends identity |
| Continuity stop | `coverage_uncertainty` | no badness score |

### 11. Behavior-Only Signals

Current address behavior codes:

```text
address_behavior_deposit_then_drain
address_behavior_large_inflow_preserved_outflow
address_behavior_fast_post_deposit_exit
address_behavior_drain_to_service_infrastructure
address_behavior_high_volume_transit
address_behavior_fan_in_fan_out
address_behavior_large_outgoing_concentration
address_behavior_top_counterparty_concentration
address_behavior_collector_like_wallet
```

Behavior scoring:

| Pattern | Required signals | Band | Notes |
|---|---|---:|---|
| Same-amount fast pass-through | fast exit + amount continuity + short path | `45-55` | Review only without source proof. |
| Extreme behavior-only wallet prior | fresh/new wallet + high turnover + concentration + fast outgoing | `55-59` | Highest behavior-only band. |
| Strong behavior-only wallet prior | high turnover or concentration with multiple behavior signals | `50-54` | Review. |
| Moderate behavior-only wallet prior | one or two behavior signals | `45-49` | Review. |
| Weak behavior context | generic transit or fan-in/out | `30-44` | Review or insufficient evidence. |

Examples:

```text
fast movement + high amount continuity + no risky source = 53 REVIEW
fast movement + risky source path = source_policy row, not behavior row
```

### 12. Operational Flow Signals

Current operational flow codes:

```text
operational_flow_high_terminal_liquidity_outgoing
operational_flow_medium_terminal_liquidity_outgoing
operational_flow_htx_huobi_outgoing
operational_flow_bridge_dex_router_outgoing
operational_flow_unknown_contract_outgoing
operational_flow_preserved_inflow_outflow
historical_transit_pattern
where_drain_episode_transit_pattern
```

Rules:

| Signal shape | Row | Band |
|---|---|---:|
| Historical transit with service share `>=20%`, pass-through, and large volume | `service_linked_pattern` | `60-84` |
| Drain episode transit to bridge/router/DEX | `service_linked_pattern` | `60-84` |
| HTX/Huobi outgoing flow only | `source_policy` only if it is source exposure | source band |
| Preserved inflow/outflow only | `behavior_only_prior` | `30-55` |
| Terminal liquidity to known clean service | `clean_or_operational` | dampener/context |

The `historicalTransitScore` formula can remain as a row scorer if it is only allowed to produce `service_linked_pattern` candidates and if eligibility requires a service/source anchor.

### 13. Counterparty Signals

Current counterparty evidence classes:

```text
exact_labeled_counterparty
derived_labeled_counterparty
counterparty_fast_risk_snapshot
counterparty_behavior_context
service_boundary_context
no_exact_label_or_cached_taint
provider_partial
```

Current direct counterparty codes:

```text
counterparty_direct_darknet_exchange
counterparty_direct_whitebit
counterparty_direct_darknet_exchange_proximity
counterparty_exposure_below_threshold
counterparty_service_boundary_context
forensic_counterparty_fast_snapshot_context
```

Rules:

| Counterparty shape | Row | Band |
|---|---|---:|
| Exact labeled counterparty is the actual source of funds | `source_policy` or `hard_proof` | `70-94` |
| Exact labeled counterparty is direct outbound only | `counterparty_context` | `45-59` |
| Derived labeled counterparty | `counterparty_context` | `35-55` |
| Fast snapshot only | `counterparty_context` | `30-55` |
| Counterparty behavior context | `behavior_only_prior` | `30-49` |
| Service boundary counterparty | `counterparty_context` | `0-25` |
| Provider partial | `coverage_uncertainty` | no badness score |

### 14. Wallet Role Signals

Current wallet roles:

```text
victim
drainer_spender
first_receiver
collector
mule
cashout_service
treasury_like
unknown
```

Rules:

| Role | Row | Band | Notes |
|---|---|---:|---|
| `victim` with exact approval-drain profile | context / no badness | `0-20` | Victim is not bad by itself. |
| `drainer_spender` exact | `hard_proof` | `90-95` | Exact approval-drain actor. |
| `first_receiver` exact | `hard_proof` | `90-95` | Exact first receiver in drain. |
| `drainer_spender` route-linked | `route_linked_approval_pattern` | `65-80` | Review unless exact. |
| `first_receiver` route-linked | `route_linked_approval_pattern` | `60-75` | Review unless exact. |
| `collector` behavior-only | `behavior_only_prior` | `40-55` | Cannot cross `60` alone. |
| `mule` behavior-only | `behavior_only_prior` | `45-59` | Cannot cross `60` alone. |
| `cashout_service` | `service_linked_pattern` or context | `30-70` | Needs flow/source anchor for `60+`. |
| `treasury_like` | `clean_or_operational` | dampener | Reduces behavior-only suspicion. |

### 15. Age, Relationship, and Dampener Signals

Current age signals:

```text
subject_long_lived
subject_new_large_wallet
sender_long_lived
relationship_repeated
relationship_new
dormancy_gap
```

Current behavior dampeners:

```text
known_service_or_treasury_dampener
long_lived_high_activity_wallet_dampener
regular_activity_dampener
low_context_dampener
unified_dampener
```

Rules:

| Signal | Effect |
|---|---|
| `subject_long_lived` | dampens weak/context rows by `4-8`. |
| `sender_long_lived` | dampens weak/context rows by `3-5`. |
| `relationship_repeated` | dampens weak/context rows by `4-8`. |
| `subject_new_large_wallet` | nudges behavior/source context up inside band by `2-6`. |
| `relationship_new` | nudges behavior/source context up inside band by `2-5`. |
| `dormancy_gap` | nudges behavior context up inside band by `4-8`. |
| `known_service_or_treasury_dampener` | dampens behavior-only and counterparty context by `10-25`. |
| `long_lived_high_activity_wallet_dampener` | dampens behavior-only by `10-20`. |
| `regular_activity_dampener` | dampens behavior-only by `8-15`. |
| `low_context_dampener` | lowers confidence; should usually push to `INSUFFICIENT_EVIDENCE`, not clean. |

Dampeners apply only to context, behavior, contract suspicion, and weak counterparty rows. They do not reduce hard proof or non-dampenable source-policy rows.

### 16. Coverage and Data Quality Signals

Current coverage/uncertainty indicators:

```text
limited_coverage_floor
insufficient_coverage
data_budget_exhausted
no_previous_transfer
no_incoming_transfers_seen
incoming_history_not_fetched
incoming_seen_but_below_continuity
weak_amount_or_time_continuity
provider_partial
candidate_only
unknown_insufficient_data
```

Rules:

| Signal | Matrix treatment |
|---|---|
| `limited_coverage_floor` | `INSUFFICIENT_EVIDENCE`, not risk floor. |
| `insufficient_coverage` | `INSUFFICIENT_EVIDENCE`, not `65 DECLINE`. |
| `data_budget_exhausted` | `INSUFFICIENT_EVIDENCE`; may preserve unresolved boundary note. |
| `no_previous_transfer` | `INSUFFICIENT_EVIDENCE` unless clean source is otherwise proven. |
| `no_incoming_transfers_seen` | `INSUFFICIENT_EVIDENCE` or low context. |
| `incoming_history_not_fetched` | `INSUFFICIENT_EVIDENCE`. |
| `incoming_seen_but_below_continuity` | low confidence; reduce row score or mark insufficient evidence. |
| `weak_amount_or_time_continuity` | in-band penalty; may block decline if source is not hard. |
| `provider_partial` | no badness score. |
| `candidate_only` | no source-policy proof. |
| `unknown_insufficient_data` | no badness score. |

Coverage uncertainty can block `ACCEPTABLE`, but cannot create `60+`.

## Modifiers

Modifiers move the score inside the winning row only.

### Share

| Share | Effect |
|---:|---|
| `>=80%` | top of row band |
| `50-79%` | high inside row band |
| `20-49%` | middle/context unless row has decline floor |
| `10-19%` | weak context |
| `<10%` | very weak context unless hard source |

### Hops

| Hops | Effect |
|---:|---|
| `0` | strong top-of-band modifier |
| `1` | strong modifier |
| `2` | moderate-high modifier |
| `3-5` | neutral or mild penalty |
| `6-12` | penalty unless very fast and continuous |
| `>12` | strong penalty |

### Speed

| Elapsed time | Effect |
|---:|---|
| `<=10 min` | strong boost |
| `<=1 hour` | boost |
| `<=6 hours` | mild boost |
| `<=24 hours` | small boost |
| `<=7 days` | neutral |
| `<=30 days` | penalty |
| `>30 days` | stale penalty |

### Amount Continuity

| Continuity | Effect |
|---:|---|
| `>=95%` | strong boost |
| `90-94%` | boost |
| `70-89%` | neutral or mild boost |
| `40-69%` | penalty |
| `<40%` | weak path |

### Repetition

| Paths | Effect |
|---:|---|
| `>=4` independent similar paths | boost |
| `2-3` paths | mild boost |
| `1` path | no repetition boost |

Repetition means independent evidence episodes after de-duplication. Repeated labels derived from the same transaction, same source path, or same funding bundle do not count.

### Coverage And Confidence

| Data quality | Effect |
|---|---|
| high coverage and confidence | no penalty |
| medium coverage/confidence | lower half of row band |
| low coverage/confidence | `INSUFFICIENT_EVIDENCE` unless hard proof exists |
| coverage stopped at service boundary | source continuity stops unless source-policy row explicitly handles the boundary |

## Evidence Dependence And De-Duplication

One fact can create many atomic signals. The matrix must score the underlying evidence episode once, at the highest applicable row.

Evidence episodes should be grouped by stable IDs such as:

```text
tx_hash
source_path_id
approval_drain_case_id
deposit_funding_bundle_id
cross_chain_corridor_id
counterparty_cluster_id
typology_subgraph_id
```

Rules:

- If several atomic signals come from the same episode, keep them as explanation, but let only the strongest row candidate from that episode affect the score.
- Apply repetition boosts only after episode de-duplication.
- If clean and risky explanations claim the same amount, resolve by exact amount/path attribution where possible.
- If the conflict cannot be resolved, mark `uncertaintyState` and prefer `REVIEW` or `INSUFFICIENT_EVIDENCE` over artificial precision.

## Winner-Row Algorithm

Implementation should use this order:

1. Build atomic signals from all modes.
2. Attach every atomic signal to an action unit and evidence episode.
3. Convert atomic signals into row candidates.
4. De-duplicate by evidence episode.
5. Score each row candidate inside its allowed band.
6. Apply row caps.
7. Apply dampeners only to dampenable rows.
8. Pick the highest-priority winning row:
   - hard proof;
   - source-policy / incoming deposit source-policy;
   - route-linked approval / asset continuation / service-linked pattern / typology subgraph pattern;
   - contract/counterparty/behavior context;
   - clean or insufficient evidence.
9. Apply decision rules.
10. Emit score products, action unit, winning row, atomic signals, modifiers, caps, dampeners, evidence episodes, uncertainty state, and caveats.

Suggested internal shape:

```typescript
type MatrixDecision =
  | "ACCEPTABLE"
  | "REVIEW"
  | "DECLINE"
  | "INSUFFICIENT_EVIDENCE";

type MatrixEvidenceRow =
  | "hard_proof"
  | "source_policy"
  | "incoming_deposit_source_policy"
  | "service_linked_pattern"
  | "route_linked_approval_pattern"
  | "asset_continuation"
  | "typology_subgraph_pattern"
  | "contract_suspicion"
  | "counterparty_context"
  | "behavior_only_prior"
  | "coverage_uncertainty"
  | "clean_or_operational";

type MatrixActionUnit =
  | "wallet"
  | "incoming_deposit"
  | "source_path"
  | "transaction"
  | "actor_cluster"
  | "subgraph_typology";

type MatrixCandidate = {
  row: MatrixEvidenceRow;
  actionUnit: MatrixActionUnit;
  score: number;
  decisionEligibility: "can_decline" | "review_only" | "insufficient_only" | "acceptable_only";
  evidenceIds: string[];
  evidenceEpisodeIds: string[];
  atomicSignals: string[];
  modifiers: string[];
  caps: string[];
  dampeners: string[];
  caveats: string[];
};

type MatrixScoringResult = {
  policyScore: number | null;
  matrixDecision: MatrixDecision;
  winningRow: MatrixEvidenceRow;
  actionUnit: MatrixActionUnit;
  riskVector: Record<MatrixEvidenceRow, MatrixCandidate[]>;
  uncertaintyState: Record<string, unknown>;
  queuePriorityScore: number | null;
  calibratedRiskProbability: number | null;
};
```

## Examples

### Fast Same-Amount Pass-Through

```text
Atomic signals:
- address_behavior_fast_post_deposit_exit
- address_behavior_large_inflow_preserved_outflow
- 0-1 hop
- <=1 hour
- no risky source proof

Winning row:
- behavior_only_prior

Score:
- 53

Decision:
- REVIEW

Why:
- Strong behavior-only case, but behavior-only is capped below 60.
```

### HTX/Huobi Deposit Source

```text
Atomic signals:
- incoming_fresh_htx_huobi_source
- source share 70%
- strong continuity

Winning row:
- incoming_deposit_source_policy

Score:
- 80

Decision:
- DECLINE

Why:
- Deposit amount has material source-policy exposure.
```

### Coverage Failure

```text
Atomic signals:
- insufficient_coverage
- data_budget_exhausted
- no_previous_transfer

Winning row:
- coverage_uncertainty

Score:
- no badness score, or low evidence score only for display

Decision:
- INSUFFICIENT_EVIDENCE

Why:
- Coverage did not prove clean source, but it also did not prove risky source.
```

### Unknown Contract Source

```text
Atomic signals:
- incoming_fresh_unknown_contract_source
- source share 87%
- approval-drain review finding exists
- exact drain provenance not proven

Winning row:
- incoming_deposit_source_policy / unknown_contract

Score:
- 55

Decision:
- REVIEW

Why:
- Top of unknown-contract band, but unknown contract alone cannot cross 60.
```

### Exact Approval Drain

```text
Atomic signals:
- approval_drain_exact_transfer_from
- forensic_approval_drain_provenance
- amount preserved
- 0 hop to checked wallet

Winning row:
- hard_proof

Score:
- 95

Decision:
- DECLINE

Why:
- Exact proof is non-dampenable.
```

## Queue Calibration And Backtesting

The matrix should ship first as an explainable policy scorecard. Threshold changes and queue ranking should be calibrated only after temporal backtesting.

Backtest protocol:

- Split evidence by time, not randomly, to avoid leakage from future labels or later cluster knowledge.
- Evaluate separately by action unit: wallet, incoming deposit, source path, transaction, actor cluster, and typology subgraph.
- Keep `policyScore` stable during the first implementation pass.
- Keep `queuePriorityScore` nullable until a finite review-budget model is backtested.
- Keep `calibratedRiskProbability` nullable until reliability diagrams show acceptable calibration.

Required metrics before changing thresholds:

| Metric | Why it matters |
|---|---|
| `yield@budget` / `precision@k` | Analyst queues are finite; top results matter more than average score. |
| `recall@FPR` | Measures how much true risk is retained at a fixed false-positive burden. |
| false-positive reduction | Verifies whether the matrix actually reduces noisy declines/reviews. |
| queue overlap / Jaccard | Shows whether wallet, deposit, actor, and typology queues produce the same cases or different work. |
| case fragmentation | Detects one actor or flow being split into many unrelated alerts. |
| calibration curve / Brier decomposition | Needed before any score is described as probability. |
| drift by time/source kind | Detects whether source-policy and typology rules age badly. |

Until this exists, `60` remains a policy threshold, not an empirically calibrated probability boundary.

## Implementation Notes

The implementation should preserve existing evidence collectors and change the scoring/aggregation layer first.

Minimum useful implementation sequence:

1. Add matrix decision types and candidate rows.
2. Build row candidates from current `WhereIsMoneyReport`, `DeepAddressForensicReport`, `RiskReport`, and `IncomingDepositRiskReport` inputs.
3. Attach candidates to action units and evidence episode IDs.
4. Replace `insufficient_coverage -> 65` behavior with `INSUFFICIENT_EVIDENCE`.
5. Enforce hard caps for behavior, unknown contract, unknown CEX, typology-only, and coverage.
6. Produce a scoring explanation object in every result.
7. Backtest against the 31-subject manual retro audit:
   - `docs/research/2026-06-30-manual-new-scoring-retro-audit.md`
8. Run temporal queue backtests before changing decline/review thresholds.

## Acceptance Criteria For The Future Implementation

- Exact blacklist and exact approval-drain examples remain `95-100 DECLINE`.
- Coverage-only old `65 DECLINE` cases become `INSUFFICIENT_EVIDENCE`.
- Behavior-only cases never reach `60`.
- Unknown-contract-only incoming cases never reach `60`.
- Typology-only cases without hard/source/service anchor never reach `60`.
- Clean CEX deposit cases with high source coverage score below `10`.
- Duplicate atomic signals from the same evidence episode do not stack.
- The result includes score products, action unit, winning row, atomic signals, modifiers, dampeners, caps, evidence IDs, evidence episode IDs, uncertainty state, and caveats.
- The 31-subject retro-audit can be represented without manual reinterpretation.
- Threshold changes require a backtest report with queue metrics and calibration diagnostics.
