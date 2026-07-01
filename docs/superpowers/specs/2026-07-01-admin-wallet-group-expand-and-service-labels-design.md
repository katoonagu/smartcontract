# Admin Wallet Group Expand And Service Labels Design

## Context

In `where_is_money_check`, collapsed wallet groups can be confusing after expansion. The current `Expand selected` behavior for ordinary collapsed groups switches the graph to `show_all`, so the user can see both a grouped aggregate and the member wallets/edges at the same time. That makes one grouped transfer look like duplicate transfers.

One observed case is `TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9`, which should be shown as KuCoin/service context rather than as an ordinary wallet. The fix must apply generally to known services, not as a one-address special case.

The graph can also show `Group: 1 wallets`, which is not useful as a collapsed group. It adds an extra purple node and aggregate line around a single real wallet, making the graph harder to read.

Where-is-money graphs currently mix solid green money-flow lines with dashed gray, orange, and purple-gray lines for related transfer evidence. When those lines represent the same sender, receiver, time, and amount family, users read them as duplicate transactions. The graph needs one visual truth for real money movement, with context/grouped evidence moved into details or clearly secondary styling.

The same visual confusion appears in `address_deep_check` around gas-free or contract-mediated transfers. A GasFree/service account, a contract, and the subject can be drawn as a loop or triangle with duplicated 50K transfer labels, even though the readable story should be service/gas-free actor -> contract -> subject. This is similar to the previous smart-contract lane issue: contract-mediated context should be separated from ordinary wallet transfer lines.

Dense CEX/service nodes such as Bybit can also fan out dozens of dashed context lines across the graph. Those lines are useful evidence, but they should not dominate the canvas or look like many direct wallet transfers when the selected node/right rail already holds the transaction list.

## Goals

- Expand and collapse a wallet group with a double-click.
- Keep a selected-group button path: `Expand selected` should use the same toggle behavior.
- Do not render single-member wallet groups as collapsed group nodes.
- When a wallet group is open, keep the group node visible only as a muted collapse handle.
- Hide aggregate/collapsed group edges while that group is open so member edges do not appear duplicated.
- Show expanded members near the group and preserve their real semantic role.
- Known services inside groups, including CEX/exchange, bridge, DEX/router, contract, and service-boundary entities, must render as service/exchange context instead of ordinary wallets.
- In `where_is_money_check`, avoid drawing multiple visually competing edges for the same real transfer evidence.
- Make where-is-money edge styling consistent: real money movement should use one primary style; inferred/context/grouping-only lines should be visibly secondary and should not look like separate transfers.
- In `address_deep_check`, avoid contract-mediated transfer loops: draw gas-free/service -> contract -> subject context as a separated route, not as multiple equal wallet-transfer edges between all three endpoints.
- Labels on visible grouped/context edges must be consistent. If similar dashed lines show `3 tx`, `50K`, or a date, the contract/service-context dashed line should also show the meaningful count/amount/date or be intentionally unlabeled as secondary context.
- Dense CEX/service fan-in should be summarized or visually deemphasized so the service node does not create a wall of equal dashed lines.

## Non-Goals

- No scoring/risk changes.
- No provider, collector, or graph expansion changes unless UI metadata is demonstrably missing.
- No dashboard redesign. This is a focused graph behavior fix.
- No one-off KuCoin address allowlist in the UI.

## UX Behavior

Collapsed state:

- The graph shows the purple wallet group node and its aggregate edges.
- A group with exactly one hidden wallet is not collapsed; the single member is shown directly.
- Single-click selects the group and shows group details.
- Double-click opens the group.
- `Expand selected` opens the selected group.

Expanded state:

- The group node stays visible as a muted collapse handle.
- Aggregate edges attached to that opened group are hidden.
- Member nodes and their real member edges become visible.
- Double-click on the group closes it.
- `Expand selected` closes it when the selected group is already open.

The muted group handle should not look like another wallet participant. Its label should make clear that it is an open group/collapse handle.

## Where-Is-Money Edge Semantics

For `where_is_money_check`, the canvas should prioritize the real transfer path over historical/context overlays:

- A direct transfer with stored transaction evidence is the primary money-flow edge.
- A grouped transfer that only aggregates the same underlying transactions should not be drawn as a second equal edge beside the direct transfer. It should either be merged into the selected-flow details or shown as secondary metadata on the primary edge.
- Inferred provenance, behavioral/service exposure context, and grouped old/result edges should not use styling that looks like another real transfer.
- Solid green should mean real selected/proven money movement.
- Dashed muted gray/purple/orange should mean context, inference, or grouped summary only.
- If two visible edges have the same endpoints and overlapping tx hashes, the UI should prefer one primary visible edge and expose the other evidence in the right rail.

This is a readability rule, not a scoring rule. It should not alter the underlying evidence list or transaction details.

## DeepCheck Contract And Service Edge Semantics

For `address_deep_check`, the canvas should tell the contract-mediated story without drawing a confusing triangle:

- If a gas-free/service account, contract, and subject are connected by the same transfer time/amount/tx family, prefer the route `service/gas-free account -> contract -> subject`.
- Do not draw an additional equal direct edge from service/gas-free account -> subject when that direct edge duplicates the same contract-mediated evidence.
- Contract/service context edges should be styled as context, not ordinary wallet transfer.
- If a visible dashed context edge is kept, its label must be consistent with neighboring transfer labels: show tx count, amount, date, or a compact context label. Avoid unlabeled purple-gray dashed lines when neighboring dashed lines carry labels.
- If multiple evidence edges overlap the same endpoints and tx hashes, choose one primary visible edge and move duplicate evidence into the selected-flow details.

For dense service/CEX boundaries:

- CEX/service profile edges should be grouped or toned down when many connect to the same service node.
- The selected node panel should not say "No connected neighbor links" if visible evidence lines or transfer cards connect that service to counterparties.
- The canvas should not require reading dozens of crossing dashed lines to understand that a CEX/service is shared context rather than proof of common ownership.

## Service Classification

Expanded group members should reuse existing service semantics instead of being treated as ordinary wallets. The UI should classify a member as service-like when existing node metadata indicates:

- `kind: "service"` or contract/service node kinds.
- `displayKind` such as `cex`, `bridge`, `dex_contract`, `contract_router`, `contract_adapter`, `smart_contract`, or `service_boundary`.
- Existing boundary/service metadata such as `serviceCategory`, `serviceType`, `boundaryIdentity`, `boundaryRole`, or known entity identity.

This should cover KuCoin and other known exchanges/services when those identities are already present in the graph payload. If identity metadata is absent, this feature should not guess from a weak text label alone.

## Implementation Shape

Most work should stay in:

- `src/admin/adminConsole.ts`
- `tests/admin/adminConsole.test.ts`

If service identity is lost before the UI layer, then the implementation may touch:

- `src/admin/forensicsGraph.ts`
- `tests/admin/forensicsGraph.test.ts`

Avoid:

- `src/risk/*`
- `tests/risk/*`
- scoring matrix files
- bot/scoring text files

## Testing

Add focused tests for:

- Collapsed wallet groups no longer expand by switching the whole graph to `show_all`.
- A collapsed wallet group toggles open/closed through the selected-group path.
- A one-member wallet group is shown as its member, not as `Group: 1 wallets`.
- An opened group keeps a group handle but hides aggregate group edges.
- Member nodes are shown once, without duplicate aggregate/member transfer lines.
- Known service members inside an opened group are classified as service-like and receive semantic service labels.
- Where-is-money grouped/context edges with overlapping tx hashes do not duplicate a primary direct transfer edge on the canvas.
- Where-is-money edge classes make real transfer edges primary and context/grouping-only edges secondary.
- Address-deep contract-mediated gas-free/service routes avoid triangle duplicates and show the route as service/gas-free -> contract -> subject.
- Visible dashed grouped/context edges have consistent labels when they remain on canvas.
- Dense CEX/service boundary fan-in is grouped or visually secondary, and selected-node details do not claim there are no connected neighbors when visible evidence exists.

Run at minimum:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts
```

If `forensicsGraph.ts` changes, also run:

```powershell
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts
```
