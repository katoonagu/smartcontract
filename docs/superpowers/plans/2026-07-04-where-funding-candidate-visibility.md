# Where Funding Candidate Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ordinary `where_is_money_check` Admin graphs show saved funding candidates that explain concrete route hops, with honest proof classes, grouping, and counters.
**Architecture:** Keep Where route-focused. Add a small deterministic Admin projection layer over already-saved `originPaths[].sourceProvenance` / `fundingBundle.members`; do not add tracing, scoring, indexing, or DeepCheck expansion.
**Tech Stack:** TypeScript, Vitest, existing Admin graph projection in `src/admin/forensicsGraph.ts`, existing Admin single-file UI in `src/admin/adminConsole.ts`.

---

## Constraints

- [ ] Do not touch DeepCheck relationship expansion.
- [ ] Do not use arbitrary wallet neighbors in Where.
- [ ] Do not change Where scoring, risk policy, job lifecycle, targeted indexing budgets, or TronScan worker behavior.
- [ ] Do not treat `probable` as hard proof.
- [ ] Do not draw a candidate unless it attaches to a concrete route hop: `candidate funding transfer -> hop wallet -> next hop / subject`.
- [ ] Old jobs should improve automatically when their `result_json` already contains `sourceProvenance`; no DB migration is required.
- [ ] Jobs without saved `sourceProvenance` should show no funding-candidate expansion and should not synthesize neighbors.

## Current Code Anchors

- [ ] `src/admin/forensicsGraph.ts`
  - `projectWhereIsMoneyJob` builds Where nodes/edges/paths.
  - Current source-provenance loop starts at `sourceProvenanceItems.forEach`.
  - Current code renders `sourceProvenance.fundingBundle.members` directly as inferred provenance edges.
  - Current duplicate guard is `if (!fundingBundle || (targetTxHash && fundingBundleByHopTxHash.has(targetTxHash))) return;`.
- [ ] `src/admin/adminConsole.ts`
  - `edgeVisualRole`, `edgeExtraClass`, and `graphLegendHtml` define graph color/legend behavior.
  - `transferDetailBlock`, `edgeEvidenceTypeLabel`, and `edgeMeaning` define right-rail explanations.
  - `layerSummaryLine` and summary detail helpers already show targeted/source-provenance diagnostics.
- [ ] Existing tests:
  - `tests/admin/forensicsGraph.test.ts` already covers probable source provenance and residual caveats.
  - `tests/admin/adminConsole.test.ts` already covers Where visual roles, legend, and edge classes.

## Data Contract

- [ ] Add these metadata fields to candidate/caveat/group edges produced from `sourceProvenance`:

```ts
{
  source: "where_funding_candidate_visibility",
  whereFundingRole:
    | "exact_funding_candidate"
    | "probable_funding_context"
    | "pre_existing_balance_caveat"
    | "unresolved_source_caveat"
    | "service_boundary"
    | "grouped_candidate_tail",
  proofClass: "exact" | "probable" | "pre_existing_balance_possible" | "unresolved" | "service_boundary",
  pathId: string,
  sourceProvenanceIndex: number,
  candidateRank?: number,
  targetTxHash: string | null,
  targetHopEdgeId: string | null,
  targetFromAddress: string | null,
  targetToAddress: string | null,
  targetTimestamp: string | null,
  candidateCoverageRatio?: number | null,
  amountContinuity?: string | null,
  coverageWindow?: Record<string, unknown> | null,
  stopReason?: string | null,
  visibilityReason: string
}
```

- [ ] Add `summary.layerSummary.whereFundingCandidateVisibility`:

```ts
{
  exactShownCount: number,
  exactTotalCount: number,
  probableShownCount: number,
  probableTotalCount: number,
  groupedHiddenCount: number,
  unresolvedCaveatCount: number,
  preExistingBalanceCaveatCount: number,
  serviceBoundaryCount: number,
  routeHopCount: number,
  maxProvenRouteDepth: number
}
```

## Stage 1: Pure Visibility Selector

- [ ] Create `src/admin/whereFundingCandidateVisibility.ts`.
- [ ] Export constants:

```ts
export const WHERE_FUNDING_CANDIDATE_LIMITS = {
  exactGlobalCap: 20,
  exactPerHopSoftCap: 5,
  probableGlobalCap: 5,
  probablePerHopSoftCap: 2
} as const;
```

- [ ] Export a pure helper:

```ts
export function buildWhereFundingCandidateVisibility(input: {
  subjectAddress: string;
  selectedAmountRaw: string | null;
  targetAmountRaw: string | null;
  originPaths: Record<string, unknown>[];
  existingFundingBundleHopTxHashes: Set<string>;
  limits?: Partial<typeof WHERE_FUNDING_CANDIDATE_LIMITS>;
}): WhereFundingCandidateVisibility
```

- [ ] Candidate extraction rules:
  - Read only `originPaths[].sourceProvenance[]`.
  - Candidate transfers come only from `sourceProvenance.fundingBundle.members[]`.
  - Require `member.fromAddress`, `member.toAddress`, and a concrete target hop from `targetFromAddress` / `targetToAddress` / `targetTxHash`.
  - Require `member.toAddress === sourceProvenance.targetFromAddress`.
  - Require candidate timestamp before or equal to `targetTimestamp` when both timestamps exist.
  - Preserve existing duplicate behavior: if `targetTxHash` is already in `existingFundingBundleHopTxHashes`, count the candidate but do not ask the projection to draw a duplicate edge.
- [ ] Ranking rules:
  - Sort exact candidates before probable candidates.
  - Within the same proof class: larger `coverageShare` / `coverageRatio`, larger `usedAmountRaw`, closer timestamp to target hop, stronger `amountContinuity`, then stable tx hash order.
  - An important hop can exceed the per-hop soft cap when its `targetAmountRaw` equals `selectedAmountRaw` or `targetAmountRaw`, or the path `balanceShare >= 0.5`.
- [ ] Limit rules:
  - Show at most 20 exact candidate edges globally.
  - Show at most 5 exact candidate edges per non-important hop.
  - Show probable candidates as context with a small cap: 5 globally and 2 per hop.
  - Group hidden over-limit candidates per hop and proof class; do not silently drop them.
- [ ] Caveat rules:
  - `pre_existing_balance_possible`, `unresolved`, and `service_boundary` entries without a drawable funding member become caveat/boundary projection facts.
  - Service/CEX/DEX/bridge/router/contract/high-degree boundaries stay boundaries; no expansion.

## Stage 2: Wire Into `projectWhereIsMoneyJob`

- [ ] In `src/admin/forensicsGraph.ts`, import `buildWhereFundingCandidateVisibility`.
- [ ] Before the current `sourceProvenanceItems.forEach` rendering block, build the selector input for the current path.
- [ ] Replace the direct member rendering inside `sourceProvenanceItems.forEach` with selector output:
  - exact candidate edge: `type: "transfer"`, `displayRole: "allocated_transfer"` when `txHash` exists;
  - probable candidate edge: `type: "inferred_provenance"`, `displayRole: "inferred_provenance"`;
  - grouped tail: `kind: "bundle"`, `displayKind: "funding_bundle"` group node plus one context edge to the hop;
  - caveat/boundary: `kind: "stop"` or `displayKind: "trace_stop"` node plus one stop/context edge to the hop.
- [ ] Exact candidate edges keep real transfer facts:
  - `txHash`;
  - `timestamp`;
  - `amountRaw`;
  - `usedAmountRaw`;
  - `originalAmountRaw`;
  - `anchorAmountRaw`;
  - `moneyDirection: "inbound_to_subject"`;
  - `graphDirection: "source_to_hop"`.
- [ ] Probable/caveat/group edges keep `moneyDirection: "context"` or visual context metadata so they do not render as proven green flow.
- [ ] Update `layerSummary` merge to include `whereFundingCandidateVisibility`.
- [ ] Keep existing dedupe functions after projection:
  - `dedupeGroupedProfileContextEdges`;
  - `mergeDuplicateTransferEdges`;
  - `suppressFundingBundleDuplicateEdges`;
  - `removeNoTxTransferDuplicates`.

## Stage 3: Admin UI Labels, Legend, and Details

- [ ] In `src/admin/adminConsole.ts`, update `edgeEvidenceTypeLabel`:
  - `exact_funding_candidate` -> `Exact funding candidate`;
  - `probable_funding_context` -> `Probable funding context`;
  - `pre_existing_balance_caveat` -> `Pre-existing balance caveat`;
  - `unresolved_source_caveat` -> `Unresolved source caveat`;
  - `service_boundary` -> `Service boundary`;
  - `grouped_candidate_tail` -> `Grouped funding candidates`.
