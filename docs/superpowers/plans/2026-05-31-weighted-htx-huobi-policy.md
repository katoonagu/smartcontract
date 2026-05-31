# Money Origin Policy Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calibrate money-origin and approval-risk decisions so minority policy exposure and isolated approvals do not become overstated scam/drain conclusions.

**Architecture:** Keep HTX/Huobi as a serious source-policy signal, but stop treating every close HTX/Huobi path as automatic `78/100 HIGH`. Add explicit exposure metadata to money-origin paths, aggregate total HTX/Huobi share across paths, and let operational-liquidity dampening apply when exposure is small and no hard bad evidence exists. Add approval-episode LLM classification as a separate evidence producer that feeds the same final decision layer; it cannot override deterministic exact-drain proof.

**Tech Stack:** TypeScript, Vitest, existing `where-is-money` forensic pipeline, existing approval safety recheck pipeline, existing `MoneyOriginPath`/`WhereIsMoneyAssessment` types, existing OpenAI-compatible LLM adapter/cache.

---

## Specification

### Current Problem

Current behavior is too rigid:

```text
HTX/Huobi source close in money path => DECLINE / 78 HIGH
```

This happens even when:

- HTX/Huobi explains only a minority share of the selected provenance target.
- The rest of the wallet looks operational/liquidity-like.
- There is no blacklist/scam/approval-drain proof.
- Other paths are clean CEX, weak/unproven, or ordinary EOA liquidity flows.

Concrete observed example:

```text
TVzGY...iZMF
Balance-forming target: 104,159.838307 USDT
HTX path: HTX 4 -> TG9Xyp... -> TVzGY...
HTX-linked transfer to checked wallet: 15,263 USDT
Share: about 15%
Current result: DECLINE 78/100 HIGH
```

The score is high because `HTX/Huobi` currently overrides the whole decision, not because `15%` exposure alone is objectively high enough.

### Desired Policy

HTX/Huobi remains stricter than WhiteBIT, but becomes weighted:

```text
HTX/Huobi exposure < 10%
  medium context bump, not hard decline by itself

HTX/Huobi exposure 10-30%
  medium/high context depending proximity, recency, repetition, wallet role
  not automatic hard evidence

HTX/Huobi exposure 30-50%
  strong policy risk, usually DECLINE unless there is strong clean/operational context

HTX/Huobi exposure >= 50%
  hard HIGH / DECLINE
```

Decision rules:

```text
Exact taint / approval drain / blacklist:
  unchanged, always hard DECLINE

HTX/Huobi >= 50%:
  DECLINE, 78+

HTX/Huobi 30-50%:
  DECLINE, 65-72

HTX/Huobi 10-30%:
  score 45-58
  if direct/very close and wallet is young/non-operational/repeated exposure -> DECLINE MEDIUM/HIGH
  if operational/liquidity and no other hard evidence -> ACCEPTABLE or LOW-MEDIUM/MEDIUM with warning

HTX/Huobi < 10%:
  score 35-42
  never hard evidence by itself
```

User-facing wording must be honest:

```text
HTX/Huobi exposure: 15% of selected provenance target.
This is source-policy risk, not scam/blacklist proof.
Wallet looks operational; no hard bad evidence found.
```

### Additional Task: Approval Episode LLM Classifier

This plan also includes one independent follow-up task for approval scoring. It is separate from HTX/Huobi weighting, but it fixes the same class of problem: isolated signals can overstate risk when they are not interpreted in their transaction episode.

Problem case:

```text
owner approves TPwez...Et5s
owner approves TNKG...pxQ5 a few minutes later
nearby txs look like bridge/router/GasFree/service route
another contract later looks drainer-like
```

The system must not collapse all approvals into one verdict. It must analyze a current approval as the primary subject, while passing earlier/later approvals in the same time window as context.

Decision model:

```text
Exact approve -> transferFrom -> checked wallet/receiver path:
  deterministic DECLINE/CRITICAL, no LLM needed for final decision

Current approval is known bridge/router/GasFree service route:
  LOW/LOW-MEDIUM, even if allowance is unlimited

Current approval is unknown active unlimited contract:
  evaluate episode with LLM case file
  do not call it exact drain unless transferFrom/drain facts exist

Current approval is unknown but close to legitimate service route:
  MEDIUM context risk, not scam proof
```

Approval sequence semantics:

```text
First approval in a session:
  LLM receives current approval + following route/output txs if available.

Second approval in the same session:
  LLM receives second approval as currentApproval and first approval as previousApprovalContext.
  The report must include both:
    currentApprovalVerdict
    episodeVerdict

Two approvals are grouped into one episode only if they share owner and are within:
  default window: 30 minutes
  extended window: 2 hours when bridge/swap/router/GasFree route evidence exists
```

LLM input must be a fact-only case file. It may include contract source/ABI if already fetched, method selectors, tx details, labels, service-route evidence, transferFrom evidence, active allowance status, proxy/creator metadata, and nearby token movements. It must not receive our final risk score as a fact to rubber-stamp.

LLM output must separate:

```text
approvalSafetyRisk
drainProofRisk
currentApprovalVerdict
episodeVerdict
falsePositiveNotes
```

The LLM can recommend `DECLINE`, but deterministic exact-drain proof and policy rules remain higher priority than LLM text. If data is incomplete, the LLM should return `insufficient_data`; the system may still decline by default-deny policy, but the explanation must not say "drainer proven".

### Shared Decision Contract

All tasks in this plan must feed one final assessment contract. Do not create a separate final-decision path for HTX/Huobi, approval safety, incoming deposits, or `where-is-money`.

Decision priority:

```text
1. Deterministic hard proof
   blacklist, USDT blacklist, exact approve -> transferFrom -> checked wallet, confirmed theft/scam label
   => DECLINE / CRITICAL-HIGH

2. Hard service policy
   bridge/router/DEX/cross-chain boundary where policy forbids exchange
   => DECLINE by source policy, not scam proof

3. Weighted exchange policy
   HTX/Huobi by aggregate exposure share
   WhiteBIT as medium policy exposure
   => score depends on share, proximity, repetition, wallet role

4. Contract/approval intelligence
   deterministic contract facts first
   LLM verdict only after complete case file
   positive legitimate_service verdict can lower unknown-contract risk
   LLM cannot create exact-drain proof without transferFrom facts

5. Operational context
   wallet age, liquidity behavior, repeated relationships, coverage quality
   can dampen unproven/low-share exposure
   cannot dampen deterministic hard proof
```

Shared report language:

```text
Hard bad evidence:
  only exact taint, blacklist, proven approval-drain, or equivalent deterministic proof

Policy risk:
  HTX/Huobi, WhiteBIT, bridge/router/DEX/cross-chain boundaries

Unproven boundary:
  unknown contract or unproven EOA origin without exact bad proof

LLM contract verdict:
  supporting classification, never the source of blockchain facts
```

Integration rule:

```text
where-is-money, low-balance recent-flow, incoming_deposit_check, deep forensic checks, and approval safety recheck must read the same evidence summaries when they need:
  exchange exposure
  service boundary classification
  contract LLM verdict
  approval episode verdict
```

This prevents the old problem where one mode is updated while another mode still uses stale scoring logic.

### Non-Goals

- Do not weaken exact scam/blacklist/approval-drain proof.
- Do not change bridge/router/DEX hard policy in this task.
- Do not rework low-balance recent-flow selection.
- Do not add new LLM calls for HTX/Huobi labels.
- Do not let approval episode LLM verdicts override deterministic exact drain proof.

---

## Execution Order

Implement this plan in this order:

```text
Task 1 -> Task 2 -> Task 3 -> Task 4:
  HTX/Huobi weighted policy and where-is-money reporting

Task 5:
  checkpoint smoke for HTX/Huobi only

Task 6:
  approval episode LLM evidence producer

Task 7:
  full cross-mode integration smoke
```

Do not implement Task 6 before Tasks 1-4 in the same worktree unless the branch is explicitly rebased first. Task 6 touches approval/LLM integration and should not be mixed into money-origin policy diffs during review.

## File Map

**Create**

- `src/approvals/approvalEpisodeTypes.ts`
  - Define `ApprovalEpisodeCaseFile`, `ApprovalEpisodeLlmVerdict`, and normalized evidence item types.

- `src/approvals/approvalEpisodeCaseFile.ts`
  - Build fact-only case files for one primary approval plus session context.

- `src/approvals/approvalEpisodeLlmClassifier.ts`
  - Call the existing OpenAI-compatible JSON LLM client and validate strict episode verdict JSON.

- `tests/approvals/approvalEpisodeCaseFile.test.ts`
  - Cover grouping semantics and case-file content for known service, unknown approval, and exact drain.

