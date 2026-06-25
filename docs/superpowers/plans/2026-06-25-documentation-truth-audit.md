# Documentation Truth Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Проверить новые walkthrough-документы на фактическую правду относительно кода, тестов и сохраненных jobs, а затем усилить их цифрами, правилами, примерами и честными статусами.

**Architecture:** Работа идет как документационный аудит, а не как переписывание продукта. Сначала создается truth-audit матрица с утверждениями и доказательствами, затем главы обновляются только там, где утверждение подтверждено кодом, тестом или реальным job output. Формулировки разделяются на `confirmed`, `partial`, `current limitation`, `future direction`.

**Tech Stack:** Markdown docs, TypeScript source, Vitest tests, ripgrep, git. Production code не меняется без отдельного решения.

---

## File Map

**Create:**
- `docs/project-walkthrough/18-documentation-truth-audit.md` - центральная таблица проверки утверждений: что написано, чем подтверждено, какой статус, что исправить.

**Modify:**
- `docs/project-walkthrough/README.md` - добавить ссылку на truth audit.
- `docs/project-walkthrough/06-check-modes-fast-deep-where-is-money.md` - уточнить фактическое взаимодействие FastCheck, DeepCheck и Where is money.
- `docs/project-walkthrough/07-unified-wallet-risk-plain-language.md` - добавить цифры и объяснить score/decision без технического шума.
- `docs/project-walkthrough/12-risk-logic-operational-rules.md` - добавить rules/floors/thresholds, подтвержденные кодом.
- `docs/project-walkthrough/10-check-lifecycle-plain-language.md` - проверить Telegram -> job -> worker -> result -> admin lifecycle.
- `docs/project-walkthrough/11-data-sources-and-coverage.md` - проверить coverage, partial, missing checks, provider limits.
- `docs/project-walkthrough/13-graph-visualization-plain-language.md` - проверить, что граф реально показывает, а что только planned.
- `docs/project-walkthrough/14-telegram-bot-plain-language.md` - проверить, что бот реально отправляет пользователю.
- `docs/project-walkthrough/08-admin-forensics-console-plain-language.md` - проверить, что админка реально хранит и показывает.
- `docs/project-walkthrough/15-limitations-and-honest-promises.md` - усилить честные ограничения.
- `docs/project-walkthrough/17-product-narrative.md` - отделить реализованное от будущего позиционирования.

**Primary Evidence Files:**
- `src/bot/createBot.ts`
- `src/check/whereIsMoneyCheck.ts`
- `src/check/deepForensicCheck.ts`
- `src/forensics/deepForensicJob.ts`
- `src/forensics/incomingDepositJob.ts`
- `src/risk/unifiedWalletRisk.ts`
- `src/risk/riskPolicyEngine.ts`
- `src/forensics/moneyOriginPolicy.ts`
- `src/forensics/moneyOriginOperationalAssessment.ts`
- `src/forensics/sourceBundleExposure.ts`
- `src/forensics/provenanceScoring.ts`
- `src/admin/forensicsGraph.ts`
- `src/admin/adminConsole.ts`

**Primary Tests:**
- `tests/bot/createBot.test.ts`
- `tests/check/whereIsMoneyCheck.test.ts`
- `tests/check/deepForensicCheck.test.ts`
- `tests/forensics/deepForensicJob.test.ts`
- `tests/forensics/incomingDepositJob.test.ts`
- `tests/risk/unifiedWalletRisk.test.ts`
- `tests/risk/riskPolicyEngine.test.ts`
- `tests/forensics/sourceBundleExposure.test.ts`
- `tests/forensics/moneyOriginPolicy.test.ts`
- `tests/forensics/moneyOriginOperationalAssessment.test.ts`
- `tests/admin/forensicsGraph.test.ts`
- `tests/admin/adminConsole.test.ts`

---

### Task 1: Create the Truth Audit Matrix

**Files:**
- Create: `docs/project-walkthrough/18-documentation-truth-audit.md`
- Modify: `docs/project-walkthrough/README.md`

- [ ] **Step 1: Read the docs that will be audited**

