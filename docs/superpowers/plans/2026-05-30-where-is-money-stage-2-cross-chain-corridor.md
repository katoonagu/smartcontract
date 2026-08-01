# Where Is Money Stage 2 Cross-Chain Corridor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trigger-gated cross-chain corridor analysis to the current `Where is money?` architecture using Range, EVM continuation, deterministic detectors, and evidence-first scoring without regressing current TRON provenance behavior.

**Architecture:** Stage 2 runs after Stage 1 TRON provenance and an initial operational assessment, then contributes extra risk layers, source-policy evidence, optional exact sanctioned hard evidence, and an optional `CrossChainCorridorReport` before the final assessment. Range and EVM providers live behind interfaces; tests use deterministic fixtures based on the manual TRON -> Ethereum -> no-name liquidity -> Stargate -> Arbitrum -> Tornado case.

**Tech Stack:** TypeScript, Vitest, existing TRON/TronGrid clients, Range API behind `CrossChainDiscoveryProvider`, Etherscan V2-compatible API behind `EvmEvidenceProvider`, local label/detector modules, compact Telegram formatting in `src/bot/createBot.ts`.

---

## Current Code Audit

### Baseline

Run before implementation:

```bash
git status --short --branch
npm test
npm run typecheck
```

Expected current baseline at this plan rewrite:

```text
83 test files passed
820 tests passed
typecheck passed
```

Do not revert unrelated working-tree changes in Telegram/runtime files.

### Already Implemented

Do not reimplement these as Stage 2 prerequisites:

- `requestedAmountRaw`;
- `MoneyOriginProvenanceScope`;
- `transaction_seed`;
- `recent_flow`;
- TronGrid fallback through `TRON_FULLNODE_API_KEY`;
- `RiskLayerScore`;
- `SourcePolicyEvidence`;
- `dominantRiskLayer`;
- operational dampening;
- incoming-deposit reuse through shared `runWhereIsMoneyCheck`;
- compact Telegram report style.

### Review Updates Incorporated

This plan incorporates:

```text
C:/Users/User/Downloads/where-is-money-stage2-review.md
docs/research/2026-05-29-range-crosschain-case-playbook.md
```

Critical changes from the review:

- confirm current report formatter before editing; current entrypoint is `src/bot/createBot.ts`;
- reuse/extract `parseUsdtAmountToRaw()` instead of adding another USDT decimal parser;
- make split-flow grouping conservative by actor/protocol/time/amount preservation;
- add explicit sanctioned hard-proof path via `extraHardBadEvidence`;
- preserve extra Stage 2 layers in every operational assessment return branch;
- verify Range API schema before coding live adapter;
- add provider time windows, budget/dedupe, payload refs, and EVM logs;
- keep weak amount/time-only inference as weak support only;
- disabled Stage 2 must make zero provider calls.

## Manual Case Implementation Target

The fixture must model the analyst workflow, not just final addresses:

```text
TRON contract-sourced USDT inflow
-> LayerZero/Stargate-like bridge clue
-> Range Ethereum source tx
-> Ethereum sender 0x2cFEEE...
-> switch from USDT track to large ETH funding
-> Uniswap V3 remove/collect involving GARY
-> no-name token liquidity terminal
-> 497 ETH corridor to Stargate Pool Native
-> Range Arbitrum source
-> Arbitrum predecessor 0xeb2C...
-> Tornado.Cash 100 ETH funding
```

Manual case entities:

```text
Ethereum tx:
0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f

Ethereum actor:
0x2cFEEE2394aC0f01c92CDaDCb697feC0cF8Da315

Ethereum intermediate:
0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60

Arbitrum actor:
0x6Ca63c963948597EAF85C6A193FedF1d96c62eA7

Tornado-funded actor:
0xeb2Cdf39fC5Afa85BBa1467e209974d9B19fA68b

Stargate Pool Native:
0x77b2043768d28e9c9ab44e1abfc95944bce57931

GARY token:
0x1996d86e55b33aeef2c9f50b3086a91656a284db
```

The implementation must allow asset-track switching:

```text
USDT -> ETH -> no-name token liquidity -> ETH -> bridge -> Arbitrum native/internal funding -> Tornado
```

### Manual Analyst Mechanics To Implement

The manual trace in `docs/research/2026-05-29-range-crosschain-case-playbook.md` is not only an address list. It defines the decision mechanics the implementation must reproduce.

| Observation in manual trace | Implementation requirement |
|---|---|
| TRON inflow came from a contract and internal context pointed to LayerZero/Stargate-like behavior | Stage 1 boundary detection must seed Stage 2, but bridge/contract alone is not final hard proof |
| Range showed repeated Ethereum -> TRON USDT rows around the target amounts | Range rows must normalize into provider-correlated bridge edges with source tx, destination, amount, protocol, and payload refs |
| Ethereum source tx exposed a sender behind the bridge call | Corridor expansion must open the actor that funded the source tx, not stop on the bridge contract |
| The actor received large ETH before USDT bridge batches | The corridor can switch asset tracks when the new asset economically explains the next outflow |
| Uniswap V3 remove/collect involved GARY | EVM continuation must read receipt logs/getLogs and token metadata, not only ERC20 transfer pages |
| GARY looked thin/no-name by holders, transfers, and missing market data | No-name liquidity must produce high source-policy evidence and must not enter hard bad evidence |
| 247.77 ETH + 250 ETH from Arbitrum funded the 497 ETH leg | Split-flow logic must group by actor/protocol/time/amount preservation and must not rely only on path count |
| Arbitrum continuation required normal/internal/"Other Transactions" views | EVM provider must support Ethereum and Arbitrum chain ids, normal txs, internal txs, ERC20 transfers, receipts, and logs |
| `0xeb2C...A68b` was funded by Tornado.Cash 100 ETH internals | Tornado/mixer is a source-policy terminal unless exact sanctioned-service evidence is also present |

Fixtures and tests must assert these mechanics directly. A test that only asserts "final score is high" is not enough for this module.

## File Structure

### New Files

- `src/forensics/usdtAmount.ts`
  Shared USDT decimal/raw parsing and formatting helpers used by CLI and Stage 2 tests.

- `src/forensics/crossChainEvidence.ts`
  Evidence IDs, payload refs, terminal boundary scoring, and source-policy conversion.

- `src/forensics/crossChainBudget.ts`
  Per-run provider call budget, per-query dedupe, and budget-exhaustion coverage notes.

- `src/forensics/crossChainStage2Triggers.ts`
  Pure trigger evaluator aware of `provenanceScope`, `anchorTransfer`, and conservative split-flow grouping.

- `src/forensics/crossChainProviders.ts`
  Provider interfaces, normalized provider types, and fixture provider.

- `src/forensics/rangeClient.ts`
  Range adapter behind `CrossChainDiscoveryProvider`.

- `src/forensics/evmExplorerClient.ts`
  Etherscan V2-compatible provider behind `EvmEvidenceProvider`.

- `src/forensics/crossChainDetectors.ts`
  Deterministic no-name liquidity, mixer, sanctioned, bridge, and service detectors.

- `src/forensics/crossChainCorridor.ts`
  Stage 2 orchestration, EVM continuation, detector execution, and corridor report assembly.

- `tests/fixtures/forensics/crossChainCases.ts`
  Deterministic manual-case fixtures with normalized Range/EVM/local-label responses.

### Modified Files

- `src/types.ts`
  Extend source exposure and hard-evidence kinds; add cross-chain route/report types.

- `src/forensics/whereIsMoneyCliArgs.ts`
  Use shared `parseUsdtDecimalToRaw()` and add Stage 2 CLI flags.

- `src/forensics/provenanceScoring.ts`
  Score `no_name_token_liquidity`, `mixer`, and `sanctioned_service`.

- `src/forensics/moneyOriginOperationalAssessment.ts`
  Accept `extraSourcePolicyEvidence`, `extraRiskLayers`, and `extraHardBadEvidence`; preserve them through every return branch.

- `src/check/whereIsMoneyCheck.ts`
  Wire Stage 2 after initial Stage 1 assessment and before final report return.

- `src/forensics/incomingDepositJob.ts`
  Pass Stage 2 deps and flags into transaction-seeded where checks.

- `src/config.ts`, `.env.example`, `tests/config/config.test.ts`
  Add provider and budget config.

- `src/index.ts`, `scripts/forensicWhereIsMoney.ts`
  Runtime provider wiring.

- `src/bot/createBot.ts`, `tests/bot/createBot.test.ts`
  Compact Stage 2 report summary.

---

### Task 0: Reconfirm Baseline And Current Entrypoints

**Files:**
- Read-only

- [ ] **Step 1: Check worktree**

Run:

```bash
git status --short --branch
```

Expected: note unrelated local changes. Do not revert them.

- [ ] **Step 2: Run baseline**

Run:

```bash
npm test
npm run typecheck
```

Expected: both pass before implementation.

- [ ] **Step 3: Confirm formatter and parser entrypoints**

Run:

```bash
rg -n "formatWhereIsMoneyReport|parseUsdtAmountToRaw|SourceExposureKind|WhereIsMoneyHardBadEvidenceKind" src tests
```

Expected:

```text
formatWhereIsMoneyReport -> src/bot/createBot.ts
parseUsdtAmountToRaw -> src/forensics/whereIsMoneyCliArgs.ts
SourceExposureKind -> src/types.ts
WhereIsMoneyHardBadEvidenceKind -> src/types.ts
```

---

### Task 1: Shared USDT Amount Parser

**Files:**
- Create: `src/forensics/usdtAmount.ts`
- Modify: `src/forensics/whereIsMoneyCliArgs.ts`
- Test: `tests/forensics/whereIsMoneyCliArgs.test.ts`
- Test: `tests/forensics/usdtAmount.test.ts`

- [ ] **Step 1: Add parser tests**

Create `tests/forensics/usdtAmount.test.ts`:

```ts
import { parseUsdtDecimalToRaw } from "../../src/forensics/usdtAmount";

describe("parseUsdtDecimalToRaw", () => {
  it("parses positive USDT decimals to six-decimal raw units", () => {
    expect(parseUsdtDecimalToRaw("1")).toBe("1000000");
    expect(parseUsdtDecimalToRaw("1.25")).toBe("1250000");
    expect(parseUsdtDecimalToRaw("100000")).toBe("100000000000");
    expect(parseUsdtDecimalToRaw("1000.123456")).toBe("1000123456");
  });

  it("rejects zero, negative values, and more than six decimals", () => {
    expect(parseUsdtDecimalToRaw("0")).toBeNull();
    expect(parseUsdtDecimalToRaw("-1")).toBeNull();
    expect(parseUsdtDecimalToRaw("1.1234567")).toBeNull();
    expect(parseUsdtDecimalToRaw("abc")).toBeNull();
  });
});
```

Run:

```bash
npm test -- tests/forensics/usdtAmount.test.ts
```

Expected: fail because the helper does not exist.

- [ ] **Step 2: Implement shared parser**

Create `src/forensics/usdtAmount.ts`:

```ts
export function parseUsdtDecimalToRaw(value: string | null | undefined): string | null {
  if (!value || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const raw = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return raw > 0n ? raw.toString() : null;
}
```

- [ ] **Step 3: Reuse helper from CLI args**

Modify `src/forensics/whereIsMoneyCliArgs.ts`:

```ts
import { parseUsdtDecimalToRaw } from "./usdtAmount";
```

Replace the existing `parseUsdtAmountToRaw` body with:

```ts
export function parseUsdtAmountToRaw(value: string | null | undefined): string | null {
  return parseUsdtDecimalToRaw(value);
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- tests/forensics/usdtAmount.test.ts tests/forensics/whereIsMoneyCliArgs.test.ts
npm run typecheck
```

Commit:

```bash
git add src/forensics/usdtAmount.ts src/forensics/whereIsMoneyCliArgs.ts tests/forensics/usdtAmount.test.ts tests/forensics/whereIsMoneyCliArgs.test.ts
git commit -m "refactor: share USDT amount parsing"
```

---

### Task 2: Types, Evidence Refs, And Hard Sanctioned Evidence

**Files:**
- Modify: `src/types.ts`
- Test: `tests/types/crossChainTypes.test.ts`

- [ ] **Step 1: Add type compile test**

Create `tests/types/crossChainTypes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  CrossChainCorridorReport,
  RiskLayerScore,
  SourceExposureKind,
  WhereIsMoneyHardBadEvidence
} from "../../src/types";

describe("cross-chain types", () => {
  it("allows no-name, mixer, and sanctioned source exposure kinds", () => {
    const kinds: SourceExposureKind[] = ["no_name_token_liquidity", "mixer", "sanctioned_service"];
    expect(kinds).toHaveLength(3);
  });

  it("allows exact sanctioned hard evidence", () => {
    const evidence: WhereIsMoneyHardBadEvidence = {
      kind: "sanctioned_service",
      score: 98,
      message: "Exact sanctioned service evidence found in cross-chain corridor.",
      evidenceIds: ["cross_chain:local:ethereum:0xsanctioned:service_boundary"]
    };
    expect(evidence.kind).toBe("sanctioned_service");
  });

  it("allows cross-chain report payload refs and risk layers", () => {
    const layer: RiskLayerScore = {
      evidenceClass: "source_policy",
      kind: "cross_chain_no_name_token_liquidity",
      sourceExposureKind: "no_name_token_liquidity",
      score: 82,
      rawScore: 82,
      adjustedScore: 82,
      proofLevel: "exchange_policy_decline",
      canBeDampened: false,
      reasons: ["No-name token liquidity was found in the selected corridor."],
      warnings: ["This is source-policy evidence, not direct scam proof."],
      evidenceIds: ["cross_chain:local:ethereum:gary:unknown_token_liquidity"]
    };
    const report: CrossChainCorridorReport = {
      enabled: true,
      triggered: true,
      skippedReason: null,
      paths: [],
      providerCalls: 1,
      partial: false,
      coverageNotes: [],
      payloadRefs: [{
        id: "range:tx:0x7284",
        provider: "range",
        endpoint: "transfers/by-tx",
        fetchedAt: "2026-06-01T00:00:00.000Z"
      }]
    };
    expect(layer.sourceExposureKind).toBe("no_name_token_liquidity");
    expect(report.payloadRefs[0]?.provider).toBe("range");
  });
});
```

Run:

```bash
npm test -- tests/types/crossChainTypes.test.ts
```

Expected: fail until types are added.

- [ ] **Step 2: Extend source and hard-evidence kinds**

Modify `src/types.ts`:

```ts
export type SourceExposureKind =
  | "htx_huobi"
  | "whitebit"
  | "bridge_router_dex"
  | "cross_chain_boundary"
  | "no_name_token_liquidity"
  | "mixer"
  | "sanctioned_service"
  | "unknown_contract"
  | "unknown_cex"
  | "allowlisted_cex"
  | "risky_label";
```

Extend `WhereIsMoneyHardBadEvidenceKind`:

```ts
  | "sanctioned_service";
```

- [ ] **Step 3: Add cross-chain types**

Add to `src/types.ts`:

```ts
export type CrossChainId = "tron" | "ethereum" | "arbitrum" | string;

export type CrossChainAddress = {
  chain: CrossChainId;
  chainId: string | number;
  address: string;
};

export type CrossChainEvidenceConfidence =
  | "exact"
  | "provider_correlated"
  | "protocol_correlated"
  | "weak";

export type CrossChainEvidenceRef = {
  id: string;
  provider: "range" | "etherscan" | "alchemy" | "local";
  payloadId: string | null;
  confidence: CrossChainEvidenceConfidence;
};

export type ProviderPayloadRef = {
  id: string;
  provider: "range" | "etherscan" | "alchemy" | "local";
  endpoint: string;
  fetchedAt: string;
};

export type CrossChainRouteEdgeType =
  | "bridge_source"
  | "bridge_destination"
  | "bridge_protocol_link"
  | "native_transfer"
  | "token_transfer"
  | "internal_transfer"
  | "dex_swap"
  | "liquidity_add"
  | "liquidity_remove"
  | "unknown_token_liquidity"
  | "tornado_withdrawal"
  | "service_boundary";

export type CrossChainRouteEdge = {
  id: string;
  edgeType: CrossChainRouteEdgeType;
  source: CrossChainAddress | null;
  destination: CrossChainAddress | null;
  txHash: string | null;
  amountRaw: string | null;
  assetSymbol: string | null;
  tokenContract?: string | null;
  timestamp: string | null;
  protocol: string | null;
  evidenceRefs: CrossChainEvidenceRef[];
  labels: string[];
};

export type CrossChainTerminalBoundary =
  | "tornado_or_mixer"
  | "sanctioned_service"
  | "no_name_token_liquidity"
  | "bridge_boundary"
  | "dex_router_boundary"
  | "unknown_contract"
  | "data_exhausted"
  | "none";

export type CrossChainStage2TriggerReason =
  | "large_single_boundary"
  | "large_split_boundary"
  | "medium_direct_high_risk"
  | "manual_deep_mode";

export type CrossChainCorridorPath = {
  id: string;
  triggerReason: CrossChainStage2TriggerReason;
  balanceTransferTxHashes: string[];
  targetAmountRaw: string;
  selectedAmountRaw: string;
  edges: CrossChainRouteEdge[];
  terminalBoundary: CrossChainTerminalBoundary;
  riskLayer: RiskLayerScore;
  sourcePolicyEvidence?: SourcePolicyEvidence | null;
  partial: boolean;
  reasons: string[];
  warnings: string[];
};

export type CrossChainCorridorReport = {
  enabled: boolean;
  triggered: boolean;
  skippedReason: string | null;
  paths: CrossChainCorridorPath[];
  providerCalls: number;
  partial: boolean;
  coverageNotes: string[];
  payloadRefs: ProviderPayloadRef[];
};
```

Extend `WhereIsMoneyReport`:

```ts
crossChainCorridor?: CrossChainCorridorReport;
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- tests/types/crossChainTypes.test.ts
npm run typecheck
```

Commit:

```bash
git add src/types.ts tests/types/crossChainTypes.test.ts
git commit -m "feat: add cross-chain corridor types"
```

---

### Task 3: Cross-Chain Evidence Helpers

**Files:**
- Create: `src/forensics/crossChainEvidence.ts`
- Test: `tests/forensics/crossChainEvidence.test.ts`

- [ ] **Step 1: Add helper tests**

Create `tests/forensics/crossChainEvidence.test.ts`:

```ts
import {
  crossChainEvidenceId,
  payloadRefId,
  sourcePolicyEvidenceFromCrossChainLayer,
  scoreCrossChainTerminalBoundary
} from "../../src/forensics/crossChainEvidence";

describe("crossChainEvidence", () => {
  it("builds stable evidence and payload ids", () => {
    expect(crossChainEvidenceId("range", "ethereum", "0xabc", "bridge_source")).toBe(
      "cross_chain:range:ethereum:0xabc:bridge_source"
    );
    expect(payloadRefId("range", "transfers/by-tx", "ethereum:0xabc")).toBe(
      "range:transfers/by-tx:ethereum:0xabc"
    );
  });

  it("scores no-name liquidity as high source-policy evidence", () => {
    const layer = scoreCrossChainTerminalBoundary({
      terminalBoundary: "no_name_token_liquidity",
      evidenceIds: ["cross_chain:local:ethereum:gary:unknown_token_liquidity"],
      selectedShare: 1
    });

    expect(layer).toMatchObject({
      evidenceClass: "source_policy",
      kind: "cross_chain_no_name_token_liquidity",
      sourceExposureKind: "no_name_token_liquidity",
      proofLevel: "exchange_policy_decline",
      canBeDampened: false
    });
    expect(layer.score).toBeGreaterThanOrEqual(75);
  });

  it("scores exact sanctioned service as hard proof compatible", () => {
    const layer = scoreCrossChainTerminalBoundary({
      terminalBoundary: "sanctioned_service",
      evidenceIds: ["cross_chain:local:ethereum:0xsanctioned:service_boundary"],
      selectedShare: 1
    });

    expect(layer).toMatchObject({
      evidenceClass: "hard_proof",
      sourceExposureKind: "sanctioned_service",
      proofLevel: "exact_scam_or_taint_proof",
      canBeDampened: false
    });
  });

  it("converts source-policy layers to SourcePolicyEvidence", () => {
    const layer = scoreCrossChainTerminalBoundary({
      terminalBoundary: "tornado_or_mixer",
      evidenceIds: ["cross_chain:local:arbitrum:0xeb2c:tornado_withdrawal"],
      selectedShare: 1
    });

    const evidence = sourcePolicyEvidenceFromCrossChainLayer(layer, {
      aggregateShare: 1,
      effectiveShare: 1,
      pathCount: 1
    });

    expect(evidence).toMatchObject({
      kind: "mixer",
      proofLevel: "exchange_policy_decline",
      canBeDampened: false
    });
  });
});
```

