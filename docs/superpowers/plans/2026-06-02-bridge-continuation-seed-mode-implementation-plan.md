# Bridge Continuation Seed Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a manual seed mode that continues cross-chain analysis after a bridge boundary, with Ethereum/Arbitrum/BSC EVM support, TRON USDT support, and proof-safe evidence classes.

**Architecture:** Keep the existing Stage 2 corridor as the gatekeeper. Add focused continuation types, scoring, providers, and bounded search, then attach a compact continuation section to the existing corridor report only when manual deep/seed mode is enabled.

**Tech Stack:** TypeScript, Vitest, Etherscan API V2, Range API, existing Tronscan/TronGrid clients.

---

## File Map

- Create `src/forensics/crossChainContinuationTypes.ts`: shared continuation seeds, edges, evidence classes, provider interface, report types.
- Create `src/forensics/bridgeContinuationScorer.ts`: amount/time/split/protocol classification and terminal guard helpers.
- Create `src/forensics/evmContinuationProvider.ts`: adapter from existing `EvmEvidenceProvider` to continuation edges for Ethereum, Arbitrum, and BSC.
- Create `src/forensics/tronContinuationProvider.ts`: adapter from existing TRON transfer client to continuation edges for TRON USDT.
- Create `src/forensics/bridgeContinuationSearch.ts`: bounded seed-mode frontier search.
- Modify `src/types.ts`: add `bsc` known chain and `candidate_only` terminal; add continuation fields to corridor report/path.
- Modify `src/forensics/crossChainEvidence.ts`: score `candidate_only` as data-quality, never proof.
- Modify `src/forensics/evmExplorerClient.ts`: add `bsc` chain mapping to Etherscan V2.
- Modify `src/forensics/crossChainCorridor.ts`: call continuation only after bridge boundary and only in manual mode.
- Modify `src/check/whereIsMoneyCheck.ts`: pass continuation providers and manual flag through the existing Stage 2 branch.
- Modify `src/bot/createBot.ts`: display a compact continuation summary.
- Add tests under `tests/forensics`, `tests/check`, and `tests/bot`.
- Add fixtures in `tests/fixtures/forensics/bridgeContinuationCases.ts`.

---

### Task 1: Foundation Types And Candidate-Only Terminal

**Files:**
- Modify: `src/types.ts`
- Modify: `src/forensics/crossChainEvidence.ts`
- Create: `src/forensics/crossChainContinuationTypes.ts`
- Test: `tests/types/crossChainTypes.test.ts`
- Test: `tests/forensics/crossChainEvidence.test.ts`

- [ ] **Step 1: Write failing type and scoring tests**

Add to `tests/types/crossChainTypes.test.ts`:

```typescript
import type { CrossChainKnownId, CrossChainTerminalBoundary } from "../../src/types";

it("includes BSC and candidate-only continuation terminals", () => {
  const knownChain: CrossChainKnownId = "bsc";
  const terminal: CrossChainTerminalBoundary = "candidate_only";
  expect([knownChain, terminal]).toEqual(["bsc", "candidate_only"]);
});
```

Add to `tests/forensics/crossChainEvidence.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { scoreCrossChainTerminalBoundary } from "../../src/forensics/crossChainEvidence";

describe("cross-chain candidate-only scoring", () => {
  it("scores candidate-only continuation as data quality only", () => {
    const layer = scoreCrossChainTerminalBoundary({
      terminalBoundary: "candidate_only",
      selectedShare: 1,
      evidenceIds: ["cross_chain:local:ethereum:candidate:candidate_only"]
    });

    expect(layer.evidenceClass).toBe("data_quality");
    expect(layer.proofLevel).toBe("insufficient_coverage");
    expect(layer.score).toBe(20);
    expect(layer.sourceExposureKind).toBeUndefined();
    expect(layer.warnings.join(" ")).toContain("candidate");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run tests/types/crossChainTypes.test.ts tests/forensics/crossChainEvidence.test.ts --configLoader bundle
```

Expected: FAIL because `bsc`, `candidate_only`, or `crossChainEvidence.test.ts` support is missing.

- [ ] **Step 3: Update shared cross-chain types**

In `src/types.ts`, update the existing cross-chain type aliases:

```typescript
export type CrossChainKnownId = "tron" | "ethereum" | "arbitrum" | "bsc";
export type CrossChainId = CrossChainKnownId | (string & {});
```

Add `candidate_only` to `CrossChainTerminalBoundary`:

```typescript
export type CrossChainTerminalBoundary =
  | "tornado_or_mixer"
  | "sanctioned_service"
  | "no_name_token_liquidity"
  | "bridge_boundary"
  | "dex_router_boundary"
  | "unknown_contract"
  | "data_exhausted"
  | "candidate_only"
  | "none";
```

Add optional continuation fields without breaking existing report fixtures:

```typescript
export type CrossChainContinuationEvidenceClass =
  | "protocol_correlated"
  | "strong_amount_time"
  | "split_join"
  | "weak_candidate";

export type CrossChainContinuationSeed = {
  id: string;
  chain: CrossChainId;
  address?: string | null;
  txHash?: string | null;
  amountRaw: string;
  assetSymbol: string;
  timestamp: string | null;
  timeWindow?: {
    start: string;
    end: string;
  };
  labels: string[];
  evidenceRefs: CrossChainEvidenceRef[];
};

export type CrossChainContinuationEdge = CrossChainRouteEdge & {
  continuationEvidenceClass: CrossChainContinuationEvidenceClass;
  score: number;
  reasons: string[];
};

export type CrossChainContinuationReport = {
  enabled: boolean;
  seed: CrossChainContinuationSeed;
  terminalBoundary: CrossChainTerminalBoundary;
  edges: CrossChainContinuationEdge[];
  providerCalls: number;
  partial: boolean;
  coverageNotes: string[];
  payloadRefs: ProviderPayloadRef[];
};

export type CrossChainCorridorPath = {
  id: string;
  triggerReason: CrossChainStage2TriggerReason;
  balanceTransferTxHashes: string[];
  targetAmountRaw: string;
  selectedAmountRaw: string;
  edges: CrossChainRouteEdge[];
  continuation?: CrossChainContinuationReport | null;
  terminalBoundary: CrossChainTerminalBoundary;
  riskLayer: RiskLayerScore;
  sourcePolicyEvidence?: SourcePolicyEvidence | null;
  partial: boolean;
  reasons: string[];
  warnings: string[];
};
```

- [ ] **Step 4: Create continuation type module**

Create `src/forensics/crossChainContinuationTypes.ts`:

```typescript
import type {
  CrossChainAddress,
  CrossChainContinuationEdge,
  CrossChainContinuationEvidenceClass,
  CrossChainContinuationReport,
  CrossChainContinuationSeed
} from "../types";
import type { CrossChainProviderBudget } from "./crossChainBudget";

export type ChainContinuationProvider = {
  chain: string;
  listEdgesForAddress(input: {
    address: CrossChainAddress;
    seed: CrossChainContinuationSeed;
    budget: CrossChainProviderBudget;
  }): Promise<CrossChainContinuationEdge[]>;
};

export type {
  CrossChainContinuationEdge,
  CrossChainContinuationEvidenceClass,
  CrossChainContinuationReport,
  CrossChainContinuationSeed
} from "../types";
```

- [ ] **Step 5: Add candidate-only scoring config**

In `src/forensics/crossChainEvidence.ts`, add to `BOUNDARY_CONFIG`:

```typescript
candidate_only: {
  evidenceClass: "data_quality",
  baseScore: 20,
  usesSelectedShare: false,
  proofLevel: "insufficient_coverage",
  canBeDampened: true,
  reasons: ["Cross-chain continuation found candidate-only support without terminal proof."],
  warnings: ["Candidate-only continuation is not source-policy proof and must be manually reviewed."]
},
```

- [ ] **Step 6: Run tests to verify pass**

Run:

```bash
npx vitest run tests/types/crossChainTypes.test.ts tests/forensics/crossChainEvidence.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/forensics/crossChainEvidence.ts src/forensics/crossChainContinuationTypes.ts tests/types/crossChainTypes.test.ts tests/forensics/crossChainEvidence.test.ts
git commit -m "feat: add bridge continuation types"
```

