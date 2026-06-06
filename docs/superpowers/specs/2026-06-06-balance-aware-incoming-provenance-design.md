# Balance-Aware Incoming Provenance Design

Date: 2026-06-06.

## Summary

Incoming deposit provenance must stop treating a historical inbound transfer as the source of a later outbound transfer only because the old inbound amount is large enough.

The approved direction is:

```text
trace each outgoing hop through balance-aware funding bundles first
then score HTX/Huobi as CRITICAL only when the balance-aware attributable share is high
```

HTX/Huobi can still produce a critical result. The change is that HTX/Huobi must cover the checked amount through usable, balance-aware attribution, not through a stale single inbound candidate that was likely spent earlier.

## Trigger Case

Checked incoming deposit job:

```text
job: 0fb0a855-63bb-45fa-80ff-ceb53f8a18fd
deposit tx: b4603c390d3b0f08f9a604b26dc31d08e64aeeacc5a1560410bb5bbf030aa39c
sender: TPiyHJDDiUWUuyaxGdz1uTDyh8mDke67z3
watched wallet: TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM
amount: 100,000 USDT
```

The current saved report built this path:

```text
TFTWNg... -> TE2Abe... 401,000 USDT 2026-05-14 11:34:48Z
TE2Abe... -> TKqq...   249,590 USDT 2026-05-14 12:33:42Z
TKqq...   -> TNsp...   204,047 USDT 2026-06-04 11:41:30Z
TNsp...   -> TMcc...   201,308 USDT 2026-06-04 12:35:06Z
TMcc...   -> TPiy...   100,000 USDT 2026-06-04 12:44:36Z
TPiy...   -> TEYP...   100,000 USDT 2026-06-04 12:58:54Z
```

The problematic link is:

```text
TE2Abe... -> TKqq... 249,590 USDT
then 20d 23h later
TKqq... -> TNsp... 204,047 USDT
```

TronScan shows that `TKqq...` had many USDT transfers in between. A live bounded query returned 50 USDT transfer events in that interval. The old 249,590 USDT inbound was followed almost immediately by a 303,919 USDT outbound:

```text
2026-05-14 12:51:06Z
TKqq... -> TM3z...
303,919 USDT
```

So the old 249,590 USDT transfer must not be treated as the direct source of the 204,047 USDT outbound on 2026-06-04.

## Current Facts From Code

`traceMoneyOriginPath` currently looks for candidate inbound edges in `candidateIncomingEdges`.

Source:

```text
src/forensics/moneyOriginTrace.ts:98
src/forensics/moneyOriginTrace.ts:111
src/forensics/moneyOriginTrace.ts:112
```

The candidate filter checks:

- inbound to current address;
- timestamp before the current hop;
- positive amount;
- amount coverage above `minAmountPreservationRatio`;
- time delta below `maxTimeDeltaMs`.

The default `maxTimeDeltaMs` is currently 365 days.

Source:

```text
src/forensics/moneyOriginTrace.ts:55
src/forensics/moneyOriginTrace.ts:313
```

Incoming deposit mode calls Where Is Money with:

```text
minAmountPreservationRatio: 0.05
```

Source:

```text
src/forensics/incomingDepositJob.ts:1097
```

Balance-aware bundle logic already exists in `buildFundingBundleForTraceHop`.

Source:

```text
src/forensics/incomingDepositCashflow.ts:115
src/forensics/incomingDepositCashflow.ts:140
src/forensics/incomingDepositCashflow.ts:146
src/forensics/incomingDepositCashflow.ts:148
```

It calculates:

- later outgoing spend overhang;
- consumed inbound amount;
- usable inbound amount;
- coverage ratio;
- top funders.

But `traceMoneyOriginPath` only reaches this bundle branch when no single candidate inbound edge exists.

Source:

```text
src/forensics/moneyOriginTrace.ts:407
src/forensics/moneyOriginTrace.ts:444
```

