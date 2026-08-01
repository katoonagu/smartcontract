# Where Balance-Forming Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ordinary `Where is money` trace each hop through the concrete incoming transfers that could have funded that hop, without automatically starting broad `genesis -> targetTimestamp` targeted indexing on dense unresolved wallets.

**Architecture:** Keep the existing money-origin trace and materiality assessment, but change the hop data acquisition model. For a target hop transfer, read related transfers backwards only until the trace can explain the hop amount with balance-forming incoming transfers, or until a bounded runtime page cap proves the hop is still unresolved/dense. Broad targeted indexing remains available only for hard-evidence branches and explicit strict/manual provenance modes, not as the default ordinary Where fallback.

**Tech Stack:** TypeScript, Vitest, existing TRON USDT transfer fetcher, existing `buildFundingBundleForTraceHop`, existing `moneyOriginOperationalAssessment`, Admin graph/progress rendering.

---

## Product Spec

### Problem

Ordinary `Where is money` currently can turn an unresolved dense hop into a broad targeted index task.

Live example from 2026-07-06:

```text
Job: a49e2e30-e232-4a52-905f-34c6fa6c5f1f
Subject: THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7

TNeK4Vg...ftnYkRJ -> TZGwoj4...ktGE6TA
10,000 USDT
2026-06-29T22:55:33.000Z
tx 1dfebcf36a62b0d8dcd63897d95d51ccab329819c74954cd0c49e8c60dc4b8c2

TJ5WLeU...zFGF3EJ -> TZGwoj4...ktGE6TA
4,000 USDT
2026-06-30T06:18:21.000Z
tx a9985180ffff1a9de9974f056bec428ef65c85aaec76a5124f22a874cf039bdb
```

Those addresses were not the subject wallet. They were upstream hop senders.
The current job queued `broad_targeted` rows for them:

```text
TNeK4...: 272 pages, 13,587 transfers, 440 counterparties
TJ5W...:   73 pages,  3,631 transfers, 627 counterparties
```

On heavier addresses this path can reach the current 12,000-page ceiling. That is too expensive for the default ordinary Where mode.

### Desired Mental Model

For each hop, the product question is:

```text
Which incoming transfers could have funded this exact outgoing transfer?
```

Not:

```text
Download the whole address history until the target timestamp.
```

For a target hop:

```text
B -> C
10,000 USDT
2026-06-29T22:55:33Z
```

Where should inspect transfers involving `B` before `22:55:33Z`, account for spends by `B` before the target hop, and select only incoming transfers that could still be available to fund the target hop.

### Balance-Forming Slice

A balance-forming slice is the smallest explainable set of prior incoming transfers that can fund a target hop after intermediate spends are accounted for.

Example:

```text
21:00  A -> B   50,000 USDT
21:30  B -> X   45,000 USDT
22:55  B -> C   10,000 USDT
```

The 50,000 USDT incoming cannot fully explain the 10,000 USDT target hop because 45,000 USDT was already spent. Only 5,000 USDT remains usable. The trace must keep searching for more prior funding.

The existing helper `buildFundingBundleForTraceHop` already implements this spend-aware calculation on a provided edge set. The fix is to feed it the right edge set through bounded backwards fetching, not broad address indexing.

### Stop Conditions

Ordinary Where should stop fetching a hop when one of these is true:

- **covered:** selected incoming transfers cover the configured ratio of the target hop amount;
- **service boundary reached:** the current hop address is classified as a known CEX/service/bridge/policy boundary before deeper fetch;
- **runtime page cap reached:** the hop remains unresolved after a small ordinary-mode page cap;
- **provider inconsistency:** live provider response is invalid or unstable;
- **hard evidence branch:** the path intersects hard bad evidence and may require strict/manual broad coverage.

### Ordinary Where Policy

Ordinary Where must not queue `broad_targeted` for a dense/unresolved hop merely because the hop is material.

Ordinary Where should:

1. Try spend-aware balance-forming slice search for the target hop.
2. If covered, continue tracing from the selected funder wallets.
3. If not covered, store source provenance as unresolved or pre-existing-balance possible.
4. Let materiality decide whether the unresolved amount is a score-valid caveat or a score-blocking coverage gap.
5. Keep broad targeted indexing only for hard-evidence branches or explicit strict/manual/debug modes.

### Strict Or Manual Mode

Strict/manual provenance can still use broad targeted indexing. That mode must be explicit in code and progress metadata. Ordinary `where_is_money_check` should not silently turn into a 12,000-page index run.

### Admin Progress Copy

Admin should show the concrete reason for hop analysis:

```text
Tracing source for 10,000 USDT
TNeK4Vg...ftnYkRJ -> TZGwoj4...ktGE6TA
tx 1dfebcf36a62b0d8dcd63897d95d51ccab329819c74954cd0c49e8c60dc4b8c2

Looking for incoming transfers into TNeK4Vg... before 2026-06-29 22:55
that could fund this hop.
```

Do not show this as if the subject wallet itself is being indexed.

---

## Scope Guard

Do not change:

