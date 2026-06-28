# Admin DeepCheck Transaction Grouping And Circular Flow Design

Date: 2026-06-28

## Goal

DeepCheck should show a readable investigation map, not a pile of repeated arcs. The graph must keep the evidence honest:

- one real transaction is one visible transaction edge;
- repeated real transactions between the same wallets can be collapsed into a grouped evidence edge;
- circular wallet movement must be marked as circular evidence, not treated as a resolved clean source;
- saved wallet risk from earlier checks should be visible on neighboring wallets.

## Current Problem

DeepCheck currently groups some transactions because the backend profile says `txCount > 1`, but it does not consistently group all repeated transfers between the same two wallets. This can produce a mixed view:

- one pair of wallets has several separate lines;
- another pair has a `2 tx` grouped line;
- visually similar situations look different.

Another issue is circular funding. If wallet `A` sends to wallet `B`, and `B` sent to `A` shortly before, the system can visually make the latest hop look like a normal funding source. For investigations, that is not enough. It should be treated as reciprocal movement and the trace should continue upstream when possible.

## Transaction Grouping Rule

Group only repeated real transaction evidence.

A transaction group is allowed only when all these fields match:

- same `from` wallet;
- same `to` wallet;
- same direction;
- same evidence type;
- same episode.

Single transactions are never groups.

### Edge Display Rules

- `1 tx`: one gray dashed line.
- `2+ tx`: one gray-violet dashed grouped line.
- grouped label: `5 tx - 8.1K USDT`;
- grouped sublabel: period, for example `Feb 11-16`;
- click opens every underlying transaction in the right rail and transfer drawer.

### Do Not Group Together

These must remain separate groups or separate edges:

- inbound and outbound transfers between the same wallets;
- normal wallet transfer and contract-driven transfer;
- wallet-to-wallet evidence and service/boundary context;
- episodes separated by a large time gap.

Default episode split:

- if consecutive transactions between the same pair are more than 30 days apart, split them into separate groups.

This is intentionally simple. It is enough to stop visual clutter without hiding important chronology.

## Circular / Ping-Pong Flow Rule

If the graph sees:

```text
A -> B
B -> A
```

within the same investigation window, this is reciprocal flow.

It should not be treated as a clean resolved source. It should be marked as circular evidence and, when possible, DeepCheck should keep looking upstream.

Example:

```text
upstream wallets -> TPdrEz -> TNAra -> TPdrEz
```

The edge pair `TPdrEz <-> TNAra` should be labeled:

```text
reciprocal flow
```

## Stop Reason Split

DeepCheck should separate two concepts:

- `history fully fetched`: whether the full wallet history was fetched;
- `enough history for this hop`: whether the current hop has enough history to make the next trace decision.

If full history is not fetched, but enough history exists for the current hop, the graph should not stop early just because the entire wallet history is incomplete.

## Saved Wallet Risk On Neighbors

When a neighboring wallet already has a saved result from another check, DeepCheck should reuse it as context.

Examples:

- previous result: `95 / exact approval-drain`;
- previous role: drainer, victim, collector, mule/transit;
- previous blacklist/frozen finding.

The graph should show:

- role icon or badge;
- local risk badge;
- source check and reason in the right rail.

This does not replace the current check. It gives the analyst context immediately.

## Right Rail Behavior

When selecting a grouped transaction edge, show:

- total tx count;
- total amount;
- period;
- direction;
- all underlying transactions:
  - amount;
  - human-readable time;
  - tx hash link;
  - from;
  - to.

When selecting a reciprocal flow, show:

- both directions;
- tx count and amount per direction;
- first and last time;
- why it is considered circular;
- whether upstream tracing continued or stopped.

## Final Rule

```text
Group only repeated real tx evidence between the same two nodes, same direction,
same evidence type, same episode. Single tx is never a group.
Reciprocal flows are not source resolution; they are circular evidence and
must continue upstream when possible.
```

## Implementation Scope

This spec covers DeepCheck graph projection and admin visualization only.

It does not change final risk scoring by itself. Risk changes should be handled in a later scoring-calibration spec, after the graph evidence is displayed honestly.

## Acceptance Criteria

- A single transaction between two wallets is not marked as grouped.
- Two or more same-direction transactions between the same wallets are shown as one grouped edge.
- Grouped edges expand into the stored transaction list.
- Opposite directions between the same wallets are not merged into one group.
- Circular flows are labeled as reciprocal/circular evidence.
- Circular flows do not end upstream tracing as if the source were resolved.
- Saved high-risk wallet roles appear on neighboring wallets when available.
- Right rail uses human-readable times and readable transaction cards.
