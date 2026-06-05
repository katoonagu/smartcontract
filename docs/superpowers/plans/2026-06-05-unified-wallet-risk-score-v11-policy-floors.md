# Unified Wallet Risk Score v1.1 Policy Floors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the unified wallet score so Fast Check, Deep Research, and Where Is Money still produce one final score, one final level, and one final decision, while strong policy and asset-continuation evidence can anchor the final score instead of being diluted by layer weights.

**Architecture:** Keep the existing `src/risk/unifiedWalletRisk.ts` composition layer. Add explicit `policyFloor`, `assetContinuationFloor`, and `contextScore` fields to the scorer result. Add a bounded Deep Research detector for generic TRC20 asset continuation. Keep the current USDT graph/search logic intact and add a second all-token transfer lookup only for the subject address.

**Tech Stack:** TypeScript, Vitest, existing TRON/TronScan client, existing Deep Research report types, existing Telegram HTML formatter.

---

## Source Spec

Committed spec:

```text
docs/superpowers/specs/2026-06-05-unified-wallet-risk-score-v11-policy-floors-design.md
```

The spec was created after the real DB case for:

```text
TYs4UuvnUHr8D744bURoKWqfNA2TNJEXi7
```

Current v1 behavior from that case:

```text
Fast: 0
Deep: 45
Where: 70
Weighted final: 48
Decision: DECLINE
```

Target v1.1 behavior for the same risk shape:

```text
weightedLayerScore: 48
policyFloor: 70
assetContinuationFloor: 80-84 when verified continuation to provider-risk destination is detected
hardEvidenceFloor: 0
finalScore: 80-84
finalLevel: HIGH
finalDecision: DECLINE
```

## Current Code Facts

- `src/risk/unifiedWalletRisk.ts:42` defines `UnifiedWalletRiskResult`; it currently exposes `hardEvidenceFloor`, `patternFloor`, and `dampener`, but not `policyFloor`, `assetContinuationFloor`, or `contextScore`.
- `src/risk/unifiedWalletRisk.ts:241` computes the Deep layer from existing Deep profiles.
- `src/risk/unifiedWalletRisk.ts:475` computes the raw dampener.
- `src/risk/unifiedWalletRisk.ts:498` decides how much dampener can be applied.
- `src/risk/unifiedWalletRisk.ts:512` computes the final unified score.
- `src/check/deepForensicCheck.ts:59` defines `DeepAddressForensicReport`; it currently has no asset-continuation profile list.
- `src/check/deepForensicCheck.ts:1055` runs Deep Research and returns the report.
- `src/tron/tronClient.ts:333` builds the transfer-history URL and always adds the official USDT `contract_address`.
- `src/tron/tronClient.ts:584` exposes `listRelatedTrc20Transfers`, which is USDT-scoped because it uses the shared URL builder.
- `src/parser/transactionParser.ts:6` defines `RawTronscanTrc20Transfer`; it currently includes only the fields needed by existing USDT parsing.
- `src/bot/createBot.ts:1991` renders the unified score breakdown in the Telegram final report.
- `tests/risk/unifiedWalletRisk.test.ts:365` already tests that blacklist hard evidence is not diluted.
- `tests/risk/unifiedWalletRisk.test.ts:768` already tests that service-boundary-only context is not hard evidence.
- `tests/risk/unifiedWalletRisk.test.ts:782` already tests the TLh-like historical transit pattern floor.

## File Structure

Create:

```text
src/forensics/assetContinuation.ts
tests/forensics/assetContinuation.test.ts
```

Modify:

```text
src/types.ts
src/check/deepForensicCheck.ts
src/forensics/routeSearch.ts
src/parser/transactionParser.ts
src/tron/tronClient.ts
src/risk/unifiedWalletRisk.ts
src/bot/createBot.ts
tests/check/deepForensicCheck.test.ts
tests/tron/tronClient.test.ts
tests/risk/unifiedWalletRisk.test.ts
tests/bot/createBot.test.ts
docs/project-walkthrough/01-address-check-fast-check.md
```

Do not modify:

```text
src/risk/riskPolicy.ts
src/risk/riskEngine.ts
```

Reason: v1.1 changes wallet-level composition and one Deep detector. It should not rewrite the older policy engine.

## Recommended Worker Split

Use subagents in this order:

```text
Worker A: unified scorer tests and formula.
Worker B: Tron all-token client method and asset-continuation detector.
Worker C: Deep Research wiring and persisted report extraction.
Worker D: Telegram reporting and documentation.
```

Merge sequence:

```text
A first, because it defines result shape.
B second, because C needs the detector.
C third, because D needs report fields.
D last, because reporting depends on final scorer fields.
```

---

### Task 1: Add Failing Unified Scorer Tests For v1.1 Floors

**Files:**

```text
tests/risk/unifiedWalletRisk.test.ts
```

- [ ] **Step 1: Import the extra types needed by fixtures**

Add `RiskLayerScore` and `SourcePolicyEvidence` to the existing type import from `../../src/types`.

```ts
import type {
  ApprovalDrainProvenanceProfile,
  BoundaryExposureProfile,
  CounterpartyRiskProfile,
  ExtendedProvenanceProfile,
  InboundProvenanceProfile,
  OperationalFlowProfile,
  RiskLabel,
  RiskLayerScore,
  RiskReport,
  SourcePolicyEvidence,
  StablecoinRestrictionProfile,
  WalletRoleProfile,
  WhereIsMoneyAssessment,
  WhereIsMoneyReport
} from "../../src/types";
```

- [ ] **Step 2: Add source-policy fixture helpers below `whereReport`**

```ts
function sourcePolicyEvidence(score = 70): SourcePolicyEvidence {
  return {
    kind: "bridge_router_dex",
    aggregateShare: 1,
    effectiveShare: 1,
    pathCount: 1,
    score,
    riskBand: score >= 85 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW",
    proofLevel: score >= 60 ? "exchange_policy_decline" : "exchange_policy_context",
    canBeDampened: false,
    reasons: ["Bridge/router/DEX source-policy exposure is strong enough for policy decline."],
    warnings: [],
    evidenceIds: ["source-policy-bridge-router-dex"]
  };
}

function sourcePolicyLayer(score = 70): RiskLayerScore {
  return {
    evidenceClass: "source_policy",
    kind: "bridge_router_dex",
    sourceExposureKind: "bridge_router_dex",
    score,
    rawScore: score,
    adjustedScore: score,
    proofLevel: score >= 60 ? "exchange_policy_decline" : "exchange_policy_context",
    canBeDampened: false,
    reasons: ["Aggregate source-policy layer is strong enough for policy decline."],
    warnings: [],
    evidenceIds: ["source-policy-layer-bridge-router-dex"]
  };
}
```

- [ ] **Step 3: Add an asset-continuation fixture helper below `deepReport`**

The helper uses a structural extension so this failing test can be written before `DeepAddressForensicReport` is updated.

