# Admin Forensics Analyst Workbench Redesign

Date: 2026-07-02

Status: approved design direction, ready for implementation planning.

## Goal

Repair the existing admin forensics console so it reads like a serious analyst workbench instead of a debug-heavy graph dump.

This is not a full product rewrite. Keep the current forensics graph, job model, evidence semantics, and admin workflows. Improve the visual hierarchy, control layout, selected-evidence explanation, timeline/transfer inspection, and design consistency around the existing admin console.

The approved direction is:

```text
Analyst Workbench base
  + small, local SOC/risk status indicators
  - no alarm-screen redesign
  - no framework migration
```

## Current Problems

The current admin forensics screen has useful forensic functionality, but the presentation is too close to an internal debug tool:

- the toolbar mixes navigation, graph modes, label controls, service toggles, peer links, and reset actions in one noisy row;
- the graph has many line styles, labels, glows, and timestamps competing for attention;
- the right rail often starts with raw evidence fields instead of explaining what the selected node or edge means;
- `n/a`, raw path ids, and technical evidence names appear before human meaning;
- dense cases make low-priority context, grouped transfers, services, and primary money flow feel similarly important;
- time and transaction-gap data exists, but it does not consistently read as a timeline story;
- status and risk signals are present, but they do not form a stable case summary.

The product rule from earlier graph specs still applies:

> Do not draw something as money flow unless it is a real transaction or a group of real transactions.

This redesign must reinforce that rule visually and textually.

## Design Profile

Use the local `design-taste-frontend` skill as a taste layer, adapted for this specific admin:

- `DESIGN_VARIANCE`: 5-6. Modern and structured, not artsy chaos.
- `MOTION_INTENSITY`: 2-3. Hover, focus, active states, and small transitions only.
- `VISUAL_DENSITY`: 8. This is a forensic analyst cockpit, not a landing page.

Use the local `redesign-existing-projects` skill as the audit checklist:

- improve typography, contrast, spacing, states, and copy;
- work with the existing stack;
- avoid generic AI dashboard patterns;
- do not rewrite functionality just to make the screen look new.

## Scope

### In Scope

- Reorganize the current shell into a clearer workbench layout.
- Normalize CSS tokens for surfaces, text, borders, semantic colors, status chips, buttons, focus, and hover states.
- Reduce graph visual noise while preserving evidence semantics.
- Make legends, line styles, labels, and selected states consistent.
- Rewrite right-rail content so it leads with human explanation and moves raw facts below it.
- Improve time, tx-gap, grouped-transfer, missing-data, and no-selection copy.
- Add or refine loading, empty, error, and no-data states for admin panels.
- Add focused tests around shell structure, right-rail templates, and graph visual semantics.
- Manually QA DeepCheck, Where Is Money, Incoming Deposit, and FastCheck views.

### Out Of Scope

- No React, Tailwind, shadcn, or component-library migration.
- No new icon dependency in the first pass.
- No scoring, graph projection, transaction fetching, database schema, or forensic logic changes unless a UI bug exposes a data contract issue.
- No total redesign of every admin page outside `/admin/forensics`.
- No hiding raw evidence from audit or raw graph modes.
- No decorative animation, cinematic motion, or dashboard marketing treatment.

## Information Architecture

Use the existing graph-first screen, but reorganize it into stable zones.

### 1. Case Header

Top of the screen should answer:

- what subject is being inspected;
- what job kind is active;
- job status and completion time;
- decision/risk state;
- coverage or evidence completeness where available;
- graph counts such as nodes, edges, paths, and grouped transfers.

Status treatment:

- `Completed`, `Running`, `Failed`, and `Partial` are job states.
- `Review`, `Acceptable`, `Decline`, and similar decisions are case outcomes.
- `High`, `Medium`, `Low`, or score values are risk signals.
- Coverage is evidence completeness, not the same thing as risk.

These should be visually distinct small indicators, not one generic row of chips.

### 2. Left Control Rail

Move high-level controls out of the overloaded top toolbar into a structured left rail:

- case navigation: Graph, Jobs, Analytics, Scoring audit;
- graph mode: Wallet clusters, Show all raw, Deep branch map, Flow map where applicable;
- evidence layers: Services, Peer context, Role marks, Raw tx labels;
- local actions: Fit, Reset layout, Expand/collapse selected.

