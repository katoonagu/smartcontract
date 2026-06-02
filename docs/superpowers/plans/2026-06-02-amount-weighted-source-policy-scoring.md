# Amount-Weighted Source Policy Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bridge/router/DEX/cross-chain/unknown source-policy risk proportional to the amount share across incoming deposit, where-is-money, and deep research flows.

**Architecture:** Add one shared amount-weighted source-policy scorer in `src/forensics/provenanceScoring.ts`, enrich typed source-policy evidence with amount/share details, and route all where/incoming/deep/cross-chain source-policy scoring through the same caps. Hard proof remains isolated and can still dominate final decisions.

**Tech Stack:** TypeScript, Vitest, existing TRON USDT forensics modules, existing `RiskLayerScore` / `SourcePolicyEvidence` types.

---

## Execution Base

Run implementation from a clean branch based on the project master branch.

The current workspace may contain unrelated uncommitted files. Do not overwrite them. Before coding, either commit/stash unrelated local work or use a clean worktree.

```bash
git fetch origin
git switch master
git pull --ff-only origin master
git switch -c codex/amount-weighted-source-policy
```

If `master` already contains the spec commit, continue. If it does not, cherry-pick the spec commit:

```bash
git cherry-pick 7d6a808
```

## File Map

Modify:

- `src/types.ts` - add `SourcePolicyScope` and `SourcePolicyShareDetail`; enrich `SourcePolicyEvidence` and `RiskLayerScore`.
- `src/forensics/provenanceScoring.ts` - add source severity, share cap helpers, amount-weighted grouped scorer, duplicate-path amount allocation.
- `src/forensics/moneyOriginPolicy.ts` - remove fixed `78` for generic bridge/router/DEX stop classification and use share-aware scoring.
- `src/forensics/moneyOriginOperationalAssessment.ts` - pass target amount/scope into source-policy scoring and avoid source-policy floors for minority dampenable exposure.
- `src/check/whereIsMoneyCheck.ts` - ensure coverage scope and target amount flow into operational assessment.
- `src/forensics/incomingDepositJob.ts` - preserve deposit amount as denominator and surface amount-weighted layer details in incoming deposit reports.
- `src/forensics/crossChainEvidence.ts` - make terminal bridge/router scoring use the same share caps.
- `src/forensics/deepForensicJob.ts` - pass selected/recent/30-day denominator into deep-origin scoring when deep produces where-style source-policy layers.
- `src/alerts/formatters.ts` - show deposit risk as colored risk icon plus `score/100 (band)` in incoming deposit alerts.
- `src/admin/forensicsGraph.ts` - project source-policy share details into graph weights/nodes.
- `src/admin/adminConsole.ts` - display affected amount, target amount, share, cap, and final contribution.

Test:

- `tests/forensics/provenanceScoring.test.ts`
- `tests/forensics/moneyOriginPolicy.test.ts`
- `tests/forensics/moneyOriginOperationalAssessment.test.ts`
- `tests/forensics/crossChainEvidence.test.ts`
- `tests/forensics/incomingDepositJob.test.ts`
- `tests/forensics/deepForensicJob.test.ts`
- `tests/alerts/formatters.test.ts`
- `tests/admin/forensicsGraph.test.ts`

---

### Task 1: Add Typed Amount-Weighted Source-Policy Details

**Files:**
- Modify: `src/types.ts`
- Test: `tests/forensics/provenanceScoring.test.ts`

- [ ] **Step 1: Add a failing type-level usage test**

Append this test to `tests/forensics/provenanceScoring.test.ts` inside the `describe("provenanceScoring", ...)` block:

```ts
it("emits amount-weighted source-policy share details", () => {
  const result = scoreSourceExposures({
    scope: "incoming_deposit",
    targetAmountRaw: "46000000000",
    originPaths: [
      path({
        balanceShare: 4060 / 46000,
        exposureSourceKey: "bridge_router_dex",
        exposureSourceLabel: "Bridge",
        sourceExposureKind: "bridge_router_dex",
        reasons: ["Bridge boundary."]
      })
    ],
    walletRole: "unknown_wallet",
    operationalLiquidityScore: 0,
    cleanCexCoverage: 0,
    coverageCompleteness: 0.9,
    provenanceConfidence: 0.8,
    ageSignals: noAgeSignals
  });

  expect(result.sourcePolicyEvidence[0]?.shareDetail).toMatchObject({
    scope: "incoming_deposit",
    targetAmountRaw: "46000000000",
    affectedAmountRaw: "4060000000",
    rawShare: expect.closeTo(0.0882608, 6),
    sourceSeverity: 65,
    shareCap: 30
  });
  expect(result.riskLayers[0]?.shareDetail?.finalContribution).toBeLessThanOrEqual(30);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- tests/forensics/provenanceScoring.test.ts
```

Expected: fail because `scope`, `targetAmountRaw`, and `shareDetail` are not typed/emitted.

- [ ] **Step 3: Add types**

In `src/types.ts`, after `SourceExposureKind`, add:

```ts
export type SourcePolicyScope =
  | "incoming_deposit"
  | "where_selected_amount"
  | "where_drain_episode"
  | "balance_forming_target"
  | "deep_recent_flow"
  | "deep_30d_volume";

export type SourcePolicyShareDetail = {
  scope: SourcePolicyScope;
  targetAmountRaw: string;
  affectedAmountRaw: string;
  rawShare: number;
  effectiveShare: number;
  sourceSeverity: number;
  valueWeightedRaw: number;
  pathContextAdjustment: number;
  repeatedExposureAdjustment: number;
  dataQualityAdjustment: number;
  walletRoleAdjustment: number;
  shareFloor: number;
  shareCap: number;
  finalContribution: number;
};
```