```ts
type AssetContinuationFixture = {
  subjectAddress: string;
  sourceAsset: "USDT";
  continuationAssetSymbol: string;
  continuationTokenContract: string;
  conversionTxHash: string;
  outgoingTxHash: string | null;
  protocolAddress: string | null;
  destinationAddress: string | null;
  destinationRisk: "provider_risk" | "internal_label" | "service_boundary" | "unknown";
  elapsedMs: number | null;
  sourceAmountRaw: string | null;
  continuationAmountRaw: string | null;
  tokenQuality: "verified" | "known" | "unknown";
  score: number;
  evidenceClass: "asset_continuation";
  reasons: string[];
};

function assetContinuationProfile(overrides: Partial<AssetContinuationFixture> = {}): AssetContinuationFixture {
  return {
    subjectAddress: address,
    sourceAsset: "USDT",
    continuationAssetSymbol: "WRAPPED",
    continuationTokenContract: "TWrappedToken1111111111111111111111",
    conversionTxHash: "tx-usdt-to-wrapped",
    outgoingTxHash: "tx-wrapped-out",
    protocolAddress: "TProtocol111111111111111111111111111",
    destinationAddress: "TRiskyDestination1111111111111111111",
    destinationRisk: "provider_risk",
    elapsedMs: 12_000,
    sourceAmountRaw: "101607508600",
    continuationAmountRaw: "101607508600",
    tokenQuality: "verified",
    score: 82,
    evidenceClass: "asset_continuation",
    reasons: ["Verified TRC20 continuation left the wallet and went to a provider-risk destination."],
    ...overrides
  };
}

function deepReportWithAssetContinuation(
  profile: AssetContinuationFixture
): DeepAddressForensicReport & { assetContinuationProfiles: AssetContinuationFixture[] } {
  return {
    ...deepReport(),
    assetContinuationProfiles: [profile]
  };
}
```

- [ ] **Step 4: Add tests for policy floor and service-boundary guard**

Add these tests inside `describe("calculateUnifiedWalletRisk", ...)`.

```ts
it("anchors exchange-policy decline at the policy floor instead of diluting it by weights", () => {
  const policyEvidence = sourcePolicyEvidence(70);
  const result = calculateUnifiedWalletRisk({
    address,
    fastReport: fastReport(0),
    deepReport: deepReport({
      counterpartyRiskProfiles: [counterpartyRiskProfile({ score: 45 })]
    }),
    whereReport: whereReport(70, {
      proofLevel: "exchange_policy_decline",
      assessment: whereAssessment(70, {
        sourcePolicyEvidence: [policyEvidence],
        riskLayers: [sourcePolicyLayer(70)],
        dominantRiskLayer: sourcePolicyLayer(70)
      })
    })
  });

  expect(result.weightedLayerScore).toBe(48);
  expect(result.policyFloor).toBe(70);
  expect(result.finalScore).toBe(70);
  expect(result.finalLevel).toBe("HIGH");
  expect(result.finalDecision).toBe("DECLINE");
});

it("does not create a policy floor from service-boundary context alone", () => {
  const result = calculateUnifiedWalletRisk({
    address,
    whereReport: whereReport(0, {
      proofLevel: "exchange_policy_context",
      assessment: whereAssessment(0)
    }),
    deepReport: deepReport({ boundaryExposureProfiles: [boundaryExposureProfile()] })
  });

  expect(result.policyFloor).toBe(0);
  expect(result.hardEvidenceFloor).toBe(0);
  expect(result.layerBreakdown.deep.rawScore).toBe(15);
  expect(result.finalScore).toBeLessThan(30);
});
```

- [ ] **Step 5: Add tests for asset-continuation floor and dampener isolation**

```ts
it("anchors verified asset continuation above the weighted layer score", () => {
  const result = calculateUnifiedWalletRisk({
    address,
    fastReport: fastReport(0),
    deepReport: deepReportWithAssetContinuation(assetContinuationProfile()),
    whereReport: whereReport(70, {
      proofLevel: "exchange_policy_decline",
      assessment: whereAssessment(70, {
        sourcePolicyEvidence: [sourcePolicyEvidence(70)],
        riskLayers: [sourcePolicyLayer(70)],
        dominantRiskLayer: sourcePolicyLayer(70)
      })
    })
  });

  expect(result.weightedLayerScore).toBe(21);
  expect(result.policyFloor).toBe(70);
  expect(result.assetContinuationFloor).toBe(82);
  expect(result.finalScore).toBe(82);
  expect(result.finalLevel).toBe("HIGH");
});

it("caps asset-continuation evidence below CRITICAL when hard evidence is absent", () => {
  const result = calculateUnifiedWalletRisk({
    address,
    fastReport: fastReport(0),
    deepReport: deepReportWithAssetContinuation(assetContinuationProfile({ score: 95 })),
    whereReport: whereReport(0)
  });

  expect(result.hardEvidenceFloor).toBe(0);
  expect(result.assetContinuationFloor).toBe(84);
  expect(result.finalScore).toBe(84);
  expect(result.finalLevel).toBe("HIGH");
});

it("does not let dampeners reduce policy or asset-continuation floors", () => {
  const result = calculateUnifiedWalletRisk({
    address,
    fastReport: fastReport(0, [{ code: "internal_label_false_positive", message: "trusted context", scoreImpact: -40 }]),
    deepReport: deepReportWithAssetContinuation(assetContinuationProfile({ score: 82 })),
    whereReport: whereReport(70, {
      proofLevel: "exchange_policy_decline",
      assessment: whereAssessment(70, {
        walletRole: "operational_liquidity_wallet",
        sourcePolicyEvidence: [sourcePolicyEvidence(70)],
        riskLayers: [sourcePolicyLayer(70)],
        dominantRiskLayer: sourcePolicyLayer(70)
      })
    })
  });

  expect(result.policyFloor).toBe(70);
  expect(result.assetContinuationFloor).toBe(82);
  expect(result.dampener).toBeGreaterThan(0);
  expect(result.finalScore).toBe(82);
});
```

- [ ] **Step 6: Run the targeted failing tests**

```powershell
npm test -- tests/risk/unifiedWalletRisk.test.ts
```

Expected at this point:

```text
FAIL
```

The failures should be missing result fields and final-score expectations.

- [ ] **Step 7: Commit the failing tests only**

```powershell
git add tests/risk/unifiedWalletRisk.test.ts
git commit -m "test: cover unified risk policy and asset floors"
```

---

### Task 2: Add Asset Continuation Types

**Files:**

```text
src/types.ts
src/check/deepForensicCheck.ts
```

- [ ] **Step 1: Add asset-continuation domain types to `src/types.ts`**

Add near the other forensic profile types:

```ts
export type AssetContinuationDestinationRisk =
  | "provider_risk"
  | "internal_label"
  | "service_boundary"
  | "unknown";

export type AssetContinuationTokenQuality = "verified" | "known" | "unknown";

export type AssetContinuationProfile = {
  subjectAddress: string;
  sourceAsset: "USDT";
  continuationAssetSymbol: string;
  continuationTokenContract: string;
  conversionTxHash: string;
  outgoingTxHash: string | null;
  protocolAddress: string | null;
  destinationAddress: string | null;
  destinationRisk: AssetContinuationDestinationRisk;
  elapsedMs: number | null;
  sourceAmountRaw: string | null;
  continuationAmountRaw: string | null;
  tokenQuality: AssetContinuationTokenQuality;
  score: number;
  evidenceClass: "asset_continuation";
  reasons: string[];
};
```

