# Low-Balance Recent Flow Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `where-is-money` handle near-zero balance wallets by analyzing recent meaningful wallet flow instead of pretending old large transfers formed the tiny current balance.

**Architecture:** Add a focused selector that switches low-balance address checks to recent-flow provenance. The selector first anchors on the latest meaningful outgoing transfer and traces its funding candidates; if no outgoing anchor exists, it falls back to recent significant inbound history. Existing origin tracing, approval enrichment, LLM enrichment, and operational assessment remain the scoring layers, with a deterministic service-boundary classifier that prevents bridge/DEX/router/stablecoin/gasless routes from being mislabeled as proven drains.

**Tech Stack:** TypeScript, Node.js, Vitest, existing `runWhereIsMoneyCheck`, `selectIncomingDepositFundingCandidates`, Telegram formatter in `src/bot/createBot.ts`, CLI `scripts/forensicWhereIsMoney.ts`.

---

## File Structure

- Modify `src/types.ts`
  - Extend balance selection types with recent-flow scope, anchor metadata, and selected reasons.

- Create `src/forensics/recentFlowProvenanceSelection.ts`
  - Own low-balance recent-flow selection.
  - Reuse cashflow-aware candidate selection for outgoing anchors.
  - Return the same `BalanceFormingSelection` shape with explicit recent-flow metadata.

- Modify `src/check/whereIsMoneyCheck.ts`
  - Choose recent-flow mode when balance is below threshold and no seed/requested amount is present.
  - Preserve existing `wallet_profile` zero-balance behavior.
  - Pass recent-flow scope into coverage and report notes.

- Modify `src/forensics/contractLlmVerdict.ts`
  - Include recent-flow anchor/candidate facts in the contract case file through existing `balanceFormingTransfers` fields and coverage metadata.
  - Include transaction contract roles and service-route evidence so the LLM cannot treat an OFT/bridge/router/stablecoin contract as a victim EOA.

- Create `src/forensics/serviceRouteRegistry.ts`
  - Hold curated service-boundary categories, known protocol names, and generic keywords from DeFiLlama/L2BEAT-derived research.

- Create `src/forensics/serviceRouteEvidence.ts`
  - Extract deterministic service-route evidence from transaction details, metadata, service classifications, and contract profiles.
  - Detect bridge, bridge aggregator, DEX/router, stablecoin/wrapped-asset, gasless/smart-account, and unknown service-like context.
  - Produce false-positive guards for LLM drainer verdicts.

- Modify `src/forensics/approvalDrainProvenance.ts`
  - Convert service-route evidence into existing `ApprovalDrainReviewFinding` objects with `reason: "service_boundary_guard"`.
  - Use existing `ApprovalDrainFalsePositiveGuard` objects, not string guards, so assessment/reporting stays type-compatible.

- Modify `src/forensics/moneyOriginOperationalAssessment.ts`
  - Treat unresolved recent-flow context without hard evidence as low/low-medium for operational wallets.
  - Cap LLM drainer-like verdicts below CRITICAL when deterministic service-route evidence exists and no exact approval-drain proof is found.
  - Keep hard evidence unchanged.

- Modify `scripts/forensicWhereIsMoney.ts`
  - Print `Provenance scope`, anchor details, and `Recent flow coverage`.
  - Avoid `Balance-forming transfers` wording for recent-flow scope.

- Modify `src/bot/createBot.ts`
  - Show low-balance/recent-flow wording in Telegram.
  - Keep current balance and requested amount output unchanged for normal modes.

- Tests:
  - `tests/forensics/recentFlowProvenanceSelection.test.ts`
  - `tests/check/whereIsMoneyCheck.test.ts`
  - `tests/forensics/moneyOriginOperationalAssessment.test.ts`
  - `tests/bot/createBot.test.ts`
  - `tests/forensics/contractLlmVerdict.test.ts`
  - `tests/forensics/serviceRouteRegistry.test.ts`
  - `tests/forensics/serviceRouteEvidence.test.ts`
  - `tests/forensics/serviceClassifier.test.ts`
  - `tests/forensics/approvalDrainProvenance.test.ts`

---

### Task 1: Extend Types For Recent Flow Scope

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add recent-flow selected reasons**

In `src/types.ts`, replace the current `BalanceFormingTransfer.selectedReason` union:

```ts
selectedReason: "covers_current_balance";
```

with:

```ts
selectedReason:
  | "covers_current_balance"
  | "covers_requested_amount"
  | "funds_recent_outgoing"
  | "recent_large_inbound";
```

- [ ] **Step 2: Add provenance scope types**

Add near `BalanceFormingSelection`:

```ts
export type MoneyOriginProvenanceScope =
  | "current_balance"
  | "requested_amount"
  | "transaction_seed"
  | "recent_flow";

export type MoneyOriginRecentFlowAnchor = {
  txHash: string;
  direction: "outgoing" | "inbound";
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
  reason: "latest_meaningful_outgoing" | "recent_significant_inbound_fallback";
};
```

- [ ] **Step 3: Extend `BalanceFormingSelection`**

Add fields to `BalanceFormingSelection`:

```ts
  provenanceScope: MoneyOriginProvenanceScope;
  anchorTransfer?: MoneyOriginRecentFlowAnchor | null;
  dataScopeNote?: string | null;
```

Extend `selectionMethod`:

```ts
  selectionMethod:
    | "current_balance"
    | "requested_amount"
    | "transaction_seed"
    | "recent_outgoing"
    | "recent_large_inbound";
```

- [ ] **Step 4: Extend `WhereIsMoneyCoverage`**

Add fields:

```ts
  provenanceScope?: MoneyOriginProvenanceScope;
  anchorTransfer?: MoneyOriginRecentFlowAnchor | null;
  lowBalanceThresholdRaw?: string | null;
  dataScopeNote?: string | null;
```

- [ ] **Step 5: Update existing constructors**

Update `src/forensics/balanceFormingTransfers.ts` so current-balance and requested-amount selections set:

```ts
provenanceScope: hasRequestedAmount ? "requested_amount" : "current_balance",
anchorTransfer: null,
dataScopeNote: null,
selectionMethod
```

Update the selected reason in `selectionTransfer`:

```ts
selectedReason: input.requestedAmountRaw ? "covers_requested_amount" : "covers_current_balance"
```

If the existing helper does not receive `input`, pass the selected reason into the helper from `selectBalanceFormingTransfers`:

```ts
const selectedReason: BalanceFormingTransfer["selectedReason"] = hasRequestedAmount
  ? "covers_requested_amount"
  : "covers_current_balance";
```

- [ ] **Step 6: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: TypeScript errors point to existing `BalanceFormingSelection` object literals that now need the new fields.

- [ ] **Step 7: Patch all object literals**

Update `seededBalanceFormingSelection` in `src/check/whereIsMoneyCheck.ts`:

```ts
provenanceScope: "transaction_seed",
anchorTransfer: null,
dataScopeNote: "Transaction check: the checked transaction is the provenance seed.",
selectionMethod: "transaction_seed",
```

Update fallback selection object literals in `src/check/whereIsMoneyCheck.ts` and tests with:

```ts
provenanceScope: "current_balance",
anchorTransfer: null,
dataScopeNote: null,
```

- [ ] **Step 8: Run typecheck again**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/forensics/balanceFormingTransfers.ts src/check/whereIsMoneyCheck.ts tests
git commit -m "feat: add recent flow provenance types"
```

---

### Task 2: Add Low-Balance Recent Flow Selector

**Files:**
- Create: `src/forensics/recentFlowProvenanceSelection.ts`
- Test: `tests/forensics/recentFlowProvenanceSelection.test.ts`

- [ ] **Step 1: Write failing selector tests**

Create `tests/forensics/recentFlowProvenanceSelection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectRecentFlowProvenanceTransfers } from "../../src/forensics/recentFlowProvenanceSelection";
import type { ForensicRouteEdge } from "../../src/types";

const subject = "TSubject";
const counterparty = "TCounterparty";

function edge(input: {
  txHash: string;
  from: string;
  to: string;
  amount: string;
  iso: string;
}): ForensicRouteEdge {
  return {
    id: input.txHash,
    txHash: input.txHash,
    fromAddress: input.from,
    toAddress: input.to,
    amountRaw: input.amount,
    timestamp: new Date(input.iso),
    tokenContractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    tokenSymbol: "USDT",
    edgeType: "trc20_transfer"
  };
}