The left rail is for controls. It should not become a second evidence panel.

### 3. Central Graph Canvas

The graph remains the primary work area.

Canvas rules:

- labels stay compact;
- important labels show amount, tx count, and time when available;
- full interpretation moves to the right rail;
- selected edges/nodes get emphasis, but default glows stay subtle;
- raw audit mode may be visually noisy, but semantic views should not be.

### 4. Right Evidence Rail

The right rail explains the selected node, edge, group, service, or boundary.

It should follow this order:

1. selected type and short title;
2. evidence badges;
3. "What this means";
4. key facts: amount, time, from, to, tx count, coverage, confidence;
5. analyst checks or next useful action;
6. raw facts: evidence type, path id, tx hashes, technical metadata.

Raw evidence stays available, but it should not be the first thing the analyst has to decode.

### 5. Bottom Timeline And Transfers

The bottom area remains the inspection layer:

- timeline summarizes activity distribution;
- transfer tabs show all transfers, selected path, and boundaries/stops;
- selected graph items can open the relevant transfer list;
- tx gaps should be phrased as time between events, not just a raw field.

The transfer table should use tabular numbers and stable columns so amounts and times are scannable.

## Visual Language

### Palette

Keep a dark analyst interface, but clean up the palette:

- off-black canvas and dark charcoal panels;
- one cool gray family for neutral surfaces and borders;
- semantic colors only where they carry meaning;
- no decorative purple/blue gradients;
- no default neon glow layer.

Semantic colors remain:

- green: real incoming money flow;
- red: real outgoing money flow;
- purple: grouped real transfers or funding bundles;
- rose: contract-call or contract-driven context;
- gold: service, CEX, or boundary exposure;
- gray: context, peer, inferred, or secondary evidence.

### Edge Language

Graph edge styles must remain evidence-driven:

- solid green or red means real transfer direction;
- purple dashed means grouped real transfers and should show tx count when known;
- gray dashed means context, peer, inferred, or secondary relationship;
- rose dashed means smart-contract call/context;
- rose solid means contract-driven movement when the graph stores it as money movement;
- gold dashed means service or boundary exposure.

Do not use orange/gold for ordinary wallet-to-wallet peer transfers. It should be reserved for service, boundary, bundle, or exposure meaning.

### Labels

Canvas labels should be short:

```text
3 tx · 2.53M USDT
Jul 01, 14:05
```

or:

```text
50K USDT
Jun 18, 15:26
```

For context-only edges:

```text
Context
no direct transfer tx stored
```

Avoid:

- long technical labels on the canvas;
- `unknown evidence` as a primary label;
- `n/a` when a clearer missing-data phrase exists;
- color-coding every piece of text as if it were a risk signal.

### Risk And Status

SOC-style elements are allowed only as local indicators:

- decision badge;
- risk badge;
- coverage badge;
- evidence-quality badge;
- data-warning badge.

They should not recolor the whole screen or make every graph edge look like an alarm.

## Right Rail Templates

### Node Selected

The node rail should answer:

- what kind of node this is;
- why it appears in this graph;
- whether it has a known role or service identity;
- whether the role is proven, inferred, or just context;
- related transfers and raw address facts.

Example wording:

```text
What this means
This wallet appears because it funded the selected path. It is not a standalone completed wallet check unless this panel says so.
```

### Edge Selected

The edge rail should answer:

- whether the edge is money flow, grouped transfer, profile context, boundary, service exposure, or contract-driven movement;
- from/to;
- amount and time;
- tx hashes or grouped tx list;
- path context.

Example wording:

```text
What this means
Several real transfers from the same source to the same counterparty are summarized into one edge. This is evidence of money movement, not just profile context.
```

### Group Selected

The group rail should answer:

- what is collapsed;
- member count;
- total amount and tx count;
- which visible edges are represented;
- expand/collapse action;
- warnings when a group has incomplete metadata.

Groups of one wallet should not be presented as groups in the first implementation pass unless there is a strong technical reason. If a one-member group still appears due to stored legacy data, the rail should call it a display bundle or data-quality issue, not a wallet cluster.

### Boundary Or Service Selected

The boundary rail should answer:

- what service or boundary was reached;
- why the investigation stops or changes meaning here;
- whether this is a CEX, DEX, bridge, contract, service boundary, or history stop;
- what evidence produced that classification;
- what not to infer from it.

