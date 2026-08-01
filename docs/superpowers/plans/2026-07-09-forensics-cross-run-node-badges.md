# Forensics Cross-Run Node Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Wallet Intelligence cross-run address recurrence directly on Admin Forensics graph nodes and in the selected-node Analytics rail.

**Architecture:** Reuse the existing Wallet Intelligence index as the data source. Add one small batch summary API for graph-visible addresses, then have the Admin console fetch those summaries per loaded graph, render neutral count badges, and use the existing address detail endpoint for selected-node source-job rows.

**Tech Stack:** TypeScript, Node HTTP admin server, PostgreSQL repository helpers, inline Admin console HTML/JS in `src/admin/adminConsole.ts`, Vitest.

---

## File Structure

- `src/storage/repositories.ts`
  - Extend `ListWalletIntelligenceAddressSummariesInput` with `addresses?: string[]`.
  - Add an `address = any($n::text[])` filter to the existing summary query.
  - No new storage table and no duplicate mapper.

- `src/admin/adminServer.ts`
  - Add `GET /admin/api/wallet-intelligence/address-summaries?addresses=A,B`.
  - Validate comma-separated and repeated `addresses` query params with the existing `tronAddressPattern`.
  - Reuse `deps.listWalletIntelligenceAddressSummaries`.

- `src/admin/adminConsole.ts`
  - Add cross-run state maps for summary/detail data.
  - Parse `highlightAddress` from the Forensics URL.
  - Fetch batch summaries after graph load.
  - Render SVG node badges.
  - Render selected-node source job rows using the existing Wallet Intelligence detail endpoint.
  - Apply deep-link selection/highlight after the target graph is loaded.

- `tests/storage/walletIntelligence.test.ts`
  - Cover the new address-list filter.

- `tests/admin/adminServer.test.ts`
  - Cover the batch summaries endpoint, invalid address input, and missing dependency.

- `tests/admin/adminConsole.test.ts`
  - Structural tests for state, fetch URL, badge rendering, selected-node section, source-job links, and `highlightAddress` handling.

- `docs/knowledge/08-admin-and-bot-ux.md`
  - Document the new Forensics graph cross-run badges as Admin-only context.

- `docs/knowledge/10-open-problems.md`
  - Revise the existing Wallet Intelligence graph-visualization gap because per-job "seen elsewhere" hints are now implemented for Forensics.

---

### Task 1: Add Storage Address Filtering

**Files:**
- Modify: `src/storage/repositories.ts`
- Test: `tests/storage/walletIntelligence.test.ts`

- [ ] **Step 1: Write the failing storage test**

Add this test after `lists address summaries ranked by unique subjects then requesters` in `tests/storage/walletIntelligence.test.ts`:

```ts
  it("filters address summaries by an explicit address list", async () => {
    const { db, queries } = createMockDb([[
      {
        address: "TSeen1111111111111111111111111111111",
        unique_subject_count: 3,
        unique_requester_count: 2,
        job_count: 5,
        completed_job_count: 4,
        partial_job_count: 1,
        occurrence_count: 8,
        distinct_tx_count: 2,
        distinct_amount_raw: "3000000",
        min_depth: 1,
        max_depth: 2,
        first_seen_at: new Date("2026-07-06T09:00:00.000Z"),
        last_seen_at: new Date("2026-07-06T10:00:00.000Z"),
        modes: ["address_deep_check"],
        tags: ["repeated_cross_run_address"],
        service_categories: [],
        label_hints: []
      }
    ]]);

    const rows = await listWalletIntelligenceAddressSummaries(db, {
      addresses: [
        "TSeen1111111111111111111111111111111",
        "TOther111111111111111111111111111111"
      ],
      limit: 20,
      offset: 0
    });

    expect(rows[0]?.address).toBe("TSeen1111111111111111111111111111111");
    expect(queries[0].sql).toContain("address = any($1::text[])");
    expect(queries[0].params).toEqual([[
      "TSeen1111111111111111111111111111111",
      "TOther111111111111111111111111111111"
    ], 20, 0]);
  });
```

- [ ] **Step 2: Run the failing storage test**

Run:

```bash
npm test -- tests/storage/walletIntelligence.test.ts -t "filters address summaries by an explicit address list"
```

Expected: TypeScript/Vitest fails because `addresses` is not part of `ListWalletIntelligenceAddressSummariesInput` yet, or the SQL assertion fails because the filter is not present.

- [ ] **Step 3: Extend the repository input type**

In `src/storage/repositories.ts`, change `ListWalletIntelligenceAddressSummariesInput` to include the explicit address filter:

```ts
export type ListWalletIntelligenceAddressSummariesInput = {
  limit?: number;
  offset?: number;
  mode?: WalletIntelligenceSupportedJobKind;
  tag?: WalletIntelligenceTag;
  minUniqueSubjects?: number;
  minUniqueRequesters?: number;
  startDate?: Date;
  endDate?: Date;
  addressQuery?: string;
  addresses?: string[];
  minDepth?: number;
  maxDepth?: number;
  minDistinctAmountRaw?: string;
  maxDistinctAmountRaw?: string;
  serviceCategory?: string;
  requesterQuery?: string;
  subjectAddress?: string;
  jobStatus?: WalletIntelligenceJobStatus;
};
```

- [ ] **Step 4: Add the SQL filter**

In `listWalletIntelligenceAddressSummaries`, immediately after `const where: string[] = [];`, insert:

```ts
  const addresses = [...new Set((input.addresses || []).map((address) => address.trim()).filter(Boolean))];
  if (addresses.length > 0) {
    params.push(addresses);
    where.push(`address = any($${params.length}::text[])`);
  }
```

This keeps validation at the Admin API boundary and keeps the repository as a simple filter builder.

- [ ] **Step 5: Run the storage test**

Run:

```bash
npm test -- tests/storage/walletIntelligence.test.ts -t "filters address summaries by an explicit address list"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/storage/repositories.ts tests/storage/walletIntelligence.test.ts
git commit -m "feat: filter wallet intelligence summaries by addresses"
```

---

### Task 2: Add Batch Admin API For Graph Summaries

**Files:**
- Modify: `src/admin/adminServer.ts`
- Test: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Write the endpoint tests**

Add these tests near the existing Wallet Intelligence API tests in `tests/admin/adminServer.test.ts`, before `returns wallet intelligence address detail`:

```ts
  it("returns wallet intelligence summaries for requested graph addresses", async () => {
    let receivedInput: unknown = null;
    const server = await start({
      ...deps(),
      listWalletIntelligenceAddressSummaries: async (input) => {
        receivedInput = input;
        return [{
          address: "TSeen1111111111111111111111111111111",
          uniqueSubjectCount: 2,
          uniqueRequesterCount: 1,
          jobCount: 3,
          completedJobCount: 3,
          partialJobCount: 0,
          occurrenceCount: 4,
          distinctTxCount: 2,
          distinctAmountRaw: "3000000",
          minDepth: 1,
          maxDepth: 2,
          firstSeenAt: new Date("2026-07-06T09:00:00.000Z"),
          lastSeenAt: new Date("2026-07-06T10:00:00.000Z"),
          modes: ["address_deep_check"],
          tags: ["repeated_cross_run_address"],
          serviceCategories: [],
          labelHints: []
        }];
      },
      getWalletIntelligenceAddressDetail: async () => null
    });

    const response = await fetch(
      `${server.url}/admin/api/wallet-intelligence/address-summaries?addresses=TSeen1111111111111111111111111111111,TOther111111111111111111111111111111`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      addresses: [{
        address: "TSeen1111111111111111111111111111111",
        jobCount: 3,
        uniqueSubjectCount: 2
      }]
    });
    expect(receivedInput).toMatchObject({
      addresses: [
        "TSeen1111111111111111111111111111111",
        "TOther111111111111111111111111111111"
      ],
      limit: 2,
      offset: 0
    });
  });

  it("rejects invalid wallet intelligence graph summary addresses", async () => {
    const server = await start({
      ...deps(),
      listWalletIntelligenceAddressSummaries: async () => [],
      getWalletIntelligenceAddressDetail: async () => null
    });

    const response = await fetch(
      `${server.url}/admin/api/wallet-intelligence/address-summaries?addresses=not-a-tron-address`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid wallet intelligence address."
    });
  });

  it("returns 501 when wallet intelligence graph summaries are not configured", async () => {
    const server = await start();

    const response = await fetch(
      `${server.url}/admin/api/wallet-intelligence/address-summaries?addresses=TSeen1111111111111111111111111111111`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(501);
  });
```