Run:

```bash
npm test -- tests/forensics/crossChainEvidence.test.ts
```

Expected: fail until helper exists.

- [ ] **Step 2: Implement helper**

Create `src/forensics/crossChainEvidence.ts` with:

```ts
import type {
  CrossChainTerminalBoundary,
  RiskLayerScore,
  SourceExposureKind,
  SourcePolicyEvidence,
  WhereIsMoneyRiskBand
} from "../types";

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function riskBandFromScore(score: number): WhereIsMoneyRiskBand {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 45) return "MEDIUM";
  if (score >= 20) return "LOW-MEDIUM";
  return "LOW";
}

export function crossChainEvidenceId(provider: string, chain: string, sourceId: string, kind: string): string {
  return `cross_chain:${provider}:${chain}:${sourceId}:${kind}`;
}

export function payloadRefId(provider: string, endpoint: string, key: string): string {
  return `${provider}:${endpoint}:${key}`;
}

function boundaryKind(boundary: CrossChainTerminalBoundary): SourceExposureKind | undefined {
  if (boundary === "no_name_token_liquidity") return "no_name_token_liquidity";
  if (boundary === "tornado_or_mixer") return "mixer";
  if (boundary === "sanctioned_service") return "sanctioned_service";
  if (boundary === "bridge_boundary") return "cross_chain_boundary";
  if (boundary === "dex_router_boundary") return "bridge_router_dex";
  if (boundary === "unknown_contract") return "unknown_contract";
  return undefined;
}

export function scoreCrossChainTerminalBoundary(input: {
  terminalBoundary: CrossChainTerminalBoundary;
  evidenceIds: string[];
  selectedShare: number;
}): RiskLayerScore {
  const share = Number.isFinite(input.selectedShare) ? Math.max(0, Math.min(1, input.selectedShare)) : 0;
  const base = input.terminalBoundary === "sanctioned_service" ? 98 :
    input.terminalBoundary === "tornado_or_mixer" ? 88 :
    input.terminalBoundary === "no_name_token_liquidity" ? 82 :
    input.terminalBoundary === "bridge_boundary" ? 65 :
    input.terminalBoundary === "dex_router_boundary" ? 65 :
    input.terminalBoundary === "unknown_contract" ? 55 :
    input.terminalBoundary === "data_exhausted" ? 45 : 0;
  const adjustment = share >= 0.5 ? 0 : share >= 0.2 ? -5 : -10;
  const score = input.terminalBoundary === "none" ? 0 : clampScore(base + adjustment);
  const exactSanctioned = input.terminalBoundary === "sanctioned_service";
  const proofLevel = exactSanctioned
    ? "exact_scam_or_taint_proof"
    : score >= 60
      ? "exchange_policy_decline"
      : "exchange_policy_context";

  return {
    evidenceClass: exactSanctioned ? "hard_proof" : input.terminalBoundary === "data_exhausted" ? "data_quality" : "source_policy",
    kind: `cross_chain_${input.terminalBoundary}`,
    sourceExposureKind: boundaryKind(input.terminalBoundary),
    score,
    rawScore: score,
    adjustedScore: score,
    proofLevel,
    canBeDampened: input.terminalBoundary === "unknown_contract" || input.terminalBoundary === "data_exhausted",
    reasons: [reasonForBoundary(input.terminalBoundary)],
    warnings: warningForBoundary(input.terminalBoundary),
    evidenceIds: input.evidenceIds
  };
}

export function sourcePolicyEvidenceFromCrossChainLayer(
  layer: RiskLayerScore,
  input: { aggregateShare: number; effectiveShare: number; pathCount: number }
): SourcePolicyEvidence | null {
  if (!layer.sourceExposureKind || layer.evidenceClass !== "source_policy") return null;
  return {
    kind: layer.sourceExposureKind,
    aggregateShare: input.aggregateShare,
    effectiveShare: input.effectiveShare,
    pathCount: input.pathCount,
    score: layer.score,
    riskBand: riskBandFromScore(layer.score),
    proofLevel: layer.proofLevel,
    canBeDampened: layer.canBeDampened,
    reasons: layer.reasons,
    warnings: layer.warnings,
    evidenceIds: layer.evidenceIds
  };
}

function reasonForBoundary(boundary: CrossChainTerminalBoundary): string {
  if (boundary === "tornado_or_mixer") return "Cross-chain corridor reaches Tornado/mixer evidence.";
  if (boundary === "sanctioned_service") return "Cross-chain corridor reaches exact sanctioned-service evidence.";
  if (boundary === "no_name_token_liquidity") return "Cross-chain corridor reaches high-risk no-name token liquidity.";
  if (boundary === "bridge_boundary") return "Cross-chain corridor reaches a bridge boundary.";
  if (boundary === "dex_router_boundary") return "Cross-chain corridor reaches a DEX/router boundary.";
  if (boundary === "unknown_contract") return "Cross-chain corridor reaches an unknown contract boundary.";
  if (boundary === "data_exhausted") return "Cross-chain corridor data was exhausted before clean source was proven.";
  return "No cross-chain risk boundary was found.";
}

function warningForBoundary(boundary: CrossChainTerminalBoundary): string[] {
  if (boundary === "no_name_token_liquidity") {
    return ["No-name token liquidity is high source-policy risk, not direct theft proof by itself."];
  }
  if (boundary === "tornado_or_mixer") {
    return ["Mixer evidence is source-policy risk unless exact sanctioned-service evidence is present."];
  }
  return [];
}
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/forensics/crossChainEvidence.test.ts
npm run typecheck
```

Commit:

```bash
git add src/forensics/crossChainEvidence.ts tests/forensics/crossChainEvidence.test.ts
git commit -m "feat: add cross-chain evidence helpers"
```

---

### Task 4: Source-Policy Scoring Extensions

**Files:**
- Modify: `src/forensics/provenanceScoring.ts`
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`
- Test: `tests/forensics/provenanceScoring.test.ts`

- [ ] **Step 1: Add scoring tests**

Add to `tests/forensics/provenanceScoring.test.ts`:

```ts
it("scores no-name token liquidity as non-dampened high source-policy evidence", () => {
  const result = scoreSourceExposures({
    originPaths: [path({
      sourceExposureKind: "no_name_token_liquidity",
      balanceShare: 1,
      riskScoreContribution: 82,
      reasons: ["Cross-chain corridor reaches no-name token liquidity."]
    })],
    walletRole: "operational_liquidity_wallet",
    operationalLiquidityScore: 90,
    cleanCexCoverage: 0,
    coverageCompleteness: 80,
    provenanceConfidence: 80,
    ageSignals: null
  });

  expect(result.sourcePolicyEvidence[0]).toMatchObject({
    kind: "no_name_token_liquidity",
    proofLevel: "exchange_policy_decline",
    canBeDampened: false
  });
  expect(result.sourcePolicyEvidence[0]?.score).toBeGreaterThanOrEqual(75);
});

it("keeps mixer exposure source-policy unless exact sanctioned evidence is provided separately", () => {
  const result = scoreSourceExposures({
    originPaths: [path({
      sourceExposureKind: "mixer",
      balanceShare: 1,
      riskScoreContribution: 88,
      reasons: ["Cross-chain corridor reaches Tornado/mixer evidence."]
    })],
    walletRole: "unknown_wallet",
    operationalLiquidityScore: 0,
    cleanCexCoverage: 0,
    coverageCompleteness: 80,
    provenanceConfidence: 80,
    ageSignals: null
  });

  expect(result.riskLayers[0]).toMatchObject({
    evidenceClass: "source_policy",
    proofLevel: "exchange_policy_decline",
    canBeDampened: false
  });
});
```

Run:

```bash
npm test -- tests/forensics/provenanceScoring.test.ts
```

Expected: fail until source kinds are recognized and scored.

- [ ] **Step 2: Update source-kind guards**

Update `isSourceExposureKind()` in:

```text
src/forensics/provenanceScoring.ts
src/forensics/moneyOriginOperationalAssessment.ts
```

Add:

```ts
value === "no_name_token_liquidity" ||
value === "mixer" ||
value === "sanctioned_service" ||
```

- [ ] **Step 3: Add scoring curves**

Modify `baseShareScore()` in `src/forensics/provenanceScoring.ts`:

```ts
if (kind === "no_name_token_liquidity") {
  if (s >= 0.5) return 84;
  if (s >= 0.2) return 80;
  return s > 0 ? 75 : 0;
}

if (kind === "mixer") {
  if (s >= 0.5) return 90;
  if (s >= 0.2) return 86;
  return s > 0 ? 80 : 0;
}

if (kind === "sanctioned_service") return s > 0 ? 98 : 0;
```

Modify `capSourceScore()`:

```ts
if (input.kind === "no_name_token_liquidity") return Math.max(75, Math.min(input.score, 88));
if (input.kind === "mixer") return Math.max(80, Math.min(input.score, 92));
if (input.kind === "sanctioned_service") return Math.max(95, input.score);
```

Modify dampening:

```ts
const canBeDampened = ![
  "no_name_token_liquidity",
  "mixer",
  "sanctioned_service"
].includes(kind) && (kind !== "htx_huobi" || aggregateShare < 0.5);
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- tests/forensics/provenanceScoring.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts
npm run typecheck
```

Commit:

```bash
git add src/forensics/provenanceScoring.ts src/forensics/moneyOriginOperationalAssessment.ts tests/forensics/provenanceScoring.test.ts
git commit -m "feat: score cross-chain source-policy exposure"
```

---

### Task 5: Provider Budget And Dedupe

**Files:**
- Create: `src/forensics/crossChainBudget.ts`
- Test: `tests/forensics/crossChainBudget.test.ts`

- [ ] **Step 1: Add budget tests**

Create `tests/forensics/crossChainBudget.test.ts`:

```ts
import { createCrossChainProviderBudget } from "../../src/forensics/crossChainBudget";

