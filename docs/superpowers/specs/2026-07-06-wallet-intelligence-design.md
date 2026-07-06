# Wallet Intelligence Design

Date: 2026-07-06

## Problem

Large exchange, OTC, and high-volume users need an internal way to notice that
addresses recur across independent forensic checks. A wallet that appears
several hops away in many `DeepCheck`, `Where is money`, or `Incoming deposit`
runs can be useful analyst context even when it is not direct risk evidence.

The current Admin forensic console is job-focused. It explains the evidence for
one check. It does not provide a global view of addresses and transfer edges
seen across many saved checks.

Repeated appearance by itself is not proof of dirty funds. The same address can
be a CEX hot wallet, router, bridge, OTC hub, liquidity wallet, ordinary whale,
or a genuinely interesting corridor. V1 must therefore surface recurrence as
Admin-only investigative intelligence, not as scoring evidence.

## Decision

Build V1 as a separate Admin-only `Wallet Intelligence` workspace backed by a
persistent normalized index of saved forensic job results.

The workspace stores cross-run address sightings and relationship edges from
already-collected data. It ranks addresses primarily by unique checked subjects
and unique requesters, then by job count and recency. It shows neutral triage
tags and source-job links so analysts can inspect why an address is interesting.

Wallet Intelligence must not affect risk scoring, Telegram output, user-facing
warnings, labels, or risk observations.

## Scope

In scope:

- completed or partial `address_deep_check`, `where_is_money_check`, and
  `incoming_deposit_check` jobs;
- a backfill script for existing saved jobs;
- automatic indexing after new supported jobs complete;
- normalized sightings and edges from saved `result_json` and existing local
  indexed data;
- Admin API and UI at `/admin/wallet-intelligence`;
- requester context from existing `forensic_check_jobs` and `telegram_users`
  fields;
- neutral analyst tags and filters.

Out of scope:

- `address_fast_check` extraction;
- waiting, running, failed, or cancelled jobs;
- new TronScan requests or targeted indexing triggered by this feature;
- any scoring change;
- Telegram or support-report copy;
- per-job "seen elsewhere" hints;
- global graph visualization;
- automatic label or manual assertion creation.

## Data Model

### `wallet_intelligence_runs`

One row per indexed forensic job.

Fields:

- `job_id`;
- `job_kind`;
- `job_status`;
- `subject_address`;
- `requested_by`;
- `chat_id`;
- `message_id`;
- `completed_at`;
- `telegram_user_id`;
- `telegram_username`;
- `telegram_locale`;
- `source_payload_hash`;
- `index_version`;
- `index_status`;
- `index_error`;
- `indexed_at`.

This table makes backfill and reindexing idempotent.

### `wallet_intelligence_sightings`

One row per address occurrence inside one job/path/context.

Fields:

- `address`;
- `job_id`;
- `job_kind`;
- `subject_address`;
- `requested_by`;
- `source_kind`;
- `role`;
- `depth`;
- `path_id`;
- `tx_hash`;
- `amount_raw`;
- `first_seen_at`;
- `last_seen_at`;
- `metadata_json`.

Expected `source_kind` values:

- `deep_direct_counterparty`;
- `deep_second_layer`;
- `where_origin_path`;
- `where_source_provenance`;
- `incoming_origin_path`;
- `incoming_funding_bundle`.

Expected `role` values:

- `subject`;
- `direct_counterparty`;
- `second_hop`;
- `source`;
- `funder`;
- `service_boundary`;
- `contract`;
- `unknown`.

### `wallet_intelligence_edges`

Normalized relationship edges from saved job results.

Fields:

- `from_address`;
- `to_address`;
- `job_id`;
- `job_kind`;
- `source_kind`;
- `depth`;
- `path_id`;
- `tx_hash`;
- `amount_raw`;
- `timestamp`;
- `edge_role`;
- `metadata_json`.

DeepCheck grouped second-layer members are stored as grouped sightings, not fake
transfer edges.

### `wallet_intelligence_address_summary`

Refreshable address-level aggregate used by Admin.

Fields:

- `address`;
- counts by jobs, modes, subjects, requesters, and statuses;
- `min_depth`;
- `max_depth`;
- `occurrence_count` from sightings;
- `distinct_tx_count` from unique transaction hashes;
- `distinct_amount_raw` summed over unique transaction hashes, not repeated
  appearances;
- first and last seen timestamps;
- service/category/label hints from existing labels and cache tables;
- neutral tags.

The schema should avoid `risk`, `dirty`, `suspicious`, and `score` field names.

## Extraction

The extractor is a pure local parser. It does not call TronScan and does not
queue history indexing.

DeepCheck extraction reads:

- `directCounterpartyInteractionProfiles`;
- `secondLayerRelationshipProfiles.paths`;
- `secondLayerRelationshipProfiles.groups`;
- `operationalFlowProfiles` for summary/tag enrichment only;
- `walletRoleProfiles` for summary/tag enrichment only.