---

### Task 2: Etherscan V2 BSC Chain Support

**Files:**
- Modify: `src/forensics/evmExplorerClient.ts`
- Modify: `src/forensics/crossChainCorridor.ts`
- Test: `tests/forensics/evmExplorerClient.test.ts`

- [ ] **Step 1: Write failing BSC chain-id test**

Add to `tests/forensics/evmExplorerClient.test.ts`:

```typescript
it("passes BSC chainid 56 to Etherscan V2 account requests", async () => {
  const calls: string[] = [];
  const provider = createEtherscanV2EvmEvidenceProvider({
    apiKey: "test-key",
    baseUrl: new URL("https://api.etherscan.io/v2/api"),
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ status: "0", message: "No transactions found", result: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await provider.listErc20Transfers({
    chain: "bsc",
    address: "0x3c38a410a09539b9bdeea3e5723dbf68c2d282da",
    pageLimit: 1,
    offset: 1
  });

  expect(calls[0]).toContain("chainid=56");
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npx vitest run tests/forensics/evmExplorerClient.test.ts --configLoader bundle
```

Expected: FAIL because `EvmChain` does not include `bsc`.

- [ ] **Step 3: Add BSC to EVM chain mapping**

In `src/forensics/evmExplorerClient.ts`:

```typescript
export type EvmChain = "ethereum" | "arbitrum" | "bsc";
```

Update `CHAIN_IDS`:

```typescript
const CHAIN_IDS: Record<EvmChain, string> = {
  ethereum: "1",
  arbitrum: "42161",
  bsc: "56"
};
```

- [ ] **Step 4: Fix native symbol mapping in corridor**

In `src/forensics/crossChainCorridor.ts`, replace the current `nativeSymbol` helper:

```typescript
function nativeSymbol(chain: EvmChain): string {
  if (chain === "bsc") return "BNB";
  return "ETH";
}
```

Update `evmAddress` chain ID logic:

```typescript
function evmAddress(chain: EvmChain, address: string | null | undefined): CrossChainAddress | null {
  if (!address) return null;
  const chainId = chain === "ethereum" ? 1 : chain === "arbitrum" ? 42161 : 56;
  return { chain, chainId, address };
}
```

- [ ] **Step 5: Run EVM tests**

Run:

```bash
npx vitest run tests/forensics/evmExplorerClient.test.ts tests/forensics/crossChainCorridor.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/forensics/evmExplorerClient.ts src/forensics/crossChainCorridor.ts tests/forensics/evmExplorerClient.test.ts
git commit -m "feat: support BSC in EVM explorer"
```

---

### Task 3: Continuation Scorer

**Files:**
- Create: `src/forensics/bridgeContinuationScorer.ts`
- Test: `tests/forensics/bridgeContinuationScorer.test.ts`

- [ ] **Step 1: Write failing scorer tests**

Create `tests/forensics/bridgeContinuationScorer.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  classifyContinuationEdge,
  terminalAllowedForContinuationClass,
  groupSplitJoinEdges
} from "../../src/forensics/bridgeContinuationScorer";
import type { CrossChainContinuationEdge, CrossChainContinuationSeed } from "../../src/forensics/crossChainContinuationTypes";

const seed: CrossChainContinuationSeed = {
  id: "seed:eth:bridge",
  chain: "ethereum",
  address: "0x1111111111111111111111111111111111111111",
  txHash: "0xseed",
  amountRaw: "100000000000",
  assetSymbol: "USDT",
  timestamp: "2026-05-05T02:41:59.000Z",
  labels: ["LayerZero"],
  evidenceRefs: []
};

function edge(overrides: Partial<CrossChainContinuationEdge>): CrossChainContinuationEdge {
  return {
    id: "edge",
    edgeType: "token_transfer",
    source: { chain: "ethereum", chainId: 1, address: "0xaaa0000000000000000000000000000000000000" },
    destination: { chain: "ethereum", chainId: 1, address: "0xbbb0000000000000000000000000000000000000" },
    txHash: "0xedge",
    amountRaw: "99000000000",
    assetSymbol: "USDT",
    timestamp: "2026-05-05T03:00:00.000Z",
    protocol: null,
    evidenceRefs: [],
    labels: [],
    continuationEvidenceClass: "weak_candidate",
    score: 0,
    reasons: [],
    ...overrides
  };
}

describe("bridge continuation scorer", () => {
  it("classifies provider and protocol evidence as protocol correlated", () => {
    const result = classifyContinuationEdge(seed, edge({
      protocol: "LayerZero/Stargate",
      evidenceRefs: [{
        id: "cross_chain:range:ethereum:0xseed:bridge_source",
        provider: "range",
        payloadId: "range:tx:0xseed",
        confidence: "provider_correlated"
      }]
    }));

    expect(result.continuationEvidenceClass).toBe("protocol_correlated");
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it("classifies close amount and time as strong amount-time", () => {
    const result = classifyContinuationEdge(seed, edge({ amountRaw: "97000000000" }));
    expect(result.continuationEvidenceClass).toBe("strong_amount_time");
    expect(result.reasons.join(" ")).toContain("amount");
  });

  it("keeps amount-only evidence weak", () => {
    const result = classifyContinuationEdge(seed, edge({
      timestamp: "2026-06-01T03:00:00.000Z",
      amountRaw: "99000000000"
    }));
    expect(result.continuationEvidenceClass).toBe("weak_candidate");
  });

  it("groups split/join edges when summed amount is preserved", () => {
    const group = groupSplitJoinEdges(seed, [
      edge({ id: "a", txHash: "0xa", amountRaw: "60000000000" }),
      edge({ id: "b", txHash: "0xb", amountRaw: "39000000000" })
    ]);

    expect(group?.continuationEvidenceClass).toBe("split_join");
    expect(group?.amountRaw).toBe("99000000000");
  });

  it("does not allow weak candidates to create proof terminals", () => {
    expect(terminalAllowedForContinuationClass("tornado_or_mixer", "weak_candidate")).toBe(false);
    expect(terminalAllowedForContinuationClass("no_name_token_liquidity", "weak_candidate")).toBe(false);
    expect(terminalAllowedForContinuationClass("candidate_only", "weak_candidate")).toBe(true);
  });
});
```

- [ ] **Step 2: Run scorer test to verify failure**

Run:

```bash
npx vitest run tests/forensics/bridgeContinuationScorer.test.ts --configLoader bundle
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement scorer**

Create `src/forensics/bridgeContinuationScorer.ts`:

```typescript
import type { CrossChainTerminalBoundary } from "../types";
import type {
  CrossChainContinuationEdge,
  CrossChainContinuationEvidenceClass,
  CrossChainContinuationSeed
} from "./crossChainContinuationTypes";

const STRONG_AMOUNT_RATIO = 0.95;
const MEANINGFUL_AMOUNT_RATIO = 0.7;
const STRONG_TIME_MS = 6 * 60 * 60 * 1000;
const WEAK_TIME_MS = 24 * 60 * 60 * 1000;

function raw(value: string | null | undefined): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function ratio(left: bigint, right: bigint): number {
  if (left <= 0n || right <= 0n) return 0;
  const min = left < right ? left : right;
  const max = left > right ? left : right;
  return Number(min * 10_000n / max) / 10_000;
}

function timeDeltaMs(seed: CrossChainContinuationSeed, edge: CrossChainContinuationEdge): number | null {
  if (!seed.timestamp || !edge.timestamp) return null;
  const left = Date.parse(seed.timestamp);
  const right = Date.parse(edge.timestamp);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Math.abs(right - left);
}

function hasProtocolEvidence(edge: CrossChainContinuationEdge): boolean {
  const text = [edge.protocol, ...edge.labels].filter(Boolean).join(" ").toLowerCase();
  return edge.evidenceRefs.some((ref) =>
    ref.confidence === "exact" ||
    ref.confidence === "provider_correlated" ||
    ref.confidence === "protocol_correlated"
  ) || /\b(layerzero|stargate|allbridge|tornado|mixer|uniswap|bridge)\b/.test(text);
}