- DeepCheck drainer/campaign behavior.
- Admin graph edge semantics already fixed for misleading context edges.
- Scoring thresholds from dense-hop materiality.
- Migrations.
- The broad targeted index worker itself, except tests may assert ordinary Where no longer calls it by default.
- `tmp/`.

Do change:

- Ordinary Where hop fetch behavior.
- Where source provenance wording and progress metadata.
- Tests for no automatic broad targeted wait on dense/unresolved ordinary Where hops.

---

## Current Code Facts

- `src/forensics/incomingDepositCashflow.ts:buildFundingBundleForTraceHop` already computes usable incoming amounts and subtracts `spentBeforeHopRaw`.
- `src/forensics/moneyOriginTrace.ts` calls `fetchEdgesForAddress` for each hop and then evaluates funding provenance.
- `src/forensics/moneyOriginTrace.ts` can currently call `ensureBroadTargetedHistory` for unresolved/material hops.
- `src/check/whereIsMoneyCheck.ts:postAssessmentBroadFallbackTargets` can batch queue broad fallback after initial assessment.
- `src/forensics/deepForensicJob.ts:runWhereIsMoneyJob` wires `ensureBroadTargetedHistories` to `ensureTargetedHistoriesOrWait`, which queues `broad_targeted`.
- `src/index.ts` sets `TARGETED_HISTORY_BACKGROUND_MAX_PAGES_PER_HOP = 12000`.
- `src/admin/forensicsGraph.ts` and `src/admin/adminConsole.ts` render targeted-index progress and source-provenance caveats.

---

## File Structure

Create:

- `src/forensics/balanceFormingSlice.ts` - pure helpers for deciding whether the currently fetched edges cover a target hop and for producing progress-friendly slice summaries.
- `tests/forensics/balanceFormingSlice.test.ts` - unit tests for multi-day/month funding, spend-overhang, and dense unresolved slice summaries.

Modify:

- `src/types.ts` - add balance-forming slice metadata to history coverage/source provenance/progress types.
- `src/forensics/incomingDepositCashflow.ts` - export or reuse existing spend-aware bundle output without changing its semantics.
- `src/forensics/moneyOriginTrace.ts` - pass target hop context into fetch, stop auto-broad fallback for ordinary unresolved hops, and keep hard-evidence broad path available through Where-level post-assessment.
- `src/check/whereIsMoneyCheck.ts` - gate post-assessment broad fallback by mode/reason, so ordinary material unresolved does not queue broad unless hard evidence is present.
- `src/forensics/deepForensicJob.ts` - implement paged runtime fetch for balance-forming slice and progress patches, without writing targeted index states.
- `src/admin/forensicsGraph.ts` - expose balance-forming slice status in graph summary and selected hop details.
- `src/admin/adminConsole.ts` - render readable hop-source progress/details.
- `src/bot/createBot.ts` - keep bot wording from saying the whole check failed when the result is an unresolved balance-forming caveat/no-score.
- `tests/forensics/moneyOriginTrace.test.ts`
- `tests/check/whereIsMoneyCheck.test.ts`
- `tests/forensics/deepForensicJob.test.ts`
- `tests/admin/forensicsGraph.test.ts`
- `tests/admin/adminConsole.test.ts`
- `tests/bot/createBot.test.ts`
- `docs/knowledge/04-data-sources-tronscan-indexing.md`
- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/08-admin-and-bot-ux.md`
- `docs/knowledge/09-current-decisions.md`
- `docs/knowledge/10-open-problems.md`

---

## Runtime Constants

Use conservative local constants near Where runtime config first:

```ts
const WHERE_BALANCE_SLICE_PAGE_SIZE = 50;
const WHERE_BALANCE_SLICE_MAX_PAGES = 20;
const WHERE_BALANCE_SLICE_MIN_COVERAGE_RATIO = 0.95;
```

Meaning:

- ordinary Where can inspect up to 1,000 live related transfer rows per hop before declaring the slice unresolved;
- this is not a fixed time window;
- a hop can reach days or months back if the transfer density is low;
- a dense wallet stops by page budget instead of starting the 12,000-page targeted index.

Future product config can move these out of constants. Do not add config plumbing in this plan.

---

### Task 1: Add Pure Balance-Forming Slice Tests And Helper

**Files:**
- Create: `src/forensics/balanceFormingSlice.ts`
- Create: `tests/forensics/balanceFormingSlice.test.ts`

- [ ] **Step 1: Write failing tests for spend-aware slice behavior**

Create `tests/forensics/balanceFormingSlice.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ForensicRouteEdge } from "../../src/types";
import { buildBalanceFormingSlice } from "../../src/forensics/balanceFormingSlice";

function edge(
  txHash: string,
  fromAddress: string,
  toAddress: string,
  amountRaw: string,
  timestamp: string
): ForensicRouteEdge {
  return {
    txHash,
    fromAddress,
    toAddress,
    amountRaw,
    timestamp: new Date(timestamp),
    direction: "out",
    edgeType: "normal_transfer"
  };
}

