---
status: current
last_verified: 2026-07-25
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
- create the production backup, apply/verify through additive schema 035, start the
  candidate, and activate the Unified generation fence through the updated
  protected flow;
- run the isolated recent-eight canary only after deployment and choose GO or
  the existing rollback/recovery path.
- run the adaptive live capacity-one matrix and the three named isolated
  wallets, repeat it at capacity four only after four independent groups are
  audited, and capture the target Linux/cgroup memory gate;
- provision the protected adaptive signing authority matching the pinned
  public-key identity and create the canonical signed adaptive promotion
  receipt from those real
  artifacts. Local WSL samples cannot close this blocker.

Production remains legacy until those operations complete.

## Post-Deploy Validation

- Observe provider fairness/coalescing and dense traversal with real traffic.
- Inspect `WAITING_FOR_PROVIDER`, watchdog recovery, and
  `DELIVERY_UNKNOWN` operational handling.
- Run live TBL7/TQr only as separate canaries if desired; never update their
  frozen Golden expected artifacts from live state.

## Dense Traversal Capacity

The coordinator persists the full distinct mandatory address-history batch,
consumes accepted results through atomic bounded ordered commit, and supports
durable adaptive rolling admission. The provider pool follows healthy
independent-group capacity, eligible demand, owner/run fairness, repair reserve,
and runtime guards. Lane/owner/run permits and epoch-guarded idle-slot
assignment prevent mixed-lane collapse and stale chunk-boundary restart.
Deterministic simulation covers capacities through 100, including cooldown,
slow head, buffer pressure, repair arrival, and restart.

Migration 034, its protected release/schema gates, stable fairness-owner
persistence, run-locked planning, planner-aware claiming, atomic ordered
acceptance, committed-manifest reuse, adaptive capacity, reconciliation, and
the serialized production barrier fallback are implemented:

- `docs/superpowers/specs/2026-07-24-unified-wallet-check-adaptive-rolling-planner-design.md`

The exact claim-permit, restart recovery, ordered commit/refill, hot
barrier-fallback, frozen replay oracle, and logical-capacity tests pass.
The earlier fixed-four-slot architecture problem is resolved: capacity now
comes from healthy independent groups, eligible demand, and resource guards.
Until the one/four-group live benchmark and target-Linux signed promotion
evidence pass, the global barrier stage remains configured. Simulation above
the audited live ceiling proves algorithmic behavior only; the real saturation
point, head-of-line loss, provider RPS, and next DB/CPU/memory bottleneck remain
unverified.

Order-independent merge remains deferred. It becomes a candidate only if
measured `canonical_head` or `merge_buffer_full` loss materially limits the
ordered design.

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
