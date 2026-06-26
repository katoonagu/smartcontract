# Admin Node Intelligence Role Marks Design

Date: 2026-06-26

## Context

Admin graph UI already has a graph-first workspace, semantic layouts, flow colors, timeline labels, bundles, services, boundary stops, and selected-node details. The next idea is to make important wallet roles visible without turning the graph into noise.

The main correction from the failed quick attempt: the frontend must not guess roles from graph shape. A wallet that has one incoming and one outgoing edge can be a normal hop, a user wallet, a service route, a mule, or something else. If the UI marks it as `Mule` only because of shape, the graph becomes misleading.

Node Intelligence is therefore a data-backed layer. Backend projection decides whether a node has a role. Admin UI only displays that role and explains it.

## Goal

Show wallet-level role context in the admin graph so an analyst can quickly notice important nodes such as drainers, victims, transit wallets, and collectors, while keeping the current graph readable and preserving scoring/traversal behavior.

## Non-Goals

- Do not change final risk scoring.
- Do not change FastCheck, DeepCheck, Where Is Money, or incoming-deposit traversal.
- Do not classify roles in the frontend from graph shape alone.
- Do not add USDT blacklist/frozen marks in this release.
- Do not add liquidity, exchange, bridge, DEX, or service-specific role icons in this release.
- Do not render small floating badges on the top-right of nodes.
- Do not enable role icons by default until the right-panel role data is verified on real jobs.
- Do not replace the current graph-first admin layout.

## First Release Scope

The first release adds role data to graph nodes and exposes it in the selected-node panel.

Included:

- role metadata in admin graph nodes;
- selected-node panel fields for role, evidence strength, explanation, and source;
- tests that prove role metadata is projected from real forensic data;
- no visual role icons on the graph by default.

Excluded from first release:

- icons inside graph nodes;
- role-mark toggle;
- new image asset serving;
- new scoring rules;
- new data providers.

## Second Release Scope

The second release adds a visual layer after role data is verified.

Included:

- `Role marks on/off` toggle;
- icon drawn inside the node circle, not as a separate top-right badge;
- visual style controlled by role and evidence strength;
- selected-node details remain the source of truth;
- role marks hidden when role data is missing or low confidence.

## Role Model

Each node can have zero or one primary role. Secondary roles are out of scope for this release.

Primary roles:

- `drainer`
- `victim`
- `mule_transit`
- `collector`

Role evidence strength:

- `hard`: exact or near-exact evidence, for example approval-drain provenance.
- `behavior`: deterministic behavioral signal, for example collector-like wallet role from backend analysis.
- `context`: weak context that should be shown only in the detail panel in this release.

Role source:

- `approval_drain`
- `wallet_role_classifier`
- `address_behavior`
- `counterparty_profile`
- `manual_label`
- `unknown`

Node role payload:

```ts
type AdminNodeIntelligenceRole =
  | "drainer"
  | "victim"
  | "mule_transit"
  | "collector";

type AdminNodeIntelligenceEvidenceStrength =
  | "hard"
  | "behavior"
  | "context";

type AdminNodeIntelligence = {
  role: AdminNodeIntelligenceRole;
  label: string;
  evidenceStrength: AdminNodeIntelligenceEvidenceStrength;
  source: string;
  confidence: number | null;
  explanation: string;
  signals: string[];
};
```

The field should live on the admin graph node metadata first, for compatibility with the existing graph API:

```ts
node.metadata.nodeIntelligence = {
  role: "collector",
  label: "Collector",
  evidenceStrength: "behavior",
  source: "wallet_role_classifier",
  confidence: 70,
  explanation: "Backend role classifier found collector-like behavior.",
  signals: ["address_behavior_collector_like_wallet"]
}
```

## Role Meaning

### Drainer

Meaning:

The wallet or contract is tied to drain evidence. This is a high-priority role.

Allowed sources:

- exact approval-drain spender;
- exact drainer label;
- backend-proven drain provenance.

UI treatment:

- first release: selected-node panel only;
- second release: skull/sabers icon inside a dark red/black node treatment;
- no role mark unless evidence strength is `hard`.

### Victim

Meaning:

The wallet is the affected wallet in a drain/theft context.

Allowed sources:

- approval-drain victim;
- theft report victim;
- backend-proven victim role.

UI treatment:

- first release: selected-node panel only;
- second release: red target overlay inside the node circle;
- victim mark should not imply the wallet itself is risky.

### Mule / Transit

Meaning:

The wallet appears to act as a pass-through or relay in a suspicious route. This is behavior/context, not hard dirty-funds proof by itself.

Allowed sources:

- backend wallet role classifier;
- deposit-then-drain signal;
- transit/redistribution signal;
- source policy or counterparty profile that explicitly emits transit behavior.

UI treatment:

- first release: selected-node panel only;
- second release: mule icon inside a teal node treatment;
- do not infer this role just because a node has one inbound and one outbound edge.

### Collector

Meaning:

The wallet appears to aggregate funds from multiple sources or collect funds after a drain/session. This is important for investigation but can be behavior-only.

Allowed sources:

- backend wallet role classifier;
- collector-like behavior signal;
- possible collector drain signal;
- fan-in/fan-out signal from backend analysis.

UI treatment:

- first release: selected-node panel only;
- second release: diamond/star icon inside a violet node treatment;
- do not infer this role from graph layout alone.

## Backend Projection Rules

Role projection should happen in `src/admin/forensicsGraph.ts`, not in `src/admin/adminConsole.ts`.

The projection can use existing report data only:

- wallet role classifier output;
- approval drain provenance;
- address behavior features;
- counterparty risk profiles;
- inbound provenance profiles;
- manual labels if already present in result data.

Projection priority:

1. `drainer` with hard evidence.
2. `victim` with hard evidence.
3. `collector` with explicit collector signal.
4. `mule_transit` with explicit mule/transit signal.

If two roles compete, keep the stronger evidence. If evidence strength is equal, prefer the more specific role:

`drainer` > `victim` > `collector` > `mule_transit`.

Do not attach role metadata to service, CEX, DEX, bridge, contract, bundle, or stop nodes in the first release.

## Admin Panel UI

When a node is selected, the right-side selected-node panel should show:

- role label;
- evidence strength;
- confidence;
- source;
- explanation;
- source signals.

Example:

```text
Node role
Collector

Evidence
behavior - confidence 70

Why
Backend classifier found collector-like flow behavior.

Signals
address_behavior_collector_like_wallet
```

If no role exists:

```text
Node role
No role marker
```

The panel must explain that behavior roles are attention markers, not final risk proof.

## Graph Visual UI

Graph role icons are second release only.

Rules:

- render only when `Role marks` toggle is on;
- render only for nodes with `node.metadata.nodeIntelligence`;
- render inside the node circle;
- never render a small separate top-right badge;
- do not change node position or edge routing;
- do not resize the whole graph;
- selected-node glow should remain readable;
- if icon hurts readability at current zoom, hide the icon and keep the node ring/color.

Visual mapping:

| Role | Visual |
| --- | --- |
| `drainer` | skull/sabers inside dark red-black node |
| `victim` | red target overlay inside neutral node |
| `mule_transit` | mule icon inside teal node |
| `collector` | diamond/star inside violet node |

## Interaction Rules

Hover:

- keep existing graph hover behavior;
- role mark may show a short tooltip with role label and evidence strength.

Click:

- selected-node panel is authoritative;
- panel shows full role explanation;
- selected-node focus must not be hidden by the role icon.

Search:

- role labels should be searchable in the first release;
- searching `collector`, `mule`, `victim`, or `drainer` should find matching nodes once role metadata exists.

## Data Safety

The UI must never imply a behavior role is hard proof.

Required wording:

- `hard`: "Hard evidence"
- `behavior`: "Behavior marker"
- `context`: "Context marker"

For behavior/context roles, selected-node panel must include:

```text
This marker is investigation context, not final risk proof by itself.
```

## Testing

Add tests in the smallest useful places:

1. Graph projection tests:
   - approval-drain spender becomes `drainer`;
   - approval-drain victim becomes `victim`;
   - collector classifier output becomes `collector`;
   - mule/transit classifier output becomes `mule_transit`;
   - service/contract/bundle/stop nodes do not receive wallet role marks.

2. Admin console HTML tests:
   - selected-node panel contains role fields;
   - no graph role icon code is enabled in first release;
   - role wording distinguishes hard evidence from behavior/context.

3. Manual QA:
   - open FastCheck, DeepCheck, Where Is Money, and incoming deposit jobs;
   - select wallet nodes with and without role metadata;
   - verify graph visuals are unchanged in first release;
   - verify no small floating role badge appears.

## Acceptance Criteria

- Current graph-first admin UI remains visually unchanged in first release.
- Selected-node panel shows role metadata when backend projection emits it.
- Frontend does not infer roles from graph shape.
- Behavior roles are clearly labeled as investigation context, not hard proof.
- Drainer/victim roles require hard evidence.
- No role icons are drawn on graph nodes until the second release toggle is implemented.
- Existing graph layouts for fast, deep, where-is-money, and incoming deposit remain intact.
- `npm run typecheck` passes.
- Relevant admin graph tests pass.
