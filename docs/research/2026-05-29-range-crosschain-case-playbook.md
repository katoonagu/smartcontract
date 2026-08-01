# Range Cross-Chain Case Playbook For Where Is Money

Date: 2026-05-29

Status: research note / implementation planning input.

Scope: document the manual cross-chain analysis flow from the attached screenshots and map it to a future `where is money` cross-chain analytics module.

## Why This Matters

The current `where is money` logic is strong for TRON USDT balance-origin tracing, but this case shows a deeper pattern:

```text
TRON recipient
  <- LayerZero / bridge transfer
  <- Ethereum EOA / contract activity
  <- Uniswap V3 liquidity remove / collect
  <- no-name token purchase/sale trail
  <- bridge activity again
  <- Arbitrum route
  <- Tornado.Cash funding
```

This is not a 4-5 hop story. The important signal is the corridor: repeated bridges, DEX/Uniswap liquidity events, low-reputation tokens, and finally Tornado funding. A bot should not stop after a small fixed hop count when the amount, timing, and service labels keep pointing to the same laundering route.

Core heuristic from the manual review:

```text
If balance-forming money comes through no-name tokens / unknown token liquidity / bridge corridors, mark it at least HIGH risk unless a clean source is proven.
```

## Case Inputs From The Manual Review

TRON target / destination seen in Range:

```text
TGy...TBZAZD
```

Important EVM addresses:

```text
0x2cFEEE2394aC0f01c92CDaDCb697feC0cF8Da315
0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60
0x6Ca63c963948597EAF85C6A193FedF1d96c62eA7
0xeb2Cdf39fC5Afa85BBa1467e209974d9B19fA68b
```

Known service / bridge address:

```text
Stargate: Pool Native
0x77b2043768d28e9c9ab44e1abfc95944bce57931
```

Ethereum transaction used as the first confirmed EVM anchor:

```text
0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f
```

Observed no-name token from screenshots:

```text
Gary The Snail (GARY)
contract: 0x1996d86e55b33aeef2c9f50b3086a91656a284db
```

The user note says the last screenshot should read `ZAZD`, not the visually similar wrong token/address text.

## Manual Investigation Chain

### 1. Start From TRON And Identify Cross-Chain Bridge Context

On TRON, the first visible clue is that the incoming funds are from a contract, not a normal clean wallet.

Manual logic:

1. Open the incoming transaction/address on TronScan.
2. If money comes from a contract, inspect what the contract is.
3. Internal transaction labels show LayerZero in this case.
4. LayerZero is a cross-chain messaging/bridge family used by many exchanges and bridge flows.
5. Because the recipient address may not appear directly in a generic bridge scanner, search by known receiver / source / amount and use a dedicated cross-chain explorer.

Range Explorer is useful here because it resolves the TRON-side activity into cross-chain transfer rows.

Observed Range rows:

```text
source chain: Ethereum
destination chain: TRON
protocol: LayerZero/Stargate-like bridge icon
asset: USDT
from: 0xacddac6c7731...67c6833e9c05f1
to: TGy...TBZAZD
amounts: repeated 100,000 USDT and 77,201.21 USDT
date: 2026-05-05 around 05:41-05:53 local time in screenshot
```

Interpretation:

- The TRON recipient received multiple large USDT bridge outputs.
- The Ethereum side contains the funding origin that formed these TRON receipts.
- The repeated same-size transfers are stronger than a single isolated event.

### 2. Use The Source Tx To Jump Into Ethereum

From Range, open the source transaction on Ethereum:

```text
https://etherscan.io/tx/0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f
```

Etherscan shows:

```text
Call Execute Function
from: 0x2cFEEE2394aC0f01c92CDaDCb697feC0cF8Da315
to: 0xAcddAC6C...33e9c05f1
amount: 100,000 USDT in the transfer table
```

Manual logic:

1. The sender `0x2cFEEE...Da315` funded the 100k USDT bridge-side movement.
2. Open the sender address, not only the bridge contract.
3. In the sender history, sort around the bridge time.
4. Identify inbound assets that explain the bridge amount.

Observed on `0x2cFEEE...Da315`:

- many outbound `Execute` USDT transfers of 100,000 USDT;
- two inbound ETH transfers around 588 ETH before the 100k outflow batch;
- approximately 30 transactions total;
- activity suggests a short-lived conversion / exchange wallet rather than a normal long-lived wallet.

### 3. Follow ETH Funding Instead Of Only USDT

The Ethereum account received large ETH amounts:

```text
~588.356 ETH
~588.855 ETH
```

From the screenshots, the relevant predecessor is:

```text
0x09d0Acfc56F97d60e554aB199D92eD32e62BF501
```

Manual logic:

1. USDT appears after ETH funding, so switch asset track from USDT to ETH.
2. Open the ETH sender.
3. Inspect internal transactions and token transfers around the same time.
4. Look for DEX / Uniswap V3 / liquidity remove / collect events.

Observed:

- Etherscan transaction around 2026-05-05 02:20 UTC.
- Action: remove liquidity and collect from Uniswap V3.
- Token: Gary The Snail (GARY), a no-name token with tiny holder/transfer counts.
- This implies a token-liquidity extraction path, not a clean exchange withdrawal.

### 4. Inspect The Token, Not Only The Wallet

Open token page:

```text
Gary The Snail (GARY)
0x1996d86e55b33aeef2c9f50b3086a91656a284db
```

Manual logic:

1. A no-name token involved in a large ETH conversion is itself a risk signal.
2. Inspect token transfers, holders, and first buyers/sellers.
3. Click where the same ETH amount went next.
4. Follow the buyer side of the token, not just the seller.

Observed:

- only about 81 holders and 86 transfers in screenshot;
- no clear market cap;
- transfers around the same block/time as the large Uniswap V3 actions;
- multiple small buyers appear, but the same large ETH amount leads to another address.

Interpretation:

- This looks like a staged no-name token / liquidity trick.
- For scoring, the bot should treat "unknown thin token + large liquidity removal + immediate bridge/exchange movement" as HIGH even before exact scam proof.
- The bot must not call it confirmed fraud without exact evidence. It can say "high-risk no-name token liquidity corridor."

### 5. Continue To Another 497 ETH Address

The manual path exits to:

```text
0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60
```

Observed on this address:

- about 7 transactions;
- funded by `Stargate: Pool Native`;
- outgoing 497.67242338 ETH;
- multiple tiny inbound gas/test transactions;
- Range shows two cross-chain transfers into this address:

```text
from: Arbitrum address 0x8e60b7b64b63...cb79b04919286e
to: Ethereum 0x7C3721C33ce9...c8eBB8945e5f60
amounts: 247.77 ETH and 250.00 ETH
protocol: Stargate / LayerZero style
```

Interpretation:

- This is another bridge boundary.
- The ETH that later participated in the no-name token route came from Arbitrum.
- The same amount scale is preserved: 247.77 + 250 ~= 497.77 ETH.

### 6. Jump To Arbitrum And Follow Other Transactions

Range gives the Arbitrum source:

```text
0x6Ca63c963948597EAF85C6A193FedF1d96c62eA7
```

Manual logic:

1. Open the source on Arbitrum explorer.
2. Use "Other Transactions" and internal transaction sections, not only ERC20 transfers.
3. Find where ETH/native funding came from.
4. Continue while amount and timing match.

Observed predecessor:

```text
0xeb2Cdf39fC5Afa85BBa1467e209974d9B19fA68b
```

This address was recognized in Range as `BolshoyJoe` in the screenshots.

### 7. Identify Tornado Funding

On Arbitrum/Ethereum explorer for:

```text
0xeb2Cdf39fC5Afa85BBa1467e209974d9B19fA68b
```

