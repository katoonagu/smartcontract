# Risk Intelligence Brief

Date: 2026-05-21

## Purpose

This document is a working context and research prompt for building the risk intelligence layer of the blockchain wallet monitoring bot.

The product is a Telegram bot and backend service that monitors user-added crypto wallets, detects incoming transfers, analyzes sender wallets and related transaction behavior, and returns an explainable risk result:

- risk level: `LOW / MEDIUM / HIGH / CRITICAL`;
- risk score: `0-100`;
- reasons and evidence;
- confidence and missing checks;
- optional manual-review summary.

The system must be read-only. It must never ask for private keys, never sign transactions for users, and never present risk as a legal conclusion. The product should say "risk signal", "possible exposure", "manual review recommended", not "this person is criminal" unless that exact label comes from a verified official source and is still phrased carefully.

## Current Project State

The current codebase already has the foundation:

- Telegram bot with wallet registration and command/button UX.
- TRON/TRC20 USDT monitoring via TronScan.
- Polling state, pagination, dedupe, alert retry, and structured logs.
- Wallet dashboard with balances, 30-day flow, fees, wallet age, and monitoring status.
- Internal address labels.
- Basic risk engine that can combine labels and simple behavior signals into a score.

The current score is not yet a real AML/forensics score. It is a shell based on:

- internal labels;
- light wallet-age/activity signals;
- incoming monitor state.

Not connected yet:

- commercial AML providers;
- free/public risk feeds;
- graph proximity;
- bridge/cross-chain routes;
- approval/allowance analysis;
- advanced behavioral pattern detectors;
- LLM case explainer.

## Product Goal

Build a practical wallet risk intelligence system for:

1. Watched wallets: wallets added by users to the bot.
2. Incoming senders: addresses that send USDT or other supported assets to watched wallets.
3. Manually checked addresses: addresses submitted through `/check` or button flow.
4. Manually checked transactions: tx hashes submitted through `/check_tx` or button flow.

The first implemented chain is TRON/TRC20 USDT. The architecture must immediately support expansion to:

- BSC/EVM USDT and USDC;
- Ethereum/EVM-style approvals and `transferFrom`;
- bridge routes between TRON and EVM chains;
- exchange/collector/service labels;
- multi-hop graph exposure.

## Core Principle

The final product score must be evidence-first, not LLM-first.

Recommended split:

```text
Blockchain/API data
  -> normalized events
  -> labels and provider signals
  -> graph and behavior detectors
  -> deterministic risk policy
  -> score + reasons + evidence
  -> LLM explanation and manual-review assistant
```

The LLM can analyze already collected evidence, explain cases, summarize risk, classify ambiguous behavior, and generate reports. It should not be the only source of truth for the score.

Why:

- deterministic scoring is repeatable;
- each reason can be tested;
- false positives are easier to control;
- users can see why the result is `HIGH`;
- provider/raw evidence can be audited;
- LLM output can remain advisory.

## Target Architecture

### 1. Data Ingestion

The system ingests blockchain data from chain-specific adapters.

TRON sources:

- TronScan transfer APIs;
- TronScan account/security APIs;
- TronGrid later if needed;
- own TRON node/indexer later if scale requires it.

BSC/EVM sources:

- JSON-RPC providers;
- BscScan/Etherscan-style APIs;
- contract logs for `Transfer` and `Approval`;
- archive/indexer providers later if needed.

Bridge sources:

- known bridge contract addresses;
- bridge event logs;
- provider/label datasets;
- cross-chain route heuristics.

### 2. Normalized Event Model

Raw chain data must be transformed into normalized events.

Core event types:

- `token_transfer`;
- `native_transfer`;
- `approval`;
- `transfer_from`;
- `contract_interaction`;
- `bridge_deposit`;
- `bridge_withdrawal`;
- `swap`;
- `account_created_or_first_seen`;
- `provider_label_observed`;
- `risk_signal_observed`.

Minimum fields:

