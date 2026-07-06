# System Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the first diagnostic system audit pass as evidence-backed notes under `docs/audit/2026-07-system-audit/`.

**Architecture:** Treat the audit as documentation plus verification work, not product implementation. Each area gets its own note with the same evidence structure, while shared findings and decisions live in separate ledgers.

**Tech Stack:** Markdown, PowerShell, `rg`, git, existing npm scripts, Vitest, local Admin runbook commands, PostgreSQL query snippets from `docs/knowledge/12-runbooks.md`.

---

## Constraints

- [ ] Do not edit product code in `src/`, `tests/`, `migrations/`, or `scripts/` during this audit execution pass.
- [ ] Do not update `docs/knowledge/*` unless the user explicitly changes scope.
- [ ] Do not treat an old database job as fresh proof without checking job id, `created_at`, and `requested_by`.
- [ ] Do not convert findings into fixes in this pass.
- [ ] Do not collapse fast, deep, where, incoming, and unified `/check` into one mode.
- [ ] Keep every audit note explicit about confidence: `docs-only`, `code-inspected`, `test-backed`, or `runtime-observed`.
- [ ] Commit after each coherent audit area so review can stop or continue cleanly.

## Source Spec

- `docs/superpowers/specs/2026-07-04-system-audit-design.md`

## Files Created

- Create: `docs/audit/2026-07-system-audit/00-map-and-index.md`
- Create: `docs/audit/2026-07-system-audit/01-product-modes.md`
- Create: `docs/audit/2026-07-system-audit/02-data-and-indexing.md`
- Create: `docs/audit/2026-07-system-audit/03-job-lifecycle.md`
- Create: `docs/audit/2026-07-system-audit/04-forensic-logic.md`
- Create: `docs/audit/2026-07-system-audit/05-scoring-policy.md`
- Create: `docs/audit/2026-07-system-audit/06-admin-bot-ux.md`
- Create: `docs/audit/2026-07-system-audit/07-findings-backlog.md`
- Create: `docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md`

## Shared Note Contract

Each area note must contain these headings in this order:

```md
# Area Name

## Promise

## Code Entry Points

## Minimal Verification

## Expected Vs Actual

## Cross-Cutting Invariants

## Findings

## Questions

## Section Verdict

## Improvement Ideas

## Keep-As-Is Rationale

## Next Action
```

Allowed finding confidence values:

```text
docs-only
code-inspected
test-backed
runtime-observed
```

Allowed decision categories:

```text
leave as-is
document better
improve later
needs product decision
candidate for implementation
```

---

### Task 1: Audit Folder, Index, And Ledgers

**Files:**
- Create: `docs/audit/2026-07-system-audit/00-map-and-index.md`
- Create: `docs/audit/2026-07-system-audit/07-findings-backlog.md`
- Create: `docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md`

- [ ] **Step 1: Confirm working tree baseline**

Run:

```powershell
git status --short
```

Expected: only pre-existing unrelated untracked files may appear. Do not stage `tmp/` or unrelated `docs/superpowers/plans/*` files.

- [ ] **Step 2: Read required project knowledge**

Run:

```powershell
Get-Content -LiteralPath 'docs\knowledge\AGENT_BRIEF.md' -Encoding UTF8
Get-Content -LiteralPath 'docs\knowledge\00-index.md' -Encoding UTF8
Get-Content -LiteralPath 'docs\knowledge\09-current-decisions.md' -Encoding UTF8
Get-Content -LiteralPath 'docs\knowledge\10-open-problems.md' -Encoding UTF8
Get-Content -LiteralPath 'docs\knowledge\12-runbooks.md' -Encoding UTF8
```

Expected: the worker can state the audit route, runbook commands, and current known gaps before creating notes.

- [ ] **Step 3: Create the audit index**

Add `docs/audit/2026-07-system-audit/00-map-and-index.md` with this starting content:

