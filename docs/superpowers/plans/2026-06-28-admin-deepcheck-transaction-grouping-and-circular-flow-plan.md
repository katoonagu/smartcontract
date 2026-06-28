# Admin DeepCheck Transaction Grouping And Circular Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DeepCheck display repeated wallet-to-wallet transfers as honest grouped evidence, keep single transfers as single edges, mark circular wallet movement, and show saved high-risk neighbor context.

**Architecture:** Keep the existing vanilla admin graph and repository layout. Add small projection helpers in `src/admin/forensicsGraph.ts`, small rendering helpers in `src/admin/adminConsole.ts`, and narrowly scoped tests in the existing admin test files. Do not add dependencies or rewrite the graph engine.

**Tech Stack:** TypeScript, existing Node test runner via `npm test`, existing admin SVG/HTML renderer, Postgres-backed forensic jobs.

---

## File Map

- `src/admin/forensicsGraph.ts`
  - Owns DeepCheck graph projection.
  - Add deterministic grouping for real direct-counterparty transfer evidence.
  - Add reciprocal-flow metadata on wallet-to-wallet edge pairs.
  - Add saved-neighbor-risk projection hooks if the admin job payload already contains saved profile context.

- `src/admin/adminConsole.ts`
  - Owns graph edge styling, canvas labels, right rail, and transfer drawers.
  - Render grouped edges as gray-violet dashed lines.
  - Render single wallet transfers as gray dashed lines.
  - Render reciprocal/circular evidence in labels and right rail.
  - Keep right-rail transaction cards readable with human time and Tronscan links.

- `src/admin/adminServer.ts`
  - Owns admin API job payload assembly.
  - If saved wallet risk is not already in job payloads, enrich selected forensic job graph responses with latest saved wallet-risk context for graph node addresses.

- `src/storage/repositories.ts`
  - Owns database reads/writes.
  - Add the smallest read helper needed by `adminServer.ts` to fetch latest saved risk per address, only if no existing helper covers it.

- `tests/admin/forensicsGraph.test.ts`
  - Projection tests for grouping, episode splitting, direction separation, reciprocal metadata, and saved neighbor role context.

- `tests/admin/adminConsole.test.ts`
  - Rendering tests for grouped edge labels, single edge labels, right-rail transaction cards, reciprocal copy, and `Expand selected`.

- `tests/admin/adminServer.test.ts`
  - API test for saved neighbor risk enrichment if enrichment is implemented in `adminServer.ts`.

---

## Implementation Notes

Use these exact product rules:

```text
Group only repeated real tx evidence between the same two nodes, same direction,
same evidence type, same episode. Single tx is never a group.
```

Episode split:

```ts
const DEEP_CHECK_EPISODE_GAP_MS = 30 * 24 * 60 * 60 * 1000;
```

Grouping key:

```text
fromAddress | toAddress | direction | evidenceType
```

Evidence type values:

```text
wallet_transfer
contract_driven_transfer
service_context
boundary_context
```

Default behavior:

- one transfer: gray dashed wallet-transfer edge;
- two or more transfers in one episode: gray-violet dashed grouped edge;
- opposite direction is separate;
- contract-driven transfer is separate from ordinary wallet transfer;
- service or boundary context is not grouped with wallet-to-wallet transfers;
- grouped edges must carry `metadata.underlyingTransfers`;
- grouped labels show `N tx - amount`;
- grouped sublabels show a period like `Feb 11-16`;
- right rail shows every underlying transfer with amount, human time, tx hash, from, and to.

---

### Task 1: Add Projection Tests For DeepCheck Transfer Grouping

**Files:**
- Modify: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add a grouped-transfer projection test**

Add this test near the existing DeepCheck projection tests:

```ts
it("groups repeated direct counterparty transfers in one episode", () => {
  const job = makeForensicJob({
    kind: "address_deep_check",
    address: "TSubject111111111111111111111111111111",
    result: {
      subject: "TSubject111111111111111111111111111111",
      directCounterpartyInteractionProfiles: [
        {
          counterpartyAddress: "TCounter11111111111111111111111111111",
          direction: "inbound",
          txCount: 3,
          volumeRaw: "6000000",
          transfers: [
            {
              txHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              fromAddress: "TCounter11111111111111111111111111111",
              toAddress: "TSubject111111111111111111111111111111",
              amountRaw: "1000000",
              timestamp: "2026-02-11T10:00:00.000Z",
            },
            {
              txHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              fromAddress: "TCounter11111111111111111111111111111",
              toAddress: "TSubject111111111111111111111111111111",
              amountRaw: "2000000",
              timestamp: "2026-02-12T10:00:00.000Z",
            },
            {
              txHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
              fromAddress: "TCounter11111111111111111111111111111",
              toAddress: "TSubject111111111111111111111111111111",
              amountRaw: "3000000",
              timestamp: "2026-02-16T10:00:00.000Z",
            },
          ],
        },
      ],
    },
  });

  const graph = projectForensicJobGraph(job);
  const groupedEdge = graph.edges.find((edge) => edge.metadata?.source === "directCounterpartyInteractionProfile");

  expect(groupedEdge).toBeTruthy();
  expect(groupedEdge?.metadata?.evidenceType).toBe("grouped_transfers");
  expect(groupedEdge?.metadata?.aggregateTransferCount).toBe(3);
  expect(groupedEdge?.metadata?.aggregateAmountRaw).toBe("6000000");
  expect(groupedEdge?.metadata?.underlyingTransfers).toHaveLength(3);
  expect(groupedEdge?.txHash).toBeUndefined();
});
```

