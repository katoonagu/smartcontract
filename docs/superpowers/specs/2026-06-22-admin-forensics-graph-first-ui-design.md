# Admin Forensics Graph-First UI Design

Date: 2026-06-22

## Context

The current Admin Forensics Console shows useful forensic graph data, but the UI makes investigation harder than it should be:

- the graph is squeezed between a permanent job list, permanent analysis panel, and permanent transfer table;
- the current layered graph layout creates vertical stacks and hard-to-read edge bundles;
- wallets, services, contracts, CEXes, bridges, and stops are too visually similar;
- the table consumes a large part of the screen even when the user mainly needs the graph;
- deep, fast, and where-is-money jobs share a visual language even when their graph meaning differs.

Arkham was used as a visual reference for UX patterns only. We will not copy Arkham code, assets, or proprietary implementation. The useful patterns are: graph-first workspace, compact overlays, directional flow colors, semantic service nodes, timeline-first transfer exploration, and strong selection focus.

## Goals

1. Make the graph the primary workspace for a selected forensic job.
2. Make incoming, outgoing, service, context, and stop relationships visually distinct.
3. Keep jobs, summaries, and transfer details available without permanently shrinking the graph.
4. Preserve the existing forensic data and job semantics.
5. Improve readability before adding new data sources or changing scoring logic.

## Non-Goals

- Do not build a full Arkham clone.
- Do not copy Arkham frontend code or visual assets.
- Do not change fast check, deep check, where-is-money, scoring, or traversal rules.
- Do not add a separate Arkham-style address profile page in the first release.
- Do not add new blockchain data providers.
- Do not add heavy graph dependencies unless the current SVG approach cannot meet performance needs.

## First Release Scope

The first release updates the selected-job graph view inside `/admin/forensics`.

Included:

- graph-first layout for the selected job;
- collapsible `Jobs` overlay instead of a permanent left column;
- collapsible `Case brief` overlay instead of a permanent analysis sidebar;
- compact bottom activity timeline;
- transfer table collapsed by default and expandable from the bottom;
- new visual language for graph nodes and edges;
- flow filters for all, incoming, outgoing, and self/context;
- amount label mode for important, all, and hidden;
- services on/off;
- labels on/off;
- group small wallets on/off;
- hover and click selection states;
- dimming of unrelated graph elements when a node, edge, or path is selected;
- preservation of current job kind semantics for fast, deep, where-is-money, and incoming deposit graphs.

Excluded:

- separate address profile screen;
- full physics/WebGL graph engine;
- entity label editing;
- alert creation from graph;
- forensic rule changes.

## Screen Structure

The selected job opens in a graph-first workspace.

Top bar:

- job kind;
- job status;
- subject address;
- key graph counts;
- search by address, transaction, label, service name, or job id;
- session/admin controls.

Main canvas:

- graph occupies most of the viewport;
- pan and zoom remain available;
- fit/reset is available from the tool rail;
- graph remains visible when panels open.

Left overlays:

- `Case brief` opens a compact investigation summary;
- `Jobs` opens the job list and filters;
- both overlays sit on top of the graph and can be closed.

Right tool rail:

- select/pointer;
- fit;
- zoom in/out;
- labels toggle;
- freeze layout;
- export/share link;
- reset view.

Bottom area:

- compact activity timeline is visible by default;
- timeline can filter graph and transfers by time range;
- transfer table is collapsed by default;
- `Transfers` expands the table from the bottom when needed.

## Case Brief

`Case brief` is a short working summary, not a long report.

It shows:

- subject address;
- job kind and status;
- risk/decision when available;
- projection mode;
- top incoming counterparties;
- top outgoing counterparties;
- top services, CEXes, bridges, DEXes, contracts, and routers;
- boundary/stop count;
- projection gaps when graph data is incomplete;
- a short explanation when the graph is profile/context rather than money-origin proof.

For `address_deep_check`, the brief must make clear that many edges are profile/context edges and not exact money-origin paths.

## Node Visual Language

Nodes must communicate what they are before the user opens details.

Required display kinds:

- checked wallet: central highlighted node;
- wallet: neutral gray node;
- CEX: yellow/gold service node with `CEX` badge;
- bridge: blue/cyan service node with bridge-style icon;
- DEX: green or cyan service node;
- contract/router/adapter: purple service node;
- boundary/stop: warning or muted stop node;
- bundle/group: larger translucent cluster node;
- unknown/service: neutral service node until more specific classification exists.

The display kind is derived from graph metadata and can differ from the raw backend `kind`. Service metadata must upgrade a plain wallet display when available.

## Edge Visual Language

Edges must communicate direction and meaning.

Required edge roles:

- incoming transfer/profile flow: green;
- outgoing transfer/profile flow: red;
- service boundary: yellow/gold;
- context/inferred/profile edge: gray or muted;
- stop edge: muted warning style;
- selected edge/path: brighter and thicker;
- unrelated edge during selection: dimmed.

Line width should scale by importance:

- large or high-importance amounts are thicker;
- small edges remain thin;
- weak/context edges move into the background;
- extremely thick bundles should be capped so they do not hide the graph.

Amount labels:

- default mode shows only important labels;
- labels are compact, for example `50K USDT`;
- amount labels should avoid covering central nodes;
- all labels can be enabled for audit work;
- labels can be hidden entirely for visual exploration.

## Interaction Behavior

Hover:

- highlights the node or edge;
- highlights immediate neighbors;
- dims unrelated graph elements;
- shows a compact tooltip when useful.

Click node:

- selects the node;
- highlights connected edges and neighboring nodes;
- opens a selected-node card;
- shows node kind, address, labels, service type, totals, and relevant links.

Click edge:

- selects the edge;
- opens a selected-flow card;
- shows amount, direction, from, to, tx hash when available, timestamp when available, path id, and edge meaning;
- clearly distinguishes real transfer, profile context, inferred provenance, service boundary, and stop.

Click path:

- dims unrelated graph content;
- highlights the path;
- updates the table/timeline context.

Search:

- matches address, tx hash, label, service name, and job id;
- focuses the matching node/edge when there is one clear match;
- lists matches when there are multiple.

## Timeline And Transfers

The bottom timeline is visible by default.

Timeline behavior:

- bars show transfer/activity density by time;
- clicking or dragging a time range filters the graph and table;
- clearing the range restores the full graph;
- the selected range is visually obvious.

Transfer table:

- collapsed by default;
- expands from the bottom;
- supports all transfers, selected path, and boundary stops;
- keeps columns compact;
- links out to explorer pages where available;
- does not steal half the screen until the user asks for it.

## Layout Strategy

First release should prefer the existing server-rendered HTML/JS and SVG approach.

Graph layout should improve from the current layer-only placement:

- central checked wallet near the middle;
- incoming cluster to the left;
- outgoing cluster to the right;
- service/boundary nodes positioned near the relevant flow;
- small counterparties grouped when needed;
- deterministic placement so reloading a job does not randomly scramble the graph;
- manual pan/zoom and fit;
- optional freeze layout control.

If SVG performance becomes poor for larger graphs, Canvas/WebGL can be a second release. That decision should be based on observed performance, not assumed upfront.

## Job Kind Semantics

The UI must preserve job meaning.

`address_fast_check`:

- direct nearby profile;
- shows important direct counterparties and nearby service boundaries;
- should not pretend to be multi-hop origin tracing.

`address_deep_check`:

- profile/context graph;
- direct counterparties, inbound provenance profiles, service exposure, boundary context;
- outbound/context edges must be labeled as profile context, not money-origin proof.

`where_is_money_check`:

- money-origin trace;
- path edges represent provenance steps;
- allocation and stop reasons belong in edge/path details.

`incoming_deposit_check`:

- deposit-origin trace;
- sender, watched wallet, origin paths, bundles, and stops should be readable in the same graph-first UI.

## Error And Empty States

When graph data is missing or incomplete:

- keep the workspace visible;
- show a clear empty state in the graph area;
- show projection gaps in `Case brief`;
- explain whether the issue is no data, partial job, legacy report, timeout, or unsupported projection.

When a job is running:

- show current job status;
- allow refresh;
- avoid breaking the current graph view unless the user reloads or switches jobs.

## Testing

Add focused tests around generated HTML/JS strings and graph projection behavior where practical.

Coverage should verify:

- graph-first controls exist;
- job kind filters still include all forensic job kinds;
- case brief fields render when summary data exists;
- edge display roles map to the expected visual classes;
- service display kinds upgrade wallet-like nodes;
- transfer table can be collapsed/expanded;
- existing admin graph API shape remains compatible.

Manual QA should cover:

- opening a fast check job;
- opening a deep check job;
- opening a where-is-money job;
- opening an incoming-deposit job;
- selecting nodes and edges;
- switching flow filters;
- toggling labels;
- expanding/collapsing jobs, case brief, and transfers;
- viewport at desktop and narrow widths.

## Acceptance Criteria

- The selected job opens with the graph as the dominant workspace.
- Jobs and analysis no longer permanently squeeze the graph.
- Incoming and outgoing flows are visually distinct.
- CEX, bridge, DEX, contract, service, boundary, stop, and bundle nodes are not rendered as plain wallets when metadata exists.
- Important amounts are readable without covering the graph.
- Clicking a node or edge explains what it means.
- Deep-check profile/context edges cannot be confused with where-is-money provenance proof.
- The transfer table is available but not permanently dominant.
- The implementation does not copy Arkham code and does not change forensic scoring/traversal rules.
