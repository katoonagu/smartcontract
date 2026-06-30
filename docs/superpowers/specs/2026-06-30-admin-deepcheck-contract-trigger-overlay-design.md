# Admin DeepCheck Contract Trigger Overlay Design

Date: 2026-06-30

## Goal

DeepCheck must show contract-driven debits as a real investigation scene on the graph, not as duplicated yellow service lines from the checked wallet to smart contracts.

The graph should make this obvious:

- which source wallet was debited;
- which smart contract triggered the debit;
- which collector/subject received the USDT;
- which part is real token movement;
- which part is contract trigger context.

This spec is an addendum to:

- `2026-06-28-admin-deepcheck-evidence-map-v1-design.md`;
- `2026-06-28-admin-deepcheck-transaction-grouping-and-circular-flow-design.md`;
- `2026-06-29-admin-wallet-entity-role-classification-design.md`.

## Problem

Current DeepCheck can store contract-driven evidence, but the graph can still read wrong:

- contract nodes appear as if the subject has a normal service link to them;
- yellow lines from subject to contracts look like direct money flow or service exposure;
- source wallets that were debited through `Verify20` do not clearly show the victim/target role;
- the analyst cannot see that many source wallets were debited through the same contract;
- the selected edge can explain the evidence, but the map itself does not.

The map must carry the meaning visually, before the analyst opens the right rail.

## Core Visual Rule

Do not draw a contract-driven debit as:

```text
collector / subject -> contract
```

unless there is a real transaction or grouped transaction proving that direction.

For a contract-driven debit, draw:

```text
source wallet -> spender contract
spender contract -> collector wallet
```

Where:

- `source wallet -> spender contract` is the contract trigger / spender authority context;
- `spender contract -> collector wallet` is the visible contract-driven incoming evidence;
- the underlying token event still records `from = source wallet` and `to = collector wallet`;
- the contract node explains how the debit happened;
- the collector/subject is not shown as sending money to the contract.

Do not draw the usual gray direct wallet line:

```text
source wallet -> collector wallet
```

for a contract-driven transfer in the default DeepCheck map. That direct line makes the scene look like a normal wallet send. The right rail can still show the underlying token event as `source -> collector`, but the map should route the visible story through the spender contract.

Before graph projection, every transfer used by DeepCheck must be classified as one of:

- `normal_wallet_transfer`: ordinary wallet-to-wallet token transfer evidence;
- `contract_driven_transfer`: token transfer event produced by a smart-contract call, for example `Verify20(token, from, to, amount)`;
- `contract_trigger_context`: the relationship from the debited source wallet to the spender contract that mediated the debit;
- `service_or_boundary_context`: non-money investigation boundary, only shown when it has explicit grouped evidence or a clear stop marker.

The graph must not infer that a top-up is physical/ordinary just because the visible edge is `source -> receiver`. If the tx contains contract call evidence, the visible map must carry that evidence.

Gray dashed wallet-to-wallet lines are reserved for `normal_wallet_transfer` only. If the transaction was mediated by a smart contract, it must not use the ordinary gray wallet-transfer visual language.

## Approved Map Appearance

The approved correction model is visual option `B` from the brainstorming companion:

It shows the intended graph semantics:

- red target mark inside debited source wallet nodes;
- a separate `VerifyAccount / Verify20` contract node;
- thin violet `contract trigger` line from each existing source wallet to the true spender contract;
- non-gray contract-driven incoming line from the spender contract to the collector/subject;
- drainer skull mark inside the collector/subject node when the receiver is drainer-like or exact-drain;
- no thick yellow collector-to-contract line.

The mockup is a visual guide, not an asset dependency.

The key correction is that source wallets remain wallets. A source wallet must not become a `Contract` node merely because its transfer came from `contractDrivenTransferProfiles` or another contract-driven evidence source.

## Node Semantics

### Source wallet

The source wallet is the wallet whose USDT was debited by the smart-contract-driven transaction.

Display:

- normal wallet circle;
- approved red target/victim icon inside the circle when the debit is `Verify20` into a drainer-like or exact-drain receiver;
- wallet label remains the shortened address;
- right rail explains that victim-like means debited source, not bad actor.

If the source wallet is already present in the DeepCheck graph, reuse that existing node and add the role mark/context edge to it. Do not create a second duplicate node for the same address.

If a contract-driven source wallet is not present in the graph but the job has stored contract-driven evidence for it, include it as a normal wallet node when the evidence is material. Material means at least one of:

- exact approval-drain proof;
- `Verify20` or equivalent decoded `from/to/amount` evidence into a drainer-like receiver;
- transfer amount meets the existing important-transfer threshold;
- repeated source-to-receiver or source-to-contract evidence in the same campaign.

In `Show all raw`, all stored contract-driven source wallets are eligible to render, including small transfers.

Victim-like marking is allowed when:

- method is `Verify20(token, from, to, amount)` or equivalent decoded evidence;
- token event `from` is the source wallet;
- token event `to` is the collector/subject;
- receiver is classified as drainer-like collector, drainer receiver, or exact approval-drain receiver.