describe("buildBalanceFormingSlice", () => {
  it("uses prior incoming transfers even when they are days before the hop", () => {
    const sender = "TSender1111111111111111111111111111";
    const subject = "TSubject111111111111111111111111111";
    const cex = "TBybit11111111111111111111111111111";
    const target = edge("tx-hop", sender, subject, "10000000000", "2026-06-30T22:55:33.000Z");

    const result = buildBalanceFormingSlice({
      target,
      edges: [
        target,
        edge("tx-funding-five-days-earlier", cex, sender, "10000000000", "2026-06-25T10:00:00.000Z")
      ],
      minCoverageRatio: 0.95,
      maxFunders: 5,
      fetchedPageCount: 1,
      pageBudgetExhausted: false,
      providerCapHit: false,
      providerInconsistent: false
    });

    expect(result.status).toBe("covered");
    expect(result.coveredAmountRaw).toBe("10000000000");
    expect(result.coverageRatio).toBe(1);
    expect(result.fundingBundle?.members).toEqual([
      expect.objectContaining({
        txHash: "tx-funding-five-days-earlier",
        fromAddress: cex,
        toAddress: sender,
        usedAmountRaw: "10000000000",
        spentBeforeHopRaw: "0"
      })
    ]);
  });

  it("subtracts outgoing spends before deciding an incoming transfer can fund the hop", () => {
    const sender = "TSender2222222222222222222222222222";
    const subject = "TSubject222222222222222222222222222";
    const funderOne = "TFunderOne222222222222222222222222";
    const funderTwo = "TFunderTwo222222222222222222222222";
    const target = edge("tx-hop", sender, subject, "10000000000", "2026-06-30T22:55:33.000Z");

    const result = buildBalanceFormingSlice({
      target,
      edges: [
        target,
        edge("tx-second-funding", funderTwo, sender, "6000000000", "2026-06-30T20:00:00.000Z"),
        edge("tx-spent-before-hop", sender, "TSpend222222222222222222222222222", "45000000000", "2026-06-30T19:00:00.000Z"),
        edge("tx-first-funding", funderOne, sender, "50000000000", "2026-06-30T18:00:00.000Z")
      ],
      minCoverageRatio: 0.95,
      maxFunders: 5,
      fetchedPageCount: 1,
      pageBudgetExhausted: false,
      providerCapHit: false,
      providerInconsistent: false
    });

    expect(result.status).toBe("covered");
    expect(result.coveredAmountRaw).toBe("10000000000");
    expect(result.fundingBundle?.members).toEqual([
      expect.objectContaining({
        txHash: "tx-second-funding",
        usedAmountRaw: "6000000000",
        spentBeforeHopRaw: "0"
      }),
      expect.objectContaining({
        txHash: "tx-first-funding",
        usedAmountRaw: "4000000000",
        spentBeforeHopRaw: "45000000000"
      })
    ]);
  });

  it("marks dense unresolved when page budget is exhausted before coverage", () => {
    const sender = "TDenseSender333333333333333333333333";
    const subject = "TSubject333333333333333333333333333";
    const target = edge("tx-hop", sender, subject, "10000000000", "2026-06-30T22:55:33.000Z");

    const result = buildBalanceFormingSlice({
      target,
      edges: [
        target,
        edge("tx-small-funding", "TFunder333333333333333333333333333", sender, "1000000000", "2026-06-30T22:40:00.000Z")
      ],
      minCoverageRatio: 0.95,
      maxFunders: 5,
      fetchedPageCount: 20,
      pageBudgetExhausted: true,
      providerCapHit: true,
      providerInconsistent: false
    });

    expect(result.status).toBe("dense_unresolved");
    expect(result.coveredAmountRaw).toBe("1000000000");
    expect(result.coverageRatio).toBe(0.1);
    expect(result.reason).toBe("balance_forming_slice_budget_exhausted");
  });
});
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run:

```powershell
npm test -- tests/forensics/balanceFormingSlice.test.ts
```

Expected: fails because `src/forensics/balanceFormingSlice.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/forensics/balanceFormingSlice.ts`:

```ts
import type { ForensicRouteEdge } from "../types";
import { buildFundingBundleForTraceHop, type TraceFundingBundle } from "./incomingDepositCashflow";

export type BalanceFormingSliceStatus =
  | "covered"
  | "partial"
  | "dense_unresolved"
  | "provider_inconsistent";

export type BalanceFormingSliceResult = {
  status: BalanceFormingSliceStatus;
  reason: string | null;
  targetTxHash: string;
  targetFromAddress: string;
  targetToAddress: string;
  targetAmountRaw: string;
  targetTimestamp: string;
  coveredAmountRaw: string;
  coverageRatio: number;
  fetchedTransferCount: number;
  fetchedPageCount: number;
  pageBudgetExhausted: boolean;
  providerCapHit: boolean;
  providerInconsistent: boolean;
  fundingBundle: TraceFundingBundle | null;
};

function parseRaw(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number((numerator * 10_000n) / denominator) / 10_000;
}

export function buildBalanceFormingSlice(input: {
  target: ForensicRouteEdge;
  edges: ForensicRouteEdge[];
  minCoverageRatio: number;
  maxFunders: number;
  fetchedPageCount: number;
  pageBudgetExhausted: boolean;
  providerCapHit: boolean;
  providerInconsistent: boolean;
}): BalanceFormingSliceResult {
  const fundingBundle = buildFundingBundleForTraceHop({
    target: input.target,
    edges: input.edges,
    minCoverageRatio: input.minCoverageRatio,
    maxFunders: input.maxFunders
  });
  const targetAmount = parseRaw(input.target.amountRaw);
  const coveredAmount = parseRaw(fundingBundle?.coveredAmountRaw ?? "0");
  const coverageRatio = fundingBundle?.coverageRatio ?? ratio(coveredAmount, targetAmount);
  const covered = coverageRatio >= input.minCoverageRatio;
  const status: BalanceFormingSliceStatus = input.providerInconsistent
    ? "provider_inconsistent"
    : covered
      ? "covered"
      : input.pageBudgetExhausted || input.providerCapHit
        ? "dense_unresolved"
        : "partial";
  const reason = status === "covered"
    ? null
    : status === "provider_inconsistent"
      ? "balance_forming_slice_provider_inconsistent"
      : status === "dense_unresolved"
        ? "balance_forming_slice_budget_exhausted"
        : "balance_forming_slice_partial";

  return {
    status,
    reason,
    targetTxHash: input.target.txHash,
    targetFromAddress: input.target.fromAddress,
    targetToAddress: input.target.toAddress,
    targetAmountRaw: input.target.amountRaw,
    targetTimestamp: input.target.timestamp.toISOString(),
    coveredAmountRaw: coveredAmount.toString(),
    coverageRatio,
    fetchedTransferCount: input.edges.length,
    fetchedPageCount: input.fetchedPageCount,
    pageBudgetExhausted: input.pageBudgetExhausted,
    providerCapHit: input.providerCapHit,
    providerInconsistent: input.providerInconsistent,
    fundingBundle
  };
}
```

- [ ] **Step 4: Run helper tests**

Run:

```powershell
npm test -- tests/forensics/balanceFormingSlice.test.ts
```

Expected: pass.

---

### Task 2: Pass Target Hop Context Through Money-Origin Trace

**Files:**
- Modify: `src/types.ts`
- Modify: `src/forensics/moneyOriginTrace.ts`
- Test: `tests/forensics/moneyOriginTrace.test.ts`

- [ ] **Step 1: Extend trace fetch options**

In `src/forensics/moneyOriginTrace.ts`, extend `fetchEdgesForAddress` options:

```ts
fetchEdgesForAddress(address: string, options?: {
  latestTimestamp?: Date;
  deferBroadTargetedHistory?: boolean;
  targetEdge?: ForensicRouteEdge | null;
  expectedAmountRaw?: string | null;
}): Promise<ForensicRouteEdge[]>;
```

Make the same shape compile where `WhereIsMoneyDeps.fetchEdgesForAddress` is declared in `src/check/whereIsMoneyCheck.ts`.

- [ ] **Step 2: Move target edge lookup before fetching**

In `traceMoneyOriginPath`, compute the target edge before calling `fetchEdgesForAddress`:

```ts
const targetEdge = targetEdgeFromState(state);
const edges = await input.fetchEdgesForAddress(state.currentAddress, {
  latestTimestamp: state.latestTimestamp,
  deferBroadTargetedHistory: Boolean(input.requestCandidateWindows && input.ensureBroadTargetedHistory),
  targetEdge,
  expectedAmountRaw: state.expectedAmountRaw.toString()
});
```

Remove the later duplicate `const targetEdge = targetEdgeFromState(state);`.

- [ ] **Step 3: Add regression test that trace passes hop context**

Add to `tests/forensics/moneyOriginTrace.test.ts`:

```ts
it("passes the concrete hop transfer into edge fetching", async () => {
  const sender = "TSenderHopContext1111111111111111111";
  const subject = "TSubjectHopContext111111111111111111";
  const target = edge("tx-hop-context", sender, subject, "10000000000", "2026-06-30T22:55:33.000Z");
  const seen: unknown[] = [];

  await traceMoneyOriginPath({
    subjectAddress: subject,
    balanceTransfer: {
      fromAddress: sender,
      toAddress: subject,
      amountRaw: "10000000000",
      txHash: "tx-hop-context",
      timestamp: "2026-06-30T22:55:33.000Z"
    },
    maxDepth: 1,
    beamWidth: 4,
    maxAddressFetches: 10,
    maxEdgesPerAddress: 10,
    fetchEdgesForAddress: async (_address, options) => {
      seen.push(options);
      return [target];
    },
    getLabelsForAddress: async () => [],
    getClassificationForAddress: async () => service("none", null)
  });

  expect(seen[0]).toMatchObject({
    expectedAmountRaw: "10000000000",
    targetEdge: expect.objectContaining({
      txHash: "tx-hop-context",
      fromAddress: sender,
      toAddress: subject,
      amountRaw: "10000000000"
    })
  });
});
```

- [ ] **Step 4: Run focused trace tests**

Run:

```powershell
npm test -- tests/forensics/moneyOriginTrace.test.ts
```

Expected: pass.

---

### Task 3: Runtime Balance-Forming Fetch Without Targeted Index Wait

