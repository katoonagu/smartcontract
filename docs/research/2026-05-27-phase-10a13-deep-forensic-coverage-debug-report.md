# Phase 10A.13: Deep Forensic Coverage Debug Report

Date: 2026-05-27

Status: design/spec.

## Summary

Phase 10A.13 adds a developer/admin debug layer for deep forensic checks. The goal is to explain what a deep run actually saw, what it evaluated, what it skipped, and why the final risk score stayed low or increased.

This phase does not change legal/forensic evidence boundaries:

- exact taint remains blacklist, manual labels, exact approval-drain, or exact labeled provenance;
- service, bridge, router, CEX, and behavior-heavy counterparties remain context unless backed by exact labels;
- no derived marker is created for a wallet only because it interacted with a behavior-risk counterparty.

## Problem

Deep reports currently show aggregate coverage such as transfer edge count and inbound sender count. That is not enough for debugging cases where an expected counterparty is absent or did not affect the score.

Example: `TNNkKmEj5ax48ZuJfWpRpkxzzwXWTNH45J` reported behavior-only risk even though the investigator expected a relationship with `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe`. The stored job showed:

- `TLhVzk...` was not present in `result_json`;
- only 29 transfer edges were scanned;
- 30d activity was sparse and only historical fallback data was used;
- metadata enrichment was capped.

The system did not prove the relationship safe; it did not have that relationship in the collected graph.

## Design

Add a structured `coverageDebug` object to future deep job `result_json`.

The debug report includes:

- job metadata: job id, subject, status, window;
- high-level coverage: transfer edges, source pages, inbound senders expanded, extended local-index coverage;
- sparse fallback summary: 30d transfer count and latest historical transfer count;
- all direct subject counterparties seen in the collected edge set;
- per-counterparty coverage table fields:
  - direction;
  - counterparty;
  - volume;
  - share;
  - tx count;
  - first/last seen;
  - seen/analyzed/expanded/metadata enriched;
  - label;
  - cached risk;
  - service category and identity;
  - score contribution;
  - evidence class;
  - skipped reason.

Skipped reasons are deterministic:

- `not_loaded`;
- `outside_window`;
- `metadata_cap`;
- `not_top_candidate`;
- `service_boundary_stop`;
- `provider_partial`;
- `no_label`;
- `behavior_only_context`.

## Sparse Wallet Coverage Fix

For deep checks, sparse wallet fallback should trigger when the 30d window has fewer than 60 official TRON USDT transfers.

Behavior:

- collect the normal 30d window first;
- if fewer than 60 official USDT transfers are found, fetch the latest 60 historical transfers without the 30d window;
- dedupe by transaction hash/from/to/amount;
- lightweight-evaluate all direct subject counterparties in the resulting edge set;
- keep heavy expansion bounded to top inbound senders and existing deep budgets.

This improves coverage without turning the run into full BFS.

## CLI

Add a read-only debug CLI:

```bash
npm run forensic:debug -- --job <jobId>
npm run forensic:debug -- --address <address> --latest
```

The CLI prints:

- summary;
- missing checks;
- coverage table;
- artifact path.

It writes JSON to:

```text
artifacts/forensic-debug/<jobId>.json
```

The JSON is meant to support a later Arkham-like graph visualization without rerunning the deep job.

## Evidence Rules

The debug report must not create risk labels or alter risk scoring.

Counterparty behavior is separated from exact taint:

- a direct counterparty with `darknet_exchange`, `darknet_exchange_proximity`, or `approval_drain_proximity` can be exact/high-risk evidence;
- a direct counterparty with only service exposure, router/bridge/CEX usage, or transit-like behavior is context;
- if a counterparty is seen but not scored, the table must say why.

## Acceptance Criteria

- A completed deep job with `coverageDebug` prints a populated coverage table.
- A legacy job without `coverageDebug` prints a partial debug summary instead of failing.
- Sparse wallets use latest 60 historical transfers when the 30d window has fewer than 60 transfers.
- Direct subject counterparties are represented in the debug table.
- No Telegram user-facing risk wording changes in this phase.
- No `fraud proven` wording.
