# Admin Forensics Analyst Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair `/admin/forensics` into a dense analyst workbench with clearer shell structure, calmer graph semantics, human evidence explanations, and reliable QA coverage.

**Architecture:** Keep the existing vanilla TypeScript `adminConsoleHtml()` renderer and current admin graph data contracts. Implement the redesign as small presentation slices in `src/admin/adminConsole.ts`, backed by focused string/helper tests in `tests/admin/adminConsole.test.ts`; do not change scoring, graph projection, database schema, or transaction fetching in this plan.

**Tech Stack:** TypeScript, inline HTML/CSS/SVG/JavaScript in `src/admin/adminConsole.ts`, Vitest, existing admin server at `/admin/forensics`.

---

## Source Design

Implement against:

- `docs/superpowers/specs/2026-07-02-admin-forensics-analyst-workbench-redesign.md`

Approved direction:

- Analyst Workbench as base.
- Small SOC/risk/status indicators only.
- No React/Tailwind/framework migration.
- No new frontend dependency in the first pass.
- Preserve raw evidence and graph semantics.

## File Structure

- Modify: `src/admin/adminConsole.ts`
  - CSS tokens and visual states.
  - Existing admin shell markup around `graph-workspace`.
  - Inline browser helpers for missing-data copy and evidence meanings.
  - Right rail selected node/edge/group templates.
  - Graph legend and label presentation.
  - Transfer/timeline copy and states.
- Modify: `tests/admin/adminConsole.test.ts`
  - Add focused tests before each slice.
  - Prefer existing test style: `const html = adminConsoleHtml(); expect(html).toContain(...)`.
  - For helper logic, extract function blocks with `html.slice(...)` and evaluate with `new Function(...)`, matching existing tests.
- Verify only: `tests/admin/forensicsGraph.test.ts`
  - Run to ensure graph projection contracts are not broken.
- Do not modify in this plan:
  - `src/admin/forensicsGraph.ts`
  - scoring files
  - migrations
  - transaction/indexing/fetching code

## Execution Notes

- Work on current `master` unless the user requests a feature branch.
- Run `git status --short --branch` before starting each task.
- Keep `tmp/` and `.superpowers/` untracked.
- Use `apply_patch` for manual edits.
- Commit after every completed task.
- If a test expectation conflicts with existing behavior, update the plan only after confirming the spec requirement still holds.

---

### Task 1: Analyst Workbench Design Tokens

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add failing token and state tests**

Append this test near the existing shell/CSS tests in `tests/admin/adminConsole.test.ts` after `renders the graph-first investigation shell`.

```ts
  it("defines analyst workbench design tokens and interaction states", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("--surface-canvas: #080c11;");
    expect(html).toContain("--surface-panel: #0d1217;");
    expect(html).toContain("--surface-panel-strong: #11171d;");
    expect(html).toContain("--text-primary: #e3ebf2;");
    expect(html).toContain("--text-secondary: #a8b4bf;");
    expect(html).toContain("--semantic-money-in: #6fcf97;");
    expect(html).toContain("--semantic-money-out: #df6b75;");
    expect(html).toContain("--semantic-grouped: #c4b1f2;");
    expect(html).toContain("--semantic-contract: #c982a6;");
    expect(html).toContain("--semantic-boundary: #d6b15f;");
    expect(html).toContain("--focus-ring: rgba(127, 169, 221, .72);");
    expect(html).toContain("font-variant-numeric: tabular-nums;");
    expect(html).toContain("button:focus-visible, select:focus-visible, input:focus-visible");
    expect(html).toContain("outline: 2px solid var(--focus-ring);");
    expect(html).toContain(".status-chip-decision");
    expect(html).toContain(".status-chip-risk");
    expect(html).toContain(".status-chip-coverage");
    expect(html).not.toContain("#000000");
  });
```

- [ ] **Step 2: Run the token test and confirm it fails**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "analyst workbench design tokens"
```

Expected: FAIL because the new token names and status chip classes are not present yet.

- [ ] **Step 3: Add the token set and interaction states**

In `src/admin/adminConsole.ts`, inside the existing `:root { ... }` block near the top of `adminConsoleHtml()`, keep the existing variables for compatibility and add these variables after `--bundle`.

```css
      --surface-canvas: #080c11;
      --surface-grid: rgba(255, 255, 255, .032);
      --surface-panel: #0d1217;
      --surface-panel-strong: #11171d;
      --surface-panel-raised: rgba(13, 18, 23, .94);
      --surface-muted: #151b21;
      --border-subtle: #25303a;
      --border-strong: #34424f;
      --text-primary: #e3ebf2;
      --text-secondary: #a8b4bf;
      --text-tertiary: #6f7d89;
      --semantic-money-in: #6fcf97;
      --semantic-money-out: #df6b75;
      --semantic-context: #9aa6b3;
      --semantic-grouped: #c4b1f2;
      --semantic-contract: #c982a6;
      --semantic-boundary: #d6b15f;
      --semantic-service: #7fc8c0;
      --semantic-cex: #e1c46a;
      --semantic-review: #f1c67d;
      --semantic-risk: #f08a95;
      --semantic-ok: #9bd8b1;
      --focus-ring: rgba(127, 169, 221, .72);
      --shadow-raised: 0 18px 46px rgba(0, 0, 0, .34);
      --radius-panel: 8px;
      --radius-control: 6px;