Observed:

- internal transactions show funding from `Tornado.Cash: 100 ETH`;
- several repeated transfers around 99.568 ETH;
- funded about 23 days before screenshot.

Manual interpretation:

- This is the terminal high-risk source for the chain.
- There may be a waiting period between Tornado withdrawals and later movement; do not assume all laundering is immediate.
- The bot should detect this even if the path uses multiple bridges and token-liquidity tricks in between.

## Services Used In The Manual Workflow

### Range Explorer

URL:

```text
https://explorer.range.org/
https://app.range.org/explorers
```

Observed product capabilities:

- search by address / source transaction / destination transaction;
- show live cross-chain transfers;
- filter by protocol, asset, status, source chain, destination chain, and amount;
- show `source tx`, `from`, `to`, `protocol`, `amount`, and local time;
- resolve a TRON-side receiver into source-chain rows;
- reveal bridge protocol context that is not obvious in a single-chain explorer.

Use in our product:

- cross-chain jump discovery;
- bridge source/destination correlation;
- service-boundary classification;
- evidence for "this TRON inflow came from Ethereum via LayerZero/Stargate."

### Etherscan / Arbiscan / Other EVM Explorers

Use cases:

- open source transaction from Range;
- inspect token transfers, internal transactions, logs, and address history;
- identify labels such as `Stargate: Pool Native`, `Uniswap V3: Positions NFT`, `Tornado.Cash: 100 ETH`;
- inspect no-name token pages, holders, transfer counts, and contract metadata.

Important manual sections:

- Transactions;
- Token Transfers (ERC-20);
- Internal Txns;
- Other Transactions;
- Analytics;
- token page Transfers / Holders / Contract.

### TronScan

Use cases:

- confirm incoming TRON transfer;
- inspect internal transactions;
- detect LayerZero-related contract activity;
- start from TRON recipient and decide that this is cross-chain, not just a normal TRC20 sender.

## Range Documentation And API Opportunities

Sources reviewed:

- Range Quickstart: `https://docs.range.org/introduction/quickstart`
- Data API intro: `https://docs.range.org/data-api/data-introduction`
- Address information API: `https://docs.range.org/api-reference/address-information/get-address-information`
- Token transfers API: `https://docs.range.org/api-reference/token-transfers/get-token-transfers`
- Risk API intro: `https://docs.range.org/risk-api/risk-introduction`
- Risk address score API: `https://docs.range.org/risk-api/risk/get-address-risk-score`

### Auth / Base Setup

Range APIs use a Bearer token in the `Authorization` header. The docs show the base API domain:

```text
https://api.range.org
```

Trial keys have strict limits, so our integration must cache raw evidence and avoid repeated full-history scans for the same address.

### Data API Endpoints To Prioritize

High-value endpoints for `where is money`:

| Endpoint family | What it gives | Use in our module |
|---|---|---|
| `address-information` | address metadata/profile | service labels, first/last activity, chain presence |
| `address-token-balances` | holdings by address | identify current asset mix and dust/no-name tokens |
| `transactions` | transaction history by address/chain | same-chain corridor expansion |
| `token-transfers` | token transfer rows | cross-chain and token-flow evidence |
| address payments / explorer native transfers | ETH/native movements | critical because the case switches from USDT to ETH |
| `counterparties` | top counterparties | dense actor / exchange-like wallet scan |
| `address-labels` | labels/tags | bridge/DEX/CEX/Tornado detection |
| `top-senders-receivers` | high-volume sender/receiver summaries | identify fan-in/fan-out actors |

The key lesson from this case: ERC20 transfers alone are insufficient. The trace switched USDT -> ETH -> token liquidity -> ETH -> bridge -> native ETH -> Tornado.

### Token Transfers API Shape

The token transfers endpoint supports parameters such as:

```text
address
chains
contract_address
start_block / end_block
limit / offset
```

