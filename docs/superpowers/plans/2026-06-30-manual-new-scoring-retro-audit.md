# Manual New Scoring Retro Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a manual research audit for every unique saved forensic subject, comparing old saved scores with the new Manual Scoring Matrix v1.

**Architecture:** This is a documentation/research execution, not a production code change. Use local Postgres only as the evidence source, extract saved job summaries, manually apply the approved matrix, then write one markdown report under `docs/research`.

**Tech Stack:** PowerShell, Node.js with `tsx`, local Postgres via `pg`, existing markdown docs.

---

### Task 1: Extract Saved Forensic Evidence

**Files:**
- Read: `forensic_check_jobs` from local Postgres.
- Create temporary artifact only if useful: `tmp/manual-new-scoring-retro-audit-source.json`

- [ ] **Step 1: Query all unique subjects newest to oldest**

Run:

```powershell
@'
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const result = await client.query(`
    select
      subject_address,
      count(*)::int as job_count,
      array_agg(distinct kind order by kind) as kinds,
      max(created_at) as latest_created_at,
      max(completed_at) as latest_completed_at
    from forensic_check_jobs
    group by subject_address
    order by latest_created_at desc, subject_address
  `);
  await writeFile('tmp/manual-new-scoring-retro-audit-source.json', `${JSON.stringify({ subjects: result.rows }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ subjectCount: result.rows.length }, null, 2));
} finally {
  await client.end();
}
'@ | node --import tsx
```

Expected: output reports `subjectCount: 31`.

- [ ] **Step 2: Extract detailed saved jobs**

Run:

```powershell
@'
import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';

const source = JSON.parse(await readFile('tmp/manual-new-scoring-retro-audit-source.json', 'utf8'));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const subjects = [];
  for (const subject of source.subjects) {
    const jobs = await client.query(`
      select id, kind, status, subject_address, created_at, completed_at, result_json, progress_json
      from forensic_check_jobs
      where subject_address = $1
      order by created_at desc, id
    `, [subject.subject_address]);
    subjects.push({ ...subject, jobs: jobs.rows });
  }
  await writeFile('tmp/manual-new-scoring-retro-audit-jobs.json', `${JSON.stringify({ subjects }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ subjectCount: subjects.length, jobCount: subjects.reduce((sum, item) => sum + item.jobs.length, 0) }, null, 2));
} finally {
  await client.end();
}
'@ | node --import tsx
```

Expected: output reports `subjectCount: 31` and `jobCount: 73`.

### Task 2: Manually Score Subjects

**Files:**
- Read: `tmp/manual-new-scoring-retro-audit-jobs.json`
- Read: `docs/superpowers/specs/2026-06-30-manual-new-scoring-retro-audit-design.md`
- Create: `docs/research/2026-06-30-manual-new-scoring-retro-audit.md`

- [ ] **Step 1: For each subject, identify old saved score and evidence**

For each subject, inspect saved jobs and record:

```text
subject address
job kinds and dates
latest saved score and decision
hard evidence if any
source-policy evidence if any
service-linked pattern evidence if any
behavior-only evidence if any
coverage status and caveats
dampener/operational/clean context if any
```

- [ ] **Step 2: Apply Manual Scoring Matrix v1**

For each subject:

```text
1. Select the winning evidence row.
2. Choose score inside that row's band.
3. Apply only in-band modifiers.
4. Do not let behavior-only exceed 59.
5. Do not let coverage uncertainty create risk by itself.
6. Write one concise reason plus detailed notes.
```

### Task 3: Write Report

**Files:**
- Create: `docs/research/2026-06-30-manual-new-scoring-retro-audit.md`

- [ ] **Step 1: Write report header and method**

Include:

```markdown
# Manual New Scoring Retro Audit, 2026-06-30

Purpose: manually replay saved forensic subjects against Manual Scoring Matrix v1.

This is not a production rerun and not a calibrated probability model.
```

- [ ] **Step 2: Write newest-to-oldest summary table**

Columns:

```markdown
| # | Subject | Saved jobs | Latest saved score | New manual score | Delta | Manual decision | Evidence class | Short reason |
```

- [ ] **Step 3: Write per-subject details**

For each subject:

```markdown
### N. `subject`

Saved evidence:
- ...

Old saved result:
- ...

Manual matrix row:
- ...

Manual score:
- ...

Reasoning:
- ...

Caveats:
- ...
```

### Task 4: Verify and Commit

**Files:**
- Verify: `docs/research/2026-06-30-manual-new-scoring-retro-audit.md`

- [ ] **Step 1: Verify subject coverage**

Run:

```powershell
Select-String -Path docs\research\2026-06-30-manual-new-scoring-retro-audit.md -Pattern '^### [0-9]+\. `' | Measure-Object
```

Expected: count is `31`.

- [ ] **Step 2: Check markdown whitespace**

Run:

```powershell
git diff --check -- docs\research\2026-06-30-manual-new-scoring-retro-audit.md
```

Expected: no output.

- [ ] **Step 3: Commit only the report and plan if needed**

Run:

```powershell
git add -- docs/research/2026-06-30-manual-new-scoring-retro-audit.md docs/superpowers/plans/2026-06-30-manual-new-scoring-retro-audit.md
git commit -m "docs: add manual scoring retro audit"
```

Expected: commit succeeds. Do not stage unrelated files such as `tests/admin/adminConsole.test.ts` or `tmp/`.
