# Funding-First Source Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `where_is_money_check` explain the source of concrete hop transfers before falling back to full sender-history coverage, while keeping probable capped-window evidence out of final hard scoring.
**Architecture:** Extend the existing Where trace pipeline: keep `buildFundingBundleForTraceHop` as the balance math, add a small source-provenance classifier, attach proof-class metadata to `MoneyOriginPath`, and render that metadata in Admin. Do not create a second tracing engine.
**Tech Stack:** TypeScript, Vitest, existing TronScan targeted index cache, existing Admin graph/read-model code.

---

## Constraints

- [ ] Do not change `Incoming deposit` behavior in this stage.
- [ ] Do not change Telegram UX in this stage.
- [ ] Do not raise global TronScan page ceilings to force this feature through.
- [ ] Do not treat `probable` evidence as hard evidence.
- [ ] Do not weaken blacklist, sanctions, mixer, scam, HTX/Huobi, or other hard-evidence policy.
- [ ] Do not remove the Stage 1 targeted indexing lifecycle. Funding-first is a source-provenance layer above it.

## Files

- [ ] `src/types.ts`
  - Add source-provenance proof-class types.
  - Extend `MoneyOriginPath` with `sourceProvenance`.
  - Extend history coverage metadata with capped/provider flags.
- [ ] `src/forensics/fundingFirstSourceProvenance.ts`
  - New pure helper.
  - Uses `buildFundingBundleForTraceHop`.
  - Classifies `exact`, `service_boundary`, `probable`, `pre_existing_balance_possible`, and `unresolved`.
- [ ] `src/forensics/moneyOriginTrace.ts`
  - Evaluate funding-first source provenance for each concrete hop.
  - Continue tracing only through exact funding proof.
  - Preserve probable/service-boundary explanations on incomplete paths.
- [ ] `src/forensics/deepForensicJob.ts`
  - Add optional coverage flags to `getHistoryCoverageForAddress` output where that code already knows truncation/fetch state.
- [ ] `src/forensics/moneyOriginOperationalAssessment.ts`
  - Ensure probable source provenance does not create user-facing hard evidence or final source-policy decline by itself.
- [ ] `src/admin/forensicsGraph.ts`
  - Render proof class, coverage window status, and amount-continuity status.
  - Keep probable edges visually distinct from proven edges through metadata and limitation records.
- [ ] Tests:
  - `tests/forensics/fundingFirstSourceProvenance.test.ts`
  - `tests/forensics/moneyOriginTrace.test.ts`
  - `tests/forensics/moneyOriginOperationalAssessment.test.ts`
  - `tests/admin/forensicsGraph.test.ts`
- [ ] Docs after code:
  - `docs/knowledge/05-where-is-money-and-incoming.md`
  - `docs/knowledge/08-admin-and-bot-ux.md`
  - `docs/knowledge/10-open-problems.md`

## Stage 1.13b: Pure Funding-First Helper

- [ ] Add source-provenance types to `src/types.ts`:

```ts
export type MoneyOriginFundingProofClass =
  | "exact"
  | "service_boundary"
  | "probable"
  | "pre_existing_balance_possible"
  | "unresolved";

export type MoneyOriginAmountContinuity = "strong" | "weak" | "broken";

export type MoneyOriginFundingSourceProvenance = {
  mode: "source_provenance";
  targetTxHash: string;
  targetFromAddress: string;
  targetToAddress: string;
  targetTimestamp: string;
  targetAmountRaw: string;
  proofClass: MoneyOriginFundingProofClass;
  coveredAmountRaw: string;
  coverageRatio: number;
  amountContinuity: MoneyOriginAmountContinuity;
  stopReason: MoneyOriginStoppedReason | null;
  fundingBundle: MoneyOriginFundingBundle | null;
  coverageWindow: {
    startTimestamp: string | null;
    endTimestamp: string;
    complete: boolean;
    capped: boolean;
    providerInconsistent: boolean;
  };
  reasons: string[];
};
```

- [ ] Extend `MoneyOriginPath`:

```ts
sourceProvenance?: MoneyOriginFundingSourceProvenance[];
```

- [ ] Extend `MoneyOriginTraceHistoryCoverage` with optional fields:

```ts
coverageComplete?: boolean | null;
providerCapHit?: boolean | null;
budgetExhausted?: boolean | null;
providerInconsistent?: boolean | null;
statusReason?: TronAddressUsdtCoverageStatusReason | null;
```

