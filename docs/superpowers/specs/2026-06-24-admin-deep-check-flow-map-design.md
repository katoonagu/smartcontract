# Admin Deep-Check Flow Map Design

## Goal

Make `address_deep_check` graphs readable in the admin console without changing the meaning of the check.

Deep check is a profile/context investigation. It can show direct counterparties, service exposure, boundary exposure flows, inbound provenance context, and expansion stops. It is not the same as a money-origin proof route. The UI should make that distinction clear while still giving the analyst a usable graph.

The current graph can show transfers between the same two wallets in both directions on nearly the same line. Labels then stack over each other, and the analyst cannot tell which amount/time belongs to which edge. The fix is to give deep-check graphs the same readable map treatment used for provenance jobs, while keeping deep-check context visually scoped as context.

## Default Behavior

For `address_deep_check`, use **Flow Map** as the default graph layout when the graph has enough edges or paths to become visually dense.

This means deep check should no longer fall back to a plain fan/star layout just because its job kind is not `incoming_deposit_check` or `where_is_money_check`.

Explicit modes remain:

- `Show all raw`: render the full raw graph when the analyst wants every node.
- `Fan`: keep the compact neighborhood overview when useful.
- `Peer links`: show or hide wallet-to-wallet context links.
- `Services`: show or hide service/boundary context.

## Meaning Boundary

Deep-check multi-hop content must be labeled as context, not provenance proof.

Use this language in the UI:

- “Deep context flow”
- “Profile/context graph”
- “Not money-origin proof”
- “Neighbor/context step”

Do not present deep-check neighbor steps as confirmed origin paths. If the analyst needs proof of where money came from, the right mode remains `where_is_money_check` or `incoming_deposit_check`.

## Flow Map Zones

Deep-check flow map should use stable zones:

```text
incoming counterparties / source context -> checked wallet -> outgoing counterparties / services
peer links above the main context lane
service / CEX / DEX / bridge / contract boundaries near the side, not hidden far away
boundary stops at the edge of the visible route
```

Practical placement:

- The checked wallet stays near the center/right of the main context lane.
- Direct incoming and outgoing counterparties stay on opposite sides where possible.
- Service and boundary nodes sit beside the wallet lane, not inside the main wallet cluster.
- Peer links get their own upper lane so they do not cross the main route.
- Boundary stops are close enough to read, but still visually outside the main wallet path.

The canvas may be wider and taller. More whitespace is preferred over stacked nodes and labels.

## Opposite Direction Edges

Transfers between the same wallet pair must not share the same curve.

For any pair `A` and `B`:

- `A -> B` and `B -> A` get different curve sides.
- Multiple edges in the same direction get small additional offsets.
- The label for each edge is placed on that edge's own curve.
- Arrow color follows the edge role.

This specifically fixes the case where one wallet sends to the checked wallet and later receives from it. The analyst should see two distinct arcs, not one vertical stack of lines and labels.

## Edge Labels

Edge labels must remain honest:

- If the edge has an amount, show amount plus time/gap when available.
- If the edge has no amount, do not invent one. Show `amount n/a` plus time/gap when available.
- Labels should be collision-adjusted after layout so they avoid nodes and other labels.
- Label color follows the edge role: incoming, outgoing, service, stop, peer, or context.

For deep-check context edges, labels should make clear that the edge is context, not source proof, in the right rail when selected.

## Neighbor Steps And Expansion

Deep-check graph can show neighbor/context steps only if they exist in the projected graph data.

Supported expandable items:

- UI-collapsed display groups.
- Saved funding bundles.
- Known boundary/service context flows.
- Known neighbor links attached to the selected node.

`Expand selected` behavior:

- If selected item has stored members/links, expand them on canvas.
- If selected item is a display group, replace it with its hidden real nodes when possible.
- If selected item has no stored expansion data, show a clear right-rail explanation instead of doing nothing.

The UI should not imply that hidden data exists when the projection does not contain it.

## Right Rail

When selecting a deep-check edge or node, the right rail should show:

- Whether it is direct wallet interaction, service exposure, boundary exposure, peer context, or collapsed group.
- Amount, full time, gap, tx hash, and endpoints when available.
- A plain note when the edge is only profile/context.
- For groups/bundles: member count, total amount, top members, known internal links, known external links.

## Testing

Add or update focused tests for:

- `address_deep_check` can choose flow-map layout by default.
- Opposite-direction edges between the same pair receive distinct curve routing.
- Edge labels use their routed curve point, not a shared midpoint.
- Missing edge amount renders as `amount n/a`, not a fabricated amount.
- `Expand selected` has an explicit no-data explanation when nothing can be expanded.

Existing admin console tests should keep covering the shared incoming/where-is-money behavior so this change does not regress provenance graphs.

## Out Of Scope

This design does not change forensic scoring.

It does not make deep check fetch unlimited additional hops. It only improves how currently projected deep-check context is displayed and expanded. Any deeper fetch budget or new data collection policy should be a separate backend design.

## Spec Self-Review

- No unresolved placeholders.
- The design preserves the semantic boundary between deep context and money-origin proof.
- The scope is limited to admin graph projection/display behavior.
- The implementation can be tested with existing admin console string tests plus graph projection tests.
