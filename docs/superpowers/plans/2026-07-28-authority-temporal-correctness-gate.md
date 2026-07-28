# Authority And Event-Time Correctness Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four confirmed authority and temporal defects without recalculating historical results or changing Unified traversal policy.

**Architecture:** Keep the fixes independent and fail closed. Exact approval-drain authority must come from retained direct provenance, blacklist decisions must bind to state at the transfer event, decoded blacklist signatures are only semantic corroboration of a verified official log, and sanctions time becomes an explicit three-state value. Land each fix separately, then run one combined Golden/regression gate.

**Tech Stack:** TypeScript 5.7, Node.js, Vitest, PostgreSQL-backed repository tests where applicable, existing canonical forensic types and knowledge docs.

---

## Exact File Map

### Approval-drain authority

- Modify: `src/forensics/approvalDrainProvenance.ts`
  - Export the one subject-aware direct-profile authority predicate and emit exact and route-linked observations under different authority codes.
- Modify: `src/forensics/deepForensicJob.ts`
  - Persist a derived approval-drain assertion only for `exact_approval_and_transfer_from`.
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`
  - Build hard approval-drain evidence only from exact profiles and accept risky-label paths only when their originating label identity is retained.
- Modify: `src/forensics/moneyOriginAttribution.ts`
  - Host the low-level exact-label/path authority predicate already shared by policy and scoring, avoiding a dependency cycle or new module.
- Modify: `src/forensics/moneyOriginPolicy.ts`
  - Remove the flat approval-proximity label from exact stop authority and bind genuine risky-label paths to their source label.
- Modify: `src/forensics/provenanceScoring.ts`
  - Stop inferring `risky_label` exposure from legacy `rootSourceType` alone.
- Modify: `src/forensics/incomingDepositJob.ts`
  - Stop treating an unbound legacy `risky_label` path as hard incoming evidence.
- Modify: `src/forensics/contractDrivenEvidence.ts`
  - Count/render an exact contract-driven approval receiver only through the shared direct predicate.
- Modify: `src/admin/forensicsGraph.ts`
  - Apply the shared subject/hop-aware predicate and recompute exact receiver counts instead of trusting saved aggregates.
- Modify: `src/check/whereIsMoneyCheck.ts`
  - Delete the unused score-only decline calculation that ignores evidence strength.
- Modify: `src/risk/fastEvidence.ts`
  - Remove the flat `internal_label_approval_drain_proximity` code from exact Fast authority and centralize reason-level exact authority.
- Modify: `src/risk/riskPolicy.ts`
  - Classify the flat proximity label as bounded provenance context and require authoritative reason-level evidence for the 95 floor.
- Modify: `src/risk/riskEngine.ts`
  - Stop describing the flat label as exact proof and bound its initial impact to context.
- Modify: `src/risk/evaluation.ts`
  - Remove the flat label's critical-severity promotion.
- Modify: `src/bot/createBot.ts`
  - Bind reconstructed direct Fast evidence to the matching retained raw evidence and render flat markers as context.
- Modify: `src/bot/walletNarrativeSummary.ts`
  - Keep the flat marker out of exact narrative copy.
- Modify: `src/bot/riskExplanationSummary.ts`
  - Reserve exact approval wording for direct profiles/evidence.
- Modify: `src/bot/wherePreliminaryNarrative.ts`
  - Make preliminary Fast copy use reason-level authority rather than code alone.
- Modify: `src/alerts/notificationSummaries.ts`
  - Keep standalone Deep compact summaries subject-aware and direct-only.
- Modify: `tests/forensics/approvalDrainProvenance.test.ts`
- Modify: `tests/forensics/deepForensicJob.test.ts`
- Modify: `tests/forensics/moneyOriginOperationalAssessment.test.ts`
- Modify: `tests/forensics/moneyOriginPolicy.test.ts`
- Modify: `tests/forensics/provenanceScoring.test.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`
- Modify: `tests/forensics/contractDrivenEvidence.test.ts`
- Modify: `tests/forensics/moneyOriginLlmIsolation.acceptance.test.ts`
- Modify: `tests/check/whereIsMoneyCheck.test.ts`
- Modify: `tests/check/manualCheck.test.ts`
- Modify: `tests/risk/fastEvidence.test.ts`
- Modify: `tests/risk/riskPolicy.test.ts`
- Modify: `tests/risk/riskEngine.test.ts`
- Modify: `tests/risk/evaluation.test.ts`
- Modify: `tests/risk/unifiedWalletRisk.test.ts`
- Modify: `tests/risk/scoringSignalMatrixInputs.test.ts`
- Modify: `tests/bot/createBot.test.ts`
- Modify: `tests/bot/walletNarrativeSummary.test.ts`
- Modify: `tests/bot/wherePreliminaryNarrative.test.ts`
- Create: `tests/bot/riskExplanationSummary.test.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`

### Blacklist log semantics

- Modify: `src/tron/usdtBlacklistTimeline.ts`
  - Parse the one-address event declaration semantically while retaining all topic, contract, result, confirmation, block, log-index and timestamp checks.
- Modify: `tests/tron/usdtBlacklistTimeline.test.ts`
- Modify: `tests/tron/tronClient.test.ts`

### Blacklist event-time eligibility

- Modify: `src/types.ts`
  - Retain the internal directional bigint denominator and add one backward-compatible persisted string field to new first-hop facts.
- Modify: `src/forensics/directHardEvidence.ts`
  - Reuse one pure temporal partition helper in fact production and scoring validation.
- Modify: `src/check/deepForensicCheck.ts`
  - Accept legacy persisted facts but validate the additive denominator when present.
- Modify: `src/risk/scoringSignalMatrixInputs.ts`
  - Derive the eligible active subset from bound direct transfers and require the incoming transaction itself to be active.
- Modify: `tests/forensics/directHardEvidence.test.ts`
- Modify: `tests/forensics/deepForensicJob.test.ts`
- Modify: `tests/check/deepForensicCheck.test.ts`
- Modify: `tests/risk/scoringSignalMatrixInputs.test.ts`
- Modify: `tests/risk/unifiedWalletRisk.test.ts`
- Modify: `tests/risk/scoreAnchorV2.acceptance.test.ts`
- Modify: `tests/risk/remediationScoringCompatibility.test.ts`
- Modify: `tests/bot/createBot.test.ts`
- Modify: `tests/fixtures/forensics/directBlacklistCases.ts`

### Sanctions time

- Modify: `src/forensics/sanctionedServiceRegistry.ts`
  - Replace boolean default-active time evaluation with `active | inactive | unknown`.
- Modify: `src/forensics/moneyOriginPolicy.ts`
- Modify: `src/forensics/directHardEvidence.ts`
- Modify: `src/forensics/provenanceScoring.ts`
- Modify: `src/bot/walletNarrativeSummary.ts`
- Modify: `src/risk/scoringSignalMatrixInputs.ts`
  - Reject saved local sanctions artifacts unless they overlap one registry-bound path proven active at its first event.
- Modify: `src/bot/createBot.ts`
- Modify: `src/bot/riskExplanationSummary.ts`
- Modify: `tests/forensics/moneyOriginPolicy.test.ts`
- Create: `tests/forensics/sanctionedServiceRegistry.test.ts`
- Modify: `tests/forensics/directHardEvidence.test.ts`
- Modify: `tests/forensics/provenanceScoring.test.ts`
- Modify: `tests/bot/walletNarrativeSummary.test.ts`
- Modify: `tests/risk/scoringSignalMatrixInputs.test.ts`
- Modify: `tests/bot/createBot.test.ts`

### Product truth and release gate

- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/05-where-is-money-and-incoming.md`
- Modify: `docs/knowledge/06-deepcheck.md`
- Modify: `docs/knowledge/07-risk-scoring-matrix.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`
- Modify: `docs/knowledge/14-current-roadmap.md`
- Modify only if a new recurring agent error is discovered: `docs/knowledge/13-agent-observations.md`

No migration, new dependency, new scoring row, historical backfill, Unified
policy version, or Telegram delivery ownership/lifecycle change belongs in this
plan. Authority-correct final wording is in scope.

`src/telegram/forensicPresentation.ts` deliberately remains unchanged. Its V1
registry must continue decoding historical persisted facts; current authority is
rechecked by risk composition and final presentation instead of deleting legacy
rendering support.

