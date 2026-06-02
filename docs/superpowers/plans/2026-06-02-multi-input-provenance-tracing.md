# Multi-Input Provenance Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `where_is_money` provenance tracing bundle-aware, scope-aware, and explicit about amount usage, stop reasons, cross-chain triggers, terminal enrichment, and admin graph weights.

**Architecture:** Extend the existing forensic types and orchestration in place. Keep the current low-balance anchor behavior, add drain-episode context beside it, and add bundle-aware tracing inside `moneyOriginTrace` without replacing the full policy engine. Treat UI/admin graph changes as presentation of richer report fields, not as new scoring policy.

**Tech Stack:** TypeScript, Vitest, existing TRON USDT forensic modules, existing admin graph projection, existing cross-chain corridor trigger/evaluation modules.

---

## Scope Check

The spec touches several areas, but they are all part of the same provenance-check workflow:

- selection scope and amount semantics;
- backward money-origin tracing;
- stop-reason taxonomy and history coverage;
- drain episode context;
- cross-layer and cross-chain trigger summaries;
- terminal boundary enrichment;
- admin graph projection.

This can be one plan because each task is independently testable and lands a coherent slice. Do not change final risk policy in this plan; service exposure direct risk remains a later policy decision.

## File Structure

Modify:

- `src/types.ts` - shared report types for amount usage, trace bundles, history coverage, drain episode, layer summary, stop reasons, cross-chain trigger reasons.
- `src/forensics/provenanceTracingConfig.ts` - new configurable defaults for bundle threshold, max funders, cross-chain bridge thresholds, drain episode window.
- `src/forensics/recentFlowProvenanceSelection.ts` - amount usage fields on selected transfers and optional drain episode selection.
- `src/forensics/incomingDepositCashflow.ts` - reusable bundle builder helpers for tracing.
- `src/forensics/moneyOriginTrace.ts` - bundle-aware deep tracing and precise stop reasons.
- `src/check/whereIsMoneyCheck.ts` - pass coverage helpers into tracing, attach drain episode, layer summary, terminal enrichment candidates, and cross-chain trigger context.
- `src/forensics/crossChainStage2Triggers.ts` - trigger from drain/deep bridge exposure using configurable defaults.
- `src/forensics/contractLlmVerdict.ts` - include high-share terminal boundary candidates in contract case files.
- `src/admin/forensicsGraph.ts` - expose amount usage, bundle members, legacy stop labels, and typed weights.
- `src/admin/adminConsole.ts` - render amount labels and weight labels from graph metadata.

Tests:

- `tests/forensics/provenanceTracingConfig.test.ts`
- `tests/forensics/recentFlowProvenanceSelection.test.ts`
- `tests/forensics/incomingDepositCashflow.test.ts`
- `tests/forensics/moneyOriginTrace.test.ts`
- `tests/forensics/drainEpisode.test.ts`
- `tests/check/whereIsMoneyCheck.test.ts`
- `tests/forensics/crossChainStage2Triggers.test.ts`
- `tests/forensics/contractLlmVerdict.test.ts`
- `tests/admin/forensicsGraph.test.ts`

---

## Task 1: Shared Types And Configurable Defaults

**Files:**
- Create: `src/forensics/provenanceTracingConfig.ts`
- Modify: `src/types.ts`
- Test: `tests/forensics/provenanceTracingConfig.test.ts`

- [ ] **Step 1: Write the failing config-default test**

Create `tests/forensics/provenanceTracingConfig.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUNDLE_COVERAGE_THRESHOLD,
  DEFAULT_CROSS_CHAIN_BRIDGE_AMOUNT_THRESHOLD_RAW,
  DEFAULT_CROSS_CHAIN_BRIDGE_EPISODE_SHARE_THRESHOLD,
  DEFAULT_DRAIN_EPISODE_WINDOW_MS,
  DEFAULT_MAX_BUNDLE_FUNDERS
} from "../../src/forensics/provenanceTracingConfig";

describe("provenance tracing config", () => {
  it("keeps approved configurable defaults in one place", () => {
    expect(DEFAULT_BUNDLE_COVERAGE_THRESHOLD).toBe(0.8);
    expect(DEFAULT_MAX_BUNDLE_FUNDERS).toBe(3);
    expect(DEFAULT_CROSS_CHAIN_BRIDGE_AMOUNT_THRESHOLD_RAW).toBe("100000000000");
    expect(DEFAULT_CROSS_CHAIN_BRIDGE_EPISODE_SHARE_THRESHOLD).toBe(0.25);
    expect(DEFAULT_DRAIN_EPISODE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
npx vitest run tests/forensics/provenanceTracingConfig.test.ts --configLoader bundle
```

Expected: FAIL because `src/forensics/provenanceTracingConfig.ts` does not exist.

- [ ] **Step 3: Add the config module**

Create `src/forensics/provenanceTracingConfig.ts`:

```ts
const USDT_DECIMALS = 1_000_000n;

export const DEFAULT_BUNDLE_COVERAGE_THRESHOLD = 0.8;
export const DEFAULT_MAX_BUNDLE_FUNDERS = 3;
export const DEFAULT_CROSS_CHAIN_BRIDGE_AMOUNT_THRESHOLD_RAW = (100_000n * USDT_DECIMALS).toString();
export const DEFAULT_CROSS_CHAIN_BRIDGE_EPISODE_SHARE_THRESHOLD = 0.25;
export const DEFAULT_DRAIN_EPISODE_WINDOW_MS = 24 * 60 * 60 * 1000;
```

- [ ] **Step 4: Extend shared types**

Modify `src/types.ts`:

```ts
export type BalanceTransferAmountRole =
  | "anchor"
  | "funding_candidate"
  | "bundle_member"
  | "episode_member";

export type BalanceTransferAmountUsage = {
  anchorAmountRaw: string;
  originalAmountRaw: string;
  usedAmountRaw: string;
  coverageShare: number;
  role: BalanceTransferAmountRole;
};
```

Extend `BalanceFormingTransfer`:

```ts
export type BalanceFormingTransfer = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
  coverageShare: number;
  selectedReason:
    | "covers_current_balance"
    | "covers_requested_amount"
    | "funds_recent_outgoing"
    | "recent_large_inbound";
  amountUsage?: BalanceTransferAmountUsage | null;
};
```

Extend `MoneyOriginStoppedReason`:

```ts
export type MoneyOriginStoppedReason =
  | "allowlist_cex_reached"
  | "decline_boundary_reached"
  | "risky_label_reached"
  | "data_budget_exhausted"
  | "no_previous_transfer"
  | "weak_amount_or_time_continuity"
  | "unlabeled_service_boundary"
  | "no_incoming_transfers_seen"
  | "incoming_history_not_fetched"
  | "incoming_seen_but_below_continuity";
```

Add bundle/history/drain/layer types near `MoneyOriginPathStep`:

```ts
export type MoneyOriginFundingBundleMember = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  originalAmountRaw: string;
  usedAmountRaw: string;
  spentBeforeHopRaw: string;
  timestamp: string;
  coverageShare: number;
};

export type MoneyOriginFundingBundle = {
  hopTxHash: string;
  hopAddress: string;
  expectedAmountRaw: string;
  coveredAmountRaw: string;
  coverageRatio: number;
  members: MoneyOriginFundingBundleMember[];
};

export type MoneyOriginTraceHistoryCoverage = {
  address: string;
  targetTimestamp: string;
  fetchedTransferCount: number;
  oldestFetchedTransferAt: string | null;
  reachedTargetHop: boolean;
  source: "live" | "local_index" | "mixed" | "unknown";
};

export type MoneyOriginDrainEpisode = {
  anchorTxHash: string;
  fundingTxHash?: string;
  fundingAmountRaw?: string;
  fundingTimestamp?: string;
  startTimestamp: string;
  endTimestamp: string;
  episodeOutgoingRaw: string;
  episodeSelectedRaw: string;
  episodeCoverageRatio: number;
  outgoingTxHashes: string[];
  bridgeOutgoingRaw: string;
  bridgeOutgoingShare: number;
};

export type MoneyOriginLayerSummary = {
  fastCheck: {
    riskLevel: string | null;
    score: number | null;
    note: string;
  };
  whereIsMoney: {
    checkedScope: "current_balance" | "requested_amount" | "transaction_seed" | "recent_flow" | "selected_anchor" | "drain_episode";
    note: string;
  };
  deepCheck: {
    serviceExposureRaw: string | null;
    dominantCategory: string | null;
    note: string;
  };
};
```

Extend `MoneyOriginPath`:

```ts
export type MoneyOriginPath = {
  balanceTransferTxHash: string;
  rootSourceAddress: string | null;
  rootSourceType: MoneyOriginRootSourceType;
  balanceShare?: number;
  exposureSourceKey?: string | null;
  exposureSourceLabel?: string | null;
  sourceExposureKind?: SourceExposureKind | null;
  effectiveExposureShare?: number | null;
  linkStrength?: number | null;
  scoreBreakdown?: RiskLayerScore[];
  pathAddresses: string[];
  txHashes: string[];
  steps: MoneyOriginPathStep[];
  amountPreservationRatio: number;
  timeSpanMs: number | null;
  stoppedReason: MoneyOriginStoppedReason;
  verdict: ExchangeDecision;
  riskScoreContribution: number;
  reasons: string[];
  fundingBundles?: MoneyOriginFundingBundle[];
  historyCoverage?: MoneyOriginTraceHistoryCoverage[];
};
```

Extend `WhereIsMoneyCoverage`:

```ts
export type WhereIsMoneyCoverage = {
  selectedInboundTxCount: number;
  currentBalanceRaw?: string | null;
  requestedAmountRaw?: string | null;
  targetAmountRaw?: string;
  selectedAmountRaw?: string;
  coverageRatio?: number;
  selectedInboundVolumeRaw: string;
  currentBalanceCoverageRatio: number;
  provenanceScope?: MoneyOriginProvenanceScope;
  anchorTransfer?: MoneyOriginRecentFlowAnchor | null;
  drainEpisode?: MoneyOriginDrainEpisode | null;
  checkedScope?: "current_balance" | "requested_amount" | "transaction_seed" | "recent_flow" | "selected_anchor" | "drain_episode";
  anchorCoverageRatio?: number | null;
  episodeCoverageRatio?: number | null;
  lowBalanceThresholdRaw?: string | null;
  dataScopeNote?: string | null;
  maxDepth: number;
  fetchedAddressCount: number;
  partial: boolean;
  notes: string[];
};
```

Extend `WhereIsMoneyReport`:

```ts
export type WhereIsMoneyReport = {
  subjectAddress: string;
  currentUsdtBalanceRaw: string | null;
  fastWalletRisk: RiskReport | null;
  balanceFormingTransfers: BalanceFormingTransfer[];
  originPaths: MoneyOriginPath[];
  senderInteractionProfiles: MoneyOriginSenderInteractionProfile[];
  approvalDrainProvenanceProfiles: ApprovalDrainProvenanceProfile[];
  approvalDrainReviewFindings?: ApprovalDrainReviewFinding[];
  contractLlmVerdicts?: ContractLlmVerdictSummary[];
  crossChainCorridor?: CrossChainCorridorReport;
  layerSummary?: MoneyOriginLayerSummary;
  assessment: WhereIsMoneyAssessment;
  decision: ExchangeDecision;
  userDecision: UserExchangeDecision;
  internalDecision: ExchangeDecision;
  proofLevel: ProofLevel;
  policyReasons?: PolicyReason[];
  riskCaseFile?: RiskCaseFile;
  riskScore: number;
  decisionReasons: string[];
  coverage: WhereIsMoneyCoverage;
};
```

Extend `CrossChainStage2TriggerReason`:

```ts
export type CrossChainStage2TriggerReason =
  | "large_single_boundary"
  | "large_split_boundary"
  | "medium_direct_high_risk"
  | "manual_deep_mode"
  | "drain_episode_bridge_exposure"
  | "deep_service_exposure_bridge";
```

- [ ] **Step 5: Run config test and typecheck**

Run:

```powershell
npx vitest run tests/forensics/provenanceTracingConfig.test.ts --configLoader bundle
npm run typecheck
```

Expected: config test PASS. Typecheck may fail if exhaustive switches need new stop reasons; update those switches in the task where the affected code is being changed.

- [ ] **Step 6: Commit**

```powershell
git add src/types.ts src/forensics/provenanceTracingConfig.ts tests/forensics/provenanceTracingConfig.test.ts
git commit -m "feat: add provenance tracing shared types"
```

---

## Task 2: Amount Usage Semantics For Recent-Flow Selection

**Files:**
- Modify: `src/forensics/recentFlowProvenanceSelection.ts`
- Test: `tests/forensics/recentFlowProvenanceSelection.test.ts`

- [ ] **Step 1: Add failing test for original vs used amount**

Add to `tests/forensics/recentFlowProvenanceSelection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectRecentFlowProvenanceTransfers } from "../../src/forensics/recentFlowProvenanceSelection";
import type { ForensicRouteEdge } from "../../src/types";

function edge(input: {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
}): ForensicRouteEdge {
  return {
    id: input.txHash,
    txHash: input.txHash,
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    amountRaw: input.amountRaw,
    timestamp: new Date(input.timestamp),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

describe("recent-flow provenance amount usage", () => {
  it("stores original and used amounts separately for a large funding transfer", () => {
    const selection = selectRecentFlowProvenanceTransfers({
      subjectAddress: "TSubject",
      currentBalanceRaw: "1492633",
      edges: [
        edge({
          txHash: "funding-1",
          fromAddress: "TFunder",
          toAddress: "TSubject",
          amountRaw: "1885262475832",
          timestamp: "2026-05-05T13:31:30.000Z"
        }),
        edge({
          txHash: "anchor-out",
          fromAddress: "TSubject",
          toAddress: "TBridge",
          amountRaw: "135300000000",
          timestamp: "2026-05-05T15:00:30.000Z"
        })
      ]
    });

    expect(selection.targetAmountRaw).toBe("135300000000");
    expect(selection.selectedAmountRaw).toBe("135300000000");
    expect(selection.transfers).toHaveLength(1);
    expect(selection.transfers[0]).toMatchObject({
      amountRaw: "1885262475832",
      amountUsage: {
        anchorAmountRaw: "135300000000",
        originalAmountRaw: "1885262475832",
        usedAmountRaw: "135300000000",
        coverageShare: 1,
        role: "funding_candidate"
      }
    });
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
npx vitest run tests/forensics/recentFlowProvenanceSelection.test.ts --configLoader bundle
```

Expected: FAIL because `amountUsage` is missing.

- [ ] **Step 3: Add amount usage to `transferFromEdge`**

Modify `transferFromEdge` in `src/forensics/recentFlowProvenanceSelection.ts`:

```ts
function transferFromEdge(
  edge: ForensicRouteEdge,
  denominatorRaw: bigint,
  coveredRaw: bigint,
  selectedReason: BalanceFormingTransfer["selectedReason"]
): BalanceFormingTransfer {
  const coverageShare = ratio(coveredRaw, denominatorRaw);
  return {
    txHash: edge.txHash,
    fromAddress: edge.fromAddress,
    toAddress: edge.toAddress,
    amountRaw: edge.amountRaw,
    timestamp: edge.timestamp.toISOString(),
    coverageShare,
    selectedReason,
    amountUsage: {
      anchorAmountRaw: denominatorRaw.toString(),
      originalAmountRaw: edge.amountRaw,
      usedAmountRaw: coveredRaw.toString(),
      coverageShare,
      role: selectedReason === "funds_recent_outgoing" ? "funding_candidate" : "anchor"
    }
  };
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npx vitest run tests/forensics/recentFlowProvenanceSelection.test.ts tests/forensics/balanceFormingTransfers.test.ts --configLoader bundle
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/forensics/recentFlowProvenanceSelection.ts tests/forensics/recentFlowProvenanceSelection.test.ts
git commit -m "feat: expose selected amount usage"
```

---

## Task 3: Reusable Funding Bundle Builder

**Files:**
- Modify: `src/forensics/incomingDepositCashflow.ts`
- Test: `tests/forensics/incomingDepositCashflow.test.ts`

- [ ] **Step 1: Add failing bundle-builder tests**