- [ ] **Step 2: Extend `DeepAddressForensicReport`**

In `src/check/deepForensicCheck.ts`, import the new type:

```ts
import type {
  AddressExposureReport,
  AddressLabel,
  ApprovalDrainProvenanceProfile,
  AssetContinuationProfile,
  BoundaryExposureDepth,
  BoundaryExposureProfile,
  ...
} from "../types";
```

Add an optional list to the report type:

```ts
export type DeepAddressForensicReport = AddressExposureReport & {
  inboundProvenanceProfiles: InboundProvenanceProfile[];
  counterpartyRiskProfiles: CounterpartyRiskProfile[];
  directCounterpartyInteractionProfiles?: DirectCounterpartyInteractionProfile[];
  approvalDrainProvenanceProfiles: ApprovalDrainProvenanceProfile[];
  assetContinuationProfiles?: AssetContinuationProfile[];
  boundaryExposureProfiles: BoundaryExposureProfile[];
  ...
};
```

- [ ] **Step 3: Run typecheck**

```powershell
npm run typecheck
```

Expected:

```text
PASS
```

- [ ] **Step 4: Commit the type change**

```powershell
git add src/types.ts src/check/deepForensicCheck.ts
git commit -m "feat: add asset continuation report types"
```

---

### Task 3: Implement v1.1 Unified Score Formula

**Files:**

```text
src/risk/unifiedWalletRisk.ts
tests/risk/unifiedWalletRisk.test.ts
```

- [ ] **Step 1: Extend scorer result types**

Change `UnifiedWalletRiskReason["source"]`:

```ts
  source:
    | "fast_check"
    | "deep_research"
    | "where_is_money"
    | "hard_evidence"
    | "policy_floor"
    | "asset_continuation"
    | "pattern_floor"
    | "dampener"
    | "coverage";
```

Change `UnifiedWalletRiskResult`:

```ts
export type UnifiedWalletRiskResult = {
  finalScore: number;
  finalLevel: RiskLevel;
  finalDecision: UserExchangeDecision;
  weightedLayerScore: number;
  contextScore: number;
  hardEvidenceFloor: number;
  policyFloor: number;
  assetContinuationFloor: number;
  patternFloor: number;
  dampener: number;
  coverageLevel: UnifiedWalletCoverageLevel;
  layerBreakdown: Record<UnifiedWalletRiskLayer, LayerScoreBreakdown>;
  reasons: UnifiedWalletRiskReason[];
};
```

- [ ] **Step 2: Add source-policy floor helpers**

Add these helpers near `whereHardEvidenceFloor`.

```ts
function wherePolicyFloor(report: WhereIsMoneyReport): UnifiedWalletRiskReason | null {
  const policyEvidenceScores = arrayOrEmpty(report.assessment.sourcePolicyEvidence)
    .filter((item) =>
      item.proofLevel === "exchange_policy_decline" ||
      item.score >= 60
    )
    .map((item) => clampScore(item.score));

  const layerScores = arrayOrEmpty(report.assessment.riskLayers)
    .filter((layer) =>
      layer.evidenceClass === "source_policy" &&
      (layer.proofLevel === "exchange_policy_decline" || Math.max(layer.adjustedScore, layer.score) >= 60)
    )
    .map((layer) => clampScore(Math.max(layer.adjustedScore, layer.score)));

  const explicitDecline = report.proofLevel === "exchange_policy_decline";
  const candidate = maxScore([
    ...policyEvidenceScores,
    ...layerScores,
    explicitDecline ? report.riskScore : 0
  ]);

  if (!explicitDecline && candidate < 60) return null;
  if (candidate <= 0) return null;

  return {
    code: "where_source_policy_floor",
    message: "Where Is Money found source-policy decline evidence that should not be diluted by layer weights.",
    score: Math.min(84, Math.max(70, candidate)),
    source: "policy_floor"
  };
}
```

This intentionally excludes Deep service-boundary-only context.

- [ ] **Step 3: Add asset-continuation floor helper**

```ts
function assetContinuationFloor(report: DeepAddressForensicReport | null | undefined): UnifiedWalletRiskReason | null {
  const top = arrayOrEmpty(report?.assetContinuationProfiles)
    .filter((profile) =>
      profile.evidenceClass === "asset_continuation" &&
      profile.tokenQuality !== "unknown" &&
      profile.score >= 65
    )
    .map((profile) => ({
      profile,
      score: Math.min(84, clampScore(profile.score))
    }))
    .sort((left, right) => right.score - left.score)[0] ?? null;

  if (!top) return null;
  return {
    code: "asset_continuation_floor",
    message: top.profile.reasons[0] ?? "Verified TRC20 asset continuation found after USDT movement.",
    score: top.score,
    source: "asset_continuation"
  };
}
```

- [ ] **Step 4: Include asset-continuation profiles in the Deep raw layer**

Inside `deepLayer`, add:

```ts
  for (const profile of arrayOrEmpty(report.assetContinuationProfiles)) {
    scores.push(Math.min(84, profile.score));
    if (profile.score > 0) reasons.push("asset continuation profile");
  }
```

- [ ] **Step 5: Replace the final formula**

In `calculateUnifiedWalletRisk`, replace the current `baseScore`, dampening, and final-score block with:

```ts
  const policyReasons = [
    wherePolicyFloor(input.whereReport)
  ].filter((reason): reason is UnifiedWalletRiskReason => reason !== null);
  const policyFloor = maxScore(policyReasons.map((reason) => reason.score));

  const assetContinuationReasons = [
    assetContinuationFloor(input.deepReport)
  ].filter((reason): reason is UnifiedWalletRiskReason => reason !== null);
  const assetContinuationFloorScore = maxScore(assetContinuationReasons.map((reason) => reason.score));

  const floorScore = maxScore([
    hardEvidenceFloor,
    policyFloor,
    assetContinuationFloorScore,
    patternFloor
  ]);

  const dampenerReason = rawDampener(input);
  const dampener = allowedDampener({
    raw: dampenerReason.score,
    contextScore: weightedLayerScore,
    floorScore
  });
  const contextScore = clampScore(weightedLayerScore - dampener);
  const coverageAdjustedContextScore = coverage === "limited" ? Math.max(contextScore, 30) : contextScore;
  const finalBeforeHardCap = maxScore([coverageAdjustedContextScore, floorScore]);
  const finalScore = hardEvidenceFloor === 0 ? Math.min(finalBeforeHardCap, 84) : finalBeforeHardCap;
```

Change `allowedDampener` to only dampen the weighted context:

```ts
function allowedDampener(input: {
  raw: number;
  contextScore: number;
  floorScore: number;
}): number {
  if (input.raw <= 0) return 0;
  if (input.contextScore <= input.floorScore) return 0;
  return Math.min(input.raw, Math.max(0, input.contextScore - input.floorScore), 25);
}
```

Keep `coverageFloor(coverage)` in `patternReasons` for v1 compatibility unless the implementation separates it into a dedicated `coverageFloorScore`.

- [ ] **Step 6: Include new reasons and return fields**

```ts
  const reasons = [
    ...hardReasons,
    ...policyReasons,
    ...assetContinuationReasons,
    ...patternReasons,
    ...(dampener > 0 ? [{ ...dampenerReason, score: dampener }] : [])
  ].sort((a, b) => b.score - a.score);

  return {
    finalScore,
    finalLevel: levelFromScore(finalScore),
    finalDecision,
    weightedLayerScore,
    contextScore: coverageAdjustedContextScore,
    hardEvidenceFloor,
    policyFloor,
    assetContinuationFloor: assetContinuationFloorScore,
    patternFloor,
    dampener,
    coverageLevel: coverage,
    layerBreakdown,
    reasons
  };
```

- [ ] **Step 7: Run scorer tests**

```powershell
npm test -- tests/risk/unifiedWalletRisk.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 8: Commit scorer implementation**

```powershell
git add src/risk/unifiedWalletRisk.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "feat: add unified risk policy and asset floors"
```

---

### Task 4: Add Generic All-Token TRC20 Transfer Lookup

**Files:**

```text
src/tron/tronClient.ts
src/forensics/routeSearch.ts
tests/tron/tronClient.test.ts
```

- [ ] **Step 1: Extend client interfaces**

In `src/tron/tronClient.ts`, add the all-token method to `TronDashboardClient` and `TronApprovalClient` only if the call sites need those interfaces. At minimum, the concrete class must expose:

```ts
  listRelatedTrc20TransfersAllTokens(
    address: string,
    options?: ListRelatedTrc20TransfersOptions
  ): Promise<RawTronscanTrc20Transfer[]>;
```

In `src/forensics/routeSearch.ts`, extend `RouteSearchTronClient`:

```ts
export type RouteSearchTronClient = {
  listRelatedTrc20Transfers(
    address: string,
    options?: { start?: number; limit?: number; minTimestamp?: number; endTimestamp?: number }
  ): Promise<RawTronscanTrc20Transfer[]>;
  listRelatedTrc20TransfersAllTokens?(
    address: string,
    options?: { start?: number; limit?: number; minTimestamp?: number; endTimestamp?: number }
  ): Promise<RawTronscanTrc20Transfer[]>;
};
```

- [ ] **Step 2: Make the URL builder accept optional token scope**

Change `buildTronscanTransferHistoryUrl`:

```ts
  private buildTronscanTransferHistoryUrl(
    address: string,
    direction: TronGridTransferDirection,
    options: ListIncomingTrc20TransfersOptions | ListRelatedTrc20TransfersOptions,
    tokenContractAddress: string | null = TRON_USDT_CONTRACT_ADDRESS
  ): URL {
    const url = new URL("/api/token_trc20/transfers", this.baseUrl);
    if (direction === "incoming") {
      url.searchParams.set("toAddress", address);
    } else {
      url.searchParams.set("relatedAddress", address);
    }
    if (tokenContractAddress) {
      url.searchParams.set("contract_address", tokenContractAddress);
    }
    ...
  }
```

Keep `listIncomingTrc20Transfers` and `listRelatedTrc20Transfers` unchanged from the caller perspective; both continue passing the default USDT scope.

- [ ] **Step 3: Add the all-token method**

```ts
  async listRelatedTrc20TransfersAllTokens(
    address: string,
    options: ListRelatedTrc20TransfersOptions = {}
  ): Promise<RawTronscanTrc20Transfer[]> {
    const url = this.buildTronscanTransferHistoryUrl(address, "related", options, null);

    return this.fetchTransferArrayWithFallback(url, {
      address,
      direction: "related",
      options
    });
  }
```

- [ ] **Step 4: Add tests**

In `tests/tron/tronClient.test.ts`, add a test that proves the new method does not set `contract_address`:

```ts
it("lists related TRC20 transfers across all tokens without the USDT contract filter", async () => {
  const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
    const requestUrl = url instanceof URL ? url : new URL(String(url));
    expect(requestUrl.pathname).toBe("/api/token_trc20/transfers");
    expect(requestUrl.searchParams.get("relatedAddress")).toBe("TSubject111111111111111111111111111111");
    expect(requestUrl.searchParams.has("contract_address")).toBe(false);
    return jsonResponse({
      token_transfers: [
        {
          transaction_id: "tx-all-token",
          from_address: "TSubject111111111111111111111111111111",
          to_address: "TDestination11111111111111111111111111",
          quant: "100",
          contract_address: "TWrappedToken1111111111111111111111",
          confirmed: true,
          contractRet: "SUCCESS",
          block_ts: 1770000000000,
          tokenInfo: {
            tokenAbbr: "WRAPPED",
            tokenDecimal: 6,
            tokenId: "TWrappedToken1111111111111111111111",
            tokenType: "trc20"
          }
        }
      ]
    });
  });
  const client = new TronscanClient({
    baseUrl: "https://apilist.tronscanapi.com",
    fetchFn,
    retryAttempts: 0
  });

  const transfers = await client.listRelatedTrc20TransfersAllTokens("TSubject111111111111111111111111111111", {
    start: 0,
    limit: 25
  });

  expect(transfers.map((transfer) => transfer.transaction_id)).toEqual(["tx-all-token"]);
});
```

Add a companion test proving the old USDT method still sets `contract_address`. Existing tests already assert this at `tests/tron/tronClient.test.ts:45`, `tests/tron/tronClient.test.ts:114`, and `tests/tron/tronClient.test.ts:533`; do not weaken them.

- [ ] **Step 5: Run Tron client tests**

```powershell
npm test -- tests/tron/tronClient.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 6: Commit client API**

```powershell
git add src/tron/tronClient.ts src/forensics/routeSearch.ts tests/tron/tronClient.test.ts
git commit -m "feat: add all-token tron transfer lookup"
```

---

### Task 5: Implement Generic TRC20 Asset Continuation Detector

**Files:**

```text
src/parser/transactionParser.ts
src/forensics/assetContinuation.ts
tests/forensics/assetContinuation.test.ts
```

- [ ] **Step 1: Expand raw transfer type for provider risk metadata**

Extend `RawTronscanTrc20Transfer` without making existing fields stricter:

```ts
export type RawTronscanTrc20Transfer = {
  transaction_id: string;
  from_address: string;
  to_address: string;
  quant: string;
  contract_address?: string;
  confirmed?: boolean;
  contractRet?: string;
  finalResult?: string;
  revert?: boolean;
  status?: number | string;
  riskTransaction?: boolean;
  fromAddressIsContract?: boolean;
  toAddressIsContract?: boolean;
  tokenInfo?: {
    tokenAbbr?: string;
    tokenDecimal?: number;
    tokenId?: string;
    tokenName?: string;
    tokenType?: string;
  };
  trigger_info?: unknown;
  block_ts: number;
};
```

