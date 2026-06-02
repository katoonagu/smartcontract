# Multi-Input Provenance Tracing Design

Date: 2026-06-02

## Summary

The current `where_is_money` flow can explain a low-balance wallet by selecting the latest meaningful outgoing transfer and finding inbound funding candidates for that outgoing. This works for simple one-in, one-out flows, but it breaks down when an intermediate wallet forms an outgoing transfer from several prior inbound transfers.

The approved direction is to keep the existing architecture and add bundle-aware tracing. `no_previous_transfer` must mean that no prior incoming transfer was seen. If prior incoming transfers exist but do not individually satisfy continuity, the report must say that explicitly and show the bundle evidence.

## Case Motivation

Subject wallet:

`TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe`

Observed behavior:

- The wallet had a near-zero USDT balance.
- `where_is_money` selected the latest meaningful outgoing anchor: `135.3K USDT` to `TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s`.
- The graph displayed original selected funding transfers of about `1.885M` and `800K`, which looked like the system was checking `2.69M`, not `135.3K`.
- On the lower path, `TV3H25qTg6zs52PcasjCbBZ2ZMeJST3JMN` was marked with `no_previous_transfer`, even though TronScan shows prior inbound transfers before its `850K` outgoing.

Important example around `TV3H25...`:

- `+85.013K`
- `+39.116K`
- `+100`
- `+600K`
- `+80.5K`
- then `-850K`

This is not "no previous transfer". It is a multi-input funding bundle that needs continuity scoring.

## Current Logic

### Low-Balance Recent-Flow Mode

When the current USDT balance is below the low-balance threshold, the system does not try to explain the whole wallet history. It selects a recent meaningful outgoing transfer as the anchor.

For this case:

- current balance was about `1.49 USDT`;
- threshold is `1000 USDT`;
- anchor was the latest meaningful outgoing `135.3K USDT`.

The first-level funding selector already calculates usable coverage toward the anchor. However, the graph currently displays the original transfer amounts, not the used amounts. This creates a UI mismatch.

### Deep Hop Tracing

After the first funding selection, `traceMoneyOriginPath` walks backward hop by hop. Today it effectively asks:

"Is there one previous inbound transfer that covers enough of the expected outgoing amount?"

The default amount-preservation threshold is about `70%`. This misses cases where several inbound transfers collectively fund the outgoing transfer.

## Problems To Fix

1. **Ambiguous displayed amount**

   A graph edge can show the full original transfer amount even when only part of that transfer was used to cover the selected anchor.

2. **Overloaded `no_previous_transfer`**

   The stop reason currently can mean several different things:

   - no incoming transfers exist;
   - incoming history was not fetched far enough;
   - incoming transfers exist but are too small or too old;
   - several incoming transfers exist and should be bundled, but the tracer only looked for one.

3. **No bundle tracing on deeper hops**

   The first selector can reason about multiple prior inputs, but deeper origin tracing reverts to single-edge continuity.

4. **Unclear risk and weight display**

   Admin graph panels can show `risk n/a` and `weight n/a` even when the selected node participates in a path with a risk contribution or a service exposure score.

## Approved Design

### 1. Keep Low-Balance Anchor Selection

`where_is_money` should continue using low-balance recent-flow mode:

- if balance is below threshold;
- find latest meaningful outgoing transfer;
- treat that outgoing as the amount to explain;
- select funding candidates for that anchor.

This preserves the product behavior: a drained wallet is checked by recent outgoing flow, not by stale remaining balance.

### 2. Add Bundle-Aware Deep Tracing

For each backward hop, the tracer should first try the existing strong single-edge match. If a strong single edge is found, behavior remains unchanged.

If no strong single edge is found, the tracer must build an inbound funding bundle:

- consider inbound transfers to the current address before the current hop timestamp;
- ignore the current outgoing transfer itself;
- account for later outgoing transfers from the same address as spend-overhang;
- sort candidates in reverse time order for cashflow reconstruction;
- accumulate usable inbound amounts until the outgoing amount is sufficiently covered;
- continue tracing through the top funders in the bundle.

Default target:

- bundle coverage threshold: `>= 80%`;
- single-edge preservation threshold can stay at the current default unless tests show it should be tuned.

The bundle should be attached to the path output so UI and reports can show why the tracer continued or stopped.

### 3. Replace Ambiguous Stop Reasons

Add precise stop reasons:

- `no_incoming_transfers_seen`
  - No prior inbound USDT transfer was available for this address before the hop timestamp.

