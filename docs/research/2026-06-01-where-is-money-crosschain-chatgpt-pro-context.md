# Where Is Money Cross-Chain Stage 2 Context Pack For ChatGPT Pro

## Purpose

This document is a compact handoff for reviewing the cross-chain analysis plan in ChatGPT Pro or another external reasoning session.

The goal is to review and improve the design before implementation:

```text
Where Is Money Stage 2: Cross-Chain Corridor Analysis
```

## Product Idea

The product is a Telegram-driven TRON USDT monitoring and forensic analysis bot.

One of its main analyst workflows is:

```text
Where is money?
```

The workflow tries to answer:

```text
Where did the money that formed this wallet balance or transaction come from?
Is that source acceptable under exchange/risk policy?
```

Current Stage 1 is TRON-only. It follows TRON USDT transfers backward with amount/time continuity and stops at clean CEX, risky labels, bridge/router/DEX boundaries, unknown contracts, or incomplete coverage.

Stage 2 should continue when Stage 1 reaches a cross-chain boundary and the selected amount/risk signal justifies deeper analysis.

## Current Problem

Manual analysis found a case where the important risk evidence was not on TRON.

Manual chain:

```text
TRON USDT recipient
<- LayerZero / bridge / Range row
<- Ethereum source tx
<- Ethereum actor
<- Uniswap V3 liquidity remove/collect on a no-name token
<- Stargate / LayerZero bridge
<- Arbitrum actor
<- Tornado.Cash funding
```

Current Stage 1 can identify:

```text
The balance-forming money reached a bridge/cross-chain boundary.
```

But it cannot yet identify:

```text
The downstream/upstream corridor reaches no-name token liquidity and Tornado.Cash-style mixer evidence.
```

The main product gap is not just API access. It is evidence modeling:

- Range can show bridge/cross-chain links.
- Etherscan/Arbiscan/Alchemy are needed for EVM continuation.
- DEX/token detectors are needed for no-name liquidity.
- Local labels are needed for Tornado, Stargate, LayerZero, Uniswap V3, sanctioned/mixer contracts.
- Scoring must keep source-policy evidence separate from hard scam/drain proof.

## What Is Already Implemented

The project changed heavily before this Stage 2 implementation.

Already implemented:

- `requestedAmountRaw` support in balance-forming selection;
- recent-flow provenance for low/zero-balance wallets;
- transaction-seeded provenance for incoming deposits;
- TronGrid fallback through `TRON_FULLNODE_API_KEY`;
- evidence-first scoring types:
  - `EvidenceClass`;
  - `SourceExposureKind`;
  - `RiskLayerScore`;
  - `SourcePolicyEvidence`;
  - `RiskCaseFile`;
- weighted source-policy scoring in `src/forensics/provenanceScoring.ts`;
- operational wallet dampening in `src/forensics/moneyOriginOperationalAssessment.ts`;
- LLM contract verdicts capped as contextual suspicion unless exact deterministic proof exists;
- incoming-deposit analysis mostly reuses `Where is money`;
- Telegram report UX has compact summaries and proof-level wording.

Therefore the old cross-chain plan was rewritten.

## Key Files To Inspect

Design and plan:

```text
docs/superpowers/specs/2026-05-30-where-is-money-stage-2-cross-chain-corridor-design.md
docs/superpowers/plans/2026-05-30-where-is-money-stage-2-cross-chain-corridor.md
docs/research/2026-05-29-range-crosschain-case-playbook.md
docs/superpowers/specs/2026-05-31-final-scoring-architecture-design.md
docs/superpowers/specs/2026-05-31-final-scoring-gap-closure-design.md
```

Current runtime architecture:

```text
src/check/whereIsMoneyCheck.ts
src/forensics/balanceFormingTransfers.ts
src/forensics/recentFlowProvenanceSelection.ts
src/forensics/moneyOriginTrace.ts
src/forensics/moneyOriginPolicy.ts
src/forensics/provenanceScoring.ts
src/forensics/moneyOriginOperationalAssessment.ts
src/forensics/contractLlmVerdict.ts
src/forensics/incomingDepositJob.ts
src/tron/tronClient.ts
src/types.ts
src/config.ts
```

Relevant tests:

```text
tests/check/whereIsMoneyCheck.test.ts
tests/check/forensicRegressionCases.test.ts
tests/forensics/provenanceScoring.test.ts
tests/forensics/moneyOriginOperationalAssessment.test.ts
tests/forensics/moneyOriginTrace.test.ts
tests/forensics/contractLlmVerdict.test.ts
tests/forensics/incomingDepositJob.test.ts
tests/tron/tronClient.test.ts
tests/config/config.test.ts
```

## Manual Case Inputs

TRON target from screenshots:

```text
TGy...TBZAZD
```

Ethereum tx used as first confirmed EVM anchor:

```text
0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f
```

Addresses:

```text
0x2cFEEE2394aC0f01c92CDaDCb697feC0cF8Da315
0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60
0x6Ca63c963948597EAF85C6A193FedF1d96c62eA7
0xeb2Cdf39fC5Afa85BBa1467e209974d9B19fA68b
```

Stargate:

```text
Stargate Pool Native
0x77b2043768d28e9c9ab44e1abfc95944bce57931
```

