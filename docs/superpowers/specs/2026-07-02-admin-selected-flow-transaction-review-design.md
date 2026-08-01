# Admin Selected Flow Transaction Review Panel

Date: 2026-07-02

Status: approved design, ready for implementation planning after user review.

## Goal

Redesign the right-side Analytics panel for a selected graph edge so it works as a transaction review workspace.

The panel should help an admin answer:

- which transactions are inside this selected flow;
- how much USDT moved;
- when the movement happened;
- who sent and who received it;
- which tx hashes should be opened in Tronscan;
- whether the row is a normal transfer or an unusual action;
- whether saved graph data is complete enough to review per transaction.

This is not a graph logic change. The first version changes the selected-flow presentation, copy, and grouping only.

## Product Principles

- Show facts before explanations.
- Do not repeat tutorial text after the user has learned the concept.
- Do not show case or subject risk as if it belonged to the selected edge, wallet, or tx.
- Keep technical graph fields available for debugging, but out of the primary review flow.
- Prefer entity labels over raw addresses when labels are available.
- Never hide real tx hashes from the admin.

## Scope V1

### In Scope

- Redesign `Selected Flow` in the right Analytics panel.
- Replace the current raw field stack with a transaction-first layout.
- Group transaction rows by day.
- Sort selected-flow transactions oldest to newest.
- Add a compact selected-flow header.
- Add action classification display for unusual tx actions.
- Add aggregate-only state for old graph edges that only store tx hashes and totals.
- Add a collapsed `Debug` block at the bottom.
- Add a risk-scope guard so Selected Flow does not show subject risk as edge risk.
- Add focused tests for layout strings, helper behavior, aggregate-only state, action visibility, risk guard, and debug placement.

### Out Of Scope

- Full Selected Node redesign.
- Backend tx hydration.
- Live fetch on click.
- Queueing, caching, or rate-limit handling for missing tx details.
- New graph projection or edge creation logic.
- Database schema changes.
- Changing graph edge colors or layout rules.

Allowed shared helper work:

- address/entity display formatting used by tx rows;
- small compatibility cleanup if Selected Node transfer lists use the same formatting helper.

Future work:

- Selected Node entity profile;
- live `Load tx details`;
- per-wallet scoring integration;
- per-edge and per-tx risk/proof model.

## Current Problems

The current selected-flow panel mixes admin review data with internal debug data:

- `What this means` repeats generic explanations such as grouped-transfer definitions;
- `Evidence type`, `Meaning`, and `Direction` take priority over tx review;
- `path:fast_check:outgoing:1` and `path:direct_counterparty:8` appear in the primary view;
- grouped aggregate edges show technical notes before actionable tx hashes;
- ordinary transfer methods can render as noisy raw strings such as `transfer(address_to,uint256_value)`;
- subject risk can appear near non-subject selections, which makes the selected object look risk-scored when it is not.

## Selected Flow Primary Layout

Primary view contains three parts:

1. Selected-flow header.
2. Transaction review list.
3. Optional aggregate-only notice.

Debug data is not part of the primary layout.

### Remove From Primary View

Do not show these fields in the main selected-flow panel:

- `What this means`;
- `Evidence type`;
- `Meaning`;
- `Direction`;
- raw `path:*`;
- raw method signatures;
- long grouped-transfer explanations;
- subject risk score;
- placeholder wallet/flow risk score.

## Header

The header replaces `Evidence type`, `Meaning`, and `Direction` in the primary view.

Standard grouped transfer:

```text
7 transfers · 2.04M USDT
Outgoing · Jun 24, 15:08 -> Jul 01, 14:20
KuCoin 4 -> Subject wallet
TUpHu...t8J2b9 -> TYDae...WqQPC
```

Mixed actions:

```text
7 tx · 2.04M USDT · mixed actions
Outgoing · Jun 24 -> Jul 01
TABPf...Cd58Fg -> Subject wallet
```

Contract-driven route:

```text
12 contract transfers · 100K USDT
Contract route · Jun 12 -> Jun 30
Source wallets -> Contract -> Subject wallet
```

Aggregate-only saved graph:

```text
7 transfers · 2.04M USDT
Outgoing · Jun 24 -> Jul 01
Details not stored
Rerun check to load per-tx details
```

Header rules:

- First line: count and total amount.
- Second line: direction or route type plus time range.
- Third line: entity route.
- Fourth line, when useful: address route as secondary text.
- Use ASCII `->` for time and route ranges.
- If time is missing, use `time unknown`.
- If amount is missing, use `amount unknown`.

