---
status: current
last_verified: 2026-07-24
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

Identical provider requests share an identity and may coalesce across child
branches. The fair scheduler tracks per-key/group health and cooldowns so an
old or waiting heavy job cannot reserve the entire pool.

Traversal is finite without a coverage threshold. It terminates only at
snapshot-bounded history exhaustion or an evidence-backed service/CEX/DEX/
bridge/contract boundary. Canonical vertices/edges are deduplicated, dense
equivalent states are merged, and resumable chunks preserve progress.
Completion requires an empty frontier, conservation, and zero dropped or
unclassified states. Dense-state suppression is an optimization, not a
terminal boundary.

Coverage is multidimensional audit metadata. It cannot change matrix-v4 score
or turn unfinished work into `COMPLETED`.

This data plane is implemented and tested but is not the deployed index path.
Remaining work is protected schema/startup activation and post-deploy
observation on real provider traffic.