- [ ] **Step 2: Run the failing endpoint tests**

Run:

```bash
npm test -- tests/admin/adminServer.test.ts -t "wallet intelligence graph"
```

Expected: FAIL with 404 or missing route.

- [ ] **Step 3: Add query parsing helper**

In `src/admin/adminServer.ts`, after `parseWalletIntelligenceRawAmountQuery`, add:

```ts
function parseWalletIntelligenceAddressList(url: URL): ParseResult<string[]> {
  const addresses = [...new Set(url.searchParams
    .getAll("addresses")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean))];
  if (addresses.length === 0) return { ok: false, message: "At least one wallet intelligence address is required." };
  if (addresses.length > 200) return { ok: false, message: "Too many wallet intelligence addresses." };
  if (!addresses.every((address) => tronAddressPattern.test(address))) {
    return { ok: false, message: "Invalid wallet intelligence address." };
  }
  return { ok: true, value: addresses };
}
```

- [ ] **Step 4: Add the route before the existing `/addresses` route**

In `src/admin/adminServer.ts`, immediately before `if (url.pathname === "/admin/api/wallet-intelligence/addresses")`, add:

```ts
  if (url.pathname === "/admin/api/wallet-intelligence/address-summaries") {
    if (request.method !== "GET") {
      writeJson(response, 405, { error: "Method not allowed." });
      return;
    }
    const addresses = parseWalletIntelligenceAddressList(url);
    if (!addresses.ok) {
      writeJson(response, 400, { error: addresses.message });
      return;
    }
    if (!deps.listWalletIntelligenceAddressSummaries) {
      writeJson(response, 501, { error: "Wallet intelligence address summaries are not configured." });
      return;
    }

    const summaries = await deps.listWalletIntelligenceAddressSummaries({
      addresses: addresses.value,
      limit: addresses.value.length,
      offset: 0
    });
    writeJson(response, 200, { addresses: summaries });
    return;
  }
```

- [ ] **Step 5: Run the endpoint tests**

Run:

```bash
npm test -- tests/admin/adminServer.test.ts -t "wallet intelligence"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/admin/adminServer.ts tests/admin/adminServer.test.ts
git commit -m "feat: expose wallet intelligence graph summaries"
```

---

### Task 3: Load Cross-Run Summaries In Admin Console

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add structural tests for client state and fetch**

Add this test near other `adminConsoleHtml` structural tests in `tests/admin/adminConsole.test.ts`:

```ts
  it("loads Wallet Intelligence graph summaries for visible graph addresses", () => {
    const html = adminConsoleHtml();
    const stateBlock = html.slice(html.indexOf("const state = {"), html.indexOf("if (![\"all\", \"incoming\""));
    const loadGraphBlock = html.match(/async function loadGraph\(jobId\) \{[\s\S]*?setStatus\("Graph loaded\. Wheel to zoom, drag to pan\."\);/)?.[0] || "";
    const summaryBlock = html.slice(html.indexOf("async function loadGraphCrossRunSummaries"), html.indexOf("function crossRunSummaryForNode"));

    expect(stateBlock).toContain("crossRunAddressSummaries: new Map()");
    expect(stateBlock).toContain("crossRunAddressDetailByAddress: new Map()");
    expect(stateBlock).toContain("pendingHighlightAddress: null");
    expect(loadGraphBlock).toContain("loadGraphCrossRunSummaries();");
    expect(summaryBlock).toContain("/admin/api/wallet-intelligence/address-summaries?addresses=");
    expect(summaryBlock).toContain("graphNodes(state.graph)");
    expect(summaryBlock).toContain("nodeAddress(node)");
  });
```

