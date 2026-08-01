# Final Scoring Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining final-scoring correctness gaps without changing the current softer HTX/Huobi share curve.

**Architecture:** Keep `src/forensics/provenanceScoring.ts` as the source-policy scoring source of truth. Remove old hard-policy shortcuts from trace selection, legacy policy engine, LLM evidence handling, proof-level derivation, and incoming path display.

**Tech Stack:** TypeScript, Vitest, existing forensic modules under `src/forensics`, existing policy module under `src/risk`.

---

## Scope Guard

Do not change the current `baseShareScore("htx_huobi", ...)` values:

```ts
<5%    -> 18
5-10%  -> 30
10-20% -> 45
20-30% -> 54
30-50% -> 68
50-80% -> 78
80%+   -> 85
```

Do not add a new Telegram report breakdown section in this plan.

## Files

- Modify: `src/forensics/moneyOriginTrace.ts`
- Modify: `tests/forensics/moneyOriginTrace.test.ts`
- Modify: `src/risk/riskPolicyEngine.ts`
- Modify: `tests/risk/riskPolicyEngine.test.ts`
- Modify: `src/forensics/contractLlmVerdict.ts`
- Modify: `tests/forensics/contractLlmVerdict.test.ts`
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`
- Modify: `tests/forensics/moneyOriginOperationalAssessment.test.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Modify: `tests/check/whereIsMoneyCheck.test.ts`
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`

---

## Task 1: Fix Trace Early Break

**Files:**
- Modify: `src/forensics/moneyOriginTrace.ts`
- Test: `tests/forensics/moneyOriginTrace.test.ts`

- [ ] **Step 1: Add a regression test where a policy boundary appears before a clean branch**

Add this test to `tests/forensics/moneyOriginTrace.test.ts`:

```ts
it("continues sibling branches after a source-policy boundary and can select a clean CEX route", async () => {
  const htx = "THTX1111111111111111111111111111111";
  const cleanHop = "TCleanHop11111111111111111111111111";

  const byAddress = new Map<string, ForensicRouteEdge[]>([
    [walletB, [
      edge("a-tx-htx-walletB", htx, walletB, "5000000000", "2026-05-22T10:14:00.000Z"),
      edge("b-tx-clean-walletB", cleanHop, walletB, "5000000000", "2026-05-22T10:13:00.000Z")
    ]],
    [cleanHop, [
      edge("tx-binance-clean", binance, cleanHop, "5000000000", "2026-05-22T10:12:00.000Z")
    ]]
  ]);

  const path = await traceMoneyOriginPath({
    subjectAddress: subject,
    balanceTransfer: balanceTransfer(walletB),
    maxDepth: 7,
    beamWidth: 8,
    maxAddressFetches: 60,
    maxEdgesPerAddress: 40,
    fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
    getLabelsForAddress: async () => [],
    getClassificationForAddress: async (address) => {
      if (address === htx) return service("cex", "HTX");
      if (address === binance) return service("cex", "Binance");
      return service("none", null);
    }
  });

  expect(path).toMatchObject({
    verdict: "ACCEPTABLE",
    rootSourceAddress: binance,
    stoppedReason: "allowlist_cex_reached"
  });
});
```

Why this test matters:

- `a-tx-htx-walletB` sorts before the clean candidate.
- Current code finds an HTX terminal, then breaks before exploring `cleanHop -> Binance`.
- The desired behavior explores the sibling clean branch.

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- tests/forensics/moneyOriginTrace.test.ts
```

Expected before implementation: the new test fails because the returned path is HTX/Huobi `DECLINE`.

- [ ] **Step 3: Remove global early break and make terminal ranking policy-aware**

In `src/forensics/moneyOriginTrace.ts`, replace the old global break:

```ts
if (terminals.some((path) => path.verdict === "DECLINE")) break;
```

with no global break. The loop should continue by assigning `frontier = nextFrontier...` until the beam is exhausted.

Then replace `terminalRank()` with policy-aware ranking:

```ts
function terminalRank(path: MoneyOriginPath): number {
  if (path.rootSourceType === "risky_label") return 5_000 + path.riskScoreContribution;

  if (path.rootSourceType === "decline_boundary" && path.balanceShare >= 0.5) {
    return 4_000 + path.riskScoreContribution;
  }

  if (path.rootSourceType === "allowlist_cex") {
    return 3_500 - path.txHashes.length;
  }

  if (path.rootSourceType === "decline_boundary") {
    return 2_500 + path.riskScoreContribution;
  }

  if (path.verdict === "REVIEW") return 1_000 + path.riskScoreContribution;
  return path.riskScoreContribution;
}
```