export function classifyContinuationEdge(
  seed: CrossChainContinuationSeed,
  edge: CrossChainContinuationEdge
): CrossChainContinuationEdge {
  if (hasProtocolEvidence(edge)) {
    return {
      ...edge,
      continuationEvidenceClass: "protocol_correlated",
      score: 85,
      reasons: [...edge.reasons, "Protocol/provider evidence correlates this continuation edge."]
    };
  }

  const seedAmount = raw(seed.amountRaw);
  const edgeAmount = raw(edge.amountRaw);
  const amountRatio = seedAmount && edgeAmount ? ratio(seedAmount, edgeAmount) : 0;
  const delta = timeDeltaMs(seed, edge);
  const timeStrong = delta !== null && delta <= STRONG_TIME_MS;
  const timeWeak = delta !== null && delta <= WEAK_TIME_MS;

  if (amountRatio >= STRONG_AMOUNT_RATIO && timeStrong) {
    return {
      ...edge,
      continuationEvidenceClass: "strong_amount_time",
      score: 65,
      reasons: [...edge.reasons, `Strong amount/time continuation: ${Math.round(amountRatio * 100)}% amount preservation.`]
    };
  }

  if (amountRatio >= MEANINGFUL_AMOUNT_RATIO && timeWeak) {
    return {
      ...edge,
      continuationEvidenceClass: "strong_amount_time",
      score: 50,
      reasons: [...edge.reasons, `Meaningful amount/time continuation: ${Math.round(amountRatio * 100)}% amount preservation.`]
    };
  }

  return {
    ...edge,
    continuationEvidenceClass: "weak_candidate",
    score: Math.max(edge.score, amountRatio > 0 ? 20 : 10),
    reasons: [...edge.reasons, "Only weak continuation support is present."]
  };
}

export function groupSplitJoinEdges(
  seed: CrossChainContinuationSeed,
  edges: CrossChainContinuationEdge[]
): CrossChainContinuationEdge | null {
  const seedAmount = raw(seed.amountRaw);
  if (!seedAmount || edges.length < 2) return null;
  const sum = edges.reduce((total, edge) => total + (raw(edge.amountRaw) ?? 0n), 0n);
  const preservation = ratio(seedAmount, sum);
  if (preservation < STRONG_AMOUNT_RATIO) return null;
  const first = edges[0];
  return {
    ...first,
    id: `split_join:${edges.map((edge) => edge.id).join(":")}`,
    txHash: edges.map((edge) => edge.txHash).filter(Boolean).join(","),
    amountRaw: sum.toString(),
    continuationEvidenceClass: "split_join",
    score: 70,
    reasons: [`Split/join group preserves ${Math.round(preservation * 100)}% of seed amount.`],
    labels: [...new Set(edges.flatMap((edge) => edge.labels))]
  };
}

export function terminalAllowedForContinuationClass(
  terminal: CrossChainTerminalBoundary,
  evidenceClass: CrossChainContinuationEvidenceClass
): boolean {
  if (terminal === "candidate_only" || terminal === "data_exhausted" || terminal === "none") return true;
  if (evidenceClass === "weak_candidate") return false;
  if (terminal === "tornado_or_mixer" || terminal === "sanctioned_service" || terminal === "no_name_token_liquidity") {
    return evidenceClass === "protocol_correlated";
  }
  return evidenceClass === "protocol_correlated" || evidenceClass === "strong_amount_time" || evidenceClass === "split_join";
}
```

- [ ] **Step 4: Run scorer test**

Run:

```bash
npx vitest run tests/forensics/bridgeContinuationScorer.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/bridgeContinuationScorer.ts tests/forensics/bridgeContinuationScorer.test.ts
git commit -m "feat: score bridge continuation edges"
```

---

### Task 4: EVM Continuation Provider

**Files:**
- Create: `src/forensics/evmContinuationProvider.ts`
- Test: `tests/forensics/evmContinuationProvider.test.ts`

- [ ] **Step 1: Write failing EVM continuation provider test**

Create `tests/forensics/evmContinuationProvider.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createCrossChainProviderBudget } from "../../src/forensics/crossChainBudget";
import { createEvmContinuationProvider } from "../../src/forensics/evmContinuationProvider";
import type { EvmEvidenceProvider } from "../../src/forensics/evmExplorerClient";
import type { CrossChainContinuationSeed } from "../../src/forensics/crossChainContinuationTypes";

const seed: CrossChainContinuationSeed = {
  id: "seed",
  chain: "ethereum",
  address: "0x1111111111111111111111111111111111111111",
  txHash: "0xseed",
  amountRaw: "100000000000",
  assetSymbol: "USDT",
  timestamp: "2026-05-05T02:41:59.000Z",
  labels: ["LayerZero"],
  evidenceRefs: []
};

