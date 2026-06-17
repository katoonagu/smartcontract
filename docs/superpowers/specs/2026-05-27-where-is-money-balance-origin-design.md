# Where Is Money: Balance-Origin Research Mode

## Summary

`Where is money?` is a new hybrid research mode for exchange-operator workflows. It answers a narrow operational question:

> What recent USDT inflows likely formed the current wallet balance, and are those sources acceptable for exchange policy?

The mode combines:

1. A fast wallet check for direct wallet risk.
2. A balance-forming origin check for the current TRON USDT balance.
3. A bounded origin trace for the selected balance-forming transfers.
4. A separate exchange decision: `ACCEPTABLE`, `REVIEW`, or `DECLINE`.

This is intentionally narrower than full wallet provenance. It should not analyze every historical inbound transfer when only a few recent transfers explain the current balance.

## Core Assumption

TRON USDT is account-based, not UTXO-based. The system cannot prove that specific inbound token units are the exact units now sitting in the account.

The report must describe this as an approximation:

```text
Balance-forming approximation: latest inbound USDT flows sufficient to explain the current wallet balance.
```

The system must not claim exact UTXO-style provenance.

## Goals

- Explain the current USDT balance for a checked wallet.
- Focus deep research on recent inbound transfers that cover the current balance.
- Run a fast wallet-level risk check alongside balance-origin analysis.
- Treat clean EOA chains from allowlisted CEX sources as acceptable, without treating hop count alone as risk.
- Treat bridge/router/DEX/HTX/Huobi/WhiteBIT in a balance-forming origin path as automatic `HIGH / DECLINE` for MVP.
- Mark incomplete clean EOA chains as `REVIEW / INCOMPLETE`, not `ACCEPTABLE`.
- Keep exchange-policy decline separate from exact scam/blacklist proof.

## Non-Goals

- Do not build full historical wallet provenance in this mode.
- Do not create UTXO-style proof claims.
- Do not continue exact proof through CEX, bridge, router, DEX, or unknown-contract boundaries.
- Do not label a wallet as scam, fraud, or blacklisted without exact evidence.
- Do not treat hop count alone as suspicious when the path remains a clean EOA chain.

## Architecture

Add a separate check layer instead of overloading the existing deep forensic check:

```text
runWhereIsMoneyCheck(address)
  -> fetch current TRON USDT balance
  -> run existing fast wallet check
  -> collect recent inbound USDT transfers
  -> choose balance-forming inbound transfers
  -> trace each selected inbound transfer backward
  -> classify each origin path
  -> compose final exchange decision
```

New files:

```text
src/check/whereIsMoneyCheck.ts
src/forensics/balanceFormingTransfers.ts
src/forensics/moneyOriginTrace.ts
src/forensics/moneyOriginPolicy.ts
```

Tests:

```text
tests/check/whereIsMoneyCheck.test.ts
tests/forensics/balanceFormingTransfers.test.ts
tests/forensics/moneyOriginTrace.test.ts
tests/forensics/moneyOriginPolicy.test.ts
```

Reuse existing modules where possible:

```text
src/check/deepForensicCheck.ts
src/forensics/counterpartyInteraction.ts
src/forensics/temporalBeamSearch.ts
src/forensics/multiHopBoundaryExposure.ts
src/forensics/serviceClassifier.ts
src/risk/riskPolicy.ts
```

## Proposed API

```ts
runWhereIsMoneyCheck(deps, {
  sourceAddress,
  windowStart,
  windowEnd,
  maxDepth: 7,
  beamWidth: 8,
  maxAddressFetches: 60,
  maxEdgesPerAddress: 40
})
```

Add a dependency for the current token balance:

```ts
getTrc20Balance(address, tokenContractAddress)
```

For MVP, the target amount is the current wallet USDT balance, approximately. The user does not provide a separate exchange amount.

## Data Model