- [ ] **Step 2: Add a single-transfer projection test**

Add this test in the same file:

```ts
it("keeps one direct counterparty transfer as a single transfer edge", () => {
  const job = makeForensicJob({
    kind: "address_deep_check",
    address: "TSubject222222222222222222222222222222",
    result: {
      subject: "TSubject222222222222222222222222222222",
      directCounterpartyInteractionProfiles: [
        {
          counterpartyAddress: "TCounter22222222222222222222222222222",
          direction: "inbound",
          txCount: 1,
          volumeRaw: "5000000",
          txHashes: ["dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"],
          transfers: [
            {
              txHash: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
              fromAddress: "TCounter22222222222222222222222222222",
              toAddress: "TSubject222222222222222222222222222222",
              amountRaw: "5000000",
              timestamp: "2026-02-11T10:00:00.000Z",
            },
          ],
        },
      ],
    },
  });

  const graph = projectForensicJobGraph(job);
  const edge = graph.edges.find((candidate) => candidate.metadata?.source === "directCounterpartyInteractionProfile");

  expect(edge).toBeTruthy();
  expect(edge?.metadata?.evidenceType).toBeUndefined();
  expect(edge?.metadata?.aggregateTransferCount).toBeUndefined();
  expect(edge?.metadata?.underlyingTransfers).toHaveLength(1);
  expect(edge?.txHash).toBe("dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd");
});
```

- [ ] **Step 3: Add direction and episode split tests**

Add these tests in the same file:

```ts
it("does not group opposite directions between the same two wallets", () => {
  const subject = "TSubject333333333333333333333333333333";
  const counterparty = "TCounter33333333333333333333333333333";
  const job = makeForensicJob({
    kind: "address_deep_check",
    address: subject,
    result: {
      subject,
      directCounterpartyInteractionProfiles: [
        {
          counterpartyAddress: counterparty,
          direction: "inbound",
          txCount: 1,
          volumeRaw: "1000000",
          transfers: [
            {
              txHash: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
              fromAddress: counterparty,
              toAddress: subject,
              amountRaw: "1000000",
              timestamp: "2026-02-11T10:00:00.000Z",
            },
          ],
        },
        {
          counterpartyAddress: counterparty,
          direction: "outbound",
          txCount: 1,
          volumeRaw: "900000",
          transfers: [
            {
              txHash: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
              fromAddress: subject,
              toAddress: counterparty,
              amountRaw: "900000",
              timestamp: "2026-02-11T10:02:00.000Z",
            },
          ],
        },
      ],
    },
  });

  const graph = projectForensicJobGraph(job);
  const directEdges = graph.edges.filter((edge) => edge.metadata?.source === "directCounterpartyInteractionProfile");

  expect(directEdges).toHaveLength(2);
  expect(directEdges.map((edge) => edge.metadata?.direction).sort()).toEqual(["inbound", "outbound"]);
  expect(directEdges.every((edge) => edge.metadata?.evidenceType !== "grouped_transfers")).toBe(true);
});

it("splits repeated transfers into separate episodes after a thirty day gap", () => {
  const subject = "TSubject444444444444444444444444444444";
  const counterparty = "TCounter44444444444444444444444444444";
  const job = makeForensicJob({
    kind: "address_deep_check",
    address: subject,
    result: {
      subject,
      directCounterpartyInteractionProfiles: [
        {
          counterpartyAddress: counterparty,
          direction: "inbound",
          txCount: 3,
          volumeRaw: "9000000",
          transfers: [
            {
              txHash: "1111111111111111111111111111111111111111111111111111111111111111",
              fromAddress: counterparty,
              toAddress: subject,
              amountRaw: "1000000",
              timestamp: "2026-02-01T10:00:00.000Z",
            },
            {
              txHash: "2222222222222222222222222222222222222222222222222222222222222222",
              fromAddress: counterparty,
              toAddress: subject,
              amountRaw: "2000000",
              timestamp: "2026-02-02T10:00:00.000Z",
            },
            {
              txHash: "3333333333333333333333333333333333333333333333333333333333333333",
              fromAddress: counterparty,
              toAddress: subject,
              amountRaw: "6000000",
              timestamp: "2026-03-20T10:00:00.000Z",
            },
          ],
        },
      ],
    },
  });

  const graph = projectForensicJobGraph(job);
  const directEdges = graph.edges.filter((edge) => edge.metadata?.source === "directCounterpartyInteractionProfile");
  const grouped = directEdges.find((edge) => edge.metadata?.evidenceType === "grouped_transfers");
  const single = directEdges.find((edge) => edge.txHash === "3333333333333333333333333333333333333333333333333333333333333333");

  expect(directEdges).toHaveLength(2);
  expect(grouped?.metadata?.aggregateTransferCount).toBe(2);
  expect(grouped?.metadata?.aggregateAmountRaw).toBe("3000000");
  expect(single).toBeTruthy();
  expect(single?.metadata?.evidenceType).toBeUndefined();
});
```