```text
chain
network
tx_hash
block_number
timestamp
event_type
asset_contract
asset_symbol
amount_raw
amount_decimal
from_address
to_address
owner_address
spender_address
contract_address
method_id
status
source
raw_evidence_id
```

### 3. Address Intelligence Database

Store source assertions, not just final labels.

Example label types:

- `scam`;
- `stolen_funds`;
- `phishing`;
- `mule`;
- `collector`;
- `bridge`;
- `exchange`;
- `trusted`;
- `false_positive`;
- `needs_review`;
- `mixer_like`;
- `risky_contract`;
- `sanctioned`;
- `darknet_market`;
- `gambling`;
- `high_risk_service`;
- `unknown_service`.

Important fields:

```text
chain
address
label_type
source_name
source_url
source_record_id
confidence
severity
status
first_seen
last_seen
created_by
evidence_json
```

The active label for scoring should be derived from assertions by policy. Do not overwrite raw source evidence.

### 4. Provider Adapters

Each provider returns normalized signals.

Adapter shape:

```text
checkAddress(chain, address) -> ProviderRiskSignal[]
checkTransaction(chain, txHash) -> ProviderRiskSignal[]
checkEntityOrCluster(chain, address) -> ProviderRiskSignal[]
```

Normalized signal shape:

```text
code
message
score_impact
source
confidence
severity
evidence_ref
raw_provider_response_id
```

Provider candidates to research:

- TronScan security/account APIs;
- Chainabuse;
- OFAC/sanctions datasets;
- OpenSanctions;
- Scorechain sanctions API;
- Chainalysis sanctions/KYT;
- TRM Wallet Screening;
- Elliptic;
- Crystal Intelligence;
- Bitrace;
- Merkle Science;
- Crypto APIs Verify Address;
- Sumsub Crypto Monitoring.

Research must verify current pricing, availability, supported chains, TRON support, EVM support, API limits, commercial terms, and whether the provider can be used in a commercial MVP.

### 5. Graph Proximity

Graph proximity should support the score, not create a verdict alone.

MVP graph checks:

- direct incoming from labeled risky address;
- direct outgoing to labeled risky address;
- 1-hop exposure to labeled risky address;
- 2-hop exposure with amount/time preservation;
- shared collector address;
- repeated route through same intermediate;
- interaction with known risky contract;
- exposure through bridge route.

Important dampeners:

- known exchange cluster;
- large bridge/service contract;
- high-degree address;
- trusted address;
- prior low-risk relationship with watched wallet;
- false-positive override.

Boundaries:

- limit graph traversal depth in MVP to 2 hops;
- cap high-degree nodes;
- store the exact path used as evidence;
- never hide that graph proximity is probabilistic.

### 6. Behavioral Pattern Detectors

Each detector should be a separate module with its own tests and thresholds.

Initial detector set:

| Detector | Practical meaning | Example evidence |
| --- | --- | --- |
| `amount_splitting` | Many related transfers split into smaller amounts | 20 transfers of similar size within 30 minutes |
| `peeling_chain` | Funds move through a chain of addresses with partial leftovers | A -> B -> C -> D with similar preserved amount |
| `fast_transit` | Funds enter and leave quickly | incoming then outgoing within N minutes |
| `fresh_wallet_high_volume` | New address with large activity | wallet age < 7 days and volume > threshold |
| `collector_wallet` | Many senders consolidate to one address | high fan-in, low fan-out |
| `fan_in_then_single_out` | Many deposits followed by one large withdrawal | N incoming, one large outgoing shortly after |
| `repeated_equal_amounts` | Repeated identical/round amounts | many same-size transfers |
| `bridge_like_route` | Route passes through known bridge/service | address -> bridge -> address on another chain |
| `mixer_like_route` | Fan-out/fan-in/recombine or known mixer label | split/recombine behavior or risky service |
| `approval_risk` | Dangerous token allowances | unlimited approval, unknown spender |
| `transfer_from_after_approval` | Theft-like transfer after approval | approval followed by `transferFrom` |
| `risky_contract_interaction` | Interaction with risky service/contract | known phishing/stolen-funds contract |

