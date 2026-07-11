---
status: current
last_verified: 2026-07-11
owner_area: forensics
code_refs:
  - src/check/deepForensicCheck.ts
  - src/forensics/gasFreeSettlement.ts
  - src/forensics/directHardEvidence.ts
  - src/forensics/counterpartyRisk.ts
  - src/forensics/counterpartyInteraction.ts
  - src/forensics/flowCounterpartyProfile.ts
  - src/forensics/inboundProvenance.ts
  - src/forensics/deepForensicJob.ts
  - src/forensics/deepSecondLayerRelationship.ts
  - src/forensics/deepSecondLayerRefresh.ts
  - src/runtime/deepForensicRuntimeOptions.ts
  - src/risk/unifiedWalletRisk.ts
  - tests/check/deepForensicCheck.test.ts
  - tests/forensics/counterpartyRisk.test.ts
  - tests/forensics/counterpartyInteraction.test.ts
  - tests/forensics/flowCounterpartyProfile.test.ts
  - tests/forensics/inboundProvenance.test.ts
  - tests/forensics/directHardEvidence.test.ts
  - tests/forensics/deepForensicJob.test.ts
supersedes:
  - docs/project-walkthrough/06-check-modes-fast-deep-where-is-money.md
  - docs/superpowers/specs/2026-06-24-admin-deep-check-multihop-branch-map-design.md
  - docs/superpowers/specs/2026-06-28-admin-deepcheck-evidence-map-v1-design.md
---

# DeepCheck

## Role

DeepCheck builds a forensic profile of a wallet.

It answers:

```text
What does this wallet look like, who does it interact with, and are there
strong forensic risk signals?
```

It does not replace `Where is money`, because it does not always prove exact
source of funds for a specific amount.

## Current Behavior

DeepCheck scores non-boundary contracts as ordinary counterparties. A
`service` or `unknown_contract` category alone does not zero direct or
second-layer contribution; suppression requires `isBoundary=true` or another
explicit evidence policy.

DeepCheck resolves exact GasFree economic roles on direct edges. Principal and
unmatched movements remain ordinary risk-eligible edges. Only a structurally
exact `tron_gasfree` `service_fee` edge is excluded from counterparty diversity,
campaign counts, service exposure, and ordinary risk propagation. The fee still
remains visible in gross transfer and debit facts.

DeepCheck groups direct principal transfers by counterparty and direction
before live screening. Exact GasFree service-fee edges are excluded from these
groups, but a GasFree account or contract that sends or receives principal is
checked like any other address. The material set is sorted by combined
principal amount before the live lookup limit is applied, so insertion order
does not decide which counterparties are checked.

Fresh reports persist typed `firstHopBlacklistFacts`, `firstHopLabelFacts`, and
`firstHopBlacklistCoverage`. A blacklist fact keeps the counterparty,
direction, principal amount/count/share, direct transfer ids, current official
USDT state, verified event chronology when available, and the split between
transfers before, during, or at unknown blacklist timing. A complete subject
index gives `all_time` coverage; a bounded path records the exact checked
window and stays partial.

First-hop coverage is saved even when no adverse fact is found. It distinguishes
checked, failed, and unchecked material counterparties and separates direct
transfer completeness from timeline completeness. Therefore an incomplete
negative result is not a clean result: when this coverage is required and no
independent positive policy fact exists, unified scoring returns
`NO_FINAL_DECISION`. A confirmed active-blacklist relationship remains an
independent positive fact even if unrelated coverage is partial; the
limitation is preserved beside the decision.

DeepCheck can use a complete all-time subject index. When that index is
available and small enough to materialize, it considers the full direct
counterparty boundary instead of only the top incoming sender cap.

Direct all-time hard-evidence checks are implemented for direct counterparties.
The latest audited job for the current test address showed subject all-time
complete, 78 transfers, 41 direct wallets, and 41 direct hard-evidence checks.

Selected second-layer relationship expansion is implemented for fresh
DeepCheck jobs when the runtime budget is positive. Background runtime uses the
index-specific second-layer budget when configured; otherwise it falls back to
the Admin second-layer budget. The July 4, 2026 verification job
`49ee8ad4-ed10-4a5f-b7da-3ab41cbefa61` produced
`secondLayerRelationshipProfiles` with `paths=6`, `groups=1`, and
`directWalletsConsidered=48`.

Admin `Full evidence` mode is the current default for completed DeepCheck
graphs. It uses the full graph API payload rather than the compact summary
projection, so second-layer nodes and edges remain visible when the backend has
saved them. Manual `Investigative view` and `Compact summary` remain available
for reading dense graphs at lower detail.

DeepCheck separates canonical USDT transfers from wrapper-driven incoming
activity in its contract-driven campaign summary. When the subject incoming set
is within transaction-info enrichment budget, DeepCheck reports denominator
counters such as total incoming tx, enriched incoming tx, plain USDT transfer
tx, wrapper-driven tx, Verify20 tx, exact approval-drain profile count, and
campaign clusters. Partial enrichment is marked as lower-bound context.

## Planned Behavior

DeepCheck should inspect:

- subject wallet;
- direct incoming and outgoing counterparties;
- important service boundaries;
- known exchanges and services;
- contracts and routers;
- approval-drain signals;
- hard evidence;
- selected second-layer relationships;
- missing checks and coverage.

DeepCheck should become wider and more explicit:

- all direct counterparties should be considered for hard-evidence checks when
  budget allows;
- second layer metrics must remain tied to real relationship work, not empty
  counters;
- service-boundary stops should not be mixed with provider failures;
- diagnostic notes should be separated from real missing checks.

## Known Gaps

- Old DeepCheck jobs created before second-layer relationship profiles existed
  do not gain those profiles automatically unless they already contain pending
  second-layer state or are rerun.
- Compact Admin views can still collapse DeepCheck evidence intentionally, but
  the default `Full evidence` view should expose the full API node/edge payload.
- `missingChecks` mixes service-boundary stops, diagnostic notes, local limits,
  and provider failures.
- Large all-time subjects can fall back to bounded behavior when direct-boundary
  materialization would be too large.

## Relationship With Unified Score

DeepCheck contributes context and hard evidence to unified wallet risk.

Hard evidence from DeepCheck can raise score through floors. Weak service
exposure without hard evidence should not become a critical result by itself.