- `incoming_history_not_fetched`
  - The system cannot prove absence because fetched history did not reach the relevant time window or provider pagination limit.

- `incoming_seen_but_below_continuity`
  - Prior inbound transfers exist, but neither a single edge nor a bundle met the continuity threshold.

- `multi_input_bundle_required`
  - Prior inbound transfers exist and a bundle explains the outgoing flow. This is not a terminal stop; it is a trace annotation.

Keep legacy `no_previous_transfer` only as a compatibility alias in old reports. New reports should use the precise stop reasons.

### 4. Clarify Amount Semantics

Add amount fields where needed:

- `anchorAmountRaw`
  - Amount currently being explained.

- `originalAmountRaw`
  - Full on-chain transfer amount.

- `usedAmountRaw`
  - Amount counted toward the selected anchor or bundle coverage.

- `coverageShare`
  - `usedAmountRaw / anchorAmountRaw`.

- `bundleAmountRaw`
  - Sum of usable amounts in a funding bundle.

The admin UI must label these clearly:

- `Original`
- `Used`
- `Coverage`
- `Role`

This prevents the case where the graph appears to check `2.69M` while the scoring is checking `135.3K`.

### 5. Clarify Weight Semantics

Admin graph nodes and the side panel must distinguish these weight types:

- `Path risk contribution`
- `Service exposure score`
- `Counterparty risk`
- `Node risk`

If a selected node has no node-level risk but belongs to a risky path, the panel should show:

- `Node risk: n/a`
- `Path risk contribution: 35`

If a selected bridge/adapter has service exposure but no final node risk, the panel should show:

- `Node risk: n/a`
- `Service exposure score: 65`

The UI should avoid bare `n/a` when a related path or service weight exists.

## Data Flow

```mermaid
flowchart LR
  A["Low balance wallet"] --> B["Select latest meaningful outgoing anchor"]
  B --> C["First-level funding candidates"]
  C --> D["Trace backward per selected funding candidate"]
  D --> E{"Strong single inbound?"}
  E -->|"yes"| F["Continue single-edge path"]
  E -->|"no"| G["Build inbound funding bundle"]
  G --> H{"Bundle coverage >= threshold?"}
  H -->|"yes"| I["Annotate bundle and continue via top funders"]
  H -->|"no, inputs exist"| J["Stop: incoming_seen_but_below_continuity"]
  H -->|"no inputs"| K["Stop: no_incoming_transfers_seen"]
  G --> L{"History incomplete?"}
  L -->|"yes"| M["Stop: incoming_history_not_fetched"]
```

## Reporting Requirements

Reports must answer these questions:

1. What amount was the system trying to explain?
2. Which original transfers were selected?
3. How much of each original transfer was used?
4. Was a path stopped because no inputs exist, or because continuity was weak?
5. Did a multi-input bundle explain a hop?
6. Which weight affected the final view: path, service, counterparty, or node?

## Testing Requirements

Add tests for:

- low-balance recent-flow UI/JSON amount fields;
- a deep hop where `600K + 80.5K + 39.1K + 85K` explains an `850K` outgoing better than a single-edge lookup;
- a true no-input case that still returns `no_incoming_transfers_seen`;
- a provider/page-limit case that returns `incoming_history_not_fetched`;
- a weak bundle case that returns `incoming_seen_but_below_continuity`;
- admin graph projection showing path/service weights even when node risk is `n/a`.

## Non-Goals

- Do not replace the full scoring policy engine.
- Do not claim dirty provenance from bundle continuity alone.
- Do not auto-decline solely because a multi-input bundle exists.
- Do not implement a full ledger-grade balance simulator in this change.
- Do not change the user-facing decision mapping without a separate policy decision.

## Implementation Notes

The most likely modules to change:

- `src/forensics/moneyOriginTrace.ts`
- `src/forensics/incomingDepositCashflow.ts`
- `src/forensics/recentFlowProvenanceSelection.ts`
- `src/check/whereIsMoneyCheck.ts`
- `src/admin/forensicsGraph.ts`
- admin console rendering code in `src/admin/adminConsole.ts`
- shared report types in `src/types.ts`

The existing `selectIncomingDepositFundingCandidates` logic is a useful starting point, but it is currently used mainly at the first funding-selection layer. The design requires similar bundle reasoning inside deeper path tracing.

## Open Decisions

1. Exact bundle threshold: default proposal is `80%`.
2. Maximum number of bundle funders to continue tracing: default proposal is top `3` by usable amount.
3. Whether small dust/test transfers should be displayed by default or collapsed under a bundle details section.

