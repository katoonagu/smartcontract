---
status: current
last_verified: 2026-07-24
owner_area: docs
code_refs:
  - scripts/verifyRemediationRelease.ts
  - scripts/finalizeUnifiedReleaseGates.ts
  - scripts/runUnifiedWalletCanary.ts
  - src/unifiedCheck
---

# Open Problems

## External Blockers

The P0 runtime and P2 Admin progress implementation gaps are closed. The
following work depends on frozen evidence, human adjudication, a final
candidate, or explicit production authority:

- Capture canonical provider request identities and response pages for TPCP,
  TFWG, and TXc on the schema-033 runtime, then freeze the bundles. The saved
  recent-run logs contain request events but not response bodies, and their
  database predates `unified_provider_pages`; a truthful before/after matrix
  cannot be reconstructed from them.
- Blind-review/adjudicate the P1 positive and negative boundary cases before
  enabling those predicates or creating exact expected scores.

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