Run:

```powershell
Get-Content docs\project-walkthrough\README.md
Get-Content docs\project-walkthrough\06-check-modes-fast-deep-where-is-money.md
Get-Content docs\project-walkthrough\07-unified-wallet-risk-plain-language.md
Get-Content docs\project-walkthrough\12-risk-logic-operational-rules.md
Get-Content docs\project-walkthrough\10-check-lifecycle-plain-language.md
Get-Content docs\project-walkthrough\11-data-sources-and-coverage.md
Get-Content docs\project-walkthrough\13-graph-visualization-plain-language.md
Get-Content docs\project-walkthrough\14-telegram-bot-plain-language.md
Get-Content docs\project-walkthrough\08-admin-forensics-console-plain-language.md
Get-Content docs\project-walkthrough\15-limitations-and-honest-promises.md
Get-Content docs\project-walkthrough\17-product-narrative.md
```

Expected: all files exist and are readable.

- [ ] **Step 2: Create the audit document skeleton**

Add `docs/project-walkthrough/18-documentation-truth-audit.md` with this structure:

```markdown
# Documentation Truth Audit

## Purpose

This document checks whether the plain-language walkthrough accurately describes the current project.

Each claim gets one status:

- `confirmed` - supported by current code, tests, or saved job output.
- `partial` - directionally true, but wording must be narrower.
- `outdated` - docs describe behavior that changed.
- `future` - useful product direction, but not current behavior.
- `needs evidence` - likely true, but not yet tied to a code/test/job reference.

## Audit Rules

- Do not invent numbers.
- Prefer code and tests over memory.
- If a value is configurable, document where it comes from.
- If a rule is heuristic, say that it is a heuristic.
- If a mode only stores data for admin and does not show it in Telegram, say that.
- If a graph cannot prove source of funds, say that.

## Claim Matrix

| ID | Topic | Claim | Current docs | Evidence | Status | Numbers / rules | Action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C-001 | Check modes | FastCheck, DeepCheck, and Where is money are separate modes with different goals. | `06-check-modes...` | `src/bot/createBot.ts`, `src/forensics/deepForensicJob.ts`, tests | needs evidence | none yet | Verify and update wording. |

## Confirmed Numbers

| Area | Number / rule | Evidence | Notes |
| --- | --- | --- | --- |

## Partial Or Future Claims

| Claim | Why not fully confirmed | Safer wording |
| --- | --- | --- |

## Open Questions

| Question | Why it matters | Owner decision needed |
| --- | --- | --- |
```

- [ ] **Step 3: Add README link**

In `docs/project-walkthrough/README.md`, add this item after product narrative:

```markdown
13. [Documentation Truth Audit](./18-documentation-truth-audit.md) - проверка, какие утверждения в walkthrough подтверждены кодом, тестами и реальными jobs.
```

Renumber the following items.

- [ ] **Step 4: Verify markdown files are present**

Run:

```powershell
Test-Path docs\project-walkthrough\18-documentation-truth-audit.md
rg -n "18-documentation-truth-audit" docs\project-walkthrough\README.md
git diff --check
```

Expected:
- `True`
- README contains the new link
- `git diff --check` exits 0

- [ ] **Step 5: Commit the audit skeleton**

Run:

```powershell
git add docs/project-walkthrough/README.md docs/project-walkthrough/18-documentation-truth-audit.md
git commit -m "docs: add documentation truth audit"
```

Expected: commit succeeds.

---

### Task 2: Audit Check Modes and Mode Interactions

**Files:**
- Modify: `docs/project-walkthrough/18-documentation-truth-audit.md`
- Modify: `docs/project-walkthrough/06-check-modes-fast-deep-where-is-money.md`
- Modify: `docs/project-walkthrough/10-check-lifecycle-plain-language.md`
- Modify: `docs/project-walkthrough/14-telegram-bot-plain-language.md`

- [ ] **Step 1: Verify FastCheck, DeepCheck, and Where job creation**

Run:

```powershell
rg -n "fastCheckHints|saveAddressFastCheckJob|queueDeepForensicJob|queueWhereIsMoneyCheck|createQueuedAddressJob|address_fast_check|address_deep_check|where_is_money_check" src\bot\createBot.ts tests\bot\createBot.test.ts
```

Expected evidence to collect:
- FastCheck job is saved as `address_fast_check`.
- DeepCheck can receive `fastCheckHints`.
- Where is money is queued separately.
- Telegram started message should not necessarily show all FastCheck details.

- [ ] **Step 2: Verify worker behavior for DeepCheck and Where is money**

Run:

```powershell
rg -n "runWhereIsMoneyCheck|runDeepAddressForensicCheck|fastCheckHintsFromJob|whereIsMoneyReport|address_deep_check|where_is_money_check" src\forensics\deepForensicJob.ts tests\forensics\deepForensicJob.test.ts
```

Expected evidence to collect:
- `where_is_money_check` runs money origin logic.
- `address_deep_check` runs profile/context logic.
- DeepCheck can use FastCheck hints as input context.

- [ ] **Step 3: Update the claim matrix**

Add rows for these claims:

```markdown
| C-010 | Check modes | FastCheck is a bounded direct-neighborhood profile, not a full source-of-funds proof. | `06`, `14` | `src/bot/createBot.ts`, `src/admin/forensicsGraph.ts` | confirmed | direct counterparties and fastCheckTops | Keep wording. |
| C-011 | Check modes | DeepCheck can consume FastCheck hints, but FastCheck is not the single source of truth for DeepCheck. | `06` | `src/bot/createBot.ts`, `src/check/deepForensicCheck.ts` | confirmed | hints prioritize addresses | Clarify wording. |
| C-012 | Check modes | Where is money is the mode that tries to explain selected amount/source path. | `06`, `10` | `src/check/whereIsMoneyCheck.ts`, `src/forensics/deepForensicJob.ts` | confirmed | selected anchor / recent flow / drain episode | Keep wording. |
```

- [ ] **Step 4: Patch the mode docs**

In `06-check-modes-fast-deep-where-is-money.md`, add a short section:

```markdown
## How The Modes Share Data Today

FastCheck can create a small hint package for DeepCheck. This helps DeepCheck prioritize important neighbors, but DeepCheck still runs its own profile/context analysis.

Where is money does not depend on FastCheck as its proof engine. It runs source-of-funds logic around the selected amount, recent flow, or drain episode.

So the modes are connected operationally, but they should not be described as one big pipeline where FastCheck fully feeds everything else.
```

- [ ] **Step 5: Verify targeted tests**

Run:

```powershell
npx vitest run --configLoader bundle tests/bot/createBot.test.ts tests/forensics/deepForensicJob.test.ts
```

Expected: tests pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add docs/project-walkthrough/18-documentation-truth-audit.md docs/project-walkthrough/06-check-modes-fast-deep-where-is-money.md docs/project-walkthrough/10-check-lifecycle-plain-language.md docs/project-walkthrough/14-telegram-bot-plain-language.md
git commit -m "docs: verify check mode interactions"
```

Expected: commit succeeds.

---

### Task 3: Audit Risk Scores, Floors, Thresholds, and Decisions

**Files:**
- Modify: `docs/project-walkthrough/18-documentation-truth-audit.md`
- Modify: `docs/project-walkthrough/07-unified-wallet-risk-plain-language.md`
- Modify: `docs/project-walkthrough/12-risk-logic-operational-rules.md`
- Modify: `docs/project-walkthrough/15-limitations-and-honest-promises.md`

- [ ] **Step 1: Extract risk score bands and decision thresholds**

Run:

```powershell
rg -n "riskBand|riskLevel|finalDecision|userDecision|internalDecision|score >=|score <|DECLINE|REVIEW|ACCEPTABLE|60|85|95|45|35|55|70" src\risk src\forensics tests\risk tests\forensics tests\check -g "*.ts"
```

Expected evidence to collect:
- final decision rules;
- score floors;
- source bundle floors;
- hard evidence floors;
- coverage floors;
- caps on background context.

- [ ] **Step 2: Verify unified wallet risk behavior**

Run:

```powershell
npx vitest run --configLoader bundle tests/risk/unifiedWalletRisk.test.ts tests/risk/riskPolicyEngine.test.ts tests/forensics/sourceBundleExposure.test.ts
```

Expected: tests pass and provide concrete examples for docs.

- [ ] **Step 3: Add confirmed numbers table**

In `18-documentation-truth-audit.md`, fill `Confirmed Numbers` with confirmed rows like:

```markdown
| Source bundle risky-label share | `riskyLabelShare >= 10%` can create high floor | `docs/project-walkthrough/04...`, `src/forensics/sourceBundleExposure.ts`, tests | Use only if confirmed in code. |
| Unknown contract share | `unknownContractShare >= 50%` can create medium floor | `src/forensics/sourceBundleExposure.ts`, tests | Use only if confirmed in code. |
| User decision threshold | User-facing decision changes at the confirmed threshold | `src/risk/*`, tests | Write exact threshold only after confirming code. |
```

Replace any row whose number is not confirmed with `needs evidence`.

- [ ] **Step 4: Update risk docs with a plain formula**

Add to `07-unified-wallet-risk-plain-language.md`:

```markdown
## Simple Score Model