```

Then update the global body/control CSS directly below the existing `button, select, input` rules with:

```css
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      overflow: hidden;
      font-variant-numeric: tabular-nums;
    }
    button, select, input {
      background: var(--panel-2);
      color: var(--text);
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-control);
    }
    button:focus-visible, select:focus-visible, input:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }
    button {
      padding: 8px 10px;
      cursor: pointer;
      transition: border-color .15s ease, background .15s ease, transform .08s ease, color .15s ease;
    }
```

If the old `body { ... }`, `button, select, input { ... }`, or `button { ... }` declarations duplicate these properties, replace those declarations instead of adding a second conflicting block.

Add the status chip classes after `.chip { ... }`:

```css
    .status-chip-decision {
      border-color: rgba(241, 198, 125, .46);
      background: rgba(28, 19, 10, .78);
      color: var(--semantic-review);
    }
    .status-chip-risk {
      border-color: rgba(240, 138, 149, .42);
      background: rgba(26, 11, 15, .78);
      color: var(--semantic-risk);
    }
    .status-chip-coverage {
      border-color: rgba(112, 168, 188, .46);
      background: rgba(9, 20, 25, .78);
      color: #9fd7e8;
    }
    .status-chip-evidence {
      border-color: rgba(196, 177, 242, .42);
      background: rgba(20, 15, 30, .78);
      color: var(--semantic-grouped);
    }
```

- [ ] **Step 4: Run the token test and focused admin tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "analyst workbench design tokens|graph-first investigation shell"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "style(admin): add analyst workbench design tokens"
```

Expected: commit succeeds.

---

### Task 2: Workbench Shell Zones

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add failing shell-zone tests**

Append this test after the token test.

```ts
  it("renders analyst workbench shell zones without changing control ids", () => {
    const html = adminConsoleHtml();

    expect(html).toContain('data-workbench-shell');
    expect(html).toContain('data-case-header');
    expect(html).toContain('data-control-rail');
    expect(html).toContain('data-graph-region');
    expect(html).toContain('data-evidence-rail');
    expect(html).toContain('data-timeline-region');
    expect(html).toContain('class="case-header');
    expect(html).toContain('class="graph-action-row workbench-control-rail"');
    expect(html).toContain('class="overlay-panel analytics-panel evidence-rail-region open"');
    expect(html).toContain('class="graph-stage graph-canvas-region"');
    expect(html).toContain('class="timeline-panel timeline-region"');

    expect(html).toContain('id="toggleJobs"');
    expect(html).toContain('id="toggleAnalytics"');
    expect(html).toContain('id="toggleScoringAudit"');
    expect(html).toContain('id="flowMode"');
    expect(html).toContain('id="txLabelMode"');
    expect(html).toContain('id="walletLabelMode"');
    expect(html).toContain('id="roleMarksMode"');
    expect(html).toContain('id="expandSelected"');
    expect(html).toContain('id="servicesMode"');
  });
```

- [ ] **Step 2: Run the shell-zone test and confirm it fails**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "analyst workbench shell zones"
```

Expected: FAIL because the new data attributes/classes are not present.

- [ ] **Step 3: Add shell-zone data attributes and class names**

In `src/admin/adminConsole.ts`, update the existing graph workspace markup.

Replace:

```html
      <section class="graph-workspace">
        <div class="graph-topbar">
```

with:

```html
      <section class="graph-workspace" data-workbench-shell>
        <div class="graph-topbar case-header" data-case-header>
```

Replace:

```html
        <div class="graph-action-row">
```

with:

```html
        <div class="graph-action-row workbench-control-rail" data-control-rail>
```

Replace:

```html
        <aside id="caseBriefPanel" class="overlay-panel analytics-panel open" data-overlay="analytics">
```

with:

```html
        <aside id="caseBriefPanel" class="overlay-panel analytics-panel evidence-rail-region open" data-overlay="analytics" data-evidence-rail>
```

Replace:

```html
        <section class="graph-stage">
