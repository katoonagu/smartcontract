---
status: current
last_verified: 2026-07-23
owner_area: docs
code_refs:
  - scripts/verifyRemediationRelease.ts
  - scripts/finalizeUnifiedReleaseGates.ts
  - scripts/runUnifiedWalletCanary.ts
  - src/unifiedCheck
---

# Open Problems

## Release-Blocking Operations

The Unified implementation gap is closed. The following work remains because it
depends on a final candidate or explicit production authority:

- commit the consolidated candidate;
- run the fixed final gate set once and create exact-SHA write-once receipts;
- obtain explicit production GO and protected action authority;
- create the production backup, apply/verify schema 033, start the candidate,
  and activate the Unified generation fence through the existing protected
  flow;
- run the isolated recent-eight canary only after deployment and choose GO or
  the existing rollback/recovery path.

Production remains legacy until those operations complete.

## Post-Deploy Validation

- Observe provider fairness/coalescing and dense traversal with real traffic.
- Inspect `WAITING_FOR_PROVIDER`, watchdog recovery, and
  `DELIVERY_UNKNOWN` operational handling.
- Run live TBL7/TQr only as separate canaries if desired; never update their
  frozen Golden expected artifacts from live state.

## Non-Blocking Follow-Ups

- Recipient wallet precheck before signing.
- Additional Admin exploration and optional presentation refinements that do
  not change current acceptance contracts.
- Further provider/index performance tuning after measured post-deploy data.

These follow-ups do not expand Task 21 or add release gates.

## Anti-Loop Rule

Every rerun answers a changed input or diagnostic hypothesis. A repeated
identical failure becomes a specific blocker; it does not reopen completed
milestones or the whole plan.