## Transaction List

The transaction list is the main content of the panel.

Rules:

- Show all saved transaction rows by default.
- Sort oldest to newest.
- Group rows by day.
- Day header format: date, tx count, day total.
- Inside each day, show every tx row.
- If the selected flow has more than 100 tx rows, show the first 100 grouped by day and add `Showing first 100 of N tx` plus `Show all`.
- Clicking a tx row opens the tx in Tronscan in a new tab.
- If a row has no tx hash, the row is not clickable and shows `tx unknown`.
- Hover and keyboard focus must make clickability clear.

Example:

```text
7 transfers · 2.04M USDT
Outgoing · Jun 24, 15:08 -> Jul 01, 14:20

Jun 24 · 1 tx · 500K USDT
500K USDT        15:08
KuCoin 4 -> Subject wallet
TUpHu...t8J2b9 -> TYDae...WqQPC
tx ecd73d78...612352c

Jun 25 · 1 tx · 502.95K USDT
502.95K USDT     11:34
KuCoin 4 -> Subject wallet
TUpHu...t8J2b9 -> TYDae...WqQPC
tx 0a33fcd6...8a975c4

Jul 01 · 5 tx · 1.04M USDT
...
```

## Action Display

Every tx row can have an action value in the row model.

The UI only highlights action when it adds information.

### Standard Transfers

For ordinary USDT transfers:

- do not render a loud `Action` line;
- optionally show a small muted `Transfer` tag if space allows;
- do not show raw method strings in primary view.

Ordinary row:

```text
500K USDT        Jun 24, 15:08
TSGQ...xPLjDqY -> THJc...2Y3FMD7
tx ecd73d78...612352c
```

### Unusual Actions

Show `Action` clearly when a tx is not a standard transfer:

- approval;
- transferFrom;
- contract call;
- swap;
- mint or burn;
- failed tx;
- unknown method;
- mixed group.

Approval:

```text
Unlimited approval        Jul 01, 12:51
TABPf...Cd58Fg -> TSUY...S212sQ
tx 4015b430...72e5178f
Action: Approval to spend USDT
```

Contract-driven:

```text
50K USDT        Jun 18, 15:26
GasFree Account -> Contract -> Subject wallet
tx 7b1734...e40052
Action: Contract transfer
```

DEX or unusual contract call:

```text
1.15e+65 USDT        Jul 01, 12:51
TABPf...Cd58Fg -> TSUY...S212sQ
tx 2fc22b7b...96612be4
Action: Contract call: sellGem
```

If the action is unavailable:

```text
Action unknown
```

Use `Action unknown`, not `not stored`, in primary tx rows.

Raw method signatures such as `transfer(address_to,uint256_value)`, `approve(address,uint256)`, or `sellGem(...)` belong in `Debug`.

## Grouped Actions

Grouped header rules:

- If all saved tx rows are ordinary transfers: `7 transfers`.
- If the selected flow contains approvals, contract calls, swaps, failed tx, or unknown actions: `7 tx · mixed actions`.
- If actions are not stored for aggregate-only data: do not claim `mixed actions`; show aggregate-only state.

Do not repeat `Transfer` in every row when every tx is a normal transfer.

## Address And Entity Display

The panel should show who the admin recognizes first, and the address second.

If a label exists:

```text
KuCoin 4
TUpHu...t8J2b9
```

If no label exists:

```text
TUpHu...t8J2b9
```

If a role or entity type exists:

```text
Bybit
CEX · TU4v...r7Pvaa
```

```text
GasFree Account
service · TQXT...SBUJdKs
```

Rules:

- Label is primary.
- Address is secondary.
- Full address is available in `title` or hover.
- Click on label/address opens Tronscan.
- Add a small copy button for the full address.
- If label is inferred, show a quiet `inferred` marker.
- If label comes from explorer data, preserve source as `Tronscan label`.
- Subject renders as `Subject wallet`.
- Contract renders as `Contract` plus short address.
- Funding bundle renders as `Funding bundle` plus wallet count when available.

## Aggregate-Only Saved Graphs

Some old graph edges store only:

- tx hashes;
- aggregate tx count;
- aggregate amount;
- first/last time;
- no per-tx rows.

For these edges, primary view shows a summary and tx hashes, not fake per-tx rows.

Required copy:

```text
Details not stored
Rerun check to load per-tx details
This saved graph has tx hashes and total amount, but no per-tx rows.
```

Rules:

- Show tx hash chips/links so the admin can open them manually.
- Do not show a real `Load tx details` button in v1.
- Do not auto-fetch tx details on edge selection.
- Do not mix live-loaded details with the saved graph snapshot.

