# Stage C C0-C6 Execution Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the approved Stage C design as seven independently reviewable, fail-closed slices and produce one human-approved acceptance receipt without changing scoring, checked-subject behavior, delivery, or Stage D.

**Architecture:** Treat Stage C as a dependency DAG. C1 proves the runtime observer independently; C0a unlocks physical/EOA authority and then C2-C4; C0b unlocks the cashflow producer and C5. C6 only verifies immutable receipts from those branches. No plan may substitute inference for missing authority or make another branch green by weakening its gate.

**Tech Stack:** TypeScript, Node.js/tsx, Vitest, PostgreSQL schema currently verified by the repository, existing canonical JSON hashing and Unified artifact repositories, Markdown/JSON audit artifacts.

---

## Governing design and verified boundary

Read before executing any slice:

- `docs/knowledge/AGENT_BRIEF.md`
- the knowledge files named by that slice
- `docs/superpowers/specs/2026-07-31-stage-c-runtime-blind-and-stage-d-exact-scoring-design.md`
- this execution index
- the slice plan itself

The implementation plans are:

1. `docs/superpowers/plans/2026-07-31-stage-c0-authority-feasibility.md`
2. `docs/superpowers/plans/2026-07-31-stage-c1-runtime-accepted-history-shadow.md`
3. `docs/superpowers/plans/2026-07-31-stage-c2-physical-service-authority.md`
4. `docs/superpowers/plans/2026-07-31-stage-c3-adverse-preservation.md`
5. `docs/superpowers/plans/2026-07-31-stage-c4-blind-validation.md`
6. `docs/superpowers/plans/2026-07-31-stage-c5-cashflow-authority-shadow.md`
7. `docs/superpowers/plans/2026-07-31-stage-c6-acceptance-closure.md`

Current production remains `snapshot-closure-v1/v2`, `scoring-signal-matrix-v4`, `ScoreAnchorV3`, with Stage C and cashflow disabled/offline. These plans add no checked-subject classifier. Manual or inferred subject role remains report context only and cannot suppress candidates, exact evidence, or score.

## Dependency DAG

```text
C1 runtime shadow ----------------------+--------------+
                                        |              |
C0a physical population -> C2 physical/EOA -> C3 adverse -> C4 blind --+
                                                                          +-> C6
C0b cashflow authority -------------------+-----------> C5 cashflow -----+
                                         +-- with C1 post-commit seam

C6 receipt + independent human Stage D approval -> a future D0 plan
```

- C1 can start immediately from the already accepted role-map/history proof.
- C2 must stop if C0a cannot prove sufficient physical, order, role, adverse, and historical-EOA authority.
- C3 consumes C2 contracts and may not broaden provider budgets.
- C4 samples only from the frozen C0a/C2/C3 admissible universe; feasibility data may not preselect favorable blind cases.
- C5 pure producer/selector work may start after C0b, but runtime integration waits for the single C1 post-commit seam. C5 must stop if C0b cannot produce at least one real authoritative `current_balance` control. A typed unavailable control is required too, but does not replace the complete control.
- C6 verifies receipts; it does not repair, recapture, adjudicate, or synthesize them.
- D0-D3 are deliberately absent. Starting Stage D requires completed C6, a separate human approval, and a new implementation plan.

## Cross-slice immutable contracts

All persisted JSON contracts must reject unknown keys, duplicate/unsorted IDs, non-canonical hashes, cross-variant fields, mismatched run/manifest/snapshot bindings, and fake empty hashes. Raw bytes must exactly match the owning schema's canonical writer; verifiers must call that writer (or the existing Golden artifact verifier) and must never normalize whitespace or append/remove a newline before hashing. C0-C3/C5/C6 writers use `canonicalizeArtifactJson`, and C4 uses Golden `canonicalJson`/`publishArtifactOnce`; both write UTF-8 canonical JSON with no added LF. All slice CLIs create output exclusively and refuse overwrite/symlinks.

Use existing `canonicalizeArtifactJson` and `fingerprintCanonicalArtifact`; do not add another serializer or hashing dependency. Each receipt records its schema version, policy versions, input artifact hashes, output artifact hashes, and `productionEffect:false` where applicable.

The following invariants are global:

- Stage C is score-neutral and delivery-neutral.
- The checked subject is excluded from the intermediate classifier.
- `non_service_profile` does not prove human control.
- `probable`, `service_like`, `professional_operator`, and `human_like` never stop traversal.
- Exact service identity uses its event-time-valid path and is not an inferred classifier label.
- C0 first commits a reviewed, classifier-free source-authority manifest, then derives the full eligible authority universe **within those frozen upstream sources** through a self-contained, code-owned, exhausted enumeration. The policy derives an exact required query/root identity set from audit run plus cutoff, and its page chains/fixed-query inventories reject both row omission and whole-root omission relative to that manifest; C0/C2 never accept caller-curated rows or trim the frozen universe to blind quotas. Only the committed future-seed C4 selection chooses exactly `15/3/3/3 + 6` cases. No claim is made about addresses outside the reviewed upstream source scope.
- Exact adverse evidence is preserved even when a service boundary would otherwise stop ordinary expansion.
- Missing, partial, current-only, timed-out, overflowed, or contradictory authority is `unresolved`; it is never `not_found` or `clean`.
- Standalone Stage C artifacts have zero references from accepted attempts, `EvidenceBundleV1`, score anchors, reports, and delivery.

## Deliberate Stage D handoff