In `RiskLayerScore`, add:

```ts
  shareDetail?: SourcePolicyShareDetail;
```

In `SourcePolicyEvidence`, add:

```ts
  shareDetail?: SourcePolicyShareDetail;
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck -- --pretty false
```

Expected: fail because `scoreSourceExposures` does not accept the new input fields yet.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/forensics/provenanceScoring.test.ts
git commit -m "test: require source-policy share details"
```

---

### Task 2: Implement Shared Source Severity and Share Caps

**Files:**
- Modify: `src/forensics/provenanceScoring.ts`
- Test: `tests/forensics/provenanceScoring.test.ts`

- [ ] **Step 1: Replace share-curve expectations**

Update the first test in `tests/forensics/provenanceScoring.test.ts` so bridge and unknown curves match the new spec:

```ts
expect(baseShareScore("bridge_router_dex", 40 / 46000)).toBeLessThanOrEqual(10);
expect(baseShareScore("bridge_router_dex", 4060 / 46000)).toBeLessThanOrEqual(30);
expect(baseShareScore("bridge_router_dex", 0.65)).toBeGreaterThanOrEqual(60);
expect(baseShareScore("bridge_router_dex", 0.65)).toBeLessThanOrEqual(70);
expect(baseShareScore("unknown_contract", 4060 / 46000)).toBeLessThanOrEqual(25);
expect(baseShareScore("unknown_cex", 0.15)).toBeLessThanOrEqual(35);
```

Remove or update the old expectations:

```ts
expect(baseShareScore("bridge_router_dex", 0.25)).toBe(62);
expect(baseShareScore("unknown_contract", 0.25)).toBe(45);
expect(baseShareScore("unknown_cex", 0.01)).toBe(40);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- tests/forensics/provenanceScoring.test.ts
```

Expected: fail because the old bridge curve still returns high values for any positive share.

- [ ] **Step 3: Add helper functions**

In `src/forensics/provenanceScoring.ts`, import the new types:

```ts
  SourcePolicyScope,
  SourcePolicyShareDetail,
```

Add these helpers near `baseShareScore`:

```ts
function shareBandCap(kind: SourceExposureKind, share: number): number {
  const s = finiteShare(share);

  if (kind === "bridge_router_dex" || kind === "cross_chain_boundary") {
    if (s <= 0) return 0;
    if (s < 0.01) return 10;
    if (s < 0.05) return 20;
    if (s < 0.1) return 30;
    if (s < 0.2) return 45;
    if (s < 0.5) return 59;
    if (s < 0.8) return 70;
    return 78;
  }

  if (kind === "unknown_contract") {
    if (s <= 0) return 0;
    if (s < 0.05) return 15;
    if (s < 0.1) return 25;
    if (s < 0.2) return 35;
    if (s < 0.5) return 45;
    return 55;
  }

  if (kind === "unknown_cex") {
    if (s <= 0) return 0;
    if (s < 0.2) return 35;
    if (s < 0.5) return 45;
    return 50;
  }

  if (kind === "whitebit") {
    if (s <= 0) return 0;
    if (s < 0.05) return 30;
    if (s < 0.1) return 38;
    if (s < 0.3) return 50;
    if (s < 0.5) return 55;
    return 60;
  }

  if (kind === "htx_huobi") {
    if (s <= 0) return 0;
    if (s < 0.05) return 30;
    if (s < 0.1) return 45;
    if (s < 0.2) return 55;
    if (s < 0.3) return 68;
    if (s < 0.5) return 75;
    if (s < 0.8) return 82;
    return 85;
  }

  if (kind === "mixer") return s > 0 ? 95 : 0;
  if (kind === "no_name_token_liquidity") return s > 0 ? 88 : 0;
  if (kind === "sanctioned_service") return s > 0 ? 100 : 0;
  if (kind === "allowlisted_cex") return 5;
  if (kind === "risky_label") return 90;
  return 0;
}

function sourceSeverity(kind: SourceExposureKind): number {
  switch (kind) {
    case "bridge_router_dex":
    case "cross_chain_boundary":
      return 65;
    case "unknown_contract":
      return 50;
    case "unknown_cex":
      return 45;
    case "whitebit":
      return 60;
    case "htx_huobi":
      return 80;
    case "mixer":
      return 92;
    case "no_name_token_liquidity":
      return 88;
    case "sanctioned_service":
      return 98;
    case "allowlisted_cex":
      return 5;
    case "risky_label":
      return 90;
  }
}

function shareFloorForKind(kind: SourceExposureKind, aggregateShare: number, bestContinuity: number): number {
  if (kind === "sanctioned_service") return aggregateShare > 0 ? 95 : 0;
  if (kind === "mixer") return aggregateShare > 0 ? 78 : 0;
  if (kind === "no_name_token_liquidity") return aggregateShare > 0 ? 70 : 0;
  if ((kind === "bridge_router_dex" || kind === "cross_chain_boundary") && aggregateShare >= 0.5 && bestContinuity >= 0.7) {
    return 60;
  }
  return 0;
}
```

Replace `baseShareScore` with:

```ts
export function baseShareScore(kind: SourceExposureKind, share: number): number {
  const cap = shareBandCap(kind, share);
  if (cap <= 0) return 0;
  const weighted = sourceSeverity(kind) * finiteShare(share);
  const floor = shareFloorForKind(kind, finiteShare(share), 1);
  return clamp(Math.max(floor, Math.min(cap, weighted)));
}
```

- [ ] **Step 4: Run the scorer tests**

Run:

```bash
npm test -- tests/forensics/provenanceScoring.test.ts
```

Expected: failing tests now identify the missing `shareDetail` emission and any old HTX/WhiteBIT assumptions that need caps aligned with the spec.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/provenanceScoring.ts tests/forensics/provenanceScoring.test.ts
git commit -m "feat: add source-policy share caps"
```

