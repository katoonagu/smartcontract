# Admin Deep Check Wallet Clusters Design

Date: 2026-06-27

## Goal

Make `address_deep_check` readable as a multi-step wallet-cluster investigation, not only as a dense branch map around the checked wallet.

The analyst should first see the structure:

- which ordinary wallets are connected to the checked wallet;
- which ordinary wallets are connected to each other;
- which wallets act like intermediates, collectors, mules, or one-off addresses;
- where a real wallet-to-wallet chain continues for 2-3 hops;
- where the chain reaches a CEX, DEX, bridge, contract, service, or history boundary;
- what is a proven transfer, what is grouped context, and what is only an investigation limit.

This design is only for `address_deep_check`.

## Relationship To Existing Work

This design builds on the existing admin graph work:

- `Deep branch map` already gives DeepCheck a multi-hop layout mode.
- `Peer links` already exist as a toggle.
- `Show all raw` already exists as an audit escape hatch.
- role metadata already exists through `nodeIntelligence`.
- boundary and evidence details already exist in the right rail.
- DeepCheck coverage details already exist in the graph summary.

The missing piece is a clearer default reading layer.

`Deep branch map` is useful, but dense jobs can still look like a technical dump: many edges, many labels, service boundaries mixed near wallet paths, and unclear wallet-to-wallet structure. `Wallet clusters` should become the default semantic view for dense DeepCheck jobs, while `Deep branch map` and `Show all raw` remain available for full inspection.

## Current Problem

DeepCheck may have enough data to show more than:

```text
subject -> neighbor
neighbor -> subject
```

It may have paths and context such as:

```text
wallet A -> wallet B -> wallet C -> subject
subject -> wallet A -> wallet B -> CEX
wallet A -> wallet B
wallet A -> wallet C
wallet B -> wallet C
```

The current canvas can contain some of this data, but it often does not read as a wallet cluster. The analyst sees a star, a branch cloud, or boundary dots, but not the operational shape:

- who funded whom;
- who collected from several wallets;
- which neighbors interacted with each other;
- which wallets share the same service exit;
- which parts are real transfers and which parts are context;
- where the investigation stopped because history was missing.

## Recommended Direction

Use **Wallet clusters** as the default view for dense `address_deep_check` graphs.

Default behavior:

- ordinary wallets and wallet-to-wallet chains stay in the main canvas area;
- service, exchange, bridge, contract, and history-stop nodes sit in boundary zones;
- important wallet-to-wallet paths are visible first;
- peer links are visible but visually secondary;
- low-priority repeated detail is grouped;
- transaction labels default to important/auto on dense graphs, with `All` still available;
- wallet labels default to smart mode;
- `Show all raw` remains available and can be messy by design.

This is a presentation and projection improvement. It must not change DeepCheck fetching, scoring, or risk decisions in the first implementation pass.

## Graph Layers

### Layer 1: Subject Neighborhood

This is the first circle around the checked wallet.

It shows:

- direct incoming wallets;
- direct outgoing wallets;
- direct services or boundaries if they are part of the checked wallet's immediate context;
- the subject wallet as the main selected investigation target.

This layer answers:

```text
Who directly touched the checked wallet?
```

### Layer 2: Expanded Wallets

This layer shows important ordinary wallets beyond the first circle.

Examples:

```text
source -> intermediate -> direct counterparty -> subject
subject -> direct counterparty -> next wallet
```

The UI should prefer real wallet-to-wallet transfers when the data has concrete tx evidence.

This layer answers:

```text
What happened before or after the direct neighbor?
```

### Layer 3: Wallet Clusters

This layer shows relationships between ordinary wallets.

Cluster evidence can come from:

- direct wallet-to-wallet transfers;
- several wallets funding the same wallet;
- one wallet collecting from several wallets;
- repeated peer links among subject neighbors;
- shared service exits.

This layer answers:

```text
Are these wallets independent, or do they look connected?
```

### Layer 4: Boundaries

Service and stop nodes should not be mixed into ordinary wallet clusters.

Boundary nodes include:

- CEX;
- DEX;
- bridge;
- contract;
- router;
- GasFree account;
- service;
- clean CEX reached;
- history incomplete;
- history not fetched;
- API or page limit reached;
- no previous funding found.

This layer answers:

```text
Where did the investigation reach an infrastructure boundary or data limit?
```

## Evidence Types

The UI must keep evidence types explicit.

### Proven Transaction

There is a concrete on-chain transfer between two visible endpoints.

Canvas:

```text
solid transfer line
amount and time when label mode allows it
```

Right rail:

- tx hash;
- from;
- to;
- amount;
- timestamp;
- gap when available;
- whether it is part of the selected path or only context.

### Grouped Real Transfers

Several real transfers are grouped into one visible relationship.

Canvas:

```text
12 tx - 332.8K USDT
```

Right rail:

- transfer count;
- total amount;
- time range;
- top underlying transfers;
- action to show all transactions when available.

### Peer Link

Two visible wallets interacted with each other, but this is secondary to the main subject path.

Canvas:

- thin;
- low opacity;
- dashed or secondary color;
- highlighted when either endpoint is selected.

Right rail:

- transfer count;
- total amount if available;
- period;
- from/to examples.

### Shared Service Exit

Several wallets reached the same service or boundary.

Example:

```text
3 wallets -> Bybit - 420K USDT
```

This is not proof that the wallets are the same actor. It is a context signal.

Right rail must say:

```text
Shared service exit. This can indicate common behavior or infrastructure, but it is not proof of common ownership by itself.
```

### Funding Cluster

Several wallets fund one wallet, or one wallet collects from several wallets.

Example:

```text
Group: 3 funders -> wallet D -> subject
```

Right rail:

- member count;
- known member wallets;
- total amount;
- time range;
- internal links if known;
- external links if known;
- whether the group can be expanded.

### Context Boundary

DeepCheck reached a service, exchange, contract, bridge, or stop through summarized context rather than one visible direct transfer.

Canvas should not show plain `amount n/a` when aggregate evidence exists.

Use:

```text
context - 12 tx - 332.8K USDT
```

or:

```text
context - amount not available for projected edge
```

Right rail explains the underlying evidence and limitation.

### History Stop

The investigation stopped because the needed history was not fetched or not found.

This is a coverage limitation, not proof of bad origin.

Right rail must explain likely causes:

- address is very active;
- provider or index did not return the needed history segment;
- page or request budget was reached;
- no reliable earlier funding transfer was found before the hop being checked.

## Layout Model

### Main Wallet Area

Ordinary wallets live in the center of the graph.

The layout should prefer readable chains over a single dense fan:

```text
sources -> intermediate wallets -> direct counterparty -> subject -> outgoing wallets
```

Important counterparties can have local fan branches, but the fan should originate from the relevant wallet, not always from the subject.

### Cluster Lanes

Clusters should be arranged so their role is readable:

- funders sit before the wallet they fund;
- collectors sit after wallets that send to them;
- peer-linked wallets sit near each other;
- repeated low-priority wallets can collapse into group nodes.

### Boundary Zones

Boundary nodes sit to the side of the relevant branch:

- close enough to understand what branch reached them;
- far enough not to cover ordinary wallet chains;
- never mixed into the main wallet cluster.

### Raw Mode

`Show all raw` can keep the existing dense/raw behavior.

It is not the default reading experience. It is the audit mode.

## Node Rules

Every wallet node should be able to show:

- address;
- short label;
- hop depth from subject;
- role if known;
- risk score if available;
- incoming volume if available;
- outgoing volume if available;
- tx count if available;
- whether it was expanded or only observed.

The UI must not imply that every node has a full independent risk score. If a wallet only inherits context from the selected job, the right rail should say that clearly.

Example:

```text
This wallet was observed in the DeepCheck graph. It does not have a standalone completed check in this job.
```

## Edge Rules

Every edge should have one clear type:

- direct transfer;
- grouped transfers;
- peer link;
- shared service exit;
- funding cluster link;
- context boundary;
- history stop;
- inferred/profile context.

Canvas styling should make these types visually different:

- solid = direct transfer;
- thin dashed = peer link or inferred context;
- orange/yellow dashed = boundary or stop;
- service color = service boundary;
- dark/red accent = hard-risk evidence.

The right rail remains the final explanation source.

## Controls

DeepCheck controls should include:

- `Graph: Wallet clusters / Deep branch map / Show all raw`;
- `Tx labels: Auto / Important / All / Selected / Off`;
- `Wallet labels: Smart / Important / All / Off`;
- `Services: On / Off`, default `On`;
- `Peer links: On / Off`;
- `Role marks: On / Off`, default `On`;
- `Expand selected`;
- `Reset layout`.

For dense DeepCheck jobs, `Wallet clusters` should be the default graph mode.

## Expand Behavior

### Expand Wallet

When the selected item is an ordinary wallet and expansion data exists:

- reveal stored neighboring wallets;
- reveal wallet-to-wallet links;
- reveal service exits for that wallet;
- keep the rest of the graph stable.

If no expansion data exists:

```text
No stored expansion data for this wallet.
The right rail shows the available DeepCheck context.
```

### Expand Cluster

When selecting a group or funding bundle:

- show member wallets if stored;
- show internal links if stored;
- show external links to subject, peers, or boundaries;
- preserve the group summary in the right rail.

### Expand Boundary

When selecting a boundary:

- show representative wallet paths that reached it;
- show top underlying transfers if stored;
- do not pretend the boundary is a normal wallet.

## Default And Fallback Behavior

Default for dense `address_deep_check`:

```text
Wallet clusters
Services on
Peer links on
Role marks on
Tx labels auto or important
Wallet labels smart
```

Fallback for sparse `address_deep_check`:

```text
Wallet clusters may look similar to the current branch map, but still uses boundary zones and right-rail evidence explanations.
```

Fallback when data is missing:

```text
The graph shows what was stored. It does not invent missing tx, amount, or history.
```

## Non-Goals

- Do not rewrite DeepCheck fetching.
- Do not increase provider request budgets.
- Do not change scoring.
- Do not infer wallet ownership from shared service exits.
- Do not rewrite the admin console to React in this phase.
- Do not change `incoming_deposit_check` or `where_is_money_check`.
- Do not hide raw data permanently; keep `Show all raw`.

## Acceptance Criteria

- Dense `address_deep_check` jobs open in a readable wallet-cluster view instead of a raw branch cloud.
- Ordinary wallets and wallet-to-wallet chains are visually separate from service/boundary nodes.
- Important 2-3 hop wallet paths are visible when stored in the job data.
- Peer links show neighboring-wallet relationships without dominating the main path.
- Shared service exits are labeled as context, not ownership proof.
- Funding clusters can be selected and explained.
- Boundary and history-stop nodes explain why the path stopped.
- `Show all raw` still exposes the full technical graph.
- The right rail clearly distinguishes proven transaction, grouped transfers, peer link, shared service exit, funding cluster, context boundary, and history stop.
- Sparse jobs still render correctly.
- No scoring behavior changes.

## Spec Self-Review

- No unresolved filler text remains.
- Scope is limited to `address_deep_check`.
- Existing DeepCheck, scoring, fetching, incoming deposit, and where-is-money behavior are explicitly out of scope.
- The design extends existing `Deep branch map` work instead of replacing raw inspection.
- The design does not ask the UI to invent missing amounts, transactions, or wallet risk scores.