Future hydration task:

- capped fetch, for example 50 tx per request;
- request queue with low concurrency;
- tx-hash cache;
- loading state;
- rate-limit error state;
- `Loaded live` marker;
- no automatic fetch on click.

## Risk Scope

Risk must be scoped to the selected object.

Never show subject/case risk as if it belonged to a selected edge, tx, or non-subject wallet.

Risk scopes:

```text
Case / subject risk
Wallet risk
Counterparty risk
Edge / flow risk
Tx risk
```

### Selected Flow V1

Selected Flow primary view:

- does not show subject risk;
- does not show placeholder risk score;
- does not show `Wallet risk: unknown`;
- only shows factual flow/tx flags already present in data.

Allowed primary flags:

- `CEX`;
- `Known service`;
- `Contract route`;
- `Approval`;
- `Blacklist hit`;
- `Drainer pattern`;
- `Failed tx`;
- `Mixed actions`.

If no edge/tx-specific flags exist, show no risk block.

### Selected Node Compatibility Guard

V1 does not redesign Selected Node, but it must avoid false risk context:

- if selected node is not the subject wallet, do not show subject score as wallet score;
- subject risk remains in case header or case summary only;
- non-subject wallet risk appears only when saved wallet risk or future per-wallet scoring data exists.

### Risk States

Use these terms only where the selected object actually supports them:

```text
Not evaluated
```

The module has not run for this object.

```text
No risk found
```

The module ran and found no risk.

```text
Unknown
```

Old graph data does not contain the field.

For Selected Flow v1, avoid these states in primary view unless tied to real edge/tx evidence. Put diagnostic scope notes in `Debug`.

## Debug Block

Keep Debug in the UI, collapsed by default.

Purpose:

- explain why a line has its technical classification;
- diagnose graph bugs;
- distinguish saved `underlyingTransfers` from aggregate-only edges;
- inspect `path:*`;
- copy exact context for bug reports.

Visual rules:

- bottom of selected-flow panel;
- collapsed by default;
- quiet visual style;
- monospace raw values;
- no large cards;
- no primary-view prominence.

Example:

```text
Debug
Evidence type: profile_context
Meaning: Behavioral/service exposure context
Path: path:direct_counterparty:8
Display role: profile_context
Stored tx hashes: 7
Has underlying transfers: no
Source: directCounterpartyInteractionProfile
Risk scope: not evaluated for this flow
Subject risk: 82 / HIGH
```

Actions:

- `Copy edge id`;
- `Copy raw JSON`.

## Copy Rules

Use short factual labels.

Avoid:

- repeated tutorial text;
- generic statements such as `Several real transfers are summarized into one edge`;
- vague explanation blocks;
- raw internal names in primary view;
- noisy method signatures for ordinary transfers.

Prefer:

- amounts;
- counts;
- dates;
- tx hashes;
- entity labels;
- clear action names;
- exact missing-data states.

Approved missing-data copy:

```text
Details not stored
Rerun check to load per-tx details
Action unknown
time unknown
amount unknown
tx unknown
```

## Testing Requirements

Add focused tests for:

- selected-flow header replaces `Evidence type`, `Meaning`, and `Direction` in primary view;
- transaction rows sort oldest to newest;
- transaction rows group by day with day totals;
- ordinary transfer rows do not render loud action text;
- unusual tx rows render `Action`;
- mixed groups render `mixed actions`;
- aggregate-only edges show summary, tx hashes, and rerun copy;
- aggregate-only edges do not render fake per-tx rows;
- `path:*` appears only in collapsed Debug;
- subject risk is not shown in Selected Flow primary view;
- non-subject Selected Node does not show subject score as wallet score;
- address display uses label-first formatting when labels exist;
- tx row click opens Tronscan only when tx hash exists.

## Acceptance Criteria

- Selecting a grouped edge with saved per-tx rows shows a day-grouped transaction list.
- Selecting an aggregate-only grouped edge shows summary, tx hashes, and rerun copy.
- The primary selected-flow panel contains no `path:*`, raw evidence type, raw meaning, or long grouped-transfer explanation.
- Ordinary transfers are readable without repeating `Transfer` on every row.
- Approvals, contract calls, failed tx, and mixed actions are visible.
- Labels such as `KuCoin 4`, `Bybit`, `GasFree Account`, `Subject wallet`, and `Contract` are primary when available.
- Subject risk is not displayed as selected-flow or selected-wallet risk.
- Debug remains available but closed by default.
