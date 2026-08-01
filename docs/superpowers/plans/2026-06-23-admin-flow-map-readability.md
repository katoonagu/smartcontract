# Admin Flow Map Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make incoming-deposit and where-is-money admin graphs easier to read by separating side groups from the main money flow, keeping boundary/service stops close, and making edge labels readable without covering the route.

**Architecture:** Keep the current vanilla HTML/SVG admin console. Add small helper functions inside the existing admin client script, then update `flowMapLayout`, edge label rendering, and tests. Do not introduce React or a new graph engine in this iteration.

**Tech Stack:** TypeScript, existing admin HTML/SVG client embedded in `src/admin/adminConsole.ts`, Vitest tests in `tests/admin/adminConsole.test.ts`.

---

## File Structure

- Modify `src/admin/adminConsole.ts`
  - Time formatting helpers for human-readable canvas labels.
  - Edge label role helpers so labels inherit the line color.
  - Edge label placement helper so chips stay close to their own line and skip `time n/a`.
  - Flow-map layout rules for side lanes, boundary/CEX clamp, and less crossing.
- Modify `tests/admin/adminConsole.test.ts`
  - String-structure tests for new helpers and routing rules.
  - Regression checks for readable time, no `time n/a` on canvas, colored labels, side-lane groups, and boundary stop clamp.
- Optional manual QA only, no new dependency:
  - Open `http://127.0.0.1:8790/admin/forensics`.
  - Inspect the same incoming-deposit jobs from screenshots.

---

### Task 1: Lock Expected Label Behavior In Tests

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add a failing test for readable canvas time and hiding missing time**

Add this test near the existing `"caps edge thickness and shows compact honest time on canvas labels"` test:

```ts
  it("formats canvas edge time as readable UTC text and hides missing canvas time", () => {
    const html = adminConsoleHtml();
    const timeBlock = html.slice(html.indexOf("function canvasTimestampLabel"), html.indexOf("function edgeCanvasTimeLabel"));
    const edgeTimeBlock = html.slice(html.indexOf("function edgeCanvasTimeLabel"), html.indexOf("function edgeSpeedMs"));

    expect(html).toContain("const canvasMonthNames =");
    expect(html).toContain("function canvasTimestampLabel");
    expect(timeBlock).toContain('const includeYear = date.getUTCFullYear() !== new Date().getUTCFullYear();');
    expect(timeBlock).toContain('return (includeYear ? date.getUTCFullYear() + " " : "") + canvasMonthNames[date.getUTCMonth()] + " " + day + ", " + hour + ":" + minute;');
    expect(edgeTimeBlock).toContain('return canvasTimestampLabel(edge?.timestamp || edgeTime(edge));');
    expect(edgeTimeBlock).not.toContain('|| "time n/a"');
  });
```

- [ ] **Step 2: Add a failing test for edge label color classes**

Add this test after the readable time test:

```ts
  it("colors edge labels from their edge role and speed state", () => {
    const html = adminConsoleHtml();
    const pillBlock = html.slice(html.indexOf("function amountPill"), html.indexOf("function canvasNodeLabel"));
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));

    expect(html).toContain("function edgeLabelRoleClass");
    expect(html).toContain(".amount-pill.label-role-incoming rect");
    expect(html).toContain(".amount-pill.label-role-service rect");
    expect(html).toContain(".amount-pill.label-role-stop rect");
    expect(html).toContain(".amount-pill.label-role-peer rect");
    expect(pillBlock).toContain('roleClass = ""');
    expect(pillBlock).toContain('const className = "amount-pill" +');
    expect(renderBlock).toContain("const labelRoleClass = edgeLabelRoleClass(edge);");
    expect(renderBlock).toContain("amountPill(label, labelPoint.x, labelPoint.y, speedClass, labelRoleClass)");
  });
```

- [ ] **Step 3: Run the tests and confirm these new tests fail**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: FAIL because `canvasTimestampLabel`, `edgeLabelRoleClass`, and `labelPoint` do not exist yet.

---

### Task 2: Implement Human Time And Colored Edge Labels

**Files:**
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Replace the technical timestamp formatter for canvas labels**

Find `function shortTimestamp(value)` and add this helper next to it:

```js
    const canvasMonthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    function canvasTimestampLabel(value) {
      if (!value) return "";
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return "";
      const day = String(date.getUTCDate()).padStart(2, "0");
      const hour = String(date.getUTCHours()).padStart(2, "0");
      const minute = String(date.getUTCMinutes()).padStart(2, "0");
      const includeYear = date.getUTCFullYear() !== new Date().getUTCFullYear();
      return (includeYear ? date.getUTCFullYear() + " " : "") + canvasMonthNames[date.getUTCMonth()] + " " + day + ", " + hour + ":" + minute;
    }
```

