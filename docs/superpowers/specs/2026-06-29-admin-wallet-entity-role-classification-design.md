# Admin Wallet Entity Role Classification Design

## Goal

The admin graph needs one consistent way to decide what a node is and what role it plays in an investigation.

The current failure mode is that a normal wallet can visually become `DEX`, `CEX`, `Bridge`, or `Service` because it is near that infrastructure in the graph. That is misleading. A wallet that interacted with a DEX is still a wallet unless the exact address has strong service identity evidence.

This design introduces a single classification model for DeepCheck, Where Is Money, and shared admin graph rendering:

- technical type: what the address is on-chain;
- service identity: whether the exact address is known infrastructure;
- behavioral role: what the address did in this investigation;
- evidence level: why the UI is allowed to show that role.

The product rule is:

> A node must not inherit a service identity from nearby edges. DEX/CEX/Bridge/Service labels belong only to the exact address that has service evidence.

## Problems To Fix

1. False DEX labels

   A normal wallet can appear as `DEX` because the graph has DEX/service exposure nearby. This makes the analyst think the wallet is infrastructure when it may be a victim or ordinary wallet.

2. Contract-driven transfers look like normal sends

   Approval-drain and contract-driven token movement can appear as a simple `wallet -> wallet` transfer. The graph must show when a smart contract/caller caused USDT to move.

3. Roles conflict with service types

   A node can be a wallet and still be a victim, drainer receiver, collector, or mule. Those are behavioral roles, not service types.

4. Context edges look like money flow

   If the system only has boundary/context evidence and no real transaction or grouped transaction evidence, it must not draw that relationship as money flow.

5. Old runs may not contain new evidence fields

   Old forensic jobs may predate role evidence storage. The admin UI should not pretend roles are known when the job payload does not contain them.

## Classification Layers

### 1. Technical Type

Technical type answers: what is this address or graph object?

Allowed values:

- wallet;
- smart contract;
- token contract;
- service boundary;
- synthetic group;
- investigation stop.

Rules:

- An externally owned wallet stays `wallet`.
- A contract can become `smart contract`, `DEX router`, `Bridge`, or `Service` only if the exact contract has supporting evidence.
- A synthetic group or bundle is not a wallet.
- An investigation stop is not a transfer participant.

### 2. Service Identity

Service identity answers: is this exact address known infrastructure?

Allowed categories:

- CEX;
- DEX/router;
- bridge;
- gas/service;
- unknown contract;
- none.

Service identity can be set only from evidence attached to the exact address:

- known registry match;
- public/provider label;
- contract metadata;
- contract methods;
- service route registry;
- strong deterministic heuristic;
- explicit stored boundary identity.

Service identity must not be set from:

- a nearby service edge;
- an incoming or outgoing transfer to a service;
- a shared counterparty that is a service;
- a risk score alone.

### 3. Behavioral Role

Behavioral role answers: what did this address do in this check?

Allowed roles:

- victim;
- drainer receiver;
- drainer spender contract;
- operator/caller;
- collector;
- mule/transit;
- ordinary wallet;
- unknown.

Roles can coexist with technical type.

Examples:

```text
technical type: wallet
behavioral role: drainer receiver / collector
evidence: hard approval-drain provenance
```

```text
technical type: wallet
behavioral role: victim
evidence: contract-driven USDT movement from this address
```

```text
technical type: smart contract
service identity: DEX router
behavioral role: none
evidence: registry + contract methods
```

### 4. Evidence Level

Evidence level answers: why can the UI say this?

Allowed levels:

- hard: exact proof, blacklist, exact approval-drain, stored transaction evidence;
- medium: repeated behavior, strong pattern, multiple related transfers;
- low: weak heuristic;
- context: service exposure, boundary, or incomplete data.

Role marks on nodes should prefer stronger evidence.

Precedence:

1. hard drainer;
2. hard victim;
3. drainer spender contract;
4. collector;
5. mule/transit;
6. service identity;
7. ordinary wallet;
8. unknown.

If a wallet has both `drainer receiver` and `collector`, the primary role mark is drainer and the secondary details show collector.

## Service Rules

### DEX

Set `DEX/router` only when the exact address has strong infrastructure evidence:

- contract address;
- known DEX/router registry entry;
- public/provider tag such as DEX, Swap, Router;
- contract methods consistent with swap/router behavior;
- explicit stored boundary identity category `dex`, `router`, or `swap_adapter`.

Do not set DEX when:

- the address is a normal wallet;
- it only transferred to or from a DEX;
- it shares a route with a DEX;
- it is a victim or receiver in a contract-driven transfer.

### CEX

Set `CEX` only when the exact address has exchange evidence:

- known exchange hot wallet;
- provider/public label;
- stored boundary identity such as Bybit, HTX, Binance, OKX, KuCoin, WhiteBIT, MEXC.

Do not set CEX when a wallet only interacted with a CEX.

### Bridge

Set `Bridge` only when the exact address has bridge evidence:

- known bridge/router registry;
- public/provider bridge label;
- contract/service metadata;
- explicit stored boundary identity.

Do not set Bridge for ordinary wallets adjacent to bridge flow.

### Service / Boundary

Set service/boundary when the address is infrastructure or when the graph is representing a stop/context point.

If there is no real transfer or grouped transfer evidence, do not draw this as money flow.