- [ ] **Step 4: Run projection tests and verify they fail**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts
```

Expected:

```text
FAIL tests/admin/forensicsGraph.test.ts
```

At least the episode split test should fail before implementation because current projection creates one edge from one direct profile.

---

### Task 2: Implement DeepCheck Transfer Grouping In Projection

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add small grouping helpers**

Add these helpers near the existing projection helper functions in `src/admin/forensicsGraph.ts`:

```ts
const DEEP_CHECK_EPISODE_GAP_MS = 30 * 24 * 60 * 60 * 1000;

type DeepCheckDirectTransferEvidence = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
  method?: string | null;
  edgeType?: string | null;
};

type DeepCheckDirectTransferEpisode = {
  key: string;
  direction: "inbound" | "outbound";
  fromAddress: string;
  toAddress: string;
  counterpartyAddress: string;
  transfers: DeepCheckDirectTransferEvidence[];
  evidenceType: "wallet_transfer" | "contract_driven_transfer";
};

function deepCheckTransferEvidenceType(transfer: DeepCheckDirectTransferEvidence): "wallet_transfer" | "contract_driven_transfer" {
  const method = (transfer.method ?? "").toLowerCase();
  const edgeType = (transfer.edgeType ?? "").toLowerCase();
  if (edgeType.includes("contract") || method.includes("transferfrom") || method.includes("approve")) {
    return "contract_driven_transfer";
  }
  return "wallet_transfer";
}

function deepCheckDirectTransferKey(
  transfer: DeepCheckDirectTransferEvidence,
  direction: "inbound" | "outbound",
): string {
  return [
    transfer.fromAddress,
    transfer.toAddress,
    direction,
    deepCheckTransferEvidenceType(transfer),
  ].join("|");
}

function deepCheckTimestampMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function splitDeepCheckTransferEpisodes(
  key: string,
  direction: "inbound" | "outbound",
  counterpartyAddress: string,
  transfers: DeepCheckDirectTransferEvidence[],
): DeepCheckDirectTransferEpisode[] {
  const sorted = [...transfers].sort((left, right) => {
    const leftMs = deepCheckTimestampMs(left.timestamp) ?? 0;
    const rightMs = deepCheckTimestampMs(right.timestamp) ?? 0;
    return leftMs - rightMs;
  });
  const episodes: DeepCheckDirectTransferEpisode[] = [];
  let current: DeepCheckDirectTransferEvidence[] = [];

  for (const transfer of sorted) {
    const previous = current[current.length - 1];
    const previousMs = previous ? deepCheckTimestampMs(previous.timestamp) : null;
    const currentMs = deepCheckTimestampMs(transfer.timestamp);
    const shouldSplit = previousMs !== null && currentMs !== null && currentMs - previousMs > DEEP_CHECK_EPISODE_GAP_MS;
    if (shouldSplit && current.length > 0) {
      episodes.push({
        key,
        direction,
        fromAddress: current[0].fromAddress,
        toAddress: current[0].toAddress,
        counterpartyAddress,
        transfers: current,
        evidenceType: deepCheckTransferEvidenceType(current[0]),
      });
      current = [];
    }
    current.push(transfer);
  }

  if (current.length > 0) {
    episodes.push({
      key,
      direction,
      fromAddress: current[0].fromAddress,
      toAddress: current[0].toAddress,
      counterpartyAddress,
      transfers: current,
      evidenceType: deepCheckTransferEvidenceType(current[0]),
    });
  }

  return episodes;
}
```

- [ ] **Step 2: Use episodes when projecting direct counterparty interaction profiles**

In `projectAddressDeepJob`, replace the single direct profile edge creation for profiles with stored transfers by this shape:

```ts
const storedTransfers = recordArrayField(profile, "transfers")
  .map((transfer, transferIndex) => {
    const txHash = stringField(transfer, "txHash") ?? txHashes[transferIndex] ?? null;
    const transferFrom = stringField(transfer, "fromAddress") ?? (direction === "inbound" ? counterpartyAddress : subjectAddress);
    const transferTo = stringField(transfer, "toAddress") ?? (direction === "inbound" ? subjectAddress : counterpartyAddress);
    const amountRaw = stringField(transfer, "amountRaw");
    const timestamp = stringField(transfer, "timestamp");
    if (!txHash || !transferFrom || !transferTo || !amountRaw || !timestamp) {
      return null;
    }
    return {
      txHash,
      fromAddress: transferFrom,
      toAddress: transferTo,
      amountRaw,
      timestamp,
      method: stringField(transfer, "method"),
      edgeType: stringField(transfer, "edgeType"),
    } satisfies DeepCheckDirectTransferEvidence;
  })
  .filter((transfer): transfer is DeepCheckDirectTransferEvidence => transfer !== null);