```md
# System Audit Map And Index

## Scope

This is a diagnostic audit pass for the TRON USDT monitoring and forensic bot.
It maps product promises to code, minimal verification, findings, and decisions.
Product code is not changed during this pass.

## Reading Order

1. `01-product-modes.md`
2. `02-data-and-indexing.md`
3. `03-job-lifecycle.md`
4. `04-forensic-logic.md`
5. `05-scoring-policy.md`
6. `06-admin-bot-ux.md`
7. `07-findings-backlog.md`
8. `08-decisions-and-improvement-ideas.md`

## Cross-Cutting Invariants

- Facts and interpretation stay separated.
- Missing data is not clean.
- A technical stop is not a risk verdict.
- A service boundary is not a coverage failure.
- An old database job is not fresh runtime proof.
- `REVIEW` does not become a false `DECLINE`.
- Check modes stay separate.

## Representative Scenario Matrix

| Scenario | Status | Evidence Location | Confidence | Notes |
| --- | --- | --- | --- | --- |
| Fresh ordinary `Where is money` | not checked | `04-forensic-logic.md` | docs-only | Planned representative scenario. |
| `Where is money` with targeted wait/resume | not checked | `03-job-lifecycle.md` | docs-only | Planned representative scenario. |
| Terminal provider cap with no final score | not checked | `03-job-lifecycle.md` | docs-only | Planned representative scenario. |
| Residual unresolved source provenance below materiality | not checked | `05-scoring-policy.md` | docs-only | Planned representative scenario. |
| `Incoming deposit` incomplete coverage | not checked | `04-forensic-logic.md` | docs-only | Planned representative scenario. |
| DeepCheck full evidence graph | not checked | `06-admin-bot-ux.md` | docs-only | Planned representative scenario. |
| Old cached job vs fresh job | not checked | `06-admin-bot-ux.md` | docs-only | Planned representative scenario. |
| Telegram technical block copy | not checked | `06-admin-bot-ux.md` | docs-only | Planned representative scenario. |

## Audit Progress

| Note | Status | Section Verdict |
| --- | --- | --- |
| `01-product-modes.md` | not started | not reviewed |
| `02-data-and-indexing.md` | not started | not reviewed |
| `03-job-lifecycle.md` | not started | not reviewed |
| `04-forensic-logic.md` | not started | not reviewed |
| `05-scoring-policy.md` | not started | not reviewed |
| `06-admin-bot-ux.md` | not started | not reviewed |
```

- [ ] **Step 4: Create the findings backlog**

Add `docs/audit/2026-07-system-audit/07-findings-backlog.md` with this starting content:

```md
# Findings Backlog

## Severity Rules

- P0: can produce an incorrect final risk verdict or data loss.
- P1: breaks a key paid scenario, provenance completeness, job lifecycle, or score-validity honesty.
- P2: materially weakens analyst/user UX, diagnostics, progress visibility, or supportability.
- P3: docs mismatch, cleanup, wording, test coverage, or minor developer experience issue.

## Open Findings

No findings recorded yet.

## Finding Template For New Entries

Use this exact field set when adding a finding:

```text
Severity:
Area:
Status:
Evidence:
- docs:
- code:
- runtime/manual:
Confidence:
Impact:
Recommended next action:
```
```

- [ ] **Step 5: Create the decision ledger**

Add `docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md` with this starting content:

```md
# Decisions And Improvement Ideas

## Decision Categories

- `leave as-is`
- `document better`
- `improve later`
- `needs product decision`
- `candidate for implementation`

## Decisions

No decisions recorded yet.

## Decision Template For New Entries

Use this exact field set when adding a decision:

```text
Area:
Decision:
Rationale:
Evidence:
Related findings:
Next review trigger:
```
```

- [ ] **Step 6: Verify created files**

Run:

```powershell
Get-ChildItem -LiteralPath 'docs\audit\2026-07-system-audit' | Select-Object Name,Length
Select-String -LiteralPath 'docs\audit\2026-07-system-audit\*.md' -Pattern 'T[O]DO|T[B]D|\?\?\?' -CaseSensitive:$false
```

Expected: the three files exist, and the second command returns no matches.

- [ ] **Step 7: Commit audit scaffolding**

Run:

```powershell
git add -- docs/audit/2026-07-system-audit/00-map-and-index.md docs/audit/2026-07-system-audit/07-findings-backlog.md docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md
git commit -m "docs: scaffold system audit"
```

