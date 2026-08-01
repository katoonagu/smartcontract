# Low-Balance Recent Flow Provenance Design

## Problem

`where-is-money` currently answers one main question:

```text
Which inbound USDT transfers explain the wallet's current USDT balance?
```

That works when a customer shows a current balance and wants to exchange that balance.

It breaks down when the checked wallet has already sent funds away. In that case the current balance may be near zero, while the important money movement happened minutes or days earlier.

Example:

```text
current balance: 0.147 USDT
historical inbound: 89,473.15 USDT
later outbound: nearly all funds moved away
```

If the system treats the 89k transfer as "balance-forming coverage" for a 0.147 USDT balance, the report becomes technically misleading. The 89k transfer is relevant wallet history, but it does not form the current balance.

## Goals

1. Add a low-balance mode for ordinary address checks.
2. When current USDT balance is below a threshold, analyze recent meaningful wallet flow instead of current-balance provenance.
3. Prefer the latest meaningful outgoing transaction as the anchor, because a sender may have just sent funds away.
4. Trace funding candidates that likely formed that outgoing transaction.
5. Fall back to recent significant inbound transfers only when no meaningful outgoing exists.
6. Keep current requested-amount and transaction-seeded modes unchanged.
7. Keep incoming deposit alerts transaction-centric.
8. Make reports explicit: recent-flow history is not current-balance coverage.
9. Avoid turning unresolved historical context into automatic high risk when no hard bad evidence exists.

## Non-Goals

- Do not replace requested-amount checks.
- Do not replace incoming deposit provenance risk.
- Do not build a global historical top-transfers report.
- Do not use top-5 transfers over all time.
- Do not rework cross-chain Range/corridor logic in this step.
- Do not change hard evidence policy for scam labels, blacklist, exact approval drain, HTX/Huobi, or configured bridge/router/DEX decline boundaries.

## Design

### Mode Selection

`runWhereIsMoneyCheck` should choose the provenance source in this order:

```text
seedTransfers present:
  transaction_check / explicit seed mode

requestedAmountRaw > 0:
  requested amount current wallet mode

mode === wallet_profile and current balance is zero:
  existing wallet profile zero-balance report

currentBalanceRaw >= LOW_BALANCE_THRESHOLD:
  current_balance mode

currentBalanceRaw < LOW_BALANCE_THRESHOLD:
  recent_flow mode
```

Default threshold:

```text
LOW_BALANCE_THRESHOLD = 1000 USDT
```

This threshold should be configurable through code constants first. Env configuration can be added later if needed.

### Recent Flow Mode

Recent-flow mode asks a different question:

```text
What meaningful money recently passed through this wallet?
```

It does not ask:

```text
What formed the tiny current balance?
```

### Anchor-First Selection

The selector first looks for the latest meaningful outgoing USDT transfer:

```text
wallet -> counterparty
amount >= 1000 USDT
```

If found, this transfer becomes the anchor.

The system then looks backward from that anchor timestamp and selects inbound transfers to the checked wallet that plausibly funded the outgoing anchor. This should reuse the existing cashflow idea from `selectIncomingDepositFundingCandidates`: track prior outgoing spend as overhang, then consume prior inbound transfers as available inventory.

Example:

```text
10:00 A -> wallet 50,000
10:05 B -> wallet 30,000
10:06 wallet -> C 10,000
10:10 wallet -> exchange/customer 65,000
```

For the `65,000` outgoing anchor, the system should select the earlier 50k and 30k inbounds after accounting for the 10k previous spend.

### Coverage Target

For outgoing-anchor mode:

```text
targetAmountRaw = anchorOutgoing.amountRaw
coverageRatio = selected usable inbound amount / anchorOutgoing.amountRaw
```

Good coverage:

```text
>= 80%
```

Partial coverage:

```text
< 80%
```

The system can select up to 10 funding candidates for the anchor.

### Candidate Time Window

Selection should be time-first, not all-time-top-first.

Use staged windows:

```text
1. 24 hours before the anchor
2. 7 days before the anchor
3. 30 days before the anchor
```

If 24h gives enough coverage, stop. If not, widen. This keeps the explanation close to the event while still handling operational wallets where inventory sits for several days.

The first implementation can use the edges already fetched by `fetchCachedEdgesForAddress`. Because live fetches already include a window and latest fallback, this keeps the change scoped.

### Dynamic Significance Threshold

The minimum meaningful transfer should be:

```text
max(1000 USDT, min(10000 USDT, 5% of anchor amount))
```

Examples:

```text
anchor 5,000 USDT    -> min significant 1,000
anchor 89,000 USDT   -> min significant 4,450
anchor 1,000,000 USDT -> min significant 10,000
```

If this filter finds too few candidates, the selector should lower the filter and keep selecting smaller inbounds until it either reaches coverage or hits the candidate cap. This prevents split-payment evasion.

### Fallback: Recent Significant Inbounds

If no meaningful outgoing exists, recent-flow mode falls back to recent significant inbound transfers:

```text
last 5-10 inbound USDT transfers by time
amount >= 1000 USDT
```

This fallback is historical context. It must not be described as current balance provenance.

If fewer than 5 significant inbounds exist, include what exists. If none exist, return a partial no-recent-flow report.

### Reporting

Reports must expose the scope:

```text
Provenance scope: recent_flow
Current balance: 0.147 USDT
Low-balance mode: current balance is too small for balance-origin tracing.
Anchor: latest meaningful outgoing tx
Recent flow coverage: 92%
```

Do not print:

```text
Balance-forming coverage: 100%
```

for recent-flow mode.

Use wording like:

```text
Recent flow transfers
Funding candidates for latest meaningful outgoing
Recent significant inbound history
```

### Scoring Policy

Recent-flow mode should keep hard evidence hard:

```text
exact approval drain -> DECLINE / CRITICAL
scam/blacklist/stolen label -> DECLINE
HTX/Huobi close in path -> DECLINE / HIGH
configured bridge/router/DEX boundary -> DECLINE / HIGH
high-confidence drainer-like LLM verdict with no service-route guard -> DECLINE
```

Weak historical uncertainty should not become high risk by itself:

```text
unresolved EOA chain only -> LOW-MEDIUM
old unknown contract not close to anchor -> weak historical context
working/liquidity wallet with no hard evidence -> ACCEPTABLE / LOW-MEDIUM
```

Unknown contract proximity should matter:

```text
unknown contract within minutes/hours of anchor -> stronger
unknown contract weeks/months before anchor -> weaker
```

### Interaction With Incoming Deposit Risk

Incoming deposit alerts remain transaction-centric:

```text
watched wallet received tx X
trace sender funding before tx X
```

If the user presses `Check sender`, the sender may already have zero balance. A normal address check should then use recent-flow mode and explain that it is analyzing recent wallet flow, not current balance.

### Interaction With LLM Contract Verdicts

LLM should receive complete case files only. If contract metadata/profile/tx details are unavailable because of rate limits or transient errors, retry/wait using the existing LLM enrichment retry gate before calling LLM.

Recent-flow mode should pass the selected anchor and funding candidates into the contract case file context so the LLM can see whether a contract is close to the recent flow or only old historical noise.

The LLM should not browse the internet during a user check. The backend should collect metadata, contract profiles, transaction details, and service-route registry facts first, then pass that closed case file to the LLM. This keeps decisions reproducible and avoids different results for the same wallet because a model found or missed a web page.

### Cross-Chain / DEX / Service-Route Boundary Classifier

The `TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb` trace exposed a broader problem: an LLM can mistake service-route contracts for a drainer when it sees an unverified proxy, an unknown selector, and a large USDT transfer.

LayerZero/OFT is only one example. The same false-positive shape can happen with bridge protocols, bridge aggregators, DEX routers, swap aggregators, stablecoin mint/burn protocols, wrapped-token bridges, gasless relayers, and smart-account infrastructure.