No-name token:

```text
Gary The Snail (GARY)
0x1996d86e55b33aeef2c9f50b3086a91656a284db
```

## Product Decisions

Current intended decisions:

```text
Stage 2 is part of Where is money, not a separate normal-user command.
Range is required for live bridge/cross-chain discovery.
Range must be behind a provider interface.
Range alone is not enough; EVM continuation is needed.
MVP chains: TRON, Ethereum, Arbitrum.
No-name token liquidity in the balance-forming corridor is DECLINE / HIGH.
Tornado/mixer in the corridor is DECLINE / HIGH or CRITICAL depending exact label/source.
Missing Stage 2 data never produces ACCEPTABLE.
Low-value normal-user single transfer does not auto-run Stage 2.
Pro/manual mode can run Stage 2 below normal thresholds later.
```

## Trigger Policy

Use raw USDT amounts with 6 decimals.

Auto-run Stage 2 for normal users when:

```text
selected transfer >= 100,000 USDT
AND immediate Stage 1 path reaches bridge/router/DEX/cross-chain/unknown contract boundary
```

or:

```text
multiple selected transfers look like one split flow
AND combined selected amount >= 100,000 USDT
AND same/related boundary actor
```

For `10,000-100,000 USDT`:

```text
run only when cheap/direct evidence already sees Tornado/mixer/sanction,
exact approval drain, no-name liquidity, or cached high-risk cross-chain label
```

For `<10,000 USDT`:

```text
do not run automatically for normal users if it is a single transfer
```

## Evidence And Scoring Principles

Hard proof:

- exact scam/stolen/phishing label;
- USDT blacklist;
- exact approval-drain provenance;
- exact sanctioned service label if source is deterministic.

Source-policy/context evidence:

- bridge/cross-chain boundary;
- router/DEX boundary;
- no-name token liquidity;
- Tornado/mixer exposure without exact sanctioned-label proof;
- unknown contract/service boundary.

LLM:

- can classify and summarize normalized evidence;
- cannot invent facts;
- cannot prove ownership;
- cannot convert no-name liquidity into theft proof;
- cannot convert weak amount/time similarity into confirmed bridge proof.

Operational wallet dampening:

- can reduce weak source-policy or unknown-origin evidence;
- cannot reduce exact hard proof;
- should normally not erase no-name liquidity evidence in the selected balance-forming corridor.

## Proposed Provider Stack

Required for MVP:

```text
Range
Etherscan V2-compatible explorer API
TronScan
TronGrid fallback
Local label registry
Fixture provider for tests
```

Optional/future:

```text
Alchemy Transfers API
DexScreener
CoinGecko
LayerZeroScan
WormholeScan
LI.FI
Blockscout
```

## Environment Variables

Already exists:

```text
TRON_FULLNODE_BASE_URL=https://api.trongrid.io
TRON_FULLNODE_API_KEY=
```

To add:

```text
CROSS_CHAIN_STAGE2_ENABLED=false
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

## Proposed Implementation Shape

New modules:

```text
src/forensics/crossChainEvidence.ts
src/forensics/crossChainStage2Triggers.ts
src/forensics/crossChainProviders.ts
src/forensics/rangeClient.ts
src/forensics/evmExplorerClient.ts
src/forensics/crossChainDetectors.ts
src/forensics/crossChainCorridor.ts
```

Main flow:

```text
runWhereIsMoneyCheck
  -> current Stage 1 provenance
  -> build initial operational assessment
  -> evaluate Stage 2 trigger
  -> if triggered, call Range provider
  -> normalize bridge edges
  -> continue EVM evidence via Etherscan/Arbiscan
  -> run no-name liquidity / Tornado / service detectors
  -> produce CrossChainCorridorReport
  -> merge risk layers into final WhereIsMoneyAssessment
  -> format compact report
```

## External Review Questions

Ask ChatGPT Pro to review:

1. Is Stage 2 correctly kept inside `Where is money`, or should it be a separate paid/manual workflow?
2. Are the trigger thresholds reasonable for API cost and user value?
3. Is Range + Etherscan V2 enough for MVP, or should Alchemy be first-class from day one?
4. Should no-name token liquidity always produce user-facing DECLINE/HIGH, or only when amount/share/proximity is strong?
5. Should Tornado/mixer exposure without exact sanctioned-service label be CRITICAL or high HIGH?
6. Is the evidence model strict enough to avoid overclaiming ownership or theft?
7. Does the implementation plan split work into good subagent-sized tasks?
8. What tests are missing for false positives, operational wallets, and weak cross-chain inference?

## Desired External Output

Ask external reviewer for:

```text
1. Architecture critique
2. Missing provider/API risks
3. Scoring false-positive risks
4. Trigger policy critique
5. Test fixture improvements
6. Implementation plan changes before coding
```

## Current Local Verification

Before this context pack was created, the project had user-modified Telegram UX files in the working tree. The cross-chain docs were updated without touching runtime code.

Run before implementation:

```bash
npm test
npm run typecheck
```

## Important Warning

Do not merge the old branch `codex/where-is-money-stage2` directly. It predates evidence-first scoring and can revert newer modules. Use it only as a reference for old cross-chain file sketches.