Expected: a commit containing only the three audit scaffold files.

---

### Task 2: Product Modes Audit

**Files:**
- Create: `docs/audit/2026-07-system-audit/01-product-modes.md`
- Modify: `docs/audit/2026-07-system-audit/00-map-and-index.md`
- Modify: `docs/audit/2026-07-system-audit/07-findings-backlog.md`
- Modify: `docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md`

- [ ] **Step 1: Read mode-specific docs**

Run:

```powershell
Get-Content -LiteralPath 'docs\knowledge\02-check-modes.md' -Encoding UTF8
Get-Content -LiteralPath 'docs\knowledge\09-current-decisions.md' -Encoding UTF8
Get-Content -LiteralPath 'docs\knowledge\13-agent-observations.md' -Encoding UTF8
```

Expected: the worker can restate the separate questions answered by fast, deep, where, incoming, and unified `/check`.

- [ ] **Step 2: Map mode entry points**

Run:

```powershell
rg -n "address_fast_check|address_deep_check|where_is_money_check|incoming_deposit_check|unified|/check|Where is money|Incoming deposit" src tests docs/knowledge
```

Expected: output includes `src/index.ts`, `src/check/deepForensicCheck.ts`, `src/forensics/deepForensicJob.ts`, `src/forensics/incomingDepositJob.ts`, and `src/risk/unifiedWalletRisk.ts`.

- [ ] **Step 3: Inspect focused code anchors**

Run:

```powershell
Get-Content -LiteralPath 'src\index.ts' -Encoding UTF8 | Select-Object -First 220
Get-Content -LiteralPath 'src\risk\unifiedWalletRisk.ts' -Encoding UTF8 | Select-Object -First 260
Get-Content -LiteralPath 'src\forensics\incomingDepositJob.ts' -Encoding UTF8 | Select-Object -First 220
```

Expected: enough context to identify job kinds, unified composition, and incoming-deposit flow boundaries.

- [ ] **Step 4: Run focused mode tests**

Run:

```powershell
npm test -- tests/check/whereIsMoneyCheck.test.ts tests/check/deepForensicCheck.test.ts tests/forensics/incomingDepositJob.test.ts tests/risk/unifiedWalletRisk.test.ts
```

Expected: PASS. If tests fail, record the command, failure summary, and confidence `test-backed` in `07-findings-backlog.md`.

- [ ] **Step 5: Write product modes note**

Create `docs/audit/2026-07-system-audit/01-product-modes.md` with the shared note headings. Include:

- the distinct product question for each mode;
- code entry points found in Step 2 and Step 3;
- focused test command and result;
- expected vs actual comparison;
- a section verdict using one of: `healthy`, `known gaps`, `needs follow-up`, `blocked by missing evidence`;
- keep-as-is rationale for any mode boundary that should remain separate.

- [ ] **Step 6: Update index and ledgers**

Modify:

```text
docs/audit/2026-07-system-audit/00-map-and-index.md
docs/audit/2026-07-system-audit/07-findings-backlog.md
docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md
```

Expected: index row for `01-product-modes.md` is no longer `not started`; findings and decisions are updated only when evidence supports an entry.

- [ ] **Step 7: Commit product modes audit**

Run:

```powershell
git diff --check -- docs/audit/2026-07-system-audit
git add -- docs/audit/2026-07-system-audit/01-product-modes.md docs/audit/2026-07-system-audit/00-map-and-index.md docs/audit/2026-07-system-audit/07-findings-backlog.md docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md
git commit -m "docs: audit product modes"
```

Expected: one commit containing only audit docs.

---

### Task 3: Data And Indexing Audit

**Files:**
- Create: `docs/audit/2026-07-system-audit/02-data-and-indexing.md`
- Modify: `docs/audit/2026-07-system-audit/00-map-and-index.md`
- Modify: `docs/audit/2026-07-system-audit/07-findings-backlog.md`
- Modify: `docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md`

- [ ] **Step 1: Read data-source docs**

Run:

```powershell
Get-Content -LiteralPath 'docs\knowledge\04-data-sources-tronscan-indexing.md' -Encoding UTF8
Get-Content -LiteralPath 'docs\knowledge\10-open-problems.md' -Encoding UTF8
Get-Content -LiteralPath 'docs\knowledge\12-runbooks.md' -Encoding UTF8
```

Expected: the worker can explain the difference between TronScan provider caps, local page budgets, targeted coverage, and API key throughput.

- [ ] **Step 2: Map indexing code anchors**

Run:

```powershell
rg -n "TARGETED_HISTORY|partial_provider_cap|partial_budget_exhausted|apiKeyCount|tronscan_scheduler_configured|targeted" src tests scripts docs/knowledge
```

Expected: output includes `src/tron/tronscanScheduler.ts`, `src/forensics/tronAddressAllTimeIndex.ts`, `src/forensics/targetedHistoryCoordinator.ts`, `src/forensics/addressIndexWorker.ts`, and `scripts/repairTargetedIndexCoverage.ts`.

- [ ] **Step 3: Inspect focused indexing code**

Run:

```powershell
Get-Content -LiteralPath 'src\forensics\targetedHistoryCoordinator.ts' -Encoding UTF8 | Select-Object -First 260
Get-Content -LiteralPath 'src\forensics\addressIndexWorker.ts' -Encoding UTF8 | Select-Object -First 260
Get-Content -LiteralPath 'src\tron\tronscanScheduler.ts' -Encoding UTF8 | Select-Object -First 220
```

Expected: enough context to document targeted state handling, retry/escalation, and key-pool scheduling.

- [ ] **Step 4: Run focused indexing tests**

Run:

```powershell
npm test -- tests/tron/tronscanScheduler.test.ts tests/forensics/tronAddressAllTimeIndex.test.ts tests/forensics/targetedHistoryCoordinator.test.ts tests/forensics/addressIndexWorker.test.ts tests/forensics/targetedIndexRepair.test.ts
```

Expected: PASS. If tests fail, record exact failing test names and confidence `test-backed`.

- [ ] **Step 5: Write data and indexing note**

Create `docs/audit/2026-07-system-audit/02-data-and-indexing.md` with the shared note headings. Include:

- current TronScan source-of-truth decision;
- key-pool behavior and what it does not solve;
- targeted coverage states;
- provider cap vs local budget distinction;
- repair/cache paths;
- test command and result;
- section verdict and improvement ideas.

- [ ] **Step 6: Update scenario matrix and ledgers**

Update `00-map-and-index.md` scenario rows related to targeted wait/resume and terminal provider cap when evidence was collected in this task. Update findings and decisions only for evidence-backed items.

- [ ] **Step 7: Commit data and indexing audit**

Run:

```powershell
git diff --check -- docs/audit/2026-07-system-audit
git add -- docs/audit/2026-07-system-audit/02-data-and-indexing.md docs/audit/2026-07-system-audit/00-map-and-index.md docs/audit/2026-07-system-audit/07-findings-backlog.md docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md
git commit -m "docs: audit data indexing"
```

Expected: one commit containing only audit docs.

---

### Task 4: Job Lifecycle Audit

**Files:**
- Create: `docs/audit/2026-07-system-audit/03-job-lifecycle.md`
- Modify: `docs/audit/2026-07-system-audit/00-map-and-index.md`
- Modify: `docs/audit/2026-07-system-audit/07-findings-backlog.md`
- Modify: `docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md`

- [ ] **Step 1: Read lifecycle docs**

Run:

```powershell
Get-Content -LiteralPath 'docs\knowledge\03-job-lifecycle.md' -Encoding UTF8
Get-Content -LiteralPath 'docs\knowledge\08-admin-and-bot-ux.md' -Encoding UTF8
Get-Content -LiteralPath 'docs\knowledge\10-open-problems.md' -Encoding UTF8
```

Expected: the worker can explain `queued -> running -> partial -> completed -> failed -> cancelled`, targeted waits, lock heartbeat, and technical stops.

- [ ] **Step 2: Map lifecycle code anchors**

Run:

```powershell
rg -n "waiting_for_targeted_index|locked_until|claim|heartbeat|score_valid|technical_status|forensic_check_jobs|start.*worker|schedule" src tests migrations docs/knowledge
```

Expected: output includes `src/storage/repositories.ts`, `src/index.ts`, `src/forensics/deepForensicJob.ts`, `src/forensics/incomingDepositJob.ts`, `src/forensics/addressIndexWorker.ts`, and `migrations/027_forensic_job_waits.sql`.

- [ ] **Step 3: Inspect repository and startup code**

Run:

```powershell
Get-Content -LiteralPath 'src\storage\repositories.ts' -Encoding UTF8 | Select-Object -First 320
Get-Content -LiteralPath 'src\index.ts' -Encoding UTF8 | Select-Object -First 260
Get-Content -LiteralPath 'migrations\027_forensic_job_waits.sql' -Encoding UTF8
```

Expected: enough context to document job storage, waits, startup scheduling, and stale-lock handling.

- [ ] **Step 4: Run focused lifecycle tests**

Run:

```powershell
npm test -- tests/storage/forensicCheckJobs.test.ts tests/runtime/startupSchedule.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/addressIndexWorker.test.ts tests/forensics/targetedHistoryCoordinator.test.ts
```

Expected: PASS. Record failures with confidence `test-backed`.

- [ ] **Step 5: Optionally inspect recent jobs**

Run this only when `.env` has a reachable `DATABASE_URL` and the user expects live DB inspection:

```powershell
@'
import dotenv from "dotenv";
import pg from "pg";
dotenv.config({ path: ".env" });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(`
 select id, kind, subject_address, status, requested_by, created_at, completed_at, last_error
 from forensic_check_jobs
 order by created_at desc
 limit 10
`);
console.table(rows.map((r) => ({
  id: r.id.slice(0, 8),
  kind: r.kind,
  subject: r.subject_address?.slice(0, 10),
  status: r.status,
  requested: r.requested_by,
  created: r.created_at,
  completed: r.completed_at,
  err: r.last_error
})));
await client.end();
'@ | node --import tsx
```

Expected: either a table of recent jobs or a recorded note that live DB inspection was not run.

- [ ] **Step 6: Write job lifecycle note**

Create `docs/audit/2026-07-system-audit/03-job-lifecycle.md` with the shared note headings. Include:

- repository statuses and product phases;
- which modes use wait/resume;
- which mode still lacks shared resumable indexing;
- technical stop handling;
- worker startup behavior;
- stale evidence guard for Admin/DB;
- test and optional DB inspection results.

- [ ] **Step 7: Update ledgers and commit**

Run:

```powershell
git diff --check -- docs/audit/2026-07-system-audit
git add -- docs/audit/2026-07-system-audit/03-job-lifecycle.md docs/audit/2026-07-system-audit/00-map-and-index.md docs/audit/2026-07-system-audit/07-findings-backlog.md docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md
git commit -m "docs: audit job lifecycle"
```

Expected: one commit containing only audit docs.

---

### Task 5: Forensic Logic Audit

**Files:**
- Create: `docs/audit/2026-07-system-audit/04-forensic-logic.md`
- Modify: `docs/audit/2026-07-system-audit/00-map-and-index.md`
- Modify: `docs/audit/2026-07-system-audit/07-findings-backlog.md`
- Modify: `docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md`

- [ ] **Step 1: Read forensic logic docs**

Run:

```powershell
Get-Content -LiteralPath 'docs\knowledge\05-where-is-money-and-incoming.md' -Encoding UTF8
Get-Content -LiteralPath 'docs\knowledge\06-deepcheck.md' -Encoding UTF8
Get-Content -LiteralPath 'docs\knowledge\11-glossary.md' -Encoding UTF8
```

Expected: the worker can explain money paths, hop history, source provenance proof classes, service boundaries, and DeepCheck role.

- [ ] **Step 2: Map forensic logic code anchors**

Run:

```powershell
rg -n "sourceProvenance|proofClass|service_boundary|incoming_history_not_fetched|residual_unresolved|materiality|fundingBundle|originPaths" src tests docs/knowledge
```

