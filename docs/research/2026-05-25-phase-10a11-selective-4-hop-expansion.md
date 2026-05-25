# Phase 10A.11 Idea: Automatic Selective 4-Hop Deep Forensic Expansion

Date: 2026-05-25

Status: idea / design note, not implementation plan.

## Summary

Phase 10A.11 should extend deep `/check <address>` from the current bounded 2-hop forensic context to an automatic selective 4-hop expansion for high-value or already high-risk addresses.

The key decision: do not increase global `maxDepth` to 4 for every check. A broad BFS over every transaction in 30 days is too expensive, creates 429 risk, and increases false positives around CEX, routers, bridges and high-volume wallets.

Instead, use a budgeted beam-style provenance search:

- keep fast `/check` and standard deep 2-hop as the first layers;
- run extended 4-hop only when the address crosses value/risk triggers;
- expand only the highest-value and highest-signal counterparties;
- keep exact evidence, service boundaries and weak inferred links separate.

## Current Behavior

Current deep `/check` is not a full 4-hop crawl.

It currently does:

- source transfer page collection for the checked address;
- service exposure through route graph collection, typically `maxDepth = 2`;
- top inbound sender expansion, currently capped by `maxInboundSenders`;
- approval-drain root lookup around selected upstream candidates;
- inbound provenance up to 2 hops;
- direct counterparty propagation for known labels / derived markers;
- service boundary stop at bridge, bridge_pool, dex, router, cex, hot_wallet, swap_adapter and unknown_contract.

This was enough to catch the `TXu3s` case:

`victim -> TPhaah -> TXu3s -> Allbridge LP`

But it does not yet answer the broader question:

> How much inbound/outbound exposure exists through HTX, Bybit, bridge, router or known high-risk exchanger infrastructure within 3-4 hops?

## Why Not Full 4-Hop BFS

If each address has up to 50 relevant transfers on the first page, naive expansion explodes quickly:

- depth 1: 50 nodes;
- depth 2: 2,500 nodes;
- depth 3: 125,000 nodes;
- depth 4: 6,250,000 nodes.

Even with dedupe and page caps, active wallets, CEX hot wallets, bridge pools and routers will create heavy provider load and noisy paths. This would make `/check` slow and unreliable, especially under TronScan rate limits.

## Automatic Extended Trigger

Run 4-hop extended analysis automatically only after standard deep check if at least one trigger is present:

- final or interim risk score is `>= 60/100`;
- total incoming or outgoing official TRON USDT volume in the window is `>= 100,000 USDT`;
- service exposure ratio is `>= 40%`;
- approval-drain provenance is found;
- internal label is present: `darknet_exchange`, `darknet_exchange_proximity`, `approval_drain_proximity`, scam/stolen/phishing;
- top counterparty concentration is `>= 50%` and amount is `>= 10,000 USDT`;
- direct or 2-hop exposure to CEX / HTX / Bybit / bridge / router / DEX exists with meaningful amount.

Low-value clean addresses should not trigger extended 4-hop automatically.

## Search Strategy

Use prioritized beam search, not BFS.

Depth model:

- depth 0: checked subject;
- depth 1: top inbound and outbound counterparties;
- depth 2: top candidates from depth 1;
- depth 3: only candidates with strong amount/time/service/label signal;
- depth 4: only exact or high-confidence candidates.

Candidate priority features:

- large absolute USDT amount;
- high share of subject or intermediate volume;
- amount preservation `>= 70%`, strong at `>= 95%`;
- fast temporal transit: `<= 1h`, `<= 6h`, `<= 24h`;
- `transferFrom` edge;
- internal label or derived marker;
- service category: `cex`, `hot_wallet`, `bridge`, `bridge_pool`, `router`, `dex`;
- exchange identity: `HTX`, `Huobi`, `Bybit`, `Binance`, `OKX`, `KuCoin`;
- repeated chunks to the same counterparty;
- collector-like / fresh high-volume transit behavior.

Suggested bot budget:

- max transfer-page requests for extended stage: `50-60`;
- max metadata lookups: `20`;
- max contract profiles: `5`;
- one transfer page per intermediate;
- stop immediately at known service/CEX/bridge/router boundary;
- return partial result with coverage notes if budget is exhausted.

Suggested CLI/admin budget:

- max transfer-page requests: `100-150`;
- allow two pages for important frontier addresses;
- keep max depth at `4`.

## New Profiles

### ExtendedProvenanceProfile

Purpose: show exact or strong 3-4 hop paths to upstream/downstream high-risk labels, approval-drain roots or derived markers.

Fields:

- `subjectAddress`;
- `direction`: `inbound | outbound`;
- `maxDepth`;
- `paths`;
- `matchedVolumeRaw`;
- `matchedVolumeRatio`;
- `score`;
- `features`;
- `coverage`;
- `stoppedBoundaries`;

Path fields:

- `depth`;
- `sourceAddress`;
- `targetAddress`;
- `viaAddresses`;
- `label`;
- `edgeTypes`;
- `amountRaw`;
- `amountPreservationRatio`;
- `firstTransferAt`;
- `lastTransferAt`;
- `txHashes`;
- `evidenceStrength`: `exact_onchain_path | route_linked | weak_boundary_context`;

### BoundaryExposureProfile

Purpose: answer how much of the address activity touches service infrastructure, especially HTX / Bybit / CEX / bridge / router / DEX, directly or through 2 hops.

Fields:

- `subjectAddress`;
- `incomingBoundaryVolumeRaw`;
- `outgoingBoundaryVolumeRaw`;
- `incomingBoundaryVolumeRatio`;
- `outgoingBoundaryVolumeRatio`;
- `directBoundaryTxCount`;
- `twoHopBoundaryTxCount`;
- `topBoundaryEntities`;
- `categoryBreakdown`;
- `features`;

Categories:

- `cex`;
- `hot_wallet`;
- `deposit_wallet`;
- `withdrawal_wallet`;
- `bridge`;
- `bridge_pool`;
- `dex`;
- `router`;
- `swap_adapter`;
- `unknown_contract`.

Important identities:

- `HTX`;
- `Huobi`;
- `Bybit`;
- `Binance`;
- `OKX`;
- `KuCoin`;
- `Allbridge`;
- `SunSwap`.

### ExtendedRouteCandidate

Purpose: show candidate paths for manual review without overclaiming proof.

This should include weak inferred candidates after CEX boundaries, but those candidates must not be mixed with exact same-chain evidence.

## Evidence Rules

Always separate:

- exact same-chain token transfer evidence;
- exact `transferFrom` / approval-drain evidence;
- exact internal label / manual seed evidence;
- service/router/CEX/bridge boundary context;
- weak inferred continuation after boundary.

Rules:

- Same-chain paths before a boundary can be scored as exact route/provenance evidence.
- CEX / HTX / Bybit / bridge / router / DEX boundaries stop public-chain proof.
- If funds enter HTX and later a similar amount leaves Bybit, that is not exact continuity.
- Such cases can be stored as `weak_exchange_mediated_pattern` with cautious wording only.
- 3-4 hop risk should be raised only when there is strong evidence: label / derived marker / approval-drain root / manually verified seed plus temporal and amount preservation.

Forbidden wording:

- `fraud proven`;
- `this wallet is the exchange`, unless the subject itself has that exact manual label;
- any wording implying legal attribution.

Required wording:

- `Extended provenance candidate; manual review required.`
- `Funds reached CEX/service/bridge boundary; public-chain continuity should not be assumed.`
- `Weak exchange-mediated pattern; not exact same-chain proof.`

## Scoring Direction

Keep the main Telegram risk score normalized to `/100`.

Suggested impacts:

- exact 1-hop internal critical label: high / critical, existing behavior;
- exact 2-hop internal critical label: high, existing behavior;
- exact 3-hop critical label with strong preservation: `+35..45`;
- exact 4-hop critical label with strong preservation: `+25..35`;
- approval-drain provenance through 3-4 hops: high if amount/time preservation is strong, but lower than 1-2 hop;
- CEX/HTX/Bybit boundary alone: context only, no high-risk score by itself;
- weak exchange-mediated pattern after boundary: low/medium context only, no exact-risk label persistence.

Derived markers:

- do not automatically persist derived labels from weak boundary patterns;
- persist derived marker only from exact on-chain path or exact approval-drain / seed provenance;
- keep evidence JSON with path, tx hashes, timestamps, amount preservation and policy version.

## Report UX

Fast report remains preliminary.

Standard deep report remains the first follow-up.

If extended 4-hop runs, report should include:

- `Extended 4-hop analysis: completed | limited coverage`;
- main `Risk: X/100`;
- `What changed`;
- `Most important evidence`;
- `Boundary exposure`;
- `Extended candidates for manual review`;
- `Coverage and limits`.

Example lines:

- `Extended provenance candidate found within 4 hops; manual review required.`
- `42% of inbound USDT volume has direct or two-hop exposure to CEX/bridge/router infrastructure.`
- `HTX boundary reached; public-chain continuity after this point should not be assumed.`
- `Similar amount/time withdrawal candidate after CEX boundary is weak inferred context, not exact proof.`

## Implementation Notes For Later

Likely files:

- `src/forensics/extendedProvenance.ts`;
- `src/forensics/boundaryExposure.ts`;
- `src/check/deepForensicCheck.ts`;
- `src/forensics/deepForensicJob.ts`;
- `src/bot/createBot.ts`;
- `src/types.ts`;
- tests under `tests/forensics`, `tests/check`, `tests/bot`.

Suggested new feature codes:

- `extended_provenance_exact_3_hop`;
- `extended_provenance_exact_4_hop`;
- `extended_provenance_amount_preserved`;
- `extended_provenance_fast_transit`;
- `extended_provenance_boundary_stop`;
- `boundary_exposure_htx`;
- `boundary_exposure_bybit`;
- `boundary_exposure_cex`;
- `boundary_exposure_bridge`;
- `boundary_exposure_router`;
- `weak_exchange_mediated_pattern`.

Tests should cover:

- automatic trigger for high-risk/high-value address;
- no extended run for clean low-value address;
- top-k candidate selection by volume and preservation;
- exact 3-hop label provenance;
- exact 4-hop label provenance;
- stop at CEX/HTX/Bybit boundary;
- weak CEX-mediated pattern does not persist derived high-risk marker;
- request budget exhaustion creates partial coverage note;
- Telegram report never prints non-`/100` denominators;
- no forbidden wording.

## Open Questions

- Should HTX/Bybit aliases be stored as built-in service identity rules, external provider labels, or manual assertions?
- What should be the exact high-value threshold: `50,000`, `100,000`, or `250,000 USDT`?
- Should extended 4-hop run immediately after standard deep, or as a second follow-up message to keep the first deep report fast?
- Should CLI/admin mode expose a wider request budget than bot mode?
