# Admin Deep Check Multi-Hop Branch Map Design

Date: 2026-06-24

## Goal

Make `address_deep_check` readable as a multi-hop investigation graph, not as a one-hop fast-check fan.

The analyst should be able to see:

- the checked wallet;
- direct counterparties around it;
- second-hop and third-hop branches around important counterparties;
- service, CEX, DEX, bridge, contract, and boundary exposure;
- amounts and time gaps on visible transfer edges;
- neighbor-to-neighbor links where counterparties interact with each other;
- the actual risk and decision state when the deep-check result has them.

This design is only for `address_deep_check`. It must not change `incoming_deposit_check` or `where_is_money_check`.

## Current Problem

The deep check collects more context than the admin graph currently communicates.

The current admin projection can include direct counterparties, inbound provenance paths, boundary flows, service exposure profiles, and expansion boundary stops. Visually, however, the canvas often looks like a fast-check graph: most edges cluster around the subject wallet and the next hops do not read as separate branches.

The graph also becomes unreadable when all of this is shown at once:

- wallet labels overlap;
- edge labels overlap;
- parallel transfers between the same wallets stack on top of each other;
- service nodes mix with ordinary wallets;
- second-hop context does not look like a second hop;
- risk in the right rail can show `n/a / unknown` because the deep-check projection currently does not surface the computed result risk.

## Recommended Direction

Use a new default deep-check display named `Deep Branch Map`.

The map should show direct counterparties as step-1 nodes, then give important step-1 nodes their own local branches. This keeps the fast-check fan idea, but repeats it around important neighboring wallets instead of putting every edge around the checked wallet.

Default behavior:

- services are visible by default;
- amounts and time/gap labels are visible on every visible transaction edge;
- wallet labels are visible in smart mode, with collision avoidance;
- dense low-priority raw detail is grouped, not deleted;
- `Show all raw` remains available for full inspection.

## Layout Model

### Subject Zone

The checked wallet stays near the center. It is visually distinct from every other wallet.

The subject zone shows direct incoming and outgoing counterparties. These are step-1 nodes.

### Step-1 Counterparty Branches

Important direct counterparties get local branch space around themselves.

Each important counterparty can show:

- its inbound sources;
- its outbound receivers;
- its service or boundary touches;
- its peer links to other visible wallets;
- its grouped low-priority neighbors.

This is the key change from the current layout. Branches should originate from the counterparty that owns them, not from the subject.

### Step-2 And Step-3 Branches

If deep-check data includes a multi-hop path, the graph should display it as a path:

`source -> step-2 wallet -> step-1 wallet -> checked wallet`

or:

`checked wallet -> step-1 wallet -> service/boundary`

If a step has too many children, show a group node such as:

`Group: 12 wallets`

The group node is not a wallet. Selecting it should explain what is inside and offer expansion.

### Service And Boundary Zones

Services are visible by default.

CEX, DEX, bridge, contract, and boundary nodes should not be mixed into ordinary wallet clusters. They should sit in a side zone near the relevant branch:

- not far away from the money path;
- not covering the main path;
- visibly different from ordinary wallets.

Boundary stops should remain at the edge of the relevant branch so the analyst can see where the investigation stopped.

### Peer Links

Peer links between neighboring wallets are important for deep check.

They should be visible but lower priority than the main flow:

- thinner;
- lower opacity;
- dashed or secondary styled;
- highlighted when either endpoint is selected.

Peer links should show that neighbors are connected to each other without making the primary money path unreadable.

## Label Rules

### Transaction Labels

Default transaction label mode is `All`.

Visible transaction edges should show:

- short amount;
- readable date/time or gap.

The UI must not invent missing amounts. If an edge has no amount in the data, it shows only time/gap.

Add a transaction label control:

- `All`: show amount plus time/gap on all visible transfer edges;
- `Important`: show labels only for large, fast, service, boundary, selected, or high-risk edges;
- `Selected`: show labels only for the selected path or selected branch;
- `Off`: hide canvas transaction labels, while details remain in the right rail.

