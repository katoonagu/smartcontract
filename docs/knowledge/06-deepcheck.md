---
status: current
last_verified: 2026-07-03
owner_area: forensics
code_refs:
  - src/check/deepForensicCheck.ts
  - src/forensics/deepForensicJob.ts
  - src/risk/unifiedWalletRisk.ts
  - tests/check/deepForensicCheck.test.ts
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

DeepCheck can use a complete all-time subject index. When that index is
available and small enough to materialize, it considers the full direct
counterparty boundary instead of only the top incoming sender cap.

Direct all-time hard-evidence checks are implemented for direct counterparties.
The latest audited job for the current test address showed subject all-time
complete, 78 transfers, 41 direct wallets, and 41 direct hard-evidence checks.

Second-layer budget is wired into coverage metrics, but the actual second-layer
queue is not yet doing real work in the audited path: `secondLayerQueued` and
`secondLayerComplete` can remain `0` even when the active budget is `25`.

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
- second layer metrics must reflect real work, not empty counters;
- service-boundary stops should not be mixed with provider failures;
- diagnostic notes should be separated from real missing checks.

## Known Gaps

- Second-layer metrics are currently partial/planned, not proof of completed
  second-layer work.
- `missingChecks` mixes service-boundary stops, diagnostic notes, local limits,
  and provider failures.
- Large all-time subjects can fall back to bounded behavior when direct-boundary
  materialization would be too large.

## Relationship With Unified Score

DeepCheck contributes context and hard evidence to unified wallet risk.

Hard evidence from DeepCheck can raise score through floors. Weak service
exposure without hard evidence should not become a critical result by itself.