**Files:**
- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `src/types.ts`
- Test: `tests/forensics/deepForensicJob.test.ts`

- [ ] **Step 1: Add balance-slice metadata types**

In `src/types.ts`, add optional metadata to `MoneyOriginTraceHistoryCoverage`:

```ts
  balanceFormingSlice?: {
    status: "covered" | "partial" | "dense_unresolved" | "provider_inconsistent";
    reason: string | null;
    targetTxHash: string;
    targetFromAddress: string;
    targetToAddress: string;
    targetAmountRaw: string;
    targetTimestamp: string;
    coveredAmountRaw: string;
    coverageRatio: number;
    fetchedTransferCount: number;
    fetchedPageCount: number;
    pageBudgetExhausted: boolean;
    providerCapHit: boolean;
    providerInconsistent: boolean;
  } | null;
```

Also add the same optional field to `MoneyOriginFundingSourceProvenance`:

```ts
  balanceFormingSlice?: MoneyOriginTraceHistoryCoverage["balanceFormingSlice"];
```

- [ ] **Step 2: Implement paged runtime fetch**

In `src/forensics/deepForensicJob.ts`, near `fetchEdgesForAddress`, add local constants:

```ts
const WHERE_BALANCE_SLICE_PAGE_SIZE = 50;
const WHERE_BALANCE_SLICE_MAX_PAGES = 20;
const WHERE_BALANCE_SLICE_MIN_COVERAGE_RATIO = 0.95;
```

Add helper inside `runWhereIsMoneyJob` so it can use `deps.tronClient`, `measureJobStage`, `normalizeTransfer`, and caches:

```ts
const fetchBalanceFormingSliceEdges = async (input: {
  address: string;
  targetEdge: ForensicRouteEdge;
  expectedAmountRaw: string;
  minTimestamp: Date;
  maxTimestamp: Date;
}): Promise<{ edges: ForensicRouteEdge[]; coverage: MoneyOriginTraceHistoryCoverage }> => {
  const fetched: ForensicRouteEdge[] = [];
  let providerCapHit = false;
  let providerInconsistent = false;

  for (let page = 0; page < WHERE_BALANCE_SLICE_MAX_PAGES; page += 1) {
    const liveTransfers = await measureJobStage("providerFetchMs", () =>
      deps.tronClient.listRelatedTrc20Transfers(input.address, {
        start: page * WHERE_BALANCE_SLICE_PAGE_SIZE,
        limit: WHERE_BALANCE_SLICE_PAGE_SIZE,
        minTimestamp: input.minTimestamp.getTime(),
        endTimestamp: input.maxTimestamp.getTime()
      }).catch(() => {
        providerInconsistent = true;
        return [];
      })
    );
    const liveEdges = liveTransfers
      .map(normalizeTransfer)
      .filter((edge): edge is ForensicRouteEdge => edge !== null);
    fetched.push(...liveEdges);

    const pageWasFull = liveEdges.length >= WHERE_BALANCE_SLICE_PAGE_SIZE;
    providerCapHit = providerCapHit || pageWasFull;
    const slice = buildBalanceFormingSlice({
      target: input.targetEdge,
      edges: dedupeRouteEdges([input.targetEdge, ...fetched]),
      minCoverageRatio: WHERE_BALANCE_SLICE_MIN_COVERAGE_RATIO,
      maxFunders: DEFAULT_MAX_BUNDLE_FUNDERS,
      fetchedPageCount: page + 1,
      pageBudgetExhausted: page + 1 >= WHERE_BALANCE_SLICE_MAX_PAGES && pageWasFull,
      providerCapHit,
      providerInconsistent
    });
    if (slice.status === "covered" || slice.status === "provider_inconsistent" || !pageWasFull) {
      return {
        edges: dedupeRouteEdges([input.targetEdge, ...fetched]),
        coverage: {
          address: input.address,
          targetTimestamp: input.maxTimestamp.toISOString(),
          fetchedTransferCount: fetched.length,
          fetchedPageCount: page + 1,
          oldestFetchedTransferAt: oldestRouteEdgeTimestamp(fetched)?.toISOString() ?? null,
          reachedTargetHop: slice.status === "covered",
          source: "live",
          coverageComplete: slice.status === "covered",
          providerCapHit,
          budgetExhausted: slice.status === "dense_unresolved",
          providerInconsistent,
          statusReason: slice.status === "covered"
            ? null
            : providerInconsistent
              ? "partial_provider_inconsistent"
              : "partial_budget_exhausted",
          balanceFormingSlice: {
            status: slice.status,
            reason: slice.reason,
            targetTxHash: slice.targetTxHash,
            targetFromAddress: slice.targetFromAddress,
            targetToAddress: slice.targetToAddress,
            targetAmountRaw: slice.targetAmountRaw,
            targetTimestamp: slice.targetTimestamp,
            coveredAmountRaw: slice.coveredAmountRaw,
            coverageRatio: slice.coverageRatio,
            fetchedTransferCount: slice.fetchedTransferCount,
            fetchedPageCount: slice.fetchedPageCount,
            pageBudgetExhausted: slice.pageBudgetExhausted,
            providerCapHit: slice.providerCapHit,
            providerInconsistent: slice.providerInconsistent
          }
        }
      };
    }
  }

  const edges = dedupeRouteEdges([input.targetEdge, ...fetched]);
  const slice = buildBalanceFormingSlice({
    target: input.targetEdge,
    edges,
    minCoverageRatio: WHERE_BALANCE_SLICE_MIN_COVERAGE_RATIO,
    maxFunders: DEFAULT_MAX_BUNDLE_FUNDERS,
    fetchedPageCount: WHERE_BALANCE_SLICE_MAX_PAGES,
    pageBudgetExhausted: true,
    providerCapHit: true,
    providerInconsistent
  });
  return {
    edges,
    coverage: {
      address: input.address,
      targetTimestamp: input.maxTimestamp.toISOString(),
      fetchedTransferCount: fetched.length,
      fetchedPageCount: WHERE_BALANCE_SLICE_MAX_PAGES,
      oldestFetchedTransferAt: oldestRouteEdgeTimestamp(fetched)?.toISOString() ?? null,
      reachedTargetHop: false,
      source: "live",
      coverageComplete: false,
      providerCapHit: true,
      budgetExhausted: true,
      providerInconsistent,
      statusReason: providerInconsistent ? "partial_provider_inconsistent" : "partial_budget_exhausted",
      balanceFormingSlice: {
        status: slice.status,
        reason: slice.reason,
        targetTxHash: slice.targetTxHash,
        targetFromAddress: slice.targetFromAddress,
        targetToAddress: slice.targetToAddress,
        targetAmountRaw: slice.targetAmountRaw,
        targetTimestamp: slice.targetTimestamp,
        coveredAmountRaw: slice.coveredAmountRaw,
        coverageRatio: slice.coverageRatio,
        fetchedTransferCount: slice.fetchedTransferCount,
        fetchedPageCount: slice.fetchedPageCount,
        pageBudgetExhausted: true,
        providerCapHit: true,
        providerInconsistent
      }
    }
  };
};
```