Expected useful fields:

```text
hash / tx hash
chain
block_number
timestamp
from / to
asset / token metadata
amount / value
contract address
```

Use:

- build normalized transfer edges;
- fetch source and destination activity around a bridge event;
- detect unknown-token participation around large ETH/USDT movements.

### Risk API v2

Risk v2 can screen addresses and return risk classifications / exposure-style outputs. Use it as a provider signal, not as the whole decision engine.

Product rule:

```text
Range risk result can raise confidence, but our report must preserve exact evidence: tx hash, chain, address, service label, amount, timestamp.
```

Useful integration:

- run Range risk on corridor actors;
- compare provider categories with our local `serviceClassifier`;
- cache risk snapshots with provider payload and timestamp;
- do not silently convert missing Range data into clean risk.

### LLM Tool Boundary Inspired By Range Docs

Range's public docs present the product as a unified data/risk/compliance platform. For our system, the useful design idea is tool boundary separation:

- one tool for address profile;
- one tool for transfers;
- one tool for risk;
- one tool for bridge/cross-chain search;
- one tool for labels/counterparties.

For our LLM usage, the LLM should not be the source of truth. It should:

1. read normalized evidence;
2. summarize a route in human language;
3. suggest next exploration targets;
4. explain why a path is `ACCEPTABLE`, `REVIEW`, or `DECLINE`;
5. never invent missing bridge links or labels.

## Proposed Cross-Chain Module Design Direction

Recommended approach: conservative evidence-aware cross-chain corridor analysis, not a universal "prove everything across chains" tracer.

### Product Placement: Second Stage Of `Where Is Money`

Recommended product shape:

```text
Where is money?
  Stage 1: single-chain balance-origin analysis
  Stage 2: cross-chain corridor analysis
```

This should be a second stage of `where is money`, not a fully separate product, because the user question is still the same:

```text
Where did the current balance-forming money come from?
```

The implementation should still be modular internally. Cross-chain should live behind a separate expander/provider layer so the current TRON-only logic stays stable.

Suggested trigger rules:

- Stage 1 finds a bridge/router/contract sender in a balance-forming path.
- TronScan internal txs or provider labels mention LayerZero, Stargate, bridge, router, CCTP, Wormhole, Axelar, or similar.
- Range Explorer/Data API returns source-chain rows for the checked address or balance-forming sender.
- Same amount appears across chains within a plausible time window.
- A balance-forming sender is a short-lived wallet funded by a bridge or DEX corridor.
- Stage 1 result is `REVIEW / INCOMPLETE` because a service boundary was reached.

Default report behavior:

```text
Run Stage 1 for every `where is money` check.
Run Stage 2 only when cross-chain/service clues appear or when analyst explicitly requests deep mode.
```

This keeps normal checks cheap and fast, while preserving a path to deep analysis for cases like this one.

Current MVP decisions:

```text
MVP chain corridor: TRON -> Ethereum -> Arbitrum.
No-name token liquidity: immediate DECLINE / HIGH, even before Tornado is found.
Tornado/mixer in the corridor: DECLINE / CRITICAL.
Stage 2 is available to normal bot users, but it is trigger-gated to avoid expensive scans on every check.
Range: preferred primary provider for live cross-chain discovery.
```

### Stage 2 Trigger Policy For Normal Bot Users

Stage 2 should not run on every `where is money` request. It should run when a balance-forming transfer is large enough and Stage 1 sees a service/cross-chain boundary.

Important distinction:

```text
Stage 1 = normal TRON balance-origin analysis.
Stage 1.5 = cheap precheck on the boundary actor / direct sender only.
Stage 2 = expensive cross-chain corridor expansion.
```

Signals like Tornado, sanctioned/mixer, approval drain, or no-name token liquidity are not expected to be discovered by a full deep search before Stage 2. They can only trigger Stage 2 for smaller amounts when they are already visible in cheap evidence:

- direct provider label on the boundary actor;
- direct TronScan/Etherscan/Arbiscan label on the sender/contract;
- direct internal tx label such as `Tornado.Cash`, `LayerZero`, `Stargate`, `Uniswap V3`;
- direct token/liquidity clue on the immediate source transaction;
- existing local label/cache hit from previous checks.

If the signal requires walking 5-10 more hops to discover, that is Stage 2 work and should not be used as the reason to start Stage 2.

Recommended MVP trigger:

```text
Run Stage 2 when a balance-forming transfer >= 100,000 USDT reaches:
- bridge;
- bridge pool;
- LayerZero/Stargate/CCTP/Wormhole/Axelar-like contract;
- DEX/router/swap adapter;
- unknown contract with weak metadata;
- no-name token liquidity/pool evidence;
- contract sender where internal txs mention a bridge/cross-chain protocol.
```

Also run Stage 2 when several smaller transfers look like one split flow:

```text
same recipient + same service boundary + close timestamps + total selected balance-forming amount >= 100,000 USDT
```

For smaller amounts:

```text
10,000-100,000 USDT:
- run Stage 2 only when Stage 1/Stage 1.5 already sees a direct high-risk signal on the immediate sender/boundary actor/source tx;
- examples: direct Tornado/mixer/sanctions label, direct approval-drain evidence, direct no-name token liquidity/pool evidence, direct bridge/DEX contract with weak metadata.

< 10,000 USDT:
- do not auto-run Stage 2 for normal users;
- if this is a single small transfer and it is not part of selected balance-forming split flow, stop at Stage 1;
- if a cross-chain boundary is visible, show a limited-coverage note and offer deep cross-chain analysis as future Pro/subscription behavior.
```

This threshold is a cost-control rule, not a safety claim. If Stage 2 is not run because of amount/cost limits, the report must say that cross-chain coverage is limited.

### Domain Model

Use chain-aware node identity:

```ts
type ChainAddress = {
  chain: "tron" | "ethereum" | "arbitrum" | "base" | "bsc" | "polygon" | string;
  chainId: string | number;
  address: string;
};
```

Use typed edges:

```ts
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
```

Every edge must carry:

```text
chain
tx_hash
from
to
asset
token_contract
amount
timestamp
provider
evidence_strength
raw_provider_payload_id
```

### Evidence Strength

Use separate evidence classes:

```text
strong: confirmed same-chain transfer / internal transfer / exact log
strong: Range or bridge provider links source and destination txs
medium: same amount and tight time around known bridge contract
weak: amount/time similarity only
boundary: CEX/router/DEX/bridge/Tornado boundary where continuity should be explicit
```

Never report a weak inferred link as a confirmed route.

### Risk Signals From This Case

High-risk or decline-worthy signals:

- Tornado.Cash funding in the balance-forming corridor;
- repeated bridge hops through Stargate/LayerZero;
- no-name / thin token with low holder count and no credible market metadata;
- Uniswap V3 liquidity remove/collect producing the large ETH amount;
- unknown token liquidity used immediately before bridge/exchange outflow;
- new/short-lived addresses moving only one large amount;
- amount preservation across many hops, e.g. 497 ETH -> 497 ETH -> token liquidity -> 588 ETH -> 100k USDT batches;
- many repeated same-size bridge transfers;
- contract-sourced TRON inflow with no ordinary sender history.

Review signals:

- bridge source exists but destination link is not protocol-confirmed;
- token is unknown but no large liquidity event is observed;
- amount continuity is weak or split/merge is unresolved;
- provider limits stop exploration.

Acceptable only if:

- each balance-forming leg reaches an allowlisted CEX or clean proven source;
- no bridge/router/DEX/Tornado/no-name token liquidity boundary sits inside the corridor;
- coverage is complete enough for the amount being reviewed.

### Algorithm Sketch