```

with:

```html
        <section class="graph-stage graph-canvas-region" data-graph-region>
```

Replace:

```html
        <section class="timeline-panel">
```

with:

```html
        <section class="timeline-panel timeline-region" data-timeline-region>
```

- [ ] **Step 4: Add workbench shell CSS**

In the CSS near `.graph-workspace`, replace the current background values with tokenized equivalents:

```css
    .graph-workspace {
      --left-rail-width: 330px;
      --right-rail-width: 380px;
      --rail-gap: 12px;
      position: relative;
      height: calc(100dvh - 56px);
      min-height: 0;
      overflow: hidden;
      background:
        radial-gradient(circle at 50% 42%, rgba(95, 132, 184, .12), transparent 34%),
        linear-gradient(var(--surface-grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--surface-grid) 1px, transparent 1px),
        var(--surface-canvas);
      background-size: auto, 72px 72px, 72px 72px, auto;
    }
```

Add these classes near the existing `.graph-topbar`, `.graph-action-row`, `.overlay-panel.analytics-panel`, `.graph-stage`, and `.timeline-panel` rules:

```css
    .case-header {
      align-items: stretch;
    }
    .workbench-control-rail {
      align-content: start;
    }
    .evidence-rail-region {
      display: none;
    }
    .evidence-rail-region.open {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
    }
    .graph-canvas-region {
      isolation: isolate;
    }
    .timeline-region {
      min-height: 92px;
    }
```

Keep existing responsive CSS. Do not remove the current `.graph-action-row`, `.overlay-panel`, `.timeline-panel`, or `.transfer-panel` selectors in this task.

- [ ] **Step 5: Run shell tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "analyst workbench shell zones|graph-first investigation shell"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "refactor(admin): mark analyst workbench shell zones"
```

Expected: commit succeeds.

---

### Task 3: Human Missing-Data And Evidence Copy Helpers

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add failing helper tests**

Append this test near existing helper extraction tests.

```ts
  it("maps missing data and evidence classes to analyst-readable copy", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(
      html.indexOf("function analystMissingCopy"),
      html.indexOf("function cardLine(")
    );
    expect(helperBlock).toContain("function analystMissingCopy");
    expect(helperBlock).toContain("function analystEvidenceKind");
    expect(helperBlock).toContain("function analystEvidenceMeaning");

    const api = new Function(
      'function edgeEvidenceType(edge) { return edge?.metadata?.evidenceType || edge?.evidenceType || "direct_transfer"; }' +
      'function edgeDisplayRole(edge) { return edge?.displayRole || "real_transfer"; }' +
      'function edgeIsGroupedContextEvidence(edge) { return edge?.metadata?.evidenceType === "grouped_transfers"; }' +
      helperBlock +
      '; return { analystMissingCopy, analystEvidenceKind, analystEvidenceMeaning };'
    )() as {
      analystMissingCopy(kind?: string): string;
      analystEvidenceKind(edge: any): string;
      analystEvidenceMeaning(edge: any): string;
    };

    expect(api.analystMissingCopy("time")).toBe("time not stored");
    expect(api.analystMissingCopy("tx")).toBe("tx hash not stored");
    expect(api.analystMissingCopy("amount")).toBe("amount not stored");
    expect(api.analystMissingCopy("coverage")).toBe("coverage not available");
    expect(api.analystMissingCopy()).toBe("not stored");

    expect(api.analystEvidenceKind({ metadata: { evidenceType: "grouped_transfers" } })).toBe("Grouped transfers");
    expect(api.analystEvidenceKind({ metadata: { evidenceType: "profile_context" } })).toBe("Context evidence");
    expect(api.analystEvidenceKind({ metadata: { evidenceType: "contract_trigger_context" } })).toBe("Contract context");
    expect(api.analystEvidenceKind({ type: "service_boundary", metadata: { evidenceType: "boundary_context" } })).toBe("Service or boundary exposure");

    expect(api.analystEvidenceMeaning({ metadata: { evidenceType: "grouped_transfers" } })).toContain("summarized into one edge");
    expect(api.analystEvidenceMeaning({ metadata: { evidenceType: "profile_context" } })).toContain("not a direct money-flow claim");
    expect(api.analystEvidenceMeaning({ metadata: { evidenceType: "contract_trigger_context" } })).toContain("smart-contract call context");
  });
```