Use existing local helpers where names differ. Keep the implementation inside `runWhereIsMoneyJob` first to avoid broad abstraction.

- [ ] **Step 3: Use balance-slice fetch for ordinary target hops**

In `fetchEdgesForAddress`, before calling `ensureTargetedHistory`, add:

```ts
if (
  fetchOptions.latestTimestamp &&
  fetchOptions.deferBroadTargetedHistory === true &&
  fetchOptions.targetEdge
) {
  const slice = await fetchBalanceFormingSliceEdges({
    address,
    targetEdge: fetchOptions.targetEdge,
    expectedAmountRaw: fetchOptions.expectedAmountRaw ?? fetchOptions.targetEdge.amountRaw,
    minTimestamp,
    maxTimestamp
  });
  const cacheKey = edgeCacheKey(address, maxTimestamp);
  edgeCache.set(cacheKey, slice.edges);
  historyCoverageCache.set(cacheKey, slice.coverage);
  targetedEdgeCacheKeys.add(cacheKey);
  return slice.edges;
}
```

This bypasses `ensureTargetedHistoryOrWait` for ordinary trace hops.

- [ ] **Step 4: Write Deep job test that no broad wait is queued**

In `tests/forensics/deepForensicJob.test.ts`, add a test with a Where job whose hop requires two live pages to cover funding. Assert:

```ts
expect(deps.queueAddressUsdtHistory).not.toHaveBeenCalledWith(expect.objectContaining({
  requestKind: "broad_targeted",
  queuedReason: "where_is_money_hop"
}));
expect(deps.releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
expect(deps.tronClient.listRelatedTrc20Transfers).toHaveBeenCalledWith(
  expect.any(String),
  expect.objectContaining({
    endTimestamp: new Date("2026-06-30T22:55:33.000Z").getTime()
  })
);
```

Use existing job/deps builders in that test file rather than adding new fixtures.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm test -- tests/forensics/deepForensicJob.test.ts tests/forensics/balanceFormingSlice.test.ts
```

Expected: pass.

---

### Task 4: Stop Ordinary Broad Fallback For Material Unresolved Hops

**Files:**
- Modify: `src/forensics/moneyOriginTrace.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Test: `tests/forensics/moneyOriginTrace.test.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Remove trace-level ordinary broad fallback**

In `src/forensics/moneyOriginTrace.ts`, change `requestMaterialBroadWhereFallback` so it returns without calling broad for ordinary unresolved materiality:

```ts
async function requestMaterialBroadWhereFallback(_input: {
  traceInput: TraceMoneyOriginPathInput;
  address: string;
  targetTimestamp: Date;
  balanceShare: number;
  unresolvedAmountRaw: bigint;
}): Promise<void> {
  return;
}
```

Keep the function temporarily to minimize churn. It can be deleted in a later cleanup.

- [ ] **Step 2: Gate post-assessment broad fallback by hard evidence**

In `src/check/whereIsMoneyCheck.ts`, update `postAssessmentBroadFallbackTargets`:

```ts
const outcome = input.assessment.sourceProvenanceMateriality?.outcome;
const reason = outcome === "unresolved_source_with_hard_evidence"
  ? "hard_evidence_requires_full_coverage"
  : null;