- [ ] Add stopped reasons to `MoneyOriginStoppedReason`:

```ts
| "pre_existing_balance_possible"
| "funding_first_unresolved"
| "amount_continuity_broken"
```

- [ ] Create `src/forensics/fundingFirstSourceProvenance.ts` with named thresholds:

```ts
export const FUNDING_FIRST_SOURCE_PROVENANCE_THRESHOLDS = {
  minFundingCoverageRatio: 0.95,
  warningFundingCoverageRatio: 0.8,
  maxDownstreamToUpstreamRatioForProof: 10,
  hardBreakDownstreamToUpstreamRatio: 100
} as const;
```

- [ ] Export a pure evaluator:

```ts
export function evaluateFundingFirstSourceProvenance(input: {
  target: ForensicRouteEdge;
  edges: ForensicRouteEdge[];
  historyCoverage: MoneyOriginTraceHistoryCoverage | null;
  downstreamAmountRaw?: string | null;
  minCoverageRatio?: number;
  maxFunders?: number;
}): MoneyOriginFundingSourceProvenance
```

- [ ] Inside the evaluator, call `buildFundingBundleForTraceHop` with the target hop and fetched edges.
- [ ] Exact proof requires all conditions:
  - bundle exists;
  - bundle meets threshold;
  - `historyCoverage.coverageComplete === true` or `historyCoverage.reachedTargetHop === true` with no capped/provider flags;
  - amount continuity is not `broken`.
- [ ] Probable proof requires:
  - bundle exists;
  - bundle meets threshold;
  - history coverage is missing, capped, budget-exhausted, or provider-capped;
  - amount continuity is not `broken`.
- [ ] Pre-existing balance outcome requires:
  - no usable bundle;
  - history coverage reached the target hop;
  - no prior usable incoming transfer explains the amount.
- [ ] Unresolved outcome covers:
  - no bundle and coverage is incomplete;
  - bundle below threshold;
  - amount continuity is `broken`;
  - provider inconsistency.
- [ ] Keep service detection out of this pure helper for the first slice. The helper should classify source math and coverage. `moneyOriginTrace.ts` already has `getClassificationForAddress`; service-boundary classification belongs there.

### Tests For Stage 1.13b

- [ ] Add `tests/forensics/fundingFirstSourceProvenance.test.ts`.
- [ ] Test exact bundle:
  - one target `sender -> subject`;
  - one prior incoming `funder -> sender`;
  - history coverage complete;
  - result `proofClass === "exact"`.
- [ ] Test probable capped bundle:
  - same transfer math;
  - `providerCapHit: true`;
  - result `proofClass === "probable"`.
- [ ] Test pre-existing balance:
  - no prior incoming edges;
  - `reachedTargetHop: true`;
  - result `proofClass === "pre_existing_balance_possible"`.
- [ ] Test amount-continuity break:
  - target hop is small;
  - downstream amount is at least `hardBreakDownstreamToUpstreamRatio` times larger;
  - result `proofClass === "unresolved"` and `amountContinuity === "broken"`.
- [ ] Run:

```powershell
npx vitest run --configLoader bundle tests/forensics/fundingFirstSourceProvenance.test.ts
npm run typecheck
```

## Stage 1.13c: Wire Funding-First Into Where Trace

- [ ] In `src/forensics/moneyOriginTrace.ts`, import `evaluateFundingFirstSourceProvenance`.
- [ ] Add `sourceProvenance: MoneyOriginFundingSourceProvenance[]` to `TraceState`.
- [ ] Update `pathFromState` and `incompletePath` so every returned `MoneyOriginPath` includes accumulated `sourceProvenance`.
- [ ] For each state with `targetEdge`, evaluate source provenance immediately after `getHistoryCoverageForAddress` returns.
- [ ] Replace the current direct `incoming_history_not_fetched` stop for a bundle with this behavior:
  - if proof class is `exact`, keep current branch expansion through bundle funders;
  - if proof class is `probable`, return an incomplete path with `stoppedReason: "incoming_history_not_fetched"` and include `sourceProvenance`;
  - if proof class is `pre_existing_balance_possible`, return incomplete path with `stoppedReason: "pre_existing_balance_possible"`;
  - if proof class is `unresolved` because amount continuity is broken, return incomplete path with `stoppedReason: "amount_continuity_broken"`;
  - otherwise return incomplete path with `stoppedReason: "funding_first_unresolved"`.