```ts
type ExchangeDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE";

type BalanceFormingTransfer = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
  coverageShare: number;
  selectedReason: "covers_current_balance";
};

type MoneyOriginRootSourceType =
  | "allowlist_cex"
  | "decline_boundary"
  | "risky_label"
  | "unknown"
  | "incomplete";

type MoneyOriginPath = {
  balanceTransferTxHash: string;
  rootSourceAddress: string | null;
  rootSourceType: MoneyOriginRootSourceType;
  pathAddresses: string[];
  txHashes: string[];
  amountPreservationRatio: number;
  timeSpanMs: number | null;
  stoppedReason:
    | "allowlist_cex_reached"
    | "decline_boundary_reached"
    | "risky_label_reached"
    | "data_budget_exhausted"
    | "no_previous_transfer"
    | "weak_amount_or_time_continuity"
    | "unlabeled_service_boundary";
  verdict: ExchangeDecision;
  riskScoreContribution: number;
  reasons: string[];
};

type WhereIsMoneyReport = {
  subjectAddress: string;
  currentUsdtBalanceRaw: string;
  fastWalletRisk: unknown;
  balanceFormingTransfers: BalanceFormingTransfer[];
  originPaths: MoneyOriginPath[];
  decision: ExchangeDecision;
  riskScore: number;
  decisionReasons: string[];
  coverage: {
    selectedInboundTxCount: number;
    selectedInboundVolumeRaw: string;
    currentBalanceCoverageRatio: number;
    maxDepth: number;
    fetchedAddressCount: number;
    partial: boolean;
    notes: string[];
  };
};
```

## Balance-Forming Transfer Selection

Selection uses a LIFO-style approximation:

1. Fetch current TRON USDT balance for the checked address.
2. Fetch recent inbound official TRON USDT transfers.
3. Sort inbound transfers newest first.
4. Select transfers until selected volume covers the current balance plus a small tolerance.
5. Ignore older inbound transfers for the main `Where is money?` origin trace.

If current balance is zero, very small, or no inbound transfers can explain it, return `REVIEW / INCOMPLETE` with a coverage note.

Suggested MVP tolerance:

```text
coverage target: current balance >= 95% explained by selected inflows
```

If the selected transfers cover less than the target because data is incomplete, the report remains partial.

## Origin Trace Algorithm

For each selected balance-forming transfer:

```text
sender -> checked wallet
```

Trace backward from `sender`, trying to explain the transferred amount.

Candidate previous transfers:

- inbound to the current trace address;
- timestamp before the outgoing transfer being explained;
- strong amount preservation at `>= 95%`;
- acceptable amount preservation at `>= 70%`;
- strong time proximity at `<= 1h`;
- acceptable time proximity at `<= 24h`;
- if multiple candidates exist, rank by amount preservation, time proximity, labels, and service category;
- if funds are split or fan-in, allow multiple candidates when their combined amount explains the outgoing transfer.

Product depth:

```text
No hard product depth limit for clean EOA chains.
```

MVP technical caps:

```text
maxDepth default: 7
beamWidth default: 8
maxAddressFetches default: 60
maxEdgesPerAddress default: 40
```

If the trace hits the technical cap while still on a clean EOA chain, the path is `REVIEW / INCOMPLETE`.

## Source Policy

### Acceptable Sources

The path can be `ACCEPTABLE` when it reaches an allowlisted CEX and all later hops are clean EOAs:

```text
Binance -> B -> C -> D -> checked wallet
```

Hop count alone does not raise risk.

Initial allowlist:

```text
Binance
Bybit
OKX
Coinbase
Kraken
KuCoin
Gate
Bitget
MEXC
Bitstamp
Crypto.com
```

This allowlist should be policy-driven and easy to change.

### Decline Sources

For MVP, any of these in a balance-forming origin path is automatic `HIGH / DECLINE`:

```text
bridge
router
DEX
HTX/Huobi
WhiteBIT
unknown contract dominating the balance-forming source
scam
phishing
stolen_funds
approval_drain
darknet
stablecoin blacklist
```

If the path looks like this:

```text
Binance -> B -> bridge/router/DEX -> checked wallet
```

the clean CEX origin is not enough. The risky service boundary interrupts the acceptable path, so the final decision is `DECLINE`.

### Review Sources

Return `REVIEW / INCOMPLETE` when:

- the path remains a clean EOA chain but no known good source is reached;
- provider or local data limits stop the trace;
- a service or hot wallet is unlabeled;
- amount or time continuity is too weak;
- cross-chain candidates are weak or incomplete.

## Scoring

The report should expose both:

```text
riskScore /100
exchangeDecision
```

The exchange decision is policy-specific. The risk score expresses AML/forensic severity.

Suggested MVP scoring:

```text
ACCEPTABLE_SOURCE
- allowlist CEX reached through clean EOA chain: 0-10

REVIEW / INCOMPLETE
- clean EOA chain but no known good origin: 30-50
- unlabeled exchange/hot wallet: 40-60
- weak amount/time continuity: 35-55

DECLINE / HIGH
- bridge/router/DEX in balance-forming path: 70-85
- HTX/Huobi in path: 70-85
- WhiteBIT in path: 70-85
- unknown contract dominates current balance: 60-80
- exact scam/phishing/stolen/blacklist/approval-drain/darknet: 85-100
```

The final report score should be driven by the maximum severe balance-forming path plus fast-wallet exact evidence. Do not sum unrelated weak signals into a misleading score.

## Report UX

The report should be concise and operational:

```text
Where is money?

Current USDT balance: 5,018.42
Balance-forming transfers: 3 txs, covering ~99.4% of current balance

Decision: DECLINE
Risk: 78/100 HIGH

Main reason:
72% of the current balance traces through a router/DEX boundary.

Path:
Binance -> clean EOA -> router/DEX -> checked wallet

Fast wallet check:
No direct blacklist.
No approval-drain evidence.
No internal scam label.

Coverage:
Partial/complete, depth, fetched addresses, stopped boundaries.
```

Required wording for service-boundary policy declines:

```text
This is an exchange-policy decline source. Public-chain continuity after the service boundary should not be assumed.
```

Forbidden wording unless exact evidence exists:

```text
confirmed scam
fraud proven
black wallet
blacklisted
```

## Error Handling And Coverage

Provider, local-index, or TronScan failures must not silently produce `ACCEPTABLE`.

Rules:

- Balance unavailable: `REVIEW / INCOMPLETE`.
- Inbound transfer history unavailable: `REVIEW / INCOMPLETE`.
- Trace budget exhausted on clean EOA chain: `REVIEW / INCOMPLETE`.
- Label/classification provider partial: preserve the path, add coverage note, do not treat as clean.
- Timeout after a decline boundary is already found: keep `DECLINE`, mark coverage partial.
- Timeout before any meaningful source is found: `REVIEW / INCOMPLETE`.

Coverage notes must name the limiting condition and the configured caps.

## Testing Plan

Unit tests:

- `Binance -> B -> C -> wallet` returns `ACCEPTABLE`.
- `Binance -> B -> C -> D -> wallet` returns `ACCEPTABLE`; hop count alone does not raise risk.
- `Binance -> B -> bridge/router/DEX -> wallet` returns `HIGH / DECLINE`.
- `HTX/Huobi -> wallet` returns `HIGH / DECLINE`.
- `WhiteBIT -> wallet` returns `HIGH / DECLINE`.
- clean EOA chain with no known source reached due to limits returns `REVIEW / INCOMPLETE`.
- exact blacklist/scam/approval-drain path returns `CRITICAL / DECLINE`.
- current balance covered by three latest inbound transfers traces only those transfers and ignores older unrelated inbound transfers.
- provider/data failure does not produce `ACCEPTABLE`.
- report wording does not include forbidden scam/blacklist claims unless exact evidence exists.

Integration tests:

- `runWhereIsMoneyCheck` composes fast wallet risk with balance-forming origin paths.
- balance coverage ratio and selected transfer count are correct.
- partial coverage appears when technical caps stop the trace.
- service-boundary decline reason appears for bridge/router/DEX/HTX/WhiteBIT.

## Rollout

1. Implement pure balance-forming transfer selection.
2. Implement money-origin path policy with fixtures.
3. Implement bounded origin trace using existing transfer/index helpers.
4. Add `runWhereIsMoneyCheck`.
5. Add local CLI:

```text
npm run forensic:where-is-money -- --source <address>
```

6. Add Telegram/admin command after CLI behavior is reviewed:

```text
/where_is_money <address>
```

7. After manual review of real cases, optionally add a compact block to the existing deep report.

## Open Policy Defaults For MVP

These are fixed for the first implementation:

- Target amount is the current wallet USDT balance, approximately.
- Hybrid mode is required: fast wallet check plus balance-forming origin trace.
- Bridge/router/DEX origin or boundary is automatic `HIGH / DECLINE`.
- HTX/Huobi is automatic `HIGH / DECLINE`.
- WhiteBIT is automatic `HIGH / DECLINE`.
- Clean EOA chains from allowlisted CEX sources can be `ACCEPTABLE`.
- Clean EOA chains with no known good source reached are `REVIEW / INCOMPLETE`.
- Hop count alone does not raise risk.