- [ ] **Step 2: Stop rendering `time n/a` on the graph canvas**

Change `edgeCanvasTimeLabel` to this:

```js
    function edgeCanvasTimeLabel(edge) {
      const hold = formatDurationMs(edge?.metadata?.holdMs ?? edge?.metadata?.holdBeforeNextMs);
      if (hold) return "hold " + hold;
      const span = formatDurationMs(edge?.metadata?.timeSpanMs ?? edge?.timeSpanMs);
      if (span) return "span " + span;
      const gap = edgeTxGap(edge);
      if (gap) return "gap " + gap;
      return canvasTimestampLabel(edge?.timestamp || edgeTime(edge));
    }
```

This keeps full missing-time detail in the right rail and transfer table, but removes noisy `time n/a` chips from the map.

- [ ] **Step 3: Add edge label role classes**

Add this helper near `edgeSpeedClass`:

```js
    function edgeLabelRoleClass(edge) {
      const role = edgeVisualRole(edge);
      if (role === "incoming") return "label-role-incoming";
      if (role === "outgoing") return "label-role-outgoing";
      if (role === "service") return "label-role-service";
      if (role === "stop") return "label-role-stop";
      if (role === "peer") return "label-role-peer";
      return "label-role-context";
    }
```

- [ ] **Step 4: Extend `amountPill` without changing call sites yet**

Change:

```js
    function amountPill(label, x, y, speedClass = "") {
```

to:

```js
    function amountPill(label, x, y, speedClass = "", roleClass = "") {
```

Then change its class builder to:

```js
      const className = "amount-pill" + (speedClass ? " " + escapeHtml(speedClass) : "") + (roleClass ? " " + escapeHtml(roleClass) : "");
```

- [ ] **Step 5: Add CSS for label role coloring**

In the existing `.amount-pill` CSS block, keep amount text white and make the chip accent inherit the edge role:

```css
      .amount-pill rect { fill: rgba(11, 14, 17, .88); stroke: rgba(237, 244, 251, .14); stroke-width: 1; rx: 5; vector-effect: non-scaling-stroke; }
      .amount-pill text { fill: #ffffff; font-size: 10.5px; font-weight: 500; paint-order: stroke; stroke: rgba(11, 14, 17, .65); stroke-width: 1.5px; stroke-linejoin: round; }
      .amount-pill .time-line { fill: #c3ced9; font-size: 9.5px; font-weight: 560; }
      .amount-pill.label-role-incoming rect { stroke: rgba(123, 226, 166, .48); }
      .amount-pill.label-role-outgoing rect { stroke: rgba(255, 132, 142, .44); }
      .amount-pill.label-role-service rect { stroke: rgba(255, 211, 107, .52); }
      .amount-pill.label-role-stop rect { stroke: rgba(246, 193, 119, .58); }
      .amount-pill.label-role-peer rect { stroke: rgba(246, 193, 119, .36); }
      .amount-pill.label-role-context rect { stroke: rgba(151, 164, 184, .32); }
```

- [ ] **Step 6: Run label tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: the two new label tests still fail until render uses `labelPoint` in Task 3.

---

### Task 3: Keep Edge Labels Close To Their Own Line

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add a failing test for label placement helper**

Add this test near the label tests:

```ts
  it("places edge labels near the routed edge midpoint instead of floating far away", () => {
    const html = adminConsoleHtml();
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));

    expect(html).toContain("function edgeLabelPoint");
    expect(html).toContain("const labelNormalOffset = Math.max(8, Math.min(12, length * 0.035));");
    expect(renderBlock).toContain("const labelPoint = edgeLabelPoint(startX, startY, endX, endY, edge);");
    expect(renderBlock).not.toContain("const labelX = midX - (dy / length) * 14;");
    expect(renderBlock).not.toContain("const labelY = midY + (dx / length) * 14;");
  });
```

- [ ] **Step 2: Implement the helper**

Add this helper near `edgeCurvePath` or before `renderGraph`:

```js
    function edgeLabelPoint(startX, startY, endX, endY, edge) {
      const dx = endX - startX;
      const dy = endY - startY;
      const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      const labelNormalOffset = Math.max(8, Math.min(12, length * 0.035));
      const role = edgeVisualRole(edge);
      const side = role === "stop" || role === "peer" ? -1 : 1;
      return {
        x: midX - (dy / length) * labelNormalOffset * side,
        y: midY + (dx / length) * labelNormalOffset * side
      };
    }
```

- [ ] **Step 3: Use `edgeLabelPoint` and label role in rendering**

In `renderGraph`, replace the old label coordinate block:

```js
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        const labelX = midX - (dy / length) * 14;
        const labelY = midY + (dx / length) * 14;
```

with:

```js
        const labelPoint = edgeLabelPoint(startX, startY, endX, endY, edge);
```

Then change:

```js
          amountPill(label, labelX, labelY, speedClass) + '</g>';
```

to:

```js
          amountPill(label, labelPoint.x, labelPoint.y, speedClass, labelRoleClass) + '</g>';
```

and define:

```js
        const labelRoleClass = edgeLabelRoleClass(edge);
```

before the return.

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: new label tests pass.

---

### Task 4: Separate Purple Groups From The Main Flow

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add a failing test for group side lanes**

Replace or extend the current provenance flow-map layout test with these expectations:

```ts
    expect(flowMapLayoutBlock).toContain("function flowMapBundleLaneSide");
    expect(flowMapLayoutBlock).toContain("const bundleSide = flowMapBundleLaneSide(anchor, mainY, slot);");
    expect(flowMapLayoutBlock).toContain("const bundleLaneGap = compactLane ? 210 : 180;");
    expect(flowMapLayoutBlock).toContain("const y = anchor ? anchor.y + bundleLaneGap * bundleSide + Math.floor(slot / 3) * 92 * bundleSide : mainY + bundleLaneGap * bundleSide + Math.floor(index / 4) * 92 * bundleSide;");
```

- [ ] **Step 2: Add the lane side helper**

Add this helper before `flowMapLayout`:

```js
    function flowMapBundleLaneSide(anchor, mainY, slot) {
      if (!anchor) return slot % 2 === 0 ? 1 : -1;
      if (anchor.y >= mainY) return 1;
      return -1;
    }
```

The rule is intentionally simple: bundles attached to an upper path stay above, bundles attached to a lower path stay below. This prevents purple group lines from cutting through the main route.

- [ ] **Step 3: Replace bundle placement**

Inside `flowMapLayout`, replace:

```js
      const bundleLaneOffsetY = compactLane ? 190 : 150;
```

with:

```js
      const bundleLaneGap = compactLane ? 210 : 180;
```

Then replace bundle node placement with:

```js
      const bundleSlotByAnchor = new Map();
      bundleNodes.sort(stableNodeSort).forEach((node, index) => {
        const anchor = flowMapBundleAnchor(node, sourceEdges, placedById);
        const key = anchor?.id || "free";
        const slot = bundleSlotByAnchor.get(key) || 0;
        bundleSlotByAnchor.set(key, slot + 1);
        const bundleSide = flowMapBundleLaneSide(anchor, mainY, slot);
        const x = anchor ? anchor.x + 96 + (slot % 3) * 126 : width * 0.52 + (index % 4 - 1.5) * 150;
        const y = anchor ? anchor.y + bundleLaneGap * bundleSide + Math.floor(slot / 3) * 92 * bundleSide : mainY + bundleLaneGap * bundleSide + Math.floor(index / 4) * 92 * bundleSide;
        const placed = { ...node, x, y };
        nodes.push(placed);
        placedById.set(node.id, placed);
      });
```

- [ ] **Step 4: Keep bundle members around the side-lane bundle, not under the main route**

In bundle member placement, change:

```js
        const angle = -0.95 + slot * 0.38;
        const radius = 94 + Math.floor(slot / 6) * 42;
        const x = parent ? parent.x + Math.cos(angle) * radius : width * 0.42 + (index % 5) * 82;
        const y = parent ? parent.y + 82 + Math.sin(angle) * radius : mainY + 260 + Math.floor(index / 5) * 72;
```

to:

```js
        const side = parent && parent.y < mainY ? -1 : 1;
        const angle = (side < 0 ? 0.65 : -0.65) + slot * 0.34;
        const radius = 96 + Math.floor(slot / 6) * 42;
        const x = parent ? parent.x + Math.cos(angle) * radius : width * 0.42 + (index % 5) * 82;
        const y = parent ? parent.y + side * (72 + Math.abs(Math.sin(angle) * radius)) : mainY + side * (270 + Math.floor(index / 5) * 72);
```

- [ ] **Step 5: Run admin console tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: provenance layout test passes after updating old `bundleLaneOffsetY` expectations.

---

### Task 5: Clamp Boundary And Service Stops Near The Related Path

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add a failing test for stop clamp**

Add expectations to the provenance flow-map layout test:

```ts
    expect(flowMapLayoutBlock).toContain("const stopColumnGap = 260;");
    expect(flowMapLayoutBlock).toContain("const x = related ? (side === \"left\" ? Math.max(stopLeftX, related.x - stopColumnGap) : Math.min(stopRightX, related.x + stopColumnGap)) : (side === \"left\" ? stopLeftX : stopRightX);");
    expect(flowMapLayoutBlock).not.toContain("x: side === \"left\" ? stopLeftX : stopRightX,");
```

- [ ] **Step 2: Implement stop clamp**

Inside `flowMapLayout`, after `const stopRightX = width - 150;`, add:

```js
      const stopColumnGap = 260;
```