## Task 0: Establish the isolated baseline

- [ ] **Step 1: Create or enter the dedicated implementation worktree**

Do not implement in the current dirty checkout. Record the base and prove that the worktree contains no unrelated changes:

```powershell
git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'correctness_git_head_failed' }
$baselineStatus = @(git status --short)
if ($LASTEXITCODE -ne 0) { throw 'correctness_git_status_failed' }
if ($baselineStatus.Count -ne 0) { $baselineStatus; throw 'correctness_worktree_dirty' }
```

Expected: the recorded SHA includes this plan; `git status --short` is empty in the implementation worktree. Do not clean, reset, or move files from the user's existing checkout.

- [ ] **Step 2: Read current product truth before editing**

Read, in full:

```text
docs/knowledge/AGENT_BRIEF.md
docs/knowledge/02-check-modes.md
docs/knowledge/03-job-lifecycle.md
docs/knowledge/04-data-sources-tronscan-indexing.md
docs/knowledge/05-where-is-money-and-incoming.md
docs/knowledge/06-deepcheck.md
docs/knowledge/07-risk-scoring-matrix.md
docs/knowledge/09-current-decisions.md
docs/knowledge/10-open-problems.md
docs/knowledge/13-agent-observations.md
docs/knowledge/14-current-roadmap.md
docs/superpowers/specs/2026-07-28-correctness-stage-b-unified-latency-design.md
```

- [ ] **Step 3: Prove the current contracts are green before changing expectations**

```powershell
npm.cmd test -- tests/forensics/deepForensicJob.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/forensics/moneyOriginPolicy.test.ts tests/forensics/provenanceScoring.test.ts tests/forensics/incomingDepositJob.test.ts tests/admin/forensicsGraph.test.ts tests/risk/fastEvidence.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/tron/usdtBlacklistTimeline.test.ts
if ($LASTEXITCODE -ne 0) { throw 'correctness_baseline_tests_failed' }
```

Expected: PASS. This is only a baseline; several passing assertions intentionally encode the four defects.

## Task 1: Keep route-linked and flat approval evidence contextual

- [ ] **Step 1: Turn the confirmed defect into negative regressions**

Change the route-linked case in `tests/forensics/deepForensicJob.test.ts` so it still expects the profile in the completed report, but expects no call to `upsertAddressLabelAssertion` and no derived approval-drain label:

```ts
expect(upsertAddressLabelAssertion).not.toHaveBeenCalled();
expect(completeForensicCheckJob.mock.calls[0][0].resultJson).toMatchObject({
  approvalDrainProvenanceProfiles: [
    expect.objectContaining({
      evidenceStrength: "route_linked",
      score: 80
    })
  ],
  derivedLabel: null,
  derivedLabels: []
});
```

Add or update the operational-assessment regression so a route-linked-only profile produces no `approval_drain` hard evidence, no `exact_approval_drain_provenance` proof level and no independent decline. Retain the exact-profile positive case.

Add a second fail-closed regression family for the already-persisted flat label:

- `classifyMoneyOriginStop` must not stop on `approval_drain_proximity`, while a genuine `scam` label still returns a bound `risky_label` stop;
- a stale `MoneyOriginPath` whose `rootSourceType` is `risky_label` but which lacks the originating exact label key/kind must create no `scam_or_blacklist` hard evidence and no matrix decline;
- that stale path must contribute zero risky-label source-bundle share, must not
  authorize a saved `sourcePolicyEvidence`/risk-layer decline and must not be
  selected for broad-history fallback merely because of its old root type;
- a mixed incoming bundle with `1%` linked authoritative risky share plus `19%`
  stale/unbound risky aggregate must remain below the `10%` decline threshold;
  a linked authoritative share of at least `10%` retains the positive policy
  candidate;
- Incoming reconstruction must not translate that stale path into `hard_decline` or `hard_risk_reached`; a newly produced, bound `scam` path retains both behaviours.

In `tests/forensics/contractDrivenEvidence.test.ts`, add route-only and forged
exact-hop-one profiles for the checked subject. Both must produce exact receiver
count `0`, no hard evidence and no “Exact approval-drain receiver” copy. Retain
the valid direct positive.

In `tests/admin/forensicsGraph.test.ts`, add a route profile, a forged
`exact_approval_and_transfer_from` hop-one profile and a saved
`contractDrivenReceiverProfile.exactApprovalDrainCount > 0` without any direct
profile for the checked subject. They may remain graphable context, but none may
create hard drainer/victim node intelligence, a risk/`DECLINE` edge/path,
drainer-campaign aggregation or hard receiver classification. Retain a direct
hop-zero subject-bound positive.

Replace the flat-label expectations in the Fast, risk-policy, risk-engine, evaluation, Unified and zero-balance Where tests with this common contract:

```ts
expect(isExactFastHardEvidenceCode("internal_label_approval_drain_proximity")).toBe(false);
expect(exactFastHardEvidence(report(95, "internal_label_approval_drain_proximity"))).toEqual([]);
expect(policyForReason(reason("internal_label_approval_drain_proximity", 95))).toMatchObject({
  dimension: "provenance",
  evidenceClass: "weak_inferred",
  hardEvidence: false,
  cap: 80
});
```

The Unified regression must expect `hardEvidenceFloor === 0` and `hasUnifiedFastHardEvidence(...) === false`. The Where zero-balance regression must expect `REVIEW`, `NO_FINAL_DECISION`, `insufficient_coverage`, score `0`, and empty `hardBadEvidence`.

In `tests/forensics/approvalDrainProvenance.test.ts`, assert that a valid direct
profile emits `forensic_approval_drain_provenance` with score `90`, critical
severity and exact evidence IDs. A hop-one profile emits
`forensic_route_linked_approval_pattern` with score `70` or `80`, high severity,
high confidence and review-only authority. Add a forged profile carrying
`evidenceStrength: "exact_approval_and_transfer_from"` with `hopDepth: 1`; it
must fail direct authority. In `tests/risk/fastEvidence.test.ts`, also assert
that `forensic_approval_drain_provenance` without a concrete `evidenceRef` is
not accepted as Fast exact authority; the referenced positive floors to `95`.

Pin the score contract across policy/matrix tests:

- valid direct profile: producer `90`; referenced Fast reason floors to `95`;
- route profile: `70`/`80`, `pattern`, `review_only`, never an assertion or hard floor;
- flat persisted label: reason impact `80`, high severity/confidence,
  `weak_inferred`, hard false;
- route plus flat marker may produce one route row at `80` and final `REVIEW`;
- flat-only Unified context remains capped at `59` and is never a decline.

- [ ] **Step 2: Prove RED**

```powershell
npm.cmd test -- tests/forensics/approvalDrainProvenance.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/forensics/moneyOriginPolicy.test.ts tests/forensics/provenanceScoring.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/contractDrivenEvidence.test.ts tests/forensics/moneyOriginLlmIsolation.acceptance.test.ts tests/check/whereIsMoneyCheck.test.ts tests/check/manualCheck.test.ts tests/risk/fastEvidence.test.ts tests/risk/riskPolicy.test.ts tests/risk/riskEngine.test.ts tests/risk/evaluation.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/unifiedWalletRisk.test.ts tests/bot/createBot.test.ts tests/bot/walletNarrativeSummary.test.ts tests/bot/wherePreliminaryNarrative.test.ts tests/bot/riskExplanationSummary.test.ts tests/admin/forensicsGraph.test.ts
if ($LASTEXITCODE -eq 0) { throw 'approval_drain_red_unexpectedly_green' }
```

Expected: FAIL on the old route-linked assertion persistence, hard-evidence construction and flat-label Fast floor.

- [ ] **Step 3: Restrict durable assertion authority**

In `src/forensics/approvalDrainProvenance.ts`, export one shared predicate, for
example `isDirectApprovalDrainProvenanceProfile(profile, checkedSubjectAddress)`.
Give it the minimum structural input it needs so typed reports and normalized
Admin records can use the same rule. It returns true only when all four
invariants hold:

```ts
profile.evidenceStrength === "exact_approval_and_transfer_from" &&
profile.hopDepth === 0 &&
profile.firstReceiverAddress === profile.subjectAddress &&
profile.subjectAddress === checkedSubjectAddress
```

