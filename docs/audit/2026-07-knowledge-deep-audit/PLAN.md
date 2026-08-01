# Knowledge Deep Audit Implementation Plan

> **For agentic workers:** This plan is executed inline and interactively. Do not use subagents for this audit unless the user explicitly changes the working mode. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a readable Knowledge Deep Audit that explains how the TRON USDT monitoring and forensic bot works, area by area, without changing product behavior.

**Architecture:** Treat `docs/knowledge/*` as the product-intent source of truth and code/tests/runtime checks as evidence for current implementation. Keep the audit in `docs/audit/2026-07-knowledge-deep-audit/`, separate from the old `docs/audit/2026-07-system-audit/` draft. Each walkthrough explains the area in human technical language first and keeps code references in a short evidence appendix.

**Tech Stack:** Markdown, PowerShell read-only commands, `rg`, CodeGraph, existing Vitest tests, existing runbooks.

---

## Scope

This is a documentation and understanding pass. It should help a reader move through the project in order and understand the system before deciding what to improve.

The audit must:

- explain how the system works;
- separate product intent from verified implementation;
- identify good decisions worth keeping;
- identify unclear, risky, disputed, or improvable areas;
- preserve check-mode boundaries;
- avoid product code changes.

The audit must not:

- edit `src/`;
- edit `tests/`;
- edit `migrations/`;
- edit `docs/knowledge/` without a separate user decision;
- convert observations into fixes during this pass.

## Output Files

- Create: `docs/audit/2026-07-knowledge-deep-audit/00-reader-guide.md`
- Create: `docs/audit/2026-07-knowledge-deep-audit/01-system-overview.md`
- Create: `docs/audit/2026-07-knowledge-deep-audit/02-check-modes-walkthrough.md`
- Create: `docs/audit/2026-07-knowledge-deep-audit/03-data-indexing-walkthrough.md`
- Create: `docs/audit/2026-07-knowledge-deep-audit/04-job-lifecycle-walkthrough.md`
- Create: `docs/audit/2026-07-knowledge-deep-audit/05-forensic-logic-walkthrough.md`
- Create: `docs/audit/2026-07-knowledge-deep-audit/06-scoring-walkthrough.md`
- Create: `docs/audit/2026-07-knowledge-deep-audit/07-admin-bot-ux-walkthrough.md`
- Create: `docs/audit/2026-07-knowledge-deep-audit/08-open-questions-and-improvement-ideas.md`
- Create as needed: `docs/audit/2026-07-knowledge-deep-audit/09-where-dense-hop-materiality-finding.md`
- Create as needed: `docs/audit/2026-07-knowledge-deep-audit/10-deepcheck-contract-driven-drainer-campaign-finding.md`

## Language And Style

- Main text is Russian.
- Code terms, job kinds, statuses, function names, and file paths stay as written in code.
- Avoid a short "evidence report" style. Explain the system as an architecture walkthrough.
- Keep code paths in `Evidence Appendix`, not as the main answer.
- Do not hide uncertainty. Use explicit confidence labels.

## Confidence Labels

- `docs-only`: described by `docs/knowledge`, not yet verified in code during this audit section.
- `code-inspected`: current code entry points were read.
- `test-backed`: focused tests were run or already verified in this audit pass.
- `runtime-observed`: live runtime, database, Admin, Telegram, or provider behavior was observed.

## Standard Walkthrough Format

Each walkthrough file from `02` through `07` uses this structure:

```md
# Title

## What This Area Does

## Why It Exists

## Main User/Product Question

## End-To-End Flow

## Important Data Structures / States

## What The Knowledge Docs Claim

## What The Code Appears To Implement

## Confirmed Vs Not Confirmed

## Known Gaps

## Risks / Failure Modes

## What To Keep As-Is

## Improvement Ideas

## Questions For You

## Evidence Appendix
```

`00-reader-guide.md` and `01-system-overview.md` can use a more reader-friendly structure because they introduce the audit and the whole system.

## Task 1: First Checkpoint

**Files:**

- Create: `docs/audit/2026-07-knowledge-deep-audit/PLAN.md`
- Create: `docs/audit/2026-07-knowledge-deep-audit/00-reader-guide.md`
- Create: `docs/audit/2026-07-knowledge-deep-audit/01-system-overview.md`

- [ ] **Step 1: Read baseline knowledge docs**

Read:

```text
docs/knowledge/AGENT_BRIEF.md
docs/knowledge/00-index.md
docs/knowledge/01-product-principles.md
docs/knowledge/02-check-modes.md
docs/knowledge/03-job-lifecycle.md
docs/knowledge/04-data-sources-tronscan-indexing.md
docs/knowledge/05-where-is-money-and-incoming.md
docs/knowledge/06-deepcheck.md
docs/knowledge/07-risk-scoring-matrix.md
docs/knowledge/08-admin-and-bot-ux.md
docs/knowledge/09-current-decisions.md
docs/knowledge/10-open-problems.md
docs/knowledge/11-glossary.md
docs/knowledge/12-runbooks.md
docs/knowledge/13-agent-observations.md
```

Expected result: the writer can explain the product, core principles, current decisions, known gaps, and reading order.

- [ ] **Step 2: Inspect system overview code entry points**

Inspect the top-level architecture around:

```text
src/index.ts
src/bot/createBot.ts
src/admin/adminRuntime.ts
src/admin/adminServer.ts
src/storage/repositories.ts
src/tron/tronClient.ts
src/tron/tronscanScheduler.ts
src/forensics/deepForensicJob.ts
src/forensics/incomingDepositJob.ts
src/forensics/addressIndexWorker.ts
src/forensics/tronAddressAllTimeIndex.ts
src/risk/unifiedWalletRisk.ts
```

Expected result: `01-system-overview.md` can distinguish app startup, Telegram, Admin, workers, DB, TronScan, indexing, forensic jobs, and scoring.

- [ ] **Step 3: Write the reader guide**

Write `00-reader-guide.md` with:

- audit purpose;
- how to read the files;
- difference between `docs/knowledge` and `docs/audit`;
- confidence labels;
- recurring questions for every section;
- rules for not overclaiming current behavior.

- [ ] **Step 4: Write the system overview**

Write `01-system-overview.md` with:

- product overview;
- main actors and surfaces;
- check modes;
- data flow;
- job and worker flow;
- indexing and coverage flow;
- scoring and output flow;
- what is confirmed versus not confirmed in this checkpoint;
- reading map for the following walkthroughs.

- [ ] **Step 5: Verify only intended audit docs changed**

Run:

```powershell
git diff --check -- docs/audit/2026-07-knowledge-deep-audit
Get-ChildItem -LiteralPath 'docs\audit\2026-07-knowledge-deep-audit' -Filter '*.md' | Select-String -Pattern 'T[O]DO|T[B]D|\?\?\?' -CaseSensitive:$false
git status --short
```

Expected result: no whitespace errors or unfinished markers. `git status --short` may still show pre-existing unrelated dirty files outside this audit folder.

- [ ] **Step 6: Stop for user review**

Report:

- files created;
- how to read them;
- what to focus on while reviewing;
- knowledge files read;
- docs changed;
- confirmation that product code, migrations, and `docs/knowledge` were not changed.

Do not create `02-check-modes-walkthrough.md` until the user approves the first checkpoint.

## Task 2: Check Modes Walkthrough

**Files:**

- Create: `docs/audit/2026-07-knowledge-deep-audit/02-check-modes-walkthrough.md`
- Modify: `docs/audit/2026-07-knowledge-deep-audit/08-open-questions-and-improvement-ideas.md` if the user has approved creating it by then.

Read mode-specific docs and code, explain fast check, DeepCheck, Where is money, Incoming deposit, and unified `/check`.

Stop for review after the section is written.

## Task 3: Data Indexing Walkthrough

**Files:**

- Create: `docs/audit/2026-07-knowledge-deep-audit/03-data-indexing-walkthrough.md`

Explain TronScan, scheduler/key pool, local index, `all_time` versus `targeted`, page audits, provider caps, budgets, cache-aware resume, repair scripts, and coverage meaning.

Stop for review after the section is written.

## Task 4: Job Lifecycle Walkthrough

**Files:**

- Create: `docs/audit/2026-07-knowledge-deep-audit/04-job-lifecycle-walkthrough.md`

Explain queue/running/waiting/completed/failed, parent jobs, background index tasks, wait/resume, locks, heartbeat, stale jobs, and technical terminal states.

Stop for review after the section is written.

## Task 5: Forensic Logic Walkthrough

**Files:**

- Create: `docs/audit/2026-07-knowledge-deep-audit/05-forensic-logic-walkthrough.md`

Explain money paths, hops, source provenance, exact/probable/unresolved proof classes, service boundaries, materiality, and Where versus Incoming differences.

Stop for review after the section is written.

## Task 6: Scoring Walkthrough

**Files:**

- Create: `docs/audit/2026-07-knowledge-deep-audit/06-scoring-walkthrough.md`

Explain `score_valid`, technical no-score, `REVIEW`/`DECLINE`, floors, dampeners, hard evidence, weak context, and incomplete coverage.

Stop for review after the section is written.

## Task 7: Admin And Bot UX Walkthrough

**Files:**

- Create: `docs/audit/2026-07-knowledge-deep-audit/07-admin-bot-ux-walkthrough.md`

Explain Admin analyst view, Telegram user view, progress display, raw technical codes, user-facing wording, and stale cached job risk.

Stop for review after the section is written.

## Task 8: Open Questions And Improvement Ideas

**Files:**

- Create: `docs/audit/2026-07-knowledge-deep-audit/08-open-questions-and-improvement-ideas.md`

Collect product questions, improvement ideas, keep-as-is decisions, and items that need separate implementation plans. Do not turn this file into a hidden implementation plan without user approval.

## Task 9: Manual Findings And Candidate Specs

**Files:**

- Create as needed: `docs/audit/2026-07-knowledge-deep-audit/09-where-dense-hop-materiality-finding.md`
- Create as needed: `docs/audit/2026-07-knowledge-deep-audit/10-deepcheck-contract-driven-drainer-campaign-finding.md`

Capture runtime-observed manual findings that are more specific than the broad
walkthrough sections. These notes can become candidate implementation specs
after product review, but they are still documentation until separately
approved for code changes.

## Plan Self-Review

- Spec coverage: the plan covers the approved files `00` through `08`, plus
  manual finding/spec notes such as `09` when explicitly requested.
- Scope control: all planned edits stay under `docs/audit/2026-07-knowledge-deep-audit/`.
- First checkpoint: only `PLAN.md`, `00-reader-guide.md`, and `01-system-overview.md` are created before user review.
- Product safety: no product code, migrations, or `docs/knowledge` edits are planned.
- Review cadence: each major walkthrough stops for user review.