- `tests/approvals/approvalEpisodeLlmClassifier.test.ts`
  - Cover JSON validation, positive service verdict, drainer-like verdict, and invalid/unavailable LLM.

**Modify**

- `src/forensics/moneyOriginPolicy.ts`
  - Add HTX/Huobi share scoring helpers.
  - Add aggregate HTX/Huobi exposure logic, similar to WhiteBIT aggregation.
  - Stop returning fixed `78` for every HTX/Huobi path.

- `src/forensics/moneyOriginOperationalAssessment.ts`
  - Stop converting every HTX/Huobi path into hard bad evidence.
  - Add weighted HTX/Huobi assessment branch before generic operational-liquidity branch.
  - Let operational-liquidity dampen low-share HTX/Huobi exposure.

- `src/check/whereIsMoneyCheck.ts`
  - Ensure proof-level detection still maps weighted HTX/Huobi `DECLINE` to `exchange_policy_decline`.
  - Ensure non-hard weighted HTX/Huobi reasons do not imply scam/taint proof.

- `tests/forensics/moneyOriginPolicy.test.ts`
  - Update fixed HTX/Huobi policy tests.
  - Add share-based HTX/Huobi tests.

- `tests/forensics/moneyOriginOperationalAssessment.test.ts`
  - Add operational-liquidity dampening tests.
  - Add high-share hard-decline tests.

- `tests/check/whereIsMoneyCheck.test.ts`
  - Update regression case for HTX through clean EOA.
  - Add TVz-like 15% HTX exposure test.

- `tests/fixtures/forensics/regressionCases.ts`
  - Update expected scores/proof levels for HTX cases if snapshots reference old fixed 78 behavior.

- `src/approvals/safetyRecheck.ts`
  - Feed active approval checks through approval-episode classification when contract context is available.

- `src/approvals/approvalWorker.ts`
  - Store episode verdict summary separately from deterministic approval facts.

- `src/forensics/contractLlmVerdict.ts`
  - Reuse the existing LLM adapter and cache policy for approval-episode case files.

**Shared Integration Boundaries**

- `src/forensics/moneyOriginOperationalAssessment.ts`
  - Owns the final score/risk-band reconciliation for money-origin context.
  - Must consume weighted exchange exposure and positive LLM service verdicts before applying operational dampening.

- `src/check/whereIsMoneyCheck.ts`
  - Owns user-facing `where-is-money` report shaping.
  - Must not independently reinterpret approval episode verdicts as hard bad evidence.

- `src/forensics/incomingDepositJob.ts`
  - Owns transaction-centric incoming deposit checks.
  - Must consume the same exchange/service/contract evidence summaries as `where-is-money`, not a separate copy of HTX/approval rules.

- `src/approvals/safetyRecheck.ts`
  - Owns approval-specific hygiene and drain-proof checks.
  - Must export compact episode verdict summaries for other forensic reports instead of duplicating final wallet scoring.

---

## Task 1: Add HTX/Huobi Weighted Scoring In Money Origin Policy

**Files:**
- Modify: `src/forensics/moneyOriginPolicy.ts`
- Test: `tests/forensics/moneyOriginPolicy.test.ts`

- [ ] **Step 1: Write failing tests for HTX/Huobi share tiers**

Add tests near the existing HTX/Huobi test in `tests/forensics/moneyOriginPolicy.test.ts`:

```ts
it("scores HTX/Huobi sources by selected provenance share", () => {
  expect(classifyMoneyOriginStop({
    address,
    labels: [],
    classification: service("cex", "HTX 4"),
    balanceShare: 0.08
  })).toMatchObject({
    verdict: "REVIEW",
    rootSourceType: "decline_boundary",
    stoppedReason: "decline_boundary_reached",
    riskScoreContribution: 40,
    exposureSourceKey: "htx_huobi",
    exposureSourceLabel: "HTX/Huobi"
  });

  expect(classifyMoneyOriginStop({
    address,
    labels: [],
    classification: service("cex", "Huobi"),
    balanceShare: 0.15
  })).toMatchObject({
    verdict: "REVIEW",
    riskScoreContribution: 50,
    exposureSourceKey: "htx_huobi"
  });

  expect(classifyMoneyOriginStop({
    address,
    labels: [],
    classification: service("cex", "HTX"),
    balanceShare: 0.35
  })).toMatchObject({
    verdict: "DECLINE",
    riskScoreContribution: 68,
    exposureSourceKey: "htx_huobi"
  });

  expect(classifyMoneyOriginStop({
    address,
    labels: [],
    classification: service("cex", "HTX"),
    balanceShare: 0.55
  })).toMatchObject({
    verdict: "DECLINE",
    riskScoreContribution: 78,
    exposureSourceKey: "htx_huobi"
  });
});
```

- [ ] **Step 2: Run the focused policy test and verify it fails**

Run:

```bash
npm test -- tests/forensics/moneyOriginPolicy.test.ts
```

Expected: FAIL because HTX/Huobi currently always returns `DECLINE 78` without `exposureSourceKey`.

- [ ] **Step 3: Add HTX/Huobi scoring helpers**

In `src/forensics/moneyOriginPolicy.ts`, add after `whitebitMediumScore`:

```ts
function htxHuobiWeightedScore(balanceShare: number): number {
  if (balanceShare >= 0.5) return 78;
  if (balanceShare >= 0.3) return 68;
  if (balanceShare >= 0.1) return 50;
  return 40;
}

function htxHuobiWeightedVerdict(balanceShare: number): ExchangeDecision {
  return balanceShare >= 0.3 ? "DECLINE" : "REVIEW";
}
```

- [ ] **Step 4: Replace fixed HTX/Huobi classify branch**

Replace the current `hasHighRiskIdentity(text)` branch in `classifyMoneyOriginStop` with:

```ts
  if (hasHighRiskIdentity(text)) {
    const score = htxHuobiWeightedScore(input.balanceShare);
    return {
      verdict: htxHuobiWeightedVerdict(input.balanceShare),
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: score,
      exposureSourceKey: "htx_huobi",
      exposureSourceLabel: "HTX/Huobi",
      reasons: [
        `Balance-forming path has HTX/Huobi exposure (${formatShare(input.balanceShare)} of selected provenance target); this is source-policy risk, not direct scam/blacklist proof.`
      ]
    };
  }
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/forensics/moneyOriginPolicy.test.ts
```

Expected: PASS after updating any old assertion that expected fixed `78`.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/forensics/moneyOriginPolicy.ts tests/forensics/moneyOriginPolicy.test.ts
git commit -m "feat: weight htx huobi money origin exposure"
```

---

## Task 2: Aggregate HTX/Huobi Exposure Across Paths

**Files:**
- Modify: `src/forensics/moneyOriginPolicy.ts`
- Test: `tests/forensics/moneyOriginPolicy.test.ts`

- [ ] **Step 1: Write failing aggregate exposure tests**

Add below the WhiteBIT aggregate test:

```ts
it("aggregates HTX/Huobi exposure across multiple paths without hard 78 for low share", () => {
  const decision = combineMoneyOriginDecision([
    path("REVIEW", 40, "tx-htx-1", {
      balanceShare: 0.08,
      exposureSourceKey: "htx_huobi",
      exposureSourceLabel: "HTX/Huobi",
      reasons: ["Balance-forming path has HTX/Huobi exposure (8% of selected provenance target)."]
    }),
    path("REVIEW", 40, "tx-htx-2", {
      balanceShare: 0.07,
      exposureSourceKey: "htx_huobi",
      exposureSourceLabel: "HTX/Huobi",
      reasons: ["Balance-forming path has HTX/Huobi exposure (7% of selected provenance target)."]
    }),
    path("ACCEPTABLE", 5, "tx-binance")
  ]);

  expect(decision).toMatchObject({
    decision: "REVIEW",
    riskScore: 50
  });
  expect(decision.decisionReasons[0]).toContain("combined HTX/Huobi exposure (15% of selected provenance target)");
});