---

### Task 3: Make `scoreSourceExposures` Target-Aware

**Files:**
- Modify: `src/forensics/provenanceScoring.ts`
- Test: `tests/forensics/provenanceScoring.test.ts`

- [ ] **Step 1: Add duplicate-path allocation test**

Append:

```ts
it("counts duplicate source-policy tx amount once per kind", () => {
  const duplicateA = path({
    balanceShare: 0.06,
    txHashes: ["tx-shared"],
    exposureSourceKey: "bridge_router_dex",
    sourceExposureKind: "bridge_router_dex"
  });
  const duplicateB = path({
    balanceShare: 0.06,
    txHashes: ["tx-shared"],
    pathAddresses: [source, "TOtherHop111111111111111111111111", subject],
    exposureSourceKey: "bridge_router_dex",
    sourceExposureKind: "bridge_router_dex"
  });

  const result = scoreSourceExposures({
    scope: "incoming_deposit",
    targetAmountRaw: "46000000000",
    originPaths: [duplicateA, duplicateB],
    walletRole: "unknown_wallet",
    operationalLiquidityScore: 0,
    cleanCexCoverage: 0,
    coverageCompleteness: 0.9,
    provenanceConfidence: 0.8,
    ageSignals: noAgeSignals
  });

  expect(result.sourcePolicyEvidence[0]?.aggregateShare).toBeCloseTo(0.06, 6);
  expect(result.sourcePolicyEvidence[0]?.shareDetail?.affectedAmountRaw).toBe("2760000000");
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm test -- tests/forensics/provenanceScoring.test.ts
```

Expected: fail because duplicate path shares are currently summed.

- [ ] **Step 3: Extend input type**

In `src/forensics/provenanceScoring.ts`, update `ScoreSourceExposuresInput`:

```ts
export type ScoreSourceExposuresInput = {
  scope?: SourcePolicyScope;
  targetAmountRaw?: string;
  originPaths: MoneyOriginPath[];
  walletRole: WhereIsMoneyWalletRole;
  operationalLiquidityScore: number;
  cleanCexCoverage: number;
  coverageCompleteness: number;
  provenanceConfidence: number;
  ageSignals: WhereIsMoneyAgeSignals | null;
};
```

Add raw amount helpers near `parseAmountRaw`:

```ts
function multiplyRawByShare(raw: string, share: number): string {
  const amount = parseAmountRaw(raw);
  if (amount === null || amount <= 0n) return "0";
  const scaled = Math.round(clampRatio(share) * 1_000_000);
  return ((amount * BigInt(scaled)) / 1_000_000n).toString();
}

function dedupeKeyForPath(kind: SourceExposureKind, path: MoneyOriginPath): string {
  const txKey = path.txHashes.length > 0 ? path.txHashes.slice().sort().join("|") : path.balanceTransferTxHash;
  return `${kind}:${txKey}:${path.rootSourceAddress ?? "unknown"}`;
}
```

- [ ] **Step 4: Build share detail in grouped scorer**

Inside `scoreSourceExposures`, before calculating `aggregateShare`, dedupe enriched paths:

```ts
const uniqueByKey = new Map<string, typeof enriched[number]>();
for (const item of enriched) {
  const key = dedupeKeyForPath(kind, item.path);
  const existing = uniqueByKey.get(key);
  if (!existing || item.share > existing.share) {
    uniqueByKey.set(key, item);
  }
}
const unique = [...uniqueByKey.values()];
const aggregateShare = Math.min(1, unique.reduce((sum, item) => sum + item.share, 0));
const effectiveShare = Math.min(1, unique.reduce((sum, item) => sum + item.effectiveShare, 0));
```

Use `unique` instead of `enriched` for `bestContinuity`, evidence ids, and top path selection.

After computing adjustments, replace the raw score calculation with explicit components:

```ts
const severity = sourceSeverity(kind);
const cap = shareBandCap(kind, aggregateShare);
const floor = shareFloorForKind(kind, aggregateShare, bestContinuity);
const valueWeightedRaw = severity * curveShare;
const pathContext = best?.pathContext ?? 0;
const repeated = repeatedExposureAdjustment(unique.length);
const dataQuality = dataQualityAdjustment(input.coverageCompleteness, input.provenanceConfidence);
const roleAdjustment = sourceWalletRoleAdjustment(kind, input.walletRole, input.operationalLiquidityScore, input.cleanCexCoverage);
const rawScore = valueWeightedRaw + pathContext + repeated + dataQuality + ageAdjustment(input.ageSignals) + roleAdjustment;
const adjustedScore = clamp(Math.max(floor, Math.min(cap, capSourceScore({
  kind,
  score: rawScore,
  aggregateShare,
  bestContinuity,
  hasDirectFastRiskyPath,
  pathCount: unique.length
}))));
```

Create share detail:

```ts
const shareDetail: SourcePolicyShareDetail | undefined = input.scope && input.targetAmountRaw
  ? {
      scope: input.scope,
      targetAmountRaw: input.targetAmountRaw,
      affectedAmountRaw: multiplyRawByShare(input.targetAmountRaw, aggregateShare),
      rawShare: aggregateShare,
      effectiveShare,
      sourceSeverity: severity,
      valueWeightedRaw,
      pathContextAdjustment: pathContext,
      repeatedExposureAdjustment: repeated,
      dataQualityAdjustment: dataQuality,
      walletRoleAdjustment: roleAdjustment,
      shareFloor: floor,
      shareCap: cap,
      finalContribution: adjustedScore
    }
  : undefined;
```

