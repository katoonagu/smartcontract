# Admin Contract Lane Separation Design

Date: 2026-07-01

## Goal

Make every wallet-to-smart-contract scene visually separate from the ordinary wallet cluster across the admin graph modes:

- `Wallet clusters`;
- `Deep branch map` / deep range map wording in product discussion;
- `Show all raw`.

The analyst should be able to read the wallet cluster first, then inspect smart-contract-mediated evidence as a related but separate scene.

## User-Approved Direction

Use a dedicated smart-contract lane.

The main graph should read as:

```text
ordinary wallet cluster
```

with contract-mediated evidence placed separately:

```text
source wallet -> smart contract
smart contract -> subject / receiver wallet
```

Where:

- `source wallet -> smart contract` is trigger/context, not normal money flow;
- `smart contract -> subject / receiver wallet` is the contract-driven USDT movement;
- ordinary wallet-to-wallet edges stay in the main cluster;
- contract nodes do not sit inside the middle of the ordinary wallet cluster unless the selected mode is explicitly expanded around that contract.

## Problem

The graph already has contract-driven evidence, but visual modes can still mix smart-contract scenes into the same area as ordinary wallet relationships. That makes the map hard to read:

- contract lines compete with normal wallet-to-wallet paths;
- the subject wallet can look visually connected to every contract in the same cluster;
- `Wallet clusters` loses the clean cluster shape;
- `Show all raw` becomes an audit dump where contract edges are technically present but visually noisy;
- `Deep branch map` can make a branch look like a wallet path when part of the branch is actually smart-contract context.

## Existing Context

`src/admin/forensicsGraph.ts` already projects contract-driven evidence from `contractDrivenTransferProfiles` as separate graph facts:

- source wallet node;
- smart contract node;
- receiver/subject node;
- `contract_trigger_context` edge from source wallet to contract;
- `contract_driven_transfer` edge from contract to receiver.

The first implementation should not rewrite that evidence model. The missing piece is presentation/layout: `src/admin/adminConsole.ts` needs a shared way to recognize contract scenes and place them away from the main wallet cluster in every relevant mode.

## Considered Approaches

### Recommended: Shared Smart-Contract Lane

Add one small role/classification helper in the admin graph UI that detects contract-scene nodes and edges, then have each relevant layout place those nodes into a contract lane.

Trade-off:

- best balance of readability and low code churn;
- preserves current graph modes;
- works for all contract evidence, not only `contractDrivenTransferProfiles`;
- requires careful layout tests for each mode.

### Alternative: Detached Contract Islands

Render every smart contract as a separate side island with its connected source wallets and receiver links.

Trade-off:

- strong visual separation;
- useful for one or two contracts;
- gets messy with many wallets because long cross-canvas lines multiply.

### Alternative: Collapsed Contract Hub By Default

Collapse contract scenes into one expandable hub until selected.

Trade-off:

- quietest default graph;
- good for very dense cases;
- hides too much when the analyst needs to see which exact contract mediated which wallet relationship.

## Design

### Contract Scene Detection

Treat a node or edge as part of the smart-contract lane when any of these are true:

- node kind is `contract`;
- node display kind is one of the known smart-contract display kinds;
- node metadata role is `contract_driven_contract`;
- edge metadata `evidenceType` is `contract_trigger_context`;
- edge metadata `evidenceType` is `contract_driven_transfer`;
- an edge connects an ordinary wallet to a contract node.

This is intentionally structural. It should not depend on a specific contract name like `Verify20` or `VerifyAccount`.

### Wallet Clusters Mode

Keep ordinary wallet roles in the main cluster lanes:

```text
source -> intermediate -> subject -> outgoing
```

Place contract nodes in a dedicated contract lane below or beside that main cluster. The contract lane should keep the same x-ordering relationship where possible:

- contracts connected to sources sit closer to those source lanes;
- contracts feeding the subject sit between source and subject x positions when possible;
- many contracts can stack vertically inside the contract lane;
- repeated low-priority contract nodes may collapse only when needed for density.

