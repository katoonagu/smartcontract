# Where Is Money Stage 2: Cross-Chain Corridor Analysis

## Summary

`Where is money?` should remain one product workflow with two execution stages:

```text
Stage 1: TRON USDT balance-origin analysis
Stage 2: cross-chain corridor analysis
```

Stage 2 is not a separate public command for MVP. It is a deeper continuation of the same operational question:

> Where did the balance-forming money come from, and is it acceptable for exchange policy?

The first Stage 2 corridor should support the case shape:

```text
TRON USDT recipient
<- bridge / LayerZero / Stargate evidence
<- Ethereum source address / source tx
<- ETH/native funding
<- Uniswap V3 or no-name token liquidity
<- Stargate / LayerZero bridge
<- Arbitrum source
<- Tornado.Cash or mixer funding
```

Range is the primary live cross-chain discovery provider. The implementation must still use an internal provider interface so tests and scoring are not coupled to raw Range payloads.

## Current Code Context

Existing Stage 1 modules:

```text
src/check/whereIsMoneyCheck.ts
src/forensics/balanceFormingTransfers.ts
src/forensics/moneyOriginTrace.ts
src/forensics/moneyOriginPolicy.ts
src/forensics/moneyOriginInteractions.ts
src/forensics/approvalDrainProvenance.ts
src/forensics/contractLlmVerdict.ts
src/forensics/serviceClassifier.ts
```

Important current behavior:

- `runWhereIsMoneyCheck` selects balance-forming inbound TRON USDT transfers.
- `traceMoneyOriginPath` traces same-chain TRON USDT amount continuity backward.
- `moneyOriginPolicy` treats bridge/router/DEX/swap adapter/unknown contract as decline boundaries.
- `REVIEW` is converted to `DECLINE` by safe default at the end of `runWhereIsMoneyCheck`.
- WhiteBIT is now a medium-risk source signal with score by `balanceShare`, not automatic high risk.
- LLM contract analysis is already a bounded verifier for unknown contracts / wrapper-drain-like cases.

Stage 2 must build on this behavior instead of replacing it.

## Product Decisions

Fixed MVP decisions:

```text
Stage 2 is part of Where is money.
MVP cross-chain corridor: TRON -> Ethereum -> Arbitrum.
Range is required for live Stage 2 runtime.
Range must be hidden behind a provider interface.
No-name token liquidity is DECLINE / HIGH.
Tornado or mixer in the corridor is DECLINE / CRITICAL.
<10k single-transfer cases do not auto-run Stage 2 for normal users.
Stage 2 missing/failed data never produces ACCEPTABLE.
```

## Non-Goals

- Do not build a universal cross-chain tracer for every chain in MVP.
- Do not claim exact ownership across chains unless a provider or protocol-level bridge link supports it.
- Do not treat weak amount/time similarity as proof.
- Do not run expensive cross-chain scans for every low-value wallet check.
- Do not let the LLM invent labels, bridge links, token reputation, or sanctions evidence.
- Do not downgrade existing Stage 1 decline policy because Stage 2 is unavailable.

## Execution Flow

Top-level flow:

```text
runWhereIsMoneyCheck(input)
  -> select balance-forming transfers
  -> trace same-chain TRON origin paths
  -> build sender interaction profiles
  -> run approval-drain provenance
  -> run contract LLM analysis when needed
  -> evaluate Stage 2 triggers
  -> run Stage 2 cross-chain expansion when triggered
  -> combine Stage 1 and Stage 2 decisions
  -> format report
```

Stage split:

```text
Stage 1:
  existing TRON USDT balance-origin trace

Stage 1.5:
  cheap precheck of immediate sender / boundary actor / source tx

Stage 2:
  Range-backed cross-chain corridor expansion
```

Stage 1.5 must not walk many hops. It only inspects already-near evidence:

- selected balance-forming transfer sender;
- root source address from `MoneyOriginPath`;
- service classification for boundary actors;
- contract profile / labels for immediate contract boundaries;
- direct internal tx label if already available;
- local label/cache hits;
- Range hit by immediate tx or boundary address when configured.

If a signal requires walking 5-10 more hops to discover, it belongs to Stage 2 and cannot be used as the reason to trigger Stage 2 for smaller amounts.

## Requested Amount Prerequisite

Before Stage 2 implementation, Stage 1 selection needs one small design correction:

```ts
type SelectBalanceFormingTransfersInput = {
  subjectAddress: string;
  currentBalanceRaw: string | null;
  requestedAmountRaw?: string | null;
  edges: ForensicRouteEdge[];
  minCoverageRatio?: number;
};
```

Selection target:

```text
targetAmountRaw = requestedAmountRaw ?? currentBalanceRaw
```

Return shape should expose both current balance and target amount:

```ts
type BalanceFormingSelection = {
  transfers: BalanceFormingTransfer[];
  currentBalanceRaw: string | null;
  requestedAmountRaw: string | null;
  targetAmountRaw: string;
  selectedAmountRaw: string;
  selectedVolumeRaw: string;
  coverageRatio: number;
  currentBalanceCoverageRatio: number;
  selectionMethod: "current_balance" | "requested_amount";
  partial: boolean;
  notes: string[];
};
```

Why this matters:

- normal `where is money` can explain the whole visible wallet balance;
- exchange workflows often care about a requested exchange amount;
- Stage 2 should trigger on the selected balance-forming amount, not always the whole current wallet balance;
- 100k trigger logic needs a clear `targetAmountRaw`.

Compatibility rule:

```text
If requestedAmountRaw is absent, current behavior remains current-balance selection.
```

## Stage 2 Trigger Policy

Use normalized raw USDT amounts with 6 decimals.

MVP auto-run rules for normal users:

### Rule A: Large Single Leg

Run Stage 2 when a selected balance-forming transfer is at least:

```text
100,000 USDT
```

and its immediate path reaches one of:

- bridge;
- bridge pool;
- LayerZero / Stargate / CCTP / Wormhole / Axelar-like contract;
- DEX;
- router;
- swap adapter;
- unknown contract with weak metadata;
- contract sender whose direct internal txs mention cross-chain / bridge behavior;
- direct no-name token liquidity or pool evidence.

### Rule B: Split Flow

Run Stage 2 when multiple selected balance-forming transfers are likely one split flow:

```text
same recipient
same service boundary or same source family
close timestamps
combined selected amount >= 100,000 USDT
```

The split-flow grouping should be conservative. If it is unclear, mark coverage as partial and keep Stage 1 safe-default decline.

### Rule C: Medium Amount With Direct High-Risk Clue

For:

```text
10,000-100,000 USDT
```

run Stage 2 only when Stage 1 or Stage 1.5 already sees a direct high-risk clue on the immediate sender, boundary actor, or source tx:

- Tornado / mixer / sanctioned label;
- exact approval-drain evidence;
- direct no-name token liquidity or pool evidence;
- direct high-risk bridge/DEX contract with weak metadata;
- local cached high-risk label from previous checks.

### Rule D: Low Amount

For:

```text
< 10,000 USDT
```

normal users do not get automatic Stage 2 when this is a single transfer and not part of a selected split flow.

Report behavior:

```text
Stage 1 complete.
Cross-chain boundary visible.
Deep cross-chain analysis not auto-run because amount is below threshold.
```

This is future Pro/deep mode behavior.

## Provider Interfaces

Range is the required live provider for Stage 2 runtime, but the rest of the system depends on an internal interface.

```ts
type ChainId = "tron" | "ethereum" | "arbitrum" | string;

type ChainAddress = {
  chain: ChainId;
  chainId: string | number;
  address: string;
};

type CrossChainDiscoveryQuery = {
  address?: ChainAddress;
  txHash?: string;
  sourceChain?: ChainId;
  destinationChain?: ChainId;
  assetSymbol?: string;
  amountRaw?: string;
  windowStart?: string;
  windowEnd?: string;
  limit?: number;
};

interface CrossChainDiscoveryProvider {
  findTransfersByAddress(input: CrossChainDiscoveryQuery): Promise<CrossChainTransfer[]>;
  findTransfersByTx(input: CrossChainDiscoveryQuery): Promise<CrossChainTransfer[]>;
  getAddressRisk(input: { address: ChainAddress }): Promise<ProviderRiskSnapshot | null>;
}
```

Concrete providers:

```text
RangeCrossChainDiscoveryProvider
FixtureCrossChainDiscoveryProvider
```

Runtime rule:

```text
If Stage 2 is triggered and Range is unavailable, return Stage 2 coverage partial and preserve Stage 1 decision.
```

Tests and CI use fixtures. Production uses Range when `RANGE_API_KEY` exists.

## Evidence Model

Stage 2 must normalize provider payloads into evidence edges.