In the trigger case, a stale single candidate existed, so bundle tracing did not run.

## Balance-Aware Recalculation For The Trigger Case

For the disputed hop:

```text
target outbound:
TKqq... -> TNsp...
204,047 USDT
2026-06-04 11:41:30Z
```

Balance-aware bundle attribution covered the outbound with these usable inbound amounts:

```text
65.81% / 134,295.624553 USDT
TFJQZ3... -> TKqq...
2026-06-04 10:58:27Z

15.68% / 32,006 USDT
TKuvwo... -> TKqq...
2026-06-04 10:16:33Z

1.71% / 3,500 USDT
TE2Abe... -> TKqq...
2026-06-04 10:28:03Z

3.35% / 6,842.334110 USDT usable from a 43,000 USDT inbound
TE2Abe... -> TKqq...
2026-06-01 13:17:54Z

remaining coverage came from smaller, more recent inbound transfers.
```

The 249,590 USDT inbound from 2026-05-14 was not part of the balance-aware source set for the 204,047 USDT outbound.

This means the saved `HTX/Huobi 100% raw share` conclusion is wrong for this job. HTX/Huobi can remain critical in the product, but this job must not get `85 CRITICAL` from stale attribution.

## Product Goal

For incoming deposits, the system must answer:

```text
Where did the checked deposit amount actually come from, as far as on-chain balance flow can support?
```

It must not answer:

```text
Can we find any older inbound transfer that is large enough to be a possible source?
```

The user-facing outcome should be:

- one score;
- one decision;
- one clear explanation;
- source-policy severity based on attributable amount;
- HTX/Huobi critical when the checked amount is actually attributable to HTX/Huobi.

## Approved Design

### 1. Bundle-First Hop Attribution

For each backward hop, `traceMoneyOriginPath` should build a funding bundle before accepting a single inbound candidate.

The new default order:

```text
current outgoing hop
-> collect prior edges for current address
-> build balance-aware funding bundle
-> trace through bundle funders
-> only use single-edge fallback when bundle cannot meet minimum coverage
```

This changes the meaning of a path from:

```text
large enough historical inbound
```

to:

```text
usable inbound coverage after later outgoing spend is accounted for
```

### 2. Multi-Branch Trace Instead Of One Stale Branch

If a hop is funded by multiple inbound transfers, the trace should create multiple funding branches.

Branch selection must be bounded:

```text
trace top funders by used amount
stop after enough coverage is explained
ignore dust below a small share unless needed for complete coverage
respect existing maxDepth, beamWidth, maxAddressFetches, maxEdgesPerAddress
```

Initial thresholds:

```text
target bundle coverage: 95% for normal trace continuation
acceptable minimum: 85% for partial but useful continuation
top funders per bundle: existing DEFAULT_MAX_BUNDLE_FUNDERS unless caller overrides
ignore branch for deep continuation if used share < 1%, unless it is needed to reach 95% coverage
```

The report should keep low-share members in evidence, but deep traversal can skip them for resource control.

### 3. Preserve Existing Single-Edge Behavior When It Is Truly Strong

Single-edge matches are still valid when the inbound is also the dominant usable funding member.

Example:

```text
one inbound 100,000 USDT
no outgoing in between
outbound 99,500 USDT after 12 minutes
```

This should still produce a simple one-edge path.

The difference is that the single edge is accepted because the bundle calculation confirms it remains usable, not because the raw historical amount is large.

### 4. HTX/Huobi Critical Rule

HTX/Huobi remains a strict policy source.

But the `CRITICAL` floor applies only to balance-aware attributable share:

```text
if htx_huobi attributableShare >= 0.80
and bundle coverage is sufficiently complete
and the path is not stale-only attribution
then score floor may be 85
```

If HTX/Huobi is found only through an old transfer that is not part of the usable funding bundle:

```text
do not apply 85 floor
keep as historical context or weak source-policy context
```