- [ ] **Step 2: Run the failing console test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "loads Wallet Intelligence graph summaries"
```

Expected: FAIL because the state fields and loader do not exist.

- [ ] **Step 3: Add cross-run state**

In `src/admin/adminConsole.ts`, inside the `state` object near `walletIntel`, add:

```js
      crossRunAddressSummaries: new Map(),
      crossRunAddressDetailByAddress: new Map(),
      crossRunAddressDetailLoading: new Set(),
      pendingHighlightAddress: null,
```

- [ ] **Step 4: Parse `highlightAddress` from the URL**

In `applyInitialUrlFilters`, after existing `jobId` handling, add:

```js
      const highlightAddress = params.get("highlightAddress") || "";
      if (highlightAddress) state.pendingHighlightAddress = highlightAddress;
```

- [ ] **Step 5: Add summary loader helpers**

In `src/admin/adminConsole.ts`, place these helpers after `openWalletIntelligenceAddress` and before `walletIntelAddRawAmount`:

```js
    function graphNodeAddresses() {
      return [...new Set(graphNodes(state.graph)
        .map((node) => nodeAddress(node))
        .map((address) => String(address || "").trim())
        .filter((address) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)))];
    }
    async function loadGraphCrossRunSummaries() {
      state.crossRunAddressSummaries = new Map();
      state.crossRunAddressDetailByAddress = new Map();
      state.crossRunAddressDetailLoading = new Set();
      const addresses = graphNodeAddresses();
      if (addresses.length === 0) {
        renderGraph();
        renderSelectionCard();
        return;
      }
      try {
        const query = addresses.map((address) => encodeURIComponent(address)).join(",");
        const body = await api("/admin/api/wallet-intelligence/address-summaries?addresses=" + query);
        state.crossRunAddressSummaries = new Map(asArray(body.addresses).map((item) => [item.address, item]));
      } catch (error) {
        state.crossRunAddressSummaries = new Map();
      }
      renderGraph();
      renderSelectionCard();
    }
    function crossRunSummaryForAddress(address) {
      return state.crossRunAddressSummaries.get(address) || null;
    }
    function crossRunSummaryForNode(node) {
      const address = nodeAddress(node);
      return address ? crossRunSummaryForAddress(address) : null;
    }
```

- [ ] **Step 6: Call the loader after graph render**

In `loadGraph(jobId)`, after the first `renderGraph();` call in the success branch, add:

```js
        loadGraphCrossRunSummaries();
```

Keep it fire-and-forget so graph loading does not block on Wallet Intelligence. The loader re-renders graph badges when summaries arrive.

- [ ] **Step 7: Run the console test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "loads Wallet Intelligence graph summaries"
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: load graph cross-run summaries"
```

---

### Task 4: Render Badges And Selected-Node Source Jobs

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add structural tests for badge and selected-node section**

Add these tests near the selected-node and graph-rendering tests in `tests/admin/adminConsole.test.ts`:

```ts
  it("renders cross-run count badges on address graph nodes", () => {
    const html = adminConsoleHtml();
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));

    expect(html).toContain(".cross-run-badge circle");
    expect(html).toContain("function crossRunNodeBadge");
    expect(renderBlock).toContain("crossRunNodeBadge(node, radius)");
    expect(html).toContain("jobCount >= 2");
    expect(html).toContain("99+");
  });

  it("shows Wallet Intelligence source jobs in selected node details", () => {
    const html = adminConsoleHtml();
    const selectedNodeCardBlock = html.slice(html.indexOf("function selectedNodeCard"), html.indexOf("function selectedEdgeCard"));

    expect(html).toContain("function selectedNodeCrossRunBlock");
    expect(html).toContain("function loadCrossRunAddressDetail");
    expect(selectedNodeCardBlock).toContain("selectedNodeCrossRunBlock(node)");
    expect(html).toContain("Встречается в прогонах");
    expect(html).toContain("highlightAddress=");
    expect(html).toContain("telegramUserId || requester?.requestedBy");
  });
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "cross-run|Wallet Intelligence source jobs"
```

Expected: FAIL because the badge and selected-node section do not exist.

- [ ] **Step 3: Add badge CSS**

In the graph CSS near `.stop-badge`, add:

```css
    .cross-run-badge { pointer-events: none; }
    .cross-run-badge circle { fill: rgba(246, 193, 119, .96); stroke: #0b0e11; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
    .cross-run-badge text { fill: #0b0e11; font-size: 9px; font-weight: 800; paint-order: normal; stroke: transparent; stroke-width: 0; letter-spacing: 0; }
    .cross-run-source-row { display: block; text-decoration: none; color: var(--text); border: 1px solid var(--border); background: rgba(19, 29, 39, .92); border-radius: 6px; padding: 8px; margin-top: 6px; }
    .cross-run-source-row:hover, .cross-run-source-row:focus { border-color: var(--accent); background: rgba(31, 47, 66, .96); }
    .cross-run-source-row.current { opacity: .72; }
```

- [ ] **Step 4: Add badge helper**

Place this helper near `stopBadge` or immediately before `renderGraph()`:

```js
    function crossRunBadgeText(count) {
      return count > 99 ? "99+" : String(count);
    }
    function crossRunNodeBadge(node, radius) {
      const summary = crossRunSummaryForNode(node);
      const jobCount = Number(summary?.jobCount || 0);
      if (!Number.isFinite(jobCount) || jobCount < 2) return "";
      const text = crossRunBadgeText(jobCount);
      const badgeRadius = text.length > 2 ? 11 : 9;
      const x = radius - 2;
      const y = -radius + 2;
      return '<g class="cross-run-badge" aria-label="Seen in ' + escapeHtml(jobCount) + ' source checks" transform="translate(' + x + ' ' + y + ')">' +
        '<circle r="' + badgeRadius + '"></circle>' +
        '<text text-anchor="middle" dominant-baseline="central">' + escapeHtml(text) + '</text>' +
        '</g>';
    }
```

- [ ] **Step 5: Render the badge inside each node**

In `renderGraph()`, inside the node `<g>` output, add the badge after `stopBadge(node, radius)`:

```js
          stopBadge(node, radius) +
          crossRunNodeBadge(node, radius) +
```

- [ ] **Step 6: Add detail loading and row helpers**

Place these helpers near `selectedNodeCard`:

```js
    async function loadCrossRunAddressDetail(address) {
      if (!address || state.crossRunAddressDetailByAddress.has(address) || state.crossRunAddressDetailLoading.has(address)) return;
      state.crossRunAddressDetailLoading.add(address);
      renderSelectionCard();
      try {
        const body = await api("/admin/api/wallet-intelligence/addresses/" + encodeURIComponent(address));
        if (body.detail) state.crossRunAddressDetailByAddress.set(address, body.detail);
      } catch (error) {
        state.crossRunAddressDetailByAddress.set(address, { error: error?.message || "Не удалось загрузить прогоны." });
      }
      state.crossRunAddressDetailLoading.delete(address);
      renderSelectionCard();
    }
    function crossRunJobRequester(detail, job) {
      const sighting = asArray(detail?.sightings).find((item) => item.jobId === job.jobId);
      const requestedBy = sighting?.requestedBy || "";
      return asArray(detail?.requesters).find((requester) => requester.requestedBy === requestedBy) || null;
    }
    function crossRunSourceJobRow(detail, job, address) {
      const requester = crossRunJobRequester(detail, job);
      const username = requester?.username ? "@" + requester.username : "без username";
      const telegramUserId = requester?.telegramUserId || requester?.requestedBy || "n/a";
      const time = formatJobTime(job.completedAt) || "time n/a";
      const current = job.jobId === state.activeJobId;
      const href = "/admin/forensics?job=" + encodeURIComponent(job.jobId) + "&highlightAddress=" + encodeURIComponent(address);
      return '<a class="cross-run-source-row' + (current ? " current" : "") + '" href="' + href + '">' +
        '<strong>' + escapeHtml(humanCheckKind(job.jobKind)) + '</strong> <span class="muted">· ' + escapeHtml(time) + ' · ' + escapeHtml(short(job.jobId, 8)) + '</span>' +
        '<div class="muted">' + escapeHtml(username) + ' · tg:' + escapeHtml(telegramUserId) + ' · subject ' + escapeHtml(short(job.subjectAddress, 10)) + '</div>' +
        '</a>';
    }
    function selectedNodeCrossRunBlock(node) {
      const address = nodeAddress(node);
      if (!address) return "";
      const summary = crossRunSummaryForAddress(address);
      const jobCount = Number(summary?.jobCount || 0);
      if (!Number.isFinite(jobCount) || jobCount < 2) return "";
      const detail = state.crossRunAddressDetailByAddress.get(address);
      if (state.crossRunAddressDetailLoading.has(address)) {
        return cardBlockHtml("Встречается в прогонах", '<div class="card-note">Загружаем source checks...</div>');
      }
      if (detail?.error) {
        return cardBlockHtml("Встречается в прогонах", '<div class="card-note">' + escapeHtml(detail.error) + '</div>');
      }
      const jobs = asArray(detail?.jobs).slice(0, 8);
      const rows = jobs.map((job) => crossRunSourceJobRow(detail, job, address)).join("");
      return cardBlockHtml("Встречается в прогонах",
        '<div class="card-note">Адрес встречается в ' + escapeHtml(jobCount) + ' уникальных прогонах. Это аналитический контекст, не риск-вердикт.</div>' +
        (rows || '<div class="muted">Source checks пока не загружены.</div>'));
    }
```

