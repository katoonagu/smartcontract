# Operational Laundering Deep Boundary Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect and explain high-risk operational laundering patterns where TRON USDT flows reach bridges, DEX/router/swap infrastructure, CEX/hot-wallets such as HTX/Huobi, or unknown contracts within 1-4 hops, while keeping exact taint/blacklist/scam claims separate.

**Architecture:** Keep `taintScore` reserved for exact evidence: USDT blacklist, internal scam/phishing/stolen labels, exact approval-drain provenance, and exact labeled paths. Add an operational boundary/terminal-liquidity layer that computes 30-day flow shares, top counterparties, and multi-hop paths to service boundaries. Feed that layer into `launderingPatternScore` and reports as `HIGH operational laundering pattern` without asserting the wallet is blacklisted or scam.

**Tech Stack:** Node.js, TypeScript, Vitest, local indexed TRON USDT transfers, existing `DeepAddressForensicReport`, `RiskReport`, Telegram HTML formatting.

---

## Target behavior

For a laundering-style wallet like `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe`, if the data shows large outgoing/incoming shares through bridge/DEX/router/CEX/HTX/Huobi/unknown-contract boundaries within 1-4 hops, the final report should say approximately:

```text
Risk: 70-85/100 HIGH
Taint evidence: 0/100
Operational laundering pattern: 70-85/100 HIGH
No direct blacklist/scam/approval-drain proof found.
Reason: large 30d flow share reaches bridge/DEX/CEX/HTX/Huobi boundaries within 1-4 hops with preserved amounts and fast transit.
```

It must not say:

```text
black wallet
blacklisted
scam wallet
confirmed scam
```

unless exact evidence exists.

---

## File structure

### Existing files to modify

- `src/types.ts`
  - Add 1-4 hop boundary depth support.
  - Add operational flow / top counterparty / terminal liquidity profile types.

- `src/forensics/serviceClassifier.ts`
  - Strengthen explicit HTX/Huobi detection as CEX/hot-wallet boundary context.

- `src/forensics/boundaryExposure.ts`
  - Keep current direct/two-hop in-memory behavior intact.
  - Do not overload it with async indexed traversal.
  - Accept `BoundaryExposureDepth = 1 | 2 | 3 | 4` after type expansion.

- `src/check/deepForensicCheck.ts`
  - Run multi-hop operational boundary search when indexed transfer lookup is available.
  - Use default deep/offline depth 4 for this layer.
  - Add raw evidence and observations for the operational boundary profile.
  - Include top incoming/outgoing 30-day flow profile.

- `src/risk/riskPolicy.ts`
  - Add operational-only evidence classes and caps.
  - Let operational boundary/terminal-liquidity signals raise `launderingPatternScore` to HIGH without raising `taintScore`.

- `src/risk/riskEngine.ts`
  - Add synthetic reason text for high operational flow patterns.

- `src/bot/createBot.ts`
  - Show separate `Taint evidence` and `Operational laundering pattern` lines.
  - Show 30-day top counterparties and boundary category breakdown.
  - Make HTX/Huobi explicitly visible as terminal liquidity / chain-loss boundary, not scam evidence.

- `scripts/forensicLocalBeamSearch.ts`
  - Keep current route/debug output.
  - Either add operational summary flags or add a new script below.

- `package.json`
  - Add a runnable offline operational report command.

### New files to create

- `src/forensics/multiHopBoundaryExposure.ts`
  - Async bounded search from subject to service boundaries up to 4 hops, inbound and outbound.

- `src/forensics/flowCounterpartyProfile.ts`
  - 30-day top incoming/outgoing counterparties, category shares, HTX/Huobi/CEX shares, bridge/DEX/router shares.

- `scripts/forensicOperationalReport.ts`
  - Local CLI report for a single address using indexed data:
    - depth 4
    - beam 8
    - max-addresses 60
    - min-preservation 0.7
    - 30-day flow breakdown

### Tests to create/modify

- `tests/forensics/serviceClassifier.test.ts`
- `tests/forensics/multiHopBoundaryExposure.test.ts`
- `tests/forensics/flowCounterpartyProfile.test.ts`
- `tests/check/deepForensicCheck.test.ts`
- `tests/risk/riskPolicy.test.ts`
- `tests/risk/riskEngine.test.ts`
- `tests/bot/createBot.test.ts`
- `tests/scripts/forensicOperationalReport.test.ts` or a CLI argument/unit test if script testing pattern exists

---

## Scoring principles

### Exact taint layer

`taintScore` may increase only from:

- `stablecoin_usdt_blacklisted`
- exact internal label on the subject: `scam`, `phishing`, `stolen_funds`, `risky_contract`, etc.
- exact approval-drain provenance
- exact labeled path evidence where the label is not merely a service boundary

### Operational laundering pattern layer

`launderingPatternScore` may increase from:

- large outgoing or incoming share reaching service boundaries within 1-4 hops
- bridge / bridge pool / DEX / router / swap adapter exposure
- CEX / hot-wallet exposure, especially HTX/Huobi
- unknown contract terminal boundary
- high amount preservation, especially `>= 0.7` and strong `>= 0.95`
- fast sequence timing: 1h, 6h, 24h
- fan-in/fan-out or deposit-then-drain behavior
- high 30-day outflow/inflow preservation

### Suggested cap logic

- No exact taint, strong operational pattern: cap at `85`, so it can be HIGH but not CRITICAL.
- Exact taint present: score may reach CRITICAL through taint layer.
- Boundary alone with tiny volume: LOW/MEDIUM only.
- Direct large bridge/CEX/DEX/HTX/Huobi exposure with high share: HIGH operational pattern allowed.

---

### Task 1: Expand types for 1-4 hop boundary and operational flow profiles

**Files:**
- Modify: `src/types.ts`
- Test: indirectly via tests in Tasks 2-4

- [ ] **Step 1: Update boundary depth type**

Change:

```ts
export type BoundaryExposureDepth = 1 | 2;
```

to:

```ts
export type BoundaryExposureDepth = 1 | 2 | 3 | 4;
```

- [ ] **Step 2: Add multi-hop path fields without breaking existing callers**

In `BoundaryExposureFlow`, keep existing `viaAddress` and add `viaAddresses`:

```ts
export type BoundaryExposureFlow = {
  direction: BoundaryExposureDirection;
  depth: BoundaryExposureDepth;
  boundaryAddress: string;
  boundaryCategory: ServiceCategory;
  boundaryIdentity: string | null;
  viaAddress: string | null;
  viaAddresses?: string[];
  subjectTxHash: string;
  boundaryTxHash: string;
  amountRaw: string;
  boundaryAmountRaw: string;
  amountPreservationRatio: number;
  firstTransferAt: string;
  lastTransferAt: string;
};
```

