# Where Is Money Stage 2: Cross-Chain Corridor Analysis

Date: 2026-06-01

## Purpose

This is the current design spec for `Where is money?` Stage 2 after the latest code audit and the ChatGPT Pro architecture review in:

```text
C:/Users/User/Downloads/where-is-money-stage2-review.md
```

Stage 2 must be a trigger-gated evidence layer inside the existing `Where is money?` flow. It should continue the provenance corridor after TRON money reaches a bridge, router, pool, unknown contract, or cross-chain boundary. It must not become a separate first-screen product yet, and it must not bypass the current evidence-first assessment model.

The current code has already moved beyond the earlier Stage 2 plan. The implementation now has:

```text
evidence-first assessment
+ structured risk layers
+ weighted source-policy scoring
+ operational wallet dampening
+ requested_amount, transaction_seed, and recent_flow provenance scopes
+ TronGrid fallback
+ incoming-deposit reuse through shared where-check execution
+ compact Telegram UX
```

Stage 2 must extend this architecture, not replace it.

## Current Repository State

Current `HEAD` at this rewrite:

```text
f95d68f docs: design risk center screen
```

Fresh local verification before this rewrite:

```text
npm test        -> 83 test files, 820 tests passed
npm run typecheck -> passed
```

Important working-tree context:

- There are unrelated local Telegram/runtime UX edits in the working tree.
- There are untracked bot runtime hardening docs.
- There is a separate `codex/bot-runtime-hardening` branch with scheduler/rate-limit work.
- The cross-chain implementation files do not exist yet under `src/forensics`.
- The old `codex/where-is-money-stage2` branch must not be merged directly because it predates the current evidence-first architecture.

## ChatGPT Pro Review Incorporation

| Review point | Spec update |
|---|---|
| Main Telegram formatter is likely `src/bot/createBot.ts`, not `src/bot/messages.ts` | Treat `src/bot/createBot.ts` and `tests/bot/createBot.test.ts` as the primary report-formatting entrypoint until code says otherwise |
| `parseUsdtAmountToRaw()` already exists | Do not add a second `usdtRaw()` parser; extract or reuse a shared USDT decimal parser |
| Split-flow trigger is too broad | Require same wallet, related boundary actor/protocol family, close timestamps, combined amount, and meaningful amount preservation |
| `sanctioned_service` cannot be only source-policy | Exact sanctioned service needs an explicit hard-proof path; mixer/Tornado without exact sanctions remains source-policy |
| Extra Stage 2 layers can be lost in assessment branches | `moneyOriginOperationalAssessment.ts` must merge extra layers through every return branch |
| Range API shape must not be guessed | Verify current Range endpoints/schema before coding; adapter tests must pin the observed response shape |
| Provider queries need time windows | Add `timeWindow` to discovery/EVM provider interfaces from the start |
| Need provenance for evidence sources | Add `CrossChainEvidenceRef` / `ProviderPayloadRef` with provider, payload ID, endpoint, timestamp, and confidence |
| Need request budget from first implementation | Add provider budget/dedupe wrapper before live adapters are wired |
| Need EVM logs | EVM provider must expose receipt logs or `getLogs()` for Uniswap V3 liquidity detection |
| Need storage story | MVP may be in-memory, but final `CrossChainCorridorReport` must be storable and Risk Center must read stored results only |
| Stage 2 disabled must call no providers | Add a CI/regression guard for zero provider calls when disabled |
| Weak amount/time match must never become proof | Keep weak inference as coverage/support only, never as hard proof or clean conclusion |

## Product Goal

Add Stage 2 to answer:

```text
When TRON balance-forming money reaches a bridge/cross-chain boundary, where does the corridor lead?
Does the continued source create exchange-policy risk?
```

Stage 1 answers TRON provenance. Stage 2 continues only when the selected balance-forming or transaction-seeded money reaches a boundary and the trigger policy justifies a deeper provider-backed check.

## Canonical Manual Case

Manual investigation path from screenshots and notes:

```text
TRON USDT recipient
<- LayerZero / bridge evidence visible via Range
<- Ethereum source tx
<- Ethereum actor
<- ETH/native funding
<- Uniswap V3 liquidity remove/collect involving no-name token GARY
<- Stargate / LayerZero bridge leg
<- Arbitrum source
<- Tornado.Cash 100 ETH funding
```

Important entities:

```text
Ethereum tx:
0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f

Ethereum actor:
0x2cFEEE2394aC0f01c92CDaDCb697feC0cF8Da315

Ethereum intermediate:
0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60

Arbitrum actor:
0x6Ca63c963948597EAF85C6A193FedF1d96c62eA7

Tornado-funded actor:
0xeb2Cdf39fC5Afa85BBa1467e209974d9B19fA68b

Stargate Pool Native:
0x77b2043768d28e9c9ab44e1abfc95944bce57931

GARY token:
0x1996d86e55b33aeef2c9f50b3086a91656a284db
```

The key product lesson is that "bridge seen" is not the terminal finding. The terminal finding can be no-name liquidity, mixer/Tornado, exact sanctioned service, or partial coverage.

## Manual Tracing Playbook From Research Notes

Source note:

```text
docs/research/2026-05-29-range-crosschain-case-playbook.md
```

The manual workflow was not a fixed-hop address walk. It was an evidence-guided corridor trace where the analyst changed tracks when the money changed assets or networks.

### Step 1: Start On TRON And Treat Contract-Sourced Inflow As A Boundary

Manual reasoning:

1. Open the TRON incoming transfer.
2. Notice that the source is a contract, not an ordinary clean wallet.
3. Inspect contract/internal transaction context.
4. Internal labels mention LayerZero / bridge-like behavior.
5. Do not stop at "contract sender"; classify this as a cross-chain boundary candidate.

Product translation:

```text
TRON contract sender + LayerZero/Stargate/bridge clue
=> Stage 1 boundary path
=> candidate seed for Stage 2
```

### Step 2: Use Range To Find The Source-Chain Row

Manual reasoning:

1. Search the TRON recipient or related address/tx in Range Explorer.
2. Filter by asset, source, destination, amount, and protocol when needed.
3. Range reveals repeated Ethereum -> TRON USDT rows.
4. Repeated 100,000 USDT rows and a 77,201.21 USDT row are stronger than one isolated transfer.

Product translation:

```text
Range row with source tx + destination tx/address + protocol + amount
=> provider-correlated bridge edge
=> EVM continuation seed
```

### Step 3: Jump To Ethereum Source Transaction And Sender

Manual reasoning:

1. Open the Range source tx on Etherscan.
2. Identify the sender behind `Call Execute Function`.
3. Open the sender address, not just the bridge contract.
4. Inspect activity around the bridge time.
5. Find repeated outbound USDT batches and large inbound ETH funding.

Product translation:

```text
bridge source tx
=> sender actor
=> nearby inbound funding assets
=> choose the asset that economically formed the outgoing bridge transfer
```

### Step 4: Switch From USDT Track To ETH Track

Manual reasoning:

1. The bridge outflow is USDT, but the account was funded by large ETH.
2. Follow the large ETH predecessor because it explains how the USDT batch was created.
3. Inspect internal transactions and token transfers around the same time.
4. Find Uniswap V3 remove/collect events involving GARY.

Product translation:

```text
asset changes are allowed in the corridor
large inbound ETH -> DEX/liquidity event -> later USDT bridge batch
```

The implementation must not restrict Stage 2 to ERC20 USDT transfers only.

### Step 5: Inspect The Token-Level Evidence

Manual reasoning:

1. Open the GARY token page.
2. Check holders, transfer count, market metadata, and token transfers.
3. Recognize that this is a thin/no-name token involved in a large ETH liquidity extraction.
4. Click through buyers/sellers and liquidity events to find where the large amount went.

Observed GARY signals from screenshots:

```text
holders: about 81
transfers: about 86
market cap: missing/unclear
large Uniswap V3 liquidity remove/collect
```

Product translation:

```text
unknown/thin token + large Uniswap V3 remove/collect + value continues into bridge/USDT corridor
=> terminalBoundary = no_name_token_liquidity
=> high source-policy risk
=> not direct scam proof by itself
```