const episodes = storedTransfers.length > 0
  ? [...new Map(storedTransfers.map((transfer) => [
      deepCheckDirectTransferKey(transfer, direction),
      storedTransfers.filter((candidate) => deepCheckDirectTransferKey(candidate, direction) === deepCheckDirectTransferKey(transfer, direction)),
    ])).entries()]
      .flatMap(([episodeKey, groupedTransfers]) => splitDeepCheckTransferEpisodes(episodeKey, direction, counterpartyAddress, groupedTransfers))
  : [];
```

Then create one projected edge per episode:

```ts
for (const episode of episodes) {
  const hasGroupedEvidence = episode.transfers.length > 1;
  const aggregateAmountRaw = sumRaw(episode.transfers.map((transfer) => transfer.amountRaw));
  const firstTransfer = episode.transfers[0];
  const pathId = `path:direct_counterparty:${direction}:${counterpartyAddress}:${edgeSequence++}`;
  paths.push({
    id: pathId,
    type: "direct_counterparty",
    label: direction === "inbound" ? "direct inbound counterparty" : "direct outbound counterparty",
    edgeIds: [pathId],
    nodeIds: [addrNodeId(firstTransfer.fromAddress), addrNodeId(firstTransfer.toAddress)],
    metadata: { direction, counterpartyAddress },
  });
  addEdge({
    id: pathId,
    from: addrNodeId(firstTransfer.fromAddress),
    to: addrNodeId(firstTransfer.toAddress),
    direction,
    amountRaw: hasGroupedEvidence ? aggregateAmountRaw : firstTransfer.amountRaw,
    amountLabel: formatAmount(hasGroupedEvidence ? aggregateAmountRaw : firstTransfer.amountRaw),
    timestamp: hasGroupedEvidence ? firstTransfer.timestamp : firstTransfer.timestamp,
    txHash: hasGroupedEvidence ? undefined : firstTransfer.txHash,
    pathId,
    displayRole: hasGroupedEvidence ? "context" : "transfer",
    metadata: {
      source: "directCounterpartyInteractionProfile",
      pathId,
      direction,
      txHashes: episode.transfers.map((transfer) => transfer.txHash),
      txCount: episode.transfers.length,
      evidenceType: hasGroupedEvidence ? "grouped_transfers" : undefined,
      transferEvidenceType: episode.evidenceType,
      aggregateTransferCount: hasGroupedEvidence ? episode.transfers.length : undefined,
      aggregateAmountRaw: hasGroupedEvidence ? aggregateAmountRaw : undefined,
      underlyingTransfers: episode.transfers,
    },
  });
}
```

Keep the existing fallback for profiles without stored transfers. The fallback can still use `txCount` and `volumeRaw`, but it must not mark `1 tx` as grouped.

- [ ] **Step 3: Keep existing service/boundary profiles out of wallet-transfer grouping**

In the profile loop, keep this guard before creating direct wallet episodes:

```ts
const serviceBoundaryContext = stringField(profile, "evidenceClass") === "service_boundary_context" ||
  stringField(profile, "skippedReason") === "service_boundary_context";
if (serviceBoundaryContext) {
  continue;
}
```

If existing code already handles service boundary profiles elsewhere, do not create a wallet-transfer edge for that profile in this direct grouping block.

- [ ] **Step 4: Run projection tests**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts
```

Expected:

```text
PASS tests/admin/forensicsGraph.test.ts
```

---

### Task 3: Render Grouped And Single Transfer Edges Clearly

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add console tests for single and grouped edge classes**

Add tests near existing edge rendering tests:

```ts
it("contains single and grouped transfer edge class rules", () => {
  const html = adminConsoleHtml();
  const edgeExtraClassBlock = html.slice(html.indexOf("function edgeExtraClass"), html.indexOf("function edgeSemanticAttrs"));

  expect(edgeExtraClassBlock).toContain('classes.push("edge-deep-wallet-transfer")');
  expect(edgeExtraClassBlock).toContain('classes.push("edge-deep-grouped-transfer")');
  expect(edgeExtraClassBlock).toContain('edge?.metadata?.evidenceType === "grouped_transfers"');
  expect(edgeExtraClassBlock).toContain('edge?.metadata?.source === "directCounterpartyInteractionProfile"');
  expect(edgeExtraClassBlock).toContain('aggregateTransferCount');
  expect(edgeExtraClassBlock).toContain("> 1");
});

it("contains grouped transfer period label helpers", () => {
  const html = adminConsoleHtml();

  expect(html).toContain("function groupedTransferPeriodLabel");
  expect(html).toContain("metadata?.underlyingTransfers");
  expect(html).toContain("${count} tx - ${amount}");
  expect(html).toContain("canvasTimestampLabel");
});
```

- [ ] **Step 2: Make grouped labels use count, total amount, and period**

In `src/admin/adminConsole.ts`, update `edgeContextCanvasLabel(edge)` so grouped direct transfer edges return:

```js
{
  title: `${count} tx - ${amount}`,
  subtitle: periodLabel,
}
```

Use this helper:

```js
function groupedTransferPeriodLabel(edge) {
  const transfers = asArray(edge?.metadata?.underlyingTransfers);
  const times = transfers
    .map((transfer) => Date.parse(transfer?.timestamp || ""))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (times.length === 0) return canvasTimestampLabel(edge?.timestamp || "");
  const first = new Date(times[0]);
  const last = new Date(times[times.length - 1]);
  const firstLabel = canvasTimestampLabel(first.toISOString());
  const lastLabel = canvasTimestampLabel(last.toISOString());
  if (firstLabel === lastLabel) return firstLabel;
  const sameMonth = first.getUTCFullYear() === last.getUTCFullYear() && first.getUTCMonth() === last.getUTCMonth();
  if (sameMonth) {
    return `${first.toLocaleString("en", { month: "short", timeZone: "UTC" })} ${first.getUTCDate()}-${last.getUTCDate()}`;
  }
  return `${firstLabel} - ${lastLabel}`;
}
```

- [ ] **Step 3: Keep single transfer label short**

Ensure a single direct transfer label is:

```text
amount
human time
```

It must not say `1 tx` and must not use grouped styling.

- [ ] **Step 4: Run console tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts
```

Expected:

```text
PASS tests/admin/adminConsole.test.ts
```

---

### Task 4: Make Expand Selected Work For Grouped Transfers

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add a failing test for grouped edge expansion**

Add this test:

```ts
it("opens grouped transfer evidence when expand selected is used on a grouped edge", () => {
  const html = adminConsoleHtml();
  const expandBlock = html.slice(html.indexOf("function expandSelectedGraphItem"), html.indexOf("function expandCollapsedNode"));
  const transferRowsBlock = html.slice(html.indexOf("function edgeTransferEvidenceRows"), html.indexOf("function transferEvidenceRowsHtml"));

  expect(expandBlock).toContain("state.selected.type === \"edge\"");
  expect(expandBlock).toContain("edgeHasAggregatedTxEvidence(edge)");
  expect(expandBlock).toContain("setTransferDrawer(true)");
  expect(expandBlock).toContain("setTransferTab(\"selected\")");
  expect(transferRowsBlock).toContain("metadata?.underlyingTransfers");
  expect(transferRowsBlock).toContain("txHash");
  expect(transferRowsBlock).toContain("fromAddress");
  expect(transferRowsBlock).toContain("toAddress");
  expect(transferRowsBlock).toContain("canvasTimestampLabel");
});
```

- [ ] **Step 2: Route expand action through selected edge metadata**

In `src/admin/adminConsole.ts`, ensure `expandSelectedGraphItem()` keeps this edge branch:

```js
if (state.selected.type === "edge") {
  const edge = edgeById(state.selected.id);
  if (!edge || (!edgeHasAggregatedTxEvidence(edge) && edgeTxHashes(edge).length === 0)) {
    setStatus("No stored transaction expansion for this selected edge.");
    return;
  }
  setTransferDrawer(true);
  setTransferTab("selected");
  setStatus("Showing selected transaction evidence.");
  renderSelectionCard();
  renderDetails();
  return;
}
```

- [ ] **Step 3: Render transfer evidence drawer from `metadata.underlyingTransfers`**

Keep `edgeTransferEvidenceRows(edge)` as the single source for selected edge expansion. It must first use stored transfer objects:

```js
function edgeTransferEvidenceRows(edge) {
  const transfers = asArray(edge?.metadata?.underlyingTransfers).filter((item) => item && typeof item === "object");
  if (transfers.length > 0) {
    return transfers.map((item) => ({
      amount: formatRawUsdt(item?.amountRaw) || item?.amountRaw || "amount n/a",
      time: canvasTimestampLabel(item?.timestamp) || item?.timestamp || "time n/a",
      txGap: item?.txGap || item?.gap || "n/a",
      fromAddress: item?.fromAddress || edgeFromAddress(edge),
      toAddress: item?.toAddress || edgeToAddress(edge),
      txHash: item?.txHash || "",
      path: edgePathId(edge) || "n/a",
      verdict: edge?.verdict || "unknown",
    }));
  }
  if (!edgeHasAggregatedTxEvidence(edge)) return [];
  const hashes = edgeTxHashes(edge);
  return hashes.map((txHash, index) => ({
    amount: hashes.length === 1 ? edgeDetailedAmountLabel(edge) || edgeAggregateAmountLabel(edge) || "amount n/a" : "amount n/a",
    time: hashes.length === 1 ? edgeTime(edge) || "time n/a" : "time n/a",
    txGap: index === 0 ? edgeTxGap(edge) || "n/a" : "n/a",
    fromAddress: edgeFromAddress(edge),
    toAddress: edgeToAddress(edge),
    txHash,
    path: edgePathId(edge) || "n/a",
    verdict: edge?.verdict || "unknown",
  }));
}
```

- [ ] **Step 4: Run console tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts
```