```

Do not return broad targets for `material_unresolved_source` or `aggregate_unresolved_above_materiality` in ordinary Where.

- [ ] **Step 3: Add test that material unresolved does not queue broad by default**

Add to `tests/check/whereIsMoneyCheck.test.ts` near existing broad fallback tests:

```ts
it("does not queue broad targeted fallback for ordinary material unresolved source without hard evidence", async () => {
  const unresolvedSender = "TUnresolvedOrdinaryNoBroad111111111";
  const subject = "TSubjectOrdinaryNoBroad111111111111";
  const hop = edge("tx-unresolved-hop", unresolvedSender, subject, "10000000000", "2026-07-04T12:00:00.000Z");
  const broadTargets: unknown[] = [];

  const report = await runWhereIsMoneyCheck({
    getTrc20Balance: async () => "10000000000",
    fetchEdgesForAddress: async () => [hop],
    getHistoryCoverageForAddress: async () => ({
      address: unresolvedSender,
      targetTimestamp: "2026-07-04T12:00:00.000Z",
      fetchedTransferCount: 1,
      fetchedPageCount: 20,
      oldestFetchedTransferAt: "2026-07-04T12:00:00.000Z",
      reachedTargetHop: false,
      source: "live",
      coverageComplete: false,
      providerCapHit: true,
      budgetExhausted: true,
      providerInconsistent: false,
      statusReason: "partial_budget_exhausted",
      balanceFormingSlice: {
        status: "dense_unresolved",
        reason: "balance_forming_slice_budget_exhausted",
        targetTxHash: "tx-unresolved-hop",
        targetFromAddress: unresolvedSender,
        targetToAddress: subject,
        targetAmountRaw: "10000000000",
        targetTimestamp: "2026-07-04T12:00:00.000Z",
        coveredAmountRaw: "0",
        coverageRatio: 0,
        fetchedTransferCount: 1,
        fetchedPageCount: 20,
        pageBudgetExhausted: true,
        providerCapHit: true,
        providerInconsistent: false
      }
    }),
    getLabelsForAddress: async () => [],
    getClassificationForAddress: async () => service("none", null),
    getFastWalletRisk: async () => lowFastRisk,
    ensureBroadTargetedHistories: async (requests) => {
      broadTargets.push(...requests);
      return true;
    }
  }, {
    sourceAddress: subject,
    windowStart: new Date("2026-07-04T00:00:00.000Z"),
    windowEnd: new Date("2026-07-04T12:10:00.000Z"),
    maxDepth: 3,
    beamWidth: 4
  });

  expect(broadTargets).toEqual([]);
  expect(report.sourceProvenanceMateriality?.outcome).toMatch(/material_unresolved_source|aggregate_unresolved_above_materiality/);
});
```

Adapt helper names to existing test fixtures.

- [ ] **Step 4: Keep hard-evidence broad fallback test green**

Run the existing hard-evidence test:

```powershell
npm test -- tests/check/whereIsMoneyCheck.test.ts -t "queues broad fallback when unresolved source provenance intersects approval-drain hard evidence"
```

Expected: pass and still queues broad with reason `hard_evidence_requires_full_coverage`.

- [ ] **Step 5: Run focused Where tests**

Run:

```powershell
npm test -- tests/forensics/moneyOriginTrace.test.ts tests/check/whereIsMoneyCheck.test.ts
```

Expected: pass.

---

### Task 5: Surface Balance-Slice Meaning In Admin And Bot

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `src/admin/adminConsole.ts`
- Modify: `src/bot/createBot.ts`
- Test: `tests/admin/forensicsGraph.test.ts`
- Test: `tests/admin/adminConsole.test.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add graph summary for balance-forming slice**

In `src/admin/forensicsGraph.ts`, when reading source provenance/history coverage, copy `balanceFormingSlice` into `layerSummary.whereIsMoney` or `layerSummary.sourceProvenanceMateriality`:

```ts
balanceFormingSlice: {
  status,
  reason,
  targetTxHash,
  targetFromAddress,
  targetToAddress,
  targetAmountRaw,
  targetTimestamp,
  coveredAmountRaw,
  coverageRatio,
  fetchedTransferCount,
  fetchedPageCount
}
```

Use existing `recordField`, `stringField`, and `numberField` helpers.

- [ ] **Step 2: Render human-readable Admin copy**

In `src/admin/adminConsole.ts`, add a small formatter near existing targeted/source-provenance renderers:

```ts
function balanceFormingSliceLines(slice) {
  if (!slice || typeof slice !== "object") return "";
  const amount = formatUsdtRaw(slice.targetAmountRaw);
  const coverage = typeof slice.coverageRatio === "number"
    ? `${Math.round(slice.coverageRatio * 1000) / 10}%`
    : "n/a";
  return [
    "Balance-forming source",
    `${amount} USDT hop ${shortAddress(slice.targetFromAddress)} -> ${shortAddress(slice.targetToAddress)}`,
    `tx ${shortHash(slice.targetTxHash)}`,
    `covered ${coverage} from prior incoming transfers`,
    `pages ${slice.fetchedPageCount ?? "n/a"}, transfers ${slice.fetchedTransferCount ?? "n/a"}`
  ].join("\\n");
}
```

