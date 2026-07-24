---
status: current
last_verified: 2026-07-24
owner_area: docs
code_refs:
  - scripts/verifyRemediationRelease.ts
  - scripts/finalizeUnifiedReleaseGates.ts
  - scripts/runUnifiedWalletCanary.ts
  - src/unifiedCheck
  - docs/superpowers/specs/2026-07-24-unified-wallet-check-adaptive-rolling-planner-design.md
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
- update the protected release receipts and promotion/canary schema identity
  from 033 to 034 in Task 7;
- create the production backup, apply/verify through schema 034, start the
  candidate, and activate the Unified generation fence through the updated
  protected flow;
- run the isolated recent-eight canary only after deployment and choose GO or
  the existing rollback/recovery path.

Production remains legacy until those operations complete.

## Post-Deploy Validation

- Observe provider fairness/coalescing and dense traversal with real traffic.
- Inspect `WAITING_FOR_PROVIDER`, watchdog recovery, and
  `DELIVERY_UNKNOWN` operational handling.
- Run live TBL7/TQr only as separate canaries if desired; never update their
  frozen Golden expected artifacts from live state.

## Dense Traversal Capacity

The coordinator now persists the full distinct mandatory address-history batch
and consumes accepted results through atomic bounded ordered commit. The
current fallback policy intentionally admits only one canonical head, so a
dense run can still expose one claimable ordered history while the provider
pool has four configured slots. This is now an admission-policy limit rather
than a discovery or commit-ordering gap.

Migration 034, stable fairness-owner persistence, run-locked planning,
planner-aware claiming, atomic ordered acceptance, committed-manifest reuse,
and barrier ordered commit are implemented. The remaining target is adaptive
rolling admission and capacity control over the same tasks, planner rows,
artifacts, and commit path:

- `docs/superpowers/specs/2026-07-24-unified-wallet-check-adaptive-rolling-planner-design.md`

Until rolling admission, restart gates, replay equivalence, and the
one/four-group live canary pass, head-only barrier admission remains current
candidate execution behavior. Replay simulations above four groups prove
algorithmic behavior only; they do not prove live scaling on unavailable
provider groups.

## Non-Blocking Follow-Ups

- Recipient wallet precheck before signing.
- Additional Admin exploration and optional presentation refinements that do
  not change current acceptance contracts.
- Further provider/index performance tuning after the adaptive rolling
  baseline and measured live data.

These follow-ups do not expand Task 21 or add release gates.

## Anti-Loop Rule

Every rerun answers a changed input or diagnostic hypothesis. A repeated
identical failure becomes a specific blocker; it does not reopen completed
milestones or the whole plan.