- [ ] **Step 2: Add detector tests first**

Create `tests/forensics/assetContinuation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import { buildAssetContinuationProfiles } from "../../src/forensics/assetContinuation";

const subjectAddress = "TSubject111111111111111111111111111111";
const protocolAddress = "TProtocol111111111111111111111111111";
const wrappedToken = "TWrappedToken1111111111111111111111";
const riskyDestination = "TRiskyDestination1111111111111111111";

function transfer(overrides: Partial<RawTronscanTrc20Transfer>): RawTronscanTrc20Transfer {
  return {
    transaction_id: "tx",
    from_address: "TFrom111111111111111111111111111111",
    to_address: "TTo11111111111111111111111111111111",
    quant: "1000000",
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    block_ts: 1770000000000,
    tokenInfo: {
      tokenAbbr: "USDT",
      tokenDecimal: 6,
      tokenId: TRON_USDT_CONTRACT_ADDRESS,
      tokenType: "trc20"
    },
    ...overrides
  };
}

describe("buildAssetContinuationProfiles", () => {
  it("detects a generic verified token continuation after USDT conversion", async () => {
    const profiles = await buildAssetContinuationProfiles({
      subjectAddress,
      usdtTransfers: [
        transfer({
          transaction_id: "tx-usdt-out",
          from_address: subjectAddress,
          to_address: protocolAddress,
          quant: "101607508600",
          block_ts: 1770000000000
        })
      ],
      allTokenTransfers: [
        transfer({
          transaction_id: "tx-token-in",
          from_address: protocolAddress,
          to_address: subjectAddress,
          quant: "101607508600",
          contract_address: wrappedToken,
          block_ts: 1770000003000,
          tokenInfo: {
            tokenAbbr: "WRAPPED",
            tokenDecimal: 6,
            tokenId: wrappedToken,
            tokenName: "Wrapped Protocol Token",
            tokenType: "trc20"
          }
        }),
        transfer({
          transaction_id: "tx-token-out",
          from_address: subjectAddress,
          to_address: riskyDestination,
          quant: "101607508600",
          contract_address: wrappedToken,
          block_ts: 1770000010000,
          riskTransaction: true,
          tokenInfo: {
            tokenAbbr: "WRAPPED",
            tokenDecimal: 6,
            tokenId: wrappedToken,
            tokenName: "Wrapped Protocol Token",
            tokenType: "trc20"
          }
        })
      ],
      getLabelsForAddress: async () => []
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      sourceAsset: "USDT",
      continuationAssetSymbol: "WRAPPED",
      continuationTokenContract: wrappedToken,
      conversionTxHash: "tx-token-in",
      outgoingTxHash: "tx-token-out",
      protocolAddress,
      destinationAddress: riskyDestination,
      destinationRisk: "provider_risk",
      tokenQuality: "verified",
      evidenceClass: "asset_continuation"
    });
    expect(profiles[0]?.score).toBeGreaterThanOrEqual(80);
    expect(profiles[0]?.score).toBeLessThanOrEqual(84);
  });

  it("downgrades unknown token metadata below a high floor", async () => {
    const profiles = await buildAssetContinuationProfiles({
      subjectAddress,
      usdtTransfers: [
        transfer({
          transaction_id: "tx-usdt-out",
          from_address: subjectAddress,
          to_address: protocolAddress,
          block_ts: 1770000000000
        })
      ],
      allTokenTransfers: [
        transfer({
          transaction_id: "tx-token-in",
          from_address: protocolAddress,
          to_address: subjectAddress,
          contract_address: "TUnknownToken111111111111111111111",
          block_ts: 1770000001000,
          tokenInfo: undefined
        }),
        transfer({
          transaction_id: "tx-token-out",
          from_address: subjectAddress,
          to_address: riskyDestination,
          contract_address: "TUnknownToken111111111111111111111",
          riskTransaction: true,
          block_ts: 1770000002000,
          tokenInfo: undefined
        })
      ],
      getLabelsForAddress: async () => []
    });

    expect(profiles[0]?.tokenQuality).toBe("unknown");
    expect(profiles[0]?.score ?? 0).toBeLessThan(65);
  });

  it("marks internally labeled destinations stronger than service boundary context", async () => {
    const profiles = await buildAssetContinuationProfiles({
      subjectAddress,
      usdtTransfers: [
        transfer({
          transaction_id: "tx-usdt-out",
          from_address: subjectAddress,
          to_address: protocolAddress,
          block_ts: 1770000000000
        })
      ],
      allTokenTransfers: [
        transfer({
          transaction_id: "tx-token-in",
          from_address: protocolAddress,
          to_address: subjectAddress,
          contract_address: wrappedToken,
          block_ts: 1770000001000,
          tokenInfo: {
            tokenAbbr: "WRAPPED",
            tokenDecimal: 6,
            tokenId: wrappedToken,
            tokenName: "Wrapped Protocol Token",
            tokenType: "trc20"
          }
        }),
        transfer({
          transaction_id: "tx-token-out",
          from_address: subjectAddress,
          to_address: riskyDestination,
          contract_address: wrappedToken,
          block_ts: 1770000002000,
          tokenInfo: {
            tokenAbbr: "WRAPPED",
            tokenDecimal: 6,
            tokenId: wrappedToken,
            tokenName: "Wrapped Protocol Token",
            tokenType: "trc20"
          }
        })
      ],
      getLabelsForAddress: async (address) =>
        address === riskyDestination
          ? [{ address, label: "reported_scam", source: "service_admin", createdByTelegramId: null, createdAt: new Date("2026-06-05T00:00:00.000Z") }]
          : []
    });

    expect(profiles[0]?.destinationRisk).toBe("internal_label");
    expect(profiles[0]?.score).toBeGreaterThanOrEqual(82);
  });
});
```

- [ ] **Step 3: Implement `src/forensics/assetContinuation.ts`**

