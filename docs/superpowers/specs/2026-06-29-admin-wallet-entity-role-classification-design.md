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

### Contract-Driven Evidence Grading

Method name alone is not evidence. `Verify20`, `permitTransfer`, `transferFrom`, or any other method name can be useful context, but the role decision must come from the decoded call, token transfer event, caller/from mismatch, receiver flow, approval/spender link, and repeated pattern across source wallets.

Use these levels:

1. `contract-driven transfer`

   Use when one transaction shows:

   - a smart contract call;
   - caller/operator differs from token `from`;
   - a USDT Transfer event moved funds from source/victim to receiver;
   - amount and timestamp are available.

   This does not by itself make the receiver a drainer. It means the inflow was not a normal manual wallet send.

2. `contract-driven cluster`

   Use when the receiver has either:

   - at least 3 contract-driven inbound USDT transactions from at least 2 unique source wallets; or
   - at least 10K USDT total contract-driven inbound volume.

   This is a notable funding pattern, but still not hard drainer proof without stronger evidence.

3. `drainer-like pattern`

   Use when all are true:

   - at least 10 contract-driven inbound USDT transactions;
   - at least 5 unique source wallets;
   - at least 50K USDT total contract-driven inbound volume;
   - contract-driven inflows are at least 25% of either inbound count or inbound USDT volume;
   - no high-confidence legitimate service identity explains the spender/contract route.

   This should mark the receiver as `drainer-like receiver / collector` with medium evidence.

4. `dominant drainer-like pattern`

   Use when all are true:

   - at least 25 contract-driven inbound USDT transactions;
   - at least 10 unique source wallets;
   - at least 100K USDT total contract-driven inbound volume;
   - contract-driven inflows are at least 50% of inbound USDT volume or inbound count.

   This should mark the receiver as a high-priority `drainer-like collection wallet`, unless a legitimate service explanation is proven.

5. `exact approval-drain`

   Use when a contract-driven transfer also has linked approval, permit, allowance, or spender authority evidence from the source/victim to the spender contract before the transfer.

   This is hard evidence. It should mark:

   - source wallet as `victim`;
   - spender contract as `drainer spender contract`;
   - receiver as `drainer receiver / collector`;
   - operator/caller as `operator/caller`.

For `permitTransfer` and `transferFrom`, use more caution than for repeated custom wrapper methods. These methods can appear in legitimate gasless, permit, router, or service flows. A `permitTransfer` inflow should stay at `contract-driven transfer` or `contract-driven cluster` unless it also meets the drainer-like thresholds or has linked approval/spender proof.

For custom wrapper methods such as repeated `Verify20(token, from, to, amount)`, treat high repetition as stronger suspicious evidence because it is not a normal wallet transfer shape. Example:

```text
total inbound USDT: 175 tx / 968.5K USDT
contract-driven inbound: 168 tx / 959.2K USDT
contract-driven share: 96% by count, 99% by volume
method: Verify20
linked approval proof: at least 1 exact approval-drain
```

This should render as `drainer receiver / collector` with hard evidence for the exact approval-drain episode and high-priority drainer-like pattern evidence for the aggregate behavior.

### Contract-Driven Graph Display

The graph must show contract-driven inflows as a scene, not as a plain wallet-to-wallet send.

For a single event:

```text
operator/caller -> spender contract
spender contract -> source/victim
source/victim -> receiver
```

Only `source/victim -> receiver` is the real USDT movement. The other two edges are context/authority edges and must not look like money flow.

For repeated events through the same spender contract, group by:

- receiver;
- spender contract;
- method;
- direction;
- episode.

Example graph label:

```text
168 contract-driven inflows
959.2K USDT - Verify20
```

Expanded view must show:

- source/victim wallets;
- receiver;
- spender contract;
- operator/caller when known;
- every stored tx hash;
- amount;
- UTC time;
- method;
- proof level.

If many source wallets are involved, the default graph may show a victim/source group:

```text
Group: 42 source wallets
Verify20 - 168 tx - 959.2K USDT
```

Clicking `Expand selected` should replace the group with individual source wallets and their stored tx rows.

### Source Dormancy / Victim-Like Source Signal

After a contract-driven inbound transfer, the checker should inspect whether the source wallet continued normal USDT activity.

This is not hard proof by itself. It is a behavioral signal:

> If many source wallets lose USDT through a contract-driven call and then stop showing USDT activity, the receiver looks more like a drainer collector than a normal service deposit address.

Per source wallet, record:

- source address;
- contract-driven tx hash;
- amount;
- timestamp;
- receiver;
- spender contract;
- method;
- whether post-transfer USDT activity was observed;
- how much history was checked;
- whether the result is full or limited by fetch depth.

Event-level labels:

- `victim-like source`: no later USDT activity observed in the fetched post-transfer history;
- `active source after transfer`: later USDT activity exists, so victim confidence is lower;
- `source activity unknown`: history fetch was incomplete or unavailable.

Campaign-level thresholds:

1. `victim-like source signal`

   Use when:

   - at least 10 source wallets were checked; and
   - at least 70% had no later USDT activity in fetched post-transfer history.

2. `strong victim-like source signal`

   Use when:

   - at least 20 source wallets were checked; and
   - at least 80% had no later USDT activity in fetched post-transfer history.