The final score is not only an average of modes.

In plain language:

```text
final score =
available context
+ strongest hard/policy floor
- allowed dampening for trusted or false-positive context
```

The important rule: a strong fact should not disappear just because other layers look quiet.
```

Then add only confirmed examples from the audit table.

- [ ] **Step 5: Update operational risk rules**

In `12-risk-logic-operational-rules.md`, add a section:

```markdown
## Numeric Rules We Can Safely Say

This section lists only rules confirmed by code or tests.

| Rule | What it means | Evidence |
| --- | --- | --- |
```

Fill it with confirmed rows only.

- [ ] **Step 6: Verify docs and targeted tests**

Run:

```powershell
git diff --check
npx vitest run --configLoader bundle tests/risk/unifiedWalletRisk.test.ts tests/risk/riskPolicyEngine.test.ts tests/forensics/sourceBundleExposure.test.ts
```

Expected: diff check exits 0 and tests pass.

- [ ] **Step 7: Commit**

Run:

```powershell
git add docs/project-walkthrough/18-documentation-truth-audit.md docs/project-walkthrough/07-unified-wallet-risk-plain-language.md docs/project-walkthrough/12-risk-logic-operational-rules.md docs/project-walkthrough/15-limitations-and-honest-promises.md
git commit -m "docs: ground risk rules in code"
```

Expected: commit succeeds.

---

### Task 4: Audit Data Sources, Coverage, and Partial Results

**Files:**
- Modify: `docs/project-walkthrough/18-documentation-truth-audit.md`
- Modify: `docs/project-walkthrough/11-data-sources-and-coverage.md`
- Modify: `docs/project-walkthrough/15-limitations-and-honest-promises.md`

- [ ] **Step 1: Verify provider and budget language**

Run:

```powershell
rg -n "providerBudget|coverage|partial|missingChecks|exhausted|data_budget_exhausted|elapsedTimeBudgetMs|transferCallBudget|contractCallBudget|approvalCallBudget|providerCallBudget" src tests docs\project-walkthrough -g "*.ts" -g "*.md"
```

Expected evidence to collect:
- what partial means;
- where provider budgets are recorded;
- when missing checks are shown;
- when coverage limits can influence risk.

- [ ] **Step 2: Verify coverage tests**

Run:

```powershell
npx vitest run --configLoader bundle tests/check/whereIsMoneyCheck.test.ts tests/forensics/sourceBundleExposure.test.ts tests/forensics/coverageDebugReport.test.ts
```

Expected: tests pass.

- [ ] **Step 3: Update coverage docs**

In `11-data-sources-and-coverage.md`, add:

```markdown
## How To Read Partial

`partial` does not mean "bad" by itself.

It means the job produced useful evidence, but at least one part of the intended check did not fully complete or did not have enough provider/data coverage.