```ts
type CrossChainEvidenceClass =
  | "exact_onchain"
  | "bridge_provider_correlation"
  | "bridge_protocol_correlation"
  | "service_boundary"
  | "weak_inferred";

type CrossChainEvidenceStrength =
  | "strong"
  | "medium"
  | "weak"
  | "boundary";

type CrossChainEdgeType =
  | "token_transfer"
  | "native_transfer"
  | "internal_transfer"
  | "dex_swap"
  | "liquidity_add"
  | "liquidity_remove"
  | "bridge_source"
  | "bridge_destination"
  | "bridge_protocol_link"
  | "service_boundary"
  | "cex_boundary"
  | "tornado_withdrawal"
  | "unknown_token_liquidity";

type CrossChainRouteEdge = {
  id: string;
  edgeType: CrossChainEdgeType;
  evidenceClass: CrossChainEvidenceClass;
  evidenceStrength: CrossChainEvidenceStrength;
  source: ChainAddress | null;
  destination: ChainAddress | null;
  txHash: string | null;
  sourceTxHash?: string | null;
  destinationTxHash?: string | null;
  blockNumber?: number | null;
  logIndex?: number | null;
  assetSymbol?: string | null;
  tokenContract?: string | null;
  amountRaw?: string | null;
  decimals?: number | null;
  timestamp: string | null;
  protocol?: string | null;
  provider: "range" | "tronscan" | "etherscan" | "alchemy" | "layerzeroscan" | "local";
  providerPayloadId: string | null;
  labels: string[];
};
```

Evidence rules:

- Range cross-chain rows are `bridge_provider_correlation`.
- LayerZero GUID/nonce/source/destination tx links are `bridge_protocol_correlation`.
- Etherscan/TronScan/Arbiscan transfer rows are `exact_onchain`.
- Amount/time similarity without provider/protocol correlation is `weak_inferred`.
- CEX, bridge, router, DEX, Tornado, mixer, and unknown contracts are boundaries, not proof of clean continuity.

## Stage 2 Report Types

```ts
type Stage2TriggerReason =
  | "large_bridge_boundary"
  | "large_split_flow_boundary"
  | "medium_amount_direct_high_risk"
  | "manual_deep_mode";

type CrossChainCorridorPath = {
  id: string;
  triggerReason: Stage2TriggerReason;
  balanceTransferTxHashes: string[];
  targetAmountRaw: string;
  selectedAmountRaw: string;
  edges: CrossChainRouteEdge[];
  terminalBoundary:
    | "tornado_or_mixer"
    | "no_name_token_liquidity"
    | "bridge_boundary"
    | "dex_router_boundary"
    | "cex_boundary"
    | "unknown_contract"
    | "data_exhausted"
    | "none";
  evidenceStrength: CrossChainEvidenceStrength;
  verdict: ExchangeDecision;
  riskScoreContribution: number;
  reasons: string[];
};

type CrossChainCorridorReport = {
  enabled: boolean;
  triggered: boolean;
  skippedReason: string | null;
  paths: CrossChainCorridorPath[];
  providerCalls: number;
  partial: boolean;
  coverageNotes: string[];
};
```

Extend `WhereIsMoneyReport`:

```ts
type WhereIsMoneyReport = {
  ...
  crossChainCorridor?: CrossChainCorridorReport;
};
```

## Scoring Policy

Stage 2 contributes to the final score by maximum severe path, not by summing every weak signal.

Scoring bands:

```text
Tornado / mixer in balance-forming corridor:
  DECLINE, 90-100 CRITICAL

No-name token liquidity in balance-forming corridor:
  DECLINE, 70-85 HIGH

No-name token liquidity + bridge outflow:
  DECLINE, 78-88 HIGH

No-name token liquidity + Tornado upstream/downstream:
  DECLINE, 90-100 CRITICAL

Bridge / DEX / router boundary only:
  DECLINE by exchange policy, 65-78 HIGH depending on amount/share

Weak inferred cross-chain amount/time match only:
  REVIEW or preserve Stage 1 DECLINE, 45-60

Range unavailable after trigger:
  preserve Stage 1 decision, mark Stage 2 partial
```

WhiteBIT compatibility:

```text
WhiteBIT remains medium-risk in Stage 1 policy unless Stage 2 discovers additional high-risk corridor evidence.
```

This keeps the new WhiteBIT scoring from the latest commit intact.

## LLM Contract