Use the project's existing address equality convention if normalization is
already centralized; do not invent a second normalizer. Use this predicate in
observation production, durable persistence, operational assessment, matrix
construction, contract-driven evidence and presentation. Branch `observationForApprovalDrainProvenance`
on it: valid direct profiles retain `forensic_approval_drain_provenance`, score
`90`, critical severity and exact copy. Route-linked or internally inconsistent
profiles emit `forensic_route_linked_approval_pattern`, review wording, score at
most `80`, high severity and no assertion authority.

In `src/forensics/deepForensicJob.ts`, replace score-only selection with exact authority selection:

```ts
function topExactApprovalDrainProfile(
  report: DeepAddressForensicReport
): ApprovalDrainProvenanceProfile | null {
  return report.approvalDrainProvenanceProfiles.find((profile) =>
    profile.score > 0 &&
    isDirectApprovalDrainProvenanceProfile(profile, report.subjectAddress)
  ) ?? null;
}
```

Use this function in `persistDerivedApprovalDrainProximityLabel`. After choosing
the profile, bind the complete retained evidence chain; matching transaction IDs
alone are insufficient:

- the raw envelope must be the expected Tron detector output, with `address`
  equal to the checked subject, `txHash` equal to the drain hash and
  `observedTransactionHash` equal to the last path hash (or drain hash when the
  path is empty);
- its embedded `approvalDrainProvenanceProfile` must independently pass the
  shared direct predicate for `report.subjectAddress`;
- embedded and selected profiles must match exactly on `subjectAddress`,
  `victimAddress`, `spenderAddress`, `firstReceiverAddress`, `hopDepth`,
  `approvalTxHash`, `drainTxHash`, ordered `pathAddresses`, ordered
  `pathTxHashes` and `evidenceStrength`;
- the observation must have the exact code, checked `subjectAddress`, expected
  observed transaction hash and this raw item's ID in `rawEvidenceId`.

Keep this identity/binding check in one shared helper beside the direct-profile
predicate and reuse it in `createBot.ts`; do not duplicate a looser
reconstruction. If any link is absent or inconsistent, do not persist the
assertion and do not reconstruct an exact Fast reason.

Add a route-first/exact-second Deep report regression. It must prove that the
durable assertion references the exact profile's raw/observation IDs and that
the reconstructed Fast reason uses that same raw ID. Keep the exact assertion
payload and ID unchanged so new exact evidence remains durable. Do not rewrite
or delete historical assertions. Add the adversarial inverse: the selected
profile is valid direct, but the raw embedded profile claims exact strength at
hop one while reusing the same approval/drain/path transaction IDs. It must bind
neither the assertion nor a Fast `evidenceRef`.

- [ ] **Step 4: Restrict Where hard evidence to exact profiles**

In `src/forensics/moneyOriginOperationalAssessment.ts`, add required
`subjectAddress` to `BuildMoneyOriginOperationalAssessmentInput`, pass
`sourceAddress` from both production calls in `whereIsMoneyCheck.ts`, and update
the shared test factory plus the LLM-isolation transport fixture. The subject
must not be inferred from an evidence profile. Then make the filter unconditional
and delete the `exactOnly` option:

```ts
function hardEvidenceFromApprovalDrain(
  profiles: ApprovalDrainProvenanceProfile[],
  checkedSubjectAddress: string
): WhereIsMoneyHardBadEvidence[] {
  return profiles
    .filter((profile) =>
      isDirectApprovalDrainProvenanceProfile(profile, checkedSubjectAddress)
    )
    .map((profile) => ({
      kind: "approval_drain",
      score: Math.max(profile.score, 95),
      message: "Exact approval-drain provenance reaches the checked wallet directly.",
      evidenceIds: [
        profile.approvalTxHash,
        profile.drainTxHash,
        ...profile.pathTxHashes
      ]
    }));
}
```

Call it without an option. In `src/check/whereIsMoneyCheck.ts`:

- delete the unused `combined`, `approvalDrainScore`, `fastDecline`, `approvalDrainDecline`, and `deterministicDecision` variables;
- remove `approvalDrainProvenanceProfileCount` from `proofLevelFromWhereDecision` and `whereDecisionFields`;
- derive exact approval proof only from an `approval_drain` item in `assessment.hardBadEvidence`.

In `src/risk/scoringSignalMatrixInputs.ts`, harden
`hasExactWhereHardProof`: a saved Where `proofLevel` string alone is not
authority. Require a profile passing the shared direct predicate and overlap
between that profile's approval/drain/path transaction IDs and the
hard-evidence item IDs. For `scam_or_blacklist`, likewise reject the saved proof
string alone: require either an origin path accepted by the shared authoritative
risky-label-path predicate with transaction-ID overlap, or a reason accepted by
the shared exact Fast reason predicate whose non-empty `evidenceRef` overlaps
the item IDs.

Add a Where-only route candidate instead of dropping the retained profile after
the hard-evidence filter. It uses row `route_linked_approval_pattern`, authority
`pattern`, action `review_only`, score at most `80` and no hard floor. Give the
Deep and Where form of the same subject/victim/approval/drain/path profile the
same deterministic episode identity so existing matrix deduplication emits one
candidate. A route-only final result must be `REVIEW`, not `ACCEPTABLE`.

- [ ] **Step 5: Remove flat-label exact Fast authority**

In `src/risk/fastEvidence.ts`, remove `internal_label_approval_drain_proximity` from both `EXACT_FAST_HARD_EVIDENCE_CODES` and `EXACT_FAST_HARD_CODE_FLOORS`. Keep `forensic_approval_drain_provenance: 95` unchanged.

Make `isExactFastHardEvidenceReason(reason)` the shared reason-level predicate.
For `forensic_approval_drain_provenance` only, it requires a trimmed non-empty
`reason.evidenceRef`; do not synthesize
`fast:forensic_approval_drain_provenance`. Other exact codes keep their existing
fallback behavior. `exactFastHardEvidence`, `riskPolicy.policyForReason`, Fast
narrative scoring/copy and their callers must use this reason predicate, never
authorize approval-drain from `reason.code` alone.

Expand `policyForReason` from `Pick<RiskReason, "code" | "scoreImpact">` to
also receive `"evidenceRef"`; otherwise the policy layer cannot enforce the
shared reason-level contract.

In `src/risk/riskPolicy.ts`, classify both derived proximity labels explicitly as non-hard provenance context:

```ts
if (code === "internal_label_approval_drain_proximity") {
  return {
    dimension: "provenance",
    evidenceClass: "weak_inferred",
    hardEvidence: false,
    cap: 80
  };
}
```

In `src/risk/riskEngine.ts`, delete the special 95 branch so the existing high-risk-label value 80 applies, and use context-only copy:

```ts
return "Derived approval-drain route marker; exact provenance requires retained approval and transferFrom evidence.";
```

Remove any critical-severity special case for this flat label in `src/risk/evaluation.ts` if present.

In `calculatePolicyScoreBreakdown`, include
`internal_label_approval_drain_proximity` in `strongApprovalContextScore` beside
the route code. This preserves its explicit Fast context score of `80` without
making it hard authority; the separate Unified flat-only cap remains `59`.

Close the older money-origin bypass at its producer and every hard consumer
without introducing another module. Move the exact money-origin label set and
export `isAuthoritativeMoneyOriginRiskLabelPath(path)` from the existing low-level
`src/forensics/moneyOriginAttribution.ts`, which is already imported by both
policy and scoring. The predicate requires
`rootSourceType === "risky_label"`, `sourceExposureKind === "risky_label"` and
an `exposureSourceKey` contained in that exact-label set. The set no longer
contains approval proximity.

In `src/forensics/moneyOriginPolicy.ts`, make exact-label selection use that
shared set, so a new flat marker does not stop traversal or produce `DECLINE`.
When a genuine exact label such as `scam` does stop the path, retain
`exposureSourceKey: riskLabel.label`, its display label and
`sourceExposureKind: "risky_label"`.

Use that predicate in `moneyOriginOperationalAssessment.ts` for both
`hardEvidenceFromPaths` and `pathHasHardEvidence`; also use it before a
`risky_label` source-bundle floor/policy extra is accepted. Recompute the
risky-label share/evidence IDs from authoritative paths and do not trust a saved
aggregate share by itself. In `provenanceScoring.sourceExposureKindFromPath`,
special-case `risky_label` through the predicate and delete the legacy
`rootSourceType` fallback; all other source kinds keep their current compatibility.