it("declines combined high HTX/Huobi exposure", () => {
  const decision = combineMoneyOriginDecision([
    path("REVIEW", 50, "tx-htx-1", {
      balanceShare: 0.2,
      exposureSourceKey: "htx_huobi",
      exposureSourceLabel: "HTX/Huobi",
      reasons: ["Balance-forming path has HTX/Huobi exposure (20% of selected provenance target)."]
    }),
    path("REVIEW", 50, "tx-htx-2", {
      balanceShare: 0.15,
      exposureSourceKey: "htx_huobi",
      exposureSourceLabel: "HTX/Huobi",
      reasons: ["Balance-forming path has HTX/Huobi exposure (15% of selected provenance target)."]
    })
  ]);

  expect(decision).toMatchObject({
    decision: "DECLINE",
    riskScore: 68
  });
  expect(decision.decisionReasons[0]).toContain("combined HTX/Huobi exposure (35% of selected provenance target)");
});
```

- [ ] **Step 2: Add aggregate helper**

In `src/forensics/moneyOriginPolicy.ts`, add after `aggregateWhitebitExposure`:

```ts
function aggregateHtxHuobiExposure(paths: MoneyOriginPath[]): { decision: ExchangeDecision; riskScore: number; reason: string } | null {
  const htxPaths = paths.filter((path) => path.exposureSourceKey === "htx_huobi");
  if (htxPaths.length === 0) return null;
  const totalShare = Math.min(1, htxPaths.reduce((sum, path) => {
    const share = path.balanceShare ?? 0;
    return Number.isFinite(share) && share > 0 ? sum + share : sum;
  }, 0));
  if (totalShare <= 0) return null;
  const riskScore = htxHuobiWeightedScore(totalShare);
  return {
    decision: htxHuobiWeightedVerdict(totalShare),
    riskScore,
    reason: `Balance-forming paths have combined HTX/Huobi exposure (${formatShare(totalShare)} of selected provenance target) across ${htxPaths.length} txs; this is source-policy risk, not direct scam/blacklist proof.`
  };
}
```

- [ ] **Step 3: Use aggregate helper in `combineMoneyOriginDecision`**

Update `combineMoneyOriginDecision`:

```ts
  const whitebitExposure = aggregateWhitebitExposure(paths);
  const htxHuobiExposure = aggregateHtxHuobiExposure(paths);
  const reasons = sorted.flatMap((path) => path.reasons);
  const aggregateDecision = htxHuobiExposure?.decision === "DECLINE"
    ? "DECLINE"
    : sorted[0].verdict;

  return {
    decision: aggregateDecision,
    riskScore: Math.max(
      ...paths.map((path) => path.riskScoreContribution),
      whitebitExposure?.riskScore ?? 0,
      htxHuobiExposure?.riskScore ?? 0
    ),
    decisionReasons: [
      ...(htxHuobiExposure ? [htxHuobiExposure.reason] : []),
      ...(whitebitExposure ? [whitebitExposure.reason] : []),
      ...reasons
    ].slice(0, 6)
  };
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/forensics/moneyOriginPolicy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/forensics/moneyOriginPolicy.ts tests/forensics/moneyOriginPolicy.test.ts
git commit -m "feat: aggregate htx huobi exposure share"
```

---

## Task 3: Stop Treating Low-Share HTX/Huobi As Hard Bad Evidence

**Files:**
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`
- Test: `tests/forensics/moneyOriginOperationalAssessment.test.ts`

- [ ] **Step 1: Add operational dampening test**

In `tests/forensics/moneyOriginOperationalAssessment.test.ts`, add a test using existing local helpers in that file. The expected behavior:

```ts
it("does not hard-decline an operational wallet for minority HTX/Huobi exposure", () => {
  const assessment = buildMoneyOriginOperationalAssessment({
    ...baseInput(),
    originPaths: [
      reviewPath({
        riskScoreContribution: 50,
        balanceShare: 0.15,
        rootSourceType: "decline_boundary",
        stoppedReason: "decline_boundary_reached",
        exposureSourceKey: "htx_huobi",
        exposureSourceLabel: "HTX/Huobi",
        reasons: ["Balance-forming path has HTX/Huobi exposure (15% of selected provenance target); this is source-policy risk, not direct scam/blacklist proof."]
      }),
      acceptablePath({ balanceShare: 0.85, riskScoreContribution: 5 })
    ],
    senderInteractionProfiles: [operationalLiquidityProfile()],
    coverage: coverage({ coverageRatio: 1, fetchedAddressCount: 12, maxDepth: 20 })
  });

  expect(assessment.decision).toBe("ACCEPTABLE");
  expect(assessment.riskScore).toBeGreaterThanOrEqual(30);
  expect(assessment.riskScore).toBeLessThanOrEqual(45);
  expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("htx_huobi_source");
  expect(assessment.reasons.join(" ")).toContain("HTX/Huobi exposure");
});
```

If helper names differ in this test file, use the existing helper names instead of creating a second fixture style.

- [ ] **Step 2: Add high-share hard decline test**

Add:

```ts
it("hard-declines high-share HTX/Huobi exposure", () => {
  const assessment = buildMoneyOriginOperationalAssessment({
    ...baseInput(),
    originPaths: [
      declinePath({
        riskScoreContribution: 78,
        balanceShare: 0.55,
        rootSourceType: "decline_boundary",
        stoppedReason: "decline_boundary_reached",
        exposureSourceKey: "htx_huobi",
        exposureSourceLabel: "HTX/Huobi",
        reasons: ["Balance-forming path has HTX/Huobi exposure (55% of selected provenance target); this is source-policy risk, not direct scam/blacklist proof."]
      })
    ]
  });

  expect(assessment.decision).toBe("DECLINE");
  expect(assessment.riskScore).toBeGreaterThanOrEqual(78);
  expect(assessment.hardBadEvidence.map((item) => item.kind)).toContain("htx_huobi_source");
});
```

- [ ] **Step 3: Add HTX/Huobi exposure helpers to operational assessment**

In `src/forensics/moneyOriginOperationalAssessment.ts`, add near `firstPathReason`:

```ts
function htxHuobiPaths(paths: MoneyOriginPath[]): MoneyOriginPath[] {
  return paths.filter((path) => path.exposureSourceKey === "htx_huobi");
}

function htxHuobiExposureShare(paths: MoneyOriginPath[]): number {
  return Math.min(1, htxHuobiPaths(paths).reduce((sum, path) => {
    const share = pathShare(path);
    return Number.isFinite(share) && share > 0 ? sum + share : sum;
  }, 0));
}

function htxHuobiAssessmentScore(share: number): number {
  if (share >= 0.5) return 78;
  if (share >= 0.3) return 68;
  if (share >= 0.1) return 50;
  return 40;
}

function htxHuobiExposureReason(paths: MoneyOriginPath[]): string {
  const share = htxHuobiExposureShare(paths);
  return `HTX/Huobi exposure is ${Math.round(share * 100)}% of selected provenance target; this is source-policy risk, not direct scam/blacklist proof.`;
}
```

- [ ] **Step 4: Update `hardEvidenceFromPaths`**

Replace the current HTX/Huobi hard-evidence block:

```ts
    if (
      path.rootSourceType === "decline_boundary" &&
      (exposureText.includes("htx") ||
        exposureText.includes("huobi") ||
        reasonText.includes("htx") ||
        reasonText.includes("huobi"))
    ) {
      evidence.push({
        kind: "htx_huobi_source",
        score: Math.max(path.riskScoreContribution, 78),
        message: path.reasons[0] ?? "Balance-forming path reaches HTX/Huobi high-risk source.",
        evidenceIds: path.txHashes
      });
      continue;
    }
```

with:

```ts
    if (
      path.rootSourceType === "decline_boundary" &&
      path.exposureSourceKey === "htx_huobi" &&
      path.riskScoreContribution >= 68
    ) {
      evidence.push({
        kind: "htx_huobi_source",
        score: path.riskScoreContribution,
        message: path.reasons[0] ?? "Balance-forming path reaches high-share HTX/Huobi source-policy exposure.",
        evidenceIds: path.txHashes
      });
      continue;
    }
```

This makes `>=30%` path-level HTX/Huobi exposure hard evidence, but keeps `10-30%` as policy context.

- [ ] **Step 5: Add weighted HTX/Huobi branch before WhiteBIT branch**

In `buildMoneyOriginOperationalAssessment`, after `unknownSuspiciousVerdict` branch and before `whitebitPaths`, add:

```ts
  const htxPaths = htxHuobiPaths(input.originPaths);
  const htxShare = htxHuobiExposureShare(input.originPaths);
  if (htxPaths.length > 0 && htxShare > 0 && htxShare < 0.3) {
    const exposureScore = htxHuobiAssessmentScore(htxShare);
    if (role === "operational_liquidity_wallet" && hardBadEvidence.length === 0 && input.approvalDrainReviewFindings.length === 0) {
      const operationalRisk = operationalRiskScore({
        provenanceConfidence: provenanceScore,
        coverageCompleteness: coverageScore,
        highestPathRisk: exposureScore,
        ageAdjustment: ageRiskAdjustment(input.ageSignals)
      });
      const riskScore = clampScore(Math.min(45, Math.max(30, operationalRisk, exposureScore - 15)));
      return {
        decision: "ACCEPTABLE",
        riskScore,
        riskBand: riskBandFromWhereScore(riskScore),
        provenanceConfidence: provenanceScore,
        coverageCompleteness: coverageScore,
        walletRole: role,
        operationalLiquidityScore: operationalScore,
        ageSignals: input.ageSignals ?? null,
        hardBadEvidence: [],
        reasons: [
          `${htxHuobiExposureReason(input.originPaths)} Wallet looks operational/liquidity-like and no hard bad evidence was found.`
        ],
        warnings: [
          "Minority HTX/Huobi exposure lowers provenance confidence but does not by itself prove high risk.",
          ...(input.coverage.partial ? ["Coverage is partial; result is conservative."] : []),
          ...approvalWarnings,
          ...llmWarnings
        ]
      };
    }
  }
```

