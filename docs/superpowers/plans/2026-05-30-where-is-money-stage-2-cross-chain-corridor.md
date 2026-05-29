# Where Is Money Stage 2 Cross-Chain Corridor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trigger-gated cross-chain corridor analysis as Stage 2 of `Where is money?`, starting with TRON -> Ethereum -> Arbitrum and Range-backed discovery.

**Architecture:** Keep the current TRON Stage 1 intact. Add a Stage 1.5 trigger evaluator and a separate Stage 2 corridor layer behind provider interfaces, then merge Stage 2 evidence into the existing `WhereIsMoneyReport` without weakening safe-default decline behavior.

**Tech Stack:** TypeScript, Vitest, existing TronScan-backed forensics modules, Range HTTP API behind an interface, existing LLM contract verdict pattern for explanation only.

---

## File Structure

- Modify: `src/types.ts`  
  Add requested-amount selection fields and Stage 2 cross-chain evidence/report types.

- Modify: `src/forensics/balanceFormingTransfers.ts`  
  Support `requestedAmountRaw` as selection target while preserving current-balance default behavior.

- Modify: `src/check/whereIsMoneyCheck.ts`  
  Accept `requestedAmountRaw`, call Stage 2 trigger/evaluator/expander when available, and include `crossChainCorridor` in reports.

- Create: `src/forensics/crossChainEvidence.ts`  
  Small helpers for raw amount parsing, amount thresholds, and evidence severity.

- Create: `src/forensics/crossChainStage2Triggers.ts`  
  Pure Stage 1.5 trigger evaluator.

- Create: `src/forensics/crossChainProviders.ts`  
  Provider interface plus fixture provider used in tests.

- Create: `src/forensics/rangeClient.ts`  
  Minimal Range HTTP client and adapter to normalized cross-chain transfers.

- Create: `src/forensics/crossChainCorridor.ts`  
  Stage 2 corridor expander and scorer.

- Modify: `src/config.ts`  
  Add Range API config and Stage 2 threshold config.

- Modify: `scripts/forensicWhereIsMoney.ts` and `src/index.ts`  
  Wire Range provider when configured.

- Modify: report formatting files after locating exact formatter in implementation task. Current likely entry points are `src/alerts/formatters.ts` and `src/bot/messages.ts`.

- Tests:
  - `tests/forensics/balanceFormingTransfers.test.ts`
  - `tests/forensics/crossChainStage2Triggers.test.ts`
  - `tests/forensics/crossChainProviders.test.ts`
  - `tests/forensics/rangeClient.test.ts`
  - `tests/forensics/crossChainCorridor.test.ts`
  - `tests/check/whereIsMoneyCheck.test.ts`
  - `tests/config/config.test.ts`

---

### Task 1: Requested Amount Balance Selection