If HTX/Huobi is one branch among several:

```text
score by HTX/Huobi attributable share
```

Examples:

```text
HTX attributable share 90%, fresh/balance-aware -> 85 CRITICAL
HTX attributable share 55%, fresh/balance-aware -> high source-policy risk, not automatic 85 unless policy requires floor
HTX attributable share 10%, fresh/balance-aware -> context/medium source-policy contribution
HTX stale historical candidate, 0% usable -> no HTX policy floor
```

### 5. Source-Policy Scoring Must Use Attributable Share

`scoreSourceExposures` should prefer a path's balance-aware attributable share over raw historical share.

The scoring input for a source-policy path should include:

```ts
type BalanceAwareAttribution = {
  targetAmountRaw: string;
  coveredAmountRaw: string;
  attributableShare: number;
  coverageRatio: number;
  maxHopGapMs: number | null;
  staleCandidateIgnored: boolean;
};
```

The effective source-policy share should be:

```text
attributableShare * linkStrength
```

unless the source kind is non-dampenable hard evidence such as sanctions, mixer, or exact hard labels.

### 6. Evidence And Admin Reporting

The admin graph should expose why a branch was chosen.

For each hop, show:

```text
target outgoing amount
bundle covered amount
bundle coverage ratio
funding members
used amount
original amount
spent before hop
time gap
branch continuation status
```

For stale ignored candidates, show a diagnostic:

```text
large historical inbound ignored because later outgoing spend consumed it
```

This prevents the UI from implying that a 21-day-old transfer funded a later outgoing when the wallet had many intervening transfers.

## Data Model Changes

Extend `MoneyOriginPath` or related path metadata with balance-aware fields.

Target shape:

```ts
type MoneyOriginPathAttribution = {
  mode: "single_usable_edge" | "funding_bundle" | "partial_bundle" | "single_edge_fallback";
  targetTxHash: string;
  targetAmountRaw: string;
  coveredAmountRaw: string;
  coverageRatio: number;
  attributionShare: number;
  maxHopGapMs: number | null;
  staleCandidateCount: number;
};
```

Extend funding bundle members if needed:

```ts
type TraceFundingBundleMember = {
  edge: ForensicRouteEdge;
  usedAmountRaw: string;
  spentBeforeHopRaw: string;
  coverageRatio: number;
};
```

`TraceFundingBundleMember` already has the required core fields. The implementation should reuse it instead of inventing a second structure.

## Algorithm

For each `TraceState`:

1. Fetch edges for `state.currentAddress` up to `state.latestTimestamp`.
2. Build a funding bundle for the target edge represented by the current state.
3. If bundle coverage is high enough:
   - attach bundle to path state;
   - create next states for top funding members;
   - set each next state's `expectedAmountRaw` to `member.usedAmountRaw`;
   - set each next state's `latestTimestamp` to `member.edge.timestamp`;
   - set branch `balanceShare` according to the member's share of the original checked amount.
4. If bundle coverage is insufficient:
   - record precise stop reason;
   - optionally use single-edge fallback only if it passes stricter freshness and no-spend checks.
5. Terminal source-policy classification uses the branch's attributable share, not the stale candidate's raw amount.

## Scoring Rules

### Strong HTX/Huobi

```text
attributableShare >= 0.80
coverageRatio >= 0.85
source kind = htx_huobi
```

Result:

```text
score floor 85
risk level CRITICAL
decision DECLINE
```

### Medium HTX/Huobi

```text
0.50 <= attributableShare < 0.80
coverageRatio >= 0.85
source kind = htx_huobi
```

Result:

```text
score should remain high
but no unconditional 85 floor
```

The score must come from the existing source-policy formula with `attributableShare` as the source share input. The HTX/Huobi 85 floor must not apply in this band.

### Weak Or Stale HTX/Huobi

```text
attributableShare < 0.50
or path is stale-only attribution
or bundle coverage is incomplete
```

