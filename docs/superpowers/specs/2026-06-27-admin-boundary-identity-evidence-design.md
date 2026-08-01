# Admin Boundary Identity Evidence Design

Date: 2026-06-27

## Goal

Make service and boundary nodes in the admin graph readable as named entities with evidence.

The graph should not reduce a known or partially known entity to a generic label such as `CEX`, `Service`, `Bridge`, `Contract`, or `Boundary` when the system has better information. If DeepCheck or FastCheck knows that an address is probably Bybit, GasFree Account, Bridgers, HTX, Binance Hot, a bridge router, or an unknown contract boundary, the UI should show that identity, the type, confidence, and the reason.

This design is mainly for `address_deep_check`, but the same display rules should apply anywhere the admin graph shows service or boundary nodes: `address_fast_check`, `where_is_money_check`, and `incoming_deposit_check`.

## Problem

The backend already collects useful service-boundary facts:

- address metadata and tags;
- service route registry matches;
- known CEX names;
- contract profile and method signals;
- boundary exposure profiles;
- service exposure profiles;
- boundary amount, tx count, direction, and depth when available;
- evidence strings such as `tag:bybit`, `service_route:...`, `weak contract metadata`;
- optional contract LLM verdicts for ambiguous contracts.

But the admin graph can still show a generic node:

```text
CEX
Service
Bridge
Contract
Boundary
```

This loses important investigation meaning:

- the analyst cannot immediately tell whether this is Bybit, GasFree, Bridgers, or an unknown contract;
- the analyst cannot tell why the system classified it as a service boundary;
- the analyst cannot tell how confident the classification is;
- context/grouped boundary links can still look like weak or missing data instead of aggregated evidence;
- a line can show `amount n/a` even though the system has underlying transfers or aggregate volume.

## Product Principle

Service boundary display must answer four questions:

1. **Who is this?**
   Example: `Bybit`, `GasFree Account`, `Bridgers`, `Unknown contract`.

2. **What type is it?**
   Example: `CEX`, `Cross-chain bridge`, `DEX/router`, `Gasless service`, `Contract boundary`.

3. **Why did we classify it this way?**
   Example: metadata tag, registry match, known CEX keyword, contract methods, weak contract metadata, LLM contract verdict.

4. **What evidence exists in this check?**
   Example: direct transfer, grouped boundary evidence, tx count, total amount, time range, underlying transactions.

## Recommended Scope

Implement **Boundary Identity** now.

Do not build a separate `Service Map` mode yet. Do not make LLM the primary identity source yet.

The first version should:

- normalize boundary identity fields in graph projection;
- show better labels on service/boundary nodes;
- add a clear boundary identity block to the right rail;
- show grouped boundary transfers with amount, count, time, and underlying tx details when stored;
- replace unexplained `amount n/a` with a reasoned state;
- keep direct transfers, grouped evidence, and context links visually and semantically separate.

## Non-Goals

This design does not change final risk scoring.

This design does not make LLM verdicts hard facts.

This design does not attempt to identify every unknown exchange in the world.

This design does not continue public-chain provenance through a CEX, bridge, DEX, router, or other service boundary unless the system has explicit follow-on evidence.

This design does not replace `Show all raw`. Raw mode can remain noisy.

## Boundary Identity Model

Each service or boundary node should expose a normalized identity object in metadata.

Recommended shape:

```ts
type BoundaryIdentity = {
  displayName: string;
  category: "cex" | "hot_wallet" | "bridge" | "bridge_pool" | "dex" | "router" | "swap_adapter" | "service" | "protocol" | "unknown_contract" | "contract" | "unknown";
  categoryLabel: string;
  confidence: "high" | "medium" | "low";
  source: "metadata" | "provider_tag" | "public_tag" | "service_registry" | "known_cex_rule" | "contract_profile" | "method_heuristic" | "weak_contract_metadata" | "llm_verdict" | "mixed" | "unknown";
  evidence: string[];
  isBoundary: boolean;
  flowVerdict?: "legitimate_service" | "drainer_like" | "unknown_suspicious" | "unknown_insufficient_data";
  flowVerdictConfidence?: number;
};
```

Examples:

```text
displayName: Bybit
category: cex
categoryLabel: CEX
confidence: high
source: known_cex_rule
evidence: tag:bybit
isBoundary: true
```

```text
displayName: GasFree Account
category: service
categoryLabel: Gasless service
confidence: medium
source: contract_profile
evidence: tag:gasfree_service, method:permittransfer
isBoundary: true
```

```text
displayName: Unknown contract
category: unknown_contract
categoryLabel: Contract boundary
confidence: medium
source: weak_contract_metadata
evidence: weak contract metadata
isBoundary: true
```

## Identity Source Priority

When several sources exist, display should prefer the most specific reliable identity.

Priority:

1. explicit service identity from stored profile or boundary flow;
2. provider tag or public tag;
3. service route registry canonical name;
4. known CEX/service deterministic rule;
5. contract profile name;
6. category label;
7. shortened address.

The right rail should still show all available evidence sources, not only the winning display name.

## Graph Labels

Service and boundary nodes should use two-line semantic labels when labels are visible.

Examples:

```text
Bybit
CEX
```

```text
GasFree Account
Service
```

```text
Bridgers
Cross-chain bridge
```

```text
Unknown contract
Contract boundary
```

When the label is low confidence, the graph should still show it but mark it honestly:

```text
FastRouteV2?
Router-like service
```

Low-confidence labels should not look identical to high-confidence labels. Use a subtle `?`, lower opacity, or a confidence chip in the right rail.

## Visual Semantics

Node color should communicate category, not final guilt.

Recommended category colors:

- CEX / hot wallet: yellow or gold;
- bridge / bridge pool: cyan or blue;
- DEX / router / swap adapter: violet;
- GasFree / service / protocol: teal;
- unknown contract: orange;
- drainer-like or hard-risk contract: red/dark.

Line style should communicate evidence type:

- solid line: concrete direct transfer;
- dashed line: context, grouped boundary evidence, peer link, or inferred exposure;
- thicker line: larger aggregate volume;
- thinner line: weak or low-volume context.

Risk colors and role icons should remain separate from service category colors.

## Edge Evidence Rules

The UI must not hide grouped evidence behind `amount n/a`.

### Direct transfer

Use when the edge has one concrete tx.

Canvas:

```text
10K USDT · Jun 23, 12:44
```

Right rail:

- evidence type: direct transfer;
- amount;
- time;
- tx hash;
- from/to addresses;
- gap if available.

### Grouped boundary evidence

Use when the visible edge represents several stored transfers or a boundary profile with aggregated transfer evidence.

Canvas:

```text
Bybit · 12 tx · 332.8K USDT
```

or compact:

```text
12 tx · 332.8K
```

Right rail:

- evidence type: grouped boundary evidence;
- entity name and type;
- total amount;
- transfer count;
- first time;
- last time;
- direction;
- depth;
- representative path;
- underlying transfers.

Underlying transfers should show:

```text
25K USDT · Jun 23, 12:44 · tx ...
80K USDT · Jun 23, 12:48 · tx ...
14.2K USDT · Jun 23, 13:02 · tx ...
```

If there are many transfers:

- show the top 20 by amount or relevance;
- show the total count;
- show a `Show all transfers` action or collapsed list if the UI supports it.

### Context link without stored transfers

Use only when the projection has no single tx and no stored underlying tx list.

Canvas:

```text
context link
```

Right rail:

```text
This context edge was projected from service/boundary evidence, but no individual underlying transactions were stored for this visible edge.
```

If an aggregate amount exists, still show it.

If neither aggregate amount nor underlying amount exists, say:

```text
Amount not stored for this projected context edge.
```

This is better than plain `amount n/a`, because it explains what is missing.

## Right Rail: Service Node

When the selected item is a service or boundary node, the right rail should show a `Boundary identity` section.

Suggested content:

```text
Entity: Bybit
Type: CEX
Confidence: high
Source: known CEX rule / metadata tag
Evidence: tag:bybit
Meaning: exchange/service boundary. Public-chain continuity after this point is limited.

Observed in this check
- 12 transfers
- 332.8K USDT
- inbound
- depth 1-2 hops
- first seen Jun 23, 12:44
- last seen Jun 23, 13:02

Underlying evidence
- tx list
- connected wallets
- paths where this entity appears
```

