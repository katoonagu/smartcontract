# Address Fast Check Admin and Deep Hints Design

Date: 2026-06-21

## Summary

Address fast check should become visible to admins as its own completed forensic record, while staying hidden from normal Telegram users. It should expose the full data collected by the fast pass: direct incoming counterparties, direct outgoing counterparties, nearby services/contracts/bridges, the fast risk report, raw evidence, observations, and coverage limits.

The selected product direction is option 2:

1. Add an admin-visible `address_fast_check` record.
2. Add clear top tables for incoming counterparties, outgoing counterparties, and services/contracts/bridges.
3. Render a compact fast-check graph in the admin console.
4. Pass the fast top counterparties into `address_deep_check` as priority hints only.
5. Keep deep check independent. It must re-fetch and re-evaluate any hinted address before using it as evidence.

## Problem

The current address flow runs a fast check before queuing `where_is_money_check` and `address_deep_check`, but admins cannot inspect that fast check as a standalone result.

Current behavior:

- Telegram users usually see only "address check started" unless the fast pass finds hard evidence.
- Admin forensics jobs only include `address_deep_check`, `where_is_money_check`, and `incoming_deposit_check`.
- Fast check raw evidence and observations may be persisted, but there is no admin job object that groups the fast result.
- Fast check profiles are not displayed as a clear admin table.
- Fast check only passes a compact risk snapshot to queued follow-up jobs.
- Deep check independently chooses and checks important counterparties, but it does not receive fast-check top lists as explicit priorities.

This makes fast check hard to debug and wastes useful early signal that could help deep check order its work.

## Goals

1. Make fast check visible in the admin console as a first-class forensic check.
2. Keep the Telegram bot behavior unchanged: no detailed fast-check report for normal users.
3. Show everything fast check actually collected within its configured limits.
4. Add readable admin tables:
   - top incoming counterparties;
   - top outgoing counterparties;
   - top services, bridges, DEXes, routers, and contracts.
5. Add a compact graph for the fast-check neighborhood.
6. Pass fast-check top addresses to deep check as priority hints.
7. Make deep check re-verify hinted addresses before using them in scoring or evidence.
8. Preserve existing deep and where-is-money semantics.

## Non-Goals

- Do not turn fast check into a mini deep check.
- Do not show detailed fast-check output in Telegram.
- Do not make deep check depend on fast check for correctness.
- Do not use fast-check hints as proof.
- Do not expand fast check to unlimited neighbors or multi-hop recursion.
- Do not change final wallet-risk scoring as part of this feature.
- Do not change where-is-money provenance selection in this pass.

## Current System Shape

The bot currently handles a wallet address roughly as:

1. Parse address.
2. Run smart-contract check first if the input is a contract.
3. Run fast address check through `checkAddress`.
4. Queue `where_is_money_check` with mode `wallet_profile`.
5. Queue `address_deep_check`.
6. Send a compact "check started" Telegram message.

The queued jobs receive:

- subject address;
- time window;
- requested amount if present;
- locale;
- fast risk snapshot with score, level, and reasons.

They do not receive fast top counterparties or service top lists today.

## Recommended Architecture

### 1. Persist Fast Check as a Forensic Job

Add a new forensic job kind:

```text
address_fast_check
```

This job is not queued for a worker. It is completed synchronously after the fast check finishes.

Its `result_json` should contain:

- subject address;
- window start and end;
- fast risk report;
- service exposure profiles;
- address behavior profiles;
- boundary exposure profiles;
- wallet role profiles;
- stablecoin restriction profiles;
- raw evidence ids;
- observation ids;
- missing checks;
- top incoming counterparties;
- top outgoing counterparties;
- top service counterparties;
- deep and where-is-money job ids created from this fast run.

Its status should be:

- `completed` when fast check completed normally;
- `partial` when provider limits, timeouts, or incomplete checks are recorded.

### 2. Add Fast Counterparty Top Profile

Create one small profile shape for the fast pass:

```text
FastCounterpartyTopsProfile
```

It should be derived from the fast-check route edges and classifications.

It should contain:

- incoming total volume;
- outgoing total volume;
- incoming transaction count;
- outgoing transaction count;
- top incoming counterparties;
- top outgoing counterparties;
- service/category breakdown.

Each counterparty row should include:

- address;
- direction;
- total USDT volume;
- transaction count;
- share of direction volume;
- first seen;
- last seen;
- sample transaction hashes;
- service category if known;
- identity if known;
- whether it was selected as a deep priority hint.

