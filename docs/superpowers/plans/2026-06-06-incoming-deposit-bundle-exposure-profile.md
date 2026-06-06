# Incoming Deposit Bundle Exposure Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add honest incoming-deposit scoring that separates fresh balance-forming source risk from historical sender wallet exposure, while still producing one final score and one decision.

**Architecture:** Keep the shared wallet scorer unchanged for wallet scope. Add an incoming-deposit exposure profile module, wire its output into `buildIncomingDepositReport`, and apply incoming-specific floors/background score inside `calculateUnifiedIncomingDepositRisk`. Admin graph/reporting should expose the fresh-source and background-context breakdown without claiming historical HTX/Huobi as the proven source of a checked deposit.

**Tech Stack:** TypeScript, Vitest, existing TRON USDT forensic modules, PostgreSQL-backed job reports, admin graph projection.

---

## Source Spec

Implement this spec:

```text
docs/superpowers/specs/2026-06-06-incoming-deposit-bundle-exposure-profile-design.md
```

Related previous spec:

```text
docs/superpowers/specs/2026-06-06-balance-aware-incoming-provenance-design.md
```

## Scope Check

This plan is one subsystem: incoming deposit scoring/reporting. It must not refactor wallet checks or deep research. It may use existing Where Is Money outputs and the unified scorer wrapper for incoming deposits.

## Current Dirty Worktree Warning

Before implementation, run:

```powershell
git status --short
```

Expected: there may be unrelated dirty files, including admin/runtime/config/test files. Do not stage or revert unrelated changes. Each task must stage only files listed in that task.

## File Structure

Create:

```text
src/forensics/incomingDepositExposureProfile.ts
tests/forensics/incomingDepositExposureProfile.test.ts
```

Modify:

```text
src/types.ts
src/forensics/incomingDepositJob.ts
src/risk/unifiedIncomingDepositRisk.ts
src/risk/unifiedWalletRisk.ts
src/admin/forensicsGraph.ts
tests/forensics/incomingDepositJob.test.ts
tests/risk/unifiedWalletRisk.test.ts
tests/admin/forensicsGraph.test.ts
```

Responsibilities:

- `incomingDepositExposureProfile.ts`: pure functions for fresh bundle exposure and sender wallet exposure profile.
- `types.ts`: report-level data shapes persisted in `result_json`.
- `incomingDepositJob.ts`: gather sender edges, call profile builders, attach fields to report, pass exposure inputs to incoming unified scoring.
- `unifiedIncomingDepositRisk.ts`: apply incoming-only fresh bundle floors, corridor floors, additive background score, and dampeners.
- `unifiedWalletRisk.ts`: extend reason source union so incoming-specific anchors are typed.
- `forensicsGraph.ts`: project the new breakdown into admin graph metadata/weights/limitations.
- Tests: protect exact-source vs historical-context distinction and final score behavior.

---

### Task 1: Add Incoming Exposure Types

**Files:**
- Modify: `src/types.ts`
- Test: `tests/forensics/incomingDepositExposureProfile.test.ts`

- [ ] **Step 1: Add failing type-level test scaffold**

Create `tests/forensics/incomingDepositExposureProfile.test.ts` with this initial content:

```ts
import { describe, expect, it } from "vitest";
import type {
  IncomingFreshBundleExposure,
  IncomingWalletExposureProfile
} from "../../src/types";

describe("incoming deposit exposure profile types", () => {
  it("supports persisted fresh source and wallet background breakdowns", () => {
    const fresh: IncomingFreshBundleExposure = {
      targetAmountRaw: "100000000000",
      htxHuobiShare: 0.8,
      cleanCexShare: 0.1,
      bridgeRouterDexShare: 0,
      unknownContractShare: 0,
      riskyLabelShare: 0,
      unknownShare: 0.1,
      dominantFreshSource: "htx_huobi",
      reasons: ["HTX/Huobi materially funds the checked deposit."]
    };

    const profile: IncomingWalletExposureProfile = {
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-06-04T12:58:54.000Z",
      transferEventsScanned: 50,
      incomingVolumeRaw: "500000000000",
      outgoingVolumeRaw: "450000000000",
      htxHuobiIncomingShare: 0.4,
      cleanCexIncomingShare: 0.2,
      bridgeRouterDexVolumeShare: 0.1,
      unknownContractVolumeShare: 0,
      unknownSourceShare: 0.3,
      inOutVelocityScore: 6,
      scoreContribution: 14,
      reasons: ["Historical HTX/Huobi exposure is material."],
      warnings: []
    };

    expect(fresh.dominantFreshSource).toBe("htx_huobi");
    expect(profile.scoreContribution).toBe(14);
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
npm test -- tests/forensics/incomingDepositExposureProfile.test.ts
```

Expected: FAIL because `IncomingFreshBundleExposure` and `IncomingWalletExposureProfile` are not exported from `src/types.ts`.

- [ ] **Step 3: Add report types**

In `src/types.ts`, add these types near the existing incoming deposit types:

```ts
export type IncomingExposureSourceKind =
  | "htx_huobi"
  | "clean_cex"
  | "bridge_router_dex"
  | "unknown_contract"
  | "risky_label"
  | "unknown";

export type IncomingFreshBundleExposure = {
  targetAmountRaw: string;
  htxHuobiShare: number;
  cleanCexShare: number;
  bridgeRouterDexShare: number;
  unknownContractShare: number;
  riskyLabelShare: number;
  unknownShare: number;
  dominantFreshSource: IncomingExposureSourceKind | null;
  reasons: string[];
};

export type IncomingWalletExposureProfile = {
  windowStart: string;
  windowEnd: string;
  transferEventsScanned: number;
  incomingVolumeRaw: string;
  outgoingVolumeRaw: string;
  htxHuobiIncomingShare: number;
  cleanCexIncomingShare: number;
  bridgeRouterDexVolumeShare: number;
  unknownContractVolumeShare: number;
  unknownSourceShare: number;
  inOutVelocityScore: number;
  scoreContribution: number;
  reasons: string[];
  warnings: string[];
};
```

Extend `IncomingDepositRiskReport`:

```ts
freshBundleExposure?: IncomingFreshBundleExposure;
walletExposureProfile?: IncomingWalletExposureProfile;
```

Extend `IncomingDepositUnifiedRiskSummary`:

```ts
freshBundleFloor?: number;
corridorFloor?: number;
backgroundScore?: number;
```

- [ ] **Step 4: Run type/profile test**

Run:

```powershell
npm test -- tests/forensics/incomingDepositExposureProfile.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit task**

Run:

```powershell
git add -- src/types.ts tests/forensics/incomingDepositExposureProfile.test.ts
git commit -m "Add incoming deposit exposure types"
```

---

### Task 2: Build Pure Exposure Profile Functions

**Files:**
- Create: `src/forensics/incomingDepositExposureProfile.ts`
- Modify: `tests/forensics/incomingDepositExposureProfile.test.ts`

- [ ] **Step 1: Add failing fresh bundle tests**

Append to `tests/forensics/incomingDepositExposureProfile.test.ts`:

```ts
import {
  buildIncomingFreshBundleExposure,
  buildIncomingWalletExposureProfile
} from "../../src/forensics/incomingDepositExposureProfile";
import type { ForensicRouteEdge, IncomingDepositOriginPath, ServiceClassification } from "../../src/types";

function originPath(overrides: Partial<IncomingDepositOriginPath>): IncomingDepositOriginPath {
  return {
    verdict: "ACCEPTABLE",
    score: 5,
    sourcePolicy: "unknown",
    stoppedReason: "no_previous_transfer",
    pathAddresses: ["TSender", "TReceiver"],
    txHashes: ["deposit-tx"],
    steps: [],
    amountCoverageRatio: 1,
    amountContinuity: "strong",
    proximityHops: 1,
    reasons: [],
    ...overrides
  };
}

describe("buildIncomingFreshBundleExposure", () => {
  it("counts only balanceShare as fresh source share", () => {
    const exposure = buildIncomingFreshBundleExposure({
      targetAmountRaw: "100000000000",
      originPaths: [
        originPath({
          stoppedReason: "htx_huobi_reached",
          sourcePolicy: "hard_decline",
          balanceShare: 0.8,
          reasons: ["fresh HTX/Huobi source"]
        }),
        originPath({
          stoppedReason: "clean_cex_reached",
          sourcePolicy: "clean",
          balanceShare: 0.2,
          reasons: ["fresh clean CEX source"]
        })
      ]
    });

    expect(exposure.htxHuobiShare).toBeCloseTo(0.8);
    expect(exposure.cleanCexShare).toBeCloseTo(0.2);
    expect(exposure.dominantFreshSource).toBe("htx_huobi");
  });

  it("does not convert historical context into fresh source share", () => {
    const exposure = buildIncomingFreshBundleExposure({
      targetAmountRaw: "100000000000",
      originPaths: [
        originPath({
          stoppedReason: "htx_huobi_reached",
          sourcePolicy: "hard_decline",
          balanceShare: 0,
          reasons: ["historical HTX/Huobi context"]
        }),
        originPath({
          stoppedReason: "clean_cex_reached",
          sourcePolicy: "clean",
          balanceShare: 0.19,
          reasons: ["fresh clean CEX source"]
        })
      ]
    });

    expect(exposure.htxHuobiShare).toBe(0);
    expect(exposure.cleanCexShare).toBeCloseTo(0.19);
    expect(exposure.dominantFreshSource).toBe("clean_cex");
  });
});
```

- [ ] **Step 2: Run tests and verify missing module failure**

Run:

```powershell
npm test -- tests/forensics/incomingDepositExposureProfile.test.ts
```

Expected: FAIL because `src/forensics/incomingDepositExposureProfile.ts` does not exist.

- [ ] **Step 3: Implement fresh bundle exposure**

Create `src/forensics/incomingDepositExposureProfile.ts`:

```ts
import type {
  ForensicRouteEdge,
  IncomingExposureSourceKind,
  IncomingFreshBundleExposure,
  IncomingDepositOriginPath,
  IncomingWalletExposureProfile,
  ServiceClassification
} from "../types";

