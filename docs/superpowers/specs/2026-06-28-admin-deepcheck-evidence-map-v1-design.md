# Admin DeepCheck Evidence Map v1 Design

## Goal

DeepCheck should read as an investigation map, not just a visual graph around the checked wallet.

The map must show:

- which wallets were actually checked;
- how many meaningful steps the investigation reached;
- which wallet-to-wallet transfers are real;
- where grouped transfers are shown instead of individual transfers;
- where a smart contract caused a token movement;
- where service, CEX, DEX, bridge, contract, or history boundaries stop the investigation;
- which wallet roles are known from evidence;
- why each important wallet or edge matters.

The main product rule is simple:

> Do not draw something as money flow unless it is a real transaction or a group of real transactions.

If DeepCheck only has context, a boundary, or a stopped investigation point, the UI must not make it look like a normal transfer.

## Background

Current DeepCheck can collect more than a one-hop profile:

- direct subject counterparties;
- expanded neighboring wallets;
- inbound provenance;
- service and boundary exposure;
- wallet roles;
- approval-drain provenance;
- grouped or collapsed branches;
- history stops and incomplete data.

The admin graph does not always make this clear. Dense DeepCheck runs can look like a one-hop fast-check graph, or they can draw context edges in a way that looks like direct money movement.

This creates several problems:

- analysts cannot tell whether `A -> B` is a real transfer, a grouped transfer, or only context;
- service and boundary nodes can look like direct counterparties;
- `amount n/a` appears where a better explanation is needed;
- smart-contract-driven USDT movement can look like a normal manual wallet send;
- wallet roles are not always visible on the node itself;
- neighboring wallets can visually inherit the subject risk even when their own local risk is unknown.

Evidence Map v1 fixes the graph semantics first. Broader unified scoring can come later.

## Scope

This design applies to `address_deep_check`.

Shared rendering helpers can be reused by other modes only when that does not change their existing layout semantics.

In scope:

- real multi-step wallet chains;
- contract-driven transfer scenes;
- approved role icons on graph nodes;
- local node risk and role explanation;
- right rail details for nodes, edges, groups, and boundaries;
- grouped transfer evidence;
- context and boundary handling;
- service and boundary identity display when data exists;
- default view vs `Show all raw`.

Out of scope for v1:

- a new unified scoring engine;
- automatic FastCheck for every neighbor;
- new role icons;
- inventing roles without evidence;
- continuing provenance through CEX, bridge, DEX, router, or service boundaries without explicit follow-on evidence;
- changing Incoming Deposit or Where Is Money layouts except for safe shared helper reuse.

## Evidence Rules

DeepCheck graph edges must fit one of three classes.

### 1. Money flow

Money flow is a real transfer or a group of real transfers.

Show an edge as money flow only when the graph has enough evidence:

- transaction hash, or a stored group of transaction hashes;
- from address;
- to address;
- amount, transfer count, or aggregate amount;
- timestamp or time range when available.

Examples:

- `wallet A -> wallet B`;
- `victim -> receiver`;
- `12 tx · 332K USDT`.

Money-flow labels should show amount and time compactly. Direction should come from arrow direction and right rail details, not from verbose label text.

### 2. Contract-driven scene

Contract-driven transfer means the token movement exists, but it was produced by a smart-contract call rather than a normal wallet send.

The graph should show a mini-scene:

```text
Operator / caller
  -> Drainer contract / spender
       -> Victim
            -> Drainer receiver / collector
```

Visual semantics:

- `Operator / caller -> contract`: contract-call context, not token money flow.
- `contract -> victim`: debit authority context, not token money flow.
- `victim -> receiver`: real USDT movement.

Approved graph labels:

- `Contract called`;
- `Debit authority`;
- `10,001 USDT` and time such as `Jun 23, 13:17`.

Do not write `not USDT flow` on the graph. It is too technical and noisy.

The right rail explains the full meaning:

```text
Evidence type: Contract-driven USDT transfer
Money movement: Victim -> receiver
Caller: TQvjk...
Contract: TURRt... / VerifyAccount
Method: Verify20(token, from, to, amount)
Amount: 10,001 USDT
Meaning: USDT was moved by a smart-contract call, not by a normal wallet send.
```

### 3. Investigation boundary

Investigation boundary means DeepCheck reached a stop or context point:

- service boundary;
- CEX boundary;
- DEX/router boundary;
- bridge boundary;
- contract boundary;
- history incomplete;
- API or page limit;
- no stored transaction evidence;
- unresolved source boundary.

If there is no real transaction or grouped transaction evidence, do not draw it as a money-flow line.

Instead:

- show a boundary point near the related branch when useful;
- show it in the right rail;
- explain the limitation;
- do not show `amount n/a` as if this were a failed transfer amount.

If grouped evidence exists, show the group:

```text
8 tx · 1.28M USDT
```

If no group evidence exists, use:

```text
Investigation boundary only.
No money-flow edge is stored for this relationship.
```

## Node Roles And Approved Icons

Roles are shown with the already approved icon set only.

No new role icons are introduced in v1.

### Drainer

Use the approved skull/crossbones icon.

Display rules:

- icon inside the address circle;
- keep the graph node circle style;
- optional dark red aura;
- always visible when hard evidence exists.

Use for:

- drainer contract / spender;
- drainer receiver / collector when hard approval-drain evidence exists;
- operator only when the system has hard evidence that the caller is part of the drainer scheme.

### Victim

Use the approved red target icon.

Display rules:

- icon inside the address circle;
- marks the wallet whose USDT was debited or which is identified as victim in a drain scene;
- victim does not mean the wallet is a bad actor.

### Collector

Use the approved purple diamond icon.

Display rules:

- icon inside the address circle;
- marks a wallet that concentrates funds;
- if the collector also receives drain funds, the right rail can describe it as `Drainer receiver / collector`.

### Mule / Transit

Use the approved black mule icon.

Display rules:

- icon inside the address circle;
- marks an intermediate wallet that passed funds through;
- mule/transit is a behavioral role, not automatically hard bad proof.

### Operator / Caller

Operator/caller is an event role by default, not a permanent wallet role.

Display rules:

- show as a normal wallet node;
- no new icon;
- add a small `caller` badge or role line when the node participates in a contract-driven scene;
- connect it to the contract with `Contract called`;
- right rail explains the event.

If there is hard evidence that the caller is itself part of the drainer scheme, it may receive the Drainer icon. Otherwise, do not visually over-accuse it.

### Service / Boundary

No custom icon changes in v1.

Service and boundary nodes should show:

- concrete name when known, such as `Bybit`, `GasFree`, `Bridgers`, `Unknown contract`;
- category, such as `CEX`, `Bridge`, `Contract boundary`;
- confidence and source in the right rail.

### Multiple roles

If a node has multiple roles:

- show the primary role inside the circle;
- show secondary roles as small badges beside the node;
- keep badges away from edges and labels.

Primary role priority:

1. drainer;
2. victim;
3. collector;
4. mule/transit;
5. service/boundary;
6. unknown wallet.

## Multi-Step Wallet Chains And Layout

DeepCheck should show the actual chain when the data has it.

If the system has:

```text
A -> B -> C -> subject
```

the graph should show:

```text
A -> B -> C -> subject
```

It should not collapse this into:

```text
A -> subject
```

### Layers

Layer 0: Subject

- checked wallet;
- main graph anchor.

Layer 1: Direct neighbors

- wallets that directly sent to subject;
- wallets that directly received from subject.

Layer 2: Expanded wallets

- neighbors of important neighbors;
- intermediate wallets;
- funders;
- receivers;
- collector, mule, or transit nodes.

Layer 3: Boundaries

- CEX;
- DEX;
- bridge;
- contract;
- service;
- history incomplete;
- trace stop.

