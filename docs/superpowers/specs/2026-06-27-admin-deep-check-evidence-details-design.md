# Admin Deep Check Evidence Details Design

Date: 2026-06-27

## Goal

Make `address_deep_check` explain what every visible node and edge means.

The graph should not show `amount n/a` or a generic stop label when the system actually has useful facts. If a line is a direct transfer, the UI should say it is a direct transfer. If a line is a grouped service exposure, the UI should say it is grouped context and show the underlying transactions in the right rail. If a node is a history stop, the UI should explain why the investigation stopped there.

This design does not change scoring or fetching. It changes how existing deep-check graph evidence is named, grouped, selected, and explained.

## Current Problem

DeepCheck currently mixes several different concepts on the same canvas:

- direct wallet-to-wallet transfers;
- repeated transfers grouped into one visual connection;
- service, CEX, DEX, bridge, and contract boundary context;
- expansion stops such as `incoming_history_not_fetched`;
- wallet role markers such as collector or mule/transit.

These concepts are not equivalent, but they can look similar in the UI. The result is confusing:

- a service boundary can show `amount n/a` even when the raw profile has total volume and transaction counts;
- a context edge can look like a direct transfer;
- a history stop can look like a suspicious endpoint instead of a data coverage limit;
- a subject wallet can look like a collector verdict instead of a subject wallet with a behavior marker;
- the right rail does not always explain why a node or edge exists.

## Evidence Types

Every selectable graph edge should have one clear evidence type.

### Direct transfer

Meaning:

A real on-chain transfer exists between two visible endpoints.

Canvas label:

```text
24.3K USDT · Jun 23, 12:44
```

Right rail should show:

- `Evidence type: Direct transfer`;
- direction;
- amount;
- timestamp;
- full transaction hash;
- from address;
- to address;
- gap if available;
- whether this edge contributes to risk, context, or both.

### Grouped transfers

Meaning:

Multiple real transfers between the same conceptual endpoints are grouped into one visible line to keep the graph readable.

Canvas label:

```text
12 tx · 332.8K USDT
```

Right rail should show:

- `Evidence type: Grouped transfers`;
- total amount;
- transfer count;
- time range;
- direction summary: inbound, outbound, or mixed;
- the top underlying transactions;
- a `Show all transactions` action if the list is long;
- an `Expand on graph` action when graph expansion data exists.

Grouped transfers are still real transfer evidence. They are not guessed context.

### Boundary context

Meaning:

DeepCheck reached service-like infrastructure while expanding the wallet context. This can be a CEX, DEX, bridge, contract, router, GasFree account, or unlabeled service boundary.

Boundary context may be direct or multi-hop:

```text
subject -> counterparty -> Bybit
subject -> counterparty -> contract
counterparty -> GasFree -> subject
```

Canvas label:

```text
Bybit · 12 tx · 332.8K USDT
GasFree · 2 tx · 702.3K USDT
Contract boundary · 4 tx
```

Right rail should show:

- `Evidence type: Boundary context`;
- boundary type: CEX, DEX, bridge, contract, service, unknown contract;
- known identity if available;
- direct or multi-hop;
- direction;
- total amount if available;
- transfer count;
- top underlying transfers;
- the path or representative path that reached the boundary;
- plain note: `This is service/boundary context, not a clean money-origin proof by itself.`

The UI should not say `amount n/a` when an aggregate amount is available. If there is no aggregate amount, it should say:

```text
Amount not available for this projected context edge.
```

This is more honest than `amount n/a`, because it explains that the problem is the projection edge, not necessarily the investigation data.

### Profile context

Meaning:

DeepCheck created a summarized relationship from behavior or profile data, not a single transfer.

Canvas label:

```text
profile context
```

or, when useful:

```text
behavior context · 5 tx
```

Right rail should show:

- `Evidence type: Profile context`;
- what profile created it;
- why it exists;
- whether the source has transfer examples;
- whether it should be treated as risk evidence or only investigation context.

### Trace stop

Meaning:

The investigation stopped at this point. A stop is not automatically bad. It means the system cannot prove the next step with the data it has.

Canvas label examples:

```text
History incomplete
History not fetched
Service boundary reached
API budget reached
No previous funding found
```

Right rail should show:

- `Evidence type: Trace stop`;
- stop reason;
- address being investigated;
- previous hop being investigated;
- pages fetched if available;
- transfers fetched if available;
- oldest fetched transfer if available;
- target timestamp if available;
- simple meaning;
- simple limitation.

For `incoming_history_not_fetched`, use this explanation:

```text
We found a transfer into the checked wallet, then tried to inspect the sender's earlier funding.
The fetched incoming history did not give enough evidence to prove where that sender got the money.
This is a coverage limit, not proof of bad origin.
```

Possible causes shown in the right rail:

- the address is very active;
- the provider or index did not return the needed part of history;
- the page or request budget was reached;
- no reliable earlier funding transfer was found before the hop being checked.

## Right Rail Rules

The right rail is the source of truth for selected graph evidence.

When selecting anything on a deep-check graph, the panel should answer:

1. What is this?
2. Why is it on the graph?
3. Is it a real transfer, a group, context, or a stop?
4. What amount, time, tx, and endpoints are available?
5. What is missing?
6. Does this affect risk, coverage, or only investigation context?
7. What can I expand?