Each detector must return:

```text
detector_code
signals[]
evidence_refs[]
confidence
explanation
policy_version
```

### 7. Bridge And Cross-Chain Routes

Bridge detection is important because stolen funds may move from TRON USDT to BSC/EVM or vice versa.

Research target:

- how to identify bridge contracts on TRON, BSC, Ethereum, and other EVM chains;
- how bridge deposits and withdrawals are linked;
- whether public APIs expose bridge route relationships;
- how forensic products handle cross-chain attribution;
- how to avoid treating all bridge use as suspicious.

MVP bridge route signal:

```text
bridge_route_observed:
  + low/medium score impact by itself;
  + higher impact if combined with risky source, fast transit, splitting, or known risky bridge/service label.
```

Bridge use is context, not guilt.

### 8. Approval And Wallet Safety

This is a separate but related product value.

For TRON:

- detect TRC20 approvals when available from API/indexed event data;
- identify unlimited or very large allowances;
- identify spender address risk;
- detect `transferFrom` patterns after approval;
- warn user to review/revoke externally, without signing anything in the bot.

For EVM:

- index ERC20 `Approval(owner, spender, value)`;
- read current allowance for high-value tokens;
- label spender contracts;
- detect malicious approval phishing patterns.

Risk examples:

- unlimited approval to unknown EOA;
- approval to contract later used for `transferFrom`;
- spender appears in phishing/scam label sources;
- approval shortly before asset drain.

### 9. Risk Policy And Scoring

The risk score should be computed by a versioned policy, not hardcoded intuition.

Example policy dimensions:

```text
internal_label_weight
provider_signal_weight
graph_depth_weight
behavior_weight
bridge_context_weight
approval_weight
dampeners
thresholds
confidence_rules
```

Example levels:

```text
0-29: LOW
30-59: MEDIUM
60-84: HIGH
85-100: CRITICAL
```

Every score must expose:

- positive reasons;
- dampeners;
- missing checks;
- confidence;
- policy version;
- raw evidence references.

### 10. LLM Role

The LLM should operate on structured evidence.

Good LLM use cases:

- explain why the score is high;
- summarize a graph path;
- write a manual-review checklist;
- generate a Markdown/PDF case report;
- classify ambiguous behavior into known typologies;
- propose new detector ideas from reviewed cases;
- translate raw evidence into user-friendly text.

Bad LLM use cases:

- "look at this address and guess if it is dirty" with incomplete data;
- final score without deterministic evidence;
- accusations without provider/source evidence;
- hidden reasoning that cannot be audited.

LLM input should look like:

```json
{
  "case_id": "case_123",
  "subject": {
    "chain": "tron",
    "address": "T..."
  },
  "risk_score": 78,
  "risk_level": "HIGH",
  "policy_version": "2026-05-21-v1",
  "signals": [
    {
      "code": "risky_1_hop",
      "score_impact": 35,
      "confidence": "medium",
      "evidence_refs": ["path_1"]
    }
  ],
  "dampeners": [],
  "missing_checks": ["commercial AML", "EVM bridge confirmation"],
  "graph_paths": [],
  "transfers": [],
  "provider_results": []
}
```

LLM output should be advisory:

```text
summary
why_this_matters
evidence_highlights
uncertainties
recommended_next_steps
user_safe_message
admin_review_notes
```

## Recommended Implementation Roadmap

### Phase 3.1: Risk Observation Foundation

Goal: store every risk signal as structured evidence.

Build:

- `risk_signal_observations`;
- `raw_evidence`;
- provider/detector source fields;
- policy version fields;
- evidence links to tx/address/path.

Acceptance:

- every risk reason shown to user has a stored evidence record;
- score can be reproduced from stored observations and policy version.

### Phase 3.2: Source Labels And Free Signals

Goal: start useful risk detection without expensive AML.

