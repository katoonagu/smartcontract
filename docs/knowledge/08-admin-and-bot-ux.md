---
status: current
last_verified: 2026-07-06
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

Admin also has a Russian `Заявки о краже` workspace for preliminary theft
reports submitted through the Telegram `Сообщить о краже` flow. This workspace
is an intake and processing queue: it shows the transaction facts extracted by
the bot, the user comment, bot/payment status, internal admin status, and one
internal admin note. The internal admin status and note are not forensic proof,
do not change the bot's technical theft-report status, and do not send Telegram
notifications. The workspace links to Forensics, Wallet Intelligence, and
TronScan, but it does not launch new forensic jobs in the MVP.

For completed `address_deep_check` graphs, Admin defaults to `Full evidence`.
That mode renders all nodes and edges returned by the graph API, including
second-layer relationship edges, without applying density collapse. The local
flow, peer-link, service, and timeline filters still apply to the visible
canvas, so `Incoming`, `Outgoing`, and `Self` remain meaningful in Full
evidence. DeepCheck still keeps manual reading modes for `Investigative view`
and `Compact summary`.

Completed ordinary `where_is_money_check` graphs default to a route-focused
`Investigative view` in Admin. The main/highest-coverage provenance route is the
visual spine, while residual materiality caveats stay visible in a weaker
caveat lane instead of replacing the route. Manual `Full evidence` is also
available for ordinary Where; it renders the full graph API node/edge payload,
including origin paths, route steps, funding/source provenance context,
service/contract boundaries, residual caveats, and peer/context links. In Full
evidence, density collapse is disabled but local flow, peer-link, service, and
timeline filters still define the visible canvas.
`Compact summary` remains a manual reduced reading mode. Incoming deposit
provenance keeps the compact flow-map default.

DeepCheck Admin campaign displays show denominator counters instead of a single
ambiguous contract-driven count: incoming tx total, tx-info enriched, plain USDT
transfers, wrapper-driven incoming, Verify20 wrapper tx, exact proof count, and
whether counts are complete or lower bounds. Drainer receiver and wrapper
contract role marks, plus victim source role marks, are driven by graph payload
node metadata. Contract trigger/call/authority lines, second-hop relationship
lines, and extended-path relationship lines stay visible as contextual evidence,
but the canvas labels money amounts/times on the actual transfer edge instead
of duplicating the same transaction label on context projections.
Approval-drain authority context is drawn from victim/source to spender contract
so it does not visually imply that the drainer topped up the victim; these
contract-context projections are also kept out of transfer-row lists.
DeepCheck extended-path context that reuses the same transaction and amount as a
contract-driven receiver transfer is suppressed in the Admin graph, including
reversed subject-to-source projections. The visible route stays source/victim to
spender contract to receiver, so contextual path evidence cannot look like a
separate direct wallet transfer from the receiver back to the source.
DeepCheck second-layer relationship context also suppresses the artificial
direct subject-to-source edge when the same source/receiver pair is already
explained by a contract-driven or approval-drain profile. The source-to-service
second hop remains visible as context, but it cannot imply that the receiver
funded the victim/source wallet.

The graph counter separates the current canvas from the graph API payload:
`Visible N.../E.../P...` and `Total N.../E.../P...`. When the current view or
filters hide evidence, Admin shows `Hidden by view/filter: X nodes / Y edges`.
These graph counters and legend chips live in the Analytics rail, not over the
graph canvas controls.
The Analytics rail is compact-first: selected node/edge details are shown above
the case summary but capped so they cannot consume the whole rail, graph
counters use readable labels such as visible nodes/links/paths instead of raw
N/E/P/W codes, and long operational diagnostics such as projection gaps,
targeted history, and funding-candidate visibility are collapsed by default.
The case summary starts with the analyst meaning of the active check, then shows
risk, coverage, evidence strength, and the largest incoming/outgoing
counterparties with TronScan links. Largest incoming/outgoing rows are
selectable graph-transfer rows: clicking the row selects the corresponding edge
on the canvas, while clicking the nested transaction link opens that transfer in
TronScan. Top services are shown as service-related transaction rows with
service/wallet context, amount, transaction count, and the same row-to-edge
selection behavior.

The Admin graph canvas is a full-workspace background layer behind the Jobs,
Analytics, controls, and timeline overlays. Side rails anchor from the top of
the workbench instead of floating in the middle, while the canvas remains
visible behind them. Graph edges include a wide invisible hit target, so thin
or unlabeled context lines can still be selected without adding duplicate amount
labels. The activity timeline is a focus control: selecting a time bucket
highlights matching transfer edges and dims surrounding context on the canvas,
while the transfer drawer can still list only rows from the selected bucket.
Timeline focus copy uses human-readable local date/time ranges, shows the
active flow filter, and includes an axis/legend so analysts can tell that each
bar is a time bucket and that bar height represents visible transfer volume or
transfer count when amounts are missing.

The Jobs rail is an analyst queue, not a raw database dump. It uses queue
shortcuts for all jobs, running jobs, and jobs that need review; job cards show
plain check names, status, risk score when saved in the job result, coverage,
requester, human-readable started/updated times, a short progress or failure
reason, and only a shortened job id. The strict provenance benchmark launcher is
not shown in Jobs; strict benchmark diagnostics remain visible inside Analytics
when a job already contains them.
Job card risk uses the score saved for that specific mode first: FastCheck uses
`fastRiskReport`, DeepCheck uses explicit deep result/assessment or saved deep
profile context, Where is Money uses `whereIsMoneyReport`, and Incoming Deposit
uses `depositRiskScore`. A previous FastCheck snapshot is not used as the risk
for DeepCheck, Where, or Incoming cards.

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