In `whereIsMoneyCheck.ts`, apply it in `sourceClassFromPath` and
`pathIntersectsHardEvidence`: an unbound stale path maps to the existing unknown
context and cannot trigger broad targeted-history expansion solely from its old
root type. Apply it in all three existing risky-path branches in
`incomingDepositJob.ts`; legacy paths fall through the existing non-hard
Incoming behaviour. Never infer authority from `rootSourceType` or
`stoppedReason` alone.

In `scoringSignalMatrixInputs.ts`, reuse one
`whereRiskyLabelEvidenceAuthorized(report, evidenceIds)` check for all three
persisted surfaces: `scam_or_blacklist` hard items, risky-label
`sourcePolicyEvidence`, and risky-label source-policy risk layers. It requires an
authoritative path plus evidence-ID overlap; an exact Fast reason is an alternate
only when the shared reason predicate accepts it and its non-empty
`evidenceRef` overlaps. Unauthorized saved policy/layer rows may be emitted only
as bounded review context.

For the incoming `freshBundleExposure.riskyLabelShare` candidate, do not merely
check that any authoritative path exists. Recompute the authoritative risky
share from only bound paths using the existing selected-path share semantics,
cap it at `1`, and apply the `10%` threshold to that recomputed value. Accept the
linkage in either existing legitimate mode: the Where report subject equals the
incoming sender (sender-wallet provenance), or the report/path explicitly
contains the deposit transaction (funding-candidate provenance). A saved numeric
aggregate may corroborate/cap presentation but cannot increase authority. Add
the `1%` bound + `19%` stale negative and a bound `>=10%` positive regression.

- [ ] **Step 6: Pin reconstruction and presentation to retained provenance**

In `src/bot/createBot.ts`, when rebuilding a direct exact signal from a Deep
report, use the same direct-profile identity match as persistence, find its
matching exact observation and carry its non-empty `rawEvidenceId` as
`evidenceRef`. A route-first raw record must never bind to an exact-second
profile. If retained raw provenance is absent, the direct profile may still
reach the matrix's exact-profile path, but the reconstructed Fast reason cannot
independently assert Fast `95`.

Change `fastNarrativeCopy` to receive the complete reason rather than only its
code, and update both callers in `createBot.ts` and
`wherePreliminaryNarrative.ts`. An unreferenced direct code and the flat marker
use context copy and cannot produce exact wording.

Render `internal_label_approval_drain_proximity` as a context card. In
`createBot.buildFinalReasonCards` and
`riskExplanationSummary.addWhereFacts`, a stale Where `approval_drain` hard
item is accepted only when a profile passes the shared predicate for the
checked subject and its approval/drain/path IDs overlap the item evidence IDs;
alternatively the fresh Unified result may already contain its independently
validated `exact_approval_drain` reason. Filter
`exactApprovalDrainProfileFromReports` and the summary equivalent by the
checked subject and shared predicate. Never render exact text with a null or
route profile.

Apply the shared direct predicate to standalone Deep output too:

- `contractDrivenEvidence.ts` must not count a subject-matching route or forged
  hop-one profile as an exact receiver;
- the standalone Deep formatter in `createBot.ts` must select a valid direct
  profile rather than the first approval profile;
- `notificationSummaries.hasExactDeepEvidence` must pass
  `report.subjectAddress` through the same predicate.

Apply the same contract to Admin. Replace the local strength/feature-code
shortcuts in `src/admin/forensicsGraph.ts` with the shared direct predicate after
normalizing `evidenceStrength`, numeric `hopDepth`, `firstReceiverAddress` and
`subjectAddress` from each raw record. Pass the checked subject into both
`attachApprovalDrainProvenanceNodeIntelligence` call sites and into
`projectApprovalDrainProvenanceEventClusters`. Use the predicate for campaign
aggregation, `edgeVerdict`, `pathVerdict` and `evidenceKind` as well as node
intelligence. Route-linked, cross-subject and forged hop-one profiles may keep
ordinary graph context, but must remain review paths and must not attach hard
drainer/victim intelligence or enter an exact campaign.

Before calling `classifyContractDrivenReceiver`, recompute
`exactApprovalDrainCount` from profiles that pass that same predicate for the
checked subject. Never use the saved aggregate as authority by itself; a stale
positive count with zero authoritative profiles becomes zero. The valid direct
case must still classify and render exactly as before.

Invert the existing hop-one exact-text expectations in `createBot.test.ts`
(including the current cases around the compact and detailed Deep summaries):
route and forged-hop-one reports use behavior/review context, while the valid
direct report retains exact wording.

Add presentation regressions proving:

- a saved flat marker uses context/review wording and never says exact proof;
- a route-linked profile stays on `route_linked_approval_pattern` with `review_only` authority;
- a stale Where proof-level string with only a route profile cannot create a hard row;
- a stale proof level plus route-only profile plus stale hard item creates no decline card and no exact wording;
- a Where-only route profile creates one score-at-most-80 review candidate and final `REVIEW`;
- a route-first/exact-second report binds the exact raw/observation ID in both the durable assertion and reconstructed Fast reason;
- a direct selected profile plus a forged hop-one raw profile reusing its tx IDs binds neither an assertion nor exact Fast evidence;
- an exact-marked hop-one profile is rejected by persistence, matrix and presentation;
- a stale/unbound `risky_label` path and a flat approval marker create neither Where nor Incoming hard authority;
- stale risky-label source-bundle shares, saved policy/layer rows and incoming
  fresh aggregates cannot decline or trigger broad-history expansion without an
  authoritative path and evidence linkage;
- incoming mixed shares apply the `10%` threshold to recomputed bound-path share,
  never to a larger saved aggregate;
- Admin ignores a saved exact receiver count and exact feature code unless a checked-subject direct profile proves them;
- an unreferenced `forensic_approval_drain_provenance` reason gets neither policy floor `95` nor exact preliminary/final copy;
- a referenced direct exact profile still renders the exact 95 reason.

- [ ] **Step 7: Prove GREEN and commit independently**

```powershell
npm.cmd test -- tests/forensics/approvalDrainProvenance.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/forensics/moneyOriginPolicy.test.ts tests/forensics/provenanceScoring.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/contractDrivenEvidence.test.ts tests/forensics/moneyOriginLlmIsolation.acceptance.test.ts tests/check/whereIsMoneyCheck.test.ts tests/check/manualCheck.test.ts tests/risk/fastEvidence.test.ts tests/risk/riskPolicy.test.ts tests/risk/riskEngine.test.ts tests/risk/evaluation.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/unifiedWalletRisk.test.ts tests/bot/createBot.test.ts tests/bot/walletNarrativeSummary.test.ts tests/bot/wherePreliminaryNarrative.test.ts tests/bot/riskExplanationSummary.test.ts tests/admin/forensicsGraph.test.ts
if ($LASTEXITCODE -ne 0) { throw 'approval_drain_green_tests_failed' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'approval_drain_diff_check_failed' }
git add src/forensics/approvalDrainProvenance.ts src/forensics/deepForensicJob.ts src/forensics/moneyOriginOperationalAssessment.ts src/forensics/moneyOriginAttribution.ts src/forensics/moneyOriginPolicy.ts src/forensics/provenanceScoring.ts src/forensics/incomingDepositJob.ts src/forensics/contractDrivenEvidence.ts src/check/whereIsMoneyCheck.ts src/risk/fastEvidence.ts src/risk/riskPolicy.ts src/risk/riskEngine.ts src/risk/evaluation.ts src/risk/scoringSignalMatrixInputs.ts src/bot/createBot.ts src/bot/walletNarrativeSummary.ts src/bot/riskExplanationSummary.ts src/bot/wherePreliminaryNarrative.ts src/alerts/notificationSummaries.ts src/admin/forensicsGraph.ts tests/forensics/approvalDrainProvenance.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/forensics/moneyOriginPolicy.test.ts tests/forensics/provenanceScoring.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/contractDrivenEvidence.test.ts tests/forensics/moneyOriginLlmIsolation.acceptance.test.ts tests/check/whereIsMoneyCheck.test.ts tests/check/manualCheck.test.ts tests/risk/fastEvidence.test.ts tests/risk/riskPolicy.test.ts tests/risk/riskEngine.test.ts tests/risk/evaluation.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/unifiedWalletRisk.test.ts tests/bot/createBot.test.ts tests/bot/walletNarrativeSummary.test.ts tests/bot/wherePreliminaryNarrative.test.ts tests/bot/riskExplanationSummary.test.ts tests/admin/forensicsGraph.test.ts
if ($LASTEXITCODE -ne 0) { throw 'approval_drain_stage_failed' }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'approval_drain_cached_diff_failed' }
git commit -m "fix(risk): keep route-linked approval evidence contextual"
if ($LASTEXITCODE -ne 0) { throw 'approval_drain_commit_failed' }
```