Add to `tests/forensics/incomingDepositCashflow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildFundingBundleForTraceHop } from "../../src/forensics/incomingDepositCashflow";
import type { ForensicRouteEdge } from "../../src/types";

function edge(input: {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
}): ForensicRouteEdge {
  return {
    id: input.txHash,
    txHash: input.txHash,
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    amountRaw: input.amountRaw,
    timestamp: new Date(input.timestamp),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

describe("trace hop funding bundles", () => {
  it("builds a multi-input bundle by usable contribution", () => {
    const target = edge({
      txHash: "out-850k",
      fromAddress: "TV3H25",
      toAddress: "TNext",
      amountRaw: "850000000000",
      timestamp: "2026-04-21T12:37:30.000Z"
    });

    const bundle = buildFundingBundleForTraceHop({
      target,
      edges: [
        edge({ txHash: "in-85k", fromAddress: "TKHS", toAddress: "TV3H25", amountRaw: "85013000000", timestamp: "2026-04-21T12:16:51.000Z" }),
        edge({ txHash: "in-39k", fromAddress: "TRTr", toAddress: "TV3H25", amountRaw: "39116000000", timestamp: "2026-04-21T12:18:03.000Z" }),
        edge({ txHash: "in-100", fromAddress: "TFyj", toAddress: "TV3H25", amountRaw: "100000000", timestamp: "2026-04-21T12:25:39.000Z" }),
        edge({ txHash: "in-600k", fromAddress: "TF6y", toAddress: "TV3H25", amountRaw: "600000000000", timestamp: "2026-04-21T12:27:48.000Z" }),
        edge({ txHash: "in-80k", fromAddress: "TFyj", toAddress: "TV3H25", amountRaw: "80500000000", timestamp: "2026-04-21T12:33:51.000Z" })
      ],
      minCoverageRatio: 0.8,
      maxFunders: 3
    });

    expect(bundle).not.toBeNull();
    expect(bundle?.coverageRatio).toBeGreaterThanOrEqual(0.8);
    expect(bundle?.members.map((member) => member.txHash)).toEqual(["in-80k", "in-600k", "in-100"]);
    expect(bundle?.funders.map((funder) => funder.address)).toEqual(["TF6y", "TFyj"]);
  });

  it("returns weak coverage with candidates when the bundle is below threshold", () => {
    const target = edge({
      txHash: "out-850k",
      fromAddress: "TV3H25",
      toAddress: "TNext",
      amountRaw: "850000000000",
      timestamp: "2026-04-21T12:37:30.000Z"
    });

    const bundle = buildFundingBundleForTraceHop({
      target,
      edges: [
        edge({ txHash: "in-39k", fromAddress: "TRTr", toAddress: "TV3H25", amountRaw: "39116000000", timestamp: "2026-04-21T12:18:03.000Z" })
      ],
      minCoverageRatio: 0.8,
      maxFunders: 3
    });

    expect(bundle).toMatchObject({
      meetsThreshold: false,
      coveredAmountRaw: "39116000000"
    });
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npx vitest run tests/forensics/incomingDepositCashflow.test.ts --configLoader bundle
```

Expected: FAIL because `buildFundingBundleForTraceHop` is not exported.

- [ ] **Step 3: Add trace bundle types and helper**

Modify `src/forensics/incomingDepositCashflow.ts`:

```ts
export type TraceFundingBundleMember = {
  edge: ForensicRouteEdge;
  usedAmountRaw: string;
  spentBeforeHopRaw: string;
  coverageRatio: number;
};

export type TraceFundingBundleFunder = {
  address: string;
  amountRaw: string;
  txHashes: string[];
};

export type TraceFundingBundle = {
  targetTxHash: string;
  targetAddress: string;
  expectedAmountRaw: string;
  coveredAmountRaw: string;
  coverageRatio: number;
  meetsThreshold: boolean;
  members: TraceFundingBundleMember[];
  funders: TraceFundingBundleFunder[];
};

export function buildFundingBundleForTraceHop(input: {
  target: ForensicRouteEdge;
  edges: ForensicRouteEdge[];
  minCoverageRatio: number;
  maxFunders: number;
}): TraceFundingBundle | null {
  const targetAmount = parseRaw(input.target.amountRaw);
  if (targetAmount <= 0n) return null;

  const candidates = input.edges
    .filter((edge) => edge.txHash !== input.target.txHash)
    .filter((edge) => edge.toAddress === input.target.fromAddress)
    .filter((edge) => edge.timestamp.getTime() < input.target.timestamp.getTime())
    .filter((edge) => parseRaw(edge.amountRaw) > 0n)
    .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime());

  if (candidates.length === 0) return null;

  let remaining = targetAmount;
  const members: TraceFundingBundleMember[] = [];
  for (const edge of candidates) {
    if (remaining <= 0n) break;
    const amount = parseRaw(edge.amountRaw);
    const used = amount > remaining ? remaining : amount;
    members.push({
      edge,
      usedAmountRaw: used.toString(),
      spentBeforeHopRaw: "0",
      coverageRatio: ratio(used, targetAmount)
    });
    remaining -= used;
  }

  const covered = targetAmount - remaining;
  const fundersByAddress = new Map<string, { amountRaw: bigint; txHashes: string[] }>();
  for (const member of members) {
    const current = fundersByAddress.get(member.edge.fromAddress) ?? { amountRaw: 0n, txHashes: [] };
    current.amountRaw += parseRaw(member.usedAmountRaw);
    current.txHashes.push(member.edge.txHash);
    fundersByAddress.set(member.edge.fromAddress, current);
  }

  const funders = [...fundersByAddress.entries()]
    .map(([address, value]) => ({
      address,
      amountRaw: value.amountRaw.toString(),
      txHashes: value.txHashes
    }))
    .sort((left, right) => {
      const leftAmount = parseRaw(left.amountRaw);
      const rightAmount = parseRaw(right.amountRaw);
      if (leftAmount !== rightAmount) return rightAmount > leftAmount ? 1 : -1;
      return left.address.localeCompare(right.address);
    })
    .slice(0, Math.max(0, input.maxFunders));

  const coverageRatio = ratio(covered, targetAmount);
  return {
    targetTxHash: input.target.txHash,
    targetAddress: input.target.fromAddress,
    expectedAmountRaw: targetAmount.toString(),
    coveredAmountRaw: covered.toString(),
    coverageRatio,
    meetsThreshold: coverageRatio >= input.minCoverageRatio,
    members,
    funders
  };
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npx vitest run tests/forensics/incomingDepositCashflow.test.ts --configLoader bundle
npm run typecheck
```

Expected: PASS. If the first test ordering differs because newest-first selects different members, adjust the helper to match the cashflow rule: newest prior inputs are consumed first.

- [ ] **Step 5: Commit**

```powershell
git add src/forensics/incomingDepositCashflow.ts tests/forensics/incomingDepositCashflow.test.ts
git commit -m "feat: build trace funding bundles"
```

---

## Task 4: Bundle-Aware `traceMoneyOriginPath`

**Files:**
- Modify: `src/forensics/moneyOriginTrace.ts`
- Test: `tests/forensics/moneyOriginTrace.test.ts`

- [ ] **Step 1: Add failing tests for precise stop reasons and bundles**

