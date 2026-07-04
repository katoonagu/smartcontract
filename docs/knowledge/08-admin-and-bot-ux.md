---
status: current
last_verified: 2026-07-04
owner_area: admin
code_refs:
  - src/admin/adminConsole.ts
  - src/admin/forensicsGraph.ts
  - src/admin/adminServer.ts
  - src/storage/repositories.ts
  - src/bot/createBot.ts
  - tests/admin/forensicsGraph.test.ts
  - tests/admin/adminConsole.test.ts
  - tests/admin/forensicsGraph.test.ts
  - tests/admin/adminServer.test.ts
  - tests/bot/createBot.test.ts
supersedes:
  - docs/project-walkthrough/08-admin-forensics-console-plain-language.md
  - docs/project-walkthrough/14-telegram-bot-plain-language.md
  - docs/superpowers/specs/2026-07-02-admin-forensics-analyst-workbench-redesign.md
---

# Admin And Bot UX

## Current Behavior

Admin is the analyst workbench. It shows jobs, graph projections, selected
flows, technical coverage details, raw evidence summaries, and strict benchmark
metrics when present.

For completed `address_deep_check` graphs, Admin defaults to `Full evidence`.
That mode renders all nodes and edges returned by the graph API, including
second-layer relationship edges, and bypasses stale local flow, peer-link, and
service filters. DeepCheck still keeps manual reading modes for
`Investigative view` and `Compact summary`.

Completed ordinary `where_is_money_check` graphs default to a route-focused
`Investigative view` in Admin. The main/highest-coverage provenance route is the
visual spine, while residual materiality caveats stay visible in a weaker
caveat lane instead of replacing the route. Manual `Full evidence` is also
available for ordinary Where; it renders the full graph API node/edge payload,
including origin paths, route steps, funding/source provenance context,
service/contract boundaries, residual caveats, and peer/context links. In Full
evidence, local flow, peer-link, and service filters do not hide evidence.
`Compact summary` remains a manual reduced reading mode. Incoming deposit
provenance keeps the compact flow-map default.

The graph counter separates the current canvas from the graph API payload:
`Visible N.../E.../P...` and `Total N.../E.../P...`. When the current view or
filters hide evidence, Admin shows `Hidden by view/filter: X nodes / Y edges`.

For ordinary Where resumable indexing, Admin graph summary now exposes targeted
indexing progress while the parent job is still queued in
`waiting_for_targeted_index`. This is a progress view, not a final failure
view. It shows the waiting address, target timestamp, current budget, pages,
transfers, oldest/newest fetched dates, request/error counters, provider-cap
and budget flags, targeted state counts, locks, attempts, and next retry data.
With Stage 1.7, lock heartbeat can update during a long targeted worker run, so
Admin can better distinguish a live worker from a stale lock.

For ordinary Where candidate-window-first indexing, Admin distinguishes
`checking_candidate_windows` from broad targeted fallback. The graph endpoint
returns a progress graph for this phase, the summary preserves candidate-window
counts and state identity, and the UI shows candidate windows complete/queued/
running/terminal separately from `Broad fallback: not queued/queued/running`.
This avoids presenting the broad `genesis -> targetTimestamp` fallback as active
while only narrow candidate windows are being checked.

In the job list/card view, a `where_is_money_check` waiting on targeted history
is no longer shown as a plain `QUEUED` job. Admin displays it as
`WAITING: TARGETED INDEX` and includes compact live progress: active hop
address, pages, budget, unique canonical hashes/repeat ratio when available,
oldest reached date, lock owner/expiry, targeted state counts, and provider
error counters.
When the same job is checking candidate windows, Admin labels it as
`CHECKING: CANDIDATE WINDOWS` and shows broad fallback state separately.

The Admin graph endpoint now returns a progress graph for a waiting ordinary
`where_is_money_check` instead of `409 not_ready`. The graph decision is
`UNKNOWN`, risk score is `null`, and the limitation is informational:
"waiting for targeted history, not stuck".

For completed or failed ordinary Where jobs, targeted terminal coverage remains
visible in `layerSummary.targetedIndex`. When that targeted terminal state
already explains `provider_cap_unresolved`, Admin does not add a separate
generic `where_origin_paths_missing` stop as an equal-looking reason.