This keeps dominant policy boundaries above clean routes, but prevents minority/contextual source-policy branches from hiding clean CEX alternatives.

- [ ] **Step 4: Run trace tests**

Run:

```bash
npm test -- tests/forensics/moneyOriginTrace.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/forensics/moneyOriginTrace.ts tests/forensics/moneyOriginTrace.test.ts
git commit -m "fix: continue origin trace after policy boundary"
```

---

## Task 2: Align Legacy Risk Policy Engine With Weighted Source Scores

**Files:**
- Modify: `src/risk/riskPolicyEngine.ts`
- Test: `tests/risk/riskPolicyEngine.test.ts`

- [ ] **Step 1: Add tests for HTX/Huobi not being forced to 78**

Add to `tests/risk/riskPolicyEngine.test.ts`:

```ts
it("does not force minority HTX/Huobi source policy to fixed 78", () => {
  const decision = decideRiskPolicy(scoreComponents({
    moneyOriginScore: 45,
    signals: [riskPolicySignal("htx_huobi_source", ["money_path:htx-minority"])]
  }));

  expect(decision.riskScore).toBe(45);
  expect(decision.proofLevel).toBe("exchange_policy_context");
  expect(decision.userDecision).toBe("ACCEPTABLE");
});

it("declines HTX/Huobi only when weighted money-origin score reaches decline level", () => {
  const decision = decideRiskPolicy(scoreComponents({
    moneyOriginScore: 65,
    signals: [riskPolicySignal("htx_huobi_source", ["money_path:htx-strong"])]
  }));

  expect(decision).toMatchObject({
    userDecision: "DECLINE",
    proofLevel: "exchange_policy_decline",
    riskScore: 65
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm test -- tests/risk/riskPolicyEngine.test.ts
```

Expected before implementation: the first new test fails with risk score `78`.

- [ ] **Step 3: Replace fixed HTX/Huobi branch**

In `src/risk/riskPolicyEngine.ts`, replace the `htx_huobi_source` branch with weighted behavior:

```ts
if (hasSignal(input.signals, "htx_huobi_source")) {
  const score = boundedScore(input.moneyOriginScore);
  const isDecline = score >= 60;
  return decision(
    isDecline ? "DECLINE" : "REVIEW",
    isDecline ? "DECLINE" : "ACCEPTABLE",
    isDecline ? "exchange_policy_decline" : "exchange_policy_context",
    score,
    [reason(
      input,
      "htx_huobi_source",
      "HTX/Huobi exposure is source-policy risk, not scam/drain proof."
    )]
  );
}
```

Do not call `scoreAtLeast(input.moneyOriginScore, 78)` in this branch.

- [ ] **Step 4: Review WhiteBIT branch**

Keep WhiteBIT score share-based. If the current forced `DECLINE` for all WhiteBIT is too strict for this legacy engine, add this test:

```ts
it("keeps low-score WhiteBIT as source-policy context in the legacy engine", () => {
  const decision = decideRiskPolicy(scoreComponents({
    moneyOriginScore: 38,
    signals: [riskPolicySignal("whitebit_source", ["money_path:whitebit-context"])]
  }));

  expect(decision.riskScore).toBe(38);
  expect(decision.proofLevel).toBe("exchange_policy_context");
});
```

If product policy still requires WhiteBIT user-facing decline in this engine, keep `userDecision: "DECLINE"` but ensure the proof level and wording remain source-policy context, not hard proof.

- [ ] **Step 5: Run risk policy tests**

Run:

```bash
npm test -- tests/risk/riskPolicyEngine.test.ts
```

Expected: PASS.

- [ ] **Step 6: Verify the engine is still not imported by production code**

Run:

```bash
rg -n "decideRiskPolicy|riskPolicySignal|ScoreComponents" src tests --glob "!tests/risk/riskPolicyEngine.test.ts"
```

Expected: no production imports except the module definition itself. If production imports appear, manually verify those call sites now pass weighted scores.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/risk/riskPolicyEngine.ts tests/risk/riskPolicyEngine.test.ts
git commit -m "fix: align legacy risk policy with weighted source scores"
```

---

## Task 3: Make LLM Suspicion Contextual, Not Hard Evidence

**Files:**
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`
- Test: `tests/forensics/moneyOriginOperationalAssessment.test.ts`