- [ ] **Step 6: Run focused operational assessment tests**

Run:

```bash
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/forensics/moneyOriginOperationalAssessment.ts tests/forensics/moneyOriginOperationalAssessment.test.ts
git commit -m "fix: avoid hard decline for minority htx huobi exposure"
```

---

## Task 4: Update Where-Is-Money Regression Tests And Reporting

**Files:**
- Modify: `tests/check/whereIsMoneyCheck.test.ts`
- Modify: `tests/fixtures/forensics/regressionCases.ts`
- Verify: `src/check/whereIsMoneyCheck.ts`

- [ ] **Step 1: Add TVz-like minority HTX test**

In `tests/check/whereIsMoneyCheck.test.ts`, add a test near existing HTX/WhiteBIT tests:

```ts
it("does not force HIGH decline for minority HTX exposure on operational wallet", async () => {
  const subject = "TSubject111111111111111111111111111";
  const htx = "THTX111111111111111111111111111111";
  const relay = "TRelay1111111111111111111111111111";
  const cleanSender = "TClean111111111111111111111111111";

  const report = await runWhereIsMoneyCheck(testDeps({
    balanceRaw: "100000000000",
    edgesByAddress: new Map([
      [subject, [
        edge("tx-htx-relay-subject", relay, subject, "15000000000", "2026-05-30T21:02:00.000Z"),
        edge("tx-clean-subject", cleanSender, subject, "85000000000", "2026-05-30T20:00:00.000Z")
      ]],
      [relay, [
        edge("tx-htx-relay", htx, relay, "16000000000", "2026-05-23T08:56:15.000Z")
      ]],
      [cleanSender, []]
    ]),
    getClassificationForAddress: async (address) => {
      if (address === htx) return service("cex", "HTX 4");
      return service("none", null);
    },
    senderInteractionProfiles: "operational"
  }), {
    sourceAddress: subject,
    windowStart: new Date("2026-05-01T00:00:00.000Z"),
    windowEnd: new Date("2026-05-31T00:00:00.000Z"),
    maxDepth: 20
  });

  expect(report.riskScore).toBeLessThan(60);
  expect(report.assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("htx_huobi_source");
  expect(report.decisionReasons.join(" ")).toContain("HTX/Huobi exposure");
});
```

Use the actual test helpers already present in `whereIsMoneyCheck.test.ts`; if `senderInteractionProfiles` is not a helper option, create realistic two-sided sender edges instead.

- [ ] **Step 2: Update old fixed HTX regression**

Find the test named like:

```ts
it("declines HTX through a clean EOA as an exchange policy case", ...)
```

Split it into two cases:

```text
small/minority HTX exposure -> weighted medium context
majority HTX exposure -> exchange policy decline
```

The majority case should still expect:

```ts
expect(report.decision).toBe("DECLINE");
expect(report.riskScore).toBeGreaterThanOrEqual(68);
expect(report.proofLevel).toBe("exchange_policy_decline");
```

- [ ] **Step 3: Verify proof level wording**

Inspect `src/check/whereIsMoneyCheck.ts`. Keep `proofLevelFromWhereDecision` behavior:

```ts
if (hasExchangePolicySignal) {
  return "exchange_policy_decline";
}
```

No code change is required if weighted HTX/Huobi `DECLINE` reasons still include `HTX/Huobi`.

- [ ] **Step 4: Update regression fixtures**

Open `tests/fixtures/forensics/regressionCases.ts`.

If a case named `HTX through clean EOA is high policy decline` expects fixed `78`, rename or update:

```ts
{
  name: "Majority HTX through clean EOA is high policy decline",
  expectedProofLevel: "exchange_policy_decline"
}
```

Add or update minority fixture:

```ts
{
  name: "Minority HTX exposure is weighted policy context",
  expectedProofLevel: "operational_liquidity_context"
}
```

Only add the fixture if the regression fixture system supports this scenario without a large rewrite.

- [ ] **Step 5: Run where-is-money tests**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts tests/fixtures/forensics/regressionCases.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add tests/check/whereIsMoneyCheck.test.ts tests/fixtures/forensics/regressionCases.ts src/check/whereIsMoneyCheck.ts
git commit -m "test: cover weighted htx huobi where is money policy"
```

---

## Task 5: HTX/Huobi Checkpoint Smoke On Known Wallets

**Files:**
- No source changes.
- Output: terminal and Telegram/manual report if requested.

- [ ] **Step 1: Run full test suite**

```bash
npm run typecheck
npm test
```

Expected:

```text
typecheck PASS
all Vitest suites PASS
```

This is a checkpoint after Tasks 1-4. Task 6 adds approval episode code later, so the final all-mode smoke happens again in Task 7.

- [ ] **Step 2: Run TVz live smoke**

```bash
npm run forensic:where-is-money -- -- --source TVzGYWyg89wUmwhvbcwfonHVLDYYQAiZMF --depth 20 --beam 8 --max-addresses 60 --max-edges 40 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 15000
```

Expected qualitative result:

```text
HTX/Huobi exposure around 15% is shown explicitly.
No "Hard bad evidence: htx_huobi_source" unless aggregate exposure reaches high-share threshold.
Risk should be lower than old 78 unless another hard signal appears.
Report says source-policy risk, not scam/blacklist proof.
```

- [ ] **Step 3: Run high-share synthetic or fixture smoke**

Use the test fixture from Task 4 or add a CLI fixture if available.

Expected:

```text
HTX/Huobi >= 50% remains DECLINE HIGH.
```

- [ ] **Step 4: Run control wallets**

```bash
npm run forensic:where-is-money -- -- --source TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM --depth 20 --beam 8 --max-addresses 60 --max-edges 40 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 15000
npm run forensic:where-is-money -- -- --source TTs9xCEZ43niXvfKTu7LcF7Kcud3Bbw7FD --depth 20 --beam 8 --max-addresses 60 --max-edges 40 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 15000
```

Expected:

```text
TEYPUt remains ACCEPTABLE LOW-MEDIUM unless new live data changed.
TTs9x remains ACCEPTABLE LOW-MEDIUM unless new live data changed.
```

- [ ] **Step 5: Commit verification notes if docs changed**

Only commit if the implementation added or changed docs:

```bash
git add docs/superpowers/plans/2026-05-31-weighted-htx-huobi-policy.md
git commit -m "docs: plan weighted htx huobi policy"
```

---

## Task 6: Approval Episode LLM Case File And Verdict

**Files:**
- Create: `src/approvals/approvalEpisodeTypes.ts`
- Create: `src/approvals/approvalEpisodeCaseFile.ts`
- Create: `src/approvals/approvalEpisodeLlmClassifier.ts`
- Modify: `src/approvals/safetyRecheck.ts`
- Modify: `src/approvals/approvalWorker.ts`
- Modify: `src/forensics/contractLlmVerdict.ts`
- Test: `tests/approvals/approvalEpisodeCaseFile.test.ts`
- Test: `tests/approvals/approvalEpisodeLlmClassifier.test.ts`

- [ ] **Step 0: Inspect existing approval and LLM types before adding files**

Run:

```bash
rg "interface .*Approval|type .*Approval|classify.*Approval|ContractLlmVerdict|requestJson|OpenAI-compatible|llm" src tests
```

Expected:

```text
Existing approval facts, safety recheck result shapes, and LLM adapter/cache entry points are visible.
```

Implementation rule:

```text
If an existing exported type already carries the same fields as ApprovalFact or ContractProfile, reuse it or create a narrow adapter in approvalEpisodeCaseFile.ts.
Do not make a second final risk model for approvals.
Task 6 creates an evidence producer: ApprovalEpisodeCaseFile -> ApprovalEpisodeLlmVerdict.
Final wallet/deposit decisions continue to flow through the existing report/scoring modules.
```

- [ ] **Step 1: Write failing case-file tests for sequential approvals**

Create `tests/approvals/approvalEpisodeCaseFile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildApprovalEpisodeCaseFile } from "../../src/approvals/approvalEpisodeCaseFile";
import type { ApprovalEpisodeInput } from "../../src/approvals/approvalEpisodeTypes";