3. `dominant victim-like source signal`

   Use when:

   - at least 20 source wallets were checked; and
   - at least 90% had no later USDT activity in fetched post-transfer history.

Example observed sample:

```text
checked large/new contract-driven inbound sources: 36
source wallets with no later USDT activity in fetched history: 32 / 36
combined dormant share: 89%

TS3ga...HjfPjgf: 10 / 13 dormant sources
TPdrEz...5mmGJE: 22 / 23 dormant sources
```

Interpretation:

- the combined sample reaches `strong victim-like source signal`;
- `TPdrEz...5mmGJE` reaches `dominant victim-like source signal`;
- `TS3ga...HjfPjgf` reaches `victim-like source signal`;
- this strengthens drainer-like pattern evidence, but exact hard proof still requires linked approval/spender evidence for each exact episode.

If a source wallet remains active after the contract-driven debit, do not automatically clear the suspicion. Instead:

- lower victim confidence for that source;
- keep the contract-driven transfer evidence;
- show `active after debit` in the right rail;
- require approval/spender proof or broader campaign context before marking that source as hard victim.

Legitimate service counter-signals:

- known bridge/router/DEX/gasless-service label;
- spender contract is in a trusted service registry;
- many different receivers, not one repeated collector;
- method names and decoded calls match normal service flows such as swap, bridge, deposit, withdraw, or permit service;
- source wallets continue normal activity after the transfer;
- no linked approval-drain proof in the campaign.

The graph should show this signal without overstating it:

- source group label: `42 source wallets - 89% inactive after debit`;
- receiver label: `drainer-like collector`;
- exact approval-drain episodes get the hard drainer icon;
- non-exact episodes get a weaker drainer-like mark or right-rail note.

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

Required aggregate fields for contract-driven receiver classification:

- totalInboundUsdtCount;
- totalInboundUsdtVolumeRaw;
- contractDrivenInboundCount;
- contractDrivenInboundVolumeRaw;
- contractDrivenInboundCountShare;
- contractDrivenInboundVolumeShare;
- uniqueContractDrivenSourceWallets;
- uniqueSpenderContracts;
- methodCounts;
- linkedApprovalCount;
- dominantContractDrivenMethod;
- legitimateServiceExplanation, if present.

Required fields for source dormancy analysis:

- checkedContractDrivenSourceCount;
- dormantSourceCount;
- activeAfterDebitSourceCount;
- unknownPostDebitActivitySourceCount;
- dormantSourceShare;
- sourceHistoryFetchDepth;
- sourceDormancySignalLevel;
- perSourcePostDebitActivityRows, when stored.

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
- A method name alone never assigns a drainer role.
- A single contract-driven transfer without approval/spender proof is not enough to mark the receiver as drainer.
- A receiver meeting `drainer-like pattern` thresholds is marked as drainer-like/collector with medium evidence.
- A receiver meeting `dominant drainer-like pattern` thresholds is marked as high-priority drainer-like collection wallet unless a legitimate service explanation is proven.
- Any linked approval/spender proof upgrades the affected episode to exact approval-drain hard evidence.
- Repeated contract-driven inflows through the same spender contract can be grouped by spender/method/episode and expanded into stored tx rows.
- Source dormancy is displayed as a supporting victim-like signal, not as standalone hard proof.
- 10 checked sources and 70% post-debit inactivity produces `victim-like source signal`.
- 20 checked sources and 80% post-debit inactivity produces `strong victim-like source signal`.
- 20 checked sources and 90% post-debit inactivity produces `dominant victim-like source signal`.
- Sources that remain active after the debit lower victim confidence but do not erase contract-driven evidence.
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
- `Verify20` method name without transfer-event and caller/from mismatch evidence does not assign drainer role.
- One contract-driven inbound tx without approval proof remains `contract-driven transfer`, not drainer.
- 3 contract-driven inbound tx from 2 unique sources or 10K USDT volume produces `contract-driven cluster`.
- 10 contract-driven inbound tx, 5 unique sources, 50K USDT, and 25% inbound share produces `drainer-like pattern` when no legitimate service explanation exists.
- 25 contract-driven inbound tx, 10 unique sources, 100K USDT, and 50% inbound share produces `dominant drainer-like pattern` when no legitimate service explanation exists.
- A TS3ga-style fixture with 168 of 175 inbound tx and 959.2K of 968.5K USDT through `Verify20` renders as drainer receiver / collector, with exact approval-drain hard evidence when linked approval exists.
- A TPdrEz-style fixture with 97 contract-driven inbound tx and 322.1K USDT through `Verify20` renders as high-priority drainer-like collection wallet unless a legitimate service explanation is proven.
- A combined fixture with 32 of 36 checked sources inactive after contract-driven debit renders `strong victim-like source signal`.
- A TPdrEz-style fixture with 22 of 23 checked sources inactive after contract-driven debit renders `dominant victim-like source signal`.
- A TS3ga-style fixture with 10 of 13 checked sources inactive after contract-driven debit renders `victim-like source signal`.
- A source wallet with later USDT activity after the debit is shown as `active after debit` and does not receive hard victim status without approval/spender evidence.
- A low-count `permitTransfer` case with known service identity stays contract-driven/service context, not drainer.
- Single transaction does not become grouped.
- Repeated same-direction transactions become grouped.
- Context-only boundary edge is hidden from money-flow rendering or shown only as investigation context.
- Old job without role evidence displays the rerun/partial-data message.
