# Forensic Route Search Context

Date: 2026-05-24

Scope: project context for the forensic route-search work. This document describes the route-search layer only and intentionally does not document the approval-alert subsystem as a separate product area. `transferFrom` appears here only as route evidence when a USDT transfer edge can be classified that way.

## Current State

Phase 10 has been implemented as a CLI-first, read-only forensic route-search layer for official TRON USDT transfers.

The feature answers:

> Given source wallet A, target wallet B, optional amount and time window, what are the most plausible USDT money-flow paths?

Current default scope:

- TRON only.
- Official USDT TRC20 contract only.
- Live TronScan collection through the existing `TronscanClient`.
- Max depth intended for v0: 3 hops.
- Default time window: 30 days.
- Fuzzy amount matching instead of exact-only matching.
- Ranked candidate paths with score, confidence, reasons, transaction hashes, amounts and timestamps.
- Evidence-first persistence to Postgres.
- No Telegram command in this phase.
- No ML, RDF, SPARQL, OWL, Datalog or external AML-provider dependency.
- Read-only: the code never signs, revokes or controls funds.

## Implemented Files

Core implementation:

- `src/forensics/routeSearch.ts` - graph collection, transfer normalization, candidate path building, raw evidence and observation generation.
- `src/forensics/routeScorer.ts` - explainable rule/fuzzy scoring for candidate paths.
- `src/forensics/routeReport.ts` - CLI text report formatter.
- `src/forensics/routeCliArgs.ts` - CLI argument parser and usage text.
- `scripts/forensicRouteSearch.ts` - executable CLI entry point.

Storage and types:

- `migrations/011_forensic_route_search.sql` - Postgres tables and indexes.
- `src/types.ts` - forensic case/path/edge/report types.
- `src/storage/repositories.ts` - transactional persistence for route-search results.

Tests:

- `tests/forensics/routeSearch.test.ts` - route collection/path construction/caps/filtering.
- `tests/forensics/routeScorer.test.ts` - scoring, fuzzy amount/time, service dampening.
- `tests/forensics/routeReport.test.ts` - report formatting.
- `tests/forensics/routeCliArgs.test.ts` - CLI parser and npm-safe usage.
- `tests/storage/forensicRepositories.test.ts` - repository transaction and inserts.

Package entry:

- `package.json` now exposes `npm run forensic:route`.

## Data Model

Migration `011_forensic_route_search.sql` adds three route-search tables.

`forensic_cases` stores the search request:

- `id`
- `source_address`
- `target_address`
- `amount_usdt`
- `window_start`
- `window_end`
- `status`
- `created_at`
- `updated_at`

Allowed statuses:

- `completed`
- `partial`
- `failed`

`forensic_route_paths` stores ranked candidate paths:

- `id`
- `case_id`
- `rank`
- `score`
- `confidence`
- `path_addresses`
- `features`
- `reasons`
- `raw_evidence_id`
- `created_at`

Allowed confidence values:

- `low`
- `medium`
- `high`

`forensic_route_edges` stores ordered transfer evidence for each path:

- `id`
- `path_id`
- `from_address`
- `to_address`
- `tx_hash`
- `amount_raw`
- `timestamp`
- `method`
- `edge_type`
- `created_at`

Allowed edge types:

- `normal_transfer`
- `transfer_from`
- `unknown`

The implementation also reuses existing audit tables:

- `raw_evidence` for structured route evidence JSON.
- `risk_signal_observations` for review-friendly observations.

Important persistence behavior:

- `saveForensicRouteSearchResult(...)` runs in one DB transaction.
- The case row is upserted.
- Existing route paths for the same case are deleted before inserting the new ranked set.
- Edges cascade through `forensic_route_paths`.
- Raw evidence and observations are inserted/upserted with stable IDs.

## Internal Types

New route-search types in `src/types.ts`:

- `ForensicCaseStatus`
- `ForensicRouteConfidence`
- `ForensicRouteEdgeType`
- `ForensicCaseInput`
- `RouteScoreFeature`
- `ForensicRouteEdge`
- `ForensicRoutePath`
- `RouteSearchOptions`
- `RouteSearchReport`

The current shape is future-friendly for ML or cross-chain work because features and reasons are stored as JSON arrays, not as flattened message strings only.

## Route Collection

`runForensicRouteSearch(...)` is the main route-search function.

Inputs:

- `sourceAddress`
- `targetAddress`
- optional `amountUsdt`
- `windowStart`
- `windowEnd`
- `maxDepth`
- `maxPagesPerAddress`
- `pageLimit`
- `limit`
- `tronClient`
- optional `getAddressMetadata`

Collection behavior:

- expands forward from the source wallet;
- expands backward from the target wallet;
- fetches related TRC20 transfers through `listRelatedTrc20Transfers`;
- applies `minTimestamp` and `endTimestamp`;
- enforces `maxDepth`, `maxPagesPerAddress` and `pageLimit`;
- deduplicates edges by tx/from/to/amount key;
- normalizes transfers into `ForensicRouteEdge`.

Filtering behavior:

- keeps only the official TRON USDT contract;
- requires `confirmed === true`;
- skips reverted transfers;
- skips failed `contractRet` / `finalResult`;
- skips malformed tx hashes, addresses, amounts and timestamps;
- classifies `transferFrom` when method metadata or method id indicates it.

Address metadata:

- `getAddressMetadata(address)` is used to tag service/hub-like nodes.
- Service-like metadata reduces confidence but does not automatically mark an address as dirty.

## Candidate Path Builder

Current candidate building is bounded and evidence-first.

Supported candidate paths:

- direct `A -> B`;
- one-hop `A -> hop -> B`;
- two-hop `A -> hop1 -> hop2 -> B`;
- partial paths only when no exact target path is found.

Path behavior:

- simple paths only; repeated addresses are skipped;
- outgoing edges are sorted by timestamp;
- exact target paths are preferred over partial paths;
- candidate count is capped before final ranking;
- every returned path preserves ordered edge evidence.

Stored path evidence includes:

- ordered addresses;
- ordered tx hashes;
- raw USDT amounts;
- timestamps;
- transfer method;
- edge type.

Current implementation note: time order is used in edge sorting and scoring, but strict time-respecting path rejection can be hardened further if we want to reject any hop that goes backward in time.

## Scoring

Scoring lives in `src/forensics/routeScorer.ts`.

Policy version:

- `2026-05-24-forensic-route-v1`

Current implemented scoring features:

- `+40` if `transferFrom` appears in the candidate path.
- `+25` if funds move from source to a non-service intermediate receiver.
- `+0..25` fuzzy amount preservation.
- `+0..20` fuzzy time proximity between hops.
- `-20` service/router/bridge hub dampener for intermediate nodes.

Amount preservation buckets:

- `>= 99%`: 25
- `>= 95%`: 22
- `>= 90%`: 18
- `>= 70%`: 10
- `>= 50%`: 4
- below 50%: 0

Time proximity buckets:

- `<= 10 minutes`: 20
- `<= 1 hour`: 16
- `<= 24 hours`: 8
- `<= 7 days`: 3
- above 7 days: 0

Confidence rules:

- `low` for partial paths.
- `low` for service-dampened paths.
- `high` for exact target paths with strong amount preservation, short timing and enough total score.
- `medium` for exact target paths with weaker amount/time evidence but enough score.
- otherwise `low`.

Language guardrail:

- Reasons say `candidate path requires manual review`.
- The feature does not claim that fraud is proven.

Known scoring gap versus the original plan:

- Split/merge scoring is not implemented yet.
- Fresh/high-volume transit wallet scoring is not implemented yet.
- CEX/hot-wallet terminal dampening is not implemented as a dedicated rule yet.

## CLI

Script:

```bash
npm run forensic:route
```

Working npm syntax in this Windows/PowerShell environment:

```bash
npm run forensic:route -- -- --source <A> --target <B> --amount 320000 --days 30 --max-depth 3 --limit 5 --dry-run
```

Direct node syntax:

```bash
node --import tsx scripts/forensicRouteSearch.ts --source <A> --target <B> --amount 320000 --days 30 --max-depth 3 --limit 5 --dry-run
```

Supported CLI args:

- `--source`
- `--target`
- `--amount`
- `--days`
- `--max-depth`
- `--max-pages`
- `--limit`
- `--dry-run`

Parser behavior:

- supports `--name value`;
- supports `--name=value`;
- supports the extra npm separator `--`;
- validates TRON addresses through existing address classification;
- validates positive integer options.

Important npm note:

- In this environment, `npm run forensic:route -- --source ...` does not pass flags to the script correctly.
- The working form is `npm run forensic:route -- -- --source ...`.
- The CLI usage now prints the npm-safe form.

Report output includes:

- case id;
- status;
- source and target;
- amount;
- time window;
- ranked paths;
- score and confidence;
- path id;
- raw evidence id;
- reasons;
- ordered edges;
- tx hashes;
- USDT amounts;
- timestamps;
- method and edge type;
- missing/partial checks;
- saved row ids when not using `--dry-run`.

## Verification Already Run

Targeted forensic tests:

```bash
npx vitest run tests/forensics tests/storage/forensicRepositories.test.ts
```

Result:

- 5 files passed.
- 10 tests passed.

Typecheck:

```bash
npm run typecheck
```

Result:

- passed.

Full test suite:

```bash
npm test
```

Result:

- 29 files passed.
- 254 tests passed.

Whitespace check:

```bash
git diff --check
```

Result:

- no whitespace errors;
- only Git CRLF warnings for existing Windows line-ending behavior.

Live dry-run smoke:

```bash
npm run forensic:route -- -- --source TGw88ZRK3tNjUbbk2yxs1i7rJyz7cMv2Ck --target TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe --amount 900000 --days 60 --max-depth 1 --max-pages 1 --limit 1 --dry-run
```

Result:

- command completed successfully;
- found direct path `TGw88... -> TLhV...`;
- tx hash: `2fc007b36b79791ab750eb9333d8975126d83e873cde008e7dbdae4058eae31a`;
- score: `25/100`;
- confidence: `low`;
- dry-run did not save DB rows.

## Current Limitations

This is v0 and intentionally conservative.

Current limitations:

- TRON-only.
- USDT-only.
- No Telegram command.
- No cross-chain bridge correlation.
- No CEX boundary model.
- No ML.
- No external AML/KYT provider.
- No RDF/SPARQL/OWL/Datalog graph engine.
- No dedicated split/merge detector yet.
- No dedicated fresh-wallet/high-volume-transit score yet.
- Strict time-respecting path rejection can be made stronger.
- Search relies on live TronScan pagination and the configured page caps.

## Recommended Near-Term Hardening

