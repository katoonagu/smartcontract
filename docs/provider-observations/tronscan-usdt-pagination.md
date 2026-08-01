# TronScan USDT Pagination Observations

Status: partial live probe complete. A no-key baseline was run on 2026-07-02; key-pool RPS, known failed/reverted/approval samples, and incoming cost comparison are still required before accepting Task 4 production indexer defaults.

Probe script:

```bash
node --import tsx scripts/tronscan-pagination-probe.ts --address TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM --start-timestamp 0 --end-timestamp <max-ms>
```

Dedicated known-row sample probes use the same endpoint shape and can be added to a run:

```bash
node --import tsx scripts/tronscan-pagination-probe.ts --address <default-address> \
  --known-failed-row <address,start,end[,direction[,offset[,limit[,txid]]]]> \
  --known-reverted-row <address,start,end[,direction[,offset[,limit[,txid]]]]> \
  --known-approval-row <address,start,end[,direction[,offset[,limit[,txid]]]]>
```

The script writes raw provider bodies and a compact `summary.md` under `logs/tronscan-probe/<run-id>/`.

## Addresses Tested

- relatedAddress sample: `TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM`.
- TBD: relatedAddress samples with actual API-key pool.
- TBD: incoming toAddress samples.
- Candidate dense address from design: `TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM`.

## Endpoint Tested

```text
GET /api/token_trc20/transfers
relatedAddress={address} or toAddress={address}
contract_address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
confirm=0
limit=50
start={offset}
start_timestamp={minTimestamp}
end_timestamp={maxTimestamp}
sort=-timestamp
```

This matches the production `TronscanClient` transfer-history endpoint shape for related and incoming TRC20 USDT transfers.

## API Key Setup Used

- No-key baseline: 1 synthetic slot, `default/no_key`.
- TBD: number of real keys.
- TBD: key group syntax, if used.

The probe reads `TRONSCAN_API_KEY` as a comma-separated pool and `TRONSCAN_API_KEY_GROUPS` as `group:key1,key2;other:key3`.

## Limit And Start Behavior

- Required probes: `start=0`, `start=50`, `start=9950`, `start=10000`, `limit=50`.
- No-key baseline:
  - `start=0`: 50 rows, `total=10000`, `rangeTotal=10000`.
  - `start=50`: 50 rows, `total=10000`, `rangeTotal=10000`.
  - `start=9950`: 0 rows, `total=10000`, `rangeTotal=10000`.
  - `start=10000`: 0 rows, `total=10000`, `rangeTotal=10000`.
- Current conclusion: offset paging can produce empty far pages while provider metadata still says `10000`. Do not use far-offset emptiness as proof that all-time history is exhausted.

## RangeTotal Cap Behavior

- Required probe: dense windows where `rangeTotal` is near or equal to `10000`.
- Use `--dense-window <start:end>` for known dense timestamp windows.
- No-key baseline observed `total=10000` and `rangeTotal=10000` on the full all-time window and the default dense-window probe.
- Current conclusion: treat `rangeTotal=10000` as a provider cap until a narrower timestamp window proves otherwise. It is not a complete count.

## Same Timestamp And Same Block Boundary Behavior

- The probe walks older history with inclusive `end_timestamp=oldest_timestamp`.
- It also probes the same timestamp boundary with `start_timestamp=end_timestamp=<boundary>`.
- The summary records `oldest_block_number`, `newest_block_number`, `same_timestamp_boundary_count`, and `same_block_boundary_count`.
- No-key baseline end-walk found 9 same-timestamp boundary rows and 9 same-block boundary rows across the sampled walk.
- Exact boundary probe at one timestamp returned 1 row at `start=0` and 0 rows at `start=50`.
- Current conclusion: use inclusive timestamp overlap plus stable transfer dedupe. Keep block number in metadata and metrics because same-block overlap exists.
- TBD: whether timestamp-only paging can stall on a timestamp with more than one page.
- TBD: whether block-boundary overlap needs an additional tie-breaker beyond timestamp plus transfer dedupe.

## Known Failed/Reverted/Approval Row Probes

