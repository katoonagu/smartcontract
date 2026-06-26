# Admin Node Intelligence Role Marks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend-projected wallet role intelligence to admin graph nodes and show it in the selected-node panel without changing graph visuals or scoring.

**Architecture:** Keep role decisions in `src/admin/forensicsGraph.ts`; the browser UI in `src/admin/adminConsole.ts` only renders role metadata that already exists on the node. First release is intentionally panel-only: no icons, no image assets, no role marks on the graph, and no frontend role guessing.

**Tech Stack:** TypeScript, Node.js, inline admin HTML/CSS/JavaScript, SVG graph renderer, Vitest.

---

## File Structure

- Modify: `src/admin/forensicsGraph.ts`
  - Add node-intelligence role types.
  - Convert existing `walletRoleProfiles` report data into `node.metadata.nodeIntelligence`.
  - Attach role metadata only to wallet-like and subject nodes whose address matches backend role data.

- Modify: `src/admin/adminConsole.ts`
  - Add selected-node panel rendering for `node.metadata.nodeIntelligence`.
  - Keep graph node drawing unchanged.
  - Keep role icon code out of first release.

- Modify: `tests/admin/forensicsGraph.test.ts`
  - Add projection tests for drainer, victim, collector, mule/transit, and ignored service/bundle/stop cases.

- Modify: `tests/admin/adminServer.test.ts`
  - Add admin shell assertions for selected-node role panel helper strings.

- Do not modify:
  - scoring modules;
  - traversal/check modules;
  - graph layout code;
  - icon assets or static asset serving.

## Known Constraints

- The current branch may contain unrelated dirty test files and docs. Stage only files listed in each task.
- The graph-first UI must remain visually unchanged after this first release.
- Do not infer roles from graph shape in `adminConsole.ts`.
- Do not add role icons or a `Role marks` toggle in this plan.
- Do not attach wallet roles to `service`, `contract`, `bundle`, or `stop` nodes.

---

### Task 1: Add Node Intelligence Projection Tests

**Files:**
- Modify: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add a failing drainer role projection test**

Append this test inside `describe("projectForensicJobGraph", () => { ... })` in `tests/admin/forensicsGraph.test.ts`:

```ts
  it("projects exact drainer wallet role into subject node intelligence", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: "TDrainer11111111111111111111111111111",
      resultJson: {
        subjectAddress: "TDrainer11111111111111111111111111111",
        walletRoleProfiles: [
          {
            subjectAddress: "TDrainer11111111111111111111111111111",
            primaryRole: "drainer_spender",
            evidenceStrength: "exact",
            roles: [
              {
                role: "drainer_spender",
                confidence: "high",
                score: 95,
                reasons: [
                  {
                    role: "drainer_spender",
                    code: "wallet_role_approval_drain_spender",
                    label: "Subject is the spender in an approval-drain transferFrom flow.",
                    scoreImpact: 95,
                    value: "approval-tx-1"
                  }
                ]
              }
            ],
            features: [
              {
                role: "drainer_spender",
                code: "wallet_role_approval_drain_spender",
                label: "Subject is the spender in an approval-drain transferFrom flow.",
                scoreImpact: 95,
                value: "approval-tx-1"
              }
            ]
          }
        ],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const subject = result.graph.nodes.find((node) => node.address === "TDrainer11111111111111111111111111111");
    expect(subject?.metadata.nodeIntelligence).toEqual({
      role: "drainer",
      label: "Drainer",
      evidenceStrength: "hard",
      source: "wallet_role_classifier",
      confidence: 95,
      explanation: "Subject is the spender in an approval-drain transferFrom flow.",
      signals: ["wallet_role_approval_drain_spender"]
    });
  });
```

- [ ] **Step 2: Add victim, collector, and mule/transit projection tests**

Add these tests in the same file:

```ts
  it("projects exact victim wallet role into subject node intelligence", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: "TVictim111111111111111111111111111111",
      resultJson: {
        subjectAddress: "TVictim111111111111111111111111111111",
        walletRoleProfiles: [
          {
            subjectAddress: "TVictim111111111111111111111111111111",
            primaryRole: "victim",
            evidenceStrength: "exact",
            roles: [
              {
                role: "victim",
                confidence: "high",
                score: 100,
                reasons: [
                  {
                    role: "victim",
                    code: "wallet_role_approval_drain_victim",
                    label: "Subject is the approval-drain victim address.",
                    scoreImpact: 100,
                    value: "drain-tx-1"
                  }
                ]
              }
            ],
            features: [
              {
                role: "victim",
                code: "wallet_role_approval_drain_victim",
                label: "Subject is the approval-drain victim address.",
                scoreImpact: 100,
                value: "drain-tx-1"
              }
            ]
          }
        ],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const subject = result.graph.nodes.find((node) => node.address === "TVictim111111111111111111111111111111");
    expect(subject?.metadata.nodeIntelligence).toMatchObject({
      role: "victim",
      label: "Victim",
      evidenceStrength: "hard",
      source: "wallet_role_classifier",
      confidence: 100,
      signals: ["wallet_role_approval_drain_victim"]
    });
  });

  it("projects collector wallet role as behavior node intelligence", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: "TCollector1111111111111111111111111111",
      resultJson: {
        subjectAddress: "TCollector1111111111111111111111111111",
        walletRoleProfiles: [
          {
            subjectAddress: "TCollector1111111111111111111111111111",
            primaryRole: "collector",
            evidenceStrength: "strong_behavior",
            roles: [
              {
                role: "collector",
                confidence: "high",
                score: 55,
                reasons: [
                  {
                    role: "collector",
                    code: "address_behavior_collector_like_wallet",
                    label: "Collector-like wallet.",
                    scoreImpact: 55
                  }
                ]
              }
            ],
            features: [
              {
                role: "collector",
                code: "address_behavior_collector_like_wallet",
                label: "Collector-like wallet.",
                scoreImpact: 55
              }
            ]
          }
        ],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const subject = result.graph.nodes.find((node) => node.address === "TCollector1111111111111111111111111111");
    expect(subject?.metadata.nodeIntelligence).toMatchObject({
      role: "collector",
      label: "Collector",
      evidenceStrength: "behavior",
      source: "wallet_role_classifier",
      confidence: 55,
      signals: ["address_behavior_collector_like_wallet"]
    });
  });

  it("projects mule wallet role as mule_transit node intelligence", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: "TMule111111111111111111111111111111111",
      resultJson: {
        subjectAddress: "TMule111111111111111111111111111111111",
        walletRoleProfiles: [
          {
            subjectAddress: "TMule111111111111111111111111111111111",
            primaryRole: "mule",
            evidenceStrength: "strong_behavior",
            roles: [
              {
                role: "mule",
                confidence: "medium",
                score: 45,
                reasons: [
                  {
                    role: "mule",
                    code: "wallet_role_mule_transit_pattern",
                    label: "Deposit-then-drain or transit-like activity suggests mule behavior.",
                    scoreImpact: 45
                  }
                ]
              }
            ],
            features: [
              {
                role: "mule",
                code: "wallet_role_mule_transit_pattern",
                label: "Deposit-then-drain or transit-like activity suggests mule behavior.",
                scoreImpact: 45
              }
            ]
          }
        ],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const subject = result.graph.nodes.find((node) => node.address === "TMule111111111111111111111111111111111");
    expect(subject?.metadata.nodeIntelligence).toMatchObject({
      role: "mule_transit",
      label: "Mule / Transit",
      evidenceStrength: "behavior",
      source: "wallet_role_classifier",
      confidence: 45,
      signals: ["wallet_role_mule_transit_pattern"]
    });
  });
```

- [ ] **Step 3: Add a test that service nodes do not receive role intelligence**

Add this test:

```ts
  it("does not attach wallet role intelligence to service nodes", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: "TSubject111111111111111111111111111111",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        walletRoleProfiles: [
          {
            subjectAddress: "TService11111111111111111111111111111",
            primaryRole: "collector",
            evidenceStrength: "strong_behavior",
            roles: [
              {
                role: "collector",
                confidence: "high",
                score: 55,
                reasons: [
                  {
                    role: "collector",
                    code: "address_behavior_collector_like_wallet",
                    label: "Collector-like wallet.",
                    scoreImpact: 55
                  }
                ]
              }
            ],
            features: []
          }
        ],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [
          {
            exposureScore: 10,
            topServiceCounterparties: [
              {
                address: "TService11111111111111111111111111111",
                category: "exchange",
                identity: "Known Exchange",
                volumeRaw: "1000000",
                txCount: 1
              }
            ],
            topMergedServiceFlows: []
          }
        ],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const serviceNode = result.graph.nodes.find((node) => node.address === "TService11111111111111111111111111111");
    expect(serviceNode?.kind).toBe("service");
    expect(serviceNode?.metadata.nodeIntelligence).toBeUndefined();
  });
```