Result:

```text
do not apply HTX/Huobi 85 floor
emit source-policy context
score by attributable/effective share
```

## Expected Result For The Trigger Case

The old result:

```text
HTX/Huobi raw share: 100%
score: 85 CRITICAL
decision: DECLINE
```

The corrected result should not assign 100% HTX/Huobi share through `TKqq...`.

The first corrected branch for `TKqq... -> TNsp...` should start from:

```text
TFJQZ3... -> TKqq...
134,295.624553 USDT used
65.81% of the 204,047 USDT hop
gap about 43 minutes
```

Other meaningful branches:

```text
TKuvwo... -> TKqq...
32,006 USDT used
15.68%
gap about 1h 25m

TE2Abe... -> TKqq...
smaller usable branches from 2026-06-04, 2026-06-01, and 2026-05-28
```

The final score depends on where those fresh branches resolve. If they resolve to HTX/Huobi with high attributable share, the final result can still be critical. If they resolve to clean or unknown sources, the old `85 CRITICAL` must drop.

## Tests

Add test coverage before implementation.

### Unit Tests

`tests/forensics/incomingDepositCashflow.test.ts`

Add a test for a wallet with:

```text
old inbound 249,590
old outbound 303,919 after it
fresh inbound 134,295
fresh inbound 32,006
target outbound 204,047
```

Expected:

```text
old inbound is not selected as usable funding
fresh inbound bundle covers the target
spentBeforeHopRaw is recorded for consumed inputs
```

### Trace Tests

`tests/forensics/moneyOriginTrace.test.ts` or the existing closest money-origin trace test file.

Add a test that proves:

```text
traceMoneyOriginPath uses funding bundle before stale single candidate
branch expectedAmountRaw equals usedAmountRaw
source-policy balanceShare is allocated by branch share
```

### Scoring Tests

`tests/forensics/provenanceScoring.test.ts`

Add cases:

```text
HTX attributable share >= 80% keeps 85 CRITICAL floor
HTX stale-only raw share 100% with attributable share 0 does not get 85 floor
HTX partial attributable share scores by share/effective share
```

### Integration Tests

Add or update an incoming deposit job test that reproduces the `TKqq...` shape without live network calls.

Expected:

```text
result.sourcePolicyEvidence does not report HTX/Huobi 100% from the stale path
originPaths include bundle evidence for the disputed hop
admin graph can render used/original/spent-before-hop fields
```

## Non-Goals

- Do not remove HTX/Huobi critical policy.
- Do not build an unbounded full-wallet graph.
- Do not require manual review to decide the final score.
- Do not use total historical wallet volume as the denominator for a concrete incoming deposit.
- Do not lower exact hard evidence such as blacklist, sanctions, mixer, or exact scam label because of source-share dampening.

## Rollout

1. Add tests that reproduce stale historical attribution.
2. Change `traceMoneyOriginPath` to use bundle-first attribution.
3. Thread branch attributable shares into source-policy scoring.
4. Adjust HTX/Huobi floor to use attributable share.
5. Update admin graph/reporting to show bundle attribution fields.
6. Re-run saved jobs for at least:
   - the trigger job `0fb0a855-63bb-45fa-80ff-ceb53f8a18fd`;
   - several previous incoming deposit jobs;
   - a known strong HTX/Huobi case that should remain critical.

## Implementation Boundary

The implementation should avoid duplicating trace engines. The preferred path is to reuse `buildFundingBundleForTraceHop` inside `traceMoneyOriginPath` and keep `candidateIncomingEdges` as a stricter fallback, not as the primary branch selector.

This is an implementation requirement, not an optional follow-up:

```text
traceMoneyOriginPath owns branch selection
buildFundingBundleForTraceHop owns balance-aware usable amount calculation
scoreSourceExposures owns source-policy scoring from attributable share
admin graph only renders the attribution emitted by the report
```