- Use `--known-failed-row`, `--known-reverted-row`, and `--known-approval-row` with known address/time windows before accepting canonical row filters.
- Optional `txid` records `expected_tx_id_rows` so the probe can confirm the sample transaction was present in the returned page.
- TBD: failed-row `event_type`, `confirmed`, `contractRet`, `finalResult`, `revert`, and `riskTransaction`.
- TBD: reverted-row `event_type`, `confirmed`, `contractRet`, `finalResult`, `revert`, and `riskTransaction`.
- TBD: approval-row `event_type`, `confirmed`, `contractRet`, `finalResult`, `revert`, and `riskTransaction`.

## RPS Ramp Result

- Run with `--rps-ramp 1,2,5,10 --rps-ramp-requests 20` after the key pool is configured.
- Ramp requests start on wall-clock cadence for each target RPS, with bounded in-flight work. The default cap is `ceil(target RPS * 2)`; override with `--rps-ramp-max-concurrency <n>` only if calibration needs a tighter ceiling.
- No-key baseline was intentionally not used to set production RPS defaults.
- TBD: first stable global RPS.
- TBD: first RPS with 429.
- TBD: first RPS with 403 or 5xx.
- TBD: p50/p95 latency at stable RPS.

## Known Provider Inconsistencies

- No-key baseline repeated `start=0` 5 times:
  - unique raw response hashes: 1.
  - unique canonical transfer hashes: 1.
- Empty far-offset pages were observed after non-empty `start=0`/`start=50` pages in windows with `rangeTotal=10000`.
- Current conclusion: repeated-page stability is acceptable in this sample, but far-offset empty pages are not an exhaustion signal.
- TBD: raw response hash changes with stable canonical transfer hash on keyed requests.
- TBD: metadata field drift across repeated identical pages.
- TBD: inconsistent `total` vs `rangeTotal` on narrower windows.
- TBD: status/filter fields missing or changing shape.

## Implementation Rules Accepted From Probe

- Accepted for the indexer: use inclusive timestamp overlap plus stable transfer dedupe.
- Accepted for the indexer: do not treat far-offset empty pages as all-time complete until an older timestamp walk is exhausted.
- Accepted for the indexer: treat `rangeTotal=10000` as a cap, not a complete count.
- Accepted for the indexer: raw provider rows may lack event/log index fields; canonical identity needs a fallback ordinal inside a transaction/page until a multi-event sample proves a better field.
- TBD: accepted row filters for canonical USDT transfer ledger.
- TBD: initial global and per-group RPS defaults from actual key pool.

## Additional Probes Before Task 4

- Same window/page fetched 5 times: raw response hash may change, canonical transfer hash must stay stable.
- Transaction with multiple TRC20 events: confirm `event_index`/`log_index` presence or ordinal fallback behavior.
- Failed/reverted/approval rows: run dedicated known-row probes and confirm `event_type`, `confirmed`, `contractRet`, `finalResult`, `revert`, and `riskTransaction` shape.
- Incoming sample: compare cost of `[0,maxTimestamp]` vs `[minTimestamp,maxTimestamp]`.

## Acceptance Answers

Can start+limit silently cap or empty?

- Answer: yes in the no-key baseline. `start=9950` and `start=10000` returned 0 rows while `total` and `rangeTotal` stayed at `10000`.

Does rangeTotal hit 10000 on real dense windows?

- Answer: yes in the no-key baseline for the all-time sample window and the default dense-window probe.

Do same-timestamp or same-block rows require inclusive overlap plus transfer_id dedupe?

- Answer: yes. The sampled end-walk crossed same-timestamp and same-block boundaries; indexer paging must overlap and dedupe.

What initial global RPS is stable with the actual key pool?

- Answer: TBD. No real key pool was present in this worktree environment.

Which endpoint shape gives the most stable TRC20 USDT rows?

- Answer: partial. `relatedAddress` worked for the dense address. `toAddress`/incoming still needs a comparison run.

Can provider metadata change raw_response_hash without changing canonical_transfer_hash?

- Answer: not observed in the no-key baseline. Five repeated page fetches produced one raw hash and one canonical hash.

Can one transaction contain multiple indistinguishable Transfer rows without event/log index?

- Answer: TBD. The sampled rows did not include multiple sampled rows in one transaction. Rows did not expose `event_index` or `log_index`, so the indexer must preserve ordinal fallback support.

Which row filters are required for canonical USDT transfer ledger?

- Answer: TBD after failed/reverted/approval row sample.

How much more expensive is until_timestamp than true window coverage for Incoming samples?

- Answer: TBD after incoming cost comparison.