For unknown contracts:

```text
Entity: Unknown contract
Type: Contract boundary
Confidence: medium
Source: weak contract metadata
Evidence: weak contract metadata
Flow verdict: unknown_suspicious / legitimate_service / not analyzed
Meaning: contract boundary; manual review required before treating this as clean or dirty.
```

## Right Rail: Boundary Edge

When the selected item is a boundary/context edge, the right rail should separate the entity from the relationship.

Suggested content:

```text
Boundary evidence: Bybit / CEX
Relationship: grouped boundary evidence
Meaning: this is not one direct transfer; it summarizes transfers that reached the boundary.

Aggregate
- 12 transfers
- 332.8K USDT
- first Jun 23, 12:44
- last Jun 23, 13:02
- depth 2 hops

Underlying transfers
...
```

If the edge is direct:

```text
Relationship: direct transfer to service boundary
```

If the edge is context-only:

```text
Relationship: projected boundary context
```

## LLM Policy

LLM should not be the main authority for naming a concrete exchange.

Do not let LLM turn an unknown address into `Bybit` as a fact unless deterministic metadata already supports it.

LLM can be used for ambiguous contracts as a verdict layer:

```text
legitimate_service
drainer_like
unknown_suspicious
unknown_insufficient_data
```

LLM can also return a suggested category:

```text
suggestedCategory: router_like_service
suggestedIdentity: unknown
confidence: 0.72
reason: verified contract, router-like methods, no exact approval-drain proof
```

UI must label this as a suggestion or verdict, not as deterministic identity.

## User-Facing Honesty Rules

The admin graph must distinguish:

- `Known entity`: identity came from deterministic labels or registry.
- `Likely service`: service-like category is inferred from metadata, methods, or behavior.
- `Unknown contract`: contract exists, but identity is weak or missing.
- `Grouped evidence`: multiple tx or flows are summarized.
- `Context link`: visible edge is projected context, not a single tx.
- `History stop`: investigation stopped due to data limits.

Never imply that funds safely continued through a CEX, bridge, DEX, router, or service boundary unless there is explicit follow-on evidence.

Never hide stored tx evidence behind `amount n/a`.

Never treat `legitimate_service` as proof that the checked wallet is clean.

## Acceptance Criteria

1. A boundary node with identity `Bybit` is labeled as `Bybit / CEX` on the graph, not just `CEX`.
2. A boundary node with identity `GasFree Account` is labeled as `GasFree Account / Service`, not just `Service`.
3. A bridge registry match is labeled as bridge identity plus bridge category.
4. Unknown contracts show `Unknown contract / Contract boundary` and explain why they are unknown.
5. The right rail shows confidence, source, and evidence for service/boundary nodes.
6. Grouped boundary/context edges show aggregate tx count and amount when available.
7. Grouped boundary/context edges expose underlying transfers with amount, time, and tx hash when stored.
8. Context edges with no stored underlying transfers explain that the visible edge is projected context.
9. Existing direct-transfer display remains unchanged except for clearer service destination naming.
10. The same identity display rules apply to DeepCheck first; FastCheck, Where Is Money, and Incoming Deposit can reuse the helpers.

## Tests

Add projection tests for:

- known CEX identity from `boundaryIdentity`;
- service identity from service exposure profile;
- unknown contract boundary with weak metadata;
- grouped boundary evidence with aggregate amount and underlying transfers;
- context edge with no stored tx list.

Add admin UI tests for:

- graph label prefers identity over generic category;
- right rail shows `Boundary identity`;
- right rail shows evidence source and confidence;
- grouped edge right rail lists underlying transfers;
- `amount n/a` is not shown when aggregate amount or underlying amount exists.

## Future Work

Later, add a separate `Service Map` mode:

- group all CEX/DEX/bridge/contracts by entity;
- show total volume and tx count per entity;
- show which wallets touched the same entity;
- separate deterministic identity from LLM verdicts.

Later, expand LLM enrichment for ambiguous contracts:

- use deterministic case file as input;
- return verdict, suggested category, confidence, and false-positive guards;
- keep deterministic identity and LLM verdict visually separate.