The system needs a deterministic service-boundary classifier before accepting a `drainer_like` LLM verdict as critical evidence.

Reference sources for the registry and categories:

```text
DeFiLlama Bridges: https://defillama.com/bridges
DeFiLlama Bridge Aggregators: https://defillama.com/bridge-aggregators
DeFiLlama DEX Aggregators: https://defillama.com/dex-aggregators
L2BEAT Bridge Risk Framework: https://forum.l2beat.com/t/l2bridge-risk-framework/31
SunSwap TRON DEX: https://sunswap.com/
JustMoney multi-DEX routing: https://book.just.money/jmguide/justmoney-swap/multi-dex-routing
```

The first implementation should classify these service-boundary categories:

```text
cross_chain_bridge:
  LayerZero/OFT, Wormhole, Axelar, Chainlink CCIP, Celer/cBridge,
  Stargate, deBridge, Synapse, Allbridge, Across, Hop,
  Connext/Everclear, Mayan, Symbiosis, Meson, rhino.fi,
  Relay, IBC, Hyperlane, Router Protocol, MAP/Butter Network,
  BTTC, Multichain-like legacy routes, generic wrapped-token bridge.

bridge_aggregator:
  LI.FI/Jumper, Socket/Bungee, Rango, Squid, OKX DEX bridge,
  Rubic-like routes, generic bridge aggregator.

dex_router_or_swap_aggregator:
  Uniswap, PancakeSwap, Curve, Balancer, Sushi, 1inch, 0x,
  ParaSwap, OpenOcean, KyberSwap, Odos, CowSwap, Jupiter,
  SunSwap, JustMoney multi-DEX routing, generic router/pool/pair.

stablecoin_or_wrapped_asset_protocol:
  Circle CCTP, USDT0/OFT, USDD, PSM/GemJoin-like systems,
  canonical bridge tokens, mint/release and burn/mint contracts.

gasless_or_smart_account_service:
  GasFree, paymaster, account abstraction, permit-transfer,
  relayer, meta-transaction and smart-account services.

unknown_service_route:
  unknown contract route with service-like transaction shape,
  economic output, and no deterministic approval-drain proof.
```

Known names are not enough. The classifier must also use generic fingerprints:

```text
labels/names/tags:
  bridge, gateway, endpoint, executor, relayer, router, aggregator,
  swap, pool, pair, OFT, wrapped, portal, token bridge, cctp,
  mint, burn, canonical, paymaster, gasfree, permit.

transaction shape:
  operator/relayer EOA calls a service contract;
  token or bridge contract sends USDT to the checked wallet;
  USDT from-address is a contract, not an ordinary victim EOA;
  service contracts appear together in the same tx;
  there is economic output: swap result, bridge delivery, token receive;
  no deterministic approve -> transferFrom -> checked wallet chain is found.

negative drain evidence:
  contract profile has no direct transferFrom selector;
  spender does not match an approval;
  transferFrom is not confirmed by deterministic transaction decoding;
  route crosses a known service boundary.
```

DEX/router handling:

```text
DEX/router/swap aggregator is not a bridge.
DEX/router/swap aggregator is not direct scam proof.
DEX/router/swap aggregator is still a provenance boundary.
```

If a route reaches Uniswap-like, SunSwap-like, 1inch-like, or generic router/pool infrastructure, the report should say:

```text
Evidence type: DEX/router service boundary
Drainer proof: not proven
Clean origin before swap is not proven
Decision: DECLINE if DEX/router origin is forbidden by policy or if the boundary is close/material
```

When service-route facts are present, the report should not say:

```text
Drainer proof: proven
Evidence type: AI-assisted drainer
Risk: 95 CRITICAL
```

It should say one of:

```text
Evidence type: cross-chain bridge/service boundary
Evidence type: DEX/router service boundary
Evidence type: stablecoin protocol or wrapped-asset boundary
Evidence type: gasless/smart-account service route
Evidence type: unknown service-like route

Drainer proof: not proven
Risk: 55-75 depending on policy, proximity, amount share, and data quality
```

