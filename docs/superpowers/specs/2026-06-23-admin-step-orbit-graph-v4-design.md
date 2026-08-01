# Admin Step Orbit Graph V4 Design

## Goal

Make dense admin forensic graphs readable as an investigation map, not as a pile of equal circles and crossing lines.

This spec updates the graph direction for dense `incoming_deposit_check` and `where_is_money_check` jobs. It builds on the earlier cluster timeline design, but changes the default visual model to **Step Orbit Map v4**.

The user should quickly see:

- what the main money path is;
- where funding groups sit;
- which surrounding wallets are linked to each other;
- where services, CEX, DEX, bridges, contracts, and boundary stops sit;
- how fast each visible transition happened;
- which transfers or groups are large enough to deserve attention;
- what can be expanded.

## Default View

For dense `incoming_deposit_check` and `where_is_money_check` graphs, default to **Step Orbit Map**.

The graph uses stable zones:

```text
source wallets -> funding groups -> checked wallet/deposit -> services/boundary
```

The graph should use more horizontal space instead of compressing every node into one cluster. It is acceptable for the map to be wider when that makes routes readable.

`Show all raw` stays available, but it is not the default for dense graphs.

## Layout Readability Rules

The layout should make the investigation path readable before it shows every detail.

Rules:

- place visible nodes by hop/step, not by a generic force cluster;
- keep source wallets, funding groups, checked wallet/deposit, services, and boundary stops in separate visual zones;
- put terminal boundary/stop nodes toward the side/end of the route, not inside the main wallet cluster;
- keep unrelated nodes from sitting on top of each other;
- keep node labels from overlapping other nodes when possible;
- allow visible crossings mainly when the crossed nodes are actually connected or part of the same local cluster;
- keep peer links between neighboring wallets visible, but lower-priority than the main money path;
- use more canvas width/height when needed instead of compressing dense graphs into one pile.

For dense incoming and where-is-money graphs, the user should first understand the rough route:

```text
source -> group/peer cluster -> checked wallet/deposit -> service or stop
```

Then the user can expand groups or switch to raw view for all addresses.

## Visual Language

Line meaning:

- solid green: main money path;
- solid amber/orange: funding, provenance, or group contribution path;
- dashed gray: peer link between neighboring wallets;
- dashed amber/orange: boundary, stop, or inferred context.

Line weight:

- line thickness may reflect importance, but it must be capped;
- thick lines should never hide labels, nodes, or nearby edges;
- if many similar transfers go between the same areas, prefer grouping/bundling over making a single unreadably thick line.

Node meaning:

- subject / checked wallet: blue;
- ordinary wallet: gray-blue;
- funding group / bundle: purple;
- service / CEX / DEX / bridge / contract: yellow/amber service color;
- boundary / stop: amber dashed node.

Do not use a yellow border around amount labels. The label itself should stay calm.

## Edge Labels

Every visible edge should have compact edge information.

Default edge label:

```text
amount / timeLabel
```

Amount text:

- white;
- medium weight, not bold-heavy;
- no colored border;
- short format on canvas, for example `24.3K`, `7.12M`, `49.9K`.

Full amount stays in the right rail and transfer table.

Time text:

- colored separately from the amount;
- short on canvas;
- full timestamp stays in the right rail and transfer table.

Preferred timestamp format on canvas:

```text
22 Jun, 12:36 UTC
```

Do not show ISO timestamps on the canvas.

## Time Label Logic

Every visible edge should show a time label, but the label type must not overclaim.

Use this order:

1. `hold` - only when the data proves funds arrived at a wallet, stayed there, and later left that same wallet.
2. `span` - only for a group/bundle where the label describes the group's internal time range.
3. `gap` - when comparing one hop to the next hop in a path.
4. transaction time - when there is a timestamp but no honest hold/span/gap label.
5. `time n/a` - when no time is available.

Examples:

```text
49.9K / gap 7m
7.12M / span 2h
24.3K / 22 Jun, 12:36 UTC
stop / time n/a
```

`hold` and `span` must only appear when the saved graph data supports that meaning. If the data is ambiguous, prefer `gap`, transaction time, or `time n/a`.

## Glow And Emphasis

Text should not carry the whole emphasis. Use glow and line/node treatment.

Base:

- ordinary lines get a very light white glow so they remain readable on the dark grid;
- ordinary labels remain calm.

Speed glow:

- applies to lines, not to amount text;
- blue glow communicates fast movement;
- glow becomes weaker as the gap gets longer.

Speed scale:

```text
<= 15m: strong blue glow
<= 1h: medium blue glow
<= 6h: soft blue glow
<= 24h: very soft blue/white glow
> 24h: no speed glow
```

Amount glow:

- applies to the line, node, or label background shadow, not as a colored border;
- uses the semantic line color:
  - green glow for main money path;
  - amber/orange glow for funding/provenance.

