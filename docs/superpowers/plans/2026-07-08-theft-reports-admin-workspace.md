# Theft Reports Admin Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Russian Admin workspace for managing preliminary theft reports from the Telegram `Сообщить о краже` flow.

**Architecture:** Extend the existing `theft_reports` row with internal admin state, expose it through the existing Admin HTTP server, and render a third Admin workspace inside the current `adminConsoleHtml()` shell. Bot status remains separate from internal admin status, and Admin status changes do not notify Telegram users.

**Tech Stack:** TypeScript, PostgreSQL migrations, Node HTTP server, inline Admin HTML/CSS/JS, Vitest.

---

## Scope Check

This plan implements one workspace only: `Заявки о краже`. It does not add document uploads, event history, Telegram notifications, real deposit monitoring, or forensic job creation from theft reports.

Before executing, run:

```powershell
git status --short
```

The repository may contain unrelated dirty Admin files. Preserve those changes. Stage commits with explicit file paths only.

## File Structure

- Create `migrations/030_theft_report_admin_state.sql`
  Adds internal Admin workflow columns and a check constraint to `theft_reports`.

- Modify `src/storage/repositories.ts`
  Extends `TheftReport`, adds `TheftReportAdminStatus`, list input type, parsing, mapping, list, and update functions.

- Modify `tests/storage/repositories.test.ts`
  Covers mapping, list filters/search, admin update, and invalid status rejection.

- Modify `src/admin/adminServer.ts`
  Adds optional theft-report dependencies, query/body parsing, list/detail/update routes.

- Modify `src/admin/adminRuntime.ts`
  Carries theft-report dependencies through `maybeStartAdminDashboard`.

- Modify `src/index.ts`
  Wires repository functions into the Admin dashboard startup.

- Modify `tests/admin/adminServer.test.ts`
  Covers route shell, API list/detail/update, validation, auth, and unconfigured dependency handling.

- Modify `src/admin/adminConsole.ts`
  Adds the Russian workspace shell, filters, queue, selected card, internal status/note save, copy, and links.

- Modify `tests/admin/adminConsole.test.ts`
  Covers nav/workspace markers, Russian labels, endpoint usage, PATCH behavior, and absence of a forensic-job launcher.

- Modify `docs/knowledge/08-admin-and-bot-ux.md`
  Documents the new Admin workspace behavior.

---

### Task 1: Add Storage Model And Migration

**Files:**
- Create: `migrations/030_theft_report_admin_state.sql`
- Modify: `src/storage/repositories.ts`
- Test: `tests/storage/repositories.test.ts`

- [ ] **Step 1: Write failing storage tests**

In `tests/storage/repositories.test.ts`, extend the import from `../../src/storage/repositories`:

```typescript
  listTheftReports,
  updateTheftReportAdminState,
```

Update `theftReportRow` so existing theft-report tests use the new columns:

```typescript
const theftReportRow = {
  id: "report-1",
  telegram_user_id: "42",
  tx_hash: "a".repeat(64),
  victim_address: "TSender111111111111111111111111111111",
  reported_scam_address: "TReceiver11111111111111111111111111111",
  amount_raw: "123456789",
  amount_usdt: "123.456789",
  comment: null,
  status: "draft",
  deposit_address: "T999999999999999999999999999999999",
  deposit_amount_usdt: "1000",
  admin_status: "new",
  admin_note: null,
  admin_updated_at: null,
  created_at: theftReportCreatedAt,
  updated_at: theftReportCreatedAt
};
```

Inside `describe("theft report repositories", () => { ... })`, append:

```typescript
  it("maps admin state fields on theft reports", async () => {
    const adminUpdatedAt = new Date("2026-07-08T10:00:00.000Z");
    const { db } = createMockDb(1, [{
      ...theftReportRow,
      admin_status: "in_progress",
      admin_note: "Ждем документы от пользователя",
      admin_updated_at: adminUpdatedAt
    }]);

    const report = await getTheftReport(db, "report-1");

    expect(report).toMatchObject({
      id: "report-1",
      adminStatus: "in_progress",
      adminNote: "Ждем документы от пользователя",
      adminUpdatedAt
    });
  });

  it("lists theft reports with admin, bot, and text filters", async () => {
    const { db, queries } = createMockDb(1, [{
      ...theftReportRow,
      admin_status: "awaiting_documents",
      status: "documents_requested",
      admin_note: "Проверить заявление"
    }]);

    const reports = await listTheftReports(db, {
      limit: 20,
      offset: 5,
      adminStatus: "awaiting_documents",
      botStatus: "documents_requested",
      query: "TReceiver"
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      adminStatus: "awaiting_documents",
      status: "documents_requested"
    });
    expect(compactSql(queries[0].sql)).toContain("from theft_reports");
    expect(compactSql(queries[0].sql)).toContain("admin_status = $1");
    expect(compactSql(queries[0].sql)).toContain("status = $2");
    expect(compactSql(queries[0].sql)).toContain("reported_scam_address ilike $3");
    expect(compactSql(queries[0].sql)).toContain("limit $4 offset $5");
    expect(queries[0].params).toEqual([
      "awaiting_documents",
      "documents_requested",
      "%TReceiver%",
      20,
      5
    ]);
  });

  it("updates theft report admin state without changing bot status fields", async () => {
    const adminUpdatedAt = new Date("2026-07-08T10:00:00.000Z");
    const { db, queries } = createMockDb(1, [{
      ...theftReportRow,
      admin_status: "escalated",
      admin_note: "Передано юристу",
      admin_updated_at: adminUpdatedAt
    }]);

    const report = await updateTheftReportAdminState(db, {
      id: "report-1",
      adminStatus: "escalated",
      adminNote: "  Передано юристу  "
    });

    expect(report).toMatchObject({
      adminStatus: "escalated",
      adminNote: "Передано юристу",
      status: "draft"
    });
    expect(compactSql(queries[0].sql)).toContain("set admin_status = $2");
    expect(compactSql(queries[0].sql)).toContain("admin_note = $3");
    expect(compactSql(queries[0].sql)).not.toContain("status = $");
    expect(queries[0].params).toEqual(["report-1", "escalated", "Передано юристу"]);
  });

  it("rejects invalid theft report admin status before querying", async () => {
    const { db, queries } = createMockDb();

    await expect(updateTheftReportAdminState(db, {
      id: "report-1",
      adminStatus: "paid" as never,
      adminNote: "bad status"
    })).rejects.toThrow("Invalid theft report admin status");

    expect(queries).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm test -- tests/storage/repositories.test.ts
```

