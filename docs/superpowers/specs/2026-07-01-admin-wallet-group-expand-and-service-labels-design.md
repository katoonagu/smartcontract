# Admin Wallet Group Expand And Service Labels Design

## Context

In `where_is_money_check`, collapsed wallet groups can be confusing after expansion. The current `Expand selected` behavior for ordinary collapsed groups switches the graph to `show_all`, so the user can see both a grouped aggregate and the member wallets/edges at the same time. That makes one grouped transfer look like duplicate transfers.

One observed case is `TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9`, which should be shown as KuCoin/service context rather than as an ordinary wallet. The fix must apply generally to known services, not as a one-address special case.

## Goals

- Expand and collapse a wallet group with a double-click.
- Keep a selected-group button path: `Expand selected` should use the same toggle behavior.
- When a wallet group is open, keep the group node visible only as a muted collapse handle.
- Hide aggregate/collapsed group edges while that group is open so member edges do not appear duplicated.
- Show expanded members near the group and preserve their real semantic role.
- Known services inside groups, including CEX/exchange, bridge, DEX/router, contract, and service-boundary entities, must render as service/exchange context instead of ordinary wallets.

## Non-Goals

- No scoring/risk changes.
- No provider, collector, or graph expansion changes unless UI metadata is demonstrably missing.
- No dashboard redesign. This is a focused graph behavior fix.
- No one-off KuCoin address allowlist in the UI.

## UX Behavior

Collapsed state:

- The graph shows the purple wallet group node and its aggregate edges.
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
- An opened group keeps a group handle but hides aggregate group edges.
- Member nodes are shown once, without duplicate aggregate/member transfer lines.
- Known service members inside an opened group are classified as service-like and receive semantic service labels.

Run at minimum:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts
```

If `forensicsGraph.ts` changes, also run:

```powershell
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts
```