```ts
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../parser/transactionParser";
import type { AddressLabel, AssetContinuationDestinationRisk, AssetContinuationProfile, AssetContinuationTokenQuality } from "../types";

type BuildAssetContinuationProfilesInput = {
  subjectAddress: string;
  usdtTransfers: RawTronscanTrc20Transfer[];
  allTokenTransfers: RawTronscanTrc20Transfer[];
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
};

const HIGH_RISK_LABELS = new Set<AddressLabel["label"]>([
  "scam",
  "reported_scam",
  "stolen_funds",
  "phishing",
  "mixer_like",
  "risky_contract",
  "darknet_exchange"
]);

const SAME_EPISODE_WINDOW_MS = 10 * 60 * 1000;

function isSuccessfulTransfer(transfer: RawTronscanTrc20Transfer): boolean {
  if (transfer.confirmed !== true) return false;
  if (transfer.revert === true) return false;
  if (transfer.contractRet && transfer.contractRet !== "SUCCESS") return false;
  if (transfer.finalResult && transfer.finalResult !== "SUCCESS") return false;
  if (transfer.status !== undefined && transfer.status !== 0 && transfer.status !== "0" && transfer.status !== "SUCCESS") return false;
  return true;
}

function tokenContract(transfer: RawTronscanTrc20Transfer): string | null {
  return transfer.contract_address ?? transfer.tokenInfo?.tokenId ?? null;
}

function isUsdt(transfer: RawTronscanTrc20Transfer): boolean {
  return tokenContract(transfer) === TRON_USDT_CONTRACT_ADDRESS;
}

function tokenQuality(transfer: RawTronscanTrc20Transfer): AssetContinuationTokenQuality {
  const info = transfer.tokenInfo;
  const contract = tokenContract(transfer);
  if (!info || !contract) return "unknown";
  const type = typeof info.tokenType === "string" ? info.tokenType.toLowerCase() : "";
  const symbol = typeof info.tokenAbbr === "string" ? info.tokenAbbr.trim() : "";
  const name = typeof info.tokenName === "string" ? info.tokenName.trim() : "";
  if (type !== "" && type !== "trc20") return "unknown";
  if (symbol && name) return "verified";
  if (symbol) return "known";
  return "unknown";
}

function tokenSymbol(transfer: RawTronscanTrc20Transfer): string {
  return transfer.tokenInfo?.tokenAbbr?.trim() || tokenContract(transfer) || "TRC20";
}

function timestamp(transfer: RawTronscanTrc20Transfer): number | null {
  return Number.isFinite(transfer.block_ts) ? transfer.block_ts : null;
}

function scoreProfile(input: {
  destinationRisk: AssetContinuationDestinationRisk;
  tokenQuality: AssetContinuationTokenQuality;
  elapsedMs: number | null;
  sourceAmountRaw: string | null;
}): number {
  if (input.tokenQuality === "unknown") return 40;
  let score = input.tokenQuality === "verified" ? 65 : 60;
  if (input.elapsedMs !== null && input.elapsedMs <= 60_000) score += 5;
  if (input.sourceAmountRaw && /^\d+$/.test(input.sourceAmountRaw) && BigInt(input.sourceAmountRaw) >= 100_000_000_000n) {
    score += 5;
  }
  if (input.destinationRisk === "service_boundary") score += 5;
  if (input.destinationRisk === "provider_risk") score += 15;
  if (input.destinationRisk === "internal_label") score += 17;
  return Math.max(0, Math.min(84, score));
}

async function destinationRisk(
  address: string | null,
  transfer: RawTronscanTrc20Transfer,
  getLabelsForAddress: (address: string) => Promise<AddressLabel[]>
): Promise<AssetContinuationDestinationRisk> {
  if (!address) return "unknown";
  const labels = await getLabelsForAddress(address).catch(() => []);
  if (labels.some((label) => HIGH_RISK_LABELS.has(label.label))) return "internal_label";
  if (transfer.riskTransaction === true) return "provider_risk";
  if (transfer.toAddressIsContract === true) return "service_boundary";
  return "unknown";
}

export async function buildAssetContinuationProfiles(
  input: BuildAssetContinuationProfilesInput
): Promise<AssetContinuationProfile[]> {
  const usdtOut = input.usdtTransfers
    .filter((transfer) => isSuccessfulTransfer(transfer) && isUsdt(transfer) && transfer.from_address === input.subjectAddress)
    .filter((transfer) => typeof transfer.to_address === "string");

  const nonUsdt = input.allTokenTransfers
    .filter((transfer) => isSuccessfulTransfer(transfer) && !isUsdt(transfer))
    .filter((transfer) => tokenContract(transfer) !== null);

  const profiles: AssetContinuationProfile[] = [];
  for (const anchor of usdtOut) {
    const anchorTime = timestamp(anchor);
    if (anchorTime === null) continue;

    const inbound = nonUsdt
      .filter((transfer) =>
        transfer.to_address === input.subjectAddress &&
        Math.abs((timestamp(transfer) ?? 0) - anchorTime) <= SAME_EPISODE_WINDOW_MS
      )
      .sort((left, right) => Math.abs((timestamp(left) ?? 0) - anchorTime) - Math.abs((timestamp(right) ?? 0) - anchorTime))[0] ?? null;
    if (!inbound) continue;

    const contract = tokenContract(inbound);
    if (!contract) continue;

    const inboundTime = timestamp(inbound);
    const outbound = nonUsdt
      .filter((transfer) =>
        transfer.from_address === input.subjectAddress &&
        tokenContract(transfer) === contract &&
        (inboundTime === null || (timestamp(transfer) ?? 0) >= inboundTime)
      )
      .sort((left, right) => (timestamp(left) ?? 0) - (timestamp(right) ?? 0))[0] ?? null;

    const outboundTime = outbound ? timestamp(outbound) : null;
    const elapsedMs = inboundTime !== null && outboundTime !== null ? outboundTime - inboundTime : null;
    const risk = await destinationRisk(outbound?.to_address ?? null, outbound ?? inbound, input.getLabelsForAddress);
    const quality = tokenQuality(inbound);
    const score = scoreProfile({
      destinationRisk: risk,
      tokenQuality: quality,
      elapsedMs,
      sourceAmountRaw: anchor.quant
    });

    profiles.push({
      subjectAddress: input.subjectAddress,
      sourceAsset: "USDT",
      continuationAssetSymbol: tokenSymbol(inbound),
      continuationTokenContract: contract,
      conversionTxHash: inbound.transaction_id,
      outgoingTxHash: outbound?.transaction_id ?? null,
      protocolAddress: anchor.to_address ?? inbound.from_address ?? null,
      destinationAddress: outbound?.to_address ?? null,
      destinationRisk: risk,
      elapsedMs,
      sourceAmountRaw: anchor.quant,
      continuationAmountRaw: outbound?.quant ?? inbound.quant ?? null,
      tokenQuality: quality,
      score,
      evidenceClass: "asset_continuation",
      reasons: [
        `USDT movement continued as ${tokenSymbol(inbound)}${risk === "unknown" ? "" : ` toward ${risk} destination`}.`
      ]
    });
  }

  return profiles.sort((left, right) => right.score - left.score).slice(0, 5);
}
```

- [ ] **Step 4: Run detector tests**

```powershell
npm test -- tests/forensics/assetContinuation.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 5: Commit detector**

```powershell
git add src/parser/transactionParser.ts src/forensics/assetContinuation.ts tests/forensics/assetContinuation.test.ts
git commit -m "feat: detect generic tron asset continuation"
```

---

### Task 6: Wire Asset Continuation Into Deep Research

**Files:**

```text
src/check/deepForensicCheck.ts
tests/check/deepForensicCheck.test.ts
```

- [ ] **Step 1: Import the detector**

```ts
import { buildAssetContinuationProfiles } from "../forensics/assetContinuation";
```

- [ ] **Step 2: Add an input limit**

Add to `RunDeepAddressForensicCheckInput`:

```ts
  assetContinuationTransferLimit?: number;