describe("EVM continuation provider", () => {
  it("normalizes ERC20, native, and internal edges for the requested chain", async () => {
    const evm: EvmEvidenceProvider = {
      async listNormalTransactions() {
        return [{
          chain: "ethereum",
          hash: "0xnormal",
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          value: "0",
          timeStamp: "1777949200",
          functionName: "bridge()"
        }];
      },
      async listInternalTransactions() {
        return [{
          chain: "ethereum",
          hash: "0xinternal",
          from: "0x3333333333333333333333333333333333333333",
          to: "0x1111111111111111111111111111111111111111",
          value: "99000000000000000000",
          timeStamp: "1777949201",
          type: "call"
        }];
      },
      async listErc20Transfers() {
        return [{
          chain: "ethereum",
          hash: "0xtoken",
          from: "0x1111111111111111111111111111111111111111",
          to: "0x4444444444444444444444444444444444444444",
          contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
          value: "99000000000",
          tokenName: "Tether USD",
          tokenSymbol: "USDT",
          tokenDecimal: "6",
          timeStamp: "1777949202"
        }];
      },
      async getTransactionReceipt() {
        return null;
      },
      async getLogs() {
        return [];
      },
      async getTokenMetadata() {
        return null;
      }
    };

    const provider = createEvmContinuationProvider({ chain: "ethereum", evmProvider: evm });
    const edges = await provider.listEdgesForAddress({
      address: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
      seed,
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 })
    });

    expect(edges.map((edge) => edge.edgeType)).toEqual(expect.arrayContaining(["native_transfer", "internal_transfer", "token_transfer"]));
    expect(edges.find((edge) => edge.txHash === "0xtoken")?.assetSymbol).toBe("USDT");
    expect(edges.find((edge) => edge.txHash === "0xtoken")?.continuationEvidenceClass).toBe("strong_amount_time");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npx vitest run tests/forensics/evmContinuationProvider.test.ts --configLoader bundle
```

Expected: FAIL because `evmContinuationProvider` does not exist.

- [ ] **Step 3: Implement EVM continuation provider**

Create `src/forensics/evmContinuationProvider.ts`:

```typescript
import type { CrossChainAddress, CrossChainEvidenceRef, CrossChainRouteEdgeType } from "../types";
import type {
  EvmChain,
  EvmEvidenceProvider,
  EvmInternalTransaction,
  EvmTokenTransfer,
  EvmTransaction
} from "./evmExplorerClient";
import { crossChainEvidenceId } from "./crossChainEvidence";
import { classifyContinuationEdge } from "./bridgeContinuationScorer";
import type {
  ChainContinuationProvider,
  CrossChainContinuationEdge,
  CrossChainContinuationSeed
} from "./crossChainContinuationTypes";

type Input = {
  chain: EvmChain;
  evmProvider: EvmEvidenceProvider;
};

function timestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return new Date(Number(value) * 1000).toISOString();
  return value;
}

function nativeSymbol(chain: EvmChain): string {
  return chain === "bsc" ? "BNB" : "ETH";
}

function chainId(chain: EvmChain): number {
  if (chain === "ethereum") return 1;
  if (chain === "arbitrum") return 42161;
  return 56;
}

function address(chain: EvmChain, value: string | null | undefined): CrossChainAddress | null {
  if (!value) return null;
  return { chain, chainId: chainId(chain), address: value };
}

function evidence(chain: EvmChain, txHash: string | null | undefined, kind: string): CrossChainEvidenceRef {
  return {
    id: crossChainEvidenceId("etherscan", chain, txHash ?? "unknown", kind),
    provider: "etherscan",
    payloadId: null,
    confidence: "protocol_correlated"
  };
}

function edgeBase(input: {
  chain: EvmChain;
  id: string;
  edgeType: CrossChainRouteEdgeType;
  source: string | null | undefined;
  destination: string | null | undefined;
  txHash: string | null | undefined;
  amountRaw: string | null | undefined;
  assetSymbol: string | null;
  tokenContract?: string | null;
  timestamp: string | null;
  protocol: string | null;
  labels: string[];
  evidenceKind: string;
}): CrossChainContinuationEdge {
  return {
    id: input.id,
    edgeType: input.edgeType,
    source: address(input.chain, input.source),
    destination: address(input.chain, input.destination),
    txHash: input.txHash ?? null,
    amountRaw: input.amountRaw ?? null,
    assetSymbol: input.assetSymbol,
    tokenContract: input.tokenContract,
    timestamp: input.timestamp,
    protocol: input.protocol,
    evidenceRefs: [evidence(input.chain, input.txHash, input.evidenceKind)],
    labels: input.labels,
    continuationEvidenceClass: "weak_candidate",
    score: 0,
    reasons: []
  };
}

function normalEdge(chain: EvmChain, tx: EvmTransaction): CrossChainContinuationEdge {
  return edgeBase({
    chain,
    id: `evm-continuation:normal:${chain}:${tx.hash ?? `${tx.from ?? ""}:${tx.to ?? ""}`}`,
    edgeType: "native_transfer",
    source: tx.from,
    destination: tx.to,
    txHash: tx.hash,
    amountRaw: tx.value,
    assetSymbol: nativeSymbol(chain),
    timestamp: timestamp(tx.timeStamp),
    protocol: null,
    labels: [tx.functionName, tx.methodId].filter((item): item is string => Boolean(item)),
    evidenceKind: "native_transfer"
  });
}

function internalEdge(chain: EvmChain, tx: EvmInternalTransaction): CrossChainContinuationEdge {
  return edgeBase({
    chain,
    id: `evm-continuation:internal:${chain}:${tx.hash ?? `${tx.from ?? ""}:${tx.to ?? ""}`}:${tx.traceId ?? ""}`,
    edgeType: "internal_transfer",
    source: tx.from,
    destination: tx.to,
    txHash: tx.hash,
    amountRaw: tx.value,
    assetSymbol: nativeSymbol(chain),
    timestamp: timestamp(tx.timeStamp),
    protocol: null,
    labels: [tx.type].filter((item): item is string => Boolean(item)),
    evidenceKind: "internal_transfer"
  });
}

function tokenEdge(chain: EvmChain, tx: EvmTokenTransfer): CrossChainContinuationEdge {
  return edgeBase({
    chain,
    id: `evm-continuation:erc20:${chain}:${tx.hash ?? `${tx.from ?? ""}:${tx.to ?? ""}`}:${tx.contractAddress ?? ""}:${tx.value ?? ""}`,
    edgeType: "token_transfer",
    source: tx.from,
    destination: tx.to,
    txHash: tx.hash,
    amountRaw: tx.value,
    assetSymbol: tx.tokenSymbol ?? null,
    tokenContract: tx.contractAddress ?? null,
    timestamp: timestamp(tx.timeStamp),
    protocol: null,
    labels: [tx.tokenName, tx.tokenSymbol].filter((item): item is string => Boolean(item)),
    evidenceKind: "token_transfer"
  });
}

function dedupe(edges: CrossChainContinuationEdge[]): CrossChainContinuationEdge[] {
  const seen = new Set<string>();
  const result: CrossChainContinuationEdge[] = [];
  for (const edge of edges) {
    const key = [edge.edgeType, edge.txHash, edge.source?.address, edge.destination?.address, edge.amountRaw, edge.assetSymbol].join("|").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
}

export function createEvmContinuationProvider(input: Input): ChainContinuationProvider {
  return {
    chain: input.chain,
    async listEdgesForAddress(query) {
      const [normal, internal, erc20] = await Promise.all([
        query.budget.run("etherscan", `continuation:normal:${input.chain}:${query.address.address}`, () =>
          input.evmProvider.listNormalTransactions({ chain: input.chain, address: query.address.address, pageLimit: 2 })
        ),
        query.budget.run("etherscan", `continuation:internal:${input.chain}:${query.address.address}`, () =>
          input.evmProvider.listInternalTransactions({ chain: input.chain, address: query.address.address, pageLimit: 2 })
        ),
        query.budget.run("etherscan", `continuation:erc20:${input.chain}:${query.address.address}`, () =>
          input.evmProvider.listErc20Transfers({ chain: input.chain, address: query.address.address, pageLimit: 2 })
        )
      ]);

      return dedupe([
        ...normal.map((tx) => normalEdge(input.chain, tx)),
        ...internal.map((tx) => internalEdge(input.chain, tx)),
        ...erc20.map((tx) => tokenEdge(input.chain, tx))
      ]).map((edge) => classifyContinuationEdge(query.seed, edge));
    }
  };
}
```

- [ ] **Step 4: Run EVM continuation tests**

Run:

```bash
npx vitest run tests/forensics/evmContinuationProvider.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/evmContinuationProvider.ts tests/forensics/evmContinuationProvider.test.ts
git commit -m "feat: add EVM bridge continuation provider"
```

---

### Task 5: Bridge Continuation Search

**Files:**
- Create: `src/forensics/bridgeContinuationSearch.ts`
- Test: `tests/forensics/bridgeContinuationSearch.test.ts`

- [ ] **Step 1: Write failing search tests**

Create `tests/forensics/bridgeContinuationSearch.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createCrossChainProviderBudget } from "../../src/forensics/crossChainBudget";
import { runBridgeContinuationSearch } from "../../src/forensics/bridgeContinuationSearch";
import type {
  ChainContinuationProvider,
  CrossChainContinuationEdge,
  CrossChainContinuationSeed
} from "../../src/forensics/crossChainContinuationTypes";

const seed: CrossChainContinuationSeed = {
  id: "seed",
  chain: "ethereum",
  address: "0x1111111111111111111111111111111111111111",
  txHash: "0xseed",
  amountRaw: "100000000000",
  assetSymbol: "USDT",
  timestamp: "2026-05-05T02:41:59.000Z",
  labels: ["LayerZero"],
  evidenceRefs: []
};

function edge(overrides: Partial<CrossChainContinuationEdge>): CrossChainContinuationEdge {
  return {
    id: "edge",
    edgeType: "tornado_withdrawal",
    source: { chain: "ethereum", chainId: 1, address: "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b" },
    destination: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
    txHash: "0xtornado",
    amountRaw: "100000000000",
    assetSymbol: "ETH",
    timestamp: "2026-05-05T03:00:00.000Z",
    protocol: "Tornado.Cash",
    evidenceRefs: [{
      id: "cross_chain:etherscan:ethereum:0xtornado:service_boundary",
      provider: "etherscan",
      payloadId: null,
      confidence: "protocol_correlated"
    }],
    labels: ["Tornado.Cash"],
    continuationEvidenceClass: "protocol_correlated",
    score: 85,
    reasons: ["Protocol/provider evidence correlates this continuation edge."],
    ...overrides
  };
}

describe("bridge continuation search", () => {
  it("returns Tornado terminal when provider returns protocol-correlated mixer evidence", async () => {
    const provider: ChainContinuationProvider = {
      chain: "ethereum",
      async listEdgesForAddress() {
        return [edge({})];
      }
    };

    const report = await runBridgeContinuationSearch({
      seed,
      providers: [provider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 }),
      maxDepth: 2,
      beamWidth: 4
    });

    expect(report.terminalBoundary).toBe("tornado_or_mixer");
    expect(report.edges[0]?.continuationEvidenceClass).toBe("protocol_correlated");
    expect(report.partial).toBe(false);
  });

  it("returns candidate-only when only weak evidence is found", async () => {
    const provider: ChainContinuationProvider = {
      chain: "ethereum",
      async listEdgesForAddress() {
        return [edge({
          protocol: null,
          labels: [],
          evidenceRefs: [],
          continuationEvidenceClass: "weak_candidate",
          score: 10
        })];
      }
    };

    const report = await runBridgeContinuationSearch({
      seed,
      providers: [provider],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 }),
      maxDepth: 2,
      beamWidth: 4
    });

    expect(report.terminalBoundary).toBe("candidate_only");
    expect(report.coverageNotes.join(" ")).toContain("candidate");
  });

  it("returns data-exhausted for unsupported chains", async () => {
    const report = await runBridgeContinuationSearch({
      seed: { ...seed, chain: "solana", address: "So11111111111111111111111111111111111111112" },
      providers: [],
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 }),
      maxDepth: 2,
      beamWidth: 4
    });

    expect(report.terminalBoundary).toBe("data_exhausted");
    expect(report.partial).toBe(true);
  });
});
```

- [ ] **Step 2: Run search tests to verify failure**

Run:

```bash
npx vitest run tests/forensics/bridgeContinuationSearch.test.ts --configLoader bundle
```

Expected: FAIL because `bridgeContinuationSearch` does not exist.

- [ ] **Step 3: Implement bounded search**

Create `src/forensics/bridgeContinuationSearch.ts`:

```typescript
import type { CrossChainTerminalBoundary } from "../types";
import { terminalAllowedForContinuationClass } from "./bridgeContinuationScorer";
import type { CrossChainProviderBudget } from "./crossChainBudget";
import type {
  ChainContinuationProvider,
  CrossChainContinuationEdge,
  CrossChainContinuationReport,
  CrossChainContinuationSeed
} from "./crossChainContinuationTypes";