- [ ] **Step 3: Add top-counterparty and operational profile types**

Add after `BoundaryExposureProfile`:

```ts
export type FlowCounterpartyDirection = "incoming" | "outgoing";

export type FlowCounterpartySummary = {
  address: string;
  direction: FlowCounterpartyDirection;
  volumeRaw: string;
  txCount: number;
  volumeRatio: number;
  category: ServiceCategory | null;
  identity: string | null;
  isTerminalLiquidity: boolean;
  isHtxHuobi: boolean;
};

export type FlowCategoryBreakdown = {
  direction: FlowCounterpartyDirection;
  category: ServiceCategory;
  volumeRaw: string;
  txCount: number;
  volumeRatio: number;
};

export type OperationalFlowProfile = {
  subjectAddress: string;
  windowStart: string;
  windowEnd: string;
  incomingVolumeRaw: string;
  outgoingVolumeRaw: string;
  incomingTxCount: number;
  outgoingTxCount: number;
  inflowToOutflowRatio: number | null;
  topIncomingCounterparties: FlowCounterpartySummary[];
  topOutgoingCounterparties: FlowCounterpartySummary[];
  categoryBreakdown: FlowCategoryBreakdown[];
  terminalLiquidityIncomingRatio: number;
  terminalLiquidityOutgoingRatio: number;
  htxHuobiIncomingRatio: number;
  htxHuobiOutgoingRatio: number;
  bridgeDexRouterOutgoingRatio: number;
  unknownContractOutgoingRatio: number;
  operationalScore: number;
  features: RouteScoreFeature[];
};
```

- [ ] **Step 4: Attach profile to reports**

In `AddressExposureReport` and `DeepAddressForensicReport`, add:

```ts
operationalFlowProfiles?: OperationalFlowProfile[];
```

Expected compile failure before implementation: code references new types but report builders do not populate them.

- [ ] **Step 5: Run typecheck RED**

Run:

```bash
npm run typecheck
```

Expected: FAIL until report construction is updated.

---

### Task 2: Explicitly classify HTX/Huobi as terminal CEX boundary

**Files:**
- Modify: `src/forensics/serviceClassifier.ts`
- Test: `tests/forensics/serviceClassifier.test.ts`

- [ ] **Step 1: Add RED tests**

Append to `tests/forensics/serviceClassifier.test.ts`:

```ts
  it("classifies HTX/Huobi tags as CEX terminal liquidity boundaries", () => {
    const htx = classifyServiceAddress({
      address: "THTX11111111111111111111111111111111",
      metadata: {
        address: "THTX11111111111111111111111111111111",
        name: "HTX Hot Wallet",
        tag: "HTX",
        isContract: false,
        verified: true
      },
      contractProfile: null
    });

    const huobi = classifyServiceAddress({
      address: "THuobi11111111111111111111111111111",
      metadata: {
        address: "THuobi11111111111111111111111111111",
        name: "Huobi Deposit",
        tag: "Huobi",
        isContract: false,
        verified: true
      },
      contractProfile: null
    });

    expect(htx).toMatchObject({ category: "cex", identity: "HTX", isBoundary: true, confidence: "high" });
    expect(huobi).toMatchObject({ category: "cex", identity: "Huobi", isBoundary: true, confidence: "high" });
  });
```

- [ ] **Step 2: Run RED test**

```bash
npm test -- tests/forensics/serviceClassifier.test.ts
```

Expected: FAIL if HTX/Huobi are not explicitly normalized.

- [ ] **Step 3: Implement classifier update**

In `classifyServiceAddress`, before the generic `cex/exchange` block, add:

```ts
  if (hasAny(text, ["htx", "huobi"])) {
    evidence.push("tag:htx_huobi");
    const identity = hasAny(text, ["huobi"]) ? "Huobi" : "HTX";
    return classification(input, "cex", identityFor(input, identity), confidenceFor(input, true), evidence);
  }
```

- [ ] **Step 4: Run GREEN test**

```bash
npm test -- tests/forensics/serviceClassifier.test.ts
```

Expected: PASS.

---

### Task 3: Build 30-day flow counterparty profile

**Files:**
- Create: `src/forensics/flowCounterpartyProfile.ts`
- Create/modify: `tests/forensics/flowCounterpartyProfile.test.ts`

- [ ] **Step 1: Write RED tests**

Create `tests/forensics/flowCounterpartyProfile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildOperationalFlowProfile } from "../../src/forensics/flowCounterpartyProfile";
import type { ForensicRouteEdge, ServiceClassification } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const htx = "THTX11111111111111111111111111111111";
const bridge = "TBridge111111111111111111111111111111";
const dex = "TDex11111111111111111111111111111111";
const normal = "TNormal11111111111111111111111111111";

function edge(id: string, fromAddress: string, toAddress: string, amountRaw: string, timestamp: string): ForensicRouteEdge {
  return {
    id,
    fromAddress,
    toAddress,
    txHash: `${id}-tx`,
    amountRaw,
    timestamp: new Date(timestamp),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function service(category: ServiceClassification["category"], identity: string): ServiceClassification {
  return { category, identity, confidence: "high", evidence: [`tag:${identity}`], isBoundary: category !== "none" };
}

describe("buildOperationalFlowProfile", () => {
  it("summarizes top 30-day counterparties and terminal liquidity shares", () => {
    const profile = buildOperationalFlowProfile({
      subjectAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T23:59:59.999Z"),
      edges: [
        edge("in-1", normal, subject, "100000000000", "2026-05-10T10:00:00.000Z"),
        edge("out-htx", subject, htx, "40000000000", "2026-05-10T10:05:00.000Z"),
        edge("out-bridge", subject, bridge, "35000000000", "2026-05-10T10:10:00.000Z"),
        edge("out-dex", subject, dex, "15000000000", "2026-05-10T10:15:00.000Z"),
        edge("out-normal", subject, normal, "10000000000", "2026-05-10T10:20:00.000Z")
      ],
      classifications: new Map([
        [htx, service("cex", "HTX")],
        [bridge, service("bridge", "Allbridge")],
        [dex, service("dex", "SunSwap")],
        [normal, service("none", "normal wallet")]
      ])
    });

    expect(profile.incomingVolumeRaw).toBe("100000000000");
    expect(profile.outgoingVolumeRaw).toBe("100000000000");
    expect(profile.inflowToOutflowRatio).toBe(1);
    expect(profile.htxHuobiOutgoingRatio).toBe(0.4);
    expect(profile.terminalLiquidityOutgoingRatio).toBe(0.9);
    expect(profile.bridgeDexRouterOutgoingRatio).toBe(0.5);
    expect(profile.topOutgoingCounterparties[0]).toMatchObject({ address: htx, identity: "HTX", isHtxHuobi: true, volumeRatio: 0.4 });
    expect(profile.features.map((feature) => feature.code)).toEqual(expect.arrayContaining([
      "operational_flow_high_terminal_liquidity_outgoing",
      "operational_flow_htx_huobi_outgoing",
      "operational_flow_bridge_dex_router_outgoing"
    ]));
    expect(profile.operationalScore).toBeGreaterThanOrEqual(60);
  });
});
```