Expected:

```text
PASS tests/admin/adminConsole.test.ts
```

---

### Task 5: Add Reciprocal Flow Metadata

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add reciprocal projection test**

Add this test:

```ts
it("marks opposite same-pair direct transfers as reciprocal flow", () => {
  const subject = "TSubject555555555555555555555555555555";
  const counterparty = "TCounter55555555555555555555555555555";
  const job = makeForensicJob({
    kind: "address_deep_check",
    address: subject,
    result: {
      subject,
      directCounterpartyInteractionProfiles: [
        {
          counterpartyAddress: counterparty,
          direction: "inbound",
          txCount: 1,
          volumeRaw: "1000000",
          transfers: [
            {
              txHash: "4444444444444444444444444444444444444444444444444444444444444444",
              fromAddress: counterparty,
              toAddress: subject,
              amountRaw: "1000000",
              timestamp: "2026-02-11T10:00:00.000Z",
            },
          ],
        },
        {
          counterpartyAddress: counterparty,
          direction: "outbound",
          txCount: 1,
          volumeRaw: "900000",
          transfers: [
            {
              txHash: "5555555555555555555555555555555555555555555555555555555555555555",
              fromAddress: subject,
              toAddress: counterparty,
              amountRaw: "900000",
              timestamp: "2026-02-11T10:02:00.000Z",
            },
          ],
        },
      ],
    },
  });

  const graph = projectForensicJobGraph(job);
  const reciprocalEdges = graph.edges.filter((edge) => edge.metadata?.reciprocalFlow === true);

  expect(reciprocalEdges).toHaveLength(2);
  expect(reciprocalEdges.every((edge) => Array.isArray(edge.metadata?.reciprocalEdgeIds))).toBe(true);
});
```

- [ ] **Step 2: Add reciprocal annotation helper**

Add this helper in `src/admin/forensicsGraph.ts`:

```ts
function annotateReciprocalDirectCounterpartyFlows(edges: ForensicsGraphEdge[]): void {
  const byPair = new Map<string, ForensicsGraphEdge[]>();
  for (const edge of edges) {
    if (edge.metadata?.source !== "directCounterpartyInteractionProfile") continue;
    const from = String(edge.from);
    const to = String(edge.to);
    const pairKey = [from, to].sort().join("<->");
    const list = byPair.get(pairKey) ?? [];
    list.push(edge);
    byPair.set(pairKey, list);
  }

  for (const [pairKey, pairEdges] of byPair.entries()) {
    const directions = new Set(pairEdges.map((edge) => `${edge.from}->${edge.to}`));
    if (directions.size < 2) continue;
    const reciprocalEdgeIds = pairEdges.map((edge) => edge.id);
    for (const edge of pairEdges) {
      edge.metadata = {
        ...edge.metadata,
        reciprocalFlow: true,
        reciprocalPairKey: pairKey,
        reciprocalEdgeIds,
      };
    }
  }
}
```

- [ ] **Step 3: Call the helper before returning the graph**

In the DeepCheck graph projection return path, call:

```ts
annotateReciprocalDirectCounterpartyFlows(edges);
```

Call it after all direct profile edges have been added and before metrics are finalized.

- [ ] **Step 4: Run projection tests**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts
```

Expected:

```text
PASS tests/admin/forensicsGraph.test.ts
```

---

### Task 6: Render Reciprocal Flow Clearly In The Admin

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add a rendering test for reciprocal copy**

Add this test:

```ts
it("shows reciprocal flow context in the selected edge right rail", () => {
  const html = adminConsoleHtml();
  const reciprocalBlock = html.slice(html.indexOf("function reciprocalFlowHtml"), html.indexOf("function selectedEdgeCard"));
  const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));
  const edgeClassBlock = html.slice(html.indexOf("function edgeExtraClass"), html.indexOf("function edgeSemanticAttrs"));

  expect(reciprocalBlock).toContain("edge?.metadata?.reciprocalFlow");
  expect(html).toContain("Reciprocal flow");
  expect(html).toContain("This pair moved funds in both directions");
  expect(selectedEdgeCardBlock).toContain("reciprocalFlowHtml(edge)");
  expect(edgeClassBlock).toContain("edge-reciprocal-flow");
});
```

- [ ] **Step 2: Add right-rail reciprocal block**

In selected edge detail rendering, add:

```js
function reciprocalFlowHtml(edge) {
  if (edge?.metadata?.reciprocalFlow !== true) return "";
  return cardBlockHtml("Reciprocal flow", `
    <p class="muted">This pair moved funds in both directions. Treat it as circular evidence, not as a clean source resolution.</p>
    <div class="kv"><span>Pair</span><strong>${escapeHtml(edge.metadata.reciprocalPairKey || "n/a")}</strong></div>
    <div class="kv"><span>Related edges</span><strong>${asArray(edge.metadata.reciprocalEdgeIds).length}</strong></div>
  `);
}
```

Append this block to selected edge details.

- [ ] **Step 3: Add subtle visual styling**

In the CSS string in `src/admin/adminConsole.ts`, add:

```css
.edge-reciprocal-flow {
  stroke-dasharray: 7 7;
  filter: drop-shadow(0 0 5px rgba(168, 139, 250, 0.22));
}
```

Update `edgeExtraClass(edge)`:

```js
if (edge?.metadata?.reciprocalFlow === true) classes.push("edge-reciprocal-flow");
```

- [ ] **Step 4: Run console tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts
```