type Input = {
  seed: CrossChainContinuationSeed;
  providers: ChainContinuationProvider[];
  budget: CrossChainProviderBudget;
  maxDepth: number;
  beamWidth: number;
};

function same(left: string | null | undefined, right: string | null | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function edgeAddress(edge: CrossChainContinuationEdge): string | null {
  return edge.destination?.address ?? edge.source?.address ?? null;
}

function terminalForEdge(edge: CrossChainContinuationEdge): CrossChainTerminalBoundary {
  const text = [edge.protocol, ...edge.labels, edge.source?.address, edge.destination?.address].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("tornado") || text.includes("mixer")) return "tornado_or_mixer";
  if (text.includes("local_exact_sanctioned") || text.includes("exact_sanctioned")) return "sanctioned_service";
  if (edge.edgeType === "unknown_token_liquidity") return "no_name_token_liquidity";
  if (edge.edgeType === "bridge_protocol_link" || text.includes("bridge") || text.includes("stargate") || text.includes("layerzero")) {
    return "bridge_boundary";
  }
  return "candidate_only";
}

function strongestTerminal(edges: CrossChainContinuationEdge[]): CrossChainTerminalBoundary {
  for (const edge of edges.sort((left, right) => right.score - left.score)) {
    const terminal = terminalForEdge(edge);
    if (terminalAllowedForContinuationClass(terminal, edge.continuationEvidenceClass)) return terminal;
  }
  return edges.length > 0 ? "candidate_only" : "data_exhausted";
}

function uniquePayloadRefs(edges: CrossChainContinuationEdge[]) {
  const refs = new Map<string, NonNullable<CrossChainContinuationEdge["evidenceRefs"][number]["payloadId"]>>();
  void refs;
  return [];
}

