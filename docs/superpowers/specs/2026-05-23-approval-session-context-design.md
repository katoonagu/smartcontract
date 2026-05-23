# Phase 9.3: Approval Session Context

## Summary

Approval Guard needs session context so it does not over-classify legitimate swap helper approvals as drainer candidates. A contract such as `TNKG... tokenApprove` can look weak in isolation: no provider service tag, no verified source, unlimited USDT approval, and transferFrom-capable behavior. In the observed case, however, the approval happened within minutes of a Bridgers/SunSwap route and the USDT moved through adapter/router infrastructure instead of to the spender as a collector wallet.

This phase adds a read-only temporal context layer around each approval. It records whether the approval appears linked to a known swap/bridge route, and uses that evidence to dampen risk from `HIGH review` to `MEDIUM service-linked helper approval` when the route evidence is strong.

## Goals

- Detect when an approval is part of a short-lived wallet action session, such as a bridge/swap route.
- Reduce false positives for unverified helper contracts used by known services.
- Keep risky helper approvals visible in Safety even when they are dampened.
- Preserve strict handling for EOA drainers, confirmed collector drains, provider-risk contracts, and malicious internal labels.
- Store session context as evidence so the decision can be audited and rechecked later.

## Non-Goals

- No automatic revoke or signing.
- No full graph forensics.
- No claim that a helper contract is trusted forever.
- No automatic LOW for every route-linked helper.
- No SPA scraping from TronScan pages.

## Signal Model

### `approval_temporally_linked_to_known_swap`

This signal is added when the bot finds a successful route transaction from the same watched wallet near the approval.

Conditions:

- same watched wallet;
- approval tx and route tx are within a configurable window, default `[-2m, +10m]`;
- route tx is successful and confirmed;
- route tx touches known service contracts, tags, or method families such as Bridgers, SunSwap, WTRX, UniV3Adapter, router, proxy, swap, bridge, withdraw, or deposit;
- USDT transfer goes to adapter/router/pool/service infrastructure, not directly to the approval spender as a collector;
- route contains service-like activity or counter-asset movement.

Effect:

- adds negative or dampening score impact;
- changes wording to `service-linked helper approval`;
- prevents unknown-contract heuristics alone from creating CRITICAL;
- can reduce `HIGH review` to `MEDIUM` when there is no confirmed drain.

### `approval_to_unknown_helper_contract`

This signal remains when the spender is still weakly identified.

Conditions:

- official TRON USDT approval;
- spender is a contract;
- no strong provider service tag;
- source/verification metadata is weak or missing;
- transferFrom/pull-capable selectors or route helper behavior are present.

Effect:

- stays visible in Safety;
- recommends review/revoke after the expected operation if allowance is no longer needed;
- does not call the contract a scam by itself.

## Risk Policy

- `LOW`: exact trusted/internal label, or strong provider service tag with normal service activity and no conflicting risk evidence.
- `MEDIUM`: unlimited/large approval to unverified helper contract that is temporally linked to a known swap/bridge route.
- `HIGH`: unlimited/huge approval to unknown contract with no service route evidence, no provider tag, weak metadata, and transferFrom/pull capability.
- `CRITICAL`: malicious internal/public label, provider risk with strong evidence, unknown EOA spender with confirmed drain behavior, or confirmed transferFrom drain to non-service collector.

Route-linked evidence is a dampener, not a permanent allowlist. If the same spender later drains funds outside a service session, confirmed drain evidence wins.

## Ref Block And Signing Metadata

The bot already can read raw transaction signing metadata through `TRON_FULLNODE_BASE_URL`:

- `raw_data.timestamp` as signed time;
- `raw_data.expiration`;
- `ref_block_bytes`;
- `ref_block_hash`.

The useful risk signal is not the ref block alone. The useful signal is delay between signed time and on-chain approval time. A large delay, such as a transaction signed days before being broadcast, remains suspicious. For normal swap sessions, signed time, approval time, and route execution should be close.

The session context layer should include these fields in evidence when available:

- approval signed time;
- approval block/on-chain time;
- signed-to-chain delay;
- expiration window;
- ref block bytes/hash.

## Architecture

### Session Context Builder

Add a pure module that accepts:

- approval event;
- watched wallet;
- nearby transactions/transfers;
- spender metadata;
- contract intelligence profile;
- known service/tag rules.

It returns:

- session classification: `known_swap_route`, `service_linked_helper`, `no_route_found`, or `possible_collector_drain`;
- score dampening or escalation reasons;
- normalized raw evidence;
- risk signal observations.

### TronScan Data Access

Use API calls already present or adjacent to existing client methods:

- transaction list by wallet around a timestamp;
- related TRC20 transfers around a timestamp;
- transaction detail for method/caller data;
- address metadata for receiver/service tags;
- contract intelligence cache for spender/service contracts.

Do not scrape TronScan SPA tabs.

### Storage

Reuse `raw_evidence` and `risk_signal_observations` for session evidence.

If implementation needs a read model, add a small optional table:

`approval_session_contexts`

- approval tx hash;
- watched wallet id;
- spender address;
- classification;
- linked route tx hash;
- route service tags;
- score impact;
- evidence id;
- observed at.

The first implementation can avoid this table if Safety only needs current recalculated evidence.

## Bot UX

Approval alert and Safety wording for route-linked helper approvals:

`This approval appears connected to a swap/bridge route, but the spender is unverified or untagged. Review/revoke if unexpected or no longer needed.`

Safety row should show:

- allowance: unlimited or decoded USDT amount;
- spender;
- level/score;
- session: `linked to Bridgers/SunSwap route` or `no service route found`;
- action: external TronScan approvals review.

## Error Handling

- If nearby transaction lookup fails, keep the original approval risk and log the failure.
- If session evidence is incomplete, classify as `no_route_found` rather than trusted.
- If provider metadata conflicts with route evidence, riskier evidence wins.
- Recheck/backfill must not send owner/customer alerts unless a separate future phase explicitly enables it.

## Test Plan

- Bridgers approval with provider tag and route activity stays LOW.
- `TNKG... tokenApprove`-style unverified helper with route activity becomes MEDIUM, not HIGH/CRITICAL.
- Same unverified helper without route evidence remains HIGH review.
- Unknown EOA spender with confirmed transferFrom to collector remains CRITICAL.
- Route-linked helper with later confirmed off-session drain escalates from MEDIUM to CRITICAL.
- Long signed-to-chain delay remains a visible reason unless service route evidence clearly explains the timing.
- Recheck is idempotent and does not move polling cursors.

## Acceptance Criteria

- Safety recheck on the TLhV case can show `TNKG...` as service-linked helper, not scam proof.
- Alerts and Safety copy stop using scam-like wording for route-linked helper approvals.
- Ref block/signing metadata appears in raw evidence when full-node data is available.
- Existing approval, drain observation, and contract intelligence tests remain green.