const ownerAddress = "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe";
const bridgeSpender = "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s";
const unknownSpender = "TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5";

function baseInput(): ApprovalEpisodeInput {
  return {
    ownerAddress,
    checkedWallet: ownerAddress,
    primaryApprovalTxHash: "3e5bc9ad-primary-tnkg",
    approvals: [
      {
        evidenceId: "approval-bridge",
        txHash: "0e940f99-bridge",
        ownerAddress,
        spenderAddress: bridgeSpender,
        tokenAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        tokenSymbol: "USDT",
        allowanceRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
        isUnlimited: true,
        isActive: true,
        spenderType: "contract",
        timestampMs: Date.parse("2026-05-31T10:00:00.000Z")
      },
      {
        evidenceId: "approval-tnkg",
        txHash: "3e5bc9ad-primary-tnkg",
        ownerAddress,
        spenderAddress: unknownSpender,
        tokenAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        tokenSymbol: "USDT",
        allowanceRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
        isUnlimited: true,
        isActive: true,
        spenderType: "contract",
        timestampMs: Date.parse("2026-05-31T10:03:00.000Z")
      }
    ],
    contractProfiles: [
      {
        evidenceId: "contract-bridge",
        address: bridgeSpender,
        name: "Bridgers",
        tag: "Bridgers: Cross-chain Bridge",
        isVerified: true,
        serviceTags: ["bridge", "router"],
        methodSelectors: ["095ea7b3", "a9059cbb"],
        sourceCodeExcerpt: "contract BridgersRouter { function swap(...) external {} }"
      },
      {
        evidenceId: "contract-tnkg",
        address: unknownSpender,
        name: "tokenApprove",
        tag: null,
        isVerified: false,
        serviceTags: [],
        methodSelectors: ["095ea7b3"],
        sourceCodeExcerpt: null
      }
    ],
    timeline: [
      {
        evidenceId: "tx-bridge-approval",
        txHash: "0e940f99-bridge",
        timestampMs: Date.parse("2026-05-31T10:00:00.000Z"),
        type: "approval",
        from: ownerAddress,
        to: bridgeSpender,
        methodSelector: "095ea7b3",
        decodedMethod: "approve(address,uint256)"
      },
      {
        evidenceId: "tx-tnkg-approval",
        txHash: "3e5bc9ad-primary-tnkg",
        timestampMs: Date.parse("2026-05-31T10:03:00.000Z"),
        type: "approval",
        from: ownerAddress,
        to: unknownSpender,
        methodSelector: "095ea7b3",
        decodedMethod: "approve(address,uint256)"
      },
      {
        evidenceId: "tx-route-output",
        txHash: "route-output",
        timestampMs: Date.parse("2026-05-31T10:08:00.000Z"),
        type: "service_route",
        from: bridgeSpender,
        to: ownerAddress,
        amountRaw: "997500000",
        tokenSymbol: "USDT",
        methodSelector: "a9059cbb",
        decodedMethod: "transfer(address,uint256)"
      }
    ],
    transferFromEvidence: [],
    serviceRouteEvidence: [
      {
        evidenceId: "route-bridge",
        routeType: "bridge_router",
        serviceAddress: bridgeSpender,
        labels: ["Bridgers: Cross-chain Bridge"],
        economicOutput: true,
        outputTxHash: "route-output"
      }
    ]
  };
}

describe("buildApprovalEpisodeCaseFile", () => {
  it("keeps current approval primary and previous bridge approval as context", () => {
    const caseFile = buildApprovalEpisodeCaseFile(baseInput());

    expect(caseFile.currentApproval.spenderAddress).toBe(unknownSpender);
    expect(caseFile.previousApprovalsInSession).toHaveLength(1);
    expect(caseFile.previousApprovalsInSession[0]?.spenderAddress).toBe(bridgeSpender);
    expect(caseFile.nextApprovalsInSession).toHaveLength(0);
    expect(caseFile.serviceRouteEvidence[0]?.routeType).toBe("bridge_router");
    expect(caseFile.deterministicFindings.exactDrainProven).toBe(false);
    expect(caseFile.policyQuestion).toContain("Classify the current approval");
  });

  it("does not mark exact drain when there is no transferFrom evidence", () => {
    const caseFile = buildApprovalEpisodeCaseFile(baseInput());

    expect(caseFile.transferFromEvidence).toHaveLength(0);
    expect(caseFile.deterministicFindings.exactDrainProven).toBe(false);
    expect(caseFile.deterministicFindings.serviceRouteGuard).toBe(true);
  });
});
```

- [ ] **Step 2: Add approval episode types**

Create `src/approvals/approvalEpisodeTypes.ts`:

```ts
export type ApprovalEpisodeVerdict =
  | "legitimate_service_route"
  | "unknown_contract_inside_service_route"
  | "suspicious_standalone_approval"
  | "drainer_setup_like"
  | "exact_drain_proven"
  | "insufficient_data";

export type ApprovalSpenderType = "eoa" | "contract" | "known_service" | "unknown";

export interface ApprovalFact {
  evidenceId: string;
  txHash: string;
  ownerAddress: string;
  spenderAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  allowanceRaw: string;
  isUnlimited: boolean;
  isActive: boolean;
  spenderType: ApprovalSpenderType;
  timestampMs: number;
}

export interface ApprovalContractProfile {
  evidenceId: string;
  address: string;
  name: string | null;
  tag: string | null;
  isVerified: boolean;
  serviceTags: string[];
  methodSelectors: string[];
  sourceCodeExcerpt: string | null;
}

export interface ApprovalTimelineEvent {
  evidenceId: string;
  txHash: string;
  timestampMs: number;
  type: "approval" | "contract_call" | "transfer" | "transfer_from" | "service_route" | "dust_token";
  from: string;
  to: string;
  amountRaw?: string;
  tokenSymbol?: string;
  methodSelector?: string;
  decodedMethod?: string;
}

export interface ApprovalTransferFromEvidence {
  evidenceId: string;
  txHash: string;
  ownerAddress: string;
  spenderAddress: string;
  receiverAddress: string;
  amountRaw: string;
  reachesCheckedWalletWithinTwoHops: boolean;
  hasServiceBoundaryBeforeCheckedWallet: boolean;
}

export interface ApprovalServiceRouteEvidence {
  evidenceId: string;
  routeType: "bridge_router" | "dex_router" | "gasfree" | "known_service" | "unknown";
  serviceAddress: string;
  labels: string[];
  economicOutput: boolean;
  outputTxHash?: string;
}

export interface ApprovalEpisodeInput {
  ownerAddress: string;
  checkedWallet?: string;
  primaryApprovalTxHash: string;
  approvals: ApprovalFact[];
  contractProfiles: ApprovalContractProfile[];
  timeline: ApprovalTimelineEvent[];
  transferFromEvidence: ApprovalTransferFromEvidence[];
  serviceRouteEvidence: ApprovalServiceRouteEvidence[];
}

export interface ApprovalEpisodeCaseFile {
  schemaVersion: "approval_episode_v1";
  ownerAddress: string;
  checkedWallet?: string;
  currentApproval: ApprovalFact;
  previousApprovalsInSession: ApprovalFact[];
  nextApprovalsInSession: ApprovalFact[];
  contractProfiles: ApprovalContractProfile[];
  timeline: ApprovalTimelineEvent[];
  transferFromEvidence: ApprovalTransferFromEvidence[];
  serviceRouteEvidence: ApprovalServiceRouteEvidence[];
  deterministicFindings: {
    exactDrainProven: boolean;
    activeUnlimitedEoaApproval: boolean;
    activeUnlimitedUnknownContract: boolean;
    serviceRouteGuard: boolean;
    cleanEconomicOutput: boolean;
  };
  policyQuestion: string;
}

export interface ApprovalEpisodeLlmVerdict {
  episodeVerdict: ApprovalEpisodeVerdict;
  confidence: number;
  approvalSafetyRisk: number;
  drainProofRisk: number;
  decisionRecommendation: "ACCEPTABLE" | "DECLINE";
  currentApprovalVerdict: ApprovalEpisodeVerdict;
  previousApprovalContext: "supporting_service_route" | "separate_approval" | "mixed_context" | "none";
  reasons: string[];
  citedEvidenceIds: string[];
  falsePositiveNotes: string[];
}
```

- [ ] **Step 3: Implement case-file builder**

Create `src/approvals/approvalEpisodeCaseFile.ts`:

```ts
import type {
  ApprovalEpisodeCaseFile,
  ApprovalEpisodeInput,
  ApprovalFact
} from "./approvalEpisodeTypes";