Expected: targeted suite PASS; exact direct provenance still reaches 95, route-linked and flat labels do not.

## Task 2: Accept semantic blacklist event declarations

- [ ] **Step 1: Add exact semantic signature cases**

In `tests/tron/usdtBlacklistTimeline.test.ts`, add a passing table for:

```ts
it.each([
  "AddedBlackList(address)",
  "AddedBlackList(address _user)",
  "AddedBlackList(address indexed _user)",
  " AddedBlackList ( address indexed _user ) "
])("accepts semantically equivalent added declaration %s", (event) => {
  expect(verifyBlacklistEvent([contractEvent({ event })], ADDRESS))
    .toMatchObject({ eventKind: "added", txHash: TX });
});
```

Add the equivalent removed case and rejecting cases for `address indexed` without a name, a second parameter, array/payable type, reversed token order, contradictory name/topic, unknown event name, malformed identifier and non-string value. In `tests/tron/tronClient.test.ts`, make one complete authoritative-timeline provider fixture use `AddedBlackList(address indexed _user)` and retain the same verified complete result.

- [ ] **Step 2: Prove RED**

```powershell
npm.cmd test -- tests/tron/usdtBlacklistTimeline.test.ts
if ($LASTEXITCODE -eq 0) { throw 'blacklist_signature_red_unexpectedly_green' }
```

Expected: FAIL for `address indexed _user` and the whitespace-equivalent declaration.

- [ ] **Step 3: Replace presentation equality with a one-parameter semantic parser**

Keep this parser local; do not add an ABI dependency. Parse the declaration into exact tokens so `address indexed` without a parameter name cannot slip through:

```ts
function eventKindFromSignature(
  value: unknown
): UsdtBlacklistTimelineEvent["eventKind"] | null {
  const signature = nonEmptyString(value)?.trim() ?? null;
  if (!signature) return null;
  const declaration = /^(AddedBlackList|RemovedBlackList)\s*\((.*)\)$/u.exec(signature);
  if (!declaration) return null;
  const tokens = declaration[2].trim().split(/\s+/u);
  const identifier = (token: string): boolean =>
    /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(token);
  const parameterValid =
    tokens.length === 1 && tokens[0] === "address" ||
    tokens.length === 2 && tokens[0] === "address" && identifier(tokens[1]) ||
    tokens.length === 3 && tokens[0] === "address" && tokens[1] === "indexed" && identifier(tokens[2]);
  if (!parameterValid) return null;
  return declaration[1] === "AddedBlackList" ? "added" : "removed";
}
```

Do not weaken `verifyEvent`: official contract, successful confirmed transaction, transaction hash, block, log index and timestamp remain mandatory. Preserve both existing evidence shapes: raw-topic events require exactly two canonical topics and user/topic agreement, while the realistic decoded provider event may omit `topics` and must instead carry mutually consistent decoded name/signature/user fields. Whenever raw and decoded fields coexist, they must agree.

- [ ] **Step 4: Prove GREEN and commit independently**

```powershell
npm.cmd test -- tests/tron/usdtBlacklistTimeline.test.ts tests/tron/tronClient.test.ts
if ($LASTEXITCODE -ne 0) { throw 'blacklist_signature_green_tests_failed' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'blacklist_signature_diff_check_failed' }
git add src/tron/usdtBlacklistTimeline.ts tests/tron/usdtBlacklistTimeline.test.ts tests/tron/tronClient.test.ts
if ($LASTEXITCODE -ne 0) { throw 'blacklist_signature_stage_failed' }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'blacklist_signature_cached_diff_failed' }
git commit -m "fix(tron): parse semantic USDT blacklist events"
if ($LASTEXITCODE -ne 0) { throw 'blacklist_signature_commit_failed' }
```

## Task 3: Bind blacklist policy to the active transfer subset

- [ ] **Step 1: Replace the retroactive-policy test contract**

In `tests/risk/scoringSignalMatrixInputs.test.ts`, replace the current test that promotes `became_active_after` to score 60. Add coherent factories whose fact, timeline, profile transfers, hashes, amounts and counts all describe the same case; do not override only `temporalRelation` on an otherwise active fixture:

```ts
it.each([
  ["became_active_after", coherentBeforeOnlyBlacklistCase()],
  ["unknown", coherentUnknownTimingBlacklistCase()]
] as const)(
  "does not create policy authority for %s timing",
  (_relation, input) => {
    expect(directPolicyCandidates(input)).toEqual([]);
  }
);
```

Add these concrete cases:

- complete `active_at_transfer`, exactly 10,000 USDT: one candidate;
- complete `mixed`, total above 10,000 but active subset below both materiality thresholds: no candidate;
- complete `mixed`, active subset independently material: one score-60 candidate whose `evidenceIds` contain active hashes, the verified blacklist event and current-state ID, but no pre-activation hash;
- mixed with partial timeline or direct coverage: no candidate;
- incoming-deposit candidate whose selected transaction is pre-activation: no candidate even when another transaction in the same fact is active;
- incoming-deposit candidate whose selected transaction is active: one candidate;
- a material active fact with a mismatched direct profile amount/hash/count: no candidate.
- a jointly forged denominator and share that agree with each other but not with the sum of all validated same-direction direct profiles: no candidate;
- a complete `added -> removed` timeline whose saved status still says active: no candidate.
- a legacy complete `active_at_transfer` fact without the additive denominator,
  backed by a fully valid profile set: remains eligible and uses the recomputed
  denominator; the equivalent legacy `mixed` fact remains ineligible;
- one malformed same-direction profile beside otherwise valid profiles rejects
  relative authority instead of silently shrinking the denominator;
- a producer-valid TRON GasFree service-fee profile contributes zero to the
  denominator, while `service_fee` without `economicProtocol: "tron_gasfree"`
  is invalid rather than excluded;
- a complete timeline whose final verified event does not exactly match both
  `effectiveTxHash` and `effectiveAt` produces no policy candidate;
- the same transaction hash carrying different timestamps across otherwise
  valid normalized profiles/directions is producer-wide conflicting and
  produces no policy candidate.

Update `tests/risk/scoreAnchorV2.acceptance.test.ts`: only `active_at_transfer` and a fully proven independently material `mixed` case may create the direct policy row. `became_active_after` and `unknown` must remain review/context with no `can_decline` candidate.

- [ ] **Step 2: Prove RED**

```powershell
npm.cmd test -- tests/forensics/directHardEvidence.test.ts tests/forensics/deepForensicJob.test.ts tests/check/deepForensicCheck.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/unifiedWalletRisk.test.ts tests/risk/scoreAnchorV2.acceptance.test.ts tests/risk/remediationScoringCompatibility.test.ts
if ($LASTEXITCODE -eq 0) { throw 'blacklist_temporal_red_unexpectedly_green' }
```

Expected: FAIL because eligibility still uses current state and the whole principal set.

- [ ] **Step 3: Add the exact denominator without invalidating old reports**

Add this optional persisted field to `FirstHopBlacklistFact` in `src/types.ts`:

```ts
directionalPrincipalTotalRaw?: string;
```

New producers set it only when direct transfer coverage is complete. Old
persisted facts without the field remain readable. A legacy
`active_at_transfer` fact may remain eligible only after the matrix recomputes
the full directional denominator from valid profiles; a legacy `mixed` fact
without the field is not eligible for hard policy.

In `DirectPrincipalCounterpartyGroup`, retain the exact directional denominator as a `bigint` and populate it from the already-computed `directionalTotals[group.direction]`. `buildBlacklistFact` serializes it with `.toString()` for complete coverage.