Suggested major amount rule:

```text
major amount = top 20% by visible edge amount OR >= 20% of checked amount
critical amount = top 5% by visible edge amount OR >= 50% of checked amount
```

The implementation can start with one `major` level and add `critical` only if it improves readability.

Node glow:

- glow color follows the node type color;
- bundle/group glows purple;
- service/CEX/DEX/bridge/contract glows yellow/amber;
- subject glows blue;
- ordinary wallet glows gray-blue.

Selected node:

- selected state adds a separate blue ring/glow over the base node glow;
- selection must not replace the node's semantic type color.

## Expand Behavior

`Expand selected` must be useful and predictable.

Expected behavior:

- selected funding group / bundle: expand real wallet members and known internal links;
- selected collapsed group: expand that group or switch to raw view if per-group expansion is unavailable;
- selected boundary / stop: show stop details and related last checked hops in the right rail;
- selected ordinary wallet: no-op is acceptable, but the UI should not look broken.

If a group has no stored internal links, the UI should say:

```text
Internal transfers were not found in saved graph data.
```

Do not invent internal links.

## Group And Bundle Explanation

Groups and bundles must not look like anonymous black boxes.

On canvas, label them as a group with useful summary text, for example:

```text
Group: 7 wallets / 7.12M
Boundary group: 4 stops
Service cluster: CEX / 12 wallets
```

In the right rail, explain:

- why the group exists;
- whether it is a real saved funding bundle or a UI-collapsed visual group;
- which wallets or stops are inside;
- total amount;
- transfer count;
- known time range;
- known internal links;
- related services, if any;
- why it may matter.

If a group has large volume and service-like behavior, show that as a hint, not as a confirmed label unless the data confirms it.

The UI must visually distinguish:

- a real wallet address;
- a service/CEX/DEX/bridge/contract;
- a boundary/stop;
- a saved funding bundle;
- a UI-collapsed display group.

## Services Toggle

`Services on/off` should have visible behavior.

When services are off:

- hide service-like nodes;
- hide direct service edges;
- hide service boundary/profile context edges when their main visible purpose is service exposure;
- keep the main money path readable if it does not depend on those service edges.

If a service node is also a terminal boundary, hide it from the graph but keep it visible in the boundary/details table.

## Pan And Drag

Dragging the map must feel immediate.

Requirements:

- panning the whole map should not select page text;
- panning should use transform updates, not full graph rerenders;
- dragging one node should not rerender the full SVG on every mouse move;
- node drag may update connected edges visually during drag, then persist position on mouseup.

This is a UI responsiveness requirement, not a change to graph data.

## Right Rail

The right rail remains the full reading surface.

For selected edge:

- amount;
- time label used on canvas;
- full timestamp;
- tx gap;
- from;
- to;
- tx hash;
- path id;
- meaning.

For selected group:

- group type;
- amount;
- member count;
- tx count;
- time label;
- time range;
- top funders/members;
- internal links if present;
- external links;
- expand action.

For selected boundary/stop:

- stop reason;
- path id;
- last checked hop;
- whether required time/window was reached;
- history checked;
- known missing data.

## Data Limits

The graph can only show:

- internal group links if saved graph data contains them;
- `hold` if the same-wallet incoming-to-outgoing relationship is known;
- `span` if group start/end times are known;
- `gap` if adjacent hop times are known.

When data is missing, show `time n/a` or a clear missing-data line in the right rail.

## Out Of Scope

- Telegram bot UI changes.
- Risk scoring changes.
- Full React migration.
- Copying Arkham code or assets.
- Fake internal bundle links.
- Changing wallet/job backend semantics beyond exposing already-known graph metadata.

## Acceptance Criteria

- Dense incoming and where-is-money graphs open in Step Orbit view by default.
- Source wallets, funding groups, checked wallet/deposit, services, and boundary stops are spatially separated.
- Edge labels show white amount text plus a compact time label.
- Canvas labels do not use yellow borders.
- Full timestamps remain available in the right rail and transfer table.
- Fast edges up to 24 hours have graded speed glow.
- Major amount edges/groups have subtle semantic glow.
- Node glow follows node type color.
- Selected node glow is visually stronger but preserves semantic node color.
- Dense layouts avoid node-on-node and label-on-node overlap as much as the available data allows.
- Terminal boundary/stop nodes are visually separated from the main wallet cluster.
- Thick edges are capped so they do not hide the graph.
- `Expand selected` works for funding groups/bundles and collapsed groups, and does not silently fail.
- Groups/bundles explain what they contain, why they exist, and whether they are real data groups or only UI-collapsed groups.
- Boundary/stop selection shows useful details in the right rail.
- `Services on/off` visibly changes service nodes/edges.
- Map pan does not select page text and does not feel delayed.
- Dragging a node does not rerender the full graph on every mouse move.
