---
status: current
last_verified: 2026-07-04
owner_area: docs
code_refs:
  - package.json
  - src/index.ts
  - src/config.ts
  - src/admin/adminConsole.ts
  - src/admin/adminServer.ts
  - tests/admin/adminConsole.test.ts
  - tests/admin/adminServer.test.ts
supersedes:
  - docs/project-walkthrough/16-qa-and-release-checks.md
---

# Runbooks

## Read Russian Markdown On Windows

PowerShell may show UTF-8 Russian text as mojibake. Use:

```powershell
Get-Content -Encoding UTF8 docs\knowledge\AGENT_BRIEF.md
```

or:

```powershell
rg -n "Where is money" docs/knowledge
```

## Start Bot And Admin

From the repository or worktree:

```powershell
$env:DOTENV_CONFIG_PATH='..\..\.env'; npm run dev
```

Admin should start at:

```text
http://127.0.0.1:8787/admin/forensics
```

## Verify Admin HTML Is Fresh

```powershell
@'
const res = await fetch("http://127.0.0.1:8787/admin/forensics");
const html = await res.text();
console.log(res.status, html.includes("Strict benchmark"), html.includes("/admin/api/forensic-jobs"));
'@ | node --input-type=module
```

Expected output should include status `200` and `true true`. Do not use the old
page-name marker from earlier runbooks; it is not a stable current HTML marker.

## Export Static Admin Snapshot

Use this when you need to send a historical, read-only Admin forensics snapshot
as a single HTML file:

```powershell
npm run admin:snapshot
```

The file is written to `artifacts/admin-snapshots/` and can be opened directly
in a browser. It embeds the current Admin shell, captured job/graph API JSON,
Wallet Intelligence list/detail JSON, and role-mark assets. It is read-only;
live refresh and mutations are not part of the snapshot.

To capture a narrower case:

```powershell
node --import tsx scripts/exportAdminSnapshot.ts --address T...
node --import tsx scripts/exportAdminSnapshot.ts --job job-id
```

## Run Tests

```powershell
npm test
npm run typecheck
```

For focused Admin tests:

```powershell
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
```

## Check Recent Jobs

Use the database connection from `.env`:

```powershell
@'
import dotenv from "dotenv";
import pg from "pg";
dotenv.config({ path: "../../.env" });
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

## Old DB Result Or Fresh Run

Check `created_at`, `requested_by`, and job id. A graph can look new while
showing an old completed job from the database.

## Check Workers Are Running

Admin can be alive even when the currently selected graph is an old completed
job. Queue a small forensic job or inspect recent `queued` rows; they should
move to `running`/`completed` after the startup schedule delay. The background
schedule starts independently of Telegram bot `onStart`, so Admin-only local
runs should still process forensic queues.

## Check TronScan Key Pool At Startup

Look for `tronscan_scheduler_configured` in runtime logs. Important fields:

- `apiKeyCount`;
- `apiKeyGroupCount`;
- `maxInFlight`;
- `rateLimitedRequests`;
- `accountGroupCooldownUntilMs`.
