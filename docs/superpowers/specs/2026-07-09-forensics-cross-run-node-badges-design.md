# Forensics Cross-Run Node Badges Design

Date: 2026-07-09

## Context

The Admin Forensics graph is the analyst workspace for one selected forensic
job. Wallet Intelligence is the existing Admin-only index of cross-run address
sightings from completed or partial DeepCheck, Where is Money, and Incoming
Deposit jobs.

This design brings a small Wallet Intelligence hint into the Forensics graph:
when an address on the current graph has appeared in other saved checks, the
analyst should see that directly on the node and be able to jump to those source
checks.

This remains investigative context only. It does not change scoring, labels,
Telegram output, theft-report status, or the underlying forensic result.

## Product Decision

Use option A from the visual review.

For graph nodes with an address that appears in `2+` unique Wallet Intelligence
source jobs, Admin shows a small numeric badge on the upper-right of the node.
The number is the unique source job count, not occurrence count, transaction
count, requester count, or subject-wallet count.

Clicking the node keeps the normal selected-node behavior. In the Analytics rail
under the selected node, Admin adds a Russian section:

`Встречается в прогонах`

Each row is clickable and shows:

- source check mode;
- human-readable completed/seen time;
- checked subject wallet;
- Telegram username when available;
- Telegram user id when available;
- short source job id.

Clicking a row opens the source job in Forensics and highlights the same address
there:

`/admin/forensics?job=<jobId>&highlightAddress=<address>`

If the target job graph does not contain the address, Admin should still open
the job and show a small non-blocking note in the Analytics/status area that the
address was not visible in the current graph view.

## UI Rules

Badges:

- Render only when `jobCount >= 2`.
- Keep the badge compact so it does not resize the node or shift labels.
- Use neutral analyst styling, not risk colors. The badge says "seen elsewhere",
  not "bad".
- Cap display at `99+` if needed.
- Keep service and role glyphs intact; the cross-run badge is a separate overlay
  at the node's upper-right.

Selected-node section:

- Show only for address-backed nodes.
- Show a compact count line, for example:
  `Адрес встречается в 5 уникальных прогонах`.
- List the most useful source jobs first: same checked subject/current job
  filtered out or de-emphasized, then newer completed jobs, then partial jobs.
- Rows must be links/buttons with stable text and keyboard focus.
- Use Russian labels in the Admin UI.
- Avoid verdict language such as `scam`, `dirty`, `confirmed`, or `high risk`.

Navigation:

- Existing `/admin/forensics?job=<jobId>` behavior remains the base path.
- Add `highlightAddress=<address>` as a URL parameter.
- After graph load, map the address to a visible node id with the existing node
  address helpers, select that node, and visually highlight it.
- Preserve normal graph filters; if filters hide the node, show a note instead
  of silently failing.

## Data Flow

Use existing Wallet Intelligence storage as the source of truth.

Implementation should avoid one API call per visible node. Add the smallest
Admin API needed for the graph:

`GET /admin/api/wallet-intelligence/address-summaries?addresses=A,B,C`

Response shape:

```json
{
  "addresses": [
    {
      "address": "T...",
      "jobCount": 5,
      "uniqueSubjectCount": 27,
      "uniqueRequesterCount": 5,
      "lastSeenAt": "2026-06-04T00:04:00.000Z"
    }
  ]
}
```

The selected-node detail can use the existing address detail endpoint:

`GET /admin/api/wallet-intelligence/addresses/<address>`

The client groups detail rows by source job and renders the clickable source
check rows from the existing `jobs`, `requesters`, and `sightings` data. If the
detail endpoint does not already expose one required field, extend the existing
detail payload rather than adding another table.

## Edge Cases

- No Wallet Intelligence index: no badges and no selected-node section.
- Current job not indexed yet: badges can still show if the address appeared in
  previous indexed jobs.
- Current source job included in the detail: do not count it as a separate
  "other place" row unless it helps explain why the badge number is present.
- Same address appearing many times in one job: count once for the badge.
- Known exchange/service wallets can show badges, but the copy must label this
  as infrastructure context when such metadata exists.
- Address casing or formatting differences should use the same normalization as
  Wallet Intelligence summaries.

## Testing

Smallest useful checks:

- Admin server test for the batch summaries endpoint, including invalid address
  input and missing Wallet Intelligence dependency.
- Storage/repository test for fetching summaries by a provided address list, if
  the repository needs a new function.
- Admin console structural tests that:
  - render cross-run badges inside `renderGraph`;
  - keep badge count based on unique jobs;
  - add the selected-node `Встречается в прогонах` section;
  - build links with `job` and `highlightAddress`;
  - parse `highlightAddress` from the URL and select/highlight the node after
    graph load.

## Documentation

When implemented, update `docs/knowledge/08-admin-and-bot-ux.md` to describe
Forensics graph cross-run badges as Admin-only context. Update
`docs/knowledge/10-open-problems.md` to remove or revise the existing note that
Wallet Intelligence V1 defers per-job "seen elsewhere" hints and global graph
visualization.