- [ ] **Step 4: Run the focused graph tests and verify they fail**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts
```

Expected: FAIL because `metadata.nodeIntelligence` is not projected yet.

- [ ] **Step 5: Commit the failing projection tests**

Run:

```bash
git add tests/admin/forensicsGraph.test.ts
git commit -m "test: cover admin node intelligence projection"
```

---

### Task 2: Add Admin Node Intelligence Types And Projection Helpers

**Files:**
- Modify: `src/admin/forensicsGraph.ts`

- [ ] **Step 1: Add exported node intelligence types**

In `src/admin/forensicsGraph.ts`, after `AdminForensicsNodeDisplayKind`, add:

```ts
export type AdminNodeIntelligenceRole =
  | "drainer"
  | "victim"
  | "mule_transit"
  | "collector";

export type AdminNodeIntelligenceEvidenceStrength =
  | "hard"
  | "behavior"
  | "context";

export type AdminNodeIntelligence = {
  role: AdminNodeIntelligenceRole;
  label: string;
  evidenceStrength: AdminNodeIntelligenceEvidenceStrength;
  source: string;
  confidence: number | null;
  explanation: string;
  signals: string[];
};
```

- [ ] **Step 2: Add role mapping helpers**

In `src/admin/forensicsGraph.ts`, near the existing scalar helper functions, add:

```ts
function nodeIntelligenceRoleLabel(role: AdminNodeIntelligenceRole): string {
  const labels: Record<AdminNodeIntelligenceRole, string> = {
    drainer: "Drainer",
    victim: "Victim",
    mule_transit: "Mule / Transit",
    collector: "Collector"
  };
  return labels[role];
}

function nodeIntelligenceEvidenceStrength(value: unknown): AdminNodeIntelligenceEvidenceStrength {
  if (value === "exact") return "hard";
  if (value === "strong_behavior") return "behavior";
  return "context";
}

function nodeIntelligenceRoleFromWalletRole(value: unknown): AdminNodeIntelligenceRole | null {
  if (value === "drainer_spender") return "drainer";
  if (value === "victim") return "victim";
  if (value === "mule") return "mule_transit";
  if (value === "collector") return "collector";
  return null;
}

function confidenceFromWalletRoleProfile(profile: Record<string, unknown>): number | null {
  const roles = recordArrayField(profile, "roles");
  const scores = roles
    .map((role) => numberField(role, "score"))
    .filter((score): score is number => score !== null);
  if (scores.length === 0) return null;
  return Math.max(...scores);
}

function explanationFromWalletRoleProfile(profile: Record<string, unknown>): string {
  const features = recordArrayField(profile, "features");
  const featureLabel = features
    .map((feature) => stringField(feature, "label"))
    .find((label): label is string => Boolean(label));
  if (featureLabel) return featureLabel;

  const roles = recordArrayField(profile, "roles");
  for (const role of roles) {
    const reasons = recordArrayField(role, "reasons");
    const reasonLabel = reasons
      .map((reason) => stringField(reason, "label"))
      .find((label): label is string => Boolean(label));
    if (reasonLabel) return reasonLabel;
  }

  return "Backend wallet role classifier emitted this node role.";
}