Expected: fail with TypeScript/import errors for missing `listTheftReports` and `updateTheftReportAdminState`, or missing `adminStatus` fields.

- [ ] **Step 3: Add migration**

Create `migrations/030_theft_report_admin_state.sql`:

```sql
alter table theft_reports
  add column if not exists admin_status text not null default 'new',
  add column if not exists admin_note text,
  add column if not exists admin_updated_at timestamptz;

alter table theft_reports drop constraint if exists theft_reports_admin_status_check;
alter table theft_reports
  add constraint theft_reports_admin_status_check
  check (admin_status in (
    'new',
    'awaiting_payment',
    'awaiting_documents',
    'in_progress',
    'escalated',
    'closed',
    'cancelled'
  ));

create index if not exists theft_reports_admin_status_updated_idx
  on theft_reports(admin_status, updated_at desc);
```

- [ ] **Step 4: Extend repository types and parsing**

In `src/storage/repositories.ts`, after `export type TheftReportStatus = ...`, add:

```typescript
export type TheftReportAdminStatus =
  | "new"
  | "awaiting_payment"
  | "awaiting_documents"
  | "in_progress"
  | "escalated"
  | "closed"
  | "cancelled";
```

Extend `TheftReport`:

```typescript
export type TheftReport = {
  id: string;
  telegramUserId: string;
  txHash: string;
  victimAddress: string;
  reportedScamAddress: string;
  amountRaw: string;
  amountUsdt: string;
  comment: string | null;
  status: TheftReportStatus;
  depositAddress: string | null;
  depositAmountUsdt: string;
  adminStatus: TheftReportAdminStatus;
  adminNote: string | null;
  adminUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
```

Add input types after `TheftReportDraftInput`:

```typescript
export type ListTheftReportsInput = {
  limit?: number;
  offset?: number;
  adminStatus?: TheftReportAdminStatus;
  botStatus?: TheftReportStatus;
  query?: string;
};

export type UpdateTheftReportAdminStateInput = {
  id: string;
  adminStatus: TheftReportAdminStatus;
  adminNote: string;
};
```

Near `const theftReportStatuses = ...`, add:

```typescript
const theftReportAdminStatuses = new Set<TheftReportAdminStatus>([
  "new",
  "awaiting_payment",
  "awaiting_documents",
  "in_progress",
  "escalated",
  "closed",
  "cancelled"
]);
```

After `parseTheftReportStatus`, add:

```typescript
function parseTheftReportAdminStatus(value: string): TheftReportAdminStatus {
  if (!theftReportAdminStatuses.has(value as TheftReportAdminStatus)) {
    throw new Error(`Invalid theft report admin status from database: ${value}`);
  }
  return value as TheftReportAdminStatus;
}
```

- [ ] **Step 5: Update theft report mapping and select columns**

Before `function mapTheftReportRow`, add:

```typescript
const theftReportColumns = [
  "id",
  "telegram_user_id",
  "tx_hash",
  "victim_address",
  "reported_scam_address",
  "amount_raw",
  "amount_usdt",
  "comment",
  "status",
  "deposit_address",
  "deposit_amount_usdt",
  "admin_status",
  "admin_note",
  "admin_updated_at",
  "created_at",
  "updated_at"
].join(", ");
```

Replace `mapTheftReportRow` with:

```typescript
function mapTheftReportRow(row: Record<string, any>): TheftReport {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    txHash: row.tx_hash,
    victimAddress: row.victim_address,
    reportedScamAddress: row.reported_scam_address,
    amountRaw: row.amount_raw,
    amountUsdt: row.amount_usdt,
    comment: row.comment ?? null,
    status: parseTheftReportStatus(row.status),
    depositAddress: row.deposit_address ?? null,
    depositAmountUsdt: row.deposit_amount_usdt,
    adminStatus: parseTheftReportAdminStatus(row.admin_status ?? "new"),
    adminNote: row.admin_note ?? null,
    adminUpdatedAt: row.admin_updated_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
```

In existing theft-report repository SQL, replace repeated returning/select column lists with:

```typescript
returning ${theftReportColumns}
```

and:

```typescript
select ${theftReportColumns}
from theft_reports
```

- [ ] **Step 6: Add list and admin update repository functions**

After `getTheftReport`, add:

```typescript
export async function listTheftReports(db: Db, input: ListTheftReportsInput = {}): Promise<TheftReport[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (input.adminStatus) {
    parseTheftReportAdminStatus(input.adminStatus);
    params.push(input.adminStatus);
    conditions.push(`admin_status = $${params.length}`);
  }

  if (input.botStatus) {
    parseTheftReportStatus(input.botStatus);
    params.push(input.botStatus);
    conditions.push(`status = $${params.length}`);
  }

  const query = input.query?.trim();
  if (query) {
    params.push(`%${query}%`);
    const index = params.length;
    conditions.push(`(
      id ilike $${index}
      or telegram_user_id ilike $${index}
      or tx_hash ilike $${index}
      or victim_address ilike $${index}
      or reported_scam_address ilike $${index}
      or coalesce(comment, '') ilike $${index}
      or coalesce(admin_note, '') ilike $${index}
    )`);
  }

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  params.push(limit, offset);
  const limitIndex = params.length - 1;
  const offsetIndex = params.length;
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";

  const result = await db.query(
    `select ${theftReportColumns}
     from theft_reports
     ${where}
     order by coalesce(admin_updated_at, updated_at) desc, created_at desc
     limit $${limitIndex} offset $${offsetIndex}`,
    params
  );
  return result.rows.map(mapTheftReportRow);
}

export async function updateTheftReportAdminState(
  db: Db,
  input: UpdateTheftReportAdminStateInput
): Promise<TheftReport | null> {
  parseTheftReportAdminStatus(input.adminStatus);
  const adminNote = input.adminNote.trim().slice(0, 2000);
  const result = await db.query(
    `update theft_reports
     set admin_status = $2,
       admin_note = $3,
       admin_updated_at = now(),
       updated_at = now()
     where id = $1
     returning ${theftReportColumns}`,
    [input.id, input.adminStatus, adminNote]
  );
  return result.rows[0] ? mapTheftReportRow(result.rows[0]) : null;
}
```

- [ ] **Step 7: Run storage tests**

Run:

```powershell
npm test -- tests/storage/repositories.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit storage task**

Run:

```powershell
git add -- migrations/030_theft_report_admin_state.sql src/storage/repositories.ts tests/storage/repositories.test.ts
git commit -m "feat: add theft report admin state storage"
```

---

### Task 2: Add Admin API And Runtime Wiring

**Files:**
- Modify: `src/admin/adminServer.ts`
- Modify: `src/admin/adminRuntime.ts`
- Modify: `src/index.ts`
- Test: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Write failing Admin server tests**

In `tests/admin/adminServer.test.ts`, update the repository type import:

```typescript
import type { ForensicCheckJob, TheftReport } from "../../src/storage/repositories";
```

Add this helper after `job(...)`:

```typescript
function theftReport(overrides: Partial<TheftReport> = {}): TheftReport {
  return {
    id: "report-1",
    telegramUserId: "42",
    txHash: "a".repeat(64),
    victimAddress: "TSender111111111111111111111111111111",
    reportedScamAddress: "TReceiver11111111111111111111111111111",
    amountRaw: "123456789",
    amountUsdt: "123.456789",
    comment: "Пользователь сообщил о фишинге",
    status: "documents_requested",
    depositAddress: "T999999999999999999999999999999999",
    depositAmountUsdt: "1000",
    adminStatus: "awaiting_documents",
    adminNote: "Проверить документы",
    adminUpdatedAt: new Date("2026-07-08T10:00:00.000Z"),
    createdAt: new Date("2026-07-08T09:00:00.000Z"),
    updatedAt: new Date("2026-07-08T10:00:00.000Z"),
    ...overrides
  };
}
```

Append these tests in `describe("startAdminServer", () => { ... })`:

```typescript
  it("serves the theft reports workspace shell", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/theft-reports`);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Заявки о краже");
    expect(html).toContain("data-theft-reports-workspace");
    expect(html).toContain("/admin/api/theft-reports");
  });

  it("lists theft reports for authorized admins", async () => {
    let receivedInput: unknown = null;
    const server = await start({
      ...deps(),
      listTheftReports: async (input) => {
        receivedInput = input;
        return [theftReport()];
      },
      getTheftReport: async () => null,
      updateTheftReportAdminState: async () => null
    });

    const response = await fetch(
      `${server.url}/admin/api/theft-reports?limit=20&offset=5&adminStatus=awaiting_documents&botStatus=documents_requested&query=TReceiver`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      reports: [{
        id: "report-1",
        telegramUserId: "42",
        adminStatus: "awaiting_documents",
        status: "documents_requested"
      }]
    });
    expect(receivedInput).toMatchObject({
      limit: 20,
      offset: 5,
      adminStatus: "awaiting_documents",
      botStatus: "documents_requested",
      query: "TReceiver"
    });
  });

  it("returns theft report detail for authorized admins", async () => {
    const server = await start({
      ...deps(),
      listTheftReports: async () => [],
      getTheftReport: async (id) => id === "report-1" ? theftReport() : null,
      updateTheftReportAdminState: async () => null
    });

    const response = await fetch(`${server.url}/admin/api/theft-reports/report-1`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      report: {
        id: "report-1",
        victimAddress: "TSender111111111111111111111111111111",
        reportedScamAddress: "TReceiver11111111111111111111111111111"
      }
    });
  });

  it("updates theft report admin state for authorized admins", async () => {
    let receivedInput: unknown = null;
    const server = await start({
      ...deps(),
      listTheftReports: async () => [],
      getTheftReport: async () => null,
      updateTheftReportAdminState: async (input) => {
        receivedInput = input;
        return theftReport({ adminStatus: input.adminStatus, adminNote: input.adminNote });
      }
    });

    const response = await fetch(`${server.url}/admin/api/theft-reports/report-1/admin-state`, {
      method: "PATCH",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({ adminStatus: "in_progress", adminNote: "Взято в работу" })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      report: {
        id: "report-1",
        adminStatus: "in_progress",
        adminNote: "Взято в работу"
      }
    });
    expect(receivedInput).toEqual({
      id: "report-1",
      adminStatus: "in_progress",
      adminNote: "Взято в работу"
    });
  });

  it("rejects invalid theft report admin status filters", async () => {
    const server = await start({
      ...deps(),
      listTheftReports: async () => [],
      getTheftReport: async () => null,
      updateTheftReportAdminState: async () => null
    });

    const response = await fetch(`${server.url}/admin/api/theft-reports?adminStatus=paid`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
  });

  it("returns 501 when theft reports dependencies are not configured", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/theft-reports`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(501);
  });
```

- [ ] **Step 2: Run Admin server tests to verify failure**

Run:

```powershell
npm test -- tests/admin/adminServer.test.ts
```

Expected: fail because `/admin/theft-reports` and theft-report API dependencies do not exist.

- [ ] **Step 3: Extend Admin server types and parsers**

In `src/admin/adminServer.ts`, extend the import from `../storage/repositories`:

```typescript
  ListTheftReportsInput,
  TheftReport,
  TheftReportAdminStatus,
  TheftReportStatus,
  UpdateTheftReportAdminStateInput,
```

Extend `AdminServerDeps`:

```typescript
  listTheftReports?(input: ListTheftReportsInput): Promise<TheftReport[]>;
  getTheftReport?(id: string): Promise<TheftReport | null>;
  updateTheftReportAdminState?(input: UpdateTheftReportAdminStateInput): Promise<TheftReport | null>;
```

Near the existing status sets, add:

```typescript
const theftReportAdminStatuses = new Set<TheftReportAdminStatus>([
  "new",
  "awaiting_payment",
  "awaiting_documents",
  "in_progress",
  "escalated",
  "closed",
  "cancelled"
]);
const theftReportBotStatuses = new Set<TheftReportStatus>([
  "draft",
  "awaiting_deposit",
  "deposit_confirmed",
  "documents_requested",
  "cancelled"
]);
```

Add parser helpers near `parseListJobsInput`:

```typescript
function parseTheftReportAdminStatusFilter(url: URL): ParseResult<TheftReportAdminStatus | undefined> {
  const value = firstQueryValue(url, "adminStatus");
  if (value === undefined) return { ok: true, value: undefined };
  if (theftReportAdminStatuses.has(value as TheftReportAdminStatus)) {
    return { ok: true, value: value as TheftReportAdminStatus };
  }
  return { ok: false, message: "Invalid theft report adminStatus filter." };
}