export async function runBridgeContinuationSearch(input: Input): Promise<CrossChainContinuationReport> {
  const provider = input.providers.find((candidate) => same(candidate.chain, input.seed.chain));
  if (!provider || !input.seed.address) {
    return {
      enabled: true,
      seed: input.seed,
      terminalBoundary: "data_exhausted",
      edges: [],
      providerCalls: input.budget.providerCalls(),
      partial: true,
      coverageNotes: [`No continuation provider is available for ${input.seed.chain}.`],
      payloadRefs: []
    };
  }

  const seenAddresses = new Set<string>();
  let frontier = [{
    chain: input.seed.chain,
    chainId: input.seed.chain,
    address: input.seed.address
  }];
  const collected: CrossChainContinuationEdge[] = [];
  const notes: string[] = [];

  for (let depth = 0; depth < input.maxDepth; depth += 1) {
    const next = [];
    for (const address of frontier) {
      const key = `${address.chain}:${address.address}`.toLowerCase();
      if (seenAddresses.has(key)) continue;
      seenAddresses.add(key);
      const edges = await provider.listEdgesForAddress({
        address,
        seed: input.seed,
        budget: input.budget
      }).catch((error: unknown) => {
        notes.push(`Continuation provider failed for ${address.chain}:${address.address}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      });
      collected.push(...edges);
      for (const edge of edges.sort((left, right) => right.score - left.score).slice(0, input.beamWidth)) {
        const nextAddress = edgeAddress(edge);
        if (!nextAddress) continue;
        const terminal = terminalForEdge(edge);
        if (terminal !== "candidate_only" && terminalAllowedForContinuationClass(terminal, edge.continuationEvidenceClass)) continue;
        next.push({ chain: input.seed.chain, chainId: input.seed.chain, address: nextAddress });
      }
    }
    if (next.length === 0) break;
    frontier = next.slice(0, input.beamWidth);
  }

  const terminalBoundary = strongestTerminal(collected);
  const partial = terminalBoundary === "data_exhausted" || notes.length > 0;
  const coverageNotes = [
    ...notes,
    ...input.budget.coverageNotes(),
    ...(terminalBoundary === "candidate_only" ? ["Continuation produced candidate-only support without terminal proof."] : [])
  ];

  return {
    enabled: true,
    seed: input.seed,
    terminalBoundary,
    edges: collected.sort((left, right) => right.score - left.score).slice(0, input.beamWidth),
    providerCalls: input.budget.providerCalls(),
    partial,
    coverageNotes,
    payloadRefs: uniquePayloadRefs(collected)
  };
}
```

- [ ] **Step 4: Run search tests**

Run:

```bash
npx vitest run tests/forensics/bridgeContinuationSearch.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/bridgeContinuationSearch.ts tests/forensics/bridgeContinuationSearch.test.ts
git commit -m "feat: search bridge continuation seeds"
```

---

### Task 6: Wire Continuation Into Cross-Chain Corridor

**Files:**
- Modify: `src/forensics/crossChainCorridor.ts`
- Test: `tests/forensics/crossChainCorridor.test.ts`

- [ ] **Step 1: Write failing corridor integration tests**

Add to `tests/forensics/crossChainCorridor.test.ts`:

```typescript
it("runs continuation only in manual mode after a bridge boundary", async () => {
  const calls: string[] = [];
  const result = await runCrossChainCorridorAnalysis({
    trigger: trigger({ reason: "manual_deep_mode" }),
    subjectAddress: subjectTron,
    originPaths: [originPath()],
    discoveryProvider: discovery({ transfers: [transfer()] }),
    evmProvider: emptyEvm(),
    continuationEnabled: true,
    continuationProviders: [{
      chain: "ethereum",
      async listEdgesForAddress() {
        calls.push("continuation");
        return [];
      }
    }],
    maxProviderCalls: 20
  });

  expect(calls).toEqual(["continuation"]);
  expect(result.report.paths[0]?.continuation?.terminalBoundary).toBe("data_exhausted");
});

it("does not run continuation in automatic Stage 2 mode", async () => {
  const calls: string[] = [];
  await runCrossChainCorridorAnalysis({
    trigger: trigger({ reason: "large_single_boundary" }),
    subjectAddress: subjectTron,
    originPaths: [originPath()],
    discoveryProvider: discovery({ transfers: [transfer()] }),
    evmProvider: emptyEvm(),
    continuationEnabled: false,
    continuationProviders: [{
      chain: "ethereum",
      async listEdgesForAddress() {
        calls.push("continuation");
        return [];
      }
    }],
    maxProviderCalls: 20
  });

  expect(calls).toEqual([]);
});
```

- [ ] **Step 2: Run corridor tests to verify failure**

Run:

```bash
npx vitest run tests/forensics/crossChainCorridor.test.ts --configLoader bundle
```

Expected: FAIL because new input fields and continuation attachment do not exist.

- [ ] **Step 3: Add optional continuation inputs**

In `src/forensics/crossChainCorridor.ts`, import:

```typescript
import { runBridgeContinuationSearch } from "./bridgeContinuationSearch";
import type { ChainContinuationProvider, CrossChainContinuationSeed } from "./crossChainContinuationTypes";
```

Extend `runCrossChainCorridorAnalysis` input:

```typescript
  continuationEnabled?: boolean;
  continuationProviders?: ChainContinuationProvider[];
```

Extend `expandWithProviders` input and `ExpansionState`:

```typescript
  continuationEnabled?: boolean;
  continuationProviders?: ChainContinuationProvider[];
```

- [ ] **Step 4: Build seeds from Range bridge edges**

Add helper in `src/forensics/crossChainCorridor.ts`:

```typescript
function continuationSeedFromTransfer(transfer: CrossChainTransfer): CrossChainContinuationSeed | null {
  const target = transfer.sourceTxHash ? transfer.source : transfer.destination;
  const txHash = transfer.sourceTxHash ?? transfer.destinationTxHash;
  if (!target.address || !txHash) return null;
  return {
    id: `continuation-seed:${target.chain}:${txHash}`,
    chain: String(target.chain),
    address: target.address,
    txHash,
    amountRaw: transfer.amountRaw,
    assetSymbol: transfer.assetSymbol,
    timestamp: transfer.timestamp,
    labels: [...transfer.labels],
    evidenceRefs: [...transfer.evidenceRefs],
    timeWindow: transfer.timestamp
      ? {
          start: new Date(Date.parse(transfer.timestamp) - 24 * 60 * 60 * 1000).toISOString(),
          end: new Date(Date.parse(transfer.timestamp) + 24 * 60 * 60 * 1000).toISOString()
        }
      : undefined
  };
}
```

- [ ] **Step 5: Attach continuation report to path**

Before `buildCorridorPath`, run continuation only when enabled:

```typescript
let continuation = null;
if (input.continuationEnabled === true && input.continuationProviders && state.transfers.length > 0) {
  const seed = state.transfers.map(continuationSeedFromTransfer).find((item): item is CrossChainContinuationSeed => item !== null);
  if (seed) {
    continuation = await runBridgeContinuationSearch({
      seed,
      providers: input.continuationProviders,
      budget: state.budget,
      maxDepth: 3,
      beamWidth: 8
    });
    state.notes.push(...continuation.coverageNotes);
  }
}
```

Pass `continuation` into `buildCorridorPath` and set:

```typescript
continuation,
terminalBoundary: continuation?.terminalBoundary !== "candidate_only" && continuation?.terminalBoundary !== "data_exhausted"
  ? continuation.terminalBoundary
  : terminalBoundary,
```

Keep the original `riskLayer` unless a continuation terminal is proof-safe and stronger. Add a follow-up in the same helper:

```typescript
const effectiveLayer = continuation && continuation.terminalBoundary !== "candidate_only"
  ? scoreCrossChainTerminalBoundary({
      terminalBoundary: continuation.terminalBoundary,
      selectedShare: selectedShare(state.originPaths),
      evidenceIds: continuation.edges.flatMap((edge) => edge.evidenceRefs.map((ref) => ref.id))
    })
  : riskLayer;
```

Use `effectiveLayer` for `riskLayer` and `sourcePolicyEvidence`.

- [ ] **Step 6: Run corridor tests**

Run:

```bash
npx vitest run tests/forensics/crossChainCorridor.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/forensics/crossChainCorridor.ts tests/forensics/crossChainCorridor.test.ts
git commit -m "feat: gate bridge continuation in stage 2"
```

---

### Task 7: Wire Where-Is-Money Manual Mode And Providers

**Files:**
- Modify: `src/check/whereIsMoneyCheck.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Write failing where-is-money tests**

Add to `tests/check/whereIsMoneyCheck.test.ts` near existing cross-chain Stage 2 tests:

```typescript
it("does not run bridge continuation during normal cross-chain Stage 2", async () => {
  const byAddress = stage2BridgeByAddress();
  const provider = countingDiscoveryProvider({
    transfers: [crossChainTransfer()]
  });
  const continuationCalls: string[] = [];
  const report = await runWhereIsMoneyCheck({
    getTrc20Balance: async () => "100000000000",
    fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
    getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
    getClassificationForAddress: async (address) => {
      if (address === crossChainBridgeTron) return service("bridge", "LayerZero/Stargate");
      return service("none", null);
    },
    getFastWalletRisk: async () => lowFastRisk,
    crossChainDiscoveryProvider: provider,
    evmEvidenceProvider: emptyEvmEvidenceProvider(),
    crossChainContinuationProviders: [{
      chain: "ethereum",
      async listEdgesForAddress() {
        continuationCalls.push("called");
        return [];
      }
    }]
  }, {
    sourceAddress: subject,
    windowStart: new Date("2026-05-01T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z"),
    crossChainStage2Enabled: true,
    crossChainManualDeepMode: false,
    crossChainMaxProviderCalls: 20
  });

  expect(report.crossChainCorridor).toBeDefined();
  expect(continuationCalls).toEqual([]);
});

it("runs bridge continuation during manual deep Stage 2", async () => {
  const byAddress = stage2BridgeByAddress();
  const provider = countingDiscoveryProvider({
    transfers: [crossChainTransfer()]
  });
  const continuationCalls: string[] = [];
  const report = await runWhereIsMoneyCheck({
    getTrc20Balance: async () => "100000000000",
    fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
    getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
    getClassificationForAddress: async (address) => {
      if (address === crossChainBridgeTron) return service("bridge", "LayerZero/Stargate");
      return service("none", null);
    },
    getFastWalletRisk: async () => lowFastRisk,
    crossChainDiscoveryProvider: provider,
    evmEvidenceProvider: emptyEvmEvidenceProvider(),
    crossChainContinuationProviders: [{
      chain: "ethereum",
      async listEdgesForAddress() {
        continuationCalls.push("called");
        return [];
      }
    }]
  }, {
    sourceAddress: subject,
    windowStart: new Date("2026-05-01T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z"),
    crossChainStage2Enabled: true,
    crossChainManualDeepMode: true,
    crossChainMaxProviderCalls: 20
  });

  expect(continuationCalls).toEqual(["called"]);
  expect(report.crossChainCorridor?.paths[0]?.continuation).toBeDefined();
});
```

- [ ] **Step 2: Run where-is-money tests to verify failure**

Run:

```bash
npx vitest run tests/check/whereIsMoneyCheck.test.ts --configLoader bundle
```

Expected: FAIL because deps do not include `crossChainContinuationProviders`.

- [ ] **Step 3: Add continuation providers to deps**

In `src/check/whereIsMoneyCheck.ts`, import:

```typescript
import type { ChainContinuationProvider } from "../forensics/crossChainContinuationTypes";
```

Extend `WhereIsMoneyDeps`:

```typescript
  crossChainContinuationProviders?: ChainContinuationProvider[];
```

Pass continuation options into `runCrossChainCorridorAnalysis`:

```typescript
    const crossChainAnalysis = await runCrossChainCorridorAnalysis({
      trigger: crossChainTrigger,
      subjectAddress: sourceAddress,
      originPaths,
      discoveryProvider: deps.crossChainDiscoveryProvider,
      evmProvider: deps.evmEvidenceProvider,
      continuationEnabled: input.crossChainManualDeepMode === true,
      continuationProviders: deps.crossChainContinuationProviders,
      maxProviderCalls: input.crossChainMaxProviderCalls ?? DEFAULT_CROSS_CHAIN_MAX_PROVIDER_CALLS
    });
```

- [ ] **Step 4: Run where-is-money tests**

Run:

```bash
npx vitest run tests/check/whereIsMoneyCheck.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/check/whereIsMoneyCheck.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "feat: pass manual bridge continuation through where check"
```

---

### Task 8: TRON Continuation Provider And BSC 320k Fixture

**Files:**
- Create: `src/forensics/tronContinuationProvider.ts`
- Create: `tests/fixtures/forensics/bridgeContinuationCases.ts`
- Test: `tests/forensics/tronContinuationProvider.test.ts`
- Test: `tests/forensics/bridgeContinuationSearch.test.ts`

- [ ] **Step 1: Create 320k fixture data**

Create `tests/fixtures/forensics/bridgeContinuationCases.ts`:

```typescript
import type { CrossChainContinuationEdge, CrossChainContinuationSeed } from "../../../src/forensics/crossChainContinuationTypes";

export const bsc320kSeed: CrossChainContinuationSeed = {
  id: "seed:allbridge:bsc:320k",
  chain: "bsc",
  address: "0x3c38a410a09539b9bdeea3e5723dbf68c2d282da",
  txHash: "allbridge-bsc-receive",
  amountRaw: "309899218851",
  assetSymbol: "USDT",
  timestamp: "2026-05-09T23:45:00.000Z",
  labels: ["Allbridge LP-USDT"],
  evidenceRefs: [{
    id: "cross_chain:range:bsc:allbridge-bsc-receive:bridge_destination",
    provider: "range",
    payloadId: "range:allbridge:320k",
    confidence: "provider_correlated"
  }]
};

export const bsc320kEdges: CrossChainContinuationEdge[] = [
  {
    id: "bsc-usdt-small",
    edgeType: "token_transfer",
    source: { chain: "bsc", chainId: 56, address: "0x3c38a410a09539b9bdeea3e5723dbf68c2d282da" },
    destination: { chain: "bsc", chainId: 56, address: "0xF874c3Ed7196B5Dc72B6D83a8d30B2aF290A815F" },
    txHash: "0x4a5a2104e0f90e4f78ac49663d32b59c2cdd59353da17f7aa94c0d3c61f1def2",
    amountRaw: "10000000",
    assetSymbol: "USDT",
    timestamp: "2026-05-09T23:46:34.000Z",
    protocol: null,
    evidenceRefs: [],
    labels: ["Tether USD", "USDT"],
    continuationEvidenceClass: "weak_candidate",
    score: 0,
    reasons: []
  },
  {
    id: "bsc-usdt-large",
    edgeType: "token_transfer",
    source: { chain: "bsc", chainId: 56, address: "0x3c38a410a09539b9bdeea3e5723dbf68c2d282da" },
    destination: { chain: "bsc", chainId: 56, address: "0xF874c3Ed7196B5Dc72B6D83a8d30B2aF290A815F" },
    txHash: "0x56097e079fee279970992b509ca7ac6ff974577647ab800cee22ffaecbcdc369",
    amountRaw: "309889218851",
    assetSymbol: "USDT",
    timestamp: "2026-05-09T23:49:26.000Z",
    protocol: null,
    evidenceRefs: [],
    labels: ["Tether USD", "USDT"],
    continuationEvidenceClass: "weak_candidate",
    score: 0,
    reasons: []
  }
];
```

- [ ] **Step 2: Write failing TRON provider test**

Create `tests/forensics/tronContinuationProvider.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createCrossChainProviderBudget } from "../../src/forensics/crossChainBudget";
import { createTronUsdtContinuationProvider } from "../../src/forensics/tronContinuationProvider";
import type { CrossChainContinuationSeed } from "../../src/forensics/crossChainContinuationTypes";

const seed: CrossChainContinuationSeed = {
  id: "seed:tron",
  chain: "tron",
  address: "TXu3sNwjyvNvCWY9kdZGZfCSDV1ikz25A4",
  txHash: "90d82348b20009cda48a2294233c888a89f3133c21855044f115719f14c52122",
  amountRaw: "999000000",
  assetSymbol: "USDT",
  timestamp: "2026-05-09T22:00:00.000Z",
  labels: ["Allbridge"],
  evidenceRefs: []
};

describe("TRON continuation provider", () => {
  it("normalizes TRON USDT transfers into continuation edges", async () => {
    const provider = createTronUsdtContinuationProvider({
      tronClient: {
        async listRelatedTrc20Transfers() {
          return [{
            transaction_id: "90d82348b20009cda48a2294233c888a89f3133c21855044f115719f14c52122",
            from_address: "TXu3sNwjyvNvCWY9kdZGZfCSDV1ikz25A4",
            to_address: "TAC21biCBL9agjuUyzd4gZr356zRgJq61b",
            quant: "999000000",
            block_ts: Date.parse("2026-05-09T22:01:00.000Z"),
            contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
            confirmed: true,
            contractRet: "SUCCESS"
          }];
        }
      }
    });

    const edges = await provider.listEdgesForAddress({
      address: { chain: "tron", chainId: "tron-mainnet", address: "TXu3sNwjyvNvCWY9kdZGZfCSDV1ikz25A4" },
      seed,
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 })
    });

    expect(edges[0]?.assetSymbol).toBe("USDT");
    expect(edges[0]?.continuationEvidenceClass).toBe("protocol_correlated");
  });
});
```

- [ ] **Step 3: Run TRON provider test to verify failure**

Run:

```bash
npx vitest run tests/forensics/tronContinuationProvider.test.ts --configLoader bundle
```

Expected: FAIL because the provider does not exist.

- [ ] **Step 4: Implement TRON continuation provider**

Create `src/forensics/tronContinuationProvider.ts`:

```typescript
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../parser/transactionParser";
import { crossChainEvidenceId } from "./crossChainEvidence";
import { classifyContinuationEdge } from "./bridgeContinuationScorer";
import type { ChainContinuationProvider, CrossChainContinuationEdge } from "./crossChainContinuationTypes";

type TronClient = {
  listRelatedTrc20Transfers(
    address: string,
    options?: { start?: number; limit?: number; minTimestamp?: number; endTimestamp?: number }
  ): Promise<RawTronscanTrc20Transfer[]>;
};

type Input = {
  tronClient: TronClient;
};

function success(transfer: RawTronscanTrc20Transfer): boolean {
  return transfer.contract_address === TRON_USDT_CONTRACT_ADDRESS &&
    transfer.confirmed === true &&
    transfer.revert !== true &&
    (!transfer.contractRet || transfer.contractRet === "SUCCESS") &&
    /^\d+$/.test(transfer.quant ?? "");
}

function edgeFromTransfer(transfer: RawTronscanTrc20Transfer): CrossChainContinuationEdge | null {
  if (!success(transfer)) return null;
  if (!transfer.transaction_id || !transfer.from_address || !transfer.to_address || typeof transfer.block_ts !== "number") return null;
  return {
    id: `tron-continuation:usdt:${transfer.transaction_id}:${transfer.from_address}:${transfer.to_address}:${transfer.quant}`,
    edgeType: "token_transfer",
    source: { chain: "tron", chainId: "tron-mainnet", address: transfer.from_address },
    destination: { chain: "tron", chainId: "tron-mainnet", address: transfer.to_address },
    txHash: transfer.transaction_id,
    amountRaw: transfer.quant,
    assetSymbol: "USDT",
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    timestamp: new Date(transfer.block_ts).toISOString(),
    protocol: "TRON USDT",
    evidenceRefs: [{
      id: crossChainEvidenceId("local", "tron", transfer.transaction_id, "token_transfer"),
      provider: "local",
      payloadId: null,
      confidence: "protocol_correlated"
    }],
    labels: ["TRON USDT"],
    continuationEvidenceClass: "weak_candidate",
    score: 0,
    reasons: []
  };
}

export function createTronUsdtContinuationProvider(input: Input): ChainContinuationProvider {
  return {
    chain: "tron",
    async listEdgesForAddress(query) {
      const startMs = query.seed.timeWindow ? Date.parse(query.seed.timeWindow.start) : undefined;
      const endMs = query.seed.timeWindow ? Date.parse(query.seed.timeWindow.end) : undefined;
      const transfers = await query.budget.run("local", `continuation:tron-usdt:${query.address.address}`, () =>
        input.tronClient.listRelatedTrc20Transfers(query.address.address, {
          start: 0,
          limit: 50,
          minTimestamp: Number.isFinite(startMs) ? startMs : undefined,
          endTimestamp: Number.isFinite(endMs) ? endMs : undefined
        })
      );
      return transfers
        .map(edgeFromTransfer)
        .filter((edge): edge is CrossChainContinuationEdge => edge !== null)
        .map((edge) => classifyContinuationEdge(query.seed, edge));
    }
  };
}
```

- [ ] **Step 5: Add BSC split fixture search assertion**

Append to `tests/forensics/bridgeContinuationSearch.test.ts`:

```typescript
import { bsc320kEdges, bsc320kSeed } from "../fixtures/forensics/bridgeContinuationCases";

it("keeps the 320k BSC Allbridge continuation as strong amount-time candidate", async () => {
  const report = await runBridgeContinuationSearch({
    seed: bsc320kSeed,
    providers: [{
      chain: "bsc",
      async listEdgesForAddress() {
        return bsc320kEdges;
      }
    }],
    budget: createCrossChainProviderBudget({ maxProviderCalls: 10 }),
    maxDepth: 2,
    beamWidth: 4
  });

  expect(report.edges.some((edge) => edge.amountRaw === "309889218851")).toBe(true);
  expect(report.terminalBoundary).toBe("candidate_only");
});
```

- [ ] **Step 6: Run TRON and BSC tests**

Run:

```bash
npx vitest run tests/forensics/tronContinuationProvider.test.ts tests/forensics/bridgeContinuationSearch.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/forensics/tronContinuationProvider.ts tests/forensics/tronContinuationProvider.test.ts tests/fixtures/forensics/bridgeContinuationCases.ts tests/forensics/bridgeContinuationSearch.test.ts
git commit -m "feat: add TRON and BSC continuation fixtures"
```

---

### Task 9: Report And Telegram Formatting

**Files:**
- Modify: `src/bot/createBot.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Write failing Telegram formatting test**

Add to `tests/bot/createBot.test.ts` near existing Stage 2 corridor tests:

```typescript
it("summarizes manual bridge continuation separately from the corridor verdict", () => {
  const report = stage2WhereReportForTest("bridge_boundary", {
    paths: [{
      ...crossChainCorridorForTest("bridge_boundary").paths[0],
      continuation: {
        enabled: true,
        seed: {
          id: "seed:ethereum:0xbridge",
          chain: "ethereum",
          address: "0x1111111111111111111111111111111111111111",
          txHash: "0xbridge",
          amountRaw: "100000000000",
          assetSymbol: "USDT",
          timestamp: "2026-05-05T02:41:59.000Z",
          labels: ["LayerZero"],
          evidenceRefs: []
        },
        terminalBoundary: "candidate_only",
        edges: [{
          id: "edge:candidate",
          edgeType: "token_transfer",
          source: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
          destination: { chain: "ethereum", chainId: 1, address: "0x2222222222222222222222222222222222222222" },
          txHash: "0xcandidate",
          amountRaw: "99000000000",
          assetSymbol: "USDT",
          timestamp: "2026-05-05T03:00:00.000Z",
          protocol: null,
          evidenceRefs: [],
          labels: ["USDT"],
          continuationEvidenceClass: "strong_amount_time",
          score: 65,
          reasons: ["Strong amount/time continuation."]
        }],
        providerCalls: 3,
        partial: false,
        coverageNotes: ["Continuation produced candidate-only support without terminal proof."],
        payloadRefs: []
      }
    }]
  });

  const text = plainTelegramText(formatWhereIsMoneyReport(
    whereIsMoneyJobForTest(),
    report,
    "completed"
  ).text);
  expect(text).toContain("Bridge continuation");
  expect(text).toContain("candidate-only");
  expect(text).toContain("0xcandidate");
  expect(text).not.toContain("hard proof");
});
```

- [ ] **Step 2: Run bot test to verify failure**

Run:

```bash
npx vitest run tests/bot/createBot.test.ts --configLoader bundle
```

Expected: FAIL because formatting does not print continuation.

- [ ] **Step 3: Add continuation formatter**

In `src/bot/createBot.ts`, add helper near `whereCrossChainCorridorLines`:

```typescript
function continuationTerminalText(boundary: CrossChainCorridorPathForReport["terminalBoundary"]): string {
  if (boundary === "candidate_only") return "candidate-only";
  if (boundary === "data_exhausted") return "data exhausted";
  return crossChainTerminalBoundaryText(boundary);
}

function continuationLines(path: CrossChainCorridorPathForReport): string[] {
  const continuation = path.continuation;
  if (!continuation?.enabled) return [];
  const topEdge = continuation.edges[0] ?? null;
  return [
    `Bridge continuation: ${continuationTerminalText(continuation.terminalBoundary)}`,
    topEdge
      ? `Top continuation edge: ${topEdge.txHash ?? "no tx"} ${topEdge.assetSymbol ?? "asset"} ${topEdge.continuationEvidenceClass}`
      : "Top continuation edge: none",
    ...(continuation.partial ? ["Continuation provider data is partial"] : []),
    ...continuation.coverageNotes.slice(0, 1)
  ];
}
```

Inside `whereCrossChainCorridorLines`, after the top path summary lines, append:

```typescript
  lines.push(...continuationLines(topPath));
```

Ensure no line says hard proof unless `terminalBoundary === "sanctioned_service"` and proof level is exact, preserving the current hard-proof wording guard.

- [ ] **Step 4: Run bot test**

Run:

```bash
npx vitest run tests/bot/createBot.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: summarize bridge continuation in bot report"
```

---

### Task 10: Final Verification And Live Manual Playbook

**Files:**
- Modify: `docs/research/2026-05-29-range-crosschain-case-playbook.md`
- Test: full test suite

- [ ] **Step 1: Add a live manual section to the playbook**

Append to `docs/research/2026-05-29-range-crosschain-case-playbook.md`:

```markdown
## Manual Bridge Continuation Seed Mode

Use this mode only after the normal where-is-money flow reaches a concrete bridge boundary.

Ethereum token/Tornado case:

```bash
npm run forensic:where-is-money -- --source <TRON-address> --cross-chain-stage2 --cross-chain-manual-deep --cross-chain-max-provider-calls 80
```

Expected report behavior:

- Stage 2 still shows the bridge boundary.
- Bridge continuation appears as a separate section.
- Tornado or no-name token terminals require protocol-correlated receipt/log/label evidence.
- Amount/time-only matches are shown as candidate-only support.

BSC 320k case:

```bash
npm run forensic:where-is-money -- --source TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d --cross-chain-stage2 --cross-chain-manual-deep --cross-chain-max-provider-calls 100
```

Expected report behavior:

- TRON USDT drain and Allbridge boundary are visible.
- BSC continuation uses Etherscan V2 `chainid=56`.
- Split USDT movement is candidate continuation unless a protocol or labeled terminal is found.
```

- [ ] **Step 2: Run targeted tests**

Run:

```bash
npx vitest run tests/forensics/bridgeContinuationScorer.test.ts tests/forensics/evmContinuationProvider.test.ts tests/forensics/bridgeContinuationSearch.test.ts tests/forensics/tronContinuationProvider.test.ts tests/forensics/crossChainCorridor.test.ts tests/check/whereIsMoneyCheck.test.ts tests/bot/createBot.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run typecheck
npm test
```

Expected:

```text
npm run typecheck -> passes
npm test -> passes
```

- [ ] **Step 4: Commit final docs**

```bash
git add docs/research/2026-05-29-range-crosschain-case-playbook.md
git commit -m "docs: add bridge continuation playbook"
```

- [ ] **Step 5: Final status check**

Run:

```bash
git status --short --branch
```

Expected:

```text
## master
```

If the branch is not clean, inspect the files and either commit relevant changes or leave unrelated user changes untouched.

---

## Self-Review

Spec coverage:

- Manual/seed-gated activation is covered by Tasks 6 and 7.
- Ethereum/Arbitrum/BSC EVM support is covered by Tasks 2 and 4.
- TRON USDT support is covered by Task 8.
- Solana unsupported/data-exhausted behavior is covered by Task 5.
- Evidence classes and weak-proof guard are covered by Tasks 1 and 3.
- 320k BSC fixture is covered by Task 8.
- Report and Telegram separation are covered by Task 9.

Type consistency:

- `CrossChainContinuationReport`, `CrossChainContinuationSeed`, and `CrossChainContinuationEdge` are introduced before use.
- `candidate_only` is added to `CrossChainTerminalBoundary` before report formatting uses it.
- `bsc` is added to both `CrossChainKnownId` and `EvmChain`.

Risk controls:

- Normal `where-is-money` mode never runs continuation providers.
- Weak candidates cannot create Tornado, sanctioned-service, or no-name token proof.
- Provider failures and unsupported chains produce partial/data-exhausted coverage.