function signalsFromWalletRoleProfile(profile: Record<string, unknown>): string[] {
  const features = recordArrayField(profile, "features");
  const featureCodes = features
    .map((feature) => stringField(feature, "code"))
    .filter((code): code is string => Boolean(code));

  const roleReasonCodes = recordArrayField(profile, "roles").flatMap((role) =>
    recordArrayField(role, "reasons")
      .map((reason) => stringField(reason, "code"))
      .filter((code): code is string => Boolean(code))
  );

  return Array.from(new Set([...featureCodes, ...roleReasonCodes]));
}
```

- [ ] **Step 3: Add the profile conversion helper**

Below the helpers from Step 2, add:

```ts
function nodeIntelligenceFromWalletRoleProfile(profile: Record<string, unknown>): AdminNodeIntelligence | null {
  const role = nodeIntelligenceRoleFromWalletRole(stringField(profile, "primaryRole"));
  if (!role) return null;

  const evidenceStrength = nodeIntelligenceEvidenceStrength(profile["evidenceStrength"]);
  if ((role === "drainer" || role === "victim") && evidenceStrength !== "hard") return null;

  return {
    role,
    label: nodeIntelligenceRoleLabel(role),
    evidenceStrength,
    source: "wallet_role_classifier",
    confidence: confidenceFromWalletRoleProfile(profile),
    explanation: explanationFromWalletRoleProfile(profile),
    signals: signalsFromWalletRoleProfile(profile)
  };
}
```

- [ ] **Step 4: Add node attachment helper**

Add:

```ts
function attachNodeIntelligence(
  nodesById: Map<string, AdminForensicsNode>,
  walletRoleProfiles: Record<string, unknown>[]
): void {
  for (const profile of walletRoleProfiles) {
    const address = stringField(profile, "subjectAddress");
    if (!address) continue;

    const node = nodesById.get(nodeId(address));
    if (!node) continue;
    if (!["subject", "wallet", "label"].includes(node.kind)) continue;

    const intelligence = nodeIntelligenceFromWalletRoleProfile(profile);
    if (!intelligence) continue;

    node.metadata = {
      ...node.metadata,
      nodeIntelligence: intelligence
    };
  }
}
```

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the helper types**

Run:

```bash
git add src/admin/forensicsGraph.ts
git commit -m "feat: add admin node intelligence helpers"
```

---

### Task 3: Project Wallet Role Profiles Onto Admin Graph Nodes

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Read wallet role profiles in address-deep projection**

In `projectAddressDeepJob`, near the existing profile arrays:

```ts
const counterpartyProfiles = recordArrayField(result, "counterpartyRiskProfiles");
const directCounterpartyProfiles = recordArrayField(result, "directCounterpartyInteractionProfiles");
const inboundProfiles = recordArrayField(result, "inboundProvenanceProfiles");
const boundaryProfiles = recordArrayField(result, "boundaryExposureProfiles");
const serviceProfiles = recordArrayField(result, "serviceExposureProfiles");
```

Add:

```ts
const walletRoleProfiles = recordArrayField(result, "walletRoleProfiles");
```

- [ ] **Step 2: Attach role metadata before graph finalization**

In `projectAddressDeepJob`, after nodes and service semantics have been created but before returning `buildGraph(...)`, add:

```ts
attachNodeIntelligence(nodesById, walletRoleProfiles);
```

Place it late enough that service exposure projection can still turn known service addresses into `service` nodes. The helper will skip non-wallet node kinds.

- [ ] **Step 3: Add wallet role profile support to incoming-deposit projection if result data exists**

Find the incoming-deposit projection function in `src/admin/forensicsGraph.ts`. If it already reads `result["walletRoleProfiles"]` or sender role data, add:

```ts
const walletRoleProfiles = recordArrayField(result, "walletRoleProfiles");
attachNodeIntelligence(nodesById, walletRoleProfiles);
```

If incoming-deposit result does not expose `walletRoleProfiles`, do not invent roles in this task. The first release then supports only job kinds whose result JSON already contains explicit wallet role profiles.

- [ ] **Step 4: Run the focused tests**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts
```

Expected: PASS for the new node-intelligence tests and existing graph projection tests.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit graph projection**

Run:

```bash
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat: project admin node intelligence roles"
```

---

### Task 4: Render Node Intelligence In The Selected-Node Panel

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Add selected-node role panel helper assertions**

In `tests/admin/adminServer.test.ts`, in the admin console shell test, add:

```ts
expect(html).toContain("function nodeIntelligenceBlock");
expect(html).toContain("Node role");
expect(html).toContain("Behavior marker");
expect(html).toContain("This marker is investigation context, not final risk proof by itself.");
```

- [ ] **Step 2: Run the admin server test and verify it fails**

Run:

```bash
npm test -- tests/admin/adminServer.test.ts
```

Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Add browser-side node intelligence helpers**

In `src/admin/adminConsole.ts`, near the existing detail helper functions before `walletDetailBlock`, add:

```js
    function nodeIntelligenceEvidenceLabel(value) {
      if (value === "hard") return "Hard evidence";
      if (value === "behavior") return "Behavior marker";
      if (value === "context") return "Context marker";
      return "n/a";
    }
    function nodeIntelligenceBlock(node) {
      const intelligence = node?.metadata?.nodeIntelligence;
      if (!intelligence || typeof intelligence !== "object") {
        return metric("Node role", "No role marker", "wide");
      }

      const evidence = nodeIntelligenceEvidenceLabel(intelligence.evidenceStrength);
      const confidence = intelligence.confidence === null || intelligence.confidence === undefined
        ? "n/a"
        : String(intelligence.confidence);
      const safetyNote = intelligence.evidenceStrength === "hard"
        ? ""
        : " This marker is investigation context, not final risk proof by itself.";

      return metricHtml("Node role", typeChip(intelligence.label || intelligence.role || "Role", "wallet"), "wide") +
        metric("Evidence", evidence + " - confidence " + confidence, "wide") +
        metric("Role source", intelligence.source || "unknown", "wide") +
        metric("Why", (intelligence.explanation || "No explanation stored.") + safetyNote, "wide") +
        listMetric("Role signals", asArray(intelligence.signals), "No source signals stored.");
    }
```

- [ ] **Step 4: Insert the role block into `walletDetailBlock`**

In `walletDetailBlock`, after:

```js
metricHtml("Selected", typeChip(type.label, type.cls)) +
```

add:

```js
nodeIntelligenceBlock(node) +
```

The beginning of the return should become:

```js
      return '<div class="metric-grid">' +
        metricHtml("Selected", typeChip(type.label, type.cls)) +
        nodeIntelligenceBlock(node) +
        metricHtml("Address", addressDetailLink(nodeAddress(node) || node.id), "wide") +
```

- [ ] **Step 5: Confirm graph SVG rendering is unchanged**

Search the file:

```bash
rg -n "nodeIntelligence|Role marks|node-role|nodeRole|image class" src/admin/adminConsole.ts
```

Expected:

- `nodeIntelligence` appears only in selected-node detail helper code.
- There is no `Role marks` toggle.
- There is no SVG `<image>` role rendering.
- There is no `node-role` class.

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
npm test -- tests/admin/adminServer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit panel rendering**

Run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminServer.test.ts
git commit -m "feat: show node intelligence in admin details"
```

---

### Task 5: Add A No-Icon Regression Guard

**Files:**
- Modify: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Add a guard test that role icons are not in first release**

Add this test to `tests/admin/adminServer.test.ts`:

```ts
  it("does not render node role icons in the first node intelligence release", () => {
    const html = adminConsoleHtml();

    expect(html).not.toContain("Role marks");
    expect(html).not.toContain("node-role");
    expect(html).not.toContain("nodeRoleMarkSvg");
    expect(html).not.toContain("/admin/assets/node-intelligence");
  });
```

If `adminConsoleHtml` is not already imported in that test file, add:

```ts
import { adminConsoleHtml } from "../../src/admin/adminConsole";
```

- [ ] **Step 2: Run the guard test**

Run:

```bash
npm test -- tests/admin/adminServer.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit the regression guard**

Run:

```bash
git add tests/admin/adminServer.test.ts
git commit -m "test: guard node intelligence icon scope"
```

---

### Task 6: Manual QA On Real Admin Jobs

**Files:**
- No source edits expected.

- [ ] **Step 1: Start the bot/admin server**

Run:

```bash
npm run dev
```

Expected log lines:

```text
admin_dashboard_started
bot_started
```

- [ ] **Step 2: Open the admin console**

Open:

```text
http://127.0.0.1:8787/admin/forensics
```

- [ ] **Step 3: Verify unchanged graph visuals**

Open one job of each kind if available:

- `address_fast_check`
- `address_deep_check`
- `where_is_money_check`
- `incoming_deposit_check`

Expected:

- graph layout looks the same as before this feature;
- no new icon appears inside nodes;
- no small top-right badge appears;
- no new role toggle appears.

- [ ] **Step 4: Verify selected-node role details**

Select wallet nodes.

Expected:

- nodes without backend role data show `Node role: No role marker`;
- nodes with `metadata.nodeIntelligence` show role, evidence, source, explanation, and signals;
- behavior/context roles include the warning: `This marker is investigation context, not final risk proof by itself.`

- [ ] **Step 5: Confirm existing details still work**

Select:

- a service node;
- a bundle node;
- a trace stop node;
- an edge.

Expected:

- service, bundle, stop, and transfer detail cards still render;
- no role marker is shown for bundle/stop detail screens;
- transfer detail card is unchanged.

---

### Task 7: Final Verification And Landing Prep

**Files:**
- No source edits unless verification exposes a bug.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminServer.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Review final diff**

Run:

```bash
git diff --stat HEAD
git diff -- src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminServer.test.ts
```

Expected:

- role projection changes are in `forensicsGraph.ts`;
- selected-node panel rendering is in `adminConsole.ts`;
- tests cover projection and first-release icon scope;
- no scoring/traversal files changed;
- no image asset serving added.

- [ ] **Step 4: Commit any missed verification fixes**

If verification required a fix, stage only the touched files and commit:

```bash
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminServer.test.ts
git commit -m "fix: stabilize admin node intelligence details"
```

If there were no missed fixes, skip this step.

---

## Plan Self-Review

Spec coverage:

- Backend-owned role projection: Tasks 2 and 3.
- First release selected-node panel only: Task 4.
- No frontend graph-shape inference: Tasks 2-4 avoid graph shape and Task 5 guards the scope.
- No graph icons in first release: Task 5 and manual QA.
- Drainer, victim, mule/transit, collector roles: Tasks 1-3.
- Behavior/context wording: Task 4.
- No scoring or traversal changes: File structure and Task 7 diff check.

No unresolved implementation gaps remain. The only intentionally skipped area is second-release icon rendering, which is explicitly outside this plan.