function parseTheftReportBotStatusFilter(url: URL): ParseResult<TheftReportStatus | undefined> {
  const value = firstQueryValue(url, "botStatus");
  if (value === undefined) return { ok: true, value: undefined };
  if (theftReportBotStatuses.has(value as TheftReportStatus)) {
    return { ok: true, value: value as TheftReportStatus };
  }
  return { ok: false, message: "Invalid theft report botStatus filter." };
}

function parseTheftReportsListInput(url: URL): ParseResult<ListTheftReportsInput> {
  const limit = parsePositiveIntegerQuery(url, "limit");
  if (!limit.ok) return { ok: false, message: "Invalid theft report limit." };
  const offset = parsePositiveIntegerQuery(url, "offset");
  if (!offset.ok) return { ok: false, message: "Invalid theft report offset." };
  const adminStatus = parseTheftReportAdminStatusFilter(url);
  if (!adminStatus.ok) return adminStatus;
  const botStatus = parseTheftReportBotStatusFilter(url);
  if (!botStatus.ok) return botStatus;

  return {
    ok: true,
    value: {
      limit: limit.value,
      offset: offset.value,
      adminStatus: adminStatus.value,
      botStatus: botStatus.value,
      query: firstQueryValue(url, "query")
    }
  };
}

function theftReportApiMatch(pathname: string): ParseResult<{ id: string; action: "detail" | "admin-state" } | null> {
  const match = /^\/admin\/api\/theft-reports\/([^/]+)(?:\/(admin-state))?$/.exec(pathname);
  if (!match) return { ok: true, value: null };
  const id = safeDecodeUriComponent(match[1], "Invalid theft report id.");
  if (!id.ok) return id;
  return {
    ok: true,
    value: {
      id: id.value,
      action: match[2] === "admin-state" ? "admin-state" : "detail"
    }
  };
}
```

- [ ] **Step 4: Add Admin API routes**

In `handleApiRequest`, before the wallet-intelligence routes, add:

```typescript
  if (url.pathname === "/admin/api/theft-reports") {
    if (request.method !== "GET") {
      writeJson(response, 405, { error: "Method not allowed." });
      return;
    }
    const input = parseTheftReportsListInput(url);
    if (!input.ok) {
      writeJson(response, 400, { error: input.message });
      return;
    }
    if (!deps.listTheftReports) {
      writeJson(response, 501, { error: "Theft reports are not configured." });
      return;
    }
    const reports = await deps.listTheftReports(input.value);
    writeJson(response, 200, { reports });
    return;
  }

  const theftReportMatch = theftReportApiMatch(url.pathname);
  if (!theftReportMatch.ok) {
    writeJson(response, 400, { error: theftReportMatch.message });
    return;
  }
  if (theftReportMatch.value) {
    if (theftReportMatch.value.action === "admin-state") {
      if (request.method !== "PATCH") {
        writeJson(response, 405, { error: "Method not allowed." });
        return;
      }
      if (!deps.updateTheftReportAdminState) {
        writeJson(response, 501, { error: "Theft report admin updates are not configured." });
        return;
      }
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(request);
      } catch {
        writeJson(response, 400, { error: "Invalid JSON body." });
        return;
      }
      const adminStatus = stringField(body.adminStatus);
      if (!adminStatus || !theftReportAdminStatuses.has(adminStatus as TheftReportAdminStatus)) {
        writeJson(response, 400, { error: "Invalid theft report admin status." });
        return;
      }
      const adminNote = typeof body.adminNote === "string" ? body.adminNote : "";
      const report = await deps.updateTheftReportAdminState({
        id: theftReportMatch.value.id,
        adminStatus: adminStatus as TheftReportAdminStatus,
        adminNote
      });
      if (!report) {
        writeJson(response, 404, { error: "Theft report not found." });
        return;
      }
      writeJson(response, 200, { report });
      return;
    }

    if (request.method !== "GET") {
      writeJson(response, 405, { error: "Method not allowed." });
      return;
    }
    if (!deps.getTheftReport) {
      writeJson(response, 501, { error: "Theft report detail is not configured." });
      return;
    }
    const report = await deps.getTheftReport(theftReportMatch.value.id);
    if (!report) {
      writeJson(response, 404, { error: "Theft report not found." });
      return;
    }
    writeJson(response, 200, { report });
    return;
  }