- [ ] **Step 1: Replace tests that expect LLM suspicion in hardBadEvidence**

In `tests/forensics/moneyOriginOperationalAssessment.test.ts`, replace tests like:

```ts
it("declines high-confidence LLM drainer verdicts as hard bad evidence", () => {
```

with:

```ts
it("treats high-confidence LLM drainer verdicts as contextual contract suspicion, not hard proof", () => {
  const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
    contractLlmVerdicts: [{
      source: "llm",
      providerLabel: "deepseek",
      model: "deepseek-v4-pro",
      contractAddress: "TContract111111111111111111111111111",
      caseFileHash: "case-hash",
      cacheId: null,
      verdict: "drainer_like",
      confidence: 0.8,
      contractRiskScore: 82,
      decisionRecommendation: "DECLINE",
      reasons: ["Contract behaves like drainer."],
      citedEvidenceIds: ["tx-llm"],
      falsePositiveNotes: []
    }]
  }));

  expect(assessment.decision).toBe("DECLINE");
  expect(assessment.riskScore).toBeLessThanOrEqual(80);
  expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("llm_contract_suspicion");
  expect(assessment.contractSuspicionEvidence).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: "drainer_like",
      proofLevel: "llm_assisted_suspicion"
    })
  ]));
  expect(assessment.dominantRiskLayer?.proofLevel).toBe("llm_assisted_suspicion");
});
```

Add this exact-proof guard test:

```ts
it("keeps exact approval-drain provenance as hard proof even when LLM also reports suspicion", () => {
  const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
    approvalDrainProvenanceProfiles: [approvalDrainProfile({ score: 96 })],
    contractLlmVerdicts: [{
      source: "llm",
      providerLabel: "deepseek",
      model: "deepseek-v4-pro",
      contractAddress: "TContract111111111111111111111111111",
      caseFileHash: "case-hash",
      cacheId: null,
      verdict: "drainer_like",
      confidence: 0.9,
      contractRiskScore: 95,
      decisionRecommendation: "DECLINE",
      reasons: ["Contract behaves like drainer."],
      citedEvidenceIds: ["tx-llm"],
      falsePositiveNotes: []
    }]
  }));

  expect(assessment.hardBadEvidence.map((item) => item.kind)).toContain("approval_drain");
  expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("llm_contract_suspicion");
  expect(assessment.riskScore).toBeGreaterThanOrEqual(95);
});
```

- [ ] **Step 2: Run the failing assessment tests**

Run:

```bash
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
```

Expected before implementation: tests fail because `hardEvidenceFromLlm()` still emits `llm_contract_suspicion`.

- [ ] **Step 3: Stop emitting hard evidence from LLM**

In `src/forensics/moneyOriginOperationalAssessment.ts`, remove LLM verdicts from the hard evidence list:

```ts
const hardBadEvidence = [
  ...hardEvidenceFromFastRisk(input.fastWalletRisk),
  ...hardEvidenceFromApprovalDrain(input.approvalDrainProvenanceProfiles, { exactOnly: serviceRouteGuard }),
  ...hardEvidenceFromPaths(input.originPaths)
].sort((left, right) => right.score - left.score);
```

Then delete `hardEvidenceFromLlm()` if no longer used, or leave it unused only temporarily while removing all call sites.

- [ ] **Step 4: Cap LLM contract suspicion layer**

In `contractSuspicionLayers()`, replace:

```ts
const score = clampScore(Math.max(verdict.contractRiskScore, verdict.verdict === "drainer_like" ? 75 : 65));
```

with:

```ts
const floor = verdict.verdict === "drainer_like" ? 75 : 65;
const cap = verdict.verdict === "drainer_like" ? 80 : 75;
const score = clampScore(Math.min(cap, Math.max(verdict.contractRiskScore, floor)));
```

Keep:

```ts
proofLevel: "llm_assisted_suspicion"
canBeDampened: true
```

Add or keep the warning:

```ts
"LLM contract suspicion is contextual unless exact approval-drain provenance is proven."
```

- [ ] **Step 5: Run assessment tests**

Run:

```bash
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
```