- [ ] **Step 7: Trigger detail loading when selecting a node**

In `selectNode(nodeId)`, after setting `state.selected`, add:

```js
      const address = nodeAddress(nodeById(nodeId));
      if (address) loadCrossRunAddressDetail(address);
```

- [ ] **Step 8: Add selected-node section**

In `selectedNodeCard(node)`, add `selectedNodeCrossRunBlock(node) +` after the address line:

```js
        cardLineHtml("Address", addressDetailLink(nodeAddress(node) || node.id)) +
        selectedNodeCrossRunBlock(node) +
        cardLineHtml("Connected neighbors", internalLinkListHtml(connectedNeighborLines(node), "No connected neighbor links.")) +
```

- [ ] **Step 9: Run the console tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "cross-run|Wallet Intelligence source jobs|selected node"
```

Expected: PASS.

- [ ] **Step 10: Commit Task 4**

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: show cross-run node badges"
```

---

### Task 5: Apply Deep-Link Highlighting

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add structural test for `highlightAddress` behavior**

Add this test near the existing URL/pending job tests in `tests/admin/adminConsole.test.ts`:

```ts
  it("parses highlightAddress and selects the matching rendered graph node", () => {
    const html = adminConsoleHtml();
    const urlBlock = html.slice(html.indexOf("function applyInitialUrlFilters"), html.indexOf("async function refreshSecondLayer"));
    const loadGraphBlock = html.match(/async function loadGraph\(jobId\) \{[\s\S]*?setStatus\("Graph loaded\. Wheel to zoom, drag to pan\."\);/)?.[0] || "";
    const highlightBlock = html.slice(html.indexOf("function applyPendingHighlightAddress"), html.indexOf("function selectNode"));

    expect(urlBlock).toContain('params.get("highlightAddress")');
    expect(urlBlock).toContain("state.pendingHighlightAddress = highlightAddress");
    expect(loadGraphBlock).toContain("applyPendingHighlightAddress();");
    expect(highlightBlock).toContain("state.renderedNodesById.values()");
    expect(highlightBlock).toContain("nodeAddress(node)");
    expect(highlightBlock).toContain("selectNode(match.id)");
    expect(highlightBlock).toContain("not visible in the current graph view");
  });
```

- [ ] **Step 2: Run the failing highlight test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "highlightAddress"
```

Expected: FAIL because the helper is not present yet.

- [ ] **Step 3: Add the highlight helper**

Place this helper before `selectNode`:

```js
    function applyPendingHighlightAddress() {
      const address = state.pendingHighlightAddress;
      if (!address || !state.graph) return false;
      const wanted = String(address).toLowerCase();
      const match = [...state.renderedNodesById.values()].find((node) =>
        String(nodeAddress(node)).toLowerCase() === wanted
      );
      state.pendingHighlightAddress = null;
      if (!match?.id) {
        setStatus("Graph loaded. Requested address is not visible in the current graph view.");
        return false;
      }
      selectNode(match.id);
      setStatus("Graph loaded. Highlighted address " + short(address, 10) + ".");
      return true;
    }