- [ ] **Step 2: Run RED test**

```bash
npm test -- tests/forensics/flowCounterpartyProfile.test.ts
```

Expected: FAIL with missing module/function.

- [ ] **Step 3: Implement `buildOperationalFlowProfile`**

Create `src/forensics/flowCounterpartyProfile.ts` with these exported helpers:

```ts
import type {
  FlowCategoryBreakdown,
  FlowCounterpartyDirection,
  FlowCounterpartySummary,
  ForensicRouteEdge,
  OperationalFlowProfile,
  RouteScoreFeature,
  ServiceCategory,
  ServiceClassification
} from "../types";
import { isServiceBoundary } from "./serviceClassifier";

export type BuildOperationalFlowProfileInput = {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  edges: ForensicRouteEdge[];
  classifications: Map<string, ServiceClassification | null | undefined>;
};

function amount(edge: ForensicRouteEdge): bigint {
  return /^\d+$/.test(edge.amountRaw) ? BigInt(edge.amountRaw) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

function preservation(left: bigint, right: bigint): number | null {
  if (left <= 0n || right <= 0n) return null;
  const min = left < right ? left : right;
  const max = left > right ? left : right;
  return ratio(min, max);
}

function isHtxHuobi(classification: ServiceClassification | null | undefined): boolean {
  const text = `${classification?.identity ?? ""} ${classification?.evidence?.join(" ") ?? ""}`.toLowerCase();
  return /\b(htx|huobi)\b/.test(text);
}

function isBridgeDexRouter(category: ServiceCategory | null | undefined): boolean {
  return category === "bridge" || category === "bridge_pool" || category === "dex" || category === "router" || category === "swap_adapter";
}

function isTerminalLiquidity(classification: ServiceClassification | null | undefined): boolean {
  if (!isServiceBoundary(classification)) return false;
  return classification.category === "cex" ||
    classification.category === "hot_wallet" ||
    classification.category === "bridge" ||
    classification.category === "bridge_pool" ||
    classification.category === "dex" ||
    classification.category === "router" ||
    classification.category === "swap_adapter" ||
    classification.category === "unknown_contract";
}

function feature(code: string, label: string, scoreImpact: number, value?: RouteScoreFeature["value"]): RouteScoreFeature {
  return { code, label, scoreImpact, value };
}

export function buildOperationalFlowProfile(input: BuildOperationalFlowProfileInput): OperationalFlowProfile {
  const windowEdges = input.edges.filter((edge) => edge.timestamp >= input.windowStart && edge.timestamp <= input.windowEnd);
  const incoming = windowEdges.filter((edge) => edge.toAddress === input.subjectAddress);
  const outgoing = windowEdges.filter((edge) => edge.fromAddress === input.subjectAddress);
  const incomingVolume = incoming.reduce((sum, edge) => sum + amount(edge), 0n);
  const outgoingVolume = outgoing.reduce((sum, edge) => sum + amount(edge), 0n);

  const summarize = (direction: FlowCounterpartyDirection, edges: ForensicRouteEdge[], total: bigint): FlowCounterpartySummary[] => {
    const totals = new Map<string, { volume: bigint; txCount: number }>();
    for (const edge of edges) {
      const address = direction === "incoming" ? edge.fromAddress : edge.toAddress;
      const current = totals.get(address) ?? { volume: 0n, txCount: 0 };
      current.volume += amount(edge);
      current.txCount += 1;
      totals.set(address, current);
    }
    return [...totals.entries()]
      .map(([address, item]) => {
        const classification = input.classifications.get(address) ?? null;
        return {
          address,
          direction,
          volumeRaw: item.volume.toString(),
          txCount: item.txCount,
          volumeRatio: ratio(item.volume, total),
          category: classification?.category ?? null,
          identity: classification?.identity ?? null,
          isTerminalLiquidity: isTerminalLiquidity(classification),
          isHtxHuobi: isHtxHuobi(classification)
        };
      })
      .sort((left, right) => {
        const diff = BigInt(right.volumeRaw) - BigInt(left.volumeRaw);
        if (diff !== 0n) return diff > 0n ? 1 : -1;
        return right.txCount - left.txCount || left.address.localeCompare(right.address);
      })
      .slice(0, 10);
  };

  const topIncomingCounterparties = summarize("incoming", incoming, incomingVolume);
  const topOutgoingCounterparties = summarize("outgoing", outgoing, outgoingVolume);

  const breakdownMap = new Map<string, { direction: FlowCounterpartyDirection; category: ServiceCategory; volume: bigint; txCount: number }>();
  for (const item of [...topIncomingCounterparties, ...topOutgoingCounterparties]) {
    if (!item.category || item.category === "none") continue;
    const key = `${item.direction}\u0000${item.category}`;
    const current = breakdownMap.get(key) ?? { direction: item.direction, category: item.category, volume: 0n, txCount: 0 };
    current.volume += BigInt(item.volumeRaw);
    current.txCount += item.txCount;
    breakdownMap.set(key, current);
  }

  const categoryBreakdown: FlowCategoryBreakdown[] = [...breakdownMap.values()].map((item) => ({
    direction: item.direction,
    category: item.category,
    volumeRaw: item.volume.toString(),
    txCount: item.txCount,
    volumeRatio: ratio(item.volume, item.direction === "incoming" ? incomingVolume : outgoingVolume)
  }));

  const sumRatio = (items: FlowCounterpartySummary[], predicate: (item: FlowCounterpartySummary) => boolean): number =>
    Math.min(1, items.filter(predicate).reduce((sum, item) => sum + item.volumeRatio, 0));

  const terminalLiquidityIncomingRatio = sumRatio(topIncomingCounterparties, (item) => item.isTerminalLiquidity);
  const terminalLiquidityOutgoingRatio = sumRatio(topOutgoingCounterparties, (item) => item.isTerminalLiquidity);
  const htxHuobiIncomingRatio = sumRatio(topIncomingCounterparties, (item) => item.isHtxHuobi);
  const htxHuobiOutgoingRatio = sumRatio(topOutgoingCounterparties, (item) => item.isHtxHuobi);
  const bridgeDexRouterOutgoingRatio = sumRatio(topOutgoingCounterparties, (item) => isBridgeDexRouter(item.category));
  const unknownContractOutgoingRatio = sumRatio(topOutgoingCounterparties, (item) => item.category === "unknown_contract");
  const inflowToOutflowRatio = preservation(incomingVolume, outgoingVolume);

  const features: RouteScoreFeature[] = [];
  if (terminalLiquidityOutgoingRatio >= 0.7) features.push(feature("operational_flow_high_terminal_liquidity_outgoing", "Large outgoing 30d share exits to terminal service/liquidity boundaries.", 30, terminalLiquidityOutgoingRatio));
  else if (terminalLiquidityOutgoingRatio >= 0.4) features.push(feature("operational_flow_medium_terminal_liquidity_outgoing", "Meaningful outgoing 30d share exits to terminal service/liquidity boundaries.", 20, terminalLiquidityOutgoingRatio));
  if (htxHuobiOutgoingRatio >= 0.2) features.push(feature("operational_flow_htx_huobi_outgoing", "Outgoing 30d flow includes HTX/Huobi terminal liquidity exposure.", 15, htxHuobiOutgoingRatio));
  if (bridgeDexRouterOutgoingRatio >= 0.4) features.push(feature("operational_flow_bridge_dex_router_outgoing", "Outgoing 30d flow uses bridge/DEX/router infrastructure.", 20, bridgeDexRouterOutgoingRatio));
  if (unknownContractOutgoingRatio >= 0.2) features.push(feature("operational_flow_unknown_contract_outgoing", "Outgoing 30d flow reaches unknown contract boundaries.", 10, unknownContractOutgoingRatio));
  if ((inflowToOutflowRatio ?? 0) >= 0.9) features.push(feature("operational_flow_preserved_inflow_outflow", "30d outgoing volume preserves most incoming volume.", 15, inflowToOutflowRatio));

  return {
    subjectAddress: input.subjectAddress,
    windowStart: input.windowStart.toISOString(),
    windowEnd: input.windowEnd.toISOString(),
    incomingVolumeRaw: incomingVolume.toString(),
    outgoingVolumeRaw: outgoingVolume.toString(),
    incomingTxCount: incoming.length,
    outgoingTxCount: outgoing.length,
    inflowToOutflowRatio,
    topIncomingCounterparties,
    topOutgoingCounterparties,
    categoryBreakdown,
    terminalLiquidityIncomingRatio,
    terminalLiquidityOutgoingRatio,
    htxHuobiIncomingRatio,
    htxHuobiOutgoingRatio,
    bridgeDexRouterOutgoingRatio,
    unknownContractOutgoingRatio,
    operationalScore: Math.min(85, features.reduce((sum, item) => sum + item.scoreImpact, 0)),
    features
  };
}
```

