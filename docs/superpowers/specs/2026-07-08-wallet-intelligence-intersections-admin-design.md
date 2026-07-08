# Wallet Intelligence Intersections Admin Design

Date: 2026-07-08

## Context

Wallet Intelligence V1 already defines an Admin-only index of cross-run wallet
sightings and edges from saved DeepCheck, Where is Money, and Incoming Deposit
jobs. It intentionally does not affect risk scoring, Telegram output, labels,
or risk observations.

This addendum refines the Admin product shape. The goal is to make Wallet
Intelligence answer one analyst question clearly:

> Which addresses recur across independent checks, who checked them, in which
> modes, at what depth, through which transfer edges, and why should an analyst
> look at them?

Repeated appearance is investigative context only. It is not proof of dirty
funds.

## Product Decision

Wallet Intelligence should become a global Admin workspace for cross-run
intersections, not a generic list of all indexed addresses.

The default view should prioritize addresses that appear across different
checked subject wallets or different requesters. Known exchanges, bridges,
routers, and service wallets remain indexed and visible, but they should be
separated from unknown repeated wallets so they do not dominate analyst triage.

No new TronScan requests are introduced. The workspace uses only already saved
job payloads, normalized sightings, normalized edges, existing labels, and
existing requester metadata.

## Admin Workspace Structure

### Primary tabs

1. `Intersections`

   Default tab. Shows addresses that recur across independent contexts, such as
   two or more unique subject wallets or two or more unique requesters.

2. `Known infrastructure`

   Shows known CEX, bridge, router, service-boundary, and labeled service
   wallets. These are important context, but they should not crowd the main
   investigative queue.

3. `All sightings`

   Raw address summary table for completeness and debugging.

### Main table

Each row represents one observed address.

Columns:

- address;
- role or category hint;
- neutral tags;
- why interesting;
- unique subject count;
- unique requester count;
- source job count;
- occurrence count;
- modes seen;
- min depth;
- max depth;
- distinct tx count;
- distinct amount;
- first seen;
- last seen;
- service/category hints;
- label hints.

`why interesting` is plain analyst copy, for example:

- `Seen in 4 subjects, 3 requesters, DeepCheck + Where, depth 1-3`;
- `Known Bybit hot wallet, high recurrence, service context`;
- `Unknown address repeated across 2 requesters at depth 1`.

This copy must not use final-risk language such as `dirty`, `bad`, `blocked`,
or `high risk`.

### Filters and presets

Required filters:

- address search;
- mode;
- tag;
- requester;
- subject address;
- minimum unique subjects;
- minimum unique requesters;
- date range;
- depth range;
- distinct amount range;
- service category;
- job status.

Useful presets:

- `Repeated across subjects`;
- `Repeated across requesters`;
- `Unknown repeated wallets`;
- `Known infrastructure`;
- `Cross-mode seen`;
- `Low-depth recurrence`.

The default preset should be `Repeated across subjects`.

## Address Detail Drawer

Clicking an address opens a drawer focused on why that address appears in the
workspace.

Sections:

1. Summary

   Shows compact aggregate metrics: unique subjects, unique requesters, jobs,
   occurrences, depth range, distinct transactions, distinct amount, first seen,
   last seen, modes, tags, service hints, and label hints.

2. Requesters

   Shows all available admin-only requester context:

   - `requested_by`;
   - `telegram_user_id`;
   - username;
   - chat id;
   - message id;
   - locale;
   - job count.

3. Source jobs

   Shows source job links back to Forensics with:

   - job id;
   - mode;
   - status;
   - subject address;
   - completed time.

4. Sightings

   Shows where the address was observed:

   - source job;
   - subject address;
   - source kind;
   - role;
   - depth;
   - path id;
   - tx hash when available;
   - amount when available;
   - first seen;
   - last seen.

5. Edges and transactions

   Shows transfer/context edges involving the address:

   - from;
   - to;
   - tx hash;
   - amount;
   - timestamp;
   - job mode;
   - edge role;
   - source kind;
   - depth/path.

Each tx hash should open TronScan. Each source job should open the matching
Forensics job.

## Independence Interpretation

Wallet Intelligence should rank and explain recurrence by independence, not raw
volume alone.

Stronger triage signal:

- same unknown address appears in multiple unique subject wallets;
- same address appears for multiple requesters or Telegram users;
- same address appears across multiple check modes;
- address appears at low depth, especially depth 1 or 2;
- recurrence includes distinct transaction hashes;
- recurrence is spread over time rather than one repeated recheck.

Weaker triage signal:

- same requester repeats the same subject;
- same transaction appears in many rechecks;
- address is a known CEX, bridge, router, or service hot wallet;
- address appears only at high depth with no direct transfer context.

This can drive an Admin-only `triage priority` or sort order. It must not be
called risk score and must not feed scoring.

## Known Infrastructure Handling

Known services are still valuable. They should be collected and shown, but with
separate interpretation:

- visible tags such as `known_service_or_exchange`;
- service/category filters;
- separate `Known infrastructure` tab;
- lower priority in the default `Intersections` view unless explicitly
  filtered in;
- no implication that service recurrence is suspicious by itself.

Unknown repeated wallets should be easier to find than known high-volume
services.

## Focused Graph

V1.1 should not add a global graph of all Wallet Intelligence data. That would
quickly become unreadable.

The useful graph is an ego graph for one selected address:

- selected address in the center;
- subject wallets around it;
- source jobs grouped by mode or time;
- transfer/context edges from stored `wallet_intelligence_edges`;
- edge color by mode or source kind;
- edge labels for tx amount/time when available;
- known infrastructure nodes visually marked.

The graph is investigative navigation only. It does not become per-job evidence
or scoring evidence.

## FastCheck Scope

Current Wallet Intelligence V1 indexes DeepCheck, Where is Money, and Incoming
Deposit jobs. FastCheck can be useful for recurrence, but it has less path and
depth structure.

Recommended scope:

- keep V1.1 focused on the existing indexed modes;
- add FastCheck as Phase 2 after defining which saved FastCheck fields count as
  sightings and which fields are too shallow or noisy.

FastCheck sightings should remain neutral and should not create scoring impact.

## Guardrails

Wallet Intelligence intersections must not:

- raise risk score;
- create user-facing warnings;
- change Telegram output;
- create labels automatically;
- write `risk_signal_observations`;
- turn recurrence into hard evidence;
- imply that a repeated CEX/bridge/router wallet is dirty.

Any future scoring impact must come only from explicit evidence such as labels,
hard provenance, sanctions/service policy, or manual analyst assertions.

## Implementation Shape

Minimal implementation path:

1. Add Admin UI presets and filters for independence-oriented triage.
2. Add a visible `why interesting` column derived from existing summary fields.
3. Add a `Sightings` section to the address drawer.
4. Split known infrastructure from unknown repeated wallets in the UI.
5. Add focused selected-address graph using existing stored edges.
6. Defer FastCheck extraction until the existing modes are useful in practice.

No schema rewrite is required for the first four steps if existing summary,
requester, sighting, and edge payloads are sufficient.

## Success Criteria

An admin can answer:

- Which unknown wallets appeared in unrelated checks?
- Which repeated wallets are mostly known infrastructure?
- Which users or Telegram accounts generated the source checks?
- Which subject wallets led to this address?
- Was the recurrence low-depth or distant context?
- Which exact transactions and source jobs explain the recurrence?

The answer must be visible without opening every individual Forensics job one
by one.