```

- [ ] **Step 4: Call the helper after graph layout is rendered**

In `loadGraph(jobId)`, after `fitGraph();`, add:

```js
        applyPendingHighlightAddress();
```

Keep the existing final status line. If that line overwrites the highlight status, change it to:

```js
        if (!applyPendingHighlightAddress()) setStatus("Graph loaded. Wheel to zoom, drag to pan.");
```

and remove the earlier standalone `applyPendingHighlightAddress();`.

- [ ] **Step 5: Run the highlight test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "highlightAddress"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: deep-link graph node highlights"
```

---

### Task 6: Update Knowledge Docs And Run Full Verification

**Files:**
- Modify: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify: `docs/knowledge/10-open-problems.md`

- [ ] **Step 1: Update Admin UX knowledge**

In `docs/knowledge/08-admin-and-bot-ux.md`, in the paragraph that begins `The Analytics rail is compact-first`, add this sentence after the selected node/edge sentence:

```md
For address-backed graph nodes that appear in two or more Wallet Intelligence
source jobs, Admin shows a neutral cross-run count badge on the node and a
Russian `Встречается в прогонах` selected-node section with source job links,
Telegram requester context, subject wallet, and human-readable time. These
badges are investigative context only; they do not change scoring, labels,
Telegram output, or the source job result.
```

- [ ] **Step 2: Update open problems**

In `docs/knowledge/10-open-problems.md`, replace the Wallet Intelligence UX bullet:

```md
- Wallet Intelligence V1 intentionally defers per-job "seen elsewhere" hints
  and global graph visualization until analysts validate the separate
  table/drawer workflow.
```

with:

```md
- Wallet Intelligence now exposes per-job "seen elsewhere" hints in the
  Forensics graph through neutral cross-run node badges and selected-node source
  job links. Remaining open work: a global multi-job graph view that is not tied
  to one selected Forensics job.
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/storage/walletIntelligence.test.ts tests/admin/adminServer.test.ts tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Do one browser smoke test**

Start or reuse the Admin server, then open a graph URL with a known job:

```bash
npm run dev
```

In the browser:

```text
http://127.0.0.1:8787/admin/forensics?job=<existing-job-id>&highlightAddress=<address-on-that-job>
```

Expected:

- graph loads;
- if Wallet Intelligence has `jobCount >= 2` for visible addresses, badges appear;
- selected-node section appears after clicking a badged node;
- source job row opens `/admin/forensics?job=...&highlightAddress=...`;
- target graph selects/highlights the same address or shows the non-blocking not-visible status.

- [ ] **Step 6: Commit Task 6**

```bash
git add docs/knowledge/08-admin-and-bot-ux.md docs/knowledge/10-open-problems.md
git commit -m "docs: document forensics cross-run badges"
```

---

## Final Verification

- [ ] Run all focused tests:

```bash
npm test -- tests/storage/walletIntelligence.test.ts tests/admin/adminServer.test.ts tests/admin/adminConsole.test.ts
```

- [ ] Run typecheck:

```bash
npm run typecheck
```

- [ ] Check git status:

```bash
git status --short
```

Expected: only unrelated pre-existing untracked files remain. Do not stage unrelated files.

## Self-Review

Spec coverage:

- Badge count means unique source jobs: covered by Task 1 repository data and Task 4 `jobCount >= 2`.
- No one-call-per-node behavior: covered by Task 2 batch endpoint and Task 3 batch fetch.
- Selected-node source job rows: covered by Task 4.
- Telegram username, Telegram ID, time, mode, subject wallet: covered by Task 4 row renderer.
- Deep-link navigation and highlight: covered by Task 5.
- Admin-only, non-verdict documentation: covered by Task 6.

Placeholder scan:

- No unresolved markers, empty stubs, or unspecified test steps.
- Every code-changing step includes the concrete snippet to insert or modify.

Type consistency:

- `addresses?: string[]` is added to `ListWalletIntelligenceAddressSummariesInput` and reused by the Admin server route.
- Client summary state uses existing `WalletIntelligenceAddressSummary` JSON field names such as `jobCount`.
- Detail rows use existing `WalletIntelligenceAddressDetail` fields: `jobs`, `requesters`, and `sightings`.