`operationalFlowProfiles` and `walletRoleProfiles` do not create standalone
sightings in V1. They can enrich metadata, role hints, and neutral tags for
addresses already found through direct counterparties, second-layer paths, or
other extracted evidence.

Where extraction reads:

- `originPaths.steps`;
- `originPaths.pathAddresses`;
- `originPaths.sourceProvenance`;
- funding bundle members from source provenance when present.

Incoming extraction reads:

- `originPaths.steps`;
- `originPaths.pathAddresses`;
- `originPaths.fundingBundles`;
- deposit sender/receiver context from saved progress/result fields.

Probable, unresolved, and service-boundary provenance are preserved as metadata.
They are context, not evidence that raises score.

## Backfill And New Jobs

Add a script similar to:

```text
scripts/backfillWalletIntelligence.ts
```

The script selects jobs where:

```text
kind in ('address_deep_check', 'where_is_money_check', 'incoming_deposit_check')
status in ('completed', 'partial')
result_json <> '{}'
```

For each job:

1. Compute a stable `source_payload_hash` from `result_json`, relevant
   `progress_json` fields used by extraction, and `index_version`.
2. Skip if the same `job_id`, `index_version`, and payload hash is already
   indexed.
3. Delete old sightings and edges for that job if reindexing is needed.
4. Insert the run, sightings, and edges.
5. Refresh summaries for touched addresses.

After a supported job completes, call the same indexing function. If indexing
fails, the forensic job remains completed. The intelligence run records
`index_failed` and the error for Admin/debug review.

## Admin API

Add:

```text
GET /admin/api/wallet-intelligence/addresses
GET /admin/api/wallet-intelligence/addresses/:address
```

The list endpoint returns paginated summary rows.

Filters:

- mode;
- tag;
- minimum unique subjects;
- minimum unique requesters;
- date range;
- address search;
- depth range;
- distinct amount range;
- service category;
- requester id or username;
- subject address;
- job status.

Default sort:

1. unique subjects descending;
2. unique requesters descending;
3. completed or partial job count descending;
4. last seen descending.

The detail endpoint returns:

- summary metrics;
- neutral tags;
- requester list with `telegram_user_id`, `username`, `locale`, `chat_id`, and
  `message_id` when available;
- subject addresses;
- source jobs grouped by mode/status;
- sightings;
- edges;
- known labels and service hints;
- links back to source forensic jobs or graph/raw endpoints.

## Admin UI

Add a new Admin nav item:

```text
Wallet Intelligence
```

The main workspace is a table plus a detail drawer.

Table columns:

- address;
- tags;
- modes seen;
- unique subjects;
- unique requesters;
- completed/partial jobs;
- max depth;
- occurrence count;
- distinct tx count;
- distinct amount;
- service/category hint;
- first seen;
- last seen.

Drawer sections:

- compact metrics;
- requester/account context;
- source jobs;
- sightings;
- edges;
- source evidence links.

Known services, exchanges, routers, bridges, and DEX addresses remain visible by
default, but are tagged and filterable.

V1 does not include a global graph. If analysts later need visualization, add a
focused graph for one selected address or cluster.

## Neutral Tags

V1 tags:

- `repeated_cross_run_address`;
- `high_activity_wallet`;
- `large_liquidity_wallet`;
- `possible_service_or_exchange_like`;
- `known_service_or_exchange`;
- `cross_mode_seen`.

These are analyst triage tags. They are not risk evidence.

## Guardrails

Wallet Intelligence must not:

- change `unifiedWalletRisk`;
- change `moneyOriginOperationalAssessment`;
- change Telegram formatting;
- write `risk_signal_observations`;
- create labels or address assertions automatically;
- raise risk score;
- produce user-facing warnings.

Any future scoring impact must come only from explicit evidence such as labels,
hard provenance, sanctions/service policy, or manual analyst assertions.

## Testing

Required checks:

- extractor tests for representative DeepCheck, Where, and Incoming fixtures;
- repository tests for idempotent indexing and dedupe;
- summary ranking tests that prioritize unique subjects and requesters over raw
  run count;
- tag tests that keep tag names neutral;
- Admin API tests for filters and detail payloads;
- no-scoring regression test proving Wallet Intelligence indexing does not write
  risk observations and does not change a sample unified risk result.

## Documentation

Implementation should update:

- `docs/knowledge/08-admin-and-bot-ux.md`;
- `docs/knowledge/09-current-decisions.md`.

If per-job hints, graph visualization, or calibration are deferred as explicit
product gaps, update `docs/knowledge/10-open-problems.md`.

## Approved Design Summary

V1 creates a separate Admin-only global workspace for cross-run wallet
intelligence. It persists normalized sightings and edges from already saved
DeepCheck, Where, and Incoming jobs. It supports backfill and future job
indexing, exposes table/drawer analytics, includes full available requester
context, and uses neutral tags only. It never changes scoring or user-facing
results.
