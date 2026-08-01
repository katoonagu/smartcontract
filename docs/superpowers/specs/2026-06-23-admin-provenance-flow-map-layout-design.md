# Admin Provenance Flow Map Layout Design

## Goal

Make `incoming_deposit_check` and `where_is_money_check` graphs readable as provenance maps by default.

The current admin graph can contain enough useful data but still render as a confusing pile. A concrete example is job `16b15186-0bfb-4b98-b4f8-532746eb1956`: it has 32 nodes, 41 edges, 2 paths, 8 funding bundles, and 2 stops. The graph is not treated as dense because the current threshold is `nodes.length > 32 || edges.length > 50`. That means exactly this kind of investigation falls back to the older layout even though it needs the clearer provenance layout.

For provenance jobs, the default layout should be chosen by job meaning first, not only by node count.

## Default Behavior

For `incoming_deposit_check` and `where_is_money_check`, use **Flow Map** as the default graph layout.

This applies even when the graph is not technically dense by the old threshold.

`Show all raw` remains available as an explicit mode for the full uncompressed/raw graph. It should not be the default for provenance investigation jobs.

## Mental Model

The first thing the analyst should read is:

```text
where did the money come from -> how did it move -> where did the checked deposit/wallet sit -> where did the trace stop
```

The graph should not start by showing all nodes as equal circles. It should start by showing a route.

## Layout Zones

Flow Map uses stable zones:

```text
boundary / source stops     main money path                         checked wallet
        side branches       funding bundles                         final receiver
        peer links          services / boundary context             trace stops
```

Practical placement:

- Main money paths run left to right by path order and timestamp.
- The checked wallet or deposit wallet sits toward the right side of the route.
- Source/boundary stops sit on the far left or far side of the path they explain.
- Service, CEX, DEX, bridge, contract, and terminal boundary nodes sit outside the main wallet path.
- Funding bundles attach to the hop wallet they explain, usually below the path.
- Peer links sit in their own layer above or beside the main path, not through the center of every route.

The canvas can become wider and taller. More space is better than a compressed pile.

## Main Money Path

The main path is the primary visual object.

Rules:

- Use graph `paths` when available.
- For each path, place real transfer edges in chronological order.
- Keep nodes from the same path close enough that the route is readable.
- If there are multiple paths, separate them vertically.
- Shared nodes may sit between paths, but should not cause node overlap.
- The final checked deposit/subject edge should be easy to find.

For the example job, path `origin:0` should read as a long route ending in `TNMK... -> TYDaeo...`, while path `origin:1` should sit as a separate shorter route, not inside the same knot.

## Funding Bundles

Funding bundles are not ordinary wallets.

Rules:

- Render bundle nodes as attached groups near the hop wallet they fund.
- Prefer placing bundles below the main path.
- If one hop has several bundles, fan them around that hop with enough spacing.
- Bundle labels should include member count and amount when available.
- Expanding a bundle should reveal known top funders around the bundle, not on top of the main path.

The UI must visually distinguish:

- real wallet address;
- saved funding bundle;
- UI-collapsed display group.

## Peer Links

Peer links are important because they show relationships between neighboring wallets.

Rules:

- Keep peer links visible by default when `Peer links on`.
- Draw them thinner than main money-path edges.
- Route them above or around the main path where possible.
- Do not let peer links visually dominate the main transfer chain.
- Selecting a wallet should still highlight its peer links.

Peer links should answer:

```text
are these neighboring wallets connected to each other?
```

They should not obscure:

```text
how did the checked money move?
```

## Boundary And Stops

Boundary and stop nodes are investigation endpoints, not regular wallets.

Rules:

- Put `no_previous_transfer`, `clean_cex_reached`, service boundary, and similar stops at the edges of the layout.
- Keep stop labels readable.
- Draw stop edges as context/stop lines, not as primary money movement.
- Selecting a stop opens right-rail detail with the last checked hop and why the trace stopped.

## Edge Labels

Visible edges should keep amount and time readable.

Rules:

- Show compact amount and compact time on important visible edges.
- Keep amount text white and medium weight.
- Do not use yellow borders around label pills.
- Use full timestamp and full amount in the right rail.
- Use `gap`, `hold`, or `span` only when the data supports that meaning.
- Fall back to transaction time or `time n/a` when the data does not support a stronger label.

The flow map should favor clean labels over label density. If every edge label overlaps, keep all data in the right rail and show the most important canvas labels first.

## Manual Drag And Reset

Manual dragging remains part of the UX.

Rules:

- Dragging a node persists the position for that job in local storage.
- Reset layout clears saved positions and returns to Flow Map for provenance jobs.
- Manual positions should not be needed for normal readability.

The user's hand-arranged example is a reference for the default algorithm, not a one-off coordinate set to copy.

## Layout Selection

Layout choice should work like this:

1. If job kind is `incoming_deposit_check` or `where_is_money_check`, default to Flow Map.
2. If the user selects `Show all raw`, show the raw/timeline lane style.
3. If the user selects `Fan`, show fan mode.
4. Other job kinds keep their current defaults.

This avoids the current failure where a 32-node provenance job does not get the investigation layout.

## Out Of Scope

- React migration.
- Arkham code copying.
- Telegram bot UI changes.
- Risk scoring changes.
- Backend provenance algorithm changes.
- Persisting manual positions server-side.
- Automatically learning layout templates from one user's local storage.

## Acceptance Criteria

- `incoming_deposit_check` and `where_is_money_check` open in Flow Map by default.
- The example job `16b15186-0bfb-4b98-b4f8-532746eb1956` no longer opens in the old fallback layout.
- Main money paths are readable left to right.
- Multiple paths are separated vertically enough to follow each one.
- Funding bundles attach near the hop wallet they explain.
- Expanded bundle members do not cover the main route.
- Peer links remain available but do not dominate the main path.
- Boundary and stop nodes sit at path edges or side zones.
- Node-on-node overlap is avoided for normal 30-60 node provenance jobs.
- Edge labels are readable and do not use yellow-bordered amount pills.
- Reset layout returns to Flow Map for provenance jobs.
- `Show all raw` remains available for full inspection.
- Existing `address_fast_check` and `address_deep_check` defaults are not changed by this design.

## Implementation Notes

This design should mainly affect `src/admin/adminConsole.ts`.

Likely areas:

- `graphIsDense`
- `graphDisplayMode`
- `graphFirstLayout`
- `stepOrbitLayout` or a new `flowMapLayout`
- peer link rendering/routing
- bundle expansion placement
- reset layout behavior

The smallest good implementation is to add a new `flowMapLayout` and make provenance jobs default to it. Avoid a broad frontend rewrite.
