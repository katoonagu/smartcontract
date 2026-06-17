# Where Is Money: Hybrid Corridor Policy

## Summary

`Where is money?` should run as a hybrid research mode, not as a single narrow origin trace.

The mode starts from the current TRON USDT balance, selects the inbound transfers that approximately formed that balance, and then analyzes the whole balance-forming corridor:

```text
source / exchange / service / EOA -> funding actor -> balance-forming sender -> checked wallet
```

For exchange-operator decisions, the system must combine:

1. balance-forming transfer selection;
2. exact origin trace for the selected balance-forming amounts;
3. fast wallet checks for the checked wallet and important corridor actors;
4. wider sender/upstream interaction exposure;
5. approval-drain provenance checks for corridor actors;
6. deep research on dense or suspicious corridor actors.

The final answer remains an exchange decision:

```text
ACCEPTABLE | REVIEW | DECLINE
```

and a score:

```text
riskScore / 100
```

## Product Scenario

An exchange customer shows a wallet balance and wants to exchange the funds. The operator needs to know whether the visible balance is acceptable to receive.

The system should not review the whole wallet history as a generic wallet-risk report. It should first identify the few recent inbound USDT transfers that explain the current balance, then follow and inspect the wallets that formed those transfers.

The key user workflow is:

1. Check current USDT balance.
2. Identify the inbound transfers that formed that balance.
3. Open each sender.
4. Inspect the sender's own funding and interactions.
5. Continue into funding actors when they look dense, exchange-like, or suspicious.
6. Make one operational decision for the exchange.

## Example Case

Checked wallet:

```text
TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf
```

Visible balance is approximately 4,982 USDT. The balance is formed by three inbound transfers:

```text
TR6gQmmPUw1PjiSsvcXMV9BbbUUEFuZhxG -> checked wallet: 2,576 USDT
TE729K7cJtxSGHPEQLf18oDT2V7qAj6Jsp -> checked wallet: 1,123 USDT
TTaQRfn1MuPMctBzzkc7hD1nv61UzBkvyx -> checked wallet: 1,283 USDT
```

Observed manual review:

- `TTaQRfn1MuPMctBzzkc7hD1nv61UzBkvyx` is acceptable-looking because it receives the same amount from `Binance-Hot 4` and quickly sends it onward.
- `TE729K7cJtxSGHPEQLf18oDT2V7qAj6Jsp` has a small direct WhiteBIT interaction and receives the balance-forming amount from `TUkbr1bt9sP7AZYjCtrguSnn9MDAWuHNTP`.
- `TUkbr1bt9sP7AZYjCtrguSnn9MDAWuHNTP` has many interactions and visible WhiteBIT/HTX-like exchange exposure.
- `TR6gQmmPUw1PjiSsvcXMV9BbbUUEFuZhxG` receives the balance-forming amount from `TWfRygnbXiQukvfzNnNezmcMXLPg5Tooqf`.
- `TWfRygnbXiQukvfzNnNezmcMXLPg5Tooqf` looks like a dense exchange/OTC/transit actor and needs wider scan before accepting the leg.

This case must not stay a plain `REVIEW` only because the exact amount path did not hit a risky boundary. WhiteBIT/HTX exposure inside the balance-forming corridor is relevant to the exchange decision.

## Core Rule

Any direct HTX/Huobi or WhiteBIT interaction involving one of these actors is a policy-decline signal:

- checked wallet;
- balance-forming sender;
- upstream funding actor on a selected balance-forming path;
- dense corridor actor selected for deep expansion.

For MVP:

```text
direct HTX/Huobi or WhiteBIT exposure in the balance-forming corridor => DECLINE / HIGH
```

This rule applies even when the interaction amount is small. The amount and proximity should still be reported because they explain severity and confidence, but they do not make the exchange decision acceptable.

Exact approval-drain provenance is a stronger rule:

```text
exact approval-drain provenance in the balance-forming corridor => DECLINE / CRITICAL
```

This means the system found a USDT `transferFrom` drain backed by a prior approval for the spender, and the drained funds are linked to the checked balance within the supported hop window.

## Corridor Actor Selection

The system should inspect these actors:

1. The checked wallet.
2. Every selected balance-forming sender.
3. Every funding candidate that explains a balance-forming transfer with meaningful amount preservation.
4. Additional top counterparties of selected senders when they are:
   - tagged HTX/Huobi/WhiteBIT;
   - tagged bridge/router/DEX;
   - high-volume relative to the balance;
   - temporally close to the balance-forming transfer;
   - dense enough to look like an exchange/OTC/transit wallet.

Default MVP caps:

```text
max corridor actors: 25
max transfer pages per actor: 3
page size: 50
trace max depth: 7
deep expansion depth for dense actors: 2
```

The caps are technical limits, not product rules. If the system stops because of caps, the report must mark coverage as partial.

## Actor Exposure Model

For every corridor actor, compute an interaction profile:

```ts
type CorridorActorExposure = {
  address: string;
  role:
    | "checked_wallet"
    | "balance_sender"
    | "funding_actor"
    | "dense_counterparty";
  incomingVolumeRaw: string;
  outgoingVolumeRaw: string;
  incomingTxCount: number;
  outgoingTxCount: number;
  topIncomingCounterparties: CounterpartySummary[];
  topOutgoingCounterparties: CounterpartySummary[];
  taggedInteractions: TaggedInteraction[];
  serviceExposure: {
    htxHuobiVolumeRaw: string;
    whitebitVolumeRaw: string;
    allowlistedCexVolumeRaw: string;
    bridgeDexRouterVolumeRaw: string;
  };
  approvalDrainProvenance: ApprovalDrainProvenanceProfile | null;
  behaviorHints: Array<
    | "single_use_transit"
    | "dense_exchange_like"
    | "fan_in_fan_out"
    | "fast_forwarding"
    | "old_unrelated_activity"
  >;
};
```

`taggedInteractions` should include both directions and preserve evidence:

```ts
type TaggedInteraction = {
  txHash: string;
  direction: "incoming" | "outgoing";
  counterpartyAddress: string;
  counterpartyTag: string;
  serviceFamily:
    | "allowlisted_cex"
    | "htx_huobi"
    | "whitebit"
    | "bridge_router_dex"
    | "unknown_service";
  amountRaw: string;
  timestamp: string;
  distanceFromBalancePath: number;
};
```

Provider tags from TronScan transfer rows must be used as evidence when local metadata is absent:

```text
from_address_tag
to_address_tag
```

Examples:

```text
WhiteBIT
HTX
Huobi
Binance-Hot 4
Binance-Hot 6
Bybit
```

## Approval-Drain Provenance

The existing approval-drain detector should be part of `Where is money?` corridor research.

For every checked wallet and selected corridor actor, the system should build an edge set that includes:

- the actor's related USDT transfers;
- balance-forming path edges;
- upstream funding edges;
- candidate receiver-to-subject route edges.

Then it should run approval-drain provenance detection over that edge set:

```text
victim approval -> spender EOA/contract -> transferFrom drain -> first receiver -> ... -> corridor actor / checked wallet
```

A positive result requires:

- the drain edge is `transferFrom`;
- `getTransaction(drainTxHash)` identifies the caller/spender;
- `listTrc20ApprovalChanges(owner=victim, spender=caller, token=USDT)` finds a valid prior approval;
- the route from first receiver to the checked wallet or corridor actor preserves enough amount;
- the route does not cross an exchange, bridge, router, DEX, or other service boundary where exact continuity should stop.

When found, approval-drain provenance must be reported as exact high-confidence evidence. It is not a generic wallet-risk hint.

## Decision Policy

### ACCEPTABLE

Return `ACCEPTABLE` only when all selected balance-forming legs are explained by allowlisted CEX origins through clean EOA hops, and corridor exposure does not include decline sources.

Example:

```text
Binance-Hot 4 -> TTaQR -> checked wallet
```

This leg is acceptable if no decline exposure is found on `TTaQR` or the checked wallet.

### DECLINE / HIGH

Return `DECLINE` when any selected balance-forming corridor has direct exposure to:

```text
HTX / Huobi
WhiteBIT
bridge
router
DEX
unknown risky contract
stablecoin blacklist
approval-drain provenance
exact high-risk label
```

Suggested score bands:

```text
Direct HTX/Huobi or WhiteBIT in exact amount path: 78-85
Direct HTX/Huobi or WhiteBIT on balance-forming sender: 75-85
Direct HTX/Huobi or WhiteBIT on upstream funding actor: 70-82
Dense actor with repeated HTX/Huobi/WhiteBIT exposure: 75-88
Bridge/router/DEX in exact amount path: 75-85
Bridge/router/DEX side exposure in corridor: 65-78
Approval-drain provenance, direct first receiver: 90-100
Approval-drain provenance, one-hop route linked: 80-90
Approval-drain provenance, two-hop route linked: 70-85
Exact blacklist/scam/phishing/stolen/approval-drain: 85-100
```

For MVP, direct HTX/Huobi/WhiteBIT exposure should produce at least:

```text
DECLINE, riskScore >= 70, riskLevel HIGH
```

### REVIEW

Return `REVIEW` when:

- the path remains a clean EOA chain with no known good origin;
- provider data is incomplete;
- dense actor classification is uncertain;
- exposure exists only outside the corridor and cannot be connected to the balance-forming flow;
- only allowlisted CEX exposure is found but the amount path is incomplete.

## Fast + Deep Execution Flow

The mode should run in this order:

```text
1. Fast checked-wallet risk
2. Current USDT balance lookup
3. Balance-forming transfer selection
4. Origin trace per selected transfer
5. Fast risk for selected senders and funding actors
6. Corridor interaction scan
7. Approval-drain provenance scan over corridor edge sets
8. Deep expansion for dense or tagged corridor actors
9. Policy decision composition
10. Operational report
```

Fast checks are exact/high-confidence checks:

- internal labels;
- stablecoin blacklist;
- exact risky labels;
- direct provider tags on the actor.

Deep checks are graph/context checks:

- multiple transfer pages;
- top counterparties;
- repeated exchange interactions;
- fast-forwarding behavior;
- fan-in/fan-out behavior;
- bridge/router/DEX adjacency.
- approval-drain transferFrom and approval evidence.

## Report UX

The report should show:

```text
Decision: DECLINE
Risk: 78/100 HIGH

Main reason:
Balance-forming corridor has direct WhiteBIT exposure through TE729/TUkbr branch.

Balance-forming transfers:
- TR6g -> checked wallet: 2,576 USDT
- TE729 -> checked wallet: 1,123 USDT
- TTaQR -> checked wallet: 1,283 USDT

Legs:
- TTaQR leg: Binance-Hot 4 -> TTaQR -> checked wallet. Acceptable leg.
- TE729 leg: TUkbr -> TE729 -> checked wallet. Decline exposure: WhiteBIT direct interaction on TE729 and repeated WhiteBIT exposure on TUkbr.
- TR6g leg: TWfRy -> TR6g -> checked wallet. Needs dense actor scan; show top exchange exposures.

Fast checks:
- checked wallet: no direct blacklist
- TE729: WhiteBIT exposure
- TUkbr: repeated WhiteBIT/HTX exposure

Approval-drain checks:
- no exact approval-drain provenance found
- if found: show victim, spender, approval tx, drain tx, path, amount preservation

Coverage:
- balance coverage: 100%
- corridor actors scanned: N
- transfer rows scanned: N
- partial: yes/no
```

## Non-Goals

- Do not claim exact UTXO-style provenance.
- Do not sum every unrelated historical interaction into the balance risk.
- Do not downgrade an exact policy-decline source because the interaction amount is small.
- Do not infer approval-drain evidence from transfer shape alone; require approval plus transferFrom evidence.
- Do not call a wallet scam/fraud/blacklisted without exact evidence.
- Do not make Telegram wiring part of this spec.

## Testing Requirements

Unit tests:

- `Binance-Hot 4 -> clean EOA -> checked wallet` remains acceptable when no decline exposure exists.
- Direct WhiteBIT exposure on a balance-forming sender returns `DECLINE / HIGH`, even when the WhiteBIT amount is small.
- Direct WhiteBIT/HTX exposure on an upstream funding actor returns `DECLINE / HIGH`.
- Dense actor with repeated WhiteBIT/HTX interactions returns `DECLINE / HIGH`.
- Dense actor with only Binance/Bybit/OKX exposure and clean amount path does not decline by itself.
- Provider tags from `from_address_tag` and `to_address_tag` are parsed from live TronScan transfer rows.
- Exact approval-drain provenance in a corridor actor returns `DECLINE / CRITICAL` when the actor is the first receiver.
- One-hop approval-drain provenance from first receiver to a balance-forming sender returns `DECLINE / HIGH` or stronger.
- Approval-drain-like transfers without a valid prior approval stay `REVIEW`, not `DECLINE`.
- Incomplete provider data returns `REVIEW`, not `ACCEPTABLE`.

Integration test:

- Use the `TS3ga...` fixture shape:
  - one acceptable Binance leg;
  - one TE729/TUkbr leg with WhiteBIT exposure;
  - one TR6g/TWfRy dense actor leg.
- Expected result: `DECLINE`, `riskScore >= 70`, with the main reason naming the WhiteBIT/HTX corridor exposure.
- Add an approval-drain fixture where a `transferFrom` drain routes into a balance-forming sender. Expected result: `DECLINE`, `riskScore >= 80`, with approval tx, drain tx, spender, victim, and path evidence.

CLI smoke:

- The report prints:
  - balance-forming transfers;
  - origin steps with amounts;
  - corridor actor exposures;
  - tagged HTX/WhiteBIT/Bybit/Binance interactions;
  - approval-drain provenance section;
  - final decision and score.
