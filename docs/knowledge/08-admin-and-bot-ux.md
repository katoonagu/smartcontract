---
status: current
last_verified: 2026-07-03
owner_area: admin
code_refs:
  - src/admin/adminConsole.ts
  - src/admin/forensicsGraph.ts
  - src/admin/adminServer.ts
  - src/storage/repositories.ts
  - src/bot/createBot.ts
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

For ordinary Where resumable indexing, Admin graph summary now exposes targeted
indexing progress while the parent job is still queued in
`waiting_for_targeted_index`. This is a progress view, not a final failure
view. It shows the waiting address, target timestamp, current budget, pages,
transfers, oldest/newest fetched dates, request/error counters, provider-cap
and budget flags, targeted state counts, locks, attempts, and next retry data.

The Admin graph endpoint now returns a progress graph for a waiting ordinary
`where_is_money_check` instead of `409 not_ready`. The graph decision is
`UNKNOWN`, risk score is `null`, and the limitation is informational:
"waiting for targeted history, not stuck".

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

- Ordinary Where exposes Stage 1.6 targeted indexing progress in Admin.
- Incoming does not yet expose the same complete resumable indexing progress
  model.
- Telegram still uses raw technical phrases in some paths.
- Admin should distinguish old cached jobs from fresh live runs more clearly.
- Job-start buttons should confirm the address and queued job id in a way that
  is obvious to the analyst.