This is not the same as saying every `Verify20` call is always a drainer. It is a graph role for this observed debit scene.

### Spender contract

The contract node represents the smart contract that triggered or mediated the debit.

Display:

- separate circular node;
- label with concrete identity when available, for example `VerifyAccount`;
- subtitle or right-rail method, for example `Verify20`;
- contract glyph inside the circle;
- drainer-like/dark styling only when the receiver campaign is drainer-like or exact approval-drain;
- do not label a plain wallet as DEX/CEX/Bridge just because it appeared near a contract-driven scene.

Multiple debits through the same contract must reuse one contract node.

Contract nodes are keyed by the real spender/contract address from tx metadata, for example `TURRtRavZxXeoQF6tWbeNQ5gfzWEH7sEHh`. They are not synthesized from source wallet addresses.

### Collector / subject

The collector/subject is the wallet that received the USDT.

Display:

- approved skull/crossbones mark when classified as drainer-like collector, drainer receiver, or exact approval-drain receiver;
- if the wallet is only a generic collector without drainer-like evidence, use collector styling instead;
- do not draw service-style yellow lines from it to every contract used by incoming debits.

### Operator / caller

Operator/caller is an event participant, not the default visual anchor.

Default view:

- do not clutter the map with caller nodes for every debit unless the caller is selected, repeated, or important;
- store caller in edge metadata and right rail;
- in `Show all raw`, caller can appear as a node connected to contract with a context line.

## Edge Semantics

### Contract-driven incoming edge

For contract-driven transfers, the visible incoming edge is routed through the spender contract:

```text
spender contract -> collector wallet
```

Display:

- restrained amber/gold line, or another non-gray contract-driven color from the current map palette;
- amount and human time chip for selected or important edges;
- grouped chip when there are repeated real transfers in the same direction and same episode;
- not gray, because gray is reserved for ordinary wallet transfers.

This edge represents real USDT movement into the collector, but its source of authority is the spender contract. The label should make the distinction visible:

```text
816 USDT - Jun 19, 08:37
contract-driven
```

For dense views, the second line can be hidden until selected, but the selected edge/right rail must always show it.

The right rail must still show the underlying token event:

```text
Token event: source wallet -> collector wallet
Contract: spender contract
Method: Verify20(token, from, to, amount)
```

Examples:

```text
816 USDT - Jun 19, 08:37
8 tx - 42.1K USDT
```

### Contract trigger edge

The contract trigger edge is context:

```text
source wallet -> spender contract
```

Display:

- thin violet line;
- small label only when selected or important: `contract trigger`;
- no amount chip;
- no money-flow styling;
- no transfer drawer row unless the right rail is showing the related debit evidence.

For many source wallets using the same contract, draw source-to-contract context edges from the existing source wallet nodes into that one contract node. This is the point of the overlay: the analyst should see which wallets were debited through the same spender contract.

Right rail can show:

```text
Type: Contract trigger
Method: Verify20(token, from, to, amount)
Contract: VerifyAccount
Caller: TQvjk...
Related debit tx: b424...50e7
```

### No collector-to-contract duplicate edge

Do not render:

```text
collector / subject -> spender contract
```

for contract-driven incoming evidence.

If a separate real transaction exists from collector to contract, it can render as its own real transfer. Otherwise, it must not appear.

### No default source-to-collector direct line for contract-driven debits

Do not render:

```text
source wallet -> collector wallet
```

as a plain direct graph line for `contract_driven_transfer` in the default map. The analyst should see:

```text
source wallet -> spender contract -> collector wallet
```

The direct token event remains available in the right rail and transaction drawer as factual evidence, but it is not the default visual route.

## Grouping Rules

Contract-driven evidence follows the existing grouping principle:

> Group only repeated real tx evidence between the same two nodes, same direction, same evidence type, same episode. Single tx is never a group.

Additional rules:

- repeated source-to-collector real transfer events can be grouped;
- repeated contract-to-collector incoming events can be grouped;
- repeated source-to-contract trigger contexts can be summarized as one context fan;
- real transfer and contract trigger context are never grouped together;
- `Verify20`, `permitTransfer`, and `transferFrom` are separate evidence types;
- opposite directions are never grouped together.

Deduplicate before grouping:

- same `txHash`;
- same source wallet;
- same receiver wallet;
- same spender contract;
- same method;
- same amount.

Duplicates from old projections, profile summaries, or both DeepCheck and Where Is Money must merge into one evidence item. The right rail may show multiple evidence sources, but the graph must not draw two identical chips/lines for one tx.

Default grouping:

- a single tx is never labeled as a group;
- 2+ tx through the same spender contract into the same receiver in the same evidence type can become one grouped contract-to-collector incoming line;
- 2+ sources using the same spender contract can show one contract node with multiple source-to-contract trigger lines;
- if the full raw set has around 160 contract-driven source wallets, the map should reflect that breadth through the existing wallet nodes and contract fan, not just a few selected lower nodes.

## Verify20 Practical Rule

`Verify20(token, from, to, amount)` is not automatically always a drainer.