Instead:

- show an investigation stop;
- or show service context in the right rail;
- or hide it from the main money-flow map if it adds noise.

## Contract-Driven Transfer Rules

A contract-driven transfer is not the same as a normal wallet send.

The detector should look for:

- transaction invoked a smart contract;
- caller/operator differs from token `from`;
- token event moves USDT from victim/source to receiver;
- method payload or decoded metadata contains token/from/to/amount when available;
- optional approval/spender evidence.

Graph scene:

```text
operator/caller -> spender contract -> victim -> receiver
```

Visual meaning:

- `operator/caller -> spender contract`: contract call context;
- `spender contract -> victim`: spender authority / approval context;
- `victim -> receiver`: real USDT Transfer event.

Right rail for the money edge must show:

- amount;
- time;
- tx hash;
- victim/source;
- receiver;
- caller/operator if known;
- spender contract if known;
- method if known;
- proof level:
  - exact approval-drain;
  - contract-driven transfer;
  - contract-driven transfer, approval not stored.

The graph must not use a successful Tronscan transaction status or a method name alone as drainer proof.

## Grouped Transaction Rules

Grouping is allowed only for repeated real transaction evidence.

Group only when all are true:

- same from;
- same to;
- same direction;
- same evidence type;
- same episode, meaning no gap between adjacent transactions greater than the configured episode threshold, default 30 days;
- two or more real transaction rows.

Single tx is never a group.

Do not group together:

- inbound and outbound between the same two wallets;
- ordinary transfer and contract-driven transfer;
- wallet-to-wallet and service/boundary context;
- episodes separated by more than the configured episode threshold.

Graph label:

```text
5 tx - 8.1K USDT
Feb 11-16
```

Right rail:

- list every stored tx;
- amount;
- human-readable UTC time;
- tx gap when it can be computed;
- tx hash link;
- from/to.

If tx rows are not stored but aggregate data exists, say:

```text
Grouped evidence stored as aggregate only. Rerun to recover per-tx rows.
```

## Admin UI Behavior

### Node

The node display should separate base shape from role mark.

Examples:

- wallet + victim: wallet circle with victim icon;
- wallet + drainer receiver: wallet circle with skull/crossbones icon and dark aura;
- wallet + collector: wallet circle with collector icon;
- smart contract + drainer spender: contract node with spender/drainer context;
- DEX router: service node, not wallet node.

### Edge

Edges should use honest evidence types:

- direct transfer;
- grouped transfer;
- contract-driven transfer;
- contract call context;
- spender authority context;
- peer/context link;
- investigation stop.

Context-only edges must not look like money flow.

### Right Rail

For a selected node, show:

- technical type;
- service identity if any;
- behavioral role;
- evidence level;
- why this role was assigned;
- related transactions;
- related contract-driven scenes;
- whether this is proof or context.

For a selected edge, show:

- evidence type;
- amount;
- time;
- tx gap;
- tx links;
- from/to;
- method/caller/spender for contract-driven cases;
- plain-English explanation.

## Old Run Handling

Old jobs may not contain role evidence or contract-driven scene fields.

If required fields are missing, show:

```text
No role evidence stored in this run. Rerun to classify victim/drainer/service roles.
```

If partial fields exist, show:

```text
Role evidence is partial. Contract-driven details are not fully stored.
```

The UI must not infer hard roles from missing data.

## Pipeline Checks

Implementation must verify the full path:

```text
check result -> forensic job payload -> graph projection -> admin UI
```

Required fields for contract-driven scenes:

- victimAddress;
- receiverAddress;
- spenderAddress;
- operatorAddress;
- drainTxHash;
- amountRaw;
- timestamp;
- method;
- proofLevel.

Required fields for service identity:

- address;
- category;
- displayName;
- confidence;
- source;
- evidence;
- isBoundary.

## Acceptance Criteria

- A normal wallet address cannot render as DEX/CEX/Bridge unless the exact address has service evidence.
- A wallet that interacted with a DEX remains a wallet.
- Contract-driven transfers are visible as contract-driven evidence, not just ordinary sends.
- Victim, drainer receiver, collector, mule/transit, and operator/caller roles are separate from service identity.
- Single tx edges are not displayed as grouped tx.
- Grouped tx edges show all stored tx rows in the right rail.
- Context-only boundary evidence is not drawn as money flow.
- Old jobs clearly say when role evidence was not stored.
- Where Is Money and DeepCheck use the same role classification helpers where possible.

## Out Of Scope

- A full unified scoring rewrite.
- Running FastCheck automatically for every neighbor.
- New icon design work.
- LLM-based identity guessing as a source of truth.
- Continuing provenance through CEX/DEX/bridge unless explicit downstream evidence exists.

## Testing

Minimum tests:

- EOA wallet with nearby DEX exposure stays wallet.
- Known DEX contract renders as DEX/router.
- Known CEX hot wallet renders as CEX.
- Approval-drain profile renders victim, spender contract, operator/caller, and receiver roles.
- Contract-driven transfer edge shows proof level and tx details.
- Single transaction does not become grouped.
- Repeated same-direction transactions become grouped.
- Context-only boundary edge is hidden from money-flow rendering or shown only as investigation context.
- Old job without role evidence displays the rerun/partial-data message.
