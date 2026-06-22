# Admin Graph UX Rails Design

## Goal

Make the admin forensic graph easier to read and control:

- Jobs/history on the left.
- Wallet analytics and selected item details on the right.
- Graph stays in the center as the main workspace.
- Nodes and edges should be easier to follow, especially on dense jobs.
- Manual node movement should be possible without losing the default investigation shape.

This applies only to the admin forensic console.

## Approved Direction

Use layout A from the visual mockup:

- Left rail: job history, filters, search, refresh.
- Center: graph canvas, graph toolbar, search, counters, timeline.
- Right rail: case brief, selected flow/node details, top incoming, top outgoing, top services, boundary stops.

The selected flow card must not float over the Jobs list. It belongs in the right analytics rail.

## Layout Rules

The admin screen should use three stable areas:

- Left Jobs rail: fixed width on desktop, scrolls independently.
- Center graph workspace: takes the remaining width and keeps pan/zoom.
- Right analytics rail: fixed width on desktop, scrolls independently.

The graph toolbar must stay clean:

- Controls are vertically centered.
- Button text stays on one line.
- Counters use compact labels such as `nodes: 87`, `edges: 110`, `paths: 156`.
- When the center area is wide enough, controls and counters can share one row.
- When the center area is narrow, controls stay on the first row and counters move to a compact second row, right-aligned.
- Toolbar content must never overlap or stick to the top/bottom borders.

On smaller widths, side rails may collapse later, but desktop is the current priority.

## Graph Shape By Check Type

Each check type should keep a recognizable shape.

Fast check:

- Subject wallet in the center.
- Incoming neighbors fan to the left.
- Outgoing neighbors fan to the right.
- Services, contracts, bridges, and boundary stops sit lower/right, separated from normal wallets.

Deep check:

- Subject wallet remains the anchor.
- Direct neighbors stay near the subject.
- Further-hop context is shown in lanes or rings, not stacked on top of the first hop.
- Services and boundary stops are separated so they do not look like ordinary wallets.

Where is money and incoming deposit:

- Path-like checks use lanes by step.
- Earlier hops stay on the left, later hops move right.
- Missing or boundary stops are shown as separate stop nodes, not overlapping real addresses.

## Node And Label Readability

The renderer should reduce visual collisions before drawing:

- Do a small collision pass after the default layout is computed.
- Keep subject, services, and path-critical nodes more stable than low-importance neighbors.
- Push labels away from nearby nodes and from the edge direction.
- Avoid placing one address label directly on another address or node.

This does not need a heavy graph engine. A simple deterministic layout plus a small spacing pass is enough.

## Manual Node Movement

Users should be able to drag address circles on the graph.

Rules:

- Dragging a node moves only that node.
- Pan/zoom still works when dragging the empty canvas.
- Moved node positions are saved per job in browser storage.
- Reloading the same job restores moved positions.
- `reset layout` clears saved positions for the current job.

This keeps the default shape but lets an analyst untangle a crowded area.

## Edge Readability

Edges should make direction and importance easier to scan:

- Incoming and outgoing edges keep different colors.
- Important amount edges can be thicker.
- Selected edge or selected path is highlighted while unrelated edges dim.
- Curved edges should spread enough that repeated transfers do not hide each other.
- Amount labels should appear only where they help, not on every edge by default.

## Right Analytics Rail

The right rail is the place for reading details:

- Case brief.
- Selected flow.
- Selected node.
- Top incoming.
- Top outgoing.
- Top services/contracts/bridges.
- Boundary stops and projection gaps.

When nothing is selected, the right rail shows the job summary. When a node or flow is selected, it shows that selected item above the summary.

## Address Display Rules

Use full addresses in detail contexts:

- Subject wallet in the case brief.
- Selected node.
- Selected flow `from` and `to`.
- Raw transaction details.

Full addresses should be clickable Tronscan links for Tron addresses. They should also be copyable through normal text selection.

Use shortened addresses in dense scan contexts:

- Jobs list cards.
- Top incoming and top outgoing lists.
- Transfer tables.
- Graph labels.

The shortened format should keep both ends of the address, for example `TFcs8oa...te6NwCy`.

## Left Jobs Rail

The left rail is the place for history:

- Status filter.
- Check-type filter.
- Search by job id, address, tx hash, watched wallet.
- Latest count selector.
- Refresh and auto-refresh controls.
- Job cards with status, kind, time, and short address.

This preserves old runs in the admin UI and makes switching between checks fast.

## Error And Partial Data Handling

Partial jobs should still render whatever graph data exists.

If a graph has too little data:

- Show the subject node if available.
- Show a short empty-state message in the graph area.
- Keep the job visible in the left rail.
- Keep raw job summary available in the right rail.

If saved node positions are broken or refer to missing nodes, ignore only those saved entries.

## Out Of Scope

- Copying Arkham code or assets.
- Rebuilding the graph engine from scratch.
- Backend forensic logic changes.
- Telegram bot UI changes.
- Mobile-first redesign.

Arkham is only a visual and workflow reference.

## Acceptance Criteria

- Jobs are on the left.
- Analytics and selected details are on the right.
- Selected flow details never cover the Jobs list.
- Toolbar text is centered and never overlaps.
- Fast check, deep check, where-is-money, and incoming-deposit jobs keep different readable graph shapes.
- Dense graphs have fewer node and label overlaps than the current UI.
- Users can drag nodes and reset the layout.
- Saved node positions are scoped to the selected job.
- Detail panels show full clickable Tron addresses, while dense tables and graph labels use shortened addresses.
- Existing admin job history still loads.
- Existing tests pass, with added focused checks for the new admin layout behavior.