```

Use a bounded default:

```ts
const DEFAULT_ASSET_CONTINUATION_TRANSFER_LIMIT = 100;
```

- [ ] **Step 3: Fetch all-token transfers only for the subject address**

In `runDeepAddressForensicCheck`, after `sourceTransfers` is loaded and before evidence arrays are assembled, add:

```ts
  const allTokenTransfers = deps.tronClient.listRelatedTrc20TransfersAllTokens
    ? await deps.tronClient.listRelatedTrc20TransfersAllTokens(input.sourceAddress, {
      start: 0,
      limit: input.assetContinuationTransferLimit ?? DEFAULT_ASSET_CONTINUATION_TRANSFER_LIMIT,
      minTimestamp: input.windowStart.getTime(),
      endTimestamp: input.windowEnd.getTime()
    }).catch(() => [])
    : [];

  const assetContinuationProfiles = allTokenTransfers.length > 0
    ? await buildAssetContinuationProfiles({
      subjectAddress: input.sourceAddress,
      usdtTransfers: allTokenTransfers,
      allTokenTransfers,
      getLabelsForAddress: deps.getLabelsForAddress
    })
    : [];
```

Reason: all-token transfer history includes USDT and non-USDT rows when no `contract_address` filter is applied. This keeps the detector bounded to one subject-address lookup.

- [ ] **Step 4: Add raw evidence and observation helpers**

Add helper functions near other raw evidence helpers:

```ts
function rawEvidenceForAssetContinuation(input: {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profile: AssetContinuationProfile;
}): RawEvidenceInput {
  return {
    id: stableId([
      "forensic_asset_continuation_raw",
      input.subjectAddress,
      input.profile.conversionTxHash,
      input.profile.outgoingTxHash,
      input.windowStart.toISOString(),
      input.windowEnd.toISOString()
    ]),
    source: "tronscan_all_token_transfer_history",
    sourceType: "detector_output",
    chain: "tron",
    address: input.subjectAddress,
    txHash: input.profile.conversionTxHash,
    observedTransactionHash: input.profile.outgoingTxHash,
    evidenceJson: {
      assetContinuationProfile: input.profile,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString()
    }
  };
}

function observationForAssetContinuation(input: {
  subjectAddress: string;
  profile: AssetContinuationProfile;
  rawEvidenceId: string;
}): RiskSignalObservationInput | null {
  if (input.profile.score < 65) return null;
  return {
    id: stableId([
      "forensic_asset_continuation_observation",
      input.subjectAddress,
      input.profile.conversionTxHash,
      input.profile.outgoingTxHash,
      FORENSIC_ROUTE_POLICY_VERSION
    ]),
    subjectChain: "tron",
    subjectAddress: input.subjectAddress,
    subjectTxHash: input.profile.conversionTxHash,
    observedTransactionHash: input.profile.outgoingTxHash,
    signalGroup: "incoming_context",
    code: "forensic_asset_continuation",
    message: "USDT movement continued through another verified TRC20 asset.",
    scoreImpact: input.profile.score,
    confidence: input.profile.tokenQuality === "verified" ? "high" : "medium",
    severity: input.profile.score >= 80 ? "high" : "medium",
    source: "asset_continuation",
    policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
    rawEvidenceId: input.rawEvidenceId
  };
}
```

- [ ] **Step 5: Persist profile, evidence, and observations**

Before `missingChecks`, add:

```ts
  const assetContinuationEvidence = assetContinuationProfiles
    .filter((profile) => profile.score >= 65)
    .map((profile) => rawEvidenceForAssetContinuation({
      subjectAddress: input.sourceAddress,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      profile
    }));

  const assetContinuationObservations = assetContinuationEvidence
    .map((evidence, index) => observationForAssetContinuation({
      subjectAddress: input.sourceAddress,
      profile: assetContinuationProfiles.filter((profile) => profile.score >= 65)[index],
      rawEvidenceId: evidence.id
    }))
    .filter((observation): observation is RiskSignalObservationInput => observation !== null);
```

Add these arrays to the returned report:

```ts
    rawEvidence: [
      ...exposureReport.rawEvidence,
      inboundEvidence,
      ...counterpartyEvidence,
      ...directCounterpartyInteractionEvidence,
      ...assetContinuationEvidence,
      ...
    ],
    observations: [
      ...exposureReport.observations,
      ...(inboundObservation ? [inboundObservation] : []),
      ...counterpartyObservations,
      ...directCounterpartyInteractionObservations,
      ...assetContinuationObservations,
      ...
    ],
    assetContinuationProfiles,
```

- [ ] **Step 6: Add Deep test**

In `tests/check/deepForensicCheck.test.ts`, add a test with a fake `tronClient` that implements both:

```ts
listRelatedTrc20Transfers(address, options)
listRelatedTrc20TransfersAllTokens(address, options)
```

Assert:

```ts
expect(report.assetContinuationProfiles?.[0]).toMatchObject({
  destinationRisk: "provider_risk",
  tokenQuality: "verified",
  evidenceClass: "asset_continuation"
});
expect(report.observations.map((item) => item.code)).toContain("forensic_asset_continuation");
```

Use the same transfer rows from `tests/forensics/assetContinuation.test.ts` so the Deep test proves wiring, not detector math.

- [ ] **Step 7: Run Deep tests**

```powershell
npm test -- tests/check/deepForensicCheck.test.ts tests/forensics/assetContinuation.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 8: Commit Deep wiring**

```powershell
git add src/check/deepForensicCheck.ts tests/check/deepForensicCheck.test.ts
git commit -m "feat: wire asset continuation into deep research"
```

---

### Task 7: Preserve Asset Continuation From Stored Jobs

**Files:**

```text
src/bot/createBot.ts
tests/bot/createBot.test.ts
```

- [ ] **Step 1: Update `extractDeepForensicReportFromJob`**

In `src/bot/createBot.ts`, where the Deep job result is reconstructed from `job.resultJson`, add:

```ts
    assetContinuationProfiles: optionalArrayField(job.resultJson, "assetContinuationProfiles") as DeepAddressForensicReport["assetContinuationProfiles"],
```

Place it next to the other Deep profile arrays.

- [ ] **Step 2: Add bot extraction test**

In `tests/bot/createBot.test.ts`, add or extend a persisted Deep report extraction test so `assetContinuationProfiles` survives:

```ts
expect(extracted?.assetContinuationProfiles?.[0]).toMatchObject({
  evidenceClass: "asset_continuation",
  score: 82
});
```

- [ ] **Step 3: Run targeted bot test**

```powershell
npm test -- tests/bot/createBot.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 4: Commit persisted-job extraction**

```powershell
git add src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: preserve asset continuation in deep job reports"
```

---

### Task 8: Update Telegram Final Score Breakdown

**Files:**

```text
src/bot/createBot.ts
tests/bot/createBot.test.ts
```

- [ ] **Step 1: Add labels for new reason sources**

Update `unifiedRiskReasonSourceLabel`:

```ts
    policy_floor: { en: "Policy floor", ru: "Порог политики" },
    asset_continuation: { en: "Asset continuation", ru: "Продолжение актива" },
