# Admin Forensics Funding Bundle Dedupe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make funding bundle graph episodes render as one canonical route: collapsed bundles hide member wallets, expanded bundles show members once, and bundle-covered member-to-hop/member-to-target duplicate edges disappear.

**Architecture:** Keep raw forensic result generation unchanged and normalize the admin projection in `src/admin/forensicsGraph.ts`. Use the admin console only for presentation state: collapsed bundles hide stored member edges, double-click toggles expansion, and synthetic expansion nodes are only a fallback when the backend has no stored member edges.

**Tech Stack:** TypeScript, Vitest, inline SVG admin console in `src/admin/adminConsole.ts`, existing admin graph projection helpers.

---

## File Structure

- Modify `src/admin/forensicsGraph.ts`
  - Store complete bundle member transfer metadata on bundle nodes.
  - Suppress visible non-bundle edges that duplicate a bundle-covered member transfer.
  - Promote structured allowlisted CEX root-source addresses to service/CEX nodes.
- Modify `src/admin/adminConsole.ts`
  - Hide `bundleRole: "top_funder"` member edges while the bundle is collapsed.
  - Toggle bundle expansion on double-click.
  - Avoid adding synthetic member nodes when stored backend member edges already exist.
- Modify `tests/admin/forensicsGraph.test.ts`
  - Add where-is-money and incoming-deposit bundle dedupe regressions.
  - Add structured root-source CEX rendering regression.
- Modify `tests/admin/adminConsole.test.ts`
  - Add collapsed/expanded bundle presentation and double-click/toggle regressions.

No new dependency is needed. Do not change scoring calculation, trace generation, database schema, or transaction fetchers.

## Execution Notes

- Work on the current `master` worktree unless the user asks otherwise.
- Before execution, run `git status --short --branch` and keep existing unrelated dirty files intact.
- Do not run `git reset`, `git checkout --`, or delete user changes.
- Use `apply_patch` for manual edits.

---

### Task 1: Backend Where-Is-Money Regression Tests