### Step 6: Continue Through The 497 ETH Corridor

Manual reasoning:

1. Follow the large ETH amount to `0x7C3721...5f60`.
2. Notice it is funded by `Stargate: Pool Native`.
3. Use Range again to see two Arbitrum -> Ethereum transfers:
   - 247.77 ETH
   - 250.00 ETH
4. Amount preservation is strong because the split sums to about 497 ETH.

Product translation:

```text
related bridge source family + close time + preserved combined amount
=> conservative split-flow bridge grouping
```

### Step 7: Jump To Arbitrum And Inspect Other/Internal Transactions

Manual reasoning:

1. Open the Arbitrum source address from Range.
2. Do not rely only on ERC20 transfers.
3. Inspect normal, internal, and "Other Transactions" sections.
4. Follow native ETH funding and predecessor addresses.

Product translation:

```text
EVM provider must expose normal txs, internal txs, ERC20 transfers, receipts/logs, and preferably logs
```

### Step 8: Stop At Tornado Funding

Manual reasoning:

1. The Arbitrum/EVM predecessor `0xeb2C...A68b` shows internal funding from `Tornado.Cash: 100 ETH`.
2. Repeated ~99.568 ETH internal transfers appear.
3. There can be a delay between Tornado withdrawal and later movement, so tight time-only logic is not enough.

Product translation:

```text
known Tornado/mixer label
=> terminalBoundary = tornado_or_mixer
=> high source-policy risk

exact sanctioned source/list match
=> terminalBoundary = sanctioned_service
=> hard-proof compatible decline
```

### Manual Workflow Rules To Encode

The implementation must encode these analyst rules:

- Follow the economic source, not just the same token.
- Use Range for bridge correlation, then EVM explorers for continuation.
- Inspect internal/native transactions, not only token transfers.
- Treat no-name liquidity as a terminal source-policy boundary.
- Treat Tornado/mixer as source-policy unless exact sanctions evidence exists.
- Preserve amount/time as support, not proof.
- Stop with partial coverage when provider limits block continuation.
- Never convert missing data into a clean source.

### Analyst Decision Mechanics To Preserve

The manual case was not "keep clicking previous address". Each jump happened because a concrete observation changed the next best evidence source.

| Manual observation | Analyst decision | Product rule | Evidence strength |
|---|---|---|---|
| TRON inflow came from a contract and internal context mentioned LayerZero/Stargate-like behavior | Treat the sender as a cross-chain boundary, not as a normal wallet source | Stage 1 emits a boundary seed for Stage 2 | boundary / provider candidate |
| Range showed repeated Ethereum -> TRON USDT rows with 100,000 USDT-scale amounts | Jump to the Ethereum source tx and sender | Range rows become bridge edges and EVM continuation seeds | provider_correlated |
| Etherscan source tx showed `Call Execute Function` and a sender behind the bridge contract | Open the sender, not only the bridge contract | Expand around the actor that economically funded the bridge movement | exact same-chain tx + provider bridge edge |
| Sender had large inbound ETH before outbound USDT batches | Switch from USDT track to ETH track | Corridor expansion may change asset when the new asset explains the next outflow | economic support, not proof alone |
| ETH funding came from Uniswap V3 remove/collect involving GARY | Inspect token-level evidence, not only wallet history | EVM provider must include receipt logs / getLogs and token metadata | exact log / local detector |
| GARY had low holder/transfer count and unclear market data | Mark no-name liquidity as a terminal source-policy boundary | `no_name_token_liquidity` becomes high source-policy evidence, not hard scam proof | deterministic source-policy |
| `0x7C3721...5f60` was funded by Stargate Pool Native and Range showed 247.77 + 250 ETH from Arbitrum | Group split bridge legs by actor/protocol/time/amount preservation | Large split-flow trigger requires conservative grouping, not just multiple paths | provider_correlated + amount support |
| Arbitrum continuation required "Other Transactions" and internal/native views | Use EVM continuation, not Range alone | EVM provider must fetch normal txs, internal txs, ERC20 transfers, receipts/logs | exact same-chain evidence |
| `0xeb2C...A68b` had internal funding from `Tornado.Cash: 100 ETH` | Stop at mixer terminal | `tornado_or_mixer` is high source-policy unless exact sanctioned evidence exists | source-policy or hard-proof if sanctioned exact |