- [ ] **Step 4: Run GREEN test**

```bash
npm test -- tests/forensics/flowCounterpartyProfile.test.ts
```

Expected: PASS.

---

### Task 4: Build multi-hop boundary search to depth 4

**Files:**
- Create: `src/forensics/multiHopBoundaryExposure.ts`
- Create: `tests/forensics/multiHopBoundaryExposure.test.ts`

- [ ] **Step 1: Write RED tests**

Create `tests/forensics/multiHopBoundaryExposure.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runMultiHopBoundaryExposureSearch } from "../../src/forensics/multiHopBoundaryExposure";
import type { ForensicRouteEdge, ServiceClassification } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const hop1 = "THop11111111111111111111111111111111";
const hop2 = "THop22222222222222222222222222222222";
const htx = "THTX11111111111111111111111111111111";
const bridge = "TBridge111111111111111111111111111111";

function edge(id: string, from: string, to: string, amountRaw: string, at: string): ForensicRouteEdge {
  return {
    id,
    txHash: id,
    fromAddress: from,
    toAddress: to,
    amountRaw,
    timestamp: new Date(at),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function service(category: ServiceClassification["category"], identity: string): ServiceClassification {
  return { category, identity, confidence: "high", evidence: [`tag:${identity}`], isBoundary: category !== "none" };
}

describe("runMultiHopBoundaryExposureSearch", () => {
  it("finds outbound HTX boundary within 3 hops and scores it as operational context", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-subject-hop1", subject, hop1, "100000000000", "2026-05-20T10:00:00.000Z")]],
      [hop1, [edge("tx-hop1-hop2", hop1, hop2, "99000000000", "2026-05-20T10:05:00.000Z")]],
      [hop2, [edge("tx-hop2-htx", hop2, htx, "98000000000", "2026-05-20T10:10:00.000Z")]]
    ]);

    const profile = await runMultiHopBoundaryExposureSearch({
      subjectAddress: subject,
      windowStart: new Date("2026-05-20T00:00:00.000Z"),
      windowEnd: new Date("2026-05-21T00:00:00.000Z"),
      direction: "outbound",
      maxDepth: 4,
      beamWidth: 8,
      maxAddressFetches: 60,
      minAmountPreservationRatio: 0.7,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getClassificationForAddress: async (address) => address === htx ? service("cex", "HTX") : null
    });

    expect(profile.flows[0]).toMatchObject({
      direction: "outbound",
      depth: 3,
      boundaryAddress: htx,
      boundaryCategory: "cex",
      boundaryIdentity: "HTX",
      viaAddresses: [hop1, hop2],
      amountPreservationRatio: 0.98
    });
    expect(profile.outgoingBoundaryVolumeRatio).toBe(1);
    expect(profile.contextScore).toBeGreaterThanOrEqual(25);
    expect(profile.features.map((feature) => feature.code)).toEqual(expect.arrayContaining([
      "boundary_exposure_multi_hop_service",
      "boundary_exposure_htx_huobi_terminal",
      "boundary_exposure_preserved_amount"
    ]));
  });

  it("finds inbound bridge boundary within 4 hops without crossing the boundary", async () => {
    const hop3 = "THop33333333333333333333333333333333";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-hop1-subject", hop1, subject, "97000000000", "2026-05-20T10:00:00.000Z")]],
      [hop1, [edge("tx-hop2-hop1", hop2, hop1, "98000000000", "2026-05-20T09:55:00.000Z")]],
      [hop2, [edge("tx-hop3-hop2", hop3, hop2, "99000000000", "2026-05-20T09:50:00.000Z")]],
      [hop3, [edge("tx-bridge-hop3", bridge, hop3, "100000000000", "2026-05-20T09:45:00.000Z")]],
      [bridge, [edge("tx-before-bridge", "TBeforeBridge111111111111111111111", bridge, "100000000000", "2026-05-20T09:40:00.000Z")]]
    ]);

    const profile = await runMultiHopBoundaryExposureSearch({
      subjectAddress: subject,
      windowStart: new Date("2026-05-20T00:00:00.000Z"),
      windowEnd: new Date("2026-05-21T00:00:00.000Z"),
      direction: "inbound",
      maxDepth: 4,
      beamWidth: 8,
      maxAddressFetches: 60,
      minAmountPreservationRatio: 0.7,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getClassificationForAddress: async (address) => address === bridge ? service("bridge", "Allbridge") : null
    });

    expect(profile.flows[0]).toMatchObject({
      direction: "inbound",
      depth: 4,
      boundaryAddress: bridge,
      boundaryCategory: "bridge",
      viaAddresses: [hop1, hop2, hop3]
    });
    expect(profile.coverage.stoppedReasons.join(" ")).toContain("service boundary");
    expect(profile.flows.some((flow) => flow.boundaryTxHash === "tx-before-bridge")).toBe(false);
  });
});
```