**Files:**
- Modify: `src/types.ts`
- Modify: `src/forensics/balanceFormingTransfers.ts`
- Test: `tests/forensics/balanceFormingTransfers.test.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Write the failing requested-amount selection test**

Update `tests/forensics/balanceFormingTransfers.test.ts` with this test if it is not already present:

```ts
it("selects newest inbound transfers until they cover the requested amount", () => {
  const result = selectBalanceFormingTransfers({
    subjectAddress: subject,
    currentBalanceRaw: "5000000000",
    requestedAmountRaw: "1000000000",
    edges: [
      edge("tx-old-large", oldSender, subject, "4000000000", "2026-05-22T10:00:00.000Z"),
      edge("tx-older-700", senderA, subject, "700000000", "2026-05-22T10:05:00.000Z"),
      edge("tx-newer-700", senderB, subject, "700000000", "2026-05-22T10:10:00.000Z")
    ]
  });

  expect(result.transfers.map((transfer) => transfer.txHash)).toEqual(["tx-newer-700", "tx-older-700"]);
  expect(result.currentBalanceRaw).toBe("5000000000");
  expect(result.requestedAmountRaw).toBe("1000000000");
  expect(result.targetAmountRaw).toBe("1000000000");
  expect(result.selectedAmountRaw).toBe("1400000000");
  expect(result.selectedVolumeRaw).toBe("1400000000");
  expect(result.coverageRatio).toBeGreaterThanOrEqual(1);
  expect(result.partial).toBe(false);
  expect(result.selectionMethod).toBe("requested_amount");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- tests/forensics/balanceFormingTransfers.test.ts
```

Expected: FAIL because `selectBalanceFormingTransfers` still uses `currentBalanceRaw` as the only target and includes `tx-old-large`.

- [ ] **Step 3: Extend selection types**

Modify `src/types.ts` so `BalanceFormingSelection` becomes:

```ts
export type BalanceFormingSelection = {
  transfers: BalanceFormingTransfer[];
  currentBalanceRaw: string | null;
  requestedAmountRaw: string | null;
  targetAmountRaw: string;
  selectedAmountRaw: string;
  selectedVolumeRaw: string;
  coverageRatio: number;
  currentBalanceCoverageRatio: number;
  selectionMethod: "current_balance" | "requested_amount";
  partial: boolean;
  notes: string[];
};
```

- [ ] **Step 4: Implement requested amount selection**

Modify `src/forensics/balanceFormingTransfers.ts` with this shape:

```ts
export type SelectBalanceFormingTransfersInput = {
  subjectAddress: string;
  currentBalanceRaw: string | null;
  requestedAmountRaw?: string | null;
  edges: ForensicRouteEdge[];
  minCoverageRatio?: number;
};
```

Replace the current target logic with:

```ts
const currentBalanceRaw = parseAmount(input.currentBalanceRaw);
const requestedAmountRaw = parseAmount(input.requestedAmountRaw);
const useRequestedAmount = requestedAmountRaw > 0n;
const targetAmountRaw = useRequestedAmount ? requestedAmountRaw : currentBalanceRaw;

if (targetAmountRaw <= 0n) {
  return {
    transfers: [],
    currentBalanceRaw: input.currentBalanceRaw,
    requestedAmountRaw: input.requestedAmountRaw ?? null,
    targetAmountRaw: "0",
    selectedAmountRaw: "0",
    selectedVolumeRaw: "0",
    coverageRatio: 0,
    currentBalanceCoverageRatio: 0,
    selectionMethod: useRequestedAmount ? "requested_amount" : "current_balance",
    partial: true,
    notes: ["Current USDT balance is zero or unavailable; balance-origin trace cannot prove source funds."]
  };
}
```

Use `targetAmountRaw` in the selection loop:

```ts
if (selectedCoverageRaw >= targetAmountRaw) break;
const remainingRaw = targetAmountRaw - selectedCoverageRaw;
```

Return both target coverage and current-balance coverage:

```ts
const coverageRatio = Math.min(1, ratio(selectedCoverageRaw, targetAmountRaw));
const currentBalanceCoverageRatio = currentBalanceRaw > 0n
  ? Math.min(1, ratio(selectedCoverageRaw, currentBalanceRaw))
  : 0;
```

Use `targetAmountRaw` for `selectionTransfer` coverage share:

```ts
transfers: selected.map((item) => selectionTransfer(item.edge, targetAmountRaw, item.coveredAmountRaw)),
currentBalanceRaw: input.currentBalanceRaw,
requestedAmountRaw: input.requestedAmountRaw ?? null,
targetAmountRaw: targetAmountRaw.toString(),
selectedAmountRaw: selectedVolumeRaw.toString(),
selectedVolumeRaw: selectedVolumeRaw.toString(),
coverageRatio,
currentBalanceCoverageRatio,
selectionMethod: useRequestedAmount ? "requested_amount" : "current_balance",
```

- [ ] **Step 5: Pass requested amount through `runWhereIsMoneyCheck`**

Modify `src/check/whereIsMoneyCheck.ts`:

```ts
export type RunWhereIsMoneyCheckInput = {
  sourceAddress: string;
  requestedAmountRaw?: string | null;
  windowStart: Date;
  windowEnd: Date;
  maxDepth?: number;
  beamWidth?: number;
  maxAddressFetches?: number;
  maxEdgesPerAddress?: number;
  recentFallbackMinTransferCount?: number;
  recentFallbackTransferLimit?: number;
};
```

Pass it into selection:

```ts
const selection = selectBalanceFormingTransfers({
  subjectAddress: input.sourceAddress,
  currentBalanceRaw,
  requestedAmountRaw: input.requestedAmountRaw,
  edges: sourceEdges
});
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/forensics/balanceFormingTransfers.test.ts tests/check/whereIsMoneyCheck.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/forensics/balanceFormingTransfers.ts src/check/whereIsMoneyCheck.ts tests/forensics/balanceFormingTransfers.test.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "feat: support requested amount in money origin selection"
```

---

### Task 2: Cross-Chain Types And Evidence Helpers

**Files:**
- Modify: `src/types.ts`
- Create: `src/forensics/crossChainEvidence.ts`
- Test: `tests/forensics/crossChainEvidence.test.ts`

- [ ] **Step 1: Add cross-chain report types**

Add to `src/types.ts` after the money-origin types:

```ts
export type ChainId = "tron" | "ethereum" | "arbitrum" | string;

export type ChainAddress = {
  chain: ChainId;
  chainId: string | number;
  address: string;
};

export type CrossChainEvidenceClass =
  | "exact_onchain"
  | "bridge_provider_correlation"
  | "bridge_protocol_correlation"
  | "service_boundary"
  | "weak_inferred";

export type CrossChainEvidenceStrength = "strong" | "medium" | "weak" | "boundary";

export type CrossChainEdgeType =
  | "token_transfer"
  | "native_transfer"
  | "internal_transfer"
  | "dex_swap"
  | "liquidity_add"
  | "liquidity_remove"
  | "bridge_source"
  | "bridge_destination"
  | "bridge_protocol_link"
  | "service_boundary"
  | "cex_boundary"
  | "tornado_withdrawal"
  | "unknown_token_liquidity";

export type CrossChainRouteEdge = {
  id: string;
  edgeType: CrossChainEdgeType;
  evidenceClass: CrossChainEvidenceClass;
  evidenceStrength: CrossChainEvidenceStrength;
  source: ChainAddress | null;
  destination: ChainAddress | null;
  txHash: string | null;
  sourceTxHash?: string | null;
  destinationTxHash?: string | null;
  blockNumber?: number | null;
  logIndex?: number | null;
  assetSymbol?: string | null;
  tokenContract?: string | null;
  amountRaw?: string | null;
  decimals?: number | null;
  timestamp: string | null;
  protocol?: string | null;
  provider: "range" | "tronscan" | "etherscan" | "alchemy" | "layerzeroscan" | "local";
  providerPayloadId: string | null;
  labels: string[];
};

export type Stage2TriggerReason =
  | "large_bridge_boundary"
  | "large_split_flow_boundary"
  | "medium_amount_direct_high_risk"
  | "manual_deep_mode";

export type CrossChainTerminalBoundary =
  | "tornado_or_mixer"
  | "no_name_token_liquidity"
  | "bridge_boundary"
  | "dex_router_boundary"
  | "cex_boundary"
  | "unknown_contract"
  | "data_exhausted"
  | "none";

export type CrossChainCorridorPath = {
  id: string;
  triggerReason: Stage2TriggerReason;
  balanceTransferTxHashes: string[];
  targetAmountRaw: string;
  selectedAmountRaw: string;
  edges: CrossChainRouteEdge[];
  terminalBoundary: CrossChainTerminalBoundary;
  evidenceStrength: CrossChainEvidenceStrength;
  verdict: ExchangeDecision;
  riskScoreContribution: number;
  reasons: string[];
};

export type CrossChainCorridorReport = {
  enabled: boolean;
  triggered: boolean;
  skippedReason: string | null;
  paths: CrossChainCorridorPath[];
  providerCalls: number;
  partial: boolean;
  coverageNotes: string[];
};
```

Extend `WhereIsMoneyReport`:

```ts
crossChainCorridor?: CrossChainCorridorReport;
```

- [ ] **Step 2: Write evidence helper tests**

Create `tests/forensics/crossChainEvidence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isAtLeastUsdt,
  normalizeUsdtRaw,
  strongestEvidence
} from "../../src/forensics/crossChainEvidence";
import type { CrossChainEvidenceStrength } from "../../src/types";

describe("cross chain evidence helpers", () => {
  it("normalizes decimal USDT amounts into raw 6-decimal units", () => {
    expect(normalizeUsdtRaw("100000")).toBe("100000000000");
    expect(normalizeUsdtRaw("100000.25")).toBe("100000250000");
    expect(normalizeUsdtRaw("0.000001")).toBe("1");
  });

  it("compares raw USDT amounts against decimal thresholds", () => {
    expect(isAtLeastUsdt("100000000000", "100000")).toBe(true);
    expect(isAtLeastUsdt("99999999999", "100000")).toBe(false);
  });

  it("selects the strongest evidence value", () => {
    const values: CrossChainEvidenceStrength[] = ["weak", "boundary", "strong", "medium"];
    expect(strongestEvidence(values)).toBe("strong");
  });
});
```

- [ ] **Step 3: Run test to verify missing module**

Run:

```bash
npm test -- tests/forensics/crossChainEvidence.test.ts
```

Expected: FAIL with module resolution error for `crossChainEvidence`.

- [ ] **Step 4: Implement helpers**

Create `src/forensics/crossChainEvidence.ts`:

```ts
import type { CrossChainEvidenceStrength } from "../types";

const USDT_DECIMALS = 6n;
const TEN = 10n;

function parseRaw(value: string | null | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

export function normalizeUsdtRaw(decimalAmount: string): string {
  const trimmed = decimalAmount.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return "0";
  const [whole, fraction = ""] = trimmed.split(".");
  const padded = fraction.padEnd(Number(USDT_DECIMALS), "0");
  return (BigInt(whole) * TEN ** USDT_DECIMALS + BigInt(padded || "0")).toString();
}

export function isAtLeastUsdt(rawAmount: string | null | undefined, decimalThreshold: string): boolean {
  return parseRaw(rawAmount) >= parseRaw(normalizeUsdtRaw(decimalThreshold));
}

export function sumRawAmounts(values: Array<string | null | undefined>): string {
  return values.reduce((sum, value) => sum + parseRaw(value), 0n).toString();
}

export function strongestEvidence(values: CrossChainEvidenceStrength[]): CrossChainEvidenceStrength {
  const rank: Record<CrossChainEvidenceStrength, number> = {
    weak: 1,
    boundary: 2,
    medium: 3,
    strong: 4
  };
  return values.sort((left, right) => rank[right] - rank[left])[0] ?? "weak";
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/forensics/crossChainEvidence.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/forensics/crossChainEvidence.ts tests/forensics/crossChainEvidence.test.ts
git commit -m "feat: add cross-chain evidence types"
```

---

### Task 3: Stage 2 Trigger Evaluator

**Files:**
- Create: `src/forensics/crossChainStage2Triggers.ts`
- Test: `tests/forensics/crossChainStage2Triggers.test.ts`

- [ ] **Step 1: Write trigger evaluator tests**

Create `tests/forensics/crossChainStage2Triggers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluateCrossChainStage2Trigger } from "../../src/forensics/crossChainStage2Triggers";
import type { BalanceFormingSelection, MoneyOriginPath, ServiceClassification } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const bridge = "TBridge1111111111111111111111111111";
const clean = "TClean11111111111111111111111111111";

function service(category: ServiceClassification["category"], identity: string | null): ServiceClassification {
  return { category, identity, confidence: "high", evidence: identity ? [`tag:${identity}`] : [], isBoundary: category !== "none" };
}

function selection(amountRaw: string, txHashes: string[]): BalanceFormingSelection {
  return {
    transfers: txHashes.map((txHash, index) => ({
      txHash,
      fromAddress: index === 0 ? bridge : `${bridge}${index}`,
      toAddress: subject,
      amountRaw,
      timestamp: `2026-05-22T10:0${index}:00.000Z`,
      coverageShare: 1 / txHashes.length,
      selectedReason: "covers_current_balance"
    })),
    currentBalanceRaw: amountRaw,
    requestedAmountRaw: null,
    targetAmountRaw: amountRaw,
    selectedAmountRaw: (BigInt(amountRaw) * BigInt(txHashes.length)).toString(),
    selectedVolumeRaw: (BigInt(amountRaw) * BigInt(txHashes.length)).toString(),
    coverageRatio: 1,
    currentBalanceCoverageRatio: 1,
    selectionMethod: "current_balance",
    partial: false,
    notes: []
  };
}

function path(txHash: string, rootAddress: string, category: ServiceClassification["category"]): MoneyOriginPath {
  return {
    balanceTransferTxHash: txHash,
    rootSourceAddress: rootAddress,
    rootSourceType: category === "none" ? "incomplete" : "decline_boundary",
    balanceShare: 1,
    pathAddresses: [rootAddress, subject],
    txHashes: [txHash],
    steps: [{ txHash, fromAddress: rootAddress, toAddress: subject, amountRaw: "100000000000", timestamp: "2026-05-22T10:00:00.000Z" }],
    amountPreservationRatio: 1,
    timeSpanMs: 0,
    stoppedReason: category === "none" ? "data_budget_exhausted" : "decline_boundary_reached",
    verdict: category === "none" ? "REVIEW" : "DECLINE",
    riskScoreContribution: category === "none" ? 45 : 78,
    reasons: ["fixture"]
  };
}

describe("evaluateCrossChainStage2Trigger", () => {
  it("triggers on a large selected bridge leg", () => {
    const result = evaluateCrossChainStage2Trigger({
      selection: selection("100000000000", ["tx-large"]),
      originPaths: [path("tx-large", bridge, "bridge")],
      classifications: new Map([[bridge, service("bridge", "Stargate")]])
    });

    expect(result).toMatchObject({ triggered: true, reason: "large_bridge_boundary" });
  });

  it("triggers on a split flow through service boundaries", () => {
    const result = evaluateCrossChainStage2Trigger({
      selection: selection("60000000000", ["tx-a", "tx-b"]),
      originPaths: [path("tx-a", bridge, "bridge"), path("tx-b", `${bridge}1`, "bridge")],
      classifications: new Map([[bridge, service("bridge", "Stargate")], [`${bridge}1`, service("bridge", "Stargate")]])
    });

    expect(result).toMatchObject({ triggered: true, reason: "large_split_flow_boundary" });
  });

  it("does not trigger for a small single bridge transfer", () => {
    const result = evaluateCrossChainStage2Trigger({
      selection: selection("9000000000", ["tx-small"]),
      originPaths: [path("tx-small", bridge, "bridge")],
      classifications: new Map([[bridge, service("bridge", "Stargate")]])
    });

    expect(result.triggered).toBe(false);
    expect(result.skippedReason).toContain("below threshold");
  });

  it("triggers for medium amount with a direct high-risk label", () => {
    const result = evaluateCrossChainStage2Trigger({
      selection: selection("50000000000", ["tx-medium"]),
      originPaths: [path("tx-medium", clean, "none")],
      classifications: new Map([[clean, service("none", null)]]),
      directHighRiskLabels: new Map([[clean, ["mixer_like"]])
    });

    expect(result).toMatchObject({ triggered: true, reason: "medium_amount_direct_high_risk" });
  });
});
```

- [ ] **Step 2: Run test to verify missing module**

Run:

```bash
npm test -- tests/forensics/crossChainStage2Triggers.test.ts
```

Expected: FAIL with module resolution error.

- [ ] **Step 3: Implement trigger evaluator**

Create `src/forensics/crossChainStage2Triggers.ts`:

```ts
import type {
  BalanceFormingSelection,
  MoneyOriginPath,
  ServiceClassification,
  Stage2TriggerReason
} from "../types";
import { isAtLeastUsdt, sumRawAmounts } from "./crossChainEvidence";

export type CrossChainStage2TriggerEvaluation = {
  triggered: boolean;
  reason: Stage2TriggerReason | null;
  balanceTransferTxHashes: string[];
  targetAmountRaw: string;
  selectedAmountRaw: string;
  skippedReason: string | null;
};

export type EvaluateCrossChainStage2TriggerInput = {
  selection: BalanceFormingSelection;
  originPaths: MoneyOriginPath[];
  classifications: Map<string, ServiceClassification | null>;
  directHighRiskLabels?: Map<string, string[]>;
  largeThresholdUsdt?: string;
  mediumThresholdUsdt?: string;
  lowThresholdUsdt?: string;
};

const BOUNDARY_CATEGORIES = new Set<ServiceClassification["category"]>([
  "bridge",
  "bridge_pool",
  "dex",
  "router",
  "swap_adapter",
  "unknown_contract"
]);

function pathBoundaryAddress(path: MoneyOriginPath): string | null {
  return path.rootSourceAddress ?? path.pathAddresses[0] ?? null;
}

function isBoundary(classification: ServiceClassification | null | undefined): boolean {
  return Boolean(classification && classification.isBoundary && BOUNDARY_CATEGORIES.has(classification.category));
}

function hasDirectHighRisk(address: string | null, labels: Map<string, string[]>): boolean {
  if (!address) return false;
  const values = labels.get(address) ?? [];
  return values.some((label) =>
    label === "mixer_like" ||
    label === "sanctioned" ||
    label === "tornado" ||
    label === "approval_drain" ||
    label === "no_name_token_liquidity"
  );
}

export function evaluateCrossChainStage2Trigger(
  input: EvaluateCrossChainStage2TriggerInput
): CrossChainStage2TriggerEvaluation {
  const largeThreshold = input.largeThresholdUsdt ?? "100000";
  const mediumThreshold = input.mediumThresholdUsdt ?? "10000";
  const labels = input.directHighRiskLabels ?? new Map();
  const pathByTx = new Map(input.originPaths.map((path) => [path.balanceTransferTxHash, path]));

  for (const transfer of input.selection.transfers) {
    const path = pathByTx.get(transfer.txHash) ?? null;
    const boundaryAddress = pathBoundaryAddress(path ?? {
      rootSourceAddress: transfer.fromAddress,
      pathAddresses: [transfer.fromAddress]
    } as MoneyOriginPath);
    const classification = boundaryAddress ? input.classifications.get(boundaryAddress) ?? null : null;
    if (isAtLeastUsdt(transfer.amountRaw, largeThreshold) && isBoundary(classification)) {
      return {
        triggered: true,
        reason: "large_bridge_boundary",
        balanceTransferTxHashes: [transfer.txHash],
        targetAmountRaw: input.selection.targetAmountRaw,
        selectedAmountRaw: transfer.amountRaw,
        skippedReason: null
      };
    }
  }

  const boundaryTransfers = input.selection.transfers.filter((transfer) => {
    const path = pathByTx.get(transfer.txHash) ?? null;
    const address = pathBoundaryAddress(path ?? null);
    return isBoundary(address ? input.classifications.get(address) ?? null : null);
  });
  const boundaryTotal = sumRawAmounts(boundaryTransfers.map((transfer) => transfer.amountRaw));
  if (boundaryTransfers.length >= 2 && isAtLeastUsdt(boundaryTotal, largeThreshold)) {
    return {
      triggered: true,
      reason: "large_split_flow_boundary",
      balanceTransferTxHashes: boundaryTransfers.map((transfer) => transfer.txHash),
      targetAmountRaw: input.selection.targetAmountRaw,
      selectedAmountRaw: boundaryTotal,
      skippedReason: null
    };
  }

  const selectedTotal = sumRawAmounts(input.selection.transfers.map((transfer) => transfer.amountRaw));
  if (isAtLeastUsdt(selectedTotal, mediumThreshold) && !isAtLeastUsdt(selectedTotal, largeThreshold)) {
    const highRisk = input.originPaths.find((path) => hasDirectHighRisk(pathBoundaryAddress(path), labels));
    if (highRisk) {
      return {
        triggered: true,
        reason: "medium_amount_direct_high_risk",
        balanceTransferTxHashes: [highRisk.balanceTransferTxHash],
        targetAmountRaw: input.selection.targetAmountRaw,
        selectedAmountRaw: selectedTotal,
        skippedReason: null
      };
    }
  }

  return {
    triggered: false,
    reason: null,
    balanceTransferTxHashes: [],
    targetAmountRaw: input.selection.targetAmountRaw,
    selectedAmountRaw: selectedTotal,
    skippedReason: "Cross-chain Stage 2 was not auto-run because selected amount or direct-risk evidence is below threshold."
  };
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/forensics/crossChainStage2Triggers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/crossChainStage2Triggers.ts tests/forensics/crossChainStage2Triggers.test.ts
git commit -m "feat: add cross-chain stage 2 trigger evaluator"
```

---

### Task 4: Provider Interface And Fixture Provider

**Files:**
- Create: `src/forensics/crossChainProviders.ts`
- Test: `tests/forensics/crossChainProviders.test.ts`

- [ ] **Step 1: Write provider tests**

Create `tests/forensics/crossChainProviders.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFixtureCrossChainDiscoveryProvider } from "../../src/forensics/crossChainProviders";

describe("fixture cross-chain discovery provider", () => {
  it("returns transfers by address and tx hash", async () => {
    const provider = createFixtureCrossChainDiscoveryProvider({
      transfers: [
        {
          id: "range-1",
          source: { chain: "ethereum", chainId: 1, address: "0xSource" },
          destination: { chain: "tron", chainId: "tron", address: "TTarget" },
          sourceTxHash: "0xsource",
          destinationTxHash: "tx-tron",
          assetSymbol: "USDT",
          amountRaw: "100000000000",
          timestamp: "2026-05-05T02:41:59.000Z",
          protocol: "LayerZero",
          providerPayloadId: "payload-1",
          labels: ["stargate"]
        }
      ],
      risks: []
    });

    await expect(provider.findTransfersByAddress({
      address: { chain: "tron", chainId: "tron", address: "TTarget" }
    })).resolves.toHaveLength(1);

    await expect(provider.findTransfersByTx({ txHash: "0xsource" })).resolves.toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify missing module**

Run:

```bash
npm test -- tests/forensics/crossChainProviders.test.ts
```

Expected: FAIL with module resolution error.

- [ ] **Step 3: Implement provider interface**

Create `src/forensics/crossChainProviders.ts`:

```ts
import type { ChainAddress } from "../types";

export type CrossChainTransfer = {
  id: string;
  source: ChainAddress | null;
  destination: ChainAddress | null;
  sourceTxHash: string | null;
  destinationTxHash: string | null;
  assetSymbol: string | null;
  amountRaw: string | null;
  timestamp: string | null;
  protocol: string | null;
  providerPayloadId: string | null;
  labels: string[];
};

export type ProviderRiskSnapshot = {
  address: ChainAddress;
  riskScore: number;
  labels: string[];
  providerPayloadId: string | null;
};

export type CrossChainDiscoveryQuery = {
  address?: ChainAddress;
  txHash?: string;
  sourceChain?: string;
  destinationChain?: string;
  assetSymbol?: string;
  amountRaw?: string;
  windowStart?: string;
  windowEnd?: string;
  limit?: number;
};

export interface CrossChainDiscoveryProvider {
  findTransfersByAddress(input: CrossChainDiscoveryQuery): Promise<CrossChainTransfer[]>;
  findTransfersByTx(input: CrossChainDiscoveryQuery): Promise<CrossChainTransfer[]>;
  getAddressRisk(input: { address: ChainAddress }): Promise<ProviderRiskSnapshot | null>;
}

function sameAddress(left: ChainAddress | null, right: ChainAddress): boolean {
  return Boolean(left && left.chain === right.chain && left.address.toLowerCase() === right.address.toLowerCase());
}

export function createFixtureCrossChainDiscoveryProvider(input: {
  transfers: CrossChainTransfer[];
  risks: ProviderRiskSnapshot[];
}): CrossChainDiscoveryProvider {
  return {
    async findTransfersByAddress(query) {
      if (!query.address) return [];
      return input.transfers
        .filter((transfer) => sameAddress(transfer.source, query.address!) || sameAddress(transfer.destination, query.address!))
        .slice(0, query.limit ?? input.transfers.length);
    },
    async findTransfersByTx(query) {
      if (!query.txHash) return [];
      const needle = query.txHash.toLowerCase();
      return input.transfers
        .filter((transfer) =>
          transfer.sourceTxHash?.toLowerCase() === needle ||
          transfer.destinationTxHash?.toLowerCase() === needle
        )
        .slice(0, query.limit ?? input.transfers.length);
    },
    async getAddressRisk(query) {
      return input.risks.find((risk) => sameAddress(risk.address, query.address)) ?? null;
    }
  };
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/forensics/crossChainProviders.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/crossChainProviders.ts tests/forensics/crossChainProviders.test.ts
git commit -m "feat: add cross-chain discovery provider interface"
```

---

### Task 5: Cross-Chain Corridor Expander And Scorer

**Files:**
- Create: `src/forensics/crossChainCorridor.ts`
- Test: `tests/forensics/crossChainCorridor.test.ts`

- [ ] **Step 1: Write corridor tests**

Create `tests/forensics/crossChainCorridor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runCrossChainCorridorAnalysis } from "../../src/forensics/crossChainCorridor";
import { createFixtureCrossChainDiscoveryProvider } from "../../src/forensics/crossChainProviders";

describe("runCrossChainCorridorAnalysis", () => {
  it("declines high risk when Range links a bridge transfer to no-name token liquidity", async () => {
    const provider = createFixtureCrossChainDiscoveryProvider({
      transfers: [
        {
          id: "range-tron-eth",
          source: { chain: "ethereum", chainId: 1, address: "0x2cFEEE2394aC0f01c92CDaDCb697feC0cF8Da315" },
          destination: { chain: "tron", chainId: "tron", address: "TGyTBZAZD" },
          sourceTxHash: "0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f",
          destinationTxHash: "tx-tron",
          assetSymbol: "USDT",
          amountRaw: "100000000000",
          timestamp: "2026-05-05T02:41:59.000Z",
          protocol: "LayerZero",
          providerPayloadId: "payload-1",
          labels: ["stargate"]
        }
      ],
      risks: []
    });

    const report = await runCrossChainCorridorAnalysis({
      provider,
      trigger: {
        triggered: true,
        reason: "large_bridge_boundary",
        balanceTransferTxHashes: ["tx-tron"],
        targetAmountRaw: "100000000000",
        selectedAmountRaw: "100000000000",
        skippedReason: null
      },
      subject: { chain: "tron", chainId: "tron", address: "TGyTBZAZD" },
      directEvidence: [
        {
          kind: "no_name_token_liquidity",
          txHash: "0x13d4b0df449c37ec866773c989bfad0d4b93d7424f7bfa84699fa0be523dc6fd",
          address: "0x1996d86e55b33aeef2c9f50b3086a91656a284db",
          label: "GARY no-name token liquidity"
        }
      ]
    });

    expect(report.triggered).toBe(true);
    expect(report.paths[0]).toMatchObject({
      terminalBoundary: "no_name_token_liquidity",
      verdict: "DECLINE",
      riskScoreContribution: 78
    });
  });

  it("preserves partial coverage when provider fails", async () => {
    const provider = {
      findTransfersByAddress: async () => { throw new Error("range unavailable"); },
      findTransfersByTx: async () => { throw new Error("range unavailable"); },
      getAddressRisk: async () => null
    };

    const report = await runCrossChainCorridorAnalysis({
      provider,
      trigger: {
        triggered: true,
        reason: "large_bridge_boundary",
        balanceTransferTxHashes: ["tx-tron"],
        targetAmountRaw: "100000000000",
        selectedAmountRaw: "100000000000",
        skippedReason: null
      },
      subject: { chain: "tron", chainId: "tron", address: "TTarget" },
      directEvidence: []
    });

    expect(report).toMatchObject({
      enabled: true,
      triggered: true,
      partial: true,
      paths: []
    });
    expect(report.coverageNotes[0]).toContain("Stage 2 provider failed");
  });
});
```

- [ ] **Step 2: Run test to verify missing module**

Run:

```bash
npm test -- tests/forensics/crossChainCorridor.test.ts
```

Expected: FAIL with module resolution error.

- [ ] **Step 3: Implement corridor analysis**

Create `src/forensics/crossChainCorridor.ts`:

```ts
import type {
  ChainAddress,
  CrossChainCorridorPath,
  CrossChainCorridorReport,
  CrossChainRouteEdge
} from "../types";
import type { CrossChainDiscoveryProvider } from "./crossChainProviders";
import type { CrossChainStage2TriggerEvaluation } from "./crossChainStage2Triggers";

export type DirectCrossChainEvidence = {
  kind: "no_name_token_liquidity" | "tornado_or_mixer";
  txHash: string;
  address: string;
  label: string;
};

export type RunCrossChainCorridorAnalysisInput = {
  provider: CrossChainDiscoveryProvider;
  trigger: CrossChainStage2TriggerEvaluation;
  subject: ChainAddress;
  directEvidence: DirectCrossChainEvidence[];
};

function edgeFromDirectEvidence(item: DirectCrossChainEvidence): CrossChainRouteEdge {
  return {
    id: `${item.kind}:${item.txHash}:${item.address}`,
    edgeType: item.kind === "no_name_token_liquidity" ? "unknown_token_liquidity" : "tornado_withdrawal",
    evidenceClass: "exact_onchain",
    evidenceStrength: "strong",
    source: null,
    destination: null,
    txHash: item.txHash,
    assetSymbol: null,
    tokenContract: item.address,
    amountRaw: null,
    decimals: null,
    timestamp: null,
    protocol: null,
    provider: "local",
    providerPayloadId: null,
    labels: [item.label]
  };
}

function edgeFromRangeTransfer(transfer: Awaited<ReturnType<CrossChainDiscoveryProvider["findTransfersByAddress"]>>[number]): CrossChainRouteEdge {
  return {
    id: transfer.id,
    edgeType: "bridge_protocol_link",
    evidenceClass: "bridge_provider_correlation",
    evidenceStrength: "strong",
    source: transfer.source,
    destination: transfer.destination,
    txHash: transfer.sourceTxHash ?? transfer.destinationTxHash,
    sourceTxHash: transfer.sourceTxHash,
    destinationTxHash: transfer.destinationTxHash,
    assetSymbol: transfer.assetSymbol,
    tokenContract: null,
    amountRaw: transfer.amountRaw,
    decimals: 6,
    timestamp: transfer.timestamp,
    protocol: transfer.protocol,
    provider: "range",
    providerPayloadId: transfer.providerPayloadId,
    labels: transfer.labels
  };
}

function pathFromEvidence(input: {
  trigger: CrossChainStage2TriggerEvaluation;
  rangeEdges: CrossChainRouteEdge[];
  directEvidence: DirectCrossChainEvidence[];
}): CrossChainCorridorPath {
  const directEdges = input.directEvidence.map(edgeFromDirectEvidence);
  const hasTornado = input.directEvidence.some((item) => item.kind === "tornado_or_mixer");
  const hasNoName = input.directEvidence.some((item) => item.kind === "no_name_token_liquidity");
  const terminalBoundary = hasTornado ? "tornado_or_mixer" : hasNoName ? "no_name_token_liquidity" : "bridge_boundary";
  const riskScoreContribution = hasTornado ? 92 : hasNoName ? 78 : 70;
  const reasons = hasTornado
    ? ["Cross-chain corridor reaches Tornado or mixer evidence; exchange policy declines this source."]
    : hasNoName
      ? ["Cross-chain corridor reaches no-name token liquidity; exchange policy declines this high-risk source."]
      : ["Cross-chain corridor reaches a bridge boundary; public-chain continuity after this boundary is partial."];
  return {
    id: `cross-chain:${input.trigger.balanceTransferTxHashes.join(",")}`,
    triggerReason: input.trigger.reason ?? "manual_deep_mode",
    balanceTransferTxHashes: input.trigger.balanceTransferTxHashes,
    targetAmountRaw: input.trigger.targetAmountRaw,
    selectedAmountRaw: input.trigger.selectedAmountRaw,
    edges: [...input.rangeEdges, ...directEdges],
    terminalBoundary,
    evidenceStrength: "strong",
    verdict: "DECLINE",
    riskScoreContribution,
    reasons
  };
}

export async function runCrossChainCorridorAnalysis(
  input: RunCrossChainCorridorAnalysisInput
): Promise<CrossChainCorridorReport> {
  if (!input.trigger.triggered) {
    return {
      enabled: true,
      triggered: false,
      skippedReason: input.trigger.skippedReason,
      paths: [],
      providerCalls: 0,
      partial: false,
      coverageNotes: input.trigger.skippedReason ? [input.trigger.skippedReason] : []
    };
  }

  try {
    const transfers = await input.provider.findTransfersByAddress({ address: input.subject, limit: 20 });
    const rangeEdges = transfers.map(edgeFromRangeTransfer);
    return {
      enabled: true,
      triggered: true,
      skippedReason: null,
      paths: [pathFromEvidence({ trigger: input.trigger, rangeEdges, directEvidence: input.directEvidence })],
      providerCalls: 1,
      partial: rangeEdges.length === 0,
      coverageNotes: rangeEdges.length === 0 ? ["Stage 2 found no provider-correlated cross-chain transfers."] : []
    };
  } catch (error) {
    return {
      enabled: true,
      triggered: true,
      skippedReason: null,
      paths: [],
      providerCalls: 1,
      partial: true,
      coverageNotes: [`Stage 2 provider failed: ${error instanceof Error ? error.message : "unknown error"}.`]
    };
  }
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/forensics/crossChainCorridor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/crossChainCorridor.ts tests/forensics/crossChainCorridor.test.ts
git commit -m "feat: add cross-chain corridor analysis"
```

---

### Task 6: Wire Stage 2 Into `runWhereIsMoneyCheck`

**Files:**
- Modify: `src/check/whereIsMoneyCheck.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Add Stage 2 dependency and test**

Add imports in `tests/check/whereIsMoneyCheck.test.ts`:

```ts
import { createFixtureCrossChainDiscoveryProvider } from "../../src/forensics/crossChainProviders";
```

Add a test:

```ts
it("adds cross-chain corridor report when a large bridge balance transfer triggers Stage 2", async () => {
  const byAddress = new Map<string, ForensicRouteEdge[]>([
    [subject, [edge("tx-bridge-subject", bridge, subject, "100000000000", "2026-05-22T10:00:00.000Z")]],
    [bridge, []]
  ]);
  const provider = createFixtureCrossChainDiscoveryProvider({
    transfers: [{
      id: "range-bridge",
      source: { chain: "ethereum", chainId: 1, address: "0xSource" },
      destination: { chain: "tron", chainId: "tron", address: subject },
      sourceTxHash: "0xsource",
      destinationTxHash: "tx-bridge-subject",
      assetSymbol: "USDT",
      amountRaw: "100000000000",
      timestamp: "2026-05-22T10:01:00.000Z",
      protocol: "LayerZero",
      providerPayloadId: "payload-bridge",
      labels: ["stargate"]
    }],
    risks: []
  });

  const report = await runWhereIsMoneyCheck({
    getTrc20Balance: async () => "100000000000",
    fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
    getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
    getClassificationForAddress: async (address) => address === bridge ? service("bridge", "Stargate") : service("none", null),
    getFastWalletRisk: async () => lowFastRisk,
    crossChainDiscoveryProvider: provider
  }, {
    sourceAddress: subject,
    windowStart: new Date("2026-05-01T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z")
  });

  expect(report.crossChainCorridor).toMatchObject({
    enabled: true,
    triggered: true,
    partial: false
  });
  expect(report.decision).toBe("DECLINE");
  expect(report.riskScore).toBeGreaterThanOrEqual(78);
});
```

- [ ] **Step 2: Run test to verify type/dependency failure**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

Expected: FAIL because `WhereIsMoneyDeps` does not include `crossChainDiscoveryProvider`.

- [ ] **Step 3: Add deps and wiring**

Modify `src/check/whereIsMoneyCheck.ts` imports:

```ts
import { runCrossChainCorridorAnalysis } from "../forensics/crossChainCorridor";
import type { CrossChainDiscoveryProvider } from "../forensics/crossChainProviders";
import { evaluateCrossChainStage2Trigger } from "../forensics/crossChainStage2Triggers";
```

Extend `WhereIsMoneyDeps`:

```ts
crossChainDiscoveryProvider?: CrossChainDiscoveryProvider;
```

After classifications are populated and before final return, build a classifications map for origin path boundary addresses:

```ts
for (const path of originPaths) {
  for (const address of path.pathAddresses) {
    await getCachedClassification(address);
  }
}
```

Evaluate Stage 2:

```ts
const crossChainTrigger = evaluateCrossChainStage2Trigger({
  selection,
  originPaths,
  classifications
});
const crossChainCorridor = deps.crossChainDiscoveryProvider
  ? await runCrossChainCorridorAnalysis({
      provider: deps.crossChainDiscoveryProvider,
      trigger: crossChainTrigger,
      subject: { chain: "tron", chainId: "tron", address: input.sourceAddress },
      directEvidence: []
    })
  : {
      enabled: false,
      triggered: crossChainTrigger.triggered,
      skippedReason: crossChainTrigger.triggered ? "Stage 2 provider is not configured." : crossChainTrigger.skippedReason,
      paths: [],
      providerCalls: 0,
      partial: crossChainTrigger.triggered,
      coverageNotes: crossChainTrigger.triggered ? ["Stage 2 provider is not configured."] : []
    };
```

Combine score:

```ts
const crossChainScore = Math.max(0, ...crossChainCorridor.paths.map((path) => path.riskScoreContribution));
riskScore = Math.max(riskScore, crossChainScore);
if (crossChainCorridor.paths.some((path) => path.verdict === "DECLINE")) {
  decision = "DECLINE";
  decisionReasons = [
    ...crossChainCorridor.paths.flatMap((path) => path.reasons),
    ...decisionReasons
  ].slice(0, 8);
}
```

Include in returned report:

```ts
crossChainCorridor,
```

Add coverage notes:

```ts
...crossChainCorridor.coverageNotes
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts tests/forensics/crossChainStage2Triggers.test.ts tests/forensics/crossChainCorridor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/check/whereIsMoneyCheck.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "feat: wire cross-chain corridor into where is money"
```

---

### Task 7: Range Client And Config

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`
- Create: `src/forensics/rangeClient.ts`
- Test: `tests/config/config.test.ts`
- Test: `tests/forensics/rangeClient.test.ts`

- [ ] **Step 1: Add config tests**

Add to `tests/config/config.test.ts`:

```ts
it("loads optional Range API config", () => {
  const previous = process.env;
  process.env = {
    ...previous,
    BOT_TOKEN: "token",
    DATABASE_URL: "postgres://user:pass@localhost:5432/db",
    RANGE_API_KEY: "range-key",
    RANGE_BASE_URL: "https://api.range.org",
    CROSS_CHAIN_STAGE2_ENABLED: "true"
  };

  const config = loadConfig();

  expect(config.rangeApiKey).toBe("range-key");
  expect(config.rangeBaseUrl.toString()).toBe("https://api.range.org/");
  expect(config.crossChainStage2Enabled).toBe(true);

  process.env = previous;
});
```

- [ ] **Step 2: Add config fields**

Modify `src/config.ts` `AppConfig`:

```ts
rangeApiKey: string | undefined;
rangeBaseUrl: URL;
crossChainStage2Enabled: boolean;
```

Add in `loadConfig()`:

```ts
rangeApiKey: process.env.RANGE_API_KEY?.trim() || undefined,
rangeBaseUrl: withTrailingSlash(parseHttpsUrl("RANGE_BASE_URL", process.env.RANGE_BASE_URL ?? "https://api.range.org")),
crossChainStage2Enabled: parseBooleanFlag("CROSS_CHAIN_STAGE2_ENABLED", process.env.CROSS_CHAIN_STAGE2_ENABLED, false),
```

Update `.env.example`:

```text
RANGE_API_KEY=
RANGE_BASE_URL=https://api.range.org
CROSS_CHAIN_STAGE2_ENABLED=false
```

- [ ] **Step 3: Write Range client tests**

Create `tests/forensics/rangeClient.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createRangeCrossChainDiscoveryProvider } from "../../src/forensics/rangeClient";

describe("Range cross-chain provider", () => {
  it("sends bearer auth and normalizes transfer rows", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = createRangeCrossChainDiscoveryProvider({
      apiKey: "range-key",
      baseUrl: new URL("https://api.range.org/"),
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({
          transfers: [{
            id: "range-1",
            source: { chain: "ethereum", chainId: 1, address: "0xSource" },
            destination: { chain: "tron", chainId: "tron", address: "TTarget" },
            sourceTxHash: "0xsource",
            destinationTxHash: "tx-tron",
            assetSymbol: "USDT",
            amountRaw: "100000000000",
            timestamp: "2026-05-05T02:41:59.000Z",
            protocol: "LayerZero",
            labels: ["stargate"]
          }]
        }), { status: 200 });
      }
    });

    const rows = await provider.findTransfersByAddress({
      address: { chain: "tron", chainId: "tron", address: "TTarget" }
    });

    expect(calls[0].init.headers).toMatchObject({ Authorization: "Bearer range-key" });
    expect(rows[0]).toMatchObject({
      sourceTxHash: "0xsource",
      destinationTxHash: "tx-tron",
      providerPayloadId: "range-1"
    });
  });
});
```

- [ ] **Step 4: Implement Range provider**

Create `src/forensics/rangeClient.ts`:

```ts
import type { ChainAddress } from "../types";
import type {
  CrossChainDiscoveryProvider,
  CrossChainDiscoveryQuery,
  CrossChainTransfer,
  ProviderRiskSnapshot
} from "./crossChainProviders";

type RangeProviderInput = {
  apiKey: string;
  baseUrl: URL;
  fetchImpl?: typeof fetch;
};

function headers(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

function appendAddressParams(params: URLSearchParams, address: ChainAddress): void {
  params.set("address", address.address);
  params.set("network", String(address.chain));
}

function normalizeTransfer(row: Record<string, unknown>): CrossChainTransfer {
  const id = String(row.id ?? row.providerPayloadId ?? row.hash ?? crypto.randomUUID());
  return {
    id,
    source: (row.source ?? null) as ChainAddress | null,
    destination: (row.destination ?? null) as ChainAddress | null,
    sourceTxHash: typeof row.sourceTxHash === "string" ? row.sourceTxHash : null,
    destinationTxHash: typeof row.destinationTxHash === "string" ? row.destinationTxHash : null,
    assetSymbol: typeof row.assetSymbol === "string" ? row.assetSymbol : null,
    amountRaw: typeof row.amountRaw === "string" ? row.amountRaw : null,
    timestamp: typeof row.timestamp === "string" ? row.timestamp : null,
    protocol: typeof row.protocol === "string" ? row.protocol : null,
    providerPayloadId: id,
    labels: Array.isArray(row.labels) ? row.labels.filter((item): item is string => typeof item === "string") : []
  };
}

function transfersFromJson(json: unknown): CrossChainTransfer[] {
  const record = json && typeof json === "object" ? json as Record<string, unknown> : {};
  const rows = Array.isArray(record.transfers) ? record.transfers : Array.isArray(record.data) ? record.data : [];
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)))
    .map(normalizeTransfer);
}

export function createRangeCrossChainDiscoveryProvider(input: RangeProviderInput): CrossChainDiscoveryProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  async function getJson(path: string, params: URLSearchParams): Promise<unknown> {
    const url = new URL(path, input.baseUrl);
    url.search = params.toString();
    const response = await fetchImpl(url, { headers: headers(input.apiKey) });
    if (!response.ok) throw new Error(`Range API ${response.status}`);
    return response.json();
  }

  return {
    async findTransfersByAddress(query: CrossChainDiscoveryQuery) {
      if (!query.address) return [];
      const params = new URLSearchParams();
      appendAddressParams(params, query.address);
      if (query.limit) params.set("limit", String(query.limit));
      return transfersFromJson(await getJson("/v1/token-transfers", params));
    },
    async findTransfersByTx(query: CrossChainDiscoveryQuery) {
      if (!query.txHash) return [];
      const params = new URLSearchParams();
      params.set("txHash", query.txHash);
      if (query.limit) params.set("limit", String(query.limit));
      return transfersFromJson(await getJson("/v1/token-transfers", params));
    },
    async getAddressRisk(query: { address: ChainAddress }): Promise<ProviderRiskSnapshot | null> {
      const params = new URLSearchParams();
      appendAddressParams(params, query.address);
      const json = await getJson("/v1/risk/address", params);
      const record = json && typeof json === "object" ? json as Record<string, unknown> : {};
      return {
        address: query.address,
        riskScore: typeof record.riskScore === "number" ? record.riskScore : 0,
        labels: Array.isArray(record.labels) ? record.labels.filter((item): item is string => typeof item === "string") : [],
        providerPayloadId: typeof record.id === "string" ? record.id : null
      };
    }
  };
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/config/config.test.ts tests/forensics/rangeClient.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts .env.example src/forensics/rangeClient.ts tests/config/config.test.ts tests/forensics/rangeClient.test.ts
git commit -m "feat: add Range cross-chain provider config"
```

---

### Task 8: Runtime Wiring And CLI Smoke

**Files:**
- Modify: `src/index.ts`
- Modify: `scripts/forensicWhereIsMoney.ts`
- Test: `tests/bot/createBot.test.ts` only if bot construction needs config injection changes

- [ ] **Step 1: Wire provider in script**

Modify `scripts/forensicWhereIsMoney.ts` imports:

```ts
import { createRangeCrossChainDiscoveryProvider } from "../src/forensics/rangeClient";
```

Create provider near the existing LLM analyzer:

```ts
const crossChainDiscoveryProvider = config.crossChainStage2Enabled && config.rangeApiKey
  ? createRangeCrossChainDiscoveryProvider({
      apiKey: config.rangeApiKey,
      baseUrl: config.rangeBaseUrl
    })
  : undefined;
```

Pass into `runWhereIsMoneyCheck` deps:

```ts
crossChainDiscoveryProvider,
```

- [ ] **Step 2: Wire provider in bot runtime**

Modify `src/index.ts` the same way:

```ts
import { createRangeCrossChainDiscoveryProvider } from "./forensics/rangeClient";
```

Add:

```ts
const crossChainDiscoveryProvider = config.crossChainStage2Enabled && config.rangeApiKey
  ? createRangeCrossChainDiscoveryProvider({
      apiKey: config.rangeApiKey,
      baseUrl: config.rangeBaseUrl
    })
  : undefined;
```

Pass `crossChainDiscoveryProvider` into any `runWhereIsMoneyCheck` dependency object built in runtime wiring.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run Stage 2 related tests**

Run:

```bash
npm test -- tests/forensics/balanceFormingTransfers.test.ts tests/forensics/crossChainEvidence.test.ts tests/forensics/crossChainStage2Triggers.test.ts tests/forensics/crossChainProviders.test.ts tests/forensics/crossChainCorridor.test.ts tests/forensics/rangeClient.test.ts tests/check/whereIsMoneyCheck.test.ts tests/config/config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run CLI dry smoke without Range**

Run the existing CLI with no `RANGE_API_KEY`:

```bash
npm run forensic:where-is-money -- -- --source TSubject111111111111111111111111111111 --days 1 --dry-run
```

Expected: CLI starts with normal validation behavior. If the fake address is rejected by TRON address validation, the expected result is a validation error, not a module import or config crash.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts scripts/forensicWhereIsMoney.ts
git commit -m "feat: wire Range provider into where is money runtime"
```

---

### Task 9: Report Formatting

**Files:**
- Inspect and modify: `src/alerts/formatters.ts`
- Inspect and modify: `src/bot/messages.ts`
- Test: existing formatter/message tests under `tests/alerts` or `tests/bot`

- [ ] **Step 1: Locate current where-is-money report formatter**

Run:

```bash
rg "Where is money|whereIsMoneyReport|balance-forming|Balance-origin|formatManualReport" src tests -n
```

Expected: output includes the formatter that renders `WhereIsMoneyReport`.

- [ ] **Step 2: Add formatting test in the located test file**

Add a fixture assertion that includes:

```ts
crossChainCorridor: {
  enabled: true,
  triggered: true,
  skippedReason: null,
  paths: [{
    id: "cross-chain:tx-bridge",
    triggerReason: "large_bridge_boundary",
    balanceTransferTxHashes: ["tx-bridge"],
    targetAmountRaw: "100000000000",
    selectedAmountRaw: "100000000000",
    edges: [],
    terminalBoundary: "no_name_token_liquidity",
    evidenceStrength: "strong",
    verdict: "DECLINE",
    riskScoreContribution: 78,
    reasons: ["Cross-chain corridor reaches no-name token liquidity; exchange policy declines this high-risk source."]
  }],
  providerCalls: 1,
  partial: false,
  coverageNotes: []
}
```

Expected rendered text must include:

```text
Cross-chain Stage 2
no-name token liquidity
```

- [ ] **Step 3: Run formatter test and verify failure**

Run the specific test file found in Step 1.

Expected: FAIL because Stage 2 section is not rendered.

- [ ] **Step 4: Implement compact Stage 2 formatting**

Add a helper near the existing report formatter:

```ts
function formatCrossChainCorridor(report: CrossChainCorridorReport | undefined): string[] {
  if (!report) return [];
  if (!report.triggered) {
    return report.coverageNotes.length > 0
      ? ["Cross-chain Stage 2: not auto-run.", ...report.coverageNotes]
      : [];
  }
  if (report.paths.length === 0) {
    return ["Cross-chain Stage 2: partial.", ...report.coverageNotes];
  }
  const main = report.paths[0];
  return [
    "Cross-chain Stage 2:",
    ...main.reasons,
    `Evidence strength: ${main.evidenceStrength}.`,
    ...report.coverageNotes
  ];
}
```

Use it in the final report lines:

```ts
...formatCrossChainCorridor(report.crossChainCorridor),
```

- [ ] **Step 5: Run formatter tests**

Run:

```bash
npm test -- tests/alerts tests/bot
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/alerts/formatters.ts src/bot/messages.ts tests/alerts tests/bot
git commit -m "feat: show cross-chain corridor in reports"
```

---

### Task 10: Final Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run full typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Check git diff**

Run:

```bash
git status --short
git diff --check
```

Expected:

```text
git diff --check
```

prints no whitespace errors. `git status --short` should only show intentional final documentation or generated files.

- [ ] **Step 4: Commit final adjustments if needed**

If Task 10 required any small fixes:

```bash
git add <changed-files>
git commit -m "test: verify where is money stage 2"
```

If there are no changes, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Stage 1 requested amount support is covered by Task 1.
- Stage 1.5 trigger evaluation is covered by Task 3.
- Cross-chain evidence and report types are covered by Task 2.
- Provider interface and fixtures are covered by Task 4.
- Range live provider is covered by Task 7.
- Corridor scoring and provider failure behavior are covered by Task 5.
- Wiring into `runWhereIsMoneyCheck` is covered by Task 6.
- Runtime wiring is covered by Task 8.
- Report UX is covered by Task 9.
- Verification is covered by Task 10.

Placeholder scan:

- The plan contains no placeholder markers or unresolved open choices.
- The only conditional path is Task 9 formatter location, resolved by an explicit `rg` command before editing.

Type consistency:

- `CrossChainCorridorReport`, `CrossChainCorridorPath`, `ChainAddress`, and `Stage2TriggerReason` are defined before use.
- Provider types are imported from `crossChainProviders`.
- `requestedAmountRaw` flows from `RunWhereIsMoneyCheckInput` into `selectBalanceFormingTransfers`.
