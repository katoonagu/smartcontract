# Admin Deep-Check Local Orbit Layout Design

## Goal

Make `address_deep_check` graphs readable when they contain many neighbor hops.

The current deep-check flow map can become one oversized figure around the checked wallet. That makes zoom-out unreadable and makes the graph feel like every relationship belongs directly to the subject wallet. The desired shape is different: a readable route spine where important intermediate wallets can each have their own small circular branch cluster.

This design is only for `address_deep_check`.

## Scope

Apply the new layout only when the selected job kind is `address_deep_check`.

Do not change the layout behavior of:

- `incoming_deposit_check`
- `where_is_money_check`
- fast-check graphs
- raw/show-all views for other modes

If implementation touches shared graph helpers, it must preserve the current behavior of those other modes and include regression checks for that boundary.

## Non-Goals

- Do not change investigation logic or scoring.
- Do not invent missing amounts or timestamps.
- Do not reinterpret deep-check neighbor hops as money-origin proof.
- Do not migrate the admin console to React as part of this task.
- Do not redesign incoming deposit or where-is-money graphs in this task.

## Mental Model

The analyst should read deep check as:

```text
checked wallet -> important neighbor hop -> local branch context
```

Not as:

```text
all known wallets explode from the checked wallet
```

The checked wallet remains visually important, but it is not the only hub. Other important wallets along the investigation path may become local hubs with their own branch circles.

## Layout Shape

Use a **route spine + local orbit branches** model.

### Route Spine

The route spine is the main readable path through the graph.

Rules:

- Place the checked wallet and the most important connected wallets along a soft route line.
- Preserve transfer direction with arrows.
- Keep opposite-direction transfers between the same wallets separated, not stacked on the same curve.
- Keep amount/time labels attached to their own edge.
- Prefer a compact readable route over a huge subject-centered fan.

### Local Orbit Branches

For each important spine wallet, collect side relationships that belong to that wallet and place them around that wallet in a small local orbit.

Examples of local branch content:

- neighboring wallets that transacted with that intermediate wallet
- peer links between nearby wallets
- service exposure related to that step
- local group/bundle context
- boundary stops related to that step

Rules:

- Branches should be short and close to their anchor wallet.
- Branches should not cross the main route when a nearby upper/lower slot is available.
- Local branch circles can be above, below, or around the anchor, depending on available space.
- When many small nodes belong to one anchor, collapse low-priority items into a local group near that anchor instead of one global bundle far away.

## Groups And Bundles

Deep-check groups must be visually treated as grouped context, not as real wallets.

Rules:

- Display them as group nodes with the existing group color treatment.
- Place them near the wallet or step they explain.
- If a group can be expanded, `Expand selected` should reveal the real wallets in the same local area.
- If a group cannot be expanded because the backend did not provide members, the right rail should clearly say that no expandable members were returned.
- Group labels should prefer `Group: N wallets` plus amount when available.

## Services And Boundaries

Service and boundary nodes should not drift to the far edge of the whole graph unless they truly explain the global route end.

Rules:

- CEX, DEX, bridge, router, contract, and boundary nodes attach to the nearest meaningful spine wallet or local hub.
- Boundary stops sit outside the main route, but close enough that the line and label are readable.
- Service toggles in deep check should hide/show these service-context nodes without changing the underlying route spine.

## Edge Labels

Deep-check edge labels should follow the readable label rules already introduced for graph cleanup:

- If amount exists, show amount.
- If time or gap exists, show the selected time/gap line.
- If amount does not exist, do not invent it; show only available time/gap.
- Label color should match the edge role, not the opposite direction.
- Label boxes should be collision-adjusted after layout so they do not cover nodes or each other.
- Labels for direct and reverse transfers between the same pair must sit on separate curves.

## Viewport Behavior

Deep-check local-orbit mode needs better navigation because the graph may still be wider than one screen.

Rules for deep-check local-orbit views:

- Wheel zoom should zoom toward the cursor.
- Dragging the background should pan immediately without text selection.
- Zoom range should be wider than the current practical range so analysts can inspect dense areas.
- `Fit route` should be the default fit behavior for deep-check local-orbit graphs.
- `Fit all` should remain available when the analyst wants the entire graph.
- `Fit selection` should focus the selected wallet, group, or edge.
- The UI should show current zoom level or at least make reset/fitting predictable.

If viewport handlers are shared with other graph modes, implementation should avoid behavior changes outside deep check unless a regression test confirms current behavior is preserved.

## Controls

Deep-check graph controls should include:

- `Fit route`
- `Fit all`
- `Fit selection` when something is selected
- `Reset layout`
- `Peer links on/off`
- `Services on/off`
- `Show all raw` for the existing raw graph escape hatch

`Show all raw` should not become the default for dense deep-check graphs. It is the analyst escape hatch when they explicitly want every raw node.

## Data Flow

Use the existing graph job payload. The new layout is a projection layer over existing data.

Inputs:

- job kind
- nodes
- edges
- paths
- selected node/edge
- service/group/boundary labels
- amount/time/gap fields when present

Output:

- positioned nodes
- routed edges
- collision-adjusted labels
- local group expansion state
- viewport fit bounds for route and all nodes

No new backend field is required for the first implementation. If later analysis needs stronger grouping, that should be a separate backend/data-design task.

## Testing

Add focused admin graph tests for:

- `address_deep_check` uses local-orbit layout when dense.
- `incoming_deposit_check` does not switch to local-orbit layout.
- `where_is_money_check` does not switch to local-orbit layout.
- opposite-direction edges remain separated in deep check.
- labels avoid node boxes in the common vertical pair case.
- `Expand selected` gives a clear no-members message when no group members exist.
- service toggle affects deep-check service nodes in local-orbit mode.

Manual QA should include:

- a dense `address_deep_check` job with many direct neighbors
- a deep-check job with reverse transfers between the same pair
- a deep-check job with group/bundle nodes
- a deep-check job with service and boundary stops
- one incoming-deposit job and one where-is-money job to confirm they did not change

## Acceptance Criteria

- Deep-check dense graphs no longer render as one giant subject-centered figure.
- Important intermediate wallets can visually own their own local branch clusters.
- The analyst can follow the main deep-check route without labels covering nodes.
- Reverse transfers between the same wallets are visually distinct.
- Groups sit near the wallet or step they explain.
- Service and boundary nodes are readable and not thrown far away from their anchor step.
- `incoming_deposit_check` and `where_is_money_check` keep their current graph behavior.