- [ ] **Step 2: Run RED tests**

```bash
npm test -- tests/forensics/multiHopBoundaryExposure.test.ts
```

Expected: FAIL with missing module/function.

- [ ] **Step 3: Implement search module**

Create `src/forensics/multiHopBoundaryExposure.ts`.

Implementation rules:

- Search directions:
  - outbound: follow `fromAddress === currentAddress`, next address is `toAddress`, timestamps non-decreasing.
  - inbound: follow `toAddress === currentAddress`, next address is `fromAddress`, timestamps non-increasing.
- Stop expansion when destination classification is a boundary.
- Do not fetch beyond boundary.
- Keep `beamWidth` best states by score each depth.
- Enforce `maxAddressFetches`.
- Drop depth > 1 candidates with amount preservation `< minAmountPreservationRatio` unless they already reach a boundary.
- Score context, not taint.

Minimum exported API:

```ts
export type RunMultiHopBoundaryExposureSearchInput = {
  subjectAddress: string;
  direction: "inbound" | "outbound";
  windowStart: Date;
  windowEnd: Date;
  maxDepth?: 1 | 2 | 3 | 4;
  beamWidth?: number;
  maxAddressFetches?: number;
  maxEdgesPerAddress?: number;
  minAmountPreservationRatio?: number;
  fetchEdgesForAddress(address: string): Promise<ForensicRouteEdge[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
};

export async function runMultiHopBoundaryExposureSearch(
  input: RunMultiHopBoundaryExposureSearchInput
): Promise<BoundaryExposureProfile>;
```

Use these scoring feature names:

```ts
boundary_exposure_multi_hop_service
boundary_exposure_htx_huobi_terminal
boundary_exposure_bridge_dex_router_terminal
boundary_exposure_unknown_contract_terminal
boundary_exposure_preserved_amount
boundary_exposure_fast_path
boundary_exposure_continuity_stop
```

Context score formula:

```ts
const contextScore = Math.min(45, positiveFeatureSum);
```

This profile can exceed the old 15 boundary context cap because it feeds only operational laundering pattern, not taint.

- [ ] **Step 4: Run GREEN tests**

```bash
npm test -- tests/forensics/multiHopBoundaryExposure.test.ts
```

Expected: PASS.

---

### Task 5: Integrate profiles into deep forensic check

**Files:**
- Modify: `src/check/deepForensicCheck.ts`
- Test: `tests/check/deepForensicCheck.test.ts`

- [ ] **Step 1: Add RED integration test**

Append a test to `tests/check/deepForensicCheck.test.ts`:

```ts
  it("adds operational 4-hop boundary and 30d flow profiles from indexed transfers", async () => {
    const htx = "THTX11111111111111111111111111111111";
    const hop1 = "THop11111111111111111111111111111111";
    const hop2 = "THop22222222222222222222222222222222";
    const indexedByAddress = new Map<string, IndexedTronUsdtTransfer[]>([
      [subject, [indexed({ id: "tx-subject-hop1", from: subject, to: hop1, amountRaw: "100000000000", at: "2026-05-20T10:00:00.000Z" })]],
      [hop1, [indexed({ id: "tx-hop1-hop2", from: hop1, to: hop2, amountRaw: "99000000000", at: "2026-05-20T10:05:00.000Z" })]],
      [hop2, [indexed({ id: "tx-hop2-htx", from: hop2, to: htx, amountRaw: "98000000000", at: "2026-05-20T10:10:00.000Z" })]]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async (address) => address === htx ? {
        address: htx,
        name: "HTX Hot Wallet",
        tag: "HTX",
        isContract: false,
        verified: true,
        rawJson: {}
      } : null,
      listIndexedUsdtTransfersForAddress: async (address) => indexedByAddress.get(address) ?? []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T23:59:59.999Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 10,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0,
      extendedSearchMode: "disabled",
      extendedSearchMaxDepth: 4
    });

    expect(report.boundaryExposureProfiles.some((profile) =>
      profile.flows.some((flow) => flow.depth === 3 && flow.boundaryIdentity === "HTX")
    )).toBe(true);
    expect(report.operationalFlowProfiles?.[0]).toMatchObject({
      subjectAddress: subject,
      htxHuobiOutgoingRatio: 1,
      terminalLiquidityOutgoingRatio: 1
    });
    expect(report.rawEvidence.some((item) => "operationalFlowProfile" in item.evidenceJson)).toBe(true);
    expect(report.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "forensic_operational_boundary_flow" })
    ]));
  });
```

- [ ] **Step 2: Run RED integration test**

```bash
npm test -- tests/check/deepForensicCheck.test.ts
```

Expected: FAIL until deep check creates these profiles and observations.

- [ ] **Step 3: Wire profiles in `runDeepAddressForensicCheck`**

In `deepForensicCheck.ts`:

- import:

```ts
import { runMultiHopBoundaryExposureSearch } from "../forensics/multiHopBoundaryExposure";
import { buildOperationalFlowProfile } from "../forensics/flowCounterpartyProfile";
```

- after `sourceEdges` and classifications are available, gather indexed edges for searched addresses using `listIndexedUsdtTransfersForAddress`.
- run outbound and inbound multi-hop boundary search when indexed lookup exists:

```ts
const operationalBoundaryDepth = Math.min(4, Math.max(1, input.extendedSearchMaxDepth ?? 4)) as 1 | 2 | 3 | 4;
const operationalBoundaryProfiles = deps.listIndexedUsdtTransfersForAddress
  ? await Promise.all(["outbound", "inbound"].map((direction) => runMultiHopBoundaryExposureSearch({
      subjectAddress: input.sourceAddress,
      direction: direction as "outbound" | "inbound",
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      maxDepth: operationalBoundaryDepth,
      beamWidth: input.extendedSearchBeamWidth ?? 8,
      maxAddressFetches: input.extendedSearchMaxAddressFetches ?? 60,
      minAmountPreservationRatio: 0.7,
      fetchEdgesForAddress: async (address) => {
        const transfers = await deps.listIndexedUsdtTransfersForAddress!(address, {
          minTimestamp: input.windowStart,
          maxTimestamp: input.windowEnd,
          limit: 200
        });
        return transfers.map(indexedTransferToRouteEdge);
      },
      getClassificationForAddress: async (address) => {
        const metadata = await deps.getAddressMetadata?.(address) ?? null;
        const contractProfile = metadata?.isContract === true
          ? await deps.getContractIntelligenceProfile?.(address).catch(() => null) ?? null
          : null;
        return classifyServiceAddress({ address, metadata, contractProfile });
      }
    })))
  : [];
```

- build `OperationalFlowProfile` from subject indexed edges plus boundary-visible edges:

```ts
const operationalFlowProfiles = deps.listIndexedUsdtTransfersForAddress
  ? [buildOperationalFlowProfile({
      subjectAddress: input.sourceAddress,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      edges: dedupeEdges([
        ...sourceIndexedEdges.map(indexedTransferToRouteEdge),
        ...operationalBoundaryProfiles.flatMap((profile) => profile.flows.map((flow) => ({
          id: flow.boundaryTxHash,
          txHash: flow.boundaryTxHash,
          fromAddress: flow.direction === "outbound" ? input.sourceAddress : flow.boundaryAddress,
          toAddress: flow.direction === "outbound" ? flow.boundaryAddress : input.sourceAddress,
          amountRaw: flow.amountRaw,
          timestamp: new Date(flow.firstTransferAt),
          method: "transfer",
          edgeType: "normal_transfer" as const
        })))
      ]),
      classifications
    })]
  : [];
```

- Include the operational boundary profiles together with existing boundary profiles:

```ts
const boundaryExposureProfiles = [boundaryProfile, ...operationalBoundaryProfiles]
  .filter((profile) => profile.flows.length > 0 || profile.contextScore > 0);
```

- Add raw evidence and observation helpers:

```ts
code: "forensic_operational_boundary_flow"
message: "Operational boundary-flow pattern: bridge/DEX/CEX/HTX/Huobi/contract boundary exposure within 1-4 hops; not a blacklist/scam claim."
scoreImpact: Math.min(50, Math.max(...operationalBoundaryProfiles.map((p) => p.contextScore), operationalFlowProfiles[0]?.operationalScore ?? 0))
```

- [ ] **Step 4: Run GREEN integration test**

```bash
npm test -- tests/check/deepForensicCheck.test.ts
```

Expected: PASS.

---

### Task 6: Strengthen laundering pattern scoring without increasing taint

**Files:**
- Modify: `src/risk/riskPolicy.ts`
- Modify: `src/risk/riskEngine.ts`
- Test: `tests/risk/riskPolicy.test.ts`
- Test: `tests/risk/riskEngine.test.ts`

- [ ] **Step 1: Add RED policy tests**

Append to `tests/risk/riskPolicy.test.ts`:

```ts
  it("lets multi-hop bridge CEX DEX boundary flow reach HIGH as laundering pattern only", () => {
    const breakdown = calculatePolicyScoreBreakdown([
      reason("forensic_operational_boundary_flow", 50),
      reason("forensic_address_behavior", 30),
      reason("operational_flow_htx_huobi_outgoing", 15)
    ]);

    expect(breakdown.taintScore).toBe(0);
    expect(breakdown.launderingPatternScore).toBeGreaterThanOrEqual(70);
    expect(breakdown.score).toBe(breakdown.launderingPatternScore);
    expect(breakdown.dominantRiskType).toBe("laundering_pattern");
  });
```

Append to `tests/risk/riskEngine.test.ts`:

```ts
  it("reports HIGH operational boundary flow without scam or blacklist labels", () => {
    const report = calculateRisk({
      subjectAddress: "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe",
      labels: [],
      graphSignals: [
        {
          code: "forensic_operational_boundary_flow",
          message: "Operational boundary-flow pattern: HTX/bridge/DEX exposure within 1-4 hops; not a blacklist/scam claim.",
          scoreImpact: 50,
          source: "local_tron_usdt_index",
          confidence: "high",
          severity: "high"
        },
        {
          code: "operational_flow_htx_huobi_outgoing",
          message: "Outgoing 30d flow includes HTX/Huobi terminal liquidity exposure.",
          scoreImpact: 15,
          source: "local_tron_usdt_index",
          confidence: "high",
          severity: "medium"
        }
      ],
      behaviorSignals: [
        {
          code: "forensic_address_behavior",
          message: "Rapid transit-like USDT movement.",
          scoreImpact: 30,
          source: "forensic_route_search",
          confidence: "high",
          severity: "high"
        }
      ],
      amlSignals: []
    });

    expect(report.level).toBe("HIGH");
    expect(report.taintScore).toBe(0);
    expect(report.launderingPatternScore).toBeGreaterThanOrEqual(70);
    expect(report.dominantRiskType).toBe("laundering_pattern");
    expect(report.reasons.map((reason) => reason.code)).not.toEqual(expect.arrayContaining([
      "stablecoin_usdt_blacklisted",
      "internal_label_scam"
    ]));
    expect(report.reasons.find((reason) => reason.code === "forensic_operational_laundering_pattern")?.message)
      .toContain("not a blacklist/scam claim");
  });
```

- [ ] **Step 2: Run RED risk tests**

```bash
npm test -- tests/risk/riskPolicy.test.ts tests/risk/riskEngine.test.ts
```

Expected: FAIL until policy recognizes operational boundary flow.

- [ ] **Step 3: Update policy classification**

In `src/risk/riskPolicy.ts`, add an evidence class:

```ts
  | "operational_flow_pattern"
```

Add helper:

```ts
function isOperationalFlowPattern(code: string): boolean {
  return code === "forensic_operational_boundary_flow" ||
    code.startsWith("operational_flow_") ||
    code.includes("terminal_liquidity") ||
    code.includes("bridge_dex_router");
}
```

