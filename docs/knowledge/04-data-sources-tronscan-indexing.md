---
status: current
last_verified: 2026-07-26
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

## Unified Data Contract

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

Provider capacity snapshots expose only opaque independent group IDs, health
(`healthy`, `cooldown`, or `circuit_open`), group concurrency, in-flight work,
and cooldown expiry. Multiple keys in one provider account share one group
limit. A 429 cools only that group when independent groups are configured;
repeated configured provider failures open its circuit, and a successful
half-open probe restores it. Request pacing, endpoint/account limits, cooldown,
and RPS remain inside the TronScan scheduler and are separate from the
controller's concurrent-chunk target.

An ordered task is not bound to a provider group in advance. It is eligible
when at least one healthy capable group can execute it under the ordinary
claim, cooldown, and pacing rules. Canonical-head priority changes scheduling
order only; it neither selects a permanent group nor creates a duplicate
claim.

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

The runtime freezes a versioned supported-label catalog and provenance dataset
per snapshot. The supported CEX catalog is Binance, Bybit, OKX,
WhiteBIT, Coinbase, Kraken, KuCoin, Bitget, MEXC, Bitstamp, Crypto.com, and
HTX/Huobi. Other supported entries are SunSwap/SUN, Allbridge, Bridgers, USDD
PSM/GemJoin, GasFree, and the TronLink GasFree provider. A label alone is not
an economic boundary: terminal predicates require valid-at-event identity and
the corresponding route/economic proof. Hint labels and later-discovered
restrictions remain context only.

For `snapshot-closure-v2`, production closure is CEX-only: it uses only exact
frozen records whose catalog policy is `custodial_boundary` and whose validity interval
contains the traversal state's event time. The coordinator commits this
boundary evidence and its delta before address-history planning, including for
states generated by an accepted history. Frozen datasets are capped at 10,000
combined label/legacy rows and 8 MiB canonical UTF-8. Production validates a
dataset once per content hash and keeps at most 16 validated datasets in its
process cache; every cache hit still verifies the requested snapshot/catalog/
predicate binding. Hints, legacy risk rows, unknowns, bridges, DEXes, generic
contracts, restriction/sanctions context without an enabled predicate, and
labels valid only later cannot terminate traversal. A legacy provider risk row
is non-terminal even when its text names an exchange. Route- and
economic-structure predicates for bridges, DEXes, contracts, restrictions, and
other services remain deferred until their separate evidence and adjudication
gates pass. Exact
scoring remains gated by P1 blind review/adjudication; frozen real-address
performance replay is still pending because the earlier live runtime did not
persist canonical provider pages.

The frozen policy oracle has separate V1 and V2 provider fixtures over the
same response pages, clock, and source snapshot. The V2 fixture binds the real
production-built frozen label dataset hash. PostgreSQL seeds that exact dataset
artifact, loads it through the production runtime, and evaluates it through the
production traversal coordinator and V2 boundary before comparing barrier and
rolling outputs. The V2 proof closes the frozen CEX state and performs one
fewer address-history page than V1, so merely seeding the dataset cannot satisfy
the test. The fixture alone or the scheduler simulation is not proof of
production traversal/hash equivalence.

The runtime verifies exact schema 036 and its schema-032 through schema-035
predecessors before canary selection. The adaptive runtime has no fixed
four-slot ceiling: it can expand to the configured
provider-worker ceiling while bounded chunks, durable buffer reservations,
DB/memory guards, group health, and eligible demand constrain actual use.
Frozen replay through logical capacity 100 is algorithmic correctness evidence,
not measured live RPS. Raise live capacity only after the corresponding
independent-group audit, live benchmark, and memory check.