function clampShare(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function addShare(current: number, value: number): number {
  return clampShare(current + clampShare(value));
}

function pathShare(path: IncomingDepositOriginPath): number {
  return clampShare(path.balanceShare ?? 0);
}

function sourceKindFromPath(path: IncomingDepositOriginPath): IncomingExposureSourceKind {
  if (path.stoppedReason === "htx_huobi_reached") return "htx_huobi";
  if (path.stoppedReason === "clean_cex_reached") return "clean_cex";
  if (path.stoppedReason === "bridge_router_dex_reached") return "bridge_router_dex";
  if (path.stoppedReason === "unknown_contract_reached") return "unknown_contract";
  if (path.stoppedReason === "risky_label_reached") return "risky_label";
  return "unknown";
}

function dominantSource(input: Omit<IncomingFreshBundleExposure, "targetAmountRaw" | "dominantFreshSource" | "reasons">): IncomingExposureSourceKind | null {
  const entries: Array<[IncomingExposureSourceKind, number]> = [
    ["htx_huobi", input.htxHuobiShare],
    ["clean_cex", input.cleanCexShare],
    ["bridge_router_dex", input.bridgeRouterDexShare],
    ["unknown_contract", input.unknownContractShare],
    ["risky_label", input.riskyLabelShare],
    ["unknown", input.unknownShare]
  ];
  const best = entries.sort((left, right) => right[1] - left[1])[0];
  return best && best[1] > 0 ? best[0] : null;
}

export function buildIncomingFreshBundleExposure(input: {
  targetAmountRaw: string;
  originPaths: IncomingDepositOriginPath[];
}): IncomingFreshBundleExposure {
  const shares = {
    htxHuobiShare: 0,
    cleanCexShare: 0,
    bridgeRouterDexShare: 0,
    unknownContractShare: 0,
    riskyLabelShare: 0,
    unknownShare: 0
  };

  for (const path of input.originPaths) {
    const share = pathShare(path);
    if (share <= 0) continue;
    const kind = sourceKindFromPath(path);
    if (kind === "htx_huobi") shares.htxHuobiShare = addShare(shares.htxHuobiShare, share);
    else if (kind === "clean_cex") shares.cleanCexShare = addShare(shares.cleanCexShare, share);
    else if (kind === "bridge_router_dex") shares.bridgeRouterDexShare = addShare(shares.bridgeRouterDexShare, share);
    else if (kind === "unknown_contract") shares.unknownContractShare = addShare(shares.unknownContractShare, share);
    else if (kind === "risky_label") shares.riskyLabelShare = addShare(shares.riskyLabelShare, share);
    else shares.unknownShare = addShare(shares.unknownShare, share);
  }

  const coveredShare = clampShare(
    shares.htxHuobiShare +
    shares.cleanCexShare +
    shares.bridgeRouterDexShare +
    shares.unknownContractShare +
    shares.riskyLabelShare +
    shares.unknownShare
  );
  if (coveredShare < 1) {
    shares.unknownShare = addShare(shares.unknownShare, 1 - coveredShare);
  }

  const dominantFreshSource = dominantSource(shares);
  return {
    targetAmountRaw: input.targetAmountRaw,
    ...shares,
    dominantFreshSource,
    reasons: dominantFreshSource
      ? [`Dominant fresh balance-forming source: ${dominantFreshSource}.`]
      : ["Fresh balance-forming source was not proven."]
  };
}
```

- [ ] **Step 4: Run fresh bundle tests**

Run:

```powershell
npm test -- tests/forensics/incomingDepositExposureProfile.test.ts
```

Expected: PASS for fresh bundle tests.

- [ ] **Step 5: Add failing wallet profile tests**

Append to `tests/forensics/incomingDepositExposureProfile.test.ts`:

```ts
function edge(overrides: Partial<ForensicRouteEdge>): ForensicRouteEdge {
  return {
    id: overrides.txHash ?? "tx",
    txHash: overrides.txHash ?? "tx",
    fromAddress: overrides.fromAddress ?? "TFunder",
    toAddress: overrides.toAddress ?? "TSender",
    amountRaw: overrides.amountRaw ?? "100000000",
    timestamp: overrides.timestamp ?? new Date("2026-06-04T10:00:00.000Z"),
    method: "transfer",
    edgeType: "normal_transfer",
    ...overrides
  };
}

const classifications = new Map<string, ServiceClassification | null>([
  ["THTX", { category: "cex", identity: "HTX 4", confidence: "high", evidence: ["metadata:HTX"], isBoundary: true }],
  ["TClean", { category: "cex", identity: "Binance", confidence: "high", evidence: ["metadata:Binance"], isBoundary: true }],
  ["TBridge", { category: "protocol", identity: "LayerZero bridge", confidence: "high", evidence: ["metadata:LayerZero"], isBoundary: true }],
  ["TUnknownContract", { category: "unknown_contract", identity: null, confidence: "medium", evidence: ["contract"], isBoundary: true }]
]);

describe("buildIncomingWalletExposureProfile", () => {
  it("scores historical HTX/Huobi exposure as background, not fresh source proof", async () => {
    const profile = await buildIncomingWalletExposureProfile({
      sender: "TSender",
      watchedWallet: "TWatched",
      windowStart: new Date("2026-06-01T00:00:00.000Z"),
      windowEnd: new Date("2026-06-04T12:58:54.000Z"),
      edges: [
        edge({ txHash: "htx-in", fromAddress: "THTX", toAddress: "TSender", amountRaw: "400000000000" }),
        edge({ txHash: "clean-in", fromAddress: "TClean", toAddress: "TSender", amountRaw: "100000000000" }),
        edge({ txHash: "sender-out", fromAddress: "TSender", toAddress: "TWatched", amountRaw: "100000000000" })
      ],
      getClassificationForAddress: async (address) => classifications.get(address) ?? null
    });

    expect(profile.htxHuobiIncomingShare).toBeCloseTo(0.8);
    expect(profile.cleanCexIncomingShare).toBeCloseTo(0.2);
    expect(profile.scoreContribution).toBeGreaterThanOrEqual(15);
    expect(profile.scoreContribution).toBeLessThanOrEqual(20);
    expect(profile.reasons.join(" ")).toContain("Historical HTX/Huobi");
  });
});
```

- [ ] **Step 6: Implement wallet exposure profile**

Append these exports to `src/forensics/incomingDepositExposureProfile.ts`:

```ts
function parseRaw(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number((numerator * 10_000n) / denominator) / 10_000;
}

function addRaw(left: bigint, right: bigint): bigint {
  return left + right;
}

function textForClassification(classification: ServiceClassification | null): string {
  return [
    classification?.category,
    classification?.identity,
    ...(classification?.evidence ?? [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function sourceKindFromClassification(classification: ServiceClassification | null): IncomingExposureSourceKind {
  const text = textForClassification(classification);
  if (text.includes("htx") || text.includes("huobi")) return "htx_huobi";
  if (text.includes("bridge") || text.includes("router") || text.includes("dex") || text.includes("swap") || text.includes("layerzero") || text.includes("oft")) {
    return "bridge_router_dex";
  }
  if (classification?.category === "unknown_contract") return "unknown_contract";
  if (classification?.category === "cex") return "clean_cex";
  return "unknown";
}

function backgroundScore(input: {
  htxShare: number;
  bridgeShare: number;
  unknownContractShare: number;
  unknownSourceShare: number;
  velocityScore: number;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (input.htxShare >= 0.5) {
    score += 18;
    reasons.push("Historical HTX/Huobi exposure is high.");
  } else if (input.htxShare >= 0.2) {
    score += 10;
    reasons.push("Historical HTX/Huobi exposure is material.");
  } else if (input.htxShare >= 0.05) {
    score += 5;
    reasons.push("Historical HTX/Huobi exposure is present.");
  }

  if (input.bridgeShare >= 0.2) {
    score += 6;
    reasons.push("Bridge/router/dex exposure is material.");
  }
  if (input.unknownContractShare >= 0.2) {
    score += 6;
    reasons.push("Unknown contract exposure is material.");
  }
  if (input.unknownSourceShare >= 0.5) {
    score += 5;
    reasons.push("Unknown source share is high.");
  }
  if (input.velocityScore > 0) {
    score += input.velocityScore;
    reasons.push("Short in-out activity increases background risk.");
  }

  return { score: Math.min(20, score), reasons };
}

function inOutVelocityScore(edges: ForensicRouteEdge[], sender: string): number {
  const incoming = edges
    .filter((edge) => edge.toAddress === sender)
    .map((edge) => edge.timestamp.getTime())
    .sort((left, right) => left - right);
  const outgoing = edges
    .filter((edge) => edge.fromAddress === sender)
    .map((edge) => edge.timestamp.getTime())
    .sort((left, right) => left - right);
  if (incoming.length === 0 || outgoing.length === 0) return 0;
  const hasFastTurnover = incoming.some((inTime) =>
    outgoing.some((outTime) => outTime > inTime && outTime - inTime <= 60 * 60 * 1000)
  );
  return hasFastTurnover ? 6 : 0;
}

export async function buildIncomingWalletExposureProfile(input: {
  sender: string;
  watchedWallet: string;
  windowStart: Date;
  windowEnd: Date;
  edges: ForensicRouteEdge[];
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
}): Promise<IncomingWalletExposureProfile> {
  let incomingVolumeRaw = 0n;
  let outgoingVolumeRaw = 0n;
  let htxIncomingRaw = 0n;
  let cleanCexIncomingRaw = 0n;
  let bridgeVolumeRaw = 0n;
  let unknownContractVolumeRaw = 0n;
  let unknownVolumeRaw = 0n;
  const warnings: string[] = [];

  const classificationCache = new Map<string, ServiceClassification | null>();
  const classify = async (address: string): Promise<ServiceClassification | null> => {
    if (classificationCache.has(address)) return classificationCache.get(address) ?? null;
    const classification = await input.getClassificationForAddress(address).catch((error) => {
      warnings.push(`classification_failed:${address}:${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    classificationCache.set(address, classification);
    return classification;
  };

  for (const edge of input.edges) {
    if (edge.fromAddress !== input.sender && edge.toAddress !== input.sender) continue;
    const amountRaw = parseRaw(edge.amountRaw);
    if (amountRaw <= 0n) continue;
    const isIncoming = edge.toAddress === input.sender;
    const counterparty = isIncoming ? edge.fromAddress : edge.toAddress;
    const kind = sourceKindFromClassification(await classify(counterparty));

    if (isIncoming) incomingVolumeRaw = addRaw(incomingVolumeRaw, amountRaw);
    else outgoingVolumeRaw = addRaw(outgoingVolumeRaw, amountRaw);

    if (isIncoming && kind === "htx_huobi") htxIncomingRaw = addRaw(htxIncomingRaw, amountRaw);
    if (isIncoming && kind === "clean_cex") cleanCexIncomingRaw = addRaw(cleanCexIncomingRaw, amountRaw);
    if (kind === "bridge_router_dex") bridgeVolumeRaw = addRaw(bridgeVolumeRaw, amountRaw);
    if (kind === "unknown_contract") unknownContractVolumeRaw = addRaw(unknownContractVolumeRaw, amountRaw);
    if (kind === "unknown") unknownVolumeRaw = addRaw(unknownVolumeRaw, amountRaw);
  }

  const totalVolumeRaw = incomingVolumeRaw + outgoingVolumeRaw;
  const velocityScore = inOutVelocityScore(input.edges, input.sender);
  const shares = {
    htxHuobiIncomingShare: ratio(htxIncomingRaw, incomingVolumeRaw),
    cleanCexIncomingShare: ratio(cleanCexIncomingRaw, incomingVolumeRaw),
    bridgeRouterDexVolumeShare: ratio(bridgeVolumeRaw, totalVolumeRaw),
    unknownContractVolumeShare: ratio(unknownContractVolumeRaw, totalVolumeRaw),
    unknownSourceShare: ratio(unknownVolumeRaw, totalVolumeRaw)
  };
  const scored = backgroundScore({
    htxShare: shares.htxHuobiIncomingShare,
    bridgeShare: shares.bridgeRouterDexVolumeShare,
    unknownContractShare: shares.unknownContractVolumeShare,
    unknownSourceShare: shares.unknownSourceShare,
    velocityScore
  });

  return {
    windowStart: input.windowStart.toISOString(),
    windowEnd: input.windowEnd.toISOString(),
    transferEventsScanned: input.edges.length,
    incomingVolumeRaw: incomingVolumeRaw.toString(),
    outgoingVolumeRaw: outgoingVolumeRaw.toString(),
    ...shares,
    inOutVelocityScore: velocityScore,
    scoreContribution: scored.score,
    reasons: scored.reasons,
    warnings
  };
}
```

- [ ] **Step 7: Run profile tests**

Run:

```powershell
npm test -- tests/forensics/incomingDepositExposureProfile.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS. If it fails from stale imports in the new test, remove only unused imports from `tests/forensics/incomingDepositExposureProfile.test.ts`.

- [ ] **Step 9: Commit task**

Run:

```powershell
git add -- src/forensics/incomingDepositExposureProfile.ts tests/forensics/incomingDepositExposureProfile.test.ts
git commit -m "Build incoming deposit exposure profile"
```

---

### Task 3: Wire Exposure Profiles Into Incoming Deposit Reports

**Files:**
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Add failing report test for attached exposure fields**

Add this test inside the `buildIncomingDepositReport` describe block in `tests/forensics/incomingDepositJob.test.ts`:

```ts
it("attaches fresh bundle and wallet exposure profile to incoming deposit reports", async () => {
  const htxAddress = "THTXProfile1111111111111111111111111";
  const result = await buildIncomingDepositReport({
    deps: {
      listIndexedUsdtTransfersForAddress: async (address) =>
        address === validProgressJson.sender
          ? [
              indexedTransfer({
                txHash: "htx-profile-funding",
                fromAddress: htxAddress,
                toAddress: validProgressJson.sender,
                amountRaw: validProgressJson.amountRaw,
                blockTimestamp: new Date(new Date(validProgressJson.timestamp).getTime() - 10 * 60_000)
              })
            ]
          : [],
      listRelatedTrc20Transfers: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
        address === htxAddress
          ? { category: "cex", identity: "HTX 4", confidence: "high", evidence: ["metadata:HTX"], isBoundary: true }
          : null,
      getContractIntelligenceProfile: async () => null,
      getTransaction: async () => ({}),
      getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
    },
    job: job(validProgressJson),
    depositTxHash,
    watchedWallet: validProgressJson.watchedWallet,
    sender: validProgressJson.sender,
    amountRaw: validProgressJson.amountRaw,
    timestamp: new Date(validProgressJson.timestamp)
  });

  expect(result.freshBundleExposure).toMatchObject({
    targetAmountRaw: validProgressJson.amountRaw,
    htxHuobiShare: 1,
    dominantFreshSource: "htx_huobi"
  });
  expect(result.walletExposureProfile).toMatchObject({
    transferEventsScanned: expect.any(Number),
    htxHuobiIncomingShare: 1
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
npm test -- tests/forensics/incomingDepositJob.test.ts
```

Expected: FAIL because `freshBundleExposure` and `walletExposureProfile` are not attached.

- [ ] **Step 3: Import profile builders**

In `src/forensics/incomingDepositJob.ts`, add:

```ts
import {
  buildIncomingFreshBundleExposure,
  buildIncomingWalletExposureProfile
} from "./incomingDepositExposureProfile";
```

- [ ] **Step 4: Build wallet profile before `incomingReportFromWhere`**

In `buildIncomingDepositReport`, before `const reportFromWhere = incomingReportFromWhere({ ... })`, add:

```ts
  const walletExposureProfile = await buildIncomingWalletExposureProfile({
    sender: input.sender,
    watchedWallet: input.watchedWallet,
    windowStart: minTimestamp,
    windowEnd: maxTimestamp,
    edges: senderEdges,
    getClassificationForAddress
  });
```

Then pass `walletExposureProfile` into `incomingReportFromWhere`:

```ts
    walletExposureProfile,
```

- [ ] **Step 5: Build fresh bundle exposure inside `incomingReportFromWhere`**

Change `incomingReportFromWhere` input type to accept:

```ts
  walletExposureProfile?: IncomingWalletExposureProfile;
```

Move the existing `originPaths` calculation above the `calculateUnifiedIncomingDepositRisk` call. Immediately after `originPaths` is built, add:

```ts
  const freshBundleExposure = buildIncomingFreshBundleExposure({
    targetAmountRaw: input.deposit.amountRaw,
    originPaths
  });
```

Then change the `calculateUnifiedIncomingDepositRisk` call inside `incomingReportFromWhere`:

```ts
    freshBundleExposure,
    walletExposureProfile: input.walletExposureProfile ?? null
```

Include both fields in the returned `IncomingDepositRiskReportBase`:

```ts
    freshBundleExposure,
    walletExposureProfile: input.walletExposureProfile ?? undefined,
```

- [ ] **Step 6: Run incoming deposit test**

Run:

```powershell
npm test -- tests/forensics/incomingDepositJob.test.ts
```

Expected: FAIL in TypeScript until `CalculateUnifiedIncomingDepositRiskInput` accepts the new fields. This failure is expected before Task 4.

- [ ] **Step 7: Do not commit yet**

Leave this task uncommitted until Task 4 makes tests pass, because this task intentionally creates a cross-file type failure.

---

### Task 4: Add Incoming-Specific Scoring Floors And Background Score

**Files:**
- Modify: `src/risk/unifiedIncomingDepositRisk.ts`
- Modify: `src/risk/unifiedWalletRisk.ts`
- Modify: `tests/risk/unifiedWalletRisk.test.ts`
- Finish commit with `src/forensics/incomingDepositJob.ts` from Task 3

- [ ] **Step 1: Add failing scoring tests**

Append to `describe("calculateUnifiedIncomingDepositRisk", ...)` in `tests/risk/unifiedWalletRisk.test.ts`:

```ts
  it("floors incoming deposit risk when HTX/Huobi materially funds the fresh bundle", () => {
    const result = calculateUnifiedIncomingDepositRisk({
      senderAddress: "TSender1111111111111111111111111111",
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash: "tx-fresh-htx",
      amountRaw: "100000000000",
      timestamp: new Date("2026-06-05T00:00:00.000Z"),
      fastSenderRisk: null,
      senderStablecoinState: null,
      whereReport: whereReport(18),
      freshBundleExposure: {
        targetAmountRaw: "100000000000",
        htxHuobiShare: 0.8,
        cleanCexShare: 0.1,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0,
        unknownShare: 0.1,
        dominantFreshSource: "htx_huobi",
        reasons: ["Dominant fresh balance-forming source: htx_huobi."]
      },
      walletExposureProfile: null
    });

    expect(result.finalScore).toBeGreaterThanOrEqual(85);
    expect(result.finalDecision).toBe("DECLINE");
    expect(result.scoreBreakdown.activeAnchor).toMatchObject({
      code: "incoming_fresh_htx_huobi_source",
      source: "incoming_exposure"
    });
  });

  it("keeps historical HTX/Huobi exposure as capped background when fresh HTX share is absent", () => {
    const result = calculateUnifiedIncomingDepositRisk({
      senderAddress: "TSender1111111111111111111111111111",
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash: "tx-historical-htx",
      amountRaw: "100000000000",
      timestamp: new Date("2026-06-05T00:00:00.000Z"),
      fastSenderRisk: null,
      senderStablecoinState: null,
      whereReport: whereReport(18),
      freshBundleExposure: {
        targetAmountRaw: "100000000000",
        htxHuobiShare: 0,
        cleanCexShare: 0.19,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0,
        unknownShare: 0.81,
        dominantFreshSource: "unknown",
        reasons: ["Fresh HTX/Huobi source was not proven."]
      },
      walletExposureProfile: {
        windowStart: "2026-06-01T00:00:00.000Z",
        windowEnd: "2026-06-05T00:00:00.000Z",
        transferEventsScanned: 50,
        incomingVolumeRaw: "500000000000",
        outgoingVolumeRaw: "450000000000",
        htxHuobiIncomingShare: 0.6,
        cleanCexIncomingShare: 0.2,
        bridgeRouterDexVolumeShare: 0,
        unknownContractVolumeShare: 0,
        unknownSourceShare: 0.2,
        inOutVelocityScore: 0,
        scoreContribution: 18,
        reasons: ["Historical HTX/Huobi exposure is high."],
        warnings: []
      }
    });

    expect(result.finalScore).toBeGreaterThan(18);
    expect(result.finalScore).toBeLessThan(60);
    expect(result.finalDecision).toBe("ACCEPTABLE");
    expect(result.scoreBreakdown.activeAnchor?.code).not.toBe("incoming_fresh_htx_huobi_source");
  });
```

- [ ] **Step 2: Run scoring tests and verify failure**

Run:

```powershell
npm test -- tests/risk/unifiedWalletRisk.test.ts
```

Expected: FAIL because input fields and reason source are not typed or used.

- [ ] **Step 3: Extend reason source union**

In `src/risk/unifiedWalletRisk.ts`, add `"incoming_exposure"` to `UnifiedWalletRiskReason["source"]`:

```ts
    | "coverage"
    | "incoming_exposure";
```

- [ ] **Step 4: Extend incoming scoring input**

In `src/risk/unifiedIncomingDepositRisk.ts`, import the new types:

```ts
  IncomingFreshBundleExposure,
  IncomingWalletExposureProfile,
```

Extend `CalculateUnifiedIncomingDepositRiskInput`:

```ts
  freshBundleExposure?: IncomingFreshBundleExposure | null;
  walletExposureProfile?: IncomingWalletExposureProfile | null;
```

- [ ] **Step 5: Implement incoming exposure scoring helpers**

In `src/risk/unifiedIncomingDepositRisk.ts`, add helpers above `calculateUnifiedIncomingDepositRisk`:

```ts
function incomingFreshBundleFloor(exposure: IncomingFreshBundleExposure | null | undefined): {
  score: number;
  code: string;
  message: string;
} | null {
  if (!exposure) return null;
  if (exposure.htxHuobiShare >= 0.7) {
    return {
      score: 85,
      code: "incoming_fresh_htx_huobi_source",
      message: "HTX/Huobi materially funds the fresh balance-forming bundle for this incoming deposit."
    };
  }
  if (exposure.htxHuobiShare >= 0.3) {
    return {
      score: 70,
      code: "incoming_fresh_htx_huobi_source",
      message: "HTX/Huobi funds a material share of the fresh balance-forming bundle for this incoming deposit."
    };
  }
  if (exposure.htxHuobiShare >= 0.1) {
    return {
      score: 55,
      code: "incoming_fresh_htx_huobi_context",
      message: "HTX/Huobi funds a minority share of the fresh balance-forming bundle for this incoming deposit."
    };
  }
  if (exposure.riskyLabelShare >= 0.1) {
    return {
      score: 85,
      code: "incoming_fresh_risky_label_source",
      message: "A hard-risk source materially funds the fresh balance-forming bundle for this incoming deposit."
    };
  }
  if (exposure.bridgeRouterDexShare >= 0.5) {
    return {
      score: 60,
      code: "incoming_fresh_bridge_router_dex_source",
      message: "Bridge/router/dex exposure dominates the fresh balance-forming bundle for this incoming deposit."
    };
  }
  if (exposure.unknownContractShare >= 0.5) {
    return {
      score: 45,
      code: "incoming_fresh_unknown_contract_source",
      message: "Unknown contract exposure dominates the fresh balance-forming bundle for this incoming deposit."
    };
  }
  return null;
}

function incomingCorridorFloor(exposure: IncomingFreshBundleExposure | null | undefined): {
  score: number;
  code: string;
  message: string;
} | null {
  if (!exposure) return null;
  if (exposure.htxHuobiShare > 0) {
    return {
      score: 40,
      code: "incoming_htx_huobi_corridor_context",
      message: "HTX/Huobi appears in the fresh corridor, but exact high-share deposit-source attribution was not proven."
    };
  }
  if (exposure.bridgeRouterDexShare > 0 || exposure.unknownContractShare > 0) {
    return {
      score: 35,
      code: "incoming_service_corridor_context",
      message: "Service or unknown-contract corridor exposure is present without hard source proof."
    };
  }
  return null;
}

function incomingBackgroundScore(profile: IncomingWalletExposureProfile | null | undefined): {
  score: number;
  code: string;
  message: string;
} | null {
  const score = Math.max(0, Math.min(20, Math.round(profile?.scoreContribution ?? 0)));
  if (score <= 0) return null;
  return {
    score,
    code: "incoming_wallet_exposure_profile",
    message: "Sender wallet historical exposure profile adds background risk without proving the checked deposit source."
  };
}
```

- [ ] **Step 6: Apply incoming overlay after base scorer**

Change `calculateUnifiedIncomingDepositRisk` to:

```ts
export function calculateUnifiedIncomingDepositRisk(
  input: CalculateUnifiedIncomingDepositRiskInput
): UnifiedForensicRiskResult {
  const base = calculateUnifiedForensicRisk({
    subject: {
      scope: "incoming_deposit",
      senderAddress: input.senderAddress,
      receiverAddress: input.receiverAddress,
      txHash: input.txHash,
      amountRaw: input.amountRaw,
      timestamp: input.timestamp
    },
    fastReport: fastRiskWithSenderBlacklist(
      input.fastSenderRisk,
      input.senderAddress,
      input.senderStablecoinState
    ),
    deepReport: input.deepReport,
    whereReport: input.whereReport
  });

  const freshFloor = incomingFreshBundleFloor(input.freshBundleExposure);
  const corridorFloor = incomingCorridorFloor(input.freshBundleExposure);
  const background = incomingBackgroundScore(input.walletExposureProfile);
  const overlayFloor = Math.max(freshFloor?.score ?? 0, corridorFloor?.score ?? 0);
  const additiveBackground = background?.score ?? 0;
  const finalScore = Math.max(base.finalScore, overlayFloor) + additiveBackground;
  const cappedFinalScore = Math.max(0, Math.min(100, Math.round(finalScore)));
  const activeOverlay = [freshFloor, corridorFloor, background]
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => right.score - left.score)[0] ?? null;
  const finalDecision = cappedFinalScore >= 60 ? "DECLINE" : base.finalDecision;

  return {
    ...base,
    finalScore: cappedFinalScore,
    finalLevel: cappedFinalScore >= 85 ? "CRITICAL" : cappedFinalScore >= 60 ? "HIGH" : cappedFinalScore >= 45 ? "MEDIUM" : "LOW",
    finalDecision,
    policyFloor: Math.max(base.policyFloor, overlayFloor),
    contextScore: Math.max(base.contextScore, additiveBackground),
    reasons: activeOverlay
      ? [
          ...base.reasons,
          {
            code: activeOverlay.code,
            message: activeOverlay.message,
            score: activeOverlay.score,
            source: "incoming_exposure"
          }
        ]
      : base.reasons,
    scoreBreakdown: {
      ...base.scoreBreakdown,
      contextScore: Math.max(base.scoreBreakdown.contextScore, additiveBackground),
      floors: {
        ...base.scoreBreakdown.floors,
        policy: Math.max(base.scoreBreakdown.floors.policy, overlayFloor)
      },
      activeAnchor: activeOverlay && activeOverlay.score >= (base.scoreBreakdown.activeAnchor?.score ?? 0)
        ? {
            code: activeOverlay.code,
            message: activeOverlay.message,
            score: activeOverlay.score,
            source: "incoming_exposure"
          }
        : base.scoreBreakdown.activeAnchor
    }
  };
}
```

If `RiskLevel` does not allow `"CRITICAL"` in this context, use the existing local level mapping function already used by wallet scorer and adjust the snippet to the actual union. Do not change wallet-score behavior.

- [ ] **Step 7: Extend incoming summary**

In `incomingUnifiedRiskSummary`, add:

```ts
    freshBundleFloor: result.reasons.find((reason) =>
      reason.code.startsWith("incoming_fresh_")
    )?.score ?? 0,
    corridorFloor: result.reasons.find((reason) =>
      reason.code.includes("_corridor_")
    )?.score ?? 0,
    backgroundScore: result.reasons.find((reason) =>
      reason.code === "incoming_wallet_exposure_profile"
    )?.score ?? 0,
```

- [ ] **Step 8: Run scoring and incoming tests**

Run:

```powershell
npm test -- tests/risk/unifiedWalletRisk.test.ts tests/forensics/incomingDepositJob.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit tasks 3 and 4 together**

Run:

```powershell
git add -- src/forensics/incomingDepositJob.ts src/risk/unifiedIncomingDepositRisk.ts src/risk/unifiedWalletRisk.ts tests/forensics/incomingDepositJob.test.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "Score incoming deposit exposure profiles"
```

---

### Task 5: Project Exposure Breakdown In Admin Graph

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add failing admin graph test**

Add this test near the existing incoming deposit graph tests in `tests/admin/forensicsGraph.test.ts`:

```ts
  it("projects incoming-deposit exposure profile weights", () => {
    const result = projectForensicJobGraph(job({
      kind: "incoming_deposit_check",
      subjectAddress: "TSender1111111111111111111111111111111",
      progressJson: {
        watchedWallet: "TReceiver111111111111111111111111111111",
        sender: "TSender1111111111111111111111111111111",
        depositTxHash: "deposit-tx",
        amountRaw: "100000000000",
        timestamp: "2026-06-04T12:58:54.000Z"
      },
      resultJson: {
        decision: "DECLINE",
        depositRiskScore: 85,
        freshBundleExposure: {
          targetAmountRaw: "100000000000",
          htxHuobiShare: 0.8,
          cleanCexShare: 0.1,
          bridgeRouterDexShare: 0,
          unknownContractShare: 0,
          riskyLabelShare: 0,
          unknownShare: 0.1,
          dominantFreshSource: "htx_huobi",
          reasons: ["Dominant fresh balance-forming source: htx_huobi."]
        },
        walletExposureProfile: {
          windowStart: "2026-06-01T00:00:00.000Z",
          windowEnd: "2026-06-04T12:58:54.000Z",
          transferEventsScanned: 50,
          incomingVolumeRaw: "500000000000",
          outgoingVolumeRaw: "450000000000",
          htxHuobiIncomingShare: 0.6,
          cleanCexIncomingShare: 0.2,
          bridgeRouterDexVolumeShare: 0,
          unknownContractVolumeShare: 0,
          unknownSourceShare: 0.2,
          inOutVelocityScore: 0,
          scoreContribution: 18,
          reasons: ["Historical HTX/Huobi exposure is high."],
          warnings: []
        },
        originPaths: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.weights).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "incoming_fresh_htx_huobi_share",
        value: 0.8
      }),
      expect.objectContaining({
        code: "incoming_wallet_htx_huobi_incoming_share",
        value: 0.6
      })
    ]));
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "incoming_exposure_context_not_source_proof"
      })
    ]));
  });
```

- [ ] **Step 2: Run graph test and verify failure**

Run:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts
```

Expected: FAIL because weights/limitations are not projected.

- [ ] **Step 3: Add graph projection**

In `src/admin/forensicsGraph.ts`, inside incoming deposit projection, after existing origin path/funding bundle projection, read:

```ts
const freshBundleExposure = objectField(job.resultJson, "freshBundleExposure");
const walletExposureProfile = objectField(job.resultJson, "walletExposureProfile");
```

Append weights:

```ts
if (freshBundleExposure) {
  weights.push(
    weight("incoming_fresh_htx_huobi_share", numberField(freshBundleExposure, "htxHuobiShare") ?? 0, {
      source: "incoming_fresh_bundle",
      label: "Fresh HTX/Huobi bundle share"
    }),
    weight("incoming_fresh_clean_cex_share", numberField(freshBundleExposure, "cleanCexShare") ?? 0, {
      source: "incoming_fresh_bundle",
      label: "Fresh clean CEX bundle share"
    })
  );
}

if (walletExposureProfile) {
  weights.push(
    weight("incoming_wallet_htx_huobi_incoming_share", numberField(walletExposureProfile, "htxHuobiIncomingShare") ?? 0, {
      source: "incoming_wallet_exposure_profile",
      label: "Historical sender HTX/Huobi incoming share"
    }),
    weight("incoming_wallet_background_score", numberField(walletExposureProfile, "scoreContribution") ?? 0, {
      source: "incoming_wallet_exposure_profile",
      label: "Sender exposure profile background score"
    })
  );
  limitations.push({
    code: "incoming_exposure_context_not_source_proof",
    message: "Wallet exposure profile is historical context and does not prove the checked deposit source.",
    severity: "info"
  });
}
```

Use the existing graph helpers in `forensicsGraph.ts` for numeric/object extraction and weight creation. Keep the exact weight codes from this step: `incoming_fresh_htx_huobi_share`, `incoming_fresh_clean_cex_share`, `incoming_wallet_htx_huobi_incoming_share`, and `incoming_wallet_background_score`.

- [ ] **Step 4: Run graph test**

Run:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit task**

Run:

```powershell
git add -- src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "Show incoming exposure profile in admin graph"
```

---

### Task 6: User-Facing Reasons And Alert Copy

**Files:**
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `tests/alerts/formatters.test.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Add failing reason test**

In `tests/forensics/incomingDepositJob.test.ts`, add:

```ts
it("explains historical HTX/Huobi exposure without claiming deposit-source proof", async () => {
  const result = await buildIncomingDepositReport({
    deps: {
      listIndexedUsdtTransfersForAddress: async (address) =>
        address === validProgressJson.sender
          ? [
              indexedTransfer({
                txHash: "old-htx-context",
                fromAddress: "THTXContext11111111111111111111111",
                toAddress: validProgressJson.sender,
                amountRaw: "400000000000",
                blockTimestamp: new Date(new Date(validProgressJson.timestamp).getTime() - 21 * 24 * 60 * 60 * 1000)
              }),
              indexedTransfer({
                txHash: "fresh-clean",
                fromAddress: "TCleanContext111111111111111111111",
                toAddress: validProgressJson.sender,
                amountRaw: validProgressJson.amountRaw,
                blockTimestamp: new Date(new Date(validProgressJson.timestamp).getTime() - 10 * 60_000)
              })
            ]
          : [],
      listRelatedTrc20Transfers: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address): Promise<ServiceClassification | null> => {
        if (address.startsWith("THTX")) return { category: "cex", identity: "HTX 4", confidence: "high", evidence: ["metadata:HTX"], isBoundary: true };
        if (address.startsWith("TClean")) return { category: "cex", identity: "Binance", confidence: "high", evidence: ["metadata:Binance"], isBoundary: true };
        return null;
      },
      getContractIntelligenceProfile: async () => null,
      getTransaction: async () => ({}),
      getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
    },
    job: job(validProgressJson),
    depositTxHash,
    watchedWallet: validProgressJson.watchedWallet,
    sender: validProgressJson.sender,
    amountRaw: validProgressJson.amountRaw,
    timestamp: new Date(validProgressJson.timestamp)
  });

  const text = result.reasons.join(" ");
  expect(text).toContain("Historical HTX/Huobi");
  expect(text).not.toContain("100% of selected provenance target");
});
```

- [ ] **Step 2: Run test and verify failure if reason is missing**

Run:

```powershell
npm test -- tests/forensics/incomingDepositJob.test.ts
```

Expected: FAIL until reason assembly includes wallet exposure profile reasons.

- [ ] **Step 3: Add reason assembly**

In `src/forensics/incomingDepositJob.ts`, extend the final returned `reasons` array:

```ts
    reasons: incomingReasonsFromCoverage({
      reasons: uniqueStrings([
        ...report.reasons,
        ...freshBundleExposure.reasons,
        ...walletExposureProfile.reasons
      ]),
      cleanSourceCoverageRatio: report.fundingCoverage.cleanSourceCoverageRatio
    }),
```

If this creates duplicated generic clean-source messages, keep `walletExposureProfile.reasons` and only include `freshBundleExposure.reasons` when its dominant source is not `"clean_cex"`.

- [ ] **Step 4: Run alert formatter tests**

Run:

```powershell
npm test -- tests/alerts/formatters.test.ts tests/forensics/incomingDepositJob.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit task**

Run:

```powershell
git add -- src/forensics/incomingDepositJob.ts tests/alerts/formatters.test.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "Explain incoming exposure profile context"
```

---

### Task 7: Full Test And Typecheck Sweep

**Files:**
- No source changes expected.

- [ ] **Step 1: Run targeted test suite**

Run:

```powershell
npm test -- tests/forensics/incomingDepositExposureProfile.test.ts tests/forensics/incomingDepositJob.test.ts tests/risk/unifiedWalletRisk.test.ts tests/admin/forensicsGraph.test.ts tests/alerts/formatters.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Review staged/untracked state**

Run:

```powershell
git status --short
```

Expected: only pre-existing unrelated dirty files remain, or no dirty files if implementation worktrees are clean. Do not stage unrelated files.

---

### Task 8: Real Job Comparison

**Files:**
- No committed source changes required.

- [ ] **Step 1: Run bounded live rerun for primary case**

Run a bounded live rerun for:

```text
b4603c390d3b0f08f9a604b26dc31d08e64aeeacc5a1560410bb5bbf030aa39c
```

Run a read-only one-off script or a temporary local script that calls `buildIncomingDepositReport` for the saved job input and prints the new report without calling `completeForensicCheckJob`. The runtime options must be:

```text
listRelatedTrc20Transfers: enabled
listTrc20ApprovalChanges: returns []
analyzeContractLlmCaseFiles: undefined
crossChainStage2Enabled: false
crossChainContinuationProviders: []
evmEvidenceProvider: undefined
```

Expected:

- result must not claim stale HTX/Huobi 100% source unless fresh bundle share proves it;
- `freshBundleExposure.htxHuobiShare` must be shown explicitly;
- `walletExposureProfile.htxHuobiIncomingShare` must be shown explicitly;
- score must be higher than the previous too-soft `18 LOW` if HTX/Huobi exposure is material in fresh/corridor/background profile.

- [ ] **Step 2: Run bounded live rerun for controls**

Run the same comparison for:

```text
53b742b18613bc072093d68ff6d95d0209680368cb40a2df8455f2bc9ac27c72
e3a049d52d62a7c2bca4bce928051950e2919b958716cd94f3696a28f55b27c9
```

Expected:

- `53b742...` remains `ACCEPTABLE` unless fresh risky source is found;
- `e3a049...` does not decline only from unresolved approval-review context when approval enrichment is off;
- both reports include fresh and background exposure fields.

- [ ] **Step 3: Pick two more file cases**

Use `C:\Users\User\OneDrive\Desktop\оценки.txt` and select:

```text
one low/acceptable incoming deposit
one high/decline or bridge/contract-boundary incoming deposit
```

Expected comparison table columns:

```text
tx
saved score/decision
new score/decision
fresh HTX share
fresh clean CEX share
fresh bridge/router/dex share
historical HTX share
wallet exposure contribution
main reason
```

- [ ] **Step 4: Document comparison in project walkthrough**

Append the comparison to:

```text
docs/project-walkthrough/04-unified-wallet-risk-scoring-v2.md
```

Use this heading:

```markdown
## Incoming Deposit Bundle Exposure Profile: Real Job Comparison
```

Commit only if the user wants the comparison saved:

```powershell
git add -- docs/project-walkthrough/04-unified-wallet-risk-scoring-v2.md
git commit -m "Document incoming exposure profile comparison"
```

---

## Final Acceptance Criteria

- `IncomingDepositRiskReport` persists `freshBundleExposure` and `walletExposureProfile`.
- Fresh HTX/Huobi bundle share can raise the incoming deposit score to `HIGH` or `CRITICAL`.
- Historical HTX/Huobi exposure adds capped background score and cannot claim exact deposit-source proof.
- The report explanation distinguishes:
  - fresh source;
  - corridor context;
  - historical wallet exposure.
- Admin graph exposes fresh and historical exposure metrics.
- `b4603...` no longer says stale HTX/Huobi was 100% source unless fresh bundle proves it.
- `b4603...` does not collapse to low risk if material HTX/Huobi exposure is present as fresh/corridor/background risk.
- Full `npm test` and `npm run typecheck` pass.

## Self-Review

- Spec coverage: fresh bundle risk, corridor risk, wallet exposure profile, one final score, admin graph, and real-job comparison are covered.
- Placeholder scan: no open implementation markers or open implementation blanks are present.
- Type consistency: `IncomingFreshBundleExposure`, `IncomingWalletExposureProfile`, `freshBundleExposure`, and `walletExposureProfile` are consistently named across tasks.
- Scope check: the plan modifies incoming deposit scoring and reporting only. Wallet-level scoring remains unchanged except for adding the typed reason source `"incoming_exposure"`.