Expected:

```text
PASS tests/admin/adminConsole.test.ts
```

---

### Task 7: Add Saved Wallet Risk Context For Neighbor Nodes

**Files:**
- Modify: `tests/admin/adminServer.test.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`
- Modify: `src/admin/adminServer.ts`
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `src/storage/repositories.ts`

- [ ] **Step 1: Check for an existing repository helper**

Run:

```bash
rg -n "risk.*address|address.*risk|latest.*job|forensic.*address|find.*wallet" src/storage src/admin
```

Expected:

```text
Either an existing read helper is found, or no helper is found.
```

If an existing helper returns latest forensic risk by address, use it. If it does not exist, add the helper in Step 3.

- [ ] **Step 2: Add an admin API test for saved neighbor risk**

In `tests/admin/adminServer.test.ts`, add a test that inserts:

1. a completed job for neighbor address `TNeighborRisk11111111111111111111111` with `finalRisk: 95`, role `drainer`, evidence `exact approval-drain`;
2. a DeepCheck job whose graph contains that neighbor.

Assert the graph response includes:

```ts
expect(neighborNode?.metadata?.savedWalletRisk?.risk).toBe(95);
expect(neighborNode?.metadata?.savedWalletRisk?.role).toBe("drainer");
expect(neighborNode?.metadata?.savedWalletRisk?.evidence).toContain("approval-drain");
```

- [ ] **Step 3: Add the smallest repository helper if needed**

Add this helper to `src/storage/repositories.ts` unless Step 1 finds an existing helper that already returns the same fields:

```ts
export type SavedWalletRiskSummary = {
  address: string;
  jobId: string;
  kind: string;
  risk: number | null;
  decision: string | null;
  role: string | null;
  evidence: string | null;
  createdAt: string;
};

export async function findLatestSavedWalletRiskByAddresses(
  db: Db,
  addresses: string[],
): Promise<Map<string, SavedWalletRiskSummary>> {
  const unique = [...new Set(addresses.filter(Boolean))];
  const result = new Map<string, SavedWalletRiskSummary>();
  if (unique.length === 0) return result;

  const rows = await db.query(
    `
      select distinct on (subject_address)
        subject_address as address,
        id as "jobId",
        kind,
        nullif(result_json->'risk'->>'score', '')::int as risk,
        nullif(result_json->>'decision', '') as decision,
        coalesce(
          nullif(result_json->'role'->>'primary', ''),
          nullif(result_json->'walletRole'->>'role', ''),
          nullif(result_json->>'role', '')
        ) as role,
        coalesce(
          nullif(result_json->'risk'->>'evidence', ''),
          nullif(result_json->>'evidence', ''),
          nullif(result_json->'summary'->>'evidenceClass', '')
        ) as evidence,
        created_at as "createdAt"
      from forensic_check_jobs
      where subject_address = any($1)
        and status in ('completed', 'partial')
      order by subject_address, created_at desc
    `,
    [unique],
  );

  for (const row of rows.rows) {
    result.set(row.address, row as SavedWalletRiskSummary);
  }
  return result;
}
```

This helper uses the existing `forensic_check_jobs` table and `result_json`. Do not add a migration for this helper.

- [ ] **Step 4: Enrich admin graph response**

In `src/admin/adminServer.ts`, after projecting a selected graph and before returning JSON, collect node addresses:

```ts
const graphAddresses = graph.nodes
  .map((node) => typeof node.address === "string" ? node.address : typeof node.metadata?.address === "string" ? node.metadata.address : null)
  .filter((address): address is string => Boolean(address));
```

Fetch saved risk:

```ts
const savedRiskByAddress = await findLatestSavedWalletRiskByAddresses(db, graphAddresses);
```

Attach it:

```ts
for (const node of graph.nodes) {
  const address = typeof node.address === "string" ? node.address : typeof node.metadata?.address === "string" ? node.metadata.address : null;
  const savedRisk = address ? savedRiskByAddress.get(address) : null;
  if (!savedRisk) continue;
  node.metadata = {
    ...node.metadata,
    savedWalletRisk: savedRisk,
  };
}
```

Skip this enrichment for the subject node if it would duplicate the selected job's own final risk.

- [ ] **Step 5: Render saved risk in node right rail**

In `src/admin/adminConsole.ts`, add:

```js
function savedWalletRiskHtml(node) {
  const risk = node?.metadata?.savedWalletRisk;
  if (!risk) return "";
  return cardBlockHtml("Saved wallet risk", `
    <div class="kv"><span>Risk</span><strong>${escapeHtml(String(risk.risk ?? "n/a"))}</strong></div>
    <div class="kv"><span>Role</span><strong>${escapeHtml(risk.role || "unknown")}</strong></div>
    <div class="kv"><span>Evidence</span><strong>${escapeHtml(risk.evidence || "n/a")}</strong></div>
    <div class="kv"><span>Source check</span><strong>${escapeHtml(risk.kind || "n/a")}</strong></div>
  `);
}
```

Append it in selected node details.

- [ ] **Step 6: Run admin API and console tests**

Run:

```bash
npm test -- tests/admin/adminServer.test.ts tests/admin/adminConsole.test.ts
```

Expected:

```text
PASS tests/admin/adminServer.test.ts tests/admin/adminConsole.test.ts
```

---

### Task 8: Split Stop Reason Copy In The Admin

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add projection test for two stop concepts**

Add this test:

```ts
it("keeps history completeness separate from hop sufficiency", () => {
  const job = makeForensicJob({
    kind: "address_deep_check",
    address: "TSubject666666666666666666666666666666",
    result: {
      subject: "TSubject666666666666666666666666666666",
      stopReasons: [
        {
          address: "TStop6666666666666666666666666666666",
          reason: "incoming_history_not_fetched",
          historyFullyFetched: false,
          enoughHistoryForHop: true,
        },
      ],
    },
  });

  const graph = projectForensicJobGraph(job);
  const stopNode = graph.nodes.find((node) => node.metadata?.reason === "incoming_history_not_fetched");

  expect(stopNode?.metadata?.historyFullyFetched).toBe(false);
  expect(stopNode?.metadata?.enoughHistoryForHop).toBe(true);
});
```

- [ ] **Step 2: Preserve metadata if present**

In stop/boundary node creation in `src/admin/forensicsGraph.ts`, copy these fields when present:

```ts
historyFullyFetched: booleanField(stop, "historyFullyFetched"),
enoughHistoryForHop: booleanField(stop, "enoughHistoryForHop"),
```

Add this helper near `stringField` / `numberField`:

```ts
function booleanField(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}
```

- [ ] **Step 3: Render stop copy plainly**

In `src/admin/adminConsole.ts`, for selected stop/boundary nodes show:

```text
Investigation stop
History fully fetched: no
Enough history for this hop: yes
Meaning: this is a data limit, not a money transfer.
```

Use `cardBlockHtml("Investigation stop", ...)`.

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
```

Expected:

```text
PASS tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
```

---

### Task 9: Full Verification And Regression Guard

**Files:**
- No new files.

- [ ] **Step 1: Run focused admin tests**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
```

Expected:

```text
PASS tests/admin/forensicsGraph.test.ts
PASS tests/admin/adminConsole.test.ts
PASS tests/admin/adminServer.test.ts
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:

```text
no TypeScript errors
```

- [ ] **Step 3: Run a narrow visual smoke check**

Start or restart the admin:

```bash
npm run admin
```

Open:

```text
http://127.0.0.1:8787/admin/forensics
```

Check these cases manually:

- DeepCheck with one transfer between two wallets shows one gray dashed line and no `1 tx` group label.
- DeepCheck with repeated transfers between same wallets shows one gray-violet grouped line.
- Clicking a grouped line shows all tx rows in the right rail.
- `Expand selected` opens the grouped transaction list.
- Opposite directions between the same wallets stay separate.
- Reciprocal flow copy appears when the same pair moved funds both ways.
- Saved high-risk neighbor context appears in the selected node right rail when available.

- [ ] **Step 4: Commit**

Stage only files touched by this plan:

```bash
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts src/admin/adminServer.ts src/storage/repositories.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts docs/superpowers/plans/2026-06-28-admin-deepcheck-transaction-grouping-and-circular-flow-plan.md
git commit -m "feat: refine deepcheck transfer grouping"
```

---

## Self-Review

Spec coverage:

- Single transaction is never a group: covered in Task 1, Task 2, Task 3.
- Repeated same-direction real transfers are grouped: covered in Task 1, Task 2, Task 3.
- Opposite directions are not merged: covered in Task 1.
- Episode split after a large gap: covered in Task 1 and Task 2.
- Grouped edges expand into transaction list: covered in Task 4.
- Circular / ping-pong flow is labeled: covered in Task 5 and Task 6.
- Circular flow is not treated as clean source resolution: covered by UI copy in Task 6; deeper trace continuation is documented as metadata-first in this implementation because source tracing behavior lives outside admin projection.
- Saved high-risk neighbor roles appear when available: covered in Task 7.
- Human-readable right rail transaction cards: covered in Task 3 and Task 4.
- Stop reason split: covered in Task 8.

Placeholder scan:

- No `TBD`.
- No `TODO`.
- No `???`.
- No unfilled placeholder steps.

Type consistency:

- Projection metadata uses `grouped_transfers`, `aggregateTransferCount`, `aggregateAmountRaw`, `underlyingTransfers`, `reciprocalFlow`, `reciprocalPairKey`, and `reciprocalEdgeIds`.
- Console rendering reads the same metadata keys.
- Tests assert the same metadata keys.