const DEFAULT_SESSION_WINDOW_MS = 30 * 60 * 1000;
const EXTENDED_SERVICE_ROUTE_WINDOW_MS = 2 * 60 * 60 * 1000;

function normalizeAddress(value: string): string {
  return value.trim();
}

function isKnownServiceRouteTag(value: string): boolean {
  const text = value.toLowerCase();
  return text.includes("bridge") || text.includes("router") || text.includes("gasfree") || text.includes("dex");
}

function hasServiceRouteContext(input: ApprovalEpisodeInput): boolean {
  if (input.serviceRouteEvidence.some((item) => item.economicOutput)) return true;
  return input.contractProfiles.some((profile) =>
    profile.serviceTags.some(isKnownServiceRouteTag) || (profile.tag ? isKnownServiceRouteTag(profile.tag) : false)
  );
}

function sessionWindowMs(input: ApprovalEpisodeInput): number {
  return hasServiceRouteContext(input) ? EXTENDED_SERVICE_ROUTE_WINDOW_MS : DEFAULT_SESSION_WINDOW_MS;
}

function sortApprovals(approvals: ApprovalFact[]): ApprovalFact[] {
  return [...approvals].sort((a, b) => a.timestampMs - b.timestampMs || a.txHash.localeCompare(b.txHash));
}

export function buildApprovalEpisodeCaseFile(input: ApprovalEpisodeInput): ApprovalEpisodeCaseFile {
  const approvals = sortApprovals(input.approvals);
  const currentApproval = approvals.find((approval) => approval.txHash === input.primaryApprovalTxHash);

  if (!currentApproval) {
    throw new Error(`Primary approval tx ${input.primaryApprovalTxHash} is not present in approval episode input`);
  }

  const ownerAddress = normalizeAddress(input.ownerAddress);
  const windowMs = sessionWindowMs(input);
  const sessionApprovals = approvals.filter((approval) =>
    normalizeAddress(approval.ownerAddress) === ownerAddress &&
    Math.abs(approval.timestampMs - currentApproval.timestampMs) <= windowMs
  );

  const previousApprovalsInSession = sessionApprovals.filter((approval) => approval.timestampMs < currentApproval.timestampMs);
  const nextApprovalsInSession = sessionApprovals.filter((approval) => approval.timestampMs > currentApproval.timestampMs);

  const exactDrainProven = input.transferFromEvidence.some((evidence) =>
    normalizeAddress(evidence.ownerAddress) === ownerAddress &&
    normalizeAddress(evidence.spenderAddress) === normalizeAddress(currentApproval.spenderAddress) &&
    evidence.reachesCheckedWalletWithinTwoHops &&
    !evidence.hasServiceBoundaryBeforeCheckedWallet
  );

  const activeUnlimitedEoaApproval =
    currentApproval.isActive && currentApproval.isUnlimited && currentApproval.spenderType === "eoa";

  const activeUnlimitedUnknownContract =
    currentApproval.isActive &&
    currentApproval.isUnlimited &&
    currentApproval.spenderType === "contract" &&
    !input.serviceRouteEvidence.some((route) => normalizeAddress(route.serviceAddress) === normalizeAddress(currentApproval.spenderAddress));

  const cleanEconomicOutput = input.serviceRouteEvidence.some((route) => route.economicOutput);

  return {
    schemaVersion: "approval_episode_v1",
    ownerAddress,
    checkedWallet: input.checkedWallet,
    currentApproval,
    previousApprovalsInSession,
    nextApprovalsInSession,
    contractProfiles: input.contractProfiles,
    timeline: [...input.timeline].sort((a, b) => a.timestampMs - b.timestampMs || a.txHash.localeCompare(b.txHash)),
    transferFromEvidence: input.transferFromEvidence,
    serviceRouteEvidence: input.serviceRouteEvidence,
    deterministicFindings: {
      exactDrainProven,
      activeUnlimitedEoaApproval,
      activeUnlimitedUnknownContract,
      serviceRouteGuard: cleanEconomicOutput && !exactDrainProven,
      cleanEconomicOutput
    },
    policyQuestion:
      "Classify the current approval episode. Keep currentApproval separate from previousApprovalsInSession. Is this exact drain, normal service route, suspicious standalone approval, or insufficient data?"
  };
}
```

- [ ] **Step 4: Run case-file test**

Run:

```bash
npm test -- tests/approvals/approvalEpisodeCaseFile.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing LLM classifier tests**

Create `tests/approvals/approvalEpisodeLlmClassifier.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { classifyApprovalEpisodeWithLlm } from "../../src/approvals/approvalEpisodeLlmClassifier";
import type { ApprovalEpisodeCaseFile } from "../../src/approvals/approvalEpisodeTypes";

function caseFile(): ApprovalEpisodeCaseFile {
  return {
    schemaVersion: "approval_episode_v1",
    ownerAddress: "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe",
    checkedWallet: "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe",
    currentApproval: {
      evidenceId: "approval-tnkg",
      txHash: "3e5bc9ad-primary-tnkg",
      ownerAddress: "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe",
      spenderAddress: "TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5",
      tokenAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      tokenSymbol: "USDT",
      allowanceRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      isUnlimited: true,
      isActive: true,
      spenderType: "contract",
      timestampMs: Date.parse("2026-05-31T10:03:00.000Z")
    },
    previousApprovalsInSession: [],
    nextApprovalsInSession: [],
    contractProfiles: [],
    timeline: [],
    transferFromEvidence: [],
    serviceRouteEvidence: [],
    deterministicFindings: {
      exactDrainProven: false,
      activeUnlimitedEoaApproval: false,
      activeUnlimitedUnknownContract: true,
      serviceRouteGuard: false,
      cleanEconomicOutput: false
    },
    policyQuestion: "Classify the current approval episode."
  };
}

describe("classifyApprovalEpisodeWithLlm", () => {
  it("parses a strict valid JSON verdict", async () => {
    const completeJson = {
      episodeVerdict: "suspicious_standalone_approval",
      confidence: 0.82,
      approvalSafetyRisk: 62,
      drainProofRisk: 20,
      decisionRecommendation: "DECLINE",
      currentApprovalVerdict: "suspicious_standalone_approval",
      previousApprovalContext: "none",
      reasons: ["Active unlimited approval to weak-metadata contract; no service route evidence."],
      citedEvidenceIds: ["approval-tnkg"],
      falsePositiveNotes: ["No transferFrom evidence was provided, so exact drain is not proven."]
    };

    const client = vi.fn().mockResolvedValue({ ok: true, json: completeJson, latencyMs: 42 });
    const result = await classifyApprovalEpisodeWithLlm({ caseFile: caseFile(), requestJson: client });

    expect(result.status).toBe("available");
    expect(result.verdict?.episodeVerdict).toBe("suspicious_standalone_approval");
    expect(result.verdict?.drainProofRisk).toBe(20);
    expect(client).toHaveBeenCalledOnce();
  });

  it("rejects exact drain verdict when case file has no transferFrom evidence", async () => {
    const client = vi.fn().mockResolvedValue({
      ok: true,
      latencyMs: 10,
      json: {
        episodeVerdict: "exact_drain_proven",
        confidence: 0.91,
        approvalSafetyRisk: 95,
        drainProofRisk: 95,
        decisionRecommendation: "DECLINE",
        currentApprovalVerdict: "exact_drain_proven",
        previousApprovalContext: "none",
        reasons: ["Looks like a drain."],
        citedEvidenceIds: ["approval-tnkg"],
        falsePositiveNotes: []
      }
    });

    const result = await classifyApprovalEpisodeWithLlm({ caseFile: caseFile(), requestJson: client });

    expect(result.status).toBe("unavailable");
    expect(result.error).toContain("exact_drain_proven requires transferFrom evidence");
  });
});
```

- [ ] **Step 6: Implement LLM classifier wrapper**

Create `src/approvals/approvalEpisodeLlmClassifier.ts`:

```ts
import type {
  ApprovalEpisodeCaseFile,
  ApprovalEpisodeLlmVerdict,
  ApprovalEpisodeVerdict
} from "./approvalEpisodeTypes";

const EPISODE_VERDICTS: ReadonlySet<ApprovalEpisodeVerdict> = new Set([
  "legitimate_service_route",
  "unknown_contract_inside_service_route",
  "suspicious_standalone_approval",
  "drainer_setup_like",
  "exact_drain_proven",
  "insufficient_data"
]);

export interface ApprovalEpisodeLlmRequestJsonResult {
  ok: boolean;
  json?: unknown;
  latencyMs?: number;
  error?: string;
}

export interface ApprovalEpisodeLlmClassifierInput {
  caseFile: ApprovalEpisodeCaseFile;
  requestJson: (payload: { systemPrompt: string; userPrompt: string; caseFile: ApprovalEpisodeCaseFile }) => Promise<ApprovalEpisodeLlmRequestJsonResult>;
}

export type ApprovalEpisodeLlmClassifierResult =
  | { status: "available"; verdict: ApprovalEpisodeLlmVerdict; error?: undefined; latencyMs?: number }
  | { status: "unavailable"; verdict?: undefined; error: string; latencyMs?: number };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "string") ? value : null;
}

function boundedNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function verdictValue(value: unknown): ApprovalEpisodeVerdict | null {
  if (typeof value !== "string") return null;
  return EPISODE_VERDICTS.has(value as ApprovalEpisodeVerdict) ? (value as ApprovalEpisodeVerdict) : null;
}

function parseVerdict(value: unknown): ApprovalEpisodeLlmVerdict | null {
  if (!isObject(value)) return null;

  const episodeVerdict = verdictValue(value.episodeVerdict);
  const currentApprovalVerdict = verdictValue(value.currentApprovalVerdict);
  const confidence = boundedNumber(value.confidence, 0, 1);
  const approvalSafetyRisk = boundedNumber(value.approvalSafetyRisk, 0, 100);
  const drainProofRisk = boundedNumber(value.drainProofRisk, 0, 100);
  const decisionRecommendation =
    value.decisionRecommendation === "ACCEPTABLE" || value.decisionRecommendation === "DECLINE"
      ? value.decisionRecommendation
      : null;
  const previousApprovalContext =
    value.previousApprovalContext === "supporting_service_route" ||
    value.previousApprovalContext === "separate_approval" ||
    value.previousApprovalContext === "mixed_context" ||
    value.previousApprovalContext === "none"
      ? value.previousApprovalContext
      : null;
  const reasons = stringArray(value.reasons);
  const citedEvidenceIds = stringArray(value.citedEvidenceIds);
  const falsePositiveNotes = stringArray(value.falsePositiveNotes);

  if (
    !episodeVerdict ||
    confidence === null ||
    approvalSafetyRisk === null ||
    drainProofRisk === null ||
    !decisionRecommendation ||
    !currentApprovalVerdict ||
    !previousApprovalContext ||
    !reasons ||
    !citedEvidenceIds ||
    !falsePositiveNotes
  ) {
    return null;
  }

  return {
    episodeVerdict,
    confidence,
    approvalSafetyRisk,
    drainProofRisk,
    decisionRecommendation,
    currentApprovalVerdict,
    previousApprovalContext,
    reasons,
    citedEvidenceIds,
    falsePositiveNotes
  };
}

function validateAgainstFacts(caseFile: ApprovalEpisodeCaseFile, verdict: ApprovalEpisodeLlmVerdict): string | null {
  const noTransferFrom = caseFile.transferFromEvidence.length === 0;
  if ((verdict.episodeVerdict === "exact_drain_proven" || verdict.currentApprovalVerdict === "exact_drain_proven") && noTransferFrom) {
    return "exact_drain_proven requires transferFrom evidence in the approval episode case file";
  }
  if (verdict.drainProofRisk >= 90 && noTransferFrom && !caseFile.deterministicFindings.exactDrainProven) {
    return "drainProofRisk >= 90 requires deterministic drain evidence or transferFrom evidence";
  }
  return null;
}

export async function classifyApprovalEpisodeWithLlm(
  input: ApprovalEpisodeLlmClassifierInput
): Promise<ApprovalEpisodeLlmClassifierResult> {
  const systemPrompt =
    "You classify TRON USDT approval episodes. Return strict JSON only. Do not invent blockchain facts. Exact drain requires transferFrom evidence in the case file.";
  const userPrompt =
    "Classify currentApproval separately from previousApprovalsInSession. Decide if this is a legitimate service route, unknown contract inside service route, suspicious standalone approval, drainer setup-like, exact drain proven, or insufficient data.";

  const response = await input.requestJson({ systemPrompt, userPrompt, caseFile: input.caseFile });
  if (!response.ok) {
    return { status: "unavailable", error: response.error ?? "LLM request failed", latencyMs: response.latencyMs };
  }

  const verdict = parseVerdict(response.json);
  if (!verdict) {
    return { status: "unavailable", error: "LLM returned invalid approval episode JSON", latencyMs: response.latencyMs };
  }

  const factError = validateAgainstFacts(input.caseFile, verdict);
  if (factError) {
    return { status: "unavailable", error: factError, latencyMs: response.latencyMs };
  }

  return { status: "available", verdict, latencyMs: response.latencyMs };
}
```

- [ ] **Step 7: Run LLM classifier tests**

Run:

```bash
npm test -- tests/approvals/approvalEpisodeLlmClassifier.test.ts
```

Expected: PASS.

- [ ] **Step 8: Wire episode classifier into approval recheck without changing exact-drain priority**

In `src/approvals/safetyRecheck.ts`, find the point where active approval risk is converted into report rows. Add an adapter function close to the existing approval-risk builder so the LLM layer does not own final scoring:

```ts
async function attachApprovalEpisodeVerdict(input: {
  approvalRisk: ApprovalSafetyRisk;
  ownerAddress: string;
  checkedWallet?: string;
  approval: ApprovalFact;
  episodeApprovals: ApprovalFact[];
  episodeContractProfiles: ApprovalContractProfile[];
  episodeTimeline: ApprovalTimelineEvent[];
  episodeTransferFromEvidence: ApprovalTransferFromEvidence[];
  episodeServiceRouteEvidence: ApprovalServiceRouteEvidence[];
  llmContractAnalysisEnabled: boolean;
  approvalEpisodeLlmRequestJson: ApprovalEpisodeLlmClassifierInput["requestJson"];
}): Promise<ApprovalSafetyRisk> {
  if (input.approvalRisk.exactDrainProven) return input.approvalRisk;
  if (!input.llmContractAnalysisEnabled) return input.approvalRisk;

  const episodeCaseFile = buildApprovalEpisodeCaseFile({
    ownerAddress: input.ownerAddress,
    checkedWallet: input.checkedWallet,
    primaryApprovalTxHash: input.approval.txHash,
    approvals: input.episodeApprovals,
    contractProfiles: input.episodeContractProfiles,
    timeline: input.episodeTimeline,
    transferFromEvidence: input.episodeTransferFromEvidence,
    serviceRouteEvidence: input.episodeServiceRouteEvidence
  });

  const episodeVerdict = await classifyApprovalEpisodeWithLlm({
    caseFile: episodeCaseFile,
    requestJson: input.approvalEpisodeLlmRequestJson
  });

  if (episodeVerdict.status === "available") {
    input.approvalRisk.llmEpisodeVerdict = episodeVerdict.verdict;
    input.approvalRisk.approvalSafetyRisk = Math.max(input.approvalRisk.approvalSafetyRisk, episodeVerdict.verdict.approvalSafetyRisk);
    input.approvalRisk.drainProofRisk = Math.max(input.approvalRisk.drainProofRisk, episodeVerdict.verdict.drainProofRisk);

    if (
      episodeVerdict.verdict.currentApprovalVerdict === "legitimate_service_route" &&
      episodeVerdict.verdict.confidence >= 0.8 &&
      !input.approvalRisk.exactDrainProven
    ) {
      input.approvalRisk.approvalSafetyRisk = Math.min(input.approvalRisk.approvalSafetyRisk, 35);
      input.approvalRisk.falsePositiveGuards.push("LLM classified the current approval as a legitimate service route on complete episode facts.");
    }
  }

  return input.approvalRisk;
}
```

If local project type names differ from the plan names, keep the behavior and adapt imports through narrow mapping functions in `safetyRecheck.ts`. The important behavior is:

```text
exact drain proof first
episode LLM second
legitimate service can lower unknown-contract approval risk
LLM cannot invent exact drain without transferFrom evidence
```

- [ ] **Step 9: Persist episode verdict summaries**

In `src/approvals/approvalWorker.ts`, when writing approval safety recheck results, add a compact summary field to the existing result JSON:

```ts
approvalEpisodeVerdict: approvalRisk.llmEpisodeVerdict
  ? {
      episodeVerdict: approvalRisk.llmEpisodeVerdict.episodeVerdict,
      currentApprovalVerdict: approvalRisk.llmEpisodeVerdict.currentApprovalVerdict,
      confidence: approvalRisk.llmEpisodeVerdict.confidence,
      approvalSafetyRisk: approvalRisk.llmEpisodeVerdict.approvalSafetyRisk,
      drainProofRisk: approvalRisk.llmEpisodeVerdict.drainProofRisk,
      reasons: approvalRisk.llmEpisodeVerdict.reasons.slice(0, 3),
      falsePositiveNotes: approvalRisk.llmEpisodeVerdict.falsePositiveNotes.slice(0, 3)
    }
  : null
```