Add tests to `tests/forensics/moneyOriginTrace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { traceMoneyOriginPath } from "../../src/forensics/moneyOriginTrace";
import type { AddressLabel, ForensicRouteEdge, ServiceClassification } from "../../src/types";

function edge(input: {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
}): ForensicRouteEdge {
  return {
    id: input.txHash,
    txHash: input.txHash,
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    amountRaw: input.amountRaw,
    timestamp: new Date(input.timestamp),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

const noLabels = async (): Promise<AddressLabel[]> => [];
const noClassification = async (): Promise<ServiceClassification | null> => null;

describe("money origin trace bundles", () => {
  it("continues through top bundle funders instead of stopping at no previous transfer", async () => {
    const firstHop = edge({
      txHash: "hop-to-subject",
      fromAddress: "TV3H25",
      toAddress: "TSubject",
      amountRaw: "850000000000",
      timestamp: "2026-04-21T12:37:30.000Z"
    });
    const edgesByAddress = new Map<string, ForensicRouteEdge[]>([
      ["TV3H25", [
        firstHop,
        edge({ txHash: "in-85k", fromAddress: "TKHS", toAddress: "TV3H25", amountRaw: "85013000000", timestamp: "2026-04-21T12:16:51.000Z" }),
        edge({ txHash: "in-39k", fromAddress: "TRTr", toAddress: "TV3H25", amountRaw: "39116000000", timestamp: "2026-04-21T12:18:03.000Z" }),
        edge({ txHash: "in-600k", fromAddress: "TF6y", toAddress: "TV3H25", amountRaw: "600000000000", timestamp: "2026-04-21T12:27:48.000Z" }),
        edge({ txHash: "in-80k", fromAddress: "TFyj", toAddress: "TV3H25", amountRaw: "80500000000", timestamp: "2026-04-21T12:33:51.000Z" })
      ]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: "TSubject",
      balanceTransfer: {
        txHash: firstHop.txHash,
        fromAddress: firstHop.fromAddress,
        toAddress: firstHop.toAddress,
        amountRaw: firstHop.amountRaw,
        timestamp: firstHop.timestamp.toISOString(),
        coverageShare: 1,
        selectedReason: "funds_recent_outgoing"
      },
      maxDepth: 1,
      beamWidth: 4,
      maxAddressFetches: 10,
      maxEdgesPerAddress: 10,
      fetchEdgesForAddress: async (address) => edgesByAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? firstHop.timestamp.toISOString(),
        fetchedTransferCount: edgesByAddress.get(address)?.length ?? 0,
        oldestFetchedTransferAt: "2026-04-21T12:16:51.000Z",
        reachedTargetHop: true,
        source: "live"
      }),
      getLabelsForAddress: noLabels,
      getClassificationForAddress: noClassification
    });

    expect(path.stoppedReason).not.toBe("no_previous_transfer");
    expect(path.fundingBundles?.[0]).toMatchObject({
      hopTxHash: "hop-to-subject",
      hopAddress: "TV3H25",
      coverageRatio: expect.any(Number)
    });
    expect(path.fundingBundles?.[0]?.members.length).toBeGreaterThan(1);
  });

  it("uses incoming_history_not_fetched when history did not reach the hop timestamp", async () => {
    const transfer = {
      txHash: "hop-to-subject",
      fromAddress: "TV3H25",
      toAddress: "TSubject",
      amountRaw: "850000000000",
      timestamp: "2026-04-21T12:37:30.000Z",
      coverageShare: 1,
      selectedReason: "funds_recent_outgoing" as const
    };

    const path = await traceMoneyOriginPath({
      subjectAddress: "TSubject",
      balanceTransfer: transfer,
      maxDepth: 2,
      beamWidth: 4,
      maxAddressFetches: 10,
      maxEdgesPerAddress: 10,
      fetchEdgesForAddress: async () => [],
      getHistoryCoverageForAddress: async () => ({
        address: "TV3H25",
        targetTimestamp: transfer.timestamp,
        fetchedTransferCount: 50,
        oldestFetchedTransferAt: "2026-05-01T00:00:00.000Z",
        reachedTargetHop: false,
        source: "live"
      }),
      getLabelsForAddress: noLabels,
      getClassificationForAddress: noClassification
    });

    expect(path.stoppedReason).toBe("incoming_history_not_fetched");
  });

  it("uses no_incoming_transfers_seen only when reached history has no prior inputs", async () => {
    const transfer = {
      txHash: "hop-to-subject",
      fromAddress: "TCleanEoa",
      toAddress: "TSubject",
      amountRaw: "1000000000",
      timestamp: "2026-04-21T12:37:30.000Z",
      coverageShare: 1,
      selectedReason: "funds_recent_outgoing" as const
    };

    const path = await traceMoneyOriginPath({
      subjectAddress: "TSubject",
      balanceTransfer: transfer,
      maxDepth: 2,
      beamWidth: 4,
      maxAddressFetches: 10,
      maxEdgesPerAddress: 10,
      fetchEdgesForAddress: async () => [],
      getHistoryCoverageForAddress: async () => ({
        address: "TCleanEoa",
        targetTimestamp: transfer.timestamp,
        fetchedTransferCount: 0,
        oldestFetchedTransferAt: null,
        reachedTargetHop: true,
        source: "live"
      }),
      getLabelsForAddress: noLabels,
      getClassificationForAddress: noClassification
    });

    expect(path.stoppedReason).toBe("no_incoming_transfers_seen");
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npx vitest run tests/forensics/moneyOriginTrace.test.ts --configLoader bundle
```

Expected: FAIL because `getHistoryCoverageForAddress`, new stop reasons, and funding bundles are not implemented.

- [ ] **Step 3: Extend trace input and state**

Modify `TraceMoneyOriginPathInput` in `src/forensics/moneyOriginTrace.ts`:

```ts
export type TraceMoneyOriginPathInput = {
  subjectAddress: string;
  balanceTransfer: BalanceFormingTransfer;
  maxDepth: number;
  beamWidth: number;
  maxAddressFetches: number;
  maxEdgesPerAddress: number;
  minAmountPreservationRatio?: number;
  maxTimeDeltaMs?: number;
  bundleCoverageThreshold?: number;
  maxBundleFunders?: number;
  fetchEdgesForAddress(address: string, options?: { latestTimestamp?: Date }): Promise<ForensicRouteEdge[]>;
  getHistoryCoverageForAddress?(
    address: string,
    options: { latestTimestamp?: Date }
  ): Promise<MoneyOriginTraceHistoryCoverage>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
};
```

Extend `TraceState`:

```ts
type TraceState = {
  currentAddress: string;
  expectedAmountRaw: bigint;
  latestTimestamp: Date;
  addressesFromSubject: string[];
  txHashesFromSubject: string[];
  stepsFromSubject: MoneyOriginPathStep[];
  timestampsFromSubject: Date[];
  minPreservation: number;
  depth: number;
  score: number;
  fundingBundles: MoneyOriginFundingBundle[];
  historyCoverage: MoneyOriginTraceHistoryCoverage[];
};
```

Initialize `fundingBundles: []` and `historyCoverage: []` in `initialState`.

- [ ] **Step 4: Add bundle/history to `pathFromState`**

Modify `pathFromState` return object:

```ts
return {
  balanceTransferTxHash: input.balanceTransferTxHash,
  rootSourceAddress: input.state.currentAddress,
  rootSourceType: input.rootSourceType,
  balanceShare: input.balanceShare,
  exposureSourceKey: input.exposureSourceKey ?? null,
  exposureSourceLabel: input.exposureSourceLabel ?? null,
  sourceExposureKind: input.sourceExposureKind ?? null,
  pathAddresses: [...input.state.addressesFromSubject].reverse(),
  txHashes: [...input.state.txHashesFromSubject].reverse(),
  steps: [...input.state.stepsFromSubject].reverse(),
  amountPreservationRatio: input.state.minPreservation,
  timeSpanMs: timeSpanMs(input.state),
  stoppedReason: input.stoppedReason,
  verdict: input.verdict,
  riskScoreContribution: input.riskScoreContribution,
  reasons: input.reasons,
  fundingBundles: input.state.fundingBundles,
  historyCoverage: input.state.historyCoverage
};
```

- [ ] **Step 5: Add precise incomplete scores**

Modify `incompletePath` risk score mapping:

```ts
const riskScoreContribution =
  input.stoppedReason === "data_budget_exhausted" || input.stoppedReason === "incoming_history_not_fetched"
    ? 45
    : input.stoppedReason === "no_incoming_transfers_seen"
      ? 35
      : input.stoppedReason === "incoming_seen_but_below_continuity"
        ? 30
        : input.stoppedReason === "no_previous_transfer"
          ? 35
          : 30;
```

Use `riskScoreContribution` in the return.

- [ ] **Step 6: Integrate bundle fallback**

Import config and helper:

```ts
import {
  DEFAULT_BUNDLE_COVERAGE_THRESHOLD,
  DEFAULT_MAX_BUNDLE_FUNDERS
} from "./provenanceTracingConfig";
import { buildFundingBundleForTraceHop } from "./incomingDepositCashflow";
```

Inside the no-candidates branch, replace legacy stop selection with:

```ts
const historyCoverage = input.getHistoryCoverageForAddress
  ? await input.getHistoryCoverageForAddress(state.currentAddress, { latestTimestamp: state.latestTimestamp })
  : {
      address: state.currentAddress,
      targetTimestamp: state.latestTimestamp.toISOString(),
      fetchedTransferCount: edges.length,
      oldestFetchedTransferAt: edges
        .map((edge) => edge.timestamp)
        .sort((left, right) => left.getTime() - right.getTime())[0]?.toISOString() ?? null,
      reachedTargetHop: true,
      source: "unknown" as const
    };

const stateWithCoverage = {
  ...state,
  historyCoverage: [...state.historyCoverage, historyCoverage]
};

if (!historyCoverage.reachedTargetHop) {
  terminals.push(incompletePath({
    state: stateWithCoverage,
    balanceTransferTxHash: input.balanceTransfer.txHash,
    balanceShare: input.balanceTransfer.coverageShare,
    stoppedReason: "incoming_history_not_fetched",
    message: "Fetched transfer history did not reach the timestamp of this hop; absence of prior inputs is not proven."
  }));
  continue;
}

const currentHop = state.stepsFromSubject[state.stepsFromSubject.length - 1];
const targetEdge: ForensicRouteEdge = {
  id: currentHop.txHash,
  txHash: currentHop.txHash,
  fromAddress: currentHop.fromAddress,
  toAddress: currentHop.toAddress,
  amountRaw: state.expectedAmountRaw.toString(),
  timestamp: new Date(currentHop.timestamp),
  method: "transfer",
  edgeType: "normal_transfer"
};
const bundle = buildFundingBundleForTraceHop({
  target: targetEdge,
  edges,
  minCoverageRatio: input.bundleCoverageThreshold ?? DEFAULT_BUNDLE_COVERAGE_THRESHOLD,
  maxFunders: input.maxBundleFunders ?? DEFAULT_MAX_BUNDLE_FUNDERS
});

if (bundle && bundle.meetsThreshold) {
  const traceBundle: MoneyOriginFundingBundle = {
    hopTxHash: bundle.targetTxHash,
    hopAddress: bundle.targetAddress,
    expectedAmountRaw: bundle.expectedAmountRaw,
    coveredAmountRaw: bundle.coveredAmountRaw,
    coverageRatio: bundle.coverageRatio,
    members: bundle.members.map((member) => ({
      txHash: member.edge.txHash,
      fromAddress: member.edge.fromAddress,
      toAddress: member.edge.toAddress,
      originalAmountRaw: member.edge.amountRaw,
      usedAmountRaw: member.usedAmountRaw,
      spentBeforeHopRaw: member.spentBeforeHopRaw,
      timestamp: member.edge.timestamp.toISOString(),
      coverageShare: member.coverageRatio
    }))
  };

  for (const funder of bundle.funders) {
    const member = bundle.members.find((candidate) => candidate.edge.fromAddress === funder.address);
    if (!member) continue;
    nextFrontier.push({
      currentAddress: funder.address,
      expectedAmountRaw: BigInt(funder.amountRaw),
      latestTimestamp: member.edge.timestamp,
      addressesFromSubject: [...state.addressesFromSubject, funder.address],
      txHashesFromSubject: [...state.txHashesFromSubject, ...funder.txHashes],
      stepsFromSubject: [
        ...state.stepsFromSubject,
        {
          txHash: member.edge.txHash,
          fromAddress: member.edge.fromAddress,
          toAddress: member.edge.toAddress,
          amountRaw: member.usedAmountRaw,
          timestamp: member.edge.timestamp.toISOString()
        }
      ],
      timestampsFromSubject: [...state.timestampsFromSubject, member.edge.timestamp],
      minPreservation: Math.min(state.minPreservation, bundle.coverageRatio),
      depth: state.depth + 1,
      score: state.score + bundle.coverageRatio * 100,
      fundingBundles: [...state.fundingBundles, traceBundle],
      historyCoverage: [...state.historyCoverage, historyCoverage]
    });
  }
  continue;
}

const hasAnyPreviousIncoming = edges.some((edge) =>
  edge.toAddress === state.currentAddress &&
  edge.timestamp <= state.latestTimestamp &&
  parseAmount(edge.amountRaw) > 0n
);

terminals.push(incompletePath({
  state: stateWithCoverage,
  balanceTransferTxHash: input.balanceTransfer.txHash,
  balanceShare: input.balanceTransfer.coverageShare,
  stoppedReason: hasAnyPreviousIncoming ? "incoming_seen_but_below_continuity" : "no_incoming_transfers_seen",
  message: hasAnyPreviousIncoming
    ? "Previous incoming transfers exist, but neither a single edge nor a multi-input bundle met continuity thresholds."
    : "Fetched history reached this hop and no prior inbound USDT transfer was seen; source remains unproven."
}));
continue;
```

- [ ] **Step 7: Run trace tests**

Run:

```powershell
npx vitest run tests/forensics/moneyOriginTrace.test.ts --configLoader bundle
npm run typecheck
```

Expected: PASS. Update imports for new types if TypeScript reports missing names.

- [ ] **Step 8: Commit**

```powershell
git add src/forensics/moneyOriginTrace.ts tests/forensics/moneyOriginTrace.test.ts
git commit -m "feat: trace multi-input funding bundles"
```

---

## Task 5: Runtime History Coverage In `where_is_money`

**Files:**
- Modify: `src/check/whereIsMoneyCheck.ts`
- Modify: `src/forensics/deepForensicJob.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Add failing test for `incoming_history_not_fetched` propagation**

Add to `tests/check/whereIsMoneyCheck.test.ts`:

```ts
it("passes trace history coverage so absence is not overstated when provider history is shallow", async () => {
  const report = await runWhereIsMoneyCheck({
    sourceAddress: "TSubject",
    tokenContractAddress: TRON_USDT_CONTRACT_ADDRESS,
    windowStart: new Date("2026-04-01T00:00:00.000Z"),
    windowEnd: new Date("2026-06-02T00:00:00.000Z"),
    maxDepth: 2,
    deps: {
      getTrc20Balance: async () => "1492633",
      fetchEdgesForAddress: async () => [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? "2026-04-21T12:37:30.000Z",
        fetchedTransferCount: 50,
        oldestFetchedTransferAt: "2026-05-01T00:00:00.000Z",
        reachedTargetHop: false,
        source: "live"
      }),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getFastWalletRisk: async () => null
    }
  });

  expect(report.originPaths.some((path) => path.stoppedReason === "incoming_history_not_fetched")).toBe(true);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
npx vitest run tests/check/whereIsMoneyCheck.test.ts --configLoader bundle
```

Expected: FAIL because `WhereIsMoneyDeps.getHistoryCoverageForAddress` does not exist.

- [ ] **Step 3: Add optional dependency and pass it into tracer**

Modify `WhereIsMoneyDeps` in `src/check/whereIsMoneyCheck.ts`:

```ts
getHistoryCoverageForAddress?(
  address: string,
  options: { latestTimestamp?: Date }
): Promise<MoneyOriginTraceHistoryCoverage>;
```

Pass it into `traceMoneyOriginPath`:

```ts
getHistoryCoverageForAddress: deps.getHistoryCoverageForAddress,
```

- [ ] **Step 4: Add runtime coverage cache in `deepForensicJob`**

In `runSingleDeepForensicJobCycle`, add:

```ts
const historyCoverageCache = new Map<string, MoneyOriginTraceHistoryCoverage>();
```

After fetching `edges` inside `fetchEdgesForAddress`, compute and cache:

```ts
const sortedByTime = [...edges].sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
historyCoverageCache.set(cacheKey, {
  address,
  targetTimestamp: maxTimestamp.toISOString(),
  fetchedTransferCount: edges.length,
  oldestFetchedTransferAt: sortedByTime[0]?.timestamp.toISOString() ?? null,
  reachedTargetHop: edges.length < maxEdgesPerAddress || Boolean(sortedByTime[0] && sortedByTime[0].timestamp <= maxTimestamp),
  source: indexedEdges.length > 0 && liveEdges.length > 0
    ? "mixed"
    : indexedEdges.length > 0
      ? "local_index"
      : liveEdges.length > 0
        ? "live"
        : "unknown"
});
```

Add a helper passed to `runWhereIsMoneyCheck`:

```ts
const getHistoryCoverageForAddress = async (
  address: string,
  fetchOptions: { latestTimestamp?: Date } = {}
): Promise<MoneyOriginTraceHistoryCoverage> => {
  const maxTimestamp = fetchOptions.latestTimestamp && fetchOptions.latestTimestamp < job.windowEnd
    ? fetchOptions.latestTimestamp
    : job.windowEnd;
  const cacheKey = maxTimestamp.getTime() === job.windowEnd.getTime()
    ? address
    : `${address}:${maxTimestamp.getTime()}`;
  if (!historyCoverageCache.has(cacheKey)) {
    await fetchEdgesForAddress(address, fetchOptions);
  }
  return historyCoverageCache.get(cacheKey) ?? {
    address,
    targetTimestamp: maxTimestamp.toISOString(),
    fetchedTransferCount: 0,
    oldestFetchedTransferAt: null,
    reachedTargetHop: false,
    source: "unknown"
  };
};
```

Pass `getHistoryCoverageForAddress` in the deps object.

- [ ] **Step 5: Run tests**

Run:

```powershell
npx vitest run tests/check/whereIsMoneyCheck.test.ts tests/forensics/deepForensicJob.test.ts --configLoader bundle
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/check/whereIsMoneyCheck.ts src/forensics/deepForensicJob.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "feat: track trace history coverage"
```

---

## Task 6: Drain Episode Scope And Cross-Layer Summary

**Files:**
- Create: `src/forensics/drainEpisode.ts`
- Modify: `src/forensics/recentFlowProvenanceSelection.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Test: `tests/forensics/drainEpisode.test.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Write failing drain episode test**

Create `tests/forensics/drainEpisode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectDrainEpisode } from "../../src/forensics/drainEpisode";
import type { ForensicRouteEdge } from "../../src/types";