The safe reading is:

- use confirmed facts;
- do not treat missing data as clean;
- show which checks are missing;
- avoid claiming full source proof when coverage is limited.
```

- [ ] **Step 4: Update audit rows**

Add rows for:
- provider budget visibility;
- missing checks;
- unresolved boundary floor;
- partial job interpretation;
- unknown/n/a interpretation.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
git diff --check
npx vitest run --configLoader bundle tests/check/whereIsMoneyCheck.test.ts tests/forensics/sourceBundleExposure.test.ts tests/forensics/coverageDebugReport.test.ts
git add docs/project-walkthrough/18-documentation-truth-audit.md docs/project-walkthrough/11-data-sources-and-coverage.md docs/project-walkthrough/15-limitations-and-honest-promises.md
git commit -m "docs: clarify coverage and partial results"
```

Expected: commands succeed.

---

### Task 5: Audit Graph, Admin, and Telegram Claims

**Files:**
- Modify: `docs/project-walkthrough/18-documentation-truth-audit.md`
- Modify: `docs/project-walkthrough/13-graph-visualization-plain-language.md`
- Modify: `docs/project-walkthrough/08-admin-forensics-console-plain-language.md`
- Modify: `docs/project-walkthrough/14-telegram-bot-plain-language.md`

- [ ] **Step 1: Verify graph data model and UI modes**

Run:

```powershell
rg -n "fastCheckTops|missingChecks|bundle|boundary|peer|timeline|txLabelMode|walletLabelMode|address_fast_check|address_deep_check|where_is_money_check|incoming_deposit_check" src\admin\forensicsGraph.ts src\admin\adminConsole.ts tests\admin\forensicsGraph.test.ts tests\admin\adminConsole.test.ts
```

Expected evidence to collect:
- what graph has nodes/edges for;
- where bundles are artificial groups;
- how labels and important/all modes work;
- what graph can and cannot prove.

- [ ] **Step 2: Verify Telegram output claims**

Run:

```powershell
rg -n "formatWhereIsMoneyReport|formatAddressCheckStarted|formatIncomingDeposit|risk_only|digest|paused|realtime|address_fast_check|address_deep_check" src\bot src\alerts tests\bot tests\alerts -g "*.ts"
```

Expected evidence to collect:
- what user sees in Telegram;
- what is admin-only;
- which details are intentionally not shown to Telegram users.

- [ ] **Step 3: Run targeted admin and bot tests**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/bot/createBot.test.ts tests/alerts/formatters.test.ts
```

Expected: tests pass.

- [ ] **Step 4: Update graph docs**

In `13-graph-visualization-plain-language.md`, add a section:

```markdown
## What The Graph Can Prove

The graph can show observed transfers, inferred context, grouped bundles, service boundaries, peer links, amounts, timestamps, and gaps when those fields exist in the job result.

The graph should not be read as automatic proof that every visible neighbor is the source of funds.

For DeepCheck, the graph is mainly profile/context.
For Where is money and incoming deposit checks, the graph is closer to a source/path trace.
```

- [ ] **Step 5: Update admin and Telegram docs**

In `08-admin-forensics-console-plain-language.md`, add:

```markdown
## Admin vs Telegram

Telegram gives the short operational answer.

Admin keeps the investigation evidence: jobs, statuses, graph data, raw summaries, missing checks, bundles, boundary stops, and history.
```

In `14-telegram-bot-plain-language.md`, add:

```markdown
## What Telegram Does Not Show

Telegram does not try to show the full forensic graph or every raw signal.