- [ ] **Step 2: Run the helper test and confirm it fails**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "missing data and evidence classes"
```

Expected: FAIL because helper functions do not exist.

- [ ] **Step 3: Add analyst copy helpers**

In `src/admin/adminConsole.ts`, insert these helper functions immediately before `function cardLine(label, value)`.

```js
    function analystMissingCopy(kind = "value") {
      if (kind === "time") return "time not stored";
      if (kind === "tx") return "tx hash not stored";
      if (kind === "amount") return "amount not stored";
      if (kind === "coverage") return "coverage not available";
      if (kind === "directTransfer") return "no direct transfer tx stored";
      if (kind === "checked") return "not checked";
      if (kind === "legacy") return "legacy graph data";
      return "not stored";
    }
    function analystEvidenceKind(edge) {
      const type = edgeEvidenceType(edge);
      if (edgeIsGroupedContextEvidence(edge)) return "Grouped transfers";
      if (type === "direct_transfer" || edgeDisplayRole(edge) === "real_transfer") return "Money flow";
      if (type === "contract_driven_transfer" || type === "approval_drain_transfer") return "Contract-driven movement";
      if (type === "contract_trigger_context" || type === "contract_call_context" || type === "debit_authority_context") return "Contract context";
      if (type === "boundary_context" || type === "boundary_context_only" || edge?.type === "service_boundary") return "Service or boundary exposure";
      if (type === "profile_context" || edgeDisplayRole(edge) === "profile_context") return "Context evidence";
      return "Evidence";
    }
    function analystEvidenceMeaning(edge) {
      const type = edgeEvidenceType(edge);
      if (edgeIsGroupedContextEvidence(edge)) {
        return "Several real transfers are summarized into one edge. This is money-flow evidence when tx hashes or grouped transfer rows are stored.";
      }
      if (type === "direct_transfer" || edgeDisplayRole(edge) === "real_transfer") {
        return "This edge represents a real transfer stored in the graph.";
      }
      if (type === "contract_driven_transfer" || type === "approval_drain_transfer") {
        return "USDT moved through a smart-contract-driven transfer. Read caller, contract, source, and receiver before treating it like a normal wallet send.";
      }
      if (type === "contract_trigger_context" || type === "contract_call_context" || type === "debit_authority_context") {
        return "This is smart-contract call context. It explains how the contract scene was triggered; it is not a normal wallet-to-wallet transfer by itself.";
      }
      if (type === "boundary_context" || type === "boundary_context_only" || edge?.type === "service_boundary") {
        return "This is service or boundary context. Public-chain continuity stops or changes meaning here unless stronger follow-on evidence exists.";
      }
      if (type === "profile_context" || edgeDisplayRole(edge) === "profile_context") {
        return "This is behavioral or profile context, not a direct money-flow claim by itself.";
      }
      return "This graph item is stored evidence for the selected investigation.";
    }
```

- [ ] **Step 4: Replace selected-card missing-data fallbacks**

In `selectedEdgeCard(edge)`, replace:

```js
cardLine("Full time", edgeTime(edge) || "time n/a")
```

with:

```js
cardLine("Full time", edgeTime(edge) || analystMissingCopy("time"))
```

Replace:

```js
cardLine("Tx gap", edgeTxGap(edge) || "n/a")
```

with:

```js
cardLine("Tx gap", edgeTxGap(edge) || analystMissingCopy("time"))
```

Replace:

```js
cardLine("Path", edgePathId(edge) || "n/a")
```

with:

```js
cardLine("Path", edgePathId(edge) || analystMissingCopy())
```

Do not replace every internal `n/a` in this task. This slice targets selected right-rail copy first.

- [ ] **Step 5: Run helper tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "missing data and evidence classes"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat(admin): add analyst evidence copy helpers"
```

Expected: commit succeeds.

---

### Task 4: Right Rail Explanation Templates

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add failing right-rail template tests**

Append this test near the existing selected node/right rail tests.

```ts
  it("leads selected evidence panels with analyst explanations before raw facts", () => {
    const html = adminConsoleHtml();
    const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));
    const walletDetailBlock = html.slice(html.indexOf("function walletDetailBlock"), html.indexOf("function transferDetailBlock"));
    const groupDetailBlock = html.slice(html.indexOf("function groupDetailBlock"), html.indexOf("function bundleDetailBlock"));
    const bundleDetailBlock = html.slice(html.indexOf("function bundleDetailBlock"), html.indexOf("function subjectReportBlock"));

    expect(html).toContain("function analystIntroBlock");
    expect(html).toContain("function analystBadge");
    expect(html).toContain("function analystRawFactsBlock");

    expect(selectedEdgeCardBlock).toContain('analystIntroBlock("What this means", analystEvidenceMeaning(edge)');
    expect(selectedEdgeCardBlock.indexOf("What this means")).toBeLessThan(selectedEdgeCardBlock.indexOf("cardBlockHtml(\"Transactions\""));
    expect(selectedEdgeCardBlock).toContain('analystRawFactsBlock("Raw facts"');

    expect(walletDetailBlock).toContain('analystIntroBlock("Why this node appears"');
    expect(walletDetailBlock).toContain('analystRawFactsBlock(type.label + " raw facts"');

    expect(groupDetailBlock).toContain('analystIntroBlock("What this group means"');
    expect(bundleDetailBlock).toContain('analystIntroBlock("What this bundle means"');
  });
```