Expected: PASS after updating expectations.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/forensics/moneyOriginOperationalAssessment.ts tests/forensics/moneyOriginOperationalAssessment.test.ts
git commit -m "fix: keep llm contract suspicion out of hard proof"
```

---

## Task 4: Harden LLM Case Files And Prompt Against Candidate-Finding Overconfidence

**Purpose:** Prevent TLhVzk/TJpMj-style false certainty where the LLM treats unresolved review findings as confirmed approval-drain evidence.

**Files:**
- Modify: `src/forensics/contractLlmVerdict.ts`
- Test: `tests/forensics/contractLlmVerdict.test.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`
- Optional helper changes: `src/forensics/approvalDrainProvenance.ts`, `src/types.ts`

- [ ] **Step 1: Add a regression fixture for TLhVzk/TJpMj-style overconfidence**

Add a test that builds a case file with:

```text
subjectAddress: TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe
contractAddress: TJpMjCCA...DvaQ
approvalDrainProvenanceProfiles: []
approvalDrainReviewFindings:
  - reason: approval_not_found
  - spenderResolution: wrapper_contract
  - supporting fingerprints: misleading_wrapper_method, nearby_non_usdt_token_transfer
service/receiver counter-evidence:
  - TUrnbc... is UniV3Adapter / swap_adapter / unknown_service route receiver
  - route context exists, but exact drain proof does not
```

The test should assert that the case file or derived LLM payload explicitly says:

```text
reviewFindingInterpretation: candidate_only_not_exact_proof
exactApprovalProofStatus: not_found
transferFromProofStatus: suspected_wrapper or not_confirmed
pathToCheckedWalletStatus: not_proven or blocked_by_service_boundary
```

This is not a test that TLh is clean. It is a test that the case file does not teach the LLM to call unresolved candidates exact drain.

- [ ] **Step 2: Add LLM-only proof interpretation fields**

In `src/forensics/contractLlmVerdict.ts`, add a derived representation for each `ApprovalDrainReviewFinding`. Do not remove the raw finding; add an LLM-safe interpretation next to it.

Target shape:

```ts
type LlmApprovalDrainReviewFinding = ApprovalDrainReviewFinding & {
  reviewFindingInterpretation: "candidate_only_not_exact_proof";
  exactApprovalProofStatus: "found" | "not_found" | "not_checked";
  transferFromProofStatus: "confirmed" | "suspected_wrapper" | "not_confirmed";
  spenderMatchStatus: "matched" | "not_matched" | "unknown";
  pathToCheckedWalletStatus: "proven" | "not_proven" | "blocked_by_service_boundary";
};
```

Mapping rules:

```text
reason=approval_not_found -> exactApprovalProofStatus=not_found
reason=path_not_proven -> pathToCheckedWalletStatus=not_proven
reason=service_boundary_guard -> pathToCheckedWalletStatus=blocked_by_service_boundary
spenderResolution=wrapper_contract -> transferFromProofStatus=suspected_wrapper unless deterministic transferFrom is present
```

If this is easier to ship without changing exported types, keep it as a serialized field inside the case file:

```ts
approvalDrainReviewInterpretations: [...]
```

- [ ] **Step 3: Make the prompt adaptive, not TLh-specific**

Update `systemPrompt` in `src/forensics/contractLlmVerdict.ts` with general rules:

```text
approvalDrainProvenanceProfiles are deterministic evidence candidates.
approvalDrainReviewFindings are unresolved review candidates, not confirmed drains.
approval_not_found means exact approval proof was not found; it weakens exact-drain proof.
Do not call a case exact approval-drain unless the case file contains deterministic approve/spender/transferFrom/path proof.
Service classifications, receiver classifications, route adapters, bridge/router/DEX labels, and economic output are false-positive guards.
Dust tokens, marker tokens, misleading method names, single-method proxies, unverified contracts, and low post-flow balance are supporting context only.
If verdict is drainer_like or unknown_suspicious, include falsePositiveNotes explaining why the case may still be a normal bridge/router/service route.
```

This prompt must work for:

- exact drainer fixtures;
- bridge/router/DEX approvals;
- GasFree / smart-account style wrappers;
- LayerZero/OFT delivery;
- unknown contract boundaries;
- TLhVzk/TJpMj-like route-linked suspicious wrappers.

- [ ] **Step 4: Bump LLM verdict policy version**

Change:

```ts
export const CONTRACT_LLM_VERDICT_POLICY_VERSION = "2026-05-28-contract-llm-v1";
```

to a new version, for example:

```ts
export const CONTRACT_LLM_VERDICT_POLICY_VERSION = "2026-05-31-contract-llm-v2";
```

Why: old cached DeepSeek verdicts, especially the `TJpMj...DvaQ` `drainer_like 90-95` verdict, were produced under ambiguous prompt semantics and must not be reused.

- [ ] **Step 5: Add post-LLM validation for unsupported exact-drain language**

In the LLM verdict application path, enforce:

```text
if verdict=drainer_like
and no approvalDrainProvenanceProfiles exist for this contract
then proofLevel remains llm_assisted_suspicion
and score is capped by Task 3 rules
and the report must not say exact approval-drain / proven drain / CRITICAL
```

This may be implemented in `moneyOriginOperationalAssessment.ts` as part of Task 3, but this task should add a contract-case regression test so the bug cannot come back through prompt changes.

- [ ] **Step 6: Add where-is-money regression for TLh-style LLM-only suspicion**

In `tests/check/whereIsMoneyCheck.test.ts`, add or update a fixture where the LLM returns:

```ts
verdict: "drainer_like"
confidence: 0.9
contractRiskScore: 95
decisionRecommendation: "DECLINE"
```

but deterministic exact approval-drain profiles are empty and review findings are candidate-only.

Expected:

```text
decision: DECLINE
riskScore <= 80
proofLevel: llm_assisted_suspicion
hardBadEvidence does not contain llm_contract_suspicion
decision reasons mention contextual LLM suspicion, not exact approval-drain proof
```

- [ ] **Step 7: Run LLM and where tests**

Run:

```bash
npm test -- tests/forensics/contractLlmVerdict.test.ts
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add src/forensics/contractLlmVerdict.ts tests/forensics/contractLlmVerdict.test.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "fix: clarify llm approval-drain review evidence"
```

---

## Task 5: Derive Proof Level From Structured Layers

**Files:**
- Modify: `src/check/whereIsMoneyCheck.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Add a proof-level regression test**

