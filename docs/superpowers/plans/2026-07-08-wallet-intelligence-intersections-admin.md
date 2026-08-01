# Wallet Intelligence Intersections Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Wallet Intelligence into an Admin-only cross-run intersections workspace that highlights repeated addresses across independent subjects/requesters, separates known infrastructure, shows sightings, and provides a focused selected-address graph.

**Architecture:** Reuse the existing Wallet Intelligence index, API, summary rows, detail payload, sightings, and edges. Keep this as a client/admin presentation upgrade plus small API parser/test coverage; do not add schema changes, new TronScan calls, scoring writes, Telegram output, labels, or FastCheck extraction.

**Tech Stack:** TypeScript, embedded Admin console HTML/JS in `src/admin/adminConsole.ts`, Node HTTP Admin API in `src/admin/adminServer.ts`, PostgreSQL repository helpers in `src/storage/repositories.ts`, Vitest.

---

## Files And Responsibilities

- Modify `src/admin/adminConsole.ts`
  - Add Wallet Intelligence presets/tabs.
  - Expose additional existing filters in the UI.
  - Add neutral `why interesting` copy.
  - Render `Sightings` in the detail drawer.
  - Render a small focused SVG ego graph for the selected address using existing `detail.edges` and `detail.jobs`.

- Modify `src/admin/adminServer.ts`
  - Only if tests reveal a missing query parser branch. The expected path is no functional API change because existing list filters already include `minUniqueSubjects`, `minUniqueRequesters`, date range, depth range, distinct amount range, service category, subject, requester, mode, tag, and job status.

- Modify `tests/admin/adminConsole.test.ts`
  - Add isolated helper tests for preset params, known-infrastructure classification, `why interesting` copy, sightings rendering, and focused graph rendering.
  - Keep the broad embedded script syntax test.

- Modify `tests/admin/adminServer.test.ts`
  - Expand the Wallet Intelligence list endpoint test to assert all exposed filters are parsed and passed to `listWalletIntelligenceAddressSummaries`.

- Modify `docs/knowledge/08-admin-and-bot-ux.md`
  - Document that Wallet Intelligence now defaults to intersections, separates known infrastructure, shows sightings, and remains Admin-only non-scoring context.

No database migration is planned.

---

### Task 1: Add Testable Wallet Intelligence Helper Functions

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing helper tests**

Add this helper extraction near the existing `adminClarityHelpers()` helpers in `tests/admin/adminConsole.test.ts`:

```typescript
function adminWalletIntelHelpers() {
  const html = adminConsoleHtml();
  const start = html.indexOf("function walletIntelKnownInfrastructure(item)");
  const end = html.indexOf("function walletIntelAddressLink(address)", start);
  const helperBlock = html.slice(start, end);
  const escapeHtml = (value: unknown) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return new Function("escapeHtml", "asArray", "walletIntelText", "humanCheckKind", helperBlock + "\nreturn { walletIntelKnownInfrastructure, walletIntelWhyInteresting, walletIntelPresetFilters };")(
    escapeHtml,
    (value: unknown) => Array.isArray(value) ? value : [],
    (value: unknown, fallback = "n/a") => value === null || value === undefined || value === "" ? fallback : String(value),
    (kind: unknown) => kind === "address_deep_check" ? "DeepCheck" : kind === "where_is_money_check" ? "Where is money" : kind === "incoming_deposit_check" ? "Incoming deposit" : String(kind ?? "unknown")
  ) as {
    walletIntelKnownInfrastructure(item: Record<string, unknown>): boolean;
    walletIntelWhyInteresting(item: Record<string, unknown>): string;
    walletIntelPresetFilters(preset: string): Record<string, string>;
  };
}
```

Add these tests inside `describe("adminConsoleHtml", () => { ... })`:

```typescript
it("explains Wallet Intelligence rows with neutral intersection copy", () => {
  const helpers = adminWalletIntelHelpers();

  expect(helpers.walletIntelWhyInteresting({
    uniqueSubjectCount: 3,
    uniqueRequesterCount: 2,
    modes: ["address_deep_check", "where_is_money_check"],
    minDepth: 1,
    maxDepth: 3,
    tags: ["repeated_cross_run_address"]
  })).toBe("Seen in 3 subjects, 2 requesters, DeepCheck + Where is money, depth 1-3");

  expect(helpers.walletIntelWhyInteresting({
    uniqueSubjectCount: 1,
    uniqueRequesterCount: 1,
    modes: ["incoming_deposit_check"],
    minDepth: null,
    maxDepth: null,
    tags: []
  })).toBe("Single-context sighting, Incoming deposit, depth n/a");
});

it("classifies known Wallet Intelligence infrastructure without risk language", () => {
  const helpers = adminWalletIntelHelpers();

  expect(helpers.walletIntelKnownInfrastructure({
    tags: ["known_service_or_exchange"],
    serviceCategories: [],
    labelHints: []
  })).toBe(true);
  expect(helpers.walletIntelKnownInfrastructure({
    tags: [],
    serviceCategories: ["bridge"],
    labelHints: []
  })).toBe(true);
  expect(helpers.walletIntelKnownInfrastructure({
    tags: ["repeated_cross_run_address"],
    serviceCategories: [],
    labelHints: []
  })).toBe(false);
});

it("maps Wallet Intelligence presets to API filters", () => {
  const helpers = adminWalletIntelHelpers();

  expect(helpers.walletIntelPresetFilters("intersections")).toEqual({ minUniqueSubjects: "2" });
  expect(helpers.walletIntelPresetFilters("known_infrastructure")).toEqual({ tag: "known_service_or_exchange" });
  expect(helpers.walletIntelPresetFilters("all")).toEqual({});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "Wallet Intelligence"
```

Expected: FAIL because `walletIntelKnownInfrastructure`, `walletIntelWhyInteresting`, and `walletIntelPresetFilters` are not defined.

- [ ] **Step 3: Add minimal helpers**

In `src/admin/adminConsole.ts`, insert these browser-script helpers before the existing `function walletIntelAddressLink(address)`:

```javascript
    function walletIntelKnownInfrastructure(item) {
      const tags = asArray(item?.tags);
      const services = asArray(item?.serviceCategories);
      const labels = asArray(item?.labelHints);
      if (tags.includes("known_service_or_exchange")) return true;
      if (tags.includes("possible_service_or_exchange_like")) return true;
      if (services.length > 0) return true;
      return labels.some((label) => /binance|bybit|bitget|bridge|router|exchange|cex/i.test(String(label || "")));
    }
    function walletIntelDepthText(item) {
      const minDepth = item?.minDepth;
      const maxDepth = item?.maxDepth;
      if (minDepth === null || minDepth === undefined || maxDepth === null || maxDepth === undefined) return "n/a";
      return String(minDepth) === String(maxDepth) ? String(minDepth) : String(minDepth) + "-" + String(maxDepth);
    }
    function walletIntelModesText(item) {
      const modes = asArray(item?.modes).map(humanCheckKind).filter(Boolean);
      return modes.length ? modes.join(" + ") : "mode n/a";
    }
    function walletIntelWhyInteresting(item) {
      const subjectCount = Number(item?.uniqueSubjectCount || 0);
      const requesterCount = Number(item?.uniqueRequesterCount || 0);
      const prefix = walletIntelKnownInfrastructure(item)
        ? "Known infrastructure context"
        : subjectCount >= 2
          ? "Seen in " + subjectCount + " subjects"
          : requesterCount >= 2
            ? "Seen across " + requesterCount + " requesters"
            : "Single-context sighting";
      const requesterText = subjectCount >= 2 ? ", " + requesterCount + " requesters" : "";
      return prefix + requesterText + ", " + walletIntelModesText(item) + ", depth " + walletIntelDepthText(item);
    }
    function walletIntelPresetFilters(preset) {
      if (preset === "intersections") return { minUniqueSubjects: "2" };
      if (preset === "requesters") return { minUniqueRequesters: "2" };
      if (preset === "unknown_repeated") return { minUniqueSubjects: "2", tag: "repeated_cross_run_address" };
      if (preset === "known_infrastructure") return { tag: "known_service_or_exchange" };
      if (preset === "cross_mode") return { tag: "cross_mode_seen" };
      if (preset === "low_depth") return { maxDepth: "2", minUniqueSubjects: "2" };
      return {};
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "Wallet Intelligence"
```

Expected: PASS for the new helper tests.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "test(admin): cover wallet intelligence helper copy"
```

Expected: commit succeeds.

---

### Task 2: Expose Intersection Tabs, Presets, And Existing Filters

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`
- Test: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Write failing UI shell test**

Add this test to `tests/admin/adminConsole.test.ts`:

```typescript
it("renders Wallet Intelligence intersection tabs and filters", () => {
  const html = adminConsoleHtml();

  expect(html).toContain('data-wallet-intel-preset="intersections"');
  expect(html).toContain('data-wallet-intel-preset="known_infrastructure"');
  expect(html).toContain('data-wallet-intel-preset="all"');
  expect(html).toContain('id="walletIntelMinSubjects"');
  expect(html).toContain('id="walletIntelMinRequesters"');
  expect(html).toContain('id="walletIntelMaxDepth"');
  expect(html).toContain('id="walletIntelServiceCategory"');
  expect(html).toContain('id="walletIntelJobStatus"');
  expect(html).toContain("walletIntelPresetFilters");
});
```

Expand the existing `"lists wallet intelligence summaries for authorized admins"` test in `tests/admin/adminServer.test.ts` by changing the fetch URL to include all exposed filters:

```typescript
const response = await fetch(
  `${server.url}/admin/api/wallet-intelligence/addresses?limit=20&offset=5&mode=address_deep_check&tag=repeated_cross_run_address&minUniqueSubjects=2&minUniqueRequesters=2&requester=client_user&subjectAddress=TSubject111111111111111111111111111111&startDate=2026-07-01T00%3A00%3A00.000Z&endDate=2026-07-08T00%3A00%3A00.000Z&minDepth=1&maxDepth=2&minDistinctAmountRaw=1000000&maxDistinctAmountRaw=5000000&serviceCategory=cex&jobStatus=completed`,
  { headers: { authorization: "Bearer secret-token" } }
);
```

Expand the `receivedInput` assertion in that same test:

```typescript
expect(receivedInput).toMatchObject({
  limit: 20,
  offset: 5,
  mode: "address_deep_check",
  tag: "repeated_cross_run_address",
  minUniqueSubjects: 2,
  minUniqueRequesters: 2,
  requesterQuery: "client_user",
  subjectAddress: "TSubject111111111111111111111111111111",
  minDepth: 1,
  maxDepth: 2,
  minDistinctAmountRaw: "1000000",
  maxDistinctAmountRaw: "5000000",
  serviceCategory: "cex",
  jobStatus: "completed"
});
expect((receivedInput as { startDate?: Date }).startDate?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
expect((receivedInput as { endDate?: Date }).endDate?.toISOString()).toBe("2026-07-08T00:00:00.000Z");
```

- [ ] **Step 2: Run tests to verify they fail where UI is missing**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "intersection tabs and filters"
npm test -- tests/admin/adminServer.test.ts -t "lists wallet intelligence summaries"
```

Expected: Admin console test FAILS because controls are absent. Admin server test should PASS if all parsers already exist; if it fails, fix only the missing parser branch in `src/admin/adminServer.ts`.

- [ ] **Step 3: Add the UI controls**

In `src/admin/adminConsole.ts`, inside `<div class="wallet-intel-filters">`, add a preset row before the existing `Address` label:

```html
            <div class="wallet-intel-presets" role="group" aria-label="Wallet Intelligence presets">
              <button type="button" data-wallet-intel-preset="intersections" class="active">Intersections</button>
              <button type="button" data-wallet-intel-preset="requesters">By requesters</button>
              <button type="button" data-wallet-intel-preset="unknown_repeated">Unknown repeated</button>
              <button type="button" data-wallet-intel-preset="known_infrastructure">Known infrastructure</button>
              <button type="button" data-wallet-intel-preset="all">All sightings</button>
            </div>
```

Add these filters after the existing `Subject address` label:

```html
            <label>Min subjects
              <input id="walletIntelMinSubjects" inputmode="numeric" placeholder="2">
            </label>
            <label>Min requesters
              <input id="walletIntelMinRequesters" inputmode="numeric" placeholder="2">
            </label>
            <label>Max depth
              <input id="walletIntelMaxDepth" inputmode="numeric" placeholder="2">
            </label>
            <label>Service
              <input id="walletIntelServiceCategory" placeholder="cex, bridge">
            </label>
            <label>Status
              <select id="walletIntelJobStatus">
                <option value="">Any status</option>
                <option value="completed">Completed</option>
                <option value="partial">Partial</option>
              </select>
            </label>