Use existing counterparty summarization patterns where possible. Do not add a broad abstraction unless the same code can directly serve fast check and deep/admin display.

### 3. Admin Console Display

Add `address_fast_check` to the admin job kind filter.

For an `address_fast_check` job, the detail view should show:

- Fast summary: subject, status, risk score, risk level, window, missing checks.
- Top incoming table.
- Top outgoing table.
- Top services/contracts/bridges table.
- Raw evidence and observations already linked through existing evidence ids.
- Follow-up jobs: linked `where_is_money_check` and `address_deep_check` job ids.

The admin view should be explicit that the fast check is bounded and preliminary.

### 4. Fast Check Graph

Add graph projection support for `address_fast_check`.

Graph layout:

- subject wallet in the center;
- incoming counterparties on the left;
- outgoing counterparties on the right;
- service, bridge, DEX, router, and contract nodes farther right;
- optional second-hop service exit when fast check observed subject -> intermediate -> service.

Edges should show:

- direction;
- compact USDT amount;
- transaction count if the edge aggregates several transfers;
- whether the edge is direct or one-hop service context.

Node semantics should reuse the existing admin graph language:

- subject wallet;
- wallet;
- CEX;
- bridge;
- DEX/router;
- smart contract;
- unknown contract;
- service boundary.

### 5. Deep Check Priority Hints

Pass fast top counterparties into `address_deep_check` through job progress JSON, for example:

```text
fastCheckHints
```

The hints should include only compact data:

- fast check job id;
- top incoming addresses;
- top outgoing addresses;
- top service addresses;
- direction;
- volume;
- transaction count;
- category/identity if known;
- reason for priority.

Deep check should use hints only to prioritize address expansion and counterparty fast snapshots.

Rules:

- A hinted address must be re-fetched or rechecked by deep check before it affects evidence or score.
- If a hint is stale, missing, or invalid, deep check ignores it.
- If deep check discovers different volumes, deep check uses its own data.
- Deep check result should optionally record which hints were consumed, ignored, or superseded.

### 6. Where-Is-Money Interaction

Do not make where-is-money depend on fast top lists in this pass.

Where-is-money answers a narrower question: source or destination of selected money. Its current selection logic should remain based on balance, requested amount, selected transfer, seed transfers, and provenance paths.

It may continue receiving the compact fast risk snapshot as context.

## Data Flow

Approved flow:

1. Fast check runs.
2. Fast check result is saved as completed/partial `address_fast_check`.
3. Fast check result produces top profiles and graph-ready data.
4. Bot queues where-is-money and deep check as today.
5. Queue input for deep check includes compact fast hints.
6. Telegram user receives the same compact "check started" message as today.
7. Admin opens `address_fast_check` and sees the fast result, tables, graph, evidence, and follow-up job links.
8. Deep check later runs independently and may use hints for ordering, not proof.

## Error Handling and Coverage

Fast check should clearly store partial coverage:

- provider timeout;
- metadata fetch limit reached;
- service boundary stop;
- sparse wallet fallback used;
- blacklist check unavailable;
- route collection incomplete.

Admin UI should show these as limits, not hidden debug strings.

If fast-check job persistence fails after the fast check completes, Telegram flow should still continue queuing deep and where-is-money. The persistence failure should be logged and should not block the user response.

If deep hints cannot be built, deep check should run without hints.

## Testing

Add focused tests for:

1. Address bot flow creates a completed/partial `address_fast_check` admin record.
2. Telegram output does not expose the detailed fast-check tables.
3. Fast-check job `result_json` contains incoming, outgoing, and service top profiles.
4. Deep-check queue input includes compact fast hints.
5. Deep check ignores malformed or stale hints.
6. Deep check rechecks hinted counterparties before using them as evidence.
7. Admin graph projection supports `address_fast_check`.
8. Admin console kind filter includes `address_fast_check`.

## Acceptance Criteria

- Admin can filter and open `address_fast_check`.
- Admin can see the fast-check graph without waiting for deep check.
- Admin can see top incoming, top outgoing, and top services/contracts/bridges.
- Admin can see raw evidence, observations, missing checks, and follow-up job ids.
- Telegram behavior remains unchanged.
- Deep check can use fast hints for priority but remains correct without them.
- Existing `address_deep_check`, `where_is_money_check`, and `incoming_deposit_check` graph views keep working.

