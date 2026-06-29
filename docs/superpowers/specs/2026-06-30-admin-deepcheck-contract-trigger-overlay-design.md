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
source wallet -> collector wallet
source wallet -> spender contract
```

Where:

- `source wallet -> collector wallet` is the real USDT Transfer event;
- `source wallet -> spender contract` is contract trigger / spender authority context;
- the contract node explains how the debit happened;
- the collector/subject is not shown as sending money to the contract.

## Approved Map Appearance

The approved mockup is:

`tmp/mockups/deepcheck-contract-driven-overlay-v2.png`

It shows the intended graph semantics:

- red target mark inside debited source wallet nodes;
- a separate `VerifyAccount / Verify20` contract node;
- thin violet `contract trigger` line from source wallet to contract;
- gray-violet dashed real transfer line from source wallet to collector;
- drainer skull mark inside the collector/subject node when the receiver is drainer-like or exact-drain;
- no thick yellow collector-to-contract line.

The mockup is a visual guide, not an asset dependency.

## Node Semantics

### Source wallet

The source wallet is the wallet whose USDT was debited by the smart-contract-driven transaction.

Display:

- normal wallet circle;
- approved red target/victim icon inside the circle when the debit is `Verify20` into a drainer-like or exact-drain receiver;
- wallet label remains the shortened address;
- right rail explains that victim-like means debited source, not bad actor.

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

### Real transfer edge

The real transfer edge is the token movement:

```text
source wallet -> collector wallet
```

Display:

- gray or gray-violet dashed line;
- amount and human time chip for selected or important edges;
- grouped chip when there are repeated real transfers in the same direction and same episode;
- not yellow unless it is a service/boundary category by real evidence.

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

## Grouping Rules

Contract-driven evidence follows the existing grouping principle:

> Group only repeated real tx evidence between the same two nodes, same direction, same evidence type, same episode. Single tx is never a group.

Additional rules:

- repeated source-to-collector real transfer events can be grouped;
- repeated source-to-contract trigger contexts can be summarized as one context line;
- real transfer and contract trigger context are never grouped together;
- `Verify20`, `permitTransfer`, and `transferFrom` are separate evidence types;
- opposite directions are never grouped together.

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

4. The real USDT movement remains visible as source-to-collector transfer evidence.

5. The contract trigger line is visually distinct from money flow and does not show an amount chip.

6. Repeated debits through the same contract reuse one contract node.

7. A single real transfer is not displayed as a grouped transfer.

8. Contract trigger context does not appear as a normal transfer in the transfer drawer.

9. The right rail explains method, contract, caller, source, receiver, tx hash, amount, and proof level.

10. Existing old DeepCheck jobs still render without this overlay when contract-driven evidence is missing.

11. Plain wallets are not promoted to DEX/CEX/Bridge because of weak context.

12. `Show all raw` may show caller/operator context nodes, but default view stays focused on source, contract, and collector.

## Test Plan

Add or update tests for:

- contract-driven source-to-contract trigger edge projection;
- no collector-to-contract duplicate edge for incoming contract-driven evidence;
- victim target role on `Verify20` debited sources when receiver is drainer-like;
- contract node deduplication by contract address;
- real transfer edge remains source-to-collector with amount/time;
- trigger context edge has no amount label and no transfer drawer rows;
- right rail shows method, contract, caller, source, receiver, tx hash, and proof level;
- old jobs without contract-driven profiles still render.

## Spec Self-Review

- Placeholder scan: no TBD or TODO markers remain.
- Consistency check: money flow, trigger context, and service/boundary context are separated.
- Scope check: this spec only changes DeepCheck contract-driven visualization and right-rail meaning, not final scoring.
- Ambiguity check: `Verify20` is explicitly not always drainer; the victim/target mark depends on the observed receiver campaign context.