Attach `shareDetail` to both `SourcePolicyEvidence` and `RiskLayerScore`.

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- tests/forensics/provenanceScoring.test.ts
npm run typecheck -- --pretty false
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/forensics/provenanceScoring.ts tests/forensics/provenanceScoring.test.ts src/types.ts
git commit -m "feat: score source policy by amount share"
```

---

### Task 4: Remove Fixed Bridge/Router/DEX Stop Score

**Files:**
- Modify: `src/forensics/moneyOriginPolicy.ts`
- Test: `tests/forensics/moneyOriginPolicy.test.ts`

- [ ] **Step 1: Add bridge minority policy test**

In `tests/forensics/moneyOriginPolicy.test.ts`, add:

```ts
it("reviews minority bridge/router/DEX exposure with share-weighted score", () => {
  const result = classifyMoneyOriginStop({
    address,
    labels: [],
    classification: service("bridge", "Bridge"),
    balanceShare: 4060 / 46000
  });

  expect(result).toMatchObject({
    verdict: "REVIEW",
    rootSourceType: "decline_boundary",
    stoppedReason: "decline_boundary_reached",
    exposureSourceKey: "bridge_router_dex",
    sourceExposureKind: "bridge_router_dex"
  });
  expect(result?.riskScoreContribution).toBeLessThanOrEqual(30);
  expect(result?.reasons.join(" ")).toContain("8.8%");
});