Extend `persistedBlacklistFact` in `src/check/deepForensicCheck.ts` with additive validation. Absence means legacy. Presence requires canonical positive raw amount, complete direct coverage, exact share, `principalAmountRaw <= directionalPrincipalTotalRaw`, and the same fixed-point share as the producer. The core lower-bound check is:

```ts
if (
  value.directionalPrincipalTotalRaw !== undefined &&
  (
    !persistedRawAmount(value.directionalPrincipalTotalRaw) ||
    BigInt(value.directionalPrincipalTotalRaw) <= 0n ||
    BigInt(value.directionalPrincipalTotalRaw) < BigInt(value.principalAmountRaw)
  )
) return false;
```

This decoder check is structural compatibility, not final authority: a forged denominator/share pair cannot be proven here without the complete profile set. Add assertions that a complete producer fact serializes the exact denominator, a partial producer fact omits it, a valid old fact without it still restores, and malformed/too-small/internally inconsistent denominator values are rejected. Add a persisted Deep report round-trip assertion in `tests/forensics/deepForensicJob.test.ts`.

- [ ] **Step 4: Export and reuse one temporal partition implementation**

In `src/forensics/directHardEvidence.ts`, extract the existing `buildBlacklistFact` loop into a pure exported helper with no I/O:

```ts
export type BlacklistPrincipalTemporalPartition = Readonly<{
  before: Readonly<{ amountRaw: bigint; txHashes: string[] }>;
  active: Readonly<{ amountRaw: bigint; txHashes: string[] }>;
  unknown: Readonly<{ amountRaw: bigint; txHashes: string[] }>;
  temporalRelation: FirstHopTemporalRelation;
}>;

export function partitionPrincipalTransfersByBlacklistTimeline(input: {
  principalTransfers: DirectPrincipalCounterpartyGroup["principalTransfers"];
  timelineEvents: UsdtBlacklistTimelineEvent[];
  timelineComplete: boolean;
  conflictingTxHashes?: ReadonlySet<string>;
}): BlacklistPrincipalTemporalPartition;
```

Import `FirstHopTemporalRelation` explicitly. Move the current repeated-addition, conflicting-timestamp/timing, equal-wall-clock and invalid-time behavior into this helper unchanged. Preserve legitimate multiple movements with the same transaction hash: sum them under one hash; classify unknown only when their timestamps/timings conflict (exact edge duplicates were already removed upstream). `buildBlacklistFact` consumes its result. This is a behavior-preserving extraction before the matrix uses it.

Rename/export the existing eight-decimal `exactShare` implementation as one shared helper for the producer, persisted-fact validator and matrix. Do not introduce a second floating-point implementation.

- [ ] **Step 5: Select only event-time-eligible transfers in the matrix**

Extend `DirectPolicyProfileBinding` in `src/risk/scoringSignalMatrixInputs.ts` with the normalized principal transfer list validated by `indexedDirectPolicyProfile`. In addition to the existing hash/amount/endpoint checks, require each principal transfer timestamp to parse to a finite instant and normalize it as `{ txHash, amountRaw: BigInt(amountRaw), occurredAt: timestamp }` for the helper; an invalid timestamp rejects the binding. Keep the whole-fact hash/amount/count binding first.

Refactor `indexedDirectPolicyProfile` so malformed and producer-valid fee-only
profiles no longer both collapse to `null`. Return a discriminated result
(`principal | valid_fee_only | invalid`) and make the caller observe every
same-direction result before constructing a denominator.

Add a local selector with this contract:

```ts
type EligibleBlacklistSlice = Readonly<{
  amountRaw: bigint;
  txHashes: string[];
  recomputedDirectionalTotalRaw: bigint;
  directionalShare: number | null;
  exactShare: boolean;
}>;
```

It must:

1. reject `became_active_after` and `unknown`;
2. require `timelineCoverage === "complete"`;
3. recompute the partition from the bound profile transfers and verified timeline;
4. require recomputed relation, active amount/count, before amount/count and unknown amount/count to equal the fact;
5. use the whole set for `active_at_transfer`;
6. classify every same-direction profile as `principal`, `valid_fee_only` or
   `invalid`; any `invalid` profile rejects complete/relative authority instead
   of disappearing from the denominator. `valid_fee_only` contributes zero and
   requires the same producer predicate—both `economicRole === "service_fee"`
   and `economicProtocol === "tron_gasfree"`;
7. build one canonical movement set across every `principal` profile, reject
   duplicate profile keys or repeated exact movement signatures, and sum it as
   `recomputedDirectionalTotalRaw`; the same transaction hash may still carry
   distinct legitimate movements;
8. when the optional persisted `directionalPrincipalTotalRaw` exists, require
   exact equality with the recomputed value. When absent, only
   `active_at_transfer` may continue with the recomputed value; `mixed` rejects;
9. for `mixed`, require complete direct coverage and the persisted denominator,
   then compute the active share with the one shared eight-decimal bigint helper;
10. return only active transaction hashes plus the recomputed denominator.

Before partitioning any individual binding, reproduce the producer-wide
`conflictingPrincipalTxHashes` contract over the complete normalized principal
profile set: one tx hash with more than one distinct `occurredAt` is conflicting
even when the rows live in different counterparty profiles or directions. Pass
that set into every partition call. Legitimate same-hash movements at the same
timestamp remain allowed and are summed.

Tighten `verifiedBlacklistEventTxHash`: for a complete timeline, the final verified event must be `added`, and that exact event's hash/time must equal `effectiveTxHash`/`effectiveAt`. An `added -> removed` lifecycle cannot borrow the older addition while claiming current active state.

Treat the returned event hash as mandatory authority, not an optional evidence
decoration: `if (!eventTxHash) return null` must occur before materiality and
candidate construction. Add explicit mismatched-hash, mismatched-time and final
removed-event regressions that expect no candidate.

Apply absolute and relative materiality to this returned amount/share. Check the relative threshold without floating point:

```ts
const relativeMaterial = activeAmountRaw >= 100_000000n &&
  activeAmountRaw * 100n >= recomputedDirectionalTotalRaw;
```

For a mixed case, use score 60 rather than reusing a whole-profile score inflated by pre-activation transfers. Build hard `evidenceIds` from the active hashes only, plus the verified effective event and current-state identity.

Add an optional `requiredActiveTxHash` parameter to `directCounterpartyPolicyCandidate`. The incoming mapper passes `input.txHash`; reject when it is not in the returned active set. The wallet mapper passes no required hash.

Update the TGyt/TWGC regression in `tests/bot/createBot.test.ts`: its principal transfer predates the verified blacklist addition, so the blacklist remains visible as current-state/context copy but contributes no decisive direct-policy 90. Preserve whatever separate bridge/source-policy score the fixture independently proves.

Update `tests/fixtures/forensics/directBlacklistCases.ts` so active, before, unknown and mixed fixtures carry mutually consistent timelines, profile timestamps, amounts/counts, denominator and share. In `tests/risk/remediationScoringCompatibility.test.ts`, prove that a legacy fact without the additive field remains readable, but a legacy `mixed` fact cannot gain new hard authority without the denominator.

- [ ] **Step 6: Prove GREEN and commit independently**

```powershell
npm.cmd test -- tests/forensics/directHardEvidence.test.ts tests/forensics/deepForensicJob.test.ts tests/check/deepForensicCheck.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/unifiedWalletRisk.test.ts tests/risk/scoreAnchorV2.acceptance.test.ts tests/risk/remediationScoringCompatibility.test.ts tests/bot/createBot.test.ts
if ($LASTEXITCODE -ne 0) { throw 'blacklist_temporal_green_tests_failed' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'blacklist_temporal_diff_check_failed' }
git add src/types.ts src/forensics/directHardEvidence.ts src/check/deepForensicCheck.ts src/risk/scoringSignalMatrixInputs.ts tests/forensics/directHardEvidence.test.ts tests/forensics/deepForensicJob.test.ts tests/check/deepForensicCheck.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/unifiedWalletRisk.test.ts tests/risk/scoreAnchorV2.acceptance.test.ts tests/risk/remediationScoringCompatibility.test.ts tests/bot/createBot.test.ts tests/fixtures/forensics/directBlacklistCases.ts
if ($LASTEXITCODE -ne 0) { throw 'blacklist_temporal_stage_failed' }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'blacklist_temporal_cached_diff_failed' }
git commit -m "fix(risk): enforce blacklist state at transfer time"
if ($LASTEXITCODE -ne 0) { throw 'blacklist_temporal_commit_failed' }
```

