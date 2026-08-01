# Admin Forensics Trace Stop Diagnostics UI Design

Date: 2026-06-03

## Context

Admin Forensics Console currently projects trace stops as graph nodes with `kind = "stop"` and `displayKind = "trace_stop"`. This is useful because it shows why a money-origin branch ended, but the right panel still makes these nodes look too much like normal wallets:

- The panel shows `Address: stop:0:incoming_history_not_fetched`.
- It shows `Risk score: 45`, which reads like wallet risk.
- It shows `Visible incoming: n/a` and `Visible outgoing: n/a`.
- It does not clearly explain that the node is not a blockchain address, not a transaction, and not a transfer.

This creates confusion in cases such as `incoming_history_not_fetched`: the trace did not prove there are no prior inputs. It only means the fetched incoming history did not reach the timestamp needed to continue the path. The system stops conservatively and records a path uncertainty contribution.

## Goals

1. Make trace-stop nodes understandable as diagnostics, not wallets.
2. Preserve stop nodes in the graph so admins can see why a branch ended.
3. Separate data-quality uncertainty from wallet/source risk in the UI.
4. Show useful timing and history-coverage facts for stop reasons.
5. Avoid empty `n/a` wallet fields when the selected object is not a wallet or transfer.

## Non-Goals

- Do not change forensic scoring in this UI pass.
- Do not change path selection or tracing logic.
- Do not remove stop reasons from persisted job results.
- Do not claim that incomplete history proves clean or dirty origin.
- Do not hide evidence from admins; make it clearer and less misleading.

## Definitions

### Trace Stop

A trace stop is an artificial graph marker that says: "the algorithm stopped this branch here, for this reason."

It is not:

- a TRON address;
- a USDT transfer;
- a smart contract;
- a source of funds by itself.

It may still have a path contribution because the path ended without complete provenance. For data-quality stops, that contribution is an uncertainty penalty, not wallet risk.

### Data-Quality Stop

A data-quality stop means the system could not continue because data was missing or a configured search budget was exhausted.

Examples:

- `incoming_history_not_fetched`
- `data_budget_exhausted`

### Continuity Stop

A continuity stop means fetched data existed, but no previous transfer met continuity rules.

Examples:

- `no_previous_transfer`
- `no_incoming_transfers_seen`
- `incoming_seen_but_below_continuity`
- `weak_amount_or_time_continuity`

### Terminal Boundary Stop

A terminal boundary stop means the trace reached a meaningful source or policy boundary.

Examples:

- `allowlist_cex_reached`
- `decline_boundary_reached`
- `risky_label_reached`
- `unlabeled_service_boundary`

## Stop Reason Meanings

| Reason | User-facing title | Meaning |
| --- | --- | --- |
| `incoming_history_not_fetched` | History not fully fetched | The fetched incoming history did not go far enough back to cover the current hop timestamp. The system cannot know what funded this hop. |
| `data_budget_exhausted` | Search budget exhausted | The trace hit max depth, max address fetches, or another configured data budget before reaching a terminal source. |
| `no_previous_transfer` | No prior inbound found | History reached the needed timestamp, but no earlier inbound USDT transfer was found for this hop. |
| `no_incoming_transfers_seen` | No previous incoming | History reached the needed timestamp and no inbound USDT transfers were seen. |
| `incoming_seen_but_below_continuity` | Prior inputs do not match | Prior inbound transfers exist, but none match amount/time continuity thresholds. |
| `weak_amount_or_time_continuity` | Weak continuity | A possible connection exists, but amount or time continuity is too weak to prove provenance. |
| `unlabeled_service_boundary` | Service boundary | The trace reached an unlabeled service/contract boundary where normal wallet-to-wallet provenance should stop. |
| `allowlist_cex_reached` | Allowlisted CEX reached | The trace reached a known allowlisted centralized exchange source. |
| `decline_boundary_reached` | Decline boundary reached | The trace reached a policy boundary that can raise risk. |
| `risky_label_reached` | Risky label reached | The trace reached a known risky label. |

## Canvas Behavior

Trace stops should remain visible because they explain why a branch ended. However, they must not look like normal wallets.

Canvas requirements:

- Render trace stops as compact diagnostic markers, not normal wallet nodes.
- Use a distinct stop marker style: smaller radius, dashed or warning outline, and a stop badge.
- Use display labels such as `History incomplete`, `No prior input`, `Weak continuity`, `Budget stop`, `Service boundary`, or `Risk boundary`.
- Do not render the raw synthetic id, for example `stop:0:incoming_history_not_fetched`, as the visible canvas label.
- Do not show amount pills on stop edges. A stop edge is not a transfer.
- The previous real transfer edge keeps its own amount label and timestamp.
- The selected path should still include the stop marker so the end of the branch is visible.

The graph may include a future `Show trace stops` toggle. If added, it should hide only diagnostic stop markers from the canvas, not remove them from `Boundary stops` or the right-panel path diagnostics.

## Right Panel Behavior

When the selected node has `displayKind = "trace_stop"` or `kind = "stop"`, the right panel should use a dedicated trace-stop detail layout instead of the wallet layout.

The panel should start with:

- `Selected`: `Trace stop`
- `Stop type`: one of `Data quality`, `Continuity`, `Terminal boundary`, or `Service boundary`
- `Reason`: user-facing title, for example `History not fully fetched`
- `Meaning`: short explanation of the stop reason