Then replace stop placement with:

```js
      stopNodes.sort(stableNodeSort).forEach((node, index) => {
        const side = flowMapStopSide(node);
        const related = flowMapConnectedPlacedNodes(node, sourceEdges, placedById)[0];
        const x = related ? (side === "left" ? Math.max(stopLeftX, related.x - stopColumnGap) : Math.min(stopRightX, related.x + stopColumnGap)) : (side === "left" ? stopLeftX : stopRightX);
        const placed = {
          ...node,
          x,
          y: related ? related.y + 72 + (index % 3) * 52 : mainY + (index - (stopNodes.length - 1) / 2) * 92
        };
        nodes.push(placed);
        placedById.set(node.id, placed);
      });
```

- [ ] **Step 3: Keep service nodes close but still on the edge**

Change service base placement from:

```js
      const serviceBaseX = Math.min(width - 180 - serviceColumnGap * (serviceColumns - 1), Math.max(width * 0.76, pathEndX + 140));
```

to:

```js
      const serviceBaseX = Math.min(width - 180 - serviceColumnGap * (serviceColumns - 1), pathEndX + 220);
```

This keeps CEX/DEX/bridge visually near the trace end instead of at the far canvas edge.

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: provenance layout test passes.

---

### Task 6: Tune Fast-Chain Highlighting Without Adding More Visual Noise

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add a regression test for 24-hour speed thresholds and selected glow**

Update the existing edge-speed expectations:

```ts
    expect(html).toContain('if (ms <= 15 * 60000) return "edge-speed-strong";');
    expect(html).toContain('if (ms <= 60 * 60000) return "edge-speed-medium";');
    expect(html).toContain('if (ms <= 6 * 60 * 60000) return "edge-speed-soft";');
    expect(html).toContain('if (ms <= 24 * 60 * 60000) return "edge-speed-faint";');
    expect(html).toContain(".edge.selected { filter: drop-shadow(0 0 12px rgba(125, 166, 255, .42)); }");
    expect(html).toContain(".amount-pill.edge-speed-faint { filter: drop-shadow(0 0 4px rgba(237, 244, 251, .14)); }");
```

- [ ] **Step 2: Add a faint pill glow for 24-hour chains**

Extend CSS:

```css
      .amount-pill.edge-speed-faint { filter: drop-shadow(0 0 4px rgba(237, 244, 251, .14)); }
      .edge.selected { filter: drop-shadow(0 0 12px rgba(125, 166, 255, .42)); }
```

Keep line glow white and understated. Keep node selected glow based on node type, as already implemented.

- [ ] **Step 3: Run tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: speed/glow tests pass.

---

### Task 7: Manual QA On The Three Problem Shapes

**Files:**
- No code files unless a bug is found.

- [ ] **Step 1: Start admin from the updated worktree**

Use the existing admin runner if it is still alive. If not, start the project admin the same way the last deployment did and open:

```text
http://127.0.0.1:8790/admin/forensics
```

- [ ] **Step 2: Check screenshot 1/2 style job**

Open the `incoming_deposit_check` around:

```text
Tfcs8oa9zd...66Gte6NwCy
2026-06-23T16:04:09.581Z
```

Expected:
- Main money route is readable left-to-right.
- Time chips do not sit far from their edge.
- No `time n/a` chip on the canvas.
- Boundary/router stop is closer to the related node.

- [ ] **Step 3: Check screenshot 3/4 style job**

Open the `incoming_deposit_check` around:

```text
TMBxxoKePS...CFsWpnw7Dx
2026-06-23T14:42:59.305Z
```

Expected:
- Purple groups sit above or below the main route.
- Group lines do not cross the main green path unnecessarily.
- Boundary stop is near the path end, not far-right canvas edge.

- [ ] **Step 4: Check screenshot 5 style job**

Open the later `incoming_deposit_check` around:

```text
TMBxxoKePS...CFsWpnw7Dx
2026-06-23T15:07:19.330Z
```

Expected:
- The graph resembles a spread flow route instead of a compressed knot.
- Group branches remain readable as side lanes.
- Edge labels inherit line color and selected edge highlights line + label together.

- [ ] **Step 5: Run final checks**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
npm run typecheck
git diff --check
```

Expected:
- Admin console tests pass.
- Typecheck passes.
- No whitespace errors.

---

## Self-Review

- Spec coverage: covers all user feedback from the latest screenshots: label obstruction, purple groups away from main flow, CEX/boundary closer, line-colored chips, readable dates, and no far `time n/a` chips.
- Placeholder scan: no unresolved placeholder markers and no vague “handle edge cases” task.
- Type consistency: all new helpers are plain client-side JS functions inside `adminConsole.ts`; tests look for those exact function names.
- Scope check: deliberately avoids React migration. Current issue is solvable inside existing SVG renderer with less risk.