Keep full case files in LLM cache or logs only; do not bloat user-facing Telegram messages.

- [ ] **Step 10: Add TLh/TNKG regression**

In `tests/approvals/approvalEpisodeCaseFile.test.ts`, add:

```ts
it("classifies TNKG separately even when TPwez bridge approval is nearby", () => {
  const caseFile = buildApprovalEpisodeCaseFile(baseInput());

  expect(caseFile.currentApproval.txHash).toBe("3e5bc9ad-primary-tnkg");
  expect(caseFile.currentApproval.spenderAddress).toBe("TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5");
  expect(caseFile.previousApprovalsInSession.map((item) => item.spenderAddress)).toEqual([
    "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s"
  ]);
});
```

In `tests/approvals/approvalEpisodeLlmClassifier.test.ts`, add:

```ts
it("allows legitimate service verdict to be represented without drain proof", async () => {
  const serviceCase = caseFile();
  serviceCase.serviceRouteEvidence = [{
    evidenceId: "route-bridge",
    routeType: "bridge_router",
    serviceAddress: serviceCase.currentApproval.spenderAddress,
    labels: ["GasFree/router-like service"],
    economicOutput: true,
    outputTxHash: "route-output"
  }];
  serviceCase.deterministicFindings.serviceRouteGuard = true;
  serviceCase.deterministicFindings.cleanEconomicOutput = true;

  const client = vi.fn().mockResolvedValue({
    ok: true,
    latencyMs: 11,
    json: {
      episodeVerdict: "legitimate_service_route",
      confidence: 0.9,
      approvalSafetyRisk: 20,
      drainProofRisk: 0,
      decisionRecommendation: "ACCEPTABLE",
      currentApprovalVerdict: "legitimate_service_route",
      previousApprovalContext: "supporting_service_route",
      reasons: ["Known service-route evidence with economic output and no transferFrom drain evidence."],
      citedEvidenceIds: ["route-bridge"],
      falsePositiveNotes: ["Unlimited approvals are common in bridge/router flows."]
    }
  });

  const result = await classifyApprovalEpisodeWithLlm({ caseFile: serviceCase, requestJson: client });

  expect(result.status).toBe("available");
  expect(result.verdict?.approvalSafetyRisk).toBe(20);
  expect(result.verdict?.drainProofRisk).toBe(0);
});
```

- [ ] **Step 11: Run approval tests and full safety tests**

Run:

```bash
npm test -- tests/approvals/approvalEpisodeCaseFile.test.ts tests/approvals/approvalEpisodeLlmClassifier.test.ts
npm test -- tests/approvals
npm run typecheck
```

Expected: PASS.

- [ ] **Step 12: Commit Task 6**

```bash
git add src/approvals/approvalEpisodeTypes.ts src/approvals/approvalEpisodeCaseFile.ts src/approvals/approvalEpisodeLlmClassifier.ts src/approvals/safetyRecheck.ts src/approvals/approvalWorker.ts src/forensics/contractLlmVerdict.ts tests/approvals/approvalEpisodeCaseFile.test.ts tests/approvals/approvalEpisodeLlmClassifier.test.ts
git commit -m "feat: classify approval episodes with llm case files"
```

---

## Task 7: Cross-Mode Integration Smoke

**Files:**
- No required source changes.
- Modify only if smoke reveals a regression in shared evidence wiring.

- [ ] **Step 1: Run full static and unit verification**

Run:

```bash
npm run typecheck
npm test
```

Expected:

```text
typecheck PASS
all Vitest suites PASS
```

- [ ] **Step 2: Smoke weighted HTX/Huobi case**

Run:

```bash
npm run forensic:where-is-money -- -- --source TVzGYWyg89wUmwhvbcwfonHVLDYYQAiZMF --depth 20 --beam 8 --max-addresses 60 --max-edges 40 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 15000
```

Expected:

```text
HTX/Huobi exposure is shown as weighted policy exposure.
About 15% HTX/Huobi exposure does not become fixed 78/100 hard bad evidence by itself.
Report does not say scam/drain/blacklist proof unless a separate hard signal appears.
```

- [ ] **Step 3: Smoke approval episode case**

Run the existing approval safety check or bot command for:

```text
TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe
```

Expected:

```text
TPwez...Et5s remains legitimate_service / service-route guarded when facts match bridge/router/GasFree context.
TNKG...pxQ5 is evaluated as its own current approval, with TPwez as previous context only.
TJpMj... remains separate from active approval rows unless exact transferFrom evidence links it.
No report says exact drain for TNKG without transferFrom evidence.
```

- [ ] **Step 4: Smoke cross-chain service boundary case**

Run:

```bash
npm run forensic:where-is-money -- -- --source TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb --depth 20 --beam 8 --max-addresses 60 --max-edges 40 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 15000
```

Expected:

```text
LayerZero/OFT-like context is explained as bridge/cross-chain policy risk, not drainer proof.
LLM legitimate_service verdict for bridge/OFT contracts is preserved in the report.
Bridge policy can still DECLINE if policy requires it.
```

- [ ] **Step 5: Smoke operational wallet controls**

Run:

```bash
npm run forensic:where-is-money -- -- --source TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM --depth 20 --beam 8 --max-addresses 60 --max-edges 40 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 15000
npm run forensic:where-is-money -- -- --source TTs9xCEZ43niXvfKTu7LcF7Kcud3Bbw7FD --depth 20 --beam 8 --max-addresses 60 --max-edges 40 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 15000
```

Expected:

```text
Operational wallets with no hard bad evidence remain LOW-MEDIUM/ACCEPTABLE unless live data adds a new hard signal.
Unknown/unproven source wording stays honest and does not become "Hard bad evidence".
```

- [ ] **Step 6: Commit final integration fixes if needed**

If Task 7 required code changes:

```bash
git add src tests
git commit -m "fix: align money origin and approval episode evidence"
```

If no code changes were needed:

```bash
git status --short
```

Expected:

```text
No uncommitted source changes from smoke verification.
```

---

## Risks And Edge Cases

- **Risk:** lowering HTX/Huobi may allow risky minority exposure to pass.
  - Mitigation: exact taint, approval drain, blacklist, and high aggregate HTX/Huobi still hard decline.

- **Risk:** path share can understate exposure when many small HTX paths exist.
  - Mitigation: aggregate HTX/Huobi share across all selected provenance paths.

- **Risk:** young high-turnover wallets could be over-dampened by operational-liquidity score.
  - Mitigation: age adjustment remains active; tests should include young wallet cases if existing helpers support it.

- **Risk:** direct HTX-to-wallet deposits might be softened too much.
  - Mitigation: direct/majority HTX tests must remain high. If needed in implementation, add a proximity helper using `path.txHashes.length <= 1` to add +10 score.

- **Risk:** approval episode LLM may mix two unrelated approvals and overstate risk.
  - Mitigation: every LLM verdict has `currentApprovalVerdict`; previous approvals are context only unless exact transferFrom evidence links them.

- **Risk:** LLM may call a contract exact drain because source code looks suspicious.
  - Mitigation: classifier rejects `exact_drain_proven` and `drainProofRisk >= 90` unless deterministic transferFrom evidence exists in the case file.

- **Risk:** legitimate service route could hide a real drain.
  - Mitigation: deterministic exact drain proof and active unlimited EOA approval stay higher priority than LLM service-route verdicts.

---

## Self-Review Checklist

- [ ] Spec covers the original problem: 15% HTX exposure should not automatically become fixed `78 HIGH`.
- [ ] Exact scam/approval-drain/blacklist behavior remains unchanged.
- [ ] HTX/Huobi share is included in reason text.
- [ ] HTX/Huobi aggregate exposure is supported.
- [ ] Operational-liquidity dampening can apply to minority HTX/Huobi exposure.
- [ ] High-share HTX/Huobi remains `DECLINE`.
- [ ] Tests cover low, medium, and high HTX/Huobi share tiers.
- [ ] Live smoke includes `TVzGY...iZMF`.
- [ ] Approval episode task keeps current approval separate from previous approval context.
- [ ] Approval episode LLM cannot create exact-drain proof without transferFrom facts.
- [ ] Legitimate service route verdict can lower unknown-contract approval risk when no hard bad evidence exists.
- [ ] Incoming deposit, low-balance recent-flow, and where-is-money use shared evidence semantics instead of isolated scoring copies.
- [ ] Final integration smoke covers weighted exchange policy, approval episode LLM, bridge/OFT policy wording, and operational wallet controls.
