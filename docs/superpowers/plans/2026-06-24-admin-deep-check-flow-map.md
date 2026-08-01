# Admin Deep-Check Flow Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `address_deep_check` readable in the admin graph by defaulting dense deep-check graphs to Flow Map and separating opposite-direction edges between the same wallets.

**Architecture:** Keep the current vanilla HTML/SVG admin console. Reuse the existing Flow Map layout and edge-label pipeline; add a small pair-aware edge routing index so opposite and parallel edges get different curves and labels.

**Tech Stack:** TypeScript, server-rendered admin HTML string, SVG, Vitest string/behavior tests.

---

## Context

Spec: `docs/superpowers/specs/2026-06-24-admin-deep-check-flow-map-design.md`

Primary files:

- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

Current relevant functions:

- `graphKindUsesFlowMap`
- `graphDisplayMode`
- `edgeCurveControlPoint`
- `edgeCurvePath`
- `edgeLabelPoint`
- `renderGraph`
- `expandSelectedGraphItem`

Keep the existing uncommitted label and flow-map readability fixes. Do not revert them.

---

### Task 1: Route Dense Deep-Check Graphs To Flow Map

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Write the failing test**

Add this test near the existing graph layout tests in `tests/admin/adminConsole.test.ts`:

```ts
  it("uses flow-map layout for address deep checks instead of dense fan", () => {
    const html = adminConsoleHtml();
    const kindBlock = html.slice(html.indexOf("function graphKindUsesFlowMap"), html.indexOf("function graphKindSupportsStepOrbit"));

    expect(kindBlock).toContain('kind === "address_deep_check"');
    expect(kindBlock).toContain('kind === "incoming_deposit_check"');
    expect(kindBlock).toContain('kind === "where_is_money_check"');
    expect(html).toContain('if (graphKindUsesFlowMap(state.graph?.job?.kind)) return "flow_map";');
    expect(html).toContain('if (mode === "show_all" && (dense || graphKindUsesFlowMap(state.graph?.job?.kind))) return timelineLaneLayout(sourceNodes, sourceEdges);');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: FAIL because `graphKindUsesFlowMap` does not include `address_deep_check`.

- [ ] **Step 3: Implement minimal code**

Change `graphKindUsesFlowMap` in `src/admin/adminConsole.ts` from:

```js
    function graphKindUsesFlowMap(kind) {
      return kind === "incoming_deposit_check" || kind === "where_is_money_check";
    }
