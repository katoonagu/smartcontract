---
status: current
last_verified: 2026-07-25
owner_area: tronscan
code_refs:
  - src/tron/tronClient.ts
  - src/tron/tronscanScheduler.ts
  - src/tron/usdtBlacklistTimeline.ts
  - src/forensics/tronAddressAllTimeIndex.ts
  - src/forensics/localTronUsdtIndex.ts
  - src/forensics/targetedHistoryCoordinator.ts
  - src/unifiedCheck/directHistory.ts
  - src/unifiedCheck/productionDirectHistory.ts
  - src/unifiedCheck/fairScheduler.ts
  - src/unifiedCheck/traversal.ts
  - src/unifiedCheck/productionTraversal.ts
  - src/unifiedCheck/addressHistory.ts
  - src/unifiedCheck/productionAddressHistory.ts
  - src/unifiedCheck/frozenLabels.ts
  - src/unifiedCheck/labelCatalog.ts
  - src/unifiedCheck/boundaryPredicates.ts
---

# TronScan Data And Indexing

## Production Truth

Production uses the legacy TronScan/local-index pipeline. Provider pages,
targeted indexing, cached labels, blacklist timelines, approvals, and local
materialization are evidence sources; none is complete merely because an API
returned one page. Provider caps, missing pages, and local coverage remain
explicit.

Current production workers retain their existing queue and pagination
semantics until cutover. More API keys improve throughput but do not prove
history completeness.

## Implemented Release Candidate

Every Unified run pins one confirmed snapshot block number, hash, and
timestamp. Direct USDT history pages until authoritative provider exhaustion or
account creation. Overlaps are canonically deduplicated, post-snapshot events
are excluded, and persisted cursors make restart deterministic.

TronScan reports `rangeTotal=10000` as a capped sentinel rather than an exact
count. An underfilled pinned page therefore closes that capped window at any
offset; it is not treated as inconsistent merely because its next offset is
below the sentinel.

If TronScan omits an event index, pagination identity combines the transaction
hash with canonical event content. Distinct USDT events in one transaction
remain separate, while an identical repeated row is still detected as overlap.

Identical provider requests share an identity and may coalesce across child
branches. The fair scheduler tracks per-key/group health and cooldowns so an
old or waiting heavy job cannot reserve the entire pool.

A snapshot/address/USDT history is materialized once as content-addressed
chunks and reused by all funding episodes. Episode attribution stays separate;
history reuse does not merge origins or change proportional attribution.
Provider checkpoints retain bounded counters and chain heads rather than
repeated full collections.

Address-history page, chunk, and exhaustion artifacts remain immutable as they
are produced. The final bounded address-history manifest is returned by the
worker and becomes authoritative only when acceptance atomically inserts it
with the accepted attempt and task completion. For an ordered task the same
transaction also performs the planner `planned -> ready` transition. Its hash
and `result_bytes` come from the same canonical UTF-8 serialization, so the
manifest is not pre-persisted or counted twice.

Traversal now enumerates the complete distinct mandatory address-history set
from the current canonical frontier, persists one capacity-independent planner
batch, and uses head-only barrier admission. Accepted manifests may finish in
any order, but traversal applies only a bounded continuous ready prefix in
canonical sequence. The V2 checkpoint/delta head and exact planner prefix
commit atomically; a gap is never skipped. A manifest is applicable only when
its task kind, planner logical key, stored key, and key recomputed from
chain/snapshot/token/address/provider-request identity all match. Swapped or
key-tampered manifests fail before a traversal delta. If the expectation,
stored task, artifact metadata, or artifact body marks address-history data,
the checkpoint requires the complete address-history tuple; a contradictory
non-address task kind cannot downgrade that validation. Previously committed
address manifests are loaded by exact task identity and remain reusable by
later funding states.

Traversal is finite without a coverage threshold. It terminates only at
snapshot-bounded history exhaustion or an evidence-backed service/CEX/DEX/
bridge/contract boundary. Canonical vertices/edges are deduplicated, dense
equivalent states are merged, and resumable chunks preserve progress.
Completion requires an empty frontier, conservation, and zero dropped or
unclassified states. Dense-state suppression is an optimization, not a
terminal boundary.

Coverage is multidimensional audit metadata. It cannot change matrix-v4 score
or turn unfinished work into `COMPLETED`.

The candidate also freezes a versioned supported-label catalog and provenance
dataset per snapshot. The supported CEX catalog is Binance, Bybit, OKX,
WhiteBIT, Coinbase, Kraken, KuCoin, Bitget, MEXC, Bitstamp, Crypto.com, and
HTX/Huobi. Other supported entries are SunSwap/SUN, Allbridge, Bridgers, USDD
PSM/GemJoin, GasFree, and the TronLink GasFree provider. A label alone is not
an economic boundary: terminal predicates require valid-at-event identity and
the corresponding route/economic proof. Hint labels and later-discovered
restrictions remain context only.

This data plane is implemented and tested but is not the deployed index path.
The new predicates are deliberately not wired into production closure or
exact scores until P1 blind review/adjudication. Frozen real-address
performance replay is also pending because the earlier live runtime did not
persist canonical provider response pages.

The protected candidate path now verifies the exact schema-034 planner
migration and its schema-033 predecessor before canary selection. This release
identity change does not alter provider coverage, traversal closure, labels, or
scoring policy; adaptive rolling admission remains pending.