## Task 4: Make sanctions time explicitly three-state

- [ ] **Step 1: Add boundary and unknown regressions**

Create `tests/forensics/sanctionedServiceRegistry.test.ts` and exercise the evaluator with:

```ts
expect(sanctionedCryptoServiceStateAt(htx, "2026-05-25T23:59:59.999Z")).toBe("inactive");
expect(sanctionedCryptoServiceStateAt(htx, htx.designatedAt)).toBe("active");
expect(sanctionedCryptoServiceStateAt(htx, null)).toBe("unknown");
expect(sanctionedCryptoServiceStateAt(htx, undefined)).toBe("unknown");
expect(sanctionedCryptoServiceStateAt(htx, "not-a-time")).toBe("unknown");
expect(sanctionedCryptoServiceStateAt(htx, new Date(Number.NaN))).toBe("unknown");
expect(sanctionedCryptoServiceStateAt({ ...htx, designatedAt: "bad" }, htx.designatedAt)).toBe("unknown");
```

Add a registry regression where `exposureSourceKey` resolves HTX while
`exposureSourceLabel` resolves Garantex (and the reverse through `reasons`).
Conflicting known services must resolve to no single authority and state
`unknown`; registry order must not choose one service's designation date.

Add behavior regressions proving missing/invalid event time does not create a
sanctioned-service decline or a direct-hard-evidence sanctions reason. In
`tests/bot/walletNarrativeSummary.test.ts`, prove unknown time is not rendered as
either “sanctioned at transfer” or “before designation”. In
`tests/forensics/provenanceScoring.test.ts`, exercise explicit
`sanctioned_service` metadata and textual alias detection separately:
missing/invalid time must not return `sanctioned_service`, while the active cases
set `steps[0].timestamp >= designatedAt` and do return it. This prevents either
existing early-return branch from escaping the temporal check.

In matrix and presentation tests, replace the existing standalone saved
`sanctioned_service` fixture with this authority contract:

- a saved local `hardBadEvidence`, `sourcePolicyEvidence` or sanctions risk
  layer without an overlapping registry-bound origin path is context only and
  creates neither `can_decline` nor hard/decline copy;
- an active registry-bound path whose exact path/evidence IDs overlap the saved
  artifact retains the sanctions candidate and decline copy;
- a stale or non-overlapping evidence ID fails closed;
- an inactive, unknown-time or conflicting-service path fails closed;
- separately typed cross-chain sanctioned terminal authority is unchanged.

- [ ] **Step 2: Prove RED**

```powershell
npm.cmd test -- tests/forensics/sanctionedServiceRegistry.test.ts tests/forensics/moneyOriginPolicy.test.ts tests/forensics/directHardEvidence.test.ts tests/forensics/provenanceScoring.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/bot/walletNarrativeSummary.test.ts tests/bot/createBot.test.ts tests/bot/riskExplanationSummary.test.ts
if ($LASTEXITCODE -eq 0) { throw 'sanctions_temporal_red_unexpectedly_green' }
```

Expected: FAIL because missing/invalid time currently returns active, historical copy treats every non-active result alike, and alias matching can recreate sanctions authority without event time.

- [ ] **Step 3: Introduce the tri-state evaluator and update every caller**

In `src/forensics/sanctionedServiceRegistry.ts`:

```ts
export type SanctionedServiceTemporalState = "active" | "inactive" | "unknown";

export function sanctionedCryptoServiceStateAt(
  service: SanctionedCryptoService,
  eventTimestamp: Date | string | null | undefined
): SanctionedServiceTemporalState {
  if (eventTimestamp === null || eventTimestamp === undefined) return "unknown";
  const eventTime = typeof eventTimestamp === "string"
    ? Date.parse(eventTimestamp)
    : eventTimestamp.getTime();
  const designatedTime = Date.parse(service.designatedAt);
  if (!Number.isFinite(eventTime) || !Number.isFinite(designatedTime)) return "unknown";
  return eventTime >= designatedTime ? "active" : "inactive";
}
```

Also export a consistent-identity resolver. Match every non-empty authority
field separately (`exposureSourceKey`, `exposureSourceLabel`, then each reason),
collect the matched service keys, and return a service only when all matched
fields name one unique registry entry. Zero matches or multiple distinct
matches return `null`; never concatenate the strings and accept the first
registry match.

Delete the boolean `sanctionedCryptoServiceActiveAt` export. Its four current calls are in three production files (`moneyOriginPolicy.ts`, `directHardEvidence.ts`, and two narrative calls in `walletNarrativeSummary.ts`); update them all. Then close the separate alias-based authority bypass in `provenanceScoring.ts`:

- `moneyOriginPolicy.ts`: resolve classification identity and every evidence
  string separately with the same conflict-aware resolver; only one consistent
  service with state `active` returns a sanctioned service. Add a producer-level
  conflicting-identity regression;
- `directHardEvidence.ts`: resolve classification identity and every evidence
  string separately with the same conflict-aware resolver; only one consistent
  active service adds the hard reason. Add the equivalent producer-level
  conflicting-identity regression;
- `walletNarrativeSummary.ts`: resolve the registry service consistently from `exposureSourceKey`, `exposureSourceLabel` and individual reasons instead of treating only HTX specially; sanctioned fact uses `active`, historical-before-designation copy uses `inactive`, and `unknown` remains explicit temporal context without either claim. An unresolvable designation is `unknown`, not implicitly active;
- `provenanceScoring.ts`: before returning `sanctioned_service` from either explicit local path metadata or text, use the consistent resolver and evaluate `path.steps[0]?.timestamp`. Return the sanctions kind only for `active`; let inactive/unknown HTX fall back to `htx_huobi` context and let unknown non-HTX identities remain non-sanctions context. Export one pure `activeSanctionedServicePathEvidence(path)` helper returning the resolved service plus `[balanceTransferEvidenceId?, balanceTransferTxHash, ...txHashes]` only for an active, non-conflicting local path. Do not change separately typed cross-chain authority;
- `scoringSignalMatrixInputs.ts`: build the union of active local sanctions path IDs with that helper. A local `sanctioned_service` hard item, source-policy item or source-policy risk layer gets policy authority only when its evidence IDs overlap that union; otherwise emit at most context. Keep the cross-chain corridor mapper on its existing typed authority path;
- `createBot.ts` and `riskExplanationSummary.ts`: apply the same overlap gate before hard/decline sanctions copy. Unknown, inactive, conflicting or stale local artifacts use explicit context wording instead.

- [ ] **Step 4: Prove GREEN and commit independently**

```powershell
npm.cmd test -- tests/forensics/sanctionedServiceRegistry.test.ts tests/forensics/moneyOriginPolicy.test.ts tests/forensics/directHardEvidence.test.ts tests/forensics/provenanceScoring.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/bot/walletNarrativeSummary.test.ts tests/bot/createBot.test.ts tests/bot/riskExplanationSummary.test.ts
if ($LASTEXITCODE -ne 0) { throw 'sanctions_temporal_green_tests_failed' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'sanctions_temporal_diff_check_failed' }
git add src/forensics/sanctionedServiceRegistry.ts src/forensics/moneyOriginPolicy.ts src/forensics/directHardEvidence.ts src/forensics/provenanceScoring.ts src/risk/scoringSignalMatrixInputs.ts src/bot/walletNarrativeSummary.ts src/bot/createBot.ts src/bot/riskExplanationSummary.ts tests/forensics/sanctionedServiceRegistry.test.ts tests/forensics/moneyOriginPolicy.test.ts tests/forensics/directHardEvidence.test.ts tests/forensics/provenanceScoring.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/bot/walletNarrativeSummary.test.ts tests/bot/createBot.test.ts tests/bot/riskExplanationSummary.test.ts
if ($LASTEXITCODE -ne 0) { throw 'sanctions_temporal_stage_failed' }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'sanctions_temporal_cached_diff_failed' }
git commit -m "fix(forensics): fail closed on unknown sanctions time"
if ($LASTEXITCODE -ne 0) { throw 'sanctions_temporal_commit_failed' }
```

## Task 5: Run the combined correctness gate