Before generic service boundary context:

```ts
  if (isOperationalFlowPattern(code)) {
    return { dimension: "service_context", evidenceClass: "operational_flow_pattern", hardEvidence: false, cap: 50 };
  }
```

In `calculatePolicyScoreBreakdown`, add operational flow bucket:

```ts
const operationalBuckets = {
  provenance: 0,
  behavior: 0,
  service_context: 0,
  operational_flow: 0,
  dampener: 0
};
```

When evidence class is `operational_flow_pattern`:

```ts
operationalBuckets.operational_flow += reason.scoreImpact;
```

Then compute:

```ts
const operationalContextScore = Math.min(50, operationalBuckets.operational_flow) +
  Math.min(30, operationalBuckets.service_context) +
  Math.min(40, operationalBuckets.provenance);

const launderingPatternScore = clampPolicyScore(Math.min(
  taintScore > 0 ? 90 : 85,
  operationalContextScore +
    Math.min(30, operationalBuckets.behavior) -
    Math.min(40, operationalBuckets.dampener)
));
```

This allows `50 + 30 = 80` HIGH operational pattern with `taintScore = 0`.

- [ ] **Step 4: Run GREEN risk tests**

```bash
npm test -- tests/risk/riskPolicy.test.ts tests/risk/riskEngine.test.ts
```

Expected: PASS.

---

### Task 7: Update Telegram report formatting

**Files:**
- Modify: `src/bot/createBot.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add RED formatting test**

Add a test that builds a deep forensic report with:

- `finalRisk.taintScore = 0`
- `finalRisk.launderingPatternScore >= 70`
- operational flow profile with HTX/Huobi and bridge/DEX shares

Expected message contains:

```ts
expect(text).toContain("Taint evidence");
expect(text).toContain("0/100");
expect(text).toContain("Operational laundering pattern");
expect(text).toContain("HTX/Huobi");
expect(text).toContain("bridge/DEX/router");
expect(text).toContain("not a blacklist/scam claim");
expect(text).not.toMatch(/black wallet|scam wallet|confirmed scam/i);
```

Concrete assertion block:

```ts
    const formatted = formatDeepForensicReport(job, report, "completed");
    const text = String(formatted);
    expect(text).toContain("Taint evidence");
    expect(text).toContain("Operational laundering pattern");
    expect(text).toContain("HTX/Huobi");
    expect(text).toContain("not a blacklist/scam claim");
    expect(text).not.toMatch(/black wallet|scam wallet|confirmed scam/i);
```

- [ ] **Step 2: Run RED formatting test**

```bash
npm test -- tests/bot/createBot.test.ts
```

Expected: FAIL until formatting is added.

- [ ] **Step 3: Add report helper functions**

In `createBot.ts`, add:

```ts
function riskBreakdownLines(report: RiskReport): string[] {
  const lines: string[] = [];
  if (typeof report.taintScore === "number") {
    lines.push(`${bold("Taint evidence")}: ${code(`${report.taintScore}/100`)}${report.taintScore === 0 ? " — no direct blacklist/scam/approval-drain proof found." : ""}`);
  }
  if (typeof report.launderingPatternScore === "number" && report.launderingPatternScore > 0) {
    lines.push(`${bold("Operational laundering pattern")}: ${code(`${report.launderingPatternScore}/100`)} (${escapeHtml(levelFromScore(report.launderingPatternScore))}) — not a blacklist/scam claim.`);
  }
  return lines;
}
```

Add operational flow lines:

```ts
function operationalFlowLines(report: DeepAddressForensicReport): string[] {
  const profile = report.operationalFlowProfiles?.[0] ?? null;
  if (!profile) return [];
  return [
    `${bold("30d flow")}: in ${code(formatRawUsdt(profile.incomingVolumeRaw))}; out ${code(formatRawUsdt(profile.outgoingVolumeRaw))}; preservation ${code(profile.inflowToOutflowRatio === null ? "n/a" : formatPercent(profile.inflowToOutflowRatio))}`,
    `${bold("Terminal liquidity outgoing")}: ${code(formatPercent(profile.terminalLiquidityOutgoingRatio))}; HTX/Huobi ${code(formatPercent(profile.htxHuobiOutgoingRatio))}; bridge/DEX/router ${code(formatPercent(profile.bridgeDexRouterOutgoingRatio))}`,
    `${bold("Top outgoing")}: ${code(profile.topOutgoingCounterparties.slice(0, 3).map((item) => `${shortIdentifier(item.address)} ${item.identity ?? item.category ?? "unknown"} ${formatPercent(item.volumeRatio)}`).join("; ") || "none")}`
  ];
}
```

Insert `...riskBreakdownLines(finalRisk)` after `riskLine(finalRisk)` and add `operationalFlowLines(report)` under evidence/context.

- [ ] **Step 4: Run GREEN formatting test**

```bash
npm test -- tests/bot/createBot.test.ts
```

Expected: PASS.

---

### Task 8: Add local offline operational report CLI

**Files:**
- Create: `scripts/forensicOperationalReport.ts`
- Modify: `package.json`
- Test: `tests/scripts/forensicOperationalReport.test.ts` if script tests exist; otherwise test parser/helpers as unit functions

- [ ] **Step 1: Add package script**

In `package.json` scripts:

```json
"forensic:operational": "node --import tsx scripts/forensicOperationalReport.ts"
```

- [ ] **Step 2: Script behavior**

CLI options:

```text
--source <tron-address>
--days 30
--depth 4
--beam 8
--max-addresses 60
--min-preservation 0.7
```

Default values:

```ts
const defaults = {
  days: 30,
  depth: 4,
  beam: 8,
  maxAddresses: 60,
  minPreservation: 0.7
};
```

Output shape:

```text
Subject: TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe
Window: <start> -> <end>
Operational laundering pattern: <score>/100 (<LOW|MEDIUM|HIGH>)
Taint evidence: not evaluated by this local report
30d flow: incoming <USDT>; outgoing <USDT>; preservation <percent>
Terminal liquidity outgoing: <percent>
HTX/Huobi outgoing: <percent>
Bridge/DEX/router outgoing: <percent>
Unknown contract outgoing: <percent>

Top outgoing counterparties:
- <address> | <category> | <identity> | <volume> | <share>

Boundary paths:
- outbound depth <1-4> | <category> <identity> | <amount> | preservation <percent>
  path: <subject> -> ... -> <boundary>
  tx: <tx1> -> ... -> <txN>