describe("selectRecentFlowProvenanceTransfers", () => {
  it("anchors on the latest meaningful outgoing and selects prior funding inbounds", () => {
    const result = selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "147000",
      edges: [
        edge({ txHash: "in-1", from: "TFunderA", to: subject, amount: "50000000000", iso: "2026-05-05T08:00:00.000Z" }),
        edge({ txHash: "in-2", from: "TFunderB", to: subject, amount: "40000000000", iso: "2026-05-05T08:10:00.000Z" }),
        edge({ txHash: "out-1", from: subject, to: counterparty, amount: "89473150000", iso: "2026-05-05T08:49:27.000Z" })
      ]
    });

    expect(result.provenanceScope).toBe("recent_flow");
    expect(result.selectionMethod).toBe("recent_outgoing");
    expect(result.anchorTransfer?.txHash).toBe("out-1");
    expect(result.targetAmountRaw).toBe("89473150000");
    expect(result.coverageRatio).toBeGreaterThan(0.99);
    expect(result.transfers.map((item) => item.txHash)).toEqual(["in-2", "in-1"]);
    expect(result.transfers.every((item) => item.selectedReason === "funds_recent_outgoing")).toBe(true);
  });

  it("accounts for earlier outgoing spend before selecting funding candidates", () => {
    const result = selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [
        edge({ txHash: "in-old", from: "TFunderA", to: subject, amount: "50000000000", iso: "2026-05-05T08:00:00.000Z" }),
        edge({ txHash: "spend-before-anchor", from: subject, to: "TOther", amount: "10000000000", iso: "2026-05-05T08:20:00.000Z" }),
        edge({ txHash: "in-new", from: "TFunderB", to: subject, amount: "40000000000", iso: "2026-05-05T08:30:00.000Z" }),
        edge({ txHash: "out-anchor", from: subject, to: counterparty, amount: "70000000000", iso: "2026-05-05T08:49:27.000Z" })
      ]
    });

    expect(result.anchorTransfer?.txHash).toBe("out-anchor");
    expect(result.transfers.map((item) => item.txHash)).toEqual(["in-new", "in-old"]);
    expect(result.coverageRatio).toBeGreaterThan(0.99);
  });

  it("falls back to recent significant inbound transfers when no outgoing anchor exists", () => {
    const result = selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "120000",
      edges: [
        edge({ txHash: "small", from: "TA", to: subject, amount: "100000000", iso: "2026-05-03T00:00:00.000Z" }),
        edge({ txHash: "large-old", from: "TB", to: subject, amount: "2000000000", iso: "2026-05-04T00:00:00.000Z" }),
        edge({ txHash: "large-new", from: "TC", to: subject, amount: "3000000000", iso: "2026-05-05T00:00:00.000Z" })
      ]
    });

    expect(result.selectionMethod).toBe("recent_large_inbound");
    expect(result.anchorTransfer?.txHash).toBe("large-new");
    expect(result.transfers.map((item) => item.txHash)).toEqual(["large-new", "large-old"]);
    expect(result.transfers.every((item) => item.selectedReason === "recent_large_inbound")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run tests/forensics/recentFlowProvenanceSelection.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Create the selector**

Create `src/forensics/recentFlowProvenanceSelection.ts`:

```ts
import type {
  BalanceFormingSelection,
  BalanceFormingTransfer,
  ForensicRouteEdge,
  MoneyOriginRecentFlowAnchor
} from "../types";
import { selectIncomingDepositFundingCandidates } from "./incomingDepositCashflow";

const USDT_DECIMALS = 1_000_000n;
export const LOW_BALANCE_RECENT_FLOW_THRESHOLD_RAW = (1_000n * USDT_DECIMALS).toString();
const BASE_SIGNIFICANT_RAW = 1_000n * USDT_DECIMALS;
const MAX_DYNAMIC_SIGNIFICANT_RAW = 10_000n * USDT_DECIMALS;
const DEFAULT_MAX_CANDIDATES = 10;

type SelectRecentFlowInput = {
  subjectAddress: string;
  currentBalanceRaw: string | null;
  edges: ForensicRouteEdge[];
  maxCandidates?: number;
};

function parseRaw(value: string | null | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number((numerator * 10_000n) / denominator) / 10_000;
}

function newestFirst(left: ForensicRouteEdge, right: ForensicRouteEdge): number {
  const byTime = right.timestamp.getTime() - left.timestamp.getTime();
  if (byTime !== 0) return byTime;
  return right.txHash.localeCompare(left.txHash);
}

function anchor(
  edge: ForensicRouteEdge,
  direction: MoneyOriginRecentFlowAnchor["direction"],
  reason: MoneyOriginRecentFlowAnchor["reason"]
): MoneyOriginRecentFlowAnchor {
  return {
    txHash: edge.txHash,
    direction,
    fromAddress: edge.fromAddress,
    toAddress: edge.toAddress,
    amountRaw: edge.amountRaw,
    timestamp: edge.timestamp.toISOString(),
    reason
  };
}

function outgoingAnchor(subjectAddress: string, edges: ForensicRouteEdge[]): ForensicRouteEdge | null {
  return edges
    .filter((edge) => edge.fromAddress === subjectAddress)
    .filter((edge) => parseRaw(edge.amountRaw) >= BASE_SIGNIFICANT_RAW)
    .sort(newestFirst)[0] ?? null;
}

function dynamicSignificantThreshold(anchorAmountRaw: bigint): bigint {
  const fivePercent = anchorAmountRaw / 20n;
  if (fivePercent < BASE_SIGNIFICANT_RAW) return BASE_SIGNIFICANT_RAW;
  if (fivePercent > MAX_DYNAMIC_SIGNIFICANT_RAW) return MAX_DYNAMIC_SIGNIFICANT_RAW;
  return fivePercent;
}

function transferFromEdge(
  edge: ForensicRouteEdge,
  denominatorRaw: bigint,
  coveredRaw: bigint,
  selectedReason: BalanceFormingTransfer["selectedReason"]
): BalanceFormingTransfer {
  return {
    txHash: edge.txHash,
    fromAddress: edge.fromAddress,
    toAddress: edge.toAddress,
    amountRaw: edge.amountRaw,
    timestamp: edge.timestamp.toISOString(),
    coverageShare: ratio(coveredRaw, denominatorRaw),
    selectedReason
  };
}

function emptySelection(input: SelectRecentFlowInput): BalanceFormingSelection {
  return {
    transfers: [],
    currentBalanceRaw: parseRaw(input.currentBalanceRaw).toString(),
    requestedAmountRaw: null,
    targetAmountRaw: "0",
    selectedAmountRaw: "0",
    coverageRatio: 0,
    selectedVolumeRaw: "0",
    currentBalanceCoverageRatio: 0,
    partial: true,
    selectionMethod: "recent_large_inbound",
    provenanceScope: "recent_flow",
    anchorTransfer: null,
    dataScopeNote: "Low-balance recent-flow mode found no meaningful recent USDT flow.",
    notes: ["Current USDT balance is below the low-balance threshold; no meaningful recent USDT flow was found."]
  };
}

function selectForOutgoingAnchor(input: SelectRecentFlowInput, anchorEdge: ForensicRouteEdge): BalanceFormingSelection {
  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const targetRaw = parseRaw(anchorEdge.amountRaw);
  const minSignificantRaw = dynamicSignificantThreshold(targetRaw);
  const selection = selectIncomingDepositFundingCandidates({
    sender: input.subjectAddress,
    watchedWallet: anchorEdge.toAddress,
    depositTxHash: anchorEdge.txHash,
    depositAmountRaw: anchorEdge.amountRaw,
    depositTimestamp: anchorEdge.timestamp,
    edges: input.edges
  });
  const strongCandidates = selection.candidates.filter((item) => parseRaw(item.edge.amountRaw) >= minSignificantRaw);
  const candidates = (strongCandidates.length > 0 ? strongCandidates : selection.candidates).slice(0, maxCandidates);
  const selectedAmountRaw = candidates.reduce((sum, item) => sum + parseRaw(item.usableAmountRaw), 0n);
  return {
    transfers: candidates.map((item) =>
      transferFromEdge(item.edge, targetRaw, parseRaw(item.usableAmountRaw), "funds_recent_outgoing")
    ),
    currentBalanceRaw: parseRaw(input.currentBalanceRaw).toString(),
    requestedAmountRaw: null,
    targetAmountRaw: targetRaw.toString(),
    selectedAmountRaw: selectedAmountRaw.toString(),
    coverageRatio: ratio(selectedAmountRaw, targetRaw),
    selectedVolumeRaw: selectedAmountRaw.toString(),
    currentBalanceCoverageRatio: 0,
    partial: ratio(selectedAmountRaw, targetRaw) < 0.8,
    selectionMethod: "recent_outgoing",
    provenanceScope: "recent_flow",
    anchorTransfer: {
      ...anchor(anchorEdge, "outgoing", "latest_meaningful_outgoing")
    },
    dataScopeNote: "Low-balance recent-flow mode: selected funding candidates for the latest meaningful outgoing USDT transfer.",
    notes: [
      "Current USDT balance is below the low-balance threshold; recent-flow provenance analyzed latest meaningful outgoing USDT flow.",
      `Recent-flow funding candidates cover ${Math.round(ratio(selectedAmountRaw, targetRaw) * 100)}% of the outgoing anchor.`
    ]
  };
}

function selectRecentInboundFallback(input: SelectRecentFlowInput): BalanceFormingSelection {
  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const candidates = input.edges
    .filter((edge) => edge.toAddress === input.subjectAddress)
    .filter((edge) => parseRaw(edge.amountRaw) >= BASE_SIGNIFICANT_RAW)
    .sort(newestFirst)
    .slice(0, maxCandidates);
  if (candidates.length === 0) return emptySelection(input);
  const selectedAmountRaw = candidates.reduce((sum, edge) => sum + parseRaw(edge.amountRaw), 0n);
  return {
    transfers: candidates.map((edge) =>
      transferFromEdge(edge, selectedAmountRaw, parseRaw(edge.amountRaw), "recent_large_inbound")
    ),
    currentBalanceRaw: parseRaw(input.currentBalanceRaw).toString(),
    requestedAmountRaw: null,
    targetAmountRaw: selectedAmountRaw.toString(),
    selectedAmountRaw: selectedAmountRaw.toString(),
    coverageRatio: 1,
    selectedVolumeRaw: selectedAmountRaw.toString(),
    currentBalanceCoverageRatio: 0,
    partial: false,
    selectionMethod: "recent_large_inbound",
    provenanceScope: "recent_flow",
    anchorTransfer: {
      ...anchor(candidates[0], "inbound", "recent_significant_inbound_fallback")
    },
    dataScopeNote: "Low-balance recent-flow mode: selected recent significant inbound USDT history because no meaningful outgoing anchor was found.",
    notes: ["Current USDT balance is below the low-balance threshold; recent significant inbound USDT history was selected."]
  };
}

export function selectRecentFlowProvenanceTransfers(input: SelectRecentFlowInput): BalanceFormingSelection {
  const anchorEdge = outgoingAnchor(input.subjectAddress, input.edges);
  if (anchorEdge) return selectForOutgoingAnchor(input, anchorEdge);
  return selectRecentInboundFallback(input);
}
```

- [ ] **Step 4: Run selector tests**

Run:

```bash
npx vitest run tests/forensics/recentFlowProvenanceSelection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/recentFlowProvenanceSelection.ts tests/forensics/recentFlowProvenanceSelection.test.ts
git commit -m "feat: select low-balance recent flow provenance"
```

---

### Task 3: Wire Recent Flow Mode Into Where-Is-Money

**Files:**
- Modify: `src/check/whereIsMoneyCheck.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Write failing integration tests**

Add tests to `tests/check/whereIsMoneyCheck.test.ts` near the balance-forming selection tests.

Test latest outgoing anchor:

```ts
it("uses recent-flow provenance for low-balance wallets with a meaningful outgoing anchor", async () => {
  const subject = "TSubjectLowBalance";
  const report = await runWhereIsMoneyCheck(depsWithEdges({
    subject,
    currentBalanceRaw: "147000",
    edges: [
      edge("in-a", "TFunderA", subject, "50000000000", "2026-05-05T08:00:00.000Z"),
      edge("in-b", "TFunderB", subject, "40000000000", "2026-05-05T08:10:00.000Z"),
      edge("out-anchor", subject, "TReceiver", "89473150000", "2026-05-05T08:49:27.000Z")
    ]
  }), {
    sourceAddress: subject,
    windowStart: new Date("2026-05-01T00:00:00.000Z"),
    windowEnd: new Date("2026-05-30T00:00:00.000Z")
  });

  expect(report.coverage.provenanceScope).toBe("recent_flow");
  expect(report.coverage.anchorTransfer?.txHash).toBe("out-anchor");
  expect(report.coverage.notes.join(" ")).toContain("recent-flow provenance");
  expect(report.balanceFormingTransfers.map((item) => item.txHash)).toEqual(["in-b", "in-a"]);
});
```

Test requested amount still wins:

```ts
it("keeps requested-amount mode even when current balance is low", async () => {
  const subject = "TSubjectRequested";
  const report = await runWhereIsMoneyCheck(depsWithEdges({
    subject,
    currentBalanceRaw: "100000",
    edges: [
      edge("in-a", "TFunderA", subject, "2000000000", "2026-05-05T08:00:00.000Z")
    ]
  }), {
    sourceAddress: subject,
    requestedAmountRaw: "1000000000",
    windowStart: new Date("2026-05-01T00:00:00.000Z"),
    windowEnd: new Date("2026-05-30T00:00:00.000Z")
  });

  expect(report.coverage.provenanceScope).toBe("requested_amount");
  expect(report.coverage.anchorTransfer).toBeNull();
});
```

Use the existing local edge/test dependency helpers in this file. If helper names differ, adapt the test setup but keep assertions unchanged.

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/check/whereIsMoneyCheck.test.ts
```

Expected: FAIL because low-balance mode is not wired.

- [ ] **Step 3: Import selector and threshold**

In `src/check/whereIsMoneyCheck.ts`, add:

```ts
import {
  LOW_BALANCE_RECENT_FLOW_THRESHOLD_RAW,
  selectRecentFlowProvenanceTransfers
} from "../forensics/recentFlowProvenanceSelection";
```

- [ ] **Step 4: Add low-balance branch**

Replace the existing selection expression:

```ts
const selection = input.seedTransfers
  ? seededBalanceFormingSelection(...)
  : selectBalanceFormingTransfers(...);
```

with:

```ts
const sourceEdges = await fetchCachedEdgesForAddress(sourceAddress);
const currentBalanceAmount = currentBalanceRaw && /^\d+$/.test(currentBalanceRaw) ? BigInt(currentBalanceRaw) : 0n;
const lowBalanceThreshold = BigInt(LOW_BALANCE_RECENT_FLOW_THRESHOLD_RAW);
const shouldUseRecentFlow =
  !input.seedTransfers &&
  !input.requestedAmountRaw &&
  input.mode !== "wallet_profile" &&
  currentBalanceAmount > 0n &&
  currentBalanceAmount < lowBalanceThreshold;

const selection = input.seedTransfers
  ? seededBalanceFormingSelection({
      seedTransfers: input.seedTransfers,
      currentBalanceRaw,
      requestedAmountRaw: input.requestedAmountRaw
    })
  : shouldUseRecentFlow
    ? selectRecentFlowProvenanceTransfers({
        subjectAddress: sourceAddress,
        currentBalanceRaw,
        edges: sourceEdges
      })
    : selectBalanceFormingTransfers({
        subjectAddress: sourceAddress,
        currentBalanceRaw,
        requestedAmountRaw: input.requestedAmountRaw,
        edges: sourceEdges
      });
```

This preserves the existing `wallet_profile` zero-balance early return.

- [ ] **Step 5: Add coverage fields**

When building `coverage`, add:

```ts
provenanceScope: selection.provenanceScope,
anchorTransfer: selection.anchorTransfer ?? null,
lowBalanceThresholdRaw: selection.provenanceScope === "recent_flow"
  ? LOW_BALANCE_RECENT_FLOW_THRESHOLD_RAW
  : null,
dataScopeNote: selection.dataScopeNote ?? null,
```

- [ ] **Step 6: Replace the generic coverage note**

Replace:

```ts
selection.selectionMethod === "requested_amount"
  ? "Balance-forming approximation: latest inbound USDT flows sufficient to cover the requested amount."
  : "Balance-forming approximation: latest inbound USDT flows sufficient to explain the current wallet balance."
```

with:

```ts
selection.provenanceScope === "recent_flow"
  ? "Recent-flow approximation: current balance is low, so the report analyzes recent meaningful wallet flow rather than current balance origin."
  : selection.provenanceScope === "requested_amount" || selection.provenanceScope === "transaction_seed"
    ? "Balance-forming approximation: latest inbound USDT flows sufficient to cover the requested amount or checked transaction."
    : "Balance-forming approximation: latest inbound USDT flows sufficient to explain the current wallet balance."
```

- [ ] **Step 7: Run where-is-money tests**

Run:

```bash
npx vitest run tests/check/whereIsMoneyCheck.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/check/whereIsMoneyCheck.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "feat: use recent flow mode for low-balance wallets"
```

---

### Task 4: Adjust Assessment For Recent Flow Context

**Files:**
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`
- Test: `tests/forensics/moneyOriginOperationalAssessment.test.ts`

- [ ] **Step 1: Add assessment tests**

Add a test where recent-flow context is unresolved but operational and has no hard evidence:

```ts
it("keeps unresolved recent-flow operational wallets low-medium without hard evidence", () => {
  const assessment = buildMoneyOriginOperationalAssessment({
    fastWalletRisk: lowFastRisk(),
    originPaths: [
      moneyOriginPath({
        verdict: "REVIEW",
        riskScoreContribution: 35,
        stoppedReason: "no_previous_transfer",
        reasons: ["No previous inbound USDT transfer found before this recent-flow anchor."]
      })
    ],
    senderInteractionProfiles: [operationalSenderInteraction()],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [],
    coverage: {
      selectedInboundTxCount: 2,
      currentBalanceRaw: "147000",
      requestedAmountRaw: null,
      targetAmountRaw: "89473150000",
      selectedAmountRaw: "89473150000",
      coverageRatio: 1,
      selectedInboundVolumeRaw: "89473150000",
      currentBalanceCoverageRatio: 0,
      maxDepth: 7,
      fetchedAddressCount: 3,
      partial: true,
      provenanceScope: "recent_flow",
      anchorTransfer: {
        txHash: "out-anchor",
        direction: "outgoing",
        fromAddress: "TSubject",
        toAddress: "TReceiver",
        amountRaw: "89473150000",
        timestamp: "2026-05-05T08:49:27.000Z",
        reason: "latest_meaningful_outgoing"
      },
      lowBalanceThresholdRaw: "1000000000",
      dataScopeNote: "Low-balance recent-flow mode.",
      notes: []
    },
    ageSignals: null
  });

  expect(assessment.decision).toBe("ACCEPTABLE");
  expect(assessment.riskScore).toBeLessThanOrEqual(40);
  expect(assessment.riskBand).toBe("LOW-MEDIUM");
  expect(assessment.hardBadEvidence).toEqual([]);
});
```

- [ ] **Step 2: Run assessment tests and verify failure if current scoring over-penalizes**

Run:

```bash
npx vitest run tests/forensics/moneyOriginOperationalAssessment.test.ts
```

Expected: FAIL if recent-flow scope is treated like incomplete current-balance coverage.

- [ ] **Step 3: Add recent-flow dampening**

In `buildMoneyOriginOperationalAssessment`, locate the operational liquidity branch. Ensure it allows recent-flow scope:

```ts
const recentFlowScope = input.coverage.provenanceScope === "recent_flow";
```

Use it in the operational wallet branch:

```ts
if (role === "operational_liquidity_wallet" && hardBadEvidence.length === 0 && input.approvalDrainReviewFindings.length === 0) {
  const base = recentFlowScope ? 30 : operationalWalletScore(input);
  const riskScore = clampScore(Math.max(base, input.fastWalletRisk?.score ?? 0));
  return {
    decision: "ACCEPTABLE",
    riskScore,
    riskBand: riskBandFromWhereScore(riskScore),
    provenanceConfidence: provenanceConfidence(input),
    coverageCompleteness: coverageScore,
    walletRole: role,
    operationalLiquidityScore: operationalScore,
    ageSignals: input.ageSignals,
    hardBadEvidence,
    reasons: [
      recentFlowScope
        ? "Recent-flow source is not fully proven; wallet looks operational/liquidity and no hard bad evidence was found."
        : "Clean CEX origin is not fully proven; wallet looks like an operational/liquidity wallet and no hard bad evidence was found."
    ],
    warnings: [
      ...llmVerdictWarnings(input.contractLlmVerdicts),
      ...(input.coverage.partial ? ["Coverage is partial; result is conservative."] : [])
    ]
  };
}
```

Keep existing hard evidence checks before this branch unchanged.

- [ ] **Step 4: Run assessment tests**

Run:

```bash
npx vitest run tests/forensics/moneyOriginOperationalAssessment.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/moneyOriginOperationalAssessment.ts tests/forensics/moneyOriginOperationalAssessment.test.ts
git commit -m "fix: score recent flow uncertainty as context"
```

---

### Task 5: Update CLI Output

**Files:**
- Modify: `scripts/forensicWhereIsMoney.ts`
- Test: manual CLI smoke

- [ ] **Step 1: Add formatter helper**

In `scripts/forensicWhereIsMoney.ts`, add:

```ts
function provenanceScopeLabel(scope: string | null | undefined): string {
  if (scope === "recent_flow") return "Recent flow provenance";
  if (scope === "requested_amount") return "Requested amount provenance";
  if (scope === "transaction_seed") return "Transaction-seeded provenance";
  return "Current balance provenance";
}
```

- [ ] **Step 2: Print scope before coverage**

After target amount output, add:

```ts
console.log(`Provenance scope: ${provenanceScopeLabel(report.coverage.provenanceScope)}`);
if (report.coverage.anchorTransfer) {
  const anchor = report.coverage.anchorTransfer;
  console.log(`Anchor: ${anchor.direction} ${formatRawUsdt(anchor.amountRaw)} | ${anchor.txHash} | ${anchor.reason}`);
}
if (report.coverage.dataScopeNote) {
  console.log(`Data scope: ${report.coverage.dataScopeNote}`);
}
```

- [ ] **Step 3: Replace coverage wording**

Replace:

```ts
console.log(`Balance-forming transfers: ${report.coverage.selectedInboundTxCount} txs, covering ...`);
```

with:

```ts
const transferLabel = report.coverage.provenanceScope === "recent_flow"
  ? "Recent-flow funding transfers"
  : "Balance-forming transfers";
console.log(`${transferLabel}: ${report.coverage.selectedInboundTxCount} txs, covering ${formatPercent(report.coverage.coverageRatio)} of target (${formatPercent(report.coverage.currentBalanceCoverageRatio)} of current balance)`);
```

- [ ] **Step 4: Replace section header**

Where the CLI prints:

```ts
console.log("Balance-forming transfers:");
```

replace with:

```ts
console.log(report.coverage.provenanceScope === "recent_flow"
  ? "Recent-flow funding transfers:"
  : "Balance-forming transfers:");
```

- [ ] **Step 5: Smoke a low-balance address**

Run:

```bash
node --import tsx scripts/forensicWhereIsMoney.ts --source TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb --days 90 --depth 7 --beam 8 --max-addresses 60 --max-edges 100 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 5000
```

Expected output contains:

```text
Provenance scope: Recent flow provenance
Recent-flow funding transfers:
```

Expected output does not contain:

```text
Balance-forming transfers: 1 txs, covering 100% of target (100% of current balance)
```

- [ ] **Step 6: Commit**

```bash
git add scripts/forensicWhereIsMoney.ts
git commit -m "chore: show recent flow provenance in CLI"
```

---

### Task 6: Update Telegram Where-Is-Money Output

**Files:**
- Modify: `src/bot/createBot.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add formatter tests**

Add a test around existing where-is-money formatting tests:

```ts
it("formats low-balance recent-flow where-is-money results without balance-forming wording", async () => {
  const report = whereReportFixture({
    coverage: {
      provenanceScope: "recent_flow",
      anchorTransfer: {
        txHash: "out-anchor",
        direction: "outgoing",
        fromAddress: "TSubject",
        toAddress: "TReceiver",
        amountRaw: "89473150000",
        timestamp: "2026-05-05T08:49:27.000Z",
        reason: "latest_meaningful_outgoing"
      },
      lowBalanceThresholdRaw: "1000000000",
      dataScopeNote: "Low-balance recent-flow mode: selected funding candidates for the latest meaningful outgoing USDT transfer."
    }
  });

  const text = formatWhereIsMoneyReport(jobFixture(), report, "partial").text;

  expect(text).toContain("Recent flow provenance");
  expect(text).toContain("Current balance is below the low-balance threshold");
  expect(text).toContain("Anchor");
  expect(text).not.toContain("Balance-forming coverage");
});
```

Use existing fixture helpers in `tests/bot/createBot.test.ts`. If helper names differ, update the fixture call but keep assertions.

- [ ] **Step 2: Run bot tests and verify failure**

Run:

```bash
npx vitest run tests/bot/createBot.test.ts
```

Expected: FAIL because the formatter does not handle `recent_flow` wording.

- [ ] **Step 3: Add where report scope lines**

In `src/bot/createBot.ts`, locate `formatWhereIsMoneyReport`. Add:

```ts
const recentFlow = report.coverage.provenanceScope === "recent_flow";
```

In the header/details section, add lines when `recentFlow`:

```ts
recentFlow ? bold(locale === "en" ? "Recent flow provenance" : "Recent flow provenance") : null,
recentFlow && report.coverage.dataScopeNote ? escapeHtml(report.coverage.dataScopeNote) : null,
recentFlow && report.coverage.anchorTransfer
  ? `${bold("Anchor")}: ${escapeHtml(report.coverage.anchorTransfer.direction)} ${code(shortIdentifier(report.coverage.anchorTransfer.txHash))}`
  : null,
```

Keep English wording for now if the report already mixes English forensic terms. Do not add a partial Russian translation in this task.

- [ ] **Step 4: Replace coverage label**

Where the formatter prints balance-forming coverage, branch:

```ts
recentFlow
  ? `${bold("Recent flow coverage")}: ${report.coverage.selectedInboundTxCount} txs, ${Math.round((report.coverage.coverageRatio ?? 0) * 100)}%`
  : `${bold("Balance-forming coverage")}: ${report.coverage.selectedInboundTxCount} txs, ${Math.round((report.coverage.coverageRatio ?? 0) * 100)}%`
```

- [ ] **Step 5: Run bot tests**

Run:

```bash
npx vitest run tests/bot/createBot.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "chore: format recent flow provenance in bot"
```

---

### Task 7: Add Contract Case Context And Regression Smoke

**Files:**
- Modify: `src/forensics/contractLlmVerdict.ts`
- Test: `tests/forensics/contractLlmVerdict.test.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Add case-file test for recent-flow anchor context**

In `tests/forensics/contractLlmVerdict.test.ts`, add:

```ts
it("includes recent-flow anchor metadata in contract case files", () => {
  const caseFiles = buildContractAnalysisCaseFiles({
    subjectAddress: "TSubject",
    currentUsdtBalanceRaw: "147000",
    balanceFormingTransfers: [
      {
        txHash: "funding-in",
        fromAddress: "TContract",
        toAddress: "TSubject",
        amountRaw: "89473150000",
        timestamp: "2026-05-05T08:00:00.000Z",
        coverageShare: 1,
        selectedReason: "funds_recent_outgoing"
      }
    ],
    originPaths: [
      moneyOriginPathFixture({
        rootSourceAddress: "TContract",
        stoppedReason: "unlabeled_service_boundary",
        txHashes: ["funding-in", "out-anchor"]
      })
    ],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    classifications: new Map([
      ["TContract", {
        category: "unknown_contract",
        identity: null,
        confidence: "medium",
        evidence: ["weak contract metadata"],
        isBoundary: true
      }]
    ]),
    contractProfiles: new Map()
  });

  expect(caseFiles[0]?.balanceFormingTransfers[0]?.selectedReason).toBe("funds_recent_outgoing");
  expect(caseFiles[0]?.evidenceIds).toEqual(expect.arrayContaining(["funding-in", "out-anchor", "TContract"]));
});
```

Use the existing fixture helper names in that file. If there is no `moneyOriginPathFixture`, create a local object using the same shape as nearby tests.

- [ ] **Step 2: Run test and verify current behavior**

Run:

```bash
npx vitest run tests/forensics/contractLlmVerdict.test.ts
```

Expected: PASS if existing case file already preserves selected reasons and tx hashes. If it fails, continue.

- [ ] **Step 3: Preserve selected reasons and recent-flow evidence IDs**

In `src/forensics/contractLlmVerdict.ts`, ensure `buildContractAnalysisCaseFiles` snapshots `balanceFormingTransfers` without dropping `selectedReason`, and includes all origin path tx hashes in `evidenceIds`:

```ts
const evidenceIds = [
  contractAddress,
  ...balanceFormingTransfers.map((transfer) => transfer.txHash),
  ...originPaths.flatMap((path) => path.txHashes)
].filter((value): value is string => Boolean(value));
```

Deduplicate before returning:

```ts
evidenceIds: [...new Set(evidenceIds)]
```

- [ ] **Step 4: Add TPvF-style regression test**

In `tests/check/whereIsMoneyCheck.test.ts`, add a low-balance regression:

```ts
it("does not report a historical large transfer as current-balance coverage for low-balance wallets", async () => {
  const subject = "TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb";
  const report = await runWhereIsMoneyCheck(depsWithEdges({
    subject,
    currentBalanceRaw: "147000",
    edges: [
      edge("historical-in", "TFG4wBaDQ8sHWWP1ACeSGnoNR6RRzevLPt", subject, "89473150000", "2026-05-05T08:49:27.000Z"),
      edge("later-out", subject, "TReceiver", "89473000000", "2026-05-05T09:05:00.000Z")
    ]
  }), {
    sourceAddress: subject,
    windowStart: new Date("2026-05-01T00:00:00.000Z"),
    windowEnd: new Date("2026-05-30T00:00:00.000Z")
  });

  expect(report.coverage.provenanceScope).toBe("recent_flow");
  expect(report.coverage.currentBalanceCoverageRatio).toBe(0);
  expect(report.coverage.notes.join(" ")).toContain("rather than current balance origin");
});
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx vitest run tests/check/whereIsMoneyCheck.test.ts tests/forensics/contractLlmVerdict.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/forensics/contractLlmVerdict.ts tests/forensics/contractLlmVerdict.test.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "test: cover recent flow contract context"
```

---

### Task 8: Add Cross-Chain / DEX / Service-Route Boundary Guard

**Files:**
- Create: `src/forensics/serviceRouteRegistry.ts`
- Create: `src/forensics/serviceRouteEvidence.ts`
- Modify: `src/forensics/serviceClassifier.ts`
- Modify: `src/forensics/approvalDrainProvenance.ts`
- Modify: `src/forensics/contractLlmVerdict.ts`
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`
- Test: `tests/forensics/serviceRouteRegistry.test.ts`
- Test: `tests/forensics/serviceRouteEvidence.test.ts`
- Test: `tests/forensics/serviceClassifier.test.ts`
- Test: `tests/forensics/approvalDrainProvenance.test.ts`
- Test: `tests/forensics/contractLlmVerdict.test.ts`
- Test: `tests/forensics/moneyOriginOperationalAssessment.test.ts`

- [ ] **Step 1: Create service-route registry and tests**

Create `src/forensics/serviceRouteRegistry.ts`:

```ts
export type ServiceRouteCategory =
  | "cross_chain_bridge"
  | "bridge_aggregator"
  | "dex_router_or_swap_aggregator"
  | "stablecoin_or_wrapped_asset_protocol"
  | "gasless_or_smart_account_service"
  | "unknown_service_route";

export type ServiceRouteRegistryEntry = {
  category: ServiceRouteCategory;
  canonicalName: string;
  aliases: string[];
  keywords: string[];
  policyRiskFloor: number;
  policyRiskCeiling: number;
};

export const SERVICE_ROUTE_REGISTRY: ServiceRouteRegistryEntry[] = [
  {
    category: "cross_chain_bridge",
    canonicalName: "LayerZero/OFT",
    aliases: ["layerzero", "usdtoft", "omnichain fungible token"],
    keywords: [" oft ", "endpoint", "endpointv2", "executor", "sendpacket", "lzreceive"],
    policyRiskFloor: 65,
    policyRiskCeiling: 75
  },
  {
    category: "cross_chain_bridge",
    canonicalName: "Cross-chain bridge",
    aliases: ["wormhole", "axelar", "chainlink ccip", "celer", "cbridge", "stargate", "debridge", "synapse", "allbridge", "across", "hop", "connext", "everclear", "mayan", "symbiosis", "meson", "rhino.fi", "relay", "ibc", "hyperlane", "router protocol", "bttc", "multichain"],
    keywords: ["bridge", "gateway", "portal", "token bridge", "wrapped", "canonical", "mint", "burn", "release"],
    policyRiskFloor: 65,
    policyRiskCeiling: 75
  },
  {
    category: "bridge_aggregator",
    canonicalName: "Bridge aggregator",
    aliases: ["li.fi", "lifi", "jumper", "socket", "bungee", "rango", "squid", "rubic", "okx dex bridge"],
    keywords: ["bridge aggregator", "cross-chain router", "route", "quote", "aggregator"],
    policyRiskFloor: 60,
    policyRiskCeiling: 75
  },
  {
    category: "dex_router_or_swap_aggregator",
    canonicalName: "DEX/router",
    aliases: ["uniswap", "pancakeswap", "curve", "balancer", "sushi", "1inch", "0x", "paraswap", "openocean", "kyberswap", "odos", "cowswap", "jupiter", "sunswap", "justmoney"],
    keywords: ["router", "swap", "pool", "pair", "amm", "dex", "multidex", "multi-dex"],
    policyRiskFloor: 55,
    policyRiskCeiling: 70
  },
  {
    category: "stablecoin_or_wrapped_asset_protocol",
    canonicalName: "Stablecoin/wrapped-asset protocol",
    aliases: ["cctp", "circle cctp", "usdt0", "usdd", "psm", "gemjoin"],
    keywords: ["mint", "burn", "wrapped", "canonical", "stablecoin", "peg", "psm", "gemjoin"],
    policyRiskFloor: 45,
    policyRiskCeiling: 70
  },
  {
    category: "gasless_or_smart_account_service",
    canonicalName: "Gasless/smart-account service",
    aliases: ["gasfree", "paymaster", "account abstraction", "permit", "permit2", "relayer"],
    keywords: ["gasfree", "paymaster", "meta transaction", "metatx", "permit", "relayer", "smart account"],
    policyRiskFloor: 25,
    policyRiskCeiling: 55
  }
];

export function matchServiceRouteRegistry(text: string): ServiceRouteRegistryEntry | null {
  const normalized = text.toLowerCase();
  const aliasMatch = SERVICE_ROUTE_REGISTRY.find((entry) =>
    entry.aliases.some((needle) => normalized.includes(needle.toLowerCase()))
  );

  if (aliasMatch) {
    return aliasMatch;
  }

  const keywordMatches = SERVICE_ROUTE_REGISTRY.flatMap((entry) =>
    entry.keywords
      .filter((needle) => normalized.includes(needle.toLowerCase()))
      .map((needle) => ({ entry, weight: needle.length }))
  );

  keywordMatches.sort((a, b) => b.weight - a.weight);
  return keywordMatches[0]?.entry ?? null;
}
```

Create `tests/forensics/serviceRouteRegistry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { matchServiceRouteRegistry } from "../../src/forensics/serviceRouteRegistry";

describe("service route registry", () => {
  it("classifies common bridge names", () => {
    expect(matchServiceRouteRegistry("LayerZero EndpointV2 Executor")?.category).toBe("cross_chain_bridge");
    expect(matchServiceRouteRegistry("Wormhole Token Bridge Portal")?.category).toBe("cross_chain_bridge");
    expect(matchServiceRouteRegistry("Axelar Gateway")?.category).toBe("cross_chain_bridge");
  });

  it("classifies bridge aggregators separately from bridges", () => {
    const result = matchServiceRouteRegistry("LI.FI Jumper cross-chain router quote");
    expect(result?.category).toBe("bridge_aggregator");
  });

  it("classifies DEX routers separately from bridges", () => {
    expect(matchServiceRouteRegistry("Uniswap V3 router swap")?.category).toBe("dex_router_or_swap_aggregator");
    expect(matchServiceRouteRegistry("SunSwap TRON router pool")?.category).toBe("dex_router_or_swap_aggregator");
  });

  it("classifies stablecoin and gasless service infrastructure", () => {
    expect(matchServiceRouteRegistry("Circle CCTP burn and mint")?.category).toBe("stablecoin_or_wrapped_asset_protocol");
    expect(matchServiceRouteRegistry("GasFree paymaster relayer")?.category).toBe("gasless_or_smart_account_service");
  });
});
```

- [ ] **Step 2: Run registry tests**

```bash
npx vitest run tests/forensics/serviceRouteRegistry.test.ts
```

Expected: PASS.

- [ ] **Step 3: Write service-route evidence tests**

Create `tests/forensics/serviceRouteEvidence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractServiceRouteEvidence } from "../../src/forensics/serviceRouteEvidence";

describe("extractServiceRouteEvidence", () => {
  it("detects LayerZero OFT delivery and marks drain proof as not proven", () => {
    const evidence = extractServiceRouteEvidence({
      subjectAddress: "TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb",
      transactionInfo: {
        ownerAddress: "TDeYY9iuU6vMtJV8ReoP9Benxin2Reczcx",
        toAddress: "TKSQrCn9r7jdNxWuQGRw8RJT8x4LFNfr7B",
        trigger_info: {
          methodId: "cfc32570",
          contract_address: "TKSQrCn9r7jdNxWuQGRw8RJT8x4LFNfr7B"
        },
        contractInfo: {
          TAy9xwjYjBBN6kutzrZJaAZJHCAejjK1V9: {
            tag1: "LayerZero: EndpointV2",
            name: "EndpointV2",
            publicTag: "LayerZero: EndpointV2"
          },
          TKSQrCn9r7jdNxWuQGRw8RJT8x4LFNfr7B: {
            tag1: "LayerZero: Executor",
            name: "OptimizedTransparentUpgradeableP",
            publicTag: "LayerZero: Executor"
          },
          TFG4wBaDQ8sHWWP1ACeSGnoNR6RRzevLPt: {
            tag1: "",
            name: "UsdtOFT",
            publicTag: ""
          },
          TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: {
            tag1: "USDT Token",
            name: "TetherToken",
            publicTag: "USDT Token"
          }
        },
        contract_map: {
          TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb: false,
          TAy9xwjYjBBN6kutzrZJaAZJHCAejjK1V9: true,
          TKSQrCn9r7jdNxWuQGRw8RJT8x4LFNfr7B: true,
          TFG4wBaDQ8sHWWP1ACeSGnoNR6RRzevLPt: true,
          TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: true
        },
        trc20TransferInfo: [
          {
            contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
            symbol: "USDT",
            from_address: "TFG4wBaDQ8sHWWP1ACeSGnoNR6RRzevLPt",
            to_address: "TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb",
            amount_str: "89473150000"
          }
        ]
      },
      contractProfile: {
        contractAddress: "TKSQrCn9r7jdNxWuQGRw8RJT8x4LFNfr7B",
        providerTags: [{ kind: "tag1", label: "LayerZero: Executor", url: null }],
        publicTags: [{ label: "LayerZero: Executor", description: null }],
        topMethods: [{ methodId: "cfc32570", method: "cfc32570", signature: null, calls: 3435, count: 3435, ratio: 0.9695, percentage: 0.9695 }],
        methodMap: {
          "3659cfe6": "upgradeTo(address)",
          "4f1ef286": "upgradeToAndCall(address,bytes)"
        },
        hasTransferFromSelector: false,
        hasOwnerOnlyPattern: false,
        lowMetadata: false
      } as any,
      approvalDrainProof: {
        approveFound: false,
        transferFromConfirmed: false,
        spenderMatched: false
      }
    });

    expect(evidence.kind).toBe("layerzero_oft_delivery");
    expect(evidence.confidence).toBe("high");
    expect(evidence.drainProof).toBe("not_proven");
    expect(evidence.guardCodes).toEqual(expect.arrayContaining([
      "usdt_from_address_is_contract",
      "layerzero_endpoint_present",
      "oft_contract_present",
      "no_confirmed_approval_drain"
    ]));
  });

  it("detects DEX/router service boundaries without calling them drains", () => {
    const evidence = extractServiceRouteEvidence({
      subjectAddress: "TSubject",
      transactionInfo: {
        contractInfo: {
          TRouter: { tag1: "SunSwap Router", name: "SunSwapV2Router", publicTag: "SunSwap Router" },
          TPool: { tag1: "DEX Pool", name: "USDT-TRX Pair", publicTag: "SunSwap Pool" }
        },
        contract_map: { TRouter: true, TPool: true, TSubject: false },
        trc20TransferInfo: [
          { symbol: "USDT", from_address: "TPool", to_address: "TSubject", amount_str: "10000000000" }
        ]
      },
      approvalDrainProof: { approveFound: false, transferFromConfirmed: false, spenderMatched: false }
    });

    expect(evidence.category).toBe("dex_router_or_swap_aggregator");
    expect(evidence.drainProof).toBe("not_proven");
    expect(evidence.guardCodes).toContain("service_route_boundary_present");
  });

  it("detects unknown service-like contract routes as policy context, not exact drains", () => {
    const evidence = extractServiceRouteEvidence({
      subjectAddress: "TSubject",
      transactionInfo: {
        contractInfo: {
          TUnknownService: { tag1: "", name: "UnknownProxy", publicTag: "" }
        },
        contract_map: { TUnknownService: true, TSubject: false },
        trc20TransferInfo: [
          { symbol: "USDT", from_address: "TUnknownService", to_address: "TSubject", amount_str: "50000000000" }
        ]
      },
      approvalDrainProof: { approveFound: false, transferFromConfirmed: false, spenderMatched: false }
    });

    expect(evidence.category).toBe("unknown_service_route");
    expect(evidence.drainProof).toBe("not_proven");
    expect(evidence.policyRiskCeiling).toBeLessThan(95);
  });
});
```

- [ ] **Step 4: Run the new evidence tests and verify failure**

```bash
npx vitest run tests/forensics/serviceRouteEvidence.test.ts
```

Expected: FAIL because `serviceRouteEvidence.ts` does not exist.

- [ ] **Step 5: Implement service-route evidence extraction**

Create `src/forensics/serviceRouteEvidence.ts`:

```ts
import type { ContractRiskContext } from "../approvals/contractIntelligence";
import { matchServiceRouteRegistry, type ServiceRouteCategory } from "./serviceRouteRegistry";

export type ApprovalDrainProofFacts = {
  approveFound: boolean;
  transferFromConfirmed: boolean;
  spenderMatched: boolean;
};

export type ServiceRouteEvidenceKind =
  | "layerzero_oft_delivery"
  | "known_service_route"
  | "dex_router_boundary"
  | "unknown_service_route"
  | "none";

export type ServiceRouteEvidence = {
  kind: ServiceRouteEvidenceKind;
  confidence: "low" | "medium" | "high";
  category: ServiceRouteCategory | null;
  identity: string | null;
  policyRiskFloor: number;
  policyRiskCeiling: number;
  drainProof: "not_proven" | "possible" | "proven";
  guardCodes: string[];
  signals: string[];
  contracts: Array<{
    address: string;
    name: string | null;
    tag: string | null;
    isContract: boolean | null;
  }>;
};

export type ExtractServiceRouteEvidenceInput = {
  subjectAddress: string;
  transactionInfo: unknown;
  contractProfile?: ContractRiskContext | null;
  approvalDrainProof?: ApprovalDrainProofFacts | null;
};

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function lower(...values: unknown[]): string {
  return values.map(text).join(" ").toLowerCase();
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function contractEntries(transactionInfo: unknown): ServiceRouteEvidence["contracts"] {
  const tx = record(transactionInfo);
  const info = record(tx.contractInfo);
  const contractMap = record(tx.contract_map);
  return Object.entries(info).map(([address, raw]) => {
    const item = record(raw);
    return {
      address,
      name: text(item.name) || null,
      tag: text(item.tag1) || text(item.publicTag) || null,
      isContract: typeof contractMap[address] === "boolean" ? contractMap[address] : null
    };
  });
}

function transferRows(transactionInfo: unknown): Array<Record<string, any>> {
  const tx = record(transactionInfo);
  return Array.isArray(tx.trc20TransferInfo) ? tx.trc20TransferInfo.map(record) : [];
}

function profileText(profile: ContractRiskContext | null | undefined): string {
  const tags = [
    ...(profile?.providerTags ?? []).map((tag) => tag.label),
    ...(profile?.publicTags ?? []).map((tag) => tag.label)
  ];
  return lower(profile?.name, profile?.serviceTag, profile?.publicTag, profile?.publicTagDesc, ...tags);
}

export function extractServiceRouteEvidence(input: ExtractServiceRouteEvidenceInput): ServiceRouteEvidence {
  const contracts = contractEntries(input.transactionInfo);
  const combinedText = lower(
    profileText(input.contractProfile),
    ...contracts.flatMap((contract) => [contract.name, contract.tag])
  );
  const rows = transferRows(input.transactionInfo);
  const hasLayerZeroEndpoint = hasAny(combinedText, ["layerzero: endpoint", "endpointv2", "layerzero endpoint"]);
  const hasLayerZeroExecutor = hasAny(combinedText, ["layerzero: executor", "layerzero executor"]);
  const hasOft = hasAny(combinedText, ["usdtoft", " oft", "omnichain fungible token"]);
  const subjectUsdtIncoming = rows.find((row) =>
    lower(row.symbol, row.name).includes("usdt") &&
    text(row.to_address) === input.subjectAddress
  );
  const fromAddress = text(subjectUsdtIncoming?.from_address);
  const fromIsContract = contracts.some((contract) => contract.address === fromAddress && contract.isContract === true);
  const noConfirmedDrain = !input.approvalDrainProof?.transferFromConfirmed || !input.approvalDrainProof?.spenderMatched;
  const profileHasNoTransferFrom = input.contractProfile?.hasTransferFromSelector !== true;
  const registryMatch = matchServiceRouteRegistry(combinedText);

  if ((hasLayerZeroEndpoint || hasLayerZeroExecutor) && hasOft && subjectUsdtIncoming && fromIsContract) {
    const guardCodes = [
      fromIsContract ? "usdt_from_address_is_contract" : null,
      hasLayerZeroEndpoint ? "layerzero_endpoint_present" : null,
      hasLayerZeroExecutor ? "layerzero_executor_present" : null,
      hasOft ? "oft_contract_present" : null,
      profileHasNoTransferFrom ? "no_transfer_from_selector_in_profile" : null,
      noConfirmedDrain ? "no_confirmed_approval_drain" : null
    ].filter((item): item is string => Boolean(item));

    return {
      kind: "layerzero_oft_delivery",
      confidence: guardCodes.length >= 4 ? "high" : "medium",
      category: "cross_chain_bridge",
      identity: "LayerZero/OFT",
      policyRiskFloor: 65,
      policyRiskCeiling: 75,
      drainProof: input.approvalDrainProof?.transferFromConfirmed && input.approvalDrainProof?.spenderMatched ? "proven" : "not_proven",
      guardCodes,
      signals: ["layerzero_oft_delivery", ...guardCodes],
      contracts
    };
  }

  if (registryMatch) {
    return {
      kind: registryMatch.category === "dex_router_or_swap_aggregator" ? "dex_router_boundary" : "known_service_route",
      confidence: "medium",
      category: registryMatch.category,
      identity: registryMatch.canonicalName,
      policyRiskFloor: registryMatch.policyRiskFloor,
      policyRiskCeiling: registryMatch.policyRiskCeiling,
      drainProof: input.approvalDrainProof?.transferFromConfirmed && input.approvalDrainProof?.spenderMatched ? "proven" : "not_proven",
      guardCodes: [
        "service_route_boundary_present",
        noConfirmedDrain ? "no_confirmed_approval_drain" : null
      ].filter((item): item is string => Boolean(item)),
      signals: [registryMatch.category, registryMatch.canonicalName],
      contracts
    };
  }

  if (subjectUsdtIncoming && fromIsContract && noConfirmedDrain) {
    return {
      kind: "unknown_service_route",
      confidence: "low",
      category: "unknown_service_route",
      identity: "Unknown service-like contract",
      policyRiskFloor: 45,
      policyRiskCeiling: 70,
      drainProof: "not_proven",
      guardCodes: ["unknown_contract_service_shape", "usdt_from_address_is_contract", "no_confirmed_approval_drain"],
      signals: ["unknown_service_like_route"],
      contracts
    };
  }

  return {
    kind: "none",
    confidence: "low",
    category: null,
    identity: null,
    policyRiskFloor: 0,
    policyRiskCeiling: 0,
    drainProof: input.approvalDrainProof?.transferFromConfirmed && input.approvalDrainProof?.spenderMatched ? "proven" : "not_proven",
    guardCodes: [],
    signals: [],
    contracts
  };
}
```

- [ ] **Step 6: Wire service-route evidence into approval-drain review findings**

In `tests/forensics/approvalDrainProvenance.test.ts`, add a regression where the transaction has service-route evidence but no confirmed approval drain:

```ts
it("emits service-boundary review finding instead of proven drain for service-route transactions", async () => {
  const lookup = {
    ...deps({ approvals: [] }),
    getTransaction: vi.fn(async () => ({
      ownerAddress: "TRelayer",
      contractData: { contract_address: "TLayerZeroExecutor" },
      trigger_info: { methodName: "lzReceive", contract_address: "TLayerZeroExecutor" },
      contractInfo: {
        TLayerZeroExecutor: { tag1: "LayerZero: Executor", name: "Executor", publicTag: "LayerZero: Executor" },
        TUsdtOftContract: { tag1: "", name: "UsdtOFT", publicTag: "" }
      },
      contract_map: { TLayerZeroExecutor: true, TUsdtOftContract: true, [subject]: false },
      trc20TransferInfo: [
        { symbol: "USDT", from_address: "TUsdtOftContract", to_address: subject, amount_str: "89473150000" }
      ]
    }))
  };

  const analysis = await buildApprovalDrainProvenanceAnalysis({
    subjectAddress: subject,
    edges: [
      edge({
        id: "service-route-tx",
        from: "TUsdtOftContract",
        to: subject,
        amountRaw: "89473150000",
        at: "2026-05-09T21:00:00.000Z",
        edgeType: "transfer_from",
        method: "lzReceive"
      })
    ],
    classifications: new Map([
      ["TLayerZeroExecutor", {
        category: "bridge",
        identity: "LayerZero/OFT",
        confidence: "high",
        evidence: ["service_route:cross_chain_bridge"],
        isBoundary: true
      }]
    ]),
    deps: lookup
  });

  expect(analysis.profiles).toHaveLength(0);
  expect(analysis.reviewFindings).toContainEqual(expect.objectContaining({
    reason: "service_boundary_guard",
    drainTxHash: "service-route-tx",
    falsePositiveGuards: expect.arrayContaining([
      expect.objectContaining({
        code: "service_boundary_route",
        category: "bridge",
        identity: "LayerZero/OFT"
      })
    ])
  }));
});
```

In `src/forensics/approvalDrainProvenance.ts`, after fetching transaction details and before creating an exact approval-drain profile, call `extractServiceRouteEvidence`. If `drainProof !== "proven"`, convert it to the existing review-finding shape:

```ts
const serviceRouteEvidence = extractServiceRouteEvidence({
  subjectAddress: input.subjectAddress,
  transactionInfo,
  contractProfile: input.contractProfiles?.get(spenderAddress ?? drainEdge.toAddress) ?? null,
  approvalDrainProof: {
    approveFound: Boolean(approvalMatch),
    transferFromConfirmed: transferFromConfirmed === true,
    spenderMatched: spenderMatched === true
  }
});

if (serviceRouteEvidence.kind !== "none" && serviceRouteEvidence.drainProof !== "proven") {
  reviewFindings.push({
    victimAddress: drainEdge.fromAddress,
    drainTxHash: drainEdge.txHash,
    spenderAddress,
    operatorAddress,
    spenderResolution,
    firstReceiverAddress: drainEdge.toAddress,
    subjectAddress: input.subjectAddress,
    reason: "service_boundary_guard",
    falsePositiveGuards: [
      {
        code: "service_boundary_route",
        label: `Approval-drain auto-decline blocked by ${serviceRouteEvidence.identity ?? "service-route"} context.`,
        address: spenderAddress ?? drainEdge.toAddress,
        category: mapServiceRouteCategoryToServiceCategory(serviceRouteEvidence.category),
        identity: serviceRouteEvidence.identity
      }
    ],
    supportingFingerprints: []
  });
  continue;
}
```

Add a local mapper in the same file:

```ts
function mapServiceRouteCategoryToServiceCategory(category: ServiceRouteCategory | null): ServiceCategory | null {
  switch (category) {
    case "cross_chain_bridge":
    case "bridge_aggregator":
      return "bridge";
    case "dex_router_or_swap_aggregator":
      return "dex";
    case "stablecoin_or_wrapped_asset_protocol":
      return "protocol";
    case "gasless_or_smart_account_service":
      return "service";
    case "unknown_service_route":
      return "unknown_contract";
    default:
      return null;
  }
}
```

- [ ] **Step 7: Expand deterministic service classifier**

In `src/forensics/serviceClassifier.ts`, before generic bridge/router checks, call the registry matcher against metadata/profile text:

```ts
import { matchServiceRouteRegistry } from "./serviceRouteRegistry";

const registryMatch = matchServiceRouteRegistry(text);

if (registryMatch) {
  evidence.push(`service_route:${registryMatch.category}`);
  evidence.push(`service_route_identity:${registryMatch.canonicalName}`);

  if (registryMatch.category === "dex_router_or_swap_aggregator") {
    return classification(input, "dex", identityFor(input, registryMatch.canonicalName), confidenceFor(input, true), evidence);
  }

  if (registryMatch.category === "cross_chain_bridge" || registryMatch.category === "bridge_aggregator") {
    return classification(input, "bridge", identityFor(input, registryMatch.canonicalName), confidenceFor(input, true), evidence);
  }

  return classification(input, "service", identityFor(input, registryMatch.canonicalName), confidenceFor(input, true), evidence);
}
```

Add a test in `tests/forensics/serviceClassifier.test.ts`:

```ts
it("classifies LayerZero OFT contracts as bridge boundaries", () => {
  const result = classifyServiceAddress({
    address: "TKSQrCn9r7jdNxWuQGRw8RJT8x4LFNfr7B",
    metadata: null,
    contractProfile: {
      contractAddress: "TKSQrCn9r7jdNxWuQGRw8RJT8x4LFNfr7B",
      providerTags: [{ kind: "tag1", label: "LayerZero: Executor", url: null }],
      publicTags: [{ label: "LayerZero: Executor", description: null }],
      methodMap: {},
      topMethods: []
    } as any
  });

  expect(result.category).toBe("bridge");
  expect(result.identity).toContain("LayerZero");
});

it("classifies DEX routers as service boundaries but not bridges", () => {
  const result = classifyServiceAddress({
    address: "TRouter",
    metadata: { tag: "SunSwap Router", name: "SunSwapV2Router" } as any,
    contractProfile: null
  });

  expect(result.category).toBe("dex");
  expect(result.identity).toContain("DEX/router");
});
```

- [ ] **Step 8: Add LLM cap test**

In `tests/forensics/moneyOriginOperationalAssessment.test.ts`, add:

```ts
it("caps LLM drainer verdict when service-route guard is present and exact drain is not proven", () => {
  const assessment = buildMoneyOriginOperationalAssessment({
    fastWalletRisk: lowFastRisk(),
    originPaths: [
      moneyOriginPath({
        verdict: "DECLINE",
        riskScoreContribution: 70,
        stoppedReason: "decline_boundary_reached",
        reasons: ["Recent-flow path reaches cross-chain service boundary."]
      })
    ],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [
      {
        victimAddress: "TUsdtOftContract",
        drainTxHash: "41b808",
        spenderAddress: "TKSQrCn9r7jdNxWuQGRw8RJT8x4LFNfr7B",
        operatorAddress: "TRelayer",
        spenderResolution: "wrapper_contract",
        firstReceiverAddress: subject,
        subjectAddress: subject,
        reason: "service_boundary_guard",
        falsePositiveGuards: [
          {
            code: "service_boundary_route",
            label: "Approval-drain auto-decline blocked by LayerZero/OFT context.",
            address: "TKSQrCn9r7jdNxWuQGRw8RJT8x4LFNfr7B",
            category: "bridge",
            identity: "LayerZero/OFT"
          }
        ],
        supportingFingerprints: []
      }
    ],
    contractLlmVerdicts: [
      {
        source: "llm",
        providerLabel: "deepseek",
        model: "deepseek-v4-pro",
        contractAddress: "TKSQrCn9r7jdNxWuQGRw8RJT8x4LFNfr7B",
        caseFileHash: "case",
        verdict: "drainer_like",
        confidence: 0.9,
        contractRiskScore: 95,
        decisionRecommendation: "DECLINE",
        reasons: ["LLM suspected drainer."],
        citedEvidenceIds: ["41b808"],
        falsePositiveNotes: ["Cross-chain service-route context present."],
        cacheId: null,
        error: null
      }
    ],
    coverage: coverageFixture({ provenanceScope: "recent_flow" }),
    ageSignals: null
  });

  expect(assessment.decision).toBe("DECLINE");
  expect(assessment.riskScore).toBeLessThanOrEqual(75);
  expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("llm_contract_suspicion");
});
```

- [ ] **Step 9: Implement LLM cap in assessment**

In `src/forensics/moneyOriginOperationalAssessment.ts`, add helper:

```ts
function hasServiceRouteGuard(input: BuildMoneyOriginOperationalAssessmentInput): boolean {
  const exactDrainAlreadyProven = input.approvalDrainProvenanceProfiles.some((profile) =>
    profile.evidenceStrength === "exact_approval_and_transfer_from"
  );
  if (exactDrainAlreadyProven) return false;

  return input.approvalDrainReviewFindings.some((finding) => {
    if (finding.reason !== "service_boundary_guard") return false;
    return finding.falsePositiveGuards.some((guard) =>
      guard.code === "service_boundary_route" ||
      guard.category === "bridge" ||
      guard.category === "bridge_pool" ||
      guard.category === "dex" ||
      guard.category === "router" ||
      guard.category === "swap_adapter" ||
      guard.category === "service" ||
      guard.category === "protocol" ||
      guard.category === "unknown_contract"
    );
  });
}
```

Modify `hardEvidenceFromLlm` call path so `drainer_like` does not become `llm_contract_suspicion` when `hasServiceRouteGuard(input)` is true and there is no exact approval-drain profile.

Add a service-boundary policy branch:

```ts
if (hasServiceRouteGuard(input) && input.originPaths.some((path) => path.rootSourceType === "decline_boundary")) {
  return {
    decision: "DECLINE",
    riskScore: 70,
    riskBand: "HIGH",
    provenanceConfidence: provenanceConfidence(input),
    coverageCompleteness: coverageScore,
    walletRole: role,
    operationalLiquidityScore: operationalScore,
    ageSignals: input.ageSignals,
    hardBadEvidence,
    reasons: ["Service boundary reached; drainer proof is not proven, but this service-origin source is declined by policy."],
    warnings: llmVerdictWarnings(input.contractLlmVerdicts)
  };
}
```

Place this after exact hard evidence checks and before generic LLM suspicion.

- [ ] **Step 10: Feed service-route evidence into case files**

In `src/forensics/contractLlmVerdict.ts`, extend the case file snapshot to include:

```ts
serviceRouteEvidence?: ServiceRouteEvidence[];
```

When building case files from transaction/approval review findings, include service-route evidence if present on the finding. Preserve these facts in the JSON sent to the LLM.

- [ ] **Step 11: Run focused tests**

```bash
npx vitest run tests/forensics/serviceRouteRegistry.test.ts tests/forensics/serviceRouteEvidence.test.ts tests/forensics/serviceClassifier.test.ts tests/forensics/approvalDrainProvenance.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/forensics/contractLlmVerdict.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/forensics/serviceRouteRegistry.ts src/forensics/serviceRouteEvidence.ts src/forensics/serviceClassifier.ts src/forensics/approvalDrainProvenance.ts src/forensics/contractLlmVerdict.ts src/forensics/moneyOriginOperationalAssessment.ts tests/forensics/serviceRouteRegistry.test.ts tests/forensics/serviceRouteEvidence.test.ts tests/forensics/serviceClassifier.test.ts tests/forensics/approvalDrainProvenance.test.ts tests/forensics/contractLlmVerdict.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts
git commit -m "fix: guard service routes from drain overclaiming"
```

---

### Task 9: Full Verification And Live Smoke

**Files:**
- No planned code changes.

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

```bash
npm test -- --run
```

Expected: PASS.

- [ ] **Step 3: Live smoke TPvF low-balance and service-boundary case**

```bash
node --import tsx scripts/forensicWhereIsMoney.ts --source TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb --days 90 --depth 7 --beam 8 --max-addresses 60 --max-edges 100 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 5000
```

Expected:

```text
Current USDT balance: 0.147 USDT
Provenance scope: Recent flow provenance
Anchor: outgoing ...
Recent-flow funding transfers: ...
Evidence type: cross-chain bridge/service boundary
Drainer proof: not proven
```

The exact decision may still be `DECLINE` if bridge/cross-chain policy evidence is found, but the explanation must not say that a historical 89k transfer formed the current 0.147 USDT balance or that approval drain is proven without deterministic proof.

- [ ] **Step 4: Live smoke DEX/router boundary wording**

Use any known Tron DEX/router routed transaction discovered during manual QA, or a stored fixture if live data is unavailable. Expected report language:

```text
Evidence type: DEX/router service boundary
Drainer proof: not proven
Clean origin before swap is not proven
```

- [ ] **Step 5: Live smoke working wallets**

```bash
node --import tsx scripts/forensicWhereIsMoney.ts --source TVzGYWyg89wUmwhvbcwfonHVLDYYQAiZMF --days 90 --depth 7 --beam 8 --max-addresses 60 --max-edges 100 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 5000
node --import tsx scripts/forensicWhereIsMoney.ts --source TTs9xCEZ43niXvfKTu7LcF7Kcud3Bbw7FD --days 90 --depth 7 --beam 8 --max-addresses 60 --max-edges 100 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 5000
```

Expected:

```text
Decision: ACCEPTABLE
Risk: LOW-MEDIUM or MEDIUM
Hard bad evidence: none
```

- [ ] **Step 6: Telegram smoke**

Start the bot:

```bash
npm run dev
```

Run `/check TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb` in Telegram.

Expected where-is-money message:

```text
Recent flow provenance
Current balance is below the low-balance threshold
Recent flow coverage
Drainer proof: not proven
```

- [ ] **Step 7: Final commit**

If Task 9 required any small fixes, commit them:

```bash
git add .
git commit -m "fix: finalize low-balance recent flow smoke"
```

If there were no changes, do not create an empty commit.

---

## Self-Review

- Spec coverage: Tasks 1-3 implement mode selection and recent-flow selector; Tasks 5-6 implement reporting; Task 4 implements scoring behavior; Task 7 covers LLM case context; Task 8 covers cross-chain/DEX/router/stablecoin/gasless service-route guardrails; Task 9 covers verification.
- Placeholder scan: No placeholder markers or vague edge-case steps remain.
- Type consistency: `provenanceScope`, `anchorTransfer`, `dataScopeNote`, `recent_outgoing`, and `recent_large_inbound` are introduced in Task 1 and reused consistently in later tasks.