Add or update tests so that:

```ts
expect(report.proofLevel).toBe("llm_assisted_suspicion");
expect(report.proofLevel).not.toBe("exact_approval_drain_provenance");
expect(report.proofLevel).not.toBe("exact_scam_or_taint_proof");
```

for LLM-only `drainer_like` reports.

Add another test for HTX/Huobi source-policy:

```ts
expect(report.proofLevel).toMatch(/exchange_policy_/);
expect(report.assessment.hardBadEvidence).toEqual([]);
```

- [ ] **Step 2: Replace text fallback with structured fallback**

In `src/check/whereIsMoneyCheck.ts`, keep hard evidence and dominant layer logic, then remove reason-text inference for HTX/bridge/LLM/drain.

Target shape:

```ts
function proofLevelFromWhereDecision(input: {
  decision: ExchangeDecision;
  decisionReasons: string[];
  approvalDrainProvenanceProfileCount: number;
  assessment?: WhereIsMoneyAssessment | null;
}): ProofLevel {
  const topHardEvidence = input.assessment?.hardBadEvidence
    .slice()
    .sort((left, right) => right.score - left.score)[0] ?? null;
  if (topHardEvidence) return proofLevelFromHardEvidenceKind(topHardEvidence.kind);

  if (input.approvalDrainProvenanceProfileCount > 0) {
    return "exact_approval_drain_provenance";
  }

  if (input.assessment?.dominantRiskLayer?.proofLevel) {
    return input.assessment.dominantRiskLayer.proofLevel;
  }

  if (input.decision === "ACCEPTABLE") return "clean_source_proven";
  return "insufficient_coverage";
}
```

Do not inspect reason strings for `"HTX"`, `"LLM contract verdict"`, `"scam"`, `"bridge"`, or `"boundary"` in this function.

- [ ] **Step 3: Run where tests**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

Expected: PASS after updating proof-level expectations.

- [ ] **Step 4: Commit Task 5**

```bash
git add src/check/whereIsMoneyCheck.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "fix: derive where proof level from risk layers"
```

---

## Task 6: Clean Up Incoming Deposit Path-Level Mapping