The LLM is not a provider of facts.

Allowed:

- summarize normalized evidence;
- explain why Stage 2 triggered;
- explain uncertainty and coverage limits;
- classify no-name token liquidity case files using provided evidence;
- cite tx hashes, addresses, provider payload ids, and evidence ids.

Forbidden:

- inventing labels;
- saying the same person owns all addresses;
- treating weak amount/time links as confirmed bridge evidence;
- calling a wallet a scammer unless exact evidence exists.

Stage 2 can reuse the existing `contractLlmVerdict` pattern, but cross-chain route decisions should remain deterministic first.

## Error Handling

Rules:

- Range missing while Stage 2 is not triggered: no effect.
- Range missing after Stage 2 trigger: `partial=true`; preserve Stage 1 decision.
- Provider timeout after Tornado/no-name liquidity found: keep decline, mark coverage partial.
- Provider timeout before any meaningful Stage 2 evidence: preserve Stage 1 decision and add coverage note.
- Weak inferred cross-chain path: never `ACCEPTABLE`.
- No Stage 2 path found: do not override Stage 1 safe-default decline.

## Report UX

Normal user report should stay compact:

```text
Where is money?

Decision: DECLINE
Risk: 90/100 CRITICAL

Balance-origin:
100,000 USDT came through a bridge boundary.

Cross-chain Stage 2:
Range links the TRON receipt to Ethereum source tx 0x...
Ethereum funding path reaches no-name token liquidity and then an Arbitrum corridor funded by Tornado.Cash.

Main reason:
Balance-forming corridor reaches Tornado.Cash and no-name token liquidity.

Coverage:
Stage 2 provider: Range.
Evidence includes provider-correlated bridge rows and explorer labels.
Weak inferred links are not treated as proof.
```

When skipped:

```text
Cross-chain boundary visible, but Stage 2 was not auto-run because the selected amount is below the normal-user threshold.
```

## Test Fixtures

Required fixture scenarios:

1. `TRON -> bridge boundary`, selected amount `>=100k`, Range returns Ethereum source tx. Stage 2 triggered.
2. Split flow: two 60k USDT bridge receipts through same boundary. Stage 2 triggered by combined 120k.
3. `10k-100k` with direct Tornado label on immediate source. Stage 2 triggered.
4. `10k-100k` with no direct high-risk clue. Stage 2 not triggered.
5. `<10k` single bridge transaction. Stage 2 not triggered, limited coverage note appears.
6. Range unavailable after trigger. Stage 1 decision preserved, Stage 2 partial.
7. Range returns TRON -> Ethereum, Etherscan fixture shows Uniswap V3 liquidity remove for a no-name token. Result `DECLINE / HIGH`.
8. Range returns ETH -> Arbitrum bridge, Arbiscan fixture shows Tornado funding. Result `DECLINE / CRITICAL`.
9. Weak amount/time match without provider/protocol correlation. Result not acceptable.
10. WhiteBIT-only Stage 1 paths stay medium-risk unless Stage 2 finds a stronger corridor signal.
11. Requested amount selection: with `requestedAmountRaw`, Stage 2 evaluates selected amount, not whole current wallet balance.

## Rollout Plan

Implementation should be incremental:

1. Add `requestedAmountRaw` support to balance-forming selection and report types.
2. Add Stage 2 trigger evaluator as a pure module with fixture tests.
3. Add cross-chain evidence types and report extension.
4. Add `CrossChainDiscoveryProvider` and fixture provider.
5. Add Range provider behind the interface.
6. Add Stage 2 corridor expander for TRON -> Ethereum -> Arbitrum.
7. Add no-name token liquidity and Tornado boundary scoring.
8. Wire Stage 2 into `runWhereIsMoneyCheck`.
9. Add report formatting.
10. Add CLI smoke path before Telegram user rollout.

## Design Self-Review

Placeholder scan:

```text
No placeholders remain. All MVP thresholds, provider choices, and policy defaults are explicit.
```

Internal consistency:

```text
Stage 2 preserves existing safe-default decline behavior and does not weaken WhiteBIT medium-risk scoring.
```

Scope check:

```text
MVP is limited to TRON -> Ethereum -> Arbitrum and Range-backed discovery.
```

Ambiguity check:

```text
Stage 1.5 can only use direct nearby evidence. Deeply discovered evidence belongs to Stage 2 and cannot be a pre-trigger for smaller amounts.
```