Use existing address/hash/USDT formatting helpers if names differ.

- [ ] **Step 3: Keep bot wording factual**

In `src/bot/createBot.ts`, when source provenance is unresolved because `balance_forming_slice_budget_exhausted`, avoid saying the check discovered a bad source. Use wording like:

```text
Source for this hop was not fully proven from bounded balance-forming transfers.
This is a coverage caveat, not direct bad-source evidence.
```

- [ ] **Step 4: Add Admin tests**

Add tests asserting the graph/admin text contains:

```text
Balance-forming source
hop
covered
pages
```

and does not call it generic `Indexing history` for completed ordinary Where results.

- [ ] **Step 5: Run focused UI formatting tests**

Run:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/bot/createBot.test.ts
```

Expected: pass.

---

### Task 6: Update Knowledge Docs

**Files:**
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/05-where-is-money-and-incoming.md`
- Modify: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`

- [ ] **Step 1: Update indexing docs**

In `docs/knowledge/04-data-sources-tronscan-indexing.md`, add:

```md
Ordinary Where hop tracing now uses bounded balance-forming slice reads before
any broad targeted index. For a target hop transfer, it reads related transfers
backwards up to the ordinary page cap and stops once prior incoming transfers
can fund the hop after intermediate spends. This is not a fixed time window:
low-density wallets can reach days or months back; dense wallets stop by page
budget instead of silently entering the 12,000-page broad index path.
```

- [ ] **Step 2: Update Where docs**

In `docs/knowledge/05-where-is-money-and-incoming.md`, add:

```md
Where hop source tracing is balance-forming: for each target hop, the system
asks which prior incoming transfers could have funded that exact outgoing hop.
It accounts for outgoing spends before the hop. If the bounded slice cannot
cover the hop, the unresolved amount is assessed by materiality rather than
automatically triggering broad targeted indexing.
```

- [ ] **Step 3: Update Admin UX docs**

In `docs/knowledge/08-admin-and-bot-ux.md`, add:

```md
Admin should describe hop-source tracing as a concrete balance-forming check:
amount, source hop, destination hop, tx hash, pages read, transfers read, and
coverage ratio. It should not imply the subject wallet itself is being indexed
when the system is checking an upstream hop sender.
```

- [ ] **Step 4: Update current decisions**

In `docs/knowledge/09-current-decisions.md`, add:

```md
Ordinary Where no longer queues broad `where_is_money_hop` targeted indexing
for material unresolved dense hops without hard evidence. It first performs a
bounded balance-forming slice search and then reports exact, partial, dense
unresolved, or provider-inconsistent source provenance. Broad targeted indexing
is reserved for hard-evidence branches and explicit strict/manual modes.
```

- [ ] **Step 5: Update open problems**

In `docs/knowledge/10-open-problems.md`, move the broad ordinary Where page-ceiling issue from current blocker to calibration/open work:

```md
Balance-forming slice page caps are first-pass constants. They need live
calibration on dense exchange-adjacent wallets, but ordinary Where should no
longer silently run broad 12,000-page targeted indexing for unresolved dense
hops without hard evidence.
```

---

### Task 7: Final Verification

**Files:**
- No additional files.

- [ ] **Step 1: Run focused provenance tests**

Run:

```powershell
npm test -- tests/forensics/balanceFormingSlice.test.ts tests/forensics/moneyOriginTrace.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/deepForensicJob.test.ts
```

Expected: pass.

- [ ] **Step 2: Run Admin/bot formatting tests**

Run:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/bot/createBot.test.ts
```

Expected: pass.

- [ ] **Step 3: Run shared risk regression tests**

Run:

```powershell
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts tests/risk/unifiedWalletRisk.test.ts
```

Expected: pass.

- [ ] **Step 4: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: pass.

- [ ] **Step 5: Run diff check**

Run:

```powershell
git diff --check
```

Expected: no whitespace errors.

---

## Acceptance Criteria

- Ordinary `where_is_money_check` does not queue `broad_targeted` `where_is_money_hop` waits for dense/material unresolved hops without hard evidence.
- For each hop, Where searches for prior incoming transfers that could fund the target outgoing transfer and accounts for spends before the hop.
- The search is not a fixed 10-20 minute window. It can reach days or months back if page density allows.
- The search stops by coverage, service boundary, provider inconsistency, or ordinary page budget.
- Hard-evidence branches can still request broad targeted coverage.
- Strict/manual/debug modes can still opt into broad targeted coverage explicitly.
- Admin explains which upstream hop is being checked, with tx hash, amount, pages read, transfers read, and coverage ratio.
- Bot/Admin do not present unresolved balance-forming coverage as bad-source proof.
- Knowledge docs reflect the implemented behavior after code changes.

## Non-Goals

- No migration.
- No new external dependency.
- No DeepCheck campaign/scoring changes.
- No attempt to make every dense wallet fully provable in ordinary mode.
- No automatic rewrite of historical jobs.