**Files:**
- Modify: `tests/admin/forensicsGraph.test.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add failing tests for where-is-money bundle dedupe and CEX root-source promotion**

Insert these tests near the existing where-is-money funding bundle tests.

```ts
  it("hides where-is-money bundle-covered member edges and profile context duplicates", () => {
    const subject = "TSubject111111111111111111111111111111";
    const hop = "THop111111111111111111111111111111111";
    const funderA = "TFunderA11111111111111111111111111111";
    const funderB = "TFunderB11111111111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 40,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 1,
          targetAmountRaw: "40000000000",
          selectedAmountRaw: "40000000000"
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 40,
          provenanceConfidence: 60,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            stoppedReason: "unlabeled_service_boundary",
            riskScoreContribution: 40,
            balanceShare: 1,
            pathAddresses: [funderA, hop, subject],
            txHashes: ["tx-a", "tx-hop"],
            steps: [
              {
                txHash: "tx-a",
                fromAddress: funderA,
                toAddress: hop,
                amountRaw: "1700000000",
                timestamp: "2026-06-30T07:23:00.000Z"
              },
              {
                txHash: "tx-hop",
                fromAddress: hop,
                toAddress: subject,
                amountRaw: "40000000000",
                timestamp: "2026-06-30T07:25:00.000Z"
              }
            ],
            fundingBundles: [
              {
                hopTxHash: "tx-hop",
                hopAddress: hop,
                expectedAmountRaw: "40000000000",
                coveredAmountRaw: "40000000000",
                coverageRatio: 1,
                members: [
                  {
                    txHash: "tx-a",
                    fromAddress: funderA,
                    toAddress: hop,
                    originalAmountRaw: "1700000000",
                    usedAmountRaw: "1700000000",
                    timestamp: "2026-06-30T07:23:00.000Z"
                  },
                  {
                    txHash: "tx-b",
                    fromAddress: funderB,
                    toAddress: hop,
                    originalAmountRaw: "38300000000",
                    usedAmountRaw: "38300000000",
                    timestamp: "2026-06-30T07:24:00.000Z"
                  }
                ]
              }
            ],
            reasons: ["Path risk contribution"]
          }
        ],
        senderInteractionProfiles: [
          {
            senderAddress: hop,
            balanceTransferTxHash: "tx-hop",
            topIncomingCounterparties: [
              {
                address: funderA,
                volumeRaw: "1800000000",
                txHashes: ["tx-a", "tx-other-context"],
                txCount: 2,
                firstSeen: "2026-06-30T07:23:00.000Z",
                lastSeen: "2026-06-30T08:00:00.000Z"
              }
            ],
            topOutgoingCounterparties: []
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const bundleNode = result.graph.nodes.find((node) => node.kind === "bundle");
    expect(bundleNode?.metadata).toMatchObject({
      bundleKind: "money_origin_funding_bundle",
      hopAddress: hop,
      memberCount: 2
    });

    expect(result.graph.edges.filter((edge) => edge.metadata.bundleNodeId === bundleNode?.id)).toHaveLength(3);
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${hop}`,
        toNodeId: `addr:${subject}`,
        txHash: "tx-hop"
      })
    ]));
    expect(result.graph.edges.find((edge) =>
      edge.fromNodeId === `addr:${funderA}` &&
      edge.toNodeId === `addr:${hop}` &&
      edge.txHash === "tx-a"
    )).toBeUndefined();
    expect(result.graph.edges.find((edge) =>
      edge.metadata.source === "senderInteractionProfile" &&
      edge.fromNodeId === `addr:${funderA}` &&
      edge.toNodeId === `addr:${hop}`
    )).toBeUndefined();
  });

  it("marks structured allowlisted CEX root-source addresses as CEX nodes", () => {
    const subject = "TSubject111111111111111111111111111111";
    const cex = "TKuCoin4111111111111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 12,
        decision: "ACCEPTABLE",
        coverage: {
          coverageRatio: 1,
          targetAmountRaw: "1000000000",
          selectedAmountRaw: "1000000000"
        },
        assessment: {
          decision: "ACCEPTABLE",
          riskScore: 12,
          provenanceConfidence: 80,
          reasons: []
        },
        originPaths: [
          {
            verdict: "ACCEPTABLE",
            stoppedReason: "allowlist_cex_reached",
            rootSourceAddress: cex,
            rootSourceType: "allowlist_cex",
            sourceExposureKind: "allowlisted_cex",
            exposureSourceLabel: "KuCoin 4",
            riskScoreContribution: 0,
            balanceShare: 1,
            pathAddresses: [cex, subject],
            txHashes: ["tx-cex"],
            steps: [
              {
                txHash: "tx-cex",
                fromAddress: cex,
                toAddress: subject,
                amountRaw: "1000000000",
                timestamp: "2026-06-30T07:23:00.000Z"
              }
            ],
            reasons: ["Allowlisted CEX source reached."]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const node = result.graph.nodes.find((item) => item.address === cex);
    expect(node).toMatchObject({
      kind: "service",
      displayKind: "cex",
      label: "KuCoin 4",
      displayLabel: "KuCoin 4",
      metadata: expect.objectContaining({
        category: "cex",
        serviceCategory: "cex",
        rootSourceType: "allowlist_cex",
        sourceExposureKind: "allowlisted_cex",
        identity: "KuCoin 4"
      })
    });
    expect(node?.metadata.boundaryIdentity).toMatchObject({
      category: "cex",
      displayName: "KuCoin 4",
      source: "known_cex_rule"
    });
  });
```

- [ ] **Step 2: Run the new where-is-money tests and verify they fail**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts -t "where-is-money bundle-covered member edges|structured allowlisted CEX"
```

Expected: FAIL. The first test should still find a direct `addr:TFunderA... -> addr:THop...` duplicate or profile edge. The second test should show the CEX node still rendering as `wallet` or lacking `boundaryIdentity`.

- [ ] **Step 3: Commit the failing tests only**

Run:

```powershell
git add tests/admin/forensicsGraph.test.ts
git commit -m "test: cover funding bundle graph dedupe"
```

Expected: commit succeeds and contains only the failing regression tests.

---

### Task 2: Backend Bundle Normalization and Root-Source CEX Promotion

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add stored bundle member transfer metadata**

In `projectWhereIsMoneyJob`, inside the `fundingBundles.forEach` block before `nodesById.set(bundleId, ...)`, add:

```ts
        const memberTransfers = members
          .map((member) => ({
            txHash: stringField(member, "txHash"),
            fromAddress: stringField(member, "fromAddress"),
            toAddress: stringField(member, "toAddress"),
            amountRaw: firstString(
              stringField(member, "usedAmountRaw"),
              stringField(member, "coveredAmountRaw"),
              stringField(member, "originalAmountRaw")
            ),
            timestamp: stringField(member, "timestamp")
          }))
          .filter((member): member is {
            txHash: string | null;
            fromAddress: string;
            toAddress: string;
            amountRaw: string | null;
            timestamp: string | null;
          } => !!member.fromAddress && !!member.toAddress);
```

Then add `memberTransfers` into that bundle node metadata object:

```ts
            memberTransfers,
```

In `projectIncomingDepositJob`, inside the `recordArrayField(path, "fundingBundles").forEach` block, introduce `fundingFunders` once:

```ts
        const fundingFunders = recordArrayField(bundle, "fundingFunders");
        const funderSummary = bundleTopFundersFromIncomingFunders(fundingFunders);
```

Replace the current `funderSummary` line with the two lines above. Before `nodesById.set(bundleId, ...)`, add:

```ts
        const memberTransfers = fundingFunders
          .flatMap((funder) => {
            const fromAddress = stringField(funder, "address");
            if (!fromAddress || !targetFromAddress) return [];
            const amountRaw = stringField(funder, "amountRaw");
            return stringArrayField(funder, "txHashes").map((txHash) => ({
              txHash,
              fromAddress,
              toAddress: targetFromAddress,
              amountRaw,
              timestamp: null
            }));
          });
```

Then add `memberTransfers` into that incoming bundle node metadata object:

```ts
            memberTransfers,
```

- [ ] **Step 2: Add the funding bundle duplicate suppressor**

Place this helper block after `removeNoTxTransferDuplicates`.

```ts
type FundingBundleMemberTransfer = {
  bundleNodeId: string;
  fromNodeId: string;
  toNodeId: string;
  txHashes: Set<string>;
  amountRawValues: Set<string>;
  timestamps: Set<string>;
};

function edgeMetadataTxHashes(edge: AdminForensicsEdge): string[] {
  return [
    edge.txHash,
    ...stringArrayField(edge.metadata, "txHashes"),
    ...recordArrayField(edge.metadata, "underlyingTransfers")
      .map((transfer) => stringField(transfer, "txHash"))
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

function bundleMemberTransferKey(fromNodeId: string, toNodeId: string): string {
  return `${fromNodeId}->${toNodeId}`;
}

function collectFundingBundleMemberTransfers(nodesById: Map<string, AdminForensicsNode>): Map<string, FundingBundleMemberTransfer[]> {
  const byDirectedPair = new Map<string, FundingBundleMemberTransfer[]>();
  const pushTransfer = (transfer: FundingBundleMemberTransfer): void => {
    const key = bundleMemberTransferKey(transfer.fromNodeId, transfer.toNodeId);
    const current = byDirectedPair.get(key) ?? [];
    current.push(transfer);
    byDirectedPair.set(key, current);
  };

  nodesById.forEach((node) => {
    if (node.kind !== "bundle") return;
    const bundleNodeId = node.id;
    const explicitTransfers = recordArrayField(node.metadata, "memberTransfers");
    explicitTransfers.forEach((transfer) => {
      const fromAddress = stringField(transfer, "fromAddress");
      const toAddress = stringField(transfer, "toAddress");
      if (!fromAddress || !toAddress) return;
      const txHash = stringField(transfer, "txHash");
      const amountRaw = stringField(transfer, "amountRaw");
      const timestamp = stringField(transfer, "timestamp");
      pushTransfer({
        bundleNodeId,
        fromNodeId: nodeId(fromAddress),
        toNodeId: nodeId(toAddress),
        txHashes: new Set(txHash ? [txHash] : []),
        amountRawValues: new Set(amountRaw ? [amountRaw] : []),
        timestamps: new Set(timestamp ? [timestamp] : [])
      });
    });

    if (explicitTransfers.length > 0) return;
    const targetAddress = firstString(
      stringField(node.metadata, "hopAddress"),
      stringField(node.metadata, "targetFromAddress")
    );
    if (!targetAddress) return;
    recordArrayField(node.metadata, "topFunders").forEach((funder) => {
      const address = stringField(funder, "address");
      if (!address) return;
      pushTransfer({
        bundleNodeId,
        fromNodeId: nodeId(address),
        toNodeId: nodeId(targetAddress),
        txHashes: new Set(stringArrayField(funder, "txHashes")),
        amountRawValues: new Set(stringField(funder, "amountRaw") ? [stringField(funder, "amountRaw") as string] : []),
        timestamps: new Set()
      });
    });
  });

  return byDirectedPair;
}

function edgeMatchesBundleMemberTransfer(edge: AdminForensicsEdge, transfer: FundingBundleMemberTransfer): boolean {
  const txHashes = edgeMetadataTxHashes(edge);
  if (txHashes.some((txHash) => transfer.txHashes.has(txHash))) return true;

  const edgeAmount = firstString(
    edge.amountRaw,
    rawString(edge.metadata.aggregateAmountRaw),
    rawString(edge.metadata.usedAmountRaw),
    rawString(edge.metadata.originalAmountRaw)
  );
  if (!edgeAmount || !transfer.amountRawValues.has(edgeAmount)) return false;

  const edgeTimestamp = edge.timestamp ?? stringField(edge.metadata, "lastSeen") ?? stringField(edge.metadata, "firstSeen");
  if (transfer.timestamps.size === 0 || !edgeTimestamp) return txHashes.length === 0;
  return transfer.timestamps.has(edgeTimestamp);
}

function suppressFundingBundleDuplicateEdges(
  edges: AdminForensicsEdge[],
  paths: AdminForensicsPath[],
  nodesById: Map<string, AdminForensicsNode>
): void {
  const memberTransfers = collectFundingBundleMemberTransfers(nodesById);
  if (memberTransfers.size === 0) return;

  const removeIds = new Set<string>();
  for (const edge of edges) {
    if (edge.type === "stop" || edge.metadata.bundleRole || edge.metadata.bundleNodeId) continue;
    const transfers = memberTransfers.get(bundleMemberTransferKey(edge.fromNodeId, edge.toNodeId));
    if (!transfers) continue;
    const matched = transfers.find((transfer) => edgeMatchesBundleMemberTransfer(edge, transfer));
    if (!matched) continue;
    removeIds.add(edge.id);
    const bundleNode = nodesById.get(matched.bundleNodeId);
    if (bundleNode) {
      const hiddenEdgeIds = stringArrayField(bundleNode.metadata, "hiddenDuplicateEdgeIds");
      bundleNode.metadata.hiddenDuplicateEdgeIds = [...new Set([...hiddenEdgeIds, edge.id])];
    }
  }
  if (removeIds.size === 0) return;

  for (let index = edges.length - 1; index >= 0; index -= 1) {
    if (removeIds.has(edges[index].id)) edges.splice(index, 1);
  }
  for (const path of paths) {
    path.edgeIds = path.edgeIds.filter((edgeId) => !removeIds.has(edgeId));
    if (path.lastRealEdgeId && removeIds.has(path.lastRealEdgeId)) path.lastRealEdgeId = null;
  }
}
```

- [ ] **Step 3: Call the suppressor in where-is-money and incoming-deposit projections**

In `projectWhereIsMoneyJob`, just before `removeNoTxTransferDuplicates(edges, paths);`, add:

```ts
  suppressFundingBundleDuplicateEdges(edges, paths, nodesById);
```

In `projectIncomingDepositJob`, just before `annotateGraphDerivedMetrics(nodesById, edges, paths, weights, job.kind);`, add:

```ts
  suppressFundingBundleDuplicateEdges(edges, paths, nodesById);
```

This keeps bundle member edges, bundle-to-hop/target edges, and unrelated member edges. It removes only visible non-bundle duplicates for the same directed member funding episode.

- [ ] **Step 4: Add structured root-source CEX promotion**

Place this helper after `attachBoundaryIdentity`.

```ts
function attachStructuredRootSourceBoundary(
  node: AdminForensicsNode | undefined,
  path: Record<string, unknown>,
  address: string
): void {
  if (!node || node.kind === "subject") return;
  const rootSourceType = stringField(path, "rootSourceType");
  const sourceExposureKind = stringField(path, "sourceExposureKind");
  const isCexSource =
    rootSourceType === "allowlist_cex" ||
    sourceExposureKind === "allowlisted_cex" ||
    sourceExposureKind === "unknown_cex";
  if (!isCexSource) return;

  const identity = firstString(
    stringField(path, "rootSourceIdentity"),
    stringField(path, "rootSourceLabel"),
    stringField(path, "exposureSourceLabel")
  );
  node.metadata = {
    ...node.metadata,
    category: "cex",
    serviceCategory: "cex",
    rootSourceType,
    sourceExposureKind,
    ...(identity ? { identity } : {})
  };
  attachBoundaryIdentity(node, normalizeBoundaryIdentity({
    address,
    category: "cex",
    identity,
    source: identity ? "known_cex_rule" : "root_source",
    evidence: [
      rootSourceType ? `rootSourceType:${rootSourceType}` : "",
      sourceExposureKind ? `sourceExposureKind:${sourceExposureKind}` : ""
    ].filter(Boolean)
  }));
}
```

In `projectWhereIsMoneyJob`, after `const pathNodeIds = uniqueAddressChain.map(...)`, add:

```ts
    if (rootSourceAddress) {
      attachStructuredRootSourceBoundary(nodesById.get(nodeId(rootSourceAddress)), item, rootSourceAddress);
    }
```

- [ ] **Step 5: Run the where-is-money tests**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts -t "where-is-money bundle-covered member edges|structured allowlisted CEX"
```

Expected: PASS.

- [ ] **Step 6: Commit backend implementation**

Run:

```powershell
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "fix: canonicalize funding bundle graph edges"
```

Expected: commit succeeds.

---

### Task 3: Incoming Deposit Bundle Dedupe Regression

**Files:**
- Modify: `tests/admin/forensicsGraph.test.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add failing incoming-deposit dedupe test**

Insert this test near `projects incoming-deposit funding bundles as graph groups`.

```ts
  it("hides incoming-deposit bundle-covered member-to-target duplicates", () => {
    const sender = "TSender1111111111111111111111111111111";
    const receiver = "TReceiver111111111111111111111111111111";
    const funder = "TFunderIncoming111111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "incoming_deposit_check",
      subjectAddress: sender,
      progressJson: {
        watchedWallet: receiver,
        sender,
        depositTxHash: "deposit-tx",
        amountRaw: "850000000000",
        timestamp: "2026-06-02T09:46:39.000Z"
      },
      resultJson: {
        decision: "REVIEW",
        depositRiskScore: 45,
        originPaths: [
          {
            verdict: "REVIEW",
            score: 35,
            sourcePolicy: "unknown",
            stoppedReason: "bridge_router_dex_reached",
            pathAddresses: [funder, sender, receiver],
            txHashes: ["funding-tx", "deposit-tx"],
            steps: [
              {
                txHash: "funding-tx",
                fromAddress: funder,
                toAddress: sender,
                amountRaw: "850000000000",
                timestamp: "2026-06-01T09:46:39.000Z"
              },
              {
                txHash: "deposit-tx",
                fromAddress: sender,
                toAddress: receiver,
                amountRaw: "850000000000",
                timestamp: "2026-06-02T09:46:39.000Z"
              }
            ],
            fundingBundles: [
              {
                targetTxHash: "deposit-tx",
                targetFromAddress: sender,
                targetToAddress: receiver,
                targetAmountRaw: "850000000000",
                bundleAmountRaw: "850000000000",
                bundleCoverageRatio: 1,
                windowStart: "2026-06-01T09:46:39.000Z",
                windowEnd: "2026-06-02T09:46:39.000Z",
                fundingTxHashes: ["funding-tx"],
                fundingAddresses: [funder],
                fundingFunders: [
                  { address: funder, amountRaw: "850000000000", txHashes: ["funding-tx"] }
                ]
              }
            ],
            amountCoverageRatio: 1,
            amountContinuity: "strong",
            proximityHops: 1,
            reasons: ["Funding bundle covered the deposit."]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const bundleNode = result.graph.nodes.find((node) => node.kind === "bundle");
    expect(bundleNode?.metadata).toMatchObject({
      bundleKind: "incoming_deposit_funding_bundle",
      targetFromAddress: sender
    });
    expect(result.graph.edges.filter((edge) => edge.metadata.bundleNodeId === bundleNode?.id)).toHaveLength(2);
    expect(result.graph.edges.find((edge) =>
      edge.fromNodeId === `addr:${funder}` &&
      edge.toNodeId === `addr:${sender}` &&
      edge.txHash === "funding-tx"
    )).toBeUndefined();
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${sender}`,
        toNodeId: `addr:${receiver}`,
        txHash: "deposit-tx"
      })
    ]));
  });
```

- [ ] **Step 2: Run the incoming-deposit test**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts -t "incoming-deposit bundle-covered"
```

Expected: PASS after Task 2. If it fails, the suppressor is not being called in `projectIncomingDepositJob` or incoming bundle `memberTransfers` are not populated correctly.

- [ ] **Step 3: Commit incoming regression**

Run:

```powershell
git add tests/admin/forensicsGraph.test.ts
git commit -m "test: cover incoming bundle graph dedupe"
```

Expected: commit succeeds.

---

### Task 4: Admin Console Collapsed/Expanded Bundle Presentation

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add failing admin console presentation tests**

Append this test near the existing funding bundle presentation tests.

```ts
  it("hides stored funding bundle members while collapsed and shows them once when expanded", () => {
    const html = adminConsoleHtml();
    const presentationBlock = html.slice(html.indexOf("function applyExpandedBundlePresentation"), html.indexOf("function nodeImportanceScore"));

    expect(presentationBlock).toContain("function applyBundleMemberVisibility");
    expect(presentationBlock).toContain('edge?.metadata?.bundleRole === "top_funder"');
    expect(presentationBlock).toContain("state.expandedBundleNodeIds.has(bundleNodeId)");
    expect(presentationBlock).toContain("storedMemberEdgesByBundleId");

    const api = new Function(`
      const state = { expandedBundleNodeIds: new Set() };
      function asArray(value) { return Array.isArray(value) ? value : []; }
      ${presentationBlock}
      return { applyExpandedBundlePresentation, state };
    `)() as {
      applyExpandedBundlePresentation(nodes: any[], edges: any[]): { nodes: any[]; edges: any[] };
      state: { expandedBundleNodeIds: Set<string> };
    };

    const nodes = [
      { id: "bundle", kind: "bundle", displayKind: "funding_bundle", metadata: { topFunders: [{ address: "TFunder", amountRaw: "100", txHashes: ["tx-fund"] }] } },
      { id: "target", kind: "wallet", address: "TTarget", metadata: {} },
      { id: "funder", kind: "wallet", address: "TFunder", metadata: {} }
    ];
    const edges = [
      { id: "member", fromNodeId: "funder", toNodeId: "bundle", metadata: { bundleNodeId: "bundle", bundleRole: "top_funder" } },
      { id: "target", fromNodeId: "bundle", toNodeId: "target", metadata: { bundleNodeId: "bundle", bundleRole: "bundle_to_hop" } }
    ];

    let presentation = api.applyExpandedBundlePresentation(nodes, edges);
    expect(presentation.edges.map((edge) => edge.id)).toEqual(["target"]);
    expect(presentation.nodes.map((node) => node.id)).toEqual(["bundle", "target"]);

    api.state.expandedBundleNodeIds.add("bundle");
    presentation = api.applyExpandedBundlePresentation(nodes, edges);
    expect(presentation.edges.map((edge) => edge.id).sort()).toEqual(["member", "target"]);
    expect(presentation.nodes.map((node) => node.id).sort()).toEqual(["bundle", "funder", "target"]);
    expect(presentation.nodes.filter((node) => String(node.id).startsWith("bundle-member:"))).toHaveLength(0);
  });

  it("toggles funding bundle expansion on double-click", () => {
    const html = adminConsoleHtml();
    const graphBlock = html.slice(html.indexOf('svg.querySelectorAll("[data-node-id]")'), html.indexOf('svg.querySelectorAll("[data-edge-id]")'));
    const expandBlock = html.slice(html.indexOf("function expandSelectedGraphItem"), html.indexOf("function selectNode"));

    expect(graphBlock).toContain('node.addEventListener("dblclick"');
    expect(graphBlock).toContain("toggleNodeExpansion(nodeId)");
    expect(expandBlock).toContain("function toggleNodeExpansion");
    expect(expandBlock).toContain("state.expandedBundleNodeIds.delete(state.selected.id)");
    expect(expandBlock).toContain("Collapsed selected funding bundle.");
  });
```

- [ ] **Step 2: Run the new admin console tests and verify they fail**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "stored funding bundle members|double-click"
```

Expected: FAIL. The current console does not hide stored member edges while collapsed and does not bind `dblclick`.

- [ ] **Step 3: Implement collapsed member visibility and synthetic fallback guard**

In `src/admin/adminConsole.ts`, replace `applyExpandedBundlePresentation` with this version and add the helper directly before it.

```js
    function applyBundleMemberVisibility(nodes, edges) {
      const hiddenMemberNodeIds = new Set();
      const keptEdges = [];
      edges.forEach((edge) => {
        const bundleNodeId = edge?.metadata?.bundleNodeId || "";
        const isStoredMemberEdge = edge?.metadata?.bundleRole === "top_funder";
        if (!isStoredMemberEdge || state.expandedBundleNodeIds.has(bundleNodeId)) {
          keptEdges.push(edge);
          return;
        }
        if (edge?.fromNodeId) hiddenMemberNodeIds.add(edge.fromNodeId);
      });
      if (hiddenMemberNodeIds.size === 0) return { nodes, edges: keptEdges };
      const connectedNodeIds = new Set();
      keptEdges.forEach((edge) => {
        if (edge?.fromNodeId) connectedNodeIds.add(edge.fromNodeId);
        if (edge?.toNodeId) connectedNodeIds.add(edge.toNodeId);
      });
      return {
        nodes: nodes.filter((node) => !hiddenMemberNodeIds.has(node.id) || connectedNodeIds.has(node.id) || node.kind === "subject"),
        edges: keptEdges
      };
    }

    function applyExpandedBundlePresentation(nodes, edges) {
      const visible = applyBundleMemberVisibility(nodes, edges);
      const visualNodes = [...visible.nodes];
      const visualEdges = [...visible.edges];
      const nodeIds = new Set(visualNodes.map((node) => node.id));
      const edgeIds = new Set(visualEdges.map((edge) => edge.id));
      const storedMemberEdgesByBundleId = new Set(visualEdges
        .filter((edge) => edge?.metadata?.bundleRole === "top_funder" && edge?.metadata?.bundleNodeId)
        .map((edge) => edge.metadata.bundleNodeId));
      visualNodes.filter((node) => state.expandedBundleNodeIds.has(node.id)).forEach((bundleNode) => {
        if (storedMemberEdgesByBundleId.has(bundleNode.id)) return;
        const memberNodes = expandedBundleMemberNodes(bundleNode);
        const memberEdges = expandedBundleMemberEdges(bundleNode, memberNodes);
        memberNodes.forEach((member) => {
          if (nodeIds.has(member.id)) return;
          nodeIds.add(member.id);
          visualNodes.push(member);
        });
        memberEdges.forEach((edge) => {
          if (edgeIds.has(edge.id)) return;
          edgeIds.add(edge.id);
          visualEdges.push(edge);
        });
      });
      return { nodes: visualNodes, edges: visualEdges };
    }
```

- [ ] **Step 4: Implement double-click toggle**

In `src/admin/adminConsole.ts`, add this helper immediately before `expandSelectedGraphItem`.

```js
    function toggleNodeExpansion(nodeId) {
      if (!nodeId) return false;
      state.selected = { type: "node", id: nodeId };
      const node = nodeById(nodeId);
      if (nodeDisplayKind(node) !== "funding_bundle" && !isDeepBranchGroupNodeId(nodeId) && !isCollapsedGroupNodeId(nodeId)) return false;
      if (nodeDisplayKind(node) === "funding_bundle" && state.expandedBundleNodeIds.has(nodeId)) {
        state.expandedBundleNodeIds.delete(nodeId);
        setStatus("Collapsed selected funding bundle.");
        renderGraph();
        renderDetails();
        renderSelectionCard();
        renderTransferTabs();
        return true;
      }
      expandSelectedGraphItem();
      return true;
    }
```

In the funding bundle branch at the end of `expandSelectedGraphItem`, replace the unconditional add with a toggle:

```js
      if (state.expandedBundleNodeIds.has(state.selected.id)) {
        state.expandedBundleNodeIds.delete(state.selected.id);
        setStatus("Collapsed selected funding bundle.");
      } else {
        state.expandedBundleNodeIds.add(state.selected.id);
        setStatus("Expanded selected funding bundle.");
      }
      renderGraph();
      renderDetails();
      renderSelectionCard();
      renderTransferTabs();
```

In `renderGraph`, inside the `svg.querySelectorAll("[data-node-id]").forEach((node) => { ... })` block, add this listener between the `click` and `mousedown` listeners:

```js
        node.addEventListener("dblclick", (event) => {
          const nodeId = node.getAttribute("data-node-id");
          event.preventDefault();
          event.stopPropagation();
          toggleNodeExpansion(nodeId);
        });
```

- [ ] **Step 5: Run the admin console tests**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "stored funding bundle members|double-click"
```

Expected: PASS.

- [ ] **Step 6: Commit admin console presentation**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix: collapse funding bundle members in admin graph"
```

Expected: commit succeeds.

---

### Task 5: Full Verification and Local QA

**Files:**
- Verify: `src/admin/forensicsGraph.ts`
- Verify: `src/admin/adminConsole.ts`
- Verify: `tests/admin/forensicsGraph.test.ts`
- Verify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Run focused admin graph tests**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
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

- [ ] **Step 4: Restart the admin app**

If a dev server is already running on `127.0.0.1:8787`, stop that process first. Then run:

```powershell
npm run dev
```

Expected: the server responds at `http://127.0.0.1:8787/admin/forensics`.

- [ ] **Step 5: Manual QA in admin forensics**

Open `http://127.0.0.1:8787/admin/forensics` and verify these cases:

```text
where_is_money_check job b6fe2695-a7b8-4690-99ac-4798db719f1e:
- collapsed funding bundle shows the bundle route without duplicate member -> TSuxWN...pX1fG8 lines
- double-clicking the bundle expands member wallets
- double-clicking the bundle again collapses member wallets
- member wallets do not appear twice after expansion

incoming_deposit_check latest job for the user-tested subject:
- collapsed funding bundle hides member funders
- expanded funding bundle shows member funders once
- gray/orange inferred provenance line is understandable as bundle funding context, not duplicated direct wallet flow

where_is_money_check path with structured CEX source:
- exchange/root-source wallet renders as CEX/service when structured root-source evidence exists
- generic unlabeled stop still remains a stop/boundary explanation, not a guessed exchange label
```

- [ ] **Step 6: Commit verification-only fixes if any**

If Task 5 discovers a small issue and the fix is made, run:

```powershell
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git commit -m "fix: polish funding bundle graph QA"
```

Expected: commit succeeds only if files changed.

---

## Self-Review

**Spec coverage:** Covered where-is-money funding bundles, incoming-deposit funding bundles, expanded/collapsed behavior, duplicate member-to-hop/member-to-target suppression, double-click toggle, and structured CEX root-source rendering.

**Placeholder scan:** No placeholder steps remain; every code-changing step includes concrete code and every verification step includes a runnable command.

**Type consistency:** Helper names are consistent across tasks: `memberTransfers`, `suppressFundingBundleDuplicateEdges`, `attachStructuredRootSourceBoundary`, `applyBundleMemberVisibility`, and `toggleNodeExpansion`.

**Implementation decision:** Collapsed bundle presentation hides stored `top_funder` member edges. This resolves the user-visible duplicate problem more directly than keeping member wallets visible beside a collapsed bundle.