Build:

- stronger internal label model;
- admin label commands/import;
- TronScan security adapter;
- sanctions/free public source research;
- Chainabuse/on-demand scam report lookup if usable.

Acceptance:

- user can check an address and see source-based reasons;
- raw provider/source response is stored;
- false-positive/trusted override exists.

### Phase 3.3: Graph Proximity v0

Goal: detect direct, 1-hop, and 2-hop exposure.

Build:

- normalized transfer table;
- indexes for `from`, `to`, `timestamp`, `chain`, `asset`;
- bounded BFS;
- path evidence storage;
- high-degree node dampening.

Acceptance:

- direct risky exposure detected;
- 1-hop and 2-hop paths explainable;
- exchange/bridge/high-degree dampeners prevent obvious false positives.

### Phase 3.4: Behavioral Detectors v0

Goal: implement first practical typology detectors.

Build first:

- `fresh_wallet_high_volume`;
- `fast_transit`;
- `collector_wallet`;
- `fan_in_then_single_out`;
- `amount_splitting`;
- `repeated_equal_amounts`.

Acceptance:

- each detector has synthetic tests;
- each detector returns structured evidence;
- thresholds are configurable.

### Phase 3.5: Approvals And Wallet Safety

Goal: detect dangerous permissions and theft-like flows.

Build:

- approval event ingestion;
- current allowance checks where possible;
- spender labels;
- `transferFrom_after_approval` detector;
- user-facing wallet safety view.

Acceptance:

- unlimited/large approvals are surfaced;
- risky spender labels affect score;
- bot explains how to review/revoke externally.

### Phase 3.6: Bridge Route Intelligence

Goal: treat bridge routes as first-class evidence.

Build:

- bridge label registry;
- bridge event ingestion where available;
- TRON -> BSC/EVM route research;
- bridge-context detector;
- cross-chain evidence model.

Acceptance:

- bridge route can be shown as a path;
- bridge alone is not treated as dirty;
- bridge + suspicious behavior increases score.

### Phase 3.7: LLM Case Explainer

Goal: make risk results understandable.

Build:

- structured case JSON;
- cheap LLM adapter;
- prompt templates;
- deterministic fallback text;
- admin-only manual review summary.

Acceptance:

- LLM never changes deterministic score directly;
- LLM output includes uncertainty and missing checks;
- bad/missing LLM response does not block alerts.

## Research Prompt For ChatGPT Pro

Use the following prompt for deep research.

