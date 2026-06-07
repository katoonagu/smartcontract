# Balance-Aware Incoming Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make incoming-deposit provenance balance-aware before source-policy scoring, so stale historical inflows cannot dominate the final risk decision when the funds were already spent before the checked transaction.

**Architecture:** Use the existing cashflow bundle engine as the primary continuation path in `traceMoneyOriginPath`. For every hop, first build a funding bundle from still-available inbound transfers. Continue through the top bundle funders with propagated attributable shares. Use single-candidate tracing only as a fallback when bundle coverage is not enough. Score HTX and other source-policy exposures from attributable share, not from stale raw historical amount.

**Tech Stack:** TypeScript, existing forensics modules, Vitest, admin graph projection.

---

## Source Spec

The approved design is in:

`docs/superpowers/specs/2026-06-06-balance-aware-incoming-provenance-design.md`

Core decision from the spec:

Incoming-deposit checks must answer "which prior funds were still available for this outgoing transfer?" before assigning HTX/source-policy risk. A 22-day-old HTX transfer may remain context, but it must not create an 85 critical score when later outgoing transfers already spent that money.

## File Structure

Files to modify:

```text
src/types.ts
src/forensics/moneyOriginTrace.ts
src/forensics/provenanceScoring.ts
src/forensics/incomingDepositJob.ts
src/admin/forensicsGraph.ts
src/admin/adminConsole.ts
tests/forensics/moneyOriginTrace.test.ts
tests/forensics/provenanceScoring.test.ts
tests/forensics/incomingDepositJob.test.ts
tests/admin/forensicsGraph.test.ts
```

Reference files:

```text
src/forensics/incomingDepositCashflow.ts
docs/superpowers/specs/2026-06-06-balance-aware-incoming-provenance-design.md
```

## Implementation Tasks

### Task 1: Add RED regression for stale HTX single-candidate trace

- [ ] Open `tests/forensics/moneyOriginTrace.test.ts`.

- [ ] Add a test named:

```ts
it("uses balance-aware funding before stale single-candidate source policy matches", async () => {
  // test body
});
```

- [ ] Build the fixture around this concrete flow:

```text
2026-05-14T12:33:42Z  HTX -> TKqq 249,590 USDT
2026-05-14T12:51:06Z  TKqq -> TM3z 303,919 USDT
2026-06-04T10:16:33Z  TKuvwo -> TKqq 32,006 USDT
2026-06-04T10:28:03Z  TE2Abe -> TKqq 3,500 USDT
2026-06-04T10:58:27Z  TFJQZ -> TKqq 134,295.624553 USDT
2026-06-04T11:41:30Z  TKqq -> TNsp 204,047 USDT
```

- [ ] Use the existing local helpers in the test file: `edge`, `balanceTransfer`, and service label helpers.

- [ ] Classify the stale May 14 source as HTX/Huobi and classify the fresh `TFJQZ` source as allowlisted CEX, using the existing classification callback shape in the file.

- [ ] Assert the trace does not select stale HTX as the terminal source:

```ts
expect(result.rootSourceAddress).not.toBe(htxAddress);
expect(result.stoppedReason).toBe("allowlist_cex_reached");
expect(result.fundingBundles?.[0]?.members.some((member) => member.txId === oldHtxTxId)).toBe(false);
expect(result.fundingBundles?.[0]?.coverageRatio).toBeGreaterThanOrEqual(0.85);
```

- [ ] Run the focused test:

```powershell
npm test -- --run tests/forensics/moneyOriginTrace.test.ts
```

Expected result before implementation:

```text
FAIL: current code selects the stale HTX transfer because candidateIncomingEdges runs before buildFundingBundleForTraceHop.
```

### Task 2: Make money-origin tracing bundle-first

- [ ] Open `src/forensics/moneyOriginTrace.ts`.

- [ ] Extend the internal trace state with attributable share fields:

```ts
type TraceState = {
  address: string;
  expectedAmountRaw: bigint;
  tokenAddress?: string | null;
  beforeTimestamp: string;
  depth: number;
  pathEdges: MoneyOriginPathEdge[];
  balanceShare: number;
  attributionBasis: "initial_transfer" | "funding_bundle" | "single_candidate";
};
```

- [ ] Initialize the first state with a full share for the checked outgoing transfer:

```ts
balanceShare: 1,
attributionBasis: "initial_transfer",
```

- [ ] Move `buildFundingBundleForTraceHop` before `candidateIncomingEdges` for non-terminal current addresses.

- [ ] Build the bundle with the existing cashflow engine:

```ts
const bundle = buildFundingBundleForTraceHop({
  currentAddress: state.address,
  expectedAmountRaw: state.expectedAmountRaw,
  tokenAddress: state.tokenAddress,
  beforeTimestamp: state.beforeTimestamp,
  transfers,
  minCoverageRatio: input.bundleCoverageThreshold ?? 0.85,
  maxFundingMembers: input.maxFundingMembers ?? 10,
});
```

- [ ] When `bundle.coverageRatio >= 0.85`, continue through bundle funders instead of using single-candidate matching.

- [ ] Propagate branch share to each child state:

```ts
const childBalanceShare = clampShare(state.balanceShare * member.coverageShare);
```

- [ ] Preserve the bundle on the emitted path:

```ts
fundingBundles: [...stateFundingBundles, bundle],
balanceShare: state.balanceShare,
```

- [ ] Keep `candidateIncomingEdges` as fallback only when:

```ts
bundle.coverageRatio < bundleCoverageThreshold
```

- [ ] Keep existing graph guards:

```text
maxDepth
maxEdgesPerAddress
maxIntermediateAddresses
maxRuntimeMs
```

- [ ] Re-run:

```powershell
npm test -- --run tests/forensics/moneyOriginTrace.test.ts
```

Expected result after implementation:

```text
PASS: stale HTX is ignored for the disputed hop because it is spent before the checked transfer.
```

### Task 3: Add attributed source-policy scoring tests

- [ ] Open `tests/forensics/provenanceScoring.test.ts`.

- [ ] Add a test named:

```ts
it("does not apply HTX critical floor from stale raw share when attributed share is low", () => {
  // test body
});
```

- [ ] Use existing `path(...)` helper to create two origin paths:

```ts
const staleHtxPath = path({
  rootSourceKind: "htx_huobi",
  sourcePolicyScope: "source_policy",
  balanceShare: 0.03,
  amountPreservationRatio: 1,
  linkStrength: 1,
});

const freshUnknownPath = path({
  rootSourceKind: "unknown",
  balanceShare: 0.82,
  amountPreservationRatio: 1,
  linkStrength: 1,
});
```

- [ ] Assert that HTX does not force 85 when its attributable share is only 3%:

```ts
const result = scoreSourceExposures([staleHtxPath, freshUnknownPath]);

expect(result.shareDetails.find((detail) => detail.kind === "htx_huobi")?.rawShare).toBeCloseTo(0.03, 4);
expect(result.score).toBeLessThan(85);
```

- [ ] Add a second test named:

```ts
it("keeps HTX critical floor when attributed HTX share is dominant", () => {
  // test body
});
```

- [ ] Assert HTX remains critical when attributable share is dominant:

```ts
const result = scoreSourceExposures([
  path({
    rootSourceKind: "htx_huobi",
    sourcePolicyScope: "source_policy",
    balanceShare: 0.85,
    amountPreservationRatio: 1,
    linkStrength: 1,
  }),
]);

expect(result.score).toBeGreaterThanOrEqual(85);
expect(result.decision).toBe("DECLINE");
```

- [ ] Run:

```powershell
npm test -- --run tests/forensics/provenanceScoring.test.ts
```

Expected result:

```text
The low-attributed-share HTX test fails before scoring is wired to attributable share.
The dominant-attributed-share HTX test must pass after implementation.
```

### Task 4: Score source exposures from attributable share

- [ ] Open `src/forensics/provenanceScoring.ts`.