The panel must not show wallet-only metrics:

- no `Address` field as the primary identifier;
- no `Technical type: stop` as a prominent wallet-like field;
- no `Visible incoming`;
- no `Visible outgoing`;
- no `Connected transfers` unless it is labeled as graph context;
- no `Risk score` label for data-quality or continuity stops.

The raw stop id can remain available under a lower-priority technical field:

- `Stop id`: `stop:0:incoming_history_not_fetched`

## Score Display

Stop score labels must explain what the number means.

For data-quality stops:

- Label: `Path uncertainty penalty`
- Example: `45`
- Explanation: `This is not wallet risk. It is a conservative path contribution because source provenance was not proven.`

For continuity stops:

- Label: `Continuity penalty`
- Explanation: `Prior transfer evidence was absent or did not meet amount/time continuity.`

For terminal boundary stops:

- Label: `Boundary contribution`
- Explanation depends on the boundary type.

The UI should not show `Risk level` and `Risk score` for trace stops in the same way it does for wallets. If a risk band is displayed, it should be scoped:

- `Path contribution band: MEDIUM`

## Amount Display

Trace stops have no transfer amount. The UI should not show `n/a` as if amount data is missing from a real transaction.

Instead, the stop detail layout should show:

- `Stop amount`: `not a transfer`
- `Last real hop amount`: amount from the previous real edge in the same path, if available
- `Checked/used amount`: allocated or path amount if available
- `Target coverage amount`: path or report target if available

If no amount context is available:

- `Amount context`: `No transfer amount is stored for this diagnostic stop.`

## Time And History Coverage Display

The stop panel should surface time data that explains why the trace ended.

For every stop when data exists:

- `Path span`: formatted from `timeSpanMs`, for example `5d 23h`
- `Last real hop time`: timestamp from the previous real transfer edge in the path
- `Previous hop gap`: `txGapMs` from the previous real edge if available

For `incoming_history_not_fetched`:

- `Required history cutoff`: `targetTimestamp`
- `Oldest fetched transfer`: `oldestFetchedTransferAt`
- `Reached required time`: `no`
- `History span checked`: derived from `historyDaysChecked`
- `Pages checked`: fetched page count
- `History tx checked`: fetched transfer count

If rejected candidates exist, show them under `Rejected candidates`, with reason labels:

- `after_target_timestamp`: transfer happened after the required hop time and cannot fund that earlier hop
- `amount_continuity_below_threshold`: amount continuity was too weak
- `time_continuity_above_threshold`: time gap was too large

## Boundary Stops Tab

The `Boundary stops` tab should remain the complete list of path stops. It should use human labels instead of raw reason strings.

Columns should be:

- `Path`
- `Stop`
- `Type`
- `Contribution`
- `Reached required time`
- `History checked`
- `Last real hop`

The row for `incoming_history_not_fetched` should make the difference explicit:

- Stop: `History not fully fetched`
- Type: `Data quality`
- Contribution: `Uncertainty +45`
- Reached required time: `no`

## Data Requirements

The UI can derive most fields from existing graph metadata:

- stop reason from `node.metadata.reason`;
- stop diagnostics from `node.metadata.stopDetails`;
- path context from `path.id`, `path.timeSpanMs`, `path.edgeIds`;
- previous real hop from the last non-stop edge in the same path before the stop edge;
- amount context from previous edge metadata and path amount fields.

If the current graph JSON does not expose enough previous-hop context to the frontend, the graph projection may add display-only metadata:

- `lastRealEdgeId`
- `lastRealHopAmountRaw`
- `lastRealHopAmountFormatted`
- `lastRealHopTimestamp`
- `stopCategory`
- `stopTitle`
- `stopMeaning`
- `scoreMeaning`

These fields are display semantics only. They must not alter scoring or route selection.

## Acceptance Criteria

1. Selecting `stop:0:incoming_history_not_fetched` no longer shows it as a wallet address.
2. The panel explains: `History not fully fetched`.
3. The panel says the contribution is a path uncertainty penalty, not wallet risk.
4. Empty wallet metrics such as `Visible incoming: n/a` and `Visible outgoing: n/a` are not shown for trace stops.
5. The panel shows why the trace did not continue: required cutoff time, oldest fetched transfer, reached required time, pages checked, and history tx checked when available.
6. Stop edges do not show transfer amount labels.
7. The previous real edge still shows its amount and tx gap.
8. The `Boundary stops` tab remains available and uses human stop labels.
9. Existing graph projection tests continue to pass.
10. Existing scoring and forensic report output remain unchanged.

## Test Plan

Add or update tests in the admin graph/UI test suite:

- Projection test for `incoming_history_not_fetched` includes stop diagnostics and previous real edge context.
- Admin shell test asserts trace-stop copy exists:
  - `Path uncertainty penalty`
  - `This is not wallet risk`
  - `History not fully fetched`
  - `Stop amount`
- Admin shell test asserts wallet-only labels are not used in the trace-stop detail layout as primary labels.
- Existing tests for `txGapMs` on real edges remain unchanged.
- Full admin graph tests and typecheck must pass.

Runtime smoke:

- Load `/admin/forensics`.
- Open a `where_is_money_check` job with `incoming_history_not_fetched`.
- Select the stop marker.
- Confirm the panel explains the stop without presenting it as an address or transfer.