For ordinary Where balance-forming slice checks, Admin distinguishes
`checking_balance_forming_slice` from targeted indexing. The graph endpoint
returns a bounded-slice progress graph with `checkedScope=balance_forming_slice`;
`layerSummary.balanceFormingSlice` carries the hop address, related hop tx,
target amount, fetched page/transfer counts, coverage ratio, status, reason, and
provider/budget flags. The Jobs card labels this phase as
`CHECKING: BALANCE SLICE` and explicitly says it is a bounded live slice, not
broad targeted indexing.

In the job list/card view, a `where_is_money_check` waiting on targeted history
is no longer shown as a plain `QUEUED` job. Admin displays it as
`WAITING: TARGETED INDEX` and includes compact live progress: active hop
address, pages, budget, unique canonical hashes/repeat ratio when available,
oldest reached date, lock owner/expiry, targeted state counts, and provider
error counters.
When the same job is checking candidate windows, Admin labels it as
`CHECKING: CANDIDATE WINDOWS` and shows broad fallback state separately.
When the same job is checking a bounded balance-forming slice, Admin labels it
as `CHECKING: BALANCE SLICE` and shows the hop address, hop tx, slice status,
coverage, pages, and transfers instead of `Indexing history`.

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
Where stop/boundary edges are diagnostic context, not money movement. They are
anchored from the upstream stop node into the first route node instead of from
the subject wallet, so a CEX/source boundary cannot look like an outgoing
transfer from the checked wallet. In `Tx labels: selected`, ordinary Where
shows labels on the selected money-origin route transfers and exact funding
candidate transfers without requiring the analyst to click every edge; context
and stop lines stay unlabeled unless explicitly inspected.

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
Telegram final address reports also preserve unified matrix `REVIEW` outcomes
as `REVIEW`; Russian output uses plain text such as `Нужна ручная проверка.`
instead of raw English fallback copy.
Fresh ordinary Where dense-hop provider-cap caveat jobs also save top-level
`score_valid=true` and `technical_status=completed` mirrors alongside the full
`whereIsMoneyReport`. Old cached failed jobs can still show historical
`provider_cap_unresolved`; Admin and support should treat those as old evidence
unless a fresh check was run.

Sanctions/source-policy copy is Russian-first in the generated reason for
sanctioned crypto-service exposure and normalized for Telegram. The reason
includes the service name, authority, and official designation date. Telegram
source-exposure lines for HTX/Huobi and source-boundary caveats have Russian
copy when the locale is `ru`, with English retained for `en`.
Telegram reason formatting also normalizes common raw action/coverage codes
such as `EDD_SOF`, `manual_review_required`, `provider_cap_unresolved`,
`incoming_history_not_fetched`, and `service_boundary_reached` into
human-readable RU/EN text. Raw codes can remain in Admin/debug details, but
user-facing Telegram copy should explain the requested action or coverage limit.
Telegram also normalizes approval-drain evidence. FastCheck preliminary output
must show the reason that actually drives the score; if the score comes from
`approval_drain_proximity`, the `Почему` block explains the saved exact
approve -> transferFrom -> receiver evidence, while rapid transit behavior is
shown only in `Дополнительный контекст`. Where preliminary delivery is labeled
as `Откуда деньги — предварительный результат` so users can distinguish it from
the initial FastCheck preliminary message.

Final Telegram address reports use reason cards. Normal user delivery shows
`Решение`, `Итоговый риск`, `Что делать`, `Почему`, and `Что важно учесть`.
It must not show scoring internals such as matrix rows, weighted layer scores,
dampeners, run profiles, or raw layer weights. Those diagnostics remain
available in support/admin output or when beta diagnostics are explicitly
enabled.

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
Admin also has a separate Wallet Intelligence workspace and authenticated API
for cross-run address sightings and relationship analytics. It indexes
completed/partial DeepCheck, Where is Money, and Incoming Deposit jobs from
saved payloads only. The view is global investigative context: repeated
appearances, requesters, source jobs, and normalized edges for triage. It is not
a forensic verdict, not Telegram output, and not per-job graph evidence or
scoring.

For theft reports, Admin should help operators process preliminary user claims
without saying that theft is confirmed. Proof still lives in the forensic
evidence surfaces.

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
  balance-forming slice progress, and targeted terminal details for
  completed/failed provider-cap cases.
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
- Fresh ordinary Where dense-hop provider-cap materiality results are full
  completed reports with caveat copy. Historical cached failures remain
  historical and are not rewritten silently.
- Completed ordinary Where graphs default to route-focused `Investigative view`
  in Admin. Manual `Full evidence` renders the full graph API payload and
  disables density collapse while preserving local flow, peer-link, service,
  and timeline filters; `Compact summary` remains available for a reduced view.
- Completed DeepCheck graphs default to `Full evidence`, with
  `Investigative view` and `Compact summary` available as manual views. Visible,
  total, and hidden-by-view graph counters are shown separately so dense
  payloads do not look like FastCheck.
- Admin progress can now show unique hash/repeat-ratio diagnostics from indexed
  pages, candidate-window counts, and bounded balance-forming slice counters.
  General split-depth/window-count progress for broad targeted indexing is still
  not first-class.
- Incoming does not yet expose the same complete resumable indexing progress
  model.
- Telegram still uses raw technical phrases in some paths outside the ordinary
  Where materiality-caveat path.
- Admin should distinguish old cached jobs from fresh live runs more clearly.
- Job-start buttons should confirm the address and queued job id in a way that
  is obvious to the analyst.