Boundary nodes should be visually separated from ordinary wallet clusters.

### Branch layout

Default DeepCheck should use a branch layout:

```text
sources / victims / funders -> intermediates -> subject -> outgoing / services
```

For incoming investigations:

```text
source wallets -> transit wallets -> collector / subject
```

For outgoing investigations:

```text
subject -> transit wallets -> receivers / services
```

For contract-driven scenes:

```text
caller -> contract -> victim -> receiver / subject
```

### Peer links

If two neighboring wallets interacted with each other, show a thin contextual peer line:

- label: `peer link`;
- not part of the main money path unless it is the selected proven path;
- right rail shows transfer count, amount, and period.

### Groups and bundles

If the graph has too many small addresses:

- collapse them into a group;
- label with wallet count, tx count, and amount when available;
- show group contents in the right rail;
- allow `Expand group`;
- show internal links after expansion when stored.

Example:

```text
Group: 12 wallets · 48 tx · 220K USDT
```

## Default View And Show All Raw

Default view should prioritize readable evidence:

- important chains;
- role nodes;
- large transfers;
- fast gaps;
- selected path;
- service and boundary identity;
- grouped transfer evidence.

Default view should hide noise.

`Show all raw` should reveal:

- all raw nodes;
- all raw edges;
- all labels;
- all boundaries;
- all groups.

`Show all raw` is for manual investigation. It is not the default reading mode.

## Relationship With Other Modes

### DeepCheck

DeepCheck is the investigation map.

It answers:

- what real chains exist around the subject;
- which wallets are connected to each other;
- which roles appear;
- where history stops;
- where services or boundaries are reached;
- which links are proven and which are context.

### Where Is Money

Where Is Money is source or movement proof for specific funds.

It can provide hard roles to DeepCheck:

- drainer receiver;
- victim;
- approval-drain path;
- hard evidence risk.

DeepCheck should show these roles when the result data contains them or when a stored result can be safely linked.

### FastCheck

FastCheck should remain a fast AML profile, not a replacement for DeepCheck.

Its future role:

- blacklist/frozen status;
- direct incoming/outgoing profile;
- CEX/DEX/bridge/service exposure;
- top counterparties;
- lightweight score for important neighbors.

In v1, do not automatically run FastCheck for every neighbor.

### Shared Wallet Score

A shared wallet-score module is a v2 concern.

In v1, the UI can display stored role/risk source when available:

- DeepCheck;
- Where Is Money;
- FastCheck;
- shared profile.

If no stored evidence exists, do not invent role or local risk.

## Wallet Risk And Explanation

Node risk should mean the risk of that node in this graph, not automatically the final score of the entire check.

Each important node should have:

- local risk;
- role;
- confidence;
- evidence strength;
- reason;
- source;
- scope.

Example victim:

```text
Role: Victim
Local risk: n/a
Evidence: hard
Why: USDT was debited from this wallet by a smart-contract call.
Scope: this transaction only
```

Example collector:

```text
Role: Collector
Local risk: 72
Evidence: behavior
Why: received funds from 8 wallets and forwarded most balance within 40 minutes.
Scope: observed graph
```

### Hard proof

Hard proof includes:

- blacklist/frozen;
- exact approval-drain provenance;
- known drainer;
- direct scam source.

Hard proof can drive high risk.

### Behavior and context

Behavior/context includes:

- collector-like behavior;
- fast pass-through movement;
- common CEX/bridge/service;
- peer links;
- incomplete history.

Behavior/context can raise attention but should not automatically equal dirty funds.

### Subject wallet

Subject can have both:

- final check risk;
- local wallet role.

Example:

```text
Final check risk: 95 / critical
Node role: Drainer receiver / collector
Why: received USDT from victim through contract-driven approval-drain tx.
```

### Neighbor wallets

Neighbor wallets do not inherit subject risk by default.

If a neighbor is merely connected:

```text
Local risk: unknown
Why: connected by one observed transfer, no direct risk evidence.
```

If a neighbor is a victim:

```text
Role: Victim
Risk meaning: victim, not bad actor.
```

If a neighbor is a service:

```text
Role: Service boundary
Risk meaning: boundary/context, not proof of dirty funds.
```

## Right Rail

Right rail is the main explanation surface.

### Direct transfer

Show:

- type: `Direct transfer`;
- amount;
- time;
- gap when available;
- from;
- to;
- tx hash;
- direction;
- why this edge matters.

### Grouped transfers

Show:

- type: `Grouped transfers`;
- tx count;
- total amount;
- first seen;
- last seen;
- connected wallets;
- underlying tx list when stored.

### Contract-driven transfer

Show:

- type: `Contract-driven USDT transfer`;
- amount;
- time;
- tx hash;
- caller/operator;
- spender contract;
- victim;
- receiver;
- method;
- proof level;
- meaning.

Meaning text:

```text
USDT was moved by a smart-contract call, not by a normal wallet send.
```

### Contract call context

Show:

- type: `Contract call`;
- caller;
- contract;
- tx hash;
- method;
- meaning.

Meaning text:

```text
This explains who started the contract call. It is not a token transfer.
```

### Debit authority context

Show:

- type: `Debit authority`;
- spender contract;
- victim;
- approval tx when available;
- drain tx;
- meaning.

Meaning text:

```text
This explains why the contract could debit tokens from the victim wallet.
```

### Boundary or service

Show:

- entity name;
- category;
- confidence;
- source;
- evidence;
- connected wallets;
- tx count and amount when available;
- warning if there is no stored tx evidence.

If no transaction or group evidence is stored:

```text
Investigation boundary only.
No money-flow edge is stored for this relationship.
```

### Node

Show:

- address;
- role icon and role name;
- local risk;
- confidence;
- why role assigned;
- source mode;
- related paths;
- related transactions;
- hard proof vs context.

### Group or bundle

Show:

- group type;
- wallet count;
- tx count;
- total amount;
- why grouped;
- addresses inside;
- internal links when stored;
- `Expand group`.

## Acceptance Criteria

1. If DeepCheck data contains `A -> B -> C -> subject`, the default graph can show that chain without collapsing it into `A -> subject`.

2. If a transfer is contract-driven, the graph shows a scene with caller, contract, victim, receiver, and the real USDT movement separately.

3. Context-only boundary relationships do not render as money-flow lines.

4. `amount n/a` is not used as the main label for boundary/context relationships. The UI either shows grouped evidence or explains that no money-flow evidence is stored.

5. Grouped evidence shows transfer count, aggregate amount, time range, and underlying transactions when stored.

6. Only approved role icons are used: drainer, victim, collector, mule/transit.

7. Operator/caller does not receive a new icon by default.

8. Subject and neighboring wallets do not automatically share the same risk.

9. Right rail explains why a node has a role and why an edge is displayed.

10. Right rail clearly separates hard proof from behavior/context.

11. Old DeepCheck jobs still render. If new scene data is missing, the graph remains readable and only shows available evidence.

12. `Show all raw` remains available for full manual inspection.

## Test Plan

Add or update tests for:

- approval-drain scene projection;
- contract-driven transfer edge labels;
- contract call and debit authority context labels;
- no fake money-flow edge for context-only boundary;
- grouped boundary evidence with amount and tx count;
- role icon source mapping for approved icons;
- local node risk not inherited from subject risk;
- old DeepCheck jobs without new data still project successfully.

## Spec Self-Review

- Placeholder scan: no unfinished markers remain.
- Consistency check: evidence rules, node roles, right rail, and acceptance criteria all use the same three edge classes.
- Scope check: v1 is limited to DeepCheck evidence display and does not include unified scoring or automatic neighbor FastCheck.
- Ambiguity check: operator/caller is explicitly an event role by default, not a new icon role.