The ordinary wallet cluster should remain readable even when many contract trigger edges exist.

### Deep Branch Map Mode

Keep the branch map readable by separating contract scenes from branch wallet paths.

For each branch:

- ordinary branch wallets remain in the branch path;
- smart contracts connected to that branch move into a branch-local contract lane;
- contract trigger edges remain visible but visually secondary;
- contract-driven transfer edges retain their distinct non-gray style.

If branch-local placement is too dense, fall back to a global contract lane instead of mixing contracts into wallet paths.

### Show All Raw Mode

`Show all raw` should remain complete, not clean. It should still show all eligible nodes and edges.

But even in raw mode, contract nodes should be placed in a smart-contract lane rather than randomly inside wallet lanes. Raw mode may show more caller/operator context than default modes, but wallet-to-contract links must still be visually distinguishable from wallet-to-wallet transfers.

### Edge Styling

Keep the existing semantic split:

- `contract_trigger_context`: thin dashed violet context edge, no amount chip;
- `contract_driven_transfer`: non-gray contract-driven movement edge, amount/time only when label mode allows it;
- normal wallet transfer: existing wallet-transfer styling;
- service/boundary context: existing service/boundary styling.

The important rule: a wallet-to-contract context edge should never look like a normal wallet-to-wallet transfer.

### Selection And Details

Selecting a contract-lane item should explain:

- source wallet;
- contract address/name;
- method when available;
- subject/receiver wallet;
- related transaction hash;
- amount and time for the real contract-driven transfer;
- that the trigger edge is context, not an ordinary transfer.

Existing right-rail details for `contract_trigger_context` and `contract_driven_transfer` should be reused where possible.

## Non-Goals

- Do not change DeepCheck fetching.
- Do not change scoring.
- Do not add new dependencies.
- Do not rewrite the admin console framework.
- Do not invent missing contract evidence.
- Do not hide raw evidence permanently.
- Do not classify all contracts as malicious just because they are shown in the smart-contract lane.

## Acceptance Criteria

1. `Wallet clusters` places wallet-to-contract scenes in a separate smart-contract lane.

2. `Deep branch map` separates smart-contract scenes from ordinary wallet branch paths.

3. `Show all raw` still shows all eligible evidence but places smart-contract nodes/edges separately from ordinary wallet lanes.

4. Any wallet-to-contract relationship uses contract/context styling, not normal wallet-transfer styling.

5. Ordinary wallet-to-wallet clusters remain readable when contract evidence exists.

6. `contract_trigger_context` remains context and does not show as a normal transfer row.

7. `contract_driven_transfer` remains visible as smart-contract-mediated USDT movement and keeps its underlying source/receiver evidence in the details panel.

8. Existing jobs without smart-contract evidence render as before.

9. Contract separation applies generically to any wallet-to-smart-contract relationship, not only `Verify20`.

10. Tests cover the three modes: wallet clusters, deep branch map, and show all raw.

## Test Plan

Add focused tests in the existing admin graph/UI test files:

- presentation helper detects contract-scene nodes and edges;
- wallet cluster layout assigns contract nodes to a contract lane;
- deep branch map layout does not place contract nodes inside ordinary wallet branch lanes;
- show-all/timeline layout keeps contract nodes on a contract lane;
- edge class tests confirm `contract_trigger_context` and wallet-to-contract context do not look like ordinary wallet transfer edges;
- regression fixture with `source wallet -> contract -> subject` confirms ordinary wallet cluster remains separate.

## Spec Self-Review

- Marker scan: no unresolved filler markers remain.
- Consistency check: the design uses one approved model, the smart-contract lane, across all requested modes.
- Scope check: this is presentation/layout only; evidence collection and scoring stay out of scope.
- Ambiguity check: "deep range map" from the user request is interpreted as the existing `Deep branch map` graph mode unless product copy later renames it.