`All` is the default for deep check.

### Wallet Labels

Wallet labels should not become gray unlabeled dots by default.

Default wallet label mode is `Smart`.

Smart mode:

- subject label is always visible;
- service and boundary labels are always visible;
- important direct counterparties are visible;
- ordinary wallets use short labels when there is room;
- labels that collide can be hidden on the canvas but remain available on hover and in the right rail;
- selected node always shows its label.

Add a wallet label control:

- `Smart`: default collision-aware short labels;
- `All`: all short wallet labels;
- `Important`: subject, top wallets, services, boundaries, selected branch;
- `Off`: circles only, with hover and right-rail detail.

## Detail Modes

### Overview

Default mode for dense deep-check graphs.

Overview keeps the investigation readable by grouping low-priority repeated detail while still showing the main branches, services, boundaries, amounts, and times.

### Expand Selected

Expands only the selected group, branch, service, or counterparty.

It should not explode the entire graph into raw detail.

Expected examples:

- select `Group: 12 wallets` -> show member wallets for that group;
- select a step-1 counterparty -> show its local fan;
- select a service boundary -> show the wallet path that reached it.

### Show All Raw

Shows the raw graph with minimal grouping.

This mode can be dense. It is for audit and manual exploration, not the default reading experience.

## Risk And Decision Display

The right rail must not show `n/a / unknown` by default if deep-check result data contains risk or decision fields.

Risk display rules:

- if final deep-check risk is present, show score, band, and decision;
- if the job is partial and final risk is not available, show `Partial: final risk not ready`;
- if final risk is missing but profile/context scores exist, show a context summary instead of plain `unknown`;
- explain whether the score is wallet risk, path risk, service boundary context, or partial context.

This is a display fix, not a scoring change.

## Data Rules

The graph should use existing deep-check data first:

- `counterpartyRiskProfiles`;
- `directCounterpartyInteractionProfiles`;
- `inboundProvenanceProfiles`;
- `boundaryExposureProfiles`;
- `serviceExposureProfiles`;
- expansion boundary stops.

If the existing projection only has profile-level aggregates for a branch, the UI should show that branch as a profile/context edge rather than pretending it is a raw transfer.

If raw hop data is unavailable, the UI should explain that the branch is summarized.

## Controls

Deep-check graph controls should include:

- `Graph: Overview / Expand selected / Show all raw`;
- `Tx labels: All / Important / Selected / Off`;
- `Wallet labels: Smart / All / Important / Off`;
- `Services: On / Off`, with `On` as default;
- `Peer links: On / Off`;
- `Reset layout`.

## Non-Goals

This design does not rewrite the admin console to React.

This design does not replace `incoming_deposit_check` or `where_is_money_check` layouts.

This design does not change risk scoring logic.

This design does not require a new graph dependency in the first implementation pass.

## Acceptance Criteria

- `address_deep_check` opens with services visible.
- `address_deep_check` no longer reads as only a one-hop fast-check fan when multi-hop data exists.
- Important direct counterparties can have local step-2 and step-3 branches.
- Amount and time/gap labels are visible on all visible transfer edges by default.
- The analyst can switch to important-only transaction labels.
- Wallet labels remain useful without turning the graph into unlabeled gray dots.
- Service and boundary nodes are visually separated from ordinary wallet clusters.
- Peer links can show neighbor-to-neighbor relationships.
- Selecting a group or branch gives readable detail and supports targeted expansion.
- Risk and decision in the right rail use available deep-check result data instead of hardcoded `unknown`.

## Spec Self-Review

- No placeholders or open TODOs remain.
- Scope is limited to `address_deep_check`.
- Incoming-deposit and where-is-money graph behavior is explicitly out of scope.
- Label defaults match the agreed direction: transaction labels show all visible amounts and times by default, with an important-only mode available.
- Risk display is scoped to admin projection/presentation, not scoring changes.