Those details belong in admin, because they are review material, not a short user alert.
```

- [ ] **Step 6: Verify and commit**

Run:

```powershell
git diff --check
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/bot/createBot.test.ts tests/alerts/formatters.test.ts
git add docs/project-walkthrough/18-documentation-truth-audit.md docs/project-walkthrough/13-graph-visualization-plain-language.md docs/project-walkthrough/08-admin-forensics-console-plain-language.md docs/project-walkthrough/14-telegram-bot-plain-language.md
git commit -m "docs: verify graph admin and telegram claims"
```

Expected: commands succeed.

---

### Task 6: Audit Product Narrative Against Current Reality

**Files:**
- Modify: `docs/project-walkthrough/18-documentation-truth-audit.md`
- Modify: `docs/project-walkthrough/17-product-narrative.md`
- Modify: `docs/project-walkthrough/15-limitations-and-honest-promises.md`

- [ ] **Step 1: Extract product claims from narrative**

Run:

```powershell
rg -n "Мы|может|долж|alert|risk|monitoring|approval|graph|evidence|AML|API|future|реальн|не стоит|не обещ" docs\project-walkthrough\17-product-narrative.md docs\project-walkthrough\15-limitations-and-honest-promises.md
```

Expected: list of strong product claims to classify.

- [ ] **Step 2: Classify narrative claims**

In `18-documentation-truth-audit.md`, add rows for:
- read-only monitoring;
- Telegram alert layer;
- admin evidence layer;
- graph visualization;
- risk scoring;
- approval guard;
- broader AML/API claims;
- multi-chain/future claims;
- no fund recovery;
- no guaranteed identity attribution.

- [ ] **Step 3: Add "Current vs Future" section**

In `17-product-narrative.md`, add:

```markdown
## Current vs Future

### Current

- TRON/TRC20 USDT focus.
- Telegram bot for monitored wallets and manual checks.
- Forensic jobs for address, source-of-funds, incoming deposits, and approvals.
- Admin console for jobs, evidence, graph review, and history.
- Risk scoring with explainable reasons and limitations.

### Future Direction

- Commercial AML integrations.
- Wider multi-chain coverage.
- API/webhook product layer.
- Case management and export/reporting workflows.

The future direction should not be sold as already complete.
```

- [ ] **Step 4: Verify and commit**

Run:

```powershell
git diff --check
git add docs/project-walkthrough/18-documentation-truth-audit.md docs/project-walkthrough/17-product-narrative.md docs/project-walkthrough/15-limitations-and-honest-promises.md
git commit -m "docs: align product narrative with current reality"
```

Expected: commit succeeds.

---

### Task 7: Final Documentation QA

**Files:**
- Modify if needed: any touched docs from Tasks 1-6.

- [ ] **Step 1: Run placeholder and contradiction scan**

Run:

```powershell
rg -n "TODO|TBD|FIXME|заглуш|потом дописать|дописать|probably|maybe|should probably" docs\project-walkthrough
```

Expected: no accidental placeholders. If historical docs contain intentional old wording, record it in the audit rather than editing unrelated material.

- [ ] **Step 2: Run docs link/path sanity check**

Run:

```powershell
rg -n "\]\(\./" docs\project-walkthrough\README.md docs\project-walkthrough\*.md
Test-Path docs\project-walkthrough\18-documentation-truth-audit.md
```

Expected:
- internal docs links exist;
- audit doc exists.

- [ ] **Step 3: Run full tests**

Run:

```powershell
npm test
```

Expected:
- all Vitest tests pass.

- [ ] **Step 4: Final git status**

Run:

```powershell
git status --short --branch
git log --oneline -8
```

Expected:
- clean working tree;
- recent commits include all audit documentation commits.

- [ ] **Step 5: Push to master**

Run:

```powershell
git push origin master
```

Expected:
- `master -> master` push succeeds.

---

## Done Criteria

This plan is complete only when:

- `docs/project-walkthrough/18-documentation-truth-audit.md` exists.
- Every major claim in docs `06`, `07`, `08`, `10`, `11`, `12`, `13`, `14`, `15`, `17` has an audit status.
- Risk docs include confirmed numeric rules and no invented thresholds.
- Product narrative separates current reality from future direction.
- Mode interaction docs clearly say how FastCheck, DeepCheck, and Where is money interact today.
- Graph docs clearly separate profile/context graphs from source/path traces.
- Telegram docs clearly separate user alerts from admin-only evidence.
- `npm test` passes.
- Changes are committed and pushed to `origin/master`.