function edge(txHash: string, fromAddress: string, toAddress: string, amountRaw: string, timestamp: string): ForensicRouteEdge {
  return {
    id: txHash,
    txHash,
    fromAddress,
    toAddress,
    amountRaw,
    timestamp: new Date(timestamp),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

describe("drain episode detection", () => {
  it("detects bridge/adapter drain episode after a large inbound", () => {
    const episode = detectDrainEpisode({
      subjectAddress: "TLhV",
      anchorTxHash: "anchor-135k",
      selectedAmountRaw: "135300000000",
      edges: [
        edge("in-1885k", "TUU1", "TLhV", "1885262475832", "2026-05-05T13:31:30.000Z"),
        edge("out-200k-a", "TLhV", "TPwez", "199994920000", "2026-05-05T13:57:27.000Z"),
        edge("out-200k-b", "TLhV", "TPwez", "199994920000", "2026-05-05T13:58:45.000Z"),
        edge("out-200k-c", "TLhV", "TUrnbc", "200007090000", "2026-05-05T14:23:18.000Z"),
        edge("anchor-135k", "TLhV", "TPwez", "135300000000", "2026-05-05T15:00:30.000Z")
      ],
      serviceAddresses: new Set(["tpwez", "turnbc"])
    });

    expect(episode).toMatchObject({
      anchorTxHash: "anchor-135k",
      episodeOutgoingRaw: "735296930000",
      bridgeOutgoingRaw: "735296930000",
      bridgeOutgoingShare: 1
    });
    expect(episode?.outgoingTxHashes).toEqual(["out-200k-a", "out-200k-b", "out-200k-c", "anchor-135k"]);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
npx vitest run tests/forensics/drainEpisode.test.ts --configLoader bundle
```

Expected: FAIL because `drainEpisode.ts` does not exist.

- [ ] **Step 3: Add drain episode detector**

Create `src/forensics/drainEpisode.ts`:

```ts
import type { ForensicRouteEdge, MoneyOriginDrainEpisode } from "../types";
import { DEFAULT_DRAIN_EPISODE_WINDOW_MS } from "./provenanceTracingConfig";

function parseRaw(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number((numerator * 10_000n) / denominator) / 10_000;
}

export function detectDrainEpisode(input: {
  subjectAddress: string;
  anchorTxHash: string;
  selectedAmountRaw: string;
  selectedFundingTxHashes?: string[];
  edges: ForensicRouteEdge[];
  serviceAddresses: Set<string>;
  windowMs?: number;
}): MoneyOriginDrainEpisode | null {
  const anchor = input.edges.find((edge) => edge.txHash === input.anchorTxHash);
  if (!anchor || anchor.fromAddress !== input.subjectAddress) return null;

  const windowMs = input.windowMs ?? DEFAULT_DRAIN_EPISODE_WINDOW_MS;
  const windowStartMs = anchor.timestamp.getTime() - windowMs;
  const fundingCandidates = input.edges
    .filter((edge) => edge.toAddress === input.subjectAddress)
    .filter((edge) => edge.timestamp.getTime() >= windowStartMs && edge.timestamp.getTime() <= anchor.timestamp.getTime())
    .filter((edge) => parseRaw(edge.amountRaw) > 0n);
  const selectedFundingTxHashes = new Set(input.selectedFundingTxHashes ?? []);
  const selectedFunding = fundingCandidates
    .filter((edge) => selectedFundingTxHashes.has(edge.txHash))
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())[0] ?? null;
  const funding = selectedFunding ?? fundingCandidates
    .sort((left, right) => {
      const amountDelta = parseRaw(right.amountRaw) - parseRaw(left.amountRaw);
      if (amountDelta !== 0n) return amountDelta > 0n ? 1 : -1;
      const timeDelta = right.timestamp.getTime() - left.timestamp.getTime();
      return timeDelta !== 0 ? timeDelta : left.txHash.localeCompare(right.txHash);
    })[0] ?? null;
  if (!funding) return null;

  const relevantOutgoing = input.edges
    .filter((edge) => edge.fromAddress === input.subjectAddress)
    .filter((edge) => edge.timestamp.getTime() >= funding.timestamp.getTime() && edge.timestamp.getTime() <= anchor.timestamp.getTime())
    .filter((edge) => parseRaw(edge.amountRaw) > 0n)
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

  if (relevantOutgoing.length <= 1) return null;

  const episodeOutgoingRaw = relevantOutgoing.reduce((sum, edge) => sum + parseRaw(edge.amountRaw), 0n);
  const bridgeOutgoingRaw = relevantOutgoing
    .filter((edge) => input.serviceAddresses.has(edge.toAddress.toLowerCase()))
    .reduce((sum, edge) => sum + parseRaw(edge.amountRaw), 0n);

  return {
    anchorTxHash: anchor.txHash,
    fundingTxHash: funding.txHash,
    fundingAmountRaw: funding.amountRaw,
    fundingTimestamp: funding.timestamp.toISOString(),
    startTimestamp: relevantOutgoing[0].timestamp.toISOString(),
    endTimestamp: relevantOutgoing[relevantOutgoing.length - 1].timestamp.toISOString(),
    episodeOutgoingRaw: episodeOutgoingRaw.toString(),
    episodeSelectedRaw: parseRaw(input.selectedAmountRaw).toString(),
    episodeCoverageRatio: ratio(parseRaw(input.selectedAmountRaw), episodeOutgoingRaw),
    outgoingTxHashes: relevantOutgoing.map((edge) => edge.txHash),
    bridgeOutgoingRaw: bridgeOutgoingRaw.toString(),
    bridgeOutgoingShare: ratio(bridgeOutgoingRaw, episodeOutgoingRaw)
  };
}
```

- [ ] **Step 4: Attach drain episode and layer summary in `whereIsMoneyCheck`**

In `runWhereIsMoneyCheck`, after `selection` is created, compute:

```ts
const serviceAddresses = new Set<string>();
for (const edge of sourceEdges) {
  const classification = await getCachedClassification(edge.toAddress).catch(() => null);
  if (classification?.isBoundary) serviceAddresses.add(edge.toAddress.toLowerCase());
}
const drainEpisode = selection.anchorTransfer?.direction === "outgoing"
  ? detectDrainEpisode({
      subjectAddress: sourceAddress,
      anchorTxHash: selection.anchorTransfer.txHash,
      selectedAmountRaw: selection.selectedAmountRaw,
      selectedFundingTxHashes: selection.transfers.map((transfer) => transfer.txHash),
      edges: sourceEdges,
      serviceAddresses
    })
  : null;
```

Add to `coverage`:

```ts
drainEpisode,
checkedScope: drainEpisode
  ? "drain_episode"
  : selection.provenanceScope === "recent_flow"
    ? selection.anchorTransfer ? "selected_anchor" : "recent_flow"
    : selection.provenanceScope,
anchorCoverageRatio: selection.coverageRatio,
episodeCoverageRatio: drainEpisode?.episodeCoverageRatio ?? null,
```

For recent-flow fallback with no selected outgoing anchor, use `checkedScope: "recent_flow"` rather than `selected_anchor`.

Build layer summary near the final report:

```ts
const layerSummary = {
  fastCheck: {
    riskLevel: fastWalletRisk?.level ?? null,
    score: fastWalletRisk?.score ?? null,
    note: "Fast check is a quick label/snapshot signal, not a full provenance trace."
  },
  whereIsMoney: {
    checkedScope: finalCoverage.checkedScope ?? "current_balance",
    note: finalCoverage.checkedScope === "drain_episode"
      ? "Where is money checked a selected drain episode derived from the low-balance recent-flow anchor."
      : "Where is money checked the selected provenance scope."
  },
  deepCheck: {
    serviceExposureRaw: null,
    dominantCategory: null,
    note: "Deep service exposure is attached by address_deep_check jobs and may include flows outside the selected provenance anchor."
  }
};
```

Attach `layerSummary` to the returned report.

- [ ] **Step 5: Run tests**

Run:

```powershell
npx vitest run tests/forensics/drainEpisode.test.ts tests/check/whereIsMoneyCheck.test.ts --configLoader bundle
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/forensics/drainEpisode.ts src/check/whereIsMoneyCheck.ts tests/forensics/drainEpisode.test.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "feat: add drain episode scope"
```

---

## Task 7: Cross-Chain Stage 2 From Drain Or Deep Bridge Exposure

**Files:**
- Modify: `src/forensics/crossChainStage2Triggers.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Test: `tests/forensics/crossChainStage2Triggers.test.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Add failing trigger tests**

Add to `tests/forensics/crossChainStage2Triggers.test.ts`:

```ts
it("triggers from drain episode bridge exposure above amount threshold", () => {
  const evaluation = evaluateCrossChainStage2Trigger({
    selection: selection({
      targetAmountRaw: "135300000000",
      selectedAmountRaw: "135300000000",
      drainEpisode: {
        anchorTxHash: "anchor",
        startTimestamp: "2026-05-05T13:31:30.000Z",
        endTimestamp: "2026-05-05T15:00:30.000Z",
        episodeOutgoingRaw: "1885000000000",
        episodeSelectedRaw: "135300000000",
        episodeCoverageRatio: 0.0717,
        outgoingTxHashes: ["bridge-1", "bridge-2"],
        bridgeOutgoingRaw: "1885000000000",
        bridgeOutgoingShare: 1
      }
    }),
    originPaths: [],
    assessment: assessment(),
    manualDeepMode: false
  });

  expect(evaluation).toMatchObject({
    triggered: true,
    reason: "drain_episode_bridge_exposure"
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npx vitest run tests/forensics/crossChainStage2Triggers.test.ts --configLoader bundle
```

Expected: FAIL because trigger input does not inspect drain episode.

- [ ] **Step 3: Extend trigger input and logic**

Modify `evaluateCrossChainStage2Trigger` input type:

```ts
export type CrossChainDeepBridgeExposure = {
  source: "address_deep_check";
  bridgeExposureRaw: string;
  bridgeExposureShare: number;
  totalOutgoingRaw: string;
  balanceTransferTxHashes?: string[];
};

export function evaluateCrossChainStage2Trigger(input: {
  selection: BalanceFormingSelection;
  originPaths: MoneyOriginPath[];
  assessment: WhereIsMoneyAssessment;
  manualDeepMode?: boolean;
  drainEpisode?: MoneyOriginDrainEpisode | null;
  deepBridgeExposure?: CrossChainDeepBridgeExposure | null;
}): CrossChainStage2TriggerEvaluation {
```

Add near the top after manual mode:

```ts
const drainEpisode = input.drainEpisode ?? null;
if (drainEpisode) {
  const bridgeAmount = parseAmount(drainEpisode.bridgeOutgoingRaw);
  if (
    bridgeAmount >= BigInt(DEFAULT_CROSS_CHAIN_BRIDGE_AMOUNT_THRESHOLD_RAW) ||
    drainEpisode.bridgeOutgoingShare >= DEFAULT_CROSS_CHAIN_BRIDGE_EPISODE_SHARE_THRESHOLD
  ) {
    return {
      ...baseEvaluation(selection),
      triggered: true,
      reason: "drain_episode_bridge_exposure",
      deepCheckAvailable: true,
      balanceTransferTxHashes: drainEpisode.outgoingTxHashes,
      selectedAmountRaw: drainEpisode.bridgeOutgoingRaw,
      targetAmountRaw: drainEpisode.episodeOutgoingRaw
    };
  }
}
```

Also export `deepBridgeExposureFromServiceProfiles(profiles: ServiceExposureProfile[])`.
It should derive address-deep-check bridge exposure from `bridge` and `bridge_pool` category volumes,
pick the strongest profile deterministically by bridge raw amount, share, then subject address, and return
`null` when no positive bridge exposure exists.

After the drain branch, add a deep exposure branch:

```ts
const deepBridgeExposure = input.deepBridgeExposure ?? null;
if (deepBridgeExposure) {
  const bridgeAmount = parseAmount(deepBridgeExposure.bridgeExposureRaw);
  if (
    bridgeAmount >= BigInt(DEFAULT_CROSS_CHAIN_BRIDGE_AMOUNT_THRESHOLD_RAW) ||
    deepBridgeExposure.bridgeExposureShare >= DEFAULT_CROSS_CHAIN_BRIDGE_EPISODE_SHARE_THRESHOLD
  ) {
    return {
      ...baseEvaluation(selection),
      triggered: true,
      reason: "deep_service_exposure_bridge",
      deepCheckAvailable: true,
      balanceTransferTxHashes: deepBridgeExposure.balanceTransferTxHashes ?? [],
      selectedAmountRaw: deepBridgeExposure.bridgeExposureRaw,
      targetAmountRaw: deepBridgeExposure.totalOutgoingRaw
    };
  }
}
```

If no selected cross-chain boundary is visible and deep bridge exposure was present but below threshold,
the skipped reason should mention that the deep bridge exposure was below threshold.

Import config defaults:

```ts
import {
  DEFAULT_CROSS_CHAIN_BRIDGE_AMOUNT_THRESHOLD_RAW,
  DEFAULT_CROSS_CHAIN_BRIDGE_EPISODE_SHARE_THRESHOLD
} from "./provenanceTracingConfig";
```

- [ ] **Step 4: Pass drain episode from `whereIsMoneyCheck`**

Modify the call:

```ts
const crossChainTrigger = evaluateCrossChainStage2Trigger({
  selection,
  originPaths,
  assessment: initialAssessment,
  manualDeepMode: input.crossChainManualDeepMode,
  drainEpisode: finalCoverage.drainEpisode ?? coverage.drainEpisode ?? null,
  deepBridgeExposure: input.deepBridgeExposure ??
    deepBridgeExposureFromServiceProfiles(input.deepServiceExposureProfiles ?? []) ??
    null
});
```

- [ ] **Step 5: Run tests**

Run:

```powershell
npx vitest run tests/forensics/crossChainStage2Triggers.test.ts tests/check/whereIsMoneyCheck.test.ts --configLoader bundle
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/forensics/crossChainStage2Triggers.ts src/check/whereIsMoneyCheck.ts tests/forensics/crossChainStage2Triggers.test.ts tests/check/whereIsMoneyCheck.test.ts docs/superpowers/plans/2026-06-02-multi-input-provenance-tracing.md
git commit -m "fix: trigger stage2 from deep bridge exposure"
```

---

## Task 8: High-Share Terminal Boundary Enrichment

**Files:**
- Modify: `src/forensics/contractLlmVerdict.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Test: `tests/forensics/contractLlmVerdict.test.ts`

- [ ] **Step 1: Add failing candidate-selection test**

Add to `tests/forensics/contractLlmVerdict.test.ts`:

```ts
it("includes high-share terminal boundary contracts in case files", () => {
  const caseFiles = buildContractAnalysisCaseFiles({
    subjectAddress: "TSubject",
    currentUsdtBalanceRaw: "1492633",
    balanceFormingTransfers: [],
    originPaths: [{
      balanceTransferTxHash: "tx-main",
      rootSourceAddress: "TLUV5twBEFd3UNZc9bk5SiTn3PE7dfDTVZ",
      rootSourceType: "incomplete",
      balanceShare: 0.9993,
      exposureSourceKey: null,
      exposureSourceLabel: null,
      sourceExposureKind: null,
      pathAddresses: ["TLUV5twBEFd3UNZc9bk5SiTn3PE7dfDTVZ", "TSubject"],
      txHashes: ["tx-main"],
      steps: [],
      amountPreservationRatio: 1,
      timeSpanMs: 0,
      stoppedReason: "unlabeled_service_boundary",
      verdict: "REVIEW",
      riskScoreContribution: 45,
      reasons: ["Balance-forming path reaches service boundary service; manual review required."]
    }],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    classifications: new Map()
  });

  expect(caseFiles.some((caseFile) =>
    caseFile.contractAddress === "TLUV5twBEFd3UNZc9bk5SiTn3PE7dfDTVZ"
  )).toBe(true);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npx vitest run tests/forensics/contractLlmVerdict.test.ts --configLoader bundle
```

Expected: FAIL because terminal boundary is not selected.

- [ ] **Step 3: Add terminal-boundary candidates**

In `src/forensics/contractLlmVerdict.ts`, include origin path terminal addresses when:

```ts
function isHighShareTerminalBoundary(path: MoneyOriginPath): boolean {
  return Boolean(path.rootSourceAddress) &&
    (path.stoppedReason === "unlabeled_service_boundary" ||
      path.sourceExposureKind === "unknown_contract" ||
      path.sourceExposureKind === "bridge_router_dex") &&
    ((path.balanceShare ?? 0) >= 0.5 || path.riskScoreContribution >= 35);
}
```

In the candidate collection logic for `buildContractAnalysisCaseFiles`, add:

```ts
for (const path of input.originPaths) {
  if (isHighShareTerminalBoundary(path) && path.rootSourceAddress) {
    candidateAddresses.add(path.rootSourceAddress);
  }
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npx vitest run tests/forensics/contractLlmVerdict.test.ts tests/check/whereIsMoneyCheck.test.ts --configLoader bundle
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/forensics/contractLlmVerdict.ts tests/forensics/contractLlmVerdict.test.ts
git commit -m "feat: enrich terminal boundary contracts"
```

---

## Task 9: Admin Graph Amounts, Weights, And Legacy Stops

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add failing graph projection tests**

Add to `tests/admin/forensicsGraph.test.ts`:

```ts
it("projects amount usage and typed weights for selected provenance edges", () => {
  const result = projectForensicJobGraph(job({
    resultJson: {
      subjectAddress: "TSubject",
      riskScore: 45,
      decision: "REVIEW",
      coverage: {
        coverageRatio: 1,
        selectedAmountRaw: "135300000000",
        targetAmountRaw: "135300000000",
        checkedScope: "selected_anchor"
      },
      assessment: {
        decision: "REVIEW",
        riskScore: 45,
        provenanceConfidence: 54,
        reasons: []
      },
      originPaths: [{
        verdict: "REVIEW",
        stoppedReason: "unlabeled_service_boundary",
        riskScoreContribution: 45,
        balanceShare: 0.9993,
        txHashes: ["tx-main"],
        pathAddresses: ["TBoundary", "TSubject"],
        steps: [{
          txHash: "tx-main",
          fromAddress: "TBoundary",
          toAddress: "TSubject",
          amountRaw: "1885262475832",
          timestamp: "2026-05-05T13:31:30.000Z"
        }],
        fundingBundles: [{
          hopTxHash: "tx-main",
          hopAddress: "TBoundary",
          expectedAmountRaw: "135300000000",
          coveredAmountRaw: "135300000000",
          coverageRatio: 1,
          members: []
        }],
        reasons: ["Path risk contribution"]
      }]
    }
  }));

  if (!result.ok) throw new Error(result.message);
  const edge = result.graph.edges.find((item) => item.txHash === "tx-main");
  expect(edge?.metadata).toMatchObject({
    originalAmountRaw: "1885262475832",
    usedAmountRaw: "135300000000",
    amountRole: "funding_candidate"
  });
  expect(result.graph.weights).toEqual(expect.arrayContaining([
    expect.objectContaining({
      source: "origin_path",
      label: "Path risk contribution",
      value: 45
    })
  ]));
});

it("marks legacy no_previous_transfer stops as rerun recommended", () => {
  const result = projectForensicJobGraph(job({
    resultJson: {
      subjectAddress: "TSubject",
      riskScore: 35,
      decision: "REVIEW",
      coverage: { coverageRatio: 0.5 },
      assessment: { decision: "REVIEW", riskScore: 35, provenanceConfidence: 30, reasons: [] },
      originPaths: [{
        verdict: "REVIEW",
        stoppedReason: "no_previous_transfer",
        riskScoreContribution: 35,
        pathAddresses: ["TSource", "TSubject"],
        txHashes: ["tx-legacy"],
        steps: [],
        reasons: []
      }]
    }
  }));

  if (!result.ok) throw new Error(result.message);
  expect(result.graph.limitations).toEqual(expect.arrayContaining([
    expect.objectContaining({
      code: "legacy_no_previous_transfer",
      severity: "review"
    })
  ]));
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npx vitest run tests/admin/forensicsGraph.test.ts --configLoader bundle
```

Expected: FAIL because metadata and legacy limitation are not projected.

- [ ] **Step 3: Project amount usage and bundles**

In `projectWhereIsMoneyJob`, while creating transfer edges, compute:

```ts
const amountUsage = isRecord(step["amountUsage"]) ? step["amountUsage"] : {};
```

Set edge metadata:

```ts
metadata: {
  pathId,
  originalAmountRaw: stringField(amountUsage, "originalAmountRaw") ?? stringField(step, "amountRaw") ?? amountRaw,
  usedAmountRaw: stringField(amountUsage, "usedAmountRaw") ?? stringField(step, "amountRaw") ?? amountRaw,
  anchorAmountRaw: stringField(amountUsage, "anchorAmountRaw") ?? stringField(coverage, "targetAmountRaw"),
  amountRole: stringField(amountUsage, "role") ?? "funding_candidate"
}
```

When a path has `fundingBundles`, add path metadata or a limitation entry:

```ts
const fundingBundles = recordArrayField(item, "fundingBundles");
if (fundingBundles.length > 0) {
  limitations.push({
    code: "multi_input_bundle_used",
    label: "Multi-input bundle used",
    severity: "info",
    pathId,
    explanation: "This path used multiple inbound transfers to explain one outgoing hop."
  });
}
```

- [ ] **Step 4: Project legacy stop limitation**

When `stoppedReason === "no_previous_transfer"`:

```ts
limitations.push({
  code: "legacy_no_previous_transfer",
  label: "Legacy no_previous_transfer stop",
  severity: "review",
  pathId,
  explanation: "Old reports used no_previous_transfer for several conditions. Rerun recommended for precise stop classification."
});
```

- [ ] **Step 5: Render amount and weight labels in admin console**

In `src/admin/adminConsole.ts`, update selected edge details to show:

```ts
detailRow("Original", formatAmount(edge.metadata.originalAmountRaw ?? edge.amountRaw));
detailRow("Used", formatAmount(edge.metadata.usedAmountRaw ?? edge.amountRaw));
detailRow("Coverage", edge.amountShare === null ? "n/a" : formatPercent(edge.amountShare));
detailRow("Role", String(edge.metadata.amountRole ?? "transfer"));
```

Update selected node/edge weight display to group by `weight.source`:

```ts
const relatedWeights = graph.weights.filter((weight) =>
  weight.nodeId === selectedNode?.id || weight.edgeId === selectedEdge?.id || weight.pathId === selectedPath?.id
);
```

Render each `relatedWeights` item as:

```ts
detailRow(weight.label, `${weight.value} / ${weight.source}`);
```

- [ ] **Step 6: Run tests**

Run:

```powershell
npx vitest run tests/admin/forensicsGraph.test.ts --configLoader bundle
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat: clarify admin provenance graph details"
```

---

## Task 10: Final Regression Pass

**Files:**
- Modify only files required by failing tests from this task.
- Test: existing focused suites.

- [ ] **Step 1: Run focused provenance suites**

Run:

```powershell
npx vitest run `
  tests/forensics/provenanceTracingConfig.test.ts `
  tests/forensics/recentFlowProvenanceSelection.test.ts `
  tests/forensics/incomingDepositCashflow.test.ts `
  tests/forensics/moneyOriginTrace.test.ts `
  tests/forensics/drainEpisode.test.ts `
  tests/forensics/crossChainStage2Triggers.test.ts `
  tests/forensics/contractLlmVerdict.test.ts `
  tests/check/whereIsMoneyCheck.test.ts `
  tests/admin/forensicsGraph.test.ts `
  --configLoader bundle
```

Expected: PASS.

- [ ] **Step 2: Run broader safety checks**

Run:

```powershell
npm run typecheck
git diff --check
```

Expected: PASS. `git diff --check` may print CRLF warnings on Windows; whitespace errors must be fixed.

- [ ] **Step 3: Review final behavior against the TLhV case**

Run or inspect a stored job rerun for `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe` and verify:

```text
coverage.checkedScope is recent_flow, selected_anchor, or drain_episode for low-balance recent-flow reports.
coverage.anchorCoverageRatio is present.
coverage.drainEpisode is present when the burst is detected.
originPaths do not emit new no_previous_transfer stops.
TV3H25-style multi-input hops contain fundingBundles.
incoming_history_not_fetched appears only when history did not reach target timestamp.
admin graph has Original, Used, Coverage, Role metadata.
crossChainCorridor triggers or skips with a reason that mentions drain/deep bridge exposure.
terminal boundary contract candidates include high-share boundary addresses.
```

- [ ] **Step 4: Commit any final test-only fixes**

If Step 1 or Step 2 required fixes:

```powershell
git add src/types.ts src/forensics/provenanceTracingConfig.ts src/forensics/recentFlowProvenanceSelection.ts src/forensics/incomingDepositCashflow.ts src/forensics/moneyOriginTrace.ts src/forensics/drainEpisode.ts src/forensics/crossChainStage2Triggers.ts src/forensics/contractLlmVerdict.ts src/check/whereIsMoneyCheck.ts src/forensics/deepForensicJob.ts src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/forensics/provenanceTracingConfig.test.ts tests/forensics/recentFlowProvenanceSelection.test.ts tests/forensics/incomingDepositCashflow.test.ts tests/forensics/moneyOriginTrace.test.ts tests/forensics/drainEpisode.test.ts tests/forensics/crossChainStage2Triggers.test.ts tests/forensics/contractLlmVerdict.test.ts tests/check/whereIsMoneyCheck.test.ts tests/admin/forensicsGraph.test.ts
git commit -m "test: cover multi-input provenance tracing"
```

If no files changed, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage:
  - Amount semantics: Task 2 and Task 9.
  - Stop reasons: Task 4 and Task 5.
  - Bundle tracing: Task 3 and Task 4.
  - Drain episode: Task 6.
  - Cross-layer summary: Task 6.
  - Cross-chain from bridge exposure: Task 7.
  - Terminal enrichment: Task 8.
  - Admin graph weights and legacy stops: Task 9.
  - Configurable defaults: Task 1.

- Type consistency:
  - `amountUsage` belongs to `BalanceFormingTransfer`.
  - `fundingBundles` and `historyCoverage` belong to `MoneyOriginPath`.
  - `drainEpisode`, `checkedScope`, `anchorCoverageRatio`, and `episodeCoverageRatio` belong to `WhereIsMoneyCoverage`.
  - Cross-chain trigger reasons are added to `CrossChainStage2TriggerReason`.

- Execution order:
  - Tasks 1-2 establish types and amount semantics.
  - Tasks 3-5 build and wire tracing.
  - Tasks 6-8 add scope and enrichment behavior.
  - Task 9 projects the richer report.
  - Task 10 verifies the full stack.