This table is an implementation contract. Fixtures should assert the intermediate decisions, not only the final risk number.

### Manual Case Output Levels

The same manual route can produce two valid Stage 2 outputs depending on provider coverage:

```text
Range + EVM reaches GARY liquidity, but Arbitrum/Tornado continuation is unavailable
=> terminalBoundary = no_name_token_liquidity
=> partial = true if continuation was attempted and blocked
=> decision impact = DECLINE/HIGH source-policy

Range + EVM reaches GARY liquidity and then Tornado funding
=> terminalBoundary = tornado_or_mixer, with no-name liquidity preserved as supporting source-policy evidence
=> decision impact = DECLINE/HIGH or CRITICAL source-policy

Exact sanctioned list match appears anywhere in the selected corridor
=> terminalBoundary = sanctioned_service
=> hard-proof compatible decline
```

The bot must keep these layers separate. No-name liquidity can be enough for `DECLINE/HIGH`, but it must not be described as direct scam proof. Tornado/mixer can be enough for source-policy decline, but it is not hard proof unless exact sanctioned evidence exists.

## Current Code Architecture To Preserve

| Layer | Current files | Stage 2 rule |
|---|---|---|
| Main flow | `src/check/whereIsMoneyCheck.ts` | Stage 2 plugs in after initial Stage 1 assessment and before final report return |
| Selection | `src/forensics/balanceFormingTransfers.ts`, `src/forensics/recentFlowProvenanceSelection.ts` | Do not rewrite selection; consume `provenanceScope`, `targetAmountRaw`, and `anchorTransfer` |
| Same-chain trace | `src/forensics/moneyOriginTrace.ts` | Use boundary paths as Stage 2 seeds |
| Stop policy | `src/forensics/moneyOriginPolicy.ts` | Preserve source-policy vs hard-proof separation |
| Source scoring | `src/forensics/provenanceScoring.ts` | Extend source exposure kinds for Stage 2 terminal boundaries |
| Final assessment | `src/forensics/moneyOriginOperationalAssessment.ts` | Accept extra cross-chain risk layers/source-policy evidence and preserve them through all branches |
| LLM | `src/forensics/contractLlmVerdict.ts` | Optional explanation/classification over deterministic facts only |
| Incoming deposits | `src/forensics/incomingDepositJob.ts` | Reuse Stage 2 through shared where-check deps |
| TRON client | `src/tron/tronClient.ts` | TronScan plus TronGrid fallback already exist |
| Runtime config | `src/config.ts`, `.env.example` | Add Stage 2 provider config; default disabled |
| Bot UX | `src/bot/createBot.ts`, `tests/bot/createBot.test.ts` | Compact summary only; confirm formatter entrypoint before editing |
| Risk Center | `docs/superpowers/specs/2026-06-01-risk-center-design.md` | Do not run live Stage 2 on screen open |

## Non-Goals

- Do not build a universal graph engine for every chain.
- Do not claim same-owner attribution across chains unless provider/protocol evidence proves it.
- Do not treat amount/time similarity as proof.
- Do not use LLM as a blockchain fact provider.
- Do not run Stage 2 automatically for small normal-user checks.
- Do not make the Risk Center call live Range/EVM providers.
- Do not treat no-name token liquidity as direct scam/theft proof.
- Do not treat Tornado/mixer as hard proof unless exact sanctioned evidence exists.
- Do not weaken exact hard-proof behavior for blacklist/scam/exact approval drain.

## Stage 2 Runtime Flow

```text
runWhereIsMoneyCheck()
  -> Stage 1 selection
  -> Stage 1 TRON origin paths
  -> initial buildMoneyOriginOperationalAssessment()
  -> evaluateCrossChainStage2Trigger()
  -> if enabled and triggered:
       runCrossChainCorridorAnalysis()
  -> final buildMoneyOriginOperationalAssessment(extraStage2Evidence)
  -> return WhereIsMoneyReport + optional crossChainCorridor
```

