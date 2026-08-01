# Admin Forensics Graph Semantics and Allocation UI Design

Date: 2026-06-03

## Context

Admin Forensics Console currently renders several different forensic graph modes with the same visual language:

- `address_deep_check` profile graph: direct counterparties, service exposure, behavioral context.
- `where_is_money_check` money-origin trace: selected amount provenance paths.
- `incoming_deposit_check` deposit-origin trace.

This makes some correct data look wrong in the UI. For example, `TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s` is persisted with `identity = Bridgers:Cross-chain Bridge`, `category = bridge`, and `weight = 65`, but its node kind remains `wallet`, so the canvas and right panel label it as a wallet. Another example is an edge label like `81.18 USDT / 828.62K USDT`; this is technically the allocated coverage amount over the original transfer amount, but it reads like a strange transaction amount.

## Goals

1. Make service boundaries, bridges, CEXes, smart contracts, adapters, routers, bundles, and stop nodes visually obvious on the canvas and in the right panel.
2. Keep allocation data because it is useful for explaining partial coverage of large transfers.
3. Stop showing allocation as a confusing primary canvas label.
4. Make `address_deep_check` outbound/context edges clearly different from `where_is_money_check` provenance edges.
5. Preserve existing graph data shape where possible and add derived display fields instead of rewriting forensic evidence.

## Non-Goals

- Do not change scoring rules in this UI pass.
- Do not change which transfers the forensic engines select.
- Do not hide outbound profile edges from `address_deep_check`; mark them as profile/context edges instead.
- Do not add long explanatory text onto the canvas.

## Node Semantics

Graph projection should derive a semantic display kind for every node:

- `subject_wallet`
- `wallet`
- `bridge`
- `cex`
- `smart_contract`
- `contract_adapter`
- `contract_router`
- `dex_contract`
- `service_boundary`
- `funding_bundle`
- `trace_stop`

Rules:

- If a node has `metadata.category` or `metadata.serviceCategory` equal to `bridge` or `bridge_pool`, display it as `bridge`.
- If a node has exchange/CEX category, display it as `cex`.
- If a node has `unknown_contract`, `contract`, `adapter`, `router`, or `dex` markers, display it as the matching smart-contract subtype.
- If a node has stop reasons or is a stop node, display it as a boundary/trace stop.
- If a node already exists as `wallet` and later service metadata arrives, service metadata must upgrade the semantic display kind.
- The node label should prefer `metadata.identity`, then `metadata.exposureSourceLabel`, then the stored label, then a shortened address.

The existing backend `kind` may remain for compatibility, but the UI must consume the derived semantic kind for color, badge, radius, and right-panel Selected label.

## Canvas Display

Canvas labels must stay compact:

- Nodes show semantic labels such as `Bridge`, `CEX`, `Adapter`, `Router`, `Contract`, `Bundle`, or shortened wallet address.
- Service/boundary nodes use service-specific colors and badges.
- Transfer edge default amount label shows the original transfer amount only.
- If an edge has allocated coverage, the canvas must not show a verbose label like `Coverage-used amount`.
- The default canvas should not show combined labels like `81.18 USDT / 828.62K USDT`; this belongs in details.

Amount formatting:

- `< 1,000 USDT`: show exact compact amount, for example `81.18 USDT`.
- `>= 1,000 USDT`: show `K`, for example `135.3K USDT`.
- `>= 1,000,000 USDT`: show `M`, for example `1.29M USDT`.

This means `81.18 USDT` should stay `81.18 USDT`, not `81.18K`, because it is only 81.18 USDT. The UI must explain what it represents in the details panel.

## Allocation Details

The right panel for a transfer edge should separate these amounts:

- `Original transfer amount`: the real blockchain transfer amount, for example `828.62K USDT`.
- `Used for checked amount`: the portion counted toward the checked target, for example `81.18 USDT`.
- `Target coverage amount`: the checked target/anchor amount, for example `135.3K USDT`.
- `Used share of target`: for example `0.06%`.
- `Used share of transfer`: for example `0.01%`.

When the used amount differs from the original transfer amount, show a short note:

> Only this portion of the larger transfer was counted toward the checked amount; the rest was not used in this path.

Do not put this note on the canvas.

The transfer table should keep the amount column compact. If allocation exists, show the original transfer amount as the main value and expose the used amount through a tooltip/title or a secondary muted line, not as the primary label.

## Edge Semantics

Edges should expose a display role:

- `real_transfer`: actual transfer edge from trace data.
- `allocated_transfer`: real transfer where only part of the amount is used for coverage.
- `profile_context`: direct counterparty or behavioral context edge from `address_deep_check`.
- `inferred_provenance`: inferred or grouped provenance edge.
- `stop`: stop/boundary edge.

For `address_deep_check`, outbound edges from the subject are allowed because this mode is a profile graph. They must be styled and labeled as profile/context, not as money-origin proof.

For `where_is_money_check`, edges remain provenance trace edges and should not be described as profile context.

## Right Panel Copy

For a selected graph:

- Show `Projection mode: Profile graph` for `address_deep_check`.
- Show `Projection mode: Money-origin trace` for `where_is_money_check`.
- Show `Projection mode: Deposit-origin trace` for `incoming_deposit_check`.

For selected `address_deep_check` outbound edge:

- `Meaning`: `Behavioral/service exposure context`.
- `Direction`: `subject -> counterparty`.
- `This is not money-origin proof`.

For selected `where_is_money_check` edge:

- `Meaning`: `Money-origin provenance step`.
- If allocation exists, include the allocation details above.

## Testing

Add or update tests for:

- A service counterparty with `category = bridge` upgrades display semantics from wallet to bridge.
- `TPwez...`-style Bridgers node displays as bridge and keeps risk score `65`.
- Allocation edge preserves original and used raw amounts but default canvas label uses the original amount only.
- Transfer details render `Used for checked amount`, `Target coverage amount`, and both share percentages.
- `address_deep_check` outbound direct-counterparty edges are marked as profile/context.
- `where_is_money_check` provenance edges are not marked as profile/context.

## Acceptance Criteria

- Bridgers/cross-chain bridge nodes are visually marked as bridge on the canvas.
- Right panel Selected chip for Bridgers says `Bridge`, not `Wallet`.
- Smart contracts/adapters/routers are not shown as plain wallets when contract metadata exists.
- Canvas no longer shows `81.18 USDT / 828.62K USDT` as the primary edge label.
- Edge details clearly explain what `81.18 USDT` means.
- Outbound context edges in deep check are explicitly marked as profile context, so they are not confused with where-is-money provenance.