Expected: output includes `src/forensics/moneyOriginTrace.ts`, `src/forensics/fundingFirstSourceProvenance.ts`, `src/forensics/moneyOriginOperationalAssessment.ts`, `src/forensics/incomingDepositJob.ts`, and related tests.

- [ ] **Step 3: Inspect focused forensic code**

Run:

```powershell
Get-Content -LiteralPath 'src\forensics\moneyOriginTrace.ts' -Encoding UTF8 | Select-Object -First 280
Get-Content -LiteralPath 'src\forensics\fundingFirstSourceProvenance.ts' -Encoding UTF8 | Select-Object -First 280
Get-Content -LiteralPath 'src\forensics\moneyOriginOperationalAssessment.ts' -Encoding UTF8 | Select-Object -First 260
```

Expected: enough context to document exact/probable/unresolved classes, boundary stops, and materiality handling.

- [ ] **Step 4: Run focused forensic tests**

Run:

```powershell
npm test -- tests/forensics/moneyOriginTrace.test.ts tests/forensics/fundingFirstSourceProvenance.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/forensics/incomingDepositJob.test.ts tests/check/deepForensicCheck.test.ts
```

Expected: PASS. Record failures with confidence `test-backed`.

- [ ] **Step 5: Write forensic logic note**

Create `docs/audit/2026-07-system-audit/04-forensic-logic.md` with the shared note headings. Include:

- difference between Where, Incoming, and DeepCheck forensic logic;
- source provenance proof classes;
- service boundary vs coverage failure distinction;
- material unresolved vs residual below materiality;
- known Incoming resumable-indexing gap;
- scenario matrix updates for fresh Where, Incoming incomplete coverage, and residual unresolved below materiality.

- [ ] **Step 6: Update ledgers and commit**

Run:

```powershell
git diff --check -- docs/audit/2026-07-system-audit
git add -- docs/audit/2026-07-system-audit/04-forensic-logic.md docs/audit/2026-07-system-audit/00-map-and-index.md docs/audit/2026-07-system-audit/07-findings-backlog.md docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md
git commit -m "docs: audit forensic logic"
```

Expected: one commit containing only audit docs.

---

### Task 6: Scoring Policy Audit

**Files:**
- Create: `docs/audit/2026-07-system-audit/05-scoring-policy.md`
- Modify: `docs/audit/2026-07-system-audit/00-map-and-index.md`
- Modify: `docs/audit/2026-07-system-audit/07-findings-backlog.md`
- Modify: `docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md`

- [ ] **Step 1: Read scoring docs**

Run:

```powershell
Get-Content -LiteralPath 'docs\knowledge\07-risk-scoring-matrix.md' -Encoding UTF8
Get-Content -LiteralPath 'docs\knowledge\05-where-is-money-and-incoming.md' -Encoding UTF8
Get-Content -LiteralPath 'docs\knowledge\09-current-decisions.md' -Encoding UTF8
```

Expected: the worker can explain `score_valid`, score blockers, technical no-score states, floors, dampeners, and `REVIEW` preservation.

- [ ] **Step 2: Map scoring code anchors**

Run:

```powershell
rg -n "score_valid|scoreValid|score_blocked_reason|technical_status|NO_FINAL|REVIEW|DECLINE|floor|dampener|residual_unresolved_below_materiality" src tests docs/knowledge
```

Expected: output includes `src/risk/unifiedWalletRisk.ts`, `src/forensics/moneyOriginOperationalAssessment.ts`, `src/forensics/moneyOriginPolicy.ts`, and bot/Admin formatting tests.

- [ ] **Step 3: Inspect focused scoring code**

Run:

```powershell
Get-Content -LiteralPath 'src\risk\unifiedWalletRisk.ts' -Encoding UTF8 | Select-Object -First 320
Get-Content -LiteralPath 'src\forensics\moneyOriginOperationalAssessment.ts' -Encoding UTF8 | Select-Object -First 260
Get-Content -LiteralPath 'src\forensics\moneyOriginPolicy.ts' -Encoding UTF8 | Select-Object -First 220
```