- [ ] **Step 1: Run all touched-domain tests together**

```powershell
npm.cmd test -- tests/forensics/approvalDrainProvenance.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/forensics/moneyOriginPolicy.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/contractDrivenEvidence.test.ts tests/forensics/moneyOriginLlmIsolation.acceptance.test.ts tests/forensics/directHardEvidence.test.ts tests/forensics/sanctionedServiceRegistry.test.ts tests/forensics/provenanceScoring.test.ts tests/check/whereIsMoneyCheck.test.ts tests/check/manualCheck.test.ts tests/check/deepForensicCheck.test.ts tests/tron/usdtBlacklistTimeline.test.ts tests/tron/tronClient.test.ts tests/risk/fastEvidence.test.ts tests/risk/riskPolicy.test.ts tests/risk/riskEngine.test.ts tests/risk/evaluation.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/unifiedWalletRisk.test.ts tests/risk/scoreAnchorV2.acceptance.test.ts tests/risk/remediationScoringCompatibility.test.ts tests/bot/createBot.test.ts tests/bot/walletNarrativeSummary.test.ts tests/bot/wherePreliminaryNarrative.test.ts tests/bot/riskExplanationSummary.test.ts tests/admin/forensicsGraph.test.ts
if ($LASTEXITCODE -ne 0) { throw 'correctness_combined_targeted_tests_failed' }
```

Expected: all pass. No test may retain the old contract that `became_active_after`, unknown sanctions time, route-linked profile, or a flat approval proximity code is exact hard authority.

- [ ] **Step 2: Run Golden, type and full regressions**

```powershell
npm.cmd run golden:v2:verify -- --input docs/audit/2026-07-system-audit/golden-v2/locked
if ($LASTEXITCODE -ne 0) { throw 'correctness_golden_v2_failed' }
npm.cmd test -- tests/unified-check/comparator.test.ts
if ($LASTEXITCODE -ne 0) { throw 'correctness_unified_golden_comparator_failed' }
npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw 'correctness_typecheck_failed' }
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'correctness_full_suite_failed' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'correctness_diff_check_failed' }
```

Expected: all commands exit 0. The comparator test creates a temporary candidate
root with the production `buildUnifiedWalletGoldenReplayCandidate`, invokes the
CLI contract with both `--golden` and `--candidate`, and removes the temporary
root; do not point `unified:golden:compare` at the currently absent
`artifacts/unified-wallet-replay`. PostgreSQL skips are reported as skips, not
passed proof. This patch changes no SQL or schema, so no new database gate is
introduced.

- [ ] **Step 3: Audit forbidden semantic shortcuts**

```powershell
$forbidden = rg -n 'internal_label_approval_drain_proximity' src/risk/fastEvidence.ts
$rgExit = $LASTEXITCODE
if ($rgExit -eq 0) { $forbidden; throw 'flat_approval_fast_authority_remains' }
if ($rgExit -ne 1) { throw 'approval_authority_audit_failed' }
$timingCopy = rg -n 'temporalRelation.*modifier|blacklist_timing_' src/risk/scoringSignalMatrixInputs.ts
if ($LASTEXITCODE -gt 1) { throw 'blacklist_timing_audit_failed' }
$timingCopy
$forbidden = rg -n 'sanctionedCryptoServiceActiveAt' src tests
$rgExit = $LASTEXITCODE
if ($rgExit -eq 0) { $forbidden; throw 'boolean_sanctions_authority_remains' }
if ($rgExit -ne 1) { throw 'sanctions_authority_audit_failed' }
$forbidden = rg -n 'AddedBlackList\(address\).*===|RemovedBlackList\(address\).*===' src/tron/usdtBlacklistTimeline.ts
$rgExit = $LASTEXITCODE
if ($rgExit -eq 0) { $forbidden; throw 'blacklist_presentation_equality_remains' }
if ($rgExit -ne 1) { throw 'blacklist_signature_audit_failed' }
Write-Output 'correctness shortcut audit passed'
```

Expected:

- first command has no match;
- timing may remain a modifier for explanation, but eligibility is decided before candidate construction;
- old boolean sanctions helper has no match;
- decoded signature handling no longer uses exact presentation equality.

## Task 6: Update product truth and close the gate

- [ ] **Step 1: Update knowledge docs without rewriting history**

Record the source/timeline contract in
`04-data-sources-tronscan-indexing.md`, the Where interpretation in
`05-where-is-money-and-incoming.md`, the persisted Deep fact contract in
`06-deepcheck.md`, and the scoring decisions in
`07-risk-scoring-matrix.md` and `09-current-decisions.md`:

- exact approval authority requires direct approval plus transferFrom provenance;
- the flat proximity label is context-only;
- blacklist policy uses the active event-time subset and mixed subsets must independently pass materiality;
- decoded event text is corroboration, not the root authority;
- sanctions time is tri-state and unknown cannot become hard evidence.

Remove only the four resolved correctness bullets from `10-open-problems.md`. Do not remove Stage B, Stage C/D or Golden-data blockers. Mark the correctness row complete in `14-current-roadmap.md` and link the four implementation commits and verification commands. Do not recalculate historical reports.

Update `13-agent-observations.md` only if execution reveals a new recurring mistake not already recorded there.

- [ ] **Step 2: Verify doc/code consistency**

```powershell
rg -n "route_linked|became_active_after|indexed _user|sanction.*unknown|Correctness gate" docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/05-where-is-money-and-incoming.md docs/knowledge/06-deepcheck.md docs/knowledge/07-risk-scoring-matrix.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/14-current-roadmap.md
if ($LASTEXITCODE -ne 0) { throw 'correctness_documentation_audit_failed' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'correctness_documentation_diff_check_failed' }
```

- [ ] **Step 3: Commit product truth**

```powershell
git add docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/05-where-is-money-and-incoming.md docs/knowledge/06-deepcheck.md docs/knowledge/07-risk-scoring-matrix.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/14-current-roadmap.md
if ($LASTEXITCODE -ne 0) { throw 'correctness_documentation_stage_failed' }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'correctness_documentation_cached_diff_failed' }
git commit -m "docs(risk): close authority and temporal gate"
if ($LASTEXITCODE -ne 0) { throw 'correctness_documentation_commit_failed' }
```

If `13-agent-observations.md` legitimately changed, add it explicitly; otherwise leave it untouched.

## Final Acceptance Checklist

- [ ] Route-linked-only approval evidence remains visible as context and creates no durable exact assertion.
- [ ] Contract-driven and standalone Deep summaries apply the same subject-aware direct predicate; route/forged-hop-one profiles never render exact.
- [ ] A flat `approval_drain_proximity` label creates no Fast hard floor or exact Where proof.
- [ ] New flat markers do not stop money-origin traversal; stale unbound risky-label paths create no Where, Incoming or matrix hard authority.
- [ ] Stale risky-label aggregates/policy rows cannot create a source-policy decline or broad-history fallback without authoritative path/evidence linkage.
- [ ] Incoming risky-label materiality is recomputed from linked bound paths; `1%` bound plus `19%` stale stays below the `10%` decline threshold.
- [ ] Raw evidence and observations match the full direct profile identity; reusing tx IDs in a hop-one profile cannot bind.
- [ ] Admin hard node intelligence and exact receiver counts are recomputed from checked-subject direct profiles, never saved strength/features/counts alone.
- [ ] Exact approval plus transferFrom provenance still creates hard floor 95.
- [ ] Canonical and indexed decoded USDT blacklist declarations verify identically.
- [ ] Wrong topic, contract, address, name, result, confirmation, block, index or timestamp still fails closed.
- [ ] `became_active_after` and `unknown` create no direct-counterparty decline candidate.
- [ ] Mixed facts use only the active subset, its exact denominator and its transaction hashes.
- [ ] An incoming pre-activation transaction cannot borrow authority from another active transfer.
- [ ] Missing/invalid event or designation time is `unknown`, never active or historical-before-designation.
- [ ] Text aliases cannot recreate sanctions authority without typed time-aware evidence.
- [ ] Saved local sanctions artifacts require evidence-ID overlap with one consistent registry service proven active on the path; conflicting identities and unknown time remain context.
- [ ] Golden verification, typecheck, full tests and `git diff --check` pass.
- [ ] Knowledge docs match the code; historical stored results are not rewritten.
