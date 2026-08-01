# Admin Forensics Funding Bundle Dedupe Design

## Problem

Admin forensics graphs currently show funding bundle context and the same member wallet transfers at the same time. In `where_is_money_check` job `b6fe2695-a7b8-4690-99ac-4798db719f1e`, the graph contains:

- `TEPSrS... -> Funding bundle`
- `TUpHuD... -> Funding bundle`
- `Funding bundle -> TSuxWN...`
- `TUpHuD... -> TSuxWN...`
- `TEPSrS... -> TSuxWN...`

That creates a misleading triangle: member wallets appear both inside the bundle and as independent direct/context edges to the same hop. `incoming_deposit_check` has the same pattern for origin funding bundles. The visual issue is similar to the earlier contract-driven duplicate problem: the graph should show one coherent route, not both the collapsed explanation and the expanded member route at once.

A related classification gap exists when a trace reaches an allowlisted CEX. The path/stop/weight can say `Allowlisted CEX reached` or name an exchange such as KuCoin, while the source address node can still render as an ordinary wallet.

## Desired Behavior

Funding bundles are the canonical representation of a multi-input funding episode while collapsed.

When a funding bundle is collapsed:

- The bundle node owns its member funders.
- Bundle member funder nodes should not also appear as ordinary wallet nodes only because of the same funding episode.
- Edges from member funders to the bundle and bundle to target/hop remain visible.
- Duplicate member-to-hop or member-to-target edges for the same funding episode are hidden from the visible graph.
- Independent member wallet edges remain visible only if they are unrelated to the bundle episode.

When a funding bundle is expanded:

- The member funder wallets become visible.
- Member-to-bundle edges become visible.
- Duplicate member-to-hop/member-to-target edges for the same funding episode stay hidden.
- The user can inspect the member tx hashes through the bundle/member details.

For CEX root-source classification:

- If a trace result has structured or strongly implied CEX root-source evidence for a concrete address, the corresponding graph node should render as `service/cex`, not ordinary `wallet`.
- The node label should prefer the exchange identity when available, for example `KuCoin` or `KuCoin 4`.
- If the evidence is only a generic stop reason without an address-level identity, keep the stop node as the CEX explanation and do not guess the wallet node label.

## Scope

This design applies to admin graph projection and presentation for:

- `where_is_money_check` money-origin funding bundles.
- `incoming_deposit_check` origin funding bundles.
- Wallet-cluster, flow-map, show-all, and expanded-bundle presentation modes.

It does not change scoring decisions, raw forensic trace generation, or transaction fetching.

## Data Rules

Bundle member identity is derived from existing bundle metadata:

- `bundle.topFunders[].address`
- `bundle.topFunders[].txHashes`
- `bundle.memberCount`
- edge metadata with `bundleNodeId`, `bundleRole`, `txHashes`, `hopTxHash`, or `targetTxHash`

A visible non-bundle edge is considered a duplicate of a funding bundle when:

- one endpoint is a bundle member address,
- the other endpoint is the bundle target or hop address,
- and the tx hash or amount/timestamp/address tuple matches a tx represented by the bundle member metadata.

If no tx hash is available, use amount/address/timestamp matching only when all available fields agree. Ambiguous matches should remain visible rather than being hidden.

## Implementation Shape

Prefer a small graph-normalization helper near the existing admin graph projection/presentation code.

The helper should:

- collect funding bundle membership and represented transfer keys,
- mark or filter duplicate member edges,
- preserve all unrelated edges,
- work for both `money_origin_funding_bundle` and `incoming_deposit_funding_bundle`.

The CEX root-source fix should live in graph projection, not CSS:

- when constructing address nodes, carry root-source classification into node metadata when the result has address-level CEX evidence;
- let existing `nodeDisplayKind` convert that metadata into `cex`.

## Testing

Add regression tests for:

- `where_is_money_check` funding bundle hides duplicate member-to-hop edges while collapsed.
- expanded bundle still shows member funders, but not duplicate member-to-hop edges.
- `incoming_deposit_check` funding bundle follows the same dedupe rule.
- allowlisted CEX root-source address renders as `displayKind: "cex"` with exchange identity when address-level identity exists.

Existing full checks should still pass:

- `tests/admin/forensicsGraph.test.ts`
- `tests/admin/adminConsole.test.ts`
- `npm run typecheck`
- `npm test`

## Open Decision

If a bundle member also has unrelated profile-context edges to the same hop but with different tx hashes, those edges should remain visible. This keeps the dedupe conservative and avoids hiding meaningful non-bundle context.