But in our observed drainer-like campaigns it is a strong visual signal when combined with:

- explicit `from`, `to`, and `amount`;
- many source wallets;
- one receiver/collector;
- no known legitimate service label;
- contract name like `VerifyAccount`;
- source wallets become inactive or mostly inactive after debit;
- at least one exact approval-drain proof exists in the same receiver campaign.

When this combination exists:

- receiver can be marked `Drainer-like collector` or `Drainer receiver`;
- source wallets debited by the pattern can receive the red victim/target mark;
- contracts used by the pattern can be shown as suspicious spender contracts;
- the right rail must still distinguish exact proof from drainer-like pattern.

## Right Rail Requirements

Selecting the real transfer edge should show:

- evidence type: `Contract-driven debit`;
- amount;
- human-readable time;
- tx hash with Tronscan link;
- source wallet;
- receiver wallet;
- contract;
- method;
- caller/operator;
- proof level: exact approval-drain, drainer-like pattern, or contract-driven context;
- source activity after debit when stored.

Selecting the contract-to-collector incoming edge should additionally show that the visible graph route is contract-mediated, while the token event debited the source wallet.

For grouped contract-driven evidence, the right rail must show the underlying tx list:

- amount;
- human-readable time;
- tx hash with Tronscan link;
- source wallet;
- receiver wallet;
- spender contract;
- method;
- caller/operator when stored.

If the producer did not store the underlying tx list, the right rail must say that explicitly. Do not show fake duplicate rows.

Selecting the contract node should show:

- contract address;
- contract name/label;
- method list;
- connected source wallets;
- receiver wallets;
- tx count;
- total amount for related debits;
- whether this contract is known service, unknown contract, suspicious spender, or exact drainer spender.

Selecting a source wallet should show:

- address;
- role: victim-like source when applicable;
- related contract-driven debits;
- post-debit activity status;
- why the target icon is shown.

## Acceptance Criteria

1. A contract-driven incoming debit creates a visible source-to-contract trigger relationship.

2. The debited source wallet shows the approved red target/victim mark when the evidence is `Verify20` into a drainer-like or exact-drain receiver.

3. The subject/collector does not get duplicate yellow lines to the contracts that triggered incoming debits.

4. The real USDT movement remains visible as spender-contract-to-collector incoming evidence on the graph, with the underlying `source -> collector` token event shown in the right rail.

5. The contract trigger line is visually distinct from money flow and does not show an amount chip.

6. Repeated debits through the same contract reuse one contract node.

7. A single real transfer is not displayed as a grouped transfer.

8. Contract trigger context does not appear as a normal transfer in the transfer drawer.

9. The right rail explains method, contract, caller, source, receiver, tx hash, amount, and proof level.

10. Existing old DeepCheck jobs still render without this overlay when contract-driven evidence is missing.

11. Plain wallets are not promoted to DEX/CEX/Bridge because of weak context.

12. `Show all raw` may show caller/operator context nodes, but default view stays focused on source, contract, and collector.

13. Existing source wallet nodes remain `wallet` nodes; they are not reclassified as `Contract` because the evidence source name contains the word `contract`.

14. The graph distinguishes ordinary wallet transfers from smart-contract-driven transfers before rendering labels, roles, and edges.

15. A TPdrEz/TS3ga-style job with many stored `Verify20` incoming top-ups shows the breadth of source wallets connected to the real spender contract nodes, not only two selected or lower-screen examples.

16. Duplicate contract-driven tx evidence renders once on the graph and once in the transaction list.

17. Default DeepCheck does not draw plain gray source-wallet-to-subject lines for contract-driven debits; those debits route visually through the spender contract.

## Test Plan

Add or update tests for:

- contract-driven source-to-contract trigger edge projection;
- no collector-to-contract duplicate edge for incoming contract-driven evidence;
- victim target role on `Verify20` debited sources when receiver is drainer-like;
- contract node deduplication by contract address;
- real transfer edge remains source-to-collector with amount/time;
- contract-driven incoming edge renders spender-contract-to-collector with amount/time;
- no default source-to-collector plain line for contract-driven debits;
- trigger context edge has no amount label and no transfer drawer rows;
- right rail shows method, contract, caller, source, receiver, tx hash, and proof level;
- old jobs without contract-driven profiles still render.
- transfer classification tests for normal wallet transfer vs `Verify20`/`transferFrom`/`permitTransfer`;
- deduplication tests where the same tx appears from old graph evidence and contract-driven profile evidence;
- dense campaign fixture where many contract-driven source wallets remain wallets and connect to real spender contract nodes.

## Spec Self-Review

- Placeholder scan: no TBD or TODO markers remain.
- Consistency check: money flow, trigger context, and service/boundary context are separated.
- Scope check: this spec only changes DeepCheck contract-driven visualization and right-rail meaning, not final scoring.
- Ambiguity check: `Verify20` is explicitly not always drainer; the victim/target mark depends on the observed receiver campaign context.
- Regression check: the spec explicitly forbids turning source wallets into fake contract nodes.