```

In `handleRequest`, extend the Admin HTML route:

```typescript
  if (url.pathname === "/admin/forensics" || url.pathname === "/admin/wallet-intelligence" || url.pathname === "/admin/theft-reports") {
```

- [ ] **Step 5: Wire runtime and index**

In `src/admin/adminRuntime.ts`, extend imports:

```typescript
  ListTheftReportsInput,
  TheftReport,
  UpdateTheftReportAdminStateInput,
```

Extend `AdminRuntimeDeps`:

```typescript
  listTheftReports?(input: ListTheftReportsInput): Promise<TheftReport[]>;
  getTheftReport?(id: string): Promise<TheftReport | null>;
  updateTheftReportAdminState?(input: UpdateTheftReportAdminStateInput): Promise<TheftReport | null>;
```

Pass them into `startAdminServer`:

```typescript
    listTheftReports: deps.listTheftReports,
    getTheftReport: deps.getTheftReport,
    updateTheftReportAdminState: deps.updateTheftReportAdminState
```

In `src/index.ts`, import the repository functions:

```typescript
  getTheftReport,
  listTheftReports,
  updateTheftReportAdminState,
```

In the `maybeStartAdminDashboard` call, add:

```typescript
    listTheftReports: (input) => listTheftReports(db, input),
    getTheftReport: (id) => getTheftReport(db, id),
    updateTheftReportAdminState: (input) => updateTheftReportAdminState(db, input),
```

- [ ] **Step 6: Run Admin server tests**

Run:

```powershell
npm test -- tests/admin/adminServer.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit Admin API task**

Run:

```powershell
git add -- src/admin/adminServer.ts src/admin/adminRuntime.ts src/index.ts tests/admin/adminServer.test.ts
git commit -m "feat: expose theft reports admin api"
```

---

### Task 3: Add Russian Admin Workspace Shell

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing shell test**

In `tests/admin/adminConsole.test.ts`, append:

```typescript
  it("renders the Russian theft reports workspace shell", () => {
    const html = adminConsoleHtml();

    expect(html).toContain('<a href="/admin/theft-reports" data-workspace-link>Заявки о краже</a>');
    expect(html).toContain('data-theft-reports-workspace');
    expect(html).toContain('id="theftReportsSearch"');
    expect(html).toContain('id="theftReportsAdminStatus"');
    expect(html).toContain('id="theftReportsBotStatus"');
    expect(html).toContain('id="theftReportsList"');
    expect(html).toContain('id="theftReportDetail"');
    expect(html).toContain("Предварительные сообщения пользователей");
    expect(html).toContain("Внутренняя обработка");
    expect(html).toContain("Заявка не является доказательством кражи");
    expect(html).not.toContain("кража подтверждена");
  });
```

- [ ] **Step 2: Run console tests to verify failure**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: fail because the workspace shell is absent.

- [ ] **Step 3: Add CSS for the workspace**

In `src/admin/adminConsole.ts`, near the wallet intelligence CSS, add:

```css
    .theft-reports-workspace {
      height: calc(100dvh - 56px);
      min-height: 0;
      overflow: hidden;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 12px;
      padding: 12px;
      background: var(--surface-canvas);
    }
    .theft-reports-head {
      display: grid;
      gap: 10px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .theft-reports-title-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: start;
    }
    .theft-reports-title-row h2 { margin: 0; font-size: 16px; }
    .theft-reports-warning { color: var(--warn); font-size: 12px; max-width: 460px; text-align: right; }
    .theft-reports-filters {
      display: grid;
      grid-template-columns: minmax(220px, 1.5fr) minmax(170px, .8fr) minmax(170px, .8fr) minmax(120px, .5fr) auto;
      gap: 8px;
      align-items: end;
    }
    .theft-reports-filters label { display: grid; gap: 4px; color: var(--muted); font-size: 11px; }
    .theft-reports-body {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(360px, 480px) minmax(0, 1fr);
      gap: 12px;
    }
    .theft-reports-list, .theft-report-detail {
      min-height: 0;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .theft-report-row {
      display: grid;
      gap: 7px;
      width: 100%;
      padding: 10px;
      border: 0;
      border-bottom: 1px solid var(--line);
      background: transparent;
      color: var(--text);
      text-align: left;
      cursor: pointer;
    }
    .theft-report-row:hover, .theft-report-row.active { background: rgba(122, 162, 247, .08); }
    .theft-report-title { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
    .theft-report-amount { font-weight: 700; color: var(--text-primary); }
    .theft-report-meta { display: flex; flex-wrap: wrap; gap: 6px; color: var(--text-secondary); font-size: 12px; }
    .theft-report-card { display: grid; gap: 12px; padding: 12px; }
    .theft-report-section {
      display: grid;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
    }
    .theft-report-section:first-child { padding-top: 0; border-top: 0; }
    .theft-report-section h3 { margin: 0; font-size: 13px; }
    .theft-report-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .theft-report-field { display: grid; gap: 3px; font-size: 12px; min-width: 0; }
    .theft-report-field span { color: var(--muted); font-size: 11px; }
    .theft-report-field strong, .theft-report-field code { overflow-wrap: anywhere; }
    .theft-report-note { width: 100%; min-height: 92px; resize: vertical; }
    .theft-report-actions { display: flex; flex-wrap: wrap; gap: 8px; }
```

Add responsive CSS inside the existing `@media (max-width: 900px)` block:

```css
      .theft-reports-filters, .theft-reports-body, .theft-report-grid {
        grid-template-columns: 1fr;
      }
      .theft-reports-warning { text-align: left; }
```

- [ ] **Step 4: Add nav link and static workspace markup**

In the top nav, add:

```html
          <a href="/admin/theft-reports" data-workspace-link>Заявки о краже</a>
```

After the wallet intelligence workspace section, add:

```html
      <section id="theftReportsWorkspace" class="theft-reports-workspace" data-theft-reports-workspace hidden>
        <div class="theft-reports-head">
          <div class="theft-reports-title-row">
            <div>
              <h2>Заявки о краже</h2>
              <div class="hint" id="theftReportsStatus">Загрузите предварительные сообщения пользователей.</div>
            </div>
            <div class="theft-reports-warning">Заявка не является доказательством кражи. Это внутренний экран обработки.</div>
          </div>
          <div id="theftReportsStats" class="stats"></div>
          <div class="theft-reports-filters">
            <label>Поиск
              <input id="theftReportsSearch" placeholder="Адрес, tx, user id, комментарий">
            </label>
            <label>Статус обработки
              <select id="theftReportsAdminStatus">
                <option value="">Все статусы</option>
                <option value="new">Новая</option>
                <option value="awaiting_payment">Ждет оплату</option>
                <option value="awaiting_documents">Ждет документы</option>
                <option value="in_progress">В работе</option>
                <option value="escalated">Передано / эскалация</option>
                <option value="closed">Закрыта</option>
                <option value="cancelled">Отменена</option>
              </select>
            </label>
            <label>Статус бота
              <select id="theftReportsBotStatus">
                <option value="">Все bot status</option>
                <option value="draft">draft</option>
                <option value="awaiting_deposit">awaiting_deposit</option>
                <option value="deposit_confirmed">deposit_confirmed</option>
                <option value="documents_requested">documents_requested</option>
                <option value="cancelled">cancelled</option>
              </select>
            </label>
            <label>Лимит
              <select id="theftReportsLimit">
                <option value="20">20</option>
                <option value="50" selected>50</option>
                <option value="100">100</option>
              </select>
            </label>
            <button id="theftReportsReload" type="button">Обновить</button>
          </div>
        </div>
        <div class="theft-reports-body">
          <div id="theftReportsList" class="theft-reports-list"></div>
          <aside id="theftReportDetail" class="theft-report-detail">
            <div class="empty">Выберите заявку для просмотра и внутренней обработки.</div>
          </aside>
        </div>
      </section>
```

- [ ] **Step 5: Add workspace visibility state**

In the JS state object, add:

```javascript
      theftReports: { reports: [], activeId: null, detail: null, loading: false, error: null, savePending: false, searchTimer: null }
```

Replace `walletIntelligenceActive()` and `syncWorkspaceVisibility()` with:

```javascript
    function walletIntelligenceActive() {
      return window.location.pathname === "/admin/wallet-intelligence";
    }
    function theftReportsActive() {
      return window.location.pathname === "/admin/theft-reports";
    }
    function activeWorkspacePath() {
      if (walletIntelligenceActive()) return "/admin/wallet-intelligence";
      if (theftReportsActive()) return "/admin/theft-reports";
      return "/admin/forensics";
    }
    function syncWorkspaceVisibility() {
      const walletActive = walletIntelligenceActive();
      const theftActive = theftReportsActive();
      const graphShell = document.querySelector("[data-workbench-shell]");
      const walletShell = document.querySelector("[data-wallet-intelligence-workspace]");
      const theftShell = document.querySelector("[data-theft-reports-workspace]");
      if (graphShell) graphShell.hidden = walletActive || theftActive;
      if (walletShell) walletShell.hidden = !walletActive;
      if (theftShell) theftShell.hidden = !theftActive;
      document.querySelectorAll("[data-workspace-link]").forEach((link) => {
        const active = link.getAttribute("href") === activeWorkspacePath();
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
    }
```

- [ ] **Step 6: Run console tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: pass for the shell test and existing tests.

- [ ] **Step 7: Commit shell task**

Run:

```powershell
git add -- src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: add theft reports admin workspace shell"
```

---

### Task 4: Add Theft Reports UI Behavior

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing UI behavior test**

In `tests/admin/adminConsole.test.ts`, append:

```typescript
  it("loads and updates theft reports through the Admin API", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function loadTheftReports");
    expect(html).toContain("function renderTheftReportsList");
    expect(html).toContain("function renderTheftReportDetail");
    expect(html).toContain("function saveTheftReportAdminState");
    expect(html).toContain('/admin/api/theft-reports?" + params.toString()');
    expect(html).toContain('/admin/api/theft-reports/" + encodeURIComponent(report.id) + "/admin-state');
    expect(html).toContain('method: "PATCH"');
    expect(html).toContain("Внутренняя заметка");
    expect(html).toContain("Копировать данные");
    expect(html).toContain("Victim в Forensics");
    expect(html).toContain("Получатель в Wallet Intelligence");
    expect(html).toContain("/admin/forensics?subjectAddress=");
    expect(html).toContain("/admin/wallet-intelligence?subjectAddress=");
    expect(html).toContain("https://tronscan.org/#/transaction/");
    expect(html).not.toContain("/admin/api/forensic-jobs?theftReport");
    expect(html).not.toContain("createTheftReportForensicJob");
  });
```

- [ ] **Step 2: Run console tests to verify failure**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: fail because behavior functions are absent.

- [ ] **Step 3: Add theft-report UI helpers**

In `src/admin/adminConsole.ts`, after wallet-intelligence helper functions, add:

```javascript
    const theftReportAdminStatusLabels = {
      new: "Новая",
      awaiting_payment: "Ждет оплату",
      awaiting_documents: "Ждет документы",
      in_progress: "В работе",
      escalated: "Передано / эскалация",
      closed: "Закрыта",
      cancelled: "Отменена"
    };
    function theftReportAdminStatusLabel(value) {
      return theftReportAdminStatusLabels[value] || value || "n/a";
    }
    function setTheftReportsStatus(message) {
      el("theftReportsStatus").textContent = message;
      if (theftReportsActive()) setStatus(message);
    }
    function theftReportTime(value) {
      return formatJobTime(value) || (value ? String(value) : "n/a");
    }
    function theftReportAddressLink(address) {
      return address ? explorerLink(tronscanAddressUrl(address), short(address, 8)) : '<span class="muted">адрес не указан</span>';
    }
    function theftReportTxLink(txHash) {
      return txHash ? explorerLink(tronscanTxUrl(txHash), short(txHash, 8)) : '<span class="muted">tx не указан</span>';
    }
    function theftReportField(label, value) {
      return '<div class="theft-report-field"><span>' + escapeHtml(label) + '</span><strong>' + value + '</strong></div>';
    }
    function theftReportCopyBlock(report) {
      return [
        "Заявка о краже: " + (report.id || ""),
        "Статус обработки: " + theftReportAdminStatusLabel(report.adminStatus),
        "Bot status: " + (report.status || ""),
        "Telegram user: " + (report.telegramUserId || ""),
        "Victim: " + (report.victimAddress || ""),
        "Получатель: " + (report.reportedScamAddress || ""),
        "Сумма: " + (report.amountUsdt || "") + " USDT",
        "Tx: " + (report.txHash || ""),
        "Комментарий: " + (report.comment || ""),
        "Внутренняя заметка: " + (report.adminNote || "")
      ].join("\\n");
    }
```

- [ ] **Step 4: Add list and load functions**

After the helper block, add:

```javascript
    function renderTheftReportsStats() {
      const counts = state.theftReports.reports.reduce((acc, report) => {
        const key = report.adminStatus || "unknown";
        acc.total += 1;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, { total: 0 });
      el("theftReportsStats").innerHTML = [
        ["Всего", counts.total],
        ["Новые", counts.new || 0],
        ["Ждут документы", counts.awaiting_documents || 0],
        ["В работе", counts.in_progress || 0],
        ["Закрыты", counts.closed || 0]
      ].map(([label, value]) => '<span class="chip">' + escapeHtml(label) + ': ' + escapeHtml(value) + '</span>').join("");
    }
    function renderTheftReportsList() {
      const root = el("theftReportsList");
      renderTheftReportsStats();
      if (state.theftReports.loading) {
        root.innerHTML = '<div class="empty">Загружаем заявки...</div>';
        return;
      }
      if (state.theftReports.error && state.theftReports.reports.length === 0) {
        root.innerHTML = '<div class="error">' + escapeHtml(state.theftReports.error) + '</div>';
        return;
      }
      if (state.theftReports.reports.length === 0) {
        root.innerHTML = '<div class="empty">Заявок по текущим фильтрам нет.</div>';
        return;
      }
      root.innerHTML = state.theftReports.reports.map((report) => {
        const active = report.id === state.theftReports.activeId ? " active" : "";
        return '<button type="button" class="theft-report-row' + active + '" data-theft-report-id="' + escapeHtml(report.id) + '">' +
          '<div class="theft-report-title"><span class="theft-report-amount">' + escapeHtml((report.amountUsdt || "0") + " USDT") + '</span><span class="' + classifyStatus(report.adminStatus === "closed" ? "completed" : report.adminStatus === "cancelled" ? "failed" : "review") + '">' + escapeHtml(theftReportAdminStatusLabel(report.adminStatus)) + '</span></div>' +
          '<div class="theft-report-meta"><span>bot: ' + escapeHtml(report.status || "n/a") + '</span><span>tg:' + escapeHtml(report.telegramUserId || "n/a") + '</span><span>' + escapeHtml(theftReportTime(report.adminUpdatedAt || report.updatedAt || report.createdAt)) + '</span></div>' +
          '<div class="job-line"><strong>Victim:</strong> ' + escapeHtml(short(report.victimAddress, 8)) + '</div>' +
          '<div class="job-line"><strong>Получатель:</strong> ' + escapeHtml(short(report.reportedScamAddress, 8)) + '</div>' +
          '</button>';
      }).join("");
      root.querySelectorAll("[data-theft-report-id]").forEach((button) => {
        button.addEventListener("click", () => openTheftReport(button.getAttribute("data-theft-report-id") || ""));
      });
    }
    async function loadTheftReports() {
      state.token = el("token").value.trim();
      localStorage.setItem("adminForensicsToken", state.token);
      el("sessionState").textContent = state.token ? "session active" : "token missing";
      const params = new URLSearchParams();
      if (el("theftReportsSearch").value.trim()) params.set("query", el("theftReportsSearch").value.trim());
      if (el("theftReportsAdminStatus").value) params.set("adminStatus", el("theftReportsAdminStatus").value);
      if (el("theftReportsBotStatus").value) params.set("botStatus", el("theftReportsBotStatus").value);
      params.set("limit", el("theftReportsLimit").value || "50");
      state.theftReports.loading = true;
      state.theftReports.error = null;
      renderTheftReportsList();
      renderTheftReportDetail();
      try {
        setTheftReportsStatus("Загружаем заявки...");
        const body = await api("/admin/api/theft-reports?" + params.toString());
        state.theftReports.reports = asArray(body.reports);
        if (!state.theftReports.reports.some((report) => report.id === state.theftReports.activeId)) {
          state.theftReports.activeId = state.theftReports.reports[0]?.id || null;
          state.theftReports.detail = state.theftReports.reports[0] || null;
        }
        state.theftReports.loading = false;
        renderTheftReportsList();
        renderTheftReportDetail();
        setTheftReportsStatus(state.theftReports.reports.length + " заявок загружено.");
      } catch (error) {
        state.theftReports.loading = false;
        state.theftReports.error = error?.message || "Не удалось загрузить заявки.";
        state.theftReports.reports = [];
        state.theftReports.activeId = null;
        state.theftReports.detail = null;
        renderTheftReportsList();
        renderTheftReportDetail();
        setTheftReportsStatus("Не удалось загрузить заявки.");
      }
    }
```

- [ ] **Step 5: Add detail, open, and save functions**

Continue with:

```javascript
    async function openTheftReport(reportId) {
      if (!reportId) return;
      state.theftReports.activeId = reportId;
      state.theftReports.detail = state.theftReports.reports.find((report) => report.id === reportId) || null;
      renderTheftReportsList();
      renderTheftReportDetail();
      try {
        const body = await api("/admin/api/theft-reports/" + encodeURIComponent(reportId));
        state.theftReports.detail = body.report || state.theftReports.detail;
        renderTheftReportDetail();
      } catch (error) {
        state.theftReports.error = error?.message || "Не удалось загрузить заявку.";
        renderTheftReportDetail();
      }
    }
    function renderTheftReportDetail() {
      const root = el("theftReportDetail");
      const report = state.theftReports.detail;
      if (state.theftReports.loading && !report) {
        root.innerHTML = '<div class="empty">Загружаем выбранную заявку...</div>';
        return;
      }
      if (!report) {
        root.innerHTML = '<div class="empty">Выберите заявку для просмотра и внутренней обработки.</div>';
        return;
      }
      const copyText = escapeHtml(theftReportCopyBlock(report));
      root.innerHTML = '<div class="theft-report-card">' +
        '<section class="theft-report-section"><h3>Факты транзакции</h3><div class="theft-report-grid">' +
          theftReportField("Victim", theftReportAddressLink(report.victimAddress)) +
          theftReportField("Заявленный получатель", theftReportAddressLink(report.reportedScamAddress)) +
          theftReportField("Tx", theftReportTxLink(report.txHash)) +
          theftReportField("Сумма", escapeHtml((report.amountUsdt || "0") + " USDT")) +
        '</div></section>' +
        '<section class="theft-report-section"><h3>Пользователь</h3><div class="theft-report-grid">' +
          theftReportField("Telegram user id", escapeHtml(report.telegramUserId || "n/a")) +
          theftReportField("Комментарий", escapeHtml(report.comment || "не указан")) +
        '</div></section>' +
        '<section class="theft-report-section"><h3>Оплата / бот</h3><div class="theft-report-grid">' +
          theftReportField("Bot status", escapeHtml(report.status || "n/a")) +
          theftReportField("Deposit wallet", report.depositAddress ? theftReportAddressLink(report.depositAddress) : escapeHtml("не настроен")) +
          theftReportField("Deposit amount", escapeHtml((report.depositAmountUsdt || "0") + " USDT")) +
          theftReportField("Создана", escapeHtml(theftReportTime(report.createdAt))) +
          theftReportField("Обновлена", escapeHtml(theftReportTime(report.updatedAt))) +
          theftReportField("Admin updated", escapeHtml(theftReportTime(report.adminUpdatedAt))) +
        '</div></section>' +
        '<section class="theft-report-section"><h3>Внутренняя обработка</h3>' +
          '<label class="theft-report-field"><span>Статус обработки</span><select id="theftReportAdminStateSelect">' +
            Object.entries(theftReportAdminStatusLabels).map(([value, label]) => '<option value="' + escapeHtml(value) + '"' + (report.adminStatus === value ? " selected" : "") + '>' + escapeHtml(label) + '</option>').join("") +
          '</select></label>' +
          '<label class="theft-report-field"><span>Внутренняя заметка</span><textarea id="theftReportAdminNote" class="theft-report-note" maxlength="2000">' + escapeHtml(report.adminNote || "") + '</textarea></label>' +
          '<div class="theft-report-actions"><button id="theftReportSaveState" type="button">Сохранить</button></div>' +
        '</section>' +
        '<section class="theft-report-section"><h3>Действия</h3><div class="theft-report-actions">' +
          '<button type="button" data-copy-text="' + copyText + '">Копировать данные</button>' +
          '<a class="button-like" href="/admin/forensics?subjectAddress=' + encodeURIComponent(report.victimAddress || "") + '">Victim в Forensics</a>' +
          '<a class="button-like" href="/admin/forensics?subjectAddress=' + encodeURIComponent(report.reportedScamAddress || "") + '">Получатель в Forensics</a>' +
          '<a class="button-like" href="/admin/wallet-intelligence?subjectAddress=' + encodeURIComponent(report.victimAddress || "") + '">Victim в Wallet Intelligence</a>' +
          '<a class="button-like" href="/admin/wallet-intelligence?subjectAddress=' + encodeURIComponent(report.reportedScamAddress || "") + '">Получатель в Wallet Intelligence</a>' +
          '<a class="button-like" href="' + escapeHtml(tronscanTxUrl(report.txHash || "")) + '" target="_blank" rel="noopener noreferrer">Tx в TronScan</a>' +
        '</div></section>' +
      '</div>';
      const saveButton = document.getElementById("theftReportSaveState");
      if (saveButton) saveButton.addEventListener("click", saveTheftReportAdminState);
    }
    async function saveTheftReportAdminState() {
      const report = state.theftReports.detail;
      if (!report || state.theftReports.savePending) return;
      const select = el("theftReportAdminStateSelect");
      const note = el("theftReportAdminNote");
      state.theftReports.savePending = true;
      try {
        setTheftReportsStatus("Сохраняем внутренний статус...");
        const body = await api("/admin/api/theft-reports/" + encodeURIComponent(report.id) + "/admin-state", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ adminStatus: select.value, adminNote: note.value })
        });
        state.theftReports.detail = body.report || report;
        state.theftReports.reports = state.theftReports.reports.map((item) => item.id === report.id ? state.theftReports.detail : item);
        renderTheftReportsList();
        renderTheftReportDetail();
        setTheftReportsStatus("Внутренний статус сохранен.");
      } catch (error) {
        setTheftReportsStatus(error?.message || "Не удалось сохранить внутренний статус.");
      } finally {
        state.theftReports.savePending = false;
      }
    }
```

Add CSS for the action links used in the theft-report card:

```css
    .button-like {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 6px 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--text);
      background: #121820;
      text-decoration: none;
      font-size: 12px;
    }
```

- [ ] **Step 6: Wire events and URL filters**

Update the Load button handler:

```javascript
    el("load").addEventListener("click", () => {
      syncWorkspaceVisibility();
      if (walletIntelligenceActive()) loadWalletIntelligenceAddresses();
      else if (theftReportsActive()) loadTheftReports();
      else loadJobs();
    });
```

Add event listeners near the wallet intelligence listeners:

```javascript
    el("theftReportsReload").addEventListener("click", loadTheftReports);
    el("theftReportsAdminStatus").addEventListener("change", loadTheftReports);
    el("theftReportsBotStatus").addEventListener("change", loadTheftReports);
    el("theftReportsLimit").addEventListener("change", loadTheftReports);
    el("theftReportsSearch").addEventListener("input", () => {
      if (state.theftReports.searchTimer) clearTimeout(state.theftReports.searchTimer);
      state.theftReports.searchTimer = setTimeout(() => {
        state.theftReports.searchTimer = null;
        loadTheftReports();
      }, 250);
    });
    el("theftReportsSearch").addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      loadTheftReports();
    });
```

Update `applyInitialUrlFilters()`:

```javascript
      if (theftReportsActive()) {
        el("theftReportsSearch").value = params.get("query") || params.get("q") || "";
        setSelectFromUrl("theftReportsAdminStatus", params.get("adminStatus") || "");
        setSelectFromUrl("theftReportsBotStatus", params.get("botStatus") || "");
        setSelectFromUrl("theftReportsLimit", params.get("limit") || "");
      }
```

Update startup:

```javascript
    renderTheftReportsList();
    renderTheftReportDetail();
```

and:

```javascript
    if (state.token) {
      if (walletIntelligenceActive()) loadWalletIntelligenceAddresses();
      else if (theftReportsActive()) loadTheftReports();
      else loadJobs();
    }
```

- [ ] **Step 7: Run console tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit UI behavior task**

Run:

```powershell
git add -- src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: add theft reports admin workspace behavior"
```

---

### Task 5: Update Knowledge Docs And Verify

**Files:**
- Modify: `docs/knowledge/08-admin-and-bot-ux.md`

- [ ] **Step 1: Update knowledge doc**

In `docs/knowledge/08-admin-and-bot-ux.md`, under `## Current Behavior`, add:

```markdown
Admin also has a Russian `Заявки о краже` workspace for preliminary theft
reports submitted through the Telegram `Сообщить о краже` flow. This workspace
is an intake and processing queue: it shows the transaction facts extracted by
the bot, the user comment, bot/payment status, internal admin status, and one
internal admin note. The internal admin status and note are not forensic proof,
do not change the bot's technical theft-report status, and do not send Telegram
notifications. The workspace links to Forensics, Wallet Intelligence, and
TronScan, but it does not launch new forensic jobs in the MVP.
```

Under `## Admin Purpose`, add:

```markdown
For theft reports, Admin should help operators process preliminary user claims
without saying that theft is confirmed. Proof still lives in the forensic
evidence surfaces.
```

- [ ] **Step 2: Run focused tests**

Run:

```powershell
npm test -- tests/storage/repositories.test.ts tests/admin/adminServer.test.ts tests/admin/adminConsole.test.ts
```

Expected: pass.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: pass.

- [ ] **Step 4: Inspect diff for forbidden scope creep**

Run:

```powershell
git diff -- src/admin/adminConsole.ts src/admin/adminServer.ts src/storage/repositories.ts docs/knowledge/08-admin-and-bot-ux.md
```

Expected:

- no Telegram notification code for admin status changes;
- no new forensic-job creation endpoint from theft reports;
- no wording `кража подтверждена`;
- no event-log/case-desk tables beyond the three admin columns.

- [ ] **Step 5: Commit docs**

Run:

```powershell
git add -- docs/knowledge/08-admin-and-bot-ux.md
git commit -m "docs: document theft reports admin workspace"
```

## Final Verification Checklist

- `npm test -- tests/storage/repositories.test.ts tests/admin/adminServer.test.ts tests/admin/adminConsole.test.ts` passes.
- `npm run typecheck` passes.
- `/admin/theft-reports` is served by the Admin server.
- API endpoints require the existing Admin bearer token.
- Russian UI labels are present.
- Admin status/note update does not mutate transaction facts or bot status.
- Admin status/note update does not send Telegram notifications.
- No forensic job launcher is added to the theft reports workspace.