describe("crossChainBudget", () => {
  it("counts unique provider calls and dedupes repeated keys", async () => {
    const budget = createCrossChainProviderBudget({ maxProviderCalls: 2 });
    let calls = 0;

    const first = await budget.run("range", "tx:ethereum:0xabc", async () => {
      calls += 1;
      return "ok";
    });
    const second = await budget.run("range", "tx:ethereum:0xabc", async () => {
      calls += 1;
      return "again";
    });

    expect(first).toBe("ok");
    expect(second).toBe("ok");
    expect(calls).toBe(1);
    expect(budget.providerCalls()).toBe(1);
  });

  it("returns a partial note when budget is exhausted", async () => {
    const budget = createCrossChainProviderBudget({ maxProviderCalls: 1 });
    await budget.run("range", "one", async () => "one");

    await expect(budget.run("etherscan", "two", async () => "two")).rejects.toThrow("Cross-chain provider budget exhausted");
    expect(budget.coverageNotes()).toContain("Cross-chain provider budget exhausted after 1 calls.");
  });
});
```

Run:

```bash
npm test -- tests/forensics/crossChainBudget.test.ts
```

Expected: fail until budget helper exists.

- [ ] **Step 2: Implement budget helper**

Create `src/forensics/crossChainBudget.ts`:

```ts
export type CrossChainProviderName = "range" | "etherscan" | "alchemy" | "local";

export type CrossChainProviderBudget = {
  run<T>(provider: CrossChainProviderName, key: string, fn: () => Promise<T>): Promise<T>;
  providerCalls(): number;
  coverageNotes(): string[];
};