- [ ] Do not continue trace through `probable` funders. This keeps capped-window evidence out of hard source scoring.
- [ ] Service-boundary classification:
  - when exact proof reaches a classified service address, keep existing terminal behavior;
  - when probable proof points at a service address, store it as source-provenance context and keep the path incomplete unless hard evidence is already proven elsewhere.
- [ ] Preserve existing behavior for non-bundle candidate tracing. This stage only changes the bundle-first path that already calls `buildFundingBundleForTraceHop`.

### Tests For Stage 1.13c

- [ ] Update `tests/forensics/moneyOriginTrace.test.ts`.
- [ ] Add test: partial history with a strong bundle records `sourceProvenance[0].proofClass === "probable"` and does not continue to the funder.
- [ ] Add test: complete history with a strong bundle records `proofClass === "exact"` and continues to the funder as current bundle tests expect.
- [ ] Add test: no bundle with reached history returns `pre_existing_balance_possible`, not provider cap.
- [ ] Add test: amount continuity broken returns `amount_continuity_broken` and does not add a proven source path.
- [ ] Run:

```powershell
npx vitest run --configLoader bundle tests/forensics/moneyOriginTrace.test.ts
npm run typecheck
```

## Stage 1.13d: Keep Scoring Policy Honest

- [ ] Inspect `src/forensics/moneyOriginOperationalAssessment.ts` for any path scoring that treats all funding bundles as resolved source proof.
- [ ] Add a small helper in that file if needed:

```ts
function hasOnlyProbableFundingSource(path: MoneyOriginPath): boolean {
  const provenance = path.sourceProvenance ?? [];
  return provenance.length > 0 && provenance.every((item) => item.proofClass === "probable");
}
```

- [ ] Use the helper only to prevent probable-only source provenance from becoming hard source-policy evidence.
- [ ] Do not reduce risk from hard evidence found on the same path.
- [ ] Do not convert probable evidence into `ACCEPTABLE`; it remains context unless exact proof or independent hard evidence exists.

### Tests For Stage 1.13d

- [ ] Update `tests/forensics/moneyOriginOperationalAssessment.test.ts`.
- [ ] Add test: path with only `probable` source provenance and no hard evidence does not produce final user-facing `DECLINE`.
- [ ] Add test: same path with separate hard bad evidence still produces the existing hard-evidence result.
- [ ] Run:

```powershell
npx vitest run --configLoader bundle tests/forensics/moneyOriginOperationalAssessment.test.ts -t "probable"
npm run typecheck
```

## Stage 1.13e: Admin Projection

- [ ] In `src/admin/forensicsGraph.ts`, read `sourceProvenance` from each `MoneyOriginPath`.
- [ ] For each source-provenance item, add metadata to related bundle/provenance edges:

```ts
sourceProvenance: {
  mode: "source_provenance",
  proofClass,
  amountContinuity,
  coverageWindow,
  stopReason
}
```

- [ ] Add limitations:
  - `funding_first_exact_source` with severity `info` for exact proof;
  - `funding_first_probable_source` with severity `review` for probable proof;
  - `funding_first_service_boundary` with severity `info` for service-boundary context;
  - `funding_first_unresolved` with severity `review` for unresolved proof;
  - `amount_continuity_broken` with severity `warning` for broken amount continuity.
- [ ] Ensure probable edges are not rendered as final proven edges:
  - keep `type: "inferred_provenance"`;
  - set metadata `proofClass: "probable"`;
  - add limitation text that says the funding comes from cached/capped history.
- [ ] Keep the existing targeted terminal block. Do not hide real `provider_cap_unresolved` when funding-first remains unresolved.
- [ ] Suppress only duplicate generic limitations when a more precise funding-first limitation is present for the same path.

### Tests For Stage 1.13e

- [ ] Update `tests/admin/forensicsGraph.test.ts`.
- [ ] Add test: exact funding-first path exposes proof metadata.
- [ ] Add test: probable funding-first path creates `funding_first_probable_source` limitation.
- [ ] Add test: unresolved funding-first path does not duplicate a generic provider-cap limitation for the same path.
- [ ] Add test: service-boundary funding source is visible as neutral/context metadata without a decline verdict by itself.
- [ ] Run:

```powershell
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts -t "funding-first|probable|source provenance"
npm run typecheck
```

## Stage 1.13f: Coverage Metadata Producers

- [ ] In `src/forensics/deepForensicJob.ts`, enrich the current `historyCoverageCache.set` object:

```ts
coverageComplete: reachedTargetHop,
providerCapHit: indexedMayBeTruncated || liveMayBeTruncated,
budgetExhausted: indexedEdges.length >= edgeFetchLimit || liveEdges.length >= maxEdgesPerAddress,
providerInconsistent: fetchFailed,
statusReason: fetchFailed ? "partial_provider_inconsistent" : null
```

- [ ] Use local variables so `reachedTargetHop` is computed once and reused in `coverageComplete`.
- [ ] In the fallback `getHistoryCoverageForAddress` return object, set:

```ts
coverageComplete: false,
providerCapHit: null,
budgetExhausted: null,
providerInconsistent: true,
statusReason: "partial_provider_inconsistent"
```

- [ ] Search for all other `MoneyOriginTraceHistoryCoverage` object literals and add optional fields only where the code already knows them.
- [ ] Do not add provider guesses where the caller lacks enough data.

### Tests For Stage 1.13f

- [ ] Update existing tests that construct `MoneyOriginTraceHistoryCoverage` only when TypeScript requires it. Optional fields should keep most fixtures unchanged.
- [ ] Add one trace test where `providerCapHit: true` changes source provenance from exact to probable.
- [ ] Run:

```powershell
rg -n "MoneyOriginTraceHistoryCoverage|reachedTargetHop|coverageComplete" src tests
npm run typecheck
```

## Stage 1.13g: Full Regression And Live Validation

- [ ] Run focused tests:

```powershell
npx vitest run --configLoader bundle tests/forensics/fundingFirstSourceProvenance.test.ts
npx vitest run --configLoader bundle tests/forensics/moneyOriginTrace.test.ts
npx vitest run --configLoader bundle tests/forensics/moneyOriginOperationalAssessment.test.ts -t "probable"
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts -t "funding-first|probable|source provenance"
```

- [ ] Run full checks:

```powershell
npm test
npm run typecheck
git diff --check
```

- [ ] Restart the dev server on the feature branch before live validation if the running server predates the changes.
- [ ] Run one fresh `where_is_money_check` for:

```text
THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7
```

- [ ] Validate in Admin:
  - funding-first block appears for `TWkvffFDMsqbmTLkMHMABmw452Hyq98cdn` hops when cached data supports it;
  - `TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ` service-context funding is shown as context, not risk by itself;
  - probable capped-window source is not shown as exact;
  - small hop amounts do not prove the large downstream amount;
  - unresolved required paths still block final score;
  - targeted indexing waiting/resume still works.
- [ ] Capture result in the final engineering report:
  - job id;
  - score validity;
  - proof classes found;
  - unresolved paths;
  - provider errors;
  - whether Admin graph shows the distinction clearly.

## Documentation After Implementation

- [ ] Update `docs/knowledge/05-where-is-money-and-incoming.md`:
  - current behavior after implementation;
  - `source_provenance` vs `forward_flow`;
  - proof class definitions;
  - exact/probable scoring contract.
- [ ] Update `docs/knowledge/08-admin-and-bot-ux.md`:
  - Admin shows funding-first proof class;
  - Telegram remains unchanged in this stage.
- [ ] Update `docs/knowledge/10-open-problems.md`:
  - mark funding-first helper and Admin visibility according to implementation result;
  - keep Incoming adaptation as planned work.
- [ ] Run markdown/search checks:

```powershell
rg -n "funding-first|source_provenance|probable|pre_existing_balance_possible" docs\knowledge docs\superpowers\specs docs\superpowers\plans
git diff --check
```

## Commit Plan

- [ ] Commit Stage 1.13b helper and unit tests separately if it passes focused tests.
- [ ] Commit Stage 1.13c trace wiring separately.
- [ ] Commit Stage 1.13d scoring guard separately.
- [ ] Commit Stage 1.13e Admin projection separately.
- [ ] Commit Stage 1.13f docs and live-validation notes separately.
- [ ] Push only after `npm test`, `npm run typecheck`, and `git diff --check` pass.

## Rollback Plan

- [ ] If helper tests fail, revert only `src/forensics/fundingFirstSourceProvenance.ts` and its test file.
- [ ] If trace wiring fails, keep the helper commit and revert the `moneyOriginTrace.ts` commit.
- [ ] If Admin projection is noisy, keep backend metadata and revert only the Admin commit.
- [ ] If live validation shows no useful funding candidates, keep exact/probable classification but document the case as unresolved in `docs/knowledge/10-open-problems.md`.
