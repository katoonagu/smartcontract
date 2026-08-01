# Project Knowledge Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the repo-native `docs/knowledge` source of truth and make agents read/update it through `AGENTS.md`.

**Architecture:** Add focused markdown files under `docs/knowledge`, each with metadata and a clear responsibility. Update `AGENTS.md` so future non-trivial work starts from `AGENT_BRIEF.md`, verifies code, and reports documentation updates.

**Tech Stack:** Markdown, git, existing repository documentation.

---

### Task 1: Knowledge Base Files

**Files:**
- Create: `docs/knowledge/AGENT_BRIEF.md`
- Create: `docs/knowledge/00-index.md`
- Create: `docs/knowledge/01-product-principles.md`
- Create: `docs/knowledge/02-check-modes.md`
- Create: `docs/knowledge/03-job-lifecycle.md`
- Create: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Create: `docs/knowledge/05-where-is-money-and-incoming.md`
- Create: `docs/knowledge/06-deepcheck.md`
- Create: `docs/knowledge/07-risk-scoring-matrix.md`
- Create: `docs/knowledge/08-admin-and-bot-ux.md`
- Create: `docs/knowledge/09-current-decisions.md`
- Create: `docs/knowledge/10-open-problems.md`
- Create: `docs/knowledge/11-glossary.md`
- Create: `docs/knowledge/12-runbooks.md`
- Create: `docs/knowledge/13-agent-observations.md`

- [x] **Step 1: Create the files**

Use the approved design in `docs/superpowers/specs/2026-07-03-project-knowledge-workflow-design.md`.

- [x] **Step 2: Verify metadata**

Run:

```powershell
rg -n "^---$|^status:|^last_verified:|^owner_area:|^code_refs:|^supersedes:" docs/knowledge
```

Expected: each knowledge file has frontmatter with `status`, `last_verified`, `owner_area`, `code_refs`, and `supersedes`.

### Task 2: Agent Rule

**Files:**
- Modify: `AGENTS.md`

- [x] **Step 1: Add Project Knowledge Workflow**

Append the approved workflow block from the design spec.

- [x] **Step 2: Verify rule exists**

Run:

```powershell
rg -n "Project Knowledge Workflow|AGENT_BRIEF|Knowledge docs are product truth" AGENTS.md
```

Expected: all three strings are present.

### Task 3: Self Review And Commit

- [x] **Step 1: Scan for placeholders**

Run:

```powershell
rg -n "TBD|TODO|FIXME|placeholder|\\?\\?\\?" docs/knowledge AGENTS.md
```

Expected: no matches.

- [x] **Step 2: Review diff**

Run:

```powershell
git diff -- docs/knowledge AGENTS.md docs/superpowers/plans/2026-07-03-project-knowledge-workflow.md
```

- [x] **Step 3: Commit**

Run:

```powershell
git add docs/knowledge AGENTS.md docs/superpowers/plans/2026-07-03-project-knowledge-workflow.md
git commit -m "docs: add project knowledge workflow"
```