Rules:

- Stage 2 does not change `BalanceFormingSelection`.
- Stage 2 does not rewrite TRON `MoneyOriginPath` objects.
- Stage 2 adds extra evidence and optional report data.
- Disabled Stage 2 preserves current Stage 1 behavior and makes zero provider calls.
- Triggered Stage 2 with missing providers returns partial coverage, never clean.

## Trigger Policy

All thresholds use USDT 6-decimal raw units.

### Large Single Boundary

Run Stage 2 when one selected transfer is at least:

```text
100,000 USDT
```

and its Stage 1 path reaches:

- bridge;
- bridge pool;
- LayerZero / OFT / Stargate-like contract;
- router / DEX / swap adapter;
- unknown contract;
- direct cross-chain label;
- direct no-name liquidity, mixer, or sanctioned label.

### Large Split Boundary

Run Stage 2 when selected transfers look like one split flow:

```text
same checked wallet
+ same or related boundary actor/source family
+ close timestamp window
+ combined selected amount >= 100,000 USDT
+ each path has meaningful amount preservation
```

Do not trigger split flow merely because `boundaryPaths.length >= 2`.

Weak grouping can produce a partial/manual review note, but cannot claim exact linkage.

### Medium Direct High-Risk Signal

For:

```text
10,000-100,000 USDT
```

run Stage 2 only if cheap/direct evidence already sees:

- Tornado/mixer/sanctioned label;
- exact approval-drain provenance;
- direct no-name token liquidity/pool evidence;
- local cached high-risk cross-chain label.

A generic bridge alone is not enough for medium automatic Stage 2.

### Low Amount

For:

```text
< 10,000 USDT
```

normal users do not get automatic Stage 2 for a single transfer. The report can say a cross-chain boundary is visible and deep checking is available for manual/pro mode.

### Provenance Scope Rules

| Scope | Stage 2 behavior |
|---|---|
| `current_balance` | normal trigger policy |
| `requested_amount` | trigger on requested amount and selected transfers, not the whole current balance |
| `transaction_seed` | trigger on the concrete transaction/deposit amount |
| `recent_flow` | trigger only if `anchorTransfer` is large or direct high-risk evidence exists |

## Provider Strategy

Stage 2 needs three provider layers.

### Layer 1: Range Discovery

Range is mandatory for production cross-chain discovery value, but the domain code must depend on `CrossChainDiscoveryProvider`, not on Range directly.

Use Range for:

- address-level cross-chain transfers;
- tx-level cross-chain transfers;
- source/destination chain;
- source/destination tx hashes;
- protocol labels;
- provider risk snapshots if available.

Before coding the adapter, verify current Range endpoints, auth, rate-limit behavior, and response schema from official docs or live API. Do not infer the schema from screenshots.

### Layer 2: EVM Continuation

Use an Etherscan V2-compatible provider first.

MVP chains:

```text
Ethereum chainid=1
Arbitrum chainid=42161
```

Use it for:

- normal transactions;
- internal transactions;
- ERC20 transfers;
- transaction receipts;
- receipt logs or `getLogs()`;
- token metadata when available;
- known contract labels when available.

Alchemy can be a later runtime adapter if Etherscan logs or throughput are insufficient. The interface should allow it, but the first MVP does not need a full Alchemy client.

### Layer 3: Local Deterministic Labels And Detectors

Use local/static evidence for:

- Tornado.Cash pools;
- exact sanctioned services when backed by deterministic source data;
- Stargate Pool Native;
- LayerZero endpoints/OFT adapters;
- Uniswap V3 Position Manager;
- known routers/DEX;
- known stablecoins and major tokens;
- no-name token metadata fixtures.

## Provider Budgets, Cache, And Storage

Stage 2 must include a budget/dedupe wrapper from the start:

- per-provider call count;
- per-query dedupe;
- abort on budget exhaustion;
- coverage note on budget exhaustion;
- no provider calls when Stage 2 is disabled.

Cache/store:

- Range response by tx hash;
- Range response by address + chain + time window;
- EVM normal/internal/ERC20 pages;
- EVM receipts/logs by tx hash;
- token metadata by token contract;
- local label lookup result;
- final `CrossChainCorridorReport`.

MVP can keep request-level cache in memory. Production should persist final `CrossChainCorridorReport` so Risk Center reads stored results instead of running providers.

Provider limit numbers are volatile. Verify current Range, Etherscan, Alchemy, and TronGrid limits immediately before coding or live smoke; do not bake free-tier assumptions into scoring.

## Config

Existing TRON fallback config already exists and should not be reimplemented:

```text
TRON_FULLNODE_BASE_URL=https://api.trongrid.io
TRON_FULLNODE_API_KEY=
```

Add Stage 2 config:

```text
CROSS_CHAIN_STAGE2_ENABLED=false
CROSS_CHAIN_STAGE2_MAX_PROVIDER_CALLS=60
CROSS_CHAIN_STAGE2_CACHE_TTL_MS=86400000

RANGE_API_KEY=
RANGE_BASE_URL=https://api.range.org
RANGE_TIMEOUT_MS=20000
RANGE_MAX_CALLS_PER_CHECK=20

EVM_EXPLORER_API_KEY=
EVM_EXPLORER_BASE_URL=https://api.etherscan.io
EVM_EXPLORER_TIMEOUT_MS=20000
EVM_EXPLORER_MAX_CALLS_PER_CHECK=40

ALCHEMY_API_KEY=
ALCHEMY_TIMEOUT_MS=20000
```

If bot-runtime hardening lands first, Stage 2 should use the global provider pacing model instead of adding independent bursts.

## Evidence Model

Current code already has:

```ts
EvidenceClass
SourceExposureKind
RiskLayerScore
SourcePolicyEvidence
WhereIsMoneyAssessment.riskLayers
WhereIsMoneyAssessment.dominantRiskLayer
```

Extend `SourceExposureKind`:

```ts
| "no_name_token_liquidity"
| "mixer"
| "sanctioned_service"
```

Add cross-chain route/report types without replacing TRON route types:

```ts
type CrossChainId = "tron" | "ethereum" | "arbitrum" | string;

type CrossChainAddress = {
  chain: CrossChainId;
  chainId: string | number;
  address: string;
};

type CrossChainEvidenceConfidence =
  | "exact"
  | "provider_correlated"
  | "protocol_correlated"
  | "weak";

type ProviderPayloadRef = {
  id: string;
  provider: "range" | "etherscan" | "alchemy" | "local";
  endpoint: string;
  fetchedAt: string;
};

type CrossChainEvidenceRef = {
  id: string;
  provider: "range" | "etherscan" | "alchemy" | "local";
  payloadId: string | null;
  confidence: CrossChainEvidenceConfidence;
};

type CrossChainRouteEdge = {
  id: string;
  edgeType:
    | "bridge_source"
    | "bridge_destination"
    | "bridge_protocol_link"
    | "native_transfer"
    | "token_transfer"
    | "internal_transfer"
    | "dex_swap"
    | "liquidity_add"
    | "liquidity_remove"
    | "unknown_token_liquidity"
    | "tornado_withdrawal"
    | "service_boundary";
  source: CrossChainAddress | null;
  destination: CrossChainAddress | null;
  txHash: string | null;
  amountRaw: string | null;
  assetSymbol: string | null;
  timestamp: string | null;
  protocol: string | null;
  evidenceRefs: CrossChainEvidenceRef[];
  labels: string[];
};

type CrossChainTerminalBoundary =
  | "tornado_or_mixer"
  | "sanctioned_service"
  | "no_name_token_liquidity"
  | "bridge_boundary"
  | "dex_router_boundary"
  | "unknown_contract"
  | "data_exhausted"
  | "none";

type CrossChainCorridorPath = {
  id: string;
  triggerReason: CrossChainStage2TriggerReason;
  balanceTransferTxHashes: string[];
  targetAmountRaw: string;
  selectedAmountRaw: string;
  edges: CrossChainRouteEdge[];
  terminalBoundary: CrossChainTerminalBoundary;
  riskLayer: RiskLayerScore;
  sourcePolicyEvidence?: SourcePolicyEvidence | null;
  partial: boolean;
  reasons: string[];
  warnings: string[];
};

type CrossChainCorridorReport = {
  enabled: boolean;
  triggered: boolean;
  skippedReason: string | null;
  paths: CrossChainCorridorPath[];
  providerCalls: number;
  partial: boolean;
  coverageNotes: string[];
  payloadRefs: ProviderPayloadRef[];
};
```