This can still be a valid exchange-policy decline if the business does not accept bridge/cross-chain/DEX/router sources. The important correction is explanation quality: the system must not overclaim "approval drain" without exact approval-drain proof.

### LLM Verdict Precedence

Deterministic facts have priority over the LLM.

Rules:

```text
exact approve -> transferFrom -> checked wallet:
  LLM is not needed for the final decision
  result can be CRITICAL

service-route boundary and no exact drain proof:
  LLM drainer_like cannot produce CRITICAL by itself
  cap risk at HIGH service-boundary policy range

LLM drainer_like with cited transferFrom but deterministic extraction does not confirm transferFrom:
  treat as suspicious explanation, not exact proof

LLM legitimate_service + deterministic service-route evidence:
  classify as service boundary, not clean CEX
```

The case file must make the address roles explicit so the LLM does not call a contract a victim:

```json
{
  "usdtTransfer": {
    "fromAddress": "TFG4w...",
    "fromAddressType": "contract",
    "fromContractName": "UsdtOFT",
    "toAddress": "TPvF4..."
  },
  "calledContracts": [
    { "address": "TAy9x...", "tag": "LayerZero: EndpointV2" },
    { "address": "TKSQr...", "tag": "LayerZero: Executor" },
    { "address": "TFG4w...", "name": "UsdtOFT" },
    { "address": "TR7NH...", "tag": "USDT Token" }
  ],
  "approvalDrainProof": {
    "approveFound": false,
    "transferFromConfirmed": false,
    "spenderMatched": false
  }
}
```

### TPvF4Y Case Interpretation

For `TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb`, current balance was near zero, but the system selected a historical 89k inbound. Under this design the report should say:

```text
Low-balance recent-flow mode triggered.
Analyzed latest meaningful outgoing or recent large flow history.
The 89k transfer is historical flow context, not current balance coverage.
```

If the path reaches LayerZero/OFT/bridge-like infrastructure, the report should state bridge/cross-chain policy context rather than overclaiming exact drain unless deterministic approval-drain proof exists.

The same rule applies to DEX/router, swap aggregator, stablecoin protocol, wrapped-asset, gasless relayer, or unknown service-like infrastructure.

## Acceptance Criteria

1. If current USDT balance is below 1000 and no requested amount or seed transfer is supplied, `where-is-money` uses recent-flow mode.
2. Recent-flow mode first anchors on the latest outgoing USDT transfer of at least 1000 USDT.
3. Funding candidates are selected from inbound transfers before the anchor and account for earlier outgoing spend.
4. If the latest outgoing anchor is absent, the mode selects recent significant inbound transfers by time, not top transfers over all time.
5. Recent-flow reports do not call selected transfers `balance-forming coverage`.
6. Telegram output distinguishes `Current balance origin` from `Recent flow provenance`.
7. Unresolved recent-flow paths without hard bad evidence do not become automatic HIGH.
8. Split payments are not missed solely because each transfer is below 1000 USDT when they collectively fund the anchor.
9. Existing transaction-seeded and requested-amount checks remain unchanged.
10. Incoming deposit risk remains transaction-centric and does not use current sender balance as the source of truth.
11. LayerZero/OFT delivery context is classified as cross-chain service boundary, not exact drainer proof, unless deterministic approval-drain proof exists.
12. DEX/router/swap aggregator context is classified as a provenance boundary, not direct scam proof.
13. Stablecoin protocol, wrapped-asset, gasless relayer, and unknown service-like routes can produce policy risk, but cannot produce `CRITICAL drainer` without exact approval-drain proof.
14. An LLM `drainer_like` verdict is capped below CRITICAL when deterministic facts show service-route context and no confirmed `approve -> transferFrom` chain.
15. Reports distinguish `Drainer proof: not proven` from `Exchange policy decline: service boundary`.
