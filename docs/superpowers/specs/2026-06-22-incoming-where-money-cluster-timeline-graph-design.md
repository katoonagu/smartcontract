# Incoming And Where-Is-Money Cluster Timeline Graph Design

## Goal

Make `incoming_deposit_check` and `where_is_money_check` readable when the graph is dense.

The current dense view can look like a pile of thick lines and overlapping circles. The user cannot quickly answer:

- where the money probably came from;
- which wallets form meaningful groups;
- which groups are connected to each other;
- where services, CEX, DEX, bridges, contracts, and stop points sit;
- what happened first, later, and after that;
- what is hidden inside a `Bundle`.

The approved direction is a hybrid:

```text
clusters of meaning first + timeline logic second
```

This means the default view should not show every raw address at once. It should first show the important groups and route stages. The analyst can then expand a group or switch to raw mode.

## Approved Default

For dense `incoming_deposit_check` and `where_is_money_check` graphs, default to **Cluster timeline**.

The screen should read left to right:

```text
Sources -> funding clusters -> sender / checked wallet -> services / stops
```

This is not the same as hiding data. It is a first reading layer. The raw addresses remain available through expansion, search, and `Show all raw`.

## Main View

The default graph should show:

- important source wallets;
- funding clusters;
- the sender wallet when the mode has a sender;
- the checked wallet or subject wallet;
- services such as CEX, DEX, bridge, router, contract;
- stop nodes such as clean CEX reached or no previous transfer;
- quiet neighbor links between wallets or clusters when those links explain the route.

The default view should avoid:

- showing every small address as an equal circle;
- drawing very thick rope-like edges;
- putting timestamp/gap text on every edge;
- keeping `Bundle` as a black-box node with no explanation;
- overlapping wallet circles and labels.

## Bundle And Cluster Meaning

`Bundle` must not look like a normal wallet.

In the UI, a bundle/cluster should be shown as a grouped object, for example:

```text
Group: 12 wallets
439K USDT
18 tx
contains peer links
```

When the user selects a group, the right analytics rail should show:

- why it was grouped;
- how many wallets are inside;
- total amount;
- transaction count;
- time range;
- top wallets inside;
- known internal links between those wallets;
- external links from the group to the rest of the graph;
- services touched by the group;
- a button to expand that group on the graph.

Important distinction:

```text
Cluster/group = UI presentation object.
Wallet/address = real blockchain address.
Service = known entity or contract-like destination.
Stop = investigation boundary or missing continuation.
```

These should be visually different.

## Expand Behavior

Use three levels of detail:

1. **Cluster timeline**: default dense overview.
2. **Expand selected**: opens one selected group/bundle into its real wallets and internal links.
3. **Show all raw**: shows all graph nodes in a wider timeline-lane layout.

`Show all raw` should not be the default for dense graphs. It is for manual inspection after the analyst understands the main shape.

If a bundle has no known internal edges, the UI should say that plainly:

```text
Internal transfers were not found in saved graph data.
```

Do not fake internal links. Show only links that the stored graph actually has.

## Lines And Labels

Line thickness should be capped. A large transfer can be more visible, but it should not create a fat unreadable rope.

Use meaning in line style:

- solid green: incoming/source money path;
- solid amber: outgoing or used money path;
- dashed gray: inferred/context/projection edge;
- dotted soft green: neighbor link between surrounding wallets;
- dashed red: risky or negative stop/risk relation.

Use labels sparingly:

- graph edge labels show short amount only, such as `64K`, `250K`, `19.9K`;
- no second-line timestamp on canvas labels;
- time and gap belong in the bottom timeline and right analytics rail;
- selected edge can show more detail in the right rail.

## Time Reading

The graph needs a bottom timeline strip.

The timeline should show:

- main time buckets;
- when source funding happened;
- when sender funding happened;
- when the checked deposit or checked transfer happened;
- when service/stop events happened;
- selected edge time and gap.

The timeline is the place for time context. The graph canvas is the place for shape and meaning.

## Right Analytics Rail

The right rail is the reading surface.

For selected flow, show:

- amount;
- full timestamp;
- tx gap;
- from;
- to;
- tx hash;
- meaning;
- whether it is direct, inferred, internal group link, or stop relation.

For selected wallet, show:

- full address with Tronscan link;
- role in graph;
- incoming/outgoing totals shown in this job;
- connected neighbors;
- services connected to this wallet.

For selected group/bundle, show the group details described above.

Full addresses belong in the right rail and detail tables. Dense graph labels can stay shortened.

## Layout Rules

The layout should reserve zones:

- left: source wallets and source services;
- middle-left: funding clusters and intermediate wallets;
- middle-right: sender and subject wallet;
- right: services, contracts, bridges, stops;
- bottom: timeline.

Collision rules:

- circles should not overlap;
- cluster boxes/chips should reserve space;
- labels should not sit on other labels;
- selected and path-critical nodes should move less than low-importance nodes;
- expanding a group may make the map wider instead of compressing everything into the same area.

## React Question

React is not the first thing that fixes this.

The current UI is limited mostly by:

- graph presentation model;
- clustering rules;
- layout rules;
- selection and expansion behavior;
- how bundle contents are exposed.

React could help later because the admin UI is growing and panels/state would be easier to maintain as components. But React alone would not make the graph readable.

Recommended order:

1. First fix the graph model and cluster/timeline layout in the current UI.
2. Keep the implementation small and testable.
3. If the admin graph continues to grow, migrate the admin console shell and panels to React later.
4. Keep the graph renderer as SVG or a proven graph renderer behind a clean presentation model.

Do not rewrite the admin UI only for the sake of using React.

## Data Requirements

The UI can only show internal bundle links if the saved graph data contains them.

If backend graph data does not currently store enough bundle internals, add a later backend task to expose:

- bundle members;
- member-to-member transfers;
- member-to-service transfers;
- external links from bundle to non-bundle nodes;
- total amount and tx count;
- time range;
- reason for grouping.

The first UI pass should still work without all internals by showing a clear "not available in saved data" state.

## Out Of Scope

- Telegram bot UI changes.
- Risk scoring changes.
- Copying Arkham code or assets.
- Full React rewrite as part of the first pass.
- Fake bundle internals that are not present in data.

## Prototype

Reference prototype:

```text
docs/superpowers/prototypes/2026-06-22-cluster-timeline-graph-mockup.html
```

The prototype is not production UI. It is a visual target for discussion and implementation planning.

## Acceptance Criteria

- Dense incoming and where-is-money jobs open in Cluster timeline by default.
- The graph reads left-to-right by route stage.
- Bundles are shown as groups, not as normal wallets.
- Selecting a bundle shows what is inside or says what data is missing.
- The user can expand one bundle without switching the whole graph to raw mode.
- `Show all raw` remains available for full inspection.
- Lines are thinner and capped.
- Line color/dash/shape communicates meaning.
- Important edge labels show short amounts only.
- Time and gap appear in the timeline and right rail, not as ugly second lines on canvas labels.
- Neighbor links between surrounding wallets/clusters can be shown as a quiet layer.
- Wallet circles and labels do not overlap in the default dense view.
- Full addresses are shown in the right rail with Tronscan links.
- Existing job history and current admin rails remain intact.