### Selected edge panel

Required fields:

- evidence type;
- meaning;
- direction;
- amount or aggregate amount;
- transfer count;
- time or time range;
- gap when available;
- tx hash when it is a single direct transfer;
- from/to endpoints;
- risk/context note;
- expansion action when available.

### Selected node panel

Required fields:

- node type: subject wallet, wallet, service, CEX, DEX, bridge, contract, bundle, stop;
- address or identity;
- role marker if present;
- role meaning and evidence strength;
- connected evidence summary;
- top incoming and outgoing visible connections;
- underlying grouped transactions if this node represents a group or boundary;
- limitation note if this node is a stop.

## Subject Wallet And Role Markers

The subject wallet should remain visually recognizable as the checked wallet.

If the subject also has a role such as `collector`, the role should be shown as a marker or badge, not as the main meaning of the node.

Required wording:

```text
Collector is a behavior marker, not final risk proof by itself.
```

For the graph:

- subject identity wins over role icon;
- role mark can be visible, but it should not make the subject look like a different entity type;
- clicking the subject should show both: `Selected node: subject wallet` and `Role marker: Collector`.

## DeepCheck Visibility Model

DeepCheck does more than one-hop fast-check, but the admin graph is a projection, not a complete raw dump.

The right rail should explain the current job coverage:

- how many direct counterparties were analyzed;
- how many counterparties were expanded;
- how many transfer edges were collected;
- how many extended addresses were fetched;
- how many boundary stops were found;
- whether service metadata enrichment was limited.

Example:

```text
DeepCheck coverage
100 direct counterparties analyzed
18 counterparties expanded
2,646 transfer edges collected
24 extended addresses fetched
60 expansion stops / limitations
```

This helps the analyst understand that the graph is not only one step, even when the visible canvas is grouped.

## Canvas Behavior

The canvas should remain readable by default.

Default deep-check graph:

- show services by default;
- show grouped service and boundary context;
- show direct transfers as transfer lines;
- group repeated service/boundary exposures;
- keep stops visually near the branch they belong to;
- do not explode all raw edges unless `Show all raw` is enabled;
- keep `Tx labels: auto` or `important` available for dense graphs;
- keep `Show all raw` for audit mode.

## Toolbar And Legend Layout

The graph topbar should stay readable on dense DeepCheck graphs.

Rules:

- primary actions stay available: Jobs, Analytics, Scoring audit, graph mode, role marks, labels, services, expand/reset controls;
- graph counts such as `N139 / E191 / P172 / W106` stay in a compact stats chip;
- legend items use their own responsive area and wrap below the controls when width is limited;
- stats and legend must not overlap each other;
- legend must not cover action buttons, graph title, or search input;
- if horizontal space is limited, optional legend text can wrap or move to a second row, but the color meaning must remain available through hover or the right rail.

## Expansion Rules

`Expand selected` should never silently do nothing.

If selected item can expand:

```text
Expand selected
```

expands only that group, boundary, or branch.

If selected item cannot expand:

```text
No stored expansion data for this item.
The right rail shows the available summary evidence.
```

Supported expansions:

- grouped transfers -> underlying tx list and optionally visible individual edges;
- boundary context -> representative paths and top underlying transfers;
- bundle/group node -> member wallets and known internal/external links;
- counterparty branch -> local direct neighbors if stored in the projection.

## Testing

Focused tests should cover:

- direct transfer selection shows direct transfer fields;
- grouped transfer selection shows count, total amount, and underlying tx;
- boundary context with aggregate amount does not render as plain `amount n/a`;
- boundary context without aggregate amount explains that amount is unavailable for the projected edge;
- `incoming_history_not_fetched` node shows the coverage-limit explanation;
- subject wallet with collector role remains a subject wallet in the selected-node panel;
- `Expand selected` shows a no-data explanation when expansion data is missing;
- DeepCheck coverage summary renders from existing result coverage/debug fields.

## Non-Goals

- Do not change risk scoring.
- Do not change provider fetch budgets.
- Do not make DeepCheck fetch unlimited history.
- Do not replace Where Is Money proof logic.
- Do not rewrite the admin console to React.
- Do not infer roles or boundary types in the frontend from graph shape alone.

## Acceptance Criteria

- `amount n/a` is not shown for boundary context when aggregate amount or transfer count exists.
- The right rail clearly distinguishes direct transfer, grouped transfer, boundary context, profile context, and trace stop.
- `incoming_history_not_fetched` is explained as a coverage limitation, not as bad-origin proof.
- Service, CEX, DEX, bridge, and contract context can be inspected through grouped details.
- The analyst can click a grouped boundary and see the real transactions or representative paths behind it.
- The subject wallet does not visually become only a collector/drainer/mule icon.
- DeepCheck right rail explains how much of the investigation was actually performed.
- The top toolbar, graph stats, and legend do not overlap on dense DeepCheck graphs; the legend wraps or moves to a second row when needed.

## Spec Self-Review

- No unresolved placeholders.
- Scope is limited to admin graph evidence explanation and display.
- The design keeps the existing semantic boundary between DeepCheck context and Where Is Money proof.
- The design does not ask the UI to invent missing amounts.
- The design provides a clear fallback when only summarized context exists.
