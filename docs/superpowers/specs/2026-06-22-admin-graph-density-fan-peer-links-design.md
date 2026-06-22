# Admin Graph Dense Fan And Peer Links Design

## Goal

Make dense admin forensic graphs readable without losing investigation power.

The current graph can contain enough nodes and edges that addresses overlap, edge labels stack on top of each other, and the user cannot quickly understand what happened. The desired behavior is not just a prettier layout. The graph should let an analyst answer:

- Who are the important incoming and outgoing neighbors?
- What are the main money routes?
- Which neighbors are connected to each other?
- Where are services, contracts, bundles, and stop points?
- What happened over time without filling every edge with hard-to-read timestamps?

## Approved Direction

Use a dense-graph default based on the fast-check visual shape:

- Subject wallet in the center.
- Important incoming/source neighbors fan out to the left.
- Outgoing neighbors, services, bundles, contracts, and stops fan out to the right.
- Keep wide spacing between rays so circles do not sit on top of each other.
- Collapse low-importance repeated nodes into expandable groups.
- Keep manual node drag and per-job saved positions.

This gives every mode a recognizable shape while keeping the fast-check style the user likes.

## Default Dense View

When a graph is dense, the default view becomes **Fan overview**.

A graph should be treated as dense when it crosses a practical readability threshold such as:

- many visible nodes;
- many visible edges;
- many repeated bundle/service/context edges;
- or measured node/label collisions after initial layout.

The exact threshold can be tuned during implementation. The behavior should be deterministic, not random.

In Fan overview:

- show the subject wallet;
- show the most important incoming neighbors by amount and relevance;
- show the most important outgoing neighbors by amount and relevance;
- show important services, bridges, CEX, DEX, contracts, bundles, and stops;
- collapse less important repeated nodes into group chips such as `+14 bundles` or `+12 small funders`;
- keep group chips clickable so the user can expand them;
- keep the selected path and selected node clearly highlighted;
- dim unrelated nodes and edges on selection.

## Show All Mode

Add a `Show all` toggle for dense graphs.

When enabled:

- all nodes are visible;
- collapsed groups expand;
- the graph switches from compact fan overview into a wider timeline-lane layout;
- nodes are spread by step/time and category so they do not stack on top of each other;
- users can pan, zoom, and drag nodes;
- saved manual positions remain scoped to the current job;
- `Reset layout` clears manual positions for that job.

Show all is for detailed inspection. It does not need to be the first view.

## Timeline And Time Display

Do not put timestamp text as a second line inside the dark amount pill on edges.

New rule:

- edge labels show short amounts only on important edges;
- time appears in a timeline strip at the bottom of the graph;
- selected edge details in the right analytics rail show the full timestamp, gap, tx, amount, from, and to;
- hover/title text can include the full time, but the canvas should stay clean.

This keeps the graph readable while preserving time context.

## Edge Labels

The current amount/time pill is too visually heavy in dense graphs.

New rule:

- important amount labels are short, for example `64K`, `250K`, `19.9K`;
- labels appear only on important edges in default mode;
- full amounts stay in the right analytics rail and transfer table;
- inferred/context edges should usually avoid canvas labels unless selected;
- selected edges may show a more visible label.

## Peer Links Layer

Add a separate layer named **Peer links**.

This layer shows connections between neighboring wallets and services, not only links between the subject wallet and each neighbor.

Purpose:

- reveal when neighbors are connected to each other;
- reveal clusters around CEX, services, bundles, or repeated funders;
- reveal alternative routes and loops;
- help the analyst understand that the graph is not just a star around the subject.

Default behavior:

- peer links are visible but quiet in the default fan overview;
- they should use a distinct style from main money-flow edges;
- they should not overpower the main subject-centered fan;
- peer links can be toggled off if the graph becomes too noisy.

Selection behavior:

- selecting a node highlights that node's peer links;
- selecting a service highlights wallets connected through that service;
- selecting a path highlights peer links that belong to or explain that path;
- unrelated graph elements dim;
- the right rail shows a `Connected neighbors` block with address, amount, time, tx, and relation.

## Layout Rules

The graph should use category zones:

- center: subject wallet;
- left fan: important incoming/source wallets;
- right fan: outgoing wallets, services, contracts, bundles, stops;
- lower strip: timeline;
- optional outer area: expanded low-importance groups.

Collision rules:

- circles must not overlap;
- labels should not sit directly on top of other labels or circles;
- group chips should reserve enough space;
- expanded show-all mode should prefer a larger map over compressing nodes into a small area;
- edge curves should be spread so repeated transfers do not hide each other.

## Mode-Specific Behavior

Fast check:

- keep the fast-check fan shape as the natural default;
- show direct incoming and outgoing neighbors;
- show services/boundaries on the right or lower-right;
- peer links can show relationships among the direct neighbors if the data exists.

Deep check:

- use fan overview when dense;
- direct neighbors stay near the subject;
- important second/third-hop context is shown as grouped branches, not stacked over first-hop nodes;
- show all expands into timeline lanes.

Where is money:

- default focuses on main money route, key source funders, subject, services, and stops;
- low-importance bundle members collapse;
- show all expands into a route timeline.

Incoming deposit:

- default focuses on deposit-origin route;
- stop nodes and missing previous-transfer points stay visible;
- show all expands the route and its context.

## Right Analytics Rail

The right rail should become the reading surface for detail.

Add or improve these blocks:

- selected node;
- selected flow;
- connected neighbors;
- top incoming;
- top outgoing;
- top services/contracts/bridges;
- boundary stops;
- projection gaps;
- selected timeline bucket.

Full addresses and full timestamps belong here, not on the crowded canvas.

## Controls

Dense graph controls should include:

- `Fan overview` or default layout state;
- `Show all`;
- `Peer links`;
- existing flow filter;
- existing amount mode, but default should be less noisy;
- `Reset layout`;
- graph search.

The controls should remain compact and not create toolbar overlap.

## Out Of Scope

- Backend forensic logic changes.
- Telegram bot UI changes.
- Copying Arkham code or assets.
- Replacing the whole SVG renderer with a large graph library before proving the current approach cannot handle this.
- Changing risk scoring.

## Acceptance Criteria

- Dense graphs open in a fast-check-like fan overview by default.
- Important nodes are readable without circles overlapping.
- Low-importance repeated nodes can collapse into groups.
- `Show all` expands groups into a wider timeline-lane map.
- Important edge labels show short amounts only.
- Time is shown through a timeline strip and selected-item details, not as ugly second-line text on every edge.
- Peer links show connections between neighboring wallets/services.
- Selecting a node, service, path, or edge highlights relevant peer links and dims unrelated graph elements.
- The right rail shows connected-neighbor details with full addresses, timestamps, amounts, and tx links.
- Manual node drag and reset layout still work.
- Existing admin job history and graph loading continue to work.
- Existing tests pass, with focused tests added for dense mode controls and rendering contracts.
