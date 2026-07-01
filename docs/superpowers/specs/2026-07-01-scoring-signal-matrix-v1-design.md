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

## Current System Inputs

The current code already produces useful evidence. The problem is not missing signals; it is that signals are not separated by proof strength.

### Modes

| Mode | Current role | Matrix role |
|---|---|---|
| `address_fast_check` | Fast labels, graph signals, behavior, AML signals | Provides hard proof labels and quick context. Cannot decide high risk from weak context alone. |
| `address_deep_check` | Deep profiles over service exposure, behavior, provenance, counterparties, roles, approvals | Provides most atomic signals and pattern candidates. |
| `where_is_money_check` | Balance/current/recent-flow provenance and source policy | Primary source-policy and origin-path evidence. |
| `incoming_deposit_check` | Deposit-scoped provenance with sender risk overlays | Scores the checked deposit amount, not the whole sender wallet. |

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

### 9. Boundary Exposure Signals

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

### 10. Behavior-Only Signals

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

### 11. Operational Flow Signals

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

### 12. Counterparty Signals

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

### 13. Wallet Role Signals

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

### 14. Age, Relationship, and Dampener Signals

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

### 15. Coverage and Data Quality Signals

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

### Coverage And Confidence

| Data quality | Effect |
|---|---|
| high coverage and confidence | no penalty |
| medium coverage/confidence | lower half of row band |
| low coverage/confidence | `INSUFFICIENT_EVIDENCE` unless hard proof exists |
| coverage stopped at service boundary | source continuity stops unless source-policy row explicitly handles the boundary |

## Winner-Row Algorithm

Implementation should use this order:

1. Build atomic signals from all modes.
2. Convert atomic signals into row candidates.
3. Score each row candidate inside its allowed band.
4. Apply row caps.
5. Apply dampeners only to dampenable rows.
6. Pick the highest-priority winning row:
   - hard proof;
   - source-policy / incoming deposit source-policy;
   - route-linked approval / asset continuation / service-linked pattern;
   - contract/counterparty/behavior context;
   - clean or insufficient evidence.
7. Apply decision rules.
8. Emit score, decision, winning row, atomic signals, modifiers, caps, dampeners, and caveats.

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
  | "contract_suspicion"
  | "counterparty_context"
  | "behavior_only_prior"
  | "coverage_uncertainty"
  | "clean_or_operational";

type MatrixCandidate = {
  row: MatrixEvidenceRow;
  score: number;
  decisionEligibility: "can_decline" | "review_only" | "insufficient_only" | "acceptable_only";
  evidenceIds: string[];
  atomicSignals: string[];
  modifiers: string[];
  caps: string[];
  dampeners: string[];
  caveats: string[];
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

## Implementation Notes

The implementation should preserve existing evidence collectors and change the scoring/aggregation layer first.

Minimum useful implementation sequence:

1. Add matrix decision types and candidate rows.
2. Build row candidates from current `WhereIsMoneyReport`, `DeepAddressForensicReport`, `RiskReport`, and `IncomingDepositRiskReport` inputs.
3. Replace `insufficient_coverage -> 65` behavior with `INSUFFICIENT_EVIDENCE`.
4. Enforce hard caps for behavior, unknown contract, unknown CEX, and coverage.
5. Produce a scoring explanation object in every result.
6. Backtest against the 31-subject manual retro audit:
   - `docs/research/2026-06-30-manual-new-scoring-retro-audit.md`

## Acceptance Criteria For The Future Implementation

- Exact blacklist and exact approval-drain examples remain `95-100 DECLINE`.
- Coverage-only old `65 DECLINE` cases become `INSUFFICIENT_EVIDENCE`.
- Behavior-only cases never reach `60`.
- Unknown-contract-only incoming cases never reach `60`.
- Clean CEX deposit cases with high source coverage score below `10`.
- The result includes winning row, atomic signals, modifiers, dampeners, caps, evidence IDs, and caveats.
- The 31-subject retro-audit can be represented without manual reinterpretation.