Example wording:

```text
What this means
This is a service boundary. It explains graph context; it is not proof that every connected wallet belongs to the same owner.
```

## Missing Data Copy

Replace generic `n/a` with explicit missing-data states:

- `not stored`;
- `not checked`;
- `no direct transfer tx stored`;
- `time not stored`;
- `tx hash not stored`;
- `amount not stored`;
- `coverage not available`;
- `legacy graph data`.

This avoids implying a clean result when the system simply lacks evidence.

## Implementation Slices

### Slice 1: Design Tokens

Normalize:

- colors;
- type scale;
- numeric/tabular typography;
- panel styles;
- chips;
- buttons;
- focus rings;
- hover/active states;
- selected states.

This should be the lowest-risk first implementation slice.

### Slice 2: Workbench Shell

Reorganize the shell into:

- case header;
- left control rail;
- central graph canvas;
- right evidence rail;
- bottom timeline/transfers.

Keep existing graph rendering and data loading behavior intact.

### Slice 3: Evidence Rail

Refactor selected-node, selected-edge, selected-group, and boundary/service detail rendering into clearer explanation templates.

The target is better copy and information order, not new evidence generation.

### Slice 4: Graph Polish

Polish:

- legend;
- line hierarchy;
- label density;
- selected-state emphasis;
- grouped edge labels;
- transfer table presentation;
- timeline readability.

Do this after shell and right rail rules are stable.

## QA Matrix

### Modes

Verify these job types:

- `address_deep_check`;
- `where_is_money_check`;
- `incoming_deposit_check`;
- `address_fast_check`.

For `address_deep_check`, verify:

- Wallet clusters;
- Deep branch map;
- Show all raw.

For `where_is_money_check`, verify:

- grouped funding;
- CEX/service identity display;
- contract scenes;
- normal wallet-to-wallet transfers.

For `incoming_deposit_check`, verify:

- incoming/outgoing direction color;
- funding bundle display;
- selected path;
- sparse graph states.

For `address_fast_check`, verify:

- simple graph rendering;
- empty or sparse evidence handling;
- no broken controls for modes that do not apply.

### Visual Failure Checks

- No toolbar, rail, graph, transfer panel, or timeline overlap at desktop widths.
- No text clipping inside chips, buttons, amount labels, right rail rows, or transfer table cells.
- Selected grouped edge remains visibly grouped, including arrow marker and label.
- Context edges do not look like primary money flow.
- Service/boundary colors are not used for ordinary peer transfers.
- Raw audit mode still exposes available graph data.
- Keyboard focus is visible on controls.
- Loading, empty, error, and no-selection states are readable.

### Automated Checks

Add focused tests where practical:

- admin HTML contains workbench shell zones;
- right rail templates lead with `What this means`;
- missing-data copy avoids raw `n/a` for user-facing selected evidence;
- grouped-transfer visual marker/label rules remain present;
- graph legend uses the approved semantic categories;
- control labels remain present for graph modes and evidence layers.

Continue running:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts tests/admin/forensicsGraph.test.ts
npm run typecheck
```

For broader confidence before shipping a major redesign slice:

```powershell
npm test
```

## Acceptance Criteria

1. An admin can identify subject, job kind, job status, decision, risk/coverage, and selected evidence meaning without reading raw JSON.
2. Canvas labels remain compact and do not try to explain every field.
3. The right rail clearly states whether selected evidence is money flow, grouped transfer, context, boundary, service exposure, or contract-driven movement.
4. Semantic graph colors are consistent across DeepCheck, Where Is Money, Incoming Deposit, and FastCheck where applicable.
5. Missing data is phrased honestly and does not imply a clean result.
6. Raw evidence remains available in details and raw/audit views.
7. Existing graph behavior is not changed by the visual redesign unless a separate implementation plan explicitly calls out the data contract change.
8. Focused admin tests, typecheck, and manual visual QA pass before merge.

## Design Decisions

- Use `Analyst Workbench` as the main direction.
- Borrow only small risk/status elements from `SOC Console`.
- Do not use the full `design-taste-frontend` default profile; adapt it to a dense forensic admin.
- Do not install a new frontend framework or design package for the first pass.
- Do not solve graph-data bugs inside this visual redesign unless they block the UI contract.
- Write the implementation plan as small reviewable slices instead of one large rewrite.