- [ ] **Step 2: Run right-rail template test and confirm it fails**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "selected evidence panels"
```

Expected: FAIL because the new template helpers are not present.

- [ ] **Step 3: Add reusable right-rail HTML helpers**

In `src/admin/adminConsole.ts`, insert these helpers immediately after `function cardBlockHtml(label, html)`.

```js
    function analystBadge(label, cls = "evidence") {
      return '<span class="analyst-badge analyst-badge-' + escapeHtml(cls) + '">' + escapeHtml(label) + '</span>';
    }
    function analystIntroBlock(title, text, badges = []) {
      const badgeHtml = asArray(badges).filter(Boolean).join("");
      return '<div class="analyst-intro">' +
        '<div class="analyst-intro-kicker">' + escapeHtml(title) + '</div>' +
        (badgeHtml ? '<div class="analyst-badge-row">' + badgeHtml + '</div>' : "") +
        '<p>' + escapeHtml(text || analystMissingCopy()) + '</p>' +
        '</div>';
    }
    function analystRawFactsBlock(title, rows) {
      const rowHtml = asArray(rows).filter(Boolean).join("");
      if (!rowHtml) return "";
      return cardBlockHtml(title, '<div class="metric-grid">' + rowHtml + '</div>');
    }
    function nodeAnalystMeaning(node) {
      if (!node) return "No node is selected.";
      if (node.kind === "subject") return "This is the checked subject wallet for the active forensic job.";
      if (node.kind === "bundle" || nodeDisplayKind(node) === "funding_bundle") return "This saved funding bundle summarizes several funding inputs so the route stays readable.";
      if (nodeDisplayKind(node) === "collapsed_group") return "This display group collapses lower-priority graph items. Expand it to inspect stored members.";
      if (nodeIsServiceLike(node)) return "This service or boundary node explains where public-chain continuity changes meaning. It is not proof of common ownership by itself.";
      if (node.kind === "wallet") return "This wallet appears because it is connected to the observed graph. Its local risk is only known when this panel shows stored evidence.";
      return "This node is stored graph context for the active investigation.";
    }
