# TRON USDT Risk Signals Research

Date: 2026-05-20

## Product Fit

The research supports the current MVP direction: a standalone Telegram service where users add working TRON wallets, the bot monitors incoming TRC20 USDT, analyzes the sender, and sends `LOW / MEDIUM / HIGH / CRITICAL` with score and reasons. The bot remains read-only: no private keys, no signing, no payouts, no custody.

The right technical shape is a layered risk engine:

1. internal labels;
2. AML provider signals;
3. graph proximity;
4. behavioral patterns;
5. incoming transfer context.

Each layer should return normalized `RiskSignal[]` with `code`, `message`, `scoreImpact`, `source`, and raw provider evidence stored separately. External AML should never be treated as absolute truth.

## TRON Data Layer

| Need | Practical source | Notes |
| --- | --- | --- |
| Incoming TRC20 USDT transfers | TronScan `/api/token_trc20/transfers` or TronGrid `/v1/accounts/{address}/transactions/trc20` | MVP can poll watched wallets every 60s. Use official USDT contract `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`, recipient filter, confirmed-only, and fail closed on malformed responses. |
| Backfill / transaction details | TronScan transaction detail, TronGrid transaction endpoints | Needed for manual `/check <tx>` and debugging. |
| Account security flags | TronScan Security Service API | Includes fraud transaction history, fraud token creator, spam memo behavior, and stablecoin blacklist flag. |
| Approval risk | TronScan account authorization security endpoint | Useful for future approval/transferFrom risk patterns. |
| Scale path | TronGrid contract event polling or own TRON node/indexer | Per-wallet polling works for MVP. Contract-wide `Transfer` event indexing is better when many wallets are watched. |

Rate-limit note: TronGrid docs currently state 100,000 requests/day/account and 20 QPS with API key; without API key it dynamically limits access and can block bursts. Do not poll faster than the chain produces blocks, and add backoff/caching.

Sources:

- [TronScan TRC20 transfer API](https://docs.tronscan.org/en/api/transactions-and-transfers)
- [TronScan Security Service API](https://docs.tronscan.org/en/api/security-service-api)
- [TronGrid TRC20 account transaction API](https://developers.tron.network/reference/get-trc20-transaction-info-by-account-address)
- [TronGrid rate limits](https://developers.tron.network/v4.7.0/reference/rate-limits)

## 1. Internal Labels

Internal labels are the highest-control signal. We should store source assertions, not only final labels:

| Field | Purpose |
| --- | --- |
| `chain`, `address`, `asset_scope` | TRON / address / USDT-specific or chain-wide scope. |
| `label_type` | `scam`, `stolen_funds`, `phishing`, `mule`, `collector`, `bridge`, `exchange`, `trusted`, `false_positive`, `needs_review`, `mixer_like`, `risky_contract`. |
| `source_name`, `source_url`, `record_id` | Audit trail. |
| `confidence`, `severity`, `status` | Allows weak OSINT, confirmed admin labels, retired false positives. |
| `first_seen`, `last_seen`, `ingest_run_id`, `evidence_json` | Reproducibility. |

Useful free/public inputs:

- service-admin manual labels;
- OFAC / UN / EU / UK sanctions lists where crypto addresses are present;
- OpenSanctions as an aggregator for watchlist/entity data;
- Chainabuse user reports for scam/phishing reports;
- TronScan security account flags and tags;
- Tether/TRON USDT blacklist status through contract or TronScan security flag;
- OSINT from official enforcement releases and court documents.

MVP recommendation: start with manual labels + TronScan security flags + Chainabuse on-demand + sanctions ingestion. Keep all imported labels as `source_assertions`, then derive active labels from policy.

Sources:

- [OFAC Sanctions List Service](https://ofac.treasury.gov/sanctions-list-service)
- [OpenSanctions API docs](https://api.opensanctions.org/docs)
- [Chainabuse API limits](https://docs.chainabuse.com/docs/getting-started-2-1)
- [TronScan Security Service API](https://docs.tronscan.org/en/api/security-service-api)

## 2. AML Provider Signals

| Provider | TRON/USDT fit | Pricing signal | How to use |
| --- | --- | --- | --- |
| Chainalysis KYT | Enterprise-grade KYT, 400+ networks and 50M+ tokens according to product FAQ. | Quote/demo for KYT. Free Sanctions Screening API has 5,000 requests / 5 minutes. | Good long-term enterprise provider. Use sanctions API early as a free baseline, then evaluate KYT. |
| TRM Labs Wallet Screening | Wallet screening API, broad chain coverage, fast response claim. | Quote/demo. | Strong fit for wallet screening and fraud/scam attribution. |
| Elliptic | Official docs list Tether USDT on Tron support. | Quote/demo. | Strong candidate because Tron USDT support is explicit. |
| Crystal Intelligence | Public update says Crystal Monitor supports TRX and 45 TRC20 tokens including USDT/USDC. | Quote/demo. | Good fit if we want monitoring + API/SDK. |
| Scorechain | Free sanctions API, 21+ blockchains, 100 requests/hour, non-commercial/basic use, no SLA. | Free sanctions API; full platform quote/demo. | Good baseline sanctions layer, not full AML by itself. |
| Sumsub Crypto Monitoring | Aggregates Chainalysis, Elliptic, TRM, Crystal, Merkle Science; BYOK/native integrations. | KYC pricing is public; crypto monitoring likely sales-led/enterprise. | Better if we also need KYC/Travel Rule/case workflows later. |
| Crypto APIs Verify Address | Public product page lists Tron support and risk score/flags. | Public infra plans: Free, Starter $49/mo, Scale $299/mo, Pro $799/mo; endpoint credit cost must be checked in docs. | Practical low-friction prototype option, but validate AML depth and false positives. |
| Bitrace AML API | KYA/KYT APIs, address risk, transaction chain analysis, suspicious pattern detection. | Pricing not clearly public. | Worth demo because TRON/Asia stablecoin intelligence may be strong. |

Implementation shape:

- `AmlProvider.checkAddress({ chain: "tron", address }) -> ProviderRiskSignal[]`
- cache by `{provider, chain, address, policyVersion}` with TTL;
- store raw response separately from normalized score;
- expose reason text as "Provider signal: ..." instead of "criminal";
- allow provider weight tuning and provider-specific false-positive overrides.

Sources:

- [Chainalysis Sanctions API overview](https://auth-developers.chainalysis.com/sanctions-screening/api-reference/api-overview)
- [Chainalysis KYT](https://www.chainalysis.com/product/kyt/)
- [TRM Wallet Screening](https://www.trmlabs.com/blockchain-intelligence-platform/wallet-screening)
- [Elliptic supported networks](https://developers.elliptic.co/docs/supported-crypto-networks)
- [Crystal Tron support](https://crystalintelligence.com/product-updates/product-update-crystal-adds-tron-support-in-the-latest-product-update/)
- [Scorechain free sanctions API](https://www.scorechain.com/developers/free-sanction-api)
- [Crypto APIs Verify Address](https://cryptoapis.io/products/verify-address)
- [Crypto APIs pricing](https://cryptoapis.io/pricing)
- [Bitrace API docs](https://docs.bitrace.io/api-reference/introduction)
- [Sumsub Crypto Monitoring](https://sumsub.com/crypto-monitoring/)

## 3. Graph Proximity

Graph proximity should be a supporting signal, not a verdict.

MVP graph checks:

- direct incoming from labeled risky address;
- 1-hop exposure to labeled address;
- 2-hop exposure with amount/time preservation;
- shared collector address;
- repeated route through same intermediate;
- known exchange/bridge/high-degree services as dampeners, not automatic risk.

Technical implementation:

- store normalized transfers: `tx_hash`, `block`, `timestamp`, `from`, `to`, `contract`, `amount_raw`, `amount_decimal`, `confirmed`;
- create indexes on `from`, `to`, `timestamp`, `contract`;
- build bounded BFS to depth 2;
- skip or cap high-degree nodes such as large exchanges;
- weight by recency, amount similarity, number of repeated paths, and label severity;
- output explainable reasons like `direct_dirty_exposure`, `risky_1_hop`, `shared_collector`.

This can start with our own observed transactions and later expand to a wider TRON indexer.

## 4. Behavioral Patterns

Patterns to implement as separate detectors:

| Pattern | Data needed | MVP heuristic |
| --- | --- | --- |
| Amount splitting | sender outgoing transfers over time | Many transfers with similar amounts or round-number fragments within a short window. |
| Fast transit | incoming and outgoing transfers for same sender | Funds arrive and leave within minutes/hours. |
| Fresh wallet with large activity | first seen time, tx count, incoming amount | Young address + large first/early transfer. |
| Collector wallet | many incoming senders, one/few outgoing destinations | Many inputs to one address, periodic consolidation. |
| Repeated equal amounts | transfer history | Same amount repeated across many counterparties. |
| Bridge-like route | known bridge labels + cross-chain provider signals later | Treat as context unless bridge is risky or route is suspicious. |
| Mixer-like route | split/recombine, high fan-in/fan-out, known risky service labels | On TRON this is mostly behavioral/label-based; Tornado Cash itself is EVM-specific. |
| Many inputs then one output | address flow sequence | Fan-in followed by fast single large outgoing transfer. |
| Approve/transferFrom risk | approval events, transfer method/contract details | Detect risky approvals and frequent `transferFrom` patterns. |
| Risky contract/service interaction | contract labels + TronScan security | Flag known risky contracts/services. |

Implementation shape:

- each detector returns `RiskSignal[]`;
- each detector has unit tests with synthetic transfer windows;
- store window stats in `address_stats` or materialized views;
- keep thresholds configurable in `risk_policy`.

## 5. Incoming Transfer Context

For every incoming transfer we should compute:

- amount and amount bucket;
- first time this sender paid this watched wallet;
- prior successful interactions between sender and watched wallet;
- sender age and approximate tx count;
- frequency of transfers into this watched wallet;
- whether sender is an exchange/bridge/collector/trusted address;
- whether the incoming transfer itself is unusual for the user's wallet history.

MVP context signals:

- `first_contact_large_amount`;
- `new_sender_high_frequency`;
- `fresh_sender_large_transfer`;
- `repeat_sender_low_risk_history`;
- `amount_outlier_for_wallet`.

This layer is useful because the same sender risk can mean different things depending on the user's normal flow.

## Recommended Build Order

1. Finish the current foundation: bot, parser, storage, risk engine, monitoring worker, admin labels.
2. Add `risk_signal_observations` table for normalized provider/detector outputs and raw evidence pointers.
3. Add TronScan security adapter: account security + auth security.
4. Add sanctions baseline: Chainalysis free sanctions API or Scorechain free sanctions API.
5. Add Chainabuse on-demand lookup for reported scam/phishing signals.
6. Build graph proximity v0 using only our observed transactions.
7. Add behavior detectors one by one with synthetic tests.
8. Run provider bake-off: Elliptic, TRM, Crystal, Chainalysis, Bitrace, Crypto APIs.

## Open Decisions

- Which commercial AML provider to trial first.
- Whether to use TronScan polling only for v0.1 or move to TronGrid contract-event indexing earlier.
- How long to cache AML provider responses.
- Whether service admins can globally label addresses immediately, or labels require two-admin confirmation for high-impact categories.
- Whether HIGH/CRITICAL service-admin alerts should include raw provider evidence links in MVP.