For ordinary Where funding-first source provenance, Admin now shows proof-class
context for hop funding candidates. Probable funding from capped or incomplete
history is shown as `funding_first_probable_source` with inferred provenance
metadata, not as a proven funding bundle and not as a final risk verdict.
Admin shows only candidates attached to concrete route hops. Exact candidates
are rendered as saved funding edges; probable candidates are weaker context;
pre-existing-balance, unresolved, and service-boundary entries are visible as
caveat/boundary facts. Candidate tails beyond the current display caps are
grouped with counts. The graph summary includes exact/probable shown vs total,
grouped hidden count, caveat counts, service boundary count, and max proven
route depth.
Where source/funding edges carry `moneyDirection` separately from drawn graph
direction. Real transfer and allocated transfer edges can use that semantic
money direction for incoming/outgoing color, while inferred provenance,
grouped/context, service, and caveat edges stay visually contextual instead of
all becoming green incoming lines. UI-collapsed groups preserve aggregate
external edges to the nearest visible hop when the hidden edge data is
available, including hidden node ids, hidden edge ids, tx hashes, amount, and
direction metadata.
When several Where paths allocate different portions of the same physical
transfer, Admin graph keeps one transfer edge and stores the per-path portions in
`allocationDetails`. This avoids duplicate dashed lines and duplicate
Counterparty transfer rows while preserving the allocation evidence.

When ordinary Where finishes with residual unresolved source provenance below
materiality, Admin graph shows `residual_unresolved_source` as an informational
caveat. The graph summary includes the unresolved amount, shares, path count,
reason counts, hard-evidence flag, and thresholds. Individual unresolved paths
remain visible as `funding_first_unresolved`. Their graph stop label is
`Residual source caveat`, not terminal `History not fully fetched`.

Telegram and support formatting now preserve the same meaning for ordinary
Where materiality caveats: `REVIEW`, the real Where risk score, score valid,
technical status `completed`, and the residual caveat. They must not show a
final `DECLINE` or a fake `ACCEPTABLE` 0/100 result for this outcome.

Admin can show more diagnostic detail than Telegram. It still can show raw
codes such as `History not fully fetched`, which is useful for debugging but
not enough as product copy.

Telegram can show `NO_FINAL_DECISION`, blocked reason, and technical status for
some invalid-score flows. It does not yet have a complete live progress UX for
ordinary long Where/Incoming indexing.

## Admin Purpose

Admin is the analyst workbench. It should show jobs, graphs, selected flows,
technical coverage, evidence, and progress.

Admin can show more diagnostic detail than Telegram.

## Bot Purpose

Telegram is the user-facing interface. It should be clear and not overclaim.

If a check is still indexing history, the bot should show progress. If final
score is blocked by coverage, the bot should say this is a technical coverage
block, not a risk verdict.

## Planned Behavior

Long checks should expose:

- phase;
- selected transfers or deposits;
- hop addresses required;
- hop addresses covered;
- current indexing address;
- pages fetched;
- oldest reached date;
- requests and rate limits;
- provider errors.

For ordinary Where in Admin, most of this is implemented for targeted history
indexing. For Telegram and Incoming, it is still planned.

## Bad UX To Avoid

Avoid final-looking messages such as:

```text
NO_FINAL_DECISION
History not fully fetched
provider_cap_unresolved
```

without explaining what the system is doing next or why score is blocked.

For Admin/debug these raw codes are useful. For Telegram they need plain
language.

When the system can keep indexing, show progress. When it cannot produce a
valid score, show a technical stop. Do not present technical stops as decline.

## Known Gaps

- Ordinary Where exposes Stage 1.6/1.7 targeted indexing progress in Admin,
  plus targeted terminal details for completed/failed provider-cap cases.
- Ordinary Where funding-first source provenance is visible in Admin graph
  limitations and edge metadata. Probable funding remains review/context.
  Real transfer source/funding edge colors are based on `moneyDirection`, not
  only on the rendered edge direction. Inferred and grouped source context stays
  visually contextual. Duplicate physical transfer edges caused by multiple path
  allocations are merged in the read model and retain allocation details.
  Route-attached funding candidates now have explicit legend categories for
  exact funding, probable context, caveats, service boundaries, and grouped
  candidate tails.
- Ordinary Where residual unresolved source provenance below materiality is
  visible as a caveat, not as a terminal provider-cap failure. Admin and bot
  formatting keep it as `REVIEW` with the real Where score.
- Completed ordinary Where graphs default to route-focused `Investigative view`
  in Admin. Manual `Full evidence` renders the full graph API payload and
  bypasses local hiding filters; `Compact summary` remains available for a
  reduced view.
- Completed DeepCheck graphs default to `Full evidence`, with
  `Investigative view` and `Compact summary` available as manual views. Visible,
  total, and hidden-by-view graph counters are shown separately so dense
  payloads do not look like FastCheck.
- Admin progress can now show unique hash/repeat-ratio diagnostics from indexed
  pages and candidate-window counts. General split-depth/window-count progress
  for broad targeted indexing is still not first-class.
- Incoming does not yet expose the same complete resumable indexing progress
  model.
- Telegram still uses raw technical phrases in some paths outside the ordinary
  Where materiality-caveat path.
- Admin should distinguish old cached jobs from fresh live runs more clearly.
- Job-start buttons should confirm the address and queued job id in a way that
  is obvious to the analyst.