Extend:

```ts
WhereIsMoneyReport.crossChainCorridor?: CrossChainCorridorReport;
```

## Hard Proof And Source-Policy Semantics

Use these rules:

- `no_name_token_liquidity` is high source-policy risk, not direct scam/theft proof.
- `mixer` / Tornado-like evidence is high source-policy risk unless exact sanctioned evidence exists.
- `sanctioned_service` can be hard proof only when deterministic exact sanctioned evidence exists.
- weak amount/time similarity is never proof.
- missing provider data creates partial coverage, not an acceptable/clean result.

Exact sanctioned hard proof uses the explicit implementation path:

```ts
WhereIsMoneyHardBadEvidenceKind += "sanctioned_service"
BuildMoneyOriginOperationalAssessmentInput.extraHardBadEvidence?: WhereIsMoneyHardBadEvidence[]
```

Stage 2 creates `extraHardBadEvidence` only for deterministic exact sanctioned-service evidence. It does not create hard evidence for no-name liquidity, generic Tornado/mixer labels, LLM suspicion, or weak amount/time inference.

## Stage 2 Scoring

Recommended source-policy score ranges:

| Evidence | Score | Proof level | Dampening |
|---|---:|---|---|
| Exact sanctioned service | `95+` | `exact_scam_or_taint_proof` | no |
| Tornado/mixer corridor | `85-92` | `exchange_policy_decline` unless sanctioned exact | no or very limited |
| No-name token liquidity | `75-88` | `exchange_policy_decline` | no for selected balance-forming corridor |
| No-name liquidity plus bridge outflow | `80-88` | `exchange_policy_decline` | no |
| Bridge/cross-chain boundary only | existing `cross_chain_boundary` curve | `exchange_policy_context` or `exchange_policy_decline` | yes |
| Unknown contract after bridge | `45-60` | `exchange_policy_context` / `insufficient_coverage` | yes |
| Weak amount/time match only | `45-55` | `insufficient_coverage` | yes |

Important wording:

```text
No-name token liquidity is high-risk source-policy evidence.
It is not direct scam, blacklist, or approval-drain proof by itself.
```

## LLM Boundary

Allowed:

- summarize normalized cross-chain evidence;
- classify no-name token liquidity using provided token/tx facts;
- explain uncertainty and coverage;
- cite evidence IDs.

Forbidden:

- invent bridge links;
- infer same owner;
- invent token reputation;
- invent sanctions;
- convert weak inference into proof.

LLM verdicts can enter `contractSuspicionEvidence` or report explanation. They must not enter `hardBadEvidence` unless deterministic exact proof exists elsewhere.

## Report UX

Current formatter entrypoint is `formatWhereIsMoneyReport()` exported from:

```text
src/bot/createBot.ts
```

Tests currently live in:

```text
tests/bot/createBot.test.ts
```

The implementation should confirm this before editing because the working tree has Telegram UX changes.

Compact user copy:

```text
Cross-chain corridor:
Range linked the TRON receipt to Ethereum source tx 0x...
EVM continuation reached no-name token liquidity.

Decision:
DECLINE. This is high source-policy risk, not direct scam proof by itself.
```

Partial provider copy:

```text
Stage 2 was triggered, but Range/EVM data was unavailable or budget-limited.
Clean source is not proven. Coverage is partial.
```

Skipped copy:

```text
Cross-chain boundary is visible, but deep cross-chain analysis was not auto-run below the threshold.
```

Do not dump all route edges into the normal Telegram message.

## Risk Center Rules

Stage 2 must not run from Risk Center screen rendering.

```text
Read stored Stage 2 result if it exists.
Show "Stage 2 not run" or "Stage 2 partial" if relevant.
Do not call Range/EVM providers on open.
```