```

Add CSS after `.selection-card .card-note { ... }`:

```css
    .analyst-intro {
      display: grid;
      gap: 8px;
      padding: 10px;
      margin-bottom: 10px;
      border: 1px solid rgba(52, 66, 79, .86);
      border-radius: var(--radius-panel);
      background: rgba(8, 12, 17, .72);
    }
    .analyst-intro-kicker {
      color: var(--text-tertiary);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .analyst-intro p {
      margin: 0;
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.45;
    }
    .analyst-badge-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .analyst-badge {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 3px 7px;
      border: 1px solid rgba(52, 66, 79, .88);
      border-radius: 4px;
      background: rgba(13, 18, 23, .78);
      color: var(--text-secondary);
      font-size: 11px;
      font-weight: 650;
      white-space: nowrap;
    }
    .analyst-badge-money { border-color: rgba(111, 207, 151, .38); color: var(--semantic-money-in); }
    .analyst-badge-context { border-color: rgba(154, 166, 179, .38); color: var(--semantic-context); }
    .analyst-badge-boundary { border-color: rgba(214, 177, 95, .42); color: var(--semantic-boundary); }
    .analyst-badge-contract { border-color: rgba(201, 130, 166, .42); color: var(--semantic-contract); }
    .analyst-badge-grouped { border-color: rgba(196, 177, 242, .42); color: var(--semantic-grouped); }
```

- [ ] **Step 4: Update selected edge card**

In `selectedEdgeCard(edge)`, immediately after:

```js
return '<h3>Selected flow</h3>' +
```

insert:

```js
        analystIntroBlock("What this means", analystEvidenceMeaning(edge), [
          analystBadge(analystEvidenceKind(edge), edgeIsGroupedContextEvidence(edge) ? "grouped" : edgeEvidenceType(edge).includes("contract") ? "contract" : edgeEvidenceType(edge).includes("boundary") ? "boundary" : edgeDisplayRole(edge) === "profile_context" ? "context" : "money")
        ]) +
```

Near the end of `selectedEdgeCard(edge)`, replace:

```js
        cardLine("Path", edgePathId(edge) || analystMissingCopy()) +
        note;
```

with:

```js
        analystRawFactsBlock("Raw facts", [
          metric("Evidence type", edgeEvidenceTypeLabel(edge)),
          metric("Path", edgePathId(edge) || analystMissingCopy()),
          metricHtml("Tx", edgePrimaryTxDetailHtml(edge), "wide")
        ]) +
        note;
```

If this creates duplicate `Evidence type` or `Tx` lines, keep the earlier high-level lines for now and remove only the duplicate raw line that appears lower in the same selected card.

- [ ] **Step 5: Update node, group, and bundle detail blocks**

In `groupDetailBlock(node, graph)`, immediately after `return '<div class="metric-grid">' +`, add:

```js
        analystIntroBlock("What this group means", groupKindExplanation(node), [
          analystBadge("Display group", "grouped")
        ]) +
```

In `bundleDetailBlock(node, graph)`, immediately after `return '<div class="metric-grid">' +`, add:

```js
        analystIntroBlock("What this bundle means", groupKindExplanation(node), [
          analystBadge("Funding bundle", "grouped")
        ]) +
```

In `walletDetailBlock(node, graph)`, immediately after `return '<div class="metric-grid">' +`, add:

```js
        analystIntroBlock("Why this node appears", nodeAnalystMeaning(node), [
          analystBadge(type.label, nodeIsServiceLike(node) ? "boundary" : node.kind === "bundle" ? "grouped" : "context")
        ]) +
```

In `walletDetailBlock(node, graph)`, replace:

```js
        rawBlock(type.label + " JSON", node) +
```

with:

```js
        analystRawFactsBlock(type.label + " raw facts", [
          metric("Technical type", technicalNodeType(node)),
          metric("Technical name", technicalNodeName(node)),
          metric("Related paths", relatedPaths.length)
        ]) +
        rawBlock(type.label + " JSON", node) +
```

- [ ] **Step 6: Run right-rail tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "selected evidence panels|boundary identity details|wallet-cluster role"
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat(admin): lead evidence rail with analyst explanations"
```

Expected: commit succeeds.

---

### Task 5: Graph Legend And Canvas Semantic Polish

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add failing graph legend tests**

Append this test near existing `graphLegendHtml` tests.

```ts
  it("uses analyst workbench graph legend categories", () => {
    const html = adminConsoleHtml();
    const legendBlock = html.slice(html.indexOf("function graphLegendHtml"), html.indexOf("function edgeSemanticAttrs"));

    expect(legendBlock).toContain('item("direct", "Real money flow")');
    expect(legendBlock).toContain('item("group", "Grouped transfers")');
    expect(legendBlock).toContain('item("inferred", "Context / peer")');
    expect(legendBlock).toContain('item("service", "Service / CEX")');
    expect(legendBlock).toContain('item("boundary", "Boundary stop")');
    expect(legendBlock).toContain('item("contract", "Contract context")');

    expect(html).toContain(".legend-swatch.contract");
    expect(html).toContain("border-color: var(--semantic-contract);");
    expect(html).toContain(".edge-flow-incoming { stroke: var(--semantic-money-in); }");
    expect(html).toContain(".edge-flow-outgoing { stroke: var(--semantic-money-out); }");
    expect(html).toContain(".edge.edge-deep-grouped-transfer");
    expect(html).toContain("stroke: var(--semantic-grouped);");
  });
```

- [ ] **Step 2: Run legend test and confirm it fails**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "graph legend categories"
```

Expected: FAIL because legend labels and tokenized edge colors are not all present.

- [ ] **Step 3: Tokenize core edge colors**

In `src/admin/adminConsole.ts`, update the edge CSS declarations:

Replace:

```css
    .edge-flow-incoming { stroke: #62d28f; }
    .edge-flow-outgoing { stroke: #ff5966; }
```

with:

```css
    .edge-flow-incoming { stroke: var(--semantic-money-in); }
    .edge-flow-outgoing { stroke: var(--semantic-money-out); }
```

Replace the final grouped-transfer override block:

```css
    .edge.edge-deep-grouped-transfer,
    .edge.edge-flow-peer.edge-deep-grouped-transfer,
    .edge.edge-flow-service.edge-deep-grouped-transfer,
    .edge.edge-flow-incoming.edge-deep-grouped-transfer,
    .edge.edge-flow-outgoing.edge-deep-grouped-transfer {
      stroke: rgba(178, 163, 224, .78);
      stroke-dasharray: 8 8;
      opacity: .76;
    }
```

with:

```css
    .edge.edge-deep-grouped-transfer,
    .edge.edge-flow-peer.edge-deep-grouped-transfer,
    .edge.edge-flow-service.edge-deep-grouped-transfer,
    .edge.edge-flow-incoming.edge-deep-grouped-transfer,
    .edge.edge-flow-outgoing.edge-deep-grouped-transfer {
      stroke: var(--semantic-grouped);
      stroke-dasharray: 8 8;
      opacity: .72;
    }
```

Replace:

```css
    .edge.edge-contract-trigger-context { stroke: rgba(196, 132, 172, .78); stroke-dasharray: 6 8; opacity: .76; }
```

with:

```css
    .edge.edge-contract-trigger-context { stroke: var(--semantic-contract); stroke-dasharray: 6 8; opacity: .72; }
```

- [ ] **Step 4: Update legend swatches and labels**

In CSS near `.legend-swatch.boundary`, add:

```css
    .legend-swatch.contract { border-color: var(--semantic-contract); border-top-style: dashed; }
```

In `graphLegendHtml(mode)`, update the legend labels so the returned strings include these exact items:

```js
          item("direct", "Real money flow") +
          item("group", "Grouped transfers") +
          item("inferred", "Context / peer") +
          item("service", "Service / CEX") +
          item("boundary", "Boundary stop") +
          item("contract", "Contract context") +
```

For modes that should not show every category, still include the relevant subset, but at least one branch must include all six labels so the admin has the full semantic key in graph-heavy modes.

- [ ] **Step 5: Run legend and grouped-edge tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "graph legend categories|edge arrow markers|edge labels"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "style(admin): clarify graph legend semantics"
```

Expected: commit succeeds.

---

### Task 6: Timeline, Transfer Table, And No-Selection States

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add failing timeline and transfer-state tests**

Append this test near existing transfer panel tests.

```ts
  it("uses analyst copy for timeline transfer and no-selection states", () => {
    const html = adminConsoleHtml();
    const renderDetailsBlock = html.slice(html.indexOf("function renderDetails"), html.indexOf("function cardLine("));
    const transferPanelBlock = html.slice(html.indexOf('<section class="transfer-panel'), html.indexOf('<section class="timeline-panel'));
    const timelineBlock = html.slice(html.indexOf('<section class="timeline-panel'), html.indexOf('<select id="layoutMode"'));

    expect(renderDetailsBlock).toContain("Select a completed or partial job to inspect evidence.");
    expect(renderDetailsBlock).toContain("No graph evidence is selected.");
    expect(transferPanelBlock).toContain("Selected evidence");
    expect(timelineBlock).toContain("Activity timeline");
    expect(timelineBlock).toContain("Open transfer list");
    expect(html).toContain("function transferTableEmptyCopy");
    expect(html).toContain("function timelineEmptyCopy");
    expect(html).toContain("No transfers match the current filters.");
    expect(html).toContain("Select an edge, node, or path to inspect related transfers.");
  });
```

- [ ] **Step 2: Run timeline/transfer-state test and confirm it fails**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "timeline transfer and no-selection"
```

Expected: FAIL because the new copy helpers and labels are not present.

- [ ] **Step 3: Update static transfer/timeline labels**

In `src/admin/adminConsole.ts`, replace the transfer tab label:

```html
            <button id="tabSelected" type="button">Selected path</button>
```

with:

```html
            <button id="tabSelected" type="button">Selected evidence</button>
```

Replace:

```html
            <button id="toggleTransfers" type="button">Transfers</button>
```

with:

```html
            <button id="toggleTransfers" type="button">Open transfer list</button>
```

Replace the hidden details initial content:

```html
          <div id="details" class="details-body empty">Select a completed or partial job.</div>
```

with:

```html
          <div id="details" class="details-body empty">Select a completed or partial job to inspect evidence.</div>
```

- [ ] **Step 4: Add transfer/timeline empty-copy helpers**

Insert these helpers before `function renderTransferTabs()`.

```js
    function transferTableEmptyCopy() {
      if (!state.graph) return "Select a completed or partial job to inspect evidence.";
      if (state.transferTab === "selected") return "Select an edge, node, or path to inspect related transfers.";
      if (state.transferTab === "stops") return "No boundary stops are stored for this graph.";
      return "No transfers match the current filters.";
    }
    function timelineEmptyCopy() {
      if (!state.graph) return "Select a graph to inspect transfer timing.";
      return "No timestamped transfer activity is stored for the current filters.";
    }
```

In `renderTransferTabs()`, replace the existing empty-state assignment:

```js
        root.innerHTML = '<div class="empty">' + (state.transferTab === "selected" ? "Select an edge or node." : "No graph edges found.") + '</div>';
```

with:

```js
        root.innerHTML = '<div class="empty">' + escapeHtml(transferTableEmptyCopy()) + '</div>';
```

In `renderActivityTimeline()`, replace:

```js
        hint.textContent = "Select a graph to inspect transfers.";
```

with:

```js
        hint.textContent = timelineEmptyCopy();
```

Replace:

```js
        hint.textContent = "No timestamped transfer activity in this graph.";
```

with:

```js
        hint.textContent = timelineEmptyCopy();
```

- [ ] **Step 5: Update renderDetails no-selection copy**

In `renderDetails()`, replace:

```js
        root.innerHTML = "Select a completed or partial job.";
```

with:

```js
        root.innerHTML = "Select a completed or partial job to inspect evidence.";
```

In the branch where `state.graph` exists but `state.selected` does not, add a simple no-selection intro before the summary metrics:

```js
      const noSelectionIntro = analystIntroBlock("No graph evidence is selected", "Select a node, edge, group, service, or boundary to inspect what it means and which raw facts support it.", [
        analystBadge("case summary", "context")
      ]);
```

Then prepend `noSelectionIntro` to the existing summary:

```js
      root.innerHTML = noSelectionIntro + '<div class="metric-grid">' +
```

- [ ] **Step 6: Run timeline/transfer tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "timeline transfer and no-selection|transfer table|Activity timeline"
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "copy(admin): improve transfer and timeline empty states"
```

Expected: commit succeeds.

---

### Task 7: Focused Verification And Local QA

**Files:**
- Verify: `src/admin/adminConsole.ts`
- Verify: `tests/admin/adminConsole.test.ts`
- Verify: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Run focused admin tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts tests/admin/forensicsGraph.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 4: Restart admin server from the current branch**

Find the existing server process on `127.0.0.1:8787`:

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess
```

If a process is listening, stop only that owning process:

```powershell
$conn = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force }
```

Start the app:

```powershell
Start-Process -FilePath "npm" -ArgumentList @("run", "dev") -WorkingDirectory "C:\Users\User\OneDrive\Desktop\smartcontract" -WindowStyle Hidden
```

Verify the admin page responds:

```powershell
$html = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8787/admin/forensics").Content
$html.Contains("data-workbench-shell")
```

Expected: `True`.

- [ ] **Step 5: Manual QA checklist**

Open:

```text
http://127.0.0.1:8787/admin/forensics
```

Check these job types from the Jobs panel:

```text
address_deep_check
where_is_money_check
incoming_deposit_check
address_fast_check
```

For each available job type, verify:

```text
- Case header shows subject, job kind, status, decision/risk/coverage where stored.
- Left controls are reachable and do not overlap the graph.
- Graph still renders and fit/reset/zoom controls work.
- Selecting a node shows "Why this node appears" before raw JSON.
- Selecting an edge shows "What this means" before transaction/raw facts.
- Selecting grouped evidence keeps grouped color, label, and arrow marker.
- Context edges do not look like primary money flow.
- Transfer drawer opens and empty states are readable.
- Timeline empty or populated state is readable.
- Raw evidence remains visible lower in the right rail.
```

- [ ] **Step 6: Commit verification-only fixes if any**

If manual QA reveals small presentation regressions and fixes are made, run the focused tests again:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts tests/admin/forensicsGraph.test.ts
npm run typecheck
```

Then commit:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix(admin): polish analyst workbench qa issues"
```

Expected: commit succeeds only if files changed.

---

## Plan Self-Review

### Spec Coverage

- Analyst Workbench direction: Tasks 1, 2, 4, 6.
- Small SOC/risk/status indicators: Task 1.
- No framework migration or new dependency: File structure and all implementation tasks.
- Shell zones: Task 2.
- Right rail human explanation first: Task 4.
- Missing-data copy: Tasks 3 and 6.
- Graph semantic colors and legend: Task 5.
- Timeline/transfer inspection layer: Task 6.
- QA matrix across job types: Task 7.

### Type And Naming Consistency

- New helper names are defined once and reused consistently:
  - `analystMissingCopy`
  - `analystEvidenceKind`
  - `analystEvidenceMeaning`
  - `analystBadge`
  - `analystIntroBlock`
  - `analystRawFactsBlock`
  - `nodeAnalystMeaning`
  - `transferTableEmptyCopy`
  - `timelineEmptyCopy`
- New shell attributes are stable:
  - `data-workbench-shell`
  - `data-case-header`
  - `data-control-rail`
  - `data-graph-region`
  - `data-evidence-rail`
  - `data-timeline-region`

### Placeholder Scan

This plan intentionally avoids placeholder tasks. Every code-changing step includes concrete snippets and every verification step includes exact commands and expected results.

## Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-07-02-admin-forensics-analyst-workbench-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using `executing-plans`, with checkpoints between slices.

Which approach?
