# Admin Forensics Graph Audit - 2026-06-02

## Current visual status

- The admin graph UI is visually alive again: layer layout only, no radial mode, graph stats are visible, arrows are shown on all graph edges, and the lower transfer table shows graph edges instead of filtering only `type=transfer`.
- Edge labels now show allocated/original amount when those differ, for example `135.21K USDT / 1.89M USDT`.
- Edge side panel now shows `Allocated amount`, `Original tx amount`, `Coverage amount`, raw timestamp, tx hash, and `metadata.pathId`.
- The side panel now shows `Projection mode` and `Projection gaps`, so `address_deep_check` explicitly reports raw transfer edges found versus profile edges rendered.
- Funding bundles are now graph-visible as `bundle` nodes with top 3 funders plus small-tail metadata when saved report data contains `fundingBundles`.

## Job type map

### where_is_money_check

Source data:

- `whereIsMoneyReport.originPaths`
- path `steps`, `pathAddresses`, `txHashes`
- path `fundingBundles`
- `coverage.selectedAmountRaw`, `coverage.targetAmountRaw`, path `balanceShare`

Graph projection:

- nodes come from `pathAddresses` or from step `fromAddress` / `toAddress`.
- edges come from path `steps`; fallback edges are built from the address chain.
- paths map 1:1 to `originPaths`.
- stop nodes are appended from `stoppedReason`.

Known reasons for small graphs:

- the report has only one selected origin path;
- the path stops early at `stoppedReason`;
- fallback path has only two addresses;
- legacy stored reports may have `no_previous_transfer` without `historyCoverage`.

Found but previously not visible:

- raw path amount existed even when `edge.amountFormatted` was absent;
- edge timestamp existed as raw `timestamp`, but UI only looked at `timestampFormatted`;
- `pathId` existed in `edge.metadata.pathId`, but UI only looked at top-level `edge.pathId`;
- original-vs-used amount metadata existed in some bundle cases, but UI showed only one amount.

Current remaining gaps:

- legacy reports without `historyCoverage` cannot prove whether previous transfers were really absent;
- old reports without `fundingBundles` cannot show bundle grouping until rerun.

### address_deep_check

Source data:

- `counterpartyRiskProfiles`
- `directCounterpartyInteractionProfiles`
- `inboundProvenanceProfiles`
- `extendedProvenanceProfiles`
- `serviceExposureProfiles`

Graph projection:

- nodes come from profile counterparties and service addresses;
- edges are mostly `type=inferred_provenance`;
- paths are profile-level paths, not exact transfer routes.
- saved `extendedProvenanceProfiles` paths are projected as consecutive address edges, including non-subject wallet-to-wallet edges when the persisted path contains them.
- the coverage summary reports rendered direct edges, rendered extended edges, max saved path depth, saved stop reasons, and explicit second-layer queued/complete counters.

Known reasons for small graphs:

- this job is not a full "where did the money come from" traversal;
- if profiles are sparse, the graph can be only subject + 1-2 counterparties;
- many edges do not have exact `txHash` when the profile aggregates multiple tx hashes.

Found but not fully visible:

- profile volume exists as `volumeRaw` / path `amountRaw`; UI now falls back to path amount;
- exact tx/time may be unavailable because profile edges are inferred/aggregated.
- raw transfer history collected by deep check is shown as a count/page diagnostic, not expanded as transfer-level route edges.
- second-layer indexing counters can show a non-zero budget while queued/complete remain zero; Admin reports those counters as indexing state, not as proof of second-layer coverage.

Current remaining gaps:

- if we need transfer-level chains beyond saved DeepCheck paths, projection must use deeper evidence objects, not just profile summaries.
- second-layer direct-wallet indexing remains a backend gap when `secondLayerQueued` and `secondLayerComplete` are zero.

### incoming_deposit_check

Source data:

- `progress.sender`, `progress.watchedWallet`, `progress.amountRaw`
- `result.originPaths`
- origin path `steps`
- origin path `fundingBundles`

Graph projection:

- if `originPaths` exists, nodes/edges come from origin path steps;
- if `originPaths` is absent, graph falls back to one deposit edge: sender -> receiver;
- stop nodes come from incoming origin path `stoppedReason`.

Known reasons for small graphs:

- no `originPaths` means graph is only the deposit edge;
- a single short origin path can produce only 2-4 nodes;
- stop reasons can stop upstream traversal early.

Found but not fully visible:

- incoming path type does not currently preserve `historyCoverage`.

Current remaining gaps:

- old persisted incoming reports without `fundingBundles` cannot show bundle grouping until rerun;
- preserve and render rejected candidate diagnostics for no/weak previous-transfer decisions.

## Stop reason audit

Current trace code already distinguishes:

- `incoming_history_not_fetched`
- `no_incoming_transfers_seen`
- `incoming_seen_but_below_continuity`
- legacy `no_previous_transfer`
- legacy `weak_amount_or_time_continuity`

`incoming_seen_but_below_continuity` is projected to the admin limitation code `previous_transfers_found_but_not_matching`, so new reports do not need to reuse `no_previous_transfer` when prior inputs existed but failed amount/time continuity.

Graph projection now adds stop diagnostics when `historyCoverage` exists:

- fetched transfer count;
- fetched page/query-batch count when provider-backed coverage is available;
- whether any incoming transfer was seen;
- whether history reached the target hop timestamp;
- oldest fetched transfer timestamp;
- approximate days checked;
- history source;
- top 5 rejected candidates with rejection reasons.

Remaining gap:

- older persisted reports still need rerun before page counts and rejected-candidate diagnostics exist.

## Current break point for "stops on one address"

The chain stops in `traceMoneyOriginPath` when:

1. current address is classified as terminal service/risky/clean source;
2. max depth/address budget is reached;
3. fetched history does not reach the target hop timestamp;
4. no incoming candidate meets amount/time continuity;
5. a bundle fails the coverage threshold or has no usable funders.

The high-risk confusing case is item 4. With a history coverage provider it should become `incoming_seen_but_below_continuity` or `no_incoming_transfers_seen`; without provider, old reports can still say `no_previous_transfer`.