1. Start from the checked address and current balance-forming inflows.
2. If the sender is a contract or bridge-like service, query Range by address/tx.
3. Convert Range transfer rows into cross-chain edges.
4. For the source-chain address, inspect:
   - token transfers;
   - native transfers;
   - internal transfers;
   - service labels;
   - funding details.
5. When the asset changes, follow the asset that formed the next outflow amount.
6. When a no-name token appears, open token-level evidence:
   - holder count;
   - transfer count;
   - liquidity pool;
   - large buyer/seller addresses;
   - contract age and verification.
7. Continue while amount preservation and time order remain plausible.
8. Stop at:
   - Tornado / sanctioned mixer;
   - CEX boundary;
   - unsupported provider boundary;
   - technical caps.
9. Compose an operational report with exact evidence and coverage notes.

Default caps should be larger than the current same-chain MVP:

```text
maxDepth: 12
maxCrossChainJumps: 4
maxCorridorActors: 40
maxTransfersPerActor: 150
maxTokenPages: 5
maxWallClockMs: configurable
```

The product should not interpret `maxDepth` as "money is safe if we did not find risk by hop 5." If caps stop the trace, return `REVIEW / INCOMPLETE`.

## Implementation Plan Candidate

### Provider Stack

Range alone is not enough for production. It should be the primary cross-chain discovery/enrichment provider, but not the only evidence source.

Recommended stack:

| Provider / source | Role | Why needed |
|---|---|---|
| Range Data API / Explorer | primary cross-chain discovery and enrichment | source/destination chain, protocol, source tx, destination tx, transfer amount |
| TronScan API | TRON stage-1 evidence | TRC20 transfers, internal txs, contract interactions, labels |
| Etherscan V2 / Arbiscan / Basescan | EVM evidence | ERC20 transfers, native transfers, internal txs, logs, labels, token pages |
| Alchemy Transfers API | EVM/L2 fallback collector | indexed transfer history when explorer APIs are incomplete or rate-limited |
| LayerZeroScan / Stargate-specific evidence | bridge protocol correlation | GUID/nonce/source tx/destination tx confidence where available |
| WormholeScan / LI.FI / bridge-specific APIs | other bridge families | exact bridge status/correlation for non-LayerZero routes |
| DexScreener / CoinGecko / Uniswap V3 data | no-name token and liquidity risk | liquidity, pairs, market metadata, token age, weak market signals |
| local label/evidence store | stable policy and reproducibility | Tornado, Stargate, LayerZero endpoints, Uniswap V3, CEX/hot wallets, sanctioned/mixer/contracts |

Product rule:

```text
Provider risk scores can enrich confidence, but final decisions must cite normalized evidence:
chain, tx hash, address, asset, amount, timestamp, label source, provider payload id.
```

### Free API Reality

Range free tier is suitable for prototype/manual analyst mode only.

Current documented Range Data API limits:

```text
Free: 10 requests/minute, 100 requests/month
Pro: 100 requests/minute, 10,000 requests/month
```

Implication:

- one deep cross-chain case can consume 5-20 Range requests;
- full evidence collection also needs explorer/provider calls outside Range;
- free Range is enough for fixtures, smoke tests, and a few manual investigations;
- free Range is not enough for a production Telegram bot or repeated automatic deep checks.

Required product controls:

- cache every provider response;
- store raw payloads and normalized evidence;
- dedupe calls by `(provider, endpoint, chain, address/tx, window)`;
- add budget caps per check;
- run Stage 2 only on explicit triggers;
- if quotas or data fail, return `REVIEW / INCOMPLETE`, never `ACCEPTABLE`.

### Range Integration Options

Option A: live Range required from the first implementation.

Pros:

- fastest path to real cross-chain discovery;
- close to the manual workflow from this case;
- lets the bot detect TRON -> Ethereum/Arbitrum bridge corridors immediately.

Cons:

- tests and local development need mocked responses;
- Range outages/quotas can block Stage 2;
- free tier is too small for production-like usage;
- product behavior may drift if Range response schemas or labels change.

Option B: provider interface + fixtures first, live Range later.

Meaning:

```text
Build our code against an internal interface, not directly against Range calls.
Use deterministic saved JSON fixtures that look like Range responses.
Implement and test scoring/reporting using those fixtures.
Add the real Range HTTP client behind the same interface after the behavior is stable.
```

Example:

```ts
interface CrossChainDiscoveryProvider {
  findTransfersByAddress(input): Promise<CrossChainTransfer[]>;
  findTransfersByTx(input): Promise<CrossChainTransfer[]>;
  getAddressRisk(input): Promise<ProviderRiskSnapshot | null>;
}
```

Then:

```text
FixtureCrossChainDiscoveryProvider -> used in tests and local development.
RangeCrossChainDiscoveryProvider -> used in production when RANGE_API_KEY exists.
```

Pros:

- deterministic tests;
- no API cost in CI;
- we can lock scoring behavior before depending on live providers;
- easier to add LayerZeroScan/Etherscan/Alchemy as fallback later.

Cons:

- slower to get live value;
- one extra abstraction to maintain;
- fixtures can miss real provider edge cases.

Option C: hybrid recommended.

For this project, the best compromise is:

```text
Use Range as the required live provider for Stage 2 runtime,
but still implement it behind a provider interface and write fixture-based tests.
```

This gives the product live Range behavior from day one without coupling scoring/reporting directly to Range payloads.

### Phase A: Evidence Schema

Add chain-aware cross-chain evidence types without changing the current TRON-only route behavior.

Deliverables:

- `CrossChainRouteEdge`;
- `CrossChainEvidenceClass`;
- `ChainAddress`;
- storage table for cross-chain provider payloads;
- fixture for the Range -> Ethereum -> Uniswap -> Stargate -> Arbitrum -> Tornado case.

### Phase B: Range Client

Build a small `RangeClient` behind an interface.

Needed methods:

```ts
getAddressInformation(address, chains?)
listTokenTransfers(address, chains?, contractAddress?, timeWindow?)
listCounterparties(address, chains?)
getAddressRisk(address, chains?)
```

Native/internal transfer and "funded by" evidence may need explorer-specific providers such as Etherscan/Arbiscan/TronScan when Range does not expose the exact field needed for a chain.

Design rules:

- no hard dependency in core scoring;
- cache all calls;
- preserve raw payloads;
- fail closed to `REVIEW`, not `ACCEPTABLE`.

### Phase C: Cross-Chain Corridor Expander

Add a new expander used by `where is money` only when bridge/service clues appear.

Inputs:

```text
subject address
balance-forming transfer
known source tx/address from Range or explorer
amount/time window
```

Outputs:

```text
ranked cross-chain corridor paths
evidence coverage
terminal boundary
risk signals
```

### Phase D: Unknown Token / Liquidity Heuristics

Add token risk features:

- low holder count;
- low transfer count;
- missing market cap;
- fresh contract;
- large Uniswap V3 liquidity remove/collect;
- large asset output after thin-token activity;
- same actors buying/selling related no-name tokens.

Suggested scoring:

```text
unknown token only: +20 to +35 REVIEW
unknown token + large liquidity remove: +45 to +65 HIGH
unknown token + bridge outflow + short-lived wallets: +65 to +80 HIGH
unknown token + Tornado upstream/downstream: +85 to +100 CRITICAL/DECLINE
```

### Phase E: LLM Evidence Summarizer

The LLM receives only normalized evidence and policy outputs.

Prompt contract:

```text
You may summarize, rank next steps, and explain uncertainty.
You may not invent labels, bridge links, sanctions, or token reputation.
Every risk claim must cite an evidence id / tx hash / address / provider field.
```

Good LLM output:

```text
The TRON USDT receipts are linked by Range to Ethereum source transactions.
The Ethereum sender was funded by ETH that came from Uniswap V3 liquidity removal involving a thin token, GARY.
The 497 ETH leg traces through Stargate to Arbitrum and then to an address funded by Tornado.Cash 100 ETH withdrawals.
Decision: DECLINE / HIGH because the balance-forming corridor reaches Tornado and unknown-token liquidity boundaries.
```

Bad LLM output:

```text
The wallet is definitely a scammer.
The same person owns all addresses.
The bridge proves Tornado money became the TRON USDT.
```

## Report UX For This Case

Target report shape:

```text
Where is money? Cross-chain corridor

Decision: DECLINE
Risk: 90/100 CRITICAL

Main reason:
Balance-forming TRON USDT receipts trace through Range/LayerZero-style bridge evidence to Ethereum, then through no-name token liquidity activity and another Stargate bridge leg to an address funded by Tornado.Cash 100 ETH withdrawals.

Key path:
TRON TGy...ZAZD
<- Range bridge output, USDT, Ethereum source tx 0x7284...
<- Ethereum 0x2cFEEE...Da315
<- ETH funding from 0x09d0...BF501
<- Uniswap V3 liquidity remove/collect involving GARY token
<- 0x7C3721...5f60, funded by Stargate Pool Native
<- Arbitrum 0x6Ca63...2eA7
<- 0xeb2C...A68b
<- Tornado.Cash 100 ETH internal transfers

Coverage:
Cross-chain evidence is provider-assisted by Range and explorer labels.
Exact continuity through bridge/provider links should be shown per tx where available.
No-name token liquidity and Tornado funding are policy-decline boundaries.
```

## Open Questions For Implementation

1. Do we use Range as the primary cross-chain provider or only as an enrichment provider behind our own explorer collectors?
2. Which chains are MVP: TRON, Ethereum, Arbitrum only, or all Range-supported chains?
3. Do we score no-name token liquidity as automatic `DECLINE`, or `HIGH REVIEW` until paired with Tornado/bridge evidence?
4. How many cross-chain jumps should the production bot attempt before returning `REVIEW / INCOMPLETE`?
5. Should Range Risk v2 be a paid/provider dependency in production, or only a manual analyst mode initially?

## Recommended Next Step

Build a design spec for:

```text
Where Is Money: Cross-Chain Corridor Analysis
```

Recommended implementation order:

1. Add cross-chain evidence types and fixtures.
2. Add Range client and cache.
3. Add bridge/cross-chain expander.
4. Add unknown-token liquidity heuristics.
5. Add report formatter and LLM summarizer contract.
6. Test against this case shape with deterministic fixtures before using live APIs in CI.

## Manual Bridge Continuation Seed Mode

Use bridge continuation seed mode only after normal `where is money` reaches a concrete bridge boundary. This is a manual/deep continuation path for analyst-driven cases, not a flag set that should be enabled for every check.

Ethereum token/Tornado case:

```text
npm run forensic:where-is-money -- --source <TRON-address> --cross-chain-stage2 --cross-chain-manual-deep --cross-chain-max-provider-calls 80
```

320k BSC-style case:

```text
npm run forensic:where-is-money -- --source <TRON-address> --cross-chain-stage2 --cross-chain-manual-deep --cross-chain-max-provider-calls 80
```

Expected outcomes:

- `protocol_correlated` continuation may preserve a proof terminal such as Tornado/sanctioned only when proof-safe terminal criteria are met.
- `strong_amount_time`, `split_join`, and `weak_candidate` are candidate-only/data-quality support, not hard proof.
- Unsupported continuation chains like Solana should produce data-exhausted/partial coverage, not a false decline.

Operators should ensure Range and EVM explorer keys are configured before using this mode. TRON evidence uses the local TRON provider/client.

This mode must not be enabled for every check. It is a manual/deep seed-mode continuation after a bridge boundary.