it("allows majority bridge/router/DEX exposure to become source-policy decline", () => {
  const result = classifyMoneyOriginStop({
    address,
    labels: [],
    classification: service("bridge", "Bridge"),
    balanceShare: 0.65
  });

  expect(result?.verdict).toBe("DECLINE");
  expect(result?.riskScoreContribution).toBeGreaterThanOrEqual(60);
  expect(result?.riskScoreContribution).toBeLessThanOrEqual(70);
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm test -- tests/forensics/moneyOriginPolicy.test.ts
```

Expected: fail because bridge/router/DEX still returns fixed `78` and `DECLINE`.

- [ ] **Step 3: Update stop classification**

In `src/forensics/moneyOriginPolicy.ts`, replace the `DECLINE_BOUNDARY_CATEGORIES` branch with:

```ts
  if (DECLINE_BOUNDARY_CATEGORIES.has(classification.category)) {
    const score = baseShareScore("bridge_router_dex", input.balanceShare);
    return {
      verdict: sourcePolicyDecision(input.balanceShare),
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: score,
      exposureSourceKey: "bridge_router_dex",
      exposureSourceLabel: "Bridge/router/DEX",
      sourceExposureKind: "bridge_router_dex",
      reasons: [`Balance-forming path reaches ${classification.category} boundary (${formatShare(input.balanceShare)} of selected provenance target); this is source-policy context unless it covers a meaningful share. Public-chain continuity after the service boundary should not be assumed.`]
    };
  }
```

Change `sourcePolicyDecision`:

```ts
function sourcePolicyDecision(balanceShare: number): ExchangeDecision {
  return balanceShare >= 0.5 ? "DECLINE" : "REVIEW";
}
```

This function already has the right threshold for bridge and stays compatible with HTX/Huobi and WhiteBIT tests.

- [ ] **Step 4: Run policy tests**

Run:

```bash
npm test -- tests/forensics/moneyOriginPolicy.test.ts tests/forensics/provenanceScoring.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/moneyOriginPolicy.ts tests/forensics/moneyOriginPolicy.test.ts
git commit -m "fix: weight bridge stop policy by share"
```

---

### Task 5: Pass Target Scope Into Where-Is-Money Operational Assessment

**Files:**
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Test: `tests/forensics/moneyOriginOperationalAssessment.test.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Add operational assessment test for `4.06K / 46K` bridge**

In `tests/forensics/moneyOriginOperationalAssessment.test.ts`, add:

```ts
it("does not decline a selected amount from minority bridge exposure", () => {
  const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
    originPaths: [
      reviewPath({
        verdict: "REVIEW",
        rootSourceType: "decline_boundary",
        stoppedReason: "decline_boundary_reached",
        balanceShare: 4060 / 46000,
        exposureSourceKey: "bridge_router_dex",
        exposureSourceLabel: "Bridge/router/DEX",
        sourceExposureKind: "bridge_router_dex",
        riskScoreContribution: 30,
        reasons: ["Minority bridge exposure."]
      })
    ],
    coverage: coverage({
      checkedScope: "transaction_seed",
      provenanceScope: "transaction_seed",
      targetAmountRaw: "46000000000",
      selectedAmountRaw: "46000000000",
      selectedInboundVolumeRaw: "46000000000"
    })
  }));

  expect(assessment.riskScore).toBeLessThan(45);
  expect(assessment.decision).not.toBe("DECLINE");
  expect(assessment.sourcePolicyEvidence[0]?.shareDetail).toMatchObject({
    scope: "where_selected_amount",
    targetAmountRaw: "46000000000",
    affectedAmountRaw: "4060000000",
    shareCap: 30
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts -t "minority bridge"
```

Expected: fail because operational assessment does not pass target scope or still floors source-policy decline.

- [ ] **Step 3: Add scope derivation**

In `src/forensics/moneyOriginOperationalAssessment.ts`, import `SourcePolicyScope` from `../types`.

Add helper near the assessment builder:

```ts
function sourcePolicyScopeFromCoverage(coverage: WhereIsMoneyCoverage): SourcePolicyScope {
  if (coverage.checkedScope === "drain_episode") return "where_drain_episode";
  if (coverage.checkedScope === "recent_flow" || coverage.provenanceScope === "recent_flow") return "where_selected_amount";
  if (coverage.checkedScope === "transaction_seed" || coverage.checkedScope === "requested_amount" || coverage.checkedScope === "selected_anchor") {
    return "where_selected_amount";
  }
  return "balance_forming_target";
}

function sourcePolicyTargetAmountRaw(coverage: WhereIsMoneyCoverage): string {
  return coverage.targetAmountRaw
    ?? coverage.selectedAmountRaw
    ?? coverage.requestedAmountRaw
    ?? coverage.selectedInboundVolumeRaw
    ?? "0";
}
```

Update the call to `scoreSourceExposures`:

```ts
  let sourcePolicyAssessment = applyStrictPathSourcePolicyScores(scoreSourceExposures({
    scope: sourcePolicyScopeFromCoverage(input.coverage),
    targetAmountRaw: sourcePolicyTargetAmountRaw(input.coverage),
    originPaths: input.originPaths,
    walletRole: role,
    operationalLiquidityScore: operationalScore,
    cleanCexCoverage: cleanCexCoverage(input.originPaths),
    coverageCompleteness: coverageScore,
    provenanceConfidence: provenanceScore,
    ageSignals: input.ageSignals ?? null
  }));
```

- [ ] **Step 4: Prevent minority dampenable source-policy floor**

Find the `sourcePolicyDecline` branch in `buildMoneyOriginOperationalAssessment`. Ensure it only triggers for strict source-policy evidence:

```ts
function hasStrictSourcePolicyDecline(assessment: SourcePolicyAssessment): boolean {
  return assessment.sourcePolicyEvidence.some((evidence) => {
    if (evidence.proofLevel !== "exchange_policy_decline") return false;
    if (evidence.kind === "bridge_router_dex" || evidence.kind === "cross_chain_boundary") {
      return evidence.aggregateShare >= 0.5 && evidence.score >= 60;
    }
    return evidence.score >= 60;
  });
}
```

If the function already exists, replace its body with the snippet above while preserving existing non-dampenable behavior for mixer/no-name/sanctioned if it is stricter:

```ts
if (!evidence.canBeDampened && evidence.score >= 60) return true;
```

at the start of the callback.

- [ ] **Step 5: Add where-is-money integration test**

In `tests/check/whereIsMoneyCheck.test.ts`, add a transaction-seeded test using existing edge helpers:

```ts
it("keeps minority bridge branch below high risk for selected transaction amount", async () => {
  const subject = "TSubjectMinorBridge111111111111111111";
  const sender = "TSenderMinorBridge1111111111111111111";
  const bridge = "TBridgeMinorShare1111111111111111111";
  const clean = "TCleanMinorShare11111111111111111111";
  const depositTx = "tx-deposit-46k";

  const report = await runWhereIsMoneyCheck(deps({
    edgesByAddress: new Map([
      [subject, [edge(depositTx, sender, subject, "46000000000", "2026-06-01T10:00:00.000Z")]],
      [sender, [
        edge("tx-bridge-4k", bridge, sender, "4060000000", "2026-06-01T09:00:00.000Z"),
        edge("tx-clean-41k", clean, sender, "41940000000", "2026-06-01T08:00:00.000Z")
      ]]
    ]),
    classificationsByAddress: new Map([[bridge, service("bridge", "Bridge")]])
  }), {
    mode: "transaction_check",
    subjectAddress: subject,
    requestedAmountRaw: "46000000000",
    seedTransfers: [{
      txHash: depositTx,
      fromAddress: sender,
      toAddress: subject,
      amountRaw: "46000000000",
      timestamp: "2026-06-01T10:00:00.000Z"
    }],
    windowStart: new Date("2026-05-01T00:00:00.000Z"),
    windowEnd: new Date("2026-06-02T00:00:00.000Z")
  });

  expect(report.riskScore).toBeLessThan(45);
  expect(report.assessment.sourcePolicyEvidence[0]?.shareDetail?.shareCap).toBe(30);
});
```

Use the existing local test helper names from `whereIsMoneyCheck.test.ts`; if helper names differ, keep the same object shape and assertions.

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts tests/check/whereIsMoneyCheck.test.ts
npm run typecheck -- --pretty false
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/forensics/moneyOriginOperationalAssessment.ts src/check/whereIsMoneyCheck.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "fix: pass selected amount into source-policy scoring"
```

---

### Task 6: Apply Amount Weighting to Incoming Deposit Reports

**Files:**
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `src/types.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Add incoming deposit report fields**

In `src/types.ts`, add to `IncomingDepositOriginPath`:

```ts
  sourcePolicyShareDetail?: SourcePolicyShareDetail;
```

Add to `IncomingDepositRiskReport`:

```ts
  sourcePolicyEvidence?: SourcePolicyEvidence[];
```

- [ ] **Step 2: Add failing incoming deposit regression**

In `tests/forensics/incomingDepositJob.test.ts`, add a test that builds a `46K` deposit where only `4.06K` of sender funding reaches bridge:

```ts
it("does not decline a 46K incoming deposit when only 4.06K is bridge-linked", async () => {
  const report = await buildIncomingDepositReport(incomingDepositInput({
    amountRaw: "46000000000",
    senderTransfers: [
      indexed("tx-bridge-4060", bridgeAddress, senderAddress, "4060000000", "2026-06-01T09:00:00.000Z"),
      indexed("tx-clean-41940", cleanAddress, senderAddress, "41940000000", "2026-06-01T08:00:00.000Z")
    ],
    classifications: new Map([[bridgeAddress, service("bridge", "Bridge")]])
  }));

  expect(report.depositRiskScore).toBeLessThan(45);
  expect(report.decision).not.toBe("DECLINE");
  expect(report.sourcePolicyEvidence?.[0]?.shareDetail).toMatchObject({
    scope: "where_selected_amount",
    targetAmountRaw: "46000000000",
    affectedAmountRaw: "4060000000",
    shareCap: 30
  });
});
```

Use the test file's existing factory/helper names. Keep the same amounts and assertions.

- [ ] **Step 3: Run and verify failure**

Run:

```bash
npm test -- tests/forensics/incomingDepositJob.test.ts -t "4.06K"
```

Expected: fail because report does not expose source-policy evidence and may still use a high score.

- [ ] **Step 4: Map where evidence into incoming report**

In `src/forensics/incomingDepositJob.ts`, change `incomingPathFromWhere`:

```ts
    ...(path.scoreBreakdown?.[0]?.shareDetail ? { sourcePolicyShareDetail: path.scoreBreakdown[0].shareDetail } : {}),
```

In `incomingReportFromWhere`, include:

```ts
    sourcePolicyEvidence: input.whereReport.assessment.sourcePolicyEvidence,
```

Update the `depositRiskScore` and decision logic so source-policy score is already the amount-weighted score from `whereReport`:

```ts
  const depositRiskScore = Math.max(input.whereReport.riskScore, topHardScore);
  const decision = topHardScore >= 85 ? "DECLINE" : input.whereReport.userDecision;
```

Keep this logic if it is already present. Do not reintroduce path-level max over `originPaths`.

- [ ] **Step 5: Run incoming tests**

Run:

```bash
npm test -- tests/forensics/incomingDepositJob.test.ts tests/forensics/provenanceScoring.test.ts
npm run typecheck -- --pretty false
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "fix: weight incoming deposit source policy by amount"
```

---

### Task 7: Align Cross-Chain Terminal Boundary Scoring

**Files:**
- Modify: `src/forensics/crossChainEvidence.ts`
- Test: `tests/forensics/crossChainEvidence.test.ts`

- [ ] **Step 1: Add tiny bridge cross-chain test**

In `tests/forensics/crossChainEvidence.test.ts`, add:

```ts
it("caps tiny cross-chain bridge boundary by selected share", () => {
  const layer = scoreCrossChainTerminalBoundary({
    terminalBoundary: "bridge_boundary",
    evidenceIds: ["cc-bridge"],
    selectedShare: 4060 / 46000
  });

  expect(layer.score).toBeLessThanOrEqual(30);
  expect(layer.proofLevel).toBe("exchange_policy_context");
  expect(layer.canBeDampened).toBe(true);
});
```

Add majority test:

```ts
it("allows majority cross-chain bridge boundary to reach source-policy decline", () => {
  const layer = scoreCrossChainTerminalBoundary({
    terminalBoundary: "bridge_boundary",
    evidenceIds: ["cc-bridge"],
    selectedShare: 0.65
  });

  expect(layer.score).toBeGreaterThanOrEqual(60);
  expect(layer.score).toBeLessThanOrEqual(70);
  expect(layer.proofLevel).toBe("exchange_policy_decline");
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm test -- tests/forensics/crossChainEvidence.test.ts
```

Expected: fail if bridge boundary still uses shallow `base - 10`.

- [ ] **Step 3: Use the shared share curve**

In `src/forensics/crossChainEvidence.ts`, import:

```ts
import { baseShareScore } from "./provenanceScoring";
```

Replace `shareAdjustedScore` usage for `sourceExposureKind` configs:

```ts
const preliminaryScore = config.usesSelectedShare && config.sourceExposureKind
  ? baseShareScore(config.sourceExposureKind, selectedShare)
  : config.usesSelectedShare
    ? shareAdjustedScore(config.baseScore, selectedShare)
    : config.baseScore;
```

Set proof level based on score for dampenable bridge/router/unknown:

```ts
const proofLevel = adjustedScore >= 60 && config.proofLevel === "exchange_policy_decline"
  ? "exchange_policy_decline"
  : adjustedScore >= 60 && config.sourceExposureKind
    ? "exchange_policy_decline"
    : config.proofLevel === "exchange_policy_decline"
      ? "exchange_policy_context"
      : config.proofLevel;
```

Use `proofLevel` in the returned layer.

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- tests/forensics/crossChainEvidence.test.ts tests/forensics/provenanceScoring.test.ts
npm run typecheck -- --pretty false
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/crossChainEvidence.ts tests/forensics/crossChainEvidence.test.ts
git commit -m "fix: cap cross-chain bridge risk by share"
```

---

### Task 8: Apply Denominators in Deep Research

**Files:**
- Modify: `src/forensics/deepForensicJob.ts`
- Test: `tests/forensics/deepForensicJob.test.ts`

- [ ] **Step 1: Add deep generic volume regression**

In `tests/forensics/deepForensicJob.test.ts`, add:

```ts
it("keeps tiny bridge exposure contextual against deep recent volume", async () => {
  const report = await runDeepForensicJobCycle(deepJobInput({
    subjectAddress,
    recentVolumeRaw: "2000000000000",
    boundaryFlows: [
      boundaryFlow({
        boundaryCategory: "bridge",
        amountRaw: "4000000000",
        boundaryAmountRaw: "4000000000"
      })
    ]
  }));

  const bridgeLayer = report.resultJson.assessment.riskLayers.find((layer: any) =>
    layer.sourceExposureKind === "bridge_router_dex" || layer.sourceExposureKind === "cross_chain_boundary"
  );
  expect(bridgeLayer?.score).toBeLessThan(20);
  expect(report.resultJson.riskScore).toBeLessThan(45);
});
```

Use the helper names already present in `deepForensicJob.test.ts`. Preserve the values: `2M` recent volume and `4K` bridge exposure.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm test -- tests/forensics/deepForensicJob.test.ts -t "tiny bridge exposure"
```

Expected: fail because deep does not pass the 30-day/recent-volume denominator or layer details.

- [ ] **Step 3: Add deep denominator selection**

In `src/forensics/deepForensicJob.ts`, when building any where-style operational assessment or extra source-policy evidence for deep, derive:

```ts
const deepSourcePolicyScope: SourcePolicyScope = selectedFlowAmountRaw
  ? "where_selected_amount"
  : recentFlowVolumeRaw
    ? "deep_recent_flow"
    : "deep_30d_volume";

const deepTargetAmountRaw = selectedFlowAmountRaw
  ?? recentFlowVolumeRaw
  ?? thirtyDayVolumeRaw
  ?? "0";
```

Pass these values into `scoreSourceExposures` or into the operational assessment coverage object:

```ts
coverage: {
  ...coverage,
  targetAmountRaw: deepTargetAmountRaw,
  selectedAmountRaw: selectedFlowAmountRaw ?? deepTargetAmountRaw,
  checkedScope: selectedFlowAmountRaw ? "selected_anchor" : "recent_flow",
  provenanceScope: selectedFlowAmountRaw ? "selected_anchor" : "recent_flow"
}
```

If the deep path uses `extraSourcePolicyEvidence`, populate `shareDetail` with the same target denominator before passing it to `buildMoneyOriginOperationalAssessment`.

- [ ] **Step 4: Run deep tests**

Run:

```bash
npm test -- tests/forensics/deepForensicJob.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts
npm run typecheck -- --pretty false
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/deepForensicJob.ts tests/forensics/deepForensicJob.test.ts
git commit -m "fix: weight deep source policy by flow share"
```

---

### Task 9: Show Colored Deposit Risk in Incoming Alerts

**Files:**
- Modify: `src/alerts/formatters.ts`
- Test: `tests/alerts/formatters.test.ts`

- [ ] **Step 1: Add failing Russian deposit-risk badge test**

In `tests/alerts/formatters.test.ts`, add:

```ts
it("formats incoming deposit risk with colored risk icon and band", () => {
  const message = formatIncomingDepositRiskAlert({
    ...incomingDepositBaseInput,
    report: {
      ...incomingDepositBaseInput.report,
      decision: "ACCEPTABLE",
      depositRiskScore: 40,
      riskBand: "LOW-MEDIUM"
    }
  });

  expect(message.text).toContain("<b>Риск депозита</b>: 🟡 <code>40/100</code> (<code>LOW-MEDIUM</code>)");
});
```

- [ ] **Step 2: Add English parity test**

In the existing English incoming deposit formatter test, change the deposit risk expectation to include the same colored icon and band:

```ts
expect(message.text).toContain("<b>Deposit risk</b>: 🟠 <code>68/100</code> (<code>HIGH</code>)");
```

In the existing Russian default incoming deposit formatter test, change the deposit risk expectation to:

```ts
expect(message.text).toContain("<b>Риск депозита</b>: 🟠 <code>68/100</code> (<code>HIGH</code>)");
```

- [ ] **Step 3: Run and verify failure**

Run:

```bash
npm test -- tests/alerts/formatters.test.ts -t "incoming deposit risk"
```

Expected: fail because current output is `<b>Риск депозита</b>: <code>68/100</code> (<code>HIGH</code>)` without the colored icon.

- [ ] **Step 4: Implement risk icon mapping**

In `src/alerts/formatters.ts`, `formatRiskIcon` currently accepts `RiskLevel`, while incoming deposit uses `IncomingDepositRiskBand` with `LOW-MEDIUM`.

Import `IncomingDepositRiskBand` from `../types` if it is not already imported:

```ts
import type { IncomingDepositRiskBand } from "../types";
```

Add a helper near the incoming deposit formatter:

```ts
function incomingDepositRiskIcon(band: IncomingDepositRiskBand): string {
  switch (band) {
    case "LOW":
      return "🟢";
    case "LOW-MEDIUM":
    case "MEDIUM":
      return "🟡";
    case "HIGH":
      return "🟠";
    case "CRITICAL":
      return "🔴";
  }
}
```

Change the deposit-risk line in `formatIncomingDepositRiskAlert` to:

```ts
    `${bold(riskObjectLabel("deposit", locale))}: ${incomingDepositRiskIcon(input.report.riskBand)} ${code(`${input.report.depositRiskScore}/100`)} (${code(input.report.riskBand)})`,
```

- [ ] **Step 5: Run formatter tests**

Run:

```bash
npm test -- tests/alerts/formatters.test.ts
npm run typecheck -- --pretty false
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/alerts/formatters.ts tests/alerts/formatters.test.ts
git commit -m "feat: show deposit risk icon in alerts"
```

---

### Task 10: Show Share Math in Admin Graph

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add graph projection test**

In `tests/admin/forensicsGraph.test.ts`, add:

```ts
it("projects source-policy share details into graph weights", () => {
  const result = projectForensicJobToGraph(job({
    kind: "incoming_deposit_check",
    resultJson: {
      decision: "ACCEPTABLE",
      depositRiskScore: 24,
      sourcePolicyEvidence: [{
        kind: "bridge_router_dex",
        aggregateShare: 4060 / 46000,
        effectiveShare: 4060 / 46000,
        pathCount: 1,
        score: 24,
        riskBand: "LOW-MEDIUM",
        proofLevel: "exchange_policy_context",
        canBeDampened: true,
        reasons: ["Bridge exposure is 8.8% raw / 8.8% effective."],
        warnings: [],
        evidenceIds: ["tx-bridge"],
        shareDetail: {
          scope: "incoming_deposit",
          targetAmountRaw: "46000000000",
          affectedAmountRaw: "4060000000",
          rawShare: 4060 / 46000,
          effectiveShare: 4060 / 46000,
          sourceSeverity: 65,
          valueWeightedRaw: 5.7,
          pathContextAdjustment: 12,
          repeatedExposureAdjustment: 0,
          dataQualityAdjustment: 6,
          walletRoleAdjustment: 0,
          shareFloor: 0,
          shareCap: 30,
          finalContribution: 24
        }
      }],
      originPaths: []
    }
  }));

  if (!result.ok) throw new Error(result.error);
  expect(result.graph.weights[0]?.metadata).toMatchObject({
    affectedAmountRaw: "4060000000",
    targetAmountRaw: "46000000000",
    rawShare: 4060 / 46000,
    shareCap: 30,
    finalContribution: 24
  });
});
```

Use the existing test helpers in `forensicsGraph.test.ts`; keep the asserted metadata object.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts -t "source-policy share details"
```

Expected: fail because graph weights do not carry share detail metadata.

- [ ] **Step 3: Project share detail metadata**

In `src/admin/forensicsGraph.ts`, when mapping risk layers or source-policy evidence into graph weights, add:

```ts
const shareMetadata = evidence.shareDetail
  ? {
      scope: evidence.shareDetail.scope,
      affectedAmountRaw: evidence.shareDetail.affectedAmountRaw,
      targetAmountRaw: evidence.shareDetail.targetAmountRaw,
      rawShare: evidence.shareDetail.rawShare,
      effectiveShare: evidence.shareDetail.effectiveShare,
      sourceSeverity: evidence.shareDetail.sourceSeverity,
      shareCap: evidence.shareDetail.shareCap,
      finalContribution: evidence.shareDetail.finalContribution
    }
  : {};
```

Merge `shareMetadata` into the weight `metadata`.

- [ ] **Step 4: Display in admin detail panel**

In `src/admin/adminConsole.ts`, add a formatter:

```ts
function formatSharePercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}
```

In the selected weight/details rendering, add rows:

```ts
detailRows.push(["Affected", formatRawUsdtAmount(metadata.affectedAmountRaw)]);
detailRows.push(["Target", formatRawUsdtAmount(metadata.targetAmountRaw)]);
detailRows.push(["Share", `${formatSharePercent(metadata.rawShare)} raw / ${formatSharePercent(metadata.effectiveShare)} effective`]);
detailRows.push(["Share cap", String(metadata.shareCap ?? "n/a")]);
detailRows.push(["Contribution", String(metadata.finalContribution ?? "n/a")]);
```

Use the local amount formatter already present in `adminConsole.ts`; if it has a different name, call the existing formatter rather than duplicating USDT formatting.

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminServer.test.ts
npm run typecheck -- --pretty false
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat: show source-policy share math in graph"
```

---

### Task 11: Full Regression and Master Integration

**Files:**
- All files touched by earlier tasks

- [ ] **Step 1: Run targeted regression**

Run:

```bash
npm test -- tests/forensics/provenanceScoring.test.ts tests/forensics/moneyOriginPolicy.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/forensics/crossChainEvidence.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/deepForensicJob.test.ts tests/check/whereIsMoneyCheck.test.ts tests/alerts/formatters.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminServer.test.ts
```

Expected: all selected suites pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck -- --pretty false
```

Expected: pass.

- [ ] **Step 3: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: exit code `0`. Line-ending warnings from Git are acceptable only if `diff --check` exits `0`.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff --stat master..HEAD
git diff --name-only master..HEAD
```

Expected files include the planned modules and tests. No unrelated files are included.

- [ ] **Step 5: Rebase or merge latest master**

Run:

```bash
git fetch origin
git rebase origin/master
```

If conflicts appear, resolve only files touched by this plan. Re-run Steps 1-3 after resolving conflicts.

- [ ] **Step 6: Final commit if rebase resolution changed files**

If conflict resolution produced new changes:

```bash
git add src tests docs
git commit -m "fix: resolve amount-weighted scoring integration"
```

If no new changes were produced, do not create an empty commit.

- [ ] **Step 7: Push implementation branch**

```bash
git push -u origin codex/amount-weighted-source-policy
```

Expected: branch is pushed and ready to merge into `master`.

---

## Self-Review Checklist

- Spec coverage: covered shared scorer, incoming deposit, where-is-money, deep research, cross-chain, fast-check exclusion, hard-proof exceptions, Telegram deposit-risk icon display, UI/audit display, duplicate-path allocation.
- Type consistency: `SourcePolicyScope`, `SourcePolicyShareDetail`, `shareDetail`, `scope`, `targetAmountRaw`, and `sourcePolicyEvidence` use the same names in types, scorer, reports, graph, and tests.
- Risk consistency: bridge/router/DEX/cross-chain `4.06K / 46K` is capped at `30`; `40 / 46K` is capped at `10`; majority bridge can reach `60+`; hard proof remains separate.
- Master integration: implementation starts from `master`, rebases onto `origin/master`, and pushes a dedicated branch for merge.
