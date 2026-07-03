---
status: current
last_verified: 2026-07-03
owner_area: forensics
code_refs:
  - src/check/deepForensicCheck.ts
  - src/forensics/deepForensicJob.ts
  - src/risk/unifiedWalletRisk.ts
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

## What DeepCheck Should See

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

## Current Product Direction

DeepCheck should become wider and more explicit:

- all direct counterparties should be considered for hard-evidence checks when
  budget allows;
- second layer metrics must reflect real work, not empty counters;
- service-boundary stops should not be mixed with provider failures;
- diagnostic notes should be separated from real missing checks.

## Relationship With Unified Score

DeepCheck contributes context and hard evidence to unified wallet risk.

Hard evidence from DeepCheck can raise score through floors. Weak service
exposure without hard evidence should not become a critical result by itself.