**Files:**
- Modify: `src/forensics/incomingDepositJob.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Add path-level mapping tests**

Add tests that use transaction-seeded where output and verify:

```ts
expect(result.decision).toBe("ACCEPTABLE");
expect(result.depositRiskScore).toBeLessThan(60);
expect(result.hardBadEvidence).toEqual([]);
expect(result.originPaths[0]?.verdict).not.toBe("DECLINE");
expect(result.originPaths[0]?.sourcePolicy).not.toBe("hard_decline");
```

for a weak/minority HTX/Huobi path where the shared where report is acceptable.

Add a second test for a strong weighted source-policy path:

```ts
expect(result.decision).toBe("DECLINE");
expect(result.originPaths[0]?.sourcePolicy).toBe("hard_decline");
```

only when the where path/risk layer is decline-level.

- [ ] **Step 2: Run incoming tests and verify failure**

Run:

```bash
npm test -- tests/forensics/incomingDepositJob.test.ts
```

Expected before implementation: path-level mapping may still show `DECLINE`/`hard_decline` for contextual paths.

- [ ] **Step 3: Preserve internal path verdict where possible**

In `incomingPathFromWhere()`, replace:

```ts
verdict: path.verdict === "ACCEPTABLE" ? "ACCEPTABLE" : "DECLINE",
```

with:

```ts
verdict: path.verdict === "DECLINE" && path.riskScoreContribution >= 60
  ? "DECLINE"
  : "ACCEPTABLE",
```

If the incoming path type cannot represent `REVIEW`, use `ACCEPTABLE` for contextual/non-decline paths and let `depositRiskScore`, `dataQuality`, and reasons carry uncertainty.

- [ ] **Step 4: Make sourcePolicy weighted**

In `incomingSourcePolicy()`, replace broad `decline_boundary -> hard_decline` logic with score-aware logic:

```ts
function incomingSourcePolicy(path: MoneyOriginPath): IncomingDepositOriginPath["sourcePolicy"] {
  if (path.stoppedReason === "allowlist_cex_reached") return "clean";
  if (path.exposureSourceKey === "whitebit") {
    return path.riskScoreContribution >= 60 ? "hard_decline" : "medium_policy";
  }
  if (path.rootSourceType === "risky_label") return "hard_decline";
  if (path.rootSourceType === "decline_boundary") {
    return path.riskScoreContribution >= 60 ? "hard_decline" : "unknown";
  }
  return "unknown";
}
```

This does not change the final incoming decision; it makes path-level display honest.

- [ ] **Step 5: Run incoming tests**

Run:

```bash
npm test -- tests/forensics/incomingDepositJob.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "fix: align incoming path labels with weighted policy"
```

---

## Task 7: Full Verification

- [ ] **Step 1: Run focused tests**

```bash
npm test -- tests/forensics/moneyOriginTrace.test.ts
npm test -- tests/risk/riskPolicyEngine.test.ts
npm test -- tests/forensics/contractLlmVerdict.test.ts
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
npm test -- tests/check/whereIsMoneyCheck.test.ts
npm test -- tests/forensics/incomingDepositJob.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite if time allows**

```bash
npm test
```

Expected: PASS. If unrelated tests fail, capture exact failing test names and error messages.

- [ ] **Step 4: Audit for old fixed logic**

Run:

```bash
rg -n "scoreAtLeast\\(input\\.moneyOriginScore, 78\\)|hardEvidenceFromLlm|terminals\\.some\\(\\(path\\) => path\\.verdict === \"DECLINE\"\\)|reasonText\\.includes\\(\" src tests
```

Expected:

- no fixed HTX/Huobi `78` floor in `riskPolicyEngine`;
- no LLM hard evidence call path;
- old `CONTRACT_LLM_VERDICT_POLICY_VERSION = "2026-05-28-contract-llm-v1"` no longer remains after prompt/case-file semantics change;
- no global trace break on any `DECLINE`;
- no proof-level classification from reason text in `whereIsMoneyCheck`.

- [ ] **Step 5: Commit final verification updates**

Only if tests or docs changed during verification:

```bash
git add src tests docs
git commit -m "test: cover final scoring gap closure"
```

---

## Final PR Review Checklist

- [ ] Current HTX/Huobi base score table was not changed.
- [ ] Source-policy risk is not called scam proof.
- [ ] LLM `drainer_like` without exact transferFrom proof is not `hardBadEvidence`.
- [ ] LLM prompt explains that `approvalDrainReviewFindings` are candidate-only, not confirmed drain.
- [ ] LLM cache policy version is bumped after prompt/case-file semantics change.
- [ ] Exact approval-drain still wins as hard proof.
- [ ] Trace explores sibling branches after contextual policy boundaries.
- [ ] Legacy `riskPolicyEngine` cannot reintroduce fixed HTX/Huobi `78`.
- [ ] Incoming deposit path-level labels do not overstate contextual policy paths.
- [ ] Tests and typecheck pass.