```

- [ ] **Step 3: Implementation requirements**

The script must:

- load config using existing project config pattern
- create DB with `createDb(loadConfig().databaseUrl)`
- use `listIndexedTronUsdtTransfersForAddress`
- use `getAddressMetadata` repository function if available
- classify addresses with `classifyServiceAddress`
- run both inbound and outbound `runMultiHopBoundaryExposureSearch`
- build `OperationalFlowProfile`
- print no scam/blacklist wording

- [ ] **Step 4: Manual verification commands**

Run:

```bash
npm run forensic:operational -- --source TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe --days 30 --depth 4 --beam 8 --max-addresses 60
npm run forensic:operational -- --source TUzXY779GY3Tm6UDRYDPqNEojZgZEpY127 --days 30 --depth 4 --beam 8 --max-addresses 60
```

Expected for a populated local index:

- report shows max depth up to 4 when paths exist
- HTX/Huobi/bridge/DEX/router/unknown-contract shares are visible
- no black-wallet/scam claim appears unless exact evidence is added elsewhere

If local index has no rows for `TLh...`, expected output should clearly say:

```text
No indexed TRON USDT transfers found for the requested window. Live fast-check may still have data not present in the local offline index.
```

---

### Task 9: Make deep/offline depth behavior explicit

**Files:**
- Modify: `src/check/deepForensicCheck.ts`
- Modify: `src/check/addressExposureSignals.ts` if fast fallback depth is surfaced there
- Test: `tests/check/deepForensicCheck.test.ts`

- [ ] **Step 1: Add RED test for depth 4 default when indexed search exists**

In `tests/check/deepForensicCheck.test.ts`, add assertion to the operational integration test:

```ts
expect(report.boundaryExposureProfiles.some((profile) =>
  profile.flows.some((flow) => flow.depth >= 3)
)).toBe(true);
expect(report.coverage.extendedFetchedAddresses).toBeGreaterThan(1);
```

- [ ] **Step 2: Ensure fast fallback remains separate**

Rules:

- fast check may remain depth 1-2 for latency
- deep/offline operational search defaults to depth 4
- timeout fallback must mark report as partial or add a limit line; it must not silently present depth 1 as the whole deep result

Add coverage/limit text:

```ts
"Operational boundary search used fallback depth 1 because the deep search timed out. Treat this as partial coverage."
```

- [ ] **Step 3: Run tests**

```bash
npm test -- tests/check/deepForensicCheck.test.ts tests/bot/createBot.test.ts
```

Expected: PASS.

---

### Task 10: Full verification and live/offline checks

**Files:**
- No production file changes unless tests reveal a bug

- [ ] **Step 1: Run targeted tests**

```bash
npm test -- tests/forensics/serviceClassifier.test.ts tests/forensics/flowCounterpartyProfile.test.ts tests/forensics/multiHopBoundaryExposure.test.ts tests/check/deepForensicCheck.test.ts tests/risk/riskPolicy.test.ts tests/risk/riskEngine.test.ts tests/bot/createBot.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run offline operational reports**

```bash
npm run forensic:operational -- --source TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe --days 30 --depth 4 --beam 8 --max-addresses 60
npm run forensic:operational -- --source TUzXY779GY3Tm6UDRYDPqNEojZgZEpY127 --days 30 --depth 4 --beam 8 --max-addresses 60
```

Expected:

- If indexed data exists: depth 1-4 boundary paths and flow shares appear.
- If indexed data is missing: output says indexed data is missing, not that the wallet is low risk.

- [ ] **Step 5: Verify wording**

Search output and formatted report text for forbidden claims:

```bash
npm run forensic:operational -- --source TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe --days 30 --depth 4 --beam 8 --max-addresses 60 | grep -Ei "black wallet|scam wallet|confirmed scam|blacklisted"
```

Expected:

- No matches unless exact blacklist/scam evidence exists.

- [ ] **Step 6: Commit if requested**

```bash
git add src/types.ts src/forensics/serviceClassifier.ts src/forensics/flowCounterpartyProfile.ts src/forensics/multiHopBoundaryExposure.ts src/check/deepForensicCheck.ts src/risk/riskPolicy.ts src/risk/riskEngine.ts src/bot/createBot.ts scripts/forensicOperationalReport.ts package.json tests/forensics/serviceClassifier.test.ts tests/forensics/flowCounterpartyProfile.test.ts tests/forensics/multiHopBoundaryExposure.test.ts tests/check/deepForensicCheck.test.ts tests/risk/riskPolicy.test.ts tests/risk/riskEngine.test.ts tests/bot/createBot.test.ts

git commit -m "feat: detect operational laundering boundary flows"
```

---

## Implementation order

Use this exact order:

1. HTX/Huobi classifier test and implementation.
2. 30-day operational flow profile test and implementation.
3. Multi-hop boundary search test and implementation.
4. Deep forensic integration test and implementation.
5. Risk policy/risk engine tests and implementation.
6. Telegram report formatting tests and implementation.
7. Offline CLI script and manual benchmark.
8. Full verification.

This order keeps each unit independently testable and avoids mixing report formatting with core scoring logic.

---

## Acceptance criteria

- `taintScore` remains `0` for boundary-only patterns.
- `launderingPatternScore` can reach `70-85` for strong operational laundering patterns.
- Direct or multi-hop HTX/Huobi/CEX/bridge/DEX/router exposure is visible in report.
- 30-day top incoming/outgoing counterparties are visible.
- Deep/offline boundary search uses depth up to 4, beam 8, max-addresses 60, min-preservation 0.7.
- Fast fallback depth 1 is labeled partial and does not masquerade as full deep research.
- No blacklist/scam/black-wallet claim appears without exact evidence.
- Targeted tests, typecheck, and full tests pass.

---

## Self-review

Spec coverage:

- Crossbridges/DEX/routers up to 4 hops: Task 4, Task 5, Task 8.
- HTX/Huobi separate accounting: Task 2, Task 3, Task 7.
- 30-day top incoming/outgoing wallets: Task 3, Task 7.
- Percent shares where chain is lost: Task 3, Task 4, Task 7.
- Scam approvals/blacklist separate from operational pattern: Task 6, Task 10.
- HIGH result for laundering-style behavior without black-wallet claim: Task 6, Task 7, Task 10.

Placeholder scan:

- The plan contains concrete files, commands, test examples, exported APIs, feature codes, and acceptance criteria.
- No `TBD`, `TODO`, or undefined future steps are required for execution.

Type consistency:

- New types live in `src/types.ts` and are imported by new modules.
- Feature codes from forensics are recognized by `riskPolicy.ts`.
- Report formatting uses fields added to `RiskReport`, `DeepAddressForensicReport`, and `OperationalFlowProfile`.