```

to:

```js
    function graphKindUsesFlowMap(kind) {
      return kind === "incoming_deposit_check" || kind === "where_is_money_check" || kind === "address_deep_check";
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Only commit if this task is being executed independently:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix: render deep checks as flow maps"
```

---

### Task 2: Add Pair-Aware Routing For Opposite-Direction Edges

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Write the failing test**

Add this test near `"places edge labels near the routed edge midpoint instead of floating far away"`:

```ts
  it("routes opposite-direction edges between the same wallets on separate arcs", () => {
    const html = adminConsoleHtml();
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));
    const routeBlock = html.slice(html.indexOf("function edgePairKey"), html.indexOf("function edgeCurvePath"));

    expect(html).toContain("function edgePairKey");
    expect(html).toContain("function buildEdgeRouteIndex");
    expect(html).toContain("function edgeRouteFor");
    expect(routeBlock).toContain("directionSign");
    expect(routeBlock).toContain("sameDirectionIndex");
    expect(routeBlock).toContain("sameDirectionCount");
    expect(routeBlock).toContain("parallelOffset");
    expect(html).toContain("function edgeCurveControlPoint(startX, startY, endX, endY, edge, route = null)");
    expect(html).toContain("function edgeCurvePath(startX, startY, endX, endY, edge, route = null)");
    expect(html).toContain("function edgeLabelPoint(startX, startY, endX, endY, edge, route = null)");
    expect(renderBlock).toContain("const edgeRouteIndex = buildEdgeRouteIndex(visibleEdges);");
    expect(renderBlock).toContain("const route = edgeRouteFor(edge, edgeRouteIndex);");
    expect(renderBlock).toContain("const labelPoint = edgeLabelPoint(startX, startY, endX, endY, edge, route);");
    expect(renderBlock).toContain("const pathD = edgeCurvePath(startX, startY, endX, endY, edge, route);");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: FAIL because route helpers do not exist.

- [ ] **Step 3: Add route helpers**

In `src/admin/adminConsole.ts`, insert these helpers immediately before `edgeCurveControlPoint`:

```js
    function edgePairKey(edge) {
      const from = String(edge?.fromNodeId || "");
      const to = String(edge?.toNodeId || "");
      return from <= to ? from + "↔" + to : to + "↔" + from;
    }
    function edgeDirectionSign(edge) {
      const from = String(edge?.fromNodeId || "");
      const to = String(edge?.toNodeId || "");
      return from <= to ? 1 : -1;
    }
    function buildEdgeRouteIndex(edges) {
      const groups = new Map();
      edges.forEach((edge) => {
        const key = edgePairKey(edge);
        const group = groups.get(key) || [];
        group.push(edge);
        groups.set(key, group);
      });
      const routes = new Map();
      groups.forEach((group) => {
        const byDirection = new Map();
        group.forEach((edge) => {
          const sign = edgeDirectionSign(edge);
          const bucket = byDirection.get(sign) || [];
          bucket.push(edge);
          byDirection.set(sign, bucket);
        });
        byDirection.forEach((bucket, sign) => {
          bucket.forEach((edge, sameDirectionIndex) => {
            routes.set(edge.id, {
              pairCount: group.length,
              directionSign: sign,
              sameDirectionIndex,
              sameDirectionCount: bucket.length,
              parallelOffset: (sameDirectionIndex - (bucket.length - 1) / 2) * 0.08
            });
          });
        });
      });
      return routes;
    }
    function edgeRouteFor(edge, edgeRouteIndex) {
      return edgeRouteIndex.get(edge?.id) || {
        pairCount: 1,
        directionSign: edgeDirectionSign(edge),
        sameDirectionIndex: 0,
        sameDirectionCount: 1,
        parallelOffset: 0
      };
    }
```

- [ ] **Step 4: Use route in edge curves and labels**

Change `edgeCurveControlPoint` signature and curve logic:

```js
    function edgeCurveControlPoint(startX, startY, endX, endY, edge, route = null) {
      const dx = endX - startX;
      const dy = endY - startY;
      const role = edgeVisualRole(edge);
      const baseCurve = edgeFlowDirection(edge) === "incoming" ? -0.18 : 0.18;
      const routeCurve = route && route.pairCount > 1
        ? route.directionSign * 0.28 + route.parallelOffset
        : baseCurve;
      const curve = (role === "peer" || role === "stop" ? routeCurve * 1.3 : routeCurve);
      return {
        x: (startX + endX) / 2 - dy * curve,
        y: (startY + endY) / 2 + dx * curve
      };
    }
```

Change `edgeCurvePath` signature and control call:

```js
    function edgeCurvePath(startX, startY, endX, endY, edge, route = null) {
      const dx = endX - startX;
      const dy = endY - startY;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      if (distance < 80) return "M " + startX + " " + startY + " L " + endX + " " + endY;
      const control = edgeCurveControlPoint(startX, startY, endX, endY, edge, route);
      return "M " + startX + " " + startY + " Q " + control.x + " " + control.y + " " + endX + " " + endY;
    }
```

Change `edgeLabelPoint` signature and control call:

```js
    function edgeLabelPoint(startX, startY, endX, endY, edge, route = null) {
      const dx = endX - startX;
      const dy = endY - startY;
      const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const useCurve = length >= 80;
      const control = useCurve ? edgeCurveControlPoint(startX, startY, endX, endY, edge, route) : null;
      const t = edgeVisualRole(edge) === "stop" ? 0.58 : 0.52;
      const pointX = control ? (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * control.x + t * t * endX : (startX + endX) / 2;
      const pointY = control ? (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * control.y + t * t * endY : (startY + endY) / 2;
      const tangentX = control ? 2 * (1 - t) * (control.x - startX) + 2 * t * (endX - control.x) : dx;
      const tangentY = control ? 2 * (1 - t) * (control.y - startY) + 2 * t * (endY - control.y) : dy;
      const tangentLength = Math.max(1, Math.sqrt(tangentX * tangentX + tangentY * tangentY));
      const labelNormalOffset = Math.max(16, Math.min(24, length * 0.045));
      const role = edgeVisualRole(edge);
      const side = role === "stop" || role === "peer" ? -1 : 1;
      return {
        x: pointX - (tangentY / tangentLength) * labelNormalOffset * side,
        y: pointY + (tangentX / tangentLength) * labelNormalOffset * side
      };
    }
```

- [ ] **Step 5: Build and use route index in renderGraph**

In `renderGraph`, immediately after `const grid = ...`, add:

```js
      const edgeRouteIndex = buildEdgeRouteIndex(visibleEdges);
```

Inside the `edgeRenderItems` map, before `const selected = ...`, add:

```js
        const route = edgeRouteFor(edge, edgeRouteIndex);
```

Change:

```js
        const labelPoint = edgeLabelPoint(startX, startY, endX, endY, edge);
```

to:

```js
        const labelPoint = edgeLabelPoint(startX, startY, endX, endY, edge, route);
```

Return `route` in the item:

```js
        return { edge, route, cls, visualRole, speedClass, startX, startY, endX, endY, label, labelPoint, labelRoleClass, metrics };
```

In the edge SVG map, destructure `route`:

```js
        const { edge, route, cls, visualRole, speedClass, startX, startY, endX, endY, label, labelRoleClass } = item;
```

Change:

```js
        const pathD = edgeCurvePath(startX, startY, endX, endY, edge);
```

to:

```js
        const pathD = edgeCurvePath(startX, startY, endX, endY, edge, route);
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Only commit if this task is being executed independently:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix: separate opposite graph edges"
```

---

### Task 3: Make Deep-Check Expansion Feedback Explicit

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Write the failing test**

Update the existing `"shows funding bundles as expandable groups with right-rail internals"` test. Replace:

```ts
    expect(html).toContain('setStatus("Selected item has no expandable internals.");');
```

with:

```ts
    expect(html).toContain('setStatus("Selected item has no stored expansion data. Deep-check context can only expand groups or bundles that were saved in graph data.");');
```

Add this expectation to the same test:

```ts
    expect(html).toContain("Deep-check context can only expand stored groups, bundles, and known links.");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: FAIL because the clearer deep-check expansion text is not present.

- [ ] **Step 3: Add clearer no-data text**

In `groupDetailBlock`, after the `metric("Role", ...) +` line, add:

```js
        metric("Expansion rule", "Deep-check context can only expand stored groups, bundles, and known links.", "wide") +
```

In `expandSelectedGraphItem`, replace:

```js
        setStatus("Selected item has no expandable internals.");
```

with:

```js
        setStatus("Selected item has no stored expansion data. Deep-check context can only expand groups or bundles that were saved in graph data.");
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Only commit if this task is being executed independently:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix: explain deep graph expansion limits"
```

---

### Task 4: Verification And Admin Restart

**Files:**
- No source changes expected.

- [ ] **Step 1: Run full admin console tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript check**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Check whitespace**

Run:

```powershell
git diff --check
```

Expected: no errors. Windows LF/CRLF warnings are acceptable.

- [ ] **Step 4: Restart admin on port 8790**

Run:

```powershell
$ErrorActionPreference='Stop'
$worktree='C:\Users\User\OneDrive\Desktop\smartcontract\.worktrees\master-merge-push'
$mainEnv='C:\Users\User\OneDrive\Desktop\smartcontract\.env'
$port=8790
$listeners=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach($listener in $listeners){
  $proc=Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
  if($proc -and $proc.ProcessName -eq 'node'){ Stop-Process -Id $proc.Id -Force }
}
$runner=Join-Path $env:TEMP 'smartcontract-admin-8790-runner.ts'
$out=Join-Path $worktree 'runtime-logs\admin-master.out.log'
$err=Join-Path $worktree 'runtime-logs\admin-master.err.log'
$env:DOTENV_CONFIG_PATH=$mainEnv
Start-Process -FilePath 'node' -ArgumentList @('--import','tsx',$runner) -WorkingDirectory $worktree -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden
Start-Sleep -Milliseconds 1500
Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Select-Object LocalAddress,LocalPort,OwningProcess
```

Expected: one listener on `127.0.0.1:8790`.

- [ ] **Step 5: Verify served HTML contains the new behavior**

Run:

```powershell
$r=Invoke-WebRequest -Uri 'http://127.0.0.1:8790/admin/forensics' -UseBasicParsing -TimeoutSec 5
[pscustomobject]@{
  Status=$r.StatusCode
  DeepUsesFlowMap=$r.Content.Contains('kind === "address_deep_check"')
  HasRouteIndex=$r.Content.Contains('function buildEdgeRouteIndex')
  HasRoutedLabels=$r.Content.Contains('edgeLabelPoint(startX, startY, endX, endY, edge, route)')
  HasExpansionLimitText=$r.Content.Contains('Deep-check context can only expand groups or bundles')
} | Format-List
```

Expected:

```text
Status                : 200
DeepUsesFlowMap       : True
HasRouteIndex         : True
HasRoutedLabels       : True
HasExpansionLimitText : True
```

- [ ] **Step 6: Final commit**

If Tasks 1-3 were not committed independently, commit all source/test changes together:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix: improve deep-check graph routing"
```

---

## Self-Review

Spec coverage:

- Deep-check Flow Map default: Task 1.
- Opposite-direction edge separation: Task 2.
- Labels attached to their own routed curve: Task 2.
- Missing amount remains honest: already implemented in current dirty worktree and preserved by existing tests.
- Expansion no-data explanation: Task 3.
- Verification and admin restart: Task 4.

Placeholder scan: no unresolved placeholders.

Type consistency:

- Route helper names are consistent: `edgePairKey`, `buildEdgeRouteIndex`, `edgeRouteFor`.
- Route object fields are consistent: `pairCount`, `directionSign`, `sameDirectionIndex`, `sameDirectionCount`, `parallelOffset`.
- The render path passes the same `route` object to `edgeLabelPoint` and `edgeCurvePath`.