```

Keep the existing English and Russian structure.

- [ ] **Step 2: Add new breakdown lines**

Update `unifiedRiskBreakdownLines` to include:

```ts
    locale === "en"
      ? `Context score after dampener: ${result.contextScore}.`
      : `Контекстная оценка после снижения: ${result.contextScore}.`,
    locale === "en"
      ? `Policy floor: ${result.policyFloor}.`
      : `Порог политики: ${result.policyFloor}.`,
    locale === "en"
      ? `Asset continuation floor: ${result.assetContinuationFloor}.`
      : `Порог продолжения актива: ${result.assetContinuationFloor}.`,
```

Recommended order:

```text
Fast layer
Deep layer
Where layer
Context score after dampener
Hard evidence floor
Policy floor
Asset continuation floor
Pattern floor
Dampener
Coverage
```

- [ ] **Step 3: Add report test**

Add a final report test where:

```text
Fast: 0
Deep assetContinuationProfiles: score 82
Where: exchange_policy_decline score 70
```

Assert the English report contains:

```ts
expect(text).toContain("Policy floor: 70");
expect(text).toContain("Asset continuation floor: 82");
expect(text).toContain("Context score after dampener");
expect(text).toContain("Final risk");
expect(text).toContain("82");
```

- [ ] **Step 4: Run bot tests**

```powershell
npm test -- tests/bot/createBot.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 5: Commit report updates**

```powershell
git add src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: show unified risk policy floors in report"
```

---

### Task 9: Update Documentation And Case Notes

**Files:**

```text
docs/project-walkthrough/01-address-check-fast-check.md
```

- [ ] **Step 1: Add v1.1 scoring subsection**

Add a subsection near the existing unified-score notes:

```md
### Unified score v1.1: weighted baseline plus floors

The final score is still one score for the wallet. It is not three separate review scores.

The weighted layer score is now treated as a baseline:

```text
Fast Check * 10%
Deep Research * 60%
Where Is Money * 30%
```

Then the system checks whether any evidence class must anchor the final score:

```text
hardEvidenceFloor
policyFloor
assetContinuationFloor
patternFloor
coverageFloor
```

The final score is:

```text
max(weighted context score after dampener, strongest floor)
```

If there is no hard evidence, the final score is capped at `84`, so policy and continuation evidence can make the wallet `HIGH` but not `CRITICAL`.
```

- [ ] **Step 2: Add the TYs4-style example**

```md
### Example: TYs4-style asset continuation

In the observed case, the old weighted formula produced:

```text
Fast: 0
Deep: 45
Where: 70
Weighted final: 48
Decision: DECLINE
```

The problem was that Where found source-policy decline, but the weighted formula diluted it.

v1.1 keeps the weighted score, but also applies floors:

```text
weightedLayerScore: 48
policyFloor: 70
assetContinuationFloor: 80-84 if the all-token detector confirms verified continuation to a provider-risk destination
hardEvidenceFloor: 0
finalScore: 80-84
finalLevel: HIGH
finalDecision: DECLINE
```

The continuation detector is generic. It does not look only for `jUSDT`. It looks for:

```text
USDT movement -> verified TRC20 token movement -> outgoing continuation to risky destination
```
```

- [ ] **Step 3: Add the limits note**

```md
### Production limit note

For v1.1, asset continuation uses a bounded all-token lookup:

```text
subject address only
latest or window-scoped TRC20 transfers
default limit: 100 transfers
no broad all-token graph expansion
```

This keeps Deep Research heavier than Fast Check, but prevents v1.1 from becoming a full multi-token graph engine.
```

- [ ] **Step 4: Run docs sanity checks**

```powershell
$unresolvedMarkers = @("TO" + "DO", "T" + "BD", "place" + "holder")
rg -n ($unresolvedMarkers -join "|") docs\\project-walkthrough\\01-address-check-fast-check.md
```

Expected:

```text
no output
```

- [ ] **Step 5: Commit docs**

```powershell
git add docs/project-walkthrough/01-address-check-fast-check.md
git commit -m "docs: explain unified risk policy floors v1.1"
```

---

### Task 10: Full Verification

**Files:** all touched files.

- [ ] **Step 1: Run targeted tests**

```powershell
npm test -- tests/risk/unifiedWalletRisk.test.ts tests/forensics/assetContinuation.test.ts tests/check/deepForensicCheck.test.ts tests/tron/tronClient.test.ts tests/bot/createBot.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 2: Run typecheck**

```powershell
npm run typecheck
```

Expected:

```text
PASS
```

- [ ] **Step 3: Run full test suite**

```powershell
npm test
```

Expected:

```text
PASS
```

- [ ] **Step 4: Check formatting and whitespace**

```powershell
git diff --check
```

Expected:

```text
no output
```

- [ ] **Step 5: Review the final diff**

```powershell
git diff --stat HEAD
git diff HEAD -- src/risk/unifiedWalletRisk.ts src/forensics/assetContinuation.ts src/check/deepForensicCheck.ts src/tron/tronClient.ts src/bot/createBot.ts
```

Confirm:

```text
The scorer returns one final score.
Hard evidence still produces CRITICAL when exact.
Policy evidence produces HIGH but not CRITICAL by itself.
Asset continuation produces HIGH but not CRITICAL by itself.
Service-boundary-only context still stays contextual.
Dampener only affects weighted context, not evidence floors.
```

- [ ] **Step 6: Commit final verification fixes if any**

If verification requires small fixes:

```powershell
git add <changed-files>
git commit -m "fix: stabilize unified risk policy floors"
```

If no fixes are required, do not create an empty commit.

---

## Rollback Plan

If production behavior is wrong after deployment:

1. Disable `assetContinuationFloor` in `calculateUnifiedWalletRisk` by returning `null` from `assetContinuationFloor(...)`.
2. Keep `policyFloor` active if tests still pass, because it only uses existing Where source-policy evidence.
3. If any all-token lookup creates provider pressure, make `assetContinuationTransferLimit` default to `0` in the Deep job runner while leaving code and tests in place.
4. Re-run:

```powershell
npm test -- tests/risk/unifiedWalletRisk.test.ts tests/check/deepForensicCheck.test.ts tests/bot/createBot.test.ts
npm run typecheck
```

## Self-Review Checklist

- [ ] The plan preserves the product rule: one wallet, one score, one level, one decision.
- [ ] The plan does not hard-code `jUSDT`; the detector works with any TRC20 token that passes quality checks.
- [ ] The plan keeps service-boundary context out of `policyFloor`.
- [ ] The plan keeps no-hard-evidence cases capped at `84`.
- [ ] The plan includes failing tests before implementation.
- [ ] The plan includes exact files and concrete snippets for every code-changing task.
- [ ] The plan includes targeted tests, typecheck, full test suite, and `git diff --check`.
- [ ] Unresolved-marker scan is documented without leaving unresolved-marker text in task bodies.