## Required Fixtures

1. Large single bridge-boundary transfer triggers Stage 2.
2. Large split flow through same boundary actor/protocol/time group triggers Stage 2.
3. Large split flow through unrelated boundaries does not claim exact split linkage.
4. Medium transfer with direct mixer/no-name/sanctioned clue triggers Stage 2.
5. Medium bridge-only transfer skips.
6. Low single transfer skips for normal user.
7. Recent-flow low-balance scope skips unless anchor is large/direct high-risk.
8. Stage 2 disabled makes zero provider calls.
9. Range unavailable after trigger returns partial coverage.
10. Etherscan unavailable after Range link returns partial/data-exhausted coverage.
11. Range TRON -> Ethereum row normalizes into bridge edge.
12. Ethereum Uniswap V3 GARY liquidity remove/collect detects no-name liquidity.
13. Major-token Uniswap liquidity remove does not become no-name liquidity.
14. Missing token metadata creates a partial warning, not a confident terminal.
15. Ethereum -> Arbitrum bridge plus Tornado funding detects mixer corridor.
16. Tornado/mixer without exact sanctions is source-policy, not hard proof.
17. Exact sanctioned service can become hard proof.
18. Weak amount/time-only match never becomes clean proof.
19. Operational wallet dampening does not erase no-name liquidity in selected corridor.
20. Incoming-deposit transaction-seeded large bridge boundary reuses Stage 2.
21. Telegram summary is compact and proof-level honest.
22. Risk Center reads stored output but does not trigger providers.
23. Manual GARY/Stargate/Tornado fixture asserts the intermediate analyst decisions: Range bridge edge, Ethereum sender expansion, USDT -> ETH track switch, Uniswap V3 liquidity logs, no-name token metadata, Arbitrum split bridge grouping, and Tornado terminal.
24. Manual fixture variant stops at GARY no-name liquidity when Arbitrum/Tornado continuation is unavailable and still returns high source-policy risk with partial coverage.

## Acceptance Criteria

1. Stage 2 is off by default.
2. Existing tests remain green.
3. No existing Stage 1 selection/scoring behavior is regressed.
4. `requestedAmountRaw`, `transaction_seed`, and `recent_flow` scopes are preserved.
5. Stage 2 provider absence yields partial coverage, not `ACCEPTABLE`.
6. Stage 2 no-name liquidity creates `SourcePolicyEvidence` and `RiskLayerScore`.
7. Stage 2 does not add no-name liquidity to `hardBadEvidence`.
8. Tornado/mixer without exact sanctions does not become hard proof.
9. Exact sanctioned service can still be hard proof when deterministic evidence exists.
10. Weak amount/time-only evidence never becomes proof or clean result.
11. `WhereIsMoneyReport` includes optional `crossChainCorridor`.
12. `CrossChainCorridorReport` includes evidence refs and provider payload refs without storing huge raw payloads.
13. Provider budget exhaustion produces partial coverage and preserves already found risk.
14. Incoming deposit receives Stage 2 output through shared where-check execution.
15. CLI has explicit Stage 2 flags.
16. Telegram summary is compact and proof-level honest.
17. Risk Center remains read-only and fast.
18. Stage 2 disabled creates zero Range/EVM provider calls.
19. Manual-case tests validate the route mechanics, not only the final score.

## Self-Review

Marker scan:

```text
No unresolved marker strings remain.
```

Review coverage:

```text
The spec incorporates the ChatGPT Pro review points and the manual tracing playbook: formatter entrypoint, shared USDT parser, conservative split-flow, sanctioned hard-proof semantics, assessment branch preservation, Range schema verification, provider time windows, payload refs, budget/cache/storage, EVM logs, disabled-provider-call guard, and route-mechanics fixtures for Range bridge edges, asset-track switching, no-name liquidity, Arbitrum continuation, and Tornado terminal evidence.
```

Scope:

```text
MVP remains TRON -> Ethereum -> Arbitrum. Solana, BSC, Polygon, Base, universal graph search, paid indexer integration, and LLM-based risk scoring are out of scope.
```