```

If the filter row becomes too crowded, keep the existing responsive CSS and add:

```css
    .wallet-intel-presets {
      grid-column: 1 / -1;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .wallet-intel-presets button.active {
      border-color: var(--accent);
      color: var(--text-primary);
      background: rgba(127, 169, 221, .14);
    }
```

- [ ] **Step 4: Wire preset state and query params**

Extend the `state.walletIntel` object:

```javascript
      walletIntel: { addresses: [], activeAddress: null, detail: null, loading: false, error: null, preset: "intersections" }
```

Add this helper near `loadWalletIntelligenceAddresses()`:

```javascript
    function applyWalletIntelPreset(preset) {
      state.walletIntel.preset = preset || "intersections";
      const filters = walletIntelPresetFilters(state.walletIntel.preset);
      el("walletIntelMinSubjects").value = filters.minUniqueSubjects || "";
      el("walletIntelMinRequesters").value = filters.minUniqueRequesters || "";
      el("walletIntelMaxDepth").value = filters.maxDepth || "";
      if (filters.tag !== undefined) el("walletIntelTag").value = filters.tag;
      document.querySelectorAll("[data-wallet-intel-preset]").forEach((button) => {
        button.classList.toggle("active", button.getAttribute("data-wallet-intel-preset") === state.walletIntel.preset);
      });
    }
```

In `loadWalletIntelligenceAddresses()`, expand the `filters` array:

```javascript
      const filters = [
        ["address", el("walletIntelAddress").value.trim()],
        ["mode", el("walletIntelMode").value],
        ["tag", el("walletIntelTag").value],
        ["requester", el("walletIntelRequester").value.trim()],
        ["subjectAddress", el("walletIntelSubjectAddress").value.trim()],
        ["minUniqueSubjects", el("walletIntelMinSubjects").value.trim()],
        ["minUniqueRequesters", el("walletIntelMinRequesters").value.trim()],
        ["maxDepth", el("walletIntelMaxDepth").value.trim()],
        ["serviceCategory", el("walletIntelServiceCategory").value.trim()],
        ["jobStatus", el("walletIntelJobStatus").value]
      ];
```

In the startup event listener section near `el("walletIntelReload").addEventListener`, add:

```javascript
    document.querySelectorAll("[data-wallet-intel-preset]").forEach((button) => {
      button.addEventListener("click", () => {
        applyWalletIntelPreset(button.getAttribute("data-wallet-intel-preset") || "intersections");
        loadWalletIntelligenceAddresses();
      });
    });
```

In the URL initialization block for `walletIntelligenceActive()`, set defaults:

```javascript
        el("walletIntelMinSubjects").value = params.get("minUniqueSubjects") || "2";
        el("walletIntelMinRequesters").value = params.get("minUniqueRequesters") || "";
        el("walletIntelMaxDepth").value = params.get("maxDepth") || "";
        el("walletIntelServiceCategory").value = params.get("serviceCategory") || "";
        setSelectFromUrl("walletIntelJobStatus", params.get("jobStatus") || "");
        applyWalletIntelPreset(params.get("preset") || "intersections");
```

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "Wallet Intelligence"
npm test -- tests/admin/adminServer.test.ts -t "wallet intelligence"
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/admin/adminConsole.ts src/admin/adminServer.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
git commit -m "feat(admin): add wallet intelligence intersection filters"
```

Expected: commit succeeds. If `src/admin/adminServer.ts` was not modified, omit it from `git add`.

---

### Task 3: Render The Main Table As An Intersections Queue

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing table markup test**

Add this test to `tests/admin/adminConsole.test.ts`:

```typescript
it("renders Wallet Intelligence table columns for intersections", () => {
  const html = adminConsoleHtml();
  const tableStart = html.indexOf("function renderWalletIntelligenceTable()");
  const tableEnd = html.indexOf("async function loadWalletIntelligenceAddresses()", tableStart);
  const tableBlock = html.slice(tableStart, tableEnd);

  expect(tableBlock).toContain("Why interesting");
  expect(tableBlock).toContain("Modes");
  expect(tableBlock).toContain("First seen");
  expect(tableBlock).toContain("Last seen");
  expect(tableBlock).toContain("walletIntelWhyInteresting(item)");
  expect(tableBlock).toContain("walletIntelKnownInfrastructure(item)");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "table columns for intersections"
```

Expected: FAIL because the current table does not include the new columns/helpers.

- [ ] **Step 3: Replace the row and header rendering**

In `renderWalletIntelligenceTable()`, change each row to this shape:

```javascript
        const infra = walletIntelKnownInfrastructure(item);
        const active = item.address === state.walletIntel.activeAddress ? ' class="active"' : "";
        return '<tr' + active + ' data-wallet-intel-address="' + escapeHtml(item.address) + '">' +
          '<td><button type="button" class="wallet-intel-address-button" data-wallet-intel-address="' + escapeHtml(item.address) + '">' + escapeHtml(short(item.address, 8)) + '</button><div class="muted">' + escapeHtml(item.address) + '</div></td>' +
          '<td><span class="wallet-intel-kind ' + (infra ? "infra" : "unknown") + '">' + escapeHtml(infra ? "Known infrastructure" : "Investigate") + '</span><div class="muted">' + tagPills(item.serviceCategories, "No service") + '</div></td>' +
          '<td>' + escapeHtml(walletIntelWhyInteresting(item)) + '</td>' +
          '<td>' + tagPills(item.tags, "No tags") + '</td>' +
          '<td>' + tagPills(item.modes, "No modes") + '</td>' +
          '<td>' + escapeHtml(walletIntelText(item.uniqueSubjectCount, "0")) + '</td>' +
          '<td>' + escapeHtml(walletIntelText(item.uniqueRequesterCount, "0")) + '</td>' +
          '<td>' + escapeHtml(walletIntelText(item.jobCount, "0") + " / " + walletIntelText(item.occurrenceCount, "0")) + '</td>' +
          '<td>' + escapeHtml(walletIntelText(item.minDepth) + " - " + walletIntelText(item.maxDepth)) + '</td>' +
          '<td>' + escapeHtml(walletIntelText(item.distinctTxCount, "0")) + '</td>' +
          '<td>' + escapeHtml(walletIntelAmount(item.distinctAmountRaw)) + '</td>' +
          '<td>' + escapeHtml(walletIntelTime(item.firstSeenAt)) + '</td>' +
          '<td>' + escapeHtml(walletIntelTime(item.lastSeenAt)) + '</td>' +
          '</tr>';
```

Replace the table header with:

```javascript
      root.innerHTML = '<table><thead><tr>' +
        '<th>Address</th><th>Class</th><th>Why interesting</th><th>Tags</th><th>Modes</th><th>Subjects</th><th>Requesters</th><th>Jobs / occurrences</th><th>Depth</th><th>Distinct tx</th><th>Distinct amount</th><th>First seen</th><th>Last seen</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
```

Add small CSS near other wallet-intel styles:

```css
    .wallet-intel-kind {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 3px 8px;
      border: 1px solid var(--border-muted);
      color: var(--text-secondary);
      font-size: 11px;
      white-space: nowrap;
    }
    .wallet-intel-kind.unknown {
      border-color: rgba(127, 169, 221, .6);
      color: var(--accent);
    }
    .wallet-intel-kind.infra {
      border-color: rgba(214, 177, 95, .55);
      color: var(--semantic-boundary);
    }
```

- [ ] **Step 4: Run focused and syntax tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "Wallet Intelligence"
npm test -- tests/admin/adminConsole.test.ts -t "syntactically valid embedded browser script"
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat(admin): render wallet intelligence intersections table"
```

Expected: commit succeeds.

---

### Task 4: Add Sightings To The Address Drawer

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`
- Test: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Write failing drawer test**

Add this test to `tests/admin/adminConsole.test.ts`:

```typescript
it("renders Wallet Intelligence sightings in the detail drawer", () => {
  const html = adminConsoleHtml();
  const drawerStart = html.indexOf("function renderWalletIntelligenceDrawer()");
  const drawerEnd = html.indexOf("function activeJob()", drawerStart);
  const drawerBlock = html.slice(drawerStart, drawerEnd);

  expect(drawerBlock).toContain("const sightings = asArray(detail.sightings).slice(0, 50)");
  expect(drawerBlock).toContain("<h3>Sightings</h3>");
  expect(drawerBlock).toContain('walletIntelLine("Source job"');
  expect(drawerBlock).toContain('walletIntelLine("Subject"');
  expect(drawerBlock).toContain('walletIntelLine("Depth/path"');
});
```

Expand the `"returns wallet intelligence address detail"` fixture in `tests/admin/adminServer.test.ts` so it returns one sighting:

```typescript
sightings: [{
  id: "sighting-1",
  address,
  jobId: "job-1",
  jobKind: "address_deep_check",
  subjectAddress: "TSubject111111111111111111111111111111",
  requestedBy: "42",
  sourceKind: "deep_direct_counterparty",
  role: "direct_counterparty",
  depth: 1,
  pathId: "p",
  txHash: "tx-1",
  amountRaw: "1000000",
  firstSeenAt: new Date("2026-07-06T09:00:00.000Z"),
  lastSeenAt: new Date("2026-07-06T09:00:00.000Z"),
  metadataJson: {}
}],
```

Add this JSON assertion:

```typescript
await expect(response.json()).resolves.toMatchObject({
  detail: {
    summary: { address: "TSeen1111111111111111111111111111111" },
    requesters: [{ username: "client_user" }],
    sightings: [{ sourceKind: "deep_direct_counterparty", depth: 1, txHash: "tx-1" }]
  }
});
```

- [ ] **Step 2: Run tests to verify drawer test fails**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "sightings in the detail drawer"
npm test -- tests/admin/adminServer.test.ts -t "returns wallet intelligence address detail"
```

Expected: Admin console test FAILS because drawer does not render sightings. Admin server test should PASS after fixture update because API already returns `detail.sightings`.

- [ ] **Step 3: Render sightings**

Inside `renderWalletIntelligenceDrawer()`, after:

```javascript
      const jobs = asArray(detail.jobs);
      const edges = asArray(detail.edges).slice(0, 25);
```

change it to:

```javascript
      const jobs = asArray(detail.jobs);
      const sightings = asArray(detail.sightings).slice(0, 50);
      const edges = asArray(detail.edges).slice(0, 25);
```

Add this block after `jobsHtml` and before `edgesHtml`:

```javascript
      const sightingsHtml = '<section class="wallet-intel-section"><h3>Sightings</h3><div class="wallet-intel-list wallet-intel-tx">' +
        (sightings.length ? sightings.map((sighting) => {
          const tx = sighting.txHash ? explorerLink(tronscanTxUrl(sighting.txHash), short(sighting.txHash, 8)) : '<span class="muted">tx n/a</span>';
          return '<div class="wallet-intel-item">' +
            walletIntelLine("Source job", walletIntelJobLink(sighting.jobId)) +
            walletIntelLine("Subject", walletIntelAddressLink(sighting.subjectAddress)) +
            walletIntelLine("Tx", tx) +
            walletIntelLine("Amount", escapeHtml(walletIntelAmount(sighting.amountRaw))) +
            walletIntelLine("Mode", escapeHtml(humanCheckKind(sighting.jobKind))) +
            walletIntelLine("Role", escapeHtml(walletIntelText(sighting.role))) +
            walletIntelLine("Source", escapeHtml(walletIntelText(sighting.sourceKind))) +
            walletIntelLine("Depth/path", escapeHtml(walletIntelText(sighting.depth) + " / " + walletIntelText(sighting.pathId))) +
            walletIntelLine("First seen", escapeHtml(walletIntelTime(sighting.firstSeenAt))) +
            walletIntelLine("Last seen", escapeHtml(walletIntelTime(sighting.lastSeenAt))) +
            '</div>';
        }).join("") : '<div class="empty">No sightings stored.</div>') +
        '</div></section>';
```

Change the drawer return from:

```javascript
      root.innerHTML = summaryHtml + requesterHtml + jobsHtml + edgesHtml;
```

to:

```javascript
      root.innerHTML = summaryHtml + requesterHtml + jobsHtml + sightingsHtml + edgesHtml;
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "sightings in the detail drawer"
npm test -- tests/admin/adminServer.test.ts -t "wallet intelligence address detail"
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
git commit -m "feat(admin): show wallet intelligence sightings"
```

Expected: commit succeeds.

---

### Task 5: Add A Focused Selected-Address Graph

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing graph helper test**

Add this helper extraction to `tests/admin/adminConsole.test.ts`:

```typescript
function adminWalletIntelGraphHelpers() {
  const html = adminConsoleHtml();
  const start = html.indexOf("function walletIntelGraphNodeLabel(value)");
  const end = html.indexOf("function renderWalletIntelligenceDrawer()", start);
  const helperBlock = html.slice(start, end);
  const escapeHtml = (value: unknown) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
  const short = (value: unknown, size = 6) => {
    const text = String(value ?? "");
    return text.length > size * 2 + 3 ? text.slice(0, size) + "..." + text.slice(-size) : text;
  };

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return new Function("escapeHtml", "asArray", "short", "walletIntelAmount", helperBlock + "\nreturn { renderWalletIntelFocusedGraph };")(
    escapeHtml,
    (value: unknown) => Array.isArray(value) ? value : [],
    short,
    (value: unknown) => value === null || value === undefined || value === "" ? "amount n/a" : String(Number(value) / 1_000_000) + " USDT"
  ) as {
    renderWalletIntelFocusedGraph(detail: unknown, address: string): string;
  };
}
```

Add this test:

```typescript
it("renders a focused Wallet Intelligence graph from stored edges", () => {
  const helpers = adminWalletIntelGraphHelpers();

  const html = helpers.renderWalletIntelFocusedGraph({
    edges: [{
      fromAddress: "TSelected11111111111111111111111111111",
      toAddress: "TPeer11111111111111111111111111111111",
      txHash: "tx-1",
      amountRaw: "2500000",
      jobKind: "address_deep_check",
      sourceKind: "deep_direct_counterparty",
      edgeRole: "transfer"
    }]
  }, "TSelected11111111111111111111111111111");

  expect(html).toContain("<svg");
  expect(html).toContain("wallet-intel-ego-graph");
  expect(html).toContain("TSelected");
  expect(html).toContain("TPeer");
  expect(html).toContain("2.5 USDT");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "focused Wallet Intelligence graph"
```

Expected: FAIL because graph helpers do not exist.

- [ ] **Step 3: Add focused graph helpers**

In `src/admin/adminConsole.ts`, insert these helpers before `renderWalletIntelligenceDrawer()`:

```javascript
    function walletIntelGraphNodeLabel(value) {
      return escapeHtml(short(value, 4));
    }
    function walletIntelGraphEdgeColor(edge) {
      if (edge?.jobKind === "where_is_money_check") return "#6fcf97";
      if (edge?.jobKind === "incoming_deposit_check") return "#d6b15f";
      return "#7fa9dd";
    }
    function renderWalletIntelFocusedGraph(detail, address) {
      const edges = asArray(detail?.edges).filter((edge) => edge?.fromAddress === address || edge?.toAddress === address).slice(0, 12);
      if (!edges.length) return '<div class="empty">No stored edges for focused graph.</div>';
      const peers = [];
      edges.forEach((edge) => {
        const peer = edge.fromAddress === address ? edge.toAddress : edge.fromAddress;
        if (peer && !peers.includes(peer)) peers.push(peer);
      });
      const centerX = 220;
      const centerY = 130;
      const radius = 92;
      const peerNodes = peers.slice(0, 10).map((peer, index) => {
        const angle = (-Math.PI / 2) + (Math.PI * 2 * index / Math.max(peers.length, 1));
        return { address: peer, x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
      });
      const peerMap = new Map(peerNodes.map((node) => [node.address, node]));
      const edgeLines = edges.map((edge) => {
        const peer = edge.fromAddress === address ? edge.toAddress : edge.fromAddress;
        const node = peerMap.get(peer);
        if (!node) return "";
        const labelX = (centerX + node.x) / 2;
        const labelY = (centerY + node.y) / 2;
        return '<g class="wallet-intel-ego-edge">' +
          '<line x1="' + centerX + '" y1="' + centerY + '" x2="' + node.x.toFixed(1) + '" y2="' + node.y.toFixed(1) + '" stroke="' + walletIntelGraphEdgeColor(edge) + '" />' +
          '<text x="' + labelX.toFixed(1) + '" y="' + labelY.toFixed(1) + '">' + escapeHtml(walletIntelAmount(edge.amountRaw)) + '</text>' +
          '</g>';
      }).join("");
      const peerHtml = peerNodes.map((node) => '<g class="wallet-intel-ego-node peer"><circle cx="' + node.x.toFixed(1) + '" cy="' + node.y.toFixed(1) + '" r="18"></circle><text x="' + node.x.toFixed(1) + '" y="' + (node.y + 4).toFixed(1) + '">' + walletIntelGraphNodeLabel(node.address) + '</text></g>').join("");
      return '<svg class="wallet-intel-ego-graph" viewBox="0 0 440 260" role="img" aria-label="Wallet Intelligence focused graph">' +
        edgeLines +
        peerHtml +
        '<g class="wallet-intel-ego-node selected"><circle cx="' + centerX + '" cy="' + centerY + '" r="24"></circle><text x="' + centerX + '" y="' + (centerY + 4) + '">' + walletIntelGraphNodeLabel(address) + '</text></g>' +
        '</svg>';
    }
```

Add CSS:

```css
    .wallet-intel-ego-graph {
      width: 100%;
      max-height: 280px;
      border: 1px solid var(--border-muted);
      background: var(--surface-canvas);
    }
    .wallet-intel-ego-edge line {
      stroke-width: 1.5;
      stroke-dasharray: 5 5;
      opacity: .78;
    }
    .wallet-intel-ego-edge text {
      fill: var(--text-secondary);
      font-size: 10px;
      paint-order: stroke;
      stroke: var(--surface-canvas);
      stroke-width: 4px;
    }
    .wallet-intel-ego-node circle {
      fill: var(--surface-panel-strong);
      stroke: var(--border-strong);
      stroke-width: 2;
    }
    .wallet-intel-ego-node.selected circle {
      stroke: var(--accent);
      filter: drop-shadow(0 0 10px rgba(127, 169, 221, .35));
    }
    .wallet-intel-ego-node text {
      fill: var(--text-primary);
      font-size: 10px;
      text-anchor: middle;
      font-weight: 700;
    }
```

- [ ] **Step 4: Add graph section to drawer**

In `renderWalletIntelligenceDrawer()`, after `summaryHtml`, create:

```javascript
      const graphHtml = '<section class="wallet-intel-section"><h3>Focused graph</h3>' + renderWalletIntelFocusedGraph(detail, summary.address || address) + '</section>';
```

Change final drawer composition to:

```javascript
      root.innerHTML = summaryHtml + graphHtml + requesterHtml + jobsHtml + sightingsHtml + edgesHtml;
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "focused Wallet Intelligence graph"
npm test -- tests/admin/adminConsole.test.ts -t "syntactically valid embedded browser script"
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat(admin): add wallet intelligence focused graph"
```

Expected: commit succeeds.

---

### Task 6: Update Knowledge Docs And Run Full Verification

**Files:**
- Modify: `docs/knowledge/08-admin-and-bot-ux.md`

- [ ] **Step 1: Update Admin knowledge**

In `docs/knowledge/08-admin-and-bot-ux.md`, replace the current Wallet Intelligence paragraph under `## Admin Purpose` with:

```markdown
Admin also has a separate Wallet Intelligence workspace and authenticated API
for cross-run address sightings and relationship analytics. It indexes
completed/partial DeepCheck, Where is Money, and Incoming Deposit jobs from
saved payloads only. The view is global investigative context: repeated
appearances, requesters, source jobs, normalized sightings, and normalized
edges for triage. It defaults to repeated intersections across checked subjects,
separates known infrastructure such as CEX, bridge, router, and service wallets,
and exposes a selected-address detail drawer with source jobs, requester
metadata, sightings, stored edges, and a focused graph. It is not a forensic
verdict, not Telegram output, and not per-job graph evidence or scoring.
```

- [ ] **Step 2: Run targeted tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts tests/storage/walletIntelligence.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full project checks**

Run:

```powershell
npm test
npm run typecheck
git diff --check
```

Expected:

- `npm test`: PASS.
- `npm run typecheck`: PASS.
- `git diff --check`: no whitespace errors. Windows LF/CRLF warnings are acceptable if there are no diff-check errors.

- [ ] **Step 4: Check guardrails manually**

Run:

```powershell
rg -n "risk_signal_observations|unifiedWalletRisk|Telegram|address_fast_check|TronScan" src/admin src/storage src/forensics docs/knowledge/08-admin-and-bot-ux.md
```

Expected:

- No new writes to `risk_signal_observations`.
- No change to `unifiedWalletRisk`.
- No Telegram formatting change.
- No `address_fast_check` added to Wallet Intelligence supported job kinds.
- No new TronScan fetching path for Wallet Intelligence.

- [ ] **Step 5: Commit docs and any final fixes**

Run:

```powershell
git add src/admin/adminConsole.ts src/admin/adminServer.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts docs/knowledge/08-admin-and-bot-ux.md
git commit -m "docs(admin): document wallet intelligence intersections"
```

Expected: commit succeeds. If `src/admin/adminServer.ts` was not modified, omit it from `git add`.

---

## Final Implementation Acceptance

After all tasks:

- `/admin/wallet-intelligence` defaults to an intersections-oriented view.
- Admin can switch between intersections, requesters, unknown repeated wallets, known infrastructure, and all sightings presets.
- Table rows explain why an address is interesting using neutral Admin copy.
- Known CEX/bridge/router/service wallets remain visible but visually separated.
- The drawer shows summary, focused graph, requesters, source jobs, sightings, and edges.
- Tx links still open TronScan.
- Source job links still open Forensics.
- No scoring, Telegram, label, assertion, or TronScan-indexing behavior changes.
- FastCheck remains out of scope for this implementation.

## Self-Review

- Spec coverage: The plan covers primary tabs/presets, table copy, filters, drawer sightings, focused graph, known infrastructure handling, guardrails, docs, and verification. FastCheck is intentionally out of scope per the spec.
- Placeholder scan: No placeholder markers or unspecified error-handling steps remain.
- Type consistency: The plan uses existing `WalletIntelligenceAddressSummary`, `WalletIntelligenceAddressDetail`, `sightings`, `edges`, and list endpoint query names already present in the repository.