Expected: enough context to document score validity and decision mapping.

- [ ] **Step 4: Run focused scoring tests**

Run:

```powershell
npm test -- tests/risk/unifiedWalletRisk.test.ts tests/risk/scoringSignalMatrix.test.ts tests/risk/riskPolicy.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/bot/createBot.test.ts tests/admin/forensicsGraph.test.ts
```

Expected: PASS. Record failures with confidence `test-backed`.

- [ ] **Step 5: Write scoring policy note**

Create `docs/audit/2026-07-system-audit/05-scoring-policy.md` with the shared note headings. Include:

- when scores are valid vs blocked;
- how hard evidence floors differ from weak context;
- how technical stops should surface;
- `REVIEW` preservation requirements;
- materiality thresholds and config question;
- test results and scenario matrix updates.

- [ ] **Step 6: Update ledgers and commit**

Run:

```powershell
git diff --check -- docs/audit/2026-07-system-audit
git add -- docs/audit/2026-07-system-audit/05-scoring-policy.md docs/audit/2026-07-system-audit/00-map-and-index.md docs/audit/2026-07-system-audit/07-findings-backlog.md docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md
git commit -m "docs: audit scoring policy"
```

Expected: one commit containing only audit docs.

---

### Task 7: Admin And Bot UX Audit

**Files:**
- Create: `docs/audit/2026-07-system-audit/06-admin-bot-ux.md`
- Modify: `docs/audit/2026-07-system-audit/00-map-and-index.md`
- Modify: `docs/audit/2026-07-system-audit/07-findings-backlog.md`
- Modify: `docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md`

- [ ] **Step 1: Read UX docs**

Run:

```powershell
Get-Content -LiteralPath 'docs\knowledge\08-admin-and-bot-ux.md' -Encoding UTF8
Get-Content -LiteralPath 'docs\knowledge\03-job-lifecycle.md' -Encoding UTF8
Get-Content -LiteralPath 'docs\knowledge\12-runbooks.md' -Encoding UTF8
```

Expected: the worker can explain Admin graph defaults, Full evidence vs Investigative view, waiting progress, Telegram technical block copy, and stale-job risk.

- [ ] **Step 2: Map UX code anchors**

Run:

```powershell
rg -n "Full evidence|Investigative view|Compact summary|WAITING: TARGETED INDEX|NO_FINAL_DECISION|technical_status|scoreValid|support report|Hidden by view" src tests docs/knowledge
```

Expected: output includes `src/admin/adminConsole.ts`, `src/admin/forensicsGraph.ts`, `src/admin/adminServer.ts`, `src/bot/createBot.ts`, and Admin/Bot tests.

- [ ] **Step 3: Inspect focused UX code**

Run:

```powershell
Get-Content -LiteralPath 'src\admin\forensicsGraph.ts' -Encoding UTF8 | Select-Object -First 320
Get-Content -LiteralPath 'src\admin\adminConsole.ts' -Encoding UTF8 | Select-Object -First 320
Get-Content -LiteralPath 'src\bot\createBot.ts' -Encoding UTF8 | Select-Object -First 260
```

Expected: enough context to document Admin graph rendering, job cards, and bot result formatting.

- [ ] **Step 4: Run focused UX tests**

