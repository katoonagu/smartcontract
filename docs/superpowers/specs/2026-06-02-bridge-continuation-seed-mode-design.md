# Bridge Continuation Seed Mode

Date: 2026-06-02

## Purpose

Add a manual seed mode that continues cross-chain analysis after the existing `Where is money?` flow stops at a concrete bridge boundary.

The current Stage 2 corridor can find Range bridge rows and enrich Ethereum/Arbitrum evidence for transaction-scoped receipts, but it does not recursively continue from the EVM actors discovered in those receipts, normal transactions, internal transfers, or ERC20 transfers. This mode fills that gap without making expensive cross-chain provider calls part of every check.

The immediate product goal is the Ethereum bridge case: after a bridge boundary, follow the EVM continuation far enough to find token/liquidity evidence or a Tornado/mixer terminal when the evidence is present. The secondary design goal is to support the 320k TRON -> Allbridge -> BSC case with the same continuation model.

## Current Context

Relevant existing pieces:

- `src/forensics/crossChainCorridor.ts` already performs trigger-gated Range discovery, bridge edge creation, risk snapshots, and tx-scoped EVM evidence enrichment.
- `src/forensics/evmExplorerClient.ts` already supports Etherscan V2 account history, internal txs, ERC20 transfers, receipts, and logs for `ethereum` and `arbitrum`.
- `src/forensics/routeScorer.ts`, `src/forensics/temporalBeamSearch.ts`, and `src/forensics/serviceExposure.ts` already contain amount preservation, time proximity, and split/merge ideas for TRON-local route analysis.
- `src/forensics/crossChainDetectors.ts` already prevents weak amount/time support from becoming hard proof.
- `FORENSIC-REPORT.md` contains the 320k case shape: TRON USDT drain, Allbridge to BSC, BSC USDT split, BNB movement, and later USDT/USDC legs.

Context7 documentation check confirmed that Etherscan API V2 uses one base URL and one API key across supported EVM chains through `chainid`. Required chain IDs for this design:

- Ethereum: `1`
- BNB Smart Chain / BSC: `56`
- Arbitrum: `42161`

The same Etherscan V2 account/log/proxy actions can cover `txlist`, `txlistinternal`, `tokentx`, `getLogs`, and `eth_getTransactionReceipt`.

## Scope

This feature is not a new default scoring path. It is an opt-in continuation layer that starts from a concrete bridge seed.

MVP implementation scope:

- Ethereum bridge continuation for the current token/Tornado investigation.
- Arbitrum support through the same EVM provider.
- BSC support through Etherscan V2 `chainid=56`, so the 320k Allbridge case can be represented.
- TRON USDT support through the existing Tronscan/TronGrid transfer methods.
- Solana only as an interface-ready future chain. It must be reported as unsupported/data-exhausted until a real Solana provider is added.

Out of scope for the first implementation:

- Claiming Tornado or sanctioned-service proof from amount/time similarity alone.
- Auto-running continuation on every normal `where-is-money` check.
- Building a complete Solana transaction-history adapter.
- Adding new paid/intelligence providers beyond Range, Etherscan V2, and existing TRON clients.

## Activation

Continuation may run only when all of these are true:

- The user or job enables manual/seed/deep cross-chain mode.
- Existing Stage 2 is enabled and reaches a concrete bridge boundary.
- The boundary has enough seed data: chain, address or transaction hash, asset, amount, timestamp or block context.
- Provider budget is available.

Normal checks must not call the continuation providers just because `.env` contains provider keys or `CROSS_CHAIN_STAGE2_ENABLED=true`.

## Evidence Classes

Each continuation edge receives an evidence class. The class controls how the edge may affect terminal conclusions.

`protocol_correlated`

Range returned a bridge row, an explorer receipt/log confirms the protocol actor, or the transaction directly touches a known bridge/router/mixer/token/liquidity contract. This can support terminal proof.

`strong_amount_time`

The same or economically related asset appears in a tight time window with strong amount preservation, but no direct protocol link exists. This supports continuation ranking, not final Tornado/sanction proof by itself.

`split_join`

Multiple transfers preserve the seed amount when grouped by time, asset, actor, and direction. This is required for cases like the 320k flow, where a large amount is split and later recombined or converted.

`weak_candidate`

Only amount or time is suggestive, or provider data is incomplete. This may be shown as a hypothesis, but it cannot create a hard terminal boundary.

## Terminals And Stops

Terminal conclusions:

- `tornado_or_mixer`: known Tornado address, mixer label, or strong receipt/log evidence.
- `sanctioned_service`: exact sanctioned-service label/address.
- `no_name_token_liquidity`: Uniswap V3 decrease/collect evidence plus non-major token metadata and meaningful value.
- `bridge_boundary`: another bridge/router boundary.
- `data_exhausted`: budget/provider/data ended before proof.
- `candidate_only`: only weak or amount/time evidence exists.

Stop rules:

- Weak-only edges never produce Tornado, sanctioned-service, or no-name token proof.
- Service/CEX/bridge hubs do not strengthen proof by themselves. They are either a terminal boundary or a seed for another manual continuation.
- A bridge terminal may be continued only in seed mode, within depth and provider budget.
- Provider failures must mark the result partial and explain coverage, not infer risk from missing data.

## Data Flow

The bridge continuation flow:

```text
bridge seed
 -> Range bridge row lookup
 -> EVM/TRON actor extraction
 -> local chain transaction frontier
 -> edge scoring by protocol, amount, time, and split/join
 -> terminal detector
 -> continuation report section
```

For the Ethereum token/Tornado case:

```text
seed tx / bridge tx
 -> Range protocol-correlated bridge leg
 -> Etherscan receipt actor extraction
 -> EVM normal/internal/ERC20 frontier
 -> candidate token/liquidity/mixer hops
 -> terminal or data-exhausted result
```

For the 320k BSC case:

```text
TRON drain / Allbridge seed
 -> Range or explicit Allbridge leg
 -> BSC recipient on chainid 56
 -> BSC USDT split and swap/native/USDC continuation
 -> terminal or candidate-only result
```

## Components

`src/forensics/crossChainContinuationTypes.ts`

Defines seeds, continuation edges, evidence classes, terminal statuses, scoring features, coverage notes, and provider budgets. It should make the weak-proof guard explicit in the type model.

`src/forensics/evmContinuationProvider.ts`

Normalizes Etherscan V2 results for `ethereum`, `arbitrum`, and `bsc`. It should reuse or extend the existing EVM explorer client rather than introduce a second Etherscan client. BSC support is a chain mapping addition: `bsc -> 56`.

`src/forensics/tronContinuationProvider.ts`

Wraps existing TRON USDT methods into the same continuation edge interface. It should initially cover TRC20 USDT only, because that is already covered by current route-search and live transfer clients.

`src/forensics/bridgeContinuationScorer.ts`

Classifies candidate edges into `protocol_correlated`, `strong_amount_time`, `split_join`, or `weak_candidate`. It should reuse the existing amount preservation and time proximity thresholds where possible.

`src/forensics/bridgeContinuationSearch.ts`

Runs bounded frontier expansion from the seed. It handles depth, beam width, provider budget, dedupe, actor extraction, split/join grouping, and terminal detection.

`src/forensics/crossChainCorridor.ts`

Keeps the existing Stage 2 behavior. It receives an optional continuation branch that runs only after bridge-boundary detection and only when manual seed mode is enabled.

## Reporting

The report must keep continuation separate from the normal origin verdict.

Suggested report shape:

```text
Cross-chain continuation: manual seed mode
Seed: <chain>/<tx/address>/<amount>/<asset>/<time>
Best path: <edge summaries>
Terminal: tornado_or_mixer | no_name_token_liquidity | bridge_boundary | data_exhausted | candidate_only
Evidence: protocol_correlated / strong_amount_time / split_join / weak_candidate
Coverage: provider calls, exhausted budgets, unsupported chains
```

Telegram formatting should show a compact continuation section. It must not hide whether the result is proof, candidate-only, or partial.

## Tests

Unit tests:

- Etherscan V2 chain mapping includes `bsc=56`.
- EVM provider normalizes native, internal, ERC20, receipt, and log data into continuation edges.
- Scorer produces:
  - `protocol_correlated` for Range/receipt/log evidence.
  - `strong_amount_time` for close amount and close time.
  - `split_join` for grouped chunks preserving the seed amount.
  - `weak_candidate` for amount-only or time-only evidence.
- Weak candidates cannot produce Tornado, sanctioned-service, or no-name token terminals.

Fixture tests:

- Ethereum bridge -> token/liquidity/Tornado variants.
- BSC 320k fixture based on `FORENSIC-REPORT.md`:
  - TRON USDT split to Allbridge.
  - BSC receipt of `309,899.218851 USDT`.
  - BSC split and later BNB/USDC continuation.

Integration tests:

- Normal `where-is-money` mode makes zero continuation calls.
- Manual seed mode runs continuation only after a concrete bridge boundary.
- Provider budget exhaustion produces partial/data-exhausted coverage notes.
- Telegram/report output separates proof from candidate-only evidence.

## Rollout Plan

Implementation should land in small commits:

1. Foundation: continuation types, evidence classes, scorer tests.
2. EVM provider: add BSC mapping and normalized continuation edge extraction.
3. Ethereum continuation search: seed -> EVM frontier -> terminal detectors.
4. TRON adapter and 320k BSC fixture.
5. Report and Telegram formatting.

Each step should keep `npm run typecheck` and `npm test` passing.

## Open Decisions Resolved

- BSC is included in the first architecture and should be cheap to support through Etherscan V2 `chainid=56`.
- Solana is designed as a future provider interface only.
- The first live priority is the Ethereum bridge/token/Tornado case.
- The 320k case is included as a fixture and BSC coverage target.
- The mode is manual/seed-gated and must not run during every normal check.