These plans prepare real score impact without implementing it. C3 preserves exact terminal/path authority and C4 blind-adjudicates loss/false-stop behavior; after C6, a separate approved D0-D3 plan may transport only accepted exact adverse facts through `CanonicalFactV2 -> EvidenceBundleV2 -> matrix-v5 -> ScoreAnchorV4`. Manual/inferred roles and checked-subject role remain non-scoring. C5 cashflow remains standalone in the first D2 policy and cannot create or strengthen a scored fact until a later accepted cashflow-evidence transport/version exists. Thus Stage D can affect the real result and score, but C0-C6 cannot bypass the required scoring adjudication or silently change current v4 output.

## Commit and worktree discipline

- [ ] **Step 1: Work only from a clean master worktree**

Before each slice:

```powershell
git status --short --branch
git rev-parse --abbrev-ref HEAD
```

Expected: `master`, with no unrelated changes. Preserve the historical dirty checkout. If another slice is in progress, use a separate clean worktree and merge only a green commit.

- [ ] **Step 2: Make every task a small TDD commit**

Run the red test first, implement only the named contract, run the bounded green set, then commit. Never combine a failed feasibility capture with a policy relaxation.

- [ ] **Step 3: Update knowledge truth with behavior changes**

Every behavior-changing commit updates its relevant `docs/knowledge/*` page in the same commit. An honest feasibility blocker updates `10-open-problems.md`; a completed slice updates `09-current-decisions.md` and `14-current-roadmap.md`. Do not mark later slices complete early.

## Required execution order

- [ ] **Step 1: Run C0a and C0b as separate feasibility probes**

Expected outcomes are immutable receipts, not classifier output. Exit `0` means the minimum authority exists; exit `2` is an honest typed blocker; exit `1` means corrupt or invalid input. A C0b exit `2` leaves C1-C4 runnable but blocks C5/C6.

- [ ] **Step 2: Execute C1 independently**

The C1 enabled/disabled PostgreSQL comparison must prove identical authoritative bytes and zero accepted-attempt references to shadow artifacts. Do not modify finalizer or Admin production code.

- [ ] **Step 3: Execute C2, C3, then C4 after C0a is green**

C2 freezes the complete eligible physical-page/historical-EOA inventory with actual counts at or above every minimum; it does not preselect quota-sized cases. C3 consumes those exact bytes and proves complete adverse preservation. C4 first commits that full universe, exclusions, paired metric tape, quotas, and a still-future seed height; only after that block finalizes may it derive the seed and select exactly the new non-overlapping `24 + 6` corpus. Reviewer expectations are committed in a second clean pre-evaluation lock.

- [ ] **Step 4: Execute C5 after C0b is green**

C5 adds a production-owned tape-or-unavailable adapter and standalone runtime observer. Its first selector is only `/check + snapshot subject -> current_balance`; there is no amount threshold, `amount_only`, exact-episode routing, score, or accepted evidence transport.

- [ ] **Step 5: Execute C6 last**

C6 first builds an automated acceptance candidate. An independent reviewer then creates the human-acceptance document in a later review/commit. The verifier must exit `2` while that document is absent. It must not create or sign it.

## Global verification gate

- [ ] **Step 1: Run the complete non-database suite**

```powershell
npm.cmd run typecheck
npm.cmd test
git diff --check
```

Expected: typecheck and the full suite pass. This does not satisfy the database gate if PostgreSQL files were skipped.

- [ ] **Step 2: Run the disposable PostgreSQL Stage C suite explicitly**

```powershell
if ([string]::IsNullOrWhiteSpace($env:TEST_DATABASE_URL)) { throw "TEST_DATABASE_URL must name a disposable database" }
$env:UNIFIED_RELEASE_GATE_MODE = "1"
New-Item -ItemType Directory -Force -Path artifacts/stage-c | Out-Null
npx vitest run tests/unified-check/stageCAuthorityFeasibility.postgres.test.ts tests/unified-check/serviceRoleShadowRuntime.postgres.test.ts tests/unified-check/serviceBoundaryEvidenceCapture.postgres.test.ts tests/unified-check/serviceBoundaryAdverseProbe.postgres.test.ts tests/unified-check/cashflowShadowRuntime.postgres.test.ts tests/unified-check/stageCAcceptance.postgres.test.ts --reporter=json --outputFile=artifacts/stage-c/global-postgres-vitest.json
```

Expected: executed file count and test count are both greater than zero, failed count is zero, and skipped file/test counts are zero. The C6 tool hashes this exact receipt after validating it.

- [ ] **Step 3: Prove no production-effect paths**

Run the exact non-interference commands from C1 and C5, plus finalizer, Admin DAG, score-anchor, report, and delivery regressions named in those plans. Expected: authoritative enabled/disabled bytes match and every Stage C standalone artifact has zero accepted references.

- [ ] **Step 4: Build, review, and verify the C6 receipt**

Follow the C6 plan. A successful automated candidate is not Stage C acceptance until the separate human document is present and valid.

## Hard aborts

- Any proposal to infer missing physical, historical EOA, adverse, order, or balance authority, or to call a caller-curated/non-exhausted source subset the full population.
- Any change to matrix-v4, ScoreAnchorV3, behavioral candidates, report/delivery, or checked-subject suppression.
- Any automatic `500 + 100` expansion or new provider capacity/rate limiter.
- Any reuse of the legacy manual corpus as the new blind corpus.
- Any blind seed chosen after case outcomes are visible.
- Any C6 receipt that treats a skipped PostgreSQL file as executed.
- Any attempt to start Stage D from this plan suite.

## Completion

This plan suite is complete only when C0-C6 each have a green immutable receipt, the legacy `24/24 + 6/6` and new disjoint `24 + 6` gates pass, the real cashflow complete/unresolved controls exist, authoritative bytes are unchanged, the explicit PostgreSQL suite has zero skips, and an independent human acceptance document validates. Production activation and Stage D remain separate decisions.