export function createCrossChainProviderBudget(input: { maxProviderCalls: number }): CrossChainProviderBudget {
  const maxProviderCalls = Math.max(0, Math.floor(input.maxProviderCalls));
  const cache = new Map<string, Promise<unknown>>();
  const notes: string[] = [];
  let calls = 0;

  return {
    async run<T>(provider: CrossChainProviderName, key: string, fn: () => Promise<T>): Promise<T> {
      const cacheKey = `${provider}:${key}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached as Promise<T>;
      if (calls >= maxProviderCalls) {
        const note = `Cross-chain provider budget exhausted after ${calls} calls.`;
        if (!notes.includes(note)) notes.push(note);
        throw new Error("Cross-chain provider budget exhausted");
      }
      calls += 1;
      const promise = fn();
      cache.set(cacheKey, promise);
      return promise;
    },
    providerCalls() {
      return calls;
    },
    coverageNotes() {
      return [...notes];
    }
  };
}
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/forensics/crossChainBudget.test.ts
npm run typecheck
```

Commit:

```bash
git add src/forensics/crossChainBudget.ts tests/forensics/crossChainBudget.test.ts
git commit -m "feat: add cross-chain provider budget"
```

---

### Task 6: Provider Interfaces And Manual Fixtures

**Files:**
- Create: `src/forensics/crossChainProviders.ts`
- Create: `tests/fixtures/forensics/crossChainCases.ts`
- Test: `tests/forensics/crossChainProviders.test.ts`

- [ ] **Step 1: Add provider fixture tests**

Create `tests/forensics/crossChainProviders.test.ts`:

```ts
import { manualGaryStargateTornadoCase } from "../fixtures/forensics/crossChainCases";
import { createFixtureCrossChainDiscoveryProvider } from "../../src/forensics/crossChainProviders";

describe("crossChainProviders", () => {
  it("finds Range-like transfers by tx with time-window support", async () => {
    const provider = createFixtureCrossChainDiscoveryProvider(manualGaryStargateTornadoCase.discovery);
    const transfers = await provider.findTransfersByTx({
      chain: "ethereum",
      txHash: "0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f",
      timeWindow: {
        start: "2026-05-05T00:00:00.000Z",
        end: "2026-05-05T06:00:00.000Z"
      }
    });

    expect(transfers[0]).toMatchObject({
      protocol: "LayerZero/Stargate",
      assetSymbol: "USDT",
      amountRaw: "100000000000"
    });
  });

  it("finds bridge transfers by address", async () => {
    const provider = createFixtureCrossChainDiscoveryProvider(manualGaryStargateTornadoCase.discovery);
    const transfers = await provider.findTransfersByAddress({
      address: {
        chain: "ethereum",
        chainId: 1,
        address: "0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60"
      },
      timeWindow: {
        start: "2026-05-05T00:00:00.000Z",
        end: "2026-05-05T06:00:00.000Z"
      }
    });

    expect(transfers.map((transfer) => transfer.amountRaw)).toEqual(["247770000000000000000", "250000000000000000000"]);
  });
});
```

Run:

```bash
npm test -- tests/forensics/crossChainProviders.test.ts
```

Expected: fail until provider interface and fixture exist.

- [ ] **Step 2: Add provider types**

Create `src/forensics/crossChainProviders.ts`:

```ts
import type { CrossChainAddress, CrossChainEvidenceRef, ProviderPayloadRef } from "../types";

export type TimeWindow = {
  start: string;
  end: string;
};

export type CrossChainTransfer = {
  id: string;
  protocol: string | null;
  source: CrossChainAddress | null;
  destination: CrossChainAddress | null;
  sourceTxHash: string | null;
  destinationTxHash: string | null;
  assetSymbol: string | null;
  amountRaw: string | null;
  decimals: number | null;
  timestamp: string | null;
  evidenceRefs: CrossChainEvidenceRef[];
  payloadRef: ProviderPayloadRef | null;
  labels: string[];
};

export type ProviderRiskSnapshot = {
  address: CrossChainAddress;
  provider: "range" | "etherscan" | "alchemy" | "local";
  riskScore: number | null;
  labels: string[];
  evidenceRefs: CrossChainEvidenceRef[];
  payloadRef: ProviderPayloadRef | null;
};

export type CrossChainTxQuery = {
  chain?: string;
  txHash: string;
  address?: string;
  timeWindow?: TimeWindow;
};

export type CrossChainAddressQuery = {
  address: CrossChainAddress;
  timeWindow?: TimeWindow;
  assetSymbol?: string;
  minAmountRaw?: string;
};

export interface CrossChainDiscoveryProvider {
  findTransfersByTx(input: CrossChainTxQuery): Promise<CrossChainTransfer[]>;
  findTransfersByAddress(input: CrossChainAddressQuery): Promise<CrossChainTransfer[]>;
  getAddressRisk(input: { address: CrossChainAddress }): Promise<ProviderRiskSnapshot | null>;
}

export type FixtureCrossChainDiscoveryData = {
  transfers: CrossChainTransfer[];
  riskSnapshots: ProviderRiskSnapshot[];
};

export function createFixtureCrossChainDiscoveryProvider(data: FixtureCrossChainDiscoveryData): CrossChainDiscoveryProvider {
  return {
    async findTransfersByTx(input) {
      return data.transfers.filter((transfer) =>
        transfer.sourceTxHash?.toLowerCase() === input.txHash.toLowerCase() ||
        transfer.destinationTxHash?.toLowerCase() === input.txHash.toLowerCase()
      );
    },
    async findTransfersByAddress(input) {
      const target = input.address.address.toLowerCase();
      return data.transfers.filter((transfer) =>
        transfer.source?.address.toLowerCase() === target ||
        transfer.destination?.address.toLowerCase() === target
      );
    },
    async getAddressRisk(input) {
      const target = input.address.address.toLowerCase();
      return data.riskSnapshots.find((snapshot) => snapshot.address.address.toLowerCase() === target) ?? null;
    }
  };
}
```

- [ ] **Step 3: Add manual discovery fixture**

Create `tests/fixtures/forensics/crossChainCases.ts` with normalized transfers:

```ts
import type { FixtureCrossChainDiscoveryData } from "../../../src/forensics/crossChainProviders";

export const manualGaryStargateTornadoCase: {
  discovery: FixtureCrossChainDiscoveryData;
} = {
  discovery: {
    transfers: [
      {
        id: "range:eth-tron:0x7284",
        protocol: "LayerZero/Stargate",
        source: {
          chain: "ethereum",
          chainId: 1,
          address: "0xacddac6c773167c6833e9c05f1"
        },
        destination: {
          chain: "tron",
          chainId: "tron",
          address: "TGyTCHDm9k4r6QPvine8c6A3WWaqTBZAZD"
        },
        sourceTxHash: "0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f",
        destinationTxHash: null,
        assetSymbol: "USDT",
        amountRaw: "100000000000",
        decimals: 6,
        timestamp: "2026-05-05T02:41:59.000Z",
        evidenceRefs: [{
          id: "cross_chain:range:ethereum:0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f:bridge_source",
          provider: "range",
          payloadId: "range:transfers/by-tx:ethereum:0x7284",
          confidence: "provider_correlated"
        }],
        payloadRef: {
          id: "range:transfers/by-tx:ethereum:0x7284",
          provider: "range",
          endpoint: "transfers/by-tx",
          fetchedAt: "2026-06-01T00:00:00.000Z"
        },
        labels: ["LayerZero", "Stargate"]
      },
      {
        id: "range:arb-eth:24777",
        protocol: "Stargate",
        source: {
          chain: "arbitrum",
          chainId: 42161,
          address: "0x6Ca63c963948597EAF85C6A193FedF1d96c62eA7"
        },
        destination: {
          chain: "ethereum",
          chainId: 1,
          address: "0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60"
        },
        sourceTxHash: "0x421000000000000000000000000000000000000000000000000000000000dc7a6",
        destinationTxHash: null,
        assetSymbol: "ETH",
        amountRaw: "247770000000000000000",
        decimals: 18,
        timestamp: "2026-05-05T04:11:26.000Z",
        evidenceRefs: [],
        payloadRef: null,
        labels: ["Stargate Pool Native"]
      },
      {
        id: "range:arb-eth:250",
        protocol: "Stargate",
        source: {
          chain: "arbitrum",
          chainId: 42161,
          address: "0x6Ca63c963948597EAF85C6A193FedF1d96c62eA7"
        },
        destination: {
          chain: "ethereum",
          chainId: 1,
          address: "0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60"
        },
        sourceTxHash: "0xe3e0000000000000000000000000000000000000000000000000000000078769",
        destinationTxHash: null,
        assetSymbol: "ETH",
        amountRaw: "250000000000000000000",
        decimals: 18,
        timestamp: "2026-05-05T04:05:45.000Z",
        evidenceRefs: [],
        payloadRef: null,
        labels: ["Stargate Pool Native"]
      }
    ],
    riskSnapshots: []
  }
};
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- tests/forensics/crossChainProviders.test.ts
npm run typecheck
```

Commit:

```bash
git add src/forensics/crossChainProviders.ts tests/fixtures/forensics/crossChainCases.ts tests/forensics/crossChainProviders.test.ts
git commit -m "feat: add cross-chain provider interface fixtures"
```

---

### Task 7: Stage 2 Trigger Evaluator

**Files:**
- Create: `src/forensics/crossChainStage2Triggers.ts`
- Test: `tests/forensics/crossChainStage2Triggers.test.ts`

- [ ] **Step 1: Add trigger tests**

Create `tests/forensics/crossChainStage2Triggers.test.ts` with these named tests:

```ts
it("triggers large single requested-amount bridge boundary");
it("triggers transaction-seeded large bridge boundary");
it("skips recent-flow small anchor");
it("triggers recent-flow large anchor");
it("groups split flow only when boundary actor and time window match");
it("does not group unrelated boundary paths as exact split flow");
it("triggers medium amount with direct mixer clue");
it("skips medium bridge-only amount");
it("skips low amount but returns deep-check available reason");
it("manual deep mode triggers regardless of amount while staying budgeted");
```

Use helper builders in the test file for `BalanceFormingSelection`, `MoneyOriginPath`, and `WhereIsMoneyAssessment`.

Run:

```bash
npm test -- tests/forensics/crossChainStage2Triggers.test.ts
```

Expected: fail until evaluator exists.

- [ ] **Step 2: Implement evaluator**

Create `src/forensics/crossChainStage2Triggers.ts`:

```ts
import type {
  BalanceFormingSelection,
  CrossChainStage2TriggerReason,
  MoneyOriginPath,
  WhereIsMoneyAssessment
} from "../types";

export type CrossChainStage2TriggerEvaluation = {
  triggered: boolean;
  reason: CrossChainStage2TriggerReason | null;
  skippedReason: string | null;
  deepCheckAvailable: boolean;
  balanceTransferTxHashes: string[];
  selectedAmountRaw: string;
  targetAmountRaw: string;
};

const USDT = 1_000_000n;
const TEN_K = 10_000n * USDT;
const HUNDRED_K = 100_000n * USDT;

function raw(value: string | null | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function pathText(path: MoneyOriginPath): string {
  return [
    path.sourceExposureKind ?? "",
    path.exposureSourceKey ?? "",
    path.exposureSourceLabel ?? "",
    ...path.reasons
  ].join(" ").toLowerCase();
}

function pathHasBoundary(path: MoneyOriginPath): boolean {
  const text = pathText(path);
  return path.sourceExposureKind === "bridge_router_dex" ||
    path.sourceExposureKind === "cross_chain_boundary" ||
    path.sourceExposureKind === "unknown_contract" ||
    /\b(bridge|router|dex|swap|layerzero|stargate|oft|wormhole|axelar|cctp)\b/.test(text);
}

function directHighRiskAssessment(assessment: WhereIsMoneyAssessment): boolean {
  const kinds = [
    ...assessment.hardBadEvidence.map((item) => item.kind),
    ...assessment.sourcePolicyEvidence.map((item) => item.kind),
    ...assessment.riskLayers.map((item) => item.sourceExposureKind).filter(Boolean)
  ];
  return kinds.includes("approval_drain") ||
    kinds.includes("sanctioned_service") ||
    kinds.includes("mixer") ||
    kinds.includes("no_name_token_liquidity");
}

function boundaryFamily(path: MoneyOriginPath): string {
  const text = pathText(path);
  if (text.includes("stargate")) return "stargate";
  if (text.includes("layerzero") || text.includes("oft")) return "layerzero";
  if (text.includes("bridge")) return "bridge";
  if (text.includes("router") || text.includes("dex") || text.includes("swap")) return "dex_router";
  return path.exposureSourceKey ?? path.rootSourceAddress ?? "unknown_boundary";
}

function sameSplitFamily(paths: MoneyOriginPath[]): boolean {
  const families = new Set(paths.map(boundaryFamily));
  return families.size === 1;
}

export function evaluateCrossChainStage2Trigger(input: {
  selection: BalanceFormingSelection;
  originPaths: MoneyOriginPath[];
  assessment: WhereIsMoneyAssessment;
  manualDeepMode?: boolean;
}): CrossChainStage2TriggerEvaluation {
  const selected = raw(input.selection.selectedAmountRaw);
  const target = raw(input.selection.targetAmountRaw ?? input.selection.requestedAmountRaw ?? input.selection.selectedAmountRaw);
  const effectiveAmount = target > 0n ? target : selected;
  const boundaryPaths = input.originPaths.filter(pathHasBoundary);
  const txHashes = [...new Set(boundaryPaths.map((path) => path.balanceTransferTxHash))];

  if (input.manualDeepMode) {
    return {
      triggered: true,
      reason: "manual_deep_mode",
      skippedReason: null,
      deepCheckAvailable: true,
      balanceTransferTxHashes: txHashes,
      selectedAmountRaw: selected.toString(),
      targetAmountRaw: effectiveAmount.toString()
    };
  }

  if (boundaryPaths.length === 0) {
    return {
      triggered: false,
      reason: null,
      skippedReason: "No bridge, router, unknown-contract, or cross-chain boundary was found in Stage 1.",
      deepCheckAvailable: false,
      balanceTransferTxHashes: [],
      selectedAmountRaw: selected.toString(),
      targetAmountRaw: effectiveAmount.toString()
    };
  }

  if (effectiveAmount >= HUNDRED_K && boundaryPaths.length === 1) {
    return {
      triggered: true,
      reason: "large_single_boundary",
      skippedReason: null,
      deepCheckAvailable: true,
      balanceTransferTxHashes: txHashes,
      selectedAmountRaw: selected.toString(),
      targetAmountRaw: effectiveAmount.toString()
    };
  }

  if (effectiveAmount >= HUNDRED_K && boundaryPaths.length > 1 && sameSplitFamily(boundaryPaths)) {
    return {
      triggered: true,
      reason: "large_split_boundary",
      skippedReason: null,
      deepCheckAvailable: true,
      balanceTransferTxHashes: txHashes,
      selectedAmountRaw: selected.toString(),
      targetAmountRaw: effectiveAmount.toString()
    };
  }

  if (effectiveAmount >= TEN_K && directHighRiskAssessment(input.assessment)) {
    return {
      triggered: true,
      reason: "medium_direct_high_risk",
      skippedReason: null,
      deepCheckAvailable: true,
      balanceTransferTxHashes: txHashes,
      selectedAmountRaw: selected.toString(),
      targetAmountRaw: effectiveAmount.toString()
    };
  }

  return {
    triggered: false,
    reason: null,
    skippedReason: effectiveAmount < TEN_K
      ? "Cross-chain boundary is visible, but deep cross-chain analysis was not auto-run below the normal-user threshold."
      : "Cross-chain boundary is visible, but direct high-risk evidence was not strong enough for automatic Stage 2 at this amount.",
    deepCheckAvailable: true,
    balanceTransferTxHashes: txHashes,
    selectedAmountRaw: selected.toString(),
    targetAmountRaw: effectiveAmount.toString()
  };
}
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/forensics/crossChainStage2Triggers.test.ts
npm run typecheck
```

Commit:

```bash
git add src/forensics/crossChainStage2Triggers.ts tests/forensics/crossChainStage2Triggers.test.ts
git commit -m "feat: add cross-chain stage 2 triggers"
```

---

### Task 8: Config And Runtime Defaults

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`
- Test: `tests/config/config.test.ts`

- [ ] **Step 1: Add config tests**

Add to `tests/config/config.test.ts`:

```ts
it("loads optional cross-chain Stage 2 config with disabled default", () => {
  const config = loadConfigWithEnv({});

  expect(config.crossChainStage2Enabled).toBe(false);
  expect(config.crossChainStage2MaxProviderCalls).toBe(60);
});

it("loads cross-chain provider keys and budgets", () => {
  const config = loadConfigWithEnv({
    CROSS_CHAIN_STAGE2_ENABLED: "true",
    CROSS_CHAIN_STAGE2_MAX_PROVIDER_CALLS: "70",
    RANGE_API_KEY: "range-key",
    EVM_EXPLORER_API_KEY: "etherscan-key"
  });

  expect(config.crossChainStage2Enabled).toBe(true);
  expect(config.crossChainStage2MaxProviderCalls).toBe(70);
  expect(config.rangeApiKey).toBe("range-key");
  expect(config.evmExplorerApiKey).toBe("etherscan-key");
});
```

Run:

```bash
npm test -- tests/config/config.test.ts
```

Expected: fail until config fields exist.

- [ ] **Step 2: Add config fields**

Add to `AppConfig` and `loadConfig()`:

```ts
crossChainStage2Enabled: boolean;
crossChainStage2MaxProviderCalls: number;
crossChainStage2CacheTtlMs: number;
rangeApiKey: string | undefined;
rangeBaseUrl: URL;
rangeTimeoutMs: number;
rangeMaxCallsPerCheck: number;
evmExplorerApiKey: string | undefined;
evmExplorerBaseUrl: URL;
evmExplorerTimeoutMs: number;
evmExplorerMaxCallsPerCheck: number;
alchemyApiKey: string | undefined;
alchemyTimeoutMs: number;
```

Default:

```text
CROSS_CHAIN_STAGE2_ENABLED=false
```

- [ ] **Step 3: Update `.env.example`**

Append:

```text
CROSS_CHAIN_STAGE2_ENABLED=false
CROSS_CHAIN_STAGE2_MAX_PROVIDER_CALLS=60
CROSS_CHAIN_STAGE2_CACHE_TTL_MS=86400000
RANGE_API_KEY=
RANGE_BASE_URL=https://api.range.org
RANGE_TIMEOUT_MS=20000
RANGE_MAX_CALLS_PER_CHECK=20
EVM_EXPLORER_API_KEY=
EVM_EXPLORER_BASE_URL=https://api.etherscan.io
EVM_EXPLORER_TIMEOUT_MS=20000
EVM_EXPLORER_MAX_CALLS_PER_CHECK=40
ALCHEMY_API_KEY=
ALCHEMY_TIMEOUT_MS=20000
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- tests/config/config.test.ts
npm run typecheck
```

Commit:

```bash
git add src/config.ts .env.example tests/config/config.test.ts
git commit -m "config: add cross-chain stage 2 settings"
```

---

### Task 9: Range API Schema Verification And Adapter

**Files:**
- Create: `src/forensics/rangeClient.ts`
- Create: `docs/research/2026-06-01-range-api-schema-check.md`
- Test: `tests/forensics/rangeClient.test.ts`

- [ ] **Step 1: Verify current Range docs before coding**

Open current official Range docs and record:

```text
base URL
auth header
tx-level transfer endpoint
address-level transfer endpoint
required query params
rate-limit response fields
example success response
example 401/429 response
```

Write the result to:

```text
docs/research/2026-06-01-range-api-schema-check.md
```

The note must include exact endpoint paths used by the adapter and a sample normalized field mapping.

- [ ] **Step 2: Add Range adapter tests**

Create `tests/forensics/rangeClient.test.ts` with tests for:

```text
Authorization: Bearer <key>
address query normalization
tx query normalization
401 response -> Range API 401 error without key leakage
429 response -> Range API 429 error and rate-limit coverage compatibility
malformed response -> Range API malformed response
payload refs created with provider=range
```

Run:

```bash
npm test -- tests/forensics/rangeClient.test.ts
```

Expected: fail until adapter exists.

- [ ] **Step 3: Implement adapter**

Create `src/forensics/rangeClient.ts`:

```ts
import type { CrossChainDiscoveryProvider } from "./crossChainProviders";

export type RangeEndpointPaths = {
  transfersByTx: string;
  transfersByAddress: string;
  addressRisk: string;
};

export function createRangeCrossChainDiscoveryProvider(input: {
  apiKey: string;
  baseUrl: URL;
  timeoutMs: number;
  endpointPaths: RangeEndpointPaths;
  fetchImpl?: typeof fetch;
}): CrossChainDiscoveryProvider {
  const fetchImpl = input.fetchImpl ?? fetch;

  async function requestJson(path: string, params: URLSearchParams): Promise<unknown> {
    const url = new URL(path, input.baseUrl);
    url.search = params.toString();
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(input.timeoutMs)
    });
    if (!response.ok) {
      throw new Error(`Range API ${response.status}`);
    }
    return response.json();
  }

  return {
    async findTransfersByTx(query) {
      const params = new URLSearchParams();
      params.set("tx_hash", query.txHash);
      if (query.chain) params.set("chain", query.chain);
      if (query.address) params.set("address", query.address);
      if (query.timeWindow) {
        params.set("start_time", query.timeWindow.start);
        params.set("end_time", query.timeWindow.end);
      }
      const payload = await requestJson(input.endpointPaths.transfersByTx, params);
      return normalizeRangeTransfers(payload, "transfers/by-tx");
    },
    async findTransfersByAddress(query) {
      const params = new URLSearchParams();
      params.set("address", query.address.address);
      params.set("chain", String(query.address.chain));
      if (query.assetSymbol) params.set("asset_symbol", query.assetSymbol);
      if (query.minAmountRaw) params.set("min_amount_raw", query.minAmountRaw);
      if (query.timeWindow) {
        params.set("start_time", query.timeWindow.start);
        params.set("end_time", query.timeWindow.end);
      }
      const payload = await requestJson(input.endpointPaths.transfersByAddress, params);
      return normalizeRangeTransfers(payload, "transfers/by-address");
    },
    async getAddressRisk() {
      return null;
    }
  };
}
```

Define the production `RangeEndpointPaths` constants in `rangeClient.ts` from `docs/research/2026-06-01-range-api-schema-check.md` after the schema check is written. Adapter tests should inject test paths so URL construction is deterministic.

- [ ] **Step 4: Verify schema paths are recorded**

Run:

```bash
rg -n "transfersByTx|transfersByAddress|addressRisk" src/forensics/rangeClient.ts docs/research/2026-06-01-range-api-schema-check.md
```

Expected: endpoint path names appear in both the adapter and the schema-check note.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- tests/forensics/rangeClient.test.ts
npm run typecheck
```

Commit:

```bash
git add src/forensics/rangeClient.ts tests/forensics/rangeClient.test.ts docs/research/2026-06-01-range-api-schema-check.md
git commit -m "feat: add Range cross-chain discovery provider"
```

---

### Task 10: EVM Explorer Provider With Logs

**Files:**
- Create: `src/forensics/evmExplorerClient.ts`
- Test: `tests/forensics/evmExplorerClient.test.ts`

- [ ] **Step 1: Add EVM provider tests**

Create `tests/forensics/evmExplorerClient.test.ts` with tests for:

```text
ethereum -> chainid 1
arbitrum -> chainid 42161
txlist normalizes normal transactions
txlistinternal normalizes internal transfers
tokentx normalizes ERC20 transfers
receipt returns logs
getLogs returns logs when available
pagination stops at configured max pages
malformed explorer response throws clear error
API key is never included in thrown error messages
```

Run:

```bash
npm test -- tests/forensics/evmExplorerClient.test.ts
```

Expected: fail until provider exists.

- [ ] **Step 2: Implement provider interface and adapter**

Create `src/forensics/evmExplorerClient.ts`:

```ts
export type EvmChain = "ethereum" | "arbitrum";

export type EvmAddressQuery = {
  chain: EvmChain;
  address: string;
  startBlock?: number;
  endBlock?: number;
  pageLimit?: number;
  offset?: number;
};

export type EvmTokenTransferQuery = EvmAddressQuery & {
  contractAddress?: string;
};

export type EvmLogQuery = {
  chain: EvmChain;
  address?: string;
  fromBlock?: number;
  toBlock?: number;
  topic0?: string;
};

export interface EvmEvidenceProvider {
  listNormalTransactions(input: EvmAddressQuery): Promise<EvmTransaction[]>;
  listInternalTransactions(input: EvmAddressQuery): Promise<EvmInternalTransaction[]>;
  listErc20Transfers(input: EvmTokenTransferQuery): Promise<EvmTokenTransfer[]>;
  getTransactionReceipt(input: { chain: EvmChain; txHash: string }): Promise<EvmTransactionReceipt | null>;
  getLogs(input: EvmLogQuery): Promise<EvmLog[]>;
  getTokenMetadata(input: { chain: EvmChain; tokenContract: string }): Promise<EvmTokenMetadata | null>;
}
```

Use Etherscan V2-compatible query format with `chainid`:

```text
ethereum -> 1
arbitrum -> 42161
```

Normalize logs and receipts so Uniswap V3 `DecreaseLiquidity` / `Collect` detectors can use either receipt logs or `getLogs()`.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/forensics/evmExplorerClient.test.ts
npm run typecheck
```

Commit:

```bash
git add src/forensics/evmExplorerClient.ts tests/forensics/evmExplorerClient.test.ts
git commit -m "feat: add EVM explorer evidence provider"
```

---

### Task 11: Deterministic Detectors

**Files:**
- Create: `src/forensics/crossChainDetectors.ts`
- Test: `tests/forensics/crossChainDetectors.test.ts`

- [ ] **Step 1: Add detector tests**

Create `tests/forensics/crossChainDetectors.test.ts` with cases:

```text
GARY Uniswap V3 remove/collect -> no_name_token_liquidity
major-token Uniswap V3 remove/collect -> not no_name_token_liquidity
missing token metadata -> data_exhausted warning
Tornado label without exact sanctions -> tornado_or_mixer source-policy
exact sanctioned local label -> sanctioned_service hard-proof compatible
Stargate/LayerZero only -> bridge_boundary
weak amount/time-only match -> none or data_exhausted, never proof
```

Run:

```bash
npm test -- tests/forensics/crossChainDetectors.test.ts
```

Expected: fail until detectors exist.

- [ ] **Step 2: Implement detectors**

Create `src/forensics/crossChainDetectors.ts` with exported functions:

```ts
export function detectKnownMixerOrSanctionedService(input): CrossChainDetectorResult;
export function detectNoNameTokenLiquidity(input): CrossChainDetectorResult;
export function detectUniswapV3LiquidityEvent(input): CrossChainDetectorResult;
export function detectBridgeServiceBoundary(input): CrossChainDetectorResult;
```

Rules:

```text
Known Tornado address or label -> tornado_or_mixer
Exact sanctioned local label -> sanctioned_service
Uniswap V3 remove/collect involving non-major token and large ETH/native value -> no_name_token_liquidity
Stargate/LayerZero/bridge only -> bridge_boundary
Missing metadata -> partial coverage warning
Major token liquidity -> not no_name_token_liquidity
Weak amount/time-only -> weak support only
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/forensics/crossChainDetectors.test.ts
npm run typecheck
```

Commit:

```bash
git add src/forensics/crossChainDetectors.ts tests/forensics/crossChainDetectors.test.ts
git commit -m "feat: add cross-chain terminal detectors"
```

---

### Task 12: Corridor Expander

**Files:**
- Create: `src/forensics/crossChainCorridor.ts`
- Test: `tests/forensics/crossChainCorridor.test.ts`

- [ ] **Step 1: Add corridor tests**

Create `tests/forensics/crossChainCorridor.test.ts` with cases:

```text
trigger skipped -> enabled report with triggered=false and no provider calls
triggered but discovery provider missing -> partial report
Range TRON -> Ethereum bridge row -> bridge edge
Range + EVM GARY liquidity -> no_name_token_liquidity
Range + EVM Arbitrum Tornado funding -> tornado_or_mixer
exact sanctioned detector -> extra hard evidence candidate
provider budget exhaustion -> partial but keeps found risk
weak amount/time-only match -> never clean proof
manual case path contains asset-track switch notes
```

Run:

```bash
npm test -- tests/forensics/crossChainCorridor.test.ts
```

Expected: fail until corridor expander exists.

- [ ] **Step 2: Implement corridor runner**

Create `src/forensics/crossChainCorridor.ts`:

```ts
import type {
  CrossChainCorridorReport,
  MoneyOriginPath,
  SourcePolicyEvidence,
  RiskLayerScore,
  WhereIsMoneyHardBadEvidence
} from "../types";
import type { CrossChainDiscoveryProvider } from "./crossChainProviders";
import type { EvmEvidenceProvider } from "./evmExplorerClient";
import type { CrossChainStage2TriggerEvaluation } from "./crossChainStage2Triggers";

export type CrossChainCorridorAnalysisResult = {
  report: CrossChainCorridorReport;
  extraSourcePolicyEvidence: SourcePolicyEvidence[];
  extraRiskLayers: RiskLayerScore[];
  extraHardBadEvidence: WhereIsMoneyHardBadEvidence[];
};

export async function runCrossChainCorridorAnalysis(input: {
  trigger: CrossChainStage2TriggerEvaluation;
  subjectAddress: string;
  originPaths: MoneyOriginPath[];
  discoveryProvider?: CrossChainDiscoveryProvider;
  evmProvider?: EvmEvidenceProvider;
  maxProviderCalls: number;
}): Promise<CrossChainCorridorAnalysisResult> {
  if (!input.trigger.triggered) {
    return {
      report: {
        enabled: true,
        triggered: false,
        skippedReason: input.trigger.skippedReason,
        paths: [],
        providerCalls: 0,
        partial: false,
        coverageNotes: input.trigger.deepCheckAvailable ? ["Deep cross-chain analysis is available but was not auto-run."] : [],
        payloadRefs: []
      },
      extraSourcePolicyEvidence: [],
      extraRiskLayers: [],
      extraHardBadEvidence: []
    };
  }

  if (!input.discoveryProvider) {
    return {
      report: {
        enabled: true,
        triggered: true,
        skippedReason: null,
        paths: [],
        providerCalls: 0,
        partial: true,
        coverageNotes: ["Stage 2 was triggered, but the cross-chain discovery provider is unavailable."],
        payloadRefs: []
      },
      extraSourcePolicyEvidence: [],
      extraRiskLayers: [],
      extraHardBadEvidence: []
    };
  }

  return expandWithProviders(input);
}
```

Implement `expandWithProviders()` so it:

1. Queries Range by selected tx hashes and boundary actors.
2. Converts Range rows to bridge edges.
3. Uses EVM provider for Ethereum/Arbitrum addresses and txs.
4. Follows asset-track switches from USDT to ETH/native transfers.
5. Runs deterministic detectors.
6. Scores terminal boundary with `scoreCrossChainTerminalBoundary()`.
7. Builds `SourcePolicyEvidence` for source-policy terminals.
8. Builds `WhereIsMoneyHardBadEvidence` for exact sanctioned terminals only.
9. Returns partial coverage when provider budget or provider data blocks continuation.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/forensics/crossChainCorridor.test.ts
npm run typecheck
```

Commit:

```bash
git add src/forensics/crossChainCorridor.ts tests/forensics/crossChainCorridor.test.ts
git commit -m "feat: add cross-chain corridor analysis"
```

---

### Task 13: Operational Assessment Integration

**Files:**
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`
- Test: `tests/forensics/moneyOriginOperationalAssessment.test.ts`

- [ ] **Step 1: Add branch-preservation tests**

Add tests:

```text
extra no-name layer becomes dominantRiskLayer
extra no-name layer does not enter hardBadEvidence
extra mixer layer does not enter hardBadEvidence
extra sanctioned hard evidence enters hardBadEvidence
operational dampening does not lower no-name/mixer below HIGH
topHardEvidence branch preserves extra risk layers
topContractSuspicion branch preserves extra risk layers
serviceRouteGuard branch preserves extra risk layers
sourcePolicyDecline branch preserves extra risk layers
legitimateServiceVerdict branch preserves extra risk layers
acceptable branch preserves extra data-quality partial layer
```

Run:

```bash
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
```

Expected: fail until assessment accepts extras.

- [ ] **Step 2: Extend assessment input**

Modify `BuildMoneyOriginOperationalAssessmentInput`:

```ts
extraSourcePolicyEvidence?: SourcePolicyEvidence[];
extraRiskLayers?: RiskLayerScore[];
extraHardBadEvidence?: WhereIsMoneyHardBadEvidence[];
```

Merge hard evidence:

```ts
const hardBadEvidence = [
  ...hardEvidenceFromFastRisk(input.fastWalletRisk),
  ...hardEvidenceFromApprovalDrain(input.approvalDrainProvenanceProfiles, { exactOnly: serviceRouteGuard }),
  ...hardEvidenceFromPaths(input.originPaths),
  ...(input.extraHardBadEvidence ?? [])
].sort((left, right) => right.score - left.score);
```

- [ ] **Step 3: Preserve extras in layer collections**

Update `defaultLayerCollections()` so every return branch includes extras:

```ts
const defaultLayerCollections = (hardProofLayers = hardBadEvidence.map(hardEvidenceToLayer)) =>
  buildRiskLayerCollections({
    sourcePolicyEvidence: [
      ...sourcePolicyAssessment.sourcePolicyEvidence,
      ...(input.extraSourcePolicyEvidence ?? [])
    ],
    sourcePolicyLayers: [
      ...sourcePolicyAssessment.riskLayers,
      ...(input.extraRiskLayers ?? []).filter((layer) => layer.evidenceClass === "source_policy")
    ],
    aggregateSourcePolicyLayer: aggregateDeclineLayer,
    contractSuspicionEvidence,
    unknownOriginEvidence: [
      ...defaultUnknownOriginEvidence,
      ...(input.extraRiskLayers ?? []).filter((layer) => layer.evidenceClass === "data_quality" || layer.evidenceClass === "unknown_origin")
    ],
    hardProofLayers: [
      ...hardProofLayers,
      ...(input.extraRiskLayers ?? []).filter((layer) => layer.evidenceClass === "hard_proof")
    ]
  });
```

When a branch manually calls `buildRiskLayerCollections()`, include the same extras instead of bypassing `defaultLayerCollections()`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
npm run typecheck
```

Commit:

```bash
git add src/forensics/moneyOriginOperationalAssessment.ts tests/forensics/moneyOriginOperationalAssessment.test.ts
git commit -m "feat: merge cross-chain evidence into where assessment"
```

---

### Task 14: Where-Is-Money Two-Pass Wiring

**Files:**
- Modify: `src/check/whereIsMoneyCheck.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Add integration tests**

Add tests:

```text
Stage 2 disabled makes zero provider calls and preserves current report
Stage 2 skipped below threshold attaches skipped report
Stage 2 provider missing after trigger attaches partial report
Stage 2 no-name liquidity changes final dominantRiskLayer
Stage 2 exact sanctioned hard evidence drives hard proof decline
Stage 2 preserves requested_amount coverage notes
Stage 2 preserves transaction_seed coverage notes
Stage 2 preserves recent_flow anchor behavior
```

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

Expected: fail until where wiring exists.

- [ ] **Step 2: Extend deps and input**

Add to `WhereIsMoneyDeps`:

```ts
crossChainDiscoveryProvider?: CrossChainDiscoveryProvider;
evmEvidenceProvider?: EvmEvidenceProvider;
```

Add to `RunWhereIsMoneyCheckInput`:

```ts
crossChainStage2Enabled?: boolean;
crossChainManualDeepMode?: boolean;
crossChainMaxProviderCalls?: number;
```

- [ ] **Step 3: Implement two-pass flow**

In `runWhereIsMoneyCheck()`:

1. Build Stage 1 origin paths and initial assessment.
2. Evaluate `evaluateCrossChainStage2Trigger()`.
3. If disabled, skip without provider calls.
4. If enabled, call `runCrossChainCorridorAnalysis()`.
5. Rebuild final assessment with:

```ts
extraSourcePolicyEvidence: corridor.extraSourcePolicyEvidence,
extraRiskLayers: corridor.extraRiskLayers,
extraHardBadEvidence: corridor.extraHardBadEvidence
```

6. Return `WhereIsMoneyReport` with optional `crossChainCorridor`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts
npm run typecheck
```

Commit:

```bash
git add src/check/whereIsMoneyCheck.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "feat: wire cross-chain stage 2 into where is money"
```

---

### Task 15: CLI And Runtime Provider Wiring

**Files:**
- Modify: `src/forensics/whereIsMoneyCliArgs.ts`
- Modify: `scripts/forensicWhereIsMoney.ts`
- Modify: `src/index.ts`
- Test: `tests/forensics/whereIsMoneyCliArgs.test.ts`

- [ ] **Step 1: Add CLI flag tests**

Add tests:

```ts
expect(parseWhereIsMoneyCliArgs(["T...", "--cross-chain-stage2"]).crossChainStage2Enabled).toBe(true);
expect(parseWhereIsMoneyCliArgs(["T...", "--cross-chain-manual-deep"]).crossChainManualDeepMode).toBe(true);
expect(parseWhereIsMoneyCliArgs(["T...", "--cross-chain-max-provider-calls", "30"]).crossChainMaxProviderCalls).toBe(30);
```

Run:

```bash
npm test -- tests/forensics/whereIsMoneyCliArgs.test.ts
```

Expected: fail until flags exist.

- [ ] **Step 2: Add CLI fields**

Extend `ParsedWhereIsMoneyCliArgs`:

```ts
crossChainStage2Enabled: boolean;
crossChainManualDeepMode: boolean;
crossChainMaxProviderCalls: number;
```

Add value flag:

```ts
"--cross-chain-max-provider-calls"
```

Parse boolean flags:

```ts
const crossChainStage2Enabled = args.includes("--cross-chain-stage2");
const crossChainManualDeepMode = args.includes("--cross-chain-manual-deep");
```

- [ ] **Step 3: Wire providers**

In CLI/runtime, create providers only when Stage 2 is enabled and keys exist:

```ts
const crossChainDiscoveryProvider = config.crossChainStage2Enabled && config.rangeApiKey
  ? createRangeCrossChainDiscoveryProvider({
      apiKey: config.rangeApiKey,
      baseUrl: config.rangeBaseUrl,
      timeoutMs: config.rangeTimeoutMs,
      endpointPaths: RANGE_ENDPOINT_PATHS
    })
  : undefined;
```

Create EVM provider similarly from `EVM_EXPLORER_API_KEY`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- tests/forensics/whereIsMoneyCliArgs.test.ts
npm run typecheck
```

Commit:

```bash
git add src/forensics/whereIsMoneyCliArgs.ts scripts/forensicWhereIsMoney.ts src/index.ts tests/forensics/whereIsMoneyCliArgs.test.ts
git commit -m "feat: wire cross-chain stage 2 runtime"
```

---

### Task 16: Incoming Deposit Reuse

**Files:**
- Modify: `src/forensics/incomingDepositJob.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Add incoming-deposit tests**

Add tests:

```text
large transaction-seeded bridge deposit passes Stage 2 deps to runWhereIsMoneyCheck
Stage 2 partial note appears in incoming report warnings
no-name liquidity appears as source-policy evidence, not hard bad evidence
exact sanctioned Stage 2 evidence remains hard proof
Stage 2 disabled keeps current incoming-deposit behavior
```

Run:

```bash
npm test -- tests/forensics/incomingDepositJob.test.ts
```

Expected: fail until deps are passed.

- [ ] **Step 2: Extend incoming deps and input**

Add optional providers and flags to the incoming job dependencies:

```ts
crossChainDiscoveryProvider?: CrossChainDiscoveryProvider;
evmEvidenceProvider?: EvmEvidenceProvider;
crossChainStage2Enabled?: boolean;
crossChainMaxProviderCalls?: number;
```

Pass them into `runWhereIsMoneyCheck()`.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/forensics/incomingDepositJob.test.ts
npm run typecheck
```

Commit:

```bash
git add src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "feat: reuse cross-chain stage 2 for incoming deposits"
```

---

### Task 17: Telegram Summary

**Files:**
- Modify: `src/bot/createBot.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add formatting tests**

Add tests for `formatWhereIsMoneyReport()`:

```text
no-name token liquidity summary includes source-policy risk and not direct scam proof
partial Stage 2 summary says provider data is partial
skipped Stage 2 summary says deep analysis was not auto-run below threshold
summary shows only top corridor path and does not dump every edge
exact sanctioned summary uses hard-proof wording
```

Expected snippets:

```text
Cross-chain corridor
no-name token liquidity
source-policy risk, not direct scam proof
Stage 2 was triggered, but provider data is partial
Deep cross-chain analysis was not auto-run below threshold
```

Run:

```bash
npm test -- tests/bot/createBot.test.ts
```

Expected: fail until formatter handles `crossChainCorridor`.

- [ ] **Step 2: Implement compact summary**

Modify `formatWhereIsMoneyReport()` in `src/bot/createBot.ts`.

Rules:

```text
show top path only
show terminal boundary
show proof level
show partial/skipped note
do not render all edges
do not say no-name liquidity is direct scam proof
do not say Tornado/mixer is hard proof unless exact sanctioned evidence exists
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/bot/createBot.test.ts
npm run typecheck
```

Commit:

```bash
git add src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: show cross-chain corridor summary"
```

---

### Task 18: Full Manual Fixture Regression

**Files:**
- Modify: `tests/fixtures/forensics/crossChainCases.ts`
- Modify: `tests/forensics/crossChainCorridor.test.ts`
- Modify: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Add full manual fixture data**

Extend `manualGaryStargateTornadoCase` with:

```text
Range Ethereum -> TRON USDT rows
EVM normal txs for 0x2cFEEE...
EVM internal txs for ETH funding
EVM ERC20 transfers for USDT and GARY
EVM receipt/log fixtures for Uniswap V3 remove/collect
token metadata for GARY with low holder/transfer counts
Stargate Pool Native labels
Arbitrum normal/internal txs for 0x6Ca63...
Tornado.Cash 100 ETH funding label for 0xeb2C...
expected terminal boundaries
```

The fixture should preserve the analyst decision points:

```text
TRON contract/LayerZero clue becomes a Stage 2 seed
Range bridge row becomes provider-correlated evidence
Ethereum bridge sender expansion does not stop at bridge contract
USDT -> ETH asset-track switch is represented
Uniswap V3 logs represent liquidity remove/collect
GARY token metadata represents no-name/thin liquidity
247.77 + 250 ETH split is grouped only because actor/protocol/time/amount support it
Arbitrum internal/native continuation is required
Tornado.Cash 100 ETH funding is terminal source-policy evidence
```

- [ ] **Step 2: Add end-to-end fixture expectations**

Add expectations:

```ts
expect(report.crossChainCorridor?.triggered).toBe(true);
expect(report.crossChainCorridor?.paths[0]?.terminalBoundary).toMatch(/no_name_token_liquidity|tornado_or_mixer/);
expect(report.assessment.dominantRiskLayer?.proofLevel).toBe("exchange_policy_decline");
expect(report.assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("llm_contract_suspicion");
expect(report.assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("unknown_contract_boundary");
```

Add mechanics expectations:

```ts
const edgeTypes = report.crossChainCorridor?.paths[0]?.edges.map((edge) => edge.edgeType) ?? [];
expect(edgeTypes).toContain("bridge_protocol_link");
expect(edgeTypes).toContain("native_transfer");
expect(edgeTypes).toContain("liquidity_remove");
expect(edgeTypes).toContain("unknown_token_liquidity");
expect(edgeTypes).toContain("tornado_withdrawal");
expect(report.assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("sanctioned_service");
```

Add partial continuation variant:

```ts
expect(noNameOnlyReport.crossChainCorridor?.paths[0]?.terminalBoundary).toBe("no_name_token_liquidity");
expect(noNameOnlyReport.crossChainCorridor?.partial).toBe(true);
expect(noNameOnlyReport.assessment.dominantRiskLayer?.proofLevel).toBe("exchange_policy_decline");
expect(noNameOnlyReport.assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("sanctioned_service");
```

Add exact sanctioned variant:

```ts
expect(sanctionedReport.assessment.hardBadEvidence.map((item) => item.kind)).toContain("sanctioned_service");
expect(sanctionedReport.assessment.dominantRiskLayer?.proofLevel).toBe("exact_scam_or_taint_proof");
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/forensics/crossChainCorridor.test.ts tests/check/whereIsMoneyCheck.test.ts
npm run typecheck
```

Commit:

```bash
git add tests/fixtures/forensics/crossChainCases.ts tests/forensics/crossChainCorridor.test.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "test: add cross-chain manual corridor fixture"
```

---

### Task 19: Risk Center Storage Guard

**Files:**
- Modify: existing storage/repository files that persist forensic reports
- Test: existing storage tests for forensic jobs

- [ ] **Step 1: Add storage regression test**

Add a test to the existing forensic job storage test file that stores and reads a `WhereIsMoneyReport` containing:

```text
crossChainCorridor.triggered=true
crossChainCorridor.partial=true
crossChainCorridor.payloadRefs[0].provider=range
```

The test should assert no provider function is needed to read the stored result.

- [ ] **Step 2: Preserve `crossChainCorridor` in stored report JSON**

If stored reports are generic JSON already, add only a regression test.

If report schema strips unknown fields, update the serializer/deserializer to preserve `crossChainCorridor`.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/storage
npm run typecheck
```

Commit:

```bash
git add src/storage tests/storage
git commit -m "test: preserve stored cross-chain corridor reports"
```

---

### Task 20: Live Smoke

**Files:**
- No source changes unless smoke exposes a defect

- [ ] **Step 1: Set local PowerShell env**

```powershell
$env:CROSS_CHAIN_STAGE2_ENABLED="true"
$env:RANGE_API_KEY="<range-key>"
$env:EVM_EXPLORER_API_KEY="<etherscan-v2-key>"
$env:TRON_FULLNODE_API_KEY="<trongrid-key>"
```

- [ ] **Step 2: Run smoke check**

```bash
npm run forensic:where-is-money -- --source TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb --amount 1289099 --cross-chain-stage2 --cross-chain-max-provider-calls 30
```

Expected:

```text
no crash
Stage 1 coverage preserved
Stage 2 triggered or partial with honest provider coverage
missing Stage 2 data does not produce clean result
wording separates source-policy evidence from hard scam/drain proof
```

- [ ] **Step 3: Save smoke notes**

If live output differs from deterministic fixtures, create:

```text
docs/research/2026-06-01-crosschain-live-smoke-notes.md
```

Do not store secrets.

---

### Task 21: Final Verification

**Files:**
- All touched files

- [ ] **Step 1: Run targeted suite**

```bash
npm test -- tests/forensics/usdtAmount.test.ts tests/types/crossChainTypes.test.ts tests/forensics/crossChainEvidence.test.ts tests/forensics/crossChainBudget.test.ts tests/forensics/crossChainProviders.test.ts tests/forensics/crossChainStage2Triggers.test.ts tests/forensics/rangeClient.test.ts tests/forensics/evmExplorerClient.test.ts tests/forensics/crossChainDetectors.test.ts tests/forensics/crossChainCorridor.test.ts tests/forensics/provenanceScoring.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts tests/config/config.test.ts tests/bot/createBot.test.ts
```

- [ ] **Step 2: Run full suite**

```bash
npm test
npm run typecheck
```

- [ ] **Step 3: Manual wording review**

Check:

```text
no-name liquidity is not called scam proof
Tornado/mixer proof level is honest
exact sanctioned evidence can become hard proof
weak amount/time-only evidence is never proof
skipped/partial Stage 2 is visible
normal Telegram report stays compact
disabled Stage 2 makes zero provider calls
Risk Center does not run live providers
```

- [ ] **Step 4: Stage only Stage 2 files**

Run:

```bash
git status --short
```

Stage only files changed for Stage 2. Do not stage unrelated Telegram/runtime edits from the pre-existing working tree.

Commit:

```bash
git add src tests .env.example docs/research/2026-06-01-range-api-schema-check.md
git commit -m "feat: add where is money cross-chain stage 2"
```

---

## Self-Review

Spec coverage:

```text
The plan covers current-code audit, ChatGPT Pro review findings, manual tracing playbook, analyst decision mechanics, shared amount parsing, source exposure extensions, exact sanctioned hard-proof path, provider interfaces, Range schema verification, EVM logs, deterministic detectors, budget/dedupe, two-pass where integration, incoming deposit reuse, compact Telegram summary, stored report preservation, route-mechanics manual fixtures, and live smoke.
```

Marker scan:

```text
No unresolved marker strings remain.
```

Current-code consistency:

```text
The plan does not include already-completed requestedAmount, recent-flow, transaction-seed, or TronGrid fallback work. It uses current provenanceScope, RiskLayerScore, SourcePolicyEvidence, dominantRiskLayer, and the current formatWhereIsMoneyReport entrypoint in src/bot/createBot.ts.
```