```text
You are helping design a blockchain wallet risk intelligence system for a Telegram bot and backend service.

Product context:
- Users add their own wallets to the bot.
- The system monitors incoming transactions.
- For every incoming sender address, manual address check, or tx hash check, the system returns LOW/MEDIUM/HIGH/CRITICAL, a 0-100 score, reasons, evidence, and confidence.
- First implementation is TRON/TRC20 USDT.
- Architecture must also cover BSC/EVM USDT/USDC, ERC20 approvals, transferFrom theft patterns, and bridge routes between TRON and EVM chains.
- The system is read-only: no private keys, no signing, no custody.
- We want evidence-first scoring, not an LLM-only guess.

Research task:
Find how blockchain AML, KYT, and forensic systems practically detect risky wallets and dirty-funds exposure. Focus on implementable methods, APIs, data models, and patterns, not generic explanations.

Research areas:

1. Public and commercial data sources
- TRON-specific APIs for transfers, accounts, security flags, approvals, and address tags.
- BSC/EVM APIs for transfers, logs, approvals, and labels.
- Free/public sources: sanctions, OpenSanctions, Chainabuse, official enforcement releases, public scam databases.
- Commercial AML/KYT providers: Chainalysis, TRM, Elliptic, Crystal, Bitrace, Merkle Science, Scorechain, Sumsub, Crypto APIs, and other relevant providers.
- For each source/provider: supported chains, TRON support, BSC/EVM support, wallet screening API, tx screening API, pricing/limits if public, commercial restrictions, quality signals, and integration difficulty.

2. Risk typologies and practical detectors
For each typology below, define:
- what it means in blockchain terms;
- required data;
- practical heuristic;
- false-positive risks;
- score impact guidance;
- examples of evidence to store.

Typologies:
- direct exposure to labeled risky address;
- 1-hop and 2-hop exposure;
- peeling chains;
- amount splitting;
- fan-in/fan-out;
- collector wallets;
- fast transit;
- fresh wallet with high volume;
- repeated equal/round amounts;
- bridge route after suspicious inflow;
- mixer-like behavior;
- risky contract interaction;
- ERC20/TRC20 approval phishing;
- transferFrom after approval;
- exchange deposit/withdrawal clusters as dampeners;
- sanctions exposure;
- stablecoin blacklist status where available.

3. Graph analysis
- How to model transfers as a graph.
- How to traverse graph safely without exploding through exchanges/high-degree nodes.
- How to score depth 0, 1-hop, and 2-hop exposure.
- How to handle amount/time preservation.
- How to store graph paths as evidence.
- How to prevent false positives from exchanges, bridges, and service wallets.

4. Bridge and cross-chain routes
- How TRON to BSC/EVM bridges can be detected.
- Which bridges/contracts/services are relevant.
- Whether public APIs expose bridge relationships.
- How forensic tools handle cross-chain attribution.
- What can be done in MVP without paid providers.

5. Approvals and wallet security
- How to detect dangerous approvals on TRON and EVM.
- How to identify unlimited approval, unknown/risky spender, and transferFrom drain patterns.
- What APIs or event indexing are needed.
- How to present this safely to users.

6. System architecture
- Propose a production-ready but MVP-friendly architecture:
  - normalized events;
  - address labels;
  - raw evidence storage;
  - risk_signal_observations;
  - graph store or relational graph indexes;
  - detector modules;
  - provider adapters;
  - risk policy versioning;
  - LLM case explainer.

7. LLM usage
- Explain where LLMs are useful and where they are unsafe.
- Design an LLM prompt that takes structured evidence and returns an explanation, not a hidden score.
- Suggest cheap model options and what quality risks to expect.

Output format:

1. Executive summary.
2. Recommended MVP sequence.
3. Provider/source comparison table.
4. Detector catalog table.
5. Data model recommendations.
6. Scoring policy proposal.
7. Bridge route strategy.
8. Approval security strategy.
9. LLM role and prompt templates.
10. Open questions and risks.

Use current sources. Cite official docs, provider docs, reputable research, enforcement reports, and technical references. Avoid unsupported claims.
```

## Research Questions For Us

After running external research, answer these before implementation:

1. Which free/public source should we integrate first?
2. Which paid AML provider is worth testing first for TRON USDT?
3. Is TronScan security API enough for a useful Phase 3.2?
4. What exact TRON endpoint gives approval/authorization data reliably?
5. Can we detect TRON -> BSC bridge routes without paid providers?
6. Should graph storage stay in Postgres for v0 or move to a graph/analytics store later?
7. What are safe score thresholds for early beta?
8. What labels require manual admin confirmation?
9. What should user-facing text say to avoid legal overclaiming?
10. What minimum evidence is required before alerting `HIGH`?

## Non-Goals For This Phase

- No custody.
- No private keys.
- No automated freezing or transaction blocking.
- No claim that the system proves criminality.
- No reliance on LLM-only verdicts.
- No expensive AML dependency as the only MVP path.

## Definition Of Done

The risk intelligence foundation is ready when:

- every risk reason has structured evidence;
- score can be reproduced from policy version and stored observations;
- internal labels and at least one external/free source are integrated;
- direct and 1-hop graph exposure work on normalized transfer data;
- at least three behavioral detectors have tests;
- user-facing alerts show score, level, reasons, confidence, and missing checks;
- LLM summary is optional and advisory;
- false-positive override exists;
- admin/manual-review path exists for uncertain high-impact cases.