Recommended next small phases:

1. Enforce strict temporal path validity: every next hop must be after the previous hop.
2. Add split/merge behavior around collector-like wallets.
3. Add fresh/high-volume transit wallet scoring when account metadata supports it.
4. Add dedicated service categories: bridge/router/CEX/hot wallet.
5. Add deterministic fixtures based on the 320k/TLhV research notes, with synthetic tx hashes and amounts.
6. Add documentation for DB migration and CLI usage in README after the implementation branch is ready to land.

## Cross-Chain Research Conclusion

Короткий ответ: кроссчейн сделать можно, но я бы не смешивал его с первым v0. Для продукта правильнее: **Phase 10 = надежный TRON USDT route search**, затем **Phase 10B / 11 = Cross-chain Route Search Preview**. Причина простая: внутри TRON у нас есть прямой поток `USDT Transfer / transferFrom`; между сетями появляется “разрыв доказательности”: мост, CEX, swap-router или off-chain matching.

По текущему дереву уже виден single-chain foundation: [routeSearch.ts](C:/Users/User/OneDrive/Desktop/smartcontract/src/forensics/routeSearch.ts), [routeScorer.ts](C:/Users/User/OneDrive/Desktop/smartcontract/src/forensics/routeScorer.ts), [011_forensic_route_search.sql](C:/Users/User/OneDrive/Desktop/smartcontract/migrations/011_forensic_route_search.sql), `forensic:route` в [package.json](C:/Users/User/OneDrive/Desktop/smartcontract/package.json). Файлы не менял.

### Главный вывод

Кроссчейн надо делать как **chain-aware graph**, а не как “один большой граф адресов”. Узел должен быть `(chain, address)`, ребро должно быть типизировано: `token_transfer`, `transfer_from`, `bridge_lock`, `bridge_mint/release`, `bridge_message`, `cex_boundary`, `inferred_crosschain_link`.

Самая сильная доказательность:

1. source-chain tx уходит в известный bridge/router;
2. есть protocol-level correlation: bridge message id / nonce / source tx / destination tx;
3. destination-chain tx выпускает или переводит сопоставимую сумму на target/hop;
4. временной порядок и amount preservation сходятся.

Самая слабая доказательность: деньги ушли в CEX/hot wallet на TRON, а потом похожая сумма появилась на другом чейне. Это нужно показывать как `cex-boundary / review-needed`, не как найденный путь.

### Какие API нужны

Минимальный набор для TRON-only v0:

- TRON token transfers: [TronScan TRC20 transfers API](https://docs.tronscan.org/en/api/transactions-and-transfers).
- TRON tx details / metadata: TronScan + TronGrid/full node fallback.
- Address metadata: TronScan labels/tags, уже похоже используется через `getAddressMetadata`.

Для EVM-кроссчейна:

- ERC20 transfers по адресу/контракту: [Etherscan API V2](https://docs.etherscan.io/v2-migration), где multichain делается через `chainid`.
- Более удобный indexed transfer provider: [Alchemy Transfers API](https://www.alchemy.com/docs/reference/alchemy-getassettransfers).
- Open-source explorer fallback: [Blockscout token transfers API](https://blockscout.mintlify.app/api-reference/get-token-token-transfers).
- Multi-chain индексатор, если не хотим поддерживать много explorer-клиентов: [Bitquery](https://docs.bitquery.io/) поддерживает Tron/EVM/Solana и historical transfers.

Для bridge/cross-chain correlation:

- Bridge route/status metadata: [LI.FI API](https://docs.li.fi/agents/reference/endpoint-specs).
- LayerZero messages: [LayerZero Scan API](https://docs.layerzero.network/v2/tools/layerzeroscan/overview).
- Wormhole transfers/messages: [WormholeScan API guide](https://wormhole.com/docs/products/messaging/guides/wormholescan-api/).
- Official USDT chain/contracts: [Tether supported protocols](https://tether.to/en/supported-protocols/).

Для labels/KYT, опционально:

- OFAC public screening/list files: [OFAC Sanctions List Service](https://sanctionslist.ofac.treas.gov/) and [OFAC FAQ on digital currency addresses](https://ofac.treasury.gov/faqs/594).
- Commercial, later: [Chainalysis KYT](https://www.chainalysis.com/product/kyt/), [Elliptic screening](https://www.elliptic.co/solutions/screening), TRM. Это не MVP-зависимость.

### Annotated Bibliography

| Source | Type | Что берем | Ограничение |
|---|---:|---|---|
| Meiklejohn et al., 2013, [A Fistful of Bitcoins](https://www.usenix.org/system/files/login/articles/03_meiklejohn-online.pdf) | academic | Service tagging, ground-truth, осторожность с attribution | Bitcoin/UTXO, не TRON |
| Kalodner et al., 2017/2020, [BlockSci](https://arxiv.org/abs/1709.02489) | academic/system | Graph-analysis pipeline, normalized facts, fast local analytics | Heavy infra, не нужен целиком |
| Weber et al., 2019, [AML in Bitcoin / Elliptic dataset](https://arxiv.org/abs/1908.02591) | academic/industry | Сохранять features сейчас для ML later; RF baseline сильнее GCN | Bitcoin, часть features non-public |
| Lal et al., 2021, [Understanding Money Trails](https://arxiv.org/abs/2108.11818) | academic | Temporal money trails, path-based heuristics | Ethereum, не approval drains |
| Xia et al., 2025, [Two-Layer USDT-TRC20/TRX Network](https://www.mdpi.com/2410-387X/9/4/65) | academic | Для TRON полезно учитывать USDT + TRX gas/top-up graph | Не про approval phishing |
| Zhang et al., 2022, [CLTracer](https://www.sciencedirect.com/science/article/pii/S0167404821003825) | academic | Cross-ledger tracing, false-positive analysis | Старые exchange platforms, не мосты v2 |
| [CONNECTOR](https://arxiv.org/abs/2409.04937) | academic | Association of cross-chain bridge txs через contracts/events | Research prototype, EVM-heavy |
| [ABCTRACER](https://arxiv.org/abs/2504.01822) | academic | Bidirectional cross-chain tracing in DeFi bridges | Новый источник, не TRON-first |
| Wu et al., 2014/2016, [Temporal Graph Path Problems](https://www.microsoft.com/en-us/research/publication/path-problems-in-temporal-graphs/) | academic | Time-respecting paths: порядок tx важнее static shortest path | Сложнее, чем нужно MVP |
| Yen, 1971, [K shortest loopless paths](https://pubsonline.informs.org/doi/10.1287/mnsc.17.11.712) | academic | Later для ranked alternatives | Не учитывает время/amount |
| Eppstein, 1998, [k shortest paths](https://epubs.siam.org/doi/10.1137/S0097539795290477) | academic | Later для масштабного path enumeration | Paths can be non-simple |
| Zadeh, 1965, [Fuzzy Sets](https://doi.org/10.1016/S0019-9958(65)90241-X) | academic | Основа fuzzy scores вместо binary checks | Общая теория, не AML |
| Chainalysis, 2023, [Approval phishing](https://www.chainalysis.com/blog/approval-phishing-cryptocurrency-scams-2023/) | industry | `approve` + spender drains via token permission | Proprietary methodology |
| SlowMist, 2023, [TRON phishing / transferFrom](https://slowmist.medium.com/new-scam-alert-beware-of-phishing-urls-disguised-as-transfer-addresses-95f094427364) | industry/blog | Практический TRON pattern: `increaseApproval` -> `transferFrom` | Case-based, not peer-reviewed |
| Revoke.cash, [Token approvals](https://revoke.cash/learn/approvals) | docs | UX wording: approval не равно theft, revoke hygiene | EVM-oriented |

### Applicability Matrix

| Concept | MVP? | Почему |
|---|---:|---|
| PostgreSQL + TS property graph facts | yes | Уже совпадает со стеком, проще RDF |
| Bounded bidirectional BFS | yes | A и B известны, depth 3, снижает explosion |
| Temporal path constraint | yes | Нельзя считать путь валидным, если hop идет назад во времени |
| Fuzzy amount/time scoring | yes | Реальные flows дробятся, комиссии/роутеры ломают exact match |
| Service/hub dampening | yes | Иначе CEX/bridge/router будут давать ложные “пути” |
| K-shortest paths | later | Нужен weighted graph и больше hop-depth |
| A* | no/later | Нет надежной admissible heuristic для money-flow |
| Flow/max-flow split-merge | later | Полезно для laundering, но увеличивает scope |
| ML/GNN/embeddings | later | Нужны размеченные cases и model governance |
| Cross-chain bridge correlation | 10B | Делать после стабильного TRON route evidence |

### Recommended MVP Architecture

Для v0:

- `forensic_cases`: source/target/amount/window/status.
- `forensic_route_paths`: ranked candidates, score, confidence, addresses, features, reasons.
- `forensic_route_edges`: ordered transfer evidence.
- `raw_evidence`: полный JSON по tx/edges/features.
- `risk_signal_observations`: только review-friendly observation, без “fraud proven”.

Для cross-chain extension:

- добавить `chain`/`chain_id` в case endpoints и edges;
- хранить `token_contract`, `token_standard`, `decimals`, `log_index/event_index`;
- добавить `edge_type`: `bridge_source`, `bridge_destination`, `bridge_message`, `cex_boundary`, `inferred_crosschain`;
- добавить `bridge_evidence`: protocol, source tx, destination tx, message id/nonce, status, API/provider.

### Path Search Recommendation

Для MVP лучший алгоритм: **bounded bidirectional expansion + candidate intersection + temporal/amount filter**.

DFS/BFS проще и достаточно при depth 3. Bidirectional search лучше, потому что target известен. K-shortest и A* пока не нужны: они решают routing-задачу, а у нас forensic-задача с evidence caps, service dampeners и temporal constraints. Temporal traversal нужен как правило валидации: каждый следующий hop должен быть позже предыдущего и попадать в окно.

### Explainable Scoring

Предлагаю score до 100:

- `+40`: `transferFrom` from source/victim, когда caller/spender известен.
- `+25`: первый receiver похож на collector, не spender и не service.
- `+0..25`: amount preservation: `99-100% = 25`, `95-99 = 22`, `90-95 = 18`, `70-90 = 10`, `50-70 = 4`.
- `+0..20`: time proximity: `<10m = 20`, `<1h = 16`, `<24h = 8`, `<7d = 3`.
- `+15`: split/merge около collector.
- `+10`: fresh/high-volume transit wallet.
- `+30`: exact bridge correlation через bridge API/event, только cross-chain.
- `-20`: service/router/bridge-heavy route без exact bridge evidence.
- `-30`: CEX/hot-wallet terminal, потому что on-chain continuity оборвана.

Confidence:

- `high`: exact target, amount >=95%, short timing, no CEX boundary, evidence tx hashes complete.
- `medium`: exact target, но weak amount/time или service-heavy path.
- `low`: partial path, inferred cross-chain, CEX boundary, or hub-noise.

### What Not To Use Yet

Не брать RDF/OWL/SPARQL/Datalog: больше инфраструктуры, чем пользы для depth-3 path search.

Не брать ProbLog/MLN: нужны вероятностные модели и размеченные priors, которых нет.

Не брать graph embeddings/GNN как основной слой: Elliptic показывает ценность ML, но даже там нужен большой labeled dataset, а часть features non-public.

Не делать centrality/betweenness основным сигналом: CEX/bridge/router всегда будут “важными”, но это не доказывает связь A->B.

Не делать Telegram command до CLI validation: сначала нужен воспроизводимый отчет и сохраненные evidence.

### Concrete Search Queries

- `TRON USDT TRC20 forensic transaction graph path tracing`
- `approval phishing transferFrom token approval drain blockchain forensics`
- `USDT TRC20 transaction graph money laundering address identity recognition`
- `temporal graph path search money flow blockchain`
- `bounded bidirectional BFS transaction graph path search`
- `cross-chain bridge transaction association forensic tracing`
- `LayerZero transaction association source destination tx forensic`
- `WormholeScan token bridge transaction source destination API`
- `cryptocurrency cross-ledger tracing address relationship CLTracer`
- `explainable rule based AML transaction monitoring graph`

### Product Plan

Я бы разбил так:

Phase 10A - TRON Route Search Hardening

CLI-first, TRON official USDT only, depth 3, evidence-first reports, deterministic tests, no Telegram.

Phase 10B - Chain-Aware Data Model

Добавить `chain`, `chain_id`, `token_contract`, `log_index`, normalized provider interface. Без новых сетей в UI.

Phase 10C - EVM USDT Collector

Ethereum/BSC/Polygon/Base/Arbitrum через Etherscan V2 или Alchemy. Только official USDT contracts.

Phase 10D - Bridge Evidence Prototype

LI.FI/LayerZero/Wormhole adapters. Сохранять exact bridge correlation отдельно от inferred links.

Phase 10E - Cross-Chain Scorer

Новые reasons: `exact_bridge_link`, `inferred_bridge_link`, `cex_boundary`, `crosschain_review_needed`.

Phase 10F - Report + Fixtures

CLI report показывает chain per hop, bridge boundary, confidence downgrade, missing checks.

Итоговая рекомендация: **оставить “Phase 10 - Forensic Route Search v0” single-chain TRON-first**, но сразу спроектировать типы и storage так, чтобы **Phase 10B cross-chain** не ломал модель. Это дает быстрый полезный продукт сейчас и не загоняет нас в ложную точность на кроссчейне.
## Cross-Chain Forensic Route Search Research Baseline

Date: 2026-05-24

Status: canonical research baseline for future Phase 10B / Phase 11 planning.

This section intentionally preserves TRON USDT route search v0 as the reliable single-chain foundation. Cross-chain route search must extend it as a separate evidence-aware layer, not replace it.

### 1. Executive Summary

Cross-chain route search is feasible, but only if the product explicitly separates evidence classes. The system must not present a weak amount/time match across chains as if it were a confirmed route. The safe MVP shape is:

- keep TRON official USDT transfers and `transferFrom` classification as Phase 10 v0;
- add chain-aware graph identity with nodes shaped as `(chain, chain_id, address)`;
- add typed edges for token transfers, bridge source events, bridge destination events, bridge protocol links, service/router/CEX boundaries and weak inferred links;
- store bridge protocol-level correlation separately from ordinary transfers;
- downgrade or stop path confidence at CEX/hot-wallet/router/service boundaries;
- keep all scoring explainable with feature-level reasons.

The highest-value MVP is not a universal cross-chain tracer. It is a conservative "cross-chain route preview" that can say:

- exact same-chain evidence observed;
- bridge source and destination evidence observed;
- bridge protocol metadata correlates source and destination transactions;
- service or CEX boundary reached, continuity is not observable from public chain data;
- weak inferred cross-chain candidate exists and requires manual review.

### 2. Evidence Model

Evidence levels to store and report separately:

| Evidence level | Meaning | Product handling |
|---|---|---|
| `same_chain_token_transfer` | Confirmed token `Transfer` on one chain, with transaction hash and event/log index | Strong exact on-chain evidence |
| `transfer_from` | Token transfer classified as `transferFrom` or spender-driven transfer | Strong same-chain route evidence, especially for approval-drain cases |
| `bridge_source_event` | Lock, burn, deposit, send or swap-start event in a known bridge/router contract | Exact source-chain evidence, not cross-chain proof by itself |
| `bridge_destination_event` | Mint, release, receive, redeem or execution event on destination chain | Exact destination-chain evidence, not linked by itself |
| `bridge_message_id` / `nonce` / `GUID` / `VAA` | Protocol-level source-to-destination correlation | Strong cross-chain bridge correlation |
| `CEX boundary` | Funds enter or leave an exchange, custodian, hot wallet or pooled service | On-chain continuity stops or becomes weak |
| `inferred amount/time match` | Similar amount appears on another chain near in time without bridge protocol correlation | Weak inferred cross-chain link only |

Reporting guardrail:

- never say "fraud proven";
- never merge confirmed evidence and inference in one reason;
- always label each edge with `evidence_class` and `evidence_strength`;
- make CEX/service/router boundaries explicit in the path output.

Recommended evidence classes:

```ts
type EvidenceClass =
  | 'exact_onchain_evidence'
  | 'bridge_protocol_correlation'
  | 'service_router_cex_boundary'
  | 'weak_inferred_crosschain_link';
```

### 3. Literature / Industry Review

| Source | Type | Method | Applies to project | Limitations | Link |
|---|---|---|---|---|---|
| Yousaf, Kappos, Meiklejohn, "Tracing Transactions Across Cryptocurrency Ledgers" | USENIX Security | Cross-ledger heuristics across ShapeShift and multiple ledgers | Establishes that cross-ledger tracing is possible but heuristic and platform-dependent | Historical exchange platform; not modern bridge-first | https://www.usenix.org/conference/usenixsecurity19/presentation/yousaf |
| CLTracer | Academic | Cross-ledger address relationship tracing and false-positive analysis | Useful warning against overconfident cross-ledger association | Older exchange/cross-ledger setting | https://www.sciencedirect.com/science/article/pii/S0167404821003825 |
| CONNECTOR | arXiv | Cross-chain bridge transaction association from bridge contract traces/logs | Direct model for bridge source/destination event correlation | Research prototype; EVM/bridge-heavy | https://arxiv.org/abs/2409.04937 |
| ABCTRACER / "Track and Trace" | arXiv | Bidirectional cross-chain transaction discovery in multi-blockchain ecosystems | Supports bounded bidirectional tracing and explicit bridge cue extraction | New research; not TRON-first | https://arxiv.org/abs/2504.01822 |
| BlockSci | Academic system | Normalized blockchain analytics platform | Supports normalized evidence tables and reproducible graph analytics | Too heavy as required MVP stack | https://arxiv.org/abs/1709.02489 |
| A Fistful of Bitcoins | USENIX | Service attribution, address clustering, empirical Bitcoin forensics | Service labels are useful, but attribution must stay cautious | Bitcoin/UTXO-specific | https://www.usenix.org/publications/login/december-2013-volume-38-number-6/fistful-bitcoins-characterizing-payments-among |
| Elliptic Bitcoin AML dataset | Academic/industry | Temporal transaction graph with labels and features | Justifies preserving features for later ML, but not using ML as MVP basis | Bitcoin, non-public feature details, ML governance needed | https://arxiv.org/abs/1908.02591 |
| Understanding Money Trails | Academic | Temporal money-flow trails and transaction graph features | Supports time-respecting path validation and explainable path features | Ethereum-focused | https://arxiv.org/abs/2108.11818 |
| Temporal Graph Path Problems | Academic | Time-respecting path theory | Supports strict temporal ordering in path builder | General graph theory, not blockchain-specific | https://www.cse.cuhk.edu.hk/~jcheng/papers/tmpPath_vldb14.pdf |
| Chainalysis approval phishing reports | Industry | Approval phishing and spender-driven drains | Supports treating `transferFrom` as important route evidence | Proprietary methodology and labels | https://www.chainalysis.com/blog/approval-phishing-cryptocurrency-scams-2023/ |
| Chainalysis tracing-through-service discussion | Industry | Explains service boundary limits | Supports CEX/service terminal handling | Product framing, not peer-reviewed | https://www.chainalysis.com/blog/blockchain-analysis-trace-through-service-exchange/ |
| SlowMist TRON phishing / `transferFrom` cases | Industry case writeup | TRON approval/authorization theft examples | Directly relevant to TRON USDT v0 evidence classification | Case-based | https://slowmist.medium.com/new-scam-alert-beware-of-phishing-urls-disguised-as-transfer-addresses-95f094427364 |
| Elliptic cross-chain crime reports | Industry | Cross-chain laundering typologies through bridges, DEXs and swaps | Supports product need and typology vocabulary | Proprietary data; use as context only | https://www.elliptic.co/resources/the-state-of-cross-chain-crime-2025 |
| LI.FI API docs | API docs | Routes, quotes, status, sending and receiving transaction metadata | Useful for aggregator-level route/status evidence | Only LI.FI-routed flows | https://docs.li.fi/agents/reference/endpoint-specs |
| LayerZero Scan API docs | API docs | Message lookup by transaction, wallet, GUID and message metadata | Strong protocol-level bridge correlation for LayerZero | LayerZero only | https://docs.layerzero.network/v2/tools/layerzeroscan/api |
| WormholeScan API docs | API docs | Operations and VAA/source/target metadata | Strong protocol-level bridge correlation for Wormhole | Wormhole only | https://wormhole.com/docs/products/messaging/guides/wormholescan-api/ |
| Etherscan V2 docs | API docs | Multichain EVM explorer API via `chainid` | Practical EVM fallback collector | Rate limits and per-chain endpoint behavior | https://docs.etherscan.io/v2-migration |
| Alchemy `getAssetTransfers` docs | API docs | Indexed transfer history and raw token metadata | Practical EVM/L2 transfer collector | Provider dependency and usage limits | https://www.alchemy.com/docs/data/transfers-api/transfers-endpoints/alchemy-get-asset-transfers |
| Bitquery multichain docs | API docs | Multichain GraphQL transfer and address data | Useful later for wide multichain coverage | Vendor dependency and query limits | https://docs.bitquery.io/ |
| Tether supported protocols | Official issuer docs | Canonical USDT protocol/contract reference | Required token allowlist input | Not a transfer API | https://tether.to/en/supported-protocols/ |

### 4. Architecture Recommendation

#### Storage + Domain Model

Do not collapse all networks into one address graph. Use chain-aware identity:

```ts
type RouteNode = {
  chain: string;
  chainId: number | string;
  address: string;
};
```

Recommended fields for cross-chain route edges:

- `chain`
- `chain_id`
- `token_contract`
- `token_standard`
- `decimals`
- `block_number`
- `tx_hash`
- `log_index`
- `event_index`
- `bridge_protocol`
- `bridge_message_id`
- `bridge_nonce`
- `source_tx_hash`
- `destination_tx_hash`
- `edge_type`
- `evidence_strength`
- `evidence_class`
- `provider`
- `provider_payload`

Recommended edge types:

```ts
type CrossChainRouteEdgeType =
  | 'token_transfer'
  | 'transfer_from'
  | 'bridge_source'
  | 'bridge_destination'
  | 'bridge_protocol_link'
  | 'cex_boundary'
  | 'router_boundary'
  | 'service_boundary'
  | 'inferred_crosschain_link'
  | 'unknown';
```

Add a dedicated bridge-correlation table instead of hiding bridge evidence inside normal transfer rows:

```sql
forensic_bridge_correlations(
  id,
  protocol,
  source_chain_id,
  destination_chain_id,
  source_tx_hash,
  destination_tx_hash,
  source_event_index,
  destination_event_index,
  message_id,
  nonce,
  vaa_id,
  status,
  evidence_strength,
  provider,
  raw_evidence_id,
  created_at
)
```

#### Transfer Graph Collector

Collectors needed by phase:

- TRON collector: keep official TRON USDT only; harden confirmation/failure/revert filtering; preserve `transferFrom` classification.
- EVM collector: collect ERC20 transfers for official USDT contracts on selected EVM chains.
- Bridge API collectors: LayerZero Scan, WormholeScan, LI.FI status/route metadata.
- Explorer fallback: Etherscan V2, Alchemy, Blockscout-style APIs where available.
- Address metadata collector: service labels, CEX/hot-wallet tags, bridge/router contracts.
- Service label store: source, provider, category and confidence; labels must downgrade confidence, not prove ownership.

#### Candidate Path Builder

MVP path construction:

- bounded bidirectional search from source and target;
- nodes are `(chain, chain_id, address)`;
- edges are typed and evidence-classed;
- strict temporal ordering: later hop must not occur before earlier hop;
- amount comparison uses decimals-normalized units;
- bridge boundary joins require explicit message/nonce/GUID/VAA or provider correlation for strong evidence;
- partial paths are allowed and labeled when exact target connection is unavailable;
- expansion through high-degree services, routers and CEX hot wallets is capped or stopped.

#### Rule/Fuzzy Scorer

Recommended scoring features:

```ts
type CrossChainScoreFeatureName =
  | 'amount_preservation_ratio'
  | 'time_delta_seconds'
  | 'strict_temporal_order'
  | 'exact_bridge_message_match'
  | 'bridge_source_only'
  | 'bridge_destination_only'
  | 'weak_amount_time_crosschain_match'
  | 'service_router_dampener'
  | 'cex_boundary_penalty'
  | 'transfer_from_evidence'
  | 'collector_like_receiver'
  | 'split_merge_behavior'
  | 'high_degree_hub_penalty';
```

Scoring policy:

- exact bridge protocol correlation can increase score and confidence;
- weak inferred amount/time matching must remain low-confidence;
- service/router/CEX boundary forces confidence downgrade or terminal path;
- `transferFrom` remains strong single-chain evidence, not cross-chain proof;
- split/merge behavior should be reported as a path feature, not as proof of intent.

### 5. Algorithm Recommendation

| Algorithm | Fit for Phase 10B | Recommendation |
|---|---|---|
| Bounded BFS/DFS | Good for low depth and current v0 style | Keep as simple baseline |
| Bidirectional BFS | Best fit when source and target are known | Use as Phase 10B core |
| Temporal path search | Required to reject impossible ordering | Add as validation/hard filter |
| k-shortest paths | Useful once weighted graph semantics stabilize | Later |
| A* | Needs a reliable admissible heuristic for money-flow likelihood | Not MVP |
| Flow/max-flow | Useful for split/merge laundering analysis | Later Phase 11+ |
| ML/GNN | Useful for research and prioritization only after labeled data exists | Not MVP basis |

Recommended Phase 10B algorithm:

1. Expand bounded forward frontier from source.
2. Expand bounded backward frontier from target.
3. Join on exact node identity and explicit bridge-correlation nodes.
4. Reject non-temporal paths.
5. Score only surviving candidates with explainable features.
6. Emit partial candidates when exact target route is not found.

### 6. API/Data Provider Plan

| API/provider | Gives | Needed fields | Risks | MVP usefulness | Fallback |
|---|---|---|---|---|---|
| TronScan | TRC20 transfers, status, method metadata | tx hash, from, to, amount, timestamp, token contract, method, confirmation/failure state | Pagination and availability | Required for current v0 | TronGrid/full node |
| Etherscan V2 | Multichain EVM explorer API through `chainid` | token transfers, logs, tx status, chain id, block timestamp | Rate limits and chain coverage | High for EVM collector | Alchemy/Blockscout |
| Alchemy Transfers | Indexed asset transfers | hash, block number, from, to, value, category, raw contract, metadata | Provider dependency and usage limits | High for EVM/L2 | Etherscan/Bitquery |
| Bitquery | Multichain GraphQL transfer/address data | chain, tx, address, token, amount, timestamp | Cost/query limits/vendor dependency | Medium; useful later | Direct chain collectors |
| LI.FI | Cross-chain route/status metadata | tool, sending tx, receiving tx, from/to chain, amount | Only LI.FI-routed flows | Useful bridge/aggregator evidence | Bridge-specific APIs |
| LayerZero Scan | LayerZero message metadata | GUID, source tx, destination tx, source/destination chain, status | LayerZero only | High for LayerZero routes | On-chain logs |
| WormholeScan | Wormhole operation and VAA metadata | source tx, target tx, VAA/emitter/sequence, source/destination chain | Wormhole only | High for Wormhole routes | On-chain VAA parsing |
| Tether protocols | Canonical USDT protocol/contract allowlist | chain/protocol, token contract, standard | Not a transfer source | Required token validation | Curated allowlist with citations |

### 7. False Positive Risks

Main risks to encode in reports and scoring:

- CEX/hot wallets: public-chain tracing usually stops after deposit because exchange ledgers are off-chain.
- Bridges: source and destination events are not strongly linked unless protocol metadata ties them together.
- Routers/aggregators: routes may include swaps, split fills, refunds and alternate bridge tools.
- Shared liquidity pools: near-equal amounts near in time can belong to unrelated users.
- Batch withdrawals: one outgoing batch can combine many users' internal balances.
- Off-chain matching: OTC, exchange settlement and custodial movements are not visible.
- Reused deposit addresses: helpful clue, not proof of the same human or entity.
- Wrapped/native asset confusion: token contract and token standard must be explicit per chain.
- High-degree hubs: centrality often means service infrastructure, not stronger attribution.

### 8. Proposed Phase Plan

Recommended sequence:

1. Phase 10A - harden TRON route search:
   - strict temporal path validation;
   - split/merge fixtures;
   - fresh/high-volume transit wallet feature if metadata supports it;
   - dedicated `bridge`, `router`, `cex`, `hot_wallet`, `service` categories;
   - no cross-chain collection yet.

2. Phase 10B - chain-aware model:
   - add chain/token/event metadata fields;
   - add evidence classes and edge types;
   - preserve current TRON behavior as default.

3. Phase 10C - EVM USDT collector:
   - start with official USDT on Ethereum/BSC/Polygon/Base/Arbitrum;
   - use Etherscan V2 or Alchemy as provider abstraction;
   - maintain provider payload in raw evidence.

4. Phase 10D - bridge evidence prototype:
   - LayerZero, Wormhole and LI.FI adapters;
   - bridge correlation table;
   - exact bridge evidence separate from inferred links.

5. Phase 10E - cross-chain scorer:
   - exact bridge correlation boost;
   - weak inferred link downgrade;
   - service/router/CEX boundary penalty.

6. Phase 10F - report and fixtures:
   - report chain per hop;
   - report evidence class per edge;
   - fixtures for exact bridge, source-only bridge, destination-only bridge, CEX boundary and weak inferred amount/time match.

### 9. Concrete Implementation Notes

TypeScript shape:

```ts
type EvidenceStrength = 'strong' | 'medium' | 'weak' | 'boundary';

interface CrossChainRouteEdge {
  chain: string;
  chainId: number | string;
  fromAddress: string;
  toAddress: string;
  txHash?: string;
  logIndex?: number;
  eventIndex?: number;
  tokenContract?: string;
  tokenStandard?: 'trc20' | 'erc20' | 'native' | 'unknown';
  amountRaw?: string;
  decimals?: number;
  edgeType: CrossChainRouteEdgeType;
  evidenceClass: EvidenceClass;
  evidenceStrength: EvidenceStrength;
  bridgeProtocol?: 'layerzero' | 'wormhole' | 'lifi' | 'unknown';
  bridgeMessageId?: string;
  bridgeNonce?: string;
  sourceTxHash?: string;
  destinationTxHash?: string;
}
```

Recommended report wording:

- "Observed confirmed on-chain USDT transfer."
- "Observed transfer classified as `transferFrom`; review approval/spender context."
- "Source and destination transactions are correlated by bridge protocol metadata."
- "Funds reached a service/CEX boundary; public-chain continuity should not be assumed past this point."
- "Weak inferred cross-chain candidate based on amount/time similarity only."

Recommended deterministic fixtures:

- TRON direct transfer.
- TRON `transferFrom` from source to collector.
- Invalid temporal path rejected.
- Bridge source + destination linked by message id.
- Bridge source only produces partial candidate.
- CEX deposit boundary terminates or downgrades route.
- Same amount on two chains without bridge protocol id stays weak inferred only.

### 10. Final Recommendation

Do next:

1. Finish Phase 10A TRON v0 hardening.
2. Only after that introduce Phase 10B chain-aware schema.
3. Keep cross-chain evidence classes explicit from day one.

The core product rule: TRON v0 should remain a reliable single-chain forensic route search. Cross-chain should be a conservative extension that reports evidence boundaries clearly instead of pretending to provide impossible certainty across bridges, routers and custodial services.