- [ ] Update `edgeMeaning`:
  - exact: `Saved source-provenance transfer that funds the selected route hop`;
  - probable: `Amount/time candidate from incomplete coverage; context only`;
  - caveat: `Where could not prove a funding transfer for this hop`;
  - group: `Additional lower-ranked candidates grouped for readability`.
- [ ] Update `edgeExtraClass`:
  - `edge-where-exact-funding`;
  - `edge-where-probable-funding`;
  - `edge-where-source-caveat`;
  - `edge-where-service-boundary`;
  - `edge-where-grouped-candidate`.
- [ ] Update `graphLegendHtml` for `where_is_money_check`:
  - selected route;
  - exact funding;
  - probable funding context;
  - unresolved/pre-existing caveat;
  - service boundary;
  - grouped candidates.
- [ ] Update `transferDetailBlock` to show:
  - proof class;
  - target hop tx;
  - target hop addresses;
  - coverage ratio;
  - amount continuity;
  - stop reason;
  - visibility reason;
  - group hidden count when applicable.
- [ ] Add a small `whereFundingCandidateLines(summary)` helper and include it near targeted-history/source-provenance summary details.

## Stage 4: Tests

- [ ] Add `tests/admin/whereFundingCandidateVisibility.test.ts`:
  - exact `sourceProvenance` with `subject <- A` route and `F -> A` member is selected and ranked;
  - candidate after target timestamp is rejected;
  - duplicate target hop already represented by `fundingBundles` is counted but not rendered as a duplicate;
  - 30 exact candidates become 20 shown plus grouped hidden count;
  - per-hop cap is 5, while an important hop can exceed 5 within the global cap;
  - probable candidates are capped and marked context;
  - unresolved/pre-existing/service-boundary entries produce caveat facts.
- [ ] Extend `tests/admin/forensicsGraph.test.ts`:
  - `sourceProvenance` exact candidate renders `F -> A` attached to route hop `A -> subject`;
  - probable candidate renders as context, not proven transfer;
  - over-limit candidates create a grouped funding-candidate node/edge and summary counts;
  - unrelated `senderInteractionProfiles` or peer links are not rendered as money sources;
  - old job shape without `sourceProvenance` keeps route-only graph and zero candidate counters.
- [ ] Extend `tests/admin/adminConsole.test.ts`:
  - Where legend includes exact/probable/caveat/service/group categories;
  - edge classes map from `whereFundingRole`;
  - selected edge detail shows proof class, target hop, stop reason, and group hidden count.

## Stage 5: Documentation

- [ ] Update `docs/knowledge/05-where-is-money-and-incoming.md`:
  - Where source-provenance candidates are Admin-visible only when attached to a route hop.
  - Exact candidates are proven funding edges; probable candidates are context.
  - Over-limit tails are grouped.
- [ ] Update `docs/knowledge/08-admin-and-bot-ux.md`:
  - Admin legend/categories for Where funding candidates.
  - Summary counters for shown/hidden candidates and caveats.
- [ ] Update `docs/knowledge/09-current-decisions.md` only if implementation changes product wording or candidate limits from this plan.

## Verification

- [ ] Run focused tests:

```powershell
npx vitest run --configLoader bundle tests/admin/whereFundingCandidateVisibility.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
```

Expected: all focused Admin/Where tests pass.

- [ ] Run full test suite:

```powershell
npm test
```

Expected: all tests pass.

- [ ] Run typecheck:

```powershell
npm run typecheck
```

Expected: TypeScript exits with no errors.

- [ ] Run whitespace check:

```powershell
git diff --check
```

Expected: no trailing whitespace or conflict markers.

## Acceptance Criteria

- [ ] Where graph default view stays route-focused.
- [ ] Exact funding candidates are visible as funding edges attached to concrete route hops.
- [ ] Probable candidates are visible as weaker context and never look like hard proof.
- [ ] Pre-existing-balance, unresolved, and service-boundary outcomes are visible as caveat/boundary facts.
- [ ] Over-limit candidates are grouped with counts, not silently hidden.
- [ ] Summary shows exact/probable shown vs total, grouped hidden count, caveat counts, service boundary count, and max proven route depth.
- [ ] Full evidence can show more payload but still labels candidate proof class honestly.
- [ ] No scoring, lifecycle, budget, DeepCheck, Incoming, Where targeted indexing, or TronScan worker behavior changes.