Run:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts tests/bot/createBot.test.ts tests/bot/messages.test.ts
```

Expected: PASS. Record failures with confidence `test-backed`.

- [ ] **Step 5: Run Admin freshness check when server is available**

If a local dev server is already running or the user asks for live Admin inspection, run:

```powershell
@'
const res = await fetch("http://127.0.0.1:8787/admin/forensics");
const html = await res.text();
console.log(res.status, html.includes("Strict benchmark"), html.includes("/admin/api/forensic-jobs"));
'@ | node --input-type=module
```

Expected when Admin is running: status `200` and `true true`. If Admin is not running, record that live browser inspection was deferred instead of treating it as a product failure.

- [ ] **Step 6: Write Admin and Bot UX note**

Create `docs/audit/2026-07-system-audit/06-admin-bot-ux.md` with the shared note headings. Include:

- Admin graph default modes by job type;
- graph visible vs total counters;
- waiting progress behavior;
- Telegram technical block copy expectations;
- stale cached job guard;
- test and optional Admin freshness results;
- scenario matrix updates for DeepCheck full evidence, old cached vs fresh job, and Telegram technical block copy.

- [ ] **Step 7: Update ledgers and commit**

Run:

```powershell
git diff --check -- docs/audit/2026-07-system-audit
git add -- docs/audit/2026-07-system-audit/06-admin-bot-ux.md docs/audit/2026-07-system-audit/00-map-and-index.md docs/audit/2026-07-system-audit/07-findings-backlog.md docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md
git commit -m "docs: audit admin bot ux"
```

Expected: one commit containing only audit docs.

---

### Task 8: Whole-Pass Synthesis And Verification

**Files:**
- Modify: `docs/audit/2026-07-system-audit/00-map-and-index.md`
- Modify: `docs/audit/2026-07-system-audit/07-findings-backlog.md`
- Modify: `docs/audit/2026-07-system-audit/08-decisions-and-improvement-ideas.md`

- [ ] **Step 1: Check all planned audit notes exist**

Run:

```powershell
Get-ChildItem -LiteralPath 'docs\audit\2026-07-system-audit' | Sort-Object Name | Select-Object Name,Length
```

Expected: files `00` through `08` exist and have non-zero length.

- [ ] **Step 2: Scan for unfinished markers and empty verdicts**

Run:

```powershell
Select-String -LiteralPath 'docs\audit\2026-07-system-audit\*.md' -Pattern 'T[O]DO|T[B]D|\?\?\?|not reviewed|not checked|not started' -CaseSensitive:$false
```

Expected: no matches remain for completed areas. If a scenario was intentionally deferred, replace `not checked` with `deferred` and record the reason in `00-map-and-index.md`.

- [ ] **Step 3: Deduplicate findings**

Review `07-findings-backlog.md`. Merge duplicate findings into the oldest relevant finding and add `Status: duplicate` only when preserving a separate historical entry is useful.

Expected: each open finding has one owner area, one severity, evidence, confidence, impact, and recommended next action.

- [ ] **Step 4: Separate product questions from defects**

Review `07-findings-backlog.md` and `08-decisions-and-improvement-ideas.md`.

Expected: product decisions such as runtime materiality config or targeted indexing ceilings are recorded as `needs product decision`, not as bugs.

- [ ] **Step 5: Build follow-up shortlist**

Add a final section to `00-map-and-index.md`:

```md
## Follow-Up Shortlist

| Rank | Item | Type | Source | Suggested Next Plan |
| --- | --- | --- | --- | --- |
```

Fill it with the highest-value follow-ups found during the audit. Use `Type` values: `fix`, `investigation`, `product decision`, `docs`, or `test coverage`.

- [ ] **Step 6: Run final markdown and git checks**

Run:

```powershell
git diff --check -- docs/audit/2026-07-system-audit
git status --short
```

Expected: no whitespace errors. `git status --short` should show only intended audit docs plus pre-existing unrelated untracked files.

- [ ] **Step 7: Commit whole-pass synthesis**

Run:

```powershell
git add -- docs/audit/2026-07-system-audit
git commit -m "docs: synthesize system audit"
```

Expected: final audit synthesis commit containing only `docs/audit/2026-07-system-audit/*`.

- [ ] **Step 8: Final response content**

Report:

- audit notes created;
- tests or runtime checks run;
- findings count by severity;
- decisions count by category;
- deferred scenarios and reasons;
- follow-up shortlist;
- knowledge files read;
- docs updated and why no `docs/knowledge/*` files changed.

---

## Plan Self-Review Checklist

- Spec coverage: tasks create all eight audit notes plus findings and decisions ledgers.
- Diagnostic boundary: every task edits only `docs/audit/2026-07-system-audit/*`.
- Scenario matrix: initialized in Task 1 and updated in Tasks 3, 5, 6, and 7.
- Section verdict: required by shared note contract and final synthesis scan.
- Evidence confidence: required by shared note contract and findings format.
- Whole-pass definition of done: covered in Task 8.