- [ ] Add a helper that uses the propagated balance-aware share as the source-policy share:

```ts
function attributedPathShare(path: MoneyOriginPath): number {
  return clampShare(
    finiteShare(path.balanceShare)
      * finitePositive(path.amountPreservationRatio, 1)
      * finitePositive(path.linkStrength, 1),
  );
}
```

- [ ] Replace source-policy aggregation that uses stale raw amount share with `attributedPathShare(path)`.

- [ ] Keep the HTX critical rule, but base it on attributed aggregate share:

```ts
const htxDominant = kind === "htx_huobi" && aggregateShare >= 0.8;
```

- [ ] Keep existing source-policy floors for dominant hard evidence.

- [ ] Keep `shareDetails` honest by reporting both fields:

```ts
rawShare: aggregateRawShare,
effectiveShare: aggregateAttributedShare,
```

- [ ] Re-run:

```powershell
npm test -- --run tests/forensics/provenanceScoring.test.ts
```

Expected result:

```text
PASS: HTX remains critical only when the attributed share is dominant.
```

### Task 5: Preserve bundle attribution in incoming-deposit reports

- [ ] Open `src/forensics/incomingDepositJob.ts`.

- [ ] Find `incomingPathFromWhere`.

- [ ] Ensure it copies these fields from `MoneyOriginPath` into `IncomingDepositOriginPath`:

```ts
balanceShare
linkStrength
amountPreservationRatio
timeSpanMs
fundingBundles
sourcePolicyShareDetail
```

- [ ] Ensure `incomingReportFromWhere` keeps the same `originPaths` order as `whereReport.originPaths`.

- [ ] Open `src/types.ts`.

- [ ] Add explicit optional fields to the incoming origin-path type if the type currently omits them:

```ts
balanceShare?: number | null;
fundingBundles?: MoneyOriginFundingBundle[];
sourcePolicyShareDetail?: SourcePolicyShareDetail | null;
```

- [ ] Run:

```powershell
npm test -- --run tests/forensics/incomingDepositJob.test.ts
npm run typecheck
```

Expected result:

```text
PASS: incoming reports can carry balance-aware provenance to scoring and admin graph code.
```

### Task 6: Update admin graph timing and funding-bundle display

- [ ] Open `src/admin/forensicsGraph.ts`.

- [ ] Ensure incoming-deposit graph nodes render bundle member facts:

```text
used amount
original amount
spent before hop
coverage share
tx gap
```

- [ ] Ensure stale candidates are not rendered as the main provenance route when a funding bundle exists.

- [ ] Open `src/admin/adminConsole.ts`.

- [ ] Keep the current timing wording:

```text
gap 20d 23h
```

- [ ] Add a path summary line for balance-aware routes:

```text
attributed 65.8% of checked transfer
```

- [ ] Add or update `tests/admin/forensicsGraph.test.ts` to assert the graph includes bundle labels:

```ts
expect(graphText).toContain("spent before hop");
expect(graphText).toContain("coverage");
expect(graphText).toContain("attributed");
```

- [ ] Run:

```powershell
npm test -- --run tests/admin/forensicsGraph.test.ts
```

Expected result:

```text
PASS: admin graph explains why a fresh funding bundle was used instead of a stale historical HTX transfer.
```

### Task 7: Add end-to-end incoming-deposit regression for the TKqq case shape

- [ ] Open `tests/forensics/incomingDepositJob.test.ts`.

- [ ] Add a regression that runs the incoming-deposit job over the synthetic TKqq case.

- [ ] Assert the final report:

```ts
expect(report.finalDecision).not.toBe("DECLINE");
expect(report.finalScore).toBeLessThan(85);
expect(report.originPaths.some((path) => path.rootSourceKind === "htx_huobi" && (path.balanceShare ?? 0) >= 0.8)).toBe(false);
expect(report.originPaths.some((path) => path.fundingBundles?.length)).toBe(true);
```

- [ ] Add a second end-to-end case where fresh HTX funding is dominant:

```text
HTX -> wallet 180,000 USDT
wallet -> checked receiver 200,000 USDT
other fresh funders cover the remaining 20,000 USDT
```

- [ ] Assert the final report remains critical:

```ts
expect(report.finalDecision).toBe("DECLINE");
expect(report.finalScore).toBeGreaterThanOrEqual(85);
```

- [ ] Run:

```powershell
npm test -- --run tests/forensics/incomingDepositJob.test.ts
```

Expected result:

```text
PASS: stale HTX does not create critical score; fresh dominant HTX still creates critical score.
```

### Task 8: Full verification

- [ ] Run focused verification:

```powershell
npm test -- --run tests/forensics/moneyOriginTrace.test.ts
npm test -- --run tests/forensics/provenanceScoring.test.ts
npm test -- --run tests/forensics/incomingDepositJob.test.ts
npm test -- --run tests/admin/forensicsGraph.test.ts
```

- [ ] Run full project verification:

```powershell
npm run typecheck
npm test
```

- [ ] If tests that depend on live Tronscan data exist, do not use them as required pass gates for this change. This fix must be verified with deterministic fixtures.

Expected result:

```text
typecheck passes
all deterministic tests pass
no production rerun depends on Tronscan availability
```

### Task 9: Manual product validation on the saved job

- [ ] Start the local app if it is not already running:

```powershell
npm run dev
```

- [ ] Open the admin job:

```text
http://127.0.0.1:8787/admin/forensics?kind=incoming_deposit_check&query=b4603c390&jobId=0fb0a855-63bb-45fa-80ff-ceb53f8a18fd
```

- [ ] Confirm the graph shows:

```text
TKqq -> TNsp 204,047 USDT
fresh funding bundle before that outgoing transfer
May 14 HTX transfer not shown as the main source of the 204,047 USDT
time gaps between connected transfers
attributed shares for branch funders
```

- [ ] Confirm the product explanation matches the new model:

```text
HTX remains critical only when the checked outgoing transfer is balance-attributable to HTX.
Old HTX history remains context when the funds were already spent.
```

### Task 10: Commit in reviewable slices

- [ ] Commit tests first when the RED failure is confirmed:

```powershell
git add tests/forensics/moneyOriginTrace.test.ts tests/forensics/provenanceScoring.test.ts tests/forensics/incomingDepositJob.test.ts tests/admin/forensicsGraph.test.ts
git commit -m "Add balance-aware provenance regressions"
```

- [ ] Commit implementation after focused tests pass:

```powershell
git add src/types.ts src/forensics/moneyOriginTrace.ts src/forensics/provenanceScoring.ts src/forensics/incomingDepositJob.ts src/admin/forensicsGraph.ts src/admin/adminConsole.ts
git commit -m "Use balance-aware provenance for incoming source scoring"
```

- [ ] Commit docs/spec updates only if implementation changes require them:

```powershell
git add docs/project-walkthrough docs/superpowers/specs
git commit -m "Document balance-aware incoming provenance scoring"
```

## Review Checklist

- [ ] Stale historical inflows cannot become dominant source evidence if they were spent before the checked transfer.
- [ ] HTX critical scoring still works when HTX is the dominant balance-attributable source.
- [ ] Source-policy share details show the difference between raw historical context and effective attributed share.
- [ ] Incoming deposits and wallet checks use the same unified scoring concepts.
- [ ] Admin graph explains timing and amount usage without forcing manual interpretation.
- [ ] No live API request is required for deterministic test coverage.
- [ ] `npm run typecheck` passes.
- [ ] Focused tests and full deterministic tests pass.

## Self-Review

This plan covers the approved spec: balance-aware tracing, bundle-first continuation, attributed source-policy scoring, HTX critical preservation, admin graph explainability, deterministic regression coverage, and reviewable commits. The plan avoids unbounded graph expansion by keeping existing depth, edge, member, runtime, and intermediate-address limits. The plan does not introduce a second incoming-deposit scoring system; it routes incoming-deposit provenance through the same source-policy scoring model used by unified wallet risk.
